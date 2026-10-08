// node --test monitor/test/ — the gitleaks lane's three-state verification, asserted by EFFECT.
//
// THE DEFECT THIS PINS. gitleaks performs no verification. The extractor said so and published
// 2,368 rows at `high` anyway. Measured 2026-08-24 on the 100-repo corpus: zero verification fields
// across all 2,368; the sibling TruffleHog lane, which does verify, found 3 live credentials in the
// whole fleet; and 87% of the gitleaks rows sat in test/example paths.
//
// Every test here checks what a row BECOMES, never that a flag is set. The regression these guard
// against is a row with no verdict acquiring a severity — in either direction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyCandidates, verifiedRawSet, seenRawSet, severityFor, candidateKey, candidatesFrom, isRedacted, rawMatches, keyEncryption, isKeyContainer, sharedStaticRefs } from '../secret-verify.mjs';

const th = (raw, verified) => JSON.stringify({ Raw: raw, Verified: verified, DetectorName: 'X' });

// ---- the cross-tool join: gitleaks and TruffleHog capture the SAME key differently -----------
// Measured on webstudio: gitleaks' Secret for a PEM key was 240 bytes, TruffleHog's Raw 241 —
// one trailing newline apart. Byte-equality graded a LIVE key `undetermined`, silently defeating
// the verify pass on exactly the finding it exists to catch.

