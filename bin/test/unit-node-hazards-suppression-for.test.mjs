// Finds a suppression marker on the current line or a preceding comment line (bin/node-hazards.mjs suppressionFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suppressionFor } from '../node-hazards.mjs';

test('returns null when the target line is not a string', () => {
  const lines = ['code', null, 'code'];
  assert.deepEqual(suppressionFor(lines, 1), null);
});

test('returns a marker object when the target line contains a suppression marker', () => {
  const lines = ['code', '// cw-hazards-ignore: reason here', 'code'];
  assert.deepEqual(suppressionFor(lines, 1), { marker: "cw-hazards-ignore", justification: "reason here", ownLine: true });
});

test('returns null when the target line has no marker and no preceding comment', () => {
  const lines = ['code', 'code', 'code'];
  assert.deepEqual(suppressionFor(lines, 1), null);
});

test('returns a marker from a preceding comment line', () => {
  const lines = ['// cw-hazards-ignore: reason', 'code'];
  assert.deepEqual(suppressionFor(lines, 1), { marker: "cw-hazards-ignore", justification: "reason", ownLine: false });
});

test('returns null when the preceding line is not a comment', () => {
  const lines = ['code', 'code'];
  assert.deepEqual(suppressionFor(lines, 1), null);
});

test('returns a marker from a comment at index zero', () => {
  const lines = ['// cw-hazards-ignore: reason', 'code'];
  assert.deepEqual(suppressionFor(lines, 1), { marker: "cw-hazards-ignore", justification: "reason", ownLine: false });
});

test('returns a marker with no reason when the marker has no justification text', () => {
  const lines = ['code', '// cw-hazards-ignore', 'code'];
  assert.deepEqual(suppressionFor(lines, 1), { marker: "cw-hazards-ignore", justification: "(no reason given)", ownLine: true });
});

test('returns a marker from a block comment line', () => {
  const lines = ['/* cw-hazards-ignore: reason */', 'code'];
  assert.deepEqual(suppressionFor(lines, 1), { marker: "cw-hazards-ignore", justification: "reason */", ownLine: false });
});

test('returns a marker from a line comment with asterisk prefix', () => {
  const lines = ['* cw-hazards-ignore: reason', 'code'];
  assert.deepEqual(suppressionFor(lines, 1), { marker: "cw-hazards-ignore", justification: "reason", ownLine: false });
});

test('returns null when the target line is undefined', () => {
  const lines = ['code', undefined, 'code'];
  assert.deepEqual(suppressionFor(lines, 1), null);
});
