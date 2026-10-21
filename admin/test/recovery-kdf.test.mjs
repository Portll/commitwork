import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStore, verifySecondFactor } from '../auth.mjs';
import { totpNow } from './helpers/totp-now.mjs';

const salt = '00112233445566778899aabbccddeeff';
const codes = Array.from({ length: 8 }, (_, i) => `abcde-0000${i}`);
// Independent construction of the existing on-disk format, without auth's hashing helper.
const recovery = codes.map(code => ({ used: false, hash: crypto.scryptSync(code, salt, 64,
  { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 }).toString('hex') }));
const fixture = () => ({ version: 1, settings: {}, users: [{ id: 'fixture-user',
  email: 'operator@example.test', salt, hash: 'unused-password-hash',
  totpSecret: 'JBSWY3DPEHPK3PXP', totpConfirmed: true, recovery: structuredClone(recovery) }] });

function withFixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-recovery-kdf-'));
  const previous = process.env.CW_AUTH_STORE;
  process.env.CW_AUTH_STORE = join(dir, 'users.json');
  const write = store => writeFileSync(process.env.CW_AUTH_STORE, JSON.stringify(store));
  const original = crypto.scryptSync;
  let calls = 0, duringKdf = null;
  crypto.scryptSync = (...args) => {
    calls++;
    const result = original(...args);
    if (duringKdf) duringKdf();
    return result;
  };
  syncBuiltinESMExports();
  try {
    write(fixture());
    run({ write, calls: () => calls, reset: () => { calls = 0; },
      onKdf: fn => { duringKdf = fn; } });
  } finally {
    crypto.scryptSync = original;
    syncBuiltinESMExports();
    if (previous === undefined) delete process.env.CW_AUTH_STORE;
    else process.env.CW_AUTH_STORE = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('invalid recovery input performs one KDF across eight legacy hashes', () => withFixture(({ calls }) => {
  assert.equal(verifySecondFactor(loadStore().users[0], 'wrong-recovery-code').ok, false);
  assert.equal(calls(), 1);
}));

test('the last legacy recovery code authenticates once with one KDF', () => withFixture(({ calls, reset }) => {
  const snapshot = loadStore().users[0];
  assert.equal(verifySecondFactor(snapshot, codes[7]).usedRecovery, true);
  assert.equal(calls(), 1);
  assert.equal(loadStore().users[0].recovery[7].used, true);
  reset();
  assert.equal(verifySecondFactor(snapshot, codes[7]).ok, false, 'stale snapshot cannot spend twice');
  assert.equal(calls(), 1);
}));

test('valid TOTP and exhausted recovery codes perform no recovery KDF', () => withFixture(({ write, calls }) => {
  assert.equal(verifySecondFactor(loadStore().users[0], totpNow(fixture().users[0].totpSecret)).ok, true);
  assert.equal(calls(), 0);
  const store = fixture();
  store.users[0].recovery.forEach(r => { r.used = true; });
  write(store);
  assert.equal(verifySecondFactor(loadStore().users[0], codes[7]).ok, false);
  assert.equal(calls(), 0);
}));

test('a replacement recovery hash or salt cannot be burned through a stale index', () => {
  for (const change of ['hash', 'salt']) withFixture(({ write, onKdf }) => {
    const snapshot = loadStore().users[0];
    const replacement = fixture();
    if (change === 'hash') replacement.users[0].recovery[7].hash = recovery[0].hash;
    else replacement.users[0].salt = 'ffeeddccbbaa99887766554433221100';
    onKdf(() => write(replacement));
    assert.equal(verifySecondFactor(snapshot, codes[7]).ok, false, change);
    assert.equal(loadStore().users[0].recovery[7].used, false, 'replacement remains unused');
  });
});

test('a malformed neighboring hash cannot disable or crash a valid recovery match', () => withFixture(({ write, calls }) => {
  const store = fixture();
  store.users[0].recovery[0].hash = 'not-hex';
  write(store);
  assert.equal(verifySecondFactor(loadStore().users[0], codes[7]).usedRecovery, true);
  assert.equal(calls(), 1);
}));
