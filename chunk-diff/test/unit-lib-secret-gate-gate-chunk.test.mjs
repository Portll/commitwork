// Redacts a source chunk when secrets-sweep finds a live secret in it (chunk-diff/lib/secret-gate.mjs gateChunk).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateChunk } from '../lib/secret-gate.mjs';

const KEY = 'AKIA' + 'Q7ZK3M9XWP2RT5VB';
const EXAMPLE = 'AKIA' + 'IOSFODNN7EXAMPLE';
const GH = 'ghp_' + 'Zq8Lm3Tx7Vb2Nc5Rk9Wd4Hf6Jy1Pg0Ss8Ae';
const AWS_MSG = '[REDACTED \u2014 secrets-sweep matched aws-access-key in this chunk. Rotate the credential, '
  + 'remove it from the source document, then regenerate this artifact.]';

test('a chunk with no secret is returned unchanged with redacted false and no findings', () => {
  assert.deepEqual(gateChunk('hello world'), { src: 'hello world', redacted: false, findings: [] });
});

test('an empty chunk is returned unchanged with redacted false and no findings', () => {
  assert.deepEqual(gateChunk(''), { src: '', redacted: false, findings: [] });
});

test('a documented example key is not treated as a secret and the chunk is kept', () => {
  const src = 'const k = "' + EXAMPLE + '";';
  assert.deepEqual(gateChunk(src), { src, redacted: false, findings: [] });
});

test('a live key on the first line is redacted and reported on line 1', () => {
  const r = gateChunk('const k = "' + KEY + '";');
  assert.equal(r.src, "[REDACTED \u2014 secrets-sweep matched provider-key/aws in this chunk. Rotate the credential, remove it from the source document, then regenerate this artifact.]");
  assert.equal(r.redacted, true);
  assert.deepEqual(r.findings.map((f) => [f.line, f.cls, f.verdict]), [[1, "provider-key/aws", "REAL-SECRET"]]);
});

test('a live key on the second line is reported with line number 2', () => {
  const r = gateChunk('x\nconst k = "' + KEY + '";');
  assert.equal(r.redacted, true);
  assert.deepEqual(r.findings.map((f) => f.line), [2]);
});

test('secrets of two classes on separate lines are both listed in the redaction message', () => {
  const r = gateChunk('const k = "' + KEY + '";\nconst t = "' + GH + '";');
  assert.equal(r.src, "[REDACTED \u2014 secrets-sweep matched provider-key/aws, high-entropy in this chunk. Rotate the credential, remove it from the source document, then regenerate this artifact.]");
  assert.equal(r.redacted, true);
  assert.deepEqual(r.findings.map((f) => [f.line, f.cls]), [[1, "provider-key/aws"], [2, "high-entropy"]]);
});

test('a chunk mixing a live key and an example key keeps only the live finding', () => {
  const r = gateChunk('a = "' + EXAMPLE + '"\nb = "' + KEY + '"');
  assert.equal(r.redacted, true);
  assert.deepEqual(r.findings.map((f) => [f.line, f.verdict]), [[2, "REAL-SECRET"]]);
});
