// Builds a bare-nudge focus record with optional detail (bin/focus-journal.mjs focusRecord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusRecord } from '../focus-journal.mjs';

test('returns null streak when streak is a string', () => {
  const r = focusRecord({ streak: '5', prompts: null, repo: null, verdict: 'refocus-fired', detail: null });
  assert.deepEqual(r, { verdict: "refocus-fired", signal: "bare-nudge", family: "W", class: null, streak: null, prompts: null, repo: null });
});

test('returns the number when streak is a number', () => {
  const r = focusRecord({ streak: 3, prompts: null, repo: null, verdict: 'refocus-fired', detail: null });
  assert.deepEqual(r, { verdict: "refocus-fired", signal: "bare-nudge", family: "W", class: null, streak: 3, prompts: null, repo: null });
});

test('returns null streak when streak is undefined', () => {
  const r = focusRecord({ streak: undefined, prompts: null, repo: null, verdict: 'refocus-fired', detail: null });
  assert.deepEqual(r, { verdict: "refocus-fired", signal: "bare-nudge", family: "W", class: null, streak: null, prompts: null, repo: null });
});

test('returns null streak when streak is zero', () => {
  const r = focusRecord({ streak: 0, prompts: null, repo: null, verdict: 'refocus-fired', detail: null });
  assert.deepEqual(r, { verdict: "refocus-fired", signal: "bare-nudge", family: "W", class: null, streak: 0, prompts: null, repo: null });
});

test('returns null streak when streak is NaN', () => {
  const r = focusRecord({ streak: NaN, prompts: null, repo: null, verdict: 'refocus-fired', detail: null });
  assert.deepEqual(r, { verdict: "refocus-fired", signal: "bare-nudge", family: "W", class: null, streak: NaN, prompts: null, repo: null });
});

test('returns null streak when streak is Infinity', () => {
  const r = focusRecord({ streak: Infinity, prompts: null, repo: null, verdict: 'refocus-fired', detail: null });
  assert.deepEqual(r, { verdict: "refocus-fired", signal: "bare-nudge", family: "W", class: null, streak: Infinity, prompts: null, repo: null });
});

test('returns null streak when streak is a boolean', () => {
  const r = focusRecord({ streak: true, prompts: null, repo: null, verdict: 'refocus-fired', detail: null });
  assert.deepEqual(r, { verdict: "refocus-fired", signal: "bare-nudge", family: "W", class: null, streak: null, prompts: null, repo: null });
});

test('returns null streak when streak is an object', () => {
  const r = focusRecord({ streak: {}, prompts: null, repo: null, verdict: 'refocus-fired', detail: null });
  assert.deepEqual(r, { verdict: "refocus-fired", signal: "bare-nudge", family: "W", class: null, streak: null, prompts: null, repo: null });
});

test('returns null streak when streak is an array', () => {
  const r = focusRecord({ streak: [1, 2], prompts: null, repo: null, verdict: 'refocus-fired', detail: null });
  assert.deepEqual(r, { verdict: "refocus-fired", signal: "bare-nudge", family: "W", class: null, streak: null, prompts: null, repo: null });
});

test('returns null streak when streak is null', () => {
  const r = focusRecord({ streak: null, prompts: null, repo: null, verdict: 'refocus-fired', detail: null });
  assert.deepEqual(r, { verdict: "refocus-fired", signal: "bare-nudge", family: "W", class: null, streak: null, prompts: null, repo: null });
});
