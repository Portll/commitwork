// lib/dfd-record-client.js in a stand-in document that keeps what the script writes and fires what a reader would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecordCore } from '../dfd-record-core.mjs';
import { mountRecordView } from '../dfd-record-client.js';
import { RECORD, SINKS } from './fixtures/dfd-record-model.mjs';

const count = (text, part) => text.split(part).length - 1;
const hits = (text, re) => (text.match(re) || []).length;
function fakeDocument(model) {
  const make = (id) => {
    const on = {};
    return { id, innerHTML: '', textContent: '', hidden: false, value: '', checked: false, max: '', attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, fn) { (on[t] = on[t] || []).push(fn); }, fire(t, ev = {}) { for (const fn of on[t] || []) fn(ev); } };
  };
  const els = new Map();
  return { getElementById(id) { if (id === 'dfd-data') return { textContent: JSON.stringify(model) }; if (!els.has(id)) els.set(id, make(id)); return els.get(id); } };
}
/** An event whose target answers `closest` for one selector with an element carrying `dataset`. */
const on = (selector, dataset = {}, extra = {}) => ({ target: { dataset, closest: (s) => (s === selector ? { dataset } : null) }, ...extra });
const miss = { target: { closest: () => null } };
const mount = (model = RECORD()) => {
  const doc = fakeDocument(model);
  const timers = { fns: [], ms: [], cleared: 0, set(fn, ms) { this.fns.push(fn); this.ms.push(ms); return this.fns.length; }, clear() { this.cleared += 1; } };
  const view = mountRecordView(doc, createRecordCore, { timers });
  return { timers, V: view.V, $: (id) => doc.getElementById(id) };
};
const grid = (v) => v.$('grid').innerHTML;
const out = (v) => v.$('pb-out').textContent;
const press = (v, pb) => v.$('pb').fire('click', on('[data-pb]', { pb }));
const tab = (v, name) => v.$('tabs').fire('click', on('[data-tab]', { tab: name }));
const texts = (html, re) => [...html.matchAll(re)].map((m) => m[1]);

