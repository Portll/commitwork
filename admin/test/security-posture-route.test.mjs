// GET and POST /api/security-posture through their handlers with the ctx the dispatcher builds, as
// mounted (through admin/routes/features.mjs). Asserted: the store on disk, the status, the
// attribution; plus that the Settings section and its key list match the read module.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HERE, '..');
const TMP = mkdtempSync(join(tmpdir(), 'cw-secp-route-'));
const STORE = join(TMP, 'settings.json');
const ENV = ['CW_UNATTENDED_POSTURE', 'CW_BYPASS_IS_UNATTENDED', 'CW_MISSING_MODE_IS_UNATTENDED', 'CW_MCP_REPO_ROOTS', 'CW_MCP_REPO_CODE'];
const KEYS = ['HOME', 'CW_SETTINGS', 'CW_SETTINGS_STORE', 'CW_APPROVAL_QUEUE', ...ENV];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
for (const k of KEYS) delete process.env[k];
Object.assign(process.env, { HOME: join(TMP, 'home'), CW_SETTINGS: STORE, CW_APPROVAL_QUEUE: join(TMP, 'queue.jsonl') });
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

const { routes } = await import('../routes/features.mjs');
const { resetSettingsWarnings } = await import('../../monitor/settings.mjs');
const { POSTURE_KEYS } = await import('../../lib/security-posture.mjs');
const { NOT_ENFORCED, QUEUE_WRITER, WRITE_NEEDS_SESSION, securityPosturePayload } = await import('../routes/security-posture.mjs');
const { panelSource } = await import('./lib/panel-source.mjs');

const GET = routes.find((r) => r.method === 'GET' && r.path === '/api/security-posture');
const POST = routes.find((r) => r.method === 'POST' && r.path === '/api/security-posture');
const SESSION = { user: 'op@example.test', provider: 'password' };
const call = (route, { body = {}, bodyErr = null, session = SESSION, loopback = false } = {}) =>
  new Promise((done) => {
    Promise.resolve(route.handle({
      req: {}, isLoopbackReq: loopback, adminSession: () => session, query: new URLSearchParams(),
      readJsonBody: (_r, cb) => cb(bodyErr ? null : body, bodyErr),
      send: (code, payload) => done({ code, payload }),
    })).catch((e) => done({ code: 'threw', payload: String(e && e.message) }));
  });
const store = () => (existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : null);
const fresh = () => { rmSync(STORE, { force: true }); resetSettingsWarnings(); for (const k of ENV) delete process.env[k]; };

test('both routes are mounted', () => {
  assert.ok(GET && POST);
});

test('no session off the operator port is 401, and the store is not created', async () => {
  fresh();
  for (const route of [GET, POST]) {
    const r = await call(route, { session: null, body: { key: 'unattendedPosture', value: 'off' } });
    assert.equal(r.code, 401);
  }
  assert.equal(store(), null);
});

test('GET: every setting at its default, with its declaration and an approval queue that is not recording', async () => {
  fresh();
  const r = await call(GET, { session: null, loopback: true });
  assert.equal(r.code, 200);
  assert.deepEqual(Object.keys(r.payload.settings), POSTURE_KEYS);
  const v = Object.fromEntries(POSTURE_KEYS.map((k) => [k, [r.payload.settings[k].value, r.payload.settings[k].source]]));
  assert.deepEqual(v, {
    unattendedPosture: ['A', 'default'], bypassCountsAsUnattended: [false, 'default'], missingModeIsUnattended: [true, 'default'],
    humanCommitMessagesOnly: [false, 'default'], runChecksRoots: [[], 'default'], runChecksRepoCode: ['opt-in', 'default'],
    runChecksRepoCodeRepos: [[], 'default'], runChecksRootsReviewDays: [30, 'default'],
  });
  assert.deepEqual(r.payload.keys.unattendedPosture.options.map((o) => o.id), ['off', 'A', 'B', 'C']);
  assert.match(r.payload.keys.unattendedPosture.description, /approval flow is not built/);
  assert.match(r.payload.keys.missingModeIsUnattended.description, /measured sending the field/);
  // `writer` and `recording` ride on the queue because count: 0 is not self-explanatory: under any
  // posture but B or C nothing is recorded, which is the opposite of what an empty list usually says.
  assert.deepEqual(r.payload.queue, { path: join(TMP, 'queue.jsonl'), count: 0, refused: 0, allowed: 0, error: null, writer: QUEUE_WRITER, recording: false });
});

