// The PRODUCER of toolchain.json. monitor/test/code-vintage.test.mjs covers the consumer with
// hand-built records, which is why this went unseen for as long as it existed: the records the
// consumer was handed in its tests were correct, and the ones the producer actually wrote were not.
//
// Measured 2026-10-11 on the real checkout: the receipt named "dmin/SPEC-scan-path.md" for a dirty
// admin/SPEC-scan-path.md, because the whole status stream was trimmed before being split and
// sliced at 3. The path that loses its first character is whichever sorts first with a
// worktree-only status (" M"), so the receipt was wrong on nearly every dirty run — and because
// the mangled name does not exist on disk, its blob hashed as 'deleted' and the first dirty path's
// CONTENT never reached sourceDirtyHash. Two runners with different code produced one receipt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toolchainVintage, porcelainPaths } from '../commitwork.mjs';

const g = (dir, args, input) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', input }).trim();

/** A repo with admin/a.md and bin/b.mjs committed, then both dirtied in the worktree only. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-vintage-'));
  mkdirSync(join(dir, 'admin'), { recursive: true });
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'admin', 'a.md'), 'committed admin\n');
  writeFileSync(join(dir, 'bin', 'b.mjs'), 'export const b = 0;\n');
  g(dir, ['init', '-q']);
  g(dir, ['add', '-A']);
  const c = g(dir, ['commit-tree', g(dir, ['write-tree'])], 'fixture\n');
  g(dir, ['update-ref', 'refs/heads/main', c]);
  g(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  writeFileSync(join(dir, 'admin', 'a.md'), 'dirty ONE\n');
  writeFileSync(join(dir, 'bin', 'b.mjs'), 'export const b = 1;\n');
  return dir;
}

test('every path in the receipt is the real path, and exists on disk', () => {
  const dir = fixture();
  const v = toolchainVintage(dir);
  assert.deepEqual(v.sourceDirty, ['admin/a.md', 'bin/b.mjs']);
  for (const p of v.sourceDirty) {
    assert.ok(existsSync(join(dir, p)), `${p} is in the receipt but not on disk — a mangled path hashes as 'deleted'`);
  }
});

test('changing the FIRST dirty path\'s content changes sourceDirtyHash', () => {
  const dir = fixture();
  const before = toolchainVintage(dir).sourceDirtyHash;
  writeFileSync(join(dir, 'admin', 'a.md'), 'dirty TWO — different content\n');
  const after = toolchainVintage(dir).sourceDirtyHash;
  assert.ok(before, 'a dirty tree must produce a hash');
  assert.notEqual(after, before, 'the first dirty path is the one a leading trim drops; its content must reach the hash');
});

test('changing a LATER dirty path\'s content also changes it', () => {
  const dir = fixture();
  const before = toolchainVintage(dir).sourceDirtyHash;
  writeFileSync(join(dir, 'bin', 'b.mjs'), 'export const b = 2;\n');
  assert.notEqual(toolchainVintage(dir).sourceDirtyHash, before);
});

// The other direction: without this, a hash that changed on every call would pass the two above.
test('touching nothing leaves the hash identical', () => {
  const dir = fixture();
  assert.equal(toolchainVintage(dir).sourceDirtyHash, toolchainVintage(dir).sourceDirtyHash);
});

test('a clean tree reports no hash rather than a hash of nothing', () => {
  const dir = fixture();
  g(dir, ['checkout', '--', '.']);
  const v = toolchainVintage(dir);
  assert.deepEqual(v.sourceDirty, []);
  assert.equal(v.sourceDirtyHash, null);
});

// A second witness on the parse, independent of git: the field shapes below were measured from
// `git status --porcelain -z` on git 2.50.1, not inferred from the documentation.
test('porcelainPaths reads the measured field shapes', () => {
  assert.deepEqual(porcelainPaths(' M admin/a.md\0'), ['admin/a.md'], 'a worktree-only change keeps its leading space');
  assert.deepEqual(porcelainPaths('M  admin/a.md\0'), ['admin/a.md'], 'a staged change');
  assert.deepEqual(porcelainPaths('?? admin/new.md\0'), ['admin/new.md'], 'untracked');
  assert.deepEqual(porcelainPaths(' M admin/a b.md\0'), ['admin/a b.md'], 'a space in the path is not a separator');
  assert.deepEqual(
    porcelainPaths('R  admin/new.md\0admin/old.md\0 D bin/b.mjs\0'),
    ['admin/new.md', 'bin/b.mjs'],
    'a rename records the new path and consumes the origin field, never reporting it as an entry',
  );
  assert.deepEqual(porcelainPaths(''), [], 'a clean tree is no entries');
  assert.deepEqual(porcelainPaths(undefined), [], 'absent output is not a crash');
});

test('a rename in a real repo records the new path only', () => {
  const dir = fixture();
  g(dir, ['checkout', '--', '.']);
  g(dir, ['mv', 'admin/a.md', 'admin/renamed.md']);
  const v = toolchainVintage(dir);
  assert.deepEqual(v.sourceDirty, ['admin/renamed.md']);
  assert.ok(existsSync(join(dir, 'admin', 'renamed.md')));
});
