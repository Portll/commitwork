// monitor/store-paths.mjs: where an installed tree keeps its operator records. Every case runs with
// HOME, XDG_DATA_HOME and CW_STATE_DIR set to scratch values or deleted, so nothing here reads or
// writes the operator's ~/.commitwork.
//
// An "installed tree" is a scratch directory holding the marker bin/install.sh writes, with the two
// path modules copied in, so the module's own tree is the installed one, as it is after an install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as paths from '../store-paths.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WIN = process.platform === 'win32';

const scratch = (t) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'cw-state-root-')));
  t.after(() => { try { chmodSync(d, 0o700); } catch { /* removed below */ } rmSync(d, { recursive: true, force: true }); });
  return d;
};

const withEnv = (vars, fn) => {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v === null) delete process.env[k]; else process.env[k] = v;
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
};

/** A tree bin/install.sh would have written: the marker, and the path modules at their real places. */
function installedTree(d) {
  const tree = join(d, 'prefix', 'lib', 'commitwork');
  for (const rel of ['monitor/store-paths.mjs', 'bin/lib/store-paths.mjs']) {
    mkdirSync(dirname(join(tree, rel)), { recursive: true });
    copyFileSync(join(REPO, rel), join(tree, rel));
  }
  writeFileSync(join(tree, paths.INSTALL_MARKER), 'commitwork 9.9.9\nsource directory\n');
  return tree;
}

// Every root-taking path export, evaluated in a child whose module tree is `tree`. Credential stores
// take no root and stay under ~/.commitwork by design, so they are reported apart.
const PROBE = `
const { pathToFileURL } = await import('node:url');
const [tree] = process.argv.slice(1);
const m = await import(pathToFileURL(tree + '/monitor/store-paths.mjs').href);
const b = await import(pathToFileURL(tree + '/bin/lib/store-paths.mjs').href);
const out = { stateRoot: m.stateRootFor(tree), stores: {}, credentials: { auth: m.authStorePath(), integrations: m.integrationsStorePath() } };
for (const [k, f] of Object.entries(m)) {
  if (typeof f !== 'function' || k === 'stateRootFor') continue;
  if (k === 'privateDir' || /(PathFor|DirFor|RootFor)$/.test(k)) out.stores[k] = f(tree);
}
for (const k of ['storeDir', 'touchLedger', 'realTouchLedger', 'spineLedger', 'agentTags', 'gateBaseline', 'testsBaseline']) out.stores['bin/lib:' + k] = b[k]();
console.log(JSON.stringify(out));
`;

