// dfd@1: validation, the analysis and the filter (lib/dfd.mjs); the adapters are tested in
// flow/test/dfd-adapter.test.mjs. The analysis is the
// part a reader trusts without re-deriving, so each topology is asserted on a model small enough to
// check by hand, and once more on the fixture that carries all of them together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateDfd, analyse, filterModel, stronglyConnected, backArcs, longestPathRanks,
  isBroker, isDirected, roleOf, schemaPath, NODE_KINDS, MODES, FLOW_CLASSES,
  STORE_SUBTYPES, EXTERNAL_SUBTYPES, BROKER_SUBTYPES, ROLES, FLOW_DIRECTIONS, FILTER_DIRECTIONS,
} from '../dfd.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = () => JSON.parse(readFileSync(join(HERE, 'fixtures', 'dfd-synthetic.json'), 'utf8'));

/** 'a>b' sync, 'a~>b' async, 'a--b' undirected; node kind from the id's first letter (p, s, e). */
function model(flowSpecs, nodeExtra = {}) {
  const kinds = { p: 'process', s: 'store', e: 'external' };
  const ids = [];
  const flows = flowSpecs.map((spec) => {
    const m = /^(\w+)(~>|>|--)(\w+)$/.exec(spec);
    for (const id of [m[1], m[3]]) if (!ids.includes(id)) ids.push(id);
    return { from: m[1], to: m[3], mode: m[2] === '~>' ? 'async' : 'sync', ...(m[2] === '--' ? { directed: false } : {}) };
  });
  return { v: 1, kind: 'dfd', nodes: ids.map((id) => ({ id, kind: kinds[id[0]], label: id, ...(nodeExtra[id] || {}) })), flows };
}

// ── validation ───────────────────────────────────────────────────────────────────────────────────

test('the synthetic fixture is a valid dfd@1 document', () => {
  // arrange
  const doc = fixture();

  // act
  const r = validateDfd(doc);

  // assert
  assert.deepEqual(r, { ok: true, errors: [] });
});

test('the vocabulary is three element kinds, three modes and five flow classes', () => {
  // arrange
  const schema = JSON.parse(readFileSync(schemaPath(), 'utf8'));

  // act
  const kinds = schema.properties.nodes.items.properties.kind.enum;
  const modes = schema.properties.flows.items.properties.mode.enum;

  // assert
  assert.deepEqual(kinds, [...NODE_KINDS]);
  assert.deepEqual(modes, [...MODES]);
  assert.equal(FLOW_CLASSES.length, 5);
});

test('a document whose first field is not v is refused', () => {
  // arrange
  const { v, ...rest } = fixture();
  const doc = { ...rest, v };

  // act
  const r = validateDfd(doc);

  // assert
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /"v" must be the first field/);
});

test('a schema failure is reported alone, before any referential check runs', () => {
  // arrange
  const doc = fixture();
  doc.nodes[0].kind = 'broker';
  doc.flows[0].to = 'nowhere';

  // act
  const r = validateDfd(doc);

  // assert
  assert.equal(r.ok, false);
  assert.ok(r.errors.every((e) => e.startsWith('schema:')), r.errors.join('\n'));
});

test('a schema that cannot be opened validates nothing', () => {
  // arrange
  const doc = fixture();

  // act
  const r = validateDfd(doc, { path: join(HERE, 'fixtures', 'no-such.schema.json') });

  // assert
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /could not be read or parsed/);
});

test('duplicate ids, dangling flow ends and undeclared layers and groups are each named', () => {
  // arrange
  const doc = fixture();
  doc.nodes.push({ id: 'api', kind: 'process', label: 'again', layer: 'platinum', group: 'elsewhere' });
  doc.flows.push({ from: 'ghost', to: 'api', mode: 'sync' });
  doc.groups.push({ id: 'internet', boundary: 'trust' });

  // act
  const { ok, errors } = validateDfd(doc);

  // assert
  assert.equal(ok, false);
  assert.equal(errors.length, 5);
  assert.match(errors.join('\n'), /node id "api" is declared more than once/);
  assert.match(errors.join('\n'), /a group id is declared more than once/);
  assert.match(errors.join('\n'), /names layer "platinum"/);
  assert.match(errors.join('\n'), /names group "elsewhere"/);
  assert.match(errors.join('\n'), /flows\[26\]\.from names "ghost"/);
});

