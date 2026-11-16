// The retry pass re-scans only the files Semgrep timed out on, merges what it finds, and leaves the
// original Timeout evidence in place so the reader can tell recovered from still-missing. Every
// case here is a pair or a negative: the SARIF must be byte-identical whenever the retry did not
// happen, and the partial set must shrink by exactly the files the retry covered without timing out
// again.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrySemgrep, mergeRetry, resultKey, retryControls, readFixpoint, DEFAULTS } from '../semgrep-retry.mjs';
import { readSarif, describePartial, RETRIED_REASONS } from '../../monitor/sarif-read.mjs';
import { parseSarif } from '../lib/report-parsers/sarif.mjs';
import { _sarifCounts } from '../../monitor/extractors.mjs';
import { laneCoverage } from '../commitwork.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULE = 'javascript.express.file.sharp-express.sharp-express';
const RULE2 = 'javascript.koa.file.sharp-koa.sharp-koa';
const PLANTED = 'javascript.lang.security.audit.planted';

const timeout = (rule, file) => ({ descriptor: { id: 'Timeout' }, level: 'warning', message: { text: `Timeout when running ${rule} on ${file}:\n ` } });
const syntax = (file) => ({ descriptor: { id: 'Syntax error' }, level: 'warning', message: { text: `Syntax error at line ${file}:3:\n \`)\` was unexpected` } });
const result = (file, line, fp) => ({
  ruleId: PLANTED, level: 'error', message: { text: 'planted' },
  fingerprints: { 'matchBasedId/v1': fp },
  locations: [{ physicalLocation: { artifactLocation: { uri: file }, region: { startLine: line, startColumn: 1, endLine: line, endColumn: 9 } } }],
});
const doc = (notifications, results = []) => ({
  version: '2.1.0',
  runs: [{
    tool: { driver: { name: 'Semgrep OSS', semanticVersion: '1.180.0', rules: [{ id: PLANTED }] } },
    results,
    invocations: [{ executionSuccessful: true, toolExecutionNotifications: notifications }],
  }],
});
const uris = (rows) => rows.map((r) => r.uri);

/** A scan directory holding a.js and b.js, and a main SARIF that timed out on a.js, b.js and a
 *  missing c.js, with one existing result on a.js. */
function fixture(notifications = null) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-sg-retry-'));
  const scan = join(dir, 'repo');
  const out = join(dir, 'out');
  mkdirSync(scan); mkdirSync(out);
  for (const f of ['a.js', 'b.js']) writeFileSync(join(scan, f), 'const x = 1;\n');
  const main = doc(notifications || [timeout(RULE, 'a.js'), timeout(RULE2, 'a.js'), timeout(RULE, 'b.js'), timeout(RULE, 'c.js')], [result('a.js', 1, 'fp-existing')]);
  const sarif = join(out, 'semgrep.sarif');
  writeFileSync(sarif, JSON.stringify(main));
  return { dir, scan, out, sarif };
}

/** A stand-in for Semgrep: records the call, writes the retry SARIF to --output. By default it
 *  finds one new result and one duplicate on a.js and times out on b.js again. */
function fakeSemgrep({ status = 1, retryDoc = null, signal = null, error = null, retryJson = null } = {}) {
  const calls = [];
  const spawn = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    if (error) return { error, status: null, signal: null, stderr: '' };
    if (signal) return { status: null, signal, stderr: '' };
    const output = args[args.indexOf('--output') + 1];
    const d = retryDoc || doc([timeout(RULE, 'b.js')], [result('a.js', 1, 'fp-existing'), result('a.js', 7, 'fp-new')]);
    writeFileSync(output, JSON.stringify(d));
    const jsonAt = args.indexOf('--json-output');
    if (jsonAt >= 0 && retryJson !== null) writeFileSync(args[jsonAt + 1], typeof retryJson === 'string' ? retryJson : JSON.stringify(retryJson));
    return { status, signal: null, stderr: 'retry stderr\n' };
  };
  return { spawn, calls };
}

// Semgrep 1.180.0's JSON shape, measured: present only in --json output, never in the SARIF.
const fixpointEntry = (file, line) => ({
  error_type: 'Fixpoint timeout', severity: 'warn',
  message: `Fixpoint timeout while performing taint analysis at ${file}:${line}:5 [rules: 2, first: cw-wp-request-to-html]`,
  location: { path: file, start: { line, col: 5, offset: 0 }, end: { line, col: 9, offset: 4 } },
});
const scanJson = (entries) => ({ version: '1.180.0', results: [], errors: [], time: { fixpoint_timeouts: entries } });
const fixpointNotice = (file, line) => ({
  descriptor: { id: 'Fixpoint timeout' }, level: 'warning',
  message: { text: `Fixpoint timeout while performing taint analysis at ${file}:${line}:5 [rules: 2, first: r]` },
  locations: [{ physicalLocation: { artifactLocation: { uri: file }, region: { startLine: line } } }],
});

