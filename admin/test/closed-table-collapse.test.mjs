// node --test admin/test/ — the Closed (adjudicated) table: it folds, it remembers, it replaces.
//
// renderClosedTable had no test at all. Two things about it are load-bearing and neither was
// asserted anywhere:
//
//   1. It is the SUPPRESSION DISCLOSURE. Rows adjudicated false-positive/accepted leave the counts
//      and move here, so this table is the repo's answer to "suppressed is never deleted". Folding
//      it is fine; folding it in a way that drops the COUNT or the "not counted above" wording
//      would turn a disclosure into a hiding place. The count has to stay on screen collapsed.
//   2. It replaced only its HEADING on re-render, leaving `<rows>-closed-t` behind. load() polls
//      every 8s, so the page grew one orphan closed table every 8 seconds — duplicate ids, and
//      every copy but the newest frozen at whatever the data said when it was drawn.
//
// The DOM here is a stub, but it is a stub that really registers the ids the renderer emits and
// really returns them from getElementById — so a renderer that emitted nothing, or that failed to
// remove the old nodes, fails here. A shim returning null for every lookup would have passed both
// the bug in (2) and an empty render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PANEL = panelSource('index.html');

function fn(name) {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal name or class taken from the test itself
  const re = new RegExp(`(?:^|\\n)((?:async )?function ${name}\\([\\s\\S]*?\\n\\})`, 'm');
  const m = PANEL.match(re);
  assert.ok(m, `${name}() not found in index.html — the extractor and the panel have drifted`);
  return m[1];
}
const line = (prefix) => {
  const l = PANEL.split('\n').find((x) => x.startsWith(prefix));
  assert.ok(l, `${prefix}… not found in index.html`);
  return l;
};

/** A DOM that really holds the nodes the renderer inserts, keyed by the ids it writes. */
function makeDom() {
  const byId = new Map();
  const mk = (id, html, hidden) => ({
    id, _html: html, hidden, attrs: {}, handlers: {}, afterCalls: [],
    remove() { byId.delete(this.id); this.removed = true; },
    after(el) { this.afterCalls.push(el && el.id); },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(ev, h) { this.handlers[ev] = h; },
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
  });
  // Register every id in the inserted markup, recording whether its own tag carried `hidden`.
  const register = (html) => {
    for (const m of html.matchAll(/<(\w+)\b([^>]*?)>/g)) {
      const idm = m[2].match(/\sid="([^"]+)"/);
      if (!idm) continue;
      // `hidden` is a bare attribute and is the LAST thing in the tag, so the lookahead has to
      // accept end-of-chunk as well as a delimiter — without `|$` this read every folded table as
      // open and the default-collapsed assertion passed on a table that was never folded.
      byId.set(idm[1], mk(idm[1], html, /\shidden(?=[\s>]|$)/.test(m[2])));
    }
  };
  const host = {
    className: 'tw', inserted: [],
    insertAdjacentHTML(pos, html) { this.inserted.push({ pos, html }); register(html); },
  };
  const body = { closest: (sel) => (sel === '.tw' ? host : null) };
  return { byId, host, body, document: { getElementById: (id) => byId.get(id) || null } };
}

/** Evaluate the real renderClosedTable against a stub DOM. Returns the harness plus its state. */
function harness() {
  const dom = makeDom();
  const src = [
    "const esc=(s)=>String(s==null?'':s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));",
    line('const closedOpen='),
    line('const CLOSED_LABEL='),
    fn('renderClosedTable'),
    'return {renderClosedTable, closedOpen};',
  ].join('\n');
  // eslint-disable-next-line no-new-func
  const api = new Function('document', src)(dom.document);
  return { ...dom, ...api };
}

const TAB = { key: 'secrets', rows: 'sec-rows', cols: 10, group: false, row: (f) => `<td>${f.file}</td>` };
const CLOSED = Array.from({ length: 20 }, (_, i) => ({
  repo: 'commitwork', rule: 'generic-api-key', file: `f${i}.mjs`, line: i,
  annotation: { action: 'false-positive', who: 'x@y', reason: 'a filename, not a credential' },
}));

