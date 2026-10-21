/**
 * Tests for bin/lib/build-health-parse.mjs (extracted because bin/build-health.mjs dispatches at
 * module scope). Fixtures are shaped like real captured container output; each case is named for
 * the WRONG answer it stops.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PHASE_MARKER, TOOLCHAIN_STATUSES, buildPhaseScript, parsePhases, countTests, foldPhases,
  workspaceStep, shQuote, WORKSPACE_PHASE, WORKSPACE_EXCLUDES,
} from '../lib/build-health-parse.mjs';

const marker = (s) => `${PHASE_MARKER} ${s}`;
const run = (...lines) => lines.join('\n');

// ---- the container died and we must not call that green ------------------

test('output with no terminator is unreadable, never green — a truncated log is not a clean run', () => {
  // Every phase present and passing, but the container was killed before the terminator.
  const out = run('Compiling foo v0.1.0', marker('name=build attempted=1 exit=0'));
  const parsed = parsePhases(out);
  assert.equal(parsed.complete, false);
  const r = foldPhases({ lang: 'rust', parsed, testCount: 12 });
  assert.equal(r.status, 'unreadable');
  assert.equal(r.green, false);
  assert.match(r.note, /died mid-run/);
});

test('completely empty output is unreadable, not green — the false-clean this change exists to kill', () => {
  const r = foldPhases({ lang: 'rust', parsed: parsePhases(''), testCount: null });
  assert.equal(r.status, 'unreadable');
  assert.equal(r.green, false);
});

test('null output does not throw', () => {
  assert.deepEqual(parsePhases(null), { complete: false, phases: [] });
  assert.equal(countTests('rust', null), null);
});

// ---- a scanned repo must not be able to forge its own verdict -------------

test('a marker printed mid-line by the scanned repo is ignored — parsing is line-anchored', () => {
  // A repo whose build log echoes the marker inside a line tries to inject a passing build.
  const out = run(
    `warning: found ${marker('name=build attempted=1 exit=0')} in vendored script`,
    marker('name=build attempted=1 exit=1'),
    marker('end=1'),
  );
  const { phases } = parsePhases(out);
  assert.equal(phases.length, 1, 'only the wrapper-emitted, line-anchored marker counts');
  assert.equal(phases[0].exit, 1);
  assert.equal(foldPhases({ lang: 'rust', parsed: parsePhases(out) }).status, 'RED');
});

test('a test that prints a cargo summary line mid-line cannot inflate the count', () => {
  const out = run(
    'running 1 test',
    'stdout: expected "test result: ok. 999 passed" to appear',
    'test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out',
  );
  assert.equal(countTests('rust', out), 1);
});

// ---- which phase broke -----------------------------------------------------

test('a failing build names the build phase and never attempts test', () => {
  const out = run(
    marker('name=build attempted=1 exit=101'),
    marker('name=test attempted=0 exit=-'),
    marker('end=1'),
  );
  const r = foldPhases({ lang: 'rust', parsed: parsePhases(out) });
  assert.equal(r.status, 'RED');
  assert.equal(r.failedPhase, 'build');
  assert.match(r.note, /exited 101/);
});

test('a failing test names the test phase — the distinction the single boolean could not make', () => {
  const out = run(
    marker('name=build attempted=1 exit=0'),
    marker('name=test attempted=1 exit=1'),
    marker('end=1'),
  );
  const r = foldPhases({ lang: 'rust', parsed: parsePhases(out) });
  assert.equal(r.status, 'RED');
  assert.equal(r.failedPhase, 'test');
});

test('an unattempted phase carries exit null, not a sentinel that collides with a real code', () => {
  // 254 was a candidate sentinel for "not attempted". A test runner can return 254 for real.
  const { phases } = parsePhases(run(marker('name=test attempted=0 exit=-'), marker('end=1')));
  assert.equal(phases[0].attempted, false);
  assert.equal(phases[0].exit, null);
  assert.equal(phases[0].green, false);
});

// ---- zero tests is not health ---------------------------------------------

test('a passing run that executed zero tests is no-tests, never green', () => {
  const out = run(
    marker('name=build attempted=1 exit=0'),
    marker('name=test attempted=1 exit=0'),
    marker('end=1'),
  );
  const r = foldPhases({ lang: 'rust', parsed: parsePhases(out), testCount: 0 });
  assert.equal(r.status, 'no-tests');
  assert.equal(r.green, false);
  assert.equal(r.testPhasePresent, true);
  assert.match(r.note, /zero tests/);
});

test('a repo with no test phase at all is no-tests, and says so differently', () => {
  const out = run(marker('name=install attempted=1 exit=0'), marker('name=build attempted=1 exit=0'), marker('end=1'));
  const r = foldPhases({ lang: 'javascript', parsed: parsePhases(out), testCount: null });
  assert.equal(r.status, 'no-tests');
  assert.equal(r.testPhasePresent, false);
  assert.match(r.note, /no test phase was run/);
});

test('an unparsed count is green-but-uncounted, NOT no-tests — null must never collapse to zero', () => {
  const out = run(
    marker('name=build attempted=1 exit=0'),
    marker('name=test attempted=1 exit=0'),
    marker('end=1'),
  );
  const r = foldPhases({ lang: 'c/c++', parsed: parsePhases(out), testCount: null });
  assert.equal(r.status, 'green');
  assert.match(r.note, /uncounted, not zero/);
});

// ---- counting -------------------------------------------------------------

test('rust counts are SUMMED across test binaries and doctests, not taken from the first line', () => {
  const out = run(
    'test result: ok. 12 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out',
    'test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out',
    'test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out',
  );
  assert.equal(countTests('rust', out), 21, 'first-match-only would report 12 for every multi-crate repo');
});

test('a rust run with zero tests reports 0, which is a finding, not an unparsed null', () => {
  assert.equal(countTests('rust', 'test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out'), 0);
});

test('unrecognised output yields null, not zero', () => {
  assert.equal(countTests('rust', 'Compiling foo v0.1.0\nFinished dev profile'), null);
  assert.equal(countTests('elvish', 'anything at all'), null);
});

test('node --test and jest/vitest summaries both count', () => {
  assert.equal(countTests('javascript', run('# tests 9', '# pass 7', '# fail 2')), 7);
  assert.equal(countTests('typescript', run('Tests:  3 failed, 41 passed, 44 total')), 41);
});

test('go counts top-level verdicts and does not double-count subtests', () => {
  const out = run('--- PASS: TestA (0.00s)', '    --- PASS: TestA/sub (0.00s)', '--- FAIL: TestB (0.01s)', 'FAIL\texample.com/pkg\t0.02s');
  assert.equal(countTests('go', out), 2);
});

test('a go package with no test files reports 0, not null', () => {
  assert.equal(countTests('go', '?   \texample.com/pkg\t[no test files]'), 0);
});

test('python and ruby summaries count', () => {
  assert.equal(countTests('python', '===== 14 passed, 2 skipped in 1.20s ====='), 14);
  assert.equal(countTests('ruby', '18 examples, 0 failures'), 18);
});

// ---- the script the container actually runs --------------------------------

test('phases stop at the first failure and every phase reports, attempted or not', () => {
  const script = buildPhaseScript([{ name: 'build', cmd: 'cargo build --all' }, { name: 'test', cmd: 'cargo test --all' }]);
  assert.match(script, /cw_rc=0/);
  assert.match(script, /if \[ "\$cw_rc" -eq 0 \]/);
  assert.match(script, /attempted=0/, 'a skipped phase still emits a marker — silence is indistinguishable from a dead container');
  assert.ok(script.trimEnd().endsWith(`echo "${PHASE_MARKER} end=1"`), 'the terminator must be last');
});

test('every phase is bounded so one wedged phase cannot hold the container open', () => {
  const script = buildPhaseScript([{ name: 'test', cmd: 'cargo test' }], { timeoutSeconds: 60 });
  assert.match(script, /timeout 60 sh -c/);
});

test('a single quote in a command is escaped, not injected', () => {
  const script = buildPhaseScript([{ name: 'test', cmd: `sh -c 'echo hi'` }]);
  assert.ok(!/[^\\]''[^\\]/.test(script) || script.includes(`'\\''`), 'quotes are escaped');
  assert.match(script, /'\\''/);
});

test('a phase name with whitespace is rejected rather than silently producing an unparseable marker', () => {
  assert.throws(() => buildPhaseScript([{ name: 'unit test', cmd: 'x' }]), /bad phase name/);
  assert.throws(() => buildPhaseScript([]), /non-empty array/);
});

// ---- the vocabulary is closed ---------------------------------------------

test('every status foldPhases can return is a declared member of the closed vocabulary', () => {
  const cases = [
    foldPhases({ lang: 'rust', parsed: parsePhases('') }),
    foldPhases({ lang: 'rust', parsed: parsePhases(run(marker('name=build attempted=1 exit=1'), marker('end=1'))) }),
    foldPhases({ lang: 'rust', parsed: parsePhases(run(marker('name=test attempted=1 exit=0'), marker('end=1'))), testCount: 0 }),
    foldPhases({ lang: 'rust', parsed: parsePhases(run(marker('name=test attempted=1 exit=0'), marker('end=1'))), testCount: 5 }),
  ];
  for (const c of cases) assert.ok(TOOLCHAIN_STATUSES.includes(c.status), `${c.status} is not in the declared vocabulary`);
  assert.deepEqual(cases.map((c) => c.status), ['unreadable', 'RED', 'no-tests', 'green']);
});

// ---- the sh -c boundary, which is where the whole thing was broken --------

// The script runs inside a Linux container, where timeout always exists. A host without one (GitHub's
// macOS image) gets a pass-through shim, so these tests still cross the real sh -c boundary there.
const SH_ENV = (() => {
  try { execSync('command -v timeout', { stdio: 'ignore' }); return process.env; } catch { /* no timeout on this host */ }
  const dir = mkdtempSync(join(tmpdir(), 'cw-timeout-shim-'));
  writeFileSync(join(dir, 'timeout'), '#!/bin/sh\nshift\nexec "$@"\n', { mode: 0o755 });
  return { ...process.env, PATH: `${dir}:${process.env.PATH}` };
})();

