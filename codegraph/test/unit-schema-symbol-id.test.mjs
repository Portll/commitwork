// Builds the symbol id string sym:<path>#<name> (codegraph/schema.mjs symbolId).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symbolId } from '../schema.mjs';

test('a simple path and name are joined with the sym prefix and a hash', () => {
  assert.equal(symbolId('src/file.js', 'myFunc'), 'sym:src/file.js#myFunc');
});

test('an empty path leaves nothing between the prefix and the hash', () => {
  assert.equal(symbolId('', 'root'), 'sym:#root');
});

test('an empty name leaves the id ending in a hash', () => {
  assert.equal(symbolId('lib/module', ''), 'sym:lib/module#');
});

test('an empty path and an empty name give just the prefix and the hash', () => {
  assert.equal(symbolId('', ''), 'sym:#');
});

test('a long repeated path is kept whole in the id', () => {
  const longPath = 'a/'.repeat(1000);
  assert.equal(symbolId(longPath, 'deep'), 'sym:' + longPath + '#deep');
});

test('a long repeated name is kept whole in the id', () => {
  const longName = 'n'.repeat(2000);
  assert.equal(symbolId('path/to/file', longName), 'sym:path/to/file#' + longName);
});

test('non-ASCII characters in path and name pass through unchanged', () => {
  assert.equal(
    symbolId('src/\ud83d\udca1/file.js', 'func-\ud83d\ude80'),
    'sym:src/\ud83d\udca1/file.js#func-\ud83d\ude80'
  );
});

test('a hash in the path and a colon in the name are not escaped', () => {
  assert.equal(symbolId('path#section', 'name:detail'), 'sym:path#section#name:detail');
});

test('numbers, null and undefined are converted to their string forms', () => {
  assert.equal(symbolId(123, 456), 'sym:123#456');
  assert.equal(symbolId(null, undefined), 'sym:null#undefined');
});

test('arrays and objects with toString are stringified into the id', () => {
  assert.equal(symbolId(['a', 'b'], { toString() { return 'n'; } }), 'sym:a,b#n');
});
