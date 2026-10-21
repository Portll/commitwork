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
  // Triage keys write after a short undo window, never on the keypress itself (bifocal W8).
  const UNDO_MS = 5000;
  const SNOOZE_DAYS = 7;
  const TRIAGE_LABEL = { accept: 'Accepting', decline: 'Declining', duplicate: 'Marking duplicate', snooze: `Snoozing ${SNOOZE_DAYS} days`, unsnooze: 'Unsnoozing' };
  const DECLINE_DISPOSITIONS = ['false-positive', 'not-applicable'];

  const state = {
    project: '', mode: 'focus', offset: 0, loading: false, error: null, never: false,
    groups: [], totals: null, hidden: 0, groupCount: 0, undeclaredLanes: [], generated: null,
    active: 0, selected: new Set(), expanded: new Map(), lastClicked: null, busy: false, results: null,
    pending: null, form: null, pr: new Map(),
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

  function renderPending() {
    const p = state.pending;
    if (!p) return '';
    return `<div class="cw-feed-pending note-b" role="status"><span class="pill part">${esc(TRIAGE_LABEL[p.action] || p.action)}</span> ${p.items.length} issue${p.items.length === 1 ? '' : 's'} in ${esc(p.group.subject)} · writes in ${Math.round(UNDO_MS / 1000)} s · <button type="button" id="feed-undo">Undo</button></div>`;
  }

  function renderForm(gp) {
    const f = state.form;
    if (!f || f.groupKey !== gp.key) return '';
    if (f.kind === 'decline') {
      return `<tr class="feed-form" data-key="${esc(gp.key)}"><td></td><td colspan="6">`
        + `<label>Decline as <select id="feed-form-disposition">${DECLINE_DISPOSITIONS.map((d) => `<option value="${d}" ${d === f.disposition ? 'selected' : ''}>${d}</option>`).join('')}</select></label> `
        + `<input id="feed-form-reason" type="text" aria-label="Reason (at least 8 characters)" placeholder="why this is not a real finding here" value="${esc(f.reason || '')}"> `
        + `<button type="button" class="feed-form-submit">File ruling</button> <button type="button" class="feed-form-cancel">Cancel</button>`
        + ` <span class="mut">a named ruling with a reason; the row leaves on scan evidence, not on this</span>${f.error ? ` <span class="pill high">${esc(f.error)}</span>` : ''}</td></tr>`;
    }
    return `<tr class="feed-form" data-key="${esc(gp.key)}"><td></td><td colspan="6">`
      + `<label>Duplicate of <input id="feed-form-target" type="text" aria-label="Issue id this duplicates" placeholder="ISS-…" value="${esc(f.duplicateOf || '')}"></label> `
      + `<button type="button" class="feed-form-submit">Mark duplicate</button> <button type="button" class="feed-form-cancel">Cancel</button>`
      + ` <span class="mut">closes these as superseded by the target</span>${f.error ? ` <span class="pill high">${esc(f.error)}</span>` : ''}</td></tr>`;
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
      + ` <span class="mut">keys on the highlighted group: <kbd>1</kbd> accept · <kbd>2</kbd> decline · <kbd>3</kbd> duplicate · <kbd>h</kbd> snooze · <kbd>u</kbd> unsnooze</span>`
      + `</div>` + renderPending();
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
      + '</tbody></table>' + renderFix(key, m) + '</td></tr>';
  }

  function fixLine(x) {
    const r = x.row || {};
    if (r.package) return `${r.package}${r.version ? '@' + r.version : ''} → ${r.fixed || r.fix || 'no fixed version published'}`;
    return `${r.rule || r.id || ''}: the scanner's guidance is on its lane tab; the review prompt is on the issue`;
  }

  // The PR is a proposal: the route pushes a commitwork/ branch and never the default one.
  function renderFix(key, m) {
    const pr = state.pr.get(key);
    const note = !pr ? '' : pr.busy ? '<span class="mut">starting…</span>' : pr.error ? `<span class="pill high">refused</span> ${esc(pr.error)}` : `<span class="pill plan">started</span> ${esc(pr.text)}`;
    return `<div class="feed-fix"><strong>How do I fix it?</strong><ul>${m.slice(0, 20).map((x) => `<li><code>${esc(fixLine(x))}</code></li>`).join('')}</ul>`
      + `<button class="feed-pr" data-key="${esc(key)}"${pr && pr.busy ? ' disabled' : ''}>Create PR</button> <span class="mut">a proposal on a commitwork/ branch; merging stays human</span> ${note}</div>`;
  }

  async function createPr(key) {
    const post = g('cwPost');
    if (!post || !state.project) return;
    state.pr.set(key, { busy: true }); render();
    try {
      const r = await post('/api/issue/pr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: state.project, key }) });
      const d = await r.json();
      if (!r.ok || !d.ok) state.pr.set(key, { error: d.error || `HTTP ${r.status}` });
      else state.pr.set(key, { text: `create-pr job started for ${d.repo} on ${d.branch}, as ${d.identity}; the URL arrives in the job stream` });
    } catch (e) { state.pr.set(key, { error: e.message }); }
    render();
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
        + '</tr>' + renderForm(gp) + renderMembers(gp.key);
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

  // ---- triage keys with an undo window ---------------------------------------------------------
  function activeGroup() { return state.groups[state.active] || null; }

  async function issueItemsFor(gp, action) {
    const members = await membersFor(gp.key);
    const items = [];
    for (const m of members) {
      const i = m.issue;
      if (!i || !i.id) continue;
      if (action !== 'unsnooze' && i.state === 'closed') continue;
      if (action === 'unsnooze' && !i.snoozedUntil) continue;
      items.push({ id: i.id, expectUpdatedAt: i.updatedAt, subjectDigest: i.subjectDigest || null });
    }
    return { items, withoutRecord: members.filter((m) => !m.issue).length };
  }

  // Queue one action on the highlighted group. A pending action is written first, so a second key
  // never silently replaces the first; the new one then gets its own window.
  async function queueTriage(action, extra = {}) {
    const gp = activeGroup();
    if (!gp || state.busy) return null;
    if (state.pending) await runPending();
    let found;
    try { found = await issueItemsFor(gp, action); } catch (e) { state.results = `could not read members: ${e && e.message ? e.message : 'request failed'}`; render(); return null; }
    if (!found.items.length) {
      state.results = found.withRecord === 0 ? `no issue records behind ${gp.subject} — ingest the tracker first` : `nothing in ${gp.subject} this applies to`;
      render(); return null;
    }
    state.pending = { action, extra, group: gp, items: found.items, timer: setTimeout(() => { runPending(); }, UNDO_MS), queuedAt: Date.now() };
    state.results = null;
    render();
    return state.pending;
  }

  function cancelPending() {
    if (!state.pending) return;
    clearTimeout(state.pending.timer);
    state.pending = null;
    state.results = 'undone · nothing was written';
    render();
  }

  async function runPending() {
    const p = state.pending;
    if (!p) return null;
    clearTimeout(p.timer);
    state.pending = null;
    const post = g('cwPost');
    if (!post) { state.results = 'no request helper on this page'; render(); return null; }
    state.busy = true; render();
    const out = { ok: 0, refused: 0, errors: [] };
    for (const it of p.items) {
      try {
        const body = { id: it.id, action: p.action, expectUpdatedAt: it.expectUpdatedAt, ...p.extra };
        if (p.action === 'decline' && it.subjectDigest) body.subjectDigest = it.subjectDigest;
        const r = await post('/api/issue/triage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        if (r.ok) out.ok++; else { out.refused++; out.errors.push(`${it.id}: ${d.error || (d.errors && d.errors[0]) || `refused (${r.status})`}`); }
      } catch (e) { out.refused++; out.errors.push(`${it.id}: ${e && e.message ? e.message : 'request failed'}`); }
    }
    state.busy = false;
    state.results = `${TRIAGE_LABEL[p.action] || p.action}: ${out.ok} written · ${out.refused} refused${out.errors.length ? ` · ${out.errors.slice(0, 3).join(' · ')}` : ''}${p.action === 'decline' ? ' · rulings filed, rows still open until scan evidence' : ''}`;
    state.expanded.delete(p.group.key);
    await loadFeed();
    return out;
  }

  // Leaving the page writes what is pending rather than dropping it.
  function flushPending() { if (state.pending) runPending(); }

  function openForm(kind) {
    const gp = activeGroup();
    if (!gp) return;
    state.form = { kind, groupKey: gp.key, disposition: DECLINE_DISPOSITIONS[0], reason: '', duplicateOf: '', error: null };
    render();
    const el = document.getElementById(kind === 'decline' ? 'feed-form-reason' : 'feed-form-target');
    if (el && el.focus) el.focus();
  }
  function closeForm() { state.form = null; render(); }
  function readForm() {
    const f = state.form;
    if (!f) return;
    const d = document.getElementById('feed-form-disposition'), r = document.getElementById('feed-form-reason'), t = document.getElementById('feed-form-target');
    if (d) f.disposition = d.value;
    if (r) f.reason = r.value;
    if (t) f.duplicateOf = t.value;
  }
  async function submitForm() {
    const f = state.form;
    if (!f) return null;
    readForm();
    if (f.kind === 'decline') {
      if (!DECLINE_DISPOSITIONS.includes(f.disposition)) { f.error = 'pick false-positive or not-applicable'; render(); return null; }
      if (!f.reason || f.reason.trim().length < 8) { f.error = 'a reason of at least 8 characters is required'; render(); return null; }
      const extra = { disposition: f.disposition, reason: f.reason.trim() };
      state.form = null;
      return queueTriage('decline', extra);
    }
    if (!/^ISS-[A-Z0-9-]+$/i.test((f.duplicateOf || '').trim())) { f.error = 'name the issue id this duplicates (ISS-…)'; render(); return null; }
    const extra = { duplicateOf: f.duplicateOf.trim() };
    state.form = null;
    return queueTriage('duplicate', extra);
  }

  // ---- events --------------------------------------------------------------------------------
  function onClick(e) {
    const t = e.target;
    if (!t || !visible()) return;
    const key = t.dataset && t.dataset.key;
    if (t.classList && t.classList.contains('feed-sel') && key) { toggleSelect(key, { range: !!e.shiftKey }); return; }
    if (t.classList && t.classList.contains('feed-open') && key) { toggleExpand(key); return; }
    if (t.classList && t.classList.contains('feed-pr') && key) { createPr(key); return; }
    if (t.dataset && t.dataset.mode) { setMode(t.dataset.mode); return; }
    if (t.id === 'feed-more') { loadFeed({ append: true }); return; }
    if (t.id === 'feed-undo') { cancelPending(); return; }
    if (t.classList && t.classList.contains('feed-form-submit')) { submitForm(); return; }
    if (t.classList && t.classList.contains('feed-form-cancel')) { closeForm(); return; }
    if (t.id === 'feed-fix-go') {
      const ft = document.getElementById('feed-fix-type'), nt = document.getElementById('feed-fix-notes');
      bulkFix({ fixType: ft ? ft.value : FIX_TYPES[0], notes: nt ? nt.value : '' });
    }
  }

  function onKey(e) {
    if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!visible()) return;
    // inside the inline form: Enter submits, Escape cancels, everything else types
    if (state.form && isTyping(e.target)) {
      if (e.key === 'Enter') { e.preventDefault(); submitForm(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeForm(); }
      return;
    }
    if (isTyping(e.target) || !state.groups.length) return;
    const key = e.key;
    if (key === 'Escape' && state.form) { e.preventDefault(); closeForm(); return; }
    if (key === '1') { e.preventDefault(); queueTriage('accept'); return; }
    if (key === '2') { e.preventDefault(); openForm('decline'); return; }
    if (key === '3') { e.preventDefault(); openForm('duplicate'); return; }
    if (key === 'h') { e.preventDefault(); queueTriage('snooze', { days: SNOOZE_DAYS }); return; }
    if (key === 'u') { e.preventDefault(); queueTriage('unsnooze'); return; }
    if (key === 'j' || key === 'ArrowDown') { e.preventDefault(); state.active = Math.min(state.groups.length - 1, state.active + 1); render(); return; }
    if (key === 'k' || key === 'ArrowUp') { e.preventDefault(); state.active = Math.max(0, state.active - 1); render(); return; }
    if (key === 'x') { e.preventDefault(); toggleSelect(state.groups[state.active].key, { range: e.shiftKey }); return; }
    if (key === 'Enter') { e.preventDefault(); toggleExpand(state.groups[state.active].key); }
  }

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('cw:palette-navigated', (e) => { if (e.detail && e.detail.view === 'feed') loadFeed(); });
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', flushPending);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPending(); });
  }

  globalThis.loadFeed = loadFeed;
  globalThis.cwFeed = Object.freeze({ state, loadFeed, setMode, toggleExpand, toggleSelect, bulkFix, render, onKey, onClick, queueTriage, runPending, cancelPending, flushPending, openForm, closeForm, submitForm, FIX_TYPES, PAGE, UNDO_MS, SNOOZE_DAYS });
})();
