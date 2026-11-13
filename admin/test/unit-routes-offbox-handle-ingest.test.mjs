// handleIngest: which requests it answers, with what status, and what reaches the page store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleIngest, readPages, TOKEN_ENV } from '../routes/offbox.mjs';

const HOST = 'remote.commitwork.online';
const TOKEN = 't'.repeat(32);
const PATH = '/api/offbox/page';
let dir;

test.beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cw-offbox-ingest-')); });
test.afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// CW_SECRETS_FILE names a file that does not exist, so the declared token comes from env alone.
const env = (over = {}) => ({
  CW_SECRETS_FILE: join(dir, 'absent-secrets.env'),
  CW_OFFBOX_PAGE_STORE: join(dir, 'pages.jsonl'),
  CW_OFFBOX_PANEL_HOSTS: HOST,
  [TOKEN_ENV]: TOKEN,
  ...over,
});

const post = ({ host = HOST, auth = `Bearer ${TOKEN}`, method = 'POST' } = {}) =>
  ({ method, headers: { host, ...(auth == null ? {} : { authorization: auth }) } });

function call({ req = post(), pathname = PATH, body = { state: 'ok' }, bodyError = null, e = env() } = {}) {
  const sent = [];
  const headers = {};
  let bodyRead = false;
  const answered = handleIngest({
    req,
    pathname,
    env: e,
    res: { setHeader: (k, v) => { headers[k.toLowerCase()] = v; } },
    send: (code, payload) => { sent.push({ code, payload }); },
    readJsonBody: (_req, cb) => { bodyRead = true; cb(body, bodyError); },
  });
  return { answered, sent, headers, bodyRead, get store() { return readPages(e); } };
}

test('a request other than POST to the ingest path is declined unanswered', () => {
  for (const r of [call({ req: post({ method: 'GET' }) }), call({ pathname: '/api/offbox/pages' })]) {
    assert.equal(r.answered, false);
    assert.deepEqual(r.sent, []);
    assert.equal(r.store.absent, true);
  }
});

test('a host outside the declared set is declined even with the right token', () => {
  const r = call({ req: post({ host: 'commitwork.online' }) });
  assert.equal(r.answered, false);
  assert.deepEqual(r.sent, []);
  assert.equal(r.store.absent, true);
});

test('the host match ignores a port suffix', () => {
  const r = call({ req: post({ host: `${HOST}:8443` }) });
  assert.equal(r.answered, true);
  assert.equal(r.sent[0].code, 200);
});

test('the host match ignores letter case', () => {
  const r = call({ req: post({ host: HOST.toUpperCase() }) });
  assert.equal(r.answered, true);
  assert.equal(r.sent[0].code, 200);
});

test('no declared token answers 503 once and never reads the body', () => {
  const e = env();
  delete e[TOKEN_ENV];
  const r = call({ e });
  assert.equal(r.answered, true);
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].code, 503);
  assert.equal(r.sent[0].payload.ok, false);
  assert.match(r.sent[0].payload.error, new RegExp(TOKEN_ENV));
  assert.equal(r.bodyRead, false);
  assert.equal(r.store.absent, true);
});

test('a wrong or missing token answers 401 with a Bearer challenge and never reads the body', () => {
  for (const auth of ['Bearer wrong', null]) {
    const r = call({ req: post({ auth }) });
    assert.equal(r.answered, true, String(auth));
    assert.equal(r.sent.length, 1, String(auth));
    assert.equal(r.sent[0].code, 401, String(auth));
    assert.equal(r.headers['www-authenticate'], 'Bearer', String(auth));
    assert.equal(r.bodyRead, false, String(auth));
    assert.equal(r.store.absent, true, String(auth));
  }
});

test('an unreadable body answers 400 with the reader error and writes nothing', () => {
  const r = call({ bodyError: 'invalid json' });
  assert.equal(r.answered, true);
  assert.deepEqual(r.sent, [{ code: 400, payload: { ok: false, error: 'invalid json' } }]);
  assert.equal(r.store.absent, true);
});

test('an authorized page answers 200 and lands one re-shaped record', () => {
  const r = call({ body: { state: 'STALE-LEDGER', ref: 'abc123', alarms: 2, extra: 'dropped' } });
  assert.equal(r.answered, true);
  assert.deepEqual(r.sent, [{ code: 200, payload: { ok: true, mode: 'chained', state: 'STALE-LEDGER' } }]);
  assert.equal(r.store.pages.length, 1);
  const [page] = r.store.pages;
  assert.equal(page.kind, 'offbox-page');
  assert.equal(page.ref, 'abc123');
  assert.equal(page.alarms, 2);
  assert.equal('extra' in page, false);
});

test('a store that cannot take the append answers 503 with ok false', () => {
  const store = join(dir, 'store-is-a-directory');
  mkdirSync(store);
  const r = call({ e: env({ CW_OFFBOX_PAGE_STORE: store }) });
  assert.equal(r.answered, true);
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].code, 503);
  assert.equal(r.sent[0].payload.ok, false);
});

test('a write that throws answers 503 naming the page store', () => {
  const body = { get state() { throw new Error('body getter failed'); } };
  const r = call({ body });
  assert.equal(r.answered, true);
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].code, 503);
  assert.match(r.sent[0].payload.error, /^page store unavailable: body getter failed/);
  assert.equal(r.store.absent, true);
});
