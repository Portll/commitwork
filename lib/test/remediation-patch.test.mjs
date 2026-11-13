// lib/test/remediation-patch.test.mjs — one patch.diff over every verified fix. Documents come from
// buildRemediation and diffs from unifiedDiff, never from hand-written text, except for the rename
// header unifiedDiff cannot write. Every non-empty patch is witnessed by real git, applied in a
// scratch repository against the same originals the module was given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { buildRemediation, validateRemediation } from '../remediation-contract.mjs';
import { unifiedDiff } from '../unified-diff.mjs';
import { combinedPatch } from '../remediation-patch.mjs';

const AT = '2026-11-09T10:00:00Z';
const PROVENANCE = { tool: 'commitwork', model: null, version: '0.6.174' };

const verified = (patch, over = {}) => ({
  tier: 'deterministic',
  provenance: PROVENANCE,
  patch,
  cached: true,
  verification: {
    status: 'verified',
    witness: { lanes: ['sastSemgrep'], before: 1, after: 0, digest: null },
    newFindings: [],
    tests: { command: null, status: 'notDeclared' },
    reason: null,
  },
  ...over,
});

const candidateWith = (status, patch) => verified(patch, {
  verification: {
    status,
    witness: status === 'unverified'
      ? { lanes: [], before: 0, after: null, digest: null }
      : { lanes: ['sastSemgrep'], before: 1, after: status === 'undetermined' ? null : 1, digest: null },
    newFindings: [],
    tests: { command: null, status: status === 'unverified' ? 'notDeclared' : 'notRun' },
    reason: status === 'unverified' ? null : 'the lane says so',
  },
});

const finding = ({ identity, occurrence = 0, file = null, candidates }) => ({
  identity, occurrence, ruleId: 'sastSemgrep/rule', lane: 'sastSemgrep', file, severity: 'high', candidates, actions: [],
});

const documentOf = (findings) => buildRemediation({
  repository: 'org/repo', commit: 'b'.repeat(40), generatedAt: AT, toolVersion: '0.6.174', findings,
});

// readText over a map of originals: anything else is ENOENT, the one error the contract reads as
// "absent" rather than "unreadable".
const readerOf = (files) => (path) => {
  if (!Object.hasOwn(files, path)) {
    const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
    err.code = 'ENOENT';
    throw err;
  }
  return files[path];
};

const idOf = (doc, identity) => doc.findings.find((f) => f.identity === identity).candidates[0].id;

/**
 * Apply `patch` to a scratch repo holding `originals` with real git; return each named path's text,
 * or null where the patch left no file.
 */
function gitApply(originals, patch, paths = Object.keys(originals)) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-rp-'));
  try {
    for (const [path, text] of Object.entries(originals)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, 'cw.patch'), patch);
    execFileSync('git', ['apply', '--check', 'cw.patch'], { cwd: dir });
    execFileSync('git', ['apply', 'cw.patch'], { cwd: dir });
    const texts = {};
    for (const path of paths) {
      texts[path] = existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : null;
    }
    return texts;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const file = (n) => `${Array.from({ length: n }, (_, i) => `l${i}`).join('\n')}\n`;

test('one verified candidate on one file: the patch is the candidate\'s own', () => {
  const before = 'a\nb\nc\n';
  const after = 'a\nB\nc\n';
  const patch = unifiedDiff('src/config.js', before, after);
  const doc = documentOf([finding({
    identity: 'sc|sastSemgrep|one|src/config.js', file: 'src/config.js', candidates: [verified(patch)],
  })]);
  const result = combinedPatch(doc, readerOf({ 'src/config.js': before }));
  assert.deepEqual(result, {
    patch,
    included: [{ identity: 'sc|sastSemgrep|one|src/config.js', occurrence: 0, candidateId: idOf(doc, 'sc|sastSemgrep|one|src/config.js'), files: ['src/config.js'] }],
    excluded: [],
  });
  assert.deepEqual(gitApply({ 'src/config.js': before }, result.patch), { 'src/config.js': after });
});

