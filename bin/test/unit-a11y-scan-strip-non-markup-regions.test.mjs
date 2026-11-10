// Blank out HTML comments and script bodies while preserving newlines (bin/a11y-scan.mjs stripNonMarkupRegions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripNonMarkupRegions } from '../a11y-scan.mjs';

test('returns empty string for empty input', () => {
  assert.equal(stripNonMarkupRegions(''), '');
});

test('preserves plain text without markup', () => {
  assert.equal(stripNonMarkupRegions('<p>hello</p>'), '<p>hello</p>');
});

test('blanks a simple HTML comment', () => {
  assert.equal(stripNonMarkupRegions('<!-- comment -->'), '');
});

test('blanks a legacy HTML comment with --!> terminator', () => {
  assert.equal(stripNonMarkupRegions('<!-- comment --!>'), '');
});

test('preserves newlines inside blanked comments', () => {
  assert.equal(stripNonMarkupRegions('<!--\nline1\nline2\n-->'), '\n\n\n');
});

test('blanks a script body', () => {
  assert.equal(stripNonMarkupRegions('<script>var x = 1;</script>'), '');
});

test('preserves newlines inside blanked scripts', () => {
  assert.equal(stripNonMarkupRegions('<script>\nvar x = 1;\nvar y = 2;\n</script>'), '\n\n\n');
});

test('does not blank tags that merely contain the word script', () => {
  assert.equal(stripNonMarkupRegions('<scriptx>content</scriptx>'), '<scriptx>content</scriptx>');
});

test('blanks multiple comments and scripts while preserving structure', () => {
  const input = '<div>\n<!-- a -->\n<p>text</p>\n<script>\ncode\n</script>\n</div>';
  const expected = '<div>\n\n<p>text</p>\n\n\n\n</div>';
  assert.equal(stripNonMarkupRegions(input), expected);
});

test('handles nested-like structures by blanking outermost matches', () => {
  const input = '<!-- outer <script>inner</script> still comment -->';
  assert.equal(stripNonMarkupRegions(input), '');
});
