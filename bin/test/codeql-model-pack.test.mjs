// bin/codeql-model-pack.mjs: a repository's own CodeQL sources and sinks become a model pack the
// CodeQL lanes load, and every outcome is recorded: applied, absent, or failed with its error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelFiles, buildPack } from '../codeql-model-pack.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HELPER = join(ROOT, 'bin', 'codeql-model-pack.mjs');
const RUST_SINK = 'extensions:\n  - addsTo:\n      pack: codeql/rust-all\n      extensible: sinkModel\n    data:\n      - ["<x::Db>::run", "Argument[0]", "sql-injection", "manual"]\n';
const GO_SINK = RUST_SINK.replace('codeql/rust-all', 'codeql/go-all');

function store() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-models-'));
  mkdirSync(join(dir, 'demo'));
  writeFileSync(join(dir, 'demo', 'a-sql.yml'), RUST_SINK);
  writeFileSync(join(dir, 'demo', 'b-go.yml'), GO_SINK);
  writeFileSync(join(dir, 'demo', 'notes.txt'), 'not a model');
  return dir;
}

test('only the repository\'s files whose extensions target this language join the pack', () => {
  const dir = store();
  assert.deepEqual(modelFiles(dir, 'demo', 'rust').map((f) => f.name), ['a-sql.yml']);
  assert.deepEqual(modelFiles(dir, 'demo', 'go').map((f) => f.name), ['b-go.yml']);
  assert.deepEqual(modelFiles(dir, 'other', 'rust'), [], 'a repository with no directory declares nothing');
  assert.throws(() => modelFiles(dir, 'demo', 'cobol'), /unknown CodeQL language/);
});

test('the pack is a library extending the language pack, named for the repository', () => {
  const out = mkdtempSync(join(tmpdir(), 'cw-pack-'));
  const pack = buildPack(modelFiles(store(), 'demo', 'rust'), 'Demo_Repo', 'rust', out);
  assert.equal(pack.name, 'commitwork-models/demo-repo-rust');
  const ql = readFileSync(join(pack.dir, 'qlpack.yml'), 'utf8');
  assert.match(ql, /^library: true$/m);
  assert.match(ql, /codeql\/rust-all: "\*"/);
  assert.equal(readFileSync(join(pack.dir, 'models', 'a-sql.yml'), 'utf8'), RUST_SINK);
  assert.equal(buildPack([], 'demo', 'rust', out), null);
});

const runHelper = (repoName, models, language = 'rust') => {
  const base = mkdtempSync(join(tmpdir(), 'cw-helper-'));
  const repo = join(base, repoName); mkdirSync(repo);
  const report = join(base, 'report'); mkdirSync(report);
  const r = spawnSync(process.execPath, [HELPER, language], { cwd: repo, encoding: 'utf8', env: { ...process.env, CW_REPORT_DIR: report, CW_CODEQL_MODELS: models } });
  return { r, record: JSON.parse(readFileSync(join(report, `codeql-${language}-models.json`), 'utf8')), report };
};

test('declared models print the load arguments and are recorded as applied', () => {
  const { r, record, report } = runHelper('demo', store());
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), `--additional-packs ${join(report, 'codeql-models')} --model-packs commitwork-models/demo-rust`);
  assert.deepEqual({ applied: record.applied, files: record.files, error: record.error }, { applied: true, files: ['a-sql.yml'], error: null });
});

test('no models prints nothing and records why; an unreadable store is recorded as a failure, not as none', () => {
  const none = runHelper('elsewhere', store());
  assert.equal(none.r.stdout, '');
  assert.deepEqual({ applied: none.record.applied, error: none.record.error }, { applied: false, error: null });

  const notADir = join(mkdtempSync(join(tmpdir(), 'cw-models-file-')), 'models');
  writeFileSync(notADir, 'a file where the store should be');
  const broken = runHelper('demo', notADir);
  assert.equal(broken.r.status, 0, 'the lane still runs');
  assert.equal(broken.r.stdout, '');
  assert.equal(broken.record.applied, false);
  assert.match(broken.record.error, /ENOTDIR/);
});

test('every CodeQL lane loads the models for its own language', () => {
  const sb = JSON.parse(readFileSync(join(ROOT, 'manifests', 'security-baseline.json'), 'utf8'));
  const lanes = sb.checks.filter((c) => /^sast-codeql/.test(c.id));
  assert.ok(lanes.length >= 9);
  for (const c of lanes) {
    const cmd = (c.local || []).join('\n');
    const lang = (cmd.match(/--language[= ]([a-z-]+)/) || [])[1];
    assert.ok(lang, `${c.id} declares no --language`);
    assert.ok(cmd.includes(`codeql-model-pack.mjs" ${lang})`), `${c.id} does not load the ${lang} models`);
  }
});
