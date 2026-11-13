// lib/sarif-remediation.mjs — a verified remediation's unified diff becomes SARIF replacements and
// back. The property is the oracle's heart: for every before/after pair, applying the replacements
// derived from the diff must reproduce the after text exactly. Exact-shape tests pin what a SARIF
// reader sees; throw tests pin the two conditions under which guessing would be worse than failing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unifiedDiff, parseUnifiedDiff } from '../unified-diff.mjs';
import { replacementsForFileDiff, applySarifReplacements, sarifFixes, remediationProperty } from '../sarif-remediation.mjs';

const file = (n) => `${Array.from({ length: n }, (_, i) => `l${i}`).join('\n')}\n`;
const replacementsFor = (before, after) =>
  replacementsForFileDiff(parseUnifiedDiff(unifiedDiff('f', before, after))[0]);

// ≥12 pairs: replacements; insertions at start/middle/end; deletions at start/middle/end; deleting
// everything; filling an empty file; every missing-final-newline combination; a trailing-newline
// change alone; two hunks; and non-ASCII whose surrogate pair makes a column count two units.
const PAIRS = [
  ['replacement', 'a\nb\nc\n', 'a\nX\nc\n'],
  ['insertion at start', 'b\n', 'a\nb\n'],
  ['insertion in the middle', 'a\nb\n', 'a\nx\ny\nb\n'],
  ['insertion at end', 'a\nb\n', 'a\nb\nx\n'],
  ['deletion at start', 'a\nb\n', 'b\n'],
  ['deletion in the middle', 'a\nx\nb\n', 'a\nb\n'],
  ['deletion at end', 'a\nb\n', 'a\n'],
  ['deleting everything', 'a\nb\n', ''],
  ['filling an empty file', '', 'a\nb\n'],
  ['before lacks its final newline', 'a\nb\nc', 'a\nb\nC\n'],
  ['after lacks its final newline', 'a\nb\nc\n', 'a\nb\nC'],
  ['both sides lack a final newline', 'a\nb\nc', 'a\nb\nC'],
  ['trailing newline removed alone', 'a\nb\n', 'a\nb'],
  ['trailing newline added alone', 'a\nb', 'a\nb\n'],
  ['two hunks', file(30), file(30).replace('l2\n', 'L2\n').replace('l25\n', 'L25\n')],
  ['an emoji costs two UTF-16 columns', 'a\n😀b\nc\n', 'a\n😀X\nc\n'],
  ['an emoji inserted', 'a\nb\n', 'a\n😀\nb\n'],
  ['an emoji deleted', 'a\n😀\nb\n', 'a\nb\n'],
];

test('property: applying a diff-derived replacement reproduces the after text byte for byte', () => {
  for (const [name, before, after] of PAIRS) {
    const replacements = replacementsFor(before, after);
    assert.ok(replacements.length > 0, `${name}: a change must produce replacements`);
    assert.equal(applySarifReplacements(before, replacements), after, name);
  }
});

test('replacements: a changed run deletes whole lines and inserts the new text', () => {
  assert.deepEqual(replacementsFor('a\nb\nc\n', 'a\nX\nc\n'), [{
    deletedRegion: { startLine: 2, startColumn: 1, endLine: 3, endColumn: 1 },
    insertedContent: { text: 'X\n' },
  }]);
});

test('replacements: a run with no deletions is a zero-length region at the line it precedes', () => {
  assert.deepEqual(replacementsFor('a\nb\n', 'a\nx\nb\n'), [{
    deletedRegion: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 1 },
    insertedContent: { text: 'x\n' },
  }]);
});

test('replacements: each no-newline marker shortens the region it ends', () => {
  assert.deepEqual(replacementsFor('a\nb', 'a\nB'), [{
    deletedRegion: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 2 },
    insertedContent: { text: 'B' },
  }]);
  assert.deepEqual(replacementsFor('a\nb\n', 'a\nB'), [{
    deletedRegion: { startLine: 2, startColumn: 1, endLine: 3, endColumn: 1 },
    insertedContent: { text: 'B' },
  }]);
});

const PATCH = '--- a/src/config.js\n+++ b/src/config.js\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n';

