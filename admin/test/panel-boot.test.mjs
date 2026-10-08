// node --test admin/test/ — THE PANEL'S CLIENT SCRIPT ACTUALLY BOOTS.
//
// WHY THIS FILE EXISTS. Every other panel test in this directory extracts ONE function out of
// index.html with `new Function(fn('setTabN'))` and exercises it in isolation. That is useful and it
// is blind to the entire class of failure that lives BETWEEN the functions: declaration order.
//
// setView() runs at boot — `setView(urlView(),true)` — before the rest of the script has executed.
// It reached for `craTickTimer`, a `let` declared 165 lines FURTHER DOWN, so at that moment the
// variable was in its temporal dead zone and reading it threw a ReferenceError out of the top level.
// Everything after that line never ran: the first load(), the 8s poll, initOauth(). The panel served
// its static shell with an empty project picker and no data, which reads as "the dropdown is broken"
// rather than as "the script is dead".
//
// It went unnoticed because the panel process was months old and still running the code from before
// the regression; the bug only became live when the process was restarted. 3172 tests were green
// across the whole window. The suite could not see it because nothing in it ever ran the script
// top-to-bottom.
//
// This test does exactly that, against a payload shaped like the one the server returns when NO
// project is selected (the boot case: nulls in every per-project field). It asserts the script
// evaluates, that load() completes, and that the picker ends up populated — so the next `let` added
// below setView fails here instead of on the published panel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { panelSource, panelScripts } from './lib/panel-source.mjs';

const PANEL = panelSource('index.html');
const SCRIPTS = panelScripts('index.html');

/** The boot payload: what /api/state returns with `project=` empty. Per-project fields are NULL. */
function bootPayload() {
  return {
    generated: null, modernization: null, program: null, security: null,
    scanners: null, scannerRegistry: null, scannerFindings: null,
    buildHealth: null, qualityGates: null, preflight: null, codeql: null,
    // Types mirror the live response exactly (measured against /api/state?project= on a running
    // panel). Getting one wrong makes this test fail for a reason the panel does not have.
    detailSchema: {}, scanScopes: {}, projectTotals: {}, slugs: {},
    projects: ['ClientA', 'commitwork admin', 'overwatch-layer'],
    repos: [], retired: [], superseded: [], services: [],
    remediation: [], annotationHealth: {}, scopeDelta: {}, runtime: {},
    freshness: {}, has: {}, source: {}, dimensions: [], counts: {},
  };
}

