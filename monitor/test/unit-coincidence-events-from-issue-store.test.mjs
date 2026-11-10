// Issue-event records and missing-source markers read from an issue store file (monitor/coincidence.mjs eventsFromIssueStore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventsFromIssueStore } from '../coincidence.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'eventsFromIssueStore-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a store file that does not exist is reported as absent', () => {
  withDir((dir) => {
    const p = join(dir, 'nope.json');
    const r = eventsFromIssueStore(p);
    assert.deepEqual(r, { events: [], missing: [{ source: p, reason: 'absent' }] });
  });
});

test('a store file that is not valid JSON is reported as unparseable', () => {
  withDir((dir) => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not json');
    const r = eventsFromIssueStore(p);
    assert.deepEqual(r, { events: [], missing: [{ source: p, reason: 'unparseable' }] });
  });
});

test('a store path that is a directory is reported as unparseable', () => {
  withDir((dir) => {
    const p = join(dir, 'store-dir');
    mkdirSync(p);
    const r = eventsFromIssueStore(p);
    assert.deepEqual(r, { events: [], missing: [{ source: p, reason: 'unparseable' }] });
  });
});

test('a store whose events field is not an array yields no events and a not-recorded marker', () => {
  withDir((dir) => {
    const p = join(dir, 's.json');
    writeFileSync(p, JSON.stringify({ events: { at: '2024-01-01T00:00:00Z' } }));
    const r = eventsFromIssueStore(p);
    assert.deepEqual(r, { events: [], missing: [{ source: p, reason: 'not-recorded' }] });
  });
});

test('valid events are mapped and null entries or entries without at are dropped', () => {
  withDir((dir) => {
    const p = join(dir, 's.json');
    const store = {
      events: [
        { at: '2024-01-01T00:00:00Z', type: 'opened', issueId: 'i1' },
        { at: '2024-01-02T00:00:00Z' },
        null,
        { type: 'closed', issueId: 'i2' },
        { at: '2024-01-03T00:00:00Z', type: '', issueId: '' },
      ],
    };
    writeFileSync(p, JSON.stringify(store));
    const r = eventsFromIssueStore(p);
    assert.deepEqual(r, {
      events: [
        { kind: 'issue-event', at: '2024-01-01T00:00:00Z', label: 'opened', ref: 'i1' },
        { kind: 'issue-event', at: '2024-01-02T00:00:00Z', label: null, ref: null },
        { kind: 'issue-event', at: '2024-01-03T00:00:00Z', label: null, ref: null },
      ],
      missing: [],
    });
  });
});

test('objects with a missing or empty at are dropped while one with type and issueId is kept', () => {
  withDir((dir) => {
    const p = join(dir, 's.json');
    const store = {
      events: [
        { type: 'closed', issueId: 'i2' },
        { at: '', type: 'reopened', issueId: 'i3' },
        { at: '2024-02-01T00:00:00Z', type: 'labeled', issueId: 'i4' },
      ],
    };
    writeFileSync(p, JSON.stringify(store));
    const r = eventsFromIssueStore(p);
    assert.deepEqual(r, {
      events: [{ kind: 'issue-event', at: '2024-02-01T00:00:00Z', label: 'labeled', ref: 'i4' }],
      missing: [],
    });
  });
});

test('an empty events array yields no events and no missing markers', () => {
  withDir((dir) => {
    const p = join(dir, 's.json');
    writeFileSync(p, JSON.stringify({ events: [] }));
    const r = eventsFromIssueStore(p);
    assert.deepEqual(r, { events: [], missing: [] });
  });
});

test('a store file containing JSON null throws a TypeError reading events', () => {
  withDir((dir) => {
    const p = join(dir, 's.json');
    writeFileSync(p, 'null');
    assert.throws(() => eventsFromIssueStore(p), {
      name: 'TypeError',
      message: "Cannot read properties of null (reading 'events')",
    });
  });
});
