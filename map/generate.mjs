#!/usr/bin/env node
/*
 * generate.mjs — reads ./data.json, writes ./index.html: a project-agnostic transit-diagram
 * modernization map. Self-contained artifact (all CSS/JS/data/logo inlined, file:// safe).
 * Nothing here may name, brand or quote a particular client.
 */
import { esc } from '../lib/html-escape.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { followerScript } from '../lib/theme-follower.mjs';
import { houseFonts, houseTokens } from '../lib/house-css.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MAP_ROOT ? process.env.MAP_ROOT : __dirname; // per-project data root (commitwork/map/data/<project>)
const DATA = JSON.parse(readFileSync(join(ROOT, 'data.json'), 'utf8'));

// Inlines the masthead logo (meta.logo) so file:// needs no fetch; the engine ships no default mark.
// Loop each pass to a fixed point — browsers honour --!> as well as -->, and overlapping dashes can
// re-expose a '<!--'/'-->' pair (CodeQL js/bad-tag-filter, js/incomplete-multi-character-sanitization).
function stripComments(s) {
  let next;
  while ((next = s.replace(/<!--[\s\S]*?(?:-->|--!>)/g, '')) !== s) s = next;
  while ((next = s.replace(/<!--|-->|--!>/g, '')) !== s) s = next;
  return s;
}

let LOGO_SVG = '';
// Resolved path must stay contained under ROOT — join() normalises '..' and can escape the data dir.
for (const p of (DATA.meta.logo ? [resolve(ROOT, DATA.meta.logo)] : [])) {
  const root = resolve(ROOT);
  if (p !== root && !p.startsWith(root + sep)) {
    console.warn(`  WARN: logo path escapes the project data dir, refusing: ${DATA.meta.logo}`);
    continue;
  }
  if (!existsSync(p)) continue;
  LOGO_SVG = stripComments(readFileSync(p, 'utf8').replace(/<\?xml[^>]*\?>/g, '')).trim();
  // Mark the inline svg presentational — the wrapping span's aria-label is the accessible name.
  LOGO_SVG = LOGO_SVG.replace(/^<svg\b/, '<svg aria-hidden="true" focusable="false"');
  break;
}

// Quotes included — used inside double-quoted attributes, not just text content.

// Embed JSON safely inside a <script> (avoid </script> + line-separator pitfalls).
const dataLiteral = JSON.stringify(DATA)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const c = DATA.meta.counts;
const SNAP = DATA.meta.cveSnapshot || {};

// CSS — transit-signage aesthetic
const css = () => `
${houseFonts('served')}
${houseTokens()}
:root{
  --paper:var(--panel); --paper2:var(--bg);
  --ink2:var(--ink); --ink3:var(--mut); --hair:var(--line); --hairStrong:var(--line2);
  --alarm:var(--crit); --done:var(--live); --future:var(--dim);
  --shadow:0 10px 34px rgba(0,0,0,.18);
  --transport:var(--sans);
  --map-a:color-mix(in srgb,var(--panel2) 35%,var(--panel)); --map-b:var(--panel);
  --hint:color-mix(in srgb,var(--panel) 90%,transparent); --hover:var(--panel2); --active:var(--wash);
  --cap:var(--panel); --now-band:color-mix(in srgb,var(--attest) 12%,var(--panel)); --era:var(--panel2);
  --era-now:color-mix(in srgb,var(--attest) 8%,var(--panel)); --era-target:color-mix(in srgb,var(--part) 10%,var(--panel));
  --era-grid:var(--line); --spine:var(--line2);
  --block:var(--head); --pend-bg:var(--panel2); --pend-line:var(--line2); --pend-ink:var(--mut); --muted:var(--mut); --alarm-ink:var(--crit);
  --crit-ink:var(--crit); --high-ink:var(--high); --med-ink:var(--med); --low-ink:var(--low); --done-ink:var(--live); --plan-ink:var(--plan);
  --open-bg:var(--panel2); --open-line:var(--line2); --open-ink:var(--ink);
  --chip-bg:color-mix(in srgb,var(--live) 12%,var(--panel)); --chip-line:color-mix(in srgb,var(--live) 30%,transparent); --chip-ink:var(--live);
}
html[data-mode=dark]{--shadow:0 10px 34px rgba(0,0,0,.55)}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{
  background:var(--paper2);
  color:var(--ink);
  font:14px/1.45 var(--transport);
  -webkit-font-smoothing:antialiased;
}
a{color:var(--plan)}

/* ---- top chrome / header ---- */
header.topbar{
  position:sticky;top:0;z-index:40;
  background:var(--panel);
  color:var(--head);border-bottom:3px solid var(--acc);
}
.topbar .row1{display:flex;align-items:center;gap:18px;padding:11px 22px 8px}
.logo{height:24px;display:block;flex:0 0 auto;opacity:.98}
.logo svg{height:24px;width:auto;display:block}
.titles{display:flex;flex-direction:column;line-height:1.16;min-width:0}
.titles h1{margin:0;font-size:16px;font-weight:800;letter-spacing:.2px}
.titles p{margin:1px 0 0;font-size:11.5px;color:var(--mut)}
.spacer{flex:1}
.kpis{display:flex;gap:9px;flex-wrap:wrap;align-items:center}
.kpi{
  background:var(--panel2);border:1px solid var(--line2);border-radius:9px;
  padding:5px 10px;display:flex;flex-direction:column;align-items:center;min-width:58px;
}
.kpi b{font-size:15px;font-weight:800;letter-spacing:.3px;color:var(--head)}
.kpi span{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--mut);margin-top:1px}
.kpi.good b{color:var(--live)} .kpi.warn b{color:var(--part)} .kpi.crit b{color:var(--crit)} .kpi.alarm b{color:var(--crit)}
.kpi.flat{background:transparent;border-color:transparent;align-items:flex-start;min-width:0}
.kpi.flat b{font-size:13px;color:var(--head)} .kpi.flat span{color:var(--mut)}
.cvehist{display:flex;align-items:center;gap:16px;margin:2px 18px 12px;padding:8px 16px;background:var(--bg);border:1px solid var(--line);border-radius:10px}
.cvehist-cap{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--mut);line-height:1.35;white-space:nowrap}
.hist-flag{color:var(--part);font-weight:800}
.ch-rows{flex:1;display:flex;flex-direction:column;gap:6px;min-width:240px}
.ch-row{display:flex;align-items:center;gap:10px}
.ch-tag{font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;width:120px;text-align:right;flex:0 0 auto}
.ch-tag.jvm{color:var(--attest)} .ch-tag.img{color:var(--high)}
.ch-svg{flex:1;height:22px;min-width:160px;display:block}
.ch-area.jvm{fill:color-mix(in srgb,var(--attest) 12%,transparent)} .ch-line.jvm{stroke:var(--attest);stroke-width:2;fill:none;vector-effect:non-scaling-stroke}
.ch-area.img{fill:color-mix(in srgb,var(--high) 12%,transparent)} .ch-line.img{stroke:var(--high);stroke-width:2;fill:none;vector-effect:non-scaling-stroke}
.ch-end{font-size:9px;color:var(--mut);white-space:nowrap;display:flex;align-items:baseline;gap:4px;flex:0 0 auto}
.ch-end b{font-size:14px;font-weight:800;color:var(--crit)} .ch-end b.g{color:var(--live)} .ch-end i{font-style:normal;color:var(--dim);font-weight:800}
.ch-end u{text-decoration:none;font-size:8px;text-transform:uppercase;letter-spacing:.3px;color:var(--mut);margin-left:5px}
.cvehist-infra{font-size:9px;color:var(--mut);white-space:normal;max-width:210px;line-height:1.5;border-left:1px solid var(--line);padding-left:14px;flex:0 0 auto}
.cvehist-infra b{color:var(--part);font-size:13px}

/* ---- toolbar ---- */
.toolbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:6px 22px 11px;
  background:var(--panel2);border-top:1px solid var(--line)}
.tbgroup{display:flex;align-items:center;gap:6px}
.tblabel{font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:var(--mut);margin-right:2px}
.chip{
  cursor:pointer;user-select:none;border:1px solid var(--line2);background:var(--panel);
  color:var(--ink);border-radius:999px;padding:4px 11px;font-size:11.5px;font-weight:700;
  display:inline-flex;align-items:center;gap:6px;transition:all .12s;
}
.chip:hover{border-color:var(--acc);color:var(--head)}
.chip.on{--c:var(--acc);color:var(--ink);background:color-mix(in srgb,var(--c) 14%,var(--panel));border-color:var(--c);box-shadow:inset 0 -2px 0 var(--c)}
.chip .dot{width:9px;height:9px;border-radius:50%}
.chip[data-sev=CRIT].on{--c:var(--crit)}
.chip[data-sev=HIGH].on{--c:var(--high)}
.chip[data-sev=MED].on{--c:var(--med)}
.chip[data-sev=LOW].on{--c:var(--low)}
.chip[data-status=resolved].on{--c:var(--live)}
.chip[data-status=open].on{--c:var(--mut)}
.chip[data-status=in-progress].on{--c:var(--plan)}
.chip[data-cve].on{--c:var(--crit)}
.btn{cursor:pointer;border:1px solid var(--line2);background:var(--panel);color:var(--ink);
  border-radius:8px;padding:4px 11px;font-size:11.5px;font-weight:700}
.btn:hover{color:var(--head);border-color:var(--acc)}
.btn.tog.on{background:color-mix(in srgb,var(--crit) 14%,var(--panel));border-color:var(--crit);color:var(--ink);box-shadow:inset 0 -2px 0 var(--crit)}

/* ---- main layout: map + side rail ---- */
.stage{display:flex;align-items:stretch;min-height:calc(100vh - 120px)}
.mapwrap{flex:1;min-width:0;overflow:auto;position:relative;background:
  linear-gradient(0deg,var(--map-a),var(--map-b))}
#map{display:block;width:100%;height:auto;max-width:2000px;margin:0 auto}
.maphint{position:fixed;left:14px;bottom:12px;z-index:20;font-size:10.5px;color:var(--ink3);
  background:var(--hint);border:1px solid var(--hair);border-radius:8px;padding:5px 9px;pointer-events:none}

/* ---- side rail: tree + legend ---- */
.rail{flex:0 0 364px;max-width:364px;border-left:1px solid var(--hairStrong);
  background:var(--panel);display:flex;flex-direction:column;
  position:sticky;top:120px;height:calc(100vh - 120px);overflow:hidden}
.railhd{padding:11px 16px;border-bottom:1px solid var(--hair);font-size:11px;text-transform:uppercase;
  letter-spacing:.8px;color:var(--ink3);display:flex;align-items:center;gap:8px;justify-content:space-between}
.railscroll{overflow:auto;flex:1}

/* tree */
.tree{padding:8px 10px 18px}
.tsub{margin-bottom:6px;border-radius:10px;overflow:hidden;border:1px solid var(--hair);background:var(--paper2)}
.tsub>.thd{display:flex;align-items:center;gap:9px;padding:8px 11px;cursor:pointer;user-select:none}
.tsub>.thd:hover{background:var(--hover)}
.tsub .swatch{width:11px;height:11px;border-radius:3px;flex:0 0 auto}
.tsub .tname{font-weight:800;font-size:12.5px;flex:1;color:var(--ink)}
.tsub .tcount{font-size:10px;color:var(--ink3);font-variant-numeric:tabular-nums}
.tsub .caret{color:var(--ink3);transition:transform .15s;font-size:10px}
.tsub.collapsed .caret{transform:rotate(-90deg)}
.tsub.collapsed .tnodes{display:none}
.tnodes{padding:2px 6px 8px 12px}
.tnode{display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:7px;cursor:pointer;font-size:12px}
.tnode:hover,.tnode.active{background:var(--active)}
.tnode .kind{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink3);
  border:1px solid var(--hair);border-radius:5px;padding:0 4px}
.tnode .nm{flex:1;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tnode .cvechip{font-size:9px;font-weight:800;border-radius:5px;padding:0 5px;border:1px solid var(--hair)}
.tnode .cvechip.has{border-color:var(--alarm);color:var(--alarm-ink);background:color-mix(in srgb,var(--crit) 6%,transparent)}
.tnode .cvechip.pend{border-color:var(--pend-line);color:var(--pend-ink);background:var(--pend-bg)}

/* legend */
.legend{padding:10px 16px 20px;border-top:1px solid var(--hair)}
.legend .lgd-h{margin:11px 0 6px;font-size:10.5px;text-transform:uppercase;letter-spacing:.8px;color:var(--ink3)}
.legrow{display:flex;align-items:center;gap:9px;margin:5px 0;font-size:11.5px;color:var(--ink2)}
.legrow svg{flex:0 0 auto}

/* detail panel (overlay) */
.detail{position:fixed;right:0;top:120px;width:440px;max-width:94vw;height:calc(100vh - 120px);
  background:var(--panel);border-left:1px solid var(--hairStrong);
  box-shadow:var(--shadow);transform:translateX(102%);transition:transform .22s cubic-bezier(.2,.8,.2,1);
  z-index:60;display:flex;flex-direction:column}
.detail.open{transform:none}
.dhd{padding:14px 18px;border-bottom:1px solid var(--hair);display:flex;gap:10px;align-items:flex-start}
.dhd .dclose{margin-left:auto;cursor:pointer;color:var(--ink3);font-size:22px;line-height:1;border:none;background:none}
.dhd .dclose:hover{color:var(--ink)}
[data-kbd]:focus-visible,.mapwrap:focus-visible,.dhd .dclose:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
g[data-kbd]:focus-visible>rect,g[data-kbd]:focus-visible>circle{stroke:var(--ink);stroke-width:3}
.dhd h3{margin:0;font-size:15px;line-height:1.3;font-weight:800}
.dhd .dsub{font-size:11px;color:var(--ink2);margin-top:3px}
.dbody{overflow:auto;padding:14px 18px 30px}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
.badge{font-size:10.5px;font-weight:800;border-radius:6px;padding:3px 8px;letter-spacing:.3px;border:1px solid var(--hair)}
.badge.sev-CRIT{background:color-mix(in srgb,var(--crit) 10%,transparent);border-color:var(--crit);color:var(--crit-ink)}
.badge.sev-HIGH{background:color-mix(in srgb,var(--high) 10%,transparent);border-color:var(--high);color:var(--high-ink)}
.badge.sev-MED{background:color-mix(in srgb,var(--med) 12%,transparent);border-color:var(--med);color:var(--med-ink)}
.badge.sev-LOW{background:color-mix(in srgb,var(--low) 12%,transparent);border-color:var(--low);color:var(--low-ink)}
.badge.st-resolved{background:color-mix(in srgb,var(--live) 10%,transparent);border-color:var(--done);color:var(--done-ink)}
.badge.st-open{background:var(--open-bg);border-color:var(--open-line);color:var(--open-ink)}
.badge.st-in-progress{background:color-mix(in srgb,var(--plan) 10%,transparent);border-color:var(--plan);color:var(--plan-ink)}
.badge.scope{background:var(--paper2);color:var(--ink2)}
.badge.cve{background:color-mix(in srgb,var(--crit) 8%,transparent);border-color:var(--alarm);color:var(--alarm-ink)}
.dfield{margin:0 0 13px}
.dfield .dk{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--ink3);margin-bottom:3px}
.dfield .dv{font-size:12.5px;color:var(--ink);line-height:1.5}
.dfield .dv.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--ink2)}
.session-flag{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;color:var(--done);
  background:color-mix(in srgb,var(--live) 8%,transparent);border:1px solid color-mix(in srgb,var(--live) 40%,transparent);border-radius:7px;padding:4px 9px;margin-bottom:12px}
.dsection-h{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--ink3);
  margin:18px 0 8px;padding-bottom:5px;border-bottom:2px solid var(--hair);display:flex;align-items:center;gap:8px}
.dsection-h .pip{width:9px;height:9px;border-radius:50%}
.issuelist{margin-top:6px}
.issuelink{display:flex;gap:9px;align-items:center;padding:7px 9px;border-radius:8px;cursor:pointer;border:1px solid transparent}
.issuelink:hover{background:var(--paper2);border-color:var(--hair)}
.issuelink .il-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
.issuelink .il-t{flex:1;font-size:12px;line-height:1.35}
.issuelink .il-s{font-size:9.5px;color:var(--ink3);text-transform:uppercase;letter-spacing:.4px}
.issuelink.il-hidden{display:none}
.iss-filtered{color:var(--ink3);font-weight:500;text-transform:none;letter-spacing:0}
/* CVE list rows */
.cvelist{margin-top:4px;border:1px solid var(--hair);border-radius:9px;overflow:hidden}
.cverow{display:grid;grid-template-columns:14px 1fr auto;gap:9px;align-items:center;padding:7px 10px;
  border-top:1px solid var(--hair);font-size:11.5px}
.cverow:first-child{border-top:none}
.cverow:nth-child(even){background:var(--paper2)}
.cverow .cv-sev{width:9px;height:9px;border-radius:50%}
.cverow .cv-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:var(--ink)}
.cverow .cv-pkg{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;color:var(--ink3);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cverow .cv-fix{font-size:10px;color:var(--done);font-weight:700;white-space:nowrap}
.cverow a.cv-id{color:var(--plan);text-decoration:none}
.cverow a.cv-id:hover{text-decoration:underline}
.cvepend{padding:10px 12px;border:1px dashed var(--open-line);border-radius:9px;color:var(--muted);font-size:12px;background:var(--paper2)}

/* ---- SVG element styles (transit signage) ---- */
#map text{fill:var(--ink);font-family:var(--transport)}
.era-band{fill:var(--era)}
.era-band.now{fill:var(--era-now)}
.era-band.target{fill:var(--era-target)}
.era-grid{stroke:var(--era-grid);stroke-width:1}
.era-label{font-size:15px;font-weight:800;fill:var(--ink)}
.era-sub{font-size:10.5px;fill:var(--ink3)}
.era-tag{font-size:10px;font-weight:800;letter-spacing:.6px}
.track{fill:none;stroke-linecap:round;stroke-linejoin:round}
.track.ghost{stroke-dasharray:3 7;opacity:.5}
.ic-cap{fill:var(--cap);stroke:var(--ink);stroke-width:3}
.ic-cap.now{stroke-width:4}
.ic-now-band{fill:var(--now-band)}
.track-head-label{font-size:11.5px;font-weight:700;fill:var(--ink)}
.bullet-txt{font-size:9.5px;font-weight:800;fill:#fff}
/* No fill rule for .wave-roundel: any CSS fill outranks the status colour the roundel carries as an
   attribute. Its text needs the #map prefix to outrank #map text. */
#map .wave-roundel-txt{font-size:9px;font-weight:800;fill:#fff}
.blocked-sq{fill:var(--block)}
.cvebadge-bg{fill:var(--cap);stroke-width:1.6}
.cvebadge-txt{font-size:9.5px;font-weight:800}
.cvebadge-crit{fill:var(--alarm)}
.mk{cursor:pointer}
.mk-hit{opacity:0}
.dimmed{opacity:.16;transition:opacity .15s}
.infra-track{stroke:var(--line2)}
.infra-label{font-size:9.5px;fill:var(--mut);font-weight:700}

@media (max-width:1180px){ .rail{display:none} }

/* ---- Remediation Log panel (isolated) ---- */
.remlog{margin:0 18px 22px;border:1px solid var(--hair);border-radius:10px;background:var(--panel);overflow:hidden}
.remlog-sum{cursor:pointer;list-style:none;display:flex;align-items:center;gap:12px;padding:11px 16px;font-weight:800;color:var(--ink);user-select:none}
.remlog-sum::-webkit-details-marker{display:none}
.remlog-sum::before{content:"\\25B8";color:var(--ink3);font-size:12px;transition:transform .15s}
.remlog[open] .remlog-sum::before{transform:rotate(90deg)}
.remlog-title{font-size:13px;letter-spacing:.3px}
.remlog-meta{display:flex;align-items:center;gap:8px;color:var(--ink3);font-weight:700;font-size:11px}
.rl-chip{padding:2px 7px;border-radius:999px;font-size:10px;font-weight:800;color:#fff;background:var(--rl)}
.remlog-body{max-height:340px;overflow:auto;border-top:1px solid var(--hair);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.5}
.rl-row{display:grid;grid-template-columns:62px 92px 150px 52px 1fr;gap:8px;padding:3px 16px;border-left:3px solid var(--rl);align-items:baseline}
.rl-row:nth-child(odd){background:var(--paper2)}
.rl-ts{color:var(--ink3)}
.rl-hash{color:var(--plan);font-weight:700}
.rl-scope{color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rl-sev{color:var(--rl);font-weight:800}
.rl-msg{color:var(--ink);white-space:pre-wrap;word-break:break-word}
`;

