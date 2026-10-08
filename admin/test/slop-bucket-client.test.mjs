// fact: this exercises the panel's OWN client functions against a DOM, not the route / every test written for the Slop Bucket passed while the client was dead — they all asked the server (expiry: never, prev: broken)
// fact: the defect it was written for: element ids held the suggestion id, which contains / . and # / getElementById takes a raw id and CSS.escape produces a selector token, so no tick box ever read back as checked and Accept could not enable (expiry: never, prev: broken)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { panelSource } from './lib/panel-source.mjs';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PANEL = panelSource('index.html');
// fact: the client functions live in static/comments.js since the extraction / reading them from index.html would find nothing and every fn() lookup would fail loudly rather than silently (expiry: if the module moves, prev: not built)
const MODULE = readFileSync(join(HERE, '..', 'static', 'comments.js'), 'utf8');

/** Pull one top-level function out of the panel script by name, with its body. */
function fn(name) {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal name or class taken from the test itself
  const re = new RegExp(`(?:^|\\n)((?:async )?function ${name}\\([\\s\\S]*?\\n\\})`, 'm');
  const m = MODULE.match(re);
  assert.ok(m, `${name}() not found in index.html — the extractor and the panel have drifted`);
  return m[1];
}

/**
 * A DOM small enough to be honest: elements really hold children, querySelector really searches
 * them, and innerHTML really parses the subset this renderer emits. A shim that returned null for
 * every lookup would have passed the broken code too.
 */
