// secrets-sweep.test.mjs — the sweep's core properties: an unreadable file is a FAILURE never a
// clean file, repo digests are not secrets, and two runs are byte-identical.
//
// secrets-sweep-fixture: every credential below is synthetic and authenticates to nothing.
// The declaration above is read by bin/secrets-sweep.mjs (FIXTURE_MARKER): findings here downgrade
// to declared-fixture — still found, counted and listed; `--no-fixture-exempt` ignores it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { withUnreadable, ignoresPermissions, REFUSED_ERRNO } from '../../lib/fs-unreadable.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sweep, scanLine, exitCode, isPlaceholder, isRepoDigest, looksHighEntropy, truncate,
  VERDICT, UNSCANNED, parseArgs, secretsRoot, maxBytes, pushAll,
  isBinding, dsnService, looksLikeIdentifier, FIXTURE_MARKER, isIntegrityDigest,
} from '../secrets-sweep.mjs';
import { scoreCounts, runScenario, SCENARIOS, PLANTS, DECOYS } from '../secrets-canary.mjs';
import { verdictFor, parseArgs as parsePrePublishArgs } from '../pre-publish.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'secrets-sweep.mjs');
const PREPUB = resolve(HERE, '..', 'pre-publish.mjs');

// ── synthetic credentials ───────────────────────────────────────────────────────────────────
// Fabricated. Correct prefix, correct length, no account behind any of them. Each prefix is joined
// at run time so the source carries no provider-shaped literal for GitHub push protection to block.
const FAKE = {
  // nosemgrep: generic.secrets.security.detected-aws-access-key-id-value.detected-aws-access-key-id-value -- synthetic test value, not a credential
  aws: 'AKIAFR5ZYQP3MZKW3TAC',
  github: 'ghp' + '_eJ8CdjEmmFsL9XhG86QxNh2gKWx45g5v534B',
  githubPat: 'github' + '_pat_HE4NqRhBdZsCYEJP2eFfcppxrQF7Nq',
  google: 'AI' + 'zaxXx9MaXsRqaqJG4hMnuwrjACVe657FuZ8Fh',
  slack: 'xo' + 'xb-2419081273-4471928374615-XMsyRkYBcwHaXk9cMm2X97uD',
  npm: 'npm' + '_zdJfmeBsjxSBP9wBJ4CFn3kg2XqSdgEu8wcp',
  skToken: 'sk-' + 'ant-api03-6Sem9H4jbFc9xYTHHPpRe85Kqjs8t2zJtYsCuLf5',
  stripe: 'sk' + '_live_nWgzGPWZknhXm95bjYN3UxgJ',
  sendgrid: 'SG' + '.8Dng59GMNQWhButNRs2gAg.DMNZSmEvyQ6Rp3bYA58NnMdfVzfq4y4XSQkabDhNp5w',
  // nosemgrep: generic.secrets.security.detected-jwt-token.detected-jwt-token -- synthetic test value, not a credential
  jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6Ik5vYm9keSJ9.q3TmpRs9k7Vd2XcF8bLn4WgYuHz1ApQeR6MjNsK0iCo',
  // the credential is the USERINFO — no password component, reads as an ordinary URL
  dsn: 'https://3ae83aed47acdd4168a73bfb74ab9e9e@ingest.example.net/7',
  connString: 'postgres://svcuser:Zx9Kq2Mw7Tb4@db.internal.test:5432/app',
  bearer: 'Authorization: Bearer c9Xt4Kq7ZbR2mLp8Wf3Yh6Nd1Ae5Sv0Gu',
  assigned: 'client_secret = "Tq7Rm2Xz9Kb4Lw8Yc1Nf6Vd3Hs5Gp0J"',
  entropy: 'blob=Wq83Zm1Kx7Rt4Bv9Nc2Ly6Ph0Sd5Jg1',
  privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
};

// Genuine digests of the string "cw" — real hashes, not secrets.
const COMMIT_SHA = '8e425ff79c7c294266f1a4093c553d06af472609';                       // 40 hex
const SHA256 = '57c0c455d8387d98c1c911b2508f888b869fa54df4c06e1c2207db65924b5546';   // 64 hex

const TMP_ROOTS = [];
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'cw-secrets-'));
  TMP_ROOTS.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);   // Buffer or string; writeFileSync takes both
  }
  return root;
}

process.on('exit', () => {
  for (const r of TMP_ROOTS) { try { rmSync(r, { recursive: true, force: true }); } catch { /* best effort */ } }
});

// Runs the sweep with the env seam set at call time.
function sweepIn(root, paths = ['e']) {
  const prev = process.env.CW_SECRETS_ROOT;
  process.env.CW_SECRETS_ROOT = root;
  try { return sweep(paths); } finally {
    if (prev === undefined) delete process.env.CW_SECRETS_ROOT; else process.env.CW_SECRETS_ROOT = prev;
  }
}

function runCli(root, args = ['--paths', 'e']) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8', env: { ...process.env, CW_SECRETS_ROOT: root },
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

const classesOf = (r) => new Set(r.findings.map((f) => f.cls));

// ── pattern classes ─────────────────────────────────────────────────────────────────────────
// One planted fake per class.
const CLASS_CASES = [
  ['provider-key/aws', `key: ${FAKE.aws}`],
  ['provider-key/github', `token: ${FAKE.github}`],
  ['provider-key/github-pat', `pat: ${FAKE.githubPat}`],
  ['provider-key/google', `maps: ${FAKE.google}`],
  ['provider-key/slack', `bot: ${FAKE.slack}`],
  ['provider-key/npm', `registry: ${FAKE.npm}`],
  ['provider-key/sk-token', `anthropic: ${FAKE.skToken}`],
  ['provider-key/stripe', `payments: ${FAKE.stripe}`],
  ['provider-key/sendgrid', `mail: ${FAKE.sendgrid}`],
  ['jwt', `session: ${FAKE.jwt}`],
  ['private-key', FAKE.privateKey],
  ['credential-url/dsn-userinfo', `sentry: ${FAKE.dsn}`],
  ['credential-url/userinfo-password', `db: ${FAKE.connString}`],
  ['bearer-credential', `curl -H '${FAKE.bearer}'`],
  ['assigned-credential', FAKE.assigned],
  ['high-entropy', FAKE.entropy],
];

