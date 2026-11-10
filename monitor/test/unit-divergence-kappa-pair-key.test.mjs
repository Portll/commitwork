// computes a combined engine identifier string when both sides have provider and model (monitor/divergence-kappa.mjs pairKey)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairKey } from '../divergence-kappa.mjs';

test('both sides provide provider and model, returns combined string', () => {
  const local = { answeredBy: { provider: 'p1', model: 'm1' } };
  const opus = { engine: { provider: 'p2', model: 'm2' } };
  const r = pairKey(local, opus);
  assert.equal(r, "p1:m1 \u00d7 p2:m2");
});

test('left side provides provider and model, right side missing, returns null', () => {
  const local = { answeredBy: { provider: 'p1', model: 'm1' } };
  const opus = {};
  const r = pairKey(local, opus);
  assert.equal(r, null);
});

test('right side provides provider and model, left side missing, returns null', () => {
  const local = {};
  const opus = { engine: { provider: 'p2', model: 'm2' } };
  const r = pairKey(local, opus);
  assert.equal(r, null);
});

test('both sides missing provider/model information, returns null', () => {
  const local = {};
  const opus = {};
  const r = pairKey(local, opus);
  assert.equal(r, null);
});

test('left side has provider but no model, right side has both, returns null', () => {
  const local = { answeredBy: { provider: 'p3' } };
  const opus = { engine: { provider: 'p2', model: 'm2' } };
  const r = pairKey(local, opus);
  assert.equal(r, null);
});

test('right side has model but no provider, left side has both, returns null', () => {
  const local = { answeredBy: { provider: 'p1', model: 'm1' } };
  const opus = { engine: { model: 'm4' } };
  const r = pairKey(local, opus);
  assert.equal(r, null);
});

test('both sides are null, returns null', () => {
  const r = pairKey(null, null);
  assert.equal(r, null);
});

test('both sides are undefined, returns null', () => {
  const r = pairKey(undefined, undefined);
  assert.equal(r, null);
});
