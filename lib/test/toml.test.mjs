// Tests for the fail-closed TOML reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToml, TomlError } from '../toml.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const fails = (text, line, label) => {
  assert.throws(() => parseToml(text), (err) => {
    assert.ok(err instanceof TomlError, `${label}: expected TomlError, got ${err?.constructor?.name}`);
    assert.equal(err.line, line, `${label}: line`);
    assert.ok(err.message.startsWith(`toml: line ${line}: `), `${label}: message was ${JSON.stringify(err.message)}`);
    return true;
  }, label);
};

const trackedToml = () => execFileSync('git', ['ls-files', '*.toml'], { cwd: repoRoot, encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);

const CODEX = `model = "gpt-5"
approval_policy = "on-request"

[mcp_servers.spine]
command = "node"
args = ["server.mjs", "--stdio"]
env = { SPINE_HOME = "/tmp/spine", DEBUG = "1" }
startup_timeout_sec = 20

[mcp_servers."my server"]
url = "https://example.invalid/mcp"

[[hooks.pre_tool_use]]
matcher = 'Bash'
command = ["sh", "-c", "exit 0"]

[[hooks.pre_tool_use]]
matcher = 'Edit'
command = ["true"]
`;

const CODEX_EXPECTED = {
  model: 'gpt-5',
  approval_policy: 'on-request',
  mcp_servers: {
    spine: {
      command: 'node',
      args: ['server.mjs', '--stdio'],
      env: { SPINE_HOME: '/tmp/spine', DEBUG: '1' },
      startup_timeout_sec: 20,
    },
    'my server': { url: 'https://example.invalid/mcp' },
  },
  hooks: {
    pre_tool_use: [
      { matcher: 'Bash', command: ['sh', '-c', 'exit 0'] },
      { matcher: 'Edit', command: ['true'] },
    ],
  },
};

test('integers in every base, with signs and underscores', () => {
  assert.deepStrictEqual(parseToml('a = 42\nb = -17\nc = +8\nd = 0xDEAD_beef\ne = 0o755\nf = 0b1010_0101\ng = 1_000_000'), {
    a: 42, b: -17, c: 8, d: 0xdeadbeef, e: 0o755, f: 0b10100101, g: 1000000,
  });
});

test('a signed zero integer is plain zero', () => {
  const result = parseToml('a = -0\nb = +0');
  assert.ok(Object.is(result.a, 0));
  assert.ok(Object.is(result.b, 0));
});

test('the largest safe integer is returned exactly in every base', () => {
  assert.deepStrictEqual(parseToml('a = 9007199254740991\nb = -9007199254740991\nc = 0x1FFFFFFFFFFFFF'), {
    a: Number.MAX_SAFE_INTEGER, b: -Number.MAX_SAFE_INTEGER, c: Number.MAX_SAFE_INTEGER,
  });
});

test('floats keep their fraction and exponent', () => {
  assert.deepStrictEqual(parseToml('a = 1.5\nb = -2E-2\nc = 5e+22\nd = 1_0.5\ne = 1e1_0'), {
    a: 1.5, b: -0.02, c: 5e22, d: 10.5, e: 1e10,
  });
});

test('a negative zero float stays negative zero', () => {
  const result = parseToml('a = -0.0\nb = +0.0');
  assert.ok(Object.is(result.a, -0));
  assert.ok(Object.is(result.b, 0));
  assert.ok(!Object.is(result.b, -0));
});

test('inf and nan in all three spellings', () => {
  const result = parseToml('a = inf\nb = +inf\nc = -inf\nd = nan\ne = +nan\nf = -nan');
  assert.equal(result.a, Infinity);
  assert.equal(result.b, Infinity);
  assert.equal(result.c, -Infinity);
  assert.ok(Number.isNaN(result.d));
  assert.ok(Number.isNaN(result.e));
  assert.ok(Number.isNaN(result.f));
});

test('booleans are lower case and become booleans', () => {
  assert.deepStrictEqual(parseToml('a = true\nb = false'), { a: true, b: false });
});

test('a basic string decodes every escape', () => {
  const result = parseToml(String.raw`a = "x\b\t\n\f\r\"\\\u0041\U0001F600"`);
  assert.deepStrictEqual(result, { a: 'x\b\t\n\f\r"\\A\u{1F600}' });
});

test('a literal string keeps backslashes verbatim', () => {
  assert.deepStrictEqual(parseToml(String.raw`a = 'C:\Users\me'`), { a: 'C:\\Users\\me' });
});

test('a multi-line basic string drops the newline after the opening delimiter', () => {
  assert.deepStrictEqual(parseToml('a = """\nhello\nworld"""'), { a: 'hello\nworld' });
});

test('a multi-line literal string drops the newline after the opening delimiter', () => {
  assert.deepStrictEqual(parseToml("a = '''\nhello\nworld'''"), { a: 'hello\nworld' });
});

test('a multi-line basic string drops a line-ending backslash and the whitespace after it', () => {
  assert.deepStrictEqual(parseToml('a = """one \\\n   two"""'), { a: 'one two' });
});

test('a multi-line basic string decodes escapes', () => {
  assert.deepStrictEqual(parseToml('a = """x\\ty\\u0041"""'), { a: 'x\tyA' });
});

test('a multi-line basic string keeps one and two adjacent quotation marks', () => {
  assert.deepStrictEqual(parseToml('a = """He said "hi" and "" then done"""'), { a: 'He said "hi" and "" then done' });
});

test('a multi-line literal string keeps backslashes verbatim', () => {
  assert.deepStrictEqual(parseToml("a = '''C:\\path\\nope'''"), { a: 'C:\\path\\nope' });
});

test('arrays nest and hold inline tables', () => {
  assert.deepStrictEqual(parseToml('a = [[1, 2], [3]]\nb = [{ x = 1 }, { x = 2 }]'), {
    a: [[1, 2], [3]],
    b: [{ x: 1 }, { x: 2 }],
  });
});

test('a multi-line array allows comments, newlines and one trailing comma', () => {
  assert.deepStrictEqual(parseToml('a = [\n # first\n 1,\n 2, # second\n]'), { a: [1, 2] });
});

test('an empty array and an empty inline table are empty containers', () => {
  assert.deepStrictEqual(parseToml('a = []\nb = {}'), { a: [], b: {} });
});

test('dotted keys with whitespace around the dots', () => {
  assert.deepStrictEqual(parseToml('a . b . c = 1'), { a: { b: { c: 1 } } });
});

test('a quoted key with a dot inside is one key', () => {
  assert.deepStrictEqual(parseToml('"a.b" = 1'), { 'a.b': 1 });
});

test('an empty quoted key is a key', () => {
  assert.deepStrictEqual(parseToml('"" = 1'), { '': 1 });
});

test('[a] then [a.b] nests a sub-table', () => {
  assert.deepStrictEqual(parseToml('[a]\n[a.b]\nz = 1'), { a: { b: { z: 1 } } });
});

test('a super-table may be defined after its sub-table', () => {
  assert.deepStrictEqual(parseToml('[a.b]\n[a]\nz = 1'), { a: { b: {}, z: 1 } });
});

test('[[x]] twice yields two array elements', () => {
  assert.deepStrictEqual(parseToml('[[x]]\na = 1\n[[x]]\na = 2'), { x: [{ a: 1 }, { a: 2 }] });
});

test('[x.y] after [[x]] attaches to the last element', () => {
  assert.deepStrictEqual(parseToml('[[x]]\nb = 1\n[x.y]\nc = 2'), { x: [{ b: 1, y: { c: 2 } }] });
});

test('a multi-line string normalizes CRLF to LF', () => {
  assert.deepStrictEqual(parseToml('a = """x\r\ny"""'), { a: 'x\ny' });
});

test('CRLF input yields the same object as the LF form', () => {
  const lf = 'a = 1\n[t]\nb = "x"\n';
  assert.deepStrictEqual(parseToml(lf.replace(/\n/g, '\r\n')), parseToml(lf));
  assert.deepStrictEqual(parseToml(lf.replace(/\n/g, '\r\n')), { a: 1, t: { b: 'x' } });
});

test('the Codex-style document parses to the expected object', () => {
  assert.deepStrictEqual(parseToml(CODEX), CODEX_EXPECTED);
});

test('a key assigned twice in one table throws', () => {
  fails('a = 1\na = 2', 2, 'duplicate key');
});

test('a repeated table header throws', () => {
  fails('[a]\n[a]', 2, 'repeated table');
});

test('a dotted key that walks through a value throws', () => {
  fails('a = 1\na.b = 2', 2, 'dotted key through value');
});

test('a header that walks through a value throws', () => {
  fails('a = 1\n[a.b]', 2, 'header through value');
});

test('[[x]] after a plain array throws', () => {
  fails('x = []\n[[x]]', 2, 'array of tables over array');
});

test('[[x]] after a plain table throws', () => {
  fails('[x]\n[[x]]', 2, 'array of tables over table');
});

test('[x] after [[x]] throws', () => {
  fails('[[x]]\n[x]', 2, 'table over array of tables');
});

test('a key that adds to an inline table throws', () => {
  fails('a = { b = 1 }\na.c = 2', 2, 'key extends inline table');
});

test('a header that adds to an inline table throws', () => {
  fails('a = { b = 1 }\n[a]', 2, 'header extends inline table');
});

test('a header that adds a sub-table under an inline table throws', () => {
  fails('a = { b = 1 }\n[a.c]', 2, 'sub-table under inline table');
  fails('a = { b = 1 }\n[[a.c]]', 2, 'array of tables under inline table');
});

test('a header that re-opens a dotted-created table throws', () => {
  fails('[a]\nb.c = 1\n[a.b]', 3, 'header reopens dotted table');
});

test('an unterminated string throws', () => {
  fails('a = "abc', 1, 'unterminated string');
});

test('an unterminated array throws', () => {
  fails('a = [1, 2', 1, 'unterminated array');
});

test('an unterminated inline table throws', () => {
  fails('a = { b = 1', 1, 'unterminated inline table');
});

test('anything other than a comment after a value throws', () => {
  fails('a = 1 b = 2', 1, 'text after value');
});

test('a line that is neither a key/value pair, a header, a comment nor blank throws', () => {
  fails('a = 1\nnot a pair', 2, 'invalid line');
});

test('a bare carriage return throws', () => {
  fails('a = 1\rb = 2', 1, 'bare carriage return');
  assert.throws(() => parseToml('a = 1\rb = 2'), /bare carriage return/);
  fails('ok = 1\na = """x\ry"""', 2, 'bare carriage return in a multi-line string');
  fails('ok = 1\n# x\ry', 2, 'bare carriage return in a comment');
});

test('a decimal integer with a leading zero throws', () => {
  fails('ok = 1\na = 012', 2, 'leading zero');
});

test('an underscore doubled inside an integer throws', () => {
  fails('ok = 1\na = 1__0', 2, 'doubled underscore');
});

test('a leading underscore throws', () => {
  fails('ok = 1\na = _1', 2, 'leading underscore');
});

test('a float with no fraction digits throws', () => {
  fails('ok = 1\na = 1.', 2, 'empty fraction');
});

test('a float with no integer digits throws', () => {
  fails('ok = 1\na = .5', 2, 'empty integer part');
});

test('a hexadecimal prefix with no digits throws', () => {
  fails('ok = 1\na = 0x', 2, 'empty hex');
});

test('a capitalised boolean throws', () => {
  fails('ok = 1\na = True', 2, 'capitalised boolean');
});

test('an integer outside the safe range throws', () => {
  fails('ok = 1\na = 9007199254740993', 2, 'unsafe integer');
});

test('an integer outside the safe range throws in every base', () => {
  fails('ok = 1\na = 9007199254740992', 2, 'unsafe decimal');
  fails('ok = 1\na = -9007199254740992', 2, 'unsafe negative decimal');
  fails('ok = 1\na = 0x20000000000000', 2, 'unsafe hexadecimal');
  fails('ok = 1\na = 0o400000000000000000', 2, 'unsafe octal');
  fails(`ok = 1\na = 0b1${'0'.repeat(53)}`, 2, 'unsafe binary');
});

test('an impossible month throws', () => {
  fails('ok = 1\na = 2026-13-01', 2, 'impossible month');
});

test('a bad escape throws', () => {
  fails('ok = 1\na = "\\q"', 2, 'bad escape');
});

test('a raw newline in a basic string throws', () => {
  fails('ok = 1\na = "line\nbreak"', 2, 'raw newline');
});

test('a raw control character in a string throws', () => {
  fails('a = "x\u0001y"', 1, 'raw control character');
});

test('an escape naming a surrogate throws', () => {
  fails('a = "\\uD800"', 1, 'surrogate escape');
});

test('an escape naming a code point above U+10FFFF throws', () => {
  fails('a = "\\U00110000"', 1, 'out-of-range escape');
});

test('prototype-poisoning names are ordinary own keys', () => {
  const result = parseToml('__proto__ = 1\nconstructor = 2\ntoString = 3');
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.ok(Object.hasOwn(result, '__proto__'));
  assert.equal(result.__proto__, 1);
  assert.equal(result.constructor, 2);
  assert.equal(result.toString, 3);
  assert.deepStrictEqual(Object.keys(result), ['__proto__', 'constructor', 'toString']);
});

test('a table named __proto__ does not pollute Object.prototype', () => {
  const result = parseToml('[__proto__]\npolluted = true');
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.ok(Object.hasOwn(result, '__proto__'));
  assert.deepStrictEqual(result.__proto__, { polluted: true });
  assert.equal(({}).polluted, undefined);
});

test('prototype-poisoning names along a header or dotted path are ordinary own keys', () => {
  const documents = [
    '[__proto__.polluted]\nx = 1',
    '[[__proto__.polluted]]\nx = 1',
    '__proto__.polluted = 1',
    'a = { __proto__.polluted = 1 }',
    '[constructor.prototype]\npolluted = 1',
    'constructor.prototype.polluted = 1',
    '[toString.polluted]\nx = 1',
    'hasOwnProperty.polluted = 1',
  ];
  for (const text of documents) {
    const result = parseToml(text);
    assert.equal(Object.getPrototypeOf(result), Object.prototype, text);
    assert.equal(({}).polluted, undefined, text);
    assert.equal(Object.prototype.polluted, undefined, text);
    assert.equal(Object.polluted, undefined, text);
  }
  assert.deepStrictEqual(Object.keys(parseToml(documents[0])), ['__proto__']);
  assert.deepStrictEqual(Object.getOwnPropertyDescriptor(parseToml(documents[2]), '__proto__').value, { polluted: 1 });
  assert.deepStrictEqual(Object.getOwnPropertyDescriptor(parseToml(documents[6]), 'toString').value, { polluted: { x: 1 } });
});

test('a non-string argument is a TypeError', () => {
  assert.throws(() => parseToml(null), TypeError);
  assert.throws(() => parseToml(42), TypeError);
});

test('an empty document is an empty object', () => {
  assert.deepStrictEqual(parseToml(''), {});
});

test('each date and time kind is returned as its literal text', () => {
  assert.deepStrictEqual(parseToml([
    'a = 1979-05-27T07:32:00Z',
    'b = 1979-05-27T00:32:00.999999-07:00',
    'c = 1979-05-27 07:32:00',
    'd = 1979-05-27',
    'e = 07:32:00.5',
    'f = 2024-02-29',
    'g = [1979-05-27 07:32:00, 07:32:00] # trailing',
    'h = 2000-02-29',
  ].join('\n')), {
    a: '1979-05-27T07:32:00Z',
    b: '1979-05-27T00:32:00.999999-07:00',
    c: '1979-05-27 07:32:00',
    d: '1979-05-27',
    e: '07:32:00.5',
    f: '2024-02-29',
    g: ['1979-05-27 07:32:00', '07:32:00'],
    h: '2000-02-29',
  });
});

test('an impossible or incomplete date or time throws', () => {
  for (const value of [
    '2026-02-29', '1900-02-29', '2026-04-31', '2026-01-32', '2026-00-10', '2026-01-00',
    '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z',
    '2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00+00:60',
    '2026-01-01T00:00Z', '2026-01-01 00:00', '07:32', '2026-1-01', '2026-01-01T', '2026-01-01T00:00:00.Z',
  ]) {
    fails(`ok = 1\na = ${value}`, 2, value);
  }
});

test('dotted keys may add to a table a longer header created implicitly', () => {
  assert.deepStrictEqual(parseToml('[a.b.c]\n[a]\nb.d = 1\nb.e = 2\n[a.b.f]\ng = 3'), {
    a: { b: { c: {}, d: 1, e: 2, f: { g: 3 } } },
  });
});

test('a header that re-opens an implicit table extended by dotted keys throws', () => {
  fails('[a.b.c]\n[a]\nb.d = 1\n[a.b]', 4, 'header reopens extended table');
});

test('a dotted key that appends to an array of tables throws', () => {
  fails('[[a.b]]\n\n[a]\nb.y = 2', 4, 'dotted key into array of tables');
});

test('a dotted key that walks through a plain array throws', () => {
  fails('[a]\nb = [{ c = 1 }]\nb.d = 2', 3, 'dotted key into plain array');
});

test('a header may add a sub-table under a table created by dotted keys', () => {
  assert.deepStrictEqual(parseToml('[fruit]\napple.color = "red"\n[fruit.apple.texture]\nsmooth = true\n[[fruit.apple.seeds]]\nsize = 2'), {
    fruit: { apple: { color: 'red', texture: { smooth: true }, seeds: [{ size: 2 }] } },
  });
});

test('a header that extends an inline table inside a plain array throws', () => {
  fails('a = [{ b = 1 }]\n[a.c]', 2, 'header into plain array');
});

test('a sub-table header repeated under the same array element throws', () => {
  fails('[[x]]\n[x.y]\n[x.y]', 3, 'repeated sub-table');
});

test('a multi-line string may end with one or two quotation marks before the delimiter', () => {
  assert.deepStrictEqual(parseToml('a = """x""""\nb = """x"""""\nc = \'\'\'x\'\'\'\'\nd = \'\'\'x\'\'\'\'\''), {
    a: 'x"', b: 'x""', c: "x'", d: "x''",
  });
});

test('six quotation marks closing a multi-line string throw', () => {
  fails('ok = 1\na = """x""""""', 2, 'six double quotes');
  fails("ok = 1\na = '''x''''''", 2, 'six single quotes');
});

test('a backslash followed by spaces is only a line continuation before a newline', () => {
  assert.deepStrictEqual(parseToml('a = """x\\  \n\n  y"""'), { a: 'xy' });
  fails('ok = 1\na = """x\\ y"""', 2, 'backslash space');
});

test('an inline table spanning lines or ending with a comma throws', () => {
  fails('ok = 1\na = { b = 1,\nc = 2 }', 2, 'newline in inline table');
  fails('ok = 1\na = { b = 1, }', 2, 'trailing comma in inline table');
  assert.throws(() => parseToml('a = { b = 1, }'), /trailing comma in inline table/);
});

test('a control character in a comment throws', () => {
  fails('ok = 1\n# x\u0000', 2, 'NUL in comment');
  fails('ok = 1\n# x\u007f', 2, 'DEL in comment');
});

test('containers nest to the limit and no further', () => {
  const nested = (open, close, depth) => `a = ${open.repeat(depth)}${close.repeat(depth)}`;
  let expected = [];
  for (let i = 1; i < 64; i++) expected = [expected];
  assert.deepStrictEqual(parseToml(nested('[', ']', 64)), { a: expected });
  fails(`ok = 1\n${nested('[', ']', 65)}`, 2, '65 nested arrays');
  fails(`ok = 1\na = ${'{ a = '.repeat(65)}1${' }'.repeat(65)}`, 2, '65 nested inline tables');
  fails(`ok = 1\n${nested('[', ']', 100000)}`, 2, '100000 nested arrays');
});

test('sibling containers do not count towards the nesting limit', () => {
  const siblings = Array.from({ length: 200 }, () => '[[1]]').join(', ');
  assert.equal(parseToml(`a = [${siblings}]`).a.length, 200);
});

const WITNESS_ACCEPTED = [
  'a = 0xDEAD_beef\nb = 0o755\nc = 0b1010\nd = -17\ne = +8\nf = 1_000\ng = -0\nh = 9007199254740991',
  'a = 1.5\nb = -2E-2\nc = 5e+22\nd = 1_0.5\ne = 1e1_0\nf = 1E+05',
  'a = inf\nb = -inf\nc = nan',
  String.raw`a = "x\b\t\n\f\r\"\\\u0041\U0001F600"` + '\nb = \'C:\\Users\'\nc = "tab\there"',
  'a = """\nhello\nworld"""\nb = \'\'\'\nhello\nworld\'\'\'\nc = """one \\\n   two"""\nd = """x""""\ne = """x"""""',
  'a = """x\r\ny"""\r\nb = 1\r\n',
  'a = """x\\  \n\n  y"""',
  'a = [[1, 2], [3]]\nb = [{ x = 1 }, { x = 2 }]\nc = [ # c\n 1, # d\n 2,\n ] # e\nd = []\ne = {}\nf = [1, "x", [2], { b = 1 }]',
  'a = { b.c = 1, b.d = 2 }\ne = { f = [\n1,\n2\n] }',
  'a . b . c = 1\n"a.b" = 2\n"" = 3\n\'q\' = 4\n1.2 = 5\n-_ = 6',
  '[a]\n[a.b]\nz = 1',
  '[a.b]\n[a]\nz = 1',
  '[a.b.c]\n[a]\nb.d = 1\nb.e = 2\n[a.b.f]\ng = 3',
  '[[x]]\na = 1\n[[x]]\na = 2',
  '[[x]]\n[x.y]\nc = 2\n[[x]]\n[x.y]\nc = 3',
  '[[x]]\n[[x.y]]\na = 1\n[[x.y]]\na = 2\n[[x]]\n[[x.y]]\na = 3',
  '[fruit]\napple.color = "red"\n[fruit.apple.texture]\nsmooth = true\n[[fruit.apple.seeds]]\nsize = 2',
  'a.b = 1\n[a.c]\nd = 1',
  '[ a . "b.c" ]\nd = 1\n[[ e ]]\nf = 1',
  '__proto__ = 1\n[constructor]\nprototype = 2',
  '[__proto__.polluted]\nx = 1',
  'constructor.prototype.polluted = 1',
  '[toString.polluted]\nx = 1',
  '[__proto__]\npolluted = true',
  'a = { __proto__ = { x = 1 } }',
  'a = 1979-05-27T07:32:00Z\nb = 1979-05-27 07:32:00.5\nc = 1979-05-27\nd = 07:32:00\ne = 1979-05-27t07:32:00z',
  CODEX,
];

const WITNESS_REJECTED = [
  'a = 1\na = 2', '"a" = 1\na = 2', '[a]\n[a]', '[a.b]\n[a]\n[a]', 'a = 1\na.b = 2', 'a = 1\n[a.b]', 'a.b = 1\na = 2',
  'x = []\n[[x]]', '[x]\n[[x]]', '[[x]]\n[x]', '[a.b]\n[[a]]', '[[albums.songs]]\n[[albums]]',
  'a = { b = 1 }\na.c = 2', 'a = { b = 1 }\n[a]', 'a = { b = 1 }\n[a.c]', 't = { a.b = 1 }\n[t.a]', 'a = { b = { c = 1 }, b.d = 2 }',
  '[a]\nb.c = 1\n[a.b]', 'a.b = 1\n[a]', '[fruit]\napple.taste.sweet = true\n[fruit.apple.taste]',
  '[a.b.c]\n[a]\nb.d = 1\n[a.b]', '[[a.b]]\n\n[a]\nb.y = 2', '[a.b]\nx = 1\n[a]\nb.y = 2',
  'a = [{ b = 1 }]\n[a.c]', 'a = [{ b = 1 }]\n[[a]]', '[a]\nb = [{ c = 1 }]\nb.d = 2', '[[x]]\n[x.y]\n[x.y]',
  'a = "abc', 'a = [1, 2', 'a = { b = 1', 'a = """x', "a = '''x", 'a = 1 b = 2', 'a = "x" "y"', 'not a pair', 'a\n= 1',
  'a =', 'a = # x', '= 1', 'a b = 1', 'μ = 1', '"""k""" = 1', 'a..b = 1',
  '[]', '[a..b]', '[ [a] ]', '[[a] ]', '[a]]', '[a] b = 1', '[a\n]',
  'a = 1\rb = 2', 'a = 012', 'a = 1__0', 'a = _1', 'a = 1_', 'a = 1.', 'a = .5', 'a = 1.e5', 'a = 1e_5', 'a = 0x',
  'a = 0X1', 'a = +0x1', 'a = 0x_1', 'a = 00', 'a = True', 'a = tru', 'a = truefalse', 'a = Inf', 'a = NaN',
  'a = 2026-13-01', 'a = 2026-02-29', 'a = 2026-01-01T24:00:00Z', 'a = 2026-01-01T00:00:00+24:00',
  'a = 2026-01-01T00:00Z', 'a = 2026-01-01 00:00', 'a = 07:32', 'a = 2026-1-01',
  'a = "\\q"', 'a = "\\x41"', 'a = "\\e"', 'a = "\\u00"', 'a = "\\uD800"', 'a = "\\U00110000"', 'a = "line\nbreak"',
  'a = "x\u0001y"', 'a = "\u007f"', "a = '\u007f'", '# x\u0000', 'a = """x\\ y"""', 'a = """x""""""', "a = '''x''''''",
  'a = [1,,2]', 'a = [,]', 'a = [1 2]', 'a = { b = 1, }', 'a = { b = 1,\nc = 2 }', 'a = {,}', 'a = { b = 1 c = 2 }',
  'a = { b = 1, b = 2 }', '\uFEFFa = 1',
];

test('every rejected witness document throws a TomlError', () => {
  for (const text of WITNESS_REJECTED) {
    assert.throws(() => parseToml(text), TomlError, JSON.stringify(text));
  }
});

test('every tracked TOML file parses', () => {
  const files = trackedToml();
  assert.ok(files.length > 0, 'git ls-files found no TOML files');
  for (const file of files) {
    assert.doesNotThrow(() => parseToml(readFileSync(join(repoRoot, file), 'utf8')), `${file} must parse`);
  }
});

// Dates and non-finite floats have no JSON form, so tomllib reports those documents as accepted without a value.
const WITNESS_PROGRAM = `
import sys, json, tomllib
verdicts = []
for text in json.load(sys.stdin):
    try:
        value = tomllib.loads(text)
    except tomllib.TOMLDecodeError as err:
        verdicts.append({"rejected": str(err)})
        continue
    try:
        verdicts.append({"value": json.loads(json.dumps(value, allow_nan=False))})
    except (TypeError, ValueError):
        verdicts.append({"accepted": True})
print(json.dumps(verdicts))
`;

test('a second witness with python tomllib agrees on what is accepted, its value, and what is rejected', (t) => {
  const python = process.env.CW_TOML_WITNESS_PYTHON || 'python3';
  const probe = spawnSync(python, ['-c', 'import tomllib'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    t.skip('no python with tomllib: set CW_TOML_WITNESS_PYTHON');
    return;
  }
  const accepted = [
    ...WITNESS_ACCEPTED.map((text) => [JSON.stringify(text), text]),
    ...trackedToml().map((file) => [file, readFileSync(join(repoRoot, file), 'utf8')]),
  ];
  const rejected = WITNESS_REJECTED.map((text) => [JSON.stringify(text), text]);
  const docs = [...accepted, ...rejected];
  const run = spawnSync(python, ['-I', '-c', WITNESS_PROGRAM], {
    input: JSON.stringify(docs.map(([, text]) => text)),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(run.status, 0, `python witness failed: ${run.stderr}`);
  const verdicts = JSON.parse(run.stdout);
  assert.equal(verdicts.length, docs.length);
  let comparedValues = 0;
  accepted.forEach(([name, text], i) => {
    const verdict = verdicts[i];
    assert.ok(!('rejected' in verdict), `${name}: tomllib rejected it: ${verdict.rejected}`);
    const actual = JSON.parse(JSON.stringify(parseToml(text)));
    if ('value' in verdict) {
      assert.deepStrictEqual(actual, verdict.value, name);
      comparedValues += 1;
    }
  });
  assert.ok(comparedValues >= accepted.length - 2, `only ${comparedValues} of ${accepted.length} values were compared`);
  rejected.forEach(([name], i) => {
    assert.ok('rejected' in verdicts[accepted.length + i], `${name}: tomllib accepted what parseToml rejects`);
  });
});
