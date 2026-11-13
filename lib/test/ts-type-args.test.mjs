// lib/ts-type-args.mjs — call-position type arguments are blanked, nothing else is, and the output
// is the same length with the same newlines, so every line/column on the erased copy is the
// original's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eraseCallTypeArgs } from '../ts-type-args.mjs';

const erased = (src) => eraseCallTypeArgs(src);
const same = (a, b) => { assert.equal(a.length, b.length); assert.deepEqual([...a].map((c, i) => (c === '\n') === (b[i] === '\n')).every(Boolean), true); };

test('typed calls lose their type arguments and nothing else', () => {
  for (const [src, want] of [
    ['const a = await kv.get<number>(["b", u]);', 'const a = await kv.get        (["b", u]);'],
    ['db.queryObject<{ id: string }>(`SELECT ${x}`)', 'db.queryObject                (`SELECT ${x}`)'],
    ['x = f<A, B<C>>(1)', 'x = f         (1)'],
    ['new Map<string, () => void>()', 'new Map                    ()'],
    ['sql<User>`select`', 'sql      `select`'],
    ['xs.map<T>((x) => x)[0]<U>(y)', 'xs.map   ((x) => x)[0]   (y)'],
  ]) {
    const r = erased(src);
    assert.equal(r.ok, true);
    assert.equal(r.text, want, src);
    same(r.text, src);
  }
});

test('comparisons, annotations, strings, comments and regexes are untouched', () => {
  for (const src of [
    'if (a < b && c > (d)) {}',
    'i < n > (x)',
    'foo <T>(x)',
    'const t: Array<string> = [];',
    'const s = "kv.get<number>(k)"; // kv.get<T>(x)',
    '/* f<T>(x) */ const r = /a<b>(c)/;',
    'const m = `${a}<b>(c)`;',
    'if (x < y || z > (w)) {}',
  ]) {
    const r = erased(src);
    assert.equal(r.text, src, src);
    assert.equal(r.sites.length, 0, src);
  }
});

test('a type argument spanning lines keeps its newlines, so later lines do not move', () => {
  const src = 'const r = await db.queryObject<{\n  id: string;\n  name: string;\n}>(sql);\nnext();';
  const r = erased(src);
  same(r.text, src);
  assert.equal(r.text.split('\n').length, src.split('\n').length);
  assert.match(r.text, /queryObject\s+\(sql\)/);
  assert.equal(r.sites[0].line, 1);
});

test('a file the lexer cannot classify is returned unchanged with ok:false — never half-erased', () => {
  const src = 'const s = "unterminated;\nf<T>(x)';
  const r = erased(src);
  assert.equal(r.ok, false);
  assert.equal(r.text, src);
});
