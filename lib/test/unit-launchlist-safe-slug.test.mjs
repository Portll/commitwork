// Validates and returns a project slug (lib/launchlist.mjs safeSlug).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeSlug } from '../launchlist.mjs';

test('returns a valid alphanumeric slug unchanged', () => {
  assert.equal(safeSlug('my-project'), "my-project");
});

test('returns a valid slug with dots and underscores', () => {
  assert.equal(safeSlug('a.b_c-d'), "a.b_c-d");
});

test('returns a single character slug', () => {
  assert.equal(safeSlug('a'), "a");
});

test('returns a maximum length slug of 100 characters', () => {
  assert.equal(safeSlug('a'.repeat(100)), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test('throws for an empty string', () => {
  assert.throws(() => safeSlug(''), { name: "Error", message: "launchlist: not a project slug: \"\"" });
});

test('throws for a slug starting with a dot', () => {
  assert.throws(() => safeSlug('.hidden'), { name: "Error", message: "launchlist: not a project slug: \".hidden\"" });
});

test('throws for a slug containing double dots', () => {
  assert.throws(() => safeSlug('a..b'), { name: "Error", message: "launchlist: not a project slug: \"a..b\"" });
});

test('throws for a slug that is too long', () => {
  assert.throws(() => safeSlug('a'.repeat(101)), { name: "Error", message: "launchlist: not a project slug: \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"" });
});

test('throws for a slug with invalid characters', () => {
  assert.throws(() => safeSlug('bad!slug'), { name: "Error", message: "launchlist: not a project slug: \"bad!slug\"" });
});

test('throws for null input', () => {
  assert.throws(() => safeSlug(null), { name: "Error", message: "launchlist: not a project slug: \"\"" });
});
