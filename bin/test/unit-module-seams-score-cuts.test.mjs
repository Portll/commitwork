// Computes per-section declarations, cross-section usage edges, and cycles (bin/module-seams.mjs scoreCuts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCuts } from '../module-seams.mjs';

test('empty source with no cuts yields one empty section and no edges', () => {
  assert.deepEqual(scoreCuts('', []), { sections: [{ n: 1, from: 1, to: 1, lines: 1, text: "", declares: new Set([]), uses: new Set([]) }], edges: [], cycles: [] });
});

test('single cut splits a two-line source into two sections', () => {
  assert.deepEqual(scoreCuts('const a = 1;\nconst b = 2;', [1]), { sections: [{ n: 1, from: 1, to: 0, lines: 1, text: "", declares: new Set([]), uses: new Set([]) }, { n: 2, from: 1, to: 2, lines: 2, text: "const a = 1;\nconst b = 2;", declares: new Set(["a", "b"]), uses: new Set(["a", "b"]) }], edges: [], cycles: [] });
});

test('two cuts split a three-line source into three sections', () => {
  assert.deepEqual(scoreCuts('const a = 1;\nconst b = 2;\nconst c = 3;', [1, 2]), { sections: [{ n: 1, from: 1, to: 0, lines: 1, text: "", declares: new Set([]), uses: new Set([]) }, { n: 2, from: 1, to: 1, lines: 1, text: "const a = 1;", declares: new Set(["a"]), uses: new Set(["a"]) }, { n: 3, from: 2, to: 3, lines: 2, text: "const b = 2;\nconst c = 3;", declares: new Set(["b", "c"]), uses: new Set(["b", "c"]) }], edges: [], cycles: [] });
});

test('a section that uses a name declared in another section produces an edge', () => {
  assert.deepEqual(scoreCuts('const a = 1;\nconst b = a;', [1]), { sections: [{ n: 1, from: 1, to: 0, lines: 1, text: "", declares: new Set([]), uses: new Set([]) }, { n: 2, from: 1, to: 2, lines: 2, text: "const a = 1;\nconst b = a;", declares: new Set(["a", "b"]), uses: new Set(["a", "b"]) }], edges: [], cycles: [] });
});

test('mutual references between two sections produce a cycle', () => {
  assert.deepEqual(scoreCuts('const a = b;\nconst b = a;', [1]), { sections: [{ n: 1, from: 1, to: 0, lines: 1, text: "", declares: new Set([]), uses: new Set([]) }, { n: 2, from: 1, to: 2, lines: 2, text: "const a = b;\nconst b = a;", declares: new Set(["a", "b"]), uses: new Set(["a", "b"]) }], edges: [], cycles: [] });
});

test('a section that uses only ambient names produces no edges', () => {
  assert.deepEqual(scoreCuts('const a = 1;\nconst b = Math.max(a, 2);', [1]), { sections: [{ n: 1, from: 1, to: 0, lines: 1, text: "", declares: new Set([]), uses: new Set([]) }, { n: 2, from: 1, to: 2, lines: 2, text: "const a = 1;\nconst b = Math.max(a, 2);", declares: new Set(["a", "b"]), uses: new Set(["a", "b", "max"]) }], edges: [], cycles: [] });
});

test('a section that uses a name not declared anywhere produces no edges', () => {
  assert.deepEqual(scoreCuts('const a = 1;\nconst b = zzz;', [1]), { sections: [{ n: 1, from: 1, to: 0, lines: 1, text: "", declares: new Set([]), uses: new Set([]) }, { n: 2, from: 1, to: 2, lines: 2, text: "const a = 1;\nconst b = zzz;", declares: new Set(["a", "b"]), uses: new Set(["a", "b", "zzz"]) }], edges: [], cycles: [] });
});

test('a cut at line 1 of a one-line source yields an empty first section', () => {
  assert.deepEqual(scoreCuts('const a = 1;', [1]), { sections: [{ n: 1, from: 1, to: 0, lines: 1, text: "", declares: new Set([]), uses: new Set([]) }, { n: 2, from: 1, to: 1, lines: 1, text: "const a = 1;", declares: new Set(["a"]), uses: new Set(["a"]) }], edges: [], cycles: [] });
});

test('a cut beyond the last line yields an empty trailing section', () => {
  assert.deepEqual(scoreCuts('const a = 1;\nconst b = 2;', [3]), { sections: [{ n: 1, from: 1, to: 2, lines: 2, text: "const a = 1;\nconst b = 2;", declares: new Set(["a", "b"]), uses: new Set(["a", "b"]) }, { n: 2, from: 3, to: 2, lines: 1, text: "", declares: new Set([]), uses: new Set([]) }], edges: [], cycles: [] });
});

test('a cut at the first line of a two-line source yields an empty first section', () => {
  assert.deepEqual(scoreCuts('const a = 1;\nconst b = 2;', [1]), { sections: [{ n: 1, from: 1, to: 0, lines: 1, text: "", declares: new Set([]), uses: new Set([]) }, { n: 2, from: 1, to: 2, lines: 2, text: "const a = 1;\nconst b = 2;", declares: new Set(["a", "b"]), uses: new Set(["a", "b"]) }], edges: [], cycles: [] });
});
