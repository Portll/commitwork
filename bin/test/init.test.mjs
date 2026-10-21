// bin/init.mjs: first-run state for a clone with no private store. Each case runs init as a child
// process against a scratch root (CW_INIT_ROOT), a scratch HOME and a scratch credential home
// (CW_AUTH_STORE), so nothing touches this checkout's monitor/private or the operator's ~/.commitwork.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync, statSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPTIONAL_RECORDS } from '../init.mjs';
import { loadRegistry, areaOf } from '../../monitor/registry.mjs';
import { resolveRepos } from '../../monitor/discover.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INIT = join(REPO, 'bin', 'init.mjs');

function rig(t) {
  const d = mkdtempSync(join(tmpdir(), 'cw-init-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const root = join(d, 'checkout');
  mkdirSync(join(root, 'monitor'), { recursive: true });
  const repos = join(d, 'repos');
  for (const name of ['alpha', 'beta']) {
    mkdirSync(join(repos, name), { recursive: true });
    execFileSync('git', ['init', '-q', join(repos, name)]);
  }
  const env = { ...process.env, CW_INIT_ROOT: root, HOME: join(d, 'home'), CW_AUTH_STORE: join(d, 'home', '.commitwork', 'users.json') };
  for (const k of Object.keys(env)) if (k === 'CW_REGISTRY' || k === 'CW_STATE_DIR' || k === 'XDG_DATA_HOME' || OPTIONAL_RECORDS.some((r) => r.env === k)) delete env[k];
  const run = (...args) => spawnSync(process.execPath, [INIT, ...args], { env, encoding: 'utf8' });
  return { d, root, repos, run, registry: join(root, 'monitor', 'private', 'projects.json') };
}

test('a fresh root gets a private dir, a loadable registry and the credential home', (t) => {
  const { d, root, repos, run, registry } = rig(t);
  const r = run('--root', repos, '--repo', join(repos, 'alpha'));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(statSync(join(root, 'monitor', 'private')).isDirectory());
  assert.ok(statSync(join(d, 'home', '.commitwork')).isDirectory());
  if (process.platform !== 'win32') assert.equal(statSync(join(root, 'monitor', 'private')).mode & 0o777, 0o700);
  const reg = loadRegistry({ path: registry, quiet: true });
  const { repos: resolved } = resolveRepos(reg, { selfRoot: root });
  assert.deepEqual(resolved.map((x) => x.name).sort(), ['alpha', 'beta']);
  // A discovered repo must land in a declared area, or a scoped sweep never scans it.
  for (const x of resolved) assert.equal(areaOf(x.name, reg), 'local', x.name);
});

test('a re-run keeps every existing file byte for byte', (t) => {
  const { repos, run, registry } = rig(t);
  assert.equal(run('--root', repos).status, 0);
  const before = readFileSync(registry, 'utf8');
  const r = run('--repo', join(repos, 'alpha'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(registry, 'utf8'), before);
  assert.match(r.stdout, /registry\s+\S+\s+keep/);
});

test('an invalid existing registry is refused and left untouched', (t) => {
  const { root, run, registry } = rig(t);
  mkdirSync(join(root, 'monitor', 'private'));
  writeFileSync(registry, '{ "areas": "not-an-array" }');
  const r = run();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /REFUSED/);
  assert.equal(readFileSync(registry, 'utf8'), '{ "areas": "not-an-array" }');
});

test('a refusal writes nothing at all, not the steps before it', (t) => {
  const { d, root, run } = rig(t);
  writeFileSync(join(root, 'monitor', 'private'), 'a file where the directory belongs');
  const r = run();
  assert.equal(r.status, 1);
  assert.equal(existsSync(join(d, 'home', '.commitwork')), false);
});

test('--private-dir makes monitor/private a directory link, never a file link', (t) => {
  const { d, root, run, registry } = rig(t);
  const target = join(d, 'sidecar', 'private');
  const r = run('--private-dir', target);
  assert.equal(r.status, 0, r.stderr);
  const link = join(root, 'monitor', 'private');
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.ok(statSync(link).isDirectory());
  assert.ok(existsSync(join(target, 'projects.json')));
  assert.ok(existsSync(registry));
  assert.equal(run('--private-dir', join(d, 'elsewhere')).status, 1);
});

test('--dry-run reports the plan and writes nothing', (t) => {
  const { d, root, repos, run } = rig(t);
  const r = run('--root', repos, '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /create-dir/);
  assert.equal(existsSync(join(root, 'monitor', 'private')), false);
  assert.equal(existsSync(join(d, 'home')), false);
});

test('a --repo that is not a git repository is a usage error', (t) => {
  const { d, run } = rig(t);
  mkdirSync(join(d, 'plain'));
  assert.equal(run('--repo', join(d, 'plain')).status, 2);
  assert.equal(run('--bogus').status, 2);
});

test('every optional record names an example that ships, and every shipped example is named', () => {
  for (const r of OPTIONAL_RECORDS) assert.ok(existsSync(join(REPO, r.example)), r.example);
  const shipped = ['monitor', 'cra'].flatMap((dir) => readdirSync(join(REPO, dir))
    .filter((f) => f.endsWith('.example.json')).map((f) => `${dir}/${f}`));
  // projects.example.json is the registry's own template, which init writes rather than lists.
  // release-terms.example.json is a release builder's list, read from the sidecar's committed tree.
  const named = new Set([...OPTIONAL_RECORDS.map((r) => r.example), 'monitor/projects.example.json', 'monitor/release-terms.example.json']);
  assert.deepEqual(shipped.filter((f) => !named.has(f)), []);
});

test('a development checkout says its records stay inside it', (t) => {
  const { root, run } = rig(t);
  const r = run('--dry-run');
  assert.equal(r.status, 0, r.stderr);
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a path with its regex metacharacters escaped
  assert.match(r.stdout, new RegExp(`state root\\s+${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+a development checkout`));
});

// ── an installed tree ─────────────────────────────────────────────────────────────────────────────
// A tree bin/install.sh wrote: the marker and init's own module closure, so the module's tree is the
// installed one and no CW_INIT_ROOT is involved.
const CLOSURE = ['bin/init.mjs', 'lib/is-main.mjs', 'lib/json-schema.mjs', 'monitor/lockfile.mjs', 'monitor/registry.mjs',
  'monitor/store-paths.mjs', 'schema/projects.schema.json'];

function installed(t) {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'cw-init-installed-')));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const tree = join(d, 'prefix', 'lib', 'commitwork');
  for (const rel of CLOSURE) {
    mkdirSync(dirname(join(tree, rel)), { recursive: true });
    copyFileSync(join(REPO, rel), join(tree, rel));
  }
  writeFileSync(join(tree, '.commitwork-install'), 'commitwork 9.9.9\nsource directory\n');
  const repos = join(d, 'repos');
  mkdirSync(join(repos, 'alpha'), { recursive: true });
  execFileSync('git', ['init', '-q', join(repos, 'alpha')]);
  const home = join(d, 'home');
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CW_') && k !== 'XDG_DATA_HOME'));
  const run = (args, env = {}) => spawnSync(process.execPath, [join(tree, 'bin', 'init.mjs'), ...args], { env: { ...base, HOME: home, ...env }, encoding: 'utf8' });
  return { d, tree, repos, home, state: join(home, '.commitwork', 'state'), run };
}

