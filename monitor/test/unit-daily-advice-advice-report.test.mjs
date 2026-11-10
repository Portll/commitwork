// Maps each repo with advice to a read or unavailable summary (monitor/daily-advice.mjs adviceReport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adviceReport } from '../daily-advice.mjs';

test('returns an empty array when no repo has advice', () => {
  const digest = { repos: [{ name: 'a' }, { name: 'b' }] };
  assert.deepEqual(adviceReport(digest), []);
});

test('returns a read summary for a repo whose advice state is read', () => {
  const digest = { repos: [{ name: 'r1', advice: { state: 'read', toolVersion: '1.0', unmeasured: [], omitted: [], dataPathItems: [], ordered: [] } }] };
  assert.deepEqual(adviceReport(digest), [{ repo: "r1", state: "read", toolVersion: "1.0", unmeasured: [], omitted: [], dataPathItems: [], suggestions: [] }]);
});

test('returns an unavailable summary for a repo whose advice state is not read', () => {
  const digest = { repos: [{ name: 'r2', advice: { state: 'unavailable', reason: 'no data' } }] };
  assert.deepEqual(adviceReport(digest), [{ repo: "r2", state: "unavailable", reason: "no data" }]);
});

test('returns an unavailable summary for a repo whose advice state is empty string', () => {
  const digest = { repos: [{ name: 'r3', advice: { state: '', reason: 'empty' } }] };
  assert.deepEqual(adviceReport(digest), [{ repo: "r3", state: "unavailable", reason: "empty" }]);
});

test('returns an unavailable summary for a repo whose advice state is null', () => {
  const digest = { repos: [{ name: 'r4', advice: { state: null, reason: 'null' } }] };
  assert.deepEqual(adviceReport(digest), [{ repo: "r4", state: "unavailable", reason: "null" }]);
});

test('returns an unavailable summary for a repo whose advice state is a number', () => {
  const digest = { repos: [{ name: 'r5', advice: { state: 0, reason: 'zero' } }] };
  assert.deepEqual(adviceReport(digest), [{ repo: "r5", state: "unavailable", reason: "zero" }]);
});

test('returns an unavailable summary for a repo whose advice state is the string unavailable', () => {
  const digest = { repos: [{ name: 'r6', advice: { state: 'unavailable', reason: 'x' } }] };
  assert.deepEqual(adviceReport(digest), [{ repo: "r6", state: "unavailable", reason: "x" }]);
});

test('returns an unavailable summary for a repo whose advice state is the string read with a space', () => {
  const digest = { repos: [{ name: 'r7', advice: { state: 'read ', reason: 'y' } }] };
  assert.deepEqual(adviceReport(digest), [{ repo: "r7", state: "unavailable", reason: "y" }]);
});

test('returns an unavailable summary for a repo whose advice state is the string READ in uppercase', () => {
  const digest = { repos: [{ name: 'r8', advice: { state: 'READ', reason: 'z' } }] };
  assert.deepEqual(adviceReport(digest), [{ repo: "r8", state: "unavailable", reason: "z" }]);
});

test('returns an unavailable summary for a repo whose advice state is the string read with a trailing newline', () => {
  const digest = { repos: [{ name: 'r9', advice: { state: 'read\n', reason: 'w' } }] };
  assert.deepEqual(adviceReport(digest), [{ repo: "r9", state: "unavailable", reason: "w" }]);
});
