// lib/dfd-render.mjs — a dfd@1 model as one self-contained HTML page with an inline SVG diagram.
//
// Notation: Gane–Sarson. A process is a rounded box with its reference in a top strip, a data store
// is a box open at the right with its reference in a left compartment (D for a store, Q for a
// broker or queue), an external entity is a square box with a shadow. A store or external subtype
// the notation recognises carries a small mark at its right end (database cylinder, queue chevrons,
// log lines, file page; endpoint globe, scheduler clock, actor figure, system screen, env braces,
// binary prompt). Solid line = sync, dashed = async or event, a head at both ends = bidirectional, a
// dotted line with no head = direction never determined. A feedback flow leaves the diagram's rank
// order: it is routed outside the body on its own track, heavier and in the secondary accent. A
// retry on one process is a loop on its corner. A flow's role (error, retry) and its existence
// (confirmed, declared, unknown, contradicted) each change the line, never only its colour.
//
// Layout is a small layered (Sugiyama-style) pass and is deterministic: ranks by longest path, one
// virtual point per rank a long flow crosses, a fixed number of barycentre sweeps, then adjacent
// transposition while it removes crossings, then coordinates, then label placement. Nothing reads
// the clock, so one model renders to the same bytes every time. Maturity layers (bronze, silver,
// gold) are bands across the rank axis. Ranks run left to right (LR) or top to bottom (TB); `auto`
// takes TB when the LR drawing is wider than AUTO_TB_WIDTH and TB is narrower.
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
export const TRANSPOSE_PASSES = 8;
export const AUTO_TB_WIDTH = 1600;
export const ORIENTATIONS = Object.freeze(['LR', 'TB', 'auto']);
const NODE_H = 44;
const CHAR = 6.7;
const ECHAR = 6.1;
const LINE = 12;
const NODE_MIN = 124;
const NODE_MAX = 260;
const LABEL_MAX = Math.floor((NODE_MAX - 46) / CHAR);
const EDGE_LINE = 26;
const GLYPH_W = 16;
const TRACK = 16;
const LANE_PAD = 14;
// a feedback riser sits this far outside its column; in TB the one above a column clears the
// self-loop labels, which stand above their box
const RISER_OUT = 16;
const RISER_IN = { LR: 16, TB: 42 };

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

const BREAK_AFTER = '/-.·,:';

/**
 * At most `lines` lines of at most `max` characters. A line breaks at the last space, or after the
 * last separator, that leaves it at least a third full; else it is cut hard. Only the last line is
 * ever shortened, and in the middle, so a path keeps its head and its tail.
 */
export function wrap(label, max = LABEL_MAX, lines = 2) {
  let rest = String(label);
  const out = [];
  while (rest.length > max && out.length < lines - 1) {
    let cut = max;
    let skip = 0;
    for (let b = max; b >= Math.ceil(max / 3); b--) {
      if (rest[b] === ' ') { cut = b; skip = 1; break; }
      if (BREAK_AFTER.includes(rest[b - 1])) { cut = b; break; }
    }
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut + skip).trimStart();
  }
  out.push(clip(rest, max));
  return out;
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

const modeStyle = (modes) => (modes.every((m) => m === 'sync') ? 'sync' : modes.every((m) => m !== 'sync') ? 'async' : 'mixed');

/** A flow's existence: its own field, else its evidence's, else `declared` (no evidence at all). */
export const flowExistence = (f) => f.existence || (f.evidence ? f.evidence.existence : 'declared');

// contradicted outranks unknown outranks declared outranks confirmed
const existenceOf = (states) => {
  for (const s of ['contradicted', 'unknown', 'declared']) if (states.includes(s)) return s;
  return 'confirmed';
};
const ROLE_ORDER = ['error', 'retry', 'feedback'];
const roleOf = (roles) => ROLE_ORDER.find((r) => roles.includes(r)) || 'data';
const ROLE_MARK = { error: '✕ ', retry: '↻ ' };

/** Every group with at least one member -> its member count, in first-member order. */
export function groupSizes(model) {
  const out = new Map();
  for (const nd of model.nodes) if (nd.group !== undefined) out.set(nd.group, (out.get(nd.group) || 0) + 1);
  return out;
}

/**
 * Each named group becomes one process. Flows that cross its boundary merge per (other end,
 * direction, mode, role, directedness), their labels joined and their count written `×n`; flows
 * between two members are dropped and counted. A name with no member throws.
 */
