// Computes whether a dispatch should be held based on session state (admin/routes/overwatch-layer.mjs holdDecision).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdDecision } from '../routes/overwatch-layer.mjs';

test('returns hold false when held is falsy', () => {
  assert.deepEqual(holdDecision({ held: false, still: null }), { hold: false });
});

test('returns hold false when held is undefined', () => {
  assert.deepEqual(holdDecision({ held: undefined, still: null }), { hold: false });
});

test('returns hold true with in-flight reason when held has no sessionId', () => {
  const result = holdDecision({ held: { id: 'abc' }, still: null });
  assert.equal(result.hold, true);
  assert.equal(result.why, 'a dispatch for it is still in flight');
});

test('returns hold true with unreachable reason when still is null', () => {
  const result = holdDecision({ held: { sessionId: 's1' }, still: null });
  assert.equal(result.hold, true);
  assert.equal(result.why, 'and whether that session is still running could not be determined (upstream unreachable) \u2014 the guard holds rather than releasing on an unanswered question');
});

test('returns hold true with still.why reason when still.known is false', () => {
  const result = holdDecision({ held: { sessionId: 's1' }, still: { known: false, why: 'timeout' } });
  assert.equal(result.hold, true);
  assert.equal(result.why, 'and whether that session is still running could not be determined (timeout) \u2014 the guard holds rather than releasing on an unanswered question');
});

test('returns hold true with still.why reason when still.known is undefined', () => {
  const result = holdDecision({ held: { sessionId: 's1' }, still: { why: 'error' } });
  assert.equal(result.hold, true);
  assert.equal(result.why, 'and whether that session is still running could not be determined (error) \u2014 the guard holds rather than releasing on an unanswered question');
});

test('returns hold true with running reason when still.session is truthy', () => {
  const result = holdDecision({ held: { sessionId: 's1' }, still: { known: true, session: { id: 's1' } } });
  assert.equal(result.hold, true);
  assert.equal(result.why, 'and that session is still running');
});

test('returns hold false when still.known is true and still.session is falsy', () => {
  assert.deepEqual(holdDecision({ held: { sessionId: 's1' }, still: { known: true, session: null } }), { hold: false });
});

test('returns hold false when still.known is true and still.session is undefined', () => {
  assert.deepEqual(holdDecision({ held: { sessionId: 's1' }, still: { known: true } }), { hold: false });
});
