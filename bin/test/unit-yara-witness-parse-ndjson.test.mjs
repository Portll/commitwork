// Parses NDJSON lines into records and counts unparsed lines (bin/yara-witness.mjs parseNdjson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNdjson } from '../yara-witness.mjs';

test('empty input yields no records and zero unparsed', () => {
  const result = parseNdjson('');
  assert.deepStrictEqual(result, { records: [], unparsed: 0 });
});

test('lines containing only whitespace are ignored and do not increase unparsed', () => {
  const result = parseNdjson('   \n\t\r\n  ');
  assert.deepStrictEqual(result, { records: [], unparsed: 0 });
});

test('a line with leading and trailing spaces that is valid JSON is recorded', () => {
  const result = parseNdjson('  {"path":"x","rules":["r"]}  ');
  assert.deepStrictEqual(result, { records: [{ path: 'x', rules: ['r'] }], unparsed: 0 });
});

test('the literal JSON value null is parsed but counted as unparsed', () => {
  const result = parseNdjson('null');
  assert.deepStrictEqual(result, { records: [], unparsed: 1 });
});

test('an object missing the required path property is counted as unparsed', () => {
  const result = parseNdjson('{"rules":[]}');
  assert.deepStrictEqual(result, { records: [], unparsed: 1 });
});

test('an object whose path property is not a string is counted as unparsed', () => {
  const result = parseNdjson('{"path":123,"rules":[]}');
  assert.deepStrictEqual(result, { records: [], unparsed: 1 });
});

test('an object whose rules property is not an array is counted as unparsed', () => {
  const result = parseNdjson('{"path":"a","rules":"notarray"}');
  assert.deepStrictEqual(result, { records: [], unparsed: 1 });
});

test('mixed input with CRLF, whitespace, valid and invalid lines yields correct records and unparsed count', () => {
  const input = [
    '',
    '   ',
    '{"path":"a","rules":["r1"]}',
    '{"path":"b","rules":"bad"}',
    '{invalid json}',
    'null',
    '{"path":"c","rules":[]}'
  ].join('\r\n');
  const result = parseNdjson(input);
  assert.deepStrictEqual(result, {
    records: [
      { path: 'a', rules: ['r1'] },
      { path: 'c', rules: [] }
    ],
    unparsed: 3
  });
});
