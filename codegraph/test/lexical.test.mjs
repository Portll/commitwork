// W1, and the ways it is allowed to be wrong.
//
// The negative controls come FIRST. Everything below them is consistent with an extractor that
// returns [] for every input, and this repository has shipped exactly that: a comment stripper that
// swallowed 1,375 lines of admin/serve.mjs and reported a clean tree it had never read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, importBindings, braceIndex } from '../lexical.mjs';

test('the extractor can FAIL — a file it cannot classify is not a clean one', () => {
  const unterminated = extract('const a = "never closed;\nexport function ghost() {}\n');
  assert.equal(unterminated.ok, false, 'an unterminated string must bail, not yield a partial read');
  assert.deepEqual(unterminated.symbols, [], 'a bailed read contributes nothing');
  assert.deepEqual(unterminated.exportedNames, [], 'and claims no surface');
  assert.match(unterminated.reason, /lexer bailed/);

  const unbalanced = extract('export function a() { \n');
  assert.equal(unbalanced.ok, false, 'an unclosed brace must bail');
  assert.match(unbalanced.reason, /brace scan failed|lexer bailed/);
});

test('it can find something — the positive control for the control above', () => {
  const r = extract('export function alpha() { return 1; }\n');
  assert.equal(r.ok, true);
  assert.deepEqual(r.symbols.map((s) => s.name), ['alpha']);
  assert.deepEqual(r.exportedNames, ['alpha']);
});

test('prose about an export is not an export', () => {
  const r = extract([
    '// export function commentGhost() {}',
    '/* export class BlockGhost {} */',
    'const s = "export function stringGhost() {}";',
    'const t = `export const templateGhost = 1;`;',
    'export function real() {}',
  ].join('\n'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.exportedNames, ['real'],
    'only the declaration outside every string and comment counts');
  assert.deepEqual(r.symbols.filter((x) => /Ghost/.test(x.name)), [],
    'no ghost may become a symbol');
});

test('a regex literal containing quotes does not desync the read', () => {
  // The measured failure mode in bin/lib/tracked-imports.mjs: /class="…"/ opened a string state
  // that never closed, and unrelated text landed in specifier position.
  const r = extract('const re = /class="[^"]*"/g;\nexport function after() {}\n');
  assert.equal(r.ok, true);
  assert.deepEqual(r.exportedNames, ['after']);
});

test('anonymous default exports are found — the hole W2 measured on 22 files', () => {
  for (const src of [
    'export default { a: 1 };\n',
    'export default function () {}\n',
    'export default class {}\n',
    'const routes = [];\nexport default routes;\n',
  ]) {
    assert.ok(extract(src).exportedNames.includes('default'), `no default found in: ${src.trim()}`);
  }
});

test('a re-export puts a name on the surface without declaring a symbol', () => {
  const r = extract("export { baseUrlFor as llmBaseUrl } from './hosts.mjs';\n");
  assert.deepEqual(r.exportedNames, ['llmBaseUrl'], 'the ALIAS is the exported name');
  assert.deepEqual(r.symbols, [], 'and nothing here declares it — the declaration is in another file');
});

test('W1 reads every re-export shape, and what each one resolves to', () => {
  const src = [
    "export { a, b as c, default as d } from './named.mjs';",
    "export {\n  e, // trailing comment\n  /* lead */ f as g,\n} from './multi.mjs';",
    "export * from './star.mjs';",
    "export * as ns from './space.mjs';",
    "import { h as hLocal } from './indirect.mjs';",
    'export { hLocal as h };',
    "import * as whole from './whole.mjs';",
    'export { whole };',
    "import { carried } from './star.mjs';",
    "import { twice } from './star.mjs';",
    "import { twice as again } from './other-star.mjs';",
    "export * from './other-star.mjs';",
  ].join('\n');
  const r = extract(src);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.reexports.map(({ exported, spec, imported, kind }) => `${kind} ${exported} <- ${spec}#${imported}`), [
    'star * <- ./other-star.mjs#*',
    'star * <- ./star.mjs#*',
    'named a <- ./named.mjs#a',
    'named c <- ./named.mjs#b',
    'named carried <- ./star.mjs#carried',
    'named d <- ./named.mjs#default',
    'named e <- ./multi.mjs#e',
    'named g <- ./multi.mjs#f',
    'named h <- ./indirect.mjs#h',
    'namespace ns <- ./space.mjs#*',
    'namespace whole <- ./whole.mjs#*',
  ], 'an imported-then-exported name is an indirect export, and a star carries what this module demands of it');
  assert.ok(!r.reexports.some((x) => x.exported === 'twice'), 'two stars carrying one name make it ambiguous, on neither surface');
  for (const n of ['ns', 'carried']) assert.ok(r.exportedNames.includes(n), `${n} is on the surface`);
  assert.equal(r.reexports.find((x) => x.exported === 'c').line, 1, 'the line is evidence, carried for `about`');
});

