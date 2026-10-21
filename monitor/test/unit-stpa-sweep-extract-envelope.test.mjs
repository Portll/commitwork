// Checks whether scanner sources import prompt-envelope and call envelope (monitor/stpa-sweep.mjs extractEnvelope).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEnvelope } from '../stpa-sweep.mjs';

test('returns false for both when sources are empty strings', () => {
  const result = extractEnvelope('', '');
  assert.deepEqual(result, { codeql: false, remediation: false });
});

test('returns false for codeql when import is missing but envelope call exists', () => {
  const src = 'function findingBlock() { envelope(); }';
  const result = extractEnvelope(src, '');
  assert.equal(result.codeql, false);
});

test('returns false for codeql when import exists but envelope call is missing', () => {
  const src = "import { x } from '../../lib/prompt-envelope.mjs';";
  const result = extractEnvelope(src, '');
  assert.equal(result.codeql, false);
});

test('returns true for codeql when import and envelope call are present', () => {
  const src = "import { x } from '../../lib/prompt-envelope.mjs';\nfunction findingBlock() { envelope(); }";
  const result = extractEnvelope(src, '');
  assert.equal(result.codeql, true);
});

test('returns false for remediation when import is missing but runLocalModel and envelope exist', () => {
  const src = 'async function runLocalModel() { envelope(artifactText); }';
  const result = extractEnvelope('', src);
  assert.equal(result.remediation, false);
});

test('returns false for remediation when import exists but runLocalModel or envelope is missing', () => {
  const src = "import { x } from '../../lib/prompt-envelope.mjs';\nfunction other() { envelope(artifactText); }";
  const result = extractEnvelope('', src);
  assert.equal(result.remediation, false);
});

test('returns true for remediation when import, runLocalModel, and envelope(artifactText) are present', () => {
  const src = "import { x } from '../../lib/prompt-envelope.mjs';\nasync function runLocalModel() { envelope(artifactText); }";
  const result = extractEnvelope('', src);
  assert.equal(result.remediation, true);
});

test('returns true for both when both sources have correct patterns', () => {
  const codeql = "import { x } from '../../lib/prompt-envelope.mjs';\nfunction findingBlock() { envelope(); }";
  const remed = "import { x } from '../../lib/prompt-envelope.mjs';\nasync function runLocalModel() { envelope(artifactText); }";
  const result = extractEnvelope(codeql, remed);
  assert.deepEqual(result, { codeql: true, remediation: true });
});

test('returns false for codeql when import path is slightly different', () => {
  const src = "import { x } from '../../lib/prompt-envelope.js';\nfunction findingBlock() { envelope(); }";
  const result = extractEnvelope(src, '');
  assert.equal(result.codeql, false);
});

test('returns false for remediation when envelope argument is not artifactText', () => {
  const src = "import { x } from '../../lib/prompt-envelope.mjs';\nasync function runLocalModel() { envelope(text); }";
  const result = extractEnvelope('', src);
  assert.equal(result.remediation, false);
});
