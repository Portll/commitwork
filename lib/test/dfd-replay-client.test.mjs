// lib/dfd-replay-client.js: the drawing and wiring of the replay view, run against a stand-in
// document that keeps what the script writes and lets a test fire what a reader would. What a
// browser adds (CSS, real layout, focus) is checked by rendering the page headlessly, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReplayCore } from '../dfd-replay-core.mjs';
import { mountReplayView } from '../dfd-replay-client.js';
import { MODEL } from './fixtures/dfd-replay-model.mjs';

const count = (text, part) => text.split(part).length - 1;
function fakeDocument(model, { cursor = true } = {}) {
  const make = (id) => {
    const on = {};
    const el = { id, innerHTML: '', textContent: '', hidden: false, value: '', checked: false, max: '', attrs: {}, focused: 0,
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, fn) { (on[t] = on[t] || []).push(fn); }, fire(t, ev = {}) { for (const fn of on[t] || []) fn(ev); } };
    if (id === 'tree' && cursor) el.querySelector = () => ({ focus() { el.focused += 1; } });
    return el;
  };
  const els = new Map();
  return { els, getElementById(id) { if (id === 'dfd-data') return { textContent: JSON.stringify(model) }; if (!els.has(id)) els.set(id, make(id)); return els.get(id); } };
}
/** An event whose target answers `closest` for one selector with an element carrying `dataset`. */
const on = (selector, dataset = {}, extra = {}) => ({ target: { dataset, closest: (s) => (s === selector ? { dataset } : null) }, ...extra });
const miss = { target: { closest: () => null } };
const mount = (model = MODEL(), opts) => {
  const doc = fakeDocument(model, opts);
  const timers = { fns: [], ms: [], cleared: 0, set(fn, ms) { this.fns.push(fn); this.ms.push(ms); return this.fns.length; }, clear() { this.cleared += 1; } };
  const view = mountReplayView(doc, createReplayCore, { timers });
  return { doc, timers, view, S: view.core.S, core: view.core, $: (id) => doc.getElementById(id) };
};
const svg = (v) => v.$('canvas').innerHTML;

