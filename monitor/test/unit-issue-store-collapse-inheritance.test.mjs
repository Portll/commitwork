// Merges absorbed issues into a survivor, carrying the worst severity, earliest date, and union of keys (monitor/issue-store.mjs collapseInheritance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapseInheritance } from '../issue-store.mjs';

test('returns null when only one issue is provided', () => {
  const survivor = { id: 'a', createdAt: '2024-01-01T00:00:00Z', severity: 'low' };
  const r = collapseInheritance(survivor, [], { at: '2024-01-02T00:00:00Z' });
  assert.equal(r, null);
});

test('returns null when survivor is falsy', () => {
  const r = collapseInheritance(null, [{ id: 'b', createdAt: '2024-01-01T00:00:00Z', severity: 'low' }], { at: '2024-01-02T00:00:00Z' });
  assert.equal(r, null);
});

test('returns null when all absorbed issues are falsy', () => {
  const survivor = { id: 'a', createdAt: '2024-01-01T00:00:00Z', severity: 'low' };
  const r = collapseInheritance(survivor, [null, undefined], { at: '2024-01-02T00:00:00Z' });
  assert.equal(r, null);
});

test('returns null when survivor and one absorbed are provided', () => {
  const survivor = { id: 'a', createdAt: '2024-01-01T00:00:00Z', severity: 'low' };
  const absorbed = [{ id: 'b', createdAt: '2024-01-02T00:00:00Z', severity: 'med' }];
  const r = collapseInheritance(survivor, absorbed, { at: '2024-01-03T00:00:00Z' });
  assert.deepStrictEqual(r, { createdAt: "2024-01-01T00:00:00Z", severity: "med", slaDueAt: "2024-03-31T00:00:00.000Z", priorKeys: [], reopenCount: 0, suspect: false, attemptCount: 0, absorbedFrom: [{ id: "b", key: null, createdAt: "2024-01-02T00:00:00Z" }], at: "2024-01-03T00:00:00Z" });
});

test('returns null when survivor and two absorbed are provided', () => {
  const survivor = { id: 'a', createdAt: '2024-01-01T00:00:00Z', severity: 'low' };
  const absorbed = [
    { id: 'b', createdAt: '2024-01-02T00:00:00Z', severity: 'med' },
    { id: 'c', createdAt: '2024-01-03T00:00:00Z', severity: 'high' }
  ];
  const r = collapseInheritance(survivor, absorbed, { at: '2024-01-04T00:00:00Z' });
  assert.deepStrictEqual(r, { createdAt: "2024-01-01T00:00:00Z", severity: "high", slaDueAt: "2024-01-31T00:00:00.000Z", priorKeys: [], reopenCount: 0, suspect: false, attemptCount: 0, absorbedFrom: [{ id: "b", key: null, createdAt: "2024-01-02T00:00:00Z" }, { id: "c", key: null, createdAt: "2024-01-03T00:00:00Z" }], at: "2024-01-04T00:00:00Z" });
});

test('returns null when survivor and three absorbed are provided', () => {
  const survivor = { id: 'a', createdAt: '2024-01-01T00:00:00Z', severity: 'low' };
  const absorbed = [
    { id: 'b', createdAt: '2024-01-02T00:00:00Z', severity: 'med' },
    { id: 'c', createdAt: '2024-01-03T00:00:00Z', severity: 'high' },
    { id: 'd', createdAt: '2024-01-04T00:00:00Z', severity: 'crit' }
  ];
  const r = collapseInheritance(survivor, absorbed, { at: '2024-01-05T00:00:00Z' });
  assert.deepStrictEqual(r, { createdAt: "2024-01-01T00:00:00Z", severity: "crit", slaDueAt: "2024-01-08T00:00:00.000Z", priorKeys: [], reopenCount: 0, suspect: false, attemptCount: 0, absorbedFrom: [{ id: "b", key: null, createdAt: "2024-01-02T00:00:00Z" }, { id: "c", key: null, createdAt: "2024-01-03T00:00:00Z" }, { id: "d", key: null, createdAt: "2024-01-04T00:00:00Z" }], at: "2024-01-05T00:00:00Z" });
});

test('returns null when survivor and four absorbed are provided', () => {
  const survivor = { id: 'a', createdAt: '2024-01-01T00:00:00Z', severity: 'low' };
  const absorbed = [
    { id: 'b', createdAt: '2024-01-02T00:00:00Z', severity: 'med' },
    { id: 'c', createdAt: '2024-01-03T00:00:00Z', severity: 'high' },
    { id: 'd', createdAt: '2024-01-04T00:00:00Z', severity: 'crit' },
    { id: 'e', createdAt: '2024-01-05T00:00:00Z', severity: 'unknown' }
  ];
  const r = collapseInheritance(survivor, absorbed, { at: '2024-01-06T00:00:00Z' });
  assert.deepStrictEqual(r, { createdAt: "2024-01-01T00:00:00Z", severity: "crit", slaDueAt: "2024-01-08T00:00:00.000Z", priorKeys: [], reopenCount: 0, suspect: false, attemptCount: 0, absorbedFrom: [{ id: "b", key: null, createdAt: "2024-01-02T00:00:00Z" }, { id: "c", key: null, createdAt: "2024-01-03T00:00:00Z" }, { id: "d", key: null, createdAt: "2024-01-04T00:00:00Z" }, { id: "e", key: null, createdAt: "2024-01-05T00:00:00Z" }], at: "2024-01-06T00:00:00Z" });
});

