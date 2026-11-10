// Computes the WordPress core state, version, and locale for a site (bin/lib/wordpress.mjs coreOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coreOf } from '../lib/wordpress.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns absent when the site has no wp-includes directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coreOf-'));
  try {
    const site = join(dir, 'site');
    mkdirSync(site, { recursive: true });
    const r = coreOf(site);
    assert.deepEqual(r, { state: "absent", version: null, locale: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present with default locale when version.php has no wp_local_package', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coreOf-'));
  try {
    const site = join(dir, 'site');
    const inc = join(site, 'wp-includes');
    mkdirSync(inc, { recursive: true });
    writeFileSync(join(inc, 'version.php'), '<?php $wp_version = "6.5.0";');
    const r = coreOf(site);
    assert.deepEqual(r, { state: "present", version: "6.5.0", locale: "en_US" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present with locale parsed from wp_local_package in version.php', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coreOf-'));
  try {
    const site = join(dir, 'site');
    const inc = join(site, 'wp-includes');
    mkdirSync(inc, { recursive: true });
    writeFileSync(join(inc, 'version.php'), '<?php $wp_version = "6.5.0"; $wp_local_package = "fr_FR";');
    const r = coreOf(site);
    assert.deepEqual(r, { state: "present", version: "6.5.0", locale: "fr_FR" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present with locale from double-quoted wp_local_package', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coreOf-'));
  try {
    const site = join(dir, 'site');
    const inc = join(site, 'wp-includes');
    mkdirSync(inc, { recursive: true });
    writeFileSync(join(inc, 'version.php'), '<?php $wp_version = "6.4.1"; $wp_local_package = "de_DE";');
    const r = coreOf(site);
    assert.deepEqual(r, { state: "present", version: "6.4.1", locale: "de_DE" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present with default locale when wp_local_package is absent in a longer file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coreOf-'));
  try {
    const site = join(dir, 'site');
    const inc = join(site, 'wp-includes');
    mkdirSync(inc, { recursive: true });
    const filler = 'x'.repeat(100);
    writeFileSync(join(inc, 'version.php'), '<?php $wp_version = "6.3.2";\n' + filler + '\n$other = "val";');
    const r = coreOf(site);
    assert.deepEqual(r, { state: "present", version: "6.3.2", locale: "en_US" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
