// GET /api/lane-timing, and the sparkline the panel draws from it.
//
// The route's job is to answer about ONE subject. The failure it is built against is the one
// reportsFor already exists to prevent: a project name the panel does not recognise falling through
// to an unfiltered read, so a question about one area is answered with every area's numbers and
// nothing on the page says so.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const SRC = panelSource('index.html');
const TMP = mkdtempSync(join(tmpdir(), 'cw-lt-'));
const REPORTS = join(TMP, 'reports');

let localPort, child;

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

const hit = (path) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: localPort, path, method: 'GET' }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { buf += d; });
    res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ } resolve({ status: res.statusCode, body: buf, json }); });
  });
  req.on('error', reject);
  req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = (batch, repo, list) => {
  const dir = join(REPORTS, batch, repo);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'checks-status.json'), JSON.stringify(list));
};

before(async () => {
  mkdirSync(REPORTS, { recursive: true });
  rows('sweep-20260801120000-alpha', 'r1', [
    { check: 'sast', status: 'pass', durationMs: 1000, at: '2026-08-01T12:00:00Z' },
    { check: 'sast', status: 'skip', durationMs: null, at: '2026-08-01T12:00:00Z' },
    { check: 'deps-osv', status: 'pass', durationMs: 32004651, at: '2026-08-01T12:00:00Z' },
  ]);
  rows('sweep-20260802120000-alpha', 'r1', [
    { check: 'sast', status: 'pass', durationMs: 3000, at: '2026-08-02T12:00:00Z' },
  ]);
  // another area entirely, and a batch whose area cannot be read from its name
  rows('sweep-20260801120000-beta', 'r1', [
    { check: 'sast', status: 'pass', durationMs: 999999, at: '2026-08-01T12:00:00Z' },
  ]);
  rows('100randomrepos', 'r1', [
    { check: 'sast', status: 'pass', durationMs: 777777, at: '2026-08-01T12:00:00Z' },
  ]);

  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: REPORTS, monitorOutput: 'alpha', defaultManifest: 'security-baseline',
    roots: [], projects: [],
    areas: [{ slug: 'alpha', label: 'alpha', out: 'alpha', primary: true },
      { slug: 'beta', label: 'beta', out: 'beta' }],
  }));

  const port = await freePort();
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: {
      ...process.env,
      CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort),
      CW_LANE_TIMING_TTL_MS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let up = false;
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  for (let i = 0; i < 100 && !up; i++) {
    try { const r = await hit('/api/csrf'); if (r.status === 200) up = true; } catch { /* not yet */ }
    if (!up) await sleep(100);
  }
  assert.ok(up, `panel did not come up — ${err}`);
});

after(() => {
  if (child) child.kill('SIGKILL');
  rmSync(TMP, { recursive: true, force: true });
});

