// A stand-in for npm in the dependency-update tests: answers view, audit, install, update, audit fix,
// ci and test from a JSON registry fixture (CW_NPM_STUB_REGISTRY), editing package.json and
// package-lock.json the way npm would for a flat tree. Every call is appended to CW_NPM_STUB_LOG.
//
// Registry fixture: { packages: { <name>: { versions: { <v>: <iso publish time> }, deprecated?: { <v>: msg },
//   dependencies?: { <v>: { <dep>: <version> } } } }, advisories: [{ name, range, severity, title, fixedIn }],
//   test?: { exit } }
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const cwd = process.cwd();
const reg = JSON.parse(readFileSync(process.env.CW_NPM_STUB_REGISTRY, 'utf8'));
if (process.env.CW_NPM_STUB_LOG) appendFileSync(process.env.CW_NPM_STUB_LOG, `${JSON.stringify({ cwd, args })}\n`);

const num = (v) => v.split('.').map(Number);
const cmp = (a, b) => { const x = num(a), y = num(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
const inRange = (v, range) => range.split('||').some((alt) => alt.trim().split(/\s+/).every((c) => {
  const m = /^(<=|>=|<|>|=)?(.+)$/.exec(c); const d = cmp(v, m[2]);
  return m[1] === '<' ? d < 0 : m[1] === '<=' ? d <= 0 : m[1] === '>' ? d > 0 : m[1] === '>=' ? d >= 0 : d === 0;
}));
const caret = (spec, v) => { const base = spec.replace(/^[\^~]/, ''); const a = num(base), b = num(v);
  return spec.startsWith('~') ? a[0] === b[0] && a[1] === b[1] && cmp(v, base) >= 0 : a[0] === b[0] && cmp(v, base) >= 0; };
const before = () => { const f = args.find((a) => a.startsWith('--before=')); return f ? Date.parse(f.slice(9)) : Infinity; };
const readLock = () => JSON.parse(readFileSync(join(cwd, 'package-lock.json'), 'utf8'));
const readPkg = () => JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
const write = (lock, pkg) => {
  writeFileSync(join(cwd, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  if (pkg) writeFileSync(join(cwd, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
};
// Set one package's version and its fixture-declared dependencies, which inherit its dev flag.
function setVersion(lock, name, v, dev) {
  lock.packages[`node_modules/${name}`] = { ...(lock.packages[`node_modules/${name}`] || {}), version: v, ...(dev ? { dev: true } : {}) };
  for (const [d, dv] of Object.entries(reg.packages[name]?.dependencies?.[v] || {})) setVersion(lock, d, dv, dev);
}
const out = (j) => process.stdout.write(`${JSON.stringify(j, null, 2)}\n`);

const [cmd, sub] = args;
if (cmd === 'view') {
  const [name, ver] = (() => { const s = args[1]; const at = s.lastIndexOf('@'); return at > 0 ? [s.slice(0, at), s.slice(at + 1)] : [s, null]; })();
  const p = reg.packages[name];
  if (!p || (ver && !p.versions[ver])) { out({ error: { code: 'E404', summary: `404 Not Found - ${args[1]}` } }); process.exit(1); }
  const versions = Object.keys(p.versions).sort(cmp);
  out({ versions, time: p.versions, 'dist-tags': { latest: versions.at(-1) }, ...(ver && p.deprecated?.[ver] ? { deprecated: p.deprecated[ver] } : {}) });
} else if (cmd === 'audit' && sub !== 'fix') {
  const lock = readLock();
  const vulnerabilities = {};
  for (const a of reg.advisories || []) {
    const node = `node_modules/${a.name}`;
    const v = lock.packages[node]?.version;
    if (!v || !inRange(v, a.range)) continue;
    vulnerabilities[a.name] = { name: a.name, severity: a.severity, isDirect: !!readPkg().devDependencies?.[a.name] || !!readPkg().dependencies?.[a.name],
      via: [{ title: a.title, url: `https://example.invalid/${a.name}`, range: a.range, severity: a.severity }], nodes: [node], fixAvailable: !!a.fixedIn };
  }
  out({ vulnerabilities, metadata: {} });
  process.exit(Object.keys(vulnerabilities).length ? 1 : 0);
} else if (cmd === 'audit' && sub === 'fix') {
  const lock = readLock();
  let left = 0;
  for (const a of reg.advisories || []) {
    const node = `node_modules/${a.name}`;
    const e = lock.packages[node];
    if (!e || !inRange(e.version, a.range)) continue;
    if (a.fixedIn) setVersion(lock, a.name, a.fixedIn, e.dev); else left++;
  }
  write(lock);
  process.exit(left ? 1 : 0);
} else if (cmd === 'install' && args.includes('--package-lock-only')) {
  const lock = readLock(); const pkg = readPkg();
  const kind = args.includes('--save-dev') ? 'devDependencies' : args.includes('--save-optional') ? 'optionalDependencies' : 'dependencies';
  const prefix = args.includes('--save-exact') ? '' : (args.find((a) => a.startsWith('--save-prefix=')) || '--save-prefix=^').slice(14);
  for (const spec of args.filter((a) => !a.startsWith('-') && a !== 'install')) {
    const at = spec.lastIndexOf('@'); const name = spec.slice(0, at); const v = spec.slice(at + 1);
    if (Date.parse(reg.packages[name].versions[v]) > before()) { process.stderr.write(`ETARGET ${spec} is newer than --before\n`); process.exit(1); }
    pkg[kind] = { ...(pkg[kind] || {}), [name]: `${prefix}${v}` };
    setVersion(lock, name, v, kind === 'devDependencies');
  }
  write(lock, pkg);
} else if (cmd === 'update') {
  const lock = readLock(); const pkg = readPkg();
  const declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  const named = args.slice(1).filter((a) => !a.startsWith('-'));
  for (const [node, e] of Object.entries(lock.packages)) {
    if (!node.startsWith('node_modules/')) continue;
    const name = node.slice(13);
    if (named.length && !named.includes(name)) continue;
    const p = reg.packages[name];
    if (!p) continue;
    const spec = declared[name] || `^${e.version}`;
    const best = Object.keys(p.versions).filter((v) => caret(spec, v) && Date.parse(p.versions[v]) <= before()).sort(cmp).at(-1);
    if (best && cmp(best, e.version) > 0) setVersion(lock, name, best, e.dev);
  }
  write(lock);
} else if (cmd === 'ci') {
  process.exit(0);
} else if (cmd === 'test') {
  process.exit(reg.test?.exit ?? 0);
} else {
  process.stderr.write(`npm stub: unhandled ${args.join(' ')}\n`);
  process.exit(9);
}