test('two candidates on different files: both included, patch paths in sorted order', () => {
  const originals = { 'a.txt': 'a1\na2\na3\n', 'b.txt': 'b1\nb2\nb3\n' };
  const afterA = 'a1\nA2\na3\n';
  const afterB = 'b1\nB2\nb3\n';
  const patchA = unifiedDiff('a.txt', originals['a.txt'], afterA);
  const patchB = unifiedDiff('b.txt', originals['b.txt'], afterB);
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|one|b.txt', file: 'b.txt', candidates: [verified(patchB)] }),
    finding({ identity: 'sc|sastSemgrep|two|a.txt', file: 'a.txt', candidates: [verified(patchA)] }),
  ]);
  const result = combinedPatch(doc, readerOf(originals));
  assert.equal(result.patch, patchA + patchB, 'a.txt sorts before b.txt whatever the walk order');
  assert.deepEqual(result.included.map((i) => [i.identity, i.files]), [
    ['sc|sastSemgrep|one|b.txt', ['b.txt']],
    ['sc|sastSemgrep|two|a.txt', ['a.txt']],
  ]);
  assert.deepEqual(result.excluded, []);
  assert.deepEqual(gitApply(originals, result.patch), { 'a.txt': afterA, 'b.txt': afterB });
});

test('two candidates on the same file far apart: one file diff carrying both changes', () => {
  const before = file(30);
  const afterOne = before.replace('l2\n', 'L2\n');
  const afterTwo = before.replace('l25\n', 'L25\n');
  const both = afterOne.replace('l25\n', 'L25\n');
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|first|f.txt', file: 'f.txt', candidates: [verified(unifiedDiff('f.txt', before, afterOne))] }),
    finding({ identity: 'sc|sastSemgrep|second|f.txt', file: 'f.txt', candidates: [verified(unifiedDiff('f.txt', before, afterTwo))] }),
  ]);
  const result = combinedPatch(doc, readerOf({ 'f.txt': before }));
  assert.equal(result.patch.split('diff --git').length - 1, 1, 'one file means one file diff');
  assert.equal(result.patch, unifiedDiff('f.txt', before, both));
  assert.deepEqual(result.excluded, []);
  assert.deepEqual(gitApply({ 'f.txt': before }, result.patch), { 'f.txt': both });
});

test('a second candidate whose context the first changed is excluded, and the first still lands', () => {
  const before = 'a\nb\nc\nd\ne\nf\ng\n';
  const afterOne = 'a\nb\nc\nD\ne\nf\ng\n';
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|first|f.txt', file: 'f.txt', candidates: [verified(unifiedDiff('f.txt', before, afterOne))] }),
    finding({ identity: 'sc|sastSemgrep|second|f.txt', file: 'f.txt', candidates: [verified(unifiedDiff('f.txt', before, 'a\nb\nc\nd\nE\nf\ng\n'))] }),
  ]);
  const result = combinedPatch(doc, readerOf({ 'f.txt': before }));
  assert.deepEqual(result.included, [{
    identity: 'sc|sastSemgrep|first|f.txt', occurrence: 0, candidateId: idOf(doc, 'sc|sastSemgrep|first|f.txt'), files: ['f.txt'],
  }]);
  assert.deepEqual(result.excluded, [{
    identity: 'sc|sastSemgrep|second|f.txt',
    occurrence: 0,
    candidateId: idOf(doc, 'sc|sastSemgrep|second|f.txt'),
    reason: 'does not apply after earlier fixes: unified diff: context line does not match the text at line 4',
  }]);
  assert.deepEqual(gitApply({ 'f.txt': before }, result.patch), { 'f.txt': afterOne });
});

test('a two-file candidate whose second file does not apply changes neither file', () => {
  const originals = { 'first.txt': 'one\ntwo\nthree\n', 'a.txt': 'a1\na2\na3\n', 'b.txt': 'b1\nb2\nb3\n' };
  const afterFirst = 'ONE\ntwo\nthree\n';
  const patch = unifiedDiff('a.txt', 'a1\na2\na3\n', 'A1\na2\na3\n') + unifiedDiff('b.txt', 'q1\nq2\nb3\n', 'q1\nq2\nB3\n');
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|first|first.txt', file: 'first.txt', candidates: [verified(unifiedDiff('first.txt', originals['first.txt'], afterFirst))] }),
    finding({ identity: 'sc|sastSemgrep|second|b.txt', file: 'b.txt', candidates: [verified(patch)] }),
  ]);
  const result = combinedPatch(doc, readerOf(originals));
  assert.deepEqual(result.excluded, [{
    identity: 'sc|sastSemgrep|second|b.txt',
    occurrence: 0,
    candidateId: idOf(doc, 'sc|sastSemgrep|second|b.txt'),
    reason: 'does not apply to the text as read: unified diff: context line does not match the text at line 1',
  }]);
  assert.deepEqual(gitApply(originals, result.patch), {
    'a.txt': 'a1\na2\na3\n',
    'b.txt': 'b1\nb2\nb3\n',
    'first.txt': afterFirst,
  });
});

