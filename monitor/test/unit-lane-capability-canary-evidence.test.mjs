// Maps measured lanes to canary categories with credit flags (monitor/lane-capability.mjs canaryEvidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canaryEvidence } from '../lane-capability.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns read false when expected file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canaryEvidence-'));
  try {
    const r = canaryEvidence(dir);
    assert.deepEqual(r, { read: false, byCategory: {}, unmapped: [], uncredited: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns read true with empty lanes when measured lanes is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canaryEvidence-'));
  try {
    writeFileSync(join(dir, 'EXPECTED.json'), JSON.stringify({ measured: { date: '2024-01-01', lanes: {} } }));
    const r = canaryEvidence(dir);
    assert.deepEqual(r, { read: true, date: "2024-01-01", byCategory: {}, unmapped: [], uncredited: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps a lane with both directions and string clean dirty to credited evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canaryEvidence-'));
  try {
    const expected = {
      measured: {
        date: '2024-01-01',
        lanes: {
          secrets: {
            date: '2024-01-02',
            verdict: 'BOTH DIRECTIONS DEMONSTRATED',
            clean: 'clean',
            dirty: 'dirty'
          }
        }
      }
    };
    writeFileSync(join(dir, 'EXPECTED.json'), JSON.stringify(expected));
    const r = canaryEvidence(dir);
    assert.deepEqual(r, { read: true, date: "2024-01-01", byCategory: { secrets: [{ lane: "secrets", date: "2024-01-02", verdict: "BOTH DIRECTIONS DEMONSTRATED", credits: true }] }, unmapped: [], uncredited: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks lane as uncredited when category is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canaryEvidence-'));
  try {
    const expected = {
      measured: {
        date: '2024-01-01',
        lanes: {
          'no-cat': { verdict: 'BOTH DIRECTIONS DEMONSTRATED', clean: 'c', dirty: 'd' }
        }
      }
    };
    writeFileSync(join(dir, 'EXPECTED.json'), JSON.stringify(expected));
    const r = canaryEvidence(dir);
    assert.deepEqual(r, { read: true, date: "2024-01-01", byCategory: {}, unmapped: ["no-cat"], uncredited: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks lane as unmapped when lane is not in canary categories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canaryEvidence-'));
  try {
    const expected = {
      measured: {
        date: '2024-01-01',
        lanes: {
          unknownLane: { verdict: 'BOTH DIRECTIONS DEMONSTRATED', clean: 'c', dirty: 'd' }
        }
      }
    };
    writeFileSync(join(dir, 'EXPECTED.json'), JSON.stringify(expected));
    const r = canaryEvidence(dir);
    assert.deepEqual(r, { read: true, date: "2024-01-01", byCategory: {}, unmapped: ["unknownLane"], uncredited: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sets credits false when verdict is not both directions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canaryEvidence-'));
  try {
    const expected = {
      measured: {
        date: '2024-01-01',
        lanes: {
          secrets: {
            date: '2024-01-02',
            verdict: 'SOME OTHER VERDICT',
            clean: 'clean',
            dirty: 'dirty'
          }
        }
      }
    };
    writeFileSync(join(dir, 'EXPECTED.json'), JSON.stringify(expected));
    const r = canaryEvidence(dir);
    assert.deepEqual(r, { read: true, date: "2024-01-01", byCategory: { secrets: [{ lane: "secrets", date: "2024-01-02", verdict: "SOME OTHER VERDICT", credits: false }] }, unmapped: [], uncredited: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sets credits false when clean is not a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canaryEvidence-'));
  try {
    const expected = {
      measured: {
        date: '2024-01-01',
        lanes: {
          secrets: {
            date: '2024-01-02',
            verdict: 'BOTH DIRECTIONS DEMONSTRATED',
            clean: 123,
            dirty: 'dirty'
          }
        }
      }
    };
    writeFileSync(join(dir, 'EXPECTED.json'), JSON.stringify(expected));
    const r = canaryEvidence(dir);
    assert.deepEqual(r, { read: true, date: "2024-01-01", byCategory: { secrets: [{ lane: "secrets", date: "2024-01-02", verdict: "BOTH DIRECTIONS DEMONSTRATED", credits: false }] }, unmapped: [], uncredited: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sets credits false when dirty is not a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canaryEvidence-'));
  try {
    const expected = {
      measured: {
        date: '2024-01-01',
        lanes: {
          secrets: {
            date: '2024-01-02',
            verdict: 'BOTH DIRECTIONS DEMONSTRATED',
            clean: 'clean',
            dirty: null
          }
        }
      }
    };
    writeFileSync(join(dir, 'EXPECTED.json'), JSON.stringify(expected));
    const r = canaryEvidence(dir);
    assert.deepEqual(r, { read: true, date: "2024-01-01", byCategory: { secrets: [{ lane: "secrets", date: "2024-01-02", verdict: "BOTH DIRECTIONS DEMONSTRATED", credits: false }] }, unmapped: [], uncredited: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses measured date when lane has no date', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canaryEvidence-'));
  try {
    const expected = {
      measured: {
        date: '2024-01-01',
        lanes: {
          secrets: {
            verdict: 'BOTH DIRECTIONS DEMONSTRATED',
            clean: 'clean',
            dirty: 'dirty'
          }
        }
      }
    };
    writeFileSync(join(dir, 'EXPECTED.json'), JSON.stringify(expected));
    const r = canaryEvidence(dir);
    assert.deepEqual(r, { read: true, date: "2024-01-01", byCategory: { secrets: [{ lane: "secrets", date: "2024-01-01", verdict: "BOTH DIRECTIONS DEMONSTRATED", credits: true }] }, unmapped: [], uncredited: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes tool for dependency-cve lane', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canaryEvidence-'));
  try {
    const expected = {
      measured: {
        date: '2024-01-01',
        lanes: {
          'dependency-cve': {
            date: '2024-01-02',
            verdict: 'BOTH DIRECTIONS DEMONSTRATED',
            clean: 'clean',
            dirty: 'dirty'
          }
        }
      }
    };
    writeFileSync(join(dir, 'EXPECTED.json'), JSON.stringify(expected));
    const r = canaryEvidence(dir);
    assert.deepEqual(r, { read: true, date: "2024-01-01", byCategory: { depsOsv: [{ lane: "dependency-cve", tool: "osv-scanner", date: "2024-01-02", verdict: "BOTH DIRECTIONS DEMONSTRATED", credits: true }] }, unmapped: [], uncredited: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
