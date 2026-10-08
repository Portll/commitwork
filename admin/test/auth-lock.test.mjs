// admin/auth.mjs — cross-process serialisation of the store's read-modify-write: the write is
// atomic but load->mutate->save is not, and a lost update on the TOTP burn restores the replay
// the burn exists to prevent. Only visible across processes, hence the subprocess children.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, utimesSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AUTH = new URL('../auth.mjs', import.meta.url).href;

// A child that takes the lock, holds it while it mutates, and reports what it observed.
const mutate = (store, email) => execFileSync(process.execPath, ['--input-type=module', '-e', `
  process.env.CW_AUTH_STORE = ${JSON.stringify(store)};
  const a = await import(${JSON.stringify(AUTH)});
  a.setExternalSsoAllowed(true);
  process.stdout.write(String(a.externalSsoAllowed()));
`], { encoding: 'utf8' });

test('concurrent writers do not lose each other updates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-lock-'));
  const store = join(dir, 'users.json');
  writeFileSync(store, JSON.stringify({ version: 1, users: [], settings: { allowExternalSso: false } }));

  // Ten processes flipping the switch — without serialisation they interleave on a shared snapshot.
  const outs = Array.from({ length: 10 }, () => mutate(store, 'a@b.co'));
  assert.ok(outs.every((o) => o === 'true'), `every writer must observe its own write, got ${JSON.stringify(outs)}`);
  const final = JSON.parse(readFileSync(store, 'utf8'));
  assert.equal(final.settings.allowExternalSso, true);
  assert.ok(Array.isArray(final.users), 'the store must remain structurally valid under contention');
});

test('only ONE of many concurrent bootstraps can win', () => {
  // bootstrapRoot checks "zero users" then writes — if separable, the second erases the first operator.
  const dir = mkdtempSync(join(tmpdir(), 'cw-lock2-'));
  const store = join(dir, 'users.json');
  const kids = Array.from({ length: 6 }, (_, i) => spawnSync(process.execPath, ['--input-type=module', '-e', `
    process.env.CW_AUTH_STORE = ${JSON.stringify(store)};
    const a = await import(${JSON.stringify(AUTH)});
    try { a.bootstrapRoot({ email: 'op${i}@example.com', password: 'a-long-enough-password' }); process.stdout.write('WON'); }
    catch (e) { process.stdout.write('refused'); }
  `], { encoding: 'utf8' }));
  const won = kids.map((k) => String(k.stdout || '').trim()).filter((s) => s === 'WON');
  assert.equal(won.length, 1, `exactly one bootstrap may succeed, ${won.length} did`);
  const final = JSON.parse(readFileSync(store, 'utf8'));
  assert.equal(final.users.length, 1, 'the store must hold exactly one operator');
});

test('a stale lock is broken rather than wedging the panel forever', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-lock3-'));
  const store = join(dir, 'users.json');
  writeFileSync(store, JSON.stringify({ version: 1, users: [], settings: { allowExternalSso: false } }));
  // simulate a crashed holder: a lock directory that nobody will ever release
  const lock = `${store}.lock`;
  mkdirSync(lock);
  // backdate well past the staleness threshold (seconds since the epoch)
  const past = (Date.now() - 120_000) / 1000;
  utimesSync(lock, past, past);
  const out = mutate(store, 'a@b.co');
  assert.equal(out.trim(), 'true', 'a crashed holder must not lock the operator out of their own panel');
  assert.equal(existsSync(lock), false, 'and the lock must be released afterwards');
});

// ── WINDOWS: ENOENT is not always "absent" ─────────────────────────────────────────────────────
test('WINDOWS — an UNUSABLE store path fails closed, and does not read as "no users"', async (t) => {
  if (process.platform !== 'win32') { t.skip('ENOENT-for-an-invalid-name is win32 behaviour'); return; }
  // Measured 2026-09-04: on Windows a filename containing `< > " | ? *` fails with ENOENT — not
  // EINVAL. loadStore() treated ENOENT as "the one honest empty" and returned an empty store, which
  // is BOOTSTRAP MODE: the panel offers to create a fresh operator and the next bootstrap erases
  // the real account. Since CW_AUTH_STORE is operator-configurable, a mistyped value was enough.
  const a = await import(new URL('../auth.mjs', import.meta.url).href);
  const dir = mkdtempSync(join(tmpdir(), 'cw-auth-badpath-'));
  const saved = process.env.CW_AUTH_STORE;
  try {
    for (const bad of ['store<x>.json', 'store|x.json', 'store?x.json']) {
      process.env.CW_AUTH_STORE = join(dir, bad);
      assert.throws(() => a.loadStore(), /could not be read|unusable/,
        `an unusable path must throw, not return an empty store: ${bad}`);
    }
    // NEGATIVE — a genuinely absent file at a VALID path is still the one honest empty, or a fresh
    // install could never bootstrap at all.
    process.env.CW_AUTH_STORE = join(dir, 'not-created-yet.json');
    const fresh = a.loadStore();
    assert.deepEqual(fresh.users, [], 'a real absence still reads as an empty store');
  } finally {
    if (saved === undefined) delete process.env.CW_AUTH_STORE; else process.env.CW_AUTH_STORE = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
