// lib/dfd-story-core.mjs: what the story view draws, where, and what each stage lights and says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMapCore } from '../dfd-map-core.mjs';
import { createStoryCore, STORY_IMPACTS } from '../dfd-story-core.mjs';
import { STORY } from './fixtures/dfd-story-model.mjs';

const core = (model = STORY(), opts) => createStoryCore(model, createMapCore, opts);
const box = (v, id) => v.boxes.find((b) => b.id === id);
const line = (v, key) => v.lines.find((l) => `${l.from}>${l.to}` === key);

test('a small document is drawn whole: sources left, parts in their areas and lanes, outcomes right, worst first', () => {
  // arrange
  const c = core();
  // act
  const { layout } = c;
  const at = Object.fromEntries(layout.nodes.map((n) => [n.id, n]));
  // assert
  assert.deepEqual(STORY_IMPACTS, ['critical', 'high', 'medium', 'low']);
  assert.deepEqual(c.stats(), { drawn: 10, hidden: 0, lines: 11, weaknesses: 4, places: 5, stages: 7, changes: 3 });
  assert.deepEqual(layout.nodes.map((n) => [n.id, n.role]), [['in', 'source'], ['cfg', 'source'], ['a', 'part'], ['b', 'part'], ['c', 'part'], ['lone', 'part'], ['far', 'part'], ['boom', 'outcome'], ['leak', 'outcome'], ['ok', 'outcome']]);
  assert.deepEqual(layout.sections.map((s) => s.label), ['Ungrouped elements', 'Our code', 'Their code']);
  assert.deepEqual(layout.lanes.map((l) => l.label), ['lane one']);
  assert.ok(at.in.x < at.a.x && at.a.x < at.b.x && at.b.x < at.c.x && at.c.x < at.boom.x, 'left to right by distance from a source');
  assert.ok(at.boom.y < at.leak.y && at.leak.y < at.ok.y, 'the worst outcome is on top, the harmless one last');
  assert.equal(at.far.x, at.a.x, 'a part nothing reaches sits in the first column');
  assert.deepEqual(at.a.lines, ['Reader of things with a', 'very long name that…']);
  assert.deepEqual([at.boom.harm, at.ok.harm, at.c.unknown, at.a.unknown], [true, false, true, false]);
  assert.ok(layout.w > at.boom.x + at.boom.w && layout.h > at.c.y + at.c.h);
});

test('a single word longer than a box is cut, and a third line is never started', () => {
  // arrange
  const model = STORY();
  model.nodes[3].label = 'averyveryverylongsinglewordthatcannotwrap';
  // act
  const lines = core(model, { chars: 10 }).layout.nodes.map((n) => n.lines);
  // assert
  assert.deepEqual(lines[3], ['averyvery…']);
  assert.deepEqual(lines[2], ['Reader of', 'things…']);
});

test('the stages run: the picture, the lines, the findings all open, each change set, what is left', () => {
  // arrange
  const c = core();
  // act
  const views = c.stages.map((_, i) => c.view(i));
  // assert
  assert.deepEqual(c.stages.map((s) => [s.kind, s.label, s.step]), [['look', 'Platform layout', undefined], ['routes', 'Data flows', undefined], ['hazards', 'Findings, unmitigated', 0],
    ['change', 'Rulings without code change', 1], ['change', 'First fix', 2], ['change', 'second', 3], ['left', 'Residual findings', 3]]);
  assert.deepEqual(views.map((v) => [v.counts.open, v.counts.thin, v.counts.held, v.counts.fixed]), [[0, 0, 0, 0], [0, 0, 0, 0], [5, 0, 0, 0], [4, 0, 1, 0], [3, 0, 1, 1], [2, 1, 1, 1], [2, 1, 1, 1]]);
  assert.deepEqual(views.map((v) => v.marks), [false, false, true, true, true, true, true]);
  assert.deepEqual(views.map((v) => v.caption.title), ['Platform layout', 'Data flows', 'Findings, unmitigated', 'Change set 1/3: Rulings without code change', 'Change set 2/3: First fix', 'Change set 3/3: second', 'Residual findings']);
});