const candidate = (over = {}) => ({
  id: '0123456789abcdef',
  tier: 'deterministic',
  provenance: { tool: 'commitwork', model: null, version: '0.6.174' },
  patch: PATCH,
  cached: true,
  verification: {
    status: 'verified',
    witness: { lanes: ['sastGitleaks'], before: 1, after: 0, digest: 'sha256:aa' },
    newFindings: [],
    tests: { command: null, status: 'notDeclared' },
    reason: null,
  },
  ...over,
});

const withStatus = (status, over = {}) => {
  const base = candidate();
  const { verification = {}, ...rest } = over;
  return { ...base, ...rest, verification: { ...base.verification, status, ...verification } };
};

const finding = (candidates) => ({ identity: 'sc|sastGitleaks|generic-api-key|src/config.js', candidates });

test('sarifFixes: a verified candidate becomes one fix with its description and artifact change', () => {
  assert.deepEqual(sarifFixes(finding([candidate()])), {
    fixes: [{
      description: { text: 'deterministic fix (commitwork 0.6.174), verified by re-running sastGitleaks' },
      artifactChanges: [{
        artifactLocation: { uri: 'src/config.js', uriBaseId: '%SRCROOT%' },
        replacements: [{
          deletedRegion: { startLine: 2, startColumn: 1, endLine: 3, endColumn: 1 },
          insertedContent: { text: 'c\n' },
        }],
      }],
    }],
    unprojectable: [],
  });
});

test('sarifFixes: an unverified candidate is never emitted as a fix', () => {
  assert.deepEqual(sarifFixes(finding([withStatus('unverified', {
    verification: { witness: { lanes: [], before: 0, after: null, digest: null } },
  })])), { fixes: [], unprojectable: [] });
});

test('sarifFixes: a failed candidate is never emitted as a fix', () => {
  assert.deepEqual(sarifFixes(finding([withStatus('failed', {
    verification: { reason: 'the rule still fires', witness: { lanes: ['sastGitleaks'], before: 1, after: 1, digest: 'sha256:bb' } },
  })])), { fixes: [], unprojectable: [] });
});

test('sarifFixes: a created file is unprojectable, and one unprojectable file empties fixes', () => {
  const created = candidate({ patch: '--- /dev/null\n+++ b/new.js\n@@ -0,0 +1 @@\n+x\n' });
  assert.deepEqual(sarifFixes(finding([created])), {
    fixes: [],
    unprojectable: [{ path: 'new.js', reason: 'the patch creates this file' }],
  });
});

test('sarifFixes: a deleted file is unprojectable', () => {
  const deleted = candidate({ patch: '--- a/gone.js\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n' });
  assert.deepEqual(sarifFixes(finding([deleted])), {
    fixes: [],
    unprojectable: [{ path: 'gone.js', reason: 'the patch deletes this file' }],
  });
});

test('sarifFixes: artifact changes are sorted by path', () => {
  const patch = '--- a/z.js\n+++ b/z.js\n@@ -1 +1 @@\n-a\n+z\n'
    + '--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-b\n+y\n';
  const got = sarifFixes(finding([candidate({ tier: 'rule', provenance: { tool: 'semgrep', model: null, version: '1.2.3' }, patch,
    verification: { ...candidate().verification, witness: { lanes: ['sastOther', 'sastSemgrep'], before: 2, after: 0, digest: 'sha256:cc' } } })]));
  assert.deepEqual(got, {
    fixes: [{
      description: { text: 'rule fix (semgrep 1.2.3), verified by re-running sastOther, sastSemgrep' },
      artifactChanges: [
        {
          artifactLocation: { uri: 'a.js', uriBaseId: '%SRCROOT%' },
          replacements: [{ deletedRegion: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 1 }, insertedContent: { text: 'y\n' } }],
        },
        {
          artifactLocation: { uri: 'z.js', uriBaseId: '%SRCROOT%' },
          replacements: [{ deletedRegion: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 1 }, insertedContent: { text: 'z\n' } }],
        },
      ],
    }],
    unprojectable: [],
  });
});

test('remediationProperty: a verified candidate reports its tier, status and witness', () => {
  assert.deepEqual(remediationProperty(finding([candidate()])), {
    tier: 'deterministic',
    fixStatus: 'verified',
    witness: { lanes: ['sastGitleaks'], before: 1, after: 0, digest: 'sha256:aa' },
    undeterminedReason: null,
  });
});

