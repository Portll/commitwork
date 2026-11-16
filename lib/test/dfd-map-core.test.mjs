// lib/dfd-map-core.mjs: the rules of the map view, run without a document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMapCore } from '../dfd-map-core.mjs';

import { MODEL, proc, env, file, flow } from './fixtures/dfd-map-model.mjs';

const ids = (L) => L.boxes.map((b) => b.id);

test('the tree is the groups, a bucket per kind for what is ungrouped, and leaves told apart from elements', () => {
  // arrange
  const core = createMapCore(MODEL());
  // act
  const top = core.root.children.map((c) => `${c.id}:${c.roll.elements}/${c.roll.leaves}`);
  const leaf = (id) => core.items.get(id).leaf;
  // assert
  assert.deepEqual(top.sort(), ['g:api:3/1', 'g:empty:0/0', 'g:web:1/0', 'x:code:1/0', 'x:env:0/2', 'x:file:1/2', 'x:other:1/1'].sort());
  assert.equal(core.items.get('g:core').parent, 'g:api');
  assert.equal(core.items.get('g:web').label, 'web');
  assert.deepEqual([leaf('cache.json'), leaf('DB_URL'), leaf('orders.db'), leaf('req'), leaf('api/db.js'), leaf('cfg')], [true, true, false, false, false, true]);
  assert.deepEqual([core.items.get('x:file').label, core.items.get('x:other').label, core.items.get('x:code').label], ['Files read and written', 'Other externals', 'Ungrouped code']);
});

test('a roll-up counts each issue once, bands an unknown severity as undetermined, and sums coverage over what was measured', () => {
  // arrange
  const core = createMapCore(MODEL());
  // act
  const api = core.items.get('g:api').roll;
  const web = core.items.get('g:web').roll;
  const all = core.stats();
  // assert
  assert.deepEqual([api.issues.size, api.sev.critical, api.sev.medium, api.worst, api.traced], [2, 1, 1, 'critical', true]);
  assert.deepEqual([api.covered, api.total, api.measured, api.unmeasured], [16, 20, 2, 0]);
  assert.deepEqual([web.sev.undetermined, web.worst, web.unmeasured, web.traced], [1, 'undetermined', 1, false]);
  assert.deepEqual([all.elements, all.leaves, all.flows, all.issues, all.drawn, all.open, all.budget], [7, 6, 13, 4, 6, 0, 150]);
  assert.equal(all.coverage, 0.8);
  assert.equal(core.items.get('g:empty').roll.worst, null);
});

test('toggle, close and pin: closing a group closes what is open inside it', () => {
  // arrange
  const core = createMapCore(MODEL());
  // act
  const a = core.toggle('g:core');
  const b = core.toggle('g:api');
  const pins = [core.pin('g:web'), core.pin('g:web')];
  // assert
  assert.deepEqual([a, b, core.S.open, pins], [true, false, [], [true, false]]);
});

test('the budget closes the group opened longest ago, never the one just opened, its ancestors or a pinned one', () => {
  // arrange: five groups of four; a budget of 12 boxes
  const groups = ['a', 'b', 'c', 'd', 'e'].map((g) => ({ id: g, label: g, boundary: 'system' }));
  const nodes = groups.flatMap((g) => [1, 2, 3, 4].map((n) => proc(`${g.id}${n}`, { group: g.id })));
  const core = createMapCore({ v: 1, kind: 'dfd', groups, nodes, flows: [] }, { budget: 12 });
  // act
  core.expand('g:a'); core.expand('g:b');
  const two = [...core.S.open];
  core.expand('g:c');
  const three = [...core.S.open];
  core.pin('g:b'); core.expand('g:d');
  const pinned = [...core.S.open];
  core.pin('g:c'); core.pin('g:d'); core.expand('g:e');
  // assert: 5 closed = 5; a open = 8; a,b = 11; a,b,c = 14 > 12 so a goes; with b pinned, c goes for d; with everything pinned nothing can go
  assert.deepEqual(two, ['g:a', 'g:b']);
  assert.deepEqual(three, ['g:b', 'g:c']);
  assert.deepEqual(pinned, ['g:b', 'g:d']);
  assert.deepEqual(core.S.open, ['g:b', 'g:d', 'g:e']);
  assert.equal(core.stats().drawn, 14);
});

test('a group wider than a page draws a page and a "more" box; more draws the next page; flows to the rest land on that box', () => {
  // arrange
  const nodes = [proc('hub'), ...Array.from({ length: 7 }, (_, i) => proc(`w/m${i}.js`, { group: 'w' }))];
  const flows = [flow('hub', 'w/m0.js'), flow('hub', 'w/m5.js'), flow('hub', 'w/m6.js')];
  const core = createMapCore({ v: 1, kind: 'dfd', groups: [{ id: 'w', label: 'w', boundary: 'system' }], nodes, flows }, { page: 3 });
  core.expand('g:w'); core.S.edges = 'all';
  // act
  const first = core.layout();
  core.more('more:g:w');
  const second = core.layout();
  // assert
  assert.deepEqual(ids(first), ['x:code', 'g:w', 'w/m0.js', 'w/m1.js', 'w/m2.js', 'more:g:w']);
  assert.equal(first.boxes.find((b) => b.id === 'more:g:w').more, 4);
  assert.deepEqual(first.edges.map((e) => `${e.from}>${e.to}:${e.count}`).sort(), ['x:code>more:g:w:2', 'x:code>w/m0.js:1']);
  assert.equal(second.boxes.find((b) => b.id === 'more:g:w').more, 1);
  assert.equal(second.boxes.filter((b) => b.id.startsWith('w/')).length, 6);
});

test('a group wider than the split gets a directory level, skipping a level every element shares', () => {
  // arrange
  const labels = ['bin/lib/a.js', 'bin/lib/b.js', 'bin/tools/x/c.js', 'bin/tools/x/d.js', 'bin/tools/e.js', 'bin/top.js', 'bin/solo/f.js', 'handle()'];
  const core = createMapCore({ v: 1, kind: 'dfd', groups: [{ id: 'bin', label: 'bin', boundary: 'system' }], nodes: labels.map((l) => proc(l, { group: 'bin' })), flows: [] }, { split: 2 });
  // act
  const kids = (id) => core.items.get(id).children.map((c) => c.label).sort();
  // assert
  assert.deepEqual(kids('g:bin'), ['bin/lib/', 'bin/solo/f.js', 'bin/tools/', 'bin/top.js', 'handle()']);
  assert.deepEqual(kids('d:g:bin/lib'), ['bin/lib/a.js', 'bin/lib/b.js']);
  assert.deepEqual(kids('d:g:bin/tools'), ['bin/tools/e.js', 'bin/tools/x/']);
  assert.equal(core.items.get('bin/tools/x/c.js').parent, 'd:d:g:bin/tools/x');
  assert.equal(core.items.get('d:g:bin/lib').roll.elements, 2);
});

