import { esc } from '../../lib/html-escape.mjs';
import { houseCss } from '../../lib/house-css.mjs';
import { followerScript } from '../../lib/theme-follower.mjs';

export const clip = (text, max) => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

const NODE_W = 144;
const NODE_H = 42;
const PAD = 28;
const MAX_W = 1200;
const INDENT = 30;
const ROW = NODE_H + 12;
const GAP_X = 44;
const GAP_Y = 40;

function reduce(edges) {
  const has = new Set(edges.map(([a, b]) => `${a}>${b}`));
  const outOf = new Map();
  for (const [a, b] of edges) outOf.set(a, [...(outOf.get(a) || []), b]);
  return edges.filter(([a, b]) => !(outOf.get(a) || []).some((c) => c !== b && has.has(`${c}>${b}`)));
}

export function layoutLattice({ objects, subs, groups, contested }) {
  const groupOf = new Map();
  for (const g of groups) for (const id of g) groupOf.set(id, g.join(' = '));
  const key = (id) => groupOf.get(id) || id;

  const orderEdges = reduce(
    [...new Set(subs.map(([s, g]) => `${key(s)}>${key(g)}`))]
      .map((e) => e.split('>'))
      .filter(([a, b]) => a !== b),
  );
  const contestedEdges = contested
    .filter((c) => objects[c.from] && objects[c.to])
    .map((c) => ({ from: key(c.from), to: key(c.to), basis: c.basis }));

  const drawn = new Set([...orderEdges.flat(), ...contestedEdges.flatMap((c) => [c.from, c.to])]);
  const parentsOf = new Map([...drawn].map((n) => [n, []]));
  const childrenOf = new Map([...drawn].map((n) => [n, []]));
  for (const [c, p] of orderEdges) { parentsOf.get(c).push({ node: p, contested: false }); childrenOf.get(p).push({ node: c, contested: false }); }
  for (const e of contestedEdges) { parentsOf.get(e.from).push({ node: e.to, contested: true }); childrenOf.get(e.to).push({ node: e.from, contested: true }); }
  for (const list of [...parentsOf.values(), ...childrenOf.values()]) list.sort((x, y) => x.node.localeCompare(y.node));

  // One cluster per root, children indented under their parent: a near-forest drawn this way has no crossing edges by construction.
  const roots = [...drawn].filter((n) => parentsOf.get(n).length === 0).sort();
  const clusters = roots.map((root) => {
    const rows = [];
    const walk = (node, depth, parent, contested, trail) => {
      const also = parent ? parentsOf.get(node).map((x) => x.node).filter((x) => x !== parent) : [];
      rows.push({ node, depth, parent, contested, also });
      if (trail.has(node)) return;
      for (const ch of childrenOf.get(node)) walk(ch.node, depth + 1, node, ch.contested, new Set([...trail, node]));
    };
    walk(root, 0, null, false, new Set());
    const depth = Math.max(...rows.map((r) => r.depth));
    return { root, rows, w: NODE_W + depth * INDENT, h: rows.length * ROW - (ROW - NODE_H) };
  });

  const placed = [];
  let cx = PAD;
  let cy = PAD;
  let lineH = 0;
  let width = PAD * 2;
  for (const cl of clusters) {
    if (cx > PAD && cx + cl.w > MAX_W - PAD) { cx = PAD; cy += lineH + GAP_Y; lineH = 0; }
    const at = new Map();
    cl.rows.forEach((r, i) => {
      const box = { x: cx + r.depth * INDENT, y: cy + i * ROW };
      at.set(`${r.parent}|${r.node}|${i}`, box);
      placed.push({ ...r, ...box, cluster: cl.root, index: i });
    });
    width = Math.max(width, cx + cl.w + PAD);
    cx += cl.w + GAP_X;
    lineH = Math.max(lineH, cl.h);
  }
  const height = cy + lineH + PAD;
  const pos = new Map();
  for (const r of placed) if (!pos.has(r.node)) pos.set(r.node, r);

  const unrelated = Object.keys(objects)
    .filter((id) => !drawn.has(key(id)))
    .map(key)
    .filter((k, i, arr) => arr.indexOf(k) === i)
    .sort();

  return { orderEdges, contestedEdges, pos, placed, width, height, unrelated, key };
}

