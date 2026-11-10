// bin/egress-proxy.mjs — a loopback HTTP proxy that records, and can refuse, what a lane dials.
// bin/egress-proxy.sh is the squid in front of a resolution CONTAINER; this is the host-lane half:
// one node process per lane, CONNECT for TLS and a plain forward for http, a ledger of every
// destination asked for, and in `enforce` mode a default-deny over a declared allowlist.


// COVERAGE IS PARTIAL AND SAYS SO. A client reaches this proxy only by honouring HTTP(S)_PROXY, and
// the host sandbox still allows direct egress for a networked lane, so the ledger is what
// proxy-honouring clients asked for, never everything the lane dialled. `coverage` rides on the
// ledger. The ledger is the point: monitor/egress-suggest.mjs turns it into a suggested allowlist a
// person reviews; nothing here edits manifests/.
//

//   node bin/egress-proxy.mjs --ledger <file> [--port-file <file>] [--mode observe|enforce]
//                             [--allowlist <manifest.json>] [--lane <check id>]
//                             [--host <addr, default 127.0.0.1>] [--port <n>] [--deny-private]
//   prints the proxy URL, writes --port-file when listening (or `error: <reason>` when it cannot),
//   serves until stdin closes or SIGTERM, then writes the ledger (tmp+rename) and exits.
//   With --deny-private it also refuses private, CGNAT, benchmark, ULA, multicast and broadcast
//   destinations, for callers whose only way out is this proxy. A --host beyond loopback requires it.

// exit: 0 the ledger is written · 2 could not listen, or enforce with no usable allowlist
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { isMainModule } from '../lib/is-main.mjs';
import { validateAllowlist } from './lib/egress-conf.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';

