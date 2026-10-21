// Posts a request to a delivery destination and reports whether it was delivered, with timeout and error scrubbing (bin/digest-deliver.mjs post).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { post } from '../digest-deliver.mjs';

test('returns ok true for 200 status', async () => {
  const fetchImpl = async () => ({ status: 200, statusText: 'OK', body: null });
  const dest = { url: 'https://example.com/hook' };
  const req = { headers: {}, body: '{}' };
  const result = await post(dest, req, { fetchImpl });
  assert.deepEqual(result, { ok: true, status: 200, reason: null });
});

test('returns ok true for 299 status', async () => {
  const fetchImpl = async () => ({ status: 299, statusText: '', body: null });
  const dest = { url: 'https://example.com/hook' };
  const req = { headers: {}, body: '{}' };
  const result = await post(dest, req, { fetchImpl });
  assert.deepEqual(result, { ok: true, status: 299, reason: null });
});

test('returns ok false for 199 status', async () => {
  const fetchImpl = async () => ({ status: 199, statusText: '', body: null });
  const dest = { url: 'https://example.com/hook' };
  const req = { headers: {}, body: '{}' };
  const result = await post(dest, req, { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 199);
  assert.equal(result.reason, 'HTTP 199');
});

test('returns ok false for 300 status', async () => {
  const fetchImpl = async () => ({ status: 300, statusText: 'Multiple Choices', body: null });
  const dest = { url: 'https://example.com/hook' };
  const req = { headers: {}, body: '{}' };
  const result = await post(dest, req, { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 300);
  assert.equal(result.reason, 'HTTP 300 Multiple Choices');
});

test('returns ok false with timeout reason on TimeoutError', async () => {
  const err = new Error('timeout');
  err.name = 'TimeoutError';
  const fetchImpl = async () => { throw err; };
  const dest = { url: 'https://example.com/hook' };
  const req = { headers: {}, body: '{}' };
  const result = await post(dest, req, { fetchImpl, timeoutMs: 5000 });
  assert.deepEqual(result, { ok: false, status: null, reason: 'timeout after 5000ms' });
});

test('returns ok false with timeout reason on AbortError', async () => {
  const err = new Error('aborted');
  err.name = 'AbortError';
  const fetchImpl = async () => { throw err; };
  const dest = { url: 'https://example.com/hook' };
  const req = { headers: {}, body: '{}' };
  const result = await post(dest, req, { fetchImpl, timeoutMs: 1000 });
  assert.deepEqual(result, { ok: false, status: null, reason: 'timeout after 1000ms' });
});

test('returns ok false with network reason including cause code', async () => {
  const err = new Error('fetch failed');
  err.cause = { code: 'ECONNREFUSED' };
  const fetchImpl = async () => { throw err; };
  const dest = { url: 'https://example.com/hook' };
  const req = { headers: {}, body: '{}' };
  const result = await post(dest, req, { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.equal(result.reason, 'network: ECONNREFUSED');
});

test('returns ok false with network reason including cause message', async () => {
  const err = new Error('fetch failed');
  err.cause = { message: 'socket hang up' };
  const fetchImpl = async () => { throw err; };
  const dest = { url: 'https://example.com/hook' };
  const req = { headers: {}, body: '{}' };
  const result = await post(dest, req, { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.equal(result.reason, 'network: socket hang up');
});

test('returns ok false with network reason from error message when no cause', async () => {
  const err = new Error('connection reset');
  const fetchImpl = async () => { throw err; };
  const dest = { url: 'https://example.com/hook' };
  const req = { headers: {}, body: '{}' };
  const result = await post(dest, req, { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.equal(result.reason, 'network: connection reset');
});

test('scrubs URL from reason when URL appears in status text', async () => {
  const fetchImpl = async () => ({ status: 500, statusText: 'error at https://example.com/hook', body: null });
  const dest = { url: 'https://example.com/hook' };
  const req = { headers: {}, body: '{}' };
  const result = await post(dest, req, { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.reason, 'HTTP 500 error at /\u2026');
});
