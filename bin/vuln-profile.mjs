#!/usr/bin/env node
// commitwork — render an area's rollup as a self-contained vulnerability profile.
//
// WHY THIS IS IN bin/ AND NOT A SCRATCH SCRIPT. It was written twice in /tmp and reaped twice, and
// the second time the delivered HTML silently went stale: it predated a lane that had since added
// 299 findings, so the artifact understated the fleet while looking finished. A generator that
// produces a deliverable is tooling, not scratch.
//
// WHAT IT REFUSES TO DO. Every number here distinguishes three states, never two: scanned-and-clean,
// affected, and NOT PROVEN EITHER WAY. A "percentage clean" that folds the third into the first is
// the headline this repo exists to refuse — on this corpus that band has been the majority, and
// collapsing it would have reported ~97% clean for something mostly unproven.
//
// usage: vuln-profile.mjs <rollup.json> <out.html> [batchDir] [beforeRollup.json]
//   batchDir       per-repo checks-status.json, so a coverage gap can NAME the lane and say whether
//                  a human can clear it (BLOCKED) or nobody can (a structural void)
//   beforeRollup   optional prior rollup; renders the delta a correction revealed

import { esc } from '../lib/html-escape.mjs';
import { houseCss } from '../lib/house-css.mjs';
import { followerScript } from '../lib/theme-follower.mjs';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
// writeAtomic, not a hand-rolled `${out}.tmp` + rename: a FIXED tmp name is shared by every process
// writing that file, so one renames what another is still filling. It pid-suffixes. Caught by the
// repo's own guard, which named this file twice.
import { writeAtomic } from '../monitor/lockfile.mjs';
import { SCANNER_CHECKS } from '../monitor/scanner-checks.mjs'; // category -> the check that produces it

const [IN, OUT, BATCH = null, BEFORE = null] = process.argv.slice(2);
if (!IN || !OUT) {
  console.error('usage: vuln-profile.mjs <rollup.json> <out.html> [batchDir] [beforeRollup.json]');
  process.exit(2);
}
const roll = JSON.parse(readFileSync(IN, 'utf8'));

// ── A CARRIED ROLLUP IS NOT A MEASUREMENT, AND MUST NOT BE CHARTED AS ONE ────────────────────
// `carried` means the COUNTS came forward from an earlier slice while the ROWS did not. The totals
// still look like totals; findings[] is empty; and every number derived from rows — CVE count, KEV
// count, per-repo severity — silently reads ZERO. Charting that publishes a clean bill of health
// for a corpus whose evidence is sitting on disk unread.
//
// Observed 2026-08-25: a re-roll of the 100randomrepos batch carried all 32 scanner categories and
// reported cves:0 / kev:0, while the batch's own osv.sarif files still held 10,068 advisory rows.
// An hour earlier the same batch charted 15 KEV. Nothing about the artifact says "do not quote me".
//
// So this refuses rather than warns. A warning at the top of an otherwise complete-looking chart is
// read once and screenshotted away; the numbers travel without it. Re-roll the batch and chart that.
const carried = roll.totals?.carried?.categories || [];
const rowsPresent = (roll.repos || []).some((r) => (r.findings || []).length > 0);
if (carried.length && !rowsPresent) {
  console.error(`REFUSING to render: this rollup is CARRIED across ${carried.length} scanner categories `
    + 'and holds no finding rows.\n'
    + '  Its totals came forward from an earlier slice; everything row-derived (CVEs, KEV, per-repo\n'
    + '  severity) would render as ZERO and read as clean. That is not what the batch contains.\n'
    + `  oldest carried from: ${roll.totals?.carried?.oldestCarriedFrom || 'unknown'}\n`
    + `  Re-roll first:  node monitor/rollup.mjs <batchDir>`);
  process.exit(3);
}
const SEVS = [['crit', 'Critical'], ['high', 'High'], ['med', 'Medium'], ['low', 'Low']];
const EXCLUDED = new Set(roll.totals?.excludedFromTotals || []);

