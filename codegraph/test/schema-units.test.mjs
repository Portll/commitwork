// codegraph/test/schema-units.test.mjs — case tests for moduleId, symbolId.
import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleId, symbolId } from '../schema.mjs';

test('moduleId returns mod: prefix with path', () => {
  assert.equal(moduleId('src/index.js'), 'mod:src/index.js');
});

test('moduleId with empty string path', () => {
  assert.equal(moduleId(''), 'mod:');
});

test('moduleId with path containing special characters', () => {
  assert.equal(moduleId('a/b/c.js'), 'mod:a/b/c.js');
});

test('moduleId with unicode path', () => {
  assert.equal(moduleId('src/файл.js'), 'mod:src/файл.js');
});

test('moduleId with spaces in path', () => {
  assert.equal(moduleId('my module/file name.js'), 'mod:my module/file name.js');
});

test('moduleId with dot in filename', () => {
  assert.equal(moduleId('src/file.test.mjs'), 'mod:src/file.test.mjs');
});

test('symbolId returns sym:path#name for normal inputs', () => {
  assert.equal(symbolId('src/foo.js', 'bar'), 'sym:src/foo.js#bar');
});

test('symbolId handles path with directory separators', () => {
  assert.equal(symbolId('a/b/c.js', 'fn'), 'sym:a/b/c.js#fn');
});

test('symbolId handles name with special characters', () => {
  assert.equal(symbolId('x.js', 'my-var'), 'sym:x.js#my-var');
});

test('symbolId handles empty name', () => {
  assert.equal(symbolId('x.js', ''), 'sym:x.js#');
});

test('symbolId handles empty path', () => {
  assert.equal(symbolId('', 'name'), 'sym:#name');
});

test('symbolId handles both empty path and name', () => {
  assert.equal(symbolId('', ''), 'sym:#');
});

test('symbolId handles unicode characters', () => {
  assert.equal(symbolId('ünïcode.js', 'fün'), 'sym:ünïcode.js#fün');
});

test('symbolId handles name with hash character', () => {
  assert.equal(symbolId('x.js', 'a#b'), 'sym:x.js#a#b');
});
