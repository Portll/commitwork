// monitor/test/sarif-read.test.mjs — the shared reader's typed states, plus goldens for the sites
// whose semantics the 2026-08-21 migration changed. RED evidence (pre-migration):
//   RED1/RED2 extractors._sarifCounts(error-object husk | executionSuccessful:false) -> {total:0, ran:true}
//   RED3/RED4 audit.classifyFindings(same two artifacts) -> {note:"0", noscan:false}
// rollup's runs-less state:'ok' is pinned at its own level in rollup-unparseable-cve.test.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSarif, ruleIndex, SARIF_STATES } from '../sarif-read.mjs';
import { _sarifCounts, _malCounts } from '../extractors.mjs';
import { classifyFindings } from '../../bin/audit.mjs';

const D = () => mkdtempSync(join(tmpdir(), 'cw-sarif-read-'));
const put = (dir, name, content) => {
  const p = join(dir, name);
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
};

describe('readSarif — every state is typed, and only ok carries arrays', () => {
  test('absent: ENOENT is the ONE code that means legitimately absent', () => {
    const r = readSarif(join(D(), 'never-written.sarif'));
    assert.equal(r.state, 'absent');
    assert.equal(r.runs, null, 'absence must not carry an iterable — a [] here is the false-clean disease');
    assert.equal(r.results, null);
    assert.equal(r.bytes, null);
  });

  test('unreadable: a permission error is NEVER an empty result', () => {
    const d = D();
    const p = put(d, 'locked.sarif', { runs: [{ tool: { driver: { name: 't' } }, results: [] }] });
    chmodSync(p, 0o000);
    const r = readSarif(p);
    // root reads through 0o000, in which case this fixture cannot exercise the branch — skip
    // honestly rather than asserting whatever fell out (explicit uncertainty applies to tests too).
    if (r.state === 'ok') { chmodSync(p, 0o644); return; }
    chmodSync(p, 0o644);
    assert.equal(r.state, 'unreadable');
    assert.equal(r.results, null);
    assert.match(r.reason, /EACCES/);
  });

  test('empty: whitespace-only is its own state — the caller maps it, the reader does not guess', () => {
    const r = readSarif(put(D(), 'empty.sarif', '  \n'));
    assert.equal(r.state, 'empty');
    assert.equal(r.results, null);
  });

  test('unparseable: a truncated write is never a clean zero', () => {
    const r = readSarif(put(D(), 'trunc.sarif', '{"runs":[{"resul'));
    assert.equal(r.state, 'unparseable');
    assert.equal(r.results, null);
  });

  test("never-ran: the tool's error object — valid JSON, no runs[] — is the measured lying shape", () => {
    for (const husk of [{ error: 'osv-scanner: permission denied' }, {}, { version: '2.1.0' }, { runs: null }, { runs: {} }]) {
      const r = readSarif(put(D(), 'husk.sarif', husk));
      assert.equal(r.state, 'never-ran', `${JSON.stringify(husk)} must classify never-ran`);
      assert.equal(r.results, null, 'null, not [] — a zero-length array is precisely what let this shape count as clean');
      assert.equal(r.runs, null);
    }
  });

  // REVERSED 2026-08-23. This was pinned as "a valid report that genuinely found nothing", which
  // reads the SARIF wrong way round: runs[] carries one entry per tool INVOCATION, so an empty
  // array asserts that nothing ran. A tool that ran and found nothing emits ONE run with an empty
  // results[] — the case below. The old reading made a zero-run husk the most invisible state in
  // the vocabulary: ok, zero results, tool null, and excluded from the norules advisory because
  // that requires runs.length > 0.
  test('runs: [] is NEVER-RAN — zero invocations is not a clean scan', () => {
    const r = readSarif(put(D(), 'noruns.sarif', { runs: [] }));
    assert.equal(r.state, 'never-ran');
    assert.equal(r.results, null, 'a void carries null, never an empty array a caller can count');
    assert.match(r.reason, /zero tool invocations/);
  });

  test('a tool that RAN and found nothing is ok — one run, empty results', () => {
    const r = readSarif(put(D(), 'clean.sarif', { runs: [{ tool: { driver: { name: 'osv', rules: [] } }, results: [] }] }));
    assert.equal(r.state, 'ok');
    assert.deepEqual(r.results, []);
    assert.equal(r.tool, 'osv');
    assert.equal(r.norules, true, 'a rules-empty run IS the norules advisory — that shape still reaches it');
  });

  test('tool-failed: executionSuccessful=false with zero results, even with no notifications', () => {
    const r = readSarif(put(D(), 'ef.sarif', { version: '2.1.0', runs: [{ invocations: [{ executionSuccessful: false }], results: [] }] }));
    assert.equal(r.state, 'tool-failed');
    assert.equal(r.reason, 'executionSuccessful=false');
    assert.equal(r.results, null);
  });

  test('tool-failed: the semgrep receipt — executionSuccessful TRUE while the notifications carry the fatal error', () => {
    const r = readSarif(put(D(), 'sg404.sarif', { version: '2.1.0', runs: [{
      invocations: [{ executionSuccessful: true, toolExecutionNotifications: [
        { level: 'error', message: { text: 'Failed to download configuration from https://semgrep.dev/c/p/x HTTP 404.' } }] }],
      results: [], tool: { driver: { name: 'Semgrep OSS', rules: [] } } }] }));
    assert.equal(r.state, 'tool-failed');
    assert.match(r.reason, /404/, "the tool's own reason must survive, uncapped — display truncation is the caller's");
  });

  test('findings WIN over errors: a degraded run is ok, never void — voiding it would discard real findings', () => {
    const r = readSarif(put(D(), 'degraded.sarif', { runs: [{
      invocations: [{ executionSuccessful: false }],
      results: [{ ruleId: 'sqli', level: 'error', message: { text: 'SQL injection' } }] }] }));
    assert.equal(r.state, 'ok');
    assert.equal(r.resultCount, 1);
  });

  test("tool-failed: Semgrep's Pro-language gate — 'note' level, descriptor 'Missing plugin' — is not a clean scan of an unparsed file", () => {
    // shape probed directly, 2026-08-28: a real Elixir rule against real Elixir source on
    // Semgrep 1.153.0 OSS. executionSuccessful is TRUE and results is [] — without this
    // admission the file reads ok/norules, indistinguishable from a genuine clean scan.
    const r = readSarif(put(D(), 'sg-elixir.sarif', { version: '2.1.0', runs: [{
      invocations: [{ executionSuccessful: true, toolExecutionNotifications: [{
        descriptor: { id: 'Missing plugin' }, level: 'note',
        message: { text: 'Missing plugin for rule elixir-system-cmd:\n Missing Semgrep extension needed for parsing Elixir target. Try adding `--pro-languages` to your command.' },
      }] }],
      results: [], tool: { driver: { name: 'Semgrep OSS', rules: [{ id: 'elixir-system-cmd' }] } } }] }));
    assert.equal(r.state, 'tool-failed');
    assert.match(r.reason, /Missing Semgrep extension/);
  });

  test('a note-level notification with a different descriptor is left alone — only "Missing plugin" is admitted', () => {
    const r = readSarif(put(D(), 'note-other.sarif', { runs: [{
      invocations: [{ executionSuccessful: true, toolExecutionNotifications: [{
        descriptor: { id: 'some-other-note' }, level: 'note', message: { text: 'unrelated' } }] }],
      results: [] }] }));
    assert.equal(r.state, 'ok', 'a note is not admitted just for being a note — only the named descriptor is');
  });

  test('warning-level notifications do not fail a run', () => {
    const r = readSarif(put(D(), 'warn.sarif', { runs: [{ invocations: [{ executionSuccessful: true,
      toolExecutionNotifications: [{ level: 'warning', message: { text: 'skipped a large file' } }] }], results: [] }] }));
    assert.equal(r.state, 'ok');
  });

  test('ok normalises run.results to a real array — no caller ever writes `run.results || []` again', () => {
    const r = readSarif(put(D(), 'newer.sarif', { runs: [{ tool: { driver: { name: 't', rules: [{ id: 'a' }] } } }] }));
    assert.equal(r.state, 'ok');
    assert.ok(Array.isArray(r.runs[0].results));
    assert.equal(r.tool, 't');
    assert.equal(r.ruleCount, 1);
  });

  test('norules is a FACT on ok, not a verdict: runs present, zero rules, zero results', () => {
    const flagged = readSarif(put(D(), 'nr.sarif', { runs: [{ tool: { driver: { name: 't', rules: [] } }, results: [] }] }));
    assert.equal(flagged.state, 'ok', 'norules must NOT be a void at the reader — for osv-scanner this is the normal clean shape');
    assert.equal(flagged.norules, true);
    const earned = readSarif(put(D(), 'earned.sarif', { runs: [{ tool: { driver: { name: 't', rules: [{ id: 'a' }] } }, results: [] }] }));
    assert.equal(earned.norules, false, 'a real ruleset earning a real zero is not configuration-void');
  });

  test('bytes and resultCount ride the record — the truncated-but-valid-JSON residual is stated, not covered', () => {
    const r = readSarif(put(D(), 'b.sarif', { runs: [{ results: [{ ruleId: 'x' }] }] }));
    assert.ok(r.bytes > 0);
    assert.equal(r.resultCount, 1);
  });

  test('SARIF_STATES names every state the reader can emit', () => {
    assert.deepEqual([...SARIF_STATES].sort(),
      ['absent', 'empty', 'never-ran', 'ok', 'tool-failed', 'unparseable', 'unreadable'].sort());
  });

  test('ruleIndex: extensions are opt-in, and driver rules win over extension rules', () => {
    const run = { tool: { driver: { rules: [{ id: 'a', from: 'driver' }] },
      extensions: [{ rules: [{ id: 'a', from: 'ext' }, { id: 'b', from: 'ext' }] }] } };
    assert.deepEqual(Object.keys(ruleIndex(run)), ['a']);
    const merged = ruleIndex(run, { extensions: true });
    assert.equal(merged.a.from, 'driver');
    assert.equal(merged.b.from, 'ext');
  });

  test('a large document parses inside a bound (a number, so Performance is a claim, not a vibe)', () => {
    const results = Array.from({ length: 5000 }, (_, i) => ({ ruleId: `r${i % 40}`, level: 'warning',
      message: { text: `finding ${i} — a plausible message with a taint path and a location` },
      locations: [{ physicalLocation: { artifactLocation: { uri: `src/f${i % 200}.js` }, region: { startLine: i % 900 } } }] }));
    const rules = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, properties: { 'security-severity': '7.5' } }));
    const p = put(D(), 'big.sarif', { runs: [{ tool: { driver: { name: 'big', rules } }, results }] });
    const t0 = process.hrtime.bigint();
    const r = readSarif(p);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.equal(r.state, 'ok');
    assert.equal(r.resultCount, 5000);
    // loose on purpose: this pins the ORDER of magnitude (parse + flatten of a ~2.5 MB SARIF),
    // not a machine. Measured ~10-30 ms on an M-series laptop.
    assert.ok(ms < 2000, `readSarif took ${ms.toFixed(1)}ms on 5000 results — over the 2s bound`);
    console.log(`  [perf] readSarif: 5000 results, ${(r.bytes / 1024).toFixed(0)} KiB in ${ms.toFixed(1)}ms`);
  });
});