// Client JS — single-mainline SVG layout, filters, tree, detail panel.
const APP_JS = String.raw`
(function(){
'use strict';
const DATA = window.__DATA__;
const SEV_COLOR = {CRIT:'var(--crit)',HIGH:'var(--high)',MED:'var(--med)',LOW:'var(--low)'};
const CVE_SEV = {CRITICAL:'var(--crit)',HIGH:'var(--high)',MEDIUM:'var(--med)',LOW:'var(--low)'};
const ALARM='var(--crit)';
const SVGNS='http://www.w3.org/2000/svg';
const $ = (s,r)=> (r||document).querySelector(s);
const el = (tag,attrs,kids)=>{ const n=document.createElementNS(SVGNS,tag);
  if(attrs) for(const k in attrs){ if(attrs[k]!=null) n.setAttribute(k,attrs[k]); }
  if(kids) (Array.isArray(kids)?kids:[kids]).forEach(k=> n.appendChild(typeof k==='string'?document.createTextNode(k):k));
  return n; };

// ---- index nodes by name so a track can reach its modernization issues ----
const NODE_BY_NAME = {};
const SUB_BY_NODE = {};
DATA.subsystems.forEach(sub=> sub.nodes.forEach(n=>{ if(!NODE_BY_NAME[n.name]){ NODE_BY_NAME[n.name]=n; SUB_BY_NODE[n.name]=sub; } }));

// ---- version-era axis (top->bottom) ----
const AXIS = DATA.versionAxis;
const axisIndex = {}; AXIS.forEach((a,i)=> axisIndex[a.id]=i);

// ---- the two anchors the layout hangs off, resolved by BAND/INDEX from the axis itself ----
// ENTRY = where the fleet joins the mainline: the first non-legacy band. Tracks, the infra siding
//         and the apps siding all start here.
// TRUNK = the interchange the fleet converged on: where the CVE badges hang, where the wave fans
//         land, and where the "continued to the era it actually REACHED" segment begins. Which era
//         that is, is a PROGRAM fact rather than a geometric one — a fleet can converge on one era
//         and then keep moving, so the anchor stays put while the axis grows past it — so an axis
//         entry may claim it with trunk:true; otherwise it is the 'now' band, else the last era.
// Both were literal era ids (legacy/boot2/boot3212/boot35/boot41). On any project whose axis uses
// different ids every one of them was undefined and the trunk rendered as "M x undefined L x undefined".
const eraAt = (i)=> AXIS[Math.max(0,Math.min(AXIS.length-1,i))].id;
const ENTRY_ERA = (AXIS.find(a=>a.band!=='legacy')||AXIS[0]).id;
const TRUNK_ERA = (AXIS.find(a=>a.trunk)||AXIS.find(a=>a.band==='now')||AXIS[AXIS.length-1]).id;
const TRACKS = DATA.tracks || [];
const INFRA = DATA.infraSiding || [];
// Original-baseline totals, measured ONCE here — the baseline toggle SWAPS cve<->cveOriginal in
// place, so anything computed after a toggle would report the wrong side. null when this project
// ships no original baseline at all (and the toggle is then not rendered).
const HAS_ORIG = [...TRACKS, ...INFRA].some(t=>t.cveOriginal);
const ORIG_CRIT = HAS_ORIG
  ? [...TRACKS, ...INFRA].reduce((a,t)=> a + ((t.cveOriginal&&t.cveOriginal.CRITICAL)||0), 0)
  : null;

// ---- geometry constants (1x) ----
const CANVAS_W = 1280, MARGIN_TOP = 150, LEFT_GUTTER = 232, BOTTOM = 90;
const ERA_GAP = 168;                       // centre-to-centre between era stops
const ERA_Y = {}; AXIS.forEach((a,i)=> ERA_Y[a.id]= MARGIN_TOP + i*ERA_GAP);
const TRACK_GAP = 14, TRACK_W = 6;
const BUNDLE_W = (TRACKS.length-1)*TRACK_GAP;
const BUNDLE_MID = LEFT_GUTTER + 60 + BUNDLE_W/2 + 40;
const BUNDLE_LEFT = BUNDLE_MID - BUNDLE_W/2;
const R = 28;                              // fillet radius for 45-degree bends
const INFRA_GAP = 22, INFRA_OFFSET = 96;   // infra siding sits right of the bundle
const CANVAS_H = MARGIN_TOP + (AXIS.length-1)*ERA_GAP + ERA_GAP*0.6 + BOTTOM;
// non-service repos siding sits right of the infra siding (off the era axis, grouped by kind)
const APPS = (DATA.appsSiding && DATA.appsSiding.groups) || [];
const INFRA_RIGHT = BUNDLE_LEFT + BUNDLE_W + INFRA_OFFSET + (INFRA.length-1)*INFRA_GAP;
const APPS_X = INFRA_RIGHT + 70;
const FULL_W = APPS.length ? (APPS_X + 220) : (INFRA_RIGHT + 220);

function trackX(index){ return BUNDLE_LEFT + index*TRACK_GAP; }
function infraX(i){ return BUNDLE_LEFT + BUNDLE_W + INFRA_OFFSET + i*INFRA_GAP; }

// ---- state ----
const state = {
  sev:{CRIT:true,HIGH:true,MED:true,LOW:true},
  status:{resolved:true,open:true,'in-progress':true},
  collapsed:{},
  activeNode:null,
  cveWeight:false,     // toggle: weight/colour tracks by CVE load
  baselineMode:'patched', // 'patched' = node.cve (current scan) | 'original' = node.cveOriginal
};
// Filter predicate for the issue list in the node detail panel. It was DEFINED AND NEVER CALLED,
// which made the Crit/High/Med/Low + Resolved/In-progress/Open chips inert: a user clicked them and
// nothing happened. It is now wired (showNode + applyIssueFilter).
// A severity or status the toolbar has no chip for (e.g. issues carrying severity 'INFO') is NOT
// filterable, so it stays VISIBLE — an unfilterable item must never be silently hidden by a filter
// the user cannot see or switch off.
function issueVisible(iss){
  const s = state.sev[iss.severity], t = state.status[iss.status];
  return (s === undefined ? true : s) && (t === undefined ? true : t);
}

// CVE load -> stroke width when weighting is on (CRITICAL-dominant)
function cveWeightWidth(t){
  const cv=t.cve||{}; const score=(cv.CRITICAL||0)*4 + (cv.HIGH||0)*0.25;
  return Math.max(4, Math.min(13, 4 + score*0.5));
}
function cveLoadColour(t){
  const cv=t.cve||{};
  if((cv.CRITICAL||0)>=5) return 'color-mix(in srgb,var(--crit) 75%,var(--ink))';
  if((cv.CRITICAL||0)>=1) return 'var(--crit)';
  if((cv.HIGH||0)>=1) return 'var(--high)';
  return 'var(--med)';
}

// ---- a rounded 45/90 path builder for fan arcs (concentric, constant gap) ----
// returns a path from (x,yTop) straight down, optional x-shift handled by caller.
function vline(x,y0,y1){ return 'M '+x+' '+y0+' L '+x+' '+y1; }

// ---- RENDER ----
function render(){
  const svg = el('svg',{id:'map',width:FULL_W,height:CANVAS_H,viewBox:'0 0 '+FULL_W+' '+CANVAS_H});

  // background paper
  svg.appendChild(el('rect',{x:0,y:0,width:FULL_W,height:CANVAS_H,style:'fill:var(--paper)'}));

  // ---- era bands + gridlines + left-gutter labels ----
  AXIS.forEach((a,i)=>{
    const y = ERA_Y[a.id];
    const bandTop = y - ERA_GAP/2, bandH = ERA_GAP;
    const cls = a.band==='now'?'era-band now':a.band==='target'?'era-band target':'era-band';
    if(i%2===0 || a.band==='now' || a.band==='target')
      svg.appendChild(el('rect',{x:0,y:Math.max(0,bandTop),width:FULL_W,height:bandH,class:cls}));
    svg.appendChild(el('line',{x1:LEFT_GUTTER-12,y1:y,x2:FULL_W-20,y2:y,class:'era-grid'}));
    // left-gutter era label
    const g = el('g',{transform:'translate(18,'+y+')'});
    g.appendChild(el('text',{x:0,y:-4,class:'era-label'}, a.era));
    g.appendChild(el('text',{x:0,y:13,class:'era-sub'}, a.sub));
    const tag = a.band==='now'?'YOU ARE HERE':a.band==='target'?'NEXT':a.band==='future'?'HORIZON':a.band==='legacy'?'ORIGIN':'';
    if(tag){
      const col = a.band==='now'?'var(--attest)':a.band==='target'?'var(--part)':a.band==='legacy'?'var(--plan)':'var(--dim)';
      g.appendChild(el('text',{x:0,y:29,class:'era-tag',fill:col}, tag));
    }
    svg.appendChild(g);
  });
  // axis spine
  svg.appendChild(el('line',{x1:LEFT_GUTTER-12,y1:MARGIN_TOP-40,x2:LEFT_GUTTER-12,y2:CANVAS_H-50,style:'stroke:var(--spine)','stroke-width':1.5}));

  const yEntry=ERA_Y[ENTRY_ERA], yTrunk=ERA_Y[TRUNK_ERA];

  // ============ 1) TRACKS — the bundled parallel trunk ============
  // Each track: solid from the entry era down through the trunk interchange, then on to whatever
  // era it actually reached. A roster entry may name a 'plannedEra' it is committed to but has not
  // reached; that shows as continued presence at the later interchange.
  TRACKS.forEach(t=>{
    const x = trackX(t.index);
    const colour = state.cveWeight ? cveLoadColour(t) : t.colour;
    const w = state.cveWeight ? cveWeightWidth(t) : TRACK_W;
    const node = NODE_BY_NAME[t.id];

    const g = el('g',{class:'mk track-grp','data-node':t.id});
    // hit target (wide invisible stroke for easy clicking)
    g.appendChild(el('path',{d:vline(x,yEntry,yTrunk),class:'mk-hit',stroke:'#000','stroke-width':TRACK_GAP,fill:'none'}));
    // solid trunk entry -> trunk interchange
    g.appendChild(el('path',{d:vline(x,yEntry,yTrunk),class:'track',stroke:colour,'stroke-width':w}));
    // entry cap
    g.appendChild(el('circle',{cx:x,cy:yEntry,r:w*0.55+1,fill:colour}));

    // continuation past the trunk interchange: SOLID down to the era actually REACHED
    const yEnd = ERA_Y[t.reachedEra] || yTrunk;
    if(yEnd > yTrunk){
      g.appendChild(el('path',{d:vline(x,yTrunk,yEnd),class:'track',stroke:colour,'stroke-width':w}));
      g.appendChild(el('circle',{cx:x,cy:yEnd,r:w*0.55+1.5,fill:colour}));   // "reached" terminus cap
    }
    if(t.retired){
      // decommissioned — black stop square at its last era
      g.appendChild(el('rect',{x:x-4,y:yTrunk-4,width:8,height:8,class:'blocked-sq'}));
    }

    // ---- track head: colour bullet + vertical service label above the entry line ----
    const headY = yEntry - 46;
    const bg = el('g',{transform:'translate('+x+','+headY+')'});
    // leader from bullet down to track start
    bg.appendChild(el('line',{x1:0,y1:14,x2:0,y2:(yEntry-headY),stroke:colour,'stroke-width':1.4,opacity:.5}));
    // rounded-square bullet (T-number style)
    bg.appendChild(el('rect',{x:-7,y:-7,width:14,height:14,rx:3.5,fill:colour}));
    // bullet glyph = first letter of short
    bg.appendChild(el('text',{x:0,y:1,'text-anchor':'middle','dominant-baseline':'middle',class:'bullet-txt'}, t.short.slice(0,2).toUpperCase()));
    // vertical service label
    const lab = el('text',{x:0,y:-12,'text-anchor':'start',class:'track-head-label',transform:'rotate(-90 0 -12)'}, t.short);
    bg.appendChild(lab);
    g.appendChild(bg);

    // hover/click -> node detail
    g.appendChild(el('title',{}, t.cve==null ? (t.id+'  ·  CVEs not measured') : (t.id+'  ·  C'+(t.cve.CRITICAL||0)+' H'+(t.cve.HIGH||0)+' M'+(t.cve.MEDIUM||0)+' L'+(t.cve.LOW||0))));
    g.addEventListener('click',()=>{ if(node) showNode(node, SUB_BY_NODE[t.id], t); });
    kbd(g);
    svg.appendChild(g);
  });

  // ============ 2) FAN movements (wave fan-in / fan-out) ============
  // Convergence INTO the now band: a subtle arc sweep above it. We draw light guide arcs on the
  // OUTER tracks bending toward the bundle just above the now band.
  drawWaveFans(svg);

  // ============ 3) ERA INTERCHANGES — white-ring capsules across the bundle ============
  AXIS.forEach(a=>{
    // a track is present at this era only within its [enter..reach(+ghost)] extent.
    const y = ERA_Y[a.id];
    const present = TRACKS.filter(t=> eraPresent(t,a.id));
    if(!present.length) return; // no app track present at this era -> no capsule
    const xs = present.map(t=> trackX(t.index));
    const xL = xs.length? Math.min(...xs): BUNDLE_LEFT;
    const xR = xs.length? Math.max(...xs): BUNDLE_LEFT+BUNDLE_W;
    const isNow = a.band==='now';
    const capPadX = 16, capH = isNow?26:22;
    if(isNow){
      // CURRENT hero: highlight band behind the capsule
      svg.appendChild(el('rect',{x:xL-capPadX-4,y:y-capH/2-5,width:(xR-xL)+2*capPadX+8,height:capH+10,rx:(capH+10)/2,class:'ic-now-band'}));
    }
    // the capsule (stadium): white fill + thick black ring across all present tracks
    svg.appendChild(el('rect',{x:xL-capPadX,y:y-capH/2,width:(xR-xL)+2*capPadX,height:capH,rx:capH/2,
      class:'ic-cap'+(isNow?' now':'')}));
    // ticks: small black notch per present track centre
    present.forEach(t=>{ const x=trackX(t.index);
      svg.appendChild(el('line',{x1:x,y1:y-3,x2:x,y2:y+3,style:'stroke:var(--ink)','stroke-width':1.4,opacity:.5})); });
    // era count label to the right of the capsule.
    // "WHOLE FLEET CONVERGED" used to print for EVERY 'now' band regardless of how many tracks
    // actually reached it — asserting a completion that had not happened. It is now a measured
    // claim: at the now band we always show present/total, and the word "converged" appears only
    // when those two are equal. A partial state is never reported as a complete one.
    // ARRIVED, not merely present. eraPresent() deliberately counts a track the roster has
    // committed to an era via plannedEra but has NOT reached — right for drawing the line, wrong
    // for claiming convergence, because a fleet where every track is only PLANNED for the now band
    // would have announced "WHOLE FLEET CONVERGED" having arrived nowhere. The count shown is the
    // arrived one, so the label and the claim rest on the same number.
    const arrived = TRACKS.filter(t=> axisIndex[t.reachedEra]!=null && axisIndex[t.reachedEra]>=axisIndex[a.id]);
    const converged = isNow && TRACKS.length>0 && arrived.length===TRACKS.length;
    svg.appendChild(el('text',{x:xR+capPadX+10,y:y+3.5,'font-size':10,'font-weight':800,fill: isNow?'var(--attest)':'var(--mut)'},
      isNow ? (arrived.length+' / '+TRACKS.length+' tracks'+(converged?' · WHOLE FLEET CONVERGED':' · partial'))
            : (present.length+' tracks')));
  });

  // ============ 4) WAVE roundels + KC-migrate SPAN capsule ============
  (DATA.waves||[]).forEach(w=>{
    const col = w.status==='done'?'var(--live)':w.status==='planned'?'var(--attest)':'var(--dim)';
    if(w.axis==='now-span' && w.spanFrom && w.spanTo){
      // KC migrate SPAN: long capsule straddling legacy->CURRENT on the right of the bundle (IAM side)
      const yA=ERA_Y[w.spanFrom], yB=ERA_Y[w.spanTo];
      const xx = BUNDLE_LEFT + BUNDLE_W + 34;
      const capW=20;
      const grp=el('g',{class:'mk','data-wave':w.id,cursor:'pointer'});
      grp.appendChild(el('rect',{x:xx-capW/2,y:yA,width:capW,height:(yB-yA),rx:capW/2,style:'fill:var(--cap)',stroke:col,'stroke-width':3}));
      // the capsule names THIS wave. Both lines used to be literal strings naming one client's
      // identity-server migration, drawn across every project that declared any now-span wave.
      grp.appendChild(el('text',{x:xx+16,y:(yA+yB)/2,'font-size':10,'font-weight':800,fill:col,transform:'rotate(0)'}, w.short||w.label||w.id));
      grp.appendChild(el('text',{x:xx+16,y:(yA+yB)/2+13,'font-size':8.5,fill:col}, 'SPAN interchange'+(w.spanNote?' · '+w.spanNote:'')));
      grp.addEventListener('click',()=> showWave(w)); kbd(grp,'wave '+(w.short||w.label||w.id));
      svg.appendChild(grp);
      return;
    }
    const y=ERA_Y[w.axis]; if(y==null) return;
    // roundel chip just left of the bundle at the wave's era
    const rx = BUNDLE_LEFT - 30;
    const grp=el('g',{class:'mk','data-wave':w.id,cursor:'pointer'});
    const dash = w.status==='done'?null:w.status==='planned'?'8 5':'2 7';
    // connector tick into the bundle
    grp.appendChild(el('line',{x1:rx+10,y1:y,x2:BUNDLE_LEFT-2,y2:y,stroke:col,'stroke-width':2.5,'stroke-dasharray':dash,opacity:.8}));
    grp.appendChild(el('rect',{x:rx-36,y:y-9,width:46,height:18,rx:9,class:'wave-roundel',fill:col}));
    // roundel text is the wave's own 'short' (it has to fit a 46px chip); the id ladder this
    // replaces only ever recognised one project's three wave ids, printing a bare "Wave" for the rest.
    grp.appendChild(el('text',{x:rx-13,y:y+1,'text-anchor':'middle','dominant-baseline':'middle',class:'wave-roundel-txt'},
      w.short||'Wave'));
    grp.appendChild(el('text',{x:rx-60,y:y+1,'text-anchor':'end','dominant-baseline':'middle','font-size':9,'font-weight':700,fill:col},
      w.status.toUpperCase()));
    grp.addEventListener('click',()=> showWave(w)); kbd(grp,'wave '+(w.short||w.label||w.id));
    svg.appendChild(grp);
  });

  // ============ 5) CVE BADGES — one per track, leader from CURRENT to a readable worst-first column ============
  drawCveBadgeColumn(svg, yTrunk);

  // ============ 6) INFRA SIDING (muted grey bundle, offset right) ============
  drawInfraSiding(svg);
  drawAppsSiding(svg);

  // (per-track resolution-emphasis rings removed — they went stale after the session)

  const wrap=$('#map-wrap'); wrap.innerHTML=''; wrap.appendChild(svg);
  applyFilterDim();
}

// which eras a track occupies (for interchange presence)
function eraPresent(t,eraId){
  const enter=axisIndex[t.enteredEra]!=null?axisIndex[t.enteredEra]:axisIndex[ENTRY_ERA];
  const reach=axisIndex[t.reachedEra];
  const i=axisIndex[eraId];
  if(i==null) return false;
  // present from entry through reached — plus a 'plannedEra' the roster has committed the track to
  // but not yet reached (this was a hardcoded cohort name mapped to a hardcoded era id).
  let maxI=reach;
  if(axisIndex[t.plannedEra]!=null) maxI=Math.max(maxI,axisIndex[t.plannedEra]);
  return i>=enter && i<=maxI;
}

// Wave fan-in arcs: a light concentric sweep on the OUTER tracks just above the trunk interchange.
function drawWaveFans(svg){
  const yTrunk=ERA_Y[TRUNK_ERA], yPrev=ERA_Y[eraAt(axisIndex[TRUNK_ERA]-1)];
  // draw faint guide arcs from the era above the trunk converging — purely decorative hallmark motif
  const midY=(yPrev+yTrunk)/2;
  const g=el('g',{opacity:.22});
  // outermost few tracks get a gentle bend hint toward bundle centre
  [0,1,TRACKS.length-2,TRACKS.length-1].forEach(idx=>{
    if(idx<0||idx>=TRACKS.length) return;
    const t=TRACKS[idx]; const x=trackX(t.index);
    const dir = x<BUNDLE_MID?1:-1;
    const x2=x+dir*10;
    g.appendChild(el('path',{d:'M '+x+' '+yPrev+' C '+x+' '+midY+' '+x2+' '+midY+' '+x2+' '+yTrunk,
      fill:'none',stroke:state.cveWeight?cveLoadColour(t):t.colour,'stroke-width':2}));
  });
  svg.appendChild(g);
}

// CVE badge column to the right of the bundle, one chip per track at CURRENT, leader to the track.
function drawCveBadgeColumn(svg, y){
  const colX = BUNDLE_LEFT + BUNDLE_W + 34; // (kept clear of the span capsule, further right via different y use)
  // Actually place badges immediately right of EACH track stroke, stacked in a tight 24-row column.
  // Build a compact column: chips sorted by track.index, each at y but pushed into a vertical ladder near CURRENT.
  const chipW=58, chipH=15, gap=2;
  const ladderX = BUNDLE_LEFT + BUNDLE_W + 150;
  const totalH = TRACKS.length*(chipH+gap);
  let startY = y - totalH/2;
  // order chips by descending CRITICAL then HIGH for a readable worst-first ladder
  // An UNMEASURED track (t.cve undefined) sorts last and renders a grey "not measured" chip. It
  // used to be built as a zero, so it sorted with the clean tracks and printed C0 H0 — a scan that
  // never happened, shown as a scan that found nothing.
  const cvOf = (t)=> t.cve||{};
  const measured = (t)=> t.cve!=null;
  const ordered=[...TRACKS].sort((a,b)=>
    (measured(b)-measured(a)) || ((cvOf(b).CRITICAL||0)-(cvOf(a).CRITICAL||0)) || ((cvOf(b).HIGH||0)-(cvOf(a).HIGH||0)));
  ordered.forEach((t,k)=>{
    const cy = startY + k*(chipH+gap) + chipH/2;
    const tx = trackX(t.index);
    const node=NODE_BY_NAME[t.id];
    const cv = cvOf(t);
    const maxSev = !measured(t)?'var(--plan)':cv.CRITICAL>0?'var(--crit)':cv.HIGH>0?'var(--high)':cv.MEDIUM>0?'var(--med)':'var(--plan)';
    const g=el('g',{class:'mk','data-node':t.id,cursor:'pointer'});
    // leader from track @ CURRENT to chip
    g.appendChild(el('path',{d:'M '+tx+' '+y+' C '+(tx+30)+' '+y+' '+(ladderX-26)+' '+cy+' '+(ladderX)+' '+cy,
      fill:'none',stroke:maxSev,'stroke-width':1,opacity:.3}));
    // chip — white rounded-rect, border tinted by max severity, size hint by CRITICAL
    const bw = chipW + Math.min(10, (cv.CRITICAL||0)*1.4);
    g.appendChild(el('rect',{x:ladderX,y:cy-chipH/2,width:bw,height:chipH,rx:chipH/2,
      class:'cvebadge-bg'+(measured(t)?'':' cve-unmeasured'),stroke:maxSev,
      'stroke-width':(cv.CRITICAL||0)>0?1.8:1.3,'stroke-dasharray':measured(t)?'':'2 2'}));
    // colour bullet matching track
    g.appendChild(el('rect',{x:ladderX+5,y:cy-3.5,width:7,height:7,rx:2,fill:state.cveWeight?cveLoadColour(t):t.colour}));
    if(measured(t)){
      // red dot + Cn Hn
      g.appendChild(el('circle',{cx:ladderX+18,cy:cy,r:2.4,fill:'var(--crit)'}));
      g.appendChild(el('text',{x:ladderX+24,y:cy+3,class:'cvebadge-txt'},
        'C'+(cv.CRITICAL||0)+'  H'+(cv.HIGH||0)));
      g.appendChild(el('title',{}, t.id+' — CRITICAL '+(cv.CRITICAL||0)+' · HIGH '+(cv.HIGH||0)+' · MEDIUM '+(cv.MEDIUM||0)+' · LOW '+(cv.LOW||0)+' (total '+(cv.total||0)+')'));
    } else {
      g.appendChild(el('text',{x:ladderX+16,y:cy+3,class:'cvebadge-txt',fill:'var(--plan)'},'not measured'));
      g.appendChild(el('title',{}, t.id+' — no CVE snapshot for this project; this is not a zero'));
    }
    g.addEventListener('click',()=>{ if(node) showNode(node, SUB_BY_NODE[t.id], t); });
    kbd(g);
    svg.appendChild(g);
  });
  // column header (reflects the active CVE baseline)
  const baseHdr = state.baselineMode==='original' ? 'CVE @ ORIGINAL (committed HEAD)' : 'CVE @ CURRENT (per container)';
  const baseSub = state.baselineMode==='original' ? 'true pre-migration baseline · worst-first · C=crit H=high · click = detail' : 'worst-first · C=critical H=high · click = detail';
  svg.appendChild(el('text',{x:ladderX,y:startY-10,'font-size':10,'font-weight':800,fill:'var(--crit)'}, baseHdr));
  svg.appendChild(el('text',{x:ladderX,y:startY+2,'font-size':8.5,fill:'var(--mut)'}, baseSub));
}

// Infra siding: grey vertical tracks offset right; un-scanned images get a scan-pending chip.
function drawInfraSiding(svg){
  // Derive the siding extent from the version axis (NOT hardcoded era ids) so that advancing
  // the fleet — adding a future era to migration-state.json versionAxis — extends the siding too.
  // Top = the fleet-entry era (where app tracks also enter); bottom = the last era.
  const lastEra = AXIS[AXIS.length - 1].id;
  const yTop = ERA_Y[ENTRY_ERA], yBot = ERA_Y[lastEra];
  // header
  const x0=infraX(0);
  svg.appendChild(el('text',{x:x0,y:yTop-128,'font-size':11,'font-weight':800,fill:'var(--mut)'}, 'INFRA SIDING'));
  svg.appendChild(el('text',{x:x0,y:yTop-46,'font-size':8.5,fill:'var(--plan)'}, 'images · not app tracks'));
  INFRA.forEach((inf,i)=>{
    const x=infraX(i);
    const g=el('g',{class:'mk','data-infra':inf.id,cursor:'pointer'});
    g.appendChild(el('path',{d:vline(x,yTop,yBot),class:'track infra-track','stroke-width':5}));   // infra runs current THROUGH the last era (was pinned at the trunk)
    g.appendChild(el('circle',{cx:x,cy:yBot,r:4,fill:inf.dead?'var(--high)':'var(--dim)'}));   // last-era terminus cap, matching the fleet
    // head bullet
    g.appendChild(el('rect',{x:x-6,y:yTop-22,width:12,height:12,rx:3,fill:inf.dead?'var(--high)':inf.incomplete?'var(--line2)':'var(--dim)'}));
    g.appendChild(el('text',{x:x,y:yTop-36,'text-anchor':'start',class:'infra-label',transform:'rotate(-90 '+x+' '+(yTop-36)+')'}, inf.supersedes ? inf.short+' ⟵ '+inf.supersedes : inf.short));
    // CVE badge at the trunk interchange (same row as the app tracks' badges)
    const cy=ERA_Y[TRUNK_ERA];
    if(inf.incomplete){
      g.appendChild(el('rect',{x:x-22,y:cy-8,width:44,height:16,rx:8,style:'fill:var(--pend-bg);stroke:var(--pend-line)','stroke-width':1.3,'stroke-dasharray':'3 3'}));
      g.appendChild(el('text',{x:x,y:cy+3,'text-anchor':'middle','font-size':7.5,'font-weight':800,fill:'var(--mut)'},'SCAN ⏳'));
      g.appendChild(el('title',{}, inf.id+' — scan pending'+(inf.imageRef?' (deployed '+inf.imageRef+')':'')));
    } else {
      const cv=inf.cve||{};
      const maxSev = cv.CRITICAL>0?'var(--crit)':cv.HIGH>0?'var(--high)':'var(--med)';
      g.appendChild(el('rect',{x:x-22,y:cy-8,width:44,height:16,rx:8,style:'fill:var(--cap)',stroke:maxSev,'stroke-width':inf.dead?1.4:1.6,'stroke-dasharray':inf.dead?'4 3':null}));
      g.appendChild(el('circle',{cx:x-13,cy:cy,r:2.2,fill:'var(--crit)'}));
      g.appendChild(el('text',{x:x-7,y:cy+3,'text-anchor':'start','font-size':7.5,'font-weight':800},'C'+(cv.CRITICAL||0)));
      g.appendChild(el('title',{}, inf.id+(inf.dead?' (DEAD image)':'')+' — C'+(cv.CRITICAL||0)+' H'+(cv.HIGH||0)+' M'+(cv.MEDIUM||0)+' L'+(cv.LOW||0)));
    }
    g.addEventListener('click',()=> showInfra(inf));
    kbd(g);
    svg.appendChild(g);
  });
}

// Apps siding: non-service repos (docs/frontend/config/seeder/tooling) — scanned by commitwork but
// off the version-era axis, so they get a kind-grouped column, not a track.
function drawAppsSiding(svg){
  if(!APPS.length) return;
  let y = ERA_Y[ENTRY_ERA];
  svg.appendChild(el('text',{x:APPS_X,y:y-128,'font-size':11,'font-weight':800,fill:'var(--mut)'},'NON-SERVICE REPOS'));
  svg.appendChild(el('text',{x:APPS_X,y:y-116,'font-size':8.5,fill:'var(--plan)'},'scanned · off the era axis · by kind'));
  const rowH=15;
  for(const grp of APPS){
    svg.appendChild(el('rect',{x:APPS_X,y:y-9,width:9,height:9,rx:2,fill:grp.colour}));
    svg.appendChild(el('text',{x:APPS_X+15,y:y,'font-size':10,'font-weight':800,fill:grp.colour}, grp.label+' ('+grp.repos.length+')'));
    y += rowH+3;
    for(const r of grp.repos){
      const g=el('g',{class:'mk',cursor:r.note?'help':'default'});
      g.appendChild(el('circle',{cx:APPS_X+6,cy:y-3.5,r:2.3,fill:grp.colour,opacity:.75}));
      g.appendChild(el('text',{x:APPS_X+16,y:y,'font-size':9.5,fill:'var(--mut)'}, r.short));
      if(r.note) g.appendChild(el('title',{}, r.short+' — '+r.note));
      svg.appendChild(g);
      y += rowH;
    }
    y += 9;
  }
}

// ---- detail panel ----
const panel = ()=> $('#detail');
// WCAG 2.1.1: everything on this map that takes a click takes Enter and Space too. SVG groups
// have no click(), so the key handler dispatches the same event a pointer would.
function kbd(node,label){
  node.setAttribute('tabindex','0');
  if(!/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/i.test(node.tagName))node.setAttribute('role','button');
  const t=label||(node.querySelector&&node.querySelector('title')&&node.querySelector('title').textContent);
  if(t)node.setAttribute('aria-label',t);
  node.setAttribute('data-kbd','1');
}
document.addEventListener('keydown',e=>{
  if(e.key!=='Enter'&&e.key!==' ')return;
  const t=e.target;
  if(!t||!t.getAttribute||t.getAttribute('data-kbd')!=='1')return;
  e.preventDefault();
  t.dispatchEvent(new MouseEvent('click',{bubbles:true}));
});
// The panel takes focus when it opens and hands it back to whatever opened it when it closes.
let panelOpener=null;
function openPanel(){
  if(!panel().classList.contains('open'))panelOpener=document.activeElement;
  panel().classList.add('open');
  const x=panel().querySelector('.dclose'); if(x)x.focus();
}
function closePanel(){ panel().classList.remove('open'); if(panelOpener&&document.contains(panelOpener)){ const o=panelOpener; panelOpener=null; o.focus(); } }
function sevBadge(s){ return '<span class="badge sev-'+s+'">'+s+'</span>'; }
function stBadge(s){ return '<span class="badge st-'+s+'">'+ (s==='in-progress'?'IN PROGRESS':s.toUpperCase()) +'</span>'; }
function field(k,v,mono){ return '<div class="dfield"><div class="dk">'+escapeHTML(k)+'</div><div class="dv'+(mono?' mono':'')+'">'+escapeHTML(v)+'</div></div>'; }
function chipCount(s,n){ if(!n) return ''; return '<span class="badge sev-'+s+'">'+s+' '+n+'</span>'; }
function wireClose(b){ const x=b.querySelector('.dclose'); if(x) x.addEventListener('click',closePanel); }
function sevRank(s){ return {CRIT:0,HIGH:1,MED:2,LOW:3}[s]; }
function tallyIssues(list){ const t={CRIT:0,HIGH:0,MED:0,LOW:0}; list.forEach(i=> t[i.severity]++); return t; }
// Quotes included: used inside double-quoted attributes (href=, title=, data-iid=, …) below.
function escapeHTML(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function cveSection(node){
  const cve = node.cve;
  // Two DIFFERENT absences, and collapsing them was an unsupported-pass defect: "no image exists to
  // scan" is a fact about this station, while "this project has no CVE layer at all" is a fact
  // about the evidence. Both used to print "nothing to scan", so an entirely unscanned project
  // asserted, on every station, that there was nothing to find. Undefined means unmeasured.
  if(cve===undefined) return '<div class="dsection-h"><span class="pip" style="background:var(--plan)"></span>Container CVEs</div><div class="cvepend cve-unmeasured">Not measured — this project has no container-CVE data. Absence of a scan is not an absence of findings.</div>';
  if(cve===null) return '<div class="dsection-h"><span class="pip" style="background:var(--plan)"></span>Container CVEs</div><div class="cvepend">No container image for this station — nothing to scan.</div>';
  if(cve && cve.incomplete) return '<div class="dsection-h"><span class="pip" style="background:var(--line2)"></span>Container CVEs</div><div class="cvepend">⏳ Scan pending — '+(cve.imageRef?'deployed '+escapeHTML(cve.imageRef):'this image')+' has not completed a scan.</div>';
  const by = cve.bySeverity||{};
  let h='<div class="dsection-h"><span class="pip" style="background:var(--crit)"></span>Container CVEs '+
    (cve.imageRef?('· <span style="font-family:ui-monospace;font-size:10px;color:var(--ink3)">'+escapeHTML(cve.imageRef)+'</span>'):'')+'</div>';
  h+='<div class="badges">'+
    '<span class="badge cve">TOTAL '+(cve.total||0)+'</span>'+
    (by.CRITICAL?'<span class="badge sev-CRIT">CRITICAL '+by.CRITICAL+'</span>':'')+
    (by.HIGH?'<span class="badge sev-HIGH">HIGH '+by.HIGH+'</span>':'')+
    (by.MEDIUM?'<span class="badge sev-MED">MEDIUM '+by.MEDIUM+'</span>':'')+
    (by.LOW?'<span class="badge sev-LOW">LOW '+by.LOW+'</span>':'')+
    (cve.jvmOnly?'<span class="badge scope">JVM-ONLY (no image scan)</span>':'')+'</div>';
  const top = cve.topJvm||[];
  if(top.length){
    h+='<div class="dk" style="margin:2px 0 5px">Top JVM CVEs (jar-level)</div><div class="cvelist">';
    top.forEach(v=>{
      const col=CVE_SEV[v.severity]||'var(--plan)';
      const idCell = v.url?('<a class="cv-id" href="'+escapeHTML(v.url)+'" target="_blank" rel="noopener">'+escapeHTML(v.cve)+'</a>'):('<span class="cv-id">'+escapeHTML(v.cve)+'</span>');
      h+='<div class="cverow">'+
        '<span class="cv-sev" style="background:'+col+'"></span>'+
        '<span style="min-width:0"><span style="display:block">'+idCell+'</span>'+
          '<span class="cv-pkg" title="'+escapeHTML(v.pkg)+'">'+escapeHTML(v.pkg)+' · '+escapeHTML(v.installed)+'</span></span>'+
        '<span class="cv-fix">'+(v.fixed?('→ '+escapeHTML(v.fixed.split(',')[0])):'no fix')+'</span>'+
        '</div>';
    });
    h+='</div>';
  } else if(!cve.jvmOnly){
    h+='<div class="cvepend">Image-level counts only (no jar-level breakdown for this container).</div>';
  }
  if(cve.link) h+='<div class="dfield" style="margin-top:8px"><div class="dv mono">scan: '+escapeHTML(cve.link)+'</div></div>';
  return h;
}

function showIssue(node, iss, sub){
  const b = panel();
  const dot = SEV_COLOR[iss.severity];
  const fields = [];
  fields.push('<div class="badges">'+sevBadge(iss.severity)+stBadge(iss.status)+
    '<span class="badge scope">'+(iss.scope||'').toUpperCase()+'</span>'+
    (iss.phase?'<span class="badge scope">'+iss.phase+'</span>':'')+'</div>');
  if(iss.status==='resolved' && iss.phase==='session')
    fields.push('<div class="session-flag">✓ Resolved this session</div>');
  if(iss.eol) fields.push(field('EOL / risk window', iss.eol, true));
  if(iss.blast) fields.push(field('Blast radius', iss.blast));
  if(iss.remediation) fields.push(field('Remediation', iss.remediation));
  if(iss.effort) fields.push(field('Effort', iss.effort, true));
  fields.push(field('Track / station', sub.subsystemName+'  ·  '+node.name+'  ('+node.kind+')'));
  b.querySelector('.dhd').innerHTML =
    '<div style="width:12px;height:12px;border-radius:50%;background:'+dot+';margin-top:3px;flex:0 0 auto"></div>'+
    '<div style="min-width:0"><h3>'+escapeHTML(iss.title)+'</h3>'+
    '<div class="dsub">'+escapeHTML(node.name)+' · issue '+escapeHTML(iss.id)+'</div></div>'+
    '<button class="dclose" aria-label="Close">×</button>';
  b.querySelector('.dbody').innerHTML = fields.join('');
  wireClose(b);
  openPanel();
}

function showNode(node, sub, track){
  const b = panel();
  const issues = (node.issues||[]).slice().sort((a,z)=> sevRank(a.severity)-sevRank(z.severity));
  const counts = tallyIssues(issues);
  const headColour = (track? (state.cveWeight?cveLoadColour(track):track.colour) : (sub?sub.color:'var(--ink)'));
  const head = '<div style="width:14px;height:14px;border-radius:4px;background:'+headColour+';margin-top:3px;flex:0 0 auto"></div>'+
    '<div style="min-width:0"><h3>'+escapeHTML(node.name)+'</h3>'+
    '<div class="dsub">'+escapeHTML(sub?sub.subsystemName:'')+' · '+escapeHTML(node.kind)+
    (track?(' · track #'+track.index+' · '+track.cohort+(track.blocked?' · BLOCKED':'')):'')+'</div></div>'+
    '<button class="dclose" aria-label="Close">×</button>';
  let body='';
  // ---- CVE section first (it's the new headline) ----
  body += cveSection(node);
  if(track && track.blocked && track.blockReason)
    body += field('Blocker'+(track.targetEra&&AXIS[axisIndex[track.targetEra]]?' — '+AXIS[axisIndex[track.targetEra]].era:''), track.blockReason);
  // ---- modernization section ----
  body += '<div class="dsection-h"><span class="pip" style="background:var(--attest)"></span>Modernization</div>';
  body += '<div class="badges">'+
    chipCount('CRIT',counts.CRIT)+chipCount('HIGH',counts.HIGH)+chipCount('MED',counts.MED)+chipCount('LOW',counts.LOW)+
    '</div>';
  body += field('Current version', node.currentVersion, true);
  const jr = (node.journey||[]).map(j=>{
    const tag = j.state==='now'?' · NOW':j.state==='target'?' · TARGET':j.state==='future'?' · FUTURE':'';
    return '<div style="margin:3px 0"><b style="color:var(--ink)">'+escapeHTML(j.era)+'</b><span style="color:var(--ink3)">'+tag+'</span><br><span style="color:var(--ink2)">'+escapeHTML(j.label)+'</span></div>';
  }).join('');
  body += '<div class="dfield"><div class="dk">Journey</div><div class="dv">'+jr+'</div></div>';
  // The toolbar's severity/status chips filter THIS list (see issueVisible / applyIssueFilter).
  // Each row carries its own severity+status so the filter is a class toggle, never a re-render —
  // and the heading states "N of M" so a filtered list can never be mistaken for the whole list.
  body += '<div class="dfield"><div class="dk">Modernization issues '+
    '(<span class="iss-shown">'+issues.length+'</span> of '+issues.length+')'+
    '<span class="iss-filtered" hidden> · filtered by the toolbar chips</span></div><div class="issuelist">';
  // data-idx is the ROW's position, and it is what the click handler resolves on. data-iid is kept
  // for identification only. Issue ids are not unique in practice — client-a ships SEC-dast-10049
  // twice on one node, carrying two OPPOSITE DAST findings ("Storable and Cacheable Content" and
  // "Non-Storable Content") — so a find()-by-id opened the FIRST row whichever row was clicked, and
  // the reader was shown a different finding from the one they asked for with nothing to indicate it.
  issues.forEach((iss,ix)=>{
    const dot=SEV_COLOR[iss.severity];
    body += '<div class="issuelink" data-idx="'+ix+'" data-iid="'+escapeHTML(iss.id)+'"'+
      ' data-isev="'+escapeHTML(iss.severity)+'" data-istatus="'+escapeHTML(iss.status)+'">'+
      '<span class="il-dot" style="background:'+dot+';'+(iss.status==='open'?'background:var(--cap);border:2px solid '+dot:'')+'"></span>'+
      '<span class="il-t">'+escapeHTML(iss.title)+'</span>'+
      '<span class="il-s">'+escapeHTML(iss.status)+'</span></div>';
  });
  body += '</div></div>';
  b.querySelector('.dhd').innerHTML = head;
  b.querySelector('.dbody').innerHTML = body;
  b.querySelectorAll('.issuelink').forEach(lk=>kbd(lk));
  b.querySelectorAll('.issuelink').forEach(lk=> lk.addEventListener('click',()=>{
    // Resolve positionally against the SAME array the rows were rendered from. Falling back to an
    // id lookup would reinstate the duplicate-id bug for exactly the rows that need it least.
    const iss=issues[Number(lk.dataset.idx)]; if(iss) showIssue(node,iss,sub);
  }));
  wireClose(b);
  applyIssueFilter();
  state.activeNode=node.name; markTreeActive();
  openPanel();
}

// Apply the toolbar's severity/status chips to whatever issue list the detail panel is showing.
// Hiding is a class toggle plus a live "N of M" count, so the user can always see that a filter is
// in force — a shortened list is never presented as the complete one.
function applyIssueFilter(){
  const b=panel(); if(!b) return;
  const rows=b.querySelectorAll('.issuelink'); if(!rows.length) return;
  let shown=0;
  rows.forEach(row=>{
    const vis=issueVisible({severity:row.dataset.isev,status:row.dataset.istatus});
    row.classList.toggle('il-hidden',!vis);
    if(vis) shown++;
  });
  const c=b.querySelector('.iss-shown'); if(c) c.textContent=String(shown);
  const f=b.querySelector('.iss-filtered'); if(f) f.hidden = (shown===rows.length);
}

function showInfra(inf){
  const b=panel();
  const col = inf.incomplete?'var(--line2)':inf.dead?'var(--high)':'var(--dim)';
  b.querySelector('.dhd').innerHTML =
    '<div style="width:13px;height:13px;border-radius:3px;background:'+col+';margin-top:3px;flex:0 0 auto"></div>'+
    '<div style="min-width:0"><h3>'+escapeHTML(inf.id)+'</h3>'+
    '<div class="dsub">infra siding'+(inf.dead?' · DEAD image (not deployed)':'')+(inf.incomplete?' · scan pending':'')+'</div></div>'+
    '<button class="dclose" aria-label="Close">×</button>';
  let body='';
  if(inf.incomplete){
    body+='<div class="cvepend">⏳ Scan pending — '+(inf.imageRef?'deployed '+escapeHTML(inf.imageRef):'this image')+' has not completed a scan.</div>';
  } else {
    const cv=inf.cve||{};
    body+='<div class="badges">'+
      '<span class="badge cve">TOTAL '+(cv.total||0)+'</span>'+
      (cv.CRITICAL?'<span class="badge sev-CRIT">CRITICAL '+cv.CRITICAL+'</span>':'')+
      (cv.HIGH?'<span class="badge sev-HIGH">HIGH '+cv.HIGH+'</span>':'')+
      (cv.MEDIUM?'<span class="badge sev-MED">MEDIUM '+cv.MEDIUM+'</span>':'')+
      (cv.LOW?'<span class="badge sev-LOW">LOW '+cv.LOW+'</span>':'')+'</div>';
    if(inf.imageRef) body+=field('Image', inf.imageRef, true);
    if(inf.dead) body+=field('Note','DEAD local image — replaced by the deployed version; inflates the fleet total but is not running.');
  }
  b.querySelector('.dbody').innerHTML=body;
  wireClose(b); openPanel();
}

function showWave(w){
  const b=panel();
  const col = w.status==='done'?'var(--live)':w.status==='planned'?'var(--attest)':'var(--dim)';
  b.querySelector('.dhd').innerHTML =
    '<div style="width:12px;height:12px;border-radius:50%;background:'+col+';margin-top:3px;flex:0 0 auto"></div>'+
    '<div style="min-width:0"><h3>'+escapeHTML(w.label)+'</h3>'+
    '<div class="dsub">Wave interchange · '+escapeHTML(w.status)+'</div></div>'+
    '<button class="dclose" aria-label="Close">×</button>';
  b.querySelector('.dbody').innerHTML =
    '<div class="badges"><span class="badge '+(w.status==='done'?'st-resolved':w.status==='planned'?'st-in-progress':'st-open')+'">'+w.status.toUpperCase()+'</span></div>'+
    field('What meets here', w.detail);
  wireClose(b); openPanel();
}

// ---- TREE (side rail) ----
function buildTree(){
  const wrap=$('#tree'); wrap.innerHTML='';
  DATA.subsystems.forEach(sub=>{
    const collapsed=!!state.collapsed[sub.subsystemId];
    const div=document.createElement('div');
    div.className='tsub'+(collapsed?' collapsed':'');
    const openN=sub.nodes.reduce((a,n)=>a+(n.issues||[]).filter(i=>i.status==='open').length,0);
    const resN=sub.nodes.reduce((a,n)=>a+(n.issues||[]).filter(i=>i.status==='resolved').length,0);
    const hd=document.createElement('div'); hd.className='thd';
    hd.innerHTML='<span class="swatch" style="background:'+sub.color+'"></span>'+
      '<span class="tname">'+escapeHTML(sub.subsystemName)+'</span>'+
      '<span class="tcount">'+sub.nodes.length+' · '+resN+'✓ / '+openN+'○</span>'+
      '<span class="caret">▾</span>';
    hd.addEventListener('click',()=> toggleSub(sub.subsystemId));
    kbd(hd); hd.setAttribute('aria-expanded',String(!state.collapsed[sub.subsystemId]));
    div.appendChild(hd);
    const nn=document.createElement('div'); nn.className='tnodes';
    sub.nodes.forEach(node=>{
      const row=document.createElement('div'); row.className='tnode'; row.dataset.node=node.name;
      // cve chip
      let cvechip='';
      if(node.cve===null) cvechip='<span class="cvechip">—</span>';
      else if(node.cve&&node.cve.incomplete) cvechip='<span class="cvechip pend">⏳</span>';
      else if(node.cve&&node.cve.bySeverity){ const cc=node.cve.bySeverity.CRITICAL||0; cvechip='<span class="cvechip has">C'+cc+'</span>'; }
      row.innerHTML='<span class="kind">'+escapeHTML(node.kind.slice(0,4))+'</span>'+
        '<span class="nm">'+escapeHTML(node.name)+'</span>'+cvechip;
      kbd(row);
      row.addEventListener('click',()=>{
        const tr=(DATA.tracks||[]).find(t=>t.id===node.name);
        showNode(node,sub,tr); scrollToTrack(node.name);
      });
      nn.appendChild(row);
    });
    div.appendChild(nn);
    wrap.appendChild(div);
  });
  markTreeActive();
}
function markTreeActive(){
  document.querySelectorAll('.tnode').forEach(r=> r.classList.toggle('active', r.dataset.node===state.activeNode));
}
function scrollToTrack(name){
  const t=(DATA.tracks||[]).find(x=>x.id===name); if(!t) return;
  const wrap=$('#map-wrap').parentElement;
  const x=trackX(t.index);
  wrap.scrollLeft = Math.max(0, x - wrap.getBoundingClientRect().width/2);
}
function cssEsc(s){ return String(s).replace(/"/g,'\\"'); }
function toggleSub(id){ state.collapsed[id]=!state.collapsed[id]; buildTree(); }

// ---- filters ----
function applyFilterDim(){
  // dim CVE badges / tracks by max severity present vs active sev filters (CVE severities -> our buckets)
  // (modernization markers were per-issue in the old map; in the mainline the per-track CVE is the load)
  document.querySelectorAll('.track-grp').forEach(g=>{
    const t=(DATA.tracks||[]).find(x=>x.id===g.dataset.node); if(!t) return;
    const cv=t.cve||{};
    const anyVisible = (state.sev.CRIT && cv.CRITICAL>0) || (state.sev.HIGH && cv.HIGH>0) ||
                       (state.sev.MED && cv.MEDIUM>0) || (state.sev.LOW && cv.LOW>0) ||
                       (cv.total===0);
    g.classList.toggle('dimmed', !anyVisible);
  });
}
function wireToolbar(){
  document.querySelectorAll('.chip[data-sev]').forEach(ch=>{
    kbd(ch); ch.setAttribute('aria-pressed',String(ch.classList.contains('on')));
    ch.addEventListener('click',()=>{ const s=ch.dataset.sev; state.sev[s]=!state.sev[s]; ch.classList.toggle('on',state.sev[s]); ch.setAttribute('aria-pressed',String(!!state.sev[s])); applyFilterDim(); applyIssueFilter(); });
  });
  document.querySelectorAll('.chip[data-status]').forEach(ch=>{
    kbd(ch); ch.setAttribute('aria-pressed',String(ch.classList.contains('on')));
    // this handler used to end at the class toggle: the chip lit up and nothing else happened.
    ch.addEventListener('click',()=>{ const s=ch.dataset.status; state.status[s]=!state.status[s]; ch.classList.toggle('on',state.status[s]); ch.setAttribute('aria-pressed',String(!!state.status[s])); applyIssueFilter(); });
  });
  const ea=$('#expandAll'), ca=$('#collapseAll');
  if(ea) ea.addEventListener('click',()=>{ DATA.subsystems.forEach(s=> state.collapsed[s.subsystemId]=false); buildTree(); });
  if(ca) ca.addEventListener('click',()=>{ DATA.subsystems.forEach(s=> state.collapsed[s.subsystemId]=true); buildTree(); });
  const tw=$('#cveWeight');
  if(tw) tw.addEventListener('click',()=>{ state.cveWeight=!state.cveWeight; tw.classList.toggle('on',state.cveWeight);
    tw.textContent = state.cveWeight?'CVE weighting: ON':'Weight tracks by CVE load'; render(); });
  // CVE baseline toggle: swap cve<->cveOriginal on every track + siding so the (unchanged) renderer shows the chosen baseline
  const tb=$('#cveBaseline');
  if(tb) tb.addEventListener('click',()=>{
    const next = state.baselineMode==='patched' ? 'original' : 'patched';
    [...(DATA.tracks||[]), ...(DATA.infraSiding||[])].forEach(t=>{ if(t.cveOriginal){ const tmp=t.cve; t.cve=t.cveOriginal; t.cveOriginal=tmp; } });
    state.baselineMode=next; tb.classList.toggle('on', next==='original');
    // the crit count is measured off this project's own cveOriginal, once, before any swap.
    // It used to be a literal figure: one project's critical count, shown on every project's map.
    tb.textContent = next==='original'
      ? ('CVE: ORIGINAL baseline'+(ORIG_CRIT!=null?' ('+ORIG_CRIT+'C)':''))
      : 'CVE: current scan';
    render();
  });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closePanel(); });
}

function init(){ render(); buildTree(); wireToolbar(); }
if(document.readyState!=='loading') init(); else document.addEventListener('DOMContentLoaded',init);
})();
`;