test('failed, unverified and undetermined candidates contribute nothing, and neither does a finding without candidates', () => {
  const patch = unifiedDiff('f.txt', 'a\n', 'b\n');
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|failed|f.txt', file: 'f.txt', candidates: [candidateWith('failed', patch)] }),
    finding({ identity: 'sc|sastSemgrep|none|f.txt', file: 'f.txt', candidates: [] }),
    finding({ identity: 'sc|sastSemgrep|undetermined|f.txt', file: 'f.txt', candidates: [candidateWith('undetermined', patch)] }),
    finding({ identity: 'sc|sastSemgrep|unverified|f.txt', file: 'f.txt', candidates: [candidateWith('unverified', patch)] }),
  ]);
  assert.deepEqual(combinedPatch(doc, readerOf({ 'f.txt': 'a\n' })), { patch: '', included: [], excluded: [] });
});

const CREATE = unifiedDiff('new.txt', null, 'hello\n');
const DELETE = unifiedDiff('old.txt', 'hello\n', null);
const RENAME = 'diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n';

test('a candidate that creates a file is written as a creation diff', () => {
  const identity = 'sc|sastSemgrep|create|new.txt';
  const doc = documentOf([
    finding({ identity, file: 'new.txt', candidates: [verified(CREATE)] }),
  ]);
  const result = combinedPatch(doc, readerOf({}));
  assert.deepEqual(result, {
    patch: 'diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,1 @@\n+hello\n',
    included: [{ identity, occurrence: 0, candidateId: idOf(doc, identity), files: ['new.txt'] }],
    excluded: [],
  });
  assert.deepEqual(gitApply({}, result.patch, ['new.txt']), { 'new.txt': 'hello\n' });
});

test('a candidate that deletes a file is written as a deletion diff', () => {
  const identity = 'sc|sastSemgrep|delete|old.txt';
  const doc = documentOf([
    finding({ identity, file: 'old.txt', candidates: [verified(DELETE)] }),
  ]);
  const result = combinedPatch(doc, readerOf({ 'old.txt': 'hello\n' }));
  assert.deepEqual(result, {
    patch: 'diff --git a/old.txt b/old.txt\ndeleted file mode 100644\n--- a/old.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-hello\n',
    included: [{ identity, occurrence: 0, candidateId: idOf(doc, identity), files: ['old.txt'] }],
    excluded: [],
  });
  assert.deepEqual(gitApply({ 'old.txt': 'hello\n' }, result.patch), { 'old.txt': null });
});

test('a creation of an empty file is written: a new file mode header and no hunk', () => {
  const identity = 'sc|sastSemgrep|emptycreate|empty.txt';
  const doc = documentOf([
    finding({ identity, file: 'empty.txt', candidates: [verified(unifiedDiff('empty.txt', null, ''))] }),
  ]);
  const result = combinedPatch(doc, readerOf({}));
  assert.deepEqual(result, {
    patch: 'diff --git a/empty.txt b/empty.txt\nnew file mode 100644\n--- /dev/null\n+++ b/empty.txt\n',
    included: [{ identity, occurrence: 0, candidateId: idOf(doc, identity), files: ['empty.txt'] }],
    excluded: [],
  });
  assert.deepEqual(gitApply({}, result.patch, ['empty.txt']), { 'empty.txt': '' });
});

