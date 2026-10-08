// monitor/test/pipeline-canary.test.mjs — a planted finding survives reports/ -> rollup.json ->
// history slice -> history/index.json. Three plants: an inert gitleaks finding, an osv.sarif CVE,
// and a zero-rules semgrep.sarif that must read norules:true. Hermetic: tmp dirs, fetch removed.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// An index row names its batch by KEY (the dir relative to the reports root) since 2026-09-02, and
// by ABSOLUTE PATH before that. Both forms are live — rollup's own dedupe normalises them through
// area.mjs sourceKey — so a reader must accept either. Comparing the raw string to an absolute
// path silently stopped matching on 2026-09-02 and read as "the row was never written".
const rowIsBatch = (e, batch) => e && (e.source === basename(batch) || e.source === batch);

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROLLUP = join(CW, 'monitor', 'rollup.mjs');
const NO_FETCH = 'data:text/javascript,globalThis.fetch = undefined;';
const REAL_REPORTS_ROOT = join(CW, 'reports');
const REAL_KEV = join(CW, 'monitor', 'data', 'kev.json');
const REAL_EPSS = join(CW, 'monitor', 'data', 'epss.json');

// grep-able markers that exist nowhere else — the hermeticity check searches for them
const REPO = 'pipeline-canary-hermetic-repo-2026-08-10';
const CANARY_CVE = 'CVE-2026-9999';
const GITLEAKS_RULE = 'pipeline-canary-inert-rule';

const AREAS = [{ slug: 'canary-area', label: 'canary', out: 'canary-area', primary: true, members: [REPO] }];

const checksRow = (check) => ({ check, status: 'pass', durationMs: 5, at: '2026-08-10T12:00:01.000Z' });

// Plant 1 — the dependency-CVE lane
const osvSarif = () => ({ runs: [{ tool: { driver: { name: 'osv-scanner', rules: [
  { id: CANARY_CVE, properties: { 'security-severity': '7.5' }, shortDescription: { text: `${CANARY_CVE}: a fictional test vulnerability, never real` } },
] } }, results: [
  { ruleId: CANARY_CVE, message: { text: `Package 'left-pad@9.9.9' is vulnerable to '${CANARY_CVE}'.` },
    locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///src/package-lock.json' } } }] },
] }] });
const cleanNpmAudit = JSON.stringify({ vulnerabilities: {} });

// Plant 2 — the gitleaks lane: syntactically valid, semantically inert (no Secret/Match field)
const gitleaksFinding = () => ([{ RuleID: GITLEAKS_RULE, File: 'src/config.js', StartLine: 12, Commit: 'deadbeef' }]);

// Plant 3 — the zero-rules SARIF husk: must read norules:true, never a clean pass
const zeroRuleSemgrepSarif = () => ({ runs: [{ tool: { driver: { name: 'semgrep', rules: [] } }, results: [] }] });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-pipeline-canary-'));
  const reg = { reportsRoot: join(root, 'reports'), monitorOutput: AREAS[0].out,
    defaultManifest: 'security-baseline', roots: [], projects: [], areas: AREAS };
  const regPath = join(root, 'projects.json');
  writeFileSync(regPath, JSON.stringify(reg));
  for (const a of AREAS) mkdirSync(join(root, 'reports', a.out), { recursive: true });

  const batch = join(root, 'reports', 'sweep-20260810130000-canary-area');
  const repoDir = join(batch, REPO);
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify({
    sliceId: 'sweep-20260810130000', kind: 'sweep', group: 'all', only: null, sweptAll: false,
    area: 'canary-area', areaOut: 'reports/canary-area', startedAt: '2026-08-10T13:00:00.000Z',
    scope: { repos: [{ name: REPO, manifests: ['security-baseline'] }], excluded: [], lifecycle: {} },
    anchors: {},
  }));

  writeFileSync(join(repoDir, 'osv.sarif'), JSON.stringify(osvSarif()));
  writeFileSync(join(repoDir, 'npm-audit.json'), cleanNpmAudit);
  writeFileSync(join(repoDir, 'gitleaks.json'), JSON.stringify(gitleaksFinding()));
  writeFileSync(join(repoDir, 'semgrep.sarif'), JSON.stringify(zeroRuleSemgrepSarif()));
  writeFileSync(join(repoDir, 'checks-status.json'), JSON.stringify([
    checksRow('deps-osv'), checksRow('npm-audit'), checksRow('secrets-gitleaks'), checksRow('sast'),
  ]));

  return { root, batch, regPath, out: join(root, 'reports', AREAS[0].out) };
}

const runRollup = (regPath, batch) => spawnSync(
  process.execPath, ['--import', NO_FETCH, ROLLUP, batch],
  { cwd: CW, encoding: 'utf8', env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: regPath, CW_MONITOR_OUT: '' } });

const sha256File = (p) => { try { return createHash('sha256').update(readFileSync(p)).digest('hex'); } catch { return null; } };

