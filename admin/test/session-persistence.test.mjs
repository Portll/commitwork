// Sessions that survive a restart — and the four things that make that safe rather than convenient.
//
// Persisting sessions is a change in this panel's security posture, not a feature: before it, a
// restart ended every session, and that was a real control even though nobody designed it. Trading
// it away buys the operator not being logged out by the panel's own update button. The trade is
// only worth making if all four of these hold, so all four are asserted here rather than described
// in a comment nobody re-reads:
//
//   1. The file never contains a usable cookie. It is keyed by sha256(sid); the raw id lives in the
//      operator's browser and this process's memory and nowhere else.
//   2. A provider access token is never written. It stays in memory and a restart drops it.
//   3. Expiry is enforced ON LOAD, so bouncing the process cannot refresh an idle session's lease —
//      otherwise the restart button quietly becomes a way to keep a stale session alive forever.
//   4. An unreadable store admits NOBODY. Fail-closed points the opposite way from auth.mjs here,
//      and the reason is in sessions.mjs: there, empty means "no operator exists" and reopens
//      bootstrap; here, empty means "everybody is signed out".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelSource } from './lib/panel-source.mjs';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(HERE, '..');
const SERVE = serverSource();
const SRC = panelSource('index.html');

const STORE = join('/tmp', `cw-sessions-${process.pid}.json`);
process.env.CW_SESSION_STORE = STORE;
const S = await import('../sessions.mjs');

const HOUR = 3600 * 1000;
const TTL = 8 * HOUR;
// Every restore is now joined against the account store, so the fixture account has to be in the
// set or nothing comes back. That is the point of the join and not an inconvenience of it.
const KNOWN = new Set(['a@example.com']);
const fresh = () => { try { rmSync(STORE, { force: true }); } catch { /* gone */ } S._resetFlushThrottle(); };
test.after(() => { try { rmSync(STORE, { force: true }); } catch { /* gone */ } });

// ── 0. the store cannot leak into the operator's real home ────────────────────────────────────
test('the session store follows the auth store, so no test can write to the real home', () => {
  // THIS IS A REGRESSION TEST FOR A LEAK THAT ALREADY HAPPENED. The first cut defaulted straight to
  // ~/.commitwork/sessions.json unless CW_SESSION_STORE was set, and several tests boot a whole
  // panel — they set CW_AUTH_STORE, because that variable existed when they were written, and knew
  // nothing about a second one. So a test run logged fixture accounts into the operator's real
  // session file. Seven rows, every one an @example.com that exists in no store on this machine.
  // Nothing failed and nothing could have: a leak into a file only this module reads has no symptom
  // until the panel restores a session for an account that does not exist.
  const saved = { s: process.env.CW_SESSION_STORE, a: process.env.CW_AUTH_STORE };
  try {
    delete process.env.CW_SESSION_STORE;
    process.env.CW_AUTH_STORE = '/tmp/fixture-users.json';
    const p = S.sessionStorePath();
    assert.ok(!p.startsWith(homedir()),
      `redirecting CW_AUTH_STORE left the session store at ${p} — a test that boots a panel writes fixture sessions into the operator's home`);
    assert.equal(p, '/tmp/fixture-users.sessions.json');

    // Derived from the auth store's FULL NAME, not its directory: two fixtures sharing /tmp must not
    // quietly share one session table.
    process.env.CW_AUTH_STORE = '/tmp/other-users.json';
    assert.notEqual(S.sessionStorePath(), p, 'two different auth stores in one directory resolve to the same session file');

    // The explicit override still wins over the derivation.
    process.env.CW_SESSION_STORE = '/tmp/explicit.json';
    assert.equal(S.sessionStorePath(), '/tmp/explicit.json');

    // And with neither set — a real panel — it is the home directory, which is the point.
    delete process.env.CW_SESSION_STORE; delete process.env.CW_AUTH_STORE;
    assert.equal(S.sessionStorePath(), join(homedir(), '.commitwork', 'sessions.json'));
  } finally {
    if (saved.s === undefined) delete process.env.CW_SESSION_STORE; else process.env.CW_SESSION_STORE = saved.s;
    if (saved.a === undefined) delete process.env.CW_AUTH_STORE; else process.env.CW_AUTH_STORE = saved.a;
  }
});

