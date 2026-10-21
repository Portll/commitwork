// The ruff lane runs under a host sandbox that denies writes to the scanned tree. ruff's default
// .ruff_cache inside that tree made it exit 2 with no stdout on every fresh clone, so the lane read
// as noscan on exactly the repos it had never seen. A read-only directory reproduces the denial.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCAN = join(dirname(fileURLToPath(import.meta.url)), '..', 'python-lane-scan.mjs');
const ruffPresent = spawnSync('ruff', ['--version']).status === 0;
const posixModes = process.platform !== 'win32';

test('ruff lane reports findings over a tree it cannot write to', { skip: !ruffPresent ? 'ruff not installed' : !posixModes ? 'no POSIX modes' : false }, () => {
  const work = mkdtempSync(join(tmpdir(), 'cw-ruff-ro-'));
  const tree = join(work, 'tree');
  const out = join(work, 'ruff.sarif');
  const log = join(work, 'ruff.log');
  try {
    spawnSync('mkdir', [tree]);
    writeFileSync(join(tree, 'a.py'), 'import os\nx = 1\n');
    chmodSync(tree, 0o555);
    const r = spawnSync(process.execPath, [SCAN, '--tool', 'ruff', '--out', out, '--log', log, '--root', '.'], { cwd: tree, encoding: 'utf8' });
    assert.equal(r.status, 0, readFileSync(log, 'utf8'));
    const sarif = JSON.parse(readFileSync(out, 'utf8'));
    const ids = sarif.runs.flatMap((run) => run.results || []).map((x) => x.ruleId);
    assert.ok(ids.includes('F401'), `expected the unused import to be reported, got ${JSON.stringify(ids)}`);
    assert.deepEqual(readdirSync(tree), ['a.py']);
  } finally {
    if (existsSync(tree)) chmodSync(tree, 0o755);
    rmSync(work, { recursive: true, force: true });
  }
});