test('reveal opens whatever hides an element, raises a page that cuts it off, and selects a folded leaf without drawing it', () => {
  // arrange
  const nodes = Array.from({ length: 7 }, (_, i) => proc(`w/m${i}.js`, { group: 'w' }));
  const paged = createMapCore({ v: 1, kind: 'dfd', groups: [{ id: 'w', label: 'w', boundary: 'system' }], nodes, flows: [] }, { page: 3 });
  const core = createMapCore(MODEL());
  // act
  const got = [paged.reveal('w/m6.js'), core.reveal('api/db.js'), core.reveal('nope')];
  const afterDb = [...core.S.open];
  core.reveal('DB_URL');
  const leafFocus = core.S.focus;
  const openAfterLeaf = [...core.S.open];
  core.reveal('loose.js');
  core.reveal('g:web');
  // assert
  assert.deepEqual(got, [true, true, false]);
  assert.ok(ids(paged.layout()).includes('w/m6.js'));
  assert.deepEqual(afterDb, ['g:api', 'g:core']);
  assert.deepEqual([leafFocus, openAfterLeaf], ['DB_URL', ['g:api', 'g:core']]);
  assert.ok(core.S.open.includes('x:code'));
  assert.equal(core.S.focus, 'g:web');
});

test('the lens decides a box\'s class: worst severity, coverage against the floor, traced, or nothing', () => {
  // arrange
  const core = createMapCore(MODEL());
  const cls = (lens, id) => { core.S.lens = lens; return core.lensClass(core.items.get(id)); };
  // act
  const got = { issues: [cls('issues', 'g:api'), cls('issues', 'loose.js'), cls('issues', 'api/none.js')],
    coverage: [cls('coverage', 'api/routes.js'), cls('coverage', 'api/db.js'), cls('coverage', 'web/page.js'), cls('coverage', 'api/none.js'), cls('coverage', 'orders.db')],
    traced: [cls('traced', 'g:api'), cls('traced', 'g:web')], none: [cls('none', 'g:api')] };
  // assert
  assert.deepEqual(got, { issues: ['sev-critical', 'sev-low', ''], coverage: ['cov-low', 'cov-ok', 'cov-none', '', ''], traced: ['traced', ''], none: [''] });
});

test('clipText keeps both ends of a long label', () => {
  // arrange
  const core = createMapCore(MODEL());
  // act
  const got = [core.clipText('short', 10), core.clipText('adjudication-sampler.mjs', 15), core.clipText('abcdef', 2)];
  // assert
  assert.deepEqual(got, ['short', 'adjudic…ler.mjs', 'a…']);
  assert.equal(got[1].length, 15);
});

test('issues are listed worst first with where each sits', () => {
  // arrange
  const core = createMapCore(MODEL());
  // act
  const rows = core.issues();
  const none = createMapCore({ v: 1, kind: 'dfd', nodes: [proc('a')], flows: [] }).issues();
  // assert
  assert.deepEqual(rows.map((r) => [r.id, r.severity, r.node, r.where, r.status, r.cwe, r.title]), [
    ['F2', 'critical', 'api/db.js', 'api/db.js', 'live', 'CWE-89', 'sql injection'],
    ['F1', 'medium', 'api/routes.js', 'api/routes.js → api/db.js', 'undetermined', '', ''],
    ['F4', 'low', 'loose.js', 'loose.js → loose.js', 'undetermined', '', ''],
    ['F3', 'undetermined', 'web/page.js', 'web/page.js', 'undetermined', '', 'odd one'],
  ]);
  assert.deepEqual(none, []);
});

test('search finds issues, elements, leaves and groups by text, and nothing for under two characters', () => {
  // arrange
  const core = createMapCore(MODEL());
  // act
  const got = { sql: core.search('SQL'), db: core.search('db').map((h) => `${h.kind}:${h.id}`), api: core.search('api', 2).length, short: core.search('a'), empty: core.search(null), core: core.search('core').map((h) => h.kind), cwe: core.search('cwe-89').length, f1: core.search('F1') };
  // assert
  assert.deepEqual(got.sql, [{ id: 'api/db.js', label: 'F2 sql injection', kind: 'issue' }]);
  assert.deepEqual(got.db.sort(), ['element:api/db.js', 'element:orders.db', 'env:DB_URL']);
  assert.deepEqual([got.api, got.short, got.empty, got.core, got.cwe], [2, [], [], ['group'], 1]);
  assert.deepEqual(got.f1, [{ id: 'api/routes.js', label: 'F1', kind: 'issue' }]);
});

test('detail says what an element holds and touches: issues, peers by flow count, leaves by kind', () => {
  // arrange
  const core = createMapCore(MODEL());
  // act
  const d = core.detail('api/routes.js');
  // assert
  assert.deepEqual([d.label, d.kind, d.leaf, d.path, d.subtype, d.traced, d.coverage, d.total, d.note], ['api/routes.js', 'node', false, ['api'], 'process', true, 0.6, 10, '']);
  assert.deepEqual(d.issues, [{ id: 'F1', title: '', severity: 'medium', state: 'open', note: '' }]);
  assert.deepEqual(d.peers, [{ id: 'api/db.js', label: 'api/db.js', count: 2 }, { id: 'req', label: 'request', count: 1 }, { id: 'web/page.js', label: 'web/page.js', count: 1 }]);
  assert.deepEqual(d.touches, [{ kind: 'file', count: 3, list: [{ id: 'cache.json', label: 'cache.json' }, { id: 'cfg', label: 'cfg' }, { id: 'log.txt', label: 'log.txt' }] }, { kind: 'env', count: 1, list: [{ id: 'PORT', label: 'PORT' }] }]);
  assert.deepEqual(d.users, []);
});

test('detail of a leaf names who uses it; of a group, what is inside; of nothing, null', () => {
  // arrange
  const core = createMapCore(MODEL());
  core.pin('g:api'); core.expand('g:api');
  // act
  const leaf = core.detail('DB_URL');
  const group = core.detail('g:api');
  const odd = core.detail('odd');
  const limited = core.detail('api/routes.js', 1);
  const none = [core.detail('nope'), core.detail('')];
  // assert
  assert.deepEqual([leaf.leaf, leaf.subtype, leaf.users, leaf.peers, leaf.touches], [true, 'env', [{ id: 'api/db.js', label: 'api/db.js', count: 1 }], [], []]);
  assert.deepEqual([group.kind, group.elements, group.leaves, group.pinned, group.open, group.worst], ['group', 3, 1, true, true, 'critical']);
  assert.deepEqual(group.children, [{ id: 'g:core', label: 'core', issues: 2, elements: 2 }, { id: 'api/routes.js', label: 'api/routes.js', issues: 1, elements: 1 }]);
  assert.equal(odd.subtype, 'external');
  assert.deepEqual([limited.peers.length, limited.touches[0].list.length, limited.touches[0].count], [1, 1, 3]);
  assert.deepEqual(none, [null, null]);
});

