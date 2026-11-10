// Computes a deterministic OSCAL UUID v5 from a seed string (cra/oscal.mjs oscalUUID).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oscalUUID } from '../oscal.mjs';
import { createHash } from 'node:crypto';

function expectedUUID(seed) {
  const h = createHash('sha256').update(seed).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

test('oscalUUID returns the correct UUID for seed "a"', () => {
  const uuid = oscalUUID('a');
  assert.strictEqual(uuid, "ca978112-ca1b-5dca-bac2-31b39a23dc4d");
});

test('oscalUUID returns the correct UUID for seed "b"', () => {
  const uuid = oscalUUID('b');
  assert.strictEqual(uuid, "3e23e816-0039-594a-b389-4f6564e1b134");
});

test('oscalUUID produces a UUID that matches the OSCAL v5 pattern', () => {
  const uuid = oscalUUID('test');
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('oscalUUID uses the correct variant bit derived from the hash', () => {
  const uuid = oscalUUID('boundary');
  const h = createHash('sha256').update('boundary').digest('hex');
  const expectedVariant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  assert.strictEqual(uuid[19], expectedVariant);
});

test('oscalUUID is deterministic: same seed yields same UUID', () => {
  const uuid1 = oscalUUID('deterministic');
  const uuid2 = oscalUUID('deterministic');
  assert.strictEqual(uuid1, uuid2);
});