for (const [cls, line] of CLASS_CASES) {
  test(`class ${cls} — planted fake is found and called a real secret`, () => {
    const hits = scanLine(line, 1);
    const hit = hits.find((h) => h.cls === cls);
    assert.ok(hit, `expected ${cls} in ${JSON.stringify(hits.map((h) => h.cls))}`);
    assert.equal(hit.verdict, VERDICT.SECRET,
      `${cls} was classified ${hit.verdict}; a synthetic-but-well-formed credential must not be waved through as a placeholder`);
    assert.ok(hit.match.length <= 60, 'match is truncated to 60 characters');
  });
}

test('the DSN class is the one that needs no password component', () => {
  assert.ok(!/:[^/@]*@/.test(FAKE.dsn.replace('https://', '')), 'fixture has no password component');
  const hits = scanLine(FAKE.dsn, 1);
  assert.equal(hits.filter((h) => h.cls === 'credential-url/dsn-userinfo').length, 1);
});

test('an ordinary URL with a human username is not a credential', () => {
  const hits = scanLine('see https://alice@example.org/notes and http://docs.internal/x', 1);
  assert.deepEqual(hits.filter((h) => h.cls.startsWith('credential-url')), []);
});

// ── the exclusions this repository lives or dies by ─────────────────────────────────────────
test('a 40-hex commit SHA does not alert', () => {
  assert.ok(isRepoDigest(COMMIT_SHA));
  assert.ok(!looksHighEntropy(COMMIT_SHA));
  const hits = scanLine(`verified-against: 2026-08-20 ${COMMIT_SHA}`, 1);
  assert.deepEqual(hits, [], `commit SHA alerted as ${JSON.stringify(hits.map((h) => h.cls))}`);
});

test('a 64-hex sha256 digest does not alert', () => {
  assert.ok(isRepoDigest(SHA256));
  assert.ok(!looksHighEntropy(SHA256));
  assert.deepEqual(scanLine(`"digest": "${SHA256}"`, 1), []);
});

test('a digest assigned to a credential-shaped key still does not alert', () => {
  // `token: <40 hex>` is the shape a journal entry takes
  assert.deepEqual(scanLine(`token: ${COMMIT_SHA}`, 1), []);
  assert.deepEqual(scanLine(`secret_key = "${SHA256}"`, 1), []);
});

test('a lockfile integrity digest is not a secret', () => {
  // an SRI hash is a PUBLIC checksum published in the registry
  const sri = 'sha512-OH6lveCFfcDjX4dbAvCFSYUjJZjNfLPmZFPNJC4pTBHkHVFWLmZBQz4Xk8Az7BjKlWuqE9Cx7DfGhIjKlMnOpQ==';
  assert.ok(isIntegrityDigest(sri));
  assert.ok(!looksHighEntropy(sri));
  assert.deepEqual(
    scanLine(`      "integrity": "${sri}",`, 1).filter((h) => h.verdict === VERDICT.SECRET), []);
  assert.ok(!isIntegrityDigest('sha512'), 'the prefix alone is not a digest');
  assert.ok(!isIntegrityDigest('shazam-AAAA'), 'only the SRI algorithms count');
});

test('prose and pure digit runs are not high-entropy secrets', () => {
  assert.ok(!looksHighEntropy('averylongsequenceofplainenglishletters'));
  assert.ok(!looksHighEntropy('12345678901234567890123456789012345678'));
  assert.ok(!looksHighEntropy('short1A'));
});

// ── placeholder judgement reads the credential, not the host ────────────────────────────────
test('placeholder credentials are FALSE-POSITIVE, not REAL-SECRET', () => {
  const hits = scanLine('api_key = "YOUR_API_KEY_HERE_1234"', 1);
  const hit = hits.find((h) => h.cls === 'assigned-credential');
  assert.ok(hit);
  assert.equal(hit.verdict, VERDICT.PLACEHOLDER);
  assert.ok(isPlaceholder('<your-token-here>'));
  assert.ok(isPlaceholder('xxxxxxxxxxxxxxxx'));
  assert.ok(isPlaceholder('${GITHUB_TOKEN}'));
});

test('the base32 alphabet is a constant, not a maximum-entropy secret', () => {
  // an alphabet constant is maximum-entropy by construction (admin/auth.mjs holds one for TOTP)
  assert.ok(isPlaceholder('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'));
  assert.equal(scanLine('const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";', 1)
    .find((h) => h.cls === 'high-entropy').verdict, VERDICT.PLACEHOLDER);
});

test('a demo hostname does not make the credential fake', () => {
  // the placeholder test reads the userinfo, never the hostname
  const hit = scanLine(FAKE.dsn, 1).find((h) => h.cls === 'credential-url/dsn-userinfo');
  assert.equal(hit.verdict, VERDICT.SECRET,
    'the finding was downgraded because of its hostname, which is exactly the false clean this rule exists to prevent');
});

test('placeholders are reported, not silently dropped', () => {
  const root = fixture({ 'e/doc.md': 'api_key = "REDACTED_PLACEHOLDER_VALUE"\n' });
  const r = sweepIn(root);
  assert.equal(r.summary[VERDICT.PLACEHOLDER], 1);
  assert.equal(r.summary[VERDICT.SECRET], 0);
  assert.equal(exitCode(r), 0, 'a placeholder alone is not a finding');
});

