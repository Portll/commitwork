// The palette is a classic script that must boot in any order and depend on nothing at load time.
// Under a minimal DOM: Cmd+K opens it and asks the server; typing re-asks with the query; Enter
// runs the active entry through the router; a chord jumps without the dialog; a chord typed into a
// field does nothing; an operator-only action off the operator port is shown and refused, never
// hidden; a 401 is said, not swallowed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'static', 'panel-palette.js'), 'utf8');

const ENTRIES = [
  { kind: 'view', id: 'allfindings', label: 'All findings', hint: 'every finding', scope: 'project', operatorOnly: false },
  { kind: 'view', id: 'issues', label: 'Work items', hint: '', scope: 'project', operatorOnly: false },
  { kind: 'project', id: 'alpha', label: 'alpha', hint: 'select this project', scope: 'fleet', operatorOnly: false },
  { kind: 'action', id: 'run-checks', label: 'Run checks', hint: 'start a sweep', scope: 'project', operatorOnly: false, method: 'POST', path: '/api/sweep' },
  { kind: 'action', id: 'restart-panel', label: 'Restart the panel', hint: 'spawn a successor', scope: 'fleet', operatorOnly: true, method: 'POST', path: '/api/panel/restart' },
];

function realm({ operator = false, status = 200 } = {}) {
  const byId = new Map();
  const mk = (tag) => {
    const el = {
      tagName: String(tag).toUpperCase(), _id: '', attrs: {}, children: [], hidden: false, value: '', textContent: '', _html: '',
      dataset: {}, listeners: {}, focused: 0,
      set id(v) { el._id = v; byId.set(v, el); }, get id() { return el._id; },
      // a real parser would create the children; register the id-bearing ones so getElementById and
      // querySelector('#id') find them, which is all the palette asks of its markup
      set innerHTML(v) { el._html = String(v); for (const m of el._html.matchAll(/<(\w+)[^>]*\sid="([^"]+)"/g)) { if (!byId.has(m[2])) { const c = mk(m[1]); c.id = m[2]; } } },
      get innerHTML() { return el._html; },
      setAttribute(k, v) { el.attrs[k] = String(v); }, getAttribute(k) { return el.attrs[k] ?? null; },
      appendChild(c) { el.children.push(c); return c; },
      addEventListener(t, f) { (el.listeners[t] ||= []).push(f); },
      querySelector(sel) { const m = sel.match(/^#([\w-]+)$/); return m ? byId.get(m[1]) || null : null; },
      focus() { el.focused++; }, closest() { return null; },
    };
    return el;
  };
  const document = {
    head: mk('head'), body: mk('body'), listeners: {},
    createElement: (t) => mk(t),
    getElementById: (i) => byId.get(i) || null,
    addEventListener(t, f) { (document.listeners[t] ||= []).push(f); },
    dispatchEvent(ev) { (document.listeners[ev.type] || []).forEach((f) => f(ev)); return true; },
  };
  const calls = { fetch: [], nav: [], post: [], opened: [], events: [] };
  const sandbox = {
    document,
    location: { href: '/' },
    localStorage: { setItem() {}, getItem: () => null },
    window: { open: (u) => calls.opened.push(u) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    fetch: async (url) => { calls.fetch.push(String(url)); return { ok: status === 200, status, json: async () => ({ ok: true, operator, results: ENTRIES }) }; },
    setTimeout: (f) => { f(); return 1; }, clearTimeout() {},
    Date, encodeURIComponent, Number, String, JSON, Object, Array, Promise, console,
    navigateWorkspace: (v, o) => calls.nav.push([v, o]),
    cwPost: async (url, opts) => { calls.post.push([url, opts]); return { ok: true, status: 200 }; },
    load: () => calls.nav.push(['load']),
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  new vm.Script(SRC, { filename: 'panel-palette.js' }).runInContext(ctx);
  const key = (k, over = {}) => {
    const ev = { type: 'keydown', key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: null, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...over };
    document.dispatchEvent(ev);
    return ev;
  };
  const tick = () => new Promise((r) => setImmediate(r));
  return { ctx, sandbox, calls, key, tick, byId };
}
// objects born in the vm realm have another prototype; compare by value
const plain = (v) => JSON.parse(JSON.stringify(v));

test('boots with no router present and installs one keydown listener', () => {
  const byId = new Map();
  const document = { head: { appendChild() {} }, body: { appendChild() {} }, listeners: {}, createElement: () => ({ set id(v) { byId.set(v, this); }, setAttribute() {}, appendChild() {}, addEventListener() {}, querySelector: () => null }), getElementById: () => null, addEventListener(t, f) { (this.listeners[t] ||= []).push(f); } };
  const ctx = vm.createContext({ document, globalThis: {}, Date, Object, console });
  ctx.globalThis = ctx;
  new vm.Script(SRC).runInContext(ctx);
  assert.equal(document.listeners.keydown.length, 1);
  assert.ok(ctx.cwPalette && typeof ctx.cwPalette.open === 'function');
});

test('Cmd+K opens, asks the server, and typing re-asks with the query; Esc closes', async () => {
  const r = realm();
  const ev = r.key('k', { metaKey: true });
  assert.equal(ev.defaultPrevented, true);
  assert.equal(r.sandbox.cwPalette.state.open, true);
  await r.tick();
  assert.deepEqual(r.calls.fetch, ['/api/palette?q=&limit=20']);
  const root = r.byId.get('cw-palette');
  assert.equal(root.hidden, false);
  assert.equal(root.attrs.role, 'dialog');
  assert.equal(r.byId.get('cw-palette-input').focused, 1);
  const input = r.byId.get('cw-palette-input');
  input.value = 'work';
  input.listeners.input[0]();
  await r.tick();
  assert.equal(r.calls.fetch[1], '/api/palette?q=work&limit=20');
  assert.match(r.byId.get('cw-palette-list').innerHTML, /aria-selected="true"[^>]*>.*All findings/);
  r.key('Escape');
  assert.equal(root.hidden, true);
  assert.equal(r.sandbox.cwPalette.state.open, false);
  // Ctrl+K works too, and toggles
  r.key('k', { ctrlKey: true });
  assert.equal(r.sandbox.cwPalette.state.open, true);
  r.key('k', { ctrlKey: true });
  assert.equal(r.sandbox.cwPalette.state.open, false);
});

test('arrows move the active row and Enter runs it through the router; a project entry selects', async () => {
  const r = realm();
  r.key('k', { metaKey: true });
  await r.tick();
  r.key('ArrowDown');
  assert.equal(r.sandbox.cwPalette.state.active, 1);
  r.key('Enter');
  assert.deepEqual(plain(r.calls.nav), [['issues', { keepFocus: false }]]);
  assert.equal(r.sandbox.cwPalette.state.open, false, 'opening a view closes the palette');
  r.key('k', { metaKey: true });
  await r.tick();
  r.key('ArrowDown'); r.key('ArrowDown');
  r.key('Enter');
  assert.equal(r.sandbox.curProj, 'alpha');
  assert.deepEqual(plain(r.calls.nav.slice(1)), [['overview', { keepFocus: false }], ['load']]);
});

test('an operator-only action off the operator port is listed, marked, and refused with the reason', async () => {
  const r = realm({ operator: false });
  r.key('k', { metaKey: true });
  await r.tick();
  const html = r.byId.get('cw-palette-list').innerHTML;
  assert.match(html, /Restart the panel/);
  assert.match(html, /cw-disabled[^>]*aria-disabled="true"/);
  assert.match(html, /operator port only/);
  r.sandbox.cwPalette.state.active = 4;
  r.key('Enter');
  assert.equal(r.calls.post.length, 0);
  assert.match(r.byId.get('cw-palette-hint').textContent, /operator port/);
  // a project-scoped action with no project chosen is refused too
  r.sandbox.cwPalette.state.active = 3;
  r.key('Enter');
  assert.equal(r.calls.post.length, 0);
  assert.match(r.byId.get('cw-palette-hint').textContent, /choose a project/);
  r.sandbox.curProj = 'alpha';
  r.key('Enter');
  await r.tick();
  assert.equal(r.calls.post.length, 1);
  assert.equal(r.calls.post[0][0], '/api/sweep');
  assert.equal(JSON.parse(r.calls.post[0][1].body).project, 'alpha');
});

test('on the operator port the same action runs', async () => {
  const r = realm({ operator: true });
  r.key('k', { metaKey: true });
  await r.tick();
  assert.equal(r.sandbox.cwPalette.state.operator, true);
  assert.doesNotMatch(r.byId.get('cw-palette-list').innerHTML, /operator port only/);
  r.sandbox.cwPalette.state.active = 4;
  r.key('Enter');
  await r.tick();
  assert.equal(r.calls.post[0][0], '/api/panel/restart');
});

test('G then a letter jumps without opening; typed into a field it does nothing; it expires', () => {
  const r = realm();
  r.key('g');
  const f = r.key('f');
  assert.equal(f.defaultPrevented, true);
  assert.deepEqual(plain(r.calls.nav), [['allfindings', { keepFocus: false }]]);
  assert.equal(r.sandbox.cwPalette.state.open, false);
  r.key('g', { target: { tagName: 'INPUT' } });
  r.key('w', { target: { tagName: 'INPUT' } });
  assert.equal(r.calls.nav.length, 1, 'chords never fire while typing');
  r.key('g');
  r.sandbox.cwPalette.state.chordAt -= r.sandbox.cwPalette.CHORD_MS + 1;
  r.key('w');
  assert.equal(r.calls.nav.length, 1, 'an expired chord is dropped');
  r.key('g', { isComposing: true });
  r.key('t');
  assert.equal(r.calls.nav.length, 1, 'a composing keystroke is not a chord');
  r.key('g');
  r.key('z');
  assert.equal(r.calls.nav.length, 1, 'an unmapped second key does nothing');
  assert.equal(r.sandbox.cwPalette.state.chord, null);
});

test('a 401 is said in the hint and leaves the list empty', async () => {
  const r = realm({ status: 401 });
  r.key('k', { metaKey: true });
  await r.tick();
  assert.match(r.byId.get('cw-palette-hint').textContent, /sign in/);
  assert.match(r.byId.get('cw-palette-list').innerHTML, /nothing matches/);
});

test('rendering escapes what the server sends', () => {
  const r = realm();
  const html = r.sandbox.cwPalette.renderResults([{ kind: 'view', id: 'x', label: '<img src=x onerror=1>', hint: '"q"', operatorOnly: false }], false, 0);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&quot;q&quot;/);
});
