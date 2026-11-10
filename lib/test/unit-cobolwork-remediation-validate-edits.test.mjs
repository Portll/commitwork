// Validates a draft of edits against quoted anchors, dropping no-op replaces and enforcing count, line, and content limits. (lib/cobolwork-remediation.mjs validateEdits).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEdits } from '../cobolwork-remediation.mjs';

const A = (path, line, extra = {}) => new Map([[`${path}:${line}`, { path, line, ...extra }]]);

test('rejects a draft with no edits', () => {
  assert.deepEqual(validateEdits({ edits: [] }, new Map()), { ok: false, reasons: ['the draft has no edits'] });
});

test('rejects a draft whose only edit is a no-op replace', () => {
  const anchors = A('f.cob', 1, { quoted: true, code: 'X' });
  const draft = { edits: [{ path: 'f.cob', line: 1, op: 'replace', code: ['X'] }] };
  assert.deepEqual(validateEdits(draft, anchors), { ok: false, reasons: ['the draft changes nothing: every edit writes a line back as it reads'] });
});

test('rejects a draft with more than twelve edits', () => {
  const anchors = new Map();
  for (let i = 1; i <= 13; i++) anchors.set(`f.cob:${i}`, { path: 'f.cob', line: i, quoted: true, code: `L${i}` });
  const edits = Array.from({ length: 13 }, (_, i) => ({ path: 'f.cob', line: i + 1, op: 'insert-before', code: ['x'] }));
  const r = validateEdits({ edits }, anchors);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['the draft has 13 edits; at most 12']);
});

test('accepts twelve edits that stay within the new-line budget', () => {
  const anchors = new Map();
  for (let i = 1; i <= 12; i++) anchors.set(`f.cob:${i}`, { path: 'f.cob', line: i, quoted: true, code: `L${i}` });
  const edits = Array.from({ length: 12 }, (_, i) => ({ path: 'f.cob', line: i + 1, op: 'insert-before', code: ['x'] }));
  const r = validateEdits({ edits }, anchors);
  assert.equal(r.ok, true);
  assert.equal(r.edits.length, 12);
  assert.equal(r.edits[0].line, 1);
});

test('rejects an edit whose line is not in the anchors', () => {
  const anchors = A('f.cob', 1, { quoted: true, code: 'X' });
  const r = validateEdits({ edits: [{ path: 'f.cob', line: 99, op: 'insert-before', code: ['x'] }] }, anchors);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['edit 1: line 99 of that file is not a line the packet quotes or names, so it cannot be edited']);
});

test('rejects an edit on a withheld line', () => {
  const anchors = A('f.cob', 1, { quoted: true, code: 'X', withheld: true });
  const r = validateEdits({ edits: [{ path: 'f.cob', line: 1, op: 'insert-before', code: ['x'] }] }, anchors);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['edit 1: line 1 was withheld from the packet because the hidden-content rules flagged it, so it cannot be edited']);
});

test('rejects a replace on a named but unquoted line', () => {
  const anchors = A('f.cob', 1, { quoted: false, code: 'X' });
  const r = validateEdits({ edits: [{ path: 'f.cob', line: 1, op: 'replace', code: ['y'] }] }, anchors);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['edit 1: line 1 is a declaration the packet names but does not quote; lines may be put before or after it, not replace or delete it']);
});

test('rejects a delete that carries code', () => {
  const anchors = A('f.cob', 1, { quoted: true, code: 'X' });
  const r = validateEdits({ edits: [{ path: 'f.cob', line: 1, op: 'delete', code: ['x'] }] }, anchors);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['edit 1: a delete carries no code']);
});

test('rejects an insert that carries no code', () => {
  const anchors = A('f.cob', 1, { quoted: true, code: 'X' });
  const r = validateEdits({ edits: [{ path: 'f.cob', line: 1, op: 'insert-before', code: [] }] }, anchors);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['edit 1: an insert-before carries at least one code line']);
});

test('rejects a second edit on the same line that is already replaced', () => {
  const anchors = A('f.cob', 1, { quoted: true, code: 'X' });
  const edits = [
    { path: 'f.cob', line: 1, op: 'replace', code: ['a'] },
    { path: 'f.cob', line: 1, op: 'delete', code: [] },
  ];
  const r = validateEdits({ edits }, anchors);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['edit 2: line 1 is already replaced or deleted by another edit']);
});

