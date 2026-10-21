// bin/wp-integrity.mjs — every rule in both directions, the unverifiable and unmeasured states, the
// void, the partial read, determinism and the CLI, over synthetic sites and a file:// checksum mirror
// written here at test time. No test opens a network connection.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanTree, RULES } from '../wp-integrity.mjs';
import { scratch, cleanup, write, coreChecksums, pluginChecksums, withSource, sourceEnv, pluginMain, themeStyle, versionPhp } from './wp-fixture.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCANNER = join(REPO, 'bin', 'wp-integrity.mjs');
after(cleanup);

const SILENCE = '<?php\n// Silence is golden.\n';
const HELLO = '<?php\n/*\nPlugin Name: Hello Sample\nVersion: 1.0\n*/\nreturn;\n';
const CORE = {
  'index.php': '<?php // front controller\n',
  'wp-includes/version.php': versionPhp('6.0.1'),
  'wp-includes/load.php': '<?php // load\n',
  'wp-admin/admin.php': '<?php // admin\n',
  'wp-login.php': '<?php // login\n',
};
const BUNDLED = {
  'wp-content/index.php': SILENCE, 'wp-content/plugins/index.php': SILENCE, 'wp-content/themes/index.php': SILENCE,
  'wp-content/plugins/hello.php': HELLO,
  'wp-content/themes/twentyx/style.css': themeStyle('Twenty X', '1.0'), 'wp-content/themes/twentyx/index.php': '<?php // theme\n',
};
const PLUGIN = {
  'acme-forms.php': pluginMain('Acme Forms', '2.1.0'), 'inc/form.php': '<?php // form\n', 'inc/util.php': '<?php // util\n', 'readme.txt': '=== Acme ===\nStable tag: 2.1.0\n',
};
const under = (prefix, files) => Object.fromEntries(Object.entries(files).map(([k, v]) => [`${prefix}${k}`, v]));

function site({ files = {}, omit = [] } = {}) {
  const root = scratch();
  const src = scratch('cw-wp-src-');
  const tree = { ...CORE, ...BUNDLED, ...under('wp-content/plugins/acme-forms/', PLUGIN), ...files };
  for (const o of omit) delete tree[o];
  write(root, tree);
  coreChecksums(src, '6.0.1', { ...CORE, ...BUNDLED });
  pluginChecksums(src, 'acme-forms', '2.1.0', PLUGIN);
  return { root, src };
}
const run = ({ root, src }, extra) => withSource(src, () => scanTree(root), extra);
const rows = (r, rule) => r.findings.filter((f) => f.rule === rule);
const at = (r, rule, path) => r.findings.find((f) => f.rule === rule && f.path === path);

