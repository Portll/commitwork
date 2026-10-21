// explicit uncertainty for the CodeQL dashboard number: a codeql-fleet.json that exists but fails to
// parse collapses to codeql:null / has.codeql:false (never a fabricated zero), while a well-formed
// all-zero file still renders as a real 0.
import { test, before, after } from 'node:test';
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
const TMP = mkdtempSync(join(tmpdir(), 'cw-codeql-honesty-'));

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
    defaultManifest: 'security-baseline', roots: [], projects: [],
    areas: [
      { slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true },
      // exists, but the bytes on disk are not valid JSON
      { slug: 'corrupt-area', label: 'corrupt-area', out: 'corrupt-area' },
      // exists, well-formed, and its totals really are all zero — a genuinely clean scan.
      { slug: 'clean-area', label: 'clean-area', out: 'clean-area' },
      // no codeql-fleet.json at all — never swept for CodeQL, or swept before this producer existed.
      { slug: 'absent-area', label: 'absent-area', out: 'absent-area' },
    ],
  }));
  for (const a of ['fixarea', 'corrupt-area', 'clean-area', 'absent-area']) mkdirSync(join(TMP, 'reports', a), { recursive: true });
  // every area needs SOME rollup.json or reportsFor() falls back to the default area's dir
  for (const a of ['corrupt-area', 'clean-area', 'absent-area']) {
    writeFileSync(join(TMP, 'reports', a, 'rollup.json'), JSON.stringify({
      generated: '2026-08-01T10:00:00.000Z', totals: { repos: 0, crit: 0, high: 0, med: 0, low: 0, kev: 0, cves: 0 },
      repos: [],
    }));
  }
  writeFileSync(join(TMP, 'reports', 'corrupt-area', 'codeql-fleet.json'), '{ this is not JSON at all,,,');
  writeFileSync(join(TMP, 'reports', 'clean-area', 'codeql-fleet.json'), JSON.stringify({
    generated: '2026-08-01T10:05:00.000Z', batch: 'sweep-20260801100000-clean-area', area: 'clean-area',
    coverage: { area: 'clean-area', scope: 'area', label: 'clean-area', basis: 'sweep-20260801100000-clean-area declares area clean-area' },
    scanned: 3, totals: { crit: 0, high: 0, med: 0, low: 0, total: 0 },
    perService: [], findings: [],
  }));

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

test('a codeql-fleet.json that fails to parse reads as unavailable, never as zero findings', async () => {
  const r = await hit('/api/state?project=corrupt-area');
  assert.equal(r.status, 200);
  assert.equal(r.json.codeql, null,
    'a parse failure must not degrade into a fabricated {findings:0,...} — that IS the run.log defect this replaces');
  assert.equal(r.json.has.codeql, false,
    'the capability flag must say "not available for this area", not silently pass a broken read through as a capability');
});

test('a genuinely clean scan (well-formed file, real all-zero totals) is still allowed to read as 0', async () => {
  const r = await hit('/api/state?project=clean-area');
  assert.equal(r.status, 200);
  assert.equal(r.json.codeql.findings, 0);
  assert.equal(r.json.has.codeql, true,
    'the capability flag must stay true here — a real recorded zero is data, not absence, and must be distinguishable from corrupt-area above');
  assert.equal(r.json.codeql.coverage.scope, 'area', 'the zero must be attributable to a batch that actually covered this area');
});

test('corrupt and absent collapse to the SAME honest state, distinct from a real zero', async () => {
  const corrupt = await hit('/api/state?project=corrupt-area');
  const absent = await hit('/api/state?project=absent-area');
  const clean = await hit('/api/state?project=clean-area');
  assert.equal(corrupt.json.codeql, null);
  assert.equal(absent.json.codeql, null);
  assert.equal(corrupt.json.has.codeql, false);
  assert.equal(absent.json.has.codeql, false);
  assert.notEqual(clean.json.codeql, null);
  assert.equal(clean.json.has.codeql, true,
    'a real recorded zero must stay distinguishable from both the corrupt and the never-produced fixtures above');
});
