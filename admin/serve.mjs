#!/usr/bin/env node
/**
 * commitwork admin panel — local server (zero-dependency).
 * Serves admin/index.html and a live /api/state assembled from the monitor's own report
 * artifacts (rollup.json + reports/runtime-latest + the latest CodeQL fleet run), and can
 * trigger a sweep. Bind is localhost-only.
 *
 * usage:  node admin/serve.mjs [port]      →  http://127.0.0.1:7878
 */
import { esc } from '../lib/html-escape.mjs';
import http from 'node:http';
import { quotedArgv } from '../lib/posix-shell.mjs';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, readdirSync, openSync, renameSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname, normalize, relative } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { projectSlug } from '../monitor/project-scope.mjs';
import { classifyWho } from '../monitor/attribution.mjs';
// manifestFiles/manifestSummary come from here rather than being declared below, as
// they were until 2026-09-04. Both files had a copy and they had DRIFTED: measured against all five
// manifests, this module's manifestSummary returns `aliasOf` and `formatNotes` per check and the
// copy in serve.mjs did not — so the config page's scanner roster was assembled by an older
// implementation than the posture route used, from the same manifests. manifestFiles is identical
// (this one additionally takes an optional filter, unused here). registry()/registryStale() are
// deliberately NOT taken from here: those two have drifted in SEMANTICS, not staleness — serve.mjs
// throws at boot on a corrupt registry and keeps a last-good snapshot, and adopting the other
// shape would change how this process starts.
import {
  manifestFiles, manifestSummary,
  // reportsFor CARRIES A FIX this file did not have. Its containment check was
  // `dir.startsWith(root + '/')`, which is false for EVERY path on Windows because join() produces
  // backslashes — so reportsFor returned UNRESOLVED for every project, readJSON yielded null, and
  // the panel rendered every area as "not scanned". Grey for the wrong reason, and indistinguishable
  // from an area that genuinely had never been swept. core.mjs uses withinRoot() from
  // lib/path-contain.mjs instead. Verified on this box: serve's check rejected all three example
  // areas, core's resolved each to its own report directory.
  reportsFor, readJSON, readTxt,
} from './lib/core.mjs';
import { loginPage } from './lib/login-page.mjs';
import { readPanelDocument, inlineStyleSources } from './lib/panel-document.mjs';
import { importClosure } from './lib/panel-closure.mjs';
import { initStateView } from './lib/state-view.mjs';
import { authHandle, AUTH_UNHANDLED } from './routes/auth.mjs';
import { loadRegistry, areaOf, areaBySlug, areaOut, primaryArea, registryPath } from '../monitor/registry.mjs';
import { resolveRepos, expandHome } from '../monitor/discover.mjs';
import { LOCAL_NAMES, operatorPortRoute } from './local-access.mjs';
// D3 divergence, joined at RENDER time and deliberately not in the rollup. The scores live in the
// nondeterministic (G2) store, which sits OUTSIDE reportsRoot precisely so the deterministic rollup's
// readdirSync can never reach them — nondeterministic-store.mjs's own header forbids it sharing the
// rollup graph, "the whole point is that they cannot". So the join happens HERE, where a render may
// legitimately vary, rather than in rollup.json where it would break rerollup byte-identity.
import { routes as postureRoutes } from './routes/posture.mjs';
import { routes as reportRoutes } from './routes/report.mjs';
import { routes as remediationRoutes } from './routes/remediation.mjs';
import { routes as a11yRoutes } from './routes/a11y.mjs';
import { routes as profileRoutes } from './routes/profile.mjs';
import { routes as configEditRoutes } from './routes/config-edit.mjs';
import { routes as scanConfigRoutes } from './routes/scan-config.mjs';
import { routes as ingestRoutes } from './routes/ingest.mjs';
import { routes as secretsRoutes } from './routes/secrets.mjs';
import { routes as leaksCheckRoutes } from './routes/leaks-check.mjs';
import { routes as leaksVerifyRoutes } from './routes/leaks-verify.mjs';
import { routes as issueDetailRoutes } from './routes/issue-detail.mjs';
import { routes as rollupsRoutes } from './routes/rollups.mjs';
import { routes as craRoutes } from './routes/cra.mjs';
import { routes as determinationRoutes } from './routes/determinations.mjs';
import { routes as remediationPolicyRoutes } from './routes/remediation-policy.mjs';
import { routes as llmRuntimeRoutes } from './routes/llm-runtime.mjs';
import { routes as annotationRoutes } from './routes/annotations.mjs';
import { routes as oversightRoutes } from './routes/oversight.mjs';
import { routes as correlationRoutes } from './routes/correlations.mjs';
import { routes as hostRoutes } from './routes/host.mjs';
import { routes as verdictRoutes } from './routes/verdicts.mjs';
import { routes as packageRoutes } from './routes/packages.mjs';
import { routes as updateRoutes } from './routes/updates.mjs';
import { routes as codeqlRemediationRoutes } from './routes/codeql-remediation.mjs';
import { routes as cobolworkRemediationRoutes } from './routes/cobolwork-remediation.mjs';
import { routes as projectsViewRoutes } from './routes/projects-view.mjs';
import { routes as fleetOverviewRoutes } from './routes/fleet-overview.mjs';
import { routes as settingsRoutes } from './routes/settings.mjs';
import { routes as agentSurfaceRoutes } from './routes/agent-surface.mjs';
import { routes as perfRoutes } from './routes/perf.mjs';
import { routes as scannerRoutes } from './routes/scanners.mjs';
import { routes as scanPathRoutes } from './routes/scan-path.mjs';
// Loopback-only by construction — see the header of that file for why transcript-derived data does
// not travel through the published tunnel even behind auth.
import { routes as turnsRoutes } from './routes/turns.mjs';
import { routes as commentRoutes } from './routes/comments.mjs';
import { routes as learningRoutes } from './routes/learning.mjs';
import { routes as featuresRoutes } from './routes/features.mjs';
import { routeFlagOff, offBody } from '../lib/feature-flags.mjs';
import { routes as overwatchLayerRoutes } from './routes/overwatch-layer.mjs';
import { routes as docsiteRoutes, docsiteHandle, docsiteOrigins, docsiteHosts } from './routes/docsite.mjs';
import { routes as launchlistRoutes, launchlistHosts } from './routes/launchlist.mjs';
import { routes as offboxRoutes, offboxHosts, handleIngest as offboxIngest } from './routes/offbox.mjs';
import { routes as jobRoutes, initJobRoutes } from './routes/jobs.mjs';
import { routes as panelProcessRoutes, initPanelProcessRoutes } from './routes/panel-process.mjs';
import { routes as panelStateRoutes, initPanelStateRoutes } from './routes/panel-state.mjs';
import { routes as issuesRoutes } from './routes/issues.mjs';
import { routes as dailyRoutes } from './routes/daily.mjs';
import { routes as renovateRoutes } from './routes/renovate.mjs';
import { routes as paletteRoutes } from './routes/palette.mjs';
import { routes as feedRoutes } from './routes/feed.mjs';
import { routes as journeyRoutes } from './routes/journey.mjs';
import { initJobs, knownProjects, trigger } from './lib/jobs.mjs';
import { needsBootstrap, externalSsoAllowed } from './auth.mjs';
import { annotationsPathFor, gateExemptionsPathFor, stubAllowlistPathFor } from '../monitor/store-paths.mjs';
import { persistSessions, sessionStorePath } from './sessions.mjs';
import { initAuthSession, oauthConfigured, githubLinkBlocked, b64url, ssoPending, oauthSessions, pruneOauth, adminSession, safeStrEq } from './lib/auth-session.mjs';
import { SCANNER_SPECS } from '../monitor/extractors.mjs'; // the canonical category set
import { laneView } from '../monitor/lane-tabs.mjs'; // every lane is routable
import { useScopedDockerConfig } from '../lib/docker-config.mjs';
import { THEME_HEAD, THEME_SWITCH } from './lib/theme-head.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// The static root, read at CALL time so a test can point it somewhere writable. It was
// join(HERE, "static") inline at every asset route, and the absence of any override is why
// admin/test/static-asset-404.test.mjs built a whole detached worktree just to delete one file:
// with no writable root there was nowhere to stage an absent asset that did not race the other
// sessions on this tree. That worktree spliced working-tree serve.mjs over an otherwise-HEAD
// checkout, producing a tree that has never existed — it failed on an import HEAD could not
// resolve while BOTH real trees were consistent. A defect belonging to neither tree is
// unattributable by construction, so the fixture is now a temp directory and the splice is gone.
const STATIC_DIR = () => process.env.CW_ADMIN_STATIC || join(HERE, "static");
const CW = resolve(HERE, '..');

// ── process health: is the RUNNING code the code ON DISK? ──────────────────────────────────────
// Routes load at boot; index.html is read from disk per request. That split means a freshly
// edited panel serves new UI against old routes, and the first symptom is a route 404 the UI can
// only misreport (measured 2026-08-20: a day of remediation routes answered "not found" from a
// process started the previous evening). The stamp below is taken ONCE at boot and re-taken on
// every /api/panel/health call — a mismatch is the panel saying "restart me", by name.
const BOOT_AT = new Date().toISOString();
// CONTENT, NOT MTIME. This hashed the mtime until 2026-09-02, and mtime answers "was this file
// written" rather than "is this file different" — `git checkout`, a rebase, a formatter and a peer
// saving without editing all bump it. On a tree ~28 sessions share that is not a rare edge:
// measured the same day against a 5-hour-old panel, 8 of 32 watched files had newer mtimes and
// THREE OF THE SIX CHECKED WERE BYTE-IDENTICAL TO HEAD. Half the staleness was files nobody changed.
//
// That is the expensive direction for this particular signal. "Restart me" is a prompt to a human,
// and a prompt that cries wolf on every peer's checkout stops being read — at which point the real
// mismatch, the one where a freshly edited panel serves new UI against old routes, arrives into an
// indicator nobody trusts. A false positive here does not merely add noise, it disarms the alarm.
const fileDigest = (p) => {
  try { return createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16); }
  catch (e) { return e.code === 'ENOENT' ? null : 'UNREADABLE'; }
  // ENOENT is a real absence and compares equal across boots; anything else is a READ FAILURE and
  // must not share an answer with it, or a permission error reads as "file removed, nothing changed"
};
// fact: the closure reaches lib/, monitor/, bin/, cra/
const CODE_CLOSURE = importClosure(join(HERE, 'serve.mjs'));
function codeStamp() {
  const files = {};
  const scan = (dir, prefix) => {
    let names = [];
    try { names = readdirSync(dir).filter((n) => n.endsWith('.mjs')); } catch (e) { files[`${prefix}*`] = `unreadable:${e.code || 'error'}`; return; }
    for (const n of names) files[prefix + n] = fileDigest(join(dir, n));
  };
  for (const f of ['serve.mjs', 'auth.mjs', 'rp-origin.mjs']) files[f] = fileDigest(join(HERE, f));
  scan(join(HERE, 'lib'), 'lib/');
  scan(join(HERE, 'routes'), 'routes/');
  for (const f of CODE_CLOSURE.files) {
    const key = relative(HERE, f);
    if (!(key in files)) files[key] = fileDigest(f);
  }
  return files;
}
const BOOT_CODE = codeStamp();

// THE BASELINE IS ALSO WRITTEN TO DISK, and the reason is not that memory is the wrong place to
// compare from — it is the right place, because BOOT_CODE is by definition what THIS process
// loaded. The reason is that in memory it is the only copy, and it dies with the process that
// holds it. So a panel can sit stale for a day, get restarted, and leave nothing behind saying it
// ever was: the evidence is destroyed by the very act the evidence was asking for.
//
// With the previous stamp on disk, a fresh boot can answer the question the restart was FOR —
// did it actually pick anything up — instead of only ever answering about itself. A restart that
// changes nothing and a restart that loads a day of edits are indistinguishable without it.
const CODE_STAMP_FILE = process.env.CW_PANEL_CODE_STAMP
  || join(HERE, '..', '.claude', 'store', 'panel-code-stamp.json');
