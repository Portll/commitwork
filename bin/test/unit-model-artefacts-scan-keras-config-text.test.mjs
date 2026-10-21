// Detects Lambda layer names in a Keras model config JSON string (bin/model-artefacts.mjs scanKerasConfigText).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanKerasConfigText } from '../model-artefacts.mjs';

test('returns unreadable message when input is not valid JSON', () => {
  const result = scanKerasConfigText('not json');
  assert.deepEqual(result, { unreadable: 'config is not JSON', layers: [] });
});

test('returns empty layers array when config has no Lambda layers', () => {
  const text = JSON.stringify({ class_name: 'Sequential', config: { layers: [{ class_name: 'Dense', config: { name: 'dense_1' } }] } });
  const result = scanKerasConfigText(text);
  assert.deepEqual(result, { unreadable: null, layers: [] });
});

test('finds a single named Lambda layer in a Sequential model', () => {
  const text = JSON.stringify({ class_name: 'Sequential', config: { layers: [{ class_name: 'Lambda', config: { name: 'my_lambda' } }] } });
  const result = scanKerasConfigText(text);
  assert.deepEqual(result, { unreadable: null, layers: ['my_lambda'] });
});

test('returns unnamed placeholder when Lambda layer has no name property', () => {
  const text = JSON.stringify({ class_name: 'Sequential', config: { layers: [{ class_name: 'Lambda', config: {} }] } });
  const result = scanKerasConfigText(text);
  assert.deepEqual(result, { unreadable: null, layers: ['(unnamed)'] });
});

test('returns unnamed placeholder when Lambda layer config is null', () => {
  const text = JSON.stringify({ class_name: 'Sequential', config: { layers: [{ class_name: 'Lambda', config: null }] } });
  const result = scanKerasConfigText(text);
  assert.deepEqual(result, { unreadable: null, layers: ['(unnamed)'] });
});

test('sanitises Lambda layer name by replacing invalid characters with underscores', () => {
  const text = JSON.stringify({ class_name: 'Sequential', config: { layers: [{ class_name: 'Lambda', config: { name: 'my-lambda@layer' } }] } });
  const result = scanKerasConfigText(text);
  assert.deepEqual(result, { unreadable: null, layers: ['my-lambda_layer'] });
});

test('finds multiple Lambda layers nested in a Functional model', () => {
  const text = JSON.stringify({
    class_name: 'Functional',
    config: {
      layers: [
        { class_name: 'Lambda', config: { name: 'first' } },
        { class_name: 'Dense', config: { name: 'dense', sublayers: [{ class_name: 'Lambda', config: { name: 'second' } }] } }
      ]
    }
  });
  const result = scanKerasConfigText(text);
  assert.deepEqual(result, { unreadable: null, layers: ['first', 'second'] });
});

test('handles top-level JSON array input with Lambda layers', () => {
  const text = JSON.stringify([{ class_name: 'Lambda', config: { name: 'arr_lambda' } }]);
  const result = scanKerasConfigText(text);
  assert.deepEqual(result, { unreadable: null, layers: ['arr_lambda'] });
});

test('returns empty layers for primitive JSON values', () => {
  const result = scanKerasConfigText('42');
  assert.deepEqual(result, { unreadable: null, layers: [] });
});

test('returns empty layers for JSON null input', () => {
  const result = scanKerasConfigText('null');
  assert.deepEqual(result, { unreadable: null, layers: [] });
});