test('without declared layers or groups any layer and group string is accepted', () => {
  // arrange
  const doc = model(['p1>s1'], { p1: { layer: 'raw', group: 'anything' } });

  // act
  const r = validateDfd(doc);

  // assert
  assert.deepEqual(r.errors, []);
});

test('a broker is a store with a broker subtype, and a flow is directed unless it says otherwise', () => {
  // arrange
  const topic = { id: 't', kind: 'store', label: 't', subtype: 'topic' };
  const table = { id: 'd', kind: 'store', label: 'd', subtype: 'database' };
  const log = { id: 'l', kind: 'store', label: 'l', subtype: 'log' };
  const proc = { id: 'p', kind: 'process', label: 'p', subtype: 'queue' };

  // act
  const brokers = [topic, table, log, proc, undefined].map(isBroker);
  const directed = [{ from: 'a', to: 'b' }, { from: 'a', to: 'b', directed: true }, { from: 'a', to: 'b', directed: false }].map(isDirected);

  // assert
  assert.deepEqual(brokers, [true, false, true, false, false]);
  assert.deepEqual(directed, [true, true, false]);
});

test('the schema admits exactly the subtypes, roles, verdicts and directions the code names', () => {
  // arrange
  const schema = JSON.parse(readFileSync(schemaPath(), 'utf8'));
  const flow = schema.properties.flows.items.properties;

  // act
  const subtypes = schema.properties.nodes.items.properties.subtype.enum;

  // assert
  assert.deepEqual(subtypes, [...STORE_SUBTYPES, ...EXTERNAL_SUBTYPES]);
  assert.deepEqual(flow.role.enum, [...ROLES]);
  assert.deepEqual(flow.existence.enum, ['confirmed', 'unknown']);
  assert.deepEqual(flow.direction.enum, [...FLOW_DIRECTIONS]);
  assert.deepEqual(FILTER_DIRECTIONS, ['in', 'out', 'both']);
  assert.ok(BROKER_SUBTYPES.every((t) => STORE_SUBTYPES.includes(t)));
  assert.equal(schema.properties.v.const, 1);
});

test('a document written before the additions is still valid: every new field is optional', () => {
  // arrange
  const doc = { v: 1, kind: 'dfd', nodes: [{ id: 'a', kind: 'process', label: 'a' }, { id: 'b', kind: 'store', label: 'b' }], flows: [{ from: 'a', to: 'b', mode: 'sync', directed: true }] };

  // act
  const r = validateDfd(doc);

  // assert
  assert.deepEqual(r, { ok: true, errors: [] });
});

test('a subtype must belong to its kind, a process takes none, and an unlisted one fails the schema', () => {
  // arrange
  const doc = (subtype, kind) => ({ v: 1, kind: 'dfd', nodes: [{ id: 'x', kind, label: 'x', subtype }], flows: [] });

  // act
  const storeAsEndpoint = validateDfd(doc('endpoint', 'store')).errors;
  const externalAsLog = validateDfd(doc('log', 'external')).errors;
  const processSubtype = validateDfd(doc('queue', 'process')).errors;
  const unlisted = validateDfd(doc('lake', 'store')).errors;
  const fine = [validateDfd(doc('scheduler', 'external')), validateDfd(doc('database', 'store'))].map((r) => r.ok);

  // assert
  assert.match(storeAsEndpoint.join(), /node "x" is a store and carries subtype "endpoint".*store takes broker\|queue\|topic\|stream\|log\|database\|file/);
  assert.match(externalAsLog.join(), /node "x" is a external and carries subtype "log"/);
  assert.match(processSubtype.join(), /node "x" is a process and carries subtype "queue": only a store or an external has one/);
  assert.equal(unlisted.length, 1);
  assert.doesNotMatch(unlisted[0], /^dfd:/);
  assert.deepEqual(fine, [true, true]);
});

test('a resolved direction on a flow that still says directed:false is refused', () => {
  // arrange
  const doc = { v: 1, kind: 'dfd', nodes: [{ id: 'a', kind: 'process', label: 'a' }, { id: 'b', kind: 'store', label: 'b' }],
    flows: [{ from: 'a', to: 'b', mode: 'sync', directed: false, direction: 'writes' }, { from: 'a', to: 'b', mode: 'sync', direction: 'writes', role: 'data', existence: 'confirmed' }] };

  // act
  const r = validateDfd(doc);

  // assert
  assert.deepEqual(r.errors, ['dfd: flows[0] carries direction "writes" and directed:false — a resolved touch is directed']);
});

