// Splits case validation errors into changed and legacy buckets (cra/lib.mjs validateCaseChanges).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCaseChanges } from '../lib.mjs';

test('returns empty errors and legacy when all cases are valid and unchanged', () => {
  const kase = { caseId: 'c1', kind: 'vulnerability', productId: 'p1', trigger: 'kev', status: 'open', epss: 0.5, clocks: { track: 'article14', basisAt: '2024-01-01', earlyWarningDue: '2024-02-01', notificationDue: '2024-03-01', finalDue: '2024-04-01' } };
  const doc = { cases: { c1: kase } };
  const before = { c1: kase };
  assert.deepEqual(validateCaseChanges(doc, before), { errors: [], legacy: [] });
});

test('returns empty errors and legacy when cases are valid and changed', () => {
  const kase = { caseId: 'c1', kind: 'vulnerability', productId: 'p1', trigger: 'kev', status: 'open', epss: 0.5, clocks: { track: 'article14', basisAt: '2024-01-01', earlyWarningDue: '2024-02-01', notificationDue: '2024-03-01', finalDue: '2024-04-01' } };
  const prior = { ...kase, status: 'closed' };
  const doc = { cases: { c1: kase } };
  const before = { c1: prior };
  assert.deepEqual(validateCaseChanges(doc, before), { errors: [], legacy: [] });
});

test('puts errors in errors bucket when case is invalid and changed', () => {
  const kase = { caseId: 'c1', kind: 'vulnerability', productId: 'p1', trigger: 'kev', status: 'open', epss: 0.5, clocks: { track: 'article14', basisAt: '2024-01-01', earlyWarningDue: '2024-02-01', notificationDue: '2024-03-01', finalDue: '2024-04-01' } };
  const prior = { ...kase, status: 'closed' };
  const bad = { ...kase, kind: 'bogus' };
  const doc = { cases: { c1: bad } };
  const before = { c1: prior };
  assert.deepEqual(validateCaseChanges(doc, before), { errors: ["c1: kind 'bogus' must be vulnerability|incident"], legacy: [] });
});

test('puts errors in legacy bucket when case is invalid and unchanged', () => {
  const bad = { caseId: 'c1', kind: 'bogus', productId: 'p1', trigger: 'kev', status: 'open', epss: 0.5, clocks: { track: 'article14', basisAt: '2024-01-01', earlyWarningDue: '2024-02-01', notificationDue: '2024-03-01', finalDue: '2024-04-01' } };
  const doc = { cases: { c1: bad } };
  const before = { c1: bad };
  assert.deepEqual(validateCaseChanges(doc, before), { errors: [], legacy: ["c1: kind 'bogus' must be vulnerability|incident"] });
});

test('puts errors in errors bucket when case is invalid and new', () => {
  const bad = { caseId: 'c1', kind: 'bogus', productId: 'p1', trigger: 'kev', status: 'open', epss: 0.5, clocks: { track: 'article14', basisAt: '2024-01-01', earlyWarningDue: '2024-02-01', notificationDue: '2024-03-01', finalDue: '2024-04-01' } };
  const doc = { cases: { c1: bad } };
  const before = {};
  assert.deepEqual(validateCaseChanges(doc, before), { errors: ["c1: kind 'bogus' must be vulnerability|incident"], legacy: [] });
});

test('handles multiple cases with mixed changed and legacy errors', () => {
  const valid = { caseId: 'c1', kind: 'vulnerability', productId: 'p1', trigger: 'kev', status: 'open', epss: 0.5, clocks: { track: 'article14', basisAt: '2024-01-01', earlyWarningDue: '2024-02-01', notificationDue: '2024-03-01', finalDue: '2024-04-01' } };
  const badChanged = { ...valid, caseId: 'c2', kind: 'bogus' };
  const badLegacy = { ...valid, caseId: 'c3', kind: 'bogus' };
  const doc = { cases: { c1: valid, c2: badChanged, c3: badLegacy } };
  const before = { c1: valid, c2: { ...badChanged, kind: 'vulnerability' }, c3: badLegacy };
  assert.deepEqual(validateCaseChanges(doc, before), { errors: ["c2: kind 'bogus' must be vulnerability|incident"], legacy: ["c3: kind 'bogus' must be vulnerability|incident"] });
});

test('returns empty arrays when doc has no cases property', () => {
  const doc = {};
  const before = {};
  assert.deepEqual(validateCaseChanges(doc, before), { errors: [], legacy: [] });
});

test('returns empty arrays when doc.cases is empty object', () => {
  const doc = { cases: {} };
  const before = {};
  assert.deepEqual(validateCaseChanges(doc, before), { errors: [], legacy: [] });
});
