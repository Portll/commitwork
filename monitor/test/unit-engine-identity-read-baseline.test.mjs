// Reads and validates the engine identity baseline JSON file (monitor/engine-identity.mjs readBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBaseline } from '../engine-identity.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the baseline file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    process.env.CW_ENGID_BASELINE = join(dir, 'missing.json');
    assert.equal(readBaseline(), null);
  } finally {
    delete process.env.CW_ENGID_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed object when the baseline has an endpoints object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const path = join(dir, 'baseline.json');
    const data = { endpoints: { a: 1 }, other: 'x' };
    writeFileSync(path, JSON.stringify(data), 'utf8');
    process.env.CW_ENGID_BASELINE = path;
    const result = readBaseline();
    assert.deepEqual(result, data);
  } finally {
    delete process.env.CW_ENGID_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed object when endpoints is an empty object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const path = join(dir, 'baseline.json');
    const data = { endpoints: {} };
    writeFileSync(path, JSON.stringify(data), 'utf8');
    process.env.CW_ENGID_BASELINE = path;
    const result = readBaseline();
    assert.deepEqual(result, data);
  } finally {
    delete process.env.CW_ENGID_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed object when endpoints is an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const path = join(dir, 'baseline.json');
    const data = { endpoints: [1, 2] };
    writeFileSync(path, JSON.stringify(data), 'utf8');
    process.env.CW_ENGID_BASELINE = path;
    const result = readBaseline();
    assert.deepEqual(result, data);
  } finally {
    delete process.env.CW_ENGID_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when the baseline is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const path = join(dir, 'baseline.json');
    writeFileSync(path, 'null', 'utf8');
    process.env.CW_ENGID_BASELINE = path;
    assert.throws(() => readBaseline(), /baseline has no endpoints\{\}/);
  } finally {
    delete process.env.CW_ENGID_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when endpoints is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const path = join(dir, 'baseline.json');
    writeFileSync(path, JSON.stringify({ foo: 'bar' }), 'utf8');
    process.env.CW_ENGID_BASELINE = path;
    assert.throws(() => readBaseline(), /baseline has no endpoints\{\}/);
  } finally {
    delete process.env.CW_ENGID_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when endpoints is a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const path = join(dir, 'baseline.json');
    writeFileSync(path, JSON.stringify({ endpoints: 'not-an-object' }), 'utf8');
    process.env.CW_ENGID_BASELINE = path;
    assert.throws(() => readBaseline(), /baseline has no endpoints\{\}/);
  } finally {
    delete process.env.CW_ENGID_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when endpoints is a number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const path = join(dir, 'baseline.json');
    writeFileSync(path, JSON.stringify({ endpoints: 42 }), 'utf8');
    process.env.CW_ENGID_BASELINE = path;
    assert.throws(() => readBaseline(), /baseline has no endpoints\{\}/);
  } finally {
    delete process.env.CW_ENGID_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const path = join(dir, 'baseline.json');
    writeFileSync(path, '{invalid json', 'utf8');
    process.env.CW_ENGID_BASELINE = path;
    assert.throws(() => readBaseline(), SyntaxError);
  } finally {
    delete process.env.CW_ENGID_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});
