// admin/static/panel-correlations.js — the Correlations view (#view-correlations): coincidence
// leads, engine divergence, artifact anomalies, and the history of the unknown rate and the ratchet
// floors. Five GETs under /api/correlations/, fetched independently so one unreadable source never
// blanks the others. `esc` and `renderAnomalies` are the panel client's globals, looked up at use.
(function () {
  'use strict';

  const TABS = [['coincidence', 'Coincidence'], ['divergence', 'Divergence'], ['anomalies', 'Artifact anomalies'], ['history', 'History']];
  const state = { tab: 'coincidence', data: null, loading: false };
  const root = () => document.getElementById('view-correlations');

  const when = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '—');
  const pct = (x) => (typeof x === 'number' ? `${(x * 100).toFixed(1)}%` : '—');
  const n = (x) => (typeof x === 'number' ? String(x) : '—');
  const secs = (s) => (typeof s !== 'number' ? '—' : s < 90 ? `${s.toFixed(s < 1 ? 3 : 1)}s` : s < 5400 ? `${(s / 60).toFixed(1)}m` : `${(s / 3600).toFixed(1)}h`);

  async function get(path) {
    try {
      const r = await fetch(path);
      let d = null;
      try { d = await r.json(); } catch (_) { /* a non-JSON reply is reported below as an error */ }
      if (!r.ok || !d || d.ok === false) return { state: 'error', error: (d && d.error) || `HTTP ${r.status}` };
      return d;
    } catch (e) { return { state: 'error', error: e.message }; }
  }

  // Every non-measured state renders as itself; none of them is an empty table.
  function stateLine(d, what) {
    if (!d) return `<span class="pill unk">not loaded</span>`;
    if (d.state === 'error') return `<span class="pill unk">unreadable</span> <span class="mut">${esc(what)} could not be read (${esc(d.error)}) — not an empty result</span>`;
    if (d.state === 'not-generated') return `<span class="pill unk">not generated</span> <span class="mut">${esc(d.why || `${what} has not been produced here`)}</span>`;
    if (d.state === 'skipped') return `<span class="pill unk">skipped</span> <span class="mut">${esc(d.why || 'the lane was skipped')} — no result, which is not a zero</span>`;
    if (d.state === 'failed') return `<span class="pill unk">failed</span> <span class="mut">the lane ran and failed: ${esc(d.detail || 'no reason recorded')}</span>`;
    if (d.state === 'not-configured') return `<span class="pill unk">not configured</span> <span class="mut">the lane produced no result</span>`;
    return null;
  }

  // Inline SVG, no CDN. A null value breaks the line rather than being joined across.
  function spark(points, label) {
    const pts = (points || []).filter((p) => p && Date.parse(p.at));
    if (!pts.length) return '<span class="mut">—</span>';
    const W = 160, H = 24, pad = 2;
    const t0 = Date.parse(pts[0].at), span = Math.max(1, Date.parse(pts[pts.length - 1].at) - t0);
    const vals = pts.map((p) => p.value).filter((v) => typeof v === 'number');
    if (!vals.length) return '<span class="mut">—</span>';
    const lo = Math.min(...vals), hi = Math.max(...vals), range = hi - lo || 1;
    const x = (p) => (pad + ((Date.parse(p.at) - t0) / span) * (W - 2 * pad)).toFixed(1);
    const y = (p) => (H - pad - ((p.value - lo) / range) * (H - 2 * pad)).toFixed(1);
    const segs = []; let cur = [];
    for (const p of pts) { if (typeof p.value === 'number') cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
    if (cur.length) segs.push(cur);
    const lines = segs.filter((s) => s.length > 1).map((s) => `<polyline fill="none" stroke="var(--acc)" stroke-width="1.25" points="${s.map((p) => `${x(p)},${y(p)}`).join(' ')}"/>`).join('');
    const dots = segs.filter((s) => s.length === 1).map((s) => `<circle cx="${x(s[0])}" cy="${y(s[0])}" r="1.75" fill="var(--acc)"/>`).join('');
    const title = `${label}: ${pts.length} point(s), ${when(pts[0].at)} to ${when(pts[pts.length - 1].at)}, range ${lo} to ${hi}`;
    return `<svg class="lt-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${lines}${dots}</svg>`;
  }

  const table = (head, rows, span) => `<div class="tw"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${span || head.length}" class="mut">—</td></tr>`}</tbody></table></div>`;

  function coincidenceBody(d) {
    const s = stateLine(d, 'the coincidence lane');
    if (s) return `<div>${s}</div>`;
    const head = `<div class="mut">${n(d.events)} event(s) over ${n(d.windowDays)} day(s) · kinds: ${esc((d.kinds || []).join(', ') || '—')} · ${n(d.pairsExamined)} pair(s) examined, ${n(d.pairsUnexaminable)} too sparse to examine · ${n(d.leadCount)} lead(s)${(d.leads || []).length < (d.leadCount || 0) ? `, tightest ${d.leads.length} shown` : ''} · forensics run ${esc(when(d.generated))}</div>`;
    const void_ = d.examinedAnything ? '' : '<div><span class="pill unk">nothing examinable</span> <span class="mut">every kind pair fell below the sample floor — an empty lead list here is not a clean result</span></div>';
    const missing = (d.sourcesMissing || []).length ? `<div class="mut">sources not read: ${d.sourcesMissing.map((m) => `${esc(m.source)} (${esc(m.reason)})`).join(', ')}</div>` : '';
    const rows = (d.leads || []).map((l) => `<tr><td class="tnum">${esc(secs(l.gapSec))}</td><td class="tnum mut">${esc(secs(l.pairMedianSec))}</td><td><b class="name">${esc(l.pair)}</b></td><td>${esc(l.from.label || l.from.ref || '—')}</td><td>${esc(l.to.label || l.to.ref || '—')}</td><td class="mut">${esc(when(l.from.at))}</td></tr>`).join('');
    return head + void_ + missing + table(['Gap', 'Pair median', 'Pair', 'From', 'To', 'When'], rows)
      + '<div class="foot">A lead is two events from different records, each with its own writer, that sit unusually close together compared with the gaps that pair usually shows. It is somewhere to look, not a finding: most are one automated process triggering another. Source: the coincidence lane of <code>reports/forensics.json</code> (monitor/coincidence.mjs).</div>';
  }

  function divergenceBody(d) {
    const s = stateLine(d, 'the divergence store');
    if (s) return `<div>${s}</div>`;
    const rows = (d.subjects || []).map((x) => `<tr><td><b class="name">${esc(x.subject)}</b></td><td class="tnum">${typeof x.score === 'number' ? x.score.toFixed(2) : '—'}</td><td class="tnum">${n(x.samples)}</td><td class="mut">${esc(when(x.at))}</td><td>${spark(x.series, `divergence for ${x.subject}`)}</td></tr>`).join('');
    return table(['Subject', 'Latest score', 'Samples', 'Last scored', 'Over time'], rows)
      + '<div class="foot">Two engines classified the same findings; the score is how far they disagreed, from 0 (agreed) to 1 (opposed). It points a person at where to look and is never a verdict. A subject with no record was never compared, which is not agreement. Source: the <code>divergence</code> dimension of the nondeterministic store (monitor/divergence.mjs).</div>';
  }

  function anomaliesBody(d) {
    const s = stateLine(d, 'artifact-anomalies.json');
    if (s) return `<div>${s}</div>`;
    const rows = typeof renderAnomalies === 'function' ? renderAnomalies(d) : '';
    return table(['Category', 'Hash', 'Repos', 'Bytes', 'Where'], rows)
      + '<div class="foot">One check writing a byte-identical, zero-finding result file into many unrelated repositories. One member with a real finding clears its group. Source: <code>artifact-anomalies.json</code> at the reports root (monitor/artifact-anomaly.mjs).</div>';
  }

  function undeterminedBody(d) {
    const s = stateLine(d, 'the unknown-rate history');
    const cur = d && d.current ? `<div class="mut">latest snapshot ${esc(when(d.current.at))}: ${n(d.current.count)} unknown of ${n(d.current.observed)} observed cell(s) (${pct(d.current.unknownRate)}) · ${n(d.current.undetermined)} of ${n(d.current.population)} undetermined (${pct(d.current.undeterminedShare)})</div>` : '';
    if (s) return `<div>${s}</div>${cur}`;
    const pts = d.points || [];
    const lines = `<div class="kv"><span class="mut">unknown rate</span><span>${spark(pts.map((p) => ({ at: p.at, value: p.unknownRate })), 'unknown rate')}</span></div>`
      + `<div class="kv"><span class="mut">undetermined share</span><span>${spark(pts.map((p) => ({ at: p.at, value: p.undeterminedShare })), 'undetermined share')}</span></div>`;
    const rows = pts.slice(-20).reverse().map((p) => `<tr><td class="mut">${esc(when(p.at))}</td><td class="tnum">${n(p.count)}</td><td class="tnum">${n(p.observed)}</td><td class="tnum">${pct(p.unknownRate)}</td><td class="tnum">${n(p.undetermined)}</td><td class="tnum">${n(p.population)}</td><td class="tnum">${pct(p.undeterminedShare)}</td></tr>`).join('');
    return `<div class="mut">${n(d.count)} run(s) recorded${d.truncated ? `, oldest ${d.truncated} not shown` : ''}</div>${lines}`
      + table(['When', 'Unknown', 'Observed', 'Unknown rate', 'Undetermined', 'Population', 'Undetermined share'], rows);
  }

  function ratchetBody(d) {
    const s = stateLine(d, 'the ratchet journals');
    if (s) return `<div>${s}</div>`;
    return (d.gates || []).map((g) => {
      const gs = stateLine(g, `the ${g.gate} journal`);
      if (gs) return `<h3>${esc(g.gate)}</h3><div>${gs}</div>`;
      const verdicts = Object.entries(g.byVerdict || {}).map(([k, v]) => `${esc(k)} ${v}`).join(' · ');
      const chain = g.chainBroken || g.torn ? ` · <b>chain: ${n(g.chainBroken)} broken, ${n(g.torn)} torn line(s)</b>` : '';
      const rows = (g.metrics || []).map((m) => {
        const last = m.points[m.points.length - 1];
        return `<tr><td><b class="name">${esc(m.name)}</b></td><td class="tnum">${n(m.current)}</td><td class="tnum">${n(m.floor)}</td><td class="tnum">${n(m.changes)}</td><td class="mut">${esc(when(last && last.at))}</td><td>${spark(m.points, `${g.gate} ${m.name}`)}</td></tr>`;
      }).join('');
      return `<h3>${esc(g.gate)}</h3><div class="mut">${n(g.records)} run(s) · ${n(g.measured)} carried numbers, ${n(g.unmeasured)} did not · ${verdicts}${chain}</div>`
        + table(['Metric', 'Current', 'Floor', 'Changes', 'Last change', 'Over time'], rows);
    }).join('');
  }

  function historyBody(u, r) {
    return `<section><div class="hd"><h2>Unknown and undetermined rate</h2><span class="mut hd-note">share of published scanner cells carrying an unknown, and share of cells in areas too stale to count · one point per monitor/unknown-rate.mjs run</span></div>${undeterminedBody(u)}</section>`
      + `<section><div class="hd"><h2>Ratchet floors</h2><span class="mut hd-note">each gate's journaled values and the floor it compared them with · only changes are drawn</span></div>${ratchetBody(r)}</section>`;
  }

  function render() {
    const el = root(); if (!el) return;
    const d = state.data || {};
    const tabs = TABS.map(([id, label]) => `<button type="button" class="vtab vtab-sm${state.tab === id ? ' pri' : ''}" data-corr-tab="${id}" aria-pressed="${state.tab === id}">${esc(label)}</button>`).join(' ');
    let body;
    if (!state.data) body = `<div class="mut">${state.loading ? 'loading…' : '—'}</div>`;
    else if (state.tab === 'coincidence') body = coincidenceBody(d.coincidence);
    else if (state.tab === 'divergence') body = divergenceBody(d.divergence);
    else if (state.tab === 'anomalies') body = anomaliesBody(d.anomalies);
    else body = historyBody(d.undetermined, d.ratchets);
    el.innerHTML = `<section><div class="hd"><h2>Correlations</h2><span class="mut hd-note">evidence that only shows up when separate records are read together</span></div><div>${tabs}</div></section>`
      + (state.tab === 'history' ? body : `<section>${body}</section>`);
  }

  async function loadCorrelations() {
    state.loading = true; render();
    const [coincidence, divergence, anomalies, undetermined, ratchets] = await Promise.all([
      get('/api/correlations/coincidence'), get('/api/correlations/divergence'), get('/api/correlations/anomalies'),
      get('/api/correlations/undetermined-history'), get('/api/correlations/ratchet-history'),
    ]);
    state.data = { coincidence, divergence, anomalies, undetermined, ratchets };
    state.loading = false; render();
  }

  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('[data-corr-tab]');
    if (!b) return;
    state.tab = b.dataset.corrTab; render();
  });

  globalThis.loadCorrelations = loadCorrelations;
  globalThis.cwCorrelations = Object.freeze({ state, render, loadCorrelations, spark, stateLine });
})();
