// Tests for bin/bare-catch-ratchet.mjs — the gate that refuses NEW bare `catch {` sites.
// Everything runs on a throwaway mkdtemp tree, never a checked-in fixture directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  stripNonCode, scanSource, scopeNameAt, collectFiles, measureTree, keyFor,
  compare, loadBaseline, criticalReport, strictCritical, totalOf, digestOf,
  baselinePath, scanRoot, EXIT, main, CRITICAL_FILES,
} from '../bare-catch-ratchet.mjs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ── harness ─────────────────────────────────────────────────────────────────────────────────────
const dirs = [];
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'bcr-'));
  dirs.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const sink = () => ({ text: '', write(s) { this.text += s; } });

/** Drive the CLI in-process against a scratch root+baseline. Returns { code, out, err }. */
function run(root, args = [], { baseline = join(root, 'baseline.json'), env = {} } = {}) {
  const saved = { ...process.env };
  process.env.CW_BARE_CATCH_ROOT = root;
  process.env.CW_BARE_CATCH_BASELINE = baseline;
  process.env.CW_NOW = '2026-08-20T00:00:00.000Z';
  delete process.env.CW_BARE_CATCH_STRICT_CRITICAL;
  Object.assign(process.env, env);
  const out = sink(), err = sink();
  try {
    const code = main(['node', 'bare-catch-ratchet.mjs', ...args], out, err);
    return { code, out: out.text, err: err.text };
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

// ── the lexer ───────────────────────────────────────────────────────────────────────────────────
test('stripNonCode preserves length and newlines so offsets and line numbers survive', () => {
  const src = "const a = 'x\\ny';\n// c\n/* d\n e */\n`t${1}u`\n";
  const t = stripNonCode(src);
  assert.equal(t.length, src.length);
  assert.equal([...t].filter((c) => c === '\n').length, [...src].filter((c) => c === '\n').length);
});

test('a bare catch inside a comment, a string or a template is NOT code', () => {
  // the tool is a lexer, not a regex — this repo writes ABOUT bare catches in comments constantly
  const src = [
    '// the old `catch {}` turned an unreadable file into zero findings',
    'const msg = "catch {";',
    "const other = 'catch {';",
    'const tpl = `catch {`;',
    '/* catch { */',
    'const re = /catch \\{/;',
  ].join('\n');
  assert.deepEqual(scanSource(src), []);
});

test('an interpolation is code, and its braces do not unbalance the file', () => {
  const src = 'const x = `a${(() => { try { f(); } catch { return 1; } })()}b`;\n';
  const sites = scanSource(src);
  assert.equal(sites.length, 1, 'the catch inside ${} is real code and must be counted');
});

test('a division sign is not a regex', () => {
  const src = 'const r = (a) / (b) / 2;\nfunction f() { try { g(); } catch { h(); } }\n';
  assert.equal(scanSource(src).length, 1);
});

test('an unterminated string is a FAILURE, never zero findings', () => {
  assert.throws(() => scanSource('const a = "oops;\n', 'x.mjs'), /unlexable/);
});

test('a source whose braces do not balance after stripping loses lexer confidence and throws', () => {
  assert.throws(() => scanSource('function f() { try { g(); } catch { }\n', 'x.mjs'), /unbalanced after strip/);
});

// ── what counts as a bare catch ─────────────────────────────────────────────────────────────────
test('catch WITH a parameter is out of population, bare catch is in', () => {
  const src = [
    'function a() { try { x(); } catch (e) { y(); } }',
    'function b() { try { x(); } catch { y(); } }',
    'function c() { try { x(); } catch{} }',
    'function d() { try { x(); } catch\n{ } }',
  ].join('\n');
  const sites = scanSource(src);
  assert.deepEqual(sites.map((s) => s.symbol), ['b', 'c', 'd']);
});

// ── scope naming ────────────────────────────────────────────────────────────────────────────────
const symbolsOf = (src) => scanSource(src).map((s) => s.symbol);

test('named scopes: function, method, arrow const, class chain, module top level', () => {
  assert.deepEqual(symbolsOf('function readLedger() { try { x(); } catch { } }'), ['readLedger']);
  assert.deepEqual(symbolsOf('export async function loadIt(a, b = f(1)) { try { x(); } catch { } }'), ['loadIt']);
  assert.deepEqual(symbolsOf('class Store { read(k) { try { x(); } catch { } } }'), ['Store>read']);
  assert.deepEqual(symbolsOf('const readIt = (p) => { try { x(); } catch { } };'), ['readIt']);
  assert.deepEqual(symbolsOf('const readIt = async (p) => { try { x(); } catch { } };'), ['readIt']);
  assert.deepEqual(symbolsOf('const readIt = function (p) { try { x(); } catch { } };'), ['readIt']);
  assert.deepEqual(symbolsOf('const readIt = async function (p) { try { x(); } catch { } };'), ['readIt']);
  assert.deepEqual(symbolsOf('const readIt = async p => { try { x(); } catch { } };'), ['readIt']);
  assert.deepEqual(symbolsOf('const o = { readIt: async (p) => { try { x(); } catch { } } };'), ['readIt']);
  assert.deepEqual(symbolsOf('try { x(); } catch { }'), ['<module>']);
});

test('an unnamed block inherits its enclosing named scope — it does not become its own key', () => {
  const src = 'function readLedger(p) {\n  if (p) {\n    for (const q of p) {\n      try { x(); } catch { }\n    }\n  }\n}';
  assert.deepEqual(symbolsOf(src), ['readLedger']);
});

test('a control-flow header is never mistaken for a function name', () => {
  for (const kw of ['if (a)', 'for (const a of b)', 'while (a)', 'switch (a)']) {
    assert.deepEqual(symbolsOf(`function f() { ${kw} { try { x(); } catch { } } }`), ['f'], kw);
  }
});

test('scopeNameAt is best-effort and returns null rather than a wrong name', () => {
  const t = stripNonCode('const o = { a: 1 };');
  assert.equal(scopeNameAt(t, t.indexOf('{', 8)), null);
});

// ── THE HOUSE RULE: identity must not be keyed on a line ────────────────────────────────────────
test('inserting unrelated lines above a catch changes NO key and NO count', () => {
  // a line-keyed identity turns code movement into a state change
  const body = 'function readLedger() {\n  try { x(); } catch { }\n}\n';
  const moved = `// a\n// b\n// c\nconst z = 1;\n${body}`;
  const a = scanSource(body), b = scanSource(moved);
  assert.notEqual(a[0].line, b[0].line, 'the site really did move');
  assert.deepEqual(a.map((s) => s.symbol), b.map((s) => s.symbol));
  assert.equal(keyFor('f.mjs', a[0].symbol), keyFor('f.mjs', b[0].symbol));
});

test('no key contains a line number', () => {
  const root = tree({ 'a.mjs': 'function f() {\n\n\n  try { x(); } catch { }\n}\n' });
  const { counts } = measureTree({ root });
  for (const k of Object.keys(counts)) assert.ok(!/:\d+/.test(k.replace('::', '')), `key looks line-keyed: ${k}`);
  assert.deepEqual(counts, { 'a.mjs::f': 1 });
});

// ── set difference, not a count ─────────────────────────────────────────────────────────────────
test('an intra-tree swap that leaves the total unchanged is still caught', () => {
  const before = { 'a.mjs::cold': 1, 'b.mjs::auth': 0 };
  delete before['b.mjs::auth'];
  const after = { 'b.mjs::auth': 1 };
  const d = compare(after, before);
  assert.equal(totalOf(after), totalOf(before), 'the total is deliberately identical');
  assert.deepEqual(d.added, [{ key: 'b.mjs::auth', now: 1 }]);
  assert.deepEqual(d.gone, [{ key: 'a.mjs::cold', was: 1 }]);
});

test('a second bare catch in an already-tracked function GREWS the key', () => {
  const d = compare({ 'a.mjs::f': 2 }, { 'a.mjs::f': 1 });
  assert.deepEqual(d.grew, [{ key: 'a.mjs::f', was: 1, now: 2 }]);
  assert.deepEqual(d.added, []);
});

test('the documented residual hole is real: an intra-KEY swap is invisible', () => {
  // same key, same count, gate green — asserted so the limitation cannot rot unnoticed
  const one = 'function f() {\n  try { a(); } catch { }\n  try { b(); } catch { }\n}\n';
  const two = 'function f() {\n  try { b(); } catch { }\n  try { c(); } catch { }\n}\n';
  assert.deepEqual(scanSource(one).map((s) => s.symbol), scanSource(two).map((s) => s.symbol));
  assert.deepEqual(compare({ 'a.mjs::f': 2 }, { 'a.mjs::f': 2 }).added, []);
});

// ── scope of the walk ───────────────────────────────────────────────────────────────────────────
test('tests, vendored code and generated data are out of scope; the list is sorted', () => {
  const root = tree({
    'b.mjs': '', 'a.mjs': '', 'a.test.mjs': '',
    'test/x.mjs': '', 'vendor/v.mjs': '', 'data/d.mjs': '',
    'node_modules/p/i.mjs': '', 'sub/c.mjs': '', 'sub/readme.md': '',
  });
  assert.deepEqual(collectFiles(root), ['a.mjs', 'b.mjs', 'sub/c.mjs']);
});

test('env paths are read at CALL time, not at module load', () => {
  const root = tree({ 'a.mjs': 'function f() { try { x(); } catch { } }\n' });
  const saved = process.env.CW_BARE_CATCH_ROOT;
  process.env.CW_BARE_CATCH_ROOT = root;
  try {
    assert.equal(scanRoot(), root);
    assert.deepEqual(measureTree().counts, { 'a.mjs::f': 1 });
  } finally {
    if (saved === undefined) delete process.env.CW_BARE_CATCH_ROOT; else process.env.CW_BARE_CATCH_ROOT = saved;
  }
});

test('baselinePath honours its override at call time', () => {
  const saved = process.env.CW_BARE_CATCH_BASELINE;
  process.env.CW_BARE_CATCH_BASELINE = '/tmp/nope.json';
  try { assert.equal(baselinePath(), '/tmp/nope.json'); }
  finally { if (saved === undefined) delete process.env.CW_BARE_CATCH_BASELINE; else process.env.CW_BARE_CATCH_BASELINE = saved; }
});

// ── fail closed ─────────────────────────────────────────────────────────────────────────────────
test('an unreadable source FAILS the run; it is never zero findings', () => {
  const root = tree({ 'ok.mjs': '', 'broken.mjs': 'const a = "unterminated\n' });
  const r = run(root, []);
  assert.equal(r.code, EXIT.FAILURE);
  assert.match(r.err, /FAILURE/);
  assert.match(r.err, /broken\.mjs/);
});

test('an unreadable BASELINE fails closed and is distinguished from an absent one', () => {
  const root = tree({ 'a.mjs': '' });
  const bad = join(root, 'bad.json');
  writeFileSync(bad, '{ not json');
  assert.equal(loadBaseline(bad).state, 'unreadable');
  const r = run(root, [], { baseline: bad });
  assert.equal(r.code, EXIT.FAILURE);
  assert.match(r.err, /baseline unreadable/);
  assert.match(r.err, /NOT "no findings"/);
});

test('a baseline of the wrong SHAPE is unreadable, not an empty baseline', () => {
  const root = tree({ 'a.mjs': '' });
  for (const body of ['[]', '{"keys": []}', '{"keys": {"a.mjs::f": "1"}}', '{"keys": {"a.mjs::f": -1}}', 'null']) {
    const p = join(root, 'shape.json');
    writeFileSync(p, body);
    assert.equal(loadBaseline(p).state, 'unreadable', body);
  }
});

test('an unreadable directory is a failure, not an empty tree', { skip: process.getuid && process.getuid() === 0 }, () => {
  const root = tree({ 'a.mjs': '', 'locked/x.mjs': '' });
  chmodSync(join(root, 'locked'), 0o000);
  try { assert.throws(() => collectFiles(root), (e) => e.code === 'EACCES'); }
  finally { chmodSync(join(root, 'locked'), 0o755); }
});

test('ONLY ENOENT is absence, and absence is its own exit code — never a pass', () => {
  const root = tree({ 'a.mjs': 'function f() { try { x(); } catch { } }\n' });
  const r = run(root, [], { baseline: join(root, 'missing.json') });
  assert.equal(r.code, EXIT.NOT_SEEDED);
  assert.notEqual(r.code, EXIT.PASS);
  assert.match(r.err, /NOT SEEDED/);
  assert.match(r.err, /gate anyone clears by deleting a file/);
});

// ── seeding ─────────────────────────────────────────────────────────────────────────────────────
test('--seed writes the baseline, then refuses to overwrite it without --force', () => {
  const root = tree({ 'a.mjs': 'function f() { try { x(); } catch { } }\n' });
  const bp = join(root, 'baseline.json');
  assert.equal(run(root, ['--seed']).code, EXIT.PASS);
  const doc = JSON.parse(readFileSync(bp, 'utf8'));
  assert.deepEqual(doc.keys, { 'a.mjs::f': 1 });
  assert.equal(doc.journal.at(-1).action, 'seed');

  const again = run(root, ['--seed']);
  assert.equal(again.code, EXIT.FAILURE);
  assert.match(again.err, /already exists/);
  assert.equal(run(root, ['--seed', '--force']).code, EXIT.PASS);
  assert.equal(JSON.parse(readFileSync(bp, 'utf8')).journal.at(-1).action, 'reseed');
});

test('--seed refuses to overwrite an UNREADABLE baseline', () => {
  const root = tree({ 'a.mjs': '' });
  const bp = join(root, 'baseline.json');
  writeFileSync(bp, 'corrupt');
  const r = run(root, ['--seed']);
  assert.equal(r.code, EXIT.FAILURE);
  assert.equal(readFileSync(bp, 'utf8'), 'corrupt', 'the corrupt prior must survive untouched');
});

test('the write is atomic and leaves no tmp file behind', () => {
  const root = tree({ 'a.mjs': 'function f() { try { x(); } catch { } }\n' });
  run(root, ['--seed']);
  assert.deepEqual(readdirSync(root).filter((f) => f.includes('.tmp-')), []);
});

// ── THE GATE BITES ──────────────────────────────────────────────────────────────────────────────
test('adding a bare catch to a seeded tree FAILS with exit 1', () => {
  const root = tree({ 'a.mjs': 'function f() { try { x(); } catch { } }\n' });
  assert.equal(run(root, ['--seed']).code, EXIT.PASS);
  assert.equal(run(root, []).code, EXIT.PASS, 'unchanged tree passes');

  writeFileSync(join(root, 'a.mjs'), 'function f() { try { x(); } catch { } }\nfunction g() { try { y(); } catch { } }\n');
  const bite = run(root, []);
  assert.equal(bite.code, EXIT.FINDINGS);
  assert.match(bite.err, /NEW\s+a\.mjs::g/);
  assert.match(bite.err, /rethrowIfBug/);
});

test('a swap that keeps the total identical still fails', () => {
  const root = tree({ 'cold.mjs': 'function cold() { try { x(); } catch { } }\n', 'auth.mjs': 'function auth() { try { x(); } }\n' });
  writeFileSync(join(root, 'auth.mjs'), 'function auth() { try { x(); } catch (e) { t(e); } }\n');
  assert.equal(run(root, ['--seed']).code, EXIT.PASS);
  const before = JSON.parse(readFileSync(join(root, 'baseline.json'), 'utf8'));

  writeFileSync(join(root, 'cold.mjs'), 'function cold() { try { x(); } catch (e) { t(e); } }\n');
  writeFileSync(join(root, 'auth.mjs'), 'function auth() { try { x(); } catch { } }\n');
  const after = measureTree({ root: root });
  const r = run(root, ['--json']);
  assert.equal(totalOf(after.counts), totalOf(before.keys), 'total is unchanged — a count-based gate would pass here');
  assert.equal(r.code, EXIT.FINDINGS);
  assert.deepEqual(JSON.parse(r.out).added, [{ key: 'auth.mjs::auth', now: 1 }]);
});

test('a pure improvement passes but is NOT auto-banked', () => {
  const root = tree({ 'a.mjs': 'function f() { try { x(); } catch { } }\n' });
  run(root, ['--seed']);
  writeFileSync(join(root, 'a.mjs'), 'function f() { try { x(); } catch (e) { rethrowIfBug(e); } }\n');
  const r = run(root, ['--json']);
  assert.equal(r.code, EXIT.PASS);
  assert.deepEqual(JSON.parse(r.out).gone, [{ key: 'a.mjs::f', was: 1 }]);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'baseline.json'), 'utf8')).keys, { 'a.mjs::f': 1 }, 'floor unchanged until --tighten');
});

