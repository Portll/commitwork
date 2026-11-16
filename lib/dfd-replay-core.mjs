// lib/dfd-replay-core.mjs — the rules of the replay view: a dfd@1 document stepped through its
// change sets, drawn as a process flow (sources on one trunk, one lane per top-level group, checks
// as diamonds on the flows they guard, outcomes in one column), beside the repository file tree the
// document names. The page inlines this file (its `export` dropped) ahead of
// lib/dfd-replay-client.js, and the tests import it, so page and tests run the same rules.
// It imports nothing, touches no document and keeps no state outside the object one call returns.
//
// What it decides:
// - the steps: change sets, never single patches. Declared pull requests, each with every patch
//   naming it; patches naming no declared pull request grouped by shared commits, else by shared
//   evidence refs. Rulings no set accounts for lead as "no change recorded". Step 0 is the
//   original position: every issue open.
// - the state of each issue at a step: open, thin (dismissed, under two tested axes), fixed
//   (untested), proven (fixed by a tested patch), held (dismissed on two tested axes);
// - what a step touches: elements, groups to open, files to expand;
// - the drawing: units (elements, closed groups, "more" boxes), merged flows with their data
//   labels, ranks, lanes, guards, missing checks, red paths from a weakness to its outcomes, fixed
//   routes, trust boundaries, station numbers;
// - the file tree: per file and directory, touched, open, fixed, coverage, element count;
// - the plain account of a step, the detail of a selection, search.

