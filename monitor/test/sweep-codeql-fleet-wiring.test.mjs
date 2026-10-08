// R-4 regression guard: codeql-fleet.json's producer must have a SCHEDULED writer.
//
// The defect (REMEDIATION-ordered-2026-08-02.md §2 wave 3, R-4): admin/serve.mjs's dashboard
// derived its CodeQL numbers by regexing a fleet run.log while monitor/codeql-fleet-data.mjs —
// built precisely to produce the structured, panel-consumable codeql-fleet.json — sat unread.
// Verified at the time: `codeql-fleet` appeared ZERO times in monitor/sweep.mjs, so the only way
// the artifact was ever produced was a human running the script by hand, and it rotted between
// runs. The fix is admin/serve.mjs reading the artifact (pinned in
// admin/test/scanner-findings-route.test.mjs) PLUS sweep.mjs actually calling the producer, which
// is what this file pins — the same source-assertion technique monitor/test/sweep-runner.test.mjs
// uses for the fleet driver, because this too is an inline step in a top-level script rather than
// an importable function.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'sweep.mjs'), 'utf8');

describe('sweep.mjs schedules the codeql-fleet.json producer every run', () => {
  test('the per-area sweep body invokes codeql-fleet-data.mjs', () => {
    assert.match(SRC, /codeql-fleet-data\.mjs/,
      'sweep.mjs must call monitor/codeql-fleet-data.mjs — the artifact must not be manual-only');
  });

  test('the call is routed through the same CW_MONITOR_OUT env every other per-area step uses', () => {
    const i = SRC.indexOf('codeql-fleet-data.mjs');
    assert.ok(i > -1, 'setup: codeql-fleet-data.mjs call not found');
    const line = SRC.slice(SRC.lastIndexOf('\n', i), SRC.indexOf('\n', i));
    assert.match(line, /env:\s*childEnv/,
      'the producer must write into the SAME area out-dir this sweep is scoped to, not the ambient default');
  });

  test('a producer failure is surfaced, not swallowed silently', () => {
    const i = SRC.indexOf('codeql-fleet-data.mjs');
    const block = SRC.slice(i, SRC.indexOf(';', SRC.indexOf('catch', i)) + 1);
    assert.match(block, /console\.error/,
      'a failed codeql-fleet-data run must print, even though it must not abort the sweep (best-effort, ' +
      'matching timeline/runtime/compact/export-overwatch) — a step that fails silently is worse than one ' +
      'that is merely non-fatal');
  });

  test('it runs per-area (unlike the FLEET-WIDE finalise steps), so a --all child does not skip it', () => {
    // The fleet-wide steps (timeline/runtime/compact/projectstatus) are explicitly gated on
    // `!process.env.CW_SWEEP_CHILD` because they operate over ALL areas at once. codeql-fleet.json
    // is scoped to the area currently being swept, so every child of `--all` must still write its
    // own — gating it the same way would mean a fleet sweep produces the artifact for exactly one
    // area (whichever the parent happens to be) and leaves every other area's CodeQL card stale.
    const i = SRC.indexOf('codeql-fleet-data.mjs');
    const before = SRC.slice(Math.max(0, i - 400), i);
    assert.doesNotMatch(before, /if\s*\(!process\.env\.CW_SWEEP_CHILD\)\s*\{?\s*$/,
      'the codeql-fleet step must not be gated behind CW_SWEEP_CHILD — it is a per-area artifact');
  });
});
