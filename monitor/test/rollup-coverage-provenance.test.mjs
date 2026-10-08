// monitor/test/rollup-coverage-provenance.test.mjs — the producer side of coverage honesty:
// lastRunAt advances on pass/fail ONLY, lastCheckedAt on any verdict; skips split into naSkips /
// blockedSkips and the BLOCKED reason wins the one skipReason slot. Sharp case: a pass at 10:00
// and a later skip at 14:00 — only pass/fail-gated code reports 10:00. Harness: self-contained
// reports root + registry, real rollup as a child, fetch disabled, no scanner artifact anywhere.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROLLUP = join(CW, 'monitor', 'rollup.mjs');
const NO_FETCH = 'data:text/javascript,globalThis.fetch = undefined;';

const REPOS = ['alpha', 'beta'];
// members required — an unlisted repo becomes its own area and the mixed-batch scope check fails
const AREAS = [{ slug: 'primary-area', label: 'primary', out: 'primary-area', primary: true, members: REPOS }];

const EARLY = '2026-08-10T10:00:00.000Z';   // the only real RUN in this fixture
const LATE = '2026-08-10T14:00:00.000Z';    // later, and never a run — skips and noscans only

const NA_REASON = 'n/a — none of pom.xml, build.gradle present';
const BLOCKED_REASON = 'runtime scanner — no live URL (set CW_BOLA_URL)';
const TLS_NA = 'n/a — no host configured for this repo';
const TLS_BLOCKED = 'credential missing — TLS probe could not authenticate';

const row = (check, status, at, reason) => ({ check, status, durationMs: 5, at, ...(reason ? { reason } : {}) });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-coverage-provenance-'));
  const reg = { reportsRoot: join(root, 'reports'), monitorOutput: AREAS[0].out,
    defaultManifest: 'security-baseline', roots: [], projects: [], areas: AREAS };
  const regPath = join(root, 'projects.json');
  writeFileSync(regPath, JSON.stringify(reg));
  for (const a of AREAS) mkdirSync(join(root, 'reports', a.out), { recursive: true });

  const batch = join(root, 'reports', 'sweep-20260810120000-primary-area');
  for (const name of REPOS) mkdirSync(join(batch, name), { recursive: true });
  writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify({
    sliceId: 'sweep-20260810120000', kind: 'sweep', group: 'all', only: null, sweptAll: false,
    area: 'primary-area', areaOut: 'reports/primary-area', startedAt: EARLY,
    scope: { repos: REPOS.map((n) => ({ name: n, manifests: ['security-baseline'] })), excluded: [], lifecycle: {} },
    anchors: {},
  }));

  // alpha — the EARLY verdicts. secrets is the fixture's one and only genuine run.
  writeFileSync(join(batch, 'alpha', 'checks-status.json'), JSON.stringify([
    row('secrets-gitleaks', 'pass', EARLY),
    row('deps-jvm', 'skip', EARLY, NA_REASON),
    row('dast-authz-bola', 'skip', EARLY, BLOCKED_REASON),
    row('tls-headers', 'skip', EARLY, TLS_NA),          // the n/a half of the mixed category
    row('dast-nuclei', 'noscan', EARLY, 'artifact present but unparseable'),
  ]));

  // beta — the LATE verdicts, none of them a run. Every category's newest row lives here, so any
  // implementation that dates a run from "the newest row" reports LATE for all five.
  writeFileSync(join(batch, 'beta', 'checks-status.json'), JSON.stringify([
    row('secrets-gitleaks', 'skip', LATE, BLOCKED_REASON),
    row('deps-jvm', 'skip', LATE, NA_REASON),
    row('dast-authz-bola', 'skip', LATE, BLOCKED_REASON),
    row('tls-headers', 'skip', LATE, TLS_BLOCKED),      // the blocked half — must win skipReason
    row('dast-nuclei', 'noscan', LATE, 'artifact present but unparseable'),
  ]));

  return { root, batch, regPath, out: join(root, 'reports', AREAS[0].out) };
}

const FX = fixture();
const RUN = spawnSync(process.execPath, ['--import', NO_FETCH, ROLLUP, FX.batch],
  { cwd: CW, encoding: 'utf8', env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: FX.regPath, CW_MONITOR_OUT: '' } });
