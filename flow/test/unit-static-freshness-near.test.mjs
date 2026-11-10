// Finds the first freshness-check marker from 200 chars before to 400 chars after a position (flow/static.mjs freshnessNear).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshnessNear } from '../static.mjs';

test('returns null when the window holds no freshness marker', () => {
  const masked = ' '.repeat(500);
  assert.equal(freshnessNear(masked, 250), null);
});

test('reports a marker sitting at index zero when the position is zero', () => {
  const masked = 'maxAge' + ' '.repeat(10);
  assert.deepEqual(freshnessNear(masked, 0), { checks: true, marker: 'maxAge' });
});

test('keeps index zero in the window when the position is exactly 200', () => {
  const masked = 'maxAge' + ' '.repeat(600);
  assert.deepEqual(freshnessNear(masked, 200), { checks: true, marker: 'maxAge' });
});

test('drops index zero from the window when the position is 201', () => {
  const masked = 'maxAge' + ' '.repeat(600);
  assert.equal(freshnessNear(masked, 201), null);
});

test('finds a marker that starts exactly 200 chars before the position', () => {
  const masked = ' '.repeat(100) + 'ageDays' + ' '.repeat(500);
  assert.deepEqual(freshnessNear(masked, 300), { checks: true, marker: 'ageDays' });
});

test('misses a marker that starts 201 chars before the position', () => {
  const masked = ' '.repeat(100) + 'ageDays' + ' '.repeat(500);
  assert.equal(freshnessNear(masked, 301), null);
});

test('finds a marker that ends exactly 400 chars after the position', () => {
  const masked = ' '.repeat(400) + 'ttl' + ' '.repeat(10);
  assert.deepEqual(freshnessNear(masked, 3), { checks: true, marker: 'ttl' });
});

test('misses a marker cut off by the right edge of the window', () => {
  const masked = ' '.repeat(400) + 'ttl' + ' '.repeat(10);
  assert.equal(freshnessNear(masked, 2), null);
});

test('does not count ttl when it runs into a longer word', () => {
  assert.equal(freshnessNear(' ttls ', 0), null);
});

test('reports STALE even when it is embedded inside an identifier', () => {
  assert.deepEqual(freshnessNear('const isSTALE = 1', 0), { checks: true, marker: 'STALE' });
});
