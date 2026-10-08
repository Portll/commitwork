// Every panel view is a PATH route (/name/), and the view set is declared twice by necessity —
// index.html derives VALID_VIEWS in inline client JS, serve.mjs holds PANEL_VIEWS at module scope
// — which is this repo's named failure mode unless a test binds the two. These tests extract both
// declarations from source and assert set equality, then prove the route against a really-spawned
// panel: a view path serves the panel document, a sub-path stays its own route, and an unknown
// path is still a 404 rather than a soft catch-all (a typo that serves the panel reads as a page
// that exists).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { panelSource } from './lib/panel-source.mjs';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const INDEX = join(HERE, '..', 'index.html');

// ── the two declarations, extracted from source ────────────────────────────────────────────────
function clientViews() {
  const src = panelSource('index.html');
  const native = src.match(/const NATIVE=\{([^}]*)\}/);
  assert.ok(native, 'index.html no longer declares const NATIVE={...} — update this extractor with the router');
  const keys = [...native[1].matchAll(/([a-z0-9]+):/g)].map((m) => m[1]);
  const extra = src.match(/const VALID_VIEWS=new Set\(\[\.\.\.Object\.keys\(NATIVE\),([^\]]*)\]/);
  assert.ok(extra, 'index.html no longer derives VALID_VIEWS from NATIVE — update this extractor with the router');
  const iframe = [...extra[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
  return new Set([...keys, ...iframe]);
}
// RETIRED names the client still resolves (VIEW_ALIAS). They are NOT views — they have no tab, no
// container and no TAB_GROUPS entry — but the server must still serve the panel for them or an old
// link 404s on a page the client could have rendered. Kept apart from clientViews() for exactly
// that reason: folding them in would demand a tab for a name that deliberately has none.
function clientAliases() {
  const src = panelSource('index.html');
  const m = src.match(/const VIEW_ALIAS=\{([^}]*)\}/);
  assert.ok(m, 'index.html no longer declares const VIEW_ALIAS={...} — update this extractor with the router');
  return new Set([...m[1].matchAll(/([a-z0-9]+)\s*:/g)].map((x) => x[1]));
}

function serverViews() {
  const src = serverSource();
  const m = src.match(/const PANEL_VIEWS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'serve.mjs no longer declares PANEL_VIEWS — update this extractor with the route');
  return new Set([...m[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]));
}

test('the server and client view sets are the same set — neither declaration can drift alone', () => {
  const c = clientViews(); const a = clientAliases(); const s = serverViews();
  assert.ok(c.size > 20, `client extraction degenerated (${c.size} views) — the assertion below would pass vacuously`);
  // The server serves the panel document for a view OR a retired alias; the client decides which
  // one it renders. Comparing against views alone would fail the moment an alias was added and, if
  // someone "fixed" that by deleting the alias from PANEL_VIEWS, the old link would 404 silently.
  assert.deepEqual([...s].sort(), [...new Set([...c, ...a])].sort());
});

test('an alias names a real view, and never a name that is still a view itself', () => {
  const src = panelSource('index.html');
  const m = src.match(/const VIEW_ALIAS=\{([^}]*)\}/);
  const pairs = [...m[1].matchAll(/([a-z0-9]+)\s*:\s*'([a-z0-9]+)'/g)].map((x) => [x[1], x[2]]);
  const views = clientViews();
  assert.equal(pairs.length, clientAliases().size, 'an alias entry was not parsed as name:\'target\'');
  for (const [from, to] of pairs) {
    // A target that does not exist sends the old link to Overview, which looks like a working link
    // to the wrong page — the exact failure the alias was added to prevent.
    assert.ok(views.has(to), `VIEW_ALIAS ${from} -> ${to}, and ${to} is not a view`);
    // A name that is BOTH a live view and an alias key is unreachable at its own address: urlView()
    // would rewrite it to the target every time, so the real view could never be opened by URL.
    assert.ok(!views.has(from), `${from} is both a live view and an alias key — its own path is unreachable`);
  }
});

