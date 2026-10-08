// C3: the two directions stay separate, coverage gaps are not disagreement, and a zero divergence
// is measured or it is not reported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../reconcile.mjs';
import { makeEdge, makeNode, nodeId } from '../graph.mjs';

// `modules` carries what C1 COULD have claimed. C3 needs it to tell a hole in the literal
// extraction from a path that was never a literal — without it, tracing one directory walk reports
// two thousand false negatives.
const g = (edges, pathLiterals = []) => ({
  generatedAt: '2026-09-02T00:00:00.000Z',
  nodes: [makeNode('module', 'bin/a.mjs'), makeNode('artifact', 'reports/x.json')],
  modules: [{ path: 'bin/a.mjs', state: 'analysed', pathLiterals }],
  edges,
});
const edge = (from, to, kind, opts) => makeEdge(nodeId('module', from), nodeId('artifact', to), kind, opts);
const rt = (coverage, observations) => ({ state: 'usable', coverage, observations });

test('an edge BOTH witnesses saw is confirmed', () => {
  const r = reconcile(g([edge('bin/a.mjs', 'reports/x.json', 'reads')]),
    rt(['bin/a.mjs'], [{ from: 'bin/a.mjs', to: 'reports/x.json', kind: 'reads' }]));
  assert.equal(r.state, 'measured');
  assert.equal(r.divergence, 0);
  assert.equal(r.confirmed.length, 1);
  assert.equal(r.edges[0].witness, 'both');
  assert.equal(r.edges[0].existence, 'confirmed');
});

test('THE ZERO IS MEASURED — comparable is non-zero when divergence is 0', () => {
  const r = reconcile(g([edge('bin/a.mjs', 'reports/x.json', 'reads')]),
    rt(['bin/a.mjs'], [{ from: 'bin/a.mjs', to: 'reports/x.json', kind: 'reads' }]));
  assert.ok(r.comparable > 0, 'a divergence of 0 over 0 comparable edges is not agreement');
});

test('AN UNUSABLE TRACE IS NEVER A ZERO', () => {
  // The inert-instrument failure: an empty observation concurs with an empty expectation and the
  // reconciliation reports concord. Refused structurally — `divergence` is null, not 0.
  for (const bad of [{ state: 'unusable', reason: 'preload never ran' }, { state: 'absent', reason: 'no trace' }, null]) {
    const r = reconcile(g([edge('bin/a.mjs', 'reports/x.json', 'reads')]), bad);
    assert.equal(r.state, 'unmeasured');
    assert.equal(r.divergence, null, 'an unusable second witness must not be able to produce agreement');
    assert.ok(r.reason, 'and it must say why');
  }
});

test('COVERAGE GAP IS NOT DISAGREEMENT', () => {
  // The failure this prevents scales with the population: score every unvisited module as a
  // contradiction and the divergence count grows with how much code you did NOT exercise.
  const r = reconcile(g([edge('bin/never-run.mjs', 'reports/x.json', 'reads')]), rt(['bin/other.mjs'], []));
  assert.equal(r.unconfirmed.length, 0, 'a module the run never entered cannot contradict anything');
  assert.equal(r.outOfScope.length, 1);
  assert.equal(r.edges[0].existence, 'unknown');
  assert.equal(r.edges[0].runtimeCoverage, 'unvisited');
  assert.equal(r.state, 'unmeasured', 'nothing was comparable, so nothing was measured');
});

test('FALSE NEGATIVE — the run did it, C1 had the literal, and emitted no edge', () => {
  const r = reconcile(g([], ['reports/surprise.json']),
    rt(['bin/a.mjs'], [{ from: 'bin/a.mjs', to: 'reports/surprise.json', kind: 'reads' }]));
  assert.equal(r.falseNegatives.length, 1, 'this is the direction that lies: a hole in the static pass');
  assert.equal(r.unconfirmed.length, 0);
  assert.equal(r.divergence, 1);
});

test('UNCONFIRMED — C1 claimed it, the module ran, the edge was not observed', () => {
  const r = reconcile(g([edge('bin/a.mjs', 'reports/x.json', 'reads')]), rt(['bin/a.mjs'], []));
  assert.equal(r.unconfirmed.length, 1);
  assert.equal(r.falseNegatives.length, 0);
  // NOT 'contradicted'. Module-granularity coverage cannot separate a wrong claim from a correct
  // claim on an unexercised branch, and publishing the union as a contradiction is an unknown
  // wearing a verdict.
  assert.equal(r.edges[0].existence, 'unknown');
  assert.equal(r.edges[0].unconfirmed, true);
});

test('A PATH THAT WAS NEVER A LITERAL IS NOT A MISS', () => {
  // Measured on this repo: tracing one recursive directory walk produced 2,001 "false negatives",
  // 1,971 of which were paths C1 could not have seen because they were built, not written.
  const r = reconcile(g([], []),
    rt(['bin/a.mjs'], [{ from: 'bin/a.mjs', to: 'reports/walked/deep.json', kind: 'reads' }]));
  assert.equal(r.falseNegatives.length, 0, 'a computed path is outside C1\'s reach by construction');
  assert.equal(r.dynamicPaths.length, 1, 'and it is reported, not dropped');
});

test('a bare literal and a resolved path are ONE edge at two resolutions', () => {
  const r = reconcile(g([edge('bin/a.mjs', 'rollup.json', 'reads')], ['rollup.json']),
    rt(['bin/a.mjs'], [{ from: 'bin/a.mjs', to: 'reports/area/rollup.json', kind: 'reads' }]));
  assert.equal(r.falseNegatives.length, 0, 'C1 saw it — it just could not resolve the directory');
  assert.equal(r.matchedByName.length, 1);
});

test('the two directions are never summed into one confidence', () => {
  const r = reconcile(g([edge('bin/a.mjs', 'reports/x.json', 'reads')], ['reports/other.json']),
    rt(['bin/a.mjs'], [{ from: 'bin/a.mjs', to: 'reports/other.json', kind: 'reads' }]));
  assert.equal(r.falseNegatives.length, 1);
  assert.equal(r.unconfirmed.length, 1);
  assert.equal(r.divergence, 2);
  assert.notDeepEqual(r.falseNegatives, r.unconfirmed, 'they are distinct lists, not one number');
});

test('an undetermined direction cannot be contradicted', () => {
  const r = reconcile(g([edge('bin/a.mjs', 'reports/x.json', 'touches')]), rt(['bin/a.mjs'], []));
  assert.equal(r.unconfirmed.length, 0, 'C1 never claimed a direction, so the run cannot refute one');
  assert.equal(r.edges[0].unfalsifiable, true);
});

test('a dynamic import that did not fire is unknown, not contradicted', () => {
  const e = makeEdge(nodeId('module', 'bin/a.mjs'), nodeId('module', 'bin/b.mjs'), 'reads',
    { evidence: 'bin/a.mjs:3 dynamic-import' });
  const r = reconcile({ nodes: [], edges: [e] }, rt(['bin/a.mjs'], []));
  assert.equal(r.unconfirmed.length, 0);
  assert.equal(r.edges[0].existence, 'unknown');
});
