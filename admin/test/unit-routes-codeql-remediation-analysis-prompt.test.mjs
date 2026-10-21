// Builds the dual-agent CodeQL analysis prompt (admin/routes/codeql-remediation.mjs analysisPrompt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisPrompt } from '../routes/codeql-remediation.mjs';

const baseFinding = {
  service: 'svc',
  ruleId: 'R1',
  ruleName: 'Rule One',
  severity: 'error',
  securitySeverity: 9.1,
  file: 'src/a.js',
  line: 10,
  sarif: 'scan.sarif',
  message: 'msg',
};

const baseCtx = { text: 'code', note: 'note' };

test('includes the agent identity in the opening line', () => {
  const out = analysisPrompt(baseFinding, baseCtx, 'agent-A');
  assert.ok(out.includes('You are one of two independent security agents (agent-A)'));
});

test('renders source context when ctx.text is present', () => {
  const out = analysisPrompt(baseFinding, baseCtx, 'agent-A');
  assert.ok(out.includes('source context (current working tree \u2014 may differ from the scanned commit; note):'));
  assert.ok(out.includes('code'));
});

test('renders source context unavailable when ctx.text is null', () => {
  const out = analysisPrompt(baseFinding, { text: null, note: 'no source' }, 'agent-A');
  assert.ok(out.includes('source context NOT AVAILABLE: no source. Reason from the finding alone and say that you did.'));
});

test('renders source context unavailable when ctx.text is undefined', () => {
  const out = analysisPrompt(baseFinding, { note: 'no source' }, 'agent-A');
  assert.ok(out.includes('source context NOT AVAILABLE: no source. Reason from the finding alone and say that you did.'));
});

test('omits rule name when ruleName is falsy', () => {
  const f = { ...baseFinding, ruleName: undefined };
  const out = analysisPrompt(f, baseCtx, 'agent-A');
  assert.ok(out.includes('- rule: R1\n'));
  assert.ok(!out.includes('(Rule One)'));
});

test('omits security severity when securitySeverity is null', () => {
  const f = { ...baseFinding, securitySeverity: null };
  const out = analysisPrompt(f, baseCtx, 'agent-A');
  assert.ok(out.includes('- severity: error\n'));
  assert.ok(!out.includes('(security-severity'));
});

test('renders line as unknown when line is undefined', () => {
  const f = { ...baseFinding, line: undefined };
  const out = analysisPrompt(f, baseCtx, 'agent-A');
  assert.ok(out.includes('- line AT SCAN TIME: unknown'));
});

test('includes the verdict fields instruction at the end', () => {
  const out = analysisPrompt(baseFinding, baseCtx, 'agent-A');
  assert.ok(out.includes('Respond ONLY with a JSON object:'));
  assert.ok(out.includes('"classification": "real"|"false-positive"|"needs-human"'));
});

test('includes the false-positive analysis task instruction', () => {
  const out = analysisPrompt(baseFinding, baseCtx, 'agent-A');
  assert.ok(out.includes('2. FALSE-POSITIVE ANALYSIS: make the explicit case for and against this being a false positive, and say which side wins and why.'));
});

test('includes the diff task instruction', () => {
  const out = analysisPrompt(baseFinding, baseCtx, 'agent-A');
  assert.ok(out.includes('4. DIFF: a minimal unified diff realising the remediation \u2014 repo-root relative, a/ b/ prefixes, must apply cleanly with `git apply`. Empty string when classification is false-positive or needs-human. Never invent suppression-file syntax; if suppression is the right call, say so in prose and leave the diff empty.'));
});
