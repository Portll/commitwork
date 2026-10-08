// node --test monitor/test/ — the `incorrect-scan-result` action. This one SUPPRESSES findings, so
// the tests that matter are the ones stopping it becoming a cheap way to make an inconvenient
// finding disappear. It must be usable when a tool really was broken, and refused otherwise.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPRESSING_ACTIONS, DEFECT_REQUIRING_ACTIONS, annActive, validateScannerAnnotation, scannerAnnMatch } from '../annotate-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IDENT = ['rule', 'file'];
const base = (over = {}) => ({
  category: 'secrets', rule: 'Lob', file: 'src/x.js', repo: 'demo',
  action: 'incorrect-scan-result', reason: 'Lob detector fabricates verified hits', who: 'operator',
  at: '2026-08-23T00:00:00.000Z',
  defect: { tool: 'trufflehog', detector: 'Lob', detail: 'produced 1311 of 1314 published CRITICALs, all false' },
  ...over,
});

describe('it suppresses, and it is not a synonym for false-positive', () => {
  test('it is in the suppressing set, so a finding under it drops from open counts', () => {
    assert.ok(SUPPRESSING_ACTIONS.includes('incorrect-scan-result'));
    assert.equal(annActive({ at: '2026-08-01T00:00:00.000Z', action: 'incorrect-scan-result' }, '2026-08-23T00:00:00.000Z'), true);
  });

  test('it is a DISTINCT action — collapsing it into false-positive would erase which one is broken', () => {
    // false-positive judges the SUBJECT; this blames the INSTRUMENT. A reader needs to know whether
    // to look at the code or at the scanner, and only the action name carries that.
    assert.notEqual('incorrect-scan-result', 'false-positive');
    assert.ok(SUPPRESSING_ACTIONS.includes('false-positive'));
    assert.deepEqual(DEFECT_REQUIRING_ACTIONS, ['incorrect-scan-result'],
      'only the instrument-blaming action carries a defect requirement');
  });

  test('it still honours expiry, so it cannot become a permanent blindfold by default', () => {
    assert.equal(annActive({ at: '2026-08-01T00:00:00.000Z', expires: '2026-08-10T00:00:00.000Z', action: 'incorrect-scan-result' }, '2026-08-23T00:00:00.000Z'), false);
  });

  test('it is time-stable — replayed onto an OLD slice it is still true, which is why it is an action', () => {
    // The annotation is not in force before its `at`, exactly like every other action: replaying a
    // slice from before the defect was known shows the finding un-suppressed, which is honest.
    assert.equal(annActive({ at: '2026-08-23T00:00:00.000Z', action: 'incorrect-scan-result' }, '2026-08-01T00:00:00.000Z'), false);
  });
});

describe('it must NAME the instrument — the guard against a blanket dismissal', () => {
  test('a well-formed record validates', () => {
    assert.deepEqual(validateScannerAnnotation(base(), IDENT), []);
  });

  test('no defect at all is REFUSED — this is the whole point', () => {
    const errs = validateScannerAnnotation(base({ defect: undefined }), IDENT);
    assert.ok(errs.some((e) => /requires a defect object/.test(e)), errs.join('; '));
  });

  test('a defect that names no tool, or no checkable detail, is refused', () => {
    assert.ok(validateScannerAnnotation(base({ defect: { detail: 'it was wrong' } }), IDENT).some((e) => /defect\.tool is required/.test(e)));
    assert.ok(validateScannerAnnotation(base({ defect: { tool: 'trufflehog' } }), IDENT).some((e) => /defect\.detail is required/.test(e)));
    assert.ok(validateScannerAnnotation(base({ defect: { tool: '  ', detail: '  ' } }), IDENT).length >= 2, 'whitespace is not a reason');
  });

  test('a defect object is not a free-text dumping ground — unknown fields are refused', () => {
    assert.ok(validateScannerAnnotation(base({ defect: { tool: 't', detail: 'd', because: 'i said so' } }), IDENT)
      .some((e) => /unknown defect field 'because'/.test(e)));
  });

  test('a non-object defect is refused rather than coerced', () => {
    for (const bad of ['trufflehog is broken', ['trufflehog'], 42, null]) {
      assert.ok(validateScannerAnnotation(base({ defect: bad }), IDENT).some((e) => /requires a defect object/.test(e)), `${JSON.stringify(bad)} must be refused`);
    }
  });

  test('defect on any OTHER action is refused — it must not become decoration', () => {
    const errs = validateScannerAnnotation(base({ action: 'false-positive' }), IDENT);
    assert.ok(errs.some((e) => /defect is only meaningful for/.test(e)), errs.join('; '));
  });

  test('every other requirement still applies — this action is not a bypass', () => {
    // A new action must not become the loose door: identity, repo, reason, who and at are all
    // still mandatory, or `incorrect-scan-result` would be the cheapest way to suppress anything.
    const errs = validateScannerAnnotation({ category: 'secrets', action: 'incorrect-scan-result', defect: { tool: 't', detail: 'd' } }, IDENT);
    // `rule` is an INSTRUMENT field and `file` a PLACE field, so the identity errors differ for
    // this action by design — but everything that makes the record ACCOUNTABLE still binds, which
    // is the property this test exists to hold.
    for (const want of [/must name the instrument/, /missing repo/, /missing reason/, /missing who/, /unparseable at/]) {
      assert.ok(errs.some((e) => want.test(e)), `expected ${want} in: ${errs.join('; ')}`);
    }
  });

  test('a fleet-scoped one still needs an explicit expires when authoring', () => {
    const errs = validateScannerAnnotation(base({ repo: undefined, scope: 'fleet' }), IDENT, { requireExpires: true });
    assert.ok(errs.some((e) => /missing expires/.test(e)), errs.join('; '));
  });
});

