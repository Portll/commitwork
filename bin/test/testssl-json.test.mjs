import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTestsslJson } from '../lib/testssl-json.mjs';

const T = 'https://example.test:443';

test('graded testssl rows become findings with their severity; OK/INFO/WARN do not', () => {
  const raw = JSON.stringify([
    { id: 'cert_expirationStatus', severity: 'CRITICAL', finding: 'expired' },
    { id: 'BREACH', severity: 'MEDIUM', finding: 'potentially VULNERABLE', cve: 'CVE-2013-3587' },
    { id: 'TLS1_3', severity: 'OK', finding: 'offered' },
    { id: 'engine_problem', severity: 'WARN', finding: 'No engine or GOST support' },
    { id: 'service', severity: 'INFO', finding: 'HTTP' },
  ]);
  const r = readTestsslJson(raw, T);
  assert.equal(r.ok, true);
  assert.deepEqual(r.findings.map((f) => f.severity), ['critical', 'medium']);
  assert.equal(r.findings[1].detail, 'potentially VULNERABLE · CVE-2013-3587');
  assert.equal(r.findings[0].target, T);
});

test('a scan problem, an empty file or a non-array is a failed scan, never a clean one', () => {
  const fatal = readTestsslJson(JSON.stringify([{ id: 'scanProblem', severity: 'FATAL', finding: "Can't connect" }]), T);
  assert.equal(fatal.ok, false);
  assert.match(fatal.reason, /Can't connect/);
  assert.equal(readTestsslJson('[]', T).ok, false);
  assert.equal(readTestsslJson('{"scanResult":[]}', T).ok, false);
  assert.match(readTestsslJson('{"truncated', T).reason, /not JSON/);
});
