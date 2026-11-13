// lib/test/remediation-candidates-agent.test.mjs — one finding plus its file's text becomes the fix
// candidate for one of the two agent-surface rules: exact objects, the BOM kept, both fixers'
// declines verbatim, git as a second witness, and a document validateRemediation accepts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { candidateId, buildRemediation, validateRemediation } from '../remediation-contract.mjs';
import { unifiedDiff, parseUnifiedDiff, applyUnifiedDiff } from '../unified-diff.mjs';
import { mergeCandidates } from '../remediation-candidates.mjs';
import { agentCandidates } from '../remediation-candidates-agent.mjs';
import { CREDENTIAL_DENY } from '../../bin/agent-config.mjs';

const AT = '2026-11-09T10:00:00Z';
const HIDDEN_IDENTITY = 'sc|agentInstructions|hidden-unicode|CLAUDE.md';
const DENY_IDENTITY = 'sc|agentConfig|permissions-deny-missing|.claude/settings.json';

const hiddenFinding = (over = {}) => ({
  identity: HIDDEN_IDENTITY,
  occurrence: 0,
  ruleId: 'agentInstructions/hidden-unicode',
  file: 'CLAUDE.md',
  ...over,
});

const denyFinding = (over = {}) => ({
  identity: DENY_IDENTITY,
  occurrence: 0,
  ruleId: 'agentConfig/permissions-deny-missing',
  file: '.claude/settings.json',
  ...over,
});

const DENY_BEFORE = '{\n  "permissions": {\n    "allow": ["Bash(npm test)"]\n  }\n}\n';

const unverified = () => ({
  status: 'unverified',
  witness: { lanes: [], before: 0, after: null, digest: null },
  newFindings: [],
  tests: { command: null, status: 'notDeclared' },
  reason: null,
});

/** `git apply --check` inside a scratch repo holding `originals`; a rejection fails with the diff. */
function gitApplyCheck(originals, patch) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-rca-'));
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

function rejectsWith(fn, field) {
  let err;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err instanceof TypeError, 'a TypeError is thrown');
  assert.match(err.message, /^agentCandidates: /);
  assert.ok(err.message.includes(field), `the message names ${field}: ${err.message}`);
}

test('hidden-unicode: one candidate whose patch is the diff from the original text', () => {
  const text = 'a\u200Bb\n';
  const result = agentCandidates({ finding: hiddenFinding(), text, tool: 'commitwork', version: '0.6.208' });
  assert.equal(result.skipped, null);
  assert.equal(result.candidates.length, 1);
  assert.deepStrictEqual(
    { identity: result.candidates[0].identity, occurrence: result.candidates[0].occurrence },
    { identity: HIDDEN_IDENTITY, occurrence: 0 },
  );
  assert.equal(result.candidates[0].candidate.patch, unifiedDiff('CLAUDE.md', text, 'ab\n'));
});

test('the whole hidden-unicode candidate object is exact', () => {
  const text = 'a\u200Bb\n';
  const patch = unifiedDiff('CLAUDE.md', text, 'ab\n');
  const { candidates } = agentCandidates({ finding: hiddenFinding(), text, tool: 'commitwork', version: '0.6.208' });
  assert.deepStrictEqual(candidates[0], {
    identity: HIDDEN_IDENTITY,
    occurrence: 0,
    candidate: {
      id: candidateId({ identity: HIDDEN_IDENTITY, tier: 'deterministic', patch }),
      tier: 'deterministic',
      provenance: { tool: 'commitwork', model: null, version: '0.6.208' },
      patch,
      cached: false,
      verification: unverified(),
    },
  });
});

test('tool and version pass through as null rather than defaulting', () => {
  const { candidates } = agentCandidates({ finding: hiddenFinding(), text: 'a\u200Bb\n', tool: null, version: null });
  assert.deepStrictEqual(candidates[0].candidate.provenance, { tool: null, model: null, version: null });
});

test('a leading BOM is kept and only the hidden character is stripped', () => {
  const text = '\uFEFFx\u202Ey\n';
  const { candidates } = agentCandidates({ finding: hiddenFinding(), text, tool: 'commitwork', version: '0.6.208' });
  const patched = applyUnifiedDiff(text, parseUnifiedDiff(candidates[0].candidate.patch)[0]);
  assert.equal(patched, '\uFEFFxy\n');
});

test('a file with no hidden character is skipped with the exact reason', () => {
  assert.deepStrictEqual(
    agentCandidates({ finding: hiddenFinding(), text: 'plain\n', tool: 'commitwork', version: '0.6.208' }),
    { candidates: [], skipped: { reason: 'the file holds no hidden character' } },
  );
});

test('permissions-deny-missing: the patch adds CREDENTIAL_DENY and leaves allow unchanged', () => {
  const { candidates, skipped } = agentCandidates({ finding: denyFinding(), text: DENY_BEFORE, tool: 'commitwork', version: '0.6.208' });
  assert.equal(skipped, null);
  assert.equal(candidates.length, 1);
  const patched = applyUnifiedDiff(DENY_BEFORE, parseUnifiedDiff(candidates[0].candidate.patch)[0]);
  const json = JSON.parse(patched);
  assert.deepStrictEqual(json.permissions.deny, CREDENTIAL_DENY);
  assert.deepStrictEqual(json.permissions.allow, ['Bash(npm test)']);
});

