// Per-PR states after recording merged and closed outcomes in the ledger (monitor/draft-pr-ledger.mjs reconcilePrOutcomes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePrOutcomes } from '../draft-pr-ledger.mjs';

const AT = '2026-03-04T05:06:07.000Z';
const WHEN = '2026-03-03T01:02:03.000Z';
const URL_A = 'https://github.com/acme/app/pull/7';
const BASE = { url: URL_A, advisory: 'GHSA-1234', package: 'lodash', upstream: 'acme/app' };
const FIX = { fixType: 'manual', notes: 'patched by hand' };

function prEventTypes() {
  const real = Array.prototype.includes;
  let types = [];
  Array.prototype.includes = function includes(value, from) {
    types = [...this];
    return real.call(this, value, from);
  };
  try {
    reconcilePrOutcomes({ issues: {}, events: [{ type: 'probe' }] }, { view: () => null, at: AT });
  } finally {
    Array.prototype.includes = real;
  }
  return types;
}

const openedEvent = (type, url = URL_A) => ({ type, issueId: 'i1', at: AT, data: { ...BASE, url } });
const run = (doc, v) => reconcilePrOutcomes(doc, { view: () => v, at: AT });
const OPENED = prEventTypes().find((type) => run(
  { issues: { i1: { fix: { ...FIX } } }, events: [openedEvent(type)] },
  { state: 'OPEN' },
).length === 1);
const ledger = (fix = null) => ({ issues: { i1: { fix } }, events: [openedEvent(OPENED)] });
const row = (state, url = URL_A) => ({ url, issueId: 'i1', state });
const outcome = (doc, ...keys) => Object.fromEntries(
  [...Object.keys(BASE), ...keys].map((k) => [k, doc.events[1].data[k]]),
);

test('a ledger with no events returns an empty list without calling the view', () => {
  const calls = [];
  const view = (url) => { calls.push(url); return null; };
  assert.deepEqual(reconcilePrOutcomes({ issues: {}, events: [] }, { view, at: AT }), []);
  assert.deepEqual(calls, []);
});

test('opened events without a url are skipped', () => {
  const events = [{ type: OPENED, issueId: 'i1', data: { advisory: 'GHSA-1234' } }, { type: OPENED, issueId: 'i1' }];
  const doc = { issues: { i1: { fix: null } }, events };
  assert.deepEqual(run(doc, { state: 'MERGED' }), []);
  assert.equal(doc.events.length, 2);
});

test('a pull request the view cannot read is reported unreadable and the ledger is unchanged', () => {
  const doc = ledger();
  const calls = [];
  const view = (url) => { calls.push(url); return null; };
  assert.deepEqual(reconcilePrOutcomes(doc, { view, at: AT }), [row('unreadable')]);
  assert.deepEqual(calls, [URL_A]);
  assert.equal(doc.events.length, 1);
  assert.equal(doc.issues.i1.fix, null);
});

test('a view result without a state is reported unreadable', () => {
  const doc = ledger();
  assert.deepEqual(run(doc, { mergedAt: WHEN }), [row('unreadable')]);
  assert.equal(doc.events.length, 1);
});

test('a pull request still open keeps its state, stays open and leaves the ledger unchanged', () => {
  const doc = ledger();
  assert.deepEqual(run(doc, { state: 'OPEN' }), [row('OPEN')]);
  assert.equal(doc.events.length, 1);
  assert.equal(doc.issues.i1.fix, null);
  assert.deepEqual(run(doc, { state: 'OPEN' }), [row('OPEN')]);
});

test('a closed pull request appends its outcome with closedAt and is no longer open', () => {
  const doc = ledger();
  assert.deepEqual(run(doc, { state: 'CLOSED', closedAt: WHEN }), [row('CLOSED')]);
  assert.equal(doc.events.length, 2);
  assert.equal(doc.events[1].issueId, 'i1');
  assert.deepEqual(outcome(doc, 'closedAt'), { ...BASE, closedAt: WHEN });
  assert.equal(doc.issues.i1.fix, null);
  assert.deepEqual(run(doc, { state: 'CLOSED', closedAt: WHEN }), []);
});

test('a closed pull request without closedAt records null', () => {
  const doc = ledger();
  assert.deepEqual(run(doc, { state: 'CLOSED' }), [row('CLOSED')]);
  assert.deepEqual(outcome(doc, 'closedAt'), { ...BASE, closedAt: null });
});

test('a merged pull request on an issue with a fix appends its outcome and keeps that fix', () => {
  const doc = ledger({ ...FIX });
  const merged = { state: 'MERGED', mergedAt: WHEN, mergedBy: 'alice' };
  assert.deepEqual(run(doc, merged), [row('MERGED')]);
  assert.equal(doc.events.length, 2);
  assert.equal(doc.events[1].issueId, 'i1');
  assert.deepEqual(outcome(doc, 'mergedAt', 'mergedBy'), { ...BASE, mergedAt: WHEN, mergedBy: 'alice' });
  assert.deepEqual(doc.issues.i1.fix, FIX);
  assert.deepEqual(run(doc, merged), []);
});

test('a merged pull request without merge details records null for both', () => {
  const doc = ledger({ ...FIX });
  assert.deepEqual(run(doc, { state: 'MERGED' }), [row('MERGED')]);
  assert.deepEqual(outcome(doc, 'mergedAt', 'mergedBy'), { ...BASE, mergedAt: null, mergedBy: null });
  assert.deepEqual(doc.issues.i1.fix, FIX);
});

test('every open pull request is reported in ledger order and only finished ones leave the open list', () => {
  const urls = Array.from({ length: 3 }, (_, i) => `https://github.com/acme/app/pull/${i + 1}`);
  const views = new Map([[urls[0], { state: 'OPEN' }], [urls[1], { state: 'CLOSED' }], [urls[2], { state: 'MERGED' }]]);
  const doc = { issues: { i1: { fix: { ...FIX } } }, events: urls.map((url) => openedEvent(OPENED, url)) };
  const view = (url) => views.get(url);
  assert.deepEqual(reconcilePrOutcomes(doc, { view, at: AT }), [
    row('OPEN', urls[0]),
    row('CLOSED', urls[1]),
    row('MERGED', urls[2]),
  ]);
  assert.equal(doc.events.length, 5);
  assert.deepEqual(reconcilePrOutcomes(doc, { view, at: AT }), [row('OPEN', urls[0])]);
});
