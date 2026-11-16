// lib/dfd-replay-core.mjs: the replay view's rules, run on a synthetic document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReplayCore } from '../dfd-replay-core.mjs';
import { MODEL, UNDECLARED } from './fixtures/dfd-replay-model.mjs';

const stateOf = (c, id) => c.stateAt(c.__findings.find((f) => f.id === id), c.S.step);
const core = (m = MODEL(), o) => { const c = createReplayCore(m, o); c.__findings = m.findings; return c; };

test('steps are change sets: a leading "no change recorded", declared pull requests, then patches grouped by shared commits', () => {
  // arrange
  const c = core();
  // act
  const steps = c.steps();
  // assert
  assert.deepEqual(steps.map((s) => [s.step, s.id, s.open, s.dealt]), [[0, '', 7, 0], [1, 'no change recorded', 6, 1], [2, 'pr-1', 5, 2], [3, 'pr-2', 4, 3], [4, 'commits a1b2c3d4e5f6, b2c3d4e5f6a7', 2, 5]]);
  assert.equal(steps[0].title, 'original position, unfixed');
  assert.equal(steps[3].title, 'Parameterised ledger writes');
  assert.deepEqual(c.sets.map((s) => s.kind), ['rulings', 'pull request', 'pull request', 'change set']);
  assert.deepEqual(c.sets[3].patches.map((k) => k.id), ['K3', 'K4']);
});

test('step 0 is every issue open; each state appears once its change set lands', () => {
  // arrange
  const c = core();
  const ids = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'];
  // act
  const at = [0, 1, 2, 3, 4].map((k) => { c.setStep(k); return ids.map((id) => stateOf(c, id)); });
  // assert
  assert.deepEqual(at[0], ['open', 'open', 'open', 'open', 'open', 'open', 'open']);
  assert.deepEqual(at[1], ['open', 'open', 'open', 'thin', 'held', 'open', 'open']);
  assert.deepEqual(at[2], ['proven', 'open', 'open', 'thin', 'held', 'open', 'open']);
  assert.deepEqual(at[4], ['proven', 'fixed', 'fixed', 'thin', 'held', 'open', 'fixed']);
  assert.equal(c.setStep(99), 4);
  assert.equal(c.setStep(-3), 0);
  assert.equal(c.setStep('x'), 0);
});

test('without declared pull requests patches group by shared commits, then shared evidence refs, then the rest', () => {
  // arrange
  const m = UNDECLARED();
  // act
  const c = core(m);
  // assert
  assert.deepEqual(c.sets.map((s) => [s.id, s.patches.map((k) => k.id)]), [['no change recorded', []], ['commits 1111111aaaa, 2222222bbbb', ['A', 'B']], ['intake/reader.js:5 size, intake/reader.js:9', ['C', 'D']], ['patches without commit or file', ['E']]]);
});

test('a single-patch change set takes the patch name; a patch naming an unknown pull request is grouped with the rest', () => {
  // arrange
  const m = MODEL();
  m.patches.push({ id: 'K9', pr: 'pr-gone', plain: 'Orphan bound', closes: [], commits: ['ffffffffffff1'] });
  // act
  const c = core(m);
  // assert
  assert.deepEqual(c.sets.map((s) => s.title).slice(-2), ['commits a1b2c3d4e5f6, b2c3d4e5f6a7', 'Orphan bound']);
});

test('a document with no ruling and no patch has no steps', () => {
  // arrange
  const m = MODEL();
  delete m.prs; m.patches = []; m.findings = m.findings.map((f) => ({ ...f, status: 'live' }));
  // act
  const c = core(m);
  // assert
  assert.equal(c.sets.length, 0);
  assert.deepEqual(c.steps().map((s) => s.open), [7]);
  assert.equal(c.account().set, null);
});

