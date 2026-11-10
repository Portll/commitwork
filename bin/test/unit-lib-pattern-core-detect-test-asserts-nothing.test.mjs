// Detects test declarations whose bodies contain no assertions (bin/lib/pattern-core.mjs detectTestAssertsNothing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTestAssertsNothing } from '../lib/pattern-core.mjs';

test('returns an empty array when the path does not end with .test.mjs', () => {
  const r = detectTestAssertsNothing({ rel: 'src/foo.js', src: 'test("a", () => {})', stripped: 'test("a", () => {})' });
  assert.deepEqual(r, []);
});

test('returns an empty array when the source contains no test call', () => {
  const r = detectTestAssertsNothing({ rel: 'a.test.mjs', src: 'const x = 1;', stripped: 'const x = 1;' });
  assert.deepEqual(r, []);
});

test('returns an observation for a test body that contains no assertion', () => {
  const r = detectTestAssertsNothing({ rel: 'a.test.mjs', src: 'test("t", () => { console.log(1); })', stripped: 'test("t", () => { console.log(1); })' });
  assert.deepEqual(r, [{ identity: "a.test.mjs::test:t::R1", detector: "test-asserts-nothing@1", classId: "R1", place: { path: "a.test.mjs", scope: "test:t", line: 1, lineIsAdvisory: true }, evidence: { predicate: "a test body contains no assertion, so it reports pass on every input", snippet: "test(\"t\", () => { console.log(1); })", redacted: 0, redactor: null }, confidence: "heuristic" }]);
});

test('returns an empty array when the test body contains an assertion', () => {
  const r = detectTestAssertsNothing({ rel: 'a.test.mjs', src: 'test("t", () => { assert.ok(1); })', stripped: 'test("t", () => { assert.ok(1); })' });
  assert.deepEqual(r, []);
});

test('returns an observation with heuristic confidence when the body delegates to a helper', () => {
  const r = detectTestAssertsNothing({ rel: 'a.test.mjs', src: 'test("t", () => { helper(); })', stripped: 'test("t", () => { helper(); })' });
  assert.deepEqual(r, [{ identity: "a.test.mjs::test:t::R1", detector: "test-asserts-nothing@1", classId: "R1", place: { path: "a.test.mjs", scope: "test:t", line: 1, lineIsAdvisory: true }, evidence: { predicate: "a test body contains no assertion, so it reports pass on every input", snippet: "test(\"t\", () => { helper(); })", redacted: 0, redactor: null }, confidence: "heuristic" }]);
});

test('returns an observation with structural confidence when the body has no function call', () => {
  const r = detectTestAssertsNothing({ rel: 'a.test.mjs', src: 'test("t", () => { const x = 1; })', stripped: 'test("t", () => { const x = 1; })' });
  assert.deepEqual(r, [{ identity: "a.test.mjs::test:t::R1", detector: "test-asserts-nothing@1", classId: "R1", place: { path: "a.test.mjs", scope: "test:t", line: 1, lineIsAdvisory: true }, evidence: { predicate: "a test body contains no assertion, so it reports pass on every input", snippet: "test(\"t\", () => { const x = 1; })", redacted: 0, redactor: null }, confidence: "structural" }]);
});

test('returns an observation with the test keyword as scope when the title is computed', () => {
  const r = detectTestAssertsNothing({ rel: 'a.test.mjs', src: 'test(x, () => { const y = 2; })', stripped: 'test(x, () => { const y = 2; })' });
  assert.deepEqual(r, [{ identity: "a.test.mjs::test::R1", detector: "test-asserts-nothing@1", classId: "R1", place: { path: "a.test.mjs", scope: "test", line: 1, lineIsAdvisory: true }, evidence: { predicate: "a test body contains no assertion, so it reports pass on every input", snippet: "test(x, () => { const y = 2; })", redacted: 0, redactor: null }, confidence: "structural" }]);
});

test('returns an observation with the title in scope when the title is a string literal', () => {
  const r = detectTestAssertsNothing({ rel: 'a.test.mjs', src: 'test("hello", () => { const z = 3; })', stripped: 'test("hello", () => { const z = 3; })' });
  assert.deepEqual(r, [{ identity: "a.test.mjs::test:hello::R1", detector: "test-asserts-nothing@1", classId: "R1", place: { path: "a.test.mjs", scope: "test:hello", line: 1, lineIsAdvisory: true }, evidence: { predicate: "a test body contains no assertion, so it reports pass on every input", snippet: "test(\"hello\", () => { const z = 3; })", redacted: 0, redactor: null }, confidence: "structural" }]);
});
