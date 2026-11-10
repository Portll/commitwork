// Verdict read from a guard report and its exit sidecar (monitor/jackson-guard-read.mjs readJacksonGuard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJacksonGuard } from '../jackson-guard-read.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PRE = 'guard-jackson-caseinsensitive: ';
const DASH = ' \u2014 ';
const OK = `${PRE}OK${DASH}not enabled in 42 scanned files`;
const SKIPPED = `${PRE}SKIPPED${DASH}no jackson dependency`;
const UNREAD = `${PRE}UNREADABLE${DASH}2 path(s) unreadable (7 file(s) scanned)`;
const NOT_RUN = `${PRE}NOT RUN${DASH}root unreadable`;
const FAILED = `GUARD FAILED${DASH}the toggle is enabled`;
const unrecognised = (exit, why) => ({ state: 'unrecognised', exit, why });

function inDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'readJacksonGuard-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function verdict(report, exit) {
  return inDir((dir) => {
    const path = join(dir, 'report.txt');
    writeFileSync(path, report);
    writeFileSync(`${path}.exit`, exit);
    return readJacksonGuard(path);
  });
}

test('a missing report is absent and a directory in its place is unreadable by error code', () => {
  inDir((dir) => {
    assert.deepEqual(readJacksonGuard(join(dir, 'report.txt')), { state: 'absent' });
    assert.deepEqual(readJacksonGuard(dir), {
      state: 'artifact-unreadable',
      why: 'the report could not be read (EISDIR)',
    });
  });
});

test('a report holding nothing or only whitespace is empty even beside an exit code', () => {
  const empty = { state: 'empty', why: 'the guard wrote nothing, so there is no verdict to read' };
  assert.deepEqual(verdict('', '0'), empty);
  assert.deepEqual(verdict('  \n\t\n', '0'), empty);
});

test('an exit sidecar that is missing, a directory or not all digits reads as no-exit', () => {
  inDir((dir) => {
    const path = join(dir, 'report.txt');
    writeFileSync(path, OK);
    assert.deepEqual(readJacksonGuard(path), {
      state: 'no-exit',
      why: 'no exit code was recorded beside the report, so nothing witnessed the verdict',
    });
    mkdirSync(`${path}.exit`);
    assert.deepEqual(readJacksonGuard(path), {
      state: 'no-exit',
      why: 'the exit sidecar could not be read (EISDIR)',
    });
  });
  const holds = (quoted) => ({ state: 'no-exit', why: `the exit sidecar holds ${quoted}, not an exit code` });
  assert.deepEqual(verdict(OK, 'abc'), holds('"abc"'));
  assert.deepEqual(verdict(OK, '-1'), holds('"-1"'));
  assert.deepEqual(verdict(OK, ''), holds('""'));
  assert.deepEqual(verdict(OK, 'x'.repeat(21)), holds(`"${'x'.repeat(20)}"`));
});

test('exit 0 with an OK line is ok only when it counts at least one scanned file', () => {
  assert.deepEqual(verdict(OK, '0\n'), { state: 'ok', exit: 0, scanned: 42 });
  assert.deepEqual(verdict(`${PRE}OK${DASH}not enabled in 1 scanned file`, '0'), { state: 'ok', exit: 0, scanned: 1 });
  const none = unrecognised(0, 'the OK line names no scanned file');
  assert.deepEqual(verdict(`${PRE}OK${DASH}not enabled in 0 scanned files`, '0'), none);
  assert.deepEqual(verdict(`${PRE}OK${DASH}all clear`, '0'), none);
});

test('exit 0 is skipped with a lone SKIPPED line and unrecognised with both heads or neither', () => {
  assert.deepEqual(verdict(SKIPPED, '0'), { state: 'skipped', exit: 0 });
  const neither = unrecognised(0, 'the guard exited 0 with no OK or SKIPPED line');
  assert.deepEqual(verdict(`${OK}\n${SKIPPED}`, '0'), neither);
  assert.deepEqual(verdict('nothing the guard would say', '0'), neither);
});

