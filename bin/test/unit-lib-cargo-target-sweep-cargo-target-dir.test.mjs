// Per-repo sweep cargo target dir from sanitized basename and real-path hash (bin/lib/cargo-target.mjs sweepCargoTargetDir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepCargoTargetDir } from '../lib/cargo-target.mjs';
import { mkdtempSync, rmSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'sweepCargoTargetDir-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('keeps a plain basename and appends the first ten hex chars of the sha256 of the real path', () => {
  withDir((dir) => {
    const repo = join(dir, 'my-repo');
    mkdirSync(repo);
    const real = join(realpathSync(dir), 'my-repo');
    const env = { CW_CARGO_TARGET_ROOT: join(dir, 'target') };
    assert.equal(sweepCargoTargetDir(repo, env), join(dir, 'target', `my-repo-${h(real)}`));
  });
});

test('replaces each character outside letters digits dot underscore and hyphen with an underscore', () => {
  withDir((dir) => {
    const repo = join(dir, 'my repo!');
    mkdirSync(repo);
    const real = join(realpathSync(dir), 'my repo!');
    const env = { CW_CARGO_TARGET_ROOT: join(dir, 'target') };
    assert.equal(sweepCargoTargetDir(repo, env), join(dir, 'target', `my_repo_-${h(real)}`));
  });
});

test('keeps letters digits dots underscores and hyphens unchanged', () => {
  withDir((dir) => {
    const repo = join(dir, 'Ab.9_z-');
    mkdirSync(repo);
    const real = join(realpathSync(dir), 'Ab.9_z-');
    const env = { CW_CARGO_TARGET_ROOT: join(dir, 'target') };
    assert.equal(sweepCargoTargetDir(repo, env), join(dir, 'target', `Ab.9_z--${h(real)}`));
  });
});

test('falls back to the name repo when the path is the filesystem root', () => {
  withDir((dir) => {
    const env = { CW_CARGO_TARGET_ROOT: join(dir, 'target') };
    assert.equal(sweepCargoTargetDir('/', env), join(dir, 'target', `repo-${h('/')}`));
  });
});

test('uses the default root under the home directory when CW_CARGO_TARGET_ROOT is unset', () => {
  withDir((dir) => {
    const repo = join(dir, 'plain');
    mkdirSync(repo);
    const real = join(realpathSync(dir), 'plain');
    assert.equal(
      sweepCargoTargetDir(repo, {}),
      join(homedir(), '.cargo-target-drive', 'commitwork-sweep', `plain-${h(real)}`),
    );
  });
});

test('uses the default root when CW_CARGO_TARGET_ROOT is an empty string', () => {
  withDir((dir) => {
    const repo = join(dir, 'empty-root');
    mkdirSync(repo);
    const real = join(realpathSync(dir), 'empty-root');
    assert.equal(
      sweepCargoTargetDir(repo, { CW_CARGO_TARGET_ROOT: '' }),
      join(homedir(), '.cargo-target-drive', 'commitwork-sweep', `empty-root-${h(real)}`),
    );
  });
});

test('drops a trailing slash before taking the basename and hashing', () => {
  withDir((dir) => {
    const repo = join(dir, 'trailing');
    mkdirSync(repo);
    const real = join(realpathSync(dir), 'trailing');
    const env = { CW_CARGO_TARGET_ROOT: join(dir, 'target') };
    assert.equal(sweepCargoTargetDir(repo + '/', env), join(dir, 'target', `trailing-${h(real)}`));
  });
});

test('hashes the resolved path as given when the repository does not exist', () => {
  withDir((dir) => {
    const repo = join(dir, 'missing');
    const env = { CW_CARGO_TARGET_ROOT: join(dir, 'target') };
    assert.equal(sweepCargoTargetDir(repo, env), join(dir, 'target', `missing-${h(repo)}`));
  });
});
