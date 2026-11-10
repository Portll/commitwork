// treeGate computes a gate verdict from witness and snapshot links (bin/release-candidate.mjs treeGate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeGate } from '../release-candidate.mjs';

test('returns pass when witness and links are empty', () => {
  const snap = { links: [], gitlinks: [], excluded: [] };
  const witness = [];
  const r = treeGate(snap, witness);
  assert.deepEqual(r, { gate: "tree", status: "pass", detail: { excluded: [], problems: [], problemCount: 0 } });
});

test('returns fail when witness is non-empty', () => {
  const snap = { links: [], gitlinks: [], excluded: [] };
  const witness = ['w1'];
  const r = treeGate(snap, witness);
  assert.deepEqual(r, { gate: "tree", status: "fail", detail: { excluded: [], problems: ["w1"], problemCount: 1 } });
});

test('returns fail when links is non-empty', () => {
  const snap = { links: ['l1'], gitlinks: [], excluded: [] };
  const witness = [];
  const r = treeGate(snap, witness);
  assert.deepEqual(r, { gate: "tree", status: "fail", detail: { excluded: [], problems: ["symlink l1"], problemCount: 1 } });
});

test('returns fail when gitlinks is non-empty', () => {
  const snap = { links: [], gitlinks: ['g1'], excluded: [] };
  const witness = [];
  const r = treeGate(snap, witness);
  assert.deepEqual(r, { gate: "tree", status: "fail", detail: { excluded: [], problems: ["gitlink g1"], problemCount: 1 } });
});

test('slices problems to 50 when there are more than 50', () => {
  const snap = { links: Array.from({ length: 60 }, (_, i) => `l${i}`), gitlinks: [], excluded: [] };
  const witness = [];
  const r = treeGate(snap, witness);
  assert.deepEqual(r, { gate: "tree", status: "fail", detail: { excluded: [], problems: ["symlink l0", "symlink l1", "symlink l2", "symlink l3", "symlink l4", "symlink l5", "symlink l6", "symlink l7", "symlink l8", "symlink l9", "symlink l10", "symlink l11", "symlink l12", "symlink l13", "symlink l14", "symlink l15", "symlink l16", "symlink l17", "symlink l18", "symlink l19", "symlink l20", "symlink l21", "symlink l22", "symlink l23", "symlink l24", "symlink l25", "symlink l26", "symlink l27", "symlink l28", "symlink l29", "symlink l30", "symlink l31", "symlink l32", "symlink l33", "symlink l34", "symlink l35", "symlink l36", "symlink l37", "symlink l38", "symlink l39", "symlink l40", "symlink l41", "symlink l42", "symlink l43", "symlink l44", "symlink l45", "symlink l46", "symlink l47", "symlink l48", "symlink l49"], problemCount: 60 } });
});

test('includes all problems when count is exactly 50', () => {
  const snap = { links: Array.from({ length: 50 }, (_, i) => `l${i}`), gitlinks: [], excluded: [] };
  const witness = [];
  const r = treeGate(snap, witness);
  assert.deepEqual(r, { gate: "tree", status: "fail", detail: { excluded: [], problems: ["symlink l0", "symlink l1", "symlink l2", "symlink l3", "symlink l4", "symlink l5", "symlink l6", "symlink l7", "symlink l8", "symlink l9", "symlink l10", "symlink l11", "symlink l12", "symlink l13", "symlink l14", "symlink l15", "symlink l16", "symlink l17", "symlink l18", "symlink l19", "symlink l20", "symlink l21", "symlink l22", "symlink l23", "symlink l24", "symlink l25", "symlink l26", "symlink l27", "symlink l28", "symlink l29", "symlink l30", "symlink l31", "symlink l32", "symlink l33", "symlink l34", "symlink l35", "symlink l36", "symlink l37", "symlink l38", "symlink l39", "symlink l40", "symlink l41", "symlink l42", "symlink l43", "symlink l44", "symlink l45", "symlink l46", "symlink l47", "symlink l48", "symlink l49"], problemCount: 50 } });
});

test('includes all problems when count is 49', () => {
  const snap = { links: Array.from({ length: 49 }, (_, i) => `l${i}`), gitlinks: [], excluded: [] };
  const witness = [];
  const r = treeGate(snap, witness);
  assert.deepEqual(r, { gate: "tree", status: "fail", detail: { excluded: [], problems: ["symlink l0", "symlink l1", "symlink l2", "symlink l3", "symlink l4", "symlink l5", "symlink l6", "symlink l7", "symlink l8", "symlink l9", "symlink l10", "symlink l11", "symlink l12", "symlink l13", "symlink l14", "symlink l15", "symlink l16", "symlink l17", "symlink l18", "symlink l19", "symlink l20", "symlink l21", "symlink l22", "symlink l23", "symlink l24", "symlink l25", "symlink l26", "symlink l27", "symlink l28", "symlink l29", "symlink l30", "symlink l31", "symlink l32", "symlink l33", "symlink l34", "symlink l35", "symlink l36", "symlink l37", "symlink l38", "symlink l39", "symlink l40", "symlink l41", "symlink l42", "symlink l43", "symlink l44", "symlink l45", "symlink l46", "symlink l47", "symlink l48"], problemCount: 49 } });
});

test('combines witness links and gitlinks in order', () => {
  const snap = { links: ['a', 'b'], gitlinks: ['c'], excluded: ['x'] };
  const witness = ['w'];
  const r = treeGate(snap, witness);
  assert.deepEqual(r, { gate: "tree", status: "fail", detail: { excluded: ["x"], problems: ["w", "symlink a", "symlink b", "gitlink c"], problemCount: 4 } });
});