// Static HTML shell
function kpi(cls, val, label) {
  return `<div class="kpi ${cls}"><b>${esc(val)}</b><span>${esc(label)}</span></div>`;
}
function chip(group, key, label, dotColor, on) {
  const attr = group === 'sev' ? `data-sev="${key}"` : `data-status="${key}"`;
  return `<span class="chip ${on ? 'on' : ''}" ${attr}>${dotColor ? `<span class="dot" style="background:${dotColor}"></span>` : ''}${esc(label)}</span>`;
}

const legendLines = DATA.subsystems.map(s =>
  `<div class="legrow"><span style="width:12px;height:12px;border-radius:3px;background:${s.color};display:inline-block"></span>${esc(s.subsystemName)}</div>`
).join('');

// Remediation Log panel (renders DATA.remediationLog)
function remLogColor(sev) {
  return ({ FATAL:'var(--crit)', ERROR:'var(--crit)', WARN:'var(--high)', INFO:'var(--attest)' })[sev] || 'var(--dim)';
}
function buildRemLogPanel() {
  const log = Array.isArray(DATA.remediationLog) ? DATA.remediationLog : [];
  if (!log.length) return '';
  const sorted = [...log].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const tally = sorted.reduce((m, e) => (m[e.severity] = (m[e.severity] || 0) + 1, m), {});
  const tallyChips = ['FATAL','ERROR','WARN','INFO']
    .filter(s => tally[s])
    .map(s => `<span class="rl-chip" style="--rl:${remLogColor(s)}">${esc(s)} ${tally[s]}</span>`)
    .join('');
  const rows = sorted.map(e => {
    const day = (e.ts || '').slice(0, 10);
    const time = (e.ts || '').slice(11, 19);
    return `<div class="rl-row" data-day="${esc(day)}" style="--rl:${remLogColor(e.severity)}">`
      + `<span class="rl-ts" title="${esc(e.ts)}">${esc(time)}</span>`
      + `<span class="rl-hash">[${esc(e.hash)}]</span>`
      + `<span class="rl-scope">${esc(e.scope)}</span>`
      + `<span class="rl-sev">${esc(e.severity)}</span>`
      + `<span class="rl-msg">${esc(e.message)}</span>`
      + `</div>`;
  }).join('');
  return `<details class="remlog" id="remlog">`
    + `<summary class="remlog-sum"><span class="remlog-title">Remediation Log</span>`
    + `<span class="remlog-meta">${sorted.length} entries${tallyChips}</span></summary>`
    + `<div class="remlog-body">${rows}</div>`
    + `</details>`;
}
const remLogPanel = buildRemLogPanel();

