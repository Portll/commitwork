// Every tab is a PATH route (/name/) that survives reload — pinned as a CONTRACT between the nav
// strip and the boot restore, because the restore whitelist was hand-maintained and drifted twice:
// exposure and remediation wrote hashes a reload then ignored, silently landing the operator on
// Overview. A deep link that half-works is worse than none — it teaches people the URLs lie.
// Legacy #name forms are still honoured on read (old bookmarks), then normalised to the path.
//
// The valid set is now DERIVED in index.html (NATIVE views + the iframe views); this test lifts
// both sides from source (the scanner-checks technique) and asserts set equality with the actual
// nav buttons, so adding a tab without a restorable route — or a route without a tab — fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelSource } from './lib/panel-source.mjs';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = panelSource('index.html');

// the nav strip's declared tabs
const navAt = SRC.indexOf('<nav id="views"');
const navEnd = SRC.indexOf('</nav>', navAt);
assert.ok(navAt > -1 && navEnd > navAt, 'nav#views not found');
// [a-z0-9-]+, not [a-z]+: a view named with a digit (a11y) matched NOTHING, so this guard reported
// "no nav tab writes it" for a button sitting right there in the strip — a check that fails for the
// wrong reason is worse than one that does not run, because it sends you to fix the wrong file.
const stripButtons = [...SRC.slice(navAt, navEnd).matchAll(/data-v="([a-z0-9-]+)"/g)].map((m) => m[1]);
assert.ok(stripButtons.length >= 10, `only ${stripButtons.length} tabs parsed — the nav shape changed`);
// FLEET CONFIGURATION IS REACHED FROM THE ≡ MENU, NOT THE STRIP (operator ruling, 2026-08-22):
// projects and profile act ON the panel rather than reporting on the fleet, so they sit beside
// /config and the session controls. They still route — same setView, same #hash, same NATIVE view.
// The invariant this file pins is "a restorable route has somewhere to CLICK", not "has a tab", so
// the menu's entries count. Scoped to #menupop .menu-view so that Config (an <a href>) and the
// sign-in buttons, which are not views, stay out of it.
const menuAt = SRC.indexOf('id="menupop"');
const menuEnd = SRC.indexOf('</div>', SRC.indexOf('id="oauth"', menuAt));
const menuViews = menuAt > -1
  ? [...SRC.slice(menuAt, menuEnd).matchAll(/class="menu-view" data-v="([a-z0-9-]+)"/g)].map((m) => m[1])
  : [];
const railViews = [...SRC.matchAll(/data-route="([a-z0-9-]+)"/g)].map(m => m[1]);
// Projects is the landing page of the primary Projects rail button.
const workspaceDefaults = new Function(SRC.match(/const WORKSPACE_DEFAULTS=([^;]+);/)[0] + 'return Object.values(WORKSPACE_DEFAULTS);')();
const buttons = [...stripButtons, ...menuViews, ...railViews, ...workspaceDefaults];

// the boot restore's valid set, evaluated from the same source the page runs
const nativeLine = SRC.split('\n').find((l) => l.startsWith('const NATIVE='));
const validLine = SRC.split('\n').find((l) => l.startsWith('const VALID_VIEWS='));
assert.ok(nativeLine && validLine, 'NATIVE / VALID_VIEWS not found in index.html');
const VALID = new Function(`${nativeLine}\n${validLine}\nreturn VALID_VIEWS;`)();

test('every nav tab restores from its #hash on reload — no half-working deep links', () => {
  for (const b of buttons) {
    assert.ok(VALID.has(b), `entry '${b}' writes #${b} but a reload would ignore it and land on Overview`);
  }
});

test('every restorable route has a tab — no orphan routes teaching URLs that lie', () => {
  for (const v of VALID) {
    assert.ok(buttons.includes(v), `route '#${v}' restores but nothing in the strip OR the ≡ menu writes it — an operator can reach it only by typing the URL`);
  }
});

