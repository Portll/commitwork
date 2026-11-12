// flow/dfd-adapter.mjs: the flow-graph adapter (fromFlowGraph, with the reconcile and a layer map)
// and the code-flow adapter (fromCodeFlows). Each mapping rule is asserted on a graph small enough to
// check by hand; every model the adapters emit is also run through validateDfd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDfd, analyse } from '../../lib/dfd.mjs';
import { makeNode, makeEdge, nodeId } from '../graph.mjs';
import { fromFlowGraph, fromCodeFlows, validateLayerMap, layerOf, globToRegExp, sinkKindOf } from '../dfd-adapter.mjs';
import { dataflowFromResult } from '../../cra/dataflow-evidence.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (rel) => JSON.parse(readFileSync(join(REPO, rel), 'utf8'));

// ── the flow-graph adapter: the original mapping ─────────────────────────────────────────────────

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
    evidence: { witness: 'static', existence: 'unknown', refs: ['bin/tool.mjs:9 writeFileSync'] }, existence: 'unknown',
  });
  assert.deepEqual(flow('reads', 'node:store:reports/out.json'), {
    from: 'node:store:reports/out.json', to: 'node:module:bin/helper.mjs', label: 'reads', mode: 'sync',
    evidence: { witness: 'both', existence: 'confirmed', refs: ['bin/helper.mjs:4 readFileSync'] }, existence: 'confirmed',
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
    options: { tests: false, imports: false, reconcile: null, layers: null,
      merged: { pathsThatAreModules: 0, storesRenamed: 0, storesSplit: 0, directionsResolved: 0, reconcileMatched: 0 } },
    omitted: { testModules: 1, importEdges: 1, spawnTargetsNotCommands: 1, ambiguousExecEdges: 1, edgesOfOmittedNodes: 2, isolatedNodes: 2,
      selfReferences: 0, unknownNodeKinds: 0, unknownEdgeKinds: 0 },
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
    evidence: { witness: 'static', existence: 'unknown', refs: ['bin/tool.mjs static-import'] }, existence: 'unknown',
  });
});

test('include.tests and include.imports are the same switches as the older top-level ones', () => {
  // arrange
  const graph = flowGraph();

  // act
  const d = fromFlowGraph(graph, { include: { tests: true, imports: true } });

  // assert
  assert.deepEqual([d.source.options.tests, d.source.options.imports], [true, true]);
  assert.equal(d.source.omitted.importEdges, 0);
});

// ── the flow-graph adapter: endpoints, databases, schedulers, scripts, logs ──────────────────────

// The new node and edge kinds are written raw: flow/graph.mjs's constructors gain them in the static
// pass's own change, and this adapter is coded against the contract, not against that change.
const raw = (kind, key, extra = {}) => ({ v: 1, id: `node:${kind}:${key}`, kind, path: key, lastWriteAt: null, ...extra });
const edge = (from, to, kind, extra = {}) => ({ v: 1, from, to, kind, witness: 'static', existence: 'unknown', evidence: [`${kind} witness`], ...extra });
const M = (p) => nodeId('module', p);
const graphOf = (nodes, edges) => ({ v: 1, generatedAt: null, nodes, edges });
const mods = (...paths) => paths.map((p) => makeNode('module', p, { analysis: 'analysed' }));
const flowsOf = (d) => d.flows.map((f) => `${f.from} > ${f.to} ${f.label} ${f.mode}`);

test('an endpoint is an external; a connection flows out to it and a listener is fed from it', () => {
  // arrange
  const graph = graphOf([...mods('srv/api.mjs'), raw('endpoint', 'https://api.example:443'), raw('endpoint', 'listen:8080')], [
    edge(M('srv/api.mjs'), 'node:endpoint:https://api.example:443', 'connects'),
    edge(M('srv/api.mjs'), 'node:endpoint:listen:8080', 'listens'),
    edge('node:endpoint:listen:8080', M('srv/api.mjs'), 'listens'),
  ]);

  // act
  const d = fromFlowGraph(graph);

  // assert
  assert.deepEqual(validateDfd(d).errors, []);
  assert.deepEqual(d.nodes.filter((n) => n.kind === 'external'), [
    { id: 'node:endpoint:https://api.example:443', kind: 'external', label: 'https://api.example:443', subtype: 'endpoint' },
    { id: 'node:endpoint:listen:8080', kind: 'external', label: 'listen:8080', subtype: 'endpoint', note: 'a port this tree listens on (8080)' },
  ]);
  assert.deepEqual(flowsOf(d), [
    'node:module:srv/api.mjs > node:endpoint:https://api.example:443 connects sync',
    'node:endpoint:listen:8080 > node:module:srv/api.mjs listens sync',
    'node:endpoint:listen:8080 > node:module:srv/api.mjs listens sync',
  ]);
});

