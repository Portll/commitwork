// Tests for release-candidate --project: a fleet repository's candidate, built from its launchlist
// config, gated with commitwork's tools, and commitwork's own build pinned unchanged. Every fixture is
// a git repository under a temp root; no test reads the sidecar, the registry or a sibling checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
// A namespace import, so a build without these exports fails test by test rather than at load.
import * as rc from '../release-candidate.mjs';
import { CHECKS } from '../../lib/launchlist-checks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'release-candidate.mjs');
const ROOTS = [];
const tmp = (p = 'cw-rcp-') => { const d = mkdtempSync(join(tmpdir(), p)); ROOTS.push(d); return d; };
process.on('exit', () => { for (const r of ROOTS) rmSync(r, { recursive: true, force: true }); });

const ID = ['-c', 'user.name=Rel Test', '-c', 'user.email=rel@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
// env: outranks -c user.*, so the harness identity cannot leak into fixtures
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Rel Test', GIT_AUTHOR_EMAIL: 'rel@example.invalid', GIT_AUTHOR_DATE: '2026-10-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'Rel Test', GIT_COMMITTER_EMAIL: 'rel@example.invalid', GIT_COMMITTER_DATE: '2026-10-01T00:00:00Z',
};
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...ID, ...a], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });

function put(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}
function commit(root, files, msg) {
  put(root, files);
  git(root, 'add', '-A', '-f');
  git(root, 'commit', '-q', '-m', msg);
  return git(root, 'rev-parse', 'HEAD').trim();
}
function repoAt(root, files) {
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  return commit(root, files, 'source');
}

// The project's suite: passes only when the declared env is present, the operator's is absent, no
// sidecar is reachable, and the declared setup ran first in the candidate.
const PROBE = `import { existsSync } from 'node:fs';
const p = [];
if (process.env.PROBE_DECLARED !== '1') p.push('declared env missing');
if (process.env.PROBE_LEAK) p.push('operator env leaked');
if (!/no-sidecar$/.test(process.env.CW_SIDECAR || '')) p.push('sidecar reachable');
if (!existsSync('setup-ran')) p.push('setup did not run first');
console.log(p.length ? 'not ok 1 - ' + p.join('; ') : 'ok 1 - probe');
console.log('# tests 1\\n# pass ' + (p.length ? 0 : 1) + '\\n# fail ' + (p.length ? 1 : 0));
process.exitCode = p.length ? 1 : 0;
`;
const PROJECT_FILES = {
  'package.json': '{"name":"fixturepro","version":"1.2.3"}\n',
  'README.md': '<!-- verified-against: 2026-09-07 a1b2c3d -->\n# fixturepro\n\nfixturepro, or fp-alias, is a synthetic fleet project.\n',
  'probe.mjs': PROBE,
  'CLAUDE.md': '# operational notes\n',
  'private/notes.txt': 'not for release\n',
  '.gitattributes': 'private/** export-ignore\n',
};
const PUBLIC_TEST = {
  cmd: process.execPath, args: ['probe.mjs'], env: { PROBE_DECLARED: '1' },
  setup: { cmd: process.execPath, args: ['-e', "require('fs').writeFileSync('setup-ran', '1')"] },
};

/** A fleet root with one project per entry, a launchlist config declaring each, and no registry. */
function fleet(projects = { fixturepro: { selfNames: ['fp-alias'], publicTest: PUBLIC_TEST } }) {
  const root = tmp('cw-rcp-fleet-');
  const shas = {};
  for (const name of Object.keys(projects)) {
    const repo = join(root, name);
    const first = repoAt(repo, { ...PROJECT_FILES, 'package.json': `{"name":"${name}","version":"1.2.3"}\n` });
    const second = commit(repo, {
      'docs/HISTORY.md': `# History\n\nFixed in ${first.slice(0, 7)}.\n`,
      'monitor/failure-taxonomy.json': `{ "why": "fixed in ${first.slice(0, 7)}" }\n`,
    }, 'cite');
    shas[name] = { first, second };
  }
  const ll = join(root, 'launchlist');
  mkdirSync(ll);
  const cfg = Object.fromEntries(Object.entries(projects).map(([n, c]) => [n, { repo: n, profiles: ['publication'], ...c }]));
  writeFileSync(join(ll, 'config.json'), JSON.stringify({ projects: cfg }, null, 2));
  mkdirSync(join(root, 'tmp'));
  return { root, ll, shas, repo: (n) => join(root, n) };
}