const PREV_BOOT = (() => {
  try { return JSON.parse(readFileSync(CODE_STAMP_FILE, 'utf8')); }
  catch (e) { return e.code === 'ENOENT' ? null : { unreadable: true }; }
  // absent = first boot on this machine, a real and expected state. Unreadable is NOT that, and
  // reporting it as "no previous boot" would be the same false-clean this file is full of notes about
})();
try {
  mkdirSync(dirname(CODE_STAMP_FILE), { recursive: true });
  const tmp = `${CODE_STAMP_FILE}.${process.pid}.tmp`;   // tmp+rename: a torn stamp is worse than none
  writeFileSync(tmp, JSON.stringify({ pid: process.pid, bootAt: BOOT_AT, files: BOOT_CODE }, null, 2));
  renameSync(tmp, CODE_STAMP_FILE);
} catch { /* the stamp is observability, never a boot blocker */ }

function codeHealth() {
  const now = codeStamp();
  const diff = (a, b) => {
    const out = [];
    for (const f of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) if (a?.[f] !== b?.[f]) out.push(f);
    return out.sort();
  };
  const changed = diff(BOOT_CODE, now);
  // What the RESTART achieved, which nothing could answer while the baseline lived only in memory.
  const prev = PREV_BOOT?.unreadable ? { known: false }
    : PREV_BOOT ? { known: true, bootAt: PREV_BOOT.bootAt, pid: PREV_BOOT.pid, pickedUp: diff(PREV_BOOT.files, BOOT_CODE) }
    : { known: true, firstBoot: true };
  return {
    watched: Object.keys(BOOT_CODE).length,
    unread: CODE_CLOSURE.unknown.map((u) => relative(HERE, u.file)),
    stale: changed.length > 0,
    changed,
    basis: 'sha256-content',   // named so a consumer cannot mistake this for the old mtime answer
    previous: prev,
  };
}
// Point docker/trivy/grype at commitwork's own docker config before anything spawns them —
// see lib/docker-config.mjs. The agents get this declared on their plist; a hand-run scan got
// it from nowhere, which is why the App Data prompt outlived the fleet fix.
useScopedDockerConfig();
const PORT = +(process.argv[2] || process.env.CW_ADMIN_PORT || 7878);
// ── the test-context port guard (substrate's tidal hang, the commitwork twin) ───────────────────
// node --test exports NODE_TEST_CONTEXT and spawned children inherit it. A test that spawns this
// panel without choosing a port gets the FLEET's port and races the live panel — a multi-minute
// hang, not an error. Refuse in milliseconds with the fix named. Every existing harness already
// passes CW_ADMIN_PORT (25/25 measured 2026-09-06); a deliberate live-port test sets
// CW_TEST_PORTS_OK=1.
if (process.env.NODE_TEST_CONTEXT && !process.env.CW_TEST_PORTS_OK && !(process.argv[2] || process.env.CW_ADMIN_PORT)) {
  console.error('[admin] REFUSING TO START under node --test on the default port — a spawned panel would race the live one on :7878 for minutes instead of failing. Pass an ephemeral CW_ADMIN_PORT (the harnesses all do), or set CW_TEST_PORTS_OK=1 for a deliberate live-port test.');
  process.exit(2);
}
// The OPERATOR port. Declared here rather than beside its boot-time check because the bootstrap
// and sign-in copy has to name it, and naming the wrong port is not a cosmetic error: bootstrap is
// refused anywhere except this port, so telling someone to open the published one sends them to a
// page that will keep refusing them with no indication why. See assertOperatorPortUnroutable().
const LOCAL_PORT = +(process.env.CW_ADMIN_LOCAL_PORT || (PORT + 1));

// The vendored IBM Plex faces. ONE DECLARED LIST, not a directory surface: this repo's rule is that
// view modules are exact-match routes and never a static directory, because a directory route
// serves whatever lands in the folder, decided by whoever dropped the file rather than by anyone
// reading this line. A frozen list of exact filenames is the same guarantee for eight of them.
// It also feeds PUBLIC_ASSETS below and admin/test/fonts-reachable.test.mjs, so the set of fonts
// panel.css asks for, the set the server will send, and the set that is readable without a session
// are ONE list rather than three that have to be kept in step by memory.
const FONT_ASSETS = Object.freeze([
  '/static/fonts/IBMPlexSans-Regular-Latin1.woff2',
  '/static/fonts/IBMPlexSans-Italic-Latin1.woff2',
  '/static/fonts/IBMPlexSans-Medium-Latin1.woff2',
  '/static/fonts/IBMPlexSans-SemiBold-Latin1.woff2',
  '/static/fonts/IBMPlexSans-Bold-Latin1.woff2',
  '/static/fonts/IBMPlexMono-Regular-Latin1.woff2',
  '/static/fonts/IBMPlexMono-SemiBold-Latin1.woff2',
  '/static/fonts/IBMPlexMono-Bold-Latin1.woff2',
]);
const FONT_SET = new Set(FONT_ASSETS);

// View modules are authenticated assets, but their filenames are still an explicit publication
// boundary. Keep the declaration and route in one place so adding a script tag without declaring
// its file fails closed, and dropping an arbitrary .js file into static/ never publishes it.
const STATIC_JS_MODULES = Object.freeze([
  'comments.js',
  'learning.js',
  'features.js',
  'overwatch-layer.js',
  'bola.js',
  'qrcode.mjs',
  'perf-console.js',
  // The panel client, as classic scripts in load order. A function declaration hoists only within
  // its own script, so the boot call lives in panel-boot.js, after every file that declares a loader.
  'panel-core.js',
  'panel-console.js',
  'panel-posture.js',
  'panel-views.js',
  'panel-router.js',
  'panel-features.js',
  'panel-settings.js',
  'panel-palette.js',
  'panel-feed.js',
  'panel-journey.js',
  'panel-correlations.js',
  'panel-boot.js',
]);
const STATIC_JS = new Set(STATIC_JS_MODULES.map((name) => `/static/${name}`));

// Static assets reachable WITHOUT a session, because the unauthenticated login page requests them.
// Exact paths only: this set is a gate, and a gate that ends in a prefix match is trusting whatever
// routing happens after it. Everything here is a brand mark already visible to anyone who can load
// the login page, so serving it unauthenticated discloses nothing the page does not.
const PUBLIC_ASSETS = new Set([
  '/static/panel.css',
  '/static/panel-light.css',
  // CVD palettes. Public for the same reason the two above are: they are referenced by the login
  // page's stylesheet chain, and a vision selection must survive the unauthenticated view rather
  // than snapping back to the default palette at the one screen a reader meets first.
  '/static/panel-cvd.css',
  '/static/panel-cvd-light.css',
  '/static/config.css',
  '/static/theme.css',
  '/favicon.ico',
  '/cw-favicon.svg',
  '/cw-favicon-32.png',
  // Applies the stored Appearance choice on the login page before first paint.
  '/static/theme-switch.js',
  // IBM Plex (OFL 1.1), referenced by panel.css — which the login page loads. Behind the gate they
  // would 401, and a woff2 that 401s does not fail loudly: the browser silently falls through to
  // the next family in the stack, so the login screen would render in a different typeface from
  // every page after it and nothing anywhere would say why. Public discloses nothing — these are
  // upstream bytes anyone can fetch from npm, and the login page already serves the brand marks
  // above on the same reasoning.
  ...FONT_ASSETS,
]);
// Default report dir, for the module-level paths that are not per-project (the renovate paste
// ledger); per-project reads go through reportsFor().
//
// It resolves NOWHERE on purpose. This was `join(CW, 'reports', 'clientA-monorepo')` — a bare
// literal with no registry read. FOUR of reportsFor()'s five returns are error paths, so a null,
// malformed or erroring resolution served the FLEET's severity counts under whatever project the
// operator had selected: plausible numbers, wrong subject. A void must not be another area's
// directory and must not be a real one either — readJSON yields null, callers get {}, and the panel
// renders "not scanned", the same answer reportsFor gives a known-but-never-swept project. Never
// created on disk; if it exists, something is writing into a resolution failure.

/**
 * Report directory for a project, from the registry — `areas[].out` via
 * areaOut(), falling back to the project slug (matching sweep.mjs's areaOut
 * routing). Pinning this to one directory made every per-area sweep invisible:
 * reports/<area>/rollup.json existed on disk but nothing served it, so the
 * picker could offer a project while the numbers below it still described
 * whichever area last wrote clientA-monorepo.
 */

// ── REGISTRY ACCESSOR (R18) ─────────────────────────────────────────────────────────────────────
// This was `const REGISTRY = loadRegistry()` — one read, at boot, for the life of the process.
//
// WHY IT HAD TO CHANGE FIRST. Five separate items in this remediation write monitor/projects.json.
// Against a boot-time snapshot the operator makes the edit, reloads the panel, sees nothing change,
// and concludes the fix failed — five times, for five different fixes. An accessor landed late is
// an accessor that arrives after it was needed.
//
// A corrupt registry still throws at STARTUP: that check is deliberate and is preserved below, so
// the panel refuses to boot on a broken registry rather than serving a silently empty fleet.
//
// But a re-read at REQUEST time must not have that power. Two distinct hazards:
//   1. an mtime-triggered read can observe a HALF-WRITTEN file, and a transient parse failure must
//      not take down a running panel;
//   2. a genuinely broken edit should be visible as a problem, not as an empty fleet — empty reads
//      as "nothing deployed", which is the silent-green shape this whole programme exists to kill.
// So a failed re-read keeps serving the LAST GOOD registry and records why, and the failure is
// surfaced rather than swallowed.
const REGISTRY_BOOT = loadRegistry();   // throws at startup on a corrupt registry — deliberate
let _regCache = REGISTRY_BOOT;
let _regMtime = (() => { try { return statSync(registryPath()).mtimeMs; } catch { return 0; } })();
let _regStale = null;                   // { at, error } while serving a last-good snapshot

function registry() {
  let mtime;
  try { mtime = statSync(registryPath()).mtimeMs; }
  catch (e) {
    // The file vanished mid-flight (a non-atomic writer, a mid-edit save). Keep the last good one.
    _regStale = { at: new Date().toISOString(), error: `registry unreadable: ${e.code}` };
    return _regCache;
  }
  if (mtime === _regMtime) return _regCache;
  try {
    const fresh = loadRegistry();
    _regCache = fresh; _regMtime = mtime; _regStale = null;
    return fresh;
  } catch (e) {
    // Do NOT advance _regMtime: the next request retries, so a half-written file that lands
    // complete a moment later is picked up without needing a restart.
    _regStale = { at: new Date().toISOString(), error: e.message };
    console.warn(`[panel] registry re-read failed, serving last-good snapshot: ${e.message}`);
    return _regCache;
  }
}
// Exposed so a route can tell the operator the panel is serving a stale registry rather than
// letting them read numbers that silently describe a registry they already replaced.
const registryStale = () => _regStale;

