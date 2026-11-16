// lib/dfd-story-core.mjs — the rules of the story view: one fixed picture of a dfd@1 document for a
// reader who does not know the code, and the stages that light it up one layer at a time.
//
// Platform layout is laid out once and never moves: what comes in on the left, the parts that handle it
// in the middle (grouped by the document's top-level groups, each with its sub-groups as lanes), what
// can happen as a result on the right. Every part a finding sits on is drawn together with the
// parts around it: the shortest way in from a source, the shortest way out to the worst outcome it
// reaches, and its neighbours in the same group. The stages then add information in order: the
// picture, the lines data follows, the findings (every one open), each change set, what is left.
// Change-set state comes from the map view's core, so both views step the same way.
//
// Names shown are `plain` where the document gives one, else the label. No DOM here.

export const STORY_IMPACTS = Object.freeze(['critical', 'high', 'medium', 'low']);
const WORD = { critical: 'critical', high: 'high', medium: 'medium', low: 'low' };
const HOW = { tested: 'tested', rescanned: 'rescan clean', inspected: 'source inspection', static: 'static analysis, no runtime PoC', asserted: 'asserted, unverified' };
const STATE = { open: 'open', thin: 'dismissed, unproven', held: 'held, two tested controls', fixed: 'fixed' };
const NW = 176, NH = 46, GX = 72, GY = 10, GAP = 8, PAD = 16, HEAD = 26, LANE = 24;

