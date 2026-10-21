// Resolves admin session or operator port fallback (admin/lib/route-auth.mjs requireSession).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireSession } from '../lib/route-auth.mjs';

test('returns operator-port user when operatorPort is true and request is loopback', () => {
  const ctx = { isLoopbackReq: true, adminSession: () => ({ user: 'admin' }), req: {} };
  const result = requireSession(ctx, { operatorPort: true });
  assert.deepEqual(result, { user: 'operator-port' });
});

test('returns null when operatorPort is true but request is not loopback and no session', () => {
  const ctx = { isLoopbackReq: false, adminSession: () => null, req: {} };
  const result = requireSession(ctx, { operatorPort: true });
  assert.equal(result, null);
});

test('returns session object when operatorPort is false and valid session exists', () => {
  const ctx = { isLoopbackReq: true, adminSession: () => ({ user: 'admin' }), req: {} };
  const result = requireSession(ctx, { operatorPort: false });
  assert.deepEqual(result, { user: 'admin' });
});

test('returns null when operatorPort is false and session is null', () => {
  const ctx = { isLoopbackReq: true, adminSession: () => null, req: {} };
  const result = requireSession(ctx, { operatorPort: false });
  assert.equal(result, null);
});

test('returns null when operatorPort is false and session has no user property', () => {
  const ctx = { isLoopbackReq: true, adminSession: () => ({ name: 'admin' }), req: {} };
  const result = requireSession(ctx, { operatorPort: false });
  assert.equal(result, null);
});

test('returns null when adminSession is not a function and operatorPort is false', () => {
  const ctx = { isLoopbackReq: true, adminSession: 'not-a-function', req: {} };
  const result = requireSession(ctx, { operatorPort: false });
  assert.equal(result, null);
});

test('returns operator-port user when operatorPort is true and isLoopbackReq is strictly true', () => {
  const ctx = { isLoopbackReq: true, adminSession: () => ({ user: 'admin' }), req: {} };
  const result = requireSession(ctx, { operatorPort: true });
  assert.deepEqual(result, { user: 'operator-port' });
});

test('returns session when operatorPort is true and isLoopbackReq is truthy but not strictly true', () => {
  const ctx = { isLoopbackReq: 1, adminSession: () => ({ user: 'admin' }), req: {} };
  const result = requireSession(ctx, { operatorPort: true });
  assert.deepEqual(result, { user: 'admin' });
});

test('returns session when options object is omitted and valid session exists', () => {
  const ctx = { isLoopbackReq: true, adminSession: () => ({ user: 'admin' }), req: {} };
  const result = requireSession(ctx);
  assert.deepEqual(result, { user: 'admin' });
});

test('returns null when options object is omitted and no session exists', () => {
  const ctx = { isLoopbackReq: true, adminSession: () => null, req: {} };
  const result = requireSession(ctx);
  assert.equal(result, null);
});
