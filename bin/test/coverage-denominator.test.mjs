// "yarn.lock version resolution did not run" was true and unactionable. osv parsed 904 lockfiles in
// dependabot-core, 146 of them yarn.lock, and refused 2 — both fixtures that are broken on purpose.
// One binary flag turned a 1.4% gap into a lane that reads as dead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { laneCoverage } from '../commitwork.mjs';

const plant = (log) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-cov-'));
  writeFileSync(join(d, 'osv.log'), log);
  writeFileSync(join(d, 'osv.sarif'), '{"runs":[]}');
  return d;
};
const CHECK = {
  id: 'deps-osv',
  report: { file: 'osv.sarif', format: 'sarif', log: 'osv.log' },
  coverageSignals: [{
    pattern: '^Failed to determine version of (.*) while parsing a yarn.lock',
    lane: 'yarn.lock entries osv could not version',
    denominatorPattern: '^Scanned .*yarn\\.lock file and found',
    capture: 1, unit: 'yarn.lock',
  }],
};
const scanned = (n) => Array.from({ length: n }, (_, i) => `Scanned /src/p${i}/yarn.lock file and found 10 packages`).join('\n');

test('the reason carries k of n and names the entries — a reader can weigh 2 of 146', () => {
  const d = plant([scanned(146), 'Failed to determine version of { something: else while parsing a yarn.lock', 'Failed to determine version of encoding while parsing a yarn.lock'].join('\n'));
  const r = laneCoverage(CHECK, d);
  assert.equal(r.coverage, 'reduced');
  assert.equal(r.coverageBasis, 'per-file');
  assert.match(r.coverageReason, /2 of 146 yarn.lock/);
  assert.match(r.coverageReason, /\{ something: else, encoding/, 'the entries are named, so the reader can check whether they matter');
  assert.match(r.coverageReason, /counted from the tool log/, 'the count is log-derived and says so — the scanned repo controls that text');
});

test('a lane with no declared denominator reports reduced, and the BASIS says the gap has no measured size', () => {
  const check = { ...CHECK, coverageSignals: [{ pattern: 'Go call analysis unavailable', lane: 'Go call analysis' }] };
  const r = laneCoverage(check, plant('Go call analysis unavailable\n'));
  assert.equal(r.coverage, 'reduced');
  assert.equal(r.coverageBasis, 'signal',
    'the unmeasured form must be distinguishable from the measured one — in a FIELD a consumer can branch on');
  assert.equal(r.coverageReason, 'Go call analysis did not run',
    'and the reason still names the lane and nothing else: putting the same fact in the prose too would break every reader that pins the sentence, which is exactly what it did');
});

test('a denominator that matches nothing yields no ratio — "2 of 0" is a broken declaration, not coverage', () => {
  const check = { ...CHECK, coverageSignals: [{ ...CHECK.coverageSignals[0], denominatorPattern: '^Scanned .*never-appears file' }] };
  const r = laneCoverage(check, plant('Failed to determine version of x while parsing a yarn.lock\n'));
  assert.equal(r.coverage, 'reduced');
  assert.equal(r.coverageBasis, 'signal', 'falls back to the honest binary form rather than dividing by zero');
});

test('an anchored pattern matches per LINE — without the m flag ^ silently matches nothing but line 1', () => {
  const d = plant(['Scanned /src/a/yarn.lock file and found 3 packages', 'Failed to determine version of q while parsing a yarn.lock'].join('\n'));
  const r = laneCoverage(CHECK, d);
  assert.equal(r.coverageBasis, 'per-file',
    'the failure line is not the first line; a ^-anchored pattern without m would report full coverage forever');
  assert.match(r.coverageReason, /1 of 1 yarn.lock/);
});

test('a full run stays full, and reports its basis as none rather than an empty string', () => {
  const r = laneCoverage(CHECK, plant(`${scanned(3)}\n`));
  assert.equal(r.coverage, 'full');
  assert.equal(r.coverageReason, null);
  assert.equal(r.coverageBasis, 'none');
});

test('a malformed denominator is a declaration bug — unknown, never full', () => {
  const check = { ...CHECK, coverageSignals: [{ ...CHECK.coverageSignals[0], denominatorPattern: '([unclosed' }] };
  const r = laneCoverage(check, plant('Failed to determine version of x while parsing a yarn.lock\n'));
  assert.equal(r.coverage, 'unknown');
  assert.equal(r.coverageBasis, 'declaration-error');
  assert.match(r.coverageReason, /denominatorPattern is not a valid regex/, 'a typo must not become a permanent clean claim');
});

test('the named entries are capped, and the overflow is counted rather than dropped', () => {
  const many = Array.from({ length: 20 }, (_, i) => `Failed to determine version of pkg${i} while parsing a yarn.lock`).join('\n');
  const r = laneCoverage(CHECK, plant(`${scanned(50)}\n${many}`));
  assert.match(r.coverageReason, /20 of 50 yarn.lock/);
  assert.match(r.coverageReason, /\+12 more/, 'a capped list that does not say it was capped reads as complete');
});

test('the bundled deps-osv signal is the one measured against the real log — 2 of 146 on dependabot-core', () => {
  const m = JSON.parse(readFileSync(new URL('../../manifests/security-baseline.json', import.meta.url), 'utf8'));
  const sig = m.checks.find((c) => c.id === 'deps-osv').coverageSignals.find((s) => /yarn/.test(s.lane));
  assert.equal(sig.capture, 1);
  assert.ok(sig.denominatorPattern, 'the yarn signal must declare its denominator, or the question that produced it is unanswered again');
  assert.match(sig.pattern, /^\^/, 'anchored, so a path a scanned repo controls cannot forge a match mid-line');
});
