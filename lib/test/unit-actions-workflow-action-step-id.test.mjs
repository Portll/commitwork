// Computes the normalized action step identifier from a uses string (lib/actions-workflow.mjs actionStepId).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionStepId } from '../actions-workflow.mjs';

test('returns the image reference for docker protocol uses', () => {
  assert.equal(actionStepId('docker://ghcr.io/actions/checkout'), 'ghcr.io/actions/checkout');
});

test('returns self for relative path uses with forward slash', () => {
  assert.equal(actionStepId('./action.yml'), 'self');
});

test('returns self for relative path uses with backslash', () => {
  assert.equal(actionStepId('.\\action.yml'), 'self');
});

test('returns self for dollar slash path uses', () => {
  assert.equal(actionStepId('$/action.yml'), 'self');
});

test('returns empty string when uses has no version separator', () => {
  assert.equal(actionStepId('actions/checkout'), '');
});

test('returns empty string when uses has multiple version separators', () => {
  assert.equal(actionStepId('actions/checkout@v1@v2'), '');
});

test('returns owner and repo for valid github action reference', () => {
  assert.equal(actionStepId('actions/checkout@v4'), 'actions/checkout');
});

test('returns empty string when path has only one segment', () => {
  assert.equal(actionStepId('actions@v1'), '');
});

test('returns empty string when version part is empty', () => {
  assert.equal(actionStepId('actions/checkout@'), '');
});

test('returns owner and repo for backslash and repeated separators', () => {
  assert.equal(actionStepId('actions\\checkout@v4'), 'actions/checkout');
  assert.equal(actionStepId('actions//checkout@v4'), 'actions/checkout');
});
