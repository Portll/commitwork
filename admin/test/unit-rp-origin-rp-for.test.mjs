// Resolves the relying-party identity and allowed origins for a request (admin/rp-origin.mjs rpFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpFor } from '../rp-origin.mjs';

test('returns null rpId and empty origins for undeclared non-loopback host', () => {
  const req = { headers: { host: 'example.com' } };
  const result = rpFor(req);
  assert.deepEqual(result, { rpId: null, origins: [] });
});

test('returns localhost rpId with http origin when host is localhost with port', () => {
  const req = { headers: { host: 'localhost:3000' } };
  const result = rpFor(req);
  assert.equal(result.rpId, 'localhost');
  assert.deepEqual(result.origins, ['http://localhost:3000']);
});

test('returns 127.0.0.1 rpId with http origin when host is 127.0.0.1 with port', () => {
  const req = { headers: { host: '127.0.0.1:8080' } };
  const result = rpFor(req);
  assert.equal(result.rpId, '127.0.0.1');
  assert.deepEqual(result.origins, ['http://127.0.0.1:8080']);
});

test('returns ::1 rpId with http origin when host is [::1] with port', () => {
  const req = { headers: { host: '[::1]:4000' } };
  const result = rpFor(req);
  assert.equal(result.rpId, '::1');
  assert.deepEqual(result.origins, ['http://[::1]:4000']);
});

test('returns localhost rpId with multiple origins when ports array is provided', () => {
  const req = { headers: { host: 'localhost:3000' } };
  const result = rpFor(req, { ports: [3000, 3001] });
  assert.equal(result.rpId, 'localhost');
  assert.deepEqual(result.origins, ['http://localhost:3000', 'http://localhost:3001']);
});

test('returns 127.0.0.1 rpId with multiple origins when ports array is provided', () => {
  const req = { headers: { host: '127.0.0.1:8080' } };
  const result = rpFor(req, { ports: [8080, 8081] });
  assert.equal(result.rpId, '127.0.0.1');
  assert.deepEqual(result.origins, ['http://127.0.0.1:8080', 'http://127.0.0.1:8081']);
});

test('returns ::1 rpId with multiple origins when ports array is provided', () => {
  const req = { headers: { host: '[::1]:4000' } };
  const result = rpFor(req, { ports: [4000, 4001] });
  assert.equal(result.rpId, '::1');
  assert.deepEqual(result.origins, ['http://[::1]:4000', 'http://[::1]:4001']);
});

test('returns null rpId and empty origins when req is null', () => {
  const result = rpFor(null);
  assert.deepEqual(result, { rpId: null, origins: [] });
});

test('returns null rpId and empty origins when req has no headers', () => {
  const result = rpFor({});
  assert.deepEqual(result, { rpId: null, origins: [] });
});

test('returns null rpId and empty origins when host header is empty string', () => {
  const req = { headers: { host: '' } };
  const result = rpFor(req);
  assert.deepEqual(result, { rpId: null, origins: [] });
});
