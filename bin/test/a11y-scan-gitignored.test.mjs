// Git-ignored HTML is not a served page: zippr keeps mockups and dated reports in an ignored resources/ folder,
// and scanning them published 47 violations no visitor could meet. Outside a repo nothing is filtered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { htmlFiles } from '../a11y-scan.mjs';

const page = '<!doctype html><html lang="en"><title>t</title></html>';
const names = (dir) => htmlFiles(dir).map((f) => f.slice(dir.length + 1).split('\\').join('/'));

function tree(withGit, ignore) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-a11y-ignored-'));
  mkdirSync(join(dir, 'resources', 'design'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), page);
  writeFileSync(join(dir, 'resources', 'design', 'mockup.html'), page);
  if (withGit) {
    assert.equal(spawnSync('git', ['init', '-q', dir]).status, 0, 'git init');
    if (ignore) writeFileSync(join(dir, '.gitignore'), '/resources/\n');
  }
  return dir;
}

test('an ignored folder is left out and a served page is kept', () => {
  const dir = tree(true, true);
  try { assert.deepEqual(names(dir), ['index.html']); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('nothing ignored: every page is scanned', () => {
  const dir = tree(true, false);
  try { assert.deepEqual(names(dir), ['index.html', 'resources/design/mockup.html']); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('not a repo: nothing is filtered (git failing must not shrink the scan)', () => {
  const dir = tree(false, false);
  try { assert.deepEqual(names(dir), ['index.html', 'resources/design/mockup.html']); } finally { rmSync(dir, { recursive: true, force: true }); }
});
