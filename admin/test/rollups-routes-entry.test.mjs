// GET /api/rollups through its handler, with every input taken from the environment at call time —
// the registry (CW_REGISTRY), the installed LaunchAgents (CW_AGENT_DIR), the clock (CW_NOW) and the
// slice cache (CW_ROLLUPS_CACHE) — exactly as the panel calls it, with no arguments.
// rollups.test.mjs covers rollupsView() given explicit inputs; this covers the route: its auth, the
// 503 for an unreadable registry, the env wiring, and its 15-second response cache, which is driven
// by a stubbed Date.now so the test does not sleep. All times are local, like the route's.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes, WINDOW_DAYS } from '../routes/rollups.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-rollups-entry-'));
const AGENTS = join(TMP, 'agents');
const REPORTS = join(TMP, 'reports');
const REG = join(TMP, 'projects.json');
const CACHE = join(TMP, 'slice-cache.json');
const NOW_MS = new Date(2026, 8, 24, 12, 0).getTime();
const KEYS = ['CW_REGISTRY', 'CW_AGENT_DIR', 'CW_NOW', 'CW_ROLLUPS_CACHE'];
const saved = {};
const realNow = Date.now;
let skew = 0;

const plist = (body) => `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>x</string>\n${body}\n</dict></plist>`;
const DAILY = '<key>StartCalendarInterval</key>\n<dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>30</integer></dict>';
const DEEP = '<key>StartCalendarInterval</key>\n<array><dict><key>Weekday</key><integer>6</integer><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict></array>';
const at = (daysAgo, h = 2) => new Date(2026, 8, 24 - daysAgo, h, 45).toISOString();
const verdict = (when, rollup = 'published') => JSON.stringify({ v: 1, kind: 'sweep-area-verdict', at: when, rollup, repos: { resolved: 1, scans: [{ ran: true }] }, issues: 'ok', steps: {}, finalize: {} });
const JOURNAL = join(REPORTS, 'alpha', 'sweep-journal.jsonl');