test('a creation beside an in-place change in one patch: both land, file diffs sorted by path', () => {
  const identity = 'sc|sastSemgrep|create-and-edit|src/new.txt';
  const patch = unifiedDiff('src/new.txt', null, 'born\n') + unifiedDiff('src/keep.txt', 'k\n', 'K\n');
  const doc = documentOf([finding({ identity, file: 'src/new.txt', candidates: [verified(patch)] })]);
  const result = combinedPatch(doc, readerOf({ 'src/keep.txt': 'k\n' }));
  assert.equal(result.patch, unifiedDiff('src/keep.txt', 'k\n', 'K\n') + unifiedDiff('src/new.txt', null, 'born\n'));
  assert.deepEqual(result.included, [{ identity, occurrence: 0, candidateId: idOf(doc, identity), files: ['src/keep.txt', 'src/new.txt'] }]);
  assert.deepEqual(result.excluded, []);
  assert.deepEqual(gitApply({ 'src/keep.txt': 'k\n' }, result.patch, ['src/keep.txt', 'src/new.txt']), { 'src/keep.txt': 'K\n', 'src/new.txt': 'born\n' });
});

test('a creation of a path that is already present is excluded, and the other fixes still land', () => {
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|a|new.txt', file: 'new.txt', candidates: [verified(CREATE)] }),
    finding({ identity: 'sc|sastSemgrep|b|f.txt', file: 'f.txt', candidates: [verified(unifiedDiff('f.txt', 'a\n', 'A\n'))] }),
  ]);
  const originals = { 'new.txt': 'someone wrote this first\n', 'f.txt': 'a\n' };
  const result = combinedPatch(doc, readerOf(originals));
  assert.equal(result.patch, unifiedDiff('f.txt', 'a\n', 'A\n'));
  assert.deepEqual(result.excluded, [{
    identity: 'sc|sastSemgrep|a|new.txt', occurrence: 0, candidateId: idOf(doc, 'sc|sastSemgrep|a|new.txt'),
    reason: 'the patch creates a file that is already present: new.txt',
  }]);
  assert.deepEqual(gitApply(originals, result.patch), { 'new.txt': 'someone wrote this first\n', 'f.txt': 'A\n' });
});

test('a creation of a path an earlier excluded fix already read as present is excluded', () => {
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|a|f.txt', file: 'f.txt', candidates: [verified(unifiedDiff('f.txt', 'x\n', 'X\n'))] }),
    finding({ identity: 'sc|sastSemgrep|b|f.txt', file: 'f.txt', candidates: [verified(unifiedDiff('f.txt', null, 'born\n'))] }),
  ]);
  const result = combinedPatch(doc, readerOf({ 'f.txt': 'a\n' }));
  assert.equal(result.patch, '');
  assert.deepEqual(result.excluded.map((e) => e.reason), [
    result.excluded[0].reason,
    'the patch creates a file that is already present: f.txt',
  ]);
  assert.match(result.excluded[0].reason, /^does not apply to the text as read: /);
});

test('readText failing with EACCES on a path the patch creates propagates', () => {
  const doc = documentOf([finding({ identity: 'sc|sastSemgrep|a|new.txt', file: 'new.txt', candidates: [verified(CREATE)] })]);
  const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  assert.throws(() => combinedPatch(doc, () => { throw denied; }), (err) => err === denied);
});

test('a deletion of an empty file is written: a deleted file mode header and no hunk', () => {
  const identity = 'sc|sastSemgrep|emptydelete|empty.txt';
  const doc = documentOf([
    finding({ identity, file: 'empty.txt', candidates: [verified(unifiedDiff('empty.txt', '', null))] }),
  ]);
  const result = combinedPatch(doc, readerOf({ 'empty.txt': '' }));
  assert.deepEqual(result, {
    patch: 'diff --git a/empty.txt b/empty.txt\ndeleted file mode 100644\n--- a/empty.txt\n+++ /dev/null\n',
    included: [{ identity, occurrence: 0, candidateId: idOf(doc, identity), files: ['empty.txt'] }],
    excluded: [],
  });
  assert.deepEqual(gitApply({ 'empty.txt': '' }, result.patch), { 'empty.txt': null });
});

