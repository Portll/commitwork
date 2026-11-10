// Maps a label to its chain-integrity band with rank and order (lib/chain-lexicon.mjs bandOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandOf } from '../chain-lexicon.mjs';

test('maps a known label to its band with known true', () => {
  const r = bandOf('intact');
  assert.deepEqual(r, { label: "intact", band: "sound", known: true, order: 0, rank: 0, means: "positively verified" });
});

test('maps an alias to its canonical label and band', () => {
  const r = bandOf('ok');
  assert.deepEqual(r, { label: "intact", band: "sound", known: true, order: 0, rank: 0, means: "positively verified" });
});

test('maps a forged label to the forged band', () => {
  const r = bandOf('truncated');
  assert.deepEqual(r, { label: "truncated", band: "forged", known: true, order: 5, rank: 3, means: "positively contradicted" });
});

test('maps an unknown label to undetermined with known false', () => {
  const r = bandOf('nonexistent-label');
  assert.deepEqual(r, { label: "nonexistent-label", band: "undetermined", known: false, order: 2, rank: 1, means: "no evidence either way \u2014 never sound, never forged" });
});

test('maps a suspect label to the suspect band with known true', () => {
  const r = bandOf('extended');
  assert.deepEqual(r, { label: "extended", band: "suspect", known: true, order: 4, rank: 3, means: "changed, cause undetermined" });
});

test('maps a damaged label to the damaged band', () => {
  const r = bandOf('torn');
  assert.deepEqual(r, { label: "torn", band: "damaged", known: true, order: 3, rank: 1, means: "physical loss, not an edit" });
});
