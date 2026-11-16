// lib/dfd-paths-core.mjs — the rules and the layout of the paths view, with no page in them.
//
// lib/dfd-paths-render.mjs inlines this file into the page ahead of lib/dfd-paths-client.js (which
// draws and wires), and the tests import it directly: one copy of the path rule, the coverage and
// gap rules, the timeline and combination state, the SARIF reading and the layout, read by both.
// It imports nothing, because the page cannot. lib/dfd.mjs (threatPaths) and lib/dfd-coverage.mjs
// (coverageGaps) hold the same rules for callers with no page; lib/test/dfd-paths-core.test.mjs
// holds the two in agreement on every document it is given.
//
// createCore(document) returns the derived model, the view state `S` (the caller mutates it: level,
// patches applied, focus, filters) and the functions that read it. Nothing here touches a DOM.

export function createCore(M) {
  const num = (x) => String(Math.round(x * 10) / 10);

  // ── model ────────────────────────────────────────────────────────────────────────────────────
  const GROUP = new Map((M.groups || []).map((g) => [g.id, g]));
  const rootOf = (gid) => { let at = gid; while (GROUP.get(at) && GROUP.get(at).parent !== undefined) at = GROUP.get(at).parent; return at; };
  const SEV = { critical: 4, high: 3, medium: 2, low: 1 };
  const pairKey = (f) => `${f.from}\u0000${f.to}`;
  const rejectPairs = new Map();
  const closePairs = new Map();
  for (const p of M.patches || []) {
    for (const pr of p.rejects || []) { const k = pairKey(pr); if (!rejectPairs.has(k)) rejectPairs.set(k, []); rejectPairs.get(k).push(p.id); }
    for (const pr of p.closes) { const k = pairKey(pr); if (!closePairs.has(k)) closePairs.set(k, []); closePairs.get(k).push(p.id); }
  }
  const FLOWS = M.flows.map((f, k) => ({
    id: `f${k}`, k, from: f.from, to: f.to, label: f.label || '', role: f.role === 'error' ? 'error' : null,
    ex: (f.existence || (f.evidence && f.evidence.existence)) === 'unknown' ? 'unk' : (f.evidence && f.evidence.existence) === 'confirmed' ? 'ok' : null,
    gate: f.gate || null, by: closePairs.get(pairKey(f)) || null, when: rejectPairs.get(pairKey(f)) || null, directed: f.directed !== false,
    cov: f.coverage && typeof f.coverage.exercised === 'boolean' ? f.coverage : null,
  })).filter((f) => f.directed && f.from !== f.to);
  const FB = Object.fromEntries(FLOWS.map((f) => [f.id, f]));
  const inbound = new Map(M.nodes.map((n) => [n.id, 0]));
  const outbound = new Map(M.nodes.map((n) => [n.id, 0]));
  const realIn = new Map(M.nodes.map((n) => [n.id, 0]));
  for (const f of FLOWS) { inbound.set(f.to, inbound.get(f.to) + 1); outbound.set(f.from, outbound.get(f.from) + 1); if (!f.when) realIn.set(f.to, realIn.get(f.to) + 1); }
  const plainId = M.nodes.every((n) => /^[A-Z]{1,2}\d+$/.test(n.id));
  const counters = { P: 0, D: 0, Q: 0, E: 0 };
  const BROKERS = ['broker', 'queue', 'topic', 'stream', 'log'];
  const NODES = M.nodes.map((n) => {
    const kind = n.kind === 'process' ? 'proc' : n.kind === 'store' ? 'store' : 'ext';
    const letter = n.kind === 'process' ? 'P' : n.kind === 'external' ? 'E' : BROKERS.includes(n.subtype) ? 'Q' : 'D';
    const ref = plainId ? n.id : `${letter}${++counters[letter]}`;
    const root = n.group !== undefined ? rootOf(n.group) : null;
    const trust = root !== null && GROUP.get(root) && GROUP.get(root).boundary === 'trust';
    const reject = !n.impact && inbound.get(n.id) > 0 && realIn.get(n.id) === 0 && outbound.get(n.id) === 0;
    const source = inbound.get(n.id) === 0 && outbound.get(n.id) > 0;
    const sink = n.impact ? SEV[n.impact] : 0;
    // an impact is never folded into a group: it is where the paths end, at every level
    const own = !!n.impact || reject || source || root === null;
    const top = !own ? root : (sink || reject) && !trust ? '@impact' : n.id;
    const mid = !own && n.group !== root ? n.group : n.id;
    const cov = n.coverage && n.coverage.lines && n.coverage.lines.total > 0 ? n.coverage : null;
    // measured, with no line to cover (a function of declarations only): neither covered nor a gap, as lib/dfd-coverage.mjs has it
    const empty = !!(n.coverage && n.coverage.lines && n.coverage.lines.total === 0);
    return { id: n.id, ref, kind, label: n.label, unk: !!n.unknown, impact: n.impact || null, sink, reject, source, trust, root, top, mid, cov, empty };
  });
  const NB = Object.fromEntries(NODES.map((n) => [n.id, n]));
  // A control shows a check does something: without the patch it fails, with it it passes. Three
  // kinds, by when the failure shows: a test (run by the suite), a static-assert (the baseline does
  // not compile) and a dynamic-assert (an assertion in the shipped code trips at run time). A
  // compile-time control alone says nothing about run time, so it does not prove a cut; two kinds
  // that both hold, one of them at run time, are belt and braces. lib/dfd-coverage.mjs patchProof
  // is the same rule.
  const controlsOf = (evidence) => (evidence ? [].concat(evidence.control ? [evidence.control] : [], evidence.controls || []) : []);
  const PROVEN = ['belt-and-braces', 'controlled'];
  const proofOf = (evidence) => {
    const kinds = new Set(controlsOf(evidence).filter((c) => c.failsWithout === true && c.passesWith === true).map((c) => c.kind || 'test'));
    const tested = !!evidence && evidence.level === 'tested';
    if (tested && (kinds.has('test') || kinds.has('dynamic-assert'))) return kinds.size > 1 ? 'belt-and-braces' : 'controlled';
    if (kinds.has('static-assert')) return 'static';
    return tested ? 'tested' : 'unproven';
  };
  const REF = (id) => (NB[id] ? NB[id].ref : id);
  // The change set a patch belongs to: its pull request, else the commits it shares, else the file
  // it was read from. Playback lands a set whole; consecutive patches of one set are one step.
  const PR_TITLE = new Map((M.prs || []).map((p) => [p.id, p.title || p.id]));
  const PATCHES = (M.patches || []).map((p) => {
    const guard = p.guard ? FLOWS.find((f) => f.from === p.guard.from && f.to === p.guard.to) : null;
    const ev = p.evidence ? p.evidence.level : 'asserted';
    const refs = (p.evidence && p.evidence.refs) || [];
    const controls = controlsOf(p.evidence);
    const proof = proofOf(p.evidence);
    return { id: p.id, name: p.title || p.id, fin: p.findings || [], guard: guard ? guard.id : null, ev, strong: ev === 'tested', what: p.note || '', off: p.applied === false,
      set: p.pr !== undefined ? `pr ${p.pr}` : p.commits && p.commits.length ? `commits ${p.commits.join(',')}` : refs.length ? `file ${refs.join(',')}` : '',
      setName: p.pr !== undefined ? (PR_TITLE.get(p.pr) || p.pr) : p.commits && p.commits.length ? p.commits.map((c) => c.slice(0, 12)).join(', ') : refs.length ? refs.join(', ') : 'no commit or file recorded',
      proof, proven: PROVEN.includes(proof), proofRef: controls.map((c) => `${c.kind || 'test'}${c.test || c.ref ? `: ${c.test || c.ref}` : ''}`).join('; '), hasControl: controls.length > 0,
      carrier: p.commits && p.commits.length ? p.commits.map((c) => c.slice(0, 12)).join(', ') : `no commit${refs.length ? ` · ${refs.join(', ')}` : ''}` };
  });
  const PB = Object.fromEntries(PATCHES.map((p) => [p.id, p]));
  const FINDINGS = M.findings || [];
  const CHIPS = {};
  for (const fd of FINDINGS) if (fd.at && fd.at.node !== undefined) (CHIPS[fd.at.node] = CHIPS[fd.at.node] || []).push(fd.id);
  const shortFin = (id) => id.split('@')[0];
  // the findings a flow is about: those of the patches that close it, and its gate's
  for (const f of FLOWS) f.fin = [...new Set([...(f.by || []).flatMap((p) => PB[p].fin), ...(f.gate && f.gate.finding ? [f.gate.finding] : [])])];

  const FLOOR = 0.8;
  const HAS_COV = NODES.some((n) => n.cov) || FLOWS.some((f) => f.cov) || PATCHES.some((p) => p.hasControl);
  // an element a test could cover: a source is the attacker's input and an impact is where a path ends
  const measurable = (n) => !n.source && !n.sink && !n.reject && !n.empty;
  const pct = (a, b) => `${Math.round((a / b) * 100)}%`;
  const SEV_WORD = ['none', 'low', 'medium', 'high', 'critical'];

  // `show` holds the render options the page offers as tickboxes; `cov` is the coverage marks
  const S = { level: 1, cov: HAS_COV, show: { halos: true, pips: true, guards: true, chips: true, labels: true, tiles: true, gaps: true }, k: PATCHES.length, focus: null, flt: 'all', sarif: {}, sarifNode: {}, sarifMsg: '', mode: 'time',
    combo: new Set(PATCHES.filter((p) => !p.off).map((p) => p.id)), landed: null, timer: null, bySet: true };
  const appliedSet = () => (S.mode === 'combo' ? new Set(S.combo) : new Set(PATCHES.slice(0, S.k).map((p) => p.id)));
  const strongEv = (g) => g.ev === 'tested' || g.ev === 'runtime' || g.ev === 'third-party';
  const exists = (f, ap) => !f.when || f.when.some((p) => ap.has(p));

  /** What is known about one step: open | fixed | safe | uneval, with its evidence. */
  function gateOf(f, ap) {
    if (S.sarif[f.id]) return S.sarif[f.id];
    if (f.by) return f.by.every((p) => ap.has(p)) ? { g: 'fixed', ev: f.by.every((p) => PB[p].strong) ? 'tested' : 'asserted' } : { g: 'open', live: true };
    if (f.gate && f.gate.state === 'safe') return { g: 'safe', ev: (f.gate.evidence && f.gate.evidence.level) || 'asserted', why: f.gate.evidence && f.gate.evidence.witness };
    if (f.gate && f.gate.state === 'unevaluated') return { g: 'uneval', why: f.gate.evidence && f.gate.evidence.witness };
    return { g: 'open' };
  }
  const MAX_PATHS = 2000;
  /** Every source-to-impact path over the flows that exist, with its state. */
  function pathsOf(ap) {
    const out = new Map();
    for (const f of FLOWS) { if (f.when) continue; if (!out.has(f.from)) out.set(f.from, []); out.get(f.from).push(f); }
    const paths = [];
    const walk = (node, trail, seen) => {
      if (paths.length >= MAX_PATHS) return;
      if (NB[node].sink && trail.length) {
        const gates = trail.map((f) => gateOf(f, ap));
        const ci = gates.findIndex((g) => g.g === 'fixed' || g.g === 'safe');
        const ui = gates.findIndex((g) => g.g === 'uneval');
        const st = ci >= 0 ? 'closed' : ui >= 0 ? 'grey' : 'live';
        paths.push({ id: trail.map((f) => f.id).join('>'), flows: trail.slice(), sink: node, sev: NB[node].sink, st,
          by: ci >= 0 ? { f: trail[ci], gate: gates[ci] } : ui >= 0 ? { f: trail[ui], gate: gates[ui] } : null, weak: ci >= 0 && !strongEv(gates[ci]) });
      }
      for (const f of out.get(node) || []) { if (seen.has(f.to)) continue; seen.add(f.to); walk(f.to, [...trail, f], seen); seen.delete(f.to); }
    };
    for (const n of NODES) if (n.source) walk(n.id, [], new Set([n.id]));
    return paths;
  }
  const RANK = { live: 0, grey: 1, closed: 2 };
  function flowStates(paths) {
    const st = new Map();
    for (const p of paths) for (const f of p.flows) {
      const cur = st.get(f.id);
      const crit = p.sev >= 4 && p.st !== 'closed';
      if (!cur) st.set(f.id, { st: p.st, weak: p.weak, crit });
      else {
        if (RANK[p.st] < RANK[cur.st]) { cur.st = p.st; cur.weak = p.weak; } else if (p.st === cur.st && p.weak) cur.weak = true;
        cur.crit = cur.crit || crit;
      }
    }
    return st;
  }
  function related(paths, gaps) {
    if (!S.focus) return null;
    const fl = new Set();
    const extra = [];
    if (S.focus.gap) { const g = gaps.find((x) => x.key === S.focus.gap); if (g) { for (const id of g.fl) fl.add(id); for (const id of g.nd) extra.push(id); } }
    else if (S.focus.path) { const p = paths.find((x) => x.id === S.focus.path); if (p) for (const f of p.flows) fl.add(f.id); }
    else {
      const fins = S.focus.fin ? [S.focus.fin] : PB[S.focus.patch].fin;
      const short = new Set(fins.map(shortFin));
      const core = new Set(FLOWS.filter((f) => f.fin.some((x) => short.has(shortFin(x)))).map((f) => f.id));
      if (S.focus.patch) for (const f of FLOWS) if ((f.by || []).includes(S.focus.patch)) core.add(f.id);
      for (const p of paths) if (p.flows.some((f) => core.has(f.id))) for (const f of p.flows) fl.add(f.id);
      for (const p of PATCHES) if (S.focus.patch ? p.id === S.focus.patch : p.fin.some((x) => short.has(shortFin(x)))) {
        if (p.guard) fl.add(p.guard);
        for (const f of FLOWS) if (f.when && f.when.includes(p.id)) fl.add(f.id);
      }
    }
    const nd = new Set(NODES.filter((n) => n.source).map((n) => n.id).concat(extra));
    for (const id of fl) { nd.add(FB[id].from); nd.add(FB[id].to); }
    return { fl, nd };
  }
  const STATUS_GATE = { mitigated: { g: 'fixed', ev: 'asserted' }, dismissed: { g: 'uneval', dismissed: true }, undetermined: { g: 'uneval' }, live: { g: 'open', live: true } };
  function chipState(nid, fid, ap) {
    const s = S.sarifNode[`${nid}|${fid}`];
    if (s) return s;
    const ps = PATCHES.filter((p) => p.fin.includes(fid));
    if (ps.length) return ps.every((p) => ap.has(p.id)) ? { g: 'fixed', ev: ps.every((p) => p.strong) ? 'tested' : 'asserted' } : { g: 'open', live: true };
    const gated = FLOWS.filter((f) => f.gate && f.gate.finding === fid && (f.from === nid || f.to === nid));
    if (gated.length) return gateOf(gated[0], ap);
    // a second finding measured by the same step: the step's verdict is the element's
    const here = FLOWS.filter((f) => f.gate && (f.from === nid || f.to === nid) && NB[nid].trust);
    if (here.length) return gateOf(here[0], ap);
    const fd = FINDINGS.find((x) => x.id === fid);
    return STATUS_GATE[(fd && fd.status) || 'undetermined'];
  }
  const GLYPH = { fixed: '✓', safe: '⊘', uneval: '?', open: '!' };
  const gateCls = (g) => (g.g === 'open' ? 'live' : g.g === 'uneval' ? 'grey' : `${g.g}${strongEv(g) ? '' : ' weak'}`);
  const chipWord = (g) => (g.g === 'open' ? 'open' : g.g === 'uneval' ? (g.dismissed ? 'judged not a defect (reason in its note), not closed' : 'not evaluated') : g.g === 'safe' ? `measured non-exploitable (${g.tool || (g.ev === 'static' ? 'static analysis only' : g.ev)})` : `fixed (${g.ev})`);

  /** Where the evidence is thin, worst impact first. Each gap names the flows and elements that trace it. */
  function gapsOf(paths, ap) {
    const out = [];
    const sevOfFlow = new Map(), sevOfNode = new Map(), through = new Map(), throughNode = new Map();
    const push = (map, key, p) => { if (!map.has(key)) map.set(key, []); map.get(key).push(p); };
    for (const p of paths) {
      const seen = new Set();
      for (const f of p.flows) {
        sevOfFlow.set(f.id, Math.max(sevOfFlow.get(f.id) || 0, p.sev));
        push(through, f.id, p);
        for (const id of [f.from, f.to]) { sevOfNode.set(id, Math.max(sevOfNode.get(id) || 0, p.sev)); if (!seen.has(id)) { seen.add(id); push(throughNode, id, p); } }
      }
    }
    const flowsOf = (ps) => new Set((ps || []).flatMap((p) => p.flows.map((f) => f.id)));
    const rest = (k) => (k === 1 ? '1 path rests on it.' : `${k} paths rest on it.`);
    const run = (k) => (k === 1 ? '1 path runs through it' : `${k} paths run through it`);
    for (const p of paths) {
      if (p.sev < 4 || p.st === 'closed' || p.flows.some((f) => f.cov && f.cov.exercised)) continue;
      out.push({ key: `a:${p.id}`, sev: p.sev, ord: 0, gap: 'Critical path no test exercises', where: refPath(p),
        detail: `${p.st === 'grey' ? 'Not evaluated' : 'Open'}, and no flow on it ran under a test.`, fl: flowsOf([p]), nd: [] });
    }
    const byStep = new Map();
    for (const p of paths) {
      if (p.st !== 'closed') continue;
      const f = p.by.f, g = p.by.gate;
      let why = null;
      if (g.g === 'fixed') {
        const weak = f.by.filter((id) => !PB[id].proven);
        const say = (q) => (q.proof === 'tested' ? 'tested, with no test shown to fail without it' : q.proof === 'static' ? 'a compile-time assertion only, with nothing shown at run time' : `${q.ev}, not tested`);
        if (weak.length) why = `Closed by ${weak.map((id) => `${PB[id].name} (${say(PB[id])})`).join(' + ')}.`;
      } else if (!strongEv(g)) why = `Measured non-exploitable on ${g.ev} evidence, with no runtime proof.`;
      if (!why) continue;
      if (!byStep.has(f.id)) byStep.set(f.id, { f, why, paths: [] });
      byStep.get(f.id).paths.push(p);
    }
    for (const x of byStep.values()) out.push({ key: `b:${x.f.id}`, sev: Math.max.apply(null, x.paths.map((p) => p.sev)), ord: 1, gap: 'Closed without a controlled proof',
      where: `${REF(x.f.from)} → ${REF(x.f.to)}`, detail: `${x.why} ${rest(x.paths.length)}`, fl: flowsOf(x.paths), nd: [] });
    for (const f of FLOWS) {
      if (!exists(f, ap) || !through.has(f.id)) continue;
      const g = gateOf(f, ap);
      if (g.g !== 'uneval') continue;
      out.push({ key: `c:${f.id}`, sev: sevOfFlow.get(f.id), ord: 2, gap: 'Step nobody has evaluated', where: `${REF(f.from)} → ${REF(f.to)}`,
        detail: g.why || 'No verdict is recorded for it.', fl: flowsOf(through.get(f.id)), nd: [] });
    }
    for (const n of NODES) {
      if (!measurable(n)) continue;
      const on = throughNode.get(n.id);
      if (n.cov) {
        const l = n.cov.lines;
        if (l.covered / l.total >= FLOOR) continue;
        out.push({ key: `d:${n.id}`, sev: sevOfNode.get(n.id) || 0, ord: 3, gap: 'Element below the coverage floor', where: `${n.ref} ${n.label}`,
          detail: `${l.covered} of ${l.total} lines (${pct(l.covered, l.total)}); the floor is ${pct(FLOOR, 1)}.${on ? ` ${run(on.length)}.` : ' On no path to an impact.'}`, fl: flowsOf(on), nd: [n.id] });
      } else if (on) {
        out.push({ key: `e:${n.id}`, sev: sevOfNode.get(n.id), ord: 4, gap: 'Element on a path, coverage not measured', where: `${n.ref} ${n.label}`,
          detail: `${run(on.length)}, and nothing says whether a test reaches it.`, fl: flowsOf(on), nd: [n.id] });
      }
    }
    for (const f of FLOWS) {
      if (!f.cov || f.cov.exercised !== false || !exists(f, ap)) continue;
      const on = through.get(f.id);
      out.push({ key: `f:${f.id}`, sev: sevOfFlow.get(f.id) || 0, ord: 5, gap: 'Flow measured, never exercised', where: `${REF(f.from)} → ${REF(f.to)}`,
        detail: `${f.label ? `"${f.label}". ` : ''}${on ? `${run(on.length)}.` : 'On no path to an impact.'}`, fl: on ? flowsOf(on) : new Set([f.id]), nd: [] });
    }
    return out.sort((a, b) => b.sev - a.sev || a.ord - b.ord || a.where.localeCompare(b.where));
  }

  // ── layout ───────────────────────────────────────────────────────────────────────────────────
  const NW = 168, GAP = 14, Y0 = 66, W = 1250;
  const CX = { 0: 16, 1: 300, 2: 640, 3: 838, 5: 1064 };
  const TR_OS = 194, TR_DEV = 204, B1 = 482, B1S = 5, B2 = 1014, B2S = 8, MID23 = 823;
  // rank inside the trust band: 0 enters it, later ranks sit one column in
  const hullRank = new Map();
  (function rankHull() {
    const inside = (id) => NB[id].trust && !NB[id].sink;
    for (const n of NODES) if (inside(n.id)) hullRank.set(n.id, 0);
    for (let pass = 0; pass < NODES.length; pass++) {
      let moved = false;
      for (const f of FLOWS) if (inside(f.from) && inside(f.to) && hullRank.get(f.to) < hullRank.get(f.from) + 1 && hullRank.get(f.from) < NODES.length) { hullRank.set(f.to, hullRank.get(f.from) + 1); moved = true; }
      if (!moved) break;
    }
  }());
  const colOf = (n) => (n.source ? 0 : n.trust ? (n.sink ? 5 : hullRank.get(n.id) > 0 ? 3 : 2) : n.sink || n.reject ? 5 : 1);
  const groupIndex = new Map((M.groups || []).map((g, i) => [g.id, i]));
  const orderKey = (n, i) => [n.root === null ? -1 : groupIndex.get(n.root), n.mid === n.id ? 1e6 : groupIndex.get(n.mid), hullRank.get(n.id) || 0, n.sink ? -n.sink : 0, i];
  const SORTED = NODES.map((n, i) => ({ n, key: orderKey(n, i) })).sort((a, b) => { for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i]; return 0; }).map((x) => x.n);

  // a boundary's label may open with its id and run on to a second sentence; a collapsed node shows the name alone
  const shortLabel = (l) => (l.includes(': ') ? l.slice(l.indexOf(': ') + 2) : l).split('. ')[0];
  function wrapL(s, max) {
    const out = []; let line = '';
    for (const w of String(s).split(' ')) {
      if ((line ? `${line} ${w}` : w).length <= max) line = line ? `${line} ${w}` : w;
      else { if (line) out.push(line); line = w; while (line.length > max) { out.push(line.slice(0, max)); line = line.slice(max); } }
    }
    if (line) out.push(line);
    return out;
  }
  function roundedPath(raw, r) {
    const pts = [];
    for (const p of raw) { const q = pts[pts.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) pts.push(p); }
    for (let i = pts.length - 2; i > 0; i--) { const a = pts[i - 1], b = pts[i], c = pts[i + 1]; if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) pts.splice(i, 1); }
    let d = `M${num(pts[0][0])},${num(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const px = pts[i - 1][0], py = pts[i - 1][1], x = pts[i][0], y = pts[i][1], nx = pts[i + 1][0], ny = pts[i + 1][1];
      const il = Math.hypot(x - px, y - py), ol = Math.hypot(nx - x, ny - y), k = Math.min(r, il / 2, ol / 2);
      d += ` L${num(x - ((x - px) / il) * k)},${num(y - ((y - py) / il) * k)} Q${num(x)},${num(y)} ${num(x + ((nx - x) / ol) * k)},${num(y + ((ny - y) / ol) * k)}`;
    }
    const l = pts[pts.length - 1];
    return { d: `${d} L${num(l[0])},${num(l[1])}`, pts };
  }
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  function build() {
    const ap = appliedSet();
    const level = S.focus ? 2 : S.level;
    const paths = pathsOf(ap);
    const fst = flowStates(paths);
    const gaps = HAS_COV ? gapsOf(paths, ap) : [];
    const rel = related(paths, gaps);
    // the coverage bar needs its own strip along the bottom of every element
    const pad = HAS_COV && S.cov ? 7 : 0;
    const rep = (id) => (level === 0 ? NB[id].top : level === 1 ? NB[id].mid : id);
    const V = {};
    const cols = { 0: [], 1: [], 2: [], 3: [], 5: [], h5: [] };
    for (const n of SORTED) {
      const id = rep(n.id);
      if (V[id]) { V[id].members.push(n.id); continue; }
      const g = id === n.id ? null : id === '@impact' ? { label: 'Impact', boundary: 'trust' } : GROUP.get(id);
      const col = colOf(n);
      const lane = col === 5 && n.trust ? 'h5' : col;
      V[id] = { id, col, lane, x: CX[col], kind: g ? (g.boundary === 'system' ? 'proc' : 'ext') : n.kind, coll: !!g, unk: !g && n.unk, members: [n.id],
        base: g ? shortLabel(g.label) : n.label, ref: g ? '' : n.ref, ins: [], outs: [], trust: n.trust };
      cols[lane].push(id);
    }
    for (const v of Object.values(V)) {
      v.label = v.coll ? `${v.base} (${v.members.length} elements)` : v.base;
      v.isSink = v.members.every((m) => NB[m].sink || NB[m].reject);
      v.lines = wrapL(v.label, v.kind === 'store' ? 19 : 24);
    }
    const E = []; const byKey = new Map();
    for (const f of FLOWS) {
      if (!exists(f, ap)) continue;
      const a = rep(f.from), b = rep(f.to);
      if (a === b) continue;
      const key = level === 2 ? f.id : `${a}>${b}>${f.when ? 'r' : 'd'}`;
      let e = byKey.get(key);
      if (!e) { e = { from: a, to: b, flows: [], rej: !!f.when }; byKey.set(key, e); E.push(e); }
      e.flows.push(f);
    }
    for (const e of E) {
      const s = V[e.from], t = V[e.to];
      e.vert = s.col === t.col;
      if (!e.vert) { s.outs.push(e); t.ins.push(e); }
    }
    for (const v of Object.values(V)) {
      const mine = v.isSink ? paths.filter((p) => v.members.includes(p.sink)) : paths.filter((p) => p.flows.some((f) => v.members.includes(f.from) || v.members.includes(f.to)));
      v.tally = { live: 0, grey: 0, closed: 0, rej: FLOWS.filter((f) => f.when && exists(f, ap) && v.members.includes(f.to)).length };
      for (const p of mine) v.tally[p.st]++;
      v.counter = v.isSink || v.coll;
      const can = v.members.map((m) => NB[m]).filter(measurable);
      const got = can.filter((n) => n.cov);
      v.cv = can.length ? { measured: got.length, unmeasured: can.length - got.length, covered: got.reduce((s, n) => s + n.cov.lines.covered, 0), total: got.reduce((s, n) => s + n.cov.lines.total, 0),
        bc: got.reduce((s, n) => s + (n.cov.branches ? n.cov.branches.covered : 0), 0), bt: got.reduce((s, n) => s + (n.cov.branches ? n.cov.branches.total : 0), 0),
        source: [...new Set(got.map((n) => n.cov.source).filter(Boolean))].join(', ') } : null;
      const ports = Math.max(v.ins.length, v.col === 0 ? 0 : v.outs.length);
      v.h = Math.max(16 + v.lines.length * 12 + 8 + (v.counter ? 15 : 0) + pad, 13 * (ports + 1));
    }
    const stack = (ids, y) => { for (const id of ids) { V[id].y = y; y += V[id].h + GAP; } return y - GAP; };
    const devBottom = cols[1].length ? stack(cols[1], Y0) : Y0;
    const impBottom = cols[5].length ? stack(cols[5], Y0) : Y0;
    const hasHull = cols[2].length + cols[3].length + cols.h5.length > 0;
    const hullTop = impBottom + 26;
    const osBottom = hasHull ? Math.max(stack(cols[2], hullTop + 40), stack(cols[3], hullTop + 40), stack(cols.h5, hullTop + 40)) : hullTop;
    const span = Math.max(devBottom, impBottom);
    stack(cols[0], Math.max(Y0, (Y0 + span) / 2 - cols[0].reduce((s, id) => s + V[id].h + GAP, -GAP) / 2));
    const cy = (v) => v.y + v.h / 2;
    for (const v of Object.values(V)) {
      v.ins.sort((a, b) => cy(V[a.from]) - cy(V[b.from]));
      v.outs.sort((a, b) => cy(V[a.to]) - cy(V[b.to]));
      v.ins.forEach((e, i) => { e.ty = v.y + ((i + 1) * v.h) / (v.ins.length + 1); e.ti = i; });
      if (v.col !== 0) v.outs.forEach((e, i) => { e.sy = v.y + ((i + 1) * v.h) / (v.outs.length + 1); });
    }
    const b1 = E.filter((e) => !e.vert && ((V[e.from].col === 1) || (V[e.from].col === 0 && V[e.to].col >= 2)));
    b1.sort((a, b) => (V[b.from].col - V[a.from].col) * 1e6 + ((a.sy === undefined ? 1e5 + a.ty : a.sy) - (b.sy === undefined ? 1e5 + b.ty : b.sy)));
    const b1step = Math.min(B1S, (CX[2] - 22 - B1) / Math.max(1, b1.length));
    b1.forEach((e, i) => { e.bx = B1 + i * b1step; });
    const lows = E.filter((e) => V[e.from].col === 0 && V[e.to].col >= 2).sort((a, b) => b.ty - a.ty);
    lows.forEach((e, i) => { e.low = devBottom + 18 + i * 7; });
    const b2 = E.filter((e) => !e.vert && V[e.from].col >= 2 && V[e.to].col === 5).sort((a, b) => a.sy - b.sy);
    b2.forEach((e, i) => { e.bx = B2 + i * Math.min(B2S, 44 / Math.max(1, b2.length)); });
    // every other bent edge (a column 3 to 4 flow, a flow back to an earlier column): bend between its two ends
    E.filter((e) => !e.vert && e.bx === undefined).forEach((e, i) => { e.bx = (V[e.from].x + NW + V[e.to].x) / 2 + ((i % 5) - 2) * 4; });
    const lowMax = lows.length ? devBottom + 18 + lows.length * 7 : devBottom;
    const H = Math.max(osBottom, impBottom, lowMax, ...cols[0].map((id) => V[id].y + V[id].h)) + 34;
    for (const e of E) {
      const s = V[e.from], t = V[e.to], sr = s.x + NW;
      let pts;
      if (e.vert) pts = s.y < t.y ? [[s.x + NW / 2, s.y + s.h], [t.x + NW / 2, t.y]] : [[s.x + NW / 2, s.y], [t.x + NW / 2, t.y + t.h]];
      else if (s.col === 0 && t.col === 1) pts = [[sr, cy(s) - 6], [TR_DEV, cy(s) - 6], [TR_DEV, e.ty], [t.x, e.ty]];
      else if (s.col === 0 && e.low !== undefined) pts = [[sr, cy(s) + 6], [TR_OS, cy(s) + 6], [TR_OS, e.low], [e.bx, e.low], [e.bx, e.ty], [t.x, e.ty]];
      else if (s.col === 0) pts = [[sr, cy(s)], [e.bx, cy(s)], [e.bx, e.ty], [t.x, e.ty]];
      else if (s.col === 1) pts = [[sr, e.sy], [e.bx, e.sy], [e.bx, e.ty], [t.x, e.ty]];
      else if (s.col === 2 && t.col === 3) pts = [[sr, e.sy], [MID23, e.sy], [MID23, e.ty], [t.x, e.ty]];
      else pts = [[sr, e.sy], [e.bx, e.sy], [e.bx, e.ty], [t.x, e.ty]];
      const rp = roundedPath(pts, 6);
      e.d = rp.d; e.pts = rp.pts;
      const sts = e.flows.map((f) => fst.get(f.id)).filter(Boolean);
      e.state = sts.length ? sts.reduce((a, b) => (RANK[b.st] < RANK[a.st] ? b : a)) : null;
      e.crit = sts.some((x) => x.crit);
      e.weak = !!e.state && e.state.st === 'closed' && sts.filter((x) => x.st === 'closed').some((x) => x.weak);
      e.on = !rel || e.flows.some((f) => rel.fl.has(f.id));
      if (S.flt !== 'all' && !rel) e.on = !!e.state && sts.some((x) => x.st === S.flt);
    }
    return { ap, level, paths, fst, rel, V, E, H, hullTop, devBottom, osBottom, cols, hasHull, gaps, pad };
  }

  const refPath = (p) => [REF(p.flows[0].from)].concat(p.flows.map((f) => REF(f.to))).join(' → ');
  // ── SARIF ────────────────────────────────────────────────────────────────────────────────────
  function applySarif(text) {
    let doc;
    try { doc = JSON.parse(text); } catch (err) { S.sarifMsg = `Not valid JSON: ${err.message}. Nothing was applied.`; return; }
    S.sarif = {}; S.sarifNode = {};
    const c = { fail: 0, pass: 0, other: 0 }; let total = 0, matched = 0;
    const byRef = new Map(NODES.flatMap((n) => [[n.ref, n.id], [n.id, n.id]]));
    for (const run of (doc && doc.runs) || []) {
      const tool = (run.tool && run.tool.driver && run.tool.driver.name) || 'unnamed tool';
      for (const r of run.results || []) {
        total++;
        const kind = r.kind || 'fail'; // SARIF: kind defaults to fail
        c[kind === 'fail' ? 'fail' : kind === 'pass' ? 'pass' : 'other']++;
        const rule = String(r.ruleId || '').toLowerCase();
        const nodes = (r.locations || []).flatMap((l) => l.logicalLocations || []).map((l) => byRef.get(l.name)).filter(Boolean);
        const g = Object.assign(kind === 'fail' ? { g: 'open', live: true } : kind === 'pass' ? { g: 'safe', ev: 'third-party' } : { g: 'uneval' }, { tool, msg: r.message && r.message.text });
        let hitAny = false;
        for (const f of FLOWS) {
          if (!f.gate || !f.gate.finding || shortFin(f.gate.finding).toLowerCase() !== rule) continue;
          if (nodes.length && !nodes.includes(f.from) && !nodes.includes(f.to)) continue;
          S.sarif[f.id] = g; hitAny = true;
        }
        for (const nid of nodes) for (const fid of CHIPS[nid] || []) if (shortFin(fid).toLowerCase() === rule) S.sarifNode[`${nid}|${fid}`] = g;
        if (hitAny) matched++;
      }
    }
    S.sarifMsg = `${total} results read: ${c.fail} fail, ${c.pass} pass, ${c.other} open or review. ${matched} matched a step in the diagram, ${total - matched} matched nothing.`;
  }

  return { num, GROUP, rootOf, SEV, pairKey, rejectPairs, closePairs, FLOWS, FB, inbound, outbound, realIn, plainId, counters, BROKERS, NODES, NB, REF, controlsOf, PROVEN, proofOf, PATCHES, PB, FINDINGS, CHIPS, shortFin, FLOOR, HAS_COV, measurable, pct, SEV_WORD, S, appliedSet, strongEv, exists, gateOf, MAX_PATHS, pathsOf, RANK, flowStates, related, STATUS_GATE, chipState, GLYPH, gateCls, chipWord, gapsOf, NW, GAP, Y0, W, CX, TR_OS, TR_DEV, B1, B1S, B2, B2S, MID23, hullRank, colOf, groupIndex, orderKey, SORTED, shortLabel, wrapL, roundedPath, hit, build, refPath, applySarif };
}
