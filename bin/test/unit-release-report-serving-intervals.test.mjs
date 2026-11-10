// servingIntervals computes intervals of consecutive commits per SHA (bin/release-report.mjs servingIntervals)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { servingIntervals } from '../release-report.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const input1 = {
  events: [
    { event: 'serving', at: '2024-01-01T00:00:00Z', sha: 'a' },
    { event: 'serving', at: '2024-01-02T00:00:00Z', sha: 'a' },
    { event: 'other', at: '2024-01-03T00:00:00Z', sha: 'b' },
    { event: 'serving', at: '2024-01-04T00:00:00Z', sha: 'b' },
  ],
  generated_at: '2024-01-05T00:00:00Z',
};

const input2 = {
  events: [
    { event: 'serving', at: '2024-01-01T00:00:00Z', sha: 'a' },
    { event: 'serving', at: '2024-01-02T00:00:00Z', sha: 'a' },
    { event: 'serving', at: '2024-01-03T00:00:00Z', sha: 'a' },
  ],
  generated_at: '2024-01-04T00:00:00Z',
};

const input3 = {
  events: [
    { event: 'serving', at: '2024-01-01T00:00:00Z', sha: 'a' },
    { event: 'serving', at: '2024-01-02T00:00:00Z', sha: 'b' },
  ],
  generated_at: '2024-01-03T00:00:00Z',
};

const input4 = {
  events: [
    { event: 'serving', at: '2024-01-01T00:00:00Z', sha: 'a' },
    { event: 'serving', at: '2024-01-02T00:00:00Z', sha: 'a' },
    { event: 'serving', at: '2024-01-03T00:00:00Z', sha: 'a' },
    { event: 'serving', at: '2024-01-04T00:00:00Z', sha: 'a' },
  ],
  generated_at: '2024-01-05T00:00:00Z',
};

const input5 = {
  events: [
    { event: 'serving', at: '2024-01-01T00:00:00Z', sha: 'a' },
    { event: 'serving', at: '2024-01-02T00:00:00Z', sha: 'b' },
    { event: 'serving', at: '2024-01-03T00:00:00Z', sha: 'b' },
  ],
  generated_at: '2024-01-04T00:00:00Z',
};

const input6 = {
  events: [
    { event: 'serving', at: '2024-01-01T00:00:00Z', sha: 'a' },
    { event: 'serving', at: '2024-01-02T00:00:00Z', sha: 'a' },
    { event: 'serving', at: '2024-01-03T00:00:00Z', sha: 'b' },
    { event: 'serving', at: '2024-01-04T00:00:00Z', sha: 'b' },
    { event: 'serving', at: '2024-01-05T00:00:00Z', sha: 'c' },
  ],
  generated_at: '2024-01-06T00:00:00Z',
};

test('computes intervals per SHA when events are interleaved', () => {
  const result = servingIntervals(input1);
  assert.deepEqual(result, new Map([["a", [{ from: 1704067200000, to: 1704326400000, open: false }]], ["b", [{ from: 1704326400000, to: 1704412800000, open: true }]]]));
});

test('computes single interval for contiguous events of same SHA', () => {
  const result = servingIntervals(input2);
  assert.deepEqual(result, new Map([["a", [{ from: 1704067200000, to: 1704326400000, open: true }]]]));
});

test('computes separate intervals for different SHAs', () => {
  const result = servingIntervals(input3);
  assert.deepEqual(result, new Map([["a", [{ from: 1704067200000, to: 1704153600000, open: false }]], ["b", [{ from: 1704153600000, to: 1704240000000, open: true }]]]));
});

test('computes intervals with multiple events per SHA and gap', () => {
  const result = servingIntervals(input4);
  assert.deepEqual(result, new Map([["a", [{ from: 1704067200000, to: 1704412800000, open: true }]]]));
});

test('computes intervals across three SHAs with mixed ordering', () => {
  const result = servingIntervals(input5);
  assert.deepEqual(result, new Map([["a", [{ from: 1704067200000, to: 1704153600000, open: false }]], ["b", [{ from: 1704153600000, to: 1704326400000, open: true }]]]));
});

test('computes intervals for three SHAs with final open interval', () => {
  const result = servingIntervals(input6);
  assert.deepEqual(result, new Map([["a", [{ from: 1704067200000, to: 1704240000000, open: false }]], ["b", [{ from: 1704240000000, to: 1704412800000, open: false }]], ["c", [{ from: 1704412800000, to: 1704499200000, open: true }]]]));
});
