// bin/test/probe-oracle-units.test.mjs — case tests for probeVoid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { probeVoid } from '../lib/probe-oracle.mjs';

test('returns state void and ok false', () => {
  const r = probeVoid('code', 'reason');
  assert.equal(r.state, 'void');
  assert.equal(r.ok, false);
});

test('includes code and reason', () => {
  const r = probeVoid('my-code', 'my reason');
  assert.equal(r.code, 'my-code');
  assert.equal(r.reason, 'my reason');
});

test('spreads extra properties', () => {
  const r = probeVoid('c', 'r', { status: 403, foo: 'bar' });
  assert.equal(r.status, 403);
  assert.equal(r.foo, 'bar');
});

test('extra defaults to empty object', () => {
  const r = probeVoid('c', 'r');
  assert.deepEqual(Object.keys(r), ['state', 'ok', 'code', 'reason']);
});

test('extra can override state and ok', () => {
  const r = probeVoid('c', 'r', { state: 'ok', ok: true });
  assert.equal(r.state, 'ok');
  assert.equal(r.ok, true);
});

test('returns a plain object', () => {
  const r = probeVoid('c', 'r');
  assert.equal(typeof r, 'object');
  assert.equal(r.constructor, Object);
});
