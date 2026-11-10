// Formats a codegraph build summary into a fixed-width report (codegraph/report.mjs formatBuild).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBuild } from '../report.mjs';

function mkGraph(overrides = {}) {
  return {
    source: 'src',
    files: { input: 10, partial: [] },
    nodes: Array.from({ length: 3 }, () => ({})),
    edges: Array.from({ length: 4 }, () => ({ kind: 'calls' })),
    summary: {
      analysed: 8,
      partial: 1,
      unreadable: 0,
      unreadableByReason: {},
      nodesByKind: { fn: 3 },
      edgesByKind: { calls: 4 },
      edgesByExistence: { exists: 4 },
      divergence: {
        falsePositive: [],
        falseNegative: [],
        filesCompared: 8,
        reexports: null,
      },
      unresolved: {
        imports: [],
        calls: [],
        ambiguousCalls: [],
        callsByReason: {},
      },
    },
    ...overrides,
  };
}

test('filters unknown calls by why equals unknown', () => {
  const g = mkGraph();
  g.summary.unresolved.calls = [
    { why: 'unknown', name: 'foo', sites: 2, where: ['a.mjs'] },
    { why: 'shadowed', name: 'bar', sites: 1, where: ['b.mjs'] },
  ];
  assert.deepEqual(formatBuild(g), "\u2500\u2500 codegraph \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\npopulation     8 analysed + 1 partial + 0 unreadable = 10 tracked .mjs  (src)\ngraph          nodes 3 {\"fn\":3}\n               edges 4 {\"calls\":4}\n               existence {\"exists\":4}\nW1 vs W2       the export surface, compared in both directions over every analysed file\n               FALSE POSITIVE  0 file(s) where W1 claims an export V8 does not have\n               FALSE NEGATIVE  0 file(s) where V8 has an export W1 never found\n               agreed on 8/8 files\nW1 vs W2       re-exports NOT compared \u2014 this graph predates the re-export witness\nunresolved     imports 0  calls {}\n               1 call name(s) resolve to nothing this can see (33.3% of call sites)\n                 foo \u00d72  a.mjs\n               ambiguous 0 (a local declaration and an import share the name)");
});

test('shows first five partial files starting at index zero', () => {
  const g = mkGraph();
  g.files.partial = Array.from({ length: 6 }, (_, i) => ({ path: `p${i}.mjs`, reason: 'r'.repeat(100) }));
  assert.deepEqual(formatBuild(g), "\u2500\u2500 codegraph \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\npopulation     8 analysed + 1 partial + 0 unreadable = 10 tracked .mjs  (src)\n               partial  p0.mjs  rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr\n               partial  p1.mjs  rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr\n               partial  p2.mjs  rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr\n               partial  p3.mjs  rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr\n               partial  p4.mjs  rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr\ngraph          nodes 3 {\"fn\":3}\n               edges 4 {\"calls\":4}\n               existence {\"exists\":4}\nW1 vs W2       the export surface, compared in both directions over every analysed file\n               FALSE POSITIVE  0 file(s) where W1 claims an export V8 does not have\n               FALSE NEGATIVE  0 file(s) where V8 has an export W1 never found\n               agreed on 8/8 files\nW1 vs W2       re-exports NOT compared \u2014 this graph predates the re-export witness\nunresolved     imports 0  calls {}\n               0 call name(s) resolve to nothing this can see (0.0% of call sites)\n               ambiguous 0 (a local declaration and an import share the name)");
});

test('lists first five false positive exports starting at index zero', () => {
  const g = mkGraph();
  g.summary.divergence.falsePositive = Array.from({ length: 6 }, (_, i) => ({ path: `fp${i}.mjs`, names: [`n${i}`] }));
  assert.deepEqual(formatBuild(g), "\u2500\u2500 codegraph \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\npopulation     8 analysed + 1 partial + 0 unreadable = 10 tracked .mjs  (src)\ngraph          nodes 3 {\"fn\":3}\n               edges 4 {\"calls\":4}\n               existence {\"exists\":4}\nW1 vs W2       the export surface, compared in both directions over every analysed file\n               FALSE POSITIVE  6 file(s) where W1 claims an export V8 does not have\n                 fp0.mjs  n0\n                 fp1.mjs  n1\n                 fp2.mjs  n2\n                 fp3.mjs  n3\n                 fp4.mjs  n4\n               FALSE NEGATIVE  0 file(s) where V8 has an export W1 never found\n               agreed on 2/8 files\nW1 vs W2       re-exports NOT compared \u2014 this graph predates the re-export witness\nunresolved     imports 0  calls {}\n               0 call name(s) resolve to nothing this can see (0.0% of call sites)\n               ambiguous 0 (a local declaration and an import share the name)");
});

test('lists first five false negative exports starting at index zero', () => {
  const g = mkGraph();
  g.summary.divergence.falseNegative = Array.from({ length: 6 }, (_, i) => ({ path: `fn${i}.mjs`, names: [`m${i}`] }));
  assert.deepEqual(formatBuild(g), "\u2500\u2500 codegraph \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\npopulation     8 analysed + 1 partial + 0 unreadable = 10 tracked .mjs  (src)\ngraph          nodes 3 {\"fn\":3}\n               edges 4 {\"calls\":4}\n               existence {\"exists\":4}\nW1 vs W2       the export surface, compared in both directions over every analysed file\n               FALSE POSITIVE  0 file(s) where W1 claims an export V8 does not have\n               FALSE NEGATIVE  6 file(s) where V8 has an export W1 never found\n                 fn0.mjs  m0\n                 fn1.mjs  m1\n                 fn2.mjs  m2\n                 fn3.mjs  m3\n                 fn4.mjs  m4\n               agreed on 2/8 files\nW1 vs W2       re-exports NOT compared \u2014 this graph predates the re-export witness\nunresolved     imports 0  calls {}\n               0 call name(s) resolve to nothing this can see (0.0% of call sites)\n               ambiguous 0 (a local declaration and an import share the name)");
});

