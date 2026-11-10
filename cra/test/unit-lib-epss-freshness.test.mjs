// EPSS freshness state and reason (cra/lib.mjs epssFreshness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epssFreshness } from '../lib.mjs';

test('returns state unknown', () => {
  const r = epssFreshness();
  assert.equal(r.state, "unknown");
});

test('returns reason about flat map', () => {
  const r = epssFreshness();
  assert.equal(r.reason, "monitor/data/epss.json is a flat {cveId: score} map with no version/date field of its own to measure freshness from");
});

test('returns object with exactly two keys', () => {
  const r = epssFreshness();
  assert.deepEqual(Object.keys(r).sort(), ["reason", "state"]);
});

test('state is a string', () => {
  const r = epssFreshness();
  assert.equal(typeof r.state, "string");
});

test('reason is a string', () => {
  const r = epssFreshness();
  assert.equal(typeof r.reason, "string");
});

test('state value is unknown', () => {
  const r = epssFreshness();
  assert.equal(r.state, "unknown");
});

test('reason mentions epss.json', () => {
  const r = epssFreshness();
  assert.equal(r.reason.includes('epss.json'), true);
});

test('reason mentions flat map', () => {
  const r = epssFreshness();
  assert.equal(r.reason.includes('flat'), true);
});

test('reason mentions no version field', () => {
  const r = epssFreshness();
  assert.equal(r.reason.includes('no version'), true);
});

test('result is not null or undefined', () => {
  const r = epssFreshness();
  assert.equal(r === null, false);
});
