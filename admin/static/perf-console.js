// /perf/ scanner console — the client half of admin/routes/scanners.mjs.
//
// Loaded as a classic script BEFORE the inline panel script, like comments.js: it calls the inline
// script's globals (cwPost, esc, perfGroupFor, lastState, curView) only at run time, never at load.
//
// One route per scanner: /perf/<id>/. The overview (/perf/) is the page as it was; a scanner route
// hides it and shows that scanner alone. The panel router reads the id through pcUrl() so a reload
// or a pasted link lands on the same scanner.

const PC = { cat: null, catErr: null, repos: null, prov: new Map(), cfg: null, jobs: new Map(), filter: '' };
const pcEl = (id) => document.getElementById(id);
const pcEsc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const PC_ID_RE = /^\/perf\/([a-z0-9][a-z0-9._-]{0,63})\/?$/;

/** The scanner the URL names, or null for the overview. */
function pcScannerFromUrl() { const m = location.pathname.match(PC_ID_RE); return m ? m[1] : null; }
let pcCurrent = pcScannerFromUrl();
/** The panel router asks this for the perf view's URL. It reads the address bar, not the last
 *  scanner shown, so arriving from another tab opens the overview and a pasted /perf/<id>/ keeps it. */
function pcUrl() { pcCurrent = pcScannerFromUrl(); return pcCurrent ? `/perf/${pcCurrent}/` : '/perf/'; }

async function pcJson(url) {
  const r = await fetch(url);
  let j = null;
  try { j = await r.json(); } catch { /* reported below */ }
  if (!r.ok || !j || j.ok === false) throw new Error((j && j.error) || `HTTP ${r.status}`);
  return j;
}

/** Called by loadPerf() every time the view opens. */
async function pcLoad() {
  try { PC.cat = await pcJson('/api/scanners'); PC.catErr = null; }
  catch (e) { PC.cat = null; PC.catErr = e.message; }
  pcRenderNav();
  pcRenderOutside();
  pcLoadRepos();
  pcScanPathLoad();
  pcRoute();
}

function pcRoute() {
  pcCurrent = pcScannerFromUrl();
  const detail = pcEl('perf-scanner');
  const overview = document.querySelectorAll('#view-perf > section[data-pc-overview]');
  if (!detail) return;
  const known = pcCurrent && PC.cat && PC.cat.scanners.some((s) => s.id === pcCurrent);
  detail.hidden = !known;
  overview.forEach((s) => { s.hidden = !!known; });
  document.querySelectorAll('#perf-subnav .pc-tab').forEach((b) => b.classList.toggle('on', (b.dataset.pcId || '') === (known ? pcCurrent : '')));
  if (pcCurrent && PC.cat && !known) {
    pcEl('perf-subnav-note').textContent = `no scanner "${pcCurrent}" — showing every scanner instead`;
  } else if (pcEl('perf-subnav-note')) pcEl('perf-subnav-note').textContent = '';
  if (known) pcRenderScanner(pcCurrent);
}

function pcGo(id) {
  const u = id ? `/perf/${id}/` : '/perf/';
  if (location.pathname !== u) history.pushState(null, '', u);
  pcRoute();
}

// ── tabs: one per scanner, grouped the way the check table is ────────────────────────────────
function pcGroup(id) {
  try { return perfGroupFor(id, lastState && lastState.scannerRegistry); } catch { return 'other'; }
}
function pcRenderNav() {
  const nav = pcEl('perf-subnav');
  if (!nav) return;
  if (!PC.cat) { nav.innerHTML = `<span class="mut">scanner list unavailable — ${pcEsc(PC.catErr || 'unknown error')}</span>`; return; }
  const by = new Map();
  for (const s of PC.cat.scanners) { const g = pcGroup(s.id); if (!by.has(g)) by.set(g, []); by.get(g).push(s); }
  const label = (g) => (typeof PERF_SECTION_LABEL === 'object' && PERF_SECTION_LABEL[g]) || g;
  nav.innerHTML = `<button type="button" class="pc-tab" data-pc-id="">All scanners <span class="mut">${PC.cat.scanners.length}</span></button>`
    + [...by.entries()].map(([g, list]) => `<div class="pc-grp"><span class="pc-grp-l">${pcEsc(label(g))}</span>`
      + list.map((s) => `<button type="button" class="pc-tab" data-pc-id="${pcEsc(s.id)}" title="${pcEsc(s.description || '')}">${pcEsc(s.id)}</button>`).join('')
      + '</div>').join('');
}

// ── one scanner ───────────────────────────────────────────────────────────────────────────────
function pcKind(kind, level, ladder) {
  if (!kind) return '<span class="pill unk">unknown</span>';
  if (kind === 'n/a') return '<span class="pill na">n/a</span>';
  const lv = level ? `${pcEsc(level.label)} <span class="mut">${level.rank}/${level.of}</span>` : '';
  return `<span class="pill ${kind === 'graded' ? 'live' : 'part'}">${pcEsc(kind)}</span> ${lv}`
    + (ladder && ladder.length ? `<div class="mut t-meta">levels: ${ladder.map(pcEsc).join(' → ')}</div>` : '');
}

function pcTuningRow(id) {
  const t = typeof perfData === 'object' && perfData && perfData.tuning;
  return t && Array.isArray(t.scanners) ? t.scanners.find((s) => s.id === id) : null;
}