// ── sensitive context is its own class ──────────────────────────────────────────────────────
// A home path that names an account, assembled at run time so this file does not carry one.
const NAMED_HOME = ['', 'Users', 'op'].join('/');

test('sensitive context is reported separately from credentials', () => {
  const root = fixture({
    'e/notes.md': [
      'contact: example.test@domain.xyx',
      `built at ${NAMED_HOME}/Repositories/client-x`,
      'inference box 10.24.7.31:11434, panel 192.168.1.44:7878',
      'key lives in: security find-generic-password -s commitwork -a VELD_API_KEY',
      'loopback 127.0.0.1:7878 is not interesting',
      'ci runs under /home/runner/work',
      'mail us at noreply@example.com',
    ].join('\n'),
  });
  const r = sweepIn(root);
  const cls = classesOf(r);
  assert.ok(cls.has('context/email'));
  assert.ok(cls.has('context/home-path'));
  assert.ok(cls.has('context/private-ip-port'));
  assert.ok(cls.has('context/keychain-ref'));
  assert.equal(r.summary[VERDICT.SECRET], 0, 'none of this is a credential');
  assert.equal(r.findings.filter((f) => f.cls === 'context/private-ip-port').length, 2,
    'loopback is excluded; both RFC1918 addresses are not');
  assert.equal(r.findings.filter((f) => f.cls === 'context/home-path').length, 1,
    '/home/runner is CI boilerplate, a named /Users home is not');
  assert.equal(r.findings.filter((f) => f.cls === 'context/email').length, 1,
    'example.com and noreply addresses carry nobody');
});

test('sensitive context alone exits 0, and 1 under --fail-on-context', () => {
  const root = fixture({ 'e/notes.md': `built at ${NAMED_HOME}/Repositories/client-x\n` });
  const r = sweepIn(root);
  assert.equal(r.summary[VERDICT.CONTEXT], 1);
  assert.equal(exitCode(r), 0);
  assert.equal(exitCode(r, { failOnContext: true }), 1);
});

// ── fail closed ─────────────────────────────────────────────────────────────────────────────
// UNREADABLE IS CONSTRUCTED PER PLATFORM. `chmod 0o000` is a NO-OP on Windows — node maps only the
// read-only bit — so this built a perfectly readable file, the sweep read it, and the assertion
// failed as though the sweep were broken rather than the fixture. lib/fs-unreadable.mjs denies read
// for real on both platforms (chmod on POSIX, an icacls deny ACE on Windows) and restores
// afterwards. The errno differs — EACCES there, EPERM here — so the assertion now matches the
// REFUSAL rather than one platform's spelling of it, which is what "a read failure is not silence"
// is actually about.
test('an unreadable file is a scan failure, never silence', { skip: ignoresPermissions() ? 'running as root' : false }, (t) => {
  const root = fixture({ 'e/open.md': 'nothing here\n', 'e/locked.md': 'nothing here either\n' });
  const out = withUnreadable(join(root, 'e/locked.md'), () => sweepIn(root));
  if (!out.ran) { t.skip(`could not make the file unreadable: ${out.why}`); return; }
  const r = out.value;
  assert.equal(r.failures.length, 1, 'the unreadable file must appear as a failure');
  assert.equal(r.failures[0].file, 'e/locked.md');
  assert.match(r.failures[0].failure, REFUSED_ERRNO);
  assert.equal(exitCode(r), 2, 'a run that could not read part of its target cannot report clean');
});

test('a scan failure outranks findings — such a run can never exit 0 or 1', { skip: ignoresPermissions() ? 'running as root' : false }, (t) => {
  const root = fixture({ 'e/leak.md': `key: ${FAKE.aws}\n`, 'e/locked.md': 'x\n' });
  const out = withUnreadable(join(root, 'e/locked.md'), () => sweepIn(root));
  if (!out.ran) { t.skip(`could not make the file unreadable: ${out.why}`); return; }
  const r = out.value;
  assert.equal(r.summary[VERDICT.SECRET], 1, 'the secret in the readable file is still found');
  assert.equal(exitCode(r), 2, 'but the verdict is scan-failure, not findings');
});

test('a named path that does not exist is a scan failure, not a clean sweep', () => {
  const root = fixture({ 'e/x.md': 'ok\n' });
  const r = sweepIn(root, ['does-not-exist']);
  assert.equal(r.scannedFiles, 0);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0].failure, /ENOENT/);
  assert.equal(exitCode(r), 2, 'scanning nothing and reporting clean is the unsupported-pass failure');
});

test('a binary file is UNSCANNED — its own state, counted apart from clean', () => {
  const root = fixture({
    'e/blob.dat': Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0xff, 0xfe]),
    'e/pic.png': Buffer.from('not really a png, but the extension decides first'),
    'e/plain.md': 'ordinary text\n',
  });
  const r = sweepIn(root);
  assert.equal(r.scannedFiles, 1);
  assert.equal(r.unscanned.length, 2);
  const reasons = Object.fromEntries(r.unscanned.map((u) => [u.file, u.reason]));
  assert.equal(reasons['e/blob.dat'], UNSCANNED.BINARY);
  assert.equal(reasons['e/pic.png'], UNSCANNED.BINARY_EXT);
  assert.equal(r.summary.unscannedFiles, 2);
  assert.notEqual(r.summary.unscannedFiles, 0);
});

test('an oversized file is UNSCANNED rather than quietly passed', () => {
  const root = fixture({ 'e/big.md': `${'a'.repeat(4096)}\n`, 'e/small.md': 'ok\n' });
  const prev = process.env.CW_SECRETS_MAX_BYTES;
  process.env.CW_SECRETS_MAX_BYTES = '1024';
  try {
    assert.equal(maxBytes(), 1024, 'the size seam is read at call time, after import');
    const r = sweepIn(root);
    assert.equal(r.unscanned.length, 1);
    assert.equal(r.unscanned[0].reason, UNSCANNED.TOO_LARGE);
  } finally {
    if (prev === undefined) delete process.env.CW_SECRETS_MAX_BYTES; else process.env.CW_SECRETS_MAX_BYTES = prev;
  }
});

