// Per-lane run state, end to end: the runner's grammar → serve.mjs's parser → an SSE frame a
// browser receives. Driven through CW_SWEEP_CMD against a real spawned panel, so what is tested is
// the wiring rather than a re-implementation of it.
//
// The emitter imports monitor/lane-progress.mjs and calls it for real, across a process boundary,
// under the env serve.mjs actually sets. A fixture that printed hand-written lines would keep
// passing after the emitter changed shape — which is the exact failure this whole path is exposed
// to, because a panel whose lanes never move looks identical to a panel with no sweep running.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = join(HERE, '..', '..');
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-lane-sse-'));
const LANES = join(TMP, 'lanes.mjs');
const ORPHAN = join(TMP, 'orphan.mjs');

let localPort, child, csrf;

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

const hit = (path, { method = 'GET', headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
  const h = { ...headers };
  if (body != null) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(body); }
  const req = request({ host: '127.0.0.1', port: localPort, path, method, headers: h }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { buf += d; });
    res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ } resolve({ status: res.statusCode, body: buf, json }); });
  });
  req.on('error', reject);
  if (body != null) req.write(body);
  req.end();
});

function stream(path, { done = null, ms = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: localPort, path, method: 'GET' }, (res) => {
      const frames = [];
      let buf = '';
      const finish = () => { try { req.destroy(); } catch { /* gone */ } resolve({ status: res.statusCode, frames }); };
      res.setEncoding('utf8');
      res.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          if (block.startsWith(':')) continue;
          const event = /^event: (\w+)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (!event) continue;
          frames.push({ event, data: data ? JSON.parse(data) : null });
          if (done && done(frames)) return finish();
        }
      });
      res.on('end', finish);
    });
    req.on('error', reject);
    req.end();
    setTimeout(() => { try { req.destroy(); } catch { /* gone */ } resolve({ status: 200, frames: [], timedOut: true }); }, ms).unref?.();
  });
}

const post = async (path, payload) => hit(path, { method: 'POST', body: JSON.stringify(payload ?? {}), headers: { 'x-cw-csrf': csrf } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  // Two lanes run to completion, one of them failing; ordinary console noise is interleaved so the
  // parser has to tell a lane line from everything else on the same stream.
  writeFileSync(LANES, `
import { laneProgress } from ${JSON.stringify(pathToFileURL(join(CW, 'monitor/lane-progress.mjs')).href)};
console.log('[sweep] 1 repos');
console.log('  (1/1) scan subject');
laneProgress('start', { repo: 'subject', check: 'deps-osv' });
console.log('some ordinary tool output that mentions [lane] in passing');
laneProgress('end', { repo: 'subject', check: 'deps-osv', status: 'pass', ms: 1200 });
laneProgress('start', { repo: 'subject', check: 'sast' });
laneProgress('end', { repo: 'subject', check: 'sast', status: 'fail', ms: 90 });
console.log('[sweep] done');
`);
  // A lane that starts and never ends: the process exits mid-lane.
  writeFileSync(ORPHAN, `
import { laneProgress } from ${JSON.stringify(pathToFileURL(join(CW, 'monitor/lane-progress.mjs')).href)};
laneProgress('start', { repo: 'subject', check: 'deps-osv' });
laneProgress('end', { repo: 'subject', check: 'deps-osv', status: 'pass', ms: 5 });
laneProgress('start', { repo: 'subject', check: 'sast' });
`);
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea',
    defaultManifest: 'security-baseline', roots: [], projects: [],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true }],
  }));
  mkdirSync(join(TMP, 'reports', 'fixarea'), { recursive: true });

  const port = await freePort();
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: {
      ...process.env,
      CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort),
      CW_SWEEP_CMD: `"${process.execPath}" "${LANES}"`,
      // deliberately NOT set here: serve.mjs must set CW_LANE_PROGRESS on the child itself. If it
      // only worked because the test's environment already carried the flag, the panel would be
      // silent in the one configuration that matters — an operator's own machine.
      CW_LANE_PROGRESS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { const r = await hit('/api/csrf'); if (r.status === 200) { csrf = r.json.token; up = true; } } catch { /* not yet */ }
    if (!up) await sleep(100);
  }
  assert.ok(up, 'panel did not come up');
});

after(() => {
  if (child) child.kill('SIGKILL');
  rmSync(TMP, { recursive: true, force: true });
});

