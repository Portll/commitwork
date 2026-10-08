// The Updates section's endpoints. Two assertions carry this file: the published port may not
// learn what this laptop is vulnerable to (names, versions and CVE ids together are a targeting
// package, not just a fingerprint), and a scan cannot be started from it.
//
// Routes are driven through their exported `handle` with a fake `send`, as in packages-route.test.mjs.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes, readUpdates, publishedUpdatesView, startRefresh } from '../routes/updates.mjs';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const dirs = [];
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-updroute-')); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const route = (method, path) => routes.find((r) => r.method === method && r.path === path);
const call = async (r, ctx = {}) => {
  const out = {};
  await r.handle({ send: (status, body) => { out.status = status; out.body = body; }, readJsonBody: async () => ({}), ...ctx });
  return out;
};
// Env is set AFTER the import, which is the point of reading it at call time.
const withEnv = async (kv, fn) => {
  const saved = {};
  for (const [k, v] of Object.entries(kv)) { saved[k] = process.env[k]; if (v === null) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const k of Object.keys(kv)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
};

// A scan's output, in the shape the producer writes. Synthetic: nothing here is installed anywhere.
const DOC = {
  at: '2099-01-02T03:04:05Z',
  generator: 'monitor/update-vulns.mjs',
  grypeDb: { state: 'valid', built: '2099-01-01T00:00:00Z', schema: 'v6.1.9' },
  kevChecked: true,
  managers: [
    {
      manager: 'macos',
      state: 'outdated',
      basis: 'nvd-cpe',
      installed: { version: '26.4', build: '98E0001' },
      seed: { state: 'beta-seed', url: 'https://example.invalid/index-27seed.sucatalog.gz' },
      counts: { updates: 1, superseded: 2, offeredNotInstalled: 1, noLongerOffered: 1 },
      applyable: false,
      rows: [{
        key: 'macos:26.7', name: 'macOS Sample', installed: '26.4 (98E0001)', latest: '26.7 (98G0003)',
        fixedByUpdate: { state: 'measured', count: 2, published: {}, undetermined: 2, noFixRecorded: 0, kev: ['CVE-2099-1001'], rows: [{ id: 'CVE-2099-1001', publish: 'undetermined', originalClaim: { severity: 'Critical' }, kev: true, epss: null, fix: '26.6.1' }] },
        remainingAfter: { state: 'measured', count: 1, published: {}, undetermined: 1, noFixRecorded: 1, kev: [], rows: [{ id: 'CVE-1999-0590', publish: 'undetermined', originalClaim: { severity: 'Low' }, kev: false, epss: null, fix: null }] },
        vulnerableNow: { state: 'measured', count: 3, published: {}, undetermined: 3, noFixRecorded: 1, kev: ['CVE-2099-1001'], rows: [] },
        introducedByUpdate: { state: 'measured', count: 0, published: {}, undetermined: 0, noFixRecorded: 0, kev: [], rows: [] },
      }],
    },
    {
      manager: 'brew', state: 'outdated', basis: 'syft-sbom', counts: { updates: 1, evaluated: 0, unknown: 1 },
      rows: [{
        key: 'brew:formula:samplelib', name: 'samplelib', installed: '1.2.3', latest: '2.0.0',
        fixedByUpdate: { state: 'unknown', unknown: true, unknownReason: 'unexaminable', unknownDetail: 'no own artifact', count: 0, published: {}, undetermined: 0, noFixRecorded: 0, kev: [], rows: [] },
        remainingAfter: { state: 'unknown', unknown: true, unknownReason: 'unexaminable', count: 0, published: {}, undetermined: 0, noFixRecorded: 0, kev: [], rows: [] },
        vulnerableNow: { state: 'measured', count: 1, published: { High: 1 }, undetermined: 0, noFixRecorded: 0, kev: [], rows: [{ id: 'CVE-2099-0001', publish: 'severity', severity: 'High', kev: false, epss: null, fix: '1.5.0' }] },
        introducedByUpdate: { state: 'measured', count: 0, published: {}, undetermined: 0, noFixRecorded: 0, kev: [], rows: [] },
      }],
    },
  ],
  counts: { updates: 2, fixing: 1, unknown: 1, kev: 1, fixedTotal: 2 },
  kev: ['CVE-2099-1001'],
  state: 'findings',
};

const withDoc = async (doc, fn) => {
  const p = join(scratch(), 'updates.json');
  writeFileSync(p, typeof doc === 'string' ? doc : JSON.stringify(doc));
  return withEnv({ CW_UPDATES_OUT: p }, fn);
};

test('the three routes are registered at the paths the page expects', () => {
  assert.ok(route('GET', '/api/updates'));
  assert.ok(route('POST', '/api/updates/refresh'));
  assert.ok(route('GET', '/api/updates/jobs'));
  assert.equal(routes.length, 3, 'a fourth route is a new surface — decide its gate deliberately');
});

test('serve.mjs actually dispatches them — a route module nothing imports answers nobody', () => {
  const src = serverSource();
  assert.match(src, /import \{ routes as updateRoutes \} from '\.\/routes\/updates\.mjs'/);
  assert.match(src, /MODULAR_ROUTES = \[[^\]]*\.\.\.updateRoutes/);
});

// ── the gate ───────────────────────────────────────────────────────────────────────────────────
test('the published port gets counts and NO names, versions or CVE ids', async () => {
  const r = await withDoc(DOC, () => call(route('GET', '/api/updates'), { isLoopbackReq: false }));
  assert.equal(r.status, 200);
  assert.equal(r.body.published, true);
  const text = JSON.stringify(r.body);
  for (const leak of ['samplelib', 'CVE-2099-1001', 'CVE-1999-0590', '26.4', '98E0001', '2.0.0', '27seed']) {
    assert.ok(!text.includes(leak), `the published payload leaks ${leak} — names, versions and CVE ids are a targeting package for this machine`);
  }
  assert.equal(r.body.rows, undefined);
  assert.ok(r.body.counts.updates >= 1, 'the counts DO cross — a reader must still see that updates are pending');
  assert.match(r.body.withheld, /withheld on the published port/);
  assert.ok(r.body.managers.every((m) => m.rows === undefined));
});

test('the operator port gets the full document and the job list', async () => {
  const r = await withDoc(DOC, () => call(route('GET', '/api/updates'), { isLoopbackReq: true }));
  assert.equal(r.status, 200);
  assert.notEqual(r.body.published, true);
  assert.equal(r.body.managers[0].rows[0].fixedByUpdate.count, 2);
  assert.ok(Array.isArray(r.body.jobs));
});

test('a refresh REFUSES off the operator port, and names where it is available', async () => {
  const r = await withEnv({ CW_ADMIN_LOCAL_PORT: null, CW_ADMIN_PORT: '7890' },
    () => call(route('POST', '/api/updates/refresh'), { isLoopbackReq: false }));
  assert.equal(r.status, 403);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /127\.0\.0\.1:7891/, 'the default operator port is PORT + 1, mirroring serve.mjs');
  assert.match(r.body.error, /external even when you are sitting at the box/);
});

