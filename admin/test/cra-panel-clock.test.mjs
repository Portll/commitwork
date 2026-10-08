// node --test admin/test/ — the CRA countdown's CLIENT half, which renders a legal deadline.
//
// panel-boot.test.mjs proves the script evaluates. It does not exercise the CRA renderer, and until
// this file existed nothing did: the band arithmetic, the server-clock offset and the overdue
// formatting were the only untested code on a page whose whole purpose is to state how long is left
// before a reporting obligation lapses.
//
// The offset is the point. A browser that computes remaining time from ITS OWN clock renders a
// deadline through an unverified error term, and a laptop an hour fast would quietly show an hour
// less than the operator really has. Every assertion below drives the real functions out of
// admin/index.html rather than a copy of them.
// Source: evaluations/REMEDIATION-schema-derivation-2026-08-22.md, CRA test list item 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelSource, panelScripts } from './lib/panel-source.mjs';

const PANEL = panelSource('index.html');

const SERVER_NOW = '2026-07-20T12:00:00.000Z';
const H = 3600_000;

/** Boot the panel script and hand back the CRA internals, with a URL-aware fetch. */
function boot({ craPayload, browserNow = Date.parse(SERVER_NOW) } = {}) {
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
  const empty = { generated: null, projects: [], repos: [], retired: [], superseded: [], services: [],
    remediation: [], detailSchema: {}, scanScopes: {}, projectTotals: {}, slugs: {}, annotationHealth: {},
    scopeDelta: {}, runtime: {}, freshness: {}, has: {}, source: {}, dimensions: [], counts: {} };

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
    // The browser's clock, deliberately settable — that is the whole subject of this file.
    Date: class extends Date { static now() { return browserNow; } },
    fetch: async (url) => ({
      ok: true, status: 200, text: async () => '',
      json: async () => (String(url).startsWith('/api/cra/cases') ? craPayload : empty),
    }),
    EventSource: class { addEventListener() {} close() {} },
    navigator: { credentials: {}, userAgent: 'test' },
    addEventListener() {}, removeEventListener() {},
    setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, clearTimeout() {},
    requestAnimationFrame: (f) => f(), getComputedStyle: () => ({ getPropertyValue: () => '' }),
    alert() {}, prompt: () => null, confirm: () => true,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  sandbox.window = sandbox;

  // Every script the page carries, in document order: the static parts and the inline menu
  // components interleave, and the boot's setView() reaches into both. Declaration order across
  // files is panel-boot.test.mjs's subject; this file only needs the renderer booted.
  const main = panelScripts('index.html').map((s) => s.code).join('\n;\n');
  const names = Object.keys(sandbox);
  const fn = new Function(...names, `${main}\n;return {
    loadCra: typeof loadCra==='function'?loadCra:null,
    craBand: typeof craBand==='function'?craBand:null,
    craRemaining: typeof craRemaining==='function'?craRemaining:null,
    craCard: typeof craCard==='function'?craCard:null,
    skew: () => craSkewMs, now: () => craNow(),
  };`);
  return { api: fn(...names.map((n) => sandbox[n])), store };
}

const caseFor = (over = {}) => ({
  caseId: 'p--cve-1', kind: 'vulnerability', product: 'p', vulnId: 'CVE-2026-1',
  status: 'open', trigger: 'kev', kev: true, epss: 0.9, track: 'article14',
  reporting: { locale: 'DE', regime: 'regulatory', bodies: ['ENISA'], why: 'x' },
  overdue: [],
  clocks: {
    track: 'article14', basisAt: SERVER_NOW,
    earlyWarningDue: new Date(Date.parse(SERVER_NOW) + 24 * H).toISOString(),
    notificationDue: new Date(Date.parse(SERVER_NOW) + 72 * H).toISOString(),
    finalDue: new Date(Date.parse(SERVER_NOW) + 14 * 24 * H).toISOString(),
  },
  ...over,
});

// The clock vocabulary travels WITH the payload (cra/lib.mjs CLOCK_SPEC), so the browser is not a
// fourth copy of it. Mirrored here rather than imported: this file asserts what the CLIENT does
// with what it is given, and cra/test/clock-spec.test.mjs is what holds the server's copy honest.
const CLOCK_SPEC = {
  article14: [
    { key: 'earlyWarningDue', label: '24h early warning', escalationId: 'early-warning-24h' },
    { key: 'notificationDue', label: '72h notification', escalationId: 'notification-72h' },
    { key: 'finalDue', label: 'final report', escalationId: 'final-report' },
  ],
  internal: [
    { key: 'triageDue', label: 'triage', escalationId: 'internal-triage' },
    { key: 'remediateDue', label: 'remediate', escalationId: 'internal-remediate' },
  ],
};

