// node --test cra/test/ — ONE KEV staleness threshold, ONE name. monitor/rollup.mjs read
// CW_KEV_STALE_DAYS while cra/lib.mjs and cra/watch.mjs read CRA_KEV_STALE_DAYS, so one catalogue
// could be fresh to the watch and stale to the rollup, and setting "the" threshold moved one reader.
// Every reader now goes through kevStaleDays(); these tests pin the value AND that each reader obeys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kevStaleDays, kevFreshness, KEV_STALE_DAYS_DEFAULT } from '../lib.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = mkdtempSync(join(tmpdir(), 'cw-kev-stale-'));
const NAMES = ['CRA_KEV_STALE_DAYS', 'CW_KEV_STALE_DAYS'];

// Set AFTER import on purpose: a threshold frozen at module load would ignore every value below.
function withEnv(vars, fn) {
  const was = Object.fromEntries(NAMES.map((k) => [k, process.env[k]]));
  for (const k of NAMES) delete process.env[k];
  Object.assign(process.env, vars);
  try { return fn(); } finally {
    for (const k of NAMES) { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k]; }
  }
}

const KEV = join(T, 'kev.json');
writeFileSync(KEV, JSON.stringify({ catalogVersion: '2026.09.20', dateReleased: '2026-09-20T00:00:00.000Z', vulnerabilities: [] }));
const AT = '2026-09-27T00:00:00.000Z'; // exactly 7 days after release

test('the default is 7 days when neither name is set', () => withEnv({}, () => {
  assert.equal(KEV_STALE_DAYS_DEFAULT, 7);
  assert.equal(kevStaleDays(), 7);
  const f = kevFreshness({ kev: KEV }, AT);
  assert.equal(f.maxDays, 7);
  assert.equal(f.state, 'fresh', '7 days old is not past a 7-day threshold');
}));

test('CRA_KEV_STALE_DAYS decides the verdict in both directions', () => {
  withEnv({ CRA_KEV_STALE_DAYS: '3' }, () => {
    const f = kevFreshness({ kev: KEV }, AT);
    assert.equal(f.maxDays, 3);
    assert.equal(f.state, 'stale');
  });
  withEnv({ CRA_KEV_STALE_DAYS: '30' }, () => {
    const f = kevFreshness({ kev: KEV }, AT);
    assert.equal(f.maxDays, 30);
    assert.equal(f.state, 'fresh');
  });
});

test('the retired CW_KEV_STALE_DAYS is refused, never silently replaced by the default', () => withEnv({ CW_KEV_STALE_DAYS: '30' }, () => {
  assert.throws(() => kevStaleDays(), /CW_KEV_STALE_DAYS is retired/);
  const f = kevFreshness({ kev: KEV }, AT);
  assert.equal(f.state, 'unknown', 'a threshold nobody reads must not yield a verdict');
  assert.equal(f.maxDays, null);
  assert.match(f.reason, /CRA_KEV_STALE_DAYS/, 'the reason names the variable to set instead');
}));

test('a non-numeric threshold is UNKNOWN, not fresh — `ageDays > NaN` is false', () => withEnv({ CRA_KEV_STALE_DAYS: 'a week' }, () => {
  assert.throws(() => kevStaleDays(), /must be a number of days/);
  const f = kevFreshness({ kev: KEV }, AT);
  assert.equal(f.state, 'unknown');
  assert.match(f.reason, /a week/);
}));

// ── the readers, run as the operator runs them ──────────────────────────────────────────────────
// A slice generated at AT, so the watch's own stale-EVIDENCE exit (4) does not fire: that clock is
// the rollup's age, a different threshold from the one under test.
const ROLLUP = join(T, 'rollup.json');
writeFileSync(ROLLUP, JSON.stringify({ generated: AT, sliceId: 'sweep-20260927000000', repos: [] }));
function watchList(extra) {
  const env = { ...process.env, CW_CRA_ROOT: T, CW_REGISTRY: '', CW_KEV: KEV, CW_CASES: join(T, 'cases.json'),
    CW_ROLLUP: ROLLUP, CW_CRA_OUT: join(T, 'out'), CW_CRA_NOW: AT, CW_ESCALATE: '0' };
  for (const k of NAMES) delete env[k];
  const r = spawnSync(process.execPath, [join(CW, 'cra', 'watch.mjs'), 'list', '--json'], { env: { ...env, ...extra }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))).kev;
}

