// lib/dfd-map-client.js: the drawing and wiring of the map view, run against a stand-in document
// that keeps what the script writes and lets a test fire the events a reader would. What a browser
// adds (CSS, real layout) is checked by rendering the page headlessly, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMapCore } from '../dfd-map-core.mjs';
import { mountMapView, copyText } from '../dfd-map-client.js';
import { MODEL } from './fixtures/dfd-map-model.mjs';

const count = (text, part) => text.split(part).length - 1;
function fakeDocument(model) {
  const make = (id, extra = {}) => {
    const on = {};
    return { id, innerHTML: '', textContent: '', hidden: false, value: '', checked: false, dataset: {}, attrs: {}, scrolled: 0,
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, fn) { (on[t] = on[t] || []).push(fn); }, fire(t, ev = {}) { for (const fn of on[t] || []) fn(ev); },
      scrollIntoView() { this.scrolled += 1; }, ...extra };
  };
  const els = new Map();
  const groups = {
    '#lens button': ['issues', 'coverage', 'traced', 'none'].map((l) => make('', { dataset: { lens: l } })),
    '#opts input': ['edges', 'leaves', 'labels', 'story', 'follow'].map((o) => make('', { dataset: { opt: o } })),
  };
  return { groups,
    getElementById(id) { if (id === 'dfd-data') return { textContent: JSON.stringify(model) }; if (!els.has(id)) els.set(id, make(id)); return els.get(id); },
    querySelectorAll(sel) { return groups[sel]; } };
}
/** An event whose target answers `closest` for one selector with an element carrying `dataset`. */
const on = (selector, dataset = {}) => ({ target: { dataset, closest: (s) => (s === selector ? { dataset } : null) } });
const miss = { target: { closest: () => null } };
const mount = (model = MODEL(), { copies = true } = {}) => {
  const doc = fakeDocument(model);
  const copied = [];
  const timers = { fns: [], ms: [], cleared: 0, set(fn, ms) { this.fns.push(fn); this.ms.push(ms); return this.fns.length; }, clear() { this.cleared += 1; } };
  const view = mountMapView(doc, createMapCore, { copy: (text) => { copied.push(text); return Promise.resolve(copies); }, timers });
  return { doc, copied, timers, goStep: view.goStep, S: view.core.S, core: view.core, draw: view.draw, copyAnd: view.copyAnd, $: (id) => doc.getElementById(id) };
};
const settle = () => new Promise((r) => setImmediate(r));
const svg = (v) => v.$('wrap').innerHTML;

