// lib/unified-diff.mjs — the one owner for unified diffs: build, parse, apply. The round-trip
// property is the heart: for every pair, `git apply --check` must accept what we built, `git
// apply` must reproduce the after text byte for byte, and so must our own in-memory apply — three
// witnesses that cannot share a failure mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unifiedDiff, parseUnifiedDiff, applyUnifiedDiff } from '../unified-diff.mjs';

const file = (n) => `${Array.from({ length: n }, (_, i) => `l${i}`).join('\n')}\n`;

// ≥12 pairs: a replacement, an insertion, a deletion, empty sides, every missing-final-newline
// combination, a change of the trailing newline alone in both directions, distant changes, CRLF,
// a swap, an append to a file that lacks its final newline, and body lines that read as file headers.
const PAIRS = [
  ['replacement', 'a\nb\nc\n', 'a\nX\nc\n'],
  ['insertion', 'a\nb\n', 'a\nx\ny\nb\n'],
  ['deletion', 'a\nx\ny\nb\n', 'a\nb\n'],
  ['empty before', '', 'new\n'],
  ['empty after', 'old\n', ''],
  ['empty before, after lacks final newline', '', 'x'],
  ['before lacks final newline', 'a\nb\nc', 'a\nb\nC\n'],
  ['after lacks final newline', 'a\nb\nc\n', 'a\nb\nC'],
  ['both sides lack final newline', 'a\nb\nc', 'a\nb\nC'],
  ['trailing newline removed alone', 'a\nb\n', 'a\nb'],
  ['trailing newline added alone', 'a\nb', 'a\nb\n'],
  ['two distant changes', file(30), file(30).replace('l2\n', 'L2\n').replace('l25\n', 'L25\n')],
  ['adjacent changes merge into one hunk', 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n', 'a\nb\nX\nd\ne\nf\nY\nh\ni\nj\nk\n'],
  ['CRLF file', 'a\r\nb\r\nc\r\n', 'a\r\nB\r\nc\r\n'],
  ['swap puts deletions before insertions', 'x\ny\n', 'y\nx\n'],
  ['append to a file without final newline', 'x\ny', 'x\ny\nz\n'],
  ['a "-- " line replaced by a "++ " line reads as ---/+++ inside the hunk', 'a\n-- x\nb\n', 'a\n++ y\nb\n'],
];

/** Apply `patch` in a scratch repo holding `originals`; return each named path's text or null. */
function gitWitnessTree(originals, patch, paths) {
  const repo = mkdtempSync(join(tmpdir(), 'cw-ud-'));
  try {
    for (const [path, text] of Object.entries(originals)) writeFileSync(join(repo, path), text);
    spawnSync('git', ['init', '-q'], { cwd: repo });
    writeFileSync(join(repo, 'cw.patch'), patch);
    const check = spawnSync('git', ['-c', 'core.autocrlf=false', 'apply', '--check', 'cw.patch'], { cwd: repo, encoding: 'utf8' });
    if (check.status !== 0) throw new Error(`git apply --check rejected the diff:\n${check.stderr}${patch}`);
    const apply = spawnSync('git', ['-c', 'core.autocrlf=false', 'apply', 'cw.patch'], { cwd: repo, encoding: 'utf8' });
    if (apply.status !== 0) throw new Error(`git apply failed:\n${apply.stderr}${patch}`);
    const got = {};
    for (const path of paths) got[path] = existsSync(join(repo, path)) ? readFileSync(join(repo, path), 'utf8') : null;
    return got;
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

/** `git apply --check` and `git apply` inside a scratch repo holding the BEFORE text. */
function gitWitness(before, after, diff) {
  const repo = mkdtempSync(join(tmpdir(), 'cw-ud-'));
  try {
    writeFileSync(join(repo, 'f.txt'), before);
    spawnSync('git', ['init', '-q'], { cwd: repo });
    writeFileSync(join(repo, 'cw.patch'), diff);
    const check = spawnSync('git', ['-c', 'core.autocrlf=false', 'apply', '--check', 'cw.patch'], { cwd: repo, encoding: 'utf8' });
    if (check.status !== 0) return `git apply --check rejected the diff:\n${check.stderr}${diff}`;
    const apply = spawnSync('git', ['-c', 'core.autocrlf=false', 'apply', 'cw.patch'], { cwd: repo, encoding: 'utf8' });
    if (apply.status !== 0) return `git apply failed:\n${apply.stderr}${diff}`;
    const got = readFileSync(join(repo, 'f.txt'), 'utf8');
    return got === after ? null : `git apply produced ${JSON.stringify(got)}, wanted ${JSON.stringify(after)}\n${diff}`;
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test('round trip: git accepts every diff, and both git apply and applyUnifiedDiff reproduce the after text', () => {
  for (const [name, before, after] of PAIRS) {
    const diff = unifiedDiff('f.txt', before, after);
    assert.notEqual(diff, '', `${name}: a change must produce a diff`);
    assert.equal(unifiedDiff('f.txt', before, after), diff, `${name}: not deterministic`);
    const git = gitWitness(before, after, diff);
    assert.equal(git, null, `${name}: ${git}`);
    const parsed = parseUnifiedDiff(diff);
    assert.equal(parsed.length, 1, `${name}: one file expected`);
    assert.equal(applyUnifiedDiff(before, parsed[0]), after, `${name}: in-memory apply`);
  }
});

test('identical texts produce an empty diff, byte for byte', () => {
  assert.equal(unifiedDiff('f.txt', 'same\n', 'same\n'), '');
  assert.equal(unifiedDiff('f.txt', '', ''), '');
});

test('exact output: a creation is a new file mode header and one @@ -0,0 +1,n @@ hunk', () => {
  assert.equal(unifiedDiff('f.txt', null, 'a\nb\n'),
    'diff --git a/f.txt b/f.txt\nnew file mode 100644\n--- /dev/null\n+++ b/f.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n');
  assert.equal(unifiedDiff('f.txt', null, 'a\nb'),
    'diff --git a/f.txt b/f.txt\nnew file mode 100644\n--- /dev/null\n+++ b/f.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n\\ No newline at end of file\n');
  assert.equal(unifiedDiff('f.txt', null, ''),
    'diff --git a/f.txt b/f.txt\nnew file mode 100644\n--- /dev/null\n+++ b/f.txt\n');
});

test('exact output: a deletion is a deleted file mode header and one @@ -1,n +0,0 @@ hunk', () => {
  assert.equal(unifiedDiff('f.txt', 'a\nb\n', null),
    'diff --git a/f.txt b/f.txt\ndeleted file mode 100644\n--- a/f.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n');
  assert.equal(unifiedDiff('f.txt', 'a\nb', null),
    'diff --git a/f.txt b/f.txt\ndeleted file mode 100644\n--- a/f.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n\\ No newline at end of file\n');
  assert.equal(unifiedDiff('f.txt', '', null),
    'diff --git a/f.txt b/f.txt\ndeleted file mode 100644\n--- a/f.txt\n+++ /dev/null\n');
});

test('round trip: a creation and a deletion reproduce their one non-null side', () => {
  const CASES = [
    ['creation with final newline', null, 'a\nb\n'],
    ['creation without final newline', null, 'a\nb'],
    ['empty creation', null, ''],
    ['deletion with final newline', 'a\nb\n', null],
    ['deletion without final newline', 'a\nb', null],
    ['empty deletion', '', null],
  ];
  for (const [name, before, after] of CASES) {
    const diff = unifiedDiff('f.txt', before, after);
    const parsed = parseUnifiedDiff(diff);
    assert.equal(parsed.length, 1, `${name}: one file expected`);
    assert.equal(applyUnifiedDiff(before, parsed[0]), after, `${name}: in-memory apply`);
  }
});

test('parse: the mode lines set created and deleted, false on an in-place change', () => {
  const created = parseUnifiedDiff(unifiedDiff('f.txt', null, 'x\n'))[0];
  assert.deepEqual([created.created, created.deleted], [true, false]);
  const deleted = parseUnifiedDiff(unifiedDiff('f.txt', 'x\n', null))[0];
  assert.deepEqual([deleted.created, deleted.deleted], [false, true]);
  const inPlace = parseUnifiedDiff(unifiedDiff('f.txt', 'x\n', 'y\n'))[0];
  assert.deepEqual([inPlace.created, inPlace.deleted], [false, false]);
});

test('git witness: one patch holding a creation, a deletion and an in-place change', () => {
  const originals = { 'keep.txt': 'a\nb\n', 'old.txt': 'gone\n' };
  const patch = unifiedDiff('new.txt', null, 'born\n')
    + unifiedDiff('old.txt', 'gone\n', null)
    + unifiedDiff('keep.txt', 'a\nb\n', 'a\nB\n');
  assert.deepEqual(gitWitnessTree(originals, patch, ['new.txt', 'old.txt', 'keep.txt']), {
    'new.txt': 'born\n',
    'old.txt': null,
    'keep.txt': 'a\nB\n',
  });
});

test('creation and deletion throw: both sides null, a creation over text, an in-place change over null', () => {
  assert.throws(() => unifiedDiff('f.txt', null, null), TypeError);
  const creation = parseUnifiedDiff(unifiedDiff('f.txt', null, 'x\n'))[0];
  assert.throws(() => applyUnifiedDiff('', creation), /a file creation must be applied to null/);
  const inPlace = parseUnifiedDiff(unifiedDiff('f.txt', 'a\n', 'b\n'))[0];
  assert.throws(() => applyUnifiedDiff(null, inPlace), /an in-place change cannot be applied to null/);
});

test('apply throws: the text does not match a deletion', () => {
  const deletion = parseUnifiedDiff(unifiedDiff('f.txt', 'a\nb\n', null))[0];
  assert.throws(() => applyUnifiedDiff('a\nX\n', deletion), /deleted line does not match the text at line 2/);
  assert.throws(() => applyUnifiedDiff('a\nb\nc\n', deletion), /the text does not match the deleted lines exactly/);
  assert.throws(() => applyUnifiedDiff(null, deletion), /a file deletion must be applied to text/);
});

test('exact output: header is diff --git, --- a/ and +++ b/, ranges always start,len', () => {
  assert.equal(unifiedDiff('f.txt', 'a\nb\n', 'a\nc\n'),
    'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n');
});

test('exact output: an empty side is 0,0', () => {
  assert.equal(unifiedDiff('f.txt', '', 'new\n'),
    'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -0,0 +1,1 @@\n+new\n');
  assert.equal(unifiedDiff('f.txt', 'old\n', ''),
    'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +0,0 @@\n-old\n');
});

test('exact output: deletions come before insertions inside a changed run', () => {
  assert.equal(unifiedDiff('f.txt', 'x\ny\n', 'y\nx\n'),
    'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n-x\n y\n+x\n');
  assert.equal(unifiedDiff('f.txt', 'one\ntwo\n', 'three\nfour\n'),
    'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n-one\n-two\n+three\n+four\n');
});

test('exact output: a change of the trailing newline alone is a change of the last line', () => {
  assert.equal(unifiedDiff('f.txt', 'line\n', 'line'),
    'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-line\n+line\n\\ No newline at end of file\n');
  assert.equal(unifiedDiff('f.txt', 'line', 'line\n'),
    'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-line\n\\ No newline at end of file\n+line\n');
});

test('exact output: the no-newline marker follows the last line of a side, context line included', () => {
  assert.equal(unifiedDiff('f.txt', 'a\nb\nc\nd\ne\nf\ng', 'a\nb\nc\nd\nX\nf\ng'),
    'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -2,6 +2,6 @@\n b\n c\n d\n-e\n+X\n f\n g\n\\ No newline at end of file\n');
  assert.equal(unifiedDiff('f.txt', 'a\nb\nc\nd\ne\nf\ng', 'a\nb\nc\nd\ne\nf\nY'),
    'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -4,4 +4,4 @@\n d\n e\n f\n-g\n\\ No newline at end of file\n+Y\n\\ No newline at end of file\n');
});

test('exact output: two changes merge when the gap is exactly 2*context, split one line further', () => {
  const near = file(5).replace('l0\n', 'L0\n').replace('l3\n', 'L3\n');
  assert.equal(unifiedDiff('f.txt', file(5), near, { context: 1 }),
    'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,5 +1,5 @@\n-l0\n+L0\n l1\n l2\n-l3\n+L3\n l4\n');
  const far = file(6).replace('l0\n', 'L0\n').replace('l4\n', 'L4\n');
  assert.equal(unifiedDiff('f.txt', file(6), far, { context: 1 }),
    'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n-l0\n+L0\n l1\n@@ -4,3 +4,3 @@\n l3\n-l4\n+L4\n l5\n');
});

test('parse: several files in one text, without diff --git lines; paths drop the a/ b/ prefixes', () => {
  const text = '--- a/x.mjs\n+++ b/x.mjs\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n--- a/y.mjs\n+++ b/y.mjs\n@@ -1,1 +1,1 @@\n-q\n+r\n';
  assert.deepEqual(parseUnifiedDiff(text), [
    { oldPath: 'x.mjs', newPath: 'x.mjs', hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' a', '-b', '+c'], oldNoNewline: false, newNoNewline: false }], created: false, deleted: false },
    { oldPath: 'y.mjs', newPath: 'y.mjs', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-q', '+r'], oldNoNewline: false, newNoNewline: false }], created: false, deleted: false },
  ]);
});

test('parse: a git header with /dev/null, extended junk lines and a range without ,len meaning 1', () => {
  const text = 'diff --git a/e b/e\nnew file mode 100644\nindex 0000000..9d8e7c6\n--- /dev/null\n+++ b/e\n@@ -0,0 +1 @@\n+x\n';
  assert.deepEqual(parseUnifiedDiff(text), [
    { oldPath: null, newPath: 'e', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+x'], oldNoNewline: false, newNoNewline: false }], created: true, deleted: false },
  ]);
});

test('parse: no-newline markers land on the side they belong to', () => {
  const changed = parseUnifiedDiff('--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n')[0].hunks[0];
  assert.equal(changed.oldNoNewline, true);
  assert.equal(changed.newNoNewline, true);
  const context = parseUnifiedDiff('--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n b\n\\ No newline at end of file\n')[0].hunks[0];
  assert.equal(context.oldNoNewline, true);
  assert.equal(context.newNoNewline, true);
  const oldOnly = parseUnifiedDiff('--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b\n')[0].hunks[0];
  assert.equal(oldOnly.oldNoNewline, true);
  assert.equal(oldOnly.newNoNewline, false);
});

test('parse throws: a hunk body shorter than its header', () => {
  assert.throws(() => parseUnifiedDiff('--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n+c\n'),
    /unified diff: hunk body ends early — 1 old and 1 new line\(s\) still owed/);
});

test('parse throws: more hunk lines than the header declares', () => {
  assert.throws(() => parseUnifiedDiff('--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n d\n'),
    /more hunk lines than the header declares/);
});

test('parse throws: a hunk line before any file header', () => {
  assert.throws(() => parseUnifiedDiff(' a\n-b\n'), /hunk line before any file header/);
});

test('parse throws: a hunk header before any file header', () => {
  assert.throws(() => parseUnifiedDiff('@@ -1,1 +1,1 @@\n-a\n'), /hunk header before any file header/);
});

test('parse throws: a no-newline marker outside any hunk', () => {
  assert.throws(() => parseUnifiedDiff('--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n\\ No newline at end of file\n-a\n'),
    /no-newline marker before any hunk line/);
});

test('parse then apply: a two-hunk diff reproduces the after text through both appliers', () => {
  const before = file(30);
  const after = before.replace('l2\n', 'L2\n').replace('l25\n', 'L25\n');
  const diff = unifiedDiff('f.txt', before, after);
  const parsed = parseUnifiedDiff(diff)[0];
  assert.equal(parsed.hunks.length, 2);
  assert.equal(applyUnifiedDiff(before, parsed), after);
  assert.equal(applyUnifiedDiff(before, { ...parsed, hunks: [parsed.hunks[0]] }), before.replace('l2\n', 'L2\n'));
});

test('apply throws: a context or deleted line that does not match the text at its position', () => {
  const parsed = parseUnifiedDiff(unifiedDiff('f.txt', 'a\nb\nc\n', 'a\nB\nc\n'))[0];
  assert.throws(() => applyUnifiedDiff('a\nX\nc\n', parsed), /deleted line does not match the text at line 2/);
  assert.throws(() => applyUnifiedDiff('Q\nb\nc\n', parsed), /context line does not match the text at line 1/);
});

test('apply throws: the old side\'s no-newline marker disagrees with the text', () => {
  const parsed = parseUnifiedDiff(unifiedDiff('f.txt', 'a\nb', 'a\nB'))[0];
  assert.equal(applyUnifiedDiff('a\nb', parsed), 'a\nB');
  assert.throws(() => applyUnifiedDiff('a\nb\n', parsed), /no-newline marker does not match the text/);
});
