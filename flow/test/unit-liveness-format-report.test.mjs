// Formats the liveness summary into a four-line human-readable report (flow/liveness.mjs formatReport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReport } from '../liveness.mjs';

test('formats a summary with all zero counts', () => {
  const input = {
    v: 1,
    generatedAt: '2024-01-01T00:00:00.000Z',
    stores: [],
    summary: {
      storesWithConsumers: 0,
      present: 0,
      absent: 0,
      unknown: 0,
      withConsumerAssumingNothing: 0,
      consumersAssumingNothing: 0,
      absentButRead: [],
    },
  };
  const expected = [
    'flow/liveness: 0 read artifacts \u2014 present 0, absent 0, unknown 0',
    '  stores with >=1 consumer that checks NO freshness  0',
    '  such consumers in total                            0',
    '  read but ABSENT on disk                            0',
  ].join('\n');
  assert.equal(formatReport(input), expected);
});

test('formats a summary with mixed present, absent, and unknown states', () => {
  const input = {
    v: 1,
    generatedAt: '2024-01-01T00:00:00.000Z',
    stores: [
      { path: 'a', state: 'present' },
      { path: 'b', state: 'absent' },
      { path: 'c', state: 'unknown' },
      { path: 'd', state: 'present' },
      { path: 'e', state: 'absent' },
    ],
    summary: {
      storesWithConsumers: 5,
      present: 2,
      absent: 2,
      unknown: 1,
      withConsumerAssumingNothing: 1,
      consumersAssumingNothing: 3,
      absentButRead: ['b', 'e'],
    },
  };
  const expected = [
    'flow/liveness: 5 read artifacts \u2014 present 2, absent 2, unknown 1',
    '  stores with >=1 consumer that checks NO freshness  1',
    '  such consumers in total                            3',
    '  read but ABSENT on disk                            2',
  ].join('\n');
  assert.equal(formatReport(input), expected);
});

test('formats a summary where all stores are present', () => {
  const input = {
    v: 1,
    generatedAt: '2024-01-01T00:00:00.000Z',
    stores: [
      { path: 'x', state: 'present' },
      { path: 'y', state: 'present' },
    ],
    summary: {
      storesWithConsumers: 2,
      present: 2,
      absent: 0,
      unknown: 0,
      withConsumerAssumingNothing: 0,
      consumersAssumingNothing: 0,
      absentButRead: [],
    },
  };
  const expected = [
    'flow/liveness: 2 read artifacts \u2014 present 2, absent 0, unknown 0',
    '  stores with >=1 consumer that checks NO freshness  0',
    '  such consumers in total                            0',
    '  read but ABSENT on disk                            0',
  ].join('\n');
  assert.equal(formatReport(input), expected);
});

test('formats a summary where all stores are absent', () => {
  const input = {
    v: 1,
    generatedAt: '2024-01-01T00:00:00.000Z',
    stores: [
      { path: 'p', state: 'absent' },
      { path: 'q', state: 'absent' },
      { path: 'r', state: 'absent' },
    ],
    summary: {
      storesWithConsumers: 3,
      present: 0,
      absent: 3,
      unknown: 0,
      withConsumerAssumingNothing: 2,
      consumersAssumingNothing: 5,
      absentButRead: ['p', 'q', 'r'],
    },
  };
  const expected = [
    'flow/liveness: 3 read artifacts \u2014 present 0, absent 3, unknown 0',
    '  stores with >=1 consumer that checks NO freshness  2',
    '  such consumers in total                            5',
    '  read but ABSENT on disk                            3',
  ].join('\n');
  assert.equal(formatReport(input), expected);
});

test('formats a summary where all stores are unknown', () => {
  const input = {
    v: 1,
    generatedAt: '2024-01-01T00:00:00.000Z',
    stores: [
      { path: 'm', state: 'unknown' },
      { path: 'n', state: 'unknown' },
    ],
    summary: {
      storesWithConsumers: 2,
      present: 0,
      absent: 0,
      unknown: 2,
      withConsumerAssumingNothing: 1,
      consumersAssumingNothing: 1,
      absentButRead: [],
    },
  };
  const expected = [
    'flow/liveness: 2 read artifacts \u2014 present 0, absent 0, unknown 2',
    '  stores with >=1 consumer that checks NO freshness  1',
    '  such consumers in total                            1',
    '  read but ABSENT on disk                            0',
  ].join('\n');
  assert.equal(formatReport(input), expected);
});

test('formats a summary with large counts', () => {
  const input = {
    v: 1,
    generatedAt: '2024-01-01T00:00:00.000Z',
    stores: [],
    summary: {
      storesWithConsumers: 100,
      present: 80,
      absent: 15,
      unknown: 5,
      withConsumerAssumingNothing: 10,
      consumersAssumingNothing: 42,
      absentButRead: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o'],
    },
  };
  const expected = [
    'flow/liveness: 100 read artifacts \u2014 present 80, absent 15, unknown 5',
    '  stores with >=1 consumer that checks NO freshness  10',
    '  such consumers in total                            42',
    '  read but ABSENT on disk                            15',
  ].join('\n');
  assert.equal(formatReport(input), expected);
});

test('formats a summary with single store and single consumer assuming nothing', () => {
  const input = {
    v: 1,
    generatedAt: '2024-01-01T00:00:00.000Z',
    stores: [
      { path: 'data/cache.json', state: 'present' },
    ],
    summary: {
      storesWithConsumers: 1,
      present: 1,
      absent: 0,
      unknown: 0,
      withConsumerAssumingNothing: 1,
      consumersAssumingNothing: 1,
      absentButRead: [],
    },
  };
  const expected = [
    'flow/liveness: 1 read artifacts \u2014 present 1, absent 0, unknown 0',
    '  stores with >=1 consumer that checks NO freshness  1',
    '  such consumers in total                            1',
    '  read but ABSENT on disk                            0',
  ].join('\n');
  assert.equal(formatReport(input), expected);
});

test('formats a summary where five stores are all absent and read', () => {
  const input = {
    v: 1,
    generatedAt: '2024-01-01T00:00:00.000Z',
    stores: [
      { path: 'a', state: 'absent' },
      { path: 'b', state: 'absent' },
      { path: 'c', state: 'absent' },
      { path: 'd', state: 'absent' },
      { path: 'e', state: 'absent' },
    ],
    summary: {
      storesWithConsumers: 5,
      present: 0,
      absent: 5,
      unknown: 0,
      withConsumerAssumingNothing: 3,
      consumersAssumingNothing: 7,
      absentButRead: ['a', 'b', 'c', 'd', 'e'],
    },
  };
  const expected = [
    'flow/liveness: 5 read artifacts \u2014 present 0, absent 5, unknown 0',
    '  stores with >=1 consumer that checks NO freshness  3',
    '  such consumers in total                            7',
    '  read but ABSENT on disk                            5',
  ].join('\n');
  assert.equal(formatReport(input), expected);
});
