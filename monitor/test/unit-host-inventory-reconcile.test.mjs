// Reconciles before/after socket observations into a stable/unstable inventory (monitor/host-inventory.mjs reconcile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../host-inventory.mjs';

test('returns after when before is invalid and after is valid', () => {
  const after = {
    ok: true,
    window: { capturedAt: '2024-01-01T00:00:00Z' },
    entries: [{ port: 80, proto: 'tcp', owner: 'project' }],
    counts: { total: 1, project: 1, host: 0, unstable: 0 }
  };
  const result = reconcile({ ok: false }, after);
  assert.strictEqual(result, after);
});

test('returns before when before is valid and after is invalid', () => {
  const before = {
    ok: true,
    window: { capturedAt: '2024-01-01T00:00:00Z' },
    entries: [{ port: 80, proto: 'tcp', owner: 'project' }],
    counts: { total: 1, project: 1, host: 0, unstable: 0 }
  };
  const result = reconcile(before, { ok: false });
  assert.strictEqual(result, before);
});

test('returns before when both are invalid', () => {
  const before = { ok: false };
  const after = { ok: false };
  const result = reconcile(before, after);
  assert.strictEqual(result, before);
});

test('returns after when before is null and after is valid', () => {
  const after = {
    ok: true,
    window: { capturedAt: '2024-01-01T00:00:00Z' },
    entries: [{ port: 80, proto: 'tcp', owner: 'project' }],
    counts: { total: 1, project: 1, host: 0, unstable: 0 }
  };
  const result = reconcile(null, after);
  assert.strictEqual(result, after);
});

test('returns before when after is null and before is valid', () => {
  const before = {
    ok: true,
    window: { capturedAt: '2024-01-01T00:00:00Z' },
    entries: [{ port: 80, proto: 'tcp', owner: 'project' }],
    counts: { total: 1, project: 1, host: 0, unstable: 0 }
  };
  const result = reconcile(before, null);
  assert.strictEqual(result, before);
});

test('returns before when both are null', () => {
  const result = reconcile(null, null);
  assert.strictEqual(result, null);
});

test('marks entries stable when owner is unchanged between observations', () => {
  const before = {
    ok: true,
    window: { capturedAt: '2024-01-01T00:00:00Z' },
    entries: [
      { port: 80, proto: 'tcp', owner: 'project' },
      { port: 443, proto: 'tcp', owner: 'host' }
    ],
    counts: { total: 2, project: 1, host: 1, unstable: 0 }
  };
  const after = {
    ok: true,
    window: { capturedAt: '2024-01-01T00:01:00Z' },
    entries: [
      { port: 80, proto: 'tcp', owner: 'project' },
      { port: 443, proto: 'tcp', owner: 'host' }
    ],
    counts: { total: 2, project: 1, host: 1, unstable: 0 }
  };
  const result = reconcile(before, after);
  assert.strictEqual(result.entries.length, 2);
  assert.strictEqual(result.entries[0].port, 80);
  assert.strictEqual(result.entries[0].stable, true);
  assert.strictEqual(result.entries[1].port, 443);
  assert.strictEqual(result.entries[1].stable, true);
  assert.strictEqual(result.counts.total, 2);
  assert.strictEqual(result.counts.project, 1);
  assert.strictEqual(result.counts.host, 1);
  assert.strictEqual(result.counts.unstable, 0);
});

test('marks entry unstable when port appears during the batch', () => {
  const before = {
    ok: true,
    window: { capturedAt: '2024-01-01T00:00:00Z' },
    entries: [{ port: 80, proto: 'tcp', owner: 'project' }],
    counts: { total: 1, project: 1, host: 0, unstable: 0 }
  };
  const after = {
    ok: true,
    window: { capturedAt: '2024-01-01T00:01:00Z' },
    entries: [
      { port: 80, proto: 'tcp', owner: 'project' },
      { port: 8080, proto: 'tcp', owner: 'project' }
    ],
    counts: { total: 2, project: 2, host: 0, unstable: 0 }
  };
  const result = reconcile(before, after);
  assert.strictEqual(result.entries.length, 2);
  const newEntry = result.entries.find(e => e.port === 8080);
  assert.strictEqual(newEntry.stable, false);
  assert.strictEqual(newEntry.owner, 'unknown');
  assert.strictEqual(newEntry.unstableWhy, 'the port appeared during the batch');
  assert.strictEqual(result.counts.unstable, 1);
});

test('marks entry unstable when port goes away during the batch', () => {
  const before = {
    ok: true,
    window: { capturedAt: '2024-01-01T00:00:00Z' },
    entries: [
      { port: 80, proto: 'tcp', owner: 'project' },
      { port: 8080, proto: 'tcp', owner: 'host' }
    ],
    counts: { total: 2, project: 1, host: 1, unstable: 0 }
  };
  const after = {
    ok: true,
    window: { capturedAt: '2024-01-01T00:01:00Z' },
    entries: [{ port: 80, proto: 'tcp', owner: 'project' }],
    counts: { total: 1, project: 1, host: 0, unstable: 0 }
  };
  const result = reconcile(before, after);
  assert.strictEqual(result.entries.length, 2);
  const goneEntry = result.entries.find(e => e.port === 8080);
  assert.strictEqual(goneEntry.stable, false);
  assert.strictEqual(goneEntry.owner, 'unknown');
  assert.strictEqual(goneEntry.unstableWhy, 'the port went away during the batch');
  assert.strictEqual(result.counts.unstable, 1);
});

test('marks entry unstable when ownership changes during the batch', () => {
  const before = {
    ok: true,
    window: { capturedAt: '2024-01-01T00:00:00Z' },
    entries: [{ port: 80, proto: 'tcp', owner: 'project' }],
    counts: { total: 1, project: 1, host: 0, unstable: 0 }
  };
  const after = {
    ok: true,
    window: { capturedAt: '2024-01-01T00:01:00Z' },
    entries: [{ port: 80, proto: 'tcp', owner: 'host' }],
    counts: { total: 1, project: 0, host: 1, unstable: 0 }
  };
  const result = reconcile(before, after);
  assert.strictEqual(result.entries.length, 1);
  assert.strictEqual(result.entries[0].stable, false);
  assert.strictEqual(result.entries[0].owner, 'unknown');
  assert.strictEqual(result.entries[0].unstableWhy, 'ownership changed during the batch: project -> host');
  assert.strictEqual(result.counts.unstable, 1);
});
