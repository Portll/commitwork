// bin/lib/brief.mjs — the remediation brief for one scan run: dependency fixes ranked KEV first, then
// the other security findings, then every lane that did not measure. Pure over its inputs: the caller
// supplies the scan's cells, the KEV catalogue and the EPSS scores, so one run gives one brief.
import { join } from 'node:path';
import { repoDepFindings, enrichKevEpss } from '../../monitor/dep-findings.mjs';
import { SCANNER_SPECS, SCANNER_LABELS, TOTALS_EXCLUDE, kindOf } from '../../monitor/extractors.mjs';
import { esc } from '../../lib/html-escape.mjs';
import { houseCss } from '../../lib/house-css.mjs';
import { followerScript } from '../../lib/theme-follower.mjs';

export const BRIEF_VERSION = 1;
const SEV_RANK = { crit: 4, high: 3, med: 2, low: 1, unknown: 0 };
const ISSUE_KINDS = new Set(['vulnerability', 'posture', 'integrity']);
const NOT_SUMMED = new Set(TOTALS_EXCLUDE);
const ROWS_PER_ISSUE = 5;
const COUNT_ORDER = ['crit', 'high', 'med', 'low', 'undetermined'];
const rankOf = (s) => SEV_RANK[s] ?? 0;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const worstOf = (sevs) => sevs.reduce((w, s) => (rankOf(s) > rankOf(w) ? s : w), 'unknown');
const maxNum = (xs) => xs.reduce((m, x) => (typeof x === 'number' && (m === null || x > m) ? x : m), null);

// In-source suppressions (nosemgrep and the like) are kept out of the extractor's rows and counted
// in its `suppressed` field; the brief states that count and does not list them.

function dependencyActions(repos) {
  const groups = new Map();
  for (const r of repos) {
    for (const f of r.findings) {
      if (f.undetermined) continue;
      const key = [r.name, f.package, f.version, f.path].join('\0');
      if (!groups.has(key)) groups.set(key, { repo: r.name, package: f.package, version: f.version, path: f.path, findings: [] });
      groups.get(key).findings.push(f);
    }
  }
  return [...groups.values()].map((g) => {
    const findings = g.findings.map((f) => ({ id: f.id, severity: f.severity, cvss: f.cvss || 0, kev: f.kev ?? null, epss: f.epss ?? null,
      title: f.title || '', advisory: f.advisory || '', tool: f.tool, fixed: f.fixed || '', malicious: !!f.malicious }))
      .sort((a, b) => (b.kev === true) - (a.kev === true) || rankOf(b.severity) - rankOf(a.severity) || (b.epss ?? -1) - (a.epss ?? -1) || cmp(a.id, b.id));
    const fixes = [...new Set(findings.map((f) => f.fixed).filter(Boolean))].sort();
    return { repo: g.repo, package: g.package, version: g.version, path: g.path, fix: fixes.join(' or '),
      kev: findings.filter((f) => f.kev === true).length, worst: worstOf(findings.map((f) => f.severity)),
      epss: maxNum(findings.map((f) => f.epss)), cvss: maxNum(findings.map((f) => f.cvss)) || 0, findings };
  }).sort((a, b) => b.kev - a.kev || rankOf(b.worst) - rankOf(a.worst) || (b.epss ?? -1) - (a.epss ?? -1) || b.cvss - a.cvss
    || cmp(a.repo, b.repo) || cmp(a.package, b.package) || cmp(a.version, b.version) || cmp(a.path, b.path));
}

/**
 * runDir: the scan's output directory, one subdirectory per repo (slug).
 * rows: [{ repo, slug, commit?, cells: { checkId: { sev, summary, coverage?, coverageReason? } } }].
 * kev: loadKevCatalog(); epss: loadEpssScores().
 */
