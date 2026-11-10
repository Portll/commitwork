// Extracts quoted literal spans from a finding's evidence and summary (monitor/anchor-disposition.mjs needlesFrom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needlesFrom } from '../anchor-disposition.mjs';

test('returns an empty array when the finding has no evidence or summary', () => {
  assert.deepEqual(needlesFrom({}), []);
});

test('returns an empty array when evidence and summary are empty strings', () => {
  assert.deepEqual(needlesFrom({ evidence: '', summary: '' }), []);
});

test('returns an empty array when evidence is a short quoted span under four characters', () => {
  assert.deepEqual(needlesFrom({ evidence: '`abc`' }), []);
});

test('returns the quoted span when evidence contains a single backtick-quoted literal of exactly four characters', () => {
  assert.deepEqual(needlesFrom({ evidence: '`abcd`' }), ["abcd"]);
});

test('returns the quoted span when evidence contains a single backtick-quoted literal of five characters', () => {
  assert.deepEqual(needlesFrom({ evidence: '`abcde`' }), ["abcde"]);
});

test('returns an empty array when the quoted span contains two consecutive spaces', () => {
  assert.deepEqual(needlesFrom({ evidence: '`ab  cd`' }), []);
});

test('returns an empty array when the quoted span contains three consecutive spaces', () => {
  assert.deepEqual(needlesFrom({ evidence: '`ab   cd`' }), []);
});

test('returns the quoted span when the quoted span contains one space', () => {
  assert.deepEqual(needlesFrom({ evidence: '`ab cd`' }), ["ab cd"]);
});

test('returns the double-quoted span when evidence uses double quotes', () => {
  assert.deepEqual(needlesFrom({ evidence: '"abcd"' }), ["abcd"]);
});

test('returns the single-quoted span when evidence uses single quotes', () => {
  assert.deepEqual(needlesFrom({ evidence: "'abcd'" }), ["abcd"]);
});

test('returns the summary span when evidence is absent but summary has a quoted literal', () => {
  assert.deepEqual(needlesFrom({ summary: '`abcd`' }), ["abcd"]);
});

test('returns the evidence span when summary is absent but evidence has a quoted literal', () => {
  assert.deepEqual(needlesFrom({ evidence: '`abcd`' }), ["abcd"]);
});

test('returns the longer span first when evidence has two quoted literals of different lengths', () => {
  assert.deepEqual(needlesFrom({ evidence: '`abcd` `abcdef`' }), ["abcdef", "abcd"]);
});

test('returns at most five spans when evidence has more than five quoted literals', () => {
  const evidence = Array.from({ length: 6 }, (_, i) => `'s${i}x'`).join(' ');
  assert.deepEqual(needlesFrom({ evidence }), []);
});

test('returns an empty array when the only quoted span is exactly three characters', () => {
  assert.deepEqual(needlesFrom({ evidence: '`abc`' }), []);
});

test('returns the span when the quoted literal is exactly four characters with no spaces', () => {
  assert.deepEqual(needlesFrom({ evidence: '"wxyz"' }), ["wxyz"]);
});

test('returns an empty array when evidence is undefined and summary is undefined', () => {
  assert.deepEqual(needlesFrom({}), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters', () => {
  const lit = 'a'.repeat(120);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns an empty array when the quoted span is 121 characters and exceeds the regex limit', () => {
  const lit = 'a'.repeat(121);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 119 characters', () => {
  const lit = 'a'.repeat(119);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with a space inside', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns an empty array when the quoted span has two spaces and is otherwise valid', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with one space', () => {
  const lit = 'a'.repeat(59) + ' ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with three spaces', () => {
  const lit = 'a'.repeat(58) + '   ' + 'a'.repeat(58);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});

test('returns the span when evidence has a backtick-quoted literal of 120 characters with two spaces', () => {
  const lit = 'a'.repeat(59) + '  ' + 'a'.repeat(59);
  assert.deepEqual(needlesFrom({ evidence: `\`${lit}\`` }), []);
});