test('the script survives a REAL sh -c round trip — the shell variables reach the shell, not the host', () => {
  // the host shell once expanded $cw_rc to empty BEFORE docker ran; every unit test passed
  // because they all stopped at this boundary, so this one crosses it with /bin/sh
  const script = buildPhaseScript([
    { name: 'install', cmd: 'true' },
    { name: 'build', cmd: 'exit 3' },
    { name: 'test', cmd: 'true' },
  ]);
  const out = execSync(`sh -c ${shQuote(script)}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: SH_ENV });
  const parsed = parsePhases(out);
  assert.equal(parsed.complete, true, 'the terminator must arrive');
  assert.deepEqual(parsed.phases, [
    { name: 'install', attempted: true, exit: 0, green: true },
    { name: 'build', attempted: true, exit: 3, green: false },
    // stops at the first failure: a test result after a failed build means nothing
    { name: 'test', attempted: false, exit: null, green: false },
  ]);
  assert.equal(foldPhases({ lang: 'javascript', parsed }).failedPhase, 'build');
});

test('a phase that PASSES is reported as attempted with exit 0 — not as skipped', () => {
  // the old failure's shape: everything "not attempted", folding to no-tests
  const out = execSync(`sh -c ${shQuote(buildPhaseScript([{ name: 'test', cmd: 'true' }]))}`, { encoding: 'utf8', env: SH_ENV });
  const { phases } = parsePhases(out);
  assert.equal(phases.length, 1);
  assert.deepEqual(phases[0], { name: 'test', attempted: true, exit: 0, green: true });
});

test('shQuote closes a single-quoted string against a command that contains quotes', () => {
  const nasty = `echo 'it'\\''s here'; echo "$HOME"`;
  const out = execSync(`sh -c ${shQuote(`printf '%s' ${shQuote(nasty)}`)}`, { encoding: 'utf8' });
  assert.equal(out, nasty, 'the payload must arrive byte-identical — no host expansion, no early close');
});

// ---- the check must not write to the repo it is scanning ------------------

test('the workspace step copies OUT of the read-only mount and never back into it', () => {
  const { name, cmd } = workspaceStep();
  assert.equal(name, WORKSPACE_PHASE);
  // The direction is the whole fix: /src is only ever read, /w is the only thing written.
  assert.match(cmd, /cd \/src && tar -cf -/);
  assert.match(cmd, /tar -C \/w -xf/);
  assert.ok(!/-C \/src -xf|> \/src/.test(cmd), 'nothing may extract or redirect INTO the read-only mount');
});

test('the copy runs through a temp file, never a pipe — dash has no pipefail', () => {
  // under dash a pipe reports only the right-hand exit status — a truncated read would extract a
  // partial tree and report success
  assert.ok(!workspaceStep().cmd.includes('|'), 'no pipe: the exit status must be the copy\'s own');
});

test('node_modules is excluded at every depth, and no source-bearing directory is', () => {
  const { cmd } = workspaceStep();
  assert.ok(WORKSPACE_EXCLUDES.includes('node_modules'), 'the dir npm ci deletes is the point of the fix');
  // Unanchored --exclude=node_modules, not --exclude=./node_modules: a monorepo has one per package.
  assert.match(cmd, /--exclude=node_modules(?!\/)/);
  assert.ok(!cmd.includes('--exclude=./'), 'anchored excludes would miss every nested copy');
  // vendor/ IS a Go build input and bin/ IS source here; excluding either would false-RED a healthy
  // repo, which is a worse failure than a slow copy.
  for (const keep of ['vendor', 'bin', 'build', 'dist', 'out', 'src', 'lib']) {
    assert.ok(!WORKSPACE_EXCLUDES.includes(keep), `${keep} must be copied — it holds source somewhere in this fleet`);
  }
});

test('a failed materialise is env-blocked, NOT RED — the repo\'s build was never attempted', () => {
  const out = run(
    'tar: /tmp/cw-workspace.tar: Cannot write: No space left on device',
    marker(`name=${WORKSPACE_PHASE} attempted=1 exit=2`),
    marker('name=install attempted=0 exit=-'),
    marker('name=test attempted=0 exit=-'),
    marker('end=1'),
  );
  const r = foldPhases({ lang: 'javascript', parsed: parsePhases(out) });
  assert.equal(r.status, 'env-blocked');
  assert.equal(r.green, false);
  assert.equal(r.failedPhase, WORKSPACE_PHASE);
  assert.match(r.note, /property of the runner, not of the repo/);
  assert.ok(TOOLCHAIN_STATUSES.includes(r.status));
});

test('a real build failure AFTER a good materialise is still RED — the guard is not a blanket amnesty', () => {
  const out = run(
    marker(`name=${WORKSPACE_PHASE} attempted=1 exit=0`),
    marker('name=install attempted=1 exit=0'),
    marker('name=build attempted=1 exit=1'),
    marker('name=test attempted=0 exit=-'),
    marker('end=1'),
  );
  const r = foldPhases({ lang: 'javascript', parsed: parsePhases(out) });
  assert.equal(r.status, 'RED');
  assert.equal(r.failedPhase, 'build');
});

test('a green run that materialised first still judges on the REAL phases', () => {
  const out = run(
    marker(`name=${WORKSPACE_PHASE} attempted=1 exit=0`),
    marker('name=install attempted=1 exit=0'),
    marker('name=test attempted=1 exit=0'),
    marker('end=1'),
  );
  // materialise passing must not be mistaken for test evidence: zero tests is still no-tests.
  assert.equal(foldPhases({ lang: 'javascript', parsed: parsePhases(out), testCount: 0 }).status, 'no-tests');
  assert.equal(foldPhases({ lang: 'javascript', parsed: parsePhases(out), testCount: 7 }).status, 'green');
});

test('no status other than RED is green, and no not-green status claims green', () => {
  for (const s of TOOLCHAIN_STATUSES) assert.equal(typeof s, 'string');
  assert.ok(!TOOLCHAIN_STATUSES.includes('clean'), 'clean belongs to deadcode, not toolchain');
});
