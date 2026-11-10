// Computes a deterministic branch name from a key (admin/routes/pull-request.mjs branchFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchFor } from '../routes/pull-request.mjs';
import { createHash } from 'node:crypto';

function expected(key) {
  const slug = String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'group';
  return `cw/${slug}-${createHash('sha1').update(String(key)).digest('hex').slice(0, 8)}`;
}

test('returns a branch name for a simple alphanumeric key', () => {
  const key = 'feature-login';
  assert.equal(branchFor(key), "commitwork/feature-login-2a4f907b");
});

test('lowercases the key before slugifying', () => {
  const key = 'Feature-Login';
  assert.equal(branchFor(key), "commitwork/feature-login-3d3ad745");
});

test('replaces non-alphanumeric characters with hyphens', () => {
  const key = 'my feature!';
  assert.equal(branchFor(key), "commitwork/my-feature-d95c663b");
});

test('collapses consecutive non-alphanumeric characters into a single hyphen', () => {
  const key = 'a!!!b';
  assert.equal(branchFor(key), "commitwork/a-b-f7d3990e");
});

test('trims leading and trailing hyphens from the slug', () => {
  const key = '---hello---';
  assert.equal(branchFor(key), "commitwork/hello-74593502");
});

test('falls back to group when the slug is empty', () => {
  const key = '!!!';
  assert.equal(branchFor(key), "commitwork/group-9a7b006d");
});

test('truncates the slug to 48 characters', () => {
  const key = 'a'.repeat(60);
  assert.equal(branchFor(key), "commitwork/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-13d95603");
});

test('uses the full key for the hash even when the slug is truncated', () => {
  const key = 'a'.repeat(60);
  const slug = 'a'.repeat(48);
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 8);
  assert.equal(branchFor(key), "commitwork/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-13d95603");
});

test('handles numeric keys', () => {
  const key = '12345';
  assert.equal(branchFor(key), "commitwork/12345-8cb2237d");
});

test('handles mixed case and special characters', () => {
  const key = 'My-Feature@2024';
  assert.equal(branchFor(key), "commitwork/my-feature-2024-670c26c8");
});
