// lib/test/remediation-contract.test.mjs — remediation.json's frozen contract: the builder's
// canonical output, the schema's shape (no line on a finding), and the status rules
// validateRemediation adds on top of the schema, one failing case per rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  REMEDIATION_SCHEMA, TIERS, VERIFICATION_STATUSES, candidateId, buildRemediation,
  validateRemediation, chosenCandidate,
} from '../remediation-contract.mjs';

const AT = '2026-11-09T10:00:00Z';
const PATCH = '--- a/src/config.js\n+++ b/src/config.js\n@@ -1 +1 @@\n-  apiKey: "k",\n+  apiKey: env.API_KEY,\n';
const ID = 'sc|sastGitleaks|generic-api-key|src/config.js';
const sha = (hex) => `sha256:${hex}`;

const candidate = (over = {}) => ({
  tier: 'deterministic',
  provenance: { tool: 'commitwork', model: null, version: '0.6.174' },
  patch: PATCH,
  cached: true,
  verification: {
    status: 'verified',
    witness: { lanes: ['sastGitleaks'], before: 1, after: 0, digest: sha('a'.repeat(64)) },
    newFindings: [],
    tests: { command: 'node --test', status: 'passed' },
    reason: null,
  },
  ...over,
});

const finding = (over = {}) => ({
  identity: ID,
  occurrence: 0,
  ruleId: 'sastGitleaks/generic-api-key',
  lane: 'sastGitleaks',
  file: 'src/config.js',
  severity: 'high',
  candidates: [candidate()],
  actions: [{ kind: 'rotate-secret', text: 'rotate the key at its provider' }],
  ...over,
});

const doc = (findings = [finding()]) => buildRemediation({
  repository: 'org/repo',
  commit: 'b'.repeat(40),
  generatedAt: AT,
  toolVersion: '0.6.174',
  findings,
  undetermined: [{ identity: 'sc|sastSemgrep|x|src/y.js', ruleId: 'sastSemgrep/x', lane: 'sastSemgrep', claimedSeverity: 'high', reason: 'the report did not parse' }],
  notMeasured: [{ lane: 'sastCodeql', reason: 'the database was absent' }],
});

const cand = (d) => d.findings[0].candidates[0];
const at = (d) => `finding ${d.findings[0].identity} candidate ${cand(d).id}: `;

test('the constants are frozen in the order the contract states', () => {
  assert.equal(REMEDIATION_SCHEMA, 'commitwork.remediation/1');
  assert.deepEqual(TIERS, ['deterministic', 'rule', 'codemod', 'llm']);
  assert.deepEqual(VERIFICATION_STATUSES, ['verified', 'failed', 'unverified', 'undetermined']);
  assert.ok(Object.isFrozen(TIERS) && Object.isFrozen(VERIFICATION_STATUSES));
});

test('candidateId is the first 16 hex of sha256 over identity, tier and patch, NUL-joined, "" standing in for null', () => {
  assert.equal(candidateId({ identity: 'sc|x|y', tier: 'rule', patch: null }),
    createHash('sha256').update('sc|x|y\0rule\0').digest('hex').slice(0, 16));
  assert.equal(candidateId({ identity: 'sc|x|y', tier: 'rule', patch: null }),
    candidateId({ identity: 'sc|x|y', tier: 'rule', patch: '' }), 'a null patch and an empty patch are the same candidate');
  assert.notEqual(candidateId({ identity: 'sc|x|y', tier: 'rule', patch: null }),
    candidateId({ identity: 'sc|x|z', tier: 'rule', patch: null }));
  assert.notEqual(candidateId({ identity: 'sc|x|y', tier: 'rule', patch: null }),
    candidateId({ identity: 'sc|x|y', tier: 'llm', patch: null }));
  assert.match(candidateId({ identity: 'sc|x|y', tier: 'rule', patch: null }), /^[0-9a-f]{16}$/);
});

