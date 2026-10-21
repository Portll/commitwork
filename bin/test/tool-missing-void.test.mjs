// A lane that matches the repo and cannot run because a tool it requires is not on PATH is a
// blocked void naming the tool, on the run path, the scan path and the contained-lane rows. It used
// to be `n/a — tool:<name>`, which the rollup counts as a correct exclusion, so an uninstalled
// scanner read as a repo with nothing for it to scan. A repo the lane's gate does not match is still
// n/a. The pinned-tool form of the same rule is held in cobolwork-lane-pin.test.mjs.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { containedVoids } from '../commitwork.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'commitwork.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-tool-missing-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

const ABSENT = 'cw-absent-tool-zz9';
const PRESENT = 'cw-present-tool-zz9';
const BIN = join(TMP, 'bin');
mkdirSync(BIN);
writeFileSync(join(BIN, PRESENT), '#!/bin/sh\nexit 0\n');
chmodSync(join(BIN, PRESENT), 0o755);

// The command leaves a mark if it ever runs, so "never ran" is observed, not inferred.
const lane = (id, tool, gate = {}) => ({
  id, description: 'fixture lane',
  local: [`touch '${join(TMP, `ran-${id}`)}'; echo ok > "$CW_REPORT_DIR/${id}.txt"`],
  report: { file: `${id}.txt`, format: 'text' },
  requires: { tools: [tool] }, groups: ['all'], ...gate,
});
const CHECKS = [
  lane('gated-absent', ABSENT, { appliesIfSourceExt: ['.zz9'] }),
  lane('ungated-absent', ABSENT),
  lane('gated-present', PRESENT, { appliesIfSourceExt: ['.zz9'] }),
];
const MANIFEST = join(TMP, 'm.json');
writeFileSync(MANIFEST, JSON.stringify({ repo: 'fixture', checks: CHECKS, groups: { all: CHECKS.map((c) => c.id) } }));

const repo = (name, files) => {
  const d = join(TMP, 'roots', name, name);
  mkdirSync(d, { recursive: true });
  for (const [f, body] of Object.entries(files)) writeFileSync(join(d, f), body);
  spawnSync('git', ['init', '-q', d]);
  return d;
};
const MATCHED = repo('matched', { 'x.zz9': 'source\n' });
const UNMATCHED = repo('unmatched', { 'README.txt': 'no zz9 here\n' });

const env = () => ({ ...process.env, CW_SKIP_SETUP: '1', CW_SANDBOX: 'off', CW_ASSERT_TREE: '0', FORCE_COLOR: '0',
  CW_SCAN_CONFIG: join(TMP, 'no-scan-config.json'),
  PATH: [BIN, dirname(process.execPath), process.env.PATH].join(delimiter) });

let n = 0;
function run(repoPath) {
  const reports = join(TMP, `reports-${++n}`);
  mkdirSync(reports);
  const r = spawnSync(process.execPath, [CLI, 'run', 'all', '--manifest', MANIFEST, '--repo', repoPath, '--no-fail-fast'],
    { encoding: 'utf8', env: { ...env(), CW_REPORT_DIR: reports } });
  let rows;
  try { rows = JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8')); }
  catch (e) { assert.fail(`checks-status.json unreadable (${e.message}); runner exit ${r.status}:\n${r.stdout}\n${r.stderr}`); }
  return { out: `${r.stdout}${r.stderr}`, row: (id) => rows.find((x) => x.check === id) };
}

test('a matched repo with the tool absent is a blocked void naming the tool, and the lane never runs', () => {
  const { row, out } = run(MATCHED);
  for (const id of ['gated-absent', 'ungated-absent']) {
    const r = row(id);
    assert.equal(r.status, 'noscan', `${id}: ${JSON.stringify(r)}`);
    assert.match(r.reason, new RegExp(`tool:${ABSENT} \\(not on PATH\\)`), id);
    assert.doesNotMatch(r.reason, /^n\/a/, id);
    assert.equal(r.coverage, 'unknown', id);
    assert.equal(existsSync(join(TMP, `ran-${id}`)), false, `${id} ran without its tool`);
  }
  assert.match(out, /BLOCKED/);
  // the control: the same shape with its tool present runs, so the void above is the tool's absence
  assert.equal(row('gated-present').status, 'pass', JSON.stringify(row('gated-present')));
  assert.equal(existsSync(join(TMP, 'ran-gated-present')), true);
});

test('a repo the gate does not match is still n/a, whether or not the tool is there', () => {
  const { row } = run(UNMATCHED);
  for (const id of ['gated-absent', 'gated-present']) {
    assert.equal(row(id).status, 'skip', `${id}: ${JSON.stringify(row(id))}`);
    assert.match(row(id).reason, /^n\/a — no \.zz9 sources found/, id);
  }
  // No gate means the lane matches every repo, so its missing tool is a void here too.
  assert.equal(row('ungated-absent').status, 'noscan');
});

test('the scan path makes the same call: a void cell for the matched repo, a skip for the other', () => {
  const out = join(TMP, 'scan-out');
  const r = spawnSync(process.execPath, [CLI, 'scan', '--manifest', MANIFEST, '--root', join(TMP, 'roots'), '--out', out],
    { encoding: 'utf8', env: env() });
  const summary = (name) => {
    try { return readFileSync(join(out, name, 'summary.md'), 'utf8'); }
    catch (e) { return assert.fail(`no summary for ${name} (${e.message}):\n${r.stdout}\n${r.stderr}`); }
  };
  assert.match(summary('matched'), new RegExp(`\\| gated-absent \\| NOSCAN \\| tool:${ABSENT} \\(not on PATH\\)`));
  assert.doesNotMatch(summary('unmatched'), /\| gated-absent \| NOSCAN/);
  assert.match(summary('unmatched'), /\| gated-absent \| n\/a \| no \.zz9 sources found \|/);
});

test('a contained lane that matches keeps its void row when its tool is absent', () => {
  // `cargo build` in the command is what makes a lane contained (buildsScannedTree).
  const contained = { ...lane('contained-absent', ABSENT, { appliesIfSourceExt: ['.zz9'] }), local: ['cargo build'] };
  const m = { repo: 'fixture', checks: [contained] };
  const saved = process.env.PATH;
  process.env.PATH = [BIN, saved].join(delimiter);
  try {
    assert.deepEqual(containedVoids(m, [], MATCHED, new Set()).map((r) => [r.id, r.status]), [['contained-absent', 'noscan']],
      'the repo has the sources whether or not this box has the tool');
    assert.deepEqual(containedVoids(m, [], UNMATCHED, new Set()), []);
  } finally { process.env.PATH = saved; }
});
