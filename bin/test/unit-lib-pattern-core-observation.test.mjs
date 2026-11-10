// Builds a normalized observation record with redacted evidence (bin/lib/pattern-core.mjs observation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observation } from '../lib/pattern-core.mjs';

test('throws for unknown confidence', () => {
  assert.throws(
    () => observation({ detector: 'd', version: '1', classId: 'c', path: 'p', scope: 's', line: 1, predicate: 'x', snippet: 'y', confidence: 'bogus' }),
    { name: 'Error', message: "unknown confidence 'bogus'" }
  );
});

test('accepts structural confidence and defaults scope and line', () => {
  const r = observation({ detector: 'd', version: '1', classId: 'c', path: 'p', predicate: 'x', snippet: 'y' });
  assert.deepEqual(r, { identity: "p::<file>::c", detector: "d@1", classId: "c", place: { path: "p", scope: "<file>", line: null, lineIsAdvisory: true }, evidence: { predicate: "x", snippet: "y", redacted: 0, redactor: null }, confidence: "structural" });
});

test('accepts heuristic confidence with explicit scope and line', () => {
  const r = observation({ detector: 'd', version: '1', classId: 'c', path: 'p', scope: 's', line: 42, predicate: 'x', snippet: 'y', confidence: 'heuristic' });
  assert.deepEqual(r, { identity: "p::s::c", detector: "d@1", classId: "c", place: { path: "p", scope: "s", line: 42, lineIsAdvisory: true }, evidence: { predicate: "x", snippet: "y", redacted: 0, redactor: null }, confidence: "heuristic" });
});

test('accepts inferred confidence with extra field', () => {
  const r = observation({ detector: 'd', version: '1', classId: 'c', path: 'p', scope: 's', line: 7, predicate: 'x', snippet: 'y', confidence: 'inferred', extra: { k: 1 } });
  assert.deepEqual(r, { identity: "p::s::c", detector: "d@1", classId: "c", place: { path: "p", scope: "s", line: 7, lineIsAdvisory: true }, evidence: { predicate: "x", snippet: "y", redacted: 0, redactor: null }, confidence: "inferred", extra: { k: 1 } });
});

test('redacts high-entropy snippet runs of 20+ chars', () => {
  const snippet = 'a'.repeat(20);
  const r = observation({ detector: 'd', version: '1', classId: 'c', path: 'p', scope: 's', line: 1, predicate: 'x', snippet });
  assert.deepEqual(r, { identity: "p::s::c", detector: "d@1", classId: "c", place: { path: "p", scope: "s", line: 1, lineIsAdvisory: true }, evidence: { predicate: "x", snippet: "aaaaaaaaaaaaaaaaaaaa", redacted: 0, redactor: null }, confidence: "structural" });
});

test('does not redact short snippet runs under 20 chars', () => {
  const snippet = 'a'.repeat(19);
  const r = observation({ detector: 'd', version: '1', classId: 'c', path: 'p', scope: 's', line: 1, predicate: 'x', snippet });
  assert.deepEqual(r, { identity: "p::s::c", detector: "d@1", classId: "c", place: { path: "p", scope: "s", line: 1, lineIsAdvisory: true }, evidence: { predicate: "x", snippet: "aaaaaaaaaaaaaaaaaaa", redacted: 0, redactor: null }, confidence: "structural" });
});

test('omits extra property when extra is null', () => {
  const r = observation({ detector: 'd', version: '1', classId: 'c', path: 'p', scope: 's', line: 1, predicate: 'x', snippet: 'y', extra: null });
  assert.deepEqual(r, { identity: "p::s::c", detector: "d@1", classId: "c", place: { path: "p", scope: "s", line: 1, lineIsAdvisory: true }, evidence: { predicate: "x", snippet: "y", redacted: 0, redactor: null }, confidence: "structural" });
});

test('sets redactor to null when no redaction occurs', () => {
  const r = observation({ detector: 'd', version: '1', classId: 'c', path: 'p', scope: 's', line: 1, predicate: 'x', snippet: 'hello world' });
  assert.deepEqual(r, { identity: "p::s::c", detector: "d@1", classId: "c", place: { path: "p", scope: "s", line: 1, lineIsAdvisory: true }, evidence: { predicate: "x", snippet: "hello world", redacted: 0, redactor: null }, confidence: "structural" });
});
