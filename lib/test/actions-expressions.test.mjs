// Tests for the Actions expression language: lexing, parsing, coercion and the string transform
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lexExpression, parseExpression, evaluateExpression, templateExpression, expressionSites,
  containsStatusFunction, splitAllowedContext, Dict, Filtered, toValue, toPlain, toJson, coerceString, ExpressionError,
} from '../actions-expressions.mjs';

const ctx = { github: { event_name: 'push', ref: 'refs/heads/main', sha: 'abc', list: [1, 2, { n: 'q' }], rows: [{ y: 1 }, { y: 2 }, { z: 3 }] }, matrix: { node: 20 }, env: { EMPTY: '' } };
const ev = (src, functions) => evaluateExpression(src, ctx, { functions });

test('lexer: numbers, strings, identifiers and keywords', () => {
  const types = (s) => lexExpression(s).map((t) => t.type).join(' ');
  assert.equal(types("1 == '1'"), 'number equalEqual string eof');
  assert.equal(types('github.ref'), 'identifier dot identifier eof');
  assert.equal(types('a.true'), 'identifier dot identifier eof');
  assert.equal(types('true && !false || null'), 'true and bang false or null eof');
  assert.equal(types('.5'), 'number eof');
  assert.equal(types('+1 -1'), 'number number eof');
  assert.throws(() => lexExpression('1 + 1'), /Unexpected symbol: '\+'/);
  assert.equal(types('x[*].y'), 'identifier lbracket star rbracket dot identifier eof');
  assert.equal(lexExpression("'it''s'")[0].value, "it's");
  assert.equal(lexExpression('0x1F')[0].value, 31);
  assert.equal(lexExpression('1e3')[0].value, 1000);
  assert.equal(lexExpression('-2.5')[0].value, -2.5);
  assert.ok(Number.isNaN(lexExpression('NaN')[0].value));
  assert.equal(lexExpression('Infinity')[0].value, Infinity);
});

test('lexer: illegal symbols fail with their position', () => {
  assert.throws(() => lexExpression('a = b'), /Unexpected symbol: '='. Located at position 3/);
  assert.throws(() => lexExpression("'open"), /Unexpected symbol/);
  assert.throws(() => lexExpression('1x'), /Unexpected symbol: '1x'/);
  assert.throws(() => lexExpression('9a-b'), ExpressionError);
  assert.throws(() => lexExpression('a'.repeat(21001)), /max expression length/);
});

test('parser: precedence, grouping and index chains', () => {
  const ast = parseExpression("a || b && c == d > e", { contexts: ['a', 'b', 'c', 'd', 'e'] });
  assert.equal(ast.type, 'logical');
  assert.equal(ast.op, '||');
  assert.equal(ast.args[1].op, '&&');
  assert.equal(ast.args[1].args[1].op, '==');
  assert.equal(ast.args[1].args[1].right.op, '>');
  const chain = parseExpression("github['x'].y[*].z", { contexts: ['github'] });
  assert.equal(chain.type, 'index');
  assert.equal(chain.index.value, 'z');
  assert.equal(chain.expr.index.type, 'star');
});

test('parser: unknown contexts, functions and arities are refused', () => {
  assert.throws(() => parseExpression('nope.x', { contexts: ['github'] }), /Unrecognized named-value: 'nope'/);
  assert.throws(() => parseExpression('hashFiles()', { contexts: [] }), /Unrecognized function/);
  assert.throws(() => parseExpression("contains('a')", { contexts: [] }), /Too few parameters/);
  assert.throws(() => parseExpression("toJSON(1, 2)", { contexts: [] }), /Too many parameters/);
  assert.throws(() => parseExpression("case(true, 1)", { contexts: [] }), /Too few parameters/);
  assert.throws(() => parseExpression("case(true, 1, false, 2)", { contexts: [] }), /odd number/);
  assert.throws(() => parseExpression("(1", { contexts: [] }), /Unexpected end/);
  assert.throws(() => parseExpression("1 2", { contexts: [] }), /Unexpected symbol: '2'/);
  assert.throws(() => parseExpression("1.x", { contexts: [] }), /Unexpected symbol/);
  assert.equal(parseExpression('', { contexts: [] }), undefined);
  assert.throws(() => parseExpression('(' .repeat(60) + '1' + ')'.repeat(60), { contexts: [] }), /max expression depth/);
});

