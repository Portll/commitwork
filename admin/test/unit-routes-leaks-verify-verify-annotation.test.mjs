// verifyAnnotation returns a verification result for a leak annotation (admin/routes/leaks-verify.mjs verifyAnnotation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAnnotation } from '../routes/leaks-verify.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const testFile = join('admin', 'test', 'unit-routes-leaks-verify-verify-annotation.test.mjs');
const pkgFile = 'package.json';
const now = '2024-06-15T12:00:00.000Z';

test('returns unverified for unrecognised reason', () => {
  const input = { root: repoRoot, repo: 'r', rule: 'rule', file: pkgFile, line: 1, reason: 'unknown reason', at: now, now };
  const result = verifyAnnotation(input);
  assert.deepEqual(result, { repo: "r", rule: "rule", file: "package.json", reasonClass: "unrecognised", reason: "unknown reason", status: "unverified", evidence: { tier: "weak", detail: "the stated reason names no claim this route can check" }, checks: [], seenAtLine: 1 });
});

test('test-fixture with no line proceeds to verifyTestFixture', () => {
  const input = { root: repoRoot, repo: 'r', rule: 'rule', file: testFile, line: null, reason: 'test fixture', at: now, now };
  const result = verifyAnnotation(input);
  assert.deepEqual(result, { repo: "r", rule: "rule", file: "admin/test/unit-routes-leaks-verify-verify-annotation.test.mjs", reasonClass: "test-fixture", reason: "test fixture", status: "corroborated", evidence: { tier: "medium", detail: "test path; the value matches no published example" }, checks: [{ name: "read-line", result: "unavailable", detail: "no line was supplied, so the matched value was never read" }, { name: "test-path", result: "pass", detail: "a path segment names a test/fixture/spec/testdata directory" }, { name: "published-example", result: "fail", detail: "the value matches no published example this route knows" }], seenAtLine: null, now: "2024-06-15T12:00:00.000Z" });
});

test('expired with no line returns early because wantsValue true', () => {
  const input = { root: repoRoot, repo: 'r', rule: 'rule', file: pkgFile, line: null, reason: 'expired token', at: now, now };
  const result = verifyAnnotation(input);
  assert.deepEqual(result, { repo: "r", rule: "rule", file: "package.json", reasonClass: "expired", reason: "expired token", status: "unverified", evidence: { tier: "weak", detail: "the value could not be read: no line was supplied, so the matched value was never read" }, checks: [{ name: "read-line", result: "unavailable", detail: "no line was supplied, so the matched value was never read" }], seenAtLine: null });
});

test('expired with line reads file but matched not jwt', () => {
  const input = { root: repoRoot, repo: 'r', rule: 'rule', file: pkgFile, line: 1, reason: 'expired token', at: now, now };
  const result = verifyAnnotation(input);
  assert.deepEqual(result, { repo: "r", rule: "rule", file: "package.json", reasonClass: "expired", reason: "expired token", status: "unverified", evidence: { tier: "weak", detail: "no decodable JWT on the line; expiry is not checkable locally" }, checks: [{ name: "jwt-decode", result: "unavailable", detail: "the line carries no three-part JWT" }], seenAtLine: 1, now: "2024-06-15T12:00:00.000Z" });
});

test('rolled with no trace token returns weak', () => {
  const input = { root: repoRoot, repo: 'r', rule: 'rule', file: pkgFile, line: 1, reason: 'rolled secret', at: now, now };
  const result = verifyAnnotation(input);
  assert.deepEqual(result, { repo: "r", rule: "rule", file: "package.json", reasonClass: "rolled", reason: "rolled secret", status: "unverified", evidence: { tier: "weak", detail: "no run of 12+ characters on the line to trace through history" }, checks: [{ name: "trace-token", result: "unavailable", detail: "nothing long enough to search for" }], seenAtLine: 1, now: "2024-06-15T12:00:00.000Z" });
});

test('rolled with trace token but no git repo returns weak', () => {
  const input = { root: '/non-existent', repo: 'r', rule: 'rule', file: pkgFile, line: 1, reason: 'rolled secret', at: now, now };
  const result = verifyAnnotation(input);
  assert.deepEqual(result, { repo: "r", rule: "rule", file: "package.json", reasonClass: "rolled", reason: "rolled secret", status: "unverified", evidence: { tier: "weak", detail: "the value could not be read: file no longer present in the working tree" }, checks: [{ name: "read-line", result: "unavailable", detail: "file no longer present in the working tree" }], seenAtLine: 1 });
});

test('rolled with trace token and git repo but no annotation time returns weak', () => {
  const input = { root: repoRoot, repo: 'r', rule: 'rule', file: pkgFile, line: 1, reason: 'rolled secret', at: '', now };
  const result = verifyAnnotation(input);
  assert.deepEqual(result, { repo: "r", rule: "rule", file: "package.json", reasonClass: "rolled", reason: "rolled secret", status: "unverified", evidence: { tier: "weak", detail: "no run of 12+ characters on the line to trace through history" }, checks: [{ name: "trace-token", result: "unavailable", detail: "nothing long enough to search for" }], seenAtLine: 1, now: "2024-06-15T12:00:00.000Z" });
});

test('reason as non-string affects base.reason', () => {
  const input = { root: repoRoot, repo: 'r', rule: 'rule', file: pkgFile, line: 1, reason: 123, at: now, now };
  const result = verifyAnnotation(input);
  assert.deepEqual(result, { repo: "r", rule: "rule", file: "package.json", reasonClass: "unrecognised", reason: "", status: "unverified", evidence: { tier: "weak", detail: "the stated reason names no claim this route can check" }, checks: [], seenAtLine: 1 });
});

test('rule truthy affects base.rule', () => {
  const input = { root: repoRoot, repo: 'r', rule: 'my-rule', file: pkgFile, line: 1, reason: 'test fixture', at: now, now };
  const result = verifyAnnotation(input);
  assert.deepEqual(result, { repo: "r", rule: "my-rule", file: "package.json", reasonClass: "test-fixture", reason: "test fixture", status: "unverified", evidence: { tier: "weak", detail: "neither the path nor the value corroborates a fixture" }, checks: [{ name: "test-path", result: "fail", detail: "no path segment names a test/fixture/spec/testdata directory" }, { name: "published-example", result: "fail", detail: "the value matches no published example this route knows" }], seenAtLine: 1, now: "2024-06-15T12:00:00.000Z" });
});

test('line empty string triggers readContext', () => {
  const input = { root: repoRoot, repo: 'r', rule: 'rule', file: pkgFile, line: '', reason: 'test fixture', at: now, now };
  const result = verifyAnnotation(input);
  assert.deepEqual(result, { repo: "r", rule: "rule", file: "package.json", reasonClass: "test-fixture", reason: "test fixture", status: "unverified", evidence: { tier: "weak", detail: "neither the path nor the value corroborates a fixture" }, checks: [{ name: "read-line", result: "unavailable", detail: "no line was supplied, so the matched value was never read" }, { name: "test-path", result: "fail", detail: "no path segment names a test/fixture/spec/testdata directory" }, { name: "published-example", result: "fail", detail: "the value matches no published example this route knows" }], seenAtLine: 0, now: "2024-06-15T12:00:00.000Z" });
});