test('the first two stages show no finding: the picture says what is where, the lines stage marks the harms', () => {
  // arrange
  const c = core();
  // act
  const look = c.view(0);
  const routes = c.view(1);
  // assert
  assert.deepEqual(look.caption.lines, ['Left: inputs (A stranger, cfg).', 'Centre: 5 elements, in 3 groups: Ungrouped elements, Our code, Their code.', 'Right: impact sinks.']);
  assert.ok(look.boxes.every((b) => b.dots.length === 0));
  assert.deepEqual([box(look, 'boom').cls, box(look, 'c').cls], ['outcome', 'part unknown']);
  assert.deepEqual([line(look, 'a>ok').cls, line(look, 'lone>leak').cls, line(look, 'a>leak').cls], ['later', 'unknown', '']);
  assert.deepEqual(routes.caption.lines, ['Flows run left to right.', '2 impact sinks: Everything burns, leak.', 'Flow into impact sink: attack path.']);
  assert.deepEqual([box(routes, 'boom').cls, box(routes, 'ok').cls], ['outcome harm', 'outcome calm']);
  assert.deepEqual([line(routes, 'b>boom').cls, line(routes, 'lone>leak').cls], ['toharm', 'unknown toharm']);
  assert.equal(line(look, 'a>b').label, '');
});

test('the findings stage is the original position: every dot open, sized by the worst outcome it reaches', () => {
  // arrange
  const c = core();
  // act
  const v = c.view(2);
  // assert
  assert.deepEqual(v.caption.lines, ['5 findings on 4 elements. Dot: one finding; size: worst reachable impact.', '4 findings reach: Everything burns.', 'Baseline: nothing mitigated. Select dot or box for detail.']);
  assert.deepEqual(box(v, 'a').dots, [{ id: 'W1', weak: 'W1', state: 'open', size: 3, sure: true }, { id: 'W5', weak: 'W5', state: 'open', size: 3, sure: true }]);
  assert.deepEqual(box(v, 'lone').dots.map((d) => d.size), [1]);
  assert.deepEqual([box(v, 'a').cls, box(v, 'far').cls, box(v, 'in').cls], ['part hot', 'part dim', 'source']);
  assert.deepEqual([line(v, 'b>boom').cls, line(v, 'a>leak').cls, line(v, 'a>leak').label, line(v, 'in>a').cls, line(v, 'a>ok').cls], ['danger toharm', 'danger toharm', 'spill', 'dim', 'later dim']);
});

test('a change set lights what it touched, flips its dots, sets its guard, and says where the same weakness stays open', () => {
  // arrange
  const c = core();
  // act
  const loose = c.view(3);
  const first = c.view(4);
  const second = c.view(5);
  // assert
  assert.deepEqual(loose.caption.lines, ['1 mitigated at this step.', '4 of 5 open.']);
  assert.deepEqual(box(loose, 'a').dots.map((d) => [d.id, d.state, d.sure]), [['W1', 'open', true], ['W5', 'held', true]]);
  assert.deepEqual(first.caption.lines, ['1 mitigated at this step.', 'Same weakness open in: c.', '3 of 5 open.']);
  assert.deepEqual(first.caption.items, [{ id: 'W1', text: 'a reads too far', where: 'Reader of things with a very long name that wraps twice over and more, c', nodes: ['a', 'c'], open: true }]);
  assert.deepEqual([box(first, 'a').cls, box(first, 'c').cls, box(first, 'b').cls], ['part eased lit', 'part unknown hot lit', 'part hot dim']);
  assert.deepEqual([line(first, 'in>a').guard, line(first, 'in>a').fresh, line(first, 'a>leak').cls, line(first, 'a>ok').cls, line(first, 'c>boom').cls], [true, true, 'closed', 'safe', 'danger toharm']);
  assert.deepEqual(second.caption.lines, ['0 mitigated at this step.', '1 dismissed, unproven (red ring). Not closed.', '2 of 5 open, 1 dismissed unproven.']);
  assert.deepEqual([line(second, 'in>a').guard, line(second, 'in>a').fresh, box(second, 'b').dots[0].state], [true, false, 'thin']);
});

test('a fix that no test proves is counted as such, all or some', () => {
  // arrange
  const none = STORY();
  delete none.patches[0].evidence;
  const some = STORY();
  some.findings[1].status = 'mitigated';
  // act
  const allUnsure = core(none).view(4);
  const mixed = core(some).view(4);
  // assert
  assert.equal(allUnsure.caption.lines[1], 'None tested: hollow dots.');
  assert.equal(box(allUnsure, 'a').dots[0].sure, false);
  assert.equal(mixed.caption.lines[1], '1 untested: hollow dots.');
  assert.deepEqual([box(mixed, 'c').dots[0].sure, line(mixed, 'c>boom').cls], [false, 'closed']);
});

