// admin/static/panel-palette.js — the command palette (Cmd/Ctrl+K) and G-then-key chords. One
// classic script with no load-time dependency on the others: every router global it uses is
// looked up at the moment of use, so it boots in any script order and degrades to a visible hint
// rather than a thrown error. The index and the ranking come from GET /api/palette; this file
// never keeps a second list of views.
(function () {
  'use strict';

  const CHORDS = Object.freeze({ f: 'allfindings', w: 'issues', p: 'projects', t: 'verdicts', s: 'settings', o: 'overview', r: 'remediation', h: 'timeline', c: 'posture' });
  const CHORD_MS = 1500;
  const LIMIT = 20;
  const state = { open: false, q: '', results: [], active: 0, operator: false, chord: null, chordAt: 0, pending: null, lastUrl: null };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isTyping = (t) => !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable));
  const g = (name) => (typeof globalThis[name] === 'function' ? globalThis[name] : null);
  const currentProject = () => (typeof globalThis.curProj === 'string' ? globalThis.curProj : '');

  function navigate(viewId) {
    const nav = g('navigateWorkspace') || g('setView');
    if (!nav) return hint(`no router on this page to open '${viewId}'`);
    nav(viewId, nav === g('navigateWorkspace') ? { keepFocus: false } : undefined);
    document.dispatchEvent(new CustomEvent('cw:palette-navigated', { detail: { view: viewId } }));
    return true;
  }

  function selectProject(name) {
    globalThis.curProj = name;
    try { localStorage.setItem('cw-proj', name); } catch (_) { /* storage may be unavailable */ }
    const ps = document.getElementById('proj');
    if (ps) ps.value = name;
    navigate('overview');
    const load = g('load');
    if (load) load();
  }

  function reasonNotRunnable(entry) {
    if (entry.kind === 'action' && entry.operatorOnly && !state.operator) return 'available only on the operator port';
    if (entry.kind === 'action' && entry.scope === 'project' && !currentProject()) return 'choose a project first';
    return null;
  }

  async function runAction(entry) {
    const post = g('cwPost');
    if (!post) return hint('no request helper on this page');
    const body = entry.scope === 'project' ? JSON.stringify({ project: currentProject() }) : '{}';
    hint(`${entry.label}…`);
    try {
      const r = await post(entry.path, { method: entry.method || 'POST', headers: { 'content-type': 'application/json' }, body });
      hint(r && r.ok ? `${entry.label}: started` : `${entry.label}: ${r && r.status ? `refused (${r.status})` : 'failed'}`);
    } catch (e) { hint(`${entry.label}: ${e && e.message ? e.message : 'failed'}`); }
  }

  function run(entry) {
    if (!entry) return false;
    const why = reasonNotRunnable(entry);
    if (why) { hint(`${entry.label}: ${why}`); return false; }
    switch (entry.kind) {
      case 'view': close(); return navigate(entry.id);
      case 'check': {
        close();
        const hook = globalThis.cwPaletteHooks && globalThis.cwPaletteHooks.check;
        return hook ? (hook(entry.id), true) : navigate('lanes');
      }
      case 'project': close(); selectProject(entry.id); return true;
      case 'action': runAction(entry); return true;
      case 'link': {
        close();
        if (/^https?:/.test(entry.href)) window.open(entry.href, '_blank', 'noopener,noreferrer'); else location.href = entry.href;
        return true;
      }
      default: return false;
    }
  }

  // ---- DOM ------------------------------------------------------------------------------------
  let root = null, input = null, list = null, hintEl = null;
  function ensureDom() {
    if (root) return;
    // styles live in admin/menus/styles.html with the rest of the shell, tokens only
    root = document.createElement('div');
    root.id = 'cw-palette';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Command palette');
    root.hidden = true;
    root.innerHTML = '<div class="cw-palette-box">'
      + '<input id="cw-palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="cw-palette-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Search views, checks, projects and actions">'
      + '<ul id="cw-palette-list" role="listbox" aria-label="Results"></ul>'
      + '<div id="cw-palette-hint"><kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>⏎</kbd> open · <kbd>esc</kbd> close · <kbd>g</kbd> then a letter jumps: f findings · w work · p projects · t decisions · s settings</div>'
      + '</div>';
    document.body.appendChild(root);
    input = root.querySelector('#cw-palette-input') || document.getElementById('cw-palette-input');
    list = root.querySelector('#cw-palette-list') || document.getElementById('cw-palette-list');
    hintEl = root.querySelector('#cw-palette-hint') || document.getElementById('cw-palette-hint');
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    if (input) input.addEventListener('input', () => { state.q = input.value; schedule(); });
    if (list) list.addEventListener('click', (e) => {
      const li = e.target && e.target.closest ? e.target.closest('li[data-i]') : null;
      if (li) run(state.results[Number(li.dataset.i)]);
    });
  }

  function hint(text) { if (hintEl) hintEl.textContent = text; return false; }

  function renderResults(results, operator, active) {
    if (!results.length) return '<li class="cw-empty" role="option" aria-disabled="true"><span class="cw-kind">none</span>nothing matches</li>';
    return results.map((r, i) => {
      const why = (r.kind === 'action' && r.operatorOnly && !operator) ? 'operator port only' : '';
      return `<li role="option" id="cw-palette-opt-${i}" data-i="${i}" aria-selected="${i === active}"${why ? ' class="cw-disabled" aria-disabled="true"' : ''}>`
        + `<span class="cw-kind">${esc(r.kind)}</span><span class="cw-label">${esc(r.label)}</span>`
        + `<span class="cw-hint">${esc(why || r.hint || '')}</span></li>`;
    }).join('');
  }

  function paint() {
    if (!list) return;
    list.innerHTML = renderResults(state.results, state.operator, state.active);
    if (input) input.setAttribute('aria-activedescendant', state.results.length ? `cw-palette-opt-${state.active}` : '');
  }

  function schedule() {
    if (state.pending) clearTimeout(state.pending);
    state.pending = setTimeout(query, 80);
  }

  async function query() {
    state.pending = null;
    const url = `/api/palette?q=${encodeURIComponent(state.q)}&limit=${LIMIT}`;
    state.lastUrl = url;
    try {
      const r = await fetch(url);
      if (!r.ok) { state.results = []; paint(); return hint(r.status === 401 ? 'sign in to search' : `palette unavailable (${r.status})`); }
      const d = await r.json();
      if (state.lastUrl !== url) return; // a later query already answered
      state.operator = !!d.operator;
      state.results = (d.results || d.entries || []).slice(0, LIMIT);
      state.active = 0;
      paint();
    } catch (e) { state.results = []; paint(); hint(`palette unavailable: ${e && e.message ? e.message : 'network'}`); }
  }

  function open() {
    ensureDom();
    state.open = true; state.q = ''; state.results = []; state.active = 0;
    root.hidden = false;
    if (input) { input.value = ''; input.focus(); }
    paint();
    query();
  }
  function close() {
    state.open = false;
    if (root) root.hidden = true;
  }

  // ---- keys -------------------------------------------------------------------------------------
  function onKey(e) {
    if (e.defaultPrevented || e.isComposing) return;
    const key = typeof e.key === 'string' ? e.key : '';
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && key.toLowerCase() === 'k') {
      e.preventDefault();
      if (state.open) close(); else open();
      return;
    }
    if (state.open) {
      if (key === 'Escape') { e.preventDefault(); close(); return; }
      if (key === 'ArrowDown') { e.preventDefault(); if (state.results.length) { state.active = (state.active + 1) % state.results.length; paint(); } return; }
      if (key === 'ArrowUp') { e.preventDefault(); if (state.results.length) { state.active = (state.active - 1 + state.results.length) % state.results.length; paint(); } return; }
      if (key === 'Enter') { e.preventDefault(); run(state.results[state.active]); return; }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    const now = Date.now();
    if (state.chord === 'g' && now - state.chordAt <= CHORD_MS) {
      state.chord = null;
      const view = CHORDS[key.toLowerCase()];
      if (view) { e.preventDefault(); navigate(view); }
      return;
    }
    if (key === 'g' || key === 'G') { state.chord = 'g'; state.chordAt = now; return; }
    if (key === '?') { e.preventDefault(); open(); }
  }

  document.addEventListener('keydown', onKey);

  globalThis.cwPalette = Object.freeze({ open, close, run, onKey, renderResults, state, CHORDS, CHORD_MS });
})();
