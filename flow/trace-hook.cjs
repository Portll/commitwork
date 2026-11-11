// C2's preload. Records ACTUAL opens and spawns. Loaded with `node -r`.
//
// CJS, and it `require`s every builtin it patches. That is not a style choice, it is the measured
// difference between a witness and a witness-shaped hole:
//
//   node --import hook.mjs   where hook.mjs does `import fs from 'node:fs'`
//     -> intercepts fs2.readFileSync and a dynamic import. MISSES `import { readFileSync }` and
//        `import * as fs`, because importing the builtin instantiates its ESM facade and freezes
//        the named bindings against the ORIGINAL functions.
//   node -r hook.cjs         (this file)
//     -> intercepts all four forms, on a deep import graph, across fs, fs/promises and
//        child_process.
//
// The named form is the commonest in this repo, so the naive hook would report an empty trace for
// most modules — and an empty trace reads as a clean run. A second witness that silently observes
// nothing is worse than none: it manufactures agreement.
//
// Shares NO extraction code with flow/static.mjs. It shares no code with flow/ at all.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const cp = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const https = require('node:https');

const OUT = process.env.CW_FLOW_TRACE;
const ROOT = process.env.CW_FLOW_ROOT || process.cwd();

// macOS reports /var/... as /private/var/... in stack frames and module URLs, so a bare
// startsWith(ROOT) drops every attribution under a tmpdir — silently, which is the failure mode this
// whole component exists to avoid. Both spellings are accepted and either one relativises.
const ROOTS = (() => {
  const set = new Set([ROOT]);
  try { set.add(fsRealpath(ROOT)); } catch { /* the literal form still works */ }
  if (ROOT.startsWith('/private/')) set.add(ROOT.slice('/private'.length));
  else set.add(`/private${ROOT}`);
  return [...set];
})();

function fsRealpath(p) {
  return require('node:fs').realpathSync(p);
}

function underRoot(abs) {
  for (const r of ROOTS) if (abs === r || abs.startsWith(`${r}/`)) return path.relative(r, abs);
  return null;
}

// ── open flags ──────────────────────────────────────────────────────────────────────────────────
// A `touches` edge is a literal whose direction C1 could not determine. The runtime CAN determine
// it, but only from an actual open: a stat or an existsSync says nothing about which way data
// moves, so those rows carry no `access` and give no edge a direction.

/** fs flags (string or O_* number) -> 'read' | 'write' | 'append' | 'readwrite'. */
function flagsAccess(flags) {
  if (flags === undefined || flags === null) return 'read';
  if (typeof flags === 'number') {
    const C = fs.constants;
    const mode = flags & 3;
    if (mode === C.O_RDWR) return 'readwrite';
    if (mode === C.O_WRONLY) return (flags & C.O_APPEND) ? 'append' : 'write';
    return 'read';
  }
  const f = String(flags);
  if (f.includes('+')) return 'readwrite';
  if (f.includes('a')) return 'append';
  if (f.includes('w')) return 'write';
  return 'read';
}

const optFlag = (o, key) => (o && typeof o === 'object' ? o[key] : undefined);

// via -> how to read the access off the call's arguments. Entries absent here are metadata.
const OPENS = {
  readFileSync: (a) => flagsAccess(optFlag(a[1], 'flag') ?? 'r'),
  readFile: (a) => flagsAccess(optFlag(a[1], 'flag') ?? 'r'),
  createReadStream: (a) => flagsAccess(optFlag(a[1], 'flags') ?? 'r'),
  writeFileSync: (a) => flagsAccess(optFlag(a[2], 'flag') ?? 'w'),
  writeFile: (a) => flagsAccess(optFlag(a[2], 'flag') ?? 'w'),
  appendFileSync: (a) => flagsAccess(optFlag(a[2], 'flag') ?? 'a'),
  appendFile: (a) => flagsAccess(optFlag(a[2], 'flag') ?? 'a'),
  createWriteStream: (a) => flagsAccess(optFlag(a[1], 'flags') ?? 'w'),
  openSync: (a) => flagsAccess(typeof a[1] === 'function' ? 'r' : a[1]),
  open: (a) => flagsAccess(typeof a[1] === 'function' ? 'r' : a[1]),
};

// ── network keys ────────────────────────────────────────────────────────────────────────────────
// The key form is the contract with C1: `<scheme>://<host>[:<port>]` for an outbound connection,
// `listen:<port>` for a server. A scheme's default port is omitted, as a URL literal omits it.
const DEFAULT_PORT = { http: 80, https: 443, ws: 80, wss: 443 };