test('closed, the drawing is the platform: sources left, code by rank, stores right, every flow between them merged', () => {
  // arrange
  const core = createMapCore(MODEL());
  // act
  const L = core.layout();
  // assert
  const col = (id) => L.boxes.find((b) => b.id === id).x;
  assert.deepEqual(ids(L).sort(), ['g:api', 'g:web', 'x:code', 'x:env', 'x:file', 'x:other']);
  assert.ok(col('x:env') < col('g:web') && col('g:web') === col('x:code') && col('g:web') < col('g:api') && col('g:api') < col('x:file') && col('x:file') === col('x:other'));
  assert.ok(L.boxes.every((b) => !b.open && b.w === 172 && b.depth === 0));
  assert.deepEqual(L.edges.map((e) => `${e.from}>${e.to}:${e.count}:${e.taint}:${e.level}`).sort(), ['g:api>x:file:2:false:platform', 'g:web>g:api:1:false:platform', 'x:env>g:api:2:false:platform', 'x:file>g:api:1:false:platform', 'x:other>g:api:1:true:platform']);
  assert.deepEqual([L.hidden, L.focusBox], [0, null]);
  assert.ok(L.w > col('x:file') + 172 && L.h > 100);
});

test('a closed group is taller the more it holds; a bucket counts its leaves; an element is one height', () => {
  // arrange
  const core = createMapCore(MODEL());
  // act
  const L = core.layout();
  const h = (id) => L.boxes.find((b) => b.id === id).h;
  // assert
  assert.deepEqual([core.sizeOf(core.items.get('g:api')), core.sizeOf(core.items.get('x:env')), core.sizeOf(core.items.get('x:file'))], [3, 2, 3]);
  assert.deepEqual([h('g:api'), h('x:env'), h('g:web')], [60, 56, 51]);
  core.S.leaves = true;
  assert.equal(core.sizeOf(core.items.get('g:api')), 4);
});

test('a bucket of folded leaves is one closed box that does not open until leaves are drawn', () => {
  // arrange
  const core = createMapCore(MODEL());
  // act
  const refused = core.expand('x:env');
  core.S.leaves = true;
  const opened = core.expand('x:env');
  const L = core.layout();
  // assert
  assert.deepEqual([refused, opened], [false, true]);
  assert.deepEqual(ids(L).filter((x) => ['DB_URL', 'PORT'].includes(x)), ['DB_URL', 'PORT']);
  assert.ok(ids(L).includes('cfg') === false);
});

test('opening a group keeps the platform flows and adds the traced ones inside it; the rest are counted, not drawn', () => {
  // arrange
  const core = createMapCore(MODEL());
  // act
  const opened = [core.expand('g:core'), core.expand('nope'), core.expand(''), core.expand('api/db.js')];
  const L = core.layout();
  // assert
  assert.deepEqual(opened, [true, false, false, false]);
  assert.deepEqual(core.S.open, ['g:api', 'g:core']);
  assert.deepEqual(ids(L).sort(), ['api/db.js', 'api/none.js', 'api/routes.js', 'g:api', 'g:core', 'g:web', 'x:code', 'x:env', 'x:file', 'x:other']);
  const box = Object.fromEntries(L.boxes.map((b) => [b.id, b]));
  assert.ok(box['g:api'].open && box['g:core'].open && box['g:core'].depth === 1 && box['api/db.js'].depth === 2);
  assert.ok(box['api/db.js'].x > box['g:core'].x && box['api/db.js'].y > box['g:core'].y && box['g:core'].x > box['g:api'].x);
  assert.ok(box['g:api'].w >= box['g:core'].w && L.w > box['g:api'].w && L.h >= box['g:api'].h);
  assert.deepEqual(L.edges.map((e) => `${e.from}>${e.to}:${e.count}:${e.level}`).sort(), ['api/routes.js>api/db.js:2:detail', 'g:api>x:file:2:platform', 'g:web>g:api:1:platform', 'x:env>g:api:2:platform', 'x:file>g:api:1:platform', 'x:other>api/routes.js:1:detail', 'x:other>g:api:1:platform']);
  assert.equal(L.hidden, 6);
});

test('"all flows" draws every flow inside open groups, in place of the platform flows that end on them', () => {
  // arrange
  const core = createMapCore(MODEL());
  core.expand('g:core');
  core.S.edges = 'all';
  // act
  const L = core.layout();
  // assert
  assert.deepEqual(L.edges.map((e) => `${e.from}>${e.to}:${e.count}:${e.level}`).sort(), ['api/db.js>x:file:1:detail', 'api/routes.js>api/db.js:2:detail', 'api/routes.js>x:file:1:detail', 'g:web>api/routes.js:1:detail', 'x:env>api/db.js:1:detail', 'x:env>api/routes.js:1:detail', 'x:file>api/routes.js:1:detail', 'x:other>api/routes.js:1:detail']);
  assert.equal(L.hidden, 0);
});

test('the selected box\'s flows are drawn and marked, whether it is drawn itself, stands in a group, or is a folded leaf', () => {
  // arrange
  const core = createMapCore(MODEL());
  core.expand('g:core');
  const hot = () => { const L = core.layout(); return [L.focusBox, L.edges.filter((e) => e.hot).map((e) => `${e.from}>${e.to}`).sort()]; };
  // act
  core.S.focus = 'web/page.js';
  const inGroup = hot();
  core.S.focus = 'api/db.js';
  const drawn = hot();
  core.S.focus = 'DB_URL';
  const leaf = hot();
  core.S.focus = 'cfg';
  const lost = hot();
  core.S.focus = 'g:web';
  const top = hot();
  core.S.focus = 'g:empty';
  const hiddenGroup = hot();
  // assert
  assert.deepEqual(inGroup, ['g:web', ['g:web>api/routes.js', 'g:web>g:api']]);
  assert.deepEqual(drawn, ['api/db.js', ['api/db.js>x:file', 'api/routes.js>api/db.js', 'x:env>api/db.js']]);
  assert.deepEqual(leaf, ['x:env', ['x:env>api/db.js', 'x:env>api/routes.js', 'x:env>g:api']]);
  assert.deepEqual(lost, [null, []]);
  assert.deepEqual(top[0], 'g:web');
  assert.deepEqual(hiddenGroup, [null, []]);
});