function pcRenderScanner(id) {
  const s = PC.cat.scanners.find((x) => x.id === id);
  const row = pcTuningRow(id);
  const p = s.perf || {};
  const ladder = (l) => (Array.isArray(l) ? l.map((e) => (typeof e === 'object' ? `<li><b>${pcEsc(e.label)}</b> — ${pcEsc(e.note || '')}</li>` : `<li><b>${pcEsc(e)}</b></li>`)).join('') : '');
  const repoRows = (PC.repos && PC.repos.repos || []).filter((r) => r.overridden);
  pcEl('perf-scanner').innerHTML = `
    <div class="hd"><h2>${pcEsc(s.id)}</h2><span class="mut hd-note">${pcEsc((s.groups || []).join(' · '))}</span>
      <button type="button" class="pc-back" data-pc-id="">← all scanners</button></div>
    <p class="pc-desc">${pcEsc(s.description || 'no description is declared for this check')}</p>
    <div class="pc-kv">
      <div><span class="mut">cost</span> <span class="pill">${pcEsc(p.cost || 'unknown')}</span></div>
      <div><span class="mut">runs from depth</span> <b>${row && row.minDepth != null ? pcEsc(row.minDepth) : pcEsc(p.minDepth ?? '—')}</b></div>
      <div><span class="mut">depth</span> ${pcKind(row ? row.depthKind : s.kinds && s.kinds.depth, row && row.depthLevel, row && row.depthLadder)}</div>
      <div><span class="mut">intensity</span> ${pcKind(row ? row.intensityKind : s.kinds && s.kinds.intensity, row && row.intensityLevel, row && row.intensityLadder)}</div>
      <div><span class="mut">at the fleet settings</span> ${row ? (row.enabled === true ? '<span class="pill live">runs</span>' : `<span class="pill na">does not run</span> <span class="mut">${pcEsc(row.reason || '')}</span>`) : '<span class="mut">—</span>'}</div>
    </div>
    ${p.depthLadder ? `<h3>Its own depth levels</h3><ol class="pc-ladder">${ladder(p.depthLadder)}</ol>` : ''}
    ${p.intensityLadder ? `<h3>Its own intensity levels</h3><ol class="pc-ladder">${ladder(p.intensityLadder)}</ol>` : ''}
    ${repoRows.length ? `<h3>Repositories with their own depth</h3><div class="mut">${repoRows.map((r) => `${pcEsc(r.name)}: depth ${pcEsc(r.depth.value)}, intensity ${pcEsc(r.intensity.value)}`).join(' · ')}</div>` : ''}
    <h3>Installed from</h3>
    <div id="pc-prov" class="pc-prov"><span class="mut">reading this machine…</span></div>
    <h3>Configuration</h3>
    <div class="row-actions"><button type="button" class="pri" data-pc-config="${pcEsc(s.id)}">edit ${pcEsc(s.id)} as JSON</button>
      <span class="mut">the check's commands and its tuning entry, as one document — manifests/security-baseline.json and monitor/perf-profiles.json</span></div>`;
  pcLoadProv(id);
}

