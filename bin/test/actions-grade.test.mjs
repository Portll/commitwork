// The grading CLI and the oracle loader: an absent oracle is a refusal, a present one yields a report.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadActionsOracle } from '../lib/actions-oracle-load.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'actions-grade.mjs');
const fixtures = path.join(here, 'fixtures', 'actions-grade');

let oracle;
before(async () => { oracle = await loadActionsOracle(); });

const run = (args, env = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'actions-grade-'));

test('loadActionsOracle reports an absent directory without throwing', async () => {
  const dir = path.join(tmp(), 'missing');
  const r = await loadActionsOracle({ CW_ACTIONS_ORACLE_DIR: dir });
  assert.equal(r.dir, dir);
  assert.equal(typeof r.absent, 'string');
  assert.ok(r.absent.includes(dir));
  assert.equal(r.expressions, undefined);
});

test('the CLI exits 2 and names the directory when the oracle is absent', () => {
  const dir = path.join(tmp(), 'missing');
  const r = run(['--root', fixtures], { CW_ACTIONS_ORACLE_DIR: dir });
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes(dir), r.stderr);
});

test('the CLI exits 2 without a root', (t) => {
  if (oracle.absent) return t.skip(oracle.absent);
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--root/);
});

test('the CLI grades the synthetic workflows and writes a report', (t) => {
  if (oracle.absent) return t.skip(oracle.absent);
  const out = path.join(tmp(), 'report.json');
  const r = run(['--root', fixtures, '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(report.generatedBy, 'bin/actions-grade.mjs');
  assert.deepEqual(report.oracleVersions, oracle.versions);
  assert.deepEqual(report.roots, [path.resolve(fixtures)]);
  assert.equal(report.files, 3);
  assert.deepEqual(report.expressions, { total: 5, agree: 5, disagree: 0 });
  assert.deepEqual(report.disagreements, []);
  if (report.workflows !== null) {
    const { agree, disagree, 'mine-refused': mr, 'oracle-refused': or, 'both-refused': br } = report.workflows;
    assert.equal(agree + disagree + mr + or + br, 3);
  }
  assert.match(r.stdout, /^files\s+3$/m);
  assert.deepEqual(fs.readdirSync(path.dirname(out)), ['report.json']);
});

test('the report is byte-identical across runs and --limit caps expressions', (t) => {
  if (oracle.absent) return t.skip(oracle.absent);
  const dir = tmp();
  const a = path.join(dir, 'a.json'); const b = path.join(dir, 'b.json');
  assert.equal(run(['--root', fixtures, '--out', a]).status, 0);
  assert.equal(run(['--root', fixtures, '--out', b]).status, 0);
  assert.equal(fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8'));
  const c = path.join(dir, 'c.json');
  assert.equal(run(['--root', fixtures, '--out', c, '--limit', '2']).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(c, 'utf8')).expressions.total, 2);
});
