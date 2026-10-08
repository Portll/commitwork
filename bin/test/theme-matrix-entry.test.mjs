// bin/theme-matrix.mjs with no usable browser. The nine-cell matrix needs Chrome and boots the panel
// from this checkout, so it is not run here; what IS pinned is the instrument-absent refusal its
// header promises: exit 3 GREY with the reason, no cell reported, no "clean" line, no panel boot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MATRIX = join(CW, 'bin', 'theme-matrix.mjs');

test('with CW_CHROME naming no browser, the matrix is GREY (exit 3) and reports no cell', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-theme-matrix-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const chrome = join(dir, 'no-such-chrome');
  const r = spawnSync(process.execPath, [MATRIX], { encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, CW_CHROME: chrome, CW_AUTH_STORE: join(dir, 'users.json') } });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.equal(r.stderr, `theme-matrix: GREY — CW_CHROME=${chrome} is not a file. Not a pass.\n`);
  assert.equal(r.stdout, '', 'no ✔/✖/⚪ cell and no "N/9 cell(s) clean" line without an instrument');
});
