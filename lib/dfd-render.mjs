// lib/dfd-render.mjs — a dfd@1 model as one self-contained HTML page with an inline SVG diagram.
//
// Notation: Gane–Sarson. A process is a rounded box with its reference in a top strip, a data store
// is a box open at the right with its reference in a left compartment (D for a store, Q for a
// broker or queue), an external entity is a square box with a shadow. Solid line = sync, dashed =
// async or event, a head at both ends = bidirectional, a dotted line with no head = direction never
// determined. A feedback flow leaves the diagram's left-to-right order: it is routed over the top on
// its own track, heavier and in the secondary accent. A retry on one process is a loop on its corner.
//
// Layout is a small layered (Sugiyama-style) pass and is deterministic: ranks by longest path, one
// virtual point per rank a long flow crosses, a fixed number of barycentre sweeps, then coordinates.
// Nothing reads the clock, so one model renders to the same bytes every time. Maturity layers
// (bronze, silver, gold) are horizontal bands; hop rank runs left to right.
//
// The page makes no request with `fonts: 'none'` or `'inline'`; it carries no script but the theme
// follower, no style attribute, and a Content-Security-Policy that admits exactly its own bytes.
// Under every diagram the same nodes and flows are tabulated: the drawing is never the only channel.

import { createHash } from 'node:crypto';
import { esc } from './html-escape.mjs';
import { houseCss } from './house-css.mjs';
import { MARK_ICON } from './brand-tokens.mjs';
import { FOLLOWER_JS } from './theme-follower.mjs';
import { analyse, isBroker, isDirected, longestPathRanks } from './dfd.mjs';

export const SWEEPS = 4;
const NODE_H = 44;
const SLOT = 84;
const CHAR = 6.7;
const NODE_MIN = 124;
const NODE_MAX = 260;
const LABEL_MAX = Math.floor((NODE_MAX - 46) / CHAR);
const TRACK = 16;
const LANE_PAD = 14;

const sha256b64 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const num = (x) => String(Math.round(x * 10) / 10);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Middle ellipsis: a path's head and tail both identify it. */
export function clip(label, max = LABEL_MAX) {
  const s = String(label);
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) / 2);
  return `${s.slice(0, head)}…${s.slice(s.length - (max - 1 - head))}`;
}

