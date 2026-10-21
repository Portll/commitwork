import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, statSync, utimesSync, symlinkSync, chmodSync, appendFileSync, realpathSync } from 'node:fs';
import { join, dirname, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  reuseConfig, sweepReuseEnv, treeFingerprint, localImportClosure, referencedEnv, reuseKey, lookup, restore, storable,
  store, compareOutputs, expandOutputs, resetReuseMemo, binaryIdentity, markerName,
} from '../lib/lane-reuse.mjs';
import { withUnreadable, ignoresPermissions } from '../../lib/fs-unreadable.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = (p) => mkdtempSync(join(tmpdir(), `cw-lane-reuse-${p}-`));
const stated = { node: { state: 'present', version: '26.0.0', versionState: 'stated' } };
const lane = (extra = {}) => ({
  id: 'fixture-pure', egress: 'none', requires: { tools: ['node'] }, report: { file: 'out.json' },
  reuse: { outputs: ['out.json', 'out.json.exit', 'out.log'] },
  local: ['node -e "1"'], ...extra,
});
const cfgFor = (cache) => ({ mode: 'on', cache, maxFiles: 1000 });
const unreadable = (t, path, fn) => {
  if (ignoresPermissions()) { t.skip('running elevated: permissions are not enforced'); return; }
  const r = withUnreadable(path, fn);
  if (!r.ran) t.skip(r.why);
};

describe('reuseConfig and sweepReuseEnv', () => {
  test('off unless a mode and a cache are both named', () => {
    assert.equal(reuseConfig({}), null);
    assert.equal(reuseConfig({ CW_LANE_REUSE: 'on' }), null);
    assert.equal(reuseConfig({ CW_LANE_CACHE: '/x' }), null);
    assert.equal(reuseConfig({ CW_LANE_REUSE: 'sometimes', CW_LANE_CACHE: '/x' }), null);
    assert.equal(reuseConfig({ CW_LANE_REUSE: 'verify', CW_LANE_CACHE: '/x' }).mode, 'verify');
  });

  test('a sweep passes off explicitly, and a cache only with a mode that uses one', () => {
    assert.deepEqual(sweepReuseEnv('off', { CW_LANE_CACHE: '/c' }, '/d'), { CW_LANE_REUSE: 'off' });
    assert.deepEqual(sweepReuseEnv('sometimes', {}, '/d'), { CW_LANE_REUSE: 'off' });
    assert.deepEqual(sweepReuseEnv('verify', {}, '/d'), { CW_LANE_REUSE: 'verify', CW_LANE_CACHE: '/d' });
    assert.deepEqual(sweepReuseEnv('on', { CW_LANE_CACHE: '/c' }, '/d'), { CW_LANE_REUSE: 'on', CW_LANE_CACHE: '/c' });
  });
});

