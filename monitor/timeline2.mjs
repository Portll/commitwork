#!/usr/bin/env node
// commitwork monitor — CORRECTED timeline (timeline2.html), companion to timeline.html. Renders
// history/corrected/: honest three-tier counts, per-repo visibility states (blind/no-surface/
// excluded never drawn clean), dimension lanes, the remediation ledger, provenance, TSV export.
// usage: node monitor/timeline2.mjs   (reads registry OUT or CW_MONITOR_OUT)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { projectOf } from './project-scope.mjs';
import { outDirFor, ambientArea } from './area.mjs'; // THE OUT resolver: CW_MONITOR_OUT, then the area's out
import { loadRegistry } from './registry.mjs';
import { annotationsPathFor, imageAcceptancePathFor, programWorklistPathFor } from './store-paths.mjs';
import { areaScope, scopeJudgments } from './timeline-scope.mjs';
import { houseCss } from '../lib/house-css.mjs';
import { followerScript, toggleScript } from '../lib/theme-follower.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
// A private record (monitor/store-paths.mjs): ENOENT is its documented absent state, anything else
// is a failure, never an empty record rendered as if it had been read.
const readRecord = (path, absent) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    if (e && e.code === 'ENOENT') return absent;
    throw new Error(`timeline2: ${path} is present but unreadable — ${e && e.message}`);
  }
};
// Fail loud — a broken registry must not render the corrected view from the wrong area's history
const REG = loadRegistry();
const OUT = outDirFor(null, REG);
const corr = JSON.parse(readFileSync(join(OUT, 'history', 'corrected', 'index.json'), 'utf8'));
const dims = {};
for (const d of ['jvm', 'images', 'codeql', 'runtime']) {
  try { dims[d] = JSON.parse(readFileSync(join(OUT, 'history', 'corrected', 'dimensions', `${d}.json`), 'utf8')); } catch { dims[d] = null; }
}
let ledger = { entries: [] };
try { ledger = JSON.parse(readFileSync(join(OUT, 'remediation-ledger.json'), 'utf8')); } catch {}
const worklist = readRecord(programWorklistPathFor(CW), { programs: [] });
// reconciled overlay (derived sidecar; authored worklist stays read-only) — absent ⟹ no overlay
let reconciled = null;
try { reconciled = JSON.parse(readFileSync(join(OUT, 'worklist-reconciled.json'), 'utf8')); } catch {}
// disposition triage layer — reads the forward `disposition` field; records without one render
// 'untriaged'. Read-only surface: this renders the JSON, never edits it.
let triage = [];
const annDoc = readRecord(annotationsPathFor(CW), {});
{
  const ann = annDoc.annotations || [];
  for (const a of ann) triage.push({ store: 'annotations', ref: a.id || a.package || '(wildcard)', repo: a.repo || '*', action: a.action || '', disposition: a.disposition || null, who: a.who || '', at: a.at || '', expires: a.expires || null, reason: a.reason || '' });
}
{
  const ia = readRecord(imageAcceptancePathFor(CW), {}).accepted || [];
  for (const a of ia) triage.push({ store: 'image-acceptance', ref: a.cve || '', repo: a.image || '', project: a.project || null, action: 'accept', disposition: a.disposition || null, who: a.who || '', at: a.at || '', expires: a.expires || null, reason: a.reachability || '' });
}
{
  // scanner-finding annotations (strict identity — category:field=value, never a wildcard)
  const sa = annDoc.scannerAnnotations || [];
  for (const a of sa) triage.push({ store: 'scanner-annotations', ref: `${a.category || '?'}: ${a.rule || a.marker || a.detector || a.id || a.probe || a.control || a.issue || a.operation || a.component || '?'} · ${a.file || a.path || a.package || a.target || a.resource || a.name || ''}`, repo: a.scope === 'fleet' ? '*' : (a.repo || ''), action: a.action || '', disposition: a.disposition || null, who: a.who || '', at: a.at || '', expires: a.expires || null, reason: a.reason || '' });
}