describe('wp-integrity: the rules', () => {
  test('a site that matches its release verifies, with core, the plugin and the bundled theme listed', async () => {
    const r = await run(site());
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.summary.verified.map((v) => `${v.kind}:${v.slug}`).sort(), ['core:wordpress', 'plugin:acme-forms', 'theme:twentyx']);
    assert.equal(r.summary.partial, undefined);
    assert.equal(r.summary.voidReason, undefined);
    assert.ok(r.summary.filesHashed >= 10);
    assert.equal(r.summary.softChanges, 0);
    assert.deepEqual(Object.keys(RULES).sort(), ['wp-core-file-added', 'wp-core-file-missing', 'wp-core-file-modified', 'wp-plugin-file-added', 'wp-plugin-file-missing', 'wp-plugin-file-modified', 'wp-plugins-root-file']);
  });

  test('wp-core-file-modified fires on a changed core file and on no other', async () => {
    const r = await run(site({ files: { 'wp-includes/load.php': '<?php // load, changed\n' } }));
    const f = at(r, 'wp-core-file-modified', 'wp-includes/load.php');
    assert.equal(f.sev, 'high');
    assert.match(f.detail, /WordPress 6\.0\.1 \(en_US\)/);
    assert.equal(rows(r, 'wp-core-file-modified').length, 1, 'only the changed file');
  });

  test('wp-core-file-added: code high per file, everything else one row (med when it holds configuration); wp-content and wp-config.php are never core', async () => {
    const r = await run(site({ files: {
      'wp-includes/x.php': '<?php echo 1;\n', 'wp-includes/y.txt': 'note <?php ', 'wp-z.php': '<?php echo 1;\n', 'wp-admin/.htaccess': 'Deny from all\n',
      'wp-includes/notes.txt': 'n', 'wp-includes/img.png': 'p', 'wp-config.php': '<?php\n', 'other-root.php': '<?php\n', 'wp-content/uploads/a.txt': 'a',
    } }));
    for (const p of ['wp-includes/x.php', 'wp-includes/y.txt', 'wp-z.php']) assert.equal(at(r, 'wp-core-file-added', p)?.sev, 'high', p);
    const rest = at(r, 'wp-core-file-added', '.');
    assert.equal(rest.sev, 'med');
    assert.match(rest.detail, /^3 file\(s\) that WordPress 6\.0\.1 \(en_US\) does not ship.*, 1 of them server configuration \(wp-admin\/\.htaccess\)/);
    assert.ok(!at(r, 'wp-core-file-added', 'wp-admin/.htaccess'), 'configuration is counted on the component row, not one row per copy');
    const plain = await run(site({ files: { 'wp-includes/notes.txt': 'n' } }));
    assert.equal(at(plain, 'wp-core-file-added', '.').sev, 'low');
    for (const p of ['wp-config.php', 'other-root.php', 'wp-content/uploads/a.txt']) assert.ok(!r.findings.some((f) => f.path === p), p);
  });

  test('wp-core-file-missing is one low row carrying the count; nothing missing, no row', async () => {
    const r = await run(site({ omit: ['wp-admin/admin.php', 'wp-login.php'] }));
    const f = at(r, 'wp-core-file-missing', '.');
    assert.equal(f.sev, 'low');
    assert.match(f.detail, /^2 file\(s\)/);
    assert.equal(rows(await run(site()), 'wp-core-file-missing').length, 0);
  });

  test('wp-plugin-file-modified, -added and -missing; a changed readme is a soft change, not a row', async () => {
    const P = 'wp-content/plugins/acme-forms';
    const r = await run(site({
      files: { [`${P}/inc/form.php`]: '<?php // changed\n', [`${P}/inc/shell.php`]: '<?php echo 1;\n', [`${P}/inc/cache.json`]: '{}', [`${P}/.htaccess`]: 'x', [`${P}/readme.txt`]: '=== Acme ===\nStable tag: trunk\n' },
      omit: [`${P}/inc/util.php`],
    }));
    assert.equal(at(r, 'wp-plugin-file-modified', `${P}/inc/form.php`).sev, 'high');
    assert.match(at(r, 'wp-plugin-file-modified', `${P}/inc/form.php`).detail, /acme-forms 2\.1\.0.*sha256 differs/);
    assert.equal(at(r, 'wp-plugin-file-added', `${P}/inc/shell.php`).sev, 'high');
    assert.equal(at(r, 'wp-plugin-file-added', P).sev, 'med');
    assert.match(at(r, 'wp-plugin-file-added', P).detail, /^2 file\(s\) that acme-forms 2\.1\.0 does not ship, 1 of them server configuration/);
    assert.match(at(r, 'wp-plugin-file-missing', P).detail, /^1 file\(s\) of acme-forms 2\.1\.0 are absent: inc\/util\.php/);
    assert.ok(!r.findings.some((f) => f.path.endsWith('readme.txt')));
    assert.equal(r.summary.softChanges, 1);
  });

  test('added PHP that runs nothing is counted on the component row, never as server code; a .php.b64 always is code', async () => {
    const P = 'wp-content/plugins/acme-forms';
    const r = await run(site({ files: {
      [`${P}/storage/index.php`]: 'Plain words, no open tag\n', [`${P}/inc/index.php`]: '<?php\n// Silence is golden.\n',
      [`${P}/data/cfg.php`]: '<?php exit; ?>\n{"k":1}\n', [`${P}/inc/drop.php.b64`]: 'PD9waHAgZXZhbCgkX1BPU1RbMF0pOw==',
    } }));
    assert.deepEqual(r.findings.filter((f) => f.sev === 'high').map((f) => f.path), [`${P}/inc/drop.php.b64`]);
    const rest = at(r, 'wp-plugin-file-added', P);
    assert.equal(rest.sev, 'low');
    assert.match(rest.detail, /^3 file\(s\) .*3 of them PHP that runs nothing/);
  });

  test('a file that differs from its release only in line endings is counted, not reported', async () => {
    const s = site();
    const crlf = '<?php\r\n// form\r\nreturn;\r\n';
    pluginChecksums(s.src, 'acme-forms', '2.1.0', { ...PLUGIN, 'inc/form.php': crlf });
    write(s.root, { 'wp-content/plugins/acme-forms/inc/form.php': crlf.replace(/\r\n/g, '\n') });
    const r = await run(s);
    assert.deepEqual(r.findings, []);
    assert.equal(r.summary.lineEndingOnly, 1);
    write(s.root, { 'wp-content/plugins/acme-forms/inc/form.php': '<?php\n// form, changed\nreturn;\n' });
    assert.ok(at(await run(s), 'wp-plugin-file-modified', 'wp-content/plugins/acme-forms/inc/form.php'), 'a real change is still a change');
  });

  test('wp-plugins-root-file: every file directly in plugins/ but index.php; a single-file plugin is med; hello.php matching core is no row', async () => {
    const r = await run(site({ files: {
      'wp-content/plugins/.x-state': '{"k":"v"}', 'wp-content/plugins/drop.php.b64': 'PD9waHA=', 'wp-content/plugins/solo.php': pluginMain('Solo Thing', '0.3'),
    } }));
    assert.equal(at(r, 'wp-plugins-root-file', 'wp-content/plugins/.x-state').sev, 'high');
    assert.match(at(r, 'wp-plugins-root-file', 'wp-content/plugins/.x-state').detail, /hidden/);
    assert.equal(at(r, 'wp-plugins-root-file', 'wp-content/plugins/drop.php.b64').sev, 'high');
    assert.equal(at(r, 'wp-plugins-root-file', 'wp-content/plugins/solo.php').sev, 'med');
    assert.match(at(r, 'wp-plugins-root-file', 'wp-content/plugins/solo.php').detail, /Plugin Name: Solo Thing, Version: 0\.3/);
    assert.ok(!r.findings.some((f) => f.path === 'wp-content/plugins/index.php' || f.path === 'wp-content/plugins/hello.php'));
    assert.ok(r.summary.unverifiable.some((u) => u.kind === 'single-file-plugin' && u.slug === 'solo.php'));
  });

  test('a changed hello.php or plugins/index.php is a core modification where core is in the tree', async () => {
    const r = await run(site({ files: { 'wp-content/plugins/hello.php': `${HELLO}// changed\n`, 'wp-content/plugins/index.php': '<?php // changed\n' } }));
    assert.ok(at(r, 'wp-core-file-modified', 'wp-content/plugins/hello.php'));
    assert.ok(at(r, 'wp-core-file-modified', 'wp-content/plugins/index.php'));
    assert.ok(!rows(r, 'wp-plugins-root-file').length);
  });
});

