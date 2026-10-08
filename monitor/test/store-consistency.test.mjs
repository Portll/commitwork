// node --test monitor/test/ — store-consistency.mjs: referential integrity across commitwork's own
// stores. The three classes are distinct and each is REACHABLE; an unreadable store is unknown and
// never zero anomalies; a pair never reports a class it did not declare; pruned v0 slices stay
// silent; caps are counted, never dropped.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLASS, PAIR_CLASSES, readJsonStore, checkHistoryIndex, checkIssueKeyMap,
  checkIssueEvents, checkIssueLinks, runConsistency,
} from '../store-consistency.mjs';
import { isUnknown } from '../unknown.mjs';

const withTmp = (fn) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-consist-'));
  try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
};

const sha = (s) => createHash('sha256').update(s).digest('hex');

/** A history dir with one v1 slice whose digest is recorded correctly. */
function seedHistory(dir, { rows, files }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.json'), JSON.stringify(rows, null, 1));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
}

const sliceBody = JSON.stringify({ findings: [] });

describe('readJsonStore — absence, unreadability and corruption are three different states', () => {
  test('ENOENT is absent, and absent alone', () => {
    const r = readJsonStore(join(tmpdir(), 'cw-consist-nope-nope', 'x.json'));
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'absent');
  });

  test('a corrupt store is unparseable — NEVER an empty object', () => withTmp((d) => {
    const p = join(d, 'broken.json');
    writeFileSync(p, '{"issues": {');
    const r = readJsonStore(p);
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'unparseable');
    assert.equal(r.ok, undefined, 'a corrupt store must not present as a readable one');
  }));

  test('an empty file is `empty`, not `unparseable` — a run killed on its first syscall leaves this', () => withTmp((d) => {
    const p = join(d, 'zero.json');
    writeFileSync(p, '');
    assert.equal(readJsonStore(p).unknownReason, 'empty');
  }));
});

