// Tests for the release-candidate snapshot (archive, stamps, fresh root, witness) and its verdicts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractSnapshot, dateOnlyStamps, commitFreshRoot, blobWitness, treeTexts, publicEnv, testCounts,
  overallVerdict, resolveCommit, sourceMeta, commitTokens, stripCommitShas, swapPublicClaude, PUBLIC_CLAUDE,
  pruneBaselineShas, PATTERN_BASELINE,
} from '../lib/release-candidate-core.mjs';
import { parseArgs, launchlistGate, CANDIDATE_CHECKS, PROJECT_CHECKS } from '../release-candidate.mjs';
import { loadSpec, profilesOf, digestEvidence } from '../../lib/launchlist.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'release-candidate.mjs');
const ROOTS = [];
const tmp = (p = 'cw-rc-') => { const d = mkdtempSync(join(tmpdir(), p)); ROOTS.push(d); return d; };
process.on('exit', () => { for (const r of ROOTS) rmSync(r, { recursive: true, force: true }); });

const ID = ['-c', 'user.name=Rel Test', '-c', 'user.email=rel@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
// env: outranks -c user.*, so the harness identity cannot leak into fixtures
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Rel Test', GIT_AUTHOR_EMAIL: 'rel@example.invalid', GIT_AUTHOR_DATE: '2026-10-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'Rel Test', GIT_COMMITTER_EMAIL: 'rel@example.invalid', GIT_COMMITTER_DATE: '2026-10-01T00:00:00Z',
};
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...ID, ...a], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });

function sourceRepo(files) {
  const root = tmp('cw-rc-src-');
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A', '-f');
  git(root, 'commit', '-q', '-m', 'source');
  return root;
}

const STAMPED = `<!-- verified-against: 2026-09-07 a1b2c3d -->\n# Doc\n${'\nbody'.repeat(10)}\n<!-- verified-against: 2026-09-01 abcdef1 -->\n`;
const FILES = {
  'package.json': '{"name":"x","version":"9.9.9"}\n',
  'docs/A.md': STAMPED,
  'docs/B.md': '<!-- verified-against: 2026-09-07 -->\n# date only\n',
  'src/a.mjs': '// <!-- verified-against: 2026-09-07 a1b2c3d -->\nexport const a = 1;\n',
  'private/notes.txt': 'not for release\n',
  '.gitattributes': 'private/** export-ignore\n',
  '.gitignore': 'src/\n',
  'img.bin': Buffer.from([1, 0, 2, 0, 3]),
  'CLAUDE.md': '# operational\n',
  'release/CLAUDE.public.md': '# public\n',
};

test('dateOnlyStamps rewrites a .md head stamp and nothing else', () => {
  const d = tmp();
  for (const [rel, c] of Object.entries(FILES)) { mkdirSync(dirname(join(d, rel)), { recursive: true }); writeFileSync(join(d, rel), c); }
  assert.deepEqual(dateOnlyStamps(d, ['docs/A.md', 'docs/B.md', 'src/a.mjs']), ['docs/A.md']);
  const a = readFileSync(join(d, 'docs/A.md'), 'utf8');
  assert.match(a, /^<!-- verified-against: 2026-09-07 -->\n/);
  assert.match(a, /2026-09-01 abcdef1/, 'a stamp past the head is not a stamp');
  assert.equal(readFileSync(join(d, 'src/a.mjs'), 'utf8'), FILES['src/a.mjs']);
});

