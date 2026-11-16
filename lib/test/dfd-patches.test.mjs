// dfd@1 patch overlay: validation (lib/dfd.mjs validateDfd), per-step verdicts (stepStates) and
// source-to-impact paths (threatPaths). State belongs to a path: it is closed when any step on it
// is fixed by a patch in force or measured safe, unevaluated when a step was never measured, else open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDfd, stepStates, threatPaths, appliedPatches, IMPACTS, GATE_STATES, PATCH_EVIDENCE, STEP_STATES, PATH_STATES } from '../dfd.mjs';

/** artifact → parser → {memory, abort, reject}; artifact → framework → corruption. */
function base(extra = {}) {
  return {
    v: 1, kind: 'dfd',
    nodes: [
      { id: 'a', kind: 'external', subtype: 'actor', label: 'artifact' },
      { id: 'p', kind: 'process', label: 'parser' },
      { id: 'mem', kind: 'store', subtype: 'file', label: 'memory', impact: 'medium' },
      { id: 'abort', kind: 'external', subtype: 'system', label: 'abort', impact: 'low' },
      { id: 'rej', kind: 'external', subtype: 'system', label: 'reject' },
      { id: 'fw', kind: 'external', subtype: 'system', label: 'framework' },
      { id: 'os', kind: 'external', subtype: 'system', label: 'corruption', impact: 'critical' },
    ],
    flows: [
      { from: 'a', to: 'p', mode: 'sync' },
      { from: 'p', to: 'mem', mode: 'sync' },
      { from: 'p', to: 'abort', mode: 'sync', role: 'error' },
      { from: 'p', to: 'rej', mode: 'sync' },
      { from: 'a', to: 'fw', mode: 'sync' },
      { from: 'fw', to: 'os', mode: 'sync' },
    ],
    patches: [
      { id: 'K1', guard: { from: 'a', to: 'p' }, closes: [{ from: 'p', to: 'mem' }], rejects: [{ from: 'p', to: 'rej' }], evidence: { level: 'tested' } },
      { id: 'K2', guard: { from: 'a', to: 'p' }, closes: [{ from: 'p', to: 'mem' }, { from: 'p', to: 'abort' }], evidence: { level: 'asserted' } },
    ],
    ...extra,
  };
}
const pathTo = (r, id) => r.paths.find((p) => p.nodes[p.nodes.length - 1] === id);

test('the enums are the ones the schema carries', () => {
  // arrange
  const expected = { impacts: ['critical', 'high', 'medium', 'low'], gates: ['safe', 'unevaluated'], evidence: ['tested', 'inspected', 'rescanned', 'asserted'],
    steps: ['open', 'fixed', 'safe', 'unevaluated'], paths: ['open', 'unevaluated', 'closed'] };
  // act
  const actual = { impacts: [...IMPACTS], gates: [...GATE_STATES], evidence: [...PATCH_EVIDENCE], steps: [...STEP_STATES], paths: [...PATH_STATES] };
  // assert
  assert.deepEqual(actual, expected);
});

test('a document with patches, impacts and a gate validates', () => {
  // arrange
  const doc = base();
  doc.flows[5].gate = { state: 'safe', evidence: { level: 'static', witness: 'framework RE' } };
  // act
  const r = validateDfd(doc);
  // assert
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('a patch that names a flow the document does not carry is rejected, per field', () => {
  // arrange
  const doc = base();
  doc.patches[0].guard = { from: 'a', to: 'os' };
  doc.patches[0].closes = [{ from: 'p', to: 'os' }];
  doc.patches[0].rejects = [{ from: 'fw', to: 'rej' }];
  // act
  const r = validateDfd(doc);
  // assert
  assert.equal(r.ok, false);
  const all = r.errors.join('\n');
  assert.match(all, /"K1"\) guard names a flow "a" -> "os"/);
  assert.match(all, /"K1"\) closes names a flow "p" -> "os"/);
  assert.match(all, /"K1"\) rejects names a flow "fw" -> "rej"/);
});

test('a duplicate patch id is rejected', () => {
  // arrange
  const doc = base();
  doc.patches[1].id = 'K1';
  // act
  const r = validateDfd(doc);
  // assert
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /patch id "K1" is declared more than once/);
});