test('a database is a store of subtype database, and the tables a flow names go into its label', () => {
  // arrange
  const db = raw('database', 'state/app.db');
  const graph = graphOf([...mods('a.mjs', 'b.mjs'), db], [
    edge(M('a.mjs'), db.id, 'writes', { tables: ['users', 'orders'] }),
    edge(M('b.mjs'), db.id, 'reads', { tables: ['users'] }),
    edge(M('b.mjs'), db.id, 'writes', { tables: [] }),
  ]);

  // act
  const d = fromFlowGraph(graph);

  // assert
  assert.deepEqual(d.nodes.find((n) => n.id === db.id), { id: db.id, kind: 'store', label: 'state/app.db', subtype: 'database' });
  assert.deepEqual(d.flows.map((f) => f.label), ['writes users, orders', 'reads users', 'writes']);
});

test('a scheduler is an external that triggers its module by event, whichever end the edge names first', () => {
  // arrange
  const nodes = [...mods('monitor/sweep.mjs', 'lib/poll.mjs'), raw('scheduler', 'launchd:com.example.sweep'), raw('scheduler', 'timer:lib/poll.mjs'), raw('scheduler', 'at:noon')];
  const graph = graphOf(nodes, [
    edge('node:scheduler:launchd:com.example.sweep', M('monitor/sweep.mjs'), 'triggers'),
    edge(M('lib/poll.mjs'), 'node:scheduler:timer:lib/poll.mjs', 'triggers'),
    edge('node:scheduler:at:noon', M('lib/poll.mjs'), 'triggers'),
  ]);

  // act
  const d = fromFlowGraph(graph);

  // assert
  assert.deepEqual(validateDfd(d).errors, []);
  assert.deepEqual(flowsOf(d), [
    'node:scheduler:launchd:com.example.sweep > node:module:monitor/sweep.mjs triggers event',
    'node:scheduler:timer:lib/poll.mjs > node:module:lib/poll.mjs triggers event',
    'node:scheduler:at:noon > node:module:lib/poll.mjs triggers event',
  ]);
  assert.deepEqual(d.nodes.filter((n) => n.subtype === 'scheduler').map((n) => n.note), ['launchd agent', 'in-process timer', undefined]);
});

test('a spawn of node with a script flows to the script\'s process, not to the node binary', () => {
  // arrange
  const graph = graphOf([...mods('bin/run.mjs', 'bin/child.mjs'), makeNode('process', 'node')], [
    edge(M('bin/run.mjs'), nodeId('process', 'node'), 'spawns', { script: 'bin/child.mjs', evidence: ['bin/run.mjs:3 spawn'] }),
    edge(M('bin/child.mjs'), nodeId('process', 'node'), 'spawns', { script: 'vendor/tool.js', evidence: ['bin/child.mjs:9 spawnSync'] }),
  ]);

  // act
  const d = fromFlowGraph(graph);

  // assert
  assert.deepEqual(flowsOf(d), [
    'node:module:bin/run.mjs > node:module:bin/child.mjs spawns async',
    'node:module:bin/child.mjs > node:process:node spawns vendor/tool.js sync',
  ]);
});

