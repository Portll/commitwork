// GET /api/posture — the panel's half of the posture board (the judgement lives in
// monitor/test/posture.test.mjs): an approach with no aggregate is grey and says it did not run,
// and the cached toolchain answer is stamped with when it was probed.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-posture-'));

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

before(async () => {
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea',
    defaultManifest: 'security-baseline', roots: [],
    projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' }],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true, members: ['fixrepo'] }],
  }));
  mkdirSync(join(TMP, 'src'), { recursive: true });
  mkdirSync(join(TMP, 'reports', 'fixarea', 'history'), { recursive: true });
  const generated = new Date().toISOString();
  writeFileSync(join(TMP, 'reports', 'fixarea', 'rollup.json'), JSON.stringify({
    generated, totals: { repos: 1 }, repos: [],
    scanners: {
      // ran and clean, stamped now — the only row entitled to green
      secrets: { ran: 2, skipped: 0, noscan: 0, crit: 0, high: 0, med: 0, low: 0, total: 0, check: 'secrets-gitleaks', lastRunAt: generated },
      // in scope, scanned nowhere — the void this whole board exists to show
      apiFuzz: { ran: 0, skipped: 1, noscan: 2, crit: 0, high: 0, med: 0, low: 0, total: 0, check: 'api-fuzz' },
      // real findings
      dockerfile: { ran: 2, skipped: 0, noscan: 0, crit: 0, high: 3, med: 1, low: 0, total: 4, check: 'dockerfile-lint', lastRunAt: generated },
    },
  }));
  writeFileSync(join(TMP, 'reports', 'fixarea', 'history', 'index.json'), JSON.stringify([{ sliceId: 's1', stamp: '20260802000000', generated }]));
  const port = await freePort();
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: { ...process.env, CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await hit('/api/csrf')).status === 200; } catch { /* not up yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(up, 'panel did not come up against the fixture registry');
});
after(() => { child?.kill('SIGKILL'); rmSync(TMP, { recursive: true, force: true }); });

describe('route — /api/posture', () => {
  test('serves the board for the selected area, worst first', async () => {
    // `project` resolves as an AREA (projectSlug -> areaOut), the chain every per-project route uses
    const r = await hit('/api/posture?project=fixarea');
    assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.body.slice(0, 200)}`);
    assert.ok(r.json && r.json.ok, 'the route must answer with the computed board');
    assert.ok(Array.isArray(r.json.approaches) && r.json.approaches.length, 'approaches must be present');
    assert.equal(r.json.approaches[0].light, 'red',
      'the worst light sorts first — a red buried under greens is a red nobody sees');
    assert.equal(r.json.approaches[0].check, 'dockerfile-lint');
  });

  test('an approach that ran nowhere is GREY over the wire, and says it is a void', async () => {
    const { json } = await hit('/api/posture?project=fixarea');
    const fuzz = json.approaches.find((a) => a.check === 'api-fuzz');
    assert.ok(fuzz, 'api-fuzz must appear — it is declared by the area’s manifest');
    assert.equal(fuzz.light, 'grey', 'scanned nowhere is explicit uncertainty');
    assert.match(fuzz.why, /void/i, 'and the reason must name it, so nobody reads it as clean');
  });

  test('every approach carries its declared type and escalation guidance', async () => {
    const { json } = await hit('/api/posture?project=fixarea');
    for (const a of json.approaches) {
      assert.ok(a.type, `${a.check} reached the panel with no declared type`);
      assert.ok(a.escalates, `${a.check} reached the panel with no escalation guidance`);
    }
  });

  test('the toolchain answer is stamped with when it was probed — it is cached for 5 minutes', async () => {
    const { json } = await hit('/api/posture?project=fixarea');
    assert.ok(json.toolchain, 'the toolchain lane must be present');
    assert.ok(json.toolchain.probedAt, 'a cached answer must carry its own timestamp rather than pose as current');
    assert.ok(!Number.isNaN(Date.parse(json.toolchain.probedAt)), 'probedAt must be a parseable instant');
    assert.ok(Array.isArray(json.toolchain.missing), 'missing tools are named, not merely counted');
  });

  test('an unknown project degrades to the default area rather than 400 or leaking a path', async () => {
    const r = await hit('/api/posture?project=' + encodeURIComponent('../../etc/passwd'));
    assert.equal(r.status, 200);
    assert.ok(r.json && r.json.ok, 'the closed-set project check must degrade, never throw');
  });

  test('a missing lifecycle.json reports present:false — NOT "nothing is overdue"', async () => {
    const { json } = await hit('/api/posture?project=fixarea');
    assert.equal(json.escalation.present, false,
      'this fixture has no lifecycle.json; unreadable and clean must never render the same');
  });
});
