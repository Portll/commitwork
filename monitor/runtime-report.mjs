#!/usr/bin/env node
// commitwork — runtime (DAST / BOLA) report. Self-contained (file:// safe), theme-aware HTML.
//
// usage: node monitor/runtime-report.mjs [reportDir]   (default: reports/runtime-latest, else
//        the newest sweep-*/<repo> dir containing a nuclei.json / authz-bola.json)
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseRuntime, RT_CATEGORIES, RT_SEVRANK, nucleiArtifact } from '../bin/parse-runtime.mjs';
import { solveDir, disposition, DISPOSITION } from './nuclei-solve.mjs';
import { readInventory, ownerOf } from './host-inventory.mjs';
import { outDirFor, reportsRootDir, ambientArea, batchesForArea } from './area.mjs';
import { areaOf, loadRegistry, areaOut } from './registry.mjs';
import { followerScript, toggleScript } from '../lib/theme-follower.mjs';
import { houseCss } from '../lib/house-css.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
// Fail loud — a swallowed registry parse would silently default AREA to the wrong slug
const REG = loadRegistry();
const ROOT = reportsRootDir(REG);
// The batch's own manifest declares the area; ambient is only right when nobody named a directory
const OUT = (() => {
  if (process.env.CW_MONITOR_OUT) return resolve(process.env.CW_MONITOR_OUT);
  const named = process.argv[2];
  if (!named) return outDirFor(null, REG);
  let d = resolve(named), bm = null;            // walk up to the batch that owns the named dir
  for (let i = 0; i < 3 && !bm; i++) {
    try { bm = JSON.parse(readFileSync(join(d, 'batch-manifest.json'), 'utf8')); } catch { d = dirname(d); }
  }
  const out = bm && typeof bm.area === 'string' && bm.area ? areaOut(bm.area, REG) : null;
  if (out) return join(reportsRootDir(REG), out);
  console.error(`runtime-report: ${named} declares no area — refusing to write another area's runtime state.`);
  console.error('runtime-report: set CW_MONITOR_OUT explicitly, or re-sweep so the batch records its scope.');
  process.exit(4);
})();
const outPath = join(OUT, 'runtime.html');
const AREA = ambientArea(REG, OUT);         // the area this report is being written FOR

// Shares parse-runtime's artifact list — this gate and parseNuclei must name the SAME files
const hasRuntime = (d) => !!nucleiArtifact(d) || existsSync(join(d, 'authz-bola.json'));

// Only batches that provably cover this area are candidates; unknown-scope batches are a labelled
// last resort; a batch declaring a DIFFERENT area is never used.
// -> { dir, scope: 'explicit'|'area'|'unknown'|'none', note }
function findRuntimeDir() {
  if (process.argv[2]) return { dir: resolve(process.argv[2]), scope: 'explicit', note: 'directory passed on the command line' };
  // reports/runtime-latest is a project-agnostic singleton — its scope cannot be asserted
  const latest = join(ROOT, 'runtime-latest');
  if (hasRuntime(latest)) return { dir: latest, scope: 'unknown', note: 'reports/runtime-latest is a shared, project-agnostic dir — it carries no area dimension' };

  const { covers, unknown } = batchesForArea({ slug: AREA.slug, dir: OUT }, REG); // both newest-first
  for (const b of covers) {
    for (const r of readdirSync(b.dir)) {
      const rd = join(b.dir, r);
      // a --all batch holds foreign repo dirs too — the per-repo area check keeps those out
      if (!statSync(rd).isDirectory() || areaOf(r, REG) !== AREA.slug) continue;
      if (hasRuntime(rd)) return { dir: rd, scope: 'area', note: `${b.name} declares area ${b.manifest.area || '(dir match)'}; repo ${r} resolves to ${AREA.slug}` };
    }
  }
  for (const b of unknown) {
    for (const r of readdirSync(b.dir)) {
      const rd = join(b.dir, r);
      if (!statSync(rd).isDirectory()) continue;
      if (hasRuntime(rd)) return { dir: rd, scope: 'unknown', note: `${b.name} predates batch-manifest area recording — scope of ${r} is unverified` };
    }
  }
  return { dir: latest, scope: 'none', note: 'no runtime scan found for this area' };
}