async function pcLoadProv(id) {
  const box = pcEl('pc-prov');
  let p;
  try { p = await pcJson(`/api/scanners/provenance?id=${encodeURIComponent(id)}`); }
  catch (e) { if (box) box.innerHTML = `<span class="pk-err">provenance UNKNOWN — ${pcEsc(e.message)}</span>`; return; }
  PC.prov.set(id, p);
  if (pcCurrent !== id || !box) return;
  const actBtns = (name, acts) => (acts || []).map((a) => {
    const argv = a.argv.join(' ');
    return `<button type="button" class="pc-act${a.verb === 'uninstall' ? ' pc-danger' : ''}" data-pc-act="${pcEsc(a.verb)}" data-pc-tool="${pcEsc(name)}"`
      + `${p.canAct ? '' : ' disabled'} title="${pcEsc(p.canAct ? argv : `operator port only — ${argv}`)}">${pcEsc(a.verb)}${a.manager ? ` <span class="mut">${pcEsc(a.manager)}</span>` : ''}</button>`;
  }).join(' ');
  const ver = (v) => (!v ? '' : v.state === 'present' ? (v.version ? pcEsc(v.version) : `<span class="mut">${pcEsc(v.reason || 'unversioned')}</span>`) : `<span class="mut">${pcEsc(v.reason || v.state)}</span>`);
  const rows = [];
  for (const t of p.tools) {
    rows.push(`<tr><td><code>${pcEsc(t.tool)}</code></td>`
      + `<td>${t.present ? `<span class="pill live">${pcEsc(t.manager)}</span>${t.pkg ? ` <span class="mut">${pcEsc(t.pkg)}</span>` : ''}` : '<span class="pill na">not installed</span>'}</td>`
      + `<td class="cell-wrap">${t.present ? `<code>${pcEsc(t.path)}</code>${t.realPath && t.realPath !== t.path ? `<div class="mut t-meta">→ ${pcEsc(t.realPath)}</div>` : ''}` : '<span class="mut">—</span>'}</td>`
      + `<td>${ver(t.version)}</td>`
      + `<td class="cell-wrap">${actBtns(t.tool, t.actions) || `<span class="mut">${pcEsc(t.noActionsWhy || (t.catalog ? 'no package manager in the catalogue is on PATH' : 'not in the install catalogue'))}</span>`}`
      + `${t.catalog && t.catalog.url ? `<div class="mut t-meta"><a href="${pcEsc(t.catalog.url)}" target="_blank" rel="noopener">install docs</a>${t.catalog.requiresAccount ? ` · needs an account with ${pcEsc(t.catalog.requiresAccount)}` : ''}</div>` : ''}</td></tr>`);
  }
  for (const i of p.images) {
    rows.push(`<tr><td><code>${pcEsc(i.image)}</code></td><td><span class="pill ${i.present ? 'live' : (i.present === false ? 'na' : 'unk')}">docker · ${pcEsc(i.state)}</span></td>`
      + `<td class="cell-wrap">${i.repoDigests && i.repoDigests.length ? i.repoDigests.map((d) => `<code>${pcEsc(d)}</code>`).join('<br>') : `<span class="mut">${pcEsc(i.reason || '—')}</span>`}</td>`
      + `<td>${i.created ? pcEsc(String(i.created).slice(0, 10)) : ''}</td><td>${actBtns(i.image, i.actions)}</td></tr>`);
  }
  for (const n of p.npx) rows.push(`<tr><td><code>${pcEsc(n.spec)}</code></td><td><span class="pill part">npx</span></td><td class="mut cell-wrap" colspan="3">${pcEsc(n.note)}</td></tr>`);
  box.innerHTML = rows.length
    ? `<div class="tw"><table><thead><tr><th>tool</th><th>manager</th><th>path</th><th>version</th><th>actions</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
      + (p.canAct ? '' : '<div class="foot">Install, uninstall and reinstall run only from the operator port on this machine; through the tunnel they would be remote code execution.</div>')
      + '<div id="pc-job"></div>'
    : '<span class="mut">this lane declares no tool, image or npx package — it is commitwork\'s own code</span>';
}

// Two clicks for an uninstall: the first arms it, the second runs it. Never a confirm() dialog.
async function pcAction(btn) {
  const verb = btn.dataset.pcAct; const tool = btn.dataset.pcTool;
  if (verb === 'uninstall' && btn.dataset.armed !== '1') {
    btn.dataset.armed = '1'; btn.textContent = `confirm uninstall ${tool}`;
    setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = 'uninstall'; } }, 6000);
    return;
  }
  btn.disabled = true;
  const out = pcEl('pc-job');
  let r; let j;
  try { r = await cwPost('/api/scanners/action', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: pcCurrent, tool, verb }) }); j = await r.json(); }
  catch (e) { btn.disabled = false; if (out) out.innerHTML = `<div class="pk-err">could not reach the panel — nothing ran (${pcEsc(e.message)})</div>`; return; }
  if (!r.ok || !j.ok) { btn.disabled = false; if (out) out.innerHTML = `<div class="pk-err">refused — ${pcEsc(j && j.error)}</div>`; return; }
  pcPollJob(j.job.id, pcCurrent);
}

async function pcPollJob(jid, scanner) {
  const out = pcEl('pc-job');
  let j;
  try { j = await pcJson(`/api/scanners/action?job=${encodeURIComponent(jid)}`); }
  catch (e) { if (out) out.innerHTML = `<div class="pk-err">job ${pcEsc(jid)} status UNKNOWN — ${pcEsc(e.message)}</div>`; return; }
  const job = j.job;
  if (out && pcCurrent === scanner) {
    const tone = job.state === 'done' ? 'live' : job.state === 'failed' ? 'crit' : 'part';
    out.innerHTML = `<div class="gap-top"><span class="pill ${tone}">${pcEsc(job.verb)} ${pcEsc(job.tool)} · ${pcEsc(job.state)}</span> <span class="mut">${pcEsc(job.id)}</span></div><pre class="pc-log">${pcEsc(j.log || '(no output yet)')}</pre>`;
  }
  if (job.state === 'running') { setTimeout(() => pcPollJob(jid, scanner), 1500); return; }
  if (pcCurrent === scanner) pcLoadProv(scanner);
}

// ── the JSON editor: white, centred in the column ──────────────────────────────────────────────
async function pcOpenConfig(id) {
  let c;
  try { c = await pcJson(`/api/scanners/config?id=${encodeURIComponent(id)}`); }
  catch (e) { pcModal(id, null, `could not read the configuration — ${e.message}`); return; }
  PC.cfg = c;
  pcModal(id, c);
}

function pcModal(id, c, error) {
  pcCloseModal();
  const back = document.createElement('div');
  back.className = 'pc-modal-back';
  back.id = 'pc-modal';
  back.innerHTML = `<div class="pc-modal" role="dialog" aria-modal="true" aria-labelledby="pc-modal-t">
    <div class="pc-modal-h"><b id="pc-modal-t">${pcEsc(id)}</b> <span class="pc-modal-files">${c ? c.files.map(pcEsc).join(' · ') : ''}</span></div>
    ${c ? `<textarea id="pc-modal-ta" class="pc-modal-ta" spellcheck="false" aria-label="${pcEsc(id)} configuration as JSON">${pcEsc(c.text)}</textarea>` : ''}
    <div id="pc-modal-msg" class="pc-modal-msg">${error ? pcEsc(error) : (c && !c.canWrite ? 'read-only here: saving runs only from the operator port, because these commands run on every sweep' : 'check.id cannot change; perf needs a cost; a depth ladder must be read by the commands')}</div>
    <div class="pc-modal-f"><button type="button" id="pc-modal-cancel">close</button>
      ${c && c.canWrite ? '<button type="button" id="pc-modal-save" class="pc-modal-save">save</button>' : ''}</div>
  </div>`;
  document.body.appendChild(back);
  const ta = pcEl('pc-modal-ta');
  (ta || pcEl('pc-modal-cancel')).focus();
}
function pcCloseModal() { const m = pcEl('pc-modal'); if (m) m.remove(); }

async function pcSaveConfig() {
  const msg = pcEl('pc-modal-msg'); const ta = pcEl('pc-modal-ta'); const c = PC.cfg;
  if (!ta || !c) return;
  try { JSON.parse(ta.value); } catch (e) { msg.textContent = `not valid JSON — nothing was sent: ${e.message}`; msg.className = 'pc-modal-msg bad'; return; }
  let r; let j;
  try { r = await cwPost('/api/scanners/config', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: c.id, text: ta.value, baseHash: c.baseHash }) }); j = await r.json(); }
  catch (e) { msg.textContent = `could not reach the panel — nothing was written (${e.message})`; msg.className = 'pc-modal-msg bad'; return; }
  if (r.status === 409) { msg.textContent = 'changed on disk since you opened it — nothing was written. Close and reopen to see the current version; your edit is still in the box.'; msg.className = 'pc-modal-msg bad'; return; }
  if (!r.ok || !j.ok) { msg.innerHTML = `<b>refused</b> — ${((j && j.errors) || [j && j.error]).map(pcEsc).join('<br>')}`; msg.className = 'pc-modal-msg bad'; return; }
  c.baseHash = j.baseHash;
  msg.textContent = `saved by ${j.by} — the next sweep runs it. The perf table below re-reads the model.`;
  msg.className = 'pc-modal-msg ok';
  if (typeof loadPerf === 'function') loadPerf();
}

// ── per-repository depth and intensity ────────────────────────────────────────────────────────
async function pcLoadRepos() {
  const box = pcEl('perf-repos-body');
  if (!box) return;
  try { PC.repos = await pcJson('/api/scanners/repos'); }
  catch (e) { box.innerHTML = `<tr><td colspan="5"><div class="pk-err">the per-repository table is UNKNOWN — ${pcEsc(e.message)}</div></td></tr>`; return; }
  pcRenderRepos();
}

function pcLevelSelect(kind, repo, cur, own, levels) {
  const opts = [`<option value=""${own ? '' : ' selected'}>fleet (${pcEsc(cur.fleet)})</option>`]
    .concat((levels || []).map((l) => `<option value="${l.level}"${own && cur.value === l.level ? ' selected' : ''}>${l.level} · ${pcEsc(l.label)}</option>`));
  return `<select data-pc-repo="${pcEsc(repo)}" data-pc-field="${kind}" aria-label="${pcEsc(repo)} ${kind}">${opts.join('')}</select>`;
}

function pcRenderRepos() {
  const d = PC.repos; const box = pcEl('perf-repos-body');
  if (!d || !box) return;
  const levels = (k) => (typeof perfData === 'object' && perfData ? (k === 'depth' ? perfData.depthLevels : perfData.intensityLevels) : []) || [];
  const table = d.table && d.table.value ? d.table.value : {};
  const f = PC.filter.toLowerCase();
  const rows = d.repos.filter((r) => !f || r.name.toLowerCase().includes(f) || String(r.area || '').toLowerCase().includes(f));
  pcEl('perf-repos-n').textContent = `${Object.keys(table).length} of ${d.repos.length} repositories set their own`;
  box.innerHTML = rows.map((r) => {
    const own = table[r.name] || {};
    return `<tr${r.overridden ? ' class="pc-own"' : ''}><td><b>${pcEsc(r.name)}</b></td><td class="mut">${pcEsc(r.area || '—')}</td>`
      + `<td>${pcLevelSelect('depth', r.name, r.depth, own.depth !== undefined, levels('depth'))}</td>`
      + `<td>${pcLevelSelect('intensity', r.name, r.intensity, own.intensity !== undefined, levels('intensity'))}</td>`
      + `<td class="mut">${r.overridden ? 'own' : 'fleet'}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="mut">no repository matches</td></tr>';
  const notes = [];
  if (d.reposError) notes.push(`<b class="txt-crit">${pcEsc(d.reposError)}</b>`);
  if (d.orphans && d.orphans.length) notes.push(`set for repositories no sweep resolves now: ${d.orphans.map(pcEsc).join(', ')} — they apply to nothing until those come back`);
  (d.notes || []).forEach((n) => notes.push(pcEsc(n)));
  pcEl('perf-repos-note').innerHTML = notes.join(' · ');
}