let FX, RUN, kevBefore, epssBefore, sentinel;

before(() => {
  // hermeticity baseline, taken BEFORE the run touches anything
  kevBefore = sha256File(REAL_KEV);
  epssBefore = sha256File(REAL_EPSS);
  // file-based `-newer` reference: a content grep over reports/ (~159k files) costs minutes; a
  // stat-only find narrows to files touched during this run's window
  sentinel = join(mkdtempSync(join(tmpdir(), 'cw-pipeline-canary-sentinel-')), 'sentinel');
  writeFileSync(sentinel, '');
  FX = fixture();
  RUN = runRollup(FX.regPath, FX.batch);
});

const readRollup = () => JSON.parse(readFileSync(join(FX.out, 'rollup.json'), 'utf8'));
const repoNamed = (n) => readRollup().repos.find((r) => r.name === n);

describe('pipeline canary — a planted finding survives reports/ -> rollup.json -> history slice -> index.json', () => {
  test('hop 0: the fixture rollup itself succeeds', () => {
    assert.equal(RUN.status, 0, `rollup failed: ${(RUN.stderr || '').slice(0, 1000)}`);
  });

  test('hop 1 (dep-CVE lane): the planted osv.sarif finding reaches repos[].findings in rollup.json', () => {
    const r = repoNamed(REPO);
    assert.ok(r, `${REPO} missing from rollup.json repos[]`);
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].id, CANARY_CVE);
    assert.equal(r.findings[0].package, 'left-pad');
    assert.equal(r.findings[0].severity, 'high');
  });

  test('hop 1 (secrets lane): the planted gitleaks finding reaches repos[].scanners.secrets in rollup.json', () => {
    const r = repoNamed(REPO);
    assert.ok(r.scanners, 'repo carries no scanners block at all');
    const secrets = r.scanners.secrets;
    assert.ok(secrets, 'secrets category absent from repos[].scanners');
    assert.equal(secrets.ran, true);
    // The canary's claim is SURVIVAL — the plant must reach this block. It is counted in `total`
    // whatever its grade, which is what makes total the right thing to assert here.
    assert.equal(secrets.total, 1);
    // The BUCKET changed 2026-08-24 and the canary must follow the contract, not pin the old one.
    // gitleaks performs no verification, so an unverified plant is UNDETERMINED, not high. Asserting
    // high here would re-pin the defect: 2,368 unverified regex matches published at high across the
    // 100-repo corpus while the verifying lane found 3 live credentials in the entire fleet.
    assert.equal(secrets.undetermined, 1, 'an unverified gitleaks plant is undetermined');
    assert.equal(secrets.high, 0, 'and must NOT be high — this is the regression guard');
  });

  test('hop 1 (secrets lane, fleet flatten): the same finding reaches the top-level scannerFindings.secrets row', () => {
    const rollup = readRollup();
    const rows = rollup.scannerFindings && rollup.scannerFindings.secrets;
    assert.ok(Array.isArray(rows), 'scannerFindings.secrets missing — the per-finding flatten dropped the category');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].repo, REPO);
    assert.equal(rows[0].rule, GITLEAKS_RULE);
    assert.equal(rows[0].file, 'src/config.js');
    assert.equal(rows[0].line, 12);
  });

  test('hop 1 (norules): the zero-rules semgrep.sarif reads norules:true — NEVER a clean pass', () => {
    const r = repoNamed(REPO);
    const semgrep = r.scanners.sastSemgrep;
    assert.ok(semgrep, 'sastSemgrep category absent from repos[].scanners');
    assert.equal(semgrep.ran, true, 'a run genuinely happened — this is not a void');
    assert.equal(semgrep.norules, true, 'zero loaded rules must not read as a clean run');
    assert.equal(semgrep.total, 0);
    assert.equal(semgrep.findings, undefined, 'a rules-empty run has nothing to detail, same as a husk');
    // total:0 alone is indistinguishable from a clean pass — norules tells the two apart
    assert.notEqual(semgrep.norules, undefined, 'without norules, this finding-free category would read as an ordinary clean scan');
  });

  test('hop 2: the CVE and secrets plants survive into the history slice unchanged', () => {
    const idx = JSON.parse(readFileSync(join(FX.out, 'history', 'index.json'), 'utf8'));
    const row = idx.find((e) => rowIsBatch(e, FX.batch));
    assert.ok(row, 'no history/index.json row for this batch');
    const slice = JSON.parse(readFileSync(join(FX.out, 'history', row.file), 'utf8'));

    assert.equal(slice.findings.length, 1, 'the CVE lane must carry exactly the one planted finding into the slice');
    assert.equal(slice.findings[0].id, CANARY_CVE);

    // slice.scanners is the fleet aggregate, not the per-repo repos[].scanners object
    assert.equal(slice.scanners.secrets.total, 1, 'the fleet-aggregate secrets count must carry the one planted finding');
    // Bucket changed 2026-08-24: an unverified gitleaks row is undetermined, never high.
    assert.equal(slice.scanners.secrets.undetermined, 1, 'the plant survives into the slice in its honest bucket');
    assert.equal(slice.scanners.secrets.high, 0);
    assert.equal(slice.scannerFindings.secrets.length, 1, 'the per-finding row must carry into the slice, not just the count');
    assert.equal(slice.scannerFindings.secrets[0].rule, GITLEAKS_RULE);
    assert.equal(slice.scanners.sastSemgrep.total, 0, 'the fleet aggregate correctly sums to zero (one repo, zero rows)');
  });

  test('hop 2, the boundary DELIBERATELY CROSSED (BACKLOG P): norules reaches the fleet aggregate as its own count', () => {
    // This pin used to assert the opposite — norules stayed per-repo evidence — so that wiring it
    // would be a deliberate edit here rather than an accident. That edit is this one (fleet half;
    // the CRA consumption half landed first): the planted zero-rules semgrep.sarif must now
    // surface as agg.norules beside the severity buckets, because a category whose repos are all
    // norules aggregates to total:0 and reads clean to anyone summing the four buckets.
    const idx = JSON.parse(readFileSync(join(FX.out, 'history', 'index.json'), 'utf8'));
    const row = idx.find((e) => rowIsBatch(e, FX.batch));
    const slice = JSON.parse(readFileSync(join(FX.out, 'history', row.file), 'utf8'));
    assert.equal(slice.scanners.sastSemgrep.norules, 1,
      'the one planted zero-rules repo must be counted in the fleet aggregate');
    assert.equal(readRollup().scanners.sastSemgrep.norules, 1,
      'rollup.json top-level scanners is the same fleet aggregate as the slice');
    // and the count is REPOS, never findings — a clean lane carries no key at all (omitted-when-
    // zero keeps re-roll bytes identical for unaffected categories; absent means counted-and-none)
    assert.equal(readRollup().scanners.secrets?.norules, undefined,
      'a lane with real rules carries no norules key');
  });

  test('hop 3: history/index.json row counts reflect every plant — the CVE lane AND the headline severity sum', () => {
    const idx = JSON.parse(readFileSync(join(FX.out, 'history', 'index.json'), 'utf8'));
    const row = idx.find((e) => rowIsBatch(e, FX.batch));
    assert.ok(row);
    // `total` is the dep-CVE lane's own row count (nowRecs.length) — the one planted osv finding.
    assert.equal(row.total, 1);
    // `high` sums both lanes — a plant dropped anywhere upstream reads 1, not 2
    // The CVE plant is high; the SECRETS plant is undetermined (gitleaks verifies nothing), so the
    // headline `high` sum is 1, not 2. The secrets plant is still proved to survive — by the
    // undetermined assertion in hop 2 and by the scannerFindings row, not by this sum.
    assert.equal(row.high, 1, 'the planted CVE is high; the planted secret is undetermined, not high');
    assert.equal(row.crit, 0);
    assert.equal(row.scannedRepos, 1);
  });

  test('the hermetic guarantee, checked directly: monitor/data/kev.json and epss.json are byte-identical before and after', () => {
    // proves the EPSS-write guard actually held with fetch disabled
    assert.equal(sha256File(REAL_KEV), kevBefore, 'monitor/data/kev.json changed — this run wrote to the real cache');
    assert.equal(sha256File(REAL_EPSS), epssBefore, 'monitor/data/epss.json changed — the EPSS fetch guard did not hold with fetch disabled');
  });

  test('the hermetic guarantee, checked directly: the canary markers appear NOWHERE under the real reports/ tree', () => {
    if (!existsSync(REAL_REPORTS_ROOT)) return; // nothing to search — trivially hermetic
    // narrow first (stat-only find), THEN grep — never a full content grep over this tree
    let touched;
    try { touched = execFileSync('find', [REAL_REPORTS_ROOT, '-type', 'f', '-newer', sentinel], { encoding: 'utf8' }); }
    catch (e) { throw new Error(`find over ${REAL_REPORTS_ROOT} failed: ${e.stderr || e.message}`); }
    const files = touched.split('\n').filter(Boolean);
    // An EMPTY `files` is the pass, not a vacuous one: nothing under the real tree was touched at
    // all, which is the strongest form of hermetic. The sentinel is what could void it silently.
    assert.ok(existsSync(sentinel), 'the sentinel is gone — `find -newer` would match nothing and this would read as hermetic');
    const markers = [REPO, CANARY_CVE, GITLEAKS_RULE];
    for (const f of files) {
      let body;
      try { body = readFileSync(f, 'utf8'); } catch { continue; } // gone/unreadable by the time we got here — nothing to check
      for (const marker of markers) {
        assert.ok(!body.includes(marker), `canary marker "${marker}" leaked into the real reports/ tree: ${f}`);
      }
    }
  });
});
