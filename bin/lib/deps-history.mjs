// bin/lib/deps-history.mjs — how closely new releases of each direct dependency are found and
// applied, from the deps ledger (bin/lib/deps-ledger.mjs). Pure over (events, now).
//
// For every release an audit saw — the newest per update type outside its cooldown, and every
// release it held — the lifecycle is: published (registry time), found (first audit that listed
// it), proposed (first proposal moving the package to it or past it), applied (first merge, or
// the first audit whose locked version had reached it — an update made by hand counts too, timed
// by the audit that observed it).
//
// A release already out when a project's first audit ran was not "found late": the audit was not
// running. It is kept, marked `preexisting`, and left out of the time-to-find median.
import { cmpVersion } from './npm-versions.mjs';
import { esc } from '../../lib/html-escape.mjs';
import { houseCss } from '../../lib/house-css.mjs';
import { followerScript } from '../../lib/theme-follower.mjs';
import { MARK_ICON } from '../../lib/brand-tokens.mjs';

const DAY_MS = 86_400_000;
const TYPES = ['patch', 'minor', 'major'];
const days = (a, b) => (a && b ? (Date.parse(b) - Date.parse(a)) / DAY_MS : null);
const minIso = (a, b) => (!a ? b : !b ? a : a <= b ? a : b);

export function median(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const keyOf = (e) => `${e.repo}\0${e.pkgPath ?? '.'}`;

export function buildHistory(events, { nowMs = Date.now(), within = [7, 30] } = {}) {
  const now = new Date(nowMs).toISOString();
  const groups = new Map();
  const group = (e) => {
    const k = keyOf(e);
    if (!groups.has(k)) groups.set(k, { repo: e.repo, pkgPath: e.pkgPath ?? '.', audits: [], proposed: [], merged: [], refused: 0, superseded: 0 });
    return groups.get(k);
  };
  const sorted = [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  for (const e of sorted) {
    if (e.event === 'audit') group(e).audits.push(e);
    else if (e.event === 'proposed') group(e).proposed.push(e);
    else if (e.event === 'merged') group(e).merged.push(e);
    else if (e.event === 'refused') group(e).refused++;
    else if (e.event === 'superseded') group(e).superseded++;
  }
  const proposals = new Map(sorted.filter((e) => e.event === 'proposed').map((e) => [`${keyOf(e)}\0${e.proposal}`, e]));

  const out = [];
  for (const g of groups.values()) {
    const releases = new Map();
    const rel = (name, version, kind) => {
      const k = `${name}\0${version}`;
      if (!releases.has(k)) releases.set(k, { name, version, kind, type: null, publishedAt: null, foundAt: null, eligibleAt: null, proposedAt: null, appliedAt: null, appliedBy: null, proposal: null });
      return releases.get(k);
    };
    const firstAudit = g.audits[0]?.at ?? null;
    for (const a of g.audits) {
      for (const d of a.deps || []) {
        if (d.skipped) continue;
        for (const u of d.updates || []) {
          const r = rel(d.name, u.version, d.kind);
          r.type = r.type || u.type; r.publishedAt = r.publishedAt || u.publishedAt;
          r.foundAt = minIso(r.foundAt, a.at); r.eligibleAt = minIso(r.eligibleAt, a.at);
        }
        for (const h of d.held || []) {
          const r = rel(d.name, h.version, d.kind);
          r.type = r.type || h.type; r.publishedAt = r.publishedAt || h.publishedAt;
          r.foundAt = minIso(r.foundAt, a.at);
        }
      }
    }
    const reach = (name, to, at, by, proposal = null) => {
      for (const r of releases.values()) {
        if (r.name !== name || !to || cmpVersion(r.version, to) > 0) continue;
        if (by === 'proposed') { r.proposedAt = minIso(r.proposedAt, at); continue; }
        if (!r.appliedAt || at < r.appliedAt) { r.appliedAt = at; r.appliedBy = by; r.proposal = proposal; }
      }
    };
    for (const p of g.proposed) for (const c of p.changes || []) if (c.path === `node_modules/${c.name}`) reach(c.name, c.to, p.at, 'proposed');
    for (const m of g.merged) {
      const p = proposals.get(`${keyOf(m)}\0${m.proposal}`);
      for (const c of p?.changes || []) if (c.path === `node_modules/${c.name}`) reach(c.name, c.to, m.at, 'merge', m.proposal);
    }
    for (const a of g.audits) for (const d of a.deps || []) if (!d.skipped && d.locked) reach(d.name, d.locked, a.at, 'observed');

    const lifecycle = [...releases.values()].map((r) => {
      const preexisting = !!(r.publishedAt && firstAudit && r.foundAt === firstAudit && r.publishedAt < firstAudit);
      // A release found at an audit but applied BEFORE it (locked had already passed it) never was outstanding.
      const applied = r.appliedAt && r.foundAt && r.appliedAt < r.foundAt ? null : r.appliedAt;
      return { ...r, appliedAt: applied, appliedBy: applied ? r.appliedBy : null, preexisting,
        foundLagDays: preexisting ? null : days(r.publishedAt, r.foundAt),
        applyLagDays: applied ? days(r.publishedAt, applied) : null,
        openDays: applied ? null : days(r.publishedAt, now) };
    }).filter((r) => r.type).sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : cmpVersion(b.version, a.version)));

    const series = g.audits.map((a) => {
      const row = { at: a.at, commit: a.commit ?? null, held: 0 };
      for (const t of TYPES) row[t] = 0;
      for (const d of a.deps || []) {
        if (d.skipped) continue;
        for (const t of TYPES) if ((d.updates || []).some((u) => u.type === t)) row[t]++;
        if ((d.held || []).length) row.held++;
      }
      return row;
    });
    out.push({ repo: g.repo, pkgPath: g.pkgPath, label: labelOf(g.repo, g.pkgPath), audits: g.audits.length, firstAudit,
      lastAudit: g.audits.at(-1)?.at ?? null, proposals: g.proposed.length, merges: g.merged.length, refused: g.refused, superseded: g.superseded,
      series, lifecycle, headline: headline(lifecycle, { nowMs, within }) });
  }
  out.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const all = out.flatMap((g) => g.lifecycle);
  return { generatedAt: now, projects: out, headline: headline(all, { nowMs, within }), fleetSeries: fleetSeries(out), within };
}

