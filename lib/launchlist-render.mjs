// lib/launchlist-render.mjs — the checklist page. One self-contained document: styles and script
// inline, no external fetches, so the file:// copy and the served copy are the same bytes apart from
// the `interactive` flag. Served, the page ticks through POST /api/launchlist/tick; opened from disk
// it is read-only and says how to tick from the CLI.

import { esc } from './html-escape.mjs';
import { createHash } from 'node:crypto';
import { SEAL_SVG, markRecolourCss } from './brand-tokens.mjs';
import { houseCss } from './house-css.mjs';
import { FOLLOWER_JS } from './theme-follower.mjs';
import { SEVERITY_ORDER } from './launchlist.mjs';

const sha256b64 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');

const css = () => `
${houseCss()}
${markRecolourCss('html[data-mode=light] header')}
@media (prefers-color-scheme:light){${markRecolourCss('html:not([data-mode]) header')}}
body{font-size:.875rem;line-height:1.45}
header{background:var(--panel);color:var(--head);padding:.875rem 1.375rem;display:flex;gap:.875rem;align-items:center;border-bottom:3px solid var(--acc)}
header svg{width:1.875rem;height:1.875rem;flex:none}
header h1{font-size:1.1875rem;margin:0;letter-spacing:.02em}
header .gen{margin-left:auto;font-size:.75rem;color:var(--mut)}
main{padding:.875rem 1.375rem 3.75rem;max-width:93.75rem;margin:0 auto}
.banner{border:1px solid var(--line);border-left:4px solid var(--acc);background:var(--panel);padding:.5rem .75rem;margin:.625rem 0;font-size:.8125rem}
.filters{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:.625rem 0;display:flex;flex-wrap:wrap;gap:.875rem;align-items:center;font-size:.8125rem}
.filters label{display:inline-flex;gap:.3125rem;align-items:center}
.filters input[type=search]{padding:.3125rem .5rem;border:1px solid var(--line2);background:var(--panel);color:var(--ink);min-width:13.75rem;font:inherit}
.filters select{padding:.25rem .375rem;border:1px solid var(--line2);background:var(--panel);color:var(--ink);font:inherit}
table{background:var(--panel)}
th{font-size:.6875rem}
.overview td.n{text-align:right;font-variant-numeric:tabular-nums}
.overview a{color:var(--ink)}
section.project{margin-top:1.75rem}
section.project>h2{font-size:1.125rem;margin:0 0 2px;display:flex;gap:.625rem;align-items:baseline;border-bottom:2px solid var(--head);padding-bottom:.25rem}
section.project>h2 small{font-size:.75rem;font-weight:400;color:var(--mut)}
h3{font-size:.8125rem;text-transform:uppercase;letter-spacing:.06em;margin:1rem 0 .25rem;color:var(--mut)}
.group table{table-layout:fixed}
td.chk{width:2.25rem;text-align:center}
td.chk input{width:1.0625rem;height:1.0625rem;accent-color:var(--acc)}
td.st{width:7rem}
td.meta{width:8rem;font-size:.75rem;white-space:nowrap}
td.act{width:9.375rem;white-space:nowrap}
.sev-HARD{font-weight:700} .sev-SHOULD{color:var(--ink)} .sev-LATER{color:var(--mut)}
.title{font-weight:600}
.id{font:.6875rem var(--mono);color:var(--mut);margin-left:.375rem}
.why{color:var(--ink);font-size:.78rem;margin-top:2px}
.how{color:var(--mut);font-size:.78rem}
.sum{font-size:.78rem;margin-top:.1875rem}
details{margin-top:.25rem}
details summary{cursor:pointer;font-size:.75rem;color:var(--mut)}
pre{margin:.25rem 0 0;white-space:pre-wrap;font:.71875rem/1.4 var(--mono);background:var(--panel2);padding:.375rem .5rem;border:1px solid var(--line)}
.tick{font-size:.75rem;color:var(--mut);margin-top:.1875rem}
.lapsed,.stale{color:var(--part)}
button{font:.75rem var(--sans);border:1px solid var(--line2);background:var(--panel);color:var(--ink);padding:.1875rem .4375rem;cursor:pointer}
button:hover{border-color:var(--acc)}
tr.is-done .title{color:var(--mut)}
.hidden{display:none!important}
@media print{.filters,.act,button,.banner.live{display:none!important} header{background:#fff;color:#000;border-bottom:2px solid #000} section.project{break-before:page} tr{break-inside:avoid} details{display:block} details>*{display:block}}
`;