test('a second creation of the same path is excluded, not merged with the first', () => {
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|a|new.txt', file: 'new.txt', candidates: [verified(unifiedDiff('new.txt', null, 'first\n'))] }),
    finding({ identity: 'sc|sastSemgrep|b|new.txt', file: 'new.txt', candidates: [verified(unifiedDiff('new.txt', null, 'second\n'))] }),
  ]);
  const result = combinedPatch(doc, readerOf({}));
  assert.equal(result.patch, unifiedDiff('new.txt', null, 'first\n'));
  assert.deepEqual(result.included, [{
    identity: 'sc|sastSemgrep|a|new.txt', occurrence: 0, candidateId: idOf(doc, 'sc|sastSemgrep|a|new.txt'), files: ['new.txt'],
  }]);
  assert.deepEqual(result.excluded, [{
    identity: 'sc|sastSemgrep|b|new.txt', occurrence: 0,
    candidateId: idOf(doc, 'sc|sastSemgrep|b|new.txt'),
    reason: 'the patch conflicts with an earlier fix that creates new.txt',
  }]);
});

test('a creation after an edit of the same path is excluded, naming the conflict', () => {
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|a|f.txt', file: 'f.txt', candidates: [verified(unifiedDiff('f.txt', 'a\n', 'A\n'))] }),
    finding({ identity: 'sc|sastSemgrep|b|f.txt', file: 'f.txt', candidates: [verified(unifiedDiff('f.txt', null, 'born\n'))] }),
  ]);
  const result = combinedPatch(doc, readerOf({ 'f.txt': 'a\n' }));
  assert.equal(result.patch, unifiedDiff('f.txt', 'a\n', 'A\n'));
  assert.deepEqual(result.excluded, [{
    identity: 'sc|sastSemgrep|b|f.txt', occurrence: 0,
    candidateId: idOf(doc, 'sc|sastSemgrep|b|f.txt'),
    reason: 'the patch conflicts with an earlier fix that changes f.txt',
  }]);
});

test('an edit after a creation of the same path is excluded, naming the conflict', () => {
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|a|f.txt', file: 'f.txt', candidates: [verified(unifiedDiff('f.txt', null, 'born\n'))] }),
    finding({ identity: 'sc|sastSemgrep|b|f.txt', file: 'f.txt', candidates: [verified(unifiedDiff('f.txt', 'born\n', 'BORN\n'))] }),
  ]);
  const result = combinedPatch(doc, readerOf({}));
  assert.equal(result.patch, unifiedDiff('f.txt', null, 'born\n'));
  assert.deepEqual(result.excluded, [{
    identity: 'sc|sastSemgrep|b|f.txt', occurrence: 0,
    candidateId: idOf(doc, 'sc|sastSemgrep|b|f.txt'),
    reason: 'the patch conflicts with an earlier fix that creates f.txt',
  }]);
});

test('a deletion of a path an earlier fix edited is excluded, naming the conflict', () => {
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|a|f.txt', file: 'f.txt', candidates: [verified(unifiedDiff('f.txt', 'a\n', 'A\n'))] }),
    finding({ identity: 'sc|sastSemgrep|b|f.txt', file: 'f.txt', candidates: [verified(unifiedDiff('f.txt', 'A\n', null))] }),
  ]);
  const result = combinedPatch(doc, readerOf({ 'f.txt': 'a\n' }));
  assert.equal(result.patch, unifiedDiff('f.txt', 'a\n', 'A\n'));
  assert.deepEqual(result.excluded, [{
    identity: 'sc|sastSemgrep|b|f.txt', occurrence: 0,
    candidateId: idOf(doc, 'sc|sastSemgrep|b|f.txt'),
    reason: 'the patch conflicts with an earlier fix that changes f.txt',
  }]);
});

test('an edit after a deletion of the same path is excluded, naming the conflict', () => {
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|a|f.txt', file: 'f.txt', candidates: [verified(unifiedDiff('f.txt', 'a\n', null))] }),
    finding({ identity: 'sc|sastSemgrep|b|f.txt', file: 'f.txt', candidates: [verified(unifiedDiff('f.txt', 'a\n', 'A\n'))] }),
  ]);
  const result = combinedPatch(doc, readerOf({ 'f.txt': 'a\n' }));
  assert.equal(result.patch, unifiedDiff('f.txt', 'a\n', null));
  assert.deepEqual(result.excluded, [{
    identity: 'sc|sastSemgrep|b|f.txt', occurrence: 0,
    candidateId: idOf(doc, 'sc|sastSemgrep|b|f.txt'),
    reason: 'the patch conflicts with an earlier fix that deletes f.txt',
  }]);
});

