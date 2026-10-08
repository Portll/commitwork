// The shared Go module walk. Fixtures are real directory trees in a temp dir, because the walk's
// whole job is what readdir shows it; nothing here stubs the filesystem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { findGoModules, walkGoModules, SKIP } from '../lib/go-modules.mjs';

const made = [];
function tree(dirs, mod = true) {
  const root = mkdtempSync(join(tmpdir(), 'cw-gomod-test-'));
  made.push(root);
  for (const d of dirs) {
    mkdirSync(join(root, d), { recursive: true });
    if (mod) writeFileSync(join(root, d, 'go.mod'), 'module x\n');
  }
  return root;
}
test.after(() => { for (const r of made) rmSync(r, { recursive: true, force: true }); });
const rel = (root, mods) => mods.map((m) => relative(root, m) || '.');

test('a go.mod at the root is found as "."', () => {
  const root = tree(['']);
  assert.deepEqual(rel(root, findGoModules(root)), ['.']);
});

test('a go.mod one level down is found', () => {
  const root = tree(['backend']);
  assert.deepEqual(rel(root, findGoModules(root)), ['backend']);
});

test('several modules at several depths are all found, root included', () => {
  const root = tree(['', 'core', 'agent', 'tools/cli']);
  assert.deepEqual(rel(root, findGoModules(root)), ['.', 'agent', 'core', 'tools/cli']);
});

test('vendor, testdata, node_modules, .git and dot-directories are not targets', () => {
  const root = tree(['real', 'vendor/dep', 'testdata/m', 'node_modules/n', '.git/hooks', 'real/vendor/x', '.hidden/m']);
  assert.deepEqual(rel(root, findGoModules(root)), ['real']);
  for (const n of ['vendor', 'testdata', 'node_modules', '.git']) assert.ok(SKIP.has(n), n);
});

// APFS and ext4-with-dir_index may return names in an order the creator cannot dictate, so this
// cannot force a hash-ordered readdir; it does mix case and prefix-sharing names created in reverse
// of sorted order, which an unsorted walk on a creation-ordered filesystem gets wrong.
test('order is by path (code units), whatever order the directories were created in', () => {
  const names = ['zeta', 'alpha', 'mid', 'Beta', 'alpha2', 'alpha-b'];
  const expected = ['Beta', 'alpha', 'alpha-b', 'alpha2', 'mid', 'zeta'];
  const a = tree(names);
  const b = tree([...names].reverse());
  assert.deepEqual(rel(a, findGoModules(a)), expected);
  assert.deepEqual(rel(b, findGoModules(b)), expected);
});

test('a module at the depth bound is found; one below it is not, and the cut is reported', () => {
  const root = tree(['a/b', 'a/b/c/d']);
  const shallow = walkGoModules(root, 2);
  assert.deepEqual(rel(root, shallow.modules), ['a/b']);
  assert.deepEqual(rel(root, shallow.unexplored), ['a/b'], 'the directory the walk stopped in is named');
  const deep = walkGoModules(root, 4);
  assert.deepEqual(rel(root, deep.modules), ['a/b', 'a/b/c/d']);
  assert.deepEqual(deep.unexplored, []);
});

test('a bound that cut nothing off reports nothing, even at exactly the bound', () => {
  const root = tree(['a/b']);
  assert.deepEqual(walkGoModules(root, 2).unexplored, [], 'a leaf at the bound has nothing below it to miss');
  assert.deepEqual(walkGoModules(root, 1).unexplored.map((d) => relative(root, d)), ['a']);
});

test('skipped directories at the bound are not reported as unexplored', () => {
  const root = tree(['a']);
  mkdirSync(join(root, 'a', 'vendor'));
  assert.deepEqual(walkGoModules(root, 1).unexplored, []);
});

test('findGoModules returns a plain array of absolute directories', () => {
  const root = tree(['x']);
  const m = findGoModules(root);
  assert.ok(Array.isArray(m));
  assert.deepEqual(m, [join(root, 'x')]);
});

test('a missing root is no modules and no truncation, not a throw', () => {
  assert.deepEqual(walkGoModules(join(tmpdir(), 'cw-gomod-does-not-exist-xyz')), { modules: [], unexplored: [] });
});

test('a tree with no go.mod anywhere yields no modules', () => {
  const root = tree(['src/pkg'], false);
  assert.deepEqual(walkGoModules(root), { modules: [], unexplored: [] });
});
