// Refutation store document parsed from disk, empty when the file is missing (monitor/refutation.mjs loadRefutations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRefutations } from '../refutation.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shapeMessage = (p) => `refutation store at ${p} is not a refutation document \u2014 refusing to treat an unrecognised shape as empty`;

test('returns an empty refutation document when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRefutations-'));
  try {
    const p = join(dir, 'missing.json');
    assert.deepEqual(loadRefutations(p), { version: 1, refutations: {}, events: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file exists but cannot be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRefutations-'));
  try {
    const p = join(dir, 'sub', 'x.json');
    writeFileSync(join(dir, 'sub'), 'x');
    assert.throws(() => loadRefutations(p), {
      name: 'Error',
      message: `refutation store at ${p} could not be read (ENOTDIR) \u2014 refusing to report zero contests over an unreadable store`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file content is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRefutations-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not json');
    assert.throws(() => loadRefutations(p), {
      name: 'Error',
      message: `refutation store at ${p} is not valid JSON (Unexpected token 'o', "not json" is not valid JSON) \u2014 refusing to report zero contests over an unparseable store`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the parsed value is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRefutations-'));
  try {
    const p = join(dir, 'null.json');
    writeFileSync(p, 'null');
    assert.throws(() => loadRefutations(p), { name: 'Error', message: shapeMessage(p) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the parsed value is a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRefutations-'));
  try {
    const p = join(dir, 'str.json');
    writeFileSync(p, '"hello"');
    assert.throws(() => loadRefutations(p), { name: 'Error', message: shapeMessage(p) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the parsed value is an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRefutations-'));
  try {
    const p = join(dir, 'array.json');
    writeFileSync(p, '[]');
    assert.throws(() => loadRefutations(p), { name: 'Error', message: shapeMessage(p) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the parsed object lacks a refutations property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRefutations-'));
  try {
    const p = join(dir, 'norefs.json');
    writeFileSync(p, JSON.stringify({ version: 1, events: [] }));
    assert.throws(() => loadRefutations(p), { name: 'Error', message: shapeMessage(p) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the parsed object has a non-array events property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRefutations-'));
  try {
    const p = join(dir, 'badevents.json');
    writeFileSync(p, JSON.stringify({ version: 1, refutations: {}, events: {} }));
    assert.throws(() => loadRefutations(p), { name: 'Error', message: shapeMessage(p) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed document when it has the expected shape', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRefutations-'));
  try {
    const p = join(dir, 'good.json');
    writeFileSync(p, JSON.stringify({ version: 1, refutations: { a: 1 }, events: [{ id: 'x' }] }));
    assert.deepEqual(loadRefutations(p), { version: 1, refutations: { a: 1 }, events: [{ id: 'x' }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a document without a version when refutations and events are empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadRefutations-'));
  try {
    const p = join(dir, 'minimal.json');
    writeFileSync(p, JSON.stringify({ refutations: {}, events: [] }));
    assert.deepEqual(loadRefutations(p), { refutations: {}, events: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
