// Secondary evidence for an already-marked false positive. The load-bearing assertions are that
// weak never becomes corroborated, that "no verifier could be asked" is neither corroborated nor
// refuted, and that the git witness really runs — a silently broken git fixture would collapse
// every rolled case to weak and pass a lazily written suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TIERS, classifyReason, isTestPath, decodeJwt, publishedExample, traceToken,
  verifyTestFixture, verifyExpired, verifyRolled, verifyAnnotation, findAnnotation, loadAnnotations,
  statusFor,
} from '../routes/leaks-verify.mjs';

const NOW = '2026-06-01T00:00:00.000Z';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${b64u(payload)}.c2lnbmF0dXJlX2hlcmU`;

const OLD_SECRET = 'ghp_oldoldoldoldoldoldoldoldoldold0123';
const NEW_SECRET = 'ghp_newnewnewnewnewnewnewnewnewnew9876';

// ---- git fixture: one file whose secret changed, one that never did ----------------------------
const gitRepo = mkdtempSync(join(tmpdir(), 'cw-lv-git-'));
const g = (...args) => execFileSync('git', args, { cwd: gitRepo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

g('init', '-q', '-b', 'main');
mkdirSync(join(gitRepo, 'src'), { recursive: true });
writeFileSync(join(gitRepo, 'src', 'app.js'), `const token = "${OLD_SECRET}";\n`);
writeFileSync(join(gitRepo, 'src', 'stale.js'), `const token = "${OLD_SECRET}";\n`);
g('add', '-A');
execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first'],
  { cwd: gitRepo, env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' }, stdio: ['ignore', 'pipe', 'pipe'] });
writeFileSync(join(gitRepo, 'src', 'app.js'), `const token = "${NEW_SECRET}";\n`);
g('add', '-A');
execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'rotate'],
  { cwd: gitRepo, env: { ...process.env, GIT_AUTHOR_DATE: '2026-03-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-03-01T00:00:00Z' }, stdio: ['ignore', 'pipe', 'pipe'] });

const ANNOTATED_AT = '2026-02-01T00:00:00.000Z';
const notARepo = mkdtempSync(join(tmpdir(), 'cw-lv-bare-'));

// ---- vacuity: the harness itself, before any assertion about the module -----------------------

test('VACUITY: the git fixture really has the two commits the rolled checks depend on', () => {
  const log = g('log', '--format=%H %ad', '--date=short');
  const lines = log.split('\n').filter(Boolean);
  assert.equal(lines.length, 2, 'a one-commit fixture would make every rolled case weak by accident');
  assert.match(log, /2026-03-01/);
  assert.match(log, /2026-01-01/);
  // independent of the module: the pickaxe the module uses finds the rotation from this shell too
  const pick = g('log', '--format=%H', `-G${NEW_SECRET}`, '--', 'src/app.js');
  assert.equal(pick.split('\n').filter(Boolean).length, 1, 'git -G must see the rotation, or verifyRolled is testing nothing');
});

test('VACUITY: the imported surface is live code, not a stub', () => {
  for (const fn of [classifyReason, isTestPath, decodeJwt, publishedExample, traceToken,
    verifyTestFixture, verifyExpired, verifyRolled, verifyAnnotation]) assert.equal(typeof fn, 'function');
  assert.deepEqual(TIERS, ['strong', 'medium', 'weak']);
  // the assertions below can fail: the same verifier returns opposite verdicts on opposite inputs
  const a = verifyExpired({ matched: jwt({ exp: 1000000000 }), now: NOW }).verdict;
  const b = verifyExpired({ matched: jwt({ exp: 4000000000 }), now: NOW }).verdict;
  assert.notEqual(a, b, 'if these agreed, every expiry assertion would be vacuous');
});

// ---- reason classification ---------------------------------------------------------------------

test('classifyReason maps the three checkable claims and refuses to guess at the rest', () => {
  assert.equal(classifyReason('it is a test fixture'), 'test-fixture');
  assert.equal(classifyReason('sample data in a spec file'), 'test-fixture');
  assert.equal(classifyReason('this token expired months ago'), 'expired');
  assert.equal(classifyReason('key was rotated on the 3rd'), 'rolled');
  assert.equal(classifyReason('rolled already'), 'rolled');
  assert.equal(classifyReason('customer said it was fine'), 'unrecognised');
  assert.equal(classifyReason(''), 'unrecognised');
  assert.equal(classifyReason(null), 'unrecognised');
});

test('the decisive claim wins when a reason states two', () => {
  assert.equal(classifyReason('expired token sitting in a fixture'), 'expired');
  assert.equal(classifyReason('rotated; the fixture still holds the old shape'), 'rolled');
});

// ---- test-fixture ------------------------------------------------------------------------------

test('isTestPath reads directory segments and test-suffixed filenames', () => {
  assert.equal(isTestPath('admin/test/leaks.test.mjs'), true);
  assert.equal(isTestPath('pkg/testdata/keys.json'), true);
  assert.equal(isTestPath('src/__tests__/a.js'), true);
  assert.equal(isTestPath('src/foo.spec.ts'), true);
  assert.equal(isTestPath('src/fixtures/aws.env'), true);
  assert.equal(isTestPath('src/config/prod.js'), false);
  assert.equal(isTestPath('latest/attestations.js'), false);
  assert.equal(isTestPath(''), false);
});

test('AKIAIOSFODNN7EXAMPLE is a weak witness, not a strong one', () => {
  const ex = publishedExample('key = "AKIAIOSFODNN7EXAMPLE"');
  assert.equal(ex.weight, 'default-allowlisted');
  const r = verifyTestFixture({ file: 'src/test/a.js', matched: 'key = "AKIAIOSFODNN7EXAMPLE"' });
  assert.equal(r.tier, 'medium', 'a default-allowlisted string must not promote the path evidence to strong');
  assert.equal(r.verdict, 'supports');
});

test('a test path plus a genuinely published example is strong', () => {
  const line = 'secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"';
  assert.equal(publishedExample(line).weight, 'known');
  const r = verifyTestFixture({ file: 'pkg/fixtures/aws.env', matched: line });
  assert.equal(r.tier, 'strong');
  assert.equal(r.verdict, 'supports');
});

test("jwt.io's example token is recognised by its claims", () => {
  const line = `t = "${jwt({ sub: '1234567890', name: 'John Doe', iat: 1516239022 })}"`;
  assert.equal(publishedExample(line).id, 'jwt.io-example-token');
  assert.equal(verifyTestFixture({ file: 'src/app.js', matched: line }).tier, 'medium');
});

test('neither witness present is weak — not a refutation of the human', () => {
  const r = verifyTestFixture({ file: 'src/config/prod.js', matched: `key = "${['zBqR8xLm', 'N4pQ7wV2yT6a'].join('')}"` });
  assert.equal(r.tier, 'weak');
  assert.equal(r.verdict, 'none', 'a fixture can live outside a test directory; absence here refutes nothing');
});

// ---- expired -----------------------------------------------------------------------------------

test('a past exp corroborates, a future exp refutes, both with zero network', () => {
  const past = verifyExpired({ matched: `t="${jwt({ exp: Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000) })}"`, now: NOW });
  assert.equal(past.tier, 'strong');
  assert.equal(past.verdict, 'supports');
  const future = verifyExpired({ matched: `t="${jwt({ exp: Math.floor(Date.parse('2027-01-01T00:00:00Z') / 1000) })}"`, now: NOW });
  assert.equal(future.tier, 'strong');
  assert.equal(future.verdict, 'contradicts');
});

test('a token with no exp claim, and a line with no token, are both weak', () => {
  const noExp = verifyExpired({ matched: `t="${jwt({ sub: 'abc' })}"`, now: NOW });
  assert.equal(noExp.tier, 'weak');
  assert.equal(noExp.verdict, 'none');
  const noJwt = verifyExpired({ matched: 'password = "hunter2hunter2hunter2"', now: NOW });
  assert.equal(noJwt.tier, 'weak');
  assert.equal(noJwt.verdict, 'none');
  assert.equal(noJwt.checks[0].result, 'unavailable');
});

test('decodeJwt returns null rather than throwing on rubbish', () => {
  assert.equal(decodeJwt('eyJnot.a.jwt'), null);
  assert.equal(decodeJwt(''), null);
  assert.equal(decodeJwt(null), null);
});

// ---- rolled ------------------------------------------------------------------------------------

test('a value that changed since the annotation is strong support', () => {
  const r = verifyRolled({ root: gitRepo, file: 'src/app.js', at: ANNOTATED_AT, matched: `const token = "${NEW_SECRET}";` });
  assert.equal(r.verdict, 'supports');
  assert.equal(r.tier, 'strong');
  assert.equal(r.checks.find((c) => c.name === 'blob-at-annotation').result, 'pass');
  assert.equal(r.checks.find((c) => c.name === 'pickaxe-G').result, 'pass');
});

test('a value untouched since the annotation refutes "rolled"', () => {
  const r = verifyRolled({ root: gitRepo, file: 'src/stale.js', at: ANNOTATED_AT, matched: `const token = "${OLD_SECRET}";` });
  assert.equal(r.verdict, 'contradicts');
  assert.equal(r.tier, 'strong');
});

test('no repository, no timestamp and no traceable run each end weak, never refuted', () => {
  const noRepo = verifyRolled({ root: notARepo, file: 'src/app.js', at: ANNOTATED_AT, matched: `x="${NEW_SECRET}"` });
  assert.equal(noRepo.tier, 'weak');
  assert.equal(noRepo.verdict, 'none');
  const noAt = verifyRolled({ root: gitRepo, file: 'src/app.js', at: null, matched: `x="${NEW_SECRET}"` });
  assert.equal(noAt.verdict, 'none');
  const noToken = verifyRolled({ root: gitRepo, file: 'src/app.js', at: ANNOTATED_AT, matched: 'k = "short"' });
  assert.equal(noToken.verdict, 'none');
  assert.equal(noToken.checks[0].result, 'unavailable');
});

test('an untracked file yields weak, not a verdict', () => {
  const r = verifyRolled({ root: gitRepo, file: 'src/never-committed.js', at: ANNOTATED_AT, matched: `x="${NEW_SECRET}"` });
  assert.equal(r.tier, 'weak');
  assert.equal(r.verdict, 'none');
});

test('the rolled check uses -G, so a value that merely moved is still seen as unchanged evidence', () => {
  // -S would report a count change of zero for a pure move; the blob witness is what settles it.
  const moved = mkdtempSync(join(tmpdir(), 'cw-lv-move-'));
  const gm = (env, ...args) => execFileSync('git', args, { cwd: moved, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  gm({}, 'init', '-q', '-b', 'main');
  writeFileSync(join(moved, 'a.js'), `const t = "${OLD_SECRET}";\nother();\n`);
  gm({}, 'add', '-A');
  gm({ GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' },
    '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first');
  writeFileSync(join(moved, 'a.js'), `other();\nconst t = "${OLD_SECRET}";\n`);
  gm({}, 'add', '-A');
  gm({ GIT_AUTHOR_DATE: '2026-03-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-03-01T00:00:00Z' },
    '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'move');
  const r = verifyRolled({ root: moved, file: 'a.js', at: ANNOTATED_AT, matched: `const t = "${OLD_SECRET}";` });
  assert.equal(r.verdict, 'contradicts', 'the line moved but the value did not; "rolled" is refuted');
  // the two flags are not interchangeable on this fixture, which is why the module pins -G
  const withG = gm({}, 'log', '--format=%H', `-G${OLD_SECRET}`, '--', 'a.js').split('\n').filter(Boolean);
  const withS = gm({}, 'log', '--format=%H', `-S${OLD_SECRET}`, '--', 'a.js').split('\n').filter(Boolean);
  assert.equal(withG.length, 2, '-G sees the move as a content change');
  assert.equal(withS.length, 1, '-S counts occurrences, so the move is invisible to it');
});

test('the history search is pinned to -G and never issues -S', () => {
  const seen = [];
  const fakeRun = (cwd, args) => {
    seen.push(args);
    if (args[0] === 'rev-parse') return '.git\n';
    if (args[0] === 'rev-list') return 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n';
    if (args[0] === 'show') return 'const token = "nothing-matching-here";\n';
    if (args[0] === 'log') return 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n';
    return null;
  };
  const r = verifyRolled({ root: '/nowhere', file: 'a.js', at: ANNOTATED_AT, matched: `x = "${NEW_SECRET}"`, run: fakeRun });
  assert.equal(r.verdict, 'supports');
  const log = seen.find((a) => a[0] === 'log');
  assert.ok(log, 'the pickaxe must actually be issued');
  assert.ok(log.some((a) => a.startsWith('-G')), 'the pickaxe must be -G');
  assert.ok(!log.some((a) => a.startsWith('-S')), '-S would miss a value that merely moved');
});

// ---- verifyAnnotation: the composed answer ------------------------------------------------------

test('an unrecognised reason is unverified — never corroborated, never refuted', () => {
  const r = verifyAnnotation({ root: gitRepo, repo: 'r', rule: 'generic', file: 'src/app.js', line: 1, reason: 'the vendor told us', at: ANNOTATED_AT, now: NOW });
  assert.equal(r.reasonClass, 'unrecognised');
  assert.equal(r.status, 'unverified');
  assert.equal(r.evidence.tier, 'weak');
});

test('statusFor: weak is terminal whatever verdict rides with it', () => {
  for (const v of ['supports', 'contradicts', 'none']) {
    assert.equal(statusFor('weak', v), 'unverified', `weak/${v} must not be promoted`);
  }
  for (const t of ['strong', 'medium']) {
    assert.equal(statusFor(t, 'none'), 'unverified', `${t}/none has nothing to report`);
    assert.equal(statusFor(t, 'supports'), 'corroborated');
    assert.equal(statusFor(t, 'contradicts'), 'refuted');
  }
});

test('weak tier never renders as corroborated, across every reason class', () => {
  const cases = [
    { file: 'src/config/prod.js', reason: 'test fixture', line: null },
    { file: 'src/app.js', reason: 'expired', line: null },
    { file: 'src/app.js', reason: 'rotated', line: null },
    { file: 'src/app.js', reason: 'the vendor told us', line: 1 },
  ];
  for (const c of cases) {
    const r = verifyAnnotation({ root: gitRepo, repo: 'r', rule: 'generic', at: ANNOTATED_AT, now: NOW, ...c });
    assert.equal(r.evidence.tier, 'weak', `${c.reason} should be weak`);
    assert.equal(r.status, 'unverified', `${c.reason} must not read as corroborated or refuted`);
  }
});

test('a missing line is its own state for a value-dependent claim, and no obstacle to the path check', () => {
  const noLine = verifyAnnotation({ root: gitRepo, repo: 'r', rule: 'generic', file: 'src/app.js', line: null, reason: 'expired', at: ANNOTATED_AT, now: NOW });
  assert.equal(noLine.status, 'unverified');
  assert.match(noLine.checks[0].detail, /no line was supplied/);
  const pathOnly = verifyAnnotation({ root: gitRepo, repo: 'r', rule: 'generic', file: 'pkg/testdata/k.json', line: null, reason: 'test fixture', at: ANNOTATED_AT, now: NOW });
  assert.equal(pathOnly.status, 'corroborated');
  assert.equal(pathOnly.evidence.tier, 'medium');
});

test('a file that is gone is unverified, never a pass', () => {
  const r = verifyAnnotation({ root: gitRepo, repo: 'r', rule: 'generic', file: 'src/vanished.js', line: 4, reason: 'expired', at: ANNOTATED_AT, now: NOW });
  assert.equal(r.status, 'unverified');
  assert.match(r.evidence.detail, /no longer present/);
});

test('a traversal path never reads outside the repo and reports unverified', () => {
  const r = verifyAnnotation({ root: gitRepo, repo: 'r', rule: 'generic', file: '../../etc/passwd', line: 1, reason: 'expired', at: ANNOTATED_AT, now: NOW });
  assert.equal(r.status, 'unverified');
  assert.match(r.evidence.detail, /escapes its repository root/);
});

test('the composed rolled path reads the real line and corroborates', () => {
  const r = verifyAnnotation({ root: gitRepo, repo: 'r', rule: 'generic-api-key', file: 'src/app.js', line: 1, reason: 'key was rotated', at: ANNOTATED_AT, now: NOW });
  assert.equal(r.reasonClass, 'rolled');
  assert.equal(r.status, 'corroborated');
  assert.equal(r.evidence.tier, 'strong');
});

// The guarded thing is the PROPERTY — no field of any response carries the value — not the scrub
// that currently helps hold it. A future detail string that interpolated the match fails here.
test('the secret never survives into any response field, whichever verifier ran', () => {
  const tok = jwt({ exp: Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000), jti: 'aQ7zR2xW9pL4vN6m' });
  writeFileSync(join(gitRepo, 'src', 'jwt.js'), `const t = "${tok}";\n`);
  const cases = [
    { file: 'src/app.js', reason: 'key was rotated', secret: NEW_SECRET },
    { file: 'src/stale.js', reason: 'key was rotated', secret: OLD_SECRET },
    { file: 'src/jwt.js', reason: 'this token expired', secret: tok },
  ];
  for (const c of cases) {
    const r = verifyAnnotation({ root: gitRepo, repo: 'r', rule: 'generic-api-key', file: c.file, line: 1, reason: c.reason, at: ANNOTATED_AT, now: NOW });
    assert.ok(!JSON.stringify(r).includes(c.secret), `${c.file}: the matched value must not reach the caller`);
    assert.notEqual(r.status, undefined);
  }
});

test('a human who pasted the secret into their reason does not get it echoed back', () => {
  const r = verifyAnnotation({ root: gitRepo, repo: 'r', rule: 'generic-api-key', file: 'src/app.js', line: 1,
    reason: `rotated — the old one was ${NEW_SECRET}`, at: ANNOTATED_AT, now: NOW });
  assert.ok(!JSON.stringify(r).includes(NEW_SECRET), 'the reason field is caller-authored prose and can quote the value');
  assert.match(r.reason, /\[redacted\]/);
});

test('identity is (repo, rule, file) — the line is evidence and moves the answer for nothing else', () => {
  writeFileSync(join(gitRepo, 'src', 'shift.js'), `// header\nconst token = "${NEW_SECRET}";\n`);
  const a = verifyAnnotation({ root: gitRepo, repo: 'r', rule: 'generic', file: 'src/app.js', line: 1, reason: 'test fixture', at: ANNOTATED_AT, now: NOW });
  const b = verifyAnnotation({ root: gitRepo, repo: 'r', rule: 'generic', file: 'src/app.js', line: 99, reason: 'test fixture', at: ANNOTATED_AT, now: NOW });
  assert.equal(a.status, b.status);
  assert.deepEqual({ repo: a.repo, rule: a.rule, file: a.file }, { repo: b.repo, rule: b.rule, file: b.file });
});

