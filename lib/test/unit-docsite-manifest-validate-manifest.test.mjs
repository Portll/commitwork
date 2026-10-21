// Validates a parsed docsite manifest object and returns an array of error strings (lib/docsite-manifest.mjs validateManifest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../docsite-manifest.mjs';

test('returns empty array for a valid manifest with one doc', () => {
  const m = {
    version: 1,
    docs: [
      {
        slug: 'hello',
        urlPath: 'hello',
        title: 'Hello',
        source: 'content/hello.md',
        kind: 'md',
        state: 'published'
      }
    ]
  };
  assert.deepEqual(validateManifest(m), []);
});

test('reports top level not an object when input is null', () => {
  assert.deepEqual(validateManifest(null), ['top level is not an object']);
});

test('reports top level not an object when input is an array', () => {
  assert.deepEqual(validateManifest([]), ['top level is not an object']);
});

test('reports unknown top-level key', () => {
  const m = { version: 1, docs: [], foo: 'bar' };
  assert.deepEqual(validateManifest(m), ["unknown top-level key 'foo'"]);
});

test('reports version must be 1 when version is 2', () => {
  const m = { version: 2, docs: [] };
  assert.deepEqual(validateManifest(m), ['version must be 1, got 2']);
});

test('reports docs must be an array when docs is missing', () => {
  const m = { version: 1 };
  assert.deepEqual(validateManifest(m), ['docs must be an array']);
});

test('reports missing required keys for a doc entry', () => {
  const m = {
    version: 1,
    docs: [
      {
        slug: 'a',
        urlPath: 'a',
        title: 'A',
        source: 'content/a.md',
        kind: 'md',
        state: 'draft'
      },
      {
        slug: 'b',
        urlPath: 'b',
        title: 'B',
        source: 'content/b.md',
        kind: 'md'
      }
    ]
  };
  const errs = validateManifest(m);
  assert.ok(errs.includes("docs[1]: missing required 'state'"));
});

test('reports bad slug when slug contains uppercase', () => {
  const m = {
    version: 1,
    docs: [
      {
        slug: 'Hello',
        urlPath: 'hello',
        title: 'Hello',
        source: 'content/hello.md',
        kind: 'md',
        state: 'draft'
      }
    ]
  };
  const errs = validateManifest(m);
  assert.ok(errs.includes("docs[0]: bad slug 'Hello'"));
});

test('reports duplicate slug', () => {
  const m = {
    version: 1,
    docs: [
      {
        slug: 'dup',
        urlPath: 'uuid-1',
        title: 'One',
        source: 'content/one.md',
        kind: 'md',
        state: 'draft'
      },
      {
        slug: 'dup',
        urlPath: 'uuid-2',
        title: 'Two',
        source: 'content/two.md',
        kind: 'md',
        state: 'draft'
      }
    ]
  };
  const errs = validateManifest(m);
  assert.ok(errs.includes("docs[1]: duplicate slug 'dup'"));
});

test('reports kind must be md|imported when kind is invalid', () => {
  const m = {
    version: 1,
    docs: [
      {
        slug: 'a',
        urlPath: 'a',
        title: 'A',
        source: 'content/a.md',
        kind: 'txt',
        state: 'draft'
      }
    ]
  };
  const errs = validateManifest(m);
  assert.ok(errs.includes('docs[0]: kind must be md|imported'));
});