/** A name scope on disk that holds the project's own names and one foreign name. */
function scopeFiles(root) {
  const d = join(root, 'scope');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'release.json'), JSON.stringify({ names: [{ name: 'fixturepro' }, { name: 'fp-alias' }, { name: 'zanzibarcorp' }] }));
  writeFileSync(join(d, 'publish.json'), JSON.stringify({ map: {} }));
  writeFileSync(join(d, 'identities.json'), JSON.stringify({ identities: [] }));
  return { CW_RELEASE_REDACTIONS: join(d, 'release.json'), CW_PUBLISH_REDACTIONS: join(d, 'publish.json'), CW_REPO_IDENTITIES: join(d, 'identities.json') };
}

const SCRUB = ['CW_RELEASE_REDACTIONS', 'CW_PUBLISH_REDACTIONS', 'CW_REPO_IDENTITIES', 'CW_RELEASE_REVIEWS', 'CW_RELEASE_SOURCE', 'CW_NOW'];
function isolated(f, extra = {}) {
  const env = { ...process.env };
  for (const k of SCRUB) delete env[k];
  return {
    ...env, ...GIT_ENV,
    CW_FLEET_ROOT: f.root, CW_LAUNCHLIST_DIR: f.ll, CW_REGISTRY: join(f.root, 'no-registry.json'),
    CW_SIDECAR: join(f.root, 'no-sidecar'), CW_VERDICT_DIR: join(f.root, 'verdicts'), CW_GITLEAKS: join(f.root, 'no-gitleaks'),
    TMPDIR: join(f.root, 'tmp'),
    ...extra,
  };
}
function run(args, env) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--json'], { encoding: 'utf8', env });
  let report = null;
  try { report = JSON.parse(r.stdout); } catch { /* asserted by the caller */ }
  return { code: r.status, report, stderr: r.stderr };
}
const statuses = (r) => Object.fromEntries(r.gates.map((g) => [g.gate, g.status]));
const gate = (r, name) => r.gates.find((g) => g.gate === name);
const lastRecord = (dir) => JSON.parse(readFileSync(join(dir, 'release-candidate.jsonl'), 'utf8').trim().split('\n').pop());

