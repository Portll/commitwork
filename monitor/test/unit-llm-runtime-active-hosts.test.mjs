// Hosts switched on and not blocked while the posture is enabled (monitor/llm-runtime.mjs activeHosts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeHosts } from '../llm-runtime.mjs';

const rowsDecl = (rows) => ({ hosts: { filter: () => ({ map: () => rows }) } });

test('a disabled posture returns an empty array without reading the declaration', () => {
  assert.deepEqual(activeHosts({ enabled: false }, null), []);
});

test('a posture with no enabled field counts as disabled', () => {
  assert.deepEqual(activeHosts({}, null), []);
});

test('a disabled posture returns an empty array even when an unblocked row is available', () => {
  const decl = rowsDecl([{ id: 'a', blocked: false }]);
  assert.deepEqual(activeHosts({ enabled: false }, decl), []);
});

test('an enabled posture reads the declaration, so a null declaration throws', () => {
  assert.throws(() => activeHosts({ enabled: true }, null), {
    name: 'TypeError',
    message: "Cannot read properties of null (reading 'hosts')",
  });
});

test('a truthy non-boolean enabled value counts as enabled', () => {
  assert.throws(() => activeHosts({ enabled: 1 }, null), {
    name: 'TypeError',
    message: "Cannot read properties of null (reading 'hosts')",
  });
});

test('an enabled posture without a hosts map throws on the first declared host', () => {
  assert.throws(() => activeHosts({ enabled: true }, { hosts: [{ id: 'h1' }] }), {
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'h1')",
  });
});

test('an enabled posture with no declared hosts returns an empty array', () => {
  const posture = { enabled: true, hosts: { h1: { enabled: true } } };
  assert.deepEqual(activeHosts(posture, { hosts: [] }), []);
});

test('an enabled posture skips a declared host that is switched off', () => {
  const posture = { enabled: true, hosts: { h1: { enabled: false } } };
  assert.deepEqual(activeHosts(posture, { hosts: [{ id: 'h1' }] }), []);
});

test('an enabled posture skips a declared host it does not mention', () => {
  const posture = { enabled: true, hosts: {} };
  assert.deepEqual(activeHosts(posture, { hosts: [{ id: 'h1' }] }), []);
});

test('an enabled posture keeps unblocked rows and drops blocked ones', () => {
  const decl = rowsDecl([
    { id: 'a', blocked: false },
    { id: 'b', blocked: true },
  ]);
  assert.deepEqual(activeHosts({ enabled: true }, decl), [{ id: 'a', blocked: false }]);
});