const JS = `
(() => {
  const data = JSON.parse(document.getElementById('launchlist-data').textContent);
  const $ = (s, r = document) => [...r.querySelectorAll(s)];
  const f = { q: document.getElementById('f-q'), open: document.getElementById('f-open'), project: document.getElementById('f-project'), owner: document.getElementById('f-owner'), sev: $('.f-sev') };
  function apply() {
    const q = f.q.value.trim().toLowerCase();
    const sevs = new Set(f.sev.filter((x) => x.checked).map((x) => x.value));
    for (const sec of $('section.project')) {
      const showProject = !f.project.value || sec.dataset.project === f.project.value;
      let any = false;
      for (const tr of $('tr.item', sec)) {
        const ok = showProject && sevs.has(tr.dataset.sev) && (!f.open.checked || tr.dataset.done !== '1')
          && (!f.owner.value || tr.dataset.owner === f.owner.value) && (!q || tr.dataset.text.includes(q));
        tr.classList.toggle('hidden', !ok);
        any ||= ok;
      }
      for (const grp of $('.group', sec)) grp.classList.toggle('hidden', !$('tr.item:not(.hidden)', grp).length);
      sec.classList.toggle('hidden', !showProject || !any);
    }
  }
  [f.q, f.open, f.project, f.owner, ...f.sev].forEach((el) => el.addEventListener('input', apply));
  apply();
  if (!data.interactive) { $('.act button, td.chk input').forEach((b) => { b.disabled = true; }); return; }
  let token = null;
  async function csrf() { if (!token) { const r = await fetch('/api/csrf', { credentials: 'same-origin' }); token = (await r.json()).token; } return token; }
  async function tick(tr, state) {
    const measured = tr.dataset.check === '1';
    let note = '';
    if (state !== 'open') {
      note = prompt(measured ? 'Accepting a measured item needs a note: why is this finding acceptable?' : 'Note (optional):', '') ;
      if (note === null) return false;
      if (measured && !note.trim()) { alert('A measured item needs a note to accept.'); return false; }
    }
    const r = await fetch('/api/launchlist/tick', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-cw-csrf': await csrf() },
      body: JSON.stringify({ project: tr.dataset.project, item: tr.dataset.id, state, note }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { alert('Not recorded: ' + (j.error || (j.errors || []).join('; ') || r.status)); return false; }
    location.reload();
    return true;
  }
  for (const b of $('.act button')) b.addEventListener('click', () => tick(b.closest('tr'), b.dataset.act));
  for (const c of $('td.chk input')) c.addEventListener('click', async (e) => {
    e.preventDefault();
    await tick(c.closest('tr'), c.checked ? 'done' : 'open');
  });
})();
`;

// Every state takes a house pill (lib/house-css.mjs), and its word says it as well as the colour. A
// status this table does not know is drawn as unknown, never as a pass.
const STATUS_PILL = { pass: 'live', fail: 'crit', warn: 'part', unmeasured: 'unk' };

function pill(row) {
  if (row.result) {
    const s = row.result.status;
    if (s !== 'pass' && row.accepted) return `<span class="pill ${row.na ? 'na' : 'done'}">${row.na ? 'N/A' : 'ACCEPTED'}</span>`;
    return `<span class="pill ${Object.hasOwn(STATUS_PILL, s) ? STATUS_PILL[s] : 'unk'}">${esc(String(s).toUpperCase())}</span>`;
  }
  if (row.tick) return `<span class="pill ${row.tick.state === 'na' ? 'na' : 'done'}">${row.tick.state === 'na' ? 'N/A' : 'DONE'}</span>`;
  return '<span class="pill plan">TODO</span>';
}

function rowHtml(p, row) {
  const text = [row.id, row.title, row.why, row.how, row.result && row.result.summary, ...(row.evidence || [])].join(' ').toLowerCase();
  const ev = row.evidence || [];
  const tick = row.tick
    ? `<div class="tick${row.lapsed ? ' lapsed' : row.stale ? ' stale' : ''}">${row.lapsed ? 'acceptance lapsed — the evidence changed since ' : row.stale ? 'acceptance held, not counted — the last run did not measure this check; ' : ''}${esc(row.tick.state)} by ${esc(row.tick.by)} ${esc(row.tick.at)}${row.tick.note ? ` — ${esc(row.tick.note)}` : ''}</div>`
    : '';
  return `<tr class="item${row.done ? ' is-done' : ''}" data-project="${esc(p.project)}" data-id="${esc(row.id)}" data-sev="${esc(row.severity)}" data-owner="${esc(row.owner)}" data-done="${row.done ? 1 : 0}" data-check="${row.check ? 1 : 0}" data-text="${esc(text)}">
<td class="chk"><input type="checkbox" aria-label="done: ${esc(row.title)}"${row.done ? ' checked' : ''}></td>
<td class="st">${pill(row)}</td>
<td><div><span class="title">${esc(row.title)}</span><span class="id">${esc(row.id)}${row.custom ? ' · project item' : ''}</span></div>
${row.why ? `<div class="why">${esc(row.why)}</div>` : ''}${row.how ? `<div class="how">${esc(row.how)}</div>` : ''}
${row.result ? `<div class="sum">${esc(row.result.summary)}${row.result.carriedFrom ? ` <span class="stale">(measured ${esc(row.result.carriedFrom)}, not re-run)</span>` : ''}</div>` : ''}
${ev.length ? `<details><summary>evidence (${ev.length})</summary><pre>${esc(ev.join('\n'))}</pre></details>` : ''}
${row.source ? `<div class="how">source: ${esc(row.source)}</div>` : ''}${tick}</td>
<td class="meta"><div class="sev-${esc(row.severity)}">${esc(row.severity)}</div><div>${esc(row.owner)}</div><div>size ${esc(row.size)}</div></td>
<td class="act"><button data-act="done">done</button> <button data-act="na">n/a</button>${row.tick ? ' <button data-act="open">reopen</button>' : ''}</td>
</tr>`;
}