const payload = (cases, over = {}) => ({
  ok: true, configured: true, at: SERVER_NOW, serverNow: SERVER_NOW,
  clockSpec: CLOCK_SPEC, paged: [],
  count: cases.length,
  counts: cases.reduce((a, c) => ({ ...a, [c.track]: (a[c.track] || 0) + 1 }),
    { article14: 0, bestpractice: 0, internal: 0, unknown: 0 }),
  cases, ...over,
});

test('the CRA renderer is reachable at all — it boots with the rest of the script', () => {
  const { api } = boot({ craPayload: payload([caseFor()]) });
  for (const k of ['loadCra', 'craBand', 'craRemaining', 'craCard']) {
    assert.ok(api[k], `${k} is not reachable — the script did not finish evaluating, or it was renamed`);
  }
});

test('THE SKEW: a browser an hour fast still renders the SERVER\'s remaining time', async () => {
  const fast = Date.parse(SERVER_NOW) + 1 * H;   // this machine believes it is an hour later
  const { api } = boot({ craPayload: payload([caseFor()]), browserNow: fast });
  await api.loadCra();
  // The offset is server-minus-browser, so a fast browser yields a NEGATIVE skew of about an hour.
  assert.ok(Math.abs(api.skew() + H) < 5000, `skew should be about -1h, got ${api.skew()}ms`);
  // …and craNow() must land back on the server's instant, not the browser's.
  assert.ok(Math.abs(api.now() - Date.parse(SERVER_NOW)) < 5000,
    'craNow() drifted toward the browser clock — the countdown would understate the time remaining');
});

test('a skewed browser does not change how much time is left', async () => {
  const due = Date.parse(SERVER_NOW) + 24 * H;
  const onTime = boot({ craPayload: payload([caseFor()]) });
  await onTime.api.loadCra();
  const slow = boot({ craPayload: payload([caseFor()]), browserNow: Date.parse(SERVER_NOW) - 3 * H });
  await slow.api.loadCra();
  assert.equal(
    onTime.api.craRemaining(due, onTime.api.now()),
    slow.api.craRemaining(due, slow.api.now()),
    'two browsers with different clocks reported different time remaining on the same deadline',
  );
});

test('bands fire at 50, 75 and 90 per cent elapsed, and OVERDUE past the due date', () => {
  const { api } = boot({ craPayload: payload([caseFor()]) });
  const start = 0, due = 100_000;                       // a tidy span so the percentages are exact
  const at = (pct) => api.craBand(start, due, (due * pct) / 100);
  assert.equal(at(0).k, 'ok');
  assert.equal(at(49).k, 'ok');
  assert.equal(at(50).k, 'p50', 'the boundary itself must be inside the band, not below it');
  assert.equal(at(74).k, 'p50');
  assert.equal(at(75).k, 'p75');
  assert.equal(at(89).k, 'p75');
  assert.equal(at(90).k, 'p90');
  assert.equal(at(100).k, 'p90', 'exactly at the deadline is not yet overdue');
  assert.equal(api.craBand(start, due, due + 1).k, 'overdue');
});

test('an overdue clock is never rendered as running', () => {
  const { api } = boot({ craPayload: payload([caseFor()]) });
  const b = api.craBand(0, 100, 500);
  assert.equal(b.k, 'overdue');
  assert.equal(b.pct, 100, 'an overdue band must saturate, never wrap to a small percentage');
  assert.match(api.craRemaining(100, 500), /^OVERDUE by /);
});

test('a zero-length or inverted span does not produce NaN or a false 0%', () => {
  const { api } = boot({ craPayload: payload([caseFor()]) });
  // basisAt === due (a clock whose basis was never re-based) must not divide by zero.
  const z = api.craBand(1000, 1000, 999);
  assert.ok(Number.isFinite(z.pct), 'NaN% would render as a blank countdown that looks calm');
  const missing = api.craBand(0, NaN, 500);
  assert.equal(missing, null, 'an unparseable due date must be reported as absent, never scored');
});

