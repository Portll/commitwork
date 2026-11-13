// monitor/test/rollup-noscan-contradiction.test.mjs — the provenance/evidence contradiction the
// rollup is the only layer able to settle: a checks-status row saying `noscan` ("ran, produced
// nothing trustworthy") beside an artifact the same rollup counts findings out of. The measured
// shape was denoLint ran 0 / noscan 2 with 2,430 published rows and shellLint ran 0 / noscan 1 with
// 821; the panel can only report the disagreement, because it reads the fleet SUM and cannot
// attribute the void to the repo holding the evidence.
//
// BOTH DIRECTIONS, ASSERTED APART. A counted artifact must overrule the void (or the fleet keeps
// publishing ran 0 beside thousands of findings); a ZERO-finding or not-a-result artifact must
// NEVER overrule it (or osv-scanner with egress severed — valid SARIF, zero results — is published
// as a scan that happened). Only the second direction lies to a reader, so it gets its own repos
// and its own assertions rather than riding on the first.
//
// Harness: self-contained reports root + registry, real rollup as a child, fetch disabled.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROLLUP = join(CW, 'monitor', 'rollup.mjs');
const NO_FETCH = 'data:text/javascript,globalThis.fetch = undefined;';

const AT = '2026-08-10T10:00:00.000Z';
// The runner's own words for the two classifications that produced the measured shape: a
// pass-through lane whose findings were never counted at check time, and shellcheck's exit 1.
const NOSCAN_REASON = 'nothing found, but the tool exited 1 — cannot tell clean from failed';

const REPOS = ['counted', 'zero-findings', 'unparsed', 'other-lane'];
const AREAS = [{ slug: 'primary-area', label: 'primary', out: 'primary-area', primary: true, members: REPOS }];

const row = (check, status, reason) => ({ check, status, durationMs: 5, at: AT, ...(reason ? { reason } : {}) });
const denoDoc = (n) => JSON.stringify({
  version: 1,
  scannedConfigs: ['.'],
  diagnostics: Array.from({ length: n }, (_, i) => ({
    code: 'no-explicit-any', message: 'explicit any', filename: `f${i}.ts`, range: { start: { line: i + 1, col: 1 } },
  })),
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-noscan-contradiction-'));
  const regPath = join(root, 'projects.json');
  writeFileSync(regPath, JSON.stringify({ reportsRoot: join(root, 'reports'), monitorOutput: AREAS[0].out,
    defaultManifest: 'security-baseline', roots: [], projects: [], areas: AREAS }));
  mkdirSync(join(root, 'reports', AREAS[0].out), { recursive: true });

  const batch = join(root, 'reports', 'sweep-20260810120000-primary-area');
  for (const name of REPOS) mkdirSync(join(batch, name), { recursive: true });
  writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify({
    sliceId: 'sweep-20260810120000', kind: 'sweep', group: 'all', only: null, sweptAll: false,
    area: 'primary-area', areaOut: 'reports/primary-area', startedAt: AT,
    scope: { repos: REPOS.map((name) => ({ name, manifests: ['security-baseline'] })), excluded: [], lifecycle: {} },
    anchors: {},
  }));

  // THE CONTRADICTION. Both lanes recorded a void, and both artifacts carry real rows.
  writeFileSync(join(batch, 'counted', 'checks-status.json'),
    JSON.stringify([row('deno-lint', 'noscan', NOSCAN_REASON), row('shell-lint', 'noscan', NOSCAN_REASON)]));
  writeFileSync(join(batch, 'counted', 'deno-lint.json'), denoDoc(3));
  writeFileSync(join(batch, 'counted', 'shellcheck.json'), JSON.stringify({ comments: [
    { file: 's.sh', line: 1, column: 1, level: 'style', code: 2086, message: 'quote this' },
    { file: 's.sh', line: 9, column: 1, level: 'info', code: 2164, message: 'use cd … || exit' },
  ] }));

  // A GENUINE VOID with a parseable, empty artifact — osv-with-egress-severed's shape. Nothing here
  // falsifies "produced nothing trustworthy", so the void must survive untouched.
  writeFileSync(join(batch, 'zero-findings', 'checks-status.json'), JSON.stringify([row('deno-lint', 'noscan', NOSCAN_REASON)]));
  writeFileSync(join(batch, 'zero-findings', 'deno-lint.json'), denoDoc(0));

  // A void whose artifact exists and is NOT a result. Were the gate `total > 0` alone it would
  // still stand; the gate is unknownReasonOf, and this repo is what proves the predicate is read.
  writeFileSync(join(batch, 'unparsed', 'checks-status.json'), JSON.stringify([row('deno-lint', 'noscan', NOSCAN_REASON)]));
  writeFileSync(join(batch, 'unparsed', 'deno-lint.json'), '{ "diagnostics": [');

  // CROSS-LANE LEAKAGE. A counted shellcheck artifact beside a deno-lint void in the SAME repo:
  // findings overrule the void of their own checkId and no other.
  writeFileSync(join(batch, 'other-lane', 'checks-status.json'),
    JSON.stringify([row('deno-lint', 'noscan', NOSCAN_REASON), row('shell-lint', 'pass')]));
  writeFileSync(join(batch, 'other-lane', 'shellcheck.json'), JSON.stringify({ comments: [
    { file: 'b.sh', line: 2, column: 1, level: 'error', code: 2115, message: 'use "${VAR:?}"' },
  ] }));

  return { root, batch, regPath, out: join(root, 'reports', AREAS[0].out) };
}