test('scan logs are operator-port only', async () => {
  const r = await call(route('GET', '/api/updates/jobs'), { isLoopbackReq: false });
  assert.equal(r.status, 403);
});

// ── fail closed ────────────────────────────────────────────────────────────────────────────────
test('ENOENT is the ONE absence: never scanned, not "nothing to update"', async () => {
  const r = await withEnv({ CW_UPDATES_OUT: join(scratch(), 'never-written.json') }, () => readUpdates());
  assert.equal(r.ok, false);
  assert.equal(r.state, 'not-run');
  assert.match(r.reason, /update-vulns\.mjs --json-out/, 'the state must say how to leave it');
  assert.equal(r.managers, undefined);
});

test('a torn file is UNKNOWN, never zero updates', async () => {
  const r = await withDoc('{"managers": [', () => readUpdates());
  assert.equal(r.ok, false);
  assert.equal(r.unknownReason, 'unparseable');
  assert.match(r.unknownDetail, /never as zero updates/);
  const view = publishedUpdatesView(r);
  assert.equal(view.ok, false);
  assert.equal(view.state, 'unknown');
  assert.equal(view.counts, undefined, 'a void must not publish counts it does not have');
});

test('valid JSON of the wrong shape is UNKNOWN too — the format decides the field', async () => {
  const r = await withDoc({ at: 'x' }, () => readUpdates());
  assert.equal(r.unknownReason, 'unparseable');
});

