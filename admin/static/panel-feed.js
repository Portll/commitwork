// admin/static/panel-feed.js — the one findings feed: groups from GET /api/feed, members on expand
// from GET /api/feed/group, a Focus/All toggle whose hidden count is always on screen, row
// selection with a bulk fix through POST /api/issues/fix-bulk, and J/K/Enter/X keys. One classic
// script: it owns the markup inside #view-feed and looks every router global up at use time.
(function () {
  'use strict';

  const PILL = { crit: 'crit', high: 'high', med: 'part', low: 'plan', unknown: 'unk' };
  const STATE_LABEL = { open: 'open', claimed: 'claimed', blocked: 'blocked', suppressed: 'suppressed', 'claimed-fixed': 'claimed fixed', fixed: 'fixed', accepted: 'accepted', refuted: 'refuted', superseded: 'superseded', gone: 'gone' };
  const FIX_TYPES = ['code-change', 'config-change', 'dep-upgrade', 'compensating-control', 'suppression', 'wont-fix'];
  const PAGE = 200;

  const state = {
    project: '', mode: 'focus', offset: 0, loading: false, error: null, never: false,
    groups: [], totals: null, hidden: 0, groupCount: 0, undeclaredLanes: [], generated: null,
    active: 0, selected: new Set(), expanded: new Map(), lastClicked: null, busy: false, results: null,
  };

  const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const g = (name) => (typeof globalThis[name] === 'function' ? globalThis[name] : null);
  const currentProject = () => (typeof globalThis.curProj === 'string' ? globalThis.curProj : '');
  const root = () => document.getElementById('view-feed');
  const isTyping = (t) => !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable));
  const visible = () => { const r = root(); return !!(r && !r.hidden && r.style && r.style.display !== 'none' && !(r.classList && r.classList.contains && r.classList.contains('vhide'))); };

  function sevPill(sev, kev) {
    const s = PILL[sev] || 'unk';
    return `<span class="pill ${s}" title="${sev === 'unknown' ? 'the check gave this row no severity' : esc(sev)}">${sev === 'unknown' ? 'not graded' : esc(sev)}</span>`
      + (kev ? ' <span class="pill exploited" title="on CISA’s known-exploited list: shown between high and critical, never changing the finding’s own severity">exploited</span>' : '');
  }

  function statesLabel(states) {
    return Object.entries(states || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${STATE_LABEL[k] || k}`).join(' · ');
  }

  // ---- render --------------------------------------------------------------------------------
  function renderHeader() {
    const t = state.totals;
    const proj = state.project ? `<code>${esc(state.project)}</code>` : 'no project chosen';
    if (state.never) return `<div class="mut banner-box">⬜ never swept — ${proj} has no rollup yet, so there is nothing to show and nothing to call clean.</div>`;
    if (state.error) return `<div class="banner-box"><span class="pill high">error</span> ${esc(state.error)} · an unreadable rollup is an error, never an empty feed.</div>`;
    if (!t) return '<div class="mut note-b">loading…</div>';
    const focusN = t.focus, allN = t.groups;
    return `<div class="note-b">`
      + `<span class="cw-feed-modes" role="group" aria-label="Which groups to show">`
      + `<button type="button" data-mode="focus" class="${state.mode === 'focus' ? 'pri' : ''}" aria-pressed="${state.mode === 'focus'}">Focus <span class="tnum">${focusN}</span></button> `
      + `<button type="button" data-mode="all" class="${state.mode === 'all' ? 'pri' : ''}" aria-pressed="${state.mode === 'all'}">All <span class="tnum">${allN}</span></button>`
      + `</span> · <span class="mut">${state.hidden ? `${state.hidden} group${state.hidden === 1 ? '' : 's'} hidden by Focus` : 'nothing hidden'}</span>`
      + ` · <span class="mut tnum">${t.rows} rows · ${t.graded} graded · ${t.undetermined} not graded · ${t.suppressed} suppressed${t.kev ? ` · ${t.kev} exploited` : ''}</span>`
      + (state.undeclaredLanes.length ? ` · <span class="pill unk" title="rows from a lane with no declared identity are grouped by a fallback field">${state.undeclaredLanes.length} undeclared lane${state.undeclaredLanes.length === 1 ? '' : 's'}</span>` : '')
      + (state.generated ? ` · <span class="mut">as of ${esc(state.generated)}</span>` : '')
      + `</div>`;
  }

  function renderBulkBar() {
    const n = state.selected.size;
    const opts = FIX_TYPES.map((f) => `<option value="${f}">${f}</option>`).join('');
    return `<div class="cw-feed-bulk note-b">`
      + `<span class="tnum">${n} selected</span> `
      + `<select id="feed-fix-type" aria-label="Fix type" ${n ? '' : 'disabled'}>${opts}</select> `
      + `<input id="feed-fix-notes" type="text" aria-label="Fix notes (8 to 2000 characters)" placeholder="what was done, in a sentence" ${n ? '' : 'disabled'}> `
      + `<button type="button" id="feed-fix-go" ${n && !state.busy ? '' : 'disabled'}>Record fix for ${n} group${n === 1 ? '' : 's'}</button>`
      + ` <span class="mut">a recorded fix is a claim; the row leaves on scan evidence at the next ingest</span>`
      + (state.results ? ` <span id="feed-fix-result" class="tnum">${esc(state.results)}</span>` : '')
      + `</div>`;
  }

  function renderMembers(key) {
    const m = state.expanded.get(key);
    if (m === 'loading') return `<tr class="feed-members" data-key="${esc(key)}"><td colspan="7" class="mut">loading members…</td></tr>`;
    if (m && m.error) return `<tr class="feed-members" data-key="${esc(key)}"><td colspan="7"><span class="pill high">error</span> ${esc(m.error)}</td></tr>`;
    if (!Array.isArray(m)) return '';
    return `<tr class="feed-members" data-key="${esc(key)}"><td></td><td colspan="6"><table class="feed-sub"><tbody>`
      + m.map((x) => {
        const r = x.row || {};
        const where = [r.file || r.path || r.resource || r.package || r.component || r.name || '', r.line != null ? `:${r.line}` : ''].join('');
        const st = x.issue ? (x.issue.state === 'closed' ? `closed as ${esc(x.issue.closedAs || '?')}` : esc(x.issue.state)) : (x.suppressed ? 'suppressed' : 'open · not in the tracker');
        return `<tr><td>${sevPill(x.sev, r.kev === true)}</td><td><code>${esc(where)}</code></td><td>${esc(r.message || r.summary || '')}</td><td>${x.issue ? `<code>${esc(x.issue.id)}</code> · ` : ''}${st}</td></tr>`;
      }).join('')
      + '</tbody></table></td></tr>';
  }

  function renderRows() {
    if (state.never || state.error) return '';
    if (state.loading && !state.groups.length) return Array.from({ length: 6 }, () => '<tr class="feed-skeleton" aria-hidden="true"><td colspan="7" class="mut">…</td></tr>').join('');
    if (!state.groups.length) return `<tr><td colspan="7" class="mut">${state.mode === 'focus' && state.hidden ? `nothing in Focus · ${state.hidden} hidden — switch to All to see them` : 'no groups in this view'}</td></tr>`;
    return state.groups.map((gp, i) => {
      const sel = state.selected.has(gp.key);
      return `<tr class="feed-row${i === state.active ? ' active' : ''}${sel ? ' selected' : ''}" data-key="${esc(gp.key)}" data-i="${i}" aria-selected="${sel}">`
        + `<td><input type="checkbox" class="feed-sel" data-key="${esc(gp.key)}" aria-label="select ${esc(gp.subject)}" ${sel ? 'checked' : ''}></td>`
        + `<td>${sevPill(gp.worst, gp.kev)}</td>`
        + `<td><button type="button" class="feed-open" data-key="${esc(gp.key)}" aria-expanded="${state.expanded.has(gp.key)}">${esc(gp.subject || '(no subject)')}</button></td>`
        + `<td class="mut">${esc(gp.lane)}</td>`
        + `<td><code>${esc(gp.repo)}</code> · <span class="tnum">${gp.distinct}</span> place${gp.distinct === 1 ? '' : 's'}</td>`
        + `<td class="tnum">${gp.members}${gp.undetermined ? ` <span class="pill unk">${gp.undetermined} not graded</span>` : ''}${gp.suppressed ? ` <span class="mut">${gp.suppressed} suppressed</span>` : ''}</td>`
        + `<td>${esc(statesLabel(gp.states))}</td>`
        + '</tr>' + renderMembers(gp.key);
    }).join('');
  }

  function render() {
    const r = root();
    if (!r) return;
    r.innerHTML = `<h2>Findings</h2>${renderHeader()}${state.totals && !state.never && !state.error ? renderBulkBar() : ''}`
      + '<table class="feed"><thead><tr><th scope="col"><span class="sr-only">select</span></th><th scope="col">Severity</th><th scope="col">Group</th><th scope="col">Check</th><th scope="col">Where</th><th scope="col">Rows</th><th scope="col">State</th></tr></thead>'
      + `<tbody id="feed-rows">${renderRows()}</tbody></table>`
      + (state.groupCount > state.offset + state.groups.length ? `<div class="note-b"><button type="button" id="feed-more">Show ${Math.min(PAGE, state.groupCount - state.offset - state.groups.length)} more of ${state.groupCount}</button></div>` : '');
  }

  // ---- data ----------------------------------------------------------------------------------
  async function loadFeed({ append = false } = {}) {
    const project = currentProject();
    if (project !== state.project) { state.selected.clear(); state.expanded.clear(); state.active = 0; state.offset = 0; state.results = null; }
    state.project = project;
    if (!project) { state.totals = null; state.groups = []; state.never = false; state.error = 'choose a project to see its findings'; render(); return; }
    state.loading = true; state.error = null; state.never = false;
    if (!append) render();
    try {
      const r = await fetch(`/api/feed?project=${encodeURIComponent(project)}&mode=${state.mode}&limit=${PAGE}&offset=${append ? state.offset + state.groups.length : 0}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (d.state === 'never-swept') { state.never = true; state.groups = []; state.totals = null; state.hidden = 0; state.groupCount = 0; }
      else if (!Array.isArray(d.groups) || !d.totals) throw new Error('unexpected reply from /api/feed');
      else {
        state.never = false;
        state.groups = append ? state.groups.concat(d.groups) : d.groups;
        if (!append) state.offset = 0;
        state.totals = d.totals; state.hidden = d.hidden; state.groupCount = d.groupCount; state.undeclaredLanes = d.undeclaredLanes || []; state.generated = d.generated;
      }
    } catch (e) { state.error = e && e.message ? e.message : 'request failed'; state.groups = []; state.totals = null; }
    state.loading = false;
    render();
    if (g('setTabN')) g('setTabN')('feed', state.totals && !state.never ? state.totals.focus : null, 'groups in Focus');
  }

  function setMode(mode) {
    if (mode !== 'focus' && mode !== 'all') return;
    if (mode === state.mode) return;
    state.mode = mode;
    // a selection made in one view must not survive into another: the rows it named may be hidden
    state.selected.clear(); state.active = 0; state.results = null;
    return loadFeed();
  }

  async function toggleExpand(key) {
    if (state.expanded.has(key)) { state.expanded.delete(key); render(); return; }
    state.expanded.set(key, 'loading'); render();
    try {
      const r = await fetch(`/api/feed/group?project=${encodeURIComponent(state.project)}&key=${encodeURIComponent(key)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      state.expanded.set(key, d.members);
    } catch (e) { state.expanded.set(key, { error: e && e.message ? e.message : 'request failed' }); }
    render();
  }

  function toggleSelect(key, { range = false } = {}) {
    const idx = state.groups.findIndex((x) => x.key === key);
    if (idx < 0) return;
    if (range && state.lastClicked != null) {
      const [a, b] = [Math.min(state.lastClicked, idx), Math.max(state.lastClicked, idx)];
      for (let i = a; i <= b; i++) state.selected.add(state.groups[i].key);
    } else if (state.selected.has(key)) state.selected.delete(key);
    else state.selected.add(key);
    state.lastClicked = idx;
    state.results = null;
    render();
  }

  // The bulk fix needs issue ids, which live on members; groups not yet expanded are fetched first.
  async function membersFor(key) {
    const have = state.expanded.get(key);
    if (Array.isArray(have)) return have;
    const r = await fetch(`/api/feed/group?project=${encodeURIComponent(state.project)}&key=${encodeURIComponent(key)}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d.members;
  }

  async function bulkFix({ fixType, notes } = {}) {
    const post = g('cwPost');
    if (!post) { state.results = 'no request helper on this page'; render(); return null; }
    if (!state.selected.size || state.busy) return null;
    state.busy = true; state.results = 'collecting issue records…'; render();
    const items = [], noIssue = [];
    try {
      for (const key of state.selected) {
        const members = await membersFor(key);
        for (const m of members) {
          if (m.issue && m.issue.id) items.push({ id: m.issue.id, fixType, notes, expectUpdatedAt: m.issue.updatedAt });
          else noIssue.push(key);
        }
      }
    } catch (e) { state.busy = false; state.results = `could not read members: ${e && e.message ? e.message : 'request failed'}`; render(); return null; }
    if (!items.length) { state.busy = false; state.results = `no issue records behind the selection — ingest the tracker first (${noIssue.length} rows without one)`; render(); return null; }
    let out = null;
    const pages = [];
    for (let i = 0; i < items.length; i += 200) pages.push(items.slice(i, i + 200));
    const agg = { applied: 0, unchanged: 0, refused: 0, results: [] };
    try {
      for (const page of pages) {
        const r = await post('/api/issues/fix-bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: page }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        agg.applied += d.applied; agg.unchanged += d.unchanged; agg.refused += d.refused; agg.results.push(...d.results);
      }
      out = agg;
      state.results = `${agg.applied} recorded · ${agg.unchanged} unchanged · ${agg.refused} refused${noIssue.length ? ` · ${noIssue.length} rows have no issue record` : ''} · all still open until scan evidence`;
    } catch (e) { state.results = `bulk fix failed: ${e && e.message ? e.message : 'request failed'} · nothing was assumed recorded`; }
    state.busy = false;
    for (const key of state.selected) state.expanded.delete(key); // re-read members next time rather than show the pre-write state
    render();
    return out;
  }

  // ---- events --------------------------------------------------------------------------------
  function onClick(e) {
    const t = e.target;
    if (!t || !visible()) return;
    const key = t.dataset && t.dataset.key;
    if (t.classList && t.classList.contains('feed-sel') && key) { toggleSelect(key, { range: !!e.shiftKey }); return; }
    if (t.classList && t.classList.contains('feed-open') && key) { toggleExpand(key); return; }
    if (t.dataset && t.dataset.mode) { setMode(t.dataset.mode); return; }
    if (t.id === 'feed-more') { loadFeed({ append: true }); return; }
    if (t.id === 'feed-fix-go') {
      const ft = document.getElementById('feed-fix-type'), nt = document.getElementById('feed-fix-notes');
      bulkFix({ fixType: ft ? ft.value : FIX_TYPES[0], notes: nt ? nt.value : '' });
    }
  }

  function onKey(e) {
    if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!visible() || isTyping(e.target) || !state.groups.length) return;
    const key = e.key;
    if (key === 'j' || key === 'ArrowDown') { e.preventDefault(); state.active = Math.min(state.groups.length - 1, state.active + 1); render(); return; }
    if (key === 'k' || key === 'ArrowUp') { e.preventDefault(); state.active = Math.max(0, state.active - 1); render(); return; }
    if (key === 'x') { e.preventDefault(); toggleSelect(state.groups[state.active].key, { range: e.shiftKey }); return; }
    if (key === 'Enter') { e.preventDefault(); toggleExpand(state.groups[state.active].key); }
  }

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('cw:palette-navigated', (e) => { if (e.detail && e.detail.view === 'feed') loadFeed(); });

  globalThis.loadFeed = loadFeed;
  globalThis.cwFeed = Object.freeze({ state, loadFeed, setMode, toggleExpand, toggleSelect, bulkFix, render, onKey, onClick, FIX_TYPES, PAGE });
})();