test('a patch or a gate naming an undeclared finding is rejected when findings are declared', () => {
  // arrange
  const doc = base({ findings: [{ id: 'F1', at: { node: 'p' } }] });
  doc.patches[0].findings = ['F1', 'F9'];
  doc.flows[5].gate = { state: 'unevaluated', finding: 'F7' };
  // act
  const r = validateDfd(doc);
  // assert
  assert.equal(r.ok, false);
  const all = r.errors.join('\n');
  assert.match(all, /"K1"\) names finding "F9"/);
  assert.match(all, /flows\[5\]\.gate names finding "F7"/);
  assert.doesNotMatch(all, /"F1"/);
});

test('appliedPatches defaults to every patch not marked applied:false, and an explicit list replaces it', () => {
  // arrange
  const doc = base();
  doc.patches[1].applied = false;
  // act
  const byDefault = appliedPatches(doc);
  const explicit = appliedPatches(doc, ['K2']);
  // assert
  assert.deepEqual([...byDefault], ['K1']);
  assert.deepEqual([...explicit], ['K2']);
});

test('a flow two patches close is fixed only when both are in force, and proven only when both are tested', () => {
  // arrange
  const doc = base();
  // act
  const one = stepStates(doc, { applied: ['K1'] })[1];
  const both = stepStates(doc, { applied: ['K1', 'K2'] })[1];
  // assert
  assert.deepEqual(one, { state: 'open', by: ['K1', 'K2'], proven: false, exists: true });
  assert.deepEqual(both, { state: 'fixed', by: ['K1', 'K2'], proven: false, exists: true });
});

test('a reject flow exists only while its patch is in force', () => {
  // arrange
  const doc = base();
  // act
  const before = stepStates(doc, { applied: [] })[3];
  const after = stepStates(doc, { applied: ['K1'] })[3];
  // assert
  assert.equal(before.exists, false);
  assert.equal(after.exists, true);
});

test('a safe gate is proven only on runtime evidence', () => {
  // arrange
  const stat = base();
  stat.flows[5].gate = { state: 'safe', evidence: { level: 'static' } };
  const run = base();
  run.flows[5].gate = { state: 'safe', evidence: { level: 'runtime' } };
  // act
  const s = stepStates(stat)[5];
  const r = stepStates(run)[5];
  // assert
  assert.deepEqual([s.state, s.proven], ['safe', false]);
  assert.deepEqual([r.state, r.proven], ['safe', true]);
});

test('with no patch in force every path to an impact is open', () => {
  // arrange
  const doc = base();
  // act
  const r = threatPaths(doc, { applied: [] });
  // assert
  assert.deepEqual(r.paths.map((p) => [p.nodes.join('>'), p.state]), [['a>p>mem', 'open'], ['a>p>abort', 'open'], ['a>fw>os', 'open']]);
  assert.equal(r.truncated, false);
});

test('one element is guarded on one path and open on another: state belongs to the path', () => {
  // arrange
  const doc = base();
  doc.patches[0].closes = [];
  // act: K2 alone closes both parser paths; K1 no longer names p>mem
  const r = threatPaths(doc, { applied: ['K2'] });
  const partial = threatPaths(base(), { applied: ['K2'] });
  // assert
  assert.equal(pathTo(r, 'mem').state, 'closed');
  assert.equal(pathTo(partial, 'mem').state, 'open');
  assert.equal(pathTo(partial, 'abort').state, 'closed');
  // the shared input flow a>p shows the worst path through it
  assert.equal(partial.byFlow[0], 'open');
});

test('a patch does not close a path that does not pass its flows', () => {
  // arrange
  const doc = base();
  // act
  const r = threatPaths(doc, { applied: ['K1', 'K2'] });
  // assert
  assert.equal(pathTo(r, 'mem').state, 'closed');
  assert.equal(pathTo(r, 'os').state, 'open');
  assert.equal(pathTo(r, 'os').impact, 'critical');
});

test('a closed path names the step that decided it and whether that was proven', () => {
  // arrange
  const doc = base();
  doc.flows[5].gate = { state: 'safe', evidence: { level: 'static' } };
  // act
  const r = threatPaths(doc, { applied: ['K1', 'K2'] });
  // assert
  assert.deepEqual([pathTo(r, 'os').state, pathTo(r, 'os').decidedBy, pathTo(r, 'os').proven], ['closed', 5, false]);
  assert.deepEqual([pathTo(r, 'mem').decidedBy, pathTo(r, 'mem').proven], [1, false]);
});

test('an unevaluated step leaves its path unevaluated, never closed and never open', () => {
  // arrange
  const doc = base();
  doc.flows[4].gate = { state: 'unevaluated' };
  // act
  const r = threatPaths(doc);
  // assert
  assert.deepEqual([pathTo(r, 'os').state, pathTo(r, 'os').decidedBy], ['unevaluated', 4]);
  assert.equal(r.byFlow[5], 'unevaluated');
});