test('parser: function names and contexts are case-insensitive', () => {
  assert.equal(ev("toJSON(1)"), '1');
  assert.equal(ev("TOJSON(1)"), '1');
  assert.equal(ev("GitHub.SHA"), 'abc');
});

test('evaluator: comparison coercion follows the published table', () => {
  assert.equal(ev("1 == '1'"), true);
  assert.equal(ev("'abc' == 'ABC'"), true);
  assert.equal(ev("null == 0"), true);
  assert.equal(ev("'' == 0"), true);
  assert.equal(ev("true == 1"), true);
  assert.equal(ev("'a' < 'B'"), true);
  assert.equal(ev("NaN == NaN"), false);
  assert.equal(ev("NaN != NaN"), true);
  assert.equal(ev("1.0 == 1"), true);
  assert.equal(ev("'x' == 'y'"), false);
  assert.equal(ev("github.list == github.list"), true);
  assert.equal(ev("github.list == github.rows"), false);
  assert.equal(ev("'ı' == 'I'"), false);
  assert.equal(ev("2 >= 2 && 1 <= 2"), true);
  assert.equal(ev("'10' > 9"), true);
  assert.equal(ev("true > false"), true);
});

test('evaluator: logical operators return operands, not booleans', () => {
  assert.equal(ev("null && 1"), null);
  assert.equal(ev("'' || 'b'"), 'b');
  assert.equal(ev("'a' && 'b'"), 'b');
  assert.equal(ev("0 || null"), null);
  assert.equal(ev("!0"), true);
  assert.equal(ev("!'x'"), false);
  assert.equal(ev("!github.list"), false);
});

test('evaluator: property access, missing paths and object filters', () => {
  assert.equal(ev('github.missing.deep'), null);
  assert.equal(ev("github['ref']"), 'refs/heads/main');
  assert.equal(ev('github.list[1]'), 2);
  assert.equal(ev('github.list[9]'), null);
  assert.equal(ev("github.list['1']"), 2);
  assert.equal(ev('github.list[1.9]'), 2);
  assert.equal(ev('github.list[-1]'), null);
  assert.equal(ev("github.sha[0]"), null);
  assert.deepEqual(toPlain(ev('github.rows.*.y')), [1, 2]);
  assert.deepEqual(toPlain(ev('github.rows[*].y')), [1, 2]);
  assert.deepEqual(toPlain(ev('github.list.*.n')), ['q']);
  assert.deepEqual(toPlain(ev('github.*.n')), []);
  assert.ok(ev('github.rows.*') instanceof Filtered);
  assert.deepEqual(toPlain(ev("github.rows.*.*")), [1, 2, 3]);
  assert.deepEqual(toPlain(ev("github.sha.*")), []);
});

test('evaluator: functions', () => {
  assert.equal(ev("contains('Hello', 'ELL')"), true);
  assert.equal(ev("contains(github.list, 2)"), true);
  assert.equal(ev("contains(github.list, '2')"), true);
  assert.equal(ev("contains(github.list, github.rows)"), false);
  assert.equal(ev("contains('x', github.list)"), false);
  assert.equal(ev("startsWith('Hello', 'he')"), true);
  assert.equal(ev("endsWith('Hello', 'LO')"), true);
  assert.equal(ev("startsWith(github.list, 'a')"), false);
  assert.equal(ev("format('{0}-{{x}}-{1}', 1.5, 'b')"), '1.5-{x}-b');
  assert.equal(ev("format('}}')"), '}');
  assert.equal(ev("format('{0}', github.list)"), 'Array');
  assert.throws(() => ev("format('{1}', 1)"), /more arguments than were supplied/);
  assert.throws(() => ev("format('{x}', 1)"), /format string is invalid/);
  assert.throws(() => ev("format('}', 1)"), /format string is invalid/);
  assert.equal(ev("join(github.list)"), '1,2,Object');
  assert.equal(ev("join(github.list, ' ')"), '1 2 Object');
  assert.equal(ev("join('solo')"), 'solo');
  assert.equal(ev("join(github.list, github.rows)"), '1,2,Object');
  assert.equal(ev("fromJSON('[1,2]')[1]"), 2);
  assert.equal(ev("fromJSON('{\"a\":{\"b\":true}}').a.b"), true);
  assert.throws(() => ev("fromJSON('')"), /empty input/);
  assert.throws(() => ev("fromJSON('{')"), /Error parsing JSON/);
  assert.equal(ev("case(false, 'a', true, 'b', 'c')"), 'b');
  assert.equal(ev("case(false, 'a', 'c')"), 'c');
  assert.throws(() => ev("case(1, 'a', 'c')"), /must evaluate to a boolean/);
});

