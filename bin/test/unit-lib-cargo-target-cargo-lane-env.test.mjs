// Per-repo CARGO_TARGET_DIR env and writable paths for a cargo lane (bin/lib/cargo-target.mjs cargoLaneEnv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargoLaneEnv } from '../lib/cargo-target.mjs';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = (root, name, repoReal) =>
  join(root, `${name}-${createHash('sha256').update(repoReal).digest('hex').slice(0, 10)}`);

const inTemp = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'cargoLaneEnv-'));
  try { fn(realpathSync(dir)); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('a check whose tools only look like cargo gets an empty env and creates nothing', () => {
  inTemp((base) => {
    const root = join(base, 'root');
    const r = cargoLaneEnv({ requires: { tools: ['rustc', 'cargox', 'xcargo-build'] } }, join(base, 'repo'), { CW_CARGO_TARGET_ROOT: root });
    assert.deepEqual(r, { env: {}, writes: [] });
    assert.equal(existsSync(root), false);
  });
});

test('a null check, a check without requires and an empty tools list get an empty env', () => {
  inTemp((base) => {
    const env = { CW_CARGO_TARGET_ROOT: join(base, 'root') };
    const repo = join(base, 'repo');
    assert.deepEqual(cargoLaneEnv(null, repo, env), { env: {}, writes: [] });
    assert.deepEqual(cargoLaneEnv({}, repo, env), { env: {}, writes: [] });
    assert.deepEqual(cargoLaneEnv({ requires: { tools: [] } }, repo, env), { env: {}, writes: [] });
    assert.equal(existsSync(env.CW_CARGO_TARGET_ROOT), false);
  });
});

test('a check needing cargo gets a CARGO_TARGET_DIR named after the repo under the sweep root', () => {
  inTemp((base) => {
    const repo = join(base, 'repo');
    mkdirSync(repo);
    const root = join(base, 'root');
    const dir = target(root, 'repo', repo);
    const r = cargoLaneEnv({ requires: { tools: ['cargo'] } }, repo, { CW_CARGO_TARGET_ROOT: root });
    assert.deepEqual(r, { env: { CARGO_TARGET_DIR: dir }, writes: [dir] });
    assert.equal(statSync(dir).isDirectory(), true);
  });
});

test('a cargo- prefixed tool counts as cargo and missing parent folders are created', () => {
  inTemp((base) => {
    const repo = join(base, 'proj');
    mkdirSync(repo);
    const root = join(base, 'a', 'b', 'c');
    const dir = target(root, 'proj', repo);
    const r = cargoLaneEnv({ requires: { tools: ['clippy', 'cargo-clippy'] } }, repo, { CW_CARGO_TARGET_ROOT: root });
    assert.deepEqual(r, { env: { CARGO_TARGET_DIR: dir }, writes: [dir] });
    assert.equal(statSync(dir).isDirectory(), true);
  });
});

test('characters outside letters, digits, dot, underscore and dash in the repo name become underscores', () => {
  inTemp((base) => {
    const repo = join(base, 'my repo!.v2-x_y');
    mkdirSync(repo);
    const root = join(base, 'root');
    const dir = target(root, 'my_repo_.v2-x_y', repo);
    const r = cargoLaneEnv({ requires: { tools: ['cargo'] } }, repo, { CW_CARGO_TARGET_ROOT: root });
    assert.deepEqual(r, { env: { CARGO_TARGET_DIR: dir }, writes: [dir] });
  });
});

test('a repo path that does not exist is named and hashed as given', () => {
  inTemp((base) => {
    const repo = join(base, 'missing', 'proj');
    const root = join(base, 'root');
    const dir = target(root, 'proj', repo);
    const r = cargoLaneEnv({ requires: { tools: ['cargo'] } }, repo, { CW_CARGO_TARGET_ROOT: root });
    assert.deepEqual(r, { env: { CARGO_TARGET_DIR: dir }, writes: [dir] });
  });
});

test('a repo reached through a symlink is named and hashed by its real path', () => {
  inTemp((base) => {
    const actual = join(base, 'actual');
    mkdirSync(actual);
    const alias = join(base, 'alias');
    symlinkSync(actual, alias);
    const root = join(base, 'root');
    const dir = target(root, 'actual', actual);
    const r = cargoLaneEnv({ requires: { tools: ['cargo'] } }, alias, { CW_CARGO_TARGET_ROOT: root });
    assert.deepEqual(r, { env: { CARGO_TARGET_DIR: dir }, writes: [dir] });
  });
});

test('a sweep root reached through a symlink lists both the link path and the real path in writes', () => {
  inTemp((base) => {
    const repo = join(base, 'repo');
    mkdirSync(repo);
    const realRoot = join(base, 'realroot');
    mkdirSync(realRoot);
    const link = join(base, 'linkroot');
    symlinkSync(realRoot, link);
    const dir = target(link, 'repo', repo);
    const r = cargoLaneEnv({ requires: { tools: ['cargo'] } }, repo, { CW_CARGO_TARGET_ROOT: link });
    assert.deepEqual(r, { env: { CARGO_TARGET_DIR: dir }, writes: [dir, target(realRoot, 'repo', repo)] });
  });
});

test('an existing target folder is reused on a second call without refusal', () => {
  inTemp((base) => {
    const repo = join(base, 'repo');
    mkdirSync(repo);
    const root = join(base, 'root');
    const dir = target(root, 'repo', repo);
    const env = { CW_CARGO_TARGET_ROOT: root };
    cargoLaneEnv({ requires: { tools: ['cargo'] } }, repo, env);
    const r = cargoLaneEnv({ requires: { tools: ['cargo'] } }, repo, env);
    assert.deepEqual(r, { env: { CARGO_TARGET_DIR: dir }, writes: [dir] });
  });
});

test('a sweep root that is a file refuses the lane and names the error code', () => {
  inTemp((base) => {
    const repo = join(base, 'repo');
    mkdirSync(repo);
    const root = join(base, 'blocker');
    writeFileSync(root, 'x');
    const dir = target(root, 'repo', repo);
    const r = cargoLaneEnv({ requires: { tools: ['cargo'] } }, repo, { CW_CARGO_TARGET_ROOT: root });
    assert.deepEqual(r, { refused: `the sweep's cargo target folder ${dir} could not be created (ENOTDIR); the lane did not run rather than build into the shared target-dir` });
  });
});
