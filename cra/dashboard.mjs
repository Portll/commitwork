#!/usr/bin/env node
// cra/dashboard.mjs — self-contained CRA readiness dashboard (one HTML file, data inlined,
// no external assets, no browser storage — file:// safe, same pattern as the monitor's).
//
// Ties together everything the module knows, per product: preflight status, control coverage
// across CRA / SOC 2 / NIST 800-53 (evidenced vs mapped), open Art. 14 cases with clock state,
// and SBOM/VEX artifact presence — so "are we CRA-ready?" is one screen, not five commands.
//
//   node cra/dashboard.mjs   →   reports/cra/dashboard.html
//
// Zero deps.

import { isMainModule } from '../lib/is-main.mjs';
import { esc } from '../lib/html-escape.mjs';
import { houseCss } from '../lib/house-css.mjs';
import { followerScript } from '../lib/theme-follower.mjs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  loadJSON, writeTextAtomic, resolvePaths, loadProducts, nowISO, isOverdue, latestSweepDir,
} from './lib.mjs';
import { coverageFor, loadControls, ranChecksFromSweep } from './controls.mjs';
import { preflight } from './preflight.mjs';

const FW = [['cra', 'CRA'], ['soc2', 'SOC 2'], ['nist80053', 'NIST 800-53']];

function buildData(paths, at) {
  const controls = loadControls(paths.controls);
  const { products, manufacturer } = loadProducts(paths.products);
  const rollup = loadJSON(paths.rollup, { repos: [] });
  const ledger = loadJSON(paths.ledger, { entries: [] });
  const annDoc = loadJSON(paths.annotations, { annotations: [] });
  const casesDoc = loadJSON(paths.cases, { cases: {} });
  const pf = preflight(paths, at);
  const sweep = latestSweepDir(paths.reportsRoot);

  const out = [];
  for (const product of products) {
    const cov = coverageFor(product, controls, rollup, ledger.entries || [], annDoc, ranChecksFromSweep(sweep, product.repos));
    const cases = Object.values(casesDoc.cases || {})
      .filter((k) => k.productId === product.id && k.status !== 'closed')
      .map((k) => ({
        caseId: k.caseId, kind: k.kind || 'vulnerability', subject: k.vulnId || k.title || k.caseId,
        trigger: k.trigger, status: k.status, clocks: k.clocks,
        overdue: [['24h', k.clocks?.earlyWarningDue], ['72h', k.clocks?.notificationDue], ['final', k.clocks?.finalDue]]
          .filter(([, d]) => d && isOverdue(d, at)).map(([l]) => l),
      }));
    out.push({
      id: product.id, name: product.name, version: product.version,
      eu: !!product.market?.eu, category: product.market?.category || 'default',
      repos: product.repos || [],
      coverage: Object.fromEntries(FW.map(([k]) => [k, { evidenced: cov.frameworks[k].evidenced, total: cov.frameworks[k].total, catalog: cov.frameworks[k].catalog, baselineModerate: cov.frameworks[k].baselineModerate, scope: cov.frameworks[k].scope, rows: cov.frameworks[k].rows }])),
      cases,
      sbom: existsSync(join(paths.out, 'sbom', `${product.id}-${product.version}.cdx.json`)),
      // per-format, never collapsed to one boolean: a missing CSAF is a missing CSAF, not "no VEX"
      vex: {
        cdx: existsSync(join(paths.out, 'vex', `${product.id}.vex.cdx.json`)),
        csaf: existsSync(join(paths.out, 'vex', `${product.id}.vex.csaf.json`)),
        openvex: existsSync(join(paths.out, 'vex', `${product.id}.openvex.json`)),
      },
    });
  }
  return { generatedAt: at, manufacturer, preflight: pf, sliceId: rollup.sliceId || null, products: out };
}


