// Computes WordPress observables from a directory tree (bin/lib/wp-observables.mjs collectTree).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectTree } from '../lib/wp-observables.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('collectTree returns empty observables and all types unmeasured for an empty tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collectTree-'));
  try {
    const result = collectTree(dir);
    assert.deepEqual(result, {
      installs: [],
      measured: new Set(),
      observables: [],
      partial: [],
      skippedPaths: [],
      unmeasured: [
        { type: 'wp-install', why: 'no WordPress install in the tree' },
        { type: 'wp-component', why: 'no WordPress install in the tree' },
        { type: 'wp-option', why: 'no WordPress install in the tree' },
        { type: 'wp-setting', why: 'no WordPress install in the tree' },
        { type: 'wp-user', why: 'no WordPress install in the tree' },
        { type: 'audit-source', why: 'no WordPress install in the tree' },
        { type: 'served-dir', why: 'no WordPress install in the tree' },
        { type: 'file', why: 'no WordPress install in the tree' },
        { type: 'server-directive', why: 'no WordPress install in the tree' },
        { type: 'wp-option', why: 'needs a database dump' },
        { type: 'wp-user', why: 'needs a database dump' },
        { type: 'audit-source', why: 'needs a database dump or a dated log directory' }
      ],
      unreadable: []
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectTree detects a site-root install with wp-config.php and reports wp-setting from table_prefix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collectTree-'));
  try {
    const site = join(dir, 'site');
    const content = join(site, 'wp-content');
    mkdirSync(content, { recursive: true });
    writeFileSync(join(site, 'wp-config.php'), "define('WP_DEBUG', true);\n$table_prefix = 'wp_';");
    writeFileSync(join(site, 'index.php'), '<?php');
    const result = collectTree(dir);
    const obs = result.observables;
    const install = obs.find(o => o.type === 'wp-install');
    const core = obs.find(o => o.type === 'wp-component' && o.kind === 'core');
    const wpConfigPresent = obs.find(o => o.type === 'server-directive' && o.scope === 'wp-config' && o.name === 'present');
    const wpDebug = obs.find(o => o.type === 'server-directive' && o.scope === 'wp-config' && o.name === 'WP_DEBUG');
    const tablePrefix = obs.find(o => o.type === 'wp-setting' && o.key === 'table_prefix_default');
    assert.deepEqual(install, { type: "wp-install", path: "site", layout: "site-root", core: "absent", coreVersion: null, contentPath: "site/wp-content" });
    assert.deepEqual(core, undefined);
    assert.deepEqual(wpConfigPresent, { type: 'server-directive', scope: 'wp-config', path: 'site/wp-config.php', name: 'present', value: true, install: 'site' });
    assert.deepEqual(wpDebug, { type: 'server-directive', scope: 'wp-config', path: 'site/wp-config.php', name: 'WP_DEBUG', value: true, install: 'site' });
    assert.deepEqual(tablePrefix, { type: 'wp-setting', key: 'table_prefix_default', value: true, install: 'site', path: 'site/wp-config.php', from: 'wp-config' });
    assert.deepEqual(result.measured, new Set(['wp-install', 'wp-component', 'server-directive', 'wp-setting', 'served-dir', 'file']));
    assert.deepEqual(result.unmeasured.map(u => u.type).sort(), ['audit-source', 'wp-option', 'wp-user']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectTree respects maxDepth and does not find installs deeper than the limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collectTree-'));
  try {
    const deep = join(dir, 'a', 'b', 'c', 'd', 'e', 'site');
    const content = join(deep, 'wp-content');
    mkdirSync(content, { recursive: true });
    writeFileSync(join(deep, 'wp-config.php'), "define('WP_DEBUG', false);");
    writeFileSync(join(deep, 'index.php'), '<?php');
    const result = collectTree(dir, { maxDepth: 4 });
    assert.deepEqual(result.installs, []);
    assert.deepEqual(result.unmeasured.filter(u => u.type === 'wp-install'), [{ type: 'wp-install', why: 'no WordPress install in the tree' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectTree reports unreadable wp-config.php in partial without throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collectTree-'));
  try {
    const site = join(dir, 'site');
    const content = join(site, 'wp-content');
    mkdirSync(content, { recursive: true });
    writeFileSync(join(site, 'wp-config.php'), "define('WP_DEBUG', false);");
    writeFileSync(join(site, 'index.php'), '<?php');
    chmodSync(join(site, 'wp-config.php'), 0o000);
    const result = collectTree(dir);
    assert.ok(result.partial.some(p => p.includes('wp-config.php') && p.includes('unreadable')));
    chmodSync(join(site, 'wp-config.php'), 0o644);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectTree reports a plugin component with main file from wp-content/plugins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collectTree-'));
  try {
    const site = join(dir, 'site');
    const content = join(site, 'wp-content');
    const plugin = join(content, 'plugins', 'my-plugin');
    mkdirSync(plugin, { recursive: true });
    writeFileSync(join(site, 'wp-config.php'), "define('WP_DEBUG', false);");
    writeFileSync(join(plugin, 'my-plugin.php'), "<?php\n/**\n * Plugin Name: My Plugin\n * Version: 1.0.0\n */");
    const result = collectTree(dir);
    const pluginObs = result.observables.find(o => o.type === 'wp-component' && o.kind === 'plugin' && o.slug === 'my-plugin');
    assert.deepEqual(pluginObs, { type: 'wp-component', kind: 'plugin', slug: 'my-plugin', name: 'My Plugin', version: '1.0.0', main: 'my-plugin.php', state: 'unknown', classes: [], path: 'site/wp-content/plugins/my-plugin', install: 'site', hidden: false, symlink: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectTree reports a log file in wp-content root with credential shape detection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collectTree-'));
  try {
    const site = join(dir, 'site');
    const content = join(site, 'wp-content');
    mkdirSync(content, { recursive: true });
    writeFileSync(join(site, 'wp-config.php'), "define('WP_DEBUG', true);");
    writeFileSync(join(content, 'debug.log'), "user_pass=secret123");
    const result = collectTree(dir);
    const logFile = result.observables.find(o => o.type === 'file' && o.kind === 'log' && o.name === 'debug.log');
    assert.ok(logFile);
    assert.equal(logFile.credentialShape, true);
    assert.equal(logFile.sampled, true);
    assert.equal(logFile.debugLog, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectTree reports a served-dir for uploads with .htaccess that denies PHP execution', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collectTree-'));
  try {
    const site = join(dir, 'site');
    const content = join(site, 'wp-content');
    const uploads = join(content, 'uploads');
    mkdirSync(uploads, { recursive: true });
    writeFileSync(join(site, 'wp-config.php'), "define('WP_DEBUG', false);");
    writeFileSync(join(uploads, '.htaccess'), "php_flag engine off");
    writeFileSync(join(uploads, 'index.php'), '<?php');
    const result = collectTree(dir);
    const servedDir = result.observables.find(o => o.type === 'served-dir' && o.name === 'uploads');
    const htaccessDirective = result.observables.find(o => o.type === 'server-directive' && o.scope === 'htaccess' && o.name === 'php-denied' && o.location === 'uploads');
    assert.ok(servedDir);
    assert.equal(servedDir.phpDenied, true);
    assert.equal(servedDir.guardHtaccess, true);
    assert.deepEqual(htaccessDirective, { type: 'server-directive', scope: 'htaccess', path: 'site/wp-content/uploads/.htaccess', name: 'php-denied', value: true, install: 'site', location: 'uploads', dir: 'uploads' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectTree reports a served-dir for logs with .htaccess that denies read access', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collectTree-'));
  try {
    const site = join(dir, 'site');
    const content = join(site, 'wp-content');
    const logs = join(content, 'logs');
    mkdirSync(logs, { recursive: true });
    writeFileSync(join(site, 'wp-config.php'), "define('WP_DEBUG', false);");
    writeFileSync(join(logs, '.htaccess'), "Require all denied");
    writeFileSync(join(logs, 'access.log'), "log line");
    const result = collectTree(dir);
    const servedDir = result.observables.find(o => o.type === 'served-dir' && o.name === 'logs');
    const htaccessDirective = result.observables.find(o => o.type === 'server-directive' && o.scope === 'htaccess' && o.name === 'php-denied' && o.location === 'logs');
    assert.ok(servedDir);
    assert.equal(servedDir.readDenied, true);
    assert.equal(servedDir.guardHtaccess, true);
    assert.deepEqual(htaccessDirective, { type: "server-directive", scope: "htaccess", path: "site/wp-content/logs/.htaccess", name: "php-denied", value: true, install: "site", location: "logs", dir: "logs" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectTree reports an audit-source from a logs directory with exactly five dated files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collectTree-'));
  try {
    const site = join(dir, 'site');
    const content = join(site, 'wp-content');
    const logs = join(content, 'logs');
    mkdirSync(logs, { recursive: true });
    writeFileSync(join(site, 'wp-config.php'), "define('WP_DEBUG', false);");
    for (const d of ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05']) {
      writeFileSync(join(logs, `${d}.log`), 'x');
    }
    const result = collectTree(dir);
    const auditSource = result.observables.find(o => o.type === 'audit-source' && o.kind === 'files');
    assert.ok(auditSource);
    assert.equal(auditSource.rows, 5);
    assert.equal(auditSource.from, '2024-01-01');
    assert.equal(auditSource.to, '2024-01-05');
    assert.equal(auditSource.spanDays, 4);
    assert.ok(result.measured.has('audit-source'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectTree does not report an audit-source when a logs directory has only four dated files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collectTree-'));
  try {
    const site = join(dir, 'site');
    const content = join(site, 'wp-content');
    const logs = join(content, 'logs');
    mkdirSync(logs, { recursive: true });
    writeFileSync(join(site, 'wp-config.php'), "define('WP_DEBUG', false);");
    for (const d of ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04']) {
      writeFileSync(join(logs, `${d}.log`), 'x');
    }
    const result = collectTree(dir);
    const auditSource = result.observables.find(o => o.type === 'audit-source' && o.kind === 'files');
    assert.equal(auditSource, undefined);
    assert.ok(!result.measured.has('audit-source'));
    assert.ok(result.unmeasured.some(u => u.type === 'audit-source' && u.why === 'needs a database dump or a dated log directory'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectTree reports a config backup file in site root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collectTree-'));
  try {
    const site = join(dir, 'site');
    const content = join(site, 'wp-content');
    mkdirSync(content, { recursive: true });
    writeFileSync(join(site, 'wp-config.php'), "define('WP_DEBUG', false);");
    writeFileSync(join(site, 'index.php'), '<?php');
    writeFileSync(join(site, 'wp-config.php.bak'), "define('WP_DEBUG', true);");
    const result = collectTree(dir);
    const backupFile = result.observables.find(o => o.type === 'file' && o.kind === 'config-backup' && o.name === 'wp-config.php.bak');
    assert.deepEqual(backupFile, { type: 'file', path: 'site/wp-config.php.bak', kind: 'config-backup', name: 'wp-config.php.bak', install: 'site' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectTree reports a database dump file in site root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collectTree-'));
  try {
    const site = join(dir, 'site');
    const content = join(site, 'wp-content');
    mkdirSync(content, { recursive: true });
    writeFileSync(join(site, 'wp-config.php'), "define('WP_DEBUG', false);");
    writeFileSync(join(site, 'index.php'), '<?php');
    writeFileSync(join(site, 'backup.sql'), 'SQL dump');
    const result = collectTree(dir);
    const dumpFile = result.observables.find(o => o.type === 'file' && o.kind === 'data' && o.name === 'backup.sql');
    assert.deepEqual(dumpFile, { type: 'file', path: 'site/backup.sql', kind: 'data', name: 'backup.sql', install: 'site', servedRoot: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectTree reports an archive file in wp-content root that is not a database dump', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collectTree-'));
  try {
    const site = join(dir, 'site');
    const content = join(site, 'wp-content');
    mkdirSync(content, { recursive: true });
    writeFileSync(join(site, 'wp-config.php'), "define('WP_DEBUG', false);");
    writeFileSync(join(content, 'backup.zip'), 'PK data');
    const result = collectTree(dir);
    const archiveFile = result.observables.find(o => o.type === 'file' && o.kind === 'archive' && o.name === 'backup.zip');
    assert.deepEqual(archiveFile, { type: 'file', path: 'site/wp-content/backup.zip', kind: 'archive', name: 'backup.zip', install: 'site' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectTree reports a served-dir with kind other and no .htaccess has readDenied false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collectTree-'));
  try {
    const site = join(dir, 'site');
    const content = join(site, 'wp-content');
    const other = join(content, 'custom-dir');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(site, 'wp-config.php'), "define('WP_DEBUG', false);");
    writeFileSync(join(other, 'test.txt'), 'content');
    const result = collectTree(dir);
    const servedDir = result.observables.find(o => o.type === 'served-dir' && o.name === 'custom-dir');
    assert.ok(servedDir);
    assert.equal(servedDir.kind, 'other');
    assert.equal(servedDir.guardHtaccess, false);
    assert.equal(servedDir.phpDenied, false);
    assert.equal(servedDir.readDenied, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