function projectHtml(model, p) {
  const bySection = new Map();
  for (const r of p.rows) {
    if (!bySection.has(r.section)) bySection.set(r.section, []);
    bySection.get(r.section).push(r);
  }
  const order = [];
  for (const prof of p.profiles) for (const s of ((model.profiles[prof] || {}).sections || [])) if (!order.includes(s)) order.push(s);
  for (const s of bySection.keys()) if (!order.includes(s)) order.push(s);
  const groups = order.filter((s) => bySection.has(s)).map((s) => {
    const rows = bySection.get(s).slice().sort((a, b) => (a.done - b.done) || (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]));
    return `<div class="group"><h3>${esc(model.sections[s] || s)}</h3><table><tbody>${rows.map((r) => rowHtml(p, r)).join('\n')}</tbody></table></div>`;
  }).join('\n');
  const head = p.repo ? `${esc(p.repo.path || '')} @ ${esc((p.repo.head || '').slice(0, 10))}` : 'not yet run';
  return `<section class="project" id="p-${esc(p.project)}" data-project="${esc(p.project)}">
<h2>${esc(p.project)} <small>${esc(p.profiles.map((x) => (model.profiles[x] || {}).label || x).join(' · '))}</small> <small>${head}${p.measuredAt ? ` · measured ${esc(p.measuredAt)}` : ''}</small></h2>
${groups}
</section>`;
}

export function renderPage(model, { interactive = false } = {}) {
  const projects = model.projects;
  const owners = [...new Set(projects.flatMap((p) => p.rows.map((r) => r.owner)))].sort();
  const overview = projects.map((p) => `<tr><td><a href="#p-${esc(p.project)}">${esc(p.project)}</a></td><td>${esc(p.profiles.join(', '))}</td>
<td class="n sev-HARD">${p.summary.openHard}</td><td class="n">${p.summary.openShould}</td><td class="n">${p.summary.openLater}</td>
<td class="n">${p.summary.done}/${p.summary.total}</td><td class="n">${p.summary.unmeasured}</td><td>${esc(p.measuredAt || 'never')}</td></tr>`).join('\n');
  const data = JSON.stringify({ interactive }).replace(/</g, '\\u003c');
  const banner = interactive
    ? '<div class="banner live">Ticks are recorded against your session. A tick on a measured item is an acceptance bound to its current evidence and lapses when the evidence changes.</div>'
    : '<div class="banner">Read-only copy. Tick with <code>node bin/launchlist.mjs tick &lt;project&gt; &lt;item&gt; [--state done|na|open] [--note …]</code>, or use the served page.</div>';
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>launchlist</title>
<script>${FOLLOWER_JS}</script>
<style>${css()}</style></head>
<body><header>${SEAL_SVG}<h1>launchlist</h1><span class="gen">generated ${esc(model.generatedAt)}</span></header>
<main>
${model.configAbsent ? '<div class="banner">No launchlist config found: every project uses the publication profile and no site, package or test is declared.</div>' : ''}
${banner}
<table class="overview"><thead><tr><th>project</th><th>profiles</th><th>HARD open</th><th>SHOULD open</th><th>LATER open</th><th>done</th><th>unmeasured</th><th>last run</th></tr></thead><tbody>
${overview}
</tbody></table>
<div class="filters">
<label><input type="search" id="f-q" placeholder="filter text, id, evidence"></label>
<label>project <select id="f-project"><option value="">all</option>${projects.map((p) => `<option>${esc(p.project)}</option>`).join('')}</select></label>
<label>owner <select id="f-owner"><option value="">all</option>${owners.map((o) => `<option>${esc(o)}</option>`).join('')}</select></label>
<label><input type="checkbox" class="f-sev" value="HARD" checked> HARD</label>
<label><input type="checkbox" class="f-sev" value="SHOULD" checked> SHOULD</label>
<label><input type="checkbox" class="f-sev" value="LATER" checked> LATER</label>
<label><input type="checkbox" id="f-open" checked> open only</label>
</div>
${projects.map((p) => projectHtml(model, p)).join('\n')}
</main>
<script type="application/json" id="launchlist-data">${data}</script>
<script>${JS}</script>
</body></html>
`;
  return { html: body, csp: pageCsp() };
}

/** An enforced policy that admits exactly this page's inline style and script. */
export function pageCsp() {
  return `default-src 'none'; style-src 'sha256-${sha256b64(css())}'; script-src 'sha256-${sha256b64(FOLLOWER_JS)}' 'sha256-${sha256b64(JS)}'; font-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'none'; base-uri 'none'`;
}
