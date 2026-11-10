// Resolves the tasks database path from entry env or homedir default (admin/lib/spine-preconditions.mjs registeredStore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registeredStore } from '../lib/spine-preconditions.mjs';
import { join } from 'node:path';

test('returns SPINE_TASKS_DB when present in entry env', () => {
  const entry = { env: { SPINE_TASKS_DB: '/custom/spine.db', SUBSTRATE_TASKS_DB: '/substrate.db' } };
  assert.equal(registeredStore(entry), '/custom/spine.db');
});

test('returns SUBSTRATE_TASKS_DB when SPINE_TASKS_DB is absent', () => {
  const entry = { env: { SUBSTRATE_TASKS_DB: '/substrate/tasks.db' } };
  assert.equal(registeredStore(entry), '/substrate/tasks.db');
});

test('returns homedir default when no relevant env vars are set', () => {
  const entry = { env: { OTHER_VAR: 'value' } };
  const expected = join(process.env.HOME || process.env.USERPROFILE || '/root', '.spine', 'tasks.db');
  assert.equal(registeredStore(entry), expected);
});

test('returns homedir default when entry is null', () => {
  const expected = join(process.env.HOME || process.env.USERPROFILE || '/root', '.spine', 'tasks.db');
  assert.equal(registeredStore(null), expected);
});

test('returns homedir default when entry is undefined', () => {
  const expected = join(process.env.HOME || process.env.USERPROFILE || '/root', '.spine', 'tasks.db');
  assert.equal(registeredStore(undefined), expected);
});

test('returns homedir default when entry has no env property', () => {
  const entry = { name: 'test' };
  const expected = join(process.env.HOME || process.env.USERPROFILE || '/root', '.spine', 'tasks.db');
  assert.equal(registeredStore(entry), expected);
});

test('returns homedir default when env is not an object', () => {
  const entry = { env: 'not-an-object' };
  const expected = join(process.env.HOME || process.env.USERPROFILE || '/root', '.spine', 'tasks.db');
  assert.equal(registeredStore(entry), expected);
});

test('returns homedir default when env is null', () => {
  const entry = { env: null };
  const expected = join(process.env.HOME || process.env.USERPROFILE || '/root', '.spine', 'tasks.db');
  assert.equal(registeredStore(entry), expected);
});

test('prefers SPINE_TASKS_DB over SUBSTRATE_TASKS_DB when both are set', () => {
  const entry = { env: { SPINE_TASKS_DB: '/spine/priority.db', SUBSTRATE_TASKS_DB: '/substrate/fallback.db' } };
  assert.equal(registeredStore(entry), '/spine/priority.db');
});

test('returns SUBSTRATE_TASKS_DB when SPINE_TASKS_DB is empty string', () => {
  const entry = { env: { SPINE_TASKS_DB: '', SUBSTRATE_TASKS_DB: '/substrate/fallback.db' } };
  assert.equal(registeredStore(entry), '/substrate/fallback.db');
});