test('lists first five re-export false positives starting at index zero', () => {
  const g = mkGraph();
  g.summary.divergence.reexports = {
    falsePositive: Array.from({ length: 6 }, (_, i) => ({ path: `rp${i}.mjs`, reexports: [`x${i}`] })),
    falseNegative: [],
  };
  assert.deepEqual(formatBuild(g), "\u2500\u2500 codegraph \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\npopulation     8 analysed + 1 partial + 0 unreadable = 10 tracked .mjs  (src)\ngraph          nodes 3 {\"fn\":3}\n               edges 4 {\"calls\":4}\n               existence {\"exists\":4}\nW1 vs W2       the export surface, compared in both directions over every analysed file\n               FALSE POSITIVE  0 file(s) where W1 claims an export V8 does not have\n               FALSE NEGATIVE  0 file(s) where V8 has an export W1 never found\n               agreed on 8/8 files\nW1 vs W2       what each re-export resolves to, compared the same way\n               FALSE POSITIVE  6 file(s) where W1 reads a re-export V8 does not resolve\n                 rp0.mjs  x0\n                 rp1.mjs  x1\n                 rp2.mjs  x2\n                 rp3.mjs  x3\n                 rp4.mjs  x4\n               FALSE NEGATIVE  0 file(s) where V8 resolves a re-export W1 never read\nunresolved     imports 0  calls {}\n               0 call name(s) resolve to nothing this can see (0.0% of call sites)\n               ambiguous 0 (a local declaration and an import share the name)");
});

test('lists first five re-export false negatives starting at index zero', () => {
  const g = mkGraph();
  g.summary.divergence.reexports = {
    falsePositive: [],
    falseNegative: Array.from({ length: 6 }, (_, i) => ({ path: `rn${i}.mjs`, reexports: [`y${i}`] })),
  };
  assert.deepEqual(formatBuild(g), "\u2500\u2500 codegraph \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\npopulation     8 analysed + 1 partial + 0 unreadable = 10 tracked .mjs  (src)\ngraph          nodes 3 {\"fn\":3}\n               edges 4 {\"calls\":4}\n               existence {\"exists\":4}\nW1 vs W2       the export surface, compared in both directions over every analysed file\n               FALSE POSITIVE  0 file(s) where W1 claims an export V8 does not have\n               FALSE NEGATIVE  0 file(s) where V8 has an export W1 never found\n               agreed on 8/8 files\nW1 vs W2       what each re-export resolves to, compared the same way\n               FALSE POSITIVE  0 file(s) where W1 reads a re-export V8 does not resolve\n               FALSE NEGATIVE  6 file(s) where V8 resolves a re-export W1 never read\n                 rn0.mjs  y0\n                 rn1.mjs  y1\n                 rn2.mjs  y2\n                 rn3.mjs  y3\n                 rn4.mjs  y4\nunresolved     imports 0  calls {}\n               0 call name(s) resolve to nothing this can see (0.0% of call sites)\n               ambiguous 0 (a local declaration and an import share the name)");
});

test('computes unknown call percentage over total call sites', () => {
  const g = mkGraph();
  g.summary.unresolved.calls = [
    { why: 'unknown', name: 'a', sites: 3, where: ['w1'] },
    { why: 'unknown', name: 'b', sites: 7, where: ['w2'] },
  ];
  assert.deepEqual(formatBuild(g), "\u2500\u2500 codegraph \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\npopulation     8 analysed + 1 partial + 0 unreadable = 10 tracked .mjs  (src)\ngraph          nodes 3 {\"fn\":3}\n               edges 4 {\"calls\":4}\n               existence {\"exists\":4}\nW1 vs W2       the export surface, compared in both directions over every analysed file\n               FALSE POSITIVE  0 file(s) where W1 claims an export V8 does not have\n               FALSE NEGATIVE  0 file(s) where V8 has an export W1 never found\n               agreed on 8/8 files\nW1 vs W2       re-exports NOT compared \u2014 this graph predates the re-export witness\nunresolved     imports 0  calls {}\n               2 call name(s) resolve to nothing this can see (71.4% of call sites)\n                 a \u00d73  w1\n                 b \u00d77  w2\n               ambiguous 0 (a local declaration and an import share the name)");
});

test('lists first five unknown calls starting at index zero', () => {
  const g = mkGraph();
  g.summary.unresolved.calls = Array.from({ length: 6 }, (_, i) => ({ why: 'unknown', name: `c${i}`, sites: 1, where: [`f${i}`] }));
  assert.deepEqual(formatBuild(g), "\u2500\u2500 codegraph \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\npopulation     8 analysed + 1 partial + 0 unreadable = 10 tracked .mjs  (src)\ngraph          nodes 3 {\"fn\":3}\n               edges 4 {\"calls\":4}\n               existence {\"exists\":4}\nW1 vs W2       the export surface, compared in both directions over every analysed file\n               FALSE POSITIVE  0 file(s) where W1 claims an export V8 does not have\n               FALSE NEGATIVE  0 file(s) where V8 has an export W1 never found\n               agreed on 8/8 files\nW1 vs W2       re-exports NOT compared \u2014 this graph predates the re-export witness\nunresolved     imports 0  calls {}\n               6 call name(s) resolve to nothing this can see (60.0% of call sites)\n                 c0 \u00d71  f0\n                 c1 \u00d71  f1\n                 c2 \u00d71  f2\n                 c3 \u00d71  f3\n                 c4 \u00d71  f4\n               ambiguous 0 (a local declaration and an import share the name)");
});