export function buildBrief({ runDir, rows, kev, epss, generatedAt, target = null }) {
  const repos = [];
  const issues = [];
  const notMeasured = [];
  const undetermined = [];
  let suppressedTotal = 0;
  for (const row of [...rows].sort((a, b) => cmp(a.slug, b.slug))) {
    const dir = join(runDir, row.slug);
    const name = row.slug;
    const { findings, state } = repoDepFindings(dir);
    enrichKevEpss(findings, kev, epss);
    const osvCell = row.cells['deps-osv'];
    repos.push({ name, path: row.repo, commit: row.commit || null, findings, depState: state,
      depsMeasured: !!osvCell && (osvCell.sev === 'ok' || osvCell.sev === 'med' || osvCell.sev === 'high') });
    for (const f of findings) if (f.undetermined) undetermined.push({ repo: name, id: f.id, package: f.package, version: f.version, claimed: f.claimedSeverity || null, reason: f.undeterminedReason || f.unknownReason || '' });
    for (const [checkId, cell] of Object.entries(row.cells).sort(([a], [b]) => cmp(a, b))) {
      if (cell.sev === 'noscan') notMeasured.push({ repo: name, check: checkId, kind: 'void', reason: cell.summary || '' });
      else if (cell.coverage === 'reduced') notMeasured.push({ repo: name, check: checkId, kind: 'degraded', reason: cell.coverageReason || '' });
    }
    for (const [key, checkId, fn] of SCANNER_SPECS) {
      if (NOT_SUMMED.has(key) || !ISSUE_KINDS.has(kindOf(key))) continue;
      const cell = row.cells[checkId];
      if (!cell || cell.sev === 'skip' || cell.sev === 'noscan') continue;
      let c;
      try { c = fn(dir); } catch { c = null; }
      const suppressed = (c && c.suppressed && c.suppressed.total) || 0;
      suppressedTotal += suppressed;
      if (!c || !Array.isArray(c.findings) || !c.findings.length) continue;
      const open = c.findings;
      const counts = { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 };
      for (const r of open) counts[r.sev in SEV_RANK && r.sev !== 'unknown' ? r.sev : 'undetermined']++;
      const top = [...open].sort((a, b) => rankOf(b.sev) - rankOf(a.sev) || cmp(String(a.file || ''), String(b.file || '')) || (Number(a.line) || 0) - (Number(b.line) || 0) || cmp(String(a.rule || ''), String(b.rule || '')))
        .slice(0, ROWS_PER_ISSUE).map((r) => ({ sev: r.sev in SEV_RANK && r.sev !== 'unknown' ? r.sev : 'undetermined', rule: r.rule || r.id || r.detector || '', file: r.file || r.path || '', line: Number(r.line) || 0, message: r.message || r.title || r.verificationError || '' }));
      issues.push({ repo: name, category: key, label: SCANNER_LABELS[key] || key, check: checkId, kind: kindOf(key),
        worst: worstOf(open.map((r) => r.sev)), open: open.length, suppressed, truncated: c.truncated || 0, counts, top });
    }
  }
  issues.sort((a, b) => rankOf(b.worst) - rankOf(a.worst) || b.counts.crit - a.counts.crit || b.counts.high - a.counts.high || b.open - a.open || cmp(a.repo, b.repo) || cmp(a.category, b.category));
  const actions = dependencyActions(repos);
  const cves = repos.flatMap((r) => r.findings.filter((f) => !f.undetermined));
  return {
    version: BRIEF_VERSION,
    generatedAt,
    target,
    repos: repos.map((r) => ({ name: r.name, path: r.path, commit: r.commit, depsMeasured: r.depsMeasured, depState: r.depState })),
    enrichment: {
      kev: kev.usable ? { consulted: true, catalogVersion: kev.freshness.catalogVersion, freshness: kev.freshness.state, ageDays: kev.freshness.ageDays }
        : { consulted: false, reason: 'the KEV catalogue could not be read; every kev field is null, not false' },
      epss: { scored: cves.filter((f) => typeof f.epss === 'number').length, of: cves.length },
    },
    counts: { repos: repos.length, actions: actions.length, kevActions: actions.filter((a) => a.kev).length, advisories: cves.length,
      kev: cves.filter((f) => f.kev === true).length, issues: issues.length, suppressed: suppressedTotal, undetermined: undetermined.length,
      notMeasured: notMeasured.length },
    actions,
    undetermined: undetermined.sort((a, b) => cmp(a.repo, b.repo) || cmp(a.id, b.id) || cmp(a.package, b.package)),
    issues,
    notMeasured,
  };
}

