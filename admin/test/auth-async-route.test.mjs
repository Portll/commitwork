import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { totpNow } from './helpers/totp-now.mjs';

const dir = mkdtempSync(join(tmpdir(), 'cw-async-auth-route-'));
const overrides = { CW_AUTH_STORE: join(dir, 'users.json'), CW_SESSION_STORE: join(dir, 'sessions.json'),
  CW_SECRETS_FILE: join(dir, 'secrets.json') };
const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
Object.assign(process.env, overrides);
writeFileSync(overrides.CW_SECRETS_FILE, '{}');
const salt = '00112233445566778899aabbccddeeff', password = 'synthetic fixture password';
const code = 'abcde-12345';
const derive = value => crypto.scryptSync(value, salt, 64,
  { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
const passwordDk = derive(password), recoveryDk = derive(code);
const { authHandle } = await import('../routes/auth.mjs');
const { oauthSessions, ssoPending, SSO_TOTP_TTL_MS } = await import('../lib/auth-session.mjs');
const { sessionKey } = await import('../sessions.mjs');
after(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

let source = 0;
const body = { email: 'operator@example.test', password };
function setup({ totp = false } = {}) {
  writeFileSync(overrides.CW_AUTH_STORE, JSON.stringify({ version: 1, settings: {}, users: [{
    id: 'fixture', email: body.email, salt, hash: passwordDk.toString('hex'),
    totpConfirmed: totp, totpSecret: 'JBSWY3DPEHPK3PXP', recovery: [{ hash: recoveryDk.toString('hex'), used: false }],
  }] }));
  oauthSessions.clear(); ssoPending.clear();
}

function route(pathname = '/auth/login', cookie = '', isLoopbackReq = false) {
  let callback, status, headers = {}, output;
  const res = {
    writeHead: (code, h) => { status = code; headers = h; },
    end: text => { output = JSON.parse(text); },
  };
  authHandle({ pathname, req: { method: 'POST', headers: { host: 'localhost:1', cookie, 'cf-connecting-ip': `fixture-${++source}` } },
    res, send: (code, data) => { status = code; output = data; }, isLoopbackReq,
    readJsonBody: (_req, cb) => { callback = cb; }, port: 1, localPort: 2 });
  return { deliver: data => callback(data, null), result: () => ({ status, headers, body: output }) };
}

async function withHeldKdfs(run) {
  const original = crypto.scrypt, originalSync = crypto.scryptSync, pending = [];
  crypto.scrypt = (...args) => { pending.push(args.at(-1)); };
  crypto.scryptSync = () => { throw new Error('HTTP proof route called synchronous KDF'); };
  syncBuiltinESMExports();
  try { await run(pending); }
  finally { crypto.scrypt = original; crypto.scryptSync = originalSync; syncBuiltinESMExports(); }
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test('delayed request bodies cannot exceed two in-flight KDFs; routes yield and mint real sessions', async () => {
  setup();
  await withHeldKdfs(async pending => {
    // All three pass the early budget before any body completes.
    const requests = [route(), route(), route()];
    const completions = requests.map(r => r.deliver(body));
    await turn();
    assert.equal(pending.length, 2);
    assert.equal(requests[2].result().status, 503);
    assert.equal(requests[2].result().headers['retry-after'], '2');
    assert.equal(requests[0].result().status, undefined, 'response waits for async KDF');
    for (const callback of pending) callback(null, passwordDk);
    await Promise.all(completions);
    assert.equal(requests[0].result().status, 200);
    assert.equal(requests[1].result().status, 200);
    assert.match(requests[0].result().headers['set-cookie'], /cw_admin_sid=/);
    assert.equal(oauthSessions.size, 2);
    const next = route(); const done = next.deliver(body); await turn();
    assert.equal(pending.length, 3, 'completed requests released their slots');
    pending[2](null, passwordDk); await done;
    assert.equal(next.result().status, 200);
  });
});

test('KDF rejection receives a generic error, mints no session and releases the slot', async () => {
  setup();
  await withHeldKdfs(async pending => {
    const request = route(), done = request.deliver(body); await turn();
    pending[0](new Error('synthetic private failure detail'));
    await done;
    assert.equal(request.result().status, 500);
    assert.equal(request.result().body.error, 'authentication could not be completed');
    assert.equal(oauthSessions.size, 0);
    const retries = [route(), route()];
    const completions = retries.map(r => r.deliver(body)); await turn();
    assert.equal(pending.length, 3, 'both slots are available after rejection');
    pending[1](null, passwordDk); pending[2](null, passwordDk);
    await Promise.all(completions);
    assert.ok(retries.every(r => r.result().status === 200));
  });
});

test('concurrent use of one SSO challenge creates exactly one session', async () => {
  setup();
  ssoPending.set('challenge-fixture', { email: body.email, provider: 'fixture', createdAt: Date.now(), returnTo: '/' });
  const requests = [route('/auth/sso/totp', 'cw_sso_totp=challenge-fixture'), route('/auth/sso/totp', 'cw_sso_totp=challenge-fixture')];
  await Promise.all(requests.map(r => r.deliver({})));
  assert.deepEqual(requests.map(r => r.result().status).sort(), [200, 401]);
  assert.equal(oauthSessions.size, 1);
  assert.equal(ssoPending.has('challenge-fixture'), false);
});

test('an SSO challenge expiring during recovery hashing cannot mint a session', async () => {
  setup({ totp: true });
  const challenge = { email: body.email, provider: 'fixture', createdAt: Date.now(), returnTo: '/' };
  ssoPending.set('challenge-fixture', challenge);
  await withHeldKdfs(async pending => {
    const request = route('/auth/sso/totp', 'cw_sso_totp=challenge-fixture');
    const done = request.deliver({ token: code }); await turn();
    assert.equal(pending.length, 1);
    challenge.createdAt -= SSO_TOTP_TTL_MS + 1000;
    pending[0](null, recoveryDk); await done;
    assert.equal(request.result().status, 401);
    assert.equal(oauthSessions.size, 0);
  });
});

function seedSession() {
  const session = { user: body.email, provider: 'password', createdAt: Date.now(), lastSeenAt: Date.now() };
  oauthSessions.set(sessionKey('session-fixture'), session);
  return session;
}

test('enrollment and reauthentication share the async admission cap and wait for their KDFs', async () => {
  setup();
  const session = seedSession();
  await withHeldKdfs(async pending => {
    const enrollment = route('/auth/totp/confirm');
    const reauth = route('/auth/reauth/password', 'cw_admin_sid=session-fixture');
    const excess = route();
    const completions = [enrollment.deliver({ ...body, token: totpNow('JBSWY3DPEHPK3PXP') }),
      reauth.deliver(body), excess.deliver(body)];
    await turn();
    assert.equal(pending.length, 2);
    assert.equal(excess.result().status, 503);
    assert.equal(enrollment.result().status, undefined);
    assert.equal(session.reauthAt, undefined);
    // Finish reauth first, so its factor snapshot is still unchanged.
    pending[1](null, passwordDk); await completions[1];
    pending[0](null, passwordDk); await Promise.all(completions);
    assert.equal(reauth.result().status, 200);
    assert.equal(typeof session.reauthAt, 'number');
    assert.equal(enrollment.result().status, 200);
    assert.equal(JSON.parse(readFileSync(overrides.CW_AUTH_STORE)).users[0].totpConfirmed, true);
  });
});

test('sessions revoked, replaced, expired or switched during hashing cannot receive freshness', async () => {
  for (const change of ['revoked', 'replaced', 'expired', 'account-switch']) {
    setup();
    const session = seedSession();
    await withHeldKdfs(async pending => {
      const request = route('/auth/reauth/password', 'cw_admin_sid=session-fixture');
      const done = request.deliver(body); await turn();
      assert.equal(pending.length, 1);
      if (change === 'revoked') oauthSessions.delete(sessionKey('session-fixture'));
      else if (change === 'replaced') oauthSessions.set(sessionKey('session-fixture'), { ...session });
      else if (change === 'expired') session.lastSeenAt = 0;
      else session.user = 'other@example.test';
      pending[0](null, passwordDk); await done;
      assert.equal(request.result().status, 401, change);
      assert.equal(session.reauthAt, undefined, change);
    });
  }
});

test('proof route failures release admission slots and grant neither enrollment nor freshness', async () => {
  for (const pathname of ['/auth/totp/confirm', '/auth/reauth/password']) {
    setup(); const session = seedSession();
    await withHeldKdfs(async pending => {
      const request = route(pathname, 'cw_admin_sid=session-fixture');
      const done = request.deliver({ ...body, token: totpNow('JBSWY3DPEHPK3PXP') }); await turn();
      pending[0](new Error('synthetic proof KDF failure')); await done;
      assert.equal(request.result().status, 500);
      assert.equal(session.reauthAt, undefined);
      assert.equal(JSON.parse(readFileSync(overrides.CW_AUTH_STORE)).users[0].totpConfirmed, false);
      const retries = [route(), route()];
      const completions = retries.map(r => r.deliver(body)); await turn();
      assert.equal(pending.length, 3);
      pending[1](null, passwordDk); pending[2](null, passwordDk); await Promise.all(completions);
      assert.ok(retries.every(r => r.result().status === 200));
    });
  }
});

const replacementBody = { current: password, newPassword: 'next synthetic password' };
const storedUser = () => JSON.parse(readFileSync(overrides.CW_AUTH_STORE)).users[0];

async function reachPasswordCommit(pending) {
  // Leave the final recovery KDF pending so authority can change immediately before commit.
  for (let i = 0; i < 9; i++) {
    await turn();
    assert.equal(pending.length, i + 1);
    pending[i](null, i === 0 ? passwordDk : Buffer.alloc(64, i + 1));
  }
  await turn();
  assert.equal(pending.length, 10);
  assert.equal(storedUser().hash, passwordDk.toString('hex'), 'no partial credential write');
}

test('password-setting waits for every hash and returns fresh recovery codes only after commit', async () => {
  setup(); const session = seedSession();
  await withHeldKdfs(async pending => {
    const request = route('/auth/password/set', 'cw_admin_sid=session-fixture');
    const done = request.deliver(replacementBody);
    await reachPasswordCommit(pending);
    assert.equal(request.result().status, undefined);
    pending[9](null, Buffer.alloc(64, 10)); await done;
    assert.equal(request.result().status, 200);
    assert.equal(request.result().body.recovery.length, 8);
    assert.notEqual(storedUser().hash, passwordDk.toString('hex'));
    assert.equal(typeof session.reauthAt, 'number');
  });
});

test('revoked, replaced, expired or switched sessions cannot commit a password change', async () => {
  for (const change of ['revoked', 'replaced', 'expired', 'account-switch', 'fresh-proof-expired']) {
    setup(); const session = seedSession();
    if (change === 'fresh-proof-expired') session.reauthAt = Date.now();
    await withHeldKdfs(async pending => {
      const request = route('/auth/password/set', 'cw_admin_sid=session-fixture');
      const done = request.deliver({ ...replacementBody, ...(change === 'fresh-proof-expired' ? { current: 'wrong' } : {}) });
      // The fresh-grant case deliberately has no valid current-password proof.
      if (change === 'fresh-proof-expired') {
        await turn(); pending[0](null, Buffer.alloc(64));
        for (let i = 1; i < 9; i++) { await turn(); pending[i](null, Buffer.alloc(64, i + 1)); }
        await turn(); assert.equal(pending.length, 10);
      } else await reachPasswordCommit(pending);
      if (change === 'revoked') oauthSessions.delete(sessionKey('session-fixture'));
      else if (change === 'replaced') oauthSessions.set(sessionKey('session-fixture'), { ...session });
      else if (change === 'expired') session.lastSeenAt = 0;
      else if (change === 'account-switch') session.user = 'other@example.test';
      else session.reauthAt = 0;
      pending[9](null, Buffer.alloc(64, 10)); await done;
      assert.equal(request.result().status, 401, change);
      assert.equal(storedUser().hash, passwordDk.toString('hex'), change);
      assert.equal(storedUser().salt, salt, change);
      assert.equal(request.result().body.recovery, undefined, change);
    });
  }
});

test('password-setting retains its slot throughout recovery hashing and rejects excess delayed bodies', async () => {
  setup(); seedSession();
  await withHeldKdfs(async pending => {
    const requests = Array.from({ length: 3 }, () => route('/auth/password/set', 'cw_admin_sid=session-fixture'));
    const completions = requests.map(r => r.deliver(replacementBody)); await turn();
    assert.equal(pending.length, 2);
    assert.equal(requests[2].result().status, 503);
    let consumed = 0;
    for (let stage = 0; stage < 10; stage++) {
      assert.equal(pending.length, consumed + 2);
      for (let i = 0; i < 2; i++) pending[consumed++](null, stage === 0 ? passwordDk : Buffer.alloc(64, stage + 1));
      await turn();
    }
    await Promise.all(completions);
    assert.deepEqual(requests.slice(0, 2).map(r => r.result().status).sort(), [200, 401]);
    assert.equal(pending.length, 20);
    const next = route(); const done = next.deliver(body); await turn();
    assert.equal(pending.length, 21, 'finished password changes released their slots');
    pending[20](null, Buffer.alloc(64)); await done;
    assert.equal(next.result().status, 401);
  });
});

test('failure while hashing a replacement recovery set leaves the old password usable and releases admission', async () => {
  setup(); seedSession();
  await withHeldKdfs(async pending => {
    const request = route('/auth/password/set', 'cw_admin_sid=session-fixture');
    const done = request.deliver(replacementBody); await turn();
    pending[0](null, passwordDk); await turn();
    pending[1](null, Buffer.alloc(64, 1)); await turn();
    pending[2](new Error('synthetic replacement KDF failure')); await done;
    assert.equal(request.result().status, 500);
    assert.equal(storedUser().hash, passwordDk.toString('hex'));
    const retries = [route(), route()]; const completions = retries.map(r => r.deliver(body)); await turn();
    assert.equal(pending.length, 5);
    pending[3](null, passwordDk); pending[4](null, passwordDk); await Promise.all(completions);
    assert.ok(retries.every(r => r.result().status === 200));
  });
});

function emptyBootstrapStore() {
  oauthSessions.clear(); ssoPending.clear();
  writeFileSync(overrides.CW_AUTH_STORE, JSON.stringify({ version: 1, users: [], settings: { fixtureFlag: 'preserved' } }));
}
const bootstrapUsers = () => JSON.parse(readFileSync(overrides.CW_AUTH_STORE)).users;

test('external and closed-window bootstrap requests never start hashing', async () => {
  await withHeldKdfs(async pending => {
    emptyBootstrapStore();
    const external = route('/auth/bootstrap');
    assert.equal(external.result().status, 403);
    setup();
    const closed = route('/auth/bootstrap', '', true);
    assert.equal(closed.result().status, 409);
    assert.equal(pending.length, 0);
  });
});

test('async bootstrap admits two delayed bodies, creates one operator and exposes secrets only to the winner', async () => {
  emptyBootstrapStore();
  await withHeldKdfs(async pending => {
    const requests = Array.from({ length: 3 }, () => route('/auth/bootstrap', '', true));
    const completions = requests.map((r, i) => r.deliver({ email: `operator-${i}@example.test`, password }));
    await turn();
    assert.equal(pending.length, 2);
    assert.equal(requests[2].result().status, 503);
    let consumed = 0;
    for (let stage = 0; stage < 9; stage++) {
      assert.equal(pending.length, consumed + 2);
      assert.equal(bootstrapUsers().length, 0, 'no operator exists before the final hashes finish');
      for (let i = 0; i < 2; i++) pending[consumed++](null, Buffer.alloc(64, stage + 1));
      await turn();
    }
    await Promise.all(completions);
    assert.deepEqual(requests.slice(0, 2).map(r => r.result().status).sort(), [200, 400]);
    const winner = requests.slice(0, 2).find(r => r.result().status === 200);
    const loser = requests.slice(0, 2).find(r => r.result().status === 400);
    assert.equal(winner.result().body.recovery.length, 8);
    assert.equal(loser.result().body.recovery, undefined);
    assert.equal(loser.result().body.totpSecret, undefined);
    assert.equal(bootstrapUsers().length, 1);
    assert.equal(bootstrapUsers()[0].email, winner.result().body.email);
    assert.equal(JSON.parse(readFileSync(overrides.CW_AUTH_STORE)).settings.fixtureFlag, 'preserved');
    const login = route(); const done = login.deliver({ email: winner.result().body.email, password }); await turn();
    assert.equal(pending.length, 19, 'bootstrap completion released admission slots');
    pending[18](null, Buffer.alloc(64, 1)); await done;
    assert.equal(login.result().status, 200);
  });
});

test('bootstrap KDF failure leaves no operator and releases the admission slot', async () => {
  emptyBootstrapStore();
  await withHeldKdfs(async pending => {
    const request = route('/auth/bootstrap', '', true);
    const done = request.deliver(body); await turn();
    pending[0](null, Buffer.alloc(64, 1)); await turn();
    pending[1](null, Buffer.alloc(64, 2)); await turn();
    pending[2](new Error('synthetic bootstrap KDF failure')); await done;
    assert.equal(request.result().status, 400);
    assert.equal(bootstrapUsers().length, 0);
    assert.equal(request.result().body.recovery, undefined);
    const retries = [route(), route()]; const completions = retries.map(r => r.deliver(body)); await turn();
    assert.equal(pending.length, 5);
    pending[3](null, passwordDk); pending[4](null, passwordDk); await Promise.all(completions);
    assert.ok(retries.every(r => r.result().status === 401));
  });
});

test('passkey registration and revoke share login admission across delayed bodies', async () => {
  setup();
  const store = JSON.parse(readFileSync(overrides.CW_AUTH_STORE));
  store.users[0].passkeys = [{ credentialId: 'first' }];
  writeFileSync(overrides.CW_AUTH_STORE, JSON.stringify(store));
  await withHeldKdfs(async pending => {
    const requests = [route('/auth/passkey/register/begin'),route('/auth/passkey/revoke'),route()];
    const done = requests.map(r => r.deliver({ ...body, credentialId: 'first' })); await turn();
    assert.equal(pending.length, 2); assert.equal(requests[2].result().status, 503);
    assert.equal(requests[0].result().status, undefined);
    pending[0](null,passwordDk); pending[1](null,passwordDk); await Promise.all(done);
    assert.equal(requests[0].result().status,200);
    assert.equal(typeof requests[0].result().body.challengeId,'string');
    assert.equal(requests[1].result().status,200);
    assert.equal(JSON.parse(readFileSync(overrides.CW_AUTH_STORE)).users[0].passkeys.length,0);
    const retry = route(), work = retry.deliver(body); await turn();
    assert.equal(pending.length,3); pending[2](null,passwordDk); await work;
    assert.equal(retry.result().status,200);
  });
});

test('provider passkey operations reject revoked, replaced, switched and stale sessions after hashing', async () => {
  for (const stage of ['register/begin','revoke']) for (const change of ['revoked','replaced','switched','stale']) {
    setup();
    const store = JSON.parse(readFileSync(overrides.CW_AUTH_STORE));
    delete store.users[0].salt; delete store.users[0].hash;
    store.users[0].sso = { provider: 'fixture' };
    store.users[0].passkeys = [{ credentialId: 'first' },{ credentialId: 'second' }];
    writeFileSync(overrides.CW_AUTH_STORE,JSON.stringify(store));
    const session = seedSession(); session.reauthAt = Date.now();
    await withHeldKdfs(async pending => {
      const request = route('/auth/passkey/'+stage,'cw_admin_sid=session-fixture');
      const done = request.deliver({ ...body,credentialId:'first' }); await turn();
      assert.equal(pending.length,1);
      if (change === 'revoked') oauthSessions.clear();
      if (change === 'replaced') oauthSessions.set(sessionKey('session-fixture'),{ ...session });
      if (change === 'switched') session.user = 'other@example.test';
      if (change === 'stale') session.reauthAt = Date.now()-6*60*1000;
      pending[0](null,passwordDk); await done;
      assert.equal(request.result().status,stage === 'revoke' ? 400 : 401,change);
      assert.equal(request.result().body.challengeId,undefined);
      assert.equal(JSON.parse(readFileSync(overrides.CW_AUTH_STORE)).users[0].passkeys.length,2);
    });
  }
});

test('passkey KDF failures are generic and release both slots', async () => {
  setup();
  await withHeldKdfs(async pending => {
    const requests = [route('/auth/passkey/register/begin'),route('/auth/passkey/revoke')];
    const done = requests.map(r => r.deliver(body)); await turn();
    pending[0](new Error('private fixture detail')); pending[1](new Error('private fixture detail'));
    await Promise.all(done);
    for (const r of requests) {
      assert.equal(r.result().status,500);
      assert.equal(r.result().body.error,'authentication could not be completed');
    }
    const retries = [route(),route()], completed = retries.map(r => r.deliver(body)); await turn();
    assert.equal(pending.length,4);
    pending[2](null,passwordDk); pending[3](null,passwordDk); await Promise.all(completed);
    assert.ok(retries.every(r => r.result().status === 200));
  });
});
