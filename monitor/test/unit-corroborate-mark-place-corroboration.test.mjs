// Marks rows with place-based corroboration from advisory rows (monitor/corroborate.mjs markPlaceCorroboration).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markPlaceCorroboration } from '../corroborate.mjs';

test('returns empty array when rows is null', () => {
  const r = markPlaceCorroboration(null, [{ package: 'p' }], { repo: 'r' });
  assert.deepEqual(r, []);
});

test('returns rows unchanged when disabled via env', () => {
  process.env.CW_CORROBORATE = 'off';
  const rows = [{ package: 'p' }];
  const r = markPlaceCorroboration(rows, [{ package: 'p' }], { repo: 'r' });
  delete process.env.CW_CORROBORATE;
  assert.deepEqual(r, [{ package: "p" }]);
});

test('returns rows unchanged when no matching advisory exists', () => {
  const rows = [{ package: 'p' }];
  const r = markPlaceCorroboration(rows, [{ package: 'other' }], { repo: 'r' });
  assert.deepEqual(r, [{ package: "p" }]);
});

test('marks row with corroboration when advisory matches by place', () => {
  const rows = [{ package: 'p' }];
  const advisory = [{ package: 'p', id: 'CVE-1', tool: 'osv' }];
  const r = markPlaceCorroboration(rows, advisory, { repo: 'r' });
  assert.deepEqual(r, [{ package: "p", corroboratedBy: [{ tool: "osv", id: "CVE-1", package: "p" }], corroborationBasis: "place", tools: 2 }]);
});

test('skips advisory rows without package field', () => {
  const rows = [{ package: 'p' }];
  const advisory = [{ id: 'CVE-1' }, { package: 'p', id: 'CVE-2' }];
  const r = markPlaceCorroboration(rows, advisory, { repo: 'r' });
  assert.deepEqual(r, [{ package: "p", corroboratedBy: [{ tool: "osv", id: "CVE-2", package: "p" }], corroborationBasis: "place", tools: 2 }]);
});

test('skips null entries in advisory rows', () => {
  const rows = [{ package: 'p' }];
  const advisory = [null, { package: 'p', id: 'CVE-1' }];
  const r = markPlaceCorroboration(rows, advisory, { repo: 'r' });
  assert.deepEqual(r, [{ package: "p", corroboratedBy: [{ tool: "osv", id: "CVE-1", package: "p" }], corroborationBasis: "place", tools: 2 }]);
});

test('skips null entries in output rows', () => {
  const rows = [null, { package: 'p' }];
  const advisory = [{ package: 'p', id: 'CVE-1' }];
  const r = markPlaceCorroboration(rows, advisory, { repo: 'r' });
  assert.deepEqual(r, [null, { package: "p", corroboratedBy: [{ tool: "osv", id: "CVE-1", package: "p" }], corroborationBasis: "place", tools: 2 }]);
});

test('skips output rows without package field', () => {
  const rows = [{ id: 'x' }, { package: 'p' }];
  const advisory = [{ package: 'p', id: 'CVE-1' }];
  const r = markPlaceCorroboration(rows, advisory, { repo: 'r' });
  assert.deepEqual(r, [{ id: "x" }, { package: "p", corroboratedBy: [{ tool: "osv", id: "CVE-1", package: "p" }], corroborationBasis: "place", tools: 2 }]);
});

test('aggregates multiple advisory rows into twins array', () => {
  const rows = [{ package: 'p' }];
  const advisory = [
    { package: 'p', id: 'CVE-1', tool: 'osv' },
    { package: 'p', id: 'CVE-2', tool: 'socket' }
  ];
  const r = markPlaceCorroboration(rows, advisory, { repo: 'r' });
  assert.deepEqual(r, [{ package: "p", corroboratedBy: [{ tool: "osv", id: "CVE-1", package: "p" }, { tool: "socket", id: "CVE-2", package: "p" }], corroborationBasis: "place", tools: 3 }]);
});

test('uses default tool name when advisory row has no tool field', () => {
  const rows = [{ package: 'p' }];
  const advisory = [{ package: 'p', id: 'CVE-1' }];
  const r = markPlaceCorroboration(rows, advisory, { repo: 'r' });
  assert.deepEqual(r, [{ package: "p", corroboratedBy: [{ tool: "osv", id: "CVE-1", package: "p" }], corroborationBasis: "place", tools: 2 }]);
});
