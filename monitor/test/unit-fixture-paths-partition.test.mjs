// Splits findings into kept and fixture buckets with a per-pattern report (monitor/fixture-paths.mjs partition).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partition } from '../fixture-paths.mjs';

test('uses the file property when present and ignores path and uri', () => {
  const rows = [{ file: 'src/lib.js', path: 'test/fixtures/a.js', uri: 'test/fixtures/b.js' }];
  assert.deepEqual(partition(rows), { kept: [{ file: "src/lib.js", path: "test/fixtures/a.js", uri: "test/fixtures/b.js" }], fixtures: [], report: { enabled: true, total: 1, inFixtures: 0, byPattern: {}, note: "" } });
});

test('falls back to path when file is missing and ignores uri', () => {
  const rows = [{ path: 'test/fixtures/a.js', uri: 'src/lib.js' }];
  assert.deepEqual(partition(rows), { kept: [], fixtures: [{ path: "test/fixtures/a.js", uri: "src/lib.js", fixture: true, fixturePattern: "test/\u2026/fixtures" }], report: { enabled: true, total: 1, inFixtures: 1, byPattern: { "test/\u2026/fixtures": 1 }, note: "1 of 1 findings are under a test-fixture path and are excluded from headline totals. They are NOT discarded: each keeps its severity and carries fixture: true with the pattern that matched. Set CW_FIXTURE_PATHS=off to count them." } });
});

test('falls back to uri when file and path are missing', () => {
  const rows = [{ uri: 'test/fixtures/a.js' }];
  assert.deepEqual(partition(rows), { kept: [], fixtures: [{ uri: "test/fixtures/a.js", fixture: true, fixturePattern: "test/\u2026/fixtures" }], report: { enabled: true, total: 1, inFixtures: 1, byPattern: { "test/\u2026/fixtures": 1 }, note: "1 of 1 findings are under a test-fixture path and are excluded from headline totals. They are NOT discarded: each keeps its severity and carries fixture: true with the pattern that matched. Set CW_FIXTURE_PATHS=off to count them." } });
});

test('keeps rows that have no path-like property at all', () => {
  const rows = [{ name: 'no-path' }];
  assert.deepEqual(partition(rows), { kept: [{ name: "no-path" }], fixtures: [], report: { enabled: true, total: 1, inFixtures: 0, byPattern: {}, note: "" } });
});

test('keeps rows that are not under a fixture path', () => {
  const rows = [{ file: 'src/app.js' }];
  assert.deepEqual(partition(rows), { kept: [{ file: "src/app.js" }], fixtures: [], report: { enabled: true, total: 1, inFixtures: 0, byPattern: {}, note: "" } });
});

test('moves a row under a test fixture directory into the fixture bucket', () => {
  const rows = [{ file: 'test/fixtures/data.json', severity: 'high' }];
  assert.deepEqual(partition(rows), { kept: [], fixtures: [{ file: "test/fixtures/data.json", severity: "high", fixture: true, fixturePattern: "test/\u2026/fixtures" }], report: { enabled: true, total: 1, inFixtures: 1, byPattern: { "test/\u2026/fixtures": 1 }, note: "1 of 1 findings are under a test-fixture path and are excluded from headline totals. They are NOT discarded: each keeps its severity and carries fixture: true with the pattern that matched. Set CW_FIXTURE_PATHS=off to count them." } });
});

test('moves a row under an unambiguous testdata directory into the fixture bucket', () => {
  const rows = [{ file: 'testdata/input.txt' }];
  assert.deepEqual(partition(rows), { kept: [], fixtures: [{ file: "testdata/input.txt", fixture: true, fixturePattern: "testdata" }], report: { enabled: true, total: 1, inFixtures: 1, byPattern: { testdata: 1 }, note: "1 of 1 findings are under a test-fixture path and are excluded from headline totals. They are NOT discarded: each keeps its severity and carries fixture: true with the pattern that matched. Set CW_FIXTURE_PATHS=off to count them." } });
});

test('moves a row with a golden file marker into the fixture bucket', () => {
  const rows = [{ file: 'src/output.golden' }];
  assert.deepEqual(partition(rows), { kept: [], fixtures: [{ file: "src/output.golden", fixture: true, fixturePattern: "*.golden" }], report: { enabled: true, total: 1, inFixtures: 1, byPattern: { "*.golden": 1 }, note: "1 of 1 findings are under a test-fixture path and are excluded from headline totals. They are NOT discarded: each keeps its severity and carries fixture: true with the pattern that matched. Set CW_FIXTURE_PATHS=off to count them." } });
});

test('counts each fixture pattern correctly when multiple rows share it', () => {
  const rows = [
    { file: 'test/fixtures/a.json' },
    { file: 'test/fixtures/b.json' },
    { file: 'src/c.js' },
  ];
  assert.deepEqual(partition(rows), { kept: [{ file: "src/c.js" }], fixtures: [{ file: "test/fixtures/a.json", fixture: true, fixturePattern: "test/\u2026/fixtures" }, { file: "test/fixtures/b.json", fixture: true, fixturePattern: "test/\u2026/fixtures" }], report: { enabled: true, total: 3, inFixtures: 2, byPattern: { "test/\u2026/fixtures": 2 }, note: "2 of 3 findings are under a test-fixture path and are excluded from headline totals. They are NOT discarded: each keeps its severity and carries fixture: true with the pattern that matched. Set CW_FIXTURE_PATHS=off to count them." } });
});

test('handles an empty rows array and a null rows argument', () => {
  assert.deepEqual(partition([]), { kept: [], fixtures: [], report: { enabled: true, total: 0, inFixtures: 0, byPattern: {}, note: "" } });
  assert.deepEqual(partition(null), { kept: [], fixtures: [], report: { enabled: true, total: 0, inFixtures: 0, byPattern: {}, note: "" } });
});
