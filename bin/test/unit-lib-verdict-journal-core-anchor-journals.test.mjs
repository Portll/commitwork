// Appends one count and last-line-hash anchor per non-empty verdict journal to the anchor store (bin/lib/verdict-journal-core.mjs anchorJournals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorJournals } from '../lib/verdict-journal-core.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const rawAnchors = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean);
const anchorRecords = (p) => rawAnchors(p).map((l) => {
  const { at, ...rest } = JSON.parse(l);
  return rest;
});

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'anchorJournals-'));
  const saved = [process.env.CW_VERDICT_ANCHORS, process.env.CW_VERDICT_DIR];
  const ctx = { dir, anchors: join(dir, 'anchors.jsonl'), verdicts: join(dir, 'verdicts') };
  process.env.CW_VERDICT_ANCHORS = ctx.anchors;
  process.env.CW_VERDICT_DIR = join(dir, 'unused');
  try {
    mkdirSync(ctx.verdicts);
    fn(ctx);
  } finally {
    if (saved[0] === undefined) delete process.env.CW_VERDICT_ANCHORS;
    else process.env.CW_VERDICT_ANCHORS = saved[0];
    if (saved[1] === undefined) delete process.env.CW_VERDICT_DIR;
    else process.env.CW_VERDICT_DIR = saved[1];
    rmSync(dir, { recursive: true, force: true });
  }
}

test('anchors each non-empty jsonl journal in sorted order with its line count and last-line hash', () => {
  withTmp(({ anchors, verdicts }) => {
    writeFileSync(join(verdicts, 'b.jsonl'), 'b1\nb2\nb3\n');
    writeFileSync(join(verdicts, 'a.jsonl'), 'a1\na2\n');
    writeFileSync(join(verdicts, 'notes.txt'), 'n1\n');
    assert.deepEqual(anchorJournals({ dir: verdicts }), {
      anchored: [
        { file: 'a.jsonl', records: 2, ok: true },
        { file: 'b.jsonl', records: 3, ok: true },
      ],
    });
    const raw = rawAnchors(anchors);
    assert.deepEqual(anchorRecords(anchors), [
      { v: 1, kind: 'verdict-anchor', file: 'a.jsonl', records: 2, lastHash: h('a2'), prev: 'genesis' },
      { v: 1, kind: 'verdict-anchor', file: 'b.jsonl', records: 3, lastHash: h('b3'), prev: h(raw[0]) },
    ]);
  });
});

test('returns an empty anchored list with a note when the verdict directory does not exist', () => {
  withTmp(({ dir, anchors }) => {
    assert.deepEqual(anchorJournals({ dir: join(dir, 'missing') }), {
      anchored: [],
      note: 'no verdict directory \u2014 nothing to anchor',
    });
    assert.equal(existsSync(anchors), false);
  });
});

test('skips journals with no non-empty lines and anchors a one-line journal with records 1', () => {
  withTmp(({ anchors, verdicts }) => {
    writeFileSync(join(verdicts, 'blank.jsonl'), '\n\n');
    writeFileSync(join(verdicts, 'empty.jsonl'), '');
    writeFileSync(join(verdicts, 'solo.jsonl'), 'only');
    assert.deepEqual(anchorJournals({ dir: verdicts }), {
      anchored: [{ file: 'solo.jsonl', records: 1, ok: true }],
    });
    assert.deepEqual(anchorRecords(anchors), [
      { v: 1, kind: 'verdict-anchor', file: 'solo.jsonl', records: 1, lastHash: h('only'), prev: 'genesis' },
    ]);
  });
});

test('returns an empty anchored list and writes no anchor store when every journal is empty', () => {
  withTmp(({ anchors, verdicts }) => {
    writeFileSync(join(verdicts, 'empty.jsonl'), '');
    assert.deepEqual(anchorJournals({ dir: verdicts }), { anchored: [] });
    assert.equal(existsSync(anchors), false);
  });
});

test('falls back to the CW_VERDICT_DIR directory when no dir is given', () => {
  withTmp(({ anchors, verdicts }) => {
    process.env.CW_VERDICT_DIR = verdicts;
    writeFileSync(join(verdicts, 'g.jsonl'), 'x\ny\n');
    assert.deepEqual(anchorJournals(), {
      anchored: [{ file: 'g.jsonl', records: 2, ok: true }],
    });
    assert.deepEqual(anchorRecords(anchors), [
      { v: 1, kind: 'verdict-anchor', file: 'g.jsonl', records: 2, lastHash: h('y'), prev: 'genesis' },
    ]);
  });
});

test('rethrows a directory read error other than ENOENT such as ENOTDIR', () => {
  withTmp(({ dir }) => {
    const file = join(dir, 'plain.jsonl');
    writeFileSync(file, 'x\n');
    assert.throws(() => anchorJournals({ dir: file }), {
      name: 'Error',
      message: `ENOTDIR: not a directory, scandir '${file}'`,
    });
  });
});

test('re-anchoring after growth appends a new anchor chained to the previous one', () => {
  withTmp(({ anchors, verdicts }) => {
    const journalFile = join(verdicts, 'g.jsonl');
    writeFileSync(journalFile, 'r1\n');
    anchorJournals({ dir: verdicts });
    writeFileSync(journalFile, 'r1\nr2\n');
    assert.deepEqual(anchorJournals({ dir: verdicts }), {
      anchored: [{ file: 'g.jsonl', records: 2, ok: true }],
    });
    const raw = rawAnchors(anchors);
    assert.deepEqual(anchorRecords(anchors), [
      { v: 1, kind: 'verdict-anchor', file: 'g.jsonl', records: 1, lastHash: h('r1'), prev: 'genesis' },
      { v: 1, kind: 'verdict-anchor', file: 'g.jsonl', records: 2, lastHash: h('r2'), prev: h(raw[0]) },
    ]);
  });
});
