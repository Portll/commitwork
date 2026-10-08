// The cases here are the ones a naive line/position-keyed matcher would get wrong, or would
// answer confidently when it should say "can't tell" — see chunk-identity.mjs's header comment.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pairChunks, STATE, fingerprint, normalize } from '../lib/chunk-identity.mjs';

const c = (src) => ({ src });

function countConsumed(pair, side) {
  const v = pair[side];
  if (!v) return 0;
  return Array.isArray(v) ? v.length : 1;
}

/** The completeness invariant: every input chunk appears in exactly one pairing slot. */
function assertComplete(oldChunks, newChunks, pairs) {
  const oldConsumed = pairs.reduce((n, p) => n + countConsumed(p, 'old'), 0);
  const newConsumed = pairs.reduce((n, p) => n + countConsumed(p, 'new'), 0);
  assert.equal(oldConsumed, oldChunks.length, 'every old chunk must be consumed exactly once');
  assert.equal(newConsumed, newChunks.length, 'every new chunk must be consumed exactly once');
}

describe('MATCHED', () => {
  test('identical chunks in the same order', () => {
    const oldC = [c('a'), c('b')], newC = [c('a'), c('b')];
    const { pairs } = pairChunks(oldC, newC);
    assert.equal(pairs.length, 2);
    assert.ok(pairs.every((p) => p.state === STATE.MATCHED));
    assertComplete(oldC, newC, pairs);
  });

  test('a reorder is still MATCHED per chunk, with a moved hint — position is never identity', () => {
    const oldC = [c('first'), c('second')], newC = [c('second'), c('first')];
    const { pairs } = pairChunks(oldC, newC);
    assert.ok(pairs.every((p) => p.state === STATE.MATCHED));
    assert.ok(pairs.some((p) => p.movedHint), 'a position change must be visible, not silently correct');
  });
});

describe('WHITESPACE_ONLY', () => {
  test('raw hash differs, normalized hash matches', () => {
    const oldC = [c('hello   world')], newC = [c('hello world')];
    const { pairs } = pairChunks(oldC, newC);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].state, STATE.WHITESPACE_ONLY);
    assert.notEqual(fingerprint(oldC[0].src), fingerprint(newC[0].src));
    assert.equal(fingerprint(normalize(oldC[0].src)), fingerprint(normalize(newC[0].src)));
  });
});

describe('EDITED', () => {
  test('similar but not identical content, above the similarity threshold', () => {
    const oldC = [c('The quick brown fox jumps over the lazy dog')];
    const newC = [c('The quick brown fox leaps over the lazy dog')];
    const { pairs } = pairChunks(oldC, newC);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].state, STATE.EDITED);
    assert.ok(pairs[0].similarity > 0.35);
  });

  test('whole-section chunks match on heading similarity even when the 300-word bodies barely overlap', () => {
    // The exact case that motivated the heading-weighted blend: two authors' phase descriptions
    // share almost no body vocabulary, but the heading line alone makes the correspondence obvious.
    const oldC = [c('## Phase 0 — Briefing Audit + Risk Triage\n\n'
      + 'Run the briefing-audit procedure over every claim in the input plan before triage begins, '
      + 'propagating an UNSUPPORTED marker to any finding that depends on an unverified claim.')];
    const newC = [c('## Phase 0 — Risk triage (~3 min)\n\n'
      + 'Enumerate components and assign each a depth tier based on auth, PII, money, external '
      + 'integration, complex state, novel technology, or high coupling to the rest of the system.')];
    const { pairs } = pairChunks(oldC, newC);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].state, STATE.EDITED, `expected EDITED via heading similarity, got ${pairs[0].state}`);
  });

  test('heading similarity is case-insensitive — "Risk Triage" vs "Risk triage" must not lose the match', () => {
    const oldC = [c('## Phase 0 — Risk Triage\n\nbody text one, otherwise unrelated to the other side.')];
    const newC = [c('## Phase 0 — Risk triage\n\nbody text two, otherwise unrelated to the other side.')];
    const { pairs } = pairChunks(oldC, newC);
    assert.equal(pairs[0].state, STATE.EDITED);
  });
});

describe('AMBIGUOUS', () => {
  test('duplicate boilerplate on either side is paired but flagged, never silently confident', () => {
    // Two identical '---' separators on each side — the exact shape a repeated header, licence
    // block, or verified-against stamp produces in this repo's own docs.
    const oldC = [c('---'), c('A'), c('---')];
    const newC = [c('---'), c('B'), c('---')];
    const { pairs } = pairChunks(oldC, newC);
    const ambiguous = pairs.filter((p) => p.state === STATE.AMBIGUOUS);
    assert.equal(ambiguous.length, 2, 'both --- pairings must be flagged AMBIGUOUS, not silently MATCHED');
    assertComplete(oldC, newC, pairs);
  });
});

describe('UNRESOLVED', () => {
  test('multiple unmatched chunks on both sides sharing no confident 1:1 pairing but some vocabulary', () => {
    // No pairwise similarity crosses the threshold (each chunk shares at most one word with any
    // single chunk on the other side), but the two remaining pools share a word overall — a real
    // split/merge signature, not a confident individual match.
    const oldC = [c('alpha beta gamma delta epsilon'), c('zeta eta theta iota kappa')];
    const newC = [c('lambda mu nu xi alpha'), c('omicron pi rho sigma tau')];
    const { pairs } = pairChunks(oldC, newC);
    const unresolved = pairs.filter((p) => p.state === STATE.UNRESOLVED);
    assert.equal(unresolved.length, 1, 'ambiguous leftovers must group into one UNRESOLVED pair, not be forced into wrong 1:1 pairs');
    assert.equal(unresolved[0].old.length, 2);
    assert.equal(unresolved[0].new.length, 2);
    assertComplete(oldC, newC, pairs);
  });

  test('completely unrelated leftovers (no shared vocabulary at all) are NOT grouped — they are ordinary adds/deletes', () => {
    const oldC = [c('foo'), c('bar')];
    const newC = [c('qux'), c('quux')];
    const { pairs } = pairChunks(oldC, newC);
    assert.equal(pairs.filter((p) => p.state === STATE.UNRESOLVED).length, 0);
    assert.equal(pairs.filter((p) => p.state === STATE.DELETED).length, 2);
    assert.equal(pairs.filter((p) => p.state === STATE.ADDED).length, 2);
    assertComplete(oldC, newC, pairs);
  });
});

describe('ADDED / DELETED', () => {
  test('a chunk with no baseline at all is ADDED, never a forced pairing', () => {
    const { pairs, noBaseline } = pairChunks([], [c('brand new')]);
    assert.equal(noBaseline, true);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].state, STATE.ADDED);
  });

  test('a chunk with no counterpart in the new document is DELETED', () => {
    const { pairs } = pairChunks([c('going away')], []);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].state, STATE.DELETED);
  });
});

describe('completeness invariant, fuzzed over a few shapes', () => {
  const cases = [
    [[], []],
    [[c('a')], []],
    [[], [c('a')]],
    [[c('a'), c('b'), c('c')], [c('c'), c('b'), c('a')]],
    [[c('one two three')], [c('one two four'), c('five six seven')]],
  ];
  for (const [oldC, newC] of cases) {
    test(`old=${oldC.length} new=${newC.length}`, () => {
      const { pairs } = pairChunks(oldC, newC);
      assertComplete(oldC, newC, pairs);
    });
  }
});
