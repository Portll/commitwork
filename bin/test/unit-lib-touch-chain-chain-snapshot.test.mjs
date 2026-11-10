// Per-path ledger chain verdict of state, broken, torn and examined counts (bin/lib/touch-chain.mjs chainSnapshot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainSnapshot } from '../lib/touch-chain.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'chainSnapshot-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('reports an empty ledger file as ok with nothing examined', () => {
  withDir((dir) => {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, '');
    assert.deepEqual(chainSnapshot(p), { [p]: { state: 'ok', broken: 0, torn: 0, examined: 0 } });
  });
});

test('reports a missing ledger as absent rather than unreadable', () => {
  withDir((dir) => {
    const p = join(dir, 'nope.jsonl');
    assert.deepEqual(chainSnapshot(p), { [p]: { state: 'absent', broken: 0, torn: 0, examined: 0 } });
  });
});

test('fails closed with the error code and zero examined when the ledger is a directory', () => {
  withDir((dir) => {
    const p = join(dir, 'ledger');
    mkdirSync(p);
    assert.deepEqual(chainSnapshot(p), {
      [p]: { state: 'unreadable', broken: null, torn: null, examined: 0, error: 'EISDIR' },
    });
  });
});

test('reports a single genesis line as ok with one examined line', () => {
  withDir((dir) => {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, '{"prev":"genesis"}\n');
    assert.deepEqual(chainSnapshot(p), { [p]: { state: 'ok', broken: 0, torn: 0, examined: 1 } });
  });
});

test('counts a chained line and a raced line as clean', () => {
  withDir((dir) => {
    const p = join(dir, 'ledger.jsonl');
    const l1 = JSON.stringify({ prev: 'genesis' });
    const l2 = JSON.stringify({ n: 2, prev: hash(l1) });
    const l3 = JSON.stringify({ n: 3, prev: hash(l1) });
    writeFileSync(p, [l1, l2, l3].join('\n') + '\n');
    assert.deepEqual(chainSnapshot(p), { [p]: { state: 'ok', broken: 0, torn: 0, examined: 3 } });
  });
});

test('reports a broken chain when a prev hash matches no line', () => {
  withDir((dir) => {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, '{"prev":"genesis"}\n{"prev":"' + 'de'.repeat(16) + '"}\n');
    assert.deepEqual(chainSnapshot(p), { [p]: { state: 'chain-broken', broken: 1, torn: 0, examined: 2 } });
  });
});

test('reports a torn line when a row is not valid JSON', () => {
  withDir((dir) => {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, '{"prev":"genesis"}\nnot-json\n');
    assert.deepEqual(chainSnapshot(p), { [p]: { state: 'torn', broken: 0, torn: 1, examined: 2 } });
  });
});

test('accepts an array of paths and keys the result by each', () => {
  withDir((dir) => {
    const a = join(dir, 'a.jsonl');
    const b = join(dir, 'b.jsonl');
    writeFileSync(a, '{"prev":"genesis"}\n');
    writeFileSync(b, '');
    assert.deepEqual(chainSnapshot([a, b]), {
      [a]: { state: 'ok', broken: 0, torn: 0, examined: 1 },
      [b]: { state: 'ok', broken: 0, torn: 0, examined: 0 },
    });
  });
});

test('keeps reading later paths after one path is unreadable', () => {
  withDir((dir) => {
    const d = join(dir, 'sub');
    const f = join(dir, 'f.jsonl');
    mkdirSync(d);
    writeFileSync(f, '{"prev":"genesis"}\n');
    assert.deepEqual(chainSnapshot([d, f]), {
      [d]: { state: 'unreadable', broken: null, torn: null, examined: 0, error: 'EISDIR' },
      [f]: { state: 'ok', broken: 0, torn: 0, examined: 1 },
    });
  });
});
