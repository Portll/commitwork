// Parses raw terminal input into a list of logical key names (bin/lib/brief-tui.mjs parseKeys).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKeys } from '../lib/brief-tui.mjs';

test('parses arrow and navigation sequences', () => {
  const input = '\x1b[A\x1b[B\x1b[C\x1b[D\x1b[5~\x1b[6~\x1b[H\x1b[1~\x1b[F\x1b[4~\x1b[Z';
  assert.deepEqual(parseKeys(input), ["up", "down", "next", "prev", "pgup", "pgdn", "home", "home", "end", "end", "prev"]);
});

test('parses application mode sequences', () => {
  const input = '\x1bOA\x1bOB\x1bOC\x1bOD';
  assert.deepEqual(parseKeys(input), ["up", "down", "next", "prev"]);
});

test('parses single character keys', () => {
  const input = 'kjgG b\tlh\r\nq\x03\x04?';
  assert.deepEqual(parseKeys(input), ["up", "down", "home", "end", "pgdn", "pgup", "next", "next", "prev", "enter", "enter", "quit", "quit", "quit", "help"]);
});

test('parses digit keys as sections', () => {
  const input = '123456789';
  assert.deepEqual(parseKeys(input), ["section1", "section2", "section3", "section4", "section5", "section6", "section7", "section8", "section9"]);
});

test('handles unknown escape sequences', () => {
  const input = '\x1b[99~\x1bOZ';
  assert.deepEqual(parseKeys(input), []);
});

test('handles bare escape as quit', () => {
  const input = '\x1b';
  assert.deepEqual(parseKeys(input), ["quit"]);
});

test('handles empty input', () => {
  assert.deepEqual(parseKeys(''), []);
});

test('handles mixed input with unknown and known keys', () => {
  const input = 'a\x1b[99~b\x1bOZc';
  assert.deepEqual(parseKeys(input), ["pgup"]);
});
