// What the egress proxy refuses to relay to, by address, and the runner allowlist it enforces in a slot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProxy, allowed, loadAllowlist, localAddress, privateAddress, hostAddress, refusedAddress } from '../egress-proxy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mappedHex = (v4) => { const [a, b, c, d] = v4.split('.').map(Number); return `::ffff:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`; };
const v4Forms = (v4) => [v4, `::ffff:${v4}`, mappedHex(v4), `[${mappedHex(v4)}]`];

const PRIVATE_V4 = {
  'RFC 1918 10/8': ['10.0.0.1', '10.255.255.254'],
  'RFC 1918 172.16/12': ['172.16.0.1', '172.31.255.254'],
  'RFC 1918 192.168/16, Docker Desktop and the LAN': ['192.168.65.254', '192.168.1.1', '192.168.1.5'],
  'CGNAT 100.64/10': ['100.64.0.1', '100.127.255.254'],
  'benchmark 198.18/15': ['198.18.0.1', '198.19.255.254'],
  'multicast 224/4': ['224.0.0.1', '239.255.255.250'],
  'reserved 240/4 and broadcast': ['240.0.0.1', '255.255.255.255'],
};
const PRIVATE_V6 = { 'ULA fc00::/7': ['fc00::1', 'fd12:3456::1', '[fdff::1]'], 'multicast ff00::/8': ['ff02::1', 'ff05::1:3'] };
const LOCAL = ['127.0.0.1', '127.9.9.9', '0.0.0.0', '169.254.169.254'];
const PUBLIC = ['93.184.216.34', '140.82.112.3', '8.8.8.8', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '198.17.255.255', '198.20.0.1', '223.255.255.255', '2606:4700::1', 'fbff::1'];

test('every denied range is refused under denyPrivate in dotted and both IPv4-mapped forms, and only there', () => {
  for (const [range, addrs] of Object.entries(PRIVATE_V4)) {
    for (const a of addrs.flatMap(v4Forms)) {
      assert.ok(privateAddress(a), `${range}: ${a}`);
      assert.equal(refusedAddress(a, { denyPrivate: true, ifaces: {} }), 'private', `${range}: ${a}`);
      assert.equal(refusedAddress(a, { ifaces: {} }), null, `${range}: ${a} still relays for a host lane, whose own route reaches it anyway`);
    }
  }
  for (const [range, addrs] of Object.entries(PRIVATE_V6)) for (const a of addrs) assert.equal(refusedAddress(a, { denyPrivate: true, ifaces: {} }), 'private', `${range}: ${a}`);
  for (const a of PUBLIC.flatMap((x) => (net.isIPv4(x) ? v4Forms(x) : [x]))) {
    assert.equal(refusedAddress(a, { denyPrivate: true, ifaces: {} }), null, `public ${a}`);
  }
});

test('what was already refused stays refused in every mode, including the hex IPv4-mapped spelling the URL parser produces', () => {
  for (const a of [...LOCAL.flatMap(v4Forms), '::1', '::', '[::1]', 'fe80::1', 'fe80::1%en0', '::7f00:1']) {
    assert.ok(localAddress(a), a);
    assert.equal(refusedAddress(a, { ifaces: {} }), 'local', a);
    assert.equal(refusedAddress(a, { denyPrivate: true, ifaces: {} }), 'local', a);
  }
  assert.equal(new URL('https://[::ffff:127.0.0.1]:7980').hostname, '[::ffff:7f00:1]', 'the form a CONNECT target arrives in');
});

test("the host's own interface addresses are refused in every mode", () => {
  const ifaces = { en0: [{ address: '192.168.1.5', family: 'IPv4' }, { address: 'fe80::1c%en0', family: 'IPv6' }], utun3: [{ address: 'fd7a:115c::5', family: 'IPv6' }] };
  for (const a of ['192.168.1.5', '::ffff:192.168.1.5', mappedHex('192.168.1.5'), 'fd7a:115c::5']) {
    assert.ok(hostAddress(a, ifaces), a);
    assert.equal(refusedAddress(a, { ifaces }), 'this host', a);
  }
  assert.equal(refusedAddress('192.168.1.6', { ifaces }), null, 'another LAN host is a host-lane target');
});