const ENV = { CW_NOW: '2026-10-11T00:00:00.000Z', PATH: process.env.PATH };

describe('a retry that ran merges its results and shrinks the partial set by exactly what it covered', () => {
  const fx = fixture();
  const fake = fakeSemgrep();
  const receipt = retrySemgrep({ sarifPath: fx.sarif, configArgs: ['--config', 'p/default'], cwd: fx.scan, env: ENV, spawn: fake.spawn });

  test('the receipt names the state, the files, what was recovered and what still times out', () => {
    assert.equal(receipt.state, 'retried');
    assert.deepEqual(receipt.files, ['a.js', 'b.js'], 'c.js does not exist under the scan directory and cannot be retried');
    assert.deepEqual(receipt.notRetried, ['c.js']);
    assert.equal(receipt.resultsAdded, 1, 'the duplicate of the existing result is dropped by fingerprint');
    assert.deepEqual(receipt.recovered, ['a.js']);
    assert.deepEqual(receipt.stillTimedOut, ['b.js'], 'the retry\'s own failure set; c.js is in notRetried');
    assert.equal(receipt.timeoutSec, DEFAULTS.timeoutSec);
    assert.equal(receipt.at, ENV.CW_NOW, 'the timestamp honours CW_NOW');
    const onDisk = JSON.parse(readFileSync(join(fx.out, 'semgrep-retry.json'), 'utf8'));
    assert.deepEqual(onDisk, receipt);
  });

  test('Semgrep was asked for exactly the timed-out files, the long timeout and no skip threshold', () => {
    assert.equal(fake.calls.length, 1);
    const { bin, args, opts } = fake.calls[0];
    assert.equal(bin, 'semgrep');
    assert.equal(args[0], 'scan');
    assert.deepEqual(args.slice(1, 3), ['--config', 'p/default'], 'the lane\'s own packs are passed through');
    assert.deepEqual(args.slice(-2), ['a.js', 'b.js'], 'targets are the files, not the tree');
    assert.equal(args[args.indexOf('--timeout') + 1], String(DEFAULTS.timeoutSec));
    assert.equal(args[args.indexOf('--timeout-threshold') + 1], '0');
    assert.equal(opts.cwd, fx.scan);
    assert.equal(opts.timeout, DEFAULTS.budgetSec * 1000, 'the wall-clock budget is the spawn timeout');
    assert.ok(!args.includes('-j'), 'no fixpoint file was retried, so Semgrep keeps its own job count');
    assert.ok(!args.includes('--json-output'), 'no main JSON was given, so none is asked of the retry');
    assert.deepEqual(receipt.fixpoint, { measured: false, reason: 'no Semgrep JSON was given (--json)' });
  });

  test('the merged SARIF keeps the original Timeout evidence and marks what the retry added', () => {
    const j = JSON.parse(readFileSync(fx.sarif, 'utf8'));
    const run = j.runs[0];
    assert.equal(run.results.length, 2);
    assert.equal(run.results[1].properties.commitworkRecoveredOnRetry, true);
    assert.equal(run.invocations.length, 2);
    assert.equal(run.invocations[0].toolExecutionNotifications.filter((n) => n.descriptor.id === 'Timeout').length, 4, 'the main invocation is untouched');
    assert.deepEqual(run.invocations[1].properties.commitworkRetry.files, ['a.js', 'b.js']);
    assert.ok(existsSync(join(fx.out, 'semgrep-retry.sarif')), 'the retry run is kept as its own artifact');
    assert.match(readFileSync(join(fx.out, 'semgrep-retry.log'), 'utf8'), /retry stderr/);
  });

  test('the reader drops the recovered file and keeps the one that timed out again', () => {
    const r = readSarif(fx.sarif);
    assert.equal(r.state, 'ok');
    assert.equal(r.resultCount, 2);
    assert.deepEqual(r.partialAnalysis, [
      { uri: 'b.js', reasons: ['timeout'], notices: 1 },
      { uri: 'c.js', reasons: ['timeout'], notices: 1 },
    ], 'c.js was never retried, so it stays as measured');
    assert.deepEqual(r.partialRetry, { files: ['a.js', 'b.js'], timeoutSec: DEFAULTS.timeoutSec, recovered: ['a.js'], stillTimedOut: ['b.js'] });
  });

  test('every consumer says what the retry did', () => {
    const p = parseSarif(fx.sarif);
    assert.match(p.summary, / — 2 file\(s\) read only in part — 1 file\(s\) recovered on retry$/);
    const c = _sarifCounts(fx.out, 'semgrep.sarif');
    assert.equal(c.total, 2, 'findings found, including the recovered one, are counted');
    assert.equal(c.coverageIncomplete, true);
    assert.equal(c.partialAnalysis.files, 2);
    assert.deepEqual(c.partialAnalysis.retry.recovered, ['a.js']);
    assert.match(c.coverage.reason, /^2 file\(s\) were read only in part \(2 timeout\)/);
    assert.match(c.coverage.reason, /; a retry at 60s per rule covered 2 file\(s\) and recovered 1$/);
    const v = laneCoverage({ id: 'sast', report: { file: 'semgrep.sarif', format: 'sarif' } }, fx.out);
    assert.equal(v.coverage, 'reduced');
    assert.match(v.coverageReason, /b\.js, c\.js; a retry at 60s per rule covered 2 file\(s\) and recovered 1$/);
  });

  test('a second pass over the merged SARIF is a no-op, not a stacked retry', () => {
    const before = readFileSync(fx.sarif, 'utf8');
    const again = retrySemgrep({ sarifPath: fx.sarif, configArgs: [], cwd: fx.scan, env: ENV, spawn: fake.spawn });
    assert.equal(again.state, 'already-retried');
    assert.deepEqual(again.recovered, ['a.js']);
    assert.equal(fake.calls.length, 1, 'Semgrep was not run again');
    assert.equal(readFileSync(fx.sarif, 'utf8'), before);
  });
});

