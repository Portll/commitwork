// Resolves a tag string to its registry record or a fresh parsed record (bin/agent-tag.mjs resolveTag).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTag } from '../agent-tag.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when tag is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTag-'));
  try {
    assert.equal(resolveTag(null), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when tag is empty string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTag-'));
  try {
    assert.equal(resolveTag(''), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when tag is undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTag-'));
  try {
    assert.equal(resolveTag(undefined), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for tag with lowercase type prefix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTag-'));
  try {
    assert.equal(resolveTag('ab-001-ctx'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for tag with single digit number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTag-'));
  try {
    assert.equal(resolveTag('AB-1-ctx'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for tag with uppercase context', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTag-'));
  try {
    assert.equal(resolveTag('AB-001-Ctx'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for tag with type shorter than 2 chars', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTag-'));
  try {
    assert.equal(resolveTag('A-001-ctx'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for tag with type longer than 12 chars', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTag-'));
  try {
    const longType = 'A'.repeat(13);
    assert.equal(resolveTag(`${longType}-001-ctx`), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for tag with context longer than 32 chars', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTag-'));
  try {
    const longCtx = 'a'.repeat(33);
    assert.equal(resolveTag(`AB-001-${longCtx}`), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for tag with context starting with hyphen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTag-'));
  try {
    assert.equal(resolveTag('AB-001--ctx'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