test('mounting draws every region at the last step: menus, playback, grid, rail, account, empty selection, tables, key', () => {
  // Arrange
  const model = RECORD();
  // Act
  const v = mount(model);
  // Assert
  assert.equal(v.$('m-lanes').innerHTML, '<option value="group" selected>Groups</option><option value="layer">Layers</option>');
  assert.equal(v.$('m-order').innerHTML, '<option value="sets" selected>Change sets</option><option value="upstream">Upstream first</option><option value="tested">Tested first</option><option value="document">Document order</option>');
  assert.match(v.$('m-dim').innerHTML, /^<option value="changeset" selected>Change set<\/option>(<option value="[a-z]+">[A-Za-z ]+<\/option>){5}$/);
  assert.deepEqual([v.$('pb-scrub').max, v.$('pb-scrub').value, v.$('pb-play').textContent, v.$('pb-play').attrs['aria-pressed'], out(v)], ['4', '4', 'Play', 'false', 'Step 4 of 4 · K4 landed · 1 open']);
  assert.match(grid(v), /^<svg class="rec" viewBox="0 0 \d+ \d+" width="\d+" height="\d+" role="group" aria-label="Record by group: 5 lanes, 7 hop columns, step 4 of 4, 1 finding open">/);
  assert.deepEqual([count(grid(v), '<rect class="band'), count(grid(v), '<g class="u '), count(grid(v), '<g class="row st-'), count(grid(v), '<g class="e k-'), count(grid(v), 'data-sel="flow"')], [5, 18, 7, 19, 18]);
  assert.deepEqual([hits(grid(v), /<g class="u [^"]*\boutcome\b/g), hits(grid(v), /<g class="e [^"]*\bclosed\b/g), hits(grid(v), /<g class="e [^"]*\bred\b/g)], [4, 5, 0]);
  assert.deepEqual(texts(grid(v), /<text class="chd" [^>]*>([^<]*)<\/text>/g), ['Sources', 'Hop 1', 'Hop 2', 'Hop 3', 'Hop 4', 'Hop 5', 'Not reached']);
  assert.deepEqual(texts(grid(v), /<text class="lh" [^>]*><title>([^<]*)<\/title>/g), ['Manifest intake', 'Ungrouped', 'Ledger writer', 'Carrier platform', 'Harness']);
  assert.match(grid(v), /<g class="u p-process" data-sel="node" data-id="P3" tabindex="0" role="button" aria-label="Unit converter, process, 2 findings">/);
  assert.match(grid(v), /<g class="u p-log" data-sel="node" data-id="G1" tabindex="0" role="button" aria-label="Write audit log, log store">/);
  assert.match(grid(v), /<g class="e k-drain"><title>Write audit log → log drain<\/title>/);
  assert.match(grid(v), /<g class="e k-error" data-sel="flow" data-id="f17"><title>Ledger row writer → Write audit log: failed row<\/title>/);
  assert.match(grid(v), /<g class="u rt rs-closed" data-sel="route" data-id="Q2" tabindex="0" role="button" aria-label="Route Q2, closed, no node">/);
  assert.match(grid(v), /<g class="row rt rs-open" data-sel="route" data-id="Q1" tabindex="0" role="button" aria-label="Route Q1, open">/);
  assert.match(grid(v), /<g class="row st-proven" data-sel="finding" data-id="H1" tabindex="0" role="button" aria-label="H1 Command entry from manifest field, fixed, tested">/);
  assert.match(grid(v), /<rect class="mk mp landed" [^>]*data-sel="patch" data-id="K1">/);
  assert.match(v.$('rail').innerHTML, /^<p class="rail-n"><span>Patches<\/span><span class="n">4 \/ 4<\/span><\/p><p class="rail-all"><button type="button" class="lk" data-all="1">All<\/button> <button type="button" class="lk" data-all="0">None<\/button><\/p><div class="rg"><label><input type="checkbox" data-group="0" checked> <span class="gv">Bound field parser<\/span><\/label><span class="n">1\/1<\/span><\/div>/);
  assert.match(v.$('rail').innerHTML, /<div class="rr landed"><input type="checkbox" data-patch="K1" aria-label="Include K1 in the replay" checked><button type="button" class="lk" data-sel="patch" data-id="K1">K1<\/button><span class="pt" title="Field allow list">Field allow list<\/span><button type="button" class="sn" data-step="1" aria-label="Replay to step 1, K1 landed">1<\/button><\/div>/);
  assert.match(v.$('rail').innerHTML, /<span class="gv">commits a1b2c3d4e5f6, b2c…<\/span><\/label><span class="n">2\/2<\/span>/);
  assert.equal(v.$('account').innerHTML, '<h2>Step 4 of 4</h2><p class="set">commits a1b2c3d4e5f6, b2c3d4e5f6a7</p><dl class="tally"><div><dt>Open</dt><dd class="bad">1</dd></div><div><dt>Fixed, untested</dt><dd>3</dd></div><div><dt>Fixed, tested</dt><dd class="ok">1</dd></div><div><dt>Dismissed</dt><dd>2</dd></div></dl><h3>Outcomes on an open path: 0</h3><p class="sub">0 flows on open paths · 5 flows closed</p>');
  assert.equal(v.$('sel').innerHTML, '<h3>Selection</h3><p class="sub">No selection. Pick a chip, a row, a marker or a flow.</p>');
  assert.match(v.$('tabs').innerHTML, /data-tab="flows" aria-selected="false">Flows <span class="n">18<\/span>.*data-tab="findings" aria-selected="true">Findings <span class="n">7<\/span>.*data-tab="patches" aria-selected="false">Patches <span class="n">4<\/span>.*data-tab="routes" aria-selected="false">Routes <span class="n">2<\/span>/);
  assert.match(v.$('table').innerHTML, /^<table class="tb"><thead><tr><th scope="col">Id<\/th><th scope="col">Title<\/th><th scope="col">Severity<\/th><th scope="col">CWE<\/th><th scope="col">Status<\/th><th scope="col">State<\/th><th scope="col">Where<\/th><\/tr><\/thead><tbody><tr class="st-proven" data-sel="finding" data-id="H1" tabindex="0"><td>H1<\/td><td>Command entry from manifest field<\/td><td>high<\/td><td>CWE-78<\/td><td>mitigated<\/td><td>fixed, tested<\/td><td>Field parser<\/td><\/tr>/);
  assert.equal(count(v.$('legend').innerHTML, '<li>'), 22);
  assert.match(v.$('legend').innerHTML, /Outcome: a node with a declared impact, or the target of a rejected flow\.<\/p>$/);
});