test('an appended file another module tails is a log: a broker, with async flows either side', () => {
  // arrange
  const log = makeNode('store', 'state/events.jsonl');
  const plain = makeNode('store', 'state/notes.txt');
  const graph = graphOf([...mods('w.mjs', 'r.mjs'), log, plain], [
    edge(M('w.mjs'), log.id, 'writes', { append: true }),
    edge(M('r.mjs'), log.id, 'reads', { tail: true }),
    edge(M('w.mjs'), plain.id, 'writes'),   // written, not appended: a tail alone does not make a log
    edge(M('r.mjs'), plain.id, 'reads', { tail: true }),
    edge(M('r.mjs'), plain.id, 'reads'),
  ]);

  // act
  const d = fromFlowGraph(graph);
  const a = analyse(d);

  // assert
  assert.deepEqual(d.nodes.filter((n) => n.kind === 'store').map((n) => [n.label, n.subtype]), [['state/events.jsonl', 'log'], ['state/notes.txt', 'file']]);
  assert.deepEqual(flowsOf(d), [
    'node:module:w.mjs > node:store:state/events.jsonl appends async',
    'node:store:state/events.jsonl > node:module:r.mjs tails async',
    'node:module:w.mjs > node:store:state/notes.txt writes sync',
    'node:store:state/notes.txt > node:module:r.mjs reads sync',
    'node:store:state/notes.txt > node:module:r.mjs reads sync',
  ]);
  assert.deepEqual(a.brokered, [{ from: 'node:module:w.mjs', via: 'node:store:state/events.jsonl', to: 'node:module:r.mjs' }]);
});

test('an append to a file nobody tails stays a file and a sync flow', () => {
  // arrange
  const s = makeNode('store', 'out.log');
  const graph = graphOf([...mods('w.mjs'), s], [edge(M('w.mjs'), s.id, 'writes', { append: true })]);

  // act
  const d = fromFlowGraph(graph);

  // assert
  assert.deepEqual([d.nodes[1].subtype, d.flows[0].label, d.flows[0].mode], ['file', 'appends', 'sync']);
});

// ── the flow-graph adapter: the double element, the reconcile and layers ─────────────────────────

test('a path literal that names a module is that module\'s process, not a second element', () => {
  // arrange
  const graph = graphOf([...mods('bin/a.mjs', 'bin/b.mjs'), makeNode('artifact', 'bin/b.mjs'), makeNode('artifact', 'bin/a.mjs')], [
    edge(M('bin/a.mjs'), nodeId('artifact', 'bin/b.mjs'), 'reads'),
    edge(M('bin/a.mjs'), nodeId('artifact', 'bin/a.mjs'), 'reads'),
  ]);

  // act
  const d = fromFlowGraph(graph);

  // assert
  assert.deepEqual(d.nodes.map((n) => [n.id, n.kind]), [['node:module:bin/a.mjs', 'process'], ['node:module:bin/b.mjs', 'process']]);
  assert.deepEqual(flowsOf(d), ['node:module:bin/b.mjs > node:module:bin/a.mjs reads sync']);
  assert.equal(d.source.options.merged.pathsThatAreModules, 2);
  assert.equal(d.source.omitted.selfReferences, 1);
});

test('the reconcile replaces witness and existence, and existence is confirmed only when it is', () => {
  // arrange
  const s = makeNode('store', 'out.json');
  const graph = graphOf([...mods('a.mjs', 'b.mjs'), s], [
    makeEdge(M('a.mjs'), s.id, 'writes', { evidence: ['a.mjs:1 writeFileSync'] }),
    makeEdge(M('b.mjs'), s.id, 'reads', { evidence: ['b.mjs:1 readFileSync'] }),
  ]);
  const reconcile = { v: 1, generatedAt: '2026-11-12T00:00:00.000Z', coverage: { modules: 2 }, observedPaths: {},
    edges: [{ v: 1, from: M('a.mjs'), to: s.id, kind: 'writes', witness: 'both', existence: 'confirmed', runtimeCoverage: 'visited' },
      { v: 1, from: M('b.mjs'), to: s.id, kind: 'reads', witness: 'static', existence: 'unknown', runtimeCoverage: 'unvisited' }] };

  // act
  const d = fromFlowGraph(graph, { reconcile });

  // assert
  assert.deepEqual(d.flows.map((f) => [f.label, f.existence, f.evidence.witness, f.evidence.existence]), [['writes', 'confirmed', 'both', 'confirmed'], ['reads', 'unknown', 'static', 'unknown']]);
  assert.deepEqual(d.source.options.reconcile, { edges: 2, generatedAt: '2026-11-12T00:00:00.000Z' });
  assert.equal(d.source.options.merged.reconcileMatched, 2);
});

