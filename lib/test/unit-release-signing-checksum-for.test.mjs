// Extracts a SHA-256 checksum for a named asset from a SHA-256SUMS text. (lib/release-signing.mjs checksumFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checksumFor } from '../release-signing.mjs';

const hex64 = 'a'.repeat(64);
const hex64b = 'b'.repeat(64);
const hex64c = 'c'.repeat(64);
const hex64d = 'd'.repeat(64);
const hex64e = 'e'.repeat(64);
const hex64f = 'f'.repeat(64);
const hex64g = '0'.repeat(64);
const hex64h = '1'.repeat(64);

test('returns the checksum when the asset name matches a line', () => {
  const text = `${hex64}  *file.txt\n${hex64b}  other.bin`;
  const r = checksumFor(text, 'file.txt');
  assert.equal(r, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test('returns null when the asset name is not present in the text', () => {
  const text = `${hex64}  *file.txt\n${hex64b}  other.bin`;
  const r = checksumFor(text, 'missing.dat');
  assert.equal(r, null);
});

test('returns null when the text is empty', () => {
  const r = checksumFor('', 'file.txt');
  assert.equal(r, null);
});

test('returns null when the checksum is all zeros', () => {
  const text = `${hex64g}  *file.txt`;
  const r = checksumFor(text, 'file.txt');
  assert.equal(r, "0000000000000000000000000000000000000000000000000000000000000000");
});

test('returns the checksum when the checksum starts with one', () => {
  const text = `${hex64h}  *file.txt`;
  const r = checksumFor(text, 'file.txt');
  assert.equal(r, "1111111111111111111111111111111111111111111111111111111111111111");
});

test('returns the checksum when the asset name has no asterisk prefix', () => {
  const text = `${hex64}  file.txt`;
  const r = checksumFor(text, 'file.txt');
  assert.equal(r, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test('returns the checksum when the asset name has an asterisk prefix', () => {
  const text = `${hex64}  *file.txt`;
  const r = checksumFor(text, 'file.txt');
  assert.equal(r, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test('returns the checksum of the first matching line when multiple lines match', () => {
  const text = `${hex64}  *file.txt\n${hex64b}  *file.txt`;
  const r = checksumFor(text, 'file.txt');
  assert.equal(r, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test('returns null when the line has a trailing space after the asset name', () => {
  const text = `${hex64}  *file.txt `;
  const r = checksumFor(text, 'file.txt');
  assert.equal(r, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test('returns null when the checksum is 63 characters instead of 64', () => {
  const text = `${'a'.repeat(63)}  *file.txt`;
  const r = checksumFor(text, 'file.txt');
  assert.equal(r, null);
});
