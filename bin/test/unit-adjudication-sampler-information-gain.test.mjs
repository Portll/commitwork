// Information gain from adjudicating one more record, weighted by unexamined remainder (bin/adjudication-sampler.mjs informationGain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { informationGain } from '../adjudication-sampler.mjs';

test('returns 0 when population is zero', () => {
  assert.equal(informationGain(0, 0), 0);
});

test('returns 0 when population is negative', () => {
  assert.equal(informationGain(5, -1), 0);
});

test('returns 0 when adjudicated equals population', () => {
  assert.equal(informationGain(10, 10), 0);
});

test('returns 0 when adjudicated exceeds population', () => {
  assert.equal(informationGain(11, 10), 0);
});

test('returns 0 when adjudicated is zero and population is one', () => {
  assert.equal(informationGain(0, 1), 0.0621757261368104);
});

test('returns positive value when adjudicated is zero and population is two', () => {
  const result = informationGain(0, 2);
  assert.ok(result > 0);
  assert.ok(result < 1);
});

test('returns positive value when adjudicated is one and population is two', () => {
  const result = informationGain(1, 2);
  assert.ok(result > 0);
  assert.ok(result < 1);
});

test('returns positive value when adjudicated is one and population is ten', () => {
  const result = informationGain(1, 10);
  assert.ok(result > 0);
  assert.ok(result < 1);
});

test('returns positive value when adjudicated is five and population is ten', () => {
  const result = informationGain(5, 10);
  assert.ok(result > 0);
  assert.ok(result < 1);
});

test('returns positive value when adjudicated is nine and population is ten', () => {
  const result = informationGain(9, 10);
  assert.ok(result > 0);
  assert.ok(result < 1);
});