test('file paths come from module ids, labels, notes, issue sources and steps, patch refs and pull request files; host files are dropped', () => {
  // arrange
  const m = MODEL();
  m.nodes.push({ id: 'node:module:tools/run.js', kind: 'process', label: 'run' }, { id: 'N9', kind: 'process', label: 'Helper (tools/help.py)' }, { id: 'N10', kind: 'store', subtype: 'file', label: 'usr/share/dict' }, { id: 'N11', kind: 'process', label: 'loose', note: 'see https://x.org/a/b.js and docs/a.md.' });
  // act
  const c = core(m);
  // assert
  assert.deepEqual([...c.files.keys()].sort(), ['docs/a.md', 'intake/parse/fields.js', 'intake/parse/test/fields.test.js', 'intake/parse/units.js', 'intake/reader.js', 'ledger/notify.js', 'ledger/write.js', 'tools/help.py', 'tools/run.js']);
  assert.equal(c.isPath('a/../b.js'), false);
  assert.equal(c.isPath('README'), false);
  assert.equal(c.isPath('setup.py'), true);
  assert.equal(c.fileOfRef('./lib/x.mjs:12 note'), 'lib/x.mjs');
  assert.equal(c.fileOfRef(''), null);
  assert.equal(c.fileOfNode({ id: 'Z', label: 'nothing here' }), null);
});

test('small documents draw everything with every group open; the layout places sources, lanes, guards, missing checks, chips', () => {
  // arrange
  const c = core();
  // act
  const L = c.layout();
  // assert
  assert.equal(c.S.scope, 'all');
  assert.deepEqual(L.lanes.map((l) => l.id), ['g_in', 'g_led', 'g_carrier']);
  assert.equal(L.lanes[2].trust, true);
  assert.deepEqual(L.units.filter((u) => u.type === 'source').map((u) => [u.uid, u.num]), [['n:S1', 1], ['n:S2', 2]]);
  assert.equal(L.units.filter((u) => u.type === 'outcome').length, 4);
  assert.deepEqual(L.chips.map((x) => x.uid).sort(), ['n:R1', 'n:X1', 'n:X2', 'n:X3', 'n:X3']);
  const guards = L.edges.flatMap((e) => e.guards.map((g) => `${g.patch || 'missing'}:${g.landed}`)).sort();
  assert.deepEqual(guards, ['K1:false', 'K2:false', 'K3:false', 'missing:false', 'missing:false', 'missing:false']);
  assert.ok(L.edges.some((e) => e.cls === 'live' && e.to === 'n:X1'));
  assert.ok(L.edges.find((e) => e.to === 'n:R1').cls === 'pending');
  assert.equal(L.boundaries.length, 1);
  assert.ok(L.trunk.y2 > L.trunk.y1);
  assert.match(L.edges.find((e) => e.from === 'n:S1').d, /^M\d+,[\d.]+ H176 V/);
});

test('landing a change set closes routes green, sets its guards and rejects, and empties the red path', () => {
  // arrange
  const c = core();
  // act
  c.setStep(2);
  const L = c.layout();
  const chips = c.outcomeChips();
  // assert
  assert.equal(L.edges.find((e) => e.to === 'n:X1').cls, 'fixed');
  assert.equal(L.edges.find((e) => e.to === 'n:R1').cls, 'fixed');
  assert.equal(L.edges.flatMap((e) => e.guards).find((g) => g.patch === 'K1').landed, true);
  assert.deepEqual(chips.filter((x) => x.uid === 'n:X1').map((x) => [x.state, x.word]), [['proven', 'closed by K1 · H1']]);
  assert.deepEqual(chips.filter((x) => x.uid === 'n:R1').map((x) => [x.state, x.word]), [['proven', 'typed rejection · K1']]);
  c.setStep(3);
  assert.deepEqual(c.outcomeChips().filter((x) => x.uid === 'n:X2').map((x) => x.state), ['fixed']);
  c.setStep(0);
  assert.deepEqual(c.outcomeChips().filter((x) => x.uid === 'n:R1').map((x) => x.word), ['typed rejection, not landed']);
  assert.match(c.outcomeChips().find((x) => x.uid === 'n:X1').word, /^open · H1/);
});

test('an open outcome lists at most three issues and the rest as a count; an untouched one says no open path', () => {
  // arrange
  const m = MODEL();
  for (const id of ['Q1', 'Q2', 'Q3']) m.findings.push({ id, status: 'live', at: { node: 'P1' } });
  m.nodes.push({ id: 'P7', kind: 'process', label: 'intake/quiet.js', group: 'g_in' });
  m.flows.push({ from: 'S2', to: 'P7', mode: 'sync' }, { from: 'P7', to: 'X3', mode: 'sync' });
  const c = core(m);
  // act
  const words = c.outcomeChips().filter((x) => x.uid === 'n:X3').map((x) => x.word);
  // assert
  assert.ok(words.some((w) => /^open · H3, Q1, Q2 \+1$/.test(w)));
  assert.ok(words.includes('no open path'));
});

