// Per-finding detail for the three drill-down categories. Guards, in order: a gitleaks row must
// never carry secret material; the cap must be recorded, never a silent slice; rows must be
// deterministically ordered or rerollup-identical breaks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _gitleaksCounts, _malCounts, _guarddogCounts, DETAIL_CAP } from '../extractors.mjs';
import { ROW_SCHEMAS } from '../detail-schema.mjs';   // the row's declared field set, derived not repeated

const HERE = dirname(fileURLToPath(import.meta.url));

const dir = () => mkdtempSync(join(tmpdir(), 'cw-detail-'));
const put = (d, name, obj) => { writeFileSync(join(d, name), typeof obj === 'string' ? obj : JSON.stringify(obj)); return d; };

// ── gitleaks ────────────────────────────────────────────────────────────────────────────────
const leak = (over = {}) => ({ RuleID: 'aws-access-token', File: 'src/app.js', StartLine: 12,
  Commit: 'abc123', Secret: 'AKIAIOSFODNN7EXAMPLE', Match: 'aws_key = "AKIAIOSFODNN7EXAMPLE"', ...over });

test('gitleaks detail carries provenance, and an UNVERIFIED row is undetermined not high', () => {
  // CHANGED 2026-08-24. This asserted `high === 2` with the note "gitleaks rows have always counted
  // as high". They had — and that was the defect, not a contract. gitleaks performs no verification
  // whatsoever; across the 100-repo corpus the lane published 2,368 rows at high with zero
  // verification fields, while the sibling TruffleHog lane found 3 live credentials in the entire
  // fleet. "Always has" is not a reason for a detector that grades nothing to emit the
  // second-highest severity.
  const d = put(dir(), 'gitleaks.json', [leak(), leak({ File: 'src/b.js', StartLine: 3 })]);
  const c = _gitleaksCounts(d, 'gitleaks.json');
  assert.equal(c.total, 2, 'every row is still counted');
  assert.equal(c.high, 0, 'THE REGRESSION GUARD: never high without a verifier having said so');
  assert.equal(c.undetermined, 2, 'counted in its own field, outside crit/high/med/low');
  // sorted by file, so app.js precedes b.js regardless of the order the artifact listed them
  assert.equal(c.findings[0].rule, 'aws-access-token');
  assert.equal(c.findings[0].file, 'src/app.js');
  assert.equal(c.findings[0].line, 12);
  assert.equal(c.findings[0].sev, '', 'no severity — there is nothing to assert');
  assert.equal(c.findings[0].verified, null, 'null means no verifier was asked, NOT that it is safe');
  assert.equal(c.truncated, undefined, 'an uncapped set must not claim truncation');
});

// redaction is manifest policy, not a format guarantee — the row is built field-by-field so an
// unredacted report still cannot leak
test('no gitleaks field carries secret material, even from an unredacted artifact', () => {
  const d = put(dir(), 'gitleaks.json', [leak()]);
  const c = _gitleaksCounts(d, 'gitleaks.json');
  const serialised = JSON.stringify(c.findings);
  assert.ok(!serialised.includes('AKIAIOSFODNN7EXAMPLE'), `secret value reached the rollup: ${serialised}`);
  assert.ok(!serialised.includes('aws_key ='), 'the matched source line reached the rollup');
  // DERIVED from the declaration, not spelled out. The literal list broke the moment `secrets`
  // gained verified/entropy/testPath — asserting a field list rather than the property this test is
  // named for. The security claim is the two assertions above; this one is the whitelist bound, and
  // it must track the schema or it will keep going stale while looking like a safety check.
  assert.deepEqual(Object.keys(c.findings[0]).sort(), ROW_SCHEMAS.secrets.fields.map((f) => f[0]).sort(),
    'the row must carry exactly the declared fields — no more (a leak) and no fewer (a silent drop)');
});

