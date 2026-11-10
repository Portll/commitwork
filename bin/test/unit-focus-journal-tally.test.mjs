// Aggregates verdict records into firing, streak, repo, and class totals (bin/focus-journal.mjs tally).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally } from '../focus-journal.mjs';

test('empty records returns zeroed totals with null lastAt', () => {
  assert.deepEqual(tally([]), { firings: 0, unreadable: 0, other: 0, maxStreak: 0, byRepo: {}, lastAt: null, classified: 0, falseAlarms: 0, abstained: 0, byClass: {} });
});

test('unreadable verdict increments unreadable and skips other fields', () => {
  assert.deepEqual(tally([{ verdict: 'state-unreadable' }]), { firings: 0, unreadable: 1, other: 0, maxStreak: 0, byRepo: {}, lastAt: null, classified: 0, falseAlarms: 0, abstained: 0, byClass: {} });
});

test('non-firing verdict increments other counter', () => {
  assert.deepEqual(tally([{ verdict: 'dismissed' }]), { firings: 0, unreadable: 0, other: 1, maxStreak: 0, byRepo: {}, lastAt: null, classified: 0, falseAlarms: 0, abstained: 0, byClass: {} });
});

test('single firing with streak and repo updates maxStreak and byRepo', () => {
  assert.deepEqual(tally([{ verdict: 'refocus-fired', streak: 5, repo: 'alpha', at: '2024-01-01' }]), { firings: 1, unreadable: 0, other: 0, maxStreak: 5, byRepo: { alpha: 1 }, lastAt: "2024-01-01", classified: 0, falseAlarms: 0, abstained: 0, byClass: {} });
});

test('firing with null repo uses unnamed key in byRepo', () => {
  assert.deepEqual(tally([{ verdict: 'refocus-fired', repo: null, at: '2024-01-01' }]), { firings: 1, unreadable: 0, other: 0, maxStreak: 0, byRepo: { "(unnamed)": 1 }, lastAt: "2024-01-01", classified: 0, falseAlarms: 0, abstained: 0, byClass: {} });
});

test('firing with class none increments falseAlarms when judged is provided', () => {
  assert.deepEqual(tally([{ verdict: 'refocus-fired', class: 'none', at: '2024-01-01' }], { judged: new Map() }), { firings: 1, unreadable: 0, other: 0, maxStreak: 0, byRepo: { "(unnamed)": 1 }, lastAt: "2024-01-01", classified: 0, falseAlarms: 1, abstained: 0, byClass: {} });
});

test('firing with class none does not increment falseAlarms when judged is null', () => {
  assert.deepEqual(tally([{ verdict: 'refocus-fired', class: 'none', at: '2024-01-01' }], { judged: null }), { firings: 1, unreadable: 0, other: 0, maxStreak: 0, byRepo: { "(unnamed)": 1 }, lastAt: "2024-01-01", classified: null, falseAlarms: null, abstained: 0, byClass: {} });
});

test('firing with class from record increments classified and byClass', () => {
  assert.deepEqual(tally([{ verdict: 'refocus-fired', class: 'w1', at: '2024-01-01' }], { judged: new Map() }), { firings: 1, unreadable: 0, other: 0, maxStreak: 0, byRepo: { "(unnamed)": 1 }, lastAt: "2024-01-01", classified: 1, falseAlarms: 0, abstained: 0, byClass: { w1: 1 } });
});

test('firing with class from judged map increments classified and byClass', () => {
  assert.deepEqual(tally([{ verdict: 'refocus-fired', at: '2024-01-01' }], { judged: new Map([['2024-01-01', 'w2']]) }), { firings: 1, unreadable: 0, other: 0, maxStreak: 0, byRepo: { "(unnamed)": 1 }, lastAt: "2024-01-01", classified: 1, falseAlarms: 0, abstained: 0, byClass: { w2: 1 } });
});

test('firing with no class and abstained at increments abstained', () => {
  assert.deepEqual(tally([{ verdict: 'refocus-fired', at: '2024-01-01' }], { judged: new Map(), abstained: new Set(['2024-01-01']) }), { firings: 1, unreadable: 0, other: 0, maxStreak: 0, byRepo: { "(unnamed)": 1 }, lastAt: "2024-01-01", classified: 0, falseAlarms: 0, abstained: 1, byClass: {} });
});

test('firing with no class and not abstained increments none of classified falseAlarms or abstained', () => {
  assert.deepEqual(tally([{ verdict: 'refocus-fired', at: '2024-01-01' }], { judged: new Map(), abstained: new Set() }), { firings: 1, unreadable: 0, other: 0, maxStreak: 0, byRepo: { "(unnamed)": 1 }, lastAt: "2024-01-01", classified: 0, falseAlarms: 0, abstained: 0, byClass: {} });
});

test('multiple firings track lastAt as the lexicographically greatest at', () => {
  assert.deepEqual(tally([
    { verdict: 'refocus-fired', at: '2024-01-01' },
    { verdict: 'refocus-fired', at: '2024-01-02' },
    { verdict: 'refocus-fired', at: '2024-01-01' }
  ]), { firings: 3, unreadable: 0, other: 0, maxStreak: 0, byRepo: { "(unnamed)": 3 }, lastAt: "2024-01-02", classified: 0, falseAlarms: 0, abstained: 0, byClass: {} });
});

