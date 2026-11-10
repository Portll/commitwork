// The WordPress installs found under a scan root, with skipped and unreadable paths (bin/lib/wordpress.mjs findInstalls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findInstalls } from '../lib/wordpress.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const PLUGIN = '<?php\n/**\n * Plugin Name: My Plug\n * Version: 1.0\n */\n';
const absent = { state: 'absent', version: null, locale: null };

const inTmp = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'findInstalls-'));
  try { fn(join(dir, 'repo'), dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

const put = (file, body = '<?php') => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
};

const siteAt = (root, rel, withContent = false) => ({
  path: rel,
  abs: join(root, rel),
  layout: 'site-root',
  contentAbs: withContent ? join(root, rel, 'wp-content') : null,
  contentLink: false,
  contentPath: withContent ? `${rel}/wp-content` : null,
  core: absent,
});

test('wp-includes/version.php alone makes a site root whose core is unreadable without a $wp_version', () => {
  inTmp((root) => {
    put(join(root, 'site', 'wp-includes', 'version.php'));
    put(join(root, 'notes.txt'), 'x');
    const core = { state: 'unreadable', version: null, locale: null, reason: 'no $wp_version assignment in wp-includes/version.php' };
    assert.deepEqual(findInstalls(root), { installs: [{ ...siteAt(root, 'site'), core }], skippedPaths: [], unreadable: [] });
  });
});

test('wp-load.php alone makes a site root and the walk does not go below it', () => {
  inTmp((root) => {
    put(join(root, 'site', 'wp-load.php'));
    put(join(root, 'site', 'inner', 'wp-load.php'));
    assert.deepEqual(findInstalls(root), { installs: [siteAt(root, 'site')], skippedPaths: [], unreadable: [] });
  });
});

test('wp-config.php beside an empty wp-content makes a site root', () => {
  inTmp((root) => {
    put(join(root, 'site', 'wp-config.php'));
    mkdirSync(join(root, 'site', 'wp-content'));
    assert.deepEqual(findInstalls(root), { installs: [siteAt(root, 'site', true)], skippedPaths: [], unreadable: [] });
  });
});

test('a wp-content holding a plugin makes its parent a site root without wp-config.php', () => {
  inTmp((root) => {
    put(join(root, 'site', 'wp-content', 'plugins', 'myplug', 'myplug.php'), PLUGIN);
    assert.deepEqual(findInstalls(root), { installs: [siteAt(root, 'site', true)], skippedPaths: [], unreadable: [] });
  });
});

test('a scan root named wp-content that holds a plugin is a wp-content install at the root', () => {
  inTmp((_, dir) => {
    const root = join(dir, 'wp-content');
    put(join(root, 'plugins', 'myplug', 'myplug.php'), PLUGIN);
    assert.deepEqual(findInstalls(root), {
      installs: [{ path: '.', abs: root, layout: 'wp-content', contentAbs: root, contentLink: false, contentPath: '.', core: absent }],
      skippedPaths: [],
      unreadable: [],
    });
  });
});

test('plugins outside a wp-content and a wp-content with no component are walked through, not taken as installs', () => {
  inTmp((root) => {
    put(join(root, 'lib', 'plugins', 'myplug', 'myplug.php'), PLUGIN);
    mkdirSync(join(root, 'proj', 'wp-content', 'plugins'), { recursive: true });
    mkdirSync(join(root, 'proj', 'wp-content', 'themes', 'bare'), { recursive: true });
    assert.deepEqual(findInstalls(root), { installs: [], skippedPaths: [], unreadable: [] });
  });
});

test('by default a site four directories down is found and one five down is not', () => {
  inTmp((root) => {
    put(join(root, 'a', 'b', 'c', 'site', 'wp-load.php'));
    put(join(root, 'v', 'w', 'x', 'y', 'site', 'wp-load.php'));
    assert.deepEqual(findInstalls(root), { installs: [siteAt(root, 'a/b/c/site')], skippedPaths: [], unreadable: [] });
  });
});

test('maxDepth 2 finds a site at depth 2 and stops before one at depth 3', () => {
  inTmp((root) => {
    put(join(root, 'a', 'site', 'wp-load.php'));
    put(join(root, 'b', 'c', 'site', 'wp-load.php'));
    assert.deepEqual(findInstalls(root, { maxDepth: 2 }), { installs: [siteAt(root, 'a/site')], skippedPaths: [], unreadable: [] });
  });
});

test('a skip entry matches a bare directory name at any depth or an exact relative path', () => {
  inTmp((root) => {
    put(join(root, 'pkg', 'node_modules', 'site', 'wp-load.php'));
    put(join(root, 'pkg', 'vendor', 'site', 'wp-load.php'));
    put(join(root, 'other', 'vendor', 'site', 'wp-load.php'));
    const r = findInstalls(root, { skip: new Set(['node_modules', 'pkg/vendor']) });
    assert.deepEqual(r, {
      installs: [siteAt(root, 'other/vendor/site')],
      skippedPaths: ['pkg/node_modules', 'pkg/vendor'],
      unreadable: [],
    });
  });
});

test('a directory that cannot be listed is reported as unreadable by its relative path', () => {
  inTmp((root) => {
    const locked = join(root, 'locked');
    mkdirSync(locked, { recursive: true });
    mkdirSync(join(root, 'open'));
    chmodSync(locked, 0o000);
    try {
      assert.deepEqual(findInstalls(root), {
        installs: [],
        skippedPaths: [],
        unreadable: [{ path: 'locked', why: 'readdir failed: EACCES' }],
      });
    } finally {
      chmodSync(locked, 0o755);
    }
  });
});
