// Significant words of the last handback clause in the final paragraph (bin/lib/turn-gate-core.mjs handbackItem).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handbackItem } from '../lib/turn-gate-core.mjs';

test('returns null for null, undefined and whitespace-only input', () => {
  assert.equal(handbackItem(null), null);
  assert.equal(handbackItem(undefined), null);
  assert.equal(handbackItem('   \n  \n  '), null);
});

test('returns null when no clause contains a handback phrase', () => {
  assert.equal(handbackItem('Everything is merged'), null);
});

test('keeps only non-filler words longer than three letters from a lone handback clause', () => {
  assert.deepEqual(handbackItem('Shall I proceed with the fix'), new Set(['proceed']));
});

test('keeps four-letter words that are not filler', () => {
  assert.deepEqual(handbackItem('Shall I push the code'), new Set(['push', 'code']));
});

test('skips the empty clause after a trailing question mark', () => {
  assert.deepEqual(handbackItem('Shall I proceed?'), new Set(['proceed']));
});

test('uses the last matching clause when several clauses match', () => {
  assert.deepEqual(handbackItem('Want me to rebase, or shall I merge it'), new Set(['merge']));
});

test('returns null when the handback clause holds only filler and short words', () => {
  assert.equal(handbackItem('Let me know which one'), null);
  assert.equal(handbackItem('Your call'), null);
});

test('reads only the last paragraph', () => {
  assert.equal(handbackItem('Shall I proceed\n\nAll done'), null);
  assert.deepEqual(handbackItem('All done\n\nShall I proceed'), new Set(['proceed']));
});

test('splits clauses on an em dash and turns non-letters into word breaks', () => {
  assert.deepEqual(
    handbackItem('Tests pass \u2014 should I tag release-candidate now'),
    new Set(['release', 'candidate']),
  );
});