test('the first step shows every finding open, the outcomes they reach and the flows on open paths', () => {
  // Arrange
  const v = mount();
  // Act
  press(v, 'first');
  // Assert
  assert.equal(out(v), 'Step 0 of 4 · nothing landed · 5 open');
  assert.match(grid(v), /aria-label="Record by group: 5 lanes, 7 hop columns, step 0 of 4, 5 findings open">/);
  assert.deepEqual([hits(grid(v), /<g class="e [^"]*\bred\b/g), hits(grid(v), /<g class="e [^"]*\bclosed\b/g), hits(grid(v), /<g class="u [^"]*\bexposed\b/g), count(grid(v), 'class="mk mp landed"')], [9, 0, 4, 0]);
  assert.equal(count(v.$('rail').innerHTML, 'class="rr landed'), 0);
  assert.equal(v.$('account').innerHTML, '<h2>Step 0 of 4</h2><p class="set">Before any patch</p><dl class="tally"><div><dt>Open</dt><dd class="bad">5</dd></div><div><dt>Fixed, untested</dt><dd>0</dd></div><div><dt>Fixed, tested</dt><dd class="ok">0</dd></div><div><dt>Dismissed</dt><dd>2</dd></div></dl><h3>Outcomes on an open path: 4</h3><ul class="lks"><li><button type="button" class="lk" data-sel="node" data-id="X1">Command execution on host</button></li><li><button type="button" class="lk" data-sel="node" data-id="R1">Typed reject to sender</button></li><li><button type="button" class="lk" data-sel="node" data-id="X3">Intake crash (DoS)</button></li><li><button type="button" class="lk" data-sel="node" data-id="X2">Ledger tampering</button></li></ul><p class="sub">9 flows on open paths · 0 flows closed</p>');
});

test('playback: next, previous, last and the scrubber move one patch at a time and clamp; a click off a button does nothing', () => {
  // Arrange
  const v = mount();
  const seen = [];
  // Act
  press(v, 'next'); seen.push(out(v));
  press(v, 'first'); press(v, 'prev'); seen.push(out(v));
  press(v, 'next'); seen.push(out(v));
  press(v, 'last'); seen.push(out(v));
  v.$('pb-scrub').fire('input', { target: { value: '2' } }); seen.push(out(v));
  v.$('pb-scrub').fire('input', { target: { value: 'x' } }); seen.push(out(v));
  v.$('pb').fire('click', miss); seen.push(out(v));
  // Assert
  assert.deepEqual(seen, [
    'Step 4 of 4 · K4 landed · 1 open',
    'Step 0 of 4 · nothing landed · 5 open',
    'Step 1 of 4 · K1 landed · 4 open',
    'Step 4 of 4 · K4 landed · 1 open',
    'Step 2 of 4 · K2 landed · 3 open',
    'Step 0 of 4 · nothing landed · 5 open',
    'Step 0 of 4 · nothing landed · 5 open',
  ]);
  assert.equal(v.$('pb-scrub').value, '0');
  assert.match(v.$('account').innerHTML, /^<h2>Step 0 of 4<\/h2>/);
});

test('play restarts from the end, ticks every 1.2 s, pauses, stops by itself at the last step, and a manual step stops it', () => {
  // Arrange
  const v = mount();
  // Act
  press(v, 'play');
  const started = [out(v), v.$('pb-play').textContent, v.$('pb-play').attrs['aria-pressed'], [...v.timers.ms]];
  v.timers.fns.at(-1)();
  const ticked = [out(v), v.$('pb-play').textContent, v.timers.fns.length];
  press(v, 'play');
  const paused = [v.$('pb-play').textContent, v.$('pb-play').attrs['aria-pressed'], v.timers.cleared];
  press(v, 'play');
  for (let i = 0; i < 3; i += 1) v.timers.fns.at(-1)();
  const ended = [out(v), v.$('pb-play').textContent, v.timers.fns.length, v.V.playing];
  press(v, 'play'); press(v, 'next');
  // Assert
  assert.deepEqual(started, ['Step 0 of 4 · nothing landed · 5 open', 'Pause', 'true', [1200]]);
  assert.deepEqual(ticked, ['Step 1 of 4 · K1 landed · 4 open', 'Pause', 2]);
  assert.deepEqual(paused, ['Play', 'false', 1]);
  assert.deepEqual(ended, ['Step 4 of 4 · K4 landed · 1 open', 'Play', 5, null]);
  assert.deepEqual([v.timers.cleared, v.$('pb-play').textContent, out(v)], [2, 'Play', 'Step 1 of 4 · K1 landed · 4 open']);
});