test('a deletion that does not remove exactly the text as read is excluded with the mismatch reason', () => {
  const identity = 'sc|sastSemgrep|stale|old.txt';
  const doc = documentOf([
    finding({ identity, file: 'old.txt', candidates: [verified(unifiedDiff('old.txt', 'hello\n', null))] }),
  ]);
  assert.deepEqual(combinedPatch(doc, readerOf({ 'old.txt': 'hello there\n' })), {
    patch: '',
    included: [],
    excluded: [{
      identity, occurrence: 0, candidateId: idOf(doc, identity),
      reason: 'does not apply to the text as read: unified diff: deleted line does not match the text at line 1',
    }],
  });
});

test('a deletion of an absent file is excluded and names the absent path', () => {
  const identity = 'sc|sastSemgrep|gone|gone.txt';
  const doc = documentOf([
    finding({ identity, file: 'gone.txt', candidates: [verified(unifiedDiff('gone.txt', 'x\n', null))] }),
  ]);
  assert.deepEqual(combinedPatch(doc, readerOf({})), {
    patch: '',
    included: [],
    excluded: [{ identity, occurrence: 0, candidateId: idOf(doc, identity), reason: 'the file is absent: gone.txt' }],
  });
});

test('the same creation patch on two findings applies once; the second names the first', () => {
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|a|new.txt', file: 'new.txt', candidates: [verified(CREATE)] }),
    finding({ identity: 'sc|sastSemgrep|b|new.txt', file: 'new.txt', candidates: [verified(CREATE)] }),
  ]);
  const result = combinedPatch(doc, readerOf({}));
  assert.equal(result.patch, CREATE);
  assert.deepEqual(result.included, [
    { identity: 'sc|sastSemgrep|a|new.txt', occurrence: 0, candidateId: idOf(doc, 'sc|sastSemgrep|a|new.txt'), files: ['new.txt'] },
    {
      identity: 'sc|sastSemgrep|b|new.txt', occurrence: 0, candidateId: idOf(doc, 'sc|sastSemgrep|b|new.txt'), files: ['new.txt'],
      samePatchAs: { identity: 'sc|sastSemgrep|a|new.txt', occurrence: 0 },
    },
  ]);
  assert.deepEqual(result.excluded, []);
});

test('one patch holding a creation, a deletion and an in-place change applies as a whole', () => {
  const originals = { 'keep.txt': 'a\nb\n', 'old.txt': 'gone\n' };
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|1|keep.txt', file: 'keep.txt', candidates: [verified(unifiedDiff('keep.txt', 'a\nb\n', 'a\nB\n'))] }),
    finding({ identity: 'sc|sastSemgrep|2|new.txt', file: 'new.txt', candidates: [verified(unifiedDiff('new.txt', null, 'born\n'))] }),
    finding({ identity: 'sc|sastSemgrep|3|old.txt', file: 'old.txt', candidates: [verified(unifiedDiff('old.txt', 'gone\n', null))] }),
  ]);
  const result = combinedPatch(doc, readerOf(originals));
  assert.equal(result.patch,
    unifiedDiff('keep.txt', 'a\nb\n', 'a\nB\n')
    + unifiedDiff('new.txt', null, 'born\n')
    + unifiedDiff('old.txt', 'gone\n', null));
  assert.deepEqual(result.included.map((i) => i.files), [['keep.txt'], ['new.txt'], ['old.txt']]);
  assert.deepEqual(result.excluded, []);
  assert.deepEqual(gitApply(originals, result.patch, ['keep.txt', 'new.txt', 'old.txt']), {
    'keep.txt': 'a\nB\n',
    'new.txt': 'born\n',
    'old.txt': null,
  });
});

test('a candidate that renames a file is excluded, not written half-way', () => {
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|rename|old.txt', file: 'old.txt', candidates: [verified(RENAME)] }),
  ]);
  assert.deepEqual(combinedPatch(doc, readerOf({ 'old.txt': 'hello\n' })), {
    patch: '',
    included: [],
    excluded: [{
      identity: 'sc|sastSemgrep|rename|old.txt', occurrence: 0,
      candidateId: idOf(doc, 'sc|sastSemgrep|rename|old.txt'), reason: 'the patch renames a file',
    }],
  });
});