// ── tighten / accept ────────────────────────────────────────────────────────────────────────────
test('--tighten banks improvements and can never raise a count', () => {
  const root = tree({ 'a.mjs': 'function f() { try { x(); } catch { } }\nfunction g() { try { y(); } catch { } }\n' });
  run(root, ['--seed']);
  writeFileSync(join(root, 'a.mjs'), 'function f() { try { x(); } catch (e) { r(e); } }\nfunction g() { try { y(); } catch { } }\n');
  assert.equal(run(root, ['--tighten']).code, EXIT.PASS);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'baseline.json'), 'utf8')).keys, { 'a.mjs::g': 1 });
});

test('--tighten REFUSES while the set has gained a member — it cannot launder a regression', () => {
  const root = tree({ 'a.mjs': 'function f() { try { x(); } catch { } }\n' });
  run(root, ['--seed']);
  writeFileSync(join(root, 'a.mjs'), 'function f() { try { x(); } catch (e) { r(e); } }\nfunction g() { try { y(); } catch { } }\n');
  const r = run(root, ['--tighten']);
  assert.equal(r.code, EXIT.FAILURE);
  assert.match(r.err, /refusing to tighten/);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'baseline.json'), 'utf8')).keys, { 'a.mjs::f': 1 }, 'baseline untouched');
});