describe('P1 history index → slices: all three classes are reachable', () => {
  test('a consistent pair reports nothing', () => withTmp((d) => {
    const h = join(d, 'history');
    seedHistory(h, {
      rows: [{ file: '20260101000000.json', sliceId: 'sweep-a', sliceVersion: 1, sliceSha256: sha(sliceBody) }],
      files: { '20260101000000.json': sliceBody },
    });
    const r = checkHistoryIndex(h);
    assert.equal(r.ok, true);
    assert.deepEqual(r.anomalies, []);
  }));

  test('ORPHAN — a DIGESTED row naming a file that is not on disk', () => withTmp((d) => {
    const h = join(d, 'history');
    seedHistory(h, {
      rows: [{ file: '20260101000000.json', sliceId: 'sweep-a', sliceVersion: 1, sliceSha256: sha(sliceBody) }],
      files: {},
    });
    const r = checkHistoryIndex(h);
    assert.equal(r.anomalies.length, 1);
    assert.equal(r.anomalies[0].class, CLASS.ORPHAN);
  }));

  test('a v1 row with NO digest is LEGACY, not an orphan — it never asserted the bytes were durable', () => withTmp((d) => {
    const h = join(d, 'history');
    seedHistory(h, { rows: [{ file: '20260101000000.json', sliceId: 'sweep-a', sliceVersion: 1 }], files: {} });
    const r = checkHistoryIndex(h);
    assert.deepEqual(r.anomalies, [], 'the live client-a index carries two of these and they are not defects');
    assert.equal(r.legacyUndigested, 1, 'and it is counted, so the denominator does not quietly shrink');
  }));

  test('a PRUNED v0 slice is silent — documented retention, not a broken pointer', () => withTmp((d) => {
    const h = join(d, 'history');
    seedHistory(h, { rows: [{ file: '20260101000000.json', sliceId: 'sweep-a' }], files: {} });
    const r = checkHistoryIndex(h);
    assert.deepEqual(r.anomalies, [], 'pruned v0 slices must not be reported as orphans');
    assert.equal(r.prunedLegitimately, 1, 'and the count must still be published, so the denominator is honest');
  }));

  test('WIDOW — the ZLIVEUSAGE case: payload on disk that the index no longer names', () => withTmp((d) => {
    const h = join(d, 'history');
    seedHistory(h, { rows: [], files: { '20260101000000.json': sliceBody } });
    const r = checkHistoryIndex(h);
    assert.equal(r.anomalies.length, 1);
    assert.equal(r.anomalies[0].class, CLASS.WIDOW);
    assert.match(r.anomalies[0].detail, /index trimmed without its payload/);
  }));

  test('a forward-only walk would MISS the widow — which is why both directions are checked', () => withTmp((d) => {
    const h = join(d, 'history');
    // Every pointer in the index resolves. Walking pointers finds nothing at all.
    seedHistory(h, {
      rows: [{ file: '20260101000000.json', sliceId: 'a', sliceVersion: 1, sliceSha256: sha(sliceBody) }],
      files: { '20260101000000.json': sliceBody, '20260102000000.json': sliceBody },
    });
    const r = checkHistoryIndex(h);
    assert.equal(r.anomalies.filter((a) => a.class === CLASS.ORPHAN).length, 0);
    assert.equal(r.anomalies.filter((a) => a.class === CLASS.WIDOW).length, 1);
  }));

  test('MISMATCH — both ends present, digests disagree (edited in place, nothing deleted)', () => withTmp((d) => {
    const h = join(d, 'history');
    seedHistory(h, {
      rows: [{ file: '20260101000000.json', sliceId: 'a', sliceVersion: 1, sliceSha256: sha(sliceBody) }],
      files: { '20260101000000.json': JSON.stringify({ findings: [{ id: 'planted' }] }) },
    });
    const r = checkHistoryIndex(h);
    assert.equal(r.anomalies.length, 1);
    assert.equal(r.anomalies[0].class, CLASS.MISMATCH);
  }));

  test('an unreadable index is unknown — never a clean pair', () => withTmp((d) => {
    const h = join(d, 'history');
    mkdirSync(h, { recursive: true });
    writeFileSync(join(h, 'index.json'), 'not json at all');
    const r = checkHistoryIndex(h);
    assert.equal(isUnknown(r), true);
    assert.equal(r.ok, undefined);
    assert.equal(r.anomalies, undefined, 'an unknown pair must not present an empty anomaly list');
  }));
});

describe('P2 byKey → issues', () => {
  const store = (issues, byKey) => ({ issues, byKey });

  test('ORPHAN — byKey points at an issue id that is gone', () => {
    const r = checkIssueKeyMap(store({}, { 'sc:a|t|r|f': 'ISS-1' }));
    assert.equal(r.anomalies.length, 1);
    assert.equal(r.anomalies[0].class, CLASS.ORPHAN);
  });

  test('WIDOW — an issue carrying a source key the map does not hold', () => {
    const r = checkIssueKeyMap(store({ 'ISS-1': { source: { key: 'sc:a|t|r|f' } } }, {}));
    assert.equal(r.anomalies.length, 1);
    assert.equal(r.anomalies[0].class, CLASS.WIDOW);
  });

  test('a null source key is UNKEYABLE, not a widow — manual issues are legitimately unmapped', () => {
    const r = checkIssueKeyMap(store({ 'ISS-1': { source: { key: null } } }, {}));
    assert.deepEqual(r.anomalies, []);
    assert.equal(r.unkeyable, 1);
  });

  test('a key mapped to the WRONG issue is a widow that names both', () => {
    const r = checkIssueKeyMap(store(
      { 'ISS-1': { source: { key: 'k' }, deps: {} }, 'ISS-2': { source: { key: null } } },
      { k: 'ISS-2' },
    ));
    assert.equal(r.anomalies.length, 1);
    assert.match(r.anomalies[0].detail, /maps this key to ISS-2/);
  });

  test('a loser that DEFERS to the key holder is a resolved duplicate, not a widow', () => {
    // The live shape: ISS-PERSONAL-S-000042/43 -> duplicateOf ISS-000001, which holds the key.
    const r = checkIssueKeyMap(store({
      'ISS-1': { source: { key: 'k' }, deps: {} },
      'ISS-42': { source: { key: 'k' }, deps: { duplicateOf: 'ISS-1' } },
      'ISS-43': { source: { key: 'k' }, deps: { supersededBy: 'ISS-1' } },
    }, { k: 'ISS-1' }));
    assert.deepEqual(r.anomalies, []);
    assert.equal(r.resolvedDuplicates, 2);
  });

  test('a loser deferring to SOMEONE ELSE is still a widow — the exemption is narrow on purpose', () => {
    const r = checkIssueKeyMap(store({
      'ISS-1': { source: { key: 'k' }, deps: {} },
      'ISS-42': { source: { key: 'k' }, deps: { duplicateOf: 'ISS-99' } },
    }, { k: 'ISS-1' }));
    assert.equal(r.anomalies.length, 1);
    assert.equal(r.anomalies[0].issueId, 'ISS-42');
  });
});