test('the rail: a patch left out drops from the replay, a part-ticked group says mixed, a group ticks back, None, All and a step button', () => {
  // Arrange
  const v = mount();
  v.$('pb-scrub').fire('input', { target: { value: '2' } });
  // Act
  v.$('rail').fire('change', { target: { dataset: { patch: 'K2' }, checked: false } });
  const dropped = [out(v), v.$('rail').innerHTML];
  v.$('rail').fire('change', { target: { dataset: { patch: 'K4' }, checked: false } });
  const mixed = [out(v), v.$('rail').innerHTML];
  v.$('rail').fire('change', { target: { dataset: { group: '2' }, checked: true } });
  const regrouped = out(v);
  v.$('rail').fire('click', on('[data-all]', { all: '0' }));
  const none = [out(v), v.$('pb-scrub').max, v.$('rail').innerHTML];
  v.$('rail').fire('click', on('[data-all]', { all: '1' }));
  const all = out(v);
  v.$('rail').fire('click', on('[data-step]', { step: '1' }));
  v.$('rail').fire('change', { target: {} });
  v.$('rail').fire('change', { target: { dataset: { group: '9' }, checked: false } });
  v.$('rail').fire('click', miss);
  // Assert
  assert.equal(dropped[0], 'Step 2 of 3 · K3 landed · 3 open');
  assert.match(dropped[1], /<span class="n">3 \/ 4<\/span>/);
  assert.match(dropped[1], /<div class="rr"><input type="checkbox" data-patch="K2" aria-label="Include K2 in the replay"><button type="button" class="lk" data-sel="patch" data-id="K2">K2<\/button><span class="pt" title="Bound query parameters">Bound query param…<\/span><span class="sn off">–<\/span><\/div>/);
  assert.match(dropped[1], /<input type="checkbox" data-group="1"> <span class="gv">Parameterised ledger writ…<\/span><\/label><span class="n">0\/1<\/span>/);
  assert.equal(mixed[0], 'Step 2 of 2 · K3 landed · 3 open');
  assert.match(mixed[1], /<input type="checkbox" data-group="2" aria-checked="mixed"> <span class="gv">commits a1b2c3d4e5f6, b2c…<\/span><\/label><span class="n">1\/2<\/span>/);
  assert.equal(regrouped, 'Step 3 of 3 · K4 landed · 2 open');
  assert.deepEqual(none.slice(0, 2), ['Step 0 of 0 · nothing landed · 5 open', '0']);
  assert.match(none[2], /<span class="n">0 \/ 4<\/span>/);
  assert.equal(all, 'Step 4 of 4 · K4 landed · 1 open');
  assert.equal(out(v), 'Step 1 of 4 · K1 landed · 4 open');
});

test('lanes by layer, patches grouped by severity, and a new order that keeps the step, or the end when at the end', () => {
  // Arrange
  const v = mount();
  // Act
  v.$('m-lanes').fire('change', { target: { value: 'layer' } });
  const layered = grid(v);
  v.$('m-dim').fire('change', { target: { value: 'severity' } });
  const bySeverity = v.$('rail').innerHTML;
  press(v, 'first'); press(v, 'next');
  v.$('m-order').fire('change', { target: { value: 'upstream' } });
  const kept = out(v);
  press(v, 'last');
  v.$('m-order').fire('change', { target: { value: 'document' } });
  // Assert
  assert.match(layered, /aria-label="Record by layer: 5 lanes, 7 hop columns, step 4 of 4, 1 finding open">/);
  assert.deepEqual(texts(layered, /<text class="lh" [^>]*><title>([^<]*)<\/title>/g), ['edge', 'intake', 'ledger', 'No layer', 'Harness']);
  assert.deepEqual(texts(bySeverity, /<span class="gv">([^<]*)<\/span>/g), ['high', 'medium', 'low', 'undetermined']);
  assert.equal(kept, 'Step 1 of 4 · K3 landed · 4 open');
  assert.deepEqual(texts(v.$('rail').innerHTML, /data-patch="([^"]+)"/g), ['K1', 'K2', 'K3', 'K4']);
  assert.match(out(v), /^Step 4 of 4 · K\d landed · 1 open$/);
});

