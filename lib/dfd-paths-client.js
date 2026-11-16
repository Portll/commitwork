// lib/dfd-paths-client.js — the script of the paths view (lib/dfd-paths-render.mjs inlines it).
//
// It reads the dfd@1 document the page embeds and draws it as source-to-impact paths: trust runs
// left to right, every path ends in the impact column, and state sits under and beside the lines so
// the lines keep the legend's meanings. A path is closed when any step on it is fixed by a patch in
// force or measured safe, unevaluated when a step was never measured, otherwise open
// (the rule itself is lib/dfd-paths-core.mjs createCore, inlined ahead of this file and tested).
//
// Coverage is a further layer, drawn only when the document carries any: a bar along the bottom of
// an element (line coverage; unmeasured is an empty dashed track, never 0%), a mark on a flow a test
// exercised or never exercised, a ring on the guard of a patch whose test fails without it and
// passes with it, and a table of gaps. A covered line is not a tested guard.
//
// The Timeline tab steps through the patches in document order; a patch's commits are shown, not
// used to order it (the page has no git). The Combinations tab applies any subset.
//
// Layout limits, stated rather than hidden: one band for every trust boundary, one column for
// everything else that is not a source or an impact, and a flow between two elements of one column
// is drawn straight, so it is clean only when they are adjacent.
/**
 * Draw the paths view into `document` and wire its controls. The page calls it once with its own
 * document and the createCore lib/dfd-paths-core.mjs declares (inlined ahead of this file); the
 * tests call it with a stand-in document, which is why nothing here reaches for a global.
 * `timers` is setInterval and clearInterval, for playback. Returns the core, so a caller can read
 * the view state, and `draw`.
 */
