// Tests for the shared route session predicate (positive and negative)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireSession, OPERATOR_PORT } from '../lib/route-auth.mjs';

const ROUTES = join(dirname(fileURLToPath(import.meta.url)), '..', 'routes');
const ctx = (session, extra = {}) => ({ req: {}, adminSession: () => session, ...extra });

test('a session with a user is returned as-is', () => {
  const s = { user: 'op@example.test', provider: 'password' };
  assert.equal(requireSession(ctx(s)), s);
});

test('no session, a user-less session, or no session source is null', () => {
  assert.equal(requireSession(ctx(null)), null);
  assert.equal(requireSession(ctx({ provider: 'password' })), null);
  assert.equal(requireSession({ req: {} }), null);
});

test('the operator port stands in only when the route opts in', () => {
  assert.equal(requireSession(ctx(null, { isLoopbackReq: true })), null);
  assert.deepEqual(requireSession(ctx(null, { isLoopbackReq: true }), OPERATOR_PORT), { user: 'operator-port' });
});

test('a truthy non-boolean loopback flag is not the operator port', () => {
  assert.equal(requireSession(ctx(null, { isLoopbackReq: 1 }), OPERATOR_PORT), null);
  assert.equal(requireSession(ctx(null, { isLoopbackReq: 'yes' }), OPERATOR_PORT), null);
});

test('no route module defines its own session predicate', () => {
  const local = readdirSync(ROUTES).filter((f) => f.endsWith('.mjs'))
    .filter((f) => /^(function requireSession\s*\(|const requireSession\s*=)/m.test(readFileSync(join(ROUTES, f), 'utf8')));
  assert.deepEqual(local, []);
});
