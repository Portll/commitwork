// admin/static/theme-switch.js — the Appearance choice on admin pages outside the panel shell. Run
// in a vm against a stub document, so the assertions are about what the script does to the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { THEME_HEAD, THEME_SWITCH } from '../lib/theme-head.mjs';

const SRC = readFileSync(new URL('../static/theme-switch.js', import.meta.url), 'utf8');

function el(tag) {
  const attrs = {};
  return {
    tag, children: [], hidden: false, media: '(prefers-color-scheme: light)', title: '', textContent: '',
    classList: { set: new Set(), add(c) { this.set.add(c); } },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: (k) => attrs[k] ?? null,
    removeAttribute(k) { delete attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    querySelector(sel) { return sel === '[data-theme-set]' ? this.children[0] || null : null; },
  };
}

function page({ stored = {}, osLight = false, embedded = false, search = '' } = {}) {
  const store = new Map(Object.entries(stored));
  const root = el('html'); root.style = {};
  const links = { 'theme-light': el('link'), 'cvd-light': el('link'), 'page-light': el('style') };
  const host = el('div');
  const listeners = {};
  const doc = {
    documentElement: root, readyState: 'complete',
    getElementById: (id) => links[id] || null,
    createElement: el,
    querySelectorAll: (sel) => {
      if (sel === '#theme-light,#cvd-light,[data-light]') return Object.values(links);
      if (sel === '[data-theme-switch]') return [host];
      if (sel === '[data-theme-switch] [data-theme-set]') return host.children;
      return [];
    },
    addEventListener() {},
  };
  const win = {
    document: doc, location: { search }, URLSearchParams,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
    },
    matchMedia: () => ({ matches: osLight, addEventListener() {} }),
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
  };
  win.window = win; win.self = win; win.top = embedded ? {} : win;
  vm.runInNewContext(SRC, win);
  return { root, links, host, store, fire: (t, e) => (listeners[t] || []).forEach((f) => f(e)) };
}

test('no stored choice follows the OS, and leaves the light sheets on the OS query', () => {
  const p = page({ osLight: true });
  assert.equal(p.root.getAttribute('data-mode'), 'light');
  assert.equal(p.links['theme-light'].media, '(prefers-color-scheme: light)');
  assert.equal(p.links['cvd-light'].media, '(prefers-color-scheme: light)');
});

test('a stored dark choice switches both light sheets off together', () => {
  const p = page({ stored: { 'cw-theme': 'dark' }, osLight: true });
  assert.equal(p.root.getAttribute('data-mode'), 'dark');
  assert.equal(p.links['theme-light'].media, 'not all');
  assert.equal(p.links['cvd-light'].media, 'not all', 'a cvd sheet left on the OS query keeps the other theme\'s palette');
  assert.equal(p.links['page-light'].media, 'not all', 'a page\'s own light rules must move with the sheets');
});

test('a stored vision palette is applied, and an unknown one reads as none', () => {
  assert.equal(page({ stored: { 'cw-cvd': 'tritanopia' } }).root.getAttribute('data-cvd'), 'tritanopia');
  assert.equal(page({ stored: { 'cw-cvd': 'normal' } }).root.getAttribute('data-cvd'), null);
});

test('the control offers three choices, marks the stored one, and writes the choice when pressed', () => {
  const p = page({ stored: { 'cw-theme': 'light' } });
  assert.deepEqual(p.host.children.map((b) => b.getAttribute('data-theme-set')), ['auto', 'light', 'dark']);
  assert.deepEqual(p.host.children.map((b) => b.getAttribute('aria-checked')), ['false', 'true', 'false']);
  assert.equal(p.host.getAttribute('role'), 'radiogroup');
  p.host.children[2].onclick();
  assert.equal(p.store.get('cw-theme'), 'dark');
  assert.equal(p.links['theme-light'].media, 'not all');
  p.host.children[0].onclick();
  assert.equal(p.store.has('cw-theme'), false, 'auto is the absence of the key, as in the panel');
});

test('an embedded page hides the control: the panel menu owns the choice there', () => {
  const p = page({ embedded: true });
  assert.equal(p.host.hidden, true);
  assert.equal(p.host.children.length, 0);
});

test('a change made in another tab is followed without a reload', () => {
  const p = page();
  p.store.set('cw-theme', 'light');
  p.fire('storage', { key: 'cw-theme' });
  assert.equal(p.root.getAttribute('data-mode'), 'light');
  assert.equal(p.links['theme-light'].media, 'all');
});

test('the shared head links the switch after both light sheets, so it can find them', () => {
  const at = (s) => THEME_HEAD.indexOf(s);
  assert.ok(at('id="theme-light"') > 0 && at('id="cvd-light"') > 0);
  assert.ok(at('/static/theme-switch.js') > at('id="cvd-light"'));
  assert.match(THEME_SWITCH, /data-theme-switch/);
});
