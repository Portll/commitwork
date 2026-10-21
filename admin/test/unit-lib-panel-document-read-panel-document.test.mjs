// Expands panel.html by recursively inlining referenced menu parts (admin/lib/panel-document.mjs readPanelDocument).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPanelDocument } from '../lib/panel-document.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the source unchanged when it contains no menu markers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPanelDocument-'));
  try {
    const source = '<div>hello</div>';
    const result = readPanelDocument(() => source);
    assert.equal(result, source);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('expands a single html menu marker with the part content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPanelDocument-'));
  try {
    const source = '<div><!-- menu:top-bar.html --></div>';
    const part = '<header>bar</header>';
    const result = readPanelDocument((p) => (p === 'panel.html' ? source : part));
    assert.equal(result, '<div><header>bar</header></div>');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('expands a single js menu marker with the part content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPanelDocument-'));
  try {
    const source = '<script>\n// menu:navigation.js\n</script>';
    const part = 'console.log("nav");';
    const result = readPanelDocument((p) => (p === 'panel.html' ? source : part));
    // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- the expected string of an assertion, never rendered
    assert.equal(result, '<script>\nconsole.log("nav");\n</script>');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('expands multiple distinct menu markers in order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPanelDocument-'));
  try {
    const source = '<!-- menu:top-bar.html --><!-- menu:account-menu.html -->';
    const parts = {
      'menus/top-bar.html': 'TOP',
      'menus/account-menu.html': 'ACC'
    };
    const result = readPanelDocument((p) => (p === 'panel.html' ? source : parts[p]));
    assert.equal(result, 'TOPACC');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when a marker references a name not in the allowed parts set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPanelDocument-'));
  try {
    const source = '<!-- menu:unknown.html -->';
    assert.throws(() => readPanelDocument(() => source), /Invalid panel component: unknown\.html/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when a part references itself creating a cycle', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPanelDocument-'));
  try {
    const source = '<!-- menu:top-bar.html -->';
    const part = '<!-- menu:top-bar.html -->';
    assert.throws(() => {
      readPanelDocument((p) => (p === 'panel.html' ? source : part));
    }, /Invalid panel component: top-bar\.html/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('expands nested menu markers recursively', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPanelDocument-'));
  try {
    const source = '<!-- menu:top-bar.html -->';
    const topBar = '<div><!-- menu:account-menu.html --></div>';
    const accountMenu = '<span>menu</span>';
    const parts = {
      'menus/top-bar.html': topBar,
      'menus/account-menu.html': accountMenu
    };
    const result = readPanelDocument((p) => (p === 'panel.html' ? source : parts[p]));
    assert.equal(result, '<div><span>menu</span></div>');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error when a cycle exists between two distinct parts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPanelDocument-'));
  try {
    const source = '<!-- menu:top-bar.html -->';
    const topBar = '<!-- menu:account-menu.html -->';
    const accountMenu = '<!-- menu:top-bar.html -->';
    const parts = {
      'menus/top-bar.html': topBar,
      'menus/account-menu.html': accountMenu
    };
    assert.throws(() => readPanelDocument((p) => (p === 'panel.html' ? source : parts[p])), /Invalid panel component: top-bar\.html/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
