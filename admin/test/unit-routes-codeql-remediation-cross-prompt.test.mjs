// Builds the cross-examination prompt for two agents (admin/routes/codeql-remediation.mjs crossPrompt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossPrompt } from '../routes/codeql-remediation.mjs';

test('includes agent identities in the opening instruction', () => {
  const finding = {
    message: 'SQL injection',
    service: 'api',
    ruleId: 'js/sql-injection',
    ruleName: 'SQL Injection',
    severity: 'error',
    securitySeverity: 9.8,
    file: 'src/db.js',
    line: 42,
    sarif: 'scan.sarif',
  };
  const ctx = { text: 'const q = "SELECT * FROM users WHERE id = " + id;', note: 'truncated' };
  const own = { classification: 'real', agreesWithPeer: false, positionChanged: false, response: 'I disagree', remediation: 'Fix it', diff: '', confidence: 'high' };
  const peer = { classification: 'false-positive', agreesWithPeer: false, positionChanged: false, response: 'I agree', remediation: 'No change', diff: '', confidence: 'medium' };

  const result = crossPrompt(finding, ctx, own, peer, 'alpha', 'beta');

  assert.ok(result.includes('You are agent alpha.'));
  assert.ok(result.includes('You and agent beta independently analyzed the same CodeQL finding.'));
  assert.ok(result.includes('Analyze the other agent\'s findings, then re-analyze YOUR OWN in light of them:'));
});

test('includes the finding block with all fields', () => {
  const finding = {
    message: 'SQL injection',
    service: 'api',
    ruleId: 'js/sql-injection',
    ruleName: 'SQL Injection',
    severity: 'error',
    securitySeverity: 9.8,
    file: 'src/db.js',
    line: 42,
    sarif: 'scan.sarif',
  };
  const ctx = { text: 'const q = "SELECT * FROM users WHERE id = " + id;', note: 'truncated' };
  const own = { classification: 'real', agreesWithPeer: false, positionChanged: false, response: 'I disagree', remediation: 'Fix it', diff: '', confidence: 'high' };
  const peer = { classification: 'false-positive', agreesWithPeer: false, positionChanged: false, response: 'I agree', remediation: 'No change', diff: '', confidence: 'medium' };

  const result = crossPrompt(finding, ctx, own, peer, 'alpha', 'beta');

  assert.ok(result.includes('# CodeQL finding'));
  assert.ok(result.includes('- repo/service: api'));
  assert.ok(result.includes('- rule: js/sql-injection (SQL Injection)'));
  assert.ok(result.includes('- severity: error (security-severity 9.8)'));
  assert.ok(result.includes('- file: src/db.js'));
  assert.ok(result.includes('- line AT SCAN TIME: 42'));
  assert.ok(result.includes('- source SARIF: scan.sarif'));
  assert.ok(result.includes('message: SQL injection'));
  assert.ok(result.includes('source context (current working tree \u2014 may differ from the scanned commit; truncated):'));
  assert.ok(result.includes('const q = "SELECT * FROM users WHERE id = " + id;'));
});

test('handles missing ruleName and securitySeverity', () => {
  const finding = {
    message: 'XSS',
    service: 'web',
    ruleId: 'js/xss',
    severity: 'warning',
    file: 'src/view.js',
    line: 10,
    sarif: 'scan.sarif',
  };
  const ctx = { text: 'el.innerHTML = userInput;', note: 'full' };
  const own = { classification: 'needs-human', agreesWithPeer: true, positionChanged: true, response: 'Changed mind', remediation: 'Review', diff: '', confidence: 'low' };
  const peer = { classification: 'real', agreesWithPeer: true, positionChanged: false, response: 'Agree', remediation: 'Sanitize', diff: '', confidence: 'high' };

  const result = crossPrompt(finding, ctx, own, peer, 'gamma', 'delta');

  assert.ok(result.includes('- rule: js/xss'));
  assert.ok(!result.includes('(SQL Injection)'));
  assert.ok(result.includes('- severity: warning'));
  assert.ok(!result.includes('(security-severity'));
});

test('handles missing line as unknown', () => {
  const finding = {
    message: 'Path traversal',
    service: 'fs',
    ruleId: 'js/path-traversal',
    ruleName: 'Path Traversal',
    severity: 'error',
    securitySeverity: 8.5,
    file: 'src/fs.js',
    sarif: 'scan.sarif',
  };
  const ctx = { text: 'readFileSync(path)', note: 'truncated' };
  const own = { classification: 'real', agreesWithPeer: false, positionChanged: false, response: 'Disagree', remediation: 'Validate path', diff: '', confidence: 'medium' };
  const peer = { classification: 'false-positive', agreesWithPeer: false, positionChanged: false, response: 'Agree', remediation: 'No change', diff: '', confidence: 'low' };

  const result = crossPrompt(finding, ctx, own, peer, 'alpha', 'beta');

  assert.ok(result.includes('- line AT SCAN TIME: unknown'));
});

