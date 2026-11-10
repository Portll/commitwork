// Classifies an HTTP probe response into an observed auth state (monitor/port-bind.mjs probeAuth).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeAuth } from '../port-bind.mjs';

test('returns absent when the connection is refused', async () => {
  const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8080'), { code: 'ECONNREFUSED' });
  const fetchImpl = async () => { throw err; };
  const r = await probeAuth(8080, '/health', { fetchImpl });
  assert.deepEqual(r, { observed: "absent" });
});

test('returns tool-failed when the connection fails with a non-refusal code', async () => {
  const err = Object.assign(new Error('connect ETIMEDOUT 127.0.0.1:8080'), { code: 'ETIMEDOUT' });
  const fetchImpl = async () => { throw err; };
  const r = await probeAuth(8080, '/health', { fetchImpl });
  assert.deepEqual(r, { observed: null, unknown: true, unknownReason: "tool-failed", unknownDetail: "probe ETIMEDOUT" });
});

test('returns challenged with status 401 when the server demands auth', async () => {
  const fetchImpl = async () => ({ status: 401, headers: { get: () => null } });
  const r = await probeAuth(8080, '/health', { fetchImpl });
  assert.deepEqual(r, { observed: "challenged", status: 401 });
});

test('returns challenged with status 403 when the server forbids access', async () => {
  const fetchImpl = async () => ({ status: 403, headers: { get: () => null } });
  const r = await probeAuth(8080, '/health', { fetchImpl });
  assert.deepEqual(r, { observed: "challenged", status: 403 });
});

test('returns challenged with status 407 when the server demands proxy auth', async () => {
  const fetchImpl = async () => ({ status: 407, headers: { get: () => null } });
  const r = await probeAuth(8080, '/health', { fetchImpl });
  assert.deepEqual(r, { observed: "challenged", status: 407 });
});

test('returns challenged with redirect when the server responds 301', async () => {
  const fetchImpl = async () => ({ status: 301, headers: { get: (k) => k === 'location' ? '/login' : null } });
  const r = await probeAuth(8080, '/health', { fetchImpl });
  assert.deepEqual(r, { observed: "challenged", status: 301, redirect: "/login" });
});

test('returns open with status 200 when the server responds successfully', async () => {
  const fetchImpl = async () => ({ status: 200, headers: { get: () => null } });
  const r = await probeAuth(8080, '/health', { fetchImpl });
  assert.deepEqual(r, { observed: "open", status: 200 });
});

test('returns no-subject when the server responds 404', async () => {
  const fetchImpl = async () => ({ status: 404, headers: { get: () => null } });
  const r = await probeAuth(8080, '/health', { fetchImpl });
  assert.deepEqual(r, { observed: null, status: 404, unknown: true, unknownReason: "no-subject", unknownDetail: "probePath /health answers 404" });
});

test('returns unstated when the server responds 500', async () => {
  const fetchImpl = async () => ({ status: 500, headers: { get: () => null } });
  const r = await probeAuth(8080, '/health', { fetchImpl });
  assert.deepEqual(r, { observed: null, status: 500, unknown: true, unknownReason: "unstated", unknownDetail: "status 500" });
});
