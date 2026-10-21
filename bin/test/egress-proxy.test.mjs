import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProxy, allowed, loadAllowlist, localAddress, connectTarget, COVERAGE, EXIT } from '../egress-proxy.mjs';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), '..', 'egress-proxy.mjs');

function target() {
  return new Promise((done) => {
    const hits = [];
    const srv = http.createServer((req, res) => { hits.push(req.url); res.end('target says hi'); });
    srv.listen(0, '127.0.0.1', () => done({ port: srv.address().port, hits, close: () => new Promise((r) => srv.close(r)) }));
  });
}
const viaProxy = (proxyPort, url) => new Promise((done, fail) => {
  const u = new URL(url);
  const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'GET', path: url, headers: { host: u.host } }, (res) => {
    let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => done({ status: res.statusCode, body }));
  });
  req.setTimeout(10_000, () => req.destroy(new Error(`no answer for ${url} within 10s`)));
  req.on('error', fail); req.end();
});
const connectVia = (proxyPort, hostPort) => new Promise((done, fail) => {
  const s = net.connect(proxyPort, '127.0.0.1', () => s.write(`CONNECT ${hostPort} HTTP/1.1\r\nHost: ${hostPort}\r\n\r\n`));
  let head = '';
  s.on('data', (d) => { head += d; if (head.includes('\r\n\r\n')) { const status = Number(head.split(' ')[1]); s.destroy(); done(status); } });
  s.setTimeout(10_000, () => { s.destroy(); fail(new Error(`no CONNECT answer for ${hostPort} within 10s`)); });
  s.on('error', fail);
});
const proxy = async (c, opts) => { const p = await createProxy(opts); c.after(() => p.close()); return p; };

test('allowed: a dotted entry covers the domain and its subdomains, a bare one is exact, ports are ignored', () => {
  const allow = [{ host: '.repo1.maven.org' }, { host: 'plugins-artifacts.gradle.org' }];
  assert.ok(allowed('repo1.maven.org', allow) && allowed('x.repo1.maven.org:443', allow) && allowed('PLUGINS-ARTIFACTS.gradle.org', allow));
  assert.ok(!allowed('evilrepo1.maven.org', allow) && !allowed('gradle.org', allow) && !allowed('example.invalid', allow));
});

test('observe records every destination and refuses nothing; enforce refuses an unlisted host before any connection, both over plain HTTP and CONNECT', async (c) => {
  const t = await target(); c.after(() => t.close());
  // the forwarding path is exercised against a loopback fixture, so these proxies are told nothing is local
  const notLocal = () => false;
  const obs = await proxy(c, { mode: 'observe', isLocal: notLocal });
  {
    const r = await viaProxy(obs.port, `http://127.0.0.1:${t.port}/a`);
    assert.deepEqual([r.status, r.body], [200, 'target says hi']);
    assert.equal(await connectVia(obs.port, `127.0.0.1:${t.port}`), 200);
    assert.equal(await connectVia(obs.port, 'cw-egress-canary.invalid:443'), 502, 'observe lets the attempt through and the connection fails on its own');
    const l = obs.ledger();
    assert.equal(l.coverage, COVERAGE);
    assert.deepEqual(l.destinations.map((d) => `${d.host}:${d.port}=${d.allowed}/${d.denied}`), [`127.0.0.1:${t.port}=2/0`, 'cw-egress-canary.invalid:443=1/0']);
  }

  const enf = await proxy(c, { mode: 'enforce', allow: [{ host: '127.0.0.1' }], isLocal: notLocal });
  {
    assert.equal((await viaProxy(enf.port, `http://127.0.0.1:${t.port}/b`)).status, 200);
    const refused = await viaProxy(enf.port, 'http://cw-egress-canary.invalid/x');
    assert.equal(refused.status, 403);
    assert.equal(await connectVia(enf.port, 'cw-egress-canary.invalid:443'), 403);
    assert.deepEqual(enf.ledger().destinations.map((d) => `${d.host}:${d.port}=${d.allowed}/${d.denied}`), [`127.0.0.1:${t.port}=1/0`, 'cw-egress-canary.invalid:80=0/1', 'cw-egress-canary.invalid:443=0/1']);
    assert.deepEqual(t.hits, ['/a', '/b'], 'the refused request never reached a server');
  }
  assert.throws(() => createProxy({ mode: 'enforce', allow: [] }), /empty allowlist/);
  assert.throws(() => createProxy({ mode: 'audit' }), /observe\|enforce/);
});

test('loadAllowlist: the manifest allow plus a lane\'s own entries, each validated; a lane needs a reason too', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-egress-al-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const p = join(d, 'allow.json');
  writeFileSync(p, JSON.stringify({ allow: [{ host: '.registry.npmjs.org', why: 'the npm registry, where every package in a lockfile resolves' }], lanes: { 'deps-osv': [{ host: 'api.osv.dev', why: 'the advisory API osv-scanner queries for every package' }] } }));
  assert.deepEqual(loadAllowlist(p).map((a) => a.host), ['.registry.npmjs.org']);
  assert.deepEqual(loadAllowlist(p, 'deps-osv').map((a) => a.host), ['.registry.npmjs.org', 'api.osv.dev']);
  writeFileSync(p, JSON.stringify({ allow: [{ host: '.registry.npmjs.org', why: 'the npm registry, where every package in a lockfile resolves' }], lanes: { x: [{ host: 'a.example', why: 'short' }] } }));
  assert.throws(() => loadAllowlist(p, 'x'), /no usable reason/);
});

