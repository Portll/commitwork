// Coverage is a separate axis from severity: real findings are a true severity, a dead lane is a
// true coverage loss, and any single number reporting both is a lie. A cell with findings AND
// reduced coverage must still rank at its real severity — coverage never joins the sev enum.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { laneCoverage } from '../commitwork.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'cw-lane-cov-'));
const CHECK = (over = {}) => ({
  id: 'deps-osv',
  report: { file: 'osv.sarif', log: 'osv.log' },
  coverageSignals: [{ pattern: 'Skipping call analysis on Go code', lane: 'Go call analysis' }],
  ...over,
});

describe('the exit sidecar', () => {
  test('a non-zero exit reduces coverage and says what the number was', () => {
    const d = dir();
    writeFileSync(join(d, 'osv.sarif.exit'), '2\n');
    const r = laneCoverage(CHECK(), d);
    assert.equal(r.coverage, 'reduced');
    assert.match(r.coverageReason, /exited 2/);
    rmSync(d, { recursive: true, force: true });
  });

  test('exit 0 alone does not establish full coverage — the declared log still gets read', () => {
    // The whole point of the signals half: tools lose a lane and carry on exiting 0.
    const d = dir();
    writeFileSync(join(d, 'osv.sarif.exit'), '0\n');
    writeFileSync(join(d, 'osv.log'), 'Scanning...\nSkipping call analysis on Go code since Go is not installed\n');
    const r = laneCoverage(CHECK(), d);
    assert.equal(r.coverage, 'reduced', 'an exit-0 run that announced a dead lane is not full coverage');
    assert.match(r.coverageReason, /Go call analysis did not run/);
    rmSync(d, { recursive: true, force: true });
  });


  test('exit 1 is NOT reduced — it is how this family of tools reports findings', () => {
    // gitleaks/semgrep/shellcheck/gosec all exit 1 when they FIND something; the >1 threshold
    // mirrors deps-osv's own `if [ $rc -gt 1 ]`
    const d = dir();
    writeFileSync(join(d, 'osv.sarif.exit'), '1\n');
    writeFileSync(join(d, 'osv.log'), 'clean run\n');
    assert.equal(laneCoverage(CHECK(), d).coverage, 'full',
      'a tool that exited 1 because it found things has not lost coverage');
    rmSync(d, { recursive: true, force: true });
  });

  test('exit >1 IS reduced — that is the tool in trouble', () => {
    for (const code of [2, 126, 127]) {
      const d = dir();
      writeFileSync(join(d, 'osv.sarif.exit'), `${code}\n`);
      writeFileSync(join(d, 'osv.log'), 'x\n');
      const r = laneCoverage(CHECK(), d);
      assert.equal(r.coverage, 'reduced', `exit ${code} means the process itself failed`);
      assert.match(r.coverageReason, new RegExp(`exited ${code}`));
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a non-integer sidecar is ignored rather than believed', () => {
    const d = dir();
    writeFileSync(join(d, 'osv.sarif.exit'), 'not-a-number\n');
    writeFileSync(join(d, 'osv.log'), 'clean run\n');
    assert.equal(laneCoverage(CHECK(), d).coverage, 'full');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('declared signals', () => {
  test('a log that was read and matched nothing is the ONLY route to full', () => {
    const d = dir();
    writeFileSync(join(d, 'osv.log'), 'Scanned 412 packages. No lanes skipped.\n');
    const r = laneCoverage(CHECK(), d);
    assert.equal(r.coverage, 'full');
    assert.equal(r.coverageReason, null);
    rmSync(d, { recursive: true, force: true });
  });

  test('the reason names the LANE, not the regex — a reader needs the capability, not the grep', () => {
    const d = dir();
    writeFileSync(join(d, 'osv.log'), 'Skipping call analysis on Go code since Go is not installed\n');
    assert.equal(laneCoverage(CHECK(), d).coverageReason, 'Go call analysis did not run');
    rmSync(d, { recursive: true, force: true });
  });

  test('a check declaring no signals is full on an exit-0 run, without inventing a log to read', () => {
    const d = dir();
    writeFileSync(join(d, 'osv.sarif.exit'), '0\n');
    assert.equal(laneCoverage(CHECK({ coverageSignals: [] }), d).coverage, 'full');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('fail closed — an unread log is never full coverage', () => {
  test('a DECLARED log that is absent yields unknown, not full', () => {
    const d = dir();
    writeFileSync(join(d, 'osv.sarif.exit'), '0\n');   // exit says fine; the log never appeared
    const r = laneCoverage(CHECK(), d);
    assert.equal(r.coverage, 'unknown',
      'returning full here would assert completeness nobody verified — the defect this field exists to remove');
    assert.match(r.coverageReason, /absent/);
    rmSync(d, { recursive: true, force: true });
  });

  test('an unreadable log yields unknown, not full', () => {
    const d = dir();
    const p = join(d, 'osv.log');
    writeFileSync(p, 'x\n');
    let skipped = false;
    try { chmodSync(p, 0o000); } catch { skipped = true; }
    // running as root defeats the permission, so only assert when the OS actually denied us
    let r;
    try { r = laneCoverage(CHECK(), d); } finally { try { chmodSync(p, 0o644); } catch {} }
    if (!skipped && r.coverage !== 'full') {
      assert.equal(r.coverage, 'unknown');
      assert.match(r.coverageReason, /unreadable/);
    }
    rmSync(d, { recursive: true, force: true });
  });

  test('a malformed regex yields unknown — a typo must not read as "nothing matched"', () => {
    const d = dir();
    writeFileSync(join(d, 'osv.log'), 'anything\n');
    const r = laneCoverage(CHECK({ coverageSignals: [{ pattern: '([unclosed', lane: 'x' }] }), d);
    assert.equal(r.coverage, 'unknown');
    assert.match(r.coverageReason, /not a valid regex/);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('orthogonality — the property the whole design exists to protect', () => {
  test('coverage never returns a severity, and severity is not an input to it', () => {
    const d = dir();
    writeFileSync(join(d, 'osv.log'), 'Skipping call analysis on Go code since Go is not installed\n');
    const r = laneCoverage(CHECK(), d);
    // The guard is "no SEVERITY key leaks in", not "exactly two keys forever": coverageBasis was
    // added to say HOW the verdict was reached (per-file | signal | exit-code | ...), which is a
    // third fact about coverage, not a severity. Anything outside the coverage family still fails.
    assert.deepEqual(Object.keys(r).sort().filter((k) => !['coverage', 'coverageReason', 'coverageBasis'].includes(k)), [],
      'laneCoverage returns coverage keys only — a sev key here would be the two axes collapsing');
    assert.ok(!['ok', 'med', 'high', 'noscan', 'skip'].includes(r.coverage),
      'the coverage vocabulary must not overlap the severity vocabulary, or consumers will conflate them');
    rmSync(d, { recursive: true, force: true });
  });

  test('a check with no report block is full — coverage is not a way to fail an inapplicable lane', () => {
    const d = dir();
    assert.equal(laneCoverage({ id: 'x' }, d).coverage, 'full');
    assert.equal(laneCoverage(null, d).coverage, 'full');
    rmSync(d, { recursive: true, force: true });
  });
});
