// A bulk lodging answers for every row it was given: applied, unchanged, or refused with the
// reason. A row read before someone else changed it is refused, not overwritten; a row already
// carrying the same fix is reported unchanged and writes no event; a refused row never stops the
// others. The batch is bounded so a selection the body cap would truncate is paged instead.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes, FIX_BULK_MAX } from '../routes/issue-detail.mjs';
import { emptyIssuesDoc, mintIssue, saveIssues, loadIssues, withIssuesLock } from '../../monitor/issue-store.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-fixbulk-'));
const ISSUES = join(TMP, 'issues.json');
const KEYS = ['CW_ISSUES', 'CW_ISSUES_JSON', 'CW_ISSUE_STORE', 'CW_LEARNING', 'CW_NOW'];
const saved = {};
const AT = '2026-08-01T00:00:00.000Z';
let ids = [];

before(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.CW_ISSUES = ISSUES;
  process.env.CW_LEARNING = join(TMP, 'learning.json');
  withIssuesLock(() => {
    const doc = emptyIssuesDoc();
    doc.organisation = 'FIXTURE';
    ids = ['one', 'two', 'three'].map((n) => mintIssue(doc, {
      area: 'fixarea', repo: 'fixrepo', kind: 'code', severity: 'high',
      title: `js/sql-injection in src/${n}.js (fixrepo)`,
      source: { kind: 'scanner-row', key: `sc:fixrepo|sastSemgrep|js/sql-injection|src/${n}.js`, tool: 'sastSemgrep', rule: 'js/sql-injection' },
    }, AT).id);
    saveIssues(doc, { path: ISSUES });
  }, { path: ISSUES });
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

const BULK = routes.find((r) => r.method === 'POST' && r.path === '/api/issues/fix-bulk');
const SESSION = { user: 'op@example.test', provider: 'password' };
const call = ({ body, session = SESSION, bodyErr = null } = {}) => new Promise((resolve) => {
  BULK.handle({
    req: {}, isLoopbackReq: false, adminSession: () => session,
    readJsonBody: (_r, cb) => cb(bodyErr ? null : body, bodyErr),
    send: (code, payload) => resolve({ code, payload }),
  });
});
const events = () => loadIssues({ path: ISSUES }).events.length;
const item = (id, over = {}) => ({ id, fixType: 'code-change', notes: 'parameterised the query and added a test', ...over });

test('the route exists and refuses without a session or without items', async () => {
  assert.ok(BULK);
  assert.equal((await call({ session: null, body: { items: [item(ids[0])] } })).code, 401);
  assert.equal((await call({ body: {} })).code, 400);
  assert.equal((await call({ body: { items: [] } })).code, 400);
  assert.equal((await call({ body: { items: 'x' } })).code, 400);
  assert.equal((await call({ body: null, bodyErr: 'body too large' })).code, 400);
  const over = await call({ body: { items: Array.from({ length: FIX_BULK_MAX + 1 }, () => item(ids[0])) } });
  assert.equal(over.code, 400);
  assert.equal(over.payload.max, FIX_BULK_MAX);
  assert.equal(events(), 3, 'nothing was written by any refusal');
});

test('a mixed batch answers per row and writes only the rows that applied', async () => {
  const before = loadIssues({ path: ISSUES });
  const r = await call({ body: { items: [
    item(ids[0]),
    item('ISS-NOPE-S-000000'),
    item(ids[1], { expectUpdatedAt: '2001-01-01T00:00:00.000Z' }),
    item(ids[2], { fixType: 'not-a-type' }),
  ] } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.payload.results.map((x) => x.status), [200, 404, 409, 400]);
  assert.equal(r.payload.applied, 1);
  assert.equal(r.payload.refused, 3);
  assert.equal(r.payload.unchanged, 0);
  assert.equal(r.payload.stillOpen, true);
  assert.match(r.payload.results[2].error, /changed since this selection was read/);
  assert.equal(r.payload.results[2].updatedAt, before.issues[ids[1]].updatedAt, 'the refusal states the current stamp');
  assert.match(r.payload.results[3].error, /fixType must be one of/);
  const after = loadIssues({ path: ISSUES });
  assert.equal(after.issues[ids[0]].fix.fixType, 'code-change');
  assert.ok(!after.issues[ids[1]].fix, 'the stale row was not written');
  assert.ok(!after.issues[ids[2]].fix, 'the invalid row was not written');
  assert.equal(after.issues[ids[0]].state, 'open', 'a lodged fix closes nothing');
  assert.equal(after.events.length, before.events.length + 1);
});

test('the same fix again is unchanged and writes no event; a matching precondition applies', async () => {
  const n = events();
  const stamp = loadIssues({ path: ISSUES }).issues[ids[1]].updatedAt;
  const r = await call({ body: { items: [item(ids[0]), item(ids[1], { expectUpdatedAt: stamp })] } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.payload.results.map((x) => !!x.unchanged), [true, false]);
  assert.equal(r.payload.unchanged, 1);
  assert.equal(r.payload.applied, 1);
  assert.equal(events(), n + 1, 'one event for the one row that changed');
  const again = await call({ body: { items: [item(ids[0]), item(ids[1])] } });
  assert.equal(again.payload.applied, 0);
  assert.equal(again.payload.unchanged, 2);
  assert.equal(events(), n + 1, 'an idempotent repeat writes nothing');
  assert.equal(again.payload.learning, undefined, 'no learning refresh when nothing applied');
});

test('an unreadable store is a 503, never a partial batch', async () => {
  const bytes = readFileSync(ISSUES, 'utf8');
  process.env.CW_ISSUES = join(TMP, 'missing-dir', 'issues.json');
  try {
    // ENOENT is the store's "legitimately empty": every id is then unknown, and the batch says so per row
    const r = await call({ body: { items: [item(ids[0])] } });
    assert.equal(r.code, 200);
    assert.equal(r.payload.results[0].status, 404);
  } finally { process.env.CW_ISSUES = ISSUES; }
  assert.equal(readFileSync(ISSUES, 'utf8'), bytes, 'the real store is untouched');
});
