// deterministic UUID from content (cra/lib.mjs contentUUID).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentUUID } from '../lib.mjs';

test('contentUUID returns deterministic UUID for empty string', () => {
  const r = contentUUID('');
  assert.equal(r, "urn:uuid:e3b0c442-98fc-1c14-9afb-f4c8996fb924");
});

test('contentUUID returns deterministic UUID for short ASCII string', () => {
  const r = contentUUID('abc');
  assert.equal(r, "urn:uuid:ba7816bf-8f01-cfea-4141-40de5dae2223");
});

test('contentUUID returns deterministic UUID for longer repeated characters', () => {
  const r = contentUUID('x'.repeat(100));
  assert.equal(r, "urn:uuid:09ecb6eb-c8bc-efc7-33f6-f2ec44f791ab");
});

test('contentUUID returns deterministic UUID for binary data represented as string', () => {
  const r = contentUUID(Buffer.alloc(32, 0).toString('hex'));
  assert.equal(r, "urn:uuid:60e05bd1-b195-af2f-9411-2fa7197a5c88");
});

test('contentUUID returns deterministic UUID for string with special characters', () => {
  const r = contentUUID('!@#$%^&*()_+-=[]{}|;:\'",.<>/?`~');
  assert.equal(r, "urn:uuid:3bf02744-3e63-5c5c-0e3c-f6867c62040a");
});
