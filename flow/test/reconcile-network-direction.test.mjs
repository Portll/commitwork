// C3 with the network and directions: endpoints agree on the peer, not the scheme; an unwitnessed
// network refutes nothing; a `touches` edge takes the direction of the opens the run saw; a bare
// name is resolved to the paths actually opened; and the report file is read back validated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reconcile, readReconcile, formatReport, endpointIdentity, isNameKey, nameMatches, directionOf } from '../reconcile.mjs';
import { makeEdge, nodeId } from '../graph.mjs';

const M = 'bin/a.mjs';
const ep = (key, kind) => ({ v: 1, from: nodeId('module', M), to: `node:endpoint:${key}`, kind, witness: 'static', existence: 'unknown', evidence: [`${M}:1 literal`] });
const touch = (to) => makeEdge(nodeId('module', M), nodeId('artifact', to), 'touches');
const g = (edges, mod = {}) => ({ generatedAt: null, nodes: [], modules: [{ path: M, state: 'analysed', pathLiterals: [], ...mod }], edges });
const NET_OK = { state: 'usable', reason: null, observed: 1, refused: 0 };
const rt = (observations, network = NET_OK) => ({ state: 'usable', coverage: [M], observations, network });
const conn = (to, extra = {}) => ({ from: M, to, kind: 'connects', via: 'x', ...extra });

test('endpointIdentity is host and effective port, whatever the scheme', () => {
  // Arrange / Act / Assert
  assert.equal(endpointIdentity('https://API.x.test'), 'api.x.test:443');
  assert.equal(endpointIdentity('tls://api.x.test:443'), 'api.x.test:443');
  assert.equal(endpointIdentity('http://h'), 'h:80');
  assert.equal(endpointIdentity('tcp://db:5432'), 'db:5432');
  assert.equal(endpointIdentity('postgres://db'), 'db:');
  assert.equal(endpointIdentity('http://[::1]:9'), '[::1]:9');
  assert.equal(endpointIdentity('listen:8080'), 'listen:8080');
  assert.equal(endpointIdentity('unix:///s.sock'), 'unix:///s.sock');
  assert.equal(endpointIdentity('garbage'), 'garbage');
});

test('isNameKey / nameMatches / directionOf', () => {
  // Arrange / Act / Assert
  assert.equal(isNameKey('rollup.json'), true);
  assert.equal(isNameKey('./x.json'), true);
  assert.equal(isNameKey('../y/z.json'), true);
  assert.equal(isNameKey('reports/x.json'), false);
  assert.equal(isNameKey('/abs/x.json'), false);
  assert.equal(nameMatches('rollup.json', 'reports/a/rollup.json'), true);
  assert.equal(nameMatches('rollup.json', 'rollup.json'), true);
  assert.equal(nameMatches('rollup.json', 'reports/a/xrollup.json'), false);
  assert.equal(nameMatches('../y/z.json', 'lib/y/z.json'), true);
  assert.equal(nameMatches('./', 'anything'), false);
  assert.equal(directionOf(['read']), 'reads');
  assert.equal(directionOf(['write', 'append']), 'writes');
  assert.equal(directionOf(['readwrite']), 'both');
  assert.equal(directionOf(['read', 'append']), 'both');
  assert.equal(directionOf([]), null);
});

test('a static endpoint and the socket the run opened are ONE edge at two layers', () => {
  // Arrange
  const graph = g([ep('https://api.x.test', 'connects'), ep('listen:8080', 'listens')]);
  // Act
  const r = reconcile(graph, rt([conn('tls://api.x.test:443'), { from: M, to: 'listen:8080', kind: 'listens', via: 'listen' }]));
  // Assert
  assert.equal(r.confirmed.length, 2);
  assert.ok(r.edges.every((e) => e.witness === 'both' && e.existence === 'confirmed'));
  assert.equal(r.divergence, 0);
  assert.equal(r.falseNegatives.length + r.dynamicPaths.length, 0, 'the matched observation is not also a miss');
});

test('a witnessed network that did not see a static connect leaves it UNCONFIRMED', () => {
  // Arrange / Act
  const r = reconcile(g([ep('https://api.x.test', 'connects')]), rt([]));
  // Assert
  assert.equal(r.unconfirmed.length, 1);
  assert.equal(r.edges[0].unconfirmed, true);
  assert.equal(r.edges[0].existence, 'unknown');
});

test('AN UNWITNESSED NETWORK REFUTES NOTHING — a connect it did not see is unknown, not unconfirmed', () => {
  // Arrange
  const graph = g([ep('https://api.x.test', 'connects'), ep('https://b.test', 'connects')]);
  // Act: no network block at all (an older summary, or a union that dropped it)
  const r = reconcile(graph, { state: 'usable', coverage: [M], observations: [conn('https://b.test')] });
  // Assert
  assert.equal(r.unconfirmed.length, 0);
  assert.equal(r.edges[0].networkUnwitnessed, true);
  assert.equal(r.edges[0].unfalsifiable, true);
  assert.equal(r.edges[1].existence, 'confirmed', 'an observation it DID make still confirms');
  assert.equal(r.network.witnessed, false);
  assert.match(r.network.reason, /no network witness/);
});