test('a deny list that already covers credentials is skipped with the fixer reason', () => {
  const text = '{\n  "permissions": {\n    "allow": ["Bash(npm test)"],\n    "deny": ["Read(~/.ssh/**)"]\n  }\n}\n';
  assert.deepStrictEqual(
    agentCandidates({ finding: denyFinding(), text, tool: 'commitwork', version: '0.6.208' }),
    { candidates: [], skipped: { reason: 'permissions.deny already covers credential reads' } },
  );
});

test('an allow list with no Bash grant is skipped with the fixer reason', () => {
  const text = '{\n  "permissions": {\n    "allow": ["Read"]\n  }\n}\n';
  assert.deepStrictEqual(
    agentCandidates({ finding: denyFinding(), text, tool: 'commitwork', version: '0.6.208' }),
    { candidates: [], skipped: { reason: 'no Bash grant to bound' } },
  );
});

test('text that is not JSON is skipped with the fixer reason', () => {
  assert.deepStrictEqual(
    agentCandidates({ finding: denyFinding(), text: 'not json\n', tool: 'commitwork', version: '0.6.208' }),
    { candidates: [], skipped: { reason: 'unparseable' } },
  );
});

test('a rule with no deterministic fix is skipped with the exact reason', () => {
  const finding = hiddenFinding({
    identity: 'sc|agentConfig|env-secret-inline|.env',
    ruleId: 'agentConfig/env-secret-inline',
    file: '.env',
  });
  assert.deepStrictEqual(
    agentCandidates({ finding, text: 'TOKEN=x\n', tool: 'commitwork', version: '0.6.208' }),
    { candidates: [], skipped: { reason: 'no deterministic fix for agentConfig/env-secret-inline' } },
  );
});

test('a finding that names no file is skipped with the exact reason', () => {
  assert.deepStrictEqual(
    agentCandidates({ finding: hiddenFinding({ file: null }), text: 'a\u200Bb\n', tool: 'commitwork', version: '0.6.208' }),
    { candidates: [], skipped: { reason: 'the finding names no file' } },
  );
});

test('a non-object argument throws a TypeError naming the argument', () => {
  rejectsWith(() => agentCandidates(), 'argument');
});

test('a non-object finding throws a TypeError naming finding', () => {
  rejectsWith(() => agentCandidates({ finding: [], text: 'plain\n', tool: 't', version: 'v' }), 'finding');
});

test('an empty identity throws a TypeError naming finding.identity', () => {
  rejectsWith(
    () => agentCandidates({ finding: hiddenFinding({ identity: '' }), text: 'plain\n', tool: 't', version: 'v' }),
    'finding.identity',
  );
});

test('a non-string ruleId throws a TypeError naming finding.ruleId', () => {
  rejectsWith(
    () => agentCandidates({ finding: hiddenFinding({ ruleId: 7 }), text: 'plain\n', tool: 't', version: 'v' }),
    'finding.ruleId',
  );
});

test('a negative occurrence throws a TypeError naming finding.occurrence', () => {
  rejectsWith(
    () => agentCandidates({ finding: hiddenFinding({ occurrence: -1 }), text: 'plain\n', tool: 't', version: 'v' }),
    'finding.occurrence',
  );
});

test('a non-string, non-null file throws a TypeError naming finding.file', () => {
  rejectsWith(
    () => agentCandidates({ finding: hiddenFinding({ file: 3 }), text: 'plain\n', tool: 't', version: 'v' }),
    'finding.file',
  );
});

test('a non-string text throws a TypeError naming text', () => {
  rejectsWith(
    () => agentCandidates({ finding: hiddenFinding(), text: null, tool: 't', version: 'v' }),
    'text',
  );
});

test('git apply --check accepts the hidden-unicode and permissions-deny-missing patches', () => {
  const hidden = agentCandidates({ finding: hiddenFinding(), text: 'a\u200Bb\n', tool: 'commitwork', version: '0.6.208' });
  assert.equal(hidden.candidates.length, 1);
  gitApplyCheck({ 'CLAUDE.md': 'a\u200Bb\n' }, hidden.candidates[0].candidate.patch);

  const deny = agentCandidates({ finding: denyFinding(), text: DENY_BEFORE, tool: 'commitwork', version: '0.6.208' });
  assert.equal(deny.candidates.length, 1);
  gitApplyCheck({ '.claude/settings.json': DENY_BEFORE }, deny.candidates[0].candidate.patch);
});

test('a document built from the merged candidate validates with no errors', () => {
  const { candidates } = agentCandidates({ finding: denyFinding(), text: DENY_BEFORE, tool: 'commitwork', version: '0.6.208' });
  const doc = buildRemediation({
    repository: 'org/repo',
    commit: 'b'.repeat(40),
    generatedAt: AT,
    toolVersion: '0.6.208',
    findings: mergeCandidates(
      [{ ...denyFinding(), lane: 'agentConfig', severity: 'low', candidates: [], actions: [] }],
      candidates,
    ),
  });
  assert.deepStrictEqual(validateRemediation(doc).errors, []);
});

test('a frozen finding gives the same result twice', () => {
  const finding = Object.freeze(hiddenFinding());
  const first = agentCandidates({ finding, text: 'a\u200Bb\n', tool: 'commitwork', version: '0.6.208' });
  const second = agentCandidates({ finding, text: 'a\u200Bb\n', tool: 'commitwork', version: '0.6.208' });
  assert.deepStrictEqual(first, second);
});