test('exit 0 beside a failed, unreadable or not-run line is unrecognised', () => {
  const beside = unrecognised(0, 'the guard exited 0 beside a failure line');
  assert.deepEqual(verdict(FAILED, '0'), beside);
  assert.deepEqual(verdict(`${FAILED}\n  src/a.js:1: bad\n${OK}`, '0'), beside);
  assert.deepEqual(verdict(UNREAD, '0'), beside);
  assert.deepEqual(verdict(`${UNREAD}\n${OK}`, '0'), beside);
  assert.deepEqual(verdict(NOT_RUN, '0'), beside);
  assert.deepEqual(verdict(`${NOT_RUN}\n${SKIPPED}`, '0'), beside);
});

test('exit 1 with a GUARD FAILED line lists its hits and unreadable paths in sorted order', () => {
  assert.deepEqual(verdict(`${FAILED}\n  src/a.js:1: bad`, '1'), {
    state: 'violation',
    exit: 1,
    violations: [{ file: 'src/a.js', line: 1 }],
    unreadable: [],
  });
  const report = [
    FAILED,
    '  src/b.js:20: worse',
    '  src/a.js:10: bad',
    '  src/a.js:9: first',
    'an unrelated line',
    UNREAD,
    '  z/p: EACCES',
    '  b/q: EPERM',
  ].join('\n');
  assert.deepEqual(verdict(report, '1'), {
    state: 'violation',
    exit: 1,
    violations: [
      { file: 'src/a.js', line: 9 },
      { file: 'src/a.js', line: 10 },
      { file: 'src/b.js', line: 20 },
    ],
    unreadable: [
      { path: 'b/q', code: 'EPERM' },
      { path: 'z/p', code: 'EACCES' },
    ],
  });
});

test('exit 1 without a GUARD FAILED line naming a path and line is unrecognised', () => {
  const crash = unrecognised(1, 'the guard exited 1 without a GUARD FAILED line naming a path:line; a crash exits 1 as well');
  assert.deepEqual(verdict(OK, '1'), crash);
  assert.deepEqual(verdict(FAILED, '1'), crash);
  assert.deepEqual(verdict('  src/a.js:1: loose', '1'), crash);
  assert.deepEqual(verdict(`${FAILED}\n${OK}\n  src/a.js:1: bad`, '1'), crash);
});

test('exit 2 reads as not-run or as unreadable paths with their scanned count', () => {
  const notRun = { state: 'not-run', exit: 2, why: 'the guard could not read its root, so nothing was scanned' };
  assert.deepEqual(verdict(NOT_RUN, '2'), notRun);
  assert.deepEqual(verdict(`${NOT_RUN}\n${UNREAD}\n  a/b: EIO`, '2'), notRun);
  assert.deepEqual(verdict(`${UNREAD}\n  z/p: EACCES\n  b/q: EPERM`, '2'), {
    state: 'unreadable-paths',
    exit: 2,
    unreadable: [
      { path: 'b/q', code: 'EPERM' },
      { path: 'z/p', code: 'EACCES' },
    ],
    scanned: 7,
    why: '2 path(s) could not be read, and any of them may enable the toggle',
  });
  assert.deepEqual(verdict(`${PRE}UNREADABLE${DASH}no count given\n  a/b: EIO`, '2'), {
    state: 'unreadable-paths',
    exit: 2,
    unreadable: [{ path: 'a/b', code: 'EIO' }],
    scanned: null,
    why: '1 path(s) could not be read, and any of them may enable the toggle',
  });
});

test('exit 2 without usable lines, exit 2 after a failure and any higher exit are unrecognised', () => {
  const neither = unrecognised(2, 'the guard exited 2 with neither an UNREADABLE nor a NOT RUN line');
  assert.deepEqual(verdict(OK, '2'), neither);
  assert.deepEqual(verdict(UNREAD, '2'), neither);
  assert.deepEqual(verdict(`${FAILED}\n${NOT_RUN}`, '2'), unrecognised(2, 'the guard exited 2'));
  assert.deepEqual(verdict(`${FAILED}\n  src/a.js:1: bad`, '2'), unrecognised(2, 'the guard exited 2'));
  assert.deepEqual(verdict(OK, '3'), unrecognised(3, 'the guard exited 3'));
});
