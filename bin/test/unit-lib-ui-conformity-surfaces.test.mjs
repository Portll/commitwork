// Lists existing admin UI surface files (bin/lib/ui-conformity.mjs surfaces).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { surfaces } from '../lib/ui-conformity.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array when no admin subdirectories exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfaces-'));
  try {
    const result = surfaces({ root: dir });
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes admin static js and css files but not other extensions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfaces-'));
  try {
    mkdirSync(join(dir, 'admin', 'static'), { recursive: true });
    writeFileSync(join(dir, 'admin', 'static', 'app.js'), 'x');
    writeFileSync(join(dir, 'admin', 'static', 'style.css'), 'x');
    writeFileSync(join(dir, 'admin', 'static', 'data.json'), 'x');
    const result = surfaces({ root: dir });
    assert.deepEqual(result, ["admin/static/app.js", "admin/static/style.css"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes admin menus js and html files but not css', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfaces-'));
  try {
    mkdirSync(join(dir, 'admin', 'menus'), { recursive: true });
    writeFileSync(join(dir, 'admin', 'menus', 'nav.js'), 'x');
    writeFileSync(join(dir, 'admin', 'menus', 'menu.html'), 'x');
    writeFileSync(join(dir, 'admin', 'menus', 'theme.css'), 'x');
    const result = surfaces({ root: dir });
    assert.deepEqual(result, ["admin/menus/menu.html", "admin/menus/nav.js"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes panel and config html when they exist on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfaces-'));
  try {
    mkdirSync(join(dir, 'admin'), { recursive: true });
    writeFileSync(join(dir, 'admin', 'panel.html'), 'x');
    writeFileSync(join(dir, 'admin', 'config.html'), 'x');
    const result = surfaces({ root: dir });
    assert.deepEqual(result, ["admin/panel.html", "admin/config.html"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes panel and config html when they do not exist on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfaces-'));
  try {
    mkdirSync(join(dir, 'admin'), { recursive: true });
    const result = surfaces({ root: dir });
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes static files that do not exist on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfaces-'));
  try {
    mkdirSync(join(dir, 'admin', 'static'), { recursive: true });
    writeFileSync(join(dir, 'admin', 'static', 'real.js'), 'x');
    const result = surfaces({ root: dir });
    assert.deepEqual(result, ["admin/static/real.js"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when admin directory is missing entirely', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfaces-'));
  try {
    const result = surfaces({ root: dir });
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles mjs and html in static and js in menus with mixed presence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfaces-'));
  try {
    mkdirSync(join(dir, 'admin', 'static'), { recursive: true });
    mkdirSync(join(dir, 'admin', 'menus'), { recursive: true });
    writeFileSync(join(dir, 'admin', 'static', 'lib.mjs'), 'x');
    writeFileSync(join(dir, 'admin', 'static', 'page.html'), 'x');
    writeFileSync(join(dir, 'admin', 'menus', 'items.js'), 'x');
    writeFileSync(join(dir, 'admin', 'panel.html'), 'x');
    const result = surfaces({ root: dir });
    assert.deepEqual(result, ["admin/static/lib.mjs", "admin/static/page.html", "admin/menus/items.js", "admin/panel.html"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
