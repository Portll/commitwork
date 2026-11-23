// lib/dfd-record-core.mjs: lanes, hop columns, routing faults, change sets, the replay account and selection focus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecordCore } from '../dfd-record-core.mjs';
import { validateDfd } from '../dfd.mjs';
import { RECORD, RECORD_UNDECLARED, SINKS } from './fixtures/dfd-record-model.mjs';

const ids = (list) => list.map((x) => x.id);
const walk = (core, order, active = null) => Array.from({ length: core.step(order, active, 1e9).total + 1 }, (_, k) => core.step(order, active, k));

test('the record fixtures are valid dfd@1 documents', () => {
  // Arrange
  const docs = [RECORD(), RECORD_UNDECLARED(), SINKS()];
  // Act
  const results = docs.map((d) => validateDfd(d));
  // Assert
  assert.deepEqual(results.map((r) => r.ok), [true, true, true]);
});

test('every fixture routes with no broken coordinate, no flow through a chip and no overlapping run, in both lane modes', () => {
  // Arrange
  const cores = [RECORD(), RECORD_UNDECLARED(), SINKS()].map(createRecordCore);
  // Act
  const audits = cores.flatMap((c) => ['group', 'layer'].map((m) => c.audit(m)));
  // Assert
  for (const a of audits) assert.deepEqual(a, { nan: 0, through: 0, overlap: 0, hits: [] });
});

test('columns count hops from the sources; nodes no source reaches would take a column of their own', () => {
  // Arrange
  const core = createRecordCore(RECORD());
  // Act
  const L = core.layout('group');
  // Assert
  assert.deepEqual([...core.sources], ['S1', 'S2']);
  assert.deepEqual([core.hop.get('P1'), core.hop.get('P2'), core.hop.get('P4'), core.hop.get('C1')], [1, 2, 3, 5]);
  assert.equal(core.nCols, 7);
  assert.deepEqual(L.cols.map((c) => c.text), ['Sources', 'Hop 1', 'Hop 2', 'Hop 3', 'Hop 4', 'Hop 5', 'Not reached']);
  assert.equal(L.units.find((u) => u.id === 'L1').col, 6);
});

test('group lanes follow the top-level group, layer lanes follow the declared layer order, the harness lane comes last', () => {
  // Arrange
  const core = createRecordCore(RECORD());
  // Act
  const lanes = ['group', 'layer'].map((m) => core.layout(m).lanes.map((l) => [l.key, l.name]));
  // Assert
  assert.deepEqual(lanes[0], [['g:g_in', 'Manifest intake'], ['g:', 'Ungrouped'], ['g:g_led', 'Ledger writer'], ['g:g_carrier', 'Carrier platform'], ['harness', 'Harness']]);
  assert.deepEqual(lanes[1], [['l:edge', 'edge'], ['l:intake', 'intake'], ['l:ledger', 'ledger'], ['l:', 'No layer'], ['harness', 'Harness']]);
  assert.equal(core.layout('group').lanes[3].sub, 'trust boundary');
  assert.equal(core.layout('nonsense'), core.layout('group'));
});

test('a route on a node stacks under it; a route with no node is a chip in the harness lane; error and log flows feed one drain', () => {
  // Arrange
  const core = createRecordCore(RECORD());
  // Act
  const L = core.layout('group');
  const p3 = L.units.find((u) => u.id === 'P3');
  // Assert
  assert.deepEqual(L.tests.map((t) => [t.id, t.stacked, t.lane]), [['Q1', true, p3.lane], ['Q2', false, L.lanes.length - 1]]);
  assert.deepEqual(ids(p3.tests), ['Q1']);
  assert.ok(L.units.some((u) => u.type === 'route' && u.id === 'Q2'));
  assert.equal(L.drain.lk, 'harness');
  assert.deepEqual(L.edges.filter((e) => e.kind === 'drain').map((e) => e.id), ['d:G1']);
  assert.equal(L.edges.find((e) => e.flow && e.flow.role === 'error').kind, 'error');
  assert.equal(L.units.find((u) => u.id === 'G1').prim, 'log');
});

test('findings sit in the tray of the node they name, or of the receiving end of the flow they name', () => {
  // Arrange
  const core = createRecordCore(RECORD());
  // Act
  const trays = core.layout('group').units.filter((u) => u.tray.length).map((u) => [u.id, u.tray.map((r) => r.id)]);
  // Assert
  assert.deepEqual(trays, [['P1', ['H3']], ['P2', ['H1']], ['P3', ['H4', 'H7']], ['P4', ['H2']], ['P5', ['H5']], ['C1', ['H6']]]);
  assert.equal(core.stats().unplaced, 0);
});

