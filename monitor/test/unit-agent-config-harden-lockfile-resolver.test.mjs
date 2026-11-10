// Resolves a package version from package-lock.json (monitor/agent-config-harden.mjs lockfileResolver).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockfileResolver } from '../agent-config-harden.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when package-lock.json is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lockfileResolver-'));
  try {
    const r = lockfileResolver(dir)('left-pad');
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when package-lock.json is invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lockfileResolver-'));
  try {
    writeFileSync(join(dir, 'package-lock.json'), 'not json');
    const r = lockfileResolver(dir)('left-pad');
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns version from packages field when present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lockfileResolver-'));
  try {
    const lock = { packages: { 'node_modules/left-pad': { version: '1.3.0' } } };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    const r = lockfileResolver(dir)('left-pad');
    assert.equal(r, "1.3.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when packages exists but entry is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lockfileResolver-'));
  try {
    const lock = { packages: { 'node_modules/other': { version: '2.0.0' } } };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    const r = lockfileResolver(dir)('left-pad');
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns version from dependencies field when packages is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lockfileResolver-'));
  try {
    const lock = { dependencies: { 'left-pad': { version: '1.3.0' } } };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    const r = lockfileResolver(dir)('left-pad');
    assert.equal(r, "1.3.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when dependencies exists but entry is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lockfileResolver-'));
  try {
    const lock = { dependencies: { 'other': { version: '2.0.0' } } };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    const r = lockfileResolver(dir)('left-pad');
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when version is not a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lockfileResolver-'));
  try {
    const lock = { packages: { 'node_modules/left-pad': { version: 123 } } };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    const r = lockfileResolver(dir)('left-pad');
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when lock has no packages or dependencies fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lockfileResolver-'));
  try {
    const lock = { name: 'test', version: '1.0.0' };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    const r = lockfileResolver(dir)('left-pad');
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