test('the path is read at CALL time, not captured at import', () => {
  // A `const P = process.env.X` at module load defeats every override set afterwards, and the test
  // still passes while proving nothing — the house rule this repo states in CLAUDE.md.
  const saved = process.env.CW_SESSION_STORE;
  try {
    process.env.CW_SESSION_STORE = '/tmp/changed-after-import.json';
    assert.equal(S.sessionStorePath(), '/tmp/changed-after-import.json');
  } finally { process.env.CW_SESSION_STORE = saved; }
});

// ── 1. the raw session id never reaches the disk ──────────────────────────────────────────────
test('the store is keyed by the hash, and the id itself appears nowhere in it', () => {
  fresh();
  const sid = 'a-secret-bearer-token-value-9f3d';
  const m = new Map([[S.sessionKey(sid), { provider: 'password', user: 'a@example.com', createdAt: Date.now(), lastSeenAt: Date.now() }]]);
  assert.equal(S.persistSessions(m, { force: true }), true);

  const raw = readFileSync(STORE, 'utf8');
  assert.ok(!raw.includes(sid),
    'the raw session id is in the file — anyone who can read it holds a live cookie, which is the whole thing this design exists to prevent');
  assert.match(S.sessionKey(sid), /^[0-9a-f]{64}$/);
  assert.equal(S.sessionKey(sid), createHash('sha256').update(sid).digest('hex'),
    'sessionKey is not sha256 of the id — the disk key and the cookie must be related by a one-way function, not an encoding');
  assert.ok(JSON.parse(raw).sessions[S.sessionKey(sid)], 'the hashed key is not the key actually written');
});

test('the file is 0600 — the same mode as the credential store beside it', () => {
  fresh();
  S.persistSessions(new Map([[S.sessionKey('x'), { user: 'a@example.com', createdAt: Date.now(), lastSeenAt: Date.now() }]]), { force: true });
  assert.equal(statSync(STORE).mode & 0o777, 0o600);
});

// ── 2. a provider access token is never written ───────────────────────────────────────────────
test('an OAuth access token in the record does not reach the disk', () => {
  fresh();
  // serve.mjs really does put `token` in the session record when a live exchange runs. The
  // allowlist in sessions.mjs is what stops it travelling; a denylist would have to be updated
  // every time a field is added, and would be updated one time too late.
  // nosemgrep: generic.secrets.security.detected-google-oauth-access-token.detected-google-oauth-access-token -- synthetic test value, not a credential
  const rec = { provider: 'google', user: 'a@example.com', createdAt: Date.now(), lastSeenAt: Date.now(), token: 'ya29.A0AVERY-REAL-LOOKING-TOKEN' };
  S.persistSessions(new Map([[S.sessionKey('s'), rec]]), { force: true });
  const raw = readFileSync(STORE, 'utf8');
  // nosemgrep: generic.secrets.security.detected-google-oauth-access-token.detected-google-oauth-access-token -- synthetic test value, not a credential
  assert.ok(!raw.includes('ya29.A0AVERY-REAL-LOOKING-TOKEN'), 'a live provider credential was written to disk');
  assert.ok(!raw.includes('token'), 'the token field is present in the persisted record');
  const back = S.loadSessions({ ttlMs: TTL, knownUsers: KNOWN }).sessions.get(S.sessionKey('s'));
  assert.equal(back.token, undefined, 'a token came back out of the store');
  assert.equal(back.user, 'a@example.com', 'the identity did not survive, which is the part that had to');
});