test('candidateId keeps fields apart when a field holds a newline', () => {
  assert.notEqual(candidateId({ identity: 'sc|a\nrule', tier: 'x', patch: '' }),
    candidateId({ identity: 'sc|a', tier: 'rule', patch: 'x\n' }));
});

test('undetermined and notMeasured rows that tie on their keys sort by the remaining fields', () => {
  const rows = (order) => ({
    repository: 'org/repo', commit: null, generatedAt: AT, toolVersion: '0.6.174', findings: [],
    undetermined: order([
      { identity: 'sc|s|x|a.js', ruleId: 's/x', lane: 's', claimedSeverity: 'low', reason: 'b' },
      { identity: 'sc|s|x|a.js', ruleId: 's/x', lane: 's', claimedSeverity: 'high', reason: 'b' },
      { identity: 'sc|s|x|a.js', ruleId: 's/x', lane: 's', claimedSeverity: 'high', reason: 'a' },
      { identity: 'sc|s|x|a.js', ruleId: 's/x', lane: 's', claimedSeverity: null, reason: 'z' },
    ]),
    notMeasured: order([{ lane: 'deps-osv', reason: 'timed out' }, { lane: 'deps-osv', reason: 'no network' }]),
  });
  const forward = buildRemediation(rows((xs) => xs));
  assert.equal(JSON.stringify(buildRemediation(rows((xs) => [...xs].reverse()))), JSON.stringify(forward));
  assert.deepEqual(forward.undetermined.map((u) => [u.claimedSeverity, u.reason]), [[null, 'z'], ['high', 'a'], ['high', 'b'], ['low', 'b']]);
  assert.deepEqual(forward.notMeasured.map((n) => n.reason), ['no network', 'timed out']);
});

test('a document with one finding per verification status validates', () => {
  const d = doc([
    finding({ identity: 'sc|sastSemgrep|b|src/b.js', candidates: [candidate({
      tier: 'llm', cached: false,
      provenance: { tool: 'ollama', model: 'qwen2.5-coder:7b', version: '1.9' },
      verification: { status: 'unverified', witness: { lanes: [], before: 0, after: null, digest: null },
        newFindings: [], tests: { command: null, status: 'notDeclared' }, reason: null },
    })] }),
    finding({ identity: 'sc|sastGitleaks|a|src/a.js', ruleId: 'sastGitleaks/a' }),
    finding({ identity: 'sc|sastGitleaks|c|src/c.js', ruleId: 'sastGitleaks/c', candidates: [candidate({
      tier: 'rule', patch: null,
      verification: { status: 'undetermined', witness: { lanes: ['sastGitleaks'], before: 1, after: null, digest: null },
        newFindings: [], tests: { command: 'node --test', status: 'notRun' }, reason: 'the scanner binary was absent at re-run time' },
    })] }),
    finding({ identity: 'f|osv|GHSA-0001-0001|left-pad|package.json', ruleId: 'deps/GHSA-0001-0001', lane: 'deps-osv',
      file: 'package.json', severity: 'crit', actions: [{ kind: 'bump-dependency', text: 'bump left-pad to 1.3.0' }],
      candidates: [candidate({
        tier: 'codemod', cached: false,
        verification: { status: 'failed', witness: { lanes: ['deps-osv'], before: 1, after: 1, digest: null },
          newFindings: [], tests: { command: null, status: 'notRun' }, reason: 'the advisory still matches the pinned version' },
      })] }),
  ]);
  assert.deepEqual(d.findings.map((f) => f.identity), [
    'f|osv|GHSA-0001-0001|left-pad|package.json',
    'sc|sastGitleaks|a|src/a.js',
    'sc|sastGitleaks|c|src/c.js',
    'sc|sastSemgrep|b|src/b.js',
  ], 'findings are sorted by identity, then occurrence');
  assert.deepEqual(validateRemediation(d).errors, []);
});

