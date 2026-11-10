// Detects presence of a git apply --check call in source (monitor/stpa-sweep.mjs extractApplyCheck).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractApplyCheck } from '../stpa-sweep.mjs';

test('returns hasApplyCheck true when git apply --check is present', () => {
  const source = "git(['apply', '--check', diff])";
  const result = extractApplyCheck(source);
  assert.deepEqual(result, { hasApplyCheck: true, detail: null });
});

test('returns hasApplyCheck false when no git apply --check call exists', () => {
  const source = "git(['apply', diff])";
  const result = extractApplyCheck(source);
  assert.deepEqual(result, { hasApplyCheck: false, detail: 'no `git apply --check` call found \u2014 a diff-apply path here would be UNCLASSIFIED against UCA3/H3' });
});

test('handles multiple spaces between apply and --check', () => {
  const source = "git(['apply',   '--check', diff])";
  const result = extractApplyCheck(source);
  assert.deepEqual(result, { hasApplyCheck: true, detail: null });
});

test('handles newline between apply and --check', () => {
  const source = "git(['apply',\n'--check', diff])";
  const result = extractApplyCheck(source);
  assert.deepEqual(result, { hasApplyCheck: true, detail: null });
});

test('returns false when --check is not immediately after apply', () => {
  const source = "git(['apply', '--stat', '--check', diff])";
  const result = extractApplyCheck(source);
  assert.deepEqual(result, { hasApplyCheck: false, detail: 'no `git apply --check` call found \u2014 a diff-apply path here would be UNCLASSIFIED against UCA3/H3' });
});

test('returns false for empty source string', () => {
  const result = extractApplyCheck('');
  assert.deepEqual(result, { hasApplyCheck: false, detail: 'no `git apply --check` call found \u2014 a diff-apply path here would be UNCLASSIFIED against UCA3/H3' });
});

test('returns false when git apply is present but without --check', () => {
  const source = "git(['apply', '--3way', diff])";
  const result = extractApplyCheck(source);
  assert.deepEqual(result, { hasApplyCheck: false, detail: 'no `git apply --check` call found \u2014 a diff-apply path here would be UNCLASSIFIED against UCA3/H3' });
});

test('handles tab character between apply and --check', () => {
  const source = "git(['apply',\t'--check', diff])";
  const result = extractApplyCheck(source);
  assert.deepEqual(result, { hasApplyCheck: true, detail: null });
});