test('stations restate state, severity, coverage colour, touched, selection and search hit', () => {
  // arrange
  const c = core();
  c.setStep(2);
  // act
  const st = c.stations();
  c.setMode('colour', 'coverage');
  const cov = c.stations();
  c.setMode('colour', 'none');
  const none = c.stations();
  c.S.q = 'fields';
  const hit = c.stations();
  // assert
  const p2 = st.find((s) => s.uid === 'n:P2');
  assert.deepEqual([p2.state, p2.sev, p2.touched, p2.shape, p2.loc, p2.name], ['proven', '', true, 'circle', 'intake/parse/fields.js:42', 'Field parser']);
  assert.equal(st.find((s) => s.uid === 'n:P3').state, 'open');
  assert.equal(st.find((s) => s.uid === 'n:P3').sev, 'medium');
  assert.equal(st.find((s) => s.uid === 'n:D1').shape, 'store');
  assert.equal(st.find((s) => s.uid === 'n:C1').shape, 'square');
  assert.deepEqual(['n:P1', 'n:P2', 'n:P3'].map((u) => cov.find((s) => s.uid === u).covCls), ['cov-ok', 'cov-low', 'cov-none']);
  assert.equal(none.find((s) => s.uid === 'n:P3').state, '');
  assert.equal(hit.find((s) => s.uid === 'n:P2').hit, true);
  assert.equal(c.setMode('nope', 1), false);
});

test('facets filter what is coloured and counted; layer, state, severity and evidence counts follow the step', () => {
  // arrange
  const c = core();
  c.setStep(4);
  // act
  const f = c.facets();
  c.setFacet('state', 'open', false);
  const p3 = c.stations().find((s) => s.uid === 'n:P3').state;
  c.setFacet('ev', 'tested', false);
  const guards = c.layout().edges.flatMap((e) => e.guards.map((g) => g.patch));
  // assert
  assert.deepEqual(f.state, { open: 1, thin: 1, fixed: 3, held: 1, proven: 1 });
  assert.deepEqual(f.sev, { critical: 1, high: 1, medium: 2, low: 2, undetermined: 1 });
  assert.deepEqual(f.ev, { tested: 1, inspected: 1, rescanned: 1, asserted: 1, none: 0 });
  assert.equal(f.layers.trigger, 2);
  assert.equal(p3, 'thin');
  assert.equal(guards.includes('K1'), false);
  assert.equal(c.setFacet('nope', 'x', true), false);
  assert.equal(c.setFacet('state', 'open', true), true);
});

test('a big document starts on issue paths with groups closed; steps open the groups they touch unless the reader turns that off', () => {
  // arrange
  const c = core(MODEL(), { small: 3 });
  // act
  const closed = c.layout().units.filter((u) => u.type === 'group').map((u) => u.uid).sort();
  c.setStep(2);
  const opened = [...c.S.auto].sort();
  const drawn = c.layout().units.map((u) => u.uid);
  c.S.follow = false;
  c.setStep(2);
  const off = c.layout().units.filter((u) => u.type === 'group').map((u) => u.uid).sort();
  // assert
  assert.equal(c.S.scope, 'paths');
  assert.deepEqual(closed, ['g:g_carrier', 'g:g_in', 'g:g_led']);
  assert.deepEqual(opened, ['g_in', 'g_parse']);
  assert.ok(drawn.includes('n:P2'));
  assert.deepEqual(off, ['g:g_carrier', 'g:g_in', 'g:g_led']);
});

test('the reader opens and closes groups; theirs stay open across steps, playback closes its own', () => {
  // arrange
  const c = core(MODEL(), { small: 3 });
  // act
  const a = c.toggleGroup('g_parse');
  c.setStep(3);
  const kept = c.isOpen('g_parse') && c.isOpen('g_in');
  const b = c.toggleGroup('g_led');
  // assert
  assert.equal(a, true);
  assert.equal(kept, true);
  assert.equal(b, false);
  assert.equal(c.isOpen('g_led'), false);
  assert.equal(c.toggleGroup('nope'), false);
});