function pcRepoTable() {
  const out = {};
  const cur = (PC.repos && PC.repos.table && PC.repos.table.value) || {};
  for (const [k, v] of Object.entries(cur)) out[k] = { ...v };
  document.querySelectorAll('#perf-repos-body select[data-pc-repo]').forEach((s) => {
    const repo = s.dataset.pcRepo; const field = s.dataset.pcField;
    if (!out[repo]) out[repo] = {};
    if (s.value === '') delete out[repo][field]; else out[repo][field] = Number(s.value);
    if (!Object.keys(out[repo]).length) delete out[repo];
  });
  return out;
}

async function pcSaveRepos(btn) {
  const msg = pcEl('perf-repos-msg');
  btn.disabled = true;
  let r; let j;
  try { r = await cwPost('/api/scanners/repos', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repoTuning: pcRepoTable() }) }); j = await r.json(); }
  catch (e) { btn.disabled = false; msg.className = 'pk-err'; msg.textContent = `could not reach the panel — nothing was saved (${e.message})`; return; }
  btn.disabled = false;
  if (!r.ok || !j.ok) { msg.className = 'mut bad'; msg.innerHTML = `<b>refused</b> — ${pcEsc(j && j.error)}`; return; }
  PC.repos = j;
  msg.className = 'mut'; msg.textContent = `saved by ${j.by} — each repository's next scan uses it`;
  pcRenderRepos();
}

