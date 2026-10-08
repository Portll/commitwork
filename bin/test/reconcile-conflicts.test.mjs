// bin/reconcile-findings.mjs — what counts as a severity conflict: a NEAR-MISS split (similar
// enough that the split itself may be wrong), never a mere anchor collision. Pinned in both
// directions — a metric that only ever reports zero is worth as little as one stuck at fourteen.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analyse, MERGE_SIMILARITY } from '../reconcile-findings.mjs';

const entry = (id, anchor, severity, summary) => ({
  id, anchor, severity, summary, disposition: 'open', conflicts: [],
  file: anchor.split(':')[0], line: Number(anchor.split(':')[1]) || 1,
});

// Deliberately near-identical — the shape the merge rule might wrongly split.
const REWORD_A = 'the loader swallows a parse failure and returns an empty object silently';
const REWORD_B = 'the loader swallows a parse error and returns empty object silently here';
const UNRELATED = 'an unused export is imported by nobody and should be deleted';

describe('crossEntryDisagreements — near-miss splits, not anchor collisions', () => {
  test('two UNRELATED defects on one line are NOT a conflict, whatever their severities', () => {
    const a = analyse([entry('1', 'y.mjs:1', 'high', REWORD_A), entry('2', 'y.mjs:1', 'low', UNRELATED)], []);
    assert.equal(a.crossEntryDisagreements.length, 0, 'co-location must not gate');
    assert.equal(a.coLocatedAnchors.length, 1, 'but it must still be REPORTED — silence is not the fix');
    assert.ok(a.coLocatedAnchors[0].similarity < 0.30);
  });

  test('a NEAR-MISS split with differing severity DOES gate', () => {
    // if these are really one defect, the recorded severity is wrong too
    const a = analyse([entry('1', 'x.mjs:1', 'high', REWORD_A), entry('2', 'x.mjs:1', 'low', REWORD_B)], []);
    assert.equal(a.crossEntryDisagreements.length, 1);
    assert.equal(a.coLocatedAnchors.length, 0);
    assert.ok(a.crossEntryDisagreements[0].similarity >= 0.30);
  });

  test('a near-miss with the SAME severity does not gate — there is no severity to get wrong', () => {
    const a = analyse([entry('1', 'z.mjs:1', 'high', REWORD_A), entry('2', 'z.mjs:1', 'high', REWORD_B)], []);
    assert.equal(a.crossEntryDisagreements.length, 0);
  });

  test('the ambiguity floor sits BELOW the merge threshold and ABOVE what the corpus proved distinct', () => {
    // not a free parameter: a genuine restatement scores 0.366 and the highest genuinely-distinct
    // pair 0.274, so the floor must fall between them
    const FLOOR = MERGE_SIMILARITY - 0.05;
    assert.ok(FLOOR < MERGE_SIMILARITY, 'anything at or above the merge threshold would have merged');
    assert.ok(FLOOR > 0.274, 'must not flag the pair this corpus proved is two defects');
  });

  test('every reported anchor carries its similarity, so the ruling can be checked', () => {
    // a bare anchor list gave nobody a way to disagree with it
    const a = analyse([entry('1', 'y.mjs:1', 'high', REWORD_A), entry('2', 'y.mjs:1', 'low', UNRELATED)], []);
    for (const row of [...a.coLocatedAnchors, ...a.crossEntryDisagreements, ...a.multiEntryAnchors]) {
      assert.equal(typeof row.similarity, 'number', `${row.anchor} must publish its similarity`);
    }
  });

  test('a single entry at an anchor is neither', () => {
    const a = analyse([entry('1', 'solo.mjs:1', 'high', REWORD_A)], []);
    assert.equal(a.multiEntryAnchors.length, 0);
    assert.equal(a.coLocatedAnchors.length, 0);
    assert.equal(a.crossEntryDisagreements.length, 0);
  });
});
