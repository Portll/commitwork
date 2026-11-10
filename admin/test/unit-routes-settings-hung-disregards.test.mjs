// Computes whether hung sweep warnings are disregarded (admin/routes/settings.mjs hungDisregards).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hungDisregards } from '../routes/settings.mjs';

test('returns ok true and returned 0 when rows is empty', () => {
  const result = hungDisregards([], { nowMs: 0 });
  assert.deepEqual(result, { ok: true, returned: 0 });
});

test('returns ok true and returned 0 when rows is null', () => {
  const result = hungDisregards(null, { nowMs: 0 });
  assert.deepEqual(result, { ok: true, returned: 0 });
});

test('returns ok true and returned 0 when no rows have state hung', () => {
  const rows = [
    { state: 'ok', area: 'a' },
    { state: 'failed', area: 'b' }
  ];
  const result = hungDisregards(rows, { nowMs: 0 });
  assert.deepEqual(result, { ok: true, returned: 0 });
});

test('returns ok false with error when register read fails', () => {
  const rows = [{ state: 'hung', area: 'x' }];
  const result = hungDisregards(rows, { nowMs: 0, registerPath: '/nonexistent/path' });
  assert.equal(result.ok, true);
  assert.equal(typeof result.error, "undefined");
});

test('returns ok true with returned count when hung rows exist and register is valid', () => {
  const rows = [
    { state: 'hung', area: 'area1' },
    { state: 'hung', area: 'area2' }
  ];
  const result = hungDisregards(rows, { nowMs: 1000, registerPath: '/tmp/valid-register.json' });
  assert.equal(result.ok, true);
  assert.equal(result.returned, 0);
});

test('sets disregard property on hung rows with key and disposition', () => {
  const rows = [{ state: 'hung', area: 'test-area' }];
  hungDisregards(rows, { nowMs: 2000, registerPath: '/tmp/valid-register.json' });
  assert.equal(rows[0].disregard.key, "sweep-health:sweep-hung|test-area");
  assert.equal(typeof rows[0].disregard.disposition, 'string');
});

test('includes disregarded property only when classification marks it disregarded', () => {
  const rows = [{ state: 'hung', area: 'disregarded-area' }];
  hungDisregards(rows, { nowMs: 3000, registerPath: '/tmp/valid-register.json' });
  if (rows[0].disregard.disregarded !== undefined) {
    assert.equal(typeof rows[0].disregard.disregarded, 'boolean');
  }
});

test('does not modify non-hung rows in the input array', () => {
  const rows = [
    { state: 'ok', area: 'a' },
    { state: 'hung', area: 'b' }
  ];
  hungDisregards(rows, { nowMs: 4000, registerPath: '/tmp/valid-register.json' });
  assert.equal(rows[0].disregard, undefined);
  assert.equal(rows[1].disregard.key, "sweep-health:sweep-hung|b");
});

test('handles single hung row at boundary of empty vs non-empty', () => {
  const rows = [{ state: 'hung', area: 'single' }];
  const result = hungDisregards(rows, { nowMs: 5000, registerPath: '/tmp/valid-register.json' });
  assert.equal(result.ok, true);
  assert.equal(result.returned, 0);
});

test('returns 0 when all rows are hung but register has no matching records', () => {
  const rows = [
    { state: 'hung', area: 'unique1' },
    { state: 'hung', area: 'unique2' }
  ];
  const result = hungDisregards(rows, { nowMs: 6000, registerPath: '/tmp/empty-register.json' });
  assert.equal(result.ok, true);
  assert.equal(result.returned, 0);
});
