// Four keys, four different writes, none of them a verdict on the finding: accept claims, decline
// files a NAMED ruling with a reason through the judgement path, duplicate closes as superseded by a
// real target, snooze sets a field. A row that moved since it was read is refused, not overwritten.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes, TRIAGE_ACTIONS } from '../routes/issue-detail.mjs';
import { emptyIssuesDoc, mintIssue, saveIssues, loadIssues, withIssuesLock } from '../../monitor/issue-store.mjs';
import { subjectDigest } from '../../monitor/ingest-external.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-triage-'));
const ISSUES = join(TMP, 'issues.json');
const KEYS = ['CW_ISSUES', 'CW_ISSUES_JSON', 'CW_ISSUE_STORE', 'CW_LEARNING', 'CW_NOW', 'CW_INGEST_QUARANTINE'];
const saved = {};
const AT = '2026-08-01T00:00:00.000Z';
let ids = [];

before(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.CW_ISSUES = ISSUES;
  process.env.CW_LEARNING = join(TMP, 'learning.json');
  process.env.CW_INGEST_QUARANTINE = join(TMP, 'quarantine.json');   // a refused ruling is filed here, never in the tree
  withIssuesLock(() => {
    const doc = emptyIssuesDoc();
    doc.organisation = 'FIXTURE';
    ids = ['one', 'two', 'three', 'four'].map((n) => mintIssue(doc, {
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

const TRIAGE = routes.find((r) => r.method === 'POST' && r.path === '/api/issue/triage');
const SESSION = { user: 'op@example.test', provider: 'password' };
const call = (body, session = SESSION) => new Promise((resolve) => {
  TRIAGE.handle({ req: {}, isLoopbackReq: false, adminSession: () => session, readJsonBody: (_r, cb) => cb(body, null), send: (code, payload) => resolve({ code, payload }) });
});
const issue = (id) => loadIssues({ path: ISSUES }).issues[id];

test('the route exists; no session, an unknown action, an unknown id and a stale read are refused', async () => {
  assert.ok(TRIAGE);
  assert.deepEqual([...TRIAGE_ACTIONS], ['accept', 'decline', 'duplicate', 'snooze', 'unsnooze']);
  assert.equal((await call({ id: ids[0], action: 'accept' }, null)).code, 401);
  assert.equal((await call({ id: ids[0], action: 'archive' })).code, 400);
  assert.equal((await call({ id: 'ISS-NOPE-S-000000', action: 'accept' })).code, 404);
  const stale = await call({ id: ids[0], action: 'accept', expectUpdatedAt: '2001-01-01T00:00:00.000Z' });
  assert.equal(stale.code, 409);
  assert.equal(stale.payload.updatedAt, issue(ids[0]).updatedAt);
  assert.equal(issue(ids[0]).state, 'open', 'nothing written by any refusal');
});

test('accept claims for this operator and decides nothing; a claim held by another session is a 409', async () => {
  const r = await call({ id: ids[0], action: 'accept', expectUpdatedAt: issue(ids[0]).updatedAt });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.state, 'claimed');
  assert.match(r.payload.claim.by, /op@example\.test/);
  assert.equal(r.payload.stillOpen, true);
  assert.match(r.payload.note, /nothing is decided/);
  const other = await call({ id: ids[0], action: 'accept' }, { user: 'someone-else@example.test', provider: 'password' });
  assert.equal(other.code, 409);
  assert.match(other.payload.error, /claimed by/);
});

test('decline needs a named suppressing disposition and a reason, files through the judgement path, and leaves the issue open', async () => {
  assert.equal((await call({ id: ids[1], action: 'decline', reason: 'documented placeholder value' })).code, 400);
  const fixClaim = await call({ id: ids[1], action: 'decline', disposition: 'remediated', reason: 'documented placeholder value' });
  assert.equal(fixClaim.code, 400);
  assert.match(fixClaim.payload.error, /named ruling/);
  assert.equal((await call({ id: ids[1], action: 'decline', disposition: 'false-positive', reason: 'short' })).code, 400);
  const digest = subjectDigest(issue(ids[1]));
  const moved = digest.slice(0, -1) + (digest.endsWith('0') ? '1' : '0');
  const stale = await call({ id: ids[1], action: 'decline', disposition: 'false-positive', reason: 'documented placeholder value', subjectDigest: moved });
  assert.equal(stale.code, 409, `a pinned subject that moved is refused: ${JSON.stringify(stale.payload)}`);
  const r = await call({ id: ids[1], action: 'decline', disposition: 'false-positive', reason: 'documented placeholder value', subjectDigest: digest });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.filed.disposition, 'false-positive');
  assert.equal(r.payload.state, 'open', 'a ruling is not a close');
  assert.equal(r.payload.stillOpen, true);
  assert.match(r.payload.note, /scan evidence/);
  assert.ok(Array.isArray(issue(ids[1]).dispositions) && issue(ids[1]).dispositions.length === 1);
});

test('duplicate needs another real issue and closes this one as superseded', async () => {
  assert.equal((await call({ id: ids[2], action: 'duplicate' })).code, 400);
  assert.equal((await call({ id: ids[2], action: 'duplicate', duplicateOf: ids[2] })).code, 400);
  assert.equal((await call({ id: ids[2], action: 'duplicate', duplicateOf: 'ISS-NOPE-S-000000' })).code, 404);
  const r = await call({ id: ids[2], action: 'duplicate', duplicateOf: ids[3] });
  assert.equal(r.code, 200);
  assert.equal(r.payload.state, 'closed');
  assert.equal(r.payload.closedAs, 'superseded');
  assert.equal(r.payload.stillOpen, false);
  assert.equal(issue(ids[2]).deps.duplicateOf, ids[3]);
});

test('snooze sets the field for 7 days by default, keeps the state, refuses a closed issue; unsnooze clears it', async () => {
  const r = await call({ id: ids[3], action: 'snooze' });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.state, 'open');
  const days = (Date.parse(r.payload.snoozedUntil) - Date.parse(r.payload.updatedAt)) / 864e5;
  assert.ok(Math.abs(days - 7) < 0.01, `default is 7 days, got ${days}`);
  assert.equal(issue(ids[3]).snoozedUntil, r.payload.snoozedUntil);
  const long = await call({ id: ids[3], action: 'snooze', days: 400 });
  assert.equal(long.code, 400);
  assert.match(long.payload.error, /more than 365 days/);
  const closed = await call({ id: ids[2], action: 'snooze' });
  assert.equal(closed.code, 400);
  const u = await call({ id: ids[3], action: 'unsnooze' });
  assert.equal(u.payload.snoozedUntil, null);
  assert.match(u.payload.note, /back in Focus/);
});