/** A polyline with rounded corners, as an SVG path. */
export function roundedPath(pts, r = 6) {
  let d = `M${num(pts[0][0])},${num(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    const inLen = Math.hypot(x - px, y - py);
    const outLen = Math.hypot(nx - x, ny - y);
    const k = Math.min(r, inLen / 2, outLen / 2);
    d += ` L${num(x - ((x - px) / inLen) * k)},${num(y - ((y - py) / inLen) * k)}`;
    d += ` Q${num(x)},${num(y)} ${num(x + ((nx - x) / outLen) * k)},${num(y + ((ny - y) / outLen) * k)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${num(last[0])},${num(last[1])}`;
}

const curve = (x1, y1, x2, y2) => {
  const k = (x2 - x1) / 2;
  return `C${num(x1 + k)},${num(y1)} ${num(x2 - k)},${num(y2)} ${num(x2)},${num(y2)}`;
};

const modeStyle = (modes) => (modes.every((m) => m === 'sync') ? 'sync' : modes.every((m) => m !== 'sync') ? 'async' : 'mixed');

// contradicted outranks unknown outranks confirmed; a flow with no evidence at all is `declared`
function existenceOf(flows) {
  const states = flows.map((f) => (f.evidence ? f.evidence.existence : 'declared'));
  for (const s of ['contradicted', 'unknown', 'declared']) if (states.includes(s)) return s;
  return 'confirmed';
}

/**
 * Model + analysis -> geometry. Every flow lands in exactly one drawn edge (`edges[].flows`), and
 * flows between the same two nodes share one edge.
 */
export function layout(model, analysis) {
  const nodes = model.nodes;
  const n = nodes.length;
  const ix = new Map(nodes.map((nd, i) => [nd.id, i]));
  const flows = model.flows;
  const aRank = analysis.nodes.map((a) => a.rank);

  const counters = { P: 0, D: 0, Q: 0, E: 0 };
  const refs = nodes.map((nd) => {
    const letter = nd.kind === 'process' ? 'P' : nd.kind === 'external' ? 'E' : isBroker(nd) ? 'Q' : 'D';
    return `${letter}${++counters[letter]}`;
  });

  // ── bundles: one drawn edge per unordered node pair, one per self-looping node ─────────────────
  const bundleBy = new Map();
  flows.forEach((f, k) => {
    const a = ix.get(f.from);
    const b = ix.get(f.to);
    const key = a === b ? `self:${a}` : `${Math.min(a, b)}|${Math.max(a, b)}`;
    if (!bundleBy.has(key)) bundleBy.set(key, { self: a === b, lo: Math.min(a, b), hi: Math.max(a, b), flows: [] });
    bundleBy.get(key).flows.push(k);
  });
  const bundles = [...bundleBy.values()];
  for (const b of bundles) {
    const classes = b.flows.map((k) => analysis.flowClass[k]);
    b.cls = b.self ? 'self' : classes.includes('bidirectional') ? 'bi' : classes.includes('feedback') ? 'fb'
      : classes.includes('forward') ? 'fwd' : 'und';
    b.mode = modeStyle(b.flows.map((k) => flows[k].mode));
    b.existence = existenceOf(b.flows.map((k) => flows[k]));
    b.label = clip([...new Set(b.flows.map((k) => flows[k].label).filter(Boolean))].join(' / '), 44);
  }

  // ── ranks: the analysis layering, then undirected pairs oriented along its topological order ────
  const directedArcs = [];
  for (const b of bundles) {
    if (b.cls === 'fwd' || b.cls === 'bi') directedArcs.push(aRank[b.lo] < aRank[b.hi] ? [b.lo, b.hi] : [b.hi, b.lo]);
  }
  const topo = new Array(n);
  longestPathRanks(n, directedArcs).order.forEach((v, t) => { topo[v] = t; });
  const hintArcs = bundles.filter((b) => b.cls === 'und').map((b) => (topo[b.lo] < topo[b.hi] ? [b.lo, b.hi] : [b.hi, b.lo]));
  const rank = longestPathRanks(n, [...directedArcs, ...hintArcs]).rank;
  const ranks = Math.max(...rank) + 1;
  const feedbacks = bundles.filter((b) => b.cls === 'fb');
  feedbacks.forEach((b, i) => {
    const k = b.flows.find((j) => analysis.flowClass[j] === 'feedback');
    b.from = ix.get(flows[k].from);
    b.to = ix.get(flows[k].to);
    b.track = i;
  });

  // ── lanes: unlayered first, then the declared maturity order ──────────────────────────────────
  const layerNames = model.layers ? [...model.layers] : [...new Set(nodes.map((nd) => nd.layer).filter((l) => l !== undefined))];
  const laneNames = [...(nodes.some((nd) => nd.layer === undefined) ? [null] : []), ...layerNames];
  const laneOf = (nd) => laneNames.indexOf(nd.layer === undefined ? null : nd.layer);

  // ── columns: nodes and one virtual point per rank a long flow crosses ─────────────────────────
  const cols = Array.from({ length: ranks }, () => []);
  const items = nodes.map((nd, i) => ({ node: i, rank: rank[i], lane: laneOf(nd), group: nd.group === undefined ? `~n${i}` : `g${nd.group}`, up: [], down: [] }));
  for (const it of items) cols[it.rank].push(it);
  const link = (a, b) => { a.down.push(b); b.up.push(a); };
  bundles.forEach((b, bi) => {
    if (b.self || b.cls === 'fb') return;
    [b.a, b.b] = rank[b.lo] < rank[b.hi] ? [b.lo, b.hi] : [b.hi, b.lo];
    b.chain = [items[b.a]];
    for (let r = rank[b.a] + 1; r < rank[b.b]; r++) {
      const d = { node: -1, rank: r, lane: items[b.b].lane, group: `~d${bi}:${r}`, up: [], down: [] };
      cols[r].push(d);
      b.chain.push(d);
    }
    b.chain.push(items[b.b]);
    for (let i = 1; i < b.chain.length; i++) link(b.chain[i - 1], b.chain[i]);
  });
  const settle = (col) => {
    col.sort((p, q) => (p.lane - q.lane) || (p.gb - q.gb) || (p.group < q.group ? -1 : p.group > q.group ? 1 : 0) || (p.bary - q.bary) || (p.pos - q.pos));
    col.forEach((it, i) => { it.pos = i; });
  };
  for (const col of cols) {
    col.forEach((it, i) => { it.pos = i; it.bary = i; it.gb = 0; });
    const first = new Map();
    for (const it of col) if (!first.has(it.group)) first.set(it.group, it.pos);
    for (const it of col) it.gb = first.get(it.group);
    settle(col);
  }
  for (let s = 0; s < SWEEPS; s++) {
    const down = s % 2 === 0;
    for (let i = 1; i < ranks; i++) {
      const col = cols[down ? i : ranks - 1 - i];
      for (const it of col) {
        const near = down ? it.up : it.down;
        it.bary = near.length ? mean(near.map((o) => o.pos)) : it.pos;
      }
      const sums = new Map();
      for (const it of col) {
        const key = `${it.lane}|${it.group}`;
        if (!sums.has(key)) sums.set(key, []);
        sums.get(key).push(it.bary);
      }
      for (const it of col) it.gb = mean(sums.get(`${it.lane}|${it.group}`));
      settle(col);
    }
  }

  // ── coordinates ───────────────────────────────────────────────────────────────────────────────
  const widths = nodes.map((nd) => Math.max(NODE_MIN, Math.min(NODE_MAX, Math.round(clip(nd.label).length * CHAR + 46))));
  const colW = cols.map((col) => Math.max(24, ...col.filter((it) => it.node >= 0).map((it) => widths[it.node])));
  // a gutter holds the feedback risers and the label of every flow that starts on its left
  const gutters = cols.map(() => Math.max(96, 52 + 12 * feedbacks.length));
  for (const b of bundles) {
    if (!b.self && b.cls !== 'fb') gutters[rank[b.a]] = Math.max(gutters[rank[b.a]], Math.round(b.label.length * 6.1 + 30));
  }
  const left = Math.max(40, 28 + 6 * feedbacks.length) + (layerNames.length ? 70 : 0);
  const colX = [];
  colW.forEach((w, r) => { colX.push(r === 0 ? left : colX[r - 1] + colW[r - 1] + gutters[r - 1]); });
  const width = colX[ranks - 1] + colW[ranks - 1] + Math.max(40, 28 + 6 * feedbacks.length);
  const bodyTop = 22 + TRACK * feedbacks.length + 26;

  const rows = laneNames.map((_, l) => Math.max(1, ...cols.map((col) => col.filter((it) => it.lane === l).length)));
  const laneTop = [];
  rows.forEach((_, l) => { laneTop.push(l === 0 ? bodyTop : laneTop[l - 1] + rows[l - 1] * SLOT + 2 * LANE_PAD); });
  const height = laneTop[rows.length - 1] + rows[rows.length - 1] * SLOT + 2 * LANE_PAD + 8;
  for (const col of cols) {
    for (let l = 0; l < laneNames.length; l++) {
      const inLane = col.filter((it) => it.lane === l);
      inLane.forEach((it, k) => { it.cy = laneTop[l] + LANE_PAD + ((rows[l] - inLane.length) / 2 + k + 0.5) * SLOT; });
    }
  }
  const boxes = nodes.map((nd, i) => ({
    id: nd.id, ref: refs[i], kind: nd.kind, rank: rank[i], lane: laneNames[items[i].lane],
    x: colX[rank[i]] + (colW[rank[i]] - widths[i]) / 2, y: items[i].cy - NODE_H / 2, w: widths[i], h: NODE_H,
  }));

  // ── ports: flows leave on the right and arrive on the left, spread so they do not share a point ─
  const outs = nodes.map(() => []);
  const ins = nodes.map(() => []);
  bundles.forEach((b, bi) => {
    if (b.self) return;
    if (b.cls === 'fb') { outs[b.from].push({ bi, toward: -Infinity }); ins[b.to].push({ bi, toward: -Infinity }); return; }
    outs[b.a].push({ bi, toward: b.chain[1].cy });
    ins[b.b].push({ bi, toward: b.chain[b.chain.length - 2].cy });
  });
  const portY = new Map();
  const spread = (list, i, side) => {
    list.sort((p, q) => (p.toward - q.toward) || (p.bi - q.bi));
    const step = list.length > 1 ? Math.min(9, (NODE_H - 14) / (list.length - 1)) : 0;
    list.forEach((p, k) => portY.set(`${side}${p.bi}`, items[i].cy + (k - (list.length - 1) / 2) * step));
  };
  outs.forEach((list, i) => spread(list, i, 'o'));
  ins.forEach((list, i) => spread(list, i, 'i'));

  // ── edges ─────────────────────────────────────────────────────────────────────────────────────
  const edges = bundles.map((b, bi) => {
    const base = { flows: b.flows, cls: b.cls, mode: b.mode, existence: b.existence, label: b.label };
    if (b.self) {
      const bx = boxes[b.lo];
      const x1 = bx.x + bx.w - 36;
      const x2 = bx.x + bx.w - 10;
      return { ...base, from: bx.id, to: bx.id, heads: 'end', lx: x2 + 6, ly: bx.y - 9, anchor: 'start',
        d: `M${num(x1)},${num(bx.y)} C${num(x1)},${num(bx.y - 26)} ${num(x2)},${num(bx.y - 26)} ${num(x2)},${num(bx.y)}` };
    }
    if (b.cls === 'fb') {
      const u = boxes[b.from];
      const v = boxes[b.to];
      const yt = 22 + TRACK * b.track;
      const xr = colX[u.rank] + colW[u.rank] + 16 + 6 * b.track;
      const xl = colX[v.rank] - 16 - 6 * b.track;
      const y1 = portY.get(`o${bi}`);
      const y2 = portY.get(`i${bi}`);
      return { ...base, from: u.id, to: v.id, heads: 'end', lx: (xr + xl) / 2, ly: yt - 4, anchor: 'middle',
        d: roundedPath([[u.x + u.w, y1], [xr, y1], [xr, yt], [xl, yt], [xl, y2], [v.x, y2]]) };
    }
    const a = boxes[b.a];
    const z = boxes[b.b];
    let x = a.x + a.w;
    let y = portY.get(`o${bi}`);
    let d = `M${num(x)},${num(y)}`;
    let lx = null;
    let ly = null;
    const hop = (x2, y2) => {
      if (lx === null) { lx = (x + x2) / 2; ly = (y + y2) / 2 - 5; }
      d += ` ${curve(x, y, x2, y2)}`;
      x = x2; y = y2;
    };
    for (const dummy of b.chain.slice(1, -1)) {
      hop(colX[dummy.rank], dummy.cy);
      x = colX[dummy.rank] + colW[dummy.rank];
      d += ` L${num(x)},${num(y)}`;
    }
    hop(z.x, portY.get(`i${bi}`));
    // a forward flow always runs from the lower rank, so only a two-way pair takes a head at its start
    return { ...base, from: a.id, to: z.id, heads: b.cls === 'bi' ? 'both' : b.cls === 'fwd' ? 'end' : 'none', lx, ly, anchor: 'middle', d };
  });

  // ── bands and boundary hulls ──────────────────────────────────────────────────────────────────
  const bands = laneNames.map((name, l) => ({ name, y: laneTop[l], h: rows[l] * SLOT + 2 * LANE_PAD }))
    .filter((b) => b.name !== null);
  const declared = new Map((model.groups || []).map((g) => [g.id, g]));
  const hulls = [];
  const loose = new Set();
  for (const g of [...new Set(nodes.map((nd) => nd.group).filter((x) => x !== undefined))]) {
    const inside = boxes.filter((_, i) => nodes[i].group === g);
    const hull = {
      id: g, label: declared.get(g)?.label || g, boundary: declared.get(g)?.boundary || 'system',
      x: Math.min(...inside.map((b) => b.x)) - 10, y: Math.min(...inside.map((b) => b.y)) - 20,
      x2: Math.max(...inside.map((b) => b.x + b.w)) + 10, y2: Math.max(...inside.map((b) => b.y + b.h)) + 10,
    };
    const hits = (r) => r.x < hull.x2 && r.x2 > hull.x && r.y < hull.y2 && r.y2 > hull.y;
    const blocked = boxes.some((b, i) => nodes[i].group !== g && hits({ x: b.x, y: b.y, x2: b.x + b.w, y2: b.y + b.h })) || hulls.some(hits);
    // a boundary that cannot be drawn without enclosing a stranger is named under each member instead
    if (blocked) loose.add(g);
    else hulls.push(hull);
  }
  boxes.forEach((b, i) => { if (loose.has(nodes[i].group)) b.caption = declared.get(nodes[i].group)?.label || nodes[i].group; });

  return { width, height, nodes: boxes, edges, bands, hulls };
}

// ── SVG ────────────────────────────────────────────────────────────────────────────────────────

const MARKERS = ['ink', 'mut', 'fb', 'bad'].map((c) => `<marker id="dfd-a-${c}" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="10" markerHeight="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path class="mk-${c}" d="M0,0 L10,4 L0,8 z"/></marker>`).join('');

const markerOf = (e) => (e.existence === 'contradicted' ? 'bad' : e.cls === 'fb' ? 'fb' : e.existence === 'unknown' ? 'mut' : 'ink');

function nodeSvg(b, nd) {
  const cx = b.x + b.w / 2;
  const tip = `${b.ref} ${nd.kind}${nd.subtype ? ` (${nd.subtype})` : ''}: ${nd.label}${nd.group ? ` — boundary ${nd.group}` : ''}${nd.layer ? ` — layer ${nd.layer}` : ''}${nd.note ? ` — ${nd.note}` : ''}`;
  const cls = `n ${nd.kind === 'process' ? 'proc' : nd.kind === 'store' ? 'store' : 'ext'}${nd.unknown ? ' unk' : ''}`;
  let shape;
  if (nd.kind === 'process') {
    shape = `<rect x="${num(b.x)}" y="${num(b.y)}" width="${b.w}" height="${b.h}" rx="9"/><line x1="${num(b.x)}" y1="${num(b.y + 15)}" x2="${num(b.x + b.w)}" y2="${num(b.y + 15)}"/>`
      + `<text class="ref" x="${num(cx)}" y="${num(b.y + 11.5)}" text-anchor="middle">${b.ref}</text><text x="${num(cx)}" y="${num(b.y + 33.5)}" text-anchor="middle">${esc(clip(nd.label))}</text>`;
  } else if (nd.kind === 'store') {
    shape = `<path d="M${num(b.x + b.w)},${num(b.y)} H${num(b.x)} V${num(b.y + b.h)} H${num(b.x + b.w)}"/><line x1="${num(b.x + 30)}" y1="${num(b.y)}" x2="${num(b.x + 30)}" y2="${num(b.y + b.h)}"/>`
      + `<text class="ref" x="${num(b.x + 15)}" y="${num(b.y + 26)}" text-anchor="middle">${b.ref}</text><text x="${num(b.x + 30 + (b.w - 30) / 2)}" y="${num(b.y + 26)}" text-anchor="middle">${esc(clip(nd.label))}</text>`;
  } else {
    shape = `<rect class="sh" x="${num(b.x + 4)}" y="${num(b.y + 4)}" width="${b.w}" height="${b.h}"/><rect x="${num(b.x)}" y="${num(b.y)}" width="${b.w}" height="${b.h}"/>`
      + `<text class="ref" x="${num(b.x + 6)}" y="${num(b.y + 12)}">${b.ref}</text><text x="${num(cx)}" y="${num(b.y + 30)}" text-anchor="middle">${esc(clip(nd.label))}</text>`;
  }
  const cap = b.caption ? `<text class="cap" x="${num(cx)}" y="${num(b.y + b.h + 12)}" text-anchor="middle">‹${esc(clip(b.caption, 30))}›</text>` : '';
  return `<g class="${cls}" data-id="${esc(nd.id)}"><title>${esc(tip)}</title>${shape}${cap}</g>`;
}

function edgeSvg(e) {
  const m = markerOf(e);
  const cls = ['e', e.cls, e.mode, ...(e.existence === 'unknown' ? ['unk'] : e.existence === 'contradicted' ? ['bad'] : [])].join(' ');
  const end = e.heads === 'none' ? '' : ` marker-end="url(#dfd-a-${m})"`;
  const start = e.heads === 'both' ? ` marker-start="url(#dfd-a-${m})"` : '';
  const word = { fwd: 'flow', bi: 'two-way flow', fb: 'feedback flow', self: 'retry loop', und: 'flow, direction not determined' }[e.cls];
  const label = e.label ? `<text class="el" x="${num(e.lx)}" y="${num(e.ly)}" text-anchor="${e.anchor}">${esc(e.label)}</text>` : '';
  return `<g class="${cls}" data-flows="${e.flows.join(',')}" data-from="${esc(e.from)}" data-to="${esc(e.to)}"><title>${esc(`${word}: ${e.from} → ${e.to} (${e.mode}, existence ${e.existence})`)}</title><path d="${e.d}"${start}${end}/>${label}</g>`;
}

export function renderSvg(model, lay) {
  const title = model.title || 'data flow diagram';
  const bands = lay.bands.map((b, i) => `<g class="band${i % 2 ? ' alt' : ''}"><rect x="4" y="${num(b.y)}" width="${num(lay.width - 8)}" height="${num(b.h)}"/><text x="12" y="${num(b.y + 16)}">${esc(clip(b.name, 12))}</text></g>`).join('');
  const hulls = lay.hulls.map((h) => `<g class="hull ${h.boundary}"><rect x="${num(h.x)}" y="${num(h.y)}" width="${num(h.x2 - h.x)}" height="${num(h.y2 - h.y)}" rx="4"/><text x="${num(h.x + 6)}" y="${num(h.y + 12)}">${esc(clip(h.label, Math.floor((h.x2 - h.x - 12) / 6.1)))}</text></g>`).join('');
  return `<svg class="dfd" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(lay.width)} ${num(lay.height)}" width="${num(lay.width)}" height="${num(lay.height)}" role="img" aria-labelledby="dfd-title dfd-desc">`
    + `<title id="dfd-title">${esc(title)}</title><desc id="dfd-desc">${lay.nodes.length} elements and ${model.flows.length} flows, drawn as ${lay.edges.length} edges. The tables after the diagram list every one.</desc>`
    + `<defs>${MARKERS}</defs>${bands}${hulls}`
    + `<g class="edges">${lay.edges.map(edgeSvg).join('')}</g><g class="nodes">${lay.nodes.map((b, i) => nodeSvg(b, model.nodes[i])).join('')}</g></svg>`;
}

// ── page ───────────────────────────────────────────────────────────────────────────────────────

const FONT_WEIGHTS = { sans: [400, 600], mono: [400, 600] };

export const pageCss = (fonts = 'none') => `${houseCss({ fonts, weights: FONT_WEIGHTS })}
body{font-size:.875rem;line-height:1.5}
main{padding:1rem 1.375rem 3.75rem;max-width:110rem;margin:0 auto}
h1{font-size:1.25rem;margin:0 0 .25rem}
h2{font-size:1rem;margin:1.75rem 0 .5rem}
.sub{color:var(--mut);font-size:.8125rem;margin:0 0 .75rem}
.banner{border:1px solid var(--line);border-left:4px solid var(--acc);background:var(--panel);padding:.5rem .75rem;margin:.625rem 0;font-size:.8125rem;max-width:none}
.dfd-wrap{overflow:auto;border:1px solid var(--line);background:var(--panel);max-height:85vh}
svg.dfd{display:block}
.dfd text{font:11px var(--mono);fill:var(--ink)}
.dfd .ref{font-weight:600;fill:var(--mut);font-size:10px}
.dfd .cap{fill:var(--mut);font-size:10px;font-style:italic}
.dfd .n rect,.dfd .n path{fill:var(--panel2);stroke:var(--ink);stroke-width:1.4}
.dfd .n line{stroke:var(--ink);stroke-width:1}
.dfd .n.ext .sh{fill:var(--line2);stroke:none}
.dfd .n.unk rect,.dfd .n.unk path{stroke-dasharray:4 3;stroke:var(--mut)}
.dfd .n.unk text{font-style:italic;fill:var(--mut)}
.dfd .e path{fill:none;stroke:var(--ink);stroke-width:1.5}
.dfd .e.async path{stroke-dasharray:7 4}
.dfd .e.mixed path{stroke-dasharray:10 3 2 3}
.dfd .e.und path{stroke-dasharray:1 5;stroke-linecap:round;stroke-width:2}
.dfd .e.unk path{stroke:var(--mut);stroke-width:1}
.dfd .e.und.unk path{stroke-width:1.6}
.dfd .e.fb path{stroke:var(--acc2);stroke-width:2.4}
.dfd .e.fb.unk path{stroke-width:1.4}
.dfd .e.bad path{stroke:var(--crit)}
.dfd .el{fill:var(--mut);font-size:10px;paint-order:stroke;stroke:var(--panel);stroke-width:3px;stroke-linejoin:round}
.dfd .e.fb .el{fill:var(--acc2);font-weight:600}
.dfd .mk-ink{fill:var(--ink)}.dfd .mk-mut{fill:var(--mut)}.dfd .mk-fb{fill:var(--acc2)}.dfd .mk-bad{fill:var(--crit)}
.dfd .band rect{fill:color-mix(in srgb,var(--acc) 5%,transparent);stroke:var(--line)}
.dfd .band.alt rect{fill:color-mix(in srgb,var(--acc) 10%,transparent)}
.dfd .band text{fill:var(--mut);font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.dfd .hull rect{fill:none;stroke:var(--line2);stroke-width:1.2}
.dfd .hull.trust rect{stroke:var(--crit);stroke-dasharray:9 5}
.dfd .hull text{fill:var(--mut);font-size:10px}
.legend{display:flex;flex-wrap:wrap;gap:.375rem 1.25rem;list-style:none;padding:0;margin:.625rem 0;font-size:.75rem;color:var(--mut)}
.legend li{display:inline-flex;align-items:center;gap:.375rem;margin:0}
.facts{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem;margin:.5rem 0;font-size:.8125rem}
.facts dt{color:var(--mut)}
.facts dd{margin:0}
table{background:var(--panel);width:100%}
td.m{font-family:var(--mono);font-size:.75rem;overflow-wrap:anywhere}
.absent{color:var(--mut);font-style:italic}
`;

const legendSvg = (inner) => `<svg class="dfd" viewBox="0 0 58 24" width="58" height="24" aria-hidden="true">${inner}</svg>`;
const legendLine = (cls, marker, heads = 'end') => legendSvg(`<g class="e ${cls}"><path d="M4,12 L54,12"${heads === 'both' ? ` marker-start="url(#dfd-a-${marker})"` : ''}${heads === 'none' ? '' : ` marker-end="url(#dfd-a-${marker})"`}/></g>`);
const LEGEND = `<ul class="legend">
<li>${legendSvg('<g class="n proc"><rect x="6" y="2" width="46" height="20" rx="6"/><line x1="6" y1="9" x2="52" y2="9"/></g>')} process</li>
<li>${legendSvg('<g class="n store"><path d="M52,3 H6 V21 H52"/><line x1="18" y1="3" x2="18" y2="21"/></g>')} data store (D), broker or queue (Q)</li>
<li>${legendSvg('<g class="n ext"><rect class="sh" x="10" y="6" width="42" height="16"/><rect x="6" y="2" width="42" height="16"/></g>')} external entity</li>
<li>${legendLine('fwd sync', 'ink')} sync flow</li>
<li>${legendLine('fwd async', 'ink')} async or event flow</li>
<li>${legendLine('fwd mixed', 'ink')} both modes on one pair</li>
<li>${legendLine('bi sync', 'ink', 'both')} bidirectional</li>
<li>${legendLine('fb sync', 'fb')} feedback (routed over the top)</li>
<li>${legendSvg('<g class="e self sync"><path d="M18,22 C18,2 40,2 40,22" marker-end="url(#dfd-a-ink)"/></g>')} retry loop</li>
<li>${legendLine('und sync', 'ink', 'none')} direction not determined</li>
<li>${legendLine('fwd sync unk', 'mut')} existence unknown</li>
<li>${legendLine('fwd sync bad', 'bad')} contradicted</li>
<li>${legendSvg('<g class="hull system"><rect x="4" y="3" width="50" height="18" rx="4"/></g>')} system boundary</li>
<li>${legendSvg('<g class="hull trust"><rect x="4" y="3" width="50" height="18" rx="4"/></g>')} trust boundary</li>
<li>${legendSvg('<g class="band"><rect x="4" y="3" width="50" height="18"/></g>')} maturity layer</li>
</ul>`;

const absent = (text) => `<span class="absent">${esc(text)}</span>`;
const list = (xs, empty = 'none') => (xs.length ? xs.map((x) => esc(x)).join('; ') : absent(empty));

function sourceBanner(model) {
  const s = model.source;
  if (!s) return '<p class="banner">Authored model. No producer is recorded, so every flow is as declared and none is verified here.</p>';
  const parts = [`Producer: <code>${esc(s.producer)}</code>.`];
  if (s.note) parts.push(esc(s.note));
  if (s.graph) parts.push(`Flow graph of ${esc(s.graph.nodes)} nodes and ${esc(s.graph.edges)} edges${s.graph.generatedAt ? `, generated ${esc(s.graph.generatedAt)}` : ''}.`);
  if (s.omitted) parts.push(`Left out by the adapter: ${Object.entries(s.omitted).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(', ')}.`);
  if (s.filter) {
    const f = s.filter;
    parts.push(`<strong>This is a subset.</strong> Filter: ${f.prefix === null ? '' : `prefix <code>${esc(f.prefix)}</code>, `}${f.focus === null ? '' : `focus <code>${esc(f.focus)}</code>, `}${esc(f.hops)} hop(s) from ${esc(f.seeds)} seed node(s); ${esc(f.nodesOmitted)} nodes and ${esc(f.flowsOmitted)} flows are not shown.`);
  }
  return `<p class="banner">${parts.join(' ')}</p>`;
}

/** -> { html, csp }. `csp` is the header form; the page carries the same policy in a meta element. */
export function renderHtml(model, { fonts = 'none', maxPaths = 200 } = {}) {
  const analysis = analyse(model, { maxPaths });
  const lay = layout(model, analysis);
  const ref = new Map(lay.nodes.map((b) => [b.id, b.ref]));
  const labels = new Map(model.nodes.map((nd) => [nd.id, nd.label]));
  const name = (id) => `${ref.get(id)} ${labels.get(id)}`;
  const title = model.title || 'data flow diagram';
  const classWord = { forward: 'forward', bidirectional: 'bidirectional', feedback: 'feedback', 'self-loop': 'retry loop', undirected: 'direction not determined' };

  const nodeRows = model.nodes.map((nd, i) => {
    const a = analysis.nodes[i];
    const roles = [a.fanOut > 1 ? `branch ×${a.fanOut}` : '', a.fanIn > 1 ? `merge ×${a.fanIn}` : '', analysis.sources.includes(nd.id) ? 'source' : '',
      analysis.sinks.includes(nd.id) ? 'sink' : '', a.cyclic ? 'in a cycle' : '', nd.unknown ? 'unknown' : ''].filter(Boolean);
    return `<tr><td class="m">${lay.nodes[i].ref}</td><td>${esc(nd.kind)}${nd.subtype ? ` · ${esc(nd.subtype)}` : ''}</td><td class="m">${esc(nd.label)}</td><td>${nd.group ? esc(nd.group) : absent('none')}</td><td>${nd.layer ? esc(nd.layer) : absent('none')}</td><td class="tnum">${a.rank}</td><td>${roles.length ? esc(roles.join(', ')) : ''}${nd.note ? ` <span class="absent">${esc(nd.note)}</span>` : ''}</td></tr>`;
  }).join('\n');
  const flowRows = model.flows.map((f, k) => {
    const ev = f.evidence;
    const refs = ev && ev.refs && ev.refs.length ? ` — ${esc(ev.refs[0])}${ev.refs.length > 1 ? ` (+${ev.refs.length - 1})` : ''}` : '';
    const evidence = !ev ? absent('declared, no evidence')
      : `${ev.existence === 'unknown' ? absent('existence unknown') : esc(ev.existence)}${ev.witness ? ` · ${esc(ev.witness)}` : ''}${refs}`;
    return `<tr><td class="tnum">${k + 1}</td><td class="m">${esc(name(f.from))}</td><td>${isDirected(f) ? '→' : '—'}</td><td class="m">${esc(name(f.to))}</td><td>${esc(f.mode)}</td><td>${classWord[analysis.flowClass[k]]}</td><td>${f.label ? esc(f.label) : ''}</td><td>${evidence}</td></tr>`;
  }).join('\n');

  const p = analysis.paths;
  const facts = [
    ['Bidirectional pairs', list(analysis.bidirectional.map((b) => `${name(b.a)} ⇄ ${name(b.b)}`))],
    ['Feedback flows', list(analysis.feedback.map((f) => `${name(f.from)} → ${name(f.to)}`))],
    ['Retry loops', list(analysis.selfLoops.map((s) => name(s.node)))],
    ['Cycles', list(analysis.cycles.map((c) => `{${c.members.map((id) => ref.get(id)).join(', ')}}${c.bidirectionalOnly ? ' two-way only' : ''}${c.uncertain ? ' uncertain: passes through an element marked unknown' : ''}`))],
    ['Branch points (fan-out)', list(analysis.branches.map((b) => `${name(b.node)} → ${b.to.length}`))],
    ['Merge points (fan-in)', list(analysis.merges.map((m) => `${name(m.node)} ← ${m.from.length}`))],
    ['Async hops', list(analysis.asyncHops.map((h) => `${ref.get(h.from)} → ${ref.get(h.to)} (${h.reason})`))],
    ['Through a broker', list(analysis.brokered.map((b) => `${ref.get(b.from)} → ${ref.get(b.via)} → ${ref.get(b.to)}`))],
    ['Source-to-sink paths', `${p.total === null ? absent('more than can be counted exactly') : p.total}${p.truncated ? `, first ${p.listed.length} listed` : ''}; ${p.multiHop} of those listed are multi-hop`
      + `${p.listed.length ? `; longest listed: ${esc(p.listed.reduce((m, x) => (x.length > m.length ? x : m)).map((id) => ref.get(id)).join(' → '))}` : ''}`],
    ['Direction not determined', analysis.undirected.length ? `${analysis.undirected.length} flow(s), outside every figure above` : absent('none')],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('\n');

  const css = pageCss(fonts);
  const policy = (extra) => ["default-src 'none'", `style-src 'sha256-${sha256b64(css)}'`, `script-src 'sha256-${sha256b64(FOLLOWER_JS)}'`,
    'img-src data:', `font-src ${fonts === 'served' ? "'self'" : 'data:'}`, "base-uri 'none'", "form-action 'none'", ...extra].join('; ');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${policy([])}">${MARK_ICON}
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} — data flow diagram</title>
<script>${FOLLOWER_JS}</script>
<style>${css}</style></head>
<body><main>
<h1>${esc(title)}</h1>
<p class="sub">Data flow diagram, Gane–Sarson notation · dfd@${esc(model.v)} · ${model.nodes.length} elements, ${model.flows.length} flows</p>
${sourceBanner(model)}
<div class="dfd-wrap">${renderSvg(model, lay)}</div>
${LEGEND}
<h2>What the analysis found</h2>
<dl class="facts">
${facts}
</dl>
<h2>Elements</h2>
<table><thead><tr><th>ref</th><th>kind</th><th>label</th><th>boundary</th><th>layer</th><th>hop rank</th><th>roles</th></tr></thead><tbody>
${nodeRows}
</tbody></table>
<h2>Flows</h2>
<table><thead><tr><th>#</th><th>from</th><th></th><th>to</th><th>mode</th><th>class</th><th>label</th><th>evidence</th></tr></thead><tbody>
${flowRows}
</tbody></table>
</main></body></html>
`;
  return { html, csp: policy(["frame-ancestors 'self'"]) };
}
