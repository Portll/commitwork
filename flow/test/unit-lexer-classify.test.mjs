// Splits JavaScript source into comment, string, template and regex spans (flow/lexer.mjs classify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../lexer.mjs';

const run = (src) => {
  const r = classify(src);
  return { ok: r.ok, reason: r.reason, spans: r.spans };
};
const okWith = (spans) => ({ ok: true, reason: null, spans });
const fail = (reason, spans) => ({ ok: false, reason, spans });
const line = (start, end) => ({ kind: 'line', start, end, innerStart: start + 2, innerEnd: end, quote: null, value: null });
const str = (start, end, quote, value) => ({
  kind: 'string', start, end, innerStart: start + 1, innerEnd: end - 1, quote, value, interpolated: false,
});
const tpl = (start, end, innerEnd, value, interpolated, chunkOf) => ({
  kind: 'template', start, end, innerStart: start + 1, innerEnd, quote: '`', value, interpolated, chunkOf,
});
const rx = (start, end, innerEnd) => ({ kind: 'regex', start, end, innerStart: start + 1, innerEnd, quote: '/', value: null });

test('A hashbang line becomes a line span and lexing continues after it', () => {
  const src = '#!/usr/bin/env node\nlet x = 1;';
  assert.deepEqual(run(src), okWith([line(0, 19)]));
  assert.deepEqual(run('#!x'), okWith([line(0, 3)]));
  const r = classify(src);
  assert.equal(r.lineOf(19), 1);
  assert.equal(r.lineOf(20), 2);
});

test('Line comments run to the newline or end of input and block comments run to their closer', () => {
  assert.deepEqual(run('// hi\n/* block */ let a;'), okWith([
    line(0, 5),
    { kind: 'block', start: 6, end: 17, innerStart: 8, innerEnd: 15, quote: null, value: null },
  ]));
  assert.deepEqual(run('a // x'), okWith([line(2, 6)]));
});

test('An unterminated block comment bails at its opening offset', () => {
  assert.deepEqual(run('/* oops'), fail('unterminated block comment at offset 0', []));
});

test('Quoted strings are recorded with cooked values and null for unknown escapes', () => {
  assert.deepEqual(run('"a\\nb"'), okWith([str(0, 6, '"', 'a\nb')]));
  assert.deepEqual(run("'it\\'s'"), okWith([str(0, 7, "'", "it's")]));
  assert.deepEqual(run('"\\q"'), okWith([str(0, 4, '"', null)]));
});

test('Unterminated strings bail, including ones cut off by a newline', () => {
  assert.deepEqual(run("'abc"), fail('unterminated single-quoted string at offset 0', []));
  assert.deepEqual(run('"x'), fail('unterminated double-quoted string at offset 0', []));
  assert.deepEqual(run("'ab\ncd'"), fail('unterminated single-quoted string at offset 0', []));
});

test('Template literals are split into chunks around each substitution', () => {
  assert.deepEqual(run('`a${x}b`'), okWith([
    tpl(0, 4, 2, 'a', true, 0),
    tpl(5, 8, 7, 'b', true, 0),
  ]));
  assert.deepEqual(run('`a${1}b${2}c`'), okWith([
    tpl(0, 4, 2, 'a', true, 0),
    tpl(5, 9, 7, 'b', true, 0),
    tpl(10, 13, 12, 'c', true, 0),
  ]));
  assert.deepEqual(run('`plain`'), okWith([tpl(0, 7, 6, 'plain', false, null)]));
});

test('Braces nested inside a substitution stay code until the matching close brace', () => {
  assert.deepEqual(run('`${{}}`'), okWith([
    tpl(0, 3, 1, '', true, 0),
    tpl(5, 7, 6, '', true, 0),
  ]));
});

test('Template literals left open bail at the offset of their opening backtick', () => {
  assert.deepEqual(run('`abc'), fail('unterminated template literal at offset 0', []));
  assert.deepEqual(run('x`a${y}b'), fail('unterminated template literal at offset 1', [
    tpl(1, 5, 3, 'a', true, 0),
  ]));
  assert.deepEqual(run('`${x'), fail('unterminated template literal at offset 0', [
    tpl(0, 3, 1, '', true, 0),
  ]));
});

test('A slash after a keyword, an operator or a closing brace starts a regex literal', () => {
  assert.deepEqual(run('return /a/;'), okWith([rx(7, 10, 9)]));
  assert.deepEqual(run('x = /[/]\\//gi'), okWith([rx(4, 13, 10)]));
  assert.deepEqual(run('{}/a/'), okWith([rx(2, 5, 4)]));
});

test('A slash after a value or closing paren is division and an open regex bails', () => {
  assert.deepEqual(run('1 / 2'), okWith([]));
  assert.deepEqual(run('f(a) / b'), okWith([]));
  assert.deepEqual(run('"a" / 2'), okWith([str(0, 3, '"', 'a')]));
  assert.deepEqual(run('return /a'), fail('unterminated regex literal at offset 7', []));
  assert.deepEqual(run('x = /a\n/'), fail('unterminated regex literal at offset 4', []));
});
