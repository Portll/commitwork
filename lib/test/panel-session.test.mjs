// lib/panel-session.mjs — the panel it boots must write and resolve credentials only inside its own
// scratch dir. It used to override CW_AUTH_STORE alone, so the booted panel wrote the checkout's
// .claude/store/panel-code-stamp.json and resolved OAuth secrets from the live
// ~/.commitwork/secrets.json and its keychain refs.
//
// Two witnesses that cannot share a failure: sessionEnv() is the contract, and startPanel() is driven
// against a stand-in entry that records the env it was actually spawned with, so a startPanel that
// stopped using sessionEnv() fails here too. The stand-in answers GET / and serves no CSRF token, so
// startPanel stops it at the first step after boot. No real panel is started.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'cw-panel-session-test-'));
const LIVE_HOME = process.env.HOME;
process.env.HOME = TMP;
after(() => { process.env.HOME = LIVE_HOME; rmSync(TMP, { recursive: true, force: true }); });

const { sessionEnv, startPanel, ROOT } = await import('../panel-session.mjs');

const STORES = ['CW_AUTH_STORE', 'CW_SESSION_STORE', 'CW_PANEL_CODE_STAMP', 'CW_SECRETS_FILE'];
const inside = (dir, p) => { const r = relative(dir, p); return !!r && !r.startsWith('..') && !isAbsolute(r); };

test('sessionEnv moves HOME and every store the panel writes or reads credentials from into scratch', () => {
  const scratch = join(TMP, 'scratch');
  const base = {
    PATH: '/usr/bin', HOME: '/Users/operator', USERPROFILE: 'C:\\Users\\operator',
    CW_SECRETS_FILE: '/Users/operator/.commitwork/secrets.json',
    CW_PANEL_CODE_STAMP: join(ROOT, '.claude', 'store', 'panel-code-stamp.json'),
    CW_SESSION_STORE: '/Users/operator/.commitwork/sessions.json',
  };
  const env = sessionEnv(scratch, { port: 41001, localPort: 41002 }, base);
  assert.equal(env.HOME, scratch);
  assert.equal(env.USERPROFILE, scratch);
  for (const k of STORES) assert.ok(inside(scratch, env[k]), `${k}=${env[k]} is outside the scratch dir`);
  assert.equal(env.CW_ADMIN_PORT, '41001');
  assert.equal(env.CW_ADMIN_LOCAL_PORT, '41002');
  assert.equal(env.PATH, '/usr/bin', 'the rest of the environment passes through');
  assert.equal(base.CW_SECRETS_FILE, '/Users/operator/.commitwork/secrets.json', 'the caller\'s env is not mutated');
});

test('startPanel spawns the panel with that env, not the caller\'s stores', async () => {
  const OUT = join(TMP, 'spawned-env.json');
  const FAKE = join(TMP, 'fake-serve.mjs');
  const keys = ['HOME', 'USERPROFILE', 'CW_ADMIN_PORT', 'CW_ADMIN_LOCAL_PORT', ...STORES];
  // Records first, then listens: by the time startPanel sees an answer, the record is on disk.
  writeFileSync(FAKE, [
    "import { writeFileSync } from 'node:fs';",
    "import http from 'node:http';",
    `writeFileSync(${JSON.stringify(OUT)}, JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map((k) => [k, process.env[k] ?? null]))));`,
    "http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); })",
    "  .listen(Number(process.env.CW_ADMIN_LOCAL_PORT), '127.0.0.1');",
  ].join('\n'));
  const live = { CW_SECRETS_FILE: process.env.CW_SECRETS_FILE, CW_PANEL_CODE_STAMP: process.env.CW_PANEL_CODE_STAMP };
  process.env.CW_SECRETS_FILE = join(TMP, 'caller-secrets.json');
  process.env.CW_PANEL_CODE_STAMP = join(TMP, 'caller-stamp.json');
  let r;
  try { r = await startPanel({ timeoutMs: 15000, entry: FAKE }); }
  finally { for (const [k, v] of Object.entries(live)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  if (r && r.stop) r.stop();
  assert.equal(r.unavailable, 'no CSRF token', `the stand-in was not the process booted: ${JSON.stringify(r).slice(0, 300)}`);
  const env = JSON.parse(readFileSync(OUT, 'utf8'));
  const scratch = env.HOME;
  assert.ok(inside(tmpdir(), scratch), `HOME=${scratch} is not a scratch dir`);
  assert.notEqual(scratch, TMP, 'HOME is the session\'s own scratch dir, not the caller\'s HOME');
  assert.equal(env.USERPROFILE, scratch);
  for (const k of STORES) assert.ok(inside(scratch, env[k]), `${k}=${env[k]} is outside the session's scratch dir ${scratch}`);
  rmSync(scratch, { recursive: true, force: true });
});
