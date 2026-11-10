// Detects contradictions between dismissive/affirmative evidence in reasoning and the verdict (lib/reasoning-lint.mjs lintPair).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintPair } from '../reasoning-lint.mjs';

test('returns no contradiction when reasoning is empty and verdict is set', () => {
  const r = lintPair({ reasoning: '', verdict: 'real-vulnerability' });
  assert.deepEqual(r, { contradiction: false, pattern: null });
});

test('returns no contradiction when verdict is null and reasoning is set', () => {
  const r = lintPair({ reasoning: 'this is a real credential', verdict: null });
  assert.deepEqual(r, { contradiction: false, pattern: null });
});

test('returns no contradiction when both reasoning and verdict are empty', () => {
  const r = lintPair({ reasoning: '', verdict: '' });
  assert.deepEqual(r, { contradiction: false, pattern: null });
});

test('flags contradiction when dismissive evidence meets real-vulnerability verdict', () => {
  const r = lintPair({ reasoning: 'this is not a real credential', verdict: 'real-vulnerability' });
  assert.deepEqual(r, { contradiction: true, pattern: "\\bnot\\s+a\\s+(?:real\\s+)?(?:credential|secret|vulnerabilit\\w*)" });
});

test('flags contradiction when affirmative evidence meets false-positive verdict', () => {
  const r = lintPair({ reasoning: 'confirmed live vulnerability', verdict: 'false-positive' });
  assert.deepEqual(r, { contradiction: true, pattern: "\\bconfirmed\\s+(?:live|real|vulnerability|credential|secret)" });
});

test('flags contradiction when dismissive evidence meets needs-context verdict', () => {
  const r = lintPair({ reasoning: 'this is a placeholder', verdict: 'needs-context' });
  assert.deepEqual(r, { contradiction: true, pattern: "\\bplaceholder" });
});

test('flags contradiction when affirmative evidence meets already-mitigated verdict', () => {
  const r = lintPair({ reasoning: 'secret exposed in production', verdict: 'already-mitigated' });
  assert.deepEqual(r, { contradiction: true, pattern: "\\bsecret\\s+(?:found|exposed|leaked)" });
});

test('flags contradiction when dismissive evidence meets real verdict', () => {
  const r = lintPair({ reasoning: 'this is a test fixture', verdict: 'real' });
  assert.deepEqual(r, { contradiction: true, pattern: "\\btest\\s+fixture" });
});

test('flags contradiction when affirmative evidence meets intentional verdict', () => {
  const r = lintPair({ reasoning: 'actively exploitable flaw', verdict: 'intentional' });
  assert.deepEqual(r, { contradiction: true, pattern: "\\bactively\\s+exploitable" });
});

test('returns no contradiction when dismissive evidence meets false-positive verdict', () => {
  const r = lintPair({ reasoning: 'this is a placeholder', verdict: 'false-positive' });
  assert.deepEqual(r, { contradiction: false, pattern: null });
});