export function createStoryCore(M, createMapCore, { all = 60, siblings = 4, wrap = 2, chars = 24, maxLevel = 4 } = {}) {
  const map = createMapCore(M);
  const byId = new Map(M.nodes.map((n) => [n.id, n]));
  const gById = new Map((M.groups || []).map((g) => [g.id, g]));
  const flows = (M.flows || []).filter((f) => byId.has(f.from) && byId.has(f.to) && f.from !== f.to);
  const patches = M.patches || [];
  const plain = (x) => x.plain || x.label || x.title || x.id;
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const out = new Map();
  const into = new Map();
  for (const f of flows) { push(out, f.from, f.to); push(into, f.to, f.from); }
  const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const list = (names, max = 3) => { const u = [...new Set(names)]; return u.length > max ? `${u.slice(0, max).join(', ')} and ${u.length - max} more` : u.join(', '); };

  // ---- findings: one per finding that sits on an element; the same weakness in several places shares an id before the @
  const placeOf = (f) => { const id = f.at && (f.at.node || (f.at.flow && f.at.flow.from)); return byId.has(id) ? id : undefined; };
  const findings = (M.findings || []).filter((f) => placeOf(f) !== undefined);
  const at = new Map();
  for (const f of findings) push(at, placeOf(f), f);
  const base = (id) => id.split('@')[0];
  const weak = new Map();
  for (const f of findings) { if (!weak.has(base(f.id))) weak.set(base(f.id), { id: base(f.id), title: '', places: [] }); weak.get(base(f.id)).places.push(f); }
  for (const w of weak.values()) w.title = (w.places.find((f) => f.id === w.id) || w.places[0]).title || w.id;

  const walk = (start, edges, stop) => {
    const prev = new Map([[start, null]]);
    const q = [start];
    while (q.length) {
      const n = q.shift();
      if (stop && stop(n)) { const path = []; for (let p = n; p !== null; p = prev.get(p)) path.push(p); return path; }
      for (const m of edges.get(n) || []) if (!prev.has(m)) { prev.set(m, n); q.push(m); }
    }
    return stop ? [] : [...prev.keys()];
  };
  const rank = (impact) => { const i = STORY_IMPACTS.indexOf(impact); return i < 0 ? STORY_IMPACTS.length : i; };
  const memo = new Map();
  const harms = (id) => { if (!memo.has(id)) memo.set(id, walk(id, out).filter((n) => byId.get(n).impact !== undefined).sort((a, b) => rank(byId.get(a).impact) - rank(byId.get(b).impact))); return memo.get(id); };
  const impactOf = (id) => (harms(id).length ? byId.get(harms(id)[0]).impact : undefined);
  const severityOf = (f) => impactOf(placeOf(f)) || (STORY_IMPACTS.includes(f.severity) ? f.severity : undefined);
  const sizeOf = (f) => { const r = rank(severityOf(f)); return r <= 1 ? 3 : r === 2 ? 2 : 1; };

  // ---- what is drawn: everything in a small document; in a large one, the findings and what surrounds them
  const degree = (id) => (out.get(id) || []).length + (into.get(id) || []).length;
  const drawn = new Set();
  if (M.nodes.length <= all) for (const n of M.nodes) drawn.add(n.id);
  else {
    const seeds = at.size ? [...at.keys()] : M.nodes.map((n) => n.id).sort((a, b) => degree(b) - degree(a)).slice(0, 12);
    for (const s of seeds) {
      const want = impactOf(s);
      for (const n of [s, ...walk(s, into, (n) => !into.has(n)), ...walk(s, out, (n) => (want ? byId.get(n).impact === want : !out.has(n)))]) drawn.add(n);
    }
    const per = new Map();
    for (const id of [...drawn]) for (const nb of [...(out.get(id) || []), ...(into.get(id) || [])]) {
      const g = byId.get(nb).group;
      if (drawn.has(nb) || g === undefined || g !== byId.get(id).group || (per.get(g) || 0) >= siblings) continue;
      drawn.add(nb); per.set(g, (per.get(g) || 0) + 1);
    }
  }
  const shown = M.nodes.filter((n) => drawn.has(n.id));
  const roleOf = (n) => (n.kind === 'process' ? 'part' : !out.has(n.id) ? 'outcome' : !into.has(n.id) ? 'source' : 'part');
  const role = new Map(shown.map((n) => [n.id, roleOf(n)]));
  const chain = (gid) => { const c = []; for (let g = gById.get(gid), i = 0; g && i < 32; g = gById.get(g.parent), i += 1) c.unshift(g); return c; };

  // ---- the fixed layout
  const wrapText = (s) => {
    const lines = [''];
    for (const w of String(s).split(/\s+/).filter(Boolean)) {
      const cur = lines[lines.length - 1];
      if (!cur) lines[lines.length - 1] = w;
      else if (`${cur} ${w}`.length <= chars) lines[lines.length - 1] = `${cur} ${w}`;
      else if (lines.length < 2) lines.push(w);
      else { lines[1] = `${lines[1]}…`; break; }
    }
    return lines.map((l) => (l.length > chars ? `${l.slice(0, chars - 1).replace(/…$/, '')}…` : l));
  };
  const sources = shown.filter((n) => role.get(n.id) === 'source');
  const outcomes = shown.filter((n) => role.get(n.id) === 'outcome').sort((a, b) => rank(a.impact) - rank(b.impact));
  const parts = shown.filter((n) => role.get(n.id) === 'part');
  const level = new Map();
  { const q = sources.map((n) => n.id); const d = new Map(q.map((id) => [id, 0]));
    while (q.length) { const n = q.shift(); for (const m of out.get(n) || []) if (!d.has(m) && role.get(m) === 'part') { d.set(m, d.get(n) + 1); q.push(m); } }
    for (const n of parts) level.set(n.id, Math.min(maxLevel, d.get(n.id) || 1)); }
  const L = Math.max(0, ...level.values());
  const cell = new Map();
  for (const n of parts) { const c = chain(n.group); push(cell, `${c[0] ? c[0].id : ''}\n${c[1] ? c[1].id : ''}\n${level.get(n.id)}`, n); }
  const colN = Array.from({ length: L + 1 }, () => 1);
  for (const [k, ns] of cell) { const l = Number(k.split('\n')[2]); colN[l] = Math.max(colN[l], Math.min(wrap, ns.length)); }
  const colX = [];
  let x = PAD + NW + GX;
  for (let l = 1; l <= L; l += 1) { colX[l] = x; x += colN[l] * NW + (colN[l] - 1) * GAP + GX; }
  const outX = x;
  const pos = new Map();
  const sections = [];
  const lanes = [];
  const order = (ids) => [...ids].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : [...gById.keys()].indexOf(a) - [...gById.keys()].indexOf(b)));
  const secIds = order(new Set([...cell.keys()].map((k) => k.split('\n')[0])));
  let y = PAD;
  for (const sec of secIds) {
    const sy = y;
    y += HEAD;
    for (const lane of order(new Set([...cell.keys()].filter((k) => k.split('\n')[0] === sec).map((k) => k.split('\n')[1])))) {
      const ly = y;
      if (lane) y += LANE;
      let rows = 1;
      for (let l = 1; l <= L; l += 1) {
        const ns = cell.get(`${sec}\n${lane}\n${l}`) || [];
        rows = Math.max(rows, Math.ceil(ns.length / colN[l]));
        ns.forEach((n, i) => pos.set(n.id, { x: colX[l] + (i % colN[l]) * (NW + GAP), y: y + Math.floor(i / colN[l]) * (NH + GY) }));
      }
      y += rows * (NH + GY);
      if (lane) lanes.push({ id: lane, label: plain(gById.get(lane)), x: PAD + NW + GX - 8, y: ly, w: outX - GX - (PAD + NW + GX) + 16, h: y - ly });
      y += 6;
    }
    sections.push({ id: sec, label: sec ? plain(gById.get(sec)) : 'Ungrouped elements', x: PAD + NW + GX - 16, y: sy, w: outX - GX - (PAD + NW + GX) + 32, h: y - sy + 2 });
    y += 14;
  }
  const column = (ns, cx) => { const h = ns.length * (NH + GY); const y0 = Math.max(PAD, Math.round((y - h) / 2)); ns.forEach((n, i) => pos.set(n.id, { x: cx, y: y0 + i * (NH + GY) })); return y0 + h; };
  const H = Math.max(y, column(sources, PAD), column(outcomes, outX)) + PAD;
  const W = outX + NW + PAD;
  const nodes = shown.map((n) => ({ id: n.id, role: role.get(n.id), x: pos.get(n.id).x, y: pos.get(n.id).y, w: NW, h: NH, lines: wrapText(plain(n)), name: plain(n), harm: n.impact !== undefined, unknown: n.unknown === true }));
  const merged = new Map();
  for (const f of flows) if (drawn.has(f.from) && drawn.has(f.to)) push(merged, `${f.from}\n${f.to}`, f);
  const geo = (a, b) => {
    const y1 = a.y + NH / 2;
    const y2 = b.y + NH / 2;
    if (b.x >= a.x + NW) { const dx = Math.max(6, Math.round((b.x - a.x - NW) / 2)); return `M${a.x + NW} ${y1}C${a.x + NW + dx} ${y1} ${b.x - dx} ${y2} ${b.x} ${y2}`; }
    const bend = Math.max(a.x, b.x) + NW + 28;
    return `M${a.x + NW} ${y1}C${bend} ${y1} ${bend} ${y2} ${b.x + NW} ${y2}`;
  };
  const edges = [...merged.values()].map((fs) => ({ from: fs[0].from, to: fs[0].to, d: geo(pos.get(fs[0].from), pos.get(fs[0].to)), flows: fs, labels: fs.map((f) => f.label).filter(Boolean) }));

  // ---- the stages: the state of every finding after each change set, taken once from the map's core
  const total = map.stepInfo().total;
  const snaps = [];
  for (let k = 0; k <= total; k += 1) { map.setStep(k); snaps.push({ info: map.stepInfo(), state: new Map(findings.map((f) => [f.id, map.stateOf(f)])) }); }
  const prById = new Map((M.prs || []).map((p) => [p.id, p]));
  const setName = (k) => { const pr = snaps[k].info.pr; return pr.id === 'no change recorded' ? 'Rulings without code change' : prById.has(pr.id) ? plain(prById.get(pr.id)) : pr.title || pr.id; };
  const stages = [{ kind: 'look', label: 'Platform layout' }, { kind: 'routes', label: 'Data flows' }];
  if (findings.length) {
    stages.push({ kind: 'hazards', label: 'Findings, unmitigated', step: 0 });
    for (let k = 1; k <= total; k += 1) stages.push({ kind: 'change', label: setName(k), step: k });
    stages.push({ kind: 'left', label: 'Residual findings', step: total });
  }
  const landedAt = (k) => { const ids = new Set(); for (let j = 1; j <= k; j += 1) for (const id of snaps[j].info.pr.patches) ids.add(id); return patches.filter((p) => ids.has(p.id)); };
  const hits = (list_, f) => (list_ || []).some((r) => r.from === f.from && r.to === f.to);
  const gateOf = new Map();
  for (const f of flows) if (f.gate && f.gate.finding) gateOf.set(f.gate.finding, f.gate);
  /** How the state of a finding is known at step k: the patch that names this place, the check on its own flow, a patch that names the weakness, then the finding. */
  const howOf = (f, landed) => {
    const lv = (ps) => { const ls = ps.map((p) => (p.evidence && p.evidence.level) || 'asserted'); return ls.find((l) => l !== 'tested') || ls[0]; };
    const exact = landed.filter((p) => (p.findings || []).includes(f.id));
    if (exact.length) return lv(exact);
    const gate = gateOf.get(f.id);
    if (gate && gate.evidence && gate.evidence.level) return gate.evidence.level;
    const named = landed.filter((p) => (p.findings || []).includes(base(f.id)));
    if (named.length) return lv(named);
    if ((f.controls || []).some((c) => c.test)) return 'tested';
    return (f.evidence && f.evidence.level) || 'asserted';
  };
  const sure = (how) => how === 'tested' || how === 'rescanned';
  const liveIn = (state) => (f) => state.get(f.id) === 'open' || state.get(f.id) === 'thin';
  const areaOf = (id) => { const c = chain(byId.get(id).group); return c[0] ? plain(c[0]) : ''; };
  const itemOf = (w, state) => ({ id: w.id, text: w.title, where: list(w.places.map((f) => plain(byId.get(placeOf(f)))), 2), nodes: [...new Set(w.places.map(placeOf))], open: w.places.some(liveIn(state)) });
  const worstFirst = (a, b) => Math.min(...a.places.map((f) => rank(severityOf(f)))) - Math.min(...b.places.map((f) => rank(severityOf(f))));

  const caption = (st, k) => {
    const state = snaps[k].state;
    const live = liveIn(state);
    const openN = findings.filter((f) => state.get(f.id) === 'open').length;
    const thinN = findings.filter((f) => state.get(f.id) === 'thin').length;
    const tail = `${openN} of ${findings.length} open${thinN ? `, ${thinN} dismissed unproven` : ''}.`;
    if (st.kind === 'look') {
      const lines = [`Left: inputs (${list(sources.map(plain))}).`, `Centre: ${count(parts.length, 'element')}${sections.length ? `, in ${count(sections.length, 'group')}: ${list(sections.map((s) => s.label), 4)}` : ''}.`, 'Right: impact sinks.'];
      if (M.nodes.length > drawn.size) lines.push(`${count(M.nodes.length - drawn.size, 'element')} without findings omitted.`);
      return { title: 'Platform layout', lines, items: [] };
    }
    if (st.kind === 'routes') {
      const bad = outcomes.filter((n) => n.impact !== undefined);
      return { title: 'Data flows', lines: ['Flows run left to right.', `${count(bad.length, 'impact sink')}: ${list(bad.map(plain), 4) || 'none recorded'}.`, 'Flow into impact sink: attack path.'], items: [] };
    }
    if (st.kind === 'hazards') {
      const big = findings.filter((f) => sizeOf(f) === 3);
      const lines = [`${count(findings.length, 'finding')} on ${count(at.size, 'element')}. Dot: one finding; size: worst reachable impact.`];
      if (big.length) lines.push(`${count(big.length, 'finding')} reach: ${list(big.flatMap((f) => harms(placeOf(f)).slice(0, 1)).map((id) => plain(byId.get(id))))}.`);
      lines.push('Baseline: nothing mitigated. Select dot or box for detail.');
      return { title: 'Findings, unmitigated', lines, items: [] };
    }
    if (st.kind === 'change') {
      const info = snaps[k].info;
      const ruled = findings.filter((f) => info.fixes.includes(f.id) || info.rules.includes(f.id));
      const done = ruled.filter((f) => !live(f));
      const aside = ruled.filter((f) => state.get(f.id) === 'thin');
      const landed = landedAt(k);
      const unsure = done.filter((f) => !sure(howOf(f, landed)));
      const ws = [...new Set(ruled.map((f) => weak.get(base(f.id))))];
      const beyond = ws.flatMap((w) => w.places.filter((f) => state.get(f.id) === 'open'));
      const lines = [`${done.length} mitigated at this step.`];
      if (aside.length) lines.push(`${aside.length} dismissed, unproven (red ring). Not closed.`);
      if (unsure.length) lines.push(unsure.length === done.length ? 'None tested: hollow dots.' : `${unsure.length} untested: hollow dots.`);
      if (beyond.length) lines.push(`Same weakness open in: ${list(beyond.map((f) => plain(byId.get(placeOf(f)))))}.`);
      lines.push(tail);
      return { title: `Change set ${k}/${total}: ${st.label}`, lines, items: ws.sort(worstFirst).map((w) => itemOf(w, state)) };
    }
    const open = findings.filter(live);
    if (!open.length) return { title: 'Residual findings', lines: [`All ${count(findings.length, 'finding')} mitigated.`], items: [] };
    const big = open.filter((f) => sizeOf(f) === 3);
    const lines = [tail];
    if (big.length) lines.push(`${big.length} reach: ${list(big.flatMap((f) => harms(placeOf(f)).slice(0, 1)).map((id) => plain(byId.get(id))))}.`);
    const areas = open.map((f) => areaOf(placeOf(f))).filter(Boolean);
    if (areas.length) lines.push(`Location: ${list(areas)}.`);
    return { title: 'Residual findings', lines, items: [...new Set(open.map((f) => weak.get(base(f.id))))].sort(worstFirst).map((w) => itemOf(w, state)) };
  };

  /** Everything the drawing needs for stage i: classes for every box and line, the dots, the words. */
  const view = (i) => {
    const st = stages[i];
    const k = st.step === undefined ? 0 : st.step;
    const marks = st.step !== undefined;
    const state = snaps[k].state;
    const live = liveIn(state);
    const landed = marks ? landedAt(k) : [];
    const info = snaps[k].info;
    const touched = new Set();
    if (st.kind === 'change') {
      for (const f of findings) if (info.fixes.includes(f.id) || info.rules.includes(f.id)) touched.add(placeOf(f));
      for (const p of patches) if (info.pr.patches.includes(p.id) && p.guard && drawn.has(p.guard.to)) touched.add(p.guard.to);
    }
    const dimmed = new Set();
    const boxes = nodes.map((n) => {
      const hz = at.get(n.id) || [];
      const cls = [n.role];
      if (n.role === 'outcome' && st.kind !== 'look') cls.push(n.harm ? 'harm' : 'calm');
      if (n.unknown) cls.push('unknown');
      const hot = marks && hz.some(live);
      if (hot) cls.push('hot'); else if (marks && hz.length) cls.push('eased');
      if (touched.has(n.id)) cls.push('lit');
      const dim = n.role === 'part' && ((st.kind === 'hazards' && !hz.length) || (st.kind === 'change' && !touched.has(n.id)) || (st.kind === 'left' && !hot));
      if (dim) { cls.push('dim'); dimmed.add(n.id); }
      const dots = marks ? hz.map((f) => ({ id: f.id, weak: base(f.id), state: state.get(f.id), size: sizeOf(f), sure: live(f) || sure(howOf(f, landed)) })) : [];
      return { ...n, cls: cls.join(' '), dots };
    });
    const flowState = (f) => {
      if (patches.some((p) => hits(p.rejects, f))) return landed.some((p) => hits(p.rejects, f)) ? 'safe' : 'later';
      if (!marks) return f.existence === 'unknown' ? 'unknown' : '';
      if (f.gate && state.has(f.gate.finding)) return live({ id: f.gate.finding }) ? 'danger' : 'closed';
      const hz = at.get(f.from) || [];
      if (byId.get(f.to).impact !== undefined && hz.length) return hz.some(live) ? 'danger' : 'closed';
      return f.existence === 'unknown' ? 'unknown' : '';
    };
    const lines = edges.map((e) => {
      const ss = e.flows.map(flowState);
      const s = ['danger', 'closed', 'safe', 'unknown', 'later'].find((w) => ss.includes(w) && (w !== 'later' || ss.every((v) => v === 'later'))) || '';
      const guard = landed.filter((p) => p.guard && p.guard.from === e.from && p.guard.to === e.to);
      const cls = [s];
      if (st.kind !== 'look' && byId.get(e.to).impact !== undefined && s !== 'closed') cls.push('toharm');
      const dim = (st.kind === 'hazards' || st.kind === 'left') ? s !== 'danger' : st.kind === 'change' ? !(touched.has(e.from) || touched.has(e.to)) : false;
      if (dim) cls.push('dim');
      return { from: e.from, to: e.to, d: e.d, cls: cls.filter(Boolean).join(' '), guard: guard.length > 0, fresh: guard.some((p) => info.pr && info.pr.patches.includes(p.id)), label: !dim && s && s !== 'later' && e.labels.length ? e.labels[0] + (e.labels.length > 1 ? ` (+${e.labels.length - 1})` : '') : '' };
    });
    const counts = { total: findings.length, open: 0, thin: 0, held: 0, fixed: 0 };
    if (marks) for (const f of findings) counts[state.get(f.id)] += 1;
    return { stage: i, kind: st.kind, label: st.label, marks, boxes, lines, counts, caption: caption(st, k) };
  };

  /** One weakness, wherever it sits, as a reader would ask about it. */
  const card = (id, i) => {
    const w = weak.get(id);
    if (!w) return null;
    const st = stages[i];
    const k = st.step === undefined ? 0 : st.step;
    const state = snaps[k].state;
    const landed = landedAt(k);
    const ends = [...new Set(w.places.flatMap((f) => harms(placeOf(f))))].sort((a, b) => rank(byId.get(a).impact) - rank(byId.get(b).impact)).slice(0, 3);
    return { kind: 'weakness', id, title: w.title,
      places: w.places.map((f) => { const s = state.get(f.id); return { id: f.id, node: placeOf(f), name: plain(byId.get(placeOf(f))), area: areaOf(placeOf(f)), state: s, word: STATE[s], how: s === 'open' ? '' : HOW[howOf(f, landed)] || HOW.asserted, ruling: s === 'open' ? '' : f.note || '' }; }),
      outcomes: ends.map((e) => ({ name: plain(byId.get(e)), word: WORD[byId.get(e).impact] || 'unrated' })),
      done: landed.filter((p) => (p.findings || []).some((x) => x === id || w.places.some((f) => f.id === x))).map((p) => ({ id: p.id, text: p.plain || p.title || p.id, caveat: p.caveat || '', note: p.note || '', how: HOW[(p.evidence && p.evidence.level) || 'asserted'] || HOW.asserted })) };
  };
  /** One box: what it is, where it sits, what it talks to, and the weaknesses on it once they are shown. */
  const boxCard = (id, i) => {
    const n = byId.get(id);
    if (!n || !drawn.has(id)) return null;
    const names = (ids) => list((ids || []).filter((x) => drawn.has(x)).map((x) => plain(byId.get(x))), 4);
    return { kind: 'box', id, name: plain(n), label: n.label !== plain(n) ? n.label : '', area: areaOf(id), role: role.get(id), from: names(into.get(id)), to: names(out.get(id)),
      weak: stages[i].step === undefined ? [] : [...new Set((at.get(id) || []).map((f) => base(f.id)))] };
  };

  return { stages, layout: { w: W, h: H, sections, lanes, nodes, edges: edges.length }, view, card, boxCard,
    stats: () => ({ drawn: drawn.size, hidden: M.nodes.length - drawn.size, lines: edges.length, weaknesses: weak.size, places: findings.length, stages: stages.length, changes: total }) };
}