describe('golden: the RED artifacts, re-read at the migrated sites', () => {
  test('extractors: the error-object husk is neverran (was RED1: a clean ran:true zero)', () => {
    const d = D();
    put(d, 'semgrep.sarif', { error: 'osv-scanner: permission denied' });
    const c = _sarifCounts(d, 'semgrep.sarif');
    assert.equal(c.ran, true);
    assert.equal(c.neverran, true, 'RED1 regressed: the measured lying shape reads as a clean scan again');
    assert.equal(c.total, 0);
  });

  test('extractors: the failed-invocation SARIF is toolfailed (was RED2: a clean ran:true zero)', () => {
    const d = D();
    put(d, 'codeql.sarif', { version: '2.1.0', runs: [{ invocations: [{ executionSuccessful: false }], results: [],
      tool: { driver: { name: 'CodeQL', rules: [{ id: 'x' }] } } }] });
    const c = _sarifCounts(d, 'codeql.sarif');
    assert.equal(c.toolfailed, true, 'RED2 regressed: a run that says it failed reads as a clean scan again');
  });

  test('extractors: the MAL- lane classifies the same husks — it reads the same osv.sarif', () => {
    const d = D();
    put(d, 'osv.sarif', { error: 'osv-scanner: permission denied' });
    assert.equal(_malCounts(d, 'osv.sarif').neverran, true);
  });

  test('audit: the error-object husk is noscan (was RED3: parsed clean, note "0")', () => {
    const d = D();
    put(d, 'semgrep.sarif', { error: 'semgrep: permission denied' });
    const r = classifyFindings({ id: 'semgrep', report: 'sarif', category: 'sast' }, d);
    assert.equal(r.noscan, true, 'RED3 regressed: the audit lane scores a husk as a clean scan again');
    assert.match(r.reason, /no runs\[\]/);
  });

  test('audit: the failed-invocation SARIF is noscan (was RED4: parsed clean, note "0")', () => {
    const d = D();
    put(d, 'semgrep.sarif', { version: '2.1.0', runs: [{ invocations: [{ executionSuccessful: false }], results: [] }] });
    const r = classifyFindings({ id: 'semgrep', report: 'sarif', category: 'sast' }, d);
    assert.equal(r.noscan, true, 'RED4 regressed');
    assert.match(r.reason, /tool reported failure/);
  });
});

