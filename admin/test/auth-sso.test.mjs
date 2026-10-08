// admin/auth.mjs — SSO operator binding and the externalAccess switch: TOFU once, then only
// known accounts; remote SSO defaults off; SSO accounts have no password.
// CW_AUTH_STORE is redirected at a temp dir so the operator's real users.json is never touched.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STORE = join(mkdtempSync(join(tmpdir(), 'cw-sso-')), 'users.json');
process.env.CW_AUTH_STORE = STORE;

let a;
before(async () => { a = await import('../auth.mjs'); });

test('a fresh store opens the bootstrap window and refuses remote SSO', () => {
  assert.equal(a.needsBootstrap(), true);
  assert.equal(a.externalSsoAllowed(), false, 'external SSO must default OFF — binding an operator must not publish a way in');
});

// Runs before the bind — the bootstrap window must still be open, or this proves nothing.
test('a malformed address is refused at bind time', () => {
  assert.throws(() => a.bootstrapSsoRoot({ email: 'not-an-email', provider: 'google' }), /usable email/);
  assert.equal(a.needsBootstrap(), true, 'a refused bind must leave the window open');
});

test('the first identity binds as operator, case-insensitively', () => {
  a.bootstrapSsoRoot({ email: 'Operator@Example.COM', provider: 'google' });
  assert.equal(a.needsBootstrap(), false);
  assert.ok(a.findByEmail('operator@example.com'), 'stored normalised to lowercase');
  assert.ok(a.findByEmail('OPERATOR@EXAMPLE.COM'), 'lookup is case-insensitive');
});

test('the bootstrap window closes permanently after the first bind', () => {
  assert.throws(() => a.bootstrapSsoRoot({ email: 'attacker@evil.example', provider: 'github' }),
    /bootstrap window is closed/);
  assert.equal(a.findByEmail('attacker@evil.example'), null, 'the refused identity must not be stored');
});

test('an unknown provider account is not an operator', () => {
  assert.equal(a.findByEmail('example.test@domain.xyx'), null);
});

