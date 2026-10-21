// Tests for the shared clock contract (positive and negative)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nowISO } from '../clock.mjs';

test('an unpinned clock returns the current time in canonical ISO form', () => {
  const before = Date.now();
  const at = nowISO({});
  assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Date.parse(at) >= before && Date.parse(at) <= Date.now());
});

test('a pinned clock is reformatted to canonical ISO', () => {
  assert.equal(nowISO({ CW_NOW: '2026-09-24T13:00:00Z' }), '2026-09-24T13:00:00.000Z');
  assert.equal(nowISO({ CW_NOW: '2026-01-01' }), '2026-01-01T00:00:00.000Z');
  assert.equal(nowISO({ CW_NOW: '2026-09-24T13:00:00.500Z' }), '2026-09-24T13:00:00.500Z');
});

test('canonical pinned times order correctly as strings', () => {
  const a = nowISO({ CW_NOW: '2026-09-24T13:00:00Z' });
  const b = nowISO({ CW_NOW: '2026-09-24T13:00:00.500Z' });
  assert.ok(a < b);
});

test('an unparseable pin fails closed and names the variable', () => {
  assert.throws(() => nowISO({ CW_NOW: 'yesterday' }), /CW_NOW is not a parseable timestamp: "yesterday"/);
});

test('an empty pin means unpinned', () => {
  assert.match(nowISO({ CW_NOW: '' }), /Z$/);
});

test('a context may bind its own pin variable', () => {
  assert.equal(nowISO({ CW_CRA_NOW: '2026-02-03T04:05:06Z', CW_NOW: '2020-01-01T00:00:00Z' }, 'CW_CRA_NOW'), '2026-02-03T04:05:06.000Z');
});

test('the default environment is read at call time', () => {
  const prev = process.env.CW_NOW;
  try {
    process.env.CW_NOW = '2026-05-06T07:08:09Z';
    assert.equal(nowISO(), '2026-05-06T07:08:09.000Z');
  } finally {
    if (prev === undefined) delete process.env.CW_NOW; else process.env.CW_NOW = prev;
  }
});
