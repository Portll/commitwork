// /api/state's scanner drill-down at the wire (render half in scanner-tabs.test.mjs):
// scannerFindings is the area rollup's block verbatim, no gitleaks source fields cross the
// published tunnel, and a rollup-less area reports null. Self-contained tree via CW_REGISTRY.

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
const TMP = mkdtempSync(join(tmpdir(), 'cw-sfroute-'));

// the shape §1/§2 actually emit: whitelisted rows, fleet-flattened, one category carried
const FIXTURE_FINDINGS = {
  secrets: [
    { repo: 'alpha', rule: 'aws-key', file: 'src/a.js', line: 5, commit: 'abc123def456', redacted: true },
    { repo: 'alpha', rule: 'generic-token', file: 'src/b.js', line: 9, commit: 'abc123def456', redacted: true },
  ],
  maliciousPackages: [
    { repo: 'alpha', id: 'MAL-2025-47141', package: '@ctrl/tinycolor', version: '4.1.1', ecosystem: 'npm', advisory: 'https://osv.dev/vulnerability/MAL-2025-47141' },
  ],
  supplyChainHeuristic: [],
};
const FIXTURE_ROLLUP = {
  generated: '2026-08-01T10:00:00.000Z', sliceVersion: 1, sliceId: 'sweep-20260801100000', kind: 'sweep',
  totals: { repos: 1, crit: 1, high: 2, med: 0, low: 0, kev: 0, cves: 0 },
  scanned: { repos: 1, intendedRepos: 1, osv: 1, npm: 0 },
  coverage: { resolved: 1, swept: 1, unswept: [], scope: 'area-scoped' },
  scanners: {
    secrets: { crit: 0, high: 2, med: 0, low: 0, total: 2, repos: 1, ran: 1, skipped: 0, noscan: 0, check: 'secrets-gitleaks' },
    maliciousPackages: { crit: 1, high: 0, med: 0, low: 0, total: 1, repos: 1, ran: 1, skipped: 0, noscan: 0, check: 'deps-osv' },
    supplyChainHeuristic: { crit: 0, high: 0, med: 0, low: 0, total: 0, repos: 1, ran: 0, skipped: 1, noscan: 0, check: 'supply-chain-guarddog', carried: true, carriedFrom: 'sweep-20260731090000', carriedAt: '2026-07-31T09:00:00.000Z' },
  },
  scannerFindings: FIXTURE_FINDINGS,
  repos: [{ name: 'alpha', worst: 'high', findings: [] }],
};

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
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true },
      // declared but never swept — the honest-absence path: an empty area dir, no rollup.json
      { slug: 'empty-area', label: 'empty-area', out: 'empty-area' }],
  }));
  mkdirSync(join(TMP, 'reports', 'fixarea'), { recursive: true });
  mkdirSync(join(TMP, 'reports', 'empty-area'), { recursive: true });
  writeFileSync(join(TMP, 'reports', 'fixarea', 'rollup.json'), JSON.stringify(FIXTURE_ROLLUP));
  // the structured CodeQL snapshot — the panel's only CodeQL source; coverage rides through
  writeFileSync(join(TMP, 'reports', 'fixarea', 'codeql-fleet.json'), JSON.stringify({
    generated: '2026-08-01T10:05:00.000Z', batch: 'sweep-20260801100000-fixarea', area: 'fixarea',
    coverage: { area: 'fixarea', scope: 'area', label: 'fixarea', basis: 'sweep-20260801100000-fixarea declares area fixarea' },
    scanned: 1, totals: { crit: 0, high: 3, med: 1, low: 0, total: 4 },
    perService: [{ service: 'alpha', lifecycle: 'active', crit: 0, high: 3, med: 1, low: 0, total: 4 }],
    findings: [],
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

test('scannerFindings rides /api/state verbatim — pass-through, not re-derivation', async () => {
  const r = await hit('/api/state?project=fixarea');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.scannerFindings, FIXTURE_FINDINGS,
    'the panel and the rollup must not be able to disagree about the detail rows');
  assert.equal(r.json.scanners.supplyChainHeuristic.carried, true, 'the carried marker must survive the wire');
});

test('the payload never carries gitleaks source fields', async () => {
  const r = await hit('/api/state?project=fixarea');
  // Matched as a KEY (`"Entropy":`), not anywhere in the body. A leaked source field is a key with
  // a value under it; the old body-wide form also matched any LABEL with the same text, and from
  // 2026-08-24 the secrets lane declares a column labelled "Entropy" whose panelSchema block rides
  // this payload — so the naive form failed on `"label":"Entropy"`, which discloses nothing.
  // Narrowed deliberately rather than by deleting a name from the list: all four still fail here.
  assert.ok(!/"(Secret|Match|Entropy|Fingerprint)"\s*:/.test(r.body),
    'a gitleaks source field reached /api/state — this response leaves the box over the published tunnel');
  // NOT VACUOUS: the assertion above must still fire on a real leak of each name.
  for (const f of ['Secret', 'Match', 'Entropy', 'Fingerprint']) {
    assert.ok(/"(Secret|Match|Entropy|Fingerprint)"\s*:/.test(`{"${f}":"AKIAIOSFODNN7EXAMPLE"}`),
      `the narrowed pattern stopped catching a leaked ${f} field`);
  }
  // And the lowercase derived column is NOT a source field — it is a rounded float, never a value.
  assert.ok(!/"Secret"|"Match"|"Fingerprint"/.test(r.body), 'no gitleaks source field name appears at all');
});

test('the codeql block is read from codeql-fleet.json — structured file, not a scraped log', async () => {
  const r = await hit('/api/state?project=fixarea');
  assert.equal(r.status, 200);
  assert.equal(r.json.codeql.findings, 4, 'findings must be the file\'s totals.total');
  assert.equal(r.json.codeql.scanned, 1);
  assert.equal(r.json.codeql.batch, 'sweep-20260801100000-fixarea');
  assert.equal(r.json.codeql.coverage.scope, 'area', 'coverage rides through — scope none must stay distinguishable from a clean 0');
  assert.equal(r.json.has.codeql, true);
});

test('an area with no codeql-fleet.json reports codeql:null and has.codeql:false — never a fabricated snapshot', async () => {
  const r = await hit('/api/state?project=empty-area');
  assert.equal(r.status, 200);
  assert.equal(r.json.codeql, null);
  assert.equal(r.json.has.codeql, false);
});

test('a DECLARED area with no rollup reports null — absence, never {} posing as measured-clean', async () => {
  // the honest-absence contract is for a declared-but-never-swept area — that is what is pinned
  const r = await hit('/api/state?project=empty-area');
  assert.equal(r.status, 200);
  assert.equal(r.json.scannerFindings, null);
  assert.equal(r.json.scanners, null, 'the counts block obeys the same rule');
});