export function renderLatticeHtml({ objects, subs, groups, contested, names, registryVersion, backed, now }) {
  const L = layoutLattice({ objects, subs, groups, contested });
  const nameOf = (k) => k.split(' = ').map((id) => `${id} ${names.get(id) || ''}`.trim()).join(' / ');
  const attrsOf = (k) => objects[k.split(' = ')[0]] || [];
  const backedRaw = new Set(backed.map(([s, g]) => `${s}>${g}`));
  const members = (k) => k.split(' = ');
  const isBacked = (c, p) => members(c).some((a) => members(p).some((b) => backedRaw.has(`${a}>${b}`)));
  const children = (k) => L.orderEdges.filter(([, p]) => p === k).map(([c]) => c);
  const up = (k) => L.orderEdges.filter(([c]) => c === k).map(([, p]) => p);

  const tip = (k) =>
    [
      nameOf(k),
      attrsOf(k).join(', ') || 'no fixed attributes',
      up(k).length ? `more specific than: ${up(k).join(', ')}` : '',
      children(k).length ? `more general than: ${children(k).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

  const parentBox = new Map();
  for (const r of L.placed) parentBox.set(`${r.cluster}|${r.index}`, r);
  const boxOf = (r) => {
    for (let i = r.index - 1; i >= 0; i--) {
      const cand = parentBox.get(`${r.cluster}|${i}`);
      if (cand.node === r.parent && cand.depth === r.depth - 1) return cand;
    }
    return null;
  };

  const connectors = L.placed
    .filter((r) => r.parent)
    .map((r) => {
      const p = boxOf(r);
      const spineX = p.x + 14;
      const midY = r.y + NODE_H / 2;
      const pts = `${r.x},${midY} ${spineX},${midY} ${spineX},${p.y + NODE_H}`;
      if (r.contested) {
        const e = L.contestedEdges.find((c) => c.from === r.node && c.to === r.parent);
        return `<g class="hit" tabindex="0" data-tip="${esc(`contested: ${r.node} mechanism-of ${r.parent}\n${e ? e.basis : ''}`)}"><polyline class="edge contested" points="${pts}"/><polyline class="edge-hit" points="${pts}"/></g>`;
      }
      const rca = isBacked(r.node, r.parent) ? 'backed by an rca mechanism-of edge' : 'no rca edge behind it';
      return `<g class="hit" tabindex="0" data-tip="${esc(`${r.node} carries ${r.parent}'s mechanism and is more specific\n${rca}`)}"><polyline class="edge" points="${pts}" marker-end="url(#arrow)"/><polyline class="edge-hit" points="${pts}"/></g>`;
    })
    .join('\n');

  const nodeSvg = L.placed
    .map((r) => {
      const title = [r.node, r.contested ? 'contested' : '', r.also.length ? `also under ${r.also.join(', ')}` : ''].filter(Boolean).join(' · ');
      const sub = clip(names.get(r.node.split(' = ')[0]) || '', 22);
      return `<g class="node hit${r.depth === 0 ? ' root' : ''}" tabindex="0" transform="translate(${r.x},${r.y})" data-tip="${esc(tip(r.node))}"><rect width="${NODE_W}" height="${NODE_H}" rx="6"/><text class="node-id" x="10" y="17">${esc(clip(title, 24))}</text><text class="node-name" x="10" y="33">${esc(sub)}</text></g>`;
    })
    .join('\n');

  const chips = L.unrelated
    .map((k) => `<li class="chip hit" tabindex="0" data-tip="${esc(tip(k))}">${esc(k)}</li>`)
    .join('');

  const rows = (list, cells) => list.map((r) => `<tr>${cells(r).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Failure taxonomy concept lattice</title>
${followerScript()}
<style>
${houseCss({ fonts: 'inline', weights: { sans: [400, 600], mono: [400] } })}
.viz-root { --surface-1: var(--bg); --surface-2: var(--panel2); --text-primary: var(--ink); --text-secondary: var(--mut); --text-muted: var(--dim); --border: var(--line); --series-1: #2a78d6; --series-2: #eb6834; }
html[data-mode=dark] .viz-root { --series-1: #3987e5; --series-2: #d95926; }
@media (prefers-color-scheme: dark) { html:not([data-mode]) .viz-root { --series-1: #3987e5; --series-2: #d95926; } }
body { margin: 0; }
.viz-root { background: var(--surface-1); color: var(--text-primary); font-size: .875rem; line-height: 1.45; padding: 1.5rem; min-height: 100vh; }
h1 { font-size: 1.125rem; margin: 0 0 4px; }
.meta, .note { color: var(--text-secondary); margin: 0 0 16px; max-width: 72ch; }
.legend { display: flex; gap: 24px; flex-wrap: wrap; margin: 0 0 12px; color: var(--text-secondary); }
.legend svg { vertical-align: middle; margin-right: 6px; }
.plot { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-1); }
svg text { font-family: inherit; }
.edge { stroke: var(--text-secondary); stroke-width: 2; fill: none; }
.edge.contested { stroke: var(--series-2); stroke-dasharray: 6 4; }
.edge-hit { stroke: transparent; stroke-width: 14; fill: none; }
.edge-label { fill: var(--text-secondary); font-size: .6875rem; }
#arrow path { fill: var(--text-secondary); }
.node rect { fill: var(--surface-2); stroke: var(--series-1); stroke-width: 2; }
.node.root rect { stroke-width: 3; }
.node-id { fill: var(--text-primary); font-size: .75rem; font-weight: 600; }
.node-name { fill: var(--text-secondary); font-size: .6875rem; }
.hit { cursor: default; outline: none; }
.hit:focus-visible rect, .node:hover rect { stroke-width: 3; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; padding: 0; margin: 8px 0 0; }
.chip { border: 1px solid var(--border); border-radius: 6px; padding: 2px 8px; color: var(--text-secondary); background: var(--surface-2); font-size: .75rem; }
.chip:hover, .chip:focus-visible { color: var(--text-primary); border-color: var(--text-muted); }
h2 { font-size: .9375rem; margin: 24px 0 4px; }
table { margin: .5rem 0 1rem; font-size: .8125rem; width: auto; }
th, td { text-align: left; padding: 4px 12px 4px 0; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--text-secondary); font-weight: 600; }
#tip { position: fixed; pointer-events: none; max-width: 360px; white-space: pre-wrap; background: var(--surface-2); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px; padding: .5rem .625rem; font-size: .75rem; box-shadow: 0 2px 10px rgba(0,0,0,.15); display: none; z-index: 10; }
</style>
</head>
<body>
<div class="viz-root">
<h1>Failure taxonomy concept lattice</h1>
<p class="meta">Registry v${esc(registryVersion)} · ${Object.keys(objects).length} encoded classes · ${L.orderEdges.length} cover edges · ${L.contestedEdges.length} contested rca edges${now ? ` · generated ${esc(now)}` : ''}</p>
<p class="note">An arrow from X to Y reads: X carries Y's failure mechanism and is more specific. This is the shared-mechanism relation, not strict predicate specialisation; raters showed the two diverge. Each cluster starts at a most general class, with more specific classes indented beneath it. Only cover edges are drawn, so an implied relation through an intermediate class has no bracket of its own. A class with two parents appears under each, marked also under.</p>
<div class="legend" role="list">
<span role="listitem"><svg width="36" height="10" aria-hidden="true"><line x1="0" y1="5" x2="36" y2="5" stroke="var(--text-secondary)" stroke-width="2"/></svg>more specific, carries the mechanism of</span>
<span role="listitem"><svg width="36" height="10" aria-hidden="true"><line x1="0" y1="5" x2="36" y2="5" stroke="var(--series-2)" stroke-width="2" stroke-dasharray="6 4"/></svg>contested rca edge, labelled, not reproduced</span>
<span role="listitem"><svg width="18" height="14" aria-hidden="true"><rect x="1" y="1" width="16" height="12" rx="3" fill="var(--surface-2)" stroke="var(--series-1)" stroke-width="2"/></svg>class with a relation drawn</span>
</div>
<div class="plot">
<svg width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}" role="img" aria-label="Hasse diagram of ${L.pos.size} classes, one cluster per most general class. The table view below lists every relation.">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
${connectors}
${nodeSvg}
</svg>
</div>
<h2>Classes outside the order (${L.unrelated.length})</h2>
<p class="note">Encoded and separated from every other class, but neither more general nor more specific than any of them.</p>
<ul class="chips">${chips}</ul>
<details open>
<summary><h2 style="display:inline">Table view</h2></summary>
<table><caption class="note" style="text-align:left">Cover edges</caption><thead><tr><th>More specific</th><th>More general</th><th>Behind it</th></tr></thead><tbody>
${rows(L.orderEdges, ([c, p]) => [nameOf(c), nameOf(p), isBacked(c, p) ? 'rca mechanism-of' : 'encoding only'])}
</tbody></table>
<table><caption class="note" style="text-align:left">Contested rca edges</caption><thead><tr><th>Edge</th><th>Evidence against</th></tr></thead><tbody>
${rows(L.contestedEdges, (c) => [`${c.from} mechanism-of ${c.to}`, c.basis])}
</tbody></table>
<table><caption class="note" style="text-align:left">Classes no attribute separates</caption><thead><tr><th>Group</th></tr></thead><tbody>
${rows(groups, (g) => [g.map((id) => `${id} ${names.get(id) || ''}`.trim()).join(' = ')])}
</tbody></table>
</details>
<div id="tip" role="tooltip"></div>
</div>
<script>
(() => {
  const tip = document.getElementById('tip');
  const show = (el, x, y) => { tip.textContent = el.dataset.tip; tip.style.display = 'block'; tip.style.left = Math.min(x + 14, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(y + 14, innerHeight - tip.offsetHeight - 8) + 'px'; };
  const hide = () => { tip.style.display = 'none'; };
  for (const el of document.querySelectorAll('.hit')) {
    el.addEventListener('pointermove', (e) => show(el, e.clientX, e.clientY));
    el.addEventListener('pointerleave', hide);
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); show(el, r.left, r.bottom); });
    el.addEventListener('blur', hide);
  }
})();
</script>
</body>
</html>
`;
}
