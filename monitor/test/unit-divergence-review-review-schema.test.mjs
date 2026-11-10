// Loads and caches the review shape of the divergence-review schema file (monitor/divergence-review.mjs reviewSchema).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewSchema } from '../divergence-review.mjs';
import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MODULE = 'divergence-review.mjs';
const SCHEMA = 'divergence-review.schema.json';
const NO_SHAPE = 'divergence-review schema has no review shape';
const UNREADABLE = 'divergence-review schema unreadable (schema/divergence-review.schema.json): ';
const VALID = '{"review":{"properties":{"a":1}}}';

function mirror(from, to, skip) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (!skip.includes(name)) symlinkSync(join(from, name), join(to, name));
  }
}

async function withSchema(text, run) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'reviewSchema-')));
  try {
    mirror(ROOT, dir, ['monitor', 'schema']);
    mirror(join(ROOT, 'monitor'), join(dir, 'monitor'), [MODULE]);
    mirror(join(ROOT, 'schema'), join(dir, 'schema'), [SCHEMA]);
    copyFileSync(join(ROOT, 'monitor', MODULE), join(dir, 'monitor', MODULE));
    const path = join(dir, 'schema', SCHEMA);
    writeFileSync(path, text);
    const staged = await import(pathToFileURL(join(dir, 'monitor', MODULE)).href);
    await run(staged.reviewSchema, path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns the review object of the shipped schema file', () => {
  const shipped = JSON.parse(readFileSync(join(ROOT, 'schema', SCHEMA), 'utf8'));
  assert.deepEqual(reviewSchema(), shipped.review);
});

test('returns only the review object and drops the other top level keys', () => withSchema(
  '{"title":"t","review":{"type":"object","properties":{"verdict":{"type":"string"}}}}',
  (reviewSchema) => {
    assert.deepEqual(reviewSchema(), { type: 'object', properties: { verdict: { type: 'string' } } });
  },
));

test('accepts an empty properties object', () => withSchema('{"review":{"properties":{}}}', (reviewSchema) => {
  assert.deepEqual(reviewSchema(), { properties: {} });
}));

test('rejects a schema file holding JSON null', () => withSchema('null', (reviewSchema) => {
  assert.throws(() => reviewSchema(), { name: 'Error', message: NO_SHAPE });
}));

test('rejects a schema object with no review key', () => withSchema('{}', (reviewSchema) => {
  assert.throws(() => reviewSchema(), { name: 'Error', message: NO_SHAPE });
}));

test('rejects a review object with no properties key', () => withSchema('{"review":{}}', (reviewSchema) => {
  assert.throws(() => reviewSchema(), { name: 'Error', message: NO_SHAPE });
}));

test('rejects falsy parsed values and falsy review or properties fields', () => withSchema('0', (reviewSchema, path) => {
  const texts = [
    '0', 'false', '""', '[]', '{"review":null}', '{"review":0}',
    '{"review":{"properties":null}}', '{"review":{"properties":0}}',
  ];
  for (const text of texts) {
    writeFileSync(path, text);
    assert.throws(() => reviewSchema(), { name: 'Error', message: NO_SHAPE });
  }
}));

test('reports a missing file as unreadable and reads it once it exists', () => withSchema(VALID, (reviewSchema, path) => {
  rmSync(path);
  assert.throws(() => reviewSchema(), {
    name: 'Error',
    message: `${UNREADABLE}ENOENT: no such file or directory, open '${path}'`,
  });
  writeFileSync(path, VALID);
  assert.deepEqual(reviewSchema(), { properties: { a: 1 } });
}));

test('reports an empty file as unreadable with the JSON parse message', () => withSchema('', (reviewSchema) => {
  assert.throws(() => reviewSchema(), { name: 'Error', message: `${UNREADABLE}Unexpected end of JSON input` });
}));

test('returns the same cached object after the file is gone', () => withSchema(VALID, (reviewSchema, path) => {
  const first = reviewSchema();
  rmSync(path);
  assert.equal(reviewSchema(), first);
  assert.deepEqual(first, { properties: { a: 1 } });
}));
