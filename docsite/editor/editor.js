// docsite editor — dependency-free split-pane Markdown editor. The preview imports the SAME
// parser module the build uses (served verbatim as /edit-assets/docsite-md.mjs), so what you see
// is what publishes, byte for byte. Vendored from the md-live-editor spike: the debounce +
// echo-guard + cursor-restore skeleton survives; its VS Code plumbing and internal parser do not.
//
// No Save/Publish buttons. Save is a 3s-idle autosave (Cmd+S forces it immediately); state changes
// (draft/hidden/published, via the state <select> on each row and in the header) and saves to an
// already-live doc each trigger the real deploy directly — there is no separate publish step left.
// Unsaved work is still mirrored to localStorage per slug (a faster, 200ms debounce, purely local),
// so a crash or a slow network never eats an edit even while the save-to-origin is in flight.

import { renderDocBody, esc } from './docsite-md.mjs';

const apiBase = document.querySelector('meta[name="cw-api-base"]')?.content || '';
const $ = (id) => document.getElementById(id);
const els = {
  doclist: $('doclist'), source: $('source'), preview: $('preview'), status: $('status'),
  dirty: $('dirty'), badge: $('statebadge'),
  banner: $('banner'), conflict: $('conflict'), conflictsum: $('conflictsum'), conflictlist: $('conflictlist'),
  keepnewer: $('keepnewer'), takeserver: $('takeserver'), takemine: $('takemine'),
  conflictmerge: $('conflictmerge'), conflictlater: $('conflictlater'), words: $('wordcount'),
  sync: $('syncbtn'), purge: $('purgebtn'), theme: $('themebtn'),
  importbtn: $('importbtn'), importfile: $('importfile'), diffpane: $('diffpane'),
  difflist: $('difflist'), diffsum: $('diffsum'), diffmerge: $('diffmerge'),
  difftakeall: $('difftakeall'), diffcancel: $('diffcancel'),
  // Pane sizing. main and srcPane go through querySelector simply because neither carries an id and
  // $() is id-only; there is one <main> and one .pane-source in edit.html.
  main: document.querySelector('main'), srcPane: document.querySelector('.pane-source'),
  splitList: $('split-list'), splitSource: $('split-source'),
};

// Theme toggle: system (no attribute, follows prefers-color-scheme) -> light -> dark -> system.
// Persisted per-browser in localStorage; editor.css's :root[data-theme] blocks are what this
// attribute actually drives.
const THEME_KEY = 'cw-docsite-editor-theme';
const THEME_LABEL = { system: '◐', light: '☀', dark: '☾' };
function applyTheme(mode) {
  if (mode === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  els.theme.textContent = THEME_LABEL[mode] || THEME_LABEL.system;
  els.theme.title = `Theme: ${mode} (click to change)`;
}
(function initTheme() {
  let saved = 'system';
  try { saved = localStorage.getItem(THEME_KEY) || 'system'; } catch { /* private browsing etc. */ }
  applyTheme(saved);
})();
els.theme.addEventListener('click', () => {
  const order = ['system', 'light', 'dark'];
  const cur = document.documentElement.dataset.theme || 'system';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* best effort */ }
});

// ── Pane sizing ─────────────────────────────────────────────────────────────────────────────────
// The three panes are grid tracks driven by custom properties on <main> (editor.css). Two things
// are deliberate here. The document list is stored as a REM LENGTH, because a list of titles wants
// a width that tracks the type size. The source/preview boundary is stored as a RATIO, never a
// pixel width: a pixel split is wrong the instant the window is resized, and this editor is used
// both full-screen and beside a browser. Persisted per browser, like the theme above.
const LAYOUT_KEY = 'cw-docsite-editor-layout';
const LIST_MIN = 10, LIST_MAX = 40;   // rem — the aria-valuemin/max on #split-list must match
const SRC_MIN = 20, SRC_MAX = 80;     // % of the source+preview area — likewise for #split-source
const LAYOUT_DEFAULT = { list: 15, src: 50 };
let layout = { ...LAYOUT_DEFAULT };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

function applyLayout() {
  // --w-src and --w-prev always sum to 2fr, so the pair IS the ratio and neither track can
  // collapse the other by rounding.
  els.main.style.setProperty('--w-list', `${layout.list}rem`);
  els.main.style.setProperty('--w-src', `${layout.src / 50}fr`);
  els.main.style.setProperty('--w-prev', `${(100 - layout.src) / 50}fr`);
  els.splitList.setAttribute('aria-valuenow', String(Math.round(layout.list)));
  els.splitSource.setAttribute('aria-valuenow', String(Math.round(layout.src)));
}
const saveLayout = () => {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* best effort */ }
};
(function initLayout() {
  try {
    const s = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
    // Clamp rather than trust: a value written by an older build, or hand-edited, must not be able
    // to drive a pane to zero width and make the editor look empty.
    if (s && Number.isFinite(s.list) && Number.isFinite(s.src)) {
      layout = { list: clamp(s.list, LIST_MIN, LIST_MAX), src: clamp(s.src, SRC_MIN, SRC_MAX) };
    }
  } catch { /* private browsing, or unparseable — fall back to the default */ }
  applyLayout();
})();

function startDrag(which, ev) {
  ev.preventDefault();
  const bar = which === 'list' ? els.splitList : els.splitSource;
  document.body.dataset.resizing = '';
  bar.dataset.dragging = '';
  const move = (e) => {
    const main = els.main.getBoundingClientRect();
    if (which === 'list') {
      layout.list = clamp((e.clientX - main.left) / remPx(), LIST_MIN, LIST_MAX);
    } else {
      // Measured from where the source pane actually starts, so the ratio means the same thing
      // regardless of how wide the list currently is.
      const srcStart = els.srcPane.getBoundingClientRect().left;
      const avail = main.right - srcStart;
      if (avail > 0) layout.src = clamp(((e.clientX - srcStart) / avail) * 100, SRC_MIN, SRC_MAX);
    }
    applyLayout();
  };
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    delete document.body.dataset.resizing;
    delete bar.dataset.dragging;
    saveLayout();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  // A drag interrupted by the OS (a swipe gesture, a window switch) must still release the body
  // cursor and the pointer-events lock, or the editor stays unclickable with nothing to click on.
  window.addEventListener('pointercancel', end);
}

function setPane(which, value) {
  if (which === 'list') layout.list = clamp(value, LIST_MIN, LIST_MAX);
  else layout.src = clamp(value, SRC_MIN, SRC_MAX);
  applyLayout();
  saveLayout();
}

