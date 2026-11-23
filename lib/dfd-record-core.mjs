// lib/dfd-record-core.mjs — record view rules: lanes, hop columns, orthogonal routes, patch replay; imports nothing.

export function createRecordCore(M) {
  const GEO = Object.freeze({ laneHead: 150, col: 236, chipW: 160, rowW: 148, gap: 12, pad: 12, headH: 34, rowH: 18, rowGap: 3, indent: 12, corridorBase: 10, trackY: 6, trackX: 7, r: 5, arrow: 7 });
  const SEV = ['critical', 'high', 'medium', 'low', 'undetermined'];
  const STATES = ['open', 'fixed', 'proven', 'dismissed'];
  const STATE_WORD = { open: 'open', fixed: 'fixed, untested', proven: 'fixed, tested', dismissed: 'dismissed' };
  const LEVELS = ['tested', 'inspected', 'rescanned', 'asserted', 'none'];
  const LEVEL_WORD = { tested: 'test proof', inspected: 'source inspection', rescanned: 'clean rescan', asserted: 'assertion, unverified', none: 'no evidence recorded' };
  const MODES = [['group', 'Groups'], ['layer', 'Layers']];
  const ORDERS = [['sets', 'Change sets'], ['upstream', 'Upstream first'], ['tested', 'Tested first'], ['document', 'Document order']];
  const DIMS = [['changeset', 'Change set'], ['cwe', 'Weakness'], ['lane', 'Lane'], ['evidence', 'Evidence'], ['severity', 'Severity'], ['proof', 'Proof']];
  const r1 = (v) => Math.round(v * 10) / 10;
  const natural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
  const name = (x) => (x ? x.plain || x.label || x.title || x.id : '');
  const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };

  const nodes = M.nodes || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const flows = (M.flows || []).map((f, i) => ({ ...f, id: `f${i}` })).filter((f) => byId.has(f.from) && byId.has(f.to) && f.from !== f.to);
  const fById = new Map(flows.map((f) => [f.id, f]));
  const findings = M.findings || [];
  const patches = M.patches || [];
  const routes = M.routes || [];
  const layers = Array.isArray(M.layers) ? M.layers : [];
  const gById = new Map((M.groups || []).map((g) => [g.id, g]));
  const gOrder = new Map((M.groups || []).map((g, i) => [g.id, i]));
  const chain = (gid) => { const out = []; for (let g = gById.get(gid); g && out.length < 32 && !out.includes(g.id); g = gById.get(g.parent)) out.unshift(g.id); return out; };
  const outs = new Map(); const ins = new Map();
  for (const f of flows) { push(outs, f.from, f); push(ins, f.to, f); }
  const between = (e) => (e ? flows.filter((f) => f.from === e.from && f.to === e.to) : []);
  const existence = (f) => f.existence || (f.evidence && f.evidence.existence) || 'confirmed';
  const names = (k, f) => (k.findings || []).some((id) => id === f.id || id === String(f.id).split('@')[0]);
  const sevOf = (f) => (SEV.includes(f.severity) ? f.severity : 'undetermined');
  const levelOf = (k) => (k.evidence && LEVELS.includes(k.evidence.level) ? k.evidence.level : 'none');
  const proves = (k) => !!k.evidence && (k.evidence.level === 'tested' || [k.evidence.control, ...(k.evidence.controls || [])].some((c) => c && c.failsWithout && c.passesWith));
  const guardsOf = new Map(findings.map((f) => [f, patches.filter((k) => names(k, f))]));
  const findingsOf = new Map(patches.map((k) => [k, findings.filter((f) => names(k, f))]));
  const atFlow = (f) => (f.at && f.at.flow ? between(f.at.flow)[0] || null : null);
  const atNode = (f) => (f.at && f.at.node !== undefined && byId.has(f.at.node) ? f.at.node : null);
  const guardFlow = (k) => between(k.guard)[0] || null;

  const isSource = (n) => !ins.has(n.id) && outs.has(n.id);
  let sources = new Set(nodes.filter((n) => n.kind === 'external' && (n.subtype === 'actor' || n.subtype === 'endpoint') && isSource(n)).map((n) => n.id));
  if (!sources.size) sources = new Set(nodes.filter((n) => n.kind === 'external' && isSource(n)).map((n) => n.id));
  if (!sources.size) sources = new Set(nodes.filter(isSource).map((n) => n.id));
  if (!sources.size && nodes.length) sources = new Set([nodes[0].id]);
  const rejectTo = new Set(patches.flatMap((k) => (k.rejects || []).map((e) => e.to)));
  let outcomes = new Set(nodes.filter((n) => n.impact !== undefined || rejectTo.has(n.id)).map((n) => n.id));
  const outcomeRule = outcomes.size ? 'declared' : 'sinks';
  if (!outcomes.size) outcomes = new Set(nodes.filter((n) => n.kind !== 'process' && ins.has(n.id) && !outs.has(n.id)).map((n) => n.id));
  for (const id of outcomes) sources.delete(id);

  const hop = new Map([...sources].map((id) => [id, 0]));
  for (const q = [...sources]; q.length;) { const id = q.shift(); for (const f of outs.get(id) || []) if (!hop.has(f.to)) { hop.set(f.to, hop.get(id) + 1); q.push(f.to); } }
  const deepest = Math.max(0, ...hop.values());
  const unreached = nodes.some((n) => !hop.has(n.id));
  const nCols = deepest + 1 + (unreached ? 1 : 0);
  const colOf = (id) => (hop.has(id) ? hop.get(id) : deepest + 1);
  const homeOf = (f) => {
    const n = atNode(f);
    if (n) return n;
    const e = f.at && f.at.flow;
    if (!e) return null;
    if (byId.has(e.from) && !sources.has(e.from)) return e.from;
    return byId.has(e.to) ? e.to : byId.has(e.from) ? e.from : null;
  };

  const refKey = (r) => String(r || '').trim().split(/\s+/)[0].replace(/^\.\//, '').replace(/:.*$/, '');
  const declared = new Set((M.prs || []).map((p) => p.id));
  const sets = (M.prs || []).map((p) => ({ id: p.id, title: name(p), kind: 'pull request', patches: patches.filter((k) => k.pr === p.id) }));
  const rest = patches.filter((k) => !declared.has(k.pr));
  const up = rest.map((_, i) => i);
  const find = (i) => { while (up[i] !== i) i = up[i]; return i; };
  const link = (seen, key, i) => { if (!key) return; if (seen.has(key)) up[find(i)] = find(seen.get(key)); else seen.set(key, i); };
  const byCommit = new Map(); const byRef = new Map();
  rest.forEach((k, i) => { for (const c of k.commits || []) link(byCommit, String(c).slice(0, 12), i); });
  rest.forEach((k, i) => { if (!(k.commits || []).length) for (const r of (k.evidence && k.evidence.refs) || []) link(byRef, refKey(r), i); });
  const restSets = new Map();
  rest.forEach((k, i) => push(restSets, find(i), k));
  for (const list of restSets.values()) {
    const commits = [...new Set(list.flatMap((k) => (k.commits || []).map((c) => String(c).slice(0, 12))))];
    const refs = [...new Set(list.flatMap((k) => ((k.evidence && k.evidence.refs) || []).map(refKey)))].filter(Boolean);
    const id = commits.length ? `commits ${commits.join(', ')}` : refs.length ? refs.join(', ') : `patch ${list[0].id}`;
    const title = list.length === 1 ? name(list[0]) : commits.length ? id : refs[0].split('/').pop();
    sets.push({ id, title, kind: 'change set', patches: list });
  }
  const setAt = new Map();
  sets.forEach((s, i) => { for (const k of s.patches) setAt.set(k, i); });

  const hopOf = (k) => (k.guard && byId.has(k.guard.from) ? colOf(k.guard.from) : nCols);
  const orders = {
    sets: sets.flatMap((s) => s.patches),
    upstream: patches.slice().sort((a, b) => hopOf(a) - hopOf(b) || natural(a.id, b.id)),
    tested: patches.slice().sort((a, b) => Number(proves(b)) - Number(proves(a)) || natural(a.id, b.id)),
    document: patches.slice(),
  };
  const closers = new Map(patches.map((k) => [k, [...(k.closes || []), ...(k.rejects || [])].flatMap(between)]));
  const stateOf = (f, landed) => {
    if (f.status === 'dismissed') return 'dismissed';
    const gs = guardsOf.get(f);
    if (!gs.length) return f.status === 'mitigated' ? 'fixed' : 'open';
    const by = gs.filter((k) => landed.has(k));
    return !by.length ? 'open' : by.some(proves) ? 'proven' : 'fixed';
  };
  const stepCache = new Map();
  const step = (orderKey = 'sets', active = null, k = 0) => {
    const order = (orders[orderKey] || orders.sets).filter((p) => !active || active.has(p.id));
    const n = Math.max(0, Math.min(Number(k) || 0, order.length));
    const key = `${orderKey}|${order.map((p) => p.id).join(',')}|${n}`;
    if (stepCache.has(key)) return stepCache.get(key);
    if (stepCache.size > 500) stepCache.clear();
    const landed = new Set(order.slice(0, n));
    const closed = new Set();
    for (const p of landed) for (const f of closers.get(p)) closed.add(f.id);
    const open = (f) => !closed.has(f.id);
    const state = new Map(findings.map((f) => [f.id, stateOf(f, landed)]));
    const toOut = new Set(outcomes);
    for (let ch = true; ch;) { ch = false; for (const f of flows) if (open(f) && toOut.has(f.to) && !toOut.has(f.from)) { toOut.add(f.from); ch = true; } }
    const red = new Set();
    const exposed = new Set();
    const walk = (start) => {
      const seen = new Set([start]);
      for (const q = [start]; q.length;) {
        const id = q.shift();
        for (const f of outs.get(id) || []) if (open(f) && toOut.has(f.to)) { red.add(f.id); if (!seen.has(f.to) && !outcomes.has(f.to)) { seen.add(f.to); q.push(f.to); } }
      }
    };
    for (const f of findings) {
      if (state.get(f.id) !== 'open') continue;
      const e = atFlow(f); const at = atNode(f);
      if (e) { if (open(e) && toOut.has(e.to)) { red.add(e.id); if (!outcomes.has(e.to)) walk(e.to); } }
      else if (at) { if (outcomes.has(at)) exposed.add(at); else walk(at); }
    }
    for (const id of red) if (outcomes.has(fById.get(id).to)) exposed.add(fById.get(id).to);
    const out = { k: n, total: order.length, order: order.map((p) => p.id), patch: n ? order[n - 1].id : null, landed: new Set([...landed].map((p) => p.id)), closed, state, red, exposed, open: findings.filter((f) => state.get(f.id) === 'open').length };
    stepCache.set(key, out);
    return out;
  };

  const wrap = (text) => {
    const out = [];
    for (const w of String(text).split(/\s+/).filter(Boolean)) {
      for (let i = 0; i < w.length; i += 20) {
        const part = w.slice(i, i + 20); const last = out.length - 1;
        if (i === 0 && last >= 0 && out[last].length + 1 + part.length <= 20) out[last] += ` ${part}`; else out.push(part);
      }
    }
    return out.length ? out : [''];
  };
  const primOf = (n) => (n.subtype === 'actor' ? 'actor' : outcomes.has(n.id) ? 'outcome' : n.kind === 'process' ? 'process' : n.kind === 'store' ? (n.subtype === 'log' ? 'log' : 'store') : 'external');
  const laneMeta = (k) => {
    if (k === 'harness') return { name: 'Harness', sub: 'routes without a node, log drain', boundary: '' };
    if (k === 'l:') return { name: 'No layer', sub: 'outside every layer', boundary: '' };
    if (k.startsWith('l:')) return { name: k.slice(2), sub: 'layer', boundary: '' };
    if (k === 'g:') return { name: 'Ungrouped', sub: 'outside every group', boundary: '' };
    const g = gById.get(k.slice(2));
    return { name: name(g), sub: g.boundary ? `${g.boundary} boundary` : 'group', boundary: g.boundary || '' };
  };

  function build(mode) {
    const laneKey = mode === 'layer' ? (n) => (layers.includes(n.layer) ? `l:${n.layer}` : 'l:') : (n) => { const top = chain(n.group)[0]; return top ? `g:${top}` : 'g:'; };
    const U = new Map(); const units = [];
    const unit = (o) => ({ tray: [], tests: [], w: GEO.chipW, ...o });
    for (const n of nodes) {
      const lines = wrap(name(n));
      const u = unit({ type: 'node', id: n.id, node: n, prim: primOf(n), lines, h: Math.max(38, lines.length * 13 + 14), lk: laneKey(n), col: colOf(n.id) });
      U.set(n.id, u); units.push(u);
    }
    for (const f of findings) { const h = homeOf(f); if (h) U.get(h).tray.push({ id: f.id, finding: f }); }
    for (const u of units) u.tray.sort((a, b) => natural(a.id, b.id));
    const tests = routes.map((r) => {
      const host = U.get(r.node) || null;
      const t = unit({ type: 'route', id: r.id, route: r, prim: 'route', lines: [r.id], h: GEO.rowH, w: host ? GEO.rowW : GEO.chipW, lk: host ? host.lk : 'harness', col: host ? host.col : 0, host, stacked: !!host });
      if (host) host.tests.push(t); else units.push(t);
      return t;
    });
    const drained = [...new Set([...flows.filter((f) => f.role === 'error').map((f) => f.to), ...nodes.filter((n) => n.subtype === 'log').map((n) => n.id)])];
    const drain = drained.length ? unit({ type: 'drain', id: '', prim: 'drain', lines: ['Log drain'], h: 38, lk: 'harness', col: deepest + (unreached ? 1 : 0) }) : null;
    if (drain) units.push(drain);

    const keys = [...new Set(units.map((u) => u.lk))];
    const mean = (k) => { const cs = units.filter((u) => u.lk === k && u.type === 'node').map((u) => u.col); return cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : 0; };
    const rank = (k) => (k === 'harness' ? [2, 0, 0] : mode === 'layer' ? (k === 'l:' ? [1, 0, 0] : [0, layers.indexOf(k.slice(2)), 0]) : [0, mean(k), k === 'g:' ? 1e6 : gOrder.get(k.slice(2))]);
    const ranks = new Map(keys.map((k) => [k, rank(k)]));
    keys.sort((a, b) => { const x = ranks.get(a); const y = ranks.get(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
    const lanes = keys.map((k) => ({ key: k, ...laneMeta(k) }));
    const laneIndex = new Map(keys.map((k, i) => [k, i]));
    for (const u of units) u.lane = laneIndex.get(u.lk);
    for (const t of tests) if (t.stacked) t.lane = t.host.lane;

    const edges = flows.map((f) => ({ id: f.id, flow: f, from: U.get(f.from), to: U.get(f.to), existence: existence(f), label: f.label || '' }));
    if (drain) for (const id of drained) edges.push({ id: `d:${id}`, flow: null, from: U.get(id), to: drain, existence: 'confirmed', label: 'error or log output' });
    for (const e of edges) {
      e.crossing = !!e.flow && e.from.lane !== e.to.lane;
      e.kind = !e.flow ? 'drain' : e.flow.role === 'error' ? 'error' : e.flow.role === 'feedback' || e.flow.role === 'retry' ? 'return' : e.crossing ? 'cross' : 'in';
    }

    const cells = new Map();
    for (const u of units) push(cells, `${u.lane}:${u.col}`, u);
    const trayN = (u) => u.tray.length + u.tests.length;
    const unitH = (u) => u.h + (trayN(u) ? GEO.rowGap + trayN(u) * (GEO.rowH + GEO.rowGap) : 0);
    const cellH = (list) => list.reduce((a, u) => a + unitH(u), 0) + (list.length - 1) * GEO.gap;
    const colX = (c) => GEO.laneHead + c * GEO.col + (GEO.col - GEO.chipW) / 2;
    const gutterX = (c) => GEO.laneHead + c * GEO.col;
    let corridorH = lanes.map(() => GEO.corridorBase);
    let laneTop = []; let laneH = []; let gridH = 0;
    const place = () => {
      laneH = lanes.map((_, li) => corridorH[li] + GEO.pad * 2 + Math.max(38, ...[...cells].filter(([k]) => k.startsWith(`${li}:`)).map(([, l]) => cellH(l))));
      laneTop = []; let y = GEO.headH;
      for (const h of laneH) { laneTop.push(y); y += h; }
      gridH = y;
      for (const [k, list] of cells) {
        const [li, col] = k.split(':').map(Number);
        const bodyTop = laneTop[li] + corridorH[li] + GEO.pad; const bodyH = laneH[li] - corridorH[li] - GEO.pad * 2;
        let top = bodyTop + (bodyH - cellH(list)) / 2;
        for (const u of list) {
          u.x = colX(col); u.y = top;
          let ry = u.y + u.h + GEO.rowGap;
          for (const row of u.tray) { row.x = u.x + GEO.indent; row.y = ry; ry += GEO.rowH + GEO.rowGap; }
          for (const t of u.tests) { t.x = u.x + GEO.indent; t.y = ry; t.col = col; ry += GEO.rowH + GEO.rowGap; }
          top += unitH(u) + GEO.gap;
        }
      }
    };
    const nb = new Map(units.map((u) => [u, new Set()]));
    for (const e of edges) { nb.get(e.from).add(e.to); nb.get(e.to).add(e.from); }
    place();
    const byColumn = [...cells.values()].sort((a, b) => a[0].col - b[0].col);
    const yMid = (u) => u.y + u.h / 2;
    for (let s = 0; s < 6; s++) {
      for (const list of s % 2 ? byColumn.slice().reverse() : byColumn) {
        const bary = new Map(list.map((u) => { const ys = [...nb.get(u)].filter((m) => m.col !== u.col).map(yMid); return [u, ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : yMid(u)]; }));
        list.sort((a, b) => bary.get(a) - bary.get(b) || natural(a.id, b.id));
        place();
      }
    }

    const W = GEO.chipW;
    const route = () => {
      const sides = new Map();
      const addPort = (u, side, e, end) => { let m = sides.get(u); if (!m) { m = { L: [], R: [] }; sides.set(u, m); } m[side].push({ e, end }); };
      for (const e of edges) {
        e.shape = e.from.col < e.to.col ? 'fwd' : e.from.col === e.to.col ? 'same' : 'back';
        addPort(e.from, e.shape === 'back' ? 'L' : 'R', e, 'from');
        addPort(e.to, e.shape === 'fwd' ? 'L' : 'R', e, 'to');
      }
      const far = (p) => (p.end === 'from' ? p.e.to : p.e.from);
      for (const [u, m] of sides) {
        for (const list of [m.L, m.R]) {
          list.sort((p, q) => yMid(far(p)) - yMid(far(q)));
          const span = Math.max(0, u.h - 14); const stepY = list.length > 1 ? Math.min(9, span / (list.length - 1)) : 0;
          const y0 = yMid(u) - (stepY * (list.length - 1)) / 2;
          list.forEach((p, i) => { p.e[p.end === 'from' ? 'ya' : 'yb'] = y0 + i * stepY; });
        }
      }
      const vsegs = new Map(); const hsegs = new Map();
      const addV = (g, e, i, y1, y2) => push(vsegs, g, { e, i, lo: Math.min(y1, y2), hi: Math.max(y1, y2) });
      const addH = (li, e, i, x1, x2) => push(hsegs, li, { e, i, lo: Math.min(x1, x2), hi: Math.max(x1, x2) });
      for (const e of edges) {
        const a = e.from; const b = e.to; const { ya, yb } = e;
        const corridor = yb >= ya ? b.lane : a.lane;
        e.cl = undefined;
        if (e.shape === 'fwd' && b.col === a.col + 1) { e.plan = [['p', a.x + W, ya], ['g', b.col], ['p', b.x, yb]]; addV(b.col, e, 1, ya, yb); }
        else if (e.shape === 'fwd') { e.plan = [['p', a.x + W, ya], ['g', a.col + 1], ['c', corridor], ['g', b.col], ['p', b.x, yb]]; e.cl = corridor; }
        else if (e.shape === 'same') { e.plan = [['p', a.x + W, ya], ['g', a.col + 1], ['p', b.x + W, yb]]; addV(a.col + 1, e, 1, ya, yb); }
        else if (b.col + 1 === a.col) { e.plan = [['p', a.x, ya], ['g', a.col], ['p', b.x + W, yb]]; addV(a.col, e, 1, ya, yb); }
        else { e.plan = [['p', a.x, ya], ['g', a.col], ['c', corridor], ['g', b.col + 1], ['p', b.x + W, yb]]; e.cl = corridor; }
      }
      for (const e of edges) if (e.cl !== undefined) { const xs = e.plan.filter((s) => s[0] === 'g').map((s) => gutterX(s[1])); addH(e.cl, e, 2, xs[0], xs[1]); }
      const assign = (segs, gapBetween) => {
        segs.sort((p, q) => p.lo - q.lo || p.hi - q.hi);
        const ends = [];
        for (const s of segs) { let t = ends.findIndex((x) => x < s.lo - gapBetween); if (t < 0) { t = ends.length; ends.push(0); } ends[t] = s.hi; s.t = t; }
        return ends.length;
      };
      const need = lanes.map(() => 0);
      for (const [li, segs] of hsegs) { need[li] = assign(segs, 10); for (const s of segs) s.e.cy = laneTop[li] + 6 + s.t * GEO.trackY; }
      for (const e of edges) if (e.cl !== undefined) { addV(e.plan[1][1], e, 1, e.ya, e.cy); addV(e.plan[3][1], e, 3, e.cy, e.yb); }
      for (const e of edges) e.gx = {};
      for (const [g, segs] of vsegs) {
        const n = assign(segs, 6);
        // a crowded gutter narrows its track spacing instead of spilling tracks into the chip columns
        const stepX = Math.min(GEO.trackX, (GEO.col - GEO.chipW - 8) / Math.max(1, n));
        const slot = (t) => (t % 2 ? -1 : 1) * Math.ceil(t / 2) * stepX;
        const centre = g === 0 ? gutterX(0) + 14 : gutterX(g);
        for (const s of segs) s.e.gx[s.i] = centre + slot(s.t) - (n % 2 ? 0 : stepX / 2);
      }
      return need;
    };
    const want = route().map((n) => GEO.corridorBase + Math.max(0, n) * GEO.trackY);
    if (want.some((w, i) => w !== corridorH[i])) { corridorH = want; place(); route(); }

    const onFlow = new Map(); const guardOn = new Map();
    for (const f of findings.slice().sort((a, b) => natural(a.id, b.id))) { const e = atFlow(f); if (e) push(onFlow, e.id, f); }
    for (const k of patches) { const e = guardFlow(k); if (e) push(guardOn, e.id, k); }
    const markers = [];
    let maxX = 0;
    for (const e of edges) {
      const p = e.plan; const pts = [];
      if (p.length === 3) { const x = e.gx[1]; pts.push([p[0][1], p[0][2]], [x, p[0][2]], [x, p[2][2]], [p[2][1], p[2][2]]); }
      else { const x1 = e.gx[1]; const x2 = e.gx[3]; pts.push([p[0][1], p[0][2]], [x1, p[0][2]], [x1, e.cy], [x2, e.cy], [x2, p[4][2]], [p[4][1], p[4][2]]); }
      const P = pts.filter((q, i) => i === 0 || Math.abs(q[0] - pts[i - 1][0]) > 0.01 || Math.abs(q[1] - pts[i - 1][1]) > 0.01);
      e.pts = P;
      for (const q of P) maxX = Math.max(maxX, q[0]);
      const end = P[P.length - 1]; const prev = P[P.length - 2]; const dir = Math.sign(end[0] - prev[0]) || 1;
      const base = [end[0] - dir * GEO.arrow, end[1]];
      const Q = P.slice(0, -1).concat([base]);
      let d = `M${r1(Q[0][0])} ${r1(Q[0][1])}`;
      for (let i = 1; i < Q.length - 1; i++) {
        const a = Q[i - 1]; const c = Q[i]; const b = Q[i + 1];
        const l1 = Math.hypot(c[0] - a[0], c[1] - a[1]); const l2 = Math.hypot(b[0] - c[0], b[1] - c[1]);
        const rr = Math.min(GEO.r, l1 / 2, l2 / 2);
        const p1 = [c[0] - ((c[0] - a[0]) / (l1 || 1)) * rr, c[1] - ((c[1] - a[1]) / (l1 || 1)) * rr];
        const p2 = [c[0] + ((b[0] - c[0]) / (l2 || 1)) * rr, c[1] + ((b[1] - c[1]) / (l2 || 1)) * rr];
        d += ` L${r1(p1[0])} ${r1(p1[1])} Q${r1(c[0])} ${r1(c[1])} ${r1(p2[0])} ${r1(p2[1])}`;
      }
      e.d = `${d} L${r1(base[0])} ${r1(base[1])}`;
      e.arrow = `M${r1(end[0])} ${r1(end[1])} L${r1(base[0])} ${r1(base[1] - 3.5)} L${r1(base[0])} ${r1(base[1] + 3.5)} Z`;
      e.gate = '';
      if (e.crossing) {
        const dl = e.to.lane; const by = dl > e.from.lane ? laneTop[dl] : laneTop[dl] + laneH[dl];
        for (let i = 1; i < P.length; i++) {
          const a = P[i - 1]; const b = P[i];
          if (Math.abs(a[0] - b[0]) < 0.01 && (by - a[1]) * (by - b[1]) < 0) { e.gate = `M${r1(a[0] - 5)} ${r1(by - 2)} H${r1(a[0] + 5)} M${r1(a[0] - 5)} ${r1(by + 2)} H${r1(a[0] + 5)}`; break; }
        }
      }
      const segL = []; let total = 0;
      for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); segL.push(l); total += l; }
      const at = (t) => { let s = t * total; for (let i = 0; i < segL.length; i++) { if (s <= segL[i]) { const u = segL[i] ? s / segL[i] : 0; return [P[i][0] + (P[i + 1][0] - P[i][0]) * u, P[i][1] + (P[i + 1][1] - P[i][1]) * u]; } s -= segL[i]; } return P[P.length - 1]; };
      (onFlow.get(e.id) || []).forEach((f, i) => { const q = at(Math.min(0.9, 0.6 + 0.08 * i)); markers.push({ kind: 'finding', id: f.id, edge: e.id, x: r1(q[0]), y: r1(q[1]) }); });
      (guardOn.get(e.id) || []).forEach((k, i) => { const q = at(Math.max(0.08, 0.3 - 0.06 * i)); markers.push({ kind: 'patch', id: k.id, edge: e.id, x: r1(q[0]), y: r1(q[1]) }); });
    }
    const stems = [];
    for (const u of units) {
      const rows = [...u.tray, ...u.tests];
      if (!rows.length) continue;
      const last = rows[rows.length - 1];
      stems.push(`M${r1(u.x + 6)} ${r1(u.y + u.h)} V${r1(last.y + GEO.rowH / 2)}${rows.map((r) => ` M${r1(u.x + 6)} ${r1(r.y + GEO.rowH / 2)} H${r1(r.x)}`).join('')}`);
    }
    const cols = Array.from({ length: nCols }, (_, c) => ({
      x: GEO.laneHead + c * GEO.col + GEO.col / 2,
      text: c === 0 ? 'Sources' : c > deepest ? 'Not reached' : `Hop ${c}`,
      sub: c === 0 ? 'hop 0' : c > deepest ? 'from any source' : c === 1 ? 'first contact' : '',
    }));
    const laneName = new Map(nodes.map((n) => [n.id, lanes[U.get(n.id).lane].name]));
    return {
      mode, geo: GEO, cols, units, tests, drain, edges, markers, stems, laneName,
      lanes: lanes.map((l, i) => ({ ...l, top: laneTop[i], h: laneH[i], corridor: corridorH[i] })),
      width: Math.ceil(Math.max(GEO.laneHead + nCols * GEO.col + 12, maxX + 12)), height: Math.ceil(gridH + 8),
    };
  }
  const layoutCache = new Map();
  const layout = (mode) => {
    const m = MODES.some(([k]) => k === mode) ? mode : 'group';
    if (!layoutCache.has(m)) layoutCache.set(m, build(m));
    return layoutCache.get(m);
  };

  const audit = (mode) => {
    const L = layout(mode);
    const rects = [];
    for (const u of L.units) rects.push({ u, x: u.x, y: u.y, w: u.w, h: u.h });
    for (const t of L.tests) if (t.stacked) rects.push({ u: t, x: t.x, y: t.y, w: GEO.rowW, h: GEO.rowH });
    for (const u of L.units) for (const r of u.tray) rects.push({ u, x: r.x, y: r.y, w: GEO.rowW, h: GEO.rowH });
    let nan = 0; const through = []; const segs = [];
    for (const e of L.edges) {
      if (/NaN|undefined/.test(e.d + e.arrow + e.gate)) nan += 1;
      for (let i = 1; i < e.pts.length; i++) {
        const a = e.pts[i - 1]; const b = e.pts[i];
        segs.push({ e, a, b });
        const minx = Math.min(a[0], b[0]); const maxx = Math.max(a[0], b[0]); const miny = Math.min(a[1], b[1]); const maxy = Math.max(a[1], b[1]);
        for (const r of rects) if (r.u !== e.from && r.u !== e.to && maxx > r.x + 1 && minx < r.x + r.w - 1 && maxy > r.y + 1 && miny < r.y + r.h - 1) through.push(`${e.id} through ${r.u.type}:${r.u.id}`);
      }
    }
    let overlap = 0;
    const span = (p, q, k) => Math.min(Math.max(p.a[k], p.b[k]), Math.max(q.a[k], q.b[k])) - Math.max(Math.min(p.a[k], p.b[k]), Math.min(q.a[k], q.b[k]));
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const s = segs[i]; const t = segs[j];
        if (s.e === t.e) continue;
        const sv = Math.abs(s.a[0] - s.b[0]) < 0.01; const tv = Math.abs(t.a[0] - t.b[0]) < 0.01;
        if (sv && tv && Math.abs(s.a[0] - t.a[0]) < 0.5 && span(s, t, 1) > 2) overlap += 1;
        if (!sv && !tv && Math.abs(s.a[1] - t.a[1]) < 0.5 && span(s, t, 0) > 2 && s.e.from !== t.e.from && s.e.to !== t.e.to) overlap += 1;
      }
    }
    return { nan, through: through.length, overlap, hits: [...new Set(through)] };
  };

  const dimOf = (k, dim, mode) => {
    const fs = findingsOf.get(k);
    if (dim === 'cwe') return String((fs.find((f) => f.cwe) || {}).cwe || 'no CWE');
    if (dim === 'lane') return k.guard && byId.has(k.guard.to) ? layout(mode).laneName.get(k.guard.to) : 'no guarded flow';
    if (dim === 'evidence') return LEVEL_WORD[levelOf(k)];
    if (dim === 'severity') return SEV.find((s) => fs.some((f) => sevOf(f) === s)) || 'no finding';
    if (dim === 'proof') return proves(k) ? 'fails without, passes with' : 'no load-bearing test';
    return sets[setAt.get(k)].title;
  };
  const groupsOf = (dim, mode) => {
    const out = new Map();
    for (const k of orders.sets) push(out, dimOf(k, dim, mode), k.id);
    return [...out].map(([value, ids]) => ({ value, ids }));
  };

  const nodeName = (id) => (byId.has(id) ? name(byId.get(id)) : String(id));
  const edgeText = (e) => (e ? `${nodeName(e.from)} → ${nodeName(e.to)}` : '');
  const ref = (kind, id, text) => ({ kind, id, text });
  const fRef = (f) => ref('finding', f.id, `${f.id} ${f.title || ''}`.trim());
  const kRef = (k) => ref('patch', k.id, `${k.id} ${name(k) === k.id ? '' : name(k)}`.trim());
  const flowRef = (f, side) => ref('flow', f.id, side === 'in' ? `${nodeName(f.from)} — ${f.label || 'flow'}` : side === 'out' ? `${f.label || 'flow'} — ${nodeName(f.to)}` : edgeText(f));
  const sel = (kind, id) => {
    if (kind === 'node') return byId.get(id) || null;
    if (kind === 'flow') return fById.get(id) || null;
    if (kind === 'finding') return findings.find((f) => f.id === id) || null;
    if (kind === 'patch') return patches.find((k) => k.id === id) || null;
    if (kind === 'route') return routes.find((r) => r.id === id) || null;
    return null;
  };
  const detail = (kind, id, st) => {
    const x = sel(kind, id);
    if (!x) return null;
    const rows = (list) => list.filter((r) => r[1] !== undefined && r[1] !== null && r[1] !== '').map(([k, v]) => [k, String(v)]);
    if (kind === 'node') {
      return {
        kicker: [x.kind, x.subtype].filter(Boolean).join(' · '), title: name(x),
        rows: rows([['id', x.id], ['groups', chain(x.group).map((g) => name(gById.get(g))).join(' › ') || 'none'], ['layer', x.layer], ['hop', hop.has(x.id) ? hop.get(x.id) : 'not reached'], ['place', sources.has(x.id) ? 'source' : outcomes.has(x.id) ? 'outcome' : ''], ['impact', x.impact], ['note', x.note]]),
        links: [['Findings', findings.filter((f) => homeOf(f) === x.id).map(fRef)], ['Flows in', (ins.get(x.id) || []).map((f) => flowRef(f, 'in'))], ['Flows out', (outs.get(x.id) || []).map((f) => flowRef(f, 'out'))], ['Routes', routes.filter((r) => r.node === x.id).map((r) => ref('route', r.id, r.id))]],
      };
    }
    if (kind === 'flow') {
      const ev = x.evidence || {};
      return {
        kicker: `flow · ${x.role || 'data'}`, title: x.label || edgeText(x),
        rows: rows([['from', nodeName(x.from)], ['to', nodeName(x.to)], ['existence', existence(x)], ['witness', ev.witness], ['method', ev.method], ['state', st && st.closed.has(x.id) ? 'closed at this step' : st && st.red.has(x.id) ? 'on an open path to an outcome' : '']]),
        links: [['Ends', [ref('node', x.from, nodeName(x.from)), ref('node', x.to, nodeName(x.to))]], ['Findings', findings.filter((f) => atFlow(f) === x).map(fRef)], ['Guarded by', patches.filter((k) => guardFlow(k) === x).map(kRef)], ['Closed by', patches.filter((k) => closers.get(k).includes(x)).map(kRef)]],
      };
    }
    if (kind === 'finding') {
      const home = homeOf(x);
      return {
        kicker: `finding · ${sevOf(x)}`, title: `${x.id} ${x.title || ''}`.trim(),
        rows: rows([['cwe', x.cwe], ['status', x.status], ['state', st ? STATE_WORD[st.state.get(x.id)] : ''], ['where', atFlow(x) ? edgeText(atFlow(x)) : home ? nodeName(home) : 'not placed'], ['note', x.note]]),
        links: [['Sits on', home ? [ref('node', home, nodeName(home))] : []], ['Flow', atFlow(x) ? [flowRef(atFlow(x))] : []], ['Patches', guardsOf.get(x).map(kRef)]],
      };
    }
    if (kind === 'patch') {
      const ev = x.evidence || {}; const c = ev.control || (ev.controls || [])[0] || {};
      return {
        kicker: `patch · ${LEVEL_WORD[levelOf(x)]}`, title: name(x),
        rows: rows([['id', x.id], ['change set', sets[setAt.get(x)].title], ['guard', guardFlow(x) ? edgeText(guardFlow(x)) : x.guard ? `${x.guard.from} → ${x.guard.to}` : ''], ['proof', proves(x) ? 'fails without, passes with' : ''], ['test', c.test], ['landed', st ? (st.landed.has(x.id) ? 'yes, at this step' : 'not yet') : ''], ['caveat', x.caveat], ['note', x.note]]),
        links: [['Findings', findingsOf.get(x).map(fRef)], ['Guards', guardFlow(x) ? [flowRef(guardFlow(x))] : []], ['Closes', closers.get(x).map((f) => flowRef(f))]],
      };
    }
    return {
      kicker: `route · ${x.status || 'no status'}`, title: x.id,
      rows: rows([['claim', x.claim], ['node', x.node ? nodeName(x.node) : 'none (harness)'], ['test', x.test], ['harness', x.harness], ['would flip', x.would_flip], ['note', x.note]]),
      links: [['Node', byId.has(x.node) ? [ref('node', x.node, nodeName(x.node))] : []]],
    };
  };

  const focus = (kind, id) => {
    const edges = new Set(); const units = new Set();
    const addFlow = (f) => { if (f) { edges.add(f.id); units.add(f.from); units.add(f.to); } };
    const x = sel(kind, id);
    if (!x) return { edges, units };
    if (kind === 'node') { units.add(x.id); for (const f of [...(ins.get(x.id) || []), ...(outs.get(x.id) || [])]) addFlow(f); }
    else if (kind === 'flow') addFlow(x);
    else if (kind === 'finding') { addFlow(atFlow(x)); if (homeOf(x)) units.add(homeOf(x)); }
    else if (kind === 'patch') { addFlow(guardFlow(x)); for (const f of closers.get(x)) addFlow(f); for (const f of findingsOf.get(x)) if (homeOf(f)) units.add(homeOf(f)); }
    else if (byId.has(x.node)) units.add(x.node);
    return { edges, units };
  };

  const tables = (st) => ({
    flows: { head: ['From', 'To', 'Label', 'Role', 'Existence', 'Findings', 'Guards'], rows: flows.map((f) => ({ kind: 'flow', id: f.id, cls: st && st.red.has(f.id) ? 'red' : st && st.closed.has(f.id) ? 'closed' : '', cells: [nodeName(f.from), nodeName(f.to), f.label || '', f.role || 'data', existence(f), findings.filter((x) => atFlow(x) === f).map((x) => x.id).join(' '), patches.filter((k) => guardFlow(k) === f).map((k) => k.id).join(' ')] })) },
    findings: { head: ['Id', 'Title', 'Severity', 'CWE', 'Status', 'State', 'Where'], rows: findings.map((f) => ({ kind: 'finding', id: f.id, cls: st ? `st-${st.state.get(f.id)}` : '', cells: [f.id, f.title || '', sevOf(f), f.cwe || '', f.status || '', st ? STATE_WORD[st.state.get(f.id)] : '', atFlow(f) ? edgeText(atFlow(f)) : homeOf(f) ? nodeName(homeOf(f)) : 'not placed'] })) },
    patches: { head: ['Id', 'Title', 'Change set', 'Findings', 'Evidence', 'Proof', 'Guard'], rows: orders.sets.map((k) => ({ kind: 'patch', id: k.id, cls: st && st.landed.has(k.id) ? 'landed' : '', cells: [k.id, name(k), sets[setAt.get(k)].title, findingsOf.get(k).map((f) => f.id).join(' '), LEVEL_WORD[levelOf(k)], proves(k) ? 'yes' : 'no', guardFlow(k) ? edgeText(guardFlow(k)) : ''] })) },
    routes: { head: ['Id', 'Status', 'Claim', 'Node', 'Test'], rows: routes.map((r) => ({ kind: 'route', id: r.id, cls: `rs-${r.status || 'none'}`, cells: [r.id, r.status || '', r.claim || '', byId.has(r.node) ? nodeName(r.node) : 'harness', r.test || ''] })) },
  });

  const stats = () => ({
    elements: nodes.length, flows: flows.length, findings: findings.length, patches: patches.length, routes: routes.length, sets: sets.length,
    lanes: { group: layout('group').lanes.length, layer: layout('layer').lanes.length },
    sources: sources.size, outcomes: outcomes.size, outcomeRule, unplaced: findings.filter((f) => !homeOf(f)).length,
  });

  return {
    GEO, SEV, STATES, STATE_WORD, LEVELS, LEVEL_WORD, MODES, ORDERS, DIMS, title: M.title || '',
    sets, orders, sources, outcomes, outcomeRule, hop, nCols,
    layout, step, audit, groupsOf, dimOf, detail, focus, tables, stats, proves, homeOf, sevOf, levelOf, name, nodeName,
    finding: (id) => sel('finding', id), patch: (id) => sel('patch', id),
  };
}
