// The panel's two-level navigation: 28 flat tabs behind 6 sections.
//
// The failure this file exists to prevent is a tab that EXISTS but cannot be REACHED. The strip
// went from 10 tabs to 28 in eleven days across about a dozen sessions, so a hand-maintained
// 28-entry map is guaranteed to fall behind — and a view that has no section, in a naive
// implementation, is a view that renders nowhere. That is the disappearing-evidence failure this
// whole panel exists to refuse, turned on its own navigation.
//
// So the contract is: unmapped tabs COLLECT UNDER "Other", visibly. Wrong is fine; invisible is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = panelSource('index.html');
const CSS = readFileSync(join(HERE, '..', 'static', 'panel.css'), 'utf8');

function braceMatch(from) {
  const open = SRC.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) return SRC.slice(from, i + 1); }
  }
  assert.fail('unbalanced braces');
}
const declAt = (needle) => {
  const at = SRC.indexOf(needle);
  assert.ok(at > -1, `${needle} not found in admin/index.html`);
  return at;
};

/** A whole `const x = ...;` STATEMENT, however many lines it happens to occupy.
 *
 *  This replaces `SRC.split('\n').find((l) => l.startsWith('const groupOf='))`, which took ONE
 *  line and therefore silently truncated the declaration the moment anybody wrapped it. That is not
 *  hypothetical: a change extended groupOf to consult TAB_GROUPS_EXTRA for generated lane tabs and
 *  split the ternary across two lines — a correct change — and this file failed with
 *  `SyntaxError: Unexpected token 'return'`, because half a ternary was spliced in ahead of the
 *  return statement. The error named the harness, not the cause, which is the worst property an
 *  extractor can have.
 *
 *  Scans to the first `;` at depth zero, tracking brackets and quotes, so reformatting is free. */