test('remediationProperty: a failed candidate is reported as failed, with no undetermined reason', () => {
  const failed = withStatus('failed', {
    verification: { reason: 'the rule still fires', witness: { lanes: ['sastGitleaks'], before: 1, after: 1, digest: 'sha256:bb' } },
  });
  assert.deepEqual(remediationProperty(finding([failed])), {
    tier: 'deterministic',
    fixStatus: 'failed',
    witness: { lanes: ['sastGitleaks'], before: 1, after: 1, digest: 'sha256:bb' },
    undeterminedReason: null,
  });
});

test('remediationProperty: an undetermined candidate carries its reason and null after-count', () => {
  const undetermined = withStatus('undetermined', {
    verification: { reason: 'the lane could not re-run', witness: { lanes: ['sastGitleaks'], before: 1, after: null, digest: null } },
  });
  assert.deepEqual(remediationProperty(finding([undetermined])), {
    tier: 'deterministic',
    fixStatus: 'undetermined',
    witness: { lanes: ['sastGitleaks'], before: 1, after: null, digest: null },
    undeterminedReason: 'the lane could not re-run',
  });
});

test('remediationProperty: an unverified candidate keeps its unverified status and sorts its lanes', () => {
  const unverified = withStatus('unverified', {
    verification: { witness: { lanes: ['sastZ', 'sastA'], before: 0, after: null, digest: null } },
  });
  assert.deepEqual(remediationProperty(finding([unverified])), {
    tier: 'deterministic',
    fixStatus: 'unverified',
    witness: { lanes: ['sastA', 'sastZ'], before: 0, after: null, digest: null },
    undeterminedReason: null,
  });
});

test('remediationProperty: ranking is failed, then undetermined, then unverified', () => {
  const unverified = withStatus('unverified', {
    id: 'cccccccccccccccc', verification: { witness: { lanes: [], before: 0, after: null, digest: null } },
  });
  const undetermined = withStatus('undetermined', {
    id: 'bbbbbbbbbbbbbbbb', tier: 'llm',
    verification: { reason: 'not measured', witness: { lanes: ['x'], before: 1, after: null, digest: null } },
  });
  const failed = withStatus('failed', {
    id: 'aaaaaaaaaaaaaaaa', tier: 'codemod',
    verification: { reason: 'still fires', witness: { lanes: ['x'], before: 1, after: 1, digest: null } },
  });
  assert.equal(remediationProperty(finding([unverified, undetermined, failed])).fixStatus, 'failed');
  assert.equal(remediationProperty(finding([unverified, undetermined])).fixStatus, 'undetermined');
  assert.equal(remediationProperty(finding([unverified])).fixStatus, 'unverified');
});

test('remediationProperty: equal statuses break by tier order, then by id', () => {
  const byTier = (tier, id) => withStatus('failed', {
    id, tier, verification: { reason: 'still fires', witness: { lanes: ['x'], before: 1, after: 1, digest: `sha256:${id.slice(0, 2)}` } },
  });
  assert.equal(remediationProperty(finding([byTier('llm', '1111111111111111'), byTier('rule', '2222222222222222')])).tier, 'rule');
  assert.equal(remediationProperty(finding([byTier('rule', '2222222222222222'), byTier('rule', '1111111111111111')])).fixStatus, 'failed');
  assert.equal(remediationProperty(finding([byTier('rule', '2222222222222222'), byTier('rule', '1111111111111111')])).witness.digest,
    'sha256:11');
});

test('remediationProperty: the verified candidate wins over a failed one', () => {
  const failed = withStatus('failed', {
    tier: 'llm', verification: { reason: 'still fires', witness: { lanes: ['x'], before: 1, after: 1, digest: null } },
  });
  const verified = candidate({ tier: 'llm' });
  assert.equal(remediationProperty(finding([failed, verified])).fixStatus, 'verified');
  assert.equal(remediationProperty(finding([failed, verified])).tier, 'llm');
});

test('remediationProperty: no candidates means no property at all', () => {
  assert.equal(remediationProperty(finding([])), null);
  assert.equal(remediationProperty({}), null);
});