describe('every state that is not a retry leaves the SARIF byte-identical', () => {
  const unchanged = (name, { env = ENV, fake = fakeSemgrep(), sarifDoc = null, json } = {}) => {
    const fx = fixture();
    if (sarifDoc) writeFileSync(fx.sarif, JSON.stringify(sarifDoc));
    const jsonPath = json === undefined ? null : join(fx.out, 'semgrep.json');
    if (json !== undefined && json !== 'missing') writeFileSync(jsonPath, typeof json === 'string' ? json : JSON.stringify(json));
    const before = readFileSync(fx.sarif, 'utf8');
    const receipt = retrySemgrep({ sarifPath: fx.sarif, jsonPath, configArgs: [], cwd: fx.scan, env, spawn: fake.spawn });
    assert.equal(readFileSync(fx.sarif, 'utf8'), before, `${name}: the SARIF moved`);
    assert.deepEqual(JSON.parse(readFileSync(join(fx.out, 'semgrep-retry.json'), 'utf8')).state, receipt.state, `${name}: the receipt on disk disagrees`);
    return { receipt, fake };
  };

  test('switched off: a receipt says so and Semgrep is never run', () => {
    const { receipt, fake } = unchanged('disabled', { env: { ...ENV, CW_SEMGREP_RETRY: '0' } });
    assert.equal(receipt.state, 'disabled');
    assert.equal(fake.calls.length, 0);
  });

  test('nothing timed out: nothing to retry, Semgrep is never run', () => {
    const { receipt, fake } = unchanged('nothing', { sarifDoc: doc([]) });
    assert.equal(receipt.state, 'nothing-to-retry');
    assert.equal(fake.calls.length, 0);
  });

  test('a file read only in part for another reason is not a retry target', () => {
    const { receipt, fake } = unchanged('syntax-only', { sarifDoc: doc([syntax('a.js')]) });
    assert.equal(receipt.state, 'nothing-to-retry');
    assert.equal(fake.calls.length, 0);
  });

  test('a path that reads as a flag or leaves the scan root is never passed to Semgrep', () => {
    const { receipt, fake } = unchanged('hostile', { sarifDoc: doc([timeout(RULE, '--config=x.yml'), timeout(RULE, '../out/semgrep.sarif')]) });
    assert.equal(receipt.state, 'nothing-to-retry');
    assert.deepEqual(receipt.notRetried, ['--config=x.yml', '../out/semgrep.sarif'], 'the second exists, outside the scan root');
    assert.equal(fake.calls.length, 0);
  });

  test('the tool exited above 1: failed, with the exit and the last stderr line', () => {
    const { receipt } = unchanged('exit-2', { fake: fakeSemgrep({ status: 2 }) });
    assert.equal(receipt.state, 'failed');
    assert.equal(receipt.exit, 2);
    assert.match(receipt.reason, /exited 2/);
  });

  test('killed by the budget: failed, and the reason names the budget', () => {
    const { receipt } = unchanged('budget', { fake: fakeSemgrep({ signal: 'SIGTERM' }), env: { ...ENV, CW_SEMGREP_RETRY_BUDGET_SEC: '9' } });
    assert.equal(receipt.state, 'failed');
    assert.match(receipt.reason, /9s budget/);
  });

  test('the binary is missing: failed, never a crash', () => {
    const { receipt } = unchanged('enoent', { fake: fakeSemgrep({ error: Object.assign(new Error('spawn semgrep ENOENT'), { code: 'ENOENT' }) }) });
    assert.equal(receipt.state, 'failed');
    assert.match(receipt.reason, /ENOENT/);
  });

  test('a retry SARIF that does not read ok: failed, the main SARIF unchanged', () => {
    const { receipt } = unchanged('retry-void', { fake: fakeSemgrep({ retryDoc: { version: '2.1.0', runs: [] } }) });
    assert.equal(receipt.state, 'failed');
    assert.match(receipt.reason, /reads never-ran/);
  });

  const OFF = { ...ENV, CW_SEMGREP_RETRY: '0' };

  test('an empty fixpoint list is measured and records nothing', () => {
    const { receipt } = unchanged('fixpoint-empty', { sarifDoc: doc([]), json: scanJson([]) });
    assert.equal(receipt.state, 'nothing-to-retry');
    assert.deepEqual(receipt.fixpoint, { measured: true, json: 'semgrep.json', count: 0, unattributed: 0, injected: 0 });
  });

  test('a JSON without time.fixpoint_timeouts (Opengrep writes none): unmeasured, nothing recorded', () => {
    const { receipt } = unchanged('fixpoint-fieldless', { env: OFF, json: { results: [], errors: [] } });
    assert.equal(receipt.fixpoint.measured, false);
    assert.match(receipt.fixpoint.reason, /carries no time\.fixpoint_timeouts/);
  });

  test('a JSON that was not written: unmeasured, never an empty list', () => {
    const { receipt } = unchanged('fixpoint-missing', { env: OFF, json: 'missing' });
    assert.equal(receipt.fixpoint.measured, false);
    assert.match(receipt.fixpoint.reason, /was not written/);
  });

  test('a JSON that does not parse: unmeasured', () => {
    const { receipt } = unchanged('fixpoint-unparseable', { env: OFF, json: '{"time": {"fixpoint_timeouts": [' });
    assert.equal(receipt.fixpoint.measured, false);
    assert.match(receipt.fixpoint.reason, /not valid JSON/);
  });

  test('a main SARIF that is not ok has nothing to retry against', () => {
    const fx = fixture();
    writeFileSync(fx.sarif, '{not json');
    const receipt = retrySemgrep({ sarifPath: fx.sarif, configArgs: [], cwd: fx.scan, env: ENV, spawn: fakeSemgrep().spawn });
    assert.equal(receipt.state, 'no-artifact');
    assert.equal(receipt.sarifState, 'unparseable');
  });
});

