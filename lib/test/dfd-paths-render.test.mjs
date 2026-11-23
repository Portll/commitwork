// lib/dfd-paths-render.mjs: the paths view's page. The page is drawn by lib/dfd-paths-client.js in
// a browser; these tests hold what the server side promises — the document embedded safely, a
// policy that admits exactly the page's own bytes, the legend unchanged, and stats that are
// lib/dfd.mjs threatPaths's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateDfd, threatPaths } from '../dfd.mjs';
import { LEGEND } from '../dfd-render.mjs';
import { FOLLOWER_JS } from '../theme-follower.mjs';
import { renderPathsHtml, embedJson, clientJs, pathsCss, ADDITIONS } from '../dfd-paths-render.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
function doc() {
  return {
    v: 1, kind: 'dfd', title: 'a </script> in a title & more',
    nodes: [
      { id: 'a', kind: 'external', subtype: 'actor', label: 'artifact' },
      { id: 'p', kind: 'process', label: 'parser' },
      { id: 'mem', kind: 'store', subtype: 'file', label: 'memory', impact: 'medium' },
      { id: 'os', kind: 'external', subtype: 'system', label: 'corruption', impact: 'critical' },
    ],
    flows: [{ from: 'a', to: 'p', mode: 'sync', label: 'bytes </script>' }, { from: 'p', to: 'mem', mode: 'sync' }, { from: 'a', to: 'os', mode: 'sync', gate: { state: 'unevaluated' } }],
    patches: [{ id: 'K1', guard: { from: 'a', to: 'p' }, closes: [{ from: 'p', to: 'mem' }], evidence: { level: 'tested' } }],
  };
}
const block = (html, open) => { const a = html.indexOf(open) + open.length; return html.slice(a, html.indexOf('</script>', a)); };

test('the embedded document parses back to the model, and no text in it can close the block', () => {
  // Arrange
  const m = doc();
  // Act
  const { html } = renderPathsHtml(m);
  const data = block(html, '<script type="application/json" id="dfd-data">');
  // Assert
  assert.deepEqual(JSON.parse(data), m);
  assert.equal(data.includes('<'), false);
  assert.match(html, /<title>a &lt;\/script&gt; in a title &amp; more — paths<\/title>/);
});

test('embedJson escapes the two line separators as well as <', () => {
  // Arrange
  const value = { s: `a<b${String.fromCharCode(0x2028)}c${String.fromCharCode(0x2029)}d` };
  // Act
  const text = embedJson(value);
  // Assert
  assert.equal(text, ['{"s":"a', 'u003cb', 'u2028c', 'u2029d"}'].join(String.fromCharCode(92)));
  assert.deepEqual(JSON.parse(text), value);
});

test('the policy admits exactly the style element and the two scripts the page carries, in header and meta form', () => {
  // Arrange
  const m = doc();
  // Act
  const { html, csp } = renderPathsHtml(m);
  const style = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
  const meta = html.slice(html.indexOf('content="default-src') + 9, html.indexOf('">', html.indexOf('content="default-src')));
  // Assert
  assert.equal(csp.includes(`style-src 'sha256-${sha(style)}'`), true);
  assert.equal(csp.includes(`script-src 'sha256-${sha(FOLLOWER_JS)}' 'sha256-${sha(clientJs())}'`), true);
  assert.equal(block(html, '<script>'), FOLLOWER_JS);
  assert.equal(html.includes(`<script>${clientJs()}</script>`), true);
  assert.equal(csp, `${meta}; frame-ancestors 'self'`);
  assert.equal(html.includes(' style="'), false);
});

test('the legend is the renderer\'s own, unchanged, and the additions follow it', () => {
  // Arrange
  const m = doc();
  // Act
  const { html } = renderPathsHtml(m);
  // Assert
  assert.equal(html.includes(LEGEND), true);
  assert.equal(html.indexOf(ADDITIONS) > html.indexOf(LEGEND), true);
});

