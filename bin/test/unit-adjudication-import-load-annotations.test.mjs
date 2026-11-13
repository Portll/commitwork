// Reads the annotations JSON file and returns its parsed object (bin/adjudication-import.mjs loadAnnotations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAnnotations } from '../adjudication-import.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const annotationsFile = join(REPO, 'monitor', 'private', 'annotations.json');
const annotationsDir = dirname(annotationsFile);

test('parses a valid JSON object from the annotations file', () => {
  mkdirSync(annotationsDir, { recursive: true });
  writeFileSync(annotationsFile, JSON.stringify({ a: 1, b: [2, 3] }));
  try {
    const result = loadAnnotations();
    assert.deepEqual(result, { a: 1, b: [2, 3] });
  } finally {
    rmSync(annotationsFile, { force: true });
  }
});

test('parses an empty JSON object', () => {
  mkdirSync(annotationsDir, { recursive: true });
  writeFileSync(annotationsFile, '{}');
  try {
    const result = loadAnnotations();
    assert.deepEqual(result, {});
  } finally {
    rmSync(annotationsFile, { force: true });
  }
});

test('parses a JSON array', () => {
  mkdirSync(annotationsDir, { recursive: true });
  writeFileSync(annotationsFile, JSON.stringify([1, 2, 3]));
  try {
    const result = loadAnnotations();
    assert.deepEqual(result, [1, 2, 3]);
  } finally {
    rmSync(annotationsFile, { force: true });
  }
});

test('throws on invalid JSON content', () => {
  mkdirSync(annotationsDir, { recursive: true });
  writeFileSync(annotationsFile, 'not valid json');
  try {
    assert.throws(() => loadAnnotations(), { name: 'SyntaxError', message: "Unexpected token 'o', \"not valid json\" is not valid JSON" });
  } finally {
    rmSync(annotationsFile, { force: true });
  }
});

test('throws when the annotations file is missing', () => {
  rmSync(annotationsFile, { force: true });
  assert.throws(() => loadAnnotations(), { name: 'Error' });
});

test('parses a JSON null value', () => {
  mkdirSync(annotationsDir, { recursive: true });
  writeFileSync(annotationsFile, 'null');
  try {
    const result = loadAnnotations();
    assert.equal(result, null);
  } finally {
    rmSync(annotationsFile, { force: true });
  }
});

test('parses a JSON string value', () => {
  mkdirSync(annotationsDir, { recursive: true });
  writeFileSync(annotationsFile, JSON.stringify('hello'));
  try {
    const result = loadAnnotations();
    assert.equal(result, 'hello');
  } finally {
    rmSync(annotationsFile, { force: true });
  }
});

test('parses a JSON number value', () => {
  mkdirSync(annotationsDir, { recursive: true });
  writeFileSync(annotationsFile, '42');
  try {
    const result = loadAnnotations();
    assert.equal(result, 42);
  } finally {
    rmSync(annotationsFile, { force: true });
  }
});

test('parses a JSON boolean true value', () => {
  mkdirSync(annotationsDir, { recursive: true });
  writeFileSync(annotationsFile, 'true');
  try {
    const result = loadAnnotations();
    assert.equal(result, true);
  } finally {
    rmSync(annotationsFile, { force: true });
  }
});

test('parses a JSON boolean false value', () => {
  mkdirSync(annotationsDir, { recursive: true });
  writeFileSync(annotationsFile, 'false');
  try {
    const result = loadAnnotations();
    assert.equal(result, false);
  } finally {
    rmSync(annotationsFile, { force: true });
  }
});