function probe(tree, env) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CW_') && k !== 'XDG_DATA_HOME' && k !== 'HOME'));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', PROBE, tree], { encoding: 'utf8', env: { ...clean, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const under = (p, dir) => p === dir || p.startsWith(dir + sep);

test('an installed tree resolves every store under ~/.commitwork/state, at the path it had in the tree', { skip: WIN && 'POSIX HOME' }, (t) => {
  const d = scratch(t);
  const tree = installedTree(d);
  const home = join(d, 'home');
  const state = join(home, '.commitwork', 'state');
  const got = probe(tree, { HOME: home });
  assert.equal(got.stateRoot, state);
  const names = Object.keys(got.stores);
  // No vacuous pass: the export filter must have found the private records, the reports root and the
  // .claude/store ledgers, not an empty set.
  for (const k of ['privateDir', 'registryPathFor', 'issuesPathFor', 'reportsRootFor', 'nondetStoreDirFor', 'mcpEmissionsPathFor', 'mcpJobStoreDirFor', 'annotationsPathFor', 'bin/lib:storeDir']) {
    assert.ok(names.includes(k), `${k} was not probed: ${names.join(', ')}`);
  }
  assert.ok(names.length >= 30, `only ${names.length} stores probed`);
  for (const [k, p] of Object.entries(got.stores)) {
    assert.ok(under(p, state), `${k} resolved to ${p}, outside the state root ${state}`);
    assert.ok(!under(p, tree), `${k} resolved into the installed tree: ${p}`);
  }
  assert.equal(got.stores.registryPathFor, join(state, 'monitor', 'private', 'projects.json'));
  assert.equal(got.stores.reportsRootFor, join(state, 'reports'));
  assert.equal(got.stores['bin/lib:storeDir'], join(state, '.claude', 'store'));
  assert.equal(got.stores.mcpJobStoreDirFor, join(state, 'reports', 'mcp-jobs'));
  assert.equal(got.stores.nondetStoreDirFor, join(state, 'monitor', 'private', 'nondeterministic'));
  assert.equal(got.stores.mcpEmissionsPathFor, join(state, 'monitor', 'private', 'mcp-emissions.jsonl'));
  assert.deepEqual(got.credentials, { auth: join(home, '.commitwork', 'users.json'), integrations: join(home, '.commitwork', 'integrations.json') },
    'the credential stores stay where they were');
});

test('a development checkout still resolves monitor/private, reports and .claude/store inside itself', { skip: WIN && 'POSIX HOME' }, (t) => {
  const d = scratch(t);
  const got = probe(REPO, { HOME: join(d, 'home') });
  assert.equal(got.stateRoot, null);
  assert.equal(got.stores.privateDir, join(REPO, 'monitor', 'private'), 'the in-tree path, so the sidecar symlink there still applies');
  assert.equal(got.stores.registryPathFor, join(REPO, 'monitor', 'private', 'projects.json'));
  assert.equal(got.stores.reportsRootFor, join(REPO, 'reports'));
  assert.equal(got.stores['bin/lib:storeDir'], join(REPO, '.claude', 'store'));
  for (const [k, p] of Object.entries(got.stores)) assert.ok(under(p, REPO), `${k} left the checkout: ${p}`);
});

test('CW_STATE_DIR overrides both, and only for the tree the module was loaded from', { skip: WIN && 'POSIX HOME' }, (t) => {
  const d = scratch(t);
  const tree = installedTree(d);
  const to = join(d, 'chosen');
  for (const root of [tree, REPO]) {
    const got = probe(root, { HOME: join(d, 'home'), CW_STATE_DIR: to });
    assert.equal(got.stateRoot, to, root);
    for (const [k, p] of Object.entries(got.stores)) assert.ok(under(p, to), `${root} ${k}: ${p}`);
  }
  // In this process the module's tree is REPO, so a sandbox root a test names answers for itself.
  const sandbox = join(d, 'sandbox');
  withEnv({ CW_STATE_DIR: to }, () => {
    assert.equal(paths.privateDir(sandbox), join(sandbox, 'monitor', 'private'));
    assert.equal(paths.registryPathFor(sandbox, { ambient: false }), join(sandbox, 'monitor', 'private', 'projects.json'));
    assert.equal(paths.privateDir(REPO), join(to, 'monitor', 'private'));
  });
  withEnv({ CW_STATE_DIR: 'relative/state' }, () => assert.equal(paths.stateRootFor(REPO), resolve('relative/state')));
});

test('XDG_DATA_HOME: honoured while ~/.commitwork/state is absent; both present is refused', { skip: WIN && 'POSIX HOME' }, (t) => {
  const d = scratch(t);
  const tree = installedTree(d);
  const home = join(d, 'home');
  const xdg = join(d, 'xdg');
  const dot = join(home, '.commitwork', 'state');
  withEnv({ HOME: home, XDG_DATA_HOME: xdg, CW_STATE_DIR: null }, () => {
    assert.equal(paths.stateRootFor(tree), join(xdg, 'commitwork'));
    // init creates ~/.commitwork for the credential stores; that must not move the state root.
    mkdirSync(join(home, '.commitwork'), { recursive: true });
    assert.equal(paths.stateRootFor(tree), join(xdg, 'commitwork'));
    mkdirSync(dot);
    assert.equal(paths.stateRootFor(tree), dot, 'an existing ~/.commitwork/state wins');
    mkdirSync(join(xdg, 'commitwork'), { recursive: true });
    assert.throws(() => paths.stateRootFor(tree), (e) => e.message.includes(dot) && e.message.includes(join(xdg, 'commitwork')) && /CW_STATE_DIR/.test(e.message));
  });
  withEnv({ HOME: home, XDG_DATA_HOME: 'not/absolute', CW_STATE_DIR: null }, () => assert.equal(paths.stateRootFor(tree), dot));
  withEnv({ HOME: home, XDG_DATA_HOME: null, CW_STATE_DIR: null }, () => assert.equal(paths.stateRootFor(tree), dot));
});

test('the marker is read fail-closed: absent is a checkout, anything unreadable is an error', { skip: WIN && 'POSIX modes' }, (t) => {
  const d = scratch(t);
  assert.equal(paths.isInstalledTree(join(d, 'absent')), false);
  writeFileSync(join(d, 'a-file'), 'x');
  assert.equal(paths.isInstalledTree(join(d, 'a-file')), false, 'a root that is not a directory holds no marker');
  const odd = join(d, 'odd');
  mkdirSync(join(odd, paths.INSTALL_MARKER), { recursive: true });
  assert.throws(() => paths.isInstalledTree(odd), /is not a file/);
  if (process.getuid && process.getuid() !== 0) {
    const shut = join(d, 'shut');
    mkdirSync(shut);
    chmodSync(shut, 0o000);
    try { assert.throws(() => paths.stateRootFor(shut), (e) => e.code === 'EACCES'); }
    finally { chmodSync(shut, 0o700); }
  }
});

test('STATE_PATHS names the three in-tree stores, each the default of a resolver', () => {
  assert.deepEqual([...paths.STATE_PATHS], ['monitor/private', 'reports', '.claude/store']);
  assert.equal(paths.privateDir('/r'), join('/r', 'monitor', 'private'));
  assert.equal(paths.reportsRootFor('/r', { ambient: false }), join('/r', 'reports'));
});