test('scopes: step neighbourhood draws what the step touched and its neighbours; issue paths keep source-to-weakness paths; the rest folds into "more"', () => {
  // arrange
  const m = MODEL();
  m.nodes.push({ id: 'P6', kind: 'process', label: 'intake/extra.js', group: 'g_in' });
  const c = core(m, { small: 3 });
  for (const g of ['g_in', 'g_parse', 'g_led', 'g_carrier']) c.toggleGroup(g);
  // act
  const paths = c.layout().units.map((u) => u.uid);
  c.setMode('scope', 'step');
  const step0 = c.layout().units.map((u) => u.uid);
  c.setStep(3);
  const step3 = c.layout().units.map((u) => u.uid);
  c.setMode('scope', 'all');
  const all = c.layout().units.map((u) => u.uid);
  // assert
  assert.ok(paths.includes('m:g_in') && !paths.includes('n:P6'));
  assert.ok(step0.includes('n:P2') && step0.includes('n:P5'));
  assert.ok(step3.includes('n:P4') && step3.includes('n:D1'));
  assert.ok(all.includes('n:P6'));
});

test('a group wider than its cap draws a "more" box that the reader widens', () => {
  // arrange
  const c = core(MODEL(), { cap: 1 });
  // act
  const before = c.layout().units.filter((u) => u.type === 'more').map((u) => [u.uid, u.members.length]);
  c.more('g_parse');
  const after = c.layout().units.filter((u) => u.type === 'more').map((u) => [u.uid, u.members.length]);
  // assert
  assert.deepEqual(before, [['m:g_parse', 1], ['m:g_led', 2]]);
  assert.deepEqual(after, [['m:g_led', 2]]);
});

test('selection: an element, a unit, a file, an issue and a lane each emphasise their part and reveal the file', () => {
  // arrange
  const c = core(MODEL(), { small: 3 });
  // act
  c.select('node', 'P3');
  const node = { em: c.emphasis(), file: c.S.treeCur, open: c.isOpen('g_parse') };
  c.select('file', 'ledger/write.js');
  const file = c.emphasis();
  c.select('finding', 'H1');
  const finding = c.emphasis();
  c.select('unit', 'n:S1');
  const src = c.S.sel;
  c.select('unit', 'n:X1');
  const out = c.S.sel;
  c.select('lane', 'g_led');
  const lane = c.emphasis();
  c.select('unit', 'n:P1');
  const unit = c.S.sel;
  c.select(null);
  // assert
  assert.ok(node.em.units.has('n:P3'));
  assert.equal(node.em.file, 'intake/parse/units.js');
  assert.deepEqual([node.file, node.open], ['intake/parse/units.js', true]);
  assert.ok(file.units.has('n:P4'));
  assert.equal(file.file, 'ledger/write.js');
  assert.ok(finding.units.has('n:P2') && finding.edges.size > 0);
  assert.deepEqual([src, out, unit], [{ kind: 'node', id: 'S1' }, { kind: 'node', id: 'X1' }, { kind: 'node', id: 'P1' }]);
  assert.ok(lane.units.size >= 1);
  assert.equal(c.S.sel, null);
  assert.equal(c.emphasis().units.size, 0);
  assert.equal(c.revealNode('nope'), false);
});

test('selecting a closed group unit keeps it as a unit selection and the detail lists its elements', () => {
  // arrange
  const c = core(MODEL(), { small: 3 });
  // act
  c.select('unit', 'g:g_led');
  const d = c.detail();
  // assert
  assert.deepEqual([d.kind, d.type, d.name, d.count], ['unit', 'group', 'Ledger writer', 3]);
  assert.deepEqual(d.findings.map((f) => f.id).sort(), ['H2', 'H5', 'H6']);
});

test('the file tree rolls touched, open, fixed, coverage and element counts up to directories, and expands to what a step touched', () => {
  // arrange
  const c = core();
  // act
  const top = c.treeRows().map((r) => r.key);
  c.setStep(2);
  const rows = c.treeRows();
  // assert
  assert.deepEqual(top, ['d:intake', 'd:ledger']);
  const intake = rows.find((r) => r.key === 'd:intake');
  assert.deepEqual([intake.open, intake.roll.touched, intake.roll.open, intake.roll.fixed, intake.roll.files], [true, true, 3, 1, 4]);
  assert.equal(Math.round(intake.roll.cov * 100), 68);
  const fields = rows.find((r) => r.key === 'f:intake/parse/fields.js');
  assert.deepEqual([fields.roll.touched, fields.roll.fixed, fields.roll.cov, fields.roll.elements, fields.depth], [true, 1, 0.5, 1, 2]);
  assert.equal(rows.find((r) => r.key === 'f:intake/parse/test/fields.test.js').roll.cov, null);
});