/** A minimal DOM realm for the panel's scripts. */
function realm(payload, overrides) {
  const ids = new Set([...PANEL.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const mk = (id) => ({
    id, _html: '', _text: '', dataset: {}, style: {}, options: [], value: '',
    hidden: false, disabled: false, checked: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
    set textContent(v) { this._text = String(v); }, get textContent() { return this._text; },
    appendChild() {}, append() {}, remove() {}, focus() {}, scrollIntoView() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    addEventListener() {}, removeAttribute() {}, setAttribute() {}, getAttribute: () => null,
    insertAdjacentHTML() {},
  });
  const store = new Map([...ids].map((i) => [i, mk(i)]));
  const sandbox = {
    document: {
      getElementById: (i) => store.get(i) || null,
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, createElement: () => mk('x'),
      body: mk('body'), documentElement: mk('html'), title: '',
    },
    location: { pathname: '/', hash: '', href: 'http://127.0.0.1/', search: '' },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    // URL-AWARE, because a single catch-all response is not a neutral stub. Handing the /api/state
    // payload back to /api/panel/health made `d.memory.rss` throw, and loadPanelHealth caught it and
    // wrote "health unavailable: Cannot read properties of undefined" into #ph-line — on EVERY view,
    // a failure the panel does not have. Shapes measured against the running panel, per the note on
    // bootPayload: a stub that is wrong in a different way from the code is still a wrong answer.
    fetch: async (url) => {
      const u = String(url || '');
      const body = u.startsWith('/api/panel/health')
        ? { ok: true, pid: 1, node: 'v26.0.0', startedAt: '2026-08-01T00:00:00.000Z', uptimeSecs: 60,
          memory: { rss: 1048576, heapUsed: 524288 }, supervised: true,
          code: { watched: 1, stale: false, changed: [] } }
        : payload;
      return { ok: true, status: 200, json: async () => body, text: async () => '' };
    },
    EventSource: class { addEventListener() {} close() {} },
    navigator: { credentials: {}, userAgent: 'test' },
    addEventListener() {}, removeEventListener() {},
    setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, clearTimeout() {},
    requestAnimationFrame: (f) => f(), getComputedStyle: () => ({ getPropertyValue: () => '' }),
    alert() {}, prompt: () => null, confirm: () => true,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  Object.assign(sandbox, overrides);
  sandbox.window = sandbox;
  return { ctx: vm.createContext(sandbox), store };
}

// Every script the page carries runs as its own classic script, in document order, in one realm —
// as a browser runs them. They share a global lexical scope, but a function declaration is hoisted
// only within its own script, so a top-level call into a LATER script throws here exactly as it
// does in the page. One concatenated body would hoist across every file and hide that.
function runScript(ctx, s) {
  try { new vm.Script(s.code, { filename: s.name }).runInContext(ctx); }
  catch (e) { e.message = `${s.name}: ${e.message}`; throw e; }
}
const apiOf = (ctx) => ({ load: typeof ctx.load === 'function' ? ctx.load : null });
const turns = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); };

/** Evaluate the panel's scripts under a minimal DOM, returning what happened. */
function bootPanel(payload, overrides = {}, scripts = SCRIPTS) {
  const { ctx, store } = realm(payload, overrides);
  for (const s of scripts) runScript(ctx, s);
  return { api: apiOf(ctx), store, ctx };
}

// The browser runs other tasks BETWEEN two classic scripts while it fetches the next one, so the
// response to a request an earlier script made can land before a later script has run. Draining
// the task queue after every script is the worst case of that.
async function bootPanelInterleaved(payload, overrides = {}, scripts = SCRIPTS) {
  const { ctx, store } = realm(payload, overrides);
  for (const s of scripts) { runScript(ctx, s); await turns(); }
  return { api: apiOf(ctx), store, ctx };
}

/** Unhandled rejections raised while `fn` runs and for a few turns after it. */
async function rejectionsDuring(fn) {
  const seen = [];
  const onRej = (e) => seen.push(e);
  process.on('unhandledRejection', onRej);
  try { await fn(); await turns(); } finally { process.off('unhandledRejection', onRej); }
  return seen;
}

test('SECOND WITNESS: the harness runs scripts apart, so a call into a later script fails here', () => {
  // The property the per-script evaluation exists for, shown on the harness itself: the same two
  // statements pass as one script and fail as two. A harness that concatenated would pass both.
  const call = { name: 'early.js', code: 'late();' };
  const decl = { name: 'late.js', code: 'function late(){}' };
  assert.doesNotThrow(() => bootPanel(bootPayload(), {}, [{ name: 'one.js', code: `${call.code}\n${decl.code}` }]));
  assert.throws(() => bootPanel(bootPayload(), {}, [call, decl]), /early\.js: late is not defined/);
});

test('SECOND WITNESS, async: a response landing between two scripts is caught', async () => {
  // Run back to back, the continuation finds late(); with the queue drained between the scripts it
  // does not. A harness that never yields between scripts would pass the broken order.
  const early = { name: 'early.js',
    code: "var outcome='pending';(async()=>{ await fetch('/api/x'); try{ late(); outcome='ran'; }catch(e){ outcome=e.message; } })();" };
  const decl = { name: 'late.js', code: 'function late(){}' };
  const together = bootPanel(bootPayload(), {}, [early, decl]);
  await turns();
  assert.equal(together.ctx.outcome, 'ran');
  const apart = await bootPanelInterleaved(bootPayload(), {}, [early, decl]);
  await turns();
  assert.match(apart.ctx.outcome, /late is not defined/);
});

test('the panel client loads as separate scripts, and panel-boot.js runs last', () => {
  const names = SCRIPTS.map((s) => s.name);
  assert.ok(names.filter((n) => /^\/static\/panel-/.test(n)).length >= 8,
    `expected the panel client's parts as separate scripts, found: ${names.join(', ')}`);
  assert.equal(names[names.length - 1], '/static/panel-boot.js',
    'the boot must be the last script: setView() dispatches to loaders every earlier script declares');
});

test('THE REGRESSION: the panel script evaluates without throwing', () => {
  // A throw here is a dead panel: the static shell renders and no data ever loads. The message
  // names the variable, which is what makes a declaration-order break diagnosable in one read.
  assert.doesNotThrow(() => bootPanel(bootPayload()),
    'the panel script threw at top level — every statement after the throw is dead, including the first load()');
});

// ── EVERY VIEW, NOT JUST THE DEFAULT ────────────────────────────────────────────────────────────
// The three earlier temporal-dead-zone breaks (pfMe/pfKind/pfError, craTickTimer, LEARN) all killed
// the DEFAULT view, so booting at '/' caught them and this file read as covering the class. It did
// not. setView() dispatches per view — `if(v==='codeql')loadCodeql()` and fifteen siblings — and
// boot enters whatever view the URL names. A `let` that only ONE of those loaders touches is in its
// dead zone only when that view is the entry point, and nothing here ever entered one.
//
// Found in production, not here: commitwork.online/codeql/ threw `Cannot access 'cqJobsError'
// before initialization`, dead script, on a suite that was green. The variable was declared ~950
// lines below the setView call that reaches it.
//
// The view list is DERIVED from the page's own NATIVE map, so a view added tomorrow is booted here
// without anyone remembering to add it — a hand-written list would reproduce the exact gap this
// test exists to close.
// V8's own wording for a code fault. Deliberately NOT a list of things the panel says: these are
// strings the ENGINE produces, so a panel that renders one is quoting an exception it caught, and
// no legitimate empty state contains them.
const ENGINE_FAULTS = [
  /Cannot access '[^']+' before initialization/,
  /[A-Za-z_$][\w$]* is not defined/,
  /[\w.$]+ is not a function/,
  /Cannot read properties of (?:undefined|null)/,
  /Assignment to constant variable/,
];

