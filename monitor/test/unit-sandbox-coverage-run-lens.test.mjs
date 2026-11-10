// Grades the newest sweep's lanes by isolation and repo-code execution into a coverage state (monitor/sandbox-coverage.mjs runLens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLens } from '../sandbox-coverage.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const ENV = 'CW_SANDBOX_COVERAGE_MANIFESTS';
const withTmp = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'runLens-'));
  const prev = process.env[ENV];
  try { fn(dir); } finally {
    if (prev === undefined) delete process.env[ENV]; else process.env[ENV] = prev;
    rmSync(dir, { recursive: true, force: true });
  }
};
const put = (file, data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
};
const flagsOf = (entries, declared, files, dir) => ({ byCheck: new Map(entries), declared, files, unreadable: [], dir });
const NO_ROWS = 'no lane rows could be read from this batch';

test('a reports root that is a file is reported as not permitted with its error code', () => withTmp((dir) => {
  const file = join(dir, 'root.txt');
  put(file, 'x');
  const result = runLens({ root: file });
  assert.deepEqual(result, { at: result.at, root: file, unknown: true, unknownReason: 'not-permitted', unknownDetail: 'reports root unreadable: ENOTDIR', state: 'unknown' });
}));

test('a root holding no sweep directory is reported as having no sweep batch', () => withTmp((dir) => {
  put(join(dir, 'sweep-file'), 'not a directory');
  mkdirSync(join(dir, 'other'));
  const result = runLens({ root: dir });
  assert.deepEqual(result, { at: result.at, root: dir, unknown: true, unknownReason: 'absent', unknownDetail: 'no sweep batch under the reports root', state: 'unknown' });
}));

test('the newest sweep batch with no status file is reported as unmeasured', () => withTmp((dir) => {
  put(join(dir, 'sweep-001', 'checks-status.json'), [{ check: 'c1', isolation: 'sandbox' }]);
  mkdirSync(join(dir, 'sweep-002', 'repoA'), { recursive: true });
  put(join(dir, 'sweep-002', 'notes.txt'), 'n');
  const result = runLens({ root: dir, flags: flagsOf([['c1', false]], 1, 1, join(dir, 'm')) });
  assert.deepEqual(result, { at: result.at, root: dir, sweep: join(dir, 'sweep-002'), unknown: true, unknownReason: 'absent', unknownDetail: 'the batch holds no checks-status.json \u2014 this sweep is unmeasured, not clean', state: 'unknown' });
}));

test('an explicit batch whose only status file is not JSON is reported unparseable', () => withTmp((dir) => {
  const batch = join(dir, 'batch');
  put(join(batch, 'checks-status.json'), 'not json');
  const result = runLens({ root: dir, sweepDir: batch });
  assert.deepEqual(result, { at: result.at, root: dir, sweep: batch, files: 1, unreadable: [{ file: join(batch, 'checks-status.json'), why: 'unparseable' }], unknown: true, unknownReason: 'unparseable', unknownDetail: NO_ROWS, state: 'unknown' });
}));

test('status files that parse but hold no row with a string check are reported empty', () => withTmp((dir) => {
  const sweep = join(dir, 'sweep-001');
  put(join(sweep, 'checks-status.json'), { checks: [{ isolation: 'sandbox' }] });
  put(join(sweep, 'repoA', 'checks-status.json'), 'null');
  const result = runLens({ root: dir, flags: flagsOf([], 0, 0, join(dir, 'm')) });
  assert.deepEqual(result, { at: result.at, root: dir, sweep, files: 2, unreadable: [], unknown: true, unknownReason: 'empty', unknownDetail: NO_ROWS, state: 'unknown' });
}));

test('lanes that are all isolated and declared in the manifests directory are ok', () => withTmp((dir) => {
  const manifests = join(dir, 'manifests');
  put(join(manifests, 'm.json'), { checks: [{ id: 'lint', executesRepoCode: false }, { id: 'build', executesRepoCode: true }] });
  put(join(manifests, 'readme.txt'), 'skip');
  const sweep = join(dir, 'sweep-001');
  put(join(sweep, 'repoA', 'checks-status.json'), [{ check: 'lint', isolation: 'sandbox', isolationReason: 'r' }, { check: 'build', isolation: 'container' }]);
  process.env[ENV] = manifests;
  const result = runLens({ root: dir });
  assert.deepEqual(result, {
    at: result.at, root: dir, sweep, statusFiles: 1, unreadable: [],
    manifests: { dir: manifests, files: 1, declaredRepoCode: 2, unreadable: [] },
    lanes: 2, byIsolation: { container: 1, sandbox: 1 }, matrix: { 'container/repo-code': 1, 'sandbox/no-repo-code': 1 },
    unconfined: [], unconfinedReasons: {}, repoCodeUnknown: 0, isolationUnrecorded: 0, repoCodeDeclared: 2, state: 'ok',
  });
}));

