// Generates a human-readable summary line describing the sbom-enrich outcome (bin/sbom-enrich.mjs summaryLine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryLine } from '../sbom-enrich.mjs';

test('returns NOTHING TO INVENTORY when ran is true and no artifacts were processed', () => {
  const report = { ran: true, artifacts: 0, note: 'nothing to do' };
  const expected = 'sbom-enrich: NOTHING TO INVENTORY \u2014 nothing to do';
  assert.equal(summaryLine(report), expected);
});

test('uses detail when note is missing for NOTHING TO INVENTORY', () => {
  const report = { ran: true, artifacts: 0, detail: 'no files found' };
  const expected = 'sbom-enrich: NOTHING TO INVENTORY \u2014 no files found';
  assert.equal(summaryLine(report), expected);
});

test('falls back to generic reason when neither note nor detail are present', () => {
  const report = { ran: true, artifacts: 0 };
  const expected = 'sbom-enrich: NOTHING TO INVENTORY \u2014 no reason recorded';
  assert.equal(summaryLine(report), expected);
});

test('returns enriched summary when ran is true and artifacts were processed', () => {
  const report = {
    ran: true,
    enriched: 5,
    components: 10,
    byResolution: { direct: 3, indirect: 2 },
    unmatched: 1,
    artifacts: 7,
    note: 'some changes made'
  };
  const expected = 'sbom-enrich: 5/10 component(s) corrected ({"direct":3,"indirect":2}), 1 unmatched';
  assert.equal(summaryLine(report), expected);
});

test('uses detail instead of note for enriched summary when note is absent', () => {
  const report = {
    ran: true,
    enriched: 2,
    components: 2,
    byResolution: {},
    unmatched: 0,
    artifacts: 2,
    detail: 'all good'
  };
  const expected = 'sbom-enrich: 2/2 component(s) corrected ({},), 0 unmatched';
  assert.equal(summaryLine(report), 'sbom-enrich: 2/2 component(s) corrected ({}), 0 unmatched');
});

test('returns PROVENANCE UNVERIFIED when ran is false and unknownReason is unstated', () => {
  const report = { ran: false, unknownReason: 'unstated', note: 'missing provenance' };
  const expected = 'sbom-enrich: PROVENANCE UNVERIFIED (unstated) \u2014 missing provenance';
  assert.equal(summaryLine(report), expected);
});

test('falls back to detail for PROVENANCE UNVERIFIED when note is missing', () => {
  const report = { ran: false, unknownReason: 'unstated', detail: 'no provenance data' };
  const expected = 'sbom-enrich: PROVENANCE UNVERIFIED (unstated) \u2014 no provenance data';
  assert.equal(summaryLine(report), expected);
});

test('returns NOT ENRICHED with unknownReason when ran is false and reason is not unstated', () => {
  const report = { ran: false, unknownReason: 'unsupported-format', note: 'cannot parse' };
  const expected = 'sbom-enrich: NOT ENRICHED (unsupported-format) \u2014 cannot parse';
  assert.equal(summaryLine(report), expected);
});

test('uses generic reason when both note and detail are missing for NOT ENRICHED', () => {
  const report = { ran: false, unknownReason: 'error' };
  const expected = 'sbom-enrich: NOT ENRICHED (error) \u2014 no reason recorded';
  assert.equal(summaryLine(report), expected);
});
