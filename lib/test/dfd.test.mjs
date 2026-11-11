// dfd@1: validation, the analysis and the flow-graph adapter (lib/dfd.mjs). The analysis is the
// part a reader trusts without re-deriving, so each topology is asserted on a model small enough to
// check by hand, and once more on the fixture that carries all of them together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateDfd, analyse, fromFlowGraph, filterModel, stronglyConnected, backArcs, longestPathRanks,
  isBroker, isDirected, schemaPath, NODE_KINDS, MODES, FLOW_CLASSES,
} from '../dfd.mjs';
import { makeNode, makeEdge, nodeId } from '../../flow/graph.mjs';

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
  assert.match(errors.join('\n'), /flows\[20\]\.from names "ghost"/);
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
  const table = { id: 'd', kind: 'store', label: 'd', subtype: 'relational' };
  const proc = { id: 'p', kind: 'process', label: 'p', subtype: 'queue' };

  // act
  const brokers = [topic, table, proc, undefined].map(isBroker);
  const directed = [{ from: 'a', to: 'b' }, { from: 'a', to: 'b', directed: true }, { from: 'a', to: 'b', directed: false }].map(isDirected);

  // assert
  assert.deepEqual(brokers, [true, false, false, false]);
  assert.deepEqual(directed, [true, true, false]);
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
  assert.deepEqual(a.feedback, [{ flow: 3, from: 'p3', to: 'p1' }]);
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
  const m = model(['p1~>s1', 's1>p2', 'p2~>s2', 'p2>p3'], { s1: { subtype: 'queue' }, s2: { subtype: 'log' } });

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

test('the fixture carries every topology at once', () => {
  // arrange
  const m = fixture();
  const at = (from, to) => m.flows.findIndex((f) => f.from === from && f.to === to);

  // act
  const a = analyse(m);

  // assert
  assert.deepEqual(a.bidirectional.map((b) => [b.a, b.b]), [['customer', 'api']]);
  assert.deepEqual(a.selfLoops, [{ node: 'ingest', flow: at('ingest', 'ingest') }]);
  assert.deepEqual(a.feedback.map((f) => `${f.from}>${f.to}`), ['validate>transform', 'validate>bronze']);
  assert.deepEqual(a.cycles.map((c) => c.members), [['customer', 'api'], ['bronze', 'transform', 'enrich', 'validate']]);
  assert.deepEqual(a.branches.map((b) => b.node), ['api', 'validate', 'silver']);
  assert.deepEqual(a.merges.map((b) => b.node), ['bronze', 'transform', 'gold']);
  assert.deepEqual(a.brokered, [{ from: 'api', via: 'events', to: 'ingest' }]);
  assert.deepEqual(a.asyncHops.map((h) => h.reason), ['mode+broker', 'mode+broker', 'mode']);
  assert.equal(a.paths.total, 4);
  assert.equal(Math.max(...a.paths.listed.map((p) => p.length)), 13);
  assert.equal(a.flowClass.filter((c) => c === 'forward').length, 15);
});

// ── the flow-graph adapter ───────────────────────────────────────────────────────────────────────

function flowGraph() {
  const mod = (p, extra) => makeNode('module', p, extra);
  const nodes = [
    mod('bin/tool.mjs', { analysis: 'analysed' }),
    mod('bin/helper.mjs', { analysis: 'analysed' }),
    mod('bin/broken.mjs', { analysis: 'unparseable' }),
    mod('bin/test/tool.test.mjs', { analysis: 'analysed' }),
    mod('alone.mjs', { analysis: 'analysed' }),
    makeNode('store', 'reports/out.json'),
    makeNode('artifact', 'rollup.json', { composed: true }),
    makeNode('env', 'CW_HOME'),
    makeNode('process', 'git'),
    makeNode('process', 'CREATE TABLE t (a TEXT)'),
    makeNode('process', 'COMMIT'),
    makeNode('process', 'bin/helper.mjs'),
  ];
  const m = (p) => nodeId('module', p);
  const edges = [
    makeEdge(m('bin/tool.mjs'), nodeId('store', 'reports/out.json'), 'writes', { evidence: ['bin/tool.mjs:9 writeFileSync'] }),
    makeEdge(m('bin/helper.mjs'), nodeId('store', 'reports/out.json'), 'reads', { witness: 'both', existence: 'confirmed', evidence: ['bin/helper.mjs:4 readFileSync'] }),
    makeEdge(m('bin/tool.mjs'), nodeId('artifact', 'rollup.json'), 'touches', { evidence: ['bin/tool.mjs:12 literal'] }),
    makeEdge(m('bin/tool.mjs'), nodeId('env', 'CW_HOME'), 'reads', { evidence: ['bin/tool.mjs:3 env'] }),
    makeEdge(m('bin/tool.mjs'), m('bin/helper.mjs'), 'reads', { evidence: ['bin/tool.mjs static-import'] }),
    makeEdge(m('bin/tool.mjs'), nodeId('process', 'git'), 'spawns', { evidence: ['bin/tool.mjs:20 execFileSync', 'bin/tool.mjs:31 spawnSync'] }),
    makeEdge(m('bin/helper.mjs'), nodeId('process', 'git'), 'spawns', { evidence: ['bin/helper.mjs:7 spawn'] }),
    makeEdge(m('bin/tool.mjs'), nodeId('process', 'CREATE TABLE t (a TEXT)'), 'spawns', { evidence: ['bin/tool.mjs:40 exec'] }),
    makeEdge(m('bin/tool.mjs'), nodeId('process', 'COMMIT'), 'spawns', { evidence: ['bin/tool.mjs:41 exec'] }),
    makeEdge(m('bin/tool.mjs'), nodeId('process', 'bin/helper.mjs'), 'spawns', { evidence: null }),
    makeEdge(m('bin/test/tool.test.mjs'), nodeId('store', 'reports/out.json'), 'reads', { evidence: ['bin/test/tool.test.mjs:5 readFileSync'] }),
    makeEdge(m('bin/broken.mjs'), nodeId('env', 'CW_HOME'), 'reads', { evidence: ['bin/broken.mjs:1 env'] }),
  ];
  return { v: 1, generatedAt: '2026-11-11T00:00:00.000Z', nodes, edges };
}