const snapshot = (dir) => {
  const out = [];
  const walk = (p) => { for (const n of readdirSync(p).sort()) { const f = join(p, n); out.push(f.slice(dir.length)); if (lstatSync(f).isDirectory()) walk(f); } };
  walk(dir);
  return out;
};

test('init on an installed tree writes the registry under ~/.commitwork/state, outside the tree, and says where', { skip: process.platform === 'win32' && 'POSIX HOME' }, (t) => {
  const { tree, repos, home, state, run } = installed(t);
  const before = snapshot(tree);
  const r = run(['--root', repos]);
  assert.equal(r.status, 0, r.stderr);
  const registry = join(state, 'monitor', 'private', 'projects.json');
  assert.ok(existsSync(registry), r.stdout);
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a path with its regex metacharacters escaped
  assert.match(r.stdout, new RegExp(`state root\\s+${state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+operator records for .*kept outside it`));
  assert.ok(r.stdout.includes(registry), 'the registry path printed is the one written');
  assert.deepEqual(snapshot(tree), before, 'init wrote nothing inside the installed tree');
  assert.equal(statSync(join(state, 'monitor', 'private')).mode & 0o777, 0o700);
  assert.ok(statSync(join(home, '.commitwork')).isDirectory(), 'the credential home is where it was');
  const reg = loadRegistry({ path: registry, quiet: true });
  assert.equal(reg.reportsRoot, 'reports', 'relative, so it resolves under the state root');
  const again = run(['--root', repos]);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /registry\s+\S+\s+keep/);
});

test('CW_STATE_DIR moves an installed tree\'s records; an ambiguous default is refused before anything is written', { skip: process.platform === 'win32' && 'POSIX HOME' }, (t) => {
  const { d, tree, state, run } = installed(t);
  const chosen = join(d, 'chosen');
  const r = run([], { CW_STATE_DIR: chosen });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(chosen, 'monitor', 'private', 'projects.json')));
  assert.equal(existsSync(state), false);

  const xdg = join(d, 'xdg');
  mkdirSync(join(xdg, 'commitwork'), { recursive: true });
  mkdirSync(state, { recursive: true });
  const both = run([], { XDG_DATA_HOME: xdg });
  assert.equal(both.status, 1, both.stdout + both.stderr);
  assert.match(both.stderr, /two state roots exist.*CW_STATE_DIR/);
  assert.deepEqual(readdirSync(state), []);
  assert.deepEqual(readdirSync(join(xdg, 'commitwork')), []);
  assert.equal(existsSync(join(tree, 'monitor', 'private')), false);
});

test('records left inside an installed tree are named as not read, and left alone', { skip: process.platform === 'win32' && 'POSIX HOME' }, (t) => {
  const { tree, run } = installed(t);
  mkdirSync(join(tree, 'monitor', 'private'), { recursive: true });
  writeFileSync(join(tree, 'monitor', 'private', 'projects.json'), '{"projects":[]}\n');
  const r = run([]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /not read\s+\S+monitor\/private\s+the tree reads its records from/);
  assert.equal(readFileSync(join(tree, 'monitor', 'private', 'projects.json'), 'utf8'), '{"projects":[]}\n');
});
