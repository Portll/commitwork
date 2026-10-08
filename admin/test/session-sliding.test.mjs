// The session TTL is IDLE time, not age. Absolute age logged the operator out mid-task at the 8h
// mark with work open, while the page still looked signed in and every fetch 401'd.
//
// pruneOauth and adminSession are lifted from serve.mjs (which cannot be imported — it starts a
// listener and reads the keychain) and driven with a controllable clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// split(/\r?\n/): under a CRLF checkout `l === '}'` never matches `'}\r'`, so the lift below found
// no column-0 close and this whole suite failed on Windows. See admin/test/lib/panel-source.mjs.
const L = serverSource().split(/\r?\n/);

function lift(name) {
  const s = L.findIndex((l) => l.startsWith(`function ${name}(`));
  assert.ok(s > -1, `serve.mjs no longer declares a top-level ${name} — update this extractor`);
  const e = L.findIndex((l, i) => i > s && l === '}');
  assert.ok(e > s, `could not find the column-0 close of ${name}`);
  return L.slice(s, e + 1).join('\n');
}

// The map is keyed by sha256(sid) now, not by the raw cookie value — see admin/sessions.mjs. The
// REAL key function is injected rather than an identity stub: the key is not what these tests are
// about, but a harness that quietly disagrees with the code about how a session is looked up is a
// harness that would keep passing after the lookup broke.
// persistSessions is counted, not stubbed to nothing. These tests drive a clock and must not touch
// the filesystem, but a no-op would also hide the prune losing its write — so the calls are
// recorded and the expiry test below asserts one happened.
import { sessionKey } from '../sessions.mjs';
import { serverSource } from './lib/server-source.mjs';

const HOUR = 3600_000;
let NOW = 1_000_000_000;
let persistCalls = 0;
const persistSessions = () => { persistCalls++; return true; };

const oauthSessions = new Map();
const HEARTBEAT_PATHS = new Set(['/api/status', '/api/state', '/api/panel/health']);
const fn = new Function(
  'Date', 'oauthFlows', 'oauthSessions', 'OAUTH_FLOW_TTL_MS', 'OAUTH_SESSION_TTL_MS', 'sidFromReq', 'HEARTBEAT_PATHS', 'URL',
  'sessionKey', 'persistSessions', 'console', 'ssoPending', 'SSO_TOTP_TTL_MS',
  `${lift('pruneOauth')}\n${lift('adminSession')}\nreturn { pruneOauth, adminSession };`,
)({ now: () => NOW }, new Map(), oauthSessions, 10 * 60_000, 8 * HOUR, (req) => req.sid, HEARTBEAT_PATHS, URL,
  sessionKey, persistSessions, console, new Map(), 10 * 60_000);

const mint = () => oauthSessions.set(sessionKey('s1'), { provider: 'password', createdAt: NOW, lastSeenAt: NOW, user: 'x' });
// An operator action. Heartbeats go through beat() below.
const alive = (url = '/api/annotations/scanner') => fn.adminSession({ sid: 's1', url }) !== null;
const beat = () => alive('/api/status');

test('the lift produced working functions — a broken extract would pass every case below', () => {
  oauthSessions.clear();
  mint();
  assert.ok(alive(), 'a freshly minted session must resolve, or the harness proves nothing');
  oauthSessions.clear();
  assert.ok(!alive(), 'an absent session must not resolve');
});

test('a session in use slides past its absolute age', () => {
  oauthSessions.clear();
  mint();
  for (let i = 0; i < 3; i++) {
    NOW += 7 * HOUR;
    assert.ok(alive(), 'used every 7h, so it must survive well past the 8h TTL — age is not the rule');
  }
});

test('a session left alone expires', () => {
  oauthSessions.clear(); NOW += HOUR; mint();
  NOW += 9 * HOUR;
  persistCalls = 0;
  assert.ok(!alive(), 'idle longer than the TTL must expire, or the timeout is not a timeout');
  // Sessions are persisted now, so an expiry that only cleared memory would be undone by the next
  // restart reloading the very session it just pruned. The prune has to reach the store.
  assert.ok(persistCalls > 0, 'the idle prune never wrote — the expiry would not survive a restart');
});

test('a session minted before lastSeenAt existed is not pruned as idle-since-epoch', () => {
  oauthSessions.clear(); NOW += HOUR;
  oauthSessions.set(sessionKey('s1'), { provider: 'password', createdAt: NOW, user: 'x' });
  assert.ok(alive(), 'a legacy session must fall back to createdAt, not vanish on the first request after a restart');
});

test('an already-idle session cannot refresh itself by being looked up', () => {
  oauthSessions.clear(); NOW += HOUR; mint();
  NOW += 9 * HOUR;
  alive();
  assert.ok(!alive(), 'the prune must run before the stamp, or a lookup revives what it should have removed');
});

// The window and the polls inside it are different clocks.
test('a heartbeat does NOT slide the window — an unattended open tab still times out', () => {
  oauthSessions.clear(); NOW += HOUR; mint();
  // 24h of polling at the panel's real cadence, with nobody there.
  for (let i = 0; i < 24; i++) { NOW += HOUR; beat(); }
  assert.ok(!beat(), 'polling held the session open; a tab left open would never expire');
});

test('a heartbeat still authenticates — it just is not evidence anyone is there', () => {
  oauthSessions.clear(); NOW += HOUR; mint();
  NOW += HOUR;
  assert.ok(beat(), 'a heartbeat inside a live window must still resolve its session');
});

test('operator activity slides the window even when heartbeats are interleaved', () => {
  oauthSessions.clear(); NOW += HOUR; mint();
  for (let i = 0; i < 4; i++) {
    NOW += 6 * HOUR;
    beat();          // a poll, which must not count
    assert.ok(alive(), 'an operator action every 6h must hold the window open');
  }
});
