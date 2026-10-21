// The `apifuzz` view ("Interface checks", Schemathesis lane): reachable, bound to a render path,
// and honest in each state. Asserts behaviour of the panel source (via the panel-source seam), not
// that the name appears somewhere.
//
// apifuzz is a GENERIC lane: it has no markup of its own and shares #view-lane with ten sibling
// lanes. So "reachable" means the whole chain holds: a link -> a VALID view -> NATIVE maps it to a
// container that exists -> SCANNER_TABS binds a renderer that writes only when it is the active view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelHtml, panelScript } from './lib/panel-source.mjs';
import { panelSchema } from '../../monitor/detail-schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = panelHtml('index.html');
const JS = panelScript('index.html');
const SERVE = readFileSync(join(HERE, '..', 'serve.mjs'), 'utf8');

const objLiteral = (name) => {
  const at = JS.indexOf(`const ${name}={`);
  assert.ok(at > -1, `const ${name}={ not found in the panel script`);
  const open = JS.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < JS.length; i++) {
    if (JS[i] === '{') depth++;
    else if (JS[i] === '}' && --depth === 0) return JS.slice(open, i + 1);
  }
  assert.fail(`unbalanced ${name}`);
};
const NATIVE = new Function(`return ${objLiteral('NATIVE')}`)();