// HTTP services the panel BRIDGES under tabs (localhost only). /svc/<name>/* reverse-proxies here,
// stripping frame-blocking headers so each iframes cleanly on the panel's single port.
const SERVICES = {
  gateway: process.env.CW_SVC_GATEWAY || 'http://localhost:8080',
  keycloak: process.env.CW_SVC_KEYCLOAK || 'http://localhost:8180',
  consul: process.env.CW_SVC_CONSUL || 'http://localhost:8500',
};
initAuthSession({ port: PORT, localPort: LOCAL_PORT });
// ── CSRF for state-changing routes ──────────────────────────────────────────────────────────────
// The mutating routes (sweep/health triggers, renovate paste, logout) run commands and write files.
// Loopback bind is NOT a defence against CSRF: any page the operator visits can issue a cross-origin
// POST to 127.0.0.1 and the browser will send it. Two independent checks, both cheap:
//   1. a per-process token that must arrive in x-cw-csrf. A cross-origin page cannot read the token
//      from /api/csrf (CORS withholds the response body) and the custom header itself forces a
//      preflight that this server never approves.
//   2. Origin/Referer, when present, must be this panel's own origin.
// Same-origin fetches from the panel's own JS satisfy both.
const CSRF_TOKEN = b64url(randomBytes(24));
// SAME-ORIGIN BY COMPARISON, not by allowlist. This used to hold a fixed list of loopback
// origins, which silently rejected every legitimate request once the panel was published: a
// browser on https://commitwork.portll.net sends that Origin, which was not in the list, so
// signing in through the tunnel failed CSRF. Enumerating hostnames is also the wrong shape —
// the panel may be reached on any name its ingress routes.
//
// The general rule: the request's Origin (or Referer) must have the SAME host as the request's
// own Host header. A cross-origin attacker page sends its own Origin while the Host stays this
// panel's, so the mismatch still rejects it — and the x-cw-csrf header requirement stands
// independently, forcing a preflight this server never approves.
function csrfOk(req) {
  const origin = req.headers.origin || (req.headers.referer ? (() => {
    try { return new URL(req.headers.referer).origin; } catch { return 'invalid'; }
  })() : null);
  if (origin) {
    let originHost;
    try { originHost = new URL(origin).host.toLowerCase(); } catch { return false; }
    const reqHost = String(req.headers.host || '').toLowerCase();
    // loopback aliases stay interchangeable so CLI/tooling against 127.0.0.1 vs localhost works
    const loop = (h) => /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/.test(h);
    const same = originHost === reqHost || (loop(originHost) && loop(reqHost));
    if (!same) return false;
  }
  const t = req.headers['x-cw-csrf'];
  return typeof t === 'string' && safeStrEq(t, CSRF_TOKEN);
}

// PROJECTS used to be its own raw `JSON.parse(readFileSync(...))` with a silent `catch { return {} }`
// — a THIRD registry-reading path in this file, alongside REGISTRY_BOOT/registry() above (R18).
// On a corrupt registry it silently became `{}`, so resolvedRepos()/RETIRED/SUPERSEDED below would
// read "no projects, no exclusions, no lifecycle" instead of failing OR flagging anything: the
// exact empty-registry-reads-as-a-clean-fleet defect this remediation targets, sitting right next
// to the accessor this file already built to fix it. registry() IS that fix — validated at boot
// (throws on a corrupt registry), degrades to a last-good snapshot with a recorded reason on a
// transient re-read failure, never silently empty. Reused here rather than adding a fourth path.

initStateView({ cw: CW, registry, services: SERVICES, registryBoot: REGISTRY_BOOT });
// a friendly placeholder instead of a raw 404 JSON / connection error when a bridged service
// is down or (like the gateway API) has no HTML at its root — the 3 service tabs showed the
// gateway's `{"error":"not found"}` body otherwise.
// codeql[js/reflected-xss]: every call site below passes name/base from the fixed SERVICES map
// (operator env vars, never a request value) and detail from a hardcoded string or a numeric
// HTTP status code — nothing here can carry attacker-controlled HTML.
// ESCAPED, though every argument is currently constrained. `name` is an own key of SERVICES,
// `base` is its hardcoded value, and `detail` is one of three internal strings — so CodeQL's
// js/reflected-xss on this page is a false positive TODAY. It is a false positive because of the
// caller's allowlist, not because of anything here: this function concatenates its arguments
// straight into HTML, so it is one careless caller away from being a real one. Escaping costs
// nothing and moves the guarantee from "the only caller is careful" to "this cannot inject".
function fallbackPage(body) {
  return `<!doctype html><html lang="en"><head><meta charset=utf-8>${THEME_HEAD}</head>`
    + `<body class="fallback">${body}${THEME_SWITCH}</body></html>`;
}
function bridgePlaceholder(name, base, detail) {
  return fallbackPage(`<div><div class="fallback-t">${esc(name)} — ${esc(detail)}</div>`
    + `<div class="fallback-s">${esc(base)}</div>`
    + `<div class="fallback-n">This service is bridged on the panel's port. If it is an API with no web root, open a specific path; if it is not running, start it and refresh.</div></div>`);
}
function proxy(name, base, path, req, res) {
  // HOST CONTAINMENT, structural: `new URL(path, base)` lets a protocol-relative path
  // (/svc/gateway//evil.example.com/x) resolve to an arbitrary origin — an SSRF that forwards
  // this request's Cookie header to that host. Rather than parse-then-check, build the target
  // FROM the configured origin: strip leading slashes/backslashes so the request value can never
  // re-anchor the URL, then append it after the origin — it chooses only path+query.
  let u, origin;
  try {
    origin = new URL(base).origin;
    u = new URL(`${origin}/${String(path).replace(/^[/\\]+/, '')}`);
  } catch { res.writeHead(400); return res.end('bad path'); }
  // fail closed if the containment above is ever wrong — never proxy off the configured origin
  if (u.origin !== origin) {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: `path escapes the '${name}' bridge origin` }));
  }
  // Host and port from the configured base, never from the parsed request URL: the request value
  // supplies the path alone.
  const b = new URL(base);
  const preq = http.request({ protocol: b.protocol, hostname: b.hostname, port: b.port, path: `${u.pathname}${u.search}`,
    method: req.method, headers: { ...req.headers, host: b.host } }, (pres) => {
    const status = pres.statusCode || 502;
    const ct = pres.headers['content-type'] || '';
    // root-path request that comes back as a non-HTML error (e.g. gateway 404 JSON) → placeholder,
    // so the iframe shows a clean message rather than a raw error body
    if (req.method === 'GET' && (path === '/' || path === '') && status >= 400 && !/text\/html/i.test(ct)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(bridgePlaceholder(name, base, `HTTP ${status} at root (no web UI here)`));
    }
    const h = { ...pres.headers };
    delete h['x-frame-options']; delete h['content-security-policy']; delete h['content-security-policy-report-only'];
    // BUGFIX: keep bridged redirects ON the bridge. keycloak answers "302 → /auth" and consul
    // "301 → /ui/"; passed through untouched, the iframe followed them to this panel's own
    // /auth · /ui/ → 404 {"error":"not found"} — i.e. the Services tabs ("tab between them")
    // looked dead for every service that redirects at its root. Rewrite any same-origin
    // Location back under /svc/<name>/ so the browser stays inside the bridge.
    if (h.location) {
      try {
        const lu = new URL(h.location, u);
        if (lu.origin === new URL(base).origin) h.location = `/svc/${name}${lu.pathname}${lu.search}${lu.hash}`;
      } catch { /* unparseable Location — pass through untouched */ }
    }
    res.writeHead(status, h); pres.pipe(res);
  });
  preq.on('error', () => {
    if (res.headersSent) return res.end();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(bridgePlaceholder(name, base, 'not running'));
  });
  // a bridged service that is listening but never responds (wedged) must not hang the iframe
  preq.setTimeout(4000, () => {
    preq.destroy();
    if (res.headersSent) return res.end();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(bridgePlaceholder(name, base, 'not responding (timed out)'));
  });
  req.pipe(preq);
}

// serve the monitor's own report pages (dashboard/timeline/runtime + assets) from this one port,
// so every commitwork view lives behind http://127.0.0.1:PORT — no second static server.
const CTYPE = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
// `project` selects WHICH area's report pages are served. Without it the Dashboard and Runtime
// tabs rendered the default area's HTML no matter what the picker said — the iframe showed one
// project's numbers under another project's name, which is worse than showing nothing.
function serveReport(rel, res, project) {
  const base = reportsFor(project);
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  const full = join(base, safe);
  if (!full.startsWith(base) || !existsSync(full) || statSync(full).isDirectory()) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"not found"}'); }
  res.writeHead(200, { 'content-type': CTYPE[extname(full).toLowerCase()] || 'application/octet-stream' });
  res.end(readFileSync(full));
}

// ── Renovate paste-ingest ─────────────────────────────────────────────────────────────────────
// The parsing moved to admin/lib/renovate-paste.mjs on 2026-09-04 (unchanged, and now unit-tested
// directly rather than only through an HTTP POST). The routes that consume it are below.

// ── config surface (read-only) ──────────────────────────────────────────────────────────────
// Assemble the REAL commitwork config from disk for the /config page: the retention key
// (compact-reports.mjs reads it from projects.json), the scanner roster (manifests/*.json check
// ids + group map), projects.json (projects + exclude + lifecycle), and COUNTS-only for the
// judgment ledgers (annotations / gate-exemptions / stub-allowlist) — those stay display-only,
// edited in-file with provenance, never through a web POST. Every read is server-side and
// defensive (missing file → null / [], never a throw), mirroring state().
// manifestFiles() and manifestSummary() now come from ./lib/core.mjs — see the note
// at that import. They were declared here as well, and the two copies had drifted.

// ── per-repo resolution ─────────────────────────────────────────────────────────────────────
// The global lists (retention / manifests / projects / ledgers) never answered the only question
// an operator actually asks: "for THIS repo, what applies?". This resolves that per name, using
// the SAME code the sweep runs — resolveRepos() for the repo list (explicit entries + `roots`
// auto-discovery, exclude/lifecycle applied) and areaOf/areaOut for ownership and report
// directory. Re-deriving any of it here would let the page disagree with what actually gets
// scanned, which is worse than not showing it at all.
//
// `reg` is the freshly-read projects.json rather than the boot-cached REGISTRY: a config page
// that keeps showing pre-edit config until someone restarts the panel is a lie, and every other
// section on this page already reads from disk per request.
function repoConfig(reg) {
  const HOME = process.env.HOME || '';
  const rel = (p) => (p && HOME && p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p || null);
  const reportsRoot = reg.reportsRoot || 'reports';
  const entries = new Map((reg.projects || []).map((p) => [p.name, p]));

  let resolved = [], superseded = {}, notes = [], error = null;
  try {
    const r = resolveRepos(reg, { selfRoot: CW });
    resolved = r.repos || []; superseded = r.superseded || {}; notes = r.notes || [];
  } catch (e) { error = e.message; }

  // Area OUTPUT for a repo, byte-for-byte the sweep's rule (sweep.mjs: `r.area || areaSlugOf(name)`,
  // and areaSlugOf is areaOf). Unresolvable ⇒ null — never a guessed default, same as areaOut().
  const areaFacts = (name, declaredArea) => {
    const slug = declaredArea || areaOf(name, reg) || null;
    const a = slug ? areaBySlug(slug, reg) : null;
    const out = slug ? areaOut(slug, reg) : null;
    const dir = out ? `${reportsRoot}/${out}` : null;
    return {
      area: slug, areaLabel: (a && a.label) || slug, areaPrimary: !!(a && a.primary),
      areaDeclared: !!a, // false ⇒ standalone repo owning itself, no areas[] block
      reportDir: dir,
      reportDirExists: dir ? existsSync(join(CW, dir)) : false,
      swept: dir ? existsSync(join(CW, dir, 'rollup.json')) : false,
      deployHosts: (a && a.deploy && a.deploy.hostnames) || [],
    };
  };
  // WHY the repo landed in that area. areaOf() above stays the authority; this only NAMES the
  // matching rule so the page can show the reason instead of an unexplained slug.
  const areaVia = (name, declaredArea) => {
    if (declaredArea) return 'registry entry · area';
    const areas = reg.areas || [];
    if (entries.get(name)?.area) return 'registry entry · area';
    if (areas.some((a) => (a.members || []).includes(name))) return 'areas[].members';
    const px = areas.find((a) => (a.prefixes || []).some((x) => name.startsWith(x)));
    if (px) return `areas[].prefixes · ${(px.prefixes || []).find((x) => name.startsWith(x))}`;
    return 'own name (standalone)';
  };
  const asList = (m) => (Array.isArray(m) ? m : m ? [m] : []);

  const rows = resolved.map((r) => {
    // registryKey is `<entry>` or `<entry>/<child>` for explicit repos — the declaring entry, i.e.
    // the owner. Discovered repos are owned by the root that found them (source: `root:<path>`).
    const key = r.registryKey || r.name;
    const owner = r.source === 'explicit' ? (key.includes('/') ? key.slice(0, key.indexOf('/')) : key) : null;
    const entry = owner ? entries.get(owner) : null;
    return {
      name: r.name, kind: 'repo', status: 'active',
      path: rel(r.path), pathExists: existsSync(r.path),
      source: r.source || null, registryKey: key,
      owner: owner || (r.source || 'discovered'),
      ownerKind: r.source === 'explicit' ? (key.includes('/') ? 'expanded child of' : 'registry entry') : 'auto-discovered under',
      manifests: asList(r.manifest),
      urls: r.url ? [r.url] : [],
      ...areaFacts(r.name, r.area),
      areaVia: areaVia(r.name, r.area),
      excluded: false,
      // an entry's note describes the ENTRY; repeating it on each expanded child is noise
      note: entry && entry.name === r.name ? entry.note || null : null,
    };
  });

  // `expand: children` entries are not repos themselves — they declare a directory whose children
  // are. Without a row for them, searching the name the operator actually configured (clientA)
  // finds nothing, so they get one, marked as the container it is.
  const groups = (reg.projects || []).filter((p) => p.expand === 'children').map((p) => ({
    name: p.name, kind: 'group', status: 'active',
    path: rel(expandHome(p.path)), pathExists: existsSync(expandHome(p.path) || ''),
    source: 'explicit', registryKey: p.name, owner: p.name, ownerKind: 'registry entry',
    manifests: asList(p.manifest), expand: p.expand,
    children: resolved.filter((r) => (r.registryKey || '').startsWith(p.name + '/')).map((r) => r.name),
    urls: Object.entries(p.urls || {}).map(([k, v]) => `${k} → ${v}`),
    ...areaFacts(p.name, p.area), areaVia: areaVia(p.name, p.area),
    excluded: false, note: p.note || null,
  }));

  const supRows = Object.entries(superseded).map(([name, l]) => ({
    name, kind: 'superseded', status: 'superseded',
    path: rel(l.path), pathExists: l.path ? existsSync(l.path) : false,
    supersededBy: l.supersededBy || null, effectiveFrom: l.effectiveFrom || null, effectiveTo: l.effectiveTo || null,
    manifests: [], urls: [], owner: 'lifecycle{}', ownerKind: 'lifecycle',
    ...areaFacts(name, entries.get(name)?.area), areaVia: areaVia(name, entries.get(name)?.area),
    excluded: false, note: l.note || null,
  }));

  // Excluded names never reach resolveRepos' output at all; listing them here is the only way a
  // search for a retired repo says "excluded" instead of "not found".
  const exRows = (reg.exclude || []).map((name) => ({
    name, kind: 'excluded', status: 'excluded', path: null, pathExists: false,
    manifests: [], urls: [], owner: 'exclude[]', ownerKind: 'exclude',
    area: null, areaLabel: null, reportDir: null, reportDirExists: false, swept: false, deployHosts: [],
    areaVia: 'n/a — out of scan scope', excluded: true, note: reg.excludeNote || null,
  }));

  const all = [...groups, ...rows, ...supRows, ...exRows].sort((a, b) => a.name.localeCompare(b.name));
  return {
    error, notes, list: all,
    counts: { total: all.length, active: rows.length, groups: groups.length, superseded: supRows.length, excluded: exRows.length },
    areas: (reg.areas || []).map((a) => ({ slug: a.slug, label: a.label || a.slug, out: areaOut(a.slug, reg), primary: !!a.primary, note: a.note || null })),
    roots: (reg.roots || []).map((r) => ({ path: r.path, maxDepth: r.maxDepth || 1, manifest: r.manifest || reg.defaultManifest || null })),
    defaultManifest: reg.defaultManifest || null,
  };
}