test('a role outside the four, or a verdict of contradicted, fails the schema', () => {
  // arrange
  const doc = (extra) => ({ v: 1, kind: 'dfd', nodes: [{ id: 'a', kind: 'process', label: 'a' }], flows: [{ from: 'a', to: 'a', mode: 'sync', ...extra }] });

  // act
  const results = [{ role: 'control' }, { existence: 'contradicted' }, { direction: 'sideways' }].map((x) => validateDfd(doc(x)).ok);

  // assert
  assert.deepEqual(results, [false, false, false]);
});

// ── graph primitives ─────────────────────────────────────────────────────────────────────────────

test('stronglyConnected numbers components by their first member', () => {
  // arrange: 0 -> 1 -> 2 -> 1, 3 alone
  const out = [[[1, 0]], [[2, 1]], [[1, 2]], []];

  // act
  const { comp, count } = stronglyConnected(out);

  // assert
  assert.equal(count, 3);
  assert.deepEqual(comp, [0, 1, 1, 2]);
});

test('backArcs walks a component from the node the outside flows into', () => {
  // arrange: 2 -> 1 -> 2 is a cycle; node 0 enters it at 2, so 1 -> 2 is the arc that returns
  const out = [[[2, 0]], [[2, 1]], [[1, 2]]];
  const { comp, count } = stronglyConnected(out);

  // act
  const back = backArcs(out, comp, count);

  // assert
  assert.deepEqual([...back], [1]);
});

test('backArcs starts at the first member when nothing outside enters the component', () => {
  // arrange: 0 -> 1 -> 2 -> 0 with a chord 1 -> 0
  const out = [[[1, 0]], [[2, 1], [0, 3]], [[0, 2]]];
  const { comp, count } = stronglyConnected(out);

  // act
  const back = backArcs(out, comp, count);

  // assert
  assert.deepEqual([...back].sort(), [2, 3]);
});

test('longestPathRanks puts a node one past its deepest predecessor', () => {
  // arrange: a diamond with a long side
  const arcs = [[0, 1], [0, 2], [2, 3], [1, 4], [3, 4]];

  // act
  const { rank, order } = longestPathRanks(5, arcs);

  // assert
  assert.deepEqual(rank, [0, 1, 1, 2, 3]);
  assert.equal(order.length, 5);
});

test('longestPathRanks refuses a cyclic arc list', () => {
  // arrange
  const arcs = [[0, 1], [1, 0]];

  // act
  const run = () => longestPathRanks(2, arcs);

  // assert
  assert.throws(run, /cyclic arc list/);
});

// ── analysis ─────────────────────────────────────────────────────────────────────────────────────

test('a pair of opposite flows is bidirectional, not feedback', () => {
  // arrange
  const m = model(['e1>p1', 'p1>e1', 'p1>s1']);

  // act
  const a = analyse(m);

  // assert
  assert.deepEqual(a.flowClass, ['bidirectional', 'bidirectional', 'forward']);
  assert.deepEqual(a.bidirectional, [{ a: 'e1', b: 'p1', flows: [0, 1], modes: ['sync'] }]);
  assert.deepEqual(a.feedback, []);
  assert.deepEqual(a.cycles, [{ members: ['e1', 'p1'], feedback: [], bidirectionalOnly: true, uncertain: false }]);
});

test('parallel flows in both directions all join one bidirectional pair and report both modes', () => {
  // arrange
  const m = model(['p1>p2', 'p1~>p2', 'p2>p1']);

  // act
  const a = analyse(m);

  // assert
  assert.deepEqual(a.bidirectional, [{ a: 'p1', b: 'p2', flows: [0, 1, 2], modes: ['sync', 'async'] }]);
});

test('a flow from a downstream process back to an upstream one is the feedback flow', () => {
  // arrange
  const m = model(['e1>p1', 'p1>p2', 'p2>p3', 'p3>p1', 'p3>s1']);

  // act
  const a = analyse(m);

  // assert
  assert.deepEqual(a.feedback, [{ flow: 3, from: 'p3', to: 'p1', role: 'data' }]);
  assert.deepEqual(a.cycles, [{ members: ['p1', 'p2', 'p3'], feedback: [3], bidirectionalOnly: false, uncertain: false }]);
  assert.deepEqual(a.nodes.map((n) => n.rank), [0, 1, 2, 3, 4]);
  assert.deepEqual(a.nodes.map((n) => n.sccRank), [0, 1, 1, 1, 2]);
  assert.deepEqual(a.nodes.map((n) => n.cyclic), [false, true, true, true, false]);
});

