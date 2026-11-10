// GitHub Action outputs, annotations and output files from a SARIF file and exit codes (bin/lib/github-action.mjs report).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { report } from '../lib/github-action.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'report-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(args) {
  const logs = [];
  const r = report({ runExit: 0, exportExit: 0, failOn: 'none', failOnUnmeasured: false, env: {}, ...args, log: (m) => logs.push(m) });
  return { r, logs };
}

function writeSarif(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body));
  return p;
}

const unmeasuredSarif = (id) => ({ runs: [{ results: [], invocations: [{ toolExecutionNotifications: [{ descriptor: { id }, level: 'warning', message: { text: `${id} did not measure` } }] }] }] });
const levels = (...ls) => ({ runs: [{ results: ls.map((level) => ({ level })) }] });

test('An absent SARIF file and a failed export give empty outputs, failed true and two error annotations', () => withDir((dir) => {
  const { r, logs } = run({ sarifPath: join(dir, 'missing.sarif'), exportExit: 1 });
  assert.deepEqual(r, {
    sarif: { state: 'absent', why: 'ENOENT' },
    decision: { failed: true, reasons: ['commitwork sarif exited 1: the SARIF export failed', 'no SARIF to judge (absent: ENOENT)'], warnings: [] },
    outputs: { sarif: '', results: '', unmeasured: '', failed: 'true' },
  });
  assert.deepEqual(logs, ['::error::commitwork: commitwork sarif exited 1: the SARIF export failed', '::error::commitwork: no SARIF to judge (absent: ENOENT)']);
}));

test('A run exit of 1 with a valid empty SARIF sets failed to true and keeps the SARIF outputs', () => withDir((dir) => {
  const sarifPath = writeSarif(dir, 'ok.sarif', levels());
  const { r, logs } = run({ sarifPath, runExit: 1 });
  assert.deepEqual(r.outputs, { sarif: sarifPath, results: 0, unmeasured: 0, failed: 'true' });
  assert.deepEqual(logs, ['::error::commitwork: commitwork run exited 1: a lane failed to execute (its line in the run log names it)']);
}));

test('A clean run writes the four outputs with failed false to GITHUB_OUTPUT', () => withDir((dir) => {
  const sarifPath = writeSarif(dir, 'data.sarif', levels('note'));
  const outFile = join(dir, 'out.txt');
  const { r, logs } = run({ sarifPath, env: { GITHUB_OUTPUT: outFile } });
  assert.deepEqual(r.outputs, { sarif: sarifPath, results: 1, unmeasured: 0, failed: 'false' });
  assert.deepEqual(logs, []);
  assert.equal(readFileSync(outFile, 'utf8'), `sarif=${sarifPath}\nresults=1\nunmeasured=0\nfailed=false\n`);
}));

test('One error and one warning fail at fail-on error and the summary table lists them', () => withDir((dir) => {
  const sarifPath = writeSarif(dir, 'sum.sarif', levels('error', 'warning'));
  const sumFile = join(dir, 'sum.md');
  const { r, logs } = run({ sarifPath, failOn: 'error', env: { GITHUB_STEP_SUMMARY: sumFile } });
  assert.deepEqual(r.decision, { failed: true, reasons: ['1 result(s) at level error or above'], warnings: [] });
  assert.equal(r.outputs.failed, 'true');
  assert.deepEqual(logs, ['::error::commitwork: 1 result(s) at level error or above']);
  assert.equal(readFileSync(sumFile, 'utf8'), [
    '### commitwork', '', '| | |', '|---|---|',
    '| Results | 2 (1 error, 1 warning, 0 note) |',
    '| Lanes that did not measure | 0 |',
    '| Lanes with reduced coverage | 0 |',
    '| Undetermined, not counted as results | 0 |',
    '| `commitwork run` exit | 0 |', '',
    'The step fails (fail-on: error):', '',
    '- 1 result(s) at level error or above', '',
  ].join('\n'));
}));

test('At fail-on warning the error and the warning count but the note does not', () => withDir((dir) => {
  const sarifPath = writeSarif(dir, 'w.sarif', levels('error', 'warning', 'note'));
  const { r } = run({ sarifPath, failOn: 'warning' });
  assert.deepEqual(r.decision, { failed: true, reasons: ['2 result(s) at level warning or above'], warnings: [] });
  assert.deepEqual(r.outputs, { sarif: sarifPath, results: 3, unmeasured: 0, failed: 'true' });
}));

test('An unmeasured lane is a warning annotation and does not fail when failOnUnmeasured is false', () => withDir((dir) => {
  const sarifPath = writeSarif(dir, 'unm.sarif', unmeasuredSarif('lane1'));
  const sumFile = join(dir, 'sum.md');
  const { r, logs } = run({ sarifPath, env: { GITHUB_STEP_SUMMARY: sumFile } });
  assert.deepEqual(r.outputs, { sarif: sarifPath, results: 0, unmeasured: 1, failed: 'false' });
  assert.deepEqual(logs, ['::warning::commitwork: lane1 did not measure']);
  assert.equal(readFileSync(sumFile, 'utf8'), [
    '### commitwork', '', '| | |', '|---|---|',
    '| Results | 0 (0 error, 0 warning, 0 note) |',
    '| Lanes that did not measure | 1 |',
    '| Lanes with reduced coverage | 0 |',
    '| Undetermined, not counted as results | 0 |',
    '| `commitwork run` exit | 0 |', '',
    'Did not measure, so neither clean nor a finding:', '',
    '- lane1 did not measure', '',
    'The step does not fail (fail-on: none).', '',
  ].join('\n'));
}));

test('An unmeasured lane fails with an error annotation when failOnUnmeasured is true', () => withDir((dir) => {
  const sarifPath = writeSarif(dir, 'unm2.sarif', unmeasuredSarif('lane2'));
  const { r, logs } = run({ sarifPath, failOnUnmeasured: true });
  assert.deepEqual(r.outputs, { sarif: sarifPath, results: 0, unmeasured: 1, failed: 'true' });
  assert.deepEqual(logs, ['::error::commitwork: 1 lane(s) did not measure']);
}));

test('A SARIF without a results array is unreadable and writes empty outputs and the no-SARIF summary', () => withDir((dir) => {
  const sarifPath = writeSarif(dir, 'bad.sarif', { runs: [{}] });
  const outFile = join(dir, 'out.txt');
  const sumFile = join(dir, 'sum.md');
  const { r, logs } = run({ sarifPath, env: { GITHUB_OUTPUT: outFile, GITHUB_STEP_SUMMARY: sumFile } });
  assert.deepEqual(r.outputs, { sarif: '', results: '', unmeasured: '', failed: 'true' });
  assert.deepEqual(logs, ['::error::commitwork: no SARIF to judge (unreadable: runs[0].results is not an array)']);
  assert.equal(readFileSync(outFile, 'utf8'), 'sarif=\nresults=\nunmeasured=\nfailed=true\n');
  assert.equal(readFileSync(sumFile, 'utf8'), [
    '### commitwork', '',
    'No SARIF to report (unreadable). `commitwork run` exited 0.', '',
    'The step fails (fail-on: none):', '',
    '- no SARIF to judge (unreadable: runs[0].results is not an array)', '',
  ].join('\n'));
}));