test('a touch the runtime resolved becomes directed flows carrying the direction it saw', () => {
  // arrange
  const stores = ['r.json', 'w.json', 'rw.json', 'x.json', 'y.json'].map((p) => makeNode('artifact', p));
  const graph = graphOf([...mods('m.mjs'), ...stores], stores.map((s) => makeEdge(M('m.mjs'), s.id, 'touches')));
  const dir = { 'r.json': 'reads', 'w.json': 'write', 'rw.json': 'both', 'x.json': 'sideways' };
  const reconcile = { edges: Object.entries(dir).map(([p, direction]) => ({ from: M('m.mjs'), to: nodeId('artifact', p), kind: 'touches', witness: 'both', existence: 'confirmed', direction })) };

  // act
  const d = fromFlowGraph(graph, { reconcile });

  // assert
  assert.deepEqual(validateDfd(d).errors, []);
  assert.deepEqual(d.flows.map((f) => [f.from.replace('node:', ''), f.to.replace('node:', ''), f.label, f.direction ?? null, f.directed ?? true]), [
    ['artifact:r.json', 'module:m.mjs', 'reads', 'reads', true],
    ['module:m.mjs', 'artifact:w.json', 'writes', 'writes', true],
    ['artifact:rw.json', 'module:m.mjs', 'reads', 'both', true],
    ['module:m.mjs', 'artifact:rw.json', 'writes', 'both', true],
    ['module:m.mjs', 'artifact:x.json', 'touches', null, false],
    ['module:m.mjs', 'artifact:y.json', 'touches', null, false],
  ]);
  assert.equal(d.source.options.merged.directionsResolved, 3);
  assert.deepEqual(analyse(d).bidirectional.map((b) => [b.a, b.b]), [['node:module:m.mjs', 'node:artifact:rw.json']]);
});

test('observedPaths renames a bare filename with one location and splits one with several', () => {
  // arrange
  const one = makeNode('artifact', 'rollup.json', { composed: true });
  const many = makeNode('artifact', 'state.json', { composed: true });
  const none = makeNode('artifact', 'ghost.json', { composed: true });
  const graph = graphOf([...mods('a.mjs'), one, many, none], [
    makeEdge(M('a.mjs'), one.id, 'writes', { witness: 'both', existence: 'confirmed' }),
    makeEdge(M('a.mjs'), many.id, 'reads', { witness: 'both', existence: 'confirmed' }),
    makeEdge(M('a.mjs'), none.id, 'reads'),
  ]);
  const reconcile = { edges: [], observedPaths: { 'rollup.json': ['reports/x/rollup.json'], [many.id]: ['reports/a/state.json', 'reports/b/state.json'] } };

  // act
  const d = fromFlowGraph(graph, { reconcile });
  const stores = d.nodes.filter((n) => n.kind === 'store');

  // assert
  assert.deepEqual(validateDfd(d).errors, []);
  assert.deepEqual(stores.map((n) => [n.id, n.label, n.unknown ?? false]), [
    [one.id, 'reports/x/rollup.json', false],
    [`${many.id}@reports/a/state.json`, 'reports/a/state.json', false],
    [`${many.id}@reports/b/state.json`, 'reports/b/state.json', false],
    [none.id, 'ghost.json', true],
  ]);
  assert.match(stores[1].note, /one of 2 paths the runtime opened under that name; which module used which path was not observed/);
  assert.deepEqual(d.flows.map((f) => [f.to === M('a.mjs') ? f.from : f.to, f.existence]), [
    [one.id, 'confirmed'],
    [`${many.id}@reports/a/state.json`, 'unknown'],
    [`${many.id}@reports/b/state.json`, 'unknown'],
    [none.id, 'unknown'],
  ]);
  assert.deepEqual([d.source.options.merged.storesRenamed, d.source.options.merged.storesSplit], [1, 1]);
});

