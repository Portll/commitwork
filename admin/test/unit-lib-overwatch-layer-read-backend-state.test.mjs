// Maps a backend row to its readiness state (admin/lib/overwatch-layer-read.mjs backendState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backendState } from '../lib/overwatch-layer-read.mjs';

test('returns unknown when input is null', () => {
  assert.equal(backendState(null), 'unknown');
});

test('returns unknown when input is undefined', () => {
  assert.equal(backendState(undefined), 'unknown');
});

test('returns unknown when input is a string', () => {
  assert.equal(backendState('local'), 'unknown');
});

test('returns unknown when input is a number', () => {
  assert.equal(backendState(42), 'unknown');
});

test('returns unknown when input is a boolean', () => {
  assert.equal(backendState(true), 'unknown');
});

test('returns not-ready when why property is truthy', () => {
  assert.equal(backendState({ kind: 'local', why: 'pending' }), 'not-ready');
});

test('returns not-ready when why is empty string', () => {
  assert.equal(backendState({ kind: 'local', why: '' }), "declared-unprobed");
});

test('returns declared-unprobed when kind is local and no why', () => {
  assert.equal(backendState({ kind: 'local' }), 'declared-unprobed');
});

test('returns declared when kind is remote and no why', () => {
  assert.equal(backendState({ kind: 'remote' }), 'declared');
});

test('returns declared when kind is missing and no why', () => {
  assert.equal(backendState({}), 'declared');
});