// ── determinism ─────────────────────────────────────────────────────────────────────────────
test('two sweeps of the same tree are byte-identical', () => {
  const root = fixture({
    'e/z.md': `last: ${FAKE.aws}\n`,
    'e/a.md': `first: ${FAKE.dsn}\n`,
    'e/m/nested.md': `middle: ${FAKE.github}\ncontact: example.test@domain.xyx\n`,
  });
  const a = JSON.stringify(sweepIn(root));
  const b = JSON.stringify(sweepIn(root));
  assert.equal(a, b);
});

test('findings are ordered by file, then line, then column', () => {
  const root = fixture({
    'e/z.md': `k: ${FAKE.aws}\n`,
    'e/a.md': `x ${FAKE.dsn}\nk: ${FAKE.github}\n`,
  });
  const r = sweepIn(root);
  const keys = r.findings.map((f) => `${f.file}:${String(f.line).padStart(4, '0')}:${String(f.col).padStart(4, '0')}`);
  assert.deepEqual(keys, [...keys].sort(), `unstable order: ${JSON.stringify(keys)}`);
  assert.equal(r.findings[0].file, 'e/a.md');
});

test('two hits on one line are ordered by column, not by rule order', () => {
  const hits = scanLine(`${FAKE.aws} then ${FAKE.google}`, 3);
  assert.equal(hits.length, 2);
  assert.ok(hits[0].col < hits[1].col);
  assert.equal(hits[0].line, 3);
});

test('one credential is reported once, not once per overlapping rule', () => {
  // precedence claims the span so one secret is not counted once per overlapping rule
  assert.equal(scanLine(`token: ${FAKE.github}`, 1).length, 1);
  assert.equal(scanLine(FAKE.dsn, 1).length, 1);
});

// ── locale safety ───────────────────────────────────────────────────────────────────────────
test('a secret survives being surrounded by dense UTF-8', () => {
  // Node byte reads are independent of $LC_ALL (grep under a C locale suppresses matches here)
  const root = fixture({
    'e/utf8.md': `— “curly quotes”, emoji 🟢🟠⚪, box drawing ─────, ${FAKE.aws} ✓\n`,
  });
  const r = sweepIn(root, ['e']);
  assert.equal(r.summary[VERDICT.SECRET], 1);
  assert.equal(r.findings[0].cls, 'provider-key/aws');
});

// ── seams and CLI surface ───────────────────────────────────────────────────────────────────
test('CW_SECRETS_ROOT is read at call time', () => {
  const a = fixture({ 'e/x.md': `k: ${FAKE.aws}\n` });
  const b = fixture({ 'e/x.md': 'nothing\n' });
  assert.equal(sweepIn(a).summary[VERDICT.SECRET], 1);
  assert.equal(sweepIn(b).summary[VERDICT.SECRET], 0);
  assert.equal(typeof secretsRoot(), 'string');
});

test('parseArgs covers the documented surface and rejects the rest', () => {
  assert.deepEqual(parseArgs(['--json']).json, true);
  assert.deepEqual(parseArgs(['--paths', 'a,b , c']).paths, ['a', 'b', 'c']);
  assert.equal(parseArgs(['--fail-on-context']).failOnContext, true);
  assert.equal(parseArgs(['--all']).all, true);
  assert.match(parseArgs(['--nope']).error, /unknown flag/);
  assert.match(parseArgs(['--paths']).error, /needs a value/);
});

test('CLI exits 1 on a finding and prints the file, line and class', () => {
  const root = fixture({ 'e/leak.md': `dsn: ${FAKE.dsn}\n` });
  const r = runCli(root);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /REAL-SECRET {2}1/);
  assert.match(r.stdout, /e\/leak\.md:1:\d+ {2}credential-url\/dsn-userinfo/);
});

test('CLI exits 0 on a clean tree and still names the unscanned', () => {
  const root = fixture({ 'e/ok.md': 'nothing to see\n', 'e/img.png': Buffer.from('x') });
  const r = runCli(root);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /UNSCANNED {2}1/);
  assert.match(r.stdout, /not scanned is not clean/);
});

test('CLI --json emits a complete, parseable result', () => {
  const root = fixture({ 'e/leak.md': `k: ${FAKE.aws}\ncontact: example.test@domain.xyx\n` });
  const r = runCli(root, ['--paths', 'e', '--json']);
  assert.equal(r.code, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.summary[VERDICT.SECRET], 1);
  assert.equal(parsed.summary[VERDICT.CONTEXT], 1);
  assert.equal(parsed.scannedFiles, 1);
  assert.ok(Array.isArray(parsed.unscanned) && Array.isArray(parsed.failures));
});

test('a JSON result larger than one pipe buffer survives being piped', () => {
  // pipe writes are async and process.exit() discards unflushed stdout — the payload must exceed
  // one pipe buffer to prove anything
  const lines = [];
  for (let i = 0; i < 900; i++) lines.push(`entry ${i}: contact person${i}@example-consulting.test.com.au at ${NAMED_HOME}/w/${i}`);
  const root = fixture({ 'e/big.md': `${lines.join('\n')}\n` });
  const r = runCli(root, ['--paths', 'e', '--json']);
  assert.ok(r.stdout.length > 65_504,
    `payload was ${r.stdout.length} bytes — too small to prove anything about a 64 KiB buffer`);
  const parsed = JSON.parse(r.stdout);   // throws on truncation, which is the assertion
  assert.equal(parsed.summary[VERDICT.CONTEXT], 1800, 'every finding survived the pipe');
});

