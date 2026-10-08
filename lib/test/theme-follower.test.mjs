// lib/theme-follower.mjs — the script every embedded page inlines to follow the panel's light/dark
// choice. Run in a vm against a stub window, so the assertions are about what the script DOES to
// the document, never about what its source text says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { panelSource } from '../../admin/test/lib/panel-source.mjs';
import { FOLLOWER_JS, TOGGLE_JS, THEME_KEY, LIGHT_QUERY, followerScript, toggleScript } from '../theme-follower.mjs';

function page({ stored = null, osLight = false, search = '', storageThrows = false, noMatchMedia = false, toggle = false } = {}) {
  const attrs = {}, style = {}, listeners = {}, events = [], writes = [];
  const store = new Map(stored == null ? [] : [[THEME_KEY, stored]]);
  const mq = { matches: osLight, fns: [], addEventListener(t, f) { if (t === 'change') this.fns.push(f); } };
  const button = { textContent: '', title: '', onclick: null };
  const win = {
    document: {
      documentElement: { getAttribute: (k) => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = String(v); }, style },
      getElementById: (id) => (id === 'theme' ? button : null),
    },
    localStorage: storageThrows
      ? { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }
      : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { writes.push([k, v]); store.set(k, String(v)); } },
    location: { search },
    URLSearchParams,
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
    dispatchEvent: (e) => { events.push(e.detail); for (const f of listeners[e.type] || []) f(e); return true; },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  };
  if (!noMatchMedia) win.matchMedia = (q) => { assert.equal(q, LIGHT_QUERY); return mq; };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(FOLLOWER_JS, win);
  if (toggle) vm.runInContext(TOGGLE_JS, win);
  return {
    win, style, events, writes, store, button,
    mode: () => attrs['data-mode'],
    storage: (key) => { for (const f of listeners.storage || []) f({ key }); },
    osChange: (light) => { mq.matches = light; for (const f of mq.fns) f({ matches: light }); },
  };
}

test('auto follows the OS the way the panel does: light only when the OS asks for light', () => {
  assert.equal(page({ osLight: true }).mode(), 'light');
  assert.equal(page({ osLight: false }).mode(), 'dark');
  assert.equal(page({ noMatchMedia: true }).mode(), 'dark', 'no media query support reads as the panel default');
});

test('a stored choice outranks the OS, and anything unrecognised reads as auto', () => {
  assert.equal(page({ stored: 'light', osLight: false }).mode(), 'light');
  assert.equal(page({ stored: 'dark', osLight: true }).mode(), 'dark');
  assert.equal(page({ stored: 'blue', osLight: true }).mode(), 'light');
  assert.equal(page({ stored: '', osLight: false }).mode(), 'dark');
});

test('unreadable storage reads as auto rather than throwing into the page', () => {
  assert.equal(page({ storageThrows: true, osLight: true }).mode(), 'light');
  assert.equal(page({ storageThrows: true, osLight: false }).mode(), 'dark');
});

test('?mode= pins the page over the stored choice; an unknown value pins nothing', () => {
  assert.equal(page({ stored: 'dark', search: '?embed=1&mode=light' }).mode(), 'light');
  assert.equal(page({ stored: 'light', search: '?mode=dark' }).mode(), 'dark');
  assert.equal(page({ stored: 'light', search: '?mode=sepia' }).mode(), 'light');
});

test('loading never writes the key: auto must stay auto', () => {
  for (const o of [{}, { osLight: true }, { stored: 'dark' }, { search: '?mode=light' }]) {
    assert.deepEqual(page(o).writes, [], JSON.stringify(o));
  }
});

test('the colour-scheme follows the mode, so native controls and scrollbars match', () => {
  assert.equal(page({ osLight: true }).style.colorScheme, 'light');
  assert.equal(page({ stored: 'dark' }).style.colorScheme, 'dark');
});

test('a choice made in the panel reaches the page through the storage event', () => {
  const p = page({ osLight: false });
  assert.equal(p.mode(), 'dark');
  p.store.set(THEME_KEY, 'light'); p.storage(THEME_KEY);
  assert.equal(p.mode(), 'light');
  p.store.delete(THEME_KEY); p.storage(THEME_KEY);
  assert.equal(p.mode(), 'dark', 'the panel removes the key for auto, and auto here is the OS');
  p.store.set(THEME_KEY, 'light'); p.storage('cw-cvd');
  assert.equal(p.mode(), 'dark', 'another key changing is not a theme change');
  p.storage(null);
  assert.equal(p.mode(), 'light', 'storage.clear() arrives with key null and is re-read');
});

test('cw-mode fires once per change and carries the new mode', () => {
  const p = page({ osLight: false });
  assert.deepEqual(p.events, ['dark']);
  p.storage(THEME_KEY);
  assert.deepEqual(p.events, ['dark'], 'no change, no event: a listener rebuilding a scene must not rebuild for nothing');
  p.store.set(THEME_KEY, 'light'); p.storage(THEME_KEY);
  assert.deepEqual(p.events, ['dark', 'light']);
});

test('an OS switch moves an auto page and leaves a chosen one alone', () => {
  const auto = page({ osLight: false });
  auto.osChange(true);
  assert.equal(auto.mode(), 'light');
  const chosen = page({ stored: 'dark', osLight: false });
  chosen.osChange(true);
  assert.equal(chosen.mode(), 'dark');
});

test('cwMode.set writes the shared key and applies; nonsense is refused', () => {
  const p = page({ osLight: false });
  p.win.cwMode.set('light');
  assert.equal(p.mode(), 'light');
  assert.deepEqual(p.writes, [[THEME_KEY, 'light']]);
  p.win.cwMode.set('purple');
  assert.equal(p.mode(), 'light');
  assert.equal(p.writes.length, 1, 'an unrecognised value never reaches storage');
  const locked = page({ storageThrows: true, osLight: false });
  locked.win.cwMode.set('light');
  assert.equal(locked.mode(), 'light', 'a page whose storage throws still switches for this visit');
});

test('the standalone toggle shows the mode it would switch to, and switches', () => {
  const p = page({ osLight: false, toggle: true });
  assert.equal(p.button.textContent, '☀');
  assert.equal(p.button.title, 'light mode');
  p.button.onclick();
  assert.equal(p.mode(), 'light');
  assert.equal(p.button.textContent, '☾', 'the glyph follows the cw-mode event');
  p.win.cwMode.set('dark');
  assert.equal(p.button.textContent, '☀');
});

test('the follower reads the key and the auto query the panel writes', () => {
  // Second witness: the panel's own source, not this module's constants restated. The served page
  // plus the scripts it loads, because the theme control lives in a static script.
  const panel = panelSource('index.html');
  assert.ok(panel.includes(`localStorage.getItem('${THEME_KEY}')`), 'the panel stores its choice under THEME_KEY');
  assert.ok(panel.includes(`localStorage.removeItem('${THEME_KEY}')`), 'the panel removes the key for auto');
  assert.ok(panel.includes(`auto:'${LIGHT_QUERY}'`), 'the panel resolves auto through LIGHT_QUERY');
});

test('the inline wrappers are single, closed script elements', () => {
  for (const [s, body] of [[followerScript(), FOLLOWER_JS], [toggleScript(), TOGGLE_JS]]) {
    assert.equal(s, `<script>${body}</script>`);
    assert.ok(!/<\/script/i.test(body), 'a closing tag inside the body would end the element early');
    assert.ok(!body.includes('`'), 'generators inline this inside template literals');
  }
});
