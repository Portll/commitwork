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
// Measured 2026-09-02 before any of this was written. The named form is the commonest in this repo,
// so the naive hook would have reported an empty trace for most modules — and an empty trace reads
// as a clean run. A second witness that silently observes nothing is worse than none: it
// manufactures agreement.
//
// Shares NO extraction code with flow/static.mjs. It shares no code with flow/ at all.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const cp = require('node:child_process');
const path = require('node:path');

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

if (OUT) install();

function install() {
  const appendFileSync = fs.appendFileSync;      // captured BEFORE patching, or the hook traces itself
  const writeFileSync = fs.writeFileSync;
  const mkdirSync = fs.mkdirSync;
  let busy = false;
  let emitted = 0;

  try { mkdirSync.call(fs, path.dirname(OUT), { recursive: true }); } catch { /* the append will report it */ }

  const emit = (row) => {
    if (busy) return;
    busy = true;
    emitted += 1;
    try { appendFileSync.call(fs, OUT, `${JSON.stringify(row)}\n`); } catch { /* tracing must never break the traced run */ }
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

  const wrap = (obj, name, t) => {
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    obj[name] = function (...args) {
      emit({ t, path: rel(args[0]), actor: actorOf(), via: name, at: Date.now() });
      return orig.apply(this, args);
    };
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
    cp[n] = function (...args) {
      emit({ t: 'spawn', path: String(args[0]), actor: actorOf(), via: n, at: Date.now() });
      return orig.apply(this, args);
    };
  }

  // Non-vacuity, written by the hook itself: a trace with no `installed` row means the preload never
  // ran, which flow/runtime.mjs reports as UNUSABLE rather than as a clean, edgeless run.
  // The probe is written with the ORIGINAL writeFileSync (untraced) and read back through the
  // PATCHED readFileSync. selfWitness is true only if that read produced a row — i.e. the patch is
  // actually on the path, not merely assigned.
  try { writeFileSync.call(fs, `${OUT}.probe`, 'probe\n'); } catch { /* probe is best effort */ }
  const before = emitted;
  try { fs.readFileSync(`${OUT}.probe`, 'utf8'); } catch { /* counted either way */ }
  emit({ t: 'installed', pid: process.pid, root: ROOT, node: process.version, selfWitness: emitted > before, at: Date.now() });
}
