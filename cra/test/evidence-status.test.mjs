// cra/evidence-status.mjs — the evidence pack is never reported current unless it measurably is.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  evidenceStatus, fingerprintInputs, evidenceStaleHours, EXIT, STALE_HOURS_ENV,
  EVIDENCE_STALE_HOURS_DEFAULT, EVIDENCE_INDEX, REFRESH_STATUS, REFRESH_STATUS_SCHEMA,
} from '../evidence-status.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIX = join(HERE, 'fixtures');
const GEN = '2026-07-20T00:00:00.000Z';
const hoursAfter = (h) => new Date(Date.parse(GEN) + h * 3600_000).toISOString();

let T;
before(() => { T = mkdtempSync(join(tmpdir(), 'cra-evidence-status-')); });
after(() => rmSync(T, { recursive: true, force: true }));

// A self-contained paths object over copies of the fixtures, so inputs can be mutated per case.
function scratch(name) {
  const d = join(T, name);
  mkdirSync(join(d, 'out'), { recursive: true });
  for (const f of ['rollup.json', 'ledger.json', 'annotations.json', 'products.json', 'kev.json', 'epss.json', 'history.json']) cpSync(join(FIX, f), join(d, f));
  return {
    out: join(d, 'out'), rollup: join(d, 'rollup.json'), ledger: join(d, 'ledger.json'),
    historyIndex: join(d, 'history.json'), annotations: join(d, 'annotations.json'),
    products: join(d, 'products.json'), controls: join(REPO, 'cra', 'controls.json'),
    kev: join(d, 'kev.json'), epss: join(d, 'epss.json'),
  };
}
const writeIndex = (paths, over = {}) => writeFileSync(join(paths.out, EVIDENCE_INDEX),
  JSON.stringify({ generatedAt: GEN, steps: [], inputs: fingerprintInputs(paths), artifacts: [], ...over }));
const writeRun = (paths, over = {}) => writeFileSync(join(paths.out, REFRESH_STATUS),
  JSON.stringify({ schema: REFRESH_STATUS_SCHEMA, startedAt: GEN, finishedAt: GEN, exit: 0, ok: true, reason: null, steps: [], ...over }));

test('no pack on disk is never-generated, not current and not an error', () => {
  const s = evidenceStatus(scratch('absent'), GEN);
  assert.equal(s.state, 'never-generated');
  assert.equal(s.exit, EXIT['never-generated']);
  assert.match(s.reasons[0], /no evidence pack has been generated/);
});

test('a pack inside the threshold with unchanged inputs and a clean last run is current', () => {
  const p = scratch('current');
  writeIndex(p); writeRun(p);
  const s = evidenceStatus(p, hoursAfter(EVIDENCE_STALE_HOURS_DEFAULT - 1));
  assert.equal(s.state, 'current', s.reasons.join(' | '));
  assert.equal(s.exit, 0);
  assert.equal(s.generatedAt, GEN);
  assert.ok(s.inputs.some((i) => i.name === 'rollup' && /^[0-9a-f]{64}$/.test(i.sha256)), 'the pack names the rollup it was built from');
});

test('past the threshold the pack is stale; the threshold env is read at call time', () => {
  const p = scratch('aged');
  writeIndex(p); writeRun(p);
  const s = evidenceStatus(p, hoursAfter(EVIDENCE_STALE_HOURS_DEFAULT + 1));
  assert.equal(s.state, 'stale');
  assert.equal(s.exit, EXIT.stale);
  assert.match(s.reasons[0], /generated 37h ago \(> 36h\)/);
  const before = process.env[STALE_HOURS_ENV];
  process.env[STALE_HOURS_ENV] = '2';
  try {
    assert.equal(evidenceStatus(p, hoursAfter(3)).state, 'stale', 'set after import, so a frozen const would miss it');
    process.env[STALE_HOURS_ENV] = 'soon';
    const bad = evidenceStatus(p, hoursAfter(1));
    assert.equal(bad.state, 'unknown', 'an unusable threshold is unmeasured, never a verdict either way');
    assert.match(bad.reasons[0], new RegExp(STALE_HOURS_ENV));
    assert.throws(() => evidenceStaleHours({ [STALE_HOURS_ENV]: '0' }));
  } finally {
    if (before === undefined) delete process.env[STALE_HOURS_ENV]; else process.env[STALE_HOURS_ENV] = before;
  }
});

test('an evidence input changed since generation makes the pack stale; a feed update alone does not', () => {
  const p = scratch('inputs');
  writeIndex(p); writeRun(p);
  writeFileSync(p.kev, JSON.stringify({ catalogVersion: 'later', vulnerabilities: [] }));
  const feed = evidenceStatus(p, hoursAfter(1));
  assert.equal(feed.state, 'current');
  assert.deepEqual(feed.feedsChanged, ['kev']);
  writeFileSync(p.rollup, JSON.stringify({ sliceId: 'next', repos: [] }));
  const s = evidenceStatus(p, hoursAfter(1));
  assert.equal(s.state, 'stale');
  assert.deepEqual(s.inputsChanged, ['rollup']);
  rmSync(p.ledger);
  assert.deepEqual(evidenceStatus(p, hoursAfter(1)).inputsChanged, ['rollup', 'ledger'], 'a removed input is a change, not a match');
});

