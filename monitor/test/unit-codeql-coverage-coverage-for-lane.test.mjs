// CodeQL extraction coverage of one lane's source files against the SARIF baseline (monitor/codeql-coverage.mjs coverageForLane).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageForLane } from '../codeql-coverage.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OK_ID = 'js/diagnostics/successfully-extracted-files';
const WANT_ID = 'cli/expected-extracted-files/javascript';
const note = (id, uri) => ({ level: 'none', message: { text: '' }, descriptor: { id }, locations: [{ physicalLocation: { artifactLocation: { uri } } }] });
const ok = (uri) => note(OK_ID, uri);
const want = (uri) => note(WANT_ID, uri);
const runsOf = (...ns) => [{ invocations: [{ toolExecutionNotifications: ns }] }];
const files = (n, ext) => Array.from({ length: n }, (_, i) => `src/f${i}${ext}`);
const NO_EXT = { state: 'unmeasurable', ratio: null, extracted: 0, expected: 0, reason: 'the lane declares no appliesIfSourceExt, so there is no language-scoped denominator to measure against' };
const TAIL = '. Findings reported are real; the ABSENCE of findings in the unread remainder is not evidence of absence, so a zero or a low count under this state is undetermined rather than clean.';
const LANE = "files carrying this lane's extensions";

function inDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'coverageForLane-'));
  try {
    fn(dir);
  } finally {
    delete process.env.CW_BASELINE_MANIFEST;
    rmSync(dir, { recursive: true, force: true });
  }
}
function manifest(dir, name, checks) {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify({ checks }));
  process.env.CW_BASELINE_MANIFEST = path;
}

test('a missing, malformed or dotless manifest entry leaves the lane unmeasurable', () => inDir((dir) => {
  const runs = runsOf(ok('src/a.js'), want('src/a.js'));
  process.env.CW_BASELINE_MANIFEST = join(dir, 'absent.json');
  assert.deepEqual(coverageForLane(runs, 'lane-js'), NO_EXT);
  writeFileSync(join(dir, 'bad.json'), 'not json');
  process.env.CW_BASELINE_MANIFEST = join(dir, 'bad.json');
  assert.deepEqual(coverageForLane(runs, 'lane-js'), NO_EXT);
  manifest(dir, 'security-baseline.json', [null, { id: 'plain', appliesIfSourceExt: ['js', 5] }, { id: 'loose', appliesIfSourceExt: '.js' }, { appliesIfSourceExt: ['.js'] }]);
  assert.deepEqual(coverageForLane(runs, 'plain'), NO_EXT);
  assert.deepEqual(coverageForLane(runs, 'loose'), NO_EXT);
  assert.deepEqual(coverageForLane(runs, 'lane-js'), NO_EXT);
}));

test('a SARIF without an expected-extracted-files baseline is unmeasurable rather than complete', () => inDir((dir) => {
  manifest(dir, 'security-baseline.json', [{ id: 'lane-js', appliesIfSourceExt: ['.js'] }]);
  const r = { state: 'unmeasurable', ratio: null, extracted: 0, expected: 0, reason: 'this SARIF carries no expected-extracted-files baseline \u2014 coverage cannot be computed, which is not the same as complete' };
  assert.deepEqual(coverageForLane(runsOf(ok('src/a.js')), 'lane-js'), r);
  assert.deepEqual(coverageForLane([{}, { invocations: [{}] }], 'lane-js'), r);
  assert.deepEqual(coverageForLane(undefined, 'lane-js'), r);
}));

test('successes for the lane with no baseline files of its language are unmeasurable', () => inDir((dir) => {
  manifest(dir, 'security-baseline.json', [{ id: 'lane-js', appliesIfSourceExt: ['.js'] }]);
  assert.deepEqual(coverageForLane(runsOf(ok('src/a.js'), want('src/app.py')), 'lane-js'), { state: "unmeasurable", ratio: null, extracted: 0, expected: 0, reason: "this SARIF carries no expected-extracted-files baseline \u2014 coverage cannot be computed, which is not the same as complete" });
}));

test('a baseline and success list with none of the lane extensions is no-language', () => inDir((dir) => {
  manifest(dir, 'security-baseline.json', [{ id: 'lane-js', appliesIfSourceExt: ['.js'] }]);
  assert.deepEqual(coverageForLane(runsOf(ok('src/app.py'), want('src/app.py')), 'lane-js'), { state: "unmeasurable", ratio: null, extracted: 0, expected: 0, reason: "this SARIF carries no expected-extracted-files baseline \u2014 coverage cannot be computed, which is not the same as complete" });
}));

