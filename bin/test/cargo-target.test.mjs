// bin/test/cargo-target.test.mjs — a sweep's cargo lanes build in a folder of their own.
//
// The failure this exists for, 2026-09-27: every Rust build on the box shared one cargo
// target-dir, and a session ran stale test binaries another build had left there. The e2e case
// below drives the real runner and asserts the EFFECT: the lane saw its own CARGO_TARGET_DIR, and
// could write into it under the host sandbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { usesCargo, sweepCargoTargetDir, cargoLaneEnv } from '../lib/cargo-target.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('a lane that requires cargo or a cargo- tool builds in its own folder; any other lane is untouched', () => {
  assert.equal(usesCargo({ requires: { tools: ['cargo', 'cargo-clippy'] } }), true);
  assert.equal(usesCargo({ requires: { tools: ['cargo-audit'] } }), true);
  assert.equal(usesCargo({ requires: { tools: ['semgrep'] } }), false);
  assert.equal(usesCargo({}), false);
  assert.deepEqual(cargoLaneEnv({ requires: { tools: ['semgrep'] } }, '/x'), { env: {}, writes: [] });
});

test('two checkouts with one name get two folders; one checkout keeps one folder; the root is read at call time', () => {
  const t = mkdtempSync(join(tmpdir(), 'cw-cargo-target-'));
  try {
    mkdirSync(join(t, 'a', 'veld'), { recursive: true }); mkdirSync(join(t, 'b', 'veld'), { recursive: true });
    const env = { CW_CARGO_TARGET_ROOT: join(t, 'root') };
    const a = sweepCargoTargetDir(join(t, 'a', 'veld'), env);
    const b = sweepCargoTargetDir(join(t, 'b', 'veld'), env);
    assert.notEqual(a, b, 'same basename, different checkouts: never one folder');
    assert.equal(sweepCargoTargetDir(join(t, 'a', 'veld'), env), a, 'stable for one checkout');
    assert.match(a, /\/root\/veld-[0-9a-f]{10}$/);
    assert.match(sweepCargoTargetDir(join(t, 'a', 'veld'), { CW_CARGO_TARGET_ROOT: join(t, 'other') }), /\/other\//);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('CARGO_TARGET_DIR keeps the unresolved path; the sandbox gets the resolved one as well', () => {
  const t = mkdtempSync(join(tmpdir(), 'cw-cargo-target-'));
  try {
    mkdirSync(join(t, 'real target'));
    symlinkSync(join(t, 'real target'), join(t, 'link'));
    mkdirSync(join(t, 'repo'));
    const r = cargoLaneEnv({ requires: { tools: ['cargo'] } }, join(t, 'repo'), { CW_CARGO_TARGET_ROOT: join(t, 'link') });
    assert.ok(r.env.CARGO_TARGET_DIR.startsWith(join(t, 'link')), `a space-free symlink path must be kept for cargo: ${r.env.CARGO_TARGET_DIR}`);
    assert.ok(r.writes.some((w) => w.includes('real target')), `the resolved path must be writable under the sandbox: ${r.writes}`);
    assert.ok(existsSync(r.env.CARGO_TARGET_DIR), 'the folder is created before the lane runs');
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('a folder that cannot be created refuses the lane, and never falls back to the shared target-dir', () => {
  const t = mkdtempSync(join(tmpdir(), 'cw-cargo-target-'));
  try {
    writeFileSync(join(t, 'not-a-dir'), 'x');
    const r = cargoLaneEnv({ requires: { tools: ['cargo'] } }, t, { CW_CARGO_TARGET_ROOT: join(t, 'not-a-dir', 'sub') });
    assert.ok(r.refused, JSON.stringify(r));
    assert.match(r.refused, /did not run rather than build into the shared target-dir/);
    assert.equal(r.env, undefined);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

function fixtureRun(extraEnv) {
  const dir = mkdtempSync(resolve(tmpdir(), 'cw-cargo-lane-'));
  const repo = resolve(dir, 'repo'); const reports = resolve(dir, 'reports');
  mkdirSync(repo); mkdirSync(reports);
  const manifest = resolve(dir, 'm.json');
  const cmd = 'printf %s "$CARGO_TARGET_DIR" > "$CW_REPORT_DIR/seen.txt"; touch "$CARGO_TARGET_DIR/proof" && echo wrote > "$CW_REPORT_DIR/wrote.txt"; '
    + `printf '{"tool":"cargo-lane","summary":{"findings":0,"byRule":{},"filesScanned":1},"findings":[]}' > "$CW_REPORT_DIR/cargo-lane.json"; echo 0 > "$CW_REPORT_DIR/cargo-lane.json.exit"`;
  writeFileSync(manifest, JSON.stringify({
    repo: 'fixture', groups: { probe: ['cargo-lane'] },
    checks: [{ id: 'cargo-lane', description: 'fixture: a lane that requires cargo', local: [cmd], report: { file: 'cargo-lane.json', format: 'rule-counts' },
      groups: ['probe'], requires: { tools: ['cargo'] }, executesRepoCode: true, egress: 'none' }],
  }));
  const env = { ...process.env, CW_REPORT_DIR: reports, CW_SKIP_SETUP: '1', CW_DOCKER: 'false', ...extraEnv };
  delete env.CW_SANDBOX;
  const r = spawnSync('node', [resolve(ROOT, 'bin', 'commitwork.mjs'), 'run', 'probe', '--manifest', manifest, '--repo', repo, '--no-fail-fast'], { encoding: 'utf8', env });
  let rows = null;
  try { rows = JSON.parse(readFileSync(resolve(reports, 'checks-status.json'), 'utf8')); } catch { /* reported below */ }
  return { dir, repo, reports, r, rows };
}

// The root must sit OUTSIDE every path the host sandbox already makes writable (the report dir,
// TMPDIR and /tmp are writable for every lane). Under tmpdir() this test passed with the write
// allowance deleted, because the folder was writable anyway; it proved nothing about the allowance.
test('through the real runner: the lane sees its own CARGO_TARGET_DIR and can write into it under the sandbox', { skip: !hasCargo() && 'cargo is not installed here' }, () => {
  const root = mkdtempSync(join(homedir(), '.cw-cargo-target-test-'));
  const f = fixtureRun({ CW_CARGO_TARGET_ROOT: root });
  try {
    assert.ok(f.rows, `checks-status.json unreadable; runner exit ${f.r.status}:\n${f.r.stdout}\n${f.r.stderr}`);
    const seen = readFileSync(resolve(f.reports, 'seen.txt'), 'utf8');
    assert.equal(seen, sweepCargoTargetDir(f.repo, { CW_CARGO_TARGET_ROOT: root }), 'the lane must see the sweep folder, not the shared target-dir');
    const row = f.rows.find((x) => x.check === 'cargo-lane');
    assert.ok(existsSync(resolve(f.reports, 'wrote.txt')), `the lane could not write its own folder: ${JSON.stringify(row)}`);
    if (row.isolation === 'none') assert.ok(row.isolationReason, 'an unconfined run must say why; the write then proves nothing about the sandbox');
    assert.ok(existsSync(join(seen, 'proof')));
  } finally { rmSync(f.dir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test('through the real runner: an uncreatable folder is a lane that did not run, written as such', { skip: !hasCargo() && 'cargo is not installed here' }, () => {
  const blocker = mkdtempSync(resolve(tmpdir(), 'cw-cargo-block-'));
  writeFileSync(join(blocker, 'file'), 'x');
  const f = fixtureRun({ CW_CARGO_TARGET_ROOT: join(blocker, 'file', 'sub') });
  try {
    assert.ok(f.rows, `checks-status.json unreadable; runner exit ${f.r.status}:\n${f.r.stdout}\n${f.r.stderr}`);
    const row = f.rows.find((x) => x.check === 'cargo-lane');
    assert.equal(row.status, 'noscan', JSON.stringify(row));
    assert.match(row.reason, /cargo target folder/);
    assert.ok(!existsSync(resolve(f.reports, 'seen.txt')), 'the lane must not have run');
  } finally { rmSync(f.dir, { recursive: true, force: true }); rmSync(blocker, { recursive: true, force: true }); }
});

function hasCargo() { return spawnSync('cargo', ['--version'], { encoding: 'utf8' }).status === 0; }
