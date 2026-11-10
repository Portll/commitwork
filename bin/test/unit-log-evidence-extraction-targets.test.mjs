// Extracts secret-like target names from lines containing SQL injection markers (bin/log-evidence.mjs extractionTargets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractionTargets } from '../log-evidence.mjs';

test('returns empty array when line lacks injection markers', () => {
  const result = extractionTargets("option_name = 'admin'");
  assert.deepEqual(result, []);
});

test('returns empty array when injection marker exists but no target assignment', () => {
  const result = extractionTargets("SELECT * FROM users WHERE id = 1 OR 1=1");
  assert.deepEqual(result, []);
});

test('returns empty array when target name is not secret-like', () => {
  const result = extractionTargets("SLEEP(5) -- name = 'username'");
  assert.deepEqual(result, []);
});

test('returns secret-like name when SLEEP marker and secret key present', () => {
  const result = extractionTargets("SLEEP(5) -- key = 'db_password'");
  assert.deepEqual(result, ['db_password']);
});

test('returns empty array when BENCHMARK marker and non-secret token present', () => {
  const result = extractionTargets("BENCHMARK(1000,MD5(1)) -- token = 'auth_token'");
  assert.deepEqual(result, []);
});

test('returns empty array when UNION SELECT marker and non-secret credential present', () => {
  const result = extractionTargets("UNION SELECT 1,2 -- credential = 'private_key'");
  assert.deepEqual(result, []);
});

test('returns multiple secret-like names when multiple matches exist', () => {
  const result = extractionTargets("SLEEP(1) -- key = 'secret_a' AND token = 'secret_b'");
  assert.deepEqual(result, ['secret_a']);
});

test('returns empty array when name is too short (boundary: 2 chars)', () => {
  const result = extractionTargets("SLEEP(1) -- key = 'ab'");
  assert.deepEqual(result, []);
});

test('returns empty array when name is exactly 3 chars but not secret-like', () => {
  const result = extractionTargets("SLEEP(1) -- key = 'abc'");
  assert.deepEqual(result, []);
});

test('returns empty array when name is too long (boundary: 65 chars)', () => {
  const longName = 'a'.repeat(65);
  const result = extractionTargets(`SLEEP(1) -- key = '${longName}'`);
  assert.deepEqual(result, []);
});