for (const [which, bar] of [['list', els.splitList], ['source', els.splitSource]]) {
  bar.addEventListener('pointerdown', (e) => startDrag(which, e));
  bar.addEventListener('dblclick', () => setPane(which, which === 'list' ? LAYOUT_DEFAULT.list : LAYOUT_DEFAULT.src));
  bar.addEventListener('keydown', (e) => {
    const cur = which === 'list' ? layout.list : layout.src;
    const step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowLeft') { e.preventDefault(); setPane(which, cur - step); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setPane(which, cur + step); }
    else if (e.key === 'Home') { e.preventDefault(); setPane(which, which === 'list' ? LAYOUT_DEFAULT.list : LAYOUT_DEFAULT.src); }
  });
}

const STATES = ['draft', 'hidden', 'published'];

let slug = null;
let baseHash = null;         // the OPEN doc's content hash
let serverMtime = null;      // ISO mtime of the disk copy the buffer was loaded from
let lastEditAt = 0;          // ms clock of the last keystroke — the buffer's own timestamp
let manifestBaseHash = null; // the manifest's hash — required by state/reorder/import
let docsCache = [];
let dirty = false;
let saving = false;
let conflictPending = false; // a conflict was shown and deferred; autosave stays off until resolved
let csrf = null; // same-origin only; cross-origin requests are origin-gated server-side
let previewTimer = null;
let saveTimer = null;

const draftKey = () => `cw-docsite-draft:${slug}`;
const status = (msg, isErr = false) => { els.status.textContent = msg; els.status.className = isErr ? 'err' : ''; };
const banner = (html) => { els.banner.innerHTML = html; els.banner.hidden = !html; };

const ago = (iso) => {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return 'unknown time';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const localTime = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString() : String(iso); };

const api = async (path, opts = {}) => {
  const headers = { ...(opts.headers || {}) };
  if (opts.method === 'POST') {
    headers['content-type'] = 'application/json';
    if (!apiBase) { // same-origin: blanket CSRF gate wants the token
      if (!csrf) {
        const r = await fetch('/api/csrf', { credentials: 'include' });
        csrf = (await r.json()).token;
      }
      headers['x-cw-csrf'] = csrf;
    }
  }
  return fetch(apiBase + path, { credentials: 'include', ...opts, headers });
};

const setDirty = (v) => { dirty = v; els.dirty.hidden = !v; };

// The preview is an iframe holding a REAL document, so it can load the stylesheet the published
// page is actually built from (/edit-assets/page.css, served straight off lib/docsite-page.mjs's
// CSS export) instead of a hand-copy of it. Copy plus renderer was the old arrangement, and the
// copy had drifted: four of six shared selectors differed by 2026-09-01, `code` among them, so the
// one thing a live preview exists to promise was the thing it got wrong.
//
// The document is built ONCE and only its inner container is replaced per keystroke. Rewriting the
// whole document each time would re-fetch the sheet, flash unstyled content at every 200ms debounce,
// and throw away the reader's scroll position — the preview would be unusable precisely while being
// used. #pv-root sits inside main>.wrap because that is the structure the shell renders into, and
// several of its rules are descendant selectors that would not match a bare body.
// The frame's document is the PUBLISHED TEMPLATE for the open document (/docsite/preview-shell:
// header, nav, title, state badge, footer from lib/docsite-page.mjs's own shell) with an empty
// #pv-root. It is loaded once per document via src; nothing is written into it but the body.
let previewShellSlug = null;
const loadPreviewShell = (s) => {
  if (previewShellSlug === s) return;
  previewShellSlug = s;
  els.preview.src = `/docsite/preview-shell?slug=${encodeURIComponent(s)}`;
};
const previewRoot = () => {
  const d = els.preview.contentDocument;
  return d ? d.getElementById('pv-root') : null;
};
// The shell renders the manifest title as its own <h1>, and renderPage strips a leading '# Title'
// from the body for that reason; the preview must do the same or show two headings.
const stripLeadingH1 = (html) => html.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/, '');

const renderPreview = () => {
  const html = stripLeadingH1(renderDocBody(els.source.value));
  const root = previewRoot();
  if (!root && previewShellSlug) {
    // A nav link inside the shell navigated the frame away from it; bring the shell back.
    let at = null;
    try { at = els.preview.contentWindow.location.pathname; } catch { /* cross-origin: leave it */ }
    if (at && at !== '/docsite/preview-shell' && at !== 'blank') { previewShellSlug = null; loadPreviewShell(slug); }
  }
  if (root) {
    const d = root.ownerDocument;
    // scrollingElement is the one that actually scrolls in either quirks or standards mode.
    const scroller = d.scrollingElement || d.documentElement;
    const top = scroller.scrollTop;
    root.innerHTML = html;
    scroller.scrollTop = top;
  }
  const words = els.source.value.split(/\s+/).filter(Boolean).length;
  els.words.textContent = `${words} words`;
};

// The shell arrives after the document text does; render on load so the first keystroke is not
// the first thing the pane shows.
els.preview.addEventListener('load', renderPreview);

const persistDraft = () => {
  try { localStorage.setItem(draftKey(), JSON.stringify({ content: els.source.value, baseHash })); } catch { /* quota — the origin copy is the real one */ }
};
const clearDraft = () => { try { localStorage.removeItem(draftKey()); } catch { /* ignore */ } };

// Two debounces, deliberately different lengths: the 200ms one is local only (preview + crash-safe
// draft) and unchanged from before. The save-to-origin debounce is slower (3s) because it is now
// also a real network round-trip that may deploy — firing it on every keystroke pause the way the
// local one does would hammer the deploy pipeline.
const onInput = () => {
  setDirty(true);
  lastEditAt = Date.now();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => { renderPreview(); persistDraft(); }, 200);
  clearTimeout(saveTimer);
  if (!conflictPending) saveTimer = setTimeout(save, 3000);
};

// External update (take-server / restore): replace text but keep the cursor where it was.
const setSourceExternal = (text) => {
  const pos = els.source.selectionStart;
  els.source.value = text;
  els.source.setSelectionRange(Math.min(pos, text.length), Math.min(pos, text.length));
  renderPreview();
};

function stateSelectHtml(id, current) {
  return `<select id="${id}" class="stateselect">${STATES.map((s) =>
    `<option value="${s}"${s === current ? ' selected' : ''}>${s}</option>`).join('')}</select>`;
}

