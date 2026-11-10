// One panel view id is also a denied term in the release list's `private-tool` rule, and it keeps
// the id by ruling: the view's FUNCTION is agent follow-ups, its UI label says so, and the id is
// this product's address for its own page. The term and the tree disagree on purpose. This file is
// the declared exception and the witness that keeps it honest.
//
// WHY AN EXCEPTION AND NOT A NARROWED PATTERN. The two senses were measured over `git archive
// HEAD`: 423 occurrences in 104 files, and they are not lexically separable. The bare quoted token
// is the view id in admin/menus/navigation.js and the external layer's dispatch channel in
// admin/routes/remediation.mjs (`via: '<token>'`) — same spelling, same quoting, two senses. No
// regex over the token can tell those apart, so rewriting the term to deny "the product sense
// only" would either keep firing on the view id or stop firing on the product.
//
// WHY NOT A PATH EXCEPTION. `exceptPaths` blinds a whole file for that term forever and nothing
// notices when the file changes character. admin/serve.mjs is the case in point: one of its
// occurrences is the view id and the rest name the external layer's route module. A file-wide
// exception there would wave through a later occurrence of either kind, added by anybody.
//
// THE TOKEN IS NEVER SPELLED HERE. An earlier draft of this file listed the positions as literal
// fragments and the product sense as literal markers, and so carried the denied term twenty-one
// times — a gate declaration that fails its own gate, and seven of those occurrences were the
// product sense this rule exists to keep out. Everything below is built at RUN TIME from two
// sources that already hold the answer: the private denied-term list, and the panel's own view
// registry. A position is declared as the text on either side of the token, never the token, so
// the tree holds no extra copy of it and this file cannot drift from the list it enforces.
//
// WHAT IT WITNESSES: every occurrence of the token across the panel's wiring is either one of the
// narrow positions declared below, or provably the product sense. Anything else fails and asks for
// a ruling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTerms } from '../../bin/lib/release-terms.mjs';
import { serverSource } from './lib/server-source.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(REPO, rel), 'utf8');

