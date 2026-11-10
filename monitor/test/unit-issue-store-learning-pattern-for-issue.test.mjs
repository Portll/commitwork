// computes rule, path prefix and package for an issue (monitor/issue-store.mjs learningPatternForIssue)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learningPatternForIssue } from '../issue-store.mjs';

test('throws when issue is missing', () => {
  assert.throws(() => learningPatternForIssue(null), {
    name: 'Error',
    message: 'learning pattern requires an issue'
  });
});

test('returns explicit pattern when all fields are valid', () => {
  const explicit = { rule: '  myRule  ', pathPrefix: '  src/  ', package: 'myPkg' };
  assert.deepEqual(learningPatternForIssue({ source: {} }, explicit), { rule: "myRule", pathPrefix: "src/", package: "myPkg" });
});

test('throws when explicit rule is missing or empty', () => {
  const explicit = { rule: '   ', pathPrefix: 'pfx' };
  assert.throws(() => learningPatternForIssue({ source: {} }, explicit), {
    name: 'Error',
    message: 'learning pattern requires rule'
  });
});

test('throws when explicit pathPrefix is missing or empty', () => {
  const explicit = { rule: 'r', pathPrefix: '' };
  assert.throws(() => learningPatternForIssue({ source: {} }, explicit), {
    name: 'Error',
    message: 'learning pattern requires pathPrefix'
  });
});

test('throws when explicit package is not a string nor null', () => {
  const explicit = { rule: 'r', pathPrefix: 'p', package: 123 };
  assert.throws(() => learningPatternForIssue({ source: {} }, explicit), {
    name: 'Error',
    message: 'learning pattern package must be a string or null'
  });
});

test('derives pattern from f: source key with rule, package and file', () => {
  const iss = {
    source: { key: 'f:repo|myRule|sub|myPkg|src/file.js' },
    anchor: {}
  };
  assert.deepEqual(learningPatternForIssue(iss), { rule: "myRule/sub", pathPrefix: "src/", package: "myPkg" });
});

test('derives pattern from g: source key with rule and package', () => {
  const iss = {
    source: { key: 'g:myPkg', tool: 'npm' },
    anchor: {}
  };
  assert.deepEqual(learningPatternForIssue(iss), { rule: "npm/group", pathPrefix: "./", package: null });
});

test('derives pattern from sc: source key with rule and file', () => {
  const iss = {
    source: { key: 'sc:repo|ignore|myRule|src/file2.js', tool: 'eslint' },
    anchor: {}
  };
  assert.deepEqual(learningPatternForIssue(iss), { rule: "myRule", pathPrefix: "src/", package: null });
});

test('derives pattern from gs: source key with rule', () => {
  const iss = {
    source: { key: 'gs:repo|ignore|myRule', tool: 'eslint' },
    anchor: {}
  };
  assert.deepEqual(learningPatternForIssue(iss), { rule: "myRule", pathPrefix: "./", package: null });
});

test('fallback to default rule when no prefix matches', () => {
  const iss = {
    source: { key: 'unknown', tool: 'customTool', kind: 'customKind' },
    kind: 'feature',
    anchor: {}
  };
  assert.deepEqual(learningPatternForIssue(iss), { rule: "customTool/feature", pathPrefix: "./", package: null });
});
