// Reads in-flight sweep markers from a reports tree, separating valid, unreadable, and missing entries (monitor/sweep-health.mjs readMarkers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMarkers } from '../sweep-health.mjs';

test('returns ok false and rootUnreadable true when reportsRoot is missing', () => {
  const result = readMarkers({});
  assert.deepEqual(result, {
    ok: false,
    markers: [],
    unreadable: [{ path: null, area: null, reason: 'no reportsRoot given' }],
    rootMissing: false,
    rootUnreadable: true,
  });
});

test('returns ok true and rootMissing true when readdir throws ENOENT', () => {
  const err = new Error('no such file');
  err.code = 'ENOENT';
  const result = readMarkers({
    reportsRoot: '/root',
    readdir: () => { throw err; },
  });
  assert.deepEqual(result, {
    ok: true,
    markers: [],
    unreadable: [],
    rootMissing: true,
    rootUnreadable: false,
  });
});

test('returns ok false and rootUnreadable true when readdir throws EACCES', () => {
  const err = new Error('permission denied');
  err.code = 'EACCES';
  const result = readMarkers({
    reportsRoot: '/root',
    readdir: () => { throw err; },
  });
  assert.deepEqual(result, {
    ok: false,
    markers: [],
    unreadable: [{ path: '/root', area: null, reason: 'reports root unreadable (EACCES)' }],
    rootMissing: false,
    rootUnreadable: true,
  });
});

test('returns ok true with empty markers when readdir returns empty array', () => {
  const result = readMarkers({
    reportsRoot: '/root',
    readdir: () => [],
  });
  assert.deepEqual(result, {
    ok: true,
    markers: [],
    unreadable: [],
    rootMissing: false,
    rootUnreadable: false,
  });
});

test('skips directory when readFile throws ENOENT', () => {
  const err = new Error('no such file');
  err.code = 'ENOENT';
  const result = readMarkers({
    reportsRoot: '/root',
    readdir: () => ['area-a'],
    readFile: () => { throw err; },
  });
  assert.deepEqual(result, {
    ok: true,
    markers: [],
    unreadable: [],
    rootMissing: false,
    rootUnreadable: false,
  });
});

test('skips directory when readFile throws ENOTDIR', () => {
  const err = new Error('not a directory');
  err.code = 'ENOTDIR';
  const result = readMarkers({
    reportsRoot: '/root',
    readdir: () => ['area-a'],
    readFile: () => { throw err; },
  });
  assert.deepEqual(result, {
    ok: true,
    markers: [],
    unreadable: [],
    rootMissing: false,
    rootUnreadable: false,
  });
});

test('adds unreadable entry when readFile throws EACCES', () => {
  const err = new Error('permission denied');
  err.code = 'EACCES';
  const result = readMarkers({
    reportsRoot: '/root',
    readdir: () => ['area-a'],
    readFile: () => { throw err; },
  });
  assert.deepEqual(result, {
    ok: false,
    markers: [],
    unreadable: [{ path: '/root/area-a/.sweep-inflight.json', area: 'area-a', reason: 'marker unreadable (EACCES)' }],
    rootMissing: false,
    rootUnreadable: false,
  });
});

test('adds unreadable entry when marker JSON is unparseable', () => {
  const result = readMarkers({
    reportsRoot: '/root',
    readdir: () => ['area-a'],
    readFile: () => 'not valid json',
  });
  assert.deepEqual(result, {
    ok: false,
    markers: [],
    unreadable: [{ path: '/root/area-a/.sweep-inflight.json', area: 'area-a', reason: 'marker unparseable' }],
    rootMissing: false,
    rootUnreadable: false,
  });
});

test('adds unreadable entry when marker is an array', () => {
  const result = readMarkers({
    reportsRoot: '/root',
    readdir: () => ['area-a'],
    readFile: () => '[1,2,3]',
  });
  assert.deepEqual(result, {
    ok: false,
    markers: [],
    unreadable: [{ path: '/root/area-a/.sweep-inflight.json', area: 'area-a', reason: 'marker is not an object' }],
    rootMissing: false,
    rootUnreadable: false,
  });
});

test('adds marker with area from JSON and areaOut from directory', () => {
  const result = readMarkers({
    reportsRoot: '/root',
    readdir: () => ['team-a-monorepo'],
    readFile: () => JSON.stringify({ area: 'team-a', status: 'running' }),
  });
  assert.deepEqual(result, {
    ok: true,
    markers: [{ area: 'team-a', status: 'running', areaOut: 'team-a-monorepo', path: '/root/team-a-monorepo/.sweep-inflight.json' }],
    unreadable: [],
    rootMissing: false,
    rootUnreadable: false,
  });
});