test('--accept demands a reason and records it', () => {
  const root = tree({ 'a.mjs': 'function f() { try { x(); } catch { } }\n' });
  run(root, ['--seed']);
  writeFileSync(join(root, 'a.mjs'), 'function f() { try { x(); } catch { } }\nfunction g() { try { y(); } catch { } }\n');
  assert.equal(run(root, ['--accept']).code, EXIT.FAILURE);
  assert.equal(run(root, ['--accept', '--reason', '--json']).code, EXIT.FAILURE, 'a flag is not a reason');
  const ok = run(root, ['--accept', '--reason', 'best-effort git call']);
  assert.equal(ok.code, EXIT.PASS);
  const doc = JSON.parse(readFileSync(join(root, 'baseline.json'), 'utf8'));
  assert.equal(doc.journal.at(-1).reason, 'best-effort git call');
  assert.deepEqual(doc.journal.at(-1).added, ['a.mjs::g']);
  assert.equal(run(root, []).code, EXIT.PASS);
});

// ── --rekey: a move is not a new catch ──────────────────────────────────────────────────────────
// Written to be backslash-free: every fixture is a template literal with real newlines.
const F1 = `function f() { try { x(); } catch { } }
`;
const F2 = `function f() { try { x(); } catch { } try { z(); } catch { } }
`;
const G1 = `function g() { try { y(); } catch { } }
`;
const baselineOf = (root) => JSON.parse(readFileSync(join(root, 'baseline.json'), 'utf8'));