// ── detectors the depth model does not govern ─────────────────────────────────────────────────
function pcRenderOutside() {
  const box = pcEl('perf-outside-body');
  if (!box) return;
  if (!PC.cat) { box.innerHTML = `<tr><td colspan="4" class="mut">UNKNOWN — ${pcEsc(PC.catErr || 'the scanner list could not be read')}</td></tr>`; return; }
  const rows = [];
  for (const o of PC.cat.outsideRunner) {
    rows.push(`<tr><td><b>${pcEsc(o.id)}</b>${o.view ? ` <a href="/${pcEsc(o.view)}/" class="mut">open</a>` : ''}</td><td class="cell-wrap">${pcEsc(o.what)}</td>`
      + `<td class="cell-wrap mut">${pcEsc(o.runs)}${o.tools && o.tools.length ? `<div class="t-meta">${o.tools.map(pcEsc).join(', ')}</div>` : ''}</td>`
      + `<td>${o.moduleExists ? `<code>${pcEsc(o.module)}</code>` : `<b class="txt-crit">${pcEsc(o.module)} is missing</b>`}</td></tr>`);
  }
  for (const m of PC.cat.otherManifests) {
    if (m.error) { rows.push(`<tr><td colspan="4" class="mut">${pcEsc(m.manifest)} could not be read — ${pcEsc(m.error)}</td></tr>`); continue; }
    rows.push(`<tr><td><b>${pcEsc(m.id)}</b></td><td class="cell-wrap">${pcEsc(m.description || 'no description declared')}</td>`
      + `<td class="mut">its own manifest, run as-is at every depth</td><td><code>manifests/${pcEsc(m.manifest)}</code></td></tr>`);
  }
  pcEl('perf-outside-n').textContent = `${rows.length} not governed by depth`;
  box.innerHTML = rows.join('');
}

// ── scan a path: operator port only (admin/SPEC-scan-path.md) ─────────────────────────────────
// The section is built only when the server reports canAct, so the published port has no control
// to find, disabled or otherwise. Progress rides the existing job feed for kind scan-path.
const SP = { stream: null, timer: null, seq: -1 };

function pcScanPathState(j) {
  const [tone, text] = j.running ? ['part', 'running'] : j.stoppedAt ? ['crit', 'stopped']
    : j.phase === 'done' ? ['live', 'complete'] : ['crit', `exited ${j.signal || j.exitCode}`];
  return `<span class="pill ${tone}">${pcEsc(text)}</span> <b>${pcEsc(j.label || 'scan')}</b>`
    + (j.startedAt ? ` <span class="mut">started ${pcEsc(j.startedAt)}</span>` : '')
    + (j.running ? ' <button type="button" id="pc-sp-stop">stop</button>' : '');
}

function pcScanPathJobHtml(j) {
  if (!j) return '';
  return `<div class="gap-top" id="pc-sp-state">${pcScanPathState(j)}</div>`
    + `<pre class="pc-log" id="pc-sp-log">${ansiHtml((j.lines || []).join('\n'))}</pre>`;
}

function pcScanPathHtml(d) {
  if (!d || d.canAct !== true) return '';
  const running = !!(d.job && d.job.running);
  return '<div class="hd"><h3>Scan a path</h3><span class="mut hd-note">this machine only · <code>commitwork brief</code>: scans every git repository under a directory, then ranks what to fix</span></div>'
    + '<div class="pf-form"><div class="pf-field"><label for="pc-sp-path">absolute path to a directory</label>'
    + '<input class="pf-input" id="pc-sp-path" type="text" size="60" spellcheck="false" autocomplete="off" placeholder="/path/to/repositories"></div>'
    + `<button type="button" class="pri" id="pc-sp-run"${running ? ' disabled' : ''}>scan</button>`
    + `<button type="button" id="pc-sp-pc"${running ? ' disabled' : ''}>scan this machine</button></div>`
    + '<div class="pf-msg" id="pc-sp-msg" role="status"></div>'
    + `<div id="pc-sp-job">${pcScanPathJobHtml(d.job)}</div>`
    + '<div id="pc-sp-brief"></div>'
    + '<div class="foot">Scans only: a lane whose tool is not installed reports <b>not scanned</b>; install it from that scanner\'s page. '
    + 'A complete scan is not a clean one: the brief lists dependency fixes with KEV advisories first, then the other open findings, then every lane that did not measure. It and the reports are in the private output directory (the sidecar, or <code>CW_SCAN_PATH_OUT</code>), never the checkout\'s <code>reports/</code>. '
    + '<b>Scan this machine</b> scans each repository under the home directory on its own, sets aside directories holding 100 or more repositories, and skips credential stores, the checkout and the output directory; the log lists what it found and excluded. '
    + 'Refused here: a relative path, anything that is not a directory, a system directory (temporary directories excepted), and a path inside or containing a credential store, the output directory or the commitwork checkout.</div>';
}