// TAB_GROUPS is the THIRD declaration of the view set, and the only one that fails soft: groupOf()
// returns 'ungrouped' for anything missing, GROUP_LABEL renders that as "Other", and the tab lands
// in a group nobody opens. The two sets above drifted twice before they were bound; this one had
// never been bound at all. See evaluations/REMEDIATION-schema-derivation-2026-08-22.md R6.
function tabGroups() {
  const src = panelSource('index.html');
  const m = src.match(/const TAB_GROUPS=Object\.freeze\(\{([\s\S]*?)\}\);/);
  assert.ok(m, 'index.html no longer declares TAB_GROUPS — update this extractor with the router');
  return new Set([...m[1].matchAll(/([a-z0-9]+)\s*:\s*'[a-z]+'/g)].map((x) => x[1]));
}

test('every view has a TAB_GROUPS entry — an unregistered one renders where nobody looks', () => {
  const views = clientViews();
  const grouped = tabGroups();
  assert.ok(grouped.size > 18, `TAB_GROUPS extraction degenerated (${grouped.size}) — the assertion below would pass vacuously`);
  // Views reached from the ≡ menu have no TAB_GROUPS entry BY DESIGN: sections group the tab
  // strip, and a menu item is not in it. Excluded by reading the menu rather than by name, so a
  // third one added tomorrow is covered and a tab wrongly dropped from the strip still fails here.
  const pageSrc = panelSource('index.html');
  const menuAt = pageSrc.indexOf('id="menupop"');
  const menuRouted = new Set(menuAt > -1
    ? [...pageSrc.slice(menuAt).matchAll(/class="menu-view" data-v="([a-z0-9-]+)"/g)].map((m) => m[1])
    : []);
  for(const m of pageSrc.matchAll(/data-route="([a-z0-9-]+)"/g))menuRouted.add(m[1]);
  const defaults=new Function(pageSrc.match(/const WORKSPACE_DEFAULTS=([^;]+);/)[0]+'return Object.values(WORKSPACE_DEFAULTS);')();
  defaults.forEach(v=>menuRouted.add(v));
  assert.ok(menuRouted.size > 0, 'no menu-routed views found — if fleet config moved back into the strip, drop this exclusion rather than letting it pass vacuously');
  const ungrouped = [...views].filter((v) => v !== 'overview' && !grouped.has(v) && !menuRouted.has(v));
  assert.deepEqual(ungrouped, [],
    'these views have no TAB_GROUPS entry, so groupOf() files them under "ungrouped" and their tab '
    + 'is hidden behind a group heading no operator opens — add each to a group in index.html');
});

test('TAB_GROUPS names no view that does not exist', () => {
  const views = clientViews();
  const stale = [...tabGroups()].filter((v) => !views.has(v));
  assert.deepEqual(stale, [], 'TAB_GROUPS entries for views that no longer exist — the group is a dangling reference');
});

test('every group a view is assigned to is a real group with a label', () => {
  const src = panelSource('index.html');
  const order = src.match(/const GROUP_ORDER=\[([^\]]*)\]/);
  assert.ok(order, 'GROUP_ORDER is gone — update this extractor');
  const groups = new Set([...order[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]));
  const m = src.match(/const TAB_GROUPS=Object\.freeze\(\{([\s\S]*?)\}\);/);
  const assigned = [...m[1].matchAll(/[a-z0-9]+\s*:\s*'([a-z]+)'/g)].map((x) => x[1]);
  for (const g of new Set(assigned)) {
    assert.ok(groups.has(g), `TAB_GROUPS assigns a view to group '${g}', which is not in GROUP_ORDER — the tab would never render`);
  }
});