describe('P3 events → issues: state without history is the ZPROCESS/ZLIVEUSAGE signature', () => {
  test('a fully derived store is consistent', () => {
    const r = checkIssueEvents({
      issues: { 'ISS-1': {} },
      events: [{ type: 'issue-opened', issueId: 'ISS-1' }],
    });
    assert.deepEqual(r.anomalies, []);
  });

  test('WIDOW — an issue in state with no opening event', () => {
    const r = checkIssueEvents({ issues: { 'ISS-1': {}, 'ISS-2': {} }, events: [{ type: 'issue-opened', issueId: 'ISS-1' }] });
    const widows = r.anomalies.filter((a) => a.class === CLASS.WIDOW);
    assert.equal(widows.length, 1);
    assert.equal(widows[0].key, 'ISS-2');
  });

  test('ORPHAN — the log remembers an issue the state does not', () => {
    const r = checkIssueEvents({ issues: {}, events: [{ type: 'issue-opened', issueId: 'ISS-9' }] });
    assert.equal(r.anomalies.filter((a) => a.class === CLASS.ORPHAN).length, 1);
  });

  test('a store with NO events array is unknown, not consistent — an absent log proves nothing', () => {
    const r = checkIssueEvents({ issues: { 'ISS-1': {} } });
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'not-recorded');
  });
});

describe('P4 issue links', () => {
  test('ORPHAN — duplicateOf into a hole', () => {
    const r = checkIssueLinks({ issues: { 'ISS-1': { deps: { duplicateOf: 'ISS-404' } } } });
    assert.equal(r.anomalies.length, 1);
    assert.equal(r.anomalies[0].class, CLASS.ORPHAN);
  });

  test('an issue nothing links to is NOT a widow — that is the normal case', () => {
    const r = checkIssueLinks({ issues: { 'ISS-1': { deps: {} }, 'ISS-2': { deps: {} } } });
    assert.deepEqual(r.anomalies, []);
  });

  test('every blockedBy entry is followed, not just the first', () => {
    const r = checkIssueLinks({ issues: { 'ISS-1': { deps: { blockedBy: ['ISS-404', 'ISS-405'] } } } });
    assert.equal(r.anomalies.length, 2);
  });
});

