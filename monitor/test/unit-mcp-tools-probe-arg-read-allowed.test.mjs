// Checks whether a path is allowed for read access (monitor/mcp-tools-probe.mjs argReadAllowed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argReadAllowed } from '../mcp-tools-probe.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// macOS's tmpdir is under /var/folders, a symlink to /private/var; realpath the fixture so the
// ancestor comparison is the same on every host.
const fixture = () => realpathSync(mkdtempSync(join(tmpdir(), 'argReadAllowed-')));

test('returns false when path equals home', () => {
  const dir = fixture();
  try {
    const home = dir;
    const r = argReadAllowed(home, home);
    assert.equal(r, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when home is inside path', () => {
  const dir = fixture();
  try {
    const home = join(dir, 'sub');
    mkdirSync(home, { recursive: true });
    const r = argReadAllowed(dir, home);
    assert.equal(r, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true for path under home that is mount allowed', () => {
  const dir = fixture();
  try {
    const home = dir;
    const p = join(home, 'file.txt');
    writeFileSync(p, 'data');
    const r = argReadAllowed(p, home);
    assert.equal(r, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true for path under home that is not a forbidden mount', () => {
  const dir = fixture();
  try {
    const home = dir;
    const p = join(home, 'secret');
    writeFileSync(p, 'x');
    const r = argReadAllowed(p, home);
    assert.equal(r, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true for path outside home that is mount allowed', () => {
  const dir = fixture();
  try {
    const home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    const p = join(dir, 'outside.txt');
    writeFileSync(p, 'data');
    const r = argReadAllowed(p, home);
    assert.equal(r, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true for path outside home that is not a forbidden mount', () => {
  const dir = fixture();
  try {
    const home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    const p = join(dir, 'forbidden');
    writeFileSync(p, 'x');
    const r = argReadAllowed(p, home);
    assert.equal(r, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when path is home parent and home is child', () => {
  const dir = fixture();
  try {
    const home = join(dir, 'a', 'b');
    mkdirSync(home, { recursive: true });
    const r = argReadAllowed(dir, home);
    assert.equal(r, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true for sibling path of home that is mount allowed', () => {
  const dir = fixture();
  try {
    const home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    const p = join(dir, 'sibling.txt');
    writeFileSync(p, 'data');
    const r = argReadAllowed(p, home);
    assert.equal(r, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false for a symlink that resolves to home or to an ancestor of home', () => {
  const dir = fixture();
  try {
    const home = join(dir, 'a', 'home');
    mkdirSync(home, { recursive: true });
    const toHome = join(dir, 'link-to-home');
    const toAncestor = join(dir, 'link-to-ancestor');
    symlinkSync(home, toHome);
    symlinkSync(join(dir, 'a'), toAncestor);
    assert.equal(argReadAllowed(toHome, home), false);
    assert.equal(argReadAllowed(toAncestor, home), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
