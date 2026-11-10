// Validates a CRA case record against the Article 14 / best-practice / internal clock schema (cra/lib.mjs validateCase).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCase } from '../lib.mjs';

test('returns a single error when the input is not an object', () => {
  assert.deepEqual(validateCase(42), ["(no caseId): not an object"]);
});

test('flags a missing caseId and a missing productId on an otherwise valid case', () => {
  const kase = { kind: 'vulnerability', trigger: 'kev', status: 'open', clocks: { track: 'article14', basisAt: '2025-01-01T00:00:00Z', earlyWarningDue: '2025-01-02T00:00:00Z', notificationDue: '2025-01-03T00:00:00Z', finalDue: '2025-01-04T00:00:00Z' } };
  assert.deepEqual(validateCase(kase), ["(no caseId): caseId is required", "(no caseId): productId is required"]);
});

test('flags an invalid status and an invalid epss type', () => {
  const kase = { caseId: 'c1', kind: 'vulnerability', productId: 'p1', trigger: 'kev', status: 'bogus', epss: 'high', clocks: { track: 'article14', basisAt: '2025-01-01T00:00:00Z', earlyWarningDue: '2025-01-02T00:00:00Z', notificationDue: '2025-01-03T00:00:00Z', finalDue: '2025-01-04T00:00:00Z' } };
  assert.deepEqual(validateCase(kase), ["c1: status 'bogus' must be open|acknowledged|closed", "c1: epss must be a number or null (null = UNKNOWN, never 0)"]);
});

test('flags a missing clocks object', () => {
  const kase = { caseId: 'c1', kind: 'vulnerability', productId: 'p1', trigger: 'kev', status: 'open' };
  assert.deepEqual(validateCase(kase), ["c1: clocks are required \u2014 a case with no clock owes a deadline nobody is counting"]);
});

test('flags an invalid clocks track and a missing basisAt', () => {
  const kase = { caseId: 'c1', kind: 'vulnerability', productId: 'p1', trigger: 'kev', status: 'open', clocks: { track: 'bogus' } };
  assert.deepEqual(validateCase(kase), ["c1: clocks.track 'bogus' must be article14|bestpractice|internal", "c1: clocks.basisAt is required \u2014 without it no elapsed fraction can be computed and every band renders 0%"]);
});

test('flags an internal clock that carries Article 14 keys and is missing internal keys', () => {
  const kase = { caseId: 'c1', kind: 'vulnerability', productId: 'p1', trigger: 'kev', status: 'open', clocks: { track: 'internal', basisAt: '2025-01-01T00:00:00Z', earlyWarningDue: '2025-01-02T00:00:00Z' } };
  assert.deepEqual(validateCase(kase), ["c1: internal clock carries Art. 14 key 'earlyWarningDue' \u2014 a policy deadline must never be readable as a regulatory one", "c1: internal clock is missing 'triageDue'", "c1: internal clock is missing 'remediateDue'"]);
});

test('flags a reportable clock that carries internal keys and is missing Article 14 keys', () => {
  const kase = { caseId: 'c1', kind: 'vulnerability', productId: 'p1', trigger: 'kev', status: 'open', clocks: { track: 'article14', basisAt: '2025-01-01T00:00:00Z', triageDue: '2025-01-02T00:00:00Z' } };
  assert.deepEqual(validateCase(kase), ["c1: reportable clock carries internal key 'triageDue'", "c1: article14 clock is missing 'earlyWarningDue'", "c1: article14 clock is missing 'notificationDue'", "c1: article14 clock is missing 'finalDue'"]);
});

test('flags an invalid reporting regime', () => {
  const kase = { caseId: 'c1', kind: 'vulnerability', productId: 'p1', trigger: 'kev', status: 'open', reporting: { regime: 'bogus' }, clocks: { track: 'article14', basisAt: '2025-01-01T00:00:00Z', earlyWarningDue: '2025-01-02T00:00:00Z', notificationDue: '2025-01-03T00:00:00Z', finalDue: '2025-01-04T00:00:00Z' } };
  assert.deepEqual(validateCase(kase), ["c1: reporting.regime 'bogus' is not a declared regime"]);
});

test('returns an empty array for a fully valid case', () => {
  const kase = { caseId: 'c1', kind: 'vulnerability', productId: 'p1', trigger: 'kev', status: 'open', epss: 0.5, reporting: { regime: 'regulatory' }, clocks: { track: 'article14', basisAt: '2025-01-01T00:00:00Z', earlyWarningDue: '2025-01-02T00:00:00Z', notificationDue: '2025-01-03T00:00:00Z', finalDue: '2025-01-04T00:00:00Z' } };
  assert.deepEqual(validateCase(kase), []);
});