test('stats are threatPaths\'s counts with every patch in force', () => {
  // Arrange
  const m = doc();
  const tp = threatPaths(m);
  // Act
  const { stats, html } = renderPathsHtml(m);
  // Assert
  assert.deepEqual(stats, { elements: 4, flows: 3, patches: 1, paths: 2, open: 0, unevaluated: 1, closed: 1, truncated: false });
  assert.equal(stats.paths, tp.paths.length);
  assert.match(html, /<noscript>.*2 source-to-impact path\(s\): 0 open, 1 not evaluated, 1 closed/);
});

test('a document with no patch and no title still renders, with the timeline at zero', () => {
  // Arrange
  const m = doc();
  delete m.patches;
  delete m.title;
  // Act
  const { html, stats } = renderPathsHtml(m);
  // Assert
  assert.equal(stats.patches, 0);
  assert.match(html, /<h1>data flow diagram<\/h1>/);
  assert.match(html, /id="scrub" min="0" max="0" step="1" value="0"/);
});

test('served fonts change the font source in the policy', () => {
  // Arrange
  const m = doc();
  // Act
  const served = renderPathsHtml(m, { fonts: 'served' }).csp;
  const none = renderPathsHtml(m).csp;
  // Assert
  assert.equal(served.includes("font-src 'self'"), true);
  assert.equal(none.includes('font-src data:'), true);
});

test('the page script is the rules module with its exports dropped, then the drawing script; the stylesheet is the file beside the module', () => {
  // Arrange
  const here = new URL('../', import.meta.url);
  const core = readFileSync(new URL('dfd-paths-core.mjs', here), 'utf8');
  const draw = readFileSync(new URL('dfd-paths-client.js', here), 'utf8');
  // Act
  const js = clientJs();
  const css = pathsCss();
  // Assert
  assert.equal(js, `${core.replace(/^export /gm, '')}\n${draw.replace(/^export /gm, '')}\nmountPathsView(document, createCore);\n`);
  assert.equal(/^export /m.test(js), false);
  assert.equal(js.includes('function createCore(M) {') && js.includes('function mountPathsView(document, createCore'), true);
  assert.equal(/^import /m.test(core), false);
  assert.equal(css, readFileSync(new URL('dfd-paths.css', here), 'utf8'));
});

test('the synthetic paths document is valid and its paths are as counted', () => {
  // Arrange
  const m = JSON.parse(readFileSync(new URL('./fixtures/dfd-paths-model.dfd.json', import.meta.url), 'utf8'));
  // Act
  const valid = validateDfd(m);
  const all = renderPathsHtml(m).stats;
  const none = threatPaths(m, { applied: [] });
  // Assert
  assert.deepEqual(valid.errors, []);
  assert.deepEqual([all.elements, all.flows, all.patches], [27, 48, 12]);
  assert.deepEqual([all.open, all.closed, all.unevaluated], [0, 18, 5]);
  assert.equal(none.paths.filter((p) => p.state === 'open').length, 13);
});

// ── the coverage layer: what the server side promises ───────────────────────────────────────────

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/dfd-coverage.dfd.json', import.meta.url), 'utf8'));
const count = (text, part) => text.split(part).length - 1;

test('the additions carry a legend row for every coverage mark, after the existing ten', () => {
  // Arrange
  const rows = ADDITIONS.split('<li>').slice(1);
  // Act
  const coverage = rows.slice(10).join('\n');
  // Assert
  assert.equal(rows.length, 16);
  assert.match(rows[9], /reject flow a patch adds/);
  assert.match(coverage, /class="cv-fill" /);
  assert.match(coverage, /class="cv-fill low"/);
  assert.match(coverage, /class="cv-none"/);
  assert.match(coverage, /class="fx ex"/);
  assert.match(coverage, /class="fx nx"/);
  assert.match(coverage, /class="ring"/);
  assert.match(coverage, /never drawn as 0%/);
});

test('the coverage controls are in the page hidden, once each, for the client to show', () => {
  // Arrange
  const m = doc();
  // Act
  const { html } = renderPathsHtml(m);
  // Assert
  assert.equal(count(html, '<div class="tiles" id="cov-tiles" hidden></div>'), 1);
  assert.equal(count(html, '<label class="cov-only" hidden><input type="checkbox" id="o-cov" data-opt="cov" checked>'), 1);
  assert.equal(count(html, '<label class="cov-only" hidden><input type="checkbox" id="o-gaps" data-opt="gaps" checked>'), 1);
  assert.equal(count(html, '<div id="gaps-sec" hidden>'), 1);
  assert.equal(count(html, '<tbody id="gaps"></tbody>'), 1);
  assert.match(html, /<th>Evidence<\/th><th>Proof<\/th>/);
});

