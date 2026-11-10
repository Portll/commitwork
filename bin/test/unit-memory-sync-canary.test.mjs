// Whether memory tag recall filters a never-minted tag and returns a written canary (bin/memory-sync.mjs canary).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canary } from '../memory-sync.mjs';

const CANARY_TAG = 'memory:__memory-sync-canary__';
const DASH = '\u2014';
const fetchImpl = async () => {
  throw new Error('fetch must not be called');
};

function recorder(respond) {
  const calls = [];
  const impl = async (...args) => {
    calls.push(args);
    return respond(...args);
  };
  return { calls, impl };
}

const emptyControl = () => ({ ok: true, memories: [] });
const stored = () => ({ state: 'stored', id: 'mem-1', version: 1 });

test('A negative control that cannot run is reported with its reason and nothing is written', async () => {
  const recall = recorder(() => ({ ok: false, reason: 'store offline' }));
  const up = recorder(stored);
  const r = await canary({ recallImpl: recall.impl, upsertImpl: up.impl, write: true, env: {}, now: '5', fetchImpl });
  assert.deepEqual(r, { ok: false, reason: 'negative control could not run: store offline' });
  assert.equal(recall.calls.length, 1);
  assert.deepEqual(up.calls, []);
});

test('One row under the never-minted control tag fails the canary before any write', async () => {
  const recall = recorder(() => ({ ok: true, memories: [{ id: 'leak' }] }));
  const up = recorder(stored);
  const r = await canary({ recallImpl: recall.impl, upsertImpl: up.impl, write: true, env: {}, now: '5', fetchImpl });
  assert.deepEqual(r, {
    ok: false,
    reason: `negative control returned 1 row(s) for a tag minted nowhere ${DASH} enumeration does not filter, so coverage would be meaningless`,
  });
  assert.deepEqual(up.calls, []);
});

test('A read-only run with an empty control skips the positive check and queries the zero control tag once', async () => {
  const env = {};
  const recall = recorder(emptyControl);
  const up = recorder(stored);
  const r = await canary({ recallImpl: recall.impl, upsertImpl: up.impl, write: false, env, key: 'k1', fetchImpl });
  assert.deepEqual(r, { ok: true, reason: null, positive: `skipped ${DASH} read-only run` });
  assert.deepEqual(recall.calls, [[['memory:__absent-control-0__'], { limit: 1, env, key: 'k1', fetchImpl }]]);
  assert.deepEqual(up.calls, []);
});

test('Leaving write unset is read-only and the control tag is built from now with punctuation stripped', async () => {
  const recall = recorder(() => ({ ok: true }));
  const up = recorder(stored);
  const r = await canary({ recallImpl: recall.impl, upsertImpl: up.impl, env: {}, now: '2026-10-31T00:00:00Z', fetchImpl });
  assert.deepEqual(r, { ok: true, reason: null, positive: `skipped ${DASH} read-only run` });
  assert.deepEqual(recall.calls.map(([tags]) => tags), [['memory:__absent-control-20261031T000000Z__']]);
  assert.deepEqual(up.calls, []);
});

test('A canary that comes back under its own tag reports the receipt state, id and version', async () => {
  const env = { CW_NOW: '2026-10-31T09:30:00Z' };
  const recall = recorder((tags) => (tags[0] === CANARY_TAG ? { ok: true, memories: [{ id: 'mem-7' }] } : { ok: true, memories: [] }));
  const up = recorder(() => ({ state: 'stored-verified', id: 'mem-7', version: 3 }));
  const r = await canary({ recallImpl: recall.impl, upsertImpl: up.impl, write: true, env, fetchImpl });
  assert.deepEqual(r, { ok: true, reason: null, positive: 'stored-verified', id: 'mem-7', version: 3 });
  assert.deepEqual(recall.calls, [
    [['memory:__absent-control-20261031T093000Z__'], { limit: 1, env, key: null, fetchImpl }],
    [[CANARY_TAG], { limit: 1, env, key: null, fetchImpl }],
  ]);
  assert.equal(up.calls.length, 1);
  const [rec, opts] = up.calls[0];
  assert.equal(
    rec.content,
    `memory-sync canary ${DASH} proves a named record written by this tool comes back under its own tag\n\n` +
      'Written by bin/memory-sync.mjs at 2026-10-31T09:30:00Z. A coverage run that cannot find THIS record is measuring a broken enumeration path, not an empty store.',
  );
  assert.deepEqual(rec.tags, [CANARY_TAG, 'harness-memory', 'memory-type:reference']);
  assert.equal(rec.memory_type, 'Context');
  assert.deepEqual(opts, { scope: 'claude-code', env, key: null, fetchImpl });
});

test('A canary that is written but not found under its own tag says every slug would read absent', async () => {
  const recall = recorder(emptyControl);
  const up = recorder(stored);
  const r = await canary({ recallImpl: recall.impl, upsertImpl: up.impl, write: true, env: {}, now: '7', fetchImpl });
  assert.deepEqual(r, {
    ok: false,
    reason: `canary was written and does not come back under its own tag ${DASH} every slug would read ABSENT`,
  });
  assert.equal(up.calls.length, 1);
  assert.equal(recall.calls.length, 2);
});

test('A canary readback that cannot run is reported with the recall reason', async () => {
  const recall = recorder((tags) => (tags[0] === CANARY_TAG ? { ok: false, reason: 'timeout' } : { ok: true, memories: [] }));
  const up = recorder(stored);
  const r = await canary({ recallImpl: recall.impl, upsertImpl: up.impl, write: true, env: {}, now: '7', fetchImpl });
  assert.deepEqual(r, { ok: false, reason: 'canary readback could not run: timeout' });
  assert.equal(up.calls.length, 1);
});
