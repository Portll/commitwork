// lib/dfd-coverage.mjs: test coverage as a layer over dfd@1 — an element's lines, a flow a test
// exercised, a patch's negative control — and the gaps where a verdict is not supported. Also the
// schema and validateDfd additions that carry it (nodes[].coverage, flows[].coverage,
// patches[].evidence.control). Absent is not measured, never zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDfd, threatPaths } from '../dfd.mjs';
import { COVERAGE_FLOOR, GAP_KINDS, nodeCoverage, patchProof, pathCoverage, coverageGaps, coverageSummary } from '../dfd-coverage.mjs';

/** artifact -> parser -> {memory, abort}; artifact -> framework -> corruption. K1 closes parser>memory, K2 parser>abort. */
function base() {
  return {
    v: 1, kind: 'dfd',
    nodes: [
      { id: 'a', kind: 'external', subtype: 'actor', label: 'artifact' },
      { id: 'p', kind: 'process', label: 'parser' },
      { id: 'mem', kind: 'store', subtype: 'file', label: 'memory', impact: 'medium' },
      { id: 'abort', kind: 'external', subtype: 'system', label: 'abort', impact: 'low' },
      { id: 'fw', kind: 'external', subtype: 'system', label: 'framework' },
      { id: 'os', kind: 'external', subtype: 'system', label: 'corruption', impact: 'critical' },
    ],
    flows: [
      { from: 'a', to: 'p', mode: 'sync' },
      { from: 'p', to: 'mem', mode: 'sync' },
      { from: 'p', to: 'abort', mode: 'sync', role: 'error' },
      { from: 'a', to: 'fw', mode: 'sync' },
      { from: 'fw', to: 'os', mode: 'sync' },
    ],
    patches: [
      { id: 'K1', guard: { from: 'a', to: 'p' }, closes: [{ from: 'p', to: 'mem' }], evidence: { level: 'tested', control: { failsWithout: true, passesWith: true, test: 'deep input' } } },
      { id: 'K2', guard: { from: 'a', to: 'p' }, closes: [{ from: 'p', to: 'abort' }], evidence: { level: 'tested' } },
    ],
  };
}
const to = (r, id) => r.paths.find((p) => p.nodes[p.nodes.length - 1] === id);
const kinds = (gaps) => gaps.map((g) => g.kind);

test('the floor and the gap kinds are the ones the layer documents', () => {
  // arrange
  const expected = ['critical-untouched', 'closed-unproven', 'unevaluated-step', 'below-floor', 'unmeasured-element', 'unexercised-flow'];
  // act
  const got = { floor: COVERAGE_FLOOR, kinds: [...GAP_KINDS] };
  // assert
  assert.deepEqual(got, { floor: 0.8, kinds: expected });
});

test('a document carrying element coverage, flow coverage and a patch control validates', () => {
  // arrange
  const doc = base();
  doc.nodes[1].coverage = { lines: { covered: 40, total: 50 }, branches: { covered: 3, total: 10 }, source: 'lcov.info' };
  doc.flows[0].coverage = { exercised: true, tests: ['parser.test.mjs'], witness: 'trace hook' };
  doc.patches[0].evidence.control.ref = 'run.log';
  // act
  const r = validateDfd(doc);
  // assert
  assert.deepEqual(r.errors, []);
});

test('more covered than there are is rejected, for lines and for branches', () => {
  // arrange
  const doc = base();
  doc.nodes[1].coverage = { lines: { covered: 51, total: 50 }, branches: { covered: 11, total: 10 } };
  doc.nodes[4].coverage = { lines: { covered: 5, total: 5 } };
  // act
  const r = validateDfd(doc);
  // assert
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0], /node "p" carries coverage\.lines with 51 covered of 50/);
  assert.match(r.errors[1], /node "p" carries coverage\.branches with 11 covered of 10/);
});

test('the schema refuses a control without both answers and a coverage without lines', () => {
  // arrange
  const half = base();
  half.patches[0].evidence.control = { failsWithout: true };
  const bare = base();
  bare.nodes[1].coverage = { source: 'somewhere' };
  const flow = base();
  flow.flows[0].coverage = { tests: ['x'] };
  // act
  const results = [validateDfd(half), validateDfd(bare), validateDfd(flow)];
  // assert
  assert.deepEqual(results.map((r) => r.ok), [false, false, false]);
});