function pageViews() {
  const native = PANEL.match(/const NATIVE=\{([^}]*)\}/);
  assert.ok(native, 'index.html no longer declares const NATIVE={...} — update this extractor with the router');
  const keys = [...native[1].matchAll(/([a-z0-9]+):/g)].map((m) => m[1]);
  assert.ok(keys.length > 20, `view extraction degenerated (${keys.length}) — the loop below would prove nothing`);
  return keys;
}

// AND IT MUST CATCH REJECTIONS, NOT ONLY THROWS. setView's dispatch calls its loaders WITHOUT
// awaiting them, and most are `async`. A ReferenceError inside one therefore surfaces as an
// unhandled promise rejection: the script keeps running, the picker fills, the poll starts, and
// only that one view stays empty — which reads as "no data" rather than as a crash. Wrapping boot
// in assert.doesNotThrow goes green on exactly that, and did: this test passed against the real
// cqJobsError defect until the rejection capture was added. The throw path is kept because the
// three earlier breaks came through it.
test('EVERY view boots — a loader that reads a `let` declared below setView breaks only its own view', async () => {
  const dead = [];
  const rejections = [];
  const onRej = (e) => rejections.push(e);
  process.on('unhandledRejection', onRej);
  try {
    for (const v of pageViews()) {
      const path = `/${v}/`;
      rejections.length = 0;
      let store = new Map();
      try {
        const booted = bootPanel(bootPayload(), {
          location: { pathname: path, search: '', hash: '', href: `http://x${path}` },
        });
        store = booted.store;
        // load() as well as evaluation: some loaders are reached only through the first render.
        if (booted.api.load) await booted.api.load();
      } catch (e) {
        dead.push(`${path} → threw: ${e.message}`);
      }
      // A rejection is only "unhandled" once a full turn has passed with no handler attached, so
      // the drain has to be real macrotask turns — an `await null` settles too early to see it.
      for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
      for (const e of rejections) dead.push(`${path} → rejected: ${(e && e.message) || e}`);
      // ...AND THE THIRD WAY, which is how the real one escaped both of the above. loadCodeql
      // wraps its whole body in try/catch and renders the caught message into the table:
      // "no CodeQL data — generate with node monitor/codeql-fleet-data.mjs (Cannot access
      // 'cqJobsError' before initialization)". Neither a throw nor a rejection — a JS engine fault
      // presented to the operator as a DATA condition, telling them to run a generator that would
      // not have helped. This is the house's own failure shape in the UI layer, so the assertion is
      // the general one: no view may render an engine error string, whoever caught it.
      for (const el of store.values()) {
        const text = `${el.innerHTML || ''} ${el.textContent || ''}`;
        const hit = ENGINE_FAULTS.find((re) => re.test(text));
        if (hit) dead.push(`${path} → rendered an engine error in #${el.id}: ${(text.match(hit) || [])[0]}`);
      }
    }
  } finally { process.off('unhandledRejection', onRej); }
  assert.deepEqual(dead, [],
    'these views fail at boot. A ReferenceError naming a variable means it is declared BELOW '
    + 'setView() — move it into the ROUTER STATE block above setView. "rejected" rather than '
    + '"threw" means the loader is async, so the panel survives and only that view is left blank.');
});

