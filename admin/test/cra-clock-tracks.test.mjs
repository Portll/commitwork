// node --test admin/test/ — the three CRA clock tracks must stay apart on the wire.
// The panel renders a legal deadline from this payload, so the contract asserted here is: tracks
// are never totalled, only the regulatory track is filable, and the response carries the SERVER's
// clock for the countdown to tick from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TMP = mkdtempSync(join(tmpdir(), 'cra-tracks-'));
const NOW = '2026-07-20T00:00:00.000Z';

// One case per track, plus a pre-split case carrying no `track` at all.
const CASES = {
  version: 1,
  events: [],
  cases: {
    'p--reg': {
      caseId: 'p--reg', kind: 'vulnerability', productId: 'p', vulnId: 'CVE-2026-1', status: 'open',
      trigger: 'kev', kev: true, epss: 0.9,
      reporting: { locale: 'EU', bodies: ['ENISA (Single Reporting Platform)'], why: 'locale EU delegates to a named body' },
      clocks: { track: 'article14', basisAt: NOW, earlyWarningDue: '2026-07-21T00:00:00.000Z', notificationDue: '2026-07-23T00:00:00.000Z', finalDue: '2026-08-03T00:00:00.000Z' },
    },
    'p--bp': {
      caseId: 'p--bp', kind: 'vulnerability', productId: 'q', vulnId: 'CVE-2026-2', status: 'open',
      trigger: 'kev', kev: true, epss: null,
      reporting: { locale: null, bodies: [], why: 'no reporting locale declared for this product' },
      clocks: { track: 'bestpractice', basisAt: NOW, earlyWarningDue: '2026-07-21T00:00:00.000Z', notificationDue: '2026-07-23T00:00:00.000Z', finalDue: '2026-08-03T00:00:00.000Z' },
    },
    'p--int': {
      caseId: 'p--int', kind: 'vulnerability', productId: 'q', vulnId: 'CVE-2026-3', status: 'open',
      trigger: 'crit', kev: false, epss: null, cvss: 9.4,
      reporting: { locale: null, bodies: [], why: 'no reporting locale declared for this product' },
      clocks: { track: 'internal', basisAt: NOW, triageDue: '2026-07-23T00:00:00.000Z', remediateDue: '2026-08-19T00:00:00.000Z' },
    },
    'p--old': { // opened before the track split: no `track` on its clocks
      caseId: 'p--old', kind: 'vulnerability', productId: 'p', vulnId: 'CVE-2026-4', status: 'open',
      trigger: 'kev', kev: true, epss: null,
      clocks: { basisAt: NOW, earlyWarningDue: '2026-07-21T00:00:00.000Z' },
    },
    'p--closed': { caseId: 'p--closed', status: 'closed', trigger: 'kev', clocks: { track: 'article14' } },
  },
};

const casesPath = join(TMP, 'cases.json');
writeFileSync(casesPath, JSON.stringify(CASES));
process.env.CW_CASES = casesPath;
process.env.CW_CRA_NOW = '2026-07-22T00:00:00.000Z'; // past the 24h clock, before the 72h one

const { routes } = await import('../routes/cra.mjs');
const route = routes.find((r) => r.method === 'GET' && r.path === '/api/cra/cases');

function call() {
  let captured = null;
  route.handle({
    req: {},
    adminSession: () => ({ user: 'tester' }),
    send: (code, body) => { captured = { code, body }; },
  });
  return captured;
}

test('each track is counted separately and never folded into one number', () => {
  const { code, body } = call();
  assert.equal(code, 200);
  assert.equal(body.configured, true);
  assert.deepEqual(body.counts, { article14: 1, bestpractice: 1, internal: 1, unknown: 1 });
  assert.equal(body.count, 4, 'count is every OPEN case — the closed one is excluded');
});

test('only the regulatory track is filable; a pre-split case keeps the drafts it already has', () => {
  const by = Object.fromEntries(call().body.cases.map((c) => [c.caseId, c]));
  assert.equal(by['p--reg'].draftsPath, 'reports/cra/cases/p--reg/');
  assert.equal(by['p--bp'].draftsPath, null, 'nothing to file where no body is delegated');
  assert.equal(by['p--int'].draftsPath, null, 'an internal policy clock is never filed');
  assert.equal(by['p--old'].draftsPath, 'reports/cra/cases/p--old/', 'suppressing existing drafts would hide evidence');
});

test('a pre-split case is `unknown`, never adopted into either track', () => {
  const by = Object.fromEntries(call().body.cases.map((c) => [c.caseId, c]));
  assert.equal(by['p--old'].track, 'unknown');
  assert.notEqual(by['p--old'].track, 'article14');
  assert.notEqual(by['p--old'].track, 'internal');
});

test('overdue flags use each track OWN clock vocabulary', () => {
  const by = Object.fromEntries(call().body.cases.map((c) => [c.caseId, c]));
  // 2026-07-22 is past the 24h early warning, before the 72h notification.
  assert.deepEqual(by['p--reg'].overdue, ['early-warning-24h']);
  assert.deepEqual(by['p--bp'].overdue, ['early-warning-24h'], 'the best-practice track runs the same clocks');
  // The internal case has NO earlyWarningDue — reading it with the Art. 14 labels would report
  // an empty list for a clock that exists under another name.
  assert.deepEqual(by['p--int'].overdue, [], 'triage due 07-23 is not yet overdue at 07-22');
});

test('the response carries the SERVER clock the countdown must tick from', () => {
  const { body } = call();
  assert.ok(body.serverNow, 'a client that ticks from its own clock renders a false deadline');
  assert.equal(body.serverNow, body.at);
  assert.ok(Number.isFinite(Date.parse(body.serverNow)));
});

process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });
