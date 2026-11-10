// The Runner page: runner-view.mjs's model as one document on the panel's theme (docs/THEME.md
// §2.1). Every text goes through esc. Colour marks state only; an unknown is dashed, dim and
// italic, and reads UNMEASURED.
import { esc } from '../../lib/html-escape.mjs';
import { MARK_ICON } from '../../lib/brand-tokens.mjs';
import { THEME_HEAD, THEME_SWITCH } from './theme-head.mjs';

export const REFRESH_SEC = 15;
export const PAGE_CSP = "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; "
  + "img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

const STYLE = `
 body{margin:0}
 main{max-width:90rem;margin:0 auto;padding:1.5rem 2rem 3rem}
 h1{font:600 1.1rem var(--sans);color:var(--head);margin:0}
 h2{font-family:var(--sans);color:var(--head);margin:0}
 .stamp{color:var(--dim);font-size:.719rem;margin:.25rem 0 0}
 .api{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin:1rem 0}
 .api code{color:var(--mut)}
 .kpi::before{background:var(--line2)}
 .layer{font:600 .656rem var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--mut);margin:1.25rem 0 .5rem}
 .layer .at{font-weight:400;letter-spacing:0;text-transform:none;color:var(--dim);margin-left:.6rem}
 .figs{display:grid;grid-template-columns:repeat(auto-fit,minmax(19rem,1fr));gap:0 2rem}
 .figs .kv{border-top:0;border-bottom:1px dashed var(--line)}.figs .kv span{white-space:nowrap}
 .unm{color:var(--dim);font-style:italic;border:1px dashed var(--line2);border-radius:.25rem;padding:0 .3rem}
 .absent{border:1px dashed var(--line2);border-radius:.625rem;padding:.75rem .875rem;color:var(--mut);margin-bottom:1rem}
 .absent b{color:var(--dim);font-style:italic;font-weight:600;margin-right:.5rem}
 .remedy{color:var(--mut);margin-top:.25rem}
 .pill.plain{color:var(--ink);border-color:var(--line2)}.pill.plain::before{border:1px solid var(--mut)}
 .pill.unk::before{border:1px dashed var(--dim)}
 td.num{text-align:right;white-space:nowrap}
 td .sub{display:block;color:var(--dim);font-size:.656rem}
 .theme-switch{position:fixed;top:.75rem;right:.75rem}
`;

const cell = (f) => (f.unknown ? `<span class="unm" title="${esc(f.why)}">${esc(f.text)}</span>` : esc(f.text));
const pill = (tone, word, title) => `<span class="pill ${esc(tone)}"${title ? ` title="${esc(title)}"` : ''}>${esc(word)}</span>`;
const num = (f) => `<td class="num">${cell(f)}</td>`;
const subject = (runId, jobId) => (runId === null && jobId === null ? '<span class="sub">whole repository</span>'
  : `<span class="sub">run ${esc(runId ?? '—')} · job ${esc(jobId ?? '—')}</span>`);

function absent(sec) {
  return `<div class="absent"><b>UNMEASURED</b>${esc(sec.why)}${sec.remedy ? `<div class="remedy">${esc(sec.remedy)}</div>` : ''}</div>`;
}

function table(head, rows, empty) {
  if (!rows.length) return `<p class="stamp">${esc(empty)}</p>`;
  return `<div class="tw"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>`
    + `<tbody>${rows.join('\n')}</tbody></table></div>`;
}

const heading = (id, title, sec, note) => `<div class="hd"><h2 id="${id}">${esc(title)}</h2>`
  + `<span class="n">${sec.state === 'measured' ? `${esc(note)} · read ${esc(sec.verifiedAt)}` : 'UNMEASURED'}</span></div>`;

function apiBlock(api) {
  const head = `<code>${esc(api.url)}</code>`;
  if (api.state !== 'measured') {
    return `<div class="api">${pill('unk', 'UNMEASURED')} ${head}</div>${absent(api)}`;
  }
  const sources = api.sources.map((s) => pill(s.tone, `${s.id} ${s.status}`, s.reason)).join(' ');
  return `<div class="api">${pill('live', 'reachable')} ${head} <span class="stamp">read ${esc(api.verifiedAt)}</span> ${sources}</div>`;
}

const kpis = (list) => `<div class="kpis">${list.map((k) => `<div class="kpi"><div class="k">${esc(k.k)}</div><div class="v">${cell(k.v)}</div></div>`).join('')}</div>`;

