// Reads the annotations JSON file and returns its parsed object (bin/adjudication-import.mjs loadAnnotations).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadAnnotations } from '../adjudication-import.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir;
let saved;

beforeEach(() => {
  saved = process.env.CW_ANNOTATIONS;
  dir = mkdtempSync(join(tmpdir(), 'cw-annotations-'));
  process.env.CW_ANNOTATIONS = join(dir, 'annotations.json');
});

afterEach(() => {
  if (saved === undefined) delete process.env.CW_ANNOTATIONS;
  else process.env.CW_ANNOTATIONS = saved;
  rmSync(dir, { recursive: true, force: true });
});

const store = (text) => writeFileSync(process.env.CW_ANNOTATIONS, text);

test('parses a valid JSON object from the annotations file', () => {
  store(JSON.stringify({ a: 1, b: [2, 3] }));
  assert.deepEqual(loadAnnotations(), { a: 1, b: [2, 3] });
});

test('parses an empty JSON object', () => {
  store('{}');
  assert.deepEqual(loadAnnotations(), {});
});

test('parses a JSON array', () => {
  store(JSON.stringify([1, 2, 3]));
  assert.deepEqual(loadAnnotations(), [1, 2, 3]);
});

test('throws a SyntaxError on invalid JSON content', () => {
  store('not valid json');
  assert.throws(() => loadAnnotations(), { name: 'SyntaxError' });
});

test('throws ENOENT when the annotations file is missing', () => {
  assert.throws(() => loadAnnotations(), { code: 'ENOENT' });
});

test('parses a JSON null value', () => {
  store('null');
  assert.equal(loadAnnotations(), null);
});

test('parses a JSON string value', () => {
  store(JSON.stringify('hello'));
  assert.equal(loadAnnotations(), 'hello');
});

test('parses a JSON number value', () => {
  store('42');
  assert.equal(loadAnnotations(), 42);
});

test('parses a JSON boolean true value', () => {
  store('true');
  assert.equal(loadAnnotations(), true);
});

test('parses a JSON boolean false value', () => {
  store('false');
  assert.equal(loadAnnotations(), false);
});