test('a response landing BETWEEN two scripts reaches no declaration a later script makes', async () => {
  const dead = [];
  for (const v of pageViews()) {
    const path = `/${v}/`;
    const seen = await rejectionsDuring(async () => {
      try {
        await bootPanelInterleaved(bootPayload(), {
          location: { pathname: path, search: '', hash: '', href: `http://x${path}` },
        });
      } catch (e) { dead.push(`${path} → threw: ${e.message}`); }
    });
    for (const e of seen) dead.push(`${path} → rejected: ${(e && e.message) || e}`);
  }
  assert.deepEqual(dead, [],
    'a request an earlier part starts can be answered before a later part has run, and its '
    + 'continuation then reaches a declaration that does not exist yet. Start it from panel-boot.js.');
});

test('setView() at boot touches no variable declared after it', () => {
  // The specific shape: `setView(urlView(),true)` runs near the end of the script but BEFORE the
  // tail of it has executed. Any `let` it reads from further down is in its temporal dead zone.
  let err = null;
  try { bootPanel(bootPayload()); } catch (e) { err = e; }
  if (err) {
    assert.fail(`boot-time setView() hit a temporal dead zone: ${err.message}. `
      + 'Declare that variable in the ROUTER STATE block above setView() — see the note there.');
  }
});

test('load() completes on the no-project payload and populates the picker', async () => {
  const { api, store } = bootPanel(bootPayload());
  assert.ok(api.load, 'load() is not reachable — the script did not finish evaluating');
  await api.load();
  const proj = store.get('proj');
  const options = (proj.innerHTML.match(/<option/g) || []).length;
  // 3 projects + the "— select a project —" placeholder. The placeholder is load-bearing: without
  // it the picker would show a project name while curProj is '', claiming a selection nobody made.
  assert.equal(options, 4, 'the project picker did not populate from payload.projects');
  assert.match(proj.innerHTML, /value=""/, 'no empty-value placeholder option — an unselected picker must be able to SHOW unselected');
});

test('a payload with every per-project field null does not throw', async () => {
  // The boot case is ALSO the "project has never been swept" case. Nulls here must render as
  // absent, never crash the renderer — a throw would take the picker down with it and leave the
  // operator unable to select the project that WOULD have data.
  // ONLY the fields the server actually nulls. Nulling `dimensions` (a static const array on the
  // server) would assert a contract the server cannot break — a test that invents a failure mode
  // proves nothing about the real one.
  const p = bootPayload();
  for (const k of ['generated', 'modernization', 'program', 'security', 'scanners',
    'scannerRegistry', 'scannerFindings', 'buildHealth', 'qualityGates', 'preflight', 'codeql']) p[k] = null;
  const { api } = bootPanel(p);
  assert.ok(api.load);
  await assert.doesNotReject(() => api.load(),
    'load() rejected on an all-null payload — the panel cannot render "nothing scanned yet"');
});

