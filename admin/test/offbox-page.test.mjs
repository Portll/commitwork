// admin/test/offbox-page.test.mjs — the ingest at remote.commitwork.online.
//
// The property under test is that an undeclared token CLOSES the route. An ingest that falls back
// to open when nothing is configured would be a write endpoint on the public internet whose only
// tell is a missing environment variable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authorize, normalisePage, recordPage, readPages, handleIngest, offboxHosts, pageStorePath, TOKEN_ENV }
  from '../routes/offbox.mjs';

const TOKEN = 'a'.repeat(40);
let dir;
const envWith = (over = {}) => ({ CW_SECRETS_FILE: join(dir, 'no-secrets.json'), CW_OFFBOX_PAGE_STORE: join(dir, 'pages.jsonl'), ...over });
const withToken = (over = {}) => envWith({ [TOKEN_ENV]: TOKEN, ...over });

test.beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cw-offbox-page-')); });
test.afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const req = (token, host = 'remote.commitwork.online') =>
  ({ method: 'POST', headers: { host, ...(token ? { authorization: `Bearer ${token}` } : {}) } });

test('an undeclared token refuses every page — it never falls back to open', () => {
  assert.equal(authorize(req(TOKEN), envWith()), 'no-token-configured');
  assert.equal(authorize(req(), envWith()), 'no-token-configured');
});

test('the right token is ok, a wrong one and a missing one are unauthorized', () => {
  assert.equal(authorize(req(TOKEN), withToken()), 'ok');
  assert.equal(authorize(req('b'.repeat(40)), withToken()), 'unauthorized');
  assert.equal(authorize(req('short'), withToken()), 'unauthorized');
  assert.equal(authorize(req(), withToken()), 'unauthorized');
});

test('a token too short to be one is treated as undeclared', () => {
  assert.equal(authorize(req('tiny'), envWith({ [TOKEN_ENV]: 'tiny' })), 'no-token-configured');
});

test('the stored record is re-shaped field by field, never the caller object', () => {
  const r = normalisePage({ state: 'STALE-LEDGER', ref: 'abc', ledgerAgeHours: 118.9, alarms: 2,
    at: '2026-09-25T01:00:00Z', extra: 'dropped', __proto__: { polluted: true } }, '2026-09-25T01:00:01Z');
  assert.equal(r.extra, undefined);
  assert.equal(r.polluted, undefined);
  assert.equal(r.state, 'STALE-LEDGER');
  assert.equal(r.alarms, 2);
  assert.equal(r.receivedAt, '2026-09-25T01:00:01Z');
});

test('a state nobody declares is recorded as unrecognised, with what was claimed kept beside it', () => {
  const r = normalisePage({ state: 'ok-ish-probably' }, 'now');
  assert.equal(r.state, 'unrecognised');
  assert.equal(r.declaredState, 'ok-ish-probably');
});

test('a non-object body yields a bounded record rather than throwing', () => {
  for (const body of [null, 'string', 42, ['a']]) {
    const r = normalisePage(body, 'now');
    assert.equal(r.state, 'unrecognised');
    assert.equal(r.alarms, 0);
  }
});

test('pages land chained, newest first on read, and a torn line is counted not swallowed', () => {
  const env = withToken();
  recordPage({ state: 'ok', ref: 'r1' }, { env, at: '2026-09-25T01:00:00Z' });
  recordPage({ state: 'ALARM', ref: 'r2' }, { env, at: '2026-09-25T02:00:00Z' });
  const store = pageStorePath(env);
  writeFileSync(store, `${readFileSync(store, 'utf8')}{ not json\n`);
  const out = readPages(env);
  assert.equal(out.pages[0].ref, 'r2');
  assert.equal(out.torn, 1);
  assert.equal(out.records, 3);
  const lines = readFileSync(store, 'utf8').split('\n').filter(Boolean);
  assert.equal(JSON.parse(lines[0]).prev, 'genesis');
  assert.equal(JSON.parse(lines[1]).prev.length, 32);
});

test('a store that has never been written is absent, which the view states rather than showing a pass', () => {
  const out = readPages(envWith());
  assert.deepEqual({ absent: out.absent, pages: out.pages.length }, { absent: true, pages: 0 });
});

/** A send/readJsonBody pair of the shape serve.mjs passes in. */
function ctx(body) {
  const sent = {};
  return {
    sent,
    send: (code, payload) => { sent.code = code; sent.payload = payload; },
    res: { setHeader() {} },
    readJsonBody: (_req, cb) => cb(body, null),
  };
}

test('the ingest answers only POST /api/offbox/page and declines everything else', () => {
  const c = ctx({});
  assert.equal(handleIngest({ req: { method: 'GET', headers: {} }, ...c, pathname: '/api/offbox/page', env: withToken() }), false);
  assert.equal(handleIngest({ req: req(TOKEN), ...c, pathname: '/api/offbox/other', env: withToken() }), false);
  assert.equal(c.sent.code, undefined, 'a declined request must not be answered here');
});

test('another panel hostname never reaches the ingest, even with the right token', () => {
  const c = ctx({ state: 'ALARM' });
  const env = withToken();
  for (const host of ['commitwork.online', 'launchlist.commitwork.online', '127.0.0.1:7878', '']) {
    assert.equal(handleIngest({ req: req(TOKEN, host), ...c, pathname: '/api/offbox/page', env }), false, host);
  }
  assert.equal(c.sent.code, undefined, 'declined requests fall through to the CSRF and login gates');
  assert.equal(readPages(env).absent, true);
});

test('an unauthorized page is 401 and nothing is written', () => {
  const c = ctx({ state: 'ALARM' });
  const env = withToken();
  assert.equal(handleIngest({ req: req('wrong'), ...c, pathname: '/api/offbox/page', env }), true);
  assert.equal(c.sent.code, 401);
  assert.equal(readPages(env).absent, true);
});

test('an undeclared token answers 503 and writes nothing', () => {
  const c = ctx({ state: 'ALARM' });
  const env = envWith();
  assert.equal(handleIngest({ req: req(TOKEN), ...c, pathname: '/api/offbox/page', env }), true);
  assert.equal(c.sent.code, 503);
  assert.match(c.sent.payload.error, /refuses/);
  assert.equal(readPages(env).absent, true);
});

test('an authorized page lands and reports the append mode it actually got', () => {
  const c = ctx({ state: 'STALE-LEDGER', ref: 'deadbeef', ledgerAgeHours: 120.2 });
  const env = withToken();
  assert.equal(handleIngest({ req: req(TOKEN), ...c, pathname: '/api/offbox/page', env }), true);
  assert.deepEqual({ code: c.sent.code, ok: c.sent.payload.ok, mode: c.sent.payload.mode, state: c.sent.payload.state },
    { code: 200, ok: true, mode: 'chained', state: 'STALE-LEDGER' });
  assert.equal(readPages(env).pages[0].ledgerAgeHours, 120.2);
});

test('the hostname set is read at call time and defaults to remote.commitwork.online', () => {
  assert.ok(offboxHosts({}).has('remote.commitwork.online'));
  assert.deepEqual([...offboxHosts({ CW_OFFBOX_PANEL_HOSTS: 'a.example, B.example' })], ['a.example', 'b.example']);
});
