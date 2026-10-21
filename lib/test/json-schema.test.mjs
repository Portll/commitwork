// Tests for the shared JSON Schema subset validator (positive and negative)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAgainstSchema } from '../json-schema.mjs';

const schemaFile = (schema) => {
  const p = join(mkdtempSync(join(tmpdir(), 'cw-js-')), 's.json');
  writeFileSync(p, JSON.stringify(schema));
  return p;
};

test('a valid document has no errors and an invalid one names the field', () => {
  const path = schemaFile({ type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } });
  assert.deepEqual(validateAgainstSchema({ id: 'a' }, { path }).errors, []);
  assert.deepEqual(validateAgainstSchema({ id: '' }, { path }).errors, ['schema: id: string of length 0 is shorter than minLength 1']);
});

test('maxItems refuses an array over its cap and accepts one at it', () => {
  const path = schemaFile({ type: 'array', maxItems: 2 });
  assert.deepEqual(validateAgainstSchema([1, 2], { path }).errors, []);
  assert.deepEqual(validateAgainstSchema([1, 2, 3], { path }).errors, ['schema: (root): has 3 item(s), more than maxItems 2']);
});

test('an unimplemented keyword fails the schema instead of being skipped', () => {
  const path = schemaFile({ type: 'object', patternProperties: {} });
  assert.match(validateAgainstSchema({}, { path }).errors[0], /'patternProperties' is not implemented here/);
});

test('no path and an unreadable schema both fail closed', () => {
  assert.match(validateAgainstSchema({}, {}).errors[0], /no schema path given/);
  assert.match(validateAgainstSchema({}, { path: '/nonexistent/s.json' }).errors[0], /could not be read or parsed/);
});
