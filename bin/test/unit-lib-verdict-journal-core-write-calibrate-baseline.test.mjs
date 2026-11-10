// Writes the calibrate baseline JSON to a path via tmp+rename (bin/lib/verdict-journal-core.mjs writeCalibrateBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeCalibrateBaseline } from '../lib/verdict-journal-core.mjs';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('writes baseline JSON with 2-space indent and trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeCalibrateBaseline-'));
  try {
    const p = join(dir, 'sub', 'calibrate-baseline.json');
    writeCalibrateBaseline({ a: 1, b: [1, 2] }, p);
    const content = readFileSync(p, 'utf8');
    assert.equal(content, "{\n  \"a\": 1,\n  \"b\": [\n    1,\n    2\n  ]\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates parent directories recursively when they do not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeCalibrateBaseline-'));
  try {
    const p = join(dir, 'a', 'b', 'c', 'baseline.json');
    writeCalibrateBaseline({ x: 0 }, p);
    assert.equal(existsSync(p), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when parent directory does not exist and recursive is false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeCalibrateBaseline-'));
  try {
    const p = join(dir, 'no-such-dir', 'baseline.json');
    assert.equal(writeCalibrateBaseline({ y: 1 }, p), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes empty object as JSON with 2-space indent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeCalibrateBaseline-'));
  try {
    const p = join(dir, 'empty.json');
    writeCalibrateBaseline({}, p);
    const content = readFileSync(p, 'utf8');
    assert.equal(content, "{}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes nested object with 2-space indent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeCalibrateBaseline-'));
  try {
    const p = join(dir, 'nested.json');
    writeCalibrateBaseline({ outer: { inner: { deep: true } } }, p);
    const content = readFileSync(p, 'utf8');
    assert.equal(content, "{\n  \"outer\": {\n    \"inner\": {\n      \"deep\": true\n    }\n  }\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes array values with 2-space indent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeCalibrateBaseline-'));
  try {
    const p = join(dir, 'arr.json');
    writeCalibrateBaseline({ list: [10, 20, 30] }, p);
    const content = readFileSync(p, 'utf8');
    assert.equal(content, "{\n  \"list\": [\n    10,\n    20,\n    30\n  ]\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('overwrites existing file at the same path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeCalibrateBaseline-'));
  try {
    const p = join(dir, 'overwrite.json');
    writeCalibrateBaseline({ v: 'first' }, p);
    writeCalibrateBaseline({ v: 'second' }, p);
    const content = readFileSync(p, 'utf8');
    assert.equal(content, "{\n  \"v\": \"second\"\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes string values with 2-space indent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeCalibrateBaseline-'));
  try {
    const p = join(dir, 'str.json');
    writeCalibrateBaseline({ msg: 'hello world' }, p);
    const content = readFileSync(p, 'utf8');
    assert.equal(content, "{\n  \"msg\": \"hello world\"\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
