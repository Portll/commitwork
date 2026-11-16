// lib/dfd-story-client.js: the drawing and wiring of the story view, run against a stand-in
// document that keeps what the script writes and lets a test fire the events a reader would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMapCore } from '../dfd-map-core.mjs';
import { createStoryCore } from '../dfd-story-core.mjs';
import { mountStoryView } from '../dfd-story-client.js';
import { STORY } from './fixtures/dfd-story-model.mjs';

const count = (text, part) => text.split(part).length - 1;
function fakeDocument(model) {
  const els = new Map();
  const make = (id) => { const on = {}; return { id, innerHTML: '', textContent: '', disabled: false, addEventListener(t, fn) { (on[t] = on[t] || []).push(fn); }, fire(t, ev = {}) { for (const fn of on[t] || []) fn(ev); } }; };
  return { getElementById(id) { if (id === 'dfd-data') return { textContent: JSON.stringify(model) }; if (!els.has(id)) els.set(id, make(id)); return els.get(id); } };
}
/** An event whose target answers `closest` for one selector with an element carrying `dataset`. */
const on = (selector, dataset = {}, extra = {}) => ({ ...extra, target: { closest: (s) => (s === selector ? { dataset } : null) } });
const miss = { target: { closest: () => null } };
const mount = (model = STORY()) => {
  const doc = fakeDocument(model);
  const timers = { fns: [], ms: [], cleared: 0, set(fn, ms) { this.fns.push(fn); this.ms.push(ms); return this.fns.length; }, clear() { this.cleared += 1; } };
  const view = mountStoryView(doc, createStoryCore, createMapCore, { timers });
  return { ...view, doc, timers, $: (id) => doc.getElementById(id) };
};