test('selecting a node emphasises it and its flows and fills the detail; a flow, a patch and a route select from any region', () => {
  // Arrange
  const v = mount();
  // Act
  v.$('grid').fire('click', on('[data-sel]', { sel: 'node', id: 'P2' }));
  const node = { grid: grid(v), sel: v.$('sel').innerHTML };
  v.$('sel').fire('click', on('[data-sel]', { sel: 'flow', id: 'f12' }));
  const flow = { grid: grid(v), sel: v.$('sel').innerHTML };
  v.$('rail').fire('click', on('[data-sel]', { sel: 'patch', id: 'K1' }));
  tab(v, 'patches');
  const patch = { rail: v.$('rail').innerHTML, sel: v.$('sel').innerHTML, table: v.$('table').innerHTML };
  v.$('table').fire('click', on('[data-sel]', { sel: 'route', id: 'Q2' }));
  const harness = { grid: grid(v), sel: v.$('sel').innerHTML };
  v.$('grid').fire('click', on('[data-sel]', { sel: 'route', id: 'Q1' }));
  const anchored = { grid: grid(v), sel: v.$('sel').innerHTML };
  v.$('table').fire('click', miss);
  const kept = v.$('sel').innerHTML;
  v.$('grid').fire('click', miss);
  // Assert
  assert.match(node.grid, /^<svg class="rec has-em" /);
  assert.match(node.grid, /<g class="u p-process em on" data-sel="node" data-id="P2"/);
  assert.match(node.grid, /<g class="e [^"]*\bem\b[^"]*" data-sel="flow" data-id="f12">/);
  assert.equal(node.sel, '<p class="kick">process</p><h3>Field parser</h3><dl class="kv"><div><dt>id</dt><dd>P2</dd></div><div><dt>groups</dt><dd>Manifest intake › Manifest parser</dd></div><div><dt>layer</dt><dd>intake</dd></div><div><dt>hop</dt><dd>2</dd></div></dl><h4>Findings <span class="n">1</span></h4><ul class="lks"><li><button type="button" class="lk" data-sel="finding" data-id="H1">H1 Command entry from manifest field</button></li></ul><h4>Flows in <span class="n">1</span></h4><ul class="lks"><li><button type="button" class="lk" data-sel="flow" data-id="f2">Manifest reader — raw fields</button></li></ul><h4>Flows out <span class="n">4</span></h4><ul class="lks"><li><button type="button" class="lk" data-sel="flow" data-id="f3">weight field — Unit converter</button></li><li><button type="button" class="lk" data-sel="flow" data-id="f4">parsed row — Ledger row writer</button></li><li><button type="button" class="lk" data-sel="flow" data-id="f12">field as shell argument — Command execution on host</button></li><li><button type="button" class="lk" data-sel="flow" data-id="f13">parse error — Typed reject to sender</button></li></ul>');
  assert.match(flow.grid, /<g class="e [^"]*\bem on" data-sel="flow" data-id="f12">/);
  assert.match(flow.sel, /^<p class="kick">flow · [a-z]+<\/p><h3>field as shell argument<\/h3><dl class="kv"><div><dt>from<\/dt><dd>Field parser<\/dd><\/div><div><dt>to<\/dt><dd>Command execution on host<\/dd><\/div>/);
  assert.match(flow.sel, /<dt>state<\/dt><dd>closed at this step<\/dd>/);
  assert.match(patch.sel, /^<p class="kick">patch · test proof<\/p><h3>Field allow list<\/h3><dl class="kv"><div><dt>id<\/dt><dd>K1<\/dd><\/div><div><dt>change set<\/dt><dd>Bound field parser<\/dd><\/div><div><dt>guard<\/dt><dd>Manifest reader → Field parser<\/dd><\/div><div><dt>proof<\/dt><dd>fails without, passes with<\/dd><\/div><div><dt>test<\/dt><dd>intake\/parse\/test\/fields\.test\.js: rejects shell metacharacters<\/dd><\/div><div><dt>landed<\/dt><dd>yes, at this step<\/dd><\/div>/);
  assert.match(patch.rail, /<div class="rr landed on"><input type="checkbox" data-patch="K1"/);
  assert.match(patch.table, /<tr class="landed on" data-sel="patch" data-id="K1" tabindex="0">/);
  assert.equal(harness.sel, '<p class="kick">route · closed</p><h3>Q2</h3><dl class="kv"><div><dt>claim</dt><dd>A recorded manifest replays clean</dd></div><div><dt>node</dt><dd>none (harness)</dd></div><div><dt>harness</dt><dd>replay-fixture.sh</dd></div></dl>');
  assert.match(harness.grid, /<g class="u rt rs-closed on" data-sel="route" data-id="Q2"/);
  assert.match(anchored.sel, /^<p class="kick">route · open<\/p><h3>Q1<\/h3>.*<dt>node<\/dt><dd>Unit converter<\/dd>.*<h4>Node <span class="n">1<\/span><\/h4><ul class="lks"><li><button type="button" class="lk" data-sel="node" data-id="P3">Unit converter<\/button><\/li><\/ul>$/);
  assert.match(anchored.grid, /<g class="u p-process em" data-sel="node" data-id="P3"/);
  assert.match(anchored.grid, /<g class="row rt rs-open on" data-sel="route" data-id="Q1"/);
  assert.equal(kept, anchored.sel);
  assert.match(v.$('sel').innerHTML, /No selection/);
  assert.match(grid(v), /^<svg class="rec" /);
});