function endpointKey(scheme, host, port) {
  const h = String(host || 'localhost').toLowerCase();
  const p = port === undefined || port === null || port === '' ? null : Number(port);
  const bracketed = h.includes(':') && !h.startsWith('[') ? `[${h}]` : h;
  if (p === null || Number.isNaN(p) || DEFAULT_PORT[scheme] === p) return `${scheme}://${bracketed}`;
  return `${scheme}://${bracketed}:${p}`;
}

function urlKey(u) {
  const url = u instanceof URL ? u : new URL(String(u));
  const scheme = url.protocol.replace(/:$/, '');
  if (!/^(https?|wss?)$/.test(scheme)) return null;     // data:, blob:, file: are not the network
  return endpointKey(scheme, url.hostname.replace(/^\[|\]$/g, ''), url.port || null);
}

/** http(s).request / .get arguments -> key. (url[, options][, cb]) or (options[, cb]). */
function httpKey(args, defScheme) {
  let base = null;
  let opts = null;
  if (typeof args[0] === 'string' || args[0] instanceof URL) {
    base = new URL(String(args[0]));
    if (args[1] && typeof args[1] === 'object') opts = args[1];
  } else if (args[0] && typeof args[0] === 'object') {
    opts = args[0];
  }
  const o = opts || {};
  if (o.socketPath) return `unix://${o.socketPath}`;
  const scheme = String(o.protocol || (base && base.protocol) || `${defScheme}:`).replace(/:$/, '');
  const host = o.hostname || o.host || (base && base.hostname.replace(/^\[|\]$/g, '')) || 'localhost';
  const port = o.port ?? (base && base.port) ?? o.defaultPort ?? null;
  return endpointKey(scheme, host, port || null);
}