async function setState(theSlug, state) {
  status('setting state…');
  let r;
  try {
    r = await api('/api/docsite/state', { method: 'POST', body: JSON.stringify({ slug: theSlug, state, baseHash: manifestBaseHash }) });
  } catch { status('origin unreachable', true); return false; }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { status('not signed in', true); banner(`Session expired. <a href="${apiBase || ''}/">Log in</a>, then try again.`); return false; }
  if (r.status === 409 && d.conflict) { status('the doc list changed elsewhere — reloading', true); return false; }
  if (r.status === 409 && d.locked) { status('another writer holds the lock — try again', true); return false; }
  if (!r.ok) { status(`state change failed: ${d.error || r.status}`, true); if (d.detail) banner(`<pre>${esc(d.detail)}</pre>`); return false; }
  status(d.unchanged ? 'no change' : `${theSlug} → ${state} ✓${d.deployOutput !== undefined ? ' — live' : ''}`);
  return true;
}

async function reorder(order) {
  status('reordering…');
  let r;
  try {
    r = await api('/api/docsite/reorder', { method: 'POST', body: JSON.stringify({ order, baseHash: manifestBaseHash }) });
  } catch { status('origin unreachable', true); return false; }
  const d = await r.json().catch(() => ({}));
  if (r.status === 409 && d.conflict) { status('the doc list changed elsewhere — reloading', true); return false; }
  if (r.status === 409 && d.locked) { status('another writer holds the lock — try again', true); return false; }
  if (!r.ok) { status(`reorder failed: ${d.error || r.status}`, true); return false; }
  status('reordered ✓ — live');
  return true;
}

function syncHeaderBadge() {
  const d = docsCache.find((x) => x.slug === slug);
  if (!d) { els.badge.hidden = true; return; }
  els.badge.innerHTML = STATES.map((s) => `<option value="${s}"${s === d.state ? ' selected' : ''}>${s}</option>`).join('');
  els.badge.hidden = false;
}
els.badge.addEventListener('change', async () => {
  if (!slug) return;
  await setState(slug, els.badge.value);
  await loadList();
});

// The document list must never be silently empty. Blank means "signed in, nothing here"; these
// name which void this actually is, in the list itself rather than only in a banner.
function doclistState(msg) { els.doclist.innerHTML = `<li class=\"docrow-void\">${msg}</li>`; }

// Cover the editor and say why. `reason` is the headline, `detail` the measured specific.
function gate(reason, detail) {
  const g = document.getElementById('authgate');
  if (!g) return;
  document.getElementById('gate-title').textContent = reason;
  document.getElementById('gate-detail').textContent = detail;
  const login = document.getElementById('gate-login');
  if (login) login.href = (apiBase || '') + '/';
  g.hidden = false;
}
function ungate() { const g = document.getElementById('authgate'); if (g) g.hidden = true; }
function renderDoclist() {
  if (!docsCache.length) { doclistState('No documents in the manifest yet.'); return; }
  els.doclist.innerHTML = docsCache.map((d, i) => `
    <li class="docrow${d.slug === slug ? ' current' : ''}${d.kind === 'md' ? ' loadable' : ''}" data-open="${esc(d.slug)}"
        role="${d.kind === 'md' ? 'button' : ''}" tabindex="${d.kind === 'md' ? '0' : ''}"
        aria-label="${d.kind === 'md' ? `Open ${esc(d.title)} in the editor` : ''}">
      <div class="docrow-main">
        <span class="doctitle">${esc(d.title)}</span>
        <span class="kindbadge">${esc(d.kind)}</span>
      </div>
      <div class="docrow-controls">
        ${d.kind === 'md' ? `<button type="button" class="openbtn" data-open-btn="${esc(d.slug)}"${d.slug === slug ? ' disabled' : ''} title="Open in the editor">${d.slug === slug ? 'Editing' : 'Edit'}</button>` : ''}
        ${stateSelectHtml(`state-${i}`, d.state)}
        <button type="button" class="reorder" data-move="up" data-slug="${esc(d.slug)}"${i === 0 ? ' disabled' : ''} aria-label="Move up">▲</button>
        <button type="button" class="reorder" data-move="down" data-slug="${esc(d.slug)}"${i === docsCache.length - 1 ? ' disabled' : ''} aria-label="Move down">▼</button>
        <a class="viewlive" href="/${encodeURIComponent(d.urlPath)}/" target="_blank" rel="noopener" title="Open the live page in a new tab">Preview</a>
        <button type="button" class="history" data-history="${esc(d.slug)}" data-urlpath="${esc(d.urlPath)}" data-kind="${esc(d.kind)}">History</button>
        ${d.kind === 'md' ? `<button type="button" class="history" data-duplicate="${esc(d.slug)}" data-title="${esc(d.title)}" title="Copy this document into a new draft">Duplicate</button>` : ''}
      </div>
      <div class="history-pane" id="history-${esc(d.slug)}" hidden></div>
    </li>`).join('');

  // The row itself is the "open in editor" target — clicking anywhere on it except the controls
  // strip (state select, reorder, Preview, History) loads the doc. kind:"imported" docs have no
  // source to load, so their row isn't a button at all; Preview is their only per-row action.
  els.doclist.querySelectorAll('li[data-open]').forEach((row) => {
    const s = row.getAttribute('data-open');
    const d = docsCache.find((x) => x.slug === s);
    if (!d || d.kind !== 'md') return;
    const open = (e) => { if (e.target.closest('.docrow-controls')) return; loadDoc(s); };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
  });
  els.doclist.querySelectorAll('[data-open-btn]').forEach((btn) => {
    btn.addEventListener('click', () => loadDoc(btn.getAttribute('data-open-btn')));
  });
  els.doclist.querySelectorAll('.stateselect').forEach((sel, i) => {
    if (sel === els.badge) return;
    sel.addEventListener('change', async () => {
      const d = docsCache[i];
      await setState(d.slug, sel.value);
      await loadList();
    });
  });
  els.doclist.querySelectorAll('[data-move]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const s = btn.getAttribute('data-slug');
      const dir = btn.getAttribute('data-move');
      const order = docsCache.map((d) => d.slug);
      const i = order.indexOf(s);
      const j = dir === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      await reorder(order);
      await loadList();
    });
  });
  els.doclist.querySelectorAll('[data-history]').forEach((btn) => {
    btn.addEventListener('click', () => toggleHistory(btn));
  });
  els.doclist.querySelectorAll('[data-duplicate]').forEach((btn) => {
    btn.addEventListener('click', () => duplicateDoc(btn.getAttribute('data-duplicate'), btn.getAttribute('data-title')));
  });
}