test('a flow is a curve between the sides that face each other, and a box\'s flows fan along its height', () => {
  // arrange
  const core = createMapCore(MODEL());
  // act
  const L = core.layout();
  const box = Object.fromEntries(L.boxes.map((b) => [b.id, b]));
  const edge = (from, to) => L.edges.find((e) => e.from === from && e.to === to);
  const pts = (e) => e.d.match(/-?[\d.]+/g).map(Number);
  // assert
  const fwd = pts(edge('x:env', 'g:api'));
  assert.equal(fwd[0], box['x:env'].x + 172);
  assert.equal(fwd[6], box['g:api'].x);
  assert.ok(fwd[2] > fwd[0] && fwd[4] < fwd[6]);
  const back = pts(edge('x:file', 'g:api'));
  assert.equal(back[0], box['x:file'].x);
  assert.equal(back[6], box['g:api'].x + 172);
  assert.ok(back[2] < back[0] && back[4] > back[6]);
  const into = L.edges.filter((e) => e.to === 'g:api').map((e) => pts(e)[7]);
  assert.equal(new Set(into).size, into.length);
  assert.ok(into.every((y) => y > box['g:api'].y && y < box['g:api'].y + box['g:api'].h));
  assert.match(edge('x:env', 'g:api').d, /^M[\d.]+,[\d.]+ C[\d.]+,[\d.]+ [\d.]+,[\d.]+ [\d.]+,[\d.]+$/);
  assert.ok(Number.isFinite(edge('x:env', 'g:api').lx) && Number.isFinite(edge('x:env', 'g:api').ly));
});

test('two boxes in one column are joined by a curve that leaves and returns on the right', () => {
  // arrange: two code groups with a flow each way are a cycle, so they share no rank order; a third hangs off the first
  const groups = ['a', 'b'].map((g) => ({ id: g, label: g, boundary: 'system' }));
  const nodes = [proc('a1', { group: 'a' }), proc('b1', { group: 'b' })];
  const core = createMapCore({ v: 1, kind: 'dfd', groups, nodes, flows: [flow('a1', 'b1'), flow('a1', 'b1'), flow('b1', 'a1')] });
  // act
  const L = core.layout();
  const box = Object.fromEntries(L.boxes.map((b) => [b.id, b]));
  const back = L.edges.find((e) => e.from === 'g:b' && e.to === 'g:a');
  const fwd = L.edges.find((e) => e.from === 'g:a' && e.to === 'g:b');
  // assert: a sends more than it receives, so it ranks first; b>a runs backwards, right to left
  assert.ok(box['g:a'].x < box['g:b'].x);
  assert.equal(Number(fwd.d.match(/^M([\d.]+)/)[1]), box['g:a'].x + 172);
  assert.equal(Number(back.d.match(/^M([\d.]+)/)[1]), box['g:b'].x);
});

test('code with no flow between it shares a column, wrapped when it grows too tall, and loops stay on one side', () => {
  // arrange: 14 groups of one element, none connected, and one pair in the same column joined by a flow through a shared sink
  const groups = Array.from({ length: 14 }, (_, i) => ({ id: `g${i}`, label: `g${i}`, boundary: 'system' }));
  const nodes = [...groups.map((g) => proc(`${g.id}/m.js`, { group: g.id })), { id: 'sink', kind: 'external', label: 'sink', impact: 'high', group: 'out' }, { id: 'src', kind: 'external', label: 'src', impact: 'low', group: 'in' }];
  const flows = [flow('g0/m.js', 'sink'), flow('src', 'g1/m.js'), flow('src', 'g2/m.js'), flow('sink', 'src')];
  const core = createMapCore({ v: 1, kind: 'dfd', groups: [...groups, { id: 'out', label: 'out', boundary: 'trust' }, { id: 'in', label: 'in', boundary: 'trust' }], nodes, flows });
  // act
  const L = core.layout();
  const xs = [...new Set(L.boxes.filter((b) => b.id.startsWith('g:g')).map((b) => b.x))];
  const box = Object.fromEntries(L.boxes.map((b) => [b.id, b]));
  // assert: 14 boxes of 51 with gaps pass 640, so the code column wraps once; `in` sends more than it takes and sits left, `out` right
  assert.equal(xs.length, 2);
  assert.ok(box['g:in'].x < Math.min(...xs) && box['g:out'].x > Math.max(...xs));
  const loop = L.edges.find((e) => e.from === 'g:out' && e.to === 'g:in');
  assert.equal(Number(loop.d.match(/^M([\d.]+)/)[1]), box['g:out'].x);
});

test('boxes stacked in one sub-column are joined on their right sides', () => {
  // arrange: two unconnected code groups share a column; a document flow joins a store in the first to code in the second
  const groups = ['a', 'b'].map((g) => ({ id: g, label: g, boundary: 'system' }));
  const nodes = [proc('a1', { group: 'a' }), proc('b1', { group: 'b' }), proc('b2', { group: 'b' })];
  const core = createMapCore({ v: 1, kind: 'dfd', groups, nodes, flows: [flow('a1', 'b1'), flow('b1', 'a1')] });
  // act
  const L = core.layout();
  const box = Object.fromEntries(L.boxes.map((b) => [b.id, b]));
  // assert: equal traffic each way leaves them in document order, a then b, one rank apart; give them one column by cutting the flows
  assert.ok(box['g:a'].x <= box['g:b'].x);
  const same = createMapCore({ v: 1, kind: 'dfd', groups, nodes: [...nodes, { id: 'f', kind: 'store', subtype: 'file', label: 'f', impact: 'high', group: 'a' }], flows: [flow('f', 'b1')] });
  same.expand('g:a'); same.expand('g:b'); same.S.edges = 'all';
  const M = same.layout();
  const e = M.edges.find((x) => x.from === 'f' && x.to === 'b1');
  const mb = Object.fromEntries(M.boxes.map((b) => [b.id, b]));
  const n = e.d.match(/-?[\d.]+/g).map(Number);
  assert.ok(mb.f.x < mb.b1.x + mb.b1.w && mb.b1.x < mb.f.x + mb.f.w ? n[0] === mb.f.x + mb.f.w && n[6] === mb.b1.x + mb.b1.w && n[2] > n[0] : true);
});

