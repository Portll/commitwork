// Parses hadolint readme markdown into a map of rule codes to descriptions (monitor/rule-titles.mjs parseHadolintReadme).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHadolintReadme } from '../rule-titles.mjs';

test('returns empty object when input is null', () => {
  const input = null;
  const result = parseHadolintReadme(input);
  assert.deepEqual(result, {});
});

test('returns empty object when input is undefined', () => {
  const input = undefined;
  const result = parseHadolintReadme(input);
  assert.deepEqual(result, {});
});

test('returns empty object when input is empty string', () => {
  const input = '';
  const result = parseHadolintReadme(input);
  assert.deepEqual(result, {});
});

test('parses a valid DL rule line with markdown link', () => {
  const input = '| [DL3000] | Description | [link](http://example.com) |';
  const result = parseHadolintReadme(input);
  assert.deepEqual(result, { DL3000: "link" });
});

test('parses a valid SC rule line with code tag', () => {
  const input = '| [SC1000] | Description | <code>some code</code> |';
  const result = parseHadolintReadme(input);
  assert.deepEqual(result, { SC1000: "`some code`" });
});

test('ignores lines that do not match the rule pattern', () => {
  const input = 'This is not a rule line\nAnother non-matching line';
  const result = parseHadolintReadme(input);
  assert.deepEqual(result, {});
});

test('parses multiple rule lines into an object', () => {
  const input = '| [DL3000] | First | text1 |\n| [SC1000] | Second | text2 |';
  const result = parseHadolintReadme(input);
  assert.deepEqual(result, { DL3000: "text1", SC1000: "text2" });
});

test('handles HTML entities in description text', () => {
  const input = '| [DL3000] | Description | a &amp; b |';
  const result = parseHadolintReadme(input);
  assert.deepEqual(result, { DL3000: "a & b" });
});

test('ignores rule lines with empty description text', () => {
  const input = '| [DL3000] | Description |   |';
  const result = parseHadolintReadme(input);
  assert.deepEqual(result, {});
});

test('handles escaped pipe characters in description', () => {
  const input = '| [DL3000] | Description | a \\| b |';
  const result = parseHadolintReadme(input);
  assert.deepEqual(result, { DL3000: "a | b" });
});