test('the reader opens and shuts directories against the step; search filters the tree and opens what matches', () => {
  // arrange
  const c = core();
  c.setStep(2);
  // act
  const shut = c.toggleDir('intake');
  const after = c.treeRows().map((r) => r.key);
  const reopen = c.toggleDir('intake');
  c.S.treeFollow = false;
  c.setStep(2);
  const noFollow = c.treeRows().map((r) => r.key);
  c.S.q = 'CWE-89';
  const hits = c.treeRows().map((r) => r.key);
  // assert
  assert.equal(shut, false);
  assert.deepEqual(after, ['d:intake', 'd:ledger']);
  assert.equal(reopen, true);
  assert.ok(noFollow.includes('d:intake/parse'));
  assert.deepEqual(hits, ['d:ledger', 'f:ledger/write.js']);
});

test('the tree answers the keyboard: arrows move, right and left open and close, left climbs, Enter selects or toggles', () => {
  // arrange
  const c = core();
  // act
  const seq = [];
  for (const k of ['Home', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'End', 'ArrowUp', 'Enter', 'Tab', 'ArrowLeft']) seq.push([k, c.treeKey(k), c.S.treeCur]);
  c.S.treeCur = 'd:ledger';
  const toggled = c.treeKey('Enter');
  c.S.treeCur = 'd:intake';
  const closed = c.treeKey('ArrowLeft');
  c.S.q = 'zzzz';
  const none = c.treeKey('ArrowDown');
  // assert
  assert.deepEqual(seq.map((x) => x[1]), ['move', 'open', 'move', 'move', 'move', 'move', 'move', 'select', null, 'move']);
  assert.equal(seq[7][2], 'intake/reader.js');
  assert.deepEqual(c.S.sel, { kind: 'file', id: 'intake/reader.js' });
  assert.equal(toggled, 'open');
  assert.equal(closed, 'close');
  assert.equal(none, null);
});

test('the plain account: counts, what this change set dealt with, what it names and leaves open, what is still open', () => {
  // arrange
  const m = MODEL();
  m.findings.push({ id: 'H8', title: 'Same weakness elsewhere', status: 'live', severity: 'high', pr: 'pr-1', at: { node: 'P3' } });
  const c = core(m);
  // act
  c.setStep(2);
  const a = c.account();
  c.setStep(1);
  const b = c.account();
  // assert
  assert.deepEqual(a.counts, { found: 8, dealt: 2, open: 6, thin: 1, proven: 2 });
  assert.deepEqual(a.set, { id: 'pr-1', title: 'Bound field parser', state: 'merged', kind: 'pull request', files: 4, patches: ['K1'], elements: 5 });
  assert.deepEqual(a.dealt.map((h) => [h.id, h.state, h.basis, h.outcome, h.where]), [['H1', 'proven', 'test failing without fix', 'Command execution on host (critical)', 'intake/parse/fields.js:42']]);
  assert.deepEqual(a.dealt[0].change, [{ id: 'K1', title: 'Field allow list', note: 'Rejects any field outside the allow list.', step: 2, landed: true }]);
  assert.deepEqual(a.dealt[0].planned, []);
  assert.deepEqual(a.beyond.map((h) => h.id), ['H8']);
  assert.deepEqual(a.open.map((h) => h.id), ['H6', 'H8', 'H2', 'H3', 'H7', 'H4']);
  assert.deepEqual(b.dealt.map((h) => [h.id, h.basis, h.change[0].id]), [['H5', '2 tested controls', 'no change recorded']]);
  assert.equal(b.open.find((h) => h.id === 'H4').basis, 'dismissal, 1 tested axis');
});

