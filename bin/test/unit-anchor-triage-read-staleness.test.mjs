// Reads and validates the anchor-staleness JSON report (bin/anchor-triage.mjs readStaleness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStaleness } from '../anchor-triage.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the parsed document when results is an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readStaleness-'));
  try {
    const p = join(dir, 'report.json');
    const doc = { results: [{ id: 1 }, { id: 2 }] };
    writeFileSync(p, JSON.stringify(doc));
    const out = readStaleness(p);
    assert.deepEqual(out, doc);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed document when results is an empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readStaleness-'));
  try {
    const p = join(dir, 'report.json');
    const doc = { results: [] };
    writeFileSync(p, JSON.stringify(doc));
    const out = readStaleness(p);
    assert.deepEqual(out, doc);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws a specific error when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readStaleness-'));
  try {
    const p = join(dir, 'missing.json');
    assert.throws(() => readStaleness(p), /no anchor-staleness report at .* \u2014 run bin\/anchor-staleness\.mjs first/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an unreadable error when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readStaleness-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not valid json');
    assert.throws(() => readStaleness(p), /anchor-staleness report at .* is unreadable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws a wrong shape error when results is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readStaleness-'));
  try {
    const p = join(dir, 'no-results.json');
    writeFileSync(p, JSON.stringify({ foo: 'bar' }));
    assert.throws(() => readStaleness(p), /has no results\[\] \u2014 wrong shape, not an empty queue/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws a wrong shape error when results is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readStaleness-'));
  try {
    const p = join(dir, 'obj-results.json');
    writeFileSync(p, JSON.stringify({ results: { a: 1 } }));
    assert.throws(() => readStaleness(p), /has no results\[\] \u2014 wrong shape, not an empty queue/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws a wrong shape error when the document is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readStaleness-'));
  try {
    const p = join(dir, 'null.json');
    writeFileSync(p, 'null');
    assert.throws(() => readStaleness(p), /has no results\[\] \u2014 wrong shape, not an empty queue/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws a wrong shape error when the document is a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readStaleness-'));
  try {
    const p = join(dir, 'str.json');
    writeFileSync(p, '"hello"');
    assert.throws(() => readStaleness(p), /has no results\[\] \u2014 wrong shape, not an empty queue/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
