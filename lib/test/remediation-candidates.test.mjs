// lib/test/remediation-candidates.test.mjs — a hardener's diff becomes remediation candidates:
// exact objects, byte-identical per-file slices, git as a second witness, and one real
// hardenAgentConfig result carried all the way into a document validateRemediation accepts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { TIERS, candidateId, buildRemediation, validateRemediation } from '../remediation-contract.mjs';
import { unifiedDiff, parseUnifiedDiff } from '../unified-diff.mjs';
import { candidatesFromDiff, mergeCandidates } from '../remediation-candidates.mjs';
import { hardenAgentConfig } from '../../monitor/agent-config-harden.mjs';

const AT = '2026-11-09T10:00:00Z';
const PROVENANCE = { tool: 'commitwork', model: null, version: '0.6.174' };

const unverified = () => ({
  status: 'unverified',
  witness: { lanes: [], before: 0, after: null, digest: null },
  newFindings: [],
  tests: { command: null, status: 'notDeclared' },
  reason: null,
});

const candidateFor = (identity, patch, provenance = PROVENANCE) => ({
  id: candidateId({ identity, tier: TIERS[0], patch }),
  tier: TIERS[0],
  provenance,
  patch,
  cached: false,
  verification: unverified(),
});

const baseFinding = (over = {}) => ({
  identity: 'sc|sastSemgrep|a|a.txt',
  occurrence: 0,
  ruleId: 'sastSemgrep/rule',
  lane: 'sastSemgrep',
  file: 'a.txt',
  severity: 'high',
  candidates: [],
  actions: [],
  ...over,
});

