// monitor/test/rollup-unparseable-cve.test.mjs — A-1: parseOsv/parseNpm return {rows, state} with
// state ∈ absent|ok|unparseable (extractors.mjs's void pattern, ~:87), and an unparseable dep-CVE
// artifact must surface as `noscan` on the repo — never as the zero findings a failed JSON.parse
// already produces on its own. This is F1 (Sauron 2026-08-10, CRITICAL): "catch { return [] } —
// corrupt dep-CVE artifact renders repo clean; extractors.mjs already has the correct void pattern
// for the same class."
//
// WHAT IS ASSERTED, per the plan's verification item 2:
//   (a) a VALID osv.sarif carrying one real finding survives to rollup.json unchanged — the control,
//       proving the fix costs the happy path nothing.
//   (b) a TRUNCATED osv.sarif (present, invalid JSON — a crashed sweep's classic shape) reads as
//       noscan, never as a clean zero.
//   (c) a ZERO-BYTE npm-audit.json reads as noscan, never as a clean zero.
//   (d) a PARSEABLE non-SARIF (a tool's error object — valid JSON, no runs[]) reads as noscan;
//       parseOsv returned a literal state:'ok' for this shape until 2026-08-21.
// and the part a naive "findings.length === 0" check would miss entirely: a corrupt repo and a
// genuinely scanned-clean repo both end up with findings:[] — so this also proves the two states are
// NOT byte-identical, via the one field still standing between them (repos[].noscan).
//
// Same harness as rollup-scanner-findings.test.mjs / rollup-scope-routing.test.mjs: a self-contained
// reports root + registry via CW_REGISTRY, the real rollup.mjs as a child process, fetch disabled
// (the control finding carries a CVE id, which would otherwise trigger a live EPSS lookup and a
// monitor/data write).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

const REPOS = ['control-repo', 'corrupt-osv-repo', 'corrupt-npm-repo', 'clean-repo', 'husk-osv-repo'];
// `members` is required — registry.mjs's areaOf() falls back to treating an unlisted repo as its
// OWN area (ownArea()), which then fails rollup.mjs's mixed-batch scope check (every repo "belongs"
// to itself, none of them to 'primary-area').
const AREAS = [{ slug: 'primary-area', label: 'primary', out: 'primary-area', primary: true, members: REPOS }];
const CONTROL_CVE = 'CVE-2026-9001';

const checksRow = (check) => ({ check, status: 'pass', durationMs: 5, at: '2026-08-10T12:00:01.000Z' });

