// Tests for the workflow YAML reader: supported syntax, node shapes, type resolution and refusals
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, toPlain, YamlError } from '../actions-yaml.mjs';

const plain = (text) => toPlain(parseYaml(text));
const valueOf = (text) => plain(`v: ${text}\n`).v;

function refuses(text, pattern, line) {
  assert.throws(() => parseYaml(text), (err) => {
    assert.ok(err instanceof YamlError, `expected a YamlError, got ${err}`);
    assert.match(err.message, pattern);
    assert.match(err.message, /^line \d+: /);
    if (line !== undefined) assert.equal(err.line, line);
    assert.equal(typeof err.col, 'number');
    return true;
  });
}

test('an empty document is a null scalar at line 0', () => {
  const empty = { type: 'scalar', line: 0, col: 0, value: null, raw: '', source: '', style: 'plain' };
  assert.deepEqual(parseYaml(''), empty);
  assert.deepEqual(parseYaml('# only a comment\n\n'), empty);
  assert.deepEqual(parseYaml('---\n'), empty);
});

test('a block mapping keeps entries in source order with key and value nodes', () => {
  const root = parseYaml('name: ci\non: push\n');
  assert.equal(root.type, 'map');
  assert.deepEqual([root.line, root.col], [1, 1]);
  assert.deepEqual(root.entries.map((e) => e.key.value), ['name', 'on']);
  assert.deepEqual(root.entries[1].value, { type: 'scalar', line: 2, col: 5, value: 'push', raw: 'push', source: 'push', style: 'plain' });
});

test('nested block mappings and sequences parse at any depth', () => {
  const text = 'jobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n      - run: make\n';
  assert.deepEqual(plain(text), { jobs: { build: { steps: [{ uses: 'actions/checkout@v4', with: { 'fetch-depth': 0 } }, { run: 'make' }] } } });
});

test('a sequence may sit at the same indentation as its parent key', () => {
  assert.deepEqual(plain('branches:\n- main\n- dev\nother: x\n'), { branches: ['main', 'dev'], other: 'x' });
});

test('nested sequences on one line parse as sequences of sequences', () => {
  assert.deepEqual(plain('- - a\n  - b\n- c\n'), [['a', 'b'], 'c']);
});

test('a sequence node records where its first dash is', () => {
  const seq = parseYaml('k:\n  - a\n').entries[0].value;
  assert.deepEqual([seq.type, seq.line, seq.col], ['seq', 2, 3]);
});

test('an empty value and an explicit null are both null', () => {
  assert.deepEqual(plain('a:\nb: null\nc: ~\nd:   # comment\n'), { a: null, b: null, c: null, d: null });
});

test('quoted keys are strings', () => {
  assert.deepEqual(plain('"on": 1\n\'two words\': 2\n'), { on: 1, 'two words': 2 });
});

test('null words resolve to null', () => {
  for (const word of ['null', 'Null', 'NULL', '~', '']) assert.equal(valueOf(word), null, word);
});

test('only the six core boolean spellings are booleans', () => {
  for (const word of ['true', 'True', 'TRUE']) assert.equal(valueOf(word), true, word);
  for (const word of ['false', 'False', 'FALSE']) assert.equal(valueOf(word), false, word);
});

test('YAML 1.1 boolean words stay strings', () => {
  for (const word of ['on', 'off', 'yes', 'no', 'y', 'n', 'On', 'YES', 'tRUE']) assert.equal(valueOf(word), word, word);
  assert.deepEqual(Object.keys(plain('on:\n  push:\n')), ['on']);
});

test('decimal, octal and hexadecimal integers resolve to numbers', () => {
  assert.equal(valueOf('42'), 42);
  assert.equal(valueOf('-7'), -7);
  assert.equal(valueOf('+3'), 3);
  assert.equal(valueOf('012'), 12);
  assert.equal(valueOf('0o17'), 15);
  assert.equal(valueOf('0x1F'), 31);
});

test('floats, infinities and NaN resolve to numbers', () => {
  assert.equal(valueOf('1.5'), 1.5);
  assert.equal(valueOf('.5'), 0.5);
  assert.equal(valueOf('1.'), 1);
  assert.equal(valueOf('1e3'), 1000);
  assert.equal(valueOf('-2.5E-1'), -0.25);
  assert.equal(valueOf('.inf'), Infinity);
  assert.equal(valueOf('-.Inf'), -Infinity);
  assert.ok(Number.isNaN(valueOf('.NaN')));
});

test('number-like text outside the core schema stays a string', () => {
  for (const word of ['1_000', '0b11', '0X1F', '+0x1F', '0o8', '1.2.3', '3.10.x', 'nan', '+.nan']) assert.equal(valueOf(word), word, word);
});

test('quoted and block scalars are always strings', () => {
  assert.equal(valueOf("'42'"), '42');
  assert.equal(valueOf('"true"'), 'true');
  assert.equal(plain('v: |\n  null\n').v, 'null\n');
});

