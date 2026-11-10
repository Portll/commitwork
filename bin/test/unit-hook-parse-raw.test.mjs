// Parses NUL-delimited raw diff records into structured objects (bin/hook.mjs parseRaw).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRaw } from '../hook.mjs';

test('parses a single added file record', () => {
  const buf = Buffer.from(':100644 100644 0000000000000000000000000000000000000000 abcdef1234567890abcdef1234567890abcdef12 A\0newfile.txt');
  assert.deepEqual(parseRaw(buf), [{ status: "A", oldMode: "100644", newMode: "100644", oldSha: "0000000000000000000000000000000000000000", newSha: "abcdef1234567890abcdef1234567890abcdef12", path: "newfile.txt", src: "newfile.txt" }]);
});

test('parses a renamed file record with two paths', () => {
  const buf = Buffer.from(':100644 100644 abcdef1234567890abcdef1234567890abcdef12 abcdef1234567890abcdef1234567890abcdef12 R100\0old.txt\0new.txt');
  assert.deepEqual(parseRaw(buf), [{ status: "R", oldMode: "100644", newMode: "100644", oldSha: "abcdef1234567890abcdef1234567890abcdef12", newSha: "abcdef1234567890abcdef1234567890abcdef12", path: "new.txt", src: "old.txt" }]);
});

test('parses a copied file record with two paths', () => {
  const buf = Buffer.from(':100644 100644 abcdef1234567890abcdef1234567890abcdef12 abcdef1234567890abcdef1234567890abcdef12 C100\0src.txt\0dst.txt');
  assert.deepEqual(parseRaw(buf), [{ status: "C", oldMode: "100644", newMode: "100644", oldSha: "abcdef1234567890abcdef1234567890abcdef12", newSha: "abcdef1234567890abcdef1234567890abcdef12", path: "dst.txt", src: "src.txt" }]);
});

test('parses a modified file record with one path', () => {
  const buf = Buffer.from(':100644 100644 abcdef1234567890abcdef1234567890abcdef12 abcdef1234567890abcdef1234567890abcdef12 M\0mod.txt');
  assert.deepEqual(parseRaw(buf), [{ status: "M", oldMode: "100644", newMode: "100644", oldSha: "abcdef1234567890abcdef1234567890abcdef12", newSha: "abcdef1234567890abcdef1234567890abcdef12", path: "mod.txt", src: "mod.txt" }]);
});

test('parses a deleted file record with one path', () => {
  const buf = Buffer.from(':100644 000000 abcdef1234567890abcdef1234567890abcdef12 0000000000000000000000000000000000000000 D\0del.txt');
  assert.deepEqual(parseRaw(buf), [{ status: "D", oldMode: "100644", newMode: "000000", oldSha: "abcdef1234567890abcdef1234567890abcdef12", newSha: "0000000000000000000000000000000000000000", path: "del.txt", src: "del.txt" }]);
});

test('throws on a record whose head does not start with colon', () => {
  const buf = Buffer.from('100644 100644 0000000000000000000000000000000000000000 abcdef1234567890abcdef1234567890abcdef12 A\0file.txt');
  assert.throws(() => parseRaw(buf), { name: 'Error', message: 'unparseable raw diff record: "100644 100644 0000000000000000000000000000000000000000 abcdef1234567890abcdef1234567890abcdef12 A"' });
});

test('parses multiple records separated by NUL', () => {
  const buf = Buffer.from(':100644 100644 0000000000000000000000000000000000000000 abcdef1234567890abcdef1234567890abcdef12 A\0a.txt\0:100644 100644 0000000000000000000000000000000000000000 abcdef1234567890abcdef1234567890abcdef12 A\0b.txt');
  assert.deepEqual(parseRaw(buf), [{ status: "A", oldMode: "100644", newMode: "100644", oldSha: "0000000000000000000000000000000000000000", newSha: "abcdef1234567890abcdef1234567890abcdef12", path: "a.txt", src: "a.txt" }, { status: "A", oldMode: "100644", newMode: "100644", oldSha: "0000000000000000000000000000000000000000", newSha: "abcdef1234567890abcdef1234567890abcdef12", path: "b.txt", src: "b.txt" }]);
});

test('returns empty array for empty buffer', () => {
  const buf = Buffer.alloc(0);
  assert.deepEqual(parseRaw(buf), []);
});
