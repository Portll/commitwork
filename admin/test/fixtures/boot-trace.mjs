// Preload (node --import) that records a process's filesystem writes, listens and spawns as JSON
// lines in $CW_BOOT_TRACE. Builtin ESM named imports are live bindings of the CJS exports, which
// is why patching the CJS object and then syncBuiltinESMExports() reaches `import { x } from 'node:fs'`.
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const net = require('node:net');
const cp = require('node:child_process');

// opened before anything is wrapped, and written with writeSync, which is never wrapped
const FD = fs.openSync(process.env.CW_BOOT_TRACE, 'a');
const rec = (o) => { try { fs.writeSync(FD, `${JSON.stringify(o)}\n`); } catch { /* tracing never changes behaviour */ } };
const p = (x) => {
  if (x == null || typeof x === 'number') return null;
  if (x instanceof URL) return x.pathname;
  return resolve(Buffer.isBuffer(x) ? x.toString() : String(x));
};

// write-class calls, and which arguments are the paths written
const WRITES = {
  writeFile: [0], appendFile: [0], mkdir: [0], mkdtemp: [0], rename: [0, 1], rm: [0], rmdir: [0],
  unlink: [0], copyFile: [1], cp: [1], symlink: [1], link: [1], truncate: [0], chmod: [0],
  utimes: [0], lchown: [0], chown: [0],
};
const writeFlags = (f) => (typeof f === 'number'
  ? (f & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_TRUNC)) !== 0
  : /[wa+x]/.test(String(f ?? 'r')));

const wrap = (obj, name, pathsOf) => {
  const orig = obj[name];
  if (typeof orig !== 'function') return;
  obj[name] = function traced(...args) {
    for (const path of pathsOf(args)) if (path) rec({ kind: 'write', call: name, path });
    return orig.apply(this, args);
  };
};
for (const [base, idx] of Object.entries(WRITES)) {
  const pick = (args) => idx.map((i) => p(args[i]));
  wrap(fs, base, pick);
  wrap(fs, `${base}Sync`, pick);
  wrap(fs.promises, base, pick);
}
wrap(fs, 'cpSync', (a) => [p(a[1])]);
for (const name of ['open', 'openSync']) wrap(fs, name, (a) => (writeFlags(a[1]) ? [p(a[0])] : []));
wrap(fs.promises, 'open', (a) => (writeFlags(a[1]) ? [p(a[0])] : []));
wrap(fs, 'createWriteStream', (a) => [p(a[0])]);

const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function traced(...args) {
  this.once('listening', () => { const a = this.address(); rec({ kind: 'listen', port: a && a.port, requested: typeof args[0] === 'object' ? args[0]?.port : args[0] }); });
  return listen.apply(this, args);
};

for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  const orig = cp[name];
  cp[name] = function traced(...args) {
    rec({ kind: 'spawn', call: name, cmd: String(args[0]), args: Array.isArray(args[1]) ? args[1].map(String) : [] });
    return orig.apply(this, args);
  };
}

syncBuiltinESMExports();