describe('fixpoint timeouts reach the SARIF from Semgrep\'s JSON, and a retry at -j 1 can clear them', () => {
  // Measured 2026-11-15 on 15 live-composer files: default -j lost 28-29 fixpoint timeouts and two
  // results, -j 1 lost 3-4. Both runs exited 0 and neither SARIF nor JSON `errors` named one.
  const mainJson = () => scanJson([fixpointEntry('b.js', 4), fixpointEntry('a.js', 30), fixpointEntry('a.js', 10)]);
  const setup = ({ env = ENV, fake } = {}) => {
    const fx = fixture([]);
    const json = join(fx.out, 'semgrep.json');
    writeFileSync(json, JSON.stringify(mainJson()));
    const receipt = retrySemgrep({ sarifPath: fx.sarif, jsonPath: json, configArgs: ['--config', 'p/x'], cwd: fx.scan, env, spawn: fake.spawn });
    return { fx, json, receipt };
  };

  describe('a measured retry', () => {
    const fake = fakeSemgrep({ retryDoc: doc([], [result('a.js', 12, 'fp-fix')]), retryJson: scanJson([fixpointEntry('b.js', 4)]) });
    const { fx, json, receipt } = setup({ fake });

    test('the receipt records the detection and the retry', () => {
      assert.deepEqual(receipt.fixpoint, { measured: true, json: 'semgrep.json', count: 3, unattributed: 0, injected: 3 });
      assert.equal(receipt.state, 'retried');
      assert.deepEqual(receipt.files, ['a.js', 'b.js']);
      assert.deepEqual(receipt.recovered, ['a.js']);
      assert.deepEqual(receipt.stillTimedOut, ['b.js']);
      assert.deepEqual(receipt.unmeasured, []);
      assert.equal(receipt.jobs, 1);
      assert.deepEqual(receipt.retryFixpoint, { measured: true, json: 'semgrep-retry.scan.json', count: 1, unattributed: 0 });
      assert.equal(receipt.resultsAdded, 1);
    });

    test('a retry of fixpoint files runs at -j 1 and writes its own JSON', () => {
      const { args } = fake.calls[0];
      assert.equal(args[args.indexOf('-j') + 1], '1');
      assert.equal(args[args.indexOf('--json-output') + 1], join(fx.out, 'semgrep-retry.scan.json'));
      assert.deepEqual(args.slice(-2), ['a.js', 'b.js']);
    });

    test('the record is its own invocation; the main one is untouched', () => {
      const inv = JSON.parse(readFileSync(fx.sarif, 'utf8')).runs[0].invocations;
      assert.equal(inv.length, 3);
      assert.deepEqual(inv[0].toolExecutionNotifications, []);
      assert.deepEqual(inv[1].properties.commitworkFixpoint, { source: 'time.fixpoint_timeouts', json: 'semgrep.json', count: 3, unattributed: 0 });
      assert.deepEqual(inv[1].toolExecutionNotifications.map((n) => [n.locations[0].physicalLocation.artifactLocation.uri, n.locations[0].physicalLocation.region.startLine]), [['a.js', 10], ['a.js', 30], ['b.js', 4]], 'sorted by file then line');
      assert.equal(inv[2].properties.commitworkRetry.fixpointMeasured, true);
      assert.equal(inv[2].properties.commitworkRetry.jobs, 1);
    });

    test('the reader clears the file the retry finished and keeps the one that recurred', () => {
      const r = readSarif(fx.sarif);
      assert.deepEqual(r.partialAnalysis, [{ uri: 'b.js', reasons: ['fixpoint-timeout'], notices: 1 }]);
      assert.deepEqual(r.partialRetry, { files: ['a.js', 'b.js'], timeoutSec: 60, recovered: ['a.js'], stillTimedOut: ['b.js'] });
      assert.equal(r.resultCount, 2);
      assert.deepEqual(r.ruleFailures, [], 'a fixpoint timeout is a fact about a file, not a rule');
    });

    test('a second pass records nothing and runs nothing', () => {
      const before = readFileSync(fx.sarif, 'utf8');
      const again = retrySemgrep({ sarifPath: fx.sarif, jsonPath: json, configArgs: [], cwd: fx.scan, env: ENV, spawn: fake.spawn });
      assert.equal(again.state, 'already-retried');
      assert.equal(again.fixpoint.injected, 0);
      assert.equal(fake.calls.length, 1);
      assert.equal(readFileSync(fx.sarif, 'utf8'), before);
    });
  });

  test('detection runs while the retry is switched off, and only once', () => {
    const fake = fakeSemgrep();
    const { fx, json, receipt } = setup({ env: { ...ENV, CW_SEMGREP_RETRY: '0' }, fake });
    assert.equal(receipt.state, 'disabled');
    assert.equal(receipt.fixpoint.injected, 3);
    assert.equal(fake.calls.length, 0);
    assert.deepEqual(readSarif(fx.sarif).partialAnalysis, [
      { uri: 'a.js', reasons: ['fixpoint-timeout'], notices: 2 },
      { uri: 'b.js', reasons: ['fixpoint-timeout'], notices: 1 },
    ]);
    const before = readFileSync(fx.sarif, 'utf8');
    const again = retrySemgrep({ sarifPath: fx.sarif, jsonPath: json, configArgs: [], cwd: fx.scan, env: { ...ENV, CW_SEMGREP_RETRY: '0' }, spawn: fake.spawn });
    assert.equal(again.fixpoint.injected, 0);
    assert.equal(readFileSync(fx.sarif, 'utf8'), before, 'a second detection does not stack a second record');
  });

  for (const [name, retryJson] of [['was not written', null], ['does not parse', '{"time":'], ['has no fixpoint field', { results: [] }]]) {
    test(`a retry whose JSON ${name} cannot clear a fixpoint timeout`, () => {
      const fake = fakeSemgrep({ retryDoc: doc([]), retryJson });
      const { fx, receipt } = setup({ fake });
      assert.equal(receipt.state, 'retried');
      assert.equal(receipt.retryFixpoint.measured, false);
      assert.deepEqual(receipt.recovered, []);
      assert.deepEqual(receipt.unmeasured, ['a.js', 'b.js']);
      const r = readSarif(fx.sarif);
      assert.deepEqual(uris(r.partialAnalysis), ['a.js', 'b.js'], 'an unmeasured retry leaves the rows as measured');
      assert.deepEqual(r.partialRetry.unmeasured, ['a.js', 'b.js']);
      assert.match(describePartial(r.partialAnalysis, r.partialRetry), /covered 2 file\(s\) and recovered 0, 2 not re-measured$/);
      assert.equal(JSON.parse(readFileSync(fx.sarif, 'utf8')).runs[0].invocations[2].properties.commitworkRetry.fixpointMeasured, false);
    });
  }

  test('readFixpoint names the file from the location, else from the message, and counts what it cannot', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'cw-fx-')), 's.json');
    const noLoc = { ...fixpointEntry('z.php', 8) };
    delete noLoc.location;
    writeFileSync(p, JSON.stringify(scanJson([fixpointEntry('m.php', 3), noLoc, { error_type: 'Fixpoint timeout', message: 'unrecognised' }])));
    const fx = readFixpoint(p);
    assert.equal(fx.measured, true);
    assert.equal(fx.count, 3);
    assert.equal(fx.unattributed, 1);
    assert.deepEqual(fx.entries.map((e) => [e.uri, e.line]), [['m.php', 3], ['z.php', 8]]);
  });
});