test('a layer map puts processes and stores in maturity layers and leaves externals out of them', () => {
  // arrange
  const graph = graphOf([...mods('bin/scan.mjs', 'monitor/rollup.mjs'), makeNode('store', 'reports/raw.sarif'), makeNode('env', 'CW_HOME')], [
    makeEdge(M('bin/scan.mjs'), nodeId('store', 'reports/raw.sarif'), 'writes'),
    makeEdge(M('monitor/rollup.mjs'), nodeId('store', 'reports/raw.sarif'), 'reads'),
    makeEdge(M('monitor/rollup.mjs'), nodeId('env', 'CW_HOME'), 'reads'),
  ]);
  const layers = { layers: ['raw', 'normalised'], rules: [{ glob: '**/*.sarif', layer: 'raw' }, { prefix: 'bin/', layer: 'raw' }, { prefix: 'monitor/', layer: 'normalised' }] };

  // act
  const d = fromFlowGraph(graph, { layers });
  const asRules = fromFlowGraph(graph, { layers: layers.rules });

  // assert
  assert.deepEqual(validateDfd(d).errors, []);
  assert.deepEqual(d.layers, ['raw', 'normalised']);
  assert.deepEqual(d.nodes.map((n) => [n.label, n.layer ?? null]), [['bin/scan.mjs', 'raw'], ['monitor/rollup.mjs', 'normalised'], ['reports/raw.sarif', 'raw'], ['CW_HOME', null]]);
  assert.equal(d.source.options.layers, 3);
  assert.deepEqual(asRules.layers, ['raw', 'normalised']);
  assert.throws(() => fromFlowGraph(graph, { layers: { layers: ['raw'], rules: [{ prefix: 'bin/', layer: 'gold' }] } }), /names layer "gold"/);
});

test('a node or edge kind the adapter does not know is counted, never drawn as a guess', () => {
  // arrange
  const graph = graphOf([...mods('a.mjs'), raw('socket', '/tmp/s'), makeNode('store', 'x.json')], [
    edge(M('a.mjs'), 'node:socket:/tmp/s', 'writes'),
    edge(M('a.mjs'), nodeId('store', 'x.json'), 'mutates'),
  ]);

  // act
  const d = fromFlowGraph(graph);

  // assert
  assert.deepEqual([d.source.omitted.unknownNodeKinds, d.source.omitted.unknownEdgeKinds, d.source.omitted.edgesOfOmittedNodes], [1, 1, 1]);
  assert.deepEqual(d.flows, []);
});

// ── layer maps ───────────────────────────────────────────────────────────────────────────────────

test('a glob matches within a segment with *, at any depth with **, and one character with ?', () => {
  // arrange
  const cases = [['reports/*.json', 'reports/a.json', true], ['reports/*.json', 'reports/x/a.json', false], ['**/rollup.json', 'rollup.json', true],
    ['**/rollup.json', 'reports/x/rollup.json', true], ['bin/**', 'bin/a/b.mjs', true], ['a?.mjs', 'ab.mjs', true], ['a?.mjs', 'a/.mjs', false], ['a+b.json', 'a+b.json', true]];

  // act
  const got = cases.map(([g, p]) => globToRegExp(g).test(p));

  // assert
  assert.deepEqual(got, cases.map((c) => c[2]));
});

test('layerOf takes the first rule that matches, and a path no rule matches has no layer', () => {
  // arrange
  const map = { layers: ['a', 'b'], rules: [{ prefix: 'x/y', layer: 'b' }, { glob: 'x/**', layer: 'a' }] };

  // act
  const got = ['x/y/z', 'x/q', 'elsewhere'].map((p) => layerOf(p, map));

  // assert
  assert.deepEqual(got, ['b', 'a', undefined]);
  assert.equal(layerOf('x/q', map.rules), 'a');
});

test('validateLayerMap refuses every malformed shape, by name', () => {
  // arrange
  const bad = [null, [], { layers: [], rules: [] }, { layers: ['a', 'a'], rules: [{ prefix: 'x', layer: 'a' }] },
    { v: 2, kind: 'other', layers: ['a'], rules: [{ prefix: 'x', glob: 'y', layer: 'a', extra: 1 }], more: true }];

  // act
  const errors = bad.map((m) => validateLayerMap(m).errors.join(' | '));

  // assert
  assert.match(errors[0], /not an object/);
  assert.match(errors[1], /not an object/);
  assert.match(errors[2], /layers must be a non-empty array.*rules must be a non-empty array/);
  assert.match(errors[3], /a layer is declared more than once/);
  assert.match(errors[4], /unknown field "more".*v must be 1.*kind must be "dfd-layers".*unknown field\(s\) extra.*exactly one of prefix and glob/);
  assert.deepEqual(validateLayerMap({ v: 1, kind: 'dfd-layers', layers: ['a'], rules: [{ prefix: 'x', layer: 'a', why: 'because' }] }), { ok: true, errors: [] });
});

// ── the code-flow adapter ────────────────────────────────────────────────────────────────────────