test('a snapshot drops export-ignored paths, keeps ignored-but-tracked ones, and witnesses every blob', () => {
  const src = sourceRepo(FILES);
  const sha = resolveCommit(src, 'HEAD');
  const dest = join(tmp(), 'commitwork');
  const snap = extractSnapshot(src, sha, dest);
  assert.deepEqual(snap.excluded, ['private/notes.txt']);
  assert.ok(snap.files.includes('src/a.mjs'), 'a tracked file under an ignore rule still ships');
  const stamps = dateOnlyStamps(dest, snap.files);
  const meta = sourceMeta(src, sha);
  assert.equal(meta.version, '9.9.9');
  const fresh = commitFreshRoot(dest, { name: meta.name, email: meta.email, date: meta.date, message: 'commitwork 9.9.9' });
  assert.deepEqual(blobWitness(snap.tracked, fresh.entries, stamps, snap.excluded), []);
  assert.equal(execFileSync('git', ['-C', dest, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim(), '1');
  assert.equal(execFileSync('git', ['-C', dest, 'log', '-1', '--format=%an <%ae>'], { encoding: 'utf8' }).trim(), 'Rel Test <rel@example.invalid>');

  const again = join(tmp(), 'commitwork');
  const snap2 = extractSnapshot(src, sha, again);
  dateOnlyStamps(again, snap2.files);
  const fresh2 = commitFreshRoot(again, { name: meta.name, email: meta.email, date: meta.date, message: 'commitwork 9.9.9' });
  assert.equal(fresh2.root, fresh.root, 'same source, same candidate commit');

  const tampered = fresh.entries.map((e) => (e.path === 'src/a.mjs' ? { ...e, blob: '0'.repeat(40) } : e));
  assert.deepEqual(blobWitness(snap.tracked, tampered, stamps, snap.excluded), ['altered src/a.mjs']);
  assert.deepEqual(blobWitness(snap.tracked, fresh.entries, [], snap.excluded), ['altered docs/A.md']);
  assert.deepEqual(blobWitness(snap.tracked, fresh.entries.filter((e) => e.path !== 'img.bin'), stamps, snap.excluded), ['missing img.bin']);
});

test('treeTexts reads every blob at the commit and nulls binary ones', () => {
  const src = sourceRepo(FILES);
  const t = new Map(treeTexts(src).map((e) => [e.path, e.text]));
  assert.equal(t.size, Object.keys(FILES).length);
  assert.equal(t.get('img.bin'), null);
  assert.equal(t.get('docs/A.md'), STAMPED);
});

test('publicEnv carries nothing of the operator but PATH-like keys', () => {
  const env = publicEnv(tmp(), { PATH: '/bin', HOME: '/Users/op', CW_SIDECAR: '/real', CW_X: '1', GIT_AUTHOR_EMAIL: 'op@example.invalid', LANG: 'C' });
  assert.equal(env.PATH, '/bin');
  assert.equal(env.LANG, 'C');
  assert.notEqual(env.HOME, '/Users/op');
  assert.match(env.CW_SIDECAR, /no-sidecar$/);
  assert.equal(existsSync(env.CW_SIDECAR), false);
  assert.equal(env.CW_X, undefined);
  assert.equal(env.GIT_AUTHOR_EMAIL, undefined);
});

test('testCounts reads spec and tap summaries, and reports absence as null', () => {
  assert.deepEqual(testCounts('ℹ tests 3\nℹ pass 2\nℹ fail 1\n'), { tests: 3, pass: 2, fail: 1, skipped: null, cancelled: null, todo: null });
  assert.equal(testCounts('# pass 7\n# fail 0\n').pass, 7);
  assert.equal(testCounts('nothing').tests, null);
});

test('overallVerdict accepts only all-pass, and a fail outranks a gap', () => {
  const g = (...s) => s.map((status) => ({ status }));
  assert.equal(overallVerdict(g('pass', 'pass')).verdict, 'accepted');
  assert.equal(overallVerdict(g('pass', 'not-run')).verdict, 'incomplete');
  assert.equal(overallVerdict(g('cannot-check', 'fail')).verdict, 'blocked');
  assert.equal(overallVerdict(g()).verdict, 'incomplete', 'no gates is not a pass');
});

test('parseArgs refuses unknown flags and missing values', () => {
  assert.match(parseArgs(['--bogus']).error, /unknown flag/);
  assert.match(parseArgs(['--ref']).error, /needs a value/);
  assert.match(parseArgs(['--test-timeout', '0']).error, /positive/);
  assert.equal(parseArgs(['--skip-tests']).skipTests, true);
});

// A run with no private scope at all. Pointing CW_SIDECAR at nothing is not enough: an explicit map
// override outranks it, and CI exports all three for the whole suite once CW_RELEASE_SCOPE is set.
const noPrivateScope = (extra) => {
  const env = { ...process.env, ...extra };
  for (const k of ['CW_RELEASE_REDACTIONS', 'CW_PUBLISH_REDACTIONS', 'CW_REPO_IDENTITIES']) delete env[k];
  return env;
};

test('a candidate whose gates cannot run is incomplete, never accepted, and is journalled', () => {
  const src = sourceRepo(FILES);
  const out = join(tmp(), 'rc');
  const verdicts = tmp('cw-rc-verdicts-');
  let stdout;
  let code = 0;
  try {
    stdout = execFileSync(process.execPath, [CLI, '--out', out, '--skip-tests', '--json'], {
      encoding: 'utf8', env: noPrivateScope({ CW_RELEASE_SOURCE: src, CW_VERDICT_DIR: verdicts, CW_SIDECAR: join(out, 'no-sidecar'), CW_LAUNCHLIST_DIR: join(out, 'no-launchlist') }),
    });
  } catch (e) { code = e.status; stdout = String(e.stdout); }
  const r = JSON.parse(stdout);
  assert.equal(code, 2);
  assert.equal(r.verdict, 'incomplete');
  assert.deepEqual(Object.fromEntries(r.gates.map((g) => [g.gate, g.status])),
    { tree: 'pass', secrets: 'cannot-check', identity: 'cannot-check', docs: 'cannot-check', launchlist: 'cannot-check', tests: 'not-run' });
  assert.equal(r.candidate.stampsDateOnly, 1);
  assert.equal(r.candidate.excluded, 1);
  assert.ok(existsSync(join(out, 'release-candidate.json')));
  const rec = JSON.parse(readFileSync(join(verdicts, 'release-candidate.jsonl'), 'utf8').trim().split('\n').pop());
  assert.equal(rec.verdict, 'incomplete');
  assert.equal(rec.candidate.root, r.candidate.root);
});

test('the command refuses a non-empty --out', () => {
  const src = sourceRepo(FILES);
  const out = tmp();
  writeFileSync(join(out, 'x'), 'x');
  let code = 0;
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [CLI, '--out', out, '--skip-tests', '--json', '--no-journal'], {
      encoding: 'utf8', env: { ...process.env, CW_RELEASE_SOURCE: src },
    });
  } catch (e) { code = e.status; stdout = String(e.stdout); }
  assert.equal(code, 2);
  assert.match(JSON.parse(stdout).error, /not empty/);
});

