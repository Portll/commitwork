import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticateAsync, verifySecondFactorAsync, confirmTotpAsync, reauthenticatePasswordAsync,
  setPasswordAsync, bootstrapRootAsync, beginPasskeyRegistrationAsync, removePasskeyAsync, loadStore, holdsAuthStoreLock } from '../auth.mjs';
import { totpNow } from './helpers/totp-now.mjs';

const password = 'synthetic fixture password';
const code = 'abcde-12345';
const salt = '00112233445566778899aabbccddeeff';
const derive = value => crypto.scryptSync(value, salt, 64,
  { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 }).toString('hex');
const passwordHash = derive(password), recoveryHash = derive(code);
const witnessScrypt = crypto.scryptSync;
const witnessHash = (value, userSalt) => witnessScrypt(value, userSalt, 64,
  { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 }).toString('hex');
const fixture = () => ({ version: 1, settings: {}, users: [{
  id: 'fixture', email: 'operator@example.test', salt, hash: passwordHash,
  totpConfirmed: true, totpSecret: 'JBSWY3DPEHPK3PXP',
  recovery: [{ hash: recoveryHash, used: false }],
}] });

async function withFixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-auth-async-'));
  const path = join(dir, 'users.json'), previous = process.env.CW_AUTH_STORE;
  process.env.CW_AUTH_STORE = path;
  const write = store => writeFileSync(path, JSON.stringify(store));
  const read = () => JSON.parse(readFileSync(path, 'utf8'));
  const originalAsync = crypto.scrypt, originalSync = crypto.scryptSync;
  let calls = 0, onHash = () => {};
  crypto.scrypt = (...args) => {
    assert.equal(holdsAuthStoreLock(), false, 'KDF is outside the store lock');
    calls++;
    onHash(calls);
    return originalAsync(...args);
  };
  crypto.scryptSync = () => { throw new Error('async login called a synchronous KDF'); };
  syncBuiltinESMExports();
  try {
    write(fixture());
    await run({ dir, path, write, read, calls: () => calls, onHash: fn => { onHash = fn; } });
  } finally {
    crypto.scrypt = originalAsync;
    crypto.scryptSync = originalSync;
    syncBuiltinESMExports();
    if (previous === undefined) delete process.env.CW_AUTH_STORE;
    else process.env.CW_AUTH_STORE = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}
const credentials = token => ({ email: 'operator@example.test', password, token });