test('rejects code containing a non-printable character', () => {
  const anchors = A('f.cob', 1, { quoted: true, code: 'X' });
  const r = validateEdits({ edits: [{ path: 'f.cob', line: 1, op: 'insert-before', code: ['a\x01b'] }] }, anchors);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['edit 1: code line 1 holds a character outside printable ASCII']);
});

test('rejects a draft that writes more than sixty new lines', () => {
  const anchors = A('f.cob', 1, { quoted: true, code: 'X' });
  const code = Array.from({ length: 61 }, () => 'x');
  const r = validateEdits({ edits: [{ path: 'f.cob', line: 1, op: 'insert-before', code }] }, anchors);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['the draft writes 61 lines; at most 60']);
});

test('accepts a draft that writes exactly sixty new lines', () => {
  const anchors = A('f.cob', 1, { quoted: true, code: 'X' });
  const code = Array.from({ length: 60 }, () => 'x');
  const r = validateEdits({ edits: [{ path: 'f.cob', line: 1, op: 'insert-before', code }] }, anchors);
  assert.equal(r.ok, true);
  assert.equal(r.edits[0].code.length, 60);
});

test('rejects a partial delete of a multi-line statement', () => {
  const anchors = new Map([
    ['f.cob:10', { path: 'f.cob', line: 10, quoted: true, code: 'A', stmt: [10, 12] }],
    ['f.cob:11', { path: 'f.cob', line: 11, quoted: true, code: 'B', stmt: [10, 12] }],
  ]);
  const edits = [
    { path: 'f.cob', line: 10, op: 'delete', code: [] },
    { path: 'f.cob', line: 11, op: 'delete', code: [] },
  ];
  const r = validateEdits({ edits }, anchors);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['lines 10 to 12 of f.cob are one statement; delete every one of them or none, not lines 10, 11']);
});

test('accepts a complete delete of a multi-line statement', () => {
  const anchors = new Map([
    ['f.cob:10', { path: 'f.cob', line: 10, quoted: true, code: 'A', stmt: [10, 12] }],
    ['f.cob:11', { path: 'f.cob', line: 11, quoted: true, code: 'B', stmt: [10, 12] }],
    ['f.cob:12', { path: 'f.cob', line: 12, quoted: true, code: 'C', stmt: [10, 12] }],
  ]);
  const edits = [
    { path: 'f.cob', line: 10, op: 'delete', code: [] },
    { path: 'f.cob', line: 11, op: 'delete', code: [] },
    { path: 'f.cob', line: 12, op: 'delete', code: [] },
  ];
  const r = validateEdits({ edits }, anchors);
  assert.equal(r.ok, true);
  assert.equal(r.edits.length, 3);
});

test('maps an insert-after to the last line of the statement', () => {
  const anchors = A('f.cob', 10, { quoted: true, code: 'A', stmt: [10, 12] });
  const r = validateEdits({ edits: [{ path: 'f.cob', line: 10, op: 'insert-after', code: ['x'] }] }, anchors);
  assert.equal(r.ok, true);
  assert.equal(r.edits[0].line, 12);
});

test('maps an insert-before to the first line of the statement', () => {
  const anchors = A('f.cob', 12, { quoted: true, code: 'C', stmt: [10, 12] });
  const r = validateEdits({ edits: [{ path: 'f.cob', line: 12, op: 'insert-before', code: ['x'] }] }, anchors);
  assert.equal(r.ok, true);
  assert.equal(r.edits[0].line, 10);
});

test('rejects an edit with a non-integer line', () => {
  const anchors = A('f.cob', 1, { quoted: true, code: 'X' });
  const r = validateEdits({ edits: [{ path: 'f.cob', line: 1.5, op: 'insert-before', code: ['x'] }] }, anchors);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['edit 1 needs a path, an integer line and an op of insert-before, insert-after, replace, delete']);
});

test('rejects an edit with an unknown op', () => {
  const anchors = A('f.cob', 1, { quoted: true, code: 'X' });
  const r = validateEdits({ edits: [{ path: 'f.cob', line: 1, op: 'frobnicate', code: ['x'] }] }, anchors);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['edit 1 needs a path, an integer line and an op of insert-before, insert-after, replace, delete']);
});

test('rejects an edit whose code contains a non-string', () => {
  const anchors = A('f.cob', 1, { quoted: true, code: 'X' });
  const r = validateEdits({ edits: [{ path: 'f.cob', line: 1, op: 'insert-before', code: [42] }] }, anchors);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['edit 1: every code line is a string']);
});
