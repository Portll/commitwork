// Parsed approval-queue JSONL entries with an ok flag and error text (lib/security-posture.mjs readRefusals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRefusals } from '../security-posture.mjs';
import { approvalQueuePath } from '../security-posture.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const AS_DIR = Symbol('directory');
const path = approvalQueuePath();

function runWithQueue(setup) {
  const dir = mkdtempSync(join(tmpdir(), 'readRefusals-'));
  try {
    const backup = join(dir, 'backup.jsonl');
    const had = existsSync(path);
    if (had) {
      copyFileSync(path, backup);
      rmSync(path);
    }
    const created = mkdirSync(dirname(path), { recursive: true });
    try {
      if (setup === AS_DIR) mkdirSync(path);
      else if (setup !== null) writeFileSync(path, setup);
      return readRefusals();
    } finally {
      rmSync(path, { recursive: true, force: true });
      if (had) copyFileSync(backup, path);
      if (created) rmSync(created, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a missing queue file reads as ok with no entries', () => {
  assert.deepEqual(runWithQueue(null), { ok: true, path, entries: [], error: null });
});

test('a directory at the queue path reports the EISDIR read error', () => {
  assert.deepEqual(runWithQueue(AS_DIR), { ok: false, path, entries: [], error: `EISDIR reading ${path}` });
});

test('an empty queue file reads as ok with no entries', () => {
  assert.deepEqual(runWithQueue(''), { ok: true, path, entries: [], error: null });
});

test('every JSON line of a newline-terminated file becomes an entry in order', () => {
  const values = [{ a: 1 }, { b: [2, 3] }, 'four'];
  const content = values.map((v) => JSON.stringify(v)).join('\n') + '\n';
  assert.deepEqual(runWithQueue(content), {
    ok: true,
    path,
    entries: [{ a: 1 }, { b: [2, 3] }, 'four'],
    error: null,
  });
});

test('blank and whitespace-only lines are skipped and a final line without newline is parsed', () => {
  assert.deepEqual(runWithQueue('{"x":1}\n   \n\n{"y":2}'), {
    ok: true,
    path,
    entries: [{ x: 1 }, { y: 2 }],
    error: null,
  });
});

test('an invalid first line fails as line 1 with no entries', () => {
  assert.deepEqual(runWithQueue('oops\n{"a":1}\n'), {
    ok: false,
    path,
    entries: [],
    error: `line 1 of ${path} is not JSON`,
  });
});

test('an invalid second line fails as line 2 keeping the entries parsed before it', () => {
  assert.deepEqual(runWithQueue('{"a":1}\nnot-json\n{"c":3}\n'), {
    ok: false,
    path,
    entries: [{ a: 1 }],
    error: `line 2 of ${path} is not JSON`,
  });
});

test('line numbers in the parse error count the skipped blank lines', () => {
  assert.deepEqual(runWithQueue('\n\n{bad'), {
    ok: false,
    path,
    entries: [],
    error: `line 3 of ${path} is not JSON`,
  });
});
