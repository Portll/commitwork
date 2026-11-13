// lib/test/remediation-candidates-workflow.test.mjs — one finding plus its workflow text becomes a
// fix candidate through the pure fixers: exact patch bytes, exact candidate object, every skip path,
// git as a second witness, and a document validateRemediation accepts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { TIERS, candidateId, buildRemediation, validateRemediation } from '../remediation-contract.mjs';
import { unifiedDiff, parseUnifiedDiff, applyUnifiedDiff } from '../unified-diff.mjs';
import { mergeCandidates } from '../remediation-candidates.mjs';
import { workflowCandidates } from '../remediation-candidates-workflow.mjs';

const FILE = '.github/workflows/ci.yml';
const UNPINNED = 'unpinned-uses';
const ARTIPACKED = 'artipacked';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const identityFor = (rule) => `sc|actionsPosture|zizmor/${rule}|${FILE}`;
const ruleIdFor = (rule) => `actionsPosture/zizmor/${rule}`;
const findingFor = (rule, over = {}) => ({
  identity: identityFor(rule),
  occurrence: 0,
  ruleId: ruleIdFor(rule),
  file: FILE,
  ...over,
});

const WORKFLOW = [
  'jobs:',
  '  build:',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - uses: actions/setup-node@v4',
  '',
].join('\n');

const PINNED = [
  'jobs:',
  '  build:',
  '    steps:',
  `      - uses: actions/checkout@${SHA_A} # v4`,
  `      - uses: actions/setup-node@${SHA_B} # v4`,
  '',
].join('\n');

const twoShas = (action) => (action === 'actions/checkout' ? SHA_A : SHA_B);

const PROVENANCE = { tool: 'workflow-harden', model: null, version: '0.6.174' };

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

/** `git apply --check` inside a scratch repo holding `originals`; a rejection fails with the diff. */
function gitApplyCheck(originals, patch) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-rcw-'));
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

function assertTypeError(fn, field) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof TypeError, `expected a TypeError, got ${err}`);
    assert.match(err.message, /^workflowCandidates: /);
    assert.match(err.message, field);
    return true;
  });
}

test('two actions both resolve: one candidate whose patch is the exact unified diff', () => {
  const result = workflowCandidates({
    finding: findingFor(UNPINNED),
    text: WORKFLOW,
    resolveSha: twoShas,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].candidate.patch, unifiedDiff(FILE, WORKFLOW, PINNED));
  assert.deepEqual(result.unpinned, []);
  assert.equal(result.skipped, null);
});