test('a failed last refresh is reported with its exit and reason, never as current', () => {
  const p = scratch('failed');
  writeIndex(p);
  writeRun(p, { exit: 1, ok: false, reason: 'step(s) failed: pack (exit 1: boom)', steps: [{ step: 'pack', exit: 1, outcome: 'failed', reason: 'boom' }] });
  const s = evidenceStatus(p, hoursAfter(1));
  assert.equal(s.state, 'failed');
  assert.equal(s.exit, EXIT.failed);
  assert.equal(s.lastRun.exit, 1);
  assert.equal(s.lastRun.failedSteps[0].step, 'pack');
  assert.match(s.reasons.join('\n'), /last refresh failed \(exit 1.*pack \(exit 1: boom\)/);
  const aged = evidenceStatus(p, hoursAfter(100));
  assert.equal(aged.state, 'stale');
  assert.match(aged.reasons.join('\n'), /last refresh failed/, 'staleness does not hide the failure behind it');
});

test('unreadable records fail closed to unknown', () => {
  const p = scratch('corrupt');
  writeFileSync(join(p.out, EVIDENCE_INDEX), '{ not json');
  assert.equal(evidenceStatus(p, GEN).state, 'unknown');
  writeIndex(p, { generatedAt: undefined });
  assert.equal(evidenceStatus(p, GEN).state, 'unknown', 'no generatedAt: age unmeasured');
  writeIndex(p, { inputs: undefined });
  assert.equal(evidenceStatus(p, hoursAfter(1)).state, 'unknown', 'no recorded inputs: change unmeasured');
  writeIndex(p);
  writeFileSync(join(p.out, REFRESH_STATUS), '{ torn');
  const s = evidenceStatus(p, hoursAfter(1));
  assert.equal(s.state, 'unknown');
  assert.match(s.reasons.join('\n'), /last refresh outcome unknown/);
});

// The real pipeline: refresh.mjs must write what the reader reads.
function refreshEnv(dir, extra = {}) {
  return {
    ...process.env, CW_CRA_ROOT: dir,
    CW_ROLLUP: join(FIX, 'rollup.json'), CW_LEDGER: join(FIX, 'ledger.json'),
    CW_ANNOTATIONS: join(FIX, 'annotations.json'), CW_PRODUCTS: join(FIX, 'products.json'),
    CW_KEV: join(FIX, 'kev.json'), CW_EPSS: join(FIX, 'epss.json'),
    CW_CONTROLS: join(REPO, 'cra', 'controls.json'), CW_HISTORY: join(FIX, 'history.json'),
    CW_CASES: join(dir, 'cases.json'), CW_CRA_OUT: join(dir, 'out'),
    CW_ATTEST_KEYDIR: join(dir, 'keys'), CW_ATTEST_LOG: join(dir, 'out', 'attestations.jsonl'),
    CW_CRA_NOW: GEN, CW_ESCALATE: '0', CRA_WEBHOOK_URL: 'https://hooks.example/cra',
    [STALE_HOURS_ENV]: '', ...extra,
  };
}
const statusCli = (env) => spawnSync('node', [join(REPO, 'cra', 'evidence-status.mjs'), '--json'], { env, encoding: 'utf8' });

test('refresh.mjs records its inputs and its outcome, and the reader sees the pack as current', () => {
  const d = join(T, 'pipeline');
  mkdirSync(d, { recursive: true });
  const env = refreshEnv(d);
  const r = spawnSync('node', [join(REPO, 'cra', 'refresh.mjs'), '--no-xlsx', '--no-sign'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const idx = JSON.parse(readFileSync(join(d, 'out', EVIDENCE_INDEX), 'utf8'));
  assert.ok(idx.inputs.find((i) => i.name === 'rollup' && i.state === 'present'), 'the index names its rollup input');
  assert.ok(!idx.artifacts.some((a) => a.path === REFRESH_STATUS), 'the run record is not catalogued as evidence');
  const run = JSON.parse(readFileSync(join(d, 'out', REFRESH_STATUS), 'utf8'));
  assert.equal(run.ok, true);
  assert.equal(run.exit, 0);
  assert.ok(run.steps.length > 0 && run.steps.every((s) => typeof s.outcome === 'string'));
  const s = statusCli(env);
  assert.equal(s.status, 0, s.stdout + s.stderr);
  assert.equal(JSON.parse(s.stdout).state, 'current');
  const later = statusCli({ ...env, CW_CRA_NOW: hoursAfter(EVIDENCE_STALE_HOURS_DEFAULT + 1) });
  assert.equal(later.status, EXIT.stale);
});

test('a refresh stopped at its gate records exit + reason, and the reader reports it', () => {
  const d = join(T, 'gate');
  mkdirSync(d, { recursive: true });
  const env = refreshEnv(d, { CW_PRODUCTS: join(d, 'no-products.json') });
  const r = spawnSync('node', [join(REPO, 'cra', 'refresh.mjs'), '--no-xlsx', '--no-sign'], { env, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  const run = JSON.parse(readFileSync(join(d, 'out', REFRESH_STATUS), 'utf8'));
  assert.equal(run.ok, false);
  assert.equal(run.exit, r.status);
  assert.match(run.reason, /^preflight gate failed/);
  const s = statusCli(env);
  assert.equal(s.status, EXIT['never-generated']);
  const body = JSON.parse(s.stdout);
  assert.equal(body.lastRun.ok, false);
  assert.match(body.reasons.join('\n'), /last refresh failed .*preflight gate failed/);
});