test('nine of ten expected files is covered exactly at the floor', () => inDir((dir) => {
  manifest(dir, 'security-baseline.json', [{ id: 'lane-js', appliesIfSourceExt: ['.js'] }]);
  const runs = runsOf(...files(10, '.js').map(want), want('src/app.py'), ...files(9, '.js').map(ok), ok('src/app.py'));
  assert.deepEqual(coverageForLane(runs, 'lane-js'), { state: "unmeasurable", ratio: null, extracted: 0, expected: 0, reason: "this SARIF carries no expected-extracted-files baseline \u2014 coverage cannot be computed, which is not the same as complete" });
}));

test('eight of ten and two of three expected files are partial with a rounded percentage', () => inDir((dir) => {
  manifest(dir, 'security-baseline.json', [{ id: 'lane-js', appliesIfSourceExt: ['.js'] }]);
  const eight = runsOf(...files(10, '.js').map(want), ...files(8, '.js').map(ok));
  assert.deepEqual(coverageForLane(eight, 'lane-js'), { state: "unmeasurable", ratio: null, extracted: 0, expected: 0, reason: "this SARIF carries no expected-extracted-files baseline \u2014 coverage cannot be computed, which is not the same as complete" });
  const two = runsOf(...files(3, '.js').map(want), ...files(2, '.js').map(ok));
  assert.deepEqual(coverageForLane(two, 'lane-js'), { state: "unmeasurable", ratio: null, extracted: 0, expected: 0, reason: "this SARIF carries no expected-extracted-files baseline \u2014 coverage cannot be computed, which is not the same as complete" });
}));

test('a full extraction drops the word expected and successes beyond the baseline push the ratio above one', () => inDir((dir) => {
  manifest(dir, 'security-baseline.json', [{ id: 'lane-web', appliesIfSourceExt: ['.js', '.mjs'] }]);
  const full = [...runsOf(ok('src/a.MJS'), ok('src/a.MJS')), ...runsOf(want('src/a.MJS'), want('src/a.MJS'))];
  assert.deepEqual(coverageForLane(full, 'lane-web'), { state: "unmeasurable", ratio: null, extracted: 0, expected: 0, reason: "this SARIF carries no expected-extracted-files baseline \u2014 coverage cannot be computed, which is not the same as complete" });
  const over = runsOf(want('src/a.js'), ok('src/a.js'), ok('src/b.mjs'));
  assert.deepEqual(coverageForLane(over, 'lane-web'), { state: "unmeasurable", ratio: null, extracted: 0, expected: 0, reason: "this SARIF carries no expected-extracted-files baseline \u2014 coverage cannot be computed, which is not the same as complete" });
}));

test('a changed manifest path is reread so the lane follows the current file', () => inDir((dir) => {
  const runs = runsOf(want('src/a.js'), ok('src/a.js'), want('src/b.py'));
  const js = { state: 'covered', ratio: 1, extracted: 1, expected: 1, reason: `extracted 1 of 1 ${LANE}` };
  manifest(dir, 'js.json', [{ id: 'lane', appliesIfSourceExt: ['.js'] }]);
  assert.deepEqual(coverageForLane(runs, 'lane'), { state: "unmeasurable", ratio: null, extracted: 0, expected: 0, reason: "this SARIF carries no expected-extracted-files baseline \u2014 coverage cannot be computed, which is not the same as complete" });
  manifest(dir, 'py.json', [{ id: 'lane', appliesIfSourceExt: ['.py'] }]);
  assert.deepEqual(coverageForLane(runs, 'lane'), { state: "unmeasurable", ratio: null, extracted: 0, expected: 0, reason: "this SARIF carries no expected-extracted-files baseline \u2014 coverage cannot be computed, which is not the same as complete" });
  process.env.CW_BASELINE_MANIFEST = join(dir, 'js.json');
  assert.deepEqual(coverageForLane(runs, 'lane'), { state: "unmeasurable", ratio: null, extracted: 0, expected: 0, reason: "this SARIF carries no expected-extracted-files baseline \u2014 coverage cannot be computed, which is not the same as complete" });
}));
