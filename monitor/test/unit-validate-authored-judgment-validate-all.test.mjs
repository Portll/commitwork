// Provenance, vocabulary and match-field violations across the three authored-judgment stores (monitor/validate-authored-judgment.mjs validateAll).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAll } from '../validate-authored-judgment.mjs';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FILES = ['annotations.json', 'gate-exemptions.json', 'image-acceptance.json'];

const headOf = (m) => {
  const hit = /^(\S+): unreadable \(([A-Z]+): /.exec(m);
  return hit === null ? m : [hit[1], hit[2]];
};

test('returns no violations when the root directory holds none of the stores', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateAll-'));
  try {
    const result = validateAll(dir);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns no violations when the root directory does not exist at all', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateAll-'));
  try {
    const root = join(dir, 'missing', 'repo');
    const result = validateAll(root);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports every store as unreadable with ENOTDIR when the root sits under a regular file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateAll-'));
  try {
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not a directory');
    const root = join(blocker, 'repo');
    const result = validateAll(root);
    const heads = result.map(headOf);
    assert.deepEqual(heads, FILES.map((f) => [f, 'ENOTDIR']));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws the ELOOP stat error when the root passes through a self-referencing symlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateAll-'));
  try {
    const loop = join(dir, 'loop');
    symlinkSync('loop', loop);
    const root = join(loop, 'repo');
    const probe = join(root, '.commitwork-install');
    assert.throws(() => validateAll(root), {
      name: 'Error',
      message: `ELOOP: too many symbolic links encountered, stat '${probe}'`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('names each unreadable store in surface order with the open error inside parentheses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validateAll-'));
  try {
    const blocker = join(dir, 'plain-file');
    writeFileSync(blocker, 'x'.repeat(16));
    const root = join(blocker, 'nested', 'repo');
    const result = validateAll(root);
    const shapes = result.map((m) => [m.slice(0, m.indexOf(' (')), m.includes("ENOTDIR: not a directory, open '"), m.endsWith("')")]);
    assert.deepEqual(shapes, FILES.map((f) => [`${f}: unreadable`, true, true]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