test('what is left lists the open weaknesses worst first, or says there are none', () => {
  // arrange
  const c = core();
  const clean = STORY();
  for (const f of clean.findings) f.status = 'mitigated';
  // act
  const left = c.view(6);
  const done = core(clean);
  // assert
  assert.deepEqual(left.caption.lines, ['2 of 5 open, 1 dismissed unproven.', '2 reach: Everything burns.', 'Location: Their code, Our code.']);
  assert.deepEqual(left.caption.items.map((i) => [i.id, i.text, i.where]), [['W1', 'a reads too far', 'Reader of things with a very long name that wraps twice over and more, c'], ['W2', 'b trusts a length', 'b'], ['W3', 'W3', 'lone']]);
  assert.deepEqual([box(left, 'a').cls, box(left, 'b').cls, line(left, 'b>boom').cls, line(left, 'a>b').cls], ['part eased dim', 'part hot', 'danger toharm', 'dim']);
  assert.deepEqual(done.view(done.stages.length - 1).caption, { title: 'Residual findings', lines: ['All 5 findings mitigated.'], items: [] });
});

test('a card answers for one weakness wherever it sits, and never hides what a fix leaves unsettled', () => {
  // arrange
  const c = core();
  // act
  const fixed = c.card('W1', 4);
  const before = c.card('W1', 2);
  const aside = c.card('W2', 5);
  const early = c.card('W2', 0);
  // assert
  assert.deepEqual(fixed.places.map((p) => [p.id, p.name.slice(0, 6), p.area, p.state, p.word, p.how]), [['W1', 'Reader', 'Our code', 'fixed', 'fixed', 'tested'], ['W1@c', 'c', 'Their code', 'open', 'open', '']]);
  assert.deepEqual(fixed.outcomes, [{ name: 'Everything burns', word: 'critical' }, { name: 'leak', word: 'low' }]);
  assert.deepEqual(fixed.done, [{ id: 'K1', text: 'Adds a check', caveat: 'One thing left', note: 'tech note', how: 'tested' }]);
  assert.deepEqual([before.done, before.places[0].state], [[], 'open']);
  assert.deepEqual([aside.places[0].word, aside.places[0].how, aside.places[0].ruling, aside.done[0].text, aside.done[0].how], ['dismissed, unproven', 'asserted, unverified', 'said to be fine', 'K2', 'asserted, unverified']);
  assert.equal(early.places[0].state, 'open');
  assert.equal(c.card('nope', 0), null);
});

test('how a state is known: the check on its own flow, then a patch on the weakness, then the finding', () => {
  // arrange
  const model = STORY();
  model.findings[1].status = 'mitigated';
  model.findings.push({ id: 'W1@lone', at: { node: 'lone' }, status: 'mitigated' }, { id: 'W6', at: { node: 'far' }, status: 'mitigated', evidence: { level: 'inspected' } }, { id: 'W7', at: { node: 'far' }, status: 'mitigated', evidence: { level: 'odd' } });
  model.patches.push({ id: 'K3', pr: 'p1', findings: ['W1'], closes: [], evidence: { level: 'inspected' } });
  const c = core(model);
  // act
  const w1 = c.card('W1', 4).places;
  const w6 = c.card('W6', 4);
  const w7 = c.card('W7', 4);
  // assert
  assert.deepEqual(w1.map((p) => [p.id, p.how]), [['W1', 'source inspection'], ['W1@c', 'static analysis, no runtime PoC'], ['W1@lone', 'source inspection']]);
  assert.deepEqual([w6.places[0].how, w6.outcomes, w7.places[0].how], ['source inspection', [], 'asserted, unverified']);
});

test('a box card says what the box is and talks to, and lists its weaknesses only once they are shown', () => {
  // arrange
  const c = core();
  // act
  const shown = c.boxCard('a', 4);
  const early = c.boxCard('a', 0);
  const plain = c.boxCard('lone', 2);
  // assert
  assert.deepEqual(shown, { kind: 'box', id: 'a', name: 'Reader of things with a very long name that wraps twice over and more', label: 'a()', area: 'Our code', role: 'part', from: 'A stranger, cfg, c', to: 'b, leak, ok', weak: ['W1', 'W5'] });
  assert.deepEqual(early.weak, []);
  assert.deepEqual([plain.label, plain.area, plain.weak], ['', '', ['W3']]);
  assert.equal(c.boxCard('nope', 0), null);
});