// ---- the annotation store ------------------------------------------------------------------------

test('findAnnotation matches on (repo, rule, file) and honours expiry', () => {
  const recs = [
    { category: 'secrets', repo: 'demo', rule: 'aws-key', file: 'src/a.js', action: 'false-positive', reason: 'test fixture', at: '2026-01-01T00:00:00Z', expires: '2027-01-01T00:00:00Z' },
    { category: 'secrets', repo: 'demo', rule: 'jwt', file: 'src/b.js', action: 'false-positive', reason: 'expired', at: '2026-01-01T00:00:00Z', expires: '2026-02-01T00:00:00Z' },
  ];
  assert.equal(findAnnotation(recs, { repo: 'demo', rule: 'aws-key', file: 'src/a.js' }, NOW).reason, 'test fixture');
  assert.equal(findAnnotation(recs, { repo: 'demo', rule: 'jwt', file: 'src/b.js' }, NOW), null, 'a lapsed record is not an active reason');
  assert.equal(findAnnotation(recs, { repo: 'other', rule: 'aws-key', file: 'src/a.js' }, NOW), null);
});

test('the store fails closed: absent is empty, unreadable is an error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-lv-store-'));
  const prev = process.env.CW_ANNOTATIONS;
  try {
    process.env.CW_ANNOTATIONS = join(dir, 'missing.json');
    const absent = loadAnnotations();
    assert.equal(absent.ok, true);
    assert.deepEqual(absent.records, []);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{ not json');
    process.env.CW_ANNOTATIONS = bad;
    const broken = loadAnnotations();
    assert.equal(broken.ok, false, 'a parse failure must not read as an empty store');
    assert.match(broken.error, /unreadable/);
  } finally {
    if (prev === undefined) delete process.env.CW_ANNOTATIONS; else process.env.CW_ANNOTATIONS = prev;
  }
});

test('the store path is read at call time, not at module load', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-lv-late-'));
  const p = join(dir, 'late.json');
  writeFileSync(p, JSON.stringify({ scannerAnnotations: [{ category: 'secrets', repo: 'demo', rule: 'r', file: 'f', action: 'accept', at: '2026-01-01T00:00:00Z' }] }));
  const prev = process.env.CW_ANNOTATIONS;
  try {
    process.env.CW_ANNOTATIONS = p;
    assert.equal(loadAnnotations().records.length, 1, 'an env read at import would have missed this');
  } finally {
    if (prev === undefined) delete process.env.CW_ANNOTATIONS; else process.env.CW_ANNOTATIONS = prev;
  }
});
