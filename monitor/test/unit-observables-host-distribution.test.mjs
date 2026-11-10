// Reference counts per domain host, most referenced first (monitor/observables.mjs hostDistribution).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostDistribution } from '../observables.mjs';

const domain = (value, occurrences) => ({ type: 'domain', value, occurrences });

test('an empty corpus gives an empty array', () => {
  assert.deepEqual(hostDistribution([]), []);
});

test('a corpus with no domain observables gives an empty array', () => {
  const corpus = [
    { type: 'url', value: 'x.example', occurrences: 4 },
    { type: 'ip', value: '10.0.0.1' }
  ];
  assert.deepEqual(hostDistribution(corpus), []);
});

test('only domain observables count when another type shares the host', () => {
  const corpus = [
    domain('shared.example', 2),
    { type: 'url', value: 'shared.example', occurrences: 7 }
  ];
  assert.deepEqual(hostDistribution(corpus), [{ host: 'shared.example', references: 2 }]);
});

test('a domain without occurrences counts as one reference each time it appears', () => {
  assert.deepEqual(hostDistribution([domain('solo.example')]), [
    { host: 'solo.example', references: 1 }
  ]);
  const repeated = Array.from({ length: 3 }, () => domain('a.example'));
  assert.deepEqual(hostDistribution(repeated), [{ host: 'a.example', references: 3 }]);
});

test('explicit occurrences are summed for a repeated host', () => {
  assert.deepEqual(hostDistribution([domain('b.example', 2), domain('b.example', 3)]), [
    { host: 'b.example', references: 5 }
  ]);
  assert.deepEqual(hostDistribution([domain('m.example', 4), domain('m.example')]), [
    { host: 'm.example', references: 5 }
  ]);
});

test('zero occurrences counts as one reference', () => {
  assert.deepEqual(hostDistribution([domain('c.example', 0), domain('c.example', 0)]), [
    { host: 'c.example', references: 2 }
  ]);
});

test('a higher count comes first even when its host sorts later', () => {
  assert.deepEqual(hostDistribution([domain('a.example', 2), domain('b.example', 3)]), [
    { host: 'b.example', references: 3 },
    { host: 'a.example', references: 2 }
  ]);
  const corpus = [domain('a.example', 1), domain('z.example', 5), domain('m.example', 3)];
  assert.deepEqual(hostDistribution(corpus), [
    { host: 'z.example', references: 5 },
    { host: 'm.example', references: 3 },
    { host: 'a.example', references: 1 }
  ]);
});

test('hosts with equal counts sort ascending whatever the insertion order', () => {
  const corpus = [domain('z.example', 2), domain('a.example', 2), domain('m.example', 2)];
  assert.deepEqual(hostDistribution(corpus), [
    { host: 'a.example', references: 2 },
    { host: 'm.example', references: 2 },
    { host: 'z.example', references: 2 }
  ]);
  assert.deepEqual(hostDistribution([domain('a.example'), domain('b.example')]), [
    { host: 'a.example', references: 1 },
    { host: 'b.example', references: 1 }
  ]);
});

test('a mixed corpus orders by count and then by host', () => {
  const corpus = [
    domain('b.example', 2),
    domain('c.example'),
    domain('a.example', 2),
    domain('c.example', 2),
    { type: 'ip', value: 'b.example', occurrences: 9 },
    domain('d.example')
  ];
  assert.deepEqual(hostDistribution(corpus), [
    { host: 'c.example', references: 3 },
    { host: 'a.example', references: 2 },
    { host: 'b.example', references: 2 },
    { host: 'd.example', references: 1 }
  ]);
});

test('tied hosts that are neither lower nor higher than each other keep insertion order', () => {
  assert.deepEqual(hostDistribution([domain(1), domain('1')]), [
    { host: 1, references: 1 },
    { host: '1', references: 1 }
  ]);
});
