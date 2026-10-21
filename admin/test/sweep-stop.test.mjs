// POST /api/sweep/stop — the VCR transport's ■, against a really-spawned panel: the stop signals
// the whole process GROUP (a grandchild must die), a stopped run reports 'stopped' with
// stoppedAt/stoppedBy (never 'done'), and /api/sweep/stop matches before the /api/sweep prefix.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-sweepstop-'));
// a distinctive marker so pgrep can find THIS test's grandchild and nothing else on the box
const MARKER = `cw-stoptest-${process.pid}`;

let localPort, child, csrf;
const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const hit = (path, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: localPort, path, method, headers }, (res) => {
    let buf = '';
    res.on('data', (d) => { buf += d; });
    res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ } resolve({ status: res.statusCode, body: buf, json }); });
  });
  req.on('error', reject);
  req.end();
});
const post = (path) => hit(path, { method: 'POST', headers: { 'x-cw-csrf': csrf } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the grandchild: a sleep loop tagged with MARKER, started by the fake sweep script
// fact: no shell around pgrep — Linux pgrep matches its parent sh, whose argv carries MARKER; BSD pgrep excludes ancestors
const grandchildren = () => {
  try { return execFileSync('pgrep', ['-f', MARKER], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); }
  catch (e) { if (e.status === 1) return []; throw e; }
};

before(async () => {
  mkdirSync(join(TMP, 'reports', 'fixarea'), { recursive: true });
  mkdirSync(join(TMP, 'alpha'), { recursive: true });
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea',
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true }],
    projects: [{ name: 'alpha', path: join(TMP, 'alpha'), area: 'fixarea', manifest: 'security-baseline' }],
  }));
  // stands in for sweep.mjs: prints, spawns a child of its own, waits — the child proves the group signal
  const fake = join(TMP, 'fakesweep.sh');
  writeFileSync(fake, `#!/bin/sh\necho "[sweep] fake sweep started"\nsh -c 'while true; do sleep 1; done' ${MARKER} &\nwait $!\n`, { mode: 0o755 });

  const port = await freePort();
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: { ...process.env, CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort), CW_SWEEP_CMD: `/bin/sh ${fake}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 120 && !csrf; i++) {
    try { const r = await hit('/api/csrf'); if (r.status === 200) csrf = r.json.token; } catch { /* not up */ }
    if (!csrf) await sleep(100);
  }
  assert.ok(csrf, 'panel did not come up');
});

after(() => {
  child?.kill('SIGKILL');
  for (const p of grandchildren()) { try { process.kill(Number(p), 'SIGKILL'); } catch { /* gone */ } }
  rmSync(TMP, { recursive: true, force: true });
});

describe('the ■ actually stops', () => {
  test('nothing running is refused honestly — never a fake success', async () => {
    const r = await post('/api/sweep/stop?kind=sweep');
    assert.equal(r.status, 200);
    assert.equal(r.json.stopped, false);
    assert.match(r.json.reason, /nothing running/);
  });

  test('a sweep or healthcheck with no project is refused, never run on the primary area', async () => {
    for (const path of ['/api/sweep', '/api/sweep?project=', '/api/health/all?project=']) {
      const r = await post(path);
      assert.equal(r.json.started, false, `${path} started a run with no project`);
      assert.match(r.json.reason, /no project selected/);
    }
    assert.equal((await hit('/api/status?project=fixarea')).json.sweep?.running ?? false, false);
  });

  test('an unknown job kind is refused, not guessed', async () => {
    const r = await post('/api/sweep/stop?kind=__nope');
    assert.equal(r.status, 400);
    assert.equal(r.json.stopped, false);
    assert.ok(Array.isArray(r.json.known) && r.json.known.includes('sweep'));
  });

  test('stop kills the whole process GROUP — a grandchild must not survive', async () => {
    assert.equal((await post('/api/sweep?project=fixarea')).json.started, true);
    // wait for the fake sweep to have spawned its own child
    for (let i = 0; i < 60 && !grandchildren().length; i++) await sleep(100);
    assert.equal(grandchildren().length, 1, 'setup: the grandchild should be running before we stop');

    const st = await post('/api/sweep/stop?kind=sweep');
    assert.equal(st.json.stopped, true);

    for (let i = 0; i < 60 && grandchildren().length; i++) await sleep(100);
    assert.equal(grandchildren().length, 0,
      'the grandchild outlived the stop — signalling the parent pid alone orphans the scanner tree while the panel claims "stopped"');
  });

  test('a stopped run reports STOPPED, never done — and carries who and how', async () => {
    const s = (await hit('/api/status?project=fixarea')).json.sweep;
    assert.equal(s.running, false);
    assert.equal(s.phase, 'stopped', 'a killed run must never borrow the completed phase');
    assert.equal(s.stoppedBy, 'operator');
    assert.ok(s.stoppedAt, 'stoppedAt must travel so the UI can distinguish halted from finished');
  });

  test('route ORDER: /api/sweep/stop must not fall into the startsWith /api/sweep route', async () => {
    // a prefix match here would return {started:true} and launch a sweep
    const r = await post('/api/sweep/stop?kind=sweep');
    assert.equal(r.json.started, undefined, 'stopping must never start a sweep');
    assert.equal(typeof r.json.stopped, 'boolean');
  });
});