const SPEC = {
  items: [
    { id: 'p.hard', profile: 'publication', severity: 'HARD', check: 'licenceFile' },
    { id: 'p.should', profile: 'publication', severity: 'SHOULD', check: 'emails' },
    { id: 'p.live', profile: 'publication', severity: 'HARD', check: 'originSync' },
  ],
};
const loadWith = ({ config = { projects: { commitwork: {} } }, ticks = {} } = {}) => async () =>
  ({ spec: SPEC, config, state: { ticks: { commitwork: ticks }, items: {}, log: [] }, fleetNames: [] });
const runWith = (byCheck) => async (ctx, items) => Object.fromEntries(items.map((it) => [it.id, byCheck[it.check]]));
const res = (status) => ({ status, summary: status, evidence: [] });

test('the launchlist gate runs only candidate checks, and names each project check it left out', async () => {
  const seen = [];
  const run = async (ctx, items) => { seen.push(...items.map((i) => i.check)); return runWith({ licenceFile: res('pass'), emails: res('pass') })(ctx, items); };
  const g = await launchlistGate('/x', { load: loadWith(), run });
  assert.equal(g.status, 'pass');
  assert.deepEqual(seen.sort(), ['emails', 'licenceFile']);
  assert.deepEqual(g.detail.notRun.map((n) => n.check), ['originSync']);
});

test('a HARD row that is not done blocks; a SHOULD row is reported but does not', async () => {
  const g = await launchlistGate('/x', { load: loadWith(), run: runWith({ licenceFile: res('warn'), emails: res('fail') }) });
  assert.equal(g.status, 'fail');
  assert.deepEqual(g.detail.blocking, ['p.hard']);
  const ok = await launchlistGate('/x', { load: loadWith(), run: runWith({ licenceFile: res('pass'), emails: res('fail') }) });
  assert.equal(ok.status, 'pass');
});

test('an acceptance on the same evidence closes a HARD warn, as it does on the launchlist page', async () => {
  const ticks = { 'p.hard': { state: 'done', evidenceDigest: digestEvidence(res('warn')) } };
  const g = await launchlistGate('/x', { load: loadWith({ ticks }), run: runWith({ licenceFile: res('warn'), emails: res('pass') }) });
  assert.equal(g.status, 'pass');
});

test('an unmeasured HARD row is cannot-check, and a fail outranks it', async () => {
  const spec2 = { items: [...SPEC.items, { id: 'p.hard2', profile: 'publication', severity: 'HARD', check: 'readme' }] };
  const load = async () => ({ ...(await loadWith()()), spec: spec2 });
  const gap = await launchlistGate('/x', { load, run: runWith({ licenceFile: res('unmeasured'), emails: res('pass'), readme: res('pass') }) });
  assert.equal(gap.status, 'cannot-check');
  const both = await launchlistGate('/x', { load, run: runWith({ licenceFile: res('unmeasured'), emails: res('pass'), readme: res('fail') }) });
  assert.equal(both.status, 'fail');
});

