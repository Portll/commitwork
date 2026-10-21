// Parses testssl JSON output into findings and scan problems (bin/lib/testssl-json.mjs readTestsslJson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTestsslJson } from '../lib/testssl-json.mjs';

test('returns ok false when raw is not valid JSON', () => {
  const result = readTestsslJson('not json', 'example.com');
  assert.equal(result.ok, false);
  assert.match(result.reason, /^testssl\.json is not JSON: /);
});

test('returns ok false when parsed JSON is not an array', () => {
  const result = readTestsslJson('{"a":1}', 'example.com');
  assert.deepEqual(result, { ok: false, reason: 'testssl.json is not the flat array that --jsonfile writes' });
});

test('returns ok false when array is empty', () => {
  const result = readTestsslJson('[]', 'example.com');
  assert.deepEqual(result, { ok: false, reason: 'testssl.json holds no rows' });
});

test('returns ok false when a row has severity FATAL', () => {
  const raw = JSON.stringify([{ severity: 'FATAL', id: 'scanProblem', finding: 'connection failed' }]);
  const result = readTestsslJson(raw, 'example.com');
  assert.deepEqual(result, { ok: false, reason: 'testssl reported a scan problem: connection failed' });
});

test('returns ok false when a row has id scanProblem', () => {
  const raw = JSON.stringify([{ severity: 'INFO', id: 'scanProblem', finding: 'dns lookup failed' }]);
  const result = readTestsslJson(raw, 'example.com');
  assert.deepEqual(result, { ok: false, reason: 'testssl reported a scan problem: dns lookup failed' });
});

test('returns ok true with no findings when all rows are ungraded', () => {
  const raw = JSON.stringify([{ severity: 'INFO', id: 'certinfo', finding: 'ok' }, { severity: 'UNKNOWN', id: 'x', finding: 'y' }]);
  const result = readTestsslJson(raw, 'example.com');
  assert.deepEqual(result, { ok: true, rows: 2, findings: [] });
});

test('returns ok true with findings for each graded severity', () => {
  const raw = JSON.stringify([
    { severity: 'CRITICAL', id: 'weakkey', finding: 'weak key', cve: 'CVE-2020-1' },
    { severity: 'HIGH', id: 'oldtls', finding: 'old tls', cve: null },
    { severity: 'MEDIUM', id: 'weakcipher', finding: 'weak cipher', cve: 'CVE-2021-2' },
    { severity: 'LOW', id: 'infoleak', finding: 'info leak', cve: undefined },
  ]);
  const result = readTestsslJson(raw, 'example.com');
  assert.equal(result.ok, true);
  assert.equal(result.rows, 4);
  assert.equal(result.findings.length, 4);
  assert.deepEqual(result.findings[0], { severity: 'critical', target: 'example.com', issue: 'testssl weakkey', detail: 'weak key \u00b7 CVE-2020-1' });
  assert.deepEqual(result.findings[1], { severity: 'high', target: 'example.com', issue: 'testssl oldtls', detail: 'old tls' });
  assert.deepEqual(result.findings[2], { severity: 'medium', target: 'example.com', issue: 'testssl weakcipher', detail: 'weak cipher \u00b7 CVE-2021-2' });
  assert.deepEqual(result.findings[3], { severity: 'low', target: 'example.com', issue: 'testssl infoleak', detail: 'info leak' });
});

test('ignores null rows in the array', () => {
  const raw = JSON.stringify([null, { severity: 'LOW', id: 'x', finding: 'f' }]);
  const result = readTestsslJson(raw, 'example.com');
  assert.equal(result.ok, true);
  assert.equal(result.rows, 2);
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0], { severity: 'low', target: 'example.com', issue: 'testssl x', detail: 'f' });
});