test('Enter and Space select from a focused row or chip; other keys and keys off a target do nothing', () => {
  // Arrange
  const v = mount();
  let prevented = 0;
  // Act
  v.$('table').fire('keydown', on('[data-sel]', { sel: 'finding', id: 'H6' }, { key: 'Enter', preventDefault() { prevented += 1; } }));
  const finding = { sel: v.$('sel').innerHTML, table: v.$('table').innerHTML };
  v.$('grid').fire('keydown', on('[data-sel]', { sel: 'node', id: 'P3' }, { key: ' ' }));
  const node = v.$('sel').innerHTML;
  v.$('grid').fire('keydown', on('[data-sel]', { sel: 'node', id: 'P2' }, { key: 'a' }));
  v.$('account').fire('keydown', { key: 'Enter', target: { closest: () => null } });
  // Assert
  assert.match(finding.sel, /^<p class="kick">finding · critical<\/p><h3>H6 Rate quote trusted unchecked<\/h3>/);
  assert.match(finding.table, /<tr class="st-[a-z]+ on" data-sel="finding" data-id="H6"/);
  assert.match(node, /<h3>Unit converter<\/h3>.*<h4>Routes <span class="n">1<\/span><\/h4><ul class="lks"><li><button type="button" class="lk" data-sel="route" data-id="Q1">Q1<\/button><\/li><\/ul>$/);
  assert.equal(v.$('sel').innerHTML, node);
  assert.equal(prevented, 1);
});