test('buildRemediation computes ids when absent and keeps the ids it is given', () => {
  assert.equal(cand(doc()).id, candidateId({ identity: ID, tier: 'deterministic', patch: PATCH }));
  const given = '0123456789abcdef';
  const d = buildRemediation({ repository: 'org/repo', commit: null, generatedAt: AT, toolVersion: '0.6.174',
    findings: [finding({ candidates: [candidate({ id: given })] })] });
  assert.equal(cand(d).id, given);
});

// Keys in reverse-alphabetical order and every array reversed: the same content in a different
// shape must still serialize to the same bytes.
const shuffled = (v) => {
  if (Array.isArray(v)) return v.map(shuffled).reverse();
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().reverse().map((k) => [k, shuffled(v[k])]));
  }
  return v;
};

test('buildRemediation gives byte-identical output for a shuffled copy of the same input', () => {
  const input = {
    repository: 'org/repo', commit: 'b'.repeat(40), generatedAt: AT, toolVersion: '0.6.174',
    findings: [
      finding({ identity: 'sc|sastGitleaks|a|src/a.js', ruleId: 'sastGitleaks/a',
        actions: [{ kind: 'other', text: 'second action' }, { kind: 'rotate-secret', text: 'first action' }],
        candidates: [
          candidate({ tier: 'llm', cached: false, verification: { status: 'failed',
            witness: { lanes: ['deps-osv', 'sastGitleaks'], before: 2, after: 1, digest: null },
            newFindings: ['sc|sastSemgrep|z|src/z.js', 'sc|sastSemgrep|a|src/a.js'],
            tests: { command: 'node --test', status: 'failed' }, reason: 'still reported after the patch' } }),
          candidate({ tier: 'deterministic' }),
        ] }),
      finding({ identity: 'sc|sastGitleaks|a|src/a.js', ruleId: 'sastGitleaks/a', occurrence: 1, candidates: [candidate({ tier: 'codemod' })] }),
    ],
    undetermined: [
      { identity: 'sc|sastSemgrep|y|src/y.js', ruleId: 'sastSemgrep/y', lane: 'sastSemgrep', claimedSeverity: null, reason: 'second' },
      { identity: 'sc|sastSemgrep|x|src/x.js', ruleId: 'sastSemgrep/x', lane: 'sastSemgrep', claimedSeverity: 'low', reason: 'first' },
    ],
    notMeasured: [
      { lane: 'sastCodeql', reason: 'the database was absent' },
      { lane: 'deps-osv', reason: 'no network' },
    ],
  };
  const a = JSON.stringify(buildRemediation(input));
  const b = JSON.stringify(buildRemediation(shuffled(structuredClone(input))));
  assert.equal(b, a);
});

test('buildRemediation does not mutate its input', () => {
  const input = {
    repository: 'org/repo', commit: null, generatedAt: AT, toolVersion: '0.6.174',
    findings: [finding()], undetermined: [], notMeasured: [],
  };
  const before = structuredClone(input);
  const out = buildRemediation(input);
  assert.deepEqual(input, before);
  assert.notEqual(out.findings[0], input.findings[0]);
  assert.notEqual(out.findings[0].candidates[0], input.findings[0].candidates[0]);
  assert.equal('id' in input.findings[0].candidates[0], false, 'the computed id was written back into the input');
});

test('chosenCandidate takes the verified deterministic candidate over a verified llm one', () => {
  const f = finding({ candidates: [
    candidate({ tier: 'llm', cached: false, provenance: { tool: 'ollama', model: 'm', version: null } }),
    candidate({ tier: 'deterministic' }),
  ] });
  for (const c of f.candidates) c.id = candidateId({ identity: f.identity, tier: c.tier, patch: c.patch });
  const chosen = chosenCandidate(f);
  assert.equal(chosen.tier, 'deterministic');
  assert.equal(chosen.id, candidateId({ identity: f.identity, tier: 'deterministic', patch: PATCH }));
  assert.equal(chosenCandidate(finding({ candidates: [candidate({
    verification: { status: 'failed', witness: { lanes: ['sastGitleaks'], before: 1, after: 1, digest: null },
      newFindings: [], tests: { command: null, status: 'notRun' }, reason: 'still reported' } })] })), null);
  assert.equal(chosenCandidate(finding({ candidates: [] })), null);
  assert.equal(chosenCandidate({}), null);
});

