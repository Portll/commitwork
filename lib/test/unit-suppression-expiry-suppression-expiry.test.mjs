// categorises suppressions by active, expiring soon, expired or undated (lib/suppression-expiry.mjs suppressionExpiry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suppressionExpiry } from '../suppression-expiry.mjs';

test('throws TypeError when suppressions is not an array', () => {
  const input = { suppressions: null, now: '2023-01-01T00:00:00Z' };
  assert.throws(() => suppressionExpiry(input), { name: 'TypeError', message: 'suppressions must be an array' });
});

test('throws TypeError when windowDays is zero', () => {
  const input = { suppressions: [], now: '2023-01-01T00:00:00Z', windowDays: 0 };
  assert.throws(() => suppressionExpiry(input), { name: 'TypeError', message: 'windowDays must be a positive integer' });
});

test('throws TypeError when windowDays is not an integer', () => {
  const input = { suppressions: [], now: '2023-01-01T00:00:00Z', windowDays: 0.5 };
  assert.throws(() => suppressionExpiry(input), { name: 'TypeError', message: 'windowDays must be a positive integer' });
});

test('throws TypeError when a suppression entry is null', () => {
  const input = { suppressions: [null], now: '2023-01-01T00:00:00Z' };
  assert.throws(() => suppressionExpiry(input), { name: 'TypeError', message: 'suppressions[0] must be an object' });
});

test('throws TypeError when a suppression entry is a primitive', () => {
  const input = { suppressions: [42], now: '2023-01-01T00:00:00Z' };
  assert.throws(() => suppressionExpiry(input), { name: 'TypeError', message: 'suppressions[0] must be an object' });
});

test('places suppression with missing expiresAt into undated', () => {
  const sup = {
    repo: 'r', file: 'f', rule: 'rule', reason: 'reason',
    createdAt: '2023-01-01T00:00:00Z'
  };
  const input = { suppressions: [sup], now: '2023-01-01T00:00:00Z' };
  const result = suppressionExpiry(input);
  const expected = {
    active: [], expiringSoon: [], expired: [],
    undated: [{
      repo: 'r', file: 'f', rule: 'rule', package: null, reason: 'reason',
      createdAt: '2023-01-01T00:00:00Z', expiresAt: null
    }]
  };
  assert.deepEqual(result, expected);
});

test('throws RangeError when expiresAt is before createdAt', () => {
  const sup = {
    repo: 'r', file: 'f', rule: 'rule', reason: 'reason',
    createdAt: '2023-01-10T00:00:00Z',
    expiresAt: '2023-01-01T00:00:00Z'
  };
  const input = { suppressions: [sup], now: '2023-01-01T00:00:00Z' };
  assert.throws(() => suppressionExpiry(input), { name: 'RangeError', message: 'suppressions[0].expiresAt is before createdAt' });
});

test('classifies suppression expiring exactly at now as expired', () => {
  const sup = {
    repo: 'r', file: 'f', rule: 'rule', reason: 'reason',
    createdAt: '2022-12-31T00:00:00Z',
    expiresAt: '2023-01-01T00:00:00Z'
  };
  const input = { suppressions: [sup], now: '2023-01-01T00:00:00Z' };
  const result = suppressionExpiry(input);
  const expected = {
    active: [], expiringSoon: [], undated: [],
    expired: [{
      repo: 'r', file: 'f', rule: 'rule', package: null, reason: 'reason',
      createdAt: '2022-12-31T00:00:00Z', expiresAt: '2023-01-01T00:00:00Z'
    }]
  };
  assert.deepEqual(result, expected);
});

test('classifies suppression expiring exactly at horizon as expiringSoon', () => {
  const now = '2023-01-01T00:00:00Z';
  const horizon = '2023-01-15T00:00:00Z';
  const sup = {
    repo: 'r', file: 'f', rule: 'rule', reason: 'reason',
    createdAt: '2022-12-01T00:00:00Z',
    expiresAt: horizon
  };
  const input = { suppressions: [sup], now };
  const result = suppressionExpiry(input);
  const expected = {
    active: [], expired: [], undated: [],
    expiringSoon: [{
      repo: 'r', file: 'f', rule: 'rule', package: null, reason: 'reason',
      createdAt: '2022-12-01T00:00:00Z', expiresAt: horizon
    }]
  };
  assert.deepEqual(result, expected);
});

test('classifies suppression expiring after horizon as active', () => {
  const now = '2023-01-01T00:00:00Z';
  const afterHorizon = '2023-01-16T00:00:00Z';
  const sup = {
    repo: 'r', file: 'f', rule: 'rule', reason: 'reason',
    createdAt: '2022-12-01T00:00:00Z',
    expiresAt: afterHorizon
  };
  const input = { suppressions: [sup], now };
  const result = suppressionExpiry(input);
  const expected = {
    expiringSoon: [], expired: [], undated: [],
    active: [{
      repo: 'r', file: 'f', rule: 'rule', package: null, reason: 'reason',
      createdAt: '2022-12-01T00:00:00Z', expiresAt: afterHorizon
    }]
  };
  assert.deepEqual(result, expected);
});