// Security-program panel — from DATA.meta.securityProgram.
const secProgram = (() => {
  const p = DATA.meta.securityProgram; if (!p) return '';
  // Every sub-block is optional; absence renders as absence, never as zero.
  const mon = p.monitor || {};
  const cp = p.cvePosture || {};
  const sc = p.secrets;
  const absent = (what) => `<span class="sp-absent">${esc(what)}</span>`;
  // Guard on the FIELD, never the object — cvePosture:{} is declared-but-unmeasured, not zero.
  const cvePostureMeasured = (o) => ['total', 'crit', 'high', 'med', 'low', 'kev', 'kevCves']
    .some((k) => o[k] != null);
  // An absent count is not a zero — render the grey state, never "undefined".
  const num = (v, suffix = '') => (v == null ? absent('not recorded') : esc(String(v.toLocaleString ? v.toLocaleString() : v)) + suffix);
  const kev = (p.kev || []).slice(0, 4).map(k => `<div class="sp-row"><span class="sp-b sp-kev">KEV</span> <b>${esc(k.package || '')}</b> ${esc(k.cve || '')} · ${k.epss == null ? absent('EPSS not scored') : 'EPSS ' + Math.round(k.epss * 100) + '%'} · ${(k.repos || []).length} repo${(k.repos || []).length === 1 ? '' : 's'}</div>`).join('');
  const top = (p.topRemediation || []).slice(0, 5).map(t => `<div class="sp-row"><span class="sp-b sp-${String(t.severity || '').toLowerCase()}">${esc(String(t.severity || ''))}</span> <b>${esc(t.package || '')}</b> · ${t.cves == null ? absent('CVE count not recorded') : t.cves + ' CVE' + (t.cves === 1 ? '' : 's')}${t.kev ? ' · KEV' : ''}</div>`).join('');
  const bl = p.remediationBacklog || {};
  const glyph = s => s === 'in-progress' ? '◐' : s === 'gated' ? '⚑' : '○';
  const blItems = (bl.items || []).map(i => `<div class="sp-row"><span class="sp-bl">${glyph(i.status)}</span> ${esc(i.item || '')} <b>${i.pw}pw</b></div>`).join('');
  return `<style>
    .secprog{margin:0 0 10px;border:1px solid var(--hair);border-radius:9px;background:var(--panel);overflow:hidden;font-size:11px}
    .secprog>summary{cursor:pointer;list-style:none;padding:8px 11px;background:color-mix(in srgb,var(--live) 10%,var(--panel));color:var(--head);font-weight:800;display:flex;align-items:center;gap:8px}
    .secprog>summary::-webkit-details-marker{display:none}
    .secprog-meta{margin-left:auto;font-weight:600;color:var(--live);font-size:10px}
    .secprog-body{padding:9px 11px}
    .sp-h4{font-weight:800;color:var(--ink);margin:9px 0 4px;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
    .sp-counts{font-size:12px;margin:2px 0 3px}
    .sp-counts .sp-c{color:var(--crit);font-weight:800}.sp-counts .sp-h{color:var(--high);font-weight:800}.sp-counts .sp-m{color:var(--med);font-weight:800}.sp-counts .sp-l{color:var(--low);font-weight:700}.sp-counts .sp-kevn{color:var(--crit)}
    html[data-mode=dark] .sp-counts .sp-c{color:var(--crit-ink)}html[data-mode=dark] .sp-counts .sp-h{color:var(--high-ink)}html[data-mode=dark] .sp-counts .sp-m{color:var(--med-ink)}html[data-mode=dark] .sp-counts .sp-l{color:var(--low-ink)}html[data-mode=dark] .sp-counts .sp-kevn{color:var(--alarm-ink)}
    .sp-sub{color:var(--ink3);font-size:10px;line-height:1.4}
    .sp-row{padding:2px 0;line-height:1.4}
    .sp-b{display:inline-block;min-width:32px;text-align:center;border-radius:4px;padding:0 5px;font-size:.625rem;font-weight:800;color:var(--bg);margin-right:5px}
    .sp-b.sp-crit{background:var(--crit)}.sp-b.sp-high{background:var(--high)}.sp-b.sp-med{background:var(--med)}.sp-b.sp-low{background:var(--low)}.sp-b.sp-kev{background:var(--sev)}
    .sp-scan{display:flex;flex-wrap:wrap;gap:3px}.sp-chip{background:var(--chip-bg);border:1px solid var(--chip-line);border-radius:9px;padding:0 6px;font-size:9.5px;color:var(--chip-ink)}
    .sp-bl-list{max-height:150px;overflow-y:auto}.sp-bl{display:inline-block;width:14px;text-align:center;color:var(--plan);font-weight:800;margin-right:4px}
    .sp-sec b{color:var(--done)}
    .sp-links{margin-top:8px;color:var(--ink3);font-size:9.5px;line-height:1.7;word-break:break-all}.sp-links code{background:var(--paper2);padding:0 3px;border-radius:3px}
    .sp-foot{margin-top:7px;color:var(--pend-ink);font-size:9.5px;border-top:1px solid var(--hair);padding-top:5px;line-height:1.5}
    /* absence is its own state: grey + italic, never a zero and never a blank */
    .sp-absent{color:var(--pend-ink);font-style:italic}
  </style>
  <details class="secprog" open>
    <summary>🛡 Security program<span class="secprog-meta">${mon.tool ? esc(mon.tool) : absent('monitor not declared')}${mon.checks != null ? ' · ' + esc(mon.checks) + ' checks' : ' · ' + absent('check count not reported')}</span></summary>
    <div class="secprog-body">
      ${cvePostureMeasured(cp)
        ? `<div class="sp-counts"><b>${(cp.total || 0).toLocaleString()}</b> npm CVEs · <span class="sp-c">${cp.crit || 0}C</span> <span class="sp-h">${cp.high || 0}H</span> <span class="sp-m">${cp.med || 0}M</span> <span class="sp-l">${cp.low || 0}L</span> · <b class="sp-kevn">${(cp.kevCves != null ? cp.kevCves : (cp.kev || 0))} KEV</b>${(cp.kevCves != null && cp.kev != null && cp.kev !== cp.kevCves) ? ` (${cp.kev} findings)` : ''} · ${cp.epssEnrichedCves || 0} EPSS</div>`
        : `<div class="sp-counts">${absent('CVE posture not measured for this project')}</div>`}
      ${cp.surface ? `<div class="sp-sub">${esc(cp.surface)}</div>` : ''}
      ${p.historicBaseline ? `<div class="sp-sub" title="${esc(p.historicBaseline.note || '')}">↩ was <b>${num(p.historicBaseline.crit, 'C')} / ${num(p.historicBaseline.high, 'H')} / ${num(p.historicBaseline.cves)}</b> — ${p.historicBaseline.label ? esc(p.historicBaseline.label) : absent('baseline not labelled')}</div>` : ''}
      ${kev ? `<div class="sp-h4">🚨 Known-exploited (CISA KEV)</div>${kev}` : ''}
      ${top ? `<div class="sp-h4">Top remediation</div>${top}` : ''}
      ${p.residual ? `<div class="sp-sub">↳ residual: <b>${p.residual.count || 0} accepted MED</b> — ${esc(p.residual.note || '')}</div>` : ''}
      ${blItems ? `<div class="sp-h4">Remaining remediation · ${bl.totalProgrammerWeeks || 0} pw (${(bl.items || []).length} items)</div><div class="sp-bl-list">${blItems}</div>` : ''}
      <div class="sp-h4">Secrets</div>
      <div class="sp-row sp-sec">${sc
        ? `${sc.found != null ? esc(sc.found) : absent('count unknown')} found · <b>${sc.remaining != null ? esc(sc.remaining) : absent('remaining unknown')} remaining</b>${sc.verifiedBy ? ' · ' + esc(sc.verifiedBy) : ''}`
        : absent('no secret scan recorded for this project')}</div>
      <div class="sp-h4">Scanners (${(p.scanners || []).length})</div>
      <div class="sp-scan">${(p.scanners || []).length
        ? (p.scanners || []).map(s => `<span class="sp-chip">${esc(s)}</span>`).join('')
        : absent('none declared')}</div>
      ${(mon.dashboard || mon.remediationPlan || mon.auditLog)
        ? `<div class="sp-links">${[['dashboard', mon.dashboard], ['plan', mon.remediationPlan], ['log', mon.auditLog]]
            .filter(([, v]) => v).map(([k, v]) => `${k} <code>${esc(v)}</code>`).join('<br>')}</div>`
        : ''}
      <div class="sp-foot">prioritised: ${p.prioritisation ? esc(p.prioritisation) : absent('not stated')}<br>live: ${mon.liveTarget ? esc(mon.liveTarget) : absent('no live target declared')} · as of ${p.asOf ? esc(p.asOf) : absent('date not recorded')}</div>
    </div>
  </details>`;
})();