function makeDom() {
  // Tag, .class and [attr=value] — the selector subset the client uses against a row.
  const matches = (el, sel) => {
    const m = /^(\w+)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/.exec(sel.trim());
    if (!m) return false;
    if (m[1] && el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
    const cls = String(el.attrs.class || '').split(/\s+/);
    if (m[2].split('.').filter(Boolean).some((c) => !cls.includes(c))) return false;
    for (const a of m[3].matchAll(/\[([\w-]+)(?:=([^\]]+))?\]/g)) {
      if (el.attrs[a[1]] === undefined) return false;
      if (a[2] !== undefined && el.attrs[a[1]] !== a[2].replace(/^["']|["']$/g, '')) return false;
    }
    return true;
  };
  const parse = (html) => {
    const nodes = [];
    const re = /<(\w+)([^>]*?)>/g;
    let m;
    while ((m = re.exec(html))) {
      const attrs = {};
      for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
      nodes.push({ tag: m[1].toLowerCase(), attrs });
    }
    return nodes;
  };
  const mkEl = (tag, attrs = {}) => {
    const el = {
      tagName: tag.toUpperCase(), attrs, children: [], value: attrs.value || '',
      checked: false, disabled: false, textContent: '', _html: '',
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener(ev, h) { (this._on ||= {})[ev] = h; },
      dispatch(ev) { this._on && this._on[ev] && this._on[ev](); },
      getAttribute(k) { return this.attrs[k] ?? null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      removeAttribute(k) { delete this.attrs[k]; },
      get dataset() {
        return Object.fromEntries(Object.entries(this.attrs).filter(([k]) => k.startsWith('data-'))
          .map(([k, v]) => [k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase()), v]));
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) { return this.children.filter((c) => matches(c, sel)); },
      set innerHTML(v) {
        this._html = String(v);
        this.children = [];
        // Split on the row wrapper so each row owns only the controls inside ITS OWN markup.
        // The first shim gave every row the container's whole child list, so two rows shared one
        // checkbox and the selection count came back 2 for a single tick — a shim defect that would
        // have hidden a real one.
        const parts = this._html.split('<div class="card" id="cmt-row-').slice(1);
        parts.forEach((seg) => {
          const [own, ...inner] = parse(`<div class="card" id="cmt-row-${seg}`);
          const rowId = own.attrs.id;
          const row = mkEl('div', own.attrs);
          row.children = inner.map((n) => mkEl(n.tag, n.attrs));
          store.set(rowId, row);
          this.children.push(row);
        });
      },
      get innerHTML() { return this._html; },
    };
    return el;
  };
  const store = new Map();
  for (const id of ['cmt-rows', 'cmt-all', 'cmt-narr', 'cmt-accept', 'cmt-sel', 'cmt-n', 'cmt-warn', 'cmt-note']) {
    store.set(id, mkEl('div', { id }));
  }
  return {
    store,
    document: {
      getElementById: (i) => store.get(i) || null,
      querySelectorAll: () => [],
      createElement: (t) => mkEl(t),
      addEventListener() {},
    },
  };
}

const SUGGESTIONS = [
  { id: 'monitor/rollup.mjs#21', key: 'k21', file: 'monitor/rollup.mjs', ordinal: 21, kind: 'narrative', confidence: 'medium', before: ['    // old'], startLine: 700, lines: 9, saved: 8, keptCount: 1, droppedCount: 2, dropped: ['a', 'b'],
    after: ['    // fact: x / y (expiry: never, prev: wrong)'], diff: '--- a/x\n+++ b/x\n@@ -1,9 +1,1 @@\n-old\n+new',
    second: { lines: ['    // fact: x'], fired: ['emphasis-caps'] },
    original: [{ mark: '//', segs: [{ t: 'Kept whole. ', f1: 'kept', f2: 'reworded' }, { t: 'Gone.', f1: 'dropped', f2: 'dropped' }] },
      { mark: '//', segs: [{ t: 'Tail.', f1: 'dropped', f2: 'dropped' }] }],
    tally: { f1: { kept: 1, dropped: 1 }, f2: { reworded: 1, dropped: 1 } } },
  { id: 'admin/serve.mjs#3', key: 'k3', file: 'admin/serve.mjs', ordinal: 3, kind: 'narrative', confidence: 'low', startLine: 40, lines: 8, saved: 7, keptCount: 0, droppedCount: 1, dropped: ['c'], after: ['// fact: p / q (expiry: never, prev: unknown)'], diff: '--- a/y\n+++ b/y\n@@ -1,8 +1,1 @@\n-old\n+new' },
];

/** Boot just the Slop Bucket client functions against the DOM, with fetch and the reload stubbed. */
function boot({ items = SUGGESTIONS, reply = null } = {}) {
  const dom = makeDom();
  const cmt = structuredClone(items);
  const calls = { fetch: [], reload: [] };
  const src = ['cmtEsc', 'cmtShown', 'cmtRow', 'cmtBox', 'cmtBody', 'cmtText', 'cmtSel', 'cmtGain', 'cmtSync',
    'cmtNeeds', 'cmtLine', 'cmtOrig', 'cmtFlow', 'cmtEdit', 'cmtLoss', 'cmtCard', 'cmtKeep', 'cmtFit', 'cmtRender',
    'cmtPick', 'cmtSay', 'cmtSave'].map(fn).join('\n');
  const fetch = async (url, init) => { calls.fetch.push({ url, body: JSON.parse(init.body) }); return { status: 200, json: async () => reply }; };
  const f = new Function('document', 'CMT', 'CSS', 'fetch', 'csrf', 'cmtSummary', 'loadComments',
    `const CMT_UI = new Map(); let CMT_PROJECT = 'commitwork'; ${src}; return { cmtRender, cmtSel, cmtSync, cmtText, cmtBox, cmtPick, cmtSave, cmtNeeds };`);
  const api = f(dom.document, cmt, { escape: (s) => s }, fetch, async () => 'tok', () => {},
    async (p) => { calls.reload.push(p); });
  return { dom, api, cmt, calls };
}
const html = (dom) => dom.store.get('cmt-rows').innerHTML;

test('the id lookup and the id written into the DOM are the same string', () => {
  // The whole defect in one assertion: this is what CSS.escape broke.
  assert.equal(MODULE.includes("getElementById('cb-'+CSS.escape"), false,
    'getElementById takes a raw id; CSS.escape produces a selector token and the two never match');
  assert.equal(MODULE.includes("getElementById('ta-'+CSS.escape"), false);
  assert.match(MODULE, /id="cmt-row-'\+CMT\.indexOf\(i\)/, 'rows must be addressed positionally');
});

test('rendering produces one addressable row per suggestion', () => {
  const { dom, api } = boot();
  api.cmtRender();
  for (let i = 0; i < SUGGESTIONS.length; i += 1) {
    assert.ok(dom.store.get(`cmt-row-${i}`), `cmt-row-${i} must be findable by getElementById`);
  }
});

test('THE REGRESSION: a ticked box reads back as selected', () => {
  const { api, cmt } = boot();
  api.cmtRender();
  const box = api.cmtBox(cmt[0]);
  assert.ok(box, 'the checkbox must be reachable from the row — this returned null and nothing could be selected');
  box.checked = true;
  assert.equal(api.cmtSel().length, 1, 'a ticked box must appear in the selection');
  assert.equal(api.cmtSel()[0].id, cmt[0].id);
});

test('LIVE EDIT: cmtText returns what is in the box NOW, not the drafted text', () => {
  const { dom, api, cmt } = boot();
  api.cmtRender();
  const drafted = cmt[0].after.join('\n');
  assert.notEqual(api.cmtText(cmt[0]), undefined,
    'the textarea must be reachable — unreachable meant every edit was discarded silently');

  const row = dom.store.get('cmt-row-0');
  const area = row.querySelector('textarea');
  assert.ok(area, 'the row must own a textarea');

  const edited = '    // fact: MY OWN WORDING / consequence (expiry: never, prev: wrong)';
  assert.notEqual(edited, drafted, 'the fixture must differ from the draft or this proves nothing');
  area.value = 'fact: MY OWN WORDING / consequence (expiry: never, prev: wrong)';
  assert.equal(api.cmtText(cmt[0]), edited,
    'the accept payload must carry the edited text, not the draft it replaced');
});

test('an edited textarea reaches the payload, and an emptied one does not', () => {
  // The payload shape the accept handler builds, asserted directly against the source: an empty
  // box must send NO text rather than an empty replacement, or accepting blanks the block.
  assert.match(MODULE, /const t=cmtText\(i\);return \(t&&t\.trim\(\)\)\?\{id:i\.id,text:t\}:\{id:i\.id\};/,
    'the accept payload must read the live textarea and omit `text` when it is blank');
});

test('the select-all control drives the same boxes cmtSel reads', () => {
  const { api, cmt } = boot();
  api.cmtRender();
  for (const s of cmt) { const b = api.cmtBox(s); if (b) b.checked = true; }
  assert.equal(api.cmtSel().length, SUGGESTIONS.length);
});

// fact: the page must LOAD the module and the server must SERVE it / an extracted module nothing requests is a file, and the view would be dead exactly as it was before (expiry: never, prev: broken)
test('the panel loads the module and the server has a route for it', () => {
  assert.match(PANEL, /<script src="\/static\/comments\.js"><\/script>/,
    'index.html must request the module');
  const serve = serverSource();
  assert.match(serve, /STATIC_JS_MODULES[\s\S]*?'comments\.js'/,
    'comments.js must be in the explicit module allowlist');
  assert.match(serve, /STATIC_JS_MODULES\.find\(\(candidate\) => pathname === `\/static\/\$\{candidate\}`\)/,
    'serve.mjs must exact-match an allowlisted filename — static/ is deliberately not a directory surface');
  const tagAt = PANEL.indexOf('<script src="/static/comments.js">');
  const inlineAt = PANEL.lastIndexOf('<script>');
  assert.ok(tagAt < inlineAt,
    'the module must load BEFORE the inline script, or setView dispatches to a function that does not exist yet');
});

const CSS_TEXT = readFileSync(join(HERE, '..', 'static', 'panel.css'), 'utf8');
const textareas = (row, col) => row.querySelectorAll(`textarea[data-col=${col}]`);

test('original, first pass and second pass are columns, and // sits in the gutter, not the text', () => {
  const { dom, api } = boot();
  api.cmtRender();
  const h = html(dom);
  for (const col of ['before', 'first', 'second']) assert.match(h, new RegExp(`class="cmt-col[^"]*" data-col="${col}"`));
  assert.match(h, /data-col="second"[^>]*hidden/, 'the second pass is hidden until asked for');
  assert.doesNotMatch(h, /<textarea[^>]*>\s*\/\//, 'the marker must not be inside the editable text');
  assert.match(h, /<span class="cmt-gut" aria-hidden="true">\/\/<\/span><textarea/);
  assert.doesNotMatch(h, /<pre|<details|<ul/, 'no over/under diff and no second copy of the comment as a list');
});

test('fates reach the original as attributes the stylesheet colours by the hatched column', () => {
  const { dom, api } = boot();
  api.cmtRender();
  assert.match(html(dom), /<span class="cmt-o" data-f1="kept" data-f2="reworded">Kept whole\. <\/span>/);
  assert.match(html(dom), /<span class="cmt-o" data-f1="dropped" data-f2="dropped">Gone\.<\/span>/);
  for (const [f, v] of [['kept', 'live'], ['reworded', 'part'], ['dropped', 'crit']]) {
    assert.ok(CSS_TEXT.includes(`[data-sel=first] .cmt-o[data-f1=${f}]`) && CSS_TEXT.includes(`[data-sel=second] .cmt-o[data-f2=${f}]`), f);
    assert.match(CSS_TEXT, new RegExp(`\\.cmt-o\\[data-f2=${f}\\]\\{color:var\\(--${v}\\)`));
  }
});

test('the hatch is a 1px line at no more than 0.15 opacity, and the text track is 80 columns', () => {
  const m = /\.cmt-col\.sel\{background-image:repeating-linear-gradient\(45deg,color-mix\(in srgb,var\(--live\) ([\d.]+)%,transparent\) 0 1px/.exec(CSS_TEXT);
  assert.ok(m, 'the selected column must be hatched, in a tint of its token');
  assert.ok(Number(m[1]) <= 15);
  assert.match(CSS_TEXT, /\.cmt-ln\{display:grid;grid-template-columns:3ch minmax\(0,80ch\)/);
});

test('picking the second pass makes it the text that is written, with the indent and marker restored', () => {
  const { dom, api, cmt } = boot();
  api.cmtRender();
  const row = dom.store.get('cmt-row-0');
  textareas(row, 'first')[0].value = 'fact: first (expiry: never, prev: wrong)';
  textareas(row, 'second')[0].value = 'fact: second (expiry: never, prev: wrong)';
  assert.equal(api.cmtText(cmt[0]), '    // fact: first (expiry: never, prev: wrong)');
  api.cmtPick(row, 'second');
  assert.equal(api.cmtText(cmt[0]), '    // fact: second (expiry: never, prev: wrong)');
});

test('SAVE writes that one row at once and redraws it as saved', async () => {
  const { dom, api, cmt, calls } = boot({ reply: { ok: true, results: [{ ok: true, id: 'monitor/rollup.mjs#21', saved: 8 }] } });
  api.cmtRender();
  textareas(dom.store.get('cmt-row-0'), 'first')[0].value = 'fact: kept (expiry: never, prev: wrong)';
  await api.cmtSave(cmt[0]);
  assert.deepEqual(calls.fetch[0].body, { accept: [{ id: 'monitor/rollup.mjs#21', text: '    // fact: kept (expiry: never, prev: wrong)' }], project: 'commitwork' });
  assert.match(html(dom), /✓ saved · 9 → 1 lines/);
  assert.equal(api.cmtBox(cmt[0]), null, 'a saved row can no longer be ticked for accept');
  assert.deepEqual(calls.reload, ['commitwork'], 'the list is refreshed for the project it was saved in');
});

test('SAVE refused: the row says why, stays editable, and nothing is marked saved', async () => {
  const { dom, api, cmt, calls } = boot({ reply: { ok: false, results: [{ ok: false, id: 'monitor/rollup.mjs#21', error: 'refused: not schema-clean' }] } });
  api.cmtRender();
  const row = dom.store.get('cmt-row-0');
  textareas(row, 'first')[0].value = 'fact: kept';
  await api.cmtSave(cmt[0]);
  assert.equal(cmt[0].done, undefined);
  assert.equal(row.querySelector('.cmt-st').textContent, 'Not saved: refused: not schema-clean');
  assert.equal(row.querySelector('button[data-act=save]').disabled, false);
  assert.deepEqual(calls.reload, []);
});

test('a draftable original is one reflowed paragraph; a void keeps its source lines', () => {
  const { dom, api } = boot({ items: [SUGGESTIONS[0], { ...SUGGESTIONS[1], void: true, reason: 'a list',
    original: [{ mark: '//', segs: [{ t: '1. one', f1: null, f2: null }] }, { mark: '//', segs: [{ t: '2. two', f1: null, f2: null }] }] }] });
  api.cmtRender();
  const [draftable, voided] = html(dom).split('id="cmt-row-1"');
  const before = (h) => h.slice(h.indexOf('data-col="before"'), h.indexOf('data-col="first"'));
  assert.equal(before(draftable).split('class="cmt-ln"').length - 1, 1, 'source line breaks are not kept for prose');
  assert.match(before(draftable), /Gone\.<\/span><span class="cmt-o"> <\/span><span class="cmt-o" data-f1="dropped" data-f2="dropped">Tail\./);
  assert.equal(before(voided).split('class="cmt-ln"').length - 1, 2, 'a list keeps one row per item');
});

test('the save hint flags a placeholder or half-written trailer, and not a missing one', () => {
  const { api } = boot();
  assert.ok(api.cmtNeeds(['fact: x (expiry: TODO, prev: unknown)']), 'TODO is not an expiry');
  assert.ok(api.cmtNeeds(['fact: x (expiry: never)']), 'a half-written trailer');
  assert.equal(api.cmtNeeds(['fact: x']), '', 'a comment needs no expiry');
  assert.equal(api.cmtNeeds(['fact: x (expiry: never, prev: broken)']), '');
  assert.equal(api.cmtNeeds(['a plain line']), '');
});

test('the written text takes the leading whitespace of the block, tabs included', () => {
  const { dom, api, cmt } = boot({ items: [{ ...SUGGESTIONS[1], before: ['\t\t// old'] }] });
  api.cmtRender();
  textareas(dom.store.get('cmt-row-0'), 'first')[0].value = 'fact: t (expiry: never, prev: wrong)';
  assert.equal(api.cmtText(cmt[0]), '\t\t// fact: t (expiry: never, prev: wrong)');
});

test('a payload from a panel not yet restarted still shows the original and offers no empty second pass', () => {
  const { dom, api } = boot({ items: [{ ...SUGGESTIONS[1], before: ['  // Old words here.'] }] });
  api.cmtRender();
  assert.match(html(dom), /<span class="cmt-gut" aria-hidden="true">\/\/<\/span><div class="cmt-ro"><span class="cmt-o">Old words here\.<\/span>/);
  assert.doesNotMatch(html(dom), /data-act="second"|data-col="second"/);
});