export function createReplayCore(M, { cap = 40, small = 80 } = {}) {
  const SEV = ['critical', 'high', 'medium', 'low', 'undetermined'];
  const STATES = ['open', 'thin', 'fixed', 'held', 'proven'];
  const LEVELS = ['tested', 'inspected', 'rescanned', 'asserted', 'none'];
  const LAYERS = ['structure', 'flows', 'trust', 'weakness', 'trigger', 'controls', 'evidence'];
  const IMPACTS = ['critical', 'high', 'medium', 'low'];
  const STATE_WORD = { open: 'open', thin: 'dismissed, unproven', fixed: 'fixed, untested', held: 'held, two tested axes', proven: 'fixed, tested' };
  const LEVEL_WORD = { tested: 'test proof', inspected: 'source inspection', rescanned: 'clean rescan', asserted: 'assertion, unverified', none: 'fix report, no rescan' };
  const nodes = M.nodes || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const flows = (M.flows || []).filter((f) => byId.has(f.from) && byId.has(f.to) && f.from !== f.to);
  const findings = M.findings || [];
  const patches = M.patches || [];
  const gById = new Map((M.groups || []).map((g) => [g.id, g]));
  const gOrder = new Map((M.groups || []).map((g, i) => [g.id, i]));
  const name = (x) => (x ? x.plain || x.label || x.title || x.id : '');
  /** A group's chain of groups, outermost first. */
  const chain = (gid) => { const out = []; for (let g = gById.get(gid); g && out.length < 32 && !out.includes(g.id); g = gById.get(g.parent)) out.unshift(g.id); return out; };
  const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
  const outs = new Map(); const ins = new Map();
  for (const f of flows) { push(outs, f.from, f); push(ins, f.to, f); }
  const atOf = (f) => (f.at && f.at.node !== undefined ? [f.at.node] : f.at && f.at.flow ? [f.at.flow.from, f.at.flow.to] : []).filter((id, i, a) => byId.has(id) && a.indexOf(id) === i);
  const names = (k, f) => (k.findings || []).some((id) => id === f.id || id === String(f.id).split('@')[0]);
  const sevOf = (f) => (SEV.includes(f.severity) ? f.severity : 'undetermined');
  const ends = (k) => [k.guard, ...(k.closes || []), ...(k.rejects || [])].filter(Boolean);

  // ---- file paths named by the document
  const PATH_RE = /^[\w@+-][\w@+.-]*(?:\/[\w@+.-]+)*$/;
  const EXT = /\.[A-Za-z][A-Za-z0-9]{0,5}$/;
  const isPath = (s) => typeof s === 'string' && s.length > 0 && s.length < 300 && PATH_RE.test(s) && !s.split('/').includes('..') && (s.includes('/') || EXT.test(s));
  const TOKEN = /[\w@+-][\w@+.-]*(?:\/[\w@+.-]+)+/g;
  const tokens = (s) => (String(s || '').replace(/\w+:\/\/\S+/g, ' ').match(TOKEN) || []).map((t) => t.replace(/\.+$/, '')).filter((t) => isPath(t) && EXT.test(t));
  const fileOfRef = (r) => { const t = String(r || '').trim().split(/\s+/)[0].replace(/^\.\//, '').replace(/:.*$/, ''); return isPath(t) ? t : null; };
  const fileOfNode = (n) => {
    const m = /^node:module:(.+)$/.exec(n.id);
    if (m && isPath(m[1])) return m[1];
    const label = String(n.label || '').replace(/\/+$/, '');
    if (isPath(label)) return label;
    return tokens(n.label)[0] || tokens(n.note)[0] || null;
  };
  const files = new Map();
  const fileRec = (p) => { if (!files.has(p)) files.set(p, { path: p, nodes: new Set(), findings: new Set(), traced: new Set(), sets: new Set() }); return files.get(p); };
  const nodeFile = new Map();
  for (const n of nodes) { const p = fileOfNode(n); if (p) { nodeFile.set(n.id, p); fileRec(p).nodes.add(n.id); } }
  const findingFiles = new Map();
  for (const f of findings) {
    const ps = new Set();
    const src = f.source && fileOfRef(f.source.file);
    if (src) ps.add(src);
    for (const id of atOf(f)) if (nodeFile.has(id)) ps.add(nodeFile.get(id));
    for (const p of ps) fileRec(p).findings.add(f);
    for (const s of (f.source && f.source.steps) || []) { const p = fileOfRef(s.file); if (p) fileRec(p).traced.add(f); }
    findingFiles.set(f, ps);
  }
  const patchFiles = (k) => { const e = k.evidence || {}; return [...(e.refs || []), ...[e.control, ...(e.controls || [])].filter(Boolean).flatMap((c) => [c.ref, c.test])].map(fileOfRef).filter(Boolean); };

  // ---- change sets
  const declared = !!(M.prs && M.prs.length);
  const known = new Set(declared ? M.prs.map((p) => p.id) : []);
  const sets = declared ? M.prs.map((p) => ({ id: p.id, title: p.plain || p.title || p.id, state: p.state || '', files: p.files || [], patches: patches.filter((k) => k.pr === p.id), kind: 'pull request' })) : [];
  // the rest grouped by the commits they share, then by the evidence refs they share
  const rest = patches.filter((k) => !known.has(k.pr));
  const up = rest.map((_, i) => i);
  const find = (i) => { while (up[i] !== i) i = up[i]; return i; };
  const link = (seen, key, i) => { if (seen.has(key)) up[find(i)] = find(seen.get(key)); else seen.set(key, i); };
  const byCommit = new Map(); const byRef = new Map();
  rest.forEach((k, i) => { for (const c of k.commits || []) link(byCommit, c.slice(0, 12), i); });
  rest.forEach((k, i) => { if (!(k.commits || []).length) for (const r of (k.evidence && k.evidence.refs) || []) link(byRef, fileOfRef(r) || r, i); });
  const restSets = new Map();
  rest.forEach((k, i) => {
    const root = find(i);
    if (!restSets.has(root)) restSets.set(root, { id: '', title: '', state: '', files: [], patches: [], kind: 'change set' });
    restSets.get(root).patches.push(k);
  });
  for (const st of restSets.values()) {
    const commits = [...new Set(st.patches.flatMap((k) => (k.commits || []).map((c) => c.slice(0, 12))))];
    const refs = [...new Set(st.patches.flatMap((k) => (k.evidence && k.evidence.refs) || []))];
    st.id = commits.length ? `commits ${commits.join(', ')}` : refs.length ? refs.join(', ') : 'patches without commit or file';
    st.title = st.patches.length === 1 ? name(st.patches[0]) : st.id;
    sets.push(st);
  }
  const setOfFinding = (f) => { let at = -1; sets.forEach((st, i) => { if (f.pr === st.id || st.patches.some((k) => names(k, f))) at = i; }); return at; };
  const loose = findings.filter((f) => (f.status === 'mitigated' || f.status === 'dismissed') && setOfFinding(f) === -1);
  if (loose.length) sets.unshift({ id: 'no change recorded', title: 'no change recorded', state: '', files: [], patches: [], kind: 'rulings', loose: new Set(loose) });
  const rulesOn = (st, f) => (st.loose ? st.loose.has(f) : f.pr === st.id || st.patches.some((k) => names(k, f)));
  const ruledAt = new Map();
  for (const f of findings) sets.forEach((st, i) => { if (rulesOn(st, f)) ruledAt.set(f, i); });
  const patchAt = new Map();
  sets.forEach((st, i) => { for (const k of st.patches) patchAt.set(k, i); });
  for (const [i, st] of sets.entries()) {
    st.fileList = [...new Set([...st.files.map(fileOfRef).filter(Boolean), ...st.patches.flatMap(patchFiles)])];
    const touched = new Set();
    for (const f of findings) if (ruledAt.get(f) === i) for (const id of atOf(f)) touched.add(id);
    for (const k of st.patches) for (const fl of ends(k)) for (const id of [fl.from, fl.to]) if (byId.has(id)) touched.add(id);
    for (const p of st.fileList) for (const id of fileRec(p).nodes) touched.add(id);
    st.touched = touched;
    const tf = new Set(st.fileList);
    for (const id of touched) if (nodeFile.has(id)) tf.add(nodeFile.get(id));
    for (const f of findings) if (ruledAt.get(f) === i) for (const p of findingFiles.get(f)) tf.add(p);
    st.touchedFiles = tf;
    for (const p of tf) fileRec(p).sets.add(i);
  }

  // ---- the state of an issue at a step
  const proves = (k) => !!k.evidence && (k.evidence.level === 'tested' || [k.evidence.control, ...(k.evidence.controls || [])].some((c) => c && c.failsWithout && c.passesWith));
  const testedAxes = (f) => new Set((f.controls || []).filter((c) => c.test).map((c) => c.axis)).size;
  const stateAt = (f, step) => {
    if (!ruledAt.has(f) || ruledAt.get(f) >= step) return 'open';
    if (f.status === 'mitigated') return patches.some((k) => names(k, f) && proves(k)) ? 'proven' : 'fixed';
    if (f.status === 'dismissed') return testedAxes(f) >= 2 ? 'held' : 'thin';
    return 'open';
  };
  const levelOf = (f) => { const ls = patches.filter((k) => names(k, f)).map((k) => (k.evidence && k.evidence.level) || 'asserted'); return ['asserted', 'inspected', 'rescanned', 'tested'].find((l) => ls.includes(l)) || 'none'; };
  const patchLevel = (k) => (k.evidence && LEVELS.includes(k.evidence.level) ? k.evidence.level : 'none');

  // ---- what is drawn where
  const sources = new Set(nodes.filter((n) => n.kind === 'external' && (n.subtype === 'actor' || n.subtype === 'endpoint') && !ins.has(n.id) && outs.has(n.id)).map((n) => n.id));
  if (!sources.size) for (const n of nodes) if (n.kind === 'external' && !ins.has(n.id) && outs.has(n.id)) sources.add(n.id);
  const rejectTo = new Set(patches.flatMap((k) => (k.rejects || []).map((r) => r.to)));
  const outcomes = new Set(nodes.filter((n) => n.impact !== undefined || rejectTo.has(n.id)).map((n) => n.id));
  for (const id of outcomes) sources.delete(id);
  const marked = new Set([...findings.flatMap(atOf), ...patches.flatMap((k) => ends(k).flatMap((e) => [e.from, e.to]))]);
  for (const f of flows) if (f.evidence && f.evidence.method === 'taint') { marked.add(f.from); marked.add(f.to); }
  // files, variables, programs, schedulers and outside endpoints nobody marked are folded away
  const LEAFY = ['file', 'env', 'binary', 'scheduler', 'endpoint'];
  const leaf = (n) => n.kind !== 'process' && LEAFY.includes(n.subtype) && !marked.has(n.id) && !sources.has(n.id) && !outcomes.has(n.id);
  const drawable = nodes.filter((n) => !leaf(n));
  // the tree keeps what code, issues and change sets name; a data file a leaf names stays only
  // under a top directory those already hold (a program's own files, not the host's)
  const strong = (rec) => [...rec.nodes].some((id) => !leaf(byId.get(id))) || rec.findings.size > 0 || rec.traced.size > 0 || rec.sets.size > 0;
  const topOf = (p) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : null);
  const roots = new Set([...files.values()].filter(strong).map((r) => topOf(r.path)).filter((t) => t !== null));
  for (const rec of [...files.values()]) if (!strong(rec) && !roots.has(topOf(rec.path))) { files.delete(rec.path); for (const id of rec.nodes) nodeFile.delete(id); }

  // ---- view state: one object per core, so one per mounted page
  const S = {
    step: 0, scope: drawable.length <= small ? 'all' : 'paths', colour: 'state', follow: true, treeFollow: true,
    open: new Set(drawable.length <= small ? gById.keys() : []), auto: new Set(), extra: new Set(), caps: new Map(),
    treeOpen: new Set(), treeAuto: new Set(), treeShut: new Set(), treeCur: null, sel: null, q: '',
    facets: { layers: new Set(LAYERS), state: new Set(STATES), sev: new Set(SEV), ev: new Set(LEVELS) },
    memo: new Map(),
  };
  const memo = (key, fn) => { if (!S.memo.has(key)) S.memo.set(key, fn()); return S.memo.get(key); };
  const facetKey = () => ['state', 'sev', 'ev'].map((k) => [...S.facets[k]].sort().join(',')).join('|');
  const visible = (f) => S.facets.state.has(stateAt(f, S.step)) && S.facets.sev.has(sevOf(f));
  const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const dirChain = (p) => { const out = []; for (let d = dirOf(p); d !== ''; d = dirOf(d)) out.unshift(d); return out; };

  /** Move to step `k` (clamped). The groups and directories the last step opened close again; the reader's stay. */
  const setStep = (k) => {
    S.step = Math.max(0, Math.min(sets.length, Math.round(Number(k)) || 0));
    S.auto = new Set(); S.treeAuto = new Set(); S.treeShut = new Set(); S.memo = new Map();
    const st = S.step > 0 ? sets[S.step - 1] : null;
    if (st) {
      for (const id of st.touched) { const n = byId.get(id); if (n && n.group !== undefined) for (const g of chain(n.group)) S.auto.add(g); }
      for (const p of st.touchedFiles) for (const d of dirChain(p)) S.treeAuto.add(d);
    }
    return S.step;
  };
  const isOpen = (gid) => S.open.has(gid) || (S.follow && S.auto.has(gid));
  const toggleGroup = (gid) => {
    if (!gById.has(gid)) return false;
    S.memo = new Map();
    if (isOpen(gid)) { S.open.delete(gid); S.auto.delete(gid); return false; }
    for (const g of chain(gid)) S.open.add(g);
    return true;
  };
  const more = (gid) => { S.memo = new Map(); S.caps.set(gid, (S.caps.get(gid) || cap) + cap); };

  // ---- scope: which elements of open groups are drawn singly
  const bfs = (starts, edges, stop) => {
    const prev = new Map(starts.map((s) => [s, null]));
    const q = [...starts];
    while (q.length) { const a = q.shift(); if (stop(a) && !starts.includes(a)) continue; for (const f of edges.get(a) || []) { const b = f.from === a ? f.to : f.from; if (!prev.has(b)) { prev.set(b, a); q.push(b); } } }
    return prev;
  };
  const trail = (prev, end) => { const out = []; for (let x = end; x !== null && x !== undefined; x = prev.get(x)) out.push(x); return out; };
  const scopeSet = () => memo(`scope:${S.scope}`, () => {
    const st = S.step > 0 ? sets[S.step - 1] : null;
    if (S.scope === 'all') return new Set(drawable.map((n) => n.id));
    const out = new Set([...outcomes, ...sources, ...S.extra]);
    const seeds = new Set(findings.flatMap(atOf));
    if (S.scope === 'step') {
      const core = st ? st.touched : seeds;
      for (const id of core) { out.add(id); for (const f of [...(outs.get(id) || []), ...(ins.get(id) || [])]) for (const x of [f.from, f.to]) if (!leaf(byId.get(x))) out.add(x); }
      return out;
    }
    for (const id of marked) out.add(id);
    if (st) for (const id of st.touched) out.add(id);
    for (const id of seeds) {
      const back = bfs([id], ins, (x) => sources.has(x));
      const src = [...back.keys()].find((x) => sources.has(x));
      if (src !== undefined) for (const x of trail(back, src)) out.add(x);
      const fwd = bfs([id], outs, (x) => outcomes.has(x));
      for (const end of [...fwd.keys()].filter((x) => outcomes.has(x)).slice(0, 3)) for (const x of trail(fwd, end)) out.add(x);
    }
    return out;
  });

  // ---- units and merged flows
  const findingsAt = new Map();
  for (const f of findings) for (const id of atOf(f)) push(findingsAt, id, f);
  const units = () => memo(`units:${S.step}:${S.scope}:${S.follow}`, () => {
    const scope = scopeSet();
    const U = new Map(); const of = new Map();
    const add = (uid, rec, id) => { if (!U.has(uid)) U.set(uid, { uid, members: [], ...rec }); U.get(uid).members.push(id); of.set(id, uid); };
    const per = new Map();
    for (const n of nodes) {
      if (sources.has(n.id)) { add(`n:${n.id}`, { type: 'source', node: n, lane: null }, n.id); continue; }
      if (outcomes.has(n.id)) { add(`n:${n.id}`, { type: 'outcome', node: n, lane: null }, n.id); continue; }
      if (leaf(n) && !S.extra.has(n.id)) continue;
      const ch = chain(n.group);
      const closed = ch.find((g) => !isOpen(g));
      if (closed !== undefined) { add(`g:${closed}`, { type: 'group', gid: closed, lane: ch[0] }, n.id); continue; }
      const inner = ch.length ? ch[ch.length - 1] : '';
      if (!scope.has(n.id)) { if (ch.length) add(`m:${inner}`, { type: 'more', gid: inner, lane: ch[0] }, n.id); continue; }
      push(per, inner, n);
    }
    const st = S.step > 0 ? sets[S.step - 1] : null;
    const weight = (n) => (findingsAt.get(n.id) || []).length * 2 + (st && st.touched.has(n.id) ? 1 : 0);
    for (const [inner, list] of per) {
      list.sort((a, b) => weight(b) - weight(a) || order.get(a.id) - order.get(b.id));
      const limit = S.caps.get(inner) || cap;
      list.forEach((n, i) => {
        const lane = inner === '' ? '' : chain(inner)[0];
        if (i < limit || S.extra.has(n.id)) add(`n:${n.id}`, { type: 'node', node: n, lane, gid: inner }, n.id);
        else add(`m:${inner}`, { type: 'more', gid: inner, lane }, n.id);
      });
    }
    const E = new Map();
    for (const f of flows) {
      const a = of.get(f.from); const b = of.get(f.to);
      if (a === undefined || b === undefined || a === b) continue;
      const key = `${a}\n${b}`;
      if (!E.has(key)) E.set(key, { key, from: a, to: b, flows: [], labels: new Map(), taint: false, guards: [], fixed: false, reject: '', live: new Set() });
      const e = E.get(key);
      e.flows.push(f);
      const lab = f.label || f.direction || 'data';
      e.labels.set(lab, (e.labels.get(lab) || 0) + 1);
      if (f.evidence && f.evidence.method === 'taint') e.taint = true;
    }
    return { U, of, E };
  });
  const edgeFor = (E, of, fl) => E.get(`${of.get(fl.from)}\n${of.get(fl.to)}`);
  const landed = (k) => patchAt.has(k) && patchAt.get(k) < S.step;

  /** The drawing at this step: units placed, flows routed, guards, missing checks, red paths, boundaries. */
  const layout = () => memo(`layout:${S.step}:${S.scope}:${S.follow}:${facetKey()}`, () => {
    const { U, of, E } = units();
    const edges = [...E.values()].map((e) => ({ ...e, guards: [], live: new Set(), fixed: false, reject: '' }));
    const EK = new Map(edges.map((e) => [e.key, e]));
    const ofFlow = (fl) => EK.get((edgeFor(E, of, fl) || {}).key);
    for (const k of patches) {
      const on = landed(k);
      if (k.guard) { const e = ofFlow(k.guard); if (e && S.facets.ev.has(patchLevel(k))) e.guards.push({ patch: k.id, name: name(k), landed: on, level: patchLevel(k) }); }
      for (const c of k.closes || []) { const e = ofFlow(c); if (e && on) e.fixed = true; }
      for (const r of k.rejects || []) { const e = ofFlow(r); if (e) e.reject = on ? 'set' : e.reject || 'pending'; }
    }
    // red from where each open weakness sits to the outcomes it can still reach
    const outE = new Map();
    for (const e of edges) push(outE, e.from, e);
    const paths = new Map();
    for (const f of findings) {
      if (!visible(f)) continue;
      const st = stateAt(f, S.step);
      const starts = [...new Set(atOf(f).map((id) => of.get(id)).filter(Boolean))];
      const keys = new Set();
      if (st === 'open' || st === 'thin') {
        const prev = new Map(starts.map((s) => [s, null]));
        const q = [...starts];
        while (q.length) { const a = q.shift(); if (U.get(a).type === 'outcome' && !starts.includes(a)) continue; for (const e of outE.get(a) || []) if (!e.fixed && !e.reject && !prev.has(e.to)) { prev.set(e.to, e); q.push(e.to); } }
        const hit = [...prev.keys()].filter((u) => U.get(u).type === 'outcome' && U.get(u).node.impact !== undefined && !starts.includes(u)).slice(0, 4);
        for (const u of hit) for (let e = prev.get(u); e; e = prev.get(e.from)) { keys.add(e.key); e.live.add(f.id); }
      } else {
        for (const k of patches.filter((p) => names(p, f))) for (const fl of ends(k)) { const e = ofFlow(fl); if (e) keys.add(e.key); }
      }
      paths.set(f.id, { units: starts, edges: keys });
    }
    // a check missing where an open weakness has none on the way in
    for (const f of findings) {
      if (!visible(f) || !['open', 'thin'].includes(stateAt(f, S.step))) continue;
      for (const u of new Set(atOf(f).map((id) => of.get(id)).filter(Boolean))) {
        const inc = edges.filter((e) => e.to === u);
        if (inc.length && !inc.some((e) => e.guards.length)) { const e = inc.find((x) => U.get(x.from).type === 'source') || inc[0]; if (!e.guards.some((g) => g.missing)) e.guards.push({ patch: '', name: 'check missing', landed: false, missing: true, level: 'none' }); }
      }
    }
    // ranks: the longest path from the sources over the lane units, a cycle cut where a depth-first
    // walk from the sources meets it again, so flows run left to right wherever they can
    const laneUnits = [...U.values()].filter((u) => u.type !== 'source' && u.type !== 'outcome');
    const isLane = (uid) => { const t = U.get(uid).type; return t !== 'source' && t !== 'outcome'; };
    const back = new Set();
    const seen = new Map();
    const dfs = (start) => {
      const stack = [[start, 0]];
      seen.set(start, 1);
      while (stack.length) {
        const top = stack[stack.length - 1];
        const list = (outE.get(top[0]) || []).filter((e) => isLane(e.to));
        if (top[1] >= list.length) { seen.set(top[0], 2); stack.pop(); continue; }
        const e = list[top[1]];
        top[1] += 1;
        if (seen.get(e.to) === 1) back.add(e.key);
        else if (!seen.has(e.to)) { seen.set(e.to, 1); stack.push([e.to, 0]); }
      }
    };
    for (const u of U.values()) if (u.type === 'source') for (const e of outE.get(u.uid) || []) if (isLane(e.to) && !seen.has(e.to)) dfs(e.to);
    for (const u of laneUnits) if (!seen.has(u.uid)) dfs(u.uid);
    const rank = new Map(laneUnits.map((u) => [u.uid, 1]));
    for (const u of U.values()) if (u.type === 'source') rank.set(u.uid, 0);
    const dag = edges.filter((e) => isLane(e.from) && isLane(e.to) && !back.has(e.key));
    const indeg = new Map(laneUnits.map((u) => [u.uid, 0]));
    for (const e of dag) indeg.set(e.to, indeg.get(e.to) + 1);
    const ready = laneUnits.filter((u) => indeg.get(u.uid) === 0).map((u) => u.uid);
    while (ready.length) {
      const a = ready.shift();
      for (const e of dag) if (e.from === a) { rank.set(e.to, Math.min(10, Math.max(rank.get(e.to), rank.get(a) + 1))); indeg.set(e.to, indeg.get(e.to) - 1); if (indeg.get(e.to) === 0) ready.push(e.to); }
    }
    const maxRank = Math.max(1, ...laneUnits.map((u) => rank.get(u.uid)));
    // lanes: top-level groups in document order, ungrouped last; rows follow a predecessor where they can
    const laneIds = [...new Set(laneUnits.map((u) => u.lane))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : gOrder.get(a) - gOrder.get(b)));
    const COLW = 260; const ROWH = 104; const HEAD = 34; const GAP = 14; const TOP = 24; const SRCX = 92; const TRUNK = 176; const COL1 = 404; const R = 14;
    const pos = new Map();
    const outList = [...U.values()].filter((u) => u.type === 'outcome').sort((a, b) => (IMPACTS.indexOf(a.node.impact) + 5) % 5 - (IMPACTS.indexOf(b.node.impact) + 5) % 5 || order.get(a.node.id) - order.get(b.node.id));
    const outRank = new Map(outList.map((u, i) => [u.uid, i]));
    const toOut = new Map();
    for (const e of edges) if (U.get(e.to).type === 'outcome') push(toOut, e.from, e);
    for (const list of toOut.values()) list.sort((a, b) => outRank.get(a.to) - outRank.get(b.to));
    const chipSlot = new Map();
    const sortKey = (u) => [u.gid !== undefined && gOrder.has(u.gid) ? gOrder.get(u.gid) : -1, u.type === 'more' ? 1 : 0, order.get(u.members[0])];
    const cmp = (a, b) => { const x = sortKey(a); const y = sortKey(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
    const srcList = [...U.values()].filter((u) => u.type === 'source').sort((a, b) => order.get(a.node.id) - order.get(b.node.id));
    srcList.forEach((u, i) => pos.set(u.uid, { x: SRCX, y: TOP + HEAD + i * ROWH + 22 }));
    const lanes = [];
    let y = TOP;
    for (const lid of laneIds) {
      const mine = laneUnits.filter((u) => u.lane === lid);
      const rows = new Map();
      const rowOf = new Map();
      for (let r = 1; r <= maxRank; r += 1) {
        const col = mine.filter((u) => rank.get(u.uid) === r).sort(cmp);
        const taken = new Set();
        const later = [];
        for (const u of col) {
          const pre = edges.filter((e) => e.to === u.uid && rowOf.has(e.from) && rank.get(e.from) === r - 1).map((e) => rowOf.get(e.from)).find((row) => !taken.has(row));
          if (pre !== undefined) { taken.add(pre); rowOf.set(u.uid, pre); } else later.push(u);
        }
        for (const u of later) { let row = 0; while (taken.has(row)) row += 1; taken.add(row); rowOf.set(u.uid, row); }
        rows.set(r, taken.size);
      }
      const n = Math.max(1, ...mine.map((u) => rowOf.get(u.uid) + 1));
      // a row grows to hold one line per outcome chip of its stations, each on a slot of its own
      const slots = Array.from({ length: n }, () => 0);
      for (const u of mine) slots[rowOf.get(u.uid)] += (toOut.get(u.uid) || []).length;
      const tops = [];
      let acc = y + HEAD;
      for (let r = 0; r < n; r += 1) { tops.push(acc); acc += slots[r] ? Math.max(ROWH, 96 + 24 * slots[r]) : ROWH; }
      for (const u of mine) pos.set(u.uid, { x: COL1 + (rank.get(u.uid) - 1) * COLW, y: tops[rowOf.get(u.uid)] + 22 });
      const used = slots.map(() => 0);
      for (const u of [...mine].sort((a, b) => rank.get(a.uid) - rank.get(b.uid))) {
        const row = rowOf.get(u.uid);
        for (const e of toOut.get(u.uid) || []) { chipSlot.set(e.key, tops[row] + 22 + 66 + used[row] * 24); used[row] += 1; }
      }
      const h = acc - y;
      const g = gById.get(lid);
      lanes.push({ id: lid, label: lid === '' ? 'Ungrouped elements' : name(g), y, h, trust: !!g && g.boundary === 'trust', units: mine.map((u) => u.uid) });
      y += h + GAP;
    }
    const OUTX = COL1 + maxRank * COLW + 20;
    // outcomes: one chip per flow that ends in one, under the station it leaves, so each harm sits on its own line
    const chips = [];
    for (const [from, list] of toOut) list.forEach((e, k) => chips.push({ key: e.key, uid: e.to, from, x: OUTX, y: chipSlot.has(e.key) ? chipSlot.get(e.key) : pos.get(from).y + 66 + k * 24, k }));
    const chipAt = new Map(chips.map((c) => [c.key, c]));
    outList.forEach((u) => { const c = chips.find((x) => x.uid === u.uid); pos.set(u.uid, { x: OUTX, y: c ? c.y : TOP }); });
    const H = Math.max(y, TOP + HEAD + srcList.length * ROWH, ...chips.map((c) => c.y + 40)) + 30;
    const W = OUTX + 300;
    // numbers in reading order: sources, lanes (column, then row), outcomes
    const reading = [...srcList.map((u) => u.uid), ...lanes.flatMap((l) => [...l.units].sort((a, b) => pos.get(a).x - pos.get(b).x || pos.get(a).y - pos.get(b).y)), ...outList.map((u) => u.uid)];
    const num = new Map(reading.map((uid, i) => [uid, i + 1]));
    // ports: each station's flows spread over its height in the order of where they go
    const port = new Map();
    const spreadPorts = (list, side) => { const n = list.length; const gap = n > 1 ? Math.min(12, 26 / (n - 1)) : 0; list.forEach((e, i) => port.set(`${side}\n${e.key}`, (i - (n - 1) / 2) * gap)); };
    for (const u of U.keys()) {
      spreadPorts(edges.filter((e) => e.to === u).sort((a, b) => pos.get(a.from).y - pos.get(b.from).y || pos.get(a.from).x - pos.get(b.from).x), 'in');
      if (U.get(u).type === 'source') { for (const e of edges.filter((x) => x.from === u)) port.set(`out\n${e.key}`, 0); continue; }
      spreadPorts(edges.filter((e) => e.from === u).sort((a, b) => pos.get(a.to).y - pos.get(b.to).y || pos.get(a.to).x - pos.get(b.to).x), 'out');
    }
    const r1 = (v) => Math.round(v * 10) / 10;
    const routed = edges.map((e, i) => {
      const a = pos.get(e.from); const chip = chipAt.get(e.key);
      const b = chip ? { x: OUTX - 4 + R, y: chip.y } : pos.get(e.to);
      const ay = r1(a.y + port.get(`out\n${e.key}`)); const by = chip ? chip.y : r1(b.y + port.get(`in\n${e.key}`));
      const src = U.get(e.from).type === 'source';
      const forward = b.x > a.x + 40;
      let d; let lx; let room;
      if (chip && !src) { const cx = a.x + 92; d = `M${a.x + R},${ay} H${cx} V${by} H${b.x - R}`; lx = cx + 8; room = b.x - R - lx; }
      else if (src) { d = `M${a.x + R},${ay} H${TRUNK} V${by} H${b.x - R}`; lx = TRUNK + 10; room = b.x - R - lx; }
      else if (forward) { const cx = a.x + 104 + (i % 5) * 4; d = `M${a.x + R},${ay} H${cx} V${by} H${b.x - R}`; lx = cx + 8; room = b.x - R - lx; }
      else if (Math.abs(b.x - a.x) <= 40) { const cx = a.x + R + 36 + (i % 4) * 5; d = `M${a.x + R},${ay} H${cx} V${by} H${b.x + R + 8}`; lx = cx + 6; room = 130; }
      else { const cx = a.x + R + 30 + (i % 4) * 5; const ty = by - 46; d = `M${a.x + R},${ay} H${cx} V${ty} H${b.x - R - 30} V${by} H${b.x - R}`; lx = b.x - R - 26; room = cx - lx; }
      const guards = e.guards.map((g, k) => ({ ...g, x: b.x - R - 34 - k * 38, y: by }));
      const space = guards.length ? guards.length * 38 + 20 : 0;
      const labels = [...e.labels].sort((p, q2) => q2[1] - p[1] || (p[0] < q2[0] ? -1 : 1));
      const text = `${labels.slice(0, 2).map(([l]) => l).join(' · ')}${labels.length > 2 ? ' …' : ''}${e.flows.length > 1 ? ` ×${e.flows.length}` : ''}`;
      const cls = e.live.size ? 'live' : e.fixed || e.reject === 'set' ? 'fixed' : e.reject === 'pending' ? 'pending' : '';
      return { key: e.key, from: e.from, to: e.to, flows: e.flows, chip: !!chip, d, lx, ly: r1(by - 5), text, full: labels.map(([l, c]) => (c > 1 ? `${l} ×${c}` : l)).join(', '), max: Math.max(4, Math.floor((room - space) / 5.6)), cls, taint: e.taint, src, guards, live: [...e.live], count: e.flows.length };
    });
    // label placement: station names and guard words are fixed; a flow label that would sit on one
    // of them, or on an earlier label, moves a line up or down, and is hidden (title only) when no line is free
    const CH = 5.6;
    const hit = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
    const taken = [];
    for (const u of U.values()) {
      const p = pos.get(u.uid); const t = title(u);
      const rows = Math.min(2, Math.ceil(t.length / 26) || 1) + (u.type !== 'group' && u.type !== 'more' && locOf(u) ? 1 : 0);
      const half = Math.min(32, Math.max(t.length, 6)) * 3.1;
      taken.push({ x1: p.x - half, x2: p.x + half, y1: p.y + R + 4, y2: p.y + R + 6 + rows * 13 });
    }
    for (const e of routed) for (const g of e.guards) {
      const below = { x1: g.x - 24, x2: g.x + 24, y1: g.y + 11, y2: g.y + 24 };
      g.ty = taken.some((b) => hit(below, b)) ? g.y - (g.missing ? 13 : 29) : g.y + (g.missing ? 21 : 19);
      taken.push({ x1: g.x - 24, x2: g.x + 24, y1: g.ty - 10, y2: g.ty + 3 }, { x1: g.x - 14, x2: g.x + 14, y1: g.y - 25, y2: g.y + 9 });
    }
    // every horizontal run of every flow is an obstacle too, so no label is struck through by a line
    const runs = (d) => { const out = []; let x = 0; let y = 0; for (const [, op, a, b] of d.matchAll(/([MHV])([-\d.]+)(?:,([-\d.]+))?/g)) { if (op === 'M') { x = +a; y = +b; } else if (op === 'H') { out.push({ x1: Math.min(x, +a), x2: Math.max(x, +a), y1: y - 1, y2: y + 1 }); x = +a; } else y = +a; } return out; };
    for (const e of routed) taken.push(...runs(e.d));
    for (const e of routed) {
      const wide = Math.min(e.text.length, e.max) * CH;
      const box = (y) => ({ x1: e.lx, x2: e.lx + wide, y1: y - 9, y2: y + 2 });
      const tries = [0, -11, 11, -22, 22].map((d) => r1(e.ly + d));
      const y = tries.find((t) => !taken.some((b) => hit(box(t), b)));
      if (y === undefined) { e.hide = true; continue; }
      e.ly = y;
      taken.push(box(y));
    }
    // trust boundaries: a dashed enclosure round what a trust group holds
    const holds = (u, gid) => { const g = u.type === 'group' || u.type === 'more' ? u.gid : u.node.group; return g !== undefined && g !== '' && chain(g).includes(gid); };
    const boundaries = [];
    for (const g of M.groups || []) {
      if (g.boundary !== 'trust') continue;
      const held = [...U.values()].filter((u) => holds(u, g.id));
      const inLanes = held.filter((u) => u.type !== 'source' && u.type !== 'outcome');
      const inside = inLanes.length ? inLanes : held.filter((u) => u.type === 'source');
      if (!inside.length) continue;
      const depth = chain(g.id).length - 1;
      const pad = Math.max(10, 28 - depth * 8);
      const xs = inside.map((u) => pos.get(u.uid).x); const ys = inside.map((u) => pos.get(u.uid).y);
      boundaries.push({ id: g.id, label: name(g), x: Math.max(4, Math.min(...xs) - 90 - pad + 10), y: Math.min(...ys) - 22 - pad, w: Math.max(...xs) - Math.min(...xs) + 180 + pad * 2 - 20, h: Math.max(...ys) - Math.min(...ys) + 84 + pad * 2 });
    }
    const placed = [...U.values()].map((u) => ({ ...u, ...pos.get(u.uid), num: num.get(u.uid), rank: rank.get(u.uid) || 0 }));
    return { units: placed, edges: routed, chips, lanes, boundaries, paths, trunk: srcList.length ? { x: TRUNK, y1: Math.min(...srcList.map((u) => pos.get(u.uid).y)), y2: Math.max(y - GAP, ...srcList.map((u) => pos.get(u.uid).y)) } : null, w: W, h: H, R };
  });

  // ---- what a unit shows
  const unitFindings = (u) => u.members.flatMap((id) => findingsAt.get(id) || []).filter((f, i, a) => a.indexOf(f) === i);
  const worstState = (fs) => { const sts = fs.filter(visible).map((f) => stateAt(f, S.step)); return STATES.find((s) => sts.includes(s)) || ''; };
  const coverageOf = (ids) => { let c = 0; let t = 0; for (const id of ids) { const cv = byId.get(id) && byId.get(id).coverage; if (cv && cv.lines && cv.lines.total > 0) { c += cv.lines.covered; t += cv.lines.total; } } return t ? c / t : null; };
  const shapeOf = (u) => (u.type === 'group' ? 'group' : u.type === 'more' ? 'more' : u.node.kind === 'external' ? 'square' : u.node.kind === 'store' ? 'store' : 'circle');
  const locOf = (u) => {
    if (u.type === 'group' || u.type === 'more') return `${u.members.length} elements`;
    const fs = unitFindings(u).find((f) => f.source);
    if (fs) return `${fs.source.file}${fs.source.line ? `:${fs.source.line}` : ''}`;
    const p = nodeFile.get(u.node.id);
    return p || (u.node.label !== name(u.node) ? u.node.label : '');
  };
  const title = (u) => (u.type === 'group' ? name(gById.get(u.gid)) : u.type === 'more' ? `${u.members.length} more` : name(u.node));
  /** Every station, restated for the step: state, severity, touched, selected, search hit. */
  const stations = () => {
    const L = layout();
    const em = emphasis();
    const st = S.step > 0 ? sets[S.step - 1] : null;
    const q = S.q.trim().toLowerCase();
    return L.units.filter((u) => u.type !== 'outcome').map((u) => {
      const fs = unitFindings(u);
      const open = fs.filter((f) => visible(f) && ['open', 'thin'].includes(stateAt(f, S.step)));
      const sev = SEV.find((s) => open.some((f) => sevOf(f) === s)) || '';
      const cov = coverageOf(u.members);
      const state = S.colour === 'state' ? worstState(fs) : '';
      const covCls = S.colour === 'coverage' ? (cov === null ? 'cov-none' : cov < 0.8 ? 'cov-low' : 'cov-ok') : '';
      return { uid: u.uid, type: u.type, shape: shapeOf(u), x: u.x, y: u.y, num: u.num, name: title(u), loc: locOf(u), state, cov, covCls, sev: sev === 'undetermined' ? '' : sev, open: open.length, issues: fs.length,
        impact: u.type === 'outcome' ? u.node.impact || '' : '', lane: u.lane, touched: !!st && u.members.some((id) => st.touched.has(id)), on: em.units.has(u.uid), hit: q.length >= 2 && u.members.some((id) => matchesNode(id, q)), gid: u.gid };
    });
  };
  /** An outcome: what lands there now, and which issues and patches say so. */
  /** Every outcome chip, restated for the step: what lands there along this flow now, and which issues and patches say so. */
  const outcomeChips = () => {
    const L = layout();
    const em = emphasis();
    const byKey = new Map(L.edges.map((e) => [e.key, e]));
    const numOf = new Map(L.units.map((u) => [u.uid, u.num]));
    return L.chips.map((c) => {
      const e = byKey.get(c.key);
      const n = units().U.get(c.uid).node;
      const on = (list) => patches.filter((k) => landed(k) && (k[list] || []).some((x) => e.flows.some((f) => f.from === x.from && f.to === x.to)));
      const rej = on('rejects'); const closed = on('closes');
      const isReject = patches.some((k) => (k.rejects || []).some((x) => e.flows.some((f) => f.from === x.from && f.to === x.to)));
      const ids = (ks) => [...new Set(ks.flatMap((k) => findings.filter((f) => names(k, f)).map((f) => f.id.split('@')[0])))];
      const state = e.live.length ? 'open' : rej.length ? 'proven' : closed.length ? (closed.every(proves) ? 'proven' : 'fixed') : '';
      const word = e.live.length ? `open · ${e.live.slice(0, 3).join(', ')}${e.live.length > 3 ? ` +${e.live.length - 3}` : ''}`
        : rej.length ? `typed rejection · ${rej.map((k) => k.id).join(', ')}` : isReject ? 'typed rejection, not landed'
          : closed.length ? `closed by ${closed.map((k) => k.id).join(', ')} · ${ids(closed).join(', ')}` : 'no open path';
      return { key: c.key, uid: c.uid, from: c.from, x: c.x, y: c.y, num: numOf.get(c.uid), name: name(n), impact: n.impact || '', shape: n.kind === 'store' ? 'store' : 'square', state, word, on: em.units.has(c.uid) || em.edges.has(c.key) };
    });
  };

  // ---- emphasis: one selection at a time, in every region
  const emphasis = () => {
    const L = layout();
    const { of } = units();
    const out = { units: new Set(), edges: new Set(), file: null, node: null, finding: null };
    const sel = S.sel;
    if (!sel) return out;
    const around = (uid) => { out.units.add(uid); for (const e of L.edges) if (e.from === uid || e.to === uid) out.edges.add(e.key); };
    if (sel.kind === 'finding') {
      const p = L.paths.get(sel.id);
      const f = findings.find((x) => x.id === sel.id);
      out.finding = sel.id;
      if (f) for (const id of atOf(f)) if (of.has(id)) out.units.add(of.get(id));
      if (p) for (const k of p.edges) { out.edges.add(k); const e = L.edges.find((x) => x.key === k); if (e) { out.units.add(e.from); out.units.add(e.to); } }
      if (f && atOf(f).length) out.node = atOf(f)[0];
    } else if (sel.kind === 'node') { out.node = sel.id; if (of.has(sel.id)) around(of.get(sel.id)); }
    else if (sel.kind === 'unit') around(sel.id);
    else if (sel.kind === 'lane') { const l = L.lanes.find((x) => x.id === sel.id); for (const uid of l ? l.units : []) around(uid); }
    else if (sel.kind === 'file') { out.file = sel.id; for (const id of (files.get(sel.id) || { nodes: [] }).nodes) if (of.has(id)) around(of.get(id)); }
    if (out.node && nodeFile.has(out.node)) out.file = nodeFile.get(out.node);
    return out;
  };
  /** Open whatever hides an element and draw it singly. */
  const revealNode = (id) => {
    const n = byId.get(id);
    if (!n) return false;
    S.memo = new Map();
    if (n.group !== undefined) for (const g of chain(n.group)) S.open.add(g);
    S.extra.add(id);
    return true;
  };
  const revealFile = (p) => { for (const d of dirChain(p)) { S.treeOpen.add(d); S.treeShut.delete(d); } S.treeCur = p; };
  /** Select something: an element, a unit, a file or an issue; the other regions follow. */
  const select = (kind, id) => {
    if (kind === null) { S.sel = null; return null; }
    if (kind === 'node') { revealNode(id); if (nodeFile.has(id)) revealFile(nodeFile.get(id)); }
    if (kind === 'file') { for (const n of [...(files.get(id) || { nodes: [] }).nodes].slice(0, 30)) revealNode(n); revealFile(id); }
    if (kind === 'finding') { const f = findings.find((x) => x.id === id); if (f) for (const n of atOf(f)) { revealNode(n); if (nodeFile.has(n)) revealFile(nodeFile.get(n)); } }
    if (kind === 'unit') { const u = units().U.get(id); if (u && u.type === 'node') return select('node', u.node.id); if (u && u.type === 'source') return select('node', u.node.id); if (u && u.type === 'outcome') return select('node', u.node.id); }
    S.sel = { kind, id };
    return S.sel;
  };

  // ---- the file tree
  const rollFile = (rec) => {
    const st = S.step > 0 ? sets[S.step - 1] : null;
    const fs = [...rec.findings].filter(visible);
    const c = { covered: 0, total: 0 };
    for (const id of rec.nodes) { const cv = byId.get(id).coverage; if (cv && cv.lines && cv.lines.total > 0) { c.covered += cv.lines.covered; c.total += cv.lines.total; } }
    return { touched: !!st && rec.sets.has(S.step - 1), open: fs.filter((f) => ['open', 'thin'].includes(stateAt(f, S.step))).length, fixed: fs.filter((f) => ['fixed', 'proven', 'held'].includes(stateAt(f, S.step))).length, cov: c.total ? c.covered / c.total : null, covered: c.covered, total: c.total, elements: rec.nodes.size, traced: rec.traced.size };
  };
  const tree = (() => {
    const dirs = new Map([['', { path: '', name: '', dirs: [], files: [] }]]);
    const ensure = (d) => { if (dirs.has(d)) return dirs.get(d); const rec = { path: d, name: d.slice(d.lastIndexOf('/') + 1), dirs: [], files: [] }; dirs.set(d, rec); ensure(dirOf(d)).dirs.push(rec); return rec; };
    for (const p of [...files.keys()].sort()) ensure(dirOf(p)).files.push(files.get(p));
    for (const d of dirs.values()) d.dirs.sort((a, b) => (a.name < b.name ? -1 : 1));
    return dirs;
  })();
  const rolls = () => memo(`rolls:${S.step}:${facetKey()}`, () => {
    const out = new Map();
    for (const rec of files.values()) out.set(`f:${rec.path}`, rollFile(rec));
    const up2 = (d) => {
      const r = { touched: false, open: 0, fixed: 0, covered: 0, total: 0, elements: 0, traced: 0, files: 0 };
      for (const sub of d.dirs) { const s = up2(sub); r.touched = r.touched || s.touched; r.open += s.open; r.fixed += s.fixed; r.covered += s.covered; r.total += s.total; r.elements += s.elements; r.files += s.files; }
      for (const f of d.files) { const s = out.get(`f:${f.path}`); r.touched = r.touched || s.touched; r.open += s.open; r.fixed += s.fixed; r.covered += s.covered; r.total += s.total; r.elements += s.elements; r.files += 1; }
      r.cov = r.total ? r.covered / r.total : null;
      out.set(`d:${d.path}`, r);
      return r;
    };
    up2(tree.get(''));
    return out;
  });
  const matchesNode = (id, q) => { const n = byId.get(id); return `${n.id} ${n.label || ''} ${n.plain || ''}`.toLowerCase().includes(q) || (findingsAt.get(id) || []).some((f) => matchesFinding(f, q)); };
  const matchesFinding = (f, q) => `${f.id} ${f.title || ''} ${f.cwe || ''} ${(f.source && `${f.source.rule} ${f.source.file} ${f.source.message || ''}`) || ''}`.toLowerCase().includes(q);
  const fileMatches = (q) => new Set([...files.values()].filter((rec) => rec.path.toLowerCase().includes(q) || [...rec.nodes].some((id) => matchesNode(id, q)) || [...rec.findings].some((f) => matchesFinding(f, q))).map((r) => r.path));
  /** The rows the tree shows, in order: directories expand for the reader, for the step (when asked), and for a search. */
  const treeRows = () => {
    const q = S.q.trim().toLowerCase();
    const match = q.length >= 2 ? fileMatches(q) : null;
    const keep = match ? new Set([...match].flatMap(dirChain)) : null;
    const R2 = rolls();
    const em = emphasis();
    const rows = [];
    const isOpenDir = (d) => !!keep || (!S.treeShut.has(d) && (S.treeOpen.has(d) || (S.treeFollow && S.treeAuto.has(d))));
    const walk = (d, depth) => {
      for (const sub of d.dirs) {
        if (keep && !keep.has(sub.path)) continue;
        const open = isOpenDir(sub.path);
        rows.push({ key: `d:${sub.path}`, path: sub.path, name: sub.name, depth, dir: true, open, roll: R2.get(`d:${sub.path}`), cur: S.treeCur === `d:${sub.path}`, on: false });
        if (open) walk(sub, depth + 1);
      }
      for (const f of d.files) {
        if (match && !match.has(f.path)) continue;
        rows.push({ key: `f:${f.path}`, path: f.path, name: f.path.slice(f.path.lastIndexOf('/') + 1), depth, dir: false, open: false, roll: R2.get(`f:${f.path}`), cur: S.treeCur === f.path, on: em.file === f.path });
      }
    };
    walk(tree.get(''), 0);
    return rows;
  };
  const toggleDir = (d) => {
    const open = treeRows().some((r) => r.key === `d:${d}` && r.open);
    if (open) { S.treeOpen.delete(d); S.treeShut.add(d); return false; }
    S.treeShut.delete(d); S.treeOpen.add(d);
    return true;
  };
  /** Keyboard in the tree: -> what to do with the row the cursor is on. */
  const treeKey = (key) => {
    const rows = treeRows();
    if (!rows.length) return null;
    const at = Math.max(0, rows.findIndex((r) => r.cur || r.key === S.treeCur || r.key === `f:${S.treeCur}`));
    const cur = rows[at];
    const curKey = (r) => (r.dir ? r.key : r.path);
    if (key === 'ArrowDown') { S.treeCur = curKey(rows[Math.min(rows.length - 1, at + 1)]); return 'move'; }
    if (key === 'ArrowUp') { S.treeCur = curKey(rows[Math.max(0, at - 1)]); return 'move'; }
    if (key === 'Home') { S.treeCur = curKey(rows[0]); return 'move'; }
    if (key === 'End') { S.treeCur = curKey(rows[rows.length - 1]); return 'move'; }
    if (key === 'ArrowRight' && cur.dir && !cur.open) { toggleDir(cur.path); S.treeCur = cur.key; return 'open'; }
    if (key === 'ArrowLeft' && cur.dir && cur.open) { toggleDir(cur.path); S.treeCur = cur.key; return 'close'; }
    if (key === 'ArrowLeft' && dirOf(cur.path) !== '') { S.treeCur = `d:${dirOf(cur.path)}`; return 'move'; }
    if (key === 'Enter' || key === ' ') { if (cur.dir) { toggleDir(cur.path); S.treeCur = cur.key; return 'open'; } select('file', cur.path); return 'select'; }
    return null;
  };

  // ---- plain words
  const reachMemo = new Map();
  const impactsOf = (f) => {
    if (reachMemo.has(f)) return reachMemo.get(f);
    const seen = new Set(atOf(f)); const q = [...seen];
    while (q.length) for (const fl of outs.get(q.shift()) || []) if (!seen.has(fl.to)) { seen.add(fl.to); q.push(fl.to); }
    const out = [...seen].map((id) => byId.get(id)).filter((n) => n.impact !== undefined).sort((a, b) => IMPACTS.indexOf(a.impact) - IMPACTS.indexOf(b.impact) || order.get(a.id) - order.get(b.id)).map((n) => ({ label: name(n), level: n.impact }));
    reachMemo.set(f, out);
    return out;
  };
  const placeOf = (f) => (f.source ? `${f.source.file}${f.source.line ? `:${f.source.line}` : ''}` : atOf(f).map((id) => name(byId.get(id))).join(' to ') || 'no element');
  const basisOf = (f, st) => {
    if (st === 'open') return f.source ? `${f.source.tool || 'scanner'} report, no ruling` : 'no ruling recorded';
    if (st === 'thin') return `dismissal, ${testedAxes(f)} tested ${testedAxes(f) === 1 ? 'axis' : 'axes'}`;
    if (st === 'held') return `${testedAxes(f)} tested controls`;
    if (st === 'proven') return patches.some((k) => names(k, f) && k.evidence && [k.evidence.control, ...(k.evidence.controls || [])].some((c) => c && c.failsWithout && c.passesWith)) ? 'test failing without fix' : LEVEL_WORD.tested;
    return LEVEL_WORD[levelOf(f)];
  };
  const hazard = (f) => {
    const st = stateAt(f, S.step);
    const imp = impactsOf(f);
    const set = ruledAt.has(f) ? sets[ruledAt.get(f)] : null;
    // a patch counts as change once its step has passed; until then it is planned, with its step
    const mine = patches.filter((k) => names(k, f)).map((k) => ({ id: k.id, title: name(k), note: k.note || '', step: patchAt.has(k) ? patchAt.get(k) + 1 : 0, landed: landed(k) }));
    const change = mine.filter((c) => c.landed);
    const planned = mine.filter((c) => !c.landed);
    if (!mine.length && set && ruledAt.get(f) < S.step) change.push({ id: set.id, title: set.title, note: f.note || '', step: ruledAt.get(f) + 1, landed: true });
    return { id: f.id, risk: f.title && f.title !== f.id ? f.title : (f.source && f.source.rule) || f.cwe || 'unnamed weakness', outcome: imp.length ? `${imp[0].label} (${imp[0].level})` : '', where: placeOf(f), severity: sevOf(f), state: st, stateWord: STATE_WORD[st], basis: basisOf(f, st), change, planned, node: atOf(f)[0] || null, cwe: f.cwe || '' };
  };
  const worstFirst = (a, b) => STATES.indexOf(a.state) - STATES.indexOf(b.state) || SEV.indexOf(a.severity) - SEV.indexOf(b.severity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  /** The step in plain terms: counts, what this change set dealt with, what it names and leaves open, what is still open. */
  const account = () => {
    const st = S.step > 0 ? sets[S.step - 1] : null;
    const all = findings.map(hazard);
    const n = (xs) => all.filter((h) => xs.includes(h.state)).length;
    return { step: S.step, total: sets.length, set: st ? { id: st.id, title: st.title, state: st.state, kind: st.kind, files: st.touchedFiles.size, patches: st.patches.map((k) => k.id), elements: st.touched.size } : null,
      counts: { found: all.length, dealt: n(['fixed', 'proven', 'held']), open: n(['open', 'thin']), thin: n(['thin']), proven: n(['proven', 'held']) },
      dealt: st ? findings.filter((f) => rulesOn(st, f) && ['fixed', 'proven', 'held'].includes(stateAt(f, S.step))).map(hazard).sort(worstFirst) : [],
      // ruled here and not closed: the same weakness where the change does not reach, or a dismissal on too few tested axes
      beyond: st ? findings.filter((f) => rulesOn(st, f) && ['open', 'thin'].includes(stateAt(f, S.step))).map(hazard).sort(worstFirst) : [],
      open: all.filter((h) => h.state === 'open' || h.state === 'thin').sort(worstFirst) };
  };
  /** Checks and tests, one row per patch: what it checks, where, the test that shows it, and whether it has landed by the step shown. */
  const checks = () => patches.map((k) => {
    const cs = [].concat(k.evidence && k.evidence.control ? [k.evidence.control] : [], (k.evidence && k.evidence.controls) || []);
    const proved = cs.some((c) => c && c.failsWithout === true && c.passesWith === true);
    const at = k.guard ? byId.get(k.guard.to) : null;
    return { id: k.id, title: name(k), step: patchAt.get(k) + 1, landed: landed(k), now: patchAt.get(k) === S.step - 1,
      where: at ? `${name(at)}${nodeFile.has(at.id) ? ` · ${nodeFile.get(at.id)}` : ''}` : ((k.evidence && k.evidence.refs) || []).join(', ') || 'no place recorded',
      what: k.note || '', test: cs.map((c) => c && (c.test || c.ref)).filter(Boolean).join('; ') || 'none named',
      proof: proved ? 'fails without, passes with' : cs.length ? 'test named, not shown failing' : LEVEL_WORD[patchLevel(k)], level: patchLevel(k), findings: [...(k.findings || [])] };
  });
  /** Every step's counts, for the step menu and the report. */
  const steps = () => {
    const keep = S.step;
    const out = [];
    for (let i = 0; i <= sets.length; i += 1) {
      S.step = i;
      const c = findings.map((f) => stateAt(f, i));
      out.push({ step: i, title: i === 0 ? 'original position, unfixed' : sets[i - 1].title, id: i === 0 ? '' : sets[i - 1].id, open: c.filter((s) => s === 'open' || s === 'thin').length, dealt: c.filter((s) => ['fixed', 'proven', 'held'].includes(s)).length });
    }
    S.step = keep;
    return out;
  };

  // ---- detail of the selection
  const flowList = (id, dir) => ((dir === 'in' ? ins : outs).get(id) || []).map((f) => ({ id: dir === 'in' ? f.from : f.to, name: name(byId.get(dir === 'in' ? f.from : f.to)), data: f.label || f.direction || 'data' }));
  const findingRow = (f) => ({ id: f.id, title: f.title || '', severity: sevOf(f), state: stateAt(f, S.step), stateWord: STATE_WORD[stateAt(f, S.step)] });
  const detail = () => {
    const sel = S.sel;
    if (!sel) return null;
    if (sel.kind === 'node') {
      const n = byId.get(sel.id);
      if (!n) return null;
      const fs = findingsAt.get(n.id) || [];
      return { kind: 'node', id: n.id, name: name(n), label: n.label, type: n.subtype || n.kind, group: n.group !== undefined ? chain(n.group).map((g) => name(gById.get(g))) : [], file: nodeFile.get(n.id) || '', note: n.note || '', coverage: coverageOf([n.id]), impact: n.impact || '',
        findings: fs.map(findingRow), into: flowList(n.id, 'in').slice(0, 40), out: flowList(n.id, 'out').slice(0, 40), guards: patches.filter((k) => k.guard && k.guard.to === n.id).map((k) => ({ id: k.id, name: name(k), landed: landed(k), level: patchLevel(k) })) };
    }
    if (sel.kind === 'file') {
      const rec = files.get(sel.id);
      if (!rec) return null;
      return { kind: 'file', id: rec.path, roll: rolls().get(`f:${rec.path}`), elements: [...rec.nodes].map((id) => ({ id, name: name(byId.get(id)) })), findings: [...rec.findings].map(findingRow), traced: [...rec.traced].map((f) => f.id), sets: [...rec.sets].map((i) => ({ step: i + 1, id: sets[i].id })) };
    }
    if (sel.kind === 'finding') {
      const f = findings.find((x) => x.id === sel.id);
      if (!f) return null;
      const h = hazard(f);
      const p = layout().paths.get(f.id);
      const U2 = units().U;
      const stationsOn = p ? [...new Set([...p.units, ...[...p.edges].flatMap((k) => k.split('\n'))])].map((uid) => U2.get(uid)).filter(Boolean).map((u) => title(u)) : [];
      return { kind: 'finding', ...h, title: f.title || '', rule: f.source ? f.source.rule : '', message: f.source ? f.source.message || '' : '', note: f.note || '', controls: (f.controls || []).map((c) => ({ axis: c.axis, what: c.what, test: c.test || '' })), path: stationsOn, impacts: impactsOf(f), step: ruledAt.has(f) ? ruledAt.get(f) + 1 : 0 };
    }
    if (sel.kind === 'lane') {
      const l = layout().lanes.find((x) => x.id === sel.id);
      if (!l) return null;
      const U2 = units().U;
      const ids = l.units.flatMap((uid) => U2.get(uid).members);
      const fs = findings.filter((f) => atOf(f).some((id) => ids.includes(id)));
      return { kind: 'unit', id: sel.id, type: 'lane', name: l.label, group: sel.id, elements: ids.slice(0, 60).map((id) => ({ id, name: name(byId.get(id)) })), count: ids.length, findings: fs.map(findingRow) };
    }
    const u = units().U.get(sel.id);
    if (!u) return null;
    return { kind: 'unit', id: u.uid, type: u.type, name: title(u), group: u.gid, elements: u.members.slice(0, 60).map((id) => ({ id, name: name(byId.get(id)) })), count: u.members.length, findings: unitFindings(u).map(findingRow) };
  };

  // ---- search and facets
  const search = (q, limit = 30) => {
    const s = String(q || '').trim().toLowerCase();
    if (s.length < 2) return [];
    const out = [];
    for (const f of findings) if (matchesFinding(f, s)) out.push({ kind: 'finding', id: f.id, label: `${f.id} ${f.title || ''}`.trim(), sub: f.cwe || (f.source && f.source.rule) || '' });
    for (const n of nodes) if (out.length < limit && `${n.id} ${n.label || ''} ${n.plain || ''}`.toLowerCase().includes(s) && !leaf(n)) out.push({ kind: 'node', id: n.id, label: name(n), sub: nodeFile.get(n.id) || n.kind });
    for (const p of files.keys()) if (out.length < limit && p.toLowerCase().includes(s)) out.push({ kind: 'file', id: p, label: p, sub: 'file' });
    return out.slice(0, limit);
  };
  const facets = () => {
    const L = layout();
    const count = (fn) => findings.filter(fn).length;
    return {
      layers: { structure: L.units.filter((u) => u.type !== 'source').length, flows: L.edges.length, trust: L.boundaries.length, weakness: findings.filter((f) => ['open', 'thin'].includes(stateAt(f, S.step))).length, trigger: L.units.filter((u) => u.type === 'source').length, controls: L.edges.reduce((s, e) => s + e.guards.length, 0), evidence: patches.filter((k) => k.evidence).length },
      state: Object.fromEntries(STATES.map((st) => [st, count((f) => stateAt(f, S.step) === st)])),
      sev: Object.fromEntries(SEV.map((s) => [s, count((f) => sevOf(f) === s)])),
      ev: Object.fromEntries(LEVELS.map((l) => [l, patches.filter((k) => patchLevel(k) === l).length])),
    };
  };
  const setFacet = (facet, value, on) => { const set = S.facets[facet]; if (!set) return false; if (on) set.add(value); else set.delete(value); S.memo = new Map(); return true; };
  const setMode = (k, v) => { if (!['scope', 'colour'].includes(k)) return false; S[k] = v; S.memo = new Map(); return true; };
  const overview = () => {
    const L = layout();
    const U2 = units().U;
    const st = stations();
    return L.lanes.map((l) => {
      const fs = l.units.flatMap((uid) => unitFindings(U2.get(uid)));
      const sts = fs.map((f) => stateAt(f, S.step));
      return { id: l.id, label: l.label, units: l.units.length, open: sts.filter((s) => s === 'open' || s === 'thin').length, dealt: sts.filter((s) => ['fixed', 'proven', 'held'].includes(s)).length, touched: st.some((s) => l.units.includes(s.uid) && s.touched), trust: l.trust };
    });
  };
  const findingList = () => findings.map((f) => ({ id: f.id, title: f.title || '' }));
  const patchFinding = (id) => { const k = patches.find((p) => p.id === id); const f = k && findings.find((x) => names(k, x)); return f ? f.id : null; };
  const stats = () => ({ elements: nodes.length, drawable: drawable.length, flows: flows.length, findings: findings.length, patches: patches.length, sets: sets.length, files: files.size, steps: steps() });

  setStep(0);
  return { S, findingList, patchFinding, SEV, STATES, LEVELS, LAYERS, STATE_WORD, sets, files, setStep, toggleGroup, more, layout, stations, outcomeChips, emphasis, select, revealNode, treeRows, toggleDir, treeKey, account, checks, steps, detail, search, facets, setFacet, setMode, overview, stats, stateAt, fileOfNode, fileOfRef, isPath, isOpen };
}
