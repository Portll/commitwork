// Detects WordPress site root or wp-content layout (bin/lib/webroot.mjs wordpressLayout).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordpressLayout } from '../lib/webroot.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns site-root when wp-includes directory exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressLayout-'));
  try {
    mkdirSync(join(dir, 'wp-includes'));
    assert.equal(wordpressLayout(dir), 'site-root');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns site-root when wp-config.php file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressLayout-'));
  try {
    writeFileSync(join(dir, 'wp-config.php'), '');
    assert.equal(wordpressLayout(dir), 'site-root');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns site-root when wp-load.php file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressLayout-'));
  try {
    writeFileSync(join(dir, 'wp-load.php'), '');
    assert.equal(wordpressLayout(dir), 'site-root');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns wp-content when basename is wp-content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressLayout-'));
  const wpContent = join(dir, 'wp-content');
  mkdirSync(wpContent);
  try {
    assert.equal(wordpressLayout(wpContent), 'wp-content');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns wp-content when plugins and themes dirs exist with index.php file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressLayout-'));
  const content = join(dir, 'content');
  mkdirSync(content, { recursive: true });
  mkdirSync(join(content, 'plugins'));
  mkdirSync(join(content, 'themes'));
  writeFileSync(join(content, 'index.php'), '');
  try {
    assert.equal(wordpressLayout(content), 'wp-content');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns wp-content when plugins and themes dirs exist with uploads dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressLayout-'));
  const content = join(dir, 'content');
  mkdirSync(content, { recursive: true });
  mkdirSync(join(content, 'plugins'));
  mkdirSync(join(content, 'themes'));
  mkdirSync(join(content, 'uploads'));
  try {
    assert.equal(wordpressLayout(content), 'wp-content');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns site-root when wp-content directory exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressLayout-'));
  mkdirSync(join(dir, 'wp-content'));
  try {
    assert.equal(wordpressLayout(dir), 'site-root');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when no WordPress indicators are present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressLayout-'));
  try {
    assert.equal(wordpressLayout(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when plugins and themes exist but no index.php or uploads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressLayout-'));
  const content = join(dir, 'content');
  mkdirSync(content, { recursive: true });
  mkdirSync(join(content, 'plugins'));
  mkdirSync(join(content, 'themes'));
  try {
    assert.equal(wordpressLayout(content), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when only plugins exists without themes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressLayout-'));
  const content = join(dir, 'content');
  mkdirSync(content, { recursive: true });
  mkdirSync(join(content, 'plugins'));
  writeFileSync(join(content, 'index.php'), '');
  try {
    assert.equal(wordpressLayout(content), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