test('a pure move reads as NEW until --rekey records it, then passes with the total unchanged', () => {
  const root = tree({ 'a.mjs': F1 + G1 });
  run(root, ['--seed']);
  writeFileSync(join(root, 'a.mjs'), G1);
  writeFileSync(join(root, 'b.mjs'), F1);
  const before = run(root, []);
  assert.equal(before.code, EXIT.FINDINGS, 'the problem --rekey exists for: a move reads as a new catch');
  assert.ok(before.err.includes('NEW    b.mjs::f'), before.err);
  assert.ok(before.err.includes('--rekey'), 'the hint must point a move at the narrow tool, not only at --accept');
  const r = run(root, ['--rekey', 'a.mjs', 'b.mjs']);
  assert.equal(r.code, EXIT.PASS, r.err);
  assert.deepEqual(baselineOf(root).keys, { 'a.mjs::g': 1, 'b.mjs::f': 1 });
  assert.equal(run(root, []).code, EXIT.PASS);
  const j = baselineOf(root).journal.at(-1);
  assert.deepEqual([j.action, j.from, j.to, j.moved, j.total], ['rekey', 'a.mjs', 'b.mjs', ['f'], 2]);
});

test('--rekey carries the BASELINE count, never the current one: drift moves with the code and stays visible', () => {
  const root = tree({ 'a.mjs': F1 + G1 });
  run(root, ['--seed']);
  writeFileSync(join(root, 'a.mjs'), G1);
  writeFileSync(join(root, 'b.mjs'), F2);                     // moved AND grew
  assert.equal(run(root, ['--rekey', 'a.mjs', 'b.mjs']).code, EXIT.PASS);
  assert.equal(baselineOf(root).keys['b.mjs::f'], 1, 'the allowance moved; the growth was not banked');
  const after = run(root, []);
  assert.equal(after.code, EXIT.FINDINGS);
  assert.ok(after.err.includes('GREW   b.mjs::f  1 → 2'), after.err);
});

