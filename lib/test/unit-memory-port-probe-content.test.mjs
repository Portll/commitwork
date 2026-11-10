// A fixed probe sentence repeated and cut to the requested length (lib/memory-port.mjs probeContent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeContent } from '../memory-port.mjs';

const LINE = 'This is a commitwork memory-port capability probe line. It exists only to be written and read back. ';

function countingSize(value) {
  const size = {
    calls: 0,
    valueOf() {
      size.calls += 1;
      return value;
    },
  };
  return size;
}

test('returns an empty string when zero bytes are requested', () => {
  assert.equal(probeContent(0), '');
});

test('returns an empty string when a negative byte count is requested', () => {
  assert.equal(probeContent(-1), '');
});

test('returns only the first character of the sentence when one byte is requested', () => {
  assert.equal(probeContent(1), 'T');
});

test('returns the first ten characters of the sentence when ten bytes are requested', () => {
  assert.equal(probeContent(10), 'This is a ');
});

test('drops the trailing space of the sentence when ninety-nine bytes are requested', () => {
  assert.equal(probeContent(99), LINE.slice(0, -1));
});

test('returns exactly one copy of the sentence when one hundred bytes are requested', () => {
  assert.equal(probeContent(100), LINE);
});

test('starts a second copy of the sentence when one hundred and one bytes are requested', () => {
  assert.equal(probeContent(101), LINE + 'T');
});

test('truncates a fractional byte count toward zero when slicing', () => {
  assert.equal(probeContent(2.5), 'Th');
});

test('reads the size twice in the loop and once in the slice when it equals one sentence length', () => {
  const size = countingSize(100);
  const r = probeContent(size);
  assert.equal(r, LINE);
  assert.equal(size.calls, 3);
});

test('reads the size once in the loop and once in the slice when it is zero', () => {
  const size = countingSize(0);
  const r = probeContent(size);
  assert.equal(r, '');
  assert.equal(size.calls, 2);
});