test('CLI: writes the port file when listening, serves, and writes the ledger on SIGTERM', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-egress-cli-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const portFile = join(d, 'port'); const ledger = join(d, 'ledger.json');
  const child = spawn(process.execPath, [TOOL, '--ledger', ledger, '--port-file', portFile, '--lane', 'fixture-lane'], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const started = Date.now();
  while (!existsSync(portFile) && Date.now() - started < 5000) await new Promise((r) => setTimeout(r, 20));
  assert.ok(existsSync(portFile), 'no port file within 5s');
  const port = Number(readFileSync(portFile, 'utf8').trim());
  const tg = await target(); t.after(() => tg.close());
  assert.equal((await viaProxy(port, `http://127.0.0.1:${tg.port}/cli`)).status, 403, 'the CLI proxy refuses loopback');
  assert.deepEqual(tg.hits, []);
  const exit = new Promise((r) => child.on('exit', (code) => r(code)));
  child.kill('SIGTERM');
  assert.equal(await exit, EXIT.ok);
  const l = JSON.parse(readFileSync(ledger, 'utf8'));
  assert.deepEqual([l.lane, l.mode, l.coverage, l.destinations.length, l.destinations[0].local, l.destinations[0].allowed], ['fixture-lane', 'observe', COVERAGE, 1, 1, 0]);
  const badPort = join(d, 'bad-port');
  const bad = spawn(process.execPath, [TOOL, '--ledger', join(d, 'l2.json'), '--mode', 'enforce', '--port-file', badPort], { stdio: ['pipe', 'pipe', 'pipe'] });
  assert.equal(await new Promise((r) => bad.on('exit', r)), EXIT.failed, 'enforce without an allowlist file refuses to start');
  assert.match(readFileSync(badPort, 'utf8'), /^error: /, 'a synchronous parent reads the failure where it waits for the port');
});

test('the proxy never relays to a loopback, unspecified or link-local address, however the name resolves, in either mode', async (c) => {
  const t = await target(); c.after(() => t.close());
  const lookup = (host, opts, cb) => (host === 'rebinds.test' ? cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }])
    : host === 'meta.test' ? cb(null, [{ address: '169.254.169.254', family: 4 }]) : cb(Object.assign(new Error('nx'), { code: 'ENOTFOUND' })));
  for (const mode of ['observe', 'enforce']) {
    const p = await proxy(c, { mode, allow: [{ host: '127.0.0.1' }, { host: 'rebinds.test' }, { host: 'meta.test' }, { host: '::1' }], lookup });
    {
      assert.equal((await viaProxy(p.port, `http://127.0.0.1:${t.port}/x`)).status, 403, mode);
      assert.equal(await connectVia(p.port, `127.0.0.1:${t.port}`), 403, mode);
      assert.equal((await viaProxy(p.port, `http://rebinds.test:${t.port}/y`)).status, 403, `${mode}: one local answer among several refuses the name`);
      assert.equal(await connectVia(p.port, 'meta.test:80'), 403, `${mode}: the metadata address`);
      assert.equal(await connectVia(p.port, `[::1]:${t.port}`), 403, `${mode}: ipv6 loopback`);
      const local = p.ledger().destinations.reduce((n, d) => n + d.local, 0);
      assert.equal(local, 5, JSON.stringify(p.ledger().destinations));
    }
  }
  assert.deepEqual(t.hits, [], 'no request reached the loopback service');
  for (const a of ['127.0.0.1', '127.9.9.9', '0.0.0.0', '169.254.169.254', '::1', '::', 'fe80::1', '::ffff:127.0.0.1', '[::1]']) assert.ok(localAddress(a), a);
  for (const a of ['93.184.216.34', '10.0.0.1', '192.168.1.1', '2606:4700::1']) assert.ok(!localAddress(a), a);
});

test('a CONNECT with an impossible port is a 400, and the proxy keeps serving', async (c) => {
  const p = await proxy(c, { mode: 'observe' });
  {
    assert.equal(await connectVia(p.port, 'example.invalid:99999'), 400);
    assert.equal(await connectVia(p.port, 'example.invalid:0'), 400);
    assert.equal(await connectVia(p.port, 'cw-egress-canary.invalid:443'), 502, 'still serving after the bad lines');
    assert.deepEqual(connectTarget('[::1]:443'), { host: '[::1]', port: 443 });
    assert.equal(connectTarget('host:65536'), null);
  }
});

test('close ends an open CONNECT tunnel rather than waiting for it', async (c) => {
  const t = await target(); c.after(() => t.close());
  const p = await createProxy({ mode: 'observe', isLocal: () => false });
  const s = net.connect(p.port, '127.0.0.1', () => s.write(`CONNECT 127.0.0.1:${t.port} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`));
  s.on('error', () => {}); c.after(() => s.destroy());
  assert.match(String(await new Promise((r) => s.once('data', r))), /^HTTP\/1\.1 200/);
  const outcome = await Promise.race([p.close().then(() => 'closed'), new Promise((r) => setTimeout(() => r('still waiting'), 5000).unref())]);
  assert.equal(outcome, 'closed');
});
