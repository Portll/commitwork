// The unknown predicate, asserted where it actually has to hold: on the blocks a REAL rollup emits.
//
// monitor/unknown.mjs shipped with a full test suite and stampUnknown() shipped with no caller at
// all — exported, correct, verified by hand against four lane shapes, and reached by nothing. The
// library was proven; the APPLICATION of it was not. So these assertions run the rollup as a child
// process and read its output, rather than calling the stamper directly.
//
// Both directions are pinned, because this lane has been wrong in both:
//   explicit uncertainty — a lane that could not read its artifact must not aggregate as a clean zero
//   explicit uncertainty   — a lane that scanned and found things must not be marked unknown by an
//                       unrelated field. _toolProvenance answers `not-recorded` for every category
//                       with no tool-version stamp, which is one of the fifteen legacy unknown
//                       words, and stamping the MERGED block fabricated a void over real findings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNKNOWN_REASONS } from '../unknown.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROLLUP = join(CW, 'monitor', 'rollup.mjs');
const NO_FETCH = 'data:text/javascript,globalThis.fetch = undefined;';

const glRow = (file, line) => ({
  RuleID: 'generic-token', Description: 'found a secret', StartLine: line, EndLine: line,
  StartColumn: 1, EndColumn: 9, Match: 'authorization: TOKEN', Secret: 'TOKEN', File: file,
  Commit: 'abc123def4567890', Entropy: 3.7, Date: '2026-01-01T00:00:00Z',
  Fingerprint: `${file}:generic-token:${line}`,
});
const checksRow = (id) => ({ id, status: 'ok', started: '2026-08-01T12:00:00.000Z' });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-unkstamp-'));
  const AREAS = [{ slug: 'unk-area', label: 'unk', out: 'unk-area', primary: true, members: ['alpha'] }];
  const regPath = join(root, 'projects.json');
  writeFileSync(regPath, JSON.stringify({
    reportsRoot: join(root, 'reports'), monitorOutput: 'unk-area',
    defaultManifest: 'security-baseline', roots: [], projects: [], areas: AREAS,
  }));
  for (const a of AREAS) mkdirSync(join(root, 'reports', a.out), { recursive: true });

  const batch = join(root, 'reports', 'sweep-20260801120000-unk-area');
  mkdirSync(join(batch, 'alpha'), { recursive: true });
  writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify({
    sliceId: 'sweep-20260801120000', kind: 'sweep', group: 'all', only: null, sweptAll: true,
    area: 'unk-area', areaOut: 'reports/unk-area', startedAt: '2026-08-01T12:00:00.000Z',
    scope: { repos: [{ name: 'alpha', manifests: ['security-baseline'] }], excluded: [], lifecycle: {} },
    anchors: {},
  }));

  // A lane that SCANNED and found something — no tool-version stamp anywhere in this fixture, so
  // every block's provenance is `not-recorded`. This one must NOT come back unknown.
  writeFileSync(join(batch, 'alpha', 'gitleaks.json'), JSON.stringify([glRow('src/a.js', 5)]));
  // A lane whose artifact does not parse. This one MUST come back unknown.
  writeFileSync(join(batch, 'alpha', 'semgrep.sarif'), '{ this is not json');
  writeFileSync(join(batch, 'alpha', 'checks-status.json'),
    JSON.stringify(['secrets-gitleaks', 'sast'].map(checksRow)));
  return { root, batch, regPath, out: join(root, 'reports', 'unk-area') };
}

const FX = fixture();
const run = spawnSync(process.execPath, ['--import', NO_FETCH, ROLLUP, FX.batch],
  { cwd: CW, encoding: 'utf8', env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: FX.regPath, CW_MONITOR_OUT: '' } });
assert.equal(run.status, 0, `fixture rollup failed: ${run.stderr?.slice(0, 800)}`);
const rollup = JSON.parse(readFileSync(join(FX.out, 'rollup.json'), 'utf8'));

// Derived from the emitted rollup, never a hand-list of category keys — a key list beside the
// registry it describes is the drift this repo has already paid for four times.
const blocks = Object.entries((rollup.repos?.[0] ?? Object.values(rollup.repos || {})[0])?.scanners
  || rollup.repos?.alpha?.scanners || {});

test('the fixture actually produced scanner blocks — otherwise everything below is vacuous', () => {
  assert.ok(blocks.length >= 2,
    `expected at least 2 scanner blocks, got ${blocks.length}: ${JSON.stringify(rollup.repos)?.slice(0, 400)}`);
});