// ── per-repo coverage gaps, and whether they have an owner ──────────────────────────────────
// The rollup carries a COUNT of unscanned lanes; a count cannot answer the question a reader has
// about an incomplete bar — incomplete in what respect, and can anyone fix it? Read the batch's own
// status files, which now distinguish a BLOCKED void (missing credential or tool, one human action
// away) from a structural one (no served HTML, no live URL — nobody can clear it).
const gaps = new Map();
if (BATCH && existsSync(BATCH)) {
  for (const d of readdirSync(BATCH)) {
    const f = `${BATCH}/${d}/checks-status.json`;
    if (!existsSync(f)) continue;
    try {
      const rows = JSON.parse(readFileSync(f, 'utf8'));
      const list = rows.filter((c) => c.status === 'noscan' || c.status === 'fail')
        .map((c) => ({ check: c.check, failed: c.status === 'fail', blocked: c.blocked === true }));
      if (list.length) gaps.set(d, list);
    } catch { /* a repo whose status file is unreadable contributes no detail, not a false zero */ }
  }
}

// TWO SOURCES DISAGREE ABOUT COVERAGE, AND UNIONING THEM WAS WRONG. The batch's own
// checks-status.json records 34 per-check outcomes; the rollup's `noscan` counts scanner CATEGORIES
// with ran:false. They are related but not the same set — measured 2026-08-25 on this corpus, 66
// repos by the first and 79 by the second, with 14 carrying a rollup noscan and no batch row. The
// first version took the union and published 80, a number neither record supports.
//
// checks-status is authoritative because it is the RUNNER'S OWN record of what it did, per check,
// at the time it ran; the scanner map is derived from it downstream. Where it is missing, coverage
// is UNKNOWN and says so — substituting the other source would be inventing agreement between two
// records that disagree, which is the same defect as a scanner substituting a default for a result.
const repos = (roll.repos || []).map((r) => {
  const sev = { crit: 0, high: 0, med: 0, low: 0 };
  for (const [key, s] of Object.entries(r.scanners || {})) {
    if (s.ran === false || EXCLUDED.has(key)) continue;
    for (const k of Object.keys(sev)) sev[k] += Number(s[k] || 0);
  }
  const findings = r.findings || [];
  const g = gaps.get(r.name) || [];
  return {
    name: r.name, sev, total: sev.crit + sev.high + sev.med + sev.low,
    gaps: g, blockedGaps: g.filter((x) => x.blocked),
    // `coverageKnown` is the honest third state: we have the runner's record, or we do not.
    coverageKnown: gaps.has(r.name) || (BATCH && existsSync(`${BATCH}/${r.name}/checks-status.json`)),
    rollupNoscan: Number(r.noscan || 0),
    kev: findings.filter((f) => f.kev).length,
    kevIds: [...new Set(findings.filter((f) => f.kev).map((f) => f.id))],
    cves: new Set(findings.map((f) => f.id).filter((x) => /^CVE-/.test(x || ''))).size,
  };
});

// THE THREE STATES. `unproven` is the honest middle and the reason this file exists: zero findings,
// but at least one lane produced no result, so the zero is unearned rather than clean.
const bands = SEVS.map(([k, label]) => {
  const affected = repos.filter((r) => r.sev[k] > 0).length;
  const rest = repos.filter((r) => r.sev[k] === 0);
  // Three ways to have no finding, and they are not the same claim: a gap we can name, coverage we
  // cannot vouch for, and a scan that genuinely covered everything.
  const unproven = rest.filter((r) => r.coverageKnown && r.gaps.length).length;
  const unknown = rest.filter((r) => !r.coverageKnown).length;
  return { key: k, label, affected, unproven, unknown,
    clean: rest.length - unproven - unknown, n: repos.length };
});

const totals = roll.totals || {};
const kevRepos = repos.filter((r) => r.kev > 0);
const kevTotal = repos.reduce((a, r) => a + r.kev, 0);
const anyFinding = repos.filter((r) => r.total > 0).length;
// THE CVE CLAIM IS NOT THE FINDING CLAIM, and conflating them is how a vulnerability profile
// overstates. A CVE/GHSA row comes from an advisory-database lookup against a resolved package
// version — the strongest evidence class here. A shellcheck diagnostic is a real finding and not a
// vulnerability. Measured on this corpus: 100 repos carry a finding, 61 carry a CVE, and shellLint
// alone is over half of all findings. Both numbers are published, separately and labelled.
const cveRepos = repos.filter((r) => r.cves > 0).length;
const cveRows = (roll.repos || []).reduce((a, r) =>
  a + (r.findings || []).filter((f) => /^(CVE|GHSA)-/.test(f.id || '')).length, 0);