test('password and recovery hashing yield to the event loop with no synchronous KDF', async () => withFixture(async ({ calls }) => {
  let finished = false;
  const login = authenticateAsync(credentials(code)).then(result => { finished = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false, 'another event-loop turn runs while scrypt is pending');
  assert.equal((await login).usedRecovery, true);
  assert.equal(calls(), 2, 'one password and one recovery KDF');
}));

test('unknown users and wrong passwords pay one async KDF and receive the same refusal', async () => withFixture(async ({ calls }) => {
  const unknown = await authenticateAsync({ email: 'absent@example.test', password });
  const wrong = await authenticateAsync({ ...credentials(), password: 'wrong' });
  assert.deepEqual(unknown, wrong);
  assert.equal(unknown.ok, false);
  assert.equal(calls(), 2);
}));

test('async TOTP login performs only the password KDF and prevents replay', async () => withFixture(async ({ calls }) => {
  const token = totpNow(fixture().users[0].totpSecret);
  assert.equal((await authenticateAsync(credentials(token))).ok, true);
  assert.equal((await authenticateAsync(credentials(token))).ok, false);
  assert.equal(calls(), 2);
}));

test('concurrent recovery logins accept exactly one use', async () => withFixture(async ({ read }) => {
  const results = await Promise.all([authenticateAsync(credentials(code)), authenticateAsync(credentials(code))]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(read().users[0].recovery[0].used, true);
}));

test('password, salt and factor replacement during hashing cannot authenticate a stale snapshot', async () => {
  for (const change of ['hash', 'salt', 'totpSecret', 'totpConfirmed', 'emailFactor', 'deleted']) {
    await withFixture(async ({ write, onHash, read }) => {
      onHash(n => {
        if (n !== 1) return;
        const store = fixture();
        if (change === 'deleted') store.users = [];
        else if (change === 'totpConfirmed') store.users[0].totpConfirmed = false;
        else if (change === 'emailFactor') store.users[0].emailFactor = true;
        else store.users[0][change] = 'replacement';
        write(store);
      });
      assert.equal((await authenticateAsync(credentials(code))).ok, false, change);
      if (read().users.length) assert.equal(read().users[0].recovery[0].used, false, change);
    });
  }
});

test('enrolling a factor while a password-only login awaits hashing requires a fresh login', async () => withFixture(async ({ write, onHash }) => {
  const initial = fixture(); initial.users[0].totpConfirmed = false; write(initial);
  onHash(() => write(fixture()));
  assert.equal((await authenticateAsync(credentials())).ok, false);
}));

test('replacement recovery hashes are not burned by async SSO verification', async () => withFixture(async ({ write, onHash, read }) => {
  const snapshot = loadStore().users[0];
  onHash(() => {
    const replacement = fixture(); replacement.users[0].recovery[0].hash = passwordHash; write(replacement);
  });
  assert.equal((await verifySecondFactorAsync(snapshot, code)).ok, false);
  assert.equal(read().users[0].recovery[0].used, false);
}));

test('the store path is pinned across awaits and a subsequent call resolves the new path', async () => withFixture(async ({ dir, write, read }) => {
  const otherPath = join(dir, 'other.json');
  writeFileSync(otherPath, JSON.stringify({ version: 1, users: [], settings: {} }));
  const pending = authenticateAsync(credentials(code));
  process.env.CW_AUTH_STORE = otherPath;
  assert.equal((await pending).usedRecovery, true);
  assert.equal(read().users[0].recovery[0].used, true);
  assert.deepEqual(loadStore().users, []);
  assert.equal((await authenticateAsync(credentials(code))).ok, false);
}));

test('KDF rejection propagates without a held store lock or credential mutation', async () => withFixture(async ({ read }) => {
  crypto.scrypt = (...args) => queueMicrotask(() => args.at(-1)(new Error('synthetic KDF failure')));
  syncBuiltinESMExports();
  await assert.rejects(authenticateAsync(credentials(code)), /synthetic KDF failure/);
  assert.equal(holdsAuthStoreLock(), false);
  assert.equal(read().users[0].recovery[0].used, false);
}));

test('email factors and email fallback remain single-use through async password login', async () => {
  for (const totpConfirmed of [false, true]) await withFixture(async ({ write }) => {
    const store = fixture(), user = store.users[0];
    const nearby = [-1, 0, 1].map(offset => totpNow(user.totpSecret, Date.now(), offset));
    const token = nearby.includes('111111') ? '222222' : '111111';
    user.totpConfirmed = totpConfirmed;
    user.emailFactor = true;
    // nosemgrep: javascript.lang.security.audit.hardcoded-hmac-key.hardcoded-hmac-key -- synthetic test value, not a credential
    user.emailCode = { hash: crypto.createHmac('sha256', salt).update(token).digest('hex'),
      issuedAt: Date.now(), expiresAt: Date.now() + 600_000, attempts: 0 };
    write(store);
    const accepted = await authenticateAsync(credentials(token));
    assert.equal(accepted.ok, true);
    assert.equal(accepted.factor, 'email');
    assert.equal((await authenticateAsync(credentials(token))).ok, false);
  });
});

test('TOTP enrollment and password reauthentication use async KDFs and retain replay protection', async () => withFixture(async ({ write, calls, read }) => {
  const store = fixture(); store.users[0].totpConfirmed = false; write(store);
  const token = totpNow(store.users[0].totpSecret);
  assert.equal(await confirmTotpAsync(store.users[0].email, password, token), true);
  assert.equal(read().users[0].totpConfirmed, true);
  assert.equal(await confirmTotpAsync(store.users[0].email, password, token), false);
  assert.equal(await reauthenticatePasswordAsync(store.users[0].email, password), true);
  assert.equal(await reauthenticatePasswordAsync(store.users[0].email, 'wrong'), false);
  assert.equal(await reauthenticatePasswordAsync('absent@example.test', password), false);
  assert.equal(calls(), 5);
}));

test('concurrent enrollment confirmations consume one authenticator step once', async () => withFixture(async ({ write, read }) => {
  const store = fixture(); store.users[0].totpConfirmed = false; write(store);
  const token = totpNow(store.users[0].totpSecret);
  const results = await Promise.all([confirmTotpAsync(store.users[0].email, password, token),
    confirmTotpAsync(store.users[0].email, password, token)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(read().users[0].totpConfirmed, true);
}));

test('enrollment and reauthentication reject credentials replaced while hashing', async () => {
  for (const action of ['enroll', 'reauth']) {
    for (const change of ['hash', 'salt', 'email', 'deleted', ...(action === 'enroll' ? ['totpSecret'] : [])]) {
      await withFixture(async ({ write, read, onHash }) => {
        const store = fixture(); store.users[0].totpConfirmed = false; write(store);
        onHash(() => {
          const replacement = structuredClone(store);
          if (change === 'deleted') replacement.users = [];
          else replacement.users[0][change] = 'replacement';
          write(replacement);
        });
        const token = totpNow(store.users[0].totpSecret);
        const result = action === 'enroll' ? await confirmTotpAsync(store.users[0].email, password, token)
          : await reauthenticatePasswordAsync(store.users[0].email, password);
        assert.equal(result, false, `${action}: ${change}`);
        if (read().users.length) assert.equal(read().users[0].totpConfirmed, false);
      });
    }
  }
});

test('enrollment and reauthentication pin the original store across awaits', async () => {
  for (const action of ['enroll', 'reauth']) await withFixture(async ({ dir, write, read }) => {
    const store = fixture(); store.users[0].totpConfirmed = false; write(store);
    const other = join(dir, 'other.json');
    writeFileSync(other, JSON.stringify({ version: 1, users: [], settings: {} }));
    const pending = action === 'enroll' ? confirmTotpAsync(store.users[0].email, password, totpNow(store.users[0].totpSecret))
      : reauthenticatePasswordAsync(store.users[0].email, password);
    process.env.CW_AUTH_STORE = other;
    assert.equal(await pending, true, action);
    assert.equal(read().users[0].totpConfirmed, action === 'enroll');
    assert.deepEqual(loadStore().users, []);
    assert.equal(await reauthenticatePasswordAsync(store.users[0].email, password), false);
  });
});

const newPassword = 'a different synthetic password';
const changePassword = extra => ({ email: 'operator@example.test', current: password, newPassword, ...extra });

test('async password changes rotate compatible hashes and all recovery codes outside the lock', async () => withFixture(async ({ read, calls }) => {
  const result = await setPasswordAsync(changePassword());
  assert.equal(result.ok, true);
  assert.equal(result.replaced, true);
  assert.equal(calls(), 10, 'old proof plus new password and eight sequential recovery KDFs');
  const user = read().users[0];
  assert.notEqual(user.salt, salt);
  assert.equal(user.hash, witnessHash(newPassword, user.salt));
  assert.equal(result.recovery.length, 8);
  assert.equal(new Set(result.recovery).size, 8);
  for (const [i, token] of result.recovery.entries()) {
    assert.match(token, /^[a-f0-9]{5}-[a-f0-9]{5}$/);
    assert.equal(user.recovery[i].hash, witnessHash(token, user.salt));
    assert.equal(user.recovery[i].used, false);
  }
  assert.equal(await reauthenticatePasswordAsync(user.email, password), false);
  assert.equal((await authenticateAsync({ email: user.email, password: newPassword, token: result.recovery[0] })).usedRecovery, true);
}));

test('password-setting proof and password floor are preserved for password and provider accounts', async () => {
  await withFixture(async ({ calls }) => {
    assert.equal((await setPasswordAsync(changePassword({ current: 'wrong' }))).ok, false);
    assert.equal((await setPasswordAsync(changePassword({ newPassword: 'short' }))).ok, false);
    assert.equal((await setPasswordAsync(changePassword({ email: 'absent@example.test' }))).ok, false);
    assert.equal(calls(), 3, 'rejected attempts do not derive a new password or recovery set');
  });
  await withFixture(async ({ write, read }) => {
    const store = fixture(); delete store.users[0].hash; delete store.users[0].salt; write(store);
    assert.equal((await setPasswordAsync(changePassword())).ok, false);
    const result = await setPasswordAsync(changePassword({ reauthenticated: true }));
    assert.equal(result.ok, true); assert.equal(result.replaced, false);
    assert.equal(read().users[0].hash, witnessHash(newPassword, read().users[0].salt));
  });
});

test('concurrent password changes cannot both commit using the old password proof', async () => withFixture(async ({ read }) => {
  const replacements = ['first synthetic replacement', 'second synthetic replacement'];
  const results = await Promise.all(replacements.map(value => setPasswordAsync(changePassword({ newPassword: value }))));
  assert.equal(results.filter(r => r.ok).length, 1);
  const winner = results.findIndex(r => r.ok), user = read().users[0];
  assert.equal(user.hash, witnessHash(replacements[winner], user.salt));
  assert.equal(results[1 - winner].recovery, undefined, 'failed attempt exposes no unused plaintext codes');
}));

test('password-change commit rechecks late credential and authority changes and preserves fresh unrelated fields', async () => {
  for (const change of ['credentials', 'authority', 'async-authority', 'unrelated']) await withFixture(async ({ write, read, onHash }) => {
    let authorized = true;
    onHash(n => {
      if (n !== 10) return;
      const store = fixture();
      if (change === 'credentials') store.users[0].hash = 'replacement';
      if (change === 'authority') authorized = false;
      if (change === 'unrelated') {
        store.users[0].lastTotpStep = 123;
        store.users.push({ id: 'other-fixture', email: 'other@example.test' });
      }
      write(store);
    });
    const result = await setPasswordAsync(changePassword(), change === 'async-authority' ? async () => false : () => authorized);
    assert.equal(result.ok, change === 'unrelated', change);
    if (change === 'unrelated') {
      assert.equal(read().users[0].lastTotpStep, 123);
      assert.equal(read().users[1].id, 'other-fixture');
    } else {
      assert.equal(read().users[0].salt, salt);
      assert.equal(result.recovery, undefined);
    }
  });
});

test('password changes pin the store across awaits and KDF failure leaves credentials untouched', async () => {
  await withFixture(async ({ dir, read }) => {
    const other = join(dir, 'other.json');
    writeFileSync(other, JSON.stringify({ version: 1, users: [], settings: {} }));
    const pending = setPasswordAsync(changePassword()); process.env.CW_AUTH_STORE = other;
    assert.equal((await pending).ok, true);
    assert.equal(read().users[0].hash, witnessHash(newPassword, read().users[0].salt));
    assert.deepEqual(loadStore().users, []);
  });
  await withFixture(async ({ read }) => {
    const originalAsync = crypto.scrypt; let calls = 0;
    crypto.scrypt = (...args) => {
      if (++calls === 4) return queueMicrotask(() => args.at(-1)(new Error('synthetic recovery KDF failure')));
      return originalAsync(...args);
    };
    syncBuiltinESMExports();
    await assert.rejects(setPasswordAsync(changePassword()), /synthetic recovery KDF failure/);
    assert.equal(read().users[0].hash, passwordHash);
    assert.equal(read().users[0].recovery[0].hash, recoveryHash);
    assert.equal(holdsAuthStoreLock(), false);
  });
});

test('async bootstrap derives compatible credentials outside the lock with no partial account write', async () => withFixture(async ({ write, read, calls, onHash }) => {
  write({ version: 1, users: [], settings: { allowExternalSso: false } });
  onHash(n => {
    assert.equal(read().users.length, 0, 'no account exists before the final commit');
    if (n === 8) write({ version: 1, users: [], settings: { allowExternalSso: true, fixtureFlag: 'latest' } });
  });
  const result = await bootstrapRootAsync({ email: 'new-operator@example.test', password });
  assert.equal(calls(), 9);
  const store = read(), user = store.users[0];
  assert.equal(store.users.length, 1);
  assert.equal(store.settings.fixtureFlag, 'latest');
  assert.equal(store.settings.allowExternalSso, true);
  assert.equal(user.hash, witnessHash(password, user.salt));
  assert.equal(user.email, result.email);
  assert.equal(user.totpSecret, result.totpSecret);
  assert.equal(user.totpConfirmed, false);
  for (const [i, token] of result.recovery.entries()) {
    assert.equal(user.recovery[i].hash, witnessHash(token, user.salt));
  }
}));

test('two concurrent async bootstraps create exactly one operator', async () => withFixture(async ({ write, read }) => {
  write({ version: 1, users: [], settings: {} });
  const results = await Promise.allSettled(['first@example.test', 'second@example.test'].map(email => bootstrapRootAsync({ email, password })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const winner = results.find(r => r.status === 'fulfilled');
  const loser = results.find(r => r.status === 'rejected');
  assert.match(loser.reason.message, /bootstrap window is closed/);
  assert.equal(read().users.length, 1);
  assert.equal(read().users[0].email, winner.value.email);
}));

test('closed and invalid bootstrap attempts cost no KDF; hashing failure writes no operator', async () => withFixture(async ({ write, read, calls }) => {
  await assert.rejects(bootstrapRootAsync({ email: 'new@example.test', password }), /window is closed/);
  write({ version: 1, users: [], settings: { fixtureFlag: 'original' } });
  await assert.rejects(bootstrapRootAsync({ email: 'invalid', password }), /valid email/);
  await assert.rejects(bootstrapRootAsync({ email: 'new@example.test', password: 'short' }), /at least 12/);
  assert.equal(calls(), 0);
  const originalAsync = crypto.scrypt; let stage = 0;
  crypto.scrypt = (...args) => {
    if (++stage === 4) return queueMicrotask(() => args.at(-1)(new Error('synthetic bootstrap KDF failure')));
    return originalAsync(...args);
  };
  syncBuiltinESMExports();
  await assert.rejects(bootstrapRootAsync({ email: 'new@example.test', password }), /synthetic bootstrap KDF failure/);
  assert.equal(read().users.length, 0);
  assert.equal(read().settings.fixtureFlag, 'original');
  assert.equal(holdsAuthStoreLock(), false);
}));

test('async bootstrap pins its store across awaits', async () => withFixture(async ({ dir, write, read }) => {
  write({ version: 1, users: [], settings: {} });
  const other = join(dir, 'other.json'); writeFileSync(other, JSON.stringify(fixture()));
  const pending = bootstrapRootAsync({ email: 'new@example.test', password });
  process.env.CW_AUTH_STORE = other;
  const result = await pending;
  assert.equal(read().users[0].email, result.email);
  assert.equal(loadStore().users[0].email, 'operator@example.test');
  assert.equal(loadStore().users[0].hash, passwordHash);
}));

const passkeyOperations = [beginPasskeyRegistrationAsync, removePasskeyAsync];
const passkeyOptions = { email: 'operator@example.test', password, credentialId: 'first' };
const withPasskeys = () => {
  const store = fixture();
  store.users[0].passkeys = [{ credentialId: 'first' }, { credentialId: 'second' }];
  return store;
};

test('passkey proofs yield with one unlocked KDF for valid, wrong and unknown accounts', async () => {
  for (const operation of passkeyOperations) await withFixture(async ({ write, calls }) => {
    write(withPasskeys());
    let finished = false;
    const work = operation(passkeyOptions).then(r => { finished = true; return r; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false);
    assert.equal((await work).ok, true);
    assert.equal((await operation({ ...passkeyOptions, password: 'wrong' })).ok, false);
    assert.equal((await operation({ ...passkeyOptions, email: 'missing@example.test' })).ok, false);
    assert.equal(calls(), 3);
  });
});

test('passkey proofs refuse changed identity, credentials and factors before issuing or removing', async () => {
  for (const operation of passkeyOperations) for (const change of ['id','email','salt','hash','totpSecret','totpConfirmed','emailFactor','deleted']) {
    await withFixture(async ({ write, onHash, read }) => {
      write(withPasskeys());
      onHash(() => {
        const store = withPasskeys();
        if (change === 'deleted') store.users = [];
        else if (change === 'totpConfirmed') store.users[0].totpConfirmed = false;
        else if (change === 'emailFactor') store.users[0].emailFactor = true;
        else store.users[0][change] = 'replacement';
        write(store);
      });
      const result = await operation(passkeyOptions);
      assert.equal(result.ok, false, change);
      assert.equal(result.challengeId, undefined);
      if (read().users.length) assert.equal(read().users[0].passkeys.length, 2);
    });
  }
});

test('provider passkey proofs recheck synchronous authority and concurrent revokes preserve the last factor', async () => {
  for (const operation of passkeyOperations) for (const authority of [() => false, async () => true]) {
    await withFixture(async ({ write, read }) => {
      const store = withPasskeys(); delete store.users[0].salt; delete store.users[0].hash;
      store.users[0].sso = { provider: 'fixture' }; write(store);
      const r = await operation({ ...passkeyOptions, reauthenticated: true }, authority);
      assert.equal(r.ok, false); assert.equal(r.challengeId, undefined);
      assert.equal(read().users[0].passkeys.length, 2);
    });
  }
  await withFixture(async ({ write, read }) => {
    const store = withPasskeys(); delete store.users[0].salt; delete store.users[0].hash; write(store);
    const results = await Promise.all(['first','second'].map(credentialId =>
      removePasskeyAsync({ ...passkeyOptions, credentialId, reauthenticated: true })));
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal(read().users[0].passkeys.length, 1);
    assert.match(results.find(r => !r.ok).reason, /only way/);
  });
});

test('passkey operations pin the store path and use the latest passkey list', async () => {
  for (const operation of passkeyOperations) await withFixture(async ({ write, onHash, read, dir }) => {
    write(withPasskeys());
    const alternate = join(dir, 'alternate.json'), untouched = JSON.stringify(withPasskeys());
    writeFileSync(alternate, untouched);
    onHash(() => {
      const store = withPasskeys(); store.users[0].passkeys.push({ credentialId: 'latest' });
      store.settings.latest = true; write(store); process.env.CW_AUTH_STORE = alternate;
    });
    const result = await operation(passkeyOptions);
    assert.equal(result.ok, true); assert.equal(readFileSync(alternate, 'utf8'), untouched);
    assert.equal(read().settings.latest, true);
    if (operation === beginPasskeyRegistrationAsync) assert.deepEqual(result.excludeCredentials, ['first','second','latest']);
    else assert.deepEqual(read().users[0].passkeys.map(p => p.credentialId), ['second','latest']);
  });
});