test('declared pull requests are change sets; the remaining patches join by shared commit, then by shared evidence file', () => {
  // Arrange
  const declared = createRecordCore(RECORD());
  const undeclared = createRecordCore(RECORD_UNDECLARED());
  // Act
  const sets = [declared, undeclared].map((c) => c.sets.map((s) => [s.id, s.kind, ids(s.patches)]));
  // Assert
  assert.deepEqual(sets[0], [['pr-1', 'pull request', ['K1']], ['pr-2', 'pull request', ['K2']], ['commits a1b2c3d4e5f6, b2c3d4e5f6a7', 'change set', ['K3', 'K4']]]);
  assert.deepEqual(sets[1], [['commits 1111111aaaa, 2222222bbbb', 'change set', ['A', 'B']], ['intake/reader.js', 'change set', ['C', 'D']], ['patch E', 'change set', ['E']]]);
  assert.equal(undeclared.sets[1].title, 'reader.js');
});

test('replay orders: by change set, upstream guard first, load-bearing test first, document order', () => {
  // Arrange
  const core = createRecordCore(RECORD());
  // Act
  const orders = Object.fromEntries(Object.entries(core.orders).map(([k, v]) => [k, ids(v)]));
  // Assert
  assert.deepEqual(orders, { sets: ['K1', 'K2', 'K3', 'K4'], upstream: ['K3', 'K1', 'K2', 'K4'], tested: ['K1', 'K2', 'K3', 'K4'], document: ['K1', 'K2', 'K3', 'K4'] });
  assert.deepEqual(core.ORDERS.map(([k]) => k), Object.keys(core.orders));
});

test('stepping forward never reopens a finding or a flow, in any order, for any fixture', () => {
  // Arrange
  const cores = [RECORD(), RECORD_UNDECLARED(), SINKS()].map(createRecordCore);
  // Act
  const runs = cores.flatMap((c) => c.ORDERS.map(([o]) => walk(c, o)));
  // Assert
  for (const run of runs) {
    for (let k = 1; k < run.length; k++) {
      assert.ok(run[k].open <= run[k - 1].open, `open rose at step ${k}`);
      for (const f of run[k - 1].closed) assert.ok(run[k].closed.has(f), `${f} reopened at step ${k}`);
    }
    assert.equal(run.at(-1).exposed.size, 0);
  }
});

test('the account at each step: what landed, which flows closed, which outcomes are still reachable, and each finding state', () => {
  // Arrange
  const core = createRecordCore(RECORD());
  // Act
  const run = walk(core, 'sets');
  // Assert
  assert.deepEqual(run.map((s) => [s.k, s.patch, s.open, [...s.exposed].sort()]), [
    [0, null, 5, ['R1', 'X1', 'X2', 'X3']], [1, 'K1', 4, ['X2', 'X3']], [2, 'K2', 3, ['X3']], [3, 'K3', 2, ['X3']], [4, 'K4', 1, []],
  ]);
  assert.deepEqual([...run[1].closed], ['f12', 'f13']);
  assert.deepEqual(Object.fromEntries(run[4].state), { H1: 'proven', H2: 'fixed', H3: 'fixed', H4: 'dismissed', H5: 'dismissed', H6: 'open', H7: 'fixed' });
  assert.deepEqual(Object.fromEntries(run[0].state), { H1: 'open', H2: 'open', H3: 'open', H4: 'dismissed', H5: 'dismissed', H6: 'open', H7: 'open' });
  assert.equal(core.step('sets', null, -3).k, 0);
  assert.equal(core.step('sets', null, 99).k, 4);
});

test('a subset replays only the patches it holds, in the chosen order', () => {
  // Arrange
  const core = createRecordCore(RECORD());
  const active = new Set(['K2', 'K4']);
  // Act
  const run = walk(core, 'sets', active);
  // Assert
  assert.deepEqual(run.at(-1).order, ['K2', 'K4']);
  assert.equal(run.at(-1).total, 2);
  assert.deepEqual(Object.fromEntries(run.at(-1).state), { H1: 'open', H2: 'fixed', H3: 'open', H4: 'dismissed', H5: 'dismissed', H6: 'open', H7: 'fixed' });
});

