// admin/static/panel-journey.js — the guided setup: one checklist view (#view-journey) and the
// "Get set up n/9" rail item. State comes from GET /api/journey, which reads every step's own
// record; this file only renders it, acknowledges optional steps through POST /api/journey, and
// completes the palette step when the palette first navigates. One classic script; router globals
// are looked up at use time.
(function () {
  'use strict';

  const STATE_LABEL = { done: 'done', skipped: 'skipped', todo: 'to do', running: 'running', unreadable: 'unreadable', unavailable: 'unavailable' };
  const STATE_PILL = { done: 'live', skipped: 'plan', todo: 'part', running: 'part', unreadable: 'unk', unavailable: 'unk' };
  const OPERATOR_WORDING = 'available only on the operator port (http://127.0.0.1:7879 by default, or http://commitwork.local)';
  const state = { data: null, error: null, loading: false, busy: null };

  const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const g = (name) => (typeof globalThis[name] === 'function' ? globalThis[name] : null);
  const root = () => document.getElementById('view-journey');
  const railItem = () => document.getElementById('rail-journey');

  // ---- per-step body --------------------------------------------------------------------------
  function stepBody(s, operator) {
    const parts = [];
    if (s.detail) parts.push(`<p class="mut">${esc(s.detail)}</p>`);
    switch (s.id) {
      case 'personalise':
        parts.push('<p>Theme, colour-vision palette and Learning mode are in the account menu (top right). Pick what suits you, then mark this done.</p>');
        break;
      case 'palette':
        if (s.state !== 'unavailable') parts.push('<p>Press <kbd>⌘</kbd><kbd>K</kbd> or <kbd>Ctrl</kbd><kbd>K</kbd>, type a view or project name, press <kbd>⏎</kbd>. <kbd>g</kbd> then <kbd>f</kbd> jumps to findings without the dialog.</p>');
        break;
      case 'project':
        if (s.state !== 'done') parts.push('<p>Open <button type="button" class="journey-go" data-view="projects">Project list</button> and add a repository path or a directory to discover, or run the command below on the box; it is safe to run again.</p>');
        break;
      case 'scanners': {
        const c = s.counts || {};
        parts.push(`<p class="tnum">${c.present ?? 0} on PATH · ${c.missing ?? 0} missing · ${c.installedNotOnPath ?? 0} installed but not on PATH · ${c.accountGated ?? 0} need an account (see Credentials)</p>`);
        if (s.missing && s.missing.length) parts.push(`<ul class="journey-tools">${s.missing.map((t) => `<li><code>${esc(t.name)}</code> missing · lanes that will report <i>not scanned</i>: ${t.blocks.map((b) => `<code>${esc(b)}</code>`).join(' ') || 'none'}</li>`).join('')}</ul>`);
        if (s.installedNotOnPath && s.installedNotOnPath.length) parts.push(`<ul class="journey-tools">${s.installedNotOnPath.map((t) => `<li><code>${esc(t.name)}</code> is installed at <code>${esc(t.at || '?')}</code> but that directory is not on PATH; add it to your shell profile and reopen the terminal</li>`).join('')}</ul>`);
        if (s.state === 'todo') parts.push(`<p>Install from <button type="button" class="journey-go" data-view="perf">Check configuration</button>${operator ? '' : ` — ${OPERATOR_WORDING}`}. Setup on a clean machine takes minutes, not seconds.</p>`);
        break;
      }
      case 'credentials': {
        if (s.missing && s.missing.length) parts.push(`<ul class="journey-tools">${s.missing.map((x) => `<li><code>${esc(x.name)}</code> does not resolve · blocks ${x.blocks.map((b) => `<code>${esc(b)}</code>`).join(' ') || 'nothing declared'}</li>`).join('')}</ul>`);
        if (s.accountGated && s.accountGated.length) parts.push(`<ul class="journey-tools">${s.accountGated.map((x) => `<li><code>${esc(x.tool)}</code> is ${esc(x.state)} and still needs ${esc(x.vendor || 'an account')}: ${x.needs.map(esc).join('; ')}</li>`).join('')}</ul>`);
        parts.push(`<p>Only presence is ever shown here. See <button type="button" class="journey-go" data-view="held">Credentials &amp; connections</button>.</p>`);
        break;
      }
      case 'firstrun':
        if (s.state === 'todo') {
          parts.push(`<p><button type="button" id="journey-run" ${state.busy ? 'disabled' : ''}>Run checks now</button> <span class="mut">on the selected project; the feed shows what it finds, and a lane's pass is not the result</span></p>`);
          if (s.reportDirSet === false) parts.push('<p class="mut">CW_REPORT_DIR is unset: every CLI run warns three lines and writes to a temp dir until it is.</p>');
        }
        if (s.state === 'done') parts.push('<p>Open <button type="button" class="journey-go" data-view="feed">Findings feed</button> to read the counts.</p>');
        break;
      case 'schedule':
        if (s.perArea && s.perArea.length) parts.push(`<ul class="journey-tools">${s.perArea.map((a) => `<li><code>${esc(a.slug)}</code> ${esc(a.state)}${a.paused ? ' (paused)' : ''}</li>`).join('')}</ul>`);
        if (s.state === 'todo') parts.push(`<p>The plan is generated from the registry; loading it into launchd is a human act${operator ? '' : `, and ${OPERATOR_WORDING}`}. See <button type="button" class="journey-go" data-view="rollups">Rollups</button> for what is installed.</p>`);
        break;
      case 'notifications':
        parts.push('<p>The daily report and the weekly digest read <code>monitor/private/daily.json</code>.</p>');
        break;
      default: break;
    }
    if (s.cli) parts.push(`<pre class="journey-cli"><code>${esc(s.cli)}</code></pre>`);
    return parts.join('');
  }

  function stepControls(s) {
    const out = [];
    if (s.optional && (s.state === 'todo')) out.push(`<button type="button" class="journey-ack" data-step="${esc(s.id)}" ${state.busy ? 'disabled' : ''}>${s.id === 'personalise' || s.id === 'palette' ? 'Mark done' : 'Skip for now'}</button>`);
    if (s.optional && (s.state === 'skipped' || (s.state === 'done' && ['personalise', 'palette'].includes(s.id)))) out.push(`<button type="button" class="journey-unack" data-step="${esc(s.id)}" ${state.busy ? 'disabled' : ''}>Undo</button>`);
    return out.join(' ');
  }

  function render() {
    const r = root();
    const d = state.data;
    if (r) {
      if (state.error) r.innerHTML = `<h2>Get set up</h2><div class="banner-box"><span class="pill high">error</span> ${esc(state.error)} · the checklist is unavailable, not complete.</div>`;
      else if (!d) r.innerHTML = `<h2>Get set up</h2><p class="mut">${state.loading ? 'reading the records…' : 'not loaded'}</p>`;
      else {
        const p = d.progress;
        const storeNote = d.storeState === 'unreadable' ? `<div class="banner-box"><span class="pill unk">store unreadable</span> ${esc(d.storeError || '')} · acknowledgements cannot be read or written; measured steps are unaffected.</div>` : '';
        const unreadable = p.unreadable.length ? `<p class="mut">${p.unreadable.length} step${p.unreadable.length === 1 ? '' : 's'} could not be measured: ${p.unreadable.map(esc).join(', ')}.</p>` : '';
        r.innerHTML = `<h2>Get set up <span class="tnum mut">${p.done}/${p.total}</span></h2>`
          + `<p class="note-b">Every step reads its own record each time this page loads; nothing here is a stored tick. ${d.complete ? 'Everything measurable is in place.' : 'Optional steps can be skipped and undone.'}`
          + ` <button type="button" id="journey-dismiss">${d.dismissed ? 'Show in the rail again' : 'Hide from the rail'}</button></p>`
          + storeNote + unreadable
          + '<ol class="journey">' + d.steps.map((s, i) => `<li class="journey-step state-${esc(s.state)}" data-step="${esc(s.id)}">`
            + `<div class="journey-head"><span class="tnum mut">${i + 1}</span> <b>${esc(s.title)}</b> <span class="pill ${STATE_PILL[s.state] || 'unk'}">${esc(STATE_LABEL[s.state] || s.state)}</span>${s.optional ? ' <span class="mut">optional</span>' : ''}${s.offPort ? ` <span class="pill unk" title="${esc(OPERATOR_WORDING)}">operator port</span>` : ''} <span class="journey-controls">${stepControls(s)}</span></div>`
            + `<div class="journey-body">${stepBody(s, d.operator)}</div></li>`).join('') + '</ol>';
      }
    }
    const rail = railItem();
    if (rail) {
      if (!d || state.error) { rail.hidden = false; rail.textContent = 'Get set up'; }
      else { rail.hidden = !!(d.dismissed || d.complete); rail.textContent = `Get set up ${d.progress.done}/${d.progress.total}`; }
    }
  }

  async function loadJourney() {
    state.loading = true; state.error = null; render();
    try {
      const r = await fetch('/api/journey');
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      // a reply without the journey's shape is not a journey; render it as an error, never as a list
      if (!d || !Array.isArray(d.steps) || !d.progress || !Array.isArray(d.progress.unreadable)) throw new Error('unexpected reply from /api/journey');
      state.data = d;
    } catch (e) { state.error = e && e.message ? e.message : 'request failed'; state.data = null; }
    state.loading = false;
    render();
  }

  async function post(body) {
    const cw = g('cwPost');
    if (!cw) { state.error = 'no request helper on this page'; render(); return null; }
    state.busy = body; render();
    try {
      const r = await cw('/api/journey', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `refused (${r.status})`);
      if (!d || !Array.isArray(d.steps) || !d.progress) throw new Error('unexpected reply from /api/journey');
      state.data = d; state.error = null;
      return d;
    } catch (e) { state.error = e && e.message ? e.message : 'request failed'; return null; }
    finally { state.busy = null; render(); }
  }

  function onClick(e) {
    const t = e.target;
    if (!t) return;
    if (t.classList && t.classList.contains('journey-ack')) { post({ acknowledge: t.dataset.step }); return; }
    if (t.classList && t.classList.contains('journey-unack')) { post({ unacknowledge: t.dataset.step }); return; }
    if (t.id === 'journey-dismiss' && state.data) { post({ dismissed: !state.data.dismissed }); return; }
    if (t.classList && t.classList.contains('journey-go')) {
      const nav = g('navigateWorkspace') || g('setView');
      if (nav) nav(t.dataset.view, nav === g('navigateWorkspace') ? { keepFocus: false } : undefined);
      return;
    }
    if (t.id === 'journey-run') {
      const cw = g('cwPost');
      const project = typeof globalThis.curProj === 'string' ? globalThis.curProj : '';
      if (!cw) return;
      if (!project) { state.error = 'choose a project first'; render(); return; }
      t.disabled = true;
      cw('/api/sweep', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project }) })
        .then(() => loadJourney(), () => { state.error = 'could not start the sweep'; render(); });
    }
  }

  document.addEventListener('click', onClick);
  // the palette step completes on the first navigation the palette makes, and only if it is still to do
  document.addEventListener('cw:palette-navigated', () => {
    const d = state.data;
    const s = d && d.steps.find((x) => x.id === 'palette');
    if (s && s.state === 'todo') post({ acknowledge: 'palette' });
  });

  // the rail item needs the progress at boot; features.js fires cw:features on every load and switch
  document.addEventListener('cw:features', () => {
    const on = g('featureOn');
    if (!on || on('journey')) loadJourney();
    else { const rail = railItem(); if (rail) rail.hidden = true; }
  });

  globalThis.loadJourney = loadJourney;
  globalThis.cwJourney = Object.freeze({ state, loadJourney, render, post, onClick, stepBody });
})();