export function collapseGroups(model, ids) {
  const want = [...new Set(ids)];
  if (!want.length) return model;
  const sizes = groupSizes(model);
  const absent = want.filter((g) => !sizes.has(g));
  if (absent.length) throw new Error(`no element is in group ${absent.map((g) => JSON.stringify(g)).join(', ')}`);
  const declared = new Map((model.groups || []).map((g) => [g.id, g]));
  const taken = new Set(model.nodes.map((nd) => nd.id));
  const into = new Map();
  const info = new Map();
  for (const g of want) {
    let id = `group:${g}`;
    while (taken.has(id)) id += '~';
    taken.add(id);
    const members = model.nodes.filter((nd) => nd.group === g);
    const layers = [...new Set(members.map((nd) => nd.layer))];
    const label = declared.get(g)?.label || g;
    info.set(g, { id, label, members: members.length, internal: 0, merged: 0, layer: layers.length === 1 ? layers[0] : undefined });
    for (const nd of members) into.set(nd.id, g);
  }
  const nodes = [];
  for (const nd of model.nodes) {
    const g = into.get(nd.id);
    if (g === undefined) { nodes.push(nd); continue; }
    const c = info.get(g);
    if (nodes.some((x) => x.id === c.id)) continue;
    nodes.push({ id: c.id, kind: 'process', label: `${c.label} (${c.members} elements)`,
      ...(c.layer === undefined ? {} : { layer: c.layer }), collapsed: { group: g, members: c.members } });
  }
  const end = (id) => (into.has(id) ? info.get(into.get(id)).id : id);
  const flows = [];
  const merged = new Map();
  for (const f of model.flows) {
    const from = end(f.from);
    const to = end(f.to);
    if (from === f.from && to === f.to) { flows.push(f); continue; }
    if (from === to && into.get(f.from) === into.get(f.to)) { info.get(into.get(f.from)).internal++; continue; }
    const role = f.role || 'data';
    const key = JSON.stringify([from, to, f.mode, role, isDirected(f)]);
    if (!merged.has(key)) {
      const m = { from, to, mode: f.mode, ...(role === 'data' ? {} : { role }), ...(isDirected(f) ? {} : { directed: false }), parts: [] };
      merged.set(key, m);
      flows.push(m);
    }
    merged.get(key).parts.push(f);
    for (const id of [f.from, f.to]) if (into.has(id)) info.get(into.get(id)).merged++;
  }
  const out = flows.map((f) => {
    if (!f.parts) return f;
    const { parts, ...rest } = f;
    const labels = [...new Set(parts.map((p) => p.label).filter(Boolean))];
    const existence = existenceOf(parts.map(flowExistence));
    const refs = parts.flatMap((p) => (p.evidence && p.evidence.refs) || []);
    return { ...rest,
      ...(labels.length || parts.length > 1 ? { label: `${labels.join(' / ')}${parts.length > 1 ? ` ×${parts.length}` : ''}`.trim() } : {}),
      ...(existence === 'declared' ? {} : { evidence: { existence, ...(refs.length ? { refs } : {}) } }),
      merged: parts.length };
  });
  return { ...model, nodes, flows: out, collapsedGroups: want.map((g) => ({ group: g, ...info.get(g) })) };
}

// ── layout ─────────────────────────────────────────────────────────────────────────────────────

/** Crossings between consecutive ranks, counted on the segments the ranks' items join. */
export function countCrossings(cols) {
  let c = 0;
  for (const col of cols) {
    const segs = [];
    for (const it of col) for (const o of it.down) segs.push([it.pos, o.pos]);
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) if ((segs[i][0] - segs[j][0]) * (segs[i][1] - segs[j][1]) < 0) c++;
    }
  }
  return c;
}

const crossPair = (p, q) => {
  let c = 0;
  for (const side of ['up', 'down']) for (const x of p[side]) for (const y of q[side]) if (x.pos > y.pos) c++;
  return c;
};