test('nodeCoverage gives shares, and null where nothing was measured or there is nothing to cover', () => {
  // arrange
  const nodes = [{ id: 'x' }, { id: 'y', coverage: { lines: { covered: 3, total: 4 } } }, { id: 'z', coverage: { lines: { covered: 0, total: 0 }, branches: { covered: 1, total: 2 } } }];
  // act
  const got = nodes.map(nodeCoverage);
  const none = nodeCoverage(undefined);
  // assert
  assert.deepEqual(got, [{ measured: false, lines: null, branches: null }, { measured: true, lines: 0.75, branches: null }, { measured: true, lines: null, branches: 0.5 }]);
  assert.deepEqual(none, { measured: false, lines: null, branches: null });
});

test('patchProof is controlled only with a tested level and a control that fails without and passes with', () => {
  // arrange
  const cases = [
    { evidence: { level: 'tested', control: { failsWithout: true, passesWith: true } } },
    { evidence: { level: 'tested', control: { failsWithout: false, passesWith: true } } },
    { evidence: { level: 'tested', control: { failsWithout: true, passesWith: false } } },
    { evidence: { level: 'tested' } },
    { evidence: { level: 'asserted', control: { failsWithout: true, passesWith: true } } },
    { evidence: { level: 'rescanned' } },
    {},
    undefined,
  ];
  // act
  const got = cases.map(patchProof);
  // assert
  assert.deepEqual(got, ['controlled', 'tested', 'tested', 'tested', 'unproven', 'unproven', 'unproven', 'unproven']);
});

test('pathCoverage keeps threatPaths\'s path and adds what tests say about it', () => {
  // arrange
  const doc = base();
  doc.nodes[1].coverage = { lines: { covered: 10, total: 50 } };
  doc.flows[0].coverage = { exercised: true };
  doc.flows[1].coverage = { exercised: false };
  doc.flows[4].gate = { state: 'unevaluated' };
  const tp = threatPaths(doc);
  // act
  const r = pathCoverage(doc);
  // assert
  assert.equal(r.truncated, false);
  assert.deepEqual(r.paths.map((p) => [p.nodes, p.flows, p.impact, p.state, p.decidedBy, p.proven]), tp.paths.map((p) => [p.nodes, p.flows, p.impact, p.state, p.decidedBy, p.proven]));
  assert.deepEqual(to(r, 'mem').exercised, { total: 2, measured: 2, exercised: 1 });
  assert.deepEqual(to(r, 'mem').steps, { total: 2, withVerdict: 2 });
  assert.deepEqual(to(r, 'mem').belowFloor, ['p']);
  assert.deepEqual(to(r, 'mem').unmeasured, []);
  assert.deepEqual(to(r, 'os').steps, { total: 2, withVerdict: 1 });
  assert.deepEqual(to(r, 'os').exercised, { total: 2, measured: 0, exercised: 0 });
});

test('unmeasured leaves out the source and the impact, and lists the code between', () => {
  // arrange
  const doc = base();
  // act
  const r = pathCoverage(doc);
  // assert
  assert.deepEqual(to(r, 'mem').unmeasured, ['p']);
  assert.deepEqual(to(r, 'os').unmeasured, ['fw']);
});

test('the floor is the caller\'s: an element at the floor is not below it, and a total of zero is never below', () => {
  // arrange
  const doc = base();
  doc.nodes[1].coverage = { lines: { covered: 40, total: 50 } };
  doc.nodes[4].coverage = { lines: { covered: 0, total: 0 } };
  // act
  const atDefault = pathCoverage(doc);
  const strict = pathCoverage(doc, { floor: 0.9 });
  // assert
  assert.deepEqual(to(atDefault, 'mem').belowFloor, []);
  assert.deepEqual(to(strict, 'mem').belowFloor, ['p']);
  assert.deepEqual(to(strict, 'os').belowFloor, []);
});

test('maxPaths and the applied set pass through to threatPaths', () => {
  // arrange
  const doc = base();
  // act
  const cut = pathCoverage(doc, { maxPaths: 1 });
  const none = pathCoverage(doc, { applied: [] });
  // assert
  assert.deepEqual([cut.paths.length, cut.truncated], [1, true]);
  assert.deepEqual(none.paths.map((p) => p.state), ['open', 'open', 'open']);
});

test('a critical path that is not closed and that no test exercised is the first gap', () => {
  // arrange
  const doc = base();
  // act
  const gaps = coverageGaps(doc);
  // assert
  assert.deepEqual([gaps[0].kind, gaps[0].impact, gaps[0].path], ['critical-untouched', 'critical', ['a', 'fw', 'os']]);
  assert.match(gaps[0].detail, /open, and no test exercised any of its 2 flow\(s\) \(none was measured\)/);
});

