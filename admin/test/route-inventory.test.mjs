// admin — the route inventory, as a ratchet.
//
// WHY THIS EXISTS. admin/serve.mjs is being decomposed: routes and helpers move out to
// admin/routes/*.mjs and admin/lib/*.mjs a slice at a time. The failure mode of that work is not a
// crash — it is a route that quietly stops being served, which looks exactly like a route nobody
// happened to call today. The panel's own test suite cannot be the safety net for this: measured
// 2026-09-02, ~277 of the admin tests already fail on Windows for platform reasons, so "the tests
// still fail the same way" proves nothing about whether a route survived.
//
// So the inventory is counted from BOTH places a route can live — the modular `routes` exports and
// the inline `pathname ===` / `.startsWith()` comparisons in serve.mjs — and the sum is checked
// against a floor. Counting both is what makes this a refactor net rather than a tripwire: moving a
// route from the inline chain into a module is invisible here (correct — nothing was lost), while
// dropping one on the way is not.
//
// A RATCHET, NOT A SNAPSHOT. Adding routes must never fail this test — a co-session lands new ones
// most days, and a pin that breaks on growth gets deleted within the week. Loss is what fails:
// the named MUST_SERVE surface, and a floor under the total.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HERE, '..');

// Routes declared by the modular groups — the dispatch contract in admin/routes/posture.mjs:
// each module exports `routes: [{method, path, handle}]`.
async function modularRoutes() {
  const out = [];
  for (const f of readdirSync(join(ADMIN, 'routes')).filter((n) => n.endsWith('.mjs')).sort()) {
    const mod = await import(new URL(`../routes/${f}`, import.meta.url).href);
    for (const r of mod.routes || []) out.push({ method: r.method, path: r.path, from: `routes/${f}` });
  }
  return out;
}

// Routes still handled inline in serve.mjs. Read from SOURCE rather than by booting the server:
// the point is to compare the declared surface across a refactor, and booting would additionally
// require an auth store, a registry and two free ports — none of which this question needs.
// fact: auth routes dispatch by hand, like serve.mjs
const inlineSource = () => ['serve.mjs', 'routes/auth.mjs'].map((f) => readFileSync(join(ADMIN, f), 'utf8')).join('\n');