// The copy lands as a private DRAFT under a new slug: nothing deploys, nobody can reach it, and
// the source it was copied from is untouched. The new document is opened straight away.
async function duplicateDoc(fromSlug, fromTitle) {
  const taken = new Set(docsCache.map((d) => d.slug));
  let suggested = `${fromSlug}-copy`;
  for (let n = 2; taken.has(suggested); n++) suggested = `${fromSlug}-copy-${n}`;
  const newSlug = window.prompt('Slug for the copy (lowercase letters, digits, hyphens):', suggested);
  if (newSlug === null) return;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(newSlug)) return status('slug must be lowercase letters, digits and hyphens', true);
  const title = window.prompt('Title for the copy:', `${fromTitle} (copy)`);
  if (title === null) return;
  if (!title.trim()) return status('title cannot be empty', true);
  status(`duplicating ${fromSlug}…`);
  let r;
  try {
    r = await api('/api/docsite/duplicate', { method: 'POST', body: JSON.stringify({ slug: fromSlug, newSlug, title: title.trim(), public: false, baseHash: manifestBaseHash }) });
  } catch { return status('origin unreachable', true); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { status('not signed in', true); banner(`Session expired. <a href="${apiBase || ''}/">Log in</a>, then try again.`); return; }
  if (r.status === 409 && d.conflict) { status('the doc list changed elsewhere — reloading', true); await loadList(); return; }
  if (!r.ok) { status(`duplicate failed: ${d.error || r.status}`, true); return; }
  await loadList();
  await loadDoc(d.slug);
  status(`duplicated as ${d.slug} — a private draft; change its state when it is ready`);
}

async function toggleHistory(btn) {
  const s = btn.getAttribute('data-history');
  const urlPath = btn.getAttribute('data-urlpath');
  const kind = btn.getAttribute('data-kind');
  const pane = $(`history-${s}`);
  if (!pane) return;
  if (!pane.hidden) { pane.hidden = true; return; }
  pane.hidden = false;
  pane.innerHTML = '<span class="mut">loading…</span>';
  // A kind:md doc has an editor-save history (what was typed), a generated history (the rendered
  // page) and the git log of its source; a kind:imported doc only has generated — its source IS
  // the artifact. Diff and Open need a markdown base, so they are offered for md only.
  const origins = kind === 'md' ? ['editor-save', 'generated'] : ['generated'];
  const sections = [];
  const canCompare = kind === 'md' && s === slug;
  const actions = (attrs) => canCompare
    ? `<button type="button" class="vbtn" data-act="diff" ${attrs}>Diff</button><button type="button" class="vbtn" data-act="open" ${attrs}>Open</button>` : '';
  for (const origin of origins) {
    let r;
    try { r = await api(`/api/docsite/versions?key=${encodeURIComponent(urlPath)}&origin=${origin}`); } catch { sections.push(`<div class="mut">${origin}: origin unreachable</div>`); continue; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { sections.push(`<div class="mut">${origin}: ${esc(d.error || r.status)}</div>`); continue; }
    if (!d.versions.length) { sections.push(`<div class="mut">${origin}: no versions yet</div>`); continue; }
    const rows = d.versions.slice(0, 20).map((v) => `<li>
        <span class="vtime" title="${esc(localTime(v.at))}">${esc(ago(v.at))}</span><span class="vbytes">${v.bytes}B</span>
        ${origin === 'editor-save' ? actions(`data-src="version" data-key="${esc(urlPath)}" data-origin="${origin}" data-id="${esc(v.id)}"`) : ''}
        <button type="button" class="restore" data-key="${esc(urlPath)}" data-origin="${origin}" data-id="${esc(v.id)}">Restore</button>
      </li>`).join('');
    sections.push(`<div class="vpool"><b>${origin}</b><ul>${rows}</ul></div>`);
  }
  if (kind === 'md') {
    let r;
    try { r = await api(`/api/docsite/git-log?slug=${encodeURIComponent(s)}`); } catch { r = null; }
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r) sections.push('<div class="mut">git: origin unreachable</div>');
    else if (!r.ok) sections.push(`<div class="mut">git: ${esc(d.error || r.status)}</div>`);
    else if (!d.available) sections.push(`<div class="mut">git: not available — ${esc(d.reason || 'unknown')}</div>`);
    else if (!d.commits.length) sections.push(`<div class="mut">git: no commits touch ${esc(d.path)}</div>`);
    else {
      const rows = d.commits.slice(0, 20).map((c) => `<li>
          <span class="vtime" title="${esc(localTime(c.at))} · ${esc(c.author)}">${esc(c.sha.slice(0, 7))} · ${esc(ago(c.at))}</span>
          ${actions(`data-src="git" data-sha="${esc(c.sha)}"`)}
          <span class="vsub" title="${esc(c.subject)}">${esc(c.subject)}</span>
        </li>`).join('');
      sections.push(`<div class="vpool"><b>git · ${esc(d.path)}</b><ul>${rows}</ul></div>`);
    }
  }
  pane.innerHTML = sections.join('');
  pane.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      const src = b.dataset.src;
      const label = src === 'git' ? `commit ${b.dataset.sha.slice(0, 7)}` : `snapshot ${b.dataset.id.slice(0, 19)}`;
      let r, d;
      try {
        r = await api(src === 'git'
          ? `/api/docsite/git-show?slug=${encodeURIComponent(s)}&sha=${encodeURIComponent(b.dataset.sha)}`
          : `/api/docsite/version?key=${encodeURIComponent(b.dataset.key)}&origin=${b.dataset.origin}&id=${encodeURIComponent(b.dataset.id)}`);
        d = await r.json().catch(() => ({}));
      } catch { b.disabled = false; return status('origin unreachable', true); }
      b.disabled = false;
      if (!r.ok) return status(`${label}: ${d.error || r.status}`, true);
      if (b.dataset.act === 'diff') { await openCompare(d.content, label); return; }
      setSourceExternal(d.content);
      setDirty(true);
      persistDraft();
      status(`${label} loaded into the editor — nothing written; save when ready`);
    });
  });
  pane.querySelectorAll('.restore').forEach((rbtn) => {
    rbtn.addEventListener('click', async () => {
      if (!window.confirm('Restore this version? The current content is saved to history first, so this is itself reversible.')) return;
      rbtn.disabled = true;
      status('restoring…');
      let r;
      try {
        r = await api('/api/docsite/restore', {
          method: 'POST',
          body: JSON.stringify({ key: rbtn.dataset.key, origin: rbtn.dataset.origin, id: rbtn.dataset.id }),
        });
      } catch { status('origin unreachable', true); rbtn.disabled = false; return; }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { status(`restore failed: ${d.error || r.status}`, true); rbtn.disabled = false; return; }
      status(`restored ✓${d.deployed ? ' — live' : ''}`);
      pane.hidden = true;
      if (s === slug) await loadDoc(s);
      await loadList();
    });
  });
}