// Composition, so a reader can see for themselves whether one lane is carrying the headline. This
// repo's own defect signature: one detector accounting for most of a bucket is a defect, not a
// fleet in crisis. Published rather than summarised — the share is the check.
const laneShare = new Map();
for (const r of roll.repos || []) {
  for (const [k, sc] of Object.entries(r.scanners || {})) {
    if (sc.ran === false || EXCLUDED.has(k)) continue;
    const t = (sc.crit || 0) + (sc.high || 0) + (sc.med || 0) + (sc.low || 0);
    if (t) laneShare.set(k, (laneShare.get(k) || 0) + t);
  }
}
const laneTotal = [...laneShare.values()].reduce((a, b) => a + b, 0) || 1;
const lanes = [...laneShare.entries()].sort((a, b) => b[1] - a[1]);
// Lanes whose findings are lint/config rather than vulnerabilities. Named explicitly rather than
// inferred, so the split is auditable and a new lane cannot join the "vulnerability" side silently.
// DERIVED FROM THE REGISTRY, not hand-listed here. The first version was a literal Set, and its
// failure mode was silence: a new lane joined the "vulnerability" side by default and nothing said
// so, which is how a lint diagnostic ends up inside a CVE headline. monitor/scanner-checks.mjs
// already declares which check produces each category, and the manifest already declares what each
// check IS — so the split is read from there and the fallback list only covers categories the
// registry does not map.
//
// The residue is deliberate and small: a category with no registry entry cannot be classified, so it
// is treated as a VULNERABILITY lane — the direction that over-counts the honest number rather than
// the headline one. Being wrong toward caution is the only acceptable direction for a default here.
const LINT_CHECK = /lint|actionlint|zizmor|hadolint|dockerfile|iac-config|a11y|stub-detect|deno-/i;
const LINTISH = new Set(
  Object.entries(SCANNER_CHECKS)
    .filter(([, check]) => LINT_CHECK.test(check))
    .map(([category]) => category),
);
// Categories the registry does not map at all — recorded so the residue is visible rather than
// assumed empty. If this prints, the split above is guessing about that lane.
{
  const mapped = new Set(Object.keys(SCANNER_CHECKS));
  const unmapped = [...laneShare.keys()].filter((k) => !mapped.has(k));
  if (unmapped.length) {
    console.error(`  note: ${unmapped.length} scanner categor(ies) not in SCANNER_CHECKS, `
      + `counted as vulnerability lanes: ${unmapped.join(', ')}`);
  }
}
const lintTotal = lanes.filter(([k]) => LINTISH.has(k)).reduce((a, [, v]) => a + v, 0);
const fullyCovered = repos.filter((r) => r.coverageKnown && !r.gaps.length).length;
const coverageUnknown = repos.filter((r) => !r.coverageKnown).length;

// Fleet-wide gap attribution, blocked first — those are the only rows anyone can act on today.
const gapAgg = new Map();
for (const r of repos) {
  for (const g of r.gaps) {
    const key = `${g.check}${g.failed ? ' (failed)' : ''}`;
    const e = gapAgg.get(key) || { key, n: 0, blocked: g.blocked };
    e.n++; e.blocked = e.blocked || g.blocked; gapAgg.set(key, e);
  }
}
const gapRows = [...gapAgg.values()].sort((a, b) => (b.blocked ? 1 : 0) - (a.blocked ? 1 : 0) || b.n - a.n);

const topRepos = repos.filter((r) => r.total > 0)
  .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, 20);