test('the view switcher writes the URL it restores from', () => {
  // one writer (viewUrl), one reader (urlView) — setView writes through viewUrl and boot restores
  // through urlView, so the two cannot drift the way the hand-maintained whitelist did
  assert.match(SRC, /const viewUrl=/, 'viewUrl (the single URL writer) must exist');
  assert.match(SRC, /const urlView=/, 'urlView (the single URL reader) must exist');
  assert.match(SRC, /history\[replace\?'replaceState':'pushState'\]/, 'setView must write the URL viewUrl derives');
  assert.match(SRC, /addEventListener\('hashchange'/, 'back/forward must move the view for #hash tabs');
  assert.match(SRC, /addEventListener\('popstate'/, 'back/forward must move the view for path tabs');
});

test('every view is a path route — /name/ restores it, and setView writes the path, not #name', () => {
  // viewUrl became MULTI-LINE when the project moved into the path (/<slug>/<view>/), so a
  // find-the-line extraction silently grabbed its first line and evaluated a fragment. Take the
  // whole declaration instead — from `const viewUrl=` to the line that closes it. PATH_VIEWS then
  // went multi-line for the same reason (folding VIEW_ALIAS in) and hit the same trap, so it is
  // extracted the same way rather than by first line.
  const lines = SRC.split('\n');
  const decl = (first, closer) => {
    const s = lines.findIndex((l) => l.startsWith(first));
    if (s < 0) return null;
    const e = lines.findIndex((l, i) => i >= s && closer.test(l));
    return e >= s ? lines.slice(s, e + 1).join('\n') : null;
  };
  // PATH_VIEWS moved into buildPathViews() so generated lane tabs can rebuild it; the declaration
  // and the builder are both taken, because the eval below needs the assignment AND the function it
  // calls. Falls back to the old single-line form so this reads either shape.
  const pathBuilder = decl('function buildPathViews()', /^\}/);
  const pathDecl = lines.find((l) => l.startsWith('let PATH_VIEWS='));
  const pathLine = pathBuilder && pathDecl ? `${pathBuilder}\n${pathDecl}` : decl('const PATH_VIEWS=', /\)\);\s*$/);
  const aliasLine = lines.find((l) => l.startsWith('const VIEW_ALIAS='));
  const urlLine = decl('const viewUrl=', /^};/);
  assert.ok(pathLine && urlLine && aliasLine, 'PATH_VIEWS / VIEW_ALIAS / viewUrl not found in index.html');
  // PATH_VIEWS derives from VALID_VIEWS and VIEW_ALIAS, so the eval carries the same declarations
  // the page runs — evaluating the line alone would test a sentence torn out of its paragraph.
  const PATH_VIEWS = new Function(`${nativeLine}\n${validLine}\n${aliasLine}\n${pathLine}\nreturn PATH_VIEWS;`)();
  for (const v of VALID) {
    assert.equal(PATH_VIEWS[`/${v}/`], v, `/${v}/ must restore the ${v} tab`);
    assert.equal(PATH_VIEWS[`/${v}`], v, `the slashless /${v} must restore too`);
  }
  // viewUrl closes over curProj, SLUGS and the page's scope table; supply all three so it is
  // evaluated in the same shape it runs in rather than in a fragment that happens to work.
  const scopeDecl = decl('const VIEW_SCOPE=', /\}\);\s*$/);
  const scopeFn = lines.find((l) => l.startsWith('const scopeOf='));
  assert.ok(scopeDecl && scopeFn, 'VIEW_SCOPE / scopeOf not found in index.html');
  const mk = (curProj, SLUGS) => new Function('curProj', 'SLUGS', `${scopeDecl}\n${scopeFn}\n${urlLine}\nreturn viewUrl;`)(curProj, SLUGS);

  // NO PROJECT SELECTED — every view keeps the path shape it had before the project joined the route.
  const bare = mk('', {});
  assert.equal(bare('codeql'), '/codeql/', 'codeql keeps the path shape it pioneered');
  assert.equal(bare('secrets'), '/secrets/', 'every tab now writes a path, never a #hash');
  assert.equal(bare('sitemap'), '/sitemap/', 'the sitemap tab is linkable as a real URL');
  assert.equal(bare('overview'), '/', 'overview stays the bare root');

  // WITH A PROJECT — the SLUG leads, and the view stays the second segment.
  const withProj = mk('commitwork admin', { 'commitwork admin': 'commitwork-admin' });
  assert.equal(withProj('leaks'), '/commitwork-admin/leaks/', 'the slug leads and the view follows');
  assert.equal(withProj('overview'), '/commitwork-admin/overview/',
    'overview needs an explicit segment once a project leads — /commitwork-admin/ alone would be ambiguous with a view');

  // A LABEL WITH NO DECLARED SLUG falls back to the plain view path rather than inventing a segment.
  assert.equal(mk('Undeclared Thing', {})('leaks'), '/leaks/');

  // A FLEET OR ACCOUNT PAGE names no project even while one is selected: it ignores the picker, and
  // /commitwork-admin/fleet/ claimed a project for a page about all of them.
  assert.equal(withProj('fleet'), '/fleet/');
  assert.equal(withProj('verdicts'), '/verdicts/');
  assert.equal(withProj('profile'), '/profile/');
});

// ── THE COLLISION THE TWO-SEGMENT ROUTE CREATED ─────────────────────────────────────────────────
// Requiring the second segment to be a known view is NOT sufficient. `/api/issues` has `issues` in
// that position, so the project route matched it as project=`api` and served the panel document
// where an API route serves JSON. Reasoned past, wrong, and caught by issues-route.test.mjs.
test('a reserved first segment is never read as a project', () => {
  const SERVE = serverSource();
  const line = SERVE.split('\n').find((l) => l.includes('const RESERVED_FIRST'));
  assert.ok(line, 'RESERVED_FIRST is gone — /api/<view> would be served the panel document again');
  // Derived from the source, not a second hand-written list: a prefix added there is covered here.
  const reserved = [...line.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  for (const p of ['api', 'auth', 'reports', 'map', 'sitemap']) {
    assert.ok(reserved.includes(p), `${p}/ is a path the server owns and must not parse as a project slug`);
  }
  assert.match(SERVE, /!RESERVED_FIRST\.has\(pv2\[1\]\.toLowerCase\(\)\)/,
    'the exclusion must be applied to the two-segment match, not merely declared');
});