async function loadList() {
  let r;
  try { r = await api('/api/docsite/list'); } catch {
    banner('Drafting origin unreachable — the editor is read-only until it answers. Nothing you type here reaches the site.');
    doclistState('Document list unavailable — the drafting origin did not answer.');
    gate('Drafting origin unreachable', (apiBase || 'this origin') + ' did not answer. The editor is read-only until it does; nothing typed here reaches the site.');
    return null;
  }
  if (r.status === 401) {
    banner(`Not signed in. <a href="${apiBase || ''}/">Log in at the panel</a>, then reload this page.`);
    doclistState('Not signed in — the document list is not public.');
    gate('Sign in to edit', 'The drafting origin answered 401. The document list is not public, so nothing is listed here rather than an empty list that would read as "no documents".');
    return null;
  }
  if (!r.ok) { banner(`Origin error ${r.status} — refusing to guess (${esc((await r.text()).slice(0, 200))})`); return null; }
  const d = await r.json();
  ungate();
  docsCache = d.docs;
  manifestBaseHash = d.manifestHash;
  renderDoclist();
  syncHeaderBadge();
  return docsCache;
}

async function loadDoc(s) {
  // Switching away from unsaved work: land it first; if it cannot land (a conflict is pending or
  // the save refused), ask rather than drop it.
  if (slug && dirty && !conflictPending) await save();
  if (slug && dirty && !window.confirm('This document has unsaved changes that could not be saved. Switch anyway and leave them in this browser\'s local draft?')) return;
  let r;
  try { r = await api(`/api/docsite/doc?slug=${encodeURIComponent(s)}`); } catch { status('load failed: origin unreachable', true); return; }
  if (!r.ok) { status(`load failed (${r.status})${r.status === 401 ? ' — sign in again' : ''}`, true); return; }
  const d = await r.json();
  slug = d.slug;
  baseHash = d.hash;
  serverMtime = d.mtime || null;
  els.source.value = d.content;
  els.source.disabled = false;
  closeConflict();
  setDirty(false);
  loadPreviewShell(slug);
  renderPreview();
  renderDoclist();
  syncHeaderBadge();
  const url = new URL(location.href);
  url.searchParams.set('doc', slug);
  history.replaceState(null, '', url);
  // A local draft that differs from the origin copy is offered, never silently applied or dropped.
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey()) || 'null');
    if (saved && saved.content !== d.content) {
      const age = saved.baseHash === d.hash ? 'unsaved local draft' : 'local draft from an OLDER origin version';
      banner(`Found an ${age} for this document. <button id="restoredraft" type="button">Restore it</button> <button id="dropdraft" type="button" class="ghost">Discard it</button>`);
      $('restoredraft').onclick = () => { setSourceExternal(saved.content); setDirty(true); banner(''); };
      $('dropdraft').onclick = () => { clearDraft(); banner(''); };
    } else banner('');
  } catch { banner(''); }
}

async function save() {
  clearTimeout(saveTimer);
  if (!slug || !dirty || saving) return;
  saving = true;
  status('saving…');
  let r;
  try {
    r = await api('/api/docsite/save', { method: 'POST', body: JSON.stringify({ slug, content: els.source.value, baseHash }) });
  } catch { saving = false; status('origin unreachable — draft kept locally, will retry', true); persistDraft(); saveTimer = setTimeout(save, 5000); return; }
  saving = false;
  if (r.status === 401) { status('not signed in', true); banner(`Session expired. <a href="${apiBase || ''}/">Log in</a>, then keep editing — your text is safe here.`); return; }
  const d = await r.json().catch(() => ({}));
  if (r.status === 409 && d.conflict) { await openConflict(d, 'save'); return; }
  if (r.status === 409 && d.locked) { status('another writer holds the lock — retrying shortly', true); saveTimer = setTimeout(save, 3000); return; }
  if (!r.ok) {
    status(`save failed: ${d.error || r.status}`, true);
    if (d.detail) banner(`<pre>${esc(d.detail)}</pre>`);
    if (d.newHash) baseHash = d.newHash; // the write itself succeeded; only the deploy after it failed
    return;
  }
  baseHash = d.newHash;
  serverMtime = new Date().toISOString();
  setDirty(false);
  clearDraft();
  status(d.unchanged ? 'no changes' : `saved ✓${d.deployed ? ' — live' : ''}`);
}

// ── THE CONFLICT PANEL: disk vs buffer, as a block diff with a choice ────────────────────────────
// Base is the disk copy, candidate is the buffer. Reached from a 409 on save and from the watcher
// below when the file moves under a dirty buffer. Nothing here writes except through save().
let conflictPairs = null;
let conflictDisk = null; // { currentHash, currentContent, currentMtime }

function closeConflict() {
  els.conflict.hidden = true;
  els.conflictlist.innerHTML = '';
  conflictPairs = null;
  conflictDisk = null;
  conflictPending = false;
}

async function openConflict(d, why) {
  conflictDisk = { currentHash: d.currentHash, currentContent: d.currentContent ?? '', currentMtime: d.currentMtime || null };
  conflictPending = true;
  clearTimeout(saveTimer);
  let r, dd;
  try {
    r = await api('/api/docsite/diff', { method: 'POST', body: JSON.stringify({ slug, text: els.source.value }) });
    dd = await r.json().catch(() => ({}));
  } catch { r = null; }
  if (!r || !r.ok) {
    els.conflictlist.innerHTML = `<div class="dnote">diff unavailable (${esc((dd && dd.error) || 'origin did not answer')}) — Keep mine / Keep disk still work</div>`;
    conflictPairs = null;
  } else {
    conflictPairs = renderDiffRows(els.conflictlist, dd, { keepDeleted: true });
  }
  const diskWhen = conflictDisk.currentMtime ? `${ago(conflictDisk.currentMtime)} (${localTime(conflictDisk.currentMtime)})` : 'unknown time';
  const mineWhen = lastEditAt ? ago(lastEditAt) : 'not since load';
  const changed = dd && dd.pairs ? dd.pairs.filter((p) => p.state !== 'MATCHED' && p.state !== 'WHITESPACE_ONLY').length : '?';
  els.conflictsum.textContent = `disk written ${diskWhen} · your last edit ${mineWhen} · ${changed} block(s) differ`;
  els.conflict.hidden = false;
  if (why === 'watch') els.conflict.dataset.watch = ''; else delete els.conflict.dataset.watch;
  status(why === 'watch' ? 'the file changed on disk while you were editing' : 'conflict — the disk copy moved since you loaded it', true);
}