const actionLine = (a) => {
  const ids = a.findings.map((f) => f.id + (f.kev ? ' (KEV)' : '')).join(', ');
  const tags = [a.kev ? `KEV ×${a.kev}` : '', a.worst, a.epss !== null ? `EPSS ${a.epss.toFixed(2)}` : ''].filter(Boolean).join(' · ');
  const what = `${a.package}${a.version ? `@${a.version}` : ''}${a.fix ? ` → ${a.fix}` : ' (no fixed version published)'}`;
  return { what, tags, ids };
};
const kevLine = (b) => (b.enrichment.kev.consulted
  ? `KEV catalogue ${b.enrichment.kev.catalogVersion} (${b.enrichment.kev.freshness})`
  : `KEV not consulted: ${b.enrichment.kev.reason}`) + ` · EPSS for ${b.enrichment.epss.scored} of ${b.enrichment.epss.of} advisories`;
const depsNote = (b) => {
  const unmeasured = b.repos.filter((r) => !r.depsMeasured).map((r) => r.name);
  return unmeasured.length ? `Dependency advisories were not measured in ${unmeasured.join(', ')}; see "Not measured".` : '';
};

/** Plain text for a terminal: the first `limit` of each list. */
export function renderBriefText(b, { limit = 10 } = {}) {
  const out = [`Remediation brief · ${b.counts.repos} repo${b.counts.repos === 1 ? '' : 's'} · ${b.generatedAt}`, kevLine(b), ''];
  out.push(`1. Dependency fixes, CVE/KEV first (${b.counts.actions}; ${b.counts.kev} KEV advisor${b.counts.kev === 1 ? 'y' : 'ies'})`);
  if (!b.actions.length) out.push('   none found where dependency advisories were measured');
  b.actions.slice(0, limit).forEach((a, i) => { const l = actionLine(a); out.push(`   ${i + 1}) ${a.repo}: ${l.what}  [${l.tags}]`, `      ${l.ids}`); });
  if (b.actions.length > limit) out.push(`   … ${b.actions.length - limit} more in brief.md`);
  if (b.undetermined.length) out.push(`   ${b.undetermined.length} advisor${b.undetermined.length === 1 ? 'y' : 'ies'} undetermined (version not declared, or not reachable); listed in brief.md, not counted`);
  const dn = depsNote(b); if (dn) out.push(`   ${dn}`);
  out.push('', `2. Other security findings (${b.counts.issues} lane${b.counts.issues === 1 ? '' : 's'} with open findings${b.counts.suppressed ? `; ${b.counts.suppressed} suppressed in source, not listed` : ''})`);
  if (!b.issues.length) out.push('   none open');
  b.issues.slice(0, limit).forEach((s, i) => {
    const c = COUNT_ORDER.filter((k) => s.counts[k]).map((k) => `${k} ${s.counts[k]}`).join(' · ');
    out.push(`   ${i + 1}) ${s.repo}: ${s.label}  [${c}]`);
    const t = s.top[0]; if (t) out.push(`      e.g. ${t.rule}${t.file ? ` ${t.file}${t.line ? `:${t.line}` : ''}` : ''}`);
  });
  if (b.issues.length > limit) out.push(`   … ${b.issues.length - limit} more in brief.md`);
  out.push('', `3. Not measured (${b.counts.notMeasured}): a lane that did not run is not a pass`);
  b.notMeasured.slice(0, limit).forEach((n) => out.push(`   ${n.repo}: ${n.check} (${n.kind}) ${n.reason}`.trimEnd()));
  if (b.notMeasured.length > limit) out.push(`   … ${b.notMeasured.length - limit} more in brief.md`);
  return `${out.join('\n')}\n`;
}

