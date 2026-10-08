// C4's negative controls come FIRST. Everything else here is consistent with an orphan finder that
// returns [] for every input, and a finder that always returns [] passes a repo audit silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orphans } from '../orphans.mjs';
import { makeNode, makeEdge, nodeId } from '../graph.mjs';

function graph(spec) {
  const nodes = new Map();
  const edges = [];
  const put = (kind, key, extra) => {
    const id = nodeId(kind, key);
    if (!nodes.has(id)) nodes.set(id, makeNode(kind, key, extra));
    return id;
  };
  for (const [from, kind, to, opts = {}] of spec) {
    const { composed, ...rest } = opts;
    edges.push(makeEdge(put('module', from), put('artifact', to, { composed: !!composed }), kind,
      { evidence: `${from}:1 fixture`, ...rest }));
  }
  return { nodes: [...nodes.values()], edges };
}

test('NEGATIVE CONTROL A — a planted orphan is FOUND, in both directions', () => {
  const g = graph([
    ['bin/writer.mjs', 'writes', 'reports/nobody-reads-this.json'],
    ['bin/reader.mjs', 'reads', 'reports/nobody-writes-this.json'],
  ]);
  const o = orphans(g);
  assert.deepEqual(o.writtenNeverRead.map((x) => x.path), ['reports/nobody-reads-this.json'],
    'an artifact written and never read must be reported');
  assert.deepEqual(o.readNeverWritten.map((x) => x.path), ['reports/nobody-writes-this.json'],
    'a reader whose producer is absent must be reported — the dangerous direction');
  assert.deepEqual(o.writtenNeverRead[0].writers, ['bin/writer.mjs']);
  assert.deepEqual(o.readNeverWritten[0].readers, ['bin/reader.mjs']);
});

test('NEGATIVE CONTROL B — a healthy pair produces SILENCE', () => {
  const g = graph([
    ['bin/writer.mjs', 'writes', 'reports/paired.json'],
    ['bin/reader.mjs', 'reads', 'reports/paired.json'],
  ]);
  const o = orphans(g);
  assert.deepEqual(o.writtenNeverRead, [], 'a written-and-read artifact is not an orphan');
  assert.deepEqual(o.readNeverWritten, [], 'and not in the other direction either');
  assert.deepEqual(o.readNeverWrittenWithFallback, []);
  assert.equal(o.summary.writtenNeverRead + o.summary.readNeverWritten, 0);
});

test('"reads X" and "reads X, falls back to Y" are DIFFERENT findings', () => {
  const g = graph([
    ['bin/plain.mjs', 'reads', 'reports/gone.json'],
    ['bin/guarded.mjs', 'reads', 'reports/gone-guarded.json', { fallback: { suspected: true, marker: 'catch {' } }],
  ]);
  const o = orphans(g);
  assert.deepEqual(o.readNeverWritten.map((x) => x.path), ['reports/gone.json']);
  assert.deepEqual(o.readNeverWrittenWithFallback.map((x) => x.path), ['reports/gone-guarded.json'],
    'a fallback reader is the one that will never announce the dead producer, so it is its own row');
  assert.equal(o.readNeverWrittenWithFallback[0].fallbackReaders[0].marker, 'catch {');
});

test('a reader with BOTH a plain and a guarded site appears in both, not one', () => {
  const g = graph([
    ['bin/a.mjs', 'reads', 'reports/mixed.json'],
    ['bin/b.mjs', 'reads', 'reports/mixed.json', { fallback: { suspected: true, marker: '??' } }],
  ]);
  const o = orphans(g);
  assert.deepEqual(o.readNeverWritten.map((x) => x.path), ['reports/mixed.json']);
  assert.deepEqual(o.readNeverWrittenWithFallback.map((x) => x.path), ['reports/mixed.json']);
});

test('explicit uncertainty — an artifact whose direction was never determined is NOT an orphan', () => {
  // 42% of this repo's artifact edges are `touches`: referenced, direction undecidable without real
  // dataflow. Counting those as orphans would manufacture ~2,500 findings out of not knowing.
  const g = graph([['bin/x.mjs', 'touches', 'reports/undetermined.json']]);
  const o = orphans(g);
  assert.deepEqual(o.writtenNeverRead, []);
  assert.deepEqual(o.readNeverWritten, []);
  assert.deepEqual(o.directionUnknown.map((x) => x.path), ['reports/undetermined.json'],
    'it must be reported as undetermined — silently dropping it is the other half of the same error');
});

test('a determined edge alongside an undetermined one stays unknown', () => {
  const g = graph([
    ['bin/w.mjs', 'writes', 'reports/part.json'],
    ['bin/x.mjs', 'touches', 'reports/part.json'],
  ]);
  assert.deepEqual(orphans(g).writtenNeverRead, [],
    'a `touches` edge might be the missing read; claiming an orphan over it is a guess');
});

test('a bare filename is a NAME, not a location — low confidence, kept separate', () => {
  const g = graph([['bin/x.mjs', 'writes', 'rollup.json', { composed: true }]]);
  const o = orphans(g);
  assert.deepEqual(o.writtenNeverRead, [], 'a composed node must not reach the headline finding');
  assert.deepEqual(o.lowConfidence.map((x) => x.path), ['rollup.json']);
});

test('the summary counts agree with the arrays they summarise', () => {
  const g = graph([
    ['bin/w.mjs', 'writes', 'reports/one.json'],
    ['bin/r.mjs', 'reads', 'reports/two.json'],
    ['bin/t.mjs', 'touches', 'reports/three.json'],
  ]);
  const o = orphans(g);
  assert.equal(o.summary.writtenNeverRead, o.writtenNeverRead.length);
  assert.equal(o.summary.readNeverWritten, o.readNeverWritten.length);
  assert.equal(o.summary.directionUnknown, o.directionUnknown.length);
});