/** `git apply --check` inside a scratch repo holding `originals`; a rejection fails with the diff. */
function gitApplyCheck(originals, patch) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-rc-'));
  try {
    for (const [path, text] of Object.entries(originals)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, 'cw.patch'), patch);
    try {
      execFileSync('git', ['apply', '--check', 'cw.patch'], { cwd: dir });
    } catch (err) {
      assert.fail(`git apply --check rejected the patch:\n${err.stderr?.toString() || err.message}\n${patch}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('one changed file and one finding: the exact candidate object', () => {
  const identity = 'sc|sastSemgrep|one|src/config.js';
  const patch = unifiedDiff('src/config.js', 'a\nb\nc\n', 'a\nB\nc\n');
  const result = candidatesFromDiff({
    findings: [{ identity, occurrence: 0, file: 'src/config.js' }],
    diff: patch,
    tool: 'commitwork',
    version: '0.6.174',
  });
  assert.deepEqual(result, {
    candidates: [{ identity, occurrence: 0, candidate: candidateFor(identity, patch) }],
    unattributed: [],
  });
});

test('two changed files, an unattributed file and a finding the diff leaves alone', () => {
  const beforeA = 'a1\na2\na3\n';
  const beforeB = 'b1\nb2\nb3\n';
  const beforeC = 'c1\nc2\nc3\n';
  const patchA = unifiedDiff('a.txt', beforeA, 'a1\nA2\na3\n');
  const patchB = unifiedDiff('b.txt', beforeB, 'b1\nB2\nb3\n');
  const patchC = unifiedDiff('c.txt', beforeC, 'c1\nC2\nc3\n');
  const diff = patchA + patchB + patchC;
  const idA = 'sc|sastSemgrep|a|a.txt';
  const idB = 'sc|sastSemgrep|b|b.txt';
  const result = candidatesFromDiff({
    findings: [
      { identity: idB, occurrence: 0, file: 'b.txt' },
      { identity: idA, occurrence: 1, file: 'a.txt' },
      { identity: 'sc|sastSemgrep|d|d.txt', occurrence: 0, file: 'd.txt' },
    ],
    diff,
    tool: 'commitwork',
    version: '0.6.174',
  });
  assert.deepEqual(result, {
    candidates: [
      { identity: idA, occurrence: 1, candidate: candidateFor(idA, patchA) },
      { identity: idB, occurrence: 0, candidate: candidateFor(idB, patchB) },
    ],
    unattributed: [{ path: 'c.txt' }],
  });
  assert.equal(result.candidates[0].candidate.patch, diff.slice(0, patchA.length), 'a.txt patch is the input slice');
  assert.equal(result.candidates[1].candidate.patch, diff.slice(patchA.length, patchA.length + patchB.length), 'b.txt patch is the input slice');
});

test('a finding with no change yields no candidate and names nothing', () => {
  const patch = unifiedDiff('a.txt', 'a\n', 'A\n');
  const result = candidatesFromDiff({
    findings: [
      { identity: 'sc|sastSemgrep|a|a.txt', occurrence: 0, file: 'a.txt' },
      { identity: 'sc|sastSemgrep|d|d.txt', occurrence: 0, file: 'd.txt' },
    ],
    diff: patch,
    tool: 'commitwork',
    version: '0.6.174',
  });
  assert.deepEqual(result, {
    candidates: [{ identity: 'sc|sastSemgrep|a|a.txt', occurrence: 0, candidate: candidateFor('sc|sastSemgrep|a|a.txt', patch) }],
    unattributed: [],
  });
});

test('findings sorted by identity, then occurrence', () => {
  const identity = 'sc|sastSemgrep|same|f.txt';
  const patch = unifiedDiff('f.txt', 'x\n', 'y\n');
  const result = candidatesFromDiff({
    findings: [
      { identity, occurrence: 2, file: 'f.txt' },
      { identity: 'sc|sastSemgrep|zzz|f.txt', occurrence: 0, file: 'f.txt' },
      { identity, occurrence: 0, file: 'f.txt' },
      { identity, occurrence: 1, file: 'f.txt' },
    ],
    diff: patch,
    tool: 'commitwork',
    version: '0.6.174',
  });
  assert.deepEqual(result.candidates.map((c) => [c.identity, c.occurrence]), [
    [identity, 0],
    [identity, 1],
    [identity, 2],
    ['sc|sastSemgrep|zzz|f.txt', 0],
  ]);
});

test('an empty diff gives two empty arrays', () => {
  assert.deepEqual(candidatesFromDiff({
    findings: [{ identity: 'sc|sastSemgrep|a|a.txt', occurrence: 0, file: 'a.txt' }],
    diff: '',
    tool: 'commitwork',
    version: '0.6.174',
  }), { candidates: [], unattributed: [] });
});

test('every emitted patch is accepted by git apply --check', () => {
  const originals = { 'a.txt': 'a1\na2\na3\n', 'b.txt': 'b1\nb2\nb3\n' };
  const diff = unifiedDiff('a.txt', originals['a.txt'], 'a1\nA2\na3\n')
    + unifiedDiff('b.txt', originals['b.txt'], 'b1\nB2\nb3\n');
  const result = candidatesFromDiff({
    findings: [
      { identity: 'sc|sastSemgrep|a|a.txt', occurrence: 0, file: 'a.txt' },
      { identity: 'sc|sastSemgrep|b|b.txt', occurrence: 0, file: 'b.txt' },
    ],
    diff,
    tool: 'commitwork',
    version: '0.6.174',
  });
  assert.equal(result.candidates.length, 2);
  for (const { candidate } of result.candidates) {
    const path = parseUnifiedDiff(candidate.patch)[0].newPath;
    assert.ok(diff.includes(candidate.patch), `${path}: the patch is a slice of the input diff`);
    gitApplyCheck({ [path]: originals[path] }, candidate.patch);
  }
});

test('malformed input throws a TypeError naming the field', () => {
  const ok = { findings: [], diff: '', tool: 't', version: 'v' };
  assert.throws(() => candidatesFromDiff({ ...ok, findings: 'nope' }), { name: 'TypeError', message: /findings/ });
  assert.throws(() => candidatesFromDiff({ ...ok, diff: 42 }), { name: 'TypeError', message: /diff/ });
  assert.throws(() => candidatesFromDiff({ ...ok, tool: 7 }), { name: 'TypeError', message: /tool/ });
  assert.throws(() => candidatesFromDiff({ ...ok, version: undefined }), { name: 'TypeError', message: /version/ });
  assert.throws(() => candidatesFromDiff({ ...ok, findings: [{ identity: 'sc|x|y', occurrence: 0 }] }),
    { name: 'TypeError', message: /findings\[0\]\.file/ });
  assert.throws(() => candidatesFromDiff({ ...ok, findings: [{ identity: 'sc|x|y', occurrence: -1, file: null }] }),
    { name: 'TypeError', message: /findings\[0\]\.occurrence/ });
});

test('a diff that does not parse throws instead of yielding an empty result', () => {
  assert.throws(() => candidatesFromDiff({
    findings: [],
    diff: '--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+c\n',
    tool: 't',
    version: 'v',
  }), /hunk body ends early/);
});

test('mergeCandidates appends to the matching finding, skips an id it already holds, and mutates nothing', () => {
  const patchA = unifiedDiff('a.txt', 'a\n', 'A\n');
  const patchB = unifiedDiff('b.txt', 'b\n', 'B\n');
  const idA = 'sc|sastSemgrep|a|a.txt';
  const idB = 'sc|sastSemgrep|b|b.txt';
  const base = [
    baseFinding({ identity: idA, file: 'a.txt' }),
    baseFinding({ identity: idB, file: 'b.txt', candidates: [candidateFor(idB, patchB)] }),
  ];
  const before = structuredClone(base);
  const merged = mergeCandidates(base, [
    { identity: idA, occurrence: 0, candidate: candidateFor(idA, patchA) },
    { identity: idB, occurrence: 0, candidate: candidateFor(idB, patchB) },
  ]);
  assert.notEqual(merged, base);
  assert.notEqual(merged[0].candidates, base[0].candidates);
  assert.deepEqual(merged[0].candidates, [candidateFor(idA, patchA)]);
  assert.deepEqual(merged[1].candidates, [candidateFor(idB, patchB)], 'the candidate the finding already holds is not appended twice');
  assert.deepEqual(base, before, 'the inputs were mutated');
});

test('mergeCandidates throws when a produced candidate has no matching finding', () => {
  assert.throws(
    () => mergeCandidates([baseFinding()], [{ identity: 'sc|sastSemgrep|z|z.txt', occurrence: 0, candidate: candidateFor('sc|sastSemgrep|z|z.txt', '') }]),
    { message: 'mergeCandidates: no finding for sc|sastSemgrep|z|z.txt occurrence 0' },
  );
});

test('a document built from the merged findings validates with no errors', () => {
  const identity = 'sc|sastSemgrep|one|src/a.js';
  const patch = unifiedDiff('src/a.js', 'a\nb\n', 'a\nB\n');
  const findings = [baseFinding({ identity, file: 'src/a.js' })];
  const produced = candidatesFromDiff({
    findings: [{ identity, occurrence: 0, file: 'src/a.js' }],
    diff: patch,
    tool: 'commitwork',
    version: '0.6.174',
  }).candidates;
  const doc = buildRemediation({
    repository: 'org/repo',
    commit: 'b'.repeat(40),
    generatedAt: AT,
    toolVersion: '0.6.174',
    findings: mergeCandidates(findings, produced),
  });
  assert.deepEqual(validateRemediation(doc).errors, []);
  assert.equal(doc.findings[0].candidates.length, 1);
  assert.equal(doc.findings[0].candidates[0].id, candidateId({ identity, tier: TIERS[0], patch }));
});

test('a real hardenAgentConfig diff becomes candidates for the file it changes', () => {
  const repo = mkdtempSync(join(tmpdir(), 'cw-rc-harden-'));
  try {
    mkdirSync(join(repo, '.claude'), { recursive: true });
    const before = '{\n  "permissions": {\n    "allow": ["Bash(npm test:*)", "Read"]\n  }\n}\n';
    writeFileSync(join(repo, '.claude/settings.json'), before);

    const out = hardenAgentConfig({ repoDir: repo });
    assert.equal(out.ok, true, out.reason);
    assert.deepEqual(out.files, ['.claude/settings.json']);

    const identity = 'sc|agentConfig|credential-deny|.claude/settings.json';
    const result = candidatesFromDiff({
      findings: [{ identity, occurrence: 0, file: '.claude/settings.json' }],
      diff: out.diff,
      tool: 'agent-config-harden',
      version: '0.6.174',
    });
    assert.deepEqual(result.unattributed, []);
    assert.equal(result.candidates.length, 1);
    assert.deepEqual(result.candidates[0], {
      identity,
      occurrence: 0,
      candidate: candidateFor(identity, out.diff, { tool: 'agent-config-harden', model: null, version: '0.6.174' }),
    });
    gitApplyCheck({ '.claude/settings.json': before }, result.candidates[0].candidate.patch);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('content lines that look like file headers stay inside their file, and each slice is byte-equal to the input', () => {
  // A removed line "-- a/y" renders as "--- a/y" and an added "++ b/y" as "+++ b/y" inside the hunk.
  const tricky = unifiedDiff('src/a.txt', 'x\n-- a/y\nkeep\n', 'x\n++ b/y\nkeep\n');
  const plain = unifiedDiff('src/b.txt', 'one\n', 'two\n');
  assert.match(tricky, /\n--- a\/y\n\+\+\+ b\/y\n/);
  const findings = [
    { identity: 'sc|l|r|src/a.txt', occurrence: 0, file: 'src/a.txt' },
    { identity: 'sc|l|r|src/b.txt', occurrence: 0, file: 'src/b.txt' },
  ];
  const { candidates, unattributed } = candidatesFromDiff({ findings, diff: tricky + plain, tool: 'commitwork', version: '1' });
  assert.deepEqual(unattributed, []);
  assert.deepEqual(candidates.map((c) => c.candidate.patch), [tricky, plain]);
});

test('several findings in one file each get that file\'s whole patch, with distinct ids', () => {
  const diff = unifiedDiff('src/a.txt', 'one\n', 'two\n');
  const findings = [
    { identity: 'sc|l|r1|src/a.txt', occurrence: 0, file: 'src/a.txt' },
    { identity: 'sc|l|r2|src/a.txt', occurrence: 0, file: 'src/a.txt' },
  ];
  const { candidates } = candidatesFromDiff({ findings, diff, tool: 'commitwork', version: '1' });
  assert.deepEqual(candidates.map((c) => c.candidate.patch), [diff, diff]);
  assert.equal(new Set(candidates.map((c) => c.candidate.id)).size, 2);
  assert.ok(candidates.every((c) => c.candidate.tier === 'deterministic' && TIERS.includes(c.candidate.tier)));
});

test('a creation diff becomes a candidate for the finding that names the new file', () => {
  const diff = unifiedDiff('SECURITY.md', null, 'policy\n');
  const { candidates } = candidatesFromDiff({ findings: [{ identity: 'f|policy|SECURITY.md', occurrence: 0, file: 'SECURITY.md' }], diff, tool: 'commitwork', version: '1' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].candidate.patch, diff);
});