function inlineRoutes(src) {
  const paths = new Set();
  for (const m of src.matchAll(/pathname\s*===\s*'([^']+)'/g)) paths.add(m[1]);
  for (const m of src.matchAll(/pathname\.startsWith\('([^']+)'\)/g)) paths.add(m[1]);
  return [...paths].sort().map((p) => ({ method: '*', path: p, from: 'serve.mjs (inline)' }));
}

// The surface whose disappearance is an outage, not a diff. Deliberately short and deliberately
// hand-picked: a list of everything would be a snapshot by another name and would churn daily.
const MUST_SERVE = [
  '/api/csrf',        // every mutating route is gated on this; losing it bricks all of them
  '/api/state',       // the panel's primary payload
  '/api/status',      // job polling — the live console reads this
  '/api/status/events', // the SSE stream behind the live tail
  '/api/sweep/stop',  // a running sweep must remain stoppable
  '/auth/login',
  '/auth/logout',
  '/auth/session',
  '/auth/bootstrap',  // without it a fresh install can never mint its first operator
  '/api/panel/health',
];

// Floors, set EXACTLY at the measured inventory: 191 modular + 31 inline = 222 (2026-10-08,
// GET /api/correlations/coincidence, /divergence, /anomalies, /undetermined-history and
// /ratchet-history, the correlations view — routes/correlations.mjs).
// Raised from 186 + 31 = 217 (2026-10-08,
// GET /api/cra/evidence, the CRA evidence pack's freshness — routes/cra.mjs).
// Raised from 185 + 31 = 216 (2026-10-08,
// GET and POST /api/journey, the guided setup — routes/journey.mjs).
// Raised from 183 + 31 = 214 (2026-10-07,
// POST /api/issues/fix-bulk, one result per row with a stale-read refusal).
// Raised from 182 + 31 = 213 (2026-10-07,
// GET /api/annotations/scanner/coverage, coverage measured before a suppression is written).
// Raised from 181 + 31 = 212 (2026-10-07,
// GET /api/feed and /api/feed/group, the one findings feed — routes/feed.mjs).
// Raised from 179 + 31 = 210 (2026-10-07,
// GET /api/palette, the command palette's index — routes/palette.mjs).
// Raised from 178 + 31 = 209 (2026-10-07,
// GET and POST /api/features, the experimental feature flags).
// Raised from 176 + 31 = 207 (2026-10-07,
// POST /api/integrations/vulncheck/refresh, which fetches the KEV catalogue the rollup reads).
// Raised from 175 + 31 = 206 (2026-10-04, GET /api/scan-path/briefs and /api/scan-path/brief).
// Raised from 173 + 31 = 204 (2026-10-03, GET /api/daily).
// Raised from 147 + 45 = 192 when handleRequest's inline /api/* routes moved to routes/jobs.mjs,
// panel-process.mjs, panel-state.mjs, issues.mjs and renovate.mjs: 14 counted inline paths became
// 25 modular entries. The other 11 were always served but never counted, because they matched on
// req.url.startsWith or a regex: /api/lane-timing, /api/sweep, five /api/health/<kind> and four
// renovate paste/clear method-path pairs.
// Raised before that from 145 + 45 = 190 when routes/scan-path.mjs brought back GET and POST /api/scan-path
// (operator ruling 2026-09-28: scan a path, operator port only; admin/SPEC-scan-path.md).
// Raised before that from 145 + 44 = 189 when serve.mjs gained GET /static/house.css, the house sheet.
// Raised before that from 142 + 44 = 186 when routes/remediation.mjs gained GET /api/remediation/inputs and
// GET /api/remediation/fleet (the per-project inputs strip and the all-projects page).
// Raised before that from 133 + 43 = 176, deliberately: merging main again brought
// routes/scanners.mjs (+8: /api/scanners, /provenance, GET+POST /action, /config and
// /repos), POST /api/overwatch-layer/launch (+1), and the
// `!pathname.startsWith('/svc/')` header exemption (+1 inline). That last is a guard, not a new
// route: it names the /svc bridge, whose own dispatch is a regex this counter does not read.
//
// The first version of this file set them 18 below the measurement, reasoning that slack keeps
// ordinary churn from tripping the test. The positive control at the bottom of this file then
// PASSED with an entire route module deleted, which is the whole defect: a guard that cannot fail
// on the thing it guards is a streak, not a floor. Slack bought nothing, because `>=` only trips on
// a DECREASE — adding routes raises the real count harmlessly above an exact floor.
//
// So: exact. When routes are deliberately removed, lower these deliberately, in the same commit,
// with the reason — that friction is the feature. Never lower one to make a red test green.
const TOTAL_FLOOR = 222;
const MODULAR_FLOOR = 191;

test('every route whose loss would be an outage is still declared', async () => {
  const src = inlineSource();
  const all = [...await modularRoutes(), ...inlineRoutes(src)];
  const paths = new Set(all.map((r) => r.path));
  const missing = MUST_SERVE.filter((p) => !paths.has(p));
  assert.deepEqual(missing, [], `these routes are no longer served anywhere: ${missing.join(', ')}`);
});

test('the total route inventory has not shrunk below its floor', async () => {
  const src = inlineSource();
  const modular = await modularRoutes();
  const inline = inlineRoutes(src);
  const total = modular.length + inline.length;
  assert.ok(total >= TOTAL_FLOOR,
    `route inventory fell to ${total} (floor ${TOTAL_FLOOR}): ${modular.length} modular + ${inline.length} inline. `
    + 'A refactor that MOVES a route keeps this number; one that drops a route lowers it.');
  assert.ok(modular.length >= MODULAR_FLOOR,
    `modular route entries fell to ${modular.length} (floor ${MODULAR_FLOOR}) — a route module stopped exporting.`);
});

test('POSITIVE CONTROL: the floor FAILS when a route module goes missing', async () => {
  // The floors above are only worth their line count if they can go red. This asserts the
  // arithmetic that makes them able to: drop the smallest possible module — one route — and the
  // modular floor must already be breached. Checked against the counting function itself rather
  // than by moving a file, so the control cannot leave the tree dirty if it throws mid-test.
  const modular = (await modularRoutes()).length;
  assert.equal(modular, MODULAR_FLOOR,
    `the modular floor must sit EXACTLY at the measured count, or losing a module goes undetected. `
    + `Measured ${modular}, floor ${MODULAR_FLOOR} — reconcile them deliberately.`);
  assert.ok(modular - 1 < MODULAR_FLOOR,
    'losing a single one-route module must breach the floor; it does not, so the floor is slack');
});

test('every modular route declares a method and an exact path', async () => {
  // The dispatcher matches `r.method === req.method && r.path === pathname` — a group that
  // exports a route missing either field is silently unreachable, which is the same
  // invisible-loss shape this file exists to catch.
  const bad = (await modularRoutes()).filter((r) => !r.method || !r.path || !r.path.startsWith('/'));
  assert.deepEqual(bad, [], `route entries missing method/path: ${JSON.stringify(bad)}`);
});

test('no two modular routes claim the same method+path — the first would silently win', async () => {
  const seen = new Map();
  const dupes = [];
  for (const r of await modularRoutes()) {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) dupes.push(`${key} (${seen.get(key)} and ${r.from})`);
    else seen.set(key, r.from);
  }
  // The dispatcher stops at the first match, so a duplicate is not an error anywhere — the second
  // handler simply never runs, and nothing says so.
  assert.deepEqual(dupes, [], `duplicate route declarations: ${dupes.join('; ')}`);
});
