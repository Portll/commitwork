// GET /api/rollups — next run from the installed job, 30 days graded from the sweep journal. All
// times are built with the local-time Date constructor, so the assertions hold in any timezone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCalendar, readJob, nextFire, cadenceOf, gradeVerdict, rollupsView, canaryOf } from '../routes/rollups.mjs';

const plist = (body) => `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>x</string>\n${body}\n</dict></plist>`;
const DAILY = '<key>StartCalendarInterval</key>\n  <dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>30</integer></dict>';
const WEEKLY = '<key>StartCalendarInterval</key>\n  <dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>1</integer><key>Minute</key><integer>0</integer></dict>';
const DEEP = '<key>StartCalendarInterval</key>\n  <array>\n    <dict><key>Weekday</key><integer>6</integer><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>\n  </array>';

test('the calendar is read from a dict or an array, and a missing key stays a wildcard', () => {
  assert.deepEqual(parseCalendar(plist(DAILY)), [{ Hour: 2, Minute: 30 }]);
  assert.deepEqual(parseCalendar(plist(DEEP)), [{ Weekday: 6, Hour: 18, Minute: 0 }]);
  assert.equal(parseCalendar(plist('<key>RunAtLoad</key><true/>')), null);
});

test('next firing is local time, today when still ahead and tomorrow once passed', () => {
  const morning = new Date(2026, 8, 24, 1, 0).getTime();
  assert.equal(nextFire([{ Hour: 2, Minute: 30 }], morning), new Date(2026, 8, 24, 2, 30).getTime());
  const afternoon = new Date(2026, 8, 24, 15, 0).getTime();
  assert.equal(nextFire([{ Hour: 2, Minute: 30 }], afternoon), new Date(2026, 8, 25, 2, 30).getTime());
  const sunday = nextFire([{ Weekday: 0, Hour: 1, Minute: 0 }], afternoon);
  assert.equal(new Date(sunday).getDay(), 0);
  assert.equal(nextFire([{ Weekday: 7, Hour: 1, Minute: 0 }], afternoon), sunday, 'launchd accepts 7 for Sunday');
});

test('cadence: an interval with no weekday is daily; one weekday is weekly', () => {
  assert.equal(cadenceOf([{ Hour: 2, Minute: 30 }]).kind, 'daily');
  assert.equal(cadenceOf([{ Weekday: 0, Hour: 1, Minute: 0 }]).kind, 'weekly');
  assert.equal(cadenceOf(null).kind, 'none');
});

test('a run is broken when the rollup did not publish or a scan did not run, and warn on a failed step', () => {
  const ok = { kind: 'sweep-area-verdict', rollup: 'published', repos: { resolved: 1, scans: [{ ran: true }] }, issues: 'ok', steps: { codeqlFleet: 'ok', liveness: 'nonzero' }, finalize: { compact: 'ok' } };
  assert.equal(gradeVerdict(ok), 'good', 'the fleet deadman exit is not this run\'s outcome');
  assert.equal(gradeVerdict({ ...ok, issues: 'failed' }), 'warn');
  assert.equal(gradeVerdict({ ...ok, finalize: { compact: 'failed' } }), 'warn');
  assert.equal(gradeVerdict({ ...ok, rollup: 'failed:1' }), 'broken');
  assert.equal(gradeVerdict({ ...ok, repos: { resolved: 1, scans: [{ ran: false }] } }), 'broken');
  assert.equal(gradeVerdict({ ...ok, rollup: 'nothing-to-roll-up', repos: { resolved: 0, scans: [] } }), 'empty');
  assert.equal(gradeVerdict({ kind: 'sweep-refusal' }), null);
});

