/**
 * Tests for the `format` dimension's pure half (bin/lib/build-health-parse.mjs).
 * Fixtures are captured tool output; each case is named for the WRONG answer it stops.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMAT_PARSERS, formatDeviations, foldFormat } from '../lib/build-health-parse.mjs';

const fold = (o) => foldFormat({ lang: 'rust', tool: 'cargo fmt', declaredBy: 'its own CI workflow', command: 'x', ...o });

// ---- the guard that caught the real bug -----------------------------------

test('a non-zero exit with nothing parsed is unreadable, never clean', () => {
  // The live failure: rustfmt exited 1 over 193 deviating files and the pattern matched none, so
  // the lane called memory-layer clean. The guard makes any future pattern miss loud instead of green.
  const r = fold({ ok: false, code: 1, files: [] });
  assert.equal(r.status, 'unreadable');
  assert.equal(r.deviationCount, null, 'null, not 0 — we do not know the count');
  assert.match(r.note, /does not match this parser|failed to run/);
});

test('an unregistered tool is unreadable, not clean — no parser means nothing was read', () => {
  assert.equal(formatDeviations('some-new-fmt', 'whatever'), null);
  const r = fold({ tool: 'some-new-fmt', ok: true, code: 0, files: null });
  assert.equal(r.status, 'unreadable');
  assert.equal(r.deviationCount, null);
});

test('a clean run is clean, and a dirty run counts', () => {
  assert.equal(fold({ ok: true, code: 0, files: [] }).status, 'clean');
  const dirty = fold({ ok: false, code: 1, files: ['a.rs', 'b.rs'] });
  assert.equal(dirty.status, 'findings');
  assert.equal(dirty.deviationCount, 2);
});

// ---- rustfmt: the pattern that was wrong ----------------------------------

test('current rustfmt output (Diff in <path>:N:) is parsed — the form that parsed zero', () => {
  const out = [
    'Diff in /w/benches/associative_retrieval_benchmarks.rs:18:',
    ' use chrono::Utc;',
    'Diff in /w/benches/associative_retrieval_benchmarks.rs:24:',
    'Diff in /w/benches/cognitive_benchmarks.rs:9:',
  ].join('\n');
  assert.deepEqual(FORMAT_PARSERS['cargo fmt'](out),
    ['/w/benches/associative_retrieval_benchmarks.rs', '/w/benches/cognitive_benchmarks.rs'],
    'one entry per FILE, not per hunk');
});

test('older rustfmt output (Diff in <path> at line N) still parses', () => {
  assert.deepEqual(FORMAT_PARSERS['cargo fmt']('Diff in /w/src/main.rs at line 12:'), ['/w/src/main.rs']);
});

test('a path containing spaces is not truncated at the first space', () => {
  assert.deepEqual(FORMAT_PARSERS['cargo fmt']('Diff in /w/my crate/src/lib.rs:3:'), ['/w/my crate/src/lib.rs']);
});

// ---- the other parsers ----------------------------------------------------

test('gofmt -l yields the bare paths it prints', () => {
  assert.deepEqual(FORMAT_PARSERS.gofmt('main.go\ninternal/x.go\n\n'), ['main.go', 'internal/x.go']);
  assert.deepEqual(FORMAT_PARSERS.gofmt(''), [], 'silence from gofmt -l genuinely means conforming');
});

// fact: this fixture is captured from a real scalafmt 3.8.1 run, not composed / the diffs came from stderr and the trailing summary from stdout, which is why the lane merges them (expiry: never, prev: not built)

test('scalafmt --test yields one entry per deviating file, not per diff line', () => {
  const out = [
    '--- a/w/./src/B.scala',
    '+++ b/w/./src/B.scala',
    '@@ -1,4 +1,4 @@',
    ' object B {',
    '-      val y=1',
    '+  val y = 1',
    '--- a/w/./src/A.scala',
    '+++ b/w/./src/A.scala',
    '@@ -1,3 +1,3 @@',
    '-  def f(x:Int)   =    x+1',
    '+  def f(x: Int) = x + 1',
    'error: --test failed',
  ].join('\n');
  assert.deepEqual(FORMAT_PARSERS.scalafmt(out), ['w/src/B.scala', 'w/src/A.scala'],
    'one per file; the `./` the `.` argument leaves behind is collapsed');
});

test('a conforming scalafmt run yields no deviations', () => {
  assert.deepEqual(FORMAT_PARSERS.scalafmt('All files are formatted with scalafmt :)'), []);
});

test('an added source line that looks like a +++ header does not inflate the count', () => {
  // fact: the naive `+++`-only parser returns 2 files for this 1-file diff / an added line beginning `++ b/` is emitted as `+++ b/` and only the `--- a/X` pair distinguishes it (expiry: never, prev: not built)
  const out = [
    '--- a/w/A.scala',
    '+++ b/w/A.scala',
    '@@ -1,2 +1,2 @@',
    '-val a = 1',
    '+++ b/w/IMPOSTOR.scala',
  ].join('\n');
  assert.deepEqual(FORMAT_PARSERS.scalafmt(out), ['w/A.scala'],
    'one real file; the impostor line is inside a hunk and has no `--- a/` partner');
});

test('prettier --check headers are not counted as files', () => {
  const out = [
    'Checking formatting...',
    '[warn] src/app.js',
    '[warn] README.md',
    '[warn] Code style issues found in 2 files. Run Prettier to fix.',
  ].join('\n');
  assert.deepEqual(FORMAT_PARSERS.prettier(out), ['src/app.js', 'README.md']);
});

test('prettier reporting all files formatted yields no deviations', () => {
  assert.deepEqual(FORMAT_PARSERS.prettier('Checking formatting...\nAll matched files use Prettier code style!'), []);
});

test('ruff and black "would reformat" lines both parse', () => {
  assert.deepEqual(FORMAT_PARSERS.ruff('Would reformat: src/a.py\nWould reformat: src/b.py\n1 file left unchanged'), ['src/a.py', 'src/b.py']);
  assert.deepEqual(FORMAT_PARSERS.black('would reformat src/a.py\nOh no! 1 file would be reformatted.'), ['src/a.py']);
});

test('null and empty output do not throw', () => {
  for (const t of Object.keys(FORMAT_PARSERS)) {
    assert.deepEqual(FORMAT_PARSERS[t](null), [], `${t} on null`);
    assert.deepEqual(FORMAT_PARSERS[t](''), [], `${t} on empty`);
  }
});
