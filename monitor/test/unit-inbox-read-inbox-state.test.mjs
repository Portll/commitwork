// Loads and validates the per-operator inbox state document (monitor/inbox.mjs readInboxState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readInboxState } from '../inbox.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCHEMA = 'commitwork.inbox-state/1';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'readInboxState-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertWrongShape(dir, text) {
  const p = join(dir, 'inbox-state.json');
  writeFileSync(p, text);
  assert.throws(() => readInboxState(p), { name: 'Error', message: `inbox state at ${p} is not ${SCHEMA}` });
}

test('a missing file reads as the empty state', () => {
  withDir((dir) => {
    assert.deepEqual(readInboxState(join(dir, 'absent.json')), { schema: SCHEMA, entries: {} });
  });
});

test('a directory at the path throws the unreadable error naming the error code', () => {
  withDir((dir) => {
    const p = join(dir, 'state-dir');
    mkdirSync(p);
    assert.throws(() => readInboxState(p), { name: 'Error', message: `inbox state unreadable at ${p}: EISDIR` });
  });
});

test('valid documents come back as parsed, with extra fields and with empty entries', () => {
  withDir((dir) => {
    const full = join(dir, 'full.json');
    writeFileSync(full, JSON.stringify({ schema: SCHEMA, entries: { 'item-1': { seen: true } }, note: 'kept' }));
    assert.deepEqual(readInboxState(full), { schema: SCHEMA, entries: { 'item-1': { seen: true } }, note: 'kept' });
    const empty = join(dir, 'empty-entries.json');
    writeFileSync(empty, JSON.stringify({ schema: SCHEMA, entries: {} }));
    assert.deepEqual(readInboxState(empty), { schema: SCHEMA, entries: {} });
  });
});

test('an empty file throws the not JSON error with the parser message', () => {
  withDir((dir) => {
    const p = join(dir, 'blank.json');
    writeFileSync(p, '');
    assert.throws(() => readInboxState(p), { name: 'Error', message: `inbox state at ${p} is not JSON: Unexpected end of JSON input` });
  });
});

test('a JSON null document throws the schema error', () => {
  withDir((dir) => {
    assertWrongShape(dir, 'null');
  });
});

test('a different or absent schema throws the schema error even with valid entries', () => {
  withDir((dir) => {
    assertWrongShape(dir, JSON.stringify({ schema: 'commitwork.inbox-state/2', entries: {} }));
    assertWrongShape(dir, JSON.stringify({ entries: { a: 1 } }));
  });
});

test('null or missing entries throw the schema error', () => {
  withDir((dir) => {
    assertWrongShape(dir, JSON.stringify({ schema: SCHEMA, entries: null }));
    assertWrongShape(dir, JSON.stringify({ schema: SCHEMA }));
  });
});

test('array entries throw the schema error whether empty or filled', () => {
  withDir((dir) => {
    assertWrongShape(dir, JSON.stringify({ schema: SCHEMA, entries: [] }));
    assertWrongShape(dir, JSON.stringify({ schema: SCHEMA, entries: [1, 2] }));
  });
});

test('truthy entries that are not objects throw the schema error', () => {
  withDir((dir) => {
    assertWrongShape(dir, JSON.stringify({ schema: SCHEMA, entries: 'x' }));
    assertWrongShape(dir, JSON.stringify({ schema: SCHEMA, entries: 5 }));
  });
});

test('with no path argument it reads the file named by CW_INBOX_STATE', () => {
  withDir((dir) => {
    const p = join(dir, 'from-env.json');
    writeFileSync(p, JSON.stringify({ schema: SCHEMA, entries: { env: 1 } }));
    const saved = process.env.CW_INBOX_STATE;
    process.env.CW_INBOX_STATE = p;
    try {
      assert.deepEqual(readInboxState(), { schema: SCHEMA, entries: { env: 1 } });
    } finally {
      if (saved === undefined) delete process.env.CW_INBOX_STATE;
      else process.env.CW_INBOX_STATE = saved;
    }
  });
});
