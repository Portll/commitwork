import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeStack } from '../api-routes.mjs';
import { openLedger } from '../ledger.mjs';
import { createMeter } from '../meter.mjs';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const IDS = { slot1: 'a'.repeat(64), stopped: 'c'.repeat(64) };
const get = (path, ctx) => {
  const url = new URL(path, 'http://x');
  return routeStack(url.pathname, url.searchParams, ctx);
};

function fixtureMeter() {
  let t = Date.parse('2026-10-22T09:00:00Z');
  const m = createMeter({ root: join(FIX, 'cgroup'), proc: join(FIX, 'proc'), ids: IDS, wall: () => (t += 2000) });
  m.sample();
  m.sample();
  return m;
}

test('resources/now carries the newest sample, stamped with its own time, unmeasured counted', async () => {
  const { status, payload } = await get('/v1/resources/now', { meter: fixtureMeter() });
  assert.equal(status, 200);
  assert.deepEqual(payload.sources, [{ id: 'meter', status: 'live', reason: null }, { id: 'stack-ids', status: 'live', reason: null }]);
  assert.deepEqual(payload.coverage, { requested: 3, measured: 2, unknownFields: 1 });
  assert.equal(payload.stamp.verifiedAt, payload.data.sample.at);
  assert.equal(payload.data.sample.containers.stopped.state, 'unmeasured');
  assert.equal(payload.data.sample.vm.layer, 'vm');
});

test('resources/series returns the window, and no meter is null, not empty', async () => {
  const { payload } = await get('/v1/resources/series?window=60', { meter: fixtureMeter() });
  assert.equal(payload.data.windowSec, 60);
  assert.equal(payload.data.samples.length, 2);
  const none = await get('/v1/resources/series', {});
  assert.equal(none.payload.data.samples, null);
  assert.equal(none.payload.sources[0].status, 'unavailable');
});

test('runner/decisions and runner/jobs read the ledger; since takes unix seconds too', async () => {
  const ledger = openLedger(join(mkdtempSync(join(tmpdir(), 'cw-api-')), 'l.db'), { now: () => Date.parse('2026-10-22T09:00:00Z') });
  ledger.recordDecision({ repo: 'example-owner/example-public', runId: 9, jobId: null, admit: false, code: 'event-privileged', reason: 'pull_request_target' });
  const d = await get('/v1/runner/decisions?since=1792627200&limit=5', { ledger });
  assert.equal(d.payload.data.since, '2026-10-22T00:00:00.000Z');
  assert.deepEqual(d.payload.data.decisions.map((x) => [x.code, x.outcome]), [['event-privileged', 'refuse']]);
  const j = await get('/v1/runner/jobs', { ledger });
  assert.deepEqual(j.payload.data, { since: null, jobs: [] });
  ledger.close();
  const none = await get('/v1/runner/jobs', {});
  assert.equal(none.payload.data.jobs, null);
});

test('runner/slots passes the slot table through', async () => {
  const slots = [{ id: 'slot-1', state: 'claimed', runnerName: 'cw-slot-1-501-1792573200' }];
  const { payload } = await get('/v1/runner/slots', { slots: () => slots });
  assert.deepEqual(payload.data, { slots });
  assert.equal((await get('/v1/runner/slots', {})).payload.data.slots, null);
});

test('health probes veld and spine when configured: live, an HTTP failure, and no answer', async () => {
  const stub = createServer((req, res) => { res.statusCode = req.url === '/health' ? 200 : 503; res.end('{}'); });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${stub.address().port}`;
  try {
    const { payload } = await get('/v1/health', { probes: { veld: `${at}/health`, spine: `${at}/api/v1/health` } });
    assert.deepEqual(payload.sources.slice(3), [
      { id: 'veld', status: 'live', reason: null },
      { id: 'spine', status: 'unavailable', reason: 'HTTP 503' },
    ]);
  } finally {
    stub.close();
  }
  // AbortSignal.timeout's timer is unref'd; the held timer stands in for a real request's socket.
  const slow = (url, { signal }) => new Promise((_, reject) => {
    const socket = setTimeout(() => {}, 10_000);
    signal.addEventListener('abort', () => { clearTimeout(socket); reject(signal.reason); });
  });
  const { payload } = await get('/v1/health', { probes: { veld: 'http://veld.invalid/health' }, fetch: slow, probeTimeoutMs: 20 });
  assert.deepEqual(payload.sources[3], { id: 'veld', status: 'unavailable', reason: 'no answer in 20 ms' });
});

test('health reads the probe URLs from the environment at call time', async () => {
  const keep = { v: process.env.CW_STACK_VELD_URL, s: process.env.CW_STACK_SPINE_URL };
  try {
    delete process.env.CW_STACK_SPINE_URL;
    process.env.CW_STACK_VELD_URL = 'http://veld.invalid/health';
    const fail = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
    const { payload } = await get('/v1/health', { fetch: fail });
    assert.deepEqual(payload.sources.slice(3).map((s) => [s.id, s.status, s.reason]), [
      ['veld', 'unavailable', 'ENOTFOUND'], ['spine', 'unmeasured', 'no URL configured'],
    ]);
  } finally {
    for (const [k, v] of [['CW_STACK_VELD_URL', keep.v], ['CW_STACK_SPINE_URL', keep.s]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