test('an unreadable file is not-permitted, not absent', async () => {
  const d = scratch();
  mkdirSync(join(d, 'updates.json'));   // a directory where the file should be: readable path, unreadable file
  const r = await withEnv({ CW_UPDATES_OUT: join(d, 'updates.json') }, () => readUpdates());
  assert.equal(r.ok, false);
  assert.equal(r.unknownReason, 'not-permitted');
  assert.match(r.unknownDetail, /UNKNOWN, not nothing/);
});

test('the output path is read at CALL time, so a test can move it', async () => {
  const a = await withDoc({ ...DOC, at: 'FIRST' }, () => readUpdates());
  const b = await withDoc({ ...DOC, at: 'SECOND' }, () => readUpdates());
  assert.equal(a.at, 'FIRST');
  assert.equal(b.at, 'SECOND');
});

// ── the scan job ───────────────────────────────────────────────────────────────────────────────
test('a refresh spawns the producer as argv with no shell, and only one at a time', async () => {
  const calls = [];
  const child = { pid: 4242, handlers: {}, on(ev, fn) { this.handlers[ev] = fn; return this; }, unref() {} };
  const spawnFn = (bin, args, opts) => { calls.push({ bin, args, opts }); return child; };
  const jobDir = scratch();
  await withEnv({ CW_UPDATES_JOB_DIR: jobDir }, () => {
    const first = startRefresh({ spawnFn });
    assert.equal(first.ok, true);
    assert.equal(first.status, 202);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, process.execPath, 'the producer is node, named by its own executable — never a command string');
    assert.ok(Array.isArray(calls[0].args));
    assert.ok(calls[0].args[0].endsWith('monitor/update-vulns.mjs'));
    assert.deepEqual(calls[0].args.slice(1), ['--json-out']);
    assert.equal(calls[0].opts.shell, undefined, 'no shell: nothing the caller sends reaches a command line');
    assert.equal(calls[0].opts.detached, true);

    const second = startRefresh({ spawnFn });
    assert.equal(second.ok, false);
    assert.equal(second.status, 409, 'two scans share one SBOM cache and one output file');
    assert.equal(calls.length, 1, 'the refused call started nothing');

    // The producer exits 1 when an update fixes something and 2 when the answer is unknown — a
    // RESULT, not a failure. Only a spawn error fails the job.
    child.handlers.exit(1, null);
    const third = startRefresh({ spawnFn });
    assert.equal(third.ok, true);
    assert.equal(third.job.state, 'running');
    child.handlers.exit(0, null);
  });
  // fact: read back from the same scratch dir; outside it the route lists the live job store, and this passed on real jobs
  const jobs = await withEnv({ CW_UPDATES_JOB_DIR: jobDir }, () => call(route('GET', '/api/updates/jobs'), { isLoopbackReq: true }));
  assert.equal(jobs.body.ok, true);
  assert.equal(jobs.body.jobs.length, 2, 'the two refreshes this test started, and nothing else');
  assert.ok(jobs.body.jobs.every((j) => j.state === 'done'), 'a non-zero exit from the producer is a result, not a failed scan');
});

test('two refreshes in the same millisecond are two jobs, not one record overwritten', async () => {
  const child = () => ({ pid: 1, handlers: {}, on(ev, fn) { this.handlers[ev] = fn; return this; }, unref() {} });
  const started = [];
  const spawnFn = () => { const c = child(); started.push(c); return c; };
  const jobDir = scratch();
  const clock = mock.method(Date, 'now', () => 1_700_000_000_000);
  try {
    await withEnv({ CW_UPDATES_JOB_DIR: jobDir }, () => {
      const a = startRefresh({ spawnFn });
      started[0].handlers.exit(0, null);
      const b = startRefresh({ spawnFn });
      started[1].handlers.exit(0, null);
      assert.notEqual(a.job.id, b.job.id);
    });
  } finally {
    clock.mock.restore();
  }
  const jobs = await withEnv({ CW_UPDATES_JOB_DIR: jobDir }, () => call(route('GET', '/api/updates/jobs'), { isLoopbackReq: true }));
  assert.equal(new Set(jobs.body.jobs.map((j) => j.id)).size, jobs.body.jobs.length, 'no job record replaced another');
});
