// Resolves an advisory id to a vulnerability record, tracking alias fan-out and refusal (cra/advisory-aliases.mjs resolveVia).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVia } from '../advisory-aliases.mjs';

test('returns direct hit with fanOut 1 and aliased false when lookup finds the id', () => {
  const index = { forward: new Map(), reverse: new Map() };
  const lookup = (k) => k === 'CVE-1' ? { id: k } : null;
  const r = resolveVia(index, 'cve-1', lookup);
  assert.deepEqual(r, { hit: { id: "CVE-1" }, via: "CVE-1", fanOut: 1, aliased: false });
});

test('returns direct hit with fanOut 1 and aliased false when lookup finds the id with different case', () => {
  const index = { forward: new Map(), reverse: new Map() };
  const lookup = (k) => k === 'CVE-2' ? { id: k } : null;
  const r = resolveVia(index, 'cve-2', lookup);
  assert.deepEqual(r, { hit: { id: "CVE-2" }, via: "CVE-2", fanOut: 1, aliased: false });
});

test('refuses with ambiguous-alias when reverse has multiple claimants and no direct hit', () => {
  const index = {
    forward: new Map(),
    reverse: new Map([['CVE-3', new Set(['CVE-3', 'CVE-4'])]])
  };
  const lookup = () => null;
  const r = resolveVia(index, 'cve-3', lookup);
  assert.deepEqual(r, { hit: null, via: null, fanOut: 0, aliased: false, refused: "ambiguous-alias", claimedBy: ["CVE-3", "CVE-4"] });
});

test('does not refuse when reverse has exactly one claimant and no direct hit', () => {
  const index = {
    forward: new Map(),
    reverse: new Map([['CVE-5', new Set(['CVE-5'])]])
  };
  const lookup = () => null;
  const r = resolveVia(index, 'cve-5', lookup);
  assert.deepEqual(r, { hit: null, via: null, fanOut: 1, aliased: false });
});

test('does not refuse when reverse is undefined and no direct hit', () => {
  const index = { forward: new Map(), reverse: new Map() };
  const lookup = () => null;
  const r = resolveVia(index, 'cve-6', lookup);
  assert.deepEqual(r, { hit: null, via: null, fanOut: 1, aliased: false });
});

test('returns aliased hit with fanOut 2 when one alias matches and no direct hit', () => {
  const index = {
    forward: new Map([['CVE-7', new Set(['CVE-7', 'CVE-8'])]]),
    reverse: new Map()
  };
  const lookup = (k) => k === 'CVE-8' ? { id: k } : null;
  const r = resolveVia(index, 'cve-7', lookup);
  assert.deepEqual(r, { hit: { id: "CVE-8" }, via: "CVE-8", fanOut: 2, aliased: true });
});

test('returns aliased hit with fanOut 3 when second alias matches and no direct hit', () => {
  const index = {
    forward: new Map([['CVE-9', new Set(['CVE-9', 'CVE-10', 'CVE-11'])]]),
    reverse: new Map()
  };
  const lookup = (k) => k === 'CVE-11' ? { id: k } : null;
  const r = resolveVia(index, 'cve-9', lookup);
  assert.deepEqual(r, { hit: { id: "CVE-11" }, via: "CVE-11", fanOut: 3, aliased: true });
});

test('returns null hit with fanOut 2 and aliased false when no alias matches and no direct hit', () => {
  const index = {
    forward: new Map([['CVE-12', new Set(['CVE-12', 'CVE-13'])]]),
    reverse: new Map()
  };
  const lookup = () => null;
  const r = resolveVia(index, 'cve-12', lookup);
  assert.deepEqual(r, { hit: null, via: null, fanOut: 2, aliased: false });
});

test('returns null hit with fanOut 1 and aliased false when no aliases and no direct hit', () => {
  const index = { forward: new Map(), reverse: new Map() };
  const lookup = () => null;
  const r = resolveVia(index, 'cve-14', lookup);
  assert.deepEqual(r, { hit: null, via: null, fanOut: 1, aliased: false });
});

test('returns aliased hit with fanOut 2 when alias matches and reverse has one claimant', () => {
  const index = {
    forward: new Map([['CVE-15', new Set(['CVE-15', 'CVE-16'])]]),
    reverse: new Map([['CVE-15', new Set(['CVE-15'])]])
  };
  const lookup = (k) => k === 'CVE-16' ? { id: k } : null;
  const r = resolveVia(index, 'cve-15', lookup);
  assert.deepEqual(r, { hit: { id: "CVE-16" }, via: "CVE-16", fanOut: 2, aliased: true });
});