const pct = (n, d) => (d ? (100 * n / d) : 0);
const fmtPct = (n, d) => `${pct(n, d).toFixed(0)}%`;
const num = (n) => Number(n || 0).toLocaleString();
const kevFresh = roll.enrichment?.kevFreshness || {};
// `source` is an absolute batch path — correct as provenance, wrong as a title: it is unreadable
// and it publishes the filesystem layout into an artifact meant to leave this machine. Take the
// area from the slice id's own suffix, and fall back to the OUTPUT file's directory rather than
// to the path, so a deliverable never carries someone's home directory in its heading.
const AREA = (/^sweep-\d{14}-(.+)$/.exec(roll.sliceId || '') || [])[1]
  || OUT.split('/').slice(-2, -1)[0] || 'area';

const worstOf = (r) => (r.sev.crit ? 'crit' : r.sev.high ? 'high' : r.sev.med ? 'med' : 'low');

const bandRows = bands.map((b) => {
  const seg = (n, cls, name) => (n === 0 ? '' :
    `<div class="seg ${cls}" style="flex:${n} 0 0" tabindex="0" data-tip="${esc(b.label)} — ${esc(name)}: ${n} of ${b.n} (${fmtPct(n, b.n)})">${
      pct(n, b.n) >= 9 ? `<span class="sl">${fmtPct(n, b.n)}</span>` : ''}</div>`);
  return `<div class="brow"><div class="blab">${esc(b.label)}</div><div class="bar">${
    seg(b.clean, 'c-clean', 'clean — scanned, zero findings, every lane reported')}${
    seg(b.unproven, 'c-unproven', 'zero, but at least one lane produced no result')}${
    seg(b.unknown, 'c-unknown', 'coverage unknown — no per-check record for this repo')}${
    seg(b.affected, 'c-aff', 'affected')}</div><div class="bnum"><strong>${fmtPct(b.clean, b.n)}</strong> proven clean</div></div>`;
}).join('\n');

const sevMax = Math.max(1, ...SEVS.map(([k]) => Number(totals[k] || 0)));
const sevBars = SEVS.map(([k, label]) => `<div class="hrow"><div class="hlab">${esc(label)}</div>
  <div class="htrack"><div class="hfill s-${k}" style="width:${(100 * Number(totals[k] || 0) / sevMax).toFixed(1)}%" tabindex="0" data-tip="${esc(label)}: ${num(totals[k])} findings"></div></div>
  <div class="hnum">${num(totals[k])}</div></div>`).join('\n');

const repoMax = Math.max(1, ...topRepos.map((r) => r.total));
const repoRows = topRepos.map((r) => {
  const seg = (k, n) => (r.sev[k] === 0 ? '' : `<div class="seg s-${k}" style="flex:${r.sev[k]} 0 0" tabindex="0" data-tip="${esc(r.name)} — ${n}: ${r.sev[k]}"></div>`);
  return `<div class="hrow"><div class="hlab mono"><span class="dot s-${worstOf(r)}"></span>${esc(r.name)}</div>
    <div class="htrack"><div class="hstack" style="width:${(100 * r.total / repoMax).toFixed(1)}%">${seg('crit', 'Critical')}${seg('high', 'High')}${seg('med', 'Medium')}${seg('low', 'Low')}</div></div>
    <div class="hnum">${num(r.total)}</div></div>`;
}).join('\n');

const gapList = gapRows.map((g) => `<div class="hrow"><div class="hlab">${g.blocked ? '<span class="bchip">BLOCKED</span> ' : ''}${esc(g.key)}</div>
  <div class="htrack"><div class="hfill ${g.blocked ? 'c-blocked' : 'c-unproven'}" style="width:${(100 * g.n / Math.max(1, repos.length)).toFixed(1)}%" tabindex="0" data-tip="${esc(g.key)}: no result on ${g.n} of ${repos.length} repos"></div></div>
  <div class="hnum">${g.n}</div></div>`).join('\n');

const tableRows = repos.slice().sort((a, b) => a.name.localeCompare(b.name)).map((r) => `<tr>
  <td class="mono">${esc(r.name)}</td><td>${r.sev.crit}</td><td>${r.sev.high}</td><td>${r.sev.med}</td><td>${r.sev.low}</td>
  <td>${r.kev || ''}</td><td>${r.cves || ''}</td>
  <td>${r.blockedGaps.length ? `<span class="chip chip-blocked" tabindex="0" data-tip="${esc(r.blockedGaps.map((x) => x.check).join(', '))}">${r.blockedGaps.length} blocked</span> ` : ''}${
    r.gaps.length ? `<span class="chip chip-grey" tabindex="0" data-tip="${esc(r.gaps.map((x) => x.check).join(', '))}">${r.gaps.length} lane${r.gaps.length > 1 ? 's' : ''} no result</span>` : '<span class="chip chip-ok">full</span>'}</td>
</tr>`).join('\n');

