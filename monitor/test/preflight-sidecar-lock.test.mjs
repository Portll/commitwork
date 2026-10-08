// Sidecar lockfiles: call-time root, classify, build destination

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir, homedir } from 'node:os';

import { classify, verdictFor, preflight, buildOne, sidecarLockRoot, sidecarLockDir } from '../preflight-build.mjs';

const mk = (files, prefix = 'cw-pfs-') => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  for (const [name, body] of Object.entries(files)) {
    const p = join(d, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, body ?? '');
  }
  return d;
};
const NODE_MANIFEST = JSON.stringify({ name: 'p', version: '1.0.0', dependencies: { 'left-pad': '^1.0.0' } });

describe('the sidecar root is read at call time, never at import', () => {
  test('CW_LOCKFILE_ROOT set AFTER import is honoured, and the per-repo dir is keyed on the repo directory name', () => {
    const prev = process.env.CW_LOCKFILE_ROOT;
    process.env.CW_LOCKFILE_ROOT = join(tmpdir(), 'cw-root-after-import');
    try {
      assert.equal(sidecarLockRoot(), join(tmpdir(), 'cw-root-after-import'));
      assert.equal(sidecarLockDir('/somewhere/my-repo'), join(tmpdir(), 'cw-root-after-import', 'my-repo'));
    } finally {
      if (prev === undefined) delete process.env.CW_LOCKFILE_ROOT; else process.env.CW_LOCKFILE_ROOT = prev;
    }
  });

  test('an explicit env object wins over process.env, so callers can pin the root without mutating the process', () => {
    const env = { CW_LOCKFILE_ROOT: '/pinned/root' };
    assert.equal(sidecarLockRoot(env), '/pinned/root');
    assert.equal(sidecarLockDir('/a/b/repo-x', env), '/pinned/root/repo-x');
    assert.equal(sidecarLockDir(null, env), null, 'no repo path means no directory, never the bare root');
  });
});

