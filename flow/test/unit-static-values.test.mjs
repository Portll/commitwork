// What an argument expression evaluates to, read off the masked source (flow/static.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../lexer.mjs';
import { maskFrom } from '../verify.mjs';
import { valueContext, exprAt, resolveValue, pathCandidates, templateParts, objectProps, declInit, argsOf, siteCategory } from '../static.mjs';

const ctxOf = (src, path = 'bin/x.mjs') => {
  const lex = classify(src);
  return valueContext(path, maskFrom(src, lex.spans).masked, lex.spans);
};
// The value of the expression after `X = ` on the last line.
const valueOf = (src, path) => {
  const ctx = ctxOf(src, path);
  const from = ctx.masked.lastIndexOf('X = ') + 4;
  return resolveValue(ctx, exprAt(ctx, from, ctx.masked.length));
};

test('literals, numbers and template literals resolve', () => {
  // arrange
  const cases = ["X = 'a/b.json'", 'X = 42', 'X = `plain`', "const A = 'x';\nX = `${A}/y`"];
  // act
  const got = cases.map((c) => valueOf(c).value);
  // assert
  assert.deepEqual(got, ['a/b.json', 42, 'plain', 'x/y']);
});

test('a computed template keeps its literal head and says why it failed', () => {
  // arrange
  const src = "X = `https://api.x.dev/${id}/z`";
  // act
  const r = valueOf(src);
  // assert
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'computed template');
  assert.equal(r.head, 'https://api.x.dev/');
});

test('const bindings resolve through several hops; an unknown name does not', () => {
  // arrange
  const src = "const A = 'reports';\nconst B = A;\nX = B";
  // act
  const ok = valueOf(src);
  const bad = valueOf('X = nothing');
  // assert
  assert.equal(ok.value, 'reports');
  assert.deepEqual(bad, { ok: false, reason: 'unresolved nothing' });
});

test('directory anchors: module dir, file URL, cwd and an unknown directory variable', () => {
  // arrange
  const cases = [
    ["X = join(__dirname, 'a.mjs')", 'module'],
    ["X = join(import.meta.dirname, 'a.mjs')", 'module'],
    ["const HERE = dirname(fileURLToPath(import.meta.url));\nX = join(HERE, '..', 'bin', 'a.mjs')", 'module'],
    ["X = fileURLToPath(new URL('./a.mjs', import.meta.url))", 'module'],
    ["X = resolve(process.cwd(), 'bin/a.mjs')", 'root'],
    ["X = path.join(ROOT, 'bin', 'a.mjs')", 'unknown'],
  ];
  // act
  const got = cases.map(([c]) => valueOf(c));
  // assert
  assert.deepEqual(got.map((r) => r.base), cases.map(([, b]) => b));
  assert.equal(got[2].value, '../bin/a.mjs');
  assert.equal(got[3].value, './a.mjs');
});

test('join with a computed segment after the anchor is not resolved', () => {
  // arrange
  const src = "X = join(ROOT, 'bin', name)";
  // act
  const r = valueOf(src);
  // assert
  assert.deepEqual(r, { ok: false, reason: 'computed path segment' });
});

test('dirname of a literal, of __filename, of a computed value', () => {
  // arrange
  const cases = ["X = dirname('a/b/c.mjs')", 'X = dirname(__filename)', 'X = dirname(f())', "X = dirname('c.mjs')", 'X = dirname(process.execPath)'];
  // act
  const got = cases.map((c) => valueOf(c));
  // assert
  assert.deepEqual(got[0], { ok: true, value: 'a/b' });
  assert.deepEqual(got[1], { ok: true, value: '', base: 'module' });
  assert.equal(got[2].ok, false);
  assert.deepEqual(got[3], { ok: true, value: '' });
  assert.deepEqual(got[4], { ok: false, reason: 'computed dirname' });
});

test('process.execPath, String() / Number() wrappers, new URL with a base', () => {
  // arrange
  const cases = ['X = process.execPath', "X = String('a')", "X = new URL('/v1/x', 'https://h.dev/base/')",
    "X = new URL('https://h.dev/y')", "X = new URL('/p', base)", "X = new URL(rel, 'https://h.dev')", "X = new URL('/p', '::')"];
  // act
  const got = cases.map((c) => valueOf(c));
  // assert
  assert.deepEqual(got[0], { ok: true, value: 'node', special: 'execPath' });
  assert.equal(got[1].value, 'a');
  assert.equal(got[2].value, 'https://h.dev/v1/x');
  assert.equal(got[3].value, 'https://h.dev/y');
  assert.equal(got[4].ok, false);
  assert.equal(got[5].ok, false);
  assert.deepEqual(got[6], { ok: false, reason: 'unparseable URL' });
});

