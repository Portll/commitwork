// measured — the record must say the reading was OBTAINED, not merely remembered: a block that
// cannot be produced without actually running the source.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestOf, measuredRun, measuredExec, measuredInProcess, measuredFromArtifact, sameSource } from '../measured.mjs';

test('a digest is stable for identical output and differs for different output', () => {
  assert.equal(digestOf('abc'), digestOf('abc'));
  assert.notEqual(digestOf('abc'), digestOf('abd'));
  assert.match(digestOf('abc'), /^sha256:[0-9a-f]{16}$/);
});

// An absent output has no digest. A digest OF the empty string would make two different failures
// compare equal, which is the whole class this module exists to stop.
test('absent output has no digest, and is not the digest of emptiness', () => {
  assert.equal(digestOf(null), null);
  assert.equal(digestOf(undefined), null);
  assert.notEqual(digestOf(''), null, 'an empty string IS an output and does have a digest');
});

// A nonzero exit is the NORMAL state for a gate-shaped source — anchor-staleness exits 1 on drift.
test('a declared non-zero exit is a successful measurement, not a failure', () => {
  const bad = measuredRun('probe', ['-e', 'console.log("out"); process.exit(1)']);
  assert.equal(bad.measured.ok, false, 'exit 1 is a failure unless the caller says otherwise');

  const good = measuredRun('probe', ['-e', 'console.log("out"); process.exit(1)'], { okExit: [0, 1] });
  assert.equal(good.measured.ok, true);
  assert.equal(good.measured.exit, 1, 'the code is still recorded — it is the ok-ness that the caller declares');
  assert.equal(good.measured.digest, digestOf('out\n'), 'and the output is still the measurement');
});

test('a source that fails still yields a block — an attempted measurement is evidence', () => {
  const r = measuredRun('probe', ['-e', 'process.exit(3)']);
  assert.equal(r.measured.ok, false);
  assert.equal(r.measured.exit, 3);
  assert.ok(r.measured.at, 'when it was attempted is recorded even though it failed');
});

// CW_NOW pins the CLOCK; pinning `ms` too would make every duration 0 — exactly the value a
// fabricating gate would emit.
test('CW_NOW pins the timestamp but NOT the elapsed time', () => {
  const before = process.env.CW_NOW;
  try {
    process.env.CW_NOW = '2020-01-01T00:00:00.000Z';
    const r = measuredRun('probe', ['-e', 'for(let i=0;i<3e6;i++);console.log("x")']);
    assert.equal(r.measured.at, '2020-01-01T00:00:00.000Z', 'the clock is pinned, for determinism');
    assert.ok(r.measured.ms >= 0, 'but elapsed is real work, not the pinned clock');
    assert.notEqual(r.measured.ms, undefined);
  } finally {
    if (before === undefined) delete process.env.CW_NOW; else process.env.CW_NOW = before;
  }
});

// measuredExec exists because gate-tests' suite is a COMMAND LINE, not a node argv — and a
// failing suite's stdout AND stderr both ARE the measurement.
// The command is built from a SCRIPT FILE, not from inline `-e` source, and both halves of that
// are load-bearing on Windows.
//
// measuredExec runs its argument through execSync, which is cmd.exe on Windows — and cmd.exe reads
// `>` `<` `|` `&` `^` ANYWHERE in the line, including inside what you meant as a payload. The old
// form here was:
//     `${process.execPath} -e 'setInterval(()=>{},1000)'`
// and cmd.exe read the `>` of the ARROW FUNCTION as an output redirection, so it created a file
// literally named `{}` in the working directory — in the repository root — on every run. That is
// how a stray `{}` had been appearing in `git status`. Single quotes did not protect it: cmd.exe
// does not treat them as quoting at all. Neither did the unquoted `process.execPath`, which
// contains a space ("C:\Program Files\nodejs\node.exe") and split into `C:\Program` plus arguments.
//
// So: paths are DOUBLE-quoted (honoured by both cmd.exe and sh) and the JavaScript goes in a file,
// which keeps program text off the command line entirely. Same measurement, no syntax to collide.
const q = (p) => `"${p}"`;
const scripts = [];
after(() => { for (const f of scripts) { try { rmSync(f, { force: true }); } catch { /* gone */ } } });
function scriptCmd(source) {
  const f = join(mkdtempSync(join(tmpdir(), 'cw-measured-')), 's.mjs');
  writeFileSync(f, source);
  scripts.push(f);
  return `${q(process.execPath)} ${q(f)}`;
}

