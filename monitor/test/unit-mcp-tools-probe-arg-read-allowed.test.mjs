// Checks whether a path is allowed for read access (monitor/mcp-tools-probe.mjs argReadAllowed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argReadAllowed } from '../mcp-tools-probe.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns false when path equals home', () => {
  const dir = mkdtempSync(join(tmpdir(), 'argReadAllowed-'));
  try {
    const home = realpathSync(dir);
    const r = argReadAllowed(home, home);
    assert.equal(r, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when home is inside path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'argReadAllowed-'));
  try {
    const parent = realpathSync(dir);
    const home = join(parent, 'sub');
    mkdirSync(home, { recursive: true });
    const r = argReadAllowed(parent, home);
    assert.equal(r, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true for path under home that is mount allowed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'argReadAllowed-'));
  try {
    const home = realpathSync(dir);
    const p = join(home, 'file.txt');
    writeFileSync(p, 'data');
    const r = argReadAllowed(p, home);
    assert.equal(r, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false for path under home that is not mount allowed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'argReadAllowed-'));
  try {
    const home = realpathSync(dir);
    const p = join(home, 'secret');
    writeFileSync(p, 'x');
    const r = argReadAllowed(p, home);
    assert.equal(r, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true for path outside home that is mount allowed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'argReadAllowed-'));
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

test('returns false for path outside home that is not mount allowed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'argReadAllowed-'));
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
  const dir = mkdtempSync(join(tmpdir(), 'argReadAllowed-'));
  try {
    const ancestor = realpathSync(dir);
    const home = join(ancestor, 'a', 'b');
    mkdirSync(home, { recursive: true });
    const r = argReadAllowed(ancestor, home);
    assert.equal(r, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true for sibling path of home that is mount allowed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'argReadAllowed-'));
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
