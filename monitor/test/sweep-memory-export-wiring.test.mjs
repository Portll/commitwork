// The sweep must CLASSIFY the memory-layer export, not merely run it.
//
// The defect: monitor/sweep.mjs spawned monitor/export-overwatch.mjs with `stdio: 'inherit'` inside
// a bare try/catch, and the child exits 0 on every outcome by design — so the exit code carried no
// information and nothing was recorded. Measured 2026-10-03 on the live reports tree: 34 of 34
// rollups carried a receipts file, 42 of the 390 receipts in them recorded a write that never
// happened, and no batch-verdict.json or sweep-journal.jsonl line named the export at all.
//
// WHAT THIS FILE IS AND IS NOT. The classification itself is executed and asserted in
// monitor/test/memory-export-health.mjs's suite, and the verdict field is executed in
// monitor/test/sweep-verdict.test.mjs. Neither of those can see whether sweep.mjs calls them, and
// the export block is an inline step in a top-level script rather than an importable function — so
// this is a CALL-SITE guard over the source, the same technique and the same limitation as
// monitor/test/sweep-codeql-fleet-wiring.test.mjs and monitor/test/sweep-runner.test.mjs. It
// proves the wiring is written, not that a sweep executed it. Said plainly because a guard that
// reads like an execution is the shape this repository refuses everywhere else.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'sweep.mjs'), 'utf8');

/** The statement that assigns the export outcome into the verdict parts. */
const assignment = () => {
  const i = SRC.indexOf('verdictParts.memoryExport');
  assert.ok(i > -1, 'sweep.mjs must assign verdictParts.memoryExport — without it the field is never supplied and the verdict writes `unknown` forever');
  return SRC.slice(SRC.lastIndexOf('\n', i), SRC.indexOf('\n', SRC.indexOf('\n', i) + 1));
};

describe('sweep.mjs records the memory-layer export\'s outcome', () => {
  test('the outcome is read from the receipts, not inferred from the child exit code', () => {
    assert.match(SRC, /readExportHealth\(/,
      'the child exits 0 on every outcome, so its exit code is not evidence — the receipts beside the rollup are');
    assert.match(SRC, /from '\.\/memory-export-health\.mjs'/,
      'the classifier must be the shared one the panel reads, so the page and the verdict cannot disagree');
  });

  test('the receipts are read from the SWEPT area\'s out dir, the same one the rollup came from', () => {
    const call = SRC.slice(SRC.indexOf('readExportHealth('));
    const args = call.slice(0, call.indexOf(')') + 1);
    assert.match(args, /dir:\s*OUT_DIR/,
      'the export writes beside the rollup in OUT_DIR; a hand-joined reports/<name> is the bug this repo has already paid for twice');
  });

  test('the read is gated on the slice start, so last run\'s receipts cannot pass as this run\'s', () => {
    const call = SRC.slice(SRC.indexOf('readExportHealth('));
    const args = call.slice(0, call.indexOf(')') + 1);
    assert.match(args, /since:\s*START_ISO/,
      'the receipts file sits at a fixed path and is overwritten per run, so an export that skipped leaves the PREVIOUS run\'s answer in place — a stale reading reads exactly like a live one');
  });

  test('the outcome reaches the verdict record', () => {
    assert.match(assignment(), /verdictParts\.memoryExport\s*=/,
      'a classification nobody assigns is a log line, and a log-line-only receipt is not evidence');
    // ...and the spread is what carries verdictParts into the record.
    assert.match(SRC, /\.\.\.verdictParts,/,
      'buildAreaVerdict is called with ...verdictParts — the mechanism by which this field lands');
  });

  test('switching the export off is its own state, never a read of the stale file', () => {
    const i = SRC.indexOf("process.env.SUBSTRATE_EXPORT !== '0'");
    assert.ok(i > -1, 'setup: the export opt-out branch not found');
    const block = SRC.slice(i, i + 1400);
    assert.match(block, /skippedExport\(/,
      'SUBSTRATE_EXPORT=0 must record `skipped` — reading the receipts file on that path would report the previous run\'s outcome as this one\'s');
  });

  test('the outcome is printed as well as recorded', () => {
    assert.match(SRC, /exportHealthLine\(/,
      'the operator tailing a sweep must see the export\'s outcome in the log, not only in a JSON file');
  });

  test('a broken export reaches the done line and NOT the exit code', () => {
    // sweepExit() summarises failed steps without moving the exit, and that split is deliberate: a
    // lane that turns the whole sweep red on a backend outage is a lane somebody switches off
    // within a fortnight (the A4 argument in sweep-verdict.mjs).
    assert.match(SRC, /verdictParts\.memoryExport\.kind === 'broken'/,
      'a broken export must be named in the sweep\'s summary line');
    const exitCall = SRC.slice(SRC.indexOf('sweepExit({'));
    assert.doesNotMatch(exitCall.slice(0, exitCall.indexOf('}') + 1), /memoryExport/,
      'and it must not be fed to sweepExit as a scan outcome or a verdict-recording failure, which are the two things that DO move the exit');
  });
});
