// scanner-preflight: the REFUSAL has to fire, not merely be written down.
//
// This file exists because bin/scanner-preflight.mjs had no test of any kind. Its entire purpose is
// to refuse a scanner that cannot state a version — and nothing anywhere asserted that it does. It
// reported `untrusted 0` on a box where every tool was fine, which is exactly what a preflight that
// had silently stopped checking would also report. A guard whose green and whose broken look
// identical is not a guard yet.
//
// It became testable when the version probe converged on monitor/tool-version.mjs, because that is
// where the CW_<TOOL>_BIN seam lives: the tool under test can now be a fixture script that prints a
// chosen banner, instead of whatever happens to be installed on the machine running the suite.
//
// EVERY CASE ASSERTS THE VERSION IT READ, not just the verdict. If the seam were ignored the real
// govulncheck would answer, the row would read 1.7.0/ok, and a test that only checked "some row is
// ok" would pass while proving nothing about the fixture. Pinning the number is what makes the
// pass non-vacuous.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PREFLIGHT = join(HERE, '..', 'scanner-preflight.mjs');
const DIR = mkdtempSync(join(tmpdir(), 'cw-preflight-'));

// govulncheck prints its own version on a `Scanner:` line and its BUILD TOOLCHAIN on a `Go:` line —
// the real banner's shape, and the reason tool-version.mjs carries a per-tool version-line rule at
// all (first-number-wins reads the Go compiler as the scanner).
//
// go9.9.9 deliberately: the preflight downgrades a tool built with an older Go than the box runs to
// BEHIND-TOOLCHAIN, so a realistic number here would make these assertions depend on the Go
// installed wherever the suite runs. An unreachably high one keeps every case about the version.
// THE FIXTURE MUST BE EXECUTABLE BY THE PLATFORM RUNNING THE TEST. A `#!/bin/sh` script with no
// extension and `chmod 0755` is executable on POSIX and is inert on Windows: shebangs mean nothing
// there, chmod maps only the read-only bit, and PATHEXT has nothing to match. So every fixture
// failed to run, the preflight produced no JSON, and all four tests died on
// `JSON.parse('')` — "Unexpected end of JSON input" — which reads as a broken preflight rather than
// an unrunnable fixture.
//
// On Windows the same banner is emitted from a `.cmd`. That also exercises something worth
// exercising: a scanner installed through npm IS a `.cmd` on Windows, so this fixture is now the
// realistic shape rather than a POSIX-only stand-in, and it runs through the same
// lib/win-spawn.mjs path the production probe uses.
function fixture(name, scannerField) {
  if (process.platform === 'win32') {
    const p = join(DIR, `${name}.cmd`);
    // @echo off, and `echo.` guards nothing here — both lines carry text. Quotes are omitted
    // deliberately: cmd's echo prints them literally, which would corrupt the banner.
    writeFileSync(p, `@echo off\r\necho Go: go9.9.9\r\necho Scanner: govulncheck@${scannerField}\r\n`);
    return p;
  }
  const p = join(DIR, name);
  writeFileSync(p, `#!/bin/sh\necho "Go: go9.9.9"\necho "Scanner: govulncheck@${scannerField}"\n`);
  chmodSync(p, 0o755);
  return p;
}

/** Run the preflight with govulncheck pointed at `bin`, and return that row + the exit code. */
function rowFor(bin) {
  let status = 0, stdout = '';
  try {
    stdout = execFileSync(process.execPath, [PREFLIGHT, '--json'],
      { encoding: 'utf8', env: { ...process.env, CW_GOVULNCHECK_BIN: bin }, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    status = e.status ?? 1;
    stdout = e.stdout || '';
  }
  const parsed = JSON.parse(stdout);
  return { row: parsed.results.find((r) => r.id === 'govulncheck'), status, parsed };
}

test('a build that stamps no version is UNTRUSTED, and the process exits non-zero', () => {
  const { row, status } = rowFor(fixture('unstamped', 'v0.0.0'));
  assert.equal(row.state, 'UNTRUSTED');
  // v0.0.0 is the ABSENCE of a version wearing a version's shape — it must never be published as one.
  assert.equal(row.version, null);
  // The exit code is the part a nightly sweep acts on. Asserting only the row would let the refusal
  // be demoted to a printed warning without a single test noticing.
  assert.notEqual(status, 0, 'an untrusted scanner must fail the preflight, not just be mentioned in it');
});

test('a banner with no version-shaped text at all is UNKNOWN-VERSION — refused for a different reason', () => {
  const { row, status } = rowFor(fixture('wordy', 'unknown'));
  assert.equal(row.state, 'UNKNOWN-VERSION');
  assert.equal(row.version, null);
  assert.notEqual(status, 0);
});

test('a stamped build passes — and the version proves the fixture, not the installed tool, answered', () => {
  const { row } = rowFor(fixture('stamped', 'v9.9.9'));
  assert.equal(row.state, 'ok');
  // The whole anti-vacuity check: the real govulncheck on this box reports 1.7.0. Reading 9.9.9 is
  // the only evidence that the override was honoured end to end.
  assert.equal(row.version, '9.9.9');
  // NOT asserted: that the process exits 0. Every other scanner in the roster is probed too, and on
  // a box missing one this row can be perfect while the run still fails. Claiming a clean exit here
  // would make the test a report on the machine rather than on the code.
});

test('a tool that is not installed reads as MISSING — a visible absence, never a pass', () => {
  const { row } = rowFor(join(DIR, 'no-such-binary'));
  assert.equal(row.state, 'MISSING');
  assert.equal(row.version, null);
  // MISSING is excluded from the untrusted count on purpose: it is reported separately rather than
  // failing the run, because an uninstalled scanner is a known gap and an unidentifiable one is a
  // lie. The distinction is the point, so it is pinned.
  assert.ok(!['ok', 'ok-after-reinstall'].includes(row.state));
});