describe('treeFingerprint', () => {
  test('moves with content, with an untracked or ignored file, and not with .git', () => {
    const d = tmp('fp');
    writeFileSync(join(d, 'a.txt'), 'one');
    const base = treeFingerprint(d).hash;
    mkdirSync(join(d, '.git'));
    writeFileSync(join(d, '.git', 'index'), 'x');
    assert.equal(treeFingerprint(d).hash, base, '.git internals changed the fingerprint');
    writeFileSync(join(d, 'node_modules.txt'), 'ignored but on disk');
    const withExtra = treeFingerprint(d).hash;
    assert.notEqual(withExtra, base);
    writeFileSync(join(d, 'a.txt'), 'two!');
    assert.notEqual(treeFingerprint(d).hash, withExtra);
  });

  test('a same-size rewrite moves it even when the old mtime is put back', () => {
    const d = tmp('fp-mtime');
    writeFileSync(join(d, 'a.txt'), 'aaa');
    utimesSync(join(d, 'a.txt'), new Date(1e9), new Date(1e9));
    const before = treeFingerprint(d).hash;
    writeFileSync(join(d, 'a.txt'), 'bbb');
    utimesSync(join(d, 'a.txt'), new Date(1e9), new Date(1e9));
    assert.notEqual(treeFingerprint(d).hash, before, 'a rewrite with its mtime restored kept the fingerprint');
  });

  test('a tree over the bound is not fingerprinted, and says why', () => {
    resetReuseMemo();
    const d = tmp('fp-big');
    for (let i = 0; i < 5; i++) writeFileSync(join(d, `f${i}`), '');
    const r = treeFingerprint(d, { maxFiles: 3 });
    assert.equal(r.ok, false);
    assert.match(r.why, /more than 3 files/);
  });

  test('a link inside the tree is keyed; one that leaves it, or enters .git, refuses', () => {
    const d = tmp('fp-link');
    writeFileSync(join(d, 'a.txt'), 'x');
    symlinkSync('a.txt', join(d, 'inside'));
    assert.equal(treeFingerprint(d).ok, true);
    const outside = tmp('fp-link-out');
    symlinkSync(outside, join(d, 'escape'));
    const r = treeFingerprint(d);
    assert.equal(r.ok, false);
    assert.match(r.why, /escape links outside the tree/);
    const g = tmp('fp-link-git');
    mkdirSync(join(g, '.git'));
    symlinkSync('.git', join(g, 'gitdir'));
    assert.equal(treeFingerprint(g).ok, false);
    const dangling = tmp('fp-link-dangling');
    symlinkSync(join(outside, 'not-yet'), join(dangling, 'later'));
    assert.equal(treeFingerprint(dangling).ok, false, 'a dangling link out of the tree was keyed');
  });

  test('an unreadable directory is no fingerprint, never a smaller one', (t) => {
    const d = tmp('fp-deny');
    mkdirSync(join(d, 'sub'));
    writeFileSync(join(d, 'sub', 'a'), 'x');
    unreadable(t, join(d, 'sub'), () => {
      const r = treeFingerprint(d);
      assert.equal(r.ok, false);
      assert.match(r.why, /sub unreadable/);
    });
  });
});

