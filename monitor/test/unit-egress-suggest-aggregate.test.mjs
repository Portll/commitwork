// Aggregates egress observation files into per-check lane summaries (monitor/egress-suggest.mjs aggregate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../egress-suggest.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns zero runs and empty arrays for no files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aggregate-'));
  try {
    const r = aggregate([], dir);
    assert.deepEqual(r, { lanes: [], runs: 0, failures: [], unobserved: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts unobserved rows with string check and unobserved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aggregate-'));
  try {
    const f = join(dir, 'a.json');
    writeFileSync(f, JSON.stringify({ lanes: [{ check: 'c1', unobserved: 'why1' }] }));
    const r = aggregate([f], dir);
    assert.deepEqual(r, { lanes: [], runs: 0, failures: [], unobserved: [{ check: "c1", why: "why1" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fails rows missing destinations array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aggregate-'));
  try {
    const f = join(dir, 'a.json');
    writeFileSync(f, JSON.stringify({ lanes: [{ check: 'c1' }] }));
    const r = aggregate([f], dir);
    assert.deepEqual(r, { lanes: [], runs: 0, failures: [{ path: "a.json", why: "not an observation (no check/destinations)" }], unobserved: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('aggregates single run with one destination', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aggregate-'));
  try {
    const f = join(dir, 'a.json');
    writeFileSync(f, JSON.stringify({ lanes: [{ check: 'c1', egress: 'eg1', at: '2024-01-01T00:00:00Z', destinations: [{ host: 'h1', port: 80, allowed: 1, denied: 0, local: 0 }] }] }));
    const r = aggregate([f], dir);
    assert.deepEqual(r, { lanes: [{ check: "c1", egress: "eg1", runs: 1, hosts: [{ host: "h1", port: 80, allowed: 1, denied: 0, local: 0, runs: 1, firstSeen: "2024-01-01T00:00:00Z", lastSeen: "2024-01-01T00:00:00Z" }] }], runs: 1, failures: [], unobserved: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('aggregates multiple runs with same host updating counts and times', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aggregate-'));
  try {
    const f = join(dir, 'a.json');
    writeFileSync(f, JSON.stringify({ lanes: [
      { check: 'c1', egress: 'eg1', at: '2024-01-02T00:00:00Z', destinations: [{ host: 'h1', port: 80, allowed: 2, denied: 1, local: 1 }] },
      { check: 'c1', egress: 'eg1', at: '2024-01-01T00:00:00Z', destinations: [{ host: 'h1', port: 80, allowed: 1, denied: 0, local: 0 }] }
    ] }));
    const r = aggregate([f], dir);
    assert.deepEqual(r, { lanes: [{ check: "c1", egress: "eg1", runs: 2, hosts: [{ host: "h1", port: 80, allowed: 3, denied: 1, local: 1, runs: 2, firstSeen: "2024-01-01T00:00:00Z", lastSeen: "2024-01-02T00:00:00Z" }] }], runs: 2, failures: [], unobserved: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles unparseable file as failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aggregate-'));
  try {
    const f = join(dir, 'a.json');
    writeFileSync(f, 'not json');
    const r = aggregate([f], dir);
    assert.deepEqual(r, { lanes: [], runs: 0, failures: [{ path: "a.json", why: "unreadable (Unexpected token 'o', \"not json\" is not valid JSON)" }], unobserved: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sorts lanes by check and hosts by host then port', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aggregate-'));
  try {
    const f = join(dir, 'a.json');
    writeFileSync(f, JSON.stringify({ lanes: [
      { check: 'z', at: '2024-01-01T00:00:00Z', destinations: [{ host: 'b', port: 80, allowed: 1, denied: 0, local: 0 }] },
      { check: 'a', at: '2024-01-01T00:00:00Z', destinations: [{ host: 'b', port: 443, allowed: 1, denied: 0, local: 0 }, { host: 'a', port: 80, allowed: 1, denied: 0, local: 0 }] }
    ] }));
    const r = aggregate([f], dir);
    assert.deepEqual(r, { lanes: [{ check: "a", egress: null, runs: 1, hosts: [{ host: "a", port: 80, allowed: 1, denied: 0, local: 0, runs: 1, firstSeen: "2024-01-01T00:00:00Z", lastSeen: "2024-01-01T00:00:00Z" }, { host: "b", port: 443, allowed: 1, denied: 0, local: 0, runs: 1, firstSeen: "2024-01-01T00:00:00Z", lastSeen: "2024-01-01T00:00:00Z" }] }, { check: "z", egress: null, runs: 1, hosts: [{ host: "b", port: 80, allowed: 1, denied: 0, local: 0, runs: 1, firstSeen: "2024-01-01T00:00:00Z", lastSeen: "2024-01-01T00:00:00Z" }] }], runs: 2, failures: [], unobserved: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles row without at field leaving firstSeen and lastSeen null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aggregate-'));
  try {
    const f = join(dir, 'a.json');
    writeFileSync(f, JSON.stringify({ lanes: [{ check: 'c1', destinations: [{ host: 'h1', port: 80, allowed: 1, denied: 0, local: 0 }] }] }));
    const r = aggregate([f], dir);
    assert.deepEqual(r, { lanes: [{ check: "c1", egress: null, runs: 1, hosts: [{ host: "h1", port: 80, allowed: 1, denied: 0, local: 0, runs: 1, firstSeen: null, lastSeen: null }] }], runs: 1, failures: [], unobserved: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