const ic = (SNAP.imageBySeverity)||{C:0,H:0,M:0,L:0};   // zeros, not one project's frozen fleet counts

// Render the baseline toggle only when a second baseline exists.
const hasOriginalBaseline = [...(DATA.tracks || []), ...(DATA.infraSiding || [])].some(t => t.cveOriginal);

// Backfilled CVE history -> two header sparklines (jvm/dependency + container image).
const _spark = (S,max,W,HT) => {
  const pad=6,n=S.length, X=i=> pad+i*(W-2*pad)/(n-1), Y=v=> HT-3-(v/max)*(HT-pad-3);
  const line='M'+S.map((h,i)=>X(i).toFixed(1)+','+Y(h.total).toFixed(1)).join(' L');
  const area=line+` L${X(n-1).toFixed(1)},${HT-1} L${X(0).toFixed(1)},${HT-1} Z`;
  const dots=S.map((h,i)=>`<circle cx="${X(i).toFixed(1)}" cy="${Y(h.total).toFixed(1)}" r="${i===0||i===n-1?2.8:1.6}" fill="${(h.crit||0)>0?'var(--crit)':'var(--live)'}"><title>${esc(h.event||'')} — ${h.total} (${h.crit||0} crit)</title></circle>`).join('');
  return {area,line,dots};
};
const cveTimeline = (()=>{
  const J=(DATA.meta.cveHistory||[]).filter(h=>!h.scope||h.scope==='jvm');
  const I=(DATA.meta.imageHistory||[]);
  const D=(DATA.meta.depsHistory||[]);
  if(J.length<2) return '';
  const W=820,HT=26;
  const js=_spark(J,Math.max(...J.map(h=>h.total))||1,W,HT);
  const is=I.length>1?_spark(I,Math.max(...I.map(h=>h.total))||1,W,HT):null;
  const ds=D.length>1?_spark(D,Math.max(...D.map(h=>h.total))||1,W,HT):null;
  const it=DATA.meta.infraCveTotal||(DATA.infraSiding||[]).reduce((a,inf)=>({total:a.total+((inf.cve&&inf.cve.total)||0),C:a.C+((inf.cve&&inf.cve.CRITICAL)||0)}),{total:0,C:0});
  // Currency derives from the data (meta.historiesDerived or h.current), never from a date literal.
  const dateOf=h=>{const m=String(h.ts||'').match(/^(\d{4}-\d{2}-\d{2})/);return m?m[1]:'';};
  const derived=!!DATA.meta.historiesDerived;
  const isCurrent=h=>h.current===true||derived;
  const endNote=(S,fallback)=>{
    const l=S[S.length-1]; const d=dateOf(l);
    const s=`${(l.crit||0)} crit${d?' · '+d:''}${isCurrent(l)?' (current)':d?' (last scan)':''}`;
    return s||fallback;
  };
  const spanOf=S=>{const a=dateOf(S[0]),b=dateOf(S[S.length-1]);return a&&b?(a===b?a:a+' → '+b):'';};
  const cap=(spanOf(J)||'full recorded history')
    +(derived?'':' <span class="hist-flag">(historic snapshot — not extended from the live store)</span>');
  const row=(tag,cls,sp,a,b,note)=>`<div class="ch-row">
      <span class="ch-tag ${cls}">${tag}</span>
      <svg viewBox="0 0 ${W} ${HT}" preserveAspectRatio="none" class="ch-svg" role="img" aria-label="${esc(`${tag} CVE trend: ${a} to ${b}${note ? ', ' + note : ''}`)}"><path d="${sp.area}" class="ch-area ${cls}"/><path d="${sp.line}" class="ch-line ${cls}"/>${sp.dots}</svg>
      <span class="ch-end"><b>${a}</b><i>→</i><b class="g">${b}</b><u>${note}</u></span>
    </div>`;
  return `<div class="cvehist">
    <div class="cvehist-cap">CVE history<br>${cap}</div>
    <div class="ch-rows">
      ${row('jvm · dependency','jvm',js,J[0].total.toLocaleString(),J[J.length-1].total,endNote(J,''))}
      ${is?row('image · fleet+infra','img',is,I[0].total.toLocaleString(),I[I.length-1].total.toLocaleString(),derived?endNote(I,''):'historic snapshot · no live rescan'):''}
      ${ds?row('deps · lockfile/osv','jvm',ds,D[0].total.toLocaleString(),D[D.length-1].total.toLocaleString(),(D[D.length-1].note||endNote(D,''))):''}
    </div>
    <div class="cvehist-infra">infra image-CVE now <b>${(it.total||0).toLocaleString()}</b> (${it.C||0} crit): ${(DATA.infraSiding||[]).map(inf=>inf.dead?((inf.short||inf.id)+' ∅ retired'):inf.cve?((inf.short||inf.id)+' '+inf.cve.total.toLocaleString()):((inf.short||inf.id)+' ⏳ not scanned')).join(' · ')}</div>
  </div>`;
})();