describe('the operator controls are read at call time and reach the command', () => {
  test('timeout and file cap', () => {
    const fx = fixture();
    const fake = fakeSemgrep({ retryDoc: doc([]) });
    const receipt = retrySemgrep({ sarifPath: fx.sarif, configArgs: [], cwd: fx.scan, env: { ...ENV, CW_SEMGREP_RETRY_TIMEOUT: '7', CW_SEMGREP_RETRY_MAX_FILES: '1' }, spawn: fake.spawn });
    assert.equal(receipt.state, 'retried');
    assert.deepEqual(receipt.files, ['a.js']);
    assert.deepEqual(receipt.notRetried, ['c.js', 'b.js'], 'the capped file is named, not silently dropped');
    assert.equal(fake.calls[0].args[fake.calls[0].args.indexOf('--timeout') + 1], '7');
    const r = readSarif(fx.sarif);
    assert.deepEqual(uris(r.partialAnalysis), ['b.js', 'c.js'], 'a file the retry never reached stays as measured');
    assert.deepEqual(r.partialRetry.recovered, ['a.js']);
    assert.equal(r.partialRetry.timeoutSec, 7);
  });

  test('defaults and the off switch', () => {
    assert.deepEqual(retryControls({}), { enabled: true, ...DEFAULTS });
    assert.equal(DEFAULTS.jobs, null, 'unset, the job count is decided by what is retried');
    assert.equal(retryControls({ CW_SEMGREP_RETRY: 'off' }).enabled, false);
    assert.equal(retryControls({ CW_SEMGREP_RETRY_TIMEOUT: 'abc' }).timeoutSec, DEFAULTS.timeoutSec, 'garbage falls back, never NaN');
    assert.equal(retryControls({ CW_SEMGREP_RETRY_JOBS: '4' }).jobs, 4);
    assert.equal(retryControls({ CW_SEMGREP_RETRY_JOBS: 'abc' }).jobs, null);
    assert.equal(retryControls({ CW_SEMGREP_RETRY_JOBS: '0.5' }).jobs, 1, 'a fraction never reaches Semgrep as -j 0');
  });

  test('an explicit job count reaches a retry of fixpoint files unchanged', () => {
    const fx = fixture([]);
    const json = join(fx.out, 'semgrep.json');
    writeFileSync(json, JSON.stringify(scanJson([fixpointEntry('a.js', 10)])));
    const fake = fakeSemgrep({ retryDoc: doc([]), retryJson: scanJson([]) });
    const receipt = retrySemgrep({ sarifPath: fx.sarif, jsonPath: json, configArgs: [], cwd: fx.scan, env: { ...ENV, CW_SEMGREP_RETRY_JOBS: '2' }, spawn: fake.spawn });
    assert.equal(receipt.jobs, 2);
    const { args } = fake.calls[0];
    assert.equal(args[args.indexOf('-j') + 1], '2');
  });
});

