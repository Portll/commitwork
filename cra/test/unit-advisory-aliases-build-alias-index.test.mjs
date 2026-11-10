// Maps advisory ids to alias groups and detects collisions (cra/advisory-aliases.mjs buildAliasIndex).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAliasIndex } from '../advisory-aliases.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty index when directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildAliasIndex-'));
  try {
    const r = buildAliasIndex({ dir: join(dir, 'nope') });
    assert.deepEqual(r, { forward: new Map([]), reverse: new Map([]), collisions: [], stats: { records: 0, withAliases: 0, artifacts: 0, ids: 0, aliasedCves: 0, collisions: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty index when directory is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildAliasIndex-'));
  try {
    const r = buildAliasIndex({ dir });
    assert.deepEqual(r, { forward: new Map([]), reverse: new Map([]), collisions: [], stats: { records: 0, withAliases: 0, artifacts: 0, ids: 0, aliasedCves: 0, collisions: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('indexes a single GO record with one CVE alias', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildAliasIndex-'));
  try {
    const sub = join(dir, 'a');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'govulncheck.json'), JSON.stringify({
      osv: { id: 'GO-2024-1234', aliases: ['CVE-2024-5678'] }
    }));
    const r = buildAliasIndex({ dir });
    assert.deepEqual(r, { forward: new Map([["GO-2024-1234", new Set(["GO-2024-1234", "CVE-2024-5678"])], ["CVE-2024-5678", new Set(["CVE-2024-5678", "GO-2024-1234"])]]), reverse: new Map([["CVE-2024-5678", new Set(["GO-2024-1234"])]]), collisions: [], stats: { records: 1, withAliases: 1, artifacts: 1, ids: 2, aliasedCves: 1, collisions: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('indexes a GO record with no aliases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildAliasIndex-'));
  try {
    const sub = join(dir, 'b');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'govulncheck.json'), JSON.stringify({
      osv: { id: 'GO-2024-9999', aliases: [] }
    }));
    const r = buildAliasIndex({ dir });
    assert.deepEqual(r, { forward: new Map([["GO-2024-9999", new Set(["GO-2024-9999"])]]), reverse: new Map([]), collisions: [], stats: { records: 1, withAliases: 0, artifacts: 1, ids: 1, aliasedCves: 0, collisions: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('indexes a non-GO record with aliases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildAliasIndex-'));
  try {
    const sub = join(dir, 'c');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'govulncheck.json'), JSON.stringify({
      osv: { id: 'CVE-2024-1111', aliases: ['GHSA-abc-def-ghi'] }
    }));
    const r = buildAliasIndex({ dir });
    assert.deepEqual(r, { forward: new Map([["CVE-2024-1111", new Set(["CVE-2024-1111", "GHSA-ABC-DEF-GHI"])], ["GHSA-ABC-DEF-GHI", new Set(["GHSA-ABC-DEF-GHI", "CVE-2024-1111"])]]), reverse: new Map([]), collisions: [], stats: { records: 1, withAliases: 1, artifacts: 1, ids: 2, aliasedCves: 0, collisions: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detects a collision when two GO ids claim the same CVE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildAliasIndex-'));
  try {
    const s1 = join(dir, 'd1');
    const s2 = join(dir, 'd2');
    mkdirSync(s1, { recursive: true });
    mkdirSync(s2, { recursive: true });
    writeFileSync(join(s1, 'govulncheck.json'), JSON.stringify({
      osv: { id: 'GO-2024-1111', aliases: ['CVE-2024-2222'] }
    }));
    writeFileSync(join(s2, 'govulncheck.json'), JSON.stringify({
      osv: { id: 'GO-2024-3333', aliases: ['CVE-2024-2222'] }
    }));
    const r = buildAliasIndex({ dir });
    assert.deepEqual(r, { forward: new Map([["GO-2024-1111", new Set(["GO-2024-1111", "CVE-2024-2222"])], ["CVE-2024-2222", new Set(["CVE-2024-2222", "GO-2024-1111", "GO-2024-3333"])], ["GO-2024-3333", new Set(["GO-2024-3333", "CVE-2024-2222"])]]), reverse: new Map([["CVE-2024-2222", new Set(["GO-2024-1111", "GO-2024-3333"])]]), collisions: [{ id: "CVE-2024-2222", claimedBy: ["GO-2024-1111", "GO-2024-3333"] }], stats: { records: 2, withAliases: 2, artifacts: 2, ids: 3, aliasedCves: 1, collisions: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('indexes records in nested directories within maxDepth', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildAliasIndex-'));
  try {
    const deep = join(dir, 'x', 'y', 'z');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'govulncheck.json'), JSON.stringify({
      osv: { id: 'GO-2024-4444', aliases: ['CVE-2024-5555'] }
    }));
    const r = buildAliasIndex({ dir });
    assert.deepEqual(r, { forward: new Map([["GO-2024-4444", new Set(["GO-2024-4444", "CVE-2024-5555"])], ["CVE-2024-5555", new Set(["CVE-2024-5555", "GO-2024-4444"])]]), reverse: new Map([["CVE-2024-5555", new Set(["GO-2024-4444"])]]), collisions: [], stats: { records: 1, withAliases: 1, artifacts: 1, ids: 2, aliasedCves: 1, collisions: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('indexes records at depth equal to maxDepth', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildAliasIndex-'));
  try {
    const deep = join(dir, 'a', 'b', 'c', 'd', 'e', 'f');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'govulncheck.json'), JSON.stringify({
      osv: { id: 'GO-2024-6666', aliases: ['CVE-2024-7777'] }
    }));
    const r = buildAliasIndex({ dir });
    assert.deepEqual(r, { forward: new Map([["GO-2024-6666", new Set(["GO-2024-6666", "CVE-2024-7777"])], ["CVE-2024-7777", new Set(["CVE-2024-7777", "GO-2024-6666"])]]), reverse: new Map([["CVE-2024-7777", new Set(["GO-2024-6666"])]]), collisions: [], stats: { records: 1, withAliases: 1, artifacts: 1, ids: 2, aliasedCves: 1, collisions: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('indexes records at depth one past maxDepth', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildAliasIndex-'));
  try {
    const deep = join(dir, 'a', 'b', 'c', 'd', 'e', 'f', 'g');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'govulncheck.json'), JSON.stringify({
      osv: { id: 'GO-2024-8888', aliases: ['CVE-2024-9999'] }
    }));
    const r = buildAliasIndex({ dir });
    assert.deepEqual(r, { forward: new Map([]), reverse: new Map([]), collisions: [], stats: { records: 0, withAliases: 0, artifacts: 0, ids: 0, aliasedCves: 0, collisions: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('indexes a record with multiple aliases of different types', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildAliasIndex-'));
  try {
    const sub = join(dir, 'e');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'govulncheck.json'), JSON.stringify({
      osv: { id: 'GO-2024-1010', aliases: ['CVE-2024-2020', 'GHSA-xyz-abc-def', 'MAL-2024-3030'] }
    }));
    const r = buildAliasIndex({ dir });
    assert.deepEqual(r, { forward: new Map([["GO-2024-1010", new Set(["GO-2024-1010", "CVE-2024-2020", "GHSA-XYZ-ABC-DEF", "MAL-2024-3030"])], ["CVE-2024-2020", new Set(["CVE-2024-2020", "GO-2024-1010", "GHSA-XYZ-ABC-DEF", "MAL-2024-3030"])], ["GHSA-XYZ-ABC-DEF", new Set(["GHSA-XYZ-ABC-DEF", "GO-2024-1010", "CVE-2024-2020", "MAL-2024-3030"])], ["MAL-2024-3030", new Set(["MAL-2024-3030", "GO-2024-1010", "CVE-2024-2020", "GHSA-XYZ-ABC-DEF"])]]), reverse: new Map([["CVE-2024-2020", new Set(["GO-2024-1010"])], ["GHSA-XYZ-ABC-DEF", new Set(["GO-2024-1010"])], ["MAL-2024-3030", new Set(["GO-2024-1010"])]]), collisions: [], stats: { records: 1, withAliases: 1, artifacts: 1, ids: 4, aliasedCves: 1, collisions: 0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
