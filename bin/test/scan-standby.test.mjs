// `commitwork scan` runs every check, so a standby that shares its primary's report file must not
// run after a primary that produced output: it would replace the primary's findings with its own.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'commitwork.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-scan-standby-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

const BIN = join(TMP, 'bin');
mkdirSync(BIN);
writeFileSync(join(BIN, 'cw-present-zz9'), '#!/bin/sh\nexit 0\n');
chmodSync(join(BIN, 'cw-present-zz9'), 0o755);

// The ids are the real alias pair; CHECK_ALIASES declares sast-opengrep a standby for sast.
const lane = (id, tool) => ({
  id, description: 'fixture lane',
  local: [`echo written-by-${id} > "$CW_REPORT_DIR/shared.txt"`],
  report: { file: 'shared.txt', format: 'text' },
  requires: { tools: [tool] }, groups: [id],
});

const repoUnder = (root) => {
  const d = join(root, 'fixture-repo');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'README.txt'), 'fixture\n');
  spawnSync('git', ['init', '-q', d]);
  return root;
};

const scan = (name, primaryTool) => {
  const dir = join(TMP, name);
  mkdirSync(dir);
  const manifest = join(dir, 'm.json');
  const checks = [lane('sast', primaryTool), lane('sast-opengrep', 'cw-present-zz9')];
  writeFileSync(manifest, JSON.stringify({ repo: 'fixture', checks, groups: { all: ['sast'] } }));
  const out = join(dir, 'out');
  const r = spawnSync(process.execPath, [CLI, 'scan', '--manifest', manifest, '--root', repoUnder(join(dir, 'root')), '--out', out], {
    encoding: 'utf8',
    env: { ...process.env, CW_SKIP_SETUP: '1', CW_SANDBOX: 'off', CW_ASSERT_TREE: '0', FORCE_COLOR: '0',
      CW_SCAN_CONFIG: join(TMP, 'no-scan-config.json'),
      PATH: [BIN, dirname(process.execPath), process.env.PATH].join(delimiter) },
  });
  const read = (f) => {
    try { return readFileSync(join(out, 'fixture-repo', f), 'utf8'); }
    catch (e) { return assert.fail(`${f} unreadable (${e.message}):\n${r.stdout}\n${r.stderr}`); }
  };
  return { report: read('shared.txt').trim(), summary: read('summary.md') };
};

test('a standby does not run after its primary produced a report, and says why', () => {
  const { report, summary } = scan('primary-ran', 'cw-present-zz9');
  assert.equal(report, 'written-by-sast');
  assert.match(summary, /\| sast-opengrep \| n\/a \| standby for sast, which ran; running it would overwrite shared\.txt \|/);
});

test('a standby runs when its primary could not', () => {
  const { report, summary } = scan('primary-void', 'cw-absent-zz9');
  assert.equal(report, 'written-by-sast-opengrep');
  assert.match(summary, /\| sast \| NOSCAN \| tool:cw-absent-zz9 \(not on PATH\)/);
  assert.doesNotMatch(summary, /standby for sast/);
});
