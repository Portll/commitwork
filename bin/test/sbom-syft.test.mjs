// node --test bin/test/sbom-syft.test.mjs — the SBOM scan excludes what git ignores, and says so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ignoredExcludes } from '../sbom-syft.mjs';

test('ignored directories and files become syft excludes; tracked paths do not', () => {
  const d = mkdtempSync(join(tmpdir(), 'sbom-syft-'));
  try {
    execFileSync('git', ['-C', d, 'init', '-q']);
    writeFileSync(join(d, '.gitignore'), '.tools/\n.env\n');
    mkdirSync(join(d, '.tools')); writeFileSync(join(d, '.tools', 'cli.exe'), 'MZ');
    writeFileSync(join(d, '.env'), 'X=1');
    writeFileSync(join(d, 'package-lock.json'), '{}');
    const r = ignoredExcludes(d);
    assert.equal(r.git, true);
    assert.deepEqual(r.excludes, ['./.env', './.tools/**']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('not a git checkout: nothing is classed as ignored, and that is reported as git:false', () => {
  const d = mkdtempSync(join(tmpdir(), 'sbom-syft-'));
  try { assert.deepEqual(ignoredExcludes(d), { git: false, excludes: [], ignored: [] }); } finally { rmSync(d, { recursive: true, force: true }); }
});
