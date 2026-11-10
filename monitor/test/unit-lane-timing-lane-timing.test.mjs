// Computes per-lane timing statistics from checks-status.json files (monitor/lane-timing.mjs laneTiming).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneTiming } from '../lane-timing.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('counts unreadable files and increments read counter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneTiming-'));
  try {
    const bdir = join(dir, 'sweep-20240101000000-alpha');
    mkdirSync(bdir, { recursive: true });
    writeFileSync(join(bdir, 'checks-status.json'), 'not json');
    const r = laneTiming({ root: dir });
    assert.deepEqual(r, { lanes: {}, files: { found: 1, read: 0, unreadable: 1, outOfArea: 0, unattributed: 0 }, window: { area: null, since: null, until: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts unattributed batches when area filter is set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneTiming-'));
  try {
    const bdir = join(dir, 'not-a-sweep');
    mkdirSync(bdir, { recursive: true });
    writeFileSync(join(bdir, 'checks-status.json'), JSON.stringify([{ check: 'c1', at: '2024-01-01T00:00:00Z', status: 'pass', durationMs: 10 }]));
    const r = laneTiming({ root: dir, area: 'alpha' });
    assert.deepEqual(r, { lanes: {}, files: { found: 1, read: 0, unreadable: 0, outOfArea: 0, unattributed: 1 }, window: { area: "alpha", since: null, until: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filters rows by since boundary using strict less-than', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneTiming-'));
  try {
    const bdir = join(dir, 'sweep-20240101000000-alpha');
    mkdirSync(bdir, { recursive: true });
    writeFileSync(join(bdir, 'checks-status.json'), JSON.stringify([
      { check: 'c1', at: '2024-01-01T00:00:00Z', status: 'pass', durationMs: 10 },
      { check: 'c1', at: '2024-01-01T00:00:01Z', status: 'pass', durationMs: 20 }
    ]));
    const r = laneTiming({ root: dir, since: '2024-01-01T00:00:00Z' });
    assert.deepEqual(r, { lanes: { c1: { timed: 2, untimed: 0, skipped: 0, ok: 2, failed: 0, void: 0, firstAt: "2024-01-01T00:00:00Z", lastAt: "2024-01-01T00:00:01Z", min: 10, p50: 10, p95: 20, max: 20, samples: [{ at: "2024-01-01T00:00:00Z", ms: 10, status: "pass", repo: null, batch: "sweep-20240101000000-alpha" }, { at: "2024-01-01T00:00:01Z", ms: 20, status: "pass", repo: null, batch: "sweep-20240101000000-alpha" }], samplesDropped: 0, daily: [{ day: "2024-01-01", runs: 2, p50: 10, min: 10, max: 20 }] } }, files: { found: 1, read: 1, unreadable: 0, outOfArea: 0, unattributed: 0 }, window: { area: null, since: "2024-01-01T00:00:00Z", until: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filters rows by until boundary using strict greater-than-or-equal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneTiming-'));
  try {
    const bdir = join(dir, 'sweep-20240101000000-alpha');
    mkdirSync(bdir, { recursive: true });
    writeFileSync(join(bdir, 'checks-status.json'), JSON.stringify([
      { check: 'c1', at: '2024-01-01T00:00:00Z', status: 'pass', durationMs: 10 },
      { check: 'c1', at: '2024-01-01T00:00:01Z', status: 'pass', durationMs: 20 }
    ]));
    const r = laneTiming({ root: dir, until: '2024-01-01T00:00:01Z' });
    assert.deepEqual(r, { lanes: { c1: { timed: 1, untimed: 0, skipped: 0, ok: 1, failed: 0, void: 0, firstAt: "2024-01-01T00:00:00Z", lastAt: "2024-01-01T00:00:00Z", min: 10, p50: 10, p95: 10, max: 10, samples: [{ at: "2024-01-01T00:00:00Z", ms: 10, status: "pass", repo: null, batch: "sweep-20240101000000-alpha" }], samplesDropped: 0, daily: [{ day: "2024-01-01", runs: 1, p50: 10, min: 10, max: 10 }] } }, files: { found: 1, read: 1, unreadable: 0, outOfArea: 0, unattributed: 0 }, window: { area: null, since: null, until: "2024-01-01T00:00:01Z" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tracks firstAt with strict less-than comparison', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneTiming-'));
  try {
    const bdir = join(dir, 'sweep-20240101000000-alpha');
    mkdirSync(bdir, { recursive: true });
    writeFileSync(join(bdir, 'checks-status.json'), JSON.stringify([
      { check: 'c1', at: '2024-01-01T00:00:05Z', status: 'pass', durationMs: 10 },
      { check: 'c1', at: '2024-01-01T00:00:05Z', status: 'pass', durationMs: 20 }
    ]));
    const r = laneTiming({ root: dir });
    assert.deepEqual(r, { lanes: { c1: { timed: 2, untimed: 0, skipped: 0, ok: 2, failed: 0, void: 0, firstAt: "2024-01-01T00:00:05Z", lastAt: "2024-01-01T00:00:05Z", min: 10, p50: 10, p95: 20, max: 20, samples: [{ at: "2024-01-01T00:00:05Z", ms: 10, status: "pass", repo: null, batch: "sweep-20240101000000-alpha" }, { at: "2024-01-01T00:00:05Z", ms: 20, status: "pass", repo: null, batch: "sweep-20240101000000-alpha" }], samplesDropped: 0, daily: [{ day: "2024-01-01", runs: 2, p50: 10, min: 10, max: 20 }] } }, files: { found: 1, read: 1, unreadable: 0, outOfArea: 0, unattributed: 0 }, window: { area: null, since: null, until: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tracks lastAt with strict greater-than comparison', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneTiming-'));
  try {
    const bdir = join(dir, 'sweep-20240101000000-alpha');
    mkdirSync(bdir, { recursive: true });
    writeFileSync(join(bdir, 'checks-status.json'), JSON.stringify([
      { check: 'c1', at: '2024-01-01T00:00:05Z', status: 'pass', durationMs: 10 },
      { check: 'c1', at: '2024-01-01T00:00:05Z', status: 'pass', durationMs: 20 }
    ]));
    const r = laneTiming({ root: dir });
    assert.deepEqual(r, { lanes: { c1: { timed: 2, untimed: 0, skipped: 0, ok: 2, failed: 0, void: 0, firstAt: "2024-01-01T00:00:05Z", lastAt: "2024-01-01T00:00:05Z", min: 10, p50: 10, p95: 20, max: 20, samples: [{ at: "2024-01-01T00:00:05Z", ms: 10, status: "pass", repo: null, batch: "sweep-20240101000000-alpha" }, { at: "2024-01-01T00:00:05Z", ms: 20, status: "pass", repo: null, batch: "sweep-20240101000000-alpha" }], samplesDropped: 0, daily: [{ day: "2024-01-01", runs: 2, p50: 10, min: 10, max: 20 }] } }, files: { found: 1, read: 1, unreadable: 0, outOfArea: 0, unattributed: 0 }, window: { area: null, since: null, until: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts failed status correctly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneTiming-'));
  try {
    const bdir = join(dir, 'sweep-20240101000000-alpha');
    mkdirSync(bdir, { recursive: true });
    writeFileSync(join(bdir, 'checks-status.json'), JSON.stringify([
      { check: 'c1', at: '2024-01-01T00:00:00Z', status: 'pass', durationMs: 10 },
      { check: 'c1', at: '2024-01-01T00:00:01Z', status: 'fail', durationMs: 20 }
    ]));
    const r = laneTiming({ root: dir });
    assert.deepEqual(r, { lanes: { c1: { timed: 2, untimed: 0, skipped: 0, ok: 1, failed: 1, void: 0, firstAt: "2024-01-01T00:00:00Z", lastAt: "2024-01-01T00:00:01Z", min: 10, p50: 10, p95: 20, max: 20, samples: [{ at: "2024-01-01T00:00:00Z", ms: 10, status: "pass", repo: null, batch: "sweep-20240101000000-alpha" }, { at: "2024-01-01T00:00:01Z", ms: 20, status: "fail", repo: null, batch: "sweep-20240101000000-alpha" }], samplesDropped: 0, daily: [{ day: "2024-01-01", runs: 2, p50: 10, min: 10, max: 20 }] } }, files: { found: 1, read: 1, unreadable: 0, outOfArea: 0, unattributed: 0 }, window: { area: null, since: null, until: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts skipped status with OR logic for skip and skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneTiming-'));
  try {
    const bdir = join(dir, 'sweep-20240101000000-alpha');
    mkdirSync(bdir, { recursive: true });
    writeFileSync(join(bdir, 'checks-status.json'), JSON.stringify([
      { check: 'c1', at: '2024-01-01T00:00:00Z', status: 'skip', durationMs: 10 },
      { check: 'c1', at: '2024-01-01T00:00:01Z', status: 'skipped', durationMs: 20 }
    ]));
    const r = laneTiming({ root: dir });
    assert.deepEqual(r, { lanes: { c1: { timed: 0, untimed: 0, skipped: 2, ok: 0, failed: 0, void: 0, firstAt: "2024-01-01T00:00:00Z", lastAt: "2024-01-01T00:00:01Z", min: null, p50: null, p95: null, max: null, samples: [], samplesDropped: 0, daily: [] } }, files: { found: 1, read: 1, unreadable: 0, outOfArea: 0, unattributed: 0 }, window: { area: null, since: null, until: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preserves repo name in samples using OR null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneTiming-'));
  try {
    const bdir = join(dir, 'sweep-20240101000000-alpha');
    const rdir = join(bdir, 'myrepo');
    mkdirSync(rdir, { recursive: true });
    writeFileSync(join(rdir, 'checks-status.json'), JSON.stringify([
      { check: 'c1', at: '2024-01-01T00:00:00Z', status: 'pass', durationMs: 10 }
    ]));
    const r = laneTiming({ root: dir });
    assert.deepEqual(r, { lanes: { c1: { timed: 1, untimed: 0, skipped: 0, ok: 1, failed: 0, void: 0, firstAt: "2024-01-01T00:00:00Z", lastAt: "2024-01-01T00:00:00Z", min: 10, p50: 10, p95: 10, max: 10, samples: [{ at: "2024-01-01T00:00:00Z", ms: 10, status: "pass", repo: "myrepo", batch: "sweep-20240101000000-alpha" }], samplesDropped: 0, daily: [{ day: "2024-01-01", runs: 1, p50: 10, min: 10, max: 10 }] } }, files: { found: 1, read: 1, unreadable: 0, outOfArea: 0, unattributed: 0 }, window: { area: null, since: null, until: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sorts samples by at timestamp with OR empty string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneTiming-'));
  try {
    const bdir = join(dir, 'sweep-20240101000000-alpha');
    mkdirSync(bdir, { recursive: true });
    writeFileSync(join(bdir, 'checks-status.json'), JSON.stringify([
      { check: 'c1', at: '2024-01-01T00:00:02Z', status: 'pass', durationMs: 30 },
      { check: 'c1', at: '2024-01-01T00:00:00Z', status: 'pass', durationMs: 10 },
      { check: 'c1', at: '2024-01-01T00:00:01Z', status: 'pass', durationMs: 20 }
    ]));
    const r = laneTiming({ root: dir });
    assert.deepEqual(r, { lanes: { c1: { timed: 3, untimed: 0, skipped: 0, ok: 3, failed: 0, void: 0, firstAt: "2024-01-01T00:00:00Z", lastAt: "2024-01-01T00:00:02Z", min: 10, p50: 20, p95: 30, max: 30, samples: [{ at: "2024-01-01T00:00:00Z", ms: 10, status: "pass", repo: null, batch: "sweep-20240101000000-alpha" }, { at: "2024-01-01T00:00:01Z", ms: 20, status: "pass", repo: null, batch: "sweep-20240101000000-alpha" }, { at: "2024-01-01T00:00:02Z", ms: 30, status: "pass", repo: null, batch: "sweep-20240101000000-alpha" }], samplesDropped: 0, daily: [{ day: "2024-01-01", runs: 3, p50: 20, min: 10, max: 30 }] } }, files: { found: 1, read: 1, unreadable: 0, outOfArea: 0, unattributed: 0 }, window: { area: null, since: null, until: null } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