// armor assembled at run time so the source carries no PEM block for a secrets scanner to lodge as real
const armor = (kind, body) => [`-----BEGIN ${kind}-----`, body, `-----END ${kind}-----`].join('\n');
const PEM = armor('PRIVATE KEY', 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg5plusmorebase64material');

test('a whitespace-only difference between the two tools still verifies the key', () => {
  const run = () => th(PEM + '\n', true); // TruffleHog Raw carries a trailing newline gitleaks did not
  const r = verifyCandidates([{ secret: PEM, rule: 'private-key', file: 'privkey.pem', line: 1 }], { run });
  assert.equal(r.verdicts[0].verified, true, 'a live key must not read undetermined over one newline');
  assert.equal(severityFor(r.verdicts[0].verified), 'crit');
});

const AKIA_X = `AKIA${'X'.repeat(40)}`;

test('rawMatches: exact-after-whitespace, and containment only when both sides are long', () => {
  assert.equal(rawMatches(AKIA_X, new Set([AKIA_X])), true);
  assert.equal(rawMatches(PEM, new Set([PEM + '\n'])), true, 'superstring by whitespace');
  assert.equal(rawMatches(PEM + '\n', new Set([PEM])), true, 'substring by whitespace');
  // a short token must NEVER verify by sitting inside a longer unrelated raw
  assert.equal(rawMatches('abc', new Set(['abc-is-inside-this-much-longer-unrelated-string'])), false);
});

// ---- #3 encrypted-container awareness --------------------------------------------------------

test('keyEncryption reads the PEM armor: encrypted vs plaintext vs not-a-key', () => {
  assert.equal(keyEncryption(armor('ENCRYPTED PRIVATE KEY', 'MII...')), 'encrypted');
  assert.equal(keyEncryption(armor('RSA PRIVATE KEY', 'Proc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,AB\n\nMII')), 'encrypted');
  assert.equal(keyEncryption(armor('EC PRIVATE KEY', 'MHc...')), 'plaintext');
  assert.equal(keyEncryption('AKIAIOSFODNN7EXAMPLE'), '', 'a bearer token is not a key container');
});

test('isKeyContainer catches key rules and key file extensions, not bearer tokens', () => {
  assert.equal(isKeyContainer('private-key', 'a.pem'), true);
  assert.equal(isKeyContainer('pkcs12-file', 'certs/Magpie.pfx'), true);
  assert.equal(isKeyContainer('generic-api-key', 'src/app.js'), false);
  assert.equal(isKeyContainer('', 'id_rsa.key'), true, 'extension alone is enough');
});

// ---- #4 shared-static-key detection ----------------------------------------------------------

test('sharedStaticRefs finds NON-TEST source that reads the key, ignores test fixtures', () => {
  const sources = {
    'api/utils/crypt.py': 'rsa = RSA.importKey(open("conf/private.pem").read(), "Welcome")',
    'test/crypt_test.py': 'assert decrypt() # references private.pem in a fixture path',
    'README.md': 'nothing here',
  };
  const refs = sharedStaticRefs('private.pem', sources);
  assert.deepEqual(refs, ['api/utils/crypt.py'], 'the app reads it at a fixed path — a shared static key, not a stray leak');
});

test('sharedStaticRefs is empty when only tests or nothing reference the key', () => {
  assert.deepEqual(sharedStaticRefs('id_rsa', { 'tests/fixtures/id_rsa': 'KEY', 'src/main.go': 'unrelated' }), []);
  assert.deepEqual(sharedStaticRefs('', { 'a': 'b' }), [], 'no basename, no claim');
});

// ---- severity mapping: the whole point -----------------------------------------------------

test('a row with NO verdict gets NO severity — this is the defect, pinned', () => {
  assert.equal(severityFor(null), null,
    'unverified must be undetermined. Returning "high" here is what shipped and what published '
    + '2,368 unverified regex matches as the second-highest severity.');
  assert.notEqual(severityFor(null), 'high');
  assert.notEqual(severityFor(null), 'med', 'nor quietly downgraded — a bucket is an assertion');
});

test('verified is crit, refused is low', () => {
  assert.equal(severityFor(true), 'crit');
  assert.equal(severityFor(false), 'low');
});

// ---- the three states are actually distinguished --------------------------------------------

test('verified / refused / never-asked are three different outcomes', () => {
  // The subprocess is injected, so a live credential is never needed to test the verdict path.
  const run = () => [th('LIVE-KEY', true), th('DEAD-KEY', false)].join('\n');
  const r = verifyCandidates([
    { secret: 'LIVE-KEY', rule: 'aws-access-token', file: 'a.go', line: 1 },
    { secret: 'DEAD-KEY', rule: 'aws-access-token', file: 'b.go', line: 2 },
    { secret: 'NOBODY-ASKED', rule: 'generic-api-key', file: 'c.go', line: 3 },
  ], { run });

  assert.equal(r.verified, 1);
  assert.equal(r.refuted, 1);
  assert.equal(r.unknown, 1, 'a candidate no verifier saw is UNKNOWN, never refuted');
  assert.deepEqual(r.verdicts.map((v) => v.verified), [true, false, null]);
  assert.equal(r.ran, true);
});

test('generic-api-key names no service, so it stays unknown however many others verify', () => {
  // The rule carrying 51 of 70 affected repos. If this ever grades, the lane is lying again.
  const run = () => th('SOMETHING-ELSE', true);
  const r = verifyCandidates([{ secret: 'hi-entropy-blob', rule: 'generic-api-key', file: 'x', line: 1 }], { run });
  assert.equal(r.verdicts[0].verified, null);
  assert.equal(severityFor(r.verdicts[0].verified), null);
});

// ---- fail closed ------------------------------------------------------------------------------

test('a verifier that THROWS yields unknown for everything, never refuted', () => {
  // Reporting a credential as dead because the verifier crashed is the original defect inverted.
  const r = verifyCandidates([
    { secret: 'A', rule: 'r', file: 'f', line: 1 },
    { secret: 'B', rule: 'r', file: 'g', line: 2 },
  ], { run: () => { throw new Error('trufflehog not installed'); } });
  assert.equal(r.unknown, 2);
  assert.equal(r.refuted, 0);
  assert.equal(r.verified, 0);
  assert.deepEqual(r.verdicts.map((v) => v.verified), [null, null]);
});

test('unparseable verifier output is unknown, not clean and not refuted', () => {
  const r = verifyCandidates([{ secret: 'A', rule: 'r', file: 'f', line: 1 }],
    { run: () => 'trufflehog banner\nnot json at all\n' });
  assert.equal(r.verdicts[0].verified, null);
});

test('no runner at all means nothing is claimed', () => {
  const r = verifyCandidates([{ secret: 'A', rule: 'r', file: 'f', line: 1 }], {});
  assert.equal(r.ran, false);
  assert.equal(r.verdicts.length, 0, 'no verdicts rather than null verdicts — nothing was attempted');
});

// ---- the secret must not escape ---------------------------------------------------------------

test('NO return value carries the secret, and the key does not disclose it', () => {
  const SECRET = 'AKIA-SUPER-SECRET-LIVE-KEY';
  const r = verifyCandidates([{ secret: SECRET, rule: 'aws-access-token', file: 'f.go', line: 9 }],
    { run: () => th(SECRET, true) });
  const blob = JSON.stringify(r);
  assert.ok(!blob.includes(SECRET),
    'rollup.json is served over the published tunnel — a secret in a return value reaches the network');
  assert.equal(r.verdicts[0].rule, 'aws-access-token', 'provenance is kept');
  assert.equal(r.verdicts[0].file, 'f.go');
  assert.ok(/^[0-9a-f]{16}$/.test(r.verdicts[0].key), 'the join key is a hash');
});

test('the salt makes keys non-correlatable across invocations', () => {
  // A fixed salt would let the same credential be tracked across runs and rainbow-tabled, which is
  // the thing the hash exists to prevent.
  assert.notEqual(candidateKey('same-secret', 'salt-a'), candidateKey('same-secret', 'salt-b'));
  assert.equal(candidateKey('same-secret', 'salt-a'), candidateKey('same-secret', 'salt-a'));
});

test('the temp tree holding live credentials is removed, even when the runner throws', () => {
  const before = new Set(readdirSync(tmpdir()).filter((f) => f.startsWith('cw-secret-verify-')));
  verifyCandidates([{ secret: 'A', rule: 'r', file: 'f', line: 1 }],
    { run: () => { throw new Error('boom'); } });
  const after = readdirSync(tmpdir()).filter((f) => f.startsWith('cw-secret-verify-') && !before.has(f));
  assert.deepEqual(after, [], 'a crash must not leave live credentials on disk');
});

test('candidate files are written 0600 while they exist', () => {
  let mode = null;
  verifyCandidates([{ secret: 'A', rule: 'r', file: 'f', line: 1 }], {
    run: (dir) => {
      const f = join(dir, readdirSync(dir)[0]);
      mode = statSync(f).mode & 0o777;
      return '';
    },
  });
  assert.equal(mode, 0o600, 'another user on a shared host must not be able to read the candidate');
});

// ---- the redaction trap ------------------------------------------------------------------------
// The published gitleaks.json runs with `--redact`, so every Secret in it is the literal string
// "REDACTED". Measured on the live corpus 2026-08-24: 175 of 175 rows in kenn-io_agentsview. A
// verify pass fed that report finds nothing to verify and would report "0 verified" — a true
// sentence that a reader would take as "no live credentials", which is a different claim entirely.

test('a REDACTED report yields no candidates — the value is not there to verify', () => {
  const redacted = [
    { RuleID: 'generic-api-key', File: 'a.go', StartLine: 1, Secret: 'REDACTED' },
    { RuleID: 'aws-access-token', File: 'b.go', StartLine: 2, Secret: 'REDACTED' },
  ];
  assert.equal(isRedacted(redacted), true);
  assert.deepEqual(candidatesFrom(redacted), [],
    'a literal "REDACTED" must never be sent to a verifier as though it were a credential');
});

test('an empty report is NOT redacted — no rows is a different fact from hidden rows', () => {
  // Collapsing these would make a clean repo indistinguishable from an unverifiable one.
  assert.equal(isRedacted([]), false);
  assert.deepEqual(candidatesFrom([]), []);
});

test('a mixed report keeps only the rows that carry a real value', () => {
  const rows = [
    { RuleID: 'aws-access-token', File: 'a.go', StartLine: 3, Secret: 'AKIAREAL' },
    { RuleID: 'generic-api-key', File: 'b.go', StartLine: 9, Secret: 'REDACTED' },
    { RuleID: 'x', File: 'c.go', StartLine: 1 },                                   // no Secret at all
  ];
  assert.equal(isRedacted(rows), false, 'not every row is redacted, so the report is usable');
  assert.deepEqual(candidatesFrom(rows), [{ secret: 'AKIAREAL', rule: 'aws-access-token', file: 'a.go', line: 3 }]);
});

test('candidatesFrom accepts both artifact shapes gitleaks emits', () => {
  const row = { RuleID: 'r', File: 'f', StartLine: 1, Secret: 'S' };
  assert.equal(candidatesFrom([row]).length, 1, 'bare array');
  assert.equal(candidatesFrom({ findings: [row] }).length, 1, 'wrapped in findings');
  assert.deepEqual(candidatesFrom(null), [], 'a missing report is not a crash');
});

// ---- parser narrowness ------------------------------------------------------------------------

test('only Verified===true counts as verified', () => {
  const out = [th('a', true), th('b', false), JSON.stringify({ Raw: 'c' })].join('\n');
  assert.deepEqual([...verifiedRawSet(out)], ['a']);
  assert.deepEqual([...seenRawSet(out)].sort(), ['a', 'b'],
    'a record with no Verified field was not a verifier result and must not imply one');
});

test('NOT VACUOUS: an all-unknown result is what an empty verifier produces', () => {
  // If verifyCandidates ignored its runner and returned null for everything, the three-state test
  // above would still pass on its third case. Prove a runner that verifies EVERYTHING is obeyed.
  const r = verifyCandidates([
    { secret: 'A', rule: 'r', file: 'f', line: 1 },
    { secret: 'B', rule: 'r', file: 'g', line: 2 },
  ], { run: () => [th('A', true), th('B', true)].join('\n') });
  assert.equal(r.verified, 2, 'an oracle that verifies everything must produce two verified rows');
  assert.equal(r.unknown, 0);
});
