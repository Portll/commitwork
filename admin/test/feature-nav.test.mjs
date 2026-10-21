// The panel half of the experimental flags: static/features.js run in a vm against a minimal DOM,
// with navigationTabs() lifted from the real navigation source and run beside it. Asserted on the
// effect (a tab hidden, a tag added, a view left out of navigation), not on a marker in the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { ADMIN, panelSource, panelScript } from './lib/panel-source.mjs';

class El {
  constructor({ v, route, children = [] } = {}) {
    this.dataset = {}; if (v) this.dataset.v = v; if (route) this.dataset.route = route;
    this.cls = new Set(); this.attrs = {}; this.children = children; this.parent = null; this.className = '';
    for (const c of children) c.parent = this;
    const self = this;
    this.classList = {
      add: (c) => self.cls.add(c), remove: (c) => self.cls.delete(c), contains: (c) => self.cls.has(c),
      toggle: (c, on) => { const want = on === undefined ? !self.cls.has(c) : !!on; if (want) self.cls.add(c); else self.cls.delete(c); return want; },
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  querySelector(sel) {
    const m = /^:scope > \.([\w-]+)$/.exec(sel);
    return m ? this.children.find((c) => c.className === m[1]) || null : null;
  }
  appendChild(n) { n.parent = this; this.children.push(n); return n; }
  insertBefore(n, ref) { n.parent = this; this.children.splice(this.children.indexOf(ref), 0, n); return n; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
}

const FLAGS = [
  { id: 'lanes-quality', label: 'Quality views', why: 'w', on: false, source: 'store', envVar: 'CW_FEATURE_LANES_QUALITY', groups: ['ui.lanes.quality'], navGroups: ['quality'], views: [] },
  { id: 'agents', label: 'Agent controls', why: 'w', on: true, source: 'default', envVar: 'CW_FEATURE_AGENTS', groups: ['http.agents'], navGroups: [], views: ['overwatch'] },
  { id: 'lanes-lint', label: 'Lint views', why: 'w', on: false, source: 'env:CW_EXPERIMENTAL', envVar: 'CW_FEATURE_LANES_LINT', groups: ['ui.lanes.lint'], navGroups: ['lint'], views: [] },
];
const GROUP = { a11y: 'quality', stubs: 'quality', denolint: 'lint', overwatch: 'act', sast: 'static' };

function boot() {
  const tab = (v) => { const vn = new El(); vn.className = 'vn'; return new El({ v, children: [vn] }); };
  const tabs = ['a11y', 'stubs', 'denolint', 'overwatch', 'sast'].map(tab);
  const rail = [new El({ route: 'overwatch' }), new El({ route: 'settings' })];
  const document = {
    querySelectorAll: (sel) => (sel === '#views .vtab' ? tabs : sel === '[data-route]' ? rail : []),
    createElement: () => new El(),
    getElementById: () => null,
    addEventListener: () => {},
  };
  const ctx = vm.createContext({ document, groupOf: (v) => GROUP[v] || 'ungrouped', fetch: async () => ({}), alert: () => {} });
  vm.runInContext(readFileSync(join(ADMIN, 'static', 'features.js'), 'utf8'), ctx);
  // The real navigationTabs(), lifted from the navigation source the panel ships.
  const nav = readFileSync(join(ADMIN, 'menus', 'navigation.js'), 'utf8');
  const line = nav.split('\n').find((l) => l.startsWith('function navigationTabs()'));
  assert.ok(line, 'navigationTabs() was not found in admin/menus/navigation.js');
  vm.runInContext(line, ctx);
  vm.runInContext(`FEATURES=${JSON.stringify({ ok: true, flags: FLAGS })};`, ctx);
  return { ctx, tabs, rail, byV: (v) => tabs.find((t) => t.dataset.v === v) };
}

test('a view is owned by its nav group or by a declared view name', () => {
  const { ctx } = boot();
  assert.equal(vm.runInContext("featureFlagOf('a11y').id", ctx), 'lanes-quality');
  assert.equal(vm.runInContext("featureFlagOf('overwatch').id", ctx), 'agents');
  assert.equal(vm.runInContext("featureFlagOf('sast')", ctx), null);
  assert.equal(vm.runInContext("featureOffFlag('overwatch')", ctx), null, 'an on flag is not off');
});

test('OFF: the view leaves navigation — hidden, and absent from navigationTabs()', () => {
  const { ctx, byV } = boot();
  vm.runInContext('featureMarkNav()', ctx);
  for (const v of ['a11y', 'stubs', 'denolint']) {
    assert.ok(byV(v).cls.has('fhide') && byV(v).cls.has('ghide'), `${v} is still shown`);
    assert.ok(byV(v).attrs['data-feature-off']);
  }
  const listed = vm.runInContext('navigationTabs().map(b=>b.dataset.v)', ctx);
  assert.deepEqual([...listed], ['overwatch', 'sast']);
});

test('ON: the view carries an "experimental" tag in the tab strip and the rail; a core view carries none', () => {
  const { ctx, byV, rail } = boot();
  vm.runInContext('featureMarkNav()', ctx);
  const tag = (el) => el.children.find((c) => c.className === 'exp-tag');
  assert.equal(tag(byV('overwatch')).textContent, 'experimental');
  assert.equal(byV('overwatch').children[0].className, 'exp-tag', 'the tag sits before the count');
  assert.ok(tag(rail[0]), 'the rail link for the same view is tagged');
  assert.equal(tag(byV('sast')), undefined);
  assert.equal(tag(rail[1]), undefined);
});

test('switching back on restores the view and swaps the hide for the tag', () => {
  const { ctx, byV } = boot();
  vm.runInContext('featureMarkNav()', ctx);
  vm.runInContext("FEATURES.flags[0].on=true; featureMarkNav();", ctx);
  assert.ok(!byV('a11y').cls.has('fhide'));
  assert.ok(!('data-feature-off' in byV('a11y').attrs));
  assert.ok(byV('a11y').children.some((c) => c.className === 'exp-tag'));
});

test('the notice on a switched-off URL names the flag and how to turn it on', () => {
  const { ctx } = boot();
  const store = vm.runInContext("featureOffText(featureOffFlag('a11y'))", ctx);
  assert.match(store, /"Quality views" \(flag lanes-quality\).*Settings → Experimental features.*CW_FEATURE_LANES_QUALITY=on/);
  const env = vm.runInContext("featureOffText(featureOffFlag('denolint'))", ctx);
  assert.match(env, /set by CW_EXPERIMENTAL.*CW_FEATURE_LANES_LINT=on or unset CW_EXPERIMENTAL/);
});

test('client read API: featureOn() answers per id (ON until told otherwise), featureApply() hides or tags', () => {
  const { ctx } = boot();
  assert.equal(vm.runInContext("featureOn('lanes-quality')", ctx), false);
  assert.equal(vm.runInContext("featureOn('agents')", ctx), true);
  assert.equal(vm.runInContext("featureOn('not-listed')", ctx), true);
  const el = new El();
  ctx.el = el;
  vm.runInContext("featureApply(el,'lanes-quality')", ctx);
  assert.ok(el.cls.has('fhide'));
  vm.runInContext("featureApply(el,'agents')", ctx);
  assert.ok(!el.cls.has('fhide'));
  assert.equal(el.children[0].textContent, 'experimental');
});

test('the panel wires it: script loaded, router shows the notice, nav re-marks on every pass, Settings has the switches', () => {
  const src = panelSource();
  assert.match(src, /id="feature-off-notice"/);
  assert.match(src, /id="sec-features"[\s\S]*id="feat-rows"/);
  const js = panelScript();
  assert.match(js, /const offFlag=typeof featureOffFlag==='function'\?featureOffFlag\(v\):null;/);
  assert.match(js, /function applyGroup\(v\)\{\n {2}if\(typeof featureMarkNav==='function'\)featureMarkNav\(\);/);
  assert.match(js, /function loadFeatures\(\)/, 'static/features.js is not in the document the panel serves');
});
