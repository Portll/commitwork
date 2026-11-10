// Computes a maturity ledger with per-check stages, tallies, and readiness summary (monitor/maturity-ledger.mjs buildMaturityLedger).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMaturityLedger } from '../maturity-ledger.mjs';

test('a non-publishing check is terminal and excluded from eligible', () => {
  const r = buildMaturityLedger({ checks: [{ id: 'sbom', lane: 'sbom' }], produced: new Set(['sbom']), addressed: new Set(['sbom']) });
  assert.deepEqual(r, { at: null, rows: [{ check: "sbom", lane: "sbom", stage: "wired", why: "declared non-publishing: produces a CycloneDX document, not findings", terminal: true }], summary: { checksDeclared: 1, nonPublishingByDesign: 1, eligibleForFindings: 0, tally: { declared: 0, wired: 1, producing: 0, gradeable: 0 }, gradeableFraction: 0, adjudicatedFraction: null, adjudicated: null, adjudicableTotal: null, readiness: "0 of 0 checks gradeable; adjudication unknown \u2014 no issue store was supplied, which is not the same as none adjudicated" } });
});

test('a check with a lane but no produced rows is wired', () => {
  const r = buildMaturityLedger({ checks: [{ id: 'sast', lane: 'sast' }], produced: new Set(), addressed: new Set() });
  assert.deepEqual(r, { at: null, rows: [{ check: "sast", lane: "sast", stage: "wired", why: "has a lane but emitted no rows in the latest rollup" }], summary: { checksDeclared: 1, nonPublishingByDesign: 0, eligibleForFindings: 1, tally: { declared: 0, wired: 1, producing: 0, gradeable: 0 }, gradeableFraction: 0, adjudicatedFraction: null, adjudicated: null, adjudicableTotal: null, readiness: "0 of 1 checks gradeable; adjudication unknown \u2014 no issue store was supplied, which is not the same as none adjudicated" } });
});

test('a check with produced rows but no detector identity is producing', () => {
  const r = buildMaturityLedger({ checks: [{ id: 'sast', lane: 'sast' }], produced: new Set(['sast']), addressed: new Set() });
  assert.deepEqual(r, { at: null, rows: [{ check: "sast", lane: "sast", stage: "producing", why: "emits rows, but they carry no detector identity \u2014 a finding here cannot be attributed to anything fixable" }], summary: { checksDeclared: 1, nonPublishingByDesign: 0, eligibleForFindings: 1, tally: { declared: 0, wired: 0, producing: 1, gradeable: 0 }, gradeableFraction: 0, adjudicatedFraction: null, adjudicated: null, adjudicableTotal: null, readiness: "0 of 1 checks gradeable; adjudication unknown \u2014 no issue store was supplied, which is not the same as none adjudicated" } });
});

test('a check with produced rows and detector identity is gradeable', () => {
  const r = buildMaturityLedger({ checks: [{ id: 'sast', lane: 'sast' }], produced: new Set(['sast']), addressed: new Set(['sast']) });
  assert.deepEqual(r, { at: null, rows: [{ check: "sast", lane: "sast", stage: "gradeable", why: "emits rows carrying a detector identity" }], summary: { checksDeclared: 1, nonPublishingByDesign: 0, eligibleForFindings: 1, tally: { declared: 0, wired: 0, producing: 0, gradeable: 1 }, gradeableFraction: 1, adjudicatedFraction: null, adjudicated: null, adjudicableTotal: null, readiness: "1 of 1 checks gradeable; adjudication unknown \u2014 no issue store was supplied, which is not the same as none adjudicated" } });
});

test('a check without a lane is declared and not terminal', () => {
  const r = buildMaturityLedger({ checks: [{ id: 'orphan' }], produced: new Set(), addressed: new Set() });
  assert.deepEqual(r, { at: null, rows: [{ check: "orphan", lane: null, stage: "declared", why: "declared but reaches no lane, so it cannot carry a finding anywhere" }], summary: { checksDeclared: 1, nonPublishingByDesign: 0, eligibleForFindings: 1, tally: { declared: 1, wired: 0, producing: 0, gradeable: 0 }, gradeableFraction: 0, adjudicatedFraction: null, adjudicated: null, adjudicableTotal: null, readiness: "0 of 1 checks gradeable; adjudication unknown \u2014 no issue store was supplied, which is not the same as none adjudicated" } });
});

