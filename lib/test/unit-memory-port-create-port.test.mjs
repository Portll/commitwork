// Builds a gated port that refuses unreachable or undeclared operations and constrains receipts (lib/memory-port.mjs createPort).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPort } from '../memory-port.mjs';

test('throws when adapter is null', () => {
  assert.throws(() => createPort(null), { name: 'Error', message: 'createPort: adapter.capabilities is required \u2014 an adapter with no declaration is exactly what this module exists to prevent' });
});

test('throws when adapter has no capabilities', () => {
  assert.throws(() => createPort({}), { name: 'Error', message: 'createPort: adapter.capabilities is required \u2014 an adapter with no declaration is exactly what this module exists to prevent' });
});

test('throws when capabilities has no name', () => {
  assert.throws(() => createPort({ capabilities: {} }), { name: 'Error', message: 'createPort: adapter.capabilities is required \u2014 an adapter with no declaration is exactly what this module exists to prevent' });
});

test('refuses operation when adapter declares it but supplies no implementation', async () => {
  const adapter = { capabilities: { name: 'test', operations: ['upsert'], reachability: 'full', storedFormGuarantee: 'full', supportsReadback: true, previewBytes: 100 }, ops: {} };
  const port = createPort(adapter, { caller: 'headless' });
  const r = await port.upsert({ content: 'x' });
  assert.deepEqual(r, { adapter: "test", operation: "upsert", outcome: "refused", ok: false, capability: "operations", reason: "test DECLARES upsert but supplies no implementation \u2014 the capability table is ahead of the adapter, and that disagreement is reported rather than thrown from inside the port", value: null });
});

test('upsert with full guarantee and verified receipt returns success with constrained receipt', async () => {
  const adapter = { capabilities: { name: 'test', operations: ['upsert'], reachability: 'full', storedFormGuarantee: 'full', supportsReadback: true, previewBytes: 100 }, ops: { upsert: async () => ({ state: 'verified', storedForm: 'full', storedCoverage: 1 }) } };
  const port = createPort(adapter, { caller: 'headless' });
  const r = await port.upsert({ content: 'hello' });
  assert.deepEqual(r, { adapter: "test", operation: "upsert", outcome: "ok", ok: true, capability: null, reason: null, value: { state: "verified", storedForm: "full", storedCoverage: 1, capabilityContradiction: null } });
});

test('upsert with preview guarantee and sourceBytes exceeding previewBytes returns accepted-unverified', async () => {
  const adapter = { capabilities: { name: 'test', operations: ['upsert'], reachability: 'full', storedFormGuarantee: 'preview', supportsReadback: true, previewBytes: 10 }, ops: { upsert: async () => ({ state: 'verified', storedForm: 'full', storedCoverage: 1 }) } };
  const port = createPort(adapter, { caller: 'headless' });
  const r = await port.upsert({ content: 'x'.repeat(20) });
  assert.deepEqual(r, { adapter: "test", operation: "upsert", outcome: "ok", ok: true, capability: null, reason: null, value: { state: "accepted-unverified", storedForm: "preview", storedCoverage: 1, capabilityContradiction: "test returned storedForm 'full' for a 20-byte document against a 10-byte budget \u2014 either the budget moved or the measurement is wrong; both need a human", reason: "test keeps at most ~10 bytes and the source is 20 \u2014 the write succeeded and the record is NOT a durable copy" } });
});

test('getById returns absent true when adapter returns null', async () => {
  const adapter = { capabilities: { name: 'test', operations: ['getById'], reachability: 'full', storedFormGuarantee: 'full', supportsReadback: true, previewBytes: 100 }, ops: { getById: async () => null } };
  const port = createPort(adapter, { caller: 'headless' });
  const r = await port.getById('id1');
  assert.deepEqual(r, { adapter: "test", operation: "getById", outcome: "ok", ok: true, capability: null, reason: null, value: null, absent: true });
});

test('getById returns failure with absent false when adapter throws non-ENOENT error', async () => {
  const adapter = { capabilities: { name: 'test', operations: ['getById'], reachability: 'full', storedFormGuarantee: 'full', supportsReadback: true, previewBytes: 100 }, ops: { getById: async () => { throw new Error('db locked'); } } };
  const port = createPort(adapter, { caller: 'headless' });
  const r = await port.getById('id1');
  assert.deepEqual(r, { adapter: "test", operation: "getById", outcome: "failed", ok: false, capability: null, reason: "getById threw: db locked", value: null, absent: false });
});

test('recallByTags returns failure when adapter returns ok false with reason', async () => {
  const adapter = { capabilities: { name: 'test', operations: ['recallByTags'], reachability: 'full', storedFormGuarantee: 'full', supportsReadback: true, previewBytes: 100 }, ops: { recallByTags: async () => ({ ok: false, reason: 'no tags' }) } };
  const port = createPort(adapter, { caller: 'headless' });
  const r = await port.recallByTags(['a']);
  assert.deepEqual(r, { adapter: "test", operation: "recallByTags", outcome: "failed", ok: false, capability: null, reason: "no tags", value: null });
});

test('forget returns failure when adapter returns ok false with reason', async () => {
  const adapter = { capabilities: { name: 'test', operations: ['forget'], reachability: 'full', storedFormGuarantee: 'full', supportsReadback: true, previewBytes: 100 }, ops: { forget: async () => ({ ok: false, reason: 'not found' }) } };
  const port = createPort(adapter, { caller: 'headless' });
  const r = await port.forget('id1');
  assert.deepEqual(r, { adapter: "test", operation: "forget", outcome: "failed", ok: false, capability: null, reason: "not found", value: null });
});

test('health returns failure when adapter returns ok false with reason', async () => {
  const adapter = { capabilities: { name: 'test', operations: ['health'], reachability: 'full', storedFormGuarantee: 'full', supportsReadback: true, previewBytes: 100 }, ops: { health: async () => ({ ok: false, reason: 'degraded' }) } };
  const port = createPort(adapter, { caller: 'headless' });
  const r = await port.health();
  assert.deepEqual(r, { adapter: "test", operation: "health", outcome: "failed", ok: false, capability: null, reason: "degraded", value: null });
});
