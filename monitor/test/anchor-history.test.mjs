// monitor/test/anchor-history.test.mjs — the line is a secondary reference WITH A MEMORY (D12).
// A history makes "gone from this line" and "gone from this file" different observations — only
// the second is evidence of a fix.
import test from 'node:test';
import assert from 'node:assert/strict';

import { recordAnchor, ANCHOR_HISTORY_MAX } from '../issue-store.mjs';

const A = (line, hash = `h${line}`, file = 'admin/serve.mjs') => ({ file, line, hash });
const iss = (anchor = null, anchorHistory = undefined) => ({ anchor, ...(anchorHistory ? { anchorHistory } : {}) });

test('a first sighting records the position it was seen at', () => {
  const i = iss();
  assert.equal(recordAnchor(i, A(523), { at: 'T0', sliceId: 's1', why: 'first sighting' }), true);
  assert.deepEqual(i.anchor, A(523));
  assert.equal(i.anchorHistory.length, 1);
  assert.equal(i.anchorHistory[0].line, 523);
  assert.equal(i.anchorHistory[0].why, 'first sighting');
});

test('MOVEMENT IS KEPT — the old position survives the re-point that used to overwrite it', () => {
  // the old re-point overwrote in place, leaving no trace of the prior position
  const i = iss(A(523));
  recordAnchor(i, A(557), { at: 'T1', sliceId: 's2', why: 're-pointed' });
  assert.deepEqual(i.anchor, A(557), 'the anchor tracks the live position');
  assert.deepEqual(i.anchorHistory.map((h) => h.line), [523, 557],
    'and the position it moved FROM is still in the record — that is the whole point');
  assert.match(i.anchorHistory[0].why, /seeded from the live anchor/,
    'the seeded entry says where it came from; nothing before it is invented');
});

test('a clean re-scan at the same place is NOT movement', () => {
  // Recording every unchanged re-observation would bury the movements that matter under noise —
  // and grow a per-issue array inside a document rewritten whole on every ingest.
  const i = iss(A(557));
  assert.equal(recordAnchor(i, A(557), { at: 'T2', why: 'observed' }), false);
  assert.equal(i.anchorHistory, undefined, 'nothing appended, nothing created');
});

test('same line, DIFFERENT content is movement — the site changed under the finding', () => {
  const i = iss(A(557, 'hash-before'));
  assert.equal(recordAnchor(i, A(557, 'hash-after'), { at: 'T3', why: 'content changed' }), true);
  assert.deepEqual(i.anchorHistory.map((h) => h.hash), ['hash-before', 'hash-after']);
});

test('the history is BOUNDED, and keeps the birth position rather than the oldest survivor', () => {
  // Unbounded per-issue growth is what monitor/test/issue-store-scale.test.mjs exists to bound.
  // The first entry is the one a re-anchor can never reconstruct, so it is the one that is kept.
  const i = iss(A(1));
  for (let line = 2; line < ANCHOR_HISTORY_MAX + 8; line++) recordAnchor(i, A(line), { at: `T${line}`, why: 'moved' });
  assert.equal(i.anchorHistory.length, ANCHOR_HISTORY_MAX, 'capped');
  assert.equal(i.anchorHistory[0].line, 1, 'the birth position survives the cap');
  assert.equal(i.anchorHistory.at(-1).line, ANCHOR_HISTORY_MAX + 7, 'and so does the newest');
});

test('a drop at the cap is STATED, never a silent elision', () => {
  const i = iss(A(1));
  for (let line = 2; line < ANCHOR_HISTORY_MAX + 5; line++) recordAnchor(i, A(line), { at: `T${line}`, why: 'moved' });
  assert.match(i.anchorHistory[1].why, /earlier position\(s\) dropped at the \d+-entry cap/,
    'the record says a gap exists — an unmarked gap reads as continuous history');
});

test('a position with no usable line is refused rather than recorded as unknown', () => {
  const i = iss(A(523));
  assert.equal(recordAnchor(i, { file: 'x.js', line: null, hash: 'h' }, { at: 'T9' }), false);
  assert.equal(recordAnchor(i, null, { at: 'T9' }), false);
  assert.deepEqual(i.anchor, A(523), 'and the live anchor is left alone');
});