// one real finding — the control. Package/version match the `pm` regex parseOsv still uses,
// untouched by this plan item (BACKLOG item M reserves identity-feeding regex changes for a
// dedicated migration).
const validOsvSarif = () => ({ runs: [{ tool: { driver: { name: 'osv-scanner', rules: [
  { id: CONTROL_CVE, properties: { 'security-severity': '7.5' }, shortDescription: { text: `${CONTROL_CVE}: a benign test vulnerability` } },
] } }, results: [
  { ruleId: CONTROL_CVE, message: { text: `Package 'undici@7.24.8' is vulnerable to '${CONTROL_CVE}'.` },
    locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///src/package-lock.json' } } }] },
] }] });

// valid SARIF, zero results — a REAL scanned-clean, not a stand-in for corruption.
const emptyOsvSarif = { runs: [{ tool: { driver: { name: 'osv-scanner', rules: [] } }, results: [] }] };
const cleanNpmAudit = JSON.stringify({ vulnerabilities: {} });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-unparseable-cve-'));
  const reg = { reportsRoot: join(root, 'reports'), monitorOutput: AREAS[0].out,
    defaultManifest: 'security-baseline', roots: [], projects: [], areas: AREAS };
  const regPath = join(root, 'projects.json');
  writeFileSync(regPath, JSON.stringify(reg));
  for (const a of AREAS) mkdirSync(join(root, 'reports', a.out), { recursive: true });

  const batch = join(root, 'reports', 'sweep-20260810120000-primary-area');
  for (const name of REPOS) mkdirSync(join(batch, name), { recursive: true });
  writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify({
    sliceId: 'sweep-20260810120000', kind: 'sweep', group: 'all', only: null, sweptAll: false,
    area: 'primary-area', areaOut: 'reports/primary-area', startedAt: '2026-08-10T12:00:00.000Z',
    scope: { repos: REPOS.map((n) => ({ name: n, manifests: ['security-baseline'] })), excluded: [], lifecycle: {} },
    anchors: {},
  }));

  // control-repo: everything parses, one real finding — must survive untouched.
  writeFileSync(join(batch, 'control-repo', 'osv.sarif'), JSON.stringify(validOsvSarif()));
  writeFileSync(join(batch, 'control-repo', 'npm-audit.json'), cleanNpmAudit);
  writeFileSync(join(batch, 'control-repo', 'checks-status.json'), JSON.stringify([checksRow('deps-osv'), checksRow('npm-audit')]));

  // corrupt-osv-repo: osv.sarif is a TRUNCATED write (a crashed sweep's classic shape) — present and
  // invalid, not merely empty. npm side is genuinely clean, isolating which parser is under test.
  // checks-status.json still says 'pass' for deps-osv: the runner exited 0 before the file was cut —
  // exactly F1's scenario — so the synthetic noscan entry must stand ALONGSIDE that stale 'pass',
  // never replace it (a real record must never be dropped to make room for a derived one).
  const truncated = JSON.stringify(validOsvSarif()).slice(0, 40);
  writeFileSync(join(batch, 'corrupt-osv-repo', 'osv.sarif'), truncated);
  writeFileSync(join(batch, 'corrupt-osv-repo', 'npm-audit.json'), cleanNpmAudit);
  writeFileSync(join(batch, 'corrupt-osv-repo', 'checks-status.json'), JSON.stringify([checksRow('deps-osv'), checksRow('npm-audit')]));

  // corrupt-npm-repo: npm-audit.json is ZERO-BYTE (verification item 2's third fixture) — osv side is
  // a genuine scanned-clean (valid SARIF, zero results), isolating the npm parser.
  writeFileSync(join(batch, 'corrupt-npm-repo', 'osv.sarif'), JSON.stringify(emptyOsvSarif));
  writeFileSync(join(batch, 'corrupt-npm-repo', 'npm-audit.json'), '');
  writeFileSync(join(batch, 'corrupt-npm-repo', 'checks-status.json'), JSON.stringify([checksRow('deps-osv'), checksRow('npm-audit')]));

  // husk-osv-repo: osv.sarif is the tool's own error object (valid JSON, no runs[]); npm side clean
  writeFileSync(join(batch, 'husk-osv-repo', 'osv.sarif'), JSON.stringify({ error: 'osv-scanner: permission denied' }));
  writeFileSync(join(batch, 'husk-osv-repo', 'npm-audit.json'), cleanNpmAudit);
  writeFileSync(join(batch, 'husk-osv-repo', 'checks-status.json'), JSON.stringify([checksRow('deps-osv'), checksRow('npm-audit')]));

  // clean-repo: BOTH artifacts valid and empty — the genuinely-clean baseline. Ends up with the same
  // findings:[] as the two corrupt repos above; only .noscan is allowed to tell them apart.
  writeFileSync(join(batch, 'clean-repo', 'osv.sarif'), JSON.stringify(emptyOsvSarif));
  writeFileSync(join(batch, 'clean-repo', 'npm-audit.json'), cleanNpmAudit);
  writeFileSync(join(batch, 'clean-repo', 'checks-status.json'), JSON.stringify([checksRow('deps-osv'), checksRow('npm-audit')]));

  return { root, batch, regPath, out: join(root, 'reports', AREAS[0].out) };
}

const runRollup = (regPath, batch) => spawnSync(
  process.execPath, ['--import', NO_FETCH, ROLLUP, batch],
  { cwd: CW, encoding: 'utf8', env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: regPath, CW_MONITOR_OUT: '' } });

const FX = fixture();
const RUN = runRollup(FX.regPath, FX.batch);
const readRollup = () => JSON.parse(readFileSync(join(FX.out, 'rollup.json'), 'utf8'));
const repoNamed = (n) => readRollup().repos.find((r) => r.name === n);

