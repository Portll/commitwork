// Detects untracked files under durable roots or referenced by tracked sources (bin/lib/pattern-core.mjs detectUntrackedDurable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectUntrackedDurable } from '../lib/pattern-core.mjs';

test('returns empty observations when no untracked paths are provided', () => {
  const r = detectUntrackedDurable({ untrackedPaths: [], durableRoots: ['data'], referencedPaths: [] });
  assert.deepEqual(r, { observations: [], undetermined: [], denominator: { unit: "untracked-file", scanned: 0, basis: { declaredRoots: ["data"], referencedByTrackedSource: 0 }, skipped: [] } });
});

test('includes file matching durable root exactly', () => {
  const r = detectUntrackedDurable({ untrackedPaths: ['data'], durableRoots: ['data'], referencedPaths: [] });
  assert.deepEqual(r, { observations: [{ identity: "data::<file>::D6", detector: "untracked-durable-record@1", classId: "D6", place: { path: "data", scope: "<file>", line: null, lineIsAdvisory: true }, evidence: { predicate: "a file under a declared durable-record path that git does not track \u2014 it exists in exactly one working tree", snippet: "data", redacted: 0, redactor: null }, confidence: "structural", extra: { basis: "declared-root" } }], undetermined: [], denominator: { unit: "untracked-file", scanned: 1, basis: { declaredRoots: ["data"], referencedByTrackedSource: 0 }, skipped: [] } });
});

test('includes file under durable root subdirectory', () => {
  const r = detectUntrackedDurable({ untrackedPaths: ['data/sub/file.txt'], durableRoots: ['data'], referencedPaths: [] });
  assert.deepEqual(r, { observations: [{ identity: "data/sub/file.txt::<file>::D6", detector: "untracked-durable-record@1", classId: "D6", place: { path: "data/sub/file.txt", scope: "<file>", line: null, lineIsAdvisory: true }, evidence: { predicate: "a file under a declared durable-record path that git does not track \u2014 it exists in exactly one working tree", snippet: "data/sub/file.txt", redacted: 0, redactor: null }, confidence: "structural", extra: { basis: "declared-root" } }], undetermined: [], denominator: { unit: "untracked-file", scanned: 1, basis: { declaredRoots: ["data"], referencedByTrackedSource: 0 }, skipped: [] } });
});

test('excludes file under similar prefix not matching root boundary', () => {
  const r = detectUntrackedDurable({ untrackedPaths: ['data2/file.txt'], durableRoots: ['data'], referencedPaths: [] });
  assert.deepEqual(r, { observations: [], undetermined: [], denominator: { unit: "untracked-file", scanned: 1, basis: { declaredRoots: ["data"], referencedByTrackedSource: 0 }, skipped: [] } });
});

test('includes file referenced by tracked source but not under root', () => {
  const r = detectUntrackedDurable({ untrackedPaths: ['config.yaml'], durableRoots: ['data'], referencedPaths: ['config.yaml'] });
  assert.deepEqual(r, { observations: [{ identity: "config.yaml::<file>::D6", detector: "untracked-durable-record@1", classId: "D6", place: { path: "config.yaml", scope: "<file>", line: null, lineIsAdvisory: true }, evidence: { predicate: "tracked source reads this path and git does not track the file \u2014 the repo depends on a record that exists in exactly one working tree, where `git clean` and `git checkout <path>` are named hazards", snippet: "config.yaml", redacted: 0, redactor: null }, confidence: "structural", extra: { basis: "referenced-by-tracked-source" } }], undetermined: [], denominator: { unit: "untracked-file", scanned: 1, basis: { declaredRoots: ["data"], referencedByTrackedSource: 1 }, skipped: [] } });
});

test('includes file both under root and referenced by tracked source', () => {
  const r = detectUntrackedDurable({ untrackedPaths: ['data/rec.bin'], durableRoots: ['data'], referencedPaths: ['data/rec.bin'] });
  assert.deepEqual(r, { observations: [{ identity: "data/rec.bin::<file>::D6", detector: "untracked-durable-record@1", classId: "D6", place: { path: "data/rec.bin", scope: "<file>", line: null, lineIsAdvisory: true }, evidence: { predicate: "tracked source reads this path and git does not track the file \u2014 the repo depends on a record that exists in exactly one working tree, where `git clean` and `git checkout <path>` are named hazards", snippet: "data/rec.bin", redacted: 0, redactor: null }, confidence: "structural", extra: { basis: "referenced+root" } }], undetermined: [], denominator: { unit: "untracked-file", scanned: 1, basis: { declaredRoots: ["data"], referencedByTrackedSource: 1 }, skipped: [] } });
});

test('excludes file neither under root nor referenced', () => {
  const r = detectUntrackedDurable({ untrackedPaths: ['temp.txt'], durableRoots: ['data'], referencedPaths: ['other.txt'] });
  assert.deepEqual(r, { observations: [], undetermined: [], denominator: { unit: "untracked-file", scanned: 1, basis: { declaredRoots: ["data"], referencedByTrackedSource: 1 }, skipped: [] } });
});

test('handles multiple untracked paths with mixed inclusion criteria', () => {
  const r = detectUntrackedDurable({ untrackedPaths: ['data/a', 'data/b', 'x/y', 'z'], durableRoots: ['data'], referencedPaths: ['x/y'] });
  assert.deepEqual(r, { observations: [{ identity: "data/a::<file>::D6", detector: "untracked-durable-record@1", classId: "D6", place: { path: "data/a", scope: "<file>", line: null, lineIsAdvisory: true }, evidence: { predicate: "a file under a declared durable-record path that git does not track \u2014 it exists in exactly one working tree", snippet: "data/a", redacted: 0, redactor: null }, confidence: "structural", extra: { basis: "declared-root" } }, { identity: "data/b::<file>::D6", detector: "untracked-durable-record@1", classId: "D6", place: { path: "data/b", scope: "<file>", line: null, lineIsAdvisory: true }, evidence: { predicate: "a file under a declared durable-record path that git does not track \u2014 it exists in exactly one working tree", snippet: "data/b", redacted: 0, redactor: null }, confidence: "structural", extra: { basis: "declared-root" } }, { identity: "x/y::<file>::D6", detector: "untracked-durable-record@1", classId: "D6", place: { path: "x/y", scope: "<file>", line: null, lineIsAdvisory: true }, evidence: { predicate: "tracked source reads this path and git does not track the file \u2014 the repo depends on a record that exists in exactly one working tree, where `git clean` and `git checkout <path>` are named hazards", snippet: "x/y", redacted: 0, redactor: null }, confidence: "structural", extra: { basis: "referenced-by-tracked-source" } }], undetermined: [], denominator: { unit: "untracked-file", scanned: 4, basis: { declaredRoots: ["data"], referencedByTrackedSource: 1 }, skipped: [] } });
});