test('handles null ctx text with note', () => {
  const finding = {
    message: 'Command injection',
    service: 'shell',
    ruleId: 'js/command-injection',
    ruleName: 'Command Injection',
    severity: 'error',
    securitySeverity: 9.1,
    file: 'src/exec.js',
    line: 7,
    sarif: 'scan.sarif',
  };
  const ctx = { text: null, note: 'file not found in working tree' };
  const own = { classification: 'real', agreesWithPeer: false, positionChanged: false, response: 'Disagree', remediation: 'Sanitize input', diff: '', confidence: 'high' };
  const peer = { classification: 'needs-human', agreesWithPeer: false, positionChanged: false, response: 'Uncertain', remediation: 'Manual review', diff: '', confidence: 'low' };

  const result = crossPrompt(finding, ctx, own, peer, 'alpha', 'beta');

  assert.ok(result.includes('source context NOT AVAILABLE: file not found in working tree. Reason from the finding alone and say that you did.'));
});

test('includes peer verdict as formatted JSON', () => {
  const finding = {
    message: 'Test finding',
    service: 'test',
    ruleId: 'test/rule',
    severity: 'warning',
    file: 'test.js',
    line: 1,
    sarif: 'test.sarif',
  };
  const ctx = { text: 'code here', note: 'ok' };
  const own = { classification: 'real', agreesWithPeer: false, positionChanged: false, response: 'own response', remediation: 'own fix', diff: 'own diff', confidence: 'high' };
  const peer = { classification: 'false-positive', agreesWithPeer: true, positionChanged: true, response: 'peer response', remediation: 'peer fix', diff: 'peer diff', confidence: 'medium' };

  const result = crossPrompt(finding, ctx, own, peer, 'alpha', 'beta');

  assert.ok(result.includes('# The other agent\'s (beta) verdict'));
  assert.ok(result.includes(JSON.stringify(peer, null, 2)));
});

test('includes own verdict as formatted JSON', () => {
  const finding = {
    message: 'Test finding',
    service: 'test',
    ruleId: 'test/rule',
    severity: 'warning',
    file: 'test.js',
    line: 1,
    sarif: 'test.sarif',
  };
  const ctx = { text: 'code here', note: 'ok' };
  const own = { classification: 'real', agreesWithPeer: false, positionChanged: false, response: 'own response', remediation: 'own fix', diff: 'own diff', confidence: 'high' };
  const peer = { classification: 'false-positive', agreesWithPeer: true, positionChanged: true, response: 'peer response', remediation: 'peer fix', diff: 'peer diff', confidence: 'medium' };

  const result = crossPrompt(finding, ctx, own, peer, 'alpha', 'beta');

  assert.ok(result.includes('# Your (alpha) original verdict'));
  assert.ok(result.includes(JSON.stringify(own, null, 2)));
});

test('includes output rules and verdict fields', () => {
  const finding = {
    message: 'Test finding',
    service: 'test',
    ruleId: 'test/rule',
    severity: 'warning',
    file: 'test.js',
    line: 1,
    sarif: 'test.sarif',
  };
  const ctx = { text: 'code here', note: 'ok' };
  const own = { classification: 'real', agreesWithPeer: false, positionChanged: false, response: 'own response', remediation: 'own fix', diff: 'own diff', confidence: 'high' };
  const peer = { classification: 'false-positive', agreesWithPeer: true, positionChanged: true, response: 'peer response', remediation: 'peer fix', diff: 'peer diff', confidence: 'medium' };

  const result = crossPrompt(finding, ctx, own, peer, 'alpha', 'beta');

  assert.ok(result.includes('# How your output must READ'));
  assert.ok(result.includes('COMMENTS IN THE DIFF:'));
  assert.ok(result.includes('THE `remediation` FIELD:'));
  assert.ok(result.includes('Respond ONLY with a JSON object:'));
  assert.ok(result.includes('"classification": "real"|"false-positive"|"needs-human"'));
  assert.ok(result.includes('"agreesWithPeer": boolean'));
  assert.ok(result.includes('"positionChanged": boolean'));
  assert.ok(result.includes('"response": string'));
  assert.ok(result.includes('"remediation": string'));
  assert.ok(result.includes('"diff": string'));
  assert.ok(result.includes('"confidence": "low"|"medium"|"high"'));
});