test('a public-by-design identifier never buckets as crit, even when a verifier says live', () => {
  // gcp-api-key is a Firebase/GCP BROWSER key: public by design, restricted by API not by secrecy.
  // A verifier can report it live; publishing it crit is the fabricated-critical the house rule bars.
  // nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret -- synthetic test value, not a credential
  const d = put(dir(), 'gitleaks.json', [{ RuleID: 'gcp-api-key', File: 'src/firebase.js', StartLine: 2, Commit: 'abc', Secret: 'AIzaSyPUBLICBROWSERKEY0000000000000000000' }]);
  put(d, 'gitleaks-verify.json', { ran: true, verdicts: [{ file: 'src/firebase.js', line: 2, rule: 'gcp-api-key', verified: true }] });
  const c = _gitleaksCounts(d, 'gitleaks.json');
  assert.equal(c.crit, 0, 'a public identifier must not publish crit however the verifier graded it');
  assert.equal(c.undetermined, 1, 'it lands in undetermined, outside crit/high/med/low');
  assert.equal(c.findings[0].sev, '', 'no severity bucket');
  assert.equal(c.findings[0].verified, true, 'the raw claim is PRESERVED, never erased');
  assert.equal(c.findings[0].publicByDesign, true, 'and the reason it did not bucket is disclosed');
});

test('a real detector in the same run still verifies to crit — the demotion is narrow', () => {
  const d = put(dir(), 'gitleaks.json', [{ RuleID: 'aws-access-token', File: 'src/a.js', StartLine: 1, Commit: 'x', Secret: 'AKIAREALKEYMATERIAL0000' }]);
  put(d, 'gitleaks-verify.json', { ran: true, verdicts: [{ file: 'src/a.js', line: 1, rule: 'aws-access-token', verified: true }] });
  const c = _gitleaksCounts(d, 'gitleaks.json');
  assert.equal(c.crit, 1, 'a verified non-public credential still grades crit');
  assert.equal(c.findings[0].publicByDesign, false);
});

test('context classifies locale / minified / vendored beyond test paths', () => {
  const rows = [
    { RuleID: 'discord-client-secret', File: 'src/i18n/locales/fr/layout.json', StartLine: 63, Commit: 'a', Secret: 'x' },
    { RuleID: 'airtable-api-key', File: 'resources/js/tabler-icons.min.js', StartLine: 5, Commit: 'a', Secret: 'x' },
    { RuleID: 'private-key', File: 'thirdparty/mbedtls/library/pk_internal.h', StartLine: 36, Commit: 'a', Secret: 'x' },
    { RuleID: 'aws-access-token', File: 'src/app.js', StartLine: 9, Commit: 'a', Secret: 'x' },
  ];
  const c = _gitleaksCounts(put(dir(), 'gitleaks.json', rows), 'gitleaks.json');
  const ctx = Object.fromEntries(c.findings.map((f) => [f.file.split('/').slice(-1)[0], f.context]));
  assert.equal(ctx['layout.json'], 'locale');
  assert.equal(ctx['tabler-icons.min.js'], 'minified');
  assert.equal(ctx['pk_internal.h'], 'vendored');
  assert.equal(ctx['app.js'], '', 'ordinary source has no context flag');
});

test('the cap is recorded, never a silent slice', () => {
  // sized off the cap, not hardcoded — a cap test must scale with the cap it guards
  const N = DETAIL_CAP + 50;
  const many = Array.from({ length: N }, (_, i) => leak({ File: `src/f${String(i).padStart(5, '0')}.js`, StartLine: i }));
  const c = _gitleaksCounts(put(dir(), 'gitleaks.json', many), 'gitleaks.json');
  assert.equal(c.findings.length, DETAIL_CAP);
  assert.equal(c.truncated, N - DETAIL_CAP, 'the dropped remainder must be stated');
  assert.equal(c.total, N, 'the COUNT is never capped — only the detail is');
});

test('a set at exactly the cap is NOT reported as truncated', () => {
  // an off-by-one here would claim dropped rows that do not exist
  const many = Array.from({ length: DETAIL_CAP }, (_, i) => leak({ File: `src/f${String(i).padStart(5, '0')}.js`, StartLine: i }));
  const c = _gitleaksCounts(put(dir(), 'gitleaks.json', many), 'gitleaks.json');
  assert.equal(c.findings.length, DETAIL_CAP);
  assert.equal(c.truncated, undefined, 'nothing was dropped, so nothing may be claimed dropped');
});

test('detail rows are deterministically ordered, whatever order the artifact lists them', () => {
  const rows = [leak({ File: 'z.js', StartLine: 1 }), leak({ File: 'a.js', StartLine: 9 }), leak({ File: 'a.js', StartLine: 2 })];
  const fwd = _gitleaksCounts(put(dir(), 'gitleaks.json', rows), 'gitleaks.json');
  const rev = _gitleaksCounts(put(dir(), 'gitleaks.json', [...rows].reverse()), 'gitleaks.json');
  assert.deepEqual(fwd.findings, rev.findings, 'input order changed the output — rerollup-identical would break');
  assert.deepEqual(fwd.findings.map((f) => `${f.file}:${f.line}`), ['a.js:2', 'a.js:9', 'z.js:1']);
});