test('a critical path with one exercised flow is not untouched, and an unevaluated one says so when measured', () => {
  // arrange
  const touched = base();
  touched.flows[3].coverage = { exercised: true };
  const measured = base();
  measured.flows[3].coverage = { exercised: false };
  measured.flows[4].gate = { state: 'unevaluated' };
  // act
  const a = coverageGaps(touched);
  const b = coverageGaps(measured);
  // assert
  assert.equal(kinds(a).includes('critical-untouched'), false);
  assert.match(b.find((g) => g.kind === 'critical-untouched').detail, /^a critical path that is not evaluated, and no test exercised any of its 2 flow\(s\)$/);
});

test('a path closed by a tested patch with no control is a gap; one with a control is not', () => {
  // arrange
  const doc = base();
  // act
  const gaps = coverageGaps(doc).filter((g) => g.kind === 'closed-unproven');
  // assert
  assert.deepEqual(gaps.map((g) => [g.patch, g.flow, g.impact]), [['K2', 2, 'low']]);
  assert.match(gaps[0].detail, /closed at p -> abort by patch K2: tested, with no control/);
  assert.deepEqual(gaps[0].patches, ['K2']);
});

test('a path closed by an untested patch names its evidence, or that it has none', () => {
  // arrange
  const doc = base();
  doc.patches[0].evidence = { level: 'asserted' };
  delete doc.patches[1].evidence;
  // act
  const gaps = coverageGaps(doc).filter((g) => g.kind === 'closed-unproven');
  // assert
  assert.match(gaps.find((g) => g.patch === 'K1').detail, /its evidence is asserted, not a test/);
  assert.match(gaps.find((g) => g.patch === 'K2').detail, /its evidence is absent, not a test/);
});

test('a safe verdict with no runtime proof is a closed-unproven gap on its flow; a runtime one is not', () => {
  // arrange
  const stat = base();
  stat.flows[4].gate = { state: 'safe', evidence: { level: 'static' } };
  const run = base();
  run.flows[4].gate = { state: 'safe', evidence: { level: 'runtime' } };
  // act
  const a = coverageGaps(stat).filter((g) => g.kind === 'closed-unproven' && g.patch === undefined);
  const b = coverageGaps(run).filter((g) => g.kind === 'closed-unproven' && g.patch === undefined);
  // assert
  assert.deepEqual(a.map((g) => [g.flow, g.impact]), [[4, 'critical']]);
  assert.match(a[0].detail, /closed by a safe verdict at fw -> os with no runtime proof/);
  assert.deepEqual(b, []);
});

test('one gap per patch, flow and element, carrying the worst impact of the paths that meet in it', () => {
  // arrange: one untested patch closes the shared input, so it decides all of the parser's paths
  const doc = base();
  doc.nodes.push({ id: 'exec', kind: 'external', subtype: 'system', label: 'execution', impact: 'critical' });
  doc.flows.push({ from: 'p', to: 'exec', mode: 'sync' });
  doc.patches = [{ id: 'K0', closes: [{ from: 'a', to: 'p' }], evidence: { level: 'inspected' } }];
  doc.nodes[1].coverage = { lines: { covered: 1, total: 10 } };
  // act
  const gaps = coverageGaps(doc);
  const patch = gaps.filter((g) => g.patch === 'K0');
  const element = gaps.filter((g) => g.node === 'p');
  // assert
  assert.equal(patch.length, 1);
  assert.deepEqual([patch[0].impact, patch[0].path], ['critical', ['a', 'p', 'exec']]);
  assert.deepEqual(element.map((g) => [g.kind, g.impact]), [['below-floor', 'critical']]);
  assert.match(element[0].detail, /p is measured at 10% of its lines, under the floor of 80%/);
});

test('an unevaluated step, an unexercised flow and an unmeasured element are each listed once', () => {
  // arrange
  const doc = base();
  doc.flows[3].gate = { state: 'unevaluated' };
  doc.flows[3].coverage = { exercised: false };
  // act
  const gaps = coverageGaps(doc);
  // assert
  assert.deepEqual(gaps.filter((g) => g.kind === 'unevaluated-step').map((g) => [g.flow, g.impact, g.detail]), [[3, 'critical', 'nobody has evaluated a -> fw']]);
  assert.deepEqual(gaps.filter((g) => g.kind === 'unexercised-flow').map((g) => [g.flow, g.detail]), [[3, 'a test run measured a -> fw and never exercised it']]);
  assert.deepEqual(gaps.filter((g) => g.kind === 'unmeasured-element').map((g) => [g.node, g.impact, g.detail]), [['fw', 'critical', 'no test run measured fw'], ['p', 'medium', 'no test run measured p']]);
});