test('applySarifReplacements throws: a region outside the text', () => {
  const outsideLine = { deletedRegion: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 1 } };
  assert.throws(() => applySarifReplacements('a\n', [outsideLine]), /outside the text/);
  const outsideColumn = { deletedRegion: { startLine: 1, startColumn: 5, endLine: 1, endColumn: 6 } };
  assert.throws(() => applySarifReplacements('abc\n', [outsideColumn]), /outside the text/);
  const pastLastLine = { deletedRegion: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 1 } };
  assert.throws(() => applySarifReplacements('a', [pastLastLine]), /outside the text/);
  assert.throws(() => applySarifReplacements('a', [{}]), /outside the text/);
});

test('applySarifReplacements throws: a region that ends before it starts', () => {
  const inverted = { deletedRegion: { startLine: 2, startColumn: 1, endLine: 1, endColumn: 1 } };
  assert.throws(() => applySarifReplacements('a\nb\n', [inverted]), /ends before it starts/);
});

test('applySarifReplacements throws: overlapping regions', () => {
  const first = { deletedRegion: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 1 } };
  const second = { deletedRegion: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 1 } };
  assert.throws(() => applySarifReplacements('a\nb\nc\n', [first, second]), /regions overlap/);
  const insertion = { deletedRegion: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 1 }, insertedContent: { text: 'x' } };
  const around = { deletedRegion: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 1 } };
  assert.throws(() => applySarifReplacements('a\nb\nc\n', [insertion, around]), /regions overlap/);
});

test('applySarifReplacements: an insertion at a deletion boundary is not an overlap', () => {
  const deletion = { deletedRegion: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 1 } };
  const insertion = { deletedRegion: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 1 }, insertedContent: { text: 'x\n' } };
  assert.equal(applySarifReplacements('a\nb\n', [deletion, insertion]), 'x\nb\n');
});

test('sarifFixes: a renamed file is unprojectable, since the new path is not an artifact of the original', () => {
  const renamed = candidate({ patch: 'diff --git a/old.js b/new.js\n--- a/old.js\n+++ b/new.js\n@@ -1,1 +1,1 @@\n-a\n+b\n' });
  assert.deepEqual(sarifFixes(finding([renamed])), {
    fixes: [],
    unprojectable: [{ path: 'new.js', reason: 'the patch renames this file' }],
  });
});

test('sarifFixes: a verified candidate with no patch is never a fix with empty artifactChanges', () => {
  for (const patch of ['', undefined, null]) {
    assert.deepEqual(sarifFixes(finding([candidate({ patch })])), {
      fixes: [],
      unprojectable: [{ path: null, reason: 'the candidate carries no patch' }],
    });
  }
});

test('sarifFixes: every emitted artifactChange has at least one replacement', () => {
  const { fixes } = sarifFixes(finding([candidate()]));
  assert.equal(fixes.length, 1);
  assert.ok(fixes[0].artifactChanges.length > 0);
  for (const change of fixes[0].artifactChanges) assert.ok(change.replacements.length > 0);
});

test('property: 400 seeded before/after pairs round-trip, with and without final newlines', () => {
  let seed = 20261110;
  const next = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
  const WORDS = ['a', 'b', '', 'x y', '😀', 'tab\there', '-dash', '+plus', ' lead'];
  const text = () => {
    const lines = Array.from({ length: next(7) }, () => WORDS[next(WORDS.length)]);
    if (!lines.length) return '';
    return lines.join('\n') + (next(3) ? '\n' : '');
  };
  let changed = 0;
  for (let i = 0; i < 400; i++) {
    const before = text();
    const after = text();
    if (before === after) continue;
    changed += 1;
    const replacements = replacementsFor(before, after);
    assert.equal(applySarifReplacements(before, replacements), after, JSON.stringify({ before, after }));
  }
  assert.ok(changed > 300, `only ${changed} of 400 pairs differed`);
});

test('remediationProperty: a verified candidate on an unknown tier is never chosen over a real status', () => {
  const offTier = candidate({ id: 'aaaa', tier: 'bogus' });
  const failed = withStatus('failed', { id: 'zzzz', verification: { reason: 'still fires' } });
  const unverified = withStatus('unverified', { id: 'mmmm' });
  assert.deepEqual(sarifFixes(finding([offTier, failed])), { fixes: [], unprojectable: [] });
  assert.equal(remediationProperty(finding([offTier, failed])).fixStatus, 'failed');
  assert.equal(remediationProperty(finding([offTier, unverified])).fixStatus, 'unverified');
});