test('a runtime-only endpoint is a false negative only when the module carries a literal naming it', () => {
  // Arrange
  const graph = g([], { pathLiterals: ['https://named.test/v1'], urlLiterals: ['9000'] });
  // Act
  const r = reconcile(graph, rt([
    conn('https://named.test'),
    conn('tcp://from-config.test:5432'),
    { from: M, to: 'listen:9000', kind: 'listens', via: 'listen' },
    { from: M, to: 'listen:41234', kind: 'listens', via: 'listen', ephemeral: true },
    conn('tcp://localhost:1'),
  ]));
  // Assert
  assert.deepEqual(r.falseNegatives.map((x) => x.to).sort(), ['https://named.test', 'listen:9000']);
  assert.deepEqual(r.dynamicPaths.map((x) => x.to).sort(), ['listen:41234', 'tcp://from-config.test:5432', 'tcp://localhost:1']);
});

test('a runtime endpoint in a module outside coverage is ignored', () => {
  // Arrange / Act
  const r = reconcile(g([]), { ...rt([{ from: 'bin/other.mjs', to: 'tcp://h:1', kind: 'connects' }]), coverage: [M] });
  // Assert
  assert.equal(r.dynamicPaths.length + r.falseNegatives.length, 0);
});

test('A TOUCHES EDGE TAKES THE DIRECTION OF THE OPENS — and an exact open confirms it', () => {
  // Arrange
  const graph = g([touch('data/r.json'), touch('data/w.json'), touch('data/b.json'), touch('data/meta.json')]);
  const obs = [
    { from: M, to: 'data/r.json', kind: 'reads', access: ['read'] },
    { from: M, to: 'data/w.json', kind: 'writes', access: ['append'] },
    { from: M, to: 'data/b.json', kind: 'reads', access: ['read'] },
    { from: M, to: 'data/b.json', kind: 'writes', access: ['write'] },
    { from: M, to: 'data/meta.json', kind: 'reads' },
  ];
  // Act
  const r = reconcile(graph, rt(obs));
  // Assert
  const by = Object.fromEntries(r.edges.map((e) => [e.to.replace(/^node:artifact:/, ''), e]));
  assert.equal(by['data/r.json'].direction, 'reads');
  assert.equal(by['data/w.json'].direction, 'writes');
  assert.equal(by['data/b.json'].direction, 'both');
  assert.equal(by['data/r.json'].existence, 'confirmed');
  assert.equal(by['data/r.json'].witness, 'both');
  assert.equal(by['data/meta.json'].direction, undefined, 'a stat opens nothing and orients nothing');
  assert.equal(by['data/meta.json'].unfalsifiable, true);
  assert.equal(r.directed, 3);
  assert.equal(r.confirmed.filter((c) => c.kind === 'touches').length, 3);
});

test('a direction found by NAME is given, and confirms nothing', () => {
  // Arrange
  const graph = g([touch('rollup.json')]);
  // Act
  const r = reconcile(graph, rt([{ from: M, to: 'reports/a/rollup.json', kind: 'writes', access: ['write'] }]));
  // Assert
  assert.equal(r.edges[0].direction, 'writes');
  assert.equal(r.edges[0].directionBy, 'name');
  assert.equal(r.edges[0].existence, 'unknown', 'the name is several files');
  assert.equal(r.confirmed.length, 0);
});

test('observedPaths maps each bare or relative store name to what THIS module actually opened', () => {
  // Arrange
  const other = 'bin/b.mjs';
  const graph = {
    nodes: [],
    modules: [{ path: M, pathLiterals: [] }, { path: other, pathLiterals: [] }],
    edges: [
      makeEdge(nodeId('module', M), nodeId('artifact', 'rollup.json'), 'reads'),
      makeEdge(nodeId('module', M), nodeId('store', '../cfg/c.json'), 'touches'),
      makeEdge(nodeId('module', M), nodeId('artifact', 'reports/fixed.json'), 'reads'),
      makeEdge(nodeId('module', M), nodeId('env', 'CW_X'), 'reads'),
      makeEdge(nodeId('module', other), nodeId('artifact', 'unrun.json'), 'reads'),
    ],
  };
  const obs = [
    { from: M, to: 'reports/b/rollup.json', kind: 'reads', access: ['read'] },
    { from: M, to: 'reports/a/rollup.json', kind: 'reads' },
    { from: M, to: 'reports/a/rollup.json', kind: 'writes', access: ['write'] },
    { from: M, to: 'lib/cfg/c.json', kind: 'reads', access: ['read'] },
    { from: M, to: 'reports/fixed.json', kind: 'reads' },
    { from: other, to: 'x/rollup.json', kind: 'reads' },
  ];
  // Act
  const r = reconcile(graph, { state: 'usable', coverage: [M, other], observations: obs, network: NET_OK });
  // Assert
  assert.deepEqual(r.observedPaths, {
    'rollup.json': ['reports/a/rollup.json', 'reports/b/rollup.json'],
    '../cfg/c.json': ['lib/cfg/c.json'],
  });
});