test('CLI exits 2 on a bad flag rather than scanning something unintended', () => {
  const root = fixture({ 'e/x.md': 'ok\n' });
  const r = runCli(root, ['--bogus']);
  assert.equal(r.code, 2);
});

test('pushAll survives the array size that broke the spread form', () => {
  // the spread-args ceiling is ~125k, proved against an array rather than 125k real files
  const big = Array.from({ length: 200_000 }, (_, i) => i);
  assert.throws(() => { const t = []; t.push(...big); }, RangeError,
    'if this stops throwing, the ceiling moved and the test below no longer proves anything');
  const target = [7];
  assert.equal(pushAll(target, big).length, 200_001);
  assert.equal(target[0], 7);
  assert.equal(target[200_000], 199_999);
});

test('a wide, nested tree is walked completely and in order', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-secrets-wide-'));
  TMP_ROOTS.push(root);
  for (let d = 0; d < 20; d++) {
    const dir = join(root, 'e', `d${String(d).padStart(3, '0')}`, 'deep');
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 50; i++) writeFileSync(join(dir, `f${i}.txt`), 'ok\n');
  }
  writeFileSync(join(root, 'e', 'leak.md'), `k: ${FAKE.aws}\n`);
  const r = sweepIn(root);
  assert.equal(r.scannedFiles, 1001);
  assert.equal(r.summary[VERDICT.SECRET], 1);
  assert.equal(exitCode(r), 1);
});

test('a crash during the sweep exits 2, never 1', () => {
  // Exit 1 already means "findings". A sweep that never completed must not borrow that word.
  const root = fixture({ 'e/x.md': 'ok\n' });
  const r = runCli(root, ['--paths', 'e', '--max-bytes', 'not-a-number']);
  assert.equal(r.code, 2);
});

// ── (a) literal vs binding ──────────────────────────────────────────────────────────────────
// Every line below is a real one from this repository.
const BINDINGS = [
  'password: body.password',
  'clientSecret: OAUTH_ENV.GOOGLE_OAUTH_CLIENT_SECRET',
  'secret: r.data.totpSecret',
  'const apiKey = Object.values(x)[0]',
  'password: cred.password',
  'client_secret: c.clientSecret',
  'token: CW_TEST_TOKEN',
];
for (const line of BINDINGS) {
  test(`binding is downgraded, not alarmed: ${line.slice(0, 40)}`, () => {
    const hit = scanLine(line, 1).find((h) => h.cls === 'assigned-credential');
    assert.ok(hit, `expected an assigned-credential hit for ${line}`);
    assert.equal(hit.verdict, VERDICT.PLACEHOLDER);
    assert.equal(hit.reason, 'binding',
      'a reference to a credential is not a credential — and the reason must say so, not vanish');
  });
}

test('a QUOTED literal is still a real secret', () => {
  // The other half of the rule. If quoting did not matter, the fix would just be a mute button.
  const hit = scanLine(`api_key = "Tq7Rm2Xz9Kb4Lw8Yc1Nf6Vd3Hs5Gp0J"`, 1)
    .find((h) => h.cls === 'assigned-credential');
  assert.equal(hit.verdict, VERDICT.SECRET);
  assert.equal(hit.reason, undefined);
});

test('isBinding treats a quoted value as a literal whatever it looks like', () => {
  assert.equal(isBinding('body.password', ''), true);
  assert.equal(isBinding('body.password', '"'), false, 'quoting makes it a literal by construction');
  assert.equal(isBinding('CW_TEST_TOKEN', ''), true);
  assert.equal(isBinding('somevariable', ''), true);
  assert.equal(isBinding('Tq7Rm2Xz9Kb4Lw8Yc1Nf6Vd3Hs5Gp0J', ''), false, 'digits mean it may be a key');
});

// ── (a) new provider families ───────────────────────────────────────────────────────────────
const NEW_FAMILIES = [
  ['provider-key/azure-storage',
    'DefaultEndpointsProtocol=https;AccountName=cwstore;Account' + 'Key=Zm9vYmFyMTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6QUJDREVGR0hJSktMTU5PUFFSU1RVVldY==;'],
  ['provider-key/azure-sas', 'https://cwstore.blob.core.windows.net/c/b?sv=2021-06-08&' + 'sig=Rk9PQkFSMTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3Bxcg%3D%3D'],
  ['provider-key/gcp-service-account', '  "type": "service_account",'],
  ['provider-key/twilio', 'sid: S' + 'K3ae83aed47acdd4168a73bfb74ab9e9e'],
  ['provider-key/cloudflare-origin-ca',
    `v1.0-${'ab12cd34ef56ab12cd34ef56'}-${'9f'.repeat(73)}`],
  ['provider-key/cloudflare', 'CLOUDFLARE_API_TOKEN=Rq8ZmT2Xk9Lw4Bc7Yd1Nf6VsHp3Jg0Kq5Tz2'],
  ['provider-key/twilio', 'TWILIO_AUTH_TOKEN="9f2c4b7e1a6d3058c4bf217e9a0d5c63"'],
  ['provider-key/azure', 'AZURE_CLIENT_SECRET=Qm7~Rk2Zt9Xb4Lw8Yc1Nf6Vd5Hs0Gp3Jq'],
];
for (const [cls, line] of NEW_FAMILIES) {
  test(`new family ${cls} is detected`, () => {
    const hit = scanLine(line, 1).find((h) => h.cls === cls);
    assert.ok(hit, `expected ${cls} in ${JSON.stringify(scanLine(line, 1).map((h) => h.cls))}`);
    assert.equal(hit.verdict, VERDICT.SECRET);
  });
}