describe('wp-integrity: what cannot be verified is listed, never passed', () => {
  test('a premium plugin, a custom theme, a must-use plugin and a header-less directory are unverifiable', async () => {
    const r = await run(site({ files: {
      'wp-content/plugins/premium-x/premium-x.php': pluginMain('Premium X', '9.9'), 'wp-content/themes/custom/style.css': themeStyle('Custom', '1.2'),
      'wp-content/mu-plugins/loader.php': '<?php\n', 'wp-content/plugins/assets-only/readme.txt': 'r',
    } }));
    const u = Object.fromEntries(r.summary.unverifiable.map((x) => [`${x.kind}:${x.slug}`, x.why]));
    assert.match(u['plugin:premium-x'], /publishes no checksums for premium-x 9\.9/);
    assert.match(u['theme:custom'], /no theme checksums/);
    assert.match(u['mu-plugin:loader.php'], /no checksum source/);
    assert.match(u['plugin:assets-only'], /no PHP file .* Plugin Name header/);
    assert.equal(r.summary.components.unverifiable, 4);
    assert.ok(!r.summary.verified.some((v) => ['premium-x', 'custom'].includes(v.slug)));
    assert.deepEqual(r.findings, []);
  });

  test('a bundled theme still at its bundled copy is verified as core; one updated past it is unverifiable', async () => {
    const changed = await run(site({ files: { 'wp-content/themes/twentyx/index.php': '<?php // changed\n' } }));
    assert.ok(at(changed, 'wp-core-file-modified', 'wp-content/themes/twentyx/index.php'));
    const updated = await run(site({ files: { 'wp-content/themes/twentyx/style.css': themeStyle('Twenty X', '1.1') } }));
    assert.match(updated.summary.unverifiable.find((x) => x.slug === 'twentyx').why, /not the copy WordPress 6\.0\.1 bundles/);
    assert.deepEqual(updated.findings, []);
  });

  test('a wp-content-only tree: core unmeasured and the run partial, while plugins verify and plugins/ is still read', async () => {
    const root = scratch();
    const src = scratch('cw-wp-src-');
    const content = join(root, 'wp-content');
    write(content, { 'plugins/index.php': SILENCE, 'plugins/.lock-state': 'x', ...under('plugins/acme-forms/', PLUGIN), 'themes/custom/style.css': themeStyle('Custom', '1') });
    pluginChecksums(src, 'acme-forms', '2.1.0', PLUGIN);
    const r = await withSource(src, () => scanTree(content));
    assert.equal(r.summary.installs[0].layout, 'wp-content');
    assert.match(r.summary.notMeasured[0].reason, /core is not in the scanned tree/);
    assert.equal(r.summary.partial, true);
    assert.ok(r.summary.partialReasons.some((x) => /core not in the tree/.test(x)));
    assert.ok(r.summary.verified.some((v) => v.slug === 'acme-forms'));
    assert.ok(at(r, 'wp-plugins-root-file', 'plugins/.lock-state'));
  });

  test('a core version wordpress.org publishes no checksums for is unmeasured, not clean', async () => {
    const s = site({ files: { 'wp-includes/version.php': versionPhp('6.0.1-src') } });
    const r = await run(s);
    assert.match(r.summary.notMeasured.find((n) => n.component === 'core').reason, /publishes no checksums for WordPress 6\.0\.1-src/);
    assert.equal(r.summary.partial, true);
  });
});