const connectVia = (port, target) => new Promise((done, fail) => {
  const s = net.connect(port, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
  let head = '';
  s.on('data', (d) => { head += d; if (head.includes('\r\n\r\n')) { s.destroy(); done(Number(head.split(' ')[1])); } });
  s.setTimeout(5000, () => { s.destroy(); fail(new Error(`no CONNECT answer for ${target}`)); });
  s.on('error', fail);
});
const getVia = (port, url) => new Promise((done, fail) => {
  const req = http.request({ host: '127.0.0.1', port, path: url, headers: { host: new URL(url).host } }, (res) => {
    let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => done({ status: res.statusCode, body }));
  });
  req.setTimeout(5000, () => req.destroy(new Error(`no answer for ${url}`)));
  req.on('error', fail); req.end();
});

test('denyPrivate refuses IP literals in CONNECT and plain-HTTP URLs, and names that resolve privately, before any connection', async (c) => {
  const answers = { 'lan.test': ['192.168.65.254'], 'mixed.test': ['140.82.112.3', '10.0.0.7'], 'ula.test': ['fd00::7'] };
  const lookup = (h, o, cb) => (answers[h] ? cb(null, answers[h].map((address) => ({ address, family: net.isIP(address) }))) : cb(Object.assign(new Error('nx'), { code: 'ENOTFOUND' })));
  const connects = ['192.168.65.254:7980', '[::ffff:192.168.65.254]:7980', `[${mappedHex('192.168.65.254')}]:7980`, '3232252414:7980',
    '192.168.1.5:7981', '192.168.1.1:80', '172.17.0.1:80', '100.100.100.100:443', '198.18.0.1:443', '[fd00::1]:443', '224.0.0.251:5353',
    'lan.test:7980', 'mixed.test:443', 'ula.test:443'];
  const gets = ['http://192.168.65.254:7980/', 'http://[::ffff:10.0.0.1]/', 'http://lan.test/x', 'http://mixed.test/'];
  for (const mode of ['observe', 'enforce']) {
    // enforce lets every one through the allowlist, so the refusal measured is the address vetting's
    const allow = [...connects.map((t) => `https://${t}`), ...gets].map((u) => ({ host: new URL(u).hostname.replace(/^\[|\]$/g, '') }));
    const p = await createProxy({ mode, allow, denyPrivate: true, lookup });
    c.after(() => p.close());
    for (const t of connects) assert.equal(await connectVia(p.port, t), 403, `${mode} CONNECT ${t}`);
    for (const u of gets) {
      const r = await getVia(p.port, u);
      assert.deepEqual([r.status, /private address/.test(r.body)], [403, true], `${mode} GET ${u}: ${r.body}`);
    }
    const l = p.ledger();
    assert.equal(l.denyPrivate, true);
    assert.deepEqual([l.destinations.reduce((n, d) => n + d.local, 0), l.destinations.reduce((n, d) => n + d.allowed + d.denied, 0)], [connects.length + gets.length, 0], mode);
    assert.ok(l.destinations.some((d) => d.host === '192.168.65.254' && d.port === 7980));
  }
});

test('the runner allowlist loads, admits what three observed jobs dialled, and refuses what it decided against', () => {
  const allow = loadAllowlist(join(ROOT, 'container', 'runner', 'egress-allow.json'));
  const observed = ['api.github.com', 'broker.actions.githubusercontent.com', 'codeload.github.com', 'github.com', 'pipelinesghubeus24.actions.githubusercontent.com',
    'pkg.github.com', 'productionresultssa10.blob.core.windows.net', 'productionresultssa19.blob.core.windows.net', 'productionresultssa6.blob.core.windows.net',
    'results-receiver.actions.githubusercontent.com', 'run-actions-1-azure-eastus.actions.githubusercontent.com', 'run.actions.githubusercontent.com', 'token.actions.githubusercontent.com'];
  for (const h of observed) assert.ok(allowed(h, allow), h);
  for (const h of ['copilot-proxy.githubusercontent.com', 'productionresultssa25.blob.core.windows.net', 'attacker.blob.core.windows.net', 'example.com', 'gist.githubusercontent.com']) {
    assert.ok(!allowed(h, allow), `${h} is not in the runner allowlist`);
  }
});
