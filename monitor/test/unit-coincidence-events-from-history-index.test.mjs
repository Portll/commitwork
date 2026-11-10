// Slice events built from the rows of a history directory's index.json (monitor/coincidence.mjs eventsFromHistoryIndex).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventsFromHistoryIndex } from '../coincidence.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(content) {
  const dir = mkdtempSync(join(tmpdir(), 'eventsFromHistoryIndex-'));
  try {
    if (content !== undefined) writeFileSync(join(dir, 'index.json'), content);
    return { r: eventsFromHistoryIndex(dir), p: join(dir, 'index.json') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('reports the index as absent when index.json does not exist', () => {
  const { r, p } = run(undefined);
  assert.deepEqual(r, { events: [], missing: [{ source: p, reason: 'absent' }] });
});

test('reports the index as unparseable when index.json is not valid JSON', () => {
  const { r, p } = run('not json');
  assert.deepEqual(r, { events: [], missing: [{ source: p, reason: 'unparseable' }] });
});

test('reads events from the rows property of an object index', () => {
  const { r } = run(JSON.stringify({ rows: [{ generated: '2024-01-01T00:00:00Z', sliceId: 's1', file: 'f1' }] }));
  assert.deepEqual(r, {
    events: [{ kind: 'slice', at: '2024-01-01T00:00:00Z', label: 's1', ref: 'f1' }],
    missing: [],
  });
});

test('reads events from the slices property when rows is absent', () => {
  const { r } = run(JSON.stringify({ slices: [{ generated: '2024-01-02T00:00:00Z', sliceId: 's2', file: 'f2' }] }));
  assert.deepEqual(r, {
    events: [{ kind: 'slice', at: '2024-01-02T00:00:00Z', label: 's2', ref: 'f2' }],
    missing: [],
  });
});

test('prefers rows over slices when both are present', () => {
  const { r } = run(JSON.stringify({
    rows: [{ generated: '2024-01-05T00:00:00Z', sliceId: 'r1', file: 'rf1' }],
    slices: [{ generated: '2024-02-05T00:00:00Z', sliceId: 'x1', file: 'xf1' }],
  }));
  assert.deepEqual(r, {
    events: [{ kind: 'slice', at: '2024-01-05T00:00:00Z', label: 'r1', ref: 'rf1' }],
    missing: [],
  });
});

test('uses a top-level array directly and yields no events for an object with neither key', () => {
  const a = run(JSON.stringify([{ generated: '2024-01-03T00:00:00Z', sliceId: 's3', file: 'f3' }])).r;
  assert.deepEqual(a, {
    events: [{ kind: 'slice', at: '2024-01-03T00:00:00Z', label: 's3', ref: 'f3' }],
    missing: [],
  });
  assert.deepEqual(run(JSON.stringify({ other: [1] })).r, { events: [], missing: [] });
});

test('drops rows that lack a generated timestamp and null rows', () => {
  const { r } = run(JSON.stringify([
    { generated: '2024-01-04T00:00:00Z', sliceId: 's4', file: 'f4' },
    { sliceId: 's5', file: 'f5' },
    { generated: '', sliceId: 's9', file: 'f9' },
  ]));
  assert.deepEqual(r, {
    events: [{ kind: 'slice', at: '2024-01-04T00:00:00Z', label: 's4', ref: 'f4' }],
    missing: [],
  });
});

test('falls back to the file name for the label when sliceId is missing', () => {
  const { r } = run(JSON.stringify([{ generated: '2024-01-06T00:00:00Z', file: 'f7' }]));
  assert.deepEqual(r, {
    events: [{ kind: 'slice', at: '2024-01-06T00:00:00Z', label: 'f7', ref: 'f7' }],
    missing: [],
  });
});

test('sets label and ref to null when both sliceId and file are missing', () => {
  const { r } = run(JSON.stringify([{ generated: '2024-01-07T00:00:00Z' }]));
  assert.deepEqual(r, {
    events: [{ kind: 'slice', at: '2024-01-07T00:00:00Z', label: null, ref: null }],
    missing: [],
  });
});

test('keeps the sliceId label and sets ref to null when file is missing', () => {
  const { r } = run(JSON.stringify([{ generated: '2024-01-08T00:00:00Z', sliceId: 's8' }]));
  assert.deepEqual(r, {
    events: [{ kind: 'slice', at: '2024-01-08T00:00:00Z', label: 's8', ref: null }],
    missing: [],
  });
});