test('POST writes each kind of value to the store, stamped with the session', async () => {
  fresh();
  const writes = [['unattendedPosture', 'C'], ['bypassCountsAsUnattended', true], ['missingModeIsUnattended', true], ['humanCommitMessagesOnly', true], ['runChecksRoots', ['/srv/a', '/srv/b']], ['runChecksRepoCode', 'allow']];
  for (const [key, value] of writes) {
    const r = await call(POST, { body: { key, value } });
    assert.equal(r.code, 200, JSON.stringify(r.payload));
    assert.deepEqual(r.payload.settings[key].value, value);
    assert.equal(r.payload.settings[key].source, 'store');
    assert.equal(r.payload.written.key, key);
  }
  const s = store().settings;
  for (const [key, value] of writes) {
    assert.deepEqual(s[key].value, value);
    assert.match(s[key].by, /op@example\.test/);
  }
});

test('a write needs a signed-in session on either port; loopback alone may read but not write', async () => {
  fresh();
  for (const loopback of [true, false]) {
    const r = await call(POST, { session: null, loopback, body: { key: 'unattendedPosture', value: 'off' } });
    assert.equal(r.code, 401, `loopback=${loopback}`);
    assert.equal(r.payload.error, WRITE_NEEDS_SESSION);
  }
  assert.equal(existsSync(join(TMP, 'settings.json')), false, 'nothing was written');
  assert.equal((await call(GET, { session: null, loopback: true })).code, 200, 'the operator port still reads');
  const ok = await call(POST, { loopback: true, body: { key: 'unattendedPosture', value: 'B' } });
  assert.equal(ok.code, 200);
  assert.match(store().settings.unattendedPosture.by, /op@example\.test/, 'a write is attributed to the person, never to the port');
});