describe('the declared vocabularies agree — three registries, one truth', () => {
  const read = (rel) => JSON.parse(readFileSync(join(HERE, '..', rel), 'utf8'));

  test('authored-judgment.schema.json carries it in ACTION', () => {
    assert.ok(read('schema/authored-judgment.schema.json').definitions.action.enum.includes('incorrect-scan-result'));
  });

  test('and NOT in disposition — the schema forbids it, because "as-of" is meaningless for a disposition', () => {
    // The schema's own words: NEVER put a disposition value in action, and the converse holds —
    // a disposition is not replayable onto an old slice, which is the property this action needs.
    assert.equal(read('schema/authored-judgment.schema.json').definitions.disposition.enum.includes('incorrect-scan-result'), false);
  });

  test('schema/annotation.schema.json carries it too — valid to the lib must mean valid to the schema', () => {
    assert.ok(read('../schema/annotation.schema.json').$defs.annotation.properties.action.enum.includes('incorrect-scan-result'));
  });

  test('every suppressing action the lib declares is known to the authored-judgment schema', () => {
    // The registry-drift guard: adding to one and forgetting the other is the standing failure here.
    const declared = read('schema/authored-judgment.schema.json').definitions.action.enum;
    for (const a of SUPPRESSING_ACTIONS) assert.ok(declared.includes(a), `lib suppresses '${a}' but the schema does not declare it`);
  });
});

describe('instrument-scoped matching — retires a broken detector without becoming a blanket', () => {
  const IDENT2 = ['detector', 'file'];   // secretsHistory: detector = instrument, file = place
  const row = (over = {}) => ({ repo: 'r1', detector: 'Lob', file: 'a/b.c', line: 12, sev: 'crit', ...over });
  const ann = (over = {}) => ({
    category: 'secretsHistory', detector: 'Lob', scope: 'fleet',
    action: 'incorrect-scan-result', reason: 'defective detector', who: 'operator',
    at: '2026-08-23T00:00:00.000Z', expires: '2026-12-31T00:00:00.000Z',
    defect: { tool: 'trufflehog', detector: 'Lob', detail: '1311 of 1314 published CRITICALs, all false' },
    ...over,
  });

  test('ONE record, no file, validates — the place is not part of a claim about the instrument', () => {
    assert.deepEqual(validateScannerAnnotation(ann(), IDENT2, { requireExpires: true }), []);
  });

  test('and it matches every row of that detector, in any file, in any repo', () => {
    const a = ann();
    for (const r of [row(), row({ file: 'x/y.z' }), row({ repo: 'r2', file: 'q.c' })]) {
      assert.equal(scannerAnnMatch(a, r, IDENT2), true, `should match ${JSON.stringify(r)}`);
    }
  });

  test('it does NOT touch another detector — this is the whole safety property', () => {
    assert.equal(scannerAnnMatch(ann(), row({ detector: 'PrivateKey' }), IDENT2), false);
    assert.equal(scannerAnnMatch(ann(), row({ detector: 'Postgres' }), IDENT2), false);
  });

  test('naming NO instrument is REFUSED — that would suppress the whole category', () => {
    const errs = validateScannerAnnotation(ann({ detector: undefined }), IDENT2, { requireExpires: true });
    assert.ok(errs.some((e) => /must name the instrument/.test(e)), errs.join('; '));
  });

  test('a blank instrument or a blanked place field is refused — omit means any, blank means nothing', () => {
    assert.ok(validateScannerAnnotation(ann({ detector: '   ' }), IDENT2, { requireExpires: true }).some((e) => /must name the instrument/.test(e)));
    assert.ok(validateScannerAnnotation(ann({ file: '' }), IDENT2, { requireExpires: true }).some((e) => /present but empty/.test(e)));
  });

  test('a category with NO instrument field cannot use this action at all', () => {
    const errs = validateScannerAnnotation(ann({ category: 'tlsHeaders', detector: undefined, issue: 'x', target: 'y' }), ['issue', 'target'], { requireExpires: true });
    assert.ok(errs.some((e) => /cannot be scoped here/.test(e)), errs.join('; '));
  });

  test('narrowing to one file still works — instrument-scoped is a ceiling, not a floor', () => {
    const a = ann({ file: 'a/b.c' });
    assert.deepEqual(validateScannerAnnotation(a, IDENT2, { requireExpires: true }), []);
    assert.equal(scannerAnnMatch(a, row(), IDENT2), true);
    assert.equal(scannerAnnMatch(a, row({ file: 'other.c' }), IDENT2), false, 'a named file must still bind');
  });

  test('EVERY OTHER ACTION keeps the strict rule — the wildcard is not a general loosening', () => {
    // If this ever passes for false-positive, the widening has leaked and any finding can be
    // suppressed detector-wide without a defect report.
    const fp = { ...ann({ defect: undefined }), action: 'false-positive' };
    assert.ok(validateScannerAnnotation(fp, IDENT2, { requireExpires: true }).some((e) => /missing identity field 'file'/.test(e)));
    assert.equal(scannerAnnMatch({ ...fp, file: undefined }, row(), IDENT2), false, 'an omitted place field must NOT wildcard for other actions');
  });

  test('repo scoping still binds when scope is not fleet', () => {
    const a = ann({ scope: undefined, repo: 'r1' });
    assert.equal(scannerAnnMatch(a, row({ repo: 'r1' }), IDENT2), true);
    assert.equal(scannerAnnMatch(a, row({ repo: 'r2' }), IDENT2), false);
  });
});
