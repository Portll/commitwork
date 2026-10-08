// Classifies the self-hosted runner form of a runs-on value (bin/actions-gaps.mjs selfHostedForm).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selfHostedForm } from '../actions-gaps.mjs';

test('returns empty string when runsOn is null', () => {
  assert.equal(selfHostedForm(null, undefined), '');
});

test('returns scalar when runsOn is a scalar with value self-hosted', () => {
  const runsOn = { type: 'scalar', value: 'self-hosted' };
  assert.equal(selfHostedForm(runsOn, undefined), 'scalar');
});

test('returns empty string when runsOn is a scalar with non-self-hosted value', () => {
  const runsOn = { type: 'scalar', value: 'ubuntu-latest' };
  assert.equal(selfHostedForm(runsOn, undefined), '');
});

test('returns matrix when runsOn is an expression and strategy matrix contains self-hosted', () => {
  const runsOn = { type: 'scalar', value: '${{ matrix.os }}' };
  const strategy = { type: 'map', entries: new Map([['matrix', { type: 'seq', items: [{ type: 'scalar', value: 'self-hosted' }] }]]) };
  assert.equal(selfHostedForm(runsOn, strategy), 'matrix');
});

test('returns empty string when runsOn is an expression and strategy matrix does not contain self-hosted', () => {
  const runsOn = { type: 'scalar', value: '${{ matrix.os }}' };
  const strategy = { type: 'map', entries: new Map([['matrix', { type: 'seq', items: [{ type: 'scalar', value: 'ubuntu-latest' }] }]]) };
  assert.equal(selfHostedForm(runsOn, strategy), '');
});

test('returns list when runsOn is a seq containing a self-hosted scalar', () => {
  const runsOn = { type: 'seq', items: [{ type: 'scalar', value: 'ubuntu-latest' }, { type: 'scalar', value: 'self-hosted' }] };
  assert.equal(selfHostedForm(runsOn, undefined), 'list');
});

test('returns empty string when runsOn is a seq with no self-hosted scalar', () => {
  const runsOn = { type: 'seq', items: [{ type: 'scalar', value: 'ubuntu-latest' }, { type: 'scalar', value: 'macos-latest' }] };
  assert.equal(selfHostedForm(runsOn, undefined), '');
});

test('returns labels when runsOn is a map with labels containing self-hosted', () => {
  const runsOn = { type: 'map', entries: new Map([['labels', { type: 'seq', items: [{ type: 'scalar', value: 'self-hosted' }] }]]) };
  assert.equal(selfHostedForm(runsOn, undefined), 'labels');
});

test('returns empty string when runsOn is a map with labels not containing self-hosted', () => {
  const runsOn = { type: 'map', entries: new Map([['labels', { type: 'seq', items: [{ type: 'scalar', value: 'linux' }] }]]) };
  assert.equal(selfHostedForm(runsOn, undefined), '');
});

test('returns empty string when runsOn has an unrecognized type', () => {
  const runsOn = { type: 'unknown', value: 'self-hosted' };
  assert.equal(selfHostedForm(runsOn, undefined), '');
});