describe('a sidecar lock makes the ecosystem ok, and the verdict says where the lock is', () => {
  test('blind without the sidecar dir; ok with lockSource sidecar when the lock is there', () => {
    const d = mk({ 'package.json': NODE_MANIFEST });
    const lockDir = mk({ 'package-lock.json': '{"lockfileVersion":3,"packages":{}}' }, 'cw-pfs-lock-');
    try {
      assert.deepEqual(classify(d).map((e) => [e.eco, e.state, e.lockSource]), [['node', 'blind', null]]);
      const withSidecar = classify(d, { lockDir });
      assert.deepEqual(withSidecar.map((e) => [e.eco, e.state, e.lockSource]), [['node', 'ok', 'sidecar']]);
      assert.equal(withSidecar[0].lockDir, lockDir, 'the directory the scanner will be handed is named on the verdict');
      assert.equal(withSidecar[0].lockMissing, null);
    } finally { rmSync(d, { recursive: true, force: true }); rmSync(lockDir, { recursive: true, force: true }); }
  });

  test('a lock in the repository wins over a sidecar copy — the project\'s own pin is the one it ships', () => {
    const d = mk({ 'package.json': NODE_MANIFEST, 'package-lock.json': '{"lockfileVersion":3,"packages":{}}' });
    const lockDir = mk({ 'package-lock.json': '{"lockfileVersion":3,"packages":{}}' }, 'cw-pfs-lock-');
    try {
      const e = classify(d, { lockDir })[0];
      assert.equal(e.state, 'ok');
      assert.equal(e.lockSource, 'repo');
      assert.equal(e.lockDir, undefined, 'no sidecar directory is named when the repo pins itself');
    } finally { rmSync(d, { recursive: true, force: true }); rmSync(lockDir, { recursive: true, force: true }); }
  });

  test('a sidecar path that cannot be read is a VOID, not a missing lock — blind, with the cause', () => {
    const d = mk({ 'package.json': NODE_MANIFEST });
    // fact: a file there stats ENOTDIR
    const notADir = mk({ 'sidecar-is-a-file': 'x' }, 'cw-pfs-notdir-');
    try {
      const e = classify(d, { lockDir: join(notADir, 'sidecar-is-a-file') })[0];
      assert.equal(e.state, 'blind');
      assert.equal(e.lockSource, null);
      assert.match(e.why, /could not be read/, 'unknown must not silently become "no lockfile"');
    } finally { rmSync(d, { recursive: true, force: true }); rmSync(notADir, { recursive: true, force: true }); }
  });

  test('verdictFor resolves the sidecar dir from the env it is given, keyed on the repo directory name', () => {
    const d = mk({ 'package.json': NODE_MANIFEST });
    const root = mkdtempSync(join(tmpdir(), 'cw-pfs-root-'));
    try {
      mkdirSync(join(root, basename(d)), { recursive: true });
      writeFileSync(join(root, basename(d), 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}');
      const env = { ...process.env, CW_LOCKFILE_ROOT: root };
      assert.equal(verdictFor({ name: 'r', path: d }, { env }).state, 'ok');
      assert.equal(verdictFor({ name: 'r', path: d }, { env: { ...process.env, CW_LOCKFILE_ROOT: join(root, 'elsewhere') } }).state, 'blind',
        'a root that holds nothing for this repo leaves it blind');
    } finally { rmSync(d, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
  });

  test('the published verdict redacts the sidecar directory, and the repo dir name survives the redaction', () => {
    // fact: root under HOME exercises redaction
    const home = homedir();
    const root = mkdtempSync(join(home, '.cw-pfs-redact-'));
    const d = mk({ 'package.json': NODE_MANIFEST });
    try {
      mkdirSync(join(root, basename(d)), { recursive: true });
      writeFileSync(join(root, basename(d), 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}');
      const out = preflight([{ name: 'r', path: d }], { apply: false, env: { ...process.env, CW_LOCKFILE_ROOT: root } });
      const e = out.repos[0].ecosystems[0];
      assert.equal(e.lockSource, 'sidecar');
      assert.ok(e.lockDir.startsWith('~/'), `published lockDir must be home-redacted, got ${e.lockDir}`);
      assert.ok(e.lockDir.endsWith(basename(d)));
      assert.ok(!JSON.stringify(out).includes(home), 'nothing published carries the home directory');
    } finally { rmSync(d, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
  });
});

describe('a build lands in the sidecar by default, and never in the repository', () => {
  test('buildOne(node) writes <root>/<repo dir name>/package-lock.json and reports dest + lockSource', () => {
    const d = mk({ 'package.json': NODE_MANIFEST }, 'cw-pfs-build-');
    const root = mkdtempSync(join(tmpdir(), 'cw-pfs-buildroot-'));
    try {
      const r = buildOne(d, 'node', { timeoutMs: 180_000, env: { ...process.env, CW_LOCKFILE_ROOT: root } });
      if (!r.ok) return;                      // no docker / offline — a different fact, tested elsewhere
      assert.equal(r.lockSource, 'sidecar');
      assert.equal(r.dest, join(root, basename(d)));
      assert.ok(r.wrote.some((p) => p === join(root, basename(d), 'package-lock.json')), JSON.stringify(r.wrote));
      assert.ok(!existsSync(join(d, 'package-lock.json')), 'the repository was not written');
      assert.ok(readdirSync(join(root, basename(d))).includes('package-lock.json'));
    } finally { rmSync(d, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
  });

  test('dest:"repo" is the explicit opt-in that writes into the repository', () => {
    const d = mk({ 'package.json': NODE_MANIFEST }, 'cw-pfs-intorepo-');
    const root = mkdtempSync(join(tmpdir(), 'cw-pfs-buildroot2-'));
    try {
      const r = buildOne(d, 'node', { timeoutMs: 180_000, dest: 'repo', env: { ...process.env, CW_LOCKFILE_ROOT: root } });
      if (!r.ok) return;
      assert.equal(r.lockSource, 'repo');
      assert.ok(existsSync(join(d, 'package-lock.json')));
      assert.ok(!existsSync(join(root, basename(d))), 'nothing landed in the sidecar');
    } finally { rmSync(d, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
  });
});