const keepMine = () => {
  if (!conflictDisk) return;
  baseHash = conflictDisk.currentHash;
  closeConflict();
  setDirty(true);
  status('keeping the buffer — saving over the disk copy (its previous content is in History)');
  saveTimer = setTimeout(save, 200);
};
const keepDisk = () => {
  if (!conflictDisk) return;
  baseHash = conflictDisk.currentHash;
  serverMtime = conflictDisk.currentMtime;
  setSourceExternal(conflictDisk.currentContent);
  closeConflict();
  setDirty(false);
  clearDraft();
  status('loaded the disk copy — your buffer was discarded (a local draft copy stays in this browser until the next save)');
};
const keepNewer = () => {
  if (!conflictDisk) return;
  const diskAt = Date.parse(conflictDisk.currentMtime || '');
  if (!Number.isFinite(diskAt)) { status('disk copy has no readable mtime — choose Keep mine or Keep disk', true); return; }
  if (!lastEditAt) { keepDisk(); return; }
  if (diskAt > lastEditAt) { keepDisk(); status(`kept disk — newer by ${Math.round((diskAt - lastEditAt) / 1000)}s`); }
  else { keepMine(); status(`kept buffer — newer by ${Math.round((lastEditAt - diskAt) / 1000)}s`); }
};
const mergeConflict = () => {
  if (!conflictDisk) return;
  if (!conflictPairs) { status('no diff to merge from — choose Keep mine or Keep disk', true); return; }
  const merged = mergedFrom(els.conflictlist, conflictPairs);
  baseHash = conflictDisk.currentHash;
  setSourceExternal(merged);
  closeConflict();
  setDirty(true);
  persistDraft();
  status('merged — saving');
  saveTimer = setTimeout(save, 200);
};
els.keepnewer.addEventListener('click', keepNewer);
els.takemine.addEventListener('click', keepMine);
els.takeserver.addEventListener('click', keepDisk);
els.conflictmerge.addEventListener('click', mergeConflict);
els.conflictlater.addEventListener('click', () => { els.conflict.hidden = true; status('conflict deferred — autosave is off until you resolve it (⌘S re-checks)'); });

// ── THE WATCHER: the file on disk is edited by other sessions and other tools. Poll its hash so a
// change surfaces within seconds, not on the next autosave's 409. A clean buffer follows the disk
// silently and says so; a dirty one gets the conflict panel.
const WATCH_MS = 8000;
async function watch() {
  if (!slug || saving || document.hidden || !els.conflict.hidden || conflictPending) return;
  let r, d;
  try { r = await api(`/api/docsite/head?slug=${encodeURIComponent(slug)}`); d = await r.json().catch(() => ({})); } catch { return; }
  if (!r.ok || !d.hash || d.hash === baseHash) return;
  if (!dirty) {
    const r2 = await api(`/api/docsite/doc?slug=${encodeURIComponent(slug)}`).catch(() => null);
    if (!r2 || !r2.ok) return;
    const doc = await r2.json();
    if (doc.slug !== slug) return;
    baseHash = doc.hash;
    serverMtime = doc.mtime || null;
    setSourceExternal(doc.content);
    status(`reloaded — changed on disk ${ago(doc.mtime)} (${localTime(doc.mtime)})`);
    return;
  }
  const r2 = await api(`/api/docsite/doc?slug=${encodeURIComponent(slug)}`).catch(() => null);
  if (!r2 || !r2.ok) return;
  const doc = await r2.json();
  if (doc.slug !== slug) return;
  await openConflict({ currentHash: doc.hash, currentContent: doc.content, currentMtime: doc.mtime }, 'watch');
}
setInterval(watch, WATCH_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) watch(); });

async function syncCandidates() {
  status('checking docsite/imported/ for new files…');
  let r;
  try { r = await api('/api/docsite/candidates'); } catch { status('origin unreachable', true); return; }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { status(`sync failed: ${d.error || r.status}`, true); return; }
  if (!d.candidates.length) { status('nothing new in docsite/imported/'); return; }
  const rows = d.candidates.map((c) => `<li>${esc(c.file)} → <code>${esc(c.suggestedSlug)}</code> "${esc(c.suggestedTitle)}"</li>`).join('');
  banner(`<b>${d.candidates.length} new file${d.candidates.length === 1 ? '' : 's'} found in docsite/imported/:</b>
    <ul>${rows}</ul>
    <button type="button" id="import-all">Import all as hidden</button>
    <button type="button" id="import-cancel" class="ghost">Cancel</button>`);
  $('import-all').onclick = async () => {
    $('import-all').disabled = true;
    status('importing…');
    for (const c of d.candidates) {
      let rr;
      try {
        rr = await api('/api/docsite/import', {
          method: 'POST',
          body: JSON.stringify({ file: c.file, slug: c.suggestedSlug, title: c.suggestedTitle, public: false, baseHash: manifestBaseHash }),
        });
      } catch { status('origin unreachable mid-import', true); return; }
      const rd = await rr.json().catch(() => ({}));
      if (!rr.ok) { status(`import of ${c.file} failed: ${rd.error || rr.status}`, true); if (rd.detail) banner(`<pre>${esc(rd.detail)}</pre>`); return; }
      await loadList(); // refreshes manifestBaseHash before the next import needs it
    }
    status('imported ✓ — live, hidden');
    banner('');
  };
  $('import-cancel').onclick = () => banner('');
}

async function purgeCache() {
  if (!window.confirm('Purge the entire CDN edge cache for the docsite? Only needed if a deploy that already looks correct on the *.pages.dev URL is still serving stale content on the real domain.')) return;
  els.purge.disabled = true;
  status('purging cache…');
  let r;
  try { r = await api('/api/docsite/purge-cache', { method: 'POST', body: '{}' }); } catch { status('origin unreachable', true); els.purge.disabled = false; return; }
  const d = await r.json().catch(() => ({}));
  els.purge.disabled = false;
  if (!r.ok) { status(`purge failed: ${d.error || r.status}`, true); if (d.detail) banner(`<pre>${esc(d.detail)}</pre>`); return; }
  status(`cache purged ✓ (${d.output || ''})`);
}