const step = (uri, line, text) => ({ location: { physicalLocation: { artifactLocation: { uri }, region: { startLine: line } }, message: { text } } });
const sarif = (rule, locs) => ({ ruleId: rule, locations: [{ physicalLocation: { artifactLocation: { uri: locs[locs.length - 1][0] } } }],
  codeFlows: [{ threadFlows: [{ locations: locs.map(([u, l, t]) => step(u, l, t)) }] }] });
const NOW = '2026-11-12T00:00:00.000Z';

test('a CodeQL trace becomes input -> source file -> sink file -> sink, typed by what the rule sinks into', () => {
  // arrange
  const records = [
    dataflowFromResult(sarif('js/sql-injection', [['api/routes.js', 4, 'req.query.id'], ['api/x.js', 7, 'id'], ['api/db.js', 12, 'query(sql)']]), 'shop', NOW),
    dataflowFromResult(sarif('js/reflected-xss', [['api/routes.js', 4, 'req.query.id'], ['api/routes.js', 9, 'res.send(id)']]), 'shop', NOW),
  ];

  // act
  const d = fromCodeFlows(records, { title: 'shop' });

  // assert
  assert.deepEqual(validateDfd(d).errors, []);
  assert.equal(d.title, 'shop');
  assert.deepEqual(d.groups, [{ id: 'repo:shop', label: 'shop', boundary: 'system' }, { id: 'untrusted', label: 'Untrusted input', boundary: 'trust' }]);
  assert.deepEqual(d.nodes.map((n) => [n.id, n.kind, n.subtype ?? null]), [
    ['input:shop:api/routes.js:4', 'external', 'actor'],
    ['code:shop:api/routes.js', 'process', null],
    ['code:shop:api/db.js', 'process', null],
    ['sink:shop:database query', 'store', 'database'],
    ['sink:shop:browser that renders the response', 'external', 'actor'],
  ]);
  assert.deepEqual(d.flows.map((f) => `${f.from} > ${f.to}: ${f.label}`), [
    'input:shop:api/routes.js:4 > code:shop:api/routes.js: req.query.id',
    'code:shop:api/routes.js > code:shop:api/db.js: 3 steps (js/sql-injection)',
    'code:shop:api/db.js > sink:shop:database query: query(sql) (js/sql-injection)',
    'code:shop:api/routes.js > sink:shop:browser that renders the response: res.send(id) (js/reflected-xss)',
  ]);
  assert.deepEqual(d.flows[0].evidence, { witness: 'static', existence: 'unknown', refs: ['js/sql-injection api/routes.js:4 -> api/db.js:12', 'js/reflected-xss api/routes.js:4 -> api/routes.js:9'] });
  assert.ok(d.flows.every((f) => f.existence === 'unknown'));
  assert.equal(analyse(d).paths.total, 2);
});

test('a record without a path draws nothing and is counted; so is one that is not a record', () => {
  // arrange
  const records = [
    dataflowFromResult({ ruleId: 'js/incomplete-sanitization', locations: [] }, 'shop', NOW),
    null,
    { repo: 'shop' },
    dataflowFromResult(sarif('js/command-line-injection', [['cli.js', 1, null], ['cli.js', 2, null]]), 'shop', NOW),
  ];

  // act
  const d = fromCodeFlows(records);

  // assert
  assert.deepEqual(d.source.omitted, { noPath: 1, unreadable: 2 });
  assert.equal(d.title, 'code flows');
  assert.equal(d.source.producer, 'codeql-code-flows');
  assert.deepEqual(d.flows.map((f) => f.label), ['untrusted input', 'js/command-line-injection']);
  assert.equal(d.nodes[0].label, 'cli.js:1');
  assert.deepEqual(validateDfd(d).errors, []);
  assert.deepEqual(fromCodeFlows(undefined).nodes, []);
});

test('sinkKindOf names the sink from the rule id, and an unnamed one is an unknown system', () => {
  // arrange
  const rules = ['js/sql-injection', 'py/log-injection', 'js/path-injection', 'go/command-injection', 'js/request-forgery', 'js/xss-through-dom', 'js/code-injection', 'java/weird-rule', undefined];

  // act
  const got = rules.map((r) => { const s = sinkKindOf(r); return `${s.kind}:${s.subtype}${s.unknown ? ':unknown' : ''}`; });

  // assert
  assert.deepEqual(got, ['store:database', 'store:log', 'store:file', 'external:binary', 'external:endpoint', 'external:actor', 'external:system', 'external:system:unknown', 'external:system:unknown']);
});