// live security-program posture for the top-section KPIs (fed by attach-program.mjs)
const sp = DATA.meta.securityProgram || {};
const scp = sp.cvePosture || {};

// Masthead KPIs: STACK from meta.kpis[] (absent slots dropped); SCAN derived, omitted when unmeasured.
const stackKpis = (DATA.meta.kpis || []).map((k) => {
  const v = k.value != null ? k.value : (k.meta != null ? DATA.meta[k.meta] : null);
  if (v == null) return '';
  return kpi(k.cls || 'flat', (k.prefix || '') + v, k.label || '');
}).filter(Boolean).join('\n      ');
// jvm baseline = the first point of the jvm CVE history (the series the header sparkline plots)
const jvmSeries = (DATA.meta.cveHistory || []).filter((h) => !h.scope || h.scope === 'jvm');
const jvmBaseline = SNAP.jvmBaseline != null ? SNAP.jvmBaseline : (jvmSeries.length ? jvmSeries[0].total : null);
const jvmCrit = SNAP.jvmBySeverity ? (SNAP.jvmBySeverity.CRITICAL || 0) : null;
const scanKpis = [
  SNAP.jvmTotal != null ? kpi('good', SNAP.jvmTotal, 'jvm CVE · now') : '',
  jvmCrit != null ? kpi(jvmCrit > 0 ? 'crit' : 'good', jvmCrit, 'CRITICAL · now') : '',
  (jvmBaseline != null && SNAP.jvmTotal != null)
    ? kpi('flat', jvmBaseline.toLocaleString() + ' → ' + SNAP.jvmTotal, 'jvm CVE · baseline → latest') : '',
  sp.cvePosture ? kpi((scp.crit || 0) > 0 ? 'crit' : 'good', (scp.crit || 0) + 'C · ' + (scp.high || 0) + 'H', 'npm CVE · live') : '',
  sp.cvePosture ? kpi((scp.kevCves || 0) > 0 ? 'alarm' : 'good', (scp.kevCves || 0) + ' KEV', 'exploited' + (sp.kev && sp.kev[0] ? ' · ' + sp.kev[0].package : '')) : '',
  DATA.meta.asOf ? kpi('flat', 'as of ' + DATA.meta.asOf, 'snapshot') : '',
].filter(Boolean).join('\n      ');

