// Every counted finding lands in exactly one bucket. It did not: `unknown-cvss` matched no key, so
// `total: 37` stood over a split summing to 2 — the lane looked clean while reporting 37 vulns.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _vendorCounts } from '../extractors.mjs';

const SEVS = ['crit', 'high', 'med', 'low'];
const put = (findings, extra = {}) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-vendor-'));
  writeFileSync(join(d, 'vendor-scan.json'),
    JSON.stringify({ tool: 'vendor-scan', ran: true, findings, unidentified: [], ...extra }));
  return _vendorCounts(d, 'vendor-scan.json');
};
const f = (over = {}) => ({ file: 'vendor/jquery.js', package: 'jquery', version: '3.4.1',
  id: 'GHSA-gxr4-xjj5-5px2', summary: 'XSS', severity: 'med', severitySource: 'agree', ...over });

const accounted = (c) => SEVS.reduce((n, s) => n + c[s], 0) + c.undetermined;

describe('every finding lands in exactly one bucket', () => {
  test('a graded set conserves', () => {
    const c = put([f({ severity: 'crit' }), f({ severity: 'high' }), f({ severity: 'med' }), f({ severity: 'low' })]);
    assert.equal(c.total, 4);
    assert.equal(accounted(c), 4);
    assert.equal(c.undetermined, 0);
  });

  test('the regression itself: an ungradable severity is counted, not dropped', () => {
    // the value retired sevOf emitted, plus the shapes reaching the same place
    const c = put(['unknown-cvss', 'undetermined', 'unknown', '', 'SEVERE'].map((s) => f({ severity: s })));
    assert.equal(c.total, 5);
    assert.equal(c.undetermined, 5, 'all five must be visible as undetermined');
    assert.equal(accounted(c), 5);
    for (const s of SEVS) assert.equal(c[s], 0, `${s} must not absorb an ungraded row`);
  });

  test('a mixed set conserves — the real fleet shape', () => {
    // 35 ungradable + 1 high + 1 moderate, measured 2026-08-22
    const c = put([...Array.from({ length: 35 }, (_, i) => f({ id: `G-${i}`, severity: 'unknown-cvss' })),
      f({ id: 'G-A', severity: 'high' }), f({ id: 'G-B', severity: 'moderate' })]);
    assert.equal(c.total, 37);
    assert.equal(c.undetermined, 35);
    assert.equal(c.high, 1);
    assert.equal(c.med, 1, 'moderate maps to med');
    assert.equal(accounted(c), 37, 'total must equal what the buckets account for');
  });
});

test('undetermined is present even at zero — an absent field reads as a lane that never graded', () => {
  const c = put([f({ severity: 'high' })]);
  assert.equal(c.undetermined, 0);
  assert.ok('undetermined' in c);
});

test('a row keeps the grade\'s provenance so a blank severity can be explained', () => {
  const c = put([f({ severity: 'unknown-cvss', severitySource: 'undetermined',
    severityReason: 'cvss-unsupported-v4.0+label-absent' })]);
  assert.equal(c.findings[0].sev, '', 'an ungradable row must not be published as a severity');
  assert.equal(c.findings[0].severitySource, 'undetermined');
  assert.equal(c.findings[0].severityReason, 'cvss-unsupported-v4.0+label-absent',
    'the cause must survive to the panel — a blank severity with no reason is the defect again');
});

test('an artifact predating the reason field reads as blank, never as a fabricated cause', () => {
  // every stored artifact today; the row must not invent a cause
  const c = put([f({ severity: 'unknown-cvss', severitySource: undefined, severityReason: undefined })]);
  assert.equal(c.findings[0].severityReason, '');
  assert.equal(c.undetermined, 1, 'still conserved, just unexplained');
});

// STPA §6.1: no total, in any bucket, changes when enrichment is on or off. This is the EFFECT
// test. The marker version (enrichment emits no severity field) lives in bin/test/capec-graph and
// asserts field NAMES; it would stay green through a wiring that moved a count.
//
// It was deliberately NOT written until the wiring existed — before that it would have passed over
// an empty subject and gone on passing through the change it exists to catch (1.45).
test('§6.1 conservation — enrichment moves no count, in any bucket', () => {
  const bare = [f({ id: 'G-1', severity: 'high' }), f({ id: 'G-2', severity: 'med' }),
    f({ id: 'G-3', severity: 'unknown-cvss' })];
  const enrichment = {
    cwe: 'CWE-79 CWE-89', cwePillar: 'CWE-707', capec: 'CAPEC-63 CAPEC-85',
    capecVia: 'direct', attack: 'T1059.007', attackTactic: 'execution', capecReason: '',
  };
  const before = put(bare);
  const after = put(bare.map((x) => ({ ...x, ...enrichment })));

  // Both directions of non-vacuity: the enriched set must really be enriched, and the bare set must
  // really be bare. Without these the comparison is two identical nothings.
  assert.ok(after.findings[0].capec, 'enrichment never reached the row — green over an empty subject');
  assert.equal(before.findings[0].capec, '', 'the bare fixture arrived already enriched');

  assert.equal(after.findings.length, before.findings.length, 'enrichment multiplied rows');
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (k === 'findings') continue;
    assert.deepEqual(after[k], before[k], `enrichment moved ${k}`);
  }
});

test('§6.2 a heavy attribution is still ONE row', () => {
  const many = Array.from({ length: 59 }, (_, i) => `CAPEC-${i}`).join(' ');
  const c = put([f({ capec: many, attack: 'T1 T2 T3 T4 T5', attackTactic: 'execution impact' })]);
  assert.equal(c.findings.length, 1, '59 patterns became more than one row');
  assert.equal(c.total, 1);
  assert.equal(accounted(c), 1);
});

test('an unreachable advisory database stays a void, not a conserved zero', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-vendor-'));
  writeFileSync(join(d, 'vendor-scan.json'), JSON.stringify({ ran: false, reason: 'OSV 503', findings: [] }));
  const c = _vendorCounts(d, 'vendor-scan.json');
  assert.equal(c.ran, false);
  assert.equal(c.noscan, true);
});
