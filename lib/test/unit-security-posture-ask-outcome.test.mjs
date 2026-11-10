// Computes the guard decision for a given ask class, posture, and unattended state (lib/security-posture.mjs askOutcome).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askOutcome } from '../security-posture.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'askOutcome-'));
const queueDir = join(dir, 'queue');
mkdirSync(queueDir, { recursive: true, mode: 0o700 });
writeFileSync(join(queueDir, 'settings.json'), JSON.stringify({ values: {}, records: {} }));
process.env.CW_APPROVAL_QUEUE = queueDir;

test('returns ask when not unattended', () => {
  try {
    const r = askOutcome({ askClass: 'push', env: { CW_GUARD_UNATTENDED: '0' }, permissionMode: 'ask' });
    assert.deepEqual(r, { decision: "ask", record: false, recordAllowed: false, posture: { mode: "A", source: "default" }, unattended: { unattended: false, why: "permission_mode ask" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns deny with record true for posture-write when unattended in mode C', () => {
  try {
    const r = askOutcome({ askClass: 'posture-write', env: { CW_GUARD_UNATTENDED: '1', CW_UNATTENDED_POSTURE: 'C' }, permissionMode: 'ask' });
    assert.deepEqual(r, { decision: "deny", record: true, recordAllowed: false, posture: { mode: "C", source: "env:CW_UNATTENDED_POSTURE" }, unattended: { unattended: true, why: "CW_GUARD_UNATTENDED=1" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ask for off posture when unattended', () => {
  try {
    const r = askOutcome({ askClass: 'push', env: { CW_GUARD_UNATTENDED: '1', CW_UNATTENDED_POSTURE: 'off' }, permissionMode: 'ask' });
    assert.deepEqual(r, { decision: "ask", record: false, recordAllowed: false, posture: { mode: "off", source: "env:CW_UNATTENDED_POSTURE" }, unattended: { unattended: true, why: "CW_GUARD_UNATTENDED=1" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns deny with record false for push in mode B', () => {
  try {
    const r = askOutcome({ askClass: 'push', env: { CW_GUARD_UNATTENDED: '1', CW_UNATTENDED_POSTURE: 'B' }, permissionMode: 'ask' });
    assert.deepEqual(r, { decision: "deny", record: false, recordAllowed: false, posture: { mode: "B", source: "env:CW_UNATTENDED_POSTURE" }, unattended: { unattended: true, why: "CW_GUARD_UNATTENDED=1" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ask with recordAllowed true for recursive-delete in mode B', () => {
  try {
    const r = askOutcome({ askClass: 'recursive-delete', env: { CW_GUARD_UNATTENDED: '1', CW_UNATTENDED_POSTURE: 'B' }, permissionMode: 'ask' });
    assert.deepEqual(r, { decision: "ask", record: false, recordAllowed: true, posture: { mode: "B", source: "env:CW_UNATTENDED_POSTURE" }, unattended: { unattended: true, why: "CW_GUARD_UNATTENDED=1" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns deny with record true for push in mode C', () => {
  try {
    const r = askOutcome({ askClass: 'push', env: { CW_GUARD_UNATTENDED: '1', CW_UNATTENDED_POSTURE: 'C' }, permissionMode: 'ask' });
    assert.deepEqual(r, { decision: "deny", record: true, recordAllowed: false, posture: { mode: "C", source: "env:CW_UNATTENDED_POSTURE" }, unattended: { unattended: true, why: "CW_GUARD_UNATTENDED=1" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns deny with record false for unknown ask class in mode B', () => {
  try {
    const r = askOutcome({ askClass: 'unknown-class', env: { CW_GUARD_UNATTENDED: '1', CW_UNATTENDED_POSTURE: 'B' }, permissionMode: 'ask' });
    assert.deepEqual(r, { decision: "deny", record: false, recordAllowed: false, posture: { mode: "B", source: "env:CW_UNATTENDED_POSTURE" }, unattended: { unattended: true, why: "CW_GUARD_UNATTENDED=1" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns deny with record false for secret-read in mode A', () => {
  try {
    const r = askOutcome({ askClass: 'secret-read', env: { CW_GUARD_UNATTENDED: '1', CW_UNATTENDED_POSTURE: 'A' }, permissionMode: 'ask' });
    assert.deepEqual(r, { decision: "deny", record: false, recordAllowed: false, posture: { mode: "A", source: "env:CW_UNATTENDED_POSTURE" }, unattended: { unattended: true, why: "CW_GUARD_UNATTENDED=1" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
