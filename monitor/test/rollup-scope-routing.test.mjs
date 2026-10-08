// monitor/rollup.mjs — WHERE a batch's findings land (the area it declares, never the primary
// default; no declared area is a refusal), and a narrow sweep CARRIES the categories it did not
// ask about. Real batch dirs, real rollup as a child process — both defects live in module-level
// resolution order an import cannot exercise.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROLLUP = join(CW, 'monitor', 'rollup.mjs');

// A self-contained reports root with its own registry, so nothing touches the live tree.
function fixture({ areas, batchArea, group = 'all', repos = ['alpha'], scanners = null }) {
  const root = mkdtempSync(join(tmpdir(), 'cw-route-'));
  // reportsRoot is ABSOLUTE on purpose — resolve() passes it through, isolating the run from the live tree
  const reg = {
    reportsRoot: join(root, 'reports'), monitorOutput: areas[0].out,
    defaultManifest: 'security-baseline', roots: [], projects: [], areas,
  };
  const regPath = join(root, 'projects.json');
  writeFileSync(regPath, JSON.stringify(reg));
  for (const a of areas) mkdirSync(join(root, 'reports', a.out), { recursive: true });

  const batch = join(root, 'reports', `sweep-20260801120000-${batchArea || 'noarea'}`);
  mkdirSync(batch, { recursive: true });
  const manifest = {
    sliceId: 'sweep-20260801120000', kind: 'sweep', group, only: null, sweptAll: false,
    startedAt: '2026-08-01T12:00:00.000Z',
    scope: { repos: repos.map((n) => ({ name: n, manifests: ['security-baseline'] })), excluded: [], lifecycle: {} },
    anchors: {},
  };
  if (batchArea) { manifest.area = batchArea; manifest.areaOut = `reports/${areas.find((a) => a.slug === batchArea).out}`; }
  writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify(manifest));
  for (const r of repos) {
    const d = join(batch, r); mkdirSync(d, { recursive: true });
    // an empty gitleaks report = the check ran and found nothing; enough to make the batch non-empty
    writeFileSync(join(d, 'gitleaks.json'), '[]');
    writeFileSync(join(d, 'checks-status.json'), JSON.stringify(
      [{ check: 'secrets-gitleaks', status: 'pass', durationMs: 5, at: '2026-08-01T12:00:01.000Z' }]));
  }
  if (scanners) writeFileSync(join(root, 'reports', areas[0].out, '_seed-scanners.json'), JSON.stringify(scanners));
  return { root, batch, regPath };
}

const runRollup = (fx, batch, env = {}) => spawnSync(process.execPath, [ROLLUP, batch], {
  cwd: CW, encoding: 'utf8',
  env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: fx.regPath, CW_MONITOR_OUT: '', ...env },
});

// `alpha` is DECLARED into other-area: rollup.mjs's mixed-batch guard refuses a batch whose repos
// resolve elsewhere, and an undeclared name resolves to itself via areaOf()'s own-name fallback.
const AREAS = [
  { slug: 'primary-area', label: 'primary', out: 'primary-area', primary: true },
  { slug: 'other-area', label: 'other', out: 'other-area', members: ['alpha'] },
];

describe('a batch lands in the area it declares, never the primary default', () => {
  test('a batch declaring NON-primary area writes there, not into the primary area', () => {
    const fx = fixture({ areas: AREAS, batchArea: 'other-area' });
    const { root, batch } = fx;
    const r = runRollup(fx, batch);
    assert.equal(r.status, 0, `rollup failed: ${r.stderr?.slice(0, 400)}`);
    assert.ok(existsSync(join(root, 'reports', 'other-area', 'rollup.json')),
      'the declaring area must receive the rollup');
    assert.equal(existsSync(join(root, 'reports', 'primary-area', 'rollup.json')), false,
      'the PRIMARY area must not receive another area’s findings — this is the observed incident');
  });

  test('a batch declaring NO area is REFUSED, not defaulted', () => {
    // "refuse rather than default" is the same rule registry.mjs applies when areaOut() returns null
    const fx = fixture({ areas: AREAS, batchArea: null });
    const { root, batch } = fx;
    const r = runRollup(fx, batch);
    assert.equal(r.status, 4, `expected exit 4 (cross-area refusal), got ${r.status}: ${r.stderr?.slice(0, 300)}`);
    assert.match(r.stderr, /declares no area/);
    assert.equal(existsSync(join(root, 'reports', 'primary-area', 'rollup.json')), false,
      'a refusal must not have written anything');
  });

  test('CW_MONITOR_OUT still WINS over the batch declaration', () => {
    // the injection seam verification fixtures depend on; scope-containment.test.mjs pins it too
    const fx = fixture({ areas: AREAS, batchArea: 'other-area' });
    const { root, batch } = fx;
    const scratch = mkdtempSync(join(tmpdir(), 'cw-scratch-'));
    const r = runRollup(fx, batch, { CW_MONITOR_OUT: scratch });
    assert.equal(r.status, 0, `rollup failed: ${r.stderr?.slice(0, 300)}`);
    assert.ok(existsSync(join(scratch, 'rollup.json')), 'the explicit override must receive the rollup');
    assert.equal(existsSync(join(root, 'reports', 'other-area', 'rollup.json')), false,
      'the declared area must be bypassed when the operator names a destination');
  });
});

