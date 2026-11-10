// Tallies fetch result statuses and cache problems (bin/lib/wp-source.mjs tally).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally } from '../lib/wp-source.mjs';

test('returns all zeros for an empty results array', () => {
  assert.deepEqual(tally([]), { network: 0, cache: 0, staleCache: 0, file: 0, failed: 0, cacheWriteFailures: 0 });
});

test('counts a network result as network', () => {
  assert.deepEqual(tally([{ via: 'network' }]), { network: 1, cache: 0, staleCache: 0, file: 0, failed: 0, cacheWriteFailures: 0 });
});

test('counts a cache result as cache', () => {
  assert.deepEqual(tally([{ via: 'cache' }]), { network: 0, cache: 1, staleCache: 0, file: 0, failed: 0, cacheWriteFailures: 0 });
});

test('counts a stale-cache result as staleCache', () => {
  assert.deepEqual(tally([{ via: 'stale-cache' }]), { network: 0, cache: 0, staleCache: 1, file: 0, failed: 0, cacheWriteFailures: 0 });
});

test('counts a file result as file', () => {
  assert.deepEqual(tally([{ via: 'file' }]), { network: 0, cache: 0, staleCache: 0, file: 1, failed: 0, cacheWriteFailures: 0 });
});

test('counts an error status as failed', () => {
  assert.deepEqual(tally([{ status: 'error' }]), { network: 0, cache: 0, staleCache: 0, file: 0, failed: 1, cacheWriteFailures: 0 });
});

test('counts a cacheProblem flag as cacheWriteFailures', () => {
  assert.deepEqual(tally([{ via: 'network', cacheProblem: true }]), { network: 1, cache: 0, staleCache: 0, file: 0, failed: 0, cacheWriteFailures: 1 });
});

test('skips null entries without incrementing any counter', () => {
  assert.deepEqual(tally([null]), { network: 0, cache: 0, staleCache: 0, file: 0, failed: 0, cacheWriteFailures: 0 });
});

test('tallies a mixed batch of results', () => {
  const results = [
    { via: 'network' },
    { via: 'cache' },
    { via: 'stale-cache' },
    { via: 'file' },
    { status: 'error' },
    { via: 'network', cacheProblem: true },
    null,
  ];
  assert.deepEqual(tally(results), { network: 2, cache: 1, staleCache: 1, file: 1, failed: 1, cacheWriteFailures: 1 });
});
