// node --test monitor/test/canary-lane.test.mjs — the sweep↔canary-harness contract: a non-zero
// exit still writes the scorecard to stdout; requiredSkipped is present and a LIST; a required
// scenario that could not run exits non-zero (a run of nothing but skips must not exit 0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function harness(args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [join(CW, 'bin', 'canary-harness.mjs'), ...args],
      { cwd: CW, encoding: 'utf8', timeout: 600_000, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, out: String(e.stdout || '') };
  }
}

test('the lane can parse the scorecard on the FAILURE path, which is the only path it exists for', () => {
  // requiring one scenario while running another guarantees required-but-absent deterministically
  const r = harness(['--only', 'T-CLEAN', '--require', 'R-DRIFT', '--json']);
  assert.notEqual(r.code, 0, 'a required scenario that never ran must fail the run');
  assert.equal(r.code, 4, 'and with the code the lane distinguishes from a false clean (2) or a misattribution (3)');
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(r.out); },
    'the scorecard must reach stdout on a non-zero exit, or the lane cannot tell a real failure from a crash');
  assert.deepEqual(parsed.summary.requiredSkipped, ['R-DRIFT'], 'and must NAME what could not run, as a list');
});

test('requiredSkipped is a list even when empty — an absent key would read as "nothing missing"', () => {
  const r = harness(['--only', 'T-CLEAN', '--json']);
  const { summary } = JSON.parse(r.out);
  assert.ok(Array.isArray(summary.requiredSkipped), 'the lane spreads this into its verdict; a non-array becomes a silent []');
  assert.equal(summary.requiredSkipped.length, 0);
  assert.equal(r.code, 0);
});

// one record per scored scenario per run, each carrying `canary` — a record without it rejoins
// the live denominator silently
test('--write appends exactly one adjudication per scored scenario, each marked as a canary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-lane-write-'));
  try {
    execFileSync(process.execPath, [join(CW, 'bin', 'canary-harness.mjs'), '--only', 'T-CLEAN,T-REG', '--write'],
      { cwd: CW, encoding: 'utf8', timeout: 600_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CW_VERDICT_DIR: dir } });
    const records = readFileSync(join(dir, 'adjudications.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(records.length, 2, 'one per scored scenario — not one per gate run, and not one per re-check');
    for (const r of records) {
      assert.equal(r.kind, 'adjudication');
      assert.ok(r.canary, `${r.gate} record lost its canary id — it would rejoin the live denominator`);
      assert.ok(['T-CLEAN', 'T-REG'].includes(r.canary));
      assert.ok(r.basis.includes('truth by construction'), 'the basis must say where the truth came from');
    }
    assert.equal(new Set(records.map((r) => r.canary)).size, 2, 'no scenario banked twice');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every scenario the lane requires by default actually exists', () => {
  // the sweep's --require list is a string — a typo would exit 2 nightly, so pin it against the real set
  const DEFAULT_REQUIRED = 'R-CLEAN,R-DRIFT,R-CORRUPT,R-ADVICE-UNKNOWN,R-CLAIM-MINE,R-CLAIM-THEIRS,R-CLAIM-SHARED,R-CLAIM-STALE,R-STUCK'.split(',');
  const listed = JSON.parse(harness(['--list']).out).map((s) => s.id);
  for (const id of DEFAULT_REQUIRED) {
    assert.ok(listed.includes(id), `the sweep requires ${id}, which is not a scenario — the lane would exit 2 nightly`);
  }
  // every R-* must be required — one missing would skip silently on a clean tree
  for (const id of listed.filter((x) => x.startsWith('R-'))) {
    assert.ok(DEFAULT_REQUIRED.includes(id), `scenario ${id} is not in the sweep's --require list, so it may skip unnoticed`);
  }
});