test('a local export is not a re-export, even of a value that came from an import', () => {
  const r = extract([
    "import x from './b.mjs';",
    'export default x;',
    'export const alias = x;',
    'const y = 1;',
    'export { y as z };',
  ].join('\n'));
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.reexports, [], '`export default x` and `export const alias = x` are expressions over a local binding');
  assert.deepEqual(r.exportedNames, ['alias', 'default', 'z']);
});

test('only module-level declarations are symbols', () => {
  const r = extract([
    'export function outer() {',
    '  const helper = () => 1;',
    '  function inner() { return helper(); }',
    '  return inner();',
    '}',
  ].join('\n'));
  assert.deepEqual(r.symbols.map((s) => s.name), ['outer'],
    'inner declarations are real and are deliberately not symbols; the limit is stated, not hidden');
});

test('class members become symbols, object-literal methods do not', () => {
  const r = extract('export class Thing {\n  alpha() { return 1; }\n  static beta() {}\n}\nconst obj = { gamma() {} };\n');
  const names = r.symbols.map((s) => s.name);
  assert.ok(names.includes('Thing.alpha'), 'a class member is a symbol');
  assert.ok(names.includes('Thing.beta'), 'including a static one');
  assert.ok(!names.some((n) => n.endsWith('.gamma')), 'an object-literal method is NOT a class member');
});

test('calls attribute to the enclosing top-level symbol, and member calls are not module calls', () => {
  const r = extract([
    'function helper() {}',
    'export function caller() { helper(); }',
    'const obj = {};',
    'export function member() { obj.helper(); }',
  ].join('\n'));
  const toHelper = r.calls.filter((c) => c.name === 'helper');
  assert.deepEqual(toHelper.map((c) => c.from), ['caller'],
    'obj.helper() is a member call and must not be read as a call to the module-level helper');
});

test('a symbol carries its line as EVIDENCE and is not identified by it', () => {
  const one = extract('export function alpha() {}\n');
  const two = extract('\n\n\n// a comment pushes it down\nexport function alpha() {}\n');
  assert.notEqual(one.symbols[0].line, two.symbols[0].line, 'the line did move');
  assert.equal(one.symbols[0].name, two.symbols[0].name, 'and the identity did not');
});

test('import bindings keep the local alias and the exported name apart', () => {
  const r = extract("import { formatReport as fmtOrphans, orphans } from './orphans.mjs';\n"
    + "import def from './d.mjs';\nimport * as ns from './n.mjs';\nimport './side.mjs';\n");
  const b = importBindings(r.masked, "import { formatReport as fmtOrphans, orphans } from './orphans.mjs';\n"
    + "import def from './d.mjs';\nimport * as ns from './n.mjs';\nimport './side.mjs';\n");
  assert.deepEqual(b.find((x) => x.local === 'fmtOrphans'),
    { spec: './orphans.mjs', local: 'fmtOrphans', exported: 'formatReport', kind: 'named' });
  assert.deepEqual(b.find((x) => x.kind === 'default'), { spec: './d.mjs', local: 'def', exported: 'default', kind: 'default' });
  assert.deepEqual(b.find((x) => x.kind === 'star'), { spec: './n.mjs', local: 'ns', exported: '*', kind: 'star' });
  assert.ok(b.some((x) => x.kind === 'bare' && x.spec === './side.mjs'), 'a side-effect import is still an edge');
});

test('the specifier is read from the SOURCE even though matching runs on the mask', () => {
  // The mask replaces string interiors with filler. Reading the specifier off it yields 'xxxxxxxxx'.
  const src = "import { a } from './real-path.mjs';\n";
  const r = extract(src);
  assert.equal(importBindings(r.masked, src)[0].spec, './real-path.mjs');
  assert.match(importBindings(r.masked)[0].spec, /^x+$/,
    'and reading it off the mask alone gives filler — which is why the source is passed');
});

test('braceIndex refuses an unbalanced source rather than returning a depth map it invented', () => {
  assert.equal(braceIndex('function a() { ').ok, false);
  assert.equal(braceIndex('}{').ok, false);
  assert.equal(braceIndex('function a() {}').ok, true);
});

test('a destructured parameter is not the body: calls inside attribute to their function', () => {
  const src = [
    'export function f({ a } = {}, [b] = []) { g(); }',
    'const h = async ({ x }) => { k(); };',
    'const e = ({ y }) => m(y);',
    'class C { meth({ z } = {}) { n(); } }',
    'const o = { p: q() };',
    'const t = (u) => `${v(u)}`;',
    'const w = () => ({ r: s() });',
  ].join('\n');
  const r = extract(src);
  assert.equal(r.ok, true);
  const from = Object.fromEntries(r.calls.map((c) => [c.name, c.from]));
  assert.deepEqual(from, { g: 'f', k: 'h', m: 'e', n: 'C.meth', q: 'o', v: 't', s: 'w' });
  const body = (name) => { const s = r.symbols.find((x) => x.name === name); return src.slice(s.body[0], s.body[1] + 1); };
  assert.equal(body('f'), '{ g(); }');
  assert.equal(body('o'), '{ p: q() }', 'an object-literal const keeps its own braces');
});