test('a lane whose artifact does not parse is stamped unknown, with a DECLARED reason', () => {
  const stamped = blocks.filter(([, b]) => b && b.unknown === true);
  assert.ok(stamped.length >= 1,
    `no block came back unknown — stampUnknown is exported and unreached again. blocks: ${blocks.map(([k]) => k).join(',')}`);
  for (const [key, b] of stamped) {
    assert.ok(Object.prototype.hasOwnProperty.call(UNKNOWN_REASONS, b.unknownReason),
      `${key} is unknown for '${b.unknownReason}', which is not a declared reason`);
  }
});

test('a lane that SCANNED and found things is never unknown — explicit uncertainty', () => {
  // The defect that wiring this surfaced. Every block in this fixture has provenance
  // `not-recorded`, because no tool-version stamp was planted; if that leaked into the predicate,
  // a lane with real findings would be published as a void.
  for (const [key, b] of blocks) {
    if (!b || !(b.total > 0)) continue;
    assert.notEqual(b.unknown, true,
      `${key} found ${b.total} thing(s) and was marked unknown (${b.unknownReason}) — a fabricated void over a real result`);
  }
  const withFindings = blocks.filter(([, b]) => b && b.total > 0);
  assert.ok(withFindings.length >= 1, 'no block found anything — the assertion above checked nothing');
});

test('provenance is recorded as not-recorded, so the previous test was a real test', () => {
  // Non-vacuity for the explicit uncertainty assertion: it only means something if the fixture really
  // does carry the field that used to poison the predicate.
  const provenances = blocks.map(([, b]) => b && b.provenance).filter(Boolean);
  assert.ok(provenances.includes('not-recorded'),
    `no block carries provenance 'not-recorded', so the fabricated-void case was never exercised: ${provenances.join(',')}`);
});

// ── the fleet-level answer, which is what the predicate was built for ──────────────────────────
// monitor/unknown.mjs made "how much of what this fleet published is not a result" answerable and
// nothing asked it for three days. A library nothing calls is the shape this whole lane exists to
// refuse, so these assert the number reaches the published slice.

test('the slice publishes a fleet unknown tally with a real denominator', () => {
  const u = rollup.unknownFleet;
  assert.ok(u, 'unknownFleet is absent — the question is answerable and unasked again');
  assert.ok(u.total >= 2, `denominator must count every block, got ${u.total}`);
  assert.ok(u.blocks >= 1, 'the fixture plants an unparseable lane; zero here means nothing was counted');
  assert.equal(u.rate, Math.round((u.blocks / u.total) * 10_000) / 10_000,
    'the rate must be derived from the two numbers beside it, not computed separately');
});

test('every reason in the tally is a DECLARED reason, not a coined adjective', () => {
  const reasons = Object.keys(rollup.unknownFleet.byReason);
  assert.ok(reasons.length, 'reasons are what make the count actionable — a bare number is not');
  for (const r of reasons) {
    assert.ok(Object.prototype.hasOwnProperty.call(UNKNOWN_REASONS, r),
      `'${r}' is not in the closed set — the fragmentation this replaced is back`);
  }
});

test('byReason keys are SORTED — rollup.json is asserted byte-identical on a re-roll', () => {
  const keys = Object.keys(rollup.unknownFleet.byReason);
  assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b)),
    'object key order is part of the bytes, so an unsorted map breaks re-roll determinism');
});

test('the per-category tally names WHICH lane is unknown, not just how many', () => {
  const withUnknown = Object.entries(rollup.scanners || {}).filter(([, a]) => a && a.unknownBlocks);
  assert.ok(withUnknown.length, 'no category carries unknownBlocks — the fleet number has no drill-down');
  for (const [key, a] of withUnknown) {
    assert.ok(a.unknownByReason && Object.keys(a.unknownByReason).length,
      `${key} reports a count with no reason, which is a number nobody can act on`);
    assert.ok(a.unknownBlocks <= a.repos, `${key}: more unknown blocks than repos`);
  }
});

test('unknownBlocks is NOT the same field as coverage — they answer different questions', () => {
  // coverage asks how much of the SUBJECT a check could see; unknownBlocks asks whether it produced
  // a result at all. A lane can have full coverage over an unparseable artifact. Merging them would
  // make both unreadable, so this pins that they are independent.
  const sast = Object.entries(rollup.scanners || {}).find(([k]) => /sast/i.test(k));
  if (!sast) return;                     // fixture shape changed; the other tests will say so
  const [, agg] = sast;
  if (agg.unknownBlocks && agg.coverage) {
    assert.notEqual(agg.unknownBlocks, agg.coverageChecks?.unknown,
      'if these are always equal, one of them is redundant and the distinction is not being kept');
  }
});