test('step 0: a patch not yet landed is planned, with its step, never change', () => {
  // arrange
  const c = core(MODEL());
  // act
  c.setStep(0);
  const before = c.account().open.find((h) => h.id === 'H1');
  c.setStep(2);
  const after = c.account().dealt.find((h) => h.id === 'H1');
  c.setStep(1);
  const ruling = c.account().open.find((h) => h.id === 'H4');
  // assert
  assert.deepEqual(before.change, []);
  assert.deepEqual(before.planned, [{ id: 'K1', title: 'Field allow list', note: 'Rejects any field outside the allow list.', step: 2, landed: false }]);
  assert.deepEqual(after.change.map((k) => [k.id, k.step]), [['K1', 2]]);
  assert.deepEqual(after.planned, []);
  assert.deepEqual(ruling.planned, []);
});

test('basis words: open with and without a scanner, fixed by evidence level, proven by level alone, dismissal on no axis', () => {
  // arrange
  const m = MODEL();
  m.findings.push({ id: 'H9', status: 'dismissed', at: { node: 'P1' } });
  m.findings.push({ id: 'H10', status: 'mitigated', at: { node: 'P1' } });
  m.patches.push({ id: 'K5', pr: 'pr-2', findings: ['H11'], closes: [], evidence: { level: 'tested' } });
  m.findings.push({ id: 'H11', status: 'mitigated', at: { node: 'P1' } });
  const c = core(m);
  // act
  c.setStep(c.sets.length);
  const a = c.account();
  const all = [...a.open, ...c.account().dealt];
  c.setStep(0);
  const opened = c.account().open;
  // assert
  assert.equal(opened.find((h) => h.id === 'H1').basis, 'synthetic scanner report, no ruling');
  assert.equal(opened.find((h) => h.id === 'H2').basis, 'scanner report, no ruling');
  assert.equal(opened.find((h) => h.id === 'H3').basis, 'no ruling recorded');
  c.setStep(c.sets.length);
  const fin = c.findingList().map((f) => f.id);
  assert.ok(fin.includes('H11'));
  const d = (id) => { c.select('finding', id); return c.detail(); };
  assert.equal(d('H2').basis, 'source inspection');
  assert.equal(d('H3').basis, 'assertion, unverified');
  assert.equal(d('H7').basis, 'clean rescan');
  assert.equal(d('H10').basis, 'fix report, no rescan');
  assert.equal(d('H11').basis, 'test proof');
  assert.equal(d('H9').basis, 'dismissal, 0 tested axes');
  assert.ok(all.length > 0);
});

test('details: an element, a file, an issue, and nothing for unknown selections', () => {
  // arrange
  const c = core();
  c.setStep(2);
  // act
  c.select('node', 'P2'); const n = c.detail();
  c.select('file', 'intake/parse/fields.js'); const f = c.detail();
  c.select('finding', 'H1'); const h = c.detail();
  c.select('finding', 'H6'); const h6 = c.detail();
  c.S.sel = { kind: 'node', id: 'nope' }; const n0 = c.detail();
  c.S.sel = { kind: 'file', id: 'nope' }; const f0 = c.detail();
  c.S.sel = { kind: 'finding', id: 'nope' }; const h0 = c.detail();
  c.S.sel = { kind: 'unit', id: 'nope' }; const u0 = c.detail();
  c.select(null); const none = c.detail();
  // assert
  assert.deepEqual([n.kind, n.name, n.type, n.group, n.file, n.coverage], ['node', 'Field parser', 'process', ['Manifest intake', 'Manifest parser'], 'intake/parse/fields.js', 0.5]);
  assert.deepEqual(n.guards, [{ id: 'K1', name: 'Field allow list', landed: true, level: 'tested' }]);
  assert.deepEqual(n.into.map((x) => x.data), ['raw fields']);
  assert.deepEqual([f.kind, f.elements.map((x) => x.id), f.findings.map((x) => x.id), f.traced, f.sets], ['file', ['P2'], ['H1'], ['H1'], [{ step: 2, id: 'pr-1' }, { step: 3, id: 'pr-2' }]]);
  assert.deepEqual([h.kind, h.rule, h.step, h.state, h.impacts[0].label], ['finding', 'cmd-injection', 2, 'proven', 'Command execution on host']);
  assert.ok(h.path.includes('Field parser'));
  assert.deepEqual([h6.where, h6.step, h6.risk], ['Carrier rate API to Sender notifier', 0, 'Rate quote trusted unchecked']);
  assert.deepEqual([n0, f0, h0, u0, none], [null, null, null, null, null]);
});