describe('merge arithmetic', () => {
  test('results dedupe on the match id, else on rule and place', () => {
    assert.equal(resultKey(result('a.js', 1, 'x')), 'fp:x');
    const noFp = { ruleId: 'r', locations: [{ physicalLocation: { artifactLocation: { uri: 'f' }, region: { startLine: 1, startColumn: 2, endLine: 1, endColumn: 5 } } }] };
    assert.equal(resultKey(noFp), 'place:r|f|1|2|1|5');
  });

  test('rules the retry loaded are unioned by id', () => {
    const main = doc([timeout(RULE, 'a.js')]);
    const retry = doc([], [result('a.js', 1, 'n')]);
    retry.runs[0].tool.driver.rules.push({ id: 'new.rule' });
    const { doc: merged, added } = mergeRetry(main, retry.runs, { files: ['a.js'], timeoutSec: 60, bin: 'semgrep', at: ENV.CW_NOW, exit: 1 });
    assert.equal(added, 1);
    assert.deepEqual(merged.runs[0].tool.driver.rules.map((r) => r.id), [PLANTED, 'new.rule']);
  });

  test('identical inputs produce identical receipts and SARIFs', () => {
    const run = () => {
      const fx = fixture();
      retrySemgrep({ sarifPath: fx.sarif, configArgs: [], cwd: fx.scan, env: ENV, spawn: fakeSemgrep().spawn });
      return readFileSync(fx.sarif, 'utf8') + readFileSync(join(fx.out, 'semgrep-retry.json'), 'utf8');
    };
    assert.equal(run(), run());
  });
});