test('a cycle through an element marked unknown is reported as uncertain', () => {
  // arrange
  const m = model(['p1>s1', 's1>p2', 'p2>p1'], { s1: { unknown: true } });

  // act
  const a = analyse(m);

  // assert
  assert.equal(a.cycles.length, 1);
  assert.equal(a.cycles[0].uncertain, true);
});

test('a retry on one process is a self-loop and adds nothing to its fan-in or fan-out', () => {
  // arrange
  const m = model(['p1>p1', 'p1>s1']);

  // act
  const a = analyse(m);

  // assert
  assert.deepEqual(a.selfLoops, [{ node: 'p1', flow: 0 }]);
  assert.deepEqual(a.nodes[0], { id: 'p1', rank: 0, sccRank: 0, cyclic: false, fanOut: 1, fanIn: 0 });
  assert.deepEqual(a.cycles, []);
});

test('an undirected flow takes no part in ranks, cycles, paths or fan counts', () => {
  // arrange: the only thing closing the loop is a flow whose direction nobody determined
  const m = model(['p1>s1', 's1--p1', 'p1--s2']);

  // act
  const a = analyse(m);

  // assert
  assert.deepEqual(a.flowClass, ['forward', 'undirected', 'undirected']);
  assert.deepEqual(a.undirected, [1, 2]);
  assert.deepEqual(a.cycles, []);
  assert.equal(a.paths.total, 1);
  assert.equal(a.nodes[2].fanIn, 0);
});

test('branch and merge points are counted over distinct neighbours', () => {
  // arrange: p1 fans out to two stores twice over, both merge into p2
  const m = model(['p1>s1', 'p1>s1', 'p1>s2', 's1>p2', 's2>p2']);

  // act
  const a = analyse(m);

  // assert
  assert.deepEqual(a.branches, [{ node: 'p1', to: ['s1', 's2'] }]);
  assert.deepEqual(a.merges, [{ node: 'p2', from: ['s1', 's2'] }]);
  assert.deepEqual(a.sources, ['p1']);
  assert.deepEqual(a.sinks, ['p2']);
  assert.deepEqual(a.paths, { total: 2, listed: [['p1', 's1', 'p2'], ['p1', 's2', 'p2']], truncated: false, multiHop: 2 });
});

test('a flow is an async hop by its mode, by a broker at either end, or by both', () => {
  // arrange
  const m = model(['p1~>s1', 's1>p2', 'p2~>s2', 'p2>p3'], { s1: { subtype: 'queue' }, s2: { subtype: 'database' } });

  // act
  const a = analyse(m);

  // assert
  assert.deepEqual(a.asyncHops, [
    { flow: 0, from: 'p1', to: 's1', reason: 'mode+broker' },
    { flow: 1, from: 's1', to: 'p2', reason: 'broker' },
    { flow: 2, from: 'p2', to: 's2', reason: 'mode' },
  ]);
  assert.deepEqual(a.brokered, [{ from: 'p1', via: 's1', to: 'p2' }]);
});

test('paths are listed up to the cap and the cut is declared', () => {
  // arrange
  const m = model(['p1>s1', 'p1>s2', 'p1>s3']);

  // act
  const a = analyse(m, { maxPaths: 2 });

  // assert
  assert.equal(a.paths.total, 3);
  assert.equal(a.paths.listed.length, 2);
  assert.equal(a.paths.truncated, true);
  assert.equal(a.paths.multiHop, 0);
});

test('a path count past the safe integers is null, never a rounded number', () => {
  // arrange: sixty diamonds in a row is 2^60 source-to-sink paths
  const specs = [];
  for (let i = 0; i < 60; i++) specs.push(`p${i}>s${i}a`, `p${i}>s${i}b`, `s${i}a>p${i + 1}`, `s${i}b>p${i + 1}`);
  const m = model(specs);

  // act
  const a = analyse(m, { maxPaths: 3 });

  // assert
  assert.equal(a.paths.total, null);
  assert.equal(a.paths.truncated, true);
  assert.equal(a.paths.listed.length, 3);
  assert.equal(a.paths.listed[0].length, 121);
});