function labelOf(repo, pkgPath) {
  const base = String(repo).split(/[\\/]/).filter(Boolean).pop() || repo;
  return pkgPath && pkgPath !== '.' ? `${base}/${pkgPath}` : base;
}

/**
 * The numbers a reader checks first. A release already out at the project's first audit is the
 * BACKLOG the audit inherited: it is counted apart and kept out of every lag, because its "time to
 * apply" measures how long nobody was watching. `patchWithin[n]` counts only watched releases at
 * least n days old: a younger one has not had n days.
 */
export function headline(lifecycle, { nowMs = Date.now(), within = [7, 30] } = {}) {
  const backlog = lifecycle.filter((r) => r.preexisting);
  lifecycle = lifecycle.filter((r) => !r.preexisting);
  const applied = lifecycle.filter((r) => r.appliedAt);
  const open = lifecycle.filter((r) => !r.appliedAt && r.eligibleAt);
  const byType = Object.fromEntries(TYPES.map((t) => [t, median(applied.filter((r) => r.type === t).map((r) => r.applyLagDays))]));
  const withinDays = {};
  for (const n of within) {
    const pop = lifecycle.filter((r) => r.type === 'patch' && r.publishedAt && Date.parse(r.publishedAt) <= nowMs - n * DAY_MS);
    withinDays[n] = { applied: pop.filter((r) => r.applyLagDays !== null && r.applyLagDays <= n).length, of: pop.length };
  }
  const oldestOpen = open.reduce((m, r) => (m === null || (r.openDays ?? 0) > m.openDays ? r : m), null);
  return {
    releases: lifecycle.length, applied: applied.length, open: open.length, held: lifecycle.filter((r) => !r.appliedAt && !r.eligibleAt).length,
    medianFindDays: median(lifecycle.map((r) => r.foundLagDays)),
    medianApplyDays: median(applied.map((r) => r.applyLagDays)),
    medianApplyDaysByType: byType,
    patchWithin: withinDays,
    oldestOpen: oldestOpen ? { name: oldestOpen.name, version: oldestOpen.version, type: oldestOpen.type, days: oldestOpen.openDays } : null,
    byMerge: applied.filter((r) => r.appliedBy === 'merge').length,
    byObserved: applied.filter((r) => r.appliedBy === 'observed').length,
    backlog: { releases: backlog.length, applied: backlog.filter((r) => r.appliedAt).length, open: backlog.filter((r) => !r.appliedAt && r.eligibleAt).length },
  };
}