test('repo-code lanes running with no isolation are findings listed with their reasons', () => withTmp((dir) => {
  const sweep = join(dir, 'sweep-001');
  put(join(sweep, 'checks-status.json'), { lane1: { check: 'test', isolation: 'none' }, note: 'skip' });
  put(join(sweep, 'repoB', 'checks-status.json'), { checks: [{ check: 'test', isolation: 'none', isolationReason: 'needs docker' }, { check: 'fmt', isolation: 'none' }] });
  const result = runLens({ root: dir, flags: flagsOf([['test', true], ['fmt', false]], 2, 1, join(dir, 'm')) });
  assert.deepEqual(result, {
    at: result.at, root: dir, sweep, statusFiles: 2, unreadable: [],
    manifests: { dir: join(dir, 'm'), files: 1, declaredRepoCode: 2, unreadable: [] },
    lanes: 3, byIsolation: { none: 3 }, matrix: { 'none/no-repo-code': 1, 'none/repo-code': 2 },
    unconfined: [{ repo: null, check: 'test', isolationReason: null }, { repo: 'repoB', check: 'test', isolationReason: 'needs docker' }],
    unconfinedReasons: { '(no reason recorded)': 1, 'needs docker': 1 },
    repoCodeUnknown: 0, isolationUnrecorded: 0, repoCodeDeclared: 2, state: 'findings',
  });
}));

test('a lane with an empty isolation is counted unrecorded and the state is partial', () => withTmp((dir) => {
  const sweep = join(dir, 'sweep-001');
  put(join(sweep, 'checks-status.json'), [{ check: 'c1', isolation: '' }]);
  const result = runLens({ root: dir, flags: flagsOf([['c1', false]], 1, 1, join(dir, 'm')) });
  assert.deepEqual(result, {
    at: result.at, root: dir, sweep, statusFiles: 1, unreadable: [],
    manifests: { dir: join(dir, 'm'), files: 1, declaredRepoCode: 1, unreadable: [] },
    lanes: 1, byIsolation: { unrecorded: 1 }, matrix: { 'unrecorded/no-repo-code': 1 },
    unconfined: [], unconfinedReasons: {}, repoCodeUnknown: 0, isolationUnrecorded: 1, repoCodeDeclared: 1, state: 'partial',
  });
}));

test('with zero declarations an unisolated lane has unknown repo code and the state is partial', () => withTmp((dir) => {
  const sweep = join(dir, 'sweep-001');
  put(join(sweep, 'checks-status.json'), [{ check: 'c1', isolation: 'none' }]);
  const result = runLens({ root: dir, flags: flagsOf([['c1', true]], 0, 0, join(dir, 'm')) });
  assert.deepEqual(result, {
    at: result.at, root: dir, sweep, statusFiles: 1, unreadable: [],
    manifests: { dir: join(dir, 'm'), files: 0, declaredRepoCode: 0, unreadable: [] },
    lanes: 1, byIsolation: { none: 1 }, matrix: { 'none/repo-code-unknown': 1 },
    unconfined: [], unconfinedReasons: {}, repoCodeUnknown: 1, isolationUnrecorded: 0, repoCodeDeclared: 0, state: 'partial',
  });
}));

test('one unparseable status file beside readable rows makes the state partial', () => withTmp((dir) => {
  const sweep = join(dir, 'sweep-001');
  put(join(sweep, 'checks-status.json'), [{ check: 'c1', isolation: 'sandbox' }]);
  put(join(sweep, 'repoA', 'checks-status.json'), 'not json');
  const result = runLens({ root: dir, flags: flagsOf([['c1', false]], 1, 1, join(dir, 'm')) });
  assert.deepEqual(result, {
    at: result.at, root: dir, sweep, statusFiles: 2,
    unreadable: [{ file: join(sweep, 'repoA', 'checks-status.json'), why: 'unparseable' }],
    manifests: { dir: join(dir, 'm'), files: 1, declaredRepoCode: 1, unreadable: [] },
    lanes: 1, byIsolation: { sandbox: 1 }, matrix: { 'sandbox/no-repo-code': 1 },
    unconfined: [], unconfinedReasons: {}, repoCodeUnknown: 0, isolationUnrecorded: 0, repoCodeDeclared: 1, state: 'partial',
  });
}));
