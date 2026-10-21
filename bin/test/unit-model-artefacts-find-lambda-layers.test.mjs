// Collects sanitised names of all Lambda layers found anywhere in a Keras model config (bin/model-artefacts.mjs findLambdaLayers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLambdaLayers } from '../model-artefacts.mjs';

test('returns empty array for null config', () => {
  assert.deepEqual(findLambdaLayers(null), []);
});

test('returns empty array for non-object config', () => {
  assert.deepEqual(findLambdaLayers(42), []);
  assert.deepEqual(findLambdaLayers('string'), []);
});

test('finds Lambda layer in Sequential model config', () => {
  const config = {
    class_name: 'Sequential',
    config: {
      layers: [
        { class_name: 'Dense', config: { name: 'dense_1' } },
        { class_name: 'Lambda', config: { name: 'my_lambda' } }
      ]
    }
  };
  assert.deepEqual(findLambdaLayers(config), ['my_lambda']);
});

test('finds Lambda layer in Functional model config', () => {
  const config = {
    class_name: 'Functional',
    config: {
      layers: [
        { class_name: 'Input', config: { name: 'input_1' } },
        { class_name: 'Lambda', config: { name: 'transform' } }
      ]
    }
  };
  assert.deepEqual(findLambdaLayers(config), ['transform']);
});

test('finds nested Lambda layer inside nested model', () => {
  const config = {
    class_name: 'Model',
    config: {
      layers: [
        {
          class_name: 'Sequential',
          config: {
            layers: [
              { class_name: 'Lambda', config: { name: 'nested_lambda' } }
            ]
          }
        }
      ]
    }
  };
  assert.deepEqual(findLambdaLayers(config), ['nested_lambda']);
});

test('returns unnamed placeholder when Lambda has no name', () => {
  const config = {
    class_name: 'Sequential',
    config: {
      layers: [
        { class_name: 'Lambda', config: {} }
      ]
    }
  };
  assert.deepEqual(findLambdaLayers(config), ['(unnamed)']);
});

test('returns unnamed placeholder when Lambda config is null', () => {
  const config = {
    class_name: 'Sequential',
    config: {
      layers: [
        { class_name: 'Lambda', config: null }
      ]
    }
  };
  assert.deepEqual(findLambdaLayers(config), ['(unnamed)']);
});

test('sanitises invalid characters in Lambda name', () => {
  const config = {
    class_name: 'Sequential',
    config: {
      layers: [
        { class_name: 'Lambda', config: { name: 'my-lambda@layer!' } }
      ]
    }
  };
  assert.deepEqual(findLambdaLayers(config), ['my-lambda_layer_']);
});

test('truncates Lambda name to 64 characters', () => {
  const longName = 'a'.repeat(100);
  const config = {
    class_name: 'Sequential',
    config: {
      layers: [
        { class_name: 'Lambda', config: { name: longName } }
      ]
    }
  };
  assert.deepEqual(findLambdaLayers(config), ['a'.repeat(64)]);
});

test('finds multiple Lambda layers in order', () => {
  const config = {
    class_name: 'Sequential',
    config: {
      layers: [
        { class_name: 'Lambda', config: { name: 'first' } },
        { class_name: 'Dense', config: { name: 'dense' } },
        { class_name: 'Lambda', config: { name: 'second' } }
      ]
    }
  };
  assert.deepEqual(findLambdaLayers(config), ['first', 'second']);
});
