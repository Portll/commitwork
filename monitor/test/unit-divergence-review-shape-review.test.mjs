// Validated review with its blind label resolved to an analyst (monitor/divergence-review.mjs shapeReview).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeReview } from '../divergence-review.mjs';

const schema = {
  required: ['betterSupported', 'why', 'disagreementSource', 'promptSchemaIssue', 'suggestedClarification'],
  properties: {
    betterSupported: { enum: ['analyst-a', 'analyst-b', 'tie'] },
    why: {},
    disagreementSource: { enum: ['prompt', 'evidence'] },
    promptSchemaIssue: {},
    suggestedClarification: {},
  },
};

const review = (over = {}) => ({
  betterSupported: 'analyst-a',
  why: 'w',
  disagreementSource: 'prompt',
  promptSchemaIssue: 'p',
  suggestedClarification: 's',
  ...over,
});

test('a review labelled analyst-a resolves to the local analyst and keeps the blind label', () => {
  assert.deepEqual(shapeReview(review(), schema), {
    betterSupported: 'local',
    betterSupportedLabel: 'analyst-a',
    why: 'w',
    disagreementSource: 'prompt',
    promptSchemaIssue: 'p',
    suggestedClarification: 's',
  });
});

test('a review labelled analyst-b resolves to the opus analyst', () => {
  assert.deepEqual(shapeReview(review({ betterSupported: 'analyst-b', disagreementSource: 'evidence' }), schema), {
    betterSupported: 'opus',
    betterSupportedLabel: 'analyst-b',
    why: 'w',
    disagreementSource: 'evidence',
    promptSchemaIssue: 'p',
    suggestedClarification: 's',
  });
});

test('a label the blind map does not know passes through unchanged', () => {
  assert.deepEqual(shapeReview(review({ betterSupported: 'tie' }), schema), {
    betterSupported: 'tie',
    betterSupportedLabel: 'tie',
    why: 'w',
    disagreementSource: 'prompt',
    promptSchemaIssue: 'p',
    suggestedClarification: 's',
  });
});

test('falsy inputs return null', () => {
  assert.equal(shapeReview(null, schema), null);
  assert.equal(shapeReview(undefined, schema), null);
  assert.equal(shapeReview(0, schema), null);
  assert.equal(shapeReview('', schema), null);
});

test('truthy values that are not objects return null', () => {
  assert.equal(shapeReview('hello', schema), null);
  assert.equal(shapeReview(42, schema), null);
  assert.equal(shapeReview(true, schema), null);
  assert.equal(shapeReview(Object.assign(() => {}, review()), schema), null);
});

test('an array carrying every required field returns null', () => {
  assert.equal(shapeReview(Object.assign([], review()), schema), null);
});

test('a required field that is not a string returns null', () => {
  const missing = review();
  delete missing.suggestedClarification;
  assert.equal(shapeReview(review({ why: 42 }), schema), null);
  assert.equal(shapeReview(review({ why: null }), schema), null);
  assert.equal(shapeReview(missing, schema), null);
});

test('a value outside a field enum returns null', () => {
  assert.equal(shapeReview(review({ betterSupported: 'analyst-z' }), schema), null);
  assert.equal(shapeReview(review({ betterSupported: 'ANALYST-A' }), schema), null);
  assert.equal(shapeReview(review({ disagreementSource: 'other' }), schema), null);
});

test('a field with no enum accepts an empty string', () => {
  assert.deepEqual(shapeReview(review({ why: '' }), schema), {
    betterSupported: 'local',
    betterSupportedLabel: 'analyst-a',
    why: '',
    disagreementSource: 'prompt',
    promptSchemaIssue: 'p',
    suggestedClarification: 's',
  });
});

test('extra properties are dropped and fields the schema does not require come back undefined', () => {
  const narrow = { required: ['betterSupported'], properties: { betterSupported: {} } };
  assert.deepEqual(shapeReview({ betterSupported: 'analyst-b', extra: 'x' }, narrow), {
    betterSupported: 'opus',
    betterSupportedLabel: 'analyst-b',
    why: undefined,
    disagreementSource: undefined,
    promptSchemaIssue: undefined,
    suggestedClarification: undefined,
  });
});
