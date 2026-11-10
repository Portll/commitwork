// Whether a path resolves to the root itself or somewhere inside it (lib/path-contain.mjs withinRoot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withinRoot } from '../path-contain.mjs';

test('an undefined root is outside even when the path spells the word undefined', () => {
  assert.equal(withinRoot(undefined, '/a/b'), false);
  assert.equal(withinRoot(undefined, 'undefined'), false);
  assert.equal(withinRoot(undefined, 'undefined/x'), false);
});

test('a null root is outside even when the path spells the word null', () => {
  assert.equal(withinRoot(null, '/a/b'), false);
  assert.equal(withinRoot(null, 'null'), false);
  assert.equal(withinRoot(null, 'null/x'), false);
});

test('an undefined path is outside even when the root spells the word undefined', () => {
  assert.equal(withinRoot('/a', undefined), false);
  assert.equal(withinRoot('undefined', undefined), false);
});

test('a null path is outside even when the root spells the word null', () => {
  assert.equal(withinRoot('/a', null), false);
  assert.equal(withinRoot('null', null), false);
});

test('an empty root or an empty path is outside', () => {
  assert.equal(withinRoot('', 'sub'), false);
  assert.equal(withinRoot('', '.'), false);
  assert.equal(withinRoot('', '/a/b'), false);
  assert.equal(withinRoot('sub', ''), false);
  assert.equal(withinRoot('/a', ''), false);
  assert.equal(withinRoot('', ''), false);
});

test('a path equal to the root is inside', () => {
  assert.equal(withinRoot('/a', '/a'), true);
  assert.equal(withinRoot('/a/', '/a'), true);
  assert.equal(withinRoot('proj', 'proj'), true);
});

test('a path below the root is inside, including a name that merely starts with two dots', () => {
  assert.equal(withinRoot('/a', '/a/b'), true);
  assert.equal(withinRoot('/a', '/a/..b'), true);
  assert.equal(withinRoot('proj', 'proj/src/x.js'), true);
});

test('the parent of the root is outside', () => {
  assert.equal(withinRoot('/a/b', '/a'), false);
  assert.equal(withinRoot('proj/src', 'proj'), false);
});

test('a path that climbs out of the root with dot-dot is outside', () => {
  assert.equal(withinRoot('/a', '/a/../b'), false);
  assert.equal(withinRoot('/a', '/b'), false);
  assert.equal(withinRoot('/a', '/a..b'), false);
  assert.equal(withinRoot('proj', 'proj/../other'), false);
});
