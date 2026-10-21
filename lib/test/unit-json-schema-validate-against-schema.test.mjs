// Validates a registry document against a JSON schema file, returning prefixed errors (lib/json-schema.mjs validateAgainstSchema).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAgainstSchema } from '../json-schema.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an error when no schema path is given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateAgainstSchema-'));
  try {
    const result = validateAgainstSchema({});
    assert.deepEqual(result, { errors: ['schema: no schema path given \u2014 refusing to report a document valid against nothing'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an error when the schema file cannot be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateAgainstSchema-'));
  try {
    const result = validateAgainstSchema({}, { path: join(dir, 'missing.json') });
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /^schema: .*missing\.json could not be read or parsed/);
    assert.match(result.errors[0], /refusing to report the registry valid against a schema nothing opened/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an error when the schema file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateAgainstSchema-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not json');
    const result = validateAgainstSchema({}, { path: p });
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /^schema: .*bad\.json could not be read or parsed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns no errors when the registry matches the schema', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateAgainstSchema-'));
  try {
    const p = join(dir, 'ok.json');
    writeFileSync(p, JSON.stringify({ type: 'object', required: ['name'], properties: { name: { type: 'string' } } }));
    const result = validateAgainstSchema({ name: 'hello' }, { path: p });
    assert.deepEqual(result, { errors: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a type mismatch on the root value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateAgainstSchema-'));
  try {
    const p = join(dir, 't.json');
    writeFileSync(p, JSON.stringify({ type: 'object' }));
    const result = validateAgainstSchema('not an object', { path: p });
    assert.deepEqual(result, { errors: ['schema: (root): expected object, got string'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a missing required key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateAgainstSchema-'));
  try {
    const p = join(dir, 'req.json');
    writeFileSync(p, JSON.stringify({ type: 'object', required: ['a', 'b'], properties: { a: { type: 'string' }, b: { type: 'string' } } }));
    const result = validateAgainstSchema({ a: 'x' }, { path: p });
    assert.deepEqual(result, { errors: ["schema: (root): required key 'b' is missing"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports an unknown key when additionalProperties is false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateAgainstSchema-'));
  try {
    const p = join(dir, 'add.json');
    writeFileSync(p, JSON.stringify({ type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } }));
    const result = validateAgainstSchema({ a: 'x', extra: 1 }, { path: p });
    assert.deepEqual(result, { errors: ["schema: (root): unknown key 'extra' (additionalProperties: false)"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports an unimplemented schema keyword', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateAgainstSchema-'));
  try {
    const p = join(dir, 'unimpl.json');
    writeFileSync(p, JSON.stringify({ type: 'object', patternProperties: { '^x': { type: 'string' } } }));
    const result = validateAgainstSchema({ x: 1 }, { path: p });
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /schema: \(root\): schema keyword 'patternProperties' is not implemented here/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a minLength violation on a nested string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateAgainstSchema-'));
  try {
    const p = join(dir, 'minlen.json');
    writeFileSync(p, JSON.stringify({ type: 'object', properties: { s: { type: 'string', minLength: 5 } } }));
    const result = validateAgainstSchema({ s: 'abc' }, { path: p });
    assert.deepEqual(result, { errors: ['schema: s: string of length 3 is shorter than minLength 5'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a pattern violation on a nested string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateAgainstSchema-'));
  try {
    const p = join(dir, 'pat.json');
    writeFileSync(p, JSON.stringify({ type: 'object', properties: { id: { type: 'string', pattern: '^[a-z]+$' } } }));
    const result = validateAgainstSchema({ id: 'ABC123' }, { path: p });
    assert.deepEqual(result, { errors: ['schema: id: "ABC123" does not match ^[a-z]+$'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
