// Extracts semgrep rule ids from yaml files in a directory tree (bin/upstream-fetch.mjs extractSemgrepRuleIds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSemgrepRuleIds } from '../upstream-fetch.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('returns sorted unique ids from a single yaml file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractSemgrepRuleIds-'));
  try {
    writeFileSync(join(dir, 'rules.yaml'), '- id: rule-b\n- id: rule-a\n- id: rule-b\n');
    assert.deepEqual(extractSemgrepRuleIds(dir), ["rule-a", "rule-b"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when directory has no yaml files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractSemgrepRuleIds-'));
  try {
    writeFileSync(join(dir, 'readme.txt'), 'no rules here\n');
    assert.deepEqual(extractSemgrepRuleIds(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collects ids from nested subdirectories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractSemgrepRuleIds-'));
  try {
    const sub = join(dir, 'nested');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(dir, 'top.yaml'), '- id: top-rule\n');
    writeFileSync(join(sub, 'deep.yaml'), '- id: deep-rule\n');
    assert.deepEqual(extractSemgrepRuleIds(dir), ["deep-rule", "top-rule"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores lines that do not match the id pattern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractSemgrepRuleIds-'));
  try {
    writeFileSync(join(dir, 'mixed.yaml'), 'rules:\n  - id: valid-rule\n  - name: not-an-id\n  - id: another\n');
    assert.deepEqual(extractSemgrepRuleIds(dir), ["another", "valid-rule"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles yaml files with uppercase extension', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractSemgrepRuleIds-'));
  try {
    writeFileSync(join(dir, 'rules.YAML'), '- id: upper-rule\n');
    assert.deepEqual(extractSemgrepRuleIds(dir), ["upper-rule"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deduplicates identical ids across multiple files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractSemgrepRuleIds-'));
  try {
    writeFileSync(join(dir, 'a.yaml'), '- id: shared\n- id: only-a\n');
    writeFileSync(join(dir, 'b.yaml'), '- id: shared\n- id: only-b\n');
    assert.deepEqual(extractSemgrepRuleIds(dir), ["only-a", "only-b", "shared"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array for an empty directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractSemgrepRuleIds-'));
  try {
    assert.deepEqual(extractSemgrepRuleIds(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extracts id with leading whitespace before dash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extractSemgrepRuleIds-'));
  try {
    writeFileSync(join(dir, 'indented.yaml'), '  - id: indented-rule\n');
    assert.deepEqual(extractSemgrepRuleIds(dir), ["indented-rule"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
