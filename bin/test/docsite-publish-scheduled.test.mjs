// The scheduled docsite publish: it builds from committed content only, refuses on a failed check,
// records every attempt, and skips a ref that is already live. Every command is a fake runner, so
// nothing is deployed and nothing touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishScheduled, readLedger, bundleDigest, statusLines, EXIT } from '../docsite-publish-scheduled.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docsite-publish-scheduled.mjs');
const HOOKS = mkdtempSync(join(tmpdir(), 'cw-dps-hooks-'));

const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid',
  '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${HOOKS}`, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const write = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };

function fixtureRepo(files = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'cw-dps-repo-'));
  git(repo, 'init', '-q', '-b', 'main');
  write(repo, 'docsite/manifest.json', '{"docs":[]}\n');
  write(repo, 'bin/test/docsite-example.test.mjs', '// placeholder suite\n');
  for (const [rel, text] of Object.entries(files)) write(repo, rel, text);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  return repo;
}

const commit = (repo, rel, text) => { write(repo, rel, text); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', `edit ${rel}`); return git(repo, 'rev-parse', 'HEAD'); };

// A runner that answers per stage; `bundle` writes `opts.bundle` into the dist dir it was given.
function fakeRunner(opts = {}) {
  const calls = [];
  const run = (stage, argv, { cwd, env }) => {
    calls.push({ stage, argv, cwd, env });
    if (opts.inspect) opts.inspect(stage, { argv, cwd, env });
    const status = (opts.fail || {})[stage];
    if (status) return { status, stdout: `${stage} said no`, stderr: '', error: null };
    if (stage === 'bundle') for (const [rel, text] of Object.entries(opts.bundle || { 'index.html': 'v1' })) write(env.CW_DOCSITE_DIST, rel, text);
    if (stage === 'deploy') return { status: 0, stdout: opts.deployOut ?? 'Deployment complete! Take a peek over at https://1a2b3c4d.example-project.pages.dev\nedge cache: purged', stderr: '', error: null };
    return { status: 0, stdout: 'ok', stderr: '', error: null };
  };
  return { run, calls, stages: () => calls.map((c) => c.stage) };
}

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

// Each test gets its own ledger and no private root unless it builds one.
const scope = (extra = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-dps-ledger-'));
  return { ledger: join(dir, 'attempts.jsonl'), vars: { CW_DOCSITE_PUBLISH_LEDGER: join(dir, 'attempts.jsonl'), CW_DOCSITE_PRIVATE: join(dir, 'absent'), CW_NOW: '2026-10-08T00:00:00.000Z', ...extra } };
};
const quiet = () => {};

test('the export carries committed content only, and a publish is recorded with its deployment', () => {
  const repo = fixtureRepo({ 'docsite/content/a.md': 'committed\n' });
  write(repo, 'docsite/content/a.md', 'UNCOMMITTED EDIT\n');
  write(repo, 'docsite/content/untracked.md', 'never committed\n');
  const { ledger, vars } = scope();
  const seen = {};
  const f = fakeRunner({ inspect: (stage, { cwd }) => {
    if (stage !== 'build') return;
    seen.a = readFileSync(join(cwd, 'docsite', 'content', 'a.md'), 'utf8');
    seen.untracked = existsSync(join(cwd, 'docsite', 'content', 'untracked.md'));
    seen.cwd = cwd;
  } });
  const r = withEnv(vars, () => publishScheduled({ repo, run: f.run, log: quiet }));
  assert.equal(r.code, EXIT.OK);
  assert.equal(seen.a, 'committed\n', 'the build read the committed bytes, not the working tree');
  assert.equal(seen.untracked, false);
  assert.notEqual(seen.cwd, repo);
  assert.ok(!existsSync(seen.cwd), 'the export is removed afterwards');
  assert.deepEqual(f.stages(), ['build', 'doctor', 'tests', 'bundle', 'deploy']);
  const [rec] = readLedger(ledger);
  assert.deepEqual({ ok: rec.ok, result: rec.result, sha: rec.sha, deploymentId: rec.deploymentId, at: rec.at, ref: rec.ref, privateTree: rec.privateTree },
    { ok: true, result: 'published', sha: git(repo, 'rev-parse', 'HEAD'), deploymentId: '1a2b3c4d', at: '2026-10-08T00:00:00.000Z', ref: 'main', privateTree: null });
  assert.equal(rec.edgeCache, 'purged');
  assert.match(rec.bundleDigest, /^[0-9a-f]{64}$/);
});

test('the stages run the export\'s own scripts, and the suites see no private root or deploy target', () => {
  const repo = fixtureRepo();
  const { vars } = scope({ CW_WRANGLER: '/somewhere/wrangler', CW_CLOUDFLARE_ZONE_ID: 'zone', CW_DOCSITE_ROOT: '/operator/fixture' });
  const f = fakeRunner();
  withEnv(vars, () => publishScheduled({ repo, run: f.run, log: quiet }));
  const by = Object.fromEntries(f.calls.map((c) => [c.stage, c]));
  assert.deepEqual(by.build.argv.map((a) => basename(a)), ['docsite-build.mjs', '--check']);
  assert.ok(by.build.argv[0].startsWith(by.build.cwd), 'build runs from the export');
  assert.equal(basename(by.doctor.argv[0]), 'docs-doctor.mjs');
  assert.equal(by.doctor.env.CW_DOCS_CACHE, '0');
  assert.deepEqual(by.tests.argv.slice(0, 2), ['--test', '--test-reporter=tap']);
  assert.equal(basename(by.tests.argv[2]), 'docsite-example.test.mjs');
  for (const k of ['CW_DOCSITE_PRIVATE', 'CW_WRANGLER', 'CW_CLOUDFLARE_ZONE_ID', 'CW_DOCSITE_ROOT']) assert.equal(by.tests.env[k], undefined, `${k} reaches the suites`);
  assert.equal(by.tests.env.CW_DOCSITE_NO_PURGE, '1');
  assert.deepEqual(by.bundle.argv.slice(1), ['--dry-run']);
  assert.equal(by.deploy.argv.length, 1, 'the deploy is docsite-publish.mjs with no flag');
  assert.equal(by.deploy.env.CW_WRANGLER, '/somewhere/wrangler', 'the deploy keeps the operator\'s wrangler');
  assert.equal(by.deploy.env.CW_DOCSITE_ROOT, undefined);
});

test('an unchanged ref is skipped without running anything or writing a record', () => {
  const repo = fixtureRepo();
  const { ledger, vars } = scope();
  withEnv(vars, () => publishScheduled({ repo, run: fakeRunner().run, log: quiet }));
  const before = readFileSync(ledger, 'utf8');
  const f = fakeRunner();
  const r = withEnv(vars, () => publishScheduled({ repo, run: f.run, log: quiet }));
  assert.equal(r.code, EXIT.OK);
  assert.equal(r.skipped, 'live');
  assert.equal(f.calls.length, 0);
  assert.equal(readFileSync(ledger, 'utf8'), before);
});

test('a new commit whose bundle is byte-identical is recorded unchanged and not deployed', () => {
  const repo = fixtureRepo();
  const { ledger, vars } = scope();
  withEnv(vars, () => publishScheduled({ repo, run: fakeRunner().run, log: quiet }));
  commit(repo, 'README.md', 'unrelated\n');
  const f = fakeRunner();
  const r = withEnv(vars, () => publishScheduled({ repo, run: f.run, log: quiet }));
  assert.equal(r.code, EXIT.OK);
  assert.ok(!f.stages().includes('deploy'));
  const recs = readLedger(ledger);
  assert.equal(recs.length, 2);
  assert.equal(recs[1].result, 'unchanged');
  assert.equal(recs[1].deploymentId, '1a2b3c4d', 'the live deployment is still the earlier one');
  // and a changed bundle does deploy
  commit(repo, 'docsite/content/b.md', 'new page\n');
  const g = fakeRunner({ bundle: { 'index.html': 'v2' } });
  withEnv(vars, () => publishScheduled({ repo, run: g.run, log: quiet }));
  assert.ok(g.stages().includes('deploy'));
});

test('a failed check refuses, names the stage, never deploys, and is not re-run until --force', () => {
  const repo = fixtureRepo();
  const { ledger, vars } = scope();
  const f = fakeRunner({ fail: { tests: 1 } });
  const r = withEnv(vars, () => publishScheduled({ repo, run: f.run, log: quiet }));
  assert.equal(r.code, EXIT.REFUSED);
  assert.deepEqual(f.stages(), ['build', 'doctor', 'tests']);
  const [rec] = readLedger(ledger);
  assert.deepEqual([rec.ok, rec.result, rec.stage], [false, 'refused', 'tests']);
  assert.match(rec.error, /tests said no/);

  const again = fakeRunner();
  const r2 = withEnv(vars, () => publishScheduled({ repo, run: again.run, log: quiet }));
  assert.equal(r2.code, EXIT.REFUSED);
  assert.equal(again.calls.length, 0, 'the same inputs fail the same way; nothing re-runs');
  assert.equal(readLedger(ledger).length, 1);

  const forced = fakeRunner();
  const r3 = withEnv(vars, () => publishScheduled({ repo, run: forced.run, force: true, log: quiet }));
  assert.equal(r3.code, EXIT.OK);
  assert.equal(readLedger(ledger).at(-1).result, 'published');
});

for (const stage of ['build', 'doctor', 'bundle']) {
  test(`a failure at ${stage} refuses before the deploy`, () => {
    const repo = fixtureRepo();
    const { ledger, vars } = scope();
    const f = fakeRunner({ fail: { [stage]: 2 } });
    assert.equal(withEnv(vars, () => publishScheduled({ repo, run: f.run, log: quiet })).code, EXIT.REFUSED);
    assert.ok(!f.stages().includes('deploy'));
    assert.equal(readLedger(ledger)[0].stage, stage);
  });
}

test('an export with no docsite suites is refused, not passed', () => {
  const repo = fixtureRepo();
  git(repo, 'rm', '-q', 'bin/test/docsite-example.test.mjs');
  git(repo, 'commit', '-q', '-m', 'drop suite');
  const { ledger, vars } = scope();
  const r = withEnv(vars, () => publishScheduled({ repo, run: fakeRunner().run, log: quiet }));
  assert.equal(r.code, EXIT.REFUSED);
  assert.equal(readLedger(ledger)[0].stage, 'tests');
});

test('a deploy that names no deployment is a failure, and is retried on the next run', () => {
  const repo = fixtureRepo();
  const { ledger, vars } = scope();
  const r = withEnv(vars, () => publishScheduled({ repo, run: fakeRunner({ deployOut: 'done' }).run, log: quiet }));
  assert.equal(r.code, EXIT.DEPLOY);
  assert.deepEqual([readLedger(ledger)[0].stage, readLedger(ledger)[0].ok], ['deploy', false]);
  const f = fakeRunner();
  assert.equal(withEnv(vars, () => publishScheduled({ repo, run: f.run, log: quiet })).code, EXIT.OK);
  assert.ok(f.stages().includes('deploy'));
  const failed = withEnv(scope().vars, () => publishScheduled({ repo, run: fakeRunner({ fail: { deploy: 2 } }).run, log: quiet }));
  assert.equal(failed.code, EXIT.DEPLOY);
});

test('an unreadable ledger fails closed: nothing runs and the file is untouched', () => {
  const repo = fixtureRepo();
  const { ledger, vars } = scope();
  writeFileSync(ledger, '{"ok":true}\nnot json\n');
  const f = fakeRunner();
  const r = withEnv(vars, () => publishScheduled({ repo, run: f.run, log: quiet }));
  assert.equal(r.code, EXIT.UNREADABLE);
  assert.equal(f.calls.length, 0);
  assert.equal(readFileSync(ledger, 'utf8'), '{"ok":true}\nnot json\n');
  writeFileSync(ledger, '{"ok":true}');
  assert.equal(withEnv(vars, () => publishScheduled({ repo, run: f.run, log: quiet })).code, EXIT.UNREADABLE, 'a torn last line');
});

test('an unresolvable ref is an unreadable input', () => {
  const repo = fixtureRepo();
  const { vars } = scope();
  assert.equal(withEnv(vars, () => publishScheduled({ repo, ref: 'no-such-branch', run: fakeRunner().run, log: quiet })).code, EXIT.UNREADABLE);
});

test('the private root ships from its committed tree, and the record names that tree', () => {
  const repo = fixtureRepo();
  const side = mkdtempSync(join(tmpdir(), 'cw-dps-side-'));
  git(side, 'init', '-q', '-b', 'main');
  write(side, 'monitor/docsite/manifest.json', '{"docs":["committed"]}\n');
  git(side, 'add', '-A');
  git(side, 'commit', '-q', '-m', 'private');
  write(side, 'monitor/docsite/manifest.json', '{"docs":["uncommitted"]}\n');
  const { ledger, vars } = scope({ CW_DOCSITE_PRIVATE: join(side, 'monitor', 'docsite') });
  const seen = {};
  const f = fakeRunner({ inspect: (stage, { env }) => { if (stage === 'build') seen.manifest = readFileSync(join(env.CW_DOCSITE_PRIVATE, 'manifest.json'), 'utf8'); } });
  assert.equal(withEnv(vars, () => publishScheduled({ repo, run: f.run, log: quiet })).code, EXIT.OK);
  assert.equal(seen.manifest, '{"docs":["committed"]}\n');
  assert.equal(readLedger(ledger)[0].privateTree, git(side, 'rev-parse', 'HEAD:monitor/docsite'));

  // a committed private change publishes again even though the public ref did not move
  commit(side, 'monitor/docsite/manifest.json', '{"docs":["second"]}\n');
  const g = fakeRunner({ bundle: { 'index.html': 'with second' } });
  assert.equal(withEnv(vars, () => publishScheduled({ repo, run: g.run, log: quiet })).code, EXIT.OK);
  assert.ok(g.stages().includes('deploy'));

  // the private root disappearing would withdraw hidden pages: refused unless asked for
  const gone = { ...vars, CW_DOCSITE_PRIVATE: join(side, 'nowhere') };
  const h = fakeRunner();
  assert.equal(withEnv(gone, () => publishScheduled({ repo, run: h.run, log: quiet })).code, EXIT.REFUSED);
  assert.equal(h.calls.length, 0);
  assert.equal(readLedger(ledger).at(-1).stage, 'private-root');
  assert.equal(withEnv(gone, () => publishScheduled({ repo, run: fakeRunner().run, publicOnly: true, log: quiet })).code, EXIT.OK);
});

test('a private root that is not committed anywhere is refused rather than published from disk', () => {
  const repo = fixtureRepo();
  const loose = mkdtempSync(join(tmpdir(), 'cw-dps-loose-'));
  write(loose, 'manifest.json', '{}\n');
  const { ledger, vars } = scope({ CW_DOCSITE_PRIVATE: loose, GIT_CEILING_DIRECTORIES: dirname(loose) });
  const f = fakeRunner();
  assert.equal(withEnv(vars, () => publishScheduled({ repo, run: f.run, log: quiet })).code, EXIT.UNREADABLE);
  assert.equal(f.calls.length, 0);
  assert.equal(readLedger(ledger)[0].stage, 'export');
});

test('a dry run runs every check and writes nothing', () => {
  const repo = fixtureRepo();
  const { ledger, vars } = scope();
  const f = fakeRunner();
  assert.equal(withEnv(vars, () => publishScheduled({ repo, run: f.run, dryRun: true, log: quiet })).code, EXIT.OK);
  assert.deepEqual(f.stages(), ['build', 'doctor', 'tests', 'bundle']);
  assert.ok(!existsSync(ledger));
});

test('a held lock is reported and nothing runs', () => {
  const repo = fixtureRepo();
  const { ledger, vars } = scope();
  mkdirSync(`${ledger}.lock`, { recursive: true });
  writeFileSync(join(`${ledger}.lock`, 'owner.json'), JSON.stringify({ pid: process.pid, at: Date.now(), label: 'peer' }));
  const f = fakeRunner();
  assert.equal(withEnv(vars, () => publishScheduled({ repo, run: f.run, log: quiet })).code, EXIT.LOCKED);
  assert.equal(f.calls.length, 0);
});

test('the bundle digest is order-independent and changes with any byte', () => {
  const a = mkdtempSync(join(tmpdir(), 'cw-dps-dig-'));
  const b = mkdtempSync(join(tmpdir(), 'cw-dps-dig-'));
  write(a, 'x/index.html', '1'); write(a, 'index.html', '2');
  write(b, 'index.html', '2'); write(b, 'x/index.html', '1');
  assert.deepEqual(bundleDigest(a), bundleDigest(b));
  write(b, 'x/index.html', '1 ');
  assert.notEqual(bundleDigest(a).digest, bundleDigest(b).digest);
});

test('--status prints the last attempts; a usage error exits 24', () => {
  const repo = fixtureRepo();
  const { vars } = scope();
  withEnv(vars, () => publishScheduled({ repo, run: fakeRunner({ fail: { build: 1 } }).run, log: quiet }));
  withEnv(vars, () => publishScheduled({ repo, run: fakeRunner().run, force: true, log: quiet }));
  const env = { ...process.env, ...vars };
  const s = spawnSync(process.execPath, [SCRIPT, '--status', '--repo', repo], { env, encoding: 'utf8' });
  assert.equal(s.status, 0, s.stderr);
  const lines = s.stdout.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /refused at build/);
  assert.match(lines[1], /published {2}1a2b3c4d/);
  assert.deepEqual(statusLines(readLedger(vars.CW_DOCSITE_PUBLISH_LEDGER), 1), [lines[1]]);
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--bogus'], { env, encoding: 'utf8' }).status, EXIT.USAGE);
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--ref'], { env, encoding: 'utf8' }).status, EXIT.USAGE);
});