test('--rekey does not launder unrelated drift: the property --accept could not offer', () => {
  // The reason the mode exists. --accept writes `keys: counts` for the whole tree, so recording one
  // move that way would also bank every other session's new bare catch sitting in the tree.
  const root = tree({ 'a.mjs': F1 + G1 });
  run(root, ['--seed']);
  writeFileSync(join(root, 'a.mjs'), G1);
  writeFileSync(join(root, 'b.mjs'), F1);
  writeFileSync(join(root, 'c.mjs'), `function h() { try { w(); } catch { } }
`);                                                           // somebody else's new bare catch
  assert.equal(run(root, ['--rekey', 'a.mjs', 'b.mjs']).code, EXIT.PASS);
  assert.equal(baselineOf(root).keys['c.mjs::h'], undefined, 'a move must not bank an unrelated key');
  const after = run(root, []);
  assert.equal(after.code, EXIT.FINDINGS);
  assert.ok(after.err.includes('NEW    c.mjs::h'), after.err);
  assert.ok(!after.err.includes('b.mjs::f'), 'the move itself no longer reports');
});

test('--rekey refuses a scope present in BOTH files: which half inherits the allowance is a judgment', () => {
  const root = tree({ 'a.mjs': F1 });
  run(root, ['--seed']);
  writeFileSync(join(root, 'b.mjs'), F1);                     // f now lives in both
  const before = baselineOf(root);
  const r = run(root, ['--rekey', 'a.mjs', 'b.mjs']);
  assert.equal(r.code, EXIT.FAILURE);
  assert.ok(r.err.includes('BOTH'), r.err);
  assert.deepEqual(baselineOf(root), before, 'baseline untouched');
});