describe('wp-integrity: void, partial, offline', () => {
  test('no WordPress is a void, and a directory merely named wp-content is not an install', async () => {
    const root = write(scratch(), { 'src/a.js': 'x', 'docs/wp-content/notes.md': 'x', 'docs/wp-content/plugins/a.txt': 'x' });
    const r = await withSource(scratch('cw-wp-src-'), () => scanTree(root));
    assert.equal(r.summary.filesScanned, 0);
    assert.deepEqual(r.summary.installs, []);
    assert.match(r.summary.voidReason, /no WordPress install/);
  });

  test('a wp-content holding no component does not make its parent a site, so the walk goes on to the one that is', async () => {
    const s = site();
    const root = scratch();
    write(root, { 'wp-content/plugins/notes.txt': 'x', ...under('deploy/', { ...CORE, ...BUNDLED, ...under('wp-content/plugins/acme-forms/', PLUGIN) }) });
    const r = await withSource(s.src, () => scanTree(root));
    assert.deepEqual(r.summary.installs.map((i) => i.path), ['deploy']);
    assert.deepEqual(r.findings, []);
  });

  test('an install below the root is found, and a skipped directory is named', async () => {
    const s = site();
    const root = scratch();
    write(root, { ...under('public/', { ...CORE, ...BUNDLED, ...under('wp-content/plugins/acme-forms/', PLUGIN) }), 'node_modules/x/wp-includes/version.php': versionPhp('1.0') });
    const r = await withSource(s.src, () => scanTree(root));
    assert.deepEqual(r.summary.installs.map((i) => i.path), ['public']);
    assert.ok(r.summary.skippedPaths.includes('node_modules'));
    assert.deepEqual(r.findings, []);
  });

  test('offline with no cache: every request fails, the run is partial and verifies nothing, and placement is still reported', async () => {
    const s = site({ files: { 'wp-content/plugins/stray.txt': 'x' } });
    const r = await withSource(s.src, () => scanTree(s.root), { CW_WP_API_URL: 'https://api.wordpress.org', CW_WP_DOWNLOADS_URL: 'https://downloads.wordpress.org' });
    assert.equal(r.summary.components.verified, 0);
    assert.equal(r.summary.components.unavailable, 2);
    assert.match(r.summary.unavailable[0].why, /offline \(CW_WP_OFFLINE=1\); no cached copy/);
    assert.equal(r.summary.partial, true);
    assert.match(r.summary.voidReason, /no component could be verified/);
    assert.equal(r.summary.requests.failed, 2);
    assert.ok(at(r, 'wp-plugins-root-file', 'wp-content/plugins/stray.txt'));
  });

  test('an unreadable file is a declared partial read', { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'needs POSIX modes and a non-root user' : false }, async () => {
    const s = site();
    const f = join(s.root, 'wp-content/plugins/acme-forms/inc/form.php');
    chmodSync(f, 0o000);
    try {
      const r = await run(s);
      assert.equal(r.summary.unreadable, 1);
      assert.equal(r.summary.partial, true);
    } finally { chmodSync(f, 0o644); }
  });
});