function configState() {
  const projectsRaw = readJSON(registryPath()) || {};
  const ret = projectsRaw.retention || null;
  // retention is consumed by compact-reports.mjs; surface the exact keys it reads + defaults it falls back to
  const retention = ret ? {
    keepFullSweeps: ret.keepFullSweeps ?? null,
    dropDirPattern: ret.dropDirPattern ?? null,
    protect: ret.protect || [],
    // consumed by monitor/chain-compact.mjs: chain.jsonl over this size is CHECKPOINT-rotated
    // (archived whole + re-verified through the checkpoint), never truncated. null = unconfigured,
    // and an unconfigured sweeper sweeps nothing — the size policy is the operator's act.
    chainMaxBytes: ret.chainMaxBytes ?? null,
    note: ret.note || null,
  } : null;
  const anno = readJSON(annotationsPathFor(CW));
  const gate = readJSON(gateExemptionsPathFor(CW));
  const stub = readJSON(stubAllowlistPathFor(CW)); // absent by default (graceful)
  const now = Date.now();
  const active = (arr, key) => (arr || []).filter((e) => !e[key] || new Date(e[key]).getTime() > now).length;
  return {
    repos: repoConfig(projectsRaw),
    generated: new Date().toISOString(),
    files: {
      projects: 'monitor/projects.json',
      annotations: 'monitor/private/annotations.json',
      gateExemptions: 'monitor/private/gate-exemptions.json',
      stubAllowlist: 'monitor/private/stub-allowlist.json',
      manifests: 'manifests/*.json',
      retentionConsumer: 'monitor/compact-reports.mjs',
    },
    retention,
    manifests: manifestFiles().map(manifestSummary),
    projects: {
      reportsRoot: projectsRaw.reportsRoot || null,
      monitorOutput: projectsRaw.monitorOutput || null,
      list: (projectsRaw.projects || []).map((p) => ({
        name: p.name, path: p.path || null,
        manifest: Array.isArray(p.manifest) ? p.manifest : (p.manifest ? [p.manifest] : []),
        expand: p.expand || null, area: p.area || null,
        urlCount: p.urls ? Object.keys(p.urls).length : 0, note: p.note || null,
      })),
      exclude: projectsRaw.exclude || [],
      excludeNote: projectsRaw.excludeNote || null,
      lifecycle: Object.entries(projectsRaw.lifecycle || {}).map(([name, l]) => ({
        name, state: l.state, supersededBy: l.supersededBy || null,
        effectiveFrom: l.effectiveFrom || null, effectiveTo: l.effectiveTo || null, note: l.note || null,
      })),
    },
    // judgment ledgers — COUNTS + a small preview only; these are append-only files edited with
    // provenance (who/at/reason), never through the panel.
    ledgers: {
      annotations: anno ? {
        total: (anno.annotations || []).length,
        active: active(anno.annotations, 'expires'),
        byAction: (anno.annotations || []).reduce((a, e) => (a[e.action] = (a[e.action] || 0) + 1, a), {}),
        comment: anno._comment || null,
        // whoKind is resolved HERE, not in the page: the human/machine split is a judgement about
        // evidence, so it lives with the other server-side judgements and the panel only styles it.
        recent: (anno.annotations || []).slice(-4).map((e) => ({ id: e.id, package: e.package || null, action: e.action, who: e.who || null, whoKind: classifyWho(e.who), at: e.at || null, expires: e.expires || null })),
      } : null,
      gateExemptions: gate ? {
        total: (gate.exemptions || []).length,
        active: active(gate.exemptions, 'expires'),
        comment: gate._comment || null,
        entries: (gate.exemptions || []).map((e) => ({ gate: e.gate, service: e.service, action: e.action, who: e.who || null, whoKind: classifyWho(e.who), at: e.at || null, expires: e.expires || null })),
      } : null,
      stubAllowlist: stub ? {
        total: (stub.allow || []).length,
        comment: stub._comment || stub.note || null,
        entries: (stub.allow || []).map((e) => ({ pathGlob: e.pathGlob, marker: e.marker || null, reason: e.reason || null })),
      } : { total: 0, absent: true },
    },
  };
}

// Live job tracking, trigger/stop, and the SSE fan-out moved to admin/lib/jobs.mjs on 2026-09-04
// (verbatim). Injected HERE rather than at the import, because this is the first point at which
// every dependency exists: registry() is declared above, and initJobs() immediately calls
// loadPersistedJobs(), which reads sessionStorePath(). Wiring it any earlier would restore nothing
// and lose every persisted health run — silently, since an empty restore looks like a fresh boot.
initJobs({ CW, registry, sessionStorePath, projectSlug, primaryArea });
initJobRoutes({ registry, registryStale });
initPanelProcessRoutes({ BOOT_AT, codeHealth, restartPanel });
initPanelStateRoutes({ registry, configState, SERVICES });

// Small JSON body reader for the auth routes. Caps the body: an auth endpoint that buffers an
// unbounded upload is a free memory-exhaustion vector on an internet-facing surface.
function readJsonBody(req, cb) {
  const chunks = []; let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > 64 * 1024) { req.destroy(); return cb(null, 'body too large'); }
    chunks.push(c);
  });
  req.on('end', () => {
    // PARSE AND DISPATCH ARE SEPARATE TRIES, deliberately. They used to share one, so the callback
    // — i.e. the whole route handler — ran inside the parser's catch, and ANY exception a handler
    // threw was reported to the caller as `body is not valid JSON`. Found the hard way during the
    // route split: a handler died on a missing import and the panel blamed the client's payload,
    // which is a diagnosis pointing at the one place that was definitely fine. A misattributed
    // error costs more than an unhandled one, because it sends you to the wrong file.
    let parsed;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    catch { return cb(null, 'body is not valid JSON'); }
    try { cb(parsed, null); }
    catch (e) {
      console.error('[admin] route handler threw:', e && e.stack || e);
      cb(null, `handler failed: ${String(e && e.message || e).slice(0, 200)}`);
    }
  });
  req.on('error', () => cb(null, 'read error'));
}

// The gate's HTML face. Self-contained, no external requests, and it states plainly what to do
// when the store is empty rather than presenting a login that cannot succeed.

// A branded error page, for humans. API clients still get JSON — content is negotiated on Accept,
// so `curl /nope` stays machine-readable while a browser gets something that looks like the panel.
//
// WHY: a failed OAuth round-trip dropped the operator on `{"error":"not found"}` — a raw JSON body
// on a blank page, from a host that had just shown them a branded login screen. That reads as a
// broken deployment rather than a wrong URL, and it gives no way back.
// Content negotiation, so one call site serves both readers. A browser NAVIGATION gets the branded
// page; fetch/XHR gets the {ok:false,error} shape the panel's client already parses. Deciding by
// Accept rather than by path is what stops the OAuth callback — reached by clicking a link — from
// answering a person with a JSON body.
function sendErr(ctx, code, title, detail, { back = '/' } = {}) {
  const { req, send } = ctx;
  if (/text\/html/.test(String(req.headers.accept || ''))) {
    return send(code, errorPage(code, title, detail, { back }), 'text/html; charset=utf-8');
  }
  return send(code, { ok: false, error: detail || title });
}

function errorPage(code, title, detail, { back = '/' } = {}) {
  // includes ' — override's onclick embeds esc(back) inside a single-quoted JS string
  // (location.href='...'), so a bare double-quote escaper leaves that context breakable.
  return loginPage({
    bootstrapOpen: false, providers: {}, localPort: LOCAL_PORT,
    override: `<h1>${esc(title)}</h1>
       <p class="lede">${esc(detail)}</p>
       <p class="hint">HTTP ${code}</p>
       <button type="button" id="go" onclick="location.href='${esc(back)}'">Back to the panel</button>`,
  });
}

// Every request runs inside handleRequest; the server wrapper below catches anything it throws.
// Without that wrapper a single bad input killed the whole panel: loadStore() now fails CLOSED on
// a corrupt store (correct), but needsBootstrap() is called on EVERY request, and an unguarded
// throw there took the process down for everyone rather than refusing one request. Three unguarded
// decodeURIComponent calls have the same shape. Fail closed, per request, not per process.
// Every modular route group, in dispatch order. Adding a group is one import and one entry here.
const MODULAR_ROUTES = [...secretsRoutes, ...leaksCheckRoutes, ...leaksVerifyRoutes, ...postureRoutes, ...reportRoutes, ...remediationRoutes, ...a11yRoutes, ...profileRoutes, ...configEditRoutes, ...scanConfigRoutes, ...ingestRoutes, ...issueDetailRoutes, ...craRoutes, ...determinationRoutes, ...annotationRoutes, ...oversightRoutes, ...correlationRoutes, ...remediationPolicyRoutes, ...llmRuntimeRoutes, ...hostRoutes, ...verdictRoutes, ...packageRoutes, ...updateRoutes, ...codeqlRemediationRoutes, ...cobolworkRemediationRoutes, ...projectsViewRoutes, ...fleetOverviewRoutes, ...settingsRoutes, ...agentSurfaceRoutes, ...perfRoutes, ...scannerRoutes, ...scanPathRoutes, ...turnsRoutes, ...commentRoutes, ...learningRoutes, ...featuresRoutes, ...overwatchLayerRoutes, ...docsiteRoutes, ...launchlistRoutes, ...offboxRoutes, ...rollupsRoutes, ...jobRoutes, ...panelProcessRoutes, ...panelStateRoutes, ...issuesRoutes, ...dailyRoutes, ...renovateRoutes, ...paletteRoutes, ...feedRoutes, ...journeyRoutes];