// A zero with no invocation record cannot self-certify that the tool ran. Measured on osv-scanner:
// egress severed gives 0 results, egress healthy gives 5, and invocations[] is empty in BOTH — so
// the artifact alone cannot separate a clean scan from a scan of nothing.
describe('unwitnessedZero — a zero nothing witnessed is reported, not resolved', () => {
  const run = (extra = {}) => ({ version: '2.1.0', runs: [{ tool: { driver: { name: 'osv-scanner' } }, results: [], ...extra }] });

  test('zero results with NO invocations is flagged — and stays ok, never a failure', () => {
    const d = D();
    put(d, 'a.sarif', run());
    const r = readSarif(join(d, 'a.sarif'));
    assert.equal(r.state, 'ok', 'must NOT be promoted to tool-failed');
    assert.equal(r.unwitnessedZero, true);
  });

  test('an invocation record witnesses the zero', () => {
    const d = D();
    put(d, 'a.sarif', run({ invocations: [{ executionSuccessful: true }] }));
    const r = readSarif(join(d, 'a.sarif'));
    assert.equal(r.state, 'ok');
    assert.equal(r.unwitnessedZero, false, 'an execution record is exactly the witness that was missing');
  });

  test('results witness themselves — no invocation needed', () => {
    const d = D();
    put(d, 'a.sarif', { version: '2.1.0', runs: [{ tool: { driver: { name: 'osv-scanner' } }, results: [{ ruleId: 'x', message: { text: 'y' } }] }] });
    assert.equal(readSarif(join(d, 'a.sarif')).unwitnessedZero, false);
  });

  test('a declared failure still outranks it — tool-failed is not softened', () => {
    const d = D();
    put(d, 'a.sarif', run({ invocations: [{ executionSuccessful: false }] }));
    assert.equal(readSarif(join(d, 'a.sarif')).state, 'tool-failed');
  });

  // The flip this replaces would fail 2,103 of 10,354 stored SARIFs (Trivy 1446, osv-scanner 369,
  // GuardDog-npm 288) — one in five, most genuinely clean. Pinned so the "obvious" fix is refused
  // by a test rather than by whoever remembers the measurement.
  test('the field DISCRIMINATES — two shapes, two answers, same state', () => {
    const d = D();
    put(d, 'without.sarif', run());
    put(d, 'with.sarif', run({ invocations: [{ executionSuccessful: true }] }));
    const a = readSarif(join(d, 'without.sarif')), b = readSarif(join(d, 'with.sarif'));
    assert.notEqual(a.unwitnessedZero, b.unwitnessedZero, 'a field that never varies pins nothing');
    assert.equal(a.state, b.state, 'the STATE must not diverge — that is the fleet-wide false positive');
  });
});
