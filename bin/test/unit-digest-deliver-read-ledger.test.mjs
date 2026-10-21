// Reads and validates the delivery ledger JSON document (bin/digest-deliver.mjs readLedger).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLedger } from '../digest-deliver.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty ledger object when file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const path = join(dir, 'ledger.json');
    const result = readLedger(path);
    assert.deepEqual(result, { schema: 'commitwork.digest-deliveries/1', deliveries: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when file exists but is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const path = join(dir, 'ledger.json');
    writeFileSync(path, 'not json');
    assert.throws(() => readLedger(path), (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, `delivery ledger at ${path} is not JSON; refusing rather than re-posting`);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when schema field does not match expected value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const path = join(dir, 'ledger.json');
    writeFileSync(path, JSON.stringify({ schema: 'wrong-schema', deliveries: {} }));
    assert.throws(() => readLedger(path), (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, `delivery ledger at ${path} is not commitwork.digest-deliveries/1`);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when deliveries field is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const path = join(dir, 'ledger.json');
    writeFileSync(path, JSON.stringify({ schema: 'commitwork.digest-deliveries/1' }));
    assert.throws(() => readLedger(path), (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, `delivery ledger at ${path} is not commitwork.digest-deliveries/1`);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when deliveries field is not an object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const path = join(dir, 'ledger.json');
    writeFileSync(path, JSON.stringify({ schema: 'commitwork.digest-deliveries/1', deliveries: 'string' }));
    assert.throws(() => readLedger(path), (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, `delivery ledger at ${path} is not commitwork.digest-deliveries/1`);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when deliveries field is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const path = join(dir, 'ledger.json');
    writeFileSync(path, JSON.stringify({ schema: 'commitwork.digest-deliveries/1', deliveries: null }));
    assert.throws(() => readLedger(path), (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, `delivery ledger at ${path} is not commitwork.digest-deliveries/1`);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed document when schema and deliveries are valid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const path = join(dir, 'ledger.json');
    const doc = { schema: 'commitwork.digest-deliveries/1', deliveries: { a: 1, b: 2 } };
    writeFileSync(path, JSON.stringify(doc));
    const result = readLedger(path);
    assert.deepEqual(result, doc);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when JSON parses to null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const path = join(dir, 'ledger.json');
    writeFileSync(path, 'null');
    assert.throws(() => readLedger(path), (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, `delivery ledger at ${path} is not commitwork.digest-deliveries/1`);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when JSON parses to a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const path = join(dir, 'ledger.json');
    writeFileSync(path, '"just a string"');
    assert.throws(() => readLedger(path), (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, `delivery ledger at ${path} is not commitwork.digest-deliveries/1`);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when JSON parses to a number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const path = join(dir, 'ledger.json');
    writeFileSync(path, '42');
    assert.throws(() => readLedger(path), (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, `delivery ledger at ${path} is not commitwork.digest-deliveries/1`);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