describe('a narrow sweep does not erase what it did not ask about', () => {
  test('categories absent from a group-scoped batch are CARRIED, not dropped', () => {
    const fx = fixture({ areas: AREAS, batchArea: 'other-area' });
    const { root, batch } = fx;
    const out = join(root, 'reports', 'other-area');

    // roll once with a full batch so a prior slice exists carrying a `secrets` figure
    assert.equal(runRollup(fx, batch).status, 0);
    const first = JSON.parse(readFileSync(join(out, 'rollup.json'), 'utf8'));
    assert.ok(first.scanners.secrets, 'setup: the first roll must record a secrets category');

    // now a NARROW batch that speaks only for supply-chain — no gitleaks artifact, no secrets row
    const narrow = join(root, 'reports', 'sweep-20260801130000-other-area');
    mkdirSync(join(narrow, 'alpha'), { recursive: true });
    writeFileSync(join(narrow, 'batch-manifest.json'), JSON.stringify({
      sliceId: 'sweep-20260801130000', kind: 'sweep', group: 'supply-chain', area: 'other-area',
      areaOut: 'reports/other-area', sweptAll: false, startedAt: '2026-08-01T13:00:00.000Z',
      scope: { repos: [{ name: 'alpha', manifests: ['security-baseline'] }], excluded: [], lifecycle: {} }, anchors: {},
    }));
    writeFileSync(join(narrow, 'alpha', 'socket.json'), JSON.stringify({ ok: true, data: { healthy: true, alerts: {} } }));
    writeFileSync(join(narrow, 'alpha', 'checks-status.json'), JSON.stringify(
      [{ check: 'supply-chain-socket', status: 'pass', durationMs: 5, at: '2026-08-01T13:00:01.000Z' }]));

    assert.equal(runRollup(fx, narrow).status, 0);
    const after = JSON.parse(readFileSync(join(out, 'rollup.json'), 'utf8'));

    assert.ok(after.scanners.secrets, 'secrets must still be PRESENT after a supply-chain-only sweep');
    assert.equal(after.scanners.secrets.carried, true, 'and it must be labelled carried, not passed off as fresh');
    assert.ok(after.scanners.secrets.carriedAt, 'a carried entry must state WHEN it was observed');
    assert.equal(typeof after.scanners.secrets.carriedAt, 'string', 'ISO string — the rerollup gate normalises only ISO');
    assert.ok(Array.isArray(after.totals.carried?.categories) && after.totals.carried.categories.includes('secrets'),
      'totals must record which categories are stale');
  });

  test('a carried entry CHAINS until the category is actually rescanned', () => {
    // same rule as counts.carried (rollup.mjs) — carried findings chain slice to slice
    const fx = fixture({ areas: AREAS, batchArea: 'other-area' });
    const { root, batch } = fx;
    const out = join(root, 'reports', 'other-area');
    assert.equal(runRollup(fx, batch).status, 0);
    const firstAt = JSON.parse(readFileSync(join(out, 'rollup.json'), 'utf8')).generated;

    for (const stamp of ['20260801130000', '20260801140000']) {
      const narrow = join(root, 'reports', `sweep-${stamp}-other-area`);
      mkdirSync(join(narrow, 'alpha'), { recursive: true });
      writeFileSync(join(narrow, 'batch-manifest.json'), JSON.stringify({
        sliceId: `sweep-${stamp}`, kind: 'sweep', group: 'supply-chain', area: 'other-area',
        areaOut: 'reports/other-area', sweptAll: false, startedAt: '2026-08-01T13:00:00.000Z',
        scope: { repos: [{ name: 'alpha', manifests: ['security-baseline'] }], excluded: [], lifecycle: {} }, anchors: {},
      }));
      writeFileSync(join(narrow, 'alpha', 'socket.json'), JSON.stringify({ ok: true, data: { healthy: true, alerts: {} } }));
      writeFileSync(join(narrow, 'alpha', 'checks-status.json'), JSON.stringify(
        [{ check: 'supply-chain-socket', status: 'pass', durationMs: 5, at: '2026-08-01T13:00:01.000Z' }]));
      assert.equal(runRollup(fx, narrow).status, 0);
    }

    const after = JSON.parse(readFileSync(join(out, 'rollup.json'), 'utf8'));
    assert.equal(after.scanners.secrets?.carried, true, 'still carried after TWO narrow sweeps');
    assert.equal(after.scanners.secrets.carriedAt, firstAt,
      'carriedAt must keep pointing at the ORIGINAL observation, not be re-stamped each cycle');
  });
});

describe('the proof-of-remediation step re-runs the area that was rolled up', () => {
  // REMEDIATION.md is written for EVERY area; its re-run step once named one project for all of them
  const rerunStep = (root, out) => readFileSync(join(root, 'reports', out, 'REMEDIATION.md'), 'utf8')
    .split('\n').find((l) => l.includes('node monitor/sweep.mjs all'));

  test('a non-primary area\'s plan re-runs that area, never the primary one', () => {
    const fx = fixture({ areas: AREAS, batchArea: 'other-area' });
    assert.equal(runRollup(fx, fx.batch).status, 0);
    const step = rerunStep(fx.root, 'other-area');
    assert.ok(step, 'REMEDIATION.md carries no re-run step');
    assert.match(step, /`node monitor\/sweep\.mjs all other-area`/);
    assert.doesNotMatch(step, /primary-area/);
  });

  test('the primary area\'s plan names the primary area', () => {
    const areas = [{ ...AREAS[0], members: ['beta'] }, AREAS[1]];
    const fx = fixture({ areas, batchArea: 'primary-area', repos: ['beta'] });
    assert.equal(runRollup(fx, fx.batch).status, 0);
    assert.match(rerunStep(fx.root, 'primary-area') || '', /`node monitor\/sweep\.mjs all primary-area`/);
  });
});