const slotsBody = (sec) => (sec.state !== 'measured' ? absent(sec) : table(['Slot', 'State', 'Since', 'Job'], sec.rows.map((s) => `<tr>`
  + `<td class="name">${esc(s.id)}</td><td>${pill(s.tone, s.state)}</td><td>${esc(s.since)}</td>`
  + `<td>${s.job ? `${esc(s.job.repo)}${subject(s.job.runId, s.job.jobId)}<span class="sub">${esc(s.job.runner)}</span>` : '<span class="stamp">no job</span>'}</td></tr>`), 'The slot table is empty.'));

const decisionsBody = (sec) => (sec.state !== 'measured' ? absent(sec) : table(['Last seen', 'Repository', 'Outcome', 'Code', 'Reason', 'Seen'], sec.rows.map((d) => `<tr>`
  + `<td>${esc(d.at)}</td><td>${esc(d.repo ?? '—')}${subject(d.runId, d.jobId)}</td><td>${pill(d.tone, d.outcome)}</td>`
  + `<td><code>${esc(d.code)}</code></td><td>${esc(d.reason ?? '')}</td><td class="num">${esc(d.seen)}</td></tr>`), 'No admission decision is recorded yet.'));

function vmBody(vm) {
  if (vm.state !== 'measured') return absent(vm);
  return `<div class="card figs">${vm.figures.map((f) => `<div class="kv"><span class="mut">${esc(f.k)}</span><span>${cell(f.v)}</span></div>`).join('')}</div>`;
}

const containersBody = (sec) => (sec.state !== 'measured' ? absent(sec) : table(['Service', 'State', 'CPU', 'CPU-seconds', 'Memory', 'Peak memory', 'Memory limit', 'Pids'], sec.rows.map((c) => `<tr>`
  + `<td class="name">${esc(c.service)}<span class="sub">${esc(c.id)}</span></td><td>${pill(c.tone, c.state)}</td>`
  + `${num(c.cpuPct)}${num(c.cpuSec)}${num(c.mem)}${num(c.memPeak)}${num(c.memMax)}${num(c.pids)}</tr>`), 'The container map names no service.'));

const jobsBody = (sec) => (sec.state !== 'measured' ? absent(sec) : table(['Finished', 'Repository', 'Exit', 'Wall time', 'CPU-seconds', 'Peak memory', 'I/O'], sec.rows.map((j) => `<tr>`
  + `<td>${esc(j.at)}</td><td>${esc(j.repo ?? '—')}${subject(j.runId, j.jobId)}<span class="sub">${esc(j.runner ?? '')}</span></td>`
  + `<td>${pill(j.exit.tone, j.exit.text)}</td>${num(j.wall)}${num(j.cpuSec)}${num(j.memPeak)}${num(j.io)}</tr>`), 'No job has finished yet.'));

const layer = (l, body) => `<div class="layer">${esc(l.label)}${l.at ? `<span class="at">sampled ${esc(l.at)}</span>` : ''}</div>${body}`;

/** The whole document. */
export function renderRunnerPage(model) {
  const { api, slots, decisions, layers } = model;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${MARK_ICON}
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${REFRESH_SEC}">
<title>Actions runner · commitwork</title>
${THEME_HEAD}
<style>${STYLE}</style></head><body><main>
<h1>Actions runner</h1>
<p class="stamp">The portll-stack dispatcher's slots, admission decisions and resource use, from its stack API. Refreshes every ${REFRESH_SEC} s.</p>
${apiBlock(api)}
${kpis(model.kpis)}
<section aria-labelledby="h-slots">${heading('h-slots', 'Slots', slots, `${slots.rows?.length ?? 0} slots`)}${slotsBody(slots)}</section>
<section aria-labelledby="h-decisions">${heading('h-decisions', 'Admission decisions', decisions, 'newest 50')}${decisionsBody(decisions)}</section>
<section aria-labelledby="h-resources"><div class="hd"><h2 id="h-resources">Resources</h2><span class="n">Docker VM · containers · jobs</span></div>
${layer(layers.vm, vmBody(layers.vm))}
${layer(layers.containers, containersBody(layers.containers))}
${layer(layers.jobs, jobsBody(layers.jobs))}
</section>
</main>
${THEME_SWITCH}</body></html>`;
}
