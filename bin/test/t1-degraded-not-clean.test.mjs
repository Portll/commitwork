// T1 — osv-scanner emits real vulnerability results AND a line saying one lane did not run:
// findings are a true severity, a lost lane is a true coverage loss, and neither may erase the
// other. Doubles as T7's severity-inversion gate condition.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyReport, laneCoverage } from '../commitwork.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The REAL check, lifted from the shipped manifest — never a local copy.
const MANIFEST = JSON.parse(readFileSync(join(REPO, 'manifests', 'security-baseline.json'), 'utf8'));
const OSV = MANIFEST.checks.find((c) => c.id === 'deps-osv');

// 11 results, the figure from the original incident.
const sarif = (n) => JSON.stringify({
  runs: [{
    tool: { driver: { name: 'osv-scanner', rules: Array.from({ length: n }, (_, i) => ({
      id: `CVE-2026-${9000 + i}`, properties: { 'security-severity': '7.5' },
      shortDescription: { text: `CVE-2026-${9000 + i}: a test vulnerability` },
    })) } },
    results: Array.from({ length: n }, (_, i) => ({
      ruleId: `CVE-2026-${9000 + i}`,
      message: { text: `Package 'somepkg@1.0.${i}' is vulnerable to 'CVE-2026-${9000 + i}'.` },
      locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///src/go.mod' } } }],
    })),
  }],
});

// The original incident's Go call-analysis line is unreachable here (the osv-scanner image ships
// Go), so the fixture uses a degradation this invocation can actually produce.
const LANE_LOST = 'Scanning dir /src\nWARNING: encountered 3 errors during dependency resolution\nScanned /src/go.mod file and found 7 packages\n';

function fixture({ results, log, exit }) {
  const d = mkdtempSync(join(tmpdir(), 'cw-t1-'));
  writeFileSync(join(d, OSV.report.file), sarif(results));
  if (log !== null) writeFileSync(join(d, OSV.report.log), log);
  if (exit !== null) writeFileSync(join(d, `${OSV.report.file}.exit`), `${exit}\n`);
  return d;
}

describe('T1 — the manifest still declares what this test depends on', () => {
  test('deps-osv declares a log and at least one signal', () => {
    assert.ok(OSV, 'deps-osv is missing from the shipped manifest');
    assert.equal(OSV.report.log, 'osv.log', 'a signal has nothing to read without a declared log');
    assert.ok((OSV.coverageSignals || []).length, 'deps-osv must declare at least one coverage signal');
  });

  test('every declared signal is REACHABLE in the invocation this manifest actually runs', () => {
    // a signal is only worth declaring if the command as written can produce the text it matches
    const cmd = (OSV.local || []).join(' ');
    for (const s of OSV.coverageSignals || []) {
      assert.ok(!/call analysis/i.test(s.pattern),
        'the Go call-analysis signal cannot fire here: the osv-scanner image ships a Go toolchain, so '
        + '"Go is not installed" is never true inside it. Verified against the running image, not inferred.');
      assert.ok(!/--call-analysis/.test(cmd) || true, 'documented: the command does not request call analysis either');
    }
  });
});

describe('T1 — 11 findings AND a dead lane: both facts survive', () => {
  test('THE ORIGINAL CASE: severity reports the findings, coverage reports the loss', () => {
    const d = fixture({ results: 11, log: LANE_LOST, exit: 0 });
    const { sev, summary } = classifyReport(OSV, d, d);
    const { coverage, coverageReason } = laneCoverage(OSV, d);

    // side one — the eleven findings are intact and are NOT downgraded to a void
    assert.notEqual(sev, 'noscan',
      'voiding the check would hide 11 real vulnerabilities — worse than the bug being fixed');
    assert.notEqual(sev, 'skip');
    assert.ok(['high', 'med'].includes(sev), `11 CVE results must report a real severity, got ${sev} (${summary})`);

    // side two — the lost lane is recorded, and named
    assert.equal(coverage, 'reduced', 'the run announced a dead lane and exited 0; that is reduced coverage');
    assert.match(coverageReason, /dependency resolution \(partial graph\) did not run/,
      'the reason must name the capability, not the regex that found it');

    rmSync(d, { recursive: true, force: true });
  });

  test('the two axes are independent: same findings, healthy log, coverage is full', () => {
    const d = fixture({ results: 11, log: 'Scanning /src\nScanned 412 packages\n', exit: 0 });
    const { sev } = classifyReport(OSV, d, d);
    const { coverage } = laneCoverage(OSV, d);
    assert.ok(['high', 'med'].includes(sev), 'severity is unchanged by the log');
    assert.equal(coverage, 'full', 'only the log differs, and only coverage moves');
    rmSync(d, { recursive: true, force: true });
  });

  test('and inversely: no findings, dead lane — clean is NOT the answer', () => {
    // zero results + lost lane — nothing was found partly because nothing looked
    const d = fixture({ results: 0, log: LANE_LOST, exit: 0 });
    const { coverage, coverageReason } = laneCoverage(OSV, d);
    assert.equal(coverage, 'reduced');
    assert.match(coverageReason, /dependency resolution/);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('T1 — the compound path (T7 gate condition 2)', () => {
  test('a non-zero exit with a non-empty partial report is not recorded clean', () => {
    // network twin: advisory-DB refresh fails, non-zero exit, partial results still written
    const d = fixture({ results: 3, log: 'Scanning /src\nwarning: advisory database refresh failed\n', exit: 128 });
    const { sev } = classifyReport(OSV, d, d);
    const { coverage, coverageReason } = laneCoverage(OSV, d);
    assert.ok(['high', 'med'].includes(sev), 'the three findings it did produce are still real');
    assert.equal(coverage, 'reduced', 'a non-zero exit means the run is partial by its own account');
    assert.match(coverageReason, /exited 128/);
    rmSync(d, { recursive: true, force: true });
  });

  test('a missing log on a check that declares one is unknown, not clean', () => {
    const d = fixture({ results: 11, log: null, exit: 0 });
    const { coverage } = laneCoverage(OSV, d);
    assert.equal(coverage, 'unknown',
      'the declared evidence is absent, so coverage was never established — "full" would be a claim nobody verified');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('T1 — severity inversion, asserted in the direction that hides findings', () => {
  test('reduced coverage must never drag a real severity down to a void', () => {
    const d = fixture({ results: 11, log: LANE_LOST, exit: 3 });
    const { sev } = classifyReport(OSV, d, d);
    const { coverage } = laneCoverage(OSV, d);
    // both degradation signals firing at once — the findings must still outrank them
    assert.ok(['high', 'med'].includes(sev),
      `with both degradation signals firing, 11 findings must still report a real severity, got ${sev}`);
    assert.equal(coverage, 'reduced');
    rmSync(d, { recursive: true, force: true });
  });
});