test('an absent artifact is null (a void), not an empty findings list', () => {
  assert.equal(_gitleaksCounts(dir(), 'gitleaks.json'), null,
    'absent must stay null so the ran/skipped/noscan join reports the void rather than a clean zero');
});

// ── OSV MAL- ────────────────────────────────────────────────────────────────────────────────
const sarif = (results, rules = []) => ({ runs: [{ tool: { driver: { rules } }, results }] });
const malResult = (id, pkg, ver, uri = 'package-lock.json') => ({
  ruleId: id, message: { text: `Package '${pkg}@${ver}' is malicious (${id})` },
  locations: [{ physicalLocation: { artifactLocation: { uri } } }],
});

test('MAL- advisories are extracted with package, ecosystem and advisory link', () => {
  const d = put(dir(), 'osv.sarif', sarif([
    malResult('MAL-2025-47', '@ctrl/tinycolor', '4.1.1'),
    { ruleId: 'CVE-2024-1', message: { text: "Package 'lodash@4.0.0' has a CVE" }, locations: [] },
  ]));
  const c = _malCounts(d, 'osv.sarif');
  assert.equal(c.total, 1, 'ordinary CVEs must not be counted as malware');
  assert.equal(c.crit, 1, 'a confirmed-malicious package has no severity gradient');
  assert.deepEqual(c.findings[0], { id: 'MAL-2025-47', package: '@ctrl/tinycolor', version: '4.1.1',
    ecosystem: 'npm', advisory: 'https://osv.dev/vulnerability/MAL-2025-47' });
});

test('an unknown manifest yields no ecosystem rather than a guess', () => {
  const d = put(dir(), 'osv.sarif', sarif([malResult('MAL-2025-1', 'x', '1.0', 'some.unknown')]));
  assert.equal(_malCounts(d, 'osv.sarif').findings[0].ecosystem, '');
});

// ── GuardDog ────────────────────────────────────────────────────────────────────────────────
test('GuardDog detail recovers package@version from the message and keeps the rule', () => {
  const d = put(dir(), 'guarddog.sarif', sarif(
    [{ ruleId: 'typosquatting', level: 'error', message: { text: "Package 'expresss@4.1.0' resembles 'express'" } }],
    [{ id: 'typosquatting' }],
  ));
  const c = _guarddogCounts(d, 'guarddog.sarif');
  assert.equal(c.total, 1);
  assert.equal(c.findings[0].rule, 'typosquatting');
  assert.equal(c.findings[0].package, 'expresss');
  assert.equal(c.findings[0].version, '4.1.0');
});

test('a GuardDog message with no package stays empty, never a guess', () => {
  const d = put(dir(), 'guarddog.sarif', sarif(
    [{ ruleId: 'bundled-binary', level: 'warning', message: { text: 'a bundled binary was found' } }],
    [{ id: 'bundled-binary' }],
  ));
  assert.equal(_guarddogCounts(d, 'guarddog.sarif').findings[0].package, '');
});

test('an empty or unparseable artifact is a husk with no detail, not a clean scan', () => {
  assert.equal(_guarddogCounts(put(dir(), 'guarddog.sarif', ''), 'guarddog.sarif').nosrc, true);
  assert.equal(_guarddogCounts(put(dir(), 'guarddog.sarif', '{not json'), 'guarddog.sarif').unparseable, true);
  assert.equal(_guarddogCounts(put(dir(), 'guarddog.sarif', ''), 'guarddog.sarif').findings, undefined);
});

// GuardDog's real data never exercises norules — this asserts the shared _sarifCounts contract so
// the three short-circuits (nosrc||unparseable||norules) do not drift apart
test('a rules-empty SARIF reads norules through _guarddogCounts too, not a clean scan', () => {
  const d = put(dir(), 'guarddog.sarif', sarif([]));
  const c = _guarddogCounts(d, 'guarddog.sarif');
  assert.equal(c.norules, true);
  assert.equal(c.findings, undefined, 'nothing to detail when no rules were loaded');
});
