// CSS rules for the theme switch control (lib/house-css.mjs houseSwitchCss).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { houseSwitchCss } from '../house-css.mjs';

test('returns a string containing the base .theme-switch rule', () => {
  const css = houseSwitchCss();
  assert.equal(typeof css, 'string');
  assert.ok(css.includes('.theme-switch{display:inline-flex;align-items:stretch;border:1px solid var(--line2);border-radius:.25rem;overflow:hidden;flex:none}'));
});

test('returns a string containing the hidden state rule', () => {
  const css = houseSwitchCss();
  assert.ok(css.includes('.theme-switch[hidden]{display:none}'));
});

test('returns a string containing the theme-opt base rule', () => {
  const css = houseSwitchCss();
  assert.ok(css.includes('.theme-switch .theme-opt{font:600 .6875rem var(--mono);letter-spacing:.04em;color:var(--mut);background:transparent;border:0;border-radius:0;padding:.25rem .5rem;cursor:pointer;white-space:nowrap}'));
});

test('returns a string containing the adjacent sibling border rule', () => {
  const css = houseSwitchCss();
  assert.ok(css.includes('.theme-switch .theme-opt+.theme-opt{border-left:1px solid var(--line2)}'));
});

test('returns a string containing the hover state rule', () => {
  const css = houseSwitchCss();
  assert.ok(css.includes('.theme-switch .theme-opt:hover{color:var(--ink)}'));
});

test('returns a string containing the checked state rule', () => {
  const css = houseSwitchCss();
  assert.ok(css.includes('.theme-switch .theme-opt[aria-checked="true"]{color:var(--ink);background:var(--wash);box-shadow:inset 0 -2px var(--acc)}'));
});

test('joins all six rules with newlines', () => {
  const css = houseSwitchCss();
  const lines = css.split('\n');
  assert.equal(lines.length, 6);
  assert.equal(lines[0], '.theme-switch{display:inline-flex;align-items:stretch;border:1px solid var(--line2);border-radius:.25rem;overflow:hidden;flex:none}');
  assert.equal(lines[1], '.theme-switch[hidden]{display:none}');
  assert.equal(lines[2], '.theme-switch .theme-opt{font:600 .6875rem var(--mono);letter-spacing:.04em;color:var(--mut);background:transparent;border:0;border-radius:0;padding:.25rem .5rem;cursor:pointer;white-space:nowrap}');
  assert.equal(lines[3], '.theme-switch .theme-opt+.theme-opt{border-left:1px solid var(--line2)}');
  assert.equal(lines[4], '.theme-switch .theme-opt:hover{color:var(--ink)}');
  assert.equal(lines[5], '.theme-switch .theme-opt[aria-checked="true"]{color:var(--ink);background:var(--wash);box-shadow:inset 0 -2px var(--acc)}');
});

test('returns the exact same string on repeated calls', () => {
  const first = houseSwitchCss();
  const second = houseSwitchCss();
  assert.equal(first, second);
});