test('--rekey refuses when nothing moves, and a missing, flag-shaped or identical path is a usage failure', () => {
  const root = tree({ 'a.mjs': F1 });
  run(root, ['--seed']);
  writeFileSync(join(root, 'a.mjs'), '');
  writeFileSync(join(root, 'b.mjs'), F1);
  const typo = run(root, ['--rekey', 'a.mjs', 'bb.mjs']);
  assert.equal(typo.code, EXIT.FAILURE, 'a mistyped destination moves nothing and must say so');
  assert.ok(typo.err.includes('nothing to rekey'), typo.err);
  assert.equal(run(root, ['--rekey', 'a.mjs']).code, EXIT.FAILURE);
  assert.equal(run(root, ['--rekey', 'a.mjs', '--json']).code, EXIT.FAILURE);
  assert.equal(run(root, ['--rekey', 'a.mjs', 'a.mjs']).code, EXIT.FAILURE);
});

test('a move out of a critical module carries the critical watch to the new path', () => {
  // The watch is keyed on an exact path. Without this, splitting a critical module would quietly
  // move its bare catches out from under the one list that says they must reach zero.
  const root = tree({ 'a.mjs': F1 + G1 });
  run(root, ['--seed']);
  writeFileSync(join(root, 'baseline.json'), JSON.stringify({ ...baselineOf(root), critical: ['a.mjs', 'z.mjs'] }));
  writeFileSync(join(root, 'a.mjs'), G1);
  writeFileSync(join(root, 'b.mjs'), F1);
  const r = run(root, ['--rekey', 'a.mjs', 'b.mjs']);
  assert.equal(r.code, EXIT.PASS, r.err);
  assert.ok(r.out.includes('joins the critical modules'), r.out);
  assert.deepEqual(baselineOf(root).critical, ['a.mjs', 'b.mjs', 'z.mjs'], 'inserted beside its origin');
  const s = JSON.parse(run(root, ['--json']).out);
  assert.deepEqual(s.critical, [{ file: 'a.mjs', count: 1 }, { file: 'b.mjs', count: 1 }, { file: 'z.mjs', count: 0 }],
    'the moved catch is still counted against a critical module');
});

