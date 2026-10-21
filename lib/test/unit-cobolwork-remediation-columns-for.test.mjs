// Determines which COBOL column format matches the quoted lines (lib/cobolwork-remediation.mjs columnsFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnsFor } from '../cobolwork-remediation.mjs';

test('returns a reason when no lines are quoted', () => {
  const path = 'test.cob';
  const lines = ['      IDENTIFICATION DIVISION.'];
  const quoted = [];
  const result = columnsFor(path, lines, quoted);
  assert.deepEqual(result, { reason: 'no line of test.cob in the packet shows which columns its code occupies' });
});

test('returns the fixed form when lines fit within 80 characters and match the cut', () => {
  const path = 'test.cob';
  const lines = ['      IDENTIFICATION DIVISION.'];
  const quoted = [{ line: 1, code: 'IDENTIFICATION DIVISION.' }];
  const result = columnsFor(path, lines, quoted);
  assert.deepEqual(result, { name: 'fixed', offset: 6, width: 66, cut: result.cut, fits: result.fits });
  assert.equal(result.name, 'fixed');
  assert.equal(result.offset, 6);
  assert.equal(result.width, 66);
});

test('returns the variable form when lines exceed 80 characters but are not JCL', () => {
  const path = 'test.cob';
  const longLine = '      ' + 'A'.repeat(100);
  const lines = [longLine];
  const quoted = [{ line: 1, code: 'A'.repeat(100) }];
  const result = columnsFor(path, lines, quoted);
  assert.equal(result.name, 'variable');
  assert.equal(result.offset, 6);
  assert.equal(result.width, 244);
});

test('returns the jcl form when the path matches JCL extensions', () => {
  const path = 'job.jcl';
  const lines = ['//JOBNAME JOB'];
  const quoted = [{ line: 1, code: '//JOBNAME JOB' }];
  const result = columnsFor(path, lines, quoted);
  assert.equal(result.name, 'jcl');
  assert.equal(result.offset, 0);
  assert.equal(result.width, 72);
});

test('returns the free form when lines are long and not JCL', () => {
  const path = 'test.cob';
  const longLine = 'A'.repeat(100);
  const lines = [longLine];
  const quoted = [{ line: 1, code: 'A'.repeat(100) }];
  const result = columnsFor(path, lines, quoted);
  assert.equal(result.name, 'free');
  assert.equal(result.offset, 0);
  assert.equal(result.width, 250);
});

test('returns a reason when quoted lines do not match the base revision', () => {
  const path = 'test.cob';
  const lines = ['      IDENTIFICATION DIVISION.'];
  const quoted = [{ line: 1, code: 'WRONG CODE' }];
  const result = columnsFor(path, lines, quoted);
  assert.deepEqual(result, { reason: 'the lines the packet quotes from test.cob do not match the base revision' });
});

test('returns a reason when the quoted line index is out of bounds', () => {
  const path = 'test.cob';
  const lines = ['      IDENTIFICATION DIVISION.'];
  const quoted = [{ line: 2, code: 'IDENTIFICATION DIVISION.' }];
  const result = columnsFor(path, lines, quoted);
  assert.deepEqual(result, { reason: 'the lines the packet quotes from test.cob do not match the base revision' });
});

test('returns the variable form for a line exactly 80 characters long', () => {
  const path = 'test.cob';
  const line = '      ' + 'A'.repeat(74);
  const lines = [line];
  const quoted = [{ line: 1, code: 'A'.repeat(74) }];
  const result = columnsFor(path, lines, quoted);
  assert.equal(result.name, 'variable');
});

test('returns the variable form for a line 81 characters long', () => {
  const path = 'test.cob';
  const line = '      ' + 'A'.repeat(75);
  const lines = [line];
  const quoted = [{ line: 1, code: 'A'.repeat(75) }];
  const result = columnsFor(path, lines, quoted);
  assert.equal(result.name, 'variable');
});