test('the assembled view: next run from the plist, graded days, a missed scheduled day, and exposure on hover', () => {
  const T = mkdtempSync(join(tmpdir(), 'cw-rollups-'));
  const agents = join(T, 'agents'); mkdirSync(agents);
  writeFileSync(join(agents, 'com.portll.commitwork-monitor-alpha.plist'), plist(DAILY));
  writeFileSync(join(agents, 'com.portll.commitwork-monitor-beta.plist'), plist(WEEKLY));
  const reports = join(T, 'reports');
  const now = new Date(2026, 8, 24, 12, 0).getTime();
  const at = (daysAgo, h = 2) => new Date(2026, 8, 24 - daysAgo, h, 45).toISOString();
  mkdirSync(join(reports, 'alpha', 'history'), { recursive: true });
  const verdict = (a, rollup = 'published') => JSON.stringify({ v: 1, kind: 'sweep-area-verdict', at: a, rollup, repos: { resolved: 1, scans: [{ ran: true }] }, issues: 'ok', steps: {}, finalize: {} });
  writeFileSync(join(reports, 'alpha', 'sweep-journal.jsonl'), [verdict(at(3)), verdict(at(0)), verdict(at(1), 'failed:1'), 'not json'].join('\n') + '\n');
  writeFileSync(join(reports, 'alpha', 'history', 's1.json'), JSON.stringify({ totals: { crit: 1, high: 2, med: 0, low: 0, kev: 1, kevConsulted: true, cveTotals: { cves: 7 } } }));
  writeFileSync(join(reports, 'alpha', 'history', 'index.json'), JSON.stringify([{ generated: at(0), sliceId: 'sweep-a', file: 's1.json' }]));
  process.env.CW_ROLLUPS_CACHE = join(T, 'cache.json');
  const reg = { reportsRoot: reports, areas: [{ slug: 'alpha', label: 'Alpha' }, { slug: 'beta', label: 'Beta' }, { slug: 'gamma', label: 'Gamma' }] };
  const v = rollupsView({ nowMs: now, reg, root: reports, dir: agents });
  delete process.env.CW_ROLLUPS_CACHE;
  const [alpha, beta, gamma] = v.areas;

  assert.equal(alpha.schedule.next, new Date(2026, 8, 25, 2, 30).toISOString());
  assert.equal(alpha.cadence.kind, 'daily');
  assert.equal(beta.cadence.kind, 'weekly');
  assert.equal(gamma.schedule.state, 'absent', 'no installed job is no next run, never a guessed one');
  assert.equal(gamma.schedule.next, null);
  assert.equal(v.fleet.next.slug, 'alpha');

  const day = (r, ago) => r.days[r.days.length - 1 - ago];
  assert.equal(day(alpha, 0).state, 'good');
  assert.deepEqual(day(alpha, 0).exposure, { cve: 7, kev: 1, crit: 1, high: 2 });
  assert.equal(day(alpha, 1).state, 'broken');
  assert.equal(day(alpha, 2).state, 'none', 'a scheduled day with no run is a missed run');
  assert.equal(day(alpha, 3).state, 'good');
  assert.equal(day(alpha, 4).state, null, 'a day before the area\'s first recorded run is not a missed run');
  assert.equal(alpha.sources.journalBadLines, 1, 'an unparseable journal line is counted, not dropped');
  assert.equal(alpha.worst, 'kev');
  assert.equal(beta.sources.journal, 'absent');
  assert.ok(gamma.days.every((d) => d.state === null), 'nothing scheduled means nothing missed');
  assert.ok(beta.days.every((d) => d.state === null), 'an area with no recorded run has no missed days to claim');
});

test('an unreadable plist is its own state, not an absent one', () => {
  const T = mkdtempSync(join(tmpdir(), 'cw-rollups-bad-'));
  mkdirSync(join(T, 'com.portll.commitwork-monitor-x.plist'));
  assert.equal(readJob('com.portll.commitwork-monitor-x', T).state, 'unreadable');
});

// ── the gate's own error rate (W1) ─────────────────────────────────────────────────────────────
const rate = (n, of) => ({ state: 'measured', n, of, rate: n / of });
const measured = { state: 'measured', exit: 1, scored: 5, skipped: 0, requiredSkipped: [], falseClean: rate(0, 2), falseAlarm: rate(1, 3) };
const areaRec = (at, canary) => ({ v: 1, kind: 'sweep-area-verdict', at, rollup: 'published', ...(canary ? { canary } : {}) });

test('canaryOf: the latest area verdict\'s canary, and every way of having none says which', () => {
  const ok = canaryOf({ state: 'ok', records: [areaRec('2026-09-01T00:00:00Z', { state: 'failed', why: 'x' }), areaRec('2026-09-02T00:00:00Z', { ...measured, record: { secret: 1 } })] });
  assert.equal(ok.state, 'measured');
  assert.equal(ok.at, '2026-09-02T00:00:00Z');
  assert.deepEqual(ok.falseAlarm, rate(1, 3));
  assert.equal(ok.record, undefined, 'only whitelisted fields are served');

  const old = canaryOf({ state: 'ok', records: [areaRec('2026-09-02T00:00:00Z')] });
  assert.equal(old.state, 'not-measured');
  assert.equal(old.predates, true);
  assert.equal(old.falseClean, undefined, 'a verdict without the field has no rate, not a zero one');

  assert.equal(canaryOf({ state: 'absent', records: [] }).state, 'not-measured');
  assert.equal(canaryOf({ state: 'unreadable', detail: 'EACCES', records: [] }).state, 'unreadable');
});

test('the view carries each area\'s canary and the fleet\'s newest one, skipping verdicts that predate it', () => {
  const T = mkdtempSync(join(tmpdir(), 'cw-rollups-canary-'));
  const reports = join(T, 'reports');
  for (const [slug, lines] of [
    ['alpha', [areaRec('2026-09-20T02:00:00Z', measured)]],
    ['beta', [areaRec('2026-09-21T02:00:00Z', { state: 'not-measured', why: 'the canary was switched off for this sweep (CW_SWEEP_NO_CANARY=1)' })]],
    ['gamma', [areaRec('2026-09-22T02:00:00Z')]],
  ]) {
    mkdirSync(join(reports, slug), { recursive: true });
    writeFileSync(join(reports, slug, 'sweep-journal.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  }
  process.env.CW_ROLLUPS_CACHE = join(T, 'cache.json');
  const reg = { reportsRoot: reports, areas: [{ slug: 'alpha' }, { slug: 'beta' }, { slug: 'gamma' }] };
  const v = rollupsView({ nowMs: new Date(2026, 8, 24, 12).getTime(), reg, root: reports, dir: join(T, 'none') });
  delete process.env.CW_ROLLUPS_CACHE;
  assert.equal(v.areas[0].canary.state, 'measured');
  assert.equal(v.areas[2].canary.predates, true);
  assert.equal(v.fleet.canary.area, 'beta', 'the newest sweep wins even when it did not measure — an older rate is not current');
  assert.equal(v.fleet.canary.state, 'not-measured');
});
