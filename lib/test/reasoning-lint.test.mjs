// node --test lib/test/reasoning-lint.test.mjs — contradiction detector tests: both vocabularies,
// negative controls, degenerate input, and pathological-length linear-scan performance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintPair } from '../reasoning-lint.mjs';

test('SMOKE TEST: issue-llm contradiction (REQUIRED)', () => {
  const result = lintPair({
    reasoning: 'This is not a real credential, just a test fixture.',
    verdict: 'real-vulnerability',
  });
  assert.strictEqual(result.contradiction, true, 'dismissive + real-vulnerability must contradict');
  assert(result.pattern !== null, 'pattern must be non-null');
  assert(typeof result.pattern === 'string', 'pattern must be a string');
});

test('Opus fixture: secondary vocab dismissive + needs-human = contradiction', () => {
  const result = lintPair({
    reasoning: 'a 29-char filename constant, not a credential',
    verdict: 'needs-human',
  });
  assert.strictEqual(result.contradiction, true, 'dismissive evidence + needs-human should contradict');
  assert(result.pattern !== null, 'should identify the pattern');
});

test('Negative control: affirmative evidence + real-vulnerability (should NOT contradict)', () => {
  const result = lintPair({
    reasoning: 'confirmed live credential in production config, actively exploitable',
    verdict: 'real-vulnerability',
  });
  assert.strictEqual(result.contradiction, false, 'affirmative + real-vulnerability is consistent');
});

test('Negative control: dismissive evidence + false-positive (should NOT contradict)', () => {
  const result = lintPair({
    reasoning: 'clearly a test fixture value, not a real secret',
    verdict: 'false-positive',
  });
  assert.strictEqual(result.contradiction, false, 'dismissive + false-positive is consistent');
});

test('Degenerate input: empty reasoning', () => {
  const result = lintPair({ reasoning: '', verdict: 'real-vulnerability' });
  assert.strictEqual(result.contradiction, false, 'empty reasoning should not contradict');
  assert.strictEqual(result.pattern, null, 'empty reasoning has no pattern');
});

test('Degenerate input: null reasoning', () => {
  const result = lintPair({ reasoning: null, verdict: 'real-vulnerability' });
  assert.strictEqual(result.contradiction, false, 'null reasoning should not contradict');
  assert.strictEqual(result.pattern, null, 'null reasoning has no pattern');
});

test('Degenerate input: null verdict', () => {
  const result = lintPair({ reasoning: 'some reasoning', verdict: null });
  assert.strictEqual(result.contradiction, false, 'null verdict should not crash');
  assert.strictEqual(result.pattern, null, 'null verdict has no pattern');
});

test('Degenerate input: whitespace-only reasoning', () => {
  const result = lintPair({ reasoning: '   \n\n  \t  ', verdict: 'real-vulnerability' });
  assert.strictEqual(result.contradiction, false, 'whitespace reasoning should not contradict');
  assert.strictEqual(result.pattern, null, 'whitespace reasoning has no pattern');
});

test('Pathological input: 100k chars with repeated patterns (performance)', () => {
  const largeReasoning = 'not a credential. '.repeat(5800); // ~100k chars
  const start = performance.now();
  const result = lintPair({
    reasoning: largeReasoning,
    verdict: 'real-vulnerability',
  });
  const elapsed = performance.now() - start;

  assert.strictEqual(result.contradiction, true, 'should still detect contradiction');
  assert(elapsed < 2000, `pathological scan completed in ${elapsed}ms (should be <2000ms)`);
});

test('Primary enum: affirmative + false-positive = contradiction', () => {
  const result = lintPair({
    reasoning: 'confirmed live credential in production',
    verdict: 'false-positive',
  });
  assert.strictEqual(result.contradiction, true, 'affirmative + false-positive should contradict');
});

test('Primary enum: affirmative + already-mitigated should be consistent (no affirmative evidence of ongoing threat)', () => {
  // Note: already-mitigated + affirmative is a contradiction per spec
  const result = lintPair({
    reasoning: 'this credential was actively exploitable but has been rotated',
    verdict: 'already-mitigated',
  });
  assert.strictEqual(result.contradiction, true, 'affirmative threat + already-mitigated should contradict');
});

test('Primary enum: dismissive + needs-context = contradiction', () => {
  const result = lintPair({
    reasoning: 'this looks like a test fixture but I need more context',
    verdict: 'needs-context',
  });
  assert.strictEqual(result.contradiction, true, 'dismissive + needs-context should contradict');
});

test('Secondary enum: affirmative + false-positive = contradiction', () => {
  const result = lintPair({
    reasoning: 'confirmed live credential found in code',
    verdict: 'false-positive',
  });
  assert.strictEqual(result.contradiction, true, 'affirmative + false-positive (secondary) should contradict');
});

test('Secondary enum: affirmative + intentional = contradiction', () => {
  const result = lintPair({
    reasoning: 'this is a confirmed live credential that should be rotated',
    verdict: 'intentional',
  });
  assert.strictEqual(result.contradiction, true, 'affirmative threat + intentional should contradict');
});

test('Secondary enum: dismissive + real = contradiction', () => {
  const result = lintPair({
    reasoning: 'this is just a placeholder, not a real secret',
    verdict: 'real',
  });
  assert.strictEqual(result.contradiction, true, 'dismissive + real (secondary) should contradict');
});

test('Case insensitivity: mixed case should match', () => {
  const result = lintPair({
    reasoning: 'This is NOT A Credential, just a TEST FIXTURE.',
    verdict: 'real-vulnerability',
  });
  assert.strictEqual(result.contradiction, true, 'case-insensitive matching required');
});

test('Determinism: identical input yields identical output', () => {
  const input = {
    reasoning: 'this is a placeholder value, not a secret',
    verdict: 'needs-context',
  };
  const result1 = lintPair(input);
  const result2 = lintPair(input);
  assert.deepStrictEqual(result1, result2, 'identical inputs must produce identical outputs');
});

test('Pathological-length single line: no backtracking catastrophe', () => {
  const start = performance.now();
  const longLine = 'a '.repeat(10000) + 'test fixture not a credential';
  const result = lintPair({
    reasoning: longLine,
    verdict: 'real-vulnerability',
  });
  const elapsed = performance.now() - start;
  assert(elapsed < 1000, `should complete < 1s, took ${elapsed}ms`);
  assert.strictEqual(result.contradiction, true);
});

test('Multiline reasoning with mixed evidence', () => {
  const result = lintPair({
    reasoning: `Some discussion about the code.
This is not a real credential, it's just a test value.
It appears in line 42.`,
    verdict: 'real-vulnerability',
  });
  assert.strictEqual(result.contradiction, true, 'should detect contradiction across lines');
});

test('Negative control: dismissive + already-mitigated (no contradiction)', () => {
  const result = lintPair({
    reasoning: 'This placeholder was a test fixture and already mitigated',
    verdict: 'already-mitigated',
  });
  assert.strictEqual(result.contradiction, false, 'dismissive + already-mitigated is consistent');
});

test('Invalid verdict: unknown verdict (no contradiction)', () => {
  const result = lintPair({
    reasoning: 'this is not a credential',
    verdict: 'unknown-verdict-value',
  });
  assert.strictEqual(result.contradiction, false, 'unknown verdict should not crash');
});