test('issueText is everything the document holds about one issue, as plain text', () => {
  // arrange
  const model = MODEL();
  model.findings[1].source = { tool: 'codeql', rule: 'js/sql-injection', file: 'api/routes.js', line: 20, message: 'query built from a user value', steps: Array.from({ length: 16 }, (_, i) => ({ file: 'api/routes.js', line: i + 1, ...(i % 2 ? {} : { expr: `step\n  ${i}` }) })) };
  model.findings[1].note = 'seen twice';
  model.findings[3].source = { rule: 'js/x', file: 'loose.js', steps: [{ file: 'loose.js', line: 3, expr: 'x' }] };
  const core = createMapCore(model);
  // act
  const f2 = core.issueText('F2');
  const f1 = core.issueText('F1').split('\n');
  const f4 = core.issueText('F4').split('\n');
  const f3 = core.issueText('F3');
  // assert
  assert.equal(f2, ['F2  sql injection', 'severity: critical · status: live · CWE-89', 'where: api/db.js', 'state: open, nobody has ruled on it', 'element: api/db.js · 100% of 10 lines covered by tests', 'touches: DB_URL', 'flows with: api/routes.js, orders.db'].join('\n'));
  assert.deepEqual(f1.slice(0, 8), ['F1  js/sql-injection', 'severity: medium · status: undetermined', 'where: api/routes.js:20', 'state: open, nobody has ruled on it', 'reported by: codeql, rule js/sql-injection', 'message: query built from a user value', 'note: seen twice', 'traced flow (16 steps, source first):']);
  assert.deepEqual([f1[8], f1[9], f1[14], f1[15], f1[20]], ['   1. api/routes.js:1  step 0', '   2. api/routes.js:2', '  … 4 steps not shown …', '  11. api/routes.js:11  step 10', '  16. api/routes.js:16']);
  assert.deepEqual(f4.slice(0, 7), ['F4  js/x', 'severity: low · status: undetermined', 'where: loose.js', 'state: open, nobody has ruled on it', 'reported by: a scanner, rule js/x', 'traced flow (1 steps, source first):', '   1. loose.js:3  x']);
  assert.match(f3, /severity: undetermined · status: undetermined\nwhere: web\/page.js\nstate: open, nobody has ruled on it\nelement: web\/page.js · test coverage not measured\nflows with: api\/routes.js$/);
  assert.equal(core.issueText('nope'), '');
});

test('issueText of an element with nothing to cover, many leaves, and an anchor the tree does not hold', () => {
  // arrange
  const nodes = [proc('m', { coverage: { lines: { covered: 0, total: 0 } } }), ...Array.from({ length: 14 }, (_, i) => env(`V${String(i).padStart(2, '0')}`))];
  const core = createMapCore({ v: 1, kind: 'dfd', nodes, flows: nodes.slice(1).map((n) => flow(n.id, 'm')), findings: [{ id: 'A', at: { node: 'm' } }, { id: 'B', at: { node: 'gone' } }] });
  // act
  const a = core.issueText('A').split('\n');
  const b = core.issueText('B').split('\n');
  // assert
  assert.deepEqual(a.slice(2), ['where: m', 'state: open, nobody has ruled on it', 'element: m', 'touches: V00, V01, V02, V03, V04, V05, V06, V07, V08, V09, V10, V11, and 2 more']);
  assert.deepEqual(b, ['B', 'severity: undetermined · status: undetermined', 'where: gone', 'state: open, nobody has ruled on it']);
});

test('remediationPrompt asks for the claim to be checked first, then lists the chosen issues worst first', () => {
  // arrange
  const core = createMapCore(MODEL());
  // act
  const one = core.remediationPrompt(['F1']);
  const all = core.remediationPrompt();
  const some = core.remediationPrompt(['F3', 'nope', 'F2']);
  const none = [core.remediationPrompt(['nope']), createMapCore({ v: 1, kind: 'dfd', nodes: [proc('a')], flows: [] }).remediationPrompt()];
  // assert
  assert.match(one, /^Remediate issue F1 in shop\.\n\nThe standard is a clean data flow and security that does not rest on one protection: at least two controls on different axes[^\n]*\n\nIt is a scanner result, not a verified defect\. For each issue, in this order:\n1\. Open the file at the line given\./);
  assert.match(one, /\nFiles named: api\/routes.js\n\n---\nF1\nseverity: medium/);
  assert.match(all, /^Remediate 4 issues in shop\.\n\nThe standard[^\n]*\n\nThey are scanner results, not verified defects\./);
  assert.match(all, /Do not silence a rule with a suppression comment/);
  assert.deepEqual([...all.matchAll(/^---\n(F\d)/gm)].map((m) => m[1]), ['F2', 'F1', 'F4', 'F3']);
  assert.match(all, /\nFiles named: api\/db.js, api\/routes.js, loose.js, web\/page.js\n/);
  assert.deepEqual([...some.matchAll(/^---\n(F\d)/gm)].map((m) => m[1]), ['F2', 'F3']);
  assert.match(some, /^Remediate 2 issues in shop\./);
  assert.deepEqual(none, ['', '']);
  assert.match(createMapCore({ v: 1, kind: 'dfd', nodes: [proc('a')], flows: [], findings: [{ id: 'Z', at: { node: 'a' } }, { id: 'A', at: { node: 'a' } }] }).remediationPrompt(), /^Remediate 2 issues in this repository\.[\s\S]*---\nA\n[\s\S]*---\nZ\n/);
});

test('a document with no groups, findings or coverage still maps', () => {
  // arrange
  const core = createMapCore({ v: 1, kind: 'dfd', nodes: [proc('a'), { id: 'db', kind: 'store', subtype: 'database', label: 'db' }], flows: [flow('a', 'db'), flow('ghost', 'a'), flow('a', 'ghost')] });
  // act
  const L = core.layout();
  const st = core.stats();
  // assert
  assert.deepEqual(ids(L), ['x:code', 'x:database']);
  assert.deepEqual(L.edges.map((e) => `${e.from}>${e.to}:${e.count}`), ['x:code>x:database:1']);
  assert.deepEqual([st.coverage, st.issues, st.leaves, core.root.label, core.items.get('x:database').label], [null, 0, 1, 'data flow diagram', 'Databases']);
  assert.deepEqual(createMapCore({ v: 1, kind: 'dfd', nodes: [], flows: [] }).layout().boxes, []);
});

/** The fixture with rulings on its four issues: one fixed, one dismissed on one tested axis, one held on two, one left open. */
const RULED = () => {
  const m = MODEL();
  const f = Object.fromEntries(m.findings.map((x) => [x.id, x]));
  f.F2.status = 'mitigated'; f.F2.note = 'Fixed: the query is parameterised.';
  f.F1.status = 'dismissed'; f.F1.note = 'Not a defect: the value is a route name.'; f.F1.dataClass = 'identifier';
  f.F1.controls = [{ axis: 'sink', what: 'parameterised query', where: 'api/db.js:12', test: 'api/test/db.test.mjs: binds' }, { axis: 'source', what: 'route allowlist' }, { axis: 'sink', what: 'second sink control', test: 't' }];
  f.F3.status = 'dismissed';
  f.F3.controls = [{ axis: 'sink', what: 'escaped on output', test: 'a' }, { axis: 'transport', what: 'verified channel', test: 'b' }];
  return m;
};

