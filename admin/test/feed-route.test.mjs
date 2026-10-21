// The feed route answers three different things three different ways: no rollup is "never swept",
// a rollup it cannot read or parse is a 500, and a readable one is grouped with its counts. An
// empty group list only ever comes with a stated reason. The issue-store join is covered at the
// module level (monitor/test/feed-groups.test.mjs); here the store is ENOENT, which the store itself
// defines as legitimately empty.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes, readRollup } from '../routes/feed.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-feed-'));
const KEYS = ['CW_REGISTRY', 'CW_ISSUES', 'CW_ISSUES_JSON', 'CW_ISSUE_STORE'];
const saved = {};
const OUT = join(TMP, 'reports', 'fixarea');

const row = (over = {}) => ({ repo: 'fixrepo', rule: 'js/sql-injection', file: 'src/db.js', line: 10, sev: 'high', message: 'tainted', ...over });
const ROLLUP = {
  generated: '2026-10-07T00:00:00.000Z', sliceId: 'sweep-20261007000000-fixarea',
  scanners: { sastSemgrep: { ran: 1, total: 4 }, depsGo: { ran: 1, total: 1 } },
  scannerFindings: {
    sastSemgrep: [row(), row({ line: 44 }), row({ rule: 'js/xss', sev: 'med' }), row({ rule: 'js/ungraded', sev: '' })],
    depsGo: [{ repo: 'fixrepo', id: 'GHSA-1', package: 'left-pad', sev: 'crit', kev: true, message: 'advisory' }],
  },
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
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

const FEED = routes.find((r) => r.path === '/api/feed');
const GROUP = routes.find((r) => r.path === '/api/feed/group');
const SESSION = { user: 'op@example.test', provider: 'password' };
const call = (route, { q = { project: 'fixarea' }, session = SESSION, loopback = false } = {}) => new Promise((resolve) => {
  route.handle({
    req: { url: '/api/feed' }, isLoopbackReq: loopback, adminSession: () => session,
    query: new URLSearchParams(q), knownProjects: () => new Set(['fixarea', 'bare']),
    send: (code, payload) => resolve({ code, payload }),
  });
});

test('no session is 401 and an unregistered project is 400, on both routes', async () => {
  for (const route of [FEED, GROUP]) {
    assert.equal((await call(route, { session: null })).code, 401);
    assert.equal((await call(route, { q: { project: 'nope' } })).code, 400);
    assert.equal((await call(route, { q: {} })).code, 400);
  }
});

test('an absent rollup is never-swept with no groups and null totals, not an empty feed', async () => {
  const r = await call(FEED);
  assert.equal(r.code, 200);
  assert.equal(r.payload.state, 'never-swept');
  assert.deepEqual(r.payload.groups, []);
  assert.equal(r.payload.totals, null);
  assert.deepEqual(readRollup('fixarea').absent, true);
});

test('a rollup that is not JSON, or has no scannerFindings, is a 500 that names the file', async () => {
  writeFileSync(join(OUT, 'rollup.json'), '{not json');
  let r = await call(FEED);
  assert.equal(r.code, 500);
  assert.match(r.payload.error, /rollup\.json is not JSON/);
  writeFileSync(join(OUT, 'rollup.json'), JSON.stringify({ generated: 'x' }));
  r = await call(FEED);
  assert.equal(r.code, 500);
  assert.match(r.payload.error, /no scannerFindings/);
  assert.ok(readRollup('fixarea').rollup, 'readRollup parses; the scannerFindings check is the route\'s');
  writeFileSync(join(OUT, 'rollup.json'), '{not json');
  assert.throws(() => readRollup('fixarea'), /is not JSON/);
});

test('a readable rollup is grouped: Focus hides the ungraded group and says so, All shows it', async () => {
  writeFileSync(join(OUT, 'rollup.json'), JSON.stringify(ROLLUP));
  const focus = await call(FEED);
  assert.equal(focus.code, 200);
  assert.equal(focus.payload.state, 'swept');
  assert.equal(focus.payload.sliceId, ROLLUP.sliceId);
  assert.equal(focus.payload.totals.rows, 5);
  assert.equal(focus.payload.totals.undetermined, 1);
  assert.equal(focus.payload.hidden, 1);
  assert.deepEqual(focus.payload.groups.map((g) => g.subject), ['left-pad', 'js/sql-injection', 'js/xss']);
  assert.equal(focus.payload.groups[0].kev, true);
  assert.equal(focus.payload.groups[1].members, 2);
  assert.equal(focus.payload.groups[1].distinct, 1, 'two lines of one finding are one sub-row');
  const all = await call(FEED, { q: { project: 'fixarea', mode: 'all' } });
  assert.equal(all.payload.groups.length, 4);
  assert.equal(all.payload.hidden, 0);
  assert.equal((await call(FEED, { q: { project: 'fixarea', mode: 'some' } })).code, 400);
});

test('lane, limit and offset narrow the page while totals stay whole', async () => {
  const lane = await call(FEED, { q: { project: 'fixarea', lane: 'depsGo' } });
  assert.equal(lane.payload.groupCount, 1);
  assert.equal(lane.payload.totals.rows, 1);
  const page = await call(FEED, { q: { project: 'fixarea', mode: 'all', limit: '2', offset: '2' } });
  assert.equal(page.payload.groupCount, 4);
  assert.equal(page.payload.groups.length, 2);
  assert.equal(page.payload.offset, 2);
});

test('a group is retrievable by its key with members and their store keys; an unknown key is 404', async () => {
  const feed = await call(FEED);
  const key = feed.payload.groups[1].key;
  const g = await call(GROUP, { q: { project: 'fixarea', key } });
  assert.equal(g.code, 200);
  assert.equal(g.payload.members.length, 2);
  assert.ok(g.payload.members.every((m) => m.subRowKey.startsWith('sc:fixrepo|sastSemgrep|')));
  assert.ok(g.payload.members.every((m) => m.issue === null), 'ENOENT issue store joins nothing');
  assert.equal((await call(GROUP, { q: { project: 'fixarea', key: 'nope' } })).code, 404);
  assert.equal((await call(GROUP, { q: { project: 'fixarea' } })).code, 400);
});

test('with the feed flag off, both routes answer 404 naming the flag, before the login gate', async () => {
  process.env.CW_FEATURE_FEED = 'off';
  try {
    for (const route of [FEED, GROUP]) {
      const r = await call(route, { session: null, q: { project: 'fixarea', key: 'x' } });
      assert.equal(r.code, 404);
      assert.equal(r.payload.featureOff, true);
      assert.equal(r.payload.flag, 'feed');
      assert.match(r.payload.enable, /CW_FEATURE_FEED/);
    }
  } finally { delete process.env.CW_FEATURE_FEED; }
  assert.equal((await call(FEED)).code, 200, 'back on without the override');
});
