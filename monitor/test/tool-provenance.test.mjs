// Which build produced a finding. This is the half that was missing on 2026-08-22, when
// trufflehog 3.96.0's Lob detector manufactured 1,311 of the fleet's 1,314 published CRITICALs:
// the box's version was knowable, and not one of those findings carried it.
//
// The load-bearing assertion is the NEGATIVE one — an unstamped report must never acquire the
// version of whatever happens to be installed when the rollup runs. That would attribute rows
// produced days earlier to a binary that never touched them: an inference re-entering as fact,
// which is strictly worse than no stamp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _toolProvenance } from '../extractors.mjs';
import { probeToolVersion, VERSION_LINE, NULL_VERSIONS } from '../tool-version.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-prov-'));
const dirWith = (checkId, body) => {
  const d = mkdtempSync(join(T, 'r-'));
  if (body !== undefined) writeFileSync(join(d, `tool-version-${checkId}.json`),
    typeof body === 'string' ? body : JSON.stringify(body));
  return d;
};

test('a report with no stamp is `not-recorded` — NEVER back-filled from what is installed now', () => {
  const p = _toolProvenance(dirWith('secrets'), 'secrets');
  assert.equal(p.provenance, 'not-recorded');
  assert.equal(p.toolVersions, undefined,
    'guessing a version here would attribute old findings to a binary that never ran them');
});

test('a recorded stamp names the binary that actually ran', () => {
  const d = dirWith('secrets', { check: 'secrets', probedAt: '2026-08-22T00:00:00Z',
    tools: { trufflehog: { state: 'present', version: '3.97.0', versionState: 'stated' } } });
  const p = _toolProvenance(d, 'secrets');
  assert.equal(p.provenance, 'recorded');
  assert.deepEqual(p.toolVersions, { trufflehog: '3.97.0' });
  assert.equal(p.probedAt, '2026-08-22T00:00:00Z');
  assert.equal(p.toolsWithoutVersion, undefined);
});

test('a tool that cannot name its build is listed as such, not as a null nobody reads', () => {
  const d = dirWith('deps-go-govulncheck', { check: 'deps-go-govulncheck',
    tools: { govulncheck: { state: 'present', version: null, versionState: 'unstated', reason: 'v0.0.0' } } });
  const p = _toolProvenance(d, 'deps-go-govulncheck');
  assert.equal(p.provenance, 'recorded');
  assert.deepEqual(p.toolsWithoutVersion, ['govulncheck']);
  assert.equal(p.toolVersions.govulncheck, null);
});

test('a tool absent at run time is recorded — a check can pass on a tool that was not there', () => {
  const d = dirWith('posture-scorecard', { check: 'posture-scorecard',
    tools: { scorecard: { state: 'unavailable', reason: 'not installed' } } });
  const p = _toolProvenance(d, 'posture-scorecard');
  assert.deepEqual(p.toolsAbsentAtRun, ['scorecard']);
});

test('a torn stamp is `unreadable`, which is not the same as absent', () => {
  const d = dirWith('sast', '{ not json');
  assert.equal(_toolProvenance(d, 'sast').provenance, 'unreadable');
});

test('multiple tools behind one check keep separate provenance', () => {
  const d = dirWith('deps-osv', { check: 'deps-osv', tools: {
    'osv-scanner': { state: 'present', version: '2.1.0', versionState: 'stated' },
    trivy: { state: 'present', version: '0.74.0', versionState: 'stated' },
  } });
  const p = _toolProvenance(d, 'deps-osv');
  assert.deepEqual(p.toolVersions, { 'osv-scanner': '2.1.0', trivy: '0.74.0' },
    'a check with two tools has two provenances; collapsing them loses which produced which half');
});

test('probeToolVersion reads the TOOL\'s version line, not its runtime\'s', () => {
  const bin = join(T, 'fake-govulncheck');
  writeFileSync(bin, '#!/bin/sh\necho "Go: go1.26.6"\necho "Scanner: govulncheck@v1.7.0"\n', { mode: 0o755 });
  const old = process.env.CW_GOVULNCHECK_BIN;
  process.env.CW_GOVULNCHECK_BIN = bin;
  try {
    const r = probeToolVersion('govulncheck');
    assert.equal(r.version, '1.7.0');
    assert.notEqual(r.version, '1.26.6', 'that is the Go toolchain');
  } finally { if (old === undefined) delete process.env.CW_GOVULNCHECK_BIN; else process.env.CW_GOVULNCHECK_BIN = old; }
});

test('v0.0.0 is the absence of a version, not a version', () => {
  assert.ok(NULL_VERSIONS.has('0.0.0'));
  assert.ok(VERSION_LINE.govulncheck instanceof RegExp, 'the ambiguous tools declare their line');
});

test('an absent binary is `unavailable`, distinct from a binary that failed to answer', () => {
  const old = process.env.CW_GITLEAKS_BIN;
  process.env.CW_GITLEAKS_BIN = join(T, 'definitely-not-here-xyz');
  try { assert.equal(probeToolVersion('gitleaks').state, 'unavailable'); }
  finally { if (old === undefined) delete process.env.CW_GITLEAKS_BIN; else process.env.CW_GITLEAKS_BIN = old; }
});