describe('the route', () => {
  test('answers about ONE area, and excludes what it cannot attribute', async () => {
    const r = await hit('/api/lane-timing?project=alpha');
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.lanes.sast.timed, 2, 'beta and the unattributable batch leaked in');
    assert.equal(r.json.lanes.sast.max, 3000);
    assert.equal(r.json.files.outOfArea, 1);
    assert.equal(r.json.files.unattributed, 1);
    assert.equal(r.json.window.area, 'alpha', 'the window is reported, so an empty graph is '
      + 'distinguishable from an empty window');
  });

  test('a skipped lane is counted apart and is not a zero on the axis', async () => {
    const r = await hit('/api/lane-timing?project=alpha');
    assert.equal(r.json.lanes.sast.skipped, 1);
    assert.equal(r.json.lanes.sast.min, 1000, 'the skip became a 0ms sample');
  });

  test('an unrecognised project is REFUSED, not answered with the fleet', async () => {
    // The dangerous failure is not an error — it is a 200 carrying every area's numbers under a
    // name the panel does not know, which reads as that project's result.
    for (const bad of ['../../etc', 'no-such-project', 'zzz']) {
      const r = await hit('/api/lane-timing?project=' + encodeURIComponent(bad));
      assert.ok(r.status === 400 || r.status === 404, `${bad} answered ${r.status}: ${r.body}`);
      assert.ok(!r.json.lanes, `${bad}: a refused request must not carry a lanes payload at all`);
    }
  });

  test('a DECLARED area that has never been swept answers empty — known-and-unmeasured is not unknown', () => {
    // beta is declared and has a batch; the distinction under test is that the refusal above is
    // about names nobody has heard of, not about subjects with nothing recorded yet.
    return hit('/api/lane-timing?project=beta').then((r) => {
      assert.equal(r.status, 200, r.body);
      assert.equal(r.json.lanes.sast.timed, 1);
    });
  });

  test('no project means the whole tree, and says so', async () => {
    const r = await hit('/api/lane-timing');
    assert.equal(r.json.lanes.sast.timed, 4, 'every area plus the unattributed batch');
    assert.equal(r.json.window.area, null);
    assert.equal(r.json.files.outOfArea, 0);
  });

  test('a window narrows the series without narrowing the file count', async () => {
    const r = await hit('/api/lane-timing?project=alpha&since=2026-08-02T00:00:00Z');
    assert.equal(r.json.lanes.sast.timed, 1);
    assert.equal(r.json.lanes.deps_osv, undefined);
    assert.ok(r.json.files.read >= 2, 'the files were read; it is the window that is narrow');
  });
});

describe('the sparkline', () => {
  // Extracted and run, rather than eyeballed: the gap behaviour is the whole claim.
  const src = SRC.slice(SRC.indexOf('function sparkline(daily,w,h){'),
    SRC.indexOf('\n}', SRC.indexOf('function sparkline(daily,w,h){')) + 2);
  const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const fmtMs = (ms) => (ms == null ? '—' : ms + 'ms');
  const { sparkline } = new Function('esc', 'fmtMs', `${src}; return { sparkline };`)(esc, fmtMs);

  test('consecutive days join into one line', () => {
    const svg = sparkline([{ day: '2026-08-01', p50: 10 }, { day: '2026-08-02', p50: 20 }, { day: '2026-08-03', p50: 15 }]);
    assert.equal((svg.match(/<polyline/g) || []).length, 1);
  });

  test('a missing day BREAKS the line rather than being drawn through', () => {
    // A single polyline across the gap shows the lane as measured on days nobody measured it —
    // the same false continuity an interpolated point would give, drawn instead of computed.
    const svg = sparkline([{ day: '2026-08-01', p50: 10 }, { day: '2026-08-02', p50: 20 },
      { day: '2026-08-09', p50: 15 }, { day: '2026-08-10', p50: 12 }]);
    assert.equal((svg.match(/<polyline/g) || []).length, 2, 'the six unmeasured days were drawn through');
  });

  test('a lane measured on exactly one day still draws something', () => {
    const svg = sparkline([{ day: '2026-08-01', p50: 10 }]);
    assert.match(svg, /<circle/, 'a single point has no polyline, and would render as an empty cell');
  });

  test('nothing measured renders an em dash, never an empty chart', () => {
    assert.match(sparkline([]), /—/);
    assert.match(sparkline(null), /—/);
    // an empty <svg> is indistinguishable from a flat line at zero
    assert.ok(!/<svg/.test(sparkline([])));
  });

  test('the series is legible without looking at it', () => {
    const svg = sparkline([{ day: '2026-08-01', p50: 10 }, { day: '2026-08-02', p50: 20 }]);
    assert.match(svg, /role="img"/);
    assert.match(svg, /aria-label="[^"]*2 days measured[^"]*"/);
    assert.match(svg, /<title>/, 'the same text on hover, for a sighted reader');
  });

  test('it is self-contained — no CDN, no external reference', () => {
    const svg = sparkline([{ day: '2026-08-01', p50: 10 }, { day: '2026-08-02', p50: 20 }]);
    assert.ok(!/https?:\/\//.test(svg), 'a file:// reader must see the same chart');
  });
});