test('evaluator: extension functions come from the caller', () => {
  const functions = [{ name: 'success', minArgs: 0, maxArgs: 0, call: () => true }, { name: 'hashFiles', minArgs: 1, maxArgs: 255, call: (...a) => a.length }];
  assert.equal(ev("success() && hashFiles('a', 'b')", functions), 2);
  assert.throws(() => evaluateExpression(parseExpression('success()', { functions }), ctx), /cannot be evaluated here/);
});

test('toJSON prints like GitHub, preserving key order and dropping non-finite numbers', () => {
  const d = new Dict().add('b', 1).add('a', [true, null, 'x']).add('10', new Dict()).add('e', []);
  assert.equal(toJson(d), '{\n  "b": 1,\n  "a": [\n    true,\n    null,\n    "x"\n  ],\n  "10": {},\n  "e": []\n}');
  assert.equal(toJson(NaN), 'null');
  assert.equal(ev('toJSON(matrix)'), '{\n  "node": 20\n}');
  assert.equal(coerceString(1.5), '1.5');
  assert.equal(coerceString(0.1 + 0.2), '0.3');
  assert.equal(coerceString(-0), '0');
  assert.equal(coerceString(1e21), '1e+21');
});

test('values: Dict keeps first key case-insensitively and toValue round-trips', () => {
  const d = toValue({ A: 1, a: 2, list: [{ x: null }] });
  assert.equal(d.get('a'), 1);
  assert.deepEqual(toPlain(d), { A: 1, list: [{ x: null }] });
  assert.equal(toValue(undefined), null);
  assert.throws(() => toValue(() => 1), TypeError);
});

test('status functions are found anywhere in a tree', () => {
  const p = (s) => parseExpression(s, { contexts: ['github'], functions: [{ name: 'success', minArgs: 0, maxArgs: 0 }, { name: 'cancelled', minArgs: 0, maxArgs: 0 }] });
  assert.equal(containsStatusFunction(p("github.ref == 'x' && !cancelled()")), true);
  assert.equal(containsStatusFunction(p("(success())")), true);
  assert.equal(containsStatusFunction(p("github.event_name == 'push'")), false);
  assert.equal(containsStatusFunction(p("toJSON(success())")), true);
  assert.equal(containsStatusFunction(p("github[success()]")), true);
  assert.equal(containsStatusFunction(undefined), false);
});

test('splitAllowedContext separates named contexts from functions', () => {
  const r = splitAllowedContext(['github', 'always(0,0)', 'failure(0,MAX)']);
  assert.deepEqual(r.contexts, ['github']);
  assert.deepEqual(r.functions, [{ name: 'always', minArgs: 0, maxArgs: 0 }, { name: 'failure', minArgs: 0, maxArgs: Number.MAX_SAFE_INTEGER }]);
});

test('template strings: whole, mixed, escaped and unclosed expressions', () => {
  assert.equal(templateExpression('plain'), null);
  assert.equal(templateExpression('${{ matrix.os }}').expression, 'matrix.os');
  assert.equal(templateExpression("pre-${{ github.sha }}-{x}-${{ github.ref }} it's").expression, "format('pre-{0}-{{x}}-{1} it''s', github.sha, github.ref)");
  assert.equal(templateExpression("${{ 'lit''eral' }}").literal, "lit'eral");
  assert.equal(templateExpression("${{ '{{ not an expression }}' }}").literal, '{{ not an expression }}');
  assert.equal(templateExpression("x ${{ '}}' }} y").expression, "format('x {0} y', '}}')");
  assert.match(templateExpression('${{ open').error, /not closed/);
  assert.deepEqual(templateExpression('a${{b}}c').segments, [{ literal: 'a' }, { expression: 'b' }, { literal: 'c' }]);
});

test('expressionSites locates every expression with its span', () => {
  assert.deepEqual(expressionSites("a ${{ x }} b ${{ y['}}'] }}"), [{ start: 2, end: 10, expression: 'x' }, { start: 13, end: 27, expression: "y['}}']" }]);
  assert.deepEqual(expressionSites('${{ open'), [{ start: 0, end: 8, expression: null }]);
  assert.deepEqual(expressionSites('none'), []);
});
