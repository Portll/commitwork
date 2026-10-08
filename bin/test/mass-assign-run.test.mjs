// bin/test/mass-assign-run.test.mjs — the mass-assignment probe, asserted by EFFECT. The property
// that matters most: teardown fires on EVERY exit path (escalation confirmed, escalation rejected,
// probe-broken positive control, and a partial failure between create and reread) — never only on
// the "everything worked" path. A true positive here means a real object exists in the target;
// this module's whole job is to never be the thing that leaves it there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOneField } from '../mass-assign-run.mjs';

const actor = { name: 'user1', headers: { Authorization: 'Bearer x' } };

/** A scripted fake reqFn: each call consumes the next entry in `script`, keyed by method, so a
 *  test can assert exactly which calls happened and in what order. */
function fakeReq(script) {
  const calls = [];
  return {
    calls,
    fn: async (path, opts = {}) => {
      calls.push({ path, method: opts.method || 'GET' });
      const next = script.shift();
      if (!next) throw new Error(`fakeReq: script exhausted, unexpected call ${opts.method} ${path}`);
      if (next.throw) throw new Error(next.throw);
      return next;
    },
  };
}

test('escalation confirmed: expectRejected field persists -> critical finding, teardown still fires', async () => {
  const { fn, calls } = fakeReq([
    { status: 201, text: '{"id":"42"}' },                          // create
    { status: 200, text: '{"role":"admin","id":"42"}' },            // reread — persisted!
    { status: 204, text: '' },                                      // teardown
  ]);
  const r = await runOneField({
    actor, createPath: '/api/orders', readPath: '/api/orders/{id}', teardownPath: '/api/orders/{id}',
    idPath: 'id', field: { name: 'role', value: 'admin', expectRejected: true }, reqFn: fn,
  });
  assert.equal(r.finding.type, 'mass-assignment');
  assert.equal(r.finding.severity, 'critical');
  assert.equal(r.teardownFailed, null);
  assert.equal(calls.length, 3, 'create, reread, teardown — exactly three calls');
  assert.equal(calls[2].method, 'DELETE');
  assert.equal(calls[2].path, '/api/orders/42', 'teardown must target the id the create actually returned');
});

test('escalation rejected: expectRejected field does NOT persist -> no finding, teardown still fires', async () => {
  const { fn, calls } = fakeReq([
    { status: 201, text: '{"id":"43"}' },
    { status: 200, text: '{"role":"user","id":"43"}' },             // NOT persisted — server won
    { status: 204, text: '' },
  ]);
  const r = await runOneField({
    actor, createPath: '/api/orders', readPath: '/api/orders/{id}', teardownPath: '/api/orders/{id}',
    idPath: 'id', field: { name: 'role', value: 'admin', expectRejected: true }, reqFn: fn,
  });
  assert.equal(r.finding, null);
  assert.equal(r.teardownFailed, null);
  assert.equal(calls.length, 3, 'teardown must still fire even when nothing was found');
});

test('positive control: a legitimately-settable field persisting correctly produces NO finding', async () => {
  const { fn } = fakeReq([
    { status: 201, text: '{"id":"44"}' },
    { status: 200, text: '{"confirmedByEmail":true,"id":"44"}' },   // persisted, as expected
    { status: 204, text: '' },
  ]);
  const r = await runOneField({
    actor, createPath: '/api/orders', readPath: '/api/orders/{id}', teardownPath: '/api/orders/{id}',
    idPath: 'id', field: { name: 'confirmedByEmail', value: true, expectRejected: false }, reqFn: fn,
  });
  assert.equal(r.finding, null, 'the mechanism working as expected is not itself a finding');
});

test('positive control BROKEN: a legitimately-settable field NOT persisting is its own (medium) finding', async () => {
  const { fn } = fakeReq([
    { status: 201, text: '{"id":"45"}' },
    { status: 200, text: '{"id":"45"}' },                            // field silently absent
    { status: 204, text: '' },
  ]);
  const r = await runOneField({
    actor, createPath: '/api/orders', readPath: '/api/orders/{id}', teardownPath: '/api/orders/{id}',
    idPath: 'id', field: { name: 'confirmedByEmail', value: true, expectRejected: false }, reqFn: fn,
  });
  assert.equal(r.finding.type, 'mass-assignment-probe-broken');
  assert.equal(r.finding.severity, 'medium');
});

test('THE CENTRAL PROPERTY: teardown fires even when reread throws mid-probe (partial failure)', async () => {
  const { fn, calls } = fakeReq([
    { status: 201, text: '{"id":"46"}' },   // create succeeds
    { throw: 'ECONNRESET' },                 // reread throws
    { status: 204, text: '' },               // teardown must STILL be attempted
  ]);
  const r = await runOneField({
    actor, createPath: '/api/orders', readPath: '/api/orders/{id}', teardownPath: '/api/orders/{id}',
    idPath: 'id', field: { name: 'role', value: 'admin', expectRejected: true }, reqFn: fn,
  });
  assert.equal(r.finding, null, 'a probe that could not confirm persistence must not fabricate a finding');
  assert.ok(r.error, 'the reread failure must be reported, not swallowed');
  assert.equal(calls.length, 3, 'teardown call must still have been attempted after the throw');
  assert.equal(calls[2].method, 'DELETE');
});

test('a failed teardown is its own signal, never a silent leftover', async () => {
  const { fn } = fakeReq([
    { status: 201, text: '{"id":"47"}' },
    { status: 200, text: '{"role":"admin","id":"47"}' },
    { status: 500, text: 'server error' },   // teardown itself fails
  ]);
  const r = await runOneField({
    actor, createPath: '/api/orders', readPath: '/api/orders/{id}', teardownPath: '/api/orders/{id}',
    idPath: 'id', field: { name: 'role', value: 'admin', expectRejected: true }, reqFn: fn,
  });
  assert.ok(r.finding, 'the escalation itself was still real and must still be reported');
  assert.match(r.teardownFailed, /HTTP 500/);
  assert.match(r.teardownFailed, /id=47/, 'the teardown-failed message must name which object is still live');
});

test('a create that fails outright makes no teardown call — nothing was made to tear down', async () => {
  const { fn, calls } = fakeReq([
    { status: 422, text: 'validation error' },
  ]);
  const r = await runOneField({
    actor, createPath: '/api/orders', readPath: '/api/orders/{id}', teardownPath: '/api/orders/{id}',
    idPath: 'id', field: { name: 'role', value: 'admin', expectRejected: true }, reqFn: fn,
  });
  assert.equal(r.finding, null);
  assert.ok(r.error);
  assert.equal(calls.length, 1, 'only the failed create call — no reread, no teardown, nothing to tear down');
});
