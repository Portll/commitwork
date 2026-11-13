// applySarifReplacements computes a new string with SARIF deletions replaced (lib/sarif-remediation.mjs applySarifReplacements).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySarifReplacements } from '../sarif-remediation.mjs';

test('replaces a single region correctly', () => {
  const text = 'line1\nline2\nline3';
  const replacements = [
    {
      deletedRegion: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 6 },
      insertedContent: { text: 'REPLACED' }
    }
  ];
  const result = applySarifReplacements(text, replacements);
  assert.equal(result, "line1\nREPLACED\nline3");
});

test('returns original text when replacements array is empty', () => {
  const text = 'only one line';
  const replacements = [];
  const result = applySarifReplacements(text, replacements);
  assert.equal(result, "only one line");
});

test('throws when deletedRegion is outside the text (line too high)', () => {
  const text = 'a\nb';
  const replacements = [
    {
      deletedRegion: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 2 },
      insertedContent: { text: 'x' }
    }
  ];
  assert.throws(() => applySarifReplacements(text, replacements), {
    name: 'Error',
    message: 'sarif replacement: deletedRegion is outside the text'
  });
});

test('throws when deletedRegion ends before it starts', () => {
  const text = 'abc';
  const replacements = [
    {
      deletedRegion: { startLine: 1, startColumn: 4, endLine: 1, endColumn: 2 },
      insertedContent: { text: '' }
    }
  ];
  assert.throws(() => applySarifReplacements(text, replacements), {
    name: 'Error',
    message: 'sarif replacement: deletedRegion ends before it starts'
  });
});

test('throws when regions overlap', () => {
  const text = '12345';
  const replacements = [
    {
      deletedRegion: { startLine: 1, startColumn: 2, endLine: 1, endColumn: 4 },
      insertedContent: { text: 'A' }
    },
    {
      deletedRegion: { startLine: 1, startColumn: 3, endLine: 1, endColumn: 5 },
      insertedContent: { text: 'B' }
    }
  ];
  assert.throws(() => applySarifReplacements(text, replacements), {
    name: 'Error',
    message: 'sarif replacement: regions overlap'
  });
});

test('applies multiple non\u2011overlapping replacements in correct order', () => {
  const text = 'first\nsecond\nthird';
  const replacements = [
    {
      deletedRegion: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
      insertedContent: { text: 'ONE' }
    },
    {
      deletedRegion: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 6 },
      insertedContent: { text: 'THREE' }
    }
  ];
  const result = applySarifReplacements(text, replacements);
  assert.equal(result, "ONE\nsecond\nTHREE");
});

test('handles zero\u2011length deletion (insertion only)', () => {
  const text = 'abc';
  const replacements = [
    {
      deletedRegion: { startLine: 1, startColumn: 2, endLine: 1, endColumn: 2 },
      insertedContent: { text: 'X' }
    }
  ];
  const result = applySarifReplacements(text, replacements);
  assert.equal(result, "aXbc");
});

test('throws when column exceeds line length + 1', () => {
  const text = 'short';
  const replacements = [
    {
      deletedRegion: { startLine: 1, startColumn: 10, endLine: 1, endColumn: 12 },
      insertedContent: { text: 'y' }
    }
  ];
  assert.throws(() => applySarifReplacements(text, replacements), {
    name: 'Error',
    message: 'sarif replacement: deletedRegion is outside the text'
  });
});