/** net.connect / tls.connect / Socket#connect arguments -> key. */
function socketKey(args, scheme) {
  const a = Array.isArray(args[0]) ? args[0] : args;    // net's internal normalised-args form
  const first = a[0];
  if (first && typeof first === 'object') {
    if (first.path) return `unix://${first.path}`;
    return endpointKey(scheme, first.host || first.servername || 'localhost', first.port ?? null);
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return `unix://${first}`;
  return endpointKey(scheme, typeof a[1] === 'string' ? a[1] : 'localhost', first ?? null);
}

/** Server#listen arguments -> { key, ephemeral }. Port 0 / omitted is decided by the kernel. */
function listenKey(args) {
  const first = args[0];
  let port;
  if (first && typeof first === 'object') {
    if (first.path) return { key: `listen:unix:${first.path}`, ephemeral: false };
    if (first.port === undefined && (first.fd !== undefined || first._handle || first.handle)) return { key: 'listen:handle', ephemeral: false };
    port = first.port;
  } else if (typeof first === 'string' && !/^\d+$/.test(first)) {
    return { key: `listen:unix:${first}`, ephemeral: false };
  } else {
    port = typeof first === 'function' ? undefined : first;
  }
  const n = port === undefined || port === null ? 0 : Number(port);
  return { key: n ? `listen:${n}` : null, ephemeral: !n };
}

module.exports = { flagsAccess, endpointKey, urlKey, httpKey, socketKey, listenKey, OPENS };

if (OUT) install();

function install() {
  const appendFileSync = fs.appendFileSync;      // captured BEFORE patching, or the hook traces itself
  const writeFileSync = fs.writeFileSync;
  const mkdirSync = fs.mkdirSync;
  const unlinkSync = fs.unlinkSync;
  let busy = false;
  let emitted = 0;
  let probing = false;
  let depth = 0;                                 // network calls nest: http.request -> net -> Socket#connect
  const wrappers = new WeakSet();
  // A wrapper keeps the original's `name` and `length`: code that inspects a function (a table of fs
  // methods checked by name, a promisify keyed on length) must see the same function shape traced
  // as untraced, or the trace changes the behaviour it is measuring.
  const like = (w, orig) => {
    try {
      Object.defineProperty(w, 'name', { value: orig.name, configurable: true });
      Object.defineProperty(w, 'length', { value: orig.length, configurable: true });
    } catch { /* a frozen function property is cosmetic */ }
    wrappers.add(w);
    return w;
  };

  try { mkdirSync.call(fs, path.dirname(OUT), { recursive: true }); } catch { /* the append will report it */ }

  const emit = (row) => {
    if (busy) return;
    busy = true;
    emitted += 1;
    const full = probing ? { ...row, pid: process.pid, probe: true } : { ...row, pid: process.pid };
    try { appendFileSync.call(fs, OUT, `${JSON.stringify(full)}\n`); } catch { /* tracing must never break the traced run */ }
    busy = false;
  };

  // Attribution by stack, not by text — the whole point of an independent witness. The first frame
  // under ROOT that is not this hook is the module that made the call.
  const actorOf = () => {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 24;
    const stack = new Error().stack || '';
    Error.stackTraceLimit = limit;
    for (const line of stack.split('\n').slice(2)) {
      const m = /\(?((?:\/|file:\/\/\/)[^):]+\.[cm]?js)/.exec(line);
      if (!m) continue;
      const f = m[1].replace(/^file:\/\//, '');
      if (f === __filename) continue;
      if (f.includes('/node_modules/')) continue;
      const r = underRoot(f);
      if (r === null) continue;
      return r;
    }
    return null;
  };

  const rel = (p) => {
    let s = typeof p === 'string' ? p : (p && p.href) || String(p);
    s = s.replace(/^file:\/\//, '');
    if (!path.isAbsolute(s)) s = path.resolve(process.cwd(), s);
    return underRoot(s) ?? s;
  };

  const isPathArg = (p) => typeof p === 'string' || p instanceof URL || Buffer.isBuffer(p);

  const wrap = (obj, name, t) => {
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    const accessOf = OPENS[name];
    obj[name] = function (...args) {
      if (!isPathArg(args[0])) return orig.apply(this, args);   // an fd or a FileHandle is not a path
      const actor = actorOf();
      const at = Date.now();
      if (name === 'copyFileSync' || name === 'copyFile' || name === 'cpSync') {
        emit({ t: 'read', path: rel(args[0]), actor, via: name, access: 'read', at });
        if (isPathArg(args[1])) emit({ t: 'write', path: rel(args[1]), actor, via: name, access: 'write', at });
      } else if (accessOf) {
        let access = 'read';
        try { access = accessOf(args); } catch { /* an odd argument shape is the callee's to reject */ }
        emit({ t: access === 'read' ? 'read' : 'write', path: rel(args[0]), actor, via: name, access, at });
      } else {
        emit({ t, path: rel(args[0]), actor, via: name, at });
      }
      return orig.apply(this, args);
    };
    like(obj[name], orig);
  };

  const READS = ['readFileSync', 'readFile', 'createReadStream', 'readdirSync', 'readdir',
    'existsSync', 'statSync', 'lstatSync', 'opendirSync', 'realpathSync', 'accessSync', 'open', 'openSync'];
  const WRITES = ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'createWriteStream',
    'mkdirSync', 'mkdir', 'renameSync', 'rename', 'copyFileSync', 'copyFile', 'cpSync',
    'unlinkSync', 'unlink', 'rmSync', 'rm', 'symlinkSync', 'truncateSync', 'utimesSync'];
  const SPAWNS = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'];

  for (const n of READS) { wrap(fs, n, 'read'); wrap(fsp, n, 'read'); }
  for (const n of WRITES) { wrap(fs, n, 'write'); wrap(fsp, n, 'write'); }
  for (const n of SPAWNS) {
    const orig = cp[n];
    if (typeof orig !== 'function') continue;
    cp[n] = like(function (...args) {
      emit({ t: 'spawn', path: String(args[0]), actor: actorOf(), via: n, at: Date.now() });
      return orig.apply(this, args);
    }, orig);
  }

  // ── network ──────────────────────────────────────────────────────────────────────────────────
  // Same discipline as fs: the builtins are `require`d and patched before any ESM facade exists, so
  // `import { request } from 'node:http'` binds the wrapper. Only the OUTERMOST call of a nest is
  // recorded — http.request reaches net.createConnection and Socket#connect synchronously, and one
  // request is one edge, at the resolution the caller wrote it.
  const netWrap = (obj, name, via, keyOf) => {
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    const w = function (...args) {
      if (depth === 0) {
        let key = null;
        try { key = keyOf(args); } catch { /* unparseable target: the callee will reject it */ }
        emit({ t: 'connect', key, actor: actorOf(), via, at: Date.now() });
      }
      depth += 1;
      try { return orig.apply(this, args); } finally { depth -= 1; }
    };
    obj[name] = like(w, orig);
  };

  netWrap(net, 'connect', 'net.connect', (a) => socketKey(a, 'tcp'));
  netWrap(net, 'createConnection', 'net.createConnection', (a) => socketKey(a, 'tcp'));
  netWrap(net.Socket.prototype, 'connect', 'net.Socket.connect', (a) => socketKey(a, 'tcp'));
  netWrap(tls, 'connect', 'tls.connect', (a) => socketKey(a, 'tls'));
  netWrap(http, 'request', 'http.request', (a) => httpKey(a, 'http'));
  netWrap(http, 'get', 'http.get', (a) => httpKey(a, 'http'));
  netWrap(https, 'request', 'https.request', (a) => httpKey(a, 'https'));
  netWrap(https, 'get', 'https.get', (a) => httpKey(a, 'https'));

  const fetchDesc = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  if (fetchDesc && typeof fetchDesc.value === 'function') {
    const orig = fetchDesc.value;
    const fetch = function fetch(...args) {
      let key = null;
      try {
        const input = args[0];
        key = urlKey(input && typeof input === 'object' && !(input instanceof URL) && 'url' in input ? input.url : input);
      } catch { /* fetch rejects an unparseable URL itself */ }
      emit({ t: 'connect', key, actor: actorOf(), via: 'fetch', at: Date.now() });
      return Reflect.apply(orig, this, args);
    };
    Object.defineProperty(globalThis, 'fetch', { ...fetchDesc, value: like(fetch, orig) });
  }

  const origListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function listen(...args) {
    let k = { key: null, ephemeral: false };
    try { k = listenKey(args); } catch { /* the server rejects its own arguments */ }
    const actor = actorOf();
    if (k.key) {
      emit({ t: 'listen', key: k.key, actor, via: 'listen', at: Date.now() });
    } else if (k.ephemeral) {
      // The kernel picks the port; it is known only once bound, and the actor only now.
      const self = this;
      this.once('listening', () => {
        const addr = self.address();
        const key = addr && typeof addr === 'object' ? `listen:${addr.port}` : null;
        emit({ t: 'listen', key, actor, via: 'listen', ephemeral: true, at: Date.now() });
      });
    }
    return origListen.apply(this, args);
  };
  like(net.Server.prototype.listen, origListen);

  // Non-vacuity, written by the hook itself: a trace with no `installed` row means the preload never
  // ran, which flow/runtime.mjs reports as UNUSABLE rather than as a clean, edgeless run.
  // The probe is written with the ORIGINAL writeFileSync (untraced) and read back through the
  // PATCHED readFileSync. selfWitness is true only if that read produced a row — i.e. the patch is
  // actually on the path, not merely assigned.
  probing = true;
  try { writeFileSync.call(fs, `${OUT}.probe`, 'probe\n'); } catch { /* probe is best effort */ }
  const before = emitted;
  try { fs.readFileSync(`${OUT}.probe`, 'utf8'); } catch { /* counted either way */ }
  const selfWitness = emitted > before;

  // The same proof for the network, against a local listener on a unix socket: a pipe binds
  // synchronously, so the probe completes before the traced program's first line. Three calls go
  // through the PATCHED entry points — Server#listen, net.connect, http.request — and each must
  // produce a row. The remaining wrappers (tls, https, *.get, Socket#connect, fetch) must at least
  // be the function the program will call. Without all of it, rows of this process are refused.
  const net0 = probeNetwork();
  probing = false;
  emit({ t: 'installed', pid: process.pid, root: ROOT, node: process.version, selfWitness,
    netWitness: net0.ok, netReason: net0.reason, at: Date.now() });

  function probeNetwork() {
    const missing = [
      ['net.connect', net.connect], ['net.createConnection', net.createConnection],
      ['net.Socket.connect', net.Socket.prototype.connect], ['tls.connect', tls.connect],
      ['http.request', http.request], ['http.get', http.get], ['https.request', https.request],
      ['https.get', https.get], ['net.Server.listen', net.Server.prototype.listen],
      ['fetch', globalThis.fetch],
    ].filter(([, f]) => typeof f === 'function' && !wrappers.has(f)).map(([n]) => n);
    if (missing.length) return { ok: false, reason: `not patched: ${missing.join(', ')}` };
    const sock = process.platform === 'win32'
      ? `\\\\?\\pipe\\cw-flow-${process.pid}-${Date.now()}`
      : path.join(os.tmpdir(), `cw-flow-${process.pid}-${Date.now()}.sock`);
    const seen = [];
    let server = null;
    try {
      server = net.createServer((s) => s.destroy());
      server.on('error', () => {});
      let n = emitted;
      server.listen(sock);
      seen.push(['listen', emitted > n]);
      server.unref();
      n = emitted;
      const c = net.connect(sock);
      seen.push(['net.connect', emitted > n]);
      c.on('error', () => {});
      c.destroy();
      n = emitted;
      const req = http.request({ socketPath: sock, path: '/' });
      seen.push(['http.request', emitted > n]);
      req.on('error', () => {});
      req.destroy();
    } catch (e) {
      return { ok: false, reason: `probe threw: ${e.code || e.message}` };
    } finally {
      try { server && server.close(); } catch { /* closing a probe */ }
      if (process.platform !== 'win32') { try { unlinkSync.call(fs, sock); } catch { /* close removes it */ } }
    }
    const blind = seen.filter(([, ok]) => !ok).map(([n]) => n);
    return blind.length ? { ok: false, reason: `probe not observed: ${blind.join(', ')}` } : { ok: true, reason: null };
  }
}