// ── 3. a restart cannot extend a session ──────────────────────────────────────────────────────
test('an idle-expired session is dropped on load, not revived by the restart that reads it', () => {
  fresh();
  const now = Date.now();
  const live = S.sessionKey('live'), dead = S.sessionKey('dead');
  S.persistSessions(new Map([
    [live, { user: 'a@example.com', createdAt: now - 7 * HOUR, lastSeenAt: now - 10 * 60 * 1000 }],
    [dead, { user: 'a@example.com', createdAt: now - 20 * HOUR, lastSeenAt: now - 9 * HOUR }],
  ]), { force: true });

  const out = S.loadSessions({ ttlMs: TTL, now, knownUsers: KNOWN });
  assert.ok(out.sessions.has(live), 'a session idle for 10 minutes was dropped');
  assert.ok(!out.sessions.has(dead), 'a session idle for 9 hours survived an 8-hour idle timeout — restarting the panel would launder an expired session into a live one');
  assert.equal(out.restored, 1);
  assert.equal(out.dropped, 1);
});

test('a hand-edited or corrupt key is refused rather than loaded', () => {
  fresh();
  writeFileSync(STORE, JSON.stringify({
    version: 1,
    sessions: { 'not-a-sha256': { user: 'a@example.com', createdAt: Date.now(), lastSeenAt: Date.now() } },
  }), { mode: 0o600 });
  const out = S.loadSessions({ ttlMs: TTL, knownUsers: KNOWN });
  assert.equal(out.sessions.size, 0, 'a key that cannot have come from sessionKey() was loaded anyway');
  assert.equal(out.dropped, 1);
});

test('a version this code does not understand drops everything rather than guessing', () => {
  fresh();
  const notes = [];
  writeFileSync(STORE, JSON.stringify({ version: 99, sessions: { [S.sessionKey('x')]: { user: 'a@example.com', lastSeenAt: Date.now() } } }), { mode: 0o600 });
  const out = S.loadSessions({ ttlMs: TTL, knownUsers: KNOWN, onNote: (m) => notes.push(m) });
  assert.equal(out.sessions.size, 0);
  assert.equal(notes.length, 1, 'a dropped store said nothing — the operator is signed out with no reason given');
});

// ── 4. unreadable admits nobody, and says so ──────────────────────────────────────────────────
test('a corrupt store yields no sessions AND is not silent about it', () => {
  fresh();
  writeFileSync(STORE, 'not json at all{{{', { mode: 0o600 });
  const notes = [];
  const out = S.loadSessions({ ttlMs: TTL, knownUsers: KNOWN, onNote: (m) => notes.push(m) });
  assert.equal(out.sessions.size, 0, 'a corrupt store admitted a session');
  assert.match(notes.join(' '), /not valid JSON/, 'the corruption was swallowed — this is the one case where "everyone must sign in again" needs a stated reason');
});

test('an ABSENT store is the one honest empty, and says nothing', () => {
  fresh();
  const notes = [];
  const out = S.loadSessions({ ttlMs: TTL, knownUsers: KNOWN, onNote: (m) => notes.push(m) });
  assert.equal(out.sessions.size, 0);
  assert.deepEqual(notes, [], 'a first boot with no store yet warned about nothing being wrong');
});

// ── the evict lever, and the throttle ─────────────────────────────────────────────────────────
test('evictAllSessions is a real lever — the restart used to be one by accident', () => {
  fresh();
  const m = new Map([[S.sessionKey('a'), { user: 'a@example.com', lastSeenAt: Date.now() }]]);
  S.persistSessions(m, { force: true });
  assert.ok(existsSync(STORE));
  assert.equal(S.evictAllSessions(m), 1);
  assert.equal(m.size, 0);
  assert.ok(!existsSync(STORE), 'the file survived the evict, so the next boot restores what was just signed out');
});

test('lastSeenAt writes are throttled, but a forced write always lands', () => {
  fresh();
  const m = new Map([[S.sessionKey('a'), { user: 'a@example.com', lastSeenAt: Date.now() }]]);
  assert.equal(S.persistSessions(m, { force: true }), true);
  assert.equal(S.persistSessions(m), false, 'an unforced write inside the window hit the disk — that is a syscall per request');
  assert.equal(S.persistSessions(m, { force: true }), true, 'a forced write was throttled — minting and ending a session must never be dropped');
});

