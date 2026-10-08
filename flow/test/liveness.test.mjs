// C5. The headline is that a consumer which assumes nothing is ITSELF the finding, so the guard has
// to be able to find one and has to stay quiet when every consumer checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liveness } from '../liveness.mjs';
import { makeNode, makeEdge, nodeId } from '../graph.mjs';

const NOW = '2026-09-02T12:00:00.000Z';

function graph(spec, nodeExtra = {}) {
  const nodes = new Map();
  const edges = [];
  const put = (kind, key, extra) => {
    const id = nodeId(kind, key);
    if (!nodes.has(id)) nodes.set(id, makeNode(kind, key, extra));
    return id;
  };
  for (const [from, kind, to, opts = {}] of spec) {
    edges.push(makeEdge(put('module', from), put('store', to, nodeExtra), kind, { evidence: `${from}:1`, ...opts }));
  }
  return { nodes: [...nodes.values()], edges };
}

function repoWith(files) {
  const d = mkdtempSync(join(tmpdir(), 'flow-lv-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(d, rel, '..'), { recursive: true });
    writeFileSync(join(d, rel), body);
  }
  return d;
}

test('NEGATIVE CONTROL — a consumer that checks NO freshness is reported', () => {
  const d = repoWith({ 'reports/s.json': '{}' });
  try {
    const l = liveness(graph([
      ['bin/w.mjs', 'writes', 'reports/s.json'],
      ['bin/r.mjs', 'reads', 'reports/s.json'],
    ]), { root: d, env: { CW_NOW: NOW } });
    assert.equal(l.summary.withConsumerAssumingNothing, 1);
    assert.deepEqual(l.stores[0].findings.consumersAssumingNothing, ['bin/r.mjs'],
      'a reader with no staleness check cannot tell a dead producer from a live one');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('NEGATIVE CONTROL — a consumer that DOES check stays quiet', () => {
  const d = repoWith({ 'reports/s.json': '{}' });
  try {
    const l = liveness(graph([
      ['bin/w.mjs', 'writes', 'reports/s.json'],
      ['bin/r.mjs', 'reads', 'reports/s.json', { freshness: { checks: true, marker: 'mtimeMs' } }],
    ]), { root: d, env: { CW_NOW: NOW } });
    assert.equal(l.summary.withConsumerAssumingNothing, 0);
    assert.deepEqual(l.stores[0].findings.consumersAssumingNothing, []);
    assert.deepEqual(l.stores[0].consumers[0].assumes, { kind: 'checked', marker: 'mtimeMs' });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('ABSENT IS NOT STALE — a store read but not on disk has its own state', () => {
  const d = repoWith({});
  try {
    const l = liveness(graph([['bin/r.mjs', 'reads', 'reports/never-existed.json']]), { root: d, env: { CW_NOW: NOW } });
    assert.equal(l.stores[0].state, 'absent');
    assert.equal(l.stores[0].lastWriteAt, null);
    assert.equal(l.stores[0].ageMs, null, 'an absent store has no age — 0 would read as "written just now"');
    assert.deepEqual(l.summary.absentButRead, ['reports/never-existed.json']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a present store carries a real mtime and a computed age', () => {
  const d = repoWith({ 'reports/s.json': '{}' });
  try {
    const then = new Date('2026-09-01T12:00:00.000Z');
    utimesSync(join(d, 'reports/s.json'), then, then);
    const l = liveness(graph([['bin/r.mjs', 'reads', 'reports/s.json']]), { root: d, env: { CW_NOW: NOW } });
    assert.equal(l.stores[0].state, 'present');
    assert.equal(l.stores[0].lastWriteAt, '2026-09-01T12:00:00.000Z');
    assert.equal(l.stores[0].ageMs, 24 * 60 * 60 * 1000, 'CW_NOW must drive the age, not the wall clock');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a bare-filename node is UNKNOWN, because no single mtime can answer for it', () => {
  const d = repoWith({});
  try {
    const l = liveness(graph([['bin/r.mjs', 'reads', 'rollup.json']], { composed: true }), { root: d, env: { CW_NOW: NOW } });
    assert.equal(l.stores[0].state, 'unknown');
    assert.equal(l.stores[0].lastWriteAt, null);
    assert.equal(l.summary.absent, 0, 'unknown must not be counted as absent');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a store with no writer IN THE ANALYSED SET is flagged separately from absent', () => {
  const d = repoWith({ 'reports/external.json': '{}' });
  try {
    const l = liveness(graph([['bin/r.mjs', 'reads', 'reports/external.json']]), { root: d, env: { CW_NOW: NOW } });
    assert.equal(l.stores[0].state, 'present', 'it is on disk');
    assert.equal(l.stores[0].findings.noProducerInSet, true, 'and nothing here writes it — a different fact');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('liveness is a question about READERS — a write-only artifact is not listed', () => {
  const d = repoWith({ 'reports/out.json': '{}' });
  try {
    const l = liveness(graph([['bin/w.mjs', 'writes', 'reports/out.json']]), { root: d, env: { CW_NOW: NOW } });
    assert.deepEqual(l.stores, [], 'nothing consumes it, so no consumer assumes anything about it');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('CW_NOW is read at CALL time', () => {
  const d = repoWith({ 'reports/s.json': '{}' });
  try {
    const g = graph([['bin/r.mjs', 'reads', 'reports/s.json']]);
    const a = liveness(g, { root: d, env: { CW_NOW: '2026-01-01T00:00:00.000Z' } });
    const b = liveness(g, { root: d, env: { CW_NOW: '2027-01-01T00:00:00.000Z' } });
    assert.notEqual(a.generatedAt, b.generatedAt);
    assert.notEqual(a.stores[0].ageMs, b.stores[0].ageMs);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