test('an SSO account cannot be entered through the password form', () => {
  // No salt/hash exists for this user — must refuse cleanly, not throw or pass.
  const r = a.authenticate({ email: 'operator@example.com', password: 'a-long-enough-password' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid credentials', 'the message must not distinguish an SSO account from a missing one');
  assert.equal(a.authenticate({ email: 'operator@example.com', password: '' }).ok, false);
});

test('the external-sign-in switch round-trips and persists', () => {
  assert.equal(a.externalSsoAllowed(), false);
  a.setExternalSsoAllowed(true);
  assert.equal(a.externalSsoAllowed(), true);
  a.setExternalSsoAllowed(false);
  assert.equal(a.externalSsoAllowed(), false);
});

test('only a literal true enables it — a truthy value must not', () => {
  a.setExternalSsoAllowed('yes');
  assert.equal(a.externalSsoAllowed(), false, 'a non-boolean must not open remote access');
  a.setExternalSsoAllowed(false);
});

test('confirmTotp refuses an SSO account instead of throwing', () => {
  // /auth/totp/confirm is reachable unauthenticated, and a throw here kills the panel.
  assert.doesNotThrow(() => a.confirmTotp('operator@example.com', 'any-password', '123456'));
  assert.equal(a.confirmTotp('operator@example.com', 'any-password', '123456'), false);
  assert.equal(a.confirmTotp('nobody@example.com', 'any-password', '123456'), false, 'and an unknown account is refused identically');
});

test('confirmTotp requires the password — the route is unauthenticated and mutates credential state', () => {
  // The route is unauthenticated and burns lastTotpStep, so it needs proof of ownership.
  const store = join(mkdtempSync(join(tmpdir(), 'cw-confirm-')), 'users.json');
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
    process.env.CW_AUTH_STORE = ${JSON.stringify(store)};
    const { createHmac } = await import('node:crypto');
    const a = await import(${JSON.stringify(new URL('../auth.mjs', import.meta.url).href)});
    const boot = a.bootstrapRoot({ email: 'c@example.com', password: 'the-real-password-12' });
    const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const dec = (s) => { let b=0,v=0; const o=[]; for (const c of s.toUpperCase()) { const i=B32.indexOf(c); if(i===-1) continue; v=(v<<5)|i; b+=5; if(b>=8){o.push((v>>>(b-8))&255); b-=8;} } return Buffer.from(o); };
    const step = Math.floor(Date.now()/1000/30);
    const bb = Buffer.alloc(8); bb.writeUInt32BE(Math.floor(step/2**32),0); bb.writeUInt32BE(step>>>0,4);
    const mac = createHmac('sha1', dec(boot.totpSecret)).update(bb).digest();
    const off = mac[mac.length-1] & 0x0f;
    const code = String(((mac[off]&0x7f)<<24 | mac[off+1]<<16 | mac[off+2]<<8 | mac[off+3]) % 1e6).padStart(6,'0');
    const wrongPw = a.confirmTotp('c@example.com', 'not-the-password', code);
    const rightPw = a.confirmTotp('c@example.com', 'the-real-password-12', code);
    process.stdout.write(JSON.stringify({ wrongPw, rightPw }));
  `], { encoding: 'utf8' });
  const r = JSON.parse(out);
  assert.equal(r.wrongPw, false, 'a valid CODE with the wrong password must not confirm — and must not burn the step');
  assert.equal(r.rightPw, true, 'the real password with the same code confirms');
});

test('a TOTP code is single-use — a replay inside its window is refused', () => {
  // RFC 6238 §5.2: a code stays valid across the ±1-step window, so consumed steps must be recorded.
  // Subprocess because auth.mjs captures STORE_PATH at import; the code is derived, not read out.
  const store = join(mkdtempSync(join(tmpdir(), 'cw-totp-')), 'users.json');
  const authUrl = new URL('../auth.mjs', import.meta.url).href;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
    process.env.CW_AUTH_STORE = ${JSON.stringify(store)};
    const { createHmac } = await import('node:crypto');
    const a = await import(${JSON.stringify(authUrl)});
    const boot = a.bootstrapRoot({ email: 'totp@example.com', password: 'a-long-enough-password' });

    const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const decode = (s) => { let bits = 0, v = 0; const o = [];
      for (const c of s.toUpperCase()) { const i = B32.indexOf(c); if (i === -1) continue;
        v = (v << 5) | i; bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } }
      return Buffer.from(o); };
    const codeAt = (step) => { const b = Buffer.alloc(8);
      b.writeUInt32BE(Math.floor(step / 2 ** 32), 0); b.writeUInt32BE(step >>> 0, 4);
      const mac = createHmac('sha1', decode(boot.totpSecret)).update(b).digest();
      const off = mac[mac.length - 1] & 0x0f;
      return String(((mac[off] & 0x7f) << 24 | mac[off+1] << 16 | mac[off+2] << 8 | mac[off+3]) % 1e6).padStart(6, '0'); };

    const code = codeAt(Math.floor(Date.now() / 1000 / 30));
    const confirmed = a.confirmTotp('totp@example.com', 'a-long-enough-password', code);
    const first = a.authenticate({ email: 'totp@example.com', password: 'a-long-enough-password', token: code });
    const replay = a.authenticate({ email: 'totp@example.com', password: 'a-long-enough-password', token: code });
    process.stdout.write(JSON.stringify({ confirmed, first, replay }));
  `], { encoding: 'utf8' });
  const r = JSON.parse(out);
  assert.equal(r.confirmed, true, 'enrolment must accept the current code');
  // confirmTotp consumes that step, so the same code must not then authenticate
  assert.equal(r.first.ok, false, 'a code already consumed by confirmTotp must not authenticate');
  assert.equal(r.first.reason, 'invalid second factor');
  assert.equal(r.replay.ok, false, 'and it must stay refused on every further replay');
});

test('an unreadable or malformed store fails CLOSED, never as "no users"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-closed-'));
  const probe = (contents) => {
    const p = join(dir, `s-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(p, contents);
    const out = execFileSync(process.execPath, ['-e', `
      process.env.CW_AUTH_STORE = ${JSON.stringify(p)};
      import(${JSON.stringify(new URL('../auth.mjs', import.meta.url).href)}).then((a) => {
        try { a.needsBootstrap(); process.stdout.write('NO_THROW'); }
        catch (e) { process.stdout.write('THREW'); }
      });
    `], { encoding: 'utf8' });
    return out;
  };
  assert.equal(probe('{ not json'), 'THREW', 'corrupt JSON must not read as an empty store');
  assert.equal(probe('{"settings":{}}'), 'THREW', 'a store with no users array must not crash later');
  assert.equal(probe('{"users":null}'), 'THREW', 'users:null must be refused');
  assert.equal(probe('[]'), 'THREW', 'a top-level array must be refused');
});

test('a store predating the settings key reads as external-OFF', () => {
  const raw = JSON.parse(readFileSync(STORE, 'utf8'));
  delete raw.settings;
  writeFileSync(STORE, JSON.stringify(raw));
  assert.equal(a.externalSsoAllowed(), false, 'a legacy store must never read as permissive');
});