const FX = fixture();
const RUN = spawnSync(process.execPath, ['--import', NO_FETCH, ROLLUP, FX.batch],
  { cwd: CW, encoding: 'utf8', env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: FX.regPath, CW_MONITOR_OUT: '' } });
const rollup = () => JSON.parse(readFileSync(join(FX.out, 'rollup.json'), 'utf8'));
// The determinism half of the same question, since rerollup-identical.test.mjs's live arm skips in a
// checkout with no stored batch: a resolution derived from two witnesses must re-roll unchanged.
// JSON.stringify over the PARSED block, so key order churn counts as a difference and not just values.
const FIRST_SCANNERS = JSON.stringify(rollup().scanners);
const RERUN = spawnSync(process.execPath, ['--import', NO_FETCH, ROLLUP, FX.batch],
  { cwd: CW, encoding: 'utf8', env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: FX.regPath, CW_MONITOR_OUT: '' } });
const cat = (k) => {
  const s = rollup().scanners[k];
  assert.ok(s, `category ${k} is missing from rollup.json scanners`);
  return s;
};
const repo = (name) => {
  const r = rollup().repos.find((x) => x.name === name);
  assert.ok(r, `repo ${name} is missing from rollup.json repos[]`);
  return r;
};
// The per-repo provenance ROWS ship on the history slice (rollup.json's own `checks` is the list of
// check ids), and that is where an overruled claim has to remain readable.
const rows = (name, check) => {
  const hist = join(FX.out, 'history');
  const stamp = readdirSync(hist).filter((f) => /^\d{14}\.json$/.test(f)).sort().pop();
  assert.ok(stamp, 'the rollup wrote no history slice');
  const slice = JSON.parse(readFileSync(join(hist, stamp), 'utf8'));
  return (slice.checks[name] || []).filter((c) => c.check === check);
};

