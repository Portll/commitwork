// K7 / WP2 — a fan-out over N repos carries per-item status and an exit that names what did not
// run. The measured shape: 29 sweeps, 29 errors, 0 journals, exit 0 each (2026-08-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanOutcome, sweepExit, buildAreaVerdict } from '../sweep-verdict.mjs';

test('scanOutcome: clean and findings both RAN; refusal, signal, spawn failure and null did not', () => {
  assert.equal(scanOutcome({ name: 'a', code: 0 }).ran, true);
  const f = scanOutcome({ name: 'a', code: 1 });
  assert.equal(f.ran, true); assert.equal(f.why, 'findings');
  const r = scanOutcome({ name: 'a', code: 2 });
  assert.equal(r.ran, false); assert.match(r.why, /refused before scanning/);
  const k = scanOutcome({ name: 'a', code: null, signal: 'SIGKILL' });
  assert.equal(k.ran, false); assert.match(k.why, /killed by SIGKILL/);
  const s = scanOutcome({ name: 'a', code: null, error: 'spawn node ENOENT' });
  assert.equal(s.ran, false); assert.match(s.why, /spawn failed/);
  const n = scanOutcome({ name: 'a' });
  assert.equal(n.ran, false); assert.match(n.why, /exit null/);
  assert.equal(scanOutcome({ name: 'a', code: 137 }).ran, false);
});

test('sweepExit: non-zero names every scan that did not run, and a verdict not recorded', () => {
  const scans = [scanOutcome({ name: 'ok', manifest: 'm.json', code: 1 }), scanOutcome({ name: 'dead', manifest: 'm.json', code: 2 }), scanOutcome({ name: 'gone', code: null, signal: 'SIGTERM' })];
  const x = sweepExit({ scans, verdictRecorded: true });
  assert.equal(x.exit, 1);
  assert.deepEqual(x.notRan, ['dead (m.json): commitwork refused before scanning (exit 2)', 'gone: killed by SIGTERM']);
  assert.match(x.line, /2 of 3 scan\(s\) did NOT run/);
  const v = sweepExit({ scans: [scans[0]], verdictRecorded: false });
  assert.equal(v.exit, 1);
  assert.match(v.line, /verdict was NOT recorded/);
});

test('sweepExit: findings are not a sweep failure, and failed finalize steps are summarised WITHOUT moving the exit', () => {
  const x = sweepExit({ scans: [scanOutcome({ name: 'a', code: 1 }), scanOutcome({ name: 'b', code: 0 })], verdictRecorded: true, failedSteps: ['learning', 'forensics'] });
  assert.equal(x.exit, 0, 'A4: a sweep red on every stale learning view is switched off within a fortnight');
  assert.match(x.line, /2 finalize step\(s\) failed .*learning, forensics/);
  assert.match(x.line, /exit unchanged/);
  assert.equal(sweepExit({ scans: [], verdictRecorded: true }).exit, 0);
});

test('the area verdict carries one outcome per scan, served-safe', () => {
  const rec = buildAreaVerdict({
    sliceId: 's', area: 'x', group: 'g', sweptAll: true,
    repos: { resolved: 2, present: 2, scanned: 2, missing: [], scans: [scanOutcome({ name: 'a', manifest: 'm.json', code: 1 }), scanOutcome({ name: 'b', manifest: 'm.json', code: 2 })] },
    startedAt: 't0', finishedAt: 't1', durationSecs: 1,
  }, { root: '/r' });
  assert.equal(rec.repos.scans.length, 2);
  assert.deepEqual(rec.repos.scans.map((s) => s.ran), [true, false]);
});
