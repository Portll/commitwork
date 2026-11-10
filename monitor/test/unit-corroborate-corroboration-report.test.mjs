// Corroboration summary over findings (monitor/corroborate.mjs corroborationReport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corroborationReport } from '../corroborate.mjs';

test('returns zero counts and empty note for empty findings array', () => {
  const r = corroborationReport([]);
  assert.deepEqual(r, { enabled: true, total: 0, corroborated: 0, soleWitness: 0, citesNoAdvisory: 0, note: "" });
});

test('returns zero counts and empty note for null findings', () => {
  const r = corroborationReport(null);
  assert.deepEqual(r, { enabled: true, total: 0, corroborated: 0, soleWitness: 0, citesNoAdvisory: 0, note: "" });
});

test('returns zero counts and empty note for undefined findings', () => {
  const r = corroborationReport(undefined);
  assert.deepEqual(r, { enabled: true, total: 0, corroborated: 0, soleWitness: 0, citesNoAdvisory: 0, note: "" });
});

test('filters out falsy entries and counts corroborated findings with non-empty corroboratedBy', () => {
  const findings = [
    { corroboratedBy: ['tool-a', 'tool-b'], citesNoAdvisory: false },
    null,
    { corroboratedBy: [], citesNoAdvisory: true },
    false,
    { corroboratedBy: ['tool-c'], citesNoAdvisory: false },
  ];
  const r = corroborationReport(findings);
  assert.deepEqual(r, { enabled: true, total: 3, corroborated: 2, soleWitness: 1, citesNoAdvisory: 1, note: "2 of 3 findings are reported by more than one tool under aliases of the same advisory. They remain SEPARATE rows on purpose: finding identity includes the tool, and collapsing them would delete a key, which the ledger reads as FIXED. Corroboration is a view over the rows, never an edit to them. Set CW_CORROBORATE=off to disable." });
});

test('counts findings with empty corroboratedBy as sole witness when using && logic', () => {
  const findings = [
    { corroboratedBy: [], citesNoAdvisory: false },
    { corroboratedBy: ['x'], citesNoAdvisory: false },
  ];
  const r = corroborationReport(findings);
  assert.deepEqual(r, { enabled: true, total: 2, corroborated: 1, soleWitness: 1, citesNoAdvisory: 0, note: "1 of 2 findings are reported by more than one tool under aliases of the same advisory. They remain SEPARATE rows on purpose: finding identity includes the tool, and collapsing them would delete a key, which the ledger reads as FIXED. Corroboration is a view over the rows, never an edit to them. Set CW_CORROBORATE=off to disable." });
});

test('counts findings with undefined corroboratedBy as sole witness when using && logic', () => {
  const findings = [
    { citesNoAdvisory: false },
    { corroboratedBy: ['y'], citesNoAdvisory: false },
  ];
  const r = corroborationReport(findings);
  assert.deepEqual(r, { enabled: true, total: 2, corroborated: 1, soleWitness: 1, citesNoAdvisory: 0, note: "1 of 2 findings are reported by more than one tool under aliases of the same advisory. They remain SEPARATE rows on purpose: finding identity includes the tool, and collapsing them would delete a key, which the ledger reads as FIXED. Corroboration is a view over the rows, never an edit to them. Set CW_CORROBORATE=off to disable." });
});

test('generates non-empty note when at least one finding is corroborated', () => {
  const findings = [
    { corroboratedBy: ['a', 'b'], citesNoAdvisory: false },
    { corroboratedBy: [], citesNoAdvisory: false },
  ];
  const r = corroborationReport(findings);
  assert.deepEqual(r, { enabled: true, total: 2, corroborated: 1, soleWitness: 1, citesNoAdvisory: 0, note: "1 of 2 findings are reported by more than one tool under aliases of the same advisory. They remain SEPARATE rows on purpose: finding identity includes the tool, and collapsing them would delete a key, which the ledger reads as FIXED. Corroboration is a view over the rows, never an edit to them. Set CW_CORROBORATE=off to disable." });
});

test('generates empty note when no findings are corroborated', () => {
  const findings = [
    { corroboratedBy: [], citesNoAdvisory: true },
    { citesNoAdvisory: false },
  ];
  const r = corroborationReport(findings);
  assert.deepEqual(r, { enabled: true, total: 2, corroborated: 0, soleWitness: 2, citesNoAdvisory: 1, note: "" });
});
