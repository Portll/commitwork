// lib/update/token.mjs: the token source order, storing and removing it, and the GitHub device
// flow's request and poll parsing.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync, chmodSync, existsSync, openSync, fstatSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveToken, storeToken, deleteToken, requestDeviceCode, pollDeviceToken, validToken,
  KEYCHAIN_ITEM, DEVICE_CODE_URL, ACCESS_TOKEN_URL, DEVICE_GRANT,
} from '../update/token.mjs';
import { fakeFetch } from './lib/update-rig.mjs';

const TOKEN = 'gho_' + 'a'.repeat(36);
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cw-update-token-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** exec over a table: "cmd args..." -> stdout string | Error. Records calls. */
const fakeExec = (table) => {
  const calls = [];
  const fn = (cmd, args, opts = {}) => {
    const k = [cmd, ...args].join(' ');
    calls.push({ k, opts });
    const v = table[k];
    if (v === undefined || v instanceof Error) throw v || Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return v;
  };
  fn.calls = calls;
  return fn;
};

describe('resolveToken, in order', () => {
  const all = { 'gh auth token': 'gh-token\n', [`security find-generic-password -s ${KEYCHAIN_ITEM} -w`]: 'kc-token\n' };

  test('GITHUB_TOKEN wins over everything', () => {
    // Arrange
    const exec = fakeExec(all);
    // Act
    const r = resolveToken({ env: { GITHUB_TOKEN: ' env-token ' }, exec, platform: 'darwin' });
    // Assert
    assert.deepEqual(r, { token: 'env-token', source: 'env' });
    assert.equal(exec.calls.length, 0);
  });

  test('then gh auth token', () => {
    // Arrange
    const exec = fakeExec(all);
    // Act
    const r = resolveToken({ env: {}, exec, platform: 'darwin' });
    // Assert
    assert.deepEqual(r, { token: 'gh-token', source: 'gh' });
  });

  test('then the Keychain on macOS, when gh is absent', () => {
    // Arrange
    const exec = fakeExec({ [`security find-generic-password -s ${KEYCHAIN_ITEM} -w`]: 'kc-token\n' });
    // Act
    const r = resolveToken({ env: {}, exec, platform: 'darwin' });
    // Assert
    assert.deepEqual(r, { token: 'kc-token', source: 'keychain' });
  });

  test('none on macOS when nothing is stored', () => {
    // Arrange
    const exec = fakeExec({ 'gh auth token': '' });
    // Act
    const r = resolveToken({ env: {}, exec, platform: 'darwin' });
    // Assert
    assert.deepEqual(r, { token: null, source: null });
  });

  test('then the 0600 file elsewhere; a file others can read is not used', () => {
    // Arrange
    const exec = fakeExec({});
    writeFileSync(join(dir, 'update-token'), 'file-token\n', { mode: 0o600 });
    const before = resolveToken({ env: {}, exec, platform: 'linux', configDir: dir });
    chmodSync(join(dir, 'update-token'), 0o644);
    // Act
    const after = resolveToken({ env: {}, exec, platform: 'linux', configDir: dir });
    // Assert
    assert.deepEqual(before, { token: 'file-token', source: 'file' });
    assert.equal(after.token, null);
    assert.match(after.warning, /readable by other users/);
  });

  test('no config dir, or no file, is no token', () => {
    // Arrange
    const exec = fakeExec({});
    // Act
    const a = resolveToken({ env: {}, exec, platform: 'linux' });
    const b = resolveToken({ env: {}, exec, platform: 'linux', configDir: dir });
    // Assert
    assert.deepEqual([a.token, b.token], [null, null]);
  });
});

describe('storeToken and deleteToken', () => {
  test('macOS writes the Keychain through security -i on stdin, never argv', () => {
    // Arrange
    const exec = fakeExec({ 'security -i': '' });
    // Act
    const r = storeToken(TOKEN, { exec, platform: 'darwin' });
    // Assert
    assert.deepEqual(r, { where: 'keychain', item: KEYCHAIN_ITEM });
    assert.equal(exec.calls[0].k, 'security -i');
    assert.equal(exec.calls[0].opts.input, `add-generic-password -U -s ${KEYCHAIN_ITEM} -a ${KEYCHAIN_ITEM} -w ${TOKEN}\n`);
  });

  test('elsewhere writes a 0600 file, and deleteToken removes it', () => {
    // Arrange
    const sub = join(dir, 'cfg');
    // Act
    const r = storeToken(TOKEN, { platform: 'linux', configDir: sub });
    const fd = openSync(r.file, 'r');
    const mode = fstatSync(fd).mode & 0o777;
    const content = readFileSync(fd, 'utf8');
    closeSync(fd);
    const removed = deleteToken({ platform: 'linux', configDir: sub });
    const again = deleteToken({ platform: 'linux', configDir: sub });
    // Assert
    assert.equal(mode, 0o600);
    assert.equal(content, `${TOKEN}\n`);
    assert.equal(removed.where, 'file');
    assert.equal(existsSync(r.file), false);
    assert.equal(again, null);
  });

  test('a value that is not token-shaped is refused, so nothing can end the security command line', () => {
    // Arrange
    const bad = [`${TOKEN}\ndelete-keychain`, 'short', `${TOKEN} -w x`, 7];
    // Act
    const ok = bad.map(validToken);
    // Assert
    assert.deepEqual(ok, [false, false, false, false]);
    assert.throws(() => storeToken(bad[0], { platform: 'darwin', exec: fakeExec({}) }), /not a GitHub or update token/);
    assert.throws(() => storeToken(TOKEN, { platform: 'linux' }), /no config directory/);
  });

  test('deleteToken on macOS reports whether an item was removed', () => {
    // Arrange
    const has = fakeExec({ [`security delete-generic-password -s ${KEYCHAIN_ITEM}`]: '' });
    const none = fakeExec({});
    // Act
    const a = deleteToken({ exec: has, platform: 'darwin' });
    const b = deleteToken({ exec: none, platform: 'darwin' });
    // Assert
    assert.deepEqual(a, { where: 'keychain' });
    assert.equal(b, null);
  });
});

