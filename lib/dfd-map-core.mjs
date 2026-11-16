// lib/dfd-map-core.mjs — the rules of the map view: a whole dfd@1 document kept as data and drawn a
// few dozen boxes at a time. The page inlines this file (its `export` dropped) ahead of
// lib/dfd-map-client.js, and the tests import it, so the page and the tests run the same rules.
// It imports nothing and touches no document.
//
// What it decides:
// - the tree: the document's groups, a directory level under any group too wide to read, and one
//   bucket per kind for elements the document leaves ungrouped;
// - which elements are leaves (a file, an environment variable, a program: a store or external with
//   no impact, no issue and no traced flow). Leaves are folded into counts on what touches them
//   until the reader asks for them;
// - the roll-up a closed box shows: elements, issues by severity, line coverage, traced flows;
// - the frontier: what is drawn for the groups the reader has opened, held under a budget by
//   closing the group opened longest ago, and a "more" box where one group alone is too wide;
// - the flows between drawn boxes, merged per pair with their count;
// - where each box goes (nested boxes, packed in rows), the issue list, search, and what one
//   element touches.

export function createMapCore(M, { budget = 150, split = 24, page = 60 } = {}) {
  const SEV = ['critical', 'high', 'medium', 'low', 'undetermined'];
  const FLOOR = 0.8;
  const BUCKETS = { file: 'Files read and written', env: 'Environment variables', binary: 'Programs run', scheduler: 'Schedulers', endpoint: 'Network endpoints', database: 'Databases' };
  const nodes = M.nodes;
  const flows = M.flows;
  const findings = M.findings || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // ---- issues and traced flows, per element
  const issuesAt = new Map();
  const note = (id, f) => { if (!issuesAt.has(id)) issuesAt.set(id, []); issuesAt.get(id).push(f); };
  for (const f of findings) {
    if (f.at.node !== undefined) note(f.at.node, f);
    else { note(f.at.flow.from, f); if (f.at.flow.to !== f.at.flow.from) note(f.at.flow.to, f); }
  }
  // ---- what state an issue is in. The standard: a clean flow and at least two tested controls on
  // different axes. `open`: nobody has ruled on it. `thin`: judged not a defect, on fewer than two
  // tested axes, so not closed. `held`: judged not a defect and held on two or more. `fixed`: a fix
  // was reported; whether a scanner still reports it is a rescan's business.
  const STATES = ['open', 'thin', 'held', 'fixed'];
  const axesOf = (f) => { const cs = f.controls || []; const tested = new Set(cs.filter((c) => c.test).map((c) => c.axis)); return { controls: cs.length, axes: new Set(cs.map((c) => c.axis)).size, tested: tested.size }; };
  // ---- playback against pull requests: at step k the first k have landed. An issue ruled on by a
  // later one is still as the scanner left it; a ruling that names no pull request holds at every step.
  // The steps are change sets, never single patches in rotation: the declared pull requests, each
  // with the patches that name it; or, where none is declared, the patches grouped by the commits
  // they share, else by the file they were read from. A ruling no change set accounts for is not
  // part of the original position either: those land together in a first step of their own, so
  // step 0 is always every issue as the scanner left it.
  const allPatches = M.patches || [];
  const declared = !!(M.prs && M.prs.length);
  const sets = [];
  if (declared) for (const p of M.prs) sets.push({ id: p.id, title: p.title || '', state: p.state || '', files: p.files || [], patches: allPatches.filter((k) => k.pr === p.id) });
  else {
    const by = new Map();
    for (const k of allPatches) {
      const refs = (k.evidence && k.evidence.refs) || [];
      const key = k.commits && k.commits.length ? `commits ${k.commits.map((c) => c.slice(0, 12)).join(', ')}` : refs.length ? refs.join(', ') : 'patches with no commit or file recorded';
      if (!by.has(key)) { by.set(key, { id: key, title: '', state: '', files: [], patches: [] }); sets.push(by.get(key)); }
      by.get(key).patches.push(k);
    }
  }
  // an issue drawn at a second element carries its id with the place after an @; a patch names it by the id alone
  const names = (k, f) => (k.findings || []).some((id) => id === f.id || id === f.id.split('@')[0]);
  const setOf = (f) => { let at; sets.forEach((st, i) => { if (f.pr === st.id || st.patches.some((k) => names(k, f))) at = i; }); return at; };
  const loose = sets.length ? findings.filter((f) => (f.status === 'mitigated' || f.status === 'dismissed') && setOf(f) === undefined) : [];
  if (loose.length) sets.unshift({ id: 'no change recorded', title: 'rulings that name no pull request, commit or patch', state: '', files: [], patches: [], loose: new Set(loose) });
  const prs = sets;
  const rulesOn = (st, f) => (st.loose ? st.loose.has(f) : f.pr === st.id || st.patches.some((k) => names(k, f)));
  const ruledAt = new Map();
  for (const f of findings) sets.forEach((st, i) => { if (rulesOn(st, f)) ruledAt.set(f, i); });
  let step = prs.length;
  const landed = (f) => !ruledAt.has(f) || ruledAt.get(f) < step;
  const stateOf = (f) => (!landed(f) ? 'open' : f.status === 'mitigated' ? 'fixed' : f.status === 'dismissed' ? (axesOf(f).tested >= 2 ? 'held' : 'thin') : 'open');
  const traced = new Set();
  for (const f of flows) if (f.evidence && f.evidence.method === 'taint') { traced.add(f.from); traced.add(f.to); }
  const isLeaf = (n) => n.kind !== 'process' && n.impact === undefined && !issuesAt.has(n.id) && !traced.has(n.id);

  // ---- the tree
  const items = new Map();
  const add = (id, label, kind, parent, extra = {}) => { const it = { id, label, kind, parent, children: [], ...extra }; items.set(id, it); return it; };
  const root = add('', M.title || 'data flow diagram', 'group', null);
  for (const g of M.groups || []) add(`g:${g.id}`, g.label || g.id, 'group', g.parent === undefined ? '' : `g:${g.parent}`);
  for (const n of nodes) {
    let parent = n.group === undefined ? null : `g:${n.group}`;
    if (parent === null) {
      const key = n.kind === 'process' ? 'code' : (BUCKETS[n.subtype] ? n.subtype : 'other');
      parent = `x:${key}`;
      if (!items.has(parent)) add(parent, key === 'code' ? 'Ungrouped code' : (BUCKETS[key] || 'Other externals'), 'group', '', { bucket: true });
    }
    add(n.id, n.label || n.id, 'node', parent, { node: n, leaf: isLeaf(n) });
  }
  for (const it of items.values()) if (it.parent !== null) items.get(it.parent).children.push(it);

  /** Under a group wider than `split`, one group per next directory of its elements' labels. */
  const splitDirs = (group, depth) => {
    const kids = group.children.filter((c) => c.kind === 'node' && !c.leaf);
    if (kids.length <= split) return;
    const buckets = new Map();
    const pathy = kids.filter((k) => k.label.includes('/')).length;
    for (const k of kids) {
      const segs = k.label.split('/');
      if (segs.length <= depth + 1) continue;
      if (!buckets.has(segs[depth])) buckets.set(segs[depth], []);
      buckets.get(segs[depth]).push(k);
    }
    if (buckets.size === 1 && [...buckets.values()][0].length === pathy) { splitDirs(group, depth + 1); return; }
    for (const [seg, members] of buckets) {
      if (members.length < 2) continue;
      const label = `${members[0].label.split('/').slice(0, depth + 1).join('/')}/`;
      const sub = add(`d:${group.id}/${seg}`, label, 'group', group.id, { dir: true });
      const moved = new Set(members);
      group.children = group.children.filter((c) => !moved.has(c));
      for (const m of members) { m.parent = sub.id; sub.children.push(m); }
      group.children.push(sub);
      splitDirs(sub, depth + 1);
    }
  };
  for (const it of [...items.values()]) if (it.kind === 'group' && !it.dir) splitDirs(it, 0);

  // ---- what an element touches: the leaves and the other elements its flows reach
  const touch = new Map();
  const users = new Map();
  const peers = new Map();
  const bump = (map, a, b) => { if (!map.has(a)) map.set(a, new Map()); map.get(a).set(b, (map.get(a).get(b) || 0) + 1); };
  for (const f of flows) {
    const a = items.get(f.from);
    const b = items.get(f.to);
    if (!a || !b || a === b) continue;
    if (a.leaf && !b.leaf) { bump(touch, b.id, a.id); bump(users, a.id, b.id); }
    else if (b.leaf && !a.leaf) { bump(touch, a.id, b.id); bump(users, b.id, a.id); }
    else if (!a.leaf && !b.leaf) { bump(peers, a.id, b.id); bump(peers, b.id, a.id); }
  }

  // ---- roll-ups, computed once, children first
  const worst = (sev) => SEV.find((s) => sev[s] > 0) || null;
  // children are ordered once, with every pull request landed, so playback never moves a box
  let ordering = true;
  const roll = (it) => {
    const r = { elements: 0, leaves: 0, procs: 0, issues: new Set(), thin: new Set(), done: new Set(), sev: Object.fromEntries(SEV.map((s) => [s, 0])), covered: 0, total: 0, measured: 0, unmeasured: 0, traced: false };
    if (it.kind === 'node') {
      if (it.leaf) r.leaves = 1; else r.elements = 1;
      if (it.node.kind === 'process') r.procs = 1;
      for (const f of issuesAt.get(it.id) || []) { const st = stateOf(f); (st === 'open' ? r.issues : st === 'thin' ? r.thin : r.done).add(f); }
      r.traced = traced.has(it.id);
      const c = it.node.coverage;
      if (c && c.lines && c.lines.total > 0) { r.covered = c.lines.covered; r.total = c.lines.total; r.measured = 1; }
      else if (it.node.kind === 'process' && !c) r.unmeasured = 1;
    } else {
      for (const k of it.children) {
        const s = roll(k);
        r.elements += s.elements; r.leaves += s.leaves; r.procs += s.procs; r.covered += s.covered; r.total += s.total; r.measured += s.measured; r.unmeasured += s.unmeasured;
        r.traced = r.traced || s.traced;
        for (const f of s.issues) r.issues.add(f);
        for (const f of s.thin) r.thin.add(f);
        for (const f of s.done) r.done.add(f);
      }
    }
    for (const f of r.issues) r.sev[SEV.includes(f.severity) ? f.severity : 'undetermined'] += 1;
    r.worst = worst(r.sev);
    it.roll = r;
    if (ordering && it.kind === 'group') it.children.sort((a, b) => b.roll.issues.size - a.roll.issues.size || b.roll.thin.size - a.roll.thin.size || Number(b.roll.traced) - Number(a.roll.traced) || Number(a.kind === 'node') - Number(b.kind === 'node') || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    return r;
  };
  roll(root);
  ordering = false;

  // ---- view state
  const S = { open: [], pinned: new Set(), caps: new Map(), focus: null, lens: 'issues', edges: 'focus', leaves: false, labels: true, follow: true, story: true };
  // A bucket of folded leaves is still drawn at the top, closed, as one box: the platform's files,
  // variables and programs are part of its shape even when none is drawn singly.
  const shown = (it) => (it.kind === 'node' ? (S.leaves || !it.leaf) : it.roll.elements > 0 || (it.roll.leaves > 0 && (S.leaves || (!!it.bucket && it.parent === ''))));
  const topOf = (id) => { let it = items.get(id); while (it && it.parent !== '' && it.parent !== null) it = items.get(it.parent); return it || null; };
  const kidsOf = (it) => it.children.filter(shown);
  const isOpen = (it) => it.kind === 'group' && S.open.includes(it.id);
  const ancestors = (id) => { const out = []; for (let it = items.get(id); it && it.parent !== null; it = items.get(it.parent)) if (it.parent !== '') out.unshift(it.parent); return out; };

  /** Which elements a pull request touches: where the issues it rules on sit, and the files it changes. */
  const touchedBy = (pr) => {
    const out = new Set();
    for (const f of findings) if (rulesOn(pr, f)) { if (f.at.node !== undefined) out.add(f.at.node); else { out.add(f.at.flow.from); out.add(f.at.flow.to); } }
    for (const k of pr.patches) for (const fl of [k.guard, ...(k.closes || []), ...(k.rejects || [])]) if (fl) { out.add(fl.from); out.add(fl.to); }
    for (const file of pr.files || []) for (const id of [`node:module:${file}`, file]) if (items.has(id)) out.add(id);
    return out;
  };
  let changed = new Set();
  /** Move playback to `k` pull requests landed (clamped). -> the step now. Boxes holding what step k's pull request touched are marked. */
  const setStep = (k) => {
    step = Math.max(0, Math.min(prs.length, Math.round(Number(k)) || 0));
    roll(root);
    changed = new Set();
    const touched = step > 0 ? [...touchedBy(prs[step - 1])] : [];
    for (const id of touched) for (let it = items.get(id); it && it.parent !== null; it = items.get(it.parent)) changed.add(it.id);
    // the groups the last step opened are closed again; the ones the reader opened are left alone
    S.open = S.open.filter((id) => !auto.has(id));
    auto.clear();
    if (S.follow) for (const id of touched) show(id);
    return step;
  };
  /**
   * Open every group that hides an element, without selecting it. A group opened here is playback's
   * own: it draws only what the step touched, with the rest behind its "more" box (selecting that
   * box hands the group to the reader, pages and all). The budget does not apply: a step shows
   * everything it touched. A folded leaf is left folded.
   */
  const auto = new Set();
  const show = (id) => {
    const it = items.get(id);
    if (!it || it.parent === null || it.parent === '' || (it.leaf && !S.leaves)) return;
    // outermost first, so the frontier walks into each; where the reader has it open already, a page that cuts the element off is widened
    for (const a of ancestors(id)) {
      if (!S.open.includes(a)) { auto.add(a); S.open.push(a); continue; }
      if (auto.has(a)) continue;
      const p = items.get(a);
      const at = kidsOf(p).findIndex((k) => k.id === id || ancestors(id).includes(k.id));
      if (at >= (S.caps.get(a) || page)) S.caps.set(a, at + 1);
    }
  };
  const isChanged = (id) => changed.has(id);
  /** What the playback bar says about the step it is on. */
  const stepInfo = () => {
    const pr = step > 0 ? prs[step - 1] : null;
    const rules = pr ? findings.filter((f) => rulesOn(pr, f)) : [];
    return { step, total: prs.length, unit: declared ? 'pull request' : 'change set', pr: pr ? { id: pr.id, title: pr.title, state: pr.state, files: pr.files.length, patches: pr.patches.map((k) => k.id) } : null,
      fixes: rules.filter((f) => f.status === 'mitigated').map((f) => f.id), rules: rules.filter((f) => f.status !== 'mitigated').map((f) => f.id), touched: pr ? touchedBy(pr).size : 0 };
  };

  // ---- the same playback in plain words: what could go wrong, what was done about it, what is left
  const IMPACT_RANK = ['critical', 'high', 'medium', 'low'];
  const AMBIENT = ['env', 'scheduler', 'binary'];
  const outOf = new Map();
  const into = new Map();
  for (const f of flows) { if (!outOf.has(f.from)) outOf.set(f.from, []); outOf.get(f.from).push(f.to); if (!into.has(f.to)) into.set(f.to, []); into.get(f.to).push(f.from); }
  const walk = (start, edges) => { const seen = new Set(start); const q = [...start]; while (q.length) for (const n of edges.get(q.shift()) || []) if (!seen.has(n)) { seen.add(n); q.push(n); } return seen; };
  const reachMemo = new Map();
  /** Where harm from an issue could land (the impacts downstream of it, worst first) and where it could come from (what feeds it and is fed by nothing). */
  const reachOf = (f) => {
    if (reachMemo.has(f)) return reachMemo.get(f);
    const at = f.at.node !== undefined ? [f.at.node] : [f.at.flow.from, f.at.flow.to];
    const impacts = [...walk(at, outOf)].map((id) => byId.get(id)).filter((n) => n && n.impact !== undefined)
      .sort((a, b) => IMPACT_RANK.indexOf(a.impact) - IMPACT_RANK.indexOf(b.impact) || (a.label < b.label ? -1 : 1)).map((n) => ({ label: n.label || n.id, level: n.impact }));
    const sources = [...walk(at, into)].filter((id) => !at.includes(id) && !(into.get(id) || []).length).map((id) => byId.get(id)).filter((n) => n && n.kind === 'external')
      // a person or an outside system before a variable or a timer: the first is who could mean harm
      .sort((a, b) => Number(AMBIENT.includes(a.subtype)) - Number(AMBIENT.includes(b.subtype)) || ((a.label || a.id) < (b.label || b.id) ? -1 : 1)).map((n) => n.label || n.id);
    const r = { impacts, sources };
    reachMemo.set(f, r);
    return r;
  };
  const HOW = { tested: 'proved by a test', inspected: 'checked by reading the code', rescanned: 'a rescan no longer reports it', asserted: 'stated, not checked' };
  const hazard = (f) => {
    const st = stateOf(f);
    const by = allPatches.filter((k) => names(k, f));
    const levels = by.map((k) => (k.evidence && k.evidence.level) || 'asserted');
    const weakest = ['asserted', 'inspected', 'rescanned', 'tested'].find((l) => levels.includes(l));
    const ax = axesOf(f);
    const how = st === 'fixed' ? (by.length ? HOW[weakest] : 'fix reported, not rescanned') : st === 'held' ? `judged not a defect, held by ${ax.tested} tested safeguards` : st === 'thin' ? `judged not a defect, but on ${ax.tested} tested ${ax.tested === 1 ? 'safeguard' : 'safeguards'}: not closed` : 'nobody has ruled on it';
    const r = reachOf(f);
    return { id: f.id, title: f.title && f.title !== f.id ? f.title : '', where: placeOf(f), severity: sevOf(f), state: st, how, note: f.note || '', impacts: r.impacts.slice(0, 3), sources: r.sources.slice(0, 2),
      done: by.map((k) => ({ id: k.id, title: k.title || k.id, note: k.note || '' })) };
  };
  const worstFirst = (a, b) => (IMPACT_RANK.indexOf((a.impacts[0] || {}).level) + 5) % 5 - (IMPACT_RANK.indexOf((b.impacts[0] || {}).level) + 5) % 5 || SEV.indexOf(a.severity) - SEV.indexOf(b.severity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  /** The step in plain terms: the counts, what this change dealt with, and what is still open after it. */
  const story = () => {
    const pr = step > 0 && prs.length ? prs[step - 1] : null;
    const all = findings.map(hazard);
    const count = (st) => all.filter((h) => h.state === st).length;
    return { step, total: prs.length, unit: declared ? 'pull request' : 'change set', set: pr ? { id: pr.id, title: pr.title, state: pr.state } : null,
      counts: { total: all.length, open: count('open'), thin: count('thin'), held: count('held'), fixed: count('fixed') },
      // an issue the change names and leaves open is the same weakness somewhere the change does not reach
      dealt: pr ? findings.filter((f) => rulesOn(pr, f) && stateOf(f) !== 'open').map(hazard).sort(worstFirst) : [],
      beyond: pr ? findings.filter((f) => rulesOn(pr, f) && stateOf(f) === 'open').map(hazard).sort(worstFirst) : [],
      open: all.filter((h) => h.state === 'open' || h.state === 'thin').sort(worstFirst) };
  };

  /** What is drawn: -> { rows: [{ it | more, parent, open, depth }], drawnAs: element or group id -> the box that stands for it }. */
  const frontier = () => {
    const rows = [];
    const drawnAs = new Map();
    const walk = (it, depth) => {
      const kids = kidsOf(it);
      const cap = it.id === '' ? Infinity : (S.caps.get(it.id) || page);
      // a group playback opened shows what the step touched and folds the rest into its "more" box
      const only = auto.has(it.id);
      let hidden = 0;
      kids.forEach((k, i) => {
        if (only ? !changed.has(k.id) : i >= cap) { drawnAs.set(k.id, `more:${it.id}`); hidden += 1; return; }
        if (isOpen(k)) { rows.push({ it: k, parent: it.id, open: true, depth }); walk(k, depth + 1); }
        else { rows.push({ it: k, parent: it.id, open: false, depth }); drawnAs.set(k.id, k.id); }
      });
      if (hidden) rows.push({ more: hidden, id: `more:${it.id}`, parent: it.id, open: false, depth });
    };
    walk(root, 0);
    return { rows, drawnAs };
  };
  const drawnCount = () => frontier().rows.filter((r) => !r.open).length;

  /** Close the group opened longest ago until the drawing is within budget; `keep` and pinned groups stay. */
  const fit = (keep) => {
    const held = new Set([keep, ...ancestors(keep), ...S.pinned]);
    while (drawnCount() > budget) {
      const victim = S.open.find((id) => !held.has(id));
      if (victim === undefined) break;
      close(victim);
    }
  };
  const close = (id) => { const under = (x) => x === id || ancestors(x).includes(id); S.open = S.open.filter((x) => !under(x)); };
  const expand = (id) => {
    const it = items.get(id);
    if (!it || it.kind !== 'group' || id === '' || !kidsOf(it).length) return false;
    for (const a of [...ancestors(id), id]) { S.open = S.open.filter((x) => x !== a); S.open.push(a); }
    fit(id);
    return true;
  };
  const toggle = (id) => (S.open.includes(id) ? (close(id), false) : expand(id));
  const more = (moreId) => { const id = moreId.slice(5); if (auto.has(id)) auto.delete(id); else S.caps.set(id, (S.caps.get(id) || page) + page); };
  const pin = (id) => { if (S.pinned.has(id)) S.pinned.delete(id); else S.pinned.add(id); return S.pinned.has(id); };

  /** Open whatever hides an element and select it. A folded leaf is selected without being drawn. */
  const reveal = (id) => {
    const it = items.get(id);
    if (!it) return false;
    if (it.parent !== null && it.parent !== '' && !(it.leaf && !S.leaves)) {
      for (let c = it; c.parent !== null && c.parent !== ''; c = items.get(c.parent)) {
        const p = items.get(c.parent);
        const at = kidsOf(p).indexOf(c);
        if (at >= (S.caps.get(p.id) || page)) S.caps.set(p.id, at + 1);
      }
      expand(it.parent);
    }
    S.focus = id;
    return true;
  };

  /**
   * The flows to draw, merged per ordered pair of boxes: [{ from, to, count, taint, hot, level }].
   * `platform` flows join the top-level boxes and are always drawn: they are the shape of the whole.
   * `detail` flows join what is drawn inside open groups, and are drawn for a traced flow, for the
   * selected box, or all of them when asked. A folded leaf stands in its top-level bucket.
   */
  const bundles = (drawnAs, topIds) => {
    const rep = (id) => {
      const self = items.get(id);
      if (!self) return null;
      if (self.leaf && !S.leaves) { const top = topOf(id); return top && top.bucket && drawnAs.has(top.id) ? top.id : null; }
      for (let it = self; it && it.parent !== null; it = items.get(it.parent)) if (drawnAs.has(it.id)) return drawnAs.get(it.id);
      return null;
    };
    const merge = (out, a, b, f) => {
      const key = `${a}\n${b}`;
      if (!out.has(key)) out.set(key, { from: a, to: b, count: 0, taint: false });
      const e = out.get(key);
      e.count += 1;
      if (f.evidence && f.evidence.method === 'taint') e.taint = true;
    };
    const plat = new Map();
    const det = new Map();
    for (const f of flows) {
      const ta = topOf(f.from); const tb = topOf(f.to);
      if (ta && tb && ta !== tb && topIds.has(ta.id) && topIds.has(tb.id)) merge(plat, ta.id, tb.id, f);
      const a = rep(f.from); const b = rep(f.to);
      if (a !== null && b !== null && a !== b && !(topIds.has(a) && topIds.has(b))) merge(det, a, b, f);
    }
    const focus = S.focus === null ? null : (drawnAs.has(S.focus) || topIds.has(S.focus) ? (drawnAs.get(S.focus) || S.focus) : rep(S.focus));
    const hot = (e) => focus !== null && (e.from === focus || e.to === focus);
    const openTop = (id) => S.open.includes(id);
    const platform = [...plat.values()].filter((e) => !(S.edges === 'all' && (openTop(e.from) || openTop(e.to)))).map((e) => ({ ...e, hot: hot(e), level: 'platform' }));
    const all = [...det.values()];
    const detail = all.filter((e) => S.edges === 'all' || e.taint || hot(e)).map((e) => ({ ...e, hot: hot(e), level: 'detail' }));
    return { platform, detail, hidden: all.length - detail.length, focus };
  };

  // ---- layout: nested boxes, packed in rows
  const W = 172; const H = 42; const GAP = 10; const PAD = 12; const HEAD = 26;
  const pack = (sizes, maxW) => {
    let x = 0; let y = 0; let rowH = 0; let w = 0;
    const at = sizes.map((s) => {
      if (x > 0 && x + s.w > maxW) { x = 0; y += rowH + GAP; rowH = 0; }
      const p = { x, y };
      x += s.w + GAP; rowH = Math.max(rowH, s.h); w = Math.max(w, x - GAP);
      return p;
    });
    return { at, w, h: sizes.length ? y + rowH : 0 };
  };
  const COLGAP = 72; const SUBGAP = 30; const MAXCOL = 640;
  /** What a closed group's number counts: its code elements, and for a bucket (or with leaves drawn) the leaves too. */
  const sizeOf = (it) => it.roll.elements + (S.leaves || it.bucket ? it.roll.leaves : 0);
  const closedSize = (it) => ({ w: W, h: it.kind === 'group' ? H + Math.min(48, Math.round(9 * Math.log2(1 + sizeOf(it)))) : H });
  /** Which column a top-level box belongs in: sources on the left, code in the middle, what code reads, writes and runs on the right. */
  const sideOf = (it, io) => {
    if (it.roll.procs > 0) return 'M';
    if (it.bucket) return it.id === 'x:env' || it.id === 'x:scheduler' ? 'L' : 'R';
    return io.out > io.in ? 'L' : 'R';
  };
  /** Ranks for the code columns: flows run left to right where they can; a cycle is cut at its weakest end. */
  const rankCode = (ids, edges) => {
    const bal = new Map(ids.map((id) => [id, 0]));
    const es = edges.filter((e) => bal.has(e.from) && bal.has(e.to));
    for (const e of es) { bal.set(e.from, bal.get(e.from) + e.count); bal.set(e.to, bal.get(e.to) - e.count); }
    const order = [...ids].sort((a, b) => bal.get(b) - bal.get(a) || ids.indexOf(a) - ids.indexOf(b));
    const pos = new Map(order.map((id, i) => [id, i]));
    const rank = new Map(ids.map((id) => [id, 0]));
    for (const id of order) for (const e of es) if (e.from === id && pos.get(e.to) > pos.get(id)) rank.set(e.to, Math.min(2, Math.max(rank.get(e.to), rank.get(id) + 1)));
    return rank;
  };
  const layout = () => {
    const { rows, drawnAs } = frontier();
    const kids = new Map();
    for (const r of rows) { if (!kids.has(r.parent)) kids.set(r.parent, []); kids.get(r.parent).push(r); }
    const size = (r) => {
      if (!r.open) return (r.size = r.more ? { w: W, h: H } : closedSize(r.it));
      const inner = (kids.get(r.it.id) || []).map(size);
      const area = inner.reduce((s, q) => s + (q.w + GAP) * (q.h + GAP), 0);
      const p = pack(inner, Math.max(W * 2 + GAP, Math.sqrt(area) * 1.5));
      r.inner = p;
      return (r.size = { w: Math.max(p.w, W) + PAD * 2, h: p.h + HEAD + PAD });
    };
    const top = kids.get('') || [];
    top.forEach(size);
    const topIds = new Set(top.map((r) => r.it.id));
    const b = bundles(drawnAs, topIds);
    // columns: sources, then code by rank, then stores and programs
    const io = new Map(top.map((r) => [r.it.id, { in: 0, out: 0 }]));
    for (const e of b.platform) { io.get(e.from).out += e.count; io.get(e.to).in += e.count; }
    const side = new Map(top.map((r) => [r.it.id, sideOf(r.it, io.get(r.it.id))]));
    const rank = rankCode(top.filter((r) => side.get(r.it.id) === 'M').map((r) => r.it.id), b.platform);
    const colOf = (r) => (side.get(r.it.id) === 'L' ? 0 : side.get(r.it.id) === 'R' ? 4 : 1 + rank.get(r.it.id));
    const cols = new Map();
    for (const r of top) { const c = colOf(r); if (!cols.has(c)) cols.set(c, []); cols.get(c).push(r); }
    const boxes = [];
    const place = (list, packed, ox, oy) => list.forEach((r, i) => {
      const x = ox + packed.at[i].x; const y = oy + packed.at[i].y;
      boxes.push({ id: r.more ? r.id : r.it.id, x, y, w: r.size.w, h: r.size.h, open: r.open, depth: r.depth, more: r.more || 0, it: r.it || null });
      if (r.open) place(kids.get(r.it.id) || [], r.inner, x + PAD, y + HEAD);
    });
    // each column wraps into sub-columns no taller than MAXCOL; every sub-column is centred on the tallest
    const subs = [];
    for (const c of [...cols.keys()].sort((x, y) => x - y)) {
      let cur = null;
      cols.get(c).forEach((r, i) => {
        if (!cur || (cur.h > 0 && cur.h + GAP + r.size.h > MAXCOL)) { cur = { col: c, first: i === 0, rows: [], w: 0, h: 0 }; subs.push(cur); }
        cur.rows.push(r); cur.w = Math.max(cur.w, r.size.w); cur.h += (cur.h ? GAP : 0) + r.size.h;
      });
    }
    const tall = subs.reduce((m, s) => Math.max(m, s.h), 0);
    let x = PAD;
    subs.forEach((s, i) => {
      if (i > 0) x += s.first ? COLGAP : SUBGAP;
      let y = PAD + Math.round((tall - s.h) / 2);
      for (const r of s.rows) {
        boxes.push({ id: r.it.id, x: x + Math.round((s.w - r.size.w) / 2), y, w: r.size.w, h: r.size.h, open: r.open, depth: 0, more: 0, it: r.it });
        if (r.open) place(kids.get(r.it.id) || [], r.inner, x + Math.round((s.w - r.size.w) / 2) + PAD, y + HEAD);
        y += r.size.h + GAP;
      }
      x += s.w;
    });
    const edges = route([...b.platform, ...b.detail], new Map(boxes.map((q) => [q.id, q])));
    return { boxes, edges, hidden: b.hidden, focusBox: b.focus, w: x + PAD, h: tall + PAD * 2 };
  };
  /**
   * A curve for each flow, leaving and entering on the sides that face each other, each box's
   * flows spread along its height in the order of where they go, so they fan and do not knot.
   * -> the edges with { d, lx, ly } added.
   */
  const route = (edges, at) => {
    const ends = new Map();
    const cy = (q) => q.y + q.h / 2;
    edges.forEach((e, i) => { for (const [me, other] of [[e.from, e.to], [e.to, e.from]]) { if (!ends.has(me)) ends.set(me, []); ends.get(me).push({ i, y: cy(at.get(other)) }); } });
    const port = new Map();
    for (const [id, list] of ends) { const q = at.get(id); list.sort((a, b) => a.y - b.y || a.i - b.i).forEach((p, k) => port.set(`${id}\n${p.i}`, q.y + ((k + 1) * q.h) / (list.length + 1))); }
    const n = (v) => Math.round(v * 10) / 10;
    return edges.map((e, i) => {
      const a = at.get(e.from); const b = at.get(e.to);
      const y1 = port.get(`${e.from}\n${i}`); const y2 = port.get(`${e.to}\n${i}`);
      let x1; let x2; let c1; let c2;
      if (b.x >= a.x + a.w) { x1 = a.x + a.w; x2 = b.x; const dx = Math.max(24, (x2 - x1) / 2); c1 = x1 + dx; c2 = x2 - dx; }
      else if (a.x >= b.x + b.w) { x1 = a.x; x2 = b.x + b.w; const dx = Math.max(24, (x1 - x2) / 2); c1 = x1 - dx; c2 = x2 + dx; }
      else { x1 = a.x + a.w; x2 = b.x + b.w; const bulge = 28 + Math.min(40, Math.abs(y2 - y1) / 6); c1 = x1 + bulge; c2 = x2 + bulge; }
      return { ...e, d: `M${n(x1)},${n(y1)} C${n(c1)},${n(y1)} ${n(c2)},${n(y2)} ${n(x2)},${n(y2)}`, lx: n((x1 + 3 * c1 + 3 * c2 + x2) / 8), ly: n((y1 + y2) / 2) };
    });
  };

  // ---- what a box shows
  const coverageOf = (r) => (r.total > 0 ? r.covered / r.total : null);
  const lensClass = (it) => {
    const r = it.roll;
    if (S.lens === 'issues') return r.worst ? `sev-${r.worst}` : r.thin.size ? 'thin' : r.done.size ? 'done' : '';
    if (S.lens === 'coverage') { const c = coverageOf(r); return c === null ? (r.unmeasured ? 'cov-none' : '') : c < FLOOR ? 'cov-low' : 'cov-ok'; }
    if (S.lens === 'traced') return r.traced ? 'traced' : '';
    return '';
  };
  const clipText = (s, n) => { if (s.length <= n) return s; const head = Math.max(1, Math.floor((n - 1) / 2)); return `${s.slice(0, head)}…${s.slice(s.length - Math.max(0, n - 1 - head))}`; };

  // ---- lists
  const where = (id) => { const it = items.get(id); return it ? it.label : id; };
  const sevOf = (f) => (SEV.includes(f.severity) ? f.severity : 'undetermined');
  const issues = () => findings.map((f) => ({ id: f.id, title: f.title || '', severity: sevOf(f), status: f.status || 'undetermined', state: stateOf(f), ...axesOf(f), cwe: f.cwe || '', note: f.note || '',
    node: f.at.node !== undefined ? f.at.node : f.at.flow.from, where: f.at.node !== undefined ? where(f.at.node) : `${where(f.at.flow.from)} → ${where(f.at.flow.to)}` }))
    .sort((a, b) => STATES.indexOf(a.state) - STATES.indexOf(b.state) || SEV.indexOf(a.severity) - SEV.indexOf(b.severity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const search = (q, limit = 30) => {
    const s = String(q || '').trim().toLowerCase();
    if (s.length < 2) return [];
    const out = [];
    for (const f of findings) if (`${f.id} ${f.title || ''} ${f.cwe || ''}`.toLowerCase().includes(s)) out.push({ id: f.at.node !== undefined ? f.at.node : f.at.flow.from, label: `${f.id} ${f.title || ''}`.trim(), kind: 'issue' });
    for (const it of items.values()) {
      if (out.length >= limit) break;
      if (it.id !== '' && (it.label.toLowerCase().includes(s) || (it.kind === 'node' && it.id.toLowerCase().includes(s)))) out.push({ id: it.id, label: it.label, kind: it.kind === 'group' ? 'group' : it.leaf ? (it.node.subtype || it.node.kind) : 'element' });
    }
    return out.slice(0, limit);
  };
  const ranked = (map, id, limit) => [...(map.get(id) || new Map())].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit).map(([other, count]) => ({ id: other, label: where(other), count }));
  /** Everything the side panel says about one box. */
  const detail = (id, limit = 40) => {
    const it = items.get(id);
    if (!it || id === '') return null;
    const r = it.roll;
    const d = { id, label: it.label, kind: it.kind, leaf: !!it.leaf, path: ancestors(id).map(where), elements: r.elements, leaves: r.leaves, sev: r.sev, worst: r.worst, traced: r.traced,
      coverage: coverageOf(r), covered: r.covered, total: r.total, measured: r.measured, unmeasured: r.unmeasured, pinned: S.pinned.has(id), open: S.open.includes(id),
      issues: [...r.issues, ...r.thin, ...r.done].map((f) => ({ id: f.id, title: f.title || '', severity: sevOf(f), state: stateOf(f), note: f.note || '' })).sort((a, b) => STATES.indexOf(a.state) - STATES.indexOf(b.state) || SEV.indexOf(a.severity) - SEV.indexOf(b.severity) || (a.id < b.id ? -1 : 1)) };
    if (it.kind === 'node') {
      d.subtype = it.node.subtype || it.node.kind;
      d.note = it.node.note || '';
      const leavesBy = {};
      const all = touch.get(id) || new Map();
      for (const [leaf] of all) { const k = items.get(leaf).node.subtype || items.get(leaf).node.kind; (leavesBy[k] = leavesBy[k] || []).push({ id: leaf, label: where(leaf) }); }
      d.touches = Object.entries(leavesBy).sort((a, b) => b[1].length - a[1].length).map(([k, list]) => ({ kind: k, count: list.length, list: list.sort((a, b) => (a.label < b.label ? -1 : 1)).slice(0, limit) }));
      d.peers = ranked(peers, id, limit);
      d.users = ranked(users, id, limit);
    } else {
      d.children = kidsOf(it).slice(0, limit).map((k) => ({ id: k.id, label: k.label, issues: k.roll.issues.size + k.roll.thin.size, elements: k.roll.elements }));
    }
    return d;
  };
  // ---- an issue as text: to copy, and to hand to whoever will fix it
  const byIssue = new Map(findings.map((f) => [f.id, f]));
  const placeOf = (f) => (f.source ? `${f.source.file}${f.source.line ? `:${f.source.line}` : ''}` : where(f.at.node !== undefined ? f.at.node : f.at.flow.from));
  /** One issue, everything the document holds about it, as plain text. */
  const issueText = (id) => {
    const f = byIssue.get(id);
    if (!f) return '';
    const node = f.at.node !== undefined ? f.at.node : f.at.flow.from;
    const it = items.get(node);
    const src = f.source;
    const lines = [`${f.id}  ${f.title || (src ? src.rule : '')}`.trimEnd(), `severity: ${SEV.includes(f.severity) ? f.severity : 'undetermined'} · status: ${f.status || 'undetermined'}${f.cwe ? ` · ${f.cwe}` : ''}`, `where: ${placeOf(f)}`];
    const ax = axesOf(f);
    const st = stateOf(f);
    lines.push(`state: ${st === 'open' ? 'open, nobody has ruled on it' : st === 'fixed' ? 'fixed as reported, not rescanned' : st === 'held' ? `judged not a defect, held on ${ax.tested} tested axes` : `judged not a defect on ${ax.tested} tested ${ax.tested === 1 ? 'axis' : 'axes'}: not closed, the standard is two`}`);
    if (f.dataClass) lines.push(`data class: ${f.dataClass}`);
    if (src) lines.push(`reported by: ${src.tool || 'a scanner'}, rule ${src.rule}`);
    if (src && src.message) lines.push(`message: ${src.message}`);
    if (f.note) lines.push(`note: ${f.note}`);
    if (ax.controls) {
      lines.push(`controls (${ax.controls} on ${ax.axes} ${ax.axes === 1 ? 'axis' : 'axes'}, ${ax.tested} tested):`);
      for (const c of f.controls) lines.push(`  ${c.axis}: ${c.what}${c.where ? ` (${c.where})` : ''}${c.test ? ` · test: ${c.test}` : ' · no test'}`);
    }
    if (src && src.steps && src.steps.length) {
      lines.push(`traced flow (${src.steps.length} steps, source first):`);
      const shown = src.steps.length <= 14 ? src.steps.map((st, i) => [i, st]) : [...src.steps.slice(0, 6).map((st, i) => [i, st]), null, ...src.steps.slice(-6).map((st, i) => [src.steps.length - 6 + i, st])];
      for (const row of shown) lines.push(row === null ? `  … ${src.steps.length - 12} steps not shown …` : `  ${String(row[0] + 1).padStart(2, ' ')}. ${row[1].file}:${row[1].line}${row[1].expr ? `  ${row[1].expr.replace(/\s+/g, ' ')}` : ''}`);
    }
    if (it) {
      const c = it.node.coverage;
      lines.push(`element: ${it.label}${it.roll.total > 0 ? ` · ${Math.round((it.roll.covered / it.roll.total) * 100)}% of ${it.roll.total} lines covered by tests` : c ? '' : ' · test coverage not measured'}`);
      const t = [...(touch.get(node) || new Map()).keys()].map(where).sort();
      if (t.length) lines.push(`touches: ${t.slice(0, 12).join(', ')}${t.length > 12 ? `, and ${t.length - 12} more` : ''}`);
      const p = ranked(peers, node, 8).map((x) => x.label);
      if (p.length) lines.push(`flows with: ${p.join(', ')}`);
    }
    return lines.join('\n');
  };
  /**
   * A brief for whoever remediates the named issues (all of them when none is named): what to
   * establish first, what counts as done, then each issue whole. It says what the document knows
   * and no more: a scanner's result is a claim, so the first instruction is to check it.
   */
  const remediationPrompt = (ids) => {
    const pool = ids && ids.length ? ids.map((id) => byIssue.get(id)).filter(Boolean) : findings.filter((f) => ['open', 'thin'].includes(stateOf(f)));
    const chosen = [...pool].sort((a, b) => STATES.indexOf(stateOf(a)) - STATES.indexOf(stateOf(b)) || SEV.indexOf(sevOf(a)) - SEV.indexOf(sevOf(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (!chosen.length) return '';
    const files = [...new Set(chosen.map((f) => (f.source ? f.source.file : where(f.at.node !== undefined ? f.at.node : f.at.flow.from))))].sort();
    const one = chosen.length === 1;
    return [
      `Remediate ${one ? `issue ${chosen[0].id}` : `${chosen.length} issues`} in ${M.title || 'this repository'}.`,
      '',
      'The standard is a clean data flow and security that does not rest on one protection: at least two controls on different axes, each with a test that fails without it. The axes: source (validation where the value enters), flow (the value is constant, typed or transformed so the dangerous form cannot arise), sink (encoding, escaping or parameterisation at the place of use), transport (the channel is authenticated), privilege (who is allowed to reach it), containment (a sandbox, no shell, or another limit on what the sink can do). "Not exploitable today" does not close an issue.',
      '',
      `${one ? 'It is a scanner result' : 'They are scanner results'}, not ${one ? 'a verified defect' : 'verified defects'}. For each issue, in this order:`,
      '1. Open the file at the line given. The scan may be older than the source: if the code there no longer matches, find where it went, or report the issue as gone.',
      '2. Decide whether it is real: can a value an attacker controls reach the place named, and does anything on the way stop it? Read the callers, not only the line.',
      '3. If it is real, fix the cause in the smallest change that removes it, and add a test that fails before the fix and passes after it.',
      '4. If it is not real, it is still to be hardened: make the flow clean, and name or add controls until two tested ones sit on different axes. Where that is impossible or wrong, say why in sentences that name the code.',
      '5. Run the tests of every file you changed and the tests that already cover it.',
      '',
      'Do not silence a rule with a suppression comment in place of a fix or a reason. Do not widen the change beyond the issue and its siblings in the same flow.',
      '',
      'Report per issue as JSON this tool reads back (commitwork dfd --verdicts <file>), one object each:',
      '{ "id", "verdict": "fixed" | "hardened" | "not-a-defect" | "not-resolved", "reason", "dataClass": "secret" | "identifier" | "public" | "untrusted-input" | "configuration", "controls": [ { "axis", "what", "where": "file:line", "test": "file: test name" } ] }',
      '',
      `Files named: ${files.join(', ')}`,
      '',
      ...chosen.flatMap((f) => ['---', issueText(f.id), '']),
    ].join('\n').trimEnd();
  };

  const stats = () => {
    const f = frontier();
    return { elements: root.roll.elements, leaves: root.roll.leaves, flows: flows.length, issues: findings.length, states: Object.fromEntries(STATES.map((st) => [st, findings.filter((f) => stateOf(f) === st).length])), sev: root.roll.sev, drawn: f.rows.filter((r) => !r.open).length, open: S.open.length, budget,
      measured: root.roll.measured, unmeasured: root.roll.unmeasured, coverage: coverageOf(root.roll) };
  };

  return { S, SEV, FLOOR, items, root, frontier, layout, sizeOf, expand, close, toggle, more, pin, reveal, lensClass, clipText, coverageOf, issues, search, detail, stats, kidsOf, issueText, remediationPrompt, stateOf, axesOf, STATES, setStep, stepInfo, isChanged, story };
}
