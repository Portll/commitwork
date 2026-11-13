// Parses a YAML string into an AST with line/column positions (lib/actions-yaml.mjs parseYaml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../actions-yaml.mjs';

test('throws TypeError when input is not a string', () => {
  assert.throws(() => parseYaml(123), { name: 'TypeError', message: 'parseYaml expects a string' });
});

test('parses empty string as null scalar at line 0 col 0', () => {
  const result = parseYaml('');
  assert.deepEqual(result, {
    type: 'scalar',
    line: 0,
    col: 0,
    value: null,
    raw: '',
    source: '',
    style: 'plain'
  });
});

test('parses plain scalar string', () => {
  const result = parseYaml('hello');
  assert.deepEqual(result, {
    type: 'scalar',
    line: 1,
    col: 1,
    value: 'hello',
    raw: 'hello',
    source: 'hello',
    style: 'plain'
  });
});

test('parses block sequence with two items', () => {
  const result = parseYaml('- a\n- b');
  assert.deepEqual(result, {
    type: 'seq',
    line: 1,
    col: 1,
    items: [
      { type: 'scalar', line: 1, col: 3, value: 'a', raw: 'a', source: 'a', style: 'plain' },
      { type: 'scalar', line: 2, col: 3, value: 'b', raw: 'b', source: 'b', style: 'plain' }
    ]
  });
});

test('parses block mapping with two entries', () => {
  const result = parseYaml('a: 1\nb: 2');
  assert.deepEqual(result, {
    type: 'map',
    line: 1,
    col: 1,
    entries: [
      { key: { type: 'scalar', line: 1, col: 1, value: 'a', raw: 'a', source: 'a', style: 'plain' }, value: { type: 'scalar', line: 1, col: 4, value: 1, raw: '1', source: '1', style: 'plain' } },
      { key: { type: 'scalar', line: 2, col: 1, value: 'b', raw: 'b', source: 'b', style: 'plain' }, value: { type: 'scalar', line: 2, col: 4, value: 2, raw: '2', source: '2', style: 'plain' } }
    ]
  });
});

test('parses flow sequence with two items', () => {
  const result = parseYaml('[a, b]');
  assert.deepEqual(result, {
    type: 'seq',
    line: 1,
    col: 1,
    items: [
      { type: 'scalar', line: 1, col: 2, value: 'a', raw: 'a', source: 'a', style: 'plain' },
      { type: 'scalar', line: 1, col: 5, value: 'b', raw: 'b', source: 'b', style: 'plain' }
    ]
  });
});

test('parses double-quoted scalar with newline escape', () => {
  const result = parseYaml('"a\\nb"');
  assert.deepEqual(result, {
    type: 'scalar',
    line: 1,
    col: 1,
    value: 'a\nb',
    raw: 'a\nb',
    source: '"a\\nb"',
    style: 'double'
  });
});

test('throws on duplicate mapping key', () => {
  assert.throws(() => parseYaml('a: 1\na: 2'), { name: 'YamlError', message: "line 2: duplicate key 'a'" });
});

test('throws on tab used for indentation', () => {
  assert.throws(() => parseYaml('a:\n\tb: 1'), { name: 'YamlError', message: 'line 2: tab used for indentation' });
});

test('parses document with BOM and shifts first line columns', () => {
  const result = parseYaml('\uFEFFa: 1');
  assert.deepEqual(result, {
    type: 'map',
    line: 1,
    col: 2,
    entries: [
      { key: { type: 'scalar', line: 1, col: 2, value: 'a', raw: 'a', source: 'a', style: 'plain' }, value: { type: 'scalar', line: 1, col: 5, value: 1, raw: '1', source: '1', style: 'plain' } }
    ]
  });
});
