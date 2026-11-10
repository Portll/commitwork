// composeIssuePrompt builds a formatted triage prompt string (monitor/issue-prompt.mjs composeIssuePrompt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeIssuePrompt } from '../issue-prompt.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('returns prompt with source unavailable when file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'composeIssuePrompt-'));
  try {
    const issue = {
      anchor: { file: 'missing.js', line: 5 },
      severity: 'high',
      source: { tool: 'test-tool' },
    };
    const result = composeIssuePrompt(issue, { root: dir });
    assert.equal(result, "You are triaging one static-analysis finding in a zero-dependency Node.js codebase.\nRule: (unnamed)   Severity: high   Scanner: test-tool\nLocation: missing.js:5\n(source unavailable)\nAnswer in this exact shape. Put VERDICT on the FIRST line, before any reasoning:\nVERDICT: one of real-vulnerability | needs-context | false-positive | already-mitigated\nCONFIDENCE: high | medium | low\nWHY: two sentences, naming the source->sink path if there is one.\nFIX: the concrete change, or \"none needed\" \u2014 a diff-shaped suggestion if you can.\nBe honest about uncertainty. Saying \"needs-context\" is more useful than a confident guess:\nthis goes into an audit trail a human reads, and a wrong confident answer costs more than\nan admitted unknown.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns prompt with source excerpt when file exists and line is valid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'composeIssuePrompt-'));
  try {
    const filePath = join(dir, 'example.js');
    const content = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');
    writeFileSync(filePath, content, 'utf8');
    const issue = {
      anchor: { file: 'example.js', line: 3 },
      severity: 'medium',
      source: { tool: 'test-tool', rule: 'no-eval' },
    };
    const result = composeIssuePrompt(issue, { root: dir });
    assert.equal(result, "You are triaging one static-analysis finding in a zero-dependency Node.js codebase.\nRule: no-eval   Severity: medium   Scanner: test-tool\nLocation: example.js:3\nSource (the flagged line is marked >>):\n```js\n1   line1\n2   line2\n3 >> line3\n4   line4\n5   line5\n6   line6\n7   line7\n8   line8\n9   line9\n10   line10\n```\nAnswer in this exact shape. Put VERDICT on the FIRST line, before any reasoning:\nVERDICT: one of real-vulnerability | needs-context | false-positive | already-mitigated\nCONFIDENCE: high | medium | low\nWHY: two sentences, naming the source->sink path if there is one.\nFIX: the concrete change, or \"none needed\" \u2014 a diff-shaped suggestion if you can.\nBe honest about uncertainty. Saying \"needs-context\" is more useful than a confident guess:\nthis goes into an audit trail a human reads, and a wrong confident answer costs more than\nan admitted unknown.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes scanner message when issue.body is provided', () => {
  const dir = mkdtempSync(join(tmpdir(), 'composeIssuePrompt-'));
  try {
    const issue = {
      anchor: { file: 'nonexistent.js', line: 1 },
      severity: 'low',
      body: 'Unexpected token',
      source: { tool: 'linter' },
    };
    const result = composeIssuePrompt(issue, { root: dir });
    assert.equal(result, "You are triaging one static-analysis finding in a zero-dependency Node.js codebase.\nRule: (unnamed)   Severity: low   Scanner: linter\nLocation: nonexistent.js:1\nScanner message: Unexpected token\n(source unavailable)\nAnswer in this exact shape. Put VERDICT on the FIRST line, before any reasoning:\nVERDICT: one of real-vulnerability | needs-context | false-positive | already-mitigated\nCONFIDENCE: high | medium | low\nWHY: two sentences, naming the source->sink path if there is one.\nFIX: the concrete change, or \"none needed\" \u2014 a diff-shaped suggestion if you can.\nBe honest about uncertainty. Saying \"needs-context\" is more useful than a confident guess:\nthis goes into an audit trail a human reads, and a wrong confident answer costs more than\nan admitted unknown.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles missing anchor gracefully', () => {
  const dir = mkdtempSync(join(tmpdir(), 'composeIssuePrompt-'));
  try {
    const issue = {
      severity: 'high',
      source: { tool: 'scanner', rule: 'no-debugger' },
    };
    const result = composeIssuePrompt(issue, { root: dir });
    assert.equal(result, "You are triaging one static-analysis finding in a zero-dependency Node.js codebase.\nRule: no-debugger   Severity: high   Scanner: scanner\nLocation: (no location recorded)\n(source unavailable)\nAnswer in this exact shape. Put VERDICT on the FIRST line, before any reasoning:\nVERDICT: one of real-vulnerability | needs-context | false-positive | already-mitigated\nCONFIDENCE: high | medium | low\nWHY: two sentences, naming the source->sink path if there is one.\nFIX: the concrete change, or \"none needed\" \u2014 a diff-shaped suggestion if you can.\nBe honest about uncertainty. Saying \"needs-context\" is more useful than a confident guess:\nthis goes into an audit trail a human reads, and a wrong confident answer costs more than\nan admitted unknown.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses unnamed rule when source.rule is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'composeIssuePrompt-'));
  try {
    const issue = {
      anchor: { file: 'file.js', line: 1 },
      severity: 'high',
      source: { tool: 'scanner' },
    };
    const result = composeIssuePrompt(issue, { root: dir });
    assert.equal(result, "You are triaging one static-analysis finding in a zero-dependency Node.js codebase.\nRule: (unnamed)   Severity: high   Scanner: scanner\nLocation: file.js:1\n(source unavailable)\nAnswer in this exact shape. Put VERDICT on the FIRST line, before any reasoning:\nVERDICT: one of real-vulnerability | needs-context | false-positive | already-mitigated\nCONFIDENCE: high | medium | low\nWHY: two sentences, naming the source->sink path if there is one.\nFIX: the concrete change, or \"none needed\" \u2014 a diff-shaped suggestion if you can.\nBe honest about uncertainty. Saying \"needs-context\" is more useful than a confident guess:\nthis goes into an audit trail a human reads, and a wrong confident answer costs more than\nan admitted unknown.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles invalid line number (zero) resulting in source unavailable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'composeIssuePrompt-'));
  try {
    const filePath = join(dir, 'valid.js');
    writeFileSync(filePath, 'a\nb\nc', 'utf8');
    const issue = {
      anchor: { file: 'valid.js', line: 0 },
      severity: 'high',
      source: { tool: 'scanner', rule: 'no-console' },
    };
    const result = composeIssuePrompt(issue, { root: dir });
    assert.equal(result, "You are triaging one static-analysis finding in a zero-dependency Node.js codebase.\nRule: no-console   Severity: high   Scanner: scanner\nLocation: valid.js:0\n(source unavailable)\nAnswer in this exact shape. Put VERDICT on the FIRST line, before any reasoning:\nVERDICT: one of real-vulnerability | needs-context | false-positive | already-mitigated\nCONFIDENCE: high | medium | low\nWHY: two sentences, naming the source->sink path if there is one.\nFIX: the concrete change, or \"none needed\" \u2014 a diff-shaped suggestion if you can.\nBe honest about uncertainty. Saying \"needs-context\" is more useful than a confident guess:\nthis goes into an audit trail a human reads, and a wrong confident answer costs more than\nan admitted unknown.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