/** Fleet totals as a step function: at each audit time, every project's latest audit at or before it. */
function fleetSeries(projects) {
  const times = [...new Set(projects.flatMap((p) => p.series.map((s) => s.at)))].sort();
  return times.map((t) => {
    const row = { at: t, patch: 0, minor: 0, major: 0, projects: 0 };
    for (const p of projects) {
      const last = p.series.filter((s) => s.at <= t).at(-1);
      if (!last) continue;
      row.projects++;
      for (const k of TYPES) row[k] += last[k];
    }
    return row;
  });
}

// ── rendering ───────────────────────────────────────────────────────────────────────────────────
// Series colours are data (docs/THEME.md): the first three categorical slots of the dataviz
// reference palette, validated all-pairs in both modes against these surfaces. Ground, ink, lines
// and text come from the house tokens.
const SERIES = { patch: ['#2a78d6', '#3987e5'], minor: ['#eb6834', '#d95926'], major: ['#1baf7a', '#199e70'] };
const fmtDays = (d) => (d === null || d === undefined ? '—' : d < 1 ? `${Math.round(d * 24)} h` : `${d < 10 ? d.toFixed(1) : Math.round(d)} d`);
const fmtDate = (iso) => (iso ? iso.slice(0, 10) : '—');

function niceMax(v) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 1.5, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

