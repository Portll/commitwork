// The dfd page (lib/dfd-render.mjs). What is asserted is what a reader relies on without checking:
// no two elements overlap, every flow in the model is drawn exactly once, one model is one sequence
// of bytes, and the page admits nothing but its own style and the theme follower.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse } from '../dfd.mjs';
import { layout, renderSvg, renderHtml, pageCss, clip, wrap, roundedPath, collapseGroups, groupSizes, countCrossings, flowExistence, SWEEPS, AUTO_TB_WIDTH } from '../dfd-render.mjs';
import { FOLLOWER_JS } from '../theme-follower.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = () => JSON.parse(readFileSync(join(HERE, 'fixtures', 'dfd-synthetic.json'), 'utf8'));
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
// the LR-specific assertions below name their orientation; `auto` picks TB for the wide fixture
const lay = (m, opts = { orientation: 'LR' }) => layout(m, analyse(m), opts);
const node = (id, kind = 'process', extra = {}) => ({ id, kind, label: id, ...extra });
const flow = (from, to, extra = {}) => ({ from, to, mode: 'sync', ...extra });
const doc = (nodes, flows, extra = {}) => ({ v: 1, kind: 'dfd', ...extra, nodes, flows });

const overlaps = (boxes) => {
  const out = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(`${a.id} / ${b.id}`);
    }
  }
  return out;
};

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

test('clip keeps a short label and cuts a long one in the middle', () => {
  // arrange
  const long = 'monitor/extractors/sast-lint/_deno-check-counts.mjs';

  // act
  const short = clip('bin/a.mjs');
  const cut = clip(long, 21);

  // assert
  assert.equal(short, 'bin/a.mjs');
  assert.equal(cut, 'monitor/ex…counts.mjs');
  assert.equal(cut.length, 21);
});

test('roundedPath rounds each inner corner and never by more than half a segment', () => {
  // arrange
  const pts = [[0, 0], [10, 0], [10, 4], [30, 4]];

  // act
  const d = roundedPath(pts, 6);

  // assert
  assert.equal(d, 'M0,0 L8,0 Q10,0 10,2 L10,2 Q10,4 12,4 L30,4');
});

// ── layout ───────────────────────────────────────────────────────────────────────────────────────

test('no two elements of the fixture overlap and all sit inside the drawing', () => {
  // arrange
  const m = fixture();

  // act
  const g = lay(m);

  // assert
  assert.deepEqual(overlaps(g.nodes), []);
  assert.ok(g.nodes.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= g.width && b.y + b.h <= g.height));
});

test('every flow of the fixture is drawn exactly once', () => {
  // arrange
  const m = fixture();

  // act
  const g = lay(m);
  const drawn = g.edges.flatMap((e) => e.flows).sort((a, b) => a - b);

  // assert
  assert.deepEqual(drawn, m.flows.map((_, k) => k));
  assert.ok(g.edges.every((e) => /^M[-\d.]+,[-\d.]+ /.test(e.d) && !/NaN|undefined|Infinity/.test(e.d)));
});

test('the fixture draws one edge of each kind the notation has', () => {
  // arrange
  const m = fixture();

  // act
  const g = lay(m);
  const by = (cls) => g.edges.filter((e) => e.cls === cls);

  // assert
  // the analysis ranks the customer after the API (the API is fed by its config key), so the pair is drawn from the API
  assert.deepEqual(by('bi').map((e) => [e.from, e.to, e.heads, e.label]), [['api', 'customer', 'both', 'order request / order status']]);
  assert.deepEqual(by('self').map((e) => [e.from, e.heads, e.role]), [['ingest', 'end', 'retry']]);
  assert.deepEqual(by('fb').map((e) => [e.from, e.to, e.mode, e.existence, e.role]), [['validate', 'transform', 'sync', 'declared', 'error'], ['validate', 'bronze', 'async', 'unknown', 'retry']]);
  assert.deepEqual(by('fwd').filter((e) => e.mode === 'async').map((e) => [e.from, e.to]),
    [['api', 'events'], ['events', 'ingest'], ['nightly', 'aggregate'], ['api', 'audit'], ['audit', 'alerting']]);
  assert.equal(by('fwd').find((e) => e.to === 'payments').existence, 'unknown');
  assert.equal(by('fwd').find((e) => e.to === 'orders-db').existence, 'confirmed');
});

test('a feedback edge runs over the top: its track is above every element', () => {
  // arrange
  const m = fixture();

  // act
  const g = lay(m);
  const top = Math.min(...g.nodes.map((b) => b.y));
  const tracks = g.edges.filter((e) => e.cls === 'fb').map((e) => e.track);

  // assert
  assert.equal(tracks.length, 2);
  assert.ok(tracks.every((y) => y < top));
  assert.notEqual(tracks[0], tracks[1]);
});

test('ranks run left to right and maturity layers are bands in the declared order', () => {
  // arrange
  const m = fixture();

  // act
  const g = lay(m);
  const box = Object.fromEntries(g.nodes.map((b) => [b.id, b]));

  // assert
  assert.deepEqual(g.bands.map((b) => b.name), ['bronze', 'silver', 'gold']);
  assert.ok(g.bands[0].y < g.bands[1].y && g.bands[1].y < g.bands[2].y);
  assert.ok(box.ingest.x < box.bronze.x && box.bronze.x < box.transform.x && box.transform.x < box.validate.x);
  for (const b of g.nodes.filter((n) => n.lane)) {
    const band = g.bands.find((x) => x.name === b.lane);
    assert.ok(b.y >= band.y && b.y + b.h <= band.y + band.h, `${b.id} sits inside ${b.lane}`);
  }
});

test('element references follow kind and declaration order, with Q for a broker', () => {
  // arrange
  const m = fixture();

  // act
  const refs = Object.fromEntries(lay(m).nodes.map((b) => [b.id, b.ref]));

  // assert
  assert.equal(refs.customer, 'E1');
  assert.equal(refs.api, 'P1');
  assert.equal(refs['orders-db'], 'D1');
  assert.equal(refs.events, 'Q1');
  assert.equal(refs.analyst, 'E2');
});

test('a boundary is a hull when it encloses only its members', () => {
  // arrange
  const m = fixture();

  // act
  const g = lay(m);

  // assert
  assert.deepEqual(g.hulls.map((h) => [h.id, h.label, h.boundary]), [['internet', 'Internet', 'trust'], ['platform', 'Order platform', 'system']]);
  assert.ok(g.nodes.every((b) => b.caption === undefined));
});