// Selection wrappers for the few shortcuts worth having in a Markdown editor.
const wrap = (before, after = before) => {
  const { selectionStart: a, selectionEnd: b, value } = els.source;
  els.source.value = value.slice(0, a) + before + value.slice(a, b) + after + value.slice(b);
  els.source.setSelectionRange(a + before.length, b + before.length);
  onInput();
};

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  if (e.key === 's') { e.preventDefault(); save(); }
  else if (e.key === 'b') { e.preventDefault(); wrap('**'); }
  else if (e.key === 'i') { e.preventDefault(); wrap('*'); }
  else if (e.key === 'u') { e.preventDefault(); wrap('__'); }
  else if (e.key === 'k') { e.preventDefault(); wrap('[', '](https://)'); }
});

// ---- formatting toolbar ---------------------------------------------------------------------
// Every mark inserted here is one lib/render-markdown.mjs's inline() actually renders (bold/
// italic/underline/strike/sup/sub, plus the [^key] reference syntax lib/docsite-md.mjs adds) —
// "what you see is what publishes" only holds if the toolbar never offers syntax the shared
// parser can't display.

const INLINE_WRAP = {
  bold: ['**', '**'], italic: ['*', '*'], underline: ['__', '__'],
  strike: ['~~', '~~'], sup: ['^', '^'], sub: ['~', '~'],
};

// Quote/list marks are line PREFIXES, not span wraps — they act on every line the selection
// touches (or just the current line, if nothing is selected), using the textarea's own line
// boundaries rather than the exact selection offsets wrap() uses for inline marks.
function prefixLines(prefix) {
  const { selectionStart: a, selectionEnd: b, value } = els.source;
  const lineStart = value.lastIndexOf('\n', a - 1) + 1;
  let lineEnd = value.indexOf('\n', b);
  if (lineEnd === -1) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const next = block.split('\n').map((l) => `${prefix}${l}`).join('\n');
  els.source.value = value.slice(0, lineStart) + next + value.slice(lineEnd);
  els.source.setSelectionRange(a + prefix.length, b + (next.length - block.length));
  onInput();
}

// Inserts a block (code fence, table skeleton) on its own line(s) at the cursor, using the
// current selection as the body if there is one, else a placeholder the author types over.
function insertBlock(before, placeholder, after) {
  const { selectionStart: a, selectionEnd: b, value } = els.source;
  const body = a === b ? placeholder : value.slice(a, b);
  const pre = (a === 0 || value[a - 1] === '\n') ? '' : '\n';
  const insert = `${pre}${before}${body}${after}`;
  els.source.value = value.slice(0, a) + insert + value.slice(b);
  const selStart = a + pre.length + before.length;
  els.source.setSelectionRange(selStart, selStart + body.length);
  onInput();
}

// Scans outward from the cursor's line while adjacent lines still look like `| ... |` rows, so
// "add row"/"add column" act on whichever table the cursor is actually inside — never the first
// table in the document, never a guess.
function findTableBlock() {
  const { selectionStart: a, value } = els.source;
  const lines = value.split('\n');
  let pos = 0, cursorLine = 0;
  for (; cursorLine < lines.length - 1; cursorLine++) {
    const lineLen = lines[cursorLine].length;
    if (pos + lineLen >= a) break;
    pos += lineLen + 1;
  }
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l || '');
  if (!isRow(lines[cursorLine])) return null;
  let start = cursorLine, end = cursorLine;
  while (start > 0 && isRow(lines[start - 1])) start--;
  while (end < lines.length - 1 && isRow(lines[end + 1])) end++;
  const cols = Math.max(1, (lines[start].match(/\|/g) || []).length - 1);
  return { lines, start, end, cursorLine, cols };
}

function tableAddRow() {
  const t = findTableBlock();
  if (!t) { status('place the cursor inside a table first', true); return; }
  const newRow = `| ${Array.from({ length: t.cols }, () => ' ').join(' | ')} |`;
  // Never insert above the separator row (index start+1): a row "added" there would land between
  // the header and its own separator, which is not a valid table anymore.
  const insertAfter = Math.max(t.cursorLine, t.start + 1);
  t.lines.splice(insertAfter + 1, 0, newRow);
  els.source.value = t.lines.join('\n');
  onInput();
}

function tableAddCol() {
  const t = findTableBlock();
  if (!t) { status('place the cursor inside a table first', true); return; }
  for (let i = t.start; i <= t.end; i++) {
    const isSeparator = i === t.start + 1;
    t.lines[i] = t.lines[i].replace(/\s*\|\s*$/, isSeparator ? ' --- |' : '  |');
  }
  els.source.value = t.lines.join('\n');
  onInput();
}

// Inserts a citation marker at the cursor and its definition skeleton at the end of the document
// — "auto-renumbered" (lib/docsite-md.mjs numbers by citation ORDER, not by this key), so the key
// only has to be locally unique, never renumbered by hand.
function insertReference() {
  const used = new Set([...els.source.value.matchAll(/\[\^ref(\d+)\]/g)].map((m) => +m[1]));
  let n = 1;
  while (used.has(n)) n++;
  const key = `ref${n}`;
  const { selectionStart: a, selectionEnd: b, value } = els.source;
  const citeMark = `[^${key}]`;
  els.source.value = value.slice(0, a) + citeMark + value.slice(b);
  els.source.value += `\n\n[^${key}]: Title | https://example.com | Description`;
  const citeEnd = a + citeMark.length;
  els.source.setSelectionRange(citeEnd, citeEnd);
  els.source.focus();
  onInput();
  status(`inserted [^${key}] — its definition is at the bottom of the document, ready to fill in`);
}

document.getElementById('fmtbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-fmt]');
  if (!btn) return;
  const fmt = btn.dataset.fmt;
  if (INLINE_WRAP[fmt]) { wrap(...INLINE_WRAP[fmt]); return; }
  if (fmt === 'link') wrap('[', '](https://)');
  else if (fmt === 'quote') prefixLines('> ');
  else if (fmt === 'ul') prefixLines('- ');
  else if (fmt === 'ol') prefixLines('1. ');
  else if (fmt === 'code') insertBlock('```\n', 'code here', '\n```');
  else if (fmt === 'reference') insertReference();
  else if (fmt === 'table') insertBlock('', '| Header 1 | Header 2 |\n| --- | --- |\n| Cell | Cell |', '');
  else if (fmt === 'tablerow') tableAddRow();
  else if (fmt === 'tablecol') tableAddCol();
  els.source.focus();
});

els.source.addEventListener('input', onInput);
els.sync.addEventListener('click', syncCandidates);
els.purge.addEventListener('click', purgeCache);
// The autosave debounce means a closed tab can still be carrying an unsaved 0-3s tail.
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