function lineChart(series, { w = 1040, h = 280 } = {}) {
  if (series.length < 2) return '<p class="note">Two audits or more are needed for a trend; the table below has every reading.</p>';
  const pad = { l: 40, r: 130, t: 12, b: 28 };
  const t0 = Date.parse(series[0].at);
  const t1 = Date.parse(series.at(-1).at);
  const ymax = niceMax(Math.max(1, ...series.flatMap((s) => TYPES.map((k) => s[k]))));
  const x = (at) => pad.l + ((Date.parse(at) - t0) / Math.max(1, t1 - t0)) * (w - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v / ymax) * (h - pad.t - pad.b);
  const ticks = [0, Math.round(ymax / 2), ymax].map((v) => `<line class="grid" x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const xt = [series[0].at, series.at(-1).at].map((at, i) => `<text class="tick" x="${x(at)}" y="${h - 8}" text-anchor="${i ? 'end' : 'start'}">${fmtDate(at)}</text>`).join('');
  const last = series.at(-1);
  const lines = TYPES.map((k) => {
    // Steps, not slopes: a count holds until the next audit reads it.
    const d = series.map((s, i) => `${i ? `H${x(s.at).toFixed(1)}V` : `M${x(s.at).toFixed(1)},`}${y(s[k]).toFixed(1)}`).join('');
    return `<path class="ln s-${k}" d="${d}"/><circle class="dot s-${k}" cx="${x(last.at)}" cy="${y(last[k])}" r="4"/>`;
  }).join('');
  // End labels that would collide merge into one line rather than stack away from their marks.
  const ends = TYPES.map((k) => ({ y: y(last[k]), text: `${k} ${last[k]}` })).sort((a, b) => a.y - b.y);
  const merged = [];
  for (const e of ends) {
    const g = merged.at(-1);
    if (g && e.y - g.y1 < 14) { g.text += ` · ${e.text}`; g.y1 = e.y; g.ys.push(e.y); } else merged.push({ text: e.text, y1: e.y, ys: [e.y] });
  }
  const labels = merged.map((g) => `<text class="lbl" x="${x(last.at) + 10}" y="${(g.ys.reduce((a, b) => a + b, 0) / g.ys.length + 4).toFixed(1)}">${g.text}</text>`).join('');
  return `<svg class="chart" id="behind" viewBox="0 0 ${w} ${h}" role="img" aria-label="Direct dependencies with an eligible update, by type, over time">${ticks}${xt}${lines}${labels}<line class="xhair" x1="0" x2="0" y1="${pad.t}" y2="${h - pad.b}" visibility="hidden"/><rect class="hit" x="${pad.l}" y="${pad.t}" width="${w - pad.l - pad.r}" height="${h - pad.t - pad.b}" data-x0="${pad.l}" data-x1="${w - pad.r}"/></svg>`;
}

function scatter(lifecycle, { w = 1040, h = 320, cap = 60, cooldown = 7 } = {}) {
  const pts = lifecycle.filter((r) => r.publishedAt && (r.applyLagDays !== null || r.openDays !== null));
  if (!pts.length) return '<p class="note">No release has been found yet.</p>';
  const pad = { l: 40, r: 16, t: 12, b: 28 };
  const ts = pts.map((r) => Date.parse(r.publishedAt));
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts, t0 + DAY_MS);
  const x = (iso) => pad.l + ((Date.parse(iso) - t0) / (t1 - t0)) * (w - pad.l - pad.r);
  const y = (d) => pad.t + (1 - Math.min(d, cap) / cap) * (h - pad.t - pad.b);
  const grid = [0, cooldown, 30, cap].filter((v, i, a) => v <= cap && a.indexOf(v) === i)
    .map((v) => `<line class="grid${v === cooldown ? ' ref' : ''}" x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}${v === cap ? '+' : ''}</text>`).join('')
    + `<text class="tick" x="${pad.l + 4}" y="${y(cooldown) - 4}">cooldown ${cooldown} d</text>`;
  const xt = [t0, t1].map((t, i) => `<text class="tick" x="${i ? w - pad.r : pad.l}" y="${h - 8}" text-anchor="${i ? 'end' : 'start'}">${fmtDate(new Date(t).toISOString())}</text>`).join('');
  const dots = pts.map((r, i) => {
    const open = r.applyLagDays === null;
    const d = open ? r.openDays : r.applyLagDays;
    const cx = x(r.publishedAt).toFixed(1);
    const cy = y(d).toFixed(1);
    return `<g class="pt" tabindex="0" data-i="${i}" aria-label="${esc(`${r.name} ${r.version} (${r.type}): ${open ? `open ${fmtDays(d)}` : `applied after ${fmtDays(d)}`}`)}"><circle class="hitpt" cx="${cx}" cy="${cy}" r="12"/><circle class="dot s-${r.type}${open ? ' open' : ''}" cx="${cx}" cy="${cy}" r="4.5"/></g>`;
  }).join('');
  return { svg: `<svg class="chart" id="lag" viewBox="0 0 ${w} ${h}" role="img" aria-label="Days from each release to applied, open releases hollow">${grid}${xt}${dots}</svg>`, pts };
}

const legend = ({ open = false } = {}) => `<div class="legend">${TYPES.map((k) => `<span><i class="key s-${k}"></i>${k}</span>`).join('')}${open ? '<span><i class="key open-key"></i>open (not applied yet)</span>' : ''}</div>`;

export function renderHistoryHtml(h, { cooldown = 7 } = {}) {
  const hl = h.headline;
  const tile = (label, value, note = '') => `<div class="tile"><div class="tl">${esc(label)}</div><div class="tv">${esc(value)}</div>${note ? `<div class="tn">${esc(note)}</div>` : ''}</div>`;
  const pw = (n) => (hl.patchWithin[n].of ? `${hl.patchWithin[n].applied} of ${hl.patchWithin[n].of}` : '—');
  const all = h.projects.flatMap((p) => p.lifecycle.map((r) => ({ ...r, project: p.label })));
  const sc = scatter(all, { cooldown });
  const tableRows = all.map((r) => `<tr><td>${esc(r.project)}</td><td class="mono">${esc(r.name)}</td><td class="mono">${esc(r.version)}</td><td><i class="key s-${esc(r.type)}"></i>${esc(r.type)}</td>`
    + `<td>${fmtDate(r.publishedAt)}</td><td>${fmtDate(r.foundAt)}${r.preexisting ? ' <span class="note">(before the first audit)</span>' : r.foundLagDays !== null ? ` <span class="note">+${fmtDays(r.foundLagDays)}</span>` : ''}</td>`
    + `<td>${fmtDate(r.proposedAt)}</td><td>${r.appliedAt ? `${fmtDate(r.appliedAt)} <span class="note">+${fmtDays(r.applyLagDays)} · ${esc(r.appliedBy)}</span>` : r.eligibleAt ? `<b>open</b> <span class="note">${fmtDays(r.openDays)}</span>` : '<span class="note">held by cooldown</span>'}</td></tr>`).join('');
  const projRows = h.projects.map((p) => {
    const last = p.series.at(-1) || {};
    return `<tr><td>${esc(p.label)}</td><td>${fmtDate(p.lastAudit)}</td><td>${p.audits}</td><td>${last.patch ?? '—'}</td><td>${last.minor ?? '—'}</td><td>${last.major ?? '—'}</td>`
      + `<td>${p.headline.open}${p.headline.oldestOpen ? ` <span class="note">oldest ${fmtDays(p.headline.oldestOpen.days)}</span>` : ''}</td><td>${fmtDays(p.headline.medianApplyDays)}</td><td>${p.proposals} · ${p.merges}${p.refused ? ` · ${p.refused} refused` : ''}</td></tr>`;
  }).join('');
  const data = JSON.stringify({ series: h.fleetSeries, pts: sc.pts ? sc.pts.map((r) => ({ name: r.name, version: r.version, type: r.type, project: r.project, publishedAt: r.publishedAt, applied: r.appliedAt, by: r.appliedBy, lag: r.applyLagDays, open: r.openDays })) : [] }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dependency updates — how closely releases are found and applied</title>
${MARK_ICON}
${followerScript()}
<style>
${houseCss({ fonts: 'inline', weights: { sans: [400, 600], mono: [400] } })}
 :root{--s-patch:${SERIES.patch[0]};--s-minor:${SERIES.minor[0]};--s-major:${SERIES.major[0]}}
 html[data-mode=dark]{--s-patch:${SERIES.patch[1]};--s-minor:${SERIES.minor[1]};--s-major:${SERIES.major[1]}}
 @media (prefers-color-scheme:dark){html:not([data-mode]){--s-patch:${SERIES.patch[1]};--s-minor:${SERIES.minor[1]};--s-major:${SERIES.major[1]}}}
 body{font-size:.875rem;line-height:1.5} .b{max-width:72rem;margin:0 auto;padding:2rem 1.5rem 4rem;position:relative}
 h1{font-size:1.5rem;margin:0 0 .25rem} h2{font-size:1rem;margin:2rem 0 .5rem} .note,.stamp{color:var(--mut);font-size:.75rem}
 .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:.75rem;margin:1rem 0}
 .tile{background:var(--panel);border:1px solid var(--line);border-radius:.375rem;padding:.75rem}
 .tl{color:var(--mut);font-size:.75rem} .tv{font-size:1.5rem;font-weight:600} .tn{color:var(--mut);font-size:.72rem}
 .card{background:var(--panel);border:1px solid var(--line);border-radius:.375rem;padding:.75rem;margin:.5rem 0}
 .chart{width:100%;height:auto;display:block} .grid{stroke:var(--line);stroke-width:1} .grid.ref{stroke:var(--line2)}
 .tick,.lbl{fill:var(--mut);font-size:11px;font-family:var(--sans)} .lbl{fill:var(--ink)}
 .ln{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round} .ln.s-patch{stroke:var(--s-patch)} .ln.s-minor{stroke:var(--s-minor)} .ln.s-major{stroke:var(--s-major)}
 .dot{stroke:var(--panel);stroke-width:2} .dot.s-patch{fill:var(--s-patch)} .dot.s-minor{fill:var(--s-minor)} .dot.s-major{fill:var(--s-major)}
 .dot.open{fill:var(--panel);stroke-width:2} .dot.open.s-patch{stroke:var(--s-patch)} .dot.open.s-minor{stroke:var(--s-minor)} .dot.open.s-major{stroke:var(--s-major)}
 .hit,.hitpt{fill:transparent} .pt{cursor:default;outline:none} .pt:focus .dot,.pt:hover .dot{stroke:var(--ink)} .xhair{stroke:var(--mut);stroke-width:1}
 .legend{display:flex;gap:1rem;flex-wrap:wrap;color:var(--mut);font-size:.75rem;margin:.25rem 0}
 .key{display:inline-block;width:.75rem;height:.2rem;border-radius:.1rem;margin-right:.35rem;vertical-align:middle;background:var(--mut)}
 .key.s-patch{background:var(--s-patch)} .key.s-minor{background:var(--s-minor)} .key.s-major{background:var(--s-major)} .key.open-key{background:none;border:2px solid var(--mut);width:.55rem;height:.55rem;border-radius:50%}
 table{border-collapse:collapse;width:100%;margin:.25rem 0} th,td{text-align:left;padding:.3rem .5rem;border-bottom:1px solid var(--line);vertical-align:top;font-variant-numeric:tabular-nums}
 .mono{font-family:var(--mono);font-size:.78rem}
 #tip{position:absolute;pointer-events:none;background:var(--panel2);border:1px solid var(--line);border-radius:.25rem;padding:.35rem .5rem;font-size:.75rem;display:none;z-index:2}
 #tip b{display:block;font-size:.875rem}
</style></head><body><div class="b">
<h1>Dependency updates</h1>
<p class="stamp">How closely new releases of direct npm dependencies are found and applied · ${h.projects.length} project${h.projects.length === 1 ? '' : 's'} · generated ${esc(h.generatedAt)}</p>
<div class="tiles">
${tile('Median days from release to applied', fmtDays(hl.medianApplyDays), `patch ${fmtDays(hl.medianApplyDaysByType.patch)} · minor ${fmtDays(hl.medianApplyDaysByType.minor)} · major ${fmtDays(hl.medianApplyDaysByType.major)}`)}
${h.within.map((n) => tile(`Patch releases applied within ${n} days`, pw(n), `of patch releases at least ${n} days old${n === h.within[0] ? ` · each is held ${cooldown} d by the cooldown first` : ''}`)).join('\n')}
${tile('Median days from release to found', fmtDays(hl.medianFindDays), 'releases out before the first audit are excluded')}
${tile('Open: eligible, not applied', String(hl.open), hl.oldestOpen ? `oldest ${hl.oldestOpen.name} ${hl.oldestOpen.version}, ${fmtDays(hl.oldestOpen.days)}` : 'none')}
${tile('Applied', String(hl.applied), `${hl.byMerge} by a commitwork merge · ${hl.byObserved} seen in a later audit`)}
${tile('Backlog at the first audit', `${hl.backlog.applied} of ${hl.backlog.releases} applied`, `releases already out when watching began; ${hl.backlog.open} still open. Not counted in the lags above`)}
</div>
<h2>Direct dependencies behind, over time</h2>
<p class="note">At each audit, how many direct dependencies had an eligible update of each type (outside its cooldown). Fleet total across projects.</p>
<div class="card">${legend()}${lineChart(h.fleetSeries)}</div>
<h2>Days from release to applied</h2>
<p class="note">Each release an audit found, placed by its publish date. Filled: applied, at the days it took. Hollow: still open, at its age now. Values over 60 days sit on the top line; the table has them exactly.</p>
<div class="card">${legend({ open: true })}${sc.svg || sc}</div>
<h2>Projects</h2>
<table><thead><tr><th>Project</th><th>Last audit</th><th>Audits</th><th>Patch</th><th>Minor</th><th>Major</th><th>Open</th><th>Median to apply</th><th>Proposed · merged</th></tr></thead><tbody>${projRows || '<tr><td colspan="9">No audit recorded.</td></tr>'}</tbody></table>
<h2>Release lifecycle</h2>
<table><thead><tr><th>Project</th><th>Package</th><th>Version</th><th>Type</th><th>Published</th><th>Found</th><th>Proposed</th><th>Applied</th></tr></thead><tbody>${tableRows || '<tr><td colspan="8">No release found yet.</td></tr>'}</tbody></table>
<div id="tip" role="status"></div>
<script type="application/json" id="cw-data">${data}</script>
<script>
(function(){
  var D=JSON.parse(document.getElementById('cw-data').textContent),tip=document.getElementById('tip'),root=document.querySelector('.b');
  function show(e,lines){tip.textContent='';lines.forEach(function(l,i){var el=document.createElement(i?'div':'b');el.textContent=l;tip.appendChild(el);});var r=root.getBoundingClientRect();tip.style.display='block';tip.style.left=(e.clientX-r.left+12)+'px';tip.style.top=(e.clientY-r.top+12)+'px';}
  function hide(){tip.style.display='none';}
  function days(d){return d==null?'—':d<1?Math.round(d*24)+' h':(d<10?d.toFixed(1):Math.round(d))+' d';}
  document.querySelectorAll('#lag .pt').forEach(function(g){var p=D.pts[+g.dataset.i];var lines=[p.applied?'applied after '+days(p.lag):'open for '+days(p.open),p.name+' '+p.version+' · '+p.type,p.project,'published '+String(p.publishedAt).slice(0,10)+(p.applied?' · '+p.by:'')];
    g.addEventListener('pointermove',function(e){show(e,lines);});g.addEventListener('pointerleave',hide);
    g.addEventListener('focus',function(){var b=g.getBoundingClientRect();show({clientX:b.right,clientY:b.top},lines);});g.addEventListener('blur',hide);});
  var svg=document.getElementById('behind');if(svg&&D.series.length>1){var hit=svg.querySelector('.hit'),xh=svg.querySelector('.xhair');var x0=+hit.dataset.x0,x1=+hit.dataset.x1,t0=Date.parse(D.series[0].at),t1=Date.parse(D.series[D.series.length-1].at);
    hit.addEventListener('pointermove',function(e){var b=svg.getBoundingClientRect(),vx=(e.clientX-b.left)*svg.viewBox.baseVal.width/b.width;var t=t0+(vx-x0)/(x1-x0)*(t1-t0),s=D.series[0];D.series.forEach(function(r){if(Date.parse(r.at)<=t)s=r;});var sx=x0+(Date.parse(s.at)-t0)/Math.max(1,t1-t0)*(x1-x0);xh.setAttribute('x1',sx);xh.setAttribute('x2',sx);xh.setAttribute('visibility','visible');
      show(e,[String(s.at).slice(0,10),'patch '+s.patch+' · minor '+s.minor+' · major '+s.major,s.projects+' project(s) audited']);});
    hit.addEventListener('pointerleave',function(){xh.setAttribute('visibility','hidden');hide();});}
})();
</script>
</div></body></html>
`;
}