describe('a sweep announcing its lanes', () => {
  let frames;
  before(async () => {
    const r = stream('/api/status/events?kind=sweep&project=fixarea', {
      done: (f) => f.some((x) => x.event === 'status' && x.data && x.data.running === false),
    });
    await sleep(150);
    const started = await post('/api/sweep?project=fixarea');
    assert.equal(started.status, 200, started.body);
    frames = (await r).frames;
  });

  test('lane news arrives on its OWN frame, never as a status', () => {
    const lanes = frames.filter((f) => f.event === 'lane');
    assert.ok(lanes.length >= 4, `expected start+end for two lanes, got ${lanes.length} lane frames `
      + `(events seen: ${[...new Set(frames.map((f) => f.event))].join(', ')})`);
    // The dispatcher's fallthrough would have framed these as `status` with an undefined payload,
    // which the client drops on `if(!sw)return` — a stream that looks healthy and never moves.
    for (const f of frames.filter((x) => x.event === 'status')) {
      assert.ok(f.data === null || typeof f.data === 'object', 'a status frame carried no payload');
      assert.ok(!f.data || !('check' in f.data), 'a lane payload was framed as a status');
    }
  });

  test('serve.mjs sets the flag on the child — the test environment deliberately does not', () => {
    assert.ok(frames.some((f) => f.event === 'lane'),
      'no lane frames at all: CW_LANE_PROGRESS was empty in this test\'s env, so these lines exist '
      + 'only because serve.mjs set it when it spawned the run');
  });

  test('a lane line is not mistaken for sweep progress, and vice versa', () => {
    const lanes = frames.filter((f) => f.event === 'lane').map((f) => f.data);
    assert.deepEqual([...new Set(lanes.map((l) => l.check))].sort(), ['deps-osv', 'sast']);
    // the interleaved console line mentioning [lane] must not have become one
    assert.ok(!lanes.some((l) => /ordinary tool output/.test(l.check || '')));
    const st = frames.filter((f) => f.event === 'status' && f.data).pop();
    assert.equal(st.data.total, 1, 'the sweep repo counter still parsed from the same stream');
  });

  test('the outcome and the duration travel, and each lane is counted apart', () => {
    const st = frames.filter((f) => f.event === 'status' && f.data && f.data.running === false).pop();
    assert.ok(st, 'no terminal status');
    const osv = st.data.lanes['deps-osv'];
    const sast = st.data.lanes.sast;
    assert.equal(osv.done, 1); assert.equal(osv.ok, 1); assert.equal(osv.failed, 0);
    assert.equal(osv.lastMs, 1200, 'the duration is what a timing graph reads');
    assert.equal(sast.done, 1); assert.equal(sast.ok, 0); assert.equal(sast.failed, 1);
    assert.equal(sast.lastStatus, 'fail');
    // and nothing is left spinning
    assert.deepEqual(osv.running, []); assert.deepEqual(sast.running, []);
    assert.equal(osv.abandoned, 0, 'a lane that finished cleanly must not be recorded as abandoned');
  });

  test('the completing lane names the project, so a finished lane is not attributed to another area', () => {
    const end = frames.filter((f) => f.event === 'lane' && f.data.event === 'end').pop();
    assert.equal(end.data.project, 'fixarea');
  });
});

describe('a run that dies mid-lane', () => {
  test('the unfinished lane is abandoned — not done, and never counted as ok', async () => {
    // Point the panel at the orphan emitter by restarting it; CW_SWEEP_CMD is read at spawn.
    child.kill('SIGKILL');
    const port = await freePort();
    localPort = await freePort();
    child = spawn(process.execPath, [SERVE], {
      env: {
        ...process.env,
        CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
        CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort),
        CW_SWEEP_CMD: `"${process.execPath}" "${ORPHAN}"`, CW_LANE_PROGRESS: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try { const r = await hit('/api/csrf'); if (r.status === 200) { csrf = r.json.token; up = true; } } catch { /* not yet */ }
      if (!up) await sleep(100);
    }
    assert.ok(up, 'panel did not come back up');

    const r = stream('/api/status/events?kind=sweep&project=fixarea', {
      done: (f) => f.some((x) => x.event === 'status' && x.data && x.data.running === false),
    });
    await sleep(150);
    assert.equal((await post('/api/sweep?project=fixarea')).status, 200);
    const frames = (await r).frames;

    const st = frames.filter((f) => f.event === 'status' && f.data && f.data.running === false).pop();
    assert.ok(st, 'no terminal status');
    const sast = st.data.lanes.sast;
    assert.deepEqual(sast.running, [], 'a lane left spinning after the process is gone never stops');
    assert.equal(sast.abandoned, 1);
    assert.deepEqual(sast.abandonedRepos, ['subject']);
    assert.equal(sast.done, 0, 'rolling an abandoned lane into `done` is the dangerous direction: '
      + 'the lane would read as having completed a scan that produced nothing');
    assert.equal(sast.ok, 0);
    // the lane that DID finish in the same run is untouched
    assert.equal(st.data.lanes['deps-osv'].done, 1);
    assert.equal(st.data.lanes['deps-osv'].abandoned, 0);
  });
});
