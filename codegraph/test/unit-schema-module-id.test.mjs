// Computes a module identifier string prefixed with mod: (codegraph/schema.mjs moduleId).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moduleId } from '../schema.mjs';

test('returns mod: prefix plus the path for a simple relative path', () => {
  const r = moduleId('src/index.js');
  assert.equal(r, "mod:src/index.js");
});

test('returns mod: prefix plus the path for a nested directory path', () => {
  const r = moduleId('a/b/c/d.js');
  assert.equal(r, "mod:a/b/c/d.js");
});

test('returns mod: prefix plus the path for a path with a dotfile', () => {
  const r = moduleId('.hidden/config.json');
  assert.equal(r, "mod:.hidden/config.json");
});

test('returns mod: prefix plus the path for a path with spaces', () => {
  const r = moduleId('my file name.txt');
  assert.equal(r, "mod:my file name.txt");
});

test('returns mod: prefix plus the path for a long repeated path', () => {
  const r = moduleId('x'.repeat(100));
  assert.equal(r, "mod:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
});

test('returns mod: prefix plus the path for a path with unicode characters', () => {
  const r = moduleId('caf\u00e9/na\u00efve.js');
  assert.equal(r, "mod:caf\u00e9/na\u00efve.js");
});

test('returns mod: prefix plus the path for a path with special characters', () => {
  const r = moduleId('a+b*c?d#e.js');
  assert.equal(r, "mod:a+b*c?d#e.js");
});

test('returns mod: prefix plus the path for a path with backslashes', () => {
  const r = moduleId('win\\path\\file.js');
  assert.equal(r, "mod:win\\path\\file.js");
});