test('a flow no path runs through has no path state, and a reject flow never makes a path', () => {
  // arrange
  const doc = base();
  // act
  const r = threatPaths(doc, { applied: ['K1', 'K2'] });
  // assert
  assert.equal(r.byFlow[3], null);
  assert.equal(r.paths.some((p) => p.nodes.includes('rej')), false);
});

test('a cycle does not lengthen a path and maxPaths reports the cut', () => {
  // arrange
  const doc = base();
  doc.flows.push({ from: 'fw', to: 'p', mode: 'sync' }, { from: 'p', to: 'fw', mode: 'sync' });
  // act
  const all = threatPaths(doc, { applied: [] });
  const cut = threatPaths(doc, { applied: [], maxPaths: 2 });
  // assert
  assert.equal(all.paths.every((p) => new Set(p.nodes).size === p.nodes.length), true);
  assert.equal(all.truncated, false);
  assert.equal(cut.paths.length, 2);
  assert.equal(cut.truncated, true);
});

test('a model with no patches and no impacts has no paths: the overlay is absent, not empty', () => {
  // arrange
  const doc = base({ patches: undefined });
  delete doc.patches;
  for (const n of doc.nodes) delete n.impact;
  // act
  const r = threatPaths(doc);
  // assert
  assert.equal(validateDfd(doc).ok, true);
  assert.deepEqual(r.paths, []);
  assert.deepEqual(r.byFlow, [null, null, null, null, null, null]);
});

// ── pathStates: the same verdicts without listing paths ─────────────────────────────────────────

import { pathStates, timeline, frameStates, groupPath } from '../dfd.mjs';

const impactOf = (r, id) => r.impacts.find((x) => x.node === id);

test('pathStates agrees with threatPaths on every flow, for every combination of patches', () => {
  // arrange
  const doc = base();
  doc.flows[4].gate = { state: 'unevaluated' };
  doc.flows.push({ from: 'fw', to: 'p', mode: 'sync' });
  const combos = [[], ['K1'], ['K2'], ['K1', 'K2']];
  // act
  const pairs = combos.map((applied) => [threatPaths(doc, { applied }).byFlow, pathStates(doc, { applied }).byFlow]);
  // assert
  for (const [listed, searched] of pairs) assert.deepEqual(searched, listed);
});

test('an impact row carries the worst route into it and a witness in that state', () => {
  // arrange
  const doc = base();
  // act
  const r = pathStates(doc, { applied: ['K1', 'K2'] });
  // assert
  assert.deepEqual(impactOf(r, 'os'), { node: 'os', impact: 'critical', state: 'open', proven: false, witness: { nodes: ['a', 'fw', 'os'], flows: [4, 5] } });
  assert.equal(impactOf(r, 'mem').state, 'closed');
  assert.deepEqual(r.sources, ['a']);
});

test('a closed impact is proven only when no unproven cut is what closes it', () => {
  // arrange: K1 tested closes p>mem alone; K2 asserted closes p>abort
  const doc = base();
  doc.patches[1].closes = [{ from: 'p', to: 'abort' }];
  // act
  const r = pathStates(doc, { applied: ['K1', 'K2'] });
  // assert
  assert.deepEqual([impactOf(r, 'mem').state, impactOf(r, 'mem').proven], ['closed', true]);
  assert.deepEqual([impactOf(r, 'abort').state, impactOf(r, 'abort').proven], ['closed', false]);
});

test('an impact no source reaches has no row', () => {
  // arrange
  const doc = base();
  doc.flows = doc.flows.filter((f) => f.to !== 'os');
  doc.patches = [];
  // act
  const r = pathStates(doc);
  // assert
  assert.equal(impactOf(r, 'os'), undefined);
});

// ── timeline ─────────────────────────────────────────────────────────────────────────────────────

const ORDER = ['aaaaaaa1', 'bbbbbbb2', 'ccccccc3', 'ddddddd4'];

test('a patch is in force from the last of its commits, and frame 0 has none', () => {
  // arrange
  const doc = base();
  doc.patches[0].commits = ['aaaaaaa1', 'ccccccc3'];
  doc.patches[1].commits = ['bbbbbbb'];
  // act
  const t = timeline(doc, ORDER);
  // assert
  assert.deepEqual(t.frames.map((f) => [f.commit, f.applied]), [[null, []], ['bbbbbbb2', ['K2']], ['ccccccc3', ['K1', 'K2']]]);
  assert.deepEqual(t.frames[2].landed, { patches: ['K1'], verdicts: [] });
  assert.deepEqual(t.unplaced, { patches: [], verdicts: [] });
});