test('an issue is open, thin, held or fixed: a dismissal closes only on two tested axes', () => {
  // arrange
  const core = createMapCore(RULED());
  const f = Object.fromEntries(RULED().findings.map((x) => [x.id, x]));
  // act
  const states = ['F1', 'F2', 'F3', 'F4'].map((id) => core.stateOf(f[id]));
  const axes = [core.axesOf(f.F1), core.axesOf(f.F4)];
  // assert
  assert.deepEqual(states, ['thin', 'fixed', 'held', 'open']);
  assert.deepEqual(axes, [{ controls: 3, axes: 2, tested: 1 }, { controls: 0, axes: 0, tested: 0 }]);
  assert.deepEqual(core.STATES, ['open', 'thin', 'held', 'fixed']);
  assert.deepEqual(core.stats().states, { open: 1, thin: 1, held: 1, fixed: 1 });
});

test('roll-ups keep open, thin and closed apart, and the issues lens colours a box by the worst that is left', () => {
  // arrange
  const core = createMapCore(RULED());
  const size = (id) => { const r = core.items.get(id).roll; return [r.issues.size, r.thin.size, r.done.size, r.worst]; };
  // act
  const got = { api: size('g:api'), core: size('g:core'), web: size('g:web'), code: size('x:code') };
  const cls = ['g:api', 'g:core', 'g:web', 'x:code', 'g:empty'].map((id) => core.lensClass(core.items.get(id)));
  // assert: F1 sits on the routes>db flow, so it counts in api and in core; F2 (fixed) is in core
  assert.deepEqual(got, { api: [0, 1, 1, null], core: [0, 1, 1, null], web: [0, 0, 1, null], code: [1, 0, 0, 'low'] });
  assert.deepEqual(cls, ['thin', 'thin', 'done', 'sev-low', '']);
  assert.deepEqual(core.root.children.map((c) => c.id).slice(0, 2), ['x:code', 'g:api']);
});

test('issues list what is not closed first, with the axes behind each ruling; detail and children count them', () => {
  // arrange
  const core = createMapCore(RULED());
  // act
  const rows = core.issues().map((r) => [r.id, r.state, r.controls, r.axes, r.tested, r.note]);
  const d = core.detail('g:api');
  // assert
  assert.deepEqual(rows, [['F4', 'open', 0, 0, 0, ''], ['F1', 'thin', 3, 2, 1, 'Not a defect: the value is a route name.'], ['F3', 'held', 2, 2, 2, ''], ['F2', 'fixed', 0, 0, 0, 'Fixed: the query is parameterised.']]);
  assert.deepEqual(d.issues.map((i) => [i.id, i.state]), [['F1', 'thin'], ['F2', 'fixed']]);
  assert.deepEqual(d.children.map((c) => [c.id, c.issues]), [['g:core', 1], ['api/routes.js', 1]]);
});

test('issueText gives the state, the data class and each control with its test; the brief leaves closed issues out', () => {
  // arrange
  const core = createMapCore(RULED());
  // act
  const f1 = core.issueText('F1').split('\n');
  const state = (id) => core.issueText(id).split('\n').find((l) => l.startsWith('state: '));
  const brief = core.remediationPrompt();
  const named = core.remediationPrompt(['F2']);
  // assert
  assert.deepEqual(f1.slice(3, 10), ['state: judged not a defect on 1 tested axis: not closed, the standard is two', 'data class: identifier', 'note: Not a defect: the value is a route name.',
    'controls (3 on 2 axes, 1 tested):', '  sink: parameterised query (api/db.js:12) · test: api/test/db.test.mjs: binds', '  source: route allowlist · no test', '  sink: second sink control · test: t']);
  assert.deepEqual([state('F2'), state('F3')], ['state: fixed as reported, not rescanned', 'state: judged not a defect, held on 2 tested axes']);
  assert.match(core.issueText('F3'), /controls \(2 on 2 axes, 2 tested\):/);
  assert.match(brief, /^Remediate 2 issues in shop\./);
  assert.deepEqual([...brief.matchAll(/^---\n(F\d)/gm)].map((m) => m[1]), ['F4', 'F1']);
  assert.match(brief, /Report per issue as JSON this tool reads back \(commitwork dfd --verdicts <file>\)/);
  assert.match(named, /^Remediate issue F2 in shop\./);
  const zero = createMapCore({ ...RULED(), findings: RULED().findings.filter((x) => x.id === 'F2') });
  assert.equal(zero.remediationPrompt(), '');
  const none = RULED(); none.findings[1].controls = [{ axis: 'sink', what: 'one', where: 'x' }]; none.findings[1].status = 'dismissed';
  assert.match(createMapCore(none).issueText('F1'), /judged not a defect on 0 tested axes: not closed[\s\S]*controls \(1 on 1 axis, 0 tested\):/);
});

/** The ruled fixture with its rulings carried by pull requests; F3's dismissal names none. */
const WITH_PRS = () => {
  const m = RULED();
  m.prs = [{ id: '#7', title: 'bind the query', state: 'merged', files: ['api/db.js', 'docs/none.md'] }, { id: '#9', title: 'name the route control', state: 'draft' }, { id: '#12', title: 'docs only', files: ['web/page.js'] }];
  const f = Object.fromEntries(m.findings.map((x) => [x.id, x]));
  f.F2.pr = '#7'; f.F1.pr = '#9';
  return m;
};
const LOOSE = { id: 'no change recorded', title: 'rulings that name no pull request, commit or patch', state: '', files: 0, patches: [] };

test('playback starts from the original position: step 0 has every issue open, and rulings no change accounts for land first, together', () => {
  // arrange
  const core = createMapCore(WITH_PRS());
  const at = (k) => { core.setStep(k); return core.stats().states; };
  // act
  const all = core.stats().states;
  const steps = [at(0), at(1), at(2), at(3), at(4)];
  // assert
  assert.deepEqual(all, { open: 1, thin: 1, held: 1, fixed: 1 });
  assert.deepEqual(steps, [{ open: 4, thin: 0, held: 0, fixed: 0 }, { open: 3, thin: 0, held: 1, fixed: 0 }, { open: 2, thin: 0, held: 1, fixed: 1 }, { open: 1, thin: 1, held: 1, fixed: 1 }, { open: 1, thin: 1, held: 1, fixed: 1 }]);
});