// Server copy of the client's VALID_VIEWS — panel-view-paths.test.mjs pins the two sets equal.
// Includes RETIRED view names still served as aliases ('leaks' -> the secrets view). The server's
// only job for those is to hand back the panel document; the client's VIEW_ALIAS map rewrites the
// address bar. Dropping one here would 404 a link that the client is perfectly able to honour, so
// admin/test/panel-view-paths.test.mjs pins this set to VALID_VIEWS ∪ VIEW_ALIAS keys, not to
// VALID_VIEWS alone.
const PANEL_VIEWS = new Set(['overview', 'allfindings', 'feed', 'journey', 'fleet', 'lanes', 'held', 'secrets', 'posture', 'delivery', 'a11y', 'codeql', 'renovate', 'report', 'remediation', 'issues', 'daily', 'exposure', 'leaks', 'malware', 'supplychain', 'sast', 'iac', 'dast', 'actions', 'minify', 'bola', 'stpa', 'profile', 'verdicts', 'oversight', 'correlations', 'projects', 'socket', 'stubs', 'denolint', 'denotypes', 'secretshistory', 'cspm', 'depsjvm', 'depsgo', 'depsretire', 'vendor', 'tls', 'apifuzz', 'dashboard', 'timeline', 'runtime', 'modmap', 'sitemap', 'cra', 'determinations', 'settings', 'perf', 'comments', 'spinecomments', 'overwatch', 'rollups', 'remfleet',
  // DERIVED, not listed: every scanner category is ROUTABLE, whether or not the panel draws a tab
  // for it today. Seventeen lanes ran, produced findings and had nowhere to render them, and adding
  // each by hand meant six registries per lane — the count that reliably produces a lane present in
  // five of them and silently absent from the sixth.
  //
  // The server's job here is only to admit the path; which categories get a BUTTON is the panel's
  // decision, made from the schema it already receives. Admitting a view the panel draws nothing for
  // costs an empty page, while refusing one it does draw costs a 404 on a tab the user can see —
  // and only one of those two is a lie about what exists.
  ...SCANNER_SPECS.map(([k]) => laneView(k))]);

