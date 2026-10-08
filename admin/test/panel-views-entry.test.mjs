// The four panel views the census found unexercised: allfindings, depsjvm, depsretire and
// secretshistory. Each is BOOTED, not grepped: the panel's scripts run in document order in one vm
// realm (the method of panel-boot.test.mjs), the URL names the view, and the assertions read what the
// router and the renderer actually did:
//   · the element NATIVE names for the view is the one shown, and the iframe is not used;
//   · the data route the view reads from is the one requested (/api/state, for the selected project);
//   · the renderer drew THIS view's rows from that payload, under this view's title.
// The payload's row schema is the server's own (monitor/detail-schema.mjs panelSchema()), which is
// what /api/state sends as detailSchema. /api/state itself is not invoked: admin/lib/state-view.mjs
// reads reports/runtime-latest/* under the checkout with no CW_* override.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { panelSource, panelScripts } from './lib/panel-source.mjs';
import { panelSchema } from '../../monitor/detail-schema.mjs';

const PANEL = panelSource('index.html');
const SCRIPTS = panelScripts('index.html');
const PROJECT = 'Fix Area';

const LANES = {
  secretshistory: { key: 'secretsHistory', title: 'Secrets history', marker: 'FixtureDetector', afMarker: 'FixtureDetector',
    row: { repo: 'fixrepo', detector: 'FixtureDetector', file: 'config/old.env', line: 3, sev: 'high', commit: 'abc1234', verified: true, verificationError: null } },
  depsjvm: { key: 'depsJvm', title: 'JVM CVEs', marker: 'org.example:fixture-lib', afMarker: 'org.example:fixture-lib@1.0.0',
    row: { repo: 'fixrepo', id: 'CVE-2099-1111', package: 'org.example:fixture-lib', version: '1.0.0', sev: 'crit', fixed: '1.0.1' } },
  // All findings names a retire row by advisory id and the file it was found in (its rule cell reads
  // f.id before f.component), so that is what its row is recognised by there.
  depsretire: { key: 'depsRetire', title: 'Retire.js', marker: 'fixture-jquery', afMarker: 'RETIRE-2099-1',
    row: { repo: 'fixrepo', component: 'fixture-jquery', version: '1.2.3', id: 'RETIRE-2099-1', sev: 'low', file: 'public/vendor.js', message: 'synthetic advisory' } },
};

/** What /api/state returns for one selected project, carrying one row in each of the three lanes. */
function statePayload() {
  const scanners = {}, scannerFindings = {};
  for (const { key, row } of Object.values(LANES)) {
    scanners[key] = { total: 1, ran: 1, skipped: 0, noscan: 0 };
    scannerFindings[key] = [row];
  }
  return {
    generated: '2026-10-01T00:00:00.000Z', modernization: null, program: null, security: null,
    scanners, scannerRegistry: null, scannerFindings,
    buildHealth: null, qualityGates: null, preflight: null, codeql: null,
    detailSchema: panelSchema(), scanScopes: {}, projectTotals: {}, slugs: { [PROJECT]: 'fix-area' },
    projects: [PROJECT], repos: [], retired: [], superseded: [], services: [],
    remediation: [], annotationHealth: {}, scopeDelta: {}, runtime: {},
    freshness: {}, has: {}, source: {}, dimensions: [], counts: {},
  };
}

/** A minimal DOM realm (after panel-boot.test.mjs), with a fetch that records every URL asked for. */
function boot(view, { preset = {} } = {}) {
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
  const store = new Map([...ids].map((i) => [i, Object.assign(mk(i), preset[i] || {})]));
  const fetched = [];
  const payload = statePayload();
  const sandbox = {
    document: {
      getElementById: (i) => store.get(i) || null,
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, createElement: () => mk('x'),
      body: mk('body'), documentElement: mk('html'), title: '',
    },
    location: { pathname: `/${view}/`, hash: '', href: `http://127.0.0.1/${view}/`, search: '' },
    history: { replaceState() {}, pushState() {} },
    // A bare view path: the stored pick is the selection, as it is for an operator returning to a tab.
    localStorage: { getItem: (k) => (k === 'cw-proj' ? PROJECT : null), setItem() {}, removeItem() {} },
    fetch: async (url) => {
      const u = String(url || '');
      fetched.push(u);
      const body = u.startsWith('/api/state') ? payload
        : u.startsWith('/api/panel/health') ? { ok: true, pid: 1, node: 'v26.0.0', startedAt: '2026-10-01T00:00:00.000Z', uptimeSecs: 1,
          memory: { rss: 1, heapUsed: 1 }, supervised: true, code: { watched: 1, stale: false, changed: [] } }
          : {};
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
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const s of SCRIPTS) {
    try { new vm.Script(s.code, { filename: s.name }).runInContext(ctx); }
    catch (e) { e.message = `${s.name}: ${e.message}`; throw e; }
  }
  return { ctx, store, fetched, el: (id) => store.get(id) };
}
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); };
const evalIn = (ctx, src) => new vm.Script(src).runInContext(ctx);