const scannersOf = () => JSON.parse(readFileSync(join(FX.out, 'rollup.json'), 'utf8')).scanners;
const cat = (k) => {
  const s = scannersOf()[k];
  assert.ok(s, `category ${k} is missing from rollup.json scanners — a category in scope somewhere must be emitted even with no artifact (rollup.mjs:963), or the void is silently omitted`);
  return s;
};

describe('rollup coverage provenance — a skip never dates a run', () => {
  test('the fixture rollup itself succeeds', () => {
    assert.equal(RUN.status, 0, `rollup failed: ${(RUN.stderr || '').slice(0, 800)}`);
  });

  test('THE REGRESSION: a later SKIP must not advance lastRunAt past an earlier PASS', () => {
    const s = cat('secrets');
    assert.equal(s.ran, 1, 'exactly one pass row across the batch');
    assert.equal(s.skipped, 1, 'exactly one skip row across the batch');
    assert.equal(s.lastRunAt, EARLY,
      'lastRunAt dates a RUN: the 14:00 skip must not advance it past the 10:00 pass');
    assert.equal(s.lastCheckedAt, LATE,
      'lastCheckedAt dates the EVIDENCE, so the 14:00 skip DOES advance it — the two fields must disagree here');
    assert.notEqual(s.lastRunAt, s.lastCheckedAt,
      'the whole point of two fields is that this fixture makes them differ');
  });

  test('a category that never ran carries NO lastRunAt at all — never a borrowed one', () => {
    for (const k of ['depsJvm', 'bola', 'tlsHeaders', 'dast']) {
      const s = cat(k);
      assert.equal(s.ran, 0, `${k} has no pass/fail row in this fixture`);
      assert.equal('lastRunAt' in s, false,
        `${k} never ran, so lastRunAt must be ABSENT — a null or a borrowed timestamp is what let the panel print "ran 13h ago" beside its own VOID pill`);
      assert.equal(s.lastCheckedAt, LATE,
        `${k} was still CHECKED, and absence of a run must not erase the evidence date`);
    }
  });

  test('an n/a skip and a blocked skip are counted apart, not lumped as one VOID', () => {
    const na = cat('depsJvm');
    assert.equal(na.skipped, 2);
    assert.equal(na.naSkips, 2, 'both rows read "n/a — …": nothing here to scan');
    assert.equal(na.blockedSkips, 0, 'an n/a exclusion is not a coverage gap and must not be counted as one');
    assert.equal(na.skipReason, NA_REASON);

    const blocked = cat('bola');
    assert.equal(blocked.skipped, 2);
    assert.equal(blocked.blockedSkips, 2, 'both rows are a check denied its input — the actionable kind');
    assert.equal(blocked.naSkips, 0);
    assert.equal(blocked.skipReason, BLOCKED_REASON);
  });

  test('when both kinds are present the BLOCKED reason wins the one skipReason slot', () => {
    const s = cat('tlsHeaders');
    assert.equal(s.skipped, 2);
    assert.equal(s.naSkips, 1);
    assert.equal(s.blockedSkips, 1);
    assert.equal(s.skipReason, TLS_BLOCKED,
      'reporting the n/a reason on a mixed category sends an operator away from the repo that needs a credential');
  });

  test('noscan is its own count and never a skip, and never dates a run', () => {
    const s = cat('dast');
    assert.equal(s.noscan, 2, 'ran, produced nothing trustworthy — the third zero-run fact');
    assert.equal(s.skipped, 0);
    assert.equal(s.ran, 0);
    assert.equal('naSkips' in s, false, 'the skip split only ships when there is a skip to explain');
    assert.equal('lastRunAt' in s, false, 'a noscan is not a run');
  });

  test('the skip reason is carried, not just counted — the counts alone cannot recover it', () => {
    // the classification derives from the reason string — without it the split is unauditable
    for (const k of ['depsJvm', 'bola', 'tlsHeaders']) {
      assert.equal(typeof cat(k).skipReason, 'string', `${k} must carry a representative reason`);
      assert.ok(cat(k).skipReason.length > 0);
    }
  });
});