test('no project config, or a project without the publication profile, is cannot-check and never a vacuous pass', async () => {
  const run = runWith({ licenceFile: res('pass'), emails: res('pass') });
  const absent = await launchlistGate('/x', { load: loadWith({ config: { projects: {} } }), run });
  assert.equal(absent.status, 'cannot-check');
  assert.match(absent.detail.error, /no launchlist config for commitwork/);
  const other = await launchlistGate('/x', { load: loadWith({ config: { projects: { commitwork: { profiles: ['marketing-site'] } } } }), run });
  assert.equal(other.status, 'cannot-check');
});

test('every publication check in the shipped spec is classed candidate or project, never both', () => {
  const checks = [...new Set(loadSpec().items.filter((it) => it.check && profilesOf(it).includes('publication')).map((it) => it.check))];
  const unclassed = checks.filter((c) => !CANDIDATE_CHECKS.includes(c) && !(c in PROJECT_CHECKS));
  const both = CANDIDATE_CHECKS.filter((c) => c in PROJECT_CHECKS);
  assert.deepEqual(unclassed, [], 'a new publication check must be declared as one the candidate can answer, or one it cannot');
  assert.deepEqual(both, []);
});

test('stripCommitShas removes a parenthesis of commits, replaces other commit SHAs, and touches nothing else', () => {
  const commits = new Set(['aaaa111', 'bbbb2222']);
  assert.equal(stripCommitShas('fixed aaaa111, which works', commits), 'fixed a commit, which works');
  assert.equal(stripCommitShas('landed (aaaa111, bbbb2222) today', commits), 'landed today');
  assert.equal(stripCommitShas('see `aaaa111` there', commits), 'see a commit there');
  assert.equal(stripCommitShas('kept (aaaa111 and cccc333) partly', commits), 'kept (a commit and cccc333) partly',
    'a parenthesis holding a non-commit token stays, with only the commit replaced');
  assert.equal(stripCommitShas('blob cccc333, hash deadbee1, url /commit/aaaa111', commits), 'blob cccc333, hash deadbee1, url /commit/aaaa111');
});

test('stripCommitShas takes all-digit commits and a/b commit pairs, and leaves numbers and paths', () => {
  const commits = new Set(['aaaa111', 'bbbb2222', '1234567']);
  assert.equal(stripCommitShas('Fixed 1234567: a repair', commits), 'Fixed a commit: a repair');
  assert.equal(stripCommitShas('took 4096000 bytes', commits), 'took 4096000 bytes', 'a number that is not a commit stays');
  assert.equal(stripCommitShas('closed at aaaa111/bbbb2222 and', commits), 'closed at two commits and');
  assert.equal(stripCommitShas('closed (aaaa111/bbbb2222, 1234567) late', commits), 'closed late');
  assert.equal(stripCommitShas('kept aaaa111/cccc333 and src/aaaa111', commits), 'kept aaaa111/cccc333 and src/aaaa111',
    'a pair with a non-commit, and a path segment, stay');
});

test('commitTokens keeps only tokens that name a commit in the source history', () => {
  const src = sourceRepo({ 'a.txt': 'x\n' });
  const sha = git(src, 'rev-parse', 'HEAD').trim();
  const blob = git(src, 'rev-parse', 'HEAD:a.txt').trim();
  assert.deepEqual([...commitTokens(src, [sha.slice(0, 7), blob.slice(0, 9), 'abcd123'])], [sha.slice(0, 7)]);
});

test('pruneBaselineShas drops only the identities that name a commit, and leaves a clean baseline alone', () => {
  const src = sourceRepo(FILES);
  const sha = git(src, 'rev-parse', 'HEAD').trim();
  const d = tmp();
  mkdirSync(join(d, 'monitor'));
  const doc = { schema: 'commitwork.pattern-baseline/1', head: sha, identities: [
    `docs/A.md::sha:${sha.slice(0, 7)}::D2`, 'docs/A.md::sha:a1b2c3d::D2', 'bin/x.mjs::loop-catch::K7'] };
  writeFileSync(join(d, PATTERN_BASELINE), `${JSON.stringify(doc, null, 2)}\n`);
  assert.deepEqual(pruneBaselineShas(src, d, [PATTERN_BASELINE]), { changed: [PATTERN_BASELINE], dropped: 1 });
  const after = JSON.parse(readFileSync(join(d, PATTERN_BASELINE), 'utf8'));
  assert.deepEqual(after.identities, ['docs/A.md::sha:a1b2c3d::D2', 'bin/x.mjs::loop-catch::K7'],
    'a token that is not a commit and an identity with no sha both stay');
  assert.equal(after.head, sha, 'every other field is carried as it was');
  assert.deepEqual(pruneBaselineShas(src, d, [PATTERN_BASELINE]), { changed: [], dropped: 0 }, 'nothing left to drop, nothing written');
  assert.deepEqual(pruneBaselineShas(src, d, []), { changed: [], dropped: 0 }, 'a snapshot without the baseline is untouched');
});