test('a multi-line plain scalar folds lines with a space and an empty line to a newline', () => {
  const node = parseYaml('v: one\n  two\n\n  three\n').entries[0].value;
  assert.equal(node.value, 'one two\nthree');
  assert.equal(node.source, 'one\n  two\n\n  three');
});

test('a comment ends a plain scalar and never starts inside one', () => {
  assert.deepEqual(plain('a: x # note\nb: x#y\nc: "q # r"\n'), { a: 'x', b: 'x#y', c: 'q # r' });
});

test('a single-quoted scalar unescapes doubled quotes and folds across lines', () => {
  const node = parseYaml("v: 'it''s\n  folded\n\n  here'\n").entries[0].value;
  assert.equal(node.value, "it's folded\nhere");
  assert.equal(node.style, 'single');
});

test('a quoted scalar keeps its quotes in source and its content in raw', () => {
  const node = parseYaml('v: "a\\tb ${{ x }}"\n').entries[0].value;
  assert.equal(node.source, '"a\\tb ${{ x }}"');
  assert.equal(node.raw, 'a\tb ${{ x }}');
  assert.equal(node.style, 'double');
});

test('a double-quoted scalar decodes every YAML escape', () => {
  const escaped = '"\\0\\a\\b\\t\\	\\n\\v\\f\\r\\e\\ \\"\\/\\\\\\N\\_\\L\\P\\x41\\u00e9\\U0001F600"';
  assert.equal(valueOf(escaped), '\0\x07\b\t\t\n\v\f\r\x1b "/\\\x85\xa0\u2028\u2029A\u00e9\u{1F600}');
});

test('a double-quoted scalar joins an escaped line break without a space', () => {
  assert.equal(plain('v: "abc\\\n    def"\n').v, 'abcdef');
  assert.equal(plain('v: "a \n  b"\n').v, 'a b');
});

test('an invalid escape is refused', () => {
  refuses('v: "\\q"\n', /invalid escape/, 1);
  refuses('v: "\\x4"\n', /invalid escape/, 1);
});

test('a literal block scalar keeps line breaks and its source keeps indentation', () => {
  const node = parseYaml('run: |\n  echo ${{ a }}\n    indented\nnext: 1\n').entries[0].value;
  assert.equal(node.style, 'literal');
  assert.equal(node.value, 'echo ${{ a }}\n  indented\n');
  assert.equal(node.raw, node.value);
  assert.equal(node.source, '  echo ${{ a }}\n    indented\n');
  assert.deepEqual([node.line, node.col], [1, 6]);
});

test('block scalar chomping strips, clips or keeps trailing line breaks', () => {
  assert.equal(plain('v: |-\n  x\n\n').v, 'x');
  assert.equal(plain('v: |\n  x\n\n').v, 'x\n');
  assert.equal(plain('v: |+\n  x\n\n').v, 'x\n\n');
});

test('a block scalar source has no trailing newline when the file has none', () => {
  const node = parseYaml('v: |\n  x').entries[0].value;
  assert.equal(node.source, '  x');
  assert.equal(node.value, 'x\n');
});

test('an explicit indentation indicator keeps extra leading spaces', () => {
  assert.equal(plain('v: |2\n    x\n   y\n').v, '  x\n y\n');
  assert.deepEqual(plain('- |1-\n  x\n'), [' x']);
});

test('a folded block scalar folds lines and keeps more-indented lines verbatim', () => {
  const node = parseYaml('v: >\n  one\n  two\n\n  three\n    kept as is\n  four\n').entries[0].value;
  assert.equal(node.style, 'folded');
  assert.equal(node.value, 'one two\nthree\n  kept as is\nfour\n');
});

test('a flow sequence and a flow mapping parse with quoted items and empties', () => {
  assert.deepEqual(plain('a: [x, "y, z", \'w\']\nb: {k: v, n: 1}\nc: []\nd: {}\n'), { a: ['x', 'y, z', 'w'], b: { k: 'v', n: 1 }, c: [], d: {} });
});

test('a multi-line flow sequence with nested flow collections and comments parses', () => {
  const text = 'matrix:\n  os: [\n    ubuntu-latest, # linux\n    [nested, list],\n    {name: mac},\n  ]\n';
  assert.deepEqual(plain(text), { matrix: { os: ['ubuntu-latest', ['nested', 'list'], { name: 'mac' }] } });
});

test('a flow mapping key without a value is null and a pair in a flow sequence is a mapping', () => {
  assert.deepEqual(plain('a: {k, m: }\nb: [p: q]\n'), { a: { k: null, m: null }, b: [{ p: 'q' }] });
});

test('document start, document end, a %YAML 1.2 directive and a BOM are accepted', () => {
  assert.deepEqual(plain('%YAML 1.2\n---\na: 1\n...\n# trailing\n'), { a: 1 });
  assert.deepEqual(plain('\ufeffa: 1\n'), { a: 1 });
});

test('a byte-order mark counts as a column of line 1', () => {
  assert.equal(parseYaml('\ufeffa: 1\n').entries[0].value.col, 5);
});

