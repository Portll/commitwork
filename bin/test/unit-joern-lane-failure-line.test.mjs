// The most specific failure line found in tool output, cut to 240 chars (bin/joern-lane.mjs failureLine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { failureLine } from '../joern-lane.mjs';

test('returns null when there are no arguments or every argument is empty', () => {
  assert.equal(failureLine(), null);
  assert.equal(failureLine('', null, undefined, 0), null);
  assert.equal(failureLine('\n   \n'), null);
});

test('returns null when no line matches any failure pattern', () => {
  assert.equal(failureLine('compiling 3 files\ndone in 2s'), null);
  assert.equal(failureLine('an Error occurred'), null);
});

test('ignores WARNING: lines and stack frames that start with at', () => {
  assert.equal(failureLine('WARNING: Could not resolve plugin'), null);
  assert.equal(failureLine('at Exception (Main.java:1)'), null);
  assert.equal(failureLine('WARNING: Could not load\n    at Exception (Main.java:1)\nError: boom'), 'Error: boom');
});

test('keeps lines that only resemble a warning or a stack frame', () => {
  assert.equal(failureLine('WARNING Could not resolve plugin'), 'WARNING Could not resolve plugin');
  assert.equal(failureLine('warning: Could not open'), 'warning: Could not open');
  assert.equal(failureLine('attach Exception raised'), 'attach Exception raised');
});

test('strips a leading pipe before filtering and matching', () => {
  assert.equal(failureLine('|   Error: boom'), 'Error: boom');
  assert.equal(failureLine('| WARNING: Could not load\n| at Exception (x)'), null);
});

test('prefers is not a member over ERROR, then Exception, then Error lines', () => {
  const lines = ['Error: E008 in script.sc', '[ERROR] compile failed', 'java.lang.Exception: boom', 'value foo is not a member of Cpg'];
  assert.equal(failureLine(lines.join('\n')), 'value foo is not a member of Cpg');
  assert.equal(failureLine(lines.slice(0, 3).join('\n')), '[ERROR] compile failed');
  assert.equal(failureLine([lines[0], lines[2]].join('\n')), 'java.lang.Exception: boom');
  assert.equal(failureLine(lines[0]), 'Error: E008 in script.sc');
  assert.equal(failureLine('Build ERROR here'), 'Build ERROR here');
});

test('matches Error at line start or not found anywhere, ignoring case', () => {
  assert.equal(failureLine('error: bad input'), 'error: bad input');
  assert.equal(failureLine('module NOT FOUND here'), 'module NOT FOUND here');
});

test('searches the lines of every argument together and returns the first match', () => {
  assert.equal(failureLine('Exception: first', Buffer.from('value x is not a member of y')), 'value x is not a member of y');
  assert.equal(failureLine('Error: one\nError: two', 'Error: three'), 'Error: one');
});

test('trims the returned line and cuts it to 240 characters', () => {
  assert.equal(failureLine('   Error: boom   '), 'Error: boom');
  const exact = 'Error: ' + 'x'.repeat(233);
  assert.equal(failureLine(exact), exact);
  assert.equal(failureLine('Error: ' + 'x'.repeat(234)), exact);
});