test('a boundary that would enclose a stranger is named under each member instead', () => {
  // arrange: the two members of g sit in ranks 0 and 2, with an outsider between them
  const m = doc([node('a', 'process', { group: 'g' }), node('mid'), node('z', 'store', { group: 'g' })], [flow('a', 'mid'), flow('mid', 'z')]);

  // act
  const g = lay(m);

  // assert
  assert.deepEqual(g.hulls, []);
  assert.deepEqual(g.nodes.map((b) => b.caption), ['g', undefined, 'g']);
  assert.match(renderSvg(m, g), /<text class="cap"[^>]*>‹g›<\/text>/);
});

test('two boundaries whose hulls would collide keep the first and caption the second', () => {
  // arrange: h's only member sits between the two members of g in one column
  const m = doc(
    [node('src'), node('g1', 'store', { group: 'g' }), node('h1', 'store', { group: 'h' }), node('g2', 'store', { group: 'g' })],
    [flow('src', 'g1'), flow('src', 'h1'), flow('src', 'g2')],
  );

  // act
  const g = lay(m);

  // assert
  assert.deepEqual(overlaps(g.nodes), []);
  assert.equal(g.hulls.length + new Set(g.nodes.map((b) => b.caption).filter(Boolean)).size, 2);
});

test('a flow that skips a rank is routed through a point in the rank it crosses', () => {
  // arrange
  const m = doc([node('a'), node('b'), node('c')], [flow('a', 'b'), flow('b', 'c'), flow('a', 'c', { label: 'skip' })]);

  // act
  const g = lay(m);
  const skip = g.edges.find((e) => e.label === 'skip');
  const direct = g.edges.find((e) => e.from === 'a' && e.to === 'b');

  // assert
  assert.equal((skip.d.match(/C/g) || []).length, 2);
  assert.match(skip.d, / L/);
  assert.equal((direct.d.match(/C/g) || []).length, 1);
  assert.deepEqual(overlaps(g.nodes), []);
});

test('an undirected flow is drawn with no head and still places its ends in different ranks', () => {
  // arrange
  const m = doc([node('p'), node('s', 'store'), node('t', 'store')], [flow('p', 's', { directed: false }), flow('t', 'p', { directed: false })]);

  // act
  const g = lay(m);

  // assert
  assert.deepEqual(g.edges.map((e) => [e.cls, e.heads]), [['und', 'none'], ['und', 'none']]);
  assert.equal(new Set(g.nodes.map((b) => b.rank)).size > 1, true);
  assert.deepEqual(overlaps(g.nodes), []);
});

test('sync and async flows between one pair share an edge drawn as mixed', () => {
  // arrange
  const m = doc([node('a'), node('b')], [flow('a', 'b', { label: 'x' }), flow('a', 'b', { mode: 'event', label: 'y' })]);

  // act
  const g = lay(m);

  // assert
  assert.equal(g.edges.length, 1);
  assert.deepEqual([g.edges[0].mode, g.edges[0].label, g.edges[0].flows], ['mixed', 'x / y', [0, 1]]);
});

test('a contradicted flow outranks an unknown one on the same edge', () => {
  // arrange
  const ev = (existence) => ({ evidence: { existence } });
  const m = doc([node('a'), node('b'), node('c')], [flow('a', 'b', ev('unknown')), flow('a', 'b', ev('contradicted')), flow('b', 'c', ev('confirmed'))]);

  // act
  const g = lay(m);
  const svg = renderSvg(m, g);

  // assert
  assert.deepEqual(g.edges.map((e) => e.existence), ['contradicted', 'confirmed']);
  assert.match(svg, /class="e fwd sync bad"[^>]*>.*?marker-end="url\(#dfd-a-bad\)"/);
});

test('a model with every node layered has no unlayered lane, and one without layers has no band', () => {
  // arrange
  const layered = doc([node('a', 'process', { layer: 'raw' }), node('b', 'store', { layer: 'fine' })], [flow('a', 'b')]);
  const plain = doc([node('a'), node('b', 'store')], [flow('a', 'b')]);

  // act
  const g1 = lay(layered);
  const g2 = lay(plain);

  // assert
  assert.deepEqual(g1.bands.map((b) => b.name), ['raw', 'fine']);
  assert.deepEqual(g1.nodes.map((b) => b.lane), ['raw', 'fine']);
  assert.deepEqual(g2.bands, []);
  assert.ok(g2.width < g1.width, 'the band label column is reserved only when there are bands');
});

test('a single element with no flow still lays out', () => {
  // arrange
  const m = doc([node('only', 'external')], []);

  // act
  const g = lay(m);

  // assert
  assert.equal(g.nodes.length, 1);
  assert.deepEqual(g.edges, []);
  assert.ok(g.width > g.nodes[0].w && g.height > g.nodes[0].h);
});

test('the barycentre sweeps are a fixed number, and they untangle a crossed pair', () => {
  // arrange: declared so that a->y and b->x cross unless the second rank is reordered
  const m = doc([node('a'), node('b'), node('x', 'store'), node('y', 'store')], [flow('a', 'y'), flow('b', 'x')]);

  // act
  const g = lay(m);
  const box = Object.fromEntries(g.nodes.map((b) => [b.id, b]));

  // assert
  assert.equal(SWEEPS, 4);
  assert.ok(box.a.y < box.b.y);
  assert.ok(box.y.y < box.x.y, 'y follows a to the top');
});

// ── SVG and page ─────────────────────────────────────────────────────────────────────────────────

test('each element kind is drawn in its Gane–Sarson shape', () => {
  // arrange
  const m = fixture();

  // act
  const svg = renderSvg(m, lay(m));

  // assert
  assert.match(svg, /<g class="n proc" data-id="api"><title>P1 process: Order API — boundary platform<\/title><rect [^>]*rx="9"\/><line /);
  assert.match(svg, /<g class="n store" data-id="events"><title>Q1 store \(topic\): order-events — boundary platform — Kafka topic<\/title><path d="M[\d.]+,[\d.]+ H[\d.]+ V[\d.]+ H[\d.]+"\/>/);
  assert.match(svg, /<g class="n ext" data-id="customer"><title>E1 external \(actor\): Customer — boundary internet<\/title><rect class="sh" /);
  assert.match(svg, /<g class="n proc" data-id="ingest"><title>P2 process: Ingest — layer bronze<\/title>/);
  assert.match(svg, /role="img" aria-labelledby="dfd-title dfd-desc"/);
});