// ── the remediation brief a finished scan wrote (bin/lib/brief.mjs) ──
const PC_BRIEF_ROWS = 10;
const pcSevCls = (s) => (s === 'crit' || s === 'high' ? 'txt-crit' : s === 'med' ? '' : 'mut');
const pcBriefTarget = (x) => (x.target && x.target.mode === 'pc' ? 'this machine' : (x.target && x.target.root) || x.id);
const pcPlural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function pcBriefPickHtml(briefs, id) {
  if (briefs.length < 2) return '';
  return '<label class="mut" for="pc-sp-brief-pick">earlier briefs</label> <select id="pc-sp-brief-pick">'
    + briefs.map((x) => `<option value="${pcEsc(x.id)}"${x.id === id ? ' selected' : ''}>${pcEsc(x.generatedAt || x.id)} · ${pcEsc(x.error ? `unreadable: ${x.error}` : pcBriefTarget(x))}</option>`).join('')
    + '</select>';
}

function pcBriefHtml(b, briefs, id) {
  const c = b.counts || {};
  const kev = b.enrichment && b.enrichment.kev;
  const more = (n) => (n > PC_BRIEF_ROWS ? `<div class="mut">… ${n - PC_BRIEF_ROWS} more in the full brief</div>` : '');
  const actions = (b.actions || []).slice(0, PC_BRIEF_ROWS).map((a, i) => {
    const what = `${a.package}${a.version ? `@${a.version}` : ''}${a.fix ? ` → ${a.fix}` : ' (no fixed version published)'}`;
    return `<tr><td>${i + 1}</td><td>${pcEsc(a.repo)}</td><td><code>${pcEsc(what)}</code></td><td>${a.kev ? `<b class="txt-crit">KEV ×${a.kev}</b>` : ''}</td>`
      + `<td class="${pcSevCls(a.worst)}">${pcEsc(a.worst)}</td><td>${typeof a.epss === 'number' ? a.epss.toFixed(2) : ''}</td>`
      + `<td class="cell-wrap"><code>${(a.findings || []).map((f) => pcEsc(f.id) + (f.kev ? ' <b>KEV</b>' : '')).join(', ')}</code></td></tr>`;
  });
  const issues = (b.issues || []).slice(0, PC_BRIEF_ROWS).map((s) => {
    const counts = ['crit', 'high', 'med', 'low', 'undetermined'].filter((k) => s.counts && s.counts[k]).map((k) => `<span class="${pcSevCls(k)}">${k} ${s.counts[k]}</span>`).join(' · ');
    const t = (s.top || [])[0];
    return `<tr><td>${pcEsc(s.repo)}</td><td>${pcEsc(s.label)}</td><td>${counts}</td>`
      + `<td class="cell-wrap">${t ? `<code>${pcEsc(t.rule)}</code>${t.file ? ` <span class="mut">${pcEsc(t.file)}${t.line ? `:${t.line}` : ''}</span>` : ''}` : ''}</td></tr>`;
  });
  const unmeasured = (b.notMeasured || []).slice(0, PC_BRIEF_ROWS).map((n) => `<tr><td>${pcEsc(n.repo)}</td><td><code>${pcEsc(n.check)}</code></td><td>${pcEsc(n.kind)}</td><td class="cell-wrap mut">${pcEsc(n.reason)}</td></tr>`);
  return `<div class="hd gap-top"><h3>Remediation brief</h3><span class="mut hd-note">${pcEsc(pcBriefTarget({ id, target: b.target }))} · ${pcPlural(c.repos || 0, 'repository', 'repositories')} · ${pcEsc(b.generatedAt)} · `
    + `${kev && kev.consulted ? `KEV catalogue ${pcEsc(kev.catalogVersion)} (${pcEsc(kev.freshness)})` : 'KEV not consulted: every KEV field is unknown, not false'}</span></div>`
    + `<div class="pf-form">${pcBriefPickHtml(briefs, id)} <a href="/api/scan-path/brief?id=${encodeURIComponent(id)}&amp;format=html" target="_blank" rel="noopener">open the full brief</a></div>`
    + `<h4>1. Dependency fixes, CVE/KEV first <span class="mut">${pcPlural(c.actions || 0, 'upgrade', 'upgrades')} · ${pcPlural(c.kev || 0, 'KEV advisory', 'KEV advisories')}${c.undetermined ? ` · ${c.undetermined} undetermined, not counted` : ''}</span></h4>`
    + (actions.length ? `<div class="tw"><table><thead><tr><th>#</th><th>repo</th><th>upgrade</th><th>KEV</th><th>worst</th><th>EPSS</th><th>advisories</th></tr></thead><tbody>${actions.join('')}</tbody></table></div>${more(c.actions || 0)}`
      : '<div class="mut">none found where dependency advisories were measured</div>')
    + `<h4>2. Other security findings <span class="mut">${pcPlural(c.issues || 0, 'lane', 'lanes')} with open findings${c.suppressed ? ` · ${c.suppressed} suppressed in source, not listed` : ''}</span></h4>`
    + (issues.length ? `<div class="tw"><table><thead><tr><th>repo</th><th>lane</th><th>open</th><th>e.g.</th></tr></thead><tbody>${issues.join('')}</tbody></table></div>${more(c.issues || 0)}` : '<div class="mut">none open</div>')
    + `<h4>3. Not measured <span class="mut">${c.notMeasured || 0}: a lane that did not run is not a pass</span></h4>`
    + (unmeasured.length ? `<div class="tw"><table><thead><tr><th>repo</th><th>check</th><th>kind</th><th>reason</th></tr></thead><tbody>${unmeasured.join('')}</tbody></table></div>${more(c.notMeasured || 0)}` : '<div class="mut">every in-scope lane ran</div>');
}