test('tally counts each stage and gradeableFraction uses three decimals', () => {
  const r = buildMaturityLedger({ checks: [{ id: 'a', lane: 'l' }, { id: 'b', lane: 'l' }, { id: 'c', lane: 'l' }], produced: new Set(['l']), addressed: new Set(['l']) });
  assert.deepEqual(r, { at: null, rows: [{ check: "a", lane: "l", stage: "gradeable", why: "emits rows carrying a detector identity" }, { check: "b", lane: "l", stage: "gradeable", why: "emits rows carrying a detector identity" }, { check: "c", lane: "l", stage: "gradeable", why: "emits rows carrying a detector identity" }], summary: { checksDeclared: 3, nonPublishingByDesign: 0, eligibleForFindings: 3, tally: { declared: 0, wired: 0, producing: 0, gradeable: 3 }, gradeableFraction: 1, adjudicatedFraction: null, adjudicated: null, adjudicableTotal: null, readiness: "3 of 3 checks gradeable; adjudication unknown \u2014 no issue store was supplied, which is not the same as none adjudicated" } });
});

test('adjudicatedFraction uses four decimals when total is provided', () => {
  const r = buildMaturityLedger({ checks: [{ id: 'a', lane: 'l' }], produced: new Set(['l']), addressed: new Set(['l']), adjudication: { adjudicated: 1, total: 3 } });
  assert.deepEqual(r, { at: null, rows: [{ check: "a", lane: "l", stage: "gradeable", why: "emits rows carrying a detector identity" }], summary: { checksDeclared: 1, nonPublishingByDesign: 0, eligibleForFindings: 1, tally: { declared: 0, wired: 0, producing: 0, gradeable: 1 }, gradeableFraction: 1, adjudicatedFraction: 0.3333, adjudicated: 1, adjudicableTotal: 3, readiness: "1 of 1 checks gradeable; 1 of 3 findings adjudicated (33.3%). Wiring and adjudication are independent \u2014 a fully wired fleet with an unadjudicated corpus cannot support a frozen baseline, and the wiring number alone would suggest otherwise." } });
});

test('readiness message states both wiring and adjudication numbers', () => {
  const r = buildMaturityLedger({ checks: [{ id: 'a', lane: 'l' }, { id: 'b', lane: 'l' }], produced: new Set(['l']), addressed: new Set(['l']), adjudication: { adjudicated: 1, total: 4 } });
  assert.deepEqual(r, { at: null, rows: [{ check: "a", lane: "l", stage: "gradeable", why: "emits rows carrying a detector identity" }, { check: "b", lane: "l", stage: "gradeable", why: "emits rows carrying a detector identity" }], summary: { checksDeclared: 2, nonPublishingByDesign: 0, eligibleForFindings: 2, tally: { declared: 0, wired: 0, producing: 0, gradeable: 2 }, gradeableFraction: 1, adjudicatedFraction: 0.25, adjudicated: 1, adjudicableTotal: 4, readiness: "2 of 2 checks gradeable; 1 of 4 findings adjudicated (25.0%). Wiring and adjudication are independent \u2014 a fully wired fleet with an unadjudicated corpus cannot support a frozen baseline, and the wiring number alone would suggest otherwise." } });
});

test('readiness message notes unknown adjudication when no issue store supplied', () => {
  const r = buildMaturityLedger({ checks: [{ id: 'a', lane: 'l' }], produced: new Set(['l']), addressed: new Set(['l']), adjudication: null });
  assert.deepEqual(r, { at: null, rows: [{ check: "a", lane: "l", stage: "gradeable", why: "emits rows carrying a detector identity" }], summary: { checksDeclared: 1, nonPublishingByDesign: 0, eligibleForFindings: 1, tally: { declared: 0, wired: 0, producing: 0, gradeable: 1 }, gradeableFraction: 1, adjudicatedFraction: null, adjudicated: null, adjudicableTotal: null, readiness: "1 of 1 checks gradeable; adjudication unknown \u2014 no issue store was supplied, which is not the same as none adjudicated" } });
});

test('rows are sorted by check id', () => {
  const r = buildMaturityLedger({ checks: [{ id: 'zeta', lane: 'l' }, { id: 'alpha', lane: 'l' }], produced: new Set(['l']), addressed: new Set(['l']) });
  assert.deepEqual(r, { at: null, rows: [{ check: "alpha", lane: "l", stage: "gradeable", why: "emits rows carrying a detector identity" }, { check: "zeta", lane: "l", stage: "gradeable", why: "emits rows carrying a detector identity" }], summary: { checksDeclared: 2, nonPublishingByDesign: 0, eligibleForFindings: 2, tally: { declared: 0, wired: 0, producing: 0, gradeable: 2 }, gradeableFraction: 1, adjudicatedFraction: null, adjudicated: null, adjudicableTotal: null, readiness: "2 of 2 checks gradeable; adjudication unknown \u2014 no issue store was supplied, which is not the same as none adjudicated" } });
});