export function mountPathsView(document, createCore, timers = { set: (fn, ms) => setInterval(fn, ms), clear: (id) => clearInterval(id) }) {
  const M = JSON.parse(document.getElementById('dfd-data').textContent);
  const $ = (id) => document.getElementById(id);
  // both quote characters: the text goes into attributes as well as elements (bin/test/html-escape-contract.test.mjs)
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const core = createCore(M);
  const { num, GROUP, rootOf, SEV, pairKey, rejectPairs, closePairs, FLOWS, FB, inbound, outbound, realIn, plainId, counters, BROKERS, NODES, NB, REF, controlsOf, PROVEN, proofOf, PATCHES, PB, FINDINGS, CHIPS, shortFin, FLOOR, HAS_COV, measurable, pct, SEV_WORD, S, appliedSet, strongEv, exists, gateOf, MAX_PATHS, pathsOf, RANK, flowStates, related, STATUS_GATE, chipState, GLYPH, gateCls, chipWord, gapsOf, NW, GAP, Y0, W, CX, TR_OS, TR_DEV, B1, B1S, B2, B2S, MID23, hullRank, colOf, groupIndex, orderKey, SORTED, shortLabel, wrapL, roundedPath, hit, build, refPath, applySarif } = core;

  // ── drawing ──────────────────────────────────────────────────────────────────────────────────
  function nodeSvg(v, B) {
    const x = v.x, y = v.y, h = v.h, w = NW;
    const dim = B.rel ? !v.members.some((m) => B.rel.nd.has(m)) : false;
    let shape;
    if (v.kind === 'proc') shape = `<rect x="${x}" y="${num(y)}" width="${w}" height="${num(h)}" rx="9"/>${v.coll ? `<rect class="in" x="${x + 3}" y="${num(y + 3)}" width="${w - 6}" height="${num(h - 6)}" rx="7"/>` : ''}<line x1="${x}" y1="${num(y + 16)}" x2="${x + w}" y2="${num(y + 16)}"/>`;
    else if (v.kind === 'store') shape = `<path d="M${x + w},${num(y)} H${x} V${num(y + h)} H${x + w}"/><line x1="${x + 30}" y1="${num(y)}" x2="${x + 30}" y2="${num(y + h)}"/>`;
    else shape = `<rect class="sh" x="${x + 4}" y="${num(y + 4)}" width="${w}" height="${num(h)}"/><rect x="${x}" y="${num(y)}" width="${w}" height="${num(h)}"/>${v.coll ? `<rect class="in" x="${x + 3}" y="${num(y + 3)}" width="${w - 6}" height="${num(h - 6)}"/>` : ''}`;
    const store = v.kind === 'store';
    const ref = v.coll ? '' : `<text class="ref" x="${store ? x + 15 : x + 7}" y="${num(store ? y + h / 2 + 4 : y + 12)}" text-anchor="${store ? 'middle' : 'start'}">${esc(v.ref.length > 5 ? `${v.ref.slice(0, 4)}…` : v.ref)}</text>`;
    const cx = store ? x + 30 + (w - 30) / 2 : x + w / 2;
    const body = h - 16 - (v.counter ? 15 : 0) - B.pad;
    const ty = y + 16 + (body - v.lines.length * 12) / 2 + 9;
    const label = `<text x="${num(cx)}" y="${num(ty)}" text-anchor="middle">${v.lines.map((l, i) => `<tspan x="${num(cx)}"${i ? ' dy="12"' : ''}>${esc(l)}</tspan>`).join('')}</text>`;
    let counter = '';
    if (v.counter) {
      const t = v.tally, parts = [];
      if (t.live) parts.push(`<tspan class="c-live">! ${t.live} open</tspan>`);
      if (t.grey) parts.push(`<tspan class="c-grey">? ${t.grey} not evaluated</tspan>`);
      if (t.closed) parts.push(`<tspan class="c-closed">✓ ${t.closed}${t.live || t.grey ? '' : ' closed'}</tspan>`);
      if (t.rej && !t.live && !t.grey && !t.closed) parts.push(`<tspan class="c-closed">${t.rej} reject${t.rej > 1 ? 's' : ''}</tspan>`);
      if (!parts.length) parts.push('<tspan class="c-grey">no path</tspan>');
      counter = `<text class="cnt" x="${num(cx)}" y="${num(y + h - 6 - B.pad)}" text-anchor="middle">${parts.join('<tspan> · </tspan>')}</text>`;
    }
    let chips = '';
    if (!v.coll && CHIPS[v.id]) {
      let right = x + w - 4;
      for (const fid of CHIPS[v.id].slice().reverse()) {
        const g = chipState(v.id, fid, B.ap);
        const name = shortFin(fid);
        const text = `${name.length > 14 ? `${name.slice(0, 13)}…` : name} ${GLYPH[g.g]}`;
        const cw = text.length * 5.5 + 7;
        right -= cw;
        if (right < x + 30) break;
        chips += `<g class="chip ${gateCls(g)}" data-fin="${esc(fid)}" tabindex="0" role="button" aria-label="Trace ${esc(fid)}"><title>${esc(fid)}: ${esc(chipWord(g))} — select to trace</title><rect x="${num(right)}" y="${num(y + 2.5)}" width="${num(cw)}" height="11.5" rx="3"/><text x="${num(right + cw / 2)}" y="${num(y + 11.5)}" text-anchor="middle">${esc(text)}</text></g>`;
        right -= 3;
      }
    }
    let bar = '';
    if (B.pad && v.cv) {
      const c = v.cv, x0 = store ? x + 35 : x + 8, full = x + w - 8 - x0, yb = y + h - (v.coll ? 9 : 6.5);
      const wm = c.measured ? (full * c.measured) / (c.measured + c.unmeasured) - (c.unmeasured ? 2 : 0) : 0;
      const ratio = c.measured ? c.covered / c.total : 0;
      let tip;
      if (!c.measured) tip = v.coll ? `Coverage not measured for any of its ${c.unmeasured} element(s)` : 'Coverage not measured';
      else tip = `${v.coll ? `${c.measured} of ${c.measured + c.unmeasured} element(s) measured: ` : ''}lines ${c.covered} of ${c.total} (${pct(c.covered, c.total)})${c.bt ? `, branches ${c.bc} of ${c.bt} (${pct(c.bc, c.bt)})` : ''}${ratio < FLOOR ? `, below the ${pct(FLOOR, 1)} floor` : ''}${c.unmeasured && v.coll ? `; ${c.unmeasured} not measured` : ''}${c.source ? ` — ${c.source}` : ''}`;
      bar = `<g class="cv"><title>${esc(tip)}</title><rect class="cv-hit" x="${num(x0)}" y="${num(yb - 3)}" width="${num(full)}" height="9"/>`
        + (c.measured ? `<rect class="cv-track" x="${num(x0)}" y="${num(yb)}" width="${num(wm)}" height="3"/><rect class="cv-fill${ratio < FLOOR ? ' low' : ''}" x="${num(x0)}" y="${num(yb)}" width="${num(wm * ratio)}" height="3"/><line class="cv-floor" x1="${num(x0 + wm * FLOOR)}" y1="${num(yb - 1.5)}" x2="${num(x0 + wm * FLOOR)}" y2="${num(yb + 4.5)}"/>` : '')
        + (c.unmeasured ? `<rect class="cv-none" x="${num(x0 + (c.measured ? wm + 4 : 0))}" y="${num(yb)}" width="${num(full - (c.measured ? wm + 4 : 0))}" height="3"/>` : '') + '</g>';
    }
    return `<g class="n ${v.kind}${v.coll ? ' coll' : ''}${v.unk ? ' unk' : ''}${dim ? ' dim' : ''}" data-id="${esc(v.id)}"><title>${esc(v.coll ? v.label : `${v.ref}: ${v.label}`)}</title>${shape}${ref}${label}${counter}${chips}${bar}</g>`;
  }
  function placeLabel(pts, text, boxes, shift) {
    let best = null;
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; if (a[1] !== b[1]) continue; const len = Math.abs(b[0] - a[0]); if (!best || len > best.len) best = { y: a[1], x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), len }; }
    const w = text.length * 5.7 + 6;
    if (!best) { const a = pts[0], b = pts[pts.length - 1]; return { x: a[0] + 7 + (shift || 0), y: (a[1] + b[1]) / 2 + 3, anchor: 'start' }; }
    let fall = null;
    for (const dy of [-4, 11, -15, 22]) for (const fr of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      let c = best.x0 + best.len * fr;
      if (best.len > w) c = Math.max(best.x0 + w / 2, Math.min(best.x1 - w / 2, c));
      const box = { x: c - w / 2, y: best.y + dy - 9, w, h: 11 };
      if (!fall) fall = { c, dy, box };
      if (!boxes.some((o) => hit(o, box))) { boxes.push(box); return { x: c, y: best.y + dy, anchor: 'middle' }; }
    }
    boxes.push(fall.box);
    return { x: fall.c, y: best.y + fall.dy, anchor: 'middle' };
  }
  /** Where a flow's coverage mark sits: a little way along its longest level run, clear of the pip at its far end. */
  function markPoint(pts) {
    let best = null;
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; if (a[1] !== b[1]) continue; const len = Math.abs(b[0] - a[0]); if (!best || len > best.len) best = { a, b, len }; }
    if (!best) { const a = pts[0], b = pts[pts.length - 1]; return [(a[0] + b[0]) / 2 - 11, (a[1] + b[1]) / 2]; }
    const step = Math.min(best.len / 2, Math.max(11, best.len * 0.12));
    return [best.a[0] + Math.sign(best.b[0] - best.a[0]) * step, best.a[1]];
  }
  // change sets: the positions on the timeline where a run of patches of one set ends
  const ENDS = PATCHES.reduce((a, p, i) => { if (i === PATCHES.length - 1 || PATCHES[i + 1].set !== p.set) a.push(i + 1); return a; }, []);
  const setAt = (k) => ENDS.findIndex((e) => e >= k);
  /** The patches the last step landed: the whole of its change set up to here, or the one patch. */
  const landedNow = () => {
    if (!S.landed) return [];
    if (!S.bySet) return [S.landed];
    const i = setAt(S.k);
    return PATCHES.slice(i > 0 ? ENDS[i - 1] : 0, S.k).map((p) => p.id);
  };
  let LANDED = [];
  function draw() {
    const keep = document.activeElement && document.activeElement.id;
    LANDED = landedNow();
    const B = build();
    const V = B.V, E = B.E, H = B.H;
    const boxes = Object.values(V).map((v) => ({ x: v.x - 2, y: v.y - 2, w: NW + 8, h: v.h + 8 }));
    let halos = '', edges = '', pips = '', guards = '', labels = '', marks = '';
    const showLab = (e) => (B.rel ? e.on : B.level < 2 || E.length <= 14);
    // a guard and its tag sit on the last run into an element, or beside a same-column flow: labels keep clear of both
    const guardsOf = (e) => (B.level === 2 && e.flows.length === 1 ? PATCHES.filter((p) => p.guard === e.flows[0].id) : []);
    const tagOf = (p) => (p.fin.length ? shortFin(p.fin[0]) : p.id);
    for (const e of E) {
      const gs = guardsOf(e);
      if (!gs.length || e.vert) continue;
      const left = V[e.to].x - 18 - (gs.length - 1) * 24 - 9 - (gs.length === 1 ? tagOf(gs[0]).length * 4.8 : 8);
      boxes.push({ x: left, y: e.ty - 19, w: V[e.to].x - 8 - left, h: 28 });
    }
    for (const e of E) {
      const f0 = e.flows[0], single = e.flows.length === 1;
      const dim = e.on ? '' : ' dim';
      const stCls = e.state ? e.state.st : null;
      const just = S.mode === 'time' && LANDED.length > 0 && e.flows.some((f) => LANDED.some((id) => (f.by || []).includes(id) || (f.when || []).includes(id)));
      if (stCls && !e.rej) halos += `<path class="halo ${stCls}${e.weak ? ' weak' : ''}${e.crit && stCls !== 'closed' ? ' crit' : ''}${just ? ' just' : ''}${dim}" d="${e.d}"/>`;
      const role = single && f0.role === 'error' ? 'error' : null;
      const ex = single ? f0.ex : null;
      const marker = e.rej ? 'okc' : role ? 'hi' : ex === 'unk' ? 'mut' : 'ink';
      let text;
      if (single) text = `${role ? '✕ ' : ''}${f0.label}`;
      else { const c = { live: 0, grey: 0, closed: 0 }; for (const f of e.flows) { const s = B.fst.get(f.id); if (s) c[s.st]++; }
        text = e.rej ? `${e.flows.length} rejects` : `${e.flows.length} flows${c.live ? ` · ! ${c.live}` : ''}${c.grey ? ` · ? ${c.grey}` : ''}${c.closed ? ` · ✓ ${c.closed}` : ''}`; }
      const lab = (showLab(e) || just) && !!text;
      const gv = e.vert ? guardsOf(e) : [];
      const lp = placeLabel(e.pts, text, lab ? boxes : [], gv.length === 1 ? 30 + tagOf(gv[0]).length * 4.8 : gv.length * 34 + (gv.length ? 12 : 0));
      const elText = `<text class="el" x="${num(lp.x)}" y="${num(lp.y)}" text-anchor="${lp.anchor}">${esc(text)}</text>`;
      const cls = ['e', 'fwd', 'sync'].concat(ex ? [ex] : [], role ? ['r-error'] : [], e.rej ? ['rej'] : [], stCls === 'closed' && !e.rej ? ['cut'] : [], lab ? [] : ['nolab'], just ? ['just'] : []).join(' ');
      const tip = `${REF(e.flows[0].from)} → ${REF(e.flows[0].to)}: ${e.flows.map((f) => f.label).filter(Boolean).join(' / ')}${stCls ? ` — ${stCls === 'live' ? 'on an open path' : stCls === 'grey' ? 'on a path nobody has evaluated' : 'every path through it is closed'}` : ''}`;
      edges += `<g class="${cls}${dim}"><title>${esc(tip)}</title><path class="hit" d="${e.d}"/><path class="ln" d="${e.d}" marker-end="url(#dfd-a-${marker})"/>${lab ? '' : elText}</g>`;
      if (lab) labels += `<g class="${cls}${dim}">${elText}</g>`;
      if (B.pad) {
        const ms = e.flows.filter((f) => f.cov);
        if (ms.length) {
          const ex = ms.filter((f) => f.cov.exercised).length, all = ex === ms.length;
          const mp = markPoint(e.pts);
          let tip;
          if (single) tip = all ? `Exercised under test${f0.cov.tests && f0.cov.tests.length ? `: ${f0.cov.tests.join(', ')}` : ''}${f0.cov.witness ? ` (${f0.cov.witness})` : ''}` : `Measured${f0.cov.witness ? ` (${f0.cov.witness})` : ''}, and no test exercised it`;
          else tip = `${ex} of ${ms.length} measured flow(s) exercised under test; ${e.flows.length - ms.length} not measured`;
          marks += `<g class="fx ${all ? 'ex' : 'nx'}${dim}"><title>${esc(tip)}</title><rect x="${num(mp[0] - 3)}" y="${num(mp[1] - 3)}" width="6" height="6"/>${all ? '' : `<line x1="${num(mp[0] - 3)}" y1="${num(mp[1] + 3)}" x2="${num(mp[0] + 3)}" y2="${num(mp[1] - 3)}"/>`}</g>`;
        }
      }
      if (single && (f0.by || f0.gate || S.sarif[f0.id])) {
        const g = gateOf(f0, B.ap);
        const q = e.pts[e.pts.length - 1], p = e.pts[e.pts.length - 2];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, off = Math.min(len / 2, 19 + ((e.ti || 0) % 2) * 14);
        const px = q[0] - ((q[0] - p[0]) / len) * off, py = q[1] - ((q[1] - p[1]) / len) * off;
        pips += `<g class="pip ${gateCls(g)}${dim}"><title>${esc(f0.label)}: ${esc(chipWord(g))}${g.why ? ` — ${esc(g.why)}` : ''}${g.msg ? ` — ${esc(g.msg)}` : ''}</title><circle cx="${num(px)}" cy="${num(py)}" r="5.6"/><text x="${num(px)}" y="${num(py + 3)}" text-anchor="middle">${GLYPH[g.g]}</text></g>`;
      }
      if (B.level === 2 && single) {
        PATCHES.filter((p) => p.guard === f0.id).forEach((p, j, all) => {
          const mid = e.vert ? [(e.pts[0][0] + e.pts[e.pts.length - 1][0]) / 2, (e.pts[0][1] + e.pts[e.pts.length - 1][1]) / 2] : null;
          const gx = mid ? mid[0] + 16 + j * 34 : V[e.to].x - 18 - j * 24, gy = mid ? mid[1] : e.ty, on = B.ap.has(p.id);
          const k = mid ? 5 : 6;
          const mine = S.focus && (S.focus.path || S.focus.gap || (S.focus.patch ? S.focus.patch === p.id : p.fin.map(shortFin).includes(shortFin(S.focus.fin))));
          const gdim = B.rel ? !(B.rel.fl.has(f0.id) && mine) : false;
          const tag = tagOf(p);
          guards += `<g class="guard ${on ? `present${p.strong ? '' : ' weak'}` : 'absent'}${gdim ? ' dim' : ''}"><title>${esc(p.name)}: ${on ? `check present (${esc(p.ev)}${p.proven ? `, ${esc(p.proof)}: ${esc(p.proofRef)}` : ''})` : 'check missing'}</title>${B.pad && p.proven ? `<circle class="ring" cx="${num(gx)}" cy="${num(gy)}" r="${mid ? 7.6 : 9.5}"/>` : ''}<path d="M${num(gx)},${num(gy - k)} l${k},${k} l${-k},${k} l${-k},${-k} z"/><text x="${num(mid ? gx + 10 : gx)}" y="${num(mid ? gy + 3 : gy - 9)}" text-anchor="${mid ? 'start' : all.length > 1 ? 'middle' : 'end'}">${esc(all.length > 1 && tag.length > 4 ? tag.slice(0, 4) : tag)}</text></g>`;
        });
      }
    }
    let hulls = '';
    // one hull per top-level system boundary in the middle column
    const roots = new Map();
    for (const id of B.cols[1]) for (const m of V[id].members) { const r = NB[m].root; if (r === null) continue; const v = V[id]; const cur = roots.get(r) || { y0: Infinity, y1: -Infinity }; cur.y0 = Math.min(cur.y0, v.y); cur.y1 = Math.max(cur.y1, v.y + v.h); roots.set(r, cur); }
    for (const [r, box] of roots) hulls += `<g class="hull system"><rect x="${CX[1] - 10}" y="${num(box.y0 - 24)}" width="${NW + 20}" height="${num(box.y1 - box.y0 + 34)}" rx="4"/><text x="${CX[1] - 4}" y="${num(box.y0 - 12)}">${esc(GROUP.get(r).label)}</text></g>`;
    if (B.hasHull) {
      const os = { x: CX[2] - 16, y: B.hullTop, w: CX[5] + NW + 12 - (CX[2] - 16), h: B.osBottom + 14 - B.hullTop };
      const trustRoots = [...new Set(NODES.filter((n) => n.trust).map((n) => n.root))];
      const lines = wrapL(trustRoots.map((r) => GROUP.get(r).label).join(' · '), 98).slice(0, 2);
      hulls += `<g class="hull trust"><rect x="${os.x}" y="${num(os.y)}" width="${os.w}" height="${num(os.h)}" rx="4"/>${lines.map((l, i) => `<text x="${os.x + 6}" y="${num(os.y + 13 + i * 13)}">${esc(l)}</text>`).join('')}</g>`;
    }
    hulls += `<g class="hull"><text x="${CX[5]}" y="${num(Y0 - 12)}">impact (sink)</text>${B.cols[0].length ? `<text x="${CX[0]}" y="${num(V[B.cols[0][0]].y - 8)}">source</text>` : ''}</g>`;
    const levelName = ['context', 'boundaries', 'elements'][B.level];
    $('wrap').innerHTML = `<svg class="dfd" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${num(H)}" width="${W}" height="${num(H)}" role="img" aria-label="Data flow diagram at ${levelName} level: ${B.paths.length} paths from a source to an impact. The tables below list every path and patch.">${hulls}<g>${halos}</g><g class="edges">${edges}</g><g>${marks}</g><g>${guards}</g><g class="nodes">${Object.values(V).map((v) => nodeSvg(v, B)).join('')}</g><g>${pips}</g><g class="labels">${labels}</g></svg>`;
    panels(B);
    if (keep) { const el = $(keep); if (el && el !== document.activeElement) el.focus({ preventScroll: true }); }
  }

  // ── panels ───────────────────────────────────────────────────────────────────────────────────
  function decides(p) {
    if (!p.by) return 'Nothing stops it.';
    const f = p.by.f, g = p.by.gate;
    if (g.g === 'fixed') return `Fixed at ${REF(f.from)}: ${f.by.map((id) => PB[id].name).join(' + ')} (${g.ev}).`;
    if (g.g === 'safe') return `Measured non-exploitable at ${REF(f.from)} → ${REF(f.to)}: ${g.tool ? `${g.tool}: ${g.msg || 'pass'}` : g.why || g.ev}.`;
    return `Not evaluated at ${REF(f.from)} → ${REF(f.to)}${g.why ? `: ${g.why}` : ''}.`;
  }
  const pathPill = (p) => (p.st === 'live' ? '<span class="st live">! open</span>' : p.st === 'grey' ? '<span class="st grey">? not evaluated</span>'
    : p.by.gate.g === 'fixed' ? `<span class="st fixed${p.weak ? ' weak' : ''}">✓ fixed</span>` : `<span class="st safe${p.weak ? ' weak' : ''}">⊘ measured safe</span>`);
  function panels(B) {
    const P = B.paths, n = (st) => P.filter((p) => p.st === st).length;
    const fixed = P.filter((p) => p.st === 'closed' && p.by.gate.g === 'fixed'), safe = P.filter((p) => p.st === 'closed' && p.by.gate.g === 'safe');
    const crit = P.filter((p) => p.sev >= 4 && p.st !== 'closed');
    $('tiles').innerHTML =
      `<div class="tile live"><b>${n('live')}</b><span>open paths to an impact</span></div>`
      + `<div class="tile closed"><b>${fixed.length}</b><span>fixed by a patch (${fixed.filter((p) => !p.weak).length} tested, ${fixed.filter((p) => p.weak).length} not tested)</span></div>`
      + `<div class="tile closed"><b>${safe.length}</b><span>measured non-exploitable (${safe.filter((p) => p.weak).length} without a runtime proof)</span></div>`
      + `<div class="tile grey"><b>${n('grey')}</b><span>not evaluated</span></div>`
      + `<div class="tile ${crit.some((p) => p.st === 'live') ? 'live' : 'grey'}"><b>${crit.length}</b><span>critical and not closed</span></div>`
      + (P.length >= MAX_PATHS ? `<div class="tile grey"><b>${MAX_PATHS}+</b><span>paths: the list was cut, so every count here is a floor</span></div>` : '');
    const sorted = P.slice().sort((a, b) => RANK[a.st] - RANK[b.st] || b.sev - a.sev || a.id.localeCompare(b.id));
    $('paths').innerHTML = sorted.map((p) => `<tr data-row data-path="${esc(p.id)}" tabindex="0"${S.focus && S.focus.path === p.id ? ' class="on"' : ''}><td>${pathPill(p)}</td><td>${esc(NB[p.sink].label)} <span class="absent">${esc(NB[p.sink].impact)}</span></td><td class="m">${esc(refPath(p))}</td><td>${esc(decides(p))}</td></tr>`).join('') || '<tr><td colspan="4" class="absent">No element carries an impact, so no path ends anywhere.</td></tr>';
    $('patches').innerHTML = PATCHES.map((p, i) => {
      const closes = FLOWS.filter((f) => (f.by || []).includes(p.id));
      const on = B.ap.has(p.id);
      const g = p.guard ? FB[p.guard] : null;
      return `<tr data-row data-patch="${esc(p.id)}" tabindex="0"${S.focus && S.focus.patch === p.id ? ' class="on"' : ''}><td class="m">${i + 1}</td><td>${on ? '' : '<span class="st grey">not applied</span> '}${esc(p.name)}</td><td class="m">${esc(p.carrier)}</td><td class="m">${g ? `${esc(REF(g.from))} → ${esc(REF(g.to))}` : '<span class="absent">not recorded</span>'}</td><td class="m">${closes.length ? closes.map((f) => `${esc(REF(f.from))} → ${esc(REF(f.to))}${f.by.length > 1 ? ` (with ${esc(f.by.filter((x) => x !== p.id).map((x) => PB[x].name).join(', '))})` : ''}`).join('<br>') : 'no drawn path'}</td><td><span class="st fixed${p.strong ? '' : ' weak'}">${esc(p.ev)}</span></td><td><span class="st pf ${p.proof}">${p.proof}</span>${p.proofRef ? ` <span class="m">${esc(p.proofRef)}</span>` : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="7" class="absent">The document carries no patch.</td></tr>';
    // render options: marks hide by class on the drawing, sections by `hidden`
    $('wrap').className = ['dfd-wrap'].concat(['halos', 'pips', 'guards', 'chips', 'labels'].filter((k) => !S.show[k]).map((k) => `no-${k}`)).join(' ');
    document.querySelectorAll('#opts input').forEach((i) => { i.checked = i.dataset.opt === 'cov' ? S.cov : S.show[i.dataset.opt]; });
    document.querySelectorAll('#opts .cov-only').forEach((l) => { l.hidden = !HAS_COV; });
    $('tiles').hidden = !S.show.tiles;
    $('cov-tiles').hidden = !HAS_COV || !S.show.tiles;
    $('gaps-sec').hidden = !HAS_COV || !S.show.gaps;
    if (HAS_COV) {
      const onPath = new Set(P.flatMap((p) => p.flows.flatMap((f) => [f.from, f.to])));
      const can = NODES.filter((x) => measurable(x) && onPath.has(x.id));
      const low = can.filter((x) => x.cov && x.cov.lines.covered / x.cov.lines.total < FLOOR).length;
      const fm = FLOWS.filter((f) => f.cov && exists(f, B.ap));
      $('cov-tiles').innerHTML =
        `<div class="tile cov"><b>${can.filter((x) => x.cov).length} / ${can.length}</b><span>elements on a path with coverage measured${low ? ` (${low} below the ${pct(FLOOR, 1)} floor)` : ''}</span></div>`
        + `<div class="tile cov"><b>${fm.filter((f) => f.cov.exercised).length} / ${fm.length}</b><span>measured flows a test exercised (${FLOWS.filter((f) => exists(f, B.ap)).length - fm.length} flows not measured)</span></div>`
        + `<div class="tile cov"><b>${PATCHES.filter((p) => p.proven).length} / ${PATCHES.length}</b><span>patches with a run-time control (${PATCHES.filter((p) => p.proof === 'belt-and-braces').length} belt and braces, ${PATCHES.filter((p) => p.proof === 'static').length} compile-time only)</span></div>`
        + `<div class="tile grey"><b>${B.gaps.length}</b><span>coverage gaps listed below</span></div>`;
      $('gaps').innerHTML = B.gaps.map((g) => `<tr data-row data-gap="${esc(g.key)}" tabindex="0"${S.focus && S.focus.gap === g.key ? ' class="on"' : ''}><td>${g.sev ? esc(SEV_WORD[g.sev]) : '<span class="absent">none</span>'}</td><td>${esc(g.gap)}</td><td class="m">${esc(g.where)}</td><td>${esc(g.detail)}</td></tr>`).join('')
        || '<tr><td colspan="4" class="absent">No gap: every path is closed on a controlled proof, every step is evaluated and every measured element is above the floor.</td></tr>';
    }
    document.querySelectorAll('#lvl button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.level) === B.level)));
    document.querySelectorAll('#flt button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.flt === S.flt)));
    $('scrub').max = PATCHES.length;
    $('scrub').value = S.k;
    $('scrub-out').textContent = `${S.k} of ${PATCHES.length}${S.k ? ` · ${PATCHES[S.k - 1].name} · ${PATCHES[S.k - 1].carrier}` : ' · unpatched'}${S.k && ENDS.length > 1 ? ` · change set ${setAt(S.k) + 1} of ${ENDS.length}` : ''}`;
    $('by-set').checked = S.bySet;
    $('play').textContent = S.timer ? '❚❚ pause' : '▶ play';
    for (const m of ['time', 'combo']) { $(`tab-${m}`).setAttribute('aria-selected', String(S.mode === m)); $(`pane-${m}`).hidden = S.mode !== m; }
    if (S.mode === 'combo') {
      const closed = (set) => pathsOf(set).filter((x) => x.st === 'closed').length;
      const cur = closed(B.ap), all = closed(new Set(PATCHES.map((x) => x.id)));
      $('combo').innerHTML = PATCHES.map((p) => {
        const on = B.ap.has(p.id), alt = new Set(B.ap); if (on) alt.delete(p.id); else alt.add(p.id);
        const d = closed(alt) - cur;
        const partners = [...new Set(FLOWS.filter((f) => (f.by || []).includes(p.id) && f.by.length > 1).flatMap((f) => f.by).filter((x) => x !== p.id))];
        const needs = partners.filter((x) => !B.ap.has(x)).map((x) => PB[x].name);
        const note = on ? (d ? `unticking reopens ${-d}` : 'unticking changes no path') : d ? `ticking closes ${d}` : needs.length ? `closes nothing until ${needs.join(', ')} is ticked too` : 'closes no drawn path';
        return `<label><input type="checkbox" id="cb-${esc(p.id)}" data-combo="${esc(p.id)}"${on ? ' checked' : ''}><span>${esc(p.name)} <small>${esc(note)}</small></span></label>`;
      }).join('');
      $('combo-out').textContent = `${B.ap.size} of ${PATCHES.length} ticked: ${n('live')} open, ${cur} closed, ${n('grey')} not evaluated. Against the full set: ${all - cur} fewer closed.`;
    }
    $('sarif-msg').textContent = S.sarifMsg;
    const fb = $('focusbar');
    const lp = !S.focus && S.mode === 'time' && S.landed ? PB[S.landed] : null;
    const clear = ' <button type="button" class="btn" id="clear">clear</button>';
    if (lp) {
      const cl = FLOWS.filter((f) => (f.by || []).includes(lp.id)), g = lp.guard ? FB[lp.guard] : null;
      const whole = LANDED.length > 1 ? `<b>Change set ${setAt(S.k) + 1} of ${ENDS.length}: ${esc(lp.setName)}</b> lands ${LANDED.length} patches together: ${LANDED.map((id) => esc(PB[id].name)).join(', ')}. The last of them: ` : '';
      fb.innerHTML = `${whole}<b>Step ${S.k}: ${esc(lp.name)}</b> (${esc(lp.carrier)}, ${esc(lp.ev)}).${g ? ` Guards ${esc(REF(g.from))} → ${esc(REF(g.to))}.` : ''} ${cl.length ? `Names ${cl.map((f) => `${esc(REF(f.from))} → ${esc(REF(f.to))}`).join(', ')}${cl.some((f) => !f.by.every((x) => B.ap.has(x))) ? '; a flow that needs another patch too stays open until that one lands' : ''}.` : 'Closes no drawn path.'} ${esc(lp.what)}`;
    } else if (!S.focus) fb.textContent = 'Nothing selected. Select a finding chip on an element, a path or a patch to trace it; the diagram drops to L2 and dims the rest.';
    else if (S.focus.gap) { const g = B.gaps.find((x) => x.key === S.focus.gap); fb.innerHTML = (g ? `<b>${esc(g.gap)}</b> (${g.sev ? `${esc(SEV_WORD[g.sev])} impact` : 'on no path to an impact'}): ${esc(g.where)}. ${esc(g.detail)}` : 'That gap is gone with these patches applied.') + clear; }
    else if (S.focus.path) { const p = P.find((x) => x.id === S.focus.path); fb.innerHTML = (p ? `${pathPill(p)} <b>${esc(refPath(p))}</b> ends in ${esc(NB[p.sink].label)}. ${esc(decides(p))}` : 'That path does not exist with these patches applied.') + clear; }
    else {
      const ps = S.focus.patch ? [PB[S.focus.patch]] : PATCHES.filter((p) => p.fin.map(shortFin).includes(shortFin(S.focus.fin)));
      const mine = B.rel ? P.filter((p) => p.flows.every((f) => B.rel.fl.has(f.id))) : [];
      const c = (st) => mine.filter((p) => p.st === st).length;
      const residual = mine.filter((p) => p.st !== 'closed' || p.by.gate.g === 'safe');
      fb.innerHTML = `<b>${esc(S.focus.patch ? PB[S.focus.patch].name : S.focus.fin)}</b>: ${mine.length} path${mine.length === 1 ? '' : 's'} carry it: ${c('live')} open, ${c('closed')} closed, ${c('grey')} not evaluated.`
        + (ps.length ? ps.map((p) => { const g = p.guard ? FB[p.guard] : null; return `<br><b>${esc(p.name)}</b> (${B.ap.has(p.id) ? 'applied' : 'not applied'}, ${esc(p.ev)})${g ? ` guards ${esc(REF(g.from))} → ${esc(REF(g.to))}` : ''}. ${esc(p.what)}`; }).join('') : '<br>The document carries no patch for it.')
        + (residual.length ? `<br>Outside any patch's reach: ${residual.map((p) => `${esc(refPath(p))} (${p.st === 'closed' ? 'measured safe' : p.st === 'grey' ? 'not evaluated' : 'open'})`).join('; ')}.` : '') + clear;
    }
  }

  // ── wiring ───────────────────────────────────────────────────────────────────────────────────
  function setK(k) { S.k = Math.max(0, Math.min(PATCHES.length, k)); S.focus = null; S.landed = S.k ? PATCHES[S.k - 1].id : null; draw(); }
  /** Where one step forward or back lands: the next end of a change set, or the next patch when stepping patch by patch. */
  const stepFrom = (dir) => (!S.bySet ? S.k + dir : dir > 0 ? (ENDS.find((e) => e > S.k) ?? PATCHES.length) : ([...ENDS].reverse().find((e) => e < S.k) ?? 0));
  function stop() { if (S.timer) { timers.clear(S.timer); S.timer = null; } }
  function play() {
    if (S.timer) { stop(); draw(); return; }
    if (S.k >= PATCHES.length) setK(0);
    S.timer = timers.set(() => { if (S.k >= PATCHES.length) { stop(); draw(); } else setK(stepFrom(1)); }, Number($('speed').value));
    draw();
  }
  $('play').addEventListener('click', play);
  $('speed').addEventListener('change', () => { if (S.timer) { stop(); play(); } });
  document.querySelector('.tabs').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-mode]'); if (!b) return; stop(); S.mode = b.dataset.mode; S.focus = null; S.landed = null; draw(); });
  $('combo').addEventListener('change', (ev) => { const id = ev.target.dataset.combo; if (!id) return; if (ev.target.checked) S.combo.add(id); else S.combo.delete(id); S.focus = null; draw(); });
  $('c-all').addEventListener('click', () => { S.combo = new Set(PATCHES.map((p) => p.id)); draw(); });
  $('c-none').addEventListener('click', () => { S.combo = new Set(); draw(); });
  $('lvl').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; S.level = Number(b.dataset.level); S.focus = null; draw(); });
  $('flt').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; S.flt = b.dataset.flt; S.focus = null; draw(); });
  $('scrub').addEventListener('input', (ev) => { stop(); setK(Number(ev.target.value)); });
  $('prev').addEventListener('click', () => { stop(); setK(stepFrom(-1)); });
  $('next').addEventListener('click', () => { stop(); setK(stepFrom(1)); });
  $('by-set').addEventListener('change', (ev) => { S.bySet = !!ev.target.checked; draw(); });
  $('k0').addEventListener('click', () => { stop(); setK(0); });
  $('kall').addEventListener('click', () => { stop(); setK(PATCHES.length); S.landed = null; draw(); });
  function pick(t) {
    const chip = t.closest('[data-fin]'); if (chip) { S.focus = { fin: chip.dataset.fin }; draw(); return; }
    const row = t.closest('tr[data-row]');
    if (row && row.dataset.gap) { S.focus = { gap: row.dataset.gap }; draw(); $('focusbar').scrollIntoView({ block: 'nearest' }); return; }
    if (row && row.dataset.path) { S.focus = { path: row.dataset.path }; draw(); $('focusbar').scrollIntoView({ block: 'nearest' }); return; }
    if (row && row.dataset.patch) { stop(); const i = PATCHES.findIndex((p) => p.id === row.dataset.patch); if (S.mode === 'time') S.k = Math.max(S.k, i + 1); S.focus = { patch: row.dataset.patch }; draw(); $('focusbar').scrollIntoView({ block: 'nearest' }); return; }
    if (t.closest('#clear')) { S.focus = null; draw(); }
  }
  document.addEventListener('click', (ev) => { pick(ev.target); });
  document.addEventListener('keydown', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('[data-fin],tr[data-row]')) { ev.preventDefault(); pick(ev.target); } });
  $('opts').addEventListener('change', (ev) => { const k = ev.target.dataset.opt; if (!k) return; if (k === 'cov') S.cov = ev.target.checked; else S.show[k] = ev.target.checked; draw(); });
  $('sarif-go').addEventListener('click', () => { applySarif($('sarif').value); draw(); });
  $('sarif-clear').addEventListener('click', () => { S.sarif = {}; S.sarifNode = {}; S.sarifMsg = 'SARIF results removed.'; draw(); });
  draw();
  return { core, draw };
}