test('POST refuses a bad body, an unknown key and an invalid value with 400; nothing is written', async () => {
  fresh();
  const bad = [
    [{ key: 'unattendedPosture' }, /value` is required/],
    [{ key: 'unattendedPosture', value: 'A', extra: 1 }, /unknown field/],
    [{ key: 'sweepHangMs', value: 1 }, /not a security setting/],
    [{ key: 'unattendedPosture', value: 'D' }, /must be one of off, A, B, C/],
    [{ key: 'runChecksRoots', value: ['relative'] }, /not absolute/],
    [{ key: 'bypassCountsAsUnattended', value: 'yes' }, /true or false/],
  ];
  for (const [body, why] of bad) {
    const r = await call(POST, { body });
    assert.equal(r.code, 400, JSON.stringify(body));
    assert.match(r.payload.error, why);
  }
  assert.equal((await call(POST, { bodyErr: 'bad json' })).code, 400);
  assert.equal(store(), null);
});

test('a write the env shadows is 409, naming the variable; GET reports the env as the source', async () => {
  fresh();
  process.env.CW_MCP_REPO_CODE = 'opt-in';
  try {
    const r = await call(POST, { body: { key: 'runChecksRepoCode', value: 'allow' } });
    assert.equal(r.code, 409);
    assert.match(r.payload.error, /CW_MCP_REPO_CODE/);
    assert.equal(store(), null);
    const g = await call(GET);
    assert.deepEqual([g.payload.settings.runChecksRepoCode.value, g.payload.settings.runChecksRepoCode.source], ['opt-in', 'env:CW_MCP_REPO_CODE']);
  } finally { delete process.env.CW_MCP_REPO_CODE; }
});

test('an unreadable store: GET answers with the stricter readings and the error; POST is 503 and leaves the file', async () => {
  fresh();
  writeFileSync(STORE, '{torn');
  const g = await call(GET);
  assert.equal(g.code, 200);
  assert.match(g.payload.storeError, /unparseable/);
  assert.equal(g.payload.settings.runChecksRoots.value, null);
  assert.equal(g.payload.settings.runChecksRepoCode.value, 'opt-in');
  const p = await call(POST, { body: { key: 'unattendedPosture', value: 'off' } });
  assert.equal(p.code, 503);
  assert.equal(readFileSync(STORE, 'utf8'), '{torn');
});

test('the Settings view carries the section, and its key list is the read module\'s', () => {
  const src = panelSource();
  assert.match(src, /<section id="sec-security-posture">/);
  assert.match(src, /id="secp-rows"/);
  const js = readFileSync(join(ADMIN, 'static', 'panel-settings.js'), 'utf8');
  const m = /const SECP_KEYS=(\[[^\]]*\]);/.exec(js);
  assert.ok(m, 'SECP_KEYS is not declared in panel-settings.js');
  assert.deepEqual(JSON.parse(m[1].replace(/'/g, '"')), POSTURE_KEYS);
  assert.match(js, /fetch\('\/api\/security-posture'\)/);
  assert.match(js, /cwPost\('\/api\/security-posture'/);
});

// A posture setting stored and served while askOutcome and recordRefusal have no caller makes
// "0 refusal(s) recorded" read as "nothing was refused" rather than "nothing can record one". The
// view's enforcement claims are keyed to the TREE, not to prose: each is checked against
// whether its consumer actually calls in, so a consumer that stops calling fails this test instead of
// leaving an "enforced" label behind.
describe('the view claims exactly the enforcement the tree has', () => {
  const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const nonTestCallers = (symbol) => {
    const out = execFileSync('git', ['-C', REPO, 'ls-files', '*.mjs'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    return out.filter((f) => !/(^|\/)test\/|\.test\.mjs$/.test(f) && f !== 'lib/security-posture.mjs')
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal name or class taken from the test itself
      .filter((f) => new RegExp(`\\b${symbol}\\s*\\(`).test(readFileSync(join(REPO, f), 'utf8')));
  };

  test('the keys askOutcome gates are marked enforced only while the guard calls it', () => {
    const callers = nonTestCallers('askOutcome');
    assert.ok(callers.includes('bin/hooks/guard-destructive.mjs'),
      `askOutcome's non-test callers are [${callers.join(', ')}]. Without the guard, unattendedPosture, bypassCountsAsUnattended and missingModeIsUnattended enforce nothing: mark them in NOT_ENFORCED in admin/routes/security-posture.mjs.`);
    for (const k of POSTURE_KEYS) assert.equal(NOT_ENFORCED[k], null, `${k} is enforced; marking it otherwise would understate the posture`);
    assert.deepEqual(Object.keys(NOT_ENFORCED).sort(), [...POSTURE_KEYS].sort(),
      'every posture key needs an enforcement answer, so a new key cannot arrive unanswered');
  });

  test('the queue\'s writer is the guard under postures B and C, and the payload says when nothing is recording', () => {
    for (const writer of ['recordRefusal', 'recordAllowed']) {
      assert.deepEqual(nonTestCallers(writer), ['bin/hooks/guard-destructive.mjs'],
        `QUEUE_WRITER names the guard as the only writer; a new or vanished ${writer} caller must be reflected there`);
    }
    assert.equal(QUEUE_WRITER.wired, true);
    assert.deepEqual([...QUEUE_WRITER.recordsUnder], ['B', 'C']);
    assert.match(QUEUE_WRITER.why, /empty list/i, 'the reason must name what an empty list does NOT mean');
    for (const [mode, recording] of [['off', false], ['A', false], ['B', true], ['C', true]]) {
      assert.equal(securityPosturePayload({ env: { CW_UNATTENDED_POSTURE: mode } }).queue.recording, recording, mode);
    }
  });
});
