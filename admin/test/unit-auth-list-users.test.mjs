// Redacted user roster with SSO kind, TOTP flags, and remaining recovery codes (admin/auth.mjs listUsers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listUsers } from '../auth.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array when store file is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listUsers-'));
  try {
    process.env.CW_AUTH_STORE = join(dir, 'users.json');
    assert.deepEqual(listUsers(), []);
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps password user with no TOTP or recovery codes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listUsers-'));
  const p = join(dir, 'users.json');
  try {
    writeFileSync(p, JSON.stringify({
      version: 1,
      users: [{ id: 'u1', email: 'a@b.c', sso: null, totpSecret: null, totpConfirmed: false, recovery: [], createdAt: '2024-01-01' }],
      settings: { allowExternalSso: false }
    }));
    process.env.CW_AUTH_STORE = p;
    assert.deepEqual(listUsers(), [{
      id: 'u1', email: 'a@b.c', kind: 'password', totpEnrolled: false, totpConfirmed: false, recoveryRemaining: 0, createdAt: '2024-01-01'
    }]);
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps SSO user with provider in kind field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listUsers-'));
  const p = join(dir, 'users.json');
  try {
    writeFileSync(p, JSON.stringify({
      version: 1,
      users: [{ id: 'u2', email: 'sso@x.y', sso: { provider: 'github' }, totpSecret: null, totpConfirmed: false, recovery: [], createdAt: null }],
      settings: { allowExternalSso: true }
    }));
    process.env.CW_AUTH_STORE = p;
    assert.deepEqual(listUsers(), [{
      id: 'u2', email: 'sso@x.y', kind: 'sso:github', totpEnrolled: false, totpConfirmed: false, recoveryRemaining: 0, createdAt: null
    }]);
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts only unused recovery codes in recoveryRemaining', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listUsers-'));
  const p = join(dir, 'users.json');
  try {
    writeFileSync(p, JSON.stringify({
      version: 1,
      users: [{ id: 'u3', email: 'r@z.w', sso: null, totpSecret: 'sec', totpConfirmed: true, recovery: [{ used: true }, { used: false }, { used: false }, { used: true }], createdAt: '2024-06-15' }],
      settings: { allowExternalSso: false }
    }));
    process.env.CW_AUTH_STORE = p;
    assert.deepEqual(listUsers(), [{
      id: 'u3', email: 'r@z.w', kind: 'password', totpEnrolled: true, totpConfirmed: true, recoveryRemaining: 2, createdAt: '2024-06-15'
    }]);
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles multiple users preserving order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listUsers-'));
  const p = join(dir, 'users.json');
  try {
    const users = Array.from({ length: 3 }, (_, i) => ({
      id: `id${i}`, email: `user${i}@test.io`, sso: i === 1 ? { provider: 'google' } : null,
      totpSecret: i === 2 ? 'secret' : null, totpConfirmed: i === 2, recovery: [], createdAt: `2024-01-0${i + 1}`
    }));
    writeFileSync(p, JSON.stringify({ version: 1, users, settings: { allowExternalSso: false } }));
    process.env.CW_AUTH_STORE = p;
    const result = listUsers();
    assert.equal(result.length, 3);
    assert.equal(result[0].kind, 'password');
    assert.equal(result[1].kind, 'sso:google');
    assert.equal(result[2].kind, 'password');
    assert.equal(result[2].totpEnrolled, true);
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null createdAt when field is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listUsers-'));
  const p = join(dir, 'users.json');
  try {
    writeFileSync(p, JSON.stringify({
      version: 1,
      users: [{ id: 'u4', email: 'no@date.com', sso: null, totpSecret: null, totpConfirmed: false, recovery: [] }],
      settings: { allowExternalSso: false }
    }));
    process.env.CW_AUTH_STORE = p;
    assert.deepEqual(listUsers(), [{
      id: 'u4', email: 'no@date.com', kind: 'password', totpEnrolled: false, totpConfirmed: false, recoveryRemaining: 0, createdAt: null
    }]);
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('treats empty recovery array as zero remaining', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listUsers-'));
  const p = join(dir, 'users.json');
  try {
    writeFileSync(p, JSON.stringify({
      version: 1,
      users: [{ id: 'u5', email: 'empty@rec.io', sso: null, totpSecret: 's', totpConfirmed: true, recovery: [], createdAt: '2024-03-10' }],
      settings: { allowExternalSso: false }
    }));
    process.env.CW_AUTH_STORE = p;
    assert.equal(listUsers()[0].recoveryRemaining, 0);
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('all recovery codes used yields zero remaining', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listUsers-'));
  const p = join(dir, 'users.json');
  try {
    const recovery = Array.from({ length: 5 }, () => ({ used: true }));
    writeFileSync(p, JSON.stringify({
      version: 1,
      users: [{ id: 'u6', email: 'all@used.io', sso: null, totpSecret: null, totpConfirmed: false, recovery, createdAt: '2024-02-20' }],
      settings: { allowExternalSso: false }
    }));
    process.env.CW_AUTH_STORE = p;
    assert.equal(listUsers()[0].recoveryRemaining, 0);
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});
