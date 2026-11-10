// whether a declared service port is listening in the host inventory (monitor/service-health.mjs portListening).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portListening } from '../service-health.mjs';

test('returns null when the port is not an integer', () => {
  assert.deepEqual(portListening('8080', { inv: { ok: true, entries: [] } }), { value: null, how: "no port could be parsed from the declared service URL" });
});

test('returns null when the inventory is missing', () => {
  assert.deepEqual(portListening(8080, {}), { value: null, how: "the host inventory is unavailable \u2014 listener state is UNKNOWN, not empty" });
});

test('returns null when the inventory is marked failed', () => {
  assert.deepEqual(portListening(8080, { inv: { ok: false, reason: 'timeout' } }), { value: null, how: "the host inventory is unavailable (timeout) \u2014 listener state is UNKNOWN, not empty" });
});

test('returns null when the inventory has no entries array', () => {
  assert.deepEqual(portListening(8080, { inv: { ok: true } }), { value: null, how: "the host inventory is unavailable \u2014 listener state is UNKNOWN, not empty" });
});

test('returns true when the port is found in the inventory entries', () => {
  assert.deepEqual(portListening(8080, { inv: { ok: true, entries: [{ port: 8080, binding: '0.0.0.0' }] } }), { value: true, how: "port 8080 is listening (0.0.0.0)" });
});

test('returns false when the port is not in the inventory entries', () => {
  assert.deepEqual(portListening(8080, { inv: { ok: true, entries: [{ port: 9090, binding: '127.0.0.1' }] } }), { value: false, how: "the host inventory lists 1 listening port(s) and 8080 is NOT among them" });
});

test('returns null when the inventory is ok but entries is not an array', () => {
  assert.deepEqual(portListening(8080, { inv: { ok: true, entries: 'not-an-array' } }), { value: null, how: "the host inventory is unavailable \u2014 listener state is UNKNOWN, not empty" });
});

test('returns true when the port matches a string port in entries', () => {
  assert.deepEqual(portListening(8080, { inv: { ok: true, entries: [{ port: '8080', binding: '0.0.0.0' }] } }), { value: true, how: "port 8080 is listening (0.0.0.0)" });
});