describe('the reader\'s ledger, on documents built by hand', () => {
  const retryInv = (files, notifications = [], timeoutSec = 60, extra = {}) => ({ executionSuccessful: true, toolExecutionNotifications: notifications, properties: { commitworkRetry: { files, timeoutSec, timeoutThreshold: 0, bin: 'semgrep', at: ENV.CW_NOW, exit: 0, ...extra } } });
  const recordInv = (notifications) => ({ executionSuccessful: true, toolExecutionNotifications: notifications, properties: { commitworkFixpoint: { source: 'time.fixpoint_timeouts', json: 'semgrep.json', count: notifications.length, unattributed: 0 } } });

  test('both time-class reasons are retried', () => {
    assert.deepEqual(RETRIED_REASONS, ['timeout', 'fixpoint-timeout']);
  });

  test('a fixpoint timeout clears only on a retry whose fixpoints were measured', () => {
    const base = () => { const d = doc([]); d.runs[0].invocations.push(recordInv([fixpointNotice('a.js', 3)])); return d; };
    const cleared = base();
    cleared.runs[0].invocations.push(retryInv(['a.js'], [], 60, { fixpointMeasured: true }));
    assert.deepEqual(readSarif(write(cleared)).partialAnalysis, []);
    assert.deepEqual(readSarif(write(cleared)).partialRetry, { files: ['a.js'], timeoutSec: 60, recovered: ['a.js'], stillTimedOut: [] });
    const blind = base();
    blind.runs[0].invocations.push(retryInv(['a.js']));
    assert.deepEqual(readSarif(write(blind)).partialAnalysis, [{ uri: 'a.js', reasons: ['fixpoint-timeout'], notices: 1 }]);
    assert.deepEqual(readSarif(write(blind)).partialRetry, { files: ['a.js'], timeoutSec: 60, recovered: [], stillTimedOut: [], unmeasured: ['a.js'] });
    const recurred = base();
    recurred.runs[0].invocations.push(retryInv(['a.js'], [fixpointNotice('a.js', 3)], 60, { fixpointMeasured: true }));
    assert.deepEqual(readSarif(write(recurred)).partialRetry.stillTimedOut, ['a.js']);
  });

  test('either time-class reason in the retry keeps every time-class fact on that file', () => {
    const d = doc([timeout(RULE, 'a.js')]);
    d.runs[0].invocations.push(retryInv(['a.js'], [fixpointNotice('a.js', 9)], 60, { fixpointMeasured: true }));
    const r = readSarif(write(d));
    assert.deepEqual(r.partialAnalysis, [{ uri: 'a.js', reasons: ['timeout'], notices: 1 }], 'a retry-only reason adds no row');
    assert.deepEqual(r.partialRetry.stillTimedOut, ['a.js']);
  });

  test('an unmeasured retry still clears a SARIF timeout, and the fixpoint on the same file stands', () => {
    const d = doc([timeout(RULE, 'a.js')]);
    d.runs[0].invocations.push(recordInv([fixpointNotice('a.js', 3)]));
    d.runs[0].invocations.push(retryInv(['a.js']));
    const r = readSarif(write(d));
    assert.deepEqual(r.partialAnalysis, [{ uri: 'a.js', reasons: ['fixpoint-timeout'], notices: 1 }]);
    assert.deepEqual(r.partialRetry, { files: ['a.js'], timeoutSec: 60, recovered: [], stillTimedOut: [], unmeasured: ['a.js'] });
  });

  test('a fixpoint record is not a witness that the tool ran', () => {
    const d = { version: '2.1.0', runs: [{ tool: { driver: { name: 'Semgrep OSS', rules: [] } }, results: [], invocations: [recordInv([fixpointNotice('a.js', 3)])] }] };
    const r = readSarif(write(d));
    assert.equal(r.unwitnessedZero, true);
    assert.deepEqual(uris(r.partialAnalysis), ['a.js']);
  });
  const write = (d) => { const p = join(mkdtempSync(join(tmpdir(), 'cw-ledger-')), 's.sarif'); writeFileSync(p, JSON.stringify(d)); return p; };

  test('a file that times out again keeps its original notices; nothing is recovered', () => {
    const d = doc([timeout(RULE, 'a.js'), timeout(RULE2, 'a.js')]);
    d.runs[0].invocations.push(retryInv(['a.js'], [timeout(RULE2, 'a.js')]));
    const r = readSarif(write(d));
    assert.deepEqual(r.partialAnalysis, [{ uri: 'a.js', reasons: ['timeout'], notices: 2 }]);
    assert.deepEqual(r.partialRetry, { files: ['a.js'], timeoutSec: 60, recovered: [], stillTimedOut: ['a.js'] });
  });

  test('a recovered file loses its timeout and keeps its other reasons', () => {
    const d = doc([timeout(RULE, 'a.js'), syntax('a.js'), timeout(RULE, 'b.js')]);
    d.runs[0].invocations.push(retryInv(['a.js', 'b.js']));
    const r = readSarif(write(d));
    assert.deepEqual(r.partialAnalysis, [{ uri: 'a.js', reasons: ['syntax-error'], notices: 1 }], 'the retry re-measures time, not parsing');
    assert.deepEqual(r.partialRetry.recovered, ['a.js', 'b.js']);
  });

  test('without a retry invocation the ledger is null, and the sentence says nothing about one', () => {
    const r = readSarif(write(doc([timeout(RULE, 'a.js')])));
    assert.equal(r.partialRetry, null);
    assert.doesNotMatch(describePartial(r.partialAnalysis, r.partialRetry), /retry/);
    assert.match(describePartial(r.partialAnalysis, { files: ['a.js'], timeoutSec: 60, recovered: [], stillTimedOut: ['a.js'] }), /; a retry at 60s per rule covered 1 file\(s\) and recovered 0$/);
  });
});