// ── THE PROJECT IS PART OF THE ROUTE ────────────────────────────────────────────────────────────
// /leaks/ named a VIEW and no SUBJECT — "leaks for whatever this browser last chose". The project
// now lives in the path as /<slug>/<view>/. The path carries the SLUG because labels contain spaces
// ("commitwork admin"), and the slug->label map is read back from the registry rather than derived.

const SLUGGED = { ...bootPayload(), slugs: { ClientA: 'clientA', 'commitwork admin': 'commitwork-admin', 'overwatch-layer': 'overwatch-layer' } };

test('a URL that names a project WINS over the stored preference', async () => {
  const { api, store } = bootPanel(SLUGGED, {
    location: { pathname: '/overwatch-layer/leaks/', search: '', hash: '', href: 'http://x/overwatch-layer/leaks/' },
    localStorage: { getItem: () => 'ClientA', setItem() {}, removeItem() {} },
  });
  await api.load();
  assert.equal(store.get('proj').value, 'overwatch-layer',
    'localStorage overrode the URL — the link would show whatever this browser last looked at');
});

test('the SLUG in the path resolves to the LABEL via the registry map, not by slugifying', async () => {
  const { api, store } = bootPanel(SLUGGED, {
    location: { pathname: '/commitwork-admin/leaks/', search: '', hash: '', href: 'http://x/commitwork-admin/leaks/' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  });
  await api.load();
  // "commitwork admin" is not derivable from "commitwork-admin" without the registry's own map.
  assert.equal(store.get('proj').value, 'commitwork admin');
});

test('an UNKNOWN slug selects nothing and says so — never a silently different project', async () => {
  const { api, store } = bootPanel(SLUGGED, {
    location: { pathname: '/not-a-project/leaks/', search: '', hash: '', href: 'http://x/not-a-project/leaks/' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  });
  await api.load();
  assert.equal(store.get('proj').value, '', 'an unknown slug must not fall through to some other project');
  assert.match(store.get('kpis').innerHTML, /unknown project/);
});

test('a bare view path is still a view — the stored preference is the fallback', async () => {
  const { api, store } = bootPanel(SLUGGED, {
    location: { pathname: '/leaks/', search: '', hash: '', href: 'http://x/leaks/' },
    localStorage: { getItem: () => 'overwatch-layer', setItem() {}, removeItem() {} },
  });
  await api.load();
  assert.equal(store.get('proj').value, 'overwatch-layer');
});

test('PRECEDENCE: a single segment is a VIEW, never a project', () => {
  // If a project were ever slugged `settings`, /settings/ must still mean the settings view.
  assert.match(PANEL, /if\(m&&knownView\(m\[2\]\)\)return deAlias\(m\[2\]\);/,
    'the two-segment form must require the SECOND segment to be a known view');
  assert.match(PANEL, /return m&&knownView\(m\[2\]\)\?m\[1\]:null;/,
    'a project slug is only read when the second segment is a view — otherwise /map/<slug> would parse as one');
});

// ── THE RETIRED NAME STILL RESOLVES ─────────────────────────────────────────────────────────────
// /leaks/ became /secrets/ (the lane has been keyed `secrets` everywhere else since it was written).
// A link in an issue outlives the name it was written with, so the old path must still land on the
// view — and must land on the RIGHT one, not fall through to Overview looking like it worked.
test('the retired /leaks/ path still resolves to the secrets view, with and without a project', async () => {
  for (const path of ['/leaks/', '/overwatch-layer/leaks/']) {
    const { api, store } = bootPanel(SLUGGED, {
      location: { pathname: path, search: '', hash: '', href: `http://x${path}` },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    });
    await api.load();
    assert.notEqual(store.get('view-secrets'), null, 'the secrets view container is missing');
    assert.notEqual(store.get('view-secrets').style.display, 'none',
      `${path} did not open the secrets view — an old link that lands on Overview reads as a working link to the wrong page`);
  }
});

test('no slug means a plain view path, not an invented segment', () => {
  assert.match(PANEL, /if\(!slug\)return v==='overview'\?'\/':\('\/'\+v\+'\/'\);/,
    'a guessed slug in a URL is a claim about identity nobody declared');
});