test('a fleet project builds a one-commit candidate of its committed ref, from its config, and leaves the source untouched', () => {
  const f = fleet();
  const repo = f.repo('fixturepro');
  // Another session's uncommitted work: the candidate must not carry it, and the build must not touch it.
  writeFileSync(join(repo, 'README.md'), '# uncommitted rewrite\n');
  writeFileSync(join(repo, 'scratch.txt'), 'untracked\n');
  const before = { status: git(repo, 'status', '--porcelain'), refs: git(repo, 'for-each-ref'), readme: readFileSync(join(repo, 'README.md'), 'utf8') };
  const decoy = tmp('cw-rcp-decoy-');
  const out = join(f.root, 'rc');
  const { code, report: r, stderr } = run(['--project', 'fixturepro', '--out', out, '--no-journal'],
    isolated(f, { CW_RELEASE_SOURCE: decoy, PROBE_LEAK: '1', ...scopeFiles(f.root) }));
  assert.ok(r, stderr);
  assert.equal(r.project, 'fixturepro');
  assert.equal(r.source.repo, repo, 'the config repo, resolved against the fleet root; CW_RELEASE_SOURCE is commitwork\'s');
  assert.equal(r.source.sha, f.shas.fixturepro.second);
  assert.equal(r.candidate.path, join(out, 'fixturepro'));
  assert.equal(r.candidate.message, 'fixturepro 1.2.3');
  const dest = r.candidate.path;
  assert.equal(execFileSync('git', ['-C', dest, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim(), '1');
  assert.equal(gate(r, 'tree').status, 'pass', JSON.stringify(gate(r, 'tree')));
  assert.equal(readFileSync(join(dest, 'README.md'), 'utf8'), PROJECT_FILES['README.md'].replace(' a1b2c3d', ''), 'the committed README, its stamp date-only');
  assert.equal(readFileSync(join(dest, 'docs/HISTORY.md'), 'utf8'), '# History\n\nFixed in a commit.\n');
  assert.equal(readFileSync(join(dest, 'monitor/failure-taxonomy.json'), 'utf8'), `{ "why": "fixed in ${f.shas.fixturepro.first.slice(0, 7)}" }\n`,
    'the failure taxonomy is commitwork\'s file; a project\'s is shipped as committed');
  assert.equal(readFileSync(join(dest, 'CLAUDE.md'), 'utf8'), PROJECT_FILES['CLAUDE.md'], 'no public variant carried, so none swapped in');
  assert.equal(r.candidate.publicClaude, false);
  assert.equal(existsSync(join(dest, 'private/notes.txt')), false);
  assert.equal(existsSync(join(dest, 'scratch.txt')), false);

  assert.equal(git(repo, 'status', '--porcelain'), before.status);
  assert.equal(git(repo, 'for-each-ref'), before.refs);
  assert.equal(readFileSync(join(repo, 'README.md'), 'utf8'), before.readme);

  // The project's suite ran in the candidate under its declaration, with nothing of the operator's.
  const t = gate(r, 'tests');
  assert.equal(t.status, 'pass', JSON.stringify(t));
  assert.deepEqual(t.detail.command, [process.execPath, 'probe.mjs']);
  assert.equal(t.detail.counts.pass, 1);
  assert.equal(code, 1, 'the launchlist content checks fail this fixture (no licence), so the verdict is blocked');
});

test('every gate runs as commitwork\'s tool against a project candidate, or is cannot-check with its reason', () => {
  const f = fleet();
  writeFileSync(join(f.root, 'operator-reviews.json'), JSON.stringify({ note: 'operator', findings: [], assets: [] }));
  const { report: r, stderr } = run(['--project', 'fixturepro', '--out', join(f.root, 'rc'), '--skip-tests', '--no-journal'],
    isolated(f, { CW_RELEASE_REVIEWS: join(f.root, 'operator-reviews.json'), ...scopeFiles(f.root) }));
  assert.ok(r, stderr);
  const docs = gate(r, 'docs');
  assert.equal(docs.status, 'cannot-check');
  assert.equal(docs.detail.error, 'no docs freshness contract declared for fixturepro');

  const secrets = gate(r, 'secrets');
  assert.ok(secrets.detail.verdict, `commitwork's pre-publish ran over the candidate: ${JSON.stringify(secrets)}`);
  assert.equal(secrets.detail.reviews.source, 'none', 'commitwork\'s reviewed dispositions settle nothing in another project');
  assert.equal(secrets.status, 'pass');

  const ll = gate(r, 'launchlist');
  assert.equal(ll.detail.error, undefined, JSON.stringify(ll.detail));
  assert.ok(ll.detail.rows.length > 0, 'judged against the project\'s own config');
  assert.deepEqual(statuses(r), { tree: 'pass', secrets: 'pass', identity: 'pass', docs: 'cannot-check', launchlist: 'fail', tests: 'not-run' });
});

test('the identity gate does not count the project\'s own names, as the launchlist does not, and counts every other', async () => {
  const f = fleet();
  const scope = scopeFiles(f.root);
  const saved = Object.fromEntries(Object.keys(scope).map((k) => [k, process.env[k]]));
  Object.assign(process.env, scope);
  try {
    const own = join(f.root, 'own');
    repoAt(own, { 'README.md': '# fixturepro\n\nfp-alias names the same project.\n' });
    const foreign = join(f.root, 'foreign');
    repoAt(foreign, { 'README.md': '# fixturepro\n\nBuilt for zanzibarcorp.\n' });
    const selfNames = ['fp-alias', 'fixturepro', 'fixturepro'];
    const llCtx = (repo) => ({ project: 'fixturepro', repoName: 'fixturepro', repo, cfg: { selfNames: ['fp-alias'] } });

    const a = await rc.identityGate(own, { selfNames });
    assert.equal(a.status, 'pass', JSON.stringify(a.detail));
    assert.equal(a.detail.selfNamesExcluded, 2);
    assert.equal((await CHECKS.identities(llCtx(own))).status, 'pass', 'the launchlist judges the same tree the same way');

    const b = await rc.identityGate(foreign, { selfNames });
    assert.equal(b.status, 'fail');
    assert.equal(b.detail.rowCount, 1, 'the foreign name alone');
    assert.equal((await CHECKS.identities(llCtx(foreign))).status, 'fail');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('a project\'s publicTest failure fails the tests gate; no declaration, an unrunnable command or a failed setup is cannot-check', () => {
  const dest = tmp('cw-rcp-dest-');
  const logs = tmp('cw-rcp-logs-');
  const scratch = tmp('cw-rcp-env-');
  const g = (publicTest, extra = {}) => rc.testsGate(dest, scratch, logs, { skip: false, timeoutMs: 60_000, project: 'fixturepro', publicTest, ...extra });
  writeFileSync(join(dest, 'fails.mjs'), "console.log('not ok 1 - the widget\\n# tests 1\\n# pass 0\\n# fail 1'); process.exitCode = 1;\n");

  const none = g(null);
  assert.equal(none.status, 'cannot-check');
  assert.match(none.detail.error, /no publicTest declared for fixturepro/);

  const failed = g({ cmd: process.execPath, args: ['fails.mjs'] });
  assert.equal(failed.status, 'fail');
  assert.deepEqual(failed.detail.failing, ['the widget']);
  assert.equal(failed.detail.counts.fail, 1);

  const missing = g({ cmd: join(dest, 'no-such-runner') });
  assert.equal(missing.status, 'cannot-check');
  assert.match(missing.detail.error, /ENOENT/);

  const setup = g({ cmd: process.execPath, args: ['-e', "require('fs').writeFileSync('suite-ran', '1')"], setup: { cmd: process.execPath, args: ['-e', 'process.exit(3)'] } });
  assert.equal(setup.status, 'cannot-check');
  assert.match(setup.detail.error, /setup .* exited 3, so the suite did not run/);
  assert.equal(existsSync(join(dest, 'suite-ran')), false);

  assert.equal(g({ cmd: process.execPath }, { skip: true }).status, 'not-run');
});

test('two projects\' candidates and journal entries never collide', () => {
  const f = fleet({ fixturepro: { publicTest: PUBLIC_TEST }, fixturetwo: { publicTest: PUBLIC_TEST } });
  const env = isolated(f);
  const a = run(['--project', 'fixturepro', '--skip-tests'], env).report;
  const b = run(['--project', 'fixturetwo', '--skip-tests'], env).report;
  for (const [r, p] of [[a, 'fixturepro'], [b, 'fixturetwo']]) {
    assert.equal(basename(r.candidate.path), p);
    assert.ok(basename(dirname(r.candidate.path)).startsWith(`cw-release-candidate-${p}-`), r.candidate.path);
    assert.ok(existsSync(join(dirname(r.candidate.path), 'release-candidate.json')));
  }
  assert.notEqual(dirname(a.candidate.path), dirname(b.candidate.path));
  const recs = readFileSync(join(f.root, 'verdicts', 'release-candidate.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(recs.map((x) => [x.project, x.candidate.root]), [['fixturepro', a.candidate.root], ['fixturetwo', b.candidate.root]]);
  assert.ok(readdirSync(join(f.root, 'tmp')).some((n) => n.startsWith('cw-release-candidate-fixturetwo-env-')), 'the scratch HOME names the project too');
});

test('--ref builds the commit it names, not the checkout\'s HEAD, and records it', () => {
  const f = fleet();
  const { report: r } = run(['--project', 'fixturepro', '--ref', 'HEAD~1', '--out', join(f.root, 'rc'), '--skip-tests', '--no-journal'], isolated(f));
  assert.equal(r.source.ref, 'HEAD~1');
  assert.equal(r.source.sha, f.shas.fixturepro.first);
  assert.equal(existsSync(join(r.candidate.path, 'docs/HISTORY.md')), false);
});

test('a project with no launchlist config aborts as incomplete, names the config, and is journalled under its name', () => {
  const f = fleet();
  const { code, report: r } = run(['--project', 'nothere', '--out', join(f.root, 'rc')], isolated(f));
  assert.equal(code, 2);
  assert.equal(r.verdict, 'incomplete');
  assert.match(r.error, /no launchlist config for nothere/);
  assert.equal(r.candidate, undefined);
  assert.equal(lastRecord(join(f.root, 'verdicts')).project, 'nothere');
});

test('parseArgs takes --project as a slug and defaults to commitwork', () => {
  assert.equal(rc.parseArgs([]).project, 'commitwork');
  assert.equal(rc.parseArgs(['--project', 'spine']).project, 'spine');
  assert.match(rc.parseArgs(['--project']).error, /needs a value/);
  assert.match(rc.parseArgs(['--project', '../up']).error, /not a project slug/);
});

// ── commitwork's own build, pinned ───────────────────────────────────────────────────────────

const CW_FILES = {
  'package.json': '{"name":"x","version":"9.9.9"}\n',
  'docs/A.md': '<!-- verified-against: 2026-09-07 a1b2c3d -->\n# Doc\n',
  'private/notes.txt': 'not for release\n',
  '.gitattributes': 'private/** export-ignore\n/CLAUDE.md export-ignore\n',
  'CLAUDE.md': '# operational\n',
  'release/CLAUDE.public.md': '# public\n',
  'README.md': '- [release/CLAUDE.public.md](release/CLAUDE.public.md)\n',
};
// The root commit this fixture built before --project existed, measured on that code. Any change to
// what a commitwork candidate holds, or how it is committed, moves it.
const PINNED_ROOT = 'd8c60c171515dc15317434e3f079edcdb97fd4e4';

function cwSource() {
  const src = tmp('cw-rcp-cw-');
  const first = repoAt(src, CW_FILES);
  commit(src, { 'docs/C.md': `# C\n\nFixed in ${first.slice(0, 7)} (${first.slice(0, 8)}), not in deadbee1.\n` }, 'cite');
  return src;
}
function cwEnv(src, root) {
  const env = { ...process.env };
  for (const k of SCRUB) delete env[k];
  return { ...env, CW_RELEASE_SOURCE: src, CW_VERDICT_DIR: join(root, 'verdicts'), CW_SIDECAR: join(root, 'no-sidecar'),
    CW_LAUNCHLIST_DIR: join(root, 'no-launchlist'), CW_REGISTRY: join(root, 'no-registry.json'), TMPDIR: root };
}

test('commitwork\'s own build is unchanged: no flag and --project commitwork build the pinned candidate, unnamed', () => {
  const src = cwSource();
  const root = tmp('cw-rcp-cwout-');
  const env = cwEnv(src, root);
  const bare = run(['--out', join(root, 'a'), '--skip-tests'], env);
  const named = run(['--project', 'commitwork', '--out', join(root, 'b'), '--skip-tests'], env);
  for (const { code, report: r } of [bare, named]) {
    assert.equal(code, 2);
    assert.equal(r.candidate.root, PINNED_ROOT);
    assert.equal(basename(r.candidate.path), 'commitwork');
    assert.deepEqual(statuses(r), { tree: 'pass', secrets: 'cannot-check', identity: 'cannot-check', docs: 'cannot-check', launchlist: 'cannot-check', tests: 'not-run' });
    assert.equal('project' in r, false, 'an unnamed entry is commitwork\'s, as every entry before --project was');
    assert.deepEqual(Object.keys(r.source), ['ref', 'sha', 'tree', 'version']);
    assert.equal('publicClaude' in r.candidate, false);
    assert.equal(r.candidate.message, 'commitwork 9.9.9');
    assert.equal(readFileSync(join(r.candidate.path, 'CLAUDE.md'), 'utf8'), '# public\n');
  }
  const recs = readFileSync(join(root, 'verdicts', 'release-candidate.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(recs.length, 2);
  for (const rec of recs) assert.equal('project' in rec, false);
});

test('a tracked symlink is never written through by the text transforms', () => {
  const outside = join(tmp('cw-rcp-outside-'), 'target.md');
  const body = '<!-- verified-against: 2026-09-07 a1b2c3d -->\n# outside the candidate\n';
  writeFileSync(outside, body);
  const src = tmp('cw-rcp-link-');
  mkdirSync(join(src, 'docs'), { recursive: true });
  symlinkSync(outside, join(src, 'docs', 'link.md'));
  repoAt(src, CW_FILES);
  const root = tmp('cw-rcp-linkout-');
  const { report: r } = run(['--out', join(root, 'rc'), '--skip-tests', '--no-journal'], cwEnv(src, root));
  assert.equal(readFileSync(outside, 'utf8'), body, 'the link target is outside the candidate and is not touched');
  assert.equal(gate(r, 'tree').status, 'fail');
  assert.ok(gate(r, 'tree').detail.problems.includes('symlink docs/link.md'));
});
