// Parses a block-YAML document into a typed node tree with line numbers (bin/actions-gaps.mjs parseYaml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../actions-gaps.mjs';

test('parses a simple mapping with scalar values', () => {
  const result = parseYaml('a: 1\nb: two');
  assert.equal(result.type, 'map');
  assert.equal(result.line, 1);
  assert.equal(result.entries.size, 2);
  assert.deepEqual(result.entries.get('a'), { type: 'scalar', line: 1, value: '1' });
  assert.deepEqual(result.entries.get('b'), { type: 'scalar', line: 2, value: 'two' });
});

test('parses a sequence of scalars', () => {
  const result = parseYaml('- one\n- two');
  assert.equal(result.type, 'seq');
  assert.equal(result.line, 1);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items[0], { type: 'scalar', line: 1, value: 'one' });
  assert.deepEqual(result.items[1], { type: 'scalar', line: 2, value: 'two' });
});

test('parses a mapping containing a nested sequence', () => {
  const result = parseYaml('key:\n  - a\n  - b');
  assert.equal(result.type, 'map');
  const val = result.entries.get('key');
  assert.equal(val.type, 'seq');
  assert.equal(val.line, 2);
  assert.deepEqual(val.items[0], { type: 'scalar', line: 2, value: 'a' });
  assert.deepEqual(val.items[1], { type: 'scalar', line: 3, value: 'b' });
});

test('parses a sequence containing nested mappings', () => {
  const result = parseYaml('- a: 1\n  b: 2\n- c: 3');
  assert.equal(result.type, 'seq');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].type, 'map');
  assert.deepEqual(result.items[0].entries.get('a'), { type: 'scalar', line: 1, value: '1' });
  assert.deepEqual(result.items[0].entries.get('b'), { type: 'scalar', line: 2, value: '2' });
  assert.equal(result.items[1].type, 'map');
  assert.deepEqual(result.items[1].entries.get('c'), { type: 'scalar', line: 3, value: '3' });
});

test('parses flow sequence and flow mapping scalars', () => {
  const result = parseYaml('list: [1, 2, 3]\nobj: {x: 1, y: 2}');
  assert.equal(result.type, 'map');
  const list = result.entries.get('list');
  assert.equal(list.type, 'seq');
  assert.deepEqual(list.items, [
    { type: 'scalar', line: 1, value: '1' },
    { type: 'scalar', line: 1, value: '2' },
    { type: 'scalar', line: 1, value: '3' }
  ]);
  const obj = result.entries.get('obj');
  assert.equal(obj.type, 'map');
  assert.deepEqual(obj.entries.get('x'), { type: 'scalar', line: 2, value: '1' });
  assert.deepEqual(obj.entries.get('y'), { type: 'scalar', line: 2, value: '2' });
});

test('parses block scalars with literal and folded indicators', () => {
  const result = parseYaml('a: |\n  line1\n  line2\nb: >\n  text');
  assert.equal(result.type, 'map');
  const a = result.entries.get('a');
  assert.equal(a.type, 'scalar');
  assert.equal(a.block, true);
  assert.equal(a.value, '  line1\n  line2');
  const b = result.entries.get('b');
  assert.equal(b.type, 'scalar');
  assert.equal(b.block, true);
  assert.equal(b.value, '  text');
});

test('handles quoted keys and values with unquoting', () => {
  const result = parseYaml('"key": "value"\n\'single\': \'it\'\'s\'');
  assert.equal(result.type, 'map');
  assert.deepEqual(result.entries.get('key'), { type: 'scalar', line: 1, value: 'value' });
  assert.deepEqual(result.entries.get('single'), { type: 'scalar', line: 2, value: "it's" });
});

test('strips comments and ignores document markers', () => {
  const result = parseYaml('---\na: 1 # comment\n\nb: 2');
  assert.equal(result.type, 'map');
  assert.equal(result.entries.size, 2);
  assert.deepEqual(result.entries.get('a'), { type: 'scalar', line: 2, value: '1' });
  assert.deepEqual(result.entries.get('b'), { type: 'scalar', line: 4, value: '2' });
});

test('returns empty map for empty input', () => {
  const result = parseYaml('');
  assert.equal(result.type, 'map');
  assert.equal(result.line, 0);
  assert.equal(result.entries.size, 0);
});

test('throws on unexpected indentation after a mapping', () => {
  assert.throws(() => parseYaml('a: 1\n  b: 2'), /unexpected indentation/);
});