test('the three tracks render into separate containers and are never totalled', async () => {
  const cases = [
    caseFor(),
    caseFor({ caseId: 'q--cve-2', track: 'bestpractice', reporting: { locale: null, bodies: [], why: 'no locale' } }),
    caseFor({
      caseId: 'q--cve-3', track: 'internal', trigger: 'crit', kev: false, epss: null,
      clocks: { track: 'internal', basisAt: SERVER_NOW, triageDue: new Date(Date.parse(SERVER_NOW) + 72 * H).toISOString(), remediateDue: new Date(Date.parse(SERVER_NOW) + 30 * 24 * H).toISOString() },
    }),
  ];
  const { api, store } = boot({ craPayload: payload(cases) });
  await api.loadCra();
  assert.equal(store.get('cra-n-a14').textContent, '1');
  assert.equal(store.get('cra-n-bp').textContent, '1');
  assert.equal(store.get('cra-n-int').textContent, '1');
  // The headline states each track; a bare "3" would fold a regulatory obligation together with a
  // policy clock, which is the misreport the whole split exists to prevent.
  const headline = store.get('cra-n').textContent;
  assert.match(headline, /1 regulatory/);
  assert.match(headline, /1 best-practice/);
  assert.match(headline, /1 internal/);
  assert.ok(!/^3\b/.test(headline), 'the tracks were totalled into one number');
});

test('an internal case renders its OWN clock names, never the Art. 14 ones', async () => {
  const { api } = boot({ craPayload: payload([caseFor()]) });
  await api.loadCra();                       // the clock vocabulary arrives with the payload
  const html = api.craCard(caseFor({
    track: 'internal', trigger: 'crit',
    clocks: { track: 'internal', basisAt: SERVER_NOW, triageDue: SERVER_NOW, remediateDue: SERVER_NOW },
  }));
  assert.match(html, /triage/);
  assert.ok(!/early warning/.test(html), 'an internal policy clock must not be labelled as a regulatory one');
  assert.match(html, /not filed/, 'only the regulatory track may advertise as filable');
});

test('no case log renders as "never run", not as an empty green', async () => {
  const { api, store } = boot({ craPayload: { ok: true, configured: false, count: 0, cases: [] } });
  await api.loadCra();
  assert.match(store.get('cra-n').textContent, /never run|no case log/i);
  assert.equal(store.get('cra-article14').innerHTML, '', 'a never-run watch must not render an empty "all clear" list');
});

// ── the server's verdict vs the client's tick (11.2) ───────────────────────────────────────────
// Two independent notions of "overdue" existed: escalate.mjs decided server-side and banked a
// chain-covered `paged` event, and this page decided by ticking. Where they disagreed the chained
// one was authoritative and the visible one was the lie. The page now renders the SERVER's verdict
// and the SERVER's paged ledger; the countdown beside it is a live convenience, not a judgement.

test('an overdue clock with NO paged event is called out — the worst state, previously invisible', async () => {
  const late = caseFor({ overdue: ['early-warning-24h'] });
  const { api } = boot({ craPayload: payload([late], { paged: [] }) });
  await api.loadCra();
  const html = api.craCard(late);
  assert.match(html, /OVERDUE · NOT PAGED/,
    'an overdue deadline nobody has been paged about must not look like a merely-overdue one');
});

test('an overdue clock WITH a chain-covered paged event reads as paged', async () => {
  const late = caseFor({ overdue: ['early-warning-24h'] });
  const key = `${late.caseId}|early-warning-24h|${late.clocks.earlyWarningDue}`;
  const { api } = boot({ craPayload: payload([late], { paged: [key] }) });
  await api.loadCra();
  const html = api.craCard(late);
  assert.match(html, />paged</);
  assert.ok(!/NOT PAGED/.test(html));
});

test('the paged key is exact — a re-based due date re-arms the alarm', async () => {
  // escalate.mjs keys de-dup on {caseId, clock, due}, so an ack that moves a deadline legitimately
  // re-pages. A page recorded against the OLD due must not silence the NEW one.
  const late = caseFor({ overdue: ['early-warning-24h'] });
  const stale = `${late.caseId}|early-warning-24h|${new Date(Date.parse(SERVER_NOW) - 99 * H).toISOString()}`;
  const { api } = boot({ craPayload: payload([late], { paged: [stale] }) });
  await api.loadCra();
  assert.match(api.craCard(late), /OVERDUE · NOT PAGED/,
    'a paged event for a different due date silenced the current one');
});

test('a payload with no clockSpec renders no clock rows rather than invented ones', async () => {
  const { api } = boot({ craPayload: payload([caseFor()], { clockSpec: undefined }) });
  await api.loadCra();
  const html = api.craCard(caseFor());
  assert.ok(!/early warning/.test(html), 'the browser invented a clock vocabulary it was not given');
});