// Legend labels are read back out of the data — never hardcoded era/wave/image names.
const heroEra = ((DATA.versionAxis || []).find((a) => a.band === 'now') || {}).era || 'Current era';
const sampleWave = ((DATA.waves || [])[0] || {}).short || 'Wave';
const pendingRef = ((DATA.infraSiding || []).find((i) => i.incomplete) || {}).imageRef || 'this image';
const lastEra = ((DATA.versionAxis || [])[(DATA.versionAxis || []).length - 1] || {}).era || '';
const blockedLegend = (DATA.tracks || []).some((t) => t.blocked)
  ? `<div class="legrow"><svg width="40" height="14" aria-hidden="true" focusable="false"><line x1="8" y1="1" x2="8" y2="9" stroke="#F37021" stroke-width="3" stroke-dasharray="2 3"/><rect x="4" y="9" width="8" height="8" style="fill:var(--block)"/></svg>■ Blocked from ${esc(lastEra)}</div>`
  : '';
// the snapshot block states measured totals — omitted whole when nothing measured them
const snapshotLegend = (SNAP.imageTotal != null || SNAP.jvmTotal != null) ? `
        <h2 class="lgd-h">Snapshot</h2>
        <div class="legrow" style="display:block;color:var(--ink3);font-size:10.5px;line-height:1.5">
          Image CVEs: <b style="color:var(--ink)">${(SNAP.imageTotal||0).toLocaleString()}</b> total ·
          ${ic.C}C / ${ic.H}H / ${ic.M}M / ${ic.L}L.<br>
          JVM jar CVEs: <b style="color:var(--ink)">${(SNAP.jvmTotal||0).toLocaleString()}</b> rows.<br>
          ${esc(SNAP.note||'')}
        </div>` : '';