test('search finds issues by id, rule and CWE, elements by name and files by path; short queries find nothing', () => {
  // arrange
  const c = core();
  // act
  const byCwe = c.search('cwe-78');
  const byName = c.search('ledger');
  const short = c.search('l');
  // assert
  assert.deepEqual(byCwe, [{ kind: 'finding', id: 'H1', label: 'H1 Command entry from manifest field', sub: 'CWE-78' }]);
  assert.deepEqual(byName.map((x) => x.kind + ':' + x.id), ['finding:H2', 'node:P4', 'node:P5', 'node:D1', 'node:X2', 'file:ledger/write.js', 'file:ledger/notify.js']);
  assert.deepEqual(short, []);
  assert.equal(c.search(null).length, 0);
  assert.equal(c.patchFinding('K2'), 'H2');
  assert.equal(c.patchFinding('nope'), null);
});

test('overview: one entry per lane with open and dealt counts and the step touch', () => {
  // arrange
  const c = core();
  c.setStep(2);
  // act
  const ov = c.overview();
  // assert
  assert.deepEqual(ov.map((l) => [l.id, l.open, l.dealt, l.touched, l.trust]), [['g_in', 3, 1, true, false], ['g_led', 2, 1, false, false], ['g_carrier', 1, 0, false, true]]);
});

test('stats count the document and every step', () => {
  // arrange
  const c = core();
  // act
  const s = c.stats();
  // assert
  assert.deepEqual([s.elements, s.drawable, s.flows, s.findings, s.patches, s.sets, s.files, s.steps.length], [15, 13, 17, 7, 4, 4, 6, 5]);
});

test('edge cases: no sources by kind falls back to any external feeding something; flows on unknown nodes are dropped; cycles still rank', () => {
  // arrange
  const m = {
    v: 1, title: 'loop', nodes: [{ id: 'A', kind: 'external', subtype: 'system', label: 'Feed' }, { id: 'B', kind: 'process', label: 'b.js' }, { id: 'C', kind: 'process', label: 'c.js' }, { id: 'D', kind: 'process', label: 'd.js' }],
    flows: [{ from: 'A', to: 'B', mode: 'sync' }, { from: 'B', to: 'C', mode: 'sync' }, { from: 'C', to: 'B', mode: 'sync' }, { from: 'C', to: 'Z', mode: 'sync' }, { from: 'D', to: 'D', mode: 'sync' }, { from: 'D', to: 'C', mode: 'sync' }],
    findings: [{ id: 'F', at: { flow: { from: 'B', to: 'C' } } }, { id: 'G', at: {} }],
  };
  // act
  const c = core(m);
  const L = c.layout();
  // assert
  assert.deepEqual(L.units.find((u) => u.uid === 'n:A').type, 'source');
  assert.equal(L.edges.length, 4);
  assert.ok(L.units.every((u) => u.type === 'source' || u.rank >= 1));
  assert.ok(L.edges.some((e) => /V[\d.]+ H[\d.]+ V/.test(e.d) || /H[\d.]+$/.test(e.d)));
  assert.equal(L.lanes[0].label, 'Ungrouped elements');
  assert.equal(L.trunk !== null, true);
  assert.equal(c.account().counts.found, 2);
});

test('a document with nothing to start from draws no trunk', () => {
  // arrange
  const m = { v: 1, nodes: [{ id: 'B', kind: 'process', label: 'b.js' }], flows: [] };
  // act
  const L = core(m).layout();
  // assert
  assert.equal(L.trunk, null);
  assert.equal(L.units.length, 1);
});