test('a patch whose commit the order does not hold is unplaced and in no frame', () => {
  // arrange
  const doc = base();
  doc.patches[0].commits = ['eeeeeee5'];
  doc.patches[1].commits = ['aaaaaaa1'];
  // act
  const t = timeline(doc, ORDER);
  // assert
  assert.deepEqual(t.unplaced.patches, ['K1']);
  assert.equal(t.frames.some((f) => f.applied.includes('K1')), false);
});

test('an undated patch is in force in every frame, and one marked applied:false in none', () => {
  // arrange
  const doc = base();
  doc.patches[1].applied = false;
  // act
  const t = timeline(doc, ORDER);
  // assert
  assert.deepEqual(t.frames.map((f) => f.applied), [['K1']]);
});

test('a dated verdict is unevaluated before its commit and counts from it', () => {
  // arrange
  const doc = base();
  doc.patches = [];
  doc.flows[5].gate = { state: 'safe', commit: 'ccccccc3', evidence: { level: 'runtime' } };
  // act
  const t = timeline(doc, ORDER);
  const before = frameStates(doc, t.frames[0]);
  const after = frameStates(doc, t.frames[1]);
  // assert
  assert.deepEqual(t.frames.map((f) => f.known), [[], [5]]);
  assert.equal(impactOf(before, 'os').state, 'unevaluated');
  assert.deepEqual([impactOf(after, 'os').state, impactOf(after, 'os').proven], ['closed', true]);
});

test('a verdict dated to a commit the order does not hold is unplaced', () => {
  // arrange
  const doc = base();
  doc.flows[5].gate = { state: 'safe', commit: 'fffffff6' };
  // act
  const t = timeline(doc, ORDER);
  // assert
  assert.deepEqual(t.unplaced.verdicts, [5]);
});

test('commits and a dated gate validate against the schema', () => {
  // arrange
  const doc = base();
  doc.patches[0].commits = ['aaaaaaa1'];
  doc.flows[5].gate = { state: 'safe', commit: 'ccccccc3' };
  // act
  const r = validateDfd(doc);
  // assert
  assert.deepEqual(r.errors, []);
});

test('a patch with no guard validates, and a rescanned cut is not proven', () => {
  // arrange: a rescan knows what closed, not where the check sits
  const doc = base();
  doc.patches = [{ id: 'commit:aaaaaaa', commits: ['aaaaaaa1'], closes: [{ from: 'p', to: 'mem' }], evidence: { level: 'rescanned' } }];
  // act
  const valid = validateDfd(doc);
  const step = stepStates(doc)[1];
  // assert
  assert.deepEqual(valid.errors, []);
  assert.deepEqual([step.state, step.proven], ['fixed', false]);
});

// ── nested groups ────────────────────────────────────────────────────────────────────────────────

const grouped = (groups) => ({ ...base(), groups, nodes: base().nodes.map((n) => (n.id === 'p' ? { ...n, group: groups[groups.length - 1].id } : n)) });

test('a group may sit inside another, and groupPath lists its ancestors outermost first', () => {
  // arrange
  const doc = grouped([{ id: 'tool', boundary: 'system' }, { id: 'parser', boundary: 'system', parent: 'tool' }, { id: 'blob', boundary: 'system', parent: 'parser' }]);
  // act
  const valid = validateDfd(doc);
  const path = groupPath(doc, 'blob');
  // assert
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(path, ['tool', 'parser', 'blob']);
  assert.deepEqual(groupPath(doc, 'tool'), ['tool']);
  assert.deepEqual(groupPath(doc, 'absent'), []);
});

test('a group whose parent is not declared is rejected', () => {
  // arrange
  const doc = grouped([{ id: 'parser', boundary: 'system', parent: 'tool' }]);
  // act
  const r = validateDfd(doc);
  // assert
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /group "parser" names parent "tool", which "groups" does not declare/);
});

test('a group that is its own ancestor is rejected', () => {
  // arrange
  const doc = grouped([{ id: 'a', boundary: 'system', parent: 'b' }, { id: 'b', boundary: 'system', parent: 'a' }]);
  // act
  const r = validateDfd(doc);
  // assert
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /is its own ancestor through "parent"/);
});