test('an element marked unknown is drawn as an absence', () => {
  // arrange
  const m = doc([node('a', 'process', { unknown: true, note: 'not analysed' }), node('b', 'store')], [flow('a', 'b')]);

  // act
  const svg = renderSvg(m, lay(m));

  // assert
  assert.match(svg, /<g class="n proc unk" data-id="a"><title>P1 process: a — not analysed<\/title>/);
});

test('edge markup carries its flows, its class and the right heads', () => {
  // arrange
  const m = fixture();

  // act
  const svg = renderSvg(m, lay(m));

  // assert
  assert.match(svg, /<g class="e bi sync" data-flows="0,1" data-from="api" data-to="customer">.*?marker-start="url\(#dfd-a-ink\)" marker-end="url\(#dfd-a-ink\)"/);
  assert.match(svg, /<g class="e fb sync r-error" data-flows="10" data-from="validate" data-to="transform"><title>feedback flow: validate → transform \(sync, existence declared, role error\) — validation errors<\/title>.*?marker-end="url\(#dfd-a-hi\)"/);
  assert.match(svg, /<g class="e fwd sync ok" data-flows="2" data-from="api" data-to="orders-db">/);
  assert.match(svg, /<g class="e fb async unk r-retry" data-flows="11"[^>]*>.*?marker-end="url\(#dfd-a-fb\)"/);
  assert.match(svg, /<g class="e self sync r-retry" data-flows="5" data-from="ingest" data-to="ingest"><title>retry loop:/);
  assert.match(svg, /<g class="e fwd async" data-flows="3" data-from="api" data-to="events">/);
});

test('an undirected, unknown flow is dotted, grey and headless', () => {
  // arrange
  const m = doc([node('p'), node('s', 'store')], [flow('p', 's', { directed: false, evidence: { witness: 'static', existence: 'unknown' } })]);

  // act
  const svg = renderSvg(m, lay(m));
  const edge = /<g class="e und sync unk".*?<\/g>/.exec(svg)[0];

  // assert
  assert.match(edge, /direction not determined/);
  assert.doesNotMatch(edge, /marker-/);
});

test('one model renders to the same bytes every time', () => {
  // arrange
  const a = fixture();
  const b = fixture();

  // act
  const first = renderHtml(a);
  const second = renderHtml(b);

  // assert
  assert.equal(first.html, second.html);
  assert.equal(first.csp, second.csp);
  assert.equal(sha(first.html), sha(renderHtml(fixture()).html));
});