test('CRLF input parses like LF input and source uses LF', () => {
  const crlf = 'a: 1\r\nrun: |\r\n  x\r\n  y\r\nb: [p,\r\n  q]\r\n';
  assert.deepEqual(plain(crlf), plain(crlf.replace(/\r\n/g, '\n')));
  assert.equal(parseYaml(crlf).entries[1].value.source, '  x\n  y\n');
});

test('toPlain stringifies keys in source order and keeps __proto__ as an own key', () => {
  const out = plain('b: 1\n"x": 2\n__proto__: 3\n');
  assert.deepEqual(Object.keys(out), ['b', 'x', '__proto__']);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.deepEqual(Object.keys(plain('true: 1\n~: 2\n1.50: 3\n')), ['true', '', '1.5']);
});

test('anchors are refused and a plain ampersand inside a value is not', () => {
  refuses('a: &base 1\n', /anchors are not supported/, 1);
  refuses('a:\n  - &x {b: 1}\n', /anchors/, 2);
  assert.equal(valueOf('a&b'), 'a&b');
});

test('aliases are refused and a plain asterisk inside a value is not', () => {
  refuses('a: 1\nb: *a\n', /aliases are not supported/, 2);
  refuses('a: [*x]\n', /aliases/, 1);
  assert.equal(valueOf('"*x"'), '*x');
  assert.equal(valueOf('a*b'), 'a*b');
});

test('merge keys are refused and a quoted << key is a string', () => {
  refuses('<<: {a: 1}\n', /merge keys/, 1);
  assert.deepEqual(plain('"<<": 1\n'), { '<<': 1 });
});

test('tags are refused and a plain exclamation mark inside a value is not', () => {
  refuses('a: !!str 1\n', /tags are not supported/, 1);
  refuses('a: !custom x\n', /tags/, 1);
  refuses('%TAG ! tag:example.com,2000:\n---\na: 1\n', /tags/, 1);
  assert.equal(valueOf('hello!'), 'hello!');
});

test('complex keys are refused and a question mark inside a value is not', () => {
  refuses('? a\n: b\n', /complex mapping keys/, 1);
  refuses('[a]: b\n', /complex mapping keys/, 1);
  refuses('a: {[x]: y}\n', /complex mapping keys/, 1);
  assert.equal(valueOf('?x'), '?x');
  assert.equal(valueOf('why?'), 'why?');
});

test('empty mapping keys are refused', () => {
  refuses(': x\n', /empty mapping keys/, 1);
  refuses('a: x\n  : y\n', /empty mapping keys/, 2);
});

test('tabs used for indentation are refused and tabs as separation are not', () => {
  refuses('a:\n\tb: 1\n', /tab used for indentation/, 2);
  refuses('a:\n  b: 1\n  \tc: 2\n', /tab used for indentation/, 3);
  refuses('-\ta: 1\n  b: 2\n', /tab used for indentation/, 1);
  assert.deepEqual(plain('a:\t1\nb: x\t# c\n'), { a: 1, b: 'x' });
});

test('a duplicate key in one mapping is refused with its name', () => {
  refuses('a: 1\nb: 2\na: 3\n', /^line 3: duplicate key 'a'$/, 3);
  refuses('a: {x: 1, x: 2}\n', /^line 1: duplicate key 'x'$/, 1);
  refuses('1: a\n"1": b\n', /duplicate key '1'/, 2);
});

test('the same key in different mappings is not a duplicate', () => {
  assert.deepEqual(plain('a:\n  x: 1\nb:\n  x: 2\n'), { a: { x: 1 }, b: { x: 2 } });
});

test('a second document is refused', () => {
  refuses('a: 1\n---\nb: 2\n', /second document/, 2);
  refuses('a: 1\n...\nb: 2\n', /second document/, 3);
});

test('a directive other than %YAML 1.2, or one without ---, is refused', () => {
  refuses('%YAML 1.1\n---\na: on\n', /only YAML 1.2/, 1);
  refuses('%YAML 1.2\na: 1\n', /must be followed by '---'/, 1);
});

test('unterminated quotes are refused at the opening quote', () => {
  refuses('a: "open\n', /unterminated double-quoted scalar/, 1);
  refuses("a: 'open\nb: 1\n", /single-quoted scalar continues on a line not indented/, 2);
  refuses("a: 'it''\n", /unterminated single-quoted scalar/, 1);
});

test('unterminated flow collections are refused', () => {
  refuses('a: [x, y\n', /unterminated flow collection/, 1);
  refuses('a: {x: 1\n', /unterminated flow collection/, 1);
});

test('indentation that matches no open collection is refused', () => {
  refuses('a:\n    b: 1\n  c: 2\n', /indentation does not match any open collection/, 3);
  refuses('a:\n  - x\n y: 1\n', /indentation does not match any open collection/, 3);
});

test('a mapping or sequence on the same line as its key is refused', () => {
  refuses('a: b: c\n', /block mapping cannot start on the same line/, 1);
  refuses('a: - b\n', /block sequence cannot start on the same line/, 1);
});

test('a non-string argument is a TypeError, not a YamlError', () => {
  assert.throws(() => parseYaml(undefined), TypeError);
});