before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  Date.now = () => realNow.call(Date) + skew;
  mkdirSync(AGENTS, { recursive: true });
  writeFileSync(join(AGENTS, 'com.portll.commitwork-monitor-alpha.plist'), plist(DAILY));
  writeFileSync(join(AGENTS, 'com.portll.commitwork-deep-alpha.plist'), plist(DEEP));
  writeFileSync(join(AGENTS, 'com.portll.commitwork-monitor-beta.plist'), plist(DAILY));
  mkdirSync(join(REPORTS, 'alpha', 'history'), { recursive: true });
  writeFileSync(JOURNAL, [verdict(at(3)), verdict(at(1), 'failed:1'), verdict(at(0)), 'not json'].join('\n') + '\n');
  writeFileSync(join(REPORTS, 'alpha', 'history', 's1.json'), JSON.stringify({ totals: { crit: 1, high: 2, med: 0, low: 0, kev: 1, kevConsulted: true, cveTotals: { cves: 7 } } }));
  writeFileSync(join(REPORTS, 'alpha', 'history', 'index.json'), JSON.stringify([{ generated: at(0), sliceId: 'sweep-a', file: 's1.json' }]));
  // the registry starts torn: the first authenticated read must see it fail
  writeFileSync(REG, '{ "areas": [ ');
  process.env.CW_REGISTRY = REG;
  process.env.CW_AGENT_DIR = AGENTS;
  process.env.CW_NOW = new Date(NOW_MS).toISOString();
  process.env.CW_ROLLUPS_CACHE = CACHE;
});
after(() => {
  Date.now = realNow;
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

const writeRegistry = () => writeFileSync(REG, JSON.stringify({
  reportsRoot: REPORTS, defaultManifest: 'security-baseline', roots: [], projects: [],
  areas: [
    { slug: 'alpha', label: 'Alpha', out: 'alpha', primary: true },
    { slug: 'beta', label: 'Beta', out: 'beta', paused: { since: '2026-09-01', reason: 'synthetic pause' } },
    { slug: 'gamma', label: 'Gamma', out: 'gamma' },
  ],
}));

const route = routes.find((r) => r.method === 'GET' && r.path === '/api/rollups');
const call = ({ loopback = true, session = null } = {}) => new Promise((resolve) => {
  route.handle({ req: {}, isLoopbackReq: loopback, adminSession: () => session, send: (code, payload) => resolve({ code, payload }) });
});
const day = (row, ago) => row.days[row.days.length - 1 - ago];

test('a remote caller with no session — or a session with no user — is refused 401', async () => {
  for (const session of [null, { provider: 'password' }]) {
    const r = await call({ loopback: false, session });
    assert.equal(r.code, 401);
    assert.deepEqual(r.payload, { ok: false, error: 'authentication required' });
  }
});

test('an unreadable registry is a 503 that says the schedule is UNKNOWN, never an empty schedule', async () => {
  const r = await call();
  assert.equal(r.code, 503);
  assert.equal(r.payload.ok, false);
  assert.match(r.payload.reason, /^the registry could not be read \(.*\) — the schedule is UNKNOWN, not empty$/);
  assert.equal(r.payload.areas, undefined, 'no rows at all, rather than zero rows');
});

test('every input is read from the environment at call time: schedule, graded days, exposure', async () => {
  writeRegistry();
  skew += 16_000;   // past the route's response cache
  const r = await call({ loopback: false, session: { user: 'op@example.test', provider: 'password' } });
  assert.equal(r.code, 200, JSON.stringify(r.payload).slice(0, 300));
  const v = r.payload;
  assert.equal(v.ok, true);
  assert.equal(v.generatedAt, new Date(NOW_MS).toISOString(), 'CW_NOW is the clock');
  assert.equal(v.windowDays, WINDOW_DAYS);
  assert.equal(v.days.length, WINDOW_DAYS);
  assert.equal(v.days[v.days.length - 1], '2026-09-24');

  const [alpha, beta, gamma] = v.areas;
  assert.deepEqual([alpha.slug, beta.slug, gamma.slug], ['alpha', 'beta', 'gamma']);
  assert.deepEqual(alpha.schedule, { state: 'scheduled', next: new Date(2026, 8, 25, 2, 30).toISOString() });
  assert.equal(alpha.cadence.kind, 'daily');
  assert.equal(alpha.deep.state, 'scheduled');
  assert.equal(new Date(alpha.deep.next).getDay(), 6, 'the deep job is read from its own plist');
  assert.deepEqual(alpha.sources, { index: 'ok', journal: 'ok', journalBadLines: 1 });
  assert.deepEqual(alpha.last, { at: at(0), sliceId: 'sweep-a' });
  assert.equal(alpha.worst, 'kev');
  assert.deepEqual([0, 1, 2, 3, 4].map((n) => day(alpha, n).state), ['good', 'broken', 'none', 'good', null]);
  assert.deepEqual(day(alpha, 0).exposure, { cve: 7, kev: 1, crit: 1, high: 2 });

  assert.deepEqual(beta.paused, { since: '2026-09-01' });
  assert.deepEqual(beta.schedule, { state: 'paused', next: null }, 'a paused area has an installed job and no next run');
  assert.deepEqual(gamma.schedule, { state: 'absent', next: null }, 'no installed job is no next run, never a guessed one');
  assert.deepEqual(gamma.sources, { index: 'absent', journal: 'absent' });
  assert.equal(gamma.worst, 'unknown');

  assert.deepEqual(v.fleet.next, { at: alpha.schedule.next, area: 'Alpha', slug: 'alpha' });
  assert.deepEqual(v.fleet.totals, { good: 2, warn: 0, broken: 1, none: 1, empty: 0 });
  assert.equal(v.slicesPending, false);

  // the slice summary was persisted where CW_ROLLUPS_CACHE points
  const cache = JSON.parse(readFileSync(CACHE, 'utf8'));
  assert.deepEqual(cache.entries['alpha/s1.json'], { state: 'ok', cve: 7, kev: 1, crit: 1, high: 2, med: 0, low: 0 });
});

test('the response is cached for 15 seconds, then re-read', async () => {
  const first = (await call()).payload;
  appendFileSync(JOURNAL, verdict(at(2)) + '\n');   // the missed day now has a run
  skew += 5_000;
  const cached = await call();
  assert.equal(cached.code, 200);
  assert.deepEqual(cached.payload, first, 'inside the window the same body is served');
  assert.equal(day(cached.payload.areas[0], 2).state, 'none');

  skew += 11_000;
  const fresh = await call();
  assert.equal(fresh.code, 200);
  assert.equal(day(fresh.payload.areas[0], 2).state, 'good', 'after the window the journal is read again');
  assert.deepEqual(fresh.payload.fleet.totals, { good: 3, warn: 0, broken: 1, none: 0, empty: 0 });
});

test('the route is GET-only in the dispatch table', () => {
  assert.deepEqual(routes.filter((r) => r.path === '/api/rollups').map((r) => r.method), ['GET']);
});