// id: a run to show; without one, the newest brief.
async function pcScanPathBriefs(id) {
  const box = pcEl('pc-sp-brief');
  if (!box) return;
  let list;
  try { list = await pcJson('/api/scan-path/briefs'); }
  catch (e) { box.innerHTML = `<div class="pk-err">the briefs could not be listed: ${pcEsc(e.message)}</div>`; return; }
  const briefs = list.briefs || [];
  if (!briefs.length) { box.innerHTML = ''; return; }
  const pick = briefs.find((x) => x.id === id) || briefs[0];
  if (pick.error) { box.innerHTML = `<div class="pf-form">${pcBriefPickHtml(briefs, pick.id)}</div><div class="pk-err">brief ${pcEsc(pick.id)}: ${pcEsc(pick.error)}</div>`; return; }
  let b;
  try { b = await pcJson(`/api/scan-path/brief?id=${encodeURIComponent(pick.id)}`); }
  catch (e) { box.innerHTML = `<div class="pf-form">${pcBriefPickHtml(briefs, pick.id)}</div><div class="pk-err">brief ${pcEsc(pick.id)} could not be read: ${pcEsc(e.message)}</div>`; return; }
  if (pcEl('pc-sp-brief')) pcEl('pc-sp-brief').innerHTML = pcBriefHtml(b, briefs, pick.id);
}

function pcScanPathMount(d) {
  let sec = pcEl('perf-scanpath');
  const html = pcScanPathHtml(d);
  if (!html) { if (sec) sec.remove(); return; }
  const typed = pcEl('pc-sp-path') ? pcEl('pc-sp-path').value : '';
  if (!sec) {
    const detail = pcEl('perf-scanner');
    if (!detail) return;
    sec = document.createElement('section');
    sec.id = 'perf-scanpath';
    sec.setAttribute('data-pc-overview', '');
    detail.after(sec);
  }
  sec.hidden = !pcEl('perf-scanner').hidden;
  sec.innerHTML = html;
  if (typed) pcEl('pc-sp-path').value = typed;
}

async function pcScanPathLoad() {
  let d = null;
  try { d = await pcJson('/api/scan-path'); } catch { /* which port this is is unknown, so no control */ }
  pcScanPathMount(d);
  if (d && d.canAct && d.job) { SP.seq = d.job.seq; if (d.job.running) pcScanPathWatch(); }
  if (d && d.canAct) pcScanPathBriefs();
}

function pcScanPathAppend(line) {
  const log = pcEl('pc-sp-log');
  if (!log) return;
  const pin = log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
  log.insertAdjacentHTML('beforeend', (log.innerHTML ? '\n' : '') + ansiHtml(line));
  if (pin) log.scrollTop = log.scrollHeight;
}

function pcScanPathStatus(j) {
  if (!j) return;
  for (const id of ['pc-sp-run', 'pc-sp-pc']) if (pcEl(id)) pcEl(id).disabled = !!j.running;
  if (j.running && pcEl('pc-sp-state')) { pcEl('pc-sp-state').innerHTML = pcScanPathState(j); return; }
  const box = pcEl('pc-sp-job');
  if (box) box.innerHTML = pcScanPathJobHtml(j);
  SP.seq = j.seq;
  if (!j.running) { pcScanPathUnwatch(); if (j.phase === 'done') pcScanPathBriefs(); }
}

function pcScanPathUnwatch() {
  if (SP.stream) { try { SP.stream.close(); } catch { /* closed */ } SP.stream = null; }
  if (SP.timer) { clearInterval(SP.timer); SP.timer = null; }
}

async function pcScanPathPoll() {
  let d;
  try { d = await pcJson('/api/scan-path'); } catch { return; }
  if (!d.job) { pcScanPathUnwatch(); return; }
  if (d.job.seq !== SP.seq) { const box = pcEl('pc-sp-job'); if (box) box.innerHTML = pcScanPathJobHtml(d.job); SP.seq = d.job.seq; }
  pcScanPathStatus(d.job);
}

