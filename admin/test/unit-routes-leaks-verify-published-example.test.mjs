// Maps a matched line to a known published example id and weight, or null (admin/routes/leaks-verify.mjs publishedExample).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishedExample } from '../routes/leaks-verify.mjs';

test('returns aws-docs-secret-key for the AWS docs secret key example', () => {
  const line = 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  assert.deepEqual(publishedExample(line), { id: 'aws-docs-secret-key', weight: 'known' });
});

test('returns aws-docs-access-key-id for the AWS docs access key id example', () => {
  const line = 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE';
  assert.deepEqual(publishedExample(line), { id: 'aws-docs-access-key-id', weight: 'default-allowlisted' });
});

test('returns null for a line with no known example', () => {
  assert.equal(publishedExample('some random text'), null);
});

test('returns null for empty input', () => {
  assert.equal(publishedExample(''), null);
});

test('returns null for undefined input', () => {
  assert.equal(publishedExample(undefined), null);
});

test('returns null for null input', () => {
  assert.equal(publishedExample(null), null);
});

test('returns null for a JWT with sub 1234567890 but unknown name', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: '1234567890', name: 'Alice' })).toString('base64url');
  const sig = 'x'.repeat(20);
  const line = `${header}.${payload}.${sig}`;
  assert.equal(publishedExample(line), null);
});

test('returns null for a JWT with wrong sub and known name', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: '9999999999', name: 'John Doe' })).toString('base64url');
  const sig = 'x'.repeat(20);
  const line = `${header}.${payload}.${sig}`;
  assert.equal(publishedExample(line), null);
});

test('returns null for a non-JWT string that is not a known example', () => {
  const line = 'eyJabc123.def456ghi.abc';
  assert.equal(publishedExample(line), null);
});

test('returns null for a very long line with no known example', () => {
  const line = 'x'.repeat(1000);
  assert.equal(publishedExample(line), null);
});
