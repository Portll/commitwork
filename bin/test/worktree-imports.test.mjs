// The working-tree half of the split import guard.
//
// classify() is pure given its readers, so every case here is a constructed world rather than a
// reading of the live tree — a test that asserted over the real checkout would pass or fail on
// whatever nine sessions happened to be mid-edit, which is the property the split exists to remove.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../worktree-imports.mjs';

/** A world: which files exist on disk, and what each contains. */
const world = (files) => ({
  read: (f) => { if (!(f in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files[f]; },
  exists: (f) => f in files,
});

const sets = (index = [], head = null) => ({ index: new Set(index), head: new Set(head ?? index) });

describe('broken-now — the tree does not load', () => {
  test('an import whose target is absent from disk is reported', () => {
    const w = world({ 'a/one.mjs': "import './two.mjs';" });
    const r = classify(['a/one.mjs'], sets(['a/one.mjs']), w);
    assert.equal(r.brokenNow.length, 1);
    assert.equal(r.brokenNow[0].spec, './two.mjs');
  });

  test('it is reported even for an UNTRACKED importer — your own new file can be broken', () => {
    const w = world({ 'a/new.mjs': "import './missing.mjs';" });
    const r = classify(['a/new.mjs'], sets([]), w);
    assert.equal(r.brokenNow.length, 1);
  });

  test('a target that exists is not reported', () => {
    const w = world({ 'a/one.mjs': "import './two.mjs';", 'a/two.mjs': '' });
    assert.deepEqual(classify(['a/one.mjs'], sets(['a/one.mjs', 'a/two.mjs']), w).brokenNow, []);
  });
});

describe('would-break-HEAD — committing this alone breaks the clone', () => {
  test('a tracked file importing a file in neither HEAD nor the index', () => {
    const w = world({ 'a/one.mjs': "import './two.mjs';", 'a/two.mjs': '' });
    const r = classify(['a/one.mjs'], sets(['a/one.mjs']), w);
    assert.equal(r.wouldBreakHead.length, 1);
    assert.equal(r.wouldBreakHead[0].target, 'a/two.mjs');
  });

  test('an UNTRACKED importer is NOT reported — both land together or neither does', () => {
    // Noise the author cannot act on: committing the pair is the only thing they were going to do.
    const w = world({ 'a/new.mjs': "import './alsonew.mjs';", 'a/alsonew.mjs': '' });
    assert.deepEqual(classify(['a/new.mjs'], sets([]), w).wouldBreakHead, []);
  });

  test('a target already in the index is fine — a commit carries it', () => {
    const w = world({ 'a/one.mjs': "import './two.mjs';", 'a/two.mjs': '' });
    assert.deepEqual(classify(['a/one.mjs'], sets(['a/one.mjs', 'a/two.mjs']), w).wouldBreakHead, []);
  });
});

describe('staged-deletion — the opposite remedy, so it cannot share a label', () => {
  test('THE MEASURED CASE: target in HEAD, removed from the index, importer still names it', () => {
    // git ls-files reports the INDEX and not the commit. The first version of this tool used only
    // ls-files, called this file untracked, and told the author to add a file that was already
    // there. The hazard was real; the diagnosis was wrong.
    const w = world({ 'admin/routes/verdicts.mjs': "import { x } from '../lib/triage.mjs';", 'admin/lib/triage.mjs': '' });
    const r = classify(['admin/routes/verdicts.mjs'],
      { index: new Set(['admin/routes/verdicts.mjs']), head: new Set(['admin/routes/verdicts.mjs', 'admin/lib/triage.mjs']) }, w);
    assert.equal(r.stagedDeletion.length, 1, 'a HEAD-tracked target missing from the index is a staged deletion');
    assert.deepEqual(r.wouldBreakHead, [], 'and must NOT be reported as untracked — the remedy is the opposite');
    assert.equal(r.stagedDeletion[0].target, 'admin/lib/triage.mjs');
  });

  test('the two states are never both reported for one import', () => {
    const w = world({ 'a/one.mjs': "import './two.mjs';", 'a/two.mjs': '' });
    const staged = classify(['a/one.mjs'], { index: new Set(['a/one.mjs']), head: new Set(['a/one.mjs', 'a/two.mjs']) }, w);
    const untracked = classify(['a/one.mjs'], { index: new Set(['a/one.mjs']), head: new Set(['a/one.mjs']) }, w);
    assert.equal(staged.stagedDeletion.length + staged.wouldBreakHead.length, 1);
    assert.equal(untracked.stagedDeletion.length + untracked.wouldBreakHead.length, 1);
    assert.equal(staged.wouldBreakHead.length, 0);
    assert.equal(untracked.stagedDeletion.length, 0);
  });

  test('an importer tracked only at HEAD still counts — it is in the repo', () => {
    const w = world({ 'a/one.mjs': "import './two.mjs';", 'a/two.mjs': '' });
    const r = classify(['a/one.mjs'], { index: new Set(), head: new Set(['a/one.mjs']) }, w);
    assert.equal(r.wouldBreakHead.length + r.stagedDeletion.length, 1);
  });
});

describe('unreadable is its own state', () => {
  test('a file that cannot be read is named, not silently skipped and not called clean', () => {
    const w = { read: () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; }, exists: () => true };
    const r = classify(['a/one.mjs'], sets(['a/one.mjs']), w);
    assert.equal(r.unreadable.length, 1);
    assert.equal(r.unreadable[0].reason, 'EACCES');
    assert.deepEqual(r.brokenNow, [], 'an unreadable file must not be reported as broken — that is a different claim');
  });
});

describe('extension and index resolution follow node', () => {
  test('an extensionless specifier resolves to the .mjs candidate', () => {
    const w = world({ 'a/one.mjs': "import './two';", 'a/two.mjs': '' });
    const r = classify(['a/one.mjs'], sets(['a/one.mjs', 'a/two.mjs']), w);
    assert.deepEqual(r.brokenNow, []);
  });
  test('trackedness is judged on the candidate that RESOLVED, not the first guess', () => {
    // Judging a candidate that does not exist would report a phantom.
    const w = world({ 'a/one.mjs': "import './two';", 'a/two/index.mjs': '' });
    const r = classify(['a/one.mjs'], { index: new Set(['a/one.mjs']), head: new Set(['a/one.mjs']) }, w);
    assert.equal(r.wouldBreakHead.length, 1);
    assert.equal(r.wouldBreakHead[0].target, 'a/two/index.mjs');
  });
});

describe('--staged reads the INDEX, because that is what a commit contains', () => {
  // The same index/worktree surface mix that made the old cross-check unreliable, reproduced in this
  // tool within the hour and caught the same way. --staged listed staged PATHS and read their
  // CONTENT from disk, so a change set that is internally consistent was reported as breaking.
  test('a staged file whose INDEX copy dropped the import is clean, though the disk copy has not', () => {
    const readers = {
      // index content: the import is gone
      read: () => "import { ok } from './kept.mjs';",
      exists: (f) => new Set(['a/one.mjs', 'a/kept.mjs']).has(f),
    };
    const r = classify(['a/one.mjs'], { index: new Set(['a/one.mjs', 'a/kept.mjs']), head: new Set(['a/one.mjs', 'a/kept.mjs', 'a/gone.mjs']) }, readers);
    assert.deepEqual(r.stagedDeletion, [], 'the staged content no longer names the deleted module');
    assert.deepEqual(r.brokenNow, []);
  });

  test('and the WORKTREE copy of the same file still reports — the two surfaces disagree honestly', () => {
    const readers = {
      read: () => "import { x } from './gone.mjs';",           // disk content: import still there
      exists: (f) => new Set(['a/one.mjs', 'a/gone.mjs']).has(f),
    };
    const r = classify(['a/one.mjs'], { index: new Set(['a/one.mjs']), head: new Set(['a/one.mjs', 'a/gone.mjs']) }, readers);
    assert.equal(r.stagedDeletion.length, 1,
      'committing the worktree copy by pathspec WOULD break it, which is a different question from the staged set');
  });
});

describe('NOT VACUOUS', () => {
  test('a wholly clean world produces no findings of any kind', () => {
    const w = world({ 'a/one.mjs': "import './two.mjs';", 'a/two.mjs': '' });
    const r = classify(['a/one.mjs', 'a/two.mjs'], sets(['a/one.mjs', 'a/two.mjs']), w);
    assert.deepEqual([r.brokenNow, r.wouldBreakHead, r.stagedDeletion, r.unreadable], [[], [], [], []]);
  });
  test('bare specifiers are out of scope', () => {
    const w = world({ 'a/one.mjs': "import x from 'node:fs';\nimport y from 'some-pkg';" });
    const r = classify(['a/one.mjs'], sets(['a/one.mjs']), w);
    assert.deepEqual(r.brokenNow, []);
  });
});