describe('the command line', { skip: process.platform === 'win32' && 'the stub is an sh script' }, () => {
  test('a stub semgrep on PATH drives the whole step to a retried receipt, exit 0', () => {
    const fx = fixture();
    const bin = join(fx.dir, 'bin');
    mkdirSync(bin);
    const stubOut = join(fx.dir, 'stub.sarif');
    writeFileSync(stubOut, JSON.stringify(doc([], [result('a.js', 7, 'fp-new')])));
    // Copies the stub SARIF to whatever --output names; argv recorded so the test can read the targets.
    writeFileSync(join(bin, 'semgrep'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(fx.dir, 'argv')}"\nwhile [ $# -gt 0 ]; do if [ "$1" = "--output" ]; then cp "${stubOut}" "$2"; fi; shift; done\nexit 1\n`);
    chmodSync(join(bin, 'semgrep'), 0o755);
    const r = spawnSync(process.execPath, [join(CW, 'bin', 'semgrep-retry.mjs'), fx.sarif, '--log', join(fx.out, 'r.log'), '--', '--config', 'p/default'], {
      cwd: fx.scan, encoding: 'utf8', env: { ...ENV, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /retried 2 file\(s\) at 60s per rule: 2 recovered, 0 still timing out, 1 result\(s\) added, 1 not retried/);
    const argv = readFileSync(join(fx.dir, 'argv'), 'utf8').trim().split('\n');
    assert.deepEqual(argv.slice(-2), ['a.js', 'b.js']);
    assert.ok(argv.includes('p/default'));
    assert.deepEqual(uris(readSarif(fx.sarif).partialAnalysis), ['c.js'], 'only the missing c.js remains');
  });

  test('--json records the main scan\'s fixpoint timeouts and the retry clears them at -j 1', () => {
    const fx = fixture();
    const bin = join(fx.dir, 'bin');
    mkdirSync(bin);
    const stubOut = join(fx.dir, 'stub.sarif');
    const stubJson = join(fx.dir, 'stub.json');
    writeFileSync(stubOut, JSON.stringify(doc([], [result('a.js', 7, 'fp-new')])));
    writeFileSync(stubJson, JSON.stringify(scanJson([])));
    const mainJsonPath = join(fx.out, 'semgrep.json');
    writeFileSync(mainJsonPath, JSON.stringify(scanJson([fixpointEntry('a.js', 10)])));
    writeFileSync(join(bin, 'semgrep'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(fx.dir, 'argv')}"\nwhile [ $# -gt 0 ]; do if [ "$1" = "--output" ]; then cp "${stubOut}" "$2"; fi; if [ "$1" = "--json-output" ]; then cp "${stubJson}" "$2"; fi; shift; done\nexit 1\n`);
    chmodSync(join(bin, 'semgrep'), 0o755);
    const r = spawnSync(process.execPath, [join(CW, 'bin', 'semgrep-retry.mjs'), '--json', mainJsonPath, fx.sarif, '--', '--config', 'p/default'], {
      cwd: fx.scan, encoding: 'utf8', env: { ...ENV, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /retried 2 file\(s\) at 60s per rule: 2 recovered, 0 still timing out, 1 result\(s\) added, 1 not retried; 1 fixpoint timeout\(s\) recorded from semgrep\.json\n$/);
    const argv = readFileSync(join(fx.dir, 'argv'), 'utf8').trim().split('\n');
    assert.equal(argv[argv.indexOf('-j') + 1], '1');
    assert.deepEqual(uris(readSarif(fx.sarif).partialAnalysis), ['c.js']);
  });

  test('no SARIF path: usage, exit 2', () => {
    const r = spawnSync(process.execPath, [join(CW, 'bin', 'semgrep-retry.mjs')], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage/);
  });
});
