// The verified ledger chain of one gate's journal: records, chain tallies, rotations and breaks (bin/lib/verdict-journal-core.mjs readJournal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJournal } from '../lib/verdict-journal-core.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REC = { v: 1, gate: 'gate-tests', at: '2024-01-01T00:00:00Z', pid: 1, session: null, prev: 'genesis', verdict: 'pass' };

const ABSENT = {
  absent: true,
  records: [],
  torn: 0,
  chain: { verified: 0, broken: 0, raced: 0, unchained: 0, unlinked: 0, renumbered: 0, examined: 0 },
  rotations: 0,
  breaks: [],
  renumberings: [],
  gaps: [],
  state: 'absent',
};

const ONE = {
  absent: false,
  records: [REC],
  torn: 0,
  chain: { verified: 1, broken: 0, raced: 0, unchained: 0, unlinked: 0, renumbered: 0, examined: 1 },
  rotations: 0,
  breaks: [],
  renumberings: [],
  gaps: [],
  state: 'ok',
};

const writeLive = (d) => writeFileSync(join(d, 'gate-tests.jsonl'), JSON.stringify(REC) + '\n');

const run = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'readJournal-'));
  const saved = process.env.CW_VERDICT_DIR;
  try {
    return fn(dir);
  } finally {
    if (saved === undefined) delete process.env.CW_VERDICT_DIR;
    else process.env.CW_VERDICT_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  }
};

test('an empty directory reports the journal absent with zeroed tallies', () => {
  run((dir) => {
    assert.deepEqual(readJournal('gate-tests', { dir }), ABSENT);
  });
});

test('a single genesis record verifies once and reports state ok', () => {
  run((dir) => {
    writeLive(dir);
    assert.deepEqual(readJournal('gate-tests', { dir }), ONE);
  });
});

test('the live file alone counts as zero rotations', () => {
  run((dir) => {
    writeLive(dir);
    assert.equal(readJournal('gate-tests', { dir }).rotations, 0);
  });
});

test('the records array holds the parsed line from the live file', () => {
  run((dir) => {
    writeLive(dir);
    assert.deepEqual(readJournal('gate-tests', { dir }).records, [REC]);
  });
});

test('a gate whose file is missing is absent even when another gate file exists', () => {
  run((dir) => {
    writeLive(dir);
    assert.deepEqual(readJournal('other-gate', { dir }), ABSENT);
  });
});

test('without a dir option the journal is read from CW_VERDICT_DIR', () => {
  run((dir) => {
    writeLive(dir);
    process.env.CW_VERDICT_DIR = dir;
    assert.deepEqual(readJournal('gate-tests'), ONE);
  });
});

test('an explicit dir is read instead of an empty CW_VERDICT_DIR', () => {
  run((dir) => {
    const live = join(dir, 'live');
    const env = join(dir, 'env');
    mkdirSync(live);
    mkdirSync(env);
    writeLive(live);
    process.env.CW_VERDICT_DIR = env;
    assert.deepEqual(readJournal('gate-tests', { dir: live }), ONE);
  });
});

test('an explicit empty dir is absent even when CW_VERDICT_DIR holds the journal', () => {
  run((dir) => {
    const live = join(dir, 'live');
    const env = join(dir, 'env');
    mkdirSync(live);
    mkdirSync(env);
    writeLive(env);
    process.env.CW_VERDICT_DIR = env;
    assert.deepEqual(readJournal('gate-tests', { dir: live }), ABSENT);
  });
});