// THE DECLARED EXCEPTION. Each row's `parts` are the literal text AROUND the token, joined by it
// at run time: a two-part row is one occurrence, a three-part row is a position that spells it
// twice. No part may spell the token. Not a path, and not a line number — a line number turns an
// unrelated edit above it into a state change, which is the identity rule this repo applies
// everywhere else. Matched case-insensitively, so a camelCased occurrence is covered by the same
// row as the lowercase id beside it.
const EXCEPTED = [
  { file: 'admin/serve.mjs', parts: ["'commentquality', '", "', 'rollups'"], why: 'PANEL_VIEWS: the server admits the view path' },
  { file: 'admin/panel.html', parts: ['<main class="wrap vhide" id="view-', '">'], why: "the view's own container id" },
  { file: 'admin/menus/section-rail.html', parts: ['class="rail-link" data-route="', '">Agent follow-ups'], why: 'the section-rail link to the view' },
  { file: 'admin/menus/view-menu.html', parts: ['data-v="', '" class="vtab" title="The automated agent'], why: 'the tab button that opens the view' },
  { file: 'admin/menus/view-menu.html', parts: ['Agent follow-ups<span class="vn" id="vn-', '"'], why: "the tab's own count badge" },
  { file: 'admin/menus/navigation.js', parts: ["graph:'fleet',\n  ", ":'fleet',cra:'fleet'"], why: 'VIEW_SCOPE: the view is scoped to the fleet, not a project' },
  { file: 'admin/menus/navigation.js', parts: ["comments:'quality',commentquality:'quality',\n  ", ":'act'"], why: 'TAB_GROUPS: which group the tab files under' },
  { file: 'admin/static/panel-router.js', parts: ["commentquality:'view-comments',", ":'view-", "',rollups:"], why: 'NATIVE: the view id to its own container id' },
  { file: 'admin/static/panel-router.js', parts: ["loadComments('spine');if(v==='", "')load", '();learnPaint()'], why: "the router's dispatch into the view's loader" },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The row's position as a case-insensitive pattern, with the token supplied by the list. */
// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- every part and the token are escaped
const needleOf = (row, id) => new RegExp(row.parts.map(escapeRe).join(escapeRe(id)), 'gi');

// The panel's wiring: where a view id legitimately lives. Deliberately NOT the whole tree — this
// exception is about the view id, and an occurrence anywhere else is not covered by it at all.
const WIRING = [
  'admin/serve.mjs', 'admin/panel.html', 'admin/menus/section-rail.html', 'admin/menus/view-menu.html',
  'admin/menus/navigation.js', 'admin/static/panel-router.js',
];

/** The view ids PANEL_VIEWS declares, read from the server's own registry. */
function panelViewIds() {
  const m = serverSource().match(/const PANEL_VIEWS = new Set\(\[([^\]]*)\]/);
  assert.ok(m, 'serve.mjs no longer declares PANEL_VIEWS — update this extractor with the route');
  return [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
}

/**
 * The view id that a denied term matches, discovered rather than restated: every id in the panel's
 * registry is offered to the loaded list and the one that fires is the collision this file is
 * about. `null` when nothing collides, and `undefined` when there is no list to ask.
 */
function collidingViewId() {
  let list;
  // A list that is NAMED and unreadable throws, and that must not read as "nothing collides".
  try { list = loadTerms(); } catch (e) { throw new Error(`the denied-term list cannot be read: ${e.message}`); }
  if (!list) return undefined;
  for (const id of panelViewIds()) {
    for (const rule of list.rules) {
      for (const term of rule.terms) {
        term.re.lastIndex = 0;
        if (term.re.test(id)) return id;
      }
    }
  }
  return null;
}

const SKIP = 'no denied-term list on this machine (the sidecar is absent) — the exception cannot be checked, which is not a pass';

test('the exception names a collision that actually exists', (t) => {
  const id = collidingViewId();
  if (id === undefined) return t.skip(SKIP);
  if (id === null) {
    // Self-retiring: nothing collides, so nothing should be declared. This is the state after the
    // view id is renamed or the term withdrawn, and the file should then be deleted outright.
    assert.deepEqual(EXCEPTED, [], 'no panel view id is a denied term any more — this exception is moot and should be deleted');
    return undefined;
  }
  assert.ok(EXCEPTED.length > 0, `view id '${id}' is a denied term and no exception is declared for it`);
  return undefined;
});

test('every declared position is anchored on text that occurs exactly once', (t) => {
  const id = collidingViewId();
  if (id === undefined) return t.skip(SKIP);
  if (id === null) return undefined;
  for (const e of EXCEPTED) {
    const found = read(e.file).match(needleOf(e, id)) || [];
    assert.notEqual(found.length, 0,
      `${e.file}: the excepted position is gone (${e.why}). A stale exception excepts nothing and `
      + 'hides whatever replaced it, which is the whole failure mode of a path exception.');
    assert.equal(found.length, 1,
      `${e.file}: the excepted text occurs ${found.length} times, so it anchors no single position (${e.why})`);
  }
  return undefined;
});

test('an exception that withdraws nothing refuses — no declared side already holds the token', (t) => {
  const id = collidingViewId();
  if (id === undefined) return t.skip(SKIP);
  if (id === null) return undefined;
  for (const e of EXCEPTED) {
    assert.ok(e.parts.length >= 2, `${e.file}: a position needs text on both sides of the token (${e.why})`);
    for (const part of e.parts) {
      // The token must come from the list, not from the declaration: a part that already spelled it
      // would put a second copy in the tree and let this file drift from the real id.
      assert.doesNotMatch(part, new RegExp(id, 'i'), `${e.file}: the declaration spells the token itself (${e.why})`);
    }
  }
  return undefined;
});

/**
 * Markers only the PRODUCT sense carries, each composed from the token plus an ORDINARY word, so
 * the private spelling of the compound never appears in this file either. Measured over this tree:
 * the compound name, its exporter, its unreachability reason, its dispatch channel and its port.
 */
// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- the token comes from the schema-checked terms list
const productMarkers = (id) => [
  new RegExp(`${escapeRe(id)}[-_ ]?layer`, 'i'), new RegExp(`export[-_]${escapeRe(id)}`, 'i'),
  new RegExp(`${escapeRe(id)}-unreachable`, 'i'), new RegExp(`via:\\s*'${escapeRe(id)}'`, 'i'),
  /ownerMatch/, /7980/,
];

// THE ASSERTION THE BRIEF ASKS FOR BY NAME: the exception must stop covering a position the moment
// that position starts meaning the product. Checked on a window around the MATCH, not on the
// declared text, because the declared text is the two sides and the drift arrives between or
// beside them. An anchor that merely moved is caught by the test above; this one catches an anchor
// that stayed exactly where it was and changed what it says.
test('no excepted position has acquired the product sense', (t) => {
  const id = collidingViewId();
  if (id === undefined) return t.skip(SKIP);
  if (id === null) return undefined;
  const markers = productMarkers(id);
  for (const e of EXCEPTED) {
    const src = read(e.file);
    const m = needleOf(e, id).exec(src);
    if (!m) continue;   // absent is the test above's finding, not this one's
    const window = src.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
    for (const p of markers) {
      assert.doesNotMatch(window, p,
        `${e.file}: the excepted position now sits next to a product-sense marker (${p}) — `
        + `it is no longer just a view id (${e.why}), and the exception must not cover it`);
    }
  }
  return undefined;
});

test('every token occurrence in the panel wiring is classified — excepted, or provably the product', (t) => {
  const id = collidingViewId();
  if (id === undefined) return t.skip(SKIP);
  if (id === null) return undefined;
  const markers = productMarkers(id);
  const re = new RegExp(escapeRe(id), 'gi');
  const unclassified = [];
  const hit = new Set();
  let total = 0; let excepted = 0; let product = 0;
  for (const rel of WIRING) {
    const src = read(rel);
    const spans = EXCEPTED.filter((e) => e.file === rel).map((e) => {
      const m = needleOf(e, id).exec(src);
      return { e, a: m ? m.index : -1, b: m ? m.index + m[0].length : -1 };
    });
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      total += 1;
      // A declared position may legitimately spell the token twice, so occurrences and
      // positions-hit are counted apart: one is the denominator, the other catches a dead row.
      const inSpan = spans.find((s) => s.a > -1 && m.index >= s.a && m.index < s.b);
      if (inSpan) { excepted += 1; hit.add(inSpan.e); continue; }
      // The window, not the line: a long line can carry both senses, and a marker only says
      // something about THIS occurrence if it sits next to it.
      const window = src.slice(Math.max(0, m.index - 30), m.index + id.length + 30);
      if (markers.some((p) => p.test(window))) { product += 1; continue; }
      let ls = src.lastIndexOf('\n', m.index) + 1;
      let le = src.indexOf('\n', m.index);
      if (le < 0) le = src.length;
      unclassified.push(`${rel}: ${src.slice(ls, le).trim().slice(0, 120)}`);
    }
  }
  assert.ok(total > 10, `the extractor degenerated (${total} occurrences) — the assertions below would pass vacuously`);
  assert.deepEqual(EXCEPTED.filter((e) => !hit.has(e)).map((e) => `${e.file} ${e.why}`), [],
    'these declared positions matched no occurrence of the token, so they withdraw nothing');
  assert.deepEqual(unclassified, [],
    'these occurrences of the denied token in the panel wiring are neither a declared view-id '
    + `position nor provably the external product (${total} in the wiring: ${excepted} excepted, ${product} product). `
    + 'One of three things is true and a person has to say which: it is a new view-id position and '
    + 'belongs in EXCEPTED, it is the product and belongs renamed, or the ruling has changed.');
  // THE PRODUCT COUNT IS PINNED, and going stale is the point. The five are the layer's route
  // module import, its entry in MODULAR_ROUTES, its name in the static-module allowlist, its
  // client script tag and the panel container's sibling — each one a rename this task did not make.
  // A sixth would otherwise be admitted silently by the marker test above, which only proves an
  // occurrence IS the product and never that a new one was wanted.
  assert.equal(product, 5,
    `${product} occurrences in the panel wiring are the external product, not 5. Up means a new `
    + 'one was added where it should have been renamed; down means one was renamed and this number '
    + 'should come down with it.');
  return undefined;
});
