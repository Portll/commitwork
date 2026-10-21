// bin/test/model-artefacts-units.test.mjs — case tests for scanKerasConfigText.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanKerasConfigText } from '../model-artefacts.mjs';

test('returns unreadable for non-JSON text', () => {
  const r = scanKerasConfigText('not json');
  assert.equal(r.unreadable, 'config is not JSON');
  assert.deepEqual(r.layers, []);
});

test('returns null unreadable and empty layers for empty JSON object', () => {
  const r = scanKerasConfigText('{}');
  assert.equal(r.unreadable, null);
  assert.deepEqual(r.layers, []);
});

test('returns null unreadable and empty layers for JSON array', () => {
  const r = scanKerasConfigText('[]');
  assert.equal(r.unreadable, null);
  assert.deepEqual(r.layers, []);
});

test('returns null unreadable and empty layers for JSON number', () => {
  const r = scanKerasConfigText('42');
  assert.equal(r.unreadable, null);
  assert.deepEqual(r.layers, []);
});

test('returns null unreadable and empty layers for JSON string', () => {
  const r = scanKerasConfigText('"hello"');
  assert.equal(r.unreadable, null);
  assert.deepEqual(r.layers, []);
});

test('returns null unreadable and empty layers for JSON null', () => {
  const r = scanKerasConfigText('null');
  assert.equal(r.unreadable, null);
  assert.deepEqual(r.layers, []);
});

test('returns null unreadable and empty layers for JSON boolean', () => {
  const r = scanKerasConfigText('true');
  assert.equal(r.unreadable, null);
  assert.deepEqual(r.layers, []);
});

test('returns null unreadable and empty layers for JSON with layers but no Lambda', () => {
  const r = scanKerasConfigText('{"layers":[{"class_name":"Dense"}]}');
  assert.equal(r.unreadable, null);
  assert.deepEqual(r.layers, []);
});
