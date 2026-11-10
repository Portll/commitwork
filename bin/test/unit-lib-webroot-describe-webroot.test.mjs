// Describes the web root: git presence, WordPress layout and core version, and unmeasured checks (bin/lib/webroot.mjs describeWebroot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeWebroot } from '../lib/webroot.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns git false and no platform when the directory is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'describeWebroot-'));
  try {
    const out = describeWebroot(dir);
    assert.deepEqual(out, {
      git: false,
      platform: null,
      notMeasured: [
        {
          check: 'target',
          kind: 'scope',
          reason: 'not a git repository: the history lanes (secrets in history, commit provenance, commit velocity) do not apply, and there is no deployed commit to compare the tree against',
        },
      ],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns git true and no platform when only a .git file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'describeWebroot-'));
  try {
    writeFileSync(join(dir, '.git'), '');
    const out = describeWebroot(dir);
    assert.deepEqual(out, { git: true, platform: null, notMeasured: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detects a WordPress site root via wp-includes directory and reports the core version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'describeWebroot-'));
  try {
    mkdirSync(join(dir, 'wp-includes'), { recursive: true });
    writeFileSync(join(dir, 'wp-includes', 'version.php'), "<?php\n$wp_version = '6.4.2';\n");
    const out = describeWebroot(dir);
    assert.deepEqual(out, {
      git: false,
      platform: 'wordpress',
      wordpress: { layout: 'site-root', core: 'present', version: '6.4.2' },
      notMeasured: [
        {
          check: 'target',
          kind: 'scope',
          reason: 'not a git repository: the history lanes (secrets in history, commit provenance, commit velocity) do not apply, and there is no deployed commit to compare the tree against',
        },
      ],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detects a WordPress site root via wp-config.php file and reports core absent when version.php is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'describeWebroot-'));
  try {
    writeFileSync(join(dir, 'wp-config.php'), '');
    const out = describeWebroot(dir);
    assert.deepEqual(out, {
      git: false,
      platform: 'wordpress',
      wordpress: { layout: 'site-root', core: 'absent', version: null },
      notMeasured: [
        {
          check: 'target',
          kind: 'scope',
          reason: 'not a git repository: the history lanes (secrets in history, commit provenance, commit velocity) do not apply, and there is no deployed commit to compare the tree against',
        },
        {
          check: 'target',
          kind: 'scope',
          reason: 'WordPress site root without wp-includes/version.php: the core version and core file integrity are not measured',
        },
      ],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detects a WordPress site root via wp-load.php file and reports core unreadable when version.php has no wp_version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'describeWebroot-'));
  try {
    writeFileSync(join(dir, 'wp-load.php'), '');
    mkdirSync(join(dir, 'wp-includes'), { recursive: true });
    writeFileSync(join(dir, 'wp-includes', 'version.php'), "<?php\n// no version here\n");
    const out = describeWebroot(dir);
    assert.deepEqual(out, {
      git: false,
      platform: 'wordpress',
      wordpress: { layout: 'site-root', core: 'unreadable', version: null },
      notMeasured: [
        {
          check: 'target',
          kind: 'scope',
          reason: 'not a git repository: the history lanes (secrets in history, commit provenance, commit velocity) do not apply, and there is no deployed commit to compare the tree against',
        },
        {
          check: 'target',
          kind: 'void',
          reason: 'WordPress core version could not be read: no $wp_version assignment in wp-includes/version.php',
        },
      ],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detects a wp-content layout when the directory is named wp-content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'describeWebroot-'));
  try {
    const contentDir = join(dir, 'wp-content');
    mkdirSync(contentDir, { recursive: true });
    const out = describeWebroot(contentDir);
    assert.deepEqual(out, {
      git: false,
      platform: 'wordpress',
      wordpress: { layout: 'wp-content', core: 'absent', version: null },
      notMeasured: [
        {
          check: 'target',
          kind: 'scope',
          reason: 'not a git repository: the history lanes (secrets in history, commit provenance, commit velocity) do not apply, and there is no deployed commit to compare the tree against',
        },
        {
          check: 'target',
          kind: 'scope',
          reason: 'WordPress wp-content only: core is not in the scanned tree, so the core version and core file integrity are not measured, and nothing beside wp-content in the web root (wp-config.php, the root .htaccess, a file dropped there) was examined',
        },
      ],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detects a wp-content layout when plugins and themes directories and index.php file exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'describeWebroot-'));
  try {
    const contentDir = join(dir, 'my-content');
    mkdirSync(join(contentDir, 'plugins'), { recursive: true });
    mkdirSync(join(contentDir, 'themes'), { recursive: true });
    writeFileSync(join(contentDir, 'index.php'), '');
    const out = describeWebroot(contentDir);
    assert.equal(out.platform, 'wordpress');
    assert.equal(out.wordpress.layout, 'wp-content');
    assert.equal(out.wordpress.core, 'absent');
    assert.equal(out.wordpress.version, null);
    assert.equal(out.notMeasured.length, 2);
    assert.equal(out.notMeasured[1].kind, 'scope');
    assert.match(out.notMeasured[1].reason, /wp-content only/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detects a wp-content layout when plugins and themes directories and uploads directory exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'describeWebroot-'));
  try {
    const contentDir = join(dir, 'my-content');
    mkdirSync(join(contentDir, 'plugins'), { recursive: true });
    mkdirSync(join(contentDir, 'themes'), { recursive: true });
    mkdirSync(join(contentDir, 'uploads'), { recursive: true });
    const out = describeWebroot(contentDir);
    assert.equal(out.platform, 'wordpress');
    assert.equal(out.wordpress.layout, 'wp-content');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detects a WordPress site root via wp-content directory when the directory is not named wp-content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'describeWebroot-'));
  try {
    const siteDir = join(dir, 'mysite');
    mkdirSync(join(siteDir, 'wp-content'), { recursive: true });
    const out = describeWebroot(siteDir);
    assert.equal(out.platform, 'wordpress');
    assert.equal(out.wordpress.layout, 'site-root');
    assert.equal(out.wordpress.core, 'absent');
    assert.equal(out.wordpress.version, null);
    assert.equal(out.notMeasured.length, 2);
    assert.match(out.notMeasured[1].reason, /without wp-includes\/version\.php/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns git true and no platform when a .git directory exists alongside wp-content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'describeWebroot-'));
  try {
    const siteDir = join(dir, 'mysite');
    mkdirSync(join(siteDir, '.git'), { recursive: true });
    mkdirSync(join(siteDir, 'wp-content'), { recursive: true });
    const out = describeWebroot(siteDir);
    assert.equal(out.git, true);
    assert.equal(out.platform, 'wordpress');
    assert.equal(out.wordpress.layout, 'site-root');
    assert.equal(out.notMeasured.length, 1);
    assert.match(out.notMeasured[0].reason, /without wp-includes\/version\.php/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