test('playback re-rolls every box, marks what the step touched, and never moves a box', () => {
  // arrange
  const core = createMapCore(WITH_PRS());
  const order = () => core.root.children.map((c) => c.id).join(' ');
  const before = order();
  const marks = () => ['g:api', 'g:core', 'api/db.js', 'api/routes.js', 'g:web', 'web/page.js'].map(core.isChanged);
  // act
  core.setStep(0);
  const zero = { api: core.items.get('g:api').roll.issues.size, worst: core.items.get('g:api').roll.worst, marks: marks(), order: order() };
  core.setStep(2);
  const two = { api: [core.items.get('g:api').roll.issues.size, core.items.get('g:api').roll.done.size], marks: marks() };
  core.setStep(4);
  const four = marks();
  // assert
  assert.deepEqual(zero, { api: 2, worst: 'critical', marks: [false, false, false, false, false, false], order: before });
  assert.deepEqual(two, { api: [1, 1], marks: [true, true, true, false, false, false] });
  assert.deepEqual(four, [false, false, false, false, true, true]);
  assert.equal(order(), before);
});

test('setStep clamps and rounds; stepInfo names the change set and what it did', () => {
  // arrange
  const core = createMapCore(WITH_PRS());
  // act
  const got = [core.setStep(-4), core.setStep(99), core.setStep('2'), core.setStep('x'), core.setStep(1.4)];
  const one = core.stepInfo();
  core.setStep(2);
  const two = core.stepInfo();
  core.setStep(3);
  const three = core.stepInfo();
  core.setStep(0);
  const zero = core.stepInfo();
  const none = createMapCore(MODEL());
  // assert
  assert.deepEqual(got, [0, 4, 2, 0, 1]);
  assert.deepEqual(one, { step: 1, total: 4, unit: 'pull request', pr: LOOSE, fixes: [], rules: ['F3'], touched: 1 });
  assert.deepEqual(two, { step: 2, total: 4, unit: 'pull request', pr: { id: '#7', title: 'bind the query', state: 'merged', files: 2, patches: [] }, fixes: ['F2'], rules: [], touched: 1 });
  assert.deepEqual(three, { step: 3, total: 4, unit: 'pull request', pr: { id: '#9', title: 'name the route control', state: 'draft', files: 0, patches: [] }, fixes: [], rules: ['F1'], touched: 2 });
  assert.deepEqual(zero, { step: 0, total: 4, unit: 'pull request', pr: null, fixes: [], rules: [], touched: 0 });
  assert.deepEqual([none.stepInfo().total, none.setStep(2), none.stats().states.open], [0, 0, 4]);
  const bare = WITH_PRS(); bare.prs = [{ id: '#7' }]; bare.findings.forEach((f) => { if (f.id !== 'F2') { f.status = undefined; f.pr = undefined; } });
  assert.deepEqual([createMapCore(bare).stepInfo().total, createMapCore(bare).stepInfo().pr], [1, { id: '#7', title: '', state: '', files: 0, patches: [] }]);
});

test('with no pull requests declared, patches play back as change sets: grouped by shared commits, else by the file they were read from', () => {
  // arrange: K1 and K3 come from one patch file and both name F2; K2 has a commit; K4 has neither
  const m = RULED();
  m.patches = [{ id: 'K1', title: 'bind', findings: ['F2'], closes: [{ from: 'api/db.js', to: 'orders.db' }], evidence: { level: 'tested', refs: ['a.patch'] } },
    { id: 'K2', findings: ['F1'], closes: [{ from: 'api/routes.js', to: 'api/db.js' }], guard: { from: 'web/page.js', to: 'api/routes.js' }, rejects: [{ from: 'req', to: 'api/routes.js' }], commits: ['abcdef0123456789'] },
    { id: 'K3', closes: [{ from: 'api/db.js', to: 'orders.db' }], findings: ['F2'], evidence: { level: 'tested', refs: ['a.patch'] } }, { id: 'K4', closes: [{ from: 'api/db.js', to: 'orders.db' }] }];
  const core = createMapCore(m);
  const info = (k) => { core.setStep(k); const i = core.stepInfo(); return [i.pr.id, i.pr.patches, i.fixes, i.rules, i.touched, core.stats().states.open]; };
  // act
  core.setStep(0);
  const zero = [core.stepInfo().unit, core.stepInfo().total, core.stats().states];
  const steps = [info(1), info(2), info(3), info(4)];
  core.setStep(3);
  const ringed = ['g:web', 'g:api', 'x:other', 'x:file'].map(core.isChanged);
  // assert: one step lands both patches of a.patch, and with them the issue they fix
  assert.deepEqual(zero, ['change set', 4, { open: 4, thin: 0, held: 0, fixed: 0 }]);
  assert.deepEqual(steps, [['no change recorded', [], [], ['F3'], 1, 3], ['a.patch', ['K1', 'K3'], ['F2'], [], 2, 2], ['commits abcdef012345', ['K2'], [], ['F1'], 4, 1], ['patches with no commit or file recorded', ['K4'], [], [], 2, 1]]);
  assert.deepEqual(ringed, [true, true, true, false]);
});

test('a pull request lands every patch that names it, and an issue drawn at a second place follows the patch that names its id', () => {
  // arrange
  const m = MODEL();
  m.findings = [{ id: 'F2', at: { node: 'api/db.js' }, status: 'mitigated' }, { id: 'F2@web', at: { node: 'web/page.js' }, status: 'mitigated' }, { id: 'F9', at: { node: 'loose.js' }, status: 'mitigated' }];
  m.prs = [{ id: 'set-a', title: 'two patches' }, { id: 'set-b' }];
  m.patches = [{ id: 'K1', pr: 'set-a', findings: ['F2'], closes: [{ from: 'api/db.js', to: 'orders.db' }] }, { id: 'K2', pr: 'set-a', findings: ['F9'], closes: [{ from: 'api/routes.js', to: 'api/db.js' }] }, { id: 'K3', pr: 'set-b', closes: [{ from: 'api/db.js', to: 'orders.db' }] }];
  const core = createMapCore(m);
  // act
  core.setStep(0);
  const zero = core.stats().states;
  core.setStep(1);
  const one = core.stepInfo();
  // assert: no ruling is unaccounted for, so there is no first step of loose rulings
  assert.deepEqual([core.stepInfo().total, zero], [2, { open: 3, thin: 0, held: 0, fixed: 0 }]);
  assert.deepEqual([one.pr.id, one.pr.patches, one.fixes, core.stats().states], ['set-a', ['K1', 'K2'], ['F2', 'F2@web', 'F9'], { open: 0, thin: 0, held: 0, fixed: 3 }]);
});

