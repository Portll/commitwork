// bin/test/mobile-manifest-units.test.mjs — case tests for scanTags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanTags } from '../mobile-manifest.mjs';

test('empty string returns empty array', () => {
  assert.deepEqual(scanTags(''), []);
});

test('single self-closing tag', () => {
  const tags = scanTags('<br/>');
  assert.equal(tags.length, 1);
  assert.equal(tags[0].name, 'br');
  assert.equal(tags[0].line, 1);
  assert.equal(tags[0].parent, null);
  assert.deepEqual(tags[0].children, []);
});

test('nested tags with double-quoted attributes', () => {
  const xml = '<root a="1"><child b="2"/></root>';
  const tags = scanTags(xml);
  assert.equal(tags.length, 2);
  assert.equal(tags[0].name, 'root');
  assert.equal(tags[1].name, 'child');
  assert.equal(tags[1].parent, tags[0]);
  assert.deepEqual(tags[0].children, [tags[1]]);
  assert.equal(tags[0].attrs.a, '1');
  assert.equal(tags[1].attrs.b, '2');
});

test('single-quoted attributes', () => {
  const tags = scanTags("<x a='v'/>");
  assert.equal(tags[0].attrs.a, 'v');
});

test('line numbers across newlines', () => {
  const xml = '<a>\n<b/>\n</a>';
  const tags = scanTags(xml);
  assert.equal(tags[0].line, 1);
  assert.equal(tags[1].line, 2);
});

test('namespaced tag names', () => {
  const tags = scanTags('<android:manifest/>');
  assert.equal(tags[0].name, 'android:manifest');
});

test('multiple siblings', () => {
  const tags = scanTags('<r><a/><b/></r>');
  assert.equal(tags[0].children.length, 2);
  assert.equal(tags[0].children[0].name, 'a');
  assert.equal(tags[0].children[1].name, 'b');
});
