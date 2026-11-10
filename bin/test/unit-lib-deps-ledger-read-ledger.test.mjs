// Parsed deps ledger events plus the torn tail length (bin/lib/deps-ledger.mjs readLedger).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLedger } from '../lib/deps-ledger.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withLedger(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'readLedger-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    if (content !== null) writeFileSync(p, content);
    fn(p, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const A1 = '{"event":"audit","id":"a1"}';
const A2 = '{"event":"merged","id":"a2"}';

test('a missing ledger file is reported as absent with no events', () => {
  withLedger(null, (p) => {
    assert.deepEqual(readLedger(p), { events: [], absent: true, path: p });
  });
});

test('a path that cannot be read as a file returns a read error with its code', () => {
  withLedger(null, (p, dir) => {
    assert.deepEqual(readLedger(dir), {
      error: `the deps ledger ${dir} could not be read (EISDIR)`,
      path: dir,
    });
  });
});

test('an empty ledger file has no events and a torn length of zero', () => {
  withLedger('', (p) => {
    assert.deepEqual(readLedger(p), { events: [], torn: 0, path: p });
  });
});

test('a single newline terminated line yields that one event', () => {
  withLedger(A1 + '\n', (p) => {
    assert.deepEqual(readLedger(p), {
      events: [{ event: 'audit', id: 'a1' }],
      torn: 0,
      path: p,
    });
  });
});

test('a final line without a newline is left out and its length is reported as torn', () => {
  withLedger(A1 + '\n' + A2, (p) => {
    assert.deepEqual(readLedger(p), {
      events: [{ event: 'audit', id: 'a1' }],
      torn: 28,
      path: p,
    });
  });
});

test('blank lines are skipped and events keep their file order', () => {
  withLedger(A1 + '\n\n' + A2 + '\n', (p) => {
    assert.deepEqual(readLedger(p), {
      events: [{ event: 'audit', id: 'a1' }, { event: 'merged', id: 'a2' }],
      torn: 0,
      path: p,
    });
  });
});

test('a first line that is not JSON is reported as line 1', () => {
  withLedger('not-json\n', (p) => {
    assert.deepEqual(readLedger(p), {
      error: `the deps ledger ${p} line 1 is not JSON (Unexpected token 'o', "not-json" is not valid JSON)`,
      path: p,
    });
  });
});

test('a non JSON line after a blank line is reported by its own line number', () => {
  withLedger(A1 + '\n\nnot-json\n', (p) => {
    assert.deepEqual(readLedger(p), {
      error: `the deps ledger ${p} line 3 is not JSON (Unexpected token 'o', "not-json" is not valid JSON)`,
      path: p,
    });
  });
});

test('an unknown event on the second line is reported with its line number and name', () => {
  withLedger(A1 + '\n{"event":"bogus"}\n', (p) => {
    assert.deepEqual(readLedger(p), {
      error: `the deps ledger ${p} line 2 has unknown event "bogus"`,
      path: p,
    });
  });
});

test('a line holding JSON null throws when its event is read', () => {
  withLedger('null\n', (p) => {
    assert.throws(() => readLedger(p), {
      name: 'TypeError',
      message: "Cannot read properties of null (reading 'event')",
    });
  });
});
