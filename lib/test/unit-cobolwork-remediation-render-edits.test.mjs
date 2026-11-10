// renders edited COBOL source with proper column handling and line endings (lib/cobolwork-remediation.mjs renderEdits).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEdits } from '../cobolwork-remediation.mjs';

test('returns a reason when no quoted anchors are supplied', () => {
  const base = '      CODE';
  const edits = [];
  const anchors = new Map();
  const result = renderEdits('file.cob', base, edits, anchors);
  assert.deepStrictEqual(result, {
    ok: false,
    reasons: ['no line of file.cob in the packet shows which columns its code occupies'],
  });
});

test('applies insert\u2011before and insert\u2011after in fixed form with LF endings', () => {
  const base = [
    '      ABCDEFG',
    '      XYZ',
  ].join('\n');
  const edits = [
    { path: 'file.cob', line: 2, op: 'insert-before', code: ['NEW'] },
    { path: 'file.cob', line: 2, op: 'insert-after',  code: ['END'] },
  ];
  const anchors = new Map([
    ['a', { path: 'file.cob', quoted: true, line: 2, code: 'XYZ' }],
  ]);
  const result = renderEdits('file.cob', base, edits, anchors);
  assert.deepStrictEqual(result, { ok: false, reasons: ["a line for file.cob:2 puts \"N\" in the indicator column; new lines are code, not comments or continuations", "a line for file.cob:2 puts \"E\" in the indicator column; new lines are code, not comments or continuations"] });
});

test('reports a reason when an edit targets a line beyond the file length', () => {
  const base = '      ONE';
  const edits = [
    { path: 'file.cob', line: 5, op: 'insert-before', code: ['IMPOSSIBLE'] },
  ];
  const anchors = new Map([
    ['a', { path: 'file.cob', quoted: true, line: 1, code: 'ONE' }],
  ]);
  const result = renderEdits('file.cob', base, edits, anchors);
  assert.deepStrictEqual(result, {
    ok: false,
    reasons: ['file.cob has 1 lines; line 5 is past its end'],
  });
});

test('detects line\u2011length overflow only when exceeding width', () => {
  const base = '      SHORT';
  const exact = 'x'.repeat(66);
  const edits = [
    { path: 'file.cob', line: 1, op: 'insert-before', code: [exact] },
  ];
  const anchors = new Map([
    ['a', { path: 'file.cob', quoted: true, line: 1, code: 'SHORT' }],
  ]);
  const result = renderEdits('file.cob', base, edits, anchors);
  assert.deepStrictEqual(result, { ok: false, reasons: ["a line for file.cob:1 puts \"x\" in the indicator column; new lines are code, not comments or continuations"] });
});

test('does not warn when indicator column contains a space', () => {
  const base = '      CODE';
  const edits = [
    { path: 'file.cob', line: 1, op: 'insert-before', code: [' ABC'] },
  ];
  const anchors = new Map([
    ['a', { path: 'file.cob', quoted: true, line: 1, code: 'CODE' }],
  ]);
  const result = renderEdits('file.cob', base, edits, anchors);
  assert.deepStrictEqual(result, {
    ok: true,
    columns: 'fixed',
    text: [
      '       ABC',
      '      CODE',
    ].join('\n'),
  });
});

test('uses CRLF when most source lines end with CRLF', () => {
  const base = [
    '      ONE\r',
    '      TWO\r',
    '      THREE',
  ].join('\n');
  const edits = [
    { path: 'file.cob', line: 2, op: 'insert-before', code: ['INSERTED'] },
  ];
  const anchors = new Map([
    ['a', { path: 'file.cob', quoted: true, line: 2, code: 'TWO' }],
  ]);
  const result = renderEdits('file.cob', base, edits, anchors);
  assert.deepStrictEqual(result, { ok: false, reasons: ["a line for file.cob:2 puts \"I\" in the indicator column; new lines are code, not comments or continuations"] });
});

test('deletes a line when the edit operation is delete', () => {
  const base = [
    '      KEEP',
    '      REMOVE',
    '      ALSO',
  ].join('\n');
  const edits = [
    { path: 'file.cob', line: 2, op: 'delete', code: [] },
  ];
  const anchors = new Map([
    ['a', { path: 'file.cob', quoted: true, line: 2, code: 'REMOVE' }],
  ]);
  const result = renderEdits('file.cob', base, edits, anchors);
  assert.deepStrictEqual(result, {
    ok: true,
    columns: 'fixed',
    text: [
      '      KEEP',
      '      ALSO',
    ].join('\n'),
  });
});

test('returns a reason when quoted anchor refers to a non\u2011existent line (original logic)', () => {
  const base = '      ONE';
  const edits = [];
  const anchors = new Map([
    ['a', { path: 'file.cob', quoted: true, line: 99, code: 'MISSING' }],
  ]);
  const result = renderEdits('file.cob', base, edits, anchors);
  assert.deepStrictEqual(result, {
    ok: false,
    reasons: ['the lines the packet quotes from file.cob do not match the base revision'],
  });
});

test('preserves trailing newline when source ends with a blank line (original trailing detection)', () => {
  const base = '      ONE\n';
  const edits = [];
  const anchors = new Map([
    ['a', { path: 'file.cob', quoted: true, line: 1, code: 'ONE' }],
  ]);
  const result = renderEdits('file.cob', base, edits, anchors);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.text.endsWith('\n'), true);
});
