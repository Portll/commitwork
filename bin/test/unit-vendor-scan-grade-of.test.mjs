// Computes the severity grade and source for a vulnerability (bin/vendor-scan.mjs gradeOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeOf } from '../vendor-scan.mjs';

test('returns undetermined when v is null', () => {
  const r = gradeOf(null);
  assert.deepEqual(r, { severity: "undetermined", severitySource: "undetermined", cvss: "", cvssScore: null, cvssVia: "", label: "", severityReason: "cvss-absent+label-absent" });
});

test('returns undetermined when v has no severity and no index', () => {
  const r = gradeOf({ id: 'GHSA-1' });
  assert.deepEqual(r, { severity: "undetermined", severitySource: "undetermined", cvss: "", cvssScore: null, cvssVia: "", label: "", severityReason: "cvss-absent+label-absent" });
});

test('returns cvss severity when only CVSS vector is present', () => {
  const v = { id: 'GHSA-1', severity: [{ score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] };
  const r = gradeOf(v);
  assert.deepEqual(r, { severity: "crit", severitySource: "cvss", cvss: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", cvssScore: 9.8, cvssVia: "osv", label: "", severityReason: "label-absent" });
});

test('returns label severity when only label is present', () => {
  const v = { id: 'GHSA-1', database_specific: { severity: 'high' } };
  const r = gradeOf(v);
  assert.deepEqual(r, { severity: "high", severitySource: "label", cvss: "", cvssScore: null, cvssVia: "", label: "high", severityReason: "cvss-absent" });
});

test('returns agreement when CVSS and label match', () => {
  const v = { id: 'GHSA-1', severity: [{ score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }], database_specific: { severity: 'critical' } };
  const r = gradeOf(v);
  assert.deepEqual(r, { severity: "crit", severitySource: "agree", cvss: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", cvssScore: 9.8, cvssVia: "osv", label: "critical", severityReason: "" });
});

test('returns higher severity on disagreement', () => {
  const v = { id: 'GHSA-1', severity: [{ score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }], database_specific: { severity: 'high' } };
  const r = gradeOf(v);
  assert.deepEqual(r, { severity: "crit", severitySource: "disagreement", cvss: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", cvssScore: 9.8, cvssVia: "osv", label: "high", severityReason: "" });
});

test('uses index entry when OSV has no scorable vectors', () => {
  const v = { id: 'GHSA-1', severity: [] };
  const index = { 'GHSA-1': { v3: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', s3: 9.8, label: 'critical' } };
  const r = gradeOf(v, index);
  assert.deepEqual(r, { severity: "crit", severitySource: "agree", cvss: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", cvssScore: 9.8, cvssVia: "index", label: "critical", severityReason: "" });
});

test('returns undetermined when v is undefined', () => {
  const r = gradeOf(undefined);
  assert.deepEqual(r, { severity: "undetermined", severitySource: "undetermined", cvss: "", cvssScore: null, cvssVia: "", label: "", severityReason: "cvss-absent+label-absent" });
});
