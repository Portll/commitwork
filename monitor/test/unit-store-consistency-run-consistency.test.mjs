// Cross-store consistency report: capped per-pair anomalies, totals and unknown pairs (monitor/store-consistency.mjs runConsistency).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runConsistency } from '../store-consistency.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const NOW = '2026-01-02T03:04:05.000Z';
process.env.CW_NOW = NOW;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const f = (n) => `${String(n).padStart(14, '0')}.json`;
const H = 'history-index\u2192slice';
const BK = 'issues.byKey\u2192issues';
const EV = 'issues.events\u2192issues';
const DP = 'issues.deps\u2192issues';
const zero = { orphan: 0, widow: 0, mismatch: 0 };
const NOT_IN = 'byKey names an issue id that is not in issues{}';
const WIDOW = 'slice file on disk that no index row names \u2014 an index trimmed without its payload';

test('with no history dirs and no issue store the report is empty and complete', () => {
  const result = runConsistency({});
  assert.deepEqual(result, { generated: NOW, pairsChecked: 0, pairsUnknown: 0, totals: zero, complete: true, unknownPairs: [], pairs: [] });
});

test('history anomalies sort by class then key and the cap counts what it drops', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runConsistency-'));
  try {
    writeFileSync(join(dir, 'index.json'), JSON.stringify([
      { file: f(1), sliceVersion: 1, sliceSha256: sha('one') },
      { file: f(2), sliceVersion: 1, sliceSha256: sha('gone'), sliceId: 's2' },
      { file: f(3), sliceVersion: 2, sliceSha256: sha('expected') },
    ]));
    writeFileSync(join(dir, f(1)), 'one');
    writeFileSync(join(dir, f(3)), 'actual');
    writeFileSync(join(dir, f(4)), '{}');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    const result = runConsistency({ historyDirs: [dir], cap: 2 });
    assert.deepEqual(result, {
      generated: NOW, pairsChecked: 1, pairsUnknown: 0, totals: { orphan: 1, widow: 1, mismatch: 1 }, complete: true, unknownPairs: [],
      pairs: [{
        pair: H, referrer: join(dir, 'index.json'), referrers: 3, referents: 3, prunedLegitimately: 0, legacyUndigested: 0,
        counts: { orphan: 1, widow: 1, mismatch: 1 }, truncated: 1, anomalies: [
          { class: 'mismatch', key: f(3), sliceId: null, detail: `sliceSha256 ${sha('expected').slice(0, 12)}\u2026 but the file hashes ${sha('actual').slice(0, 12)}\u2026` },
          { class: 'orphan', key: f(2), sliceId: 's2', detail: `index row pinned sliceSha256 ${sha('gone').slice(0, 12)}\u2026 and the slice file is not on disk` },
        ],
      }],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing slices that were pruned or never digested are counted and not reported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runConsistency-'));
  try {
    writeFileSync(join(dir, 'index.json'), JSON.stringify({ rows: [
      null, { file: 7 },
      { file: f(1), sliceVersion: 0, sliceSha256: sha('a') },
      { file: f(2), sliceVersion: 1 },
      { file: f(3), sliceVersion: 1, sliceSha256: '' },
    ] }));
    const result = runConsistency({ historyDirs: [dir] });
    assert.deepEqual(result, {
      generated: NOW, pairsChecked: 1, pairsUnknown: 0, totals: zero, complete: true, unknownPairs: [],
      pairs: [{ pair: H, referrer: join(dir, 'index.json'), referrers: 5, referents: 0, prunedLegitimately: 1, legacyUndigested: 2, counts: zero, anomalies: [], truncated: 0 }],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two history dirs keep their given order and their widow counts add up in the totals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runConsistency-'));
  try {
    const h1 = join(dir, 'a');
    const h2 = join(dir, 'b');
    for (const [h, n] of [[h1, 1], [h2, 2]]) {
      mkdirSync(h);
      writeFileSync(join(h, 'index.json'), '[]');
      writeFileSync(join(h, f(n)), '{}');
    }
    const result = runConsistency({ historyDirs: [h1, h2] });
    const pair = (h, n) => ({ pair: H, referrer: join(h, 'index.json'), referrers: 0, referents: 1, prunedLegitimately: 0, legacyUndigested: 0,
      counts: { orphan: 0, widow: 1, mismatch: 0 }, anomalies: [{ class: 'widow', key: f(n), sliceId: null, detail: WIDOW }], truncated: 0 });
    assert.deepEqual(result, {
      generated: NOW, pairsChecked: 2, pairsUnknown: 0, totals: { orphan: 0, widow: 2, mismatch: 0 }, complete: true, unknownPairs: [],
      pairs: [pair(h1, 1), pair(h2, 2)],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an absent issue store leaves all three issue pairs unknown and the report incomplete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runConsistency-'));
  try {
    const storePath = join(dir, 'issues.json');
    const result = runConsistency({ issueStorePath: storePath });
    assert.deepEqual(result, {
      generated: NOW, pairsChecked: 0, pairsUnknown: 3, totals: zero, complete: false, pairs: [],
      unknownPairs: [BK, EV, DP].map((pair) => ({ pair, unknownReason: 'absent', unknownDetail: storePath })),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a history dir without an index is a single unknown pair and the report is not complete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runConsistency-'));
  try {
    const hist = join(dir, 'missing');
    const result = runConsistency({ historyDirs: [hist] });
    assert.deepEqual(result, {
      generated: NOW, pairsChecked: 0, pairsUnknown: 1, totals: zero, complete: false, pairs: [],
      unknownPairs: [{ pair: H, unknownReason: 'absent', unknownDetail: join(hist, 'index.json') }],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('issue store pairs report key-map, event and link anomalies sorted by pair name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runConsistency-'));
  try {
    const storePath = join(dir, 'issues.json');
    writeFileSync(storePath, JSON.stringify({
      issues: {
        i1: { source: { key: 'k1' } },
        i2: { source: { key: 'k1' }, deps: { duplicateOf: 'i1' } },
        i3: { source: { key: 'k1' }, deps: { supersededBy: 'i9' } },
        i4: { source: {} },
        i5: { source: { key: 'k5' }, deps: { blockedBy: ['i1', 'gone'] } },
      },
      byKey: { k1: 'i1', k2: 'i8' },
      events: [...['i1', 'i2', 'i3', 'i4', 'ghost'].map((issueId) => ({ type: 'issue-opened', issueId })), { type: 'issue-closed', issueId: 'i5' }, null],
    }));
    const result = runConsistency({ issueStorePath: storePath });
    assert.deepEqual(result, {
      generated: NOW, pairsChecked: 3, pairsUnknown: 0, totals: { orphan: 4, widow: 3, mismatch: 0 }, complete: true, unknownPairs: [],
      pairs: [
        { pair: BK, referrer: 'byKey', referrers: 2, referents: 5, unkeyable: 1, resolvedDuplicates: 1, counts: { orphan: 1, widow: 2, mismatch: 0 }, truncated: 0, anomalies: [
          { class: 'orphan', key: 'k2', issueId: 'i8', detail: NOT_IN },
          { class: 'widow', key: 'k1', issueId: 'i3', detail: 'byKey maps this key to i1, and this issue does not defer to it' },
          { class: 'widow', key: 'k5', issueId: 'i5', detail: 'issue carries a source key that byKey does not map' },
        ] },
        { pair: DP, referrer: 'deps', referrers: 4, referents: 5, counts: { orphan: 2, widow: 0, mismatch: 0 }, truncated: 0, anomalies: [
          { class: 'orphan', key: 'i3.supersededBy', issueId: 'i3', detail: 'supersededBy names i9, which is not in issues{}' },
          { class: 'orphan', key: 'i5.blockedBy', issueId: 'i5', detail: 'blockedBy names gone, which is not in issues{}' },
        ] },
        { pair: EV, referrer: 'events[]', referrers: 7, referents: 5, counts: { orphan: 1, widow: 1, mismatch: 0 }, truncated: 0, anomalies: [
          { class: 'orphan', key: 'ghost', detail: 'the event log records this issue; issues{} does not contain it' },
          { class: 'widow', key: 'i5', detail: 'issue present in derived state with no issue-opened event \u2014 state without history' },
        ] },
      ],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a store without events leaves that pair unknown and a cap equal to the anomaly count drops nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runConsistency-'));
  try {
    const storePath = join(dir, 'issues.json');
    writeFileSync(storePath, JSON.stringify({ issues: { a: { source: { key: 'ka' } } }, byKey: { ka: 'a', kb: 'b', kc: 'c' } }));
    const result = runConsistency({ issueStorePath: storePath, cap: 2 });
    assert.deepEqual(result, {
      generated: NOW, pairsChecked: 2, pairsUnknown: 1, totals: { orphan: 2, widow: 0, mismatch: 0 }, complete: false,
      unknownPairs: [{ pair: EV, unknownReason: 'not-recorded', unknownDetail: 'no events[] array in the issue store' }],
      pairs: [
        { pair: BK, referrer: 'byKey', referrers: 3, referents: 1, unkeyable: 0, resolvedDuplicates: 0, counts: { orphan: 2, widow: 0, mismatch: 0 }, truncated: 0,
          anomalies: [{ class: 'orphan', key: 'kb', issueId: 'b', detail: NOT_IN }, { class: 'orphan', key: 'kc', issueId: 'c', detail: NOT_IN }] },
        { pair: DP, referrer: 'deps', referrers: 0, referents: 1, counts: zero, anomalies: [], truncated: 0 },
      ],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
