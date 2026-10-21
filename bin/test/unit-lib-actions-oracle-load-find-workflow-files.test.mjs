// Finds GitHub workflow files under given roots (bin/lib/actions-oracle-load.mjs findWorkflowFiles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findWorkflowFiles } from '../lib/actions-oracle-load.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('returns empty array when roots is empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'findWorkflowFiles-'));
  try {
    assert.deepEqual(findWorkflowFiles([]), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when root does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'findWorkflowFiles-'));
  try {
    const missing = path.join(dir, 'no-such-repo');
    assert.deepEqual(findWorkflowFiles([missing]), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when root exists but has no workflows directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'findWorkflowFiles-'));
  try {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    assert.deepEqual(findWorkflowFiles([repo]), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('finds workflow files directly in .github/workflows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'findWorkflowFiles-'));
  try {
    const repo = path.join(dir, 'repo');
    const wfDir = path.join(repo, '.github', 'workflows');
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'ci.yml'), 'jobs: {}');
    fs.writeFileSync(path.join(wfDir, 'deploy.yaml'), 'jobs: {}');
    fs.writeFileSync(path.join(wfDir, 'readme.txt'), 'not a workflow');
    const result = findWorkflowFiles([repo]);
    assert.deepEqual(result, [
      path.join(wfDir, 'ci.yml'),
      path.join(wfDir, 'deploy.yaml')
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('finds workflow files one level deep in subdirectories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'findWorkflowFiles-'));
  try {
    const repo = path.join(dir, 'repo');
    const subWfDir = path.join(repo, 'sub', '.github', 'workflows');
    fs.mkdirSync(subWfDir, { recursive: true });
    fs.writeFileSync(path.join(subWfDir, 'build.yml'), 'jobs: {}');
    const result = findWorkflowFiles([repo]);
    assert.deepEqual(result, [path.join(subWfDir, 'build.yml')]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('finds workflow files two levels deep in subdirectories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'findWorkflowFiles-'));
  try {
    const repo = path.join(dir, 'repo');
    const deepWfDir = path.join(repo, 'a', 'b', '.github', 'workflows');
    fs.mkdirSync(deepWfDir, { recursive: true });
    fs.writeFileSync(path.join(deepWfDir, 'test.yaml'), 'jobs: {}');
    const result = findWorkflowFiles([repo]);
    assert.deepEqual(result, [path.join(deepWfDir, 'test.yaml')]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('does not find workflow files three levels deep', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'findWorkflowFiles-'));
  try {
    const repo = path.join(dir, 'repo');
    const deepWfDir = path.join(repo, 'a', 'b', 'c', '.github', 'workflows');
    fs.mkdirSync(deepWfDir, { recursive: true });
    fs.writeFileSync(path.join(deepWfDir, 'deep.yml'), 'jobs: {}');
    const result = findWorkflowFiles([repo]);
    assert.deepEqual(result, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skips .git and node_modules directories during walk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'findWorkflowFiles-'));
  try {
    const repo = path.join(dir, 'repo');
    const gitWfDir = path.join(repo, '.git', '.github', 'workflows');
    const nmWfDir = path.join(repo, 'node_modules', '.github', 'workflows');
    fs.mkdirSync(gitWfDir, { recursive: true });
    fs.mkdirSync(nmWfDir, { recursive: true });
    fs.writeFileSync(path.join(gitWfDir, 'git.yml'), 'jobs: {}');
    fs.writeFileSync(path.join(nmWfDir, 'nm.yml'), 'jobs: {}');
    const result = findWorkflowFiles([repo]);
    assert.deepEqual(result, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deduplicates workflow files when same path appears from multiple roots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'findWorkflowFiles-'));
  try {
    const repo = path.join(dir, 'repo');
    const wfDir = path.join(repo, '.github', 'workflows');
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'ci.yml'), 'jobs: {}');
    const result = findWorkflowFiles([repo, repo]);
    assert.deepEqual(result, [path.join(wfDir, 'ci.yml')]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('returns sorted unique results across multiple roots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'findWorkflowFiles-'));
  try {
    const repo1 = path.join(dir, 'repo1');
    const repo2 = path.join(dir, 'repo2');
    const wf1 = path.join(repo1, '.github', 'workflows');
    const wf2 = path.join(repo2, '.github', 'workflows');
    fs.mkdirSync(wf1, { recursive: true });
    fs.mkdirSync(wf2, { recursive: true });
    fs.writeFileSync(path.join(wf1, 'zeta.yml'), 'jobs: {}');
    fs.writeFileSync(path.join(wf2, 'alpha.yml'), 'jobs: {}');
    const result = findWorkflowFiles([repo1, repo2]);
    assert.deepEqual(result, [
      path.join(wf1, 'zeta.yml'),
      path.join(wf2, 'alpha.yml')
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