describe('rollup noscan contradiction — a counted artifact overrules the void, a zero one never does', () => {
  test('the fixture rollup itself succeeds', () => {
    assert.equal(RUN.status, 0, `rollup failed: ${(RUN.stderr || '').slice(0, 800)}`);
    assert.equal(RERUN.status, 0, `re-roll failed: ${(RERUN.stderr || '').slice(0, 800)}`);
  });

  test('a batch holding a contradiction still re-rolls to the same scanner block', () => {
    assert.equal(JSON.stringify(rollup().scanners), FIRST_SCANNERS,
      'the resolution reads two witnesses off disk and must stay deterministic — a re-roll that moves is a byte-identity break');
  });

  test('THE REGRESSION: a noscan beside counted findings no longer publishes ran 0', () => {
    const s = cat('denoLint');
    assert.equal(s.total, 3, 'the rollup counted these rows out of the artifact it is calling unscanned');
    assert.equal(s.ran, 1, 'the repo whose artifact carries findings ran — this read 0 beside 2,430 rows on the fleet');
    assert.equal(s.noscanContradicted, 1, 'the overruled claim is published as its own count, never absorbed into ran');
    assert.equal(s.noscanContradictedReason, NOSCAN_REASON,
      "the runner's own words travel with the resolution, so the defect it reports stays readable");
    assert.equal(s.noscan, 3, 'the one disproved void leaves the count; the three with no counted artifact stay in it');
    assert.equal(s.lastRunAt, AT, 'a run the artifact witnesses dates the run — the findings below are as current as it');
  });

  test('the same resolution reaches the second lane, so it is the mechanism and not one lane', () => {
    const s = cat('shellLint');
    assert.equal(s.total, 3, '2 advisory rows in `counted` plus 1 error row in `other-lane`');
    assert.equal(s.ran, 2, 'the overruled void plus the genuine pass');
    assert.equal(s.noscan, 0);
    assert.equal(s.noscanContradicted, 1);
  });

  test('ran > 0 with findings is what clears the panel CONTRADICTION state — the arithmetic, not a flag', () => {
    const s = cat('denoLint');
    assert.ok(s.ran > 0 && s.total > 0,
      'covState() reads ran 0 with total > 0 as CONTRADICTION; the panel holds only the fleet sum, so the resolution has to move the arithmetic');
    assert.equal(s.ran + s.skipped + s.noscan, 4,
      'the four repos carrying a deno-lint row stay additively accounted — a repo moved into ran must leave noscan, never appear in both');
  });

  // ── the direction that lies to a reader, asserted on its own repos ─────────────────────────────

  test('a ZERO-finding artifact never overrules its void', () => {
    const r = rows('zero-findings', 'deno-lint');
    assert.equal(r.length, 1);
    assert.equal(r[0].status, 'noscan', 'a parseable empty artifact cannot confirm a scan happened');
    assert.equal('contradicted' in r[0], false,
      'overruling here publishes osv-with-egress-severed as a scan that ran — the direction that costs more than a miss');
    assert.equal(repo('zero-findings').noscan, 1, 'and the repo stays in the not-scanned set');
  });

  test('an artifact that is not a result never overrules its void, whatever its total', () => {
    const r = rows('unparsed', 'deno-lint');
    assert.equal(r.length, 1, 'the synthetic void push must not add a second row beside the runner’s own');
    assert.equal(r[0].status, 'noscan');
    assert.equal('contradicted' in r[0], false, 'unknownReasonOf gates this, not the finding count alone');
    assert.equal(repo('unparsed').noscan, 1);
  });

  test('findings overrule the void of their own checkId and no other', () => {
    const [deno] = rows('other-lane', 'deno-lint');
    assert.equal(deno.status, 'noscan');
    assert.equal('contradicted' in deno, false,
      'a counted shellcheck artifact in the same repo says nothing about whether deno lint ran');
    assert.equal(repo('other-lane').noscan, 1);
  });

  test('the overruled row keeps its own claim — status and reason are never rewritten', () => {
    const [deno] = rows('counted', 'deno-lint');
    assert.equal(deno.status, 'noscan', 'a real record is never dropped to make room for a derived one');
    assert.equal(deno.reason, NOSCAN_REASON);
    assert.deepEqual(deno.contradicted, { by: 'artifact', findings: 3 },
      'the resolution states the arithmetic that produced it, so a reader can check the claim rather than trust it');
  });

  test('a contradicted void leaves the repo-level count and its reason list together', () => {
    const r = repo('counted');
    assert.equal(r.noscan, 0, 'both of this repo’s voids are disproved by its own artifacts');
    assert.equal('noscanReasons' in r, false,
      'a reason list describing voids that are no longer counted makes the count and its causes two different sets');
  });

  test('the field ships on the two lanes that earned it and on no other', () => {
    const carrying = Object.entries(rollup().scanners)
      .filter(([, s]) => s && typeof s === 'object' && 'noscanContradicted' in s).map(([k]) => k).sort();
    assert.deepEqual(carrying, ['denoLint', 'shellLint'],
      'omitted when zero — absent means counted-and-none, and a key on every category would churn the re-roll bytes of lanes that never had one');
  });
});
