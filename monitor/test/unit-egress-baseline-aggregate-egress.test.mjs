// Per-executable egress peer summaries plus unknowns for vanished pids (monitor/egress-baseline.mjs aggregateEgress).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateEgress } from '../egress-baseline.mjs';

const row = (pid, port, address, proto = 'tcp') => ({ pid, remote: { port, address }, proto });

test('returns empty items and unknowns when there are no rows', () => {
  assert.deepEqual(aggregateEgress([], new Map()), { items: [], unknowns: [] });
});

test('reports a row as unknown when its pid is missing from the ps table', () => {
  const r = aggregateEgress([row(999, 80, '1.2.3.4')], new Map());
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.unknowns.map((u) => u.id), ['pid:999']);
});

test('counts known pids and reports absent or empty ps entries as unknowns', () => {
  const rows = [row(1, 80, '1.2.3.4'), row(999, 443, '5.6.7.8'), row(5, 443, '5.6.7.9')];
  const r = aggregateEgress(rows, new Map([[1, 'nginx'], [5, '']]));
  assert.deepEqual(r.items, [
    { id: 'nginx', kind: 'egress-peer', ports: ['80'], portHistogram: { '80': 1 }, connections: 1, remotes: 1, protos: ['tcp'] },
  ]);
  assert.deepEqual(r.unknowns.map((u) => u.id), ['pid:999', 'pid:5']);
});

test('summarises a single row for a known process', () => {
  const r = aggregateEgress([row(1, 80, '1.2.3.4')], new Map([[1, 'nginx']]));
  assert.deepEqual(r, {
    items: [
      { id: 'nginx', kind: 'egress-peer', ports: ['80'], portHistogram: { '80': 1 }, connections: 1, remotes: 1, protos: ['tcp'] },
    ],
    unknowns: [],
  });
});

test('accumulates connections and per-port counts across rows of one process', () => {
  const rows = [row(1, 80, '1.2.3.4'), row(1, 80, '1.2.3.5'), row(1, 443, '1.2.3.6')];
  const r = aggregateEgress(rows, new Map([[1, 'nginx']]));
  assert.deepEqual(r, {
    items: [
      { id: 'nginx', kind: 'egress-peer', ports: ['443', '80'], portHistogram: { '443': 1, '80': 2 }, connections: 3, remotes: 3, protos: ['tcp'] },
    ],
    unknowns: [],
  });
});

test('merges different pids that run the same executable', () => {
  const rows = [row(1, 80, '1.2.3.4'), row(2, 80, '1.2.3.5')];
  const r = aggregateEgress(rows, new Map([[1, 'nginx'], [2, 'nginx']]));
  assert.deepEqual(r, {
    items: [
      { id: 'nginx', kind: 'egress-peer', ports: ['80'], portHistogram: { '80': 2 }, connections: 2, remotes: 2, protos: ['tcp'] },
    ],
    unknowns: [],
  });
});

test('sorts items by executable regardless of the order rows arrive in', () => {
  const rows = [row(1, 80, '1.2.3.4'), row(2, 443, '5.6.7.8')];
  const r = aggregateEgress(rows, new Map([[1, 'nginx'], [2, 'curl']]));
  assert.deepEqual(r, {
    items: [
      { id: 'curl', kind: 'egress-peer', ports: ['443'], portHistogram: { '443': 1 }, connections: 1, remotes: 1, protos: ['tcp'] },
      { id: 'nginx', kind: 'egress-peer', ports: ['80'], portHistogram: { '80': 1 }, connections: 1, remotes: 1, protos: ['tcp'] },
    ],
    unknowns: [],
  });
});

test('counts a repeated remote once and lists each protocol once in sorted order', () => {
  const rows = [row(1, 80, '1.2.3.4', 'udp'), row(1, 80, '1.2.3.4', 'tcp'), row(1, 80, '1.2.3.4', 'tcp')];
  const r = aggregateEgress(rows, new Map([[1, 'nginx']]));
  assert.deepEqual(r, {
    items: [
      { id: 'nginx', kind: 'egress-peer', ports: ['80'], portHistogram: { '80': 3 }, connections: 3, remotes: 1, protos: ['tcp', 'udp'] },
    ],
    unknowns: [],
  });
});

test('classifies numbered, ephemeral and unnumbered ports and orders the histogram keys', () => {
  const rows = [row(1, null, '1.2.3.4'), row(1, NaN, '1.2.3.5'), row(1, 65000, '1.2.3.6'), row(1, 80, '1.2.3.7')];
  const r = aggregateEgress(rows, new Map([[1, 'nginx']]));
  assert.deepEqual(r, {
    items: [
      {
        id: 'nginx',
        kind: 'egress-peer',
        ports: ['80', 'ephemeral', 'unnumbered'],
        portHistogram: { '80': 1, ephemeral: 1, unnumbered: 2 },
        connections: 4,
        remotes: 4,
        protos: ['tcp'],
      },
    ],
    unknowns: [],
  });
  assert.deepEqual(Object.keys(r.items[0].portHistogram), ['80', 'ephemeral', 'unnumbered']);
});

test('keeps first-seen order for distinct ids that compare as equal', () => {
  const ps = new Map([[1, 7], [2, '7']]);
  const ids = (rows) => aggregateEgress(rows, ps).items.map((i) => i.id);
  assert.deepEqual(ids([row(1, 80, '1.2.3.4'), row(2, 80, '1.2.3.4')]), [7, '7']);
  assert.deepEqual(ids([row(2, 80, '1.2.3.4'), row(1, 80, '1.2.3.4')]), ['7', 7]);
});