describe('wp-integrity: output', () => {
  test('deterministic, sorted, and carries no file contents', async () => {
    const s = site({ files: { 'wp-includes/load.php': '<?php // NEEDLE-CONTENT-7731\n', 'wp-content/plugins/z.txt': 'NEEDLE-CONTENT-7731', 'wp-content/plugins/a.txt': 'x' } });
    const one = JSON.stringify(await run(s));
    assert.equal(JSON.stringify(await run(s)), one);
    assert.ok(!one.includes('NEEDLE-CONTENT-7731'));
    const r = JSON.parse(one);
    const keys = r.findings.map((f) => `${f.path}\u0000${f.rule}`);
    assert.deepEqual(keys, [...keys].sort());
  });

  test('the CLI prints the report, exits 0, and exits 2 on a path that is not a directory', () => {
    const s = site();
    const out = JSON.parse(execFileSync(process.execPath, [SCANNER, s.root], { encoding: 'utf8', env: sourceEnv(s.src), timeout: 60000 }));
    assert.equal(out.tool, 'wp-integrity');
    assert.deepEqual(out.findings, []);
    assert.equal(spawnSync(process.execPath, [SCANNER, join(s.root, 'index.php')], { env: sourceEnv(s.src), timeout: 60000 }).status, 2);
    assert.equal(spawnSync(process.execPath, [SCANNER, join(s.root, 'absent')], { env: sourceEnv(s.src), timeout: 60000 }).status, 2);
  });
});