const src = findRuntimeDir();
const dir = src.dir;
const rt = parseRuntime(dir);
// parseRuntime short-circuits a missing dir to categories:{} — fill the taxonomy so "no scan for
// this area" renders as an empty report rather than crashing.
for (const c of RT_CATEGORIES) rt.categories[c.id] ||= { worst: 'none', count: 0, confirmed: 0, unconfirmed: 0, findings: [], blocker: false };

// meta: target + generated (from authz-bola summary base, or nuclei host)
let target = '', generated = new Date().toISOString();
try { const b = JSON.parse(readFileSync(join(dir, 'authz-bola.json'), 'utf8')); target = b.summary?.base || ''; } catch {}
if (!target) { const n = rt.findings.find((f) => f.location); target = n ? n.location.replace(/^(https?:\/\/[^/]+).*/, '$1') : ''; }
try { generated = new Date(statSync(nucleiArtifact(dir) || join(dir, 'authz-bola.json')).mtime).toISOString(); } catch {}

// ── ADJUDICATION: is this finding true, and is it even ours? ─────────────────────────────────
// Two axes, neither sufficient alone: nuclei-solve confirms the protocol, host-inventory answers
// whose socket it is. Re-attribution is not deletion — host-attributed findings stay counted.
const portOfLocation = (loc) => {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?[^/:]+:(\d+)/i.exec(String(loc || ''));
  return m ? Number(m[1]) : null;
};
const solved = solveDir(dir);
const hostInv = readInventory(join(dir, '..')) || readInventory(dir);
const verdictByKey = new Map();
if (solved.ok) for (const s of solved.records) verdictByKey.set(`${s.templateId}|${s.port}`, s);
for (const f of rt.findings) {
  const key = `${f.id}|${portOfLocation(f.location) ?? ''}`;
  const s = verdictByKey.get(key);
  const owner = hostInv ? ownerOf(hostInv, { port: portOfLocation(f.location), proto: 'UDP', at: null }) : { owner: 'unknown' };
  // HTTP targets are TCP — retry TCP when the UDP lookup produced no live claim
  const owner2 = (owner.owner === 'unknown' || owner.owner === 'unbound-unverifiable') && hostInv
    ? ownerOf(hostInv, { port: portOfLocation(f.location), proto: 'TCP', at: null }) : owner;
  const use = owner2.owner === 'project' || owner2.owner === 'host' ? owner2 : owner;
  f.owner = use.owner;
  f.ownerWhy = use.why || '';
  f.confirmation = s ? s.confirmation : 'undetermined';
  f.signals = s ? s.signals : [];
  f.ruleDigest = s ? s.ruleDigest : null;
  f.contradictor = s ? s.contradictor || null : null;
  f.disposition = s ? disposition(s, use) : (use.owner === 'host' ? DISPOSITION.HOST : DISPOSITION.UNDETERMINED);
}
const byDisp = (d) => rt.findings.filter((f) => f.disposition === d).length;
const adjudication = {
  ran: solved.ok,
  reason: solved.ok ? '' : solved.reason,
  // Reported, never enforced — all-undetermined must read as "not judged", not "nothing to say"
  coverage: solved.ok ? solved.coverage : 0,
  conserved: solved.ok ? solved.conserved : null,
  uncited: solved.ok ? solved.uncited.length : 0,
  host: hostInv ? { ok: hostInv.ok !== false, window: hostInv.window || null, privileged: !!hostInv.privileged }
    : { ok: false, reason: 'no host inventory in this batch — ownership is UNKNOWN, never clean' },
  counts: {
    confirmed: byDisp(DISPOSITION.CONFIRMED), refuted: byDisp(DISPOSITION.REFUTED),
    hostAttributed: byDisp(DISPOSITION.HOST), undetermined: byDisp(DISPOSITION.UNDETERMINED),
  },
};

