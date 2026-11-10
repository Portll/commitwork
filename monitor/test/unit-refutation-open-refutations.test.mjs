// Returns open refutations sorted by filedAt (monitor/refutation.mjs openRefutations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openRefutations } from '../refutation.mjs';

test('returns empty array when refutations is undefined', () => {
  const result = openRefutations({});
  assert.deepEqual(result, []);
});

test('returns empty array when refutations is null', () => {
  const result = openRefutations({ refutations: null });
  assert.deepEqual(result, []);
});

test('returns empty array when refutations is empty object', () => {
  const result = openRefutations({ refutations: {} });
  assert.deepEqual(result, []);
});

test('returns open refutations sorted by filedAt ascending', () => {
  const doc = {
    refutations: {
      a: { state: 'open', filedAt: '2024-01-02' },
      b: { state: 'open', filedAt: '2024-01-01' },
      c: { state: 'open', filedAt: '2024-01-03' }
    }
  };
  const result = openRefutations(doc);
  assert.deepEqual(result, [{ state: "open", filedAt: "2024-01-01" }, { state: "open", filedAt: "2024-01-02" }, { state: "open", filedAt: "2024-01-03" }]);
});

test('excludes refutations that are not open', () => {
  const doc = {
    refutations: {
      a: { state: 'closed', filedAt: '2024-01-01' },
      b: { state: 'open', filedAt: '2024-01-02' },
      c: { state: 'resolved', filedAt: '2024-01-03' }
    }
  };
  const result = openRefutations(doc);
  assert.deepEqual(result, [{ state: "open", filedAt: "2024-01-02" }]);
});

test('returns empty array when all refutations are closed', () => {
  const doc = {
    refutations: {
      a: { state: 'closed', filedAt: '2024-01-01' },
      b: { state: 'resolved', filedAt: '2024-01-02' }
    }
  };
  const result = openRefutations(doc);
  assert.deepEqual(result, []);
});

test('handles refutations with missing state property', () => {
  const doc = {
    refutations: {
      a: { filedAt: '2024-01-01' },
      b: { state: 'open', filedAt: '2024-01-02' }
    }
  };
  const result = openRefutations(doc);
  assert.deepEqual(result, [{ state: "open", filedAt: "2024-01-02" }]);
});

test('sorts refutations with equal filedAt stably', () => {
  const doc = {
    refutations: {
      a: { state: 'open', filedAt: '2024-01-01' },
      b: { state: 'open', filedAt: '2024-01-01' },
      c: { state: 'open', filedAt: '2024-01-01' }
    }
  };
  const result = openRefutations(doc);
  assert.deepEqual(result, [{ state: "open", filedAt: "2024-01-01" }, { state: "open", filedAt: "2024-01-01" }, { state: "open", filedAt: "2024-01-01" }]);
});
