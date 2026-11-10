// Whether each anchored verdict journal still holds its anchored prefix (bin/lib/verdict-journal-core.mjs verifyAnchors).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAnchors } from '../lib/verdict-journal-core.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const lineHash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const makeLines = (n) => Array.from({ length: n }, (_, i) => JSON.stringify({ v: 1, gate: 'g', i }));
const anchor = (file, records, lastHash, extra = {}) => ({ kind: 'verdict-anchor', file, records, lastHash, ...extra });
const chain = (verified, unchained) => ({ verified, broken: 0, raced: 0, unchained });

function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'verifyAnchors-'));
  const saved = { a: process.env.CW_VERDICT_ANCHORS, d: process.env.CW_VERDICT_DIR };
  try {
    const anchors = join(dir, 'anchors.jsonl');
    const journals = join(dir, 'journals');
    const fallback = join(dir, 'fallback');
    mkdirSync(journals);
    mkdirSync(fallback);
    process.env.CW_VERDICT_ANCHORS = anchors;
    process.env.CW_VERDICT_DIR = fallback;
    const writeAnchors = (recs) => writeFileSync(anchors, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const writeJournal = (where, name, lines) => writeFileSync(join(where, name), lines.join('\n') + '\n');
    fn({ anchors, journals, fallback, writeAnchors, writeJournal });
  } finally {
    if (saved.a === undefined) delete process.env.CW_VERDICT_ANCHORS; else process.env.CW_VERDICT_ANCHORS = saved.a;
    if (saved.d === undefined) delete process.env.CW_VERDICT_DIR; else process.env.CW_VERDICT_DIR = saved.d;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('reports no-anchors when the anchor store is missing and when it is empty', () => {
  withStore(({ anchors, journals }) => {
    assert.deepEqual(verifyAnchors({ dir: journals }), { state: 'no-anchors', results: [] });
    writeFileSync(anchors, '');
    assert.deepEqual(verifyAnchors({ dir: journals }), { state: 'no-anchors', results: [] });
  });
});

test('fails closed with the error code when the anchor store is a directory', () => {
  withStore(({ anchors, journals }) => {
    mkdirSync(anchors);
    assert.deepEqual(verifyAnchors({ dir: journals }), { state: 'anchors-unreadable', detail: 'EISDIR', results: [] });
  });
});

test('reports intact when the journal holds exactly the anchored records and ignores non-anchor records', () => {
  withStore(({ journals, writeAnchors, writeJournal }) => {
    const lines = makeLines(2);
    writeJournal(journals, 'g.jsonl', lines);
    writeAnchors([{ kind: 'note', file: 'stray.jsonl', records: 1 }, anchor('g.jsonl', 2, lineHash(lines[1]))]);
    assert.deepEqual(verifyAnchors({ dir: journals }), {
      state: 'ok',
      results: [{ file: 'g.jsonl', state: 'intact', anchoredRecords: 2, records: 2 }],
      anchorChain: chain(0, 2),
    });
  });
});

test('reports intact-extended when the journal grew past the anchored prefix', () => {
  withStore(({ journals, writeAnchors, writeJournal }) => {
    const lines = makeLines(3);
    writeJournal(journals, 'g.jsonl', lines);
    writeAnchors([anchor('g.jsonl', 2, lineHash(lines[1]), { prev: 'genesis' })]);
    assert.deepEqual(verifyAnchors({ dir: journals }), {
      state: 'ok',
      results: [{ file: 'g.jsonl', state: 'intact-extended', anchoredRecords: 2, records: 3 }],
      anchorChain: chain(1, 0),
    });
  });
});

test('flags TRUNCATED when the journal holds one record fewer than anchored', () => {
  withStore(({ journals, writeAnchors, writeJournal }) => {
    const lines = makeLines(3);
    writeJournal(journals, 'g.jsonl', lines.slice(0, 2));
    writeAnchors([anchor('g.jsonl', 3, lineHash(lines[2]))]);
    assert.deepEqual(verifyAnchors({ dir: journals }), {
      state: 'ALARM',
      results: [{ file: 'g.jsonl', state: 'TRUNCATED', anchoredRecords: 3, records: 2 }],
      anchorChain: chain(0, 1),
    });
  });
});

test('flags REWRITTEN when the anchored last line was edited', () => {
  withStore(({ journals, writeAnchors, writeJournal }) => {
    const lines = makeLines(2);
    writeJournal(journals, 'g.jsonl', [lines[0], JSON.stringify({ v: 1, gate: 'g', i: 1, verdict: 'edited' })]);
    writeAnchors([anchor('g.jsonl', 2, lineHash(lines[1]))]);
    assert.deepEqual(verifyAnchors({ dir: journals }), {
      state: 'ALARM',
      results: [{ file: 'g.jsonl', state: 'REWRITTEN', anchoredRecords: 2, records: 2 }],
      anchorChain: chain(0, 1),
    });
  });
});

test('uses the latest anchor per file and flags a deleted journal as JOURNAL-GONE', () => {
  withStore(({ journals, writeAnchors, writeJournal }) => {
    const lines = makeLines(1);
    writeJournal(journals, 'g.jsonl', lines);
    writeAnchors([anchor('g.jsonl', 5, 'stale'), anchor('gone.jsonl', 4, 'x'), anchor('g.jsonl', 1, lineHash(lines[0]))]);
    assert.deepEqual(verifyAnchors({ dir: journals }), {
      state: 'ALARM',
      results: [
        { file: 'g.jsonl', state: 'intact', anchoredRecords: 1, records: 1 },
        { file: 'gone.jsonl', state: 'JOURNAL-GONE', anchoredRecords: 4 },
      ],
      anchorChain: chain(0, 3),
    });
  });
});

test('flags unreadable when the anchored journal path is a directory', () => {
  withStore(({ journals, writeAnchors }) => {
    mkdirSync(join(journals, 'g.jsonl'));
    writeAnchors([anchor('g.jsonl', 2, 'x')]);
    assert.deepEqual(verifyAnchors({ dir: journals }), {
      state: 'ALARM',
      results: [{ file: 'g.jsonl', state: 'unreadable', anchoredRecords: 2 }],
      anchorChain: chain(0, 1),
    });
  });
});

test('reads journals from CW_VERDICT_DIR when no dir is given', () => {
  withStore(({ fallback, writeAnchors, writeJournal }) => {
    const lines = makeLines(1);
    writeJournal(fallback, 'g.jsonl', lines);
    writeAnchors([anchor('g.jsonl', 1, lineHash(lines[0]))]);
    assert.deepEqual(verifyAnchors(), {
      state: 'ok',
      results: [{ file: 'g.jsonl', state: 'intact', anchoredRecords: 1, records: 1 }],
      anchorChain: chain(0, 1),
    });
  });
});