test('the four tables list every row and select from any of them; a click off a tab does nothing; an empty list says so', () => {
  // Arrange
  const v = mount();
  const bare = RECORD();
  delete bare.routes;
  // Act
  tab(v, 'flows');
  const flows = { tabs: v.$('tabs').innerHTML, table: v.$('table').innerHTML };
  tab(v, 'routes');
  v.$('tabs').fire('click', miss);
  const routes = v.$('table').innerHTML;
  const w = mount(bare);
  tab(w, 'routes');
  // Assert
  assert.match(flows.tabs, /data-tab="flows" aria-selected="true">/);
  assert.match(flows.table, /^<table class="tb"><thead><tr><th scope="col">From<\/th><th scope="col">To<\/th><th scope="col">Label<\/th><th scope="col">Role<\/th><th scope="col">Existence<\/th><th scope="col">Findings<\/th><th scope="col">Guards<\/th><\/tr><\/thead><tbody><tr data-sel="flow" data-id="f0" tabindex="0"><td>Manifest upload from sender<\/td><td>Manifest reader<\/td><td>manifest bytes<\/td><td>data<\/td><td>confirmed<\/td><td><\/td><td>K3<\/td><\/tr>/);
  assert.equal(count(flows.table, '<tr'), 19);
  assert.doesNotMatch(flows.table, /class=""/);
  assert.equal(routes, '<table class="tb"><thead><tr><th scope="col">Id</th><th scope="col">Status</th><th scope="col">Claim</th><th scope="col">Node</th><th scope="col">Test</th></tr></thead><tbody><tr class="rs-open" data-sel="route" data-id="Q1" tabindex="0"><td>Q1</td><td>open</td><td>A unit suffix reaches the parser unchecked</td><td>Unit converter</td><td>intake/parse/test/units.test.js</td></tr><tr class="rs-closed" data-sel="route" data-id="Q2" tabindex="0"><td>Q2</td><td>closed</td><td>A recorded manifest replays clean</td><td>harness</td><td></td></tr></tbody></table>');
  assert.equal(w.$('table').innerHTML, '<p class="sub">No routes in this document.</p>');
  assert.match(w.$('tabs').innerHTML, /Routes <span class="n">0<\/span>/);
  assert.equal(count(grid(w), 'data-sel="route"'), 0);
});

test('an outcome named in the account selects; with no declared impact the key states the sink rule', () => {
  // Arrange
  const v = mount();
  const s = mount(SINKS());
  press(v, 'first');
  // Act
  v.$('account').fire('click', on('[data-sel]', { sel: 'node', id: 'X1' }));
  // Assert
  assert.match(v.$('sel').innerHTML, /<h3>Command execution on host<\/h3>.*<dt>place<\/dt><dd>outcome<\/dd>/);
  assert.match(grid(v), /<g class="u [^"]*\boutcome exposed em on" data-sel="node" data-id="X1"/);
  assert.match(s.$('legend').innerHTML, /Outcome: no node declares an impact, so every node that receives flows and sends none, other than a process, counts as an outcome\.<\/p>$/);
});

test('a route with no status reads as none, never as undefined', () => {
  // Arrange
  const model = RECORD();
  delete model.routes[1].status;
  const v = mount(model);
  // Act
  v.$('grid').fire('click', on('[data-sel]', { sel: 'route', id: 'Q2' }));
  tab(v, 'routes');
  // Assert
  const all = [grid(v), v.$('sel').innerHTML, v.$('table').innerHTML].join('');
  assert.doesNotMatch(all, /undefined/);
  assert.match(v.$('sel').innerHTML, /^<p class="kick">route · no status<\/p>/);
  assert.match(grid(v), /<g class="u rt rs-none on" data-sel="route" data-id="Q2" [^>]*aria-label="Route Q2, no status, no node">/);
  assert.match(v.$('table').innerHTML, /<tr class="rs-none on" data-sel="route" data-id="Q2"/);
});

test('document strings are escaped in the grid, the rail, the detail and the tables', () => {
  // Arrange
  const model = RECORD();
  Object.assign(model.nodes.find((n) => n.id === 'P3'), { label: '<img src=x>"&', plain: '<img src=x>"&' });
  model.patches[0].title = '<b>K</b>';
  model.findings[0].title = '</td><script>';
  // Act
  const v = mount(model);
  v.$('grid').fire('click', on('[data-sel]', { sel: 'node', id: 'P3' }));
  // Assert
  const all = ['grid', 'rail', 'sel', 'table', 'account'].map((id) => v.$(id).innerHTML).join('');
  assert.doesNotMatch(all, /<(img|b|script)\b/i);
  assert.match(v.$('sel').innerHTML, /<h3>&lt;img src=x&gt;&quot;&amp;<\/h3>/);
  assert.match(v.$('rail').innerHTML, /title="&lt;b&gt;K&lt;\/b&gt;"/);
  assert.match(v.$('table').innerHTML, /<td>&lt;\/td&gt;&lt;script&gt;<\/td>/);
});
