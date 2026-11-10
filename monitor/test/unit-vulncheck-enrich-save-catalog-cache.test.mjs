// Caches an ok KEV fetch as two-space JSON and returns its path and entry count (monitor/vulncheck-enrich.mjs saveCatalogCache).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveCatalogCache } from '../vulncheck-enrich.mjs';

const captureStringify = () => {
  const original = JSON.stringify;
  JSON.stringify = (...args) => {
    JSON.stringify = original;
    throw new Error(original(...args));
  };
  return () => {
    JSON.stringify = original;
  };
};

test('A state of error is refused with a message naming the state', () => {
  const input = { state: 'error', fetchedAt: '2024-01-01T00:00:00Z', entries: [] };
  assert.throws(() => saveCatalogCache(input), {
    name: 'Error',
    message: 'refusing to cache a non-ok fetch state: error'
  });
});

test('An uppercase OK state is refused because the check is case sensitive', () => {
  const input = { state: 'OK', fetchedAt: '2024-01-01T00:00:00Z', entries: [{ id: 1 }] };
  assert.throws(() => saveCatalogCache(input), {
    name: 'Error',
    message: 'refusing to cache a non-ok fetch state: OK'
  });
});

test('A null state is refused and the message prints null', () => {
  const input = { state: null, fetchedAt: '2024-01-01T00:00:00Z', entries: [] };
  assert.throws(() => saveCatalogCache(input), {
    name: 'Error',
    message: 'refusing to cache a non-ok fetch state: null'
  });
});

test('A missing state is refused before the entries are read', () => {
  const input = {};
  assert.throws(() => saveCatalogCache(input), {
    name: 'Error',
    message: 'refusing to cache a non-ok fetch state: undefined'
  });
});

test('An ok result with one entry is serialized with two-space indentation', () => {
  const input = { state: 'ok', fetchedAt: '2024-06-15T12:30:00Z', entries: [{ cve: 'CVE-2024-0001' }] };
  const expectedText = [
    '{',
    '  "fetchedAt": "2024-06-15T12:30:00Z",',
    '  "entries": [',
    '    {',
    '      "cve": "CVE-2024-0001"',
    '    }',
    '  ]',
    '}'
  ].join('\n');
  const restore = captureStringify();
  try {
    assert.throws(() => saveCatalogCache(input), { name: 'Error', message: expectedText });
  } finally {
    restore();
  }
});

test('An ok result with no entries is serialized with an empty entries array', () => {
  const input = { state: 'ok', fetchedAt: '2024-01-01T00:00:00Z', entries: [] };
  const expectedText = [
    '{',
    '  "fetchedAt": "2024-01-01T00:00:00Z",',
    '  "entries": []',
    '}'
  ].join('\n');
  const restore = captureStringify();
  try {
    assert.throws(() => saveCatalogCache(input), { name: 'Error', message: expectedText });
  } finally {
    restore();
  }
});

test('An ok result without fetchedAt omits that key and keeps only entries', () => {
  const input = { state: 'ok', entries: [1, 2] };
  const expectedText = [
    '{',
    '  "entries": [',
    '    1,',
    '    2',
    '  ]',
    '}'
  ].join('\n');
  const restore = captureStringify();
  try {
    assert.throws(() => saveCatalogCache(input), { name: 'Error', message: expectedText });
  } finally {
    restore();
  }
});
