// Resolves house design tokens for light and dark themes plus font stacks (lib/house-css.mjs houseTokenValues).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { houseTokenValues } from '../house-css.mjs';

test('returns an object with light, dark, mono, and sans keys', () => {
  const result = houseTokenValues();
  assert.deepEqual(Object.keys(result).sort(), ['dark', 'light', 'mono', 'sans']);
});

test('light theme contains all house token names as string values', () => {
  const result = houseTokenValues();
  const expectedNames = [
    'bg', 'panel', 'panel2', 'line', 'line2', 'head', 'ink', 'mut', 'dim', 'acc', 'acc2', 'wash',
    'live', 'part', 'plan', 'crit', 'high', 'med', 'low', 'sev', 'sev-fill', 'done', 'done-fill',
    'machine', 'attest', 'on-acc',
  ];
  for (const name of expectedNames) {
    assert.ok(typeof result.light[name] === 'string', `light.${name} should be a string`);
    assert.ok(result.light[name].length > 0, `light.${name} should be non-empty`);
  }
});

test('dark theme contains all house token names as string values', () => {
  const result = houseTokenValues();
  const expectedNames = [
    'bg', 'panel', 'panel2', 'line', 'line2', 'head', 'ink', 'mut', 'dim', 'acc', 'acc2', 'wash',
    'live', 'part', 'plan', 'crit', 'high', 'med', 'low', 'sev', 'sev-fill', 'done', 'done-fill',
    'machine', 'attest', 'on-acc',
  ];
  for (const name of expectedNames) {
    assert.ok(typeof result.dark[name] === 'string', `dark.${name} should be a string`);
    assert.ok(result.dark[name].length > 0, `dark.${name} should be non-empty`);
  }
});

test('light theme live token is non-empty', () => {
  const result = houseTokenValues();
  assert.ok(result.light.live.length > 0);
});

test('light theme done token is non-empty', () => {
  const result = houseTokenValues();
  assert.ok(result.light.done.length > 0);
});

test('light theme done-fill token is non-empty', () => {
  const result = houseTokenValues();
  assert.ok(result.light['done-fill'].length > 0);
});

test('dark theme live token is non-empty', () => {
  const result = houseTokenValues();
  assert.ok(result.dark.live.length > 0);
});

test('dark theme done token is non-empty', () => {
  const result = houseTokenValues();
  assert.ok(result.dark.done.length > 0);
});

test('dark theme done-fill token is non-empty', () => {
  const result = houseTokenValues();
  assert.ok(result.dark['done-fill'].length > 0);
});

test('mono font stack starts with IBM Plex Mono', () => {
  const result = houseTokenValues();
  assert.ok(result.mono.startsWith('"IBM Plex Mono",'));
});

test('sans font stack starts with IBM Plex Sans', () => {
  const result = houseTokenValues();
  assert.ok(result.sans.startsWith('"IBM Plex Sans",'));
});