let deltaCard = '';
if (BEFORE) {
  let before = null;
  try { before = JSON.parse(readFileSync(BEFORE, 'utf8')).totals || null; } catch { /* no baseline, no card */ }
  if (before) {
    const rows = [...SEVS, ['cves', 'Distinct CVEs'], ['kev', 'KEV findings']].map(([k, label]) => {
      const b = Number(before[k] || 0), a = Number(totals[k] || 0), d = a - b;
      return `<tr><td style="text-align:left">${esc(label)}</td><td>${num(b)}</td><td>${num(a)}</td>
        <td style="color:${d > 0 ? 'var(--aff)' : d < 0 ? 'var(--clean)' : 'var(--muted)'};font-weight:600">${d > 0 ? '+' : ''}${num(d)}</td></tr>`;
    }).join('');
    deltaCard = `<div class="card"><h2>What changed since the baseline</h2>
      <p class="note">Same repositories at the same commits. A movement here is a change in what the scanners could SEE, not in the code.</p>
      <table style="max-width:560px"><thead><tr><th style="text-align:left">Severity</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(AREA)} — vulnerability profile</title>
${followerScript()}
<style>
${houseCss({ fonts: 'inline', weights: { sans: [400, 600, 700], mono: [400] } })}
 .v{--surface:var(--panel);--plane:var(--bg);--ink2:var(--mut);--muted:var(--dim);--grid:var(--line);
    --ring:color-mix(in srgb,var(--ink) 10%,transparent);
    --clean:#2a78d6;--aff:#d03b3b;--unproven:#c3c2b7;--blocked:#8a1f1f;
    --s-crit:#d03b3b;--s-high:#ec835a;--s-med:#fab219;--s-low:#86b6ef}
 html[data-mode=dark] .v{--clean:#3987e5;--unproven:#4a4a46;--s-low:#2a78d6}
 @media(prefers-color-scheme:dark){html:not([data-mode]) .v{--clean:#3987e5;--unproven:#4a4a46;--s-low:#2a78d6}}
 body{font-size:.875rem;line-height:1.5}
 .v{padding:2rem 1.5rem 4rem;background:var(--plane);min-height:100vh}
 .wrap{max-width:66.25rem;margin:0 auto}
 h1{font-size:1.625rem;margin:0 0 .25rem;letter-spacing:-.02em} h2{font-size:.9375rem;margin:0 0 2px}
 .sub{color:var(--ink2);margin:0 0 .25rem} .stamp{color:var(--muted);font-size:.75rem;margin:0 0 1.625rem}
 .card{background:var(--surface);border:1px solid var(--ring);border-radius:.625rem;padding:1.25rem 1.375rem;margin-bottom:1.25rem}
 .note{color:var(--ink2);font-size:.7812rem;margin:0 0 1.125rem}
 .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.25rem,1fr));gap:.75rem;margin-bottom:1.25rem}
 .tile{background:var(--surface);border:1px solid var(--ring);border-radius:.625rem;padding:1rem 1.125rem}
 .tile .v2{font-size:1.8125rem;font-weight:600;letter-spacing:-.03em;line-height:1.1}
 .tile .k{color:var(--ink2);font-size:.75rem;margin-top:.25rem} .tile .h{color:var(--muted);font-size:.6875rem;margin-top:.375rem}
 .brow{display:grid;grid-template-columns:4.625rem 1fr 8.25rem;align-items:center;gap:.875rem;margin-bottom:.625rem}
 .blab{color:var(--ink2);font-size:.8125rem;text-align:right}
 .bnum{font-size:.7812rem;color:var(--ink2);font-variant-numeric:tabular-nums} .bnum strong{color:var(--ink)}
 .bar{display:flex;height:1.625rem;border-radius:.25rem;overflow:hidden;background:var(--grid);gap:2px}
 .seg{min-width:.1875rem;display:flex;align-items:center;justify-content:center;outline-offset:2px}
 .seg:first-child{border-radius:.25rem 0 0 .25rem} .seg:last-child{border-radius:0 .25rem .25rem 0}
 .c-clean{background:var(--clean)} .c-aff{background:var(--aff)} .c-blocked{background:var(--blocked)}
 .c-unknown{background:var(--muted);background-image:repeating-linear-gradient(90deg,transparent 0 2px,var(--ring) 2px .25rem)}
 .c-unproven{background:var(--unproven);background-image:repeating-linear-gradient(45deg,transparent 0 .25rem,var(--ring) .25rem .5rem)}
 .sl{font-size:.6875rem;font-weight:600;color:#fff;font-variant-numeric:tabular-nums}
 .c-unproven .sl{color:var(--ink)}
 .legend{display:flex;flex-wrap:wrap;gap:1rem;margin-top:1rem;padding-top:.875rem;border-top:1px solid var(--grid)}
 .lg{display:flex;align-items:center;gap:.4375rem;font-size:.75rem;color:var(--ink2)}
 .sw{width:.75rem;height:.75rem;border-radius:.1875rem}
 .sw.c-unproven{background-image:repeating-linear-gradient(45deg,transparent 0 .1875rem,var(--ring) .1875rem .375rem)}
 .hrow{display:grid;grid-template-columns:13.75rem 1fr 4.375rem;align-items:center;gap:.75rem;margin-bottom:.4375rem}
 .hlab{font-size:.7812rem;color:var(--ink2);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .htrack{background:var(--grid);border-radius:.1875rem;height:1.125rem;overflow:hidden}
 .hfill{height:100%;border-radius:.1875rem;outline-offset:2px} .hstack{display:flex;height:100%;gap:2px}
 .hstack .seg{border-radius:2px} .hnum{font-size:.75rem;color:var(--ink2);font-variant-numeric:tabular-nums}
 .s-crit{background:var(--s-crit)}.s-high{background:var(--s-high)}.s-med{background:var(--s-med)}.s-low{background:var(--s-low)}
 .dot{display:inline-block;width:.4375rem;height:.4375rem;border-radius:50%;margin-right:.375rem}
 .mono{font-family:var(--mono);font-size:.7188rem}
 table{width:100%;font-size:.75rem}
 th,td{text-align:right;padding:.3125rem .5rem;border-bottom:1px solid var(--grid);font-variant-numeric:tabular-nums}
 th:first-child,td:first-child{text-align:left}
 th{color:var(--ink2);font-weight:600;position:sticky;top:0;background:var(--surface)}
 .scroll{max-height:28.75rem;overflow:auto;border:1px solid var(--grid);border-radius:.375rem}
 .chip{display:inline-block;padding:1px .4375rem;border-radius:.5625rem;font-size:.6562rem;font-weight:600}
 .chip-ok{background:color-mix(in srgb,var(--clean) 16%,transparent);color:var(--clean)}
 .chip-grey{background:var(--grid);color:var(--ink2)}
 .chip-blocked,.bchip{background:var(--blocked);color:#fff}
 .bchip{padding:1px .375rem;border-radius:.1875rem;font-size:.625rem;font-weight:700;letter-spacing:.04em}
 .lchip{background:var(--grid);color:var(--ink2);padding:1px .3125rem;border-radius:.1875rem;font-size:.625rem;font-weight:600;letter-spacing:.04em}
 .callout{border-left:.1875rem solid var(--grid);padding:2px 0 2px .875rem;color:var(--ink2);font-size:.7812rem;margin:1rem 0 0}
 #tip{position:fixed;z-index:20;pointer-events:none;opacity:0;transition:opacity .1s;background:var(--ink);
   color:var(--surface);padding:.3125rem .5625rem;border-radius:.3125rem;font-size:.7188rem;max-width:18.75rem}
</style></head><body><div class="v"><div class="wrap">

<h1>${esc(AREA)} — vulnerability profile</h1>
<p class="sub">${repos.length} repositories, swept with commitwork's <code>security-baseline</code> manifest.</p>
<p class="stamp">Rollup ${esc(roll.generated || '')}${roll.sliceId ? ` · slice ${esc(roll.sliceId)}` : ''}</p>

<div class="tiles">
 <div class="tile"><div class="v2">${repos.length}</div><div class="k">repositories</div></div>
 <div class="tile"><div class="v2">${cveRepos}</div><div class="k">with ≥1 CVE</div><div class="h">${fmtPct(cveRepos, repos.length)} · ${num(cveRows)} advisory rows</div></div>
 <div class="tile"><div class="v2">${anyFinding}</div><div class="k">with ≥1 finding of any kind</div><div class="h">includes lint &amp; config</div></div>
 <div class="tile"><div class="v2">${num(totals.crit)}</div><div class="k">critical findings</div></div>
 <div class="tile"><div class="v2">${num((totals.crit || 0) + (totals.high || 0) + (totals.med || 0) + (totals.low || 0))}</div><div class="k">findings total</div><div class="h">${num(totals.cves)} distinct CVEs</div></div>
 <div class="tile"><div class="v2">${kevTotal}</div><div class="k">KEV findings</div><div class="h">${kevRepos.length} repo${kevRepos.length === 1 ? '' : 's'}</div></div>
 <div class="tile"><div class="v2">${fullyCovered}</div><div class="k">fully covered</div><div class="h">${coverageUnknown ? `${coverageUnknown} coverage unknown` : 'coverage known for all'}</div></div>
</div>

<div class="card">
 <h2>Percentage clean, by severity</h2>
 <p class="note">Each bar is all ${repos.length} repositories. <strong>Clean</strong> means scanned, zero findings at that severity, <em>and</em> every lane returned a result. A zero from an incomplete scan is drawn separately, because absence of evidence is not evidence of absence.</p>
 ${bandRows}
 <div class="legend">
  <span class="lg"><span class="sw c-clean"></span>Clean — proven</span>
  <span class="lg"><span class="sw c-unproven"></span>Zero, but not proven</span>
  <span class="lg"><span class="sw c-unknown"></span>Coverage unknown</span>
  <span class="lg"><span class="sw c-aff"></span>Affected</span>
 </div>
</div>

<div class="card">
 <h2>Known Exploited Vulnerabilities (CISA KEV)</h2>
 <p class="note">Cross-referenced against the KEV catalog frozen into this slice.</p>
 <div style="display:flex;align-items:center;gap:14px">
  <div style="font-size:42px;font-weight:600;line-height:1;color:${kevTotal ? 'var(--aff)' : 'var(--clean)'}">${kevTotal}</div>
  <div><div style="font-weight:600">${kevTotal ? `${kevTotal} finding${kevTotal === 1 ? '' : 's'} across ${kevRepos.length} repo${kevRepos.length === 1 ? '' : 's'}` : 'None found'}</div>
   <div style="color:var(--ink2);font-size:12.5px">catalog ${esc(kevFresh.catalogVersion || 'version unknown')} · freshness <strong>${esc(kevFresh.state || 'unknown')}</strong>${kevFresh.ageDays != null ? ` (${kevFresh.ageDays}d, max ${kevFresh.maxDays})` : ''}</div></div>
 </div>
 ${kevRepos.length ? `<div class="callout">${kevRepos.map((r) => `<div class="mono">${esc(r.name)} <span style="color:var(--muted)">(${r.kev} finding${r.kev === 1 ? '' : 's'}, ${r.kevIds.length} distinct)</span> — ${esc(r.kevIds.join(', '))}</div>`).join('')}</div>` : ''}
 <p class="callout">A zero here is only as good as the catalog behind it, so the freshness above is reported rather than assumed — a stale catalog yields a zero meaning "not checked recently", not "not affected".</p>
</div>

${deltaCard}

<div class="card">
 <h2>What these numbers are made of</h2>
 <p class="note">A finding is not a vulnerability. This fleet's own defect signature is that one lane accounting for most of a bucket is a defect rather than a crisis — so the composition is published rather than summarised, and you can check the headline against it.</p>
 ${lanes.slice(0, 10).map(([k, v]) => `<div class="hrow">
   <div class="hlab">${LINTISH.has(k) ? '<span class="lchip">lint/config</span> ' : ''}${esc(k)}</div>
   <div class="htrack"><div class="hfill ${LINTISH.has(k) ? 'c-unproven' : 'c-aff'}" style="width:${(100 * v / laneTotal).toFixed(1)}%" tabindex="0" data-tip="${esc(k)}: ${num(v)} findings, ${(100 * v / laneTotal).toFixed(1)}% of all"></div></div>
   <div class="hnum">${(100 * v / laneTotal).toFixed(1)}%</div></div>`).join('\n')}
 <p class="callout">Lint and configuration lanes are <strong>${fmtPct(lintTotal, laneTotal)}</strong> of all findings. They are real diagnostics and they are not vulnerabilities — which is why the CVE count is published as its own number above rather than folded into the total.</p>
</div>

<div class="card">
 <h2>Findings by severity</h2>
 <p class="note">On the rollup's own accounting${EXCLUDED.size ? ` (excludes ${[...EXCLUDED].join(', ')})` : ''}.</p>
 ${sevBars}
</div>

<div class="card">
 <h2>Why coverage is incomplete</h2>
 <p class="note">The hatched band above is not an unexplained wedge — this is what it consists of. <span class="bchip">BLOCKED</span> marks a gap a <em>human can clear</em>: a missing credential or an uninstalled tool. The rest are structural — no served HTML, no live URL — and nobody can clear them.</p>
 ${gapList || '<p class="note">Every lane returned a result on every repository.</p>'}
 <p class="callout">Blocked rows sort first deliberately. They are the only entries here anyone can act on today, and rendering them the same grey as an unfixable void is how the actionable one stops being read.</p>
</div>

<div class="card">
 <h2>Most-affected repositories</h2>
 <p class="note">Top ${topRepos.length} by finding count. Segments run Critical → Low; the dot marks each repository's worst severity, so highest-risk stays readable without re-sorting.</p>
 ${repoRows || '<p class="note">No repository carries a finding.</p>'}
 <div class="legend">
  <span class="lg"><span class="sw s-crit"></span>Critical</span><span class="lg"><span class="sw s-high"></span>High</span>
  <span class="lg"><span class="sw s-med"></span>Medium</span><span class="lg"><span class="sw s-low"></span>Low</span>
 </div>
</div>

<div class="card">
 <h2>Per-repository table</h2>
 <p class="note">The same data as every chart above, for readers who need the numbers or cannot rely on colour.</p>
 <div class="scroll"><table><thead><tr><th>Repository</th><th>Crit</th><th>High</th><th>Med</th><th>Low</th><th>KEV</th><th>CVEs</th><th>Coverage</th></tr></thead>
 <tbody>${tableRows}</tbody></table></div>
</div>

</div></div><div id="tip"></div>
<script>
(function(){var t=document.getElementById('tip');
 function show(e,x){t.textContent=x;t.style.opacity='1';var a=e.clientX+12,b=e.clientY+12;
  if(a+t.offsetWidth>innerWidth-8)a=e.clientX-t.offsetWidth-12;
  if(b+t.offsetHeight>innerHeight-8)b=e.clientY-t.offsetHeight-12;t.style.left=a+'px';t.style.top=b+'px';}
 document.addEventListener('mousemove',function(e){var el=e.target.closest('[data-tip]');
  if(el)show(e,el.getAttribute('data-tip'));else t.style.opacity='0';});
 document.addEventListener('focusin',function(e){var el=e.target.closest('[data-tip]');if(!el)return;
  var r=el.getBoundingClientRect();t.textContent=el.getAttribute('data-tip');t.style.opacity='1';
  t.style.left=r.left+'px';t.style.top=(r.bottom+8)+'px';});
 document.addEventListener('focusout',function(){t.style.opacity='0';});})();
</script></body></html>`;

writeAtomic(OUT, html);
console.log(`wrote ${OUT} — ${repos.length} repos, ${kevTotal} KEV, ${anyFinding} with findings, ${gapRows.filter((g) => g.blocked).length} blocked gap kind(s)`);
for (const b of bands) console.log(`  ${b.label.padEnd(9)} clean ${String(b.clean).padStart(3)}  unproven ${String(b.unproven).padStart(3)}  affected ${String(b.affected).padStart(3)}`);
