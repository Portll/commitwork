// bin/test/bare-catch-ratchet-units.test.mjs — case tests for rekeyPlan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rekeyPlan } from '../bare-catch-ratchet.mjs';

test('rejects when from and to are the same path', () => {
  const current = { 'a.js::s': 1 };
  const doc = { keys: { 'a.js::s': 1 }, critical: [] };
  const r = rekeyPlan(current, doc, 'a.js', 'a.js');
  assert.equal(r.ok, false);
  assert.match(r.why, /two different paths/);
});

test('rejects when from is empty', () => {
  const current = { 'b.js::s': 1 };
  const doc = { keys: { 'b.js::s': 1 }, critical: [] };
  const r = rekeyPlan(current, doc, '', 'b.js');
  assert.equal(r.ok, false);
  assert.match(r.why, /two different paths/);
});

test('rejects when to is empty', () => {
  const current = { 'a.js::s': 1 };
  const doc = { keys: { 'a.js::s': 1 }, critical: [] };
  const r = rekeyPlan(current, doc, 'a.js', '');
  assert.equal(r.ok, false);
  assert.match(r.why, /two different paths/);
});

test('rejects when nothing to rekey (no matching baseline keys)', () => {
  const current = { 'b.js::s': 1 };
  const doc = { keys: { 'c.js::s': 1 }, critical: [] };
  const r = rekeyPlan(current, doc, 'a.js', 'b.js');
  assert.equal(r.ok, false);
  assert.match(r.why, /nothing to rekey/);
});

test('rejects when scope exists under both src and dst in current', () => {
  const current = { 'a.js::s': 1, 'b.js::s': 1 };
  const doc = { keys: { 'a.js::s': 1 }, critical: [] };
  const r = rekeyPlan(current, doc, 'a.js', 'b.js');
  assert.equal(r.ok, false);
  assert.match(r.why, /present under BOTH/);
});

test('rejects when baseline already holds dst keys for the scope', () => {
  const current = { 'b.js::s': 1 };
  const doc = { keys: { 'a.js::s': 1, 'b.js::s': 2 }, critical: [] };
  const r = rekeyPlan(current, doc, 'a.js', 'b.js');
  assert.equal(r.ok, false);
  assert.match(r.why, /already holds/);
});

test('succeeds and moves a key from src to dst', () => {
  const current = { 'b.js::s': 1 };
  const doc = { keys: { 'a.js::s': 3 }, critical: [] };
  const r = rekeyPlan(current, doc, 'a.js', 'b.js');
  assert.equal(r.ok, true);
  assert.equal(r.from, 'a.js');
  assert.equal(r.to, 'b.js');
  assert.deepEqual(r.moves, [{ scope: 's', count: 3 }]);
  assert.equal(r.keys['a.js::s'], undefined);
  assert.equal(r.keys['b.js::s'], 3);
  assert.deepEqual(r.critical, []);
  assert.equal(r.criticalAdded, false);
});

test('adds dst to critical when src was critical', () => {
  const current = { 'b.js::s': 1 };
  const doc = { keys: { 'a.js::s': 2 }, critical: ['a.js'] };
  const r = rekeyPlan(current, doc, 'a.js', 'b.js');
  assert.equal(r.ok, true);
  assert.deepEqual(r.critical, ['a.js', 'b.js']);
  assert.equal(r.criticalAdded, true);
});