test('the page makes no request and carries no style attribute', () => {
  // arrange: an endpoint's label is a URL by contract, so the URL is text on the page; it must never
  // be something the page fetches
  const m = fixture();
  const endpoint = m.nodes.find((nd) => nd.subtype === 'endpoint').label;

  // act
  const { html } = renderHtml(m);
  const urls = [...html.matchAll(/url\(([^)]*)\)/g)].map((x) => x[1]);
  const links = [...html.matchAll(/(?:href|src|xlink:href|action|data|poster|srcset)="([^"]*)"/g)].map((x) => x[1]);
  const inAttributes = [...html.matchAll(/\s[\w:-]+="([^"]*https?:\/\/[^"]*)"/g)].map((x) => x[1]);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

  // assert
  assert.match(endpoint, /^https:\/\//);
  assert.ok(html.includes(endpoint), 'the endpoint is named on the page');
  assert.ok(urls.length > 0 && urls.every((u) => u.startsWith('#dfd-a-')), urls.join(' '));
  assert.ok(links.every((u) => u.startsWith('data:')), links.join(' '));
  assert.deepEqual(inAttributes, ['http://www.w3.org/2000/svg'], 'a URL in an attribute is only the SVG namespace, which is not fetched');
  assert.doesNotMatch(html, /@import|<link(?![^>]*rel="icon"[^>]*href="data:)|<iframe|<img|<object|<embed/);
  assert.doesNotMatch(script, /fetch\(|XMLHttpRequest|EventSource|WebSocket|sendBeacon|import\(/);
  assert.doesNotMatch(html, /\sstyle="/);
  assert.equal((html.match(/<script/g) || []).length, 1);
});

test('the policy admits exactly the inlined style and the theme follower', () => {
  // arrange
  const m = fixture();

  // act
  const { html, csp } = renderHtml(m);
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)[1];

  // assert
  assert.equal(style, pageCss('none'));
  assert.equal(script, FOLLOWER_JS);
  assert.equal(csp, `default-src 'none'; style-src 'sha256-${sha(style)}'; script-src 'sha256-${sha(script)}'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`);
  assert.equal(`${meta}; frame-ancestors 'self'`, csp);
});

test('served fonts point at the panel and inline fonts travel in the page', () => {
  // arrange
  const m = doc([node('a')], []);

  // act
  const served = renderHtml(m, { fonts: 'served' });
  const inline = renderHtml(m, { fonts: 'inline' });

  // assert
  assert.match(served.csp, /font-src 'self'/);
  assert.match(served.html, /url\("\/static\/fonts\//);
  assert.match(inline.csp, /font-src data:/);
  assert.match(inline.html, /url\("data:font\/woff2;base64,/);
});

test('labels, titles and evidence are escaped wherever they land', () => {
  // arrange
  const m = doc(
    [node('a', 'process', { label: '<img src=x onerror=1>', group: '"g"', note: '<b>n</b>' }), node('b', 'store', { label: 'b&b' })],
    [flow('a', 'b', { label: '</text><script>x</script>', evidence: { existence: 'confirmed', witness: 'static', refs: ['<r>', 'two'] } })],
    { title: 'T <i>' },
  );

  // act
  const { html } = renderHtml(m);

  // assert
  assert.doesNotMatch(html, /<img|<i>|<b>n|<r>|<script>x/);
  assert.match(html, /<title>T &lt;i&gt; — data flow diagram<\/title>/);
  assert.match(html, /confirmed · static — &lt;r&gt; \(\+1\)/);
});

test('the tables repeat every element and every flow of the diagram', () => {
  // arrange
  const m = fixture();

  // act
  const { html } = renderHtml(m);
  const rows = (html.match(/<tr><td/g) || []).length;

  // assert
  assert.equal(rows, m.nodes.length + m.flows.length);
  assert.match(html, /<td class="m">Q1<\/td><td>store · topic<\/td><td class="m">order-events<\/td><td>platform<\/td><td><span class="absent">none<\/span><\/td><td class="tnum">2<\/td>/);
  assert.match(html, /<td class="tnum">11<\/td><td class="m">P5 Validate quality<\/td><td>→<\/td><td class="m">P3 Clean and conform<\/td><td>sync<\/td><td>feedback · error<\/td><td>validation errors<\/td><td><span class="absent">declared, no evidence<\/span><\/td>/);
  assert.match(html, /<td>async<\/td><td>feedback · retry<\/td><td>replay request<\/td><td><span class="absent">existence unknown<\/span> · authored<\/td>/);
  assert.match(html, /<td>retry loop · retry<\/td><td>retry on timeout<\/td>/);
  assert.match(html, /<td class="m">https:\/\/payments\.example:443<\/td>/, 'the endpoint is tabulated whole');
  assert.match(html, /branch ×5/);
  assert.match(html, /merge ×2, in a cycle/);
});

test('the findings name each topology in words', () => {
  // arrange
  const m = fixture();

  // act
  const { html } = renderHtml(m);
  const fact = (k) => new RegExp(`<dt>${k}</dt><dd>([^\\n]*)</dd>`).exec(html)[1];

  // assert
  assert.equal(fact('Bidirectional pairs'), 'E1 Customer ⇄ P1 Order API');
  assert.equal(fact('Feedback flows'), 'P5 Validate quality → P3 Clean and conform; P5 Validate quality → D2 Raw orders');
  assert.equal(fact('Retry loops'), 'P2 Ingest');
  assert.equal(fact('Cycles'), '{E1, P1} two-way only; {D2, P3, P4, P5}');
  assert.equal(fact('Through a broker'), 'P1 → Q1 → P2; P1 → Q2 → P9');
  assert.match(fact('Source-to-sink paths'), /^8; 8 of those listed are multi-hop; longest listed: E5 → P1 → Q1 → P2 → D2 → P3 → P4 → P5 → D4 → P6 → D5 → P8 → E2$/);
  assert.equal(fact('Direction not determined'), '<span class="absent">none</span>');
});

test('an empty finding is written as an absence, and an uncountable one says so', () => {
  // arrange
  const specs = [];
  for (let i = 0; i < 60; i++) specs.push([`p${i}`, `s${i}a`], [`p${i}`, `s${i}b`], [`s${i}a`, `p${i + 1}`], [`s${i}b`, `p${i + 1}`]);
  const ids = [...new Set(specs.flat())];
  const big = doc(ids.map((id) => node(id, id[0] === 'p' ? 'process' : 'store', id === 's0a' ? { unknown: true } : {})), [...specs.map(([a, b]) => flow(a, b)), flow('p1', 'p0'), flow('p0', 's0a', { directed: false })]);

  // act
  const { html } = renderHtml(big, { maxPaths: 5 });
  const fact = (k) => new RegExp(`<dt>${k.replace(/[()]/g, '\\$&')}</dt><dd>([^\\n]*)</dd>`).exec(html)[1];

  // assert
  assert.equal(fact('Retry loops'), '<span class="absent">none</span>');
  assert.match(fact('Source-to-sink paths'), /^<span class="absent">more than can be counted exactly<\/span>, first 5 listed; 5 of those listed are multi-hop/);
  assert.match(fact('Cycles'), /uncertain: passes through an element marked unknown/);
  assert.equal(fact('Direction not determined'), '1 flow(s), outside every figure above');
  assert.match(html, /<td>—<\/td>/);
  assert.match(html, /<td>(?:[^<]*, )?unknown<\/td>/);
});

test('the banner says who produced the model, what the adapter left out and what the filter cut', () => {
  // arrange
  const bare = doc([node('a')], []);
  const noted = doc([node('a')], [], { source: { producer: 'authored', note: 'by hand' } });
  const adapted = doc([node('a')], [], { source: {
    producer: 'flow-graph', graph: { nodes: 9, edges: 4, generatedAt: '2026-11-11T00:00:00.000Z' }, omitted: { testModules: 3 },
    filter: { prefix: 'flow/', focus: null, hops: 1, seeds: 2, nodesKept: 1, nodesOmitted: 8, flowsOmitted: 4 },
  } });
  const focused = doc([node('a')], [], { source: { producer: 'flow-graph', graph: { nodes: 9, edges: 4, generatedAt: null },
    filter: { prefix: null, focus: 'a', hops: 2, seeds: 1, nodesKept: 1, nodesOmitted: 0, flowsOmitted: 0 } } });
  const banner = (m) => /<p class="banner">(.*?)<\/p>/.exec(renderHtml(m).html)[1];

  // act
  const texts = [bare, noted, adapted, focused].map(banner);

  // assert
  assert.match(texts[0], /^Authored model\. No producer is recorded/);
  assert.equal(texts[1], 'Producer: <code>authored</code>. by hand');
  assert.equal(texts[2], 'Producer: <code>flow-graph</code>. Flow graph of 9 nodes and 4 edges, generated 2026-11-11T00:00:00.000Z. Left out by the adapter: testModules 3. '
    + '<strong>This is a subset.</strong> Filter: prefix <code>flow/</code>, 1 hop(s) from 2 seed node(s); 8 nodes and 4 flows are not shown.');
  assert.match(texts[3], /Flow graph of 9 nodes and 4 edges\. <strong>This is a subset\.<\/strong> Filter: focus <code>a<\/code>, 2 hop\(s\)/);
});

// ── wrapping, orientation, crossings and label placement ─────────────────────────────────────────

test('wrap keeps a short label, breaks at a space or after a separator, and clips only the last line', () => {
  // arrange
  const path = 'monitor/extractors/sast-lint/_deno-check-counts.mjs';

  // act
  const short = wrap('order row', 26);
  const spaced = wrap('validation errors from the quality gate', 26);
  const sliced = wrap(path, 31);
  const solid = wrap('x'.repeat(40), 10);
  const three = wrap('aa bb cc dd ee ff gg hh', 5, 3);

  // assert
  assert.deepEqual(short, ['order row']);
  assert.deepEqual(spaced, ['validation errors from the', 'quality gate']);
  assert.deepEqual(sliced, ['monitor/extractors/sast-lint/', '_deno-check-counts.mjs']);
  assert.deepEqual(solid, ['x'.repeat(10), 'xxxxx…xxxx']);
  assert.equal(three.length, 3);
  assert.ok(three.every((l) => l.length <= 5));
});

test('a long element label is drawn on two lines and kept whole in the tooltip and the table', () => {
  // arrange
  const label = 'monitor/extractors/sast-lint/_deno-check-counts-and-more.mjs';
  const m = doc([node('a', 'process', { label }), node('b', 'store', { label: `${label} store` }), node('c', 'external', { label: `${label} ext` })],
    [flow('a', 'b'), flow('c', 'a')]);

  // act
  const { html } = renderHtml(m);

  // assert
  assert.match(html, /<tspan x="[\d.]+">monitor\/extractors\/sast-lint\/<\/tspan><tspan x="[\d.]+" dy="11.5">_deno-check-counts-and-more\.mjs<\/tspan>/);
  assert.match(html, new RegExp(`<title>P1 process: ${label.replace(/[.]/g, '\\.')}</title>`));
  assert.match(html, new RegExp(`<td class="m">${label.replace(/[.]/g, '\\.')} ext</td>`));
});

test('auto orientation keeps a narrow model left to right and turns the wide fixture top to bottom', () => {
  // arrange
  const narrow = doc([node('a'), node('b', 'store')], [flow('a', 'b')]);
  const m = fixture();

  // act
  const small = lay(narrow, {});
  const lr = lay(m, { orientation: 'LR' });
  const tb = lay(m, { orientation: 'TB' });
  const auto = lay(m, {});

  // assert
  assert.equal(small.orientation, 'LR');
  assert.ok(lr.width > AUTO_TB_WIDTH);
  assert.equal(auto.orientation, 'TB');
  assert.deepEqual(auto, tb);
  assert.ok(auto.width < 1600, `the sample is ${auto.width} wide`);
});

test('auto keeps LR when TB would be no narrower', () => {
  // arrange: one rank of many wide elements is narrow LR but wide TB; a chain makes LR exceed the threshold
  const nodes = [];
  const flows = [];
  for (let i = 0; i < 40; i++) nodes.push(node(`n${i}`, 'process', { label: `${'w'.repeat(30)}${i}` }));
  for (let i = 1; i < 40; i++) flows.push(flow('n0', `n${i}`));
  for (let i = 0; i < 12; i++) { nodes.push(node(`c${i}`)); flows.push(flow(i ? `c${i - 1}` : 'n1', `c${i}`)); }
  const m = doc(nodes, flows);

  // act
  const lr = lay(m);
  const tb = lay(m, { orientation: 'TB' });
  const auto = lay(m, {});

  // assert
  assert.ok(lr.width > AUTO_TB_WIDTH && tb.width >= lr.width, `${lr.width} / ${tb.width}`);
  assert.equal(auto.orientation, 'LR');
});

test('an orientation outside LR, TB and auto is refused', () => {
  // arrange
  const m = doc([node('a')], []);

  // act
  const run = () => lay(m, { orientation: 'RL' });

  // assert
  assert.throws(run, /orientation is one of LR, TB, auto, got RL/);
});

test('top to bottom: ranks run downward, layers are bands over the ranks they hold, feedback runs down the left', () => {
  // arrange
  const m = fixture();

  // act
  const g = lay(m, { orientation: 'TB' });
  const box = Object.fromEntries(g.nodes.map((b) => [b.id, b]));
  const left = Math.min(...g.nodes.map((b) => b.x));

  // assert
  assert.deepEqual(overlaps(g.nodes), []);
  assert.ok(g.nodes.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= g.width && b.y + b.h <= g.height));
  assert.ok(box.ingest.y < box.bronze.y && box.bronze.y < box.transform.y && box.transform.y < box.validate.y);
  assert.deepEqual(g.bands.map((b) => b.name), ['bronze', 'silver', 'gold']);
  assert.ok(g.bands[0].y + g.bands[0].h < g.bands[1].y && g.bands[1].y + g.bands[1].h < g.bands[2].y, 'bands follow the declared order down the ranks');
  assert.deepEqual(overlaps(g.bands.map((b) => ({ id: b.name, ...b }))), []);
  assert.equal(new Set(g.bands.map((b) => b.x)).size, 1, 'layers holding no rank in common share the cross axis');
  for (const b of g.nodes.filter((nd) => nd.lane)) {
    const band = g.bands.find((x) => x.name === b.lane);
    assert.ok(b.x >= band.x && b.x + b.w <= band.x + band.w && b.y >= band.y && b.y + b.h <= band.y + band.h, `${b.id} sits inside ${b.lane}`);
  }
  assert.deepEqual(overlaps(g.nodes.filter((nd) => !nd.lane).map((nd) => ({ ...nd })).concat(g.bands.map((b) => ({ id: b.name, ...b })))).filter((x) => /\/ (bronze|silver|gold)$/.test(x) && !/^(bronze|silver|gold) /.test(x)), [],
    'no unlayered element sits inside a band');
  assert.ok(g.edges.filter((e) => e.cls === 'fb').every((e) => e.track < left));
  assert.ok(renderSvg(m, g).includes(`<text x="${g.bands[0].x + 8}" y="${g.bands[0].y + 12}">bronze</text>`), 'a band is named at its top left');
});

test('edge labels on the fixture sit clear of every element and of each other, in both orientations', () => {
  // arrange
  const m = fixture();

  // act
  const gs = [lay(m, { orientation: 'LR' }), lay(m, { orientation: 'TB' })];

  // assert
  for (const g of gs) {
    assert.equal(g.collisions, 0, g.orientation);
    const labels = g.edges.filter((e) => e.lbox).map((e) => ({ id: e.label, ...e.lbox }));
    assert.equal(labels.length, g.edges.filter((e) => e.label).length);
    assert.deepEqual(overlaps(labels), [], g.orientation);
    assert.deepEqual(labels.flatMap((l) => g.nodes.filter((b) => overlaps([l, b]).length).map((b) => `${l.id} on ${b.id}`)), [], g.orientation);
    assert.ok(labels.every((l) => l.x >= 0 && l.y >= 0 && l.x + l.w <= g.width && l.y + l.h <= g.height));
  }
});

test('a label with no clear spot is counted as a collision, and one blocked at first is nudged clear', () => {
  // arrange: twelve labelled flows squeezed between two one-element ranks
  const many = doc([node('a'), node('b', 'store')], Array.from({ length: 12 }, (_, i) => flow(i % 2 ? 'a' : 'b', i % 2 ? 'b' : 'a', { label: `flow number ${i} with a long label` })));
  const pair = doc([node('a'), node('b'), node('c'), node('d')], [flow('a', 'c', { label: 'first label here' }), flow('b', 'd', { label: 'second label here' }), flow('a', 'd', { label: 'third label here' })]);

  // act
  const crowded = lay(many);
  const g = lay(pair);

  // assert
  assert.equal(crowded.edges.length, 1);
  assert.equal(crowded.collisions, 0, 'one bundle, one label');
  assert.equal(g.collisions, 0);
  assert.deepEqual(overlaps(g.edges.map((e) => ({ id: e.label, ...e.lbox }))), []);
});

test('a retry label that the boundary name blocks is counted as a collision, not moved into a gutter', () => {
  // arrange: the hull's name sits exactly where the label above the box would stand
  const m = doc([node('a', 'process', { group: 'g' })], [flow('a', 'a', { label: 'retry the upstream call on timeout' })],
    { groups: [{ id: 'g', label: 'a long boundary name', boundary: 'system' }] });

  // act
  const g = lay(m);
  const box = g.nodes[0];

  // assert
  assert.equal(g.collisions, 1);
  assert.ok(g.edges[0].lbox.x >= box.x && g.edges[0].lbox.x + g.edges[0].lbox.w <= box.x + box.w);
});

test('crossings: the fixture keeps no more than the sweeps alone leave, and transposition clears a dense two-rank case', () => {
  // arrange
  const m = fixture();
  const spec = 'a1>b4 a2>b1 a3>b3 a1>b3 a4>b0 a4>b4 a0>b2 a3>b1 a4>b2';
  const dense = doc([...[0, 1, 2, 3, 4].map((i) => node(`a${i}`)), ...[0, 1, 2, 3, 4].map((i) => node(`b${i}`, 'store'))],
    spec.split(' ').map((p) => flow(...p.split('>'))));

  // act
  const before = lay(m, { orientation: 'LR', transpose: false }).crossings;
  const after = lay(m, { orientation: 'LR' }).crossings;
  const d0 = lay(dense, { orientation: 'LR', transpose: false }).crossings;
  const d1 = lay(dense, { orientation: 'LR' }).crossings;

  // assert
  assert.ok(after <= before, `${after} > ${before}`);
  assert.equal(after, 0);
  assert.equal(d0, 4);
  assert.equal(d1, 1);
});

test('countCrossings counts each crossing pair of segments between consecutive ranks once', () => {
  // arrange: a->y and b->x cross; a->x shares an end with both
  const a = { pos: 0, down: [] }; const b = { pos: 1, down: [] }; const x = { pos: 0, down: [] }; const y = { pos: 1, down: [] };
  a.down.push(y, x); b.down.push(x);

  // act
  const c = countCrossings([[a, b], [x, y]]);

  // assert
  assert.equal(c, 1);
});

test('group members stay contiguous within every rank after transposition', () => {
  // arrange: two groups interleaved by declaration, fed from crossing sources
  const m = doc(
    [node('s1'), node('s2'), node('s3'), node('g1', 'store', { group: 'g' }), node('h1', 'store', { group: 'h' }), node('g2', 'store', { group: 'g' }), node('h2', 'store', { group: 'h' })],
    [flow('s1', 'h1'), flow('s1', 'g2'), flow('s2', 'g1'), flow('s3', 'h2'), flow('s2', 'h2'), flow('s3', 'g1')],
  );

  // act
  const g = lay(m);
  const groupOf = new Map(m.nodes.map((nd, i) => [i, nd.group]));

  // assert
  for (const rank of g.ranks) {
    const seq = rank.filter((i) => i >= 0).map((i) => groupOf.get(i)).filter(Boolean);
    const runs = seq.filter((x, i) => i === 0 || seq[i - 1] !== x);
    assert.equal(runs.length, new Set(runs).size, `a group is split in ${seq.join(',')}`);
  }
});

test('feedback risers never pass through a retry loop label, in either orientation', () => {
  // arrange: the feedback source and target both carry a self-loop with a label
  const m = doc([node('a'), node('b'), node('c')], [
    flow('a', 'b'), flow('b', 'c'), flow('c', 'a', { label: 'send back for repair' }),
    flow('a', 'a', { label: 'retry the upstream call' }), flow('c', 'c', { label: 'retry the downstream write' }),
  ]);

  // act
  const gs = [lay(m, { orientation: 'LR' }), lay(m, { orientation: 'TB' })];

  // assert
  for (const g of gs) {
    const selfLabels = g.edges.filter((e) => e.cls === 'self').map((e) => e.lbox);
    const risers = g.edges.filter((e) => e.cls === 'fb').flatMap((e) => e.risers);
    assert.equal(selfLabels.length, 2);
    assert.equal(risers.length, 2);
    for (const [[x1, y1], [x2, y2]] of risers) {
      const seg = { id: 'riser', x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) || 0.1, h: Math.abs(y2 - y1) || 0.1 };
      assert.deepEqual(selfLabels.filter((l) => overlaps([seg, { id: 'l', ...l }]).length), [], `${g.orientation}: a riser crosses a self-loop label`);
    }
    for (const e of g.edges.filter((x) => x.cls === 'self')) {
      const own = g.nodes.find((b) => b.id === e.from);
      assert.ok(e.lbox.x >= own.x && e.lbox.x + e.lbox.w <= own.x + own.w && e.lbox.y + e.lbox.h <= own.y, `${g.orientation}: the label stands above its own box`);
    }
  }
});

// ── subtypes, roles, existence ───────────────────────────────────────────────────────────────────

test('every recognised subtype carries its mark, and an unrecognised one carries none', () => {
  // arrange
  const stores = ['database', 'broker', 'queue', 'topic', 'stream', 'log', 'file', 'lake'];
  const exts = ['endpoint', 'scheduler', 'actor', 'system', 'env', 'binary', 'user'];
  const m = doc([node('p'), ...stores.map((s) => node(`s-${s}`, 'store', { subtype: s })), ...exts.map((s) => node(`e-${s}`, 'external', { subtype: s }))],
    [...stores.map((s) => flow('p', `s-${s}`)), ...exts.map((s) => flow(`e-${s}`, 'p'))]);

  // act
  const svg = renderSvg(m, lay(m));
  const marked = (id) => new RegExp(`data-id="${id}"><title>[^<]*</title>(?:(?!</g>).)*<path class="gl" transform="translate\\(`).test(svg);

  // assert
  for (const s of [...stores.filter((x) => x !== 'lake').map((x) => `s-${x}`), ...exts.filter((x) => x !== 'user').map((x) => `e-${x}`)]) assert.ok(marked(s), s);
  assert.equal(marked('s-lake'), false);
  assert.equal(marked('e-user'), false);
  assert.match(svg, /M0,3 a6,2\.5 0 0,0 12,0/, 'the database mark is a cylinder');
});

test('the legend names every subtype mark, every role and every existence state', () => {
  // arrange
  const m = doc([node('a')], []);

  // act
  const { html } = renderHtml(m);
  const legend = /<ul class="legend">([\s\S]*?)<\/ul>/.exec(html)[1];

  // assert
  for (const w of ['database', 'broker, queue, topic or stream', 'log', 'file', 'endpoint', 'scheduler', 'actor', 'system', 'environment', 'binary',
    'error flow', 'retry flow', 'existence confirmed', 'declared, no evidence', 'existence unknown', 'contradicted', 'collapsed boundary']) {
    assert.ok(legend.includes(`</svg> ${w}`), w);
  }
});

test('an error flow and a retry flow are drawn as return paths with their own line, head and label mark', () => {
  // arrange: every role but data is a declared return path, so each runs on a feedback track
  const m = doc([node('a'), node('b'), node('c')], [
    flow('a', 'b', { label: 'request' }), flow('b', 'c'), flow('c', 'a', { role: 'error', label: 'rejected' }),
    flow('c', 'b', { role: 'retry', label: 'again' }), flow('b', 'a', { role: 'feedback' }),
  ]);

  // act
  const g = lay(m);
  const svg = renderSvg(m, g);
  const { html } = renderHtml(m);

  // assert
  assert.match(svg, /<g class="e fb sync r-error" data-flows="2"[^>]*><title>feedback flow: c → a \(sync, existence declared, role error\) — rejected<\/title><path [^>]*marker-end="url\(#dfd-a-hi\)"\/><text class="el"[^>]*>✕ rejected<\/text>/);
  assert.match(svg, /<g class="e fb sync r-retry" data-flows="3"[^>]*>.*?↻ again<\/text>/);
  assert.match(svg, /<g class="e fb sync r-feedback" data-flows="4"/);
  assert.match(html, /<td>feedback · error<\/td><td>rejected<\/td>/);
  assert.match(pageCss(), /\.dfd \.e\.r-error path\{stroke:var\(--high\);stroke-dasharray:5 2 1 2\}/);
  assert.match(pageCss(), /\.dfd \.e\.r-retry path\{stroke-dasharray:2 3/);
});

test('a forward flow and the error returning along the same pair are two edges, not one arc', () => {
  // arrange
  const m = doc([node('a'), node('b')], [flow('a', 'b', { label: 'request' }), flow('b', 'a', { role: 'error', label: 'fault' })]);

  // act
  const g = lay(m);

  // assert
  assert.deepEqual(g.edges.map((e) => [e.cls, e.from, e.to, e.flows, e.heads]), [['fwd', 'a', 'b', [0], 'end'], ['fb', 'b', 'a', [1], 'end']]);
  assert.deepEqual(g.edges.flatMap((e) => e.flows).sort(), [0, 1]);
});


test('flow existence comes from the flow, then its evidence; confirmed and unknown are drawn apart', () => {
  // arrange
  const m = doc([node('a'), node('b'), node('c'), node('d')], [
    flow('a', 'b', { existence: 'confirmed' }), flow('b', 'c', { existence: 'unknown', evidence: { existence: 'confirmed' } }), flow('c', 'd', { direction: 'outbound' }),
  ]);

  // act
  const svg = renderSvg(m, lay(m));
  const { html } = renderHtml(m);

  // assert
  assert.equal(flowExistence(m.flows[1]), 'unknown');
  assert.equal(flowExistence(m.flows[2]), 'declared');
  assert.match(svg, /class="e fwd sync ok" data-flows="0"/);
  assert.match(svg, /class="e fwd sync unk" data-flows="1"[^>]*>.*?marker-end="url\(#dfd-a-mut\)"/);
  assert.match(svg, /<title>flow: c → d \(sync, existence declared, direction outbound\)<\/title>/);
  assert.match(html, /<td>confirmed<\/td><\/tr>/);
  assert.match(pageCss(), /\.dfd \.e\.unk\{opacity:\.55\}/);
});

// ── collapse ─────────────────────────────────────────────────────────────────────────────────────

const collapsible = () => doc(
  [node('in'), node('a', 'process', { group: 'g', layer: 'raw' }), node('b', 'store', { group: 'g', layer: 'raw' }), node('c', 'process', { group: 'g', layer: 'raw' }),
    node('out', 'external'), node('h1', 'store', { group: 'h' }), node('h2', 'process', { group: 'h', layer: 'raw' })],
  [
    flow('in', 'a', { label: 'req', evidence: { existence: 'confirmed', refs: ['x.mjs:1'] } }),
    flow('in', 'c', { label: 'req2', evidence: { existence: 'unknown', refs: ['y.mjs:2'] } }),
    flow('a', 'b'), flow('b', 'c'), flow('c', 'c', { label: 'retry' }),
    flow('c', 'out', { label: 'result' }), flow('a', 'out', { mode: 'async', label: 'event' }),
    flow('c', 'out', { role: 'error', label: 'fault' }), flow('a', 'h1', { directed: false }), flow('h2', 'b'),
    flow('in', 'out'),
  ],
  { layers: ['raw'], groups: [{ id: 'g', label: 'Core', boundary: 'system' }] },
);

test('collapsing a group merges its crossing flows per other end, direction, mode and role, and drops its inside', () => {
  // arrange
  const m = collapsible();

  // act
  const c = collapseGroups(m, ['g']);
  const core = c.nodes.find((nd) => nd.id === 'group:g');

  // assert
  assert.deepEqual(c.nodes.map((nd) => nd.id), ['in', 'group:g', 'out', 'h1', 'h2']);
  assert.deepEqual(core, { id: 'group:g', kind: 'process', label: 'Core (3 elements)', layer: 'raw', collapsed: { group: 'g', members: 3 } });
  assert.deepEqual(c.flows.map((f) => [f.from, f.to, f.mode, f.role || 'data', f.label, f.merged]), [
    ['in', 'group:g', 'sync', 'data', 'req / req2 ×2', 2],
    ['group:g', 'out', 'sync', 'data', 'result', 1],
    ['group:g', 'out', 'async', 'data', 'event', 1],
    ['group:g', 'out', 'sync', 'error', 'fault', 1],
    ['group:g', 'h1', 'sync', 'data', undefined, 1],
    ['h2', 'group:g', 'sync', 'data', undefined, 1],
    ['in', 'out', 'sync', 'data', undefined, undefined],
  ]);
  assert.deepEqual(c.flows[0].evidence, { existence: 'unknown', refs: ['x.mjs:1', 'y.mjs:2'] });
  assert.equal(c.flows[1].evidence, undefined);
  assert.equal(c.flows[4].directed, false);
  assert.deepEqual(c.collapsedGroups, [{ group: 'g', id: 'group:g', label: 'Core', members: 3, internal: 3, merged: 7, layer: 'raw' }]);
});

test('two collapsed groups meet as two nodes, an id already taken is not reused, and no names is the model itself', () => {
  // arrange
  const m = collapsible();
  m.nodes.push(node('group:h'));
  m.flows.push(flow('h1', 'group:h'));

  // act
  const c = collapseGroups(m, ['g', 'h', 'g']);
  const same = collapseGroups(m, []);

  // assert
  assert.equal(same, m);
  const hid = c.nodes.find((nd) => nd.collapsed && nd.collapsed.group === 'h');
  assert.equal(hid.id, 'group:h~');
  assert.equal(hid.layer, undefined, 'members on mixed layers leave the node unlayered');
  assert.equal(hid.label, 'h (2 elements)');
  assert.ok(c.flows.some((f) => f.from === 'group:g' && f.to === 'group:h~' && f.directed === false));
  assert.ok(c.flows.some((f) => f.from === 'group:h~' && f.to === 'group:g'));
});

test('collapsing a group with no member is refused by name', () => {
  // arrange
  const m = collapsible();

  // act
  const run = () => collapseGroups(m, ['g', 'nope']);

  // assert
  assert.throws(run, /no element is in group "nope"/);
});

test('groupSizes counts members per group in first-member order', () => {
  // arrange
  const m = collapsible();

  // act
  const sizes = groupSizes(m);

  // assert
  assert.deepEqual([...sizes], [['g', 3], ['h', 2]]);
});

test('renderHtml collapses the named groups, draws the node as a double box and says so in the banner', () => {
  // arrange
  const m = collapsible();

  // act
  const { html, stats } = renderHtml(m, { collapse: ['g'] });

  // assert
  assert.match(html, /<g class="n proc coll" data-id="group:g"><title>P\d process: Core \(3 elements\)[^<]*<\/title><rect [^>]*\/><rect class="in" /);
  assert.match(html, /<strong>Collapsed:<\/strong> Core \(3 elements; 3 flow\(s\) inside it not drawn\)/);
  assert.match(html, /collapsed group of 3/);
  assert.equal(stats.elements, 5);
  assert.equal(stats.flows, 7);
});

test('renderHtml reports the drawing it made and stays byte-identical in every orientation and with a collapse', () => {
  // arrange
  const opts = [{ orientation: 'LR' }, { orientation: 'TB' }, { collapse: ['platform'] }];

  // act
  const runs = opts.map((o) => [renderHtml(fixture(), o), renderHtml(fixture(), o)]);

  // assert
  for (const [a, b] of runs) assert.equal(sha(a.html), sha(b.html));
  assert.deepEqual(runs[1][0].stats, { orientation: 'TB', width: 1328, height: 1776, crossings: 0, collisions: 0, elements: 22, flows: 26 });
  assert.equal(runs[0][0].stats.orientation, 'LR');
  assert.match(runs[1][0].html, /ranks top to bottom/);
});

test('the banner names the focus under either field name and a one-way filter direction', () => {
  // arrange
  const at = (filter) => doc([node('a')], [], { source: { producer: 'flow-graph', filter: { prefix: null, hops: 1, seeds: 1, nodesKept: 1, nodesOmitted: 0, flowsOmitted: 0, ...filter } } });
  const banner = (m) => /<p class="banner">(.*?)<\/p>/.exec(renderHtml(m).html)[1];

  // act
  const around = banner(at({ around: 'a', direction: 'in' }));
  const out = banner(at({ focus: 'a', direction: 'out' }));
  const both = banner(at({ around: 'a', direction: 'both' }));
  const neither = banner(at({}));

  // assert
  assert.match(around, /focus <code>a<\/code>, 1 hop\(s\) from 1 seed node\(s\), following flows into the seeds only;/);
  assert.match(out, /following flows out of the seeds only/);
  assert.doesNotMatch(both, /following/);
  assert.doesNotMatch(neither, /focus/);
});

test('a source sits one rank before its first consumer, so a trigger draws no flow across every rank', () => {
  // arrange: a chain of four, and a scheduler that triggers only the last
  const m = doc([node('a'), node('b'), node('c'), node('d'), node('cron', 'external', { subtype: 'scheduler' })],
    [flow('a', 'b'), flow('b', 'c'), flow('c', 'd'), flow('cron', 'd', { mode: 'event' })]);

  // act
  const g = lay(m);
  const rank = Object.fromEntries(g.nodes.map((b) => [b.id, b.rank]));

  // assert
  assert.equal(rank.a, 0, 'a source with consumers in rank 1 stays at 0');
  assert.equal(rank.cron, rank.d - 1);
  assert.equal((g.edges.find((e) => e.from === 'cron').d.match(/C/g) || []).length, 1, 'one hop, no virtual points');
});
