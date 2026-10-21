// Applies a plan of filesystem steps (bin/init.mjs applyInit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyInit } from '../init.mjs';
import { mkdtempSync, rmSync, existsSync, lstatSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('creates the directory for a create-dir step', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyInit-'));
  try {
    const target = join(dir, 'newdir');
    applyInit({ steps: [{ action: 'create-dir', path: target }] });
    assert.ok(existsSync(target));
    assert.ok(lstatSync(target).isDirectory());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates target directory and symlink for create-and-link action', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyInit-'));
  try {
    const target = join(dir, 'target');
    const linkPath = join(dir, 'links', 'mylink');
    applyInit({ steps: [{ action: 'create-and-link', path: linkPath, target }] });
    assert.ok(existsSync(target));
    assert.ok(lstatSync(linkPath).isSymbolicLink());
    assert.ok(existsSync(linkPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates target directory and symlink for link action', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyInit-'));
  try {
    const target = join(dir, 'target2');
    const linkPath = join(dir, 'links2', 'mylink2');
    applyInit({ steps: [{ action: 'link', path: linkPath, target }] });
    assert.ok(existsSync(target));
    assert.ok(lstatSync(linkPath).isSymbolicLink());
    assert.ok(existsSync(linkPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes registry file with formatted JSON for write action', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyInit-'));
  try {
    const filePath = join(dir, 'registry.json');
    const registry = { name: 'test', version: '1.0.0' };
    applyInit({ steps: [{ action: 'write', path: filePath, registry }] });
    const content = readFileSync(filePath, 'utf8');
    assert.equal(content, `${JSON.stringify(registry, null, 2)}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles multiple steps in sequence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyInit-'));
  try {
    const dirPath = join(dir, 'mydir');
    const target = join(dir, 'target3');
    const linkPath = join(dir, 'links3', 'mylink3');
    const filePath = join(dir, 'reg.json');
    const registry = { a: 1 };
    applyInit({
      steps: [
        { action: 'create-dir', path: dirPath },
        { action: 'create-and-link', path: linkPath, target },
        { action: 'write', path: filePath, registry }
      ]
    });
    assert.ok(existsSync(dirPath));
    assert.ok(lstatSync(linkPath).isSymbolicLink());
    assert.ok(existsSync(filePath));
    assert.equal(readFileSync(filePath, 'utf8'), `${JSON.stringify(registry, null, 2)}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles empty steps array without error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyInit-'));
  try {
    applyInit({ steps: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores unknown action types', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyInit-'));
  try {
    applyInit({ steps: [{ action: 'unknown', path: join(dir, 'x') }] });
    assert.ok(!existsSync(join(dir, 'x')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates nested directories for symlink parent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyInit-'));
  try {
    const target = join(dir, 'deep', 'target');
    const linkPath = join(dir, 'a', 'b', 'c', 'link');
    applyInit({ steps: [{ action: 'link', path: linkPath, target }] });
    assert.ok(existsSync(target));
    assert.ok(lstatSync(linkPath).isSymbolicLink());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
