// Extracts the WordPress core version from wp-includes/version.php (bin/lib/webroot.mjs wordpressCoreVersion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordpressCoreVersion } from '../lib/webroot.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when wp-includes/version.php does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressCoreVersion-'));
  try {
    const result = wordpressCoreVersion(dir);
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns version when wp-includes/version.php contains a valid $wp_version assignment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressCoreVersion-'));
  try {
    const wpIncludesDir = join(dir, 'wp-includes');
    mkdirSync(wpIncludesDir, { recursive: true });
    writeFileSync(join(wpIncludesDir, 'version.php'), "<?php\n$wp_version = '6.4.2';\n");
    const result = wordpressCoreVersion(dir);
    assert.deepEqual(result, { version: '6.4.2' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns version when $wp_version uses double quotes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressCoreVersion-'));
  try {
    const wpIncludesDir = join(dir, 'wp-includes');
    mkdirSync(wpIncludesDir, { recursive: true });
    writeFileSync(join(wpIncludesDir, 'version.php'), "<?php\n$wp_version = \"6.5.0\";\n");
    const result = wordpressCoreVersion(dir);
    assert.deepEqual(result, { version: '6.5.0' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable error when file exists but has no $wp_version assignment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressCoreVersion-'));
  try {
    const wpIncludesDir = join(dir, 'wp-includes');
    mkdirSync(wpIncludesDir, { recursive: true });
    writeFileSync(join(wpIncludesDir, 'version.php'), "<?php\n// no version here\n");
    const result = wordpressCoreVersion(dir);
    assert.deepEqual(result, { unreadable: 'no $wp_version assignment in wp-includes/version.php' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns version when $wp_version has spaces around equals sign', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressCoreVersion-'));
  try {
    const wpIncludesDir = join(dir, 'wp-includes');
    mkdirSync(wpIncludesDir, { recursive: true });
    writeFileSync(join(wpIncludesDir, 'version.php'), "<?php\n$wp_version   =   '6.3.1';\n");
    const result = wordpressCoreVersion(dir);
    assert.deepEqual(result, { version: '6.3.1' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable error when file content is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressCoreVersion-'));
  try {
    const wpIncludesDir = join(dir, 'wp-includes');
    mkdirSync(wpIncludesDir, { recursive: true });
    writeFileSync(join(wpIncludesDir, 'version.php'), '');
    const result = wordpressCoreVersion(dir);
    assert.deepEqual(result, { unreadable: 'no $wp_version assignment in wp-includes/version.php' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns version for a version string with dots and numbers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressCoreVersion-'));
  try {
    const wpIncludesDir = join(dir, 'wp-includes');
    mkdirSync(wpIncludesDir, { recursive: true });
    writeFileSync(join(wpIncludesDir, 'version.php'), "<?php\n$wp_version = '5.9.9';\n");
    const result = wordpressCoreVersion(dir);
    assert.deepEqual(result, { version: '5.9.9' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable error when $wp_version is present but not assigned a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordpressCoreVersion-'));
  try {
    const wpIncludesDir = join(dir, 'wp-includes');
    mkdirSync(wpIncludesDir, { recursive: true });
    writeFileSync(join(wpIncludesDir, 'version.php'), "<?php\n$wp_version = 6.4;\n");
    const result = wordpressCoreVersion(dir);
    assert.deepEqual(result, { unreadable: 'no $wp_version assignment in wp-includes/version.php' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
