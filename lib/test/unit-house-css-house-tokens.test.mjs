// Generates the CSS custom property declarations for light and dark themes (lib/house-css.mjs houseTokens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { houseTokens } from '../house-css.mjs';

test('returns a string containing three lines', () => {
  const result = houseTokens();
  assert.equal(typeof result, 'string');
  const lines = result.split('\n');
  assert.equal(lines.length, 3);
});

test('first line starts with :root{ and ends with color-scheme:light}', () => {
  const result = houseTokens();
  const lines = result.split('\n');
  assert.ok(lines[0].startsWith(':root{'));
  assert.ok(lines[0].endsWith('color-scheme:light}'));
});

test('second line starts with html[data-mode=dark]{ and ends with color-scheme:dark}', () => {
  const result = houseTokens();
  const lines = result.split('\n');
  assert.ok(lines[1].startsWith('html[data-mode=dark]{'));
  assert.ok(lines[1].endsWith('color-scheme:dark}'));
});

test('third line starts with @media (prefers-color-scheme:dark){ and ends with color-scheme:dark}', () => {
  const result = houseTokens();
  const lines = result.split('\n');
  assert.ok(lines[2].startsWith('@media (prefers-color-scheme:dark){html:not([data-mode]){'));
  assert.ok(lines[2].endsWith('color-scheme:dark}}'));
});

test('first line contains all house token names as CSS custom properties', () => {
  const result = houseTokens();
  const lines = result.split('\n');
  const tokens = ['bg', 'panel', 'panel2', 'line', 'line2', 'head', 'ink', 'mut', 'dim', 'acc', 'acc2', 'wash', 'live', 'part', 'plan', 'crit', 'high', 'med', 'low', 'sev', 'sev-fill', 'done', 'done-fill', 'machine', 'attest', 'on-acc'];
  for (const t of tokens) {
    assert.ok(lines[0].includes(`--${t}:`), `missing --${t}: in light theme`);
  }
});

test('first line contains CRA clock declarations', () => {
  const result = houseTokens();
  const lines = result.split('\n');
  assert.ok(lines[0].includes('--cra-50:var(--low);'));
  assert.ok(lines[0].includes('--cra-75:var(--med);'));
  assert.ok(lines[0].includes('--cra-90:var(--high);'));
  assert.ok(lines[0].includes('--cra-over:var(--crit)'));
});

test('first line contains mono and sans font declarations', () => {
  const result = houseTokens();
  const lines = result.split('\n');
  assert.ok(lines[0].includes('--mono:'));
  assert.ok(lines[0].includes('--sans:'));
});

test('second line contains all house token names as CSS custom properties', () => {
  const result = houseTokens();
  const lines = result.split('\n');
  const tokens = ['bg', 'panel', 'panel2', 'line', 'line2', 'head', 'ink', 'mut', 'dim', 'acc', 'acc2', 'wash', 'live', 'part', 'plan', 'crit', 'high', 'med', 'low', 'sev', 'sev-fill', 'done', 'done-fill', 'machine', 'attest', 'on-acc'];
  for (const t of tokens) {
    assert.ok(lines[1].includes(`--${t}:`), `missing --${t}: in dark theme`);
  }
});

test('third line contains all house token names as CSS custom properties', () => {
  const result = houseTokens();
  const lines = result.split('\n');
  const tokens = ['bg', 'panel', 'panel2', 'line', 'line2', 'head', 'ink', 'mut', 'dim', 'acc', 'acc2', 'wash', 'live', 'part', 'plan', 'crit', 'high', 'med', 'low', 'sev', 'sev-fill', 'done', 'done-fill', 'machine', 'attest', 'on-acc'];
  for (const t of tokens) {
    assert.ok(lines[2].includes(`--${t}:`), `missing --${t}: in media query dark theme`);
  }
});

test('light and dark theme declarations differ for at least one token', () => {
  const result = houseTokens();
  const lines = result.split('\n');
  const lightDecl = lines[0].slice(6, -18);
  const darkDecl = lines[1].slice(20, -18);
  assert.notEqual(lightDecl, darkDecl);
});