test('gaps are ordered by impact, then by kind, then as found', () => {
  // arrange
  const doc = base();
  doc.flows[3].gate = { state: 'unevaluated' };
  // act
  const gaps = coverageGaps(doc);
  // assert
  assert.deepEqual(gaps.map((g) => [g.impact, g.kind]), [
    ['critical', 'critical-untouched'], ['critical', 'unevaluated-step'], ['critical', 'unmeasured-element'],
    ['medium', 'unmeasured-element'], ['low', 'closed-unproven'],
  ]);
});

test('a fully supported document has no gap', () => {
  // arrange
  const doc = base();
  doc.patches[1].evidence.control = { failsWithout: true, passesWith: true };
  doc.flows[4].gate = { state: 'safe', evidence: { level: 'runtime' } };
  doc.nodes[1].coverage = { lines: { covered: 9, total: 10 } };
  doc.nodes[4].coverage = { lines: { covered: 10, total: 10 } };
  for (const f of doc.flows) f.coverage = { exercised: true };
  // act
  const gaps = coverageGaps(doc);
  const s = coverageSummary(doc);
  // assert
  assert.deepEqual(gaps, []);
  assert.deepEqual(s.gaps, { 'critical-untouched': 0, 'closed-unproven': 0, 'unevaluated-step': 0, 'below-floor': 0, 'unmeasured-element': 0, 'unexercised-flow': 0 });
  assert.deepEqual(s.paths, { total: 3, allStepsExercised: 3, noStepExercised: 0 });
});

test('the summary counts what lies on a path, and every patch by how far it is proven', () => {
  // arrange: an element and a flow no path reaches are not counted
  const doc = base();
  doc.nodes.push({ id: 'aside', kind: 'process', label: 'aside', coverage: { lines: { covered: 0, total: 9 } } });
  doc.flows.push({ from: 'p', to: 'aside', mode: 'sync', coverage: { exercised: true } });
  doc.patches.push({ id: 'K3', closes: [], evidence: { level: 'asserted' } });
  doc.nodes[1].coverage = { lines: { covered: 1, total: 4 } };
  doc.flows[0].coverage = { exercised: true };
  doc.flows[1].coverage = { exercised: false };
  // act
  const s = coverageSummary(doc);
  // assert
  assert.deepEqual(s.elements, { total: 6, measured: 1, belowFloor: 1 });
  assert.deepEqual(s.flows, { total: 5, measured: 2, exercised: 1 });
  assert.deepEqual(s.patches, { total: 3, beltAndBraces: 0, controlled: 1, static: 0, tested: 1, unproven: 1 });
  assert.deepEqual(s.paths, { total: 3, allStepsExercised: 0, noStepExercised: 1 });
  assert.deepEqual(s.gaps, { 'critical-untouched': 1, 'closed-unproven': 1, 'unevaluated-step': 0, 'below-floor': 1, 'unmeasured-element': 1, 'unexercised-flow': 1 });
  assert.equal(s.measuredAnything, true);
});

test('with nothing measured the summary says so: its zeros are absences, not results', () => {
  // arrange
  const doc = base();
  delete doc.patches;
  // act
  const s = coverageSummary(doc);
  const withControl = coverageSummary(base());
  // assert
  assert.equal(s.measuredAnything, false);
  assert.deepEqual(s.patches, { total: 0, beltAndBraces: 0, controlled: 0, static: 0, tested: 0, unproven: 0 });
  assert.deepEqual(s.elements, { total: 6, measured: 0, belowFloor: 0 });
  assert.equal(withControl.measuredAnything, true);
});

test('measuredAnything is true on element coverage alone, and on flow coverage alone', () => {
  // arrange
  const byNode = base();
  delete byNode.patches;
  byNode.nodes[1].coverage = { lines: { covered: 1, total: 1 } };
  const byFlow = base();
  delete byFlow.patches;
  byFlow.flows[0].coverage = { exercised: false };
  // act
  const got = [coverageSummary(byNode).measuredAnything, coverageSummary(byFlow).measuredAnything];
  // assert
  assert.deepEqual(got, [true, true]);
});

test('a model with no impact has no path, no gap, and a summary of zeros', () => {
  // arrange
  const doc = base();
  for (const n of doc.nodes) delete n.impact;
  // act
  const r = pathCoverage(doc);
  const gaps = coverageGaps(doc);
  const s = coverageSummary(doc);
  // assert
  assert.deepEqual(r.paths, []);
  assert.deepEqual(gaps, []);
  assert.deepEqual([s.elements.total, s.flows.total, s.paths.total], [0, 0, 0]);
});

