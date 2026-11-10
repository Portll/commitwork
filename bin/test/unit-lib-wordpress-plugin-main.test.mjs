// Computes the main plugin file, name, and version from a WordPress plugin directory (bin/lib/wordpress.mjs pluginMain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pluginMain } from '../lib/wordpress.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an error object when the directory cannot be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pluginMain-'));
  try {
    const r = pluginMain(join(dir, 'missing'), 'myplugin');
    assert.deepEqual(r, { error: "readdir failed: ENOENT" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns main null and unreadable list when no valid plugin files exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pluginMain-'));
  try {
    writeFileSync(join(dir, 'readme.txt'), 'not a php file');
    writeFileSync(join(dir, '.hidden.php'), '<?php');
    const r = pluginMain(dir, 'myplugin');
    assert.deepEqual(r, { main: null, unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the matching plugin file when the slug matches a file name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pluginMain-'));
  try {
    writeFileSync(join(dir, 'myplugin.php'), '<?php\n/*\nPlugin Name: My Plugin\nVersion: 1.0\n*/');
    writeFileSync(join(dir, 'other.php'), '<?php\n/*\nPlugin Name: Other\nVersion: 2.0\n*/');
    const r = pluginMain(dir, 'myplugin');
    assert.deepEqual(r, { main: "myplugin.php", name: "My Plugin", version: "1.0", mains: ["myplugin.php", "other.php"], unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the first plugin file when the slug does not match any file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pluginMain-'));
  try {
    writeFileSync(join(dir, 'alpha.php'), '<?php\n/*\nPlugin Name: Alpha\nVersion: 1.0\n*/');
    writeFileSync(join(dir, 'beta.php'), '<?php\n/*\nPlugin Name: Beta\nVersion: 2.0\n*/');
    const r = pluginMain(dir, 'gamma');
    assert.deepEqual(r, { main: "alpha.php", name: "Alpha", version: "1.0", mains: ["alpha.php", "beta.php"], unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the second plugin file when the slug matches the second file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pluginMain-'));
  try {
    writeFileSync(join(dir, 'alpha.php'), '<?php\n/*\nPlugin Name: Alpha\nVersion: 1.0\n*/');
    writeFileSync(join(dir, 'beta.php'), '<?php\n/*\nPlugin Name: Beta\nVersion: 2.0\n*/');
    const r = pluginMain(dir, 'beta');
    assert.deepEqual(r, { main: "beta.php", name: "Beta", version: "2.0", mains: ["alpha.php", "beta.php"], unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes a version of null when the plugin file has no Version header', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pluginMain-'));
  try {
    writeFileSync(join(dir, 'myplugin.php'), '<?php\n/*\nPlugin Name: My Plugin\n*/');
    const r = pluginMain(dir, 'myplugin');
    assert.deepEqual(r, { main: "myplugin.php", name: "My Plugin", version: null, mains: ["myplugin.php"], unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips a php file that has no Plugin Name header', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pluginMain-'));
  try {
    writeFileSync(join(dir, 'noheader.php'), '<?php\n/*\nVersion: 1.0\n*/');
    writeFileSync(join(dir, 'valid.php'), '<?php\n/*\nPlugin Name: Valid\nVersion: 1.0\n*/');
    const r = pluginMain(dir, 'valid');
    assert.deepEqual(r, { main: "valid.php", name: "Valid", version: "1.0", mains: ["valid.php"], unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns main null when all php files lack a Plugin Name header', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pluginMain-'));
  try {
    writeFileSync(join(dir, 'noheader.php'), '<?php\n/*\nVersion: 1.0\n*/');
    const r = pluginMain(dir, 'noheader');
    assert.deepEqual(r, { main: null, unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