test('mounting draws the first stage: the whole picture, no dots, the words, the steps and an empty card', () => {
  // arrange
  const model = STORY();
  // act
  const v = mount(model);
  const svg = v.$('pic').innerHTML;
  // assert
  assert.match(svg, /^<svg class="dfd story fit st-look" viewBox="0 0 1200 \d+" role="img" aria-label="Platform layout"><defs><marker id="st-a"/);
  assert.deepEqual([count(svg, '<g class="bx '), count(svg, '<g class="ln'), count(svg, '<g class="sec">'), count(svg, '<g class="lane">'), count(svg, '<circle')], [10, 11, 3, 1, 0]);
  assert.match(svg, /<g class="bx part" data-box="a" tabindex="0" role="button"><title>Reader of things with a very long name that wraps twice over and more<\/title><rect x="\d+" y="\d+" width="176" height="46" rx="6"\/><text><tspan x="\d+" y="\d+">Reader of things with a<\/tspan><tspan x="\d+" y="\d+">very long name that…<\/tspan><\/text><\/g>/);
  assert.match(svg, /<g class="bx source" data-box="in" [^>]*><title>A stranger<\/title><rect [^>]* rx="22"\/><text><tspan [^>]*>A stranger<\/tspan><\/text><\/g>/);
  assert.match(svg, /<g class="ln later"><path d="M[^"]+" marker-end="url\(#st-a\)"\/><\/g>/);
  assert.match(svg, /<g class="sec"><rect [^>]*\/><text [^>]*>Our code<\/text><\/g>/);
  assert.equal(v.$('cap').innerHTML, '<h2>Platform layout</h2><p>Left: inputs (A stranger, cfg).</p><p>Centre: 5 elements, in 3 groups: Ungrouped elements, Our code, Their code.</p><p>Right: impact sinks.</p>');
  assert.equal(v.$('card').innerHTML, '<p class="mut">Select box, dot or finding.</p>');
  assert.equal(count(v.$('chips').innerHTML, '<li><button type="button" data-stage="'), 7);
  assert.match(v.$('chips').innerHTML, /^<li><button type="button" data-stage="0" aria-current="step">1\. Platform layout<\/button><\/li><li><button type="button" data-stage="1">2\. Data flows/);
  assert.equal(count(v.$('key').innerHTML, '<li>'), 3);
  assert.deepEqual([v.$('st-prev').disabled, v.$('st-next').disabled, v.$('st-play').textContent], [true, false, '▶ play']);
});

test('stepping keeps the picture where it is and adds the dots, the tally, the guard and the sentences to select', () => {
  // arrange
  const v = mount();
  const boxAt = (html) => html.match(/data-box="a"[^>]*><title>[^<]*<\/title><rect x="(\d+)" y="(\d+)"/).slice(1);
  const before = boxAt(v.$('pic').innerHTML);
  // act
  v.$('st-next').fire('click');
  v.$('st-next').fire('click');
  const hazards = { svg: v.$('pic').innerHTML, cap: v.$('cap').innerHTML, key: v.$('key').innerHTML };
  v.$('chips').fire('click', on('[data-stage]', { stage: '4' }));
  const change = { svg: v.$('pic').innerHTML, cap: v.$('cap').innerHTML, key: v.$('key').innerHTML };
  v.$('chips').fire('click', miss);
  v.$('chips').fire('click', on('[data-stage]', { stage: '5' }));
  const aside = { cap: v.$('cap').innerHTML, key: v.$('key').innerHTML };
  // assert
  assert.deepEqual([boxAt(hazards.svg), boxAt(change.svg)], [before, before]);
  assert.match(hazards.svg, /<svg class="dfd story fit st-hazards"/);
  assert.equal(count(hazards.svg, '<circle class="dot open"'), 5);
  assert.match(hazards.svg, /<circle class="dot open" data-weak="W1" cx="\d+" cy="\d+" r="9"><title>W1<\/title><\/circle><circle class="dot open" data-weak="W5"/);
  assert.match(hazards.svg, /<g class="ln danger toharm"><title>spill<\/title><path /);
  assert.match(hazards.cap, /<p class="tally"><b>5<\/b> findings · <b class="g">0<\/b> mitigated · <b class="r">5<\/b> open<\/p>/);
  assert.match(change.svg, /<circle class="dot fixed" data-weak="W1"/);
  assert.match(change.svg, /<g class="ln"><path d="[^"]+" marker-end="url\(#st-a\)"\/><rect class="gd fresh" x="\d+" y="[\d.]+" width="5" height="18" rx="2"\/><\/g>/);
  assert.equal(count(change.svg, '<rect class="gd fresh"'), 1);
  assert.match(change.cap, /<h2>Change set 2\/3: First fix<\/h2><p class="tally"><b>5<\/b> findings · <b class="g">2<\/b> mitigated · <b class="r">3<\/b> open<\/p>/);
  assert.match(change.cap, /<ul class="items"><li><button type="button" class="it open" data-weak="W1">a reads too far <span class="mut">· Reader of things with a very long name that wraps twice over and more, c<\/span><\/button><\/li><\/ul>$/);
  assert.equal(count(change.key, 'k-dot thin'), 0);
  assert.match(aside.cap, / · <b class="a">1<\/b> dismissed · <b class="r">2<\/b> open/);
  assert.equal(count(aside.key, 'k-dot thin'), 1);
  assert.equal(v.S.stage, 5);
});

test('a fix nobody tested is drawn hollow', () => {
  // arrange
  const model = STORY();
  delete model.patches[0].evidence;
  const v = mount(model);
  // act
  v.go(4);
  // assert
  assert.match(v.$('pic').innerHTML, /<circle class="dot fixed hollow" data-weak="W1"/);
});

test('selecting a dot or a sentence opens the weakness and marks every box it sits on; a miss clears it', () => {
  // arrange
  const v = mount();
  v.go(4);
  // act
  v.$('pic').fire('click', on('[data-weak]', { weak: 'W1' }));
  const card = v.$('card').innerHTML;
  const svg = v.$('pic').innerHTML;
  v.$('pic').fire('click', miss);
  const cleared = v.$('card').innerHTML;
  v.$('cap').fire('click', miss);
  v.$('cap').fire('click', on('[data-weak]', { weak: 'W2' }));
  // assert
  assert.match(card, /^<h3>a reads too far<\/h3><p class="k">Location<\/p><ul><li><span class="st fixed">fixed<\/span> Reader of things[^<]* <span class="mut">· tested<\/span><br><span class="mut">Our code<\/span><\/li><li><span class="st open">open<\/span> c<br><span class="mut">Their code<\/span><\/li><\/ul>/);
  assert.match(card, /<p class="k">Worst impact<\/p><ul><li>Everything burns <span class="mut">\(critical\)<\/span><\/li><li>leak <span class="mut">\(low\)<\/span><\/li><\/ul>/);
  assert.match(card, /<p class="k">Mitigation to date<\/p><ul><li>Adds a check <span class="mut">· tested<\/span><p class="cav"><b>Residual:<\/b> One thing left<\/p><details><summary>Patch note<\/summary><p>tech note<\/p><\/details><\/li><\/ul><p class="ids">Reference: W1, W1@c<\/p>$/);
  assert.equal(count(svg, ' sel" data-box='), 2);
  assert.match(cleared, /Select box/);
  assert.deepEqual(v.S.pick, { kind: 'weak', id: 'W2' });
  assert.match(v.$('card').innerHTML, /<p class="k">Mitigation to date<\/p><p class="mut">None\.<\/p>/);
});

test('a ruling given without a fix is shown with its reason; a weakness that reaches no harm lists none', () => {
  // arrange
  const model = STORY();
  model.findings.push({ id: 'W9', at: { node: 'far' }, title: 'far', status: 'live' });
  const v = mount(model);
  v.go(5);
  // act
  v.$('card').fire('click', on('[data-weak]', { weak: 'W2' }));
  const ruled = v.$('card').innerHTML;
  v.$('card').fire('click', on('[data-weak]', { weak: 'W9' }));
  const harmless = v.$('card').innerHTML;
  v.$('card').fire('click', miss);
  // assert
  assert.match(ruled, /<span class="st thin">dismissed, unproven<\/span> b <span class="mut">· asserted, unverified<\/span><br><span class="mut">Our code<\/span><p class="why">said to be fine<\/p><\/li>/);
  assert.match(ruled, /<li>K2 <span class="mut">· asserted, unverified<\/span><\/li>/);
  assert.ok(!harmless.includes('Worst impact'));
  assert.deepEqual(v.S.pick, { kind: 'weak', id: 'W9' });
});

test('selecting a box says what it is; its weaknesses are listed only once the stage shows them; keys work as clicks', () => {
  // arrange
  const v = mount();
  // act
  v.$('pic').fire('keydown', on('[data-box]', { box: 'a' }, { key: 'Enter' }));
  const early = v.$('card').innerHTML;
  v.go(4);
  const later = v.$('card').innerHTML;
  v.$('pic').fire('keydown', on('[data-box]', { box: 'in' }, { key: 'x' }));
  const ignored = v.S.pick.id;
  v.$('pic').fire('keydown', on('[data-box]', { box: 'in' }, { key: ' ' }));
  const source = v.$('card').innerHTML;
  v.$('pic').fire('click', on('[data-box]', { box: 'nope' }));
  // assert
  assert.equal(early, '<h3>Reader of things with a very long name that wraps twice over and more</h3><p class="mut">Our code</p><p><span class="k">Inbound</span> A stranger, cfg, c</p><p><span class="k">Outbound</span> b, leak, ok</p><p class="ids">Source label: a()</p>');
  assert.match(later, /<p class="k">Findings<\/p><ul class="items"><li><button type="button" class="it open" data-weak="W1">a reads too far<\/button><\/li><li><button type="button" class="it done" data-weak="W5">a held twice<\/button><\/li><\/ul>/);
  assert.equal(ignored, 'a');
  assert.equal(source, '<h3>A stranger</h3><p><span class="k">Outbound</span> Reader of things with a very long name that wraps twice over and more, lone</p><p class="ids">Source label: in</p>');
  assert.match(v.$('card').innerHTML, /Select box/);
  assert.match(v.$('pic').innerHTML, /<g class="bx source" data-box="in"/);
});

test('play walks the stages on a timer and stops at the last; pause, a step or a chip stops it; play at the end starts over', () => {
  // arrange
  const v = mount();
  // act
  v.$('st-play').fire('click');
  const started = { text: v.$('st-play').textContent, ms: [...v.timers.ms] };
  v.timers.fns[0]();
  const afterTick = { stage: v.S.stage, timers: v.timers.fns.length };
  v.$('st-play').fire('click');
  const paused = { text: v.$('st-play').textContent, cleared: v.timers.cleared, timer: v.S.timer };
  v.$('st-prev').fire('click');
  const back = v.S.stage;
  v.go(5);
  v.$('st-play').fire('click');
  v.timers.fns[v.timers.fns.length - 1]();
  const atEnd = { stage: v.S.stage, timer: v.S.timer, next: v.$('st-next').disabled, set: v.timers.fns.length };
  v.timers.fns[v.timers.fns.length - 1]();
  const stale = v.S.stage;
  v.$('st-play').fire('click');
  const again = { stage: v.S.stage, playing: v.S.timer !== null };
  v.$('st-next').fire('click');
  v.go(99);
  // assert
  assert.deepEqual(started, { text: '❚❚ pause', ms: [4000] });
  assert.deepEqual(afterTick, { stage: 1, timers: 2 });
  assert.deepEqual(paused, { text: '▶ play', cleared: 1, timer: null });
  assert.equal(back, 0);
  assert.deepEqual(atEnd, { stage: 6, timer: null, next: true, set: 3 });
  assert.equal(stale, 6);
  assert.deepEqual(again, { stage: 0, playing: true });
  assert.deepEqual([v.S.stage, v.S.timer, v.timers.cleared], [6, null, 2]);
});

test('with no timers given the page uses the clock', (t) => {
  // arrange
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = fakeDocument(STORY());
  const v = mountStoryView(doc, createStoryCore, createMapCore);
  // act
  doc.getElementById('st-play').fire('click');
  t.mock.timers.tick(4000);
  const stage = v.S.stage;
  doc.getElementById('st-play').fire('click');
  // assert
  assert.equal(stage, 1);
  assert.equal(v.S.timer, null);
});