const bySev = (s) => rt.findings.filter((f) => f.severity === s).length;
// `coverage.scope==='area'` is the only value that claims these findings are this area's
const coverage = {
  area: AREA.slug, areaLabel: AREA.label, scope: src.scope, basis: src.note,
  areaDeclared: AREA.declared, // false ⇒ the OUT dir is not a declared area (e.g. a scratch CW_MONITOR_OUT)
  label: src.scope === 'area' ? `${AREA.label || AREA.slug}`
    : src.scope === 'explicit' ? 'as passed (scope not verified)'
      : src.scope === 'none' ? 'no runtime scan found' : 'UNKNOWN SCOPE — source scan carries no area',
};
const dataJson = JSON.stringify({
  generated, target, source: dir.replace(CW + '/', ''), coverage,
  categories: RT_CATEGORIES,
  cats: rt.categories, findings: rt.findings, probes: rt.probes, blockers: rt.blockers,
  adjudication,
  totals: { total: rt.findings.length, crit: bySev('crit'), high: bySev('high'), med: bySev('med'), low: bySev('low'), info: bySev('info'), blockers: rt.blockers.length },
}).replace(/<\//g, '<\\/');

const html = String.raw`<!doctype html><html lang="en-AU"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>commitwork — runtime (DAST / BOLA)</title>
${followerScript()}
<style>
${houseCss()}
 :root{--crit-fill:color-mix(in srgb,var(--crit) 12%,transparent);--high-fill:color-mix(in srgb,var(--high) 12%,transparent);--med-fill:color-mix(in srgb,var(--med) 12%,transparent);--low-fill:color-mix(in srgb,var(--low) 12%,transparent);--live-fill:color-mix(in srgb,var(--live) 12%,transparent);--part-fill:color-mix(in srgb,var(--part) 12%,transparent);--plan-fill:color-mix(in srgb,var(--plan) 12%,transparent)}
 body{font-size:.875rem;line-height:1.5}
 .bar{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--line);padding:.5625rem 1rem;display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}
 .bar b{font-size:.9375rem;font-weight:600;color:var(--head)}.sp{flex:1}.mut{color:var(--mut);font-size:.719rem}
 button{font:inherit;font-size:.8125rem;border:1px solid var(--line2);background:var(--panel);color:var(--ink);border-radius:3px;padding:.3125rem .5625rem;cursor:pointer}
 button:hover{border-color:var(--acc)}
 .wrap{max-width:67.5rem;margin:.875rem auto 4.375rem;padding:0 1rem}
 .mono{font-family:var(--mono)}
 /* blocker banner */
 .blockers{background:var(--crit-fill);border:1px solid var(--crit);border-radius:.625rem;padding:.75rem .9375rem;margin-bottom:1rem}
 .blockers h2{margin:0 0 .5rem;font-size:.875rem;color:var(--crit);display:flex;align-items:center;gap:.5rem}
 .blockers .bk{padding:.375rem 0;border-top:1px solid color-mix(in srgb,var(--crit) 30%,transparent);display:flex;gap:.625rem;align-items:baseline;flex-wrap:wrap}
 .blockers .bk:first-of-type{border-top:0}
 /* kpis */
 .kpis{display:flex;gap:.625rem;flex-wrap:wrap;margin:0 0 .875rem}
 .kpi{background:var(--panel);border:1px solid var(--line);border-radius:.625rem;padding:.5625rem .9375rem;min-width:6rem}
 .kpi .n{font-size:1.4375rem;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--head)}.kpi .l{font-size:.656rem;color:var(--mut);text-transform:uppercase;letter-spacing:.1em}
 .kpi.crit .n{color:var(--crit)}.kpi.high .n{color:var(--high)}.kpi.med .n{color:var(--med)}.kpi.low .n{color:var(--low)}.kpi.info .n{color:var(--plan)}
 /* category tabs — muted when empty, worst-severity rule otherwise; carries the interface pattern */
 .tabs{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.875rem}
 .tab{border:1px solid var(--line);background:var(--panel);color:var(--mut);border-radius:.5rem;padding:.5rem .8125rem;cursor:pointer;display:flex;flex-direction:column;gap:.125rem;min-width:7.5rem;border-left-width:4px;border-left-color:var(--line2)}
 .tab:hover{border-color:var(--acc2)}
 .tab.has{color:var(--ink)}
 .tab.crit{border-left-color:var(--crit)}.tab.high{border-left-color:var(--high)}.tab.med{border-left-color:var(--med)}.tab.low{border-left-color:var(--low)}.tab.info{border-left-color:var(--plan)}
 .tab.on{background:var(--wash);box-shadow:inset 0 -2px 0 var(--acc)}
 .tab .lab{font-weight:600;font-size:.78rem;display:flex;align-items:center;gap:.375rem}
 .tab .cnt{font-variant-numeric:tabular-nums;font-size:.6875rem;color:var(--mut)}
 .tab .warn{color:var(--crit);font-size:.6875rem}
 /* finding cards */
 .cathint{color:var(--mut);font-size:.75rem;margin:0 0 .75rem}
 .card{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--line2);border-radius:.625rem;padding:.75rem .875rem;margin-bottom:.6875rem}
 .card.crit{border-left-color:var(--crit)}.card.high{border-left-color:var(--high)}.card.med{border-left-color:var(--med)}.card.low{border-left-color:var(--low)}.card.info{border-left-color:var(--plan)}
 .card.unconf{background:transparent;border-style:dashed}.card.unconf .loc::after{content:' · UNCONFIRMED (404)';color:var(--mut)}
 .resp{font-size:.6875rem;margin:.125rem 0 .5rem;padding:.1875rem .5rem;border-radius:.3125rem;display:inline-block}
 .resp.good{background:var(--live-fill);color:var(--live)}
 /* a refuted, unjudged or not-live result is not a state colour: its line carries a house .pill.na or
    .pill.unk and no fill of its own (THEME Rule 7) */
 .resp.quiet{padding-left:0;color:var(--mut)}
 .card h3{margin:0 0 .25rem;font-size:.875rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
 .card .loc{font-size:.719rem;color:var(--mut);margin-bottom:.5rem;word-break:break-all}
 .card p{margin:.375rem 0;font-size:.78rem;line-height:1.5;white-space:pre-wrap}
 .card .k{font-size:.625rem;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);font-weight:600;margin-top:.5625rem}
 .chip{display:inline-block;padding:.0625rem .5rem;border-radius:.625rem;font-size:.6875rem;font-weight:600}
 .chip.crit{background:var(--crit-fill);color:var(--crit)}.chip.high{background:var(--high-fill);color:var(--high)}.chip.med{background:var(--med-fill);color:var(--med)}.chip.low{background:var(--low-fill);color:var(--low)}.chip.info{background:var(--plan-fill);color:var(--plan)}
 .chip.live{background:var(--live-fill);color:var(--live)}.chip.part{background:var(--part-fill);color:var(--part)}
 .chip.bk{background:var(--crit);color:var(--panel)}
 .tag{display:inline-block;padding:0 .375rem;border-radius:.3125rem;background:var(--panel2);color:var(--mut);font-size:.656rem;margin:.125rem .1875rem 0 0}
 .refs a{font-size:.719rem;display:block;word-break:break-all}
 .empty{background:var(--panel);border:1px dashed var(--line2);border-radius:.625rem;padding:1.375rem;text-align:center;color:var(--mut);font-size:.8125rem}
 /* probe table (info shown inline even when a check found nothing) */
 table.probe{border-collapse:collapse;width:100%;font-size:.719rem;margin-top:.5rem}
 table.probe th,table.probe td{padding:.25rem .5rem;text-align:left;white-space:nowrap}
 table.probe th{font-size:.625rem}
 .verdict{background:var(--panel2);border-radius:.375rem;padding:.5rem .6875rem;font-size:.75rem;margin-top:.5rem}
 /* embedded in the admin panel (?embed=1 or inside an iframe): hide the brand and the theme
    toggle, which would duplicate the panel's own bar and Appearance menu, and draw the bar as this
    view's toolbar rather than a second masthead */
 html[data-embed] .embed-hide{display:none!important}
 html[data-embed] .bar{position:static;background:transparent;border-bottom:0}
</style></head><body>
<div class="bar"><b class="embed-hide">commitwork · runtime</b><span class="mut">DAST / BOLA</span><span class="mut" id="scope"></span><span class="mut" id="src"></span><div class="sp"></div>
 <button id="theme" class="embed-hide" title="dark mode">☾</button></div>
<div class="wrap">
 <div id="blockers"></div>
 <div class="kpis" id="kpis"></div>
 <div id="adjudication"></div>
 <div class="tabs" id="tabs"></div>
 <p class="cathint" id="hint"></p>
 <div id="panel"></div>
 <div id="adjudicated"></div>
 <div class="mut" id="meta" style="margin-top:18px"></div>
</div>
<script id="data" type="application/json">__DATA__</script>
<script>
if(new URLSearchParams(location.search).has('embed')||self!==top)document.documentElement.setAttribute('data-embed','');
const D=JSON.parse(document.getElementById('data').textContent);
const SEVL={crit:'CRIT',high:'HIGH',med:'MED',low:'LOW',info:'INFO',none:'—'};
// quotes included: esc(r) below lands inside a double-quoted href attribute.
const esc=s=>(s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
document.getElementById('src').textContent=D.source+' · '+new Date(D.generated).toLocaleString();
// scope chip — an unverified/foreign-scope source must never read as this area's verdict
(()=>{const c=D.coverage||{},e=document.getElementById('scope');if(!e)return;
 const un=c.scope!=='area';e.textContent='covers: '+(c.label||'?');e.className=!un?'mut':c.scope==='none'?'pill na':'pill unk';e.title=c.basis||'';})();
// blockers
const bl=document.getElementById('blockers');
if(D.blockers.length){
 bl.innerHTML='<div class="blockers"><h2>⚠ '+D.blockers.length+' blocker'+(D.blockers.length>1?'s':'')+' — fix before ship</h2>'+
  D.blockers.map(f=>'<div class="bk"><span class="chip '+f.severity+'">'+SEVL[f.severity]+'</span>'+(f.leaksSecrets?'<span class="chip bk">SECRET LEAK</span>':'')+'<b>'+esc(f.name)+'</b><span class="mono mut">'+esc(f.location)+'</span><span class="mut">'+esc(f.blockerReason||'')+'</span></div>').join('')+'</div>';
} else bl.innerHTML='<div class="blockers" style="background:var(--info-bg);border-color:var(--info)"><h2 style="color:var(--info)">✓ no blockers — no high/critical DAST or BOLA findings on the probed target</h2></div>';
// kpis
document.getElementById('kpis').innerHTML=[['',D.totals.total,'findings'],['crit',D.totals.blockers,'blockers'],['high',D.totals.high,'high'],['med',D.totals.med,'medium'],['low',D.totals.low,'low'],['info',D.totals.info,'info']]
 .map(([c,n,l])=>'<div class="kpi '+c+'"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>').join('');
// ── adjudication ────────────────────────────────────────────────────────────────────────────
// Two sections that are SEALED, never green: a refuted finding is not a pass, and a
// host-attributed one is a true finding that belongs to this box rather than to the project. The
// host count is rendered HERE, inside the project's own report, because a finding that silently
// vanishes from a project's column is indistinguishable from one that was never found.
const DISPL={'in-scope-confirmed':'in scope','in-scope-refuted':'refuted','host-attributed':'host, not this project','undetermined':'not judged'};
(()=>{
 const A=D.adjudication,e=document.getElementById('adjudication');if(!e)return;
 if(!A.ran){e.innerHTML='<div class="verdict"><b>Not adjudicated</b> — <span class="mut">'+esc(A.reason||'the solver did not run')+'. Findings below are unjudged; that is not the same as correct.</span></div>';return;}
 const c=A.counts,pct=(A.coverage*100).toFixed(0);
 const warn=[];
 if(A.conserved===false)warn.push('CONSERVATION FAILED — records were lost between the artifact and the verdicts');
 if(A.uncited)warn.push(A.uncited+' refutation(s) carry no rule citation');
 if(!A.host.ok)warn.push(esc(A.host.reason||'no host inventory — ownership is UNKNOWN, never clean'));
 else if(!A.host.privileged)warn.push('ownership was observed UNPRIVILEGED: a port nothing appears to hold may simply be invisible, so nothing is refuted on that basis');
 e.innerHTML='<div class="verdict"><b>Adjudicated</b> '+pct+'% — '+
  '<span class="chip low">'+c.confirmed+' in scope</span> '+
  '<span class="pill na">'+c.refuted+' refuted</span> '+
  '<span class="chip info">'+c.hostAttributed+' host, not this project</span> '+
  '<span class="pill unk">'+c.undetermined+' not judged</span>'+
  (warn.length?'<br><span class="mut">⚠ '+warn.join(' · ')+'</span>':'')+'</div>';
})();
// tabs — grey when empty, worst-severity colour when populated
let active=D.categories.find(c=>D.cats[c.id].count)?.id||D.categories[0].id;
function renderTabs(){
 document.getElementById('tabs').innerHTML=D.categories.map(c=>{
  const g=D.cats[c.id];const cls=g.count?g.worst:'';
  return '<div class="tab '+cls+(g.count?' has':'')+(c.id===active?' on':'')+'" data-c="'+c.id+'">'+
   '<span class="lab">'+esc(c.label)+(g.blocker?'<span class="warn">⚠</span>':'')+'</span>'+
   '<span class="cnt">'+(g.count?(g.confirmed+' live'+(g.unconfirmed?' · '+g.unconfirmed+' 404':'')+(g.confirmed?' · worst '+SEVL[g.worst]:'')):'none')+'</span></div>';
 }).join('');
 document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{active=t.dataset.c;renderTabs();renderPanel();});
}
// Why a finding was refuted or moved, in the card itself — a verdict a reader cannot check is an
// assertion. The contradictor is a CLASS name, never the matched bytes: those responses are
// Tomcat error pages carrying headers and cookies, and this report is published.
function adjline(f){
 if(!f.disposition||f.disposition==='in-scope-confirmed')return '';
 const cls=f.disposition==='host-attributed'?'chip info':f.disposition==='in-scope-refuted'?'pill na':'pill unk';
 const why=f.disposition==='host-attributed'
  ? 'this port belongs to the host, not to any container this project publishes — the finding is real, the asset is not the project'
  : f.disposition==='in-scope-refuted'
   ? (f.signals||[]).join(' + ')+(f.contradictor?' ('+esc(f.contradictor)+')':'')
   : (f.ownerWhy||'no rule could be derived for this template');
 return '<div class="resp'+(f.disposition==='host-attributed'?'':' quiet')+'"><span class="'+cls+'">'+esc(DISPL[f.disposition]||f.disposition)+'</span> '+esc(why)+
  (f.ruleDigest?' · <span class="mono mut">digest '+esc(String(f.ruleDigest).slice(0,16))+'…</span>':'')+'</div>';
}
function fcard(f){
 return '<div class="card '+f.severity+(f.confirmed===false||f.disposition==='in-scope-refuted'?' unconf':'')+'"><h3><span class="chip '+f.severity+'">'+SEVL[f.severity]+'</span>'+esc(f.name)+(f.blocker?' <span class="chip bk">BLOCKER</span>':'')+(f.leaksSecrets?' <span class="chip bk">SECRET LEAK</span>':'')+'</h3>'+
  adjline(f)+
  (f.blockerReason?'<div class="mut" style="font-size:11px;color:var(--crit)">⚠ blocks: '+esc(f.blockerReason)+'</div>':'')+
  '<div class="loc mono">'+esc(f.location||'—')+' · <span class="mut">'+esc(f.tool)+(f.id?' · '+esc(f.id):'')+'</span></div>'+
  (f.httpStatus!=null?'<div class="resp'+(f.confirmed===false?' quiet"><span class="pill na">not live</span> ':' good">')+'HTTP '+f.httpStatus+' '+esc(f.httpReason)+(f.bodySnippet?' · <span class="mono">'+esc(f.bodySnippet)+'</span>':'')+(f.confirmed===false?' — endpoint not live; template matched a 4xx/5xx, likely a false positive (not counted as an exposure or blocker)':' — confirmed live')+'</div>':'')+
  '<div class="k">Description</div><p>'+esc(f.description||('Detection-only template — the '+f.tool+' check '+esc(f.id)+' fired but carries no description text. It reports that this endpoint/service is reachable and identifiable; treat as '+SEVL[f.severity]+'-severity surface for the '+esc((D.categories.find(c=>c.id===f.category)||{}).label||f.category)+' category.'))+'</p>'+
  (f.impact?'<div class="k">Impact</div><p>'+esc(f.impact)+'</p>':'')+
  (f.remediation?'<div class="k">Remediation</div><p>'+esc(f.remediation)+'</p>':'')+
  (f.probe?'<div class="k">Probe</div><p class="mono">noAuth='+f.probe.noAuth+' · tenantA='+f.probe.tenantA+' · tenantB='+f.probe.tenantB+'</p>':'')+
  ((f.cve||f.cwe&&f.cwe.length||f.cvss)?'<div class="k">Classification</div><p>'+[f.cve?'CVE '+esc(f.cve):'',(f.cwe||[]).map(c=>esc(c).toUpperCase()).join(', '),f.cvss?'CVSS '+f.cvss:''].filter(Boolean).join(' · ')+'</p>':'')+
  ((f.tags&&f.tags.length)?'<div>'+f.tags.map(t=>'<span class="tag">'+esc(t)+'</span>').join('')+'</div>':'')+
  ((f.reference&&f.reference.length)?'<div class="k">References</div><div class="refs">'+f.reference.map(r=>'<a href="'+esc(r)+'" target="_blank" rel="noopener">'+esc(r)+'</a>').join('')+'</div>':'')+
  '</div>';
}
function renderPanel(){
 const c=D.categories.find(x=>x.id===active),g=D.cats[active];
 document.getElementById('hint').textContent=c.hint;
 const probe=D.probes.find(p=>p.category===active);
 let h='';
 if(g.count) h+=g.findings.slice().sort((a,b)=>({crit:5,high:4,med:3,low:2,info:1,none:0})[b.severity]-({crit:5,high:4,med:3,low:2,info:1,none:0})[a.severity]).map(fcard).join('');
 // info shown inline even when the category found nothing (what was tested + the tool's verdict)
 if(probe){
  h+='<div class="verdict"><b>Probe · '+esc(probe.tool)+'</b> — tested '+probe.tested.length+' endpoint'+(probe.tested.length!==1?'s':'')+(probe.verdict?'<br><span class="mut">'+esc(probe.verdict)+'</span>':'')+'</div>';
  if(probe.tested.length) h+='<table class="probe"><tr><th>path</th><th>noAuth</th><th>tenant A</th><th>tenant B</th><th>len A/B</th></tr>'+
   probe.tested.map(t=>'<tr><td class="mono">'+esc(t.path)+'</td><td>'+t.noAuth+'</td><td>'+t.tenantA+'</td><td>'+t.tenantB+'</td><td>'+t.lenA+'/'+t.lenB+'</td></tr>').join('')+'</table>';
 }
 if(!g.count&&!probe) h+='<div class="empty">No findings in <b>'+esc(c.label)+'</b>.'+(active==='tls'?' TLS checks run against an HTTPS edge — the local gateway is HTTP-only.':'')+'</div>';
 document.getElementById('panel').innerHTML=h;
}
// The two sealed sections. They sit BELOW the categories, always rendered when non-empty, and
// they are never styled as a pass — "refuted" and "not this project's" are both determinations,
// and a determination that renders green is how a real finding gets lost.
function renderAdjudicated(){
 const A=D.adjudication;if(!A||!A.ran)return;
 const groups=[
  ['in-scope-refuted','Refuted — the finding is wrong','These templates matched, and the evidence says the match means nothing. Each row names the signals and the template digest the rule was derived from, so the judgement can be checked rather than taken. They are NOT fixed and NOT clean; they are wrong.'],
  ['host-attributed','Host-attributed — true, but not this project','These are real detections on ports this box owns and no container here publishes. They are not suppressed and not closed: they belong to the machine\'s own security posture, which the panel tracks separately under Config → Host.'],
 ];
 let h='';
 for(const [d,title,blurb] of groups){
  const fs=D.findings.filter(f=>f.disposition===d);
  if(!fs.length)continue;
  h+='<h2 style="margin-top:26px">'+esc(title)+' <span class="mut" style="font-weight:400">('+fs.length+')</span></h2>'+
   '<p class="cathint">'+blurb+'</p>'+
   fs.slice().sort((a,b)=>(a.id||'').localeCompare(b.id||'')||(a.location||'').localeCompare(b.location||'')).map(fcard).join('');
 }
 const und=D.findings.filter(f=>f.disposition==='undetermined');
 if(und.length)h+='<h2 style="margin-top:26px">Not judged <span class="mut" style="font-weight:400">('+und.length+')</span></h2>'+
  '<p class="cathint">No rule could be derived for these templates, or the response carried nothing to judge. Unjudged is its own state — it is not a pass.</p>';
 const e=document.getElementById('adjudicated');if(e)e.innerHTML=h;
}
document.getElementById('meta').innerHTML='Target: <span class="mono">'+esc(D.target||'—')+'</span> · generated '+new Date(D.generated).toLocaleString()+' · source <span class="mono">'+esc(D.source)+'</span>. Runtime findings are dynamic (a live target must be up); absence of a category is not proof of safety unless its probe ran.'+
 ((D.coverage&&D.coverage.scope!=='area')?'<br><b>Scope: '+esc(D.coverage.label)+'</b> — '+esc(D.coverage.basis||'')+'. These findings are NOT attributed to '+esc(D.coverage.areaLabel||D.coverage.area||'this area')+'; read them as belonging to the source scan above, nothing wider.':'<br>Scope: '+esc(D.coverage.areaLabel||D.coverage.area)+' — '+esc(D.coverage.basis||''));
renderTabs();renderPanel();renderAdjudicated();
</script>
${toggleScript()}
</body></html>`;

writeFileSync(outPath, html.replace('__DATA__', dataJson));
console.log(`runtime report: ${rt.findings.length} findings · ${rt.blockers.length} blocker(s) · ${RT_CATEGORIES.filter((c) => rt.categories[c.id].count).length}/${RT_CATEGORIES.length} categories populated -> ${outPath.replace(CW + '/', '')}`);
// Scope line: name the area this covers, or say plainly that nothing here is attributable to it
console.log(coverage.scope === 'area'
  ? `  scope: ${coverage.areaLabel || coverage.area} · source ${dir.replace(CW + '/', '')} (${coverage.basis})`
  : `  scope: no runtime scan attributable to ${coverage.areaLabel || coverage.area} — ${coverage.label}. Nothing above is a verdict on this area (source recorded in runtime.html coverage).`);
if (rt.blockers.length) for (const b of rt.blockers) console.log(`  ⚠ BLOCKER [${b.severity}] ${b.name} @ ${b.location}`);
