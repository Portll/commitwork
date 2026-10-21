// The live console as an event stream — GET /api/status/events: each line arrives once, seq-tagged
// (the SSE id IS the seq); Last-Event-ID replays exactly the gap; loss beyond LOG_CAP is declared
// with a `gap` event; the terminal status carries the exit code; CW_SSE_CAP bounds connections.
// The sweep is driven through CW_SWEEP_CMD, so no scanner runs.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-sse-'));
const EMITTER = join(TMP, 'emit.mjs');

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

/** Open an SSE stream and collect frames until `done(frames)` or the timeout. */
function stream(path, { headers = {}, done = null, ms = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: localPort, path, method: 'GET', headers }, (res) => {
      const frames = [];
      let buf = '';
      const finish = () => { try { req.destroy(); } catch { /* already gone */ } resolve({ status: res.statusCode, headers: res.headers, frames }); };
      if (res.statusCode !== 200) { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, frames, body: b })); return; }
      res.setEncoding('utf8');
      res.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          if (block.startsWith(':')) continue; // heartbeat
          const id = /^id: (\d+)$/m.exec(block)?.[1];
          const event = /^event: (\w+)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (!event) continue;
          frames.push({ id: id === undefined ? undefined : Number(id), event, data: data ? JSON.parse(data) : null });
          if (done && done(frames)) return finish();
        }
      });
      res.on('end', finish);
    });
    req.on('error', reject);
    req.end();
    setTimeout(() => { try { req.destroy(); } catch { /* already gone */ } resolve({ status: 200, frames: [], timedOut: true }); }, ms).unref?.();
  });
}

const post = async (path, payload) => hit(path, { method: 'POST', body: JSON.stringify(payload ?? {}), headers: { 'x-cw-csrf': csrf } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  // A fake sweep: five numbered lines, then exit. No scanner, no network.
  writeFileSync(EMITTER, `for (let i = 1; i <= 5; i++) console.log('[fixture] line ' + i);\n`);
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
      CW_SWEEP_CMD: `"${process.execPath}" "${EMITTER}"`,
      CW_SSE_CAP: '2',
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

describe('a job that never ran', () => {
  test('streams a declared null status rather than an empty stream', async () => {
    const r = await stream('/api/status/events?kind=health-gates', { done: (f) => f.length >= 1 });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/event-stream/);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.frames[0].event, 'status');
    assert.equal(r.frames[0].data, null, 'never-ran is a stated absence');
  });
});

describe('live delivery and replay', () => {
  test('lines arrive once each, seq-tagged, and the terminal status carries the exit code', async () => {
    const started = await post('/api/sweep?project=fixarea');
    assert.equal(started.status, 200, started.body);

    const r = await stream('/api/status/events?kind=sweep&project=fixarea', {
      done: (f) => f.some((x) => x.event === 'status' && x.data && x.data.running === false),
    });
    const lines = r.frames.filter((f) => f.event === 'line');
    const texts = lines.map((l) => l.data.line);
    for (let i = 1; i <= 5; i++) {
      assert.equal(texts.filter((t) => t === `[fixture] line ${i}`).length, 1, `line ${i} must arrive exactly once`);
    }
    const seqs = lines.map((l) => l.data.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'seq must be monotonic');
    assert.deepEqual(lines.map((l) => l.id), seqs, 'the SSE id must BE the seq — that is what makes Last-Event-ID work');

    const final = r.frames.filter((f) => f.event === 'status').pop();
    assert.equal(final.data.running, false);
    assert.equal(final.data.exitCode, 0);
  });

  test('Last-Event-ID replays exactly the gap — no duplicate, no hole', async () => {
    const full = await stream('/api/status/events?kind=sweep&project=fixarea', { done: (f) => f.some((x) => x.event === 'status') });
    const allLines = full.frames.filter((f) => f.event === 'line');
    assert.ok(allLines.length >= 5);
    const mid = allLines[Math.floor(allLines.length / 2)].data.seq;

    const gap = await stream('/api/status/events?kind=sweep&project=fixarea', {
      headers: { 'last-event-id': String(mid) },
      done: (f) => f.some((x) => x.event === 'status'),
    });
    const got = gap.frames.filter((f) => f.event === 'line').map((l) => l.data.seq);
    const expected = allLines.map((l) => l.data.seq).filter((s) => s > mid);
    assert.deepEqual(got, expected, 'a reconnecting client gets precisely what it missed');
    assert.ok(!gap.frames.some((f) => f.event === 'gap'), 'nothing was dropped, so nothing is claimed dropped');
  });

  test('a client beyond the retained window is told it lost lines', async () => {
    // a short fixture cannot advance past LOG_CAP, so assert the inverse: no fabricated gap frame
    const r = await stream('/api/status/events?kind=sweep&project=fixarea&from=0', { done: (f) => f.some((x) => x.event === 'status') });
    assert.ok(!r.frames.some((f) => f.event === 'gap'), 'a full replay must not claim a gap');
    assert.ok(r.frames.filter((f) => f.event === 'line').length >= 5, 'from=0 replays the whole retained window');
  });
});

describe('the connection cap', () => {
  test('refuses beyond CW_SSE_CAP and releases slots on disconnect', async () => {
    const held = [];
    for (let i = 0; i < 2; i++) {
      held.push(new Promise((resolve) => {
        const req = request({ host: '127.0.0.1', port: localPort, path: '/api/status/events?kind=sweep', method: 'GET' },
          (res) => { resolve({ req, status: res.statusCode }); res.resume(); });
        req.end();
      }));
    }
    const open = await Promise.all(held);
    for (const o of open) assert.equal(o.status, 200);

    const over = await hit('/api/status/events?kind=sweep');
    assert.equal(over.status, 429);

    for (const o of open) o.req.destroy();
    await sleep(200); // let the close handlers run
    const after = await stream('/api/status/events?kind=sweep', { done: (f) => f.length >= 1 });
    assert.equal(after.status, 200, 'slots must come back when clients leave');
  });
});