export const COVERAGE = 'proxy-honouring clients only';
export const EXIT = Object.freeze({ ok: 0, failed: 2 });
const hostOnly = (h) => String(h || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
const DEFAULT_PORT = Object.freeze({ 'http:': 80, 'https:': 443 });

/** Does `host` fall under an allowlist entry? `.example.org` covers the domain and its subdomains; a bare host is exact. */
export function allowed(host, allow) {
  const h = hostOnly(host);
  return allow.some((a) => {
    const e = String(a.host).trim().toLowerCase();
    return e.startsWith('.') ? h === e.slice(1) || h.endsWith(e) : h === e;
  });
}

// guard: the proxy never relays to a local address / the sandbox opens loopback only for the proxy's own port, so a relay would reopen the local services it denies (expiry: never, prev: broken)
// net.BlockList matches both IPv4-mapped forms; the URL parser turns [::ffff:127.0.0.1] into [::ffff:7f00:1]
const blockList = (ranges) => { const b = new net.BlockList(); for (const [a, n] of ranges) b.addSubnet(a, n, net.isIPv6(a) ? 'ipv6' : 'ipv4'); return b; };
const LOCAL = blockList([['0.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['::', 96], ['fe80::', 10]]);
const PRIVATE = blockList([['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10], ['198.18.0.0', 15],
  ['224.0.0.0', 4], ['240.0.0.0', 4], ['fc00::', 7], ['ff00::', 8]]);
const bare = (addr) => String(addr || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
const listed = (list, addr) => { const a = bare(addr); const v = net.isIP(a); return v ? list.check(a, v === 6 ? 'ipv6' : 'ipv4') : false; };

/** Loopback, unspecified or link-local (cloud metadata lives at 169.254.169.254), in any IPv6 spelling. */
export const localAddress = (addr) => listed(LOCAL, addr);
/** RFC 1918 (Docker networks, Docker Desktop's 192.168.65/24), CGNAT, 198.18/15, ULA, multicast, and 240/4 with broadcast. */
export const privateAddress = (addr) => listed(PRIVATE, addr);
/** One of this machine's own interface addresses; seatbelt's localhost covers the host's LAN address, so a relay would reopen it. */
export function hostAddress(addr, ifaces = os.networkInterfaces()) {
  const own = new net.BlockList();
  for (const i of Object.values(ifaces).flat()) { const a = bare(i && i.address); if (net.isIP(a)) own.addAddress(a, net.isIPv6(a) ? 'ipv6' : 'ipv4'); }
  return listed(own, addr);
}
/** Why the proxy refuses to relay to `addr` ('local' | 'this host' | 'private'), or null. */
export function refusedAddress(addr, { denyPrivate = false, ifaces } = {}) {
  if (localAddress(addr)) return 'local';
  if (hostAddress(addr, ifaces)) return 'this host';
  return denyPrivate && privateAddress(addr) ? 'private' : null;
}

/** Resolve a destination once and vet every address it resolves to. { address } to connect to, or { local: why } / { error }. */
export function vetDestination(host, { lookup = dns.lookup, isLocal = refusedAddress } = {}) {
  const h = String(host || '').replace(/^\[|\]$/g, '');
  if (net.isIP(h)) { const why = isLocal(h); return Promise.resolve(why ? { local: why } : { address: h }); }
  return new Promise((done) => lookup(h, { all: true }, (err, addrs) => {
    if (err || !addrs || !addrs.length) return done({ error: (err && err.code) || 'ENOTFOUND' });
    const why = addrs.map((a) => isLocal(a.address)).find(Boolean);
    return done(why ? { local: why } : { address: addrs[0].address });
  }));
}

/** `host:port` from a CONNECT line; a port outside 1-65535 is null. */
export function connectTarget(line) {
  // the parser drops a scheme's default port, and only https:'s 443 is CONNECT's own default
  let u; try { u = new URL(`https://${String(line)}`); } catch { return null; }
  const port = Number(u.port || 443);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !u.hostname) return null;
  return { host: u.hostname, port };
}

/** The entries that apply to a lane: the manifest's `allow` plus `lanes[<id>]`, each validated. */
export function loadAllowlist(path, lane = null) {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const entries = [...validateAllowlist(doc)];
  if (lane && doc.lanes && doc.lanes[lane]) entries.push(...validateAllowlist({ allow: doc.lanes[lane] }));
  return entries;
}

const loopbackHost = (h) => h === 'localhost' || /^127\./.test(h) || h === '::1';

/** Start the proxy on `host` (127.0.0.1). Resolves { server, port, url, ledger, close }. `isLocal` is a test seam the CLI never sets. */
export function createProxy({ mode = 'observe', allow = [], host = '127.0.0.1', port = 0, denyPrivate = false, lookup = dns.lookup, isLocal = (a) => refusedAddress(a, { denyPrivate }) } = {}) {
  if (!['observe', 'enforce'].includes(mode)) throw new Error(`egress-proxy: mode ${JSON.stringify(mode)} is not observe|enforce`);
  if (mode === 'enforce' && !allow.length) throw new Error('egress-proxy: enforce with an empty allowlist would refuse everything and read as a dead network');
  if (!loopbackHost(host) && !denyPrivate) throw new Error(`egress-proxy: listening on ${host} serves other machines, and relaying them into private ranges needs --deny-private`);
  const seen = new Map();
  const record = (host, p, outcome) => {
    const key = `${hostOnly(host)}:${p}`;
    const row = seen.get(key) || { host: hostOnly(host), port: Number(p), allowed: 0, denied: 0, local: 0 };
    row[outcome]++;
    seen.set(key, row);
  };
  const decide = (host) => mode === 'observe' || allowed(host, allow);
  const server = http.createServer((req, res) => {
    let target;
    try { target = new URL(req.url); } catch { target = null; }
    if (!target || !Object.hasOwn(DEFAULT_PORT, target.protocol)) { res.writeHead(400); res.end('egress-proxy: absolute http(s) URL required'); return; }
    const p = Number(target.port || DEFAULT_PORT[target.protocol]);
    if (!decide(target.hostname)) { record(target.hostname, p, 'denied'); res.writeHead(403, { 'content-type': 'text/plain' }); res.end(`egress-proxy: ${target.hostname} is not in the allowlist\n`); return; }
    vetDestination(target.hostname, { lookup, isLocal }).then((v) => {
      if (v.local) { record(target.hostname, p, 'local'); res.writeHead(403, { 'content-type': 'text/plain' }); res.end(`egress-proxy: ${target.hostname} is a ${v.local} address\n`); return; }
      record(target.hostname, p, 'allowed');
      if (v.error) { res.writeHead(502); res.end(`egress-proxy: ${v.error}\n`); return; }
      const up = http.request({ host: v.address, port: p, method: req.method, path: `${target.pathname}${target.search}`, headers: { ...req.headers, host: target.host } }, (r) => {
        res.writeHead(r.statusCode, r.headers); r.pipe(res);
      });
      up.on('error', (e) => { if (!res.headersSent) res.writeHead(502); res.end(`egress-proxy: ${e.code || e.message}\n`); });
      req.pipe(up);
    });
  });
  // a CONNECT tunnel is detached from the HTTP server, and server.close() waits for it to end
  const open = new Set();
  server.on('connection', (s) => { open.add(s); s.on('close', () => open.delete(s)); });
  server.on('connect', (req, socket, head) => {
    socket.on('error', () => {});
    const t = connectTarget(req.url);
    if (!t) { socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n'); return; }
    if (!decide(t.host)) { record(t.host, t.port, 'denied'); socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); return; }
    vetDestination(t.host, { lookup, isLocal }).then((v) => {
      if (v.local) { record(t.host, t.port, 'local'); socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); return; }
      record(t.host, t.port, 'allowed');
      if (v.error) { socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'); return; }
      const up = net.connect(t.port, v.address, () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head && head.length) up.write(head); up.pipe(socket); socket.pipe(up); });
      up.on('error', () => { try { socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'); } catch { /* peer gone */ } });
      socket.on('close', () => up.destroy());
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const bound = server.address().port;
      resolve({
        server, port: bound, url: `http://${net.isIPv6(host) ? `[${host}]` : host}:${bound}`,
        ledger: () => ({ mode, coverage: COVERAGE, denyPrivate, destinations: [...seen.values()].sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port) }),
        close: () => new Promise((done) => { server.close(() => done()); for (const s of open) s.destroy(); }),
      });
    });
  });
}


if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const take = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const ledgerPath = take('--ledger');
  const mode = take('--mode') || 'observe';
  // a synchronous parent cannot see this process exit, so a startup failure is written where it waits
  const fail = (msg) => {
    console.error(`egress-proxy: ${msg}`);
    if (take('--port-file')) { try { writeAtomic(take('--port-file'), `error: ${msg}\n`, { mkdir: true }); } catch { /* the parent times out instead */ } }
    process.exitCode = EXIT.failed;
  };
  if (!ledgerPath) fail('--ledger <file> is required');
  else {
    let allow = [];
    let proxyP = null;
    try {
      if (mode === 'enforce') allow = loadAllowlist(take('--allowlist'), take('--lane') || null);
      const port = argv.includes('--port') ? Number(take('--port')) : 0;
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port ${JSON.stringify(take('--port'))} is not 0-65535`);
      const host = argv.includes('--host') ? take('--host') : '127.0.0.1';
      if (!host || !(net.isIP(host) || host === 'localhost')) throw new Error(`--host ${JSON.stringify(host)} is not an IP address`);
      proxyP = createProxy({ mode, allow, host, port, denyPrivate: argv.includes('--deny-private') });
    } catch (e) { fail(e.message); }
    if (proxyP) {
      proxyP.then((proxy) => {
        if (take('--port-file')) writeAtomic(take('--port-file'), `${proxy.port}\n`, { mkdir: true });
        console.log(proxy.url);
        let stopping = false;
        const stop = () => {
          if (stopping) return; stopping = true;
          writeAtomic(ledgerPath, `${JSON.stringify({ lane: take('--lane') || null, ...proxy.ledger() }, null, 2)}\n`, { mkdir: true });
          proxy.close().then(() => process.exit(EXIT.ok));
          setTimeout(() => process.exit(EXIT.ok), 2000).unref();
        };
        process.on('SIGTERM', stop); process.on('SIGINT', stop);
        process.stdin.on('end', stop); process.stdin.on('error', stop); process.stdin.resume();
      }, (e) => { fail(`cannot listen: ${e.message}`); process.exit(EXIT.failed); });
    }
  }
}