describe('A-1 — an unparseable dep-CVE artifact reads as noscan, never clean', () => {
  test('the fixture rollup itself succeeds', () => {
    assert.equal(RUN.status, 0, `rollup failed: ${(RUN.stderr || '').slice(0, 800)}`);
  });

  test('control: a VALID osv.sarif finding survives to output untouched', () => {
    const r = repoNamed('control-repo');
    assert.ok(r, 'control-repo missing from rollup.json repos[]');
    assert.equal(r.findings.length, 1, 'the one real finding must survive parsing');
    assert.equal(r.findings[0].id, CONTROL_CVE);
    assert.equal(r.findings[0].package, 'undici');
    assert.equal(r.findings[0].version, '7.24.8');
    assert.equal(r.findings[0].severity, 'high');
    assert.equal(r.noscan, 0, 'a repo with no unparseable artifact must not carry a noscan count');
  });

  test('a TRUNCATED osv.sarif: zero findings AND noscan:1 — never a silent clean', () => {
    const r = repoNamed('corrupt-osv-repo');
    assert.equal(r.findings.length, 0, 'a corrupt artifact yields no findings — it cannot be trusted to parse');
    assert.equal(r.noscan, 1, 'the unparseable osv.sarif must surface as exactly one noscan');
  });

  test('a ZERO-BYTE npm-audit.json: zero findings AND noscan:1 — never a silent clean', () => {
    const r = repoNamed('corrupt-npm-repo');
    assert.equal(r.findings.length, 0, 'a zero-byte artifact yields no findings — it cannot be trusted to parse');
    assert.equal(r.noscan, 1, 'the unparseable npm-audit.json must surface as exactly one noscan');
  });

  test("a PARSEABLE non-SARIF (the tool's error object, no runs[]) is noscan with the never-ran reason — a literal 'ok' cannot emerge from rollup", () => {
    const r = repoNamed('husk-osv-repo');
    assert.equal(r.findings.length, 0, 'an error object yields no findings — there is nothing to read');
    assert.equal(r.noscan, 1, 'the runs-less osv.sarif must surface as exactly one noscan — this exact shape scored state:ok before 2026-08-21');
    // the reason must name the never-ran void, not the unparseable one
    const idx = JSON.parse(readFileSync(join(FX.out, 'history', 'index.json'), 'utf8'));
    const row = idx.find((e) => rowIsBatch(e, FX.batch));
    const slice = JSON.parse(readFileSync(join(FX.out, 'history', row.file), 'utf8'));
    const noscans = (slice.checks['husk-osv-repo'] || []).filter((c) => c.status === 'noscan');
    assert.equal(noscans.length, 1);
    assert.equal(noscans[0].check, 'deps-osv');
    assert.equal(noscans[0].reason, 'artifact present but not a sarif document — no runs[]');
  });

  test('a genuinely clean repo (valid + empty both sides) carries NO noscan', () => {
    const r = repoNamed('clean-repo');
    assert.equal(r.findings.length, 0);
    assert.equal(r.noscan, 0);
  });

  test('corrupt is NOT byte-identical to clean — findings agree, noscan is the tell', () => {
    const corruptOsv = repoNamed('corrupt-osv-repo');
    const corruptNpm = repoNamed('corrupt-npm-repo');
    const clean = repoNamed('clean-repo');
    // the naive comparison a pre-fix reader would make — both present zero findings
    assert.deepEqual(corruptOsv.findings, clean.findings, 'setup: both must show zero findings for this test to mean anything');
    assert.deepEqual(corruptNpm.findings, clean.findings);
    // and yet the two states must not present identically: this is F1's whole point
    assert.notEqual(corruptOsv.noscan, clean.noscan, 'corrupt-osv-repo must be distinguishable from clean-repo despite equal findings[]');
    assert.notEqual(corruptNpm.noscan, clean.noscan, 'corrupt-npm-repo must be distinguishable from clean-repo despite equal findings[]');
  });

  test('exactly ONE mechanism: the synthetic entry sits ALONGSIDE the stale pass, never replaces it, and no repo double-counts', () => {
    const idx = JSON.parse(readFileSync(join(FX.out, 'history', 'index.json'), 'utf8'));
    const row = idx.find((e) => rowIsBatch(e, FX.batch));
    assert.ok(row, 'no history/index.json row for this batch');
    const slice = JSON.parse(readFileSync(join(FX.out, 'history', row.file), 'utf8'));

    const osvChecks = slice.checks['corrupt-osv-repo'];
    assert.equal(osvChecks.filter((c) => c.check === 'deps-osv' && c.status === 'pass').length, 1,
      'the ORIGINAL checks-status pass entry must survive — the append never overwrites real data');
    const osvNoscans = osvChecks.filter((c) => c.status === 'noscan');
    assert.equal(osvNoscans.length, 1, 'exactly one synthetic entry — never appended twice, never double-counted into r.noscan');
    assert.equal(osvNoscans[0].check, 'deps-osv');
    assert.equal(osvNoscans[0].reason, 'artifact present but unparseable');

    const npmChecks = slice.checks['corrupt-npm-repo'];
    assert.equal(npmChecks.filter((c) => c.check === 'npm-audit' && c.status === 'pass').length, 1);
    const npmNoscans = npmChecks.filter((c) => c.status === 'noscan');
    assert.equal(npmNoscans.length, 1);
    assert.equal(npmNoscans[0].check, 'npm-audit');

    // control/clean repos parsed fine — no synthetic entry should exist for either
    assert.equal((slice.checks['control-repo'] || []).filter((c) => c.status === 'noscan').length, 0);
    assert.equal((slice.checks['clean-repo'] || []).filter((c) => c.status === 'noscan').length, 0);

    // A-2a, exercised incidentally by this same fixture: no remediation-ledger.json exists here, so
    // this is ENOENT — legitimately absent, never the unreadable state ledgerUnreadable reports. The
    // field itself must always be published (checked-conforms discipline), never merely omitted.
    assert.equal(typeof slice.ledgerUnreadable, 'boolean', 'ledgerUnreadable must always be published as a boolean, never omitted');
    assert.equal(slice.ledgerUnreadable, false, 'ENOENT (no ledger file at all) must never read as unreadable');
  });
});