// This asserted the derivation expression VERBATIM, which made it a test of a spelling: it failed
// the moment the expression legitimately changed (to fold VIEW_ALIAS in) while a hand-written map
// that happened to start with the same 30 characters would have sailed through. So it now runs the
// real expression and checks its RESULT covers every view and every alias, bare and trailing-slash.
// A hand-maintained map could technically satisfy that — by being complete, which is the property
// actually wanted; and it would break on the next view added, which is when the drift happened.
test('PATH_VIEWS resolves every view AND every alias, both slash forms', () => {
  const src = panelSource('index.html');
  // The router builds this in a FUNCTION now, not an initialiser: generated lane tabs add views
  // after the module body runs, so a table computed once 404s every tab the page had just drawn.
  // The extractor follows it there, and still runs the real expression rather than pattern-matching
  // the source — which is the property the comment above is about.
  const m = src.match(/function buildPathViews\(\)\{\s*return ([\s\S]*?);\n\}/)
    || src.match(/const PATH_VIEWS=([\s\S]*?);\n/);
  assert.ok(m, 'index.html no longer builds PATH_VIEWS in a way this extractor recognises — update it with the router');
  const views = clientViews(), aliases = clientAliases();
  const aliasPairs = Object.fromEntries(
    [...panelSource('index.html').match(/const VIEW_ALIAS=\{([^}]*)\}/)[1]
      .matchAll(/([a-z0-9]+)\s*:\s*'([a-z0-9]+)'/g)].map((x) => [x[1], x[2]]));
  // eslint-disable-next-line no-new-func
  const PATH_VIEWS = new Function('VALID_VIEWS', 'VIEW_ALIAS', `return (${m[1]});`)(views, aliasPairs);
  for (const v of views) {
    assert.equal(PATH_VIEWS['/' + v], v, `/${v} does not resolve to itself`);
    assert.equal(PATH_VIEWS['/' + v + '/'], v, `/${v}/ does not resolve to itself`);
  }
  for (const [from, to] of Object.entries(aliasPairs)) {
    assert.equal(PATH_VIEWS['/' + from], to, `/${from} does not resolve to ${to}`);
    assert.equal(PATH_VIEWS['/' + from + '/'], to, `/${from}/ does not resolve to ${to}`);
  }
  assert.equal(Object.keys(PATH_VIEWS).length, (views.size + aliases.size) * 2,
    'PATH_VIEWS carries entries for something that is neither a view nor an alias');
});

// ── the route, against a really-spawned panel ──────────────────────────────────────────────────
const TMP = mkdtempSync(join(tmpdir(), 'cw-viewpaths-'));
let child, localPort;
const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const hit = (path) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: localPort, path, method: 'GET' }, (res) => {
    let buf = ''; res.setEncoding('utf8');
    res.on('data', (d) => { buf += d; });
    res.on('end', () => resolve({ status: res.statusCode, body: buf, type: res.headers['content-type'] || '' }));
  });
  req.on('error', reject);
  req.end();
});

before(async () => {
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fix', defaultManifest: 'security-baseline',
    roots: [], projects: [], areas: [{ slug: 'fix', name: 'Fixture', out: 'fix', members: [] }],
  }));
  const pubPort = await freePort(); localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: {
      ...process.env, CW_ADMIN_PORT: String(pubPort), CW_ADMIN_LOCAL_PORT: String(localPort),
      CW_PROJECTS: join(TMP, 'projects.json'), CW_ADMIN_STATE: TMP,
      // PIN THE AUTH STORE. Without this the spawned panel reads the operator's real
      // ~/.commitwork/users.json — so this test's result depended on whether the machine running
      // it happens to have an account, and it was the only admin test with that dependency.
      // Pointing it at a path inside TMP that is never written leaves the panel unbootstrapped,
      // which is the state these route assertions actually mean to exercise: routing, not auth.
      CW_AUTH_STORE: join(TMP, 'users.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('panel did not boot')), 15000);
    const scan = (d) => { if (String(d).includes(String(localPort))) { clearTimeout(t); res(); } };
    child.stdout.on('data', scan); child.stderr.on('data', scan);
  });
});
after(() => { try { child.kill(); } catch { /* already gone */ } rmSync(TMP, { recursive: true, force: true }); });

test('a view path serves the panel document, bare and trailing-slash alike', async () => {
  for (const p of ['/sitemap', '/sitemap/', '/issues/', '/codeql/']) {
    const r = await hit(p);
    assert.equal(r.status, 200, p);
    assert.match(r.type, /text\/html/, p);
    assert.match(r.body, /data-v="sitemap"/, `${p} did not serve the panel document`);
  }
});

test('a sub-path is NOT the panel — /sitemap/<file> stays the asset route', async () => {
  const r = await hit('/sitemap/demo.html');
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.body, /data-v="sitemap"/, 'the asset route was shadowed by the view route');
});

test('an unknown single-segment path is a 404, not a soft catch-all', async () => {
  const r = await hit('/definitely-not-a-view/');
  assert.equal(r.status, 404, 'a typo that serves the panel reads as a page that exists');
});