test('with no declared impact and no reject, the outcomes are the non-process sinks, and the rule says so', () => {
  // Arrange
  const declared = createRecordCore(RECORD());
  const sinks = createRecordCore(SINKS());
  // Act
  const got = [declared, sinks].map((c) => [c.outcomeRule, [...c.outcomes]]);
  // Assert
  assert.deepEqual(got[0], ['declared', ['X1', 'X2', 'X3', 'R1']]);
  assert.deepEqual(got[1], ['sinks', ['D1', 'X1', 'X2', 'X3', 'R1', 'G1']]);
  assert.equal(sinks.stats().outcomeRule, 'sinks');
});

test('patches group by change set, weakness, guarded lane, evidence, severity or proof', () => {
  // Arrange
  const core = createRecordCore(RECORD());
  // Act
  const groups = Object.fromEntries(core.DIMS.map(([d]) => [d, core.groupsOf(d, 'group').map((g) => `${g.value}=${g.ids.join(',')}`)]));
  // Assert
  assert.deepEqual(groups.cwe, ['CWE-78=K1', 'CWE-89=K2', 'no CWE=K3,K4']);
  assert.deepEqual(groups.lane, ['Manifest intake=K1,K3', 'Ledger writer=K2', 'no guarded flow=K4']);
  assert.deepEqual(groups.evidence, ['test proof=K1', 'source inspection=K2', 'assertion, unverified=K3', 'clean rescan=K4']);
  assert.deepEqual(groups.severity, ['high=K1', 'medium=K2', 'low=K3', 'undetermined=K4']);
  assert.deepEqual(groups.proof, ['fails without, passes with=K1', 'no load-bearing test=K2,K3,K4']);
  assert.equal(groups.changeset.length, 3);
});

test('focus lights what a selection touches: a node and its flows, a finding and its flow, a patch and what it guards and closes', () => {
  // Arrange
  const core = createRecordCore(RECORD());
  const lit = (kind, id) => { const x = core.focus(kind, id); return [[...x.edges], [...x.units]]; };
  // Act
  const got = { node: lit('node', 'P2'), flow: lit('flow', 'f0'), finding: lit('finding', 'H6'), patch: lit('patch', 'K1'), stacked: lit('route', 'Q1'), harness: lit('route', 'Q2'), none: lit('node', 'nope') };
  // Assert
  assert.deepEqual(got.node, [['f2', 'f3', 'f4', 'f12', 'f13'], ['P2', 'P1', 'P3', 'P4', 'X1', 'R1']]);
  assert.deepEqual(got.flow, [['f0'], ['S1', 'P1']]);
  assert.deepEqual(got.finding, [['f9'], ['C1', 'P5']]);
  assert.deepEqual(got.patch, [['f2', 'f12', 'f13'], ['P1', 'P2', 'X1', 'R1']]);
  assert.deepEqual([got.stacked, got.harness, got.none], [[[], ['P3']], [[], []], [[], []]]);
});

test('detail reads a selection as rows and links, and states what the step changes', () => {
  // Arrange
  const core = createRecordCore(RECORD());
  const st = core.step('sets', null, 1);
  // Act
  const patch = core.detail('patch', 'K1', st);
  const route = core.detail('route', 'Q2');
  const finding = core.detail('finding', 'H1', st);
  // Assert
  assert.equal(patch.kicker, 'patch · test proof');
  assert.deepEqual(patch.rows.find((r) => r[0] === 'landed'), ['landed', 'yes, at this step']);
  assert.deepEqual(patch.rows.find((r) => r[0] === 'guard'), ['guard', 'Manifest reader → Field parser']);
  assert.deepEqual(route.rows, [['claim', 'A recorded manifest replays clean'], ['node', 'none (harness)'], ['harness', 'replay-fixture.sh']]);
  assert.deepEqual(finding.rows.find((r) => r[0] === 'state'), ['state', 'fixed, tested']);
  assert.equal(core.detail('patch', 'missing'), null);
});

test('tables carry one row per flow, finding, patch and route, classed by the step', () => {
  // Arrange
  const core = createRecordCore(RECORD());
  // Act
  const t = core.tables(core.step('sets', null, 1));
  // Assert
  assert.deepEqual(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.rows.length])), { flows: 18, findings: 7, patches: 4, routes: 2 });
  assert.deepEqual(t.flows.rows.filter((r) => r.cls === 'closed').map((r) => r.id), ['f12', 'f13']);
  assert.deepEqual(t.patches.rows.map((r) => r.cls), ['landed', '', '', '']);
  assert.deepEqual(t.routes.rows.map((r) => r.cells[3]), ['Unit converter', 'harness']);
});
