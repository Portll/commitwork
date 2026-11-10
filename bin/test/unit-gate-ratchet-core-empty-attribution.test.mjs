// Classifies why an attribution is empty and returns the canonical shape (bin/gate-ratchet-core.mjs emptyAttribution).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAttribution } from '../gate-ratchet-core.mjs';

test('returns no-drift with empty unknown for a clean tree', () => {
  assert.deepEqual(emptyAttribution('no-drift'), { mine: [], theirs: [], unknown: [], others: [], shared: [], undetermined: [], emptyReason: "no-drift" });
});

test('returns no-dirty-match with empty unknown when drifted paths exist', () => {
  assert.deepEqual(emptyAttribution('no-dirty-match', ['a', 'b']), { mine: [], theirs: [], unknown: [], others: [], shared: [], undetermined: [], emptyReason: "no-dirty-match" });
});

test('returns git-unavailable with drifted paths in unknown', () => {
  assert.deepEqual(emptyAttribution('git-unavailable', ['x', 'y', 'z']), { mine: [], theirs: [], unknown: ["x", "y", "z"], others: [], shared: [], undetermined: [], emptyReason: "git-unavailable" });
});

test('returns git-unavailable with empty unknown when no drifted paths', () => {
  assert.deepEqual(emptyAttribution('git-unavailable'), { mine: [], theirs: [], unknown: [], others: [], shared: [], undetermined: [], emptyReason: "git-unavailable" });
});

test('falls back to no-drift for an unrecognized reason', () => {
  assert.deepEqual(emptyAttribution('weird-reason', ['p']), { mine: [], theirs: [], unknown: [], others: [], shared: [], undetermined: [], emptyReason: "no-drift" });
});

test('falls back to no-drift for undefined reason', () => {
  assert.deepEqual(emptyAttribution(undefined, ['q']), { mine: [], theirs: [], unknown: [], others: [], shared: [], undetermined: [], emptyReason: "no-drift" });
});

test('returns no-drift with empty unknown for null reason', () => {
  assert.deepEqual(emptyAttribution(null), { mine: [], theirs: [], unknown: [], others: [], shared: [], undetermined: [], emptyReason: "no-drift" });
});

test('returns no-drift with empty unknown for empty string reason', () => {
  assert.deepEqual(emptyAttribution(''), { mine: [], theirs: [], unknown: [], others: [], shared: [], undetermined: [], emptyReason: "no-drift" });
});
