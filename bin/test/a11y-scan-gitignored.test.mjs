// Git-ignored HTML is not a served page. A scanned repository that keeps mockups and dated reports under an
// ignored folder yielded 47 violations no visitor could meet. Outside a repo nothing is filtered: git failing
// must not shrink the scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { htmlFiles } from '../a11y-scan.mjs';

const page = '<!doctype html><html lang="en"><title>t</title></html>';
const names = (dir) => htmlFiles(dir).map((f) => f.slice(dir.length + 1).split('\\').join('/'));
const POSIX = process.platform !== 'win32';

function tree(t, { withGit, ignore }) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-a11y-ignored-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'resources', 'design'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), page);
  writeFileSync(join(dir, 'resources', 'design', 'mockup.html'), page);
  if (withGit) {
    assert.equal(spawnSync('git', ['init', '-q', dir]).status, 0, 'git init');
    if (ignore) writeFileSync(join(dir, '.gitignore'), '/resources/\n');
  }
  return dir;
}

test('an ignored folder is left out and a served page is kept', (t) => {
  // Arrange
  const dir = tree(t, { withGit: true, ignore: true });
  // Act
  const scanned = names(dir);
  // Assert
  assert.deepEqual(scanned, ['index.html']);
});

test('nothing ignored: every page is scanned', (t) => {
  // Arrange
  const dir = tree(t, { withGit: true, ignore: false });
  // Act
  const scanned = names(dir);
  // Assert
  assert.deepEqual(scanned, ['index.html', 'resources/design/mockup.html']);
});

test('not a repo: nothing is filtered (git failing must not shrink the scan)', (t) => {
  // Arrange
  const dir = tree(t, { withGit: false, ignore: false });
  // Act
  const scanned = names(dir);
  // Assert
  assert.deepEqual(scanned, ['index.html', 'resources/design/mockup.html']);
});

// check-ignore reads the index, and reading the index runs the repository's own core.fsmonitor command.
test('the ignore check never runs a command the scanned repository configured', { skip: !POSIX && 'needs a POSIX shell script as the fsmonitor' }, (t) => {
  // Arrange
  const dir = tree(t, { withGit: true, ignore: true });
  const marker = join(dir, 'FSMONITOR-RAN');
  const hook = join(dir, 'fsmonitor.sh');
  writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`);
  chmodSync(hook, 0o755);
  assert.equal(spawnSync('git', ['-C', dir, 'config', 'core.fsmonitor', hook]).status, 0, 'git config');
  assert.equal(spawnSync('git', ['-C', dir, 'add', 'index.html']).status, 0, 'git add');
  rmSync(marker, { force: true });
  // Act
  const scanned = names(dir);
  // Assert
  assert.deepEqual(scanned, ['index.html']);
  assert.equal(existsSync(marker), false, 'the scanned repository\'s fsmonitor ran');
});