test('every critical path the real baseline watches is also in CRITICAL_FILES, or a --seed would drop it', () => {
  // --rekey writes a moved module into the BASELINE's critical list; --seed rebuilds that list from
  // the CRITICAL_FILES constant. If the constant is not updated alongside the rekey, the next
  // re-seed silently stops watching the code that moved.
  const doc = JSON.parse(readFileSync(join(REPO_ROOT, 'bin', 'bare-catch-baseline.json'), 'utf8'));
  const missing = doc.critical.filter((f) => !CRITICAL_FILES.includes(f));
  assert.deepEqual(missing, [], `in the baseline's critical list but not in CRITICAL_FILES: ${missing.join(', ')}`);
});

// ── critical modules and the acceptance predicate ───────────────────────────────────────────────
test('criticalReport sums by file across every scope key in that file', () => {
  const counts = { 'admin/auth.mjs::saveStore': 1, 'admin/auth.mjs::readStore': 2, 'other.mjs::f': 9 };
  assert.deepEqual(criticalReport(counts, ['admin/auth.mjs', 'monitor/rollup.mjs']), [
    { file: 'admin/auth.mjs', count: 3 },
    { file: 'monitor/rollup.mjs', count: 0 },
  ]);
});

test('a critical file does not match by prefix alone', () => {
  assert.deepEqual(criticalReport({ 'admin/auth.mjs.bak::f': 1 }, ['admin/auth.mjs']), [{ file: 'admin/auth.mjs', count: 0 }]);
});