test('an unclassified sink is marked unknown and says which rule could not be read', () => {
  // arrange
  const records = [dataflowFromResult(sarif('java/weird-rule', [['A.java', 1, 'in'], ['B.java', 2, 'out']]), 'svc', NOW)];

  // act
  const d = fromCodeFlows(records);
  const sink = d.nodes.find((n) => n.id.startsWith('sink:'));

  // assert
  assert.equal(sink.unknown, true);
  assert.match(sink.note, /the rule id java\/weird-rule does not say what its sink is/);
});

// ── the documents in docs/dfd/ ───────────────────────────────────────────────────────────────────

const headingsOf = (md) => [...md.matchAll(/^#{2,4} (.+)$/gm)].map((m) => m[1]);
const anchorOf = (h) => h.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');

test('the threat-model diagram is a valid dfd@1 document and every element cites a real section', () => {
  // arrange
  const doc = readJson('docs/dfd/threat-model.dfd.json');
  const heads = headingsOf(readFileSync(join(REPO, 'docs', 'THREAT-MODEL.md'), 'utf8'));
  const anchors = new Set(heads.map(anchorOf));

  // act
  const valid = validateDfd(doc);
  const uncited = doc.nodes.filter((n) => !heads.some((h) => (n.note || '').includes(`docs/THREAT-MODEL.md § ${h}`))).map((n) => n.id);
  const badRefs = doc.flows.flatMap((f) => f.evidence.refs).filter((r) => !r.startsWith('docs/THREAT-MODEL.md#') || !anchors.has(r.split('#')[1]));

  // assert
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(uncited, []);
  assert.deepEqual(badRefs, []);
  assert.ok(doc.flows.every((f) => f.evidence.witness === 'authored' && f.evidence.existence === 'unknown'), 'nothing in the threat model was observed');
});

test('the threat-model diagram draws the boundaries, the attackers and the loops the document names', () => {
  // arrange
  const doc = readJson('docs/dfd/threat-model.dfd.json');

  // act
  const a = analyse(doc);
  const groups = Object.fromEntries(doc.groups.map((g) => [g.id, g.boundary]));
  const actors = doc.nodes.filter((n) => n.subtype === 'actor').map((n) => n.id);

  // assert
  assert.deepEqual(groups, { network: 'trust', host: 'trust', commitwork: 'system', sandbox: 'trust', container: 'trust', model: 'trust' });
  assert.deepEqual(actors, ['repo-author', 'dep-author', 'operator', 'mcp-client']);
  assert.deepEqual(a.feedback.map((f) => `${f.from}>${f.to}`), ['mcp-client>mcp-server', 'claude>tree', 'judge>issue-loop']);
  assert.deepEqual(a.bidirectional.map((b) => `${b.a}<>${b.b}`), ['reports<>host-lane', 'registries<>host-lane']);
  assert.equal(doc.flows.some((f) => f.from === 'cred-stores' || f.to === 'cred-stores'), false);
  assert.equal(doc.nodes.find((n) => n.id === 'registries').unknown, true);
});

test('the commitwork layer map is valid, names only paths the tree has, and layers the sweep pipeline in order', () => {
  // arrange
  const map = readJson('docs/dfd/commitwork-layers.json');
  const path = (p) => join(REPO, p);

  // act
  const valid = validateLayerMap(map);
  const missing = map.rules.filter((r) => r.prefix && !r.prefix.endsWith('-') && !existsSync(path(r.prefix.replace(/\/$/, '')))).map((r) => r.prefix);
  const got = ['reports/sweep-2026/repo/codeql.sarif', 'bin/commitwork.mjs', 'monitor/extractors/sarif.mjs', 'reports/area/rollup.json',
    'monitor/rollup.mjs', 'reports/area/dashboard.html', 'admin/server.mjs', 'lib/dfd.mjs'].map((p) => layerOf(p, map) ?? null);

  // assert
  assert.deepEqual(valid, { ok: true, errors: [] });
  assert.deepEqual(map.layers, ['raw', 'normalised', 'published']);
  assert.match(map.$comment, /monitor\/README\.md 'The sweep pipeline'/);
  assert.deepEqual(missing, []);
  assert.deepEqual(got, ['raw', 'raw', 'normalised', 'normalised', 'normalised', 'published', 'published', null]);
});