function statementAt(needle) {
  const from = declAt(needle);
  let depth = 0, quote = null;
  for (let i = from; i < SRC.length; i++) {
    const c = SRC[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return SRC.slice(from, i + 1);
  }
  assert.fail(`no terminating semicolon for ${needle}`);
}

const { TAB_GROUPS, GROUP_ORDER, GROUP_LABEL, GROUP_TITLE, groupOf } = new Function(`
  ${braceMatch(declAt('const TAB_GROUPS=Object.freeze('))
    .replace(/^\{/, 'const TAB_GROUPS=Object.freeze({') + ');'}
  ${statementAt('const GROUP_ORDER=')}
  ${braceMatch(declAt('const GROUP_LABEL=')).replace(/^\{/, 'const GROUP_LABEL={') + ';'}
  ${braceMatch(declAt('const GROUP_TITLE=')).replace(/^\{/, 'const GROUP_TITLE={') + ';'}
  ${statementAt('const TAB_GROUPS_EXTRA=')}
  ${statementAt('const groupOf=')}
  return { TAB_GROUPS, GROUP_ORDER, GROUP_LABEL, GROUP_TITLE, groupOf };
`)();

/** Every data-v actually present in the nav strip. Digits allowed — `a11y` is a real tab, and a
 *  [a-z]+ pattern silently dropped it once already while counting this very strip. */
const liveTabs = [...SRC.matchAll(/<button[^>]*data-v="([A-Za-z0-9_-]+)"[^>]*class="vtab/g)].map((m) => m[1]);

test('the lift is COMPLETE, not merely parseable', () => {
  // The failure mode this file just had: a truncated declaration that still parsed far enough to
  // produce a SyntaxError somewhere else, naming the harness instead of the cause. Worse is a
  // truncation that parses cleanly — half a ternary with a valid tail would run and quietly grade
  // every tab wrong. So the lift is checked for its TAIL, not just for compiling.
  // Per-declaration tails, not a length rule. The first cut of this test asserted
  // `lifted.length > needle.length + 5` and failed on `const TAB_GROUPS_EXTRA={};` — which is
  // CORRECT source: that map is empty at declaration and filled at runtime by the generated-tab
  // pass. A generic size heuristic cannot tell a truncated lift from a legitimately small one, so
  // each declaration is checked for the thing that proves ITS tail arrived.
  const TAILS = {
    'const GROUP_ORDER=': /history'\]/,           // the last section in the ordered list
    'const groupOf=': /ungrouped/,                 // the fallback, which is the whole point of it
    'const TAB_GROUPS_EXTRA=': /\{\s*\}/,          // legitimately empty; only the shape is checked
  };
  for (const [needle, tail] of Object.entries(TAILS)) {
    const lifted = statementAt(needle);
    assert.ok(lifted.endsWith(';'), `${needle} lifted without its terminator`);
    assert.match(lifted, tail, `${needle} was truncated before its tail — the lift is incomplete`);
  }
  // And the functions actually behave, which is the only thing that proves the splice was sound.
  assert.equal(groupOf('overview'), 'overview');
  assert.equal(groupOf('a-tab-nobody-declared'), 'ungrouped');
});

test('the nav strip is found and is the size we think it is', () => {
  assert.ok(liveTabs.length >= 20, `only ${liveTabs.length} tabs parsed — the markup shape changed`);
  assert.equal(new Set(liveTabs).size, liveTabs.length, 'a data-v appears twice in the strip');
});

test('every live tab lands in a section — declared or "Other", never nowhere', () => {
  for (const v of liveTabs) {
    const g = groupOf(v);
    assert.ok(g, `tab '${v}' resolved to no section at all`);
    assert.ok(GROUP_LABEL[g], `tab '${v}' resolved to section '${g}', which has no label to render`);
  }
});

// The point of the fallback. If this ever fails it means someone made `ungrouped` unreachable,
// and the next undeclared tab will vanish instead of showing up misfiled.
test('an undeclared tab falls back to a section that RENDERS', () => {
  const g = groupOf('a-tab-nobody-declared');
  assert.equal(g, 'ungrouped');
  assert.ok(GROUP_LABEL[g], 'the fallback section has no label, so an undeclared tab would render blank');
  assert.ok(GROUP_TITLE[g], 'the fallback section has no tooltip explaining what to do about it');
  assert.match(GROUP_TITLE[g], /TAB_GROUPS/, 'the tooltip should name the file to edit');
});

test('prototype keys resolve to the fallback, not to a function', () => {
  for (const hostile of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(groupOf(hostile), 'ungrouped', `'${hostile}' must not resolve to an inherited member`);
  }
});

test('TAB_GROUPS names no view that is not a tab', () => {
  const live = new Set(liveTabs);
  for (const v of Object.keys(TAB_GROUPS)) {
    assert.ok(live.has(v), `TAB_GROUPS declares '${v}', which is not a tab in the strip — a stale entry that grades nothing`);
  }
});

test('every declared section is in GROUP_ORDER, and every ordered section is real', () => {
  const used = new Set(Object.values(TAB_GROUPS));
  for (const g of used) {
    assert.ok(GROUP_ORDER.includes(g), `section '${g}' is used by TAB_GROUPS but missing from GROUP_ORDER — it would render after the declared ones instead of in place`);
    assert.ok(GROUP_LABEL[g] && GROUP_TITLE[g], `section '${g}' is missing a label or tooltip`);
  }
  for (const g of GROUP_ORDER) {
    assert.ok(used.has(g), `GROUP_ORDER lists '${g}', which no tab belongs to — an empty section would be ordered but never rendered`);
  }
});

test('the section mapping is exhaustive over the live strip', () => {
  const unmapped = liveTabs.filter((v) => !Object.prototype.hasOwnProperty.call(TAB_GROUPS, v));
  assert.deepEqual(unmapped, [],
    `these tabs have no declared section and would render under "Other": ${unmapped.join(', ')}. That is not a crash — it is the fallback doing its job — but add them to TAB_GROUPS.`);
});

test('routing is untouched: the group is derived, so every tab is still its own hash', () => {
  // The whole reason this change carries no redirect map. If a `GROUP_ROUTES`-style second
  // vocabulary ever appears, the two can drift and #codeql starts landing somewhere else.
  assert.match(SRC, /const groupOf=\(v\)=>[^\n]*TAB_GROUPS/, 'groupOf should derive from TAB_GROUPS');
  assert.ok(!/GROUP_ROUTES|groupHash|hashForGroup/.test(SRC), 'a second routing vocabulary appeared — the group must stay derived from the view');
});

test('the section strip and the tab strip cannot both look active', () => {
  // They render adjacent. When both carried the same treatment, the Overview section sat beside
  // the Overview tab, both accented, both claiming to be where you are.
  assert.match(CSS, /\.gtab\.pri\{[^}]*background:var\(--panel2\)/, '.gtab.pri should take the surface');
  assert.match(CSS, /#views \.vtab\.pri\{[^}]*background:transparent/, '#views .vtab.pri must not take a surface — that is the section level\'s treatment');
  assert.match(CSS, /\.vtab\.ghide\{display:none\}/, 'tabs outside the active section must be hidden, not merely dimmed');
});

test('primary navigation is a separate rail; categories and views belong to content', () => {
  const rail = SRC.indexOf('<aside id="workspace-rail"');
  const content = SRC.indexOf('<div id="workspace-content"');
  const groups = SRC.indexOf('<nav id="groups"');
  const views = SRC.indexOf('<nav id="views"');
  assert.ok(rail > -1 && content > rail);
  assert.ok(groups > content && views > groups);
  assert.match(SRC, /#workspace-rail\{position:fixed/);
});