test('collapsed by DEFAULT — the table is hidden but the COUNT is not', () => {
  const h = harness();
  h.renderClosedTable(h.body, null, TAB, CLOSED);
  const t = h.byId.get('sec-rows-closed-t');
  const hd = h.byId.get('sec-rows-closed');
  assert.ok(t && hd, 'the closed table was not rendered at all');
  assert.equal(t.hidden, true, 'the closed table must start folded');
  // The disclosure is the count and the wording, and BOTH have to survive the fold — a collapsed
  // table whose summary said nothing would be a suppression the page stopped mentioning.
  assert.match(hd.innerHTML, /20 adjudicated/, 'the count must stay on screen while folded');
  assert.match(hd.innerHTML, /not counted above, not counted in the area totals/,
    'the "not counted" wording is the disclosure, not decoration');
  assert.match(hd.innerHTML, /aria-expanded="false"/, 'the control must state its state to assistive tech');
});

test('the rows are PRESENT while folded — collapsed is not suppressed', () => {
  const h = harness();
  h.renderClosedTable(h.body, null, TAB, CLOSED);
  const html = h.host.inserted.map((i) => i.html).join('');
  assert.equal((html.match(/<tr class="ann-row">/g) || []).length, 20,
    'all 20 adjudicated rows must be in the document, merely folded — dropping them would delete '
    + 'the evidence a suppression is supposed to keep');
  assert.match(html, /f19\.mjs/, 'the last row is rendered, so nothing is being truncated');
});

test('the toggle opens it, and the choice SURVIVES the next render', () => {
  const h = harness();
  h.renderClosedTable(h.body, null, TAB, CLOSED);
  const btn = h.byId.get('sec-rows-closed-b');
  assert.ok(btn && btn.handlers.click, 'no click handler — the control is decorative');
  btn.handlers.click();
  assert.equal(h.byId.get('sec-rows-closed-t').hidden, false, 'the click did not unfold the table');
  assert.equal(btn.attrs['aria-expanded'], 'true');
  assert.ok(h.closedOpen.has('secrets'), 'the choice was not recorded');

  // load() re-renders every 8s. Without the per-lane memory the poll would fold a table the
  // operator had just opened, roughly once per row read.
  h.renderClosedTable(h.body, null, TAB, CLOSED);
  assert.equal(h.byId.get('sec-rows-closed-t').hidden, false,
    'the 8s poll re-folded a table the operator had opened');
});

test('a re-render REPLACES both nodes — no orphan table accumulates', () => {
  const h = harness();
  h.renderClosedTable(h.body, null, TAB, CLOSED);
  const first = { hd: h.byId.get('sec-rows-closed'), t: h.byId.get('sec-rows-closed-t') };
  h.renderClosedTable(h.body, null, TAB, CLOSED);
  // Both of the first pass's nodes must have been removed. The heading always was; `-t` was not,
  // which is what left a stale duplicate behind on every poll.
  assert.equal(first.hd.removed, true, 'the old heading was not removed');
  assert.equal(first.t.removed, true,
    'the old closed TABLE was not removed — it stays in the document as a duplicate id, and every '
    + 'copy but the newest is frozen at the data it was drawn with');
  assert.ok(h.byId.get('sec-rows-closed-t'), 'and the replacement is present');
});

test('nothing adjudicated renders nothing, and clears what was there', () => {
  const h = harness();
  h.renderClosedTable(h.body, null, TAB, CLOSED);
  h.renderClosedTable(h.body, null, TAB, []);
  assert.equal(h.byId.get('sec-rows-closed'), undefined, 'an empty closed set must leave no heading');
  assert.equal(h.byId.get('sec-rows-closed-t'), undefined, 'an empty closed set must leave no table');
});