test('mounting draws the closed map, the tiles, the issue list, an empty panel and the controls', () => {
  // arrange
  const model = MODEL();
  // act
  const v = mount(model);
  // assert
  assert.match(svg(v), /^<svg class="dfd map fit" viewBox="0 0 \d+ \d+" width="\d+" height="\d+" role="img" aria-label="Map: 6 boxes drawn, 5 flows drawn">/);
  assert.equal(count(svg(v), '<g class="mb grp'), 6);
  assert.match(svg(v), /<g class="mb grp sum" data-id="x:env" data-group="1"><title>Environment variables<\/title><rect [^>]*><text class="lb" [^>]*>Environm…ariables<\/text><text class="ct" [^>]*>2 folded<\/text><\/g>/);
  assert.match(svg(v), /<g class="me platform taint"><path d="M[^"]+" stroke-width="1.0" marker-end="url\(#map-a-t\)"\/><\/g>/);
  assert.match(svg(v), /<g class="me platform"><path d="M[^"]+" stroke-width="1.3" marker-end="url\(#map-a\)"\/><\/g>/);
  assert.match(svg(v), /<g class="mb grp sev-critical" data-id="g:api" data-group="1"><title>api<\/title>/);
  assert.match(svg(v), /<text class="lb" [^>]*>\+ api<\/text><text class="ct" [^>]*>3 elements · 80%<\/text><g class="bd sev-critical">.*?>2<\/text><\/g><circle class="tr"/);
  assert.match(svg(v), /<text class="ct" [^>]*>1 element<\/text>/);
  assert.equal(v.$('status').textContent, '6 boxes drawn (budget 150) · 0 groups open · 5 merged flows drawn');
  assert.match(v.$('tiles').innerHTML, /<b>7<\/b><span>code elements \(6 files, variables and programs folded into counts\)<\/span>.*<div class="tile live"><b>4<\/b><span>open issues: 1 critical, 1 medium, 1 low, 1 undetermined \(of 4\)<\/span>.*<b>80%<\/b><span>line coverage over 2 measured elements \(2 not measured\)/);
  assert.equal(count(v.$('issues').innerHTML, '<tr data-row data-node='), 4);
  assert.match(v.$('issues').innerHTML, /^<tr data-row data-node="api\/db.js"><td><span class="st is-open">open<\/span><\/td><td><span class="st sev-critical">critical<\/span><\/td><td class="m">F2<\/td><td>sql injection<\/td><td class="m">CWE-89<\/td><td>api\/db.js<\/td><td class="m"><\/td><td class="acts"><button type="button" class="btn" data-copy="F2">copy<\/button> <button type="button" class="btn fix" data-fix="F2">remediate<\/button><\/td><\/tr>/);
  assert.deepEqual([v.$('copy-all').hidden, v.$('fix-all').hidden], [false, false]);
  assert.match(v.$('panel').innerHTML, /Nothing selected/);
  assert.equal(v.$('hits').hidden, true);
  assert.deepEqual(v.doc.groups['#lens button'].map((b) => b.attrs['aria-pressed']), ['true', 'false', 'false', 'false']);
  assert.deepEqual(v.doc.groups['#opts input'].map((i) => i.checked), [false, false, true, true, true]);
});

test('selecting a closed group opens it in place; selecting its heading closes it; a miss clears the selection', () => {
  // arrange
  const v = mount();
  // act
  v.$('wrap').fire('click', on('[data-id]', { id: 'g:api', group: '1' }));
  const opened = { open: [...v.S.open], focus: v.S.focus, svg: svg(v), panel: v.$('panel').innerHTML };
  v.$('wrap').fire('click', on('[data-id]', { id: 'g:api', open: '1' }));
  const closed = { open: [...v.S.open], focus: v.S.focus };
  v.$('wrap').fire('click', miss);
  // assert
  assert.deepEqual([opened.open, opened.focus], [['g:api'], 'g:api']);
  assert.match(opened.svg, /<g class="mb open on" data-id="g:api" data-open="1"><rect [^>]*><text class="hd" [^>]*>− api · 3 · 2 issues<\/text><\/g>/);
  assert.match(opened.svg, /<g class="mb el cov-low|<g class="mb el sev-medium" data-id="api\/routes.js"><title>api\/routes.js<\/title>/);
  assert.match(opened.svg, /<text class="lb" [^>]*>routes.js<\/text>/);
  assert.match(opened.panel, /<h3>api<\/h3><p class="sub">3 elements, 1 folded · on a traced flow · 80% of 20 lines covered<\/p><p><button type="button" class="btn" data-act="toggle">close<\/button> <button type="button" class="btn" data-act="pin" aria-pressed="false">pin open<\/button>/);
  assert.match(opened.panel, /<h4>Inside<\/h4><ul class="cols3"><li><button type="button" class="lk" data-go="g:core">core<\/button> <span class="st sev-high">2<\/span><\/li>/);
  assert.deepEqual([closed.open, closed.focus, v.S.focus], [[], 'g:api', null]);
});

test('selecting an element shows what it touches, with coverage bars and the flows of the selection drawn', () => {
  // arrange
  const v = mount();
  v.core.expand('g:core');
  // act
  v.$('wrap').fire('click', on('[data-id]', { id: 'api/routes.js' }));
  // assert
  const p = v.$('panel').innerHTML;
  assert.match(p, /<h3>api\/routes.js<\/h3><p class="sub">api · process · on a traced flow · 60% of 10 lines covered<\/p>/);
  assert.match(p, /<h4>Issues <span class="st sev-medium">1 medium<\/span><\/h4><ul><li><span class="st sev-medium">medium<\/span> <span class="m">F1<\/span>  <button type="button" class="btn" data-copy="F1">copy<\/button> <button type="button" class="btn fix" data-fix="F1">remediate<\/button><\/li><\/ul>/);
  assert.match(p, /<h4>Flows with 3 elements<\/h4><ul><li><button type="button" class="lk" data-go="api\/db.js">api\/db.js<\/button> ×2<\/li><li><button type="button" class="lk" data-go="req">request<\/button><\/li>/);
  assert.match(p, /<h4>file: 3<\/h4><ul class="cols3"><li><button type="button" class="lk" data-go="cache.json">cache.json<\/button><\/li>/);
  assert.match(svg(v), /<g class="mb el sev-medium on" data-id="api\/routes.js">/);
  assert.match(svg(v), /<rect class="cv-fill low" [^>]*width="92.4" height="3"\/>/);
  assert.match(svg(v), /<rect class="cv-fill" [^>]*width="154.0" height="3"\/>/);
  assert.match(svg(v), /<g class="me detail taint hot"><path [^>]*\/><text [^>]*text-anchor="middle">×2<\/text><\/g>/);
  assert.match(svg(v), /<g class="me detail hot"><path /);
  assert.equal(svg(v).startsWith('<svg class="dfd map" '), true);
  assert.match(v.$('status').textContent, /2 groups open · \d+ merged flows drawn, 2 inside open groups not drawn \(select a box, or tick "all flows"\)$/);
});

test('an issue row opens the map at its element and scrolls to it; a click between rows does nothing', () => {
  // arrange
  const v = mount();
  // act
  v.$('issues').fire('click', miss);
  const before = [...v.S.open];
  v.$('issues').fire('click', on('tr[data-node]', { node: 'api/db.js' }));
  // assert
  assert.deepEqual(before, []);
  assert.deepEqual([v.S.open, v.S.focus, v.$('wrap').scrolled], [['g:api', 'g:core'], 'api/db.js', 1]);
  assert.match(v.$('panel').innerHTML, /<h3>api\/db.js<\/h3><p class="sub">api › core · process · on a traced flow · 100% of 10 lines covered<\/p>/);
});

test('the panel\'s links reveal an element; its buttons close and pin the selected group', () => {
  // arrange
  const v = mount();
  v.$('wrap').fire('click', on('[data-id]', { id: 'g:api', group: '1' }));
  // act
  v.$('panel').fire('click', on('[data-act]', { act: 'pin' }));
  const pinned = [v.core.S.pinned.has('g:api'), /aria-pressed="true">unpin</.test(v.$('panel').innerHTML)];
  v.$('panel').fire('click', on('[data-act]', { act: 'toggle' }));
  const closed = [...v.S.open];
  v.$('panel').fire('click', miss);
  v.$('panel').fire('click', on('[data-go]', { go: 'DB_URL' }));
  // assert
  assert.deepEqual([pinned, closed, v.S.focus], [[true, true], [], 'DB_URL']);
  assert.match(v.$('panel').innerHTML, /<h3>DB_URL<\/h3><p class="sub">Environment variables · env · nothing to cover<\/p><h4>Used by 1 element<\/h4><ul><li><button type="button" class="lk" data-go="api\/db.js">api\/db.js<\/button><\/li><\/ul>/);
});

test('search lists matches as it is typed, says when there are none, and a chosen match is revealed and the box cleared', () => {
  // arrange
  const v = mount();
  // act
  v.$('q').fire('input', { target: { value: 'db' } });
  const some = [v.$('hits').hidden, count(v.$('hits').innerHTML, '<li>')];
  v.$('q').fire('input', { target: { value: 'zzz' } });
  const none = v.$('hits').innerHTML;
  v.$('q').value = 'db';
  v.$('hits').fire('click', miss);
  const kept = v.$('q').value;
  v.$('hits').fire('click', on('[data-go]', { go: 'web/page.js' }));
  // assert
  assert.deepEqual(some, [false, 3]);
  assert.match(none, /No element, group or issue matches/);
  assert.deepEqual([kept, v.$('q').value, v.$('hits').hidden, v.S.focus, v.S.open], ['db', '', true, 'web/page.js', ['g:web']]);
  assert.match(v.$('panel').innerHTML, /<p class="sub">a note<\/p>/);
  assert.match(v.$('panel').innerHTML, /coverage not measured/);
});

test('the lens recolours the boxes; the tickboxes draw every flow, the leaves, and the counts', () => {
  // arrange
  const v = mount();
  v.core.expand('g:core');
  const tick = (opt, checked) => v.$('opts').fire('change', { target: { dataset: { opt }, checked } });
  // act
  v.$('lens').fire('click', on('button', { lens: 'coverage' }));
  const cov = svg(v);
  v.$('lens').fire('click', miss);
  tick('edges', true);
  const all = [v.S.edges, v.$('status').textContent];
  tick('labels', false);
  const unlabelled = svg(v);
  tick('edges', false);
  tick('leaves', true);
  // assert
  assert.equal(v.S.lens, 'coverage');
  assert.match(cov, /<g class="mb el cov-low" data-id="api\/routes.js">/);
  assert.match(cov, /<g class="mb grp cov-none" data-id="g:web"/);
  assert.match(cov, /<rect class="cv-none" /);
  assert.deepEqual(v.doc.groups['#lens button'].map((b) => b.attrs['aria-pressed']), ['false', 'true', 'false', 'false']);
  assert.equal(all[0], 'all');
  assert.match(all[1], /8 merged flows drawn$/);
  assert.equal(unlabelled.includes('×2'), false);
  assert.deepEqual([v.S.edges, v.S.leaves, v.S.labels], ['focus', true, false]);
  assert.match(svg(v), /<text class="lb" [^>]*>\+ Environm…ariables<\/text><text class="ct" [^>]*>2 elements<\/text>/);
  assert.match(svg(v), /<text class="ct" [^>]*>3 elements<\/text>/);
  assert.deepEqual(v.doc.groups['#opts input'].map((i) => i.checked), [false, true, false, true, true]);
});

test('a "more" box draws the next page, and "close every group" returns to the closed map', () => {
  // arrange
  const nodes = Array.from({ length: 70 }, (_, i) => ({ id: `w/m${String(i).padStart(2, '0')}.js`, kind: 'process', label: `w/m${String(i).padStart(2, '0')}.js`, group: 'w' }));
  const v = mount({ v: 1, kind: 'dfd', groups: [{ id: 'w', label: 'w', boundary: 'system' }], nodes, flows: [] });
  v.$('wrap').fire('click', on('[data-id]', { id: 'g:w', group: '1' }));
  // act
  const first = svg(v);
  v.$('wrap').fire('click', on('[data-id]', { id: 'more:g:w', more: '1' }));
  const second = svg(v);
  v.$('close-all').fire('click');
  // assert
  assert.match(first, /<g class="mb more" data-id="more:g:w" data-more="1"><rect [^>]*><text [^>]*>\+ 10 more<\/text><\/g>/);
  assert.equal(second.includes('more:g:w'), false);
  assert.equal(count(second, '<g class="mb el'), 70);
  assert.deepEqual([v.S.open, v.S.focus], [[], null]);
  assert.match(v.$('tiles').innerHTML, /<div class="tile"><b>0<\/b><span>open issues \(of 0\)<\/span><\/div><div class="tile"><b>n\/a<\/b>/);
  assert.match(v.$('issues').innerHTML, /The document carries no issues/);
  assert.equal(v.$('status').textContent, '1 boxes drawn (budget 150) · 0 groups open · 0 merged flows drawn');
  assert.deepEqual([v.$('copy-all').hidden, v.$('fix-all').hidden], [true, true]);
});

test('text from the document is escaped wherever it lands, both quote characters included', () => {
  // arrange
  const model = MODEL();
  model.nodes[0].label = `x<y & "q" 'r'.js`;
  model.findings[0].title = `<b>bold</b> 'p'`;
  // act
  const v = mount(model);
  v.$('issues').fire('click', on('tr[data-node]', { node: 'api/routes.js' }));
  // assert
  for (const text of [svg(v), v.$('panel').innerHTML, v.$('issues').innerHTML]) { assert.equal(text.includes('x<y'), false); assert.equal(text.includes('<b>bold'), false); }
  assert.match(v.$('panel').innerHTML, /<h3>x&lt;y &amp; &quot;q&quot; &#39;r&#39;.js<\/h3>/);
  assert.match(v.$('issues').innerHTML, /&lt;b&gt;bold&lt;\/b&gt; &#39;p&#39;/);
});

test('an element no flow touches says so; a group with one open group reads in the singular', () => {
  // arrange
  const v = mount({ v: 1, kind: 'dfd', groups: [{ id: 'g', label: 'g', boundary: 'system' }], nodes: [{ id: 'a', kind: 'process', label: 'a', group: 'g' }], flows: [] });
  // act
  v.$('wrap').fire('click', on('[data-id]', { id: 'g:g', group: '1' }));
  const status = v.$('status').textContent;
  const head = svg(v);
  v.$('wrap').fire('click', on('[data-id]', { id: 'a' }));
  // assert
  assert.match(status, /1 group open/);
  assert.match(head, /− g · 1<\/text>/);
  assert.match(v.$('panel').innerHTML, /No flow in the document touches it\./);
});

test('copy puts one issue on the clipboard and says so; from the panel too; a row\'s buttons do not also open the map', async () => {
  // arrange
  const v = mount();
  // act
  v.$('issues').fire('click', on('[data-copy]', { copy: 'F2' }));
  await settle();
  const first = [v.copied.length, v.copied[0], v.$('copied').textContent, [...v.S.open]];
  v.$('wrap').fire('click', on('[data-id]', { id: 'g:api', group: '1' }));
  v.$('panel').fire('click', on('[data-copy]', { copy: 'F1' }));
  await settle();
  // assert
  assert.deepEqual(first, [1, v.core.issueText('F2'), 'Copied F2.', []]);
  assert.deepEqual([v.copied[1], v.$('copied').textContent, v.copied.length], [v.core.issueText('F1'), 'Copied F1.', 2]);
});

test('remediate writes the brief for one issue into the page; "for all" writes it for every issue; the brief copies and closes', async () => {
  // arrange
  const v = mount();
  v.$('brief').hidden = true;
  // act
  v.$('issues').fire('click', on('[data-fix]', { fix: 'F2' }));
  const one = [v.$('brief').hidden, v.$('brief-title').textContent, v.$('brief-text').value, v.$('brief').scrolled, [...v.S.open]];
  v.$('fix-all').fire('click');
  const all = [v.$('brief-title').textContent, v.$('brief-text').value];
  v.$('brief-text').value = 'edited by hand';
  v.$('brief-copy').fire('click');
  await settle();
  const copied = [v.copied[0], v.$('copied').textContent];
  v.$('brief-close').fire('click');
  // assert
  assert.deepEqual(one, [false, 'Remediation brief for F2', v.core.remediationPrompt(['F2']), 1, []]);
  assert.deepEqual(all, ['Remediation brief for the 4 issues not closed', v.core.remediationPrompt()]);
  assert.deepEqual(copied, ['edited by hand', 'Copied the brief.']);
  assert.equal(v.$('brief').hidden, true);
});

test('"copy all issues" copies every issue, worst first; a copy that fails says so and leaves the text in the brief', async () => {
  // arrange
  const ok = mount();
  const failing = mount(MODEL(), { copies: false });
  failing.$('brief').hidden = true;
  // act
  ok.$('copy-all').fire('click');
  failing.$('issues').fire('click', on('[data-copy]', { copy: 'F2' }));
  await settle();
  // assert
  assert.equal(ok.copied[0], ['F2', 'F1', 'F4', 'F3'].map((id) => ok.core.issueText(id)).join('\n\n'));
  assert.equal(ok.$('copied').textContent, 'Copied 4 issues.');
  assert.equal(failing.$('copied').textContent, 'Could not copy F2: it is in the brief below, select it and copy it by hand.');
  assert.deepEqual([failing.$('brief').hidden, failing.$('brief-title').textContent, failing.$('brief-text').value], [false, 'F2', failing.core.issueText('F2')]);
});

test('copyText uses the clipboard where there is one, and otherwise selects the text and asks the document to copy', async () => {
  // arrange
  const field = () => ({ value: '', selected: 0, select() { this.selected += 1; } });
  const doc = (answer) => ({ asked: [], execCommand(c) { this.asked.push(c); if (answer instanceof Error) throw answer; return answer; } });
  const written = [];
  const a = field(); const b = field(); const c = field(); const d = field(); const e = field();
  const yes = doc(true); const no = doc(false); const throws = doc(new Error('denied')); const fallback = doc(true);
  // act
  const got = [
    await copyText(doc(true), { writeText: (t) => { written.push(t); return Promise.resolve(); } }, a, 'one'),
    await copyText(fallback, { writeText: () => Promise.reject(new Error('not focused')) }, b, 'two'),
    await copyText(yes, null, c, 'three'),
    await copyText(no, {}, d, 'four'),
    await copyText(throws, undefined, e, 'five'),
  ];
  // assert
  assert.deepEqual(got, [true, true, true, false, false]);
  assert.deepEqual([written, a.selected, a.value], [['one'], 0, '']);
  assert.deepEqual([b.value, b.selected, fallback.asked], ['two', 1, ['copy']]);
  assert.deepEqual([c.value, c.selected, yes.asked, d.value, e.selected], ['three', 1, ['copy'], 'four', 1]);
});

test('mounted without an environment, copy goes through the page\'s own clipboard path', async () => {
  // arrange
  const doc = fakeDocument(MODEL());
  doc.execCommand = () => true;
  doc.getElementById('brief-text').select = () => {};
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true });
  // act
  let ok;
  try { ok = await mountMapView(doc, createMapCore).copyAnd('text', 'it'); } finally { if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator; }
  // assert
  assert.equal(ok, true);
  assert.deepEqual([doc.getElementById('brief-text').value, doc.getElementById('copied').textContent], ['text', 'Copied it.']);
});

test('rulings show on the map: pills for thin and closed, state and axes in the table, the reason on hover and in the panel', () => {
  // arrange
  const model = MODEL();
  const f = Object.fromEntries(model.findings.map((x) => [x.id, x]));
  f.F2.status = 'mitigated'; f.F2.note = 'Fixed: parameterised.';
  f.F1.status = 'dismissed'; f.F1.note = 'Not a defect: "route" name.'; f.F1.controls = [{ axis: 'sink', what: 'bound', test: 't' }, { axis: 'source', what: 'allowlist' }];
  f.F3.status = 'dismissed'; f.F3.controls = [{ axis: 'sink', what: 'escaped', test: 'a' }, { axis: 'transport', what: 'verified', test: 'b' }];
  // act
  const v = mount(model);
  v.$('fix-all').fire('click');
  const title = v.$('brief-title').textContent;
  const closed = svg(v);
  v.$('wrap').fire('click', on('[data-id]', { id: 'g:api', group: '1' }));
  // assert
  assert.match(v.$('tiles').innerHTML, /<div class="tile live"><b>1<\/b><span>open issues: 1 low \(of 4\)<\/span><\/div><div class="tile grey"><b>1<\/b><span>judged not a defect on fewer than two tested axes: not closed<\/span><\/div><div class="tile closed"><b>2<\/b><span>closed: 1 fixed \(not rescanned\), 1 held on two or more axes<\/span><\/div>/);
  const rows = v.$('issues').innerHTML.split('</tr>').filter(Boolean);
  assert.deepEqual(rows.map((r) => [/class="st is-(\w+)"/.exec(r)[1], /<td class="m">(F\d)</.exec(r)[1], /<td class="m">([^<]*)<\/td><td class="acts">/.exec(r)[1]]), [['open', 'F4', ''], ['thin', 'F1', '1/2'], ['held', 'F3', '2/2'], ['fixed', 'F2', '']]);
  assert.match(rows[1], /^<tr data-row data-node="api\/routes.js" title="Not a defect: &quot;route&quot; name."><td><span class="st is-thin">dismissed, under two axes<\/span>/);
  assert.equal(title, 'Remediation brief for the 2 issues not closed');
  assert.match(v.$('panel').innerHTML, /<li><span class="st is-thin">dismissed, under two axes<\/span> <span class="st sev-medium">medium<\/span> <span class="m">F1<\/span>[\s\S]*?<br><span class="sub">Not a defect: &quot;route&quot; name.<\/span><\/li><li><span class="st is-fixed">fixed, not rescanned<\/span>/);
  assert.match(closed, /<g class="mb grp thin" data-id="g:api"[\s\S]*?<g class="bd thin"><rect x="(\d+)"[^>]*\/><text [^>]*>1<\/text><\/g><g class="bd done"><rect x="(\d+)"[^>]*\/><text [^>]*>1<\/text><\/g>/);
  assert.match(closed, /<g class="mb grp done" data-id="g:web"[\s\S]*?<g class="bd done">/);
  assert.match(closed, /<g class="mb grp sev-low" data-id="x:code"[\s\S]*?<g class="bd sev-low">/);
  const [, thinX, doneX] = /<g class="mb grp thin" data-id="g:api"[\s\S]*?<g class="bd thin"><rect x="(\d+)"[\s\S]*?<g class="bd done"><rect x="(\d+)"/.exec(closed);
  assert.equal(Number(thinX) - Number(doneX), 30);
});

test('pills sit side by side when a box holds open, thin and closed issues together', () => {
  // arrange
  const model = MODEL();
  const f = Object.fromEntries(model.findings.map((x) => [x.id, x]));
  f.F1.status = 'dismissed';
  model.findings.push({ id: 'F5', at: { node: 'api/db.js' }, status: 'mitigated', severity: 'high' });
  // act
  const v = mount(model);
  // assert: api holds F2 (open), F1 (thin), F5 (fixed)
  const m = /data-id="g:api"[\s\S]*?<g class="bd sev-critical"><rect x="(\d+)"[\s\S]*?<g class="bd thin"><rect x="(\d+)"[\s\S]*?<g class="bd done"><rect x="(\d+)"/.exec(svg(v));
  assert.deepEqual([Number(m[1]) - Number(m[2]), Number(m[2]) - Number(m[3])], [30, 30]);
});

const withPrs = () => {
  const model = MODEL();
  const f = Object.fromEntries(model.findings.map((x) => [x.id, x]));
  model.prs = [{ id: '#7', title: 'bind <the> query', state: 'merged', files: ['api/db.js'] }, { id: '#9', title: 'route control' }];
  f.F2.status = 'mitigated'; f.F2.pr = '#7';
  f.F1.status = 'dismissed'; f.F1.pr = '#9';
  return model;
};
const pb = (v, act) => v.$('play-bar').fire('click', on('[data-pb]', { pb: act }));
const openCount = (v) => Number(/<b>(\d+)<\/b><span>open issues/.exec(v.$('tiles').innerHTML)[1]);

test('with no pull requests the playback bar stays hidden; with some it opens on the last step', () => {
  // arrange
  const plain = mount();
  // act
  const v = mount(withPrs());
  // assert
  assert.equal(plain.$('play-bar').hidden, true);
  assert.deepEqual([v.$('play-bar').hidden, v.$('pb-scrub').max, v.$('pb-scrub').value, v.$('pb-play').textContent, openCount(v)], [false, 2, 2, '▶ play', 2]);
  assert.match(v.$('pb-out').innerHTML, /^<b>2 of 2<\/b> · <span class="m">#9<\/span> route control<br><span class="sub">rules on F1 · touches 2 elements on the map<\/span>$/);
});

test('stepping lands one pull request at a time: tiles, table and the ring on what it touched follow', () => {
  // arrange
  const v = mount(withPrs());
  // act
  pb(v, 'first');
  const zero = [v.core.stepInfo().step, openCount(v), v.$('pb-out').innerHTML, svg(v).includes(' chg')];
  pb(v, 'next');
  const one = [v.core.stepInfo().step, openCount(v), v.$('pb-out').innerHTML, v.$('issues').innerHTML.includes('class="st is-fixed"')];
  const ringed = /<g class="mb open chg" data-id="g:api" data-open="1">/.test(svg(v)) && /<g class="mb open chg" data-id="g:core" data-open="1">/.test(svg(v)) && /<g class="mb el [^"]*chg[^"]*" data-id="api\/db.js">/.test(svg(v));
  pb(v, 'last'); pb(v, 'prev');
  const back = v.core.stepInfo().step;
  v.$('pb-scrub').fire('input', { target: { value: '2' } });
  v.$('play-bar').fire('click', miss);
  // assert
  assert.deepEqual(zero.slice(0, 2), [0, 4]);
  assert.equal(zero[2], '<b>0 of 2</b> · the original position, before any pull request: every issue as the scanner left it');
  assert.equal(zero[3], false);
  assert.deepEqual([one[0], one[1], one[3], ringed], [1, 3, true, true]);
  assert.match(one[2], /<span class="m">#7<\/span> <span class="st">merged<\/span> bind &lt;the&gt; query<br><span class="sub">fixes F2 · touches 1 element on the map \(1 file changed\)<\/span>/);
  assert.deepEqual([back, v.core.stepInfo().step], [1, 2]);
});

test('an open group that the step touched is ringed too', () => {
  // arrange
  const v = mount(withPrs());
  v.core.expand('g:core');
  // act
  v.goStep(1);
  // assert
  assert.match(svg(v), /<g class="mb open chg" data-id="g:api" data-open="1">/);
  assert.match(svg(v), /<g class="mb el [^"]*chg[^"]*" data-id="api\/db.js">/);
});

test('play runs from the start when at the end, steps on a timer, stops itself at the last step, and pauses on request', () => {
  // arrange
  const v = mount(withPrs());
  v.$('pb-speed').value = '700';
  // act
  pb(v, 'play');
  const started = [v.core.stepInfo().step, v.$('pb-play').textContent, v.timers.ms[0]];
  v.timers.fns[0]();
  const mid = [v.core.stepInfo().step, v.$('pb-play').textContent, v.timers.fns.length];
  v.timers.fns[1]();
  const end = [v.core.stepInfo().step, v.$('pb-play').textContent, v.timers.fns.length];
  v.timers.fns[1]();
  const idle = [v.core.stepInfo().step, v.timers.cleared];
  pb(v, 'first'); pb(v, 'play');
  v.$('pb-speed').value = '';
  pb(v, 'play');
  const paused = [v.$('pb-play').textContent, v.timers.cleared];
  pb(v, 'play'); pb(v, 'next');
  // assert
  assert.deepEqual(started, [0, '❚❚ pause', 700]);
  assert.deepEqual(mid, [1, '❚❚ pause', 2]);
  assert.deepEqual(end, [2, '▶ play', 2]);
  assert.deepEqual(idle, [2, 0]);
  assert.deepEqual(paused, ['▶ play', 1]);
  assert.deepEqual([v.timers.ms[v.timers.ms.length - 1], v.timers.cleared, v.core.stepInfo().step, v.$('pb-play').textContent], [1500, 2, 1, '▶ play']);
});

test('mounted without injected timers, play uses the page\'s own', () => {
  // arrange
  const doc = fakeDocument(withPrs());
  const view = mountMapView(doc, createMapCore, { copy: () => Promise.resolve(true) });
  // act
  doc.getElementById('play-bar').fire('click', on('[data-pb]', { pb: 'play' }));
  const playing = doc.getElementById('pb-play').textContent;
  doc.getElementById('play-bar').fire('click', on('[data-pb]', { pb: 'play' }));
  // assert
  assert.deepEqual([playing, doc.getElementById('pb-play').textContent, view.core.stepInfo().step], ['❚❚ pause', '▶ play', 0]);
});

test('a document that plays back patches says so on the bar', () => {
  // arrange
  const model = MODEL();
  model.patches = [{ id: 'K1', title: 'bind', findings: ['F2'], closes: [{ from: 'api/db.js', to: 'orders.db' }] }];
  model.findings[0].status = 'mitigated';
  // act
  const v = mount(model);
  pb(v, 'first');
  // assert
  assert.equal(v.$('pb-out').innerHTML, '<b>0 of 1</b> · the original position, before any change set: every issue as the scanner left it');
  pb(v, 'next');
  assert.match(v.$('pb-out').innerHTML, /<span class="m">patches with no commit or file recorded<\/span> <br><span class="sub">1 patch: K1 · fixes F2 · touches 2 elements on the map<\/span>/);
});

test('the follow tickbox: off, a step rings closed groups and opens nothing; on again, it opens what the step touched', () => {
  // arrange
  const v = mount(withPrs());
  const tick = (checked) => v.$('opts').fire('change', { target: { dataset: { opt: 'follow' }, checked } });
  pb(v, 'first'); pb(v, 'next');
  const followed = [...v.S.open];
  // act
  tick(false);
  const off = [[...v.S.open], /<g class="mb grp [^"]*chg[^"]*" data-id="g:api"/.test(svg(v))];
  tick(true);
  // assert
  assert.deepEqual(followed, ['g:api', 'g:core']);
  assert.deepEqual(off, [[], true]);
  assert.deepEqual([...v.S.open], ['g:api', 'g:core']);
});

test('the plain account says how many hazards there are, what the step dealt with and how we know, and what is still open', () => {
  // arrange
  const model = withPrs();
  model.patches = [{ id: 'K1', pr: '#7', title: 'bind the query', note: 'The value is bound, not pasted in.', findings: ['F2'], closes: [{ from: 'api/db.js', to: 'orders.db' }], evidence: { level: 'tested' } }];
  model.findings.push({ id: 'F2@web', title: 'same query, <web> copy', at: { node: 'web/page.js' } });
  const v = mount(model);
  // act
  const end = v.$('story').innerHTML;
  pb(v, 'first');
  const zero = v.$('story').innerHTML;
  pb(v, 'next');
  const one = v.$('story').innerHTML;
  pb(v, 'next');
  const two = v.$('story').innerHTML;
  // assert
  assert.match(end, /^<h2>What is going on<\/h2><p class="lead"><b>5<\/b> hazards were found\. <b class="ok">1<\/b> dealt with, <b class="bad">3<\/b> still open, <b class="thin">1<\/b> judged harmless on too little evidence to close\.<\/p><svg class="meter" viewBox="0 0 100 4" preserveAspectRatio="none" role="img" aria-label="1 dealt with, 1 not closed, 3 open"><rect class="ok" x="0" y="0" width="20" height="4"\/><rect class="thin" x="20" y="0" width="20" height="4"\/><rect class="bad" x="40" y="0" width="60" height="4"\/><\/svg>/);
  assert.equal(/style=/.test(end + zero + one + two), false);
  assert.match(zero, /<b class="ok">0<\/b> dealt with, <b class="bad">5<\/b> still open\.<\/p>/);
  assert.match(zero, /<h3>Step 0 of 2: the starting position<\/h3><p>Nothing has been changed yet\. Every hazard is as it was found\.<\/p><h3>Still open after this step: 5<\/h3>/);
  assert.match(one, /<h3>Step 1 of 2: bind &lt;the&gt; query<\/h3><p>This change dealt with 1 hazard:<\/p><ul><li><b>F2<\/b> sql injection, in api\/db\.js\. Reached from request or DB_URL\. Worst outcome: <b>orders\.db<\/b> \(serious\)\. <span class="now fixed">Now: fixed, proved by a test\.<\/span><br><span class="sub">What was changed: bind the query: The value is bound, not pasted in\.<\/span><\/li><\/ul>/);
  assert.match(one, /<p>The same weakness also sits where this change does not reach, and stays open there:<\/p><ul><li><b>F2@web<\/b> same query, &lt;web&gt; copy, in web\/page\.js\. Worst outcome: <b>orders\.db<\/b> \(serious\)\.<\/li><\/ul>/);
  assert.match(two, /<h3>Step 2 of 2: route control<\/h3><p>This change dealt with 1 hazard:<\/p><ul><li><b>F1<\/b>, in api\/routes\.js\. Reached from request or DB_URL\. Worst outcome: <b>orders\.db<\/b> \(serious\)\. <span class="now thin">Now: not closed, judged not a defect, but on 0 tested safeguards: not closed\.<\/span><\/li><\/ul>/);
  assert.match(two, /<h3>Still open after this step: 4<\/h3><ul><li><b>F1<\/b>[^<]*<b>orders\.db<\/b> \(serious\)\. <span class="now thin">Judged not a defect, but on 0 tested safeguards: not closed\.<\/span><\/li>/);
  assert.match(two, /<li><b>F4<\/b>, in loose\.js\. No route from it to a named harm is drawn\. <span class="now open">Nobody has ruled on it\.<\/span><\/li>/);
});

test('the plain account without playback lists what is open; with nothing recorded, or nothing left, it says so; the tickbox hides it', () => {
  // arrange
  const plain = mount();
  const empty = mount({ v: 1, kind: 'dfd', nodes: [{ id: 'a', kind: 'process', label: 'a' }], flows: [] });
  const done = MODEL(); done.findings = [{ id: 'F2', at: { node: 'api/db.js' }, status: 'mitigated', note: 'Fixed in review.' }]; done.prs = [{ id: '#1', title: 'one' }, { id: '#2' }]; done.findings[0].pr = '#1';
  const closed = mount(done);
  const many = MODEL(); many.findings = Array.from({ length: 10 }, (_, i) => ({ id: `H${i}`, at: { node: 'api/db.js' } }));
  // act
  pb(closed, 'first'); pb(closed, 'next');
  const one = closed.$('story').innerHTML;
  pb(closed, 'next');
  plain.$('opts').fire('change', { target: { dataset: { opt: 'story' }, checked: false } });
  // assert
  assert.match(mount().$('story').innerHTML, /<b>4<\/b> hazards were found\. <b class="ok">0<\/b> dealt with, <b class="bad">4<\/b> still open\.<\/p>.*<h3>Still open: 4<\/h3><ul><li><b>F2<\/b> sql injection, in api\/db\.js\./);
  assert.equal(empty.$('story').innerHTML, '<h2>What is going on</h2><p class="lead">No hazard is recorded in this document.</p>');
  assert.match(one, /<b>1<\/b> hazard was found\. <b class="ok">1<\/b> dealt with, <b class="bad">0<\/b> still open\.<\/p>.*<span class="now fixed">Now: fixed, fix reported, not rescanned\.<\/span><br><span class="sub">Fixed in review\.<\/span><\/li><\/ul><h3>Nothing is left open\.<\/h3>$/);
  assert.match(closed.$('story').innerHTML, /<h3>Step 2 of 2: #2<\/h3><p>This change closed no hazard\. The ringed boxes on the map are what it touched\.<\/p>/);
  assert.match(mount(many).$('story').innerHTML, /<li class="sub">and 2 more, in the table below<\/li><\/ul>$/);
  assert.equal(plain.$('story').hidden, true);
});

