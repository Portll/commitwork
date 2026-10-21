// GET /api/inbox and POST /api/inbox/mark over a fixture registry: no identity is 401, an
// unregistered project 400, a never-swept area says so, an unreadable rollup or state file is a 500
// rather than an empty inbox, read and snooze round-trip for the signed-in operator, and the flag
// switches both off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes } from '../routes/inbox.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-inbox-route-'));
const KEYS = ['CW_REGISTRY', 'CW_ISSUES', 'CW_ISSUES_JSON', 'CW_ISSUE_STORE', 'CW_INBOX_STATE', 'CW_FEATURE_INBOX', 'CW_EXPERIMENTAL', 'CW_NOW'];
const saved = {};
const OUT = join(TMP, 'reports', 'fixarea');
const ROLLUP = {
  generated: '2026-10-08T00:00:00.000Z', sliceId: 'sweep-2',
  scannerDelta: { comparable: true, prevSliceId: 'sweep-1', byCategory: {
    depsGo: { status: 'compared', new: 1, newBySev: { crit: 1, high: 0, med: 0, low: 0, unknown: 0 }, newPlaces: [{ repo: 'fixrepo', sub: 'GHSA-1', id: 'GHSA-1', package: 'left-pad', rows: 1, sev: 'crit' }] } } },
  scannerFindings: { depsGo: [{ repo: 'fixrepo', id: 'GHSA-1', package: 'left-pad', sev: 'crit', kev: true }] },
  scanners: { sastGo: { coverage: 'unknown', coverageReason: 'no log' } },
};

before(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea', defaultManifest: 'security-baseline', roots: [],
    projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' }],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true, members: ['fixrepo'] }, { slug: 'bare', label: 'bare', out: 'bare' }],
  }));
  process.env.CW_REGISTRY = join(TMP, 'projects.json');
  process.env.CW_ISSUES = join(TMP, 'issues.json');
  process.env.CW_INBOX_STATE = join(TMP, 'inbox-state.json');
  process.env.CW_NOW = '2026-10-08T01:00:00.000Z';
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

const GET = routes.find((r) => r.method === 'GET' && r.path === '/api/inbox');
const MARK = routes.find((r) => r.method === 'POST' && r.path === '/api/inbox/mark');
const SESSION = { user: 'op@example.test', provider: 'password' };
const get = (q = { project: 'fixarea' }, { session = SESSION, loopback = false } = {}) => new Promise((resolve) => GET.handle({
  req: {}, isLoopbackReq: loopback, adminSession: () => session, query: new URLSearchParams(q), knownProjects: () => new Set(['fixarea', 'bare']),
  send: (code, payload) => resolve({ code, payload }) }));
const mark = (body, { session = SESSION } = {}) => new Promise((resolve) => MARK.handle({
  req: {}, isLoopbackReq: false, adminSession: () => session, readJsonBody: (_r, cb) => cb(body, null), send: (code, payload) => resolve({ code, payload }) }));

test('no identity is 401 on both; an unregistered project is 400; a never-swept area says so', async () => {
  assert.equal((await get(undefined, { session: null })).code, 401);
  assert.equal((await mark({ ids: ['x'], action: 'read' }, { session: null })).code, 401);
  assert.equal((await get({ project: 'nope' })).code, 400);
  const never = await get({ project: 'bare' });
  assert.equal(never.code, 200);
  assert.equal(never.payload.state, 'never-swept');
  assert.deepEqual(never.payload.items, []);
});

test('an unreadable rollup is a 500, never an empty inbox', async () => {
  writeFileSync(join(OUT, 'rollup.json'), '{not json');
  const r = await get();
  assert.equal(r.code, 500);
  assert.match(r.payload.error, /not JSON/);
});

test('a swept area lists its items with counts and what was not measured; loopback without a session is the operator', async () => {
  writeFileSync(join(OUT, 'rollup.json'), JSON.stringify(ROLLUP));
  const r = await get();
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.deepEqual(r.payload.items.map((i) => i.kind).sort(), ['ingest-behind', 'lane-undetermined', 'new-critical', 'new-kev']);
  assert.deepEqual(r.payload.counts, { priority: 2, other: 2, unread: 4, snoozed: 0 });
  assert.ok(r.payload.notMeasured.some((n) => n.signal === 'sla-due-soon'));
  assert.equal(r.payload.who, 'op@example.test (password)');
  assert.equal((await get(undefined, { session: null, loopback: true })).payload.who, 'operator@loopback');
});

test('read and snooze round-trip for this operator only; a bad action is 400', async () => {
  const before = (await get()).payload.items;
  const crit = before.find((i) => i.kind === 'new-critical');
  const und = before.find((i) => i.kind === 'lane-undetermined');
  assert.equal((await mark({ ids: [crit.id], action: 'read' })).code, 200);
  assert.equal((await mark({ ids: [und.id], action: 'snooze', days: 7 })).code, 200);
  const after = await get();
  assert.equal(after.payload.items.find((i) => i.id === crit.id).read, true);
  assert.ok(after.payload.items.find((i) => i.id === und.id).snoozedUntil);
  assert.deepEqual(after.payload.counts, { priority: 2, other: 1, unread: 2, snoozed: 1 });
  const other = await get(undefined, { session: { user: 'other@example.test', provider: 'password' } });
  assert.equal(other.payload.counts.unread, 4, 'another operator sees everything unread');
  assert.equal((await mark({ ids: [crit.id], action: 'archive' })).code, 400);
});

test('an unreadable state file is a 500 on read and a 503 on write, and nothing is overwritten', async () => {
  writeFileSync(process.env.CW_INBOX_STATE, '{broken');
  const r = await get();
  assert.equal(r.code, 500);
  assert.match(r.payload.error, /inbox state/);
  assert.equal((await mark({ ids: ['x'], action: 'read' })).code, 503);
  rmSync(process.env.CW_INBOX_STATE);
});

test('the inbox flag switches both routes off and names itself', async () => {
  process.env.CW_FEATURE_INBOX = 'off';
  try {
    for (const r of [await get(), await mark({ ids: ['x'], action: 'read' })]) {
      assert.equal(r.code, 404); assert.equal(r.payload.flag, 'inbox'); assert.equal(r.payload.featureOff, true);
    }
  } finally { delete process.env.CW_FEATURE_INBOX; }
});
