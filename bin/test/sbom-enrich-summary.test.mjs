// The one-line summary sbom-enrich prints for each report state (bin/sbom-enrich.mjs summaryLine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryLine } from '../sbom-enrich.mjs';

test('a report that did not enrich names its reason and its note', () => {
  assert.equal(summaryLine({ ran: false, unknownReason: 'no-reference', note: 'no syft native document to read' }),
    'sbom-enrich: NOT ENRICHED (no-reference) — no syft native document to read');
});

test('a report with no note falls back to its detail', () => {
  assert.equal(summaryLine({ ran: false, unknownReason: 'unreadable', detail: 'ENOENT' }), 'sbom-enrich: NOT ENRICHED (unreadable) — ENOENT');
});

test('a report with neither note nor detail says so instead of printing undefined', () => {
  assert.equal(summaryLine({ ran: false, unknownReason: 'unreadable' }), 'sbom-enrich: NOT ENRICHED (unreadable) — no reason recorded');
  assert.equal(summaryLine({ ran: true, artifacts: 0 }), 'sbom-enrich: NOTHING TO INVENTORY — no reason recorded');
  assert.equal(summaryLine({ ran: false, unknownReason: 'unstated' }), 'sbom-enrich: PROVENANCE UNVERIFIED (unstated) — no reason recorded');
});

test('a report that ran counts the corrected and unmatched components', () => {
  assert.equal(summaryLine({ ran: true, artifacts: 3, enriched: 2, components: 5, byResolution: { purl: 2 }, unmatched: 3 }),
    'sbom-enrich: 2/5 component(s) corrected ({"purl":2}), 3 unmatched');
});
