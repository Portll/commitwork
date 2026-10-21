// monitor/test/bandit-extractor.test.mjs — the sastPython lane's parser, tested against a REAL
// artifact (bandit 1.8.6, real install in an isolated venv, run against a 3-line vuln.py: an
// unsanitised subprocess.call(shell=True) and an md5 hash) — not a hand-typed shape.
//
// THE POINT OF THIS FILE: sev must come from issue_severity ALONE, never issue_confidence. Bandit
// asserts the two independently (unlike Sobelow, which only has confidence); folding confidence
// into severity is the GuardDog capability-* defect recurring in a new tool. The golden fixture
// has all three results at CONFIDENCE.HIGH but only two at SEVERITY.HIGH — if the extractor were
// wrong and used confidence instead, the low-severity B404 finding would inflate to high.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCANNER_SPECS } from '../extractors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = readFileSync(join(HERE, 'fixtures', 'lane-capability', 'sastPython', 'bandit.json'), 'utf8');

const spec = SCANNER_SPECS.find((s) => s[0] === 'sastPython');

function read(json) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-bandit-'));
  if (json !== null) writeFileSync(join(dir, 'bandit.json'), json);
  return spec[2](dir);
}

test('sastPython is declared in SCANNER_SPECS', () => {
  assert.ok(spec, 'sastPython not found in SCANNER_SPECS');
});

test('the golden artifact yields severity-derived counts, not confidence-derived ones', () => {
  const c = read(GOLDEN);
  assert.equal(c.ran, true);
  assert.equal(c.total, 3);
  // All three results carry issue_confidence HIGH, but only two carry issue_severity HIGH — if
  // this came out high:3, the extractor is reading the wrong field.
  assert.equal(c.high, 2, 'severity, not confidence, must drive the bucket');
  assert.equal(c.low, 1);
  assert.equal(c.med, 0);
  assert.equal(c.crit, 0, 'bandit has no severity above HIGH — this lane must never invent a crit bucket the tool did not assert');
});

test('confidence rides in the message text, never the bucket', () => {
  const c = read(GOLDEN);
  const low = c.findings.find((f) => f.sev === 'low');
  assert.ok(low, 'no low-severity row found');
  assert.match(low.message, /confidence: HIGH/, 'confidence must still be visible, just not as severity');
});

test('cwe comes from bandit\'s own issue_cwe.id, natively, no SARIF derivation', () => {
  const c = read(GOLDEN);
  const withCwe = c.findings.filter((f) => f.cwe);
  assert.equal(withCwe.length, 3, 'all three golden results carry issue_cwe');
  assert.ok(c.findings.some((f) => f.cwe === 'CWE-78'), 'command-injection findings should carry CWE-78');
  assert.ok(c.findings.some((f) => f.cwe === 'CWE-327'), 'the weak-hash finding should carry CWE-327');
});

test('rule/file/line identity fields are populated from bandit\'s own fields', () => {
  const c = read(GOLDEN);
  const rules = c.findings.map((f) => f.rule).sort();
  assert.deepEqual(rules, ['B324', 'B404', 'B602']);
  assert.ok(c.findings.every((f) => f.file.endsWith('.py')), 'every finding should carry a .py file');
  assert.ok(c.findings.every((f) => f.line > 0), 'every finding should carry a real line number');
});

test('an absent artifact is null (a void), never a clean zero', () => {
  assert.equal(read(null), null);
});

test('a non-JSON artifact is a void (null), never silently zero — matching _trivyCounts\'s established safeParseFile convention', () => {
  // safeParseFile throws on genuinely non-JSON content; the catch returns null, same as an absent
  // file. null is still never confusable with {total:0} (a real, ran, empty scan) by any caller —
  // the explicit uncertainty promise holds even though this state does not distinguish absent from corrupt.
  assert.equal(read('not json'), null);
});

test('JSON with no results[] array is unparseable — not the shape this lane expects', () => {
  const c = read(JSON.stringify({ errors: [] }));
  assert.equal(c.unparseable, true);
});

test('a clean scan (empty results[]) keeps its wrapper — a real zero, not an empty artifact', () => {
  const c = read(JSON.stringify({ results: [], errors: [] }));
  assert.equal(c.ran, true);
  assert.equal(c.total, 0);
  assert.equal(c.unparseable, undefined);
});

test('a result with an unrecognised severity is skipped, not miscounted', () => {
  const c = read(JSON.stringify({
    results: [{ test_id: 'B999', filename: 'x.py', line_number: 1, issue_severity: 'UNDEFINED', issue_confidence: 'LOW', issue_text: 'x' }],
    errors: [],
  }));
  assert.equal(c.total, 0, 'an UNDEFINED severity must not be silently bucketed into any real severity');
});