test('other expressions, members and calls are reported as computed', () => {
  // arrange
  const cases = ['X = a + b', 'X = cfg.url', 'X = make()', 'X = { a: 1 }'];
  // act
  const got = cases.map((c) => valueOf(c).reason);
  // assert
  assert.deepEqual(got, ['computed expression', 'unresolved cfg.url', 'computed make()', 'computed expression']);
});

test('resolution gives up on a missing descriptor and on a binding cycle', () => {
  // arrange
  const ctx = ctxOf('const A = B;\nconst B = A;\nX = A');
  // act
  const missing = resolveValue(ctx, null);
  const cyc = resolveValue(ctx, exprAt(ctx, ctx.masked.lastIndexOf('A'), ctx.masked.length));
  // assert
  assert.equal(missing.ok, false);
  assert.deepEqual(cyc, { ok: false, reason: 'too deep' });
});

test('a template with an undecodable chunk is not resolved', () => {
  // arrange
  const ctx = ctxOf('X = `a\\u{zz}${b}`');
  // act
  const r = resolveValue(ctx, exprAt(ctx, 4, ctx.masked.length));
  // assert
  assert.equal(r.ok, false);
});

test('templateParts returns null for an unterminated substitution, and the parts otherwise', () => {
  // arrange
  const ctx = ctxOf('X = `a${b}c${d}`');
  // act
  const t = templateParts(ctx, 4);
  // assert
  assert.deepEqual(t.parts.filter((p) => 'lit' in p).map((p) => p.lit), ['a', 'c', '']);
  assert.equal(templateParts({ ...ctx, masked: ctx.masked.replace(/\}/g, ' ') }, 4), null);
  assert.equal(templateParts(ctx, 0), null);
});

test('objectProps reads key: value, shorthand and quoted keys', () => {
  // arrange
  const ctx = ctxOf("f({ host: 'h', port, 'proto': 'http', ...rest })");
  // act
  const props = objectProps(ctx, 2);
  // assert
  assert.deepEqual([...props.keys()], ['host', 'port', 'proto']);
  assert.equal(props.get('port').type, 'ident');
});

test('declInit takes the first declaration and stops at the end of the initialiser', () => {
  // arrange
  const ctx = ctxOf("const A = f(1,\n 2), B = 'x';\nconst A = 'later';");
  // act
  const a = declInit(ctx, 'A');
  const b = declInit(ctx, 'B');
  // assert
  assert.equal(ctx.masked.slice(a.start, a.end), 'f(1,\n 2)');
  assert.equal(b, null);
});

test('exprAt classifies arrays and calls; argsOf is empty for an unclosed call', () => {
  // arrange
  const ctx = ctxOf('X = [a, b]; Y = new Thing(1); Z = f(');
  // act
  const arr = exprAt(ctx, 4, 10);
  const call = exprAt(ctx, 16, 28);
  const none = argsOf(ctx, ctx.masked.length - 1);
  // assert
  assert.equal(arr.type, 'array');
  assert.deepEqual([call.type, call.callee, call.isNew], ['call', 'Thing', true]);
  assert.deepEqual(none, []);
});

test('pathCandidates orders by anchor and drops paths outside the repository', () => {
  // arrange
  const m = 'monitor/a.mjs';
  // act
  const got = [
    pathCandidates(m, { value: 'b.mjs', base: 'module' }),
    pathCandidates(m, { value: 'bin/b.mjs', base: 'root' }),
    pathCandidates(m, { value: 'b.mjs', base: 'unknown' }),
    pathCandidates(m, { value: './b.mjs' }),
    pathCandidates(m, { value: 'bin/b.mjs' }),
    pathCandidates(m, { value: '../../x.mjs', base: 'module' }),
    pathCandidates(m, { value: '', fileOfModule: true, base: 'module' }),
  ];
  // assert
  assert.deepEqual(got, [['monitor/b.mjs'], ['bin/b.mjs'], ['monitor/b.mjs', 'b.mjs'], ['monitor/b.mjs', 'b.mjs'], ['bin/b.mjs', 'monitor/bin/b.mjs'], [], ['monitor/a.mjs']]);
});

test('siteCategory removes identifiers from a reason', () => {
  // arrange
  const reasons = ['unresolved cfg.url', 'computed providerUrl()', 'computed port'];
  // act
  const got = reasons.map(siteCategory);
  // assert
  assert.deepEqual(got, ['unresolved binding', 'computed call', 'computed port']);
});
