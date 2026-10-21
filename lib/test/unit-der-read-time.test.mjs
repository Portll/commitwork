// Converts DER GeneralizedTime or UTCTime content to an ISO string and raw text (lib/der.mjs readTime).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTime } from '../der.mjs';

test('parses GeneralizedTime with fractional seconds', () => {
  const node = { tag: 0x18, content: Buffer.from('20230101120000.123Z', 'ascii') };
  const result = readTime(node);
  assert.equal(result.iso, '2023-01-01T12:00:00.123Z');
  assert.equal(result.text, '20230101120000.123Z');
});

test('parses UTCTime with year 50 or greater as 19xx', () => {
  const node = { tag: 0x17, content: Buffer.from('500101120000Z', 'ascii') };
  const result = readTime(node);
  assert.equal(result.iso, '1950-01-01T12:00:00.000Z');
  assert.equal(result.text, '500101120000Z');
});

test('parses UTCTime with year less than 50 as 20xx', () => {
  const node = { tag: 0x17, content: Buffer.from('490101120000Z', 'ascii') };
  const result = readTime(node);
  assert.equal(result.iso, '2049-01-01T12:00:00.000Z');
  assert.equal(result.text, '490101120000Z');
});

test('throws DerError for missing content', () => {
  const node = { tag: 0x18 };
  assert.throws(() => readTime(node), /missing/);
});

test('throws DerError for invalid tag', () => {
  const node = { tag: 0x04, content: Buffer.from('20230101120000Z', 'ascii') };
  assert.throws(() => readTime(node), /not a DER GeneralizedTime\/UTCTime/);
});

test('throws DerError for malformed time string', () => {
  const node = { tag: 0x18, content: Buffer.from('2023-01-01T12:00:00Z', 'ascii') };
  assert.throws(() => readTime(node), /not a DER GeneralizedTime\/UTCTime/);
});

test('handles fractional seconds with fewer than 3 digits', () => {
  const node = { tag: 0x18, content: Buffer.from('20230101120000.1Z', 'ascii') };
  const result = readTime(node);
  assert.equal(result.iso, '2023-01-01T12:00:00.100Z');
  assert.equal(result.text, '20230101120000.1Z');
});

test('handles fractional seconds with more than 3 digits', () => {
  const node = { tag: 0x18, content: Buffer.from('20230101120000.12345Z', 'ascii') };
  const result = readTime(node);
  assert.equal(result.iso, '2023-01-01T12:00:00.123Z');
  assert.equal(result.text, '20230101120000.12345Z');
});