test('the page says a covered line is not a tested guard, where the gaps are and beside the legend', () => {
  // Arrange
  const m = doc();
  // Act
  const { html } = renderPathsHtml(m);
  const gaps = html.slice(html.indexOf('<div id="gaps-sec"'), html.indexOf('<tbody id="gaps">'));
  const legend = html.slice(html.indexOf('<h2>Legend</h2>'));
  // Assert
  assert.match(gaps, /A covered line is not a tested guard/);
  assert.match(legend, /a covered line is not a tested guard/);
});

test('the coverage fixture renders with its paths counted, its data embedded whole and no inline style', () => {
  // Arrange
  const m = fixture();
  // Act
  const { html, stats } = renderPathsHtml(m);
  const data = JSON.parse(block(html, '<script type="application/json" id="dfd-data">'));
  // Assert
  assert.deepEqual(stats, { elements: 11, flows: 12, patches: 3, paths: 6, open: 1, unevaluated: 1, closed: 4, truncated: false });
  assert.deepEqual(data, m);
  assert.deepEqual(data.nodes.find((n) => n.id === 'P2').coverage.lines, { covered: 12, total: 30 });
  assert.equal(data.flows.find((f) => f.from === 'P1' && f.to === 'P3').coverage.exercised, false);
  assert.deepEqual(data.patches.map((p) => [p.evidence.level, !!(p.evidence.control && p.evidence.control.failsWithout && p.evidence.control.passesWith)]),
    [['tested', true], ['tested', false], ['asserted', false]]);
  assert.equal(html.includes(' style="'), false);
});

test('the fixture says it is a fixture, and holds every coverage state the view draws', () => {
  // Arrange
  const m = fixture();
  const ratio = (n) => n.coverage.lines.covered / n.coverage.lines.total;
  // Act
  const measured = m.nodes.filter((n) => n.coverage);
  const flows = m.flows.map((f) => (f.coverage ? f.coverage.exercised : null));
  // Assert
  assert.match(m.source.note, /^A FIXTURE, not real data/);
  assert.equal(measured.some((n) => ratio(n) >= 0.8), true);
  assert.equal(measured.some((n) => ratio(n) < 0.8), true);
  assert.equal(m.nodes.some((n) => n.kind === 'process' && !n.coverage), true);
  assert.deepEqual([flows.includes(true), flows.includes(false), flows.includes(null)], [true, true, true]);
});

test('with the coverage additions the policy still admits exactly the bytes the page carries', () => {
  // Arrange
  const m = fixture();
  // Act
  const { html, csp } = renderPathsHtml(m);
  const style = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
  // Assert
  assert.equal(csp.includes(`style-src 'sha256-${sha(style)}'`), true);
  assert.equal(csp.includes(`'sha256-${sha(clientJs())}'`), true);
  assert.equal(style.includes(pathsCss()), true);
  assert.match(pathsCss(), /\[hidden\]\{display:none !important\}/);
  assert.equal(count(html, '<script>'), 2);
});

test('every render option is a ticked box the script reads by data-opt, and the two coverage ones start hidden', () => {
  // Arrange
  const m = doc();
  // Act
  const { html } = renderPathsHtml(m);
  const opts = [...html.matchAll(/<input type="checkbox" id="o-([a-z]+)" data-opt="([a-z]+)" checked>/g)].map((x) => [x[1], x[2]]);
  // Assert
  assert.deepEqual(opts.map(([id]) => id), ['halos', 'pips', 'guards', 'chips', 'labels', 'cov', 'tiles', 'gaps']);
  assert.equal(opts.every(([id, opt]) => id === opt), true);
  assert.equal(count(html, 'class="cov-only" hidden'), 2);
  assert.equal(count(html, 'id="opts"'), 1);
});