test('swapPublicClaude adds the public variant as CLAUDE.md and refuses when it is absent', () => {
  const d = tmp();
  mkdirSync(join(d, 'release'));
  writeFileSync(join(d, PUBLIC_CLAUDE), '# public\n');
  writeFileSync(join(d, 'README.md'), `- [${PUBLIC_CLAUDE}](${PUBLIC_CLAUDE}) — the public instructions\n`);
  assert.deepEqual(swapPublicClaude(d), { changed: ['CLAUDE.md', 'README.md'], removed: [PUBLIC_CLAUDE] });
  assert.equal(readFileSync(join(d, 'README.md'), 'utf8'), '- [CLAUDE.md](CLAUDE.md) — the public instructions\n', 'the index follows the file');
  assert.equal(readFileSync(join(d, 'CLAUDE.md'), 'utf8'), '# public\n');
  assert.equal(existsSync(join(d, PUBLIC_CLAUDE)), false);
  assert.throws(() => swapPublicClaude(tmp()), /no public CLAUDE\.md/);
});

test('swapPublicClaude drops the export-ignore on CLAUDE.md and keeps every other rule', () => {
  const d = tmp();
  mkdirSync(join(d, 'release'));
  writeFileSync(join(d, PUBLIC_CLAUDE), '# public\n');
  writeFileSync(join(d, '.gitattributes'), '/ci export-ignore\n/CLAUDE.md export-ignore\n*.sh text eol=lf\n');
  assert.deepEqual(swapPublicClaude(d).changed, ['CLAUDE.md', '.gitattributes']);
  assert.equal(readFileSync(join(d, '.gitattributes'), 'utf8'), '/ci export-ignore\n*.sh text eol=lf\n');

  const untouched = tmp();
  mkdirSync(join(untouched, 'release'));
  writeFileSync(join(untouched, PUBLIC_CLAUDE), '# public\n');
  writeFileSync(join(untouched, '.gitattributes'), '/ci export-ignore\n');
  assert.deepEqual(swapPublicClaude(untouched).changed, ['CLAUDE.md'], 'no rule to drop, no change claimed');
});

test('a candidate ships the public CLAUDE.md and no commit SHA from the source history', () => {
  const src = sourceRepo({ ...FILES, '.gitattributes': 'private/** export-ignore\n/CLAUDE.md export-ignore\n' });
  const first = git(src, 'rev-parse', 'HEAD').trim();
  writeFileSync(join(src, 'docs/C.md'), `# C\n\nFixed in ${first.slice(0, 7)} (${first.slice(0, 8)}), not in deadbee1.\n`);
  git(src, 'add', '-A'); git(src, 'commit', '-q', '-m', 'cite');
  const out = join(tmp(), 'rc');
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [CLI, '--out', out, '--skip-tests', '--json'], {
      encoding: 'utf8', env: noPrivateScope({ CW_RELEASE_SOURCE: src, CW_VERDICT_DIR: tmp('cw-rc-verdicts-'), CW_SIDECAR: join(out, 'no-sidecar'), CW_LAUNCHLIST_DIR: join(out, 'no-launchlist') }),
    });
  } catch (e) { stdout = String(e.stdout); }
  const r = JSON.parse(stdout);
  const dest = r.candidate.path;
  assert.equal(r.gates.find((g) => g.gate === 'tree').status, 'pass', JSON.stringify(r.gates.find((g) => g.gate === 'tree')));
  assert.equal(readFileSync(join(dest, 'docs/C.md'), 'utf8'), '# C\n\nFixed in a commit, not in deadbee1.\n');
  assert.equal(readFileSync(join(dest, 'CLAUDE.md'), 'utf8'), '# public\n');
  assert.equal(existsSync(join(dest, PUBLIC_CLAUDE)), false);
  assert.equal(readFileSync(join(dest, '.gitattributes'), 'utf8'), 'private/** export-ignore\n', 'the published repository does not export-ignore its own CLAUDE.md');
  assert.equal(r.candidate.shasStripped, 1);
});