// ── (a) DSN host naming ─────────────────────────────────────────────────────────────────────
test('a DSN finding names the service, and an unknown host says so', () => {
  assert.equal(dsnService('https', 'app.glitchtip.com'), 'glitchtip');
  assert.equal(dsnService('https', 'o123.ingest.sentry.io'), 'sentry');
  assert.equal(dsnService('postgres', 'db.internal'), 'postgresql');
  assert.equal(dsnService('https', 'some.host.invalid'), 'unknown-service',
    'a host we do not recognise is named as unrecognised, never left blank');
  const hit = scanLine(`dsn: https://3ae83aed47acdd4168a73bfb74ab9e9e@app.glitchtip.com/7`, 1)[0];
  assert.equal(hit.service, 'glitchtip');
});

// ── (a) PII and cloud identifiers ───────────────────────────────────────────────────────────
const PII_CASES = [
  ['context/phone', 'mobile: 0412 345 678'],
  ['context/phone', 'reach me on +61 412 345 678'],
  ['context/national-id', 'ABN: 51 824 753 556'],
  ['context/postal-address', 'invoice to 42 Wattle Grove Terrace'],
  ['context/cloud-account', 'arn:aws:iam::123456789012:role/deploy'],
  ['context/cloud-account', 'TENANT_ID=3ae83aed-47ac-4d41-68a7-3bfb74ab9e9e'],
];
for (const [cls, line] of PII_CASES) {
  test(`PII class ${cls} — ${line.slice(0, 32)}`, () => {
    const hit = scanLine(line, 1).find((h) => h.cls === cls);
    assert.ok(hit, `expected ${cls} in ${JSON.stringify(scanLine(line, 1).map((h) => h.cls))}`);
    assert.equal(hit.verdict, VERDICT.CONTEXT, 'none of this is a credential to rotate');
  });
}

test('an unlabelled number sequence is not a phone number', () => {
  // anchored on a label or a leading + — dates, versions and IP runs are the same characters
  assert.deepEqual(scanLine('released 2026 08 20 build', 1).filter((h) => h.cls === 'context/phone'), []);
  assert.deepEqual(scanLine('range 100 200 300', 1).filter((h) => h.cls === 'context/phone'), []);
});

// ── (a) identifier exclusion ────────────────────────────────────────────────────────────────
test('a long camelCase identifier is not a key', () => {
  assert.ok(looksLikeIdentifier('methodArgumentNotValidReturns422WithFieldErrors'));
  assert.ok(looksLikeIdentifier('Uint8ClampedBufferAttribute'));
  assert.ok(!looksLikeIdentifier('Wq83Zm1Kx7Rt4Bv9Nc2Ly6Ph0Sd5Jg1'), 'a key has no words in it');
  assert.deepEqual(
    scanLine('void methodArgumentNotValidReturns422WithFieldErrors() {}', 1)
      .filter((h) => h.cls === 'high-entropy'), []);
});

test('the identifier test reads the segment, not the whole run', () => {
  // `sk-ant-api03-<key>` contains the words `ant` and `api` — judge the segment, not the run
  assert.ok(looksHighEntropy('6Sem9H4jbFc9xYTHHPpRe85Kqjs8t2zJtYsCuLf5'));
  const hit = scanLine(`k: ${FAKE.skToken}`, 1).find((h) => h.cls === 'provider-key/sk-token');
  assert.equal(hit.verdict, VERDICT.SECRET);
});