test('reachable: a link mechanism targets apifuzz and it is a valid, mapped view', () => {
  assert.match(HTML, /<button[^>]*\bdata-v="apifuzz"[^>]*class="vtab"|<button[^>]*class="vtab"[^>]*\bdata-v="apifuzz"/,
    'no data-v="apifuzz" menu button — nothing in the panel opens it');
  assert.match(HTML, /id="vn-apifuzz"/, 'the menu button has no badge slot for setTabN to fill');
  assert.equal(NATIVE.apifuzz, 'view-lane', 'NATIVE must map apifuzz to the shared lane container');
  assert.match(HTML, /<main[^>]*\bid="view-lane"/, 'the container NATIVE names does not exist in the markup');
  assert.match(JS, /const VALID_VIEWS=new Set\(\[\.\.\.Object\.keys\(NATIVE\)/, 'VALID_VIEWS is no longer derived from NATIVE');
});

test('reachable: it is grouped (Running services) rather than collecting under Other', () => {
  const m = JS.match(/dast:'dynamic',[^\n]*\bapifuzz:'dynamic'/);
  assert.ok(m, "TAB_GROUPS does not file apifuzz under 'dynamic'");
  assert.match(JS, /const GROUP_ORDER=\[[^\]]*'dynamic'/, "'dynamic' is not a rendered section");
});

test('reachable by deep link: the server whitelists /apifuzz/ as a panel path', () => {
  const set = SERVE.match(/const PANEL_VIEWS = new Set\(\[([^\]]*)\]/);
  assert.ok(set, 'PANEL_VIEWS not found in admin/serve.mjs');
  assert.ok(/'apifuzz'/.test(set[1]), 'a refresh on /apifuzz/ would 404');
});

test('bound render path: SCANNER_TABS has an apiFuzz entry on the shared lane container', () => {
  assert.match(JS, /\{key:'apiFuzz', view:'apifuzz', n:'lane-n', cov:'lane-cov', rows:'lane-rows', cols:6, generic:true\}/);
  for (const id of ['lane-n', 'lane-cov', 'lane-rows', 'lane-title', 'lane-thead', 'lane-foot']) {
    assert.ok(HTML.includes(`id="${id}"`), `renderer writes #${id}, which the markup lacks`);
  }
  assert.match(JS, /LANE_TITLE=\{[^}]*apiFuzz:'API fuzz'/, 'no heading for the lane');
  assert.ok(panelSchema().apiFuzz, 'detail schema has no apiFuzz entry: the lane could not derive its columns');
});

// ---- the renderer, lifted and run against a recording DOM shim (same technique as scanner-tabs) ----
const escLine = JS.split('\n').find((l) => l.startsWith('const esc='));
const ageAt = JS.indexOf('const age=(iso)=>');
const rowAt = JS.indexOf('const DETAIL_CELL=');
const fnAt = JS.indexOf('function renderScannerTabs(d){');
assert.ok(escLine && ageAt > -1 && rowAt > -1 && fnAt > -1, 'renderer block not found in the panel script');
const ageSrc = JS.slice(ageAt, JS.indexOf(';\n', JS.indexOf("'d old'", ageAt)) + 1);
const block = JS.slice(rowAt, JS.indexOf('\n}', fnAt) + 2);

function harness(curView) {
  const els = {}, badges = {};
  const $ = (id) => (els[id] ||= { id, innerHTML: '', textContent: '' });
  // nosemgrep: javascript.browser.security.eval-detected.eval-detected -- evaluates the esc() source read from the panel file under test
  const esc = eval(`(${escLine.slice(escLine.indexOf('=') + 1).replace(/;$/, '')})`);
  const render = new Function('$', 'setTabN', 'esc', 'sevPill', 'curView', `${ageSrc}\n${block}\nreturn renderScannerTabs;`)(
    $, (v, n) => { badges[v] = n; }, esc, (s) => `<span class="pill">${s}</span>`, curView);
  const SCHEMA = panelSchema();
  return { render: (d) => render({ detailSchema: SCHEMA, ...d }), $, badges, els };
}
const fuzzRow = (i) => ({ repo: 'repoX', operation: `GET /items/${i}`, sev: 'high', message: 'server error 500', file: 'openapi.json', line: 0 });

test('state ABSENT: no apiFuzz record renders "never scanned", not an empty clean table', () => {
  const h = harness('apifuzz');
  h.render({ scanners: {}, scannerFindings: {} });
  assert.equal(h.$('lane-n').textContent, '—');
  assert.match(h.$('lane-cov').innerHTML, /No result — never scanned here/);
  assert.ok(!/class="pill live"/.test(h.$('lane-rows').innerHTML + h.$('lane-cov').innerHTML), 'absent must never render as clean');
  assert.equal(h.badges.apifuzz, null, 'an absent lane keeps a CLEARED badge, never a fabricated 0');
  assert.equal(h.$('lane-title').textContent, 'API fuzz');
});

test('state VOID: ran=0 renders a void, not a zero-findings pass', () => {
  const h = harness('apifuzz');
  h.render({ scanners: { apiFuzz: { total: 0, ran: 0, skipped: 3, noscan: 1 } }, scannerFindings: { apiFuzz: [] } });
  assert.match(h.$('lane-cov').innerHTML, /VOID — no trustworthy output/);
  assert.match(h.$('lane-rows').innerHTML, /nothing scanned/);
  assert.ok(!/class="pill live"/.test(h.$('lane-cov').innerHTML));
  assert.equal(h.badges.apifuzz, null);
});

test('state POPULATED: rows are rendered with schema-derived headers and the badge equals the total', () => {
  const h = harness('apifuzz');
  h.render({
    scanners: { apiFuzz: { total: 2, ran: 1, skipped: 0, noscan: 0, crit: 0, high: 2, med: 0, low: 0 } },
    scannerFindings: { apiFuzz: [fuzzRow(1), fuzzRow(2)] },
  });
  assert.equal(h.$('lane-n').textContent.includes('2'), true, `count shown: ${h.$('lane-n').textContent}`);
  assert.match(h.$('lane-thead').innerHTML, /<th>Operation<\/th>/);
  assert.match(h.$('lane-rows').innerHTML, /GET \/items\/1/);
  assert.match(h.$('lane-rows').innerHTML, /GET \/items\/2/);
  assert.equal(h.badges.apifuzz, 2);
});

test('shared container: apifuzz writes nothing while another view is on screen, but still reports its badge', () => {
  const h = harness('tls');
  h.render({ scanners: { apiFuzz: { total: 7, ran: 1, skipped: 0, noscan: 0 } }, scannerFindings: { apiFuzz: [fuzzRow(1)] } });
  assert.ok(!/GET \/items/.test(h.$('lane-rows').innerHTML), 'an inactive generic lane overwrote the shared table');
  assert.equal(h.badges.apifuzz, 7);
});

test('schema absent fails closed: no columns are invented', () => {
  const h = harness('apifuzz');
  h.render({ detailSchema: null, scanners: { apiFuzz: { total: 1, ran: 1, skipped: 0, noscan: 0 } }, scannerFindings: { apiFuzz: [fuzzRow(1)] } });
  assert.ok(!/<th>Operation<\/th>/.test(h.$('lane-thead').innerHTML));
});