test('acceptance is a state predicate: never-gained AND critical empty', () => {
  const root = tree({ 'crit.mjs': 'function f() { try { x(); } catch { } }\n' });
  const bp = join(root, 'baseline.json');
  run(root, ['--seed']);
  const doc = JSON.parse(readFileSync(bp, 'utf8'));
  doc.critical = ['crit.mjs'];
  writeFileSync(bp, JSON.stringify(doc));

  const held = JSON.parse(run(root, ['--json']).out);
  assert.deepEqual(held.acceptance, { neverGained: true, criticalEmpty: false, met: false });
  assert.deepEqual(held.critical, [{ file: 'crit.mjs', count: 1 }]);

  writeFileSync(join(root, 'crit.mjs'), 'function f() { try { x(); } catch (e) { r(e); } }\n');
  const met = JSON.parse(run(root, ['--json']).out);
  assert.deepEqual(met.acceptance, { neverGained: true, criticalEmpty: true, met: true });
});

test('--strict-critical turns an outstanding critical module into a failure; it is off by default', () => {
  const root = tree({ 'crit.mjs': 'function f() { try { x(); } catch { } }\n' });
  const bp = join(root, 'baseline.json');
  run(root, ['--seed']);
  const doc = JSON.parse(readFileSync(bp, 'utf8'));
  doc.critical = ['crit.mjs'];
  writeFileSync(bp, JSON.stringify(doc));
  assert.equal(run(root, []).code, EXIT.PASS, 'default is grandfathered, so the gate is green on the day it lands');
  assert.equal(run(root, ['--strict-critical']).code, EXIT.FINDINGS);
  assert.equal(run(root, [], { env: { CW_BARE_CATCH_STRICT_CRITICAL: '1' } }).code, EXIT.FINDINGS);
});

test('strictCritical reads the args it is handed, not process.argv', () => {
  assert.equal(strictCritical([]), false);
  assert.equal(strictCritical(['--strict-critical']), true);
});

// ── determinism ─────────────────────────────────────────────────────────────────────────────────
test('same tree, byte-identical output and digest', () => {
  const root = tree({ 'b.mjs': 'function g() { try { y(); } catch { } }\n', 'a.mjs': 'function f() { try { x(); } catch { } }\n' });
  run(root, ['--seed']);
  const one = run(root, ['--json', '--status']);
  const two = run(root, ['--json', '--status']);
  assert.equal(one.out, two.out);
  assert.equal(one.code, two.code);
  assert.equal(digestOf(measureTree({ root }).counts), JSON.parse(one.out).digest);
});

test('the seeded baseline is byte-identical across re-seeds of the same tree under a fixed CW_NOW', () => {
  const root = tree({ 'a.mjs': 'function f() { try { x(); } catch { } }\n' });
  run(root, ['--seed']);
  const first = readFileSync(join(root, 'baseline.json'), 'utf8');
  rmSync(join(root, 'baseline.json'));
  run(root, ['--seed']);
  assert.equal(readFileSync(join(root, 'baseline.json'), 'utf8'), first);
});

test('keys are emitted in sorted order regardless of walk order', () => {
  const root = tree({ 'z.mjs': 'function z() { try { x(); } catch { } }\n', 'a.mjs': 'function a() { try { x(); } catch { } }\n' });
  assert.deepEqual(Object.keys(measureTree({ root }).counts), ['a.mjs::a', 'z.mjs::z']);
});

// ── the real tree ───────────────────────────────────────────────────────────────────────────────
test('the repository itself lexes cleanly — every shipped file balances after stripping', () => {
  // not a COUNT assertion (a pinned count goes stale) — the lexer's self-check must pass on every real file
  const saved = process.env.CW_BARE_CATCH_ROOT;
  delete process.env.CW_BARE_CATCH_ROOT;
  try {
    const { counts, sites, files } = measureTree();
    assert.ok(files.length > 100, `expected the real tree, got ${files.length} files`);
    assert.ok(sites.length > 0);
    assert.equal(totalOf(counts), sites.length);
    for (const s of sites) assert.ok(s.line > 0);
  } finally {
    if (saved !== undefined) process.env.CW_BARE_CATCH_ROOT = saved;
  }
});
