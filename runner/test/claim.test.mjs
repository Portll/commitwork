import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createClaims } from '../claim.mjs';

const SECRET = 'a'.repeat(64);
const BOOT = 'b1'.repeat(8);

async function serve(opts = {}) {
  const reports = [];
  const claims = createClaims({ secrets: { 'slot-1': SECRET }, holdMs: 300, onReport: (r) => reports.push(r), ...opts });
  const server = http.createServer((req, res) => claims.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const post = async (path, body, secret = SECRET) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const until = async (cond) => { for (let i = 0; i < 50 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)); };
  return { claims, post, reports, until, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}

const job = { jit: 'JIT', repo: 'o/r', name: 'cw-slot-1-7-1', jobId: 7, runId: 3, actors: ['o'] };

test('an open claim makes the slot free; assign answers it with the JIT and the repo', async () => {
  const s = await serve();
  const pending = s.post('/v1/claim', { slotId: 'slot-1', boot: BOOT });
  await s.until(() => s.claims.freeSlots().length);
  assert.deepEqual(s.claims.freeSlots(), ['slot-1']);
  assert.equal(s.claims.assign('slot-1', job), true);
  assert.deepEqual(await pending, { status: 200, body: { jit: 'JIT', repo: 'o/r', runnerName: 'cw-slot-1-7-1', jobId: 7, actors: ['o'] } });
  assert.deepEqual(s.claims.freeSlots(), []);
  assert.equal(s.claims.states()[0].state, 'running');
  await s.close();
});

test('one JIT per boot: a second claim on a delivered boot is refused', async () => {
  const s = await serve();
  const first = s.post('/v1/claim', { slotId: 'slot-1', boot: BOOT });
  await s.until(() => s.claims.freeSlots().length);
  s.claims.assign('slot-1', job);
  await first;
  assert.equal((await s.post('/v1/claim', { slotId: 'slot-1', boot: BOOT })).status, 409);
  await s.close();
});

test('a wrong secret, an unknown slot or a malformed boot is 401, and the slot stays unclaimed', async () => {
  const s = await serve();
  assert.equal((await s.post('/v1/claim', { slotId: 'slot-1', boot: BOOT }, 'b'.repeat(64))).status, 401);
  assert.equal((await s.post('/v1/claim', { slotId: 'slot-9', boot: BOOT })).status, 401);
  assert.equal((await s.post('/v1/claim', { slotId: 'slot-1', boot: 'not hex' })).status, 401);
  assert.deepEqual(s.claims.freeSlots(), []);
  await s.close();
});

test('a long-poll that outlives holdMs gets 204 and the slot is no longer free', async () => {
  const s = await serve();
  assert.equal((await s.post('/v1/claim', { slotId: 'slot-1', boot: BOOT })).status, 204);
  assert.deepEqual(s.claims.freeSlots(), []);
  assert.equal(s.claims.assign('slot-1', job), false);
  await s.close();
});

test('a report is taken only from the boot that holds a job, and carries the job it ran', async () => {
  const s = await serve();
  assert.equal((await s.post('/v1/report', { slotId: 'slot-1', boot: BOOT, code: 0 })).status, 409);
  const pending = s.post('/v1/claim', { slotId: 'slot-1', boot: BOOT });
  await s.until(() => s.claims.freeSlots().length);
  s.claims.assign('slot-1', job);
  await pending;
  assert.equal((await s.post('/v1/report', { slotId: 'slot-1', boot: 'c2'.repeat(8), code: 0 })).status, 409);
  assert.equal((await s.post('/v1/report', { slotId: 'slot-1', boot: BOOT, code: 0, wallSec: 17 })).status, 204);
  assert.equal(s.reports.length, 1);
  assert.deepEqual({ ...s.reports[0], boot: undefined }, { slotId: 'slot-1', boot: undefined, code: 0, wallSec: 17, runnerName: 'cw-slot-1-7-1', repo: 'o/r', jobId: 7, runId: 3 });
  assert.equal(s.claims.states()[0].state, 'restarting');
  await s.close();
});

test('only the two routes answer', async () => {
  const s = await serve();
  assert.equal((await s.post('/v1/runner/slots', {})).status, 404);
  await s.close();
});
