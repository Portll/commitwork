// bin/test/idor-run.test.mjs — the id-walk comparator, asserted by EFFECT: a real disclosure must
// produce a finding, a real denial must not, and the bounds (CAP_IDOR_RANGE, non-numeric ids) must
// actually refuse rather than silently pass through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlainInteger, idFromPath, runIdorRange, CAP_IDOR_RANGE } from '../idor-run.mjs';

test('isPlainInteger accepts only unsigned base-10 digit strings', () => {
  assert.equal(isPlainInteger('42'), true);
  assert.equal(isPlainInteger('0'), true);
  assert.equal(isPlainInteger('-1'), false, 'a leading sign must not parse as a plain integer');
  assert.equal(isPlainInteger('4.2'), false);
  assert.equal(isPlainInteger('4e2'), false, 'scientific notation is a string trick, not an id');
  assert.equal(isPlainInteger('a1b2-c3d4'), false, 'a UUID-shaped id must be refused, not coerced');
  assert.equal(isPlainInteger(''), false);
  assert.equal(isPlainInteger(undefined), false);
});

test('idFromPath extracts the id when the template genuinely bounds the path', () => {
  assert.equal(idFromPath('/api/orders/{id}', '/api/orders/42'), '42');
  assert.equal(idFromPath('/api/v1/orders/{id}/detail', '/api/v1/orders/7/detail'), '7');
});

test('idFromPath refuses a UUID-keyed resource rather than returning a truthy garbage string', () => {
  assert.equal(idFromPath('/api/orders/{id}', '/api/orders/f47ac10b-58cc-4372-a567-0e02b2c3d479'), null);
});

test('idFromPath refuses when the path does not actually match the template shape', () => {
  assert.equal(idFromPath('/api/orders/{id}', '/api/other/42'), null);
  assert.equal(idFromPath('/api/orders/{id}', '/api/orders/42/extra'), null);
});

test('runIdorRange refuses a range wider than CAP_IDOR_RANGE rather than silently truncating', () => {
  const wide = { from: 0, to: CAP_IDOR_RANGE + 1 };
  return runIdorRange({ ownedId: '100', range: wide, probeFn: async () => ({ status: 200, len: 0, text: '' }), path: '/x/{id}', actorName: 'u1' })
    .then((r) => assert.match(r.void, /more than CAP_IDOR_RANGE/));
});

test('runIdorRange refuses a malformed range rather than computing NaN offsets', async () => {
  const r = await runIdorRange({ ownedId: '100', range: { from: 'x', to: 5 }, probeFn: async () => ({ status: 200, len: 0, text: '' }), path: '/x/{id}', actorName: 'u1' });
  assert.match(r.void, /not a valid/);
});

test('a disclosing response at an adjacent id produces a high-severity finding, never critical', async () => {
  const seen = [];
  const probeFn = async (path) => { seen.push(path); return { status: 200, len: 40, text: '{"id":"x","secret":"y"}' }; };
  const r = await runIdorRange({ ownedId: '100', range: { from: -1, to: 1 }, probeFn, path: '/api/x/{id}', actorName: 'user1' });
  assert.equal(r.findings.length, 2, 'offsets -1 and +1 should each disclose; 0 (the actor\'s own id) is skipped');
  for (const f of r.findings) {
    assert.equal(f.type, 'idor');
    assert.equal(f.severity, 'high', 'no second-actor reference body exists here to justify critical — that discrimination is BOLA\'s, not this probe\'s');
  }
  assert.deepEqual(seen.sort(), ['/api/x/101', '/api/x/99']);
});

test('a properly denied adjacent id produces no finding', async () => {
  const probeFn = async () => ({ status: 403, len: 0, text: '' });
  const r = await runIdorRange({ ownedId: '100', range: { from: -2, to: 2 }, probeFn, path: '/api/x/{id}', actorName: 'user1' });
  assert.equal(r.findings.length, 0);
  assert.equal(r.tested.length, 4, 'four offsets probed: -2,-1,1,2 (0 is the actor\'s own id, skipped)');
});

test('a candidate id that would go negative is never requested', async () => {
  const seen = [];
  const probeFn = async (path) => { seen.push(path); return { status: 404, len: 0, text: '' }; };
  await runIdorRange({ ownedId: '1', range: { from: -3, to: 1 }, probeFn, path: '/api/x/{id}', actorName: 'user1' });
  assert.ok(seen.every((p) => !p.includes('/-')), `a negative id must never be requested, got: ${seen.join(', ')}`);
});
