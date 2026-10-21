// Validates a five-field cron expression (lib/actions-workflow.mjs isValidCron).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidCron } from '../actions-workflow.mjs';

test('accepts a standard cron expression with all wildcards', () => {
  assert.equal(isValidCron('* * * * *'), true);
});

test('accepts a cron expression with specific numeric values', () => {
  assert.equal(isValidCron('0 12 1 1 1'), true);
});

test('accepts a cron expression with named month and day values', () => {
  assert.equal(isValidCron('0 0 * jan mon'), true);
});

test('accepts a cron expression with a range', () => {
  assert.equal(isValidCron('0 0 1-5 * *'), true);
});

test('accepts a cron expression with a step', () => {
  assert.equal(isValidCron('*/5 * * * *'), true);
});

test('accepts a cron expression with a list of values', () => {
  assert.equal(isValidCron('0,15,30,45 * * * *'), true);
});

test('rejects a cron expression with too few fields', () => {
  assert.equal(isValidCron('* * * *'), false);
});

test('rejects a cron expression with too many fields', () => {
  assert.equal(isValidCron('* * * * * *'), false);
});

test('rejects a cron expression with a value out of range', () => {
  assert.equal(isValidCron('60 * * * *'), false);
});

test('rejects a cron expression with an invalid named value', () => {
  assert.equal(isValidCron('* * * foo *'), false);
});
