// Resolves the actions oracle directory and imports its expressions and workflow-parser packages, or reports why they are absent (bin/lib/actions-oracle-load.mjs loadActionsOracle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadActionsOracle } from '../lib/actions-oracle-load.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('returns absent message when oracle directory does not exist', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadActionsOracle-'));
  try {
    const env = { CW_ACTIONS_ORACLE_DIR: path.join(dir, 'nonexistent') };
    const result = await loadActionsOracle(env);
    assert.equal(result.dir, path.join(dir, 'nonexistent'));
    assert.equal(result.absent, `No oracle installed at ${path.join(dir, 'nonexistent')} (ERR_MODULE_NOT_FOUND).`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('returns absent message when expressions package.json is missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadActionsOracle-'));
  try {
    const oracleDir = path.join(dir, 'oracle');
    const exprDist = path.join(oracleDir, 'node_modules', '@actions', 'expressions', 'dist');
    fs.mkdirSync(exprDist, { recursive: true });
    fs.writeFileSync(path.join(exprDist, 'index.js'), 'export {};\n');
    const wfDist = path.join(oracleDir, 'node_modules', '@actions', 'workflow-parser', 'dist');
    fs.mkdirSync(wfDist, { recursive: true });
    fs.writeFileSync(path.join(wfDist, 'index.js'), 'export {};\n');
    fs.writeFileSync(path.join(oracleDir, 'node_modules', '@actions', 'workflow-parser', 'package.json'), JSON.stringify({ name: '@actions/workflow-parser', version: '1.0.0' }));
    const env = { CW_ACTIONS_ORACLE_DIR: oracleDir };
    const result = await loadActionsOracle(env);
    assert.equal(result.dir, oracleDir);
    assert.equal(result.absent, `No oracle installed at ${oracleDir} (ENOENT).`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('returns absent message when workflow-parser package.json is missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadActionsOracle-'));
  try {
    const oracleDir = path.join(dir, 'oracle');
    const exprDist = path.join(oracleDir, 'node_modules', '@actions', 'expressions', 'dist');
    fs.mkdirSync(exprDist, { recursive: true });
    fs.writeFileSync(path.join(exprDist, 'index.js'), 'export {};\n');
    fs.writeFileSync(path.join(oracleDir, 'node_modules', '@actions', 'expressions', 'package.json'), JSON.stringify({ name: '@actions/expressions', version: '1.0.0' }));
    const wfDist = path.join(oracleDir, 'node_modules', '@actions', 'workflow-parser', 'dist');
    fs.mkdirSync(wfDist, { recursive: true });
    fs.writeFileSync(path.join(wfDist, 'index.js'), 'export {};\n');
    const env = { CW_ACTIONS_ORACLE_DIR: oracleDir };
    const result = await loadActionsOracle(env);
    assert.equal(result.dir, oracleDir);
    assert.equal(result.absent, `No oracle installed at ${oracleDir} (ENOENT).`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('returns loaded oracle with versions when all files exist', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadActionsOracle-'));
  try {
    const oracleDir = path.join(dir, 'oracle');
    const exprDist = path.join(oracleDir, 'node_modules', '@actions', 'expressions', 'dist');
    fs.mkdirSync(exprDist, { recursive: true });
    fs.writeFileSync(path.join(exprDist, 'index.js'), 'export const expressions = {};\n');
    fs.writeFileSync(path.join(oracleDir, 'node_modules', '@actions', 'expressions', 'package.json'), JSON.stringify({ name: '@actions/expressions', version: '2.1.0' }));
    const wfDist = path.join(oracleDir, 'node_modules', '@actions', 'workflow-parser', 'dist');
    fs.mkdirSync(wfDist, { recursive: true });
    fs.writeFileSync(path.join(wfDist, 'index.js'), 'export const workflowParser = {};\n');
    fs.writeFileSync(path.join(oracleDir, 'node_modules', '@actions', 'workflow-parser', 'package.json'), JSON.stringify({ name: '@actions/workflow-parser', version: '3.2.1' }));
    const env = { CW_ACTIONS_ORACLE_DIR: oracleDir };
    const result = await loadActionsOracle(env);
    assert.equal(result.dir, oracleDir);
    assert.ok(result.expressions);
    assert.ok(result.workflowParser);
    assert.equal(result.versions.expressions, '2.1.0');
    assert.equal(result.versions.workflowParser, '3.2.1');
    assert.equal(result.absent, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('returns absent message with ERR_IMPORT_ATTRIBUTE_MISSING when import fails with that code', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadActionsOracle-'));
  try {
    const oracleDir = path.join(dir, 'oracle');
    const exprDist = path.join(oracleDir, 'node_modules', '@actions', 'expressions', 'dist');
    fs.mkdirSync(exprDist, { recursive: true });
    fs.writeFileSync(path.join(exprDist, 'index.js'), 'import data from "./data.json";\nexport {};\n');
    fs.writeFileSync(path.join(exprDist, 'data.json'), '{}\n');
    const wfDist = path.join(oracleDir, 'node_modules', '@actions', 'workflow-parser', 'dist');
    fs.mkdirSync(wfDist, { recursive: true });
    fs.writeFileSync(path.join(wfDist, 'index.js'), 'export {};\n');
    fs.writeFileSync(path.join(oracleDir, 'node_modules', '@actions', 'expressions', 'package.json'), JSON.stringify({ name: '@actions/expressions', version: '1.0.0' }));
    fs.writeFileSync(path.join(oracleDir, 'node_modules', '@actions', 'workflow-parser', 'package.json'), JSON.stringify({ name: '@actions/workflow-parser', version: '1.0.0' }));
    const env = { CW_ACTIONS_ORACLE_DIR: oracleDir };
    const result = await loadActionsOracle(env);
    assert.equal(result.dir, oracleDir);
    assert.match(result.absent, /needs its JSON imports patched/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('returns absent message with generic error when import fails with unknown code', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadActionsOracle-'));
  try {
    const oracleDir = path.join(dir, 'oracle');
    const exprDist = path.join(oracleDir, 'node_modules', '@actions', 'expressions', 'dist');
    fs.mkdirSync(exprDist, { recursive: true });
    fs.writeFileSync(path.join(exprDist, 'index.js'), 'throw new Error("boom");\n');
    const wfDist = path.join(oracleDir, 'node_modules', '@actions', 'workflow-parser', 'dist');
    fs.mkdirSync(wfDist, { recursive: true });
    fs.writeFileSync(path.join(wfDist, 'index.js'), 'export {};\n');
    fs.writeFileSync(path.join(oracleDir, 'node_modules', '@actions', 'expressions', 'package.json'), JSON.stringify({ name: '@actions/expressions', version: '1.0.0' }));
    fs.writeFileSync(path.join(oracleDir, 'node_modules', '@actions', 'workflow-parser', 'package.json'), JSON.stringify({ name: '@actions/workflow-parser', version: '1.0.0' }));
    const env = { CW_ACTIONS_ORACLE_DIR: oracleDir };
    const result = await loadActionsOracle(env);
    assert.equal(result.dir, oracleDir);
    assert.equal(result.absent, `The oracle at ${oracleDir} failed to load: boom`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('uses default oracle directory when CW_ACTIONS_ORACLE_DIR is not set', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadActionsOracle-'));
  try {
    const env = {};
    const result = await loadActionsOracle(env);
    const expectedDir = path.join(os.homedir(), '.commitwork', 'oracles', 'actions');
    assert.equal(result.dir, expectedDir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