test('mounting draws every region: controls with counts, playback at step 0, overview, canvas, tree, account, empty selection', () => {
  // arrange
  const model = MODEL();
  // act
  const v = mount(model);
  // assert
  assert.match(svg(v), /^<svg class="rp" viewBox="0 0 \d+ \d+" width="\d+" height="\d+" role="img" aria-label="Process flow at step 0 of 4: 9 stations, 15 flows">/);
  assert.equal(count(svg(v), 'class="sn '), 9);
  assert.equal(count(svg(v), '<g class="oc'), 5);
  assert.match(svg(v), /<g class="sn circle L-structure st-open" data-uid="n:P2" tabindex="0" role="button" aria-label="4. Field parser">/);
  assert.match(svg(v), /<g class="sn square L-trigger" data-uid="n:S1"/);
  assert.match(svg(v), /<g class="sn store L-structure" data-uid="n:D1"/);
  assert.match(svg(v), /<g class="L-controls gd pending" data-patch="K1"><title>K1 Field allow list, not yet landed<\/title>/);
  assert.match(svg(v), /<g class="L-controls gd missing"><title>check missing<\/title>/);
  assert.match(svg(v), /<g class="e L-flows L-trigger" data-key="n:S1\nn:P1"><title>manifest bytes<\/title><path d="[^"]+" marker-end="url\(#rp-a\)"\/><text class="el" [^>]*>manifest bytes<\/text><\/g>/);
  assert.match(svg(v), /<g class="e L-flows live[^"]*" data-key="n:P2\nn:X1"><title>field as shell argument<\/title><path d="[^"]+" marker-end="url\(#rp-a-live\)"\/>/);
  assert.match(svg(v), /<g class="L-trust tb"><rect [^>]*\/><text [^>]*>Carrier platform · trust boundary<\/text><\/g>/);
  assert.match(svg(v), /<g class="sev L-weakness"><rect [^>]*\/><text [^>]*>high<\/text><\/g>/);
  assert.match(svg(v), /<g class="oc st-open" data-uid="n:X1" tabindex="0" role="button" aria-label="10. Command execution on host: open · H1, H3">/);
  assert.equal(v.$('pb').hidden, false);
  assert.deepEqual([v.$('pb-scrub').max, v.$('pb-scrub').value, v.$('pb-play').textContent, v.$('pb-out').textContent], ['4', '0', 'Play', 'Step 0 of 4 · original position, unfixed']);
  assert.equal(v.$('pb-play').attrs['aria-pressed'], 'false');
  assert.match(v.$('m-asof').innerHTML, /^<option value="0" selected>0 · original position, unfixed · 7 open<\/option><option value="1">1 · no change recorded · 6 open<\/option>/);
  assert.match(v.$('m-path').innerHTML, /^<option value="" selected>none<\/option><option value="H1">H1 · Command entry from manifest field<\/option>/);
  assert.deepEqual([v.$('m-scope').value, v.$('m-colour').value], ['all', 'state']);
  assert.match(v.$('f-layers').innerHTML, /^<legend>Layers<\/legend><label><input type="checkbox" data-facet="layers" data-value="structure" checked> structure <span class="n">11<\/span><\/label>/);
  assert.match(v.$('f-state').innerHTML, /data-value="thin" checked> dismissed, unproven <span class="n">0<\/span>/);
  assert.match(v.$('f-sev').innerHTML, /data-value="critical" checked> critical <span class="n">1<\/span>/);
  assert.match(v.$('f-ev').innerHTML, /data-value="none" checked> none <span class="n">0<\/span>/);
  assert.match(v.$('overview').innerHTML, /^<span class="ov-k">Sources 2<\/span><button type="button" class="ov" data-lane="g_in" aria-pressed="false">Manifest intake <span class="n bad">4 open<\/span><\/button>/);
  assert.match(v.$('overview').innerHTML, /class="ov trust" data-lane="g_carrier"/);
  assert.match(v.$('overview').innerHTML, /<span class="ov-k">Outcomes 4<\/span>$/);
  assert.match(v.$('tree').innerHTML, /^<div role="treeitem" aria-level="1" aria-expanded="false" aria-selected="false" tabindex="0" class="tr d0 dir" data-key="d:intake"><span class="tw">▸<\/span><span class="fn">intake\/<\/span><span class="b bad">4 open<\/span><span class="b">68% cov<\/span><span class="b">3 el<\/span><\/div>/);
  assert.match(v.$('account').innerHTML, /^<h2>Step 0 of 4<\/h2><p class="set">Original position, unfixed<\/p><dl class="tally"><div><dt>Hazards found<\/dt><dd>7<\/dd><\/div><div><dt>Dealt with<\/dt><dd class="ok">0<\/dd><\/div><div><dt>Still open<\/dt><dd class="bad">7<\/dd><\/div><\/dl>/);
  assert.match(v.$('account').innerHTML, /<h3>Still open: 7<\/h3><ul class="hz"><li><p class="hz-h"><button type="button" class="lk" data-sel="finding" data-id="H6">H6<\/button> Rate quote trusted unchecked <span class="sv sev-critical">critical<\/span><\/p>/);
  assert.match(v.$('sel').innerHTML, /No selection/);
  assert.equal(v.$('hits').hidden, true);
});

test('playback: forward lands a change set whole, opens what it touches, restates states; back, first, last, scrubber, menu', () => {
  // arrange
  const v = mount();
  // act
  v.$('pb').fire('click', on('[data-pb]', { pb: 'next' }));
  v.$('pb').fire('click', on('[data-pb]', { pb: 'next' }));
  const two = { svg: svg(v), out: v.$('pb-out').textContent, account: v.$('account').innerHTML, tree: v.$('tree').innerHTML };
  v.$('pb').fire('click', on('[data-pb]', { pb: 'prev' }));
  const one = v.S.step;
  v.$('pb').fire('click', on('[data-pb]', { pb: 'last' }));
  const last = v.S.step;
  v.$('pb').fire('click', on('[data-pb]', { pb: 'first' }));
  const first = v.S.step;
  v.$('pb-scrub').fire('input', { target: { value: '3' } });
  const scrub = v.S.step;
  v.$('m-asof').fire('change', { target: { value: '1' } });
  v.$('pb').fire('click', miss);
  // assert
  assert.equal(two.out, 'Step 2 of 4 · Bound field parser');
  assert.match(two.svg, /<g class="sn circle L-structure st-proven chg" data-uid="n:P2"[^>]*><title>[^<]*<\/title><circle class="ring"/);
  assert.match(two.svg, /<g class="e L-flows fixed[^"]*" data-key="n:P2\nn:X1"><title>field as shell argument<\/title><path d="[^"]+" marker-end="url\(#rp-a-fixed\)"\/>/);
  assert.match(two.svg, /<g class="L-controls gd set" data-patch="K1">/);
  assert.match(two.svg, /<g class="oc st-proven" data-uid="n:R1"/);
  assert.match(two.account, /<h2>Step 2 of 4<\/h2><p class="set">Bound field parser <span class="sub">pull request · merged · 3 files · 4 elements<\/span><\/p>/);
  assert.match(two.account, /<h3>Dealt with here: 1<\/h3><ul class="hz"><li><p class="hz-h"><button [^>]*data-id="H1">H1<\/button> Command entry from manifest field <span class="sv sev-high">high<\/span><\/p><dl><dt>Risk<\/dt><dd>Command execution on host \(critical\)<\/dd><dt>Location<\/dt><dd class="m">intake\/parse\/fields.js:42<\/dd><dt>State now<\/dt><dd><span class="pill st-proven">fixed, tested<\/span><\/dd><dt>Basis<\/dt><dd>test failing without fix<\/dd><dt>Change<\/dt><dd>Field allow list: Rejects any field outside the allow list.<\/dd><\/dl><\/li><\/ul>/);
  assert.match(two.tree, /class="tr d0 dir chg" data-key="d:intake"><span class="tw">▾<\/span>/);
  assert.match(two.tree, /<span class="b chg">changed<\/span>/);
  assert.deepEqual([one, last, first, scrub, v.S.step], [1, 4, 0, 3, 1]);
});

test('step 1 lists rulings named here and still open; a step that closes nothing says so', () => {
  // arrange
  const m = MODEL();
  m.prs.push({ id: 'pr-3', title: 'Docs only', files: ['docs/notes.md'] });
  const v = mount(m);
  // act
  v.view.goStep(1);
  const one = v.$('account').innerHTML;
  v.view.goStep(4);
  const three = v.$('account').innerHTML;
  // assert
  assert.match(one, /<h3>Named here, still open: 1<\/h3>/);
  assert.match(one, /<p class="set">no change recorded <span class="sub">rulings · 2 files · 2 elements<\/span>/);
  assert.match(three, /<p class="sub">No hazard closed<\/p>/);
});

test('play runs the steps on a timer at the chosen speed, pauses, restarts from the end, and stops at the last step', () => {
  // arrange
  const v = mount();
  v.$('pb-speed').value = '700';
  // act
  v.$('pb').fire('click', on('[data-pb]', { pb: 'play' }));
  const started = [v.timers.ms[0], v.$('pb-play').textContent, v.$('pb-play').attrs['aria-pressed']];
  v.timers.fns[0]();
  const ticked = v.S.step;
  v.$('pb').fire('click', on('[data-pb]', { pb: 'play' }));
  const paused = [v.view.V.playing, v.$('pb-play').textContent];
  v.view.goStep(4);
  v.$('pb').fire('click', on('[data-pb]', { pb: 'play' }));
  const restarted = v.S.step;
  v.view.goStep(3);
  v.timers.fns[v.timers.fns.length - 1]();
  const ended = [v.S.step, v.view.V.playing];
  v.$('pb').fire('click', on('[data-pb]', { pb: 'play' }));
  while (v.view.V.playing !== null) v.timers.fns[v.timers.fns.length - 1]();
  v.$('pb').fire('click', on('[data-pb]', { pb: 'play' }));
  v.view.goStep(4);
  v.timers.fns[v.timers.fns.length - 1]();
  // assert
  assert.deepEqual(started, [700, 'Pause', 'true']);
  assert.equal(ticked, 1);
  assert.deepEqual(paused, [null, 'Play']);
  assert.equal(restarted, 0);
  assert.deepEqual(ended, [4, null]);
  assert.equal(v.view.V.playing, null);
  assert.ok(v.timers.cleared >= 1);
});

test('a step on a timer with no speed chosen falls back to 1.5 s', () => {
  // arrange
  const v = mount();
  v.$('pb-speed').value = '';
  // act
  v.$('pb').fire('click', on('[data-pb]', { pb: 'play' }));
  v.timers.fns[0]();
  // assert
  assert.deepEqual(v.timers.ms, [1500, 1500]);
});

test('the two tickboxes: touched groups and touched files follow the step only while ticked', () => {
  // arrange
  const v = mount(MODEL());
  v.core.S.open.clear();
  v.view.goStep(2);
  // act
  v.$('pb-follow').fire('change', { target: { checked: false } });
  const follow = [v.S.follow, svg(v).includes('data-uid="g:g_in"')];
  v.$('pb-tree').fire('change', { target: { checked: false } });
  const tree = [v.S.treeFollow, v.$('tree').innerHTML.includes('aria-expanded="true"')];
  // assert
  assert.deepEqual(follow, [false, true]);
  assert.deepEqual(tree, [false, false]);
  assert.equal(v.$('pb-follow').checked, false);
});

test('selecting a station emphasises it, reveals its file in the tree and fills the detail', () => {
  // arrange
  const v = mount();
  // act
  v.$('canvas').fire('click', on('[data-uid]', { uid: 'n:P2' }));
  // assert
  assert.match(svg(v), /^<svg class="rp has-em"/);
  assert.match(svg(v), /class="sn circle L-structure st-open on" data-uid="n:P2"/);
  assert.match(v.$('tree').innerHTML, /aria-selected="true" tabindex="0" class="tr d2 file on cur" data-key="f:intake\/parse\/fields.js"/);
  assert.match(v.$('sel').innerHTML, /^<h3>Field parser<\/h3><p class="sub">process · Manifest intake › Manifest parser<\/p><p><button type="button" class="lk" data-sel="file" data-id="intake\/parse\/fields.js">intake\/parse\/fields.js<\/button> <span class="sub">50% line coverage<\/span><\/p><p class="m">intake\/parse\/fields.js<\/p>/);
  assert.match(v.$('sel').innerHTML, /<h4>Inbound checks<\/h4><ul><li><span class="cpill">K1<\/span> Field allow list <span class="sub">patch not landed · tested<\/span><\/li><\/ul>/);
  assert.match(v.$('sel').innerHTML, /<h4>Data in<\/h4><ul><li>raw fields from <button [^>]*data-id="P1">Manifest reader<\/button><\/li><\/ul><h4>Data out<\/h4>/);
  assert.match(v.$('overview').innerHTML, /class="ov on" data-lane="g_in" aria-pressed="true"/);
});

test('a source, an outcome and a station with a note select as elements; a miss clears; a key press selects', () => {
  // arrange
  const v = mount();
  // act
  v.$('canvas').fire('click', on('[data-uid]', { uid: 'n:X1' }));
  const out = v.$('sel').innerHTML;
  v.$('canvas').fire('click', on('[data-uid]', { uid: 'n:P5' }));
  const note = v.$('sel').innerHTML;
  v.$('canvas').fire('click', miss);
  const cleared = v.S.sel;
  let prevented = 0;
  v.$('canvas').fire('keydown', on('[data-uid]', { uid: 'n:S1' }, { key: 'Enter', preventDefault: () => { prevented += 1; } }));
  const key = v.S.sel;
  v.$('canvas').fire('keydown', on('[data-uid]', { uid: 'n:S2' }, { key: 'x' }));
  v.$('canvas').fire('keydown', { key: ' ', target: { closest: () => null } });
  v.$('canvas').fire('keydown', on('[data-uid]', { uid: 'nope' }, { key: ' ' }));
  // assert
  assert.match(out, /^<h3>Command execution on host<\/h3><p class="sub">system · impact critical<\/p><p class="m">Shell command run<\/p>/);
  assert.match(note, /<p class="sub">Formats a notice; see ledger\/templates\/notice.txt.<\/p>/);
  assert.equal(cleared, null);
  assert.deepEqual(key, { kind: 'node', id: 'S1' });
  assert.equal(prevented, 1);
  assert.deepEqual(v.S.sel, { kind: 'node', id: 'S1' });
});

test('a closed group opens in place and selects its lane; a "more" box widens its group', () => {
  // arrange
  const m = MODEL();
  const v = mount(m);
  v.core.S.open.delete('g_led');
  v.core.setStep(0);
  v.view.draw();
  // act
  const closed = svg(v).includes('data-uid="g:g_led"');
  v.$('canvas').fire('click', on('[data-uid]', { uid: 'g:g_led' }));
  const opened = [svg(v).includes('data-uid="n:P4"'), v.S.sel];
  const w = mount(MODEL(), {});
  w.core.S.caps.set('g_led', 1);
  w.core.S.memo.clear();
  w.view.draw();
  const more = svg(w).match(/<g class="sn more L-structure[^"]*" data-uid="m:g_led"/) !== null;
  w.$('canvas').fire('click', on('[data-uid]', { uid: 'm:g_led' }));
  // assert
  assert.equal(closed, true);
  assert.deepEqual(opened, [true, { kind: 'lane', id: 'g_led' }]);
  assert.equal(more, true);
  assert.equal(svg(w).includes('data-uid="m:g_led"'), false);
  assert.match(v.$('sel').innerHTML, /^<h3>Ledger writer<\/h3><p class="sub">lane · 3 elements<\/p><h4>Issues: 3<\/h4>/);
});

test('a closed group unit selected from detail shows its elements; a "more" unit says outside scope', () => {
  // arrange
  const v = mount();
  v.core.S.open.delete('g_led');
  v.core.S.caps.set('g_parse', 1);
  v.core.setStep(0);
  // act
  v.core.select('unit', 'g:g_led');
  v.view.draw();
  const group = v.$('sel').innerHTML;
  v.core.select('unit', 'm:g_parse');
  v.view.draw();
  const more = v.$('sel').innerHTML;
  // assert
  assert.match(group, /^<h3>Ledger writer<\/h3><p class="sub">closed group · 3 elements<\/p><h4>Issues: 3<\/h4>/);
  assert.match(svg(v), /<rect class="shp" [^>]*rx="6"\/><text class="ct" [^>]*>\+1<\/text>/);
  assert.match(more, /^<h3>1 more<\/h3><p class="sub">elements outside scope · 1 elements<\/p><h4>Issues: 1<\/h4>.*<h4>Elements<\/h4><ul><li><button [^>]*data-id="P2">Field parser<\/button><\/li><\/ul>$/);
});

test('a guard selects the issue its patch closes; an unknown guard selects nothing', () => {
  // arrange
  const v = mount();
  // act
  v.$('canvas').fire('click', on('[data-patch]', { patch: 'K2' }));
  const sel = v.S.sel;
  const detail = v.$('sel').innerHTML;
  const path = v.$('m-path').innerHTML;
  v.$('canvas').fire('click', on('[data-patch]', { patch: 'nope' }));
  // assert
  assert.deepEqual(sel, { kind: 'finding', id: 'H2' });
  assert.match(detail, /^<h3>H2 Ledger query injection<\/h3><p><span class="pill st-open">open<\/span> <span class="sv sev-medium">medium<\/span> <span class="m">CWE-89<\/span> <span class="m">sql-injection<\/span><\/p><dl><dt>Location<\/dt><dd class="m">ledger\/write.js:12<\/dd>/);
  assert.match(detail, /<h4>Canvas path<\/h4><p>Ledger row writer → Ledger tampering<\/p>/);
  assert.doesNotMatch(detail, /<h4>Change<\/h4>/);
  assert.match(detail, /<h4>Planned<\/h4><ul><li><span class="cpill">K2<\/span> Bound query parameters · step 3<\/li><\/ul>/);
  assert.match(path, /<option value="H2" selected>H2 · Ledger query injection<\/option>/);
  assert.deepEqual(v.S.sel, { kind: 'finding', id: 'H2' });
});

test('an issue with a message, a note and controls shows them all', () => {
  // arrange
  const v = mount();
  v.view.goStep(1);
  // act
  v.$('m-path').fire('change', { target: { value: 'H4' } });
  const h4 = v.$('sel').innerHTML;
  v.$('m-path').fire('change', { target: { value: 'H1' } });
  const h1 = v.$('sel').innerHTML;
  v.$('m-path').fire('change', { target: { value: '' } });
  // assert
  assert.match(h4, /<dt>Ruled at<\/dt><dd>step 1<\/dd>/);
  assert.match(h4, /<p class="sub">Judged harmless.<\/p>/);
  assert.match(h4, /<h4>Controls<\/h4><ul><li>flow: clamp · intake\/test\/units.test.js: clamps<\/li><\/ul>/);
  assert.match(h1, /<dt>Outcomes reached<\/dt><dd>Command execution on host \(critical\), Ledger tampering \(high\), Intake crash \(DoS\) \(low\)<\/dd>/);
  assert.match(h1, /<p class="sub">Field reaches a shell argument.<\/p>/);
  assert.equal(v.S.sel, null);
});

test('a control with no test says so; an issue nobody ruled on says no ruling', () => {
  // arrange
  const m = MODEL();
  m.findings.push({ id: 'H9', status: 'live', at: { node: 'P1' }, controls: [{ axis: 'sink', what: 'escape', test: null }] });
  const v = mount(m);
  // act
  v.$('m-path').fire('change', { target: { value: 'H9' } });
  // assert
  assert.match(v.$('sel').innerHTML, /<li>sink: escape · no test<\/li>/);
  assert.match(v.$('sel').innerHTML, /<dt>Ruled at<\/dt><dd>no ruling<\/dd>/);
});

test('the file tree: selecting a file marks its elements and fills the detail; a directory toggles; keys move the cursor', () => {
  // arrange
  const v = mount();
  v.view.goStep(2);
  // act
  v.$('tree').fire('click', on('[data-key]', { key: 'f:intake/parse/fields.js' }));
  const file = { svg: svg(v), sel: v.$('sel').innerHTML, focused: v.$('tree').focused };
  v.$('tree').fire('click', on('[data-key]', { key: 'd:ledger' }));
  const dir = v.$('tree').innerHTML;
  let prevented = 0;
  v.$('tree').fire('keydown', { key: 'ArrowDown', preventDefault: () => { prevented += 1; } });
  v.$('tree').fire('keydown', { key: 'Enter' });
  v.$('tree').fire('keydown', { key: 'q' });
  v.$('tree').fire('click', miss);
  // assert
  assert.match(file.svg, /class="sn circle L-structure st-proven chg on" data-uid="n:P2"/);
  assert.match(file.sel, /^<h3 class="m">intake\/parse\/fields.js<\/h3><p class="sub">changed this step · 0 open · 1 fixed · 50% line coverage · 1 elements<\/p><h4>Elements: 1<\/h4><ul><li><button [^>]*data-id="P2">Field parser<\/button><\/li><\/ul><h4>Issues: 1<\/h4>/);
  assert.match(file.sel, /<h4>Traced paths<\/h4><p><button [^>]*data-id="H1">H1<\/button><\/p><h4>Change sets<\/h4><ul><li>step 2 · pr-1<\/li><li>step 3 · pr-2<\/li><\/ul>/);
  assert.ok(file.focused >= 1);
  assert.match(dir, /aria-expanded="true" aria-selected="false" tabindex="0" class="tr d0 dir cur" data-key="d:ledger"><span class="tw">▾<\/span>/);
  assert.equal(prevented, 1);
  assert.equal(v.S.sel.kind, 'file');
});

test('a tree with no cursor support still draws, and an empty tree says there is no file', () => {
  // arrange
  const m = { v: 1, title: 't', nodes: [{ id: 'A', kind: 'process', label: 'nothing' }], flows: [] };
  // act
  const v = mount(m, { cursor: false });
  v.$('tree').fire('keydown', { key: 'ArrowDown' });
  // assert
  assert.equal(v.$('tree').innerHTML, '<p class="sub">No file paths</p>');
  assert.equal(v.$('pb').hidden, true);
  assert.match(v.$('account').innerHTML, /<h3>Nothing left open<\/h3>/);
});

test('detail links select elements, files and issues; clicks off a link do nothing', () => {
  // arrange
  const v = mount();
  // act
  v.$('detail').fire('click', on('[data-sel]', { sel: 'node', id: 'P4' }));
  const node = v.S.sel;
  v.$('detail').fire('click', on('[data-sel]', { sel: 'file', id: 'ledger/write.js' }));
  const file = v.S.sel;
  v.$('detail').fire('click', miss);
  // assert
  assert.deepEqual([node, file], [{ kind: 'node', id: 'P4' }, { kind: 'file', id: 'ledger/write.js' }]);
  assert.deepEqual(v.S.sel, { kind: 'file', id: 'ledger/write.js' });
});

test('overview: a lane button opens its group and emphasises the lane; ungrouped lanes are not toggled', () => {
  // arrange
  const v = mount();
  v.core.S.open.delete('g_led');
  v.core.setStep(0);
  v.view.draw();
  // act
  v.$('overview').fire('click', on('[data-lane]', { lane: 'g_led' }));
  const sel = v.S.sel;
  v.$('overview').fire('click', on('[data-lane]', { lane: 'g_led' }));
  v.$('overview').fire('click', on('[data-lane]', { lane: '' }));
  v.$('overview').fire('click', miss);
  // assert
  assert.deepEqual(sel, { kind: 'lane', id: 'g_led' });
  assert.equal(v.core.isOpen('g_led'), true);
  assert.deepEqual(v.S.sel, { kind: 'lane', id: '' });
  assert.match(v.$('sel').innerHTML, /No selection/);
});

test('search filters the tree, marks stations and lists results; a miss says no match; short text hides the list', () => {
  // arrange
  const v = mount();
  // act
  v.$('q').fire('input', { target: { value: 'sql' } });
  const hits = { list: v.$('hits').innerHTML, hidden: v.$('hits').hidden, tree: v.$('tree').innerHTML, svg: svg(v) };
  v.$('q').fire('input', { target: { value: 'zzzz' } });
  const none = v.$('hits').innerHTML;
  v.$('q').fire('input', { target: { value: '' } });
  // assert
  assert.match(hits.list, /^<h3>Search results: 1<\/h3><ul><li><button type="button" class="lk" data-sel="finding" data-id="H2">H2 Ledger query injection<\/button> <span class="sub">finding · CWE-89<\/span><\/li><\/ul>$/);
  assert.equal(hits.hidden, false);
  assert.match(hits.tree, /data-key="d:ledger"/);
  assert.doesNotMatch(hits.tree, /data-key="d:intake"/);
  assert.match(hits.svg, /class="sn circle L-structure st-open hit" data-uid="n:P4"/);
  assert.equal(none, '<p class="sub">No match</p>');
  assert.equal(v.$('hits').hidden, true);
  v.$('q').fire('input', { target: { value: undefined } });
  assert.equal(v.S.q, '');
});

test('modes and facets apply at once and are reversible', () => {
  // arrange
  const v = mount();
  // act
  v.$('m-colour').fire('change', { target: { value: 'coverage' } });
  const cov = svg(v);
  v.$('m-scope').fire('change', { target: { value: 'step' } });
  const scope = v.S.scope;
  v.$('facets').fire('change', { target: { dataset: { facet: 'layers', value: 'flows' }, checked: false } });
  const off = svg(v);
  v.$('facets').fire('change', { target: { dataset: { facet: 'layers', value: 'flows' }, checked: true } });
  const back = svg(v);
  v.$('facets').fire('change', { target: { dataset: {} } });
  v.$('facets').fire('change', { target: {} });
  // assert
  assert.match(cov, /class="sn circle L-structure cov-low" data-uid="n:P2"/);
  assert.equal(scope, 'step');
  assert.match(off, /^<svg class="rp off-flows"/);
  assert.match(back, /^<svg class="rp"/);
  assert.match(v.$('f-layers').innerHTML, /data-value="flows" checked>/);
});

test('every document-derived string is escaped', () => {
  // arrange
  const m = MODEL();
  m.nodes.find((n) => n.id === 'P2').plain = '<img src=x onerror=alert(1)>';
  m.findings[0].title = '"><script>x</script>';
  // act
  const v = mount(m);
  v.$('canvas').fire('click', on('[data-uid]', { uid: 'n:P2' }));
  const all = [svg(v), v.$('sel').innerHTML, v.$('account').innerHTML, v.$('m-path').innerHTML].join('');
  // assert
  assert.doesNotMatch(all, /<img|<script/);
  assert.match(all, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('checks and tests table: every patch, the step own rows marked, planned ones named by step, text escaped', () => {
  // arrange
  const m = MODEL();
  m.patches[0].note = '<img src=x id=PWN>';
  const v = mount(m);
  const none = MODEL();
  none.patches = [];
  // act
  const at0 = v.$('checks').innerHTML;
  v.$('pb').fire('click', on('[data-pb]', { pb: 'next' }));
  v.$('pb').fire('click', on('[data-pb]', { pb: 'next' }));
  const at2 = v.$('checks').innerHTML;
  const empty = mount(none).$('checks').innerHTML;
  // assert
  assert.match(at0, /^<h2>Checks and tests<\/h2><table class="ck"><thead><tr><th>Step<\/th><th>Check<\/th><th>Location<\/th><th>What it does<\/th><th>Test<\/th><th>Proof<\/th><th>State<\/th><\/tr><\/thead><tbody>/);
  assert.equal((at0.match(/<tr>/g) || []).length, 1 + 4);
  assert.match(at0, /<td>2<\/td><td><span class="cpill">K1<\/span> Field allow list<\/td><td class="m">Field parser · intake\/parse\/fields.js<\/td><td>&lt;img src=x id=PWN&gt;<\/td>/);
  assert.match(at0, /<td>fails without, passes with<\/td><td>planned, step 2<\/td><\/tr>/);
  assert.doesNotMatch(at0, /<img/);
  assert.match(at2, /<tr class="now"><td>2<\/td><td><span class="cpill">K1<\/span>/);
  assert.match(at2, /<td>fails without, passes with<\/td><td><span class="pill st-fixed">landed<\/span><\/td><\/tr>/);
  assert.equal(empty, '');
});