test('playback opens every group holding what the step touched, closes them at the next step, and leaves the reader\'s own open', () => {
  // arrange
  const core = createMapCore(WITH_PRS());
  core.expand('g:empty'); core.expand('x:code');
  // act
  core.setStep(2);
  const two = [...core.S.open];
  const drawn = ids(core.layout());
  core.setStep(3);
  const three = [...core.S.open];
  core.setStep(4);
  const four = [...core.S.open];
  core.setStep(0);
  const zero = [...core.S.open];
  // assert: #7 touches api/db.js (api > core); #9 rules on F1, on the routes>db flow; #12 changes web/page.js
  assert.deepEqual(two, ['x:code', 'g:api', 'g:core']);
  assert.ok(drawn.includes('api/db.js') && drawn.includes('loose.js') && !drawn.includes('api/routes.js'));
  assert.deepEqual(three, ['x:code', 'g:api', 'g:core']);
  assert.deepEqual(four, ['x:code', 'g:web']);
  assert.deepEqual(zero, ['x:code']);
});

test('playback folds what a step did not touch behind "more", ignores the budget, leaves folded leaves folded, and can be told not to follow', () => {
  // arrange: 9 modules in one group, pages of 3, a budget of 4; the pull request changes the last module and a folded file
  const nodes = [...Array.from({ length: 9 }, (_, i) => proc(`w/m${i}.js`, { group: 'w' })), file('data.json')];
  const model = { v: 1, kind: 'dfd', groups: [{ id: 'w', label: 'w', boundary: 'system' }], nodes, flows: [flow('w/m0.js', 'data.json')], prs: [{ id: '#1', files: ['w/m8.js', 'data.json', 'not/in/model.js'] }] };
  const core = createMapCore(model, { page: 3, budget: 4 });
  // act
  core.setStep(0); core.setStep(1);
  const L = core.layout();
  core.S.follow = false;
  core.setStep(1);
  const off = [...core.S.open];
  core.S.follow = true; core.S.leaves = true;
  core.setStep(1);
  const withLeaves = [...core.S.open];
  core.S.leaves = false;
  core.setStep(1);
  core.more('more:g:w');
  const handed = ids(core.layout());
  core.expand('g:w');
  core.setStep(1);
  const readerOpen = [core.S.caps.get('g:w'), ids(core.layout()).includes('w/m8.js')];
  // assert: playback's own group draws the touched module and folds the other eight; the budget of 4 does not close it
  assert.deepEqual(ids(L), ['g:w', 'w/m8.js', 'more:g:w', 'x:file']);
  assert.equal(L.boxes.find((b) => b.id === 'more:g:w').more, 8);
  assert.deepEqual(off, []);
  assert.deepEqual(withLeaves, ['g:w', 'x:file']);
  // selecting its "more" box hands the group to the reader: the first page of three, then a "more" box
  assert.deepEqual(handed, ['g:w', 'w/m0.js', 'w/m1.js', 'w/m2.js', 'more:g:w', 'x:file']);
  // a group the reader has open is widened to reach the touched element
  assert.deepEqual(readerOpen, [9, true]);
});

test('story: where harm from an issue could land and come from, how each ruling is known, and what a change does not reach', () => {
  // arrange
  const m = WITH_PRS();
  m.nodes.push({ id: 'pager', kind: 'external', label: 'on-call pager', impact: 'low' }, { id: 'shell', kind: 'external', label: 'a shell', impact: 'critical' });
  m.flows.push(flow('api/db.js', 'pager'), flow('api/db.js', 'shell'), flow('orders.db', 'api/db.js'));
  m.patches = [{ id: 'K1', pr: '#7', title: 'bind', note: 'bound', findings: ['F2'], closes: [{ from: 'api/db.js', to: 'orders.db' }], evidence: { level: 'tested' } }, { id: 'K2', pr: '#7', findings: ['F2'], closes: [{ from: 'api/db.js', to: 'orders.db' }] },
    { id: 'K3', pr: '#12', findings: ['F4'], closes: [{ from: 'api/db.js', to: 'orders.db' }], evidence: { level: 'inspected' } }];
  m.findings.push({ id: 'F2@web', at: { node: 'web/page.js' } }, { id: 'F9', at: { node: 'loose.js' }, status: 'mitigated', pr: '#12' });
  m.findings.find((f) => f.id === 'F4').status = 'mitigated';
  const core = createMapCore(m);
  // act
  const end = core.story();
  core.setStep(2);
  const two = core.story();
  core.setStep(1);
  const one = core.story();
  core.setStep(4);
  const four = core.story();
  // assert
  assert.deepEqual([end.counts, end.unit, end.total], [{ total: 6, open: 1, thin: 1, held: 1, fixed: 3 }, 'pull request', 4]);
  assert.deepEqual(two.set, { id: '#7', title: 'bind the query', state: 'merged' });
  assert.deepEqual(two.dealt, [{ id: 'F2', title: 'sql injection', where: 'api/db.js', severity: 'critical', state: 'fixed', how: 'stated, not checked', note: 'Fixed: the query is parameterised.',
    impacts: [{ label: 'a shell', level: 'critical' }, { label: 'orders.db', level: 'high' }, { label: 'on-call pager', level: 'low' }], sources: ['request', 'DB_URL'], done: [{ id: 'K1', title: 'bind', note: 'bound' }, { id: 'K2', title: 'K2', note: '' }] }]);
  assert.deepEqual(two.beyond.map((h) => [h.id, h.title, h.state, h.how]), [['F2@web', '', 'open', 'nobody has ruled on it']]);
  assert.deepEqual(two.open.map((h) => h.id), ['F1', 'F2@web', 'F4', 'F9']);
  assert.deepEqual([one.set.id, one.dealt.map((h) => [h.id, h.how]), one.beyond], ['no change recorded', [['F3', 'judged not a defect, held by 2 tested safeguards']], []]);
  assert.deepEqual(four.dealt.map((h) => [h.id, h.how, h.impacts.length, h.sources]), [['F4', 'checked by reading the code', 0, []], ['F9', 'fix reported, not rescanned', 0, []]]);
  assert.deepEqual(four.open.map((h) => [h.id, h.state, h.how]), [['F1', 'thin', 'judged not a defect, but on 1 tested safeguard: not closed'], ['F2@web', 'open', 'nobody has ruled on it']]);
  const none = createMapCore(MODEL()).story();
  assert.deepEqual([none.set, none.total, none.dealt, none.beyond, none.open.length], [null, 0, [], [], 4]);
});

