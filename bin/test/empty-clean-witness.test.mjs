// emptyClean is where "nothing was found" is separated from "nothing was produced". The exit-code
// half has been live since the trufflehog zero-byte fix and was UNTESTED — no test named its
// summary — so both halves are pinned here: the tool that said it failed, and the run that said
// nothing at all.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyReport } from '../commitwork.mjs';

const CHECK = { id: 'deps-osv', report: { file: 'osv.sarif', format: 'sarif' } };
const dir = () => mkdtempSync(join(tmpdir(), 'cw-empty-clean-'));

// zero results; `invocations` present only when a witness is wanted
const doc = (invocations) => JSON.stringify({
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'osv-scanner', rules: [] } }, results: [], ...(invocations ? { invocations } : {}) }],
});

const run = ({ exit = null, invocations = null, body = null } = {}) => {
  const d = dir();
  writeFileSync(join(d, 'osv.sarif'), body ?? doc(invocations));
  if (exit !== null) writeFileSync(join(d, 'osv.sarif.exit'), `${exit}\n`);
  try { return classifyReport(CHECK, d, d); } finally { rmSync(d, { recursive: true, force: true }); }
};

describe('a zero is clean only when something witnessed the run', () => {
  test('exit 0 witnesses it — the zero stands', () => {
    assert.equal(run({ exit: 0 }).sev, 'ok');
  });

  test('a non-zero exit is a witness to FAILURE — pins the previously untested branch', () => {
    const r = run({ exit: 2 });
    assert.equal(r.sev, 'noscan');
    assert.match(r.summary, /exited 2/);
  });

  test('an invocation record witnesses it with no sidecar at all', () => {
    assert.equal(run({ invocations: [{ executionSuccessful: true }] }).sev, 'ok',
      'the artifact self-certifies; requiring a sidecar too would grey every tool that records its own run');
  });

  // The defect: osv-scanner with egress severed writes exactly this — valid SARIF, zero results,
  // no invocations — and with no sidecar beside it nothing anywhere says the tool ran.
  test('NO exit code and NO invocation record is not clean, it is unwitnessed', () => {
    const r = run();
    assert.equal(r.sev, 'noscan');
    assert.match(r.summary, /nothing witnessed the run/);
  });

  test('findings are their own witness — the branch must not fire on a report with results', () => {
    const withResults = JSON.stringify({
      version: '2.1.0',
      runs: [{ tool: { driver: { name: 'osv-scanner', rules: [] } }, results: [{ ruleId: 'CVE-2026-1', level: 'warning' }] }],
    });
    assert.notEqual(run({ body: withResults }).sev, 'noscan');
  });

  // Non-degeneracy: if every arm returned noscan the suite above would still pass.
  test('the witnessed and unwitnessed arms DISAGREE — otherwise this file pins nothing', () => {
    assert.notEqual(run({ exit: 0 }).sev, run().sev);
    assert.notEqual(run({ invocations: [{ executionSuccessful: true }] }).sev, run().sev);
  });
});

describe('shellcheck: advisory-only output exits 1 and is a result, not a failure', () => {
  const SC = { id: 'shell-lint', report: { file: 'shellcheck.json', format: 'shellcheck' } };
  const runSc = ({ exit, comments }) => {
    const d = dir();
    writeFileSync(join(d, 'shellcheck.json'), JSON.stringify({ comments }));
    writeFileSync(join(d, 'shellcheck.json.exit'), `${exit}\n`);
    try { return classifyReport(SC, d, d); } finally { rmSync(d, { recursive: true, force: true }); }
  };
  const info = { file: './a.sh', line: 1, level: 'info', code: 2086, message: 'quote' };

  test('info-only comments with exit 1 stay clean and name the advisories', () => {
    const r = runSc({ exit: 1, comments: [info] });
    assert.equal(r.sev, 'ok');
    assert.match(r.summary, /\+1 advisory/);
  });

  test('a real failure exit (2) over the same output is still a void', () => {
    assert.equal(runSc({ exit: 2, comments: [info] }).sev, 'noscan');
  });

  test('exit 1 over an EMPTY comments[] is still a void: nothing explains the exit', () => {
    assert.equal(runSc({ exit: 1, comments: [] }).sev, 'noscan');
  });
});
