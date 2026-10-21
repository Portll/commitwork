// Builds a CVE set and freshness verdict from a KEV JSON file (monitor/dep-findings.mjs loadKevCatalog).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadKevCatalog } from '../dep-findings.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty set and unusable when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadKevCatalog-'));
  try {
    const missing = join(dir, 'nope.json');
    const now = Date.parse('2024-01-01T00:00:00.000Z');
    const r = loadKevCatalog(missing, { now });
    assert.equal(r.usable, false);
    assert.equal(r.set.size, 0);
    assert.equal(r.staleDays, 7);
    assert.equal(r.freshness.state, 'unknown');
    assert.equal(r.freshness.ageDays, null);
    assert.equal(r.freshness.maxDays, 7);
    assert.equal(r.freshness.catalogVersion, null);
    assert.equal(r.freshness.dateReleased, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty set and unusable when vulnerabilities array is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadKevCatalog-'));
  try {
    const p = join(dir, 'kev.json');
    writeFileSync(p, JSON.stringify({ vulnerabilities: [], dateReleased: '2024-01-01T00:00:00.000Z', catalogVersion: 'v1' }));
    const now = Date.parse('2024-01-01T00:00:00.000Z');
    const r = loadKevCatalog(p, { now });
    assert.equal(r.usable, false);
    assert.equal(r.set.size, 0);
    assert.equal(r.freshness.state, 'fresh');
    assert.equal(r.freshness.ageDays, 0);
    assert.equal(r.freshness.maxDays, 7);
    assert.equal(r.freshness.catalogVersion, 'v1');
    assert.equal(r.freshness.dateReleased, '2024-01-01T00:00:00.000Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns usable set with fresh state when age is below threshold', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadKevCatalog-'));
  try {
    const p = join(dir, 'kev.json');
    writeFileSync(p, JSON.stringify({ vulnerabilities: [{ cveID: 'CVE-2024-0001' }], dateReleased: '2024-01-01T00:00:00.000Z', catalogVersion: 'v1' }));
    const now = Date.parse('2024-01-02T00:00:00.000Z');
    const r = loadKevCatalog(p, { now });
    assert.equal(r.usable, true);
    assert.equal(r.set.size, 1);
    assert.ok(r.set.has('CVE-2024-0001'));
    assert.equal(r.freshness.state, 'fresh');
    assert.equal(r.freshness.ageDays, 1);
    assert.equal(r.freshness.maxDays, 7);
    assert.equal(r.freshness.catalogVersion, 'v1');
    assert.equal(r.freshness.dateReleased, '2024-01-01T00:00:00.000Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns usable set with fresh state when age equals threshold', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadKevCatalog-'));
  try {
    const p = join(dir, 'kev.json');
    writeFileSync(p, JSON.stringify({ vulnerabilities: [{ cveID: 'CVE-2024-0002' }], dateReleased: '2024-01-01T00:00:00.000Z', catalogVersion: 'v1' }));
    const now = Date.parse('2024-01-01T00:00:00.000Z') + 7 * 86_400_000;
    const r = loadKevCatalog(p, { now });
    assert.equal(r.usable, true);
    assert.equal(r.freshness.state, 'fresh');
    assert.equal(r.freshness.ageDays, 7);
    assert.equal(r.freshness.maxDays, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns usable set with stale state when age exceeds threshold', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadKevCatalog-'));
  try {
    const p = join(dir, 'kev.json');
    writeFileSync(p, JSON.stringify({ vulnerabilities: [{ cveID: 'CVE-2024-0003' }], dateReleased: '2024-01-01T00:00:00.000Z', catalogVersion: 'v1' }));
    const now = Date.parse('2024-01-01T00:00:00.000Z') + 8 * 86_400_000;
    const r = loadKevCatalog(p, { now });
    assert.equal(r.usable, true);
    assert.equal(r.freshness.state, 'stale');
    assert.equal(r.freshness.ageDays, 8);
    assert.equal(r.freshness.maxDays, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unknown freshness when dateReleased is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadKevCatalog-'));
  try {
    const p = join(dir, 'kev.json');
    writeFileSync(p, JSON.stringify({ vulnerabilities: [{ cveID: 'CVE-2024-0004' }], catalogVersion: 'v1' }));
    const now = Date.parse('2024-01-01T00:00:00.000Z');
    const r = loadKevCatalog(p, { now });
    assert.equal(r.usable, true);
    assert.equal(r.freshness.state, 'unknown');
    assert.equal(r.freshness.ageDays, null);
    assert.equal(r.freshness.maxDays, 7);
    assert.equal(r.freshness.catalogVersion, 'v1');
    assert.equal(r.freshness.dateReleased, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unknown freshness when dateReleased is not parseable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadKevCatalog-'));
  try {
    const p = join(dir, 'kev.json');
    writeFileSync(p, JSON.stringify({ vulnerabilities: [{ cveID: 'CVE-2024-0005' }], dateReleased: 'not-a-date', catalogVersion: 'v1' }));
    const now = Date.parse('2024-01-01T00:00:00.000Z');
    const r = loadKevCatalog(p, { now });
    assert.equal(r.usable, true);
    assert.equal(r.freshness.state, 'unknown');
    assert.equal(r.freshness.ageDays, null);
    assert.equal(r.freshness.maxDays, 7);
    assert.equal(r.freshness.catalogVersion, 'v1');
    assert.equal(r.freshness.dateReleased, 'not-a-date');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unknown freshness with reason when threshold is unusable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadKevCatalog-'));
  try {
    const p = join(dir, 'kev.json');
    writeFileSync(p, JSON.stringify({ vulnerabilities: [{ cveID: 'CVE-2024-0006' }], dateReleased: '2024-01-01T00:00:00.000Z', catalogVersion: 'v1' }));
    const now = Date.parse('2024-01-01T00:00:00.000Z');
    const orig = process.env.CW_KEV_STALE_DAYS;
    process.env.CW_KEV_STALE_DAYS = 'not-a-number';
    try {
      const r = loadKevCatalog(p, { now });
      assert.equal(r.usable, true);
      assert.equal(r.staleDays, null);
      assert.equal(r.freshness.state, 'unknown');
      assert.equal(r.freshness.ageDays, null);
      assert.equal(r.freshness.maxDays, null);
      assert.equal(r.freshness.catalogVersion, 'v1');
      assert.equal(r.freshness.dateReleased, '2024-01-01T00:00:00.000Z');
      assert.equal(r.freshness.reason, 'CW_KEV_STALE_DAYS is retired: CRA_KEV_STALE_DAYS is the one name every KEV freshness reader uses (cra/watch.mjs, cra/preflight.mjs, monitor/rollup.mjs)');
    } finally {
      if (orig === undefined) delete process.env.CW_KEV_STALE_DAYS;
      else process.env.CW_KEV_STALE_DAYS = orig;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