test('an error flow back along an adjacent pair is feedback, not a two-way pair', () => {
  // arrange
  const m = model(['p1>p2', 'p2>p1', 'p2>s1']);
  m.flows[1].role = 'error';

  // act
  const a = analyse(m);

  // assert
  assert.deepEqual(a.flowClass, ['forward', 'feedback', 'forward']);
  assert.deepEqual(a.bidirectional, []);
  assert.deepEqual(a.feedback, [{ flow: 1, from: 'p2', to: 'p1', role: 'error' }]);
  assert.deepEqual(a.cycles, [{ members: ['p1', 'p2'], feedback: [1], bidirectionalOnly: false, uncertain: false }]);
  assert.deepEqual(a.nodes.map((n) => n.rank), [0, 1, 2]);
  assert.deepEqual(a.paths.listed, [['p1', 'p2', 's1']]);
});

test('only data flows collapse: a data pair stays two-way beside a retry along the same pair', () => {
  // arrange
  const m = model(['p1>p2', 'p2>p1', 'p2>p1']);
  m.flows[0].role = 'data';
  m.flows[2].role = 'retry';

  // act
  const a = analyse(m);

  // assert
  assert.deepEqual(a.flowClass, ['bidirectional', 'bidirectional', 'feedback']);
  assert.deepEqual(a.bidirectional, [{ a: 'p1', b: 'p2', flows: [0, 1], modes: ['sync'] }]);
  assert.deepEqual(a.feedback.map((f) => [f.flow, f.role]), [[2, 'retry']]);
  assert.equal(a.cycles[0].bidirectionalOnly, false);
});

test('a declared feedback flow is a return path even with no cycle among the data flows', () => {
  // arrange
  const m = model(['e1>p1', 'p1>s1', 's1>p1', 'p1>s2']);
  m.flows[2].role = 'feedback';

  // act
  const a = analyse(m);

  // assert
  assert.deepEqual(a.flowClass, ['forward', 'forward', 'feedback', 'forward']);
  assert.deepEqual(a.nodes.map((n) => [n.id, n.rank]), [['e1', 0], ['p1', 1], ['s1', 2], ['s2', 2]]);
  assert.deepEqual(a.sources, ['e1']);
  assert.equal(a.paths.total, 2);
});

test('a retry on one process stays a self-loop whatever its role, and roleOf defaults to data', () => {
  // arrange
  const m = model(['p1>p1', 'p1>s1']);
  m.flows[0].role = 'retry';

  // act
  const a = analyse(m);

  // assert
  assert.deepEqual(a.flowClass, ['self-loop', 'forward']);
  assert.deepEqual([roleOf({}), roleOf({ role: 'error' })], ['data', 'error']);
});

test('the fixture carries every topology at once', () => {
  // arrange
  const m = fixture();
  const at = (from, to) => m.flows.findIndex((f) => f.from === from && f.to === to);

  // act
  const a = analyse(m);

  // assert
  assert.deepEqual(a.bidirectional.map((b) => [b.a, b.b]), [['customer', 'api']]);
  assert.deepEqual(a.selfLoops, [{ node: 'ingest', flow: at('ingest', 'ingest') }]);
  assert.deepEqual(a.feedback.map((f) => `${f.from}>${f.to} ${f.role}`), ['validate>transform error', 'validate>bronze retry']);
  assert.deepEqual(a.cycles.map((c) => c.members), [['customer', 'api'], ['bronze', 'transform', 'enrich', 'validate']]);
  assert.deepEqual(a.branches.map((b) => b.node), ['api', 'validate', 'silver']);
  assert.deepEqual(a.merges.map((b) => b.node), ['api', 'bronze', 'transform', 'aggregate', 'gold']);
  assert.deepEqual(a.brokered, [{ from: 'api', via: 'events', to: 'ingest' }, { from: 'api', via: 'audit', to: 'alerting' }]);
  assert.deepEqual(a.asyncHops.map((h) => `${h.from}>${h.to} ${h.reason}`), [
    'api>events mode+broker', 'events>ingest mode+broker', 'validate>bronze mode', 'nightly>aggregate mode', 'api>audit mode+broker', 'audit>alerting mode+broker',
  ]);
  assert.equal(a.paths.total, 8);
  assert.equal(Math.max(...a.paths.listed.map((p) => p.length)), 13);
  assert.equal(a.flowClass.filter((c) => c === 'forward').length, 21);
  assert.deepEqual([...new Set(m.nodes.map((n) => n.subtype).filter(Boolean))].sort(), ['actor', 'database', 'endpoint', 'env', 'file', 'log', 'scheduler', 'system', 'topic']);
  assert.deepEqual([...new Set(m.flows.map((f) => f.role).filter(Boolean))].sort(), ['data', 'error', 'retry']);
});