test('the whole candidate object matches the shared builder, provenance included', () => {
  const identity = identityFor(UNPINNED);
  const patch = unifiedDiff(FILE, WORKFLOW, PINNED);
  const result = workflowCandidates({
    finding: findingFor(UNPINNED),
    text: WORKFLOW,
    resolveSha: twoShas,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  assert.deepStrictEqual(result.candidates, [
    { identity, occurrence: 0, candidate: candidateFor(identity, patch) },
  ]);
});

test('the resolver is called once per pinnable action, in file order', () => {
  const calls = [];
  const resolveSha = (action, ref) => {
    calls.push([action, ref]);
    return action === 'actions/checkout' ? SHA_A : SHA_B;
  };
  const result = workflowCandidates({
    finding: findingFor(UNPINNED),
    text: WORKFLOW,
    resolveSha,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(calls, [['actions/checkout', 'v4'], ['actions/setup-node', 'v4']]);
});

test('one unresolvable action: a partial fix pins the other and reports the skip', () => {
  const partial = [
    'jobs:',
    '  build:',
    '    steps:',
    `      - uses: actions/checkout@${SHA_A} # v4`,
    '      - uses: actions/setup-node@v4',
    '',
  ].join('\n');
  const resolveSha = (action) => (action === 'actions/checkout' ? SHA_A : null);
  const result = workflowCandidates({
    finding: findingFor(UNPINNED),
    text: WORKFLOW,
    resolveSha,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].candidate.patch, unifiedDiff(FILE, WORKFLOW, partial));
  assert.equal(result.skipped, null);
  assert.deepEqual(result.unpinned, [{ action: 'actions/setup-node', ref: 'v4', reason: 'unresolved' }]);
});

test('a resolver that never returns a SHA leaves the file unchanged and reports both actions', () => {
  const result = workflowCandidates({
    finding: findingFor(UNPINNED),
    text: WORKFLOW,
    resolveSha: () => 'abc',
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.skipped, { reason: 'no action in the file could be pinned' });
  assert.deepEqual(result.unpinned, [
    { action: 'actions/checkout', ref: 'v4', reason: 'unresolved' },
    { action: 'actions/setup-node', ref: 'v4', reason: 'unresolved' },
  ]);
});

test('a local action and a docker image are reported as unpinnable, in file order', () => {
  const text = [
    'jobs:',
    '  build:',
    '    steps:',
    '      - uses: ./local@v1',
    '      - uses: docker://alpine@3.20',
    '',
  ].join('\n');
  const result = workflowCandidates({
    finding: findingFor(UNPINNED),
    text,
    resolveSha: () => SHA_A,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.skipped, { reason: 'no action in the file could be pinned' });
  assert.deepEqual(result.unpinned, [
    { action: './local', ref: 'v1', reason: 'local-action' },
    { action: 'docker://alpine', ref: '3.20', reason: 'docker-image' },
  ]);
});

test('a file whose only action is already pinned has nothing left to pin', () => {
  const text = [
    'jobs:',
    '  build:',
    '    steps:',
    `      - uses: actions/checkout@${SHA_A}`,
    '',
  ].join('\n');
  const result = workflowCandidates({
    finding: findingFor(UNPINNED),
    text,
    resolveSha: twoShas,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  assert.deepEqual(result, {
    candidates: [],
    skipped: { reason: 'the file has no action left to pin' },
    unpinned: [],
  });
});

test('an error thrown by the resolver propagates unchanged', () => {
  const boom = new Error('lookup failed');
  const resolveSha = () => { throw boom; };
  assert.throws(() => workflowCandidates({
    finding: findingFor(UNPINNED),
    text: WORKFLOW,
    resolveSha,
    tool: 'workflow-harden',
    version: '0.6.174',
  }), (err) => err === boom);
});

test('a CRLF workflow stays CRLF through the patch', () => {
  const text = [
    'jobs:',
    '  build:',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '',
  ].join('\r\n');
  const result = workflowCandidates({
    finding: findingFor(UNPINNED),
    text,
    resolveSha: () => SHA_A,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  const applied = applyUnifiedDiff(text, parseUnifiedDiff(result.candidates[0].candidate.patch)[0]);
  assert.equal(applied, [
    'jobs:',
    '  build:',
    '    steps:',
    `      - uses: actions/checkout@${SHA_A} # v4`,
    '',
  ].join('\r\n'));
  const lines = applied.split('\n');
  for (const line of lines.slice(0, -1)) assert.ok(line.endsWith('\r'), `line does not end CRLF: ${JSON.stringify(line)}`);
});

test('artipacked adds a with block under a checkout step without one', () => {
  const text = '      - uses: actions/checkout@v4\n';
  const result = workflowCandidates({
    finding: findingFor(ARTIPACKED),
    text,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  assert.equal(result.skipped, null);
  assert.deepEqual(result.unpinned, []);
  const applied = applyUnifiedDiff(text, parseUnifiedDiff(result.candidates[0].candidate.patch)[0]);
  assert.equal(applied, '      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n');
});

test('artipacked merges into an existing with block and adds no second with key', () => {
  const text = '      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n';
  const result = workflowCandidates({
    finding: findingFor(ARTIPACKED),
    text,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  const applied = applyUnifiedDiff(text, parseUnifiedDiff(result.candidates[0].candidate.patch)[0]);
  assert.equal(applied, '      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n          fetch-depth: 0\n');
  assert.equal((applied.match(/with:/g) || []).length, 1);
});

test('artipacked is skipped when persist-credentials is already false', () => {
  const text = '      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n';
  const result = workflowCandidates({
    finding: findingFor(ARTIPACKED),
    text,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  assert.deepEqual(result, {
    candidates: [],
    skipped: { reason: 'no actions/checkout step lacks persist-credentials' },
    unpinned: [],
  });
});

const MIXED_ENDINGS = 'on: push\r\njobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n';

test('mixed line endings with no action resolved are skipped, never a line-ending patch', () => {
  const result = workflowCandidates({
    finding: findingFor(UNPINNED),
    text: MIXED_ENDINGS,
    resolveSha: () => null,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  assert.deepEqual(result, {
    candidates: [],
    skipped: { reason: 'no action in the file could be pinned' },
    unpinned: [{ action: 'actions/checkout', ref: 'v4', reason: 'unresolved' }],
  });
});

test('mixed line endings with persist-credentials already set are skipped for artipacked', () => {
  const result = workflowCandidates({
    finding: findingFor(ARTIPACKED),
    text: MIXED_ENDINGS,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  assert.deepEqual(result, {
    candidates: [],
    skipped: { reason: 'no actions/checkout step lacks persist-credentials' },
    unpinned: [],
  });
});

test('a rule with no deterministic fix is skipped and named', () => {
  const result = workflowCandidates({
    finding: findingFor('template-injection'),
    text: WORKFLOW,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  assert.deepEqual(result, {
    candidates: [],
    skipped: { reason: 'no deterministic fix for actionsPosture/zizmor/template-injection' },
    unpinned: [],
  });
});

test('a finding that names no file is skipped', () => {
  const result = workflowCandidates({
    finding: findingFor(UNPINNED, { file: null }),
    text: WORKFLOW,
    resolveSha: () => null,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  assert.deepEqual(result, {
    candidates: [],
    skipped: { reason: 'the finding names no file' },
    unpinned: [],
  });
});

test('a non-object argument throws a TypeError naming input', () => {
  assertTypeError(() => workflowCandidates(undefined), /input/);
});

test('a non-object finding throws a TypeError naming finding', () => {
  assertTypeError(() => workflowCandidates({ finding: [], text: '', resolveSha: () => null }), /finding/);
});

test('an empty identity throws a TypeError naming identity', () => {
  assertTypeError(() => workflowCandidates({
    finding: { ...findingFor(UNPINNED), identity: '' },
    text: '',
    resolveSha: () => null,
  }), /identity/);
});

test('an empty ruleId throws a TypeError naming ruleId', () => {
  assertTypeError(() => workflowCandidates({
    finding: { ...findingFor(UNPINNED), ruleId: '' },
    text: '',
  }), /ruleId/);
});

test('a negative occurrence throws a TypeError naming occurrence', () => {
  assertTypeError(() => workflowCandidates({
    finding: findingFor(UNPINNED, { occurrence: -1 }),
    text: '',
    resolveSha: () => null,
  }), /occurrence/);
});

test('a non-string, non-null file throws a TypeError naming file', () => {
  assertTypeError(() => workflowCandidates({
    finding: findingFor(UNPINNED, { file: 42 }),
    text: '',
    resolveSha: () => null,
  }), /file/);
});

test('a non-string text throws a TypeError naming text', () => {
  assertTypeError(() => workflowCandidates({
    finding: findingFor(UNPINNED),
    text: 42,
    resolveSha: () => null,
  }), /text/);
});

test('a missing resolver for unpinned-uses throws a TypeError naming resolveSha', () => {
  assertTypeError(() => workflowCandidates({
    finding: findingFor(UNPINNED),
    text: '',
  }), /resolveSha/);
});

test('git apply --check accepts both fixer patches', () => {
  const unpinned = workflowCandidates({
    finding: findingFor(UNPINNED),
    text: WORKFLOW,
    resolveSha: twoShas,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  gitApplyCheck({ [FILE]: WORKFLOW }, unpinned.candidates[0].candidate.patch);

  const checkout = '      - uses: actions/checkout@v4\n';
  const artipacked = workflowCandidates({
    finding: findingFor(ARTIPACKED),
    text: checkout,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  gitApplyCheck({ [FILE]: checkout }, artipacked.candidates[0].candidate.patch);
});

test('merged candidates build a document validateRemediation accepts', () => {
  const finding = { ...findingFor(UNPINNED), lane: 'actionsPosture', severity: 'med', candidates: [], actions: [] };
  const { candidates } = workflowCandidates({
    finding,
    text: WORKFLOW,
    resolveSha: twoShas,
    tool: 'workflow-harden',
    version: '0.6.174',
  });
  const doc = buildRemediation({
    repository: 'org/repo',
    commit: 'b'.repeat(40),
    generatedAt: '2026-11-09T10:00:00Z',
    toolVersion: '0.6.174',
    findings: mergeCandidates([finding], candidates),
  });
  assert.deepEqual(validateRemediation(doc).errors, []);
  assert.equal(doc.findings[0].candidates.length, 1);
});

test('a frozen finding yields the same result twice and is not mutated', () => {
  const finding = Object.freeze(findingFor(UNPINNED));
  const args = { finding, text: WORKFLOW, resolveSha: twoShas, tool: 'workflow-harden', version: '0.6.174' };
  const first = workflowCandidates(args);
  const second = workflowCandidates(args);
  assert.deepEqual(first, second);
  assert.deepEqual(finding, findingFor(UNPINNED));
});
