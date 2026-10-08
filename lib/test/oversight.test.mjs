// An oversight record is a signature. These pin the four ways a signature becomes worthless:
// it is unattributed, it names nothing it read, it can only agree, or its absence renders the
// same as its presence.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateOversight, overseenBy, subjectKey, STANCES } from '../oversight.mjs';

const ok = {
  stance: 'corroborate',
  who: 'john@portll.net',
  basis: 'read the semgrep SARIF and the annotation at monitor/rollup.mjs; the suppression reason matches the code',
  subject: { repo: 'commitwork', file: 'monitor/rollup.mjs', rule: 'js/insecure-object-assign' },
};

describe('an oversight record', () => {
  test('a complete record validates', () => {
    assert.deepEqual(validateOversight(ok).errors, []);
  });

  test('IT CAN DISAGREE — an oversight that can only agree is a rubber stamp', () => {
    assert.ok(STANCES.includes('dispute'), 'dispute must be first-class, not an afterthought');
    assert.deepEqual(validateOversight({ ...ok, stance: 'dispute' }).errors, []);
  });

  test('unattributed is refused — it comes from the session, never the body', () => {
    const e = validateOversight({ ...ok, who: '' }).errors;
    assert.equal(e.length, 1);
    assert.match(e[0], /who is required/);
  });

  test('no basis is refused — a signature on a blank page', () => {
    assert.match(validateOversight({ ...ok, basis: '   ' }).errors[0], /basis is required/);
  });

  test('IDENTITY EXCLUDES LINE — a line-keyed attestation detaches on the next edit above it', () => {
    const e = validateOversight({ ...ok, subject: { ...ok.subject, line: 42 } }).errors;
    assert.ok(e.some((x) => /subject\.line is not part/.test(x)), `expected a line refusal, got ${JSON.stringify(e)}`);
  });

  test('a subject naming nothing is refused', () => {
    assert.match(validateOversight({ ...ok, subject: {} }).errors[0], /at least one of/);
  });

  test('OVERSIGHT NEVER SUPPRESSES — the two vocabularies stay apart', () => {
    assert.match(validateOversight({ ...ok, suppress: true }).errors[0], /never suppresses/);
  });

  test('an unknown stance is refused rather than stored as free text', () => {
    assert.match(validateOversight({ ...ok, stance: 'lgtm' }).errors[0], /stance must be one of/);
  });
});

describe('folding a subject state', () => {
  const subj = ok.subject;
  const rec = (who, stance) => ({ who, stance, subject: subj });

  test('THE DEFECT A BOOLEAN WOULD HIDE: nobody looked and somebody disagreed are opposite facts', () => {
    assert.equal(overseenBy([], subj).state, 'none');
    assert.equal(overseenBy([rec('a', 'dispute')], subj).state, 'disputed');
  });

  test('corroboration names who, so the attestation can be read back', () => {
    const r = overseenBy([rec('b', 'corroborate'), rec('a', 'corroborate')], subj);
    assert.equal(r.state, 'corroborated');
    assert.deepEqual(r.corroborated, ['a', 'b'], 'sorted, so the render is deterministic');
  });

  test('disagreement between reviewers is MIXED, never averaged away', () => {
    const r = overseenBy([rec('a', 'corroborate'), rec('b', 'dispute')], subj);
    assert.equal(r.state, 'mixed');
    assert.deepEqual(r.corroborated, ['a']);
    assert.deepEqual(r.disputed, ['b']);
  });

  test('one reviewer changing their mind counts ONCE, on their latest stance', () => {
    const r = overseenBy([rec('a', 'corroborate'), rec('a', 'dispute')], subj);
    assert.equal(r.state, 'disputed', 'the later stance wins');
    assert.deepEqual(r.corroborated, [], 'a reviewer must not appear on both sides of their own review');
  });

  test('records for a DIFFERENT subject do not leak in', () => {
    const other = { repo: 'commitwork', file: 'other.mjs', rule: 'x' };
    assert.equal(overseenBy([{ who: 'a', stance: 'corroborate', subject: other }], subj).state, 'none');
  });

  test('a subject that names nothing folds to none with a reason, never a throw', () => {
    const r = overseenBy([rec('a', 'corroborate')], {});
    assert.equal(r.state, 'none');
    assert.match(r.reason, /names nothing/);
  });

  test('subjectKey ignores line entirely — the same finding moved is the same subject', () => {
    assert.equal(subjectKey({ ...subj, line: 1 }), subjectKey({ ...subj, line: 999 }));
  });
});
