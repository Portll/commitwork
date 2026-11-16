// lib/dfd-paths-client.js: the drawing and wiring of the paths view, run here against a stand-in
// document. The stand-in keeps what the script writes (markup, text, attributes, hidden) and lets a
// test fire the events a reader would. What a browser adds on top (CSS, real layout of the page) is
// checked by rendering the page headlessly, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCore } from '../dfd-paths-core.mjs';
import { mountPathsView } from '../dfd-paths-client.js';

const load = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const MODEL = () => load('./fixtures/dfd-paths-model.dfd.json');
const FIXTURE = () => load('./fixtures/dfd-coverage.dfd.json');
const count = (text, part) => text.split(part).length - 1;

/** A document that records what is written to it and can fire events. */
function fakeDocument(model) {
  const make = (id, extra = {}) => {
    const on = {};
    return { id, innerHTML: '', textContent: '', hidden: false, className: '', value: '', max: 0, checked: true, dataset: {}, attrs: {}, scrolled: 0,
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, fn) { (on[t] = on[t] || []).push(fn); }, fire(t, ev = {}) { for (const fn of on[t] || []) fn(ev); },
      scrollIntoView() { this.scrolled += 1; }, focus() { doc.activeElement = this; doc.focused += 1; }, ...extra };
  };
  const els = new Map();
  const groups = {
    '#lvl button': [0, 1, 2].map((n) => make('', { dataset: { level: String(n) } })),
    '#flt button': ['all', 'live', 'grey', 'closed'].map((f) => make('', { dataset: { flt: f } })),
    '#opts input': ['halos', 'pips', 'guards', 'chips', 'labels', 'cov', 'tiles', 'gaps'].map((o) => make(`o-${o}`, { dataset: { opt: o } })),
    '#opts .cov-only': [make(''), make('')],
  };
  const tabs = make('tabs');
  const on = {};
  const doc = { activeElement: null, focused: 0, tabs, groups,
    getElementById(id) { if (id === 'dfd-data') return { textContent: JSON.stringify(model) }; if (!els.has(id)) els.set(id, make(id)); return els.get(id); },
    querySelectorAll(sel) { return groups[sel] || []; }, querySelector(sel) { return sel === '.tabs' ? tabs : null; },
    addEventListener(t, fn) { (on[t] = on[t] || []).push(fn); }, fire(t, ev) { for (const fn of on[t] || []) fn(ev); } };
  return doc;
}
/** An event target that answers `closest` for one selector with an element carrying `dataset`. */
const target = (selector, dataset = {}) => ({ dataset, closest: (s) => (s === selector ? { dataset } : null), matches: (s) => s.includes('tr[data-row]') });
const mount = (model) => {
  const doc = fakeDocument(model);
  const timers = { fns: [], cleared: 0, set(fn) { this.fns.push(fn); return this.fns.length; }, clear() { this.cleared += 1; } };
  const view = mountPathsView(doc, createCore, timers);
  return { doc, timers, S: view.core.S, core: view.core, draw: view.draw, $: (id) => doc.getElementById(id) };
};
const svg = (v) => v.$('wrap').innerHTML;