test('a closing step two unproven patches share is one gap that names both', () => {
  // arrange: K1 and K2 both close p>mem; neither has a control
  const doc = base();
  doc.patches[0].evidence = { level: 'tested' };
  doc.patches[1].closes = [{ from: 'p', to: 'mem' }, { from: 'p', to: 'abort' }];
  // act
  const gaps = coverageGaps(doc).filter((g) => g.kind === 'closed-unproven');
  // assert
  assert.deepEqual(gaps.map((g) => [g.flow, g.patches]), [[1, ['K1', 'K2']], [2, ['K2']]]);
  assert.match(gaps[0].detail, /patch K1: tested.*; patch K2: tested/);
});

// ── control kinds: belt and braces ───────────────────────────────────────────────────────────────

const held = (kind) => ({ ...(kind ? { kind } : {}), failsWithout: true, passesWith: true });
const proofOf = (evidence) => patchProof({ id: 'K', closes: [], evidence });

test('a compile-time control alone is static, never controlled: it says nothing about run time', () => {
  // arrange
  const evidence = { level: 'tested', control: held('static-assert') };
  // act
  const proof = proofOf(evidence);
  // assert
  assert.equal(proof, 'static');
});

test('a run-time assertion that holds is a control, as a test is', () => {
  // arrange
  const byAssert = { level: 'tested', control: held('dynamic-assert') };
  const byTest = { level: 'tested', control: held() };
  // act
  const got = [proofOf(byAssert), proofOf(byTest)];
  // assert
  assert.deepEqual(got, ['controlled', 'controlled']);
});

test('two kinds that both hold, one of them at run time, are belt and braces', () => {
  // arrange
  const testAndStatic = { level: 'tested', control: held('test'), controls: [held('static-assert')] };
  const testAndAssert = { level: 'tested', controls: [held('test'), held('dynamic-assert')] };
  const twoTests = { level: 'tested', control: held('test'), controls: [held('test')] };
  const oneFails = { level: 'tested', control: held('test'), controls: [{ kind: 'static-assert', failsWithout: false, passesWith: true }] };
  // act
  const got = [testAndStatic, testAndAssert, twoTests, oneFails].map(proofOf);
  // assert: a second control of the same kind, or one that does not hold, adds nothing
  assert.deepEqual(got, ['belt-and-braces', 'belt-and-braces', 'controlled', 'controlled']);
});

test('a run-time control on a patch that is not marked tested proves nothing; a static one still shows', () => {
  // arrange
  const runtime = { level: 'asserted', control: held('test') };
  const compile = { level: 'inspected', control: held('static-assert') };
  // act
  const got = [proofOf(runtime), proofOf(compile), proofOf(undefined)];
  // assert
  assert.deepEqual(got, ['unproven', 'static', 'unproven']);
});

test('a step closed by a static-only patch is a gap that says so; a belt-and-braces one is none', () => {
  // arrange
  const stat = base();
  stat.patches[1].evidence = { level: 'tested', control: held('static-assert') };
  const both = base();
  both.patches[1].evidence = { level: 'tested', control: held('test'), controls: [held('dynamic-assert')] };
  // act
  const a = coverageGaps(stat).filter((g) => g.kind === 'closed-unproven');
  const b = coverageGaps(both).filter((g) => g.kind === 'closed-unproven');
  // assert
  assert.match(a[0].detail, /patch K2: a compile-time assertion only, with nothing shown at run time/);
  assert.deepEqual(b, []);
  assert.deepEqual(coverageSummary(stat).patches, { total: 2, beltAndBraces: 0, controlled: 1, static: 1, tested: 0, unproven: 0 });
  assert.deepEqual(coverageSummary(both).patches, { total: 2, beltAndBraces: 1, controlled: 1, static: 0, tested: 0, unproven: 0 });
});

test('controls with a kind validate, and an unknown kind is rejected', () => {
  // arrange
  const good = base();
  good.patches[1].evidence = { level: 'tested', control: held('test'), controls: [held('static-assert'), held('dynamic-assert')] };
  const bad = base();
  bad.patches[1].evidence = { level: 'tested', control: { kind: 'vibes', failsWithout: true, passesWith: true } };
  // act
  const g = validateDfd(good);
  const b = validateDfd(bad);
  // assert
  assert.deepEqual(g.errors, []);
  assert.equal(b.ok, false);
});
