// bin/test/node-hazards-units.test.mjs — case tests for suppressionFor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { suppressionFor } from '../node-hazards.mjs';

test('returns null when index is out of bounds', () => {
  assert.equal(suppressionFor(['code'], 1), null);
});

test('returns null when line is not a string', () => {
  assert.equal(suppressionFor([null], 0), null);
});

test('detects cw-hazards-ignore on the same line', () => {
  const lines = ['// cw-hazards-ignore: tested'];
  const res = suppressionFor(lines, 0);
  assert.equal(res.marker, 'cw-hazards-ignore');
  assert.equal(res.justification, 'tested');
  assert.equal(res.ownLine, true);
});

test('detects nosemgrep on the same line', () => {
  const lines = ['// nosemgrep: reason here'];
  const res = suppressionFor(lines, 0);
  assert.equal(res.marker, 'nosemgrep');
  assert.equal(res.justification, 'reason here');
  assert.equal(res.ownLine, true);
});

test('detects codeql marker on the same line', () => {
  const lines = ['// codeql[disable]: because'];
  const res = suppressionFor(lines, 0);
  assert.equal(res.marker, 'codeql[disable]');
  assert.equal(res.justification, 'because');
  assert.equal(res.ownLine, true);
});

test('detects suppression in comment block above', () => {
  const lines = [
    'code line',
    '// cw-hazards-ignore: above reason',
    'target line'
  ];
  const res = suppressionFor(lines, 2);
  assert.equal(res.marker, 'cw-hazards-ignore');
  assert.equal(res.justification, 'above reason');
  assert.equal(res.ownLine, false);
});

test('returns null when no suppression markers present', () => {
  const lines = ['code line', '// just a comment', 'another line'];
  assert.equal(suppressionFor(lines, 2), null);
});

test('does not treat cw-hazards-ignore-file as line suppression', () => {
  const lines = ['// cw-hazards-ignore-file: whole file'];
  assert.equal(suppressionFor(lines, 0), null);
});