test('base32 and base36 alphabet constants are placeholders', () => {
  assert.ok(isPlaceholder('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'));
  assert.ok(isPlaceholder('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
});

// ── (a) declared fixtures ───────────────────────────────────────────────────────────────────
test('a declared fixture is downgraded, listed by name, and never hidden', () => {
  const root = fixture({
    'e/corpus.md': `# ${FIXTURE_MARKER}: synthetic only\nkey: ${FAKE.aws}\n`,
    'e/real.md': `key: ${FAKE.github}\n`,
  });
  const r = sweepIn(root);
  assert.equal(r.summary[VERDICT.SECRET], 1, 'only the undeclared file alarms');
  assert.deepEqual(r.fixtureFiles, ['e/corpus.md'], 'the declaring file is named in the result');
  const downgraded = r.findings.find((f) => f.file === 'e/corpus.md');
  assert.equal(downgraded.verdict, VERDICT.PLACEHOLDER);
  assert.equal(downgraded.reason, 'declared-fixture');
  assert.equal(exitCode(r), 1);
});

test('a declaration below the visible header does not count', () => {
  const root = fixture({
    'e/sneaky.md': `${'filler\n'.repeat(40)}${FIXTURE_MARKER}\nkey: ${FAKE.aws}\n`,
  });
  const r = sweepIn(root);
  assert.equal(r.summary[VERDICT.SECRET], 1,
    'a declaration buried past the header is not a declaration a reviewer would see');
  assert.deepEqual(r.fixtureFiles, []);
});

test('--no-fixture-exempt ignores every declaration', () => {
  const root = fixture({ 'e/corpus.md': `# ${FIXTURE_MARKER}\nkey: ${FAKE.aws}\n` });
  const clean = runCli(root);
  assert.equal(clean.code, 0);
  const strict = runCli(root, ['--paths', 'e', '--no-fixture-exempt']);
  assert.equal(strict.code, 1, 'the pre-publish path must not honour a self-granted exemption');
});

// ── (b) scope: tracked-files default and --head ─────────────────────────────────────────────
function gitFixture(files, { deleteFromWorktree = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cw-secrets-git-'));
  TMP_ROOTS.push(root);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'fixture@example.com');
  git('config', 'user.name', 'fixture');
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  for (const rel of deleteFromWorktree) rmSync(join(root, rel), { force: true });
  return root;
}

test('the default scope is every tracked file, and an untracked file is out of it', () => {
  const root = gitFixture({ 'src/a.md': `k: ${FAKE.aws}\n` });
  writeFileSync(join(root, 'ignored.md'), `k: ${FAKE.github}\n`);
  const prev = process.env.CW_SECRETS_ROOT;
  process.env.CW_SECRETS_ROOT = root;
  try {
    const r = sweep();                       // no paths ⇒ tracked mode
    assert.equal(r.mode, 'tracked');
    assert.equal(r.scannedFiles, 1);
    assert.equal(r.summary[VERDICT.SECRET], 1);
    assert.equal(r.findings[0].file, 'src/a.md');
  } finally {
    if (prev === undefined) delete process.env.CW_SECRETS_ROOT; else process.env.CW_SECRETS_ROOT = prev;
  }
});

test('tracked mode in a non-git directory is a scan failure, never a narrower clean', () => {
  const root = fixture({ 'e/x.md': 'ok\n' });
  const prev = process.env.CW_SECRETS_ROOT;
  process.env.CW_SECRETS_ROOT = root;
  try {
    const r = sweep();
    assert.equal(r.scannedFiles, 0);
    assert.equal(r.failures.length, 1);
    assert.equal(exitCode(r), 2,
      'silently narrowing the scope and keeping the verdict is the false clean this repo catalogues');
  } finally {
    if (prev === undefined) delete process.env.CW_SECRETS_ROOT; else process.env.CW_SECRETS_ROOT = prev;
  }
});

test('--head finds a secret that the worktree no longer has', () => {
  const root = gitFixture(
    { 'kept.md': 'nothing here\n', 'deleted.md': `dsn: ${FAKE.dsn}\n` },
    { deleteFromWorktree: ['deleted.md'] },
  );
  const worktree = runCli(root, ['--json']);
  assert.equal(worktree.code, 0, 'the worktree really is clean of secrets — that is the trap');
  // a tracked-but-deleted file is a named absence — not clean, not a failure
  const wt = JSON.parse(worktree.stdout);
  assert.deepEqual(wt.unscanned, [{ file: 'deleted.md', reason: UNSCANNED.DELETED }]);
  assert.equal(wt.failures.length, 0, 'a tracked-but-deleted file is not a scan failure');

  const head = runCli(root, ['--head', '--json']);
  assert.equal(head.code, 1);
  const parsed = JSON.parse(head.stdout);
  assert.equal(parsed.ref, 'HEAD');
  assert.equal(parsed.summary[VERDICT.SECRET], 1);
  assert.equal(parsed.findings[0].file, 'deleted.md');
  assert.equal(parsed.findings[0].cls, 'credential-url/dsn-userinfo');
});

test('--head leaves no scratch directory behind', () => {
  const root = gitFixture({ 'a.md': `k: ${FAKE.aws}\n` });
  const before = readdirSync(tmpdir()).filter((n) => n.startsWith('cw-secrets-ref-')).length;
  runCli(root, ['--head']);
  const after = readdirSync(tmpdir()).filter((n) => n.startsWith('cw-secrets-ref-')).length;
  assert.equal(after, before, 'the materialised ref is scratch and must not accumulate');
});

test('--head on a ref that does not exist is a scan failure', () => {
  const root = gitFixture({ 'a.md': 'ok\n' });
  const r = runCli(root, ['--head', 'no-such-ref']);
  assert.equal(r.code, 2, 'a ref that cannot be materialised was not scanned and is not clean');
});

test('--head accepts an explicit ref and does not eat a following flag', () => {
  assert.equal(parseArgs(['--head']).head, 'HEAD');
  assert.equal(parseArgs(['--head', '--json']).head, 'HEAD');
  assert.equal(parseArgs(['--head', '--json']).json, true);
  assert.equal(parseArgs(['--head', 'v1.2.3']).head, 'v1.2.3');
});

// ── (c) the canary: class AND count ─────────────────────────────────────────────────────────
test('scoreCounts separates a miss from an extra, and never averages them', () => {
  // a MISS is a false clean, an EXTRA is noise — different failures, never averaged
  assert.deepEqual(scoreCounts({ a: 1 }, { a: 1 }), { ok: true, misses: [], extras: [] });
  const miss = scoreCounts({ a: 3 }, { a: 1 });
  assert.equal(miss.ok, false);
  assert.deepEqual(miss.misses, [{ cls: 'a', want: 3, got: 1 }]);
  assert.deepEqual(miss.extras, []);
  const extra = scoreCounts({ a: 1 }, { a: 1, b: 2 });
  assert.equal(extra.ok, false);
  assert.deepEqual(extra.extras, [{ cls: 'b', want: 0, got: 2 }]);
  assert.deepEqual(extra.misses, []);
});

test('a class that is present but under-counted is still a false clean', () => {
  const s = scoreCounts({ 'credential-url/dsn-userinfo': 3 }, { 'credential-url/dsn-userinfo': 1 });
  assert.equal(s.ok, false);
  assert.equal(s.misses[0].want, 3);
  assert.equal(s.misses[0].got, 1);
});

test('every canary scenario scores correct against the real scanner', () => {
  // plants synthesized under mkdtemp against the REAL scanner; nothing committed as a fixture
  for (const s of SCENARIOS) {
    const r = runScenario(s);
    assert.equal(r.verdict, 'correct',
      `${s.id}: ${JSON.stringify({ misses: r.misses, extras: r.extras, note: r.note })}`);
  }
});

test('the canary plants at least one instance of every class it claims to cover', () => {
  const covered = Object.keys(PLANTS);
  assert.ok(covered.includes('credential-url/dsn-userinfo'),
    'the class both off-the-shelf scanners missed must be in the canary corpus');
  assert.ok(covered.length >= 10, `only ${covered.length} classes planted`);
  for (const cls of covered) {
    const hits = scanLine(PLANTS[cls](), 1).filter((h) => h.verdict === VERDICT.SECRET);
    assert.ok(hits.some((h) => h.cls === cls),
      `plant for ${cls} produced ${JSON.stringify(hits.map((h) => h.cls))}`);
  }
});

test('every canary decoy stays quiet', () => {
  for (const line of DECOYS) {
    const loud = scanLine(line, 1).filter((h) => h.verdict === VERDICT.SECRET);
    assert.deepEqual(loud, [], `decoy alarmed: ${line}`);
  }
});

// ── (c) pre-publish ─────────────────────────────────────────────────────────────────────────
test('verdictFor maps every outcome, and only one of them permits publication', () => {
  const S = (o) => ({ code: 0, error: null, result: { failures: [], unscanned: [], summary: { 'REAL-SECRET': 0, 'SENSITIVE-CONTEXT': 0, ...o } } });
  assert.deepEqual(verdictFor(S({})), { verdict: 'clean', publish: true, exit: 0 });
  assert.deepEqual(verdictFor(S({ 'REAL-SECRET': 1 })), { verdict: 'blocked-secret', publish: false, exit: 1 });
  assert.deepEqual(verdictFor(S({ 'SENSITIVE-CONTEXT': 1 })), { verdict: 'blocked-context', publish: false, exit: 1 });
  // Fail closed: no result, an error, or any scan failure all refuse — never "clean".
  assert.equal(verdictFor({ code: 2, result: null, error: 'boom' }).exit, 2);
  assert.equal(verdictFor({ code: 0, error: null, result: { failures: [{}], unscanned: [], summary: {} } }).verdict, 'cannot-check');
  const withUnscanned = verdictFor({ code: 0, error: null, result: { failures: [], unscanned: [{}], summary: { 'REAL-SECRET': 0, 'SENSITIVE-CONTEXT': 0 } } });
  assert.deepEqual(withUnscanned, { verdict: 'unreviewed-unscanned', publish: false, exit: 2 },
    'an unscanned blob nobody reviewed leaves the check incomplete');
});

test('pre-publish blocks on a secret, on context alone, and passes a clean packet', () => {
  const root = fixture({ 'packet/ok.md': 'nothing to declare\n' });
  const verdicts = join(root, 'verdicts');
  const run = (extra = {}) => {
    try {
      const stdout = execFileSync(process.execPath, [PREPUB, '--paths', 'packet', '--json'], {
        encoding: 'utf8', env: { ...process.env, CW_SECRETS_ROOT: root, CW_VERDICT_DIR: verdicts, CW_SIDECAR: join(root, 'no-sidecar'), ...extra },
      });
      return { code: 0, out: JSON.parse(stdout) };
    } catch (e) {
      return { code: e.status, out: JSON.parse(String(e.stdout || '{}')) };
    }
  };

  let r = run();
  assert.equal(r.code, 0);
  assert.equal(r.out.verdict, 'clean');

  writeFileSync(join(root, 'packet', 'leak.md'), `dsn: ${FAKE.dsn}\n`);
  r = run();
  assert.equal(r.code, 1);
  assert.equal(r.out.verdict, 'blocked-secret');
  rmSync(join(root, 'packet', 'leak.md'));

  // Context is FATAL here and advisory everywhere else. That asymmetry is the whole design.
  writeFileSync(join(root, 'packet', 'who.md'), 'contact example.test@domain.xyx\n');
  r = run();
  assert.equal(r.code, 1);
  assert.equal(r.out.verdict, 'blocked-context');
});

test('pre-publish ignores a self-declared fixture exemption', () => {
  // a self-declared exemption must not cover the thing that ships
  const root = fixture({ 'packet/corpus.md': `# ${FIXTURE_MARKER}\nkey: ${FAKE.aws}\n` });
  const sweepSaysClean = runCli(root, ['--paths', 'packet']);
  assert.equal(sweepSaysClean.code, 0, 'the ordinary sweep honours the declaration');
  try {
    execFileSync(process.execPath, [PREPUB, '--paths', 'packet', '--json'], {
      encoding: 'utf8',
      env: { ...process.env, CW_SECRETS_ROOT: root, CW_VERDICT_DIR: join(root, 'verdicts'), CW_SIDECAR: join(root, 'no-sidecar') },
    });
    assert.fail('pre-publish accepted a self-granted exemption');
  } catch (e) {
    assert.equal(e.status, 1);
    assert.equal(JSON.parse(String(e.stdout)).verdict, 'blocked-secret');
  }
});

test('pre-publish journals its verdict whichever way it goes', () => {
  // clean is the reading that most needs a timestamp beside it
  const root = fixture({ 'packet/ok.md': 'nothing to declare\n' });
  const verdicts = join(root, 'verdicts');
  execFileSync(process.execPath, [PREPUB, '--paths', 'packet'], {
    encoding: 'utf8', env: { ...process.env, CW_SECRETS_ROOT: root, CW_VERDICT_DIR: verdicts, CW_SIDECAR: join(root, 'no-sidecar') },
  });
  const records = readFileSync(join(verdicts, 'pre-publish.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(records.length, 1);
  assert.equal(records[0].verdict, 'clean');
  assert.equal(records[0].gate, 'pre-publish');
  assert.ok(records[0].prev, 'the verdict record is chained like every other');
});

test('pre-publish refuses --paths together with --ref', () => {
  assert.match(parsePrePublishArgs(['--paths', 'a', '--ref', 'v1']).error, /pick one/);
  assert.match(parsePrePublishArgs(['--bogus']).error, /unknown flag/);
  assert.equal(parsePrePublishArgs(['--no-journal']).journalIt, false);
});

test('truncate flattens whitespace and caps at 60', () => {
  assert.equal(truncate('a b'), 'a b');
  assert.equal(truncate('x'.repeat(200)).length, 60);
  assert.equal(truncate('a\n\tb'), 'a b');
});