test('cra/watch.mjs reads the same threshold', () => {
  assert.equal(watchList({ CRA_KEV_STALE_DAYS: '3' }).state, 'stale');
  assert.equal(watchList({ CRA_KEV_STALE_DAYS: '3' }).maxDays, 3);
  assert.equal(watchList({ CW_KEV_STALE_DAYS: '3' }).state, 'unknown');
});

// The rollup's catalogue path is not overridable, so what it can be held to here is the THRESHOLD it
// publishes: enrichment.kevFreshness.maxDays is written whether or not a catalogue is on disk.
function rollupKev(extra) {
  const root = mkdtempSync(join(T, 'rollup-'));
  const regPath = join(root, 'projects.json');
  writeFileSync(regPath, JSON.stringify({
    reportsRoot: join(root, 'reports'), monitorOutput: 'kev-area', defaultManifest: 'security-baseline',
    roots: [], projects: [], areas: [{ slug: 'kev-area', label: 'kev', out: 'kev-area', primary: true, members: ['alpha'] }],
  }));
  mkdirSync(join(root, 'reports', 'kev-area'), { recursive: true });
  const batch = join(root, 'reports', 'sweep-20260920120000-kev-area');
  mkdirSync(join(batch, 'alpha'), { recursive: true });
  writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify({
    sliceId: 'sweep-20260920120000', kind: 'sweep', group: 'all', only: null, sweptAll: true,
    area: 'kev-area', areaOut: 'reports/kev-area', startedAt: '2026-09-20T12:00:00.000Z',
    scope: { repos: [{ name: 'alpha', manifests: ['security-baseline'] }], excluded: [], lifecycle: {} }, anchors: {},
  }));
  writeFileSync(join(batch, 'alpha', 'gitleaks.json'), '[]');
  writeFileSync(join(batch, 'alpha', 'checks-status.json'),
    JSON.stringify([{ id: 'secrets-gitleaks', status: 'ok', started: '2026-09-20T12:00:00.000Z' }]));
  const env = { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: regPath, CW_MONITOR_OUT: '' };
  for (const k of NAMES) delete env[k];
  const r = spawnSync(process.execPath, ['--import', 'data:text/javascript,globalThis.fetch = undefined;',
    join(CW, 'monitor', 'rollup.mjs'), batch], { cwd: CW, encoding: 'utf8', env: { ...env, ...extra } });
  assert.equal(r.status, 0, `fixture rollup failed: ${r.stderr?.slice(0, 800)}`);
  return { kev: JSON.parse(readFileSync(join(root, 'reports', 'kev-area', 'rollup.json'), 'utf8')).enrichment.kevFreshness, stderr: r.stderr };
}

test('monitor/rollup.mjs publishes the threshold CRA_KEV_STALE_DAYS names', () => {
  assert.equal(rollupKev({ CRA_KEV_STALE_DAYS: '13' }).kev.maxDays, 13,
    'the rollup is reading some other threshold than the watch and preflight');
});

test('monitor/rollup.mjs refuses the retired name and still publishes — unknown, with the reason', () => {
  const { kev, stderr } = rollupKev({ CW_KEV_STALE_DAYS: '13' });
  assert.equal(kev.state, 'unknown');
  assert.equal(kev.maxDays, null);
  assert.match(kev.reason, /CW_KEV_STALE_DAYS is retired/);
  assert.match(stderr, /CW_KEV_STALE_DAYS is retired/, 'the refusal is said out loud, not only recorded');
});