test('mounting draws the diagram, the tiles, both tables and the controls for the synthetic paths document', () => {
  // arrange
  const model = MODEL();
  // act
  const v = mount(model);
  // assert
  assert.match(svg(v), /^<svg class="dfd" [^>]*role="img" aria-label="Data flow diagram at boundaries level: 23 paths/);
  assert.equal(count(svg(v), '<g class="n '), 13);
  assert.equal(count(v.$('paths').innerHTML, '<tr data-row data-path='), 23);
  assert.equal(count(v.$('patches').innerHTML, '<tr data-row data-patch='), 12);
  assert.match(v.$('tiles').innerHTML, /<b>0<\/b><span>open paths to an impact<\/span>.*<b>14<\/b><span>fixed by a patch \(10 tested, 4 not tested\)/);
  assert.deepEqual([v.$('scrub').max, v.$('scrub').value, v.$('scrub-out').textContent.startsWith('12 of 12 · WCOMP cap'), v.$('play').textContent], [12, 12, true, '▶ play']);
  assert.deepEqual(v.doc.groups['#lvl button'].map((b) => b.attrs['aria-pressed']), ['false', 'true', 'false']);
  assert.deepEqual([v.$('tab-time').attrs['aria-selected'], v.$('pane-time').hidden, v.$('pane-combo').hidden], ['true', false, true]);
  assert.equal(v.$('focusbar').textContent.startsWith('Nothing selected.'), true);
});

test('text from the document is escaped wherever it lands, both quote characters included', () => {
  // arrange
  const model = FIXTURE();
  model.nodes.find((n) => n.kind === 'process').label = `x<y & "q" 'r'`;
  model.patches[0].title = `<b>bold</b> 'p'`;
  // act
  const v = mount(model);
  v.$('lvl').fire('click', { target: target('button', { level: '2' }) });
  // assert
  assert.equal(svg(v).includes('x<y'), false);
  assert.equal(svg(v).includes('x&lt;y &amp; &quot;q&quot; &#39;r&#39;'), true);
  assert.equal(v.$('patches').innerHTML.includes('&lt;b&gt;bold&lt;/b&gt; &#39;p&#39;'), true);
  assert.equal(v.$('patches').innerHTML.includes('<b>bold'), false);
});

test('the level buttons redraw at that level and clear any focus', () => {
  // arrange
  const v = mount(MODEL());
  v.S.focus = { patch: 'K8' };
  // act
  const sizes = ['0', '2', '1'].map((level) => { v.$('lvl').fire('click', { target: target('button', { level }) }); return [count(svg(v), '<g class="n '), v.S.focus]; });
  v.$('lvl').fire('click', { target: target('nothing') });
  // assert
  assert.deepEqual(sizes, [[5, null], [27, null], [13, null]]);
  assert.equal(v.S.level, 1);
});

test('at L2 every patch draws its guard, present or missing with the patches applied', () => {
  // arrange
  const v = mount(MODEL());
  v.$('lvl').fire('click', { target: target('button', { level: '2' }) });
  // act
  const all = [count(svg(v), 'class="guard present'), count(svg(v), 'class="guard absent')];
  v.$('k0').fire('click');
  const none = [count(svg(v), 'class="guard present'), count(svg(v), 'class="guard absent'), v.$('scrub-out').textContent];
  // assert
  assert.deepEqual(all, [12, 0]);
  assert.deepEqual(none, [0, 12, '0 of 12 · unpatched']);
});

test('stepping the timeline applies one patch, names it in the focus bar and marks what it just closed', () => {
  // arrange
  const v = mount(MODEL());
  v.$('by-set').fire('change', { target: { checked: false } });
  v.$('k0').fire('click');
  // act
  v.$('next').fire('click');
  const one = [v.S.k, v.S.landed, v.$('focusbar').innerHTML.startsWith('<b>Step 1: F3 hardening</b>'), count(svg(v), ' just')];
  v.$('scrub').fire('input', { target: { value: '5' } });
  const five = [v.S.k, v.S.landed, v.$('focusbar').innerHTML.includes('Guards E1 → P8')];
  v.$('prev').fire('click');
  v.$('prev').fire('click'); v.$('prev').fire('click'); v.$('prev').fire('click'); v.$('prev').fire('click'); v.$('prev').fire('click');
  v.$('kall').fire('click');
  // assert
  assert.deepEqual(one.slice(0, 3), [1, 'K3', true]);
  assert.equal(one[3] > 0, true);
  assert.deepEqual(five, [5, 'K8', true]);
  assert.deepEqual([v.S.k, v.S.landed], [12, null]);
});

test('a step whose flow needs a second patch says the flow stays open until that one lands', () => {
  // arrange: F18 names P13 → Q1, which F19 must close too
  const v = mount(MODEL());
  const k18 = v.core.PATCHES.findIndex((p) => p.id === 'K18') + 1;
  // act
  v.$('scrub').fire('input', { target: { value: String(k18) } });
  const text = v.$('focusbar').innerHTML;
  v.$('scrub').fire('input', { target: { value: String(v.core.PATCHES.findIndex((p) => p.id === 'K13') + 1) } });
  // assert
  assert.match(text, /a flow that needs another patch too stays open until that one lands/);
  assert.match(v.$('focusbar').innerHTML, /Closes no drawn path\./);
});

test('playback restarts from zero at the end, advances on each tick, stops at the last patch, and pauses on a second press', () => {
  // arrange
  const v = mount(MODEL());
  v.$('by-set').fire('change', { target: { checked: false } });
  // act
  v.$('play').fire('click');
  const started = [v.S.k, v.$('play').textContent, v.timers.fns.length];
  for (let i = 0; i < 12; i++) v.timers.fns[0]();
  const atEnd = [v.S.k, v.S.timer !== null];
  v.timers.fns[0]();
  const stopped = [v.S.k, v.S.timer, v.$('play').textContent];
  v.$('k0').fire('click'); v.$('play').fire('click');
  v.$('speed').fire('change');
  const restarted = v.timers.fns.length;
  v.$('play').fire('click');
  v.$('speed').fire('change');
  // assert
  assert.deepEqual(started, [0, '❚❚ pause', 1]);
  assert.deepEqual(atEnd, [12, true]);
  assert.deepEqual(stopped, [12, null, '▶ play']);
  assert.equal(restarted, 3);
  assert.deepEqual([v.S.timer, v.timers.fns.length], [null, 3]);
});

test('the combinations tab applies the ticked set and says what each patch alone would change', () => {
  // arrange
  const v = mount(MODEL());
  // act
  v.doc.tabs.fire('click', { target: target('button[data-mode]', { mode: 'combo' }) });
  v.$('c-none').fire('click');
  const none = v.$('combo-out').textContent;
  v.$('combo').fire('change', { target: { dataset: { combo: 'K18' }, checked: true } });
  const k18 = v.$('combo').innerHTML;
  v.$('combo').fire('change', { target: { dataset: { combo: 'K18' }, checked: false } });
  v.$('combo').fire('change', { target: { dataset: {} } });
  v.$('c-all').fire('click');
  v.doc.tabs.fire('click', { target: target('nothing') });
  // assert
  assert.equal(none, '0 of 12 ticked: 13 open, 4 closed, 6 not evaluated. Against the full set: 14 fewer closed.');
  assert.match(k18, /id="cb-K18" data-combo="K18" checked><span>F18 safe shape product <small>unticking changes no path/);
  assert.match(k18, /id="cb-K19" data-combo="K19"><span>F19 uint64 size <small>ticking closes 1/);
  assert.match(k18, /id="cb-K13" data-combo="K13"><span>F13 hardening <small>closes no drawn path/);
  assert.deepEqual([v.S.mode, v.S.combo.size, v.$('pane-combo').hidden, v.$('tab-combo').attrs['aria-selected']], ['combo', 12, false, 'true']);
  assert.match(v.$('combo').innerHTML, /id="cb-K8" data-combo="K8" checked><span>F8 set <small>unticking reopens 4/);
});

test('an unticked patch that needs a partner says which one', () => {
  // arrange
  const v = mount(MODEL());
  v.doc.tabs.fire('click', { target: target('button[data-mode]', { mode: 'combo' }) });
  // act
  v.$('c-none').fire('click');
  // assert
  assert.match(v.$('combo').innerHTML, /F18 safe shape product <small>closes nothing until F19 uint64 size is ticked too/);
});

test('selecting a chip, a path row, a patch row or a gap row traces it; clear removes the trace', () => {
  // arrange
  const v = mount(FIXTURE());
  const firstPath = v.core.build().paths[0].id;
  const firstGap = v.core.build().gaps[0].key;
  const patch = v.core.PATCHES[0].id;
  const fin = v.core.FINDINGS[0].id;
  // act
  const seen = [];
  for (const [sel, data, key] of [['[data-fin]', { fin }, 'fin'], ['tr[data-row]', { path: firstPath }, 'path'], ['tr[data-row]', { patch }, 'patch'], ['tr[data-row]', { gap: firstGap }, 'gap']]) {
    v.doc.fire('click', { target: target(sel, data) });
    seen.push([Object.keys(v.S.focus)[0] === key, count(svg(v), ' dim') > 0, /id="clear"/.test(v.$('focusbar').innerHTML)]);
  }
  v.doc.fire('click', { target: target('#clear') });
  v.doc.fire('click', { target: target('nothing') });
  // assert
  assert.deepEqual(seen, [[true, true, true], [true, true, true], [true, true, true], [true, true, true]]);
  assert.equal(v.S.focus, null);
  assert.equal(v.$('focusbar').scrolled, 3);
});

test('the focus bar words each kind of trace: a finding with and without a patch, a path, a gap, and a path that no longer exists', () => {
  // arrange
  const v = mount(MODEL());
  const say = (focus) => { v.S.focus = focus; v.draw(); return v.$('focusbar').innerHTML; };
  const closed = v.core.build().paths.find((p) => p.st === 'closed' && p.by.gate.g === 'fixed').id;
  const safe = v.core.build().paths.find((p) => p.st === 'closed' && p.by.gate.g === 'safe').id;
  const grey = v.core.build().paths.find((p) => p.st === 'grey').id;
  const gap = v.core.build().gaps[0].key;
  // act
  const text = { fin: say({ fin: 'F8' }), unpatched: say({ fin: 'MP-1' }), patch: say({ patch: 'K9' }), closed: say({ path: closed }), safe: say({ path: safe }), grey: say({ path: grey }), gone: say({ path: 'f0>f999' }), gap: say({ gap }), nogap: say({ gap: 'x:none' }) };
  // assert
  assert.match(text.fin, /^<b>F8<\/b>: 7 paths carry it: 0 open, 6 closed, 1 not evaluated\.<br><b>F8 set<\/b> \(applied, tested\) guards E1 → P8\./);
  assert.match(text.fin, /Outside any patch's reach: .*\(measured safe\).*\(not evaluated\)/);
  assert.match(text.unpatched, /The document carries no patch for it\./);
  assert.match(text.patch, /^<b>F9 depth guard<\/b>: 1 path carry it|^<b>F9 depth guard<\/b>: 1 path /);
  assert.match(text.closed, /<span class="st fixed[^"]*">✓ fixed<\/span> <b>E1 → .*ends in .*Fixed at /);
  assert.match(text.safe, /⊘ measured safe<\/span>.*Measured non-exploitable at E\d+ → E6/);
  assert.match(text.grey, /\? not evaluated<\/span>.*Not evaluated at /);
  assert.match(text.gone, /^That path does not exist with these patches applied\./);
  assert.match(text.gap, /id="clear"/);
  assert.match(text.nogap, /id="clear"/);
});

test('with no patch applied an open path says nothing stops it', () => {
  // arrange
  const v = mount(MODEL());
  v.$('k0').fire('click');
  // act
  const open = v.core.build().paths.find((p) => p.st === 'live').id;
  v.doc.fire('click', { target: target('tr[data-row]', { path: open }) });
  // assert
  assert.match(v.$('focusbar').innerHTML, /! open<\/span>.*Nothing stops it\./);
  assert.match(v.$('paths').innerHTML, /<span class="st live">! open<\/span>/);
  assert.match(v.$('patches').innerHTML, /<span class="st grey">not applied<\/span> F3 hardening/);
});

test('a patch row on the timeline applies every patch up to it; in combinations it leaves the ticked set alone', () => {
  // arrange
  const v = mount(MODEL());
  v.$('k0').fire('click');
  // act
  v.doc.fire('click', { target: target('tr[data-row]', { patch: 'K8' }) });
  const onTimeline = v.S.k;
  v.doc.tabs.fire('click', { target: target('button[data-mode]', { mode: 'combo' }) });
  v.$('c-none').fire('click');
  v.doc.fire('click', { target: target('tr[data-row]', { patch: 'K9' }) });
  // assert
  assert.equal(onTimeline, v.core.PATCHES.findIndex((p) => p.id === 'K8') + 1);
  assert.deepEqual([v.S.combo.size, v.S.focus], [0, { patch: 'K9' }]);
});

test('Enter or Space on a row or a chip selects it; other keys and other targets do nothing', () => {
  // arrange
  const v = mount(FIXTURE());
  const path = v.core.build().paths[0].id;
  let prevented = 0;
  const key = (k, t) => v.doc.fire('keydown', { key: k, target: t, preventDefault() { prevented += 1; } });
  // act
  key('Enter', target('tr[data-row]', { path }));
  const afterEnter = v.S.focus;
  v.S.focus = null;
  key(' ', target('tr[data-row]', { path }));
  const afterSpace = v.S.focus;
  v.S.focus = null;
  key('a', target('tr[data-row]', { path }));
  key('Enter', { closest: () => null });
  key('Enter', { matches: () => false, closest: () => null });
  // assert
  assert.deepEqual([afterEnter, afterSpace, v.S.focus, prevented], [{ path }, { path }, null, 2]);
});

test('the path filter buttons dim what is not on a path in that state', () => {
  // arrange
  const v = mount(FIXTURE());
  // act
  const dims = ['all', 'live', 'closed'].map((flt) => { v.$('flt').fire('click', { target: target('button', { flt }) }); return count(svg(v), ' dim'); });
  v.$('flt').fire('click', { target: target('nothing') });
  // assert
  assert.equal(dims[0], 0);
  assert.equal(dims[1] > 0 && dims[2] > 0, true);
  assert.deepEqual(v.doc.groups['#flt button'].map((b) => b.attrs['aria-pressed']), ['false', 'false', 'false', 'true']);
});

test('the coverage layer draws bars, flow marks and a ring on a controlled guard, with tiles and a gaps table', () => {
  // arrange
  const v = mount(FIXTURE());
  // act
  v.$('lvl').fire('click', { target: target('button', { level: '2' }) });
  const l2 = svg(v);
  // assert
  assert.equal(count(l2, '<g class="cv'), 5);
  assert.equal(count(l2, 'class="ring"'), 1);
  assert.deepEqual([count(l2, '<g class="fx ex'), count(l2, '<g class="fx nx')], [4, 2]);
  assert.match(v.$('cov-tiles').innerHTML, /<b>3 \/ 5<\/b><span>elements on a path with coverage measured \(1 below the 80% floor\)/);
  assert.match(v.$('cov-tiles').innerHTML, /<b>1 \/ 3<\/b><span>patches with a run-time control \(0 belt and braces, 0 compile-time only\)/);
  assert.equal(count(v.$('gaps').innerHTML, '<tr data-row data-gap='), 10);
  assert.match(v.$('patches').innerHTML, /<span class="st pf controlled">controlled<\/span> <span class="m">test: /);
  assert.deepEqual([v.$('cov-tiles').hidden, v.$('gaps-sec').hidden, v.doc.groups['#opts .cov-only'].map((l) => l.hidden)], [false, false, [false, false]]);
});

test('each render option hides its marks or its section, and the tickboxes follow the state', () => {
  // arrange
  const v = mount(FIXTURE());
  const tick = (opt, checked) => v.$('opts').fire('change', { target: { dataset: { opt }, checked } });
  // act
  for (const o of ['halos', 'pips', 'guards', 'chips', 'labels', 'tiles', 'gaps']) tick(o, false);
  const off = [v.$('wrap').className, v.$('tiles').hidden, v.$('cov-tiles').hidden, v.$('gaps-sec').hidden];
  tick('cov', false);
  const bars = count(svg(v), '<g class="cv');
  v.$('opts').fire('change', { target: { dataset: {} } });
  const boxes = Object.fromEntries(v.doc.groups['#opts input'].map((i) => [i.dataset.opt, i.checked]));
  for (const o of ['halos', 'pips', 'guards', 'chips', 'labels', 'tiles', 'gaps', 'cov']) tick(o, true);
  // assert
  assert.deepEqual(off, ['dfd-wrap no-halos no-pips no-guards no-chips no-labels', true, true, true]);
  assert.equal(bars, 0);
  assert.deepEqual(boxes, { halos: false, pips: false, guards: false, chips: false, labels: false, cov: false, tiles: false, gaps: false });
  assert.deepEqual([v.$('wrap').className, v.$('tiles').hidden, v.$('gaps-sec').hidden, v.S.cov], ['dfd-wrap', false, false, true]);
});

test('a document with no coverage and no control keeps the coverage sections and tickboxes hidden', () => {
  // arrange
  const model = MODEL();
  for (const p of model.patches) p.evidence = { level: p.evidence.level };
  // act
  const v = mount(model);
  // assert
  assert.deepEqual([v.core.HAS_COV, v.$('cov-tiles').hidden, v.$('gaps-sec').hidden, v.doc.groups['#opts .cov-only'].map((l) => l.hidden), v.$('gaps').innerHTML], [false, true, true, [true, true], '']);
});

test('applying SARIF redraws with the results and reports the count; removing them restores the document', () => {
  // arrange
  const v = mount(MODEL());
  v.$('sarif').value = JSON.stringify({ runs: [{ tool: { driver: { name: 'lab' } }, results: [{ ruleId: 'F17', kind: 'fail', message: { text: 'reached' }, locations: [{ logicalLocations: [{ name: 'E12' }] }] }] }] });
  // act
  v.$('sarif-go').fire('click');
  const applied = [v.$('sarif-msg').textContent, /<b>1<\/b><span>open paths to an impact/.test(v.$('tiles').innerHTML)];
  v.doc.fire('click', { target: target('tr[data-row]', { path: v.core.build().paths.find((p) => p.st === 'live').id }) });
  const said = v.$('focusbar').innerHTML;
  v.$('sarif-clear').fire('click');
  // assert
  assert.deepEqual(applied, ['1 results read: 1 fail, 0 pass, 0 open or review. 1 matched a step in the diagram, 0 matched nothing.', true]);
  assert.match(said, /Nothing stops it\./);
  assert.deepEqual([v.$('sarif-msg').textContent, /<b>0<\/b><span>open paths to an impact/.test(v.$('tiles').innerHTML)], ['SARIF results removed.', true]);
});

test('a redraw gives the keyboard focus back to the control that had it', () => {
  // arrange
  const v = mount(MODEL());
  const box = v.$('cb-K8');
  v.doc.activeElement = { id: 'cb-K8' };
  // act
  v.draw();
  const refocused = [v.doc.activeElement === box, v.doc.focused];
  v.draw();
  // assert: already on the element, so it is not focused again
  assert.deepEqual(refocused, [true, 1]);
  assert.equal(v.doc.focused, 1);
});

test('a document with no patch and no impact draws, with empty tables that say why', () => {
  // arrange
  const model = { v: 1, kind: 'dfd', nodes: [{ id: 'node:a', kind: 'external', subtype: 'actor', label: 'a' }, { id: 'node:p', kind: 'process', label: 'p' }, { id: 'node:s', kind: 'store', subtype: 'file', label: 's' }],
    flows: [{ from: 'node:a', to: 'node:p', mode: 'sync', label: 'in' }, { from: 'node:p', to: 'node:s', mode: 'sync', role: 'error', label: 'err', existence: 'unknown' }] };
  // act
  const v = mount(model);
  v.$('lvl').fire('click', { target: target('button', { level: '2' }) });
  v.$('next').fire('click');
  // assert
  assert.match(v.$('paths').innerHTML, /No element carries an impact, so no path ends anywhere\./);
  assert.match(v.$('patches').innerHTML, /The document carries no patch\./);
  assert.match(svg(v), /✕ err/);
  assert.deepEqual([v.S.k, v.$('scrub-out').textContent], [0, '0 of 0 · unpatched']);
});

test('by default a step lands a whole change set: forward and back move between sets, play runs them, and the bar names the set', () => {
  // arrange: the synthetic document has three sets: 4 patches already in the source, the F8 set (1), the open-findings set (7)
  const v = mount(MODEL());
  v.$('k0').fire('click');
  // act
  v.$('next').fire('click');
  const first = [v.S.k, v.S.landed, v.$('focusbar').innerHTML, v.$('scrub-out').textContent, v.$('by-set').checked];
  v.$('next').fire('click');
  const second = [v.S.k, v.$('focusbar').innerHTML.startsWith('<b>Step 5: F8 set</b>')];
  v.$('next').fire('click');
  const third = [v.S.k, v.$('scrub-out').textContent.endsWith('change set 3 of 3')];
  v.$('next').fire('click');
  v.$('prev').fire('click');
  const back = v.S.k;
  v.$('prev').fire('click'); v.$('prev').fire('click'); v.$('prev').fire('click');
  const start = v.S.k;
  v.$('scrub').fire('input', { target: { value: '7' } });
  const mid = [v.S.k, /^<b>Change set 3 of 3: [^<]*<\/b> lands 2 patches together: F9 depth guard, F10 nesting guard\. The last of them: <b>Step 7:/.test(v.$('focusbar').innerHTML)];
  v.$('k0').fire('click'); v.$('play').fire('click');
  v.timers.fns[0](); v.timers.fns[0](); v.timers.fns[0]();
  // assert
  assert.deepEqual([first[0], first[1], first[4]], [4, 'K13', true]);
  assert.match(first[2], /^<b>Change set 1 of 3: Hardening already in the open source[^<]*<\/b> lands 4 patches together: F3 hardening, F4 hardening, F5 hardening, F13 hardening\. The last of them: <b>Step 4: F13 hardening<\/b>/);
  assert.match(first[3], /^4 of 12 · F13 hardening · .* · change set 1 of 3$/);
  assert.deepEqual(second, [5, true]);
  assert.deepEqual(third, [12, true]);
  assert.deepEqual([back, start, mid], [5, 0, [7, true]]);
  assert.equal(v.S.k, 12);
});


test('markup in a control test name stays text in the guard tooltip', () => {
  // arrange
  const doc = FIXTURE();
  const P = '</title><img src=x id=PWN onerror=1>';
  for (const p of doc.patches) if (p.evidence && p.evidence.control) p.evidence.control.test = `${p.evidence.control.test}${P}`;
  // act
  const v = mount(doc);
  v.$('lvl').fire('click', { target: target('button', { level: '2' }) });
  const out = svg(v);
  // assert
  assert.equal(count(out, '<img'), 0);
  assert.ok(out.includes('&lt;img src=x id=PWN onerror=1&gt;'));
});
