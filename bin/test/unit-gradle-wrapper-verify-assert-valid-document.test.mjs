// The document itself when it fits the schema, else an error listing every violation (bin/gradle-wrapper-verify.mjs assertValidDocument).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertValidDocument } from '../gradle-wrapper-verify.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const schemaFile = join(repoRoot, 'schema', 'gradle-wrapper.schema.json');
const defaultPath = process.env.CW_GRADLE_WRAPPER_SCHEMA || schemaFile;
const REQUIRED = ['tool', 'generatedAt', 'root', 'ran', 'applicable', 'findings'];
const missing = REQUIRED.map((k) => `schema: (root): required key '${k}' is missing`);
const unknown = (k) => `schema: (root): unknown key '${k}' (additionalProperties: false)`;
const expected = (path, errors) => `gradle-wrapper.json does not match ${path}:\n  - ${errors.join('\n  - ')}`;

test('an empty object is rejected with one line per missing required key', () => {
  assert.throws(() => assertValidDocument({}, { path: schemaFile }), {
    name: 'Error',
    message: expected(schemaFile, missing),
  });
});

test('a call without options validates against the default schema path', () => {
  assert.throws(() => assertValidDocument({ name: 'test', version: '1.0.0' }), {
    name: 'Error',
    message: expected(defaultPath, [...missing, unknown('name'), unknown('version')]),
  });
});

test('an options object without a path falls back to the default schema path', () => {
  assert.throws(() => assertValidDocument({}, {}), {
    name: 'Error',
    message: expected(defaultPath, missing),
  });
});

test('an explicit undefined path falls back to the default schema path', () => {
  assert.throws(() => assertValidDocument({ extra: 'field' }, { path: undefined }), {
    name: 'Error',
    message: expected(defaultPath, [...missing, unknown('extra')]),
  });
});

test('the message names the schema path exactly as it was passed in', () => {
  const path = `${repoRoot}/schema/../schema/gradle-wrapper.schema.json`;
  assert.throws(() => assertValidDocument({}, { path }), {
    name: 'Error',
    message: expected(path, missing),
  });
});

test('every unknown key is reported after the missing keys in insertion order', () => {
  const keys = Array.from({ length: 5 }, (_, i) => `k${i}`);
  const doc = Object.fromEntries(keys.map((k, i) => [k, i]));
  assert.throws(() => assertValidDocument(doc, { path: schemaFile }), {
    name: 'Error',
    message: expected(schemaFile, [...missing, ...keys.map(unknown)]),
  });
});

test('a single unknown key yields exactly seven violation lines', () => {
  let caught;
  try {
    assertValidDocument({ zz: 'x'.repeat(3) }, { path: schemaFile });
  } catch (e) {
    caught = e;
  }
  assert.equal(caught.message.split('\n  - ').length, 8);
  assert.equal(caught.message, expected(schemaFile, [...missing, unknown('zz')]));
});
