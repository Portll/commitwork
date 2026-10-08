// Modular routes used to dispatch BEFORE the login gate, so each was responsible for its own auth
// and the ones that did not check answered 200 with data to an unauthenticated caller on the
// published port. Measured 2026-08-25: /api/report/states, /api/report/evidence, /api/posture and
// /api/a11y all returned 200 and real content; admin/routes/report.mjs held no session helper at all.
//
// These assert the ORDER, not the individual routes: a 65th route must be authenticated because of
// where dispatch sits, not because its author remembered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = serverSource();
// split(/\r?\n/): the anchors below are EXACT line matches, and under a CRLF checkout every line
// ends `\r` so none of them matched. This guard asserts that modular dispatch sits AFTER the login
// gate — "every modular route is then reachable without a session on the published port" — so on
// Windows a security guard was silently not running at all. See admin/test/lib/panel-source.mjs.
const LINES = SRC.split(/\r?\n/);

const dispatchAt = LINES.findIndex((l) => l === '  for (const r of MODULAR_ROUTES) {');
const gateAt = LINES.findIndex((l) => l.includes("'authentication required' });"));

test('modular dispatch sits AFTER the login gate', () => {
  assert.ok(dispatchAt > -1, 'the MODULAR_ROUTES dispatch loop was not found — update this test with the route');
  assert.ok(gateAt > -1, 'the login gate 401 was not found — update this test with the gate');
  assert.ok(dispatchAt > gateAt,
    `MODULAR_ROUTES dispatches at line ${dispatchAt + 1}, BEFORE the login gate at ${gateAt + 1}. `
    + 'Every modular route is then reachable without a session on the published port.');
});

test('the gate is not short-circuited for api paths', () => {
  const gateBlock = LINES.slice(Math.max(0, gateAt - 12), gateAt + 2).join('\n');
  assert.ok(!/\/api\//.test(gateBlock),
    'the login gate carries an /api/ exemption — that reopens the bypass for whatever it names');
});

// The off-box page ingest is dispatched ABOVE the gate on purpose: its sender is a LaunchAgent
// with no session, and it has to deliver while the panel's own login store is unusable. That
// exemption is only safe while the route authenticates itself, so both halves are pinned here —
// the position AND the token. Dropping the token check would leave a public write endpoint whose
// only tell is an unset environment variable.
test('the off-box ingest sits above the CSRF and login gates, and authenticates itself there', () => {
  const ingestAt = LINES.findIndex((l) => l.includes('offboxIngest({ req, res, pathname'));
  const csrfAt = LINES.findIndex((l) => l.includes("!csrfOk(req)"));
  assert.ok(ingestAt > -1, 'the off-box ingest dispatch was not found in serve.mjs');
  assert.ok(csrfAt > -1, 'the CSRF gate was not found — update this test with the gate');
  assert.ok(ingestAt < csrfAt, `the ingest dispatches at line ${ingestAt + 1}, below the CSRF gate at ${csrfAt + 1}: a LaunchAgent carries no CSRF token and every page would be refused`);
  assert.ok(ingestAt < gateAt, `the ingest dispatches at line ${ingestAt + 1}, below the login gate at ${gateAt + 1}`);

  const mod = readFileSync(join(HERE, '..', 'routes', 'offbox.mjs'), 'utf8');
  assert.match(mod, /authorize\(req, env\)/, 'handleIngest must authorize before it reads a body');
  assert.match(mod, /timingSafeEqual/, 'the token comparison must not be a plain ===');
  assert.match(mod, /no-token-configured/, 'an undeclared token must close the route, never open it');
  assert.match(mod, /offboxHosts\(env\)\.has\(host\)/, 'the exemption must be confined to the offbox hostname');
});

test('the only modular routes outside /api/ are the authenticated docsite, launchlist and off-box pages', () => {
  const dir = join(HERE, '..', 'routes');
  const paths = new Set();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const s = readFileSync(join(dir, f), 'utf8');
    for (const m of s.matchAll(/path:\s*'([^']+)'/g)) paths.add(m[1]);
  }
  assert.ok(paths.size > 0, 'no modular route paths were found — the extractor is broken, not the routes');
  const nonApi = [...paths].filter((p) => !p.startsWith('/api/')).sort();
  const docsiteSurface = [
    '/docsite/edit', '/docsite/index', '/docsite/page', '/docsite/preview-shell',
    '/edit-assets/editor.js', '/edit-assets/editor.css', '/edit-assets/page.css',
    '/edit-assets/tokens.css', '/edit-assets/docsite-md.mjs',
    '/edit-assets/render-markdown.mjs', '/edit-assets/html-escape.mjs',
  ];
  const launchlistSurface = ['/launchlist', '/launchlist/'];
  const offboxSurface = ['/offbox', '/offbox/'];
  assert.deepEqual(nonApi, [...docsiteSurface, ...launchlistSurface, ...offboxSurface].sort(),
    'the authenticated non-API surface changed; declare the exact docsite route here or move an '
    + 'accidental route under /api/. Dispatch must remain behind the login gate.');
});

test('the login page and its assets stay reachable without a session', () => {
  const m = SRC.match(/PUBLIC_ASSETS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, 'PUBLIC_ASSETS was not found — the login page cannot style itself without it');
  const assets = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  // The gate serves the login page for text/html, so the page itself needs no entry; its stylesheet
  // does, or an unauthenticated visitor gets unstyled markup on a public hostname.
  assert.ok(assets.includes('/static/panel.css'), 'the panel stylesheet must stay public');
  assert.ok(SRC.includes("req.url.startsWith('/auth/')"),
    '/auth/* must stay exempt or there is no way to sign in');
});