function html(data) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>commitwork — CRA Readiness</title>
${followerScript()}
<style>
${houseCss({ fonts: 'inline', weights: { sans: [400, 600], mono: [400] } })}
body{font-size:.875rem;line-height:1.5}
.wrap{max-width:67.5rem;margin:0 auto;padding:1.75rem 1.25rem 3.75rem}
h1{font-size:1.375rem;margin:0 0 2px}h2{font-size:.9375rem;margin:0 0 .625rem;font-weight:600}
.sub{color:var(--mut);font-size:.7812rem;margin-bottom:1.25rem}
.banner{border-radius:.625rem;padding:.75rem 1rem;margin-bottom:1.25rem;border:1px solid var(--line)}
.banner.ok{background:color-mix(in srgb,var(--live) 12%,var(--panel));border-color:color-mix(in srgb,var(--live) 45%,transparent)}
.banner.bad{background:color-mix(in srgb,var(--crit) 14%,var(--panel));border-color:var(--crit)}
.chip{display:inline-block;padding:1px .5rem;border-radius:1.25rem;font-size:.7188rem;font-weight:600;border:1px solid var(--line);white-space:nowrap}
.chip.g{background:color-mix(in srgb,var(--live) 12%,transparent);color:var(--live);border-color:color-mix(in srgb,var(--live) 45%,transparent)}
.chip.a{background:color-mix(in srgb,var(--part) 12%,transparent);color:var(--part)}
.chip.r{background:color-mix(in srgb,var(--cra-over) 12%,transparent);color:var(--cra-over)}
.chip.n{color:var(--mut)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:.75rem;padding:1.125rem 1.125rem .5rem;margin-bottom:1rem}
.card h2{display:flex;align-items:center;gap:.625rem;flex-wrap:wrap}
.mono{font-family:var(--mono);font-size:.75rem;color:var(--mut)}
.meters{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:.75rem;margin:.75rem 0}
.meter{background:var(--panel2);border:1px solid var(--line);border-radius:.5625rem;padding:.625rem .75rem}
.meter .top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.375rem}
.meter .lbl{font-weight:600}.meter .val{font-variant-numeric:tabular-nums}
.bar{height:.5rem;border-radius:.3125rem;background:var(--panel);overflow:hidden;border:1px solid var(--line)}
.bar>i{display:block;height:100%;background:linear-gradient(90deg,color-mix(in srgb,var(--live) 45%,transparent),var(--live))}
details{margin:.25rem 0 .75rem}summary{cursor:pointer;color:var(--mut);font-size:.7812rem}
table{width:100%;border-collapse:collapse;margin-top:.5rem;font-size:.7812rem}
th,td{text-align:left;padding:.3125rem .5rem;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:600}
td.st{white-space:nowrap}
.case{background:color-mix(in srgb,var(--cra-over) 8%,var(--panel2));border:1px solid var(--line);border-left:.1875rem solid var(--cra-over);border-radius:.5rem;padding:.5rem .75rem;margin:.375rem 0}
.case.ok{border-left-color:var(--part);background:color-mix(in srgb,var(--part) 8%,var(--panel2))}
.foot{color:var(--mut);font-size:.75rem;border-top:1px solid var(--line);margin-top:1.75rem;padding-top:1rem}
.dot{display:inline-block;width:.5rem;height:.5rem;border-radius:50%;margin-right:.3125rem;vertical-align:middle}
.dot.g{background:var(--live)}.dot.m{background:var(--plan)}
</style></head><body><div class="wrap">
<h1>commitwork — CRA Readiness</h1>
<div class="sub">Generated ${esc(data.generatedAt)}${data.sliceId ? ` · slice <span class="mono">${esc(data.sliceId)}</span>` : ''} · manufacturer: ${esc(data.manufacturer?.name || 'TODO')}</div>
${banner(data.preflight)}
${data.products.map(productCard).join('')}
<div class="foot">
<b>Advisory.</b> The control crosswalk (<span class="mono">cra/controls.json</span>) is a defensible starting point mapping commitwork checks to CRA Annex I Part II, SOC 2 TSC, and NIST 800-53 Rev 5 — not a substitute for your assessor's control mapping. <b>Evidenced</b> = a mapping check provably ran on a product repo in the latest slice, or a ledger/annotation source is present; <b>mapped</b> = addressed by the catalogue but not proven to have run for this product (explicit uncertainty). Art. 14 report drafts are drafts — submission via the ENISA single reporting platform is a human act. CRA reporting obligations start 11 September 2026.
</div>
</div></body></html>`;
}

function banner(pf) {
  const cls = pf.ready ? 'ok' : 'bad';
  const head = pf.ready ? `<span class="chip g">READY</span> configuration valid` : `<span class="chip r">NOT READY</span> fix config errors`;
  const errs = (pf.errors || []).map((e) => `<div>✗ ${esc(e)}</div>`).join('');
  const adv = (pf.advisories || []).length ? `<details><summary>${pf.advisories.length} advisory</summary>${pf.advisories.map((a) => `<div>⚠ ${esc(a)}</div>`).join('')}</details>` : '';
  return `<div class="banner ${cls}"><div>${head}</div>${errs}${adv}</div>`;
}

function meter(label, cov) {
  const ev = cov.evidenced, total = cov.total;
  const pct = total ? Math.round((ev / total) * 100) : 0;
  const denom = cov.catalog ? `maps ${total} of ~${cov.catalog}${cov.baselineModerate ? ` (~${cov.baselineModerate} Moderate)` : ''} — technical subset` : `${total} mapped`;
  return `<div class="meter"><div class="top"><span class="lbl">${esc(label)}</span><span class="val mono">${ev}/${total} evidenced</span></div><div class="bar"><i style="width:${pct}%"></i></div><div class="mono" style="margin-top:5px;font-size:10.5px;color:var(--dim)">${esc(denom)}</div></div>`;
}

function coverageTable(rows) {
  return `<table><thead><tr><th>Control</th><th>Title</th><th>Status</th><th>Evidenced by</th></tr></thead><tbody>${rows.map((r) => {
    const by = r.status === 'evidenced'
      ? [...r.evidencingChecks, ...r.evidencingSources.map((s) => `(${s})`)].join(', ') + (r.repos.length ? ` · ${r.repos.length} repo(s)` : '')
      : `mapped: ${r.mappingChecks.join(', ') || '—'}`;
    const dot = r.status === 'evidenced' ? '<span class="dot g"></span>evidenced' : '<span class="dot m"></span>mapped';
    return `<tr><td class="mono">${esc(r.control)}</td><td>${esc(r.title)}</td><td class="st">${dot}</td><td>${esc(by)}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function productCard(p) {
  const euChip = p.eu ? '<span class="chip g">EU market</span>' : '<span class="chip n">not EU market</span>';
  const vexChip = (label, present) => `<span class="chip ${present ? 'g' : 'n'}">${label} ${present ? '✓' : '—'}</span>`;
  const artifacts = `<span class="chip ${p.sbom ? 'g' : 'n'}">SBOM ${p.sbom ? '✓' : '—'}</span> `
    + vexChip('VEX CycloneDX', p.vex.cdx) + ' ' + vexChip('VEX CSAF', p.vex.csaf) + ' ' + vexChip('OpenVEX', p.vex.openvex);
  const cases = p.cases.length ? p.cases.map((k) => {
    const od = k.overdue.length ? `<span class="chip r">OVERDUE: ${k.overdue.join(', ')}</span>` : '<span class="chip a">clocks running</span>';
    return `<div class="case ${k.overdue.length ? '' : 'ok'}"><b>${esc(k.subject)}</b> <span class="mono">${esc(k.kind)}/${esc(k.trigger)}</span> ${od}<div class="mono">early ${esc(k.clocks?.earlyWarningDue || '?')} · 72h ${esc(k.clocks?.notificationDue || '?')} · final ${esc(k.clocks?.finalDue || '?')}</div></div>`;
  }).join('') : '<div class="sub" style="margin:6px 0 12px">No open Art. 14 cases.</div>';
  return `<div class="card">
<h2>${esc(p.name)} <span class="mono">${esc(p.version)}</span> ${euChip} <span class="chip n">${esc(p.category)}</span> ${artifacts}</h2>
<div class="mono">${p.repos.length} repo(s): ${p.repos.map(esc).join(', ') || '—'}</div>
<div class="meters">${FW.map(([k, lbl]) => meter(lbl, p.coverage[k])).join('')}</div>
<div class="sub" style="margin:2px 0 8px">Coverage is of the controls commitwork <b>maps</b> — the technical subset a scanner can evidence — not the full framework. The organizational majority (governance, HR, physical, contingency) is out of scope (GRC).</div>
${FW.map(([k, lbl]) => `<details><summary>${lbl} control detail (${p.coverage[k].evidenced}/${p.coverage[k].total} mapped evidenced${p.coverage[k].catalog ? ` · maps ${p.coverage[k].total} of ~${p.coverage[k].catalog}` : ''})</summary>${p.coverage[k].scope ? `<div class="sub" style="margin:6px 0">${esc(p.coverage[k].scope)}</div>` : ''}${coverageTable(p.coverage[k].rows)}</details>`).join('')}
<h2 style="margin-top:14px;font-size:13px">Open Art. 14 cases</h2>${cases}
</div>`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
export { buildData, html };
if (isMainModule(import.meta.url)) {
  const paths = resolvePaths();
  const data = buildData(paths, nowISO());
  const out = join(paths.out, 'dashboard.html');
  writeTextAtomic(out, html(data));
  console.log(`  ✓ CRA readiness dashboard → ${out}`);
}
