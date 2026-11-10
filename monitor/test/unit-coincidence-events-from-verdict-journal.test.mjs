// Verdict events and unreadable sources gathered from a verdict journal directory (monitor/coincidence.mjs eventsFromVerdictJournal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventsFromVerdictJournal } from '../coincidence.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AT = '2024-01-01T00:00:00Z';
const line = (o) => JSON.stringify(o) + '\n';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'eventsFromVerdictJournal-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a journal directory that does not exist is reported as absent', () => {
  withDir((dir) => {
    const src = join(dir, 'no-such-dir');
    const r = eventsFromVerdictJournal(src);
    assert.deepEqual(r, { events: [], missing: [{ source: src, reason: 'absent' }] });
  });
});

test('a journal path that is a file is reported as not permitted', () => {
  withDir((dir) => {
    const file = join(dir, 'a-file');
    writeFileSync(file, 'x');
    const r = eventsFromVerdictJournal(file);
    assert.deepEqual(r, { events: [], missing: [{ source: file, reason: 'not-permitted' }] });
  });
});

test('only files ending in jsonl or jsonl with a numeric suffix are read', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'readme.txt'), line({ at: AT, gate: 'r' }));
    writeFileSync(join(dir, 'j.jsonl.x'), line({ at: AT, gate: 'x' }));
    writeFileSync(join(dir, 'j.jsonl.12'), line({ at: AT, gate: 'old' }));
    writeFileSync(join(dir, 'j.jsonl'), line({ at: AT, gate: 'pass' }));
    const r = eventsFromVerdictJournal(dir);
    assert.deepEqual(r, {
      events: [
        { kind: 'verdict', at: AT, label: 'pass', ref: 'j.jsonl' },
        { kind: 'verdict', at: AT, label: 'old', ref: 'j.jsonl.12' },
      ],
      missing: [],
    });
  });
});

test('the gate field is used as the label even when a verdict is present', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'j.jsonl'), line({ at: AT, gate: 'g', verdict: 'v' }));
    const r = eventsFromVerdictJournal(dir);
    assert.deepEqual(r, {
      events: [{ kind: 'verdict', at: AT, label: 'g', ref: 'j.jsonl' }],
      missing: [],
    });
  });
});

test('the verdict field is used as the label when there is no gate', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'j.jsonl'), line({ at: AT, verdict: 'fail' }));
    const r = eventsFromVerdictJournal(dir);
    assert.deepEqual(r, {
      events: [{ kind: 'verdict', at: AT, label: 'fail', ref: 'j.jsonl' }],
      missing: [],
    });
  });
});

test('the label is null when neither gate nor verdict is present', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'j.jsonl'), line({ at: AT }));
    const r = eventsFromVerdictJournal(dir);
    assert.deepEqual(r, {
      events: [{ kind: 'verdict', at: AT, label: null, ref: 'j.jsonl' }],
      missing: [],
    });
  });
});

test('records without a truthy at field and null records are skipped', () => {
  withDir((dir) => {
    const body = line({ gate: 'pass' }) + line({ at: '', gate: 'e' }) + 'null\n' + line({ at: AT, gate: 'kept' });
    writeFileSync(join(dir, 'j.jsonl'), body);
    const r = eventsFromVerdictJournal(dir);
    assert.deepEqual(r, {
      events: [{ kind: 'verdict', at: AT, label: 'kept', ref: 'j.jsonl' }],
      missing: [],
    });
  });
});

test('a record with no at field alone yields no events', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'j.jsonl'), line({ gate: 'pass' }));
    const r = eventsFromVerdictJournal(dir);
    assert.deepEqual(r, { events: [], missing: [] });
  });
});

test('malformed and blank lines are ignored while valid lines still count', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'j.jsonl'), 'not-json\n\n' + line({ at: AT, gate: 'ok' }));
    const r = eventsFromVerdictJournal(dir);
    assert.deepEqual(r, {
      events: [{ kind: 'verdict', at: AT, label: 'ok', ref: 'j.jsonl' }],
      missing: [],
    });
  });
});

test('an unreadable jsonl entry is reported as not permitted and later files are still read', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'a.jsonl'));
    writeFileSync(join(dir, 'b.jsonl'), line({ at: AT, verdict: 'pass' }));
    const r = eventsFromVerdictJournal(dir);
    assert.deepEqual(r, {
      events: [{ kind: 'verdict', at: AT, label: 'pass', ref: 'b.jsonl' }],
      missing: [{ source: join(dir, 'a.jsonl'), reason: 'not-permitted' }],
    });
  });
});