describe('the device flow', () => {
  test('requestDeviceCode posts the client id and parses the answer', async () => {
    // Arrange
    const fetch = fakeFetch({ [DEVICE_CODE_URL]: { body: { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 7, expires_in: 600 } } });
    // Act
    const r = await requestDeviceCode({ fetch, clientId: 'Iv1.x' });
    // Assert
    assert.deepEqual(r, { deviceCode: 'dc', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', interval: 7, expiresIn: 600 });
    assert.equal(fetch.calls[0].init.method, 'POST');
    assert.equal(fetch.calls[0].init.body, 'client_id=Iv1.x&scope=');
    assert.equal(fetch.calls[0].init.headers.Accept, 'application/json');
  });

  test('requestDeviceCode without a client id, with an error, or a bad answer throws', async () => {
    // Arrange
    const err = fakeFetch({ [DEVICE_CODE_URL]: { status: 400, body: { error: 'unauthorized_client', error_description: 'device flow is off' } } });
    const empty = fakeFetch({ [DEVICE_CODE_URL]: { body: {} } });
    const html = fakeFetch({ [DEVICE_CODE_URL]: { status: 502, body: '<html>' } });
    const status = fakeFetch({ [DEVICE_CODE_URL]: { status: 500, body: {} } });
    // Act
    const results = await Promise.allSettled([
      requestDeviceCode({ fetch: err, clientId: '' }), requestDeviceCode({ fetch: err, clientId: 'c' }),
      requestDeviceCode({ fetch: empty, clientId: 'c' }), requestDeviceCode({ fetch: html, clientId: 'c' }),
      requestDeviceCode({ fetch: status, clientId: 'c' }),
    ]);
    // Assert
    assert.match(results[0].reason.message, /PORTLL_GITHUB_CLIENT_ID is not set/);
    assert.match(results[1].reason.message, /device flow is off/);
    assert.match(results[2].reason.message, /without a device code/);
    assert.match(results[3].reason.message, /HTTP 502, not JSON/);
    assert.match(results[4].reason.message, /HTTP 500/);
  });

  test('pollDeviceToken waits through pending and slow_down, then returns the token', async () => {
    // Arrange
    const answers = [{ error: 'authorization_pending' }, { error: 'slow_down', interval: 10 }, { error: 'slow_down' }, { access_token: TOKEN }];
    const fetch = fakeFetch({ [ACCESS_TOKEN_URL]: () => ({ body: answers.shift() }) });
    const sleeps = [];
    // Act
    const t = await pollDeviceToken({ fetch, clientId: 'c', deviceCode: 'dc', interval: 5, sleep: async (ms) => { sleeps.push(ms); }, now: () => 0 });
    // Assert
    assert.equal(t, TOKEN);
    assert.deepEqual(sleeps, [5000, 5000, 10000, 15000]);
    assert.match(fetch.calls[0].init.body, new RegExp(`grant_type=${encodeURIComponent(DEVICE_GRANT)}`));
  });

  test('pollDeviceToken stops on expiry, refusal, an unknown error, or the deadline', async () => {
    // Arrange
    const once = (body) => fakeFetch({ [ACCESS_TOKEN_URL]: { body } });
    const sleep = async () => {};
    let t = 0;
    const late = fakeFetch({ [ACCESS_TOKEN_URL]: () => { t += 2000; return { body: { error: 'authorization_pending' } }; } });
    // Act
    const results = await Promise.allSettled([
      pollDeviceToken({ fetch: once({ error: 'expired_token' }), clientId: 'c', deviceCode: 'd', sleep, now: () => 0 }),
      pollDeviceToken({ fetch: once({ error: 'access_denied' }), clientId: 'c', deviceCode: 'd', sleep, now: () => 0 }),
      pollDeviceToken({ fetch: once({ error: 'incorrect_client_credentials' }), clientId: 'c', deviceCode: 'd', sleep, now: () => 0 }),
      pollDeviceToken({ fetch: once({}), clientId: 'c', deviceCode: 'd', sleep, now: () => 0 }),
      pollDeviceToken({ fetch: late, clientId: 'c', deviceCode: 'd', expiresIn: 3, sleep, now: () => t }),
    ]);
    // Assert
    assert.match(results[0].reason.message, /expired/);
    assert.match(results[1].reason.message, /declined/);
    assert.match(results[2].reason.message, /incorrect_client_credentials/);
    assert.match(results[3].reason.message, /no token and no error/);
    assert.match(results[4].reason.message, /expired/);
  });
});

test('the default sleep and exec are real: a zero interval polls at once, and gh or security either answers or is skipped', async () => {
  // Arrange
  const fetch = fakeFetch({ [ACCESS_TOKEN_URL]: { body: { access_token: TOKEN } } });
  // Act
  const t = await pollDeviceToken({ fetch, clientId: 'c', deviceCode: 'd', interval: 0 });
  const r = resolveToken({ env: {}, platform: 'linux' });
  // Assert
  assert.equal(t, TOKEN);
  assert.ok(r.source === null || r.source === 'gh');
});