describe('lane identity', () => {
  test('localImportClosure follows relative imports to closure', () => {
    const d = tmp('imports');
    writeFileSync(join(d, 'a.mjs'), "import { b } from './b.mjs';\nconst c = await import('./c.mjs');\n");
    writeFileSync(join(d, 'b.mjs'), "export { d } from './d.mjs';\nexport const b = 1;\n");
    writeFileSync(join(d, 'c.mjs'), 'export default 1;\n');
    writeFileSync(join(d, 'd.mjs'), 'export const d = 1;\n');
    assert.deepEqual(localImportClosure(join(d, 'a.mjs')).map((f) => f.split('/').pop()), ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs']);
  });

  test('referencedEnv takes the CW_* names a command reads, minus the per-run paths', () => {
    const c = lane({ local: ['x $CW_ROOT/a "$CW_REPORT_DIR/o" ${CW_DEPTH_RANK:-3} ${CW_SEMGREP_PRO:+--pro}'], reuse: { outputs: ['o'], env: ['CW_EXTRA'] } });
    assert.deepEqual(referencedEnv(c), ['CW_DEPTH_RANK', 'CW_EXTRA', 'CW_SEMGREP_PRO']);
  });

  const fixtureRoot = () => {
    const root = tmp('key-root');
    mkdirSync(join(root, 'bin', 'lib'), { recursive: true });
    writeFileSync(join(root, 'bin', 'lib', 'sandbox.mjs'), 'export {};\n');
    writeFileSync(join(root, 'bin', 'lib', 'scanner-env.mjs'), 'export {};\n');
    writeFileSync(join(root, 'bin', 'lane.mjs'), "import './helper.mjs';\n");
    writeFileSync(join(root, 'bin', 'helper.mjs'), 'export const v = 1;\n');
    return root;
  };

  test('the key moves with every input and holds when none moves', () => {
    const repo = tmp('key-repo');
    writeFileSync(join(repo, 'src.txt'), 'x');
    const root = fixtureRoot();
    const packs = tmp('packs');
    mkdirSync(join(packs, 'codeql', 'python-queries', '1.0.0'), { recursive: true });
    const models = tmp('models');
    const check = lane({ local: ['node $CW_ROOT/bin/lane.mjs ${CW_DEPTH_RANK:-3}'], reuse: { outputs: ['out.json'], inputs: ['bin/lane.mjs'], packs: 'codeql' } });
    const env = (over = {}) => ({ CW_DEPTH_RANK: '3', CW_CODEQL_PACKAGES: packs, CW_CODEQL_MODELS: models, ...over });
    const key = (over = {}) => reuseKey({ check, repoPath: repo, tools: stated, env: env(), root, cfg: cfgFor('/x'), ...over });
    const base = key();
    assert.equal(base.ok, true, base.why);
    assert.equal(key().key, base.key, 'the key is not stable over unchanged inputs');
    assert.notEqual(key({ env: env({ CW_DEPTH_RANK: '5' }) }).key, base.key, 'a setting the command reads did not move it');
    assert.notEqual(key({ env: env({ CW_SANDBOX: 'off' }) }).key, base.key, 'the sandbox setting did not move it');
    assert.notEqual(key({ tools: { node: { ...stated.node, version: '27.0.0' } } }).key, base.key, 'the tool version did not move it');
    assert.notEqual(key({ check: { ...check, local: ['node $CW_ROOT/bin/lane.mjs --other'] } }).key, base.key, 'the lane definition did not move it');
    writeFileSync(join(root, 'bin', 'helper.mjs'), 'export const v = 2;\n');
    const helperMoved = key().key;
    assert.notEqual(helperMoved, base.key, 'a helper the lane imports did not move it');
    writeFileSync(join(root, 'bin', 'lib', 'scanner-env.mjs'), 'export const strip = 1;\n');
    const envMoved = key().key;
    assert.notEqual(envMoved, helperMoved, 'the runner env module did not move it');
    mkdirSync(join(packs, 'codeql', 'python-queries', '1.0.1'));
    const packMoved = key().key;
    assert.notEqual(packMoved, envMoved, 'a new CodeQL pack version did not move it');
    mkdirSync(join(models, 'repo'));
    writeFileSync(join(models, 'repo', 'sinks.yml'), 'extensions: []\n');
    const modelAdded = key().key;
    assert.notEqual(modelAdded, packMoved, 'a new CodeQL model file did not move it');
    writeFileSync(join(models, 'repo', 'sinks.yml'), 'extensions: [x]\n');
    assert.notEqual(key().key, modelAdded, 'an edited CodeQL model file did not move it');
  });

  test('a setting that names a file is keyed by the file, and an unreadable one refuses', (t) => {
    const repo = tmp('key-envfile');
    const root = fixtureRoot();
    const list = join(tmp('envfile'), 'exclude.txt');
    writeFileSync(list, 'node_modules\n');
    const check = lane({ reuse: { outputs: ['out.json'], env: ['CW_SCAN_EXCLUDE_DIRS'] } });
    const key = () => reuseKey({ check, repoPath: repo, tools: stated, env: { CW_SCAN_EXCLUDE_DIRS: list }, root, cfg: cfgFor('/x') });
    const before = key();
    assert.equal(before.ok, true, before.why);
    writeFileSync(list, 'node_modules\nvendor\n');
    assert.notEqual(key().key, before.key, 'the file a setting names changed and the key did not');
    unreadable(t, list, () => {
      const r = key();
      assert.equal(r.ok, false);
      assert.match(r.why, /names an unreadable file/);
    });
  });

  test('joern: the query database jars beside the launcher are keyed, and a missing one refuses', () => {
    const repo = tmp('key-joern');
    const root = fixtureRoot();
    const install = tmp('joern');
    const launcher = join(install, 'joern-scan');
    writeFileSync(launcher, '#!/bin/sh\n# 2>/tmp/joern-scan-log.txt\n');
    const check = lane({ requires: { tools: ['joern-scan'] }, reuse: { outputs: ['out.json'], env: ['CW_JOERN_SCAN'], packs: 'joern' } });
    const tools = { 'joern-scan': { state: 'present', version: '4.0.640', versionState: 'stated' } };
    const key = () => reuseKey({ check, repoPath: repo, tools, env: { CW_JOERN_SCAN: launcher }, root, cfg: cfgFor('/x') });
    const none = key();
    assert.equal(none.ok, false);
    assert.match(none.why, /joern query packs are unreadable/);
    mkdirSync(join(install, 'lib'));
    writeFileSync(join(install, 'lib', 'joernext-querydb-4.0.640.jar'), 'q1');
    const before = key();
    assert.equal(before.ok, true, before.why);
    writeFileSync(join(install, 'lib', 'joernext-querydb-4.0.646.jar'), 'q2');
    assert.notEqual(key().key, before.key, 'an updated query database kept the key');
  });

  test('an unstated version is keyed on the executable itself, and an unresolvable one refuses', () => {
    const repo = tmp('key-binary');
    const bin = tmp('bin');
    writeFileSync(join(bin, 'tool'), '#!/bin/sh\n');
    chmodSync(join(bin, 'tool'), 0o755);
    const check = lane({ requires: { tools: ['tool'] } });
    const unstated = { tool: { state: 'present', versionState: 'unstated' } };
    const k = (env) => reuseKey({ check, repoPath: repo, tools: unstated, env, root: ROOT, cfg: cfgFor('/x') });
    const a = k({ PATH: bin });
    assert.equal(a.ok, true, a.why);
    assert.equal(a.parts.tools.tool.binary.path.endsWith('/tool'), true);
    writeFileSync(join(bin, 'tool'), '#!/bin/sh\necho upgraded\n');
    assert.notEqual(k({ PATH: bin }).key, a.key, 'a replaced executable kept its key');
    const none = k({ PATH: tmp('empty-bin') });
    assert.equal(none.ok, false);
    assert.match(none.why, /tool version is not stated and its executable cannot be resolved/);
  });

  test('binaryIdentity skips a file the shell would not run', { skip: process.platform === 'win32' && 'no execute bit on Windows' }, () => {
    const first = tmp('bin-noexec');
    const second = tmp('bin-exec');
    writeFileSync(join(first, 'tool'), 'not executable');
    chmodSync(join(first, 'tool'), 0o644);
    writeFileSync(join(second, 'tool'), '#!/bin/sh\n');
    chmodSync(join(second, 'tool'), 0o755);
    const id = binaryIdentity('tool', { PATH: `${first}${delimiter}${second}` });
    assert.ok(id, 'no identity');
    assert.equal(id.path, realpathSync(join(second, 'tool')));
  });

  test('no key for a lane that may fetch, takes secrets or runs repository code', () => {
    const repo = tmp('key-live');
    const k = (extra) => reuseKey({ check: lane(extra), repoPath: repo, tools: stated, env: {}, root: ROOT, cfg: cfgFor('/x') });
    assert.match(k({ egress: 'registry' }).why, /egress is registry and nothing keys what it could fetch/);
    assert.match(k({ egress: undefined }).why, /egress is undeclared/);
    assert.match(k({ egress: 'github', reuse: { outputs: ['out.json'], packs: 'codeql' } }).why, /egress is github/);
    assert.match(k({ requires: { tools: ['node'], secrets: ['TOKEN'] } }).why, /takes secrets/);
    assert.match(k({ executesRepoCode: true }).why, /runs repository code/);
    assert.match(k({ requiresRepoTrust: true }).why, /runs repository code/);
  });

  test('no key without a present tool or a declared input', () => {
    const repo = tmp('key-refuse');
    const r1 = reuseKey({ check: lane(), repoPath: repo, tools: { node: { state: 'absent' } }, env: {}, root: ROOT, cfg: cfgFor('/x') });
    assert.equal(r1.ok, false);
    assert.match(r1.why, /node is not present/);
    const r2 = reuseKey({ check: lane({ reuse: { outputs: ['out.json'], inputs: ['bin/does-not-exist.mjs'] } }), repoPath: repo, tools: stated, env: {}, root: ROOT, cfg: cfgFor('/x') });
    assert.equal(r2.ok, false);
    assert.match(r2.why, /declared input bin\/does-not-exist.mjs is missing/);
  });

  test('an input whose import cannot be read refuses', () => {
    const repo = tmp('key-import');
    const root = fixtureRoot();
    writeFileSync(join(root, 'bin', 'lane.mjs'), "import './gone.mjs';\n");
    const r = reuseKey({ check: lane({ reuse: { outputs: ['out.json'], inputs: ['bin/lane.mjs'] } }), repoPath: repo, tools: stated, env: {}, root, cfg: cfgFor('/x') });
    assert.equal(r.ok, false);
    assert.match(r.why, /a declared input is unreadable/);
  });
});

describe('cache', () => {
  const finished = (dir, exit = '0') => {
    writeFileSync(join(dir, 'out.json'), '{"n":1}');
    writeFileSync(join(dir, 'out.json.exit'), `${exit}\n`);
    writeFileSync(join(dir, 'out.log'), 'took 3s');
  };
  const stored = () => {
    const cache = tmp('cache');
    const cfg = cfgFor(cache);
    const repo = tmp('repo');
    const first = tmp('run1');
    finished(first);
    assert.equal(store(cfg, lane(), repo, 'k1', { id: 'fixture-pure', status: 'pass', durationMs: 5 }, first).ok, true);
    return { cfg, repo, first };
  };

  test('only a completed scan is storable', () => {
    const d = tmp('storable');
    assert.equal(storable(lane(), { status: 'pass' }, d), false, 'no report');
    finished(d, '2');
    assert.equal(storable(lane(), { status: 'pass' }, d), false, 'a non-zero recorded exit');
    finished(d);
    assert.equal(storable(lane(), { status: 'fail' }, d), false, 'a failed run');
    assert.equal(storable(lane(), { status: 'pass' }, d), true);
  });

  test('store, look up and restore a copy, with a marker naming the source run', () => {
    const { cfg, repo, first } = stored();
    assert.equal(lookup(cfg, lane(), repo, 'k2').hit, false, 'a different key hit');
    const hit = lookup(cfg, lane(), repo, 'k1');
    assert.equal(hit.hit, true, hit.why);
    assert.equal(statSync(join(hit.dir, 'out.json')).ino, statSync(join(first, 'out.json')).ino, 'the cache does not share the batch file');
    assert.equal(hit.entry.result.durationMs, undefined, 'a duration was cached as if it were a result');
    const second = tmp('run2');
    const marker = restore(hit, lane(), second);
    assert.deepEqual(marker.files, ['out.json', 'out.json.exit', 'out.log']);
    assert.equal(readFileSync(join(second, 'out.json'), 'utf8'), '{"n":1}');
    assert.notEqual(statSync(join(second, 'out.json')).ino, statSync(join(hit.dir, 'out.json')).ino, 'the restored file shares the cache inode');
    appendFileSync(join(second, 'out.json'), ' edited');
    assert.equal(lookup(cfg, lane(), repo, 'k1').hit, true, 'an edit in the new batch reached the cache');
    assert.equal(JSON.parse(readFileSync(join(second, markerName(lane())), 'utf8')).from, first);
  });

  test('a cached file edited in place after it was stored is not used', () => {
    const { cfg, repo, first } = stored();
    writeFileSync(join(first, 'out.json'), '{"n":0}');
    const r = lookup(cfg, lane(), repo, 'k1');
    assert.equal(r.hit, false);
    assert.match(r.why, /out.json changed after it was stored/);
  });

  test('an unreadable entry or cached output is a miss, never a hit', (t) => {
    const { cfg, repo } = stored();
    const dir = lookup(cfg, lane(), repo, 'k1').dir;
    unreadable(t, join(dir, 'entry.json'), () => {
      const r = lookup(cfg, lane(), repo, 'k1');
      assert.equal(r.hit, false);
      assert.match(r.why, /cache entry unreadable/);
    });
    unreadable(t, join(dir, 'out.json'), () => {
      const r = lookup(cfg, lane(), repo, 'k1');
      assert.equal(r.hit, false);
      assert.match(r.why, /cached output out.json unreadable/);
    });
    writeFileSync(join(dir, 'entry.json'), '{not json');
    assert.match(lookup(cfg, lane(), repo, 'k1').why, /cache entry unreadable/);
  });

  test('an entry naming a path outside its directory, or a non-pass result, is not used', () => {
    const { cfg, repo } = stored();
    const dir = lookup(cfg, lane(), repo, 'k1').dir;
    const entry = JSON.parse(readFileSync(join(dir, 'entry.json'), 'utf8'));
    writeFileSync(join(dir, 'entry.json'), JSON.stringify({ ...entry, files: [...entry.files, '../escape'] }));
    assert.match(lookup(cfg, lane(), repo, 'k1').why, /file list is malformed/);
    writeFileSync(join(dir, 'entry.json'), JSON.stringify({ ...entry, result: { status: 'fail' } }));
    assert.match(lookup(cfg, lane(), repo, 'k1').why, /not a completed pass/);
    writeFileSync(join(dir, 'entry.json'), JSON.stringify({ ...entry, hashes: {} }));
    assert.match(lookup(cfg, lane(), repo, 'k1').why, /no hash for every file/);
    writeFileSync(join(dir, 'entry.json'), JSON.stringify({ ...entry, v: 1 }));
    assert.match(lookup(cfg, lane(), repo, 'k1').why, /format 1/);
  });

  test('compareOutputs ignores logs, names what differs, and never matches an unreadable file', (t) => {
    const cache = tmp('cmp-cache');
    const cfg = cfgFor(cache);
    const repo = tmp('cmp-repo');
    const a = tmp('cmp-a');
    finished(a);
    store(cfg, lane(), repo, 'k', { status: 'pass' }, a);
    const hit = lookup(cfg, lane(), repo, 'k');
    const b = tmp('cmp-b');
    finished(b);
    writeFileSync(join(b, 'out.log'), 'took 9s');
    assert.deepEqual(compareOutputs(hit, lane(), b), { match: true, differing: [] });
    unreadable(t, join(b, 'out.json'), () => {
      assert.deepEqual(compareOutputs(hit, lane(), b), { match: false, differing: ['out.json'] });
    });
    writeFileSync(join(b, 'out.json'), '{"n":2}');
    assert.deepEqual(compareOutputs(hit, lane(), b), { match: false, differing: ['out.json'] });
  });

  test('SARIF compares by results: artifact order and indexes do not count, a changed result does', () => {
    const sarif = (artifacts, results) => JSON.stringify({ runs: [{ tool: { driver: { name: 'CodeQL', semanticVersion: '2.27.2' } }, artifacts: artifacts.map((uri) => ({ location: { uri } })), results }] });
    const hit = (dir) => ({ dir });
    const check = { reuse: { outputs: ['x.sarif'] } };
    const a = tmp('sarif-a');
    const b = tmp('sarif-b');
    const r = (index, ruleIndex) => ({ ruleId: 'js/x', ruleIndex, message: { text: 'm' }, locations: [{ physicalLocation: { artifactLocation: { uri: index === 0 ? 'a.js' : 'b.js', index } } }] });
    writeFileSync(join(a, 'x.sarif'), sarif(['a.js', 'b.js'], [r(0, 3), r(1, 3)]));
    writeFileSync(join(b, 'x.sarif'), sarif(['b.js', 'a.js'], [r(1, 7), r(0, 7)].map((x) => ({ ...x, locations: [{ physicalLocation: { artifactLocation: { uri: x.locations[0].physicalLocation.artifactLocation.uri, index: x.locations[0].physicalLocation.artifactLocation.uri === 'a.js' ? 1 : 0 } } }] }))));
    assert.deepEqual(compareOutputs(hit(a), check, b), { match: true, differing: [] });
    writeFileSync(join(b, 'x.sarif'), sarif(['a.js', 'b.js'], [r(0, 3)]));
    assert.deepEqual(compareOutputs(hit(a), check, b), { match: false, differing: ['x.sarif'] });
  });

  test('expandOutputs matches * patterns and nothing else', () => {
    const d = tmp('glob');
    for (const f of ['joern.txt', 'joern-a.log', 'joernXlog']) writeFileSync(join(d, f), '');
    assert.deepEqual(expandOutputs(['joern.txt', 'joern-*.log', 'absent'], d), ['joern-a.log', 'joern.txt']);
  });
});