describe('the router table names a native element and a renderer for each view', () => {
  test('NATIVE maps the three lanes to the shared lane view and allfindings to its own element', () => {
    const { ctx, el } = boot('overview');
    const native = evalIn(ctx, 'NATIVE');
    assert.equal(native.allfindings, 'view-allfindings');
    for (const v of Object.keys(LANES)) assert.equal(native[v], 'view-lane', v);
    for (const id of ['view-allfindings', 'view-lane']) assert.ok(el(id), `#${id} is not in the panel markup`);
  });

  test('each lane view is served by a SCANNER_TABS entry keyed to its /api/state category', () => {
    const { ctx } = boot('overview');
    const tabs = evalIn(ctx, 'SCANNER_TABS.map(t=>({view:t.view,key:t.key,generic:!!t.generic}))');
    for (const [view, { key }] of Object.entries(LANES)) {
      const t = tabs.find((x) => x.view === view);
      assert.ok(t, `no scanner tab draws ${view}`);
      assert.equal(t.key, key);
      assert.equal(t.generic, true, `${view} draws into the shared lane container`);
      assert.ok(panelSchema()[key], `the server sends no detail schema for ${key}`);
    }
    assert.equal(evalIn(ctx, 'typeof renderScannerTabs'), 'function');
    assert.equal(evalIn(ctx, 'typeof renderAllFindings'), 'function');
    assert.deepEqual(Object.keys(LANES).map((v) => evalIn(ctx, `SCANNER_VIEWS.has(${JSON.stringify(v)})`)), [true, true, true]);
  });
});

describe('each lane view, booted at its own path', () => {
  for (const [view, lane] of Object.entries(LANES)) {
    test(`/${view}/ shows the lane element, reads /api/state for the project, and draws only its own rows`, async () => {
      const { ctx, el, fetched } = boot(view);
      await settle();
      await evalIn(ctx, 'load()');
      assert.equal(evalIn(ctx, 'curView'), view);
      assert.ok(fetched.includes(`/api/state?project=${encodeURIComponent(PROJECT)}`), `fetched: ${fetched.join(', ')}`);
      assert.equal(el('view-lane').style.display, '', 'the lane element is not shown');
      assert.equal(el('view-allfindings').style.display, 'none');
      assert.equal(el('viewframe').style.display, 'none', 'a native view must not fall through to the iframe');
      assert.equal(el('lane-title').textContent, lane.title);
      const rows = el('lane-rows').innerHTML;
      assert.ok(rows.includes(lane.marker), `${view} did not draw its own row: ${rows.slice(0, 300)}`);
      for (const other of Object.values(LANES).filter((l) => l !== lane)) {
        assert.equal(rows.includes(other.marker), false, `${view} drew ${other.key}'s row into the shared container`);
      }
      assert.ok(el('lane-thead').innerHTML.includes('<th>'), 'the column heads come from the server schema');
    });
  }
});

describe('/allfindings/', () => {
  test('shows its own element, reads /api/state, and lists every lane\'s open row most severe first, each linked to its view', async () => {
    const { ctx, el, fetched } = boot('allfindings', { preset: { 'af-cat': { value: 'all' } } });
    await settle();
    await evalIn(ctx, 'load()');
    assert.equal(evalIn(ctx, 'curView'), 'allfindings');
    assert.ok(fetched.includes(`/api/state?project=${encodeURIComponent(PROJECT)}`), `fetched: ${fetched.join(', ')}`);
    assert.equal(el('view-allfindings').style.display, '');
    assert.equal(el('view-lane').style.display, 'none');
    assert.equal(el('viewframe').style.display, 'none');
    assert.equal(el('af-n').textContent, '3');
    const html = el('af-rows').innerHTML;
    const at = (s) => html.indexOf(s);
    for (const { afMarker } of Object.values(LANES)) assert.ok(at(afMarker) >= 0, `missing ${afMarker}`);
    assert.ok(at('CVE-2099-1111') < at('FixtureDetector') && at('FixtureDetector') < at('RETIRE-2099-1'),
      'rows are not in crit → high → low order');
    for (const view of Object.keys(LANES)) assert.ok(html.includes(`data-go="${view}"`), `no row links back to ${view}`);
  });

  test('with no project selected it asks for one instead of rendering an empty, clean-looking list', async () => {
    const { ctx, el } = boot('allfindings', { preset: { 'af-cat': { value: 'all' } } });
    await settle();
    evalIn(ctx, 'curProj=""; renderAllFindings(lastState)');
    assert.equal(el('af-n').textContent, '—');
    assert.equal(el('af-rows').innerHTML, '');
    assert.match(el('af-sum').textContent, /Choose a project/);
  });
});