test('returns null when survivor and five absorbed are provided', () => {
  const survivor = { id: 'a', createdAt: '2024-01-01T00:00:00Z', severity: 'low' };
  const absorbed = [
    { id: 'b', createdAt: '2024-01-02T00:00:00Z', severity: 'med' },
    { id: 'c', createdAt: '2024-01-03T00:00:00Z', severity: 'high' },
    { id: 'd', createdAt: '2024-01-04T00:00:00Z', severity: 'crit' },
    { id: 'e', createdAt: '2024-01-05T00:00:00Z', severity: 'unknown' },
    { id: 'f', createdAt: '2024-01-06T00:00:00Z', severity: 'low' }
  ];
  const r = collapseInheritance(survivor, absorbed, { at: '2024-01-07T00:00:00Z' });
  assert.deepStrictEqual(r, { createdAt: "2024-01-01T00:00:00Z", severity: "crit", slaDueAt: "2024-01-08T00:00:00.000Z", priorKeys: [], reopenCount: 0, suspect: false, attemptCount: 0, absorbedFrom: [{ id: "b", key: null, createdAt: "2024-01-02T00:00:00Z" }, { id: "c", key: null, createdAt: "2024-01-03T00:00:00Z" }, { id: "d", key: null, createdAt: "2024-01-04T00:00:00Z" }, { id: "e", key: null, createdAt: "2024-01-05T00:00:00Z" }, { id: "f", key: null, createdAt: "2024-01-06T00:00:00Z" }], at: "2024-01-07T00:00:00Z" });
});

test('returns null when survivor and six absorbed are provided', () => {
  const survivor = { id: 'a', createdAt: '2024-01-01T00:00:00Z', severity: 'low' };
  const absorbed = [
    { id: 'b', createdAt: '2024-01-02T00:00:00Z', severity: 'med' },
    { id: 'c', createdAt: '2024-01-03T00:00:00Z', severity: 'high' },
    { id: 'd', createdAt: '2024-01-04T00:00:00Z', severity: 'crit' },
    { id: 'e', createdAt: '2024-01-05T00:00:00Z', severity: 'unknown' },
    { id: 'f', createdAt: '2024-01-06T00:00:00Z', severity: 'low' },
    { id: 'g', createdAt: '2024-01-07T00:00:00Z', severity: 'med' }
  ];
  const r = collapseInheritance(survivor, absorbed, { at: '2024-01-08T00:00:00Z' });
  assert.deepStrictEqual(r, { createdAt: "2024-01-01T00:00:00Z", severity: "crit", slaDueAt: "2024-01-08T00:00:00.000Z", priorKeys: [], reopenCount: 0, suspect: false, attemptCount: 0, absorbedFrom: [{ id: "b", key: null, createdAt: "2024-01-02T00:00:00Z" }, { id: "c", key: null, createdAt: "2024-01-03T00:00:00Z" }, { id: "d", key: null, createdAt: "2024-01-04T00:00:00Z" }, { id: "e", key: null, createdAt: "2024-01-05T00:00:00Z" }, { id: "f", key: null, createdAt: "2024-01-06T00:00:00Z" }, { id: "g", key: null, createdAt: "2024-01-07T00:00:00Z" }], at: "2024-01-08T00:00:00Z" });
});

test('returns null when survivor and seven absorbed are provided', () => {
  const survivor = { id: 'a', createdAt: '2024-01-01T00:00:00Z', severity: 'low' };
  const absorbed = [
    { id: 'b', createdAt: '2024-01-02T00:00:00Z', severity: 'med' },
    { id: 'c', createdAt: '2024-01-03T00:00:00Z', severity: 'high' },
    { id: 'd', createdAt: '2024-01-04T00:00:00Z', severity: 'crit' },
    { id: 'e', createdAt: '2024-01-05T00:00:00Z', severity: 'unknown' },
    { id: 'f', createdAt: '2024-01-06T00:00:00Z', severity: 'low' },
    { id: 'g', createdAt: '2024-01-07T00:00:00Z', severity: 'med' },
    { id: 'h', createdAt: '2024-01-08T00:00:00Z', severity: 'high' }
  ];
  const r = collapseInheritance(survivor, absorbed, { at: '2024-01-09T00:00:00Z' });
  assert.deepStrictEqual(r, { createdAt: "2024-01-01T00:00:00Z", severity: "crit", slaDueAt: "2024-01-08T00:00:00.000Z", priorKeys: [], reopenCount: 0, suspect: false, attemptCount: 0, absorbedFrom: [{ id: "b", key: null, createdAt: "2024-01-02T00:00:00Z" }, { id: "c", key: null, createdAt: "2024-01-03T00:00:00Z" }, { id: "d", key: null, createdAt: "2024-01-04T00:00:00Z" }, { id: "e", key: null, createdAt: "2024-01-05T00:00:00Z" }, { id: "f", key: null, createdAt: "2024-01-06T00:00:00Z" }, { id: "g", key: null, createdAt: "2024-01-07T00:00:00Z" }, { id: "h", key: null, createdAt: "2024-01-08T00:00:00Z" }], at: "2024-01-09T00:00:00Z" });
});
