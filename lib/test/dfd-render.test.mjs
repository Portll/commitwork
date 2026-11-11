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
import { layout, renderSvg, renderHtml, pageCss, clip, roundedPath, SWEEPS } from '../dfd-render.mjs';
import { FOLLOWER_JS } from '../theme-follower.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = () => JSON.parse(readFileSync(join(HERE, 'fixtures', 'dfd-synthetic.json'), 'utf8'));
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const lay = (m) => layout(m, analyse(m));
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
  assert.deepEqual(by('bi').map((e) => [e.from, e.to, e.heads, e.label]), [['customer', 'api', 'both', 'order request / order status']]);
  assert.deepEqual(by('self').map((e) => [e.from, e.heads]), [['ingest', 'end']]);
  assert.deepEqual(by('fb').map((e) => [e.from, e.to, e.mode, e.existence]), [['validate', 'transform', 'sync', 'declared'], ['validate', 'bronze', 'async', 'unknown']]);
  assert.deepEqual(by('fwd').filter((e) => e.mode === 'async').map((e) => [e.from, e.to]), [['api', 'events'], ['events', 'ingest']]);
  assert.equal(by('fwd').find((e) => e.to === 'orders-db').existence, 'confirmed');
});

test('a feedback edge runs over the top: its track is above every element', () => {
  // arrange
  const m = fixture();

  // act
  const g = lay(m);
  const top = Math.min(...g.nodes.map((b) => b.y));
  const tracks = g.edges.filter((e) => e.cls === 'fb').map((e) => e.ly + 4);

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
  assert.match(svg, /<g class="n ext" data-id="customer"><title>E1 external \(user\): Customer — boundary internet<\/title><rect class="sh" /);
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
  assert.match(svg, /<g class="e bi sync" data-flows="0,1" data-from="customer" data-to="api">.*?marker-start="url\(#dfd-a-ink\)" marker-end="url\(#dfd-a-ink\)"/);
  assert.match(svg, /<g class="e fb sync" data-flows="10" data-from="validate" data-to="transform"><title>feedback flow: validate → transform \(sync, existence declared\)<\/title>/);
  assert.match(svg, /<g class="e fb async unk" data-flows="11"[^>]*>.*?marker-end="url\(#dfd-a-fb\)"/);
  assert.match(svg, /<g class="e self sync" data-flows="5" data-from="ingest" data-to="ingest"><title>retry loop:/);
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
  // arrange
  const m = fixture();

  // act
  const { html } = renderHtml(m);
  const urls = [...html.matchAll(/url\(([^)]*)\)/g)].map((x) => x[1]);
  const links = [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((x) => x[1]);

  // assert
  assert.ok(urls.length > 0 && urls.every((u) => u.startsWith('#dfd-a-')), urls.join(' '));
  assert.ok(links.every((u) => u.startsWith('data:')), links.join(' '));
  assert.doesNotMatch(html, /\sstyle="/);
  assert.doesNotMatch(html.replace('http://www.w3.org/2000/svg', ''), /https?:\/\//);
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
  assert.match(html, /<td class="tnum">11<\/td><td class="m">P5 Validate quality<\/td><td>→<\/td><td class="m">P3 Clean and conform<\/td><td>sync<\/td><td>feedback<\/td><td>validation errors<\/td><td><span class="absent">declared, no evidence<\/span><\/td>/);
  assert.match(html, /<td>async<\/td><td>feedback<\/td><td>replay request<\/td><td><span class="absent">existence unknown<\/span> · authored<\/td>/);
  assert.match(html, /<td>retry loop<\/td><td>retry on timeout<\/td>/);
  assert.match(html, /branch ×3/);
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
  assert.equal(fact('Through a broker'), 'P1 → Q1 → P2');
  assert.match(fact('Source-to-sink paths'), /^4; 4 of those listed are multi-hop; longest listed: E1 → P1 → Q1 → P2 → D2 → P3 → P4 → P5 → D4 → P6 → D5 → P8 → E2$/);
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