test('the schema rejects a line on a finding', () => {
  const bad = doc();
  bad.findings[0].line = 12;
  assert.deepEqual(validateRemediation(bad).errors,
    ["findings[0]: unknown key 'line' (additionalProperties: false)"]);
});

test('validateRemediation refuses a document that is not even an object', () => {
  assert.deepEqual(validateRemediation(null).errors, ['(root): expected object, got null']);
});

// ── the status rules, one failing case each ─────────────────────────────────────────────────────

test('verified requires a non-null patch', () => {
  const d = doc();
  cand(d).patch = null;
  cand(d).id = candidateId({ identity: d.findings[0].identity, tier: cand(d).tier, patch: null });
  assert.deepEqual(validateRemediation(d).errors, [
    `${at(d)}status "verified" requires a non-null patch`,
    `${at(d)}a candidate with a null patch can only be "unverified" or "undetermined", not "verified"`,
  ]);
});

test('verified requires witness.lanes to name the lane(s) that re-ran', () => {
  const d = doc();
  cand(d).verification.witness.lanes = [];
  assert.deepEqual(validateRemediation(d).errors,
    [`${at(d)}status "verified" requires witness.lanes to name the lane(s) that re-ran`]);
});

test('verified requires witness.before > 0', () => {
  const d = doc();
  cand(d).verification.witness.before = 0;
  assert.deepEqual(validateRemediation(d).errors,
    [`${at(d)}status "verified" requires witness.before > 0`]);
});

test('verified requires witness.after to be 0', () => {
  const d = doc();
  cand(d).verification.witness.after = 1;
  assert.deepEqual(validateRemediation(d).errors,
    [`${at(d)}status "verified" requires witness.after to be 0`]);
});

test('verified requires newFindings to be empty', () => {
  const d = doc();
  cand(d).verification.newFindings = ['sc|sastSemgrep|z|src/z.js'];
  assert.deepEqual(validateRemediation(d).errors,
    [`${at(d)}status "verified" requires newFindings to be empty`]);
});

test('verified requires tests.status "passed" or "notDeclared"', () => {
  const d = doc();
  cand(d).verification.tests.status = 'failed';
  assert.deepEqual(validateRemediation(d).errors,
    [`${at(d)}status "verified" requires tests.status "passed" or "notDeclared", not "failed"`]);
});

test('verified refuses tests.status "notRun"', () => {
  const d = doc();
  cand(d).verification.tests.status = 'notRun';
  assert.deepEqual(validateRemediation(d).errors,
    [`${at(d)}status "verified" requires tests.status "passed" or "notDeclared", not "notRun"`]);
});

test('failed requires a non-empty reason', () => {
  const d = doc();
  cand(d).verification = { status: 'failed', witness: { lanes: ['sastGitleaks'], before: 1, after: 1, digest: null },
    newFindings: [], tests: { command: null, status: 'notRun' }, reason: null };
  assert.deepEqual(validateRemediation(d).errors,
    [`${at(d)}status "failed" requires a non-empty reason`]);
});

test('failed needs evidence: after > 0, a non-empty newFindings, or tests.status "failed"', () => {
  const d = doc();
  cand(d).verification = { status: 'failed', witness: { lanes: ['sastGitleaks'], before: 1, after: 0, digest: null },
    newFindings: [], tests: { command: 'node --test', status: 'notRun' }, reason: 'the lane says the fix held' };
  assert.deepEqual(validateRemediation(d).errors,
    [`${at(d)}status "failed" needs evidence: witness.after > 0, a non-empty newFindings, or tests.status "failed"`]);
});

