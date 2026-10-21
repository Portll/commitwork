// Computes KEV and EPSS presence per finding (monitor/dep-findings.mjs enrichKevEpss).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichKevEpss } from '../dep-findings.mjs';

test('sets kev to true when usable and id is in set', () => {
  const findings = [{ id: 'CVE-1' }];
  const kev = { usable: true, set: new Set(['CVE-1']) };
  const epss = {};
  const result = enrichKevEpss(findings, kev, epss);
  assert.equal(result[0].kev, true);
});

test('sets kev to false when usable and id is not in set', () => {
  const findings = [{ id: 'CVE-2' }];
  const kev = { usable: true, set: new Set(['CVE-1']) };
  const epss = {};
  const result = enrichKevEpss(findings, kev, epss);
  assert.equal(result[0].kev, false);
});

test('sets kev to null when not usable', () => {
  const findings = [{ id: 'CVE-1' }];
  const kev = { usable: false, set: new Set(['CVE-1']) };
  const epss = {};
  const result = enrichKevEpss(findings, kev, epss);
  assert.equal(result[0].kev, null);
});

test('sets epss to value when id is in epss object', () => {
  const findings = [{ id: 'CVE-1' }];
  const kev = { usable: false, set: new Set() };
  const epss = { 'CVE-1': 0.85 };
  const result = enrichKevEpss(findings, kev, epss);
  assert.equal(result[0].epss, 0.85);
});

test('sets epss to null when id is not in epss object', () => {
  const findings = [{ id: 'CVE-2' }];
  const kev = { usable: false, set: new Set() };
  const epss = { 'CVE-1': 0.85 };
  const result = enrichKevEpss(findings, kev, epss);
  assert.equal(result[0].epss, null);
});

test('returns the same findings array reference', () => {
  const findings = [{ id: 'CVE-1' }];
  const kev = { usable: true, set: new Set(['CVE-1']) };
  const epss = { 'CVE-1': 0.5 };
  const result = enrichKevEpss(findings, kev, epss);
  assert.equal(result, findings);
});

test('handles multiple findings with mixed KEV and EPSS states', () => {
  const findings = [
    { id: 'CVE-1' },
    { id: 'CVE-2' },
    { id: 'CVE-3' }
  ];
  const kev = { usable: true, set: new Set(['CVE-1', 'CVE-3']) };
  const epss = { 'CVE-2': 0.1 };
  const result = enrichKevEpss(findings, kev, epss);
  assert.equal(result[0].kev, true);
  assert.equal(result[0].epss, null);
  assert.equal(result[1].kev, false);
  assert.equal(result[1].epss, 0.1);
  assert.equal(result[2].kev, true);
  assert.equal(result[2].epss, null);
});

test('handles empty findings array', () => {
  const findings = [];
  const kev = { usable: true, set: new Set() };
  const epss = {};
  const result = enrichKevEpss(findings, kev, epss);
  assert.deepEqual(result, []);
});

test('ignores inherited properties of the EPSS map', () => {
  const findings = [{ id: 'toString' }, { id: '__proto__' }, { id: 'constructor' }];
  const result = enrichKevEpss(findings, { usable: false, set: new Set() }, {});
  assert.deepEqual(result.map((f) => f.epss), [null, null, null]);
});
