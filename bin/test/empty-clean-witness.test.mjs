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

// MEASURED, osv-scanner 2.6.0 / osv-scalibr 0.5.2, on a tree whose only lockfile is a v4
// deno.lock: "1 dirs visited, 2 inodes visited, 0 Extract calls", "No package sources found",
// exit 128, and a ZERO-BYTE sarif on stdout. deno.lock is in deps-osv's appliesIfExists, so the
// lane fires on it and the scanner has no extractor for it.
//
// The lane's own command treats 128 as survivable (`[ $rc -gt 1 ] && [ $rc -ne 128 ]`) and exits 0,
// so the shell says the lane succeeded. What must not follow is a clean severity: the one thing
// standing between an unextractable lockfile and a published green is the exit sidecar, read here.
describe('deps-osv over a lockfile the scanner has no extractor for', () => {
  const run128 = ({ exit = 128, body = '' } = {}) => {
    const d = dir();
    writeFileSync(join(d, 'osv.sarif'), body);
    if (exit !== null) writeFileSync(join(d, 'osv.sarif.exit'), `${exit}\n`);
    try { return classifyReport(CHECK, d, d); } finally { rmSync(d, { recursive: true, force: true }); }
  };

  test('an empty report with exit 128 is a void, never a clean dependency scan', () => {
    assert.equal(run128().sev, 'noscan');
  });

  test('the same empty report with exit 0 is ALSO a void — the emptiness alone carries no pass', () => {
    // Asserted separately because it is the direction that would lie: if a 0-byte artifact could
    // pass on a zero exit, every lane whose tool dies before writing would publish clean.
    assert.equal(run128({ exit: 0 }).sev, 'noscan');
    assert.equal(run128({ exit: null }).sev, 'noscan');
  });

  test('the control: a real osv report over a lockfile it CAN extract still reports its findings', () => {
    // Without this the three above would pass over a classifier that returned noscan for
    // everything, and deps-osv would be grey across the fleet with nothing saying so.
    const real = JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'osv-scanner', rules: [] } },
      results: [{ ruleId: 'CVE-2020-28500', level: 'warning' }] }] });
    assert.notEqual(run128({ exit: 1, body: real }).sev, 'noscan');
  });
});

describe('deps-osv over a lone deno.lock converted by bin/deno-lock-osv.mjs', () => {
  const MEASURED = {
    scanner: 'osv-scanner 2.6.0 / osv-scalibr 0.5.2',
    measuredOn: '2026-11-05',
    lock: 'bin/test/fixtures/deno-lock/deno.lock',
    packagesExtracted: 2,
    exit: 1,
    uri: 'deno-osv-scanner.json',
    results: ['CVE-2020-28500', 'CVE-2021-23337', 'CVE-2026-4800', 'CVE-2021-44906', 'CVE-2025-13465'],
  };
  const sarif = JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'osv-scanner', rules: [] } },
    results: MEASURED.results.map((ruleId) => ({ ruleId, level: 'warning',
      locations: [{ physicalLocation: { artifactLocation: { uri: `file:///deno-locks/${MEASURED.uri}` } } }] })) }] });
  const classify = (body, exit) => {
    const d = dir();
    writeFileSync(join(d, 'osv.sarif'), body);
    writeFileSync(join(d, 'osv.sarif.exit'), `${exit}\n`);
    try { return classifyReport(CHECK, d, d); } finally { rmSync(d, { recursive: true, force: true }); }
  };

  test('the converted npm half is a findings run, not a void', () => {
    const r = classify(sarif, MEASURED.exit);
    assert.equal(r.sev, 'med');
    assert.equal(r.summary, `${MEASURED.results.length} (0e/${MEASURED.results.length}w)`);
  });

  test('a deno.lock with nothing converted still reads as a void', () => {
    assert.equal(classify('', 128).sev, 'noscan');
    assert.notEqual(classify(sarif, MEASURED.exit).sev, classify('', 128).sev);
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