// adjacent transposition: swap two neighbours while that removes crossings, inside one lane, and
// never splitting a group that has more than one member in the rank
function transpose(cols) {
  for (let pass = 0; pass < TRANSPOSE_PASSES; pass++) {
    let improved = false;
    for (const col of cols) {
      const count = new Map();
      for (const it of col) count.set(it.group, (count.get(it.group) || 0) + 1);
      for (let i = 0; i + 1 < col.length; i++) {
        const p = col[i];
        const q = col[i + 1];
        const free = p.lane === q.lane && (p.group === q.group || (count.get(p.group) === 1 && count.get(q.group) === 1));
        if (free && crossPair(q, p) < crossPair(p, q)) {
          col[i] = q; col[i + 1] = p; q.pos = i; p.pos = i + 1;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
}

const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (r, k) => ({ x: r.x - k, y: r.y - k, w: r.w + 2 * k, h: r.h + 2 * k });

// points along a sequence of path pieces; a cubic is sampled, a line is its two ends
function sample(pieces) {
  const pts = [pieces[0].p];
  for (const s of pieces.slice(1)) {
    if (s.c) {
      const [p0] = [pts[pts.length - 1]];
      const [c1, c2, p3] = [s.c[0], s.c[1], s.p];
      for (let k = 1; k <= 8; k++) {
        const t = k / 8;
        const a = (1 - t) ** 3; const b = 3 * (1 - t) ** 2 * t; const c = 3 * (1 - t) * t * t; const d = t ** 3;
        pts.push([a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]]);
      }
    } else pts.push(s.p);
  }
  return pts;
}

function along(pts, frac) {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const want = lens[lens.length - 1] * frac;
  let i = 1;
  while (i < pts.length - 1 && lens[i] < want) i++;
  const seg = lens[i] - lens[i - 1] || 1;
  const t = (want - lens[i - 1]) / seg;
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
}

const FRACTIONS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.12, 0.88];
const NUDGES = [8, 16, 24, 32].flatMap((d) => [[0, -d], [0, d], [d, 0], [-d, 0]]);
const labelSize = (lines) => ({ w: Math.max(...lines.map((l) => l.length)) * ECHAR + 4, h: lines.length * LINE });

/**
 * Model + analysis -> geometry. Every flow lands in exactly one drawn edge (`edges[].flows`), and
 * flows between the same two nodes share one edge. `crossings` counts crossings between consecutive
 * ranks; `collisions` counts edge labels that could not be placed clear of every element and label.
 */
export function layout(model, analysis, { orientation = 'auto', transpose: doTranspose = true } = {}) {
  if (!ORIENTATIONS.includes(orientation)) throw new Error(`orientation is one of ${ORIENTATIONS.join(', ')}, got ${orientation}`);
  if (orientation !== 'auto') return build(model, analysis, orientation, doTranspose);
  const lr = build(model, analysis, 'LR', doTranspose);
  if (lr.width <= AUTO_TB_WIDTH) return lr;
  const tb = build(model, analysis, 'TB', doTranspose);
  return tb.width < lr.width ? tb : lr;
}

const glyphOf = (nd) => (nd.kind === 'store' ? STORE_GLYPH : nd.kind === 'external' ? EXT_GLYPH : {})[nd.subtype];

function build(model, analysis, orientation, doTranspose) {
  const TB = orientation === 'TB';
  const nodes = model.nodes;
  const n = nodes.length;
  const ix = new Map(nodes.map((nd, i) => [nd.id, i]));
  const flows = model.flows;
  const aRank = analysis.nodes.map((a) => a.rank);
  const P = (u, v) => (TB ? [v, u] : [u, v]);

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
    b.existence = existenceOf(b.flows.map((k) => flowExistence(flows[k])));
    b.role = roleOf(b.flows.map((k) => flows[k].role || 'data'));
    b.label = [...new Set(b.flows.map((k) => flows[k].label).filter(Boolean))].join(' / ');
    const shown = b.label ? `${ROLE_MARK[b.role] || ''}${b.label}` : '';
    b.lines = shown ? wrap(shown, EDGE_LINE) : [];
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
  if (doTranspose) transpose(cols);
  const crossings = countCrossings(cols);

  // ── coordinates, as (u along the ranks, v across them); P() turns them into (x, y) ───────────
  const lines = nodes.map((nd) => wrap(nd.label));
  const widths = nodes.map((nd, i) => Math.max(NODE_MIN, Math.min(NODE_MAX + GLYPH_W,
    Math.round(Math.max(...lines[i].map((l) => l.length)) * CHAR + 46 + (glyphOf(nd) ? GLYPH_W : 0)))));
  const du = (i) => (TB ? NODE_H : widths[i]);
  const dv = (i) => (TB ? widths[i] : NODE_H);
  const fb = feedbacks.length;
  const riserIn = RISER_IN[orientation];
  const colSize = cols.map((col) => Math.max(24, ...col.filter((it) => it.node >= 0).map((it) => du(it.node))));
  // a gutter holds the feedback risers and the label of every flow that starts on its near side
  const gutters = cols.map(() => (TB ? Math.max(76, fb ? RISER_OUT + riserIn + 12 * fb + 8 : 0) : Math.max(96, 52 + 12 * fb)));
  for (const b of bundles) {
    if (b.self || b.cls === 'fb' || !b.lines.length) continue;
    const s = labelSize(b.lines);
    gutters[rank[b.a]] = Math.max(gutters[rank[b.a]], Math.round(TB ? s.h + 44 : s.w + 26));
  }
  const left = TB ? Math.max(40, riserIn + 6 * fb + 8) + (layerNames.length ? 22 : 0)
    : Math.max(40, 28 + 6 * fb) + (layerNames.length ? 70 : 0);
  const colU = [];
  colSize.forEach((w, r) => { colU.push(r === 0 ? left : colU[r - 1] + colSize[r - 1] + gutters[r - 1]); });
  const uEnd = colU[ranks - 1] + colSize[ranks - 1] + Math.max(40, 28 + 6 * fb);
  const bodyTop = 22 + TRACK * fb + 26;

  const slot = laneNames.map((_, l) => {
    const inLane = items.filter((it) => it.lane === l).map((it) => dv(it.node));
    return TB ? Math.max(NODE_MIN, ...inLane) + 36 : NODE_H + 40;
  });
  const rows = laneNames.map((_, l) => Math.max(1, ...cols.map((col) => col.filter((it) => it.lane === l).length)));
  const laneTop = [];
  rows.forEach((_, l) => { laneTop.push(l === 0 ? bodyTop : laneTop[l - 1] + rows[l - 1] * slot[l - 1] + 2 * LANE_PAD); });
  const vEnd = laneTop[rows.length - 1] + rows[rows.length - 1] * slot[rows.length - 1] + 2 * LANE_PAD + 8;
  for (const col of cols) {
    for (let l = 0; l < laneNames.length; l++) {
      const inLane = col.filter((it) => it.lane === l);
      inLane.forEach((it, k) => { it.cv = laneTop[l] + LANE_PAD + ((rows[l] - inLane.length) / 2 + k + 0.5) * slot[l]; });
    }
  }
  const [width, height] = P(uEnd, vEnd);
  const uvBox = nodes.map((nd, i) => ({ u: colU[rank[i]] + (colSize[rank[i]] - du(i)) / 2, v: items[i].cv - dv(i) / 2, du: du(i), dv: dv(i) }));
  const boxes = nodes.map((nd, i) => {
    const [x, y] = P(uvBox[i].u, uvBox[i].v);
    const [w, h] = P(uvBox[i].du, uvBox[i].dv);
    return { id: nd.id, ref: refs[i], kind: nd.kind, rank: rank[i], lane: laneNames[items[i].lane], x, y, w, h, lines: lines[i] };
  });

  // ── ports: flows leave on the far side and arrive on the near side, spread apart ───────────────
  const outs = nodes.map(() => []);
  const ins = nodes.map(() => []);
  bundles.forEach((b, bi) => {
    if (b.self) return;
    if (b.cls === 'fb') { outs[b.from].push({ bi, toward: -Infinity }); ins[b.to].push({ bi, toward: -Infinity }); return; }
    outs[b.a].push({ bi, toward: b.chain[1].cv });
    ins[b.b].push({ bi, toward: b.chain[b.chain.length - 2].cv });
  });
  const portV = new Map();
  const spread = (list, i, side) => {
    list.sort((p, q) => (p.toward - q.toward) || (p.bi - q.bi));
    const step = list.length > 1 ? (TB ? Math.min(16, (widths[i] - 24) / (list.length - 1)) : Math.min(9, (NODE_H - 14) / (list.length - 1))) : 0;
    list.forEach((p, k) => portV.set(`${side}${p.bi}`, items[i].cv + (k - (list.length - 1) / 2) * step));
  };
  outs.forEach((list, i) => spread(list, i, 'o'));
  ins.forEach((list, i) => spread(list, i, 'i'));

  // ── edges ─────────────────────────────────────────────────────────────────────────────────────
  const xy = (pt) => `${num(pt[0])},${num(pt[1])}`;
  const edges = bundles.map((b, bi) => {
    const base = { flows: b.flows, cls: b.cls, mode: b.mode, existence: b.existence, role: b.role, label: b.label, lines: b.lines };
    if (b.self) {
      const bx = boxes[b.lo];
      const x1 = bx.x + bx.w - 36;
      const x2 = bx.x + bx.w - 10;
      // the label stands above its own box, ending at the loop: never in a gutter a riser uses
      const shown = b.label ? wrap(`${ROLE_MARK[b.role] || ''}${b.label}`, Math.max(8, Math.floor((x1 - 4 - bx.x) / ECHAR))) : [];
      return { ...base, lines: shown, from: bx.id, to: bx.id, heads: 'end', anchor: 'end', self: { x: x1 - 4, y: bx.y - 4 },
        d: `M${num(x1)},${num(bx.y)} C${num(x1)},${num(bx.y - 26)} ${num(x2)},${num(bx.y - 26)} ${num(x2)},${num(bx.y)}` };
    }
    if (b.cls === 'fb') {
      const u = uvBox[b.from];
      const v = uvBox[b.to];
      const vt = 22 + TRACK * b.track;
      const ur = colU[rank[b.from]] + colSize[rank[b.from]] + RISER_OUT + 6 * b.track;
      const ul = colU[rank[b.to]] - riserIn - 6 * b.track;
      const v1 = portV.get(`o${bi}`);
      const v2 = portV.get(`i${bi}`);
      const pts = [P(u.u + u.du, v1), P(ur, v1), P(ur, vt), P(ul, vt), P(ul, v2), P(v.u, v2)];
      return { ...base, from: nodes[b.from].id, to: nodes[b.to].id, heads: 'end', anchor: 'middle', track: TB ? pts[2][0] : pts[2][1],
        risers: [[pts[1], pts[2]], [pts[3], pts[4]]], pts, d: roundedPath(pts) };
    }
    const a = uvBox[b.a];
    const z = uvBox[b.b];
    let u = a.u + a.du;
    let v = portV.get(`o${bi}`);
    const pieces = [{ p: P(u, v) }];
    const hop = (u2, v2) => {
      const k = (u2 - u) / 2;
      pieces.push({ c: [P(u + k, v), P(u2 - k, v2)], p: P(u2, v2) });
      u = u2; v = v2;
    };
    for (const dummy of b.chain.slice(1, -1)) {
      hop(colU[dummy.rank], dummy.cv);
      u = colU[dummy.rank] + colSize[dummy.rank];
      pieces.push({ p: P(u, v) });
    }
    hop(z.u, portV.get(`i${bi}`));
    const d = pieces.map((s, i) => (i === 0 ? `M${xy(s.p)}` : s.c ? `C${xy(s.c[0])} ${xy(s.c[1])} ${xy(s.p)}` : `L${xy(s.p)}`)).join(' ');
    // a forward flow always runs from the lower rank, so only a two-way pair takes a head at its start
    return { ...base, from: nodes[b.a].id, to: nodes[b.b].id, heads: b.cls === 'bi' ? 'both' : b.cls === 'fwd' ? 'end' : 'none', anchor: 'middle', pts: sample(pieces), d };
  });

  // ── bands and boundary hulls ──────────────────────────────────────────────────────────────────
  const bands = laneNames.map((name, l) => {
    const [x, y] = P(4, laneTop[l]);
    const [w, h] = P(TB ? height - 8 : width - 8, rows[l] * slot[l] + 2 * LANE_PAD);
    return { name, x, y, w, h };
  }).filter((b) => b.name !== null);
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
    const meets = (r) => r.x < hull.x2 && r.x2 > hull.x && r.y < hull.y2 && r.y2 > hull.y;
    const blocked = boxes.some((b, i) => nodes[i].group !== g && meets({ x: b.x, y: b.y, x2: b.x + b.w, y2: b.y + b.h })) || hulls.some(meets);
    // a boundary that cannot be drawn without enclosing a stranger is named under each member instead
    if (blocked) loose.add(g);
    else hulls.push(hull);
  }
  boxes.forEach((b, i) => { if (loose.has(nodes[i].group)) b.caption = declared.get(nodes[i].group)?.label || nodes[i].group; });

  // ── labels: self-loops, then feedback, then the rest; first clear spot along the edge ─────────
  const obstacles = [
    ...boxes.map((b) => grow({ x: b.x, y: b.y, w: b.w, h: b.h }, 2)),
    ...boxes.filter((b) => b.caption).map((b) => ({ x: b.x + b.w / 2 - 50, y: b.y + b.h + 2, w: 100, h: 12 })),
    ...hulls.map((h) => ({ x: h.x + 4, y: h.y + 2, w: Math.min(h.x2 - h.x - 8, h.label.length * ECHAR + 4), h: 12 })),
    // a riser is a line, but one a label would sit on for its whole width
    ...edges.filter((e) => e.risers).flatMap((e) => e.risers.map(([[x1, y1], [x2, y2]]) => ({ x: Math.min(x1, x2) - 2, y: Math.min(y1, y2) - 2, w: Math.abs(x2 - x1) + 4, h: Math.abs(y2 - y1) + 4 }))),
  ];
  const placed = [];
  const inside = (r) => r.x >= 2 && r.y >= 2 && r.x + r.w <= width - 2 && r.y + r.h <= height - 2;
  const clear = (r) => inside(r) && !obstacles.some((o) => hits(o, r)) && !placed.some((o) => hits(grow(o, 1), r));
  let collisions = 0;
  const put = (e, candidates, nudge) => {
    let box = candidates.find(clear);
    if (!box && nudge) {
      for (const r of candidates) {
        box = NUDGES.map(([dx, dy]) => ({ ...r, x: r.x + dx, y: r.y + dy })).find(clear);
        if (box) break;
      }
    }
    if (!box) { box = candidates[0]; collisions++; }
    placed.push(box);
    e.lbox = box;
    e.lx = e.anchor === 'end' ? box.x + box.w - 2 : box.x + box.w / 2;
    e.ly = box.y + LINE - 3;
  };
  const order = [...edges.keys()].sort((p, q) => (rankOf(edges[p]) - rankOf(edges[q])) || (p - q));
  function rankOf(e) { return e.cls === 'self' ? 0 : e.cls === 'fb' ? 1 : 2; }
  for (const k of order) {
    const e = edges[k];
    if (!e.lines.length) continue;
    const s = labelSize(e.lines);
    if (e.self) {
      const at = { x: e.self.x - s.w, y: e.self.y - s.h, w: s.w, h: s.h };
      put(e, (TB ? [0, -6] : [0, -6, -12]).map((dy) => ({ ...at, y: at.y + dy })), false);
    } else {
      put(e, FRACTIONS.map((f) => {
        const [px, py] = along(e.pts, f);
        return { x: px - s.w / 2, y: py - s.h / 2, w: s.w, h: s.h };
      }), true);
    }
  }
  for (const e of edges) { delete e.pts; delete e.self; }

  return { orientation, width, height, crossings, collisions, nodes: boxes, edges, bands, hulls, ranks: cols.map((col) => col.map((it) => it.node)) };
}

// ── SVG ────────────────────────────────────────────────────────────────────────────────────────

const ring = (cx, cy, r) => `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`;
// each mark fits a 12 x 14 box whose top-left corner is (0, 0)
const STORE_GLYPH = Object.freeze({
  database: 'M0,3 a6,2.5 0 0,0 12,0 a6,2.5 0 0,0 -12,0 v8 a6,2.5 0 0,0 12,0 v-8',
  broker: 'M0,2 l4,5 l-4,5 M4,2 l4,5 l-4,5 M8,2 l4,5 l-4,5',
  queue: 'M0,2 l4,5 l-4,5 M4,2 l4,5 l-4,5 M8,2 l4,5 l-4,5',
  topic: 'M0,2 l4,5 l-4,5 M4,2 l4,5 l-4,5 M8,2 l4,5 l-4,5',
  stream: 'M0,2 l4,5 l-4,5 M4,2 l4,5 l-4,5 M8,2 l4,5 l-4,5',
  log: 'M0,3 h12 M0,7 h12 M0,11 h8',
  file: 'M1,1 h7 l4,4 v8 h-11 z M8,1 v4 h4',
});
const EXT_GLYPH = Object.freeze({
  endpoint: `${ring(6, 7, 6)} M6,1 a2.5,6 0 0,0 0,12 a2.5,6 0 0,0 0,-12 M0,7 h12`,
  scheduler: `${ring(6, 7, 6)} M6,3 V7 H9`,
  actor: `${ring(6, 3.5, 2.5)} M1,13 a5,5 0 0,1 10,0`,
  system: 'M0,1 h12 v8 h-12 z M3,12.5 h6 M6,9 v3.5',
  env: 'M4,1 q-2,0 -2,2 v2.5 l-2,1.5 l2,1.5 v2.5 q0,2 2,2 M8,1 q2,0 2,2 v2.5 l2,1.5 l-2,1.5 v2.5 q0,2 -2,2',
  binary: 'M1,3 l4,4 l-4,4 M6,12 h6',
});
const glyphSvg = (d, x, y) => `<path class="gl" transform="translate(${num(x)},${num(y)})" d="${d}"/>`;

const MARKERS = ['ink', 'mut', 'fb', 'bad', 'hi'].map((c) => `<marker id="dfd-a-${c}" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="10" markerHeight="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path class="mk-${c}" d="M0,0 L10,4 L0,8 z"/></marker>`).join('');

const markerOf = (e) => (e.existence === 'contradicted' ? 'bad' : e.role === 'error' ? 'hi' : e.cls === 'fb' ? 'fb' : e.existence === 'unknown' ? 'mut' : 'ink');

// one <text> per label, a <tspan> per line
const textLines = (cls, x, y, anchor, ls, step = LINE) => `<text${cls ? ` class="${cls}"` : ''} x="${num(x)}" y="${num(y)}" text-anchor="${anchor}">${ls.length === 1 ? esc(ls[0])
  : ls.map((l, i) => `<tspan x="${num(x)}"${i ? ` dy="${step}"` : ''}>${esc(l)}</tspan>`).join('')}</text>`;

function nodeSvg(b, nd) {
  const glyph = glyphOf(nd);
  const tw = glyph ? b.w - GLYPH_W : b.w;
  const cx = b.x + tw / 2;
  const two = b.lines.length > 1;
  const sub = nd.subtype ? ` (${nd.subtype})` : '';
  const tip = `${b.ref} ${nd.kind}${sub}: ${nd.label}${nd.group ? ` — boundary ${nd.group}` : ''}${nd.layer ? ` — layer ${nd.layer}` : ''}${nd.note ? ` — ${nd.note}` : ''}`;
  const cls = `n ${nd.kind === 'process' ? 'proc' : nd.kind === 'store' ? 'store' : 'ext'}${nd.collapsed ? ' coll' : ''}${nd.unknown ? ' unk' : ''}`;
  let shape;
  if (nd.kind === 'process') {
    shape = `<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" rx="9"/>${nd.collapsed ? `<rect class="in" x="${num(b.x + 3)}" y="${num(b.y + 3)}" width="${num(b.w - 6)}" height="${num(b.h - 6)}" rx="7"/>` : ''}<line x1="${num(b.x)}" y1="${num(b.y + 15)}" x2="${num(b.x + b.w)}" y2="${num(b.y + 15)}"/>`
      + `<text class="ref" x="${num(b.x + b.w / 2)}" y="${num(b.y + 11.5)}" text-anchor="middle">${b.ref}</text>${textLines('', b.x + b.w / 2, b.y + (two ? 27 : 33.5), 'middle', b.lines, 11.5)}`;
  } else if (nd.kind === 'store') {
    shape = `<path d="M${num(b.x + b.w)},${num(b.y)} H${num(b.x)} V${num(b.y + b.h)} H${num(b.x + b.w)}"/><line x1="${num(b.x + 30)}" y1="${num(b.y)}" x2="${num(b.x + 30)}" y2="${num(b.y + b.h)}"/>`
      + `<text class="ref" x="${num(b.x + 15)}" y="${num(b.y + 26)}" text-anchor="middle">${b.ref}</text>${textLines('', b.x + 30 + (tw - 30) / 2, b.y + (two ? 20 : 26), 'middle', b.lines, 12)}`
      + `${glyph ? glyphSvg(glyph, b.x + b.w - GLYPH_W, b.y + 15) : ''}`;
  } else {
    shape = `<rect class="sh" x="${num(b.x + 4)}" y="${num(b.y + 4)}" width="${num(b.w)}" height="${num(b.h)}"/><rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}"/>`
      + `<text class="ref" x="${num(b.x + 6)}" y="${num(b.y + 12)}">${b.ref}</text>${textLines('', cx, b.y + (two ? 24 : 30), 'middle', b.lines, 12)}`
      + `${glyph ? glyphSvg(glyph, b.x + b.w - GLYPH_W, b.y + 4) : ''}`;
  }
  const cap = b.caption ? `<text class="cap" x="${num(b.x + b.w / 2)}" y="${num(b.y + b.h + 12)}" text-anchor="middle">‹${esc(clip(b.caption, 30))}›</text>` : '';
  return `<g class="${cls}" data-id="${esc(nd.id)}"><title>${esc(tip)}</title>${shape}${cap}</g>`;
}

const EXIST_CLASS = { unknown: 'unk', contradicted: 'bad', confirmed: 'ok' };

function edgeSvg(e, flows) {
  const m = markerOf(e);
  const cls = ['e', e.cls, e.mode, ...(EXIST_CLASS[e.existence] ? [EXIST_CLASS[e.existence]] : []), ...(e.role === 'data' ? [] : [`r-${e.role}`])].join(' ');
  const end = e.heads === 'none' ? '' : ` marker-end="url(#dfd-a-${m})"`;
  const start = e.heads === 'both' ? ` marker-start="url(#dfd-a-${m})"` : '';
  const word = { fwd: 'flow', bi: 'two-way flow', fb: 'feedback flow', self: 'retry loop', und: 'flow, direction not determined' }[e.cls];
  const dirs = [...new Set(e.flows.map((k) => flows[k].direction).filter(Boolean))];
  const facts = [e.mode, `existence ${e.existence}`, ...(e.role === 'data' ? [] : [`role ${e.role}`]), ...(dirs.length ? [`direction ${dirs.join('/')}`] : [])];
  const tip = `${word}: ${e.from} → ${e.to} (${facts.join(', ')})${e.label ? ` — ${e.label}` : ''}`;
  const label = e.lines.length ? textLines('el', e.lx, e.ly, e.anchor, e.lines) : '';
  return `<g class="${cls}" data-flows="${e.flows.join(',')}" data-from="${esc(e.from)}" data-to="${esc(e.to)}"><title>${esc(tip)}</title><path d="${e.d}"${start}${end}/>${label}</g>`;
}

export function renderSvg(model, lay) {
  const title = model.title || 'data flow diagram';
  const TB = lay.orientation === 'TB';
  const bands = lay.bands.map((b, i) => `<g class="band${i % 2 ? ' alt' : ''}"><rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}"/>`
    + `<text x="${num(TB ? b.x + 8 : 12)}" y="${num(TB ? b.y + 12 : b.y + 16)}">${esc(clip(b.name, 12))}</text></g>`).join('');
  const hulls = lay.hulls.map((h) => `<g class="hull ${h.boundary}"><rect x="${num(h.x)}" y="${num(h.y)}" width="${num(h.x2 - h.x)}" height="${num(h.y2 - h.y)}" rx="4"/><text x="${num(h.x + 6)}" y="${num(h.y + 12)}">${esc(clip(h.label, Math.floor((h.x2 - h.x - 12) / ECHAR)))}</text></g>`).join('');
  return `<svg class="dfd" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(lay.width)} ${num(lay.height)}" width="${num(lay.width)}" height="${num(lay.height)}" role="img" aria-labelledby="dfd-title dfd-desc">`
    + `<title id="dfd-title">${esc(title)}</title><desc id="dfd-desc">${lay.nodes.length} elements and ${model.flows.length} flows, drawn as ${lay.edges.length} edges, ranks ${TB ? 'top to bottom' : 'left to right'}. The tables after the diagram list every one.</desc>`
    + `<defs>${MARKERS}</defs>${bands}${hulls}`
    + `<g class="edges">${lay.edges.map((e) => edgeSvg(e, model.flows)).join('')}</g><g class="nodes">${lay.nodes.map((b, i) => nodeSvg(b, model.nodes[i])).join('')}</g></svg>`;
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
.dfd .n.coll .in{fill:none;stroke-width:1}
.dfd .n.unk rect,.dfd .n.unk path{stroke-dasharray:4 3;stroke:var(--mut)}
.dfd .n.unk text{font-style:italic;fill:var(--mut)}
.dfd .n path.gl{fill:none;stroke:var(--mut);stroke-width:1.1;stroke-dasharray:none}
.dfd .e path{fill:none;stroke:var(--ink);stroke-width:1.5}
.dfd .e.async path{stroke-dasharray:7 4}
.dfd .e.mixed path{stroke-dasharray:10 3 2 3}
.dfd .e.und path{stroke-dasharray:1 5;stroke-linecap:round;stroke-width:2}
.dfd .e.ok path{stroke-width:1.9}
.dfd .e.unk{opacity:.55}
.dfd .e.unk path{stroke:var(--mut);stroke-width:1}
.dfd .e.und.unk path{stroke-width:1.6}
.dfd .e.fb path{stroke:var(--acc2);stroke-width:2.4}
.dfd .e.fb.unk path{stroke-width:1.4}
.dfd .e.r-error path{stroke:var(--high);stroke-dasharray:5 2 1 2}
.dfd .e.r-retry path{stroke-dasharray:2 3;stroke-linecap:round}
.dfd .e.bad path{stroke:var(--crit)}
.dfd .el{fill:var(--mut);font-size:10px;paint-order:stroke;stroke:var(--panel);stroke-width:3px;stroke-linejoin:round}
.dfd .e.fb .el{fill:var(--acc2);font-weight:600}
.dfd .e.r-error .el{fill:var(--high);font-weight:600}
.dfd .mk-ink{fill:var(--ink)}.dfd .mk-mut{fill:var(--mut)}.dfd .mk-fb{fill:var(--acc2)}.dfd .mk-bad{fill:var(--crit)}.dfd .mk-hi{fill:var(--high)}
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
const legendGlyph = (kind, d) => legendSvg(`<g class="n ${kind}">${glyphSvg(d, 23, 5)}</g>`);
const LEGEND = `<ul class="legend">
<li>${legendSvg('<g class="n proc"><rect x="6" y="2" width="46" height="20" rx="6"/><line x1="6" y1="9" x2="52" y2="9"/></g>')} process</li>
<li>${legendSvg('<g class="n proc coll"><rect x="6" y="2" width="46" height="20" rx="6"/><rect class="in" x="9" y="5" width="40" height="14" rx="4"/></g>')} collapsed boundary (one node for a group)</li>
<li>${legendSvg('<g class="n store"><path d="M52,3 H6 V21 H52"/><line x1="18" y1="3" x2="18" y2="21"/></g>')} data store (D), broker or queue (Q)</li>
<li>${legendSvg('<g class="n ext"><rect class="sh" x="10" y="6" width="42" height="16"/><rect x="6" y="2" width="42" height="16"/></g>')} external entity</li>
<li>${legendGlyph('store', STORE_GLYPH.database)} database</li>
<li>${legendGlyph('store', STORE_GLYPH.queue)} broker, queue, topic or stream</li>
<li>${legendGlyph('store', STORE_GLYPH.log)} log</li>
<li>${legendGlyph('store', STORE_GLYPH.file)} file</li>
<li>${legendGlyph('ext', EXT_GLYPH.endpoint)} endpoint</li>
<li>${legendGlyph('ext', EXT_GLYPH.scheduler)} scheduler</li>
<li>${legendGlyph('ext', EXT_GLYPH.actor)} actor</li>
<li>${legendGlyph('ext', EXT_GLYPH.system)} system</li>
<li>${legendGlyph('ext', EXT_GLYPH.env)} environment</li>
<li>${legendGlyph('ext', EXT_GLYPH.binary)} binary</li>
<li>${legendLine('fwd sync', 'ink')} sync flow</li>
<li>${legendLine('fwd async', 'ink')} async or event flow</li>
<li>${legendLine('fwd mixed', 'ink')} both modes on one pair</li>
<li>${legendLine('bi sync', 'ink', 'both')} bidirectional</li>
<li>${legendLine('fb sync', 'fb')} feedback (routed outside the body)</li>
<li>${legendLine('fwd sync r-error', 'hi')} error flow (label marked ✕)</li>
<li>${legendLine('fwd sync r-retry', 'ink')} retry flow (label marked ↻)</li>
<li>${legendSvg('<g class="e self sync"><path d="M18,22 C18,2 40,2 40,22" marker-end="url(#dfd-a-ink)"/></g>')} retry loop</li>
<li>${legendLine('und sync', 'ink', 'none')} direction not determined</li>
<li>${legendLine('fwd sync ok', 'ink')} existence confirmed</li>
<li>${legendLine('fwd sync', 'ink')} declared, no evidence</li>
<li>${legendLine('fwd sync unk', 'mut')} existence unknown (lighter)</li>
<li>${legendLine('fwd sync bad', 'bad')} contradicted</li>
<li>${legendSvg('<g class="hull system"><rect x="4" y="3" width="50" height="18" rx="4"/></g>')} system boundary</li>
<li>${legendSvg('<g class="hull trust"><rect x="4" y="3" width="50" height="18" rx="4"/></g>')} trust boundary</li>
<li>${legendSvg('<g class="band"><rect x="4" y="3" width="50" height="18"/></g>')} maturity layer</li>
</ul>`;

const absent = (text) => `<span class="absent">${esc(text)}</span>`;
const list = (xs, empty = 'none') => (xs.length ? xs.map((x) => esc(x)).join('; ') : absent(empty));

function sourceBanner(model) {
  const s = model.source;
  const parts = [];
  if (!s) parts.push('Authored model. No producer is recorded, so every flow is as declared and none is verified here.');
  else {
    parts.push(`Producer: <code>${esc(s.producer)}</code>.`);
    if (s.note) parts.push(esc(s.note));
    if (s.graph) parts.push(`Flow graph of ${esc(s.graph.nodes)} nodes and ${esc(s.graph.edges)} edges${s.graph.generatedAt ? `, generated ${esc(s.graph.generatedAt)}` : ''}.`);
    if (s.omitted) parts.push(`Left out by the adapter: ${Object.entries(s.omitted).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(', ')}.`);
    if (s.filter) {
      const f = s.filter;
      const around = f.around ?? f.focus ?? null;
      const dir = f.direction && f.direction !== 'both' ? `, following flows ${f.direction === 'in' ? 'into' : 'out of'} the seeds only` : '';
      parts.push(`<strong>This is a subset.</strong> Filter: ${f.prefix == null ? '' : `prefix <code>${esc(f.prefix)}</code>, `}${around === null ? '' : `focus <code>${esc(around)}</code>, `}${esc(f.hops)} hop(s) from ${esc(f.seeds)} seed node(s)${dir}; ${esc(f.nodesOmitted)} nodes and ${esc(f.flowsOmitted)} flows are not shown.`);
    }
  }
  if (model.collapsedGroups) {
    parts.push(`<strong>Collapsed:</strong> ${model.collapsedGroups.map((c) => `${esc(c.label)} (${c.members} elements; ${c.internal} flow(s) inside it not drawn)`).join('; ')}. Flows across a collapsed boundary are merged per other end, mode and role, the count written ×n.`);
  }
  return `<p class="banner">${parts.join(' ')}</p>`;
}

/**
 * -> { html, csp, stats }. `csp` is the header form; the page carries the same policy in a meta
 * element. `collapse` names groups to draw as one node each; `orientation` is LR, TB or auto.
 */
export function renderHtml(input, { fonts = 'none', maxPaths = 200, collapse = [], orientation = 'auto' } = {}) {
  const model = collapseGroups(input, collapse);
  const analysis = analyse(model, { maxPaths });
  const lay = layout(model, analysis, { orientation });
  const ref = new Map(lay.nodes.map((b) => [b.id, b.ref]));
  const labels = new Map(model.nodes.map((nd) => [nd.id, nd.label]));
  const name = (id) => `${ref.get(id)} ${labels.get(id)}`;
  const title = model.title || 'data flow diagram';
  const classWord = { forward: 'forward', bidirectional: 'bidirectional', feedback: 'feedback', 'self-loop': 'retry loop', undirected: 'direction not determined' };

  const nodeRows = model.nodes.map((nd, i) => {
    const a = analysis.nodes[i];
    const roles = [a.fanOut > 1 ? `branch ×${a.fanOut}` : '', a.fanIn > 1 ? `merge ×${a.fanIn}` : '', analysis.sources.includes(nd.id) ? 'source' : '',
      analysis.sinks.includes(nd.id) ? 'sink' : '', a.cyclic ? 'in a cycle' : '', nd.unknown ? 'unknown' : '', nd.collapsed ? `collapsed group of ${nd.collapsed.members}` : ''].filter(Boolean);
    return `<tr><td class="m">${lay.nodes[i].ref}</td><td>${esc(nd.kind)}${nd.subtype ? ` · ${esc(nd.subtype)}` : ''}</td><td class="m">${esc(nd.label)}</td><td>${nd.group ? esc(nd.group) : absent('none')}</td><td>${nd.layer ? esc(nd.layer) : absent('none')}</td><td class="tnum">${a.rank}</td><td>${roles.length ? esc(roles.join(', ')) : ''}${nd.note ? ` <span class="absent">${esc(nd.note)}</span>` : ''}</td></tr>`;
  }).join('\n');
  const flowRows = model.flows.map((f, k) => {
    const ev = f.evidence;
    const refs = ev && ev.refs && ev.refs.length ? ` — ${esc(ev.refs[0])}${ev.refs.length > 1 ? ` (+${ev.refs.length - 1})` : ''}` : '';
    const existence = flowExistence(f);
    const evidence = existence === 'declared' ? absent('declared, no evidence')
      : `${existence === 'unknown' ? absent('existence unknown') : esc(existence)}${ev && ev.witness ? ` · ${esc(ev.witness)}` : ''}${refs}`;
    const role = f.role && f.role !== 'data' ? ` · ${esc(f.role)}` : '';
    return `<tr><td class="tnum">${k + 1}</td><td class="m">${esc(name(f.from))}</td><td>${isDirected(f) ? '→' : '—'}</td><td class="m">${esc(name(f.to))}</td><td>${esc(f.mode)}</td><td>${classWord[analysis.flowClass[k]]}${role}</td><td>${f.label ? esc(f.label) : ''}</td><td>${evidence}</td></tr>`;
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
<p class="sub">Data flow diagram, Gane–Sarson notation · dfd@${esc(model.v)} · ${model.nodes.length} elements, ${model.flows.length} flows · ranks ${lay.orientation === 'TB' ? 'top to bottom' : 'left to right'}</p>
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
  const stats = { orientation: lay.orientation, width: lay.width, height: lay.height, crossings: lay.crossings, collisions: lay.collisions, elements: model.nodes.length, flows: model.flows.length };
  return { html, csp: policy(["frame-ancestors 'self'"]), stats };
}