// CW_TIMELINE_SUBJECT filters to one project's rows — repos a cross-project sweep dragged in
// must not render as fleet rows
const SUBJECT = process.env.CW_TIMELINE_SUBJECT || null;
// The judgment stores are fleet-wide; this timeline renders the area it writes to, or SUBJECT.
const scope = areaScope(SUBJECT ? (REG.areas || []).find((a) => a.label === SUBJECT || a.slug === SUBJECT)?.slug || SUBJECT : ambientArea(REG, OUT).slug, REG);
const scoped = scopeJudgments({ rows: triage, programs: worklist.programs || [] }, scope, projectOf);
triage = scoped.rows;
const scopedWorklist = { ...worklist, programs: scoped.programs };
const sqx = (r) => (SUBJECT ? projectOf(r) === SUBJECT : true);
for (const s of corr.slices) s.repos = Object.fromEntries(Object.entries(s.repos).filter(([r]) => sqx(r)));
const repoNames = [...new Set(corr.slices.flatMap((s) => Object.keys(s.repos)))].sort();
const ledgerLite = ledger.entries.filter((e) => sqx(e.repo)).map((e) => ({ repo: e.repo, id: e.vulnId, pkg: e.package, sev: e.severity,
  tier: e.evidence.tier, detail: e.evidence.detail, from: e.fromVersion, to: e.toVersion, retro: !!e.retro, resolved: e.resolvedSlice }));
const data = { generated: new Date().toISOString(), out: OUT, repoNames, slices: corr.slices, dims, ledger: ledgerLite, worklist: scopedWorklist, reconciled, triage,
  meta: { scope: { area: scope.slug, hidden: scoped.hidden }, aliasRules: corr.aliasRulesIngested, excluded: corr.excludedRepos, excludedFrom: corr.excludedFrom, lifecycle: corr.lifecycle || {}, jvmBlindNote: corr.jvmBlindNote } };
