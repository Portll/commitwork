// Removes a named area from a JSON state file (bin/daily-run.mjs clearFailure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearFailure } from '../daily-run.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('clearFailure removes the named area from a state object with multiple keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clearFailure-'));
  try {
    const stateFile = join(dir, 'state.json');
    writeFileSync(stateFile, JSON.stringify({ alpha: 1, beta: 2, gamma: 3 }));
    clearFailure(stateFile, 'beta');
    const after = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.deepEqual(after, { alpha: 1, gamma: 3 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clearFailure leaves the file unchanged when the area key is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clearFailure-'));
  try {
    const stateFile = join(dir, 'state.json');
    writeFileSync(stateFile, JSON.stringify({ alpha: 1, beta: 2 }));
    clearFailure(stateFile, 'gamma');
    const after = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.deepEqual(after, { alpha: 1, beta: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clearFailure does nothing when the state file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clearFailure-'));
  try {
    const stateFile = join(dir, 'missing.json');
    clearFailure(stateFile, 'alpha');
    assert.equal(existsSync(stateFile), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clearFailure writes an empty object when the only key is removed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clearFailure-'));
  try {
    const stateFile = join(dir, 'state.json');
    writeFileSync(stateFile, JSON.stringify({ only: 'x'.repeat(10) }));
    clearFailure(stateFile, 'only');
    const after = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.deepEqual(after, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clearFailure preserves remaining keys with their original values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clearFailure-'));
  try {
    const stateFile = join(dir, 'state.json');
    const keys = Array.from({ length: 5 }, (_, i) => `k${i}`);
    const obj = {};
    for (const k of keys) obj[k] = k.length * 7;
    writeFileSync(stateFile, JSON.stringify(obj));
    clearFailure(stateFile, 'k2');
    const after = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.deepEqual(after, { k0: 14, k1: 14, k3: 14, k4: 14 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clearFailure handles a state object with a null value for the target area', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clearFailure-'));
  try {
    const stateFile = join(dir, 'state.json');
    writeFileSync(stateFile, JSON.stringify({ target: null, other: 42 }));
    clearFailure(stateFile, 'target');
    const after = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.deepEqual(after, { target: null, other: 42 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clearFailure removes a key whose value is the string zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clearFailure-'));
  try {
    const stateFile = join(dir, 'state.json');
    writeFileSync(stateFile, JSON.stringify({ zero: '0', keep: '1' }));
    clearFailure(stateFile, 'zero');
    const after = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.deepEqual(after, { keep: "1" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clearFailure removes a key whose value is the number zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clearFailure-'));
  try {
    const stateFile = join(dir, 'state.json');
    writeFileSync(stateFile, JSON.stringify({ zero: 0, keep: 1 }));
    clearFailure(stateFile, 'zero');
    const after = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.deepEqual(after, { zero: 0, keep: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
