// Picks the best active host for a role by reach rank and id (monitor/llm-runtime.mjs defaultForRole).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultForRole } from '../llm-runtime.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const decl = { hosts: [
  { id: 'h1', baseUrl: 'http://127.0.0.1:11434' },
  { id: 'h2', baseUrl: 'http://192.168.1.5:11434' },
  { id: 'h3', baseUrl: 'https://api.example.com' },
  { id: 'h4', baseUrl: 'http://127.0.0.1:11435' },
] };

function run(posture) {
  const dir = mkdtempSync(join(tmpdir(), 'defaultForRole-'));
  try {
    writeFileSync(join(dir, 'posture.json'), JSON.stringify(posture));
    return defaultForRole(posture, decl);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns null when posture is disabled', () => {
  const r = run({ enabled: false, hosts: {}, roles: {}, allowNonLoopback: {} });
  assert.deepEqual(r, null);
});

test('returns null when no host has both model and reach', () => {
  const r = run({
    enabled: true,
    hosts: { h1: { enabled: true, model: null } },
    roles: {},
    allowNonLoopback: {},
  });
  assert.deepEqual(r, null);
});

test('picks local host over lan and hosted by reach rank', () => {
  const r = run({
    enabled: true,
    hosts: {
      h1: { enabled: true, model: 'm1' },
      h2: { enabled: true, model: 'm2' },
      h3: { enabled: true, model: 'm3' },
    },
    roles: {},
    allowNonLoopback: {},
  });
  assert.deepEqual(r, { host: "h1", model: "m1", reach: "local" });
});

test('breaks reach tie by localeCompare of id', () => {
  const r = run({
    enabled: true,
    hosts: {
      h4: { enabled: true, model: 'm4' },
      h1: { enabled: true, model: 'm1' },
    },
    roles: {},
    allowNonLoopback: {},
  });
  assert.deepEqual(r, { host: "h1", model: "m1", reach: "local" });
});

test('excludes host with model but no reach via filter', () => {
  const r = run({
    enabled: true,
    hosts: {
      h1: { enabled: true, model: 'm1' },
      h2: { enabled: true, model: 'm2' },
    },
    roles: {},
    allowNonLoopback: {},
  });
  assert.deepEqual(r, { host: "h1", model: "m1", reach: "local" });
});

test('returns first candidate when multiple local hosts exist', () => {
  const r = run({
    enabled: true,
    hosts: {
      h1: { enabled: true, model: 'm1' },
      h4: { enabled: true, model: 'm4' },
    },
    roles: {},
    allowNonLoopback: {},
  });
  assert.deepEqual(r, { host: "h1", model: "m1", reach: "local" });
});
