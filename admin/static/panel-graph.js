// admin/static/panel-graph.js — the Graph view (#view-graph): find a node, list its neighbours by
// relation, walk to any of them, and ask for a path between two nodes. Reads /api/graph/search,
// /neighbours and /path (admin/routes/graph.mjs). Any element carrying data-graph-id opens the view
// at that node, which is how the finding, lane and project views link here. `esc` and `setView` are
// the panel client's globals, looked up at use.
(function () {
  'use strict';

  const state = { id: null, depth: 1, node: null, search: null, path: null, trail: [], loading: false, bootRead: false };
  const root = () => document.getElementById('view-graph');
  const n = (x) => (typeof x === 'number' ? String(x) : '—');
  const when = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '—');

  async function get(url) {
    try {
      const r = await fetch(url);
      let d = null;
      try { d = await r.json(); } catch (_) { /* reported below as an error */ }
      if (r.status === 401) return { state: 'unauthenticated' };
      if (r.status === 500 || !d) return { state: 'not-built', error: (d && d.error) || `HTTP ${r.status}` };
      if (r.status === 404) return { state: 'absent', ...d };
      if (!r.ok || d.ok === false) return { state: 'error', error: d.error || `HTTP ${r.status}` };
      return { state: 'ok', ...d };
    } catch (e) { return { state: 'unreachable', error: e.message }; }
  }

  // Every state that is not an answer renders as itself, never as an empty graph.
  function stateLine(d) {
    if (!d) return null;
    if (d.state === 'unreachable') return `<div><span class="pill unk">unreachable</span> <span class="mut">the panel could not be asked (${esc(d.error)}) — nothing here is a statement about the graph</span></div>`;
    if (d.state === 'unauthenticated') return '<div><span class="pill unk">not signed in</span> <span class="mut">the graph was not read</span></div>';
    if (d.state === 'not-built') return `<div><span class="pill unk">not built</span> <span class="mut">the graph could not be built here (${esc(d.error)}) — run <code>node bin/graph.mjs build</code> to see why. This is not an empty graph.</span></div>`;
    if (d.state === 'error') return `<div><span class="pill unk">refused</span> <span class="mut">${esc(d.error)}</span></div>`;
    if (d.state === 'absent') return `<div><span class="pill unk">not in the graph</span> <span class="mut">${esc(d.reason || 'no such node')}</span></div>`;
    return null;
  }

  const walk = (id, label) => `<button type="button" class="vtab vtab-sm" data-graph-id="${esc(id)}" title="${esc(id)}">${esc(label || id)}</button>`;
  const table = (head, rows) => `<div class="tw"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}" class="mut">—</td></tr>`}</tbody></table></div>`;

  // What each edge kind was built from, or why it was not. A not-built kind is absent evidence.
  function buildStatus(g) {
    if (!g || !g.status) return '';
    const rows = Object.entries(g.status).map(([k, s]) => {
      const extra = Object.entries(s).filter(([x]) => !['status', 'edges', 'reason'].includes(x)).map(([x, v]) => `${esc(x)}: ${esc(String(v))}`).join(' · ');
      return s.status === 'built'
        ? `<tr><td><b class="name">${esc(k)}</b></td><td><span class="pill live">built</span></td><td class="tnum">${n(s.edges)}</td><td class="mut">${extra}</td></tr>`
        : `<tr><td><b class="name">${esc(k)}</b></td><td><span class="pill unk">not built</span></td><td class="tnum mut">—</td><td class="mut">${esc(s.reason || 'no reason recorded')}</td></tr>`;
    }).join('');
    return `<div class="mut">store built ${esc(when(g.generated))} from inputs ${esc(g.fingerprint || '—')}${g.rebuilt ? ' · rebuilt for this request because the inputs had changed' : ''}</div>`
      + table(['Edge kind', 'Status', 'Edges', 'Detail'], rows);
  }

  function countsLine(c) {
    if (!c) return '';
    const kinds = Object.entries(c.nodes || {}).map(([k, v]) => `${esc(k)} ${n(v)}`).join(' · ');
    const rels = Object.entries(c.edges || {}).map(([k, v]) => `${esc(k)} ${n(v)}`).join(' · ');
    return `<div class="mut">nodes: ${kinds || '—'}</div><div class="mut">edges: ${rels || '—'}</div>`;
  }

  function searchBody(d) {
    if (!d) return '';
    const s = stateLine(d);
    if (s) return s;
    if (!d.q) return countsLine(d.counts);
    const rows = (d.matches || []).map((m) => `<tr><td>${walk(m.id, m.id)}</td><td class="mut">${esc(m.kind)}</td><td>${esc(m.label)}</td></tr>`).join('');
    const more = d.truncated ? ` · the first ${n(d.limit)} shown; narrow the search for the rest` : '';
    return `<div class="mut">${n(d.count)} match(es) for <code>${esc(d.q)}</code>${more}</div>` + table(['Node', 'Kind', 'Label'], rows);
  }

  // Neighbours grouped by relation and direction, each group with its count and kinds.
  function groups(list) {
    const by = new Map();
    for (const x of list || []) {
      const key = `${x.direction === 'in' ? 'in' : 'out'}\u0000${x.rel}`;
      if (!by.has(key)) by.set(key, { rel: x.rel, direction: x.direction === 'in' ? 'in' : 'out', rows: [] });
      by.get(key).rows.push(x);
    }
    return [...by.values()].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : a.direction < b.direction ? -1 : 1));
  }

  function nodeBody(d) {
    if (!d) return '';
    const s = stateLine(d);
    if (s) return s;
    const head = `<div class="hd"><h2>${esc(d.node.label || d.node.id)}</h2><span class="n">${esc(d.node.kind)}</span><span class="mut hd-note"><code>${esc(d.node.id)}</code></span></div>`;
    const kinds = Object.entries(d.kinds || {}).map(([k, v]) => `${esc(k)} ${n(v)}`).join(' · ');
    const cut = d.truncated ? ` · <b>cut at ${n(d.limit)}</b>: more neighbours exist and their number is not known` : '';
    const summary = `<div class="mut">${n(d.count)} neighbour(s) within ${n(d.depth)} hop(s)${kinds ? ` · ${kinds}` : ''}${cut}</div>`;
    const body = groups(d.neighbours).map((g) => {
      const title = g.direction === 'out' ? `${esc(g.rel)} →` : `← ${esc(g.rel)}`;
      const rows = g.rows.map((x) => `<tr><td>${walk(x.id, x.label)}</td><td class="mut">${esc(x.kind)}</td><td class="mut"><code>${esc(x.id)}</code></td><td class="tnum">${n(x.distance)}</td><td class="mut">${x.distance > 1 ? `<code>${esc(x.via)}</code>` : ''}</td></tr>`).join('');
      return `<h3>${title} <span class="mut">${n(g.rows.length)}</span></h3>` + table(['Node', 'Kind', 'Id', 'Hops', 'Via'], rows);
    }).join('');
    const none = (d.neighbours || []).length ? '' : '<div class="mut">no edges reach this node in the kinds that were built — see the build status below for the kinds that were not</div>';
    return head + summary + body + none;
  }

  function pathBody(d) {
    if (!d) return '';
    const s = stateLine(d);
    if (s) return s;
    const steps = [];
    (d.nodes || []).forEach((x, i) => {
      steps.push(walk(x.id, x.label));
      const e = (d.edges || [])[i];
      if (e) steps.push(`<span class="mut">${e.src === x.id ? `${esc(e.rel)} →` : `← ${esc(e.rel)}`}</span>`);
    });
    return `<div class="mut">${n(d.length)} hop(s) from <code>${esc(d.from)}</code> to <code>${esc(d.to)}</code></div><div class="graph-path">${steps.join(' ')}</div>`;
  }

  function render() {
    const el = root(); if (!el) return;
    const trail = state.trail.length > 1 ? `<div class="graph-trail mut">walked: ${state.trail.map((id) => walk(id, id)).join(' ')}</div>` : '';
    const depthOpts = [1, 2, 3, 4].map((d) => `<option value="${d}"${state.depth === d ? ' selected' : ''}>${d} hop${d > 1 ? 's' : ''}</option>`).join('');
    const status = (state.node && state.node.graph) || (state.search && state.search.graph) || (state.path && state.path.graph);
    // nosemgrep: javascript.browser.security.raw-html-concat.raw-html-concat, javascript.browser.xss.xss -- every interpolated value passes through esc() or n() in this file
    el.innerHTML = `<section><div class="hd"><h2>Graph</h2><span class="mut hd-note">findings, lanes, repositories, areas, weakness classes and sessions in one store (bin/graph.mjs)</span></div>`
      + `<form class="graph-form" data-graph-form="search"><input type="search" id="graph-q" placeholder="node id or label, e.g. repo:name or a finding id" aria-label="find a node" value="${esc((state.search && state.search.q) || '')}"><select id="graph-depth" aria-label="neighbour depth">${depthOpts}</select><button type="submit" class="vtab vtab-sm">Find</button></form>`
      + `<form class="graph-form" data-graph-form="path"><input type="search" id="graph-pa" placeholder="from node id" aria-label="path from" value="${esc(state.id || '')}"><input type="search" id="graph-pb" placeholder="to node id" aria-label="path to"><button type="submit" class="vtab vtab-sm">Find path</button></form>`
      + `${state.loading ? '<div class="mut">loading…</div>' : ''}${trail}</section>`
      + (state.path ? `<section><div class="hd"><h2>Path</h2></div>${pathBody(state.path)}</section>` : '')
      + (state.node ? `<section>${nodeBody(state.node)}</section>` : '')
      + (state.search ? `<section><div class="hd"><h2>${state.search.q ? 'Matches' : 'Contents'}</h2></div>${searchBody(state.search)}</section>` : '')
      + (status ? `<section><div class="hd"><h2>Build status</h2><span class="mut hd-note">each edge kind and the record it is read from</span></div>${buildStatus(status)}</section>` : '')
      + '<div class="foot">A projection, rebuilt whenever its inputs change: the issue store, the registry, the area rollups and the approach taxonomy remain the records. An edge kind marked not built had no input to read, which is not the same as having no edges. Session ids are hashed before they are stored.</div>';
  }

  async function show(id) {
    state.id = id; state.loading = true; state.path = null; render();
    state.node = await get(`/api/graph/neighbours?id=${encodeURIComponent(id)}&depth=${state.depth}`);
    if (state.trail[state.trail.length - 1] !== id) state.trail = [...state.trail.filter((x) => x !== id), id].slice(-8);
    state.loading = false; render();
  }

  async function find(q) {
    state.loading = true; render();
    state.search = await get(`/api/graph/search?q=${encodeURIComponent(q)}`);
    state.loading = false;
    const hit = state.search.state === 'ok' && (state.search.matches || [])[0];
    if (hit && hit.id === q) return show(q);
    render();
  }

  async function findPath(a, b) {
    state.loading = true; render();
    state.path = await get(`/api/graph/path?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
    state.loading = false; render();
  }

  async function loadGraph() {
    if (!state.bootRead) {
      state.bootRead = true;
      const qs = typeof URLSearchParams === 'function' && typeof location === 'object' && location ? new URLSearchParams(location.search || '') : null;
      const id = qs && qs.get('id');
      if (id && !state.id) state.id = id;
    }
    if (!state.search) { state.loading = true; render(); state.search = await get('/api/graph/search'); state.loading = false; }
    if (state.id) return show(state.id);
    render();
  }

  // Opens the view at a node from anywhere in the panel.
  function open(id) {
    state.id = id; state.node = null; state.path = null;
    if (typeof setView === 'function') setView('graph'); else loadGraph();
  }

  // Idempotent: the scanner tabs re-render on every poll.
  function attach(after, id) {
    if (!after || !after.parentElement) return;
    let b = after.nextElementSibling;
    if (!b || !b.dataset || !b.dataset.graphId) {
      b = document.createElement('button');
      b.type = 'button'; b.className = 'vtab vtab-sm'; b.textContent = 'related';
      b.title = 'open this in the Graph view';
      after.after(b);
    }
    b.dataset.graphId = id;
  }

  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('[data-graph-id]');
    if (!b) return;
    e.preventDefault();
    const id = b.dataset.graphId;
    if (root() && root().contains(b)) show(id); else open(id);
  });

  document.addEventListener('submit', (e) => {
    const f = e.target && e.target.closest && e.target.closest('[data-graph-form]');
    if (!f) return;
    e.preventDefault();
    if (f.dataset.graphForm === 'search') {
      const d = Number((document.getElementById('graph-depth') || {}).value);
      if (Number.isInteger(d) && d >= 1 && d <= 4) state.depth = d;
      const q = String((document.getElementById('graph-q') || {}).value || '').trim();
      if (q) find(q); else if (state.id) show(state.id);
    } else {
      const a = String((document.getElementById('graph-pa') || {}).value || '').trim();
      const b = String((document.getElementById('graph-pb') || {}).value || '').trim();
      if (a && b) findPath(a, b);
    }
  });

  globalThis.loadGraph = loadGraph;
  globalThis.cwGraph = Object.freeze({ state, render, loadGraph, open, attach, stateLine, nodeBody, pathBody, searchBody, buildStatus, groups });
})();