function handleRequest(req, res) {
  // ROUTE ON THE PATHNAME, NOT THE RAW URL. req.url carries the query string, so `req.url === '/'`
  // never matched `/?login=google` — the URL this panel's own OAuth callback redirects to. A
  // successful login therefore ended on a 404: the flow worked, the session was minted, and the
  // panel then said "not found". Same class for every other exact-match route here — /api/state?x=1
  // was a 404 too. Declared FIRST, before any route reads it: /api/csrf sits above the login gate
  // and would otherwise hit the temporal dead zone. Regex routes that capture their own query
  // (the OAuth callback) still read req.url deliberately.
  const pathname = req.url.split('?')[0];

  // Baseline headers on EVERY response, set before any route writes one. They were set on HTML
  // from send() only, so the unauthenticated JSON 401 at / carried none, and the off-box defence
  // suite failed on it from 2026-09-19 (no CSP, no framing control, no HSTS, no Referrer-Policy).
  // Thirty-odd paths write their own heads, and a per-path fix would miss the next one. The /svc
  // bridge is exempt from the framing rule: it strips frame guards so its iframe works. Browsers
  // ignore HSTS over plain HTTP, so the loopback operator port is unaffected.
  if (!pathname.startsWith('/svc/')) {
    res.setHeader('content-security-policy', "frame-ancestors 'self'; form-action 'self'; base-uri 'none'");
  }
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('strict-transport-security', 'max-age=15552000');

  const send = (code, body, ct = 'application/json', extraHeaders = null) => {
    const h = { 'content-type': ct, 'x-content-type-options': 'nosniff' };
    // The full CSP stays report-only and HTML-only: the pages still carry inline <script>, so
    // enforcing it would blank them (item 10 de-inlines, then this flips). The enforced part,
    // frame-ancestors/form-action/base-uri, is set for every response above.
    if (/text\/html/i.test(ct)) {
      // Menu components carry inline CSS. Hash only the stylesheet blocks in this response;
      // the element policy stays restrictive while runtime style attributes remain separate.
      h['content-security-policy-report-only'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src-elem 'self' " + inlineStyleSources(body) + "; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'";
    }
    if (extraHeaders) Object.assign(h, extraHeaders);
    res.writeHead(code, h);
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  // STATIC ASSETS ANSWER 404 WHEN THERE IS NOTHING TO SEND, and that is the whole point.
  // readTxt swallows to '' (correct at its other callers, where absent really is empty), so eleven
  // routes answered 200 with the right content-type and an empty body — a missing stylesheet
  // indistinguishable from one that needed no overrides. panel-light.css sat referenced-but-never-
  // committed for at least 32 hours and the light theme silently did not exist off this box; no
  // console warning, no log line, nothing. Absence of evidence rendering as evidence of absence,
  // in the repo that exists to find exactly that.
  //
  // The remedy was already in this file, applied twice and never carried: :2015 and :2047 give the
  // HTML routes `readTxt(...) || '<h1>… missing</h1>'`. This is that, generalised, so a route added
  // tomorrow is honest by construction rather than by whoever remembers.
  //
  // EMPTY IS TREATED AS MISSING on purpose. A zero-byte stylesheet is not a state any of these
  // assets has, and bin/test/tracked-assets.test.mjs already refuses one ("presence is not
  // content"), so collapsing the two keeps one definition of "this asset is not here".
  const sendAsset = (p, ct, extraHeaders = null) => {
    const body = readTxt(p);
    if (!body) return send(404, `${p.slice(p.lastIndexOf('/') + 1)} is not on this server`,
      'text/plain; charset=utf-8');

    // Store the bytes, but require the browser to ask before reusing them. This preserves the
    // live-edit guarantee that motivated no-store while avoiding a full transfer when the file is
    // unchanged. Hash the representation itself (not mtime/size), and compare the tag we actually
    // advertise after caller overrides so a custom validator can never become unmatchable.
    const computed = `"${createHash('sha256').update(body).digest('base64url')}"`;
    const headers = { 'cache-control': 'no-cache', etag: computed, ...(extraHeaders || {}) };
    const advertised = String(headers.etag);
    const supplied = String(req.headers['if-none-match'] || '');
    const weak = (tag) => tag.trim().replace(/^W\//i, '');
    const matches = supplied === '*' || supplied.split(',').some((tag) => weak(tag) === weak(advertised));
    if (matches) return send(304, '', ct, headers);
    return send(200, body, ct, headers);
  };
  // ── DOCSITE cross-origin API (branch docs in admin/routes/docsite.mjs). Runs BEFORE the blanket
  // CSRF gate, for /api/docsite/* ONLY: a request whose Origin exactly matches a DECLARED docsite
  // origin is CSRF-gated by that match (the browser-controlled Origin header is unforgeable from
  // web content), and OPTIONS preflights must be answered before any gate. Undeclared origins fall
  // through unchanged into the same-host CSRF discipline below — every other panel route keeps
  // exactly the gate it had. Session auth still runs inside the handlers; fail closed: an empty
  // declaration set means no cross-origin request is ever accepted (admin/test/docsite-serve.test.mjs
  // holds both directions of this carve-out).
  // An experimental flag that is off closes these pre-gate branches too; the request then meets
  // the CSRF and login gates like any other (lib/feature-flags.mjs).
  if (pathname.startsWith('/api/docsite/') && !routeFlagOff(pathname)
    && (req.method === 'OPTIONS' || docsiteOrigins().has(String(req.headers.origin || '')))) {
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    if (docsiteHandle({ req, res, pathname, query: q, adminSession, isLoopbackReq: false })) return;
  }
  // ── OFF-BOX PAGE INGEST: above the CSRF and login gates, and authenticated by neither ──────
  // The sender is a LaunchAgent, not a browser: it holds no session, no CSRF token, and no Origin.
  // It must also deliver while the panel's own login store is unusable, since a local failure is
  // part of what the off-box layer watches for. So it carries a bearer token the route checks
  // itself (admin/routes/offbox.mjs). CSRF does not apply to it: CSRF forges requests that ride an
  // AMBIENT credential, and a bearer header is not one — no cross-site page can attach it.
  // Fail closed: an undeclared token refuses every request; only POST /api/offbox/page on a
  // declared offbox hostname is answered, and everything else falls through to both gates.
  if (!routeFlagOff(pathname) && offboxIngest({ req, res, pathname, send, readJsonBody })) return;

  // CSRF gate — every state-changing method, before any route matches. GET/HEAD are exempt by
  // definition (they must stay side-effect free; the OAuth callbacks are GETs and unaffected).
  // This is a blanket deny so a route added later is protected by default rather than by memory.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !csrfOk(req)) {
    return send(403, { ok: false, error: 'CSRF check failed: state-changing requests require the x-cw-csrf header (GET /api/csrf) and a same-origin Origin/Referer.' });
  }
  // the panel's own JS reads this on load. A cross-origin page can issue the GET but cannot read
  // the body (no CORS headers are ever sent), so the token stays same-origin-only.
  if (req.method === 'GET' && pathname === '/api/csrf') return send(200, { token: CSRF_TOKEN });

  // ── MODULAR ROUTES ──────────────────────────────────────────────────────────────────────────
  // serve.mjs was 2,915 lines with ~35 routes in one 870-line if-chain, which made it the panel's
  // contention point by construction: every new route from every workstream landed in the same
  // function. Route groups now live in admin/routes/<area>.mjs and plug in here.
  //
  // Placed AFTER the CSRF gate and the csrf route, and BEFORE the login gate, so a modular route
  // inherits exactly the protections an inline one had — moving a route must not quietly change
  // who may call it. Groups that must sit behind auth are registered below the gate instead.
  //
  // First match wins, preserving the if-chain's semantics. `query` is parsed once here rather than
  // in each handler, which is also the fix for the class of bug where a route tested req.url and a
  // query string turned an exact match into a 404.
  // `adminSession` travels into the ctx (not a resolved session) because it is registered ABOVE
  // the login gate below — a route that needs auth (routes/profile.mjs) must call it itself rather
  // than rely on a gate that has not run yet for anything dispatched from this loop.
  //
  // `isLoopbackReq` travels for the same reason and is computed just above, rather than at the
  // login gate where it used to live: routes/issue-detail.mjs serves a triage prompt carrying real
  // source, which may only leave on the operator port, and a route that cannot see this value
  // cannot enforce that. Computing it here changes nothing for the gate below — same expression,
  // same inputs, one place.

  // cloudflared connects FROM 127.0.0.1, so the socket address can never distinguish a tunnelled
  // request from a local one. The Host header can: tunnel ingress matches on hostname, so a
  // request arriving through the tunnel always carries the public name and a remote caller cannot
  // forge `localhost` and still be routed. CF-Connecting-IP is treated as remote too, belt and
  // braces, since a proxy in front is by definition not local.
  const hostHdr = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  // PORT FIRST, header second. `req.socket.localPort` is the port this connection was accepted on
  // — a property of the socket, not of anything the caller can assert. The tunnel routes only the
  // published port (verified at boot, see assertOperatorPortUnroutable), so arriving on the
  // operator port is proof the request did not come through it.
  //
  // The Host and CF-Connecting-IP checks are KEPT as defence in depth rather than replaced: they
  // cost nothing, and if someone ever does point the tunnel at the operator port in a way the boot
  // check misses, they are the remaining barrier.
  const onOperatorPort = req.socket && req.socket.localPort === LOCAL_PORT;
  const isLoopbackReq = onOperatorPort && !req.headers['cf-connecting-ip'] && LOCAL_NAMES.has(hostHdr);

  // ── DOCSITE pages: answers only when the Host header names a DECLARED docsite hostname, or the
  // loopback /docsite/ preview paths are used. Fail closed both ways — an empty declaration set
  // means the hostname branch never fires, and anything docsiteHandle declines falls through to
  // the panel's own routing unchanged.
  if (docsiteHosts().has(hostHdr) || pathname.startsWith('/docsite/pages/')) {
    const off = routeFlagOff('/docsite/');
    if (off) return send(404, offBody(off));
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    if (docsiteHandle({ req, res, pathname, query: q, adminSession, isLoopbackReq })) return;
  }

  // ── LOGIN GATE ────────────────────────────────────────────────────────────────────────────
  // Bootstrap: while ZERO users exist the first account may be created — but only from loopback.
  // The window opens on an empty store and closes permanently on first write, so a published
  // panel can never be used to mint its own admin.
  const bootstrapOpen = needsBootstrap();
  const isAuthRoute = req.url.startsWith('/auth/');
  // The brand assets the LOGIN PAGE ITSELF requests. The login page is served unauthenticated by
  // design, so anything it references must be too — the wordmark was added to that page by the
  // branding work but never added here, so /cw-wordmark.svg answered 401 to precisely the audience
  // that sees the login page: someone signing in remotely got a broken image where the mark goes.
  //
  // An EXACT allowlist, not a prefix. `startsWith('/cw-favicon')` was already loose enough that
  // /cw-favicon../../something would clear the gate on its way to a route that (today) would not
  // serve it — a gate should not depend on the routes downstream staying careful. These are the
  // static files the unauthenticated page needs and nothing else.
  const isPublicAsset = PUBLIC_ASSETS.has(pathname);

  // ── ZERO-USER POSTURE (R8a) ───────────────────────────────────────────────────────────────
  // While the store holds no operator there is NOTHING a remote caller may legitimately do:
  // bootstrap is loopback-only, login has no account to match, and TOTP confirmation has no
  // enrolment to confirm. Without this, the `isAuthRoute` exemption below hands the public
  // internet three unauthenticated credential routes on a panel that launchd republishes with
  // KeepAlive:true — and the store is empty right now, so that is the live posture, not a
  // hypothetical one.
  //
  // This is also the guarantee that a clean checkout must not start a remotely-reachable panel.
  // An earlier proposal delivered it with a boot-time `git ls-files` trackedness check; this is
  // strictly better, because it tests the property that actually matters (can anyone get in?)
  // rather than a proxy for it, and it is directly testable without a git subprocess on the
  // listen path of a published service.
  if (!isLoopbackReq && bootstrapOpen && !isPublicAsset) {
    // loginPage's bootstrapOpen branch already says exactly this, and says it well: "the first one
    // can only be created from the machine itself". Reuse it rather than writing a second copy of
    // the same sentence that can drift from the first.
    if (req.method === 'GET' && /text\/html/.test(String(req.headers.accept || ''))) {
      return send(503, loginPage({ bootstrapOpen: true, providers: {}, localPort: LOCAL_PORT }), 'text/html; charset=utf-8');
    }
    return send(503, { ok: false, error: `panel is unbootstrapped: no operator account exists. Create one from the box itself at http://127.0.0.1:${LOCAL_PORT} (the operator port — the published port will refuse it), or run \`node bin/panel-breakglass.mjs status\`.` });
  }
  // Loopback + no users yet: THIS is the operator port doing exactly what it exists to do. Serve
  // the real bootstrap form here rather than falling through to the ordinary app shell, which has
  // no session to render and nothing to say about a state the shell was never built to represent.
  // A PENDING SSO SECOND FACTOR OUTRANKS EVERY OTHER LOGIN STATE. The caller has already been
  // identified by the provider and the flow stopped for the account's authenticator; showing them a
  // sign-in form would send them back through a flow they have completed. Placed above the
  // bootstrap branches for that reason, and gated on the challenge actually existing — an expired
  // or forged cookie falls through to the ordinary page rather than rendering a form that cannot
  // succeed.
  if (!isPublicAsset && req.method === 'GET' && /text\/html/.test(String(req.headers.accept || ''))) {
    pruneOauth();
    const c = /(^|;\s*)cw_sso_totp=([^;]+)/.exec(String(req.headers.cookie || ''));
    if (c && ssoPending.has(decodeURIComponent(c[2]))) {
      const pend = ssoPending.get(decodeURIComponent(c[2]));
      return send(200, loginPage({ bootstrapOpen, ssoTotp: true, ssoFactor: pend.factor || 'totp', ssoMailed: pend.mailed || null, providers: {}, localPort: LOCAL_PORT }),
        'text/html; charset=utf-8');
    }
  }
  if (isLoopbackReq && bootstrapOpen && !isPublicAsset && req.method === 'GET'
    && (pathname === '/' || pathname === '/index.html')
    && /text\/html/.test(String(req.headers.accept || ''))) {
    return send(200, loginPage({ bootstrapOpen: true, enroll: true, providers: {}, localPort: LOCAL_PORT }), 'text/html; charset=utf-8');
  }

  // LOCAL ORIGIN IS NOT IDENTITY — once there is an identity to have.
  //
  // `isLoopbackReq` alone was in this condition until 2026-09-02, so arriving on the operator port
  // skipped the session check entirely: a panel WITH an operator account still served every route
  // to anything that could open a socket on this machine. That is a real population — any process
  // the operator runs, any dependency's postinstall, any page that can POST a form.
  //
  // The port check remains excellent evidence of ORIGIN and is kept for what it is good at: it is a
  // socket property no caller can assert, and the tunnel is verified at boot never to route it.
  // What it is not is evidence of IDENTITY, and this gate asks the second question.
  //
  // THE `bootstrapOpen` HALF IS NOT A CONCESSION, it is the correct scope. While no account exists
  // no session is obtainable, so demanding one would protect nothing and would break the only path
  // to creating the first account. The exemption is exactly as wide as the window in which it can
  // do no harm, and it closes permanently on the first write.
  //
  // Checked before landing, not assumed: `/auth/*` is exempt below so signing in never needs the
  // session it lacks; an HTML GET with no session gets the login page rather than a bare 401;
  // bin/panel-breakglass.mjs was RUN and reads the store; and the only account is
  // totpConfirmed:false, where auth.mjs:312 deliberately demands no code — "a failed enrolment
  // otherwise locks the only account".
  if (!(isLoopbackReq && bootstrapOpen) && !isAuthRoute && !isPublicAsset) {
    const s = adminSession(req);
    if (!s) {
      // No session. If the store is empty the operator must bootstrap FROM the box;
      // saying so beats a bare 401 that looks like a broken deployment.
      if (req.method === 'GET' && /text\/html/.test(String(req.headers.accept || ''))) {
        // externalSsoAllowed() is part of the condition, not just configuration: this page is only
        // served on the published port, so an SSO button here is only ever an EXTERNAL sign-in.
        // Offering one while the switch is off produces a Google consent screen followed by a
        // refusal, which is the worst of both — the user has already granted access to an account
        // that is then rejected.
        return send(200, loginPage({
          bootstrapOpen, localPort: LOCAL_PORT,
          // A cookie that produced no session is EXPIRED, not absent. Decided here because the
          // request is the only place both facts are known.
          notice: /(^|;\s*)cw_admin_sid=/.test(String(req.headers.cookie || '')) ? 'Session expired.' : null,
          providers: {
            google: oauthConfigured('google')
              && process.env.CW_OAUTH_LIVE_EXCHANGE === '1'
              && externalSsoAllowed(),
          },
        }), 'text/html; charset=utf-8');
      }
      return send(401, { ok: false, error: bootstrapOpen
        ? `no users exist — open the panel on the box itself at http://127.0.0.1:${LOCAL_PORT} (the operator port) to create the root user`
        : 'authentication required' });
    }
  }

  // AFTER the login gate, deliberately. These 52 routes are all /api/*, each was responsible for
  // its own auth, and the ones that did not check answered 200 with data to an unauthenticated
  // caller on the published port — measured 2026-08-25 on /api/report/states, /api/report/evidence,
  // /api/posture and /api/a11y. Dispatching below the gate makes a session the default and a
  // public route an explicit act, rather than depending on 64 authors each remembering.
  // A launchlist hostname opens on the checklist; every other path on it is the ordinary panel.
  const routePath = (pathname === '/' && launchlistHosts().has(hostHdr)) ? '/launchlist/'
    : (pathname === '/' && offboxHosts().has(hostHdr)) ? '/offbox/' : pathname;
  for (const r of MODULAR_ROUTES) {
    if (r.method !== req.method || r.path !== routePath) continue;
    // An experimental group switched off answers as absent, and says which flag brings it back.
    const featureOff = routeFlagOff(routePath);
    if (featureOff) return send(404, offBody(featureOff));
    // trigger travels in the ctx so a modular route can start the SAME job-slot-guarded sweep the
    // inline /api/scan route does (codeql-remediation's post-apply resweep) — a second runner
    // would race the one slot that exists precisely to prevent interleaved batch writes.
    // Promise.resolve().catch, not a bare return. 6 handlers are async, and handleRequest is sync —
    // a rejection lands after it returns, so the outer try/catch misses it and process-level
    // unhandledRejection only LOGS. The socket then hangs to timeout: no 500, nothing the operator
    // sees, just a spinner. That is the least detectable failure in the pipeline.
    return Promise.resolve(r.handle({ req, res, send, pathname, query: new URL(req.url, 'http://127.0.0.1').searchParams,
      knownProjects, readJsonBody, adminSession, isLoopbackReq, trigger, githubLinkBlocked }))
      .catch((e) => {
        console.error(`[admin] route failed: ${req.method} ${pathname} — ${e && e.stack ? e.stack : e}`);
        if (!res.headersSent) send(500, { ok: false, error: 'request failed — see the panel log on the host' });
        else { try { res.end(); } catch { /* socket already gone */ } }
      });
  }
  // Every view is a path route to the panel document (fragments never reach the server), in two
  // shapes: `/<view>/` and `/<project-slug>/<view>/`. The project belongs in the route because a URL
  // that names only a view names no SUBJECT — /leaks/ meant "leaks for whatever that browser last
  // chose", so two people opening one link saw different findings.
  //
  // THE SECOND SEGMENT MUST BE A KNOWN VIEW, and that is what keeps this from swallowing the
  // sub-path routes below it. /map/<slug>, /reports/<file> and /sitemap/<file> all have a
  // non-view second segment, so none of them match; a three-segment path never matches either.
  // Matching on the FIRST segment instead would have eaten all three.
  //
  // PRECEDENCE, stated because it is the one ambiguity: `/settings/` is the VIEW, even if a project
  // is ever slugged `settings`. Single-segment is resolved as a view first; a project that collides
  // with a view name is reachable only in the two-segment form.
  //
  // RESERVED FIRST SEGMENTS, and this list is load-bearing rather than defensive. Requiring the
  // SECOND segment to be a view is not enough on its own: `/api/issues` has `issues` in that
  // position, so the two-segment rule matched it as project=`api`, view=`issues` and served the
  // panel DOCUMENT where the route below serves JSON. Found by admin/test/issues-route.test.mjs
  // failing with "the payload is JSON" — a collision I had reasoned my way past and was wrong about.
  // Any prefix the server owns must be excluded here, not merely ordered after.
  const RESERVED_FIRST = new Set(['api', 'auth', 'reports', 'map', 'sitemap', 'static', 'assets', 'section', 'perf']);
  const pv1 = req.method === 'GET' && pathname.match(/^\/([a-z0-9-]+)\/?$/);
  const pv2 = req.method === 'GET' && pathname.match(/^\/([a-z0-9._-]+)\/([a-z0-9-]+)\/?$/);
  // /section/<id>/ — the SECTION routes. The client resolves the id to that section's first tab;
  // an id it does not know lands on Overview, which is why the server does not need the group list.
  const psec = req.method === 'GET' && pathname.match(/^\/section\/([a-z0-9-]+)\/?$/);
  // /perf/<scanner>/ — one route per scanner. `perf` is reserved above so /perf/sast/ is never read
  // as project `perf`, view `sast`; an id the page does not know opens the scanner list.
  const pscan = req.method === 'GET' && pathname.match(/^\/perf\/([a-z0-9][a-z0-9._-]{0,63})\/?$/);
  const isPanelPath = pathname === '/' || pathname === '/index.html' || !!psec || !!pscan
    || (pv1 && PANEL_VIEWS.has(pv1[1]))
    || (pv2 && !RESERVED_FIRST.has(pv2[1].toLowerCase()) && PANEL_VIEWS.has(pv2[2]));
  if (req.method === 'GET' && isPanelPath) return send(200, readPanelDocument(), 'text/html; charset=utf-8');
  // favicon — served from the admin dir at root (the '/' page's <link rel=icon> points here). Explicit exact-match, not a static-dir surface.
  // The panel's stylesheet, extracted from index.html's inline <style> so the CSP can ENFORCE
  // style-src 'self' instead of conceding 'unsafe-inline'. Exact-match path, read from a fixed
  // filename — no path segment reaches the filesystem from the request.
  // sendAsset revalidates every use: live edits appear on the next load without re-transferring
  // unchanged files.
  if (req.method === 'GET' && pathname === '/static/panel.css') return sendAsset(join(STATIC_DIR(), 'panel.css'), 'text/css');
  if (req.method === 'GET' && pathname === '/static/panel-light.css') return sendAsset(join(STATIC_DIR(), 'panel-light.css'), 'text/css');
  // Not a panel view module: pages outside the shell load it, the sign-in page among them, so it is
  // public (PUBLIC_ASSETS) and kept out of STATIC_JS_MODULES, whose members stay behind the session.
  if (req.method === 'GET' && pathname === '/static/theme-switch.js') return sendAsset(join(STATIC_DIR(), 'theme-switch.js'), 'text/javascript');
  // The vendored IBM Plex faces. NOT through sendAsset: that reads with readTxt (utf8) and a woff2
  // decoded as UTF-8 comes back with every invalid byte replaced by U+FFFD — a 200 carrying a
  // corrupt font, which the browser rejects silently and which looks exactly like a font that was
  // never asked for. Binary is read and written as bytes, like the two favicon routes below.
  // Membership is checked against the frozen FONT_SET, so no part of the request reaches the
  // filesystem: the path that is joined is the one we declared, never the one that arrived.
  // Immutable + a year, unlike the stylesheets beside it: these are versioned upstream bytes that
  // never change in place, so the reason panel.css is no-store (it is edited live, and a cached
  // copy makes an applied change look unapplied) simply does not apply to them.
  if (req.method === 'GET' && FONT_SET.has(pathname)) {
    const p = join(STATIC_DIR(), 'fonts', pathname.slice('/static/fonts/'.length));
    if (!existsSync(p)) return send(404, { ok: false, error: `${pathname} is declared but not on this server` });
    res.writeHead(200, { 'content-type': 'font/woff2', 'x-content-type-options': 'nosniff',
      'cache-control': 'public, max-age=31536000, immutable' });
    return res.end(readFileSync(p));
  }
  if (req.method === 'GET' && STATIC_JS.has(pathname)) {
    const name = STATIC_JS_MODULES.find((candidate) => pathname === `/static/${candidate}`);
    return sendAsset(join(HERE, 'static', name), 'text/javascript');
  }
  // Colour-vision-deficiency palettes — generated, see the header in panel-cvd.css. no-store for
  // the same reason panel.css is: these are edited during development and a cached palette is
  // indistinguishable from a palette that did not apply.
  if (req.method === 'GET' && pathname === '/static/panel-cvd.css') return sendAsset(join(STATIC_DIR(), 'panel-cvd.css'), 'text/css');
  if (req.method === 'GET' && pathname === '/static/panel-cvd-light.css') return sendAsset(join(STATIC_DIR(), 'panel-cvd-light.css'), 'text/css');
  // config.html's own rules; its palette now comes from panel.css above rather than a second copy
  if (req.method === 'GET' && pathname === '/static/config.css') return sendAsset(join(STATIC_DIR(), 'config.css'), 'text/css');
  // The shared surface vocabulary (docs/THEME.md). Served rather than inlined so the demo page and
  // the panel consume one file: a livery that exists only in a preview is a livery nothing wears.
  if (req.method === 'GET' && pathname === '/static/theme.css') return sendAsset(join(STATIC_DIR(), 'theme.css'), 'text/css');
  // The house sheet for pages outside the shell, generated from lib/house-css.mjs by bin/house-css.mjs.
  if (req.method === 'GET' && pathname === '/static/house.css') return sendAsset(join(STATIC_DIR(), 'house.css'), 'text/css');
  // fact: every stylesheet and the JS module here send cache-control:no-store, and the BRAND
  // assets sent nothing at all / an origin that says nothing lets an intermediary choose, and
  // Cloudflare's default caches by extension — measured on commitwork.online the hour the
  // seal landed: cf-cache-status HIT with age 6910s on /cw-favicon.svg and 2634s on
  // /favicon.ico, both serving bytes that no longer existed on disk. The rule had been
  // applied to the files that change during development and withheld from the ones assumed
  // static, but a brand asset changes exactly when it must not be stale, and a favicon is
  // the most aggressively cached object a browser holds (expiry: never, prev: missing)
  if (req.method === 'GET' && pathname === '/cw-favicon.svg') return sendAsset(join(HERE, 'cw-favicon.svg'), 'image/svg+xml');
  // raster favicon fallbacks (.ico/.png) for tabs/browsers that don't take SVG — binary, so read as a raw Buffer
  // and hand it straight to res.end (the text `send` helper would UTF-8-mangle binary bytes).
  if (req.method === 'GET' && pathname === '/favicon.ico') { const p = join(HERE, 'favicon.ico'); if (!existsSync(p)) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"not found"}'); } res.writeHead(200, { 'content-type': 'image/x-icon', 'cache-control': 'no-store' }); return res.end(readFileSync(p)); }
  if (req.method === 'GET' && pathname === '/cw-favicon-32.png') { const p = join(HERE, 'cw-favicon-32.png'); if (!existsSync(p)) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"not found"}'); } res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); return res.end(readFileSync(p)); }
  // config surface — the static page; its JSON is GET /api/config (routes/panel-state.mjs)
  if (req.method === 'GET' && (pathname === '/config' || pathname === '/config.html')) return send(200, readTxt(join(HERE, 'config.html')) || '<h1>config page missing</h1>', 'text/html; charset=utf-8');
  const authAnswer = authHandle({ req, res, send, pathname, isLoopbackReq, readJsonBody, sendErr, port: PORT, localPort: LOCAL_PORT });
  if (authAnswer !== AUTH_UNHANDLED) return authAnswer;
  if (req.method === 'GET' && pathname === '/admin/github/projects') {
    const s = adminSession(req);
    if (!s) return send(401, { ok: false, error: 'not authenticated — log in via /auth/login/github' });
    return send(200, {
      ok: true, authed: true, provider: s.provider,
      message: 'authed, would list projects',
      note: s.token ? 'session carries a token; a live build would call the GitHub API here'
                    : 'scaffold session (no token — set CW_OAUTH_LIVE_EXCHANGE=1 with real creds for a live token)',
    });
  }
  // LIVE modernization map, per project: /map/<project> — served off the server, not a static
  // report. Serves the engine's cached output (map/data/<project>/index.html), rendering on
  // demand if missing (or ?render=1 to force). A project with no data renders a stub.
  const mapm = req.url.match(/^\/map\/([a-z0-9][a-z0-9-]*)/i);
  if (req.method === 'GET' && mapm) {
    const project = mapm[1];
    const html = join(CW, 'map', 'data', project, 'index.html');
    if (/[?&]render=1/.test(req.url) || !existsSync(html)) {
      try { spawnSync('node', [join(CW, 'map', 'render.mjs'), project], { stdio: 'ignore', timeout: 60000 }); } catch { /* fall through to whatever exists */ }
    }
    if (existsSync(html)) return send(200, readFileSync(html, 'utf8'), 'text/html; charset=utf-8');
    return send(200, fallbackPage(`<div class="fallback-t">no modernization map for ${esc(project)}</div>`), 'text/html; charset=utf-8');
  }
  // SiteMap (S1 demo): /sitemap/<file> serves the TRACKED sitemap/ dir (demo.html + vendored
  // three.js + fixture data). Deliberately not under /reports/ — that tree is gitignored scan
  // output, and the demo is product, not artifact. Same traversal guard as serveReport.
  const sm = req.method === 'GET' && req.url.match(/^\/sitemap\/(.+)$/);
  if (sm) {
    const SM = join(CW, 'sitemap');
    const safe = normalize(decodeURIComponent(sm[1].split('?')[0])).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
    const full = join(SM, safe);
    if (!full.startsWith(SM) || !existsSync(full) || statSync(full).isDirectory()) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"not found"}'); }
    res.writeHead(200, { 'content-type': CTYPE[extname(full).toLowerCase()] || 'application/octet-stream' });
    return res.end(readFileSync(full));
  }
  // monitor report pages served from this one port: /reports/<file> (dashboard/timeline/runtime/…)
  // back-compat: the modernization map used to be a static report; it's now the live /map route.
  // Redirect the old path so a stale browser tab (loaded before the switch) doesn't render blank.
  // The target was the literal '/map/clientA' — a fourth hardcoded-project site in this file, in a
  // redirect that silently sends every project's stale tab to clientA's map. It resolves from the
  // registry now, like everything else here, and honours ?project= so the back-compat redirect
  // preserves which project the tab was actually looking at.
  if (req.method === 'GET' && /^\/reports\/modernization\.html/.test(req.url)) {
    const q = new URLSearchParams((req.url.split('?')[1]) || '');
    const asked = q.get('project');
    const known = knownProjects();
    const target = asked && (known.has(asked) || known.has(projectSlug(asked)))
      ? (projectSlug(asked) || asked)
      : (primaryArea(registry())?.slug || '');
    if (!target) return send(404, { error: 'no project to map — the registry declares no areas' });
    res.writeHead(302, { location: `/map/${target}` + (/[?&]embed=1/.test(req.url) ? '?embed=1' : '') });
    return res.end();
  }
  const rep = req.url.match(/^\/reports\/(.+)$/);
  if (req.method === 'GET' && rep) {
    const rq = new URLSearchParams(rep[1].split('?')[1] || '').get('project');
    const known = knownProjects();
    const okProj = rq && (known.has(rq) || known.has(projectSlug(rq))) ? rq : null;
    return serveReport(decodeURIComponent(rep[1].split('?')[0]), res, okProj);
  }
  // service bridge: /svc/<name>/<path…> reverse-proxies the local service (frame guards stripped)
  const svc = req.url.match(/^\/svc\/([a-z]+)(\/.*)?$/);
  // OWN KEYS ONLY. `SERVICES[name]` is a plain property read, so it answers truthy for anything on
  // Object.prototype — `/svc/tostring`, `/svc/constructor`, `/svc/valueof` all passed this gate and
  // reached proxy() with `base` set to a FUNCTION rather than a URL. Verified today: all four of
  // toString/constructor/__proto__/valueOf return truthy here, and only `Object.hasOwn` separates
  // them from a declared service.
  //
  // It failed closed by luck, not by design: proxy() then parses `base` (`new URL(base)`, now
  // inside its try), so an undeclared value threw ERR_INVALID_URL and the handler
  // answered 400. I expected an SSRF there and the probe refuted it — but "the next parser we call
  // happens to reject this" is not an access-control argument, and the regex `[a-z]+` is one
  // character class away from admitting more of the prototype.
  if (svc && Object.hasOwn(SERVICES, svc[1])) return proxy(svc[1], SERVICES[svc[1]], svc[2] || '/', req, res);
  if (/text\/html/.test(String(req.headers.accept || ''))) {
    return send(404, errorPage(404, 'Not found', `Nothing is served at ${pathname}.`),
      'text/html; charset=utf-8');
  }
  return send(404, { error: 'not found' });
}

// ── THE OPERATOR PORT (R6b) ─────────────────────────────────────────────────────────────────────
// The gate this replaces asserted locality from the HOST HEADER alone. The remediation plan
// proposed conjoining `req.socket.remoteAddress` — but that is a NO-OP here, and this file's own
// comment already said why: cloudflared dials the origin from 127.0.0.1, so a tunnelled request
// and a local one are indistinguishable at the socket. Adding the check would have looked like a
// fix and changed nothing, which is worse than leaving it alone.
//
// What actually distinguishes them is WHICH PORT the request landed on. The tunnel routes
// commitwork.portll.net -> 127.0.0.1:7878 and can reach nothing else, so a request arriving on a
// DIFFERENT loopback port provably did not come through it. That is a socket-level fact, not an
// assertion about a header the caller controls.
//
// This closes the httpHostHeader hazard specifically. A tunnel fragment setting
// `httpHostHeader: localhost` on the commitwork rule would make every tunnelled request
// Host-loopback-equal, opening bootstrap minting and the external-SSO toggle simultaneously. With
// locality bound to the port, that fragment grants nothing.
//
// It does NOT defend against a process running as this UID on this box — nothing can, since such a
// process can read the auth store directly. The boundary being fixed is the tunnel's, and that one
// is now structural.
// (declared next to PORT — the bootstrap messages below need it long before this point)

// DECLARATION CHECKED AGAINST REALITY — the principle the platform is built on, applied to its own
// gate. The operator port is only a boundary while the tunnel cannot route to it, so that is
// verified at boot from the tunnel's actual config rather than assumed. If a future edit ever
// points an ingress rule at the operator port, the panel refuses to start instead of silently
// serving privileged routes to the internet.
function assertOperatorPortUnroutable() {
  const cfg = process.env.CW_CLOUDFLARED_CONFIG || join(expandHome('~/.cloudflared'), 'config.yml');
  if (!existsSync(cfg)) return { checked: false, reason: 'no cloudflared config on this box' };
  let text;
  try { text = readFileSync(cfg, 'utf8'); }
  catch (e) { return { checked: false, reason: `cloudflared config unreadable (${e.code})` }; }
  const reason = operatorPortRoute(text, LOCAL_PORT);
  return reason ? { checked: true, routable: true, reason } : { checked: true, routable: false };
}

const portCheck = assertOperatorPortUnroutable();
if (portCheck.routable) {
  console.error(`[admin] REFUSING TO START: ${portCheck.reason}.`);
  console.error('[admin] The operator port must not be reachable through the tunnel — routing it there');
  console.error('[admin] would publish loopback-privileged routes (bootstrap minting, the external-SSO');
  console.error('[admin] toggle) to the internet. Point the ingress rule at the published port');
  console.error(`[admin] (${PORT}) instead, or set CW_ADMIN_LOCAL_PORT to a port the tunnel does not serve.`);
  process.exit(2);
}

const onRequest = (req, res) => {
  try {
    handleRequest(req, res);
  } catch (e) {
    // The panel guards state-changing operations, so a thrown request must never be interpreted as
    // success — answer 500 and say only that something failed. The detail goes to the operator's
    // console, not to the client: on a published panel an exception message can carry a store path
    // or a stack frame.
    // ONE argument, deliberately: req.url is attacker-controlled, and console.error treats a
    // string first argument as a printf-style format when a second argument follows — a URL
    // containing literal %s would then consume/garble the stack trace instead of appending it.
    console.error(`[admin] request failed: ${req.method} ${req.url} — ${e && e.stack ? e.stack : e}`);
    if (!res.headersSent) {
      // The detail still never travels — only the SHAPE changes with the reader. A browser that
      // navigated here gets the branded page; everything else keeps the JSON the client parses.
      // Written directly rather than through send(), which is scoped inside handleRequest.
      const wantsHtml = /text\/html/.test(String(req.headers.accept || ''));
      const body = wantsHtml
        ? errorPage(500, 'Something went wrong', 'The panel could not complete that request. The detail is in the log on the host.')
        : JSON.stringify({ ok: false, error: 'request failed — see the panel log on the host' });
      res.writeHead(500, {
        'content-type': wantsHtml ? 'text/html; charset=utf-8' : 'application/json',
        'x-content-type-options': 'nosniff',
      });
      res.end(body);
    } else { try { res.end(); } catch { /* socket already gone */ } }
  }
};

// Two listeners, one handler. Both bind 127.0.0.1 — the published one is reached through the
// tunnel, never directly from the network.
// Timeout posture, pinned rather than inherited. These were Node's defaults until the live console
// became an event stream; leaving them implicit means a Node upgrade that changes a default
// silently truncates a running sweep's stream. Stated values, one reason each:
//   requestTimeout   bounds RECEIVING a request, not the response — a bodyless GET completes at
//                    headers, so an SSE response is unaffected. 300s matches the historical default.
//   headersTimeout   60s, unchanged in effect; slowloris protection.
//   keepAliveTimeout 5s between requests on an idle socket; does not touch an in-flight response.
//   timeout          0 = no socket inactivity kill. An SSE stream is deliberately idle between
//                    scanner lines, and the 15s heartbeat is what keeps intermediaries happy.
function harden(server) {
  server.requestTimeout = 300_000;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 5_000;
  server.timeout = 0;
  return server;
}

const PUBLISHED_SERVER = harden(http.createServer(onRequest));
const OPERATOR_SERVER = harden(http.createServer(onRequest));
const fatalListen = (e) => {
  console.error(`[admin] listener failed: ${e && e.message ? e.message : e}`);
  process.exit(1);
};
PUBLISHED_SERVER.on('error', fatalListen);
OPERATOR_SERVER.on('error', fatalListen);
PUBLISHED_SERVER.listen(PORT, '127.0.0.1', () => {
  console.log(`commitwork admin → http://127.0.0.1:${PORT}   (published; sessions required)`);
});
OPERATOR_SERVER.listen(LOCAL_PORT, '127.0.0.1', () => {
  console.log(`commitwork operator → http://127.0.0.1:${LOCAL_PORT}   (loopback-privileged; NOT routed by the tunnel)`);
  if (!portCheck.checked) console.log(`[admin] note: could not verify the tunnel does not route port ${LOCAL_PORT} — ${portCheck.reason}`);
  if (needsBootstrapQuiet()) {
    console.log(`[admin] no operator account exists yet — create one at http://127.0.0.1:${LOCAL_PORT}`);
  }
});
// admin/lib/panel-preflight.mjs boots a successor with this set: both listeners bound is the proof
let bound = 0;
const preflightBound = () => {
  if (++bound < 2 || process.env.CW_PANEL_PREFLIGHT !== '1') return;
  const ports = [PUBLISHED_SERVER, OPERATOR_SERVER].map((s) => s.address().port);
  process.stdout.write(`cw-panel-preflight: ready ${JSON.stringify({ pid: process.pid, ports })}\n`, () => process.exit(0));
};
PUBLISHED_SERVER.once('listening', preflightBound);
OPERATOR_SERVER.once('listening', preflightBound);

// needsBootstrap() throws on a damaged store, and a boot-time banner must not be the thing that
// kills startup — `bin/panel-breakglass.mjs status` is where that diagnosis belongs.
function needsBootstrapQuiet() { try { return needsBootstrap(); } catch { return false; } }

// ── operator restart: hand the ports to a successor, then leave ─────────────────────────────────
// Order is load-bearing: server.close() unbinds the LISTENING sockets immediately (established
// connections — the SSE streams — live on and drain on their own), so the successor can bind the
// same ports before this process exits. The close callbacks may NEVER fire while an SSE client is
// attached, so the relaunch must not wait on them beyond a bound: a keep-alive connection must not
// hold a restart hostage. The successor inherits this process's env verbatim, because a relaunch
// that drops CW_OAUTH_LIVE_EXCHANGE silently removes the Google button — a measured failure mode,
// not a hypothetical. CW_PANEL_RESTART_EXEC is the test seam (quotedArgv, the CW_SWEEP_CMD
// contract — quote any path containing a space; there is no shell here to do it for you):
// tests point it at a marker script so no real panel is spawned.
let RESTART_STARTED = false;
function restartPanel() {
  if (RESTART_STARTED) return; RESTART_STARTED = true;
  // FLUSH FIRST, synchronously, before anything starts closing. adminSession() only writes
  // lastSeenAt once a minute, so without this the successor can inherit a session that looks up to
  // a minute more idle than it is — harmless at an 8h timeout, but this is the one moment we KNOW
  // the process is about to end, and a store that is accurate exactly when it is handed over costs
  // one write. It is also the write that makes "update the panel" stop meaning "log me out".
  persistSessions(oauthSessions, { force: true, onNote: (m) => console.error(`[admin] ${m}`) });
  console.error(`[admin] operator-requested restart: pid ${process.pid} closing listeners and spawning its successor`);
  let relaunched = false;
  const relaunch = () => {
    if (relaunched) return; relaunched = true;
    // Under launchd (CW_PANEL_SUPERVISED, set by the LaunchAgent plist) KeepAlive owns the
    // relaunch: exiting IS the restart, and spawning our own successor here would race launchd's
    // into EADDRINUSE. Unsupervised, we are our own supervisor and must spawn the successor.
    if (process.env.CW_PANEL_SUPERVISED) {
      console.error('[admin] supervised restart: exiting; launchd relaunches from the code on disk');
      setTimeout(() => process.exit(0), 400);
      return;
    }
    try {
      // THE PORT TRAVELS. This was `[process.execPath, join(HERE, 'serve.mjs')]` with no port, and
      // PORT is resolved as `argv[2] || CW_ADMIN_PORT || 7878` — so a panel started as
      // `node admin/serve.mjs 7995` restarted itself onto 7878, silently, on a different port from
      // the one the operator was talking to. The env form survived because the env is copied; only
      // the positional form was dropped, which is the harder case to notice because it works
      // perfectly for anyone using the default. Passing the RESOLVED port makes the successor
      // answer where the predecessor did, whichever way it was told.
      const argv = process.env.CW_PANEL_RESTART_EXEC
        ? quotedArgv(process.env.CW_PANEL_RESTART_EXEC)
        : [process.execPath, join(HERE, 'serve.mjs'), String(PORT)];
      let out = 'ignore';
      const restartLog = process.env.CW_PANEL_RESTART_LOG || join(CW, 'reports', 'panel-restart.log');
      try { mkdirSync(dirname(restartLog), { recursive: true }); out = openSync(restartLog, 'a'); } catch { /* logless is better than no successor */ }
      const child = spawn(argv[0], argv.slice(1), { cwd: CW, detached: true, stdio: ['ignore', out, out], env: { ...process.env } });
      child.unref();
    } catch (e) { console.error('[admin] successor spawn FAILED — the panel will be down until started by hand:', e.message); }
    // the successor needs the ports free of LISTENERS only; established sockets don't block bind.
    // 400ms gives the spawn a beat, then this pid leaves regardless — lingering would race the child.
    setTimeout(() => process.exit(0), 400);
  };
  let pending = 0;
  const closed = () => { if (--pending <= 0) relaunch(); };
  for (const s of [PUBLISHED_SERVER, OPERATOR_SERVER]) { pending++; try { s.close(closed); } catch { closed(); } }
  if (pending <= 0) relaunch();
  setTimeout(relaunch, 2000); // the SSE-holds-close-open bound
}

// A throw from an async continuation (a token exchange, a bridged proxy callback) lands here rather
// than in the wrapper above. Log and keep serving: an operator surface that dies on one bad upstream
// response is worse than one that reports the failure and stays reachable.
process.on('uncaughtException', (e) => console.error('[admin] uncaught:', e && e.stack ? e.stack : e));
process.on('unhandledRejection', (e) => console.error('[admin] unhandled rejection:', e && e.stack ? e.stack : e));