// ── the wiring in serve.mjs ───────────────────────────────────────────────────────────────────
test('nothing keys a session by the raw id any more', () => {
  // A single surviving `oauthSessions.set(sid, ...)` would put a live token in the persisted table
  // under its own name, and it would work perfectly until someone read the file.
  for (const bad of ['oauthSessions.set(sid,', 'oauthSessions.get(sid)', 'oauthSessions.delete(sid)']) {
    assert.ok(!SERVE.includes(bad), `${bad} still keys the session map by the raw cookie value`);
  }
  assert.match(SERVE, /oauthSessions\.get\(sessionKey\(sid\)\)/);
});

test('logout and expiry reach the disk, not just memory', () => {
  // A logout that cleared only the map would be undone by the next restart reloading the session it
  // just ended — persistence turning the one control that must always work into one that works
  // until the panel bounces.
  const out = SERVE.slice(SERVE.indexOf("pathname === '/auth/logout'"), SERVE.indexOf("pathname === '/auth/logout'") + 1200);
  assert.match(out, /oauthSessions\.delete\(sessionKey\(sid\)\)/, 'logout does not remove the session');
  assert.match(out, /persistSessions\(oauthSessions, \{ force: true/, 'logout does not reach the store, so a restart signs the operator back in');
  const prune = SERVE.slice(SERVE.indexOf('function pruneOauth()'), SERVE.indexOf('function pruneOauth()') + 900);
  assert.match(prune, /persistSessions/, 'the idle prune never reaches disk — an expiry the store still holds is decorative');
});

test('the restart flushes before it hands over', () => {
  const at = SERVE.indexOf('function restartPanel()');
  assert.ok(at > -1);
  const body = SERVE.slice(at, at + 900);
  const flush = body.indexOf('persistSessions');
  const close = body.indexOf('closing listeners');
  assert.ok(flush > -1, 'the restart does not flush sessions, so the successor inherits a stale table');
  assert.ok(flush < close, 'the flush happens after the listeners start closing — it must be the first thing, while the process is still whole');
});

test('the successor is told which port to answer on', () => {
  // PORT resolves as `argv[2] || CW_ADMIN_PORT || 7878`, so a panel started as
  // `node admin/serve.mjs 7995` used to restart itself onto 7878 — silently, on a port the operator
  // was not talking to. Only the positional form was lost, which is why it survived: it works
  // perfectly for everyone using the default.
  assert.match(SERVE, /\[process\.execPath, join\(HERE, 'serve\.mjs'\), String\(PORT\)\]/,
    'the restart spawns its successor without a port, so a non-default port is dropped on restart');
});

// ── the button that says what it is doing ─────────────────────────────────────────────────────
test('the health poll cannot overwrite the label of an action in flight', () => {
  // The defect: the handler set "restarting…" and then, on its next line, awaited loadPanelHealth(),
  // which writes the idle label unconditionally. The operator saw the button flash and settle back
  // to "⬆ update panel (3)" before the process died under them.
  assert.match(SRC, /let phBusy=false;/, 'there is no in-flight flag, so the poll still owns the label during a restart');
  const at = SRC.indexOf('async function loadPanelHealth()');
  const body = SRC.slice(at, SRC.indexOf('\n}', at));
  const guard = body.indexOf('if(phBusy) return d;');
  const relabel = body.indexOf('b.textContent=d.code.stale');
  assert.ok(guard > -1, 'loadPanelHealth does not check the in-flight flag');
  assert.ok(guard < relabel, 'the in-flight check comes AFTER the relabel, so it guards nothing');
});

test('the button names the act it is performing', () => {
  // One element, two controls: "⟳ restart panel" and "⬆ update panel (N)". It said "restarting…"
  // for both, so pressing update reported something else happening.
  assert.match(SRC, /const updating=b\.classList\.contains\('ph-update'\);/, 'the handler does not read which mode the button was in');
  assert.match(SRC, /const verb=updating\?'updating':'restarting';/, 'the label does not follow the act');
  assert.match(SRC, /b\.textContent=verb\+'…'/, 'the in-flight label is not derived from the act');
  assert.match(SRC, /verb\+'… '\+Math\.round\(\(i\+1\)\/2\)\+'s'/, 'the 30s wait for the successor is silent — indistinguishable from hung');
  assert.match(SRC, /phBusy=false;\s*\n\s*line\.textContent=verb\+' refused/,
    'a refusal does not release the in-flight flag, so the button stays stuck on a transition that never started');
});

// ── 5. a session is only as good as the account it names ──────────────────────────────────────
test('revoking an account ends its sessions, which in-memory storage used to get for free', () => {
  // THE REGRESSION THIS CLOSES, found by HAZOP OTHER THAN/STALE on the session-to-account boundary
  // and then reproduced: while the table lived in memory, deleting a user and restarting the panel
  // ended their sessions, because the restart ended ALL of them. Persisting sessions silently took
  // that away — measured, the restart restored a live session for an account with zero users left
  // in the store, at the same moment needsBootstrap() went true and the bootstrap window reopened.
  fresh();
  const now = Date.now();
  S.persistSessions(new Map([
    [S.sessionKey('still-here'), { user: 'a@example.com', createdAt: now, lastSeenAt: now }],
    [S.sessionKey('deleted'), { user: 'gone@example.com', createdAt: now, lastSeenAt: now }],
  ]), { force: true });

  const notes = [];
  const out = S.loadSessions({ ttlMs: TTL, knownUsers: KNOWN, onNote: (m) => notes.push(m) });
  assert.ok(out.sessions.has(S.sessionKey('still-here')), 'a session for a live account was dropped');
  assert.ok(!out.sessions.has(S.sessionKey('deleted')),
    'a session for an account that no longer exists was restored — deleting a user stopped ending their access');
  assert.equal(out.orphaned, 1);
  assert.match(notes.join(' '), /no longer exists/, 'the orphan was dropped silently — the operator cannot see a revocation taking effect');
});

test('an unverifiable session is dropped, and omitting knownUsers drops everything', () => {
  // Absent means DROP. The alternative default — restore what you cannot check — is the one nobody
  // would notice, and this module's whole argument is that here empty is the restrictive answer.
  fresh();
  const now = Date.now();
  S.persistSessions(new Map([
    [S.sessionKey('nouser'), { provider: 'google', createdAt: now, lastSeenAt: now }],   // no user at all
    [S.sessionKey('ok'), { user: 'a@example.com', createdAt: now, lastSeenAt: now }],
  ]), { force: true });

  assert.equal(S.loadSessions({ ttlMs: TTL, knownUsers: KNOWN }).sessions.size, 1,
    'a session carrying no user was restored — it cannot be checked against any account');
  assert.equal(S.loadSessions({ ttlMs: TTL }).sessions.size, 0,
    'omitting knownUsers restored sessions — the safe default must be to drop, not to keep');
  assert.equal(S.loadSessions({ ttlMs: TTL, knownUsers: [] }).sessions.size, 0);
  // Case and whitespace: emails are normalised in the auth store, and a join that is case-sensitive
  // would silently orphan every session on a store that capitalises.
  assert.equal(S.loadSessions({ ttlMs: TTL, knownUsers: new Set(['a@example.com']) }).sessions.size, 1);
});

test('serve.mjs reads the account store BEFORE restoring, and survives it being unreadable', () => {
  const at = SERVE.indexOf('const { sessions, restored, dropped } = loadSessions(');
  assert.ok(at > -1, 'the boot restore moved');
  const before = SERVE.slice(Math.max(0, at - 700), at);
  assert.match(before, /listUsers\(\)/, 'the account store is not read before sessions are restored, so nothing validates them');
  assert.match(before, /catch \(e\)/, 'an unreadable account store would throw during boot instead of restoring no sessions');
  assert.match(SERVE.slice(at, at + 300), /knownUsers: known/, 'the known-user set is not passed to loadSessions');
});
