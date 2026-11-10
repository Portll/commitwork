// Appends a refusal to the bounded quarantine ledger and counts what it drops (monitor/ingest-external.mjs defaultQuarantineSink).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultQuarantineSink } from '../ingest-external.mjs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ids = (...names) => names.map((id) => ({ id }));
const readBack = (path) => JSON.parse(readFileSync(path, 'utf8'));

function withLedger(contents, run) {
  const dir = mkdtempSync(join(tmpdir(), 'defaultQuarantineSink-'));
  try {
    const path = join(dir, 'quarantine.json');
    writeFileSync(path, contents);
    run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertSink(start, entry, max, expected) {
  withLedger(JSON.stringify(start), (path) => {
    const r = defaultQuarantineSink(entry, { path, max });
    assert.deepEqual(r, expected);
    assert.deepEqual(readBack(path), expected);
  });
}

test('an entry that stays one under the limit is appended and the dropped count is kept', () => {
  assertSink(
    { note: 'n', version: 1, dropped: 7, entries: ids('a') },
    { id: 'b' },
    3,
    { note: 'n', version: 1, dropped: 7, entries: ids('a', 'b') },
  );
});

test('an entry that lands exactly on the limit trims nothing and adds no dropped field', () => {
  assertSink(
    { version: 1, entries: ids('a') },
    { id: 'b' },
    2,
    { version: 1, entries: ids('a', 'b') },
  );
});

test('one entry over the limit removes the oldest and counts one drop from zero', () => {
  assertSink(
    { note: 'n', version: 1, dropped: 0, entries: ids('a', 'b') },
    { id: 'c' },
    2,
    { note: 'n', version: 1, dropped: 1, entries: ids('b', 'c') },
  );
});

test('a new drop is added to the dropped count already in the ledger', () => {
  assertSink(
    { note: 'n', version: 1, dropped: 5, entries: ids('a', 'b', 'c') },
    { id: 'd' },
    3,
    { note: 'n', version: 1, dropped: 6, entries: ids('b', 'c', 'd') },
  );
});

test('a ledger with no dropped field starts counting at zero when it trims', () => {
  assertSink(
    { version: 1, entries: ids('a', 'b') },
    { id: 'c' },
    2,
    { version: 1, dropped: 1, entries: ids('b', 'c') },
  );
});

test('a ledger far over the limit loses all its oldest entries in one call', () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}` }));
  assertSink(
    { note: 'n', version: 1, dropped: 2, entries },
    { id: 'new' },
    2,
    { note: 'n', version: 1, dropped: 6, entries: ids('e4', 'new') },
  );
});

test('a limit of zero keeps no entries and counts the new one as dropped', () => {
  assertSink(
    { note: 'n', version: 1, dropped: 0, entries: [] },
    { id: 'a' },
    0,
    { note: 'n', version: 1, dropped: 1, entries: [] },
  );
});

test('a document whose entries is not an array is refused and left unchanged', () => {
  const contents = JSON.stringify({ version: 1, entries: 'none' });
  withLedger(contents, (path) => {
    assert.throws(() => defaultQuarantineSink({ id: 'a' }, { path, max: 2 }), {
      name: 'Error',
      message: `ingest quarantine at ${path} is not a quarantine document`,
    });
    assert.equal(readFileSync(path, 'utf8'), contents);
  });
});

test('a ledger that is not valid JSON is refused and left unchanged', () => {
  const contents = '{broken';
  let detail;
  try { JSON.parse(contents); } catch (e) { detail = e.message; }
  withLedger(contents, (path) => {
    assert.throws(() => defaultQuarantineSink({ id: 'a' }, { path, max: 2 }), {
      name: 'Error',
      message: `ingest quarantine at ${path} is not valid JSON (${detail}); refusing to treat it as empty`,
    });
    assert.equal(readFileSync(path, 'utf8'), contents);
  });
});
