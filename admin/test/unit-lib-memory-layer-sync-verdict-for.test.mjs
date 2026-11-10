// Computes the sync verdict for a memory-layer point given reachability and probe results (admin/lib/memory-layer-sync.mjs verdictFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdictFor } from '../lib/memory-layer-sync.mjs';

test('returns unverifiable when the memory layer is unreachable', () => {
  const point = { point: 'P1', status: 'wired', note: 'session writer' };
  const result = verdictFor(point, { found: 3, reachable: false });
  assert.deepEqual(result, { verdict: 'unverifiable', why: 'the memory layer could not be reached, or no credential is held here' });
});

test('returns synced when found is greater than zero', () => {
  const point = { point: 'P1', status: 'wired', note: 'session writer' };
  const result = verdictFor(point, { found: 1, reachable: true });
  assert.deepEqual(result, { verdict: 'synced', why: '1 record(s) carry this session' });
});

test('returns synced when found is a large positive number', () => {
  const point = { point: 'P1', status: 'wired', note: 'session writer' };
  const result = verdictFor(point, { found: 100, reachable: true });
  assert.deepEqual(result, { verdict: 'synced', why: '100 record(s) carry this session' });
});

test('returns not-wired when point status is not wired and found is null', () => {
  const point = { point: 'P2', status: 'planned', note: 'no writer yet' };
  const result = verdictFor(point, { found: null, reachable: true });
  assert.deepEqual(result, { verdict: 'not-wired', why: 'P2 is planned \u2014 no writer yet, so an absent record is not a fault of the work' });
});

test('returns not-wired when point status is not wired and found is zero', () => {
  const point = { point: 'P3', status: 'deprecated', note: '' };
  const result = verdictFor(point, { found: 0, reachable: true });
  assert.deepEqual(result, { verdict: 'not-wired', why: 'P3 is deprecated \u2014 no writer produces this point, so an absent record is not a fault of the work' });
});

test('returns unverifiable when point is wired but found is null', () => {
  const point = { point: 'P1', status: 'wired', note: 'session writer' };
  const result = verdictFor(point, { found: null, reachable: true });
  assert.deepEqual(result, { verdict: 'unverifiable', why: 'P1 is wired but was not probed \u2014 no evidence either way was gathered' });
});

test('returns missing when point is wired and found is zero', () => {
  const point = { point: 'P1', status: 'wired', note: 'session writer' };
  const result = verdictFor(point, { found: 0, reachable: true });
  assert.deepEqual(result, { verdict: 'missing', why: 'P1 is wired and no record carries this session' });
});

test('returns not-wired when point status is draft and found is positive', () => {
  const point = { point: 'P4', status: 'draft', note: 'pending' };
  const result = verdictFor(point, { found: 5, reachable: true });
  assert.deepEqual(result, { verdict: 'synced', why: '5 record(s) carry this session' });
});