// Everything below is inlined into the artifact; comments are stripped at inline time, but keep
// client names/numbers/narrative out of the emitted STRINGS — those still ship.

/*
 * Strip whole-line and block comments from source inlined verbatim into the artifact (view-source
 * is a leak channel). Conservative: trailing EOL comments stay — a delimiter inside a string/regex
 * never starts a trimmed line. Fails closed: JS output is compiled after stripping.
 */
function stripInlineComments(src, kind) {
  const out = [];
  let inBlock = false;
  for (const line of String(src).split('\n')) {
    const t = line.trim();
    if (inBlock) {
      const end = t.indexOf('*/');
      if (end === -1) continue;
      inBlock = false;
      const rest = t.slice(end + 2).trim();
      if (rest) out.push(rest);
      continue;
    }
    if (kind === 'js' && t.startsWith('//')) continue;
    if (t.startsWith('/*')) {
      if (t.includes('*/')) {
        const rest = t.slice(t.lastIndexOf('*/') + 2).trim();
        if (rest) out.push(rest);
      } else inBlock = true;
      continue;
    }
    out.push(line);
  }
  if (inBlock) throw new Error(`stripInlineComments(${kind}): unterminated block comment — refusing to emit`);
  const stripped = out.join('\n');
  if (kind === 'js') {
    // Compile-only check. Throws SyntaxError if the strip broke the script.
    // eslint-disable-next-line no-new-func
    new vm.Script(stripped);
  }
  return stripped;
}
const docTitle = /\bmaps?\b/i.test(DATA.meta.title || '')
  ? String(DATA.meta.title || '')
  : `${DATA.meta.title || ''} — modernization map`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(docTitle)}</title>
${followerScript()}
<style>${stripInlineComments(css(), 'css')}</style>
<style>
/* embed mode: when iframed (?embed=1 or self!==top, e.g. the commitwork :7878 admin tab),
   drop the redundant logo+title so the map sits cleanly under the admin tab bar.
   The KPI banner, CVE timeline, toolbar and the map itself are kept. */
html[data-embed] .embed-hide{display:none!important}
html[data-embed] header.topbar .row1{padding-top:10px}
</style>
<script>if(new URLSearchParams(location.search).has('embed')||self!==top)document.documentElement.setAttribute('data-embed','')</script>
</head>
<body>
<header class="topbar">
  <div class="row1">
    ${LOGO_SVG ? `<span class="logo embed-hide" aria-label="${esc(DATA.meta.logoLabel || DATA.meta.title)}">${LOGO_SVG}</span>` : ''}
    <div class="titles embed-hide">
      <h1>${esc(DATA.meta.title)}</h1>
      <p>${esc(DATA.meta.subtitle)}</p>
    </div>
    <div class="spacer"></div>
    <div class="kpis">
      ${stackKpis}
      ${scanKpis}
    </div>
  </div>
  ${cveTimeline}
  <div class="toolbar">
    <div class="tbgroup">
      <span class="tblabel">CVE severity</span>
      ${chip('sev','CRIT','Crit','var(--crit)',true)}
      ${chip('sev','HIGH','High','var(--high)',true)}
      ${chip('sev','MED','Med','var(--med)',true)}
      ${chip('sev','LOW','Low','var(--low)',true)}
    </div>
    <div class="tbgroup">
      <span class="tblabel">Issue status</span>
      ${chip('status','resolved','Resolved '+c.resolved,'var(--live)',true)}
      ${chip('status','in-progress','In progress '+c.inProgress,'var(--plan)',true)}
      ${chip('status','open','Open '+c.open,'var(--mut)',true)}
    </div>
    <div class="spacer" style="flex:1"></div>
    <div class="tbgroup">
      ${hasOriginalBaseline ? `<button class="btn tog" id="cveBaseline">CVE: current scan</button>` : ''}
      <button class="btn tog" id="cveWeight">Weight tracks by CVE load</button>
      <button class="btn" id="expandAll">Expand tree</button>
      <button class="btn" id="collapseAll">Collapse</button>
    </div>
  </div>
</header>

<div class="stage">
  <div class="mapwrap" tabindex="0" aria-label="map; use the arrow keys to scroll">
    <div id="map-wrap"></div>
  </div>
  <aside class="rail">
    <div class="railhd"><span>Tracks &amp; subsystems</span><span style="color:var(--ink3)">${(DATA.tracks||[]).length} app tracks</span></div>
    <div class="railscroll">
      ${secProgram}
      <div class="tree" id="tree"></div>
      <div class="legend">
        <h2 class="lgd-h">CVE severity${DATA.meta.cveScanner ? ` (${esc(DATA.meta.cveScanner)})` : ''}</h2>
        <div class="legrow"><span style="width:11px;height:11px;border-radius:50%;background:var(--crit);display:inline-block"></span>Critical · fleet image total ${ic.C}</div>
        <div class="legrow"><span style="width:11px;height:11px;border-radius:50%;background:var(--high);display:inline-block"></span>High · ${ic.H}</div>
        <div class="legrow"><span style="width:11px;height:11px;border-radius:50%;background:var(--med);display:inline-block"></span>Medium · ${ic.M}</div>
        <div class="legrow"><span style="width:11px;height:11px;border-radius:50%;background:var(--low);display:inline-block"></span>Low · ${ic.L}</div>
        <div class="legrow"><svg width="40" height="16" aria-hidden="true" focusable="false"><rect x="2" y="2" width="36" height="12" rx="6" style="fill:var(--cap)" stroke="var(--crit)" stroke-width="1.6"/><circle cx="11" cy="8" r="2.4" fill="var(--crit)"/><text x="16" y="11" font-size="7.5" font-weight="800" style="fill:var(--ink)">C5 H35</text></svg>Per-container CVE badge @ ${esc(heroEra)}</div>
        <div class="legrow"><svg width="40" height="16" aria-hidden="true" focusable="false"><rect x="2" y="3" width="34" height="11" rx="5.5" style="fill:var(--pend-bg);stroke:var(--pend-line)" stroke-width="1.3" stroke-dasharray="3 3"/><text x="9" y="11" font-size="7" font-weight="800" style="fill:var(--pend-ink)">SCAN ⏳</text></svg>Scan pending (${esc(pendingRef)})</div>

        <h2 class="lgd-h">Interchanges &amp; geometry</h2>
        <div class="legrow"><svg width="40" height="18" aria-hidden="true" focusable="false"><rect x="4" y="4" width="32" height="10" rx="5" style="fill:var(--cap);stroke:var(--ink)" stroke-width="3"/></svg>Era interchange (white-ring capsule)</div>
        <div class="legrow"><svg width="40" height="18" aria-hidden="true" focusable="false"><rect x="2" y="3" width="36" height="12" rx="6" style="fill:var(--now-band)"/><rect x="4" y="4" width="32" height="10" rx="5" style="fill:var(--cap);stroke:var(--ink)" stroke-width="4"/></svg>${esc(heroEra)} (hero interchange)</div>
        <div class="legrow"><svg width="40" height="14" aria-hidden="true" focusable="false"><rect x="3" y="0" width="20" height="11" rx="5.5" fill="var(--live)"/><text x="13" y="8" text-anchor="middle" font-size="7" font-weight="800" fill="#fff">${esc(sampleWave)}</text></svg>Wave roundel (fan movement)</div>
        <div class="legrow"><svg width="40" height="14" aria-hidden="true" focusable="false"><line x1="6" y1="2" x2="6" y2="12" stroke="#005AA3" stroke-width="4" stroke-dasharray="3 4"/><rect x="2" y="11" width="8" height="0" /></svg>Dashed = ghost / planned path</div>
        ${blockedLegend}

        <h2 class="lgd-h">Subsystems (tree grouping)</h2>
        ${legendLines}
${snapshotLegend}
      </div>
    </div>
  </aside>
</div>

<div class="maphint">Scroll or use the arrow keys to pan · click, or Tab to and press Enter on, a track / CVE badge / wave roundel / infra siding for detail · Esc closes · toggle CVE weighting in the toolbar</div>

${remLogPanel}

<aside class="detail" id="detail" role="dialog" aria-label="Detail">
  <div class="dhd"></div>
  <div class="dbody"></div>
</aside>

<script>window.__DATA__ = ${dataLiteral};</script>
<script>${stripInlineComments(APP_JS, 'js')}</script>
</body>
</html>
`;

writeFileSync(join(ROOT, 'index.html'), html);
const bytes = Buffer.byteLength(html, 'utf8');
console.log('index.html written:', (bytes/1024).toFixed(1) + ' KB',
  '| app tracks', (DATA.tracks||[]).length,
  '| infra siding', (DATA.infraSiding||[]).length,
  '| eras', DATA.versionAxis.length,
  '| waves', (DATA.waves||[]).length,
  '| logo', LOGO_SVG ? 'inlined' : (DATA.meta.logo ? 'MISSING' : 'none declared'),
  '| trunk anchor', ((DATA.versionAxis||[]).find(a=>a.trunk)||(DATA.versionAxis||[]).find(a=>a.band==='now')||{}).id || '(last era)');