const dataJson = JSON.stringify(data).replace(/<\//g, '<\\/');

const html = String.raw`<!doctype html><html lang="en-AU"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>commitwork timeline — corrected</title>
${followerScript()}
<style>
${houseCss()}
 :root{--crit-bg:color-mix(in srgb,var(--crit) 14%,var(--panel));--high-bg:color-mix(in srgb,var(--high) 14%,var(--panel));--med-bg:color-mix(in srgb,var(--med) 14%,var(--panel));--low-bg:color-mix(in srgb,var(--low) 14%,var(--panel));--ok:var(--live);--ok-bg:color-mix(in srgb,var(--live) 14%,var(--panel));--unk:var(--plan);--unk-bg:color-mix(in srgb,var(--plan) 16%,var(--panel));--clean:var(--attest);--clean-bg:color-mix(in srgb,var(--attest) 14%,var(--panel));--blind:var(--crit);--era-clones:color-mix(in srgb,var(--part) 55%,var(--panel));--era-mono:color-mix(in srgb,var(--attest) 55%,var(--panel))}
 body{font-size:.875rem;line-height:1.5}
 .bar{position:sticky;top:0;z-index:9;background:var(--panel);border-bottom:1px solid var(--line);padding:.5625rem 1rem;display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}
 .bar b{font-size:.9375rem}.sp{flex:1}.mut{color:var(--mut);font-size:.7188rem}
 button{font:inherit;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:.375rem;padding:.3125rem .5625rem;cursor:pointer}
 .wrap{max-width:97.5rem;margin:.875rem auto 4.375rem;padding:0 1rem}
 .kpis{display:flex;gap:.625rem;flex-wrap:wrap;margin:0 0 .75rem}
 .kpi{background:var(--panel);border:1px solid var(--line);border-radius:.5rem;padding:.5625rem .9375rem;min-width:7.375rem}
 .kpi .n{font-size:1.25rem;font-weight:700;font-variant-numeric:tabular-nums}.kpi .l{font-size:.6562rem;color:var(--mut);text-transform:uppercase;letter-spacing:.04em}
 .panel{background:var(--panel);border:1px solid var(--line);border-radius:.5rem;margin-bottom:.875rem;overflow:hidden}
 .panel h3{margin:0;padding:.5625rem .8125rem;border-bottom:1px solid var(--line);font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
 .scroll{overflow-x:auto;padding:.625rem .8125rem}
 table.grid{border-collapse:collapse;font-size:.6875rem}
 table.grid th{position:sticky;left:0;background:var(--panel);text-align:right;padding:2px .5rem 2px 2px;font-weight:600;white-space:nowrap;z-index:1}
 table.grid td{padding:1px}
 .cell{min-width:1.375rem;height:1.0625rem;border-radius:.1875rem;display:flex;align-items:center;justify-content:center;cursor:default;border:1px solid transparent;font-size:.625rem;font-weight:700;line-height:1;color:var(--panel);text-shadow:0 1px 2px rgba(0,0,0,.5);padding:0 2px}
 html[data-mode=dark] .cell{color:var(--bg);text-shadow:none}
 .cell.crit{background:var(--crit)}.cell.high{background:var(--high)}.cell.med{background:var(--med)}.cell.low{background:var(--low)}
 .cell.acc{background:var(--med-bg);border-color:var(--med);color:var(--med);text-shadow:none}
 .cell.cleanv{background:var(--ok-bg);border-color:var(--ok)}
 .cell.blind{background:repeating-linear-gradient(45deg,var(--crit-bg),var(--crit-bg) .1875rem,var(--panel) .1875rem,var(--panel) .375rem);border:1px dashed var(--blind);color:var(--blind);text-shadow:none}
 .cell.nosurf{background:transparent;color:var(--mut);text-shadow:none}
 .cell.excl{background:var(--unk-bg);color:var(--mut);text-shadow:none;border:1px dotted var(--mut)}
 .cell.sup{background:var(--panel2);color:var(--acc);text-shadow:none;border:1px dashed var(--acc)}
 .cell.abs{background:var(--unk-bg);opacity:.45}
 .era{height:.3125rem;border-radius:2px}
 .era.clones{background:var(--era-clones)}.era.monorepo{background:var(--era-mono)}
 .axis td{font-size:.625rem;color:var(--mut);writing-mode:vertical-rl;transform:rotate(180deg);padding:.1875rem 1px;white-space:nowrap}
 .badge{font-size:.625rem;text-align:center;color:var(--mut)}
 .legend{font-size:.6875rem;color:var(--mut);display:flex;gap:.8125rem;flex-wrap:wrap;padding:.5rem .8125rem;border-top:1px solid var(--line)}
 .legend i{display:inline-block;width:.75rem;height:.75rem;border-radius:.1875rem;vertical-align:-2px;margin-right:.25rem;border:1px solid transparent}
 .difftbl{width:100%;border-collapse:collapse;font-size:.75rem}
 .difftbl td,.difftbl th{padding:.25rem .5625rem;border-bottom:1px solid var(--line);text-align:left}
 .chip{display:inline-block;padding:1px .4375rem;border-radius:.625rem;font-size:.6875rem;font-weight:600}
 .chip.strong{background:var(--ok-bg);color:var(--ok)}.chip.medium{background:var(--med-bg);color:var(--med)}.chip.weak{background:var(--unk-bg);color:var(--unk)}
 .chip.crit{background:var(--crit-bg);color:var(--crit)}.chip.high{background:var(--high-bg);color:var(--high)}.chip.med{background:var(--med-bg);color:var(--med)}.chip.low{background:var(--low-bg);color:var(--low)}
 .chip.retro{background:var(--panel2);color:var(--acc);border:1px solid var(--acc)}
 /* reconcile verdict + disposition badges */
 .rv{display:inline-block;padding:1px .4375rem;border-radius:.625rem;font-size:.6875rem;font-weight:600;cursor:help}
 .rv-ok{background:var(--ok-bg);color:var(--ok)} .rv-mm{background:var(--crit-bg);color:var(--crit)}
 .rv-un{background:var(--med-bg);color:var(--med)} .rv-na{background:transparent;color:var(--unk);cursor:default}
 tr.row-mm{background:var(--crit-bg)} tr.row-un td:first-child{box-shadow:inset .1875rem 0 0 var(--med)}
 .dispo-remediate{background:var(--ok-bg);color:var(--ok)} .dispo-urg-remediate{background:var(--crit-bg);color:var(--crit);border:1px solid var(--crit)}
 .dispo-ignore{background:var(--unk-bg);color:var(--unk)} .dispo-accept{background:var(--clean-bg);color:var(--clean)} .dispo-backlog{background:var(--panel2);color:var(--acc)}
 #tip{position:fixed;z-index:50;max-width:28.75rem;background:var(--panel);border:1px solid var(--line);border-radius:.5rem;box-shadow:0 .375rem 1.5rem rgba(0,0,0,.25);padding:.5rem .625rem;font-size:.7188rem;display:none}
 svg{display:block}
</style></head><body>
<div class="bar"><b>commitwork timeline — corrected</b><span class="mut" id="src"></span><div class="sp"></div>
 <button id="tsv">Export grid TSV</button>
 <a href="./timeline.html" style="text-decoration:none"><button>Uncorrected v0 view ↗</button></a>
 <button id="theme" title="dark mode">☾</button></div>
<div class="wrap">
 <div class="panel"><h3>Posture by dimension (latest evidence per lane — a green deps lane never speaks for images/JVM/CodeQL/runtime)</h3><div style="padding:12px 13px 0"><div class="kpis" id="kpis"></div></div></div>
 <div class="panel"><h3 style="display:flex;align-items:center;gap:8px;cursor:pointer" id="workhead"><span id="workarrow">▸</span> Program worklist — dependency-ordered, source-cited <span class="mut" id="worksum"></span></h3><div id="work" style="display:none"></div></div>
 <div class="panel"><h3 style="display:flex;align-items:center;gap:8px;cursor:pointer" id="triagehead"><span id="triagearrow">▸</span> Remediation triage — authored-judgment disposition (HITL)</h3><div id="triage" style="display:none"></div></div>
 <div class="panel"><h3>Fleet grid — corrected (canonical counts; blind ≠ clean; excluded ≠ absent)</h3><div class="scroll" id="grid"></div>
  <div class="legend"><span><i style="background:var(--crit)"></i>open (worst crit)</span><span><i style="background:var(--high)"></i>high</span><span><i style="background:var(--med)"></i>med</span><span><i style="background:var(--low)"></i>low</span><span><i style="background:var(--med-bg);border-color:var(--med)"></i>Na = N accepted, 0 open</span><span><i style="background:var(--ok-bg);border-color:var(--ok)"></i>scanned clean (visible)</span><span><i class="cell blind" style="width:12px;height:12px;padding:0"></i>BLIND — Gradle deps invisible (no lockfile); NOT clean</span><span>· no dependency surface</span><span><i style="background:var(--unk-bg);border:1px dotted var(--mute)"></i>✕ excluded (CVEs present, out of scope)</span><span><i style="background:var(--tint);border:1px dashed var(--accent)"></i>⤳ superseded (rollback standby — folded into successor; out of active scope; NOT retired, NOT clean)</span><span><i style="background:var(--unk-bg);opacity:.45"></i>not scanned</span><span>cell number = open canonical findings</span></div></div>
 <div class="panel"><h3>Dimension lanes — the scans the deps timeline never carried</h3><div class="scroll" id="lanes"></div></div>
 <div class="panel"><h3>Cleaned vs cleanable — canonical open (line) vs verified cleaned (ledger strong+medium)</h3><div class="scroll" id="series"></div></div>
 <div class="panel"><h3>Remediation ledger — <span class="mut" id="lsum"></span></h3><div class="scroll" id="ledger"></div></div>
</div>
<div id="tip"></div>
<script id="data" type="application/json">__DATA__</script>
<script>
const D=JSON.parse(document.getElementById('data').textContent);
const S=D.slices,R=D.repoNames;
document.getElementById('src').textContent=S.length+' slices · '+R.length+' repos · alias rules '+D.meta.aliasRules+' · built '+new Date(D.generated).toLocaleString();
// ---- KPIs ----
const lastReal=[...S].reverse().find(s=>s.event.kind!=='empty-run');
const cleaned=D.ledger.filter(e=>e.tier!=='weak').length, unconf=D.ledger.filter(e=>e.tier==='weak').length;
const dimKpi=(k,label)=>{const d=D.dims[k];if(!d||!d.snapshots.length)return ['',0,label+' — no data'];const s=[...d.snapshots].reverse().find(x=>x.fleet);return [s.fleet.crit>0?'crit':(s.fleet.high>0?'high':''),(s.fleet.crit||0)+'C/'+(s.fleet.high||0)+'H/'+(s.fleet.med||0)+'M',label+' @ '+String(s.date).slice(0,10)];};
const f=lastReal.fleet;
const kpis=[['deps',f.open.crit+'C/'+f.open.high+'H/'+f.open.med+'M/'+f.open.low+'L','deps open @ '+lastReal.stamp+(f.accepted?' (+'+f.accepted+' accepted)':'')],
 dimKpi('jvm','JVM fat-jar'),dimKpi('images','container images'),dimKpi('codeql','CodeQL'),dimKpi('runtime','runtime DAST'),
 ['ok',cleaned,'cleaned (verified: strong+medium)'],['unk',unconf,'unconfirmed (weak — NOT cleaned)']];
document.getElementById('kpis').innerHTML=kpis.map(([c,n,l])=>'<div class="kpi"><div class="n" style="'+(c==='crit'?'color:var(--crit)':c==='high'?'color:var(--high)':c==='ok'?'color:var(--clean)':'')+'">'+n+'</div><div class="l">'+l+'</div></div>').join('');
// ---- grid ----
const worst=o=>o.crit?'crit':o.high?'high':o.med?'med':o.low?'low':'';
const EVB={'method-change':'⚠','subject-switch':'⇄','scope-change':'⊘','real-fix':'✓','empty-run':'∅','baseline':'●','steady':'·','v1':'◆','unclassified':'?'};
function cellFor(sl,repo){
 const v=sl.repos[repo];
 if(!v)return {cls:'abs',txt:'',tip:sl.event.kind==='empty-run'?'empty run — nothing scanned':'not scanned in this slice'};
 if(v.state==='findings'){const w=worst(v.open);return {cls:w,txt:String(v.openTotal),tip:v.open.crit+'c · '+v.open.high+'h · '+v.open.med+'m · '+v.open.low+'l open (canonical) · '+v.accepted+' accepted<br>raw '+v.raw+' → distinct '+v.distinct+' → canonical '+v.canonical+'<br>tools: '+JSON.stringify(v.tools)};}
 if(v.state==='accepted-only')return {cls:'acc',txt:v.accepted+'a',tip:v.accepted+' accepted, 0 open · raw '+v.raw+' → canonical '+v.canonical};
 if(v.state==='blind-jvm')return {cls:'blind',txt:'▨',tip:'<b>BLIND, not clean</b> — Gradle service scanned without a lockfile: JVM deps invisible to osv/npm.<br>True exposure for this era: see JVM lane (102C/675H fleet @ 2026-06-27).'};
 if(v.state==='no-surface')return {cls:'nosurf',txt:'·',tip:'no dependency surface ('+v.surface+') — nothing for the deps scanner to find; not the same as remediated'};
 if(v.state==='excluded')return {cls:'excl',txt:'✕',tip:'EXCLUDED from scan scope (retired Eureka pair) — jackson-databind MEDs still present in the tree, not counted anywhere'};
 if(v.state==='superseded')return {cls:'sup',txt:'⤳',tip:'<b>SUPERSEDED (rollback standby)</b>'+(v.lifecycle&&v.lifecycle.supersededBy?' — folded into <b>'+v.lifecycle.supersededBy+'</b>':'')+(v.lifecycle&&v.lifecycle.effectiveFrom?' from '+v.lifecycle.effectiveFrom:'')+'; tree retained for rollback, out of ACTIVE scan scope.<br>NOT retired · NOT clean · findings not counted in active totals.'+(v.note?'<br>'+v.note:'')};
 return {cls:'cleanv',txt:'',tip:'scanned clean — dependency surface visible ('+v.surface+'), zero findings'};
}
function renderGrid(){
 let h='<table class="grid"><tbody>';
 h+='<tr><th></th>'+S.map(sl=>'<td><div class="era '+sl.subject.era+'" title="'+sl.subject.scanRoot+'"></div></td>').join('')+'</tr>';
 h+='<tr><th></th>'+S.map(sl=>'<td><div class="badge" title="'+sl.event.kind+': '+(sl.event.note||'')+'">'+(EVB[sl.event.kind]||'')+'</div></td>').join('')+'</tr>';
 for(const repo of R){
  h+='<tr><th>'+repo+'</th>'+S.map((sl,i)=>{const c=cellFor(sl,repo);return '<td><span class="cell '+c.cls+'" data-i="'+i+'" data-r="'+repo+'">'+c.txt+'</span></td>';}).join('')+'</tr>';
 }
 h+='<tr class="axis"><td></td>'+S.map(sl=>'<td>'+sl.sliceId.replace(/^(sweep-|adhoc-|v0-)/,'')+(sl.v1?'':'·v0')+(sl.provenance&&sl.provenance.dirty?' ⚠dirty:'+sl.provenance.dirty:'')+'</td>').join('')+'</tr>';
 h+='</tbody></table>';
 document.getElementById('grid').innerHTML=h;
 document.querySelectorAll('.cell[data-i]').forEach(el=>{
  el.onmouseenter=e=>{const sl=S[el.dataset.i];const c=cellFor(sl,el.dataset.r);const t=document.getElementById('tip');
   t.innerHTML='<b>'+el.dataset.r+'</b> @ '+sl.sliceId+' <span class="mut">('+sl.subject.era+' era'+(sl.provenance&&sl.provenance.sha?' · '+sl.provenance.sha+(sl.provenance.dirty?' dirty:'+sl.provenance.dirty:''):'')+')</span><br>'+c.tip+'<br><span class="mut">'+sl.event.kind+': '+(sl.event.note||'')+'</span>';
   t.style.display='block';t.style.left=Math.min(e.clientX+12,innerWidth-470)+'px';t.style.top=(e.clientY+12)+'px';};
  el.onmouseleave=()=>document.getElementById('tip').style.display='none';
 });
}
// ---- dimension lanes ----
function renderLanes(){
 let h='';
 for(const k of ['jvm','images','codeql','runtime']){
  const d=D.dims[k];if(!d)continue;
  h+='<div style="margin-bottom:10px"><b style="font-size:12px">'+k+'</b> <span class="mut">'+ (d.note||'') +'</span><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">';
  for(const s of d.snapshots){ if(!s.fleet)continue;
   const bad=(s.fleet.crit||0)>0?'crit':(s.fleet.high||0)>0?'high':'ok';
   h+='<div class="kpi" style="padding:5px 9px;min-width:0" title="'+(s.event||'')+' — '+(s.source||'')+'"><div class="n" style="font-size:13px;color:var(--'+(bad==='ok'?'ok':bad)+')">'+(s.fleet.crit||0)+'C/'+(s.fleet.high||0)+'H/'+(s.fleet.med||0)+'M</div><div class="l">'+String(s.date).slice(0,10)+' '+(s.event||'').slice(0,28)+'</div></div>';
  }
  h+='</div></div>';
 }
 document.getElementById('lanes').innerHTML=h;
}
// ---- series ----
function renderSeries(){
 const W=Math.max(560,S.length*34+60),H=190,P=30;
 const open=S.map(sl=>sl.event.kind==='empty-run'?null:sl.fleet.open.crit+sl.fleet.open.high+sl.fleet.open.med+sl.fleet.open.low);
 const bySlice={};D.ledger.filter(e=>e.tier!=='weak').forEach(e=>{bySlice[e.resolved]=(bySlice[e.resolved]||0)+1;});
 let cum=0;const cleaned=S.map(sl=>{cum+=(bySlice[sl.sliceId]||0);return cum;});
 const mx=Math.max(1,...open.filter(v=>v!==null),...cleaned);
 const x=i=>P+i*((W-2*P)/Math.max(1,S.length-1)),y=v=>H-P-(v/mx)*(H-2*P);
 let path='';open.forEach((v,i)=>{if(v===null)return;path+=(path?'L':'M')+x(i).toFixed(1)+','+y(v).toFixed(1);});
 const cpath=cleaned.map((v,i)=>(i?'L':'M')+x(i).toFixed(1)+','+y(v).toFixed(1)).join(' ');
 document.getElementById('series').innerHTML='<svg width="'+W+'" height="'+H+'">'+
  '<path d="'+path+'" fill="none" stroke="var(--high)" stroke-width="2"/>'+
  '<path d="'+cpath+'" fill="none" stroke="var(--clean)" stroke-width="2"/>'+
  S.map((sl,i)=>(open[i]===null?'':'<circle cx="'+x(i)+'" cy="'+y(open[i])+'" r="2.5" fill="var(--high)"><title>'+sl.sliceId+' open='+open[i]+'</title></circle>')+'<circle cx="'+x(i)+'" cy="'+y(cleaned[i])+'" r="2.5" fill="var(--clean)"><title>'+sl.sliceId+' cleaned(cum)='+cleaned[i]+'</title></circle>').join('')+
  '<text x="'+P+'" y="14" fill="var(--high)" font-size="10">canonical open</text><text x="'+(P+110)+'" y="14" fill="var(--clean)" font-size="10">cumulative cleaned (verified, incl retro)</text></svg>'+
  '<div class="mut" style="padding:4px 0">the cleaned step lands at the retro resolvedSlice — per-finding evidence in the ledger below; weak-tier entries are excluded from this line</div>';
}
// ---- ledger ----
function renderLedger(){
 const t={strong:0,medium:0,weak:0};D.ledger.forEach(e=>t[e.tier]=(t[e.tier]||0)+1);
 document.getElementById('lsum').textContent=D.ledger.length+' entries · strong '+(t.strong||0)+' · medium '+(t.medium||0)+' · unconfirmed '+(t.weak||0);
 const rows=D.ledger.slice().sort((a,b)=>(a.tier==='strong'?0:a.tier==='medium'?1:2)-(b.tier==='strong'?0:b.tier==='medium'?1:2)).map(e=>
  '<tr><td><span class="chip '+e.tier+'">'+(e.tier==='weak'?'unconfirmed':e.tier)+'</span>'+(e.retro?' <span class="chip retro">retro</span>':'')+'</td><td><span class="chip '+e.sev+'">'+e.sev+'</span></td><td><b>'+(e.pkg||'')+'</b>'+(e.from?' '+e.from+(e.to?' → '+e.to:''):'')+'</td><td>'+e.id+'</td><td>'+e.repo+'</td><td class="mut">'+e.detail+'</td></tr>').join('');
 document.getElementById('ledger').innerHTML='<table class="difftbl"><tr><th>evidence</th><th>sev</th><th>package</th><th>advisory</th><th>repo</th><th>detail</th></tr>'+rows+'</table>';
}
// ---- program worklist (expansion toggle) ----
function renderWork(){
 const progs=(D.worklist&&D.worklist.programs)||[];
 if(!progs.length){document.getElementById('worksum').textContent='(no worklist data)';return;}
 // reconciled overlay index: program.key -> item.id -> {verdict, derivedStatus, source}
 const rec=(D.reconciled&&D.reconciled.programs)||[];
 const recIdx={}; for(const rp of rec){recIdx[rp.key]={}; for(const ri of rp.items) recIdx[rp.key][ri.id]=ri;}
 const rsum=(D.reconciled&&D.reconciled.summary)||null;
 const counts=progs.map(p=>{const c={done:0,gated:0,open:0};p.items.forEach(i=>c[i.status]=(c[i.status]||0)+1);return c;});
 // summary LEADS with the reconcile coverage (unverifiable = the actionable debt), per design.
 let sumTxt='';
 if(rsum){sumTxt='machine-reconcile: <b class="rv-un">'+rsum.unverifiable+' unverifiable</b> (no machine backing — human must verify) · '+rsum.agree+' agree · <b class="rv-mm">'+rsum.mismatch+' mismatch</b>  ‖  ';}
 sumTxt+=progs.map((p,i)=>p.key+': '+(counts[i].done||0)+'d·'+(counts[i].gated||0)+'g·'+(counts[i].open||0)+'o').join('  |  ');
 document.getElementById('worksum').innerHTML=sumTxt;
 const chip=s=>s==='done'?'<span class="chip strong">done</span>':s==='gated'?'<span class="chip medium">gated</span>':'<span class="chip high">open</span>';
 // reconcile verdict badge — unverifiable is emphasized (amber, the debt); mismatch loud (red); agree muted (green).
 const rvBadge=ri=>{ if(!ri) return '<span class="rv rv-na" title="no reconciler run">—</span>';
  if(ri.verdict==='unverifiable') return '<span class="rv rv-un" title="'+esc(ri.source||'')+'">unverifiable</span>';
  if(ri.verdict==='mismatch') return '<span class="rv rv-mm" title="'+esc(ri.source||'')+'">mismatch → '+(ri.derivedStatus||'?')+'</span>';
  return '<span class="rv rv-ok" title="'+esc(ri.source||'')+'">agree</span>'; };
 let h='';
 for(const p of progs){
  const ix=recIdx[p.key]||{};
  h+='<div class="scroll"><b style="font-size:12px">'+p.title+'</b><table class="difftbl" style="margin-top:6px"><tr><th>#</th><th>phase</th><th>item</th><th>depends on</th><th>status</th><th>machine</th><th>evidence</th></tr>';
  for(const it of p.items){const ri=ix[it.id];
   h+='<tr class="'+(ri&&ri.verdict==='mismatch'?'row-mm':ri&&ri.verdict==='unverifiable'?'row-un':'')+'"><td><b>'+it.id+'</b></td><td>'+it.phase+'</td><td>'+esc(it.title)+'</td><td class="mut">'+(it.deps.length?it.deps.join(', '):'—')+'</td><td>'+chip(it.status)+'</td><td>'+rvBadge(ri)+'</td><td class="mut">'+esc(it.evidence)+'</td></tr>';}
  h+='</table></div>';
 }
 h+='<div class="legend"><span>rows dependency-ordered</span><span><span class="chip strong">done</span>/<span class="chip medium">gated</span>/<span class="chip high">open</span> = authored status</span><span><span class="rv rv-un">unverifiable</span> no machine source — authored status unbacked</span><span><span class="rv rv-mm">mismatch</span> machine contradicts authored</span><span><span class="rv rv-ok">agree</span> machine corroborates</span></div>';
 document.getElementById('work').innerHTML=h;
 document.getElementById('workhead').onclick=()=>{const w=document.getElementById('work');const open=w.style.display==='none';w.style.display=open?'block':'none';document.getElementById('workarrow').textContent=open?'▾':'▸';};
 renderTriage();
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
// ---- disposition triage layer (HITL) — reads the authored disposition field; v1 read-only surface ----
function renderTriage(){
 const el=document.getElementById('triage'); if(!el) return;
 const t=(D.triage)||[];
 if(!t.length){el.innerHTML='<span class="mut">(no authored-judgment records)</span>';return;}
 const DISPO=['remediate','urg-remediate','ignore','accept','backlog'];
 const dchip=d=>d?'<span class="rv dispo-'+d+'">'+d+'</span>':'<span class="rv rv-un">untriaged</span>';
 const untriaged=t.filter(r=>!r.disposition).length;
 let h='<div class="mut" style="margin-bottom:6px">'+t.length+' authored-judgment records · <b class="rv-un">'+untriaged+' untriaged</b> (no forward disposition set). Disposition is the FORWARD triage intent, separate from the as-of <code>action</code>.</div>';
 h+='<table class="difftbl"><tr><th>store</th><th>ref</th><th>repo/image</th><th>action (as-of)</th><th>disposition (next)</th><th>who</th><th>expires</th><th>rationale</th></tr>';
 for(const r of t) h+='<tr><td class="mut">'+esc(r.store)+'</td><td><b>'+esc(r.ref)+'</b></td><td>'+esc(r.repo)+'</td><td>'+esc(r.action)+'</td><td>'+dchip(r.disposition)+'</td><td class="mut">'+esc(r.who)+'</td><td class="mut">'+esc(r.expires||'—')+'</td><td class="mut">'+esc(r.reason).slice(0,120)+'</td></tr>';
 h+='</table><div class="legend"><span>disposition vocabulary:</span>'+DISPO.map(d=>'<span class="rv dispo-'+d+'">'+d+'</span>').join('')+'<span><span class="rv rv-un">untriaged</span> = set one</span></div>';
 el.innerHTML=h;
 const th=document.getElementById('triagehead');
 if(th) th.onclick=()=>{const w=document.getElementById('triage');const open=w.style.display==='none';w.style.display=open?'block':'none';document.getElementById('triagearrow').textContent=open?'▾':'▸';};
}
// ---- TSV export ----
document.getElementById('tsv').onclick=()=>{
 let out='repo\t'+S.map(s=>s.sliceId).join('\t')+'\n';
 for(const repo of R){out+=repo+'\t'+S.map(sl=>{const v=sl.repos[repo];if(!v)return sl.event.kind==='empty-run'?'empty-run':'not-scanned';
  if(v.state==='findings')return v.openTotal+' open('+v.open.crit+'c/'+v.open.high+'h/'+v.open.med+'m/'+v.open.low+'l)'+(v.accepted?'+'+v.accepted+'acc':'');
  if(v.state==='accepted-only')return v.accepted+' accepted';
  if(v.state==='blind-jvm')return 'BLIND(jvm-invisible)';
  if(v.state==='no-surface')return 'no-surface';
  if(v.state==='excluded')return 'EXCLUDED(cves-present)';
  if(v.state==='superseded')return 'SUPERSEDED(rollback-standby'+(v.lifecycle&&v.lifecycle.supersededBy?'→'+v.lifecycle.supersededBy:'')+')';
  return 'clean(visible)';}).join('\t')+'\n';}
 const a=document.createElement('a');a.href='data:text/tab-separated-values;charset=utf-8,'+encodeURIComponent(out);a.download='fleet-grid-corrected.tsv';a.click();
};
renderGrid();renderLanes();renderSeries();renderLedger();renderWork();
</script>${toggleScript()}</body></html>`;
writeFileSync(join(OUT, 'timeline2.html'), html.replace('__DATA__', dataJson));
console.log(`timeline2: ${corr.slices.length} slices · ${repoNames.length} repos · ${ledgerLite.length} ledger entries -> ${join(OUT, 'timeline2.html')}`);
