// phaseBlockers returns keys from earlier core phases that have not been delivered, or all phase keys for secondary jobs. (bin/lib/security-work-queue.mjs phaseBlockers)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseBlockers } from '../lib/security-work-queue.mjs';

test('secondary job with no tasks returns all phase keys', () => {
  const job = { key: 'ledger-witness' };
  const tasks = [];
  const result = phaseBlockers(job, tasks);
  assert.deepEqual(result, ["agent-effective-config", "execution-boundary", "agent-config-wire", "isolation-effects", "agent-permission-effects", "authz-matrix", "authz-evidence", "authz-wire", "security-drift", "history-behaviour", "drift-wire", "history-behaviour-wire", "malicious-content-evidence", "malicious-content-wire", "lane-trust", "canary-rates", "lane-trust-wire", "lane-fixture-completion", "machinery-health", "machinery-health-wire"]);
});

test('core phase 1 job with no tasks returns empty array', () => {
  const job = { key: 'agent-effective-config' };
  const tasks = [];
  const result = phaseBlockers(job, tasks);
  assert.deepEqual(result, []);
});

test('core phase 2 job with no tasks returns phase 1 keys', () => {
  const job = { key: 'authz-matrix' };
  const tasks = [];
  const result = phaseBlockers(job, tasks);
  assert.deepEqual(result, ["agent-effective-config", "execution-boundary", "agent-config-wire", "isolation-effects", "agent-permission-effects"]);
});

test('core phase 2 job with one phase 1 key delivered returns remaining phase 1 keys', () => {
  const job = { key: 'authz-matrix' };
  const tasks = [{
    state: { job: { key: 'agent-effective-config' }, status: 'completed', review: 'accepted', landed: 'a'.repeat(40) }
  }];
  const result = phaseBlockers(job, tasks);
  assert.deepEqual(result, ["agent-effective-config", "execution-boundary", "agent-config-wire", "isolation-effects", "agent-permission-effects"]);
});

test('job with only programmeKey finds definition and returns blockers', () => {
  const job = { programmeKey: 'authz-matrix' };
  const tasks = [];
  const result = phaseBlockers(job, tasks);
  assert.deepEqual(result, ["agent-effective-config", "execution-boundary", "agent-config-wire", "isolation-effects", "agent-permission-effects"]);
});

test('job not found in queue returns empty array', () => {
  const job = { key: 'nonexistent-key' };
  const tasks = [];
  const result = phaseBlockers(job, tasks);
  assert.deepEqual(result, []);
});

test('core phase 3 job with no tasks returns phase 1 and 2 keys', () => {
  const job = { key: 'security-drift' };
  const tasks = [];
  const result = phaseBlockers(job, tasks);
  assert.deepEqual(result, ["agent-effective-config", "execution-boundary", "agent-config-wire", "isolation-effects", "agent-permission-effects", "authz-matrix", "authz-evidence", "authz-wire"]);
});
