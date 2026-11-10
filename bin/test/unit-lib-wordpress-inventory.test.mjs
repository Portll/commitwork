// Lists a WordPress content directory's plugins, root plugin files, themes and mu-plugins (bin/lib/wordpress.mjs inventory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventory } from '../lib/wordpress.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'inventory-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const empty = () => ({ plugins: [], rootFiles: [], themes: [], muPlugins: [], unreadable: [] });
const php = (name, version) => `<?php\n/*\nPlugin Name: ${name}\nVersion: ${version}\n*/\n`;

test('A content directory without plugins, themes or mu-plugins folders yields empty lists and no unreadable entries', () => withDir((dir) => {
  assert.deepEqual(inventory(dir), empty());
}));

test('Folders that are plain files are reported as unreadable with ENOTDIR', () => withDir((dir) => {
  writeFileSync(join(dir, 'plugins'), '');
  writeFileSync(join(dir, 'themes'), '');
  writeFileSync(join(dir, 'mu-plugins'), '');
  assert.deepEqual(inventory(dir), {
    ...empty(),
    unreadable: [
      { path: join(dir, 'plugins'), why: 'readdir failed: ENOTDIR' },
      { path: join(dir, 'themes'), why: 'readdir failed: ENOTDIR' },
      { path: join(dir, 'mu-plugins'), why: 'readdir failed: ENOTDIR' },
    ],
  });
}));

test('A plugin directory is reported with the headers of its main file', () => withDir((dir) => {
  const p = join(dir, 'plugins', 'myplugin');
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, 'myplugin.php'), php('My Plugin', '1.0'));
  assert.deepEqual(inventory(dir), {
    ...empty(),
    plugins: [{ slug: 'myplugin', abs: p, main: 'myplugin.php', name: 'My Plugin', version: '1.0', mains: ['myplugin.php'], unreadable: [] }],
  });
}));

test('A hidden plugin directory and a symlinked plugin are flagged without being read', () => withDir((dir) => {
  const pl = join(dir, 'plugins');
  mkdirSync(join(pl, '.secret'), { recursive: true });
  writeFileSync(join(pl, '.secret', 'secret.php'), php('Secret', '1.0'));
  const outside = join(dir, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'outside.php'), php('Outside', '1.0'));
  symlinkSync(outside, join(pl, 'linked'));
  assert.deepEqual(inventory(dir), {
    ...empty(),
    plugins: [
      { slug: '.secret', abs: join(pl, '.secret'), hidden: true },
      { slug: 'linked', abs: join(pl, 'linked'), symlink: true },
    ],
  });
}));

test('Root files in plugins read headers only from non-hidden php files', () => withDir((dir) => {
  const pl = join(dir, 'plugins');
  mkdirSync(pl);
  for (const [n, title] of [['.dot.php', 'Dot'], ['readme.txt', 'Readme'], ['standalone.php', 'Standalone']]) {
    writeFileSync(join(pl, n), php(title, '3.0'));
    chmodSync(join(pl, n), 0o644);
  }
  assert.deepEqual(inventory(dir), {
    ...empty(),
    rootFiles: [
      { name: '.dot.php', abs: join(pl, '.dot.php'), pluginName: '', version: '', mode: 0o100644 },
      { name: 'readme.txt', abs: join(pl, 'readme.txt'), pluginName: '', version: '', mode: 0o100644 },
      { name: 'standalone.php', abs: join(pl, 'standalone.php'), pluginName: 'Standalone', version: '3.0', mode: 0o100644 },
    ],
  });
}));

test('Themes take name and version from style.css and get null when it is missing', () => withDir((dir) => {
  const th = join(dir, 'themes');
  mkdirSync(join(th, 'bare'), { recursive: true });
  mkdirSync(join(th, 'mytheme'));
  writeFileSync(join(th, 'mytheme', 'style.css'), '/*\nTheme Name: My Theme\nVersion: 1.5\n*/\n');
  assert.deepEqual(inventory(dir), {
    ...empty(),
    themes: [
      { slug: 'bare', abs: join(th, 'bare'), name: null, version: null },
      { slug: 'mytheme', abs: join(th, 'mytheme'), name: 'My Theme', version: '1.5' },
    ],
  });
}));

test('Hidden theme folders and plain files are skipped and an unreadable style.css is reported by code', () => withDir((dir) => {
  const th = join(dir, 'themes');
  mkdirSync(join(th, '.hidden'), { recursive: true });
  mkdirSync(join(th, 'broken', 'style.css'), { recursive: true });
  writeFileSync(join(th, 'notes.txt'), 'Theme Name: Notes\n');
  assert.deepEqual(inventory(dir), {
    ...empty(),
    themes: [{ slug: 'broken', abs: join(th, 'broken'), name: null, version: null, unreadable: 'style.css: EISDIR' }],
  });
}));

test('Mu-plugins lists files and folders except index.php and dotfiles', () => withDir((dir) => {
  const mu = join(dir, 'mu-plugins');
  mkdirSync(join(mu, 'subdir'), { recursive: true });
  writeFileSync(join(mu, '.hidden.php'), '');
  writeFileSync(join(mu, 'index.php'), '');
  writeFileSync(join(mu, 'muplugin.php'), '');
  assert.deepEqual(inventory(dir), {
    ...empty(),
    muPlugins: [
      { name: 'muplugin.php', abs: join(mu, 'muplugin.php'), dir: false },
      { name: 'subdir', abs: join(mu, 'subdir'), dir: true },
    ],
  });
}));