// EventSource first, the 1200ms poll as the fallback, like the sweep and STPA consoles.
function pcScanPathWatch() {
  if (SP.stream || SP.timer) return;
  let es = null;
  try { if (typeof EventSource !== 'undefined') es = new EventSource(`/api/status/events?kind=scan-path&from=${SP.seq}`); } catch { es = null; }
  if (!es) { SP.timer = setInterval(pcScanPathPoll, 1200); return; }
  SP.stream = es;
  es.addEventListener('line', (e) => { const d = JSON.parse(e.data); if (d.seq <= SP.seq) return; SP.seq = d.seq; pcScanPathAppend(d.line); });
  es.addEventListener('gap', (e) => { const d = JSON.parse(e.data); pcScanPathAppend(`[panel] ${d.dropped} line(s) scrolled out of the retained window while disconnected`); });
  es.addEventListener('status', (e) => pcScanPathStatus(JSON.parse(e.data)));
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) { SP.stream = null; if (!SP.timer) SP.timer = setInterval(pcScanPathPoll, 1200); } };
}

// Two clicks for the whole machine, like an uninstall: the first arms it, the second starts it.
function pcScanPathArmPc(btn) {
  if (btn.dataset.armed === '1') return pcScanPathRun(btn, true);
  btn.dataset.armed = '1'; btn.textContent = 'confirm: scan every repository on this machine';
  setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = 'scan this machine'; } }, 6000);
}

async function pcScanPathRun(btn, pc = false) {
  const msg = pcEl('pc-sp-msg');
  const path = (pcEl('pc-sp-path') ? pcEl('pc-sp-path').value : '').trim();
  if (!pc && !path) { msg.textContent = 'enter an absolute path to a directory first; nothing was started'; return; }
  btn.disabled = true;
  msg.textContent = 'starting…';
  let r; let j;
  try { r = await cwPost('/api/scan-path', { headers: { 'content-type': 'application/json' }, body: JSON.stringify(pc ? { pc: true } : { path }) }); j = await r.json(); }
  catch (e) { btn.disabled = false; msg.textContent = `could not reach the panel; nothing was started (${e.message})`; return; }
  const running = j && j.job && j.job.running;
  if (!r.ok || !j || !j.ok) {
    btn.disabled = !!running;
    msg.textContent = `refused: ${(j && j.error) || `HTTP ${r.status}`}`;
    if (running && !SP.stream && !SP.timer) pcScanPathShow(j.job);
    return;
  }
  msg.textContent = j.pc ? 'started: every repository on this machine' : `started: ${j.path}`;
  pcScanPathUnwatch();
  pcScanPathShow(j.job);
}

// The server signals the scan's process group, then removes only the containers it started.
async function pcScanPathStop(btn) {
  const msg = pcEl('pc-sp-msg');
  btn.disabled = true;
  let r; let j;
  try { r = await cwPost('/api/sweep/stop?kind=scan-path'); j = await r.json(); }
  catch (e) { btn.disabled = false; if (msg) msg.textContent = `could not reach the panel; nothing was stopped (${e.message})`; return; }
  if (j && j.stopped) { if (msg) msg.textContent = 'stopping: the scan is signalled, then the containers it started are removed'; return; }
  btn.disabled = false;
  if (msg) msg.textContent = `not stopped: ${(j && j.reason) || `HTTP ${r.status}`}`;
}

function pcScanPathShow(job) {
  const box = pcEl('pc-sp-job');
  if (box) box.innerHTML = pcScanPathJobHtml(job);
  SP.seq = job ? job.seq : -1;
  if (job && job.running) pcScanPathWatch();
}

// ── events ────────────────────────────────────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const t = e.target.closest && e.target.closest('[data-pc-id],[data-pc-act],[data-pc-config],#pc-modal-cancel,#pc-modal-save,#perf-repos-save,#pc-sp-run,#pc-sp-pc,#pc-sp-stop');
  if (!t) { if (e.target && e.target.id === 'pc-modal') pcCloseModal(); return; }
  if (t.id === 'pc-sp-run') return t.disabled ? undefined : pcScanPathRun(t);
  if (t.id === 'pc-sp-pc') return t.disabled ? undefined : pcScanPathArmPc(t);
  if (t.id === 'pc-sp-stop') return t.disabled ? undefined : pcScanPathStop(t);
  if (t.id === 'pc-modal-cancel') return pcCloseModal();
  if (t.id === 'pc-modal-save') return pcSaveConfig();
  if (t.id === 'perf-repos-save') return pcSaveRepos(t);
  if (t.dataset.pcConfig) return pcOpenConfig(t.dataset.pcConfig);
  if (t.dataset.pcAct) return pcAction(t);
  if (t.dataset.pcId !== undefined) { e.preventDefault(); return pcGo(t.dataset.pcId); }
}, false);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pcEl('pc-modal')) pcCloseModal();
  if (e.key === 'Enter' && e.target && e.target.id === 'pc-sp-path' && pcEl('pc-sp-run') && !pcEl('pc-sp-run').disabled) pcScanPathRun(pcEl('pc-sp-run'));
}, false);
document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'perf-repos-filter') { PC.filter = e.target.value; pcRenderRepos(); }
}, false);
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'pc-sp-brief-pick') { pcScanPathBriefs(e.target.value); return; }
  if (e.target && e.target.dataset && e.target.dataset.pcRepo) {
    const m = pcEl('perf-repos-msg'); if (m) { m.className = 'mut'; m.textContent = 'changed — not saved until "save repository settings"'; }
  }
}, false);
addEventListener('popstate', () => { if (typeof curView !== 'undefined' && curView === 'perf') pcRoute(); });
