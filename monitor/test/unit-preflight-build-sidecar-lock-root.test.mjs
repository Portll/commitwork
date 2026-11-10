// Sidecar lockfile root from env or the evaluations symlink (monitor/preflight-build.mjs sidecarLockRoot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sidecarLockRoot } from '../preflight-build.mjs';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE = readFileSync(fileURLToPath(new URL('../preflight-build.mjs', import.meta.url)), 'utf8');
const START = SOURCE.indexOf('export function sidecarLockRoot');
const FUNCTION_TEXT = SOURCE.slice(START, SOURCE.indexOf('\n}', START) + 2);
const PREAMBLE = [
  "import { lstatSync, realpathSync } from 'node:fs';",
  "import { dirname, join, resolve } from 'node:path';",
  "import { fileURLToPath } from 'node:url';",
  'const HERE = dirname(fileURLToPath(import.meta.url));',
  "const CW = resolve(HERE, '..');",
].join('\n');

async function withCheckout(arrange, verify) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sidecarLockRoot-')));
  try {
    const file = join(dir, 'monitor', 'sidecar-lock-root.mjs');
    mkdirSync(join(dir, 'monitor'));
    writeFileSync(file, `${PREAMBLE}\n${FUNCTION_TEXT}\n`);
    arrange(dir);
    const loaded = await import(pathToFileURL(file).href);
    verify(loaded.sidecarLockRoot, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function linkEvaluationsToSidecar(dir) {
  mkdirSync(join(dir, 'sidecar', 'evaluations'), { recursive: true });
  symlinkSync(join(dir, 'sidecar', 'evaluations'), join(dir, 'evaluations'));
}

test('an absolute CW_LOCKFILE_ROOT is returned unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sidecarLockRoot-'));
  try {
    assert.equal(sidecarLockRoot({ CW_LOCKFILE_ROOT: join(dir, 'custom') }), join(dir, 'custom'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a relative CW_LOCKFILE_ROOT is normalized against the working directory', () => {
  assert.equal(sidecarLockRoot({ CW_LOCKFILE_ROOT: 'locks/../custom' }), join(process.cwd(), 'custom'));
});

test('the env argument defaults to process.env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sidecarLockRoot-'));
  const saved = process.env.CW_LOCKFILE_ROOT;
  try {
    process.env.CW_LOCKFILE_ROOT = join(dir, 'from-process');
    assert.equal(sidecarLockRoot(), join(dir, 'from-process'));
  } finally {
    if (saved === undefined) delete process.env.CW_LOCKFILE_ROOT;
    else process.env.CW_LOCKFILE_ROOT = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a symlinked evaluations directory puts lockfiles beside its target', async () => {
  await withCheckout(linkEvaluationsToSidecar, (lockRoot, dir) => {
    assert.equal(lockRoot({}), join(dir, 'sidecar', 'lockfiles'));
  });
});

test('a chain of symlinks is followed to the final target', async () => {
  await withCheckout((dir) => {
    mkdirSync(join(dir, 'final', 'store'), { recursive: true });
    symlinkSync(join(dir, 'final', 'store'), join(dir, 'hop'));
    symlinkSync(join(dir, 'hop'), join(dir, 'evaluations'));
  }, (lockRoot, dir) => {
    assert.equal(lockRoot({}), join(dir, 'final', 'lockfiles'));
  });
});

test('an empty CW_LOCKFILE_ROOT falls through to the evaluations symlink', async () => {
  await withCheckout(linkEvaluationsToSidecar, (lockRoot, dir) => {
    assert.equal(lockRoot({ CW_LOCKFILE_ROOT: '' }), join(dir, 'sidecar', 'lockfiles'));
  });
});

test('CW_LOCKFILE_ROOT wins over an evaluations symlink', async () => {
  await withCheckout(linkEvaluationsToSidecar, (lockRoot, dir) => {
    assert.equal(lockRoot({ CW_LOCKFILE_ROOT: join(dir, 'custom') }), join(dir, 'custom'));
  });
});

test('a real evaluations directory is not a sidecar', async () => {
  await withCheckout((dir) => {
    mkdirSync(join(dir, 'evaluations'));
  }, (lockRoot) => {
    assert.equal(lockRoot({}), null);
  });
});

test('a missing evaluations path has no sidecar', async () => {
  await withCheckout(() => {}, (lockRoot) => {
    assert.equal(lockRoot({}), null);
  });
});

test('a dangling evaluations symlink has no sidecar', async () => {
  await withCheckout((dir) => {
    symlinkSync(join(dir, 'gone'), join(dir, 'evaluations'));
  }, (lockRoot) => {
    assert.equal(lockRoot({}), null);
  });
});
