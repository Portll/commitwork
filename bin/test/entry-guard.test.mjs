// Tests for the one entry-point guard, isMainModule (positive and negative)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const IS_MAIN = pathToFileURL(join(CW, 'lib', 'is-main.mjs')).href;

test('a module is main when run, through a symlink too, and not when a same-suffix script imports it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-entry-'));
  writeFileSync(join(dir, 'report.mjs'), `import { isMainModule } from '${IS_MAIN}';\nif (isMainModule(import.meta.url)) console.log('MAIN');\n`);
  writeFileSync(join(dir, 'other-report.mjs'), "import './report.mjs';\n");
  symlinkSync(join(dir, 'report.mjs'), join(dir, 'link.mjs'));
  const run = (f) => spawnSync(process.execPath, [join(dir, f)], { encoding: 'utf8' }).stdout.trim();
  assert.equal(run('report.mjs'), 'MAIN');
  assert.equal(run('link.mjs'), 'MAIN');
  assert.equal(run('other-report.mjs'), '');
});

