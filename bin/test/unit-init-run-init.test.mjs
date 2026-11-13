// init CLI dispatch: usage, dry-run, apply, and refusal (bin/init.mjs runInit).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runInit } from '../init.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// init reads the state root, the registry and the credential home. The empty "registry declares no
// repositories" plan holds only while all three are absent, so each override names a path in a
// state-shaped directory this test owns and leaves empty.
const STATE = mkdtempSync(join(tmpdir(), 'runInit-state-'));
const OVERRIDES = {
  CW_STATE_DIR: STATE,
  CW_REGISTRY: join(STATE, 'monitor', 'private', 'projects.json'),
  CW_AUTH_STORE: join(STATE, 'home', 'users.json'),
};
const saved = Object.fromEntries(Object.keys(OVERRIDES).map((k) => [k, process.env[k]]));
before(() => { Object.assign(process.env, OVERRIDES); });
after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(STATE, { recursive: true, force: true });
});

test('returns 2 and prints usage when opts.error is set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runInit-'));
  const origErr = console.error;
  const origLog = console.log;
  const errs = [];
  const logs = [];
  console.error = (m) => errs.push(m);
  console.log = (m) => logs.push(m);
  try {
    const code = runInit({ error: 'bad flag' });
    assert.equal(code, 2);
    assert.deepEqual(errs, ['init: bad flag']);
    assert.deepEqual(logs, []);
  } finally {
    console.error = origErr;
    console.log = origLog;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 0 and prints usage text when opts.help is set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runInit-'));
  const origErr = console.error;
  const origLog = console.log;
  const errs = [];
  const logs = [];
  console.error = (m) => errs.push(m);
  console.log = (m) => logs.push(m);
  try {
    const code = runInit({ help: true });
    assert.equal(code, 0);
    assert.deepEqual(logs, ['usage: commitwork init [--private-dir <dir>] [--root <dir>]... [--repo <path>]... [--dry-run] [--json]']);
    assert.deepEqual(errs, []);
  } finally {
    console.error = origErr;
    console.log = origLog;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 2 and prints each usage problem when a repo path is not a git repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runInit-'));
  const fakeRepo = join(dir, 'not-a-repo');
  mkdirSync(fakeRepo, { recursive: true });
  const origErr = console.error;
  const origLog = console.log;
  const errs = [];
  const logs = [];
  console.error = (m) => errs.push(m);
  console.log = (m) => logs.push(m);
  try {
    const code = runInit({ repos: [fakeRepo], roots: [], dryRun: true });
    assert.equal(code, 2);
    assert.deepEqual(errs, [`init: --repo ${fakeRepo} is not a git repository`]);
    assert.deepEqual(logs, []);
  } finally {
    console.error = origErr;
    console.log = origLog;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 2 and prints each usage problem when a root path is not a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runInit-'));
  const fakeRoot = join(dir, 'missing-root');
  const origErr = console.error;
  const origLog = console.log;
  const errs = [];
  const logs = [];
  console.error = (m) => errs.push(m);
  console.log = (m) => logs.push(m);
  try {
    const code = runInit({ repos: [], roots: [fakeRoot], dryRun: true });
    assert.equal(code, 2);
    assert.deepEqual(errs, [`init: --root ${fakeRoot} is not a directory`]);
    assert.deepEqual(logs, []);
  } finally {
    console.error = origErr;
    console.log = origLog;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 0 and prints rendered plan without writing files when dryRun is true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runInit-'));
  const repo = join(dir, 'myrepo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  const origErr = console.error;
  const origLog = console.log;
  const errs = [];
  const logs = [];
  console.error = (m) => errs.push(m);
  console.log = (m) => logs.push(m);
  try {
    const code = runInit({ repos: [repo], roots: [], dryRun: true });
    assert.equal(code, 0);
    assert.deepEqual(errs, []);
    assert.ok(logs.length === 1);
    assert.ok(logs[0].includes('commitwork init (dry run: nothing written)'));
    assert.ok(logs[0].includes('state root'));
    assert.ok(logs[0].includes('Optional records'));
    assert.ok(logs[0].includes('Next:'));
    assert.ok(logs[0].includes('node admin/serve.mjs              then create the operator account at http://127.0.0.1:'));
  } finally {
    console.error = origErr;
    console.log = origLog;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 0 and prints JSON output when json is true and dryRun is true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runInit-'));
  const repo = join(dir, 'myrepo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  const origErr = console.error;
  const origLog = console.log;
  const errs = [];
  const logs = [];
  console.error = (m) => errs.push(m);
  console.log = (m) => logs.push(m);
  try {
    const code = runInit({ repos: [repo], roots: [], dryRun: true, json: true });
    assert.equal(code, 0);
    assert.deepEqual(errs, []);
    assert.ok(logs.length === 1);
    const parsed = JSON.parse(logs[0]);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.refused, false);
    assert.ok(parsed.steps);
    assert.ok(parsed.records);
  } finally {
    console.error = origErr;
    console.log = origLog;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 1 when a step is refused and does not apply changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runInit-'));
  const repo = join(dir, 'myrepo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  const privateDir = join(dir, 'private');
  writeFileSync(privateDir, 'i am a file');
  const origErr = console.error;
  const origLog = console.log;
  const errs = [];
  const logs = [];
  console.error = (m) => errs.push(m);
  console.log = (m) => logs.push(m);
  try {
    const code = runInit({ repos: [repo], roots: [], privateDir, dryRun: true });
    assert.equal(code, 1);
    assert.deepEqual(errs, []);
    assert.ok(logs.length === 1);
    assert.ok(logs[0].includes('REFUSED'));
  } finally {
    console.error = origErr;
    console.log = origLog;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 1 and prints JSON when a step is refused and json is true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runInit-'));
  const repo = join(dir, 'myrepo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  const privateDir = join(dir, 'private');
  writeFileSync(privateDir, 'i am a file');
  const origErr = console.error;
  const origLog = console.log;
  const errs = [];
  const logs = [];
  console.error = (m) => errs.push(m);
  console.log = (m) => logs.push(m);
  try {
    const code = runInit({ repos: [repo], roots: [], privateDir, dryRun: true, json: true });
    assert.equal(code, 1);
    assert.deepEqual(errs, []);
    assert.ok(logs.length === 1);
    const parsed = JSON.parse(logs[0]);
    assert.equal(parsed.refused, true);
    assert.equal(parsed.dryRun, true);
  } finally {
    console.error = origErr;
    console.log = origLog;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prints the no-repositories hint when registry has no roots or projects', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runInit-'));
  const origErr = console.error;
  const origLog = console.log;
  const errs = [];
  const logs = [];
  console.error = (m) => errs.push(m);
  console.log = (m) => logs.push(m);
  try {
    const code = runInit({ repos: [], roots: [], dryRun: true });
    assert.equal(code, 0);
    assert.deepEqual(errs, []);
    assert.ok(logs.length === 1);
    assert.ok(logs[0].includes('registry declares no repositories: add --root <dir> or --repo <path>, or edit it (schema/projects.schema.json)'));
  } finally {
    console.error = origErr;
    console.log = origLog;
    rmSync(dir, { recursive: true, force: true });
  }
});