// Backslash first: a `\` before a `|` in a scanned message would otherwise turn the escaped pipe back into a cell break.
const mdCell = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function renderBriefMarkdown(b) {
  const out = [`# Remediation brief`, '', `${b.counts.repos} repo${b.counts.repos === 1 ? '' : 's'} · generated ${b.generatedAt} · ${kevLine(b)}`, ''];
  out.push('| Repo | Path | Commit |', '|---|---|---|', ...b.repos.map((r) => `| ${mdCell(r.name)} | ${mdCell(r.path)} | ${mdCell(r.commit || '')} |`), '');
  out.push('## 1. Dependency fixes, CVE/KEV first', '');
  if (!b.actions.length) out.push('None found where dependency advisories were measured.', '');
  else out.push('| # | Repo | Upgrade | KEV | Worst | EPSS | Advisories |', '|---|---|---|---|---|---|---|',
    ...b.actions.map((a, i) => { const l = actionLine(a); return `| ${i + 1} | ${mdCell(a.repo)} | ${mdCell(l.what)} | ${a.kev || ''} | ${a.worst} | ${a.epss !== null ? a.epss.toFixed(2) : ''} | ${mdCell(l.ids)} |`; }), '');
  const dn = depsNote(b); if (dn) out.push(dn, '');
  if (b.undetermined.length) {
    out.push('### Undetermined (not counted)', '', '| Repo | Advisory | Package | Claimed | Why |', '|---|---|---|---|---|',
      ...b.undetermined.map((u) => `| ${mdCell(u.repo)} | ${mdCell(u.id)} | ${mdCell(`${u.package}${u.version ? `@${u.version}` : ''}`)} | ${mdCell(u.claimed || '')} | ${mdCell(u.reason)} |`), '');
  }
  out.push('## 2. Other security findings', '');
  if (b.counts.suppressed) out.push(`${b.counts.suppressed} finding${b.counts.suppressed === 1 ? ' is' : 's are'} suppressed in source and not listed.`, '');
  if (!b.issues.length) out.push('None open.', '');
  for (const s of b.issues) {
    const c = COUNT_ORDER.filter((k) => s.counts[k]).map((k) => `${k} ${s.counts[k]}`).join(' · ');
    out.push(`### ${mdCell(s.repo)}: ${mdCell(s.label)} (${c})`, '', '| Severity | Rule | Location | Message |', '|---|---|---|---|',
      ...s.top.map((t) => `| ${t.sev} | ${mdCell(t.rule)} | ${mdCell(t.file ? `${t.file}${t.line ? `:${t.line}` : ''}` : '')} | ${mdCell(t.message)} |`));
    if (s.open > s.top.length) out.push('', `${s.open - s.top.length} more in the lane's report.`);
    out.push('');
  }
  out.push('## 3. Not measured', '', 'A lane that did not run, or ran without seeing everything, is not a pass.', '');
  if (!b.notMeasured.length) out.push('Every in-scope lane ran.', '');
  else out.push('| Repo | Check | Kind | Reason |', '|---|---|---|---|', ...b.notMeasured.map((n) => `| ${mdCell(n.repo)} | ${mdCell(n.check)} | ${n.kind} | ${mdCell(n.reason)} |`), '');
  return out.join('\n');
}