test('equal at values keep the first occurrence as lastAt', () => {
  assert.deepEqual(tally([
    { verdict: 'refocus-fired', at: '2024-01-01' },
    { verdict: 'refocus-fired', at: '2024-01-01' }
  ]), { firings: 2, unreadable: 0, other: 0, maxStreak: 0, byRepo: { "(unnamed)": 2 }, lastAt: "2024-01-01", classified: 0, falseAlarms: 0, abstained: 0, byClass: {} });
});

test('non-number streak does not update maxStreak', () => {
  assert.deepEqual(tally([{ verdict: 'refocus-fired', streak: 'high', at: '2024-01-01' }]), { firings: 1, unreadable: 0, other: 0, maxStreak: 0, byRepo: { "(unnamed)": 1 }, lastAt: "2024-01-01", classified: 0, falseAlarms: 0, abstained: 0, byClass: {} });
});

test('negative streak does not update maxStreak', () => {
  assert.deepEqual(tally([{ verdict: 'refocus-fired', streak: -3, at: '2024-01-01' }]), { firings: 1, unreadable: 0, other: 0, maxStreak: 0, byRepo: { "(unnamed)": 1 }, lastAt: "2024-01-01", classified: 0, falseAlarms: 0, abstained: 0, byClass: {} });
});

test('zero streak does not update maxStreak', () => {
  assert.deepEqual(tally([{ verdict: 'refocus-fired', streak: 0, at: '2024-01-01' }]), { firings: 1, unreadable: 0, other: 0, maxStreak: 0, byRepo: { "(unnamed)": 1 }, lastAt: "2024-01-01", classified: 0, falseAlarms: 0, abstained: 0, byClass: {} });
});

test('judged null makes classified and falseAlarms null in output', () => {
  assert.deepEqual(tally([{ verdict: 'refocus-fired', class: 'w1', at: '2024-01-01' }], { judged: null }), { firings: 1, unreadable: 0, other: 0, maxStreak: 0, byRepo: { "(unnamed)": 1 }, lastAt: "2024-01-01", classified: null, falseAlarms: null, abstained: 0, byClass: {} });
});

test('abstained null makes abstained count null in output', () => {
  assert.deepEqual(tally([{ verdict: 'refocus-fired', at: '2024-01-01' }], { judged: new Map(), abstained: null }), { firings: 1, unreadable: 0, other: 0, maxStreak: 0, byRepo: { "(unnamed)": 1 }, lastAt: "2024-01-01", classified: 0, falseAlarms: 0, abstained: null, byClass: {} });
});

test('multiple repos accumulate counts in byRepo', () => {
  assert.deepEqual(tally([
    { verdict: 'refocus-fired', repo: 'alpha', at: '2024-01-01' },
    { verdict: 'refocus-fired', repo: 'alpha', at: '2024-01-02' },
    { verdict: 'refocus-fired', repo: 'beta', at: '2024-01-03' }
  ]), { firings: 3, unreadable: 0, other: 0, maxStreak: 0, byRepo: { alpha: 2, beta: 1 }, lastAt: "2024-01-03", classified: 0, falseAlarms: 0, abstained: 0, byClass: {} });
});

test('multiple classes accumulate counts in byClass', () => {
  assert.deepEqual(tally([
    { verdict: 'refocus-fired', class: 'w1', at: '2024-01-01' },
    { verdict: 'refocus-fired', class: 'w1', at: '2024-01-02' },
    { verdict: 'refocus-fired', class: 'w2', at: '2024-01-03' }
  ], { judged: new Map() }), { firings: 3, unreadable: 0, other: 0, maxStreak: 0, byRepo: { "(unnamed)": 3 }, lastAt: "2024-01-03", classified: 3, falseAlarms: 0, abstained: 0, byClass: { w1: 2, w2: 1 } });
});

test('maxStreak tracks the largest streak across multiple firings', () => {
  assert.deepEqual(tally([
    { verdict: 'refocus-fired', streak: 3, at: '2024-01-01' },
    { verdict: 'refocus-fired', streak: 7, at: '2024-01-02' },
    { verdict: 'refocus-fired', streak: 5, at: '2024-01-03' }
  ]), { firings: 3, unreadable: 0, other: 0, maxStreak: 7, byRepo: { "(unnamed)": 3 }, lastAt: "2024-01-03", classified: 0, falseAlarms: 0, abstained: 0, byClass: {} });
});

test('record class takes precedence over judged map entry', () => {
  assert.deepEqual(tally([{ verdict: 'refocus-fired', class: 'w1', at: '2024-01-01' }], { judged: new Map([['2024-01-01', 'w2']]) }), { firings: 1, unreadable: 0, other: 0, maxStreak: 0, byRepo: { "(unnamed)": 1 }, lastAt: "2024-01-01", classified: 1, falseAlarms: 0, abstained: 0, byClass: { w1: 1 } });
});

test('mixed verdicts aggregate all counters correctly', () => {
  assert.deepEqual(tally([
    { verdict: 'state-unreadable' },
    { verdict: 'dismissed' },
    { verdict: 'refocus-fired', streak: 2, repo: 'alpha', class: 'w1', at: '2024-01-01' },
    { verdict: 'refocus-fired', streak: 4, repo: 'beta', class: 'none', at: '2024-01-02' }
  ], { judged: new Map() }), { firings: 2, unreadable: 1, other: 1, maxStreak: 4, byRepo: { alpha: 1, beta: 1 }, lastAt: "2024-01-02", classified: 1, falseAlarms: 1, abstained: 0, byClass: { w1: 1 } });
});
