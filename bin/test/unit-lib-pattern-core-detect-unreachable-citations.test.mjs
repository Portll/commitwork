// Detects citations that resolve but are not contained by any branch (bin/lib/pattern-core.mjs detectUnreachableCitations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectUnreachableCitations } from '../lib/pattern-core.mjs';

test('skips dangling citations where resolution is missing', () => {
  const citations = [{ sha: 'a'.repeat(40), path: 'p', line: 1 }];
  const resolution = {};
  const r = detectUnreachableCitations({ citations, resolution });
  assert.deepEqual(r, { observations: [], undetermined: [], denominator: { unit: "citation", scanned: 1, skipped: [] } });
});

test('skips citations where resolves is false', () => {
  const citations = [{ sha: 'b'.repeat(40), path: 'p', line: 1 }];
  const resolution = { [citations[0].sha]: { resolves: false, containedBy: 0 } };
  const r = detectUnreachableCitations({ citations, resolution });
  assert.deepEqual(r, { observations: [], undetermined: [], denominator: { unit: "citation", scanned: 1, skipped: [] } });
});

test('emits undetermined observation when containedBy is null', () => {
  const sha = 'c'.repeat(40);
  const citations = [{ sha, path: 'p', line: 1 }];
  const resolution = { [sha]: { resolves: true, containedBy: null } };
  const r = detectUnreachableCitations({ citations, resolution });
  assert.deepEqual(r, { observations: [], undetermined: [{ identity: "p::sha:cccccccccccc::D2", detector: "unreachable-citation@1", classId: "D2", place: { path: "p", scope: "sha:cccccccccccc", line: 1, lineIsAdvisory: true }, evidence: { predicate: "containment was not determined for this citation \u2014 reachability is UNKNOWN, not confirmed", snippet: "cccccccccccc", redacted: 0, redactor: null }, confidence: "inferred" }], denominator: { unit: "citation", scanned: 1, skipped: [] } });
});

test('emits undetermined observation when containedBy is undefined', () => {
  const sha = 'd'.repeat(40);
  const citations = [{ sha, path: 'p', line: 1 }];
  const resolution = { [sha]: { resolves: true } };
  const r = detectUnreachableCitations({ citations, resolution });
  assert.deepEqual(r, { observations: [], undetermined: [{ identity: "p::sha:dddddddddddd::D2", detector: "unreachable-citation@1", classId: "D2", place: { path: "p", scope: "sha:dddddddddddd", line: 1, lineIsAdvisory: true }, evidence: { predicate: "containment was not determined for this citation \u2014 reachability is UNKNOWN, not confirmed", snippet: "dddddddddddd", redacted: 0, redactor: null }, confidence: "inferred" }], denominator: { unit: "citation", scanned: 1, skipped: [] } });
});

test('skips citations where containedBy is positive', () => {
  const sha = 'e'.repeat(40);
  const citations = [{ sha, path: 'p', line: 1 }];
  const resolution = { [sha]: { resolves: true, containedBy: 1 } };
  const r = detectUnreachableCitations({ citations, resolution });
  assert.deepEqual(r, { observations: [], undetermined: [], denominator: { unit: "citation", scanned: 1, skipped: [] } });
});

test('emits observation when containedBy is zero', () => {
  const sha = 'f'.repeat(40);
  const citations = [{ sha, path: 'p', line: 1 }];
  const resolution = { [sha]: { resolves: true, containedBy: 0 } };
  const r = detectUnreachableCitations({ citations, resolution });
  assert.deepEqual(r, { observations: [{ identity: "p::sha:ffffffffffff::D2", detector: "unreachable-citation@1", classId: "D2", place: { path: "p", scope: "sha:ffffffffffff", line: 1, lineIsAdvisory: true }, evidence: { predicate: "a cited SHA that rev-parse resolves and no branch contains \u2014 readable today, collectable at the next gc", snippet: "ffffffffffff", redacted: 0, redactor: null }, confidence: "structural" }], undetermined: [], denominator: { unit: "citation", scanned: 1, skipped: [] } });
});

test('emits observation when containedBy is negative', () => {
  const sha = 'g'.repeat(40);
  const citations = [{ sha, path: 'p', line: 1 }];
  const resolution = { [sha]: { resolves: true, containedBy: -1 } };
  const r = detectUnreachableCitations({ citations, resolution });
  assert.deepEqual(r, { observations: [{ identity: "p::sha:gggggggggggg::D2", detector: "unreachable-citation@1", classId: "D2", place: { path: "p", scope: "sha:gggggggggggg", line: 1, lineIsAdvisory: true }, evidence: { predicate: "a cited SHA that rev-parse resolves and no branch contains \u2014 readable today, collectable at the next gc", snippet: "gggggggggggg", redacted: 0, redactor: null }, confidence: "structural" }], undetermined: [], denominator: { unit: "citation", scanned: 1, skipped: [] } });
});

test('handles mixed citations with various resolution states', () => {
  const sha1 = 'a'.repeat(40);
  const sha2 = 'b'.repeat(40);
  const sha3 = 'c'.repeat(40);
  const sha4 = 'd'.repeat(40);
  const sha5 = 'e'.repeat(40);
  const sha6 = 'f'.repeat(40);
  const citations = [
    { sha: sha1, path: 'p1', line: 1 },
    { sha: sha2, path: 'p2', line: 2 },
    { sha: sha3, path: 'p3', line: 3 },
    { sha: sha4, path: 'p4', line: 4 },
    { sha: sha5, path: 'p5', line: 5 },
    { sha: sha6, path: 'p6', line: 6 },
  ];
  const resolution = {
    [sha1]: undefined,
    [sha2]: { resolves: false, containedBy: 0 },
    [sha3]: { resolves: true, containedBy: null },
    [sha4]: { resolves: true },
    [sha5]: { resolves: true, containedBy: 1 },
    [sha6]: { resolves: true, containedBy: 0 },
  };
  const r = detectUnreachableCitations({ citations, resolution });
  assert.deepEqual(r, { observations: [{ identity: "p6::sha:ffffffffffff::D2", detector: "unreachable-citation@1", classId: "D2", place: { path: "p6", scope: "sha:ffffffffffff", line: 6, lineIsAdvisory: true }, evidence: { predicate: "a cited SHA that rev-parse resolves and no branch contains \u2014 readable today, collectable at the next gc", snippet: "ffffffffffff", redacted: 0, redactor: null }, confidence: "structural" }], undetermined: [{ identity: "p3::sha:cccccccccccc::D2", detector: "unreachable-citation@1", classId: "D2", place: { path: "p3", scope: "sha:cccccccccccc", line: 3, lineIsAdvisory: true }, evidence: { predicate: "containment was not determined for this citation \u2014 reachability is UNKNOWN, not confirmed", snippet: "cccccccccccc", redacted: 0, redactor: null }, confidence: "inferred" }, { identity: "p4::sha:dddddddddddd::D2", detector: "unreachable-citation@1", classId: "D2", place: { path: "p4", scope: "sha:dddddddddddd", line: 4, lineIsAdvisory: true }, evidence: { predicate: "containment was not determined for this citation \u2014 reachability is UNKNOWN, not confirmed", snippet: "dddddddddddd", redacted: 0, redactor: null }, confidence: "inferred" }], denominator: { unit: "citation", scanned: 6, skipped: [] } });
});
