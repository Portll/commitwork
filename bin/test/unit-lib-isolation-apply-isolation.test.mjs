// Computes reduced coverage when unsandboxed repo code runs (bin/lib/isolation.mjs applyIsolation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyIsolation } from '../lib/isolation.mjs';

test('returns null when res is null', () => {
  const result = applyIsolation(null, { executesRepoCode: true });
  assert.strictEqual(result, null);
});

test('returns res unchanged when isolation is not none', () => {
  const res = { isolation: 'sandboxed', coverage: 'unknown' };
  const result = applyIsolation(res, { executesRepoCode: true });
  assert.strictEqual(result, res);
  assert.strictEqual(result.coverage, 'unknown');
});

test('returns res unchanged when check is undefined', () => {
  const res = { isolation: 'none', coverage: 'unknown' };
  const result = applyIsolation(res, undefined);
  assert.strictEqual(result, res);
  assert.strictEqual(result.coverage, 'unknown');
});

test('returns res unchanged when check.executesRepoCode is false', () => {
  const res = { isolation: 'none', coverage: 'unknown' };
  const result = applyIsolation(res, { executesRepoCode: false });
  assert.strictEqual(result, res);
  assert.strictEqual(result.coverage, 'unknown');
});

test('returns res unchanged when coverage is unknown', () => {
  const res = { isolation: 'none', coverage: 'unknown' };
  const result = applyIsolation(res, { executesRepoCode: true });
  assert.strictEqual(result, res);
  assert.strictEqual(result.coverage, 'unknown');
});

test('sets coverage to reduced and adds reason when coverage is full', () => {
  const res = { isolation: 'none', coverage: 'full', coverageReason: 'existing reason' };
  const result = applyIsolation(res, { executesRepoCode: true });
  assert.strictEqual(result.coverage, 'reduced');
  assert.strictEqual(result.coverageReason, 'existing reason; ran unsandboxed: this lane executes repository code under the operator user with network access');
  assert.strictEqual(result.coverageBasis, 'isolation');
});

test('sets coverage to reduced and adds reason when coverage is partial', () => {
  const res = { isolation: 'none', coverage: 'partial' };
  const result = applyIsolation(res, { executesRepoCode: true });
  assert.strictEqual(result.coverage, 'reduced');
  assert.strictEqual(result.coverageReason, 'ran unsandboxed: this lane executes repository code under the operator user with network access');
  assert.strictEqual(result.coverageBasis, 'isolation');
});

test('sets coverage to reduced and adds reason when coverage is empty string', () => {
  const res = { isolation: 'none', coverage: '' };
  const result = applyIsolation(res, { executesRepoCode: true });
  assert.strictEqual(result.coverage, 'reduced');
  assert.strictEqual(result.coverageReason, 'ran unsandboxed: this lane executes repository code under the operator user with network access');
  assert.strictEqual(result.coverageBasis, 'isolation');
});