test('undetermined requires a non-empty reason', () => {
  const d = doc();
  cand(d).verification = { status: 'undetermined', witness: { lanes: ['sastGitleaks'], before: 1, after: null, digest: null },
    newFindings: [], tests: { command: null, status: 'notRun' }, reason: null };
  assert.deepEqual(validateRemediation(d).errors,
    [`${at(d)}status "undetermined" requires a non-empty reason`]);
});

test('undetermined requires witness.after to be null', () => {
  const d = doc();
  cand(d).verification = { status: 'undetermined', witness: { lanes: ['sastGitleaks'], before: 1, after: 0, digest: null },
    newFindings: [], tests: { command: 'node --test', status: 'notRun' }, reason: 'the re-run was cut short' };
  assert.deepEqual(validateRemediation(d).errors,
    [`${at(d)}status "undetermined" requires witness.after to be null`]);
});

test('unverified means verification was never attempted: no lanes and a null after', () => {
  const d = doc();
  cand(d).verification = { status: 'unverified', witness: { lanes: ['sastGitleaks'], before: 0, after: null, digest: null },
    newFindings: [], tests: { command: null, status: 'notDeclared' }, reason: null };
  assert.deepEqual(validateRemediation(d).errors,
    [`${at(d)}status "unverified" means verification was never attempted: witness.lanes must be empty and witness.after null`]);
});

test('unverified refuses a witness.after that is set', () => {
  const d = doc();
  cand(d).verification = { status: 'unverified', witness: { lanes: [], before: 0, after: 0, digest: null },
    newFindings: [], tests: { command: null, status: 'notRun' }, reason: null };
  assert.deepEqual(validateRemediation(d).errors,
    [`${at(d)}status "unverified" means verification was never attempted: witness.lanes must be empty and witness.after null`]);
});

test('a candidate with a null patch can only be unverified or undetermined', () => {
  const d = doc();
  cand(d).patch = null;
  cand(d).id = candidateId({ identity: d.findings[0].identity, tier: cand(d).tier, patch: null });
  cand(d).verification = { status: 'failed', witness: { lanes: ['sastGitleaks'], before: 1, after: 1, digest: null },
    newFindings: [], tests: { command: null, status: 'notRun' }, reason: 'still reported' };
  assert.deepEqual(validateRemediation(d).errors,
    [`${at(d)}a candidate with a null patch can only be "unverified" or "undetermined", not "failed"`]);
});

test('an identity must start with sc| or f|', () => {
  const d = doc();
  d.findings[0].identity = 'x|nope';
  cand(d).id = candidateId({ identity: 'x|nope', tier: cand(d).tier, patch: PATCH });
  assert.deepEqual(validateRemediation(d).errors, [
    'findings[0].identity: "x|nope" does not match ^(sc|f)\\|',
    'finding x|nope: identity must start with "sc|" or "f|"',
  ]);
});

test('two findings may not share both identity and occurrence', () => {
  const d = buildRemediation({ repository: 'org/repo', commit: null, generatedAt: AT, toolVersion: '0.6.174',
    findings: [finding(), finding({ ruleId: 'sastGitleaks/generic-api-key-again' })] });
  assert.deepEqual(validateRemediation(d).errors, [
    `finding ${ID} occurrence 0: identity and occurrence are already used by findings[0]`,
  ]);
});

test('a candidate id that is not the sha256 over identity, tier and patch is refused', () => {
  const d = doc();
  cand(d).id = 'ffffffffffffffff';
  assert.deepEqual(validateRemediation(d).errors, [
    `${at(d)}id is ffffffffffffffff, but sha256 over identity, tier and patch gives ${candidateId({ identity: ID, tier: 'deterministic', patch: PATCH })}`,
  ]);
});
