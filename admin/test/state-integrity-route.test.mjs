// /api/state at the wire, against a really-spawned panel: the R1 integrity fields (conservation,
// artifactAnomalies, timelineVerify) arrive PROJECTED, and the runtime tls/cspm card fields carry
// only their allowlist. Fixture-driven end to end — the registry, the reports tree and the
// anomalies file are all this test's own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-integrity-'));

// strings planted in the fixtures that must never leave through /api/state
const LEAK_MARKERS = ['sess-leak-1', '/abs/leak/path', 'full-digest-must-not-cross'];

const SLICE_BODY = JSON.stringify({ sliceId: 'sweep-good', findings: [] });
const FIXTURE_ROLLUP = {
  generated: '2026-09-01T00:00:00.000Z', sliceVersion: 1, sliceId: 'sweep-20260901000000',
  totals: { repos: 1, crit: 0, high: 0, med: 0, low: 0, kev: 0, cves: 0 },
  scanners: { secrets: { crit: 0, high: 0, med: 0, low: 0, total: 2, repos: 1, ran: 1, skipped: 0, noscan: 0 } },
  repos: [{ name: 'alpha', worst: 'none', findings: [] }],
  conservation: {
    checked: ['secrets'],
    violations: [{ category: 'secrets', declared: 2, published: 1, truncated: 0, session: 'sess-leak-1' }],
  },
};
const FIXTURE_ANOMALIES = [{
  category: 'secrets', hash: `${'a'.repeat(40)}full-digest-must-not-cross`, repoCount: 6, bytes: 700,
  repos: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'], truncated: 0,
  session: 'sess-leak-1', note: '/abs/leak/path',
}];
const FIXTURE_INDEX = [
  { sliceId: 's-legacy', stamp: '20260830000000', file: '20260830000000.json', generated: '2026-08-30T00:00:00.000Z' },
  { sliceId: 's-good', stamp: '20260831000000', file: '20260831000000.json', generated: '2026-08-31T00:00:00.000Z',
    sliceSha256: createHash('sha256').update(SLICE_BODY).digest('hex') },
  { sliceId: 's-bad', stamp: '20260901000000', file: '20260901000000.json', generated: '2026-09-01T00:00:00.000Z',
    sliceSha256: 'f'.repeat(64) },
];

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
    reportsRoot: join(TMP, 'reports'),
    defaultManifest: 'security-baseline', roots: [], projects: [],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true }],
  }));
  const area = join(TMP, 'reports', 'fixarea');
  mkdirSync(join(area, 'history'), { recursive: true });
  writeFileSync(join(area, 'rollup.json'), JSON.stringify(FIXTURE_ROLLUP));
  writeFileSync(join(TMP, 'reports', 'artifact-anomalies.json'), JSON.stringify(FIXTURE_ANOMALIES));
  writeFileSync(join(area, 'history', 'index.json'), JSON.stringify(FIXTURE_INDEX));
  writeFileSync(join(area, 'history', '20260831000000.json'), SLICE_BODY);
  writeFileSync(join(area, 'history', '20260901000000.json'), SLICE_BODY); // does not match its recorded hash
  // s-legacy's slice file deliberately absent AND unhashed — legacy means "no hash recorded"

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

test('conservation arrives checked-with-violations, rows allowlisted', async () => {
  const r = await hit('/api/state?project=fixarea');
  assert.equal(r.status, 200);
  const c = r.json.conservation;
  assert.equal(c.state, 'checked');
  assert.deepEqual(c.checked, ['secrets']);
  assert.deepEqual(c.violations, [{ category: 'secrets', declared: 2, published: 1, truncated: 0 }]);
});

test('artifact anomalies arrive measured, hash as a 12-char prefix', async () => {
  const r = await hit('/api/state?project=fixarea');
  const a = r.json.artifactAnomalies;
  assert.equal(a.state, 'measured');
  assert.equal(a.count, 1);
  assert.equal(a.anomalies[0].hash, 'a'.repeat(12));
  assert.equal(a.anomalies[0].repoCount, 6);
});

test('timeline verify: verified / unverified-legacy / unreadable counted per slice', async () => {
  const r = await hit('/api/state?project=fixarea');
  const tv = r.json.timelineVerify;
  assert.equal(tv.state, 'ok');
  assert.deepEqual(tv.counts, { verified: 1, 'unverified-legacy': 1, unreadable: 1 });
  const by = Object.fromEntries(tv.slices.map((s) => [s.sliceId, s.verify]));
  assert.deepEqual(by, { 's-legacy': 'unverified-legacy', 's-good': 'verified', 's-bad': 'unreadable' });
});

test('no project selected: absence renders as its own state, never a clean read', async () => {
  const r = await hit('/api/state');
  assert.equal(r.json.conservation.state, 'never-checked');
  assert.equal(r.json.timelineVerify.state, 'no-history');
  // anomalies are fleet-level (reports root), independent of the selected project
  assert.equal(r.json.artifactAnomalies.state, 'measured');
});

test('planted leak markers never cross /api/state; runtime card fields stay allowlisted', async () => {
  const r = await hit('/api/state?project=fixarea');
  for (const m of LEAK_MARKERS) assert.ok(!r.body.includes(m), `state leaked ${m}`);
  const tls = r.json.runtime && r.json.runtime.tlsHeaders;
  if (tls) {
    assert.ok(Object.keys(tls).every((k) => ['status', 'headers'].includes(k)), 'tls carries only status/headers');
    if (tls.headers) assert.ok(Object.keys(tls.headers).every((k) => ['ran', 'grade', 'missing'].includes(k)));
  }
  const cspm = r.json.runtime && r.json.runtime.cspm;
  if (cspm) assert.ok(Object.keys(cspm).every((k) => ['ran', 'pass', 'fail', 'reason'].includes(k)), 'cspm carries only ran/pass/fail/reason');
});