test('a candidate carrying no patch is excluded', () => {
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|empty|f.txt', file: 'f.txt', candidates: [verified('')] }),
  ]);
  assert.deepEqual(combinedPatch(doc, readerOf({ 'f.txt': 'a\n' })), {
    patch: '',
    included: [],
    excluded: [{
      identity: 'sc|sastSemgrep|empty|f.txt', occurrence: 0,
      candidateId: idOf(doc, 'sc|sastSemgrep|empty|f.txt'), reason: 'the candidate carries no patch',
    }],
  });
});

for (const path of ['../outside.txt', 'a/../../outside.txt', '/etc/hosts', '.git/config', 'sub/.GIT/hooks/pre-commit', 'a\\b.txt']) {
  test(`a patch naming ${path} is excluded before any text is read`, () => {
    const identity = 'sc|sastSemgrep|escape|f.txt';
    const patch = `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-x\n+y\n`.replace('a//', '/').replace('b//', '/');
    const doc = documentOf([finding({ identity, file: 'f.txt', candidates: [verified(patch)] })]);
    assert.deepEqual(combinedPatch(doc, () => { throw new Error('readText must not run'); }), {
      patch: '',
      included: [],
      excluded: [{ identity, occurrence: 0, candidateId: idOf(doc, identity), reason: `the patch names a path outside the repository: ${path}` }],
    });
  });

  test(`a creation naming ${path} is excluded before any text is read`, () => {
    const identity = 'sc|sastSemgrep|escape-new|f.txt';
    const patch = `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,1 @@\n+x\n`;
    const doc = documentOf([finding({ identity, file: 'f.txt', candidates: [verified(patch)] })]);
    assert.deepEqual(combinedPatch(doc, () => { throw new Error('readText must not run'); }), {
      patch: '',
      included: [],
      excluded: [{ identity, occurrence: 0, candidateId: idOf(doc, identity), reason: `the patch names a path outside the repository: ${path}` }],
    });
  });
}

test('a patch with a file header and no hunk carries no patch', () => {
  const identity = 'sc|sastSemgrep|modeonly|f.txt';
  const doc = documentOf([finding({ identity, file: 'f.txt', candidates: [verified('diff --git a/f.txt b/f.txt\nold mode 100644\nnew mode 100755\n')] })]);
  assert.deepEqual(combinedPatch(doc, readerOf({ 'f.txt': 'a\n' })).excluded, [
    { identity, occurrence: 0, candidateId: idOf(doc, identity), reason: 'the candidate carries no patch' },
  ]);
});

test('readText throwing ENOENT excludes the candidate and names the absent path', () => {
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|absent|gone.txt', file: 'gone.txt', candidates: [verified(unifiedDiff('gone.txt', 'x\n', 'y\n'))] }),
  ]);
  assert.deepEqual(combinedPatch(doc, readerOf({})), {
    patch: '',
    included: [],
    excluded: [{
      identity: 'sc|sastSemgrep|absent|gone.txt', occurrence: 0,
      candidateId: idOf(doc, 'sc|sastSemgrep|absent|gone.txt'), reason: 'the file is absent: gone.txt',
    }],
  });
});

test('readText throwing EACCES propagates: an unreadable file is not an absent one', () => {
  const denied = new Error("EACCES: permission denied, open 'secret.txt'");
  denied.code = 'EACCES';
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|denied|secret.txt', file: 'secret.txt', candidates: [verified(unifiedDiff('secret.txt', 'x\n', 'y\n'))] }),
  ]);
  assert.throws(() => combinedPatch(doc, () => { throw denied; }), (err) => err === denied);
});

