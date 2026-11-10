// strips comment lines and the commit -v diff below the scissors (bin/commit-msg.mjs cleanMessage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMessage } from '../commit-msg.mjs';

const SCISSORS = '# ------------------------ >8 ------------------------';

test('returns a newline for empty input', () => {
  assert.equal(cleanMessage(''), '\n');
});

test('returns a newline for null input', () => {
  assert.equal(cleanMessage(null), '\n');
});

test('returns a newline for undefined input', () => {
  assert.equal(cleanMessage(undefined), '\n');
});

test('keeps a single subject line and appends a newline', () => {
  assert.equal(cleanMessage('feat: add thing'), 'feat: add thing\n');
});

test('normalizes CRLF line endings before processing', () => {
  assert.equal(cleanMessage('feat: add\r\nthing'), 'feat: add\nthing\n');
});

test('removes comment lines from the message', () => {
  assert.equal(cleanMessage('feat: add\n# a comment\nthing'), 'feat: add\nthing\n');
});

test('keeps lines before the scissors and drops the diff below it', () => {
  const input = `feat: add\n# comment\n${SCISSORS}\ndiff --git a/x b/x\n+1`;
  assert.equal(cleanMessage(input), 'feat: add\n');
});

test('drops the diff below a scissors line with a custom comment character', () => {
  const scissors = '; ------------------------ >8 ------------------------';
  const input = `feat: add\n; comment\n${scissors}\ndiff --git a/x b/x\n+1`;
  assert.equal(cleanMessage(input, ';'), 'feat: add\n');
});

test('keeps all lines when no scissors line is present', () => {
  const input = `feat: add\n# comment\n${SCISSORS.replace('>8', '>=8')}\ndiff --git a/x b/x\n+1`;
  assert.equal(cleanMessage(input), 'feat: add\ndiff --git a/x b/x\n+1\n');
});

test('trims trailing whitespace from the message', () => {
  assert.equal(cleanMessage('feat: add   \n'), 'feat: add\n');
});
