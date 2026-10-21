/**
 * Tests for the `lint` dimension's pure half. Each case is named for the WRONG answer it stops.
 * The two that matter most are severity (a repo that declares -W must never be reported as
 * failing) and completeness (an aborted linter's count is a floor, not a total).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINT_PARSERS, lintFindings, lintComplete, foldLint } from '../lib/build-health-parse.mjs';

const fold = (o) => foldLint({ lang: 'rust', tool: 'clippy', declaredBy: 'its own CI workflow', command: 'x', ...o });
const f = (n) => Array.from({ length: n }, (_, i) => ({ file: `a${i}.rs`, line: i, severity: 'warning', message: 'm' }));

// ---- severity is the repo's, not the tool's -------------------------------

test('a WARN-declared repo with diagnostics is advisory, never findings — the bar is the repo\'s', () => {
  // memory-layer runs `cargo clippy --all-targets -- -W clippy::all`, counts warnings, and prints
  // "Status | Passed" unconditionally. Reporting it as FAILING asserts a bar it never set.
  const r = fold({ enforced: false, ok: true, code: 0, findings: f(105) });
  assert.equal(r.status, 'advisory');
  assert.equal(r.enforced, 'warn');
  assert.equal(r.findingCount, 105);
  assert.match(r.note, /WARN level/);
  assert.doesNotMatch(r.status, /^findings:/);
});

test('a DENY-declared repo with diagnostics reports findings', () => {
  const r = fold({ enforced: true, ok: false, code: 101, findings: f(3) });
  assert.equal(r.status, 'findings:3');
  assert.equal(r.enforced, 'deny');
});

test('zero diagnostics is clean under either declaration', () => {
  assert.equal(fold({ enforced: false, ok: true, code: 0, findings: [] }).status, 'clean');
  assert.equal(fold({ enforced: true, ok: true, code: 0, findings: [] }).status, 'clean');
});

// ---- an aborted run is a floor, not a count -------------------------------

test('an aborted linter is unreadable with a FLOOR, never a count — a crashing lint must not look clean', () => {
  // Measured on memory-layer: clippy parsed real diagnostics and ended `error: could not compile`.
  // Two runs of the same command on the same tree floored at 105 and 212 — publishing either as
  // a count publishes a number that does not reproduce.
  const r = fold({ enforced: false, ok: false, code: 101, findings: f(212),
    completeness: { complete: false, reason: 'error: could not compile `memory-layer` (bench "x") due to 2 previous errors' } });
  assert.equal(r.status, 'unreadable');
  assert.equal(r.findingCount, null, 'null, not a number — we do not know the count');
  assert.equal(r.findingsFloor, 212, 'the parsed diagnostics are real and are kept');
  assert.equal(r.complete, false);
  // The sample is capped at 200 like every other payload here; the FLOOR carries the true
  // number, so a reader cannot mistake the truncated list for the whole of what was parsed.
  assert.equal(r.findings.length, 200, 'sample capped');
  assert.ok(r.findingsFloor > r.findings.length, 'the floor must exceed the sample when truncated, or the cap silently becomes the count');
  assert.match(r.note, /FLOOR|not evidence of absence/);
});

test('an aborted run under a DENY declaration is still unreadable, not findings', () => {
  const r = fold({ enforced: true, ok: false, code: 101, findings: f(9),
    completeness: { complete: false, reason: 'error: aborting due to 3 previous errors' } });
  assert.equal(r.status, 'unreadable', 'an incomplete deny-run must not be published as a finding count');
  assert.equal(r.findingCount, null);
});

test('lintComplete detects the abort forms and defaults to complete', () => {
  assert.equal(lintComplete('clippy', 'warning: x\nerror: could not compile `memory-layer` (bench "b") due to 2 previous errors').complete, false);
  assert.equal(lintComplete('clippy', 'error: aborting due to 5 previous errors').complete, false);
  assert.equal(lintComplete('clippy', 'warning: unused\nwarning: 2 warnings emitted').complete, true);
  assert.equal(lintComplete('clippy', '').complete, true);
  assert.equal(lintComplete('clippy', null).complete, true);
});

// ---- the cross-check, inherited from foldFormat ---------------------------

test('non-zero exit with nothing parsed is unreadable, never clean', () => {
  const r = fold({ enforced: true, ok: false, code: 127, findings: [] });
  assert.equal(r.status, 'unreadable');
  assert.equal(r.findingCount, null);
});

test('an unregistered tool is unreadable — no parser means nothing was read', () => {
  assert.equal(lintFindings('some-new-linter', 'whatever'), null);
  assert.equal(fold({ tool: 'some-new-linter', enforced: true, ok: true, code: 0, findings: null }).status, 'unreadable');
});

// ---- the parsers ----------------------------------------------------------

test('clippy short-format lines parse to diagnostics with severity preserved', () => {
  const out = [
    'src/intent_log/projection.rs:527:24: warning: unnecessary `>= y + 1`',
    'tests/memory_tiering_tests.rs:456:9: error: this comparison involving the minimum',
    'warning: `memory-layer` (lib) generated 4 warnings',
  ].join('\n');
  const got = LINT_PARSERS.clippy(out);
  assert.equal(got.length, 2, 'the "generated N warnings" summary is not a diagnostic');
  assert.equal(got[0].severity, 'warning');
  assert.equal(got[1].severity, 'error');
  assert.equal(got[1].file, 'tests/memory_tiering_tests.rs');
  assert.equal(got[1].line, 456);
});

test('eslint unix, golangci-lint and ruff concise all parse', () => {
  assert.deepEqual(LINT_PARSERS.eslint('/w/src/a.js:3:7: Unexpected var [Error/no-var]').map((d) => [d.line, d.severity, d.rule]), [[3, 'error', 'no-var']]);
  assert.deepEqual(LINT_PARSERS['golangci-lint']('main.go:12:2: unused variable (govet)').map((d) => [d.line, d.rule]), [[12, 'govet']]);
  assert.deepEqual(LINT_PARSERS.ruff('src/a.py:1:1: F401 unused import').map((d) => [d.line, d.rule]), [[1, 'F401']]);
});

test('null and empty output do not throw and yield no diagnostics', () => {
  for (const t of Object.keys(LINT_PARSERS)) {
    assert.deepEqual(LINT_PARSERS[t](null), [], `${t} on null`);
    assert.deepEqual(LINT_PARSERS[t](''), [], `${t} on empty`);
  }
});