test('the same patch on two findings applies once; the second names the first with samePatchAs', () => {
  const before = 'a\nb\n';
  const after = 'a\nB\n';
  const patch = unifiedDiff('f.txt', before, after);
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|a|f.txt', file: 'f.txt', candidates: [verified(patch)] }),
    finding({ identity: 'sc|sastSemgrep|b|f.txt', file: 'f.txt', candidates: [verified(patch)] }),
  ]);
  const result = combinedPatch(doc, readerOf({ 'f.txt': before }));
  assert.equal(result.patch, patch, 'the identical patch is not applied twice');
  assert.deepEqual(result.included, [
    { identity: 'sc|sastSemgrep|a|f.txt', occurrence: 0, candidateId: idOf(doc, 'sc|sastSemgrep|a|f.txt'), files: ['f.txt'] },
    {
      identity: 'sc|sastSemgrep|b|f.txt', occurrence: 0, candidateId: idOf(doc, 'sc|sastSemgrep|b|f.txt'), files: ['f.txt'],
      samePatchAs: { identity: 'sc|sastSemgrep|a|f.txt', occurrence: 0 },
    },
  ]);
  assert.deepEqual(result.excluded, []);
  assert.deepEqual(gitApply({ 'f.txt': before }, result.patch), { 'f.txt': after });
});

test('an invalid document throws naming the first errors, before any text is read', () => {
  const bad = buildRemediation({
    repository: 'org/repo', commit: null, generatedAt: 'not-a-time', toolVersion: '0.6.174', findings: [],
  });
  const { errors } = validateRemediation(bad);
  assert.ok(errors.length > 0);
  assert.throws(
    () => combinedPatch(bad, () => { throw new Error('readText must not run'); }),
    { message: `remediation-patch: invalid document: ${errors.slice(0, 3).join('; ')}` },
  );
});

test('a patch that changes a path before it creates that path is excluded, not applied to nothing', () => {
  const identity = 'sc|sastSemgrep|backwards|n.txt';
  const patch = unifiedDiff('n.txt', 'a\n', 'a\nb\n') + unifiedDiff('n.txt', null, 'zzz\n');
  const doc = documentOf([finding({ identity, file: 'n.txt', candidates: [verified(patch)] })]);
  assert.deepEqual(combinedPatch(doc, readerOf({})), {
    patch: '',
    included: [],
    excluded: [{
      identity, occurrence: 0, candidateId: idOf(doc, identity),
      reason: 'does not apply to the text as read: the patch changes n.txt before it creates it',
    }],
  });
});

test('a malformed patch is a parse error, never an empty result', () => {
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|broken|f.txt', file: 'f.txt', candidates: [verified('--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n a\n')] }),
  ]);
  assert.throws(() => combinedPatch(doc, readerOf({ 'f.txt': 'a\n' })), /hunk body ends early/);
});

test('a missing final newline on the original survives to the git-applied text', () => {
  const before = 'a\nb\nc';
  const after = 'a\nb\nC';
  const patch = unifiedDiff('f.txt', before, after);
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|nonewline|f.txt', file: 'f.txt', candidates: [verified(patch)] }),
  ]);
  const result = combinedPatch(doc, readerOf({ 'f.txt': before }));
  assert.equal(result.patch, patch);
  assert.deepEqual(gitApply({ 'f.txt': before }, result.patch), { 'f.txt': after });
});

test('findings supplied in reverse order give the same patch, included and excluded', () => {
  const originals = { 'a.txt': 'a1\na2\na3\n', 'b.txt': 'b1\nb2\nb3\n' };
  const patchA = unifiedDiff('a.txt', originals['a.txt'], 'A1\na2\na3\n');
  const patchB = unifiedDiff('b.txt', originals['b.txt'], 'b1\nB2\nb3\n');
  const doc = documentOf([
    finding({ identity: 'sc|sastSemgrep|a|a.txt', file: 'a.txt', candidates: [verified(patchA)] }),
    finding({ identity: 'sc|sastSemgrep|b|b.txt', file: 'b.txt', candidates: [verified(patchB)] }),
  ]);
  const reversed = structuredClone(doc);
  reversed.findings.reverse();
  const before = structuredClone(reversed);
  const forward = combinedPatch(doc, readerOf(originals));
  const backward = combinedPatch(reversed, readerOf(originals));
  assert.deepEqual(backward, forward);
  assert.deepEqual(reversed, before, 'neither document was mutated');
  assert.deepEqual(gitApply(originals, forward.patch), { 'a.txt': 'A1\na2\na3\n', 'b.txt': 'b1\nB2\nb3\n' });
});