test('every reconciled edge carries the contract fields, measured or not', () => {
  // Arrange
  const stray = makeEdge('node:process:git', nodeId('artifact', 'x'), 'reads');
  const graph = g([ep('https://h.test', 'connects'), touch('t.json'), stray]);
  // Act
  const measured = reconcile(graph, rt([conn('https://h.test')]));
  const unmeasured = reconcile(graph, null);
  // Assert
  for (const r of [measured, unmeasured]) {
    for (const e of r.edges) {
      assert.equal(e.v, 1);
      for (const f of ['from', 'to', 'kind', 'witness', 'existence', 'runtimeCoverage']) assert.ok(e[f], `${f} on ${e.to}`);
    }
    assert.ok(Array.isArray(r.coverage));
    assert.equal(typeof r.observedPaths, 'object');
  }
  assert.deepEqual(measured.coverage, [M]);
  assert.equal(unmeasured.network.state, 'unusable');
  assert.deepEqual(reconcile(graph, { state: 'unusable', reason: 'r', network: NET_OK }).network, NET_OK);
});

test('formatReport names directions, resolved names and the network state', () => {
  // Arrange
  const r = reconcile(g([touch('rollup.json')]), rt([{ from: M, to: 'a/rollup.json', kind: 'reads', access: ['read'] }]));
  // Act
  const text = formatReport(r);
  const bare = formatReport({ state: 'unmeasured', reason: 'x', confirmed: [], outOfScope: [] });
  // Assert
  assert.match(text, /touches given a direction by observed opens\s+1/);
  assert.match(text, /bare-name stores resolved to observed paths\s+1/);
  assert.match(text, /network\s+usable/);
  assert.match(bare, /network\s+unusable/);
  assert.match(formatReport({ ...r, network: { state: 'unusable', reason: 'why' } }), /unusable \(why\)/);
});

function withFile(content, fn) {
  const d = mkdtempSync(join(tmpdir(), 'flow-rec-'));
  try {
    const p = join(d, 'flow-reconcile.json');
    if (content !== undefined) writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
    return fn(p);
  } finally { rmSync(d, { recursive: true, force: true }); }
}

test('readReconcile round-trips what reconcile produces', () => {
  // Arrange
  const rec = reconcile(g([touch('rollup.json'), ep('https://h.test', 'connects')]),
    rt([{ from: M, to: 'a/rollup.json', kind: 'reads', access: ['read'] }, conn('https://h.test')]));
  // Act
  const back = withFile(rec, (p) => readReconcile(p));
  // Assert
  assert.deepEqual(back, JSON.parse(JSON.stringify(rec)));
});

test('readReconcile refuses an absent, old-shape or malformed report — it never defaults one', () => {
  // Arrange
  const good = reconcile(g([touch('x.json')]), rt([]));
  const edge = good.edges[0];
  const bad = [
    [[], /not an object/],
    [{ ...good, v: 2 }, /v is 2/],
    [{ ...good, edges: null }, /edges is not an array/],
    [{ ...good, edges: [null] }, /edges\[0\] not an object/],
    [{ ...good, edges: [{ ...edge, v: 0 }] }, /edges\[0\]\.v/],
    [{ ...good, edges: [{ ...edge, to: '' }] }, /edges\[0\]\.to missing/],
    [{ ...good, edges: [{ ...edge, witness: 'maybe' }] }, /witness/],
    [{ ...good, edges: [{ ...edge, existence: 'sure' }] }, /existence/],
    [{ ...good, edges: [{ ...edge, runtimeCoverage: 'some' }] }, /runtimeCoverage/],
    [{ ...good, edges: [{ ...edge, direction: 'sideways' }] }, /direction/],
    [{ ...good, observedPaths: [] }, /observedPaths is not an object/],
    [{ ...good, observedPaths: { a: [1] } }, /observedPaths\["a"\]/],
    [{ ...good, coverage: 'bin/a.mjs' }, /coverage is not a list/],
  ];
  // Act / Assert
  for (const [content, why] of bad) {
    withFile(content, (p) => assert.throws(() => readReconcile(p), (e) => e.code === 'CW_FLOW_RECONCILE_INVALID' && why.test(e.message), String(why)));
  }
  withFile(undefined, (p) => assert.throws(() => readReconcile(p), { code: 'CW_FLOW_RECONCILE_ABSENT' }));
  withFile('{not json', (p) => assert.throws(() => readReconcile(p), { code: 'CW_FLOW_STORE_CORRUPT' }));
});