export function renderBriefHtml(b) {
  const sevChip = (s) => `<span class="sev s-${esc(s)}">${esc(s)}</span>`;
  const loc = (t) => (t.file ? `${esc(t.file)}${t.line ? `:${t.line}` : ''}` : '');
  const dn = depsNote(b);
  const actions = b.actions.length
    ? `<table><thead><tr><th>#</th><th>Repo</th><th>Upgrade</th><th>KEV</th><th>Worst</th><th>EPSS</th><th>Advisories</th></tr></thead><tbody>${b.actions.map((a, i) => {
      const l = actionLine(a);
      return `<tr${a.kev ? ' class="kev"' : ''}><td>${i + 1}</td><td>${esc(a.repo)}</td><td class="mono">${esc(l.what)}</td><td>${a.kev || ''}</td><td>${sevChip(a.worst)}</td><td>${a.epss !== null ? a.epss.toFixed(2) : ''}</td><td class="mono">${a.findings.map((f) => (/^https?:\/\//i.test(f.advisory) ? `<a href="${esc(f.advisory)}">${esc(f.id)}</a>` : esc(f.id)) + (f.kev ? ' <strong>KEV</strong>' : '')).join(', ')}</td></tr>`;
    }).join('')}</tbody></table>`
    : '<p>None found where dependency advisories were measured.</p>';
  const undetermined = b.undetermined.length
    ? `<h3>Undetermined (not counted)</h3><table><thead><tr><th>Repo</th><th>Advisory</th><th>Package</th><th>Claimed</th><th>Why</th></tr></thead><tbody>${b.undetermined.map((u) => `<tr><td>${esc(u.repo)}</td><td class="mono">${esc(u.id)}</td><td class="mono">${esc(u.package)}${u.version ? `@${esc(u.version)}` : ''}</td><td>${esc(u.claimed || '')}</td><td>${esc(u.reason)}</td></tr>`).join('')}</tbody></table>`
    : '';
  const issues = b.issues.length
    ? b.issues.map((s) => `<div class="issue"><h3>${esc(s.repo)}: ${esc(s.label)} ${COUNT_ORDER.filter((k) => s.counts[k]).map((k) => `${sevChip(k)} ${s.counts[k]}`).join(' ')}</h3><table><tbody>${s.top.map((t) => `<tr><td>${sevChip(t.sev)}</td><td class="mono">${esc(t.rule)}</td><td class="mono">${loc(t)}</td><td>${esc(t.message)}</td></tr>`).join('')}</tbody></table>${s.open > s.top.length ? `<p class="note">${s.open - s.top.length} more in the lane's report.</p>` : ''}</div>`).join('')
    : '<p>None open.</p>';
  const notMeasured = b.notMeasured.length
    ? `<table><thead><tr><th>Repo</th><th>Check</th><th>Kind</th><th>Reason</th></tr></thead><tbody>${b.notMeasured.map((n) => `<tr><td>${esc(n.repo)}</td><td class="mono">${esc(n.check)}</td><td>${esc(n.kind)}</td><td>${esc(n.reason)}</td></tr>`).join('')}</tbody></table>`
    : '<p>Every in-scope lane ran.</p>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Remediation brief</title>
${followerScript()}
<style>
${houseCss({ fonts: 'inline', weights: { sans: [400, 600], mono: [400] } })}
 body{font-size:.875rem;line-height:1.5} .b{max-width:72rem;margin:0 auto;padding:2rem 1.5rem 4rem}
 h1{font-size:1.5rem;margin:0 0 .25rem} h2{font-size:1rem;margin:2rem 0 .5rem} h3{font-size:.875rem;margin:1.25rem 0 .375rem}
 .stamp,.note{color:var(--mut);font-size:.75rem} table{border-collapse:collapse;width:100%;margin:.25rem 0}
 th,td{text-align:left;padding:.3rem .5rem;border-bottom:1px solid var(--line);vertical-align:top} .mono{font-family:var(--mono);font-size:.78rem}
 tr.kev td{background:color-mix(in srgb,var(--sev) 9%,transparent)} .sev{font-size:.72rem;padding:0 .35rem;border-radius:.25rem;border:1px solid var(--line)}
 .s-crit{color:var(--crit)} .s-high{color:var(--high)} .s-med{color:var(--med)} .s-low{color:var(--low)} .s-undetermined,.s-unknown{color:var(--mut);border-style:dashed}
</style></head><body><div class="b">
<h1>Remediation brief</h1>
<p class="stamp">${b.counts.repos} repo${b.counts.repos === 1 ? '' : 's'} · generated ${esc(b.generatedAt)} · ${esc(kevLine(b))}</p>
<table><thead><tr><th>Repo</th><th>Path</th><th>Commit</th></tr></thead><tbody>${b.repos.map((r) => `<tr><td>${esc(r.name)}</td><td class="mono">${esc(r.path)}</td><td class="mono">${esc(r.commit || '')}</td></tr>`).join('')}</tbody></table>
<h2>1. Dependency fixes, CVE/KEV first</h2>
${actions}${dn ? `<p class="note">${esc(dn)}</p>` : ''}${undetermined}
<h2>2. Other security findings</h2>
${b.counts.suppressed ? `<p class="note">${b.counts.suppressed} suppressed in source, not listed.</p>` : ''}${issues}
<h2>3. Not measured</h2>
<p class="note">A lane that did not run, or ran without seeing everything, is not a pass.</p>
${notMeasured}
</div></body></html>
`;
}
