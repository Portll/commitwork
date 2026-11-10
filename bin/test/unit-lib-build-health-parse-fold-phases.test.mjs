// Folds parsed phase results into a build-health verdict (bin/lib/build-health-parse.mjs foldPhases).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldPhases } from '../lib/build-health-parse.mjs';

test('returns unreadable when parsed is incomplete', () => {
  const r = foldPhases({ lang: 'js', parsed: { complete: false, phases: [] } });
  assert.deepEqual(r, { green: false, status: "unreadable", phases: [], failedPhase: null, testPhasePresent: true, note: "the container produced no phase terminator \u2014 it died mid-run (OOM kill, daemon restart, or truncated output). Not a verdict on the repo." });
});

test('returns env-blocked when an infra phase fails', () => {
  const r = foldPhases({ lang: 'js', parsed: { complete: true, phases: [{ name: 'materialise', attempted: true, green: false, exit: 1 }] } });
  assert.deepEqual(r, { green: false, status: "env-blocked", phases: [{ name: "materialise", attempted: true, green: false, exit: 1 }], failedPhase: "materialise", testPhasePresent: true, note: "the materialise phase exited 1 \u2014 the workspace copy could not be made on this runner (disk, permissions, or a missing tar in the image), so the repo's build was never attempted. A property of the runner, not of the repo." });
});

test('returns RED when a non-infra phase fails', () => {
  const r = foldPhases({ lang: 'js', parsed: { complete: true, phases: [{ name: 'build', attempted: true, green: false, exit: 1 }] } });
  assert.deepEqual(r, { green: false, status: "RED", phases: [{ name: "build", attempted: true, green: false, exit: 1 }], failedPhase: "build", testPhasePresent: true, note: "build phase exited 1" });
});

test('returns no-tests when test phase ran but count is zero', () => {
  const r = foldPhases({ lang: 'js', parsed: { complete: true, phases: [{ name: 'test', attempted: true, green: true }] }, testCount: 0 });
  assert.deepEqual(r, { green: false, status: "no-tests", phases: [{ name: "test", attempted: true, green: true }], failedPhase: null, testPhasePresent: true, testCount: 0, note: "the test phase ran and executed zero tests \u2014 a passing exit code over an empty set is not evidence of health" });
});

test('returns no-tests when no test phase was attempted', () => {
  const r = foldPhases({ lang: 'js', parsed: { complete: true, phases: [{ name: 'build', attempted: true, green: true }] } });
  assert.deepEqual(r, { green: false, status: "no-tests", phases: [{ name: "build", attempted: true, green: true }], failedPhase: null, testPhasePresent: false, testCount: null, note: "no test phase was run for this repo (no test script/target declared) \u2014 nothing was verified" });
});

test('returns green when all phases pass and test count is present', () => {
  const r = foldPhases({ lang: 'js', parsed: { complete: true, phases: [{ name: 'test', attempted: true, green: true }] }, testCount: 5 });
  assert.deepEqual(r, { green: true, status: "green", phases: [{ name: "test", attempted: true, green: true }], failedPhase: null, testPhasePresent: true, testCount: 5, note: undefined });
});

test('returns green with undefined note when test count is null', () => {
  const r = foldPhases({ lang: 'js', parsed: { complete: true, phases: [{ name: 'test', attempted: true, green: true }] } });
  assert.deepEqual(r, { green: true, status: "green", phases: [{ name: "test", attempted: true, green: true }], failedPhase: null, testPhasePresent: true, testCount: null, note: "all phases passed; test count not parsed for this language (uncounted, not zero)" });
});

test('returns green when test phase exists with attempted false and count is null', () => {
  const r = foldPhases({ lang: 'js', parsed: { complete: true, phases: [{ name: 'test', attempted: false, green: true }] } });
  assert.deepEqual(r, { green: false, status: "no-tests", phases: [{ name: "test", attempted: false, green: true }], failedPhase: null, testPhasePresent: false, testCount: null, note: "no test phase was run for this repo (no test script/target declared) \u2014 nothing was verified" });
});