(async () => {
  const list = await loadList();
  if (!list || !list.length) { status('no documents'); return; }
  const wanted = new URL(location.href).searchParams.get('doc');
  const editable = list.filter((d) => d.kind === 'md');
  const first = editable.find((d) => d.slug === wanted) || editable[0];
  if (first) await loadDoc(first.slug);
  else status('no editable documents — Sync to import an HTML snapshot, or pick one from the list');
})();

// ── IMPORT A MARKDOWN FILE, SEE THE DIFF, THEN MERGE ────────────────────────────────────────────
// Nothing here writes to disk. The server's /api/docsite/diff is read-only, and merging only fills
// the editor buffer and marks it dirty — the existing save path, with its baseHash check, stays the
// single thing that reaches the origin. That separation is the point: an import that wrote directly
// would be a blind overwrite of whatever the document had become since the file was exported.
let diffPairs = null;

const diffText = (p) => {
  if (p.state === 'EDITED' && Array.isArray(p.words)) {
    return p.words.map(([op, t]) => (op === -1 ? `<del>${esc(t)}</del>` : op === 1 ? `<ins>${esc(t)}</ins>` : esc(t))).join('');
  }
  if (p.state === 'DELETED') return `<del>${esc(p.old || '')}</del>`;
  if (p.state === 'ADDED') return `<ins>${esc(p.new || '')}</ins>`;
  return esc(p.new ?? p.old ?? '');
};

function renderDiff(d, label = 'the uploaded file') {
  diffPairs = renderDiffRows(els.difflist, d);
  const changed = d.pairs.filter((p) => p.state !== 'MATCHED');
  els.diffsum.textContent = d.unchanged
    ? `${label} is identical to the current source — nothing to merge`
    : `${label}: ${changed.length} changed block(s) of ${d.pairs.length}: `
      + Object.entries(d.counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ');
  els.diffpane.hidden = false;
}

// keepDeleted: start DELETED rows unticked, so the default merge is the UNION of both sides. An
// import wants the file's deletions honoured; a conflict wants nothing dropped until someone says so.
function renderDiffRows(listEl, d, { keepDeleted = false } = {}) {
  listEl.innerHTML = d.pairs.map((p, i) => {
    // MATCHED blocks are shown but not offered: there is nothing to choose. Everything else is
    // pre-selected, because the operator uploaded the file in order to take it — but a
    // pre-selection is not a decision, so each row stays individually revocable.
    const choose = p.state !== 'MATCHED' && p.state !== 'WHITESPACE_ONLY';
    const ticked = choose && !(keepDeleted && p.state === 'DELETED');
    const note = p.capped ? '<div class="dnote">word-level diff skipped: block over the token cap, shown whole</div>'
      : (p.state === 'UNRESOLVED' || p.state === 'AMBIGUOUS')
        ? '<div class="dnote">the matcher could not pair this confidently — check it by eye before taking it</div>' : '';
    return `<div class="drow" data-s="${esc(p.state)}">`
      + `<input type="checkbox" data-i="${i}"${ticked ? ' checked' : ''}${choose ? '' : ' disabled'} aria-label="include this block">`
      + `<span class="dstate">${esc(p.state.toLowerCase())}</span>`
      + `<span class="dtext">${diffText(p)}</span>${note}</div>`;
  }).join('');
  return d.pairs;
}

// The merged document, assembled in the order the server returned (document order, by newIdx).
// A rejected change keeps the BASE text; a rejected ADDED block contributes nothing; a rejected
// DELETED block is kept, which is what "do not take this deletion" has to mean.
const mergedSource = () => mergedFrom(els.difflist, diffPairs);
function mergedFrom(listEl, pairs) {
  const picked = new Set([...listEl.querySelectorAll('input[data-i]')]
    .filter((c) => c.checked).map((c) => Number(c.dataset.i)));
  const out = [];
  pairs.forEach((p, i) => {
    const take = picked.has(i) || p.state === 'MATCHED' || p.state === 'WHITESPACE_ONLY';
    if (p.state === 'ADDED') { if (take) out.push(p.new); return; }
    if (p.state === 'DELETED') { if (!take) out.push(p.old); return; }
    out.push(take ? (p.new ?? p.old) : (p.old ?? p.new));
  });
  return out.filter((b) => b != null && b !== '').join('\n\n') + '\n';
}

const closeDiff = () => { els.diffpane.hidden = true; els.difflist.innerHTML = ''; diffPairs = null; els.importfile.value = ''; };

els.importbtn.addEventListener('click', () => { if (!slug) return status('select a document first', true); els.importfile.click(); });

els.importfile.addEventListener('change', async () => {
  const f = els.importfile.files && els.importfile.files[0];
  if (!f) return;
  let text;
  try { text = await f.text(); } catch (e) { return status(`could not read ${f.name}: ${e.message}`, true); }
  await openCompare(text, f.name);
});

// Diff any candidate text against the disk copy and offer it for merge: an uploaded file, a
// snapshot from History, or a git commit. Read-only until Merge fills the buffer.
async function openCompare(text, label) {
  if (!slug) return status('select a document first', true);
  let r, d;
  try {
    r = await api('/api/docsite/diff', { method: 'POST', body: JSON.stringify({ slug, text }) });
    d = await r.json().catch(() => ({}));
  } catch (e) {
    // A failed request is not an empty diff, and must never render as "no changes".
    return status(`diff failed: ${e.message}`, true);
  }
  if (!r.ok) return status(`diff refused: ${d.error || r.status}`, true);
  status(`${label}: ${d.unchanged ? 'identical to the current source' : 'review the changes below'}`);
  renderDiff(d, label);
}

els.diffcancel.addEventListener('click', closeDiff);

els.difftakeall.addEventListener('click', () => {
  [...els.difflist.querySelectorAll('input[data-i]:not(:disabled)')].forEach((c) => { c.checked = true; });
  els.diffmerge.click();
});

els.diffmerge.addEventListener('click', () => {
  if (!diffPairs) return;
  const merged = mergedSource();
  // setSourceExternal replaces the text and re-renders the preview; it does NOT mark the buffer
  // dirty — every existing caller pairs it with its own setDirty, because "take server version"
  // wants clean and "restore draft" wants dirty. A merge is unmistakably dirty: leaving it clean
  // would show no unsaved marker and disable the autosave the operator is relying on, so the merge
  // would sit in the buffer looking like it had already landed.
  setSourceExternal(merged);
  setDirty(true);
  persistDraft();
  closeDiff();
  status('merged into the editor — review it, then Save. Nothing has been written yet.');
});