describe('no pair reports a class it did not declare', () => {
  test('the declared table covers every pair the sweep can emit, and bounds it', () => withTmp((d) => {
    const h = join(d, 'history');
    seedHistory(h, {
      rows: [{ file: '20260101000000.json', sliceId: 'a', sliceVersion: 1, sliceSha256: 'deadbeef' }],
      files: { '20260101000000.json': sliceBody, '20260102000000.json': sliceBody },
    });
    const store = join(d, 'issues.json');
    writeFileSync(store, JSON.stringify({
      issues: { 'ISS-1': { source: { key: 'k' }, deps: { duplicateOf: 'ISS-404' } } },
      byKey: { other: 'ISS-9' },
      events: [{ type: 'issue-opened', issueId: 'ISS-8' }],
    }));

    const report = runConsistency({ issueStorePath: store, historyDirs: [h] });
    assert.equal(report.pairsChecked, 4);
    for (const p of report.pairs) {
      const allowed = PAIR_CLASSES[p.pair];
      assert.ok(allowed, `pair ${p.pair} has no PAIR_CLASSES entry`);
      for (const a of p.anomalies) {
        assert.ok(allowed.includes(a.class), `${p.pair} emitted ${a.class}, which it does not declare`);
      }
    }
  }));
});

describe('the sweep fails closed and states its own completeness', () => {
  test('an unreadable issue store makes THREE pairs unknown, and the run incomplete', () => withTmp((d) => {
    const store = join(d, 'issues.json');
    writeFileSync(store, '{{{');
    const report = runConsistency({ issueStorePath: store, historyDirs: [] });
    assert.equal(report.pairsChecked, 0);
    assert.equal(report.pairsUnknown, 3);
    assert.equal(report.complete, false, 'a run that could read nothing must never report complete');
    assert.deepEqual(report.totals, { orphan: 0, widow: 0, mismatch: 0 });
  }));

  test('zero totals mean something ONLY when complete is true — the two travel together', () => withTmp((d) => {
    const store = join(d, 'issues.json');
    writeFileSync(store, JSON.stringify({ issues: {}, byKey: {}, events: [] }));
    const report = runConsistency({ issueStorePath: store, historyDirs: [] });
    assert.deepEqual(report.totals, { orphan: 0, widow: 0, mismatch: 0 });
    assert.equal(report.complete, true);
  }));

  test('a missing history dir is unknown-absent, not an empty consistent pair', () => {
    const report = runConsistency({ historyDirs: [join(tmpdir(), 'cw-consist-absent-dir')] });
    assert.equal(report.pairsChecked, 0);
    assert.equal(report.pairsUnknown, 1);
    assert.equal(report.unknownPairs[0].unknownReason, 'absent');
  });
});

describe('caps are counted, never silent', () => {
  test('the cap bounds what is ENUMERATED and the count stays whole', () => withTmp((d) => {
    const issues = {};
    for (let i = 0; i < 30; i += 1) issues[`ISS-${i}`] = { source: { key: null }, deps: { duplicateOf: 'ISS-404' } };
    const store = join(d, 'issues.json');
    writeFileSync(store, JSON.stringify({ issues, byKey: {}, events: Object.keys(issues).map((id) => ({ type: 'issue-opened', issueId: id })) }));

    const report = runConsistency({ issueStorePath: store, historyDirs: [], cap: 5 });
    const links = report.pairs.find((p) => p.pair === 'issues.deps→issues');
    assert.equal(links.counts.orphan, 30, 'the COUNT is the whole population');
    assert.equal(links.anomalies.length, 5, 'the enumeration is capped');
    assert.equal(links.truncated, 25, 'and the remainder is stated, not dropped');
    assert.equal(report.totals.orphan, 30);
  }));
});

describe('determinism', () => {
  test('two runs over identical inputs are byte-identical under CW_NOW', () => withTmp((d) => {
    const store = join(d, 'issues.json');
    writeFileSync(store, JSON.stringify({
      issues: { 'ISS-2': { source: { key: null }, deps: {} }, 'ISS-1': { source: { key: null }, deps: {} } },
      byKey: {}, events: [],
    }));
    process.env.CW_NOW = '2026-08-26T00:00:00.000Z';
    try {
      const a = JSON.stringify(runConsistency({ issueStorePath: store, historyDirs: [] }));
      const b = JSON.stringify(runConsistency({ issueStorePath: store, historyDirs: [] }));
      assert.equal(a, b);
      assert.match(a, /2026-08-26T00:00:00.000Z/);
    } finally { delete process.env.CW_NOW; }
  }));
});