test('flow labels never sit on each other, on a station name or on a guard word; a crowded one hides', () => {
  // arrange
  const m = MODEL();
  const p1 = m.nodes.find((n) => n.id === 'P1');
  for (let i = 0; i < 12; i += 1) {
    m.nodes.push({ id: `Z${i}`, kind: 'process', label: `crowd station ${i}`, group: p1.group });
    m.flows.push({ from: 'P1', to: `Z${i}`, label: `offset + size ${i}` }, { from: `Z${i}`, to: 'P1', label: `zip → blob ${i}` });
  }
  const c = core(m);
  // act
  const L = c.layout();
  const shown = L.edges.filter((e) => !e.hide);
  const box = (e) => ({ x1: e.lx, x2: e.lx + Math.min(e.text.length, e.max) * 5.6, y1: e.ly - 9, y2: e.ly + 2 });
  const hit = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
  const names = L.units.map((u) => ({ x1: u.x - 18, x2: u.x + 18, y1: u.y + L.R + 6, y2: u.y + L.R + 17 }));
  const words = L.edges.flatMap((e) => e.guards).map((g) => ({ x1: g.x - 20, x2: g.x + 20, y1: g.ty - 9, y2: g.ty + 2 }));
  const lines = L.edges.flatMap((e) => [...e.d.matchAll(/([MHV])([-\d.]+)(?:,([-\d.]+))?/g)].reduce((acc, [, op, a, b]) => {
    if (op === 'M') return { ...acc, x: +a, y: +b };
    if (op === 'V') return { ...acc, y: +a };
    return { x: +a, y: acc.y, out: [...acc.out, { x1: Math.min(acc.x, +a), x2: Math.max(acc.x, +a), y1: acc.y - 1, y2: acc.y + 1 }] };
  }, { x: 0, y: 0, out: [] }).out);
  // assert
  for (let i = 0; i < shown.length; i += 1) {
    for (let j = i + 1; j < shown.length; j += 1) assert.ok(!hit(box(shown[i]), box(shown[j])), `${shown[i].key} on ${shown[j].key}`);
    for (const n of [...names, ...words, ...lines]) assert.ok(!hit(box(shown[i]), n), `${shown[i].key} on a fixed word or a line`);
  }
  assert.ok(L.edges.some((e) => e.hide), 'a crowd leaves at least one label to its title');
  assert.ok(L.edges.every((e) => e.full.length > 0));
});

test('a guard word moves above its diamond when a station name sits below it', () => {
  // arrange
  const c = core(MODEL());
  // act
  const L = c.layout();
  const gs = L.edges.flatMap((e) => e.guards);
  // assert
  assert.ok(gs.length > 0);
  for (const g of gs) assert.ok(g.ty === g.y + (g.missing ? 21 : 19) || g.ty === g.y - (g.missing ? 13 : 29));
});

test('checks and tests: one row per patch, with place, test, proof and whether it has landed by the step shown', () => {
  // arrange
  const m = MODEL();
  m.patches.push({ id: 'K5', title: 'Unit table check', findings: ['H4'], commits: ['c3d4e5f6a7b8c9d0'], evidence: { control: { test: 'units.test.js' } } });
  m.patches.push({ id: 'K6', title: 'Loose fix', findings: ['H6'], commits: ['d4e5f6a7b8c9d0e1'] });
  const c = core(m);
  // act
  c.setStep(0);
  const before = c.checks();
  c.setStep(2);
  const mid = c.checks();
  // assert
  const k1 = before.find((r) => r.id === 'K1');
  assert.deepEqual([k1.title, k1.step, k1.landed, k1.now, k1.where, k1.what, k1.test, k1.proof],
    ['Field allow list', 2, false, false, 'Field parser · intake/parse/fields.js', 'Rejects any field outside the allow list.', 'intake/parse/test/fields.test.js: rejects shell metacharacters', 'fails without, passes with']);
  assert.deepEqual(before.map((r) => r.landed), before.map(() => false));
  const byId = (rows, id) => rows.find((r) => r.id === id);
  assert.deepEqual([byId(mid, 'K1').landed, byId(mid, 'K1').now, byId(mid, 'K2').landed, byId(mid, 'K2').now], [true, true, false, false]);
  assert.equal(byId(mid, 'K2').where, 'Ledger row writer · ledger/write.js');
  assert.deepEqual([byId(mid, 'K2').test, byId(mid, 'K2').proof], ['none named', 'source inspection']);
  assert.deepEqual([byId(mid, 'K4').where, byId(mid, 'K4').proof], ['no place recorded', 'clean rescan']);
  assert.deepEqual([byId(mid, 'K5').test, byId(mid, 'K5').proof], ['units.test.js', 'test named, not shown failing']);
  assert.deepEqual([byId(mid, 'K6').proof, byId(mid, 'K6').level], ['fix report, no rescan', 'none']);
});