// ── filter ───────────────────────────────────────────────────────────────────────────────────────

test('filterModel with no filter returns the model itself', () => {
  // arrange
  const m = fixture();

  // act
  const out = filterModel(m);

  // assert
  assert.equal(out, m);
});

test('filterModel keeps a focus node and its neighbours, in either direction, and counts the cut', () => {
  // arrange
  const m = fixture();

  // act
  const out = filterModel(m, { focus: 'Ingest' });

  // assert
  assert.deepEqual(out.nodes.map((n) => n.id), ['events', 'ingest', 'bronze']);
  assert.equal(out.flows.length, 3);
  assert.deepEqual(out.source.filter, { prefix: null, focus: 'Ingest', hops: 1, direction: 'both', seeds: 1, nodesKept: 3, nodesOmitted: 19, flowsOmitted: 23 });
  assert.deepEqual(Object.keys(out).slice(0, 4), ['v', 'kind', 'title', 'source']);
  assert.deepEqual(validateDfd(out).errors, []);
});

test('filterModel seeds from a prefix and widens by hops', () => {
  // arrange
  const m = model(['p1>s1', 's1>p2', 'p2>s2', 's2>p3']);

  // act
  const none = filterModel(m, { prefix: 'p1', hops: 0 });
  const two = filterModel(m, { prefix: 'p1', hops: 2 });
  const byFocusId = filterModel(m, { focus: 's2', hops: 1 });

  // assert
  assert.deepEqual(none.nodes.map((n) => n.id), ['p1']);
  assert.deepEqual(two.nodes.map((n) => n.id), ['p1', 's1', 'p2']);
  assert.deepEqual(byFocusId.nodes.map((n) => n.id), ['p2', 's2', 'p3']);
  assert.equal(two.source.producer, 'authored');
  assert.equal('title' in two, false);
});

test('filterModel returns null when nothing matches, never an empty diagram', () => {
  // arrange
  const m = fixture();

  // act
  const out = filterModel(m, { prefix: 'no/such/', focus: 'nobody' });

  // assert
  assert.equal(out, null);
});

test('filterModel walks forward with out, backward with in, and both ways by default', () => {
  // arrange
  const m = model(['p1>s1', 's1>p2', 'p2>s2', 'e1>p2']);

  // act
  const out = filterModel(m, { around: 'p2', hops: 2, direction: 'out' });
  const back = filterModel(m, { around: 'p2', hops: 2, direction: 'in' });
  const both = filterModel(m, { around: 'p2', hops: 1 });

  // assert
  assert.deepEqual(out.nodes.map((n) => n.id), ['p2', 's2']);
  assert.deepEqual(back.nodes.map((n) => n.id), ['p1', 's1', 'p2', 'e1']);
  assert.deepEqual(both.nodes.map((n) => n.id), ['s1', 'p2', 's2', 'e1']);
  assert.deepEqual([out.source.filter.direction, back.source.filter.direction, both.source.filter.direction], ['out', 'in', 'both']);
  assert.equal(out.source.filter.focus, 'p2');
});

test('a directional walk still crosses an undirected flow, whose direction nobody determined', () => {
  // arrange
  const m = model(['p1>s1', 'p2--s1']);

  // act
  const out = filterModel(m, { around: 's1', hops: 1, direction: 'out' });

  // assert
  assert.deepEqual(out.nodes.map((n) => n.id), ['s1', 'p2']);
});

test('filterModel refuses a direction it does not know', () => {
  // arrange
  const m = model(['p1>s1']);

  // act
  const call = () => filterModel(m, { around: 'p1', direction: 'sideways' });

  // assert
  assert.throws(call, /direction must be one of in, out, both, got "sideways"/);
});