test('fromFlowGraph maps modules, files, env keys and spawned binaries by the stated rules', () => {
  // arrange
  const graph = flowGraph();

  // act
  const d = fromFlowGraph(graph);
  const byLabel = Object.fromEntries(d.nodes.map((n) => [n.label, n]));

  // assert
  assert.deepEqual(validateDfd(d).errors, []);
  assert.deepEqual(Object.keys(d).slice(0, 2), ['v', 'kind']);
  assert.deepEqual(byLabel['bin/tool.mjs'], { id: 'node:module:bin/tool.mjs', kind: 'process', label: 'bin/tool.mjs', group: 'bin' });
  assert.equal(byLabel['bin/broken.mjs'].unknown, true);
  assert.match(byLabel['bin/broken.mjs'].note, /not analysed \(unparseable\)/);
  assert.deepEqual(byLabel['reports/out.json'], { id: 'node:store:reports/out.json', kind: 'store', label: 'reports/out.json', subtype: 'file' });
  assert.equal(byLabel['rollup.json'].unknown, true);
  assert.deepEqual(byLabel.CW_HOME, { id: 'node:env:CW_HOME', kind: 'external', label: 'CW_HOME', subtype: 'env' });
  assert.deepEqual(byLabel.git, { id: 'node:process:git', kind: 'external', label: 'git', subtype: 'binary' });
  assert.equal(d.nodes.some((n) => /CREATE TABLE|COMMIT|test/.test(n.label)), false);
});

test('fromFlowGraph turns a read around, keeps a write, and leaves a touch undirected', () => {
  // arrange
  const graph = flowGraph();

  // act
  const d = fromFlowGraph(graph);
  const flow = (label, from) => d.flows.find((f) => f.label === label && f.from === from);

  // assert
  assert.deepEqual(flow('writes', 'node:module:bin/tool.mjs'), {
    from: 'node:module:bin/tool.mjs', to: 'node:store:reports/out.json', label: 'writes', mode: 'sync',
    evidence: { witness: 'static', existence: 'unknown', refs: ['bin/tool.mjs:9 writeFileSync'] },
  });
  assert.deepEqual(flow('reads', 'node:store:reports/out.json'), {
    from: 'node:store:reports/out.json', to: 'node:module:bin/helper.mjs', label: 'reads', mode: 'sync',
    evidence: { witness: 'both', existence: 'confirmed', refs: ['bin/helper.mjs:4 readFileSync'] },
  });
  assert.equal(flow('reads', 'node:env:CW_HOME').to, 'node:module:bin/tool.mjs');
  assert.equal(flow('touches', 'node:module:bin/tool.mjs').directed, false);
});

test('fromFlowGraph reads a spawn as sync only when every witness is a Sync call', () => {
  // arrange
  const graph = flowGraph();

  // act
  const d = fromFlowGraph(graph);
  const spawns = d.flows.filter((f) => f.label === 'spawns').map((f) => [f.from, f.to, f.mode]);

  // assert
  assert.deepEqual(spawns, [
    ['node:module:bin/tool.mjs', 'node:process:git', 'sync'],
    ['node:module:bin/helper.mjs', 'node:process:git', 'async'],
    ['node:module:bin/tool.mjs', 'node:module:bin/helper.mjs', 'async'],
  ]);
});

test('fromFlowGraph counts everything it leaves out', () => {
  // arrange
  const graph = flowGraph();

  // act
  const d = fromFlowGraph(graph);

  // assert
  assert.deepEqual(d.source, {
    producer: 'flow-graph',
    graph: { v: 1, generatedAt: '2026-11-11T00:00:00.000Z', nodes: 12, edges: 12 },
    options: { tests: false, imports: false },
    omitted: { testModules: 1, importEdges: 1, spawnTargetsNotCommands: 1, ambiguousExecEdges: 1, edgesOfOmittedNodes: 2, isolatedNodes: 2 },
  });
  assert.equal(d.title, 'flow graph');
});

test('fromFlowGraph keeps tests and imports when asked, and takes a title', () => {
  // arrange
  const graph = flowGraph();
  delete graph.v;
  delete graph.generatedAt;

  // act
  const d = fromFlowGraph(graph, { tests: true, imports: true, title: 'everything' });

  // assert
  assert.equal(d.title, 'everything');
  assert.equal(d.source.omitted.testModules, 0);
  assert.equal(d.source.omitted.importEdges, 0);
  assert.deepEqual(d.source.graph, { v: null, generatedAt: null, nodes: 12, edges: 12 });
  assert.ok(d.nodes.some((n) => n.label === 'bin/test/tool.test.mjs'));
  assert.deepEqual(d.flows.find((f) => f.label === 'imports'), {
    from: 'node:module:bin/helper.mjs', to: 'node:module:bin/tool.mjs', label: 'imports', mode: 'sync',
    evidence: { witness: 'static', existence: 'unknown', refs: ['bin/tool.mjs static-import'] },
  });
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
  assert.deepEqual(out.source.filter, { prefix: null, focus: 'Ingest', hops: 1, seeds: 1, nodesKept: 3, nodesOmitted: 13, flowsOmitted: 17 });
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
