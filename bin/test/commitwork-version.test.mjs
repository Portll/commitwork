// node --test bin/test/commitwork-version.test.mjs
//
// `commitwork --version` and `commitwork version` print package.json's version and exit 0. Both
// used to exit 2 with "no manifest given", which is the first thing a reader checking an install
// sees. Run from an empty directory with no CW_REPORT_DIR, scratch HOME, so neither a manifest in
// the cwd nor first-run setup can answer instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'bin', 'commitwork.mjs');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

test('commitwork --version and commitwork version print the package.json version and exit 0', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cw-version-')));
  const scratchTmp = join(dir, 'tmp');
  try {
    mkdirSync(scratchTmp);
    const env = { PATH: process.env.PATH, HOME: dir, TMPDIR: scratchTmp };
    for (const arg of ['--version', 'version']) {
      const r = spawnSync(process.execPath, [CLI, arg], { cwd: dir, env, encoding: 'utf8' });
      assert.equal(r.status, 0, `${arg}: ${r.stderr}`);
      assert.equal(r.stdout, `${VERSION}\n`, arg);
      assert.equal(r.stderr, '', `${arg} writes nothing else`);
    }
    assert.deepEqual(readdirSync(scratchTmp), [], 'and makes no report directory');
    assert.match(VERSION, /^\d+\.\d+\.\d+/, 'the fixture read a real version');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