test('a large document draws the findings and what surrounds them, and says how much it left out', () => {
  // arrange
  const model = STORY();
  model.nodes.push({ id: 'sib', kind: 'process', label: 'sib', group: 'l1' }, { id: 'sib2', kind: 'process', label: 'sib2', group: 'l1' }, { id: 'other', kind: 'process', label: 'other', group: 'g2' });
  model.flows.push({ from: 'a', to: 'sib' }, { from: 'sib2', to: 'a' }, { from: 'far', to: 'a' }, { from: 'other', to: 'a' });
  // act
  const c = core(model, { all: 3, siblings: 1 });
  const ids = c.layout.nodes.map((n) => n.id);
  // assert
  assert.deepEqual(ids, ['in', 'a', 'b', 'c', 'lone', 'boom', 'leak', 'sib']);
  assert.deepEqual(c.stats().hidden, 5);
  assert.equal(c.view(0).caption.lines[3], '5 elements without findings omitted.');
  assert.equal(c.boxCard('far', 0), null);
  assert.equal(c.boxCard('a', 0).to, 'b, leak, sib');
});

test('one part left out is singular; a large document with no finding draws its busiest elements and stops at the lines', () => {
  // arrange
  const one = STORY();
  one.findings = one.findings.filter((f) => f.id === 'W3');
  const none = STORY();
  delete none.findings;
  delete none.prs;
  delete none.patches;
  delete none.groups;
  for (const n of none.nodes) delete n.group;
  // act
  const single = core(one, { all: 9, siblings: 9 });
  const bare = core(none, { all: 3 });
  // assert
  assert.deepEqual(single.layout.nodes.map((n) => n.id), ['in', 'lone', 'leak']);
  assert.equal(single.view(0).caption.lines[3], '7 elements without findings omitted.');
  assert.deepEqual(bare.stages.map((s) => s.kind), ['look', 'routes']);
  assert.deepEqual(bare.layout.sections.map((s) => s.label), ['Ungrouped elements']);
  assert.deepEqual(bare.view(1).counts, { total: 0, open: 0, thin: 0, held: 0, fixed: 0 });
});

test('counts read in the singular, and a document with no change set goes from the findings to what is left', () => {
  // arrange
  const model = STORY();
  model.findings = [{ id: 'W1', at: { node: 'a' }, title: 't', status: 'live' }];
  model.nodes = model.nodes.filter((n) => n.id !== 'leak' && n.id !== 'cfg');
  delete model.prs;
  delete model.patches;
  model.nodes.find((n) => n.id === 'boom').impact = 'medium';
  // act
  const c = core(model);
  const views = c.stages.map((_, i) => c.view(i));
  // assert
  assert.deepEqual(c.stages.map((s) => s.kind), ['look', 'routes', 'hazards', 'left']);
  assert.equal(views[1].caption.lines[1], '1 impact sink: Everything burns.');
  assert.deepEqual(views[2].caption.lines.slice(0, 1), ['1 finding on 1 element. Dot: one finding; size: worst reachable impact.']);
  assert.equal(views[2].caption.lines.length, 2, 'no big dot, so no line about one');
  assert.deepEqual(views[3].caption.lines, ['1 of 1 open.', 'Location: Our code.']);
  assert.equal(box(views[2], 'a').dots[0].size, 2);
});

test('a document with no harm recorded says so, and a finished one with one finding reads in the singular', () => {
  // arrange
  const model = STORY();
  for (const n of model.nodes) delete n.impact;
  model.findings = [{ id: 'W1', at: { node: 'lone' }, severity: 'high', status: 'mitigated' }];
  delete model.prs;
  delete model.patches;
  // act
  const c = core(model);
  // assert
  assert.equal(c.view(1).caption.lines[1], '0 impact sinks: none recorded.');
  assert.deepEqual(c.view(3).caption.lines, ['All 1 finding mitigated.']);
  assert.deepEqual(c.card('W1', 3).places.map((p) => [p.area, p.how]), [['', 'asserted, unverified']]);
  assert.equal(c.view(2).boxes.find((b) => b.id === 'lone').dots[0].size, 3);
});

test('without declared pull requests a change set is named by what its patches share', () => {
  // arrange
  const model = STORY();
  delete model.prs;
  for (const k of model.patches) { delete k.pr; k.evidence = { level: 'tested', refs: ['fix.patch'] }; }
  // act
  const c = core(model);
  // assert
  assert.deepEqual(c.stages.filter((s) => s.kind === 'change').map((s) => s.label), ['Rulings without code change', 'fix.patch']);
});