test('measuredExec: a declared non-zero exit is a fine run, and failure output is the measurement', () => {
  const cmd = scriptCmd('console.log("out"); console.error("err"); process.exit(1);\n');
  const bad = measuredExec('probe', cmd);
  assert.equal(bad.measured.ok, false, 'exit 1 is a failure unless the caller says otherwise');
  const good = measuredExec('probe', cmd, { okExit: [0, 1] });
  assert.equal(good.measured.ok, true);
  assert.equal(good.measured.exit, 1);
  assert.equal(good.out, 'out\n\nerr\n', 'stdout AND stderr — the gate parses both on failure');
  assert.equal(good.measured.digest, digestOf('out\n\nerr\n'));
});

// A timed-out child has status:null → code 1, which a gate-shaped caller declares normal — a
// SIGTERMed source's partial stdout must not digest as a complete reading.
test('measuredExec: a signal-killed source is never ok, whatever exits the caller declared', () => {
  const r = measuredExec('probe', scriptCmd('setInterval(function () {}, 1000);\n'), { timeout: 250, okExit: [0, 1] });
  assert.equal(r.measured.ok, false, 'killed is not any declared exit code');
  assert.ok(r.measured.at, 'the attempt is still evidence');
});

// A gate that IS its own scanner has no child; the digest is over a raw form the CALLER made stable.
test('measuredInProcess: digests the stable raw, and a failed reading says so', () => {
  const m = measuredInProcess('collectDocs (in-process)', '{"docs":1}', { ms: 42 });
  assert.equal(m.digest, digestOf('{"docs":1}'));
  assert.equal(m.ok, true);
  assert.equal(m.exit, 0);
  assert.equal(m.ms, 42);
  const failed = measuredInProcess('argv:hook', null, { ok: false, detail: 'state file unreadable' });
  assert.equal(failed.ok, false);
  assert.equal(failed.exit, 1);
  assert.equal(failed.digest, null, 'nothing obtained has no digest — absent is not the empty string');
});

// A reading pinned to a fixture is EXACTLY the state a stuck gate is in, so it must be visible
// without parsing prose — the canary R-STUCK asserts on this prefix.
test('an artifact read is marked as one, so a pinned reading is visible as pinned', () => {
  const m = measuredFromArtifact('/tmp/x.json', '{"a":1}');
  assert.match(m.source, /^artifact:/);
  assert.equal(m.ms, 0, 'reading a file is not running a source, and must not look like one');
  assert.equal(m.digest, digestOf('{"a":1}'));
});

test('sameSource is null-safe — unknown never equals unknown', () => {
  assert.equal(sameSource({ digest: 'a' }, { digest: 'a' }), true);
  assert.equal(sameSource({ digest: 'a' }, { digest: 'b' }), false);
  assert.equal(sameSource({ digest: null }, { digest: 'a' }), null, 'a record with no digest is UNKNOWN, never "different"');
  assert.equal(sameSource(null, null), null, 'two absences are not an agreement');
});

// ── WINDOWS: the regression that was writing into the repository ───────────────────────────────
test('WINDOWS — a command carrying shell metacharacters does not write a file into cwd', (t) => {
  if (process.platform !== 'win32') { t.skip('cmd.exe redirection parsing is win32-only'); return; }
  // The exact shape that produced the stray `{}`: an arrow function on the command line, whose `>`
  // cmd.exe reads as an output redirection. Asserted as an EFFECT — the absence of a file — rather
  // than by inspecting the command string, because the string always looked fine.
  const dir = mkdtempSync(join(tmpdir(), 'cw-measured-cwd-'));
  const before = new Set(readdirSync(dir));
  try {
    measuredExec('probe', scriptCmd('const f = () => {}; f(); console.log("ok");\n'),
      { cwd: dir, timeout: 10_000, okExit: [0, 1] });
    const after2 = readdirSync(dir).filter((n) => !before.has(n));
    assert.deepEqual(after2, [],
      `the measured command wrote ${JSON.stringify(after2)} into its cwd — cmd.exe parsed part of `
      + 'the command as redirection. A mangled command still returns an exit code and gets recorded '
      + 'as a measurement of something it never ran.');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('WINDOWS — an execPath containing a space survives, so the command actually runs', (t) => {
  if (process.platform !== 'win32') { t.skip('the space is in "C:\Program Files"'); return; }
  // The old form concatenated process.execPath unquoted; cmd.exe split it at the space and reported
  // "'C:\Program' is not recognized", which the measurement then recorded as a failing run.
  const r = measuredExec('probe', scriptCmd('console.log("ran");\n'), { timeout: 10_000 });
  assert.equal(r.measured.ok, true, `the command must actually run: ${r.measured.detail}`);
  assert.match(String(r.out), /ran/, 'and its output is the measurement, not a shell error');
});
