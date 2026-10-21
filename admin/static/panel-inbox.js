// admin/static/panel-inbox.js — the Inbox: what changed in the selected project since its last
// sweep, from GET /api/inbox. Priority and Other tabs, a split list and detail, U read/unread,
// H snooze for seven days, J/K move, Enter opens. What could not be measured is listed under the
// list on every tab, never left as an empty one. One classic script; it owns #view-inbox.
(function () {
  'use strict';

  const SNOOZE_DAYS = 7;
  const KIND_LABEL = { 'sweep-failed': 'sweep failed', 'new-kev': 'new KEV', 'new-critical': 'new critical', 'lane-undetermined': 'undetermined', 'ingest-behind': 'ingest behind' };
  const KIND_PILL = { 'sweep-failed': 'high', 'new-kev': 'kev', 'new-critical': 'crit', 'lane-undetermined': 'unk', 'ingest-behind': 'part' };

  const state = { project: '', tab: 'priority', loading: false, error: null, never: false, items: [], notMeasured: [], counts: null, generated: null, prevSliceId: null, active: 0, notice: null };

  const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const g = (name) => (typeof globalThis[name] === 'function' ? globalThis[name] : null);
  const currentProject = () => (typeof globalThis.curProj === 'string' ? globalThis.curProj : '');
  const root = () => document.getElementById('view-inbox');
  const isTyping = (t) => !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable));
  const visible = () => { const r = root(); return !!(r && !r.hidden && r.style && r.style.display !== 'none' && !(r.classList && r.classList.contains && r.classList.contains('vhide'))); };

  function shown() {
    return state.items.filter((i) => !i.snoozedUntil && (state.tab === 'priority' ? i.priority : !i.priority));
  }

  function badge() {
    const set = g('setTabN');
    if (!set) return;
    if (!state.counts) set('inbox', null);
    else set('inbox', state.counts.priority + state.counts.other);
  }

  function renderDetail(it) {
    if (!it) return '<div class="inbox-detail mut">Nothing selected.</div>';
    const d = it.detail || {};
    const places = Array.isArray(d.places) ? d.places : [];
    return `<div class="inbox-detail"><h3>${esc(it.title)}</h3>`
      + `<p class="mut">${esc(KIND_LABEL[it.kind] || it.kind)} · ${esc(it.at || 'no time recorded')} · ${it.read ? `read ${esc(it.readAt)}` : 'unread'}</p>`
      + (d.reason ? `<p>${esc(d.reason)}</p>` : '')
      + (places.length ? `<ul>${places.slice(0, 50).map((p) => `<li><code>${esc([p.repo, p.rule || p.id || p.package || p.sub || '', p.file || p.path || ''].filter(Boolean).join(' · '))}</code>${p.sev ? ` <span class="mut">${esc(p.sev)}</span>` : ''}</li>`).join('')}</ul>` : '')
      + (d.beyondCap ? `<p class="mut">${esc(d.beyondCap)} more past the delta's display cap are not listed.</p>` : '')
      + `<p><button type="button" class="inbox-act" data-act="${it.read ? 'unread' : 'read'}">${it.read ? 'Mark unread' : 'Mark read'} <kbd>U</kbd></button> `
      + `<button type="button" class="inbox-act" data-act="snooze">Snooze ${SNOOZE_DAYS} days <kbd>H</kbd></button></p></div>`;
  }

  function render() {
    const r = root();
    if (!r) return;
    if (!state.project) { r.innerHTML = '<p class="mut">Inbox: choose a project first; it reads one area\'s last sweep.</p>'; return; }
    if (state.error) { r.innerHTML = `<p><span class="pill high">error</span> ${esc(state.error)}</p><p class="mut">This is an error, never an empty inbox.</p>`; return; }
    if (state.loading && !state.items.length) { r.innerHTML = '<p class="mut">loading the inbox…</p>'; return; }
    if (state.never) { r.innerHTML = `<p class="mut">${esc(state.project)} was never swept, so nothing has changed since a sweep.</p>`; return; }
    const c = state.counts || { priority: 0, other: 0, unread: 0, snoozed: 0 };
    const list = shown();
    if (state.active >= list.length) state.active = Math.max(0, list.length - 1);
    const rows = list.map((it, i) => `<li class="inbox-row${i === state.active ? ' active' : ''}${it.read ? ' read' : ''}" data-i="${i}">`
      + `<span class="pill ${KIND_PILL[it.kind] || 'unk'}">${esc(KIND_LABEL[it.kind] || it.kind)}</span> ${esc(it.title)}</li>`).join('');
    const nm = state.notMeasured.length
      ? `<div class="inbox-nm"><strong>Not measured</strong><ul>${state.notMeasured.map((n) => `<li><code>${esc(n.signal)}</code> — ${esc(n.reason)}</li>`).join('')}</ul></div>` : '';
    r.innerHTML = `<div class="inbox-head"><button type="button" data-tab="priority" class="${state.tab === 'priority' ? 'on' : ''}">Priority (${c.priority})</button>`
      + `<button type="button" data-tab="other" class="${state.tab === 'other' ? 'on' : ''}">Other (${c.other})</button>`
      + ` <span class="mut">${c.unread} unread · ${c.snoozed} snoozed · since ${esc(state.prevSliceId || 'no previous slice')}</span>`
      + (state.notice ? ` <span class="pill high">refused</span> ${esc(state.notice)}` : '') + '</div>'
      + `<div class="inbox-split"><ul class="inbox-list">${rows || `<li class="mut">Nothing ${state.tab === 'priority' ? 'urgent' : 'else'} changed in this sweep.</li>`}</ul>${renderDetail(list[state.active])}</div>${nm}`;
  }

  async function loadInbox() {
    const next = currentProject();
    if (next !== state.project) { state.active = 0; state.tab = 'priority'; }
    state.project = next;
    state.notice = null;
    if (!state.project) { state.items = []; state.counts = null; badge(); render(); return; }
    state.loading = true; state.error = null; render();
    try {
      const r = await fetch(`/api/inbox?project=${encodeURIComponent(state.project)}`);
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      state.never = d.state === 'never-swept';
      if (!state.never && (!Array.isArray(d.items) || !d.counts)) throw new Error('unexpected reply from /api/inbox');
      state.items = d.items || []; state.notMeasured = d.notMeasured || []; state.counts = d.counts || null;
      state.generated = d.generated || null; state.prevSliceId = d.prevSliceId || null;
    } catch (e) { state.error = e.message; state.items = []; state.counts = null; }
    state.loading = false;
    badge(); render();
  }

  async function mark(action) {
    const it = shown()[state.active];
    const post = g('cwPost');
    if (!it || !post) return;
    try {
      const body = { ids: [it.id], action, ...(action === 'snooze' ? { days: SNOOZE_DAYS } : {}) };
      const r = await post('/api/inbox/mark', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok || !d.ok) { state.notice = d.error || `HTTP ${r.status}`; render(); return; }
    } catch (e) { state.notice = e.message; render(); return; }
    await loadInbox();
  }

  function onClick(e) {
    const t = e.target;
    if (!t || !visible()) return;
    if (t.dataset && t.dataset.tab) { state.tab = t.dataset.tab; state.active = 0; render(); return; }
    if (t.dataset && t.dataset.i !== undefined) { state.active = Number(t.dataset.i) || 0; render(); return; }
    if (t.classList && t.classList.contains('inbox-act') && t.dataset.act) mark(t.dataset.act);
  }

  function onKey(e) {
    if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!visible() || isTyping(e.target)) return;
    const n = shown().length;
    const k = e.key;
    if (k === 'j' || k === 'J') { e.preventDefault(); state.active = Math.min(n - 1, state.active + 1); render(); }
    else if (k === 'k' || k === 'K') { e.preventDefault(); state.active = Math.max(0, state.active - 1); render(); }
    else if (k === 'u' || k === 'U') { e.preventDefault(); const it = shown()[state.active]; if (it) mark(it.read ? 'unread' : 'read'); }
    else if (k === 'h' || k === 'H') { e.preventDefault(); mark('snooze'); }
    else if (k === 'Enter') { e.preventDefault(); const it = shown()[state.active]; if (it && !it.read) mark('read'); }
    else if (k === 'Tab' && !e.shiftKey) { e.preventDefault(); state.tab = state.tab === 'priority' ? 'other' : 'priority'; state.active = 0; render(); }
  }

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('cw:palette-navigated', (e) => { if (e.detail && e.detail.view === 'inbox') loadInbox(); });

  globalThis.loadInbox = loadInbox;
  globalThis.cwInbox = Object.freeze({ state, loadInbox, render, mark, onClick, onKey, shown });
})();
