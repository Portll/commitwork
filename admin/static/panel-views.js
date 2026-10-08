// admin/static/panel-views.js — part 4 of 8 of the panel client.
//
// the Remediation, Posture, Report and Issues views.
//
// Classic scripts, not modules. The eight parts, and the two menu components admin/panel.html
// inlines between them from admin/menus/*.js, share one global lexical scope and run in the order
// panel.html lists them, so reordering them changes when a top-level declaration becomes visible.
// A function declaration is hoisted only within its own script: top-level code may call what an
// earlier script declares, never a later one. That is why panel-boot.js, whose setView() reaches
// loaders in every part, is loaded last.
//
// Every part is declared in STATIC_JS_MODULES in admin/serve.mjs; static/ is an allowlist, so a
// file added here without that entry is never served.

// ── Remediation tab: triage prompts ──────────────────────────────────────────────────────────
// Data: /api/remediation/prompts — each manifest remediationPrompt joined server-side with the
// selected project's scanners entry, so the pill here and the coverage table cannot disagree.
// ORDERING IS THE POINT: a prompt whose category has live findings is actionable NOW and floats
// to the top, severity-weighted; carried counts keep their place but say carried; clean and
// no-signal prompts stay PRESENT but collapsed — a documented procedure does not stop existing
// on a clean day, and hiding it is how procedures get lost.
// ── Posture tab ───────────────────────────────────────────────────────────────────────────────
// Data: /api/posture — monitor/posture.mjs's computePosture(), the SAME function the CLI calls, so
// this page and `node monitor/posture.mjs <area>` cannot disagree.
//
// The light is computed server-side and rendered here without re-judging it: a second severity
// opinion in the client is how a panel starts disagreeing with its own rollup.
const PO_LIGHT={green:['live','ran in the window, nothing found'],amber:['part','ran, with something to look at'],red:['high','crit/high findings'],grey:['plan','did NOT run — absence of evidence, not a clean result'],'n/a':['na','evaluated and found not to apply — a determination, not a gap']};
// pill + card are shared by BOTH boards (security and delivery) — one renderer, so the two pages
// cannot drift into describing the same light differently.
const poPill=(a)=>{const p=PO_LIGHT[a.light]||PO_LIGHT.grey;
  return `<span class="pill ${p[0]}" title="${esc(p[1])}">${esc(a.light)}</span>`;};
const poCard=(a)=>'<details class="card">'
    +'<summary class="sum-row">'
    +poPill(a)+' <b class="sans t-title">'+esc(a.name)+'</b>'
    +'<span class="pill part t-tag">'+esc(a.type||'unclassified')+'</span>'
    +(a.findsSourceVulns?'<span class="pill high t-tag" title="this approach can find a vulnerability in code we wrote, as opposed to one we inherited from a dependency or a platform setting">source vulns</span>':'')
    +(a.runtime?'<span class="pill plan t-tag" title="needs a live target; without one it records a visible skip rather than scanning nothing">runtime</span>':'')
    +'<span class="mut t-meta">'+esc(a.check)+(a.aliasOf?' → '+esc(a.aliasOf):'')+' · '+esc(a.manifest)+'</span></summary>'
    +'<div class="mut po-why"><b>'+esc(a.light)+':</b> '+esc(a.why)+'</div>'
    +(a.typeLabel?'<div class="mut t-note"><b>type</b> — '+esc(a.typeLabel)+(a.sourceKindLabel?' · <b>reads</b> '+esc(a.sourceKindLabel):'')+'</div>':'')
    +(a.escalates?'<div class="mut note-tight"><b>escalation</b> — '+esc(a.escalates)+'</div>':'')
    +(a.note?'<div class="mut note-tight">'+esc(a.note)+'</div>':'')
    +(a.lastRunAt?'<div class="mut meta-tight">last run '+esc(a.lastRunAt)+'</div>':'')
    // reuses the SAME delegated button.rec handler the scanner tabs use, so a launch from here
    // takes the identical closed-set path (category key -> monitor/scanner-checks.mjs -> check id)
    // and inherits the busy-disable: a targeted scan and a full sweep write the same area.
    +(a.category?'<div class="po-acts">'+recBtn({scanner:a.category,label:a.name})
      +' <span class="mut t-meta">re-run this approach across the project'
      +(a.runtime?' — needs a live target (CW_TARGET_URL); without one it will start, skip and finish':'')+'</span></div>':'')
    +'</details>';
// Lane E · weakness-class VOID strip (#po-classvoids). Classes a lane in scope looks for vs the ones
// NOTHING looks for. A void reuses the board's grey .pill.plan — grey ≠ green (not clean) AND grey ≠
// red (not a finding); "nothing looked" says it in words, so it never rests on the colour. classVoids
// fails closed to an {error} object: an unreadable axis renders grey, never as full coverage.
function renderClassVoids(d){
  const box=$('po-classvoids'); if(!box)return;
  const cv=d&&d.classVoids, cov=(d&&d.classesCovered)||[];
  if(cv===undefined&&!cov.length){box.innerHTML='';return;}
  if(cv&&!Array.isArray(cv)){
    box.innerHTML='<div class="clax"><span class="clax-h">weakness-class coverage</span>'
      +'<span class="pill plan clax-void" title="the class axis could not be computed — NOT a statement that every class is covered">unreadable — nothing looked</span>'
      +' <span class="mut t-meta">'+esc((cv&&cv.error)||'class axis unavailable')+'</span></div>';
    return;
  }
  const voids=Array.isArray(cv)?cv:[], N=cov.length+voids.length;
  const short=(s)=>String(s).replace(/^cwe-\d+-/,'');
  const voidChips=voids.map(v=>'<span class="pill plan clax-void" title="'+esc((v.label||v.class)+' — '+(v.why||'no in-scope lane looks for it'))+'">'+esc(v.label||v.class)+' — nothing looked</span>').join('');
  const covChips=cov.map(c=>'<span class="pill clax-cov" title="'+esc((c.label||c.class)+' — a lane in scope looks for this class (looked is not clean)')+'">'+esc(short(c.class))+'</span>').join('');
  box.innerHTML='<div class="clax">'
    +'<span class="clax-h">weakness-class coverage</span>'
    +(voids.length
      ?'<span class="mut t-meta">'+voids.length+' of '+N+' declared classes have NO lane in scope — a class nothing looks for reads exactly like a clean one</span>'
      :'<span class="mut t-meta">every declared class has a lane in scope — a lane looks, which is not the same as clean</span>')
    +'<div class="clax-row">'+voidChips+covChips+'</div></div>';
}
function renderPosture(d){
  const n=$('po-n'),win=$('po-window'),box=$('po-cards');
  if(!box)return;
  renderClassVoids(d);
  const aps=(d&&d.approaches)||[];
  if(!aps.length){n.textContent='—';box.innerHTML='<span class="mut">no approaches resolved for this project — its registry entry declares no manifest, so there is nothing to report either way</span>';return;}
  const t=d.tally||{};
  n.textContent=`${t.red||0} red · ${t.amber||0} amber · ${t.green||0} green · ${t.grey||0} grey`;
  // The window banner comes FIRST because it conditions every light below it: if no sweep landed
  // in seven days, every green on this page is describing a result older than the window.
  if(win){
    const w=(d&&d.window)||{};
    win.innerHTML=w.slices
      ?`<span class="pill live">${w.slices} sweep slice(s) in the last ${d.windowDays} days</span> <span class="mut">newest ${esc(w.newest||'?')}</span>`
      :`<span class="pill plan">no sweep in the last ${d.windowDays} days</span> <span class="mut">every result below predates the window this board reports — treat each light as a claim about an older scan, not about today</span>`;
  }
  box.innerHTML=aps.map(poCard).join('');
  // toolchain
  const tb=$('po-tools'),tn=$('po-tn'),tc=(d&&d.toolchain)||{};
  if(tb){
    tn.textContent=(tc.installed||0)+' of '+(tc.total||0)+' present'+(tc.missing&&tc.missing.length?' · '+tc.missing.length+' MISSING':'');
    tb.innerHTML=(tc.tools||[]).map(t=>'<tr>'
      +'<td><code>'+esc(t.tool)+'</code></td><td>'+esc(t.kind)+'</td>'
      +'<td>'+(t.installed?'<span class="pill live">yes</span>':'<span class="pill high">MISSING</span>')+'</td>'
      +'<td class="mut t-meta">'+esc(t.version||(t.installed?'—':'not installed'))+'</td>'
      +'<td class="mut t-meta">'+esc((t.usedBy||[]).join(', '))+'</td></tr>').join('')
      ||'<tr><td colspan="5" class="mut">no tools declared</td></tr>';
    const f=$('po-tfoot');
    if(f&&tc.probedAt)f.innerHTML=f.innerHTML.replace(/ Probed .*$/,'')+' Probed '+esc(tc.probedAt)+' (cached 5 min — a tool installed since then still reads as missing here).';
  }
  // escalation
  const eb=$('po-esc'),en=$('po-en'),es=(d&&d.escalation)||{};
  if(eb){
    // present:false is "we could not read lifecycle.json", which must not render as "no breaches"
    en.textContent=es.present?(es.breached+' past SLA'):'unknown';
    eb.innerHTML=!es.present
      ?'<tr><td colspan="7" class="mut">lifecycle.json could not be read for this project — this is NOT a statement that nothing is overdue</td></tr>'
      :(es.rows||[]).map(r=>'<tr>'
        +'<td><code>'+esc(r.id||'?')+'</code><div class="mut t-tag">'+esc(r.title||'')+'</div></td>'
        +'<td>'+esc(r.repo||'')+'</td><td>'+esc(r.severity||'')+'</td>'
        +'<td>'+esc(String(r.exposureDays??'?'))+'d</td><td>'+esc(String(r.slaTier??'?'))+'d</td>'
        +'<td><b>'+esc(String(r.overdueDays??'?'))+'d</b></td><td>'+esc(r.residualVerdict||'')+'</td></tr>').join('')
        ||'<tr><td colspan="7" class="mut">nothing is past its SLA tier in this area</td></tr>';
  }
}
// Delivery board — same cards, same honesty rules, different question. Fed from the SAME
// /api/posture payload (d.delivery), so one fetch serves both tabs and they can never disagree
// about a shared approach.
function renderDelivery(d){
  const n=$('dl-n'), box=$('dl-cards');
  if(!box)return;
  const dl=(d&&d.delivery)||{}, aps=dl.approaches||[];
  if(!aps.length){ if(n)n.textContent='—'; box.innerHTML='<span class="mut">no build-health or gate approaches resolved for this project</span>'; return; }
  const t=dl.tally||{};
  // n/a is counted SEPARATELY from grey in the header. Folding them together is the whole reason
  // this board exists: "does not apply" and "never evaluated" are different answers.
  if(n)n.textContent=`${t.red||0} red · ${t.amber||0} amber · ${t.green||0} green · ${t.grey||0} unknown · ${t['n/a']||0} n/a`;
  box.innerHTML=aps.map(poCard).join('');
}
// Accessibility board — WCAG 2.2 by criterion, from the rollup's a11y artifact via /api/a11y.
// SEVEN states, not four. The three `attested-*` ones are the human layer: a person opened the page
// and checked a criterion no static analysis can decide. `signed pass` is BLUE, never the --live
// green of `pass`, and it is a different word in the store, in the API and here: `pass` means a
// machine measured it, `signed pass` means a named person signed for it, and a UI that painted
// the two the same colour would be the one place that distinction died. See a11y-attestations.mjs.
const A11Y_STATE={fail:['high','checked statically — violations found'],pass:['live','checked statically — none found'],unchecked:['plan','NOT decidable from static markup — needs a browser or a person. Not a pass.'],'n/a':['na','no applicable content on these pages'],'signed pass':['attest','a named person verified this by hand against this exact page content — a signature, NOT a scanner pass'],'attested-n/a':['na','a named person determined it does not apply to these pages'],'attested-fail':['high','a named person checked this and it is broken — counted exactly like a scanner failure']};
// The content digest of the pages the current audit read. POSTed back with an attestation so a
// verification filed against a build that moved while the tab sat open is refused rather than
// mis-attached: the same guarantee as an ETag, for the same reason.
let A11Y_DIGEST=null;
// One cell of the attestation column: the box, who signed it, when, and why it is not in force.
function a11yAttCell(r,scope){
  const crit=esc(r.id), a=r.attestation;
  if(!r.attestable&&!a)return '<td class="mut att-cell">—</td>';
  const on=!!(a&&a.action==='attest');
  const dis=scope.canAttest?'':' disabled';
  let out='<label class="att-row"><input type="checkbox" class="att-box" data-crit="'+crit+'"'+(on?' checked':'')+dis
    +' aria-label="I manually verified WCAG '+crit+' '+esc(r.name)+' on this exact page content">'
    +'<span class="att-lbl">verified by hand</span></label>';
  if(a){
    // whoKind decides the colour, exactly as the annotation ledger does: olive for a signature an
    // agent wrote. Colour is never the only channel here - notCounted says it in words too.
    out+='<div class="att-sig"><span class="'+(a.whoKind==='human'?'who-human':'who-machine')+'">'+esc(a.who)+'</span> '
      +'<span class="mut">'+esc(String(a.at||'').slice(0,10))+'</span>'
      +(a.status!=='active'?' <span class="pill part t-micro" title="an attestation that is not in force clears nothing">'+esc(a.status)+'</span>':'')
      +(a.expires&&a.status==='active'?'<div class="mut">re-check by '+esc(String(a.expires).slice(0,10))+'</div>':'')
      +(a.notCounted?'<div class="mut">'+esc(a.notCounted)+'</div>':'')
      +(a.note?'<div class="att-said">“'+esc(a.note)+'”</div>':'')
      +'</div>';
  }else if(!scope.canAttest&&scope.reason){ out+='<div class="mut att-sig">'+esc(scope.reason)+'</div>'; }
  if(scope.canAttest&&!on){
    out+='<input type="text" class="att-note" data-note="'+crit+'" maxlength="2000" placeholder="what you checked (optional)"'
      +' aria-label="What you checked when verifying WCAG '+crit+', recorded with your attestation">';
  }
  out+='<div class="att-msg" id="att-msg-'+crit+'"></div>';
  return '<td class="att-cell">'+out+'</td>';
}
function renderA11y(d){
  const n=$('a11y-n'), conf=$('a11y-conf'), body=$('a11y-rows');
  if(!body)return;
  if(!d||d.ok===false||!d.criteria){ if(n)n.textContent='—'; A11Y_DIGEST=null;
    body.innerHTML='<tr><td colspan="6" class="mut">'+esc((d&&d.reason)||'no accessibility audit in this area’s latest sweep — not a pass, simply unmeasured')+'</td></tr>';
    if(conf)conf.innerHTML=''; return; }
  const scope=d.attestation||{canAttest:false,reason:null};
  A11Y_DIGEST=d.subjectDigest||null;
  const L=d.levels||{A:{},AA:{}}, X=d.attestedLevels||null;
  const att=X?((X.A.attestedPass||0)+(X.AA.attestedPass||0)):0;
  if(n)n.textContent=(((X?X.A.fail:L.A.fail)||0)+((X?X.AA.fail:L.AA.fail)||0))+' failing · '
    +(((X?X.A.unchecked:L.A.unchecked)||0)+((X?X.AA.unchecked:L.AA.unchecked)||0))+' unchecked'
    +(att?' · '+att+' attested':'');
  // the conformance claim comes FIRST, because a table of mostly-green rows invites the reader to
  // conclude something the scanner never said
  const c=d.conformance||{};
  const badge=(lvl,v)=>'<span class="pill '+(v==='conformant'?'live':v==='fails'?'high':'plan')+'">Level '+lvl+': '+esc(v||'unknown')+'</span>';
  // TWO claims, never one. The first is the scanner's alone and is the artifact's own words; the
  // second also counts what people signed for, and says out loud that it rests on signatures.
  const abadge=(lvl,v)=>'<span class="pill '+(v==='conformant'?'attest':v==='fails'?'high':'plan')+'">Level '+lvl+' incl. attestations: '+esc(v||'unknown')+'</span>';
  const ac=d.attestedConformance||null;
  if(conf)conf.innerHTML='<div class="card gap-banner">'+badge('A',c.A)+' '+badge('AA',c.AA)
    +'<div class="mut note-gap">'+esc(c.note||'')+'</div>'
    +'<div class="mut meta-tight">A: '+(L.A.pass||0)+' pass · '+(L.A.fail||0)+' fail · '+(L.A.unchecked||0)+' unchecked'
    +'   AA: '+(L.AA.pass||0)+' pass · '+(L.AA.fail||0)+' fail · '+(L.AA.unchecked||0)+' unchecked</div>'
    +(ac&&X?'<div class="anno-acts">'+abadge('A',ac.A)+' '+abadge('AA',ac.AA)+'</div>'
      +'<div class="mut note-gap">'+esc(ac.note||'')+'</div>'
      +'<div class="mut meta-tight">A: '+(X.A.pass||0)+' pass · '+(X.A.attestedPass||0)+' attested · '+(X.A.fail||0)+' fail · '+(X.A.unchecked||0)+' unchecked'
      +'   AA: '+(X.AA.pass||0)+' pass · '+(X.AA.attestedPass||0)+' attested · '+(X.AA.fail||0)+' fail · '+(X.AA.unchecked||0)+' unchecked</div>':'')
    +'</div>';
  body.innerHTML=(d.criteria||[]).map(r=>{
    // the EFFECTIVE state drives the pill, and it carries the attested-* words verbatim so the row
    // never says `pass` about something only a person vouched for
    const eff=r.effectiveState||r.state;
    const st=A11Y_STATE[eff]||A11Y_STATE.unchecked;
    const detail=r.state==='fail'
      ? (r.findings||[]).slice(0,4).map(f=>esc(f.detail)).join('<br>')+((r.findings||[]).length>4?'<br><span class="mut">+'+((r.findings.length)-4)+' more</span>':'')
      : '<span class="mut">'+esc(r.why||(r.state==='pass'?'no violation found in the static pass':''))+'</span>'
        +(r.howToVerify?'<div class="mut note-gap">'+esc(r.howToVerify)+'</div>':'');
    return '<tr><td><span class="pill '+st[0]+'" title="'+esc(st[1])+'">'+esc(eff)+'</span></td>'
      +'<td><code>'+esc(r.id)+'</code></td><td>'+esc(r.level)+(r.wcag22?' <span class="pill part t-micro">2.2</span>':'')+'</td>'
      +'<td>'+esc(r.name)+'</td><td class="mut cell-why">'+detail+'</td>'+a11yAttCell(r,scope)+'</tr>';
  }).join('')||'<tr><td colspan="6" class="mut">no criteria reported</td></tr>';
}
// One box toggled. Checking it FILES a signature and unchecking it WITHDRAWS one - neither is a
// local UI state, so the box is driven by the server's answer and reverts on a refusal.
async function a11yAttest(ev){
  const box=ev.target;
  if(!box||!box.classList||!box.classList.contains('att-box'))return;
  const crit=box.dataset.crit, want=box.checked, msg=$('att-msg-'+crit);
  const noteEl=document.querySelector('.att-note[data-note="'+(window.CSS&&CSS.escape?CSS.escape(crit):crit)+'"]');
  const say=(t,err)=>{ if(msg){ msg.className='att-msg'+(err?' err':''); msg.textContent=t; } };
  box.disabled=true; say(want?'recording…':'withdrawing…',false);
  try{
    // The digest is PINNED on the way back: a verification of the build that was on screen is not
    // a verification of one that landed while the box was being read.
    const body=want
      ? {criterion:crit,verdict:'meets',subjectDigest:A11Y_DIGEST||undefined,note:(noteEl&&noteEl.value.trim())||undefined}
      : {criterion:crit};
    const r=await cwPost((want?'/api/a11y/attest':'/api/a11y/attest/clear')+'?project='+encodeURIComponent(curProj||''),
      {headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    let j=null; try{ j=await r.json(); }catch(_){ j=null; }
    if(!r.ok||!j||j.ok===false){
      box.checked=!want;                                  // the server refused; the box must not lie
      say((j&&(j.errors&&j.errors[0]||j.error))||('refused ('+r.status+')'),true);
      return;
    }
    await loadA11y();
  }catch(e){ box.checked=!want; say(e.message,true); }
  finally{ box.disabled=false; }
}
async function loadA11y(){
  const b=$('a11y-rows'); if(b)b.innerHTML='<tr><td colspan="6" class="mut">loading…</td></tr>';
  // Delegated once on the tbody, which survives every innerHTML rewrite below it.
  if(b&&!b.dataset.attWired){ b.dataset.attWired='1'; b.addEventListener('change',a11yAttest); }
  try{ renderA11y(await (await fetch('/api/a11y?project='+encodeURIComponent(curProj||''))).json()); }
  catch(e){ if(b)b.innerHTML='<tr><td colspan="6"><div class="pk-err">could not load the audit: '+esc(e.message)+'</div></td></tr>'; }
}
async function loadPosture(){
  const box=$('po-cards');
  if(box)box.innerHTML='<span class="mut">loading…</span>';
  try{ const d=await (await fetch('/api/posture?project='+encodeURIComponent(curProj||''))).json(); renderPosture(d); renderDelivery(d); }
  catch(e){ if(box)box.innerHTML='<div class="pk-err">could not load the posture board: '+esc(e.message)+'</div>'; const n=$('po-n'); if(n)n.textContent='—'; }
}
// Which tab already renders per-finding rows for a category. DECLARED, not derived: only these
// categories have a detail table to open, and guessing a tab name for the rest would produce a
// button that lands on an empty page — worse than no button, because an empty table reads as clean.
// Kept on ONE line: admin/test/remediation-prompts.test.mjs lifts it out of this source by
// `startsWith('const RP_VIEW_TAB=')`, the same single-line technique the other render tests use.
const RP_VIEW_TAB={secrets:'secrets',maliciousPackages:'malware',supplyChainHeuristic:'supplychain',sastSemgrep:'sast',sastCodeql:'sast',sastCodeqlJava:'sast',sastGo:'sast',iac:'iac',dast:'dast',actionsPosture:'actions',minifiedCode:'minify'};
// ONE classifier for a prompt's live counts, carried or not, and the same covState the coverage
// table uses: -1 no signal, 0 scanned clean, >0 findings (sev-ranked). A carried row that never ran
// used to bypass covState and fall through to total 0, rendering a green clean for a lane nothing
// had scanned — four of them on the 100-repo corpus, 2026-09-12. The project cards and the fleet
// page's per-project tally both read this, so the two cannot classify one count differently.
function rpWeight(l){
  if(!l)return -1;
  const st=covState(l), t=Number(l.total)||0;
  if(st==='na'||st==='unrun'||st==='void')return -1;
  // No run record and no findings proves nothing either way.
  if(st===null&&t===0)return -1;
  return t===0?0:(l.crit||0)*1e9+(l.high||0)*1e6+(l.med||0)*1e3+t;
}
function renderRemediationPrompts(d){
  const box=$('rp-cards'), n=$('rp-n');
  if(!box||!n)return;
  const ps=(d&&d.prompts)||[];
  if(!ps.length){n.textContent='—';box.innerHTML='<span class="mut">no remediation prompts declared in any manifest — write check.remediationPrompt guidance there</span>';return;}
  const DARK=new Set(['na','unrun','void']);
  const weight=(p)=>rpWeight(p.live);
  const act=ps.filter(p=>weight(p)>0).sort((a,b)=>weight(b)-weight(a));
  const clean=ps.filter(p=>weight(p)===0);
  const dark=ps.filter(p=>weight(p)<0);
  // A carried count is a past slice's; the pill dates it as the coverage table row does.
  const carriedPill=(l)=>l.carried?'<span class="pill part" title="not re-run by the latest sweep — the count is slice '+esc(l.carriedFrom||'?')+'’s and chains until rescanned">carried'+(l.carriedAt?' · as of '+age(l.carriedAt):'')+'</span> ':'';
  const pillFor=(p)=>{const l=p.live;
    if(!l)return '<span class="pill plan" title="this check is outside the fleet scanner categories, or the rollup never spoke for it — no live counts exist, which is not the same as zero">no live counts</span>';
    const st=covState(l), c=carriedPill(l);
    if(st==='contradiction'||DARK.has(st)){const cc=COV_COPY(l,st);return c+'<span class="pill '+cc.cls+'" title="'+cc.why+'">'+cc.label+'</span>';}
    if(!(Number(l.total)||0))return c+(st===null
      ?'<span class="pill plan" title="a count with no run record behind it — zero findings with nothing to say a scan happened is unknown, not clean">no provenance</span>'
      :'<span class="pill live">clean</span>');
    return c+'<span class="pill '+((l.crit||l.high)?'high':'part')+'">'+l.total+' finding(s)'+(l.crit?' · '+l.crit+'C':'')+(l.high?' · '+l.high+'H':'')+'</span>';};
  const card=(p,open)=>'<details class="card"'+(open?' open':'')+'>'
    +'<summary class="sum-row">'
    +'<b class="sans t-title">'+esc(plainCheck(SCANNER_LABEL[p.category]||p.category||p.check))+'</b> '+pillFor(p)
    +'<span class="mut t-meta">'+esc(p.check)+(p.aliasOf?' → '+esc(p.aliasOf):'')+' · '+esc(p.manifest)+'</span></summary>'
    +(p.description?'<div class="mut rp-desc">'+esc(p.description)+'</div>':'')
    +'<pre data-rp-prompt class="blk-pre blk-tight">'+esc(p.prompt)+'</pre>'
    +'<div class="actrow">'
    // LAUNCH AND VIEW, PER CHUNK. A remediation card stated what to do and what the numbers were,
    // but acting on it meant leaving for another tab to re-run the scanner and another again to
    // read its findings. Both now sit on the card: `recBtn` is the same delegated ⏺ handler the
    // scanner tabs use (closed-set category -> check id, never a caller-supplied string), and the
    // view link routes to the tab that already renders this category's per-finding detail.
    +(p.category?recBtn({scanner:p.category,label:p.category})+' ':'')
    +(RP_VIEW_TAB[p.category]?'<button type="button" class="rp-view" data-view="'+esc(RP_VIEW_TAB[p.category])+'" title="open the tab holding this category’s per-finding rows — file, line and rule as the rollup captured them">view findings ▸</button>':'')
    +'<button type="button" class="rp-copy">copy prompt</button>'
    +'<button type="button" class="rp-claude" data-check="'+esc(p.check)+'" title="open VS Code at the target repo and start a Claude Code session in Terminal with this handoff (prompt + artifact path + counts) already submitted">Claude Code ↗</button>'
    +'<button type="button" class="rp-local" data-check="'+esc(p.check)+'" title="triage with a local model — any host declared in manifests/llm-hosts.json, fed this prompt plus the scanner artifact; the exchange is saved as evidence">local LLM ▸</button>'
    +'<span class="rp-status mut t-note"></span></div>'
    +'<div class="rp-llm"></div>'
    +'</details>';
  n.textContent=act.length+' actionable · '+clean.length+' clean · '+dark.length+' no signal'+(d.generated?' · counts '+age(d.generated):'');
  // An unreadable rollup and a project nobody swept both leave every row dark, and they are opposite
  // facts: one is a file that exists and failed, the other is nothing to read.
  const rs=d.rollup||null, sc=d.project||null;
  const darkWhy=sc&&sc.state&&sc.state!=='ok'?esc(sc.why||'the project did not resolve')+' — no counts were read'
    :rs&&rs.state==='unreadable'?'rollup.json is UNREADABLE ('+esc(rs.why||'parse failed')+') — its counts are unknown, not zero'
    :rs&&rs.state==='absent'?'no rollup for this project — nothing has been swept here'
    :'void / no live counts';
  box.innerHTML=act.map((p,i)=>card(p,i===0)).join('')
    +(clean.length?'<details class="blk-tight"><summary class="mut point t-note">'+clean.length+' prompt(s) for categories currently scanned clean</summary>'+clean.map(p=>card(p,false)).join('')+'</details>':'')
    +(dark.length?'<details class="blk-tight"><summary class="mut point t-note">'+dark.length+' prompt(s) with no signal right now ('+darkWhy+') — absence of evidence, not clean</summary>'+dark.map(p=>card(p,false)).join('')+'</details>':'')
    ||'<span class="mut">nothing to show</span>';
}
// "view findings" — delegated like every other handler here, so cards that re-render keep it.
// setView is the same function the nav strip calls, so the hash route and the tab state stay in
// step and a reload lands back on the tab the operator was sent to.
document.addEventListener('click',(e)=>{
  const b=e.target.closest&&e.target.closest('button.rp-view'); if(!b)return;
  const v=b.dataset.view; if(v&&VALID_VIEWS.has(v))setView(v);
},false);
// An in-page tab link: `<a href="/fleet/" data-view="fleet">`. The href is REAL and is what runs if
// this handler never binds — every view is a served path, so the link degrades to a page load rather
// than to nothing. Modified clicks (new tab, new window, download) are left to the browser.
document.addEventListener('click',(e)=>{
  if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  const a=e.target.closest&&e.target.closest('a[data-view]'); if(!a)return;
  const v=a.dataset.view; if(!v||!VALID_VIEWS.has(v))return;
  e.preventDefault(); setView(v);
},false);
// copy-to-clipboard by delegation, so re-renders never lose the handler
document.addEventListener('click',async(e)=>{
  const b=e.target.closest&&e.target.closest('button.rp-copy'); if(!b)return;
  const pre=b.closest('details')&&b.closest('details').querySelector('[data-rp-prompt]'); if(!pre)return;
  try{ await navigator.clipboard.writeText(pre.textContent); b.textContent='copied ✓'; }
  catch(_){ b.textContent='copy failed — select the text'; }
  setTimeout(()=>{ b.textContent='copy prompt'; },1400);
},false);
// Claude Code handoff — the server composes prompt + artifact path + counts into a handoff file,
// opens VS Code at the target repo and starts a claude session in a new Terminal window with the
// handoff already submitted. (There is no public surface for prefilling the VS Code extension's
// chat; the Terminal session IS Claude Code, in the right cwd — stated, not pretended.)
document.addEventListener('click',async(e)=>{
  const b=e.target.closest&&e.target.closest('button.rp-claude'); if(!b)return;
  const st=b.parentElement.querySelector('.rp-status');
  st.textContent='launching…';
  try{
    const r=await cwPost('/api/remediation/handoff',{headers:{'content-type':'application/json'},body:JSON.stringify({check:b.dataset.check,project:curProj||'',engine:'claude'})});
    const d=await r.json().catch(()=>({}));
    st.textContent=(r.ok&&d.started)?('launched — Terminal + VS Code · handoff saved: '+(d.file||'')):(d.error||('refused ('+r.status+')'));
  }catch(err){ st.textContent='could not reach the server: '+err.message; }
},false);
// local-model handoff — first click detects engines (probed live: a model server comes and goes
// with the operator's session); run posts prompt + artifact and renders the reply in place. The
// server writes the same exchange under reports/<area>/handoff/ — triage that leaves no artifact
// might as well not have run.
document.addEventListener('click',async(e)=>{
  const b=e.target.closest&&e.target.closest('button.rp-local'); if(!b)return;
  const card=b.closest('details'), out=card.querySelector('.rp-llm'), st=b.parentElement.querySelector('.rp-status');
  // 'block' rather than !== 'none': .rp-llm is hidden by the STYLESHEET now, so a never-opened
  // panel reads back as '' here — the old test would have closed it on the first click instead.
  if(out.style.display==='block'){ out.style.display='none'; return; }
  st.textContent='detecting local engines…';
  let t; try{ t=await (await fetch('/api/llm/targets')).json(); }catch(_){ st.textContent='could not reach the server'; return; }
  const engines=(t.engines||[]);
  // THREE STATES, NOT ONE. "switched off", "on but nothing enabled" and "enabled, nothing answered"
  // are different facts and only the last is about the machine. Collapsing them — which this line
  // used to do — tells an operator who deliberately disabled runners that no model is installed.
  if(t.posture==='disabled'){ st.textContent=(t.why||'local model runners are switched off')+' — Settings \u25b8 Local models'; return; }
  if(t.posture==='none-enabled'){ st.textContent='runners are allowed but no host is switched on yet — Settings \u25b8 Local models'; return; }
  if(!engines.some(x=>x.up&&(x.models||[]).length)){ st.textContent='no enabled host answered — start one and click again'; return; }
  st.textContent='';
  // ONE ROW PER ENGINE, separated — each with its own model picker and run button, in the server's
  // probe order. A down engine keeps its row with a stated reason rather than vanishing: "not
  // detected" and "not offered" must not look alike. The label comes from the server, which reads
  // manifests/llm-hosts.json — the client no longer carries its own host list to fall out of step
  // with. Marks are inline and self-contained (house rule: no CDN).
  const MARK={lmstudio:'<span aria-hidden="true" class="mark-lm">LM</span>'};
  out.innerHTML=engines.map(x=>{
    // `identified:false` means several declared hosts share this port and answer identically, so
    // the label names a CONFIGURATION, not a measured server. Saying "llama.cpp" for a hit on 8080
    // would be asserting something the probe cannot tell apart — the same rule as grey != green,
    // applied to identity.
    const named=esc(x.label||x.name)+(x.identified===false?' <span class="mut t-note">(port shared — unconfirmed)</span>':'');
    const head='<span class="eng-head">'+(MARK[x.name]||'')+'<b class="sans t-body">'+named+'</b></span>';
    if(!x.up)return '<div class="rp-eng eng-down">'+head
      +'<span class="mut t-note">down — nothing listening at '+esc(x.url)+'</span></div>';
    if(!(x.models||[]).length)return '<div class="rp-eng eng-down">'+head
      +'<span class="mut t-note">up, but no models loaded</span></div>';
    return '<div class="rp-eng">'+head
      // aria-label, not a <label>: this row is generated per-engine and the model picker has no
      // visible caption of its own — the engine mark/name beside it is decorative (aria-hidden)
      +'<select class="rp-model" data-engine="'+esc(x.name)+'" aria-label="'+esc('model for the '+(LABEL[x.name]||x.name)+' triage run')+'">'+x.models.map(m=>'<option value="'+esc(m)+'">'+esc(m)+'</option>').join('')+'</select>'
      +'<button type="button" class="rp-run" data-check="'+esc(b.dataset.check)+'" data-engine="'+esc(x.name)+'">run triage</button></div>';
  }).join('')+'<div class="rp-out"></div>';
  out.style.display='block';   // explicit: '' would fall back to .rp-llm's own display:none
},false);
document.addEventListener('click',async(e)=>{
  const b=e.target.closest&&e.target.closest('button.rp-run'); if(!b)return;
  const card=b.closest('details'), outd=card.querySelector('.rp-out'), st=card.querySelector('.rp-status');
  // the engine is the ROW's identity now, and its model select sits beside it — no composite values
  const engine=b.dataset.engine, sel=card.querySelector('.rp-model[data-engine="'+engine+'"]');
  const model=String((sel&&sel.value)||'');
  b.disabled=true; st.textContent='running '+engine+' · '+model+' — a cold load of a big model can take minutes…';
  // the display blocks below are .blk-pre in panel.css — the string of declarations that used to be
  // assembled here and interpolated into five style attributes is a stylesheet's job
  try{
    const r=await cwPost('/api/remediation/handoff',{headers:{'content-type':'application/json'},body:JSON.stringify({check:b.dataset.check,project:curProj||'',engine,model})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok){ st.textContent=d.error||('refused ('+r.status+')'); }
    else{
      st.textContent='done'+(d.artifactTruncated?' · artifact truncated — treat the verdict as a floor':'')+(d.verdictFile?' · verdict: '+d.verdictFile:(d.evidence?' · saved: '+d.evidence:''));
      // display blocks: the prompt AS SENT (collapsed), the THINKING where the model has that
      // channel (open — how it got there is part of what is audited), then the VERDICT — the
      // schema-enforced machine-readable answer, summarised as a tally line with the JSON beneath.
      // A run whose reply defied enforcement states verdictError and shows the raw reply instead:
      // fail honest, never a silently missing verdict. All escaped — model output is untrusted.
      const tally=(v)=>{const c={};for(const f of (v.findings||[]))c[f.classification]=(c[f.classification]||0)+1;
        return esc(v.verdict)+' · '+(v.findings||[]).length+' finding(s)'+(Object.keys(c).length?': '+Object.entries(c).map(([k,n])=>n+' '+esc(k)).join(', '):'')+((v.caveats||[]).length?' · '+v.caveats.length+' caveat(s)':'');};
      outd.innerHTML=
        '<details class="blk-tight"><summary class="mut point t-note">prompt as sent — system + artifact'+(d.artifactTruncated?' (truncated)':'')+'</summary>'
          +'<pre class="blk-pre">'+esc((d.sent&&d.sent.system)||'')+'</pre>'
          +'<pre class="blk-pre">'+esc((d.sent&&d.sent.user)||'')+'</pre></details>'
        +(d.thinking
          ?'<details open class="blk-tight"><summary class="mut point t-note">thinking — '+esc(engine)+' · '+esc(model)+'</summary>'
            +'<pre class="blk-pre blk-thinking">'+esc(d.thinking)+'</pre></details>'
          :'')
        +(d.verdict
          ?'<div class="verdict-line"><b class="sans">verdict</b> · <span class="pill '+(d.verdict.verdict==='action-required'||d.verdict.verdict==='mixed'?'high':d.verdict.verdict==='cannot-determine'?'plan':'live')+'">'+tally(d.verdict)+'</span></div>'
            +'<pre class="blk-pre">'+esc(JSON.stringify(d.verdict,null,2))+'</pre>'
          :'<div class="mut note-gap">answer'+(d.verdictError?' — '+esc(d.verdictError):'')+'</div>'
            +'<pre class="blk-pre">'+esc(d.reply||'(empty reply)')+'</pre>');
    }
  }catch(err){ st.textContent='could not reach the server: '+err.message; }
  b.disabled=false;
},false);

// ── the remediation layer's inputs, described one way for the project strip and the fleet page ──
// A present input shows what it holds; anything else names its state and, when absent, the step
// that produces it. unreadable and unknown never share absent's words.
function riPill(x){
  const st=(x&&x.state)||'unknown';
  const cls={ok:'live',absent:'plan',unreadable:'high',unknown:'plan'}[st]||'plan';
  return '<span class="pill '+cls+'">'+esc(st==='ok'?'present':st==='absent'?'missing':st)+'</span>';
}
function riDetail(x){
  if(!x)return '';
  if(x.state==='ok'){
    if(x.key==='plan'){const s=x.summary||{};return s.parsed?s.packages+' package(s) · '+s.findings+' finding(s)'+(s.headline?' · '+s.headline.kev+' on KEV':''):(s.why||'item count unknown');}
    if(x.key==='ledger')return x.entries+' verified-fix entr'+(x.entries===1?'y':'ies');
    if(x.key==='codeqlFleet')return x.findings+' finding(s)';
    if(x.key==='rollup')return x.generated?'rolled up '+String(x.generated).slice(0,10):'undated';
    if(x.key==='batch')return String(x.source||'');
    return '';
  }
  if(x.state==='absent')return (x.why?x.why+' · ':'')+'produced by '+(x.producedBy||'an unnamed step');
  return (x.why||'could not be read')+' — its contents are unknown, not empty';
}
// The layer's own records: none yet is a fact about use, not a missing input.
function roDetail(o){
  if(!o)return '';
  if(o.state==='absent')return 'none yet — '+(o.producedBy||'');
  if(o.state!=='ok')return (o.why||'could not be read')+' — unknown, not none';
  if(o.key==='triage')return o.runs+' run(s) · '+o.verdicts+' verdict(s)';
  const b=o.byState||{};const parts=Object.keys(b).sort().map(k=>b[k]+' '+k);
  return o.jobs+' job(s)'+(parts.length?' — '+parts.join(' · '):'');
}
// The Inputs strip: missing inputs first with their producers, present ones folded, the layer's
// own records last. A project that did not resolve says so and draws no rows.
function remInputsHtml(d){
  if(!d||d.ok!==true||!Array.isArray(d.inputs)){
    const why=(d&&(d.error||(d.project&&d.project.why)))||'the inputs route did not answer';
    return {n:'unknown',html:'<div class="pk-err">'+esc(why)+' — nothing below is a statement about what this project has.</div>'};
  }
  const miss=d.inputs.filter(x=>x&&x.state!=='ok'), have=d.inputs.filter(x=>x&&x.state==='ok');
  const row=(x)=>'<div>'+riPill(x)+' <b class="sans">'+esc(x.label)+'</b>'+(x.file?' <code>'+esc(x.file)+'</code>':'')+' <span class="mut t-note">'+esc(riDetail(x))+'</span></div>';
  const outs=Object.values(d.outputs||{}).map(o=>'<div><span class="pill '+(o.state==='ok'?'attest':o.state==='absent'?'plan':'high')+'">'+esc(o.state==='ok'?'recorded':o.state==='absent'?'none yet':o.state)+'</span> <b class="sans">'+esc(o.label)+'</b> <span class="mut t-note">'+esc(roDetail(o))+'</span></div>');
  const html='<div class="card gap-strip stack">'+miss.map(row).join('')
    +(have.length?'<details class="blk-tight"><summary class="mut point t-note">'+have.length+' of '+d.inputs.length+' input(s) present</summary>'+have.map(row).join('')+'</details>':'')
    +outs.join('')+'</div>';
  return {n:miss.length?miss.length+' of '+d.inputs.length+' missing':'all '+d.inputs.length+' present',html};
}
function renderRemediationInputs(d){
  const r=remInputsHtml(d), box=$('rem-inputs'), n=$('rem-in-n');
  if(box)box.innerHTML=r.html;
  if(n)n.textContent=r.n;
}

// Remediation plan: render the generated REMEDIATION.md for the SELECTED project. Markdown is
// escaped BEFORE any formatting is applied, so document text can never inject markup.
async function loadRemediation(){
  const box=$('remplan'), n=$('remplann');
  box.textContent='loading…'; n.textContent='—';
  // the triage prompts ride their own lazy route; a failed fetch states the unknown, never blanks
  (async()=>{ try{ renderRemediationPrompts(await (await fetch('/api/remediation/prompts?project='+encodeURIComponent(curProj||''))).json()); }
    catch(e){ const c=$('rp-cards'); if(c)c.innerHTML='<div class="pk-err">could not load triage prompts: '+esc(e.message)+'</div>'; const rn=$('rp-n'); if(rn)rn.textContent='—'; } })();
  let inp;
  try{ inp=await (await fetch('/api/remediation/inputs?project='+encodeURIComponent(curProj||''))).json(); }
  catch(e){ inp={ok:false,error:'could not read the inputs: '+e.message}; }
  renderRemediationInputs(inp);
  const plan=inp&&inp.ok===true&&Array.isArray(inp.inputs)?(inp.inputs.find(x=>x&&x.key==='plan')||null):null;
  let md;
  try{
    const r=await fetch('/reports/REMEDIATION.md?project='+encodeURIComponent(curProj||''));
    // no plan / unreachable both leave the badge CLEARED — "we do not know", never "0 to fix"
    if(!r.ok){ box.innerHTML='<span class="mut">no fix plan for '+esc(curProj)+' — '+esc(plan&&plan.state==='unreadable'?'REMEDIATION.md exists and could not be read ('+(plan.why||'no reason given')+')':'it is produced by '+((plan&&plan.producedBy)||'the rollup step of every full scan')+', so run a full scan of this project first')+'.</span>'; setTabN('remediation',null); return; }
    md=await r.text();
  }catch(e){ box.innerHTML='<div class="pk-err">could not load the plan: '+esc(e.message)+'</div>'; setTabN('remediation',null); return; }
  const inline=(t)=>esc(t)
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'$1');
  const out=[]; let list=false, table=false;
  const endBlocks=()=>{ if(list){out.push('</ul>');list=false;} if(table){out.push('</table></div>');table=false;} };
  for(const raw of md.split('\n')){
    const line=raw.replace(/\s+$/,'');
    const h=line.match(/^(#{1,4})\s+(.*)/);
    if(h){ endBlocks(); const lv=Math.min(h[1].length+1,4); out.push('<h'+lv+' class="sans '+(h[1].length===1?'md-h1':'md-h')+'">'+inline(h[2])+'</h'+lv+'>'); continue; }
    const li=line.match(/^\s*[-*]\s+(.*)/);
    if(li){ if(table){out.push('</table></div>');table=false;} if(!list){out.push('<ul class="md-ul">');list=true;} out.push('<li>'+inline(li[1])+'</li>'); continue; }
    if(/^\s*\|/.test(line)){
      if(list){out.push('</ul>');list=false;}
      if(/^\s*\|[\s:|-]+\|\s*$/.test(line))continue; // separator row
      const cells=line.split('|').slice(1,-1).map(c=>c.trim());
      if(!table){ out.push('<div class="tw md-table"><table>'); table=true;
        out.push('<tr>'+cells.map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr>'); }
      else out.push('<tr>'+cells.map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>');
      continue;
    }
    if(!line.trim()){ endBlocks(); continue; }
    endBlocks(); out.push('<p class="md-p">'+inline(line)+'</p>');
  }
  endBlocks();
  box.innerHTML=out.join('');
  // The count is the plan's own section headings, read server-side. Counting bullets read 0 for
  // every plan ever generated — the plan is tables — so each project showed "0 item(s)".
  const s=plan&&plan.state==='ok'?plan.summary:null;
  if(s&&s.parsed){
    n.textContent=curProj+' · '+s.packages+' package(s) · '+s.findings+' finding(s)'+(s.headline?' · '+s.headline.kev+' on KEV':'');
    setTabN('remediation', s.packages, 'packages in this project’s CVE fix plan');
  }else{
    n.textContent=curProj+' · item count unknown';
    setTabN('remediation',null);
  }
}

// ── REMEDIATION · ALL PROJECTS (GET /api/remediation/fleet) ─────────────────────────────────────
// One row per project, in the server's order (label, then report directory). Pure — markup and the
// header line — so the render is testable without a DOM. Prompt tallies use rpWeight(), the same
// classifier as a project's own cards.
function remFleetHtml(d){
  const cat=Array.isArray(d.catalogue)?d.catalogue:[];
  let open=0, missingAny=0, unknownPlan=0;
  const rows=(d.areas||[]).map(a=>{
    const name='<button type="button" class="lnk rf-open" data-proj="'+esc(a.label)+'" title="open '+esc(a.label)+'’s Remediation page"><b class="name">'+esc(a.label)+'</b></button>'
      +(a.declared===false?'<br><span class="mut t-meta">not in the registry — a report directory on disk</span>':'');
    if(a.state!=='ok'){missingAny++;return '<tr><td>'+name+'</td><td colspan="6"><span class="pill unk">'+esc(a.state||'unknown')+'</span> <span class="mut t-note">'+esc(a.why||'')+'</span></td></tr>';}
    const by={};for(const x of a.inputs||[])if(x&&x.key)by[x.key]=x;
    const plan=by.plan||null, s=plan&&plan.state==='ok'?plan.summary:null;
    let planCell;
    if(s&&s.parsed){
      if(s.packages>0)open++;
      planCell=esc(s.packages+' package(s) · '+s.findings+' finding(s)')+(s.headline&&s.headline.kev?' '+pill('crit',esc(s.headline.kev+' KEV')):'');
    }else{
      unknownPlan++;
      planCell=riPill(plan)+' <span class="mut t-note">'+esc(plan&&plan.state==='ok'?((s&&s.why)||'item count unknown'):riDetail(plan))+'</span>';
    }
    const rolled=!!(by.rollup&&by.rollup.state==='ok');
    let act=0,clean=0,dark=0;
    for(const c of cat){const w=rolled&&c.category?rpWeight((a.live||{})[c.category]):-1;if(w>0)act++;else if(w===0)clean++;else dark++;}
    const promptCell=rolled?(act?pill('part',act+' actionable')+' ':'')+'<span class="mut t-note">'+clean+' clean · '+dark+' no signal</span>'
      :'<span class="mut t-note">no counts — '+esc(by.rollup&&by.rollup.state==='absent'?'never scanned':'rollup.json '+((by.rollup&&by.rollup.state)||'unknown'))+'</span>';
    const o=a.outputs||{}, tri=o.triage, cq=o.codeqlJobs, cf=by.codeqlFleet, led=by.ledger;
    const triCell=tri&&tri.state==='ok'?esc(tri.runs+' run(s) · '+tri.verdicts+' verdict(s)'):'<span class="mut t-note">'+esc(tri?(tri.state==='absent'?'none yet':tri.state):'—')+'</span>';
    const cqCell=(cf&&cf.state==='ok'?esc(cf.findings+' finding(s)'):'<span class="mut t-note">no findings file</span>')
      +(cq&&cq.state==='ok'?' · '+esc(roDetail(cq)):cq&&cq.state!=='absent'?' '+riPill(cq):'');
    const ledCell=led&&led.state==='ok'?esc(String(led.entries)):'<span class="mut t-note">'+esc(led?(led.state==='absent'?'none yet':led.state):'—')+'</span>';
    const miss=Array.isArray(a.missing)?a.missing:[];
    if(miss.length)missingAny++;
    const missCell=miss.length?miss.map(k=>{const x=by[k]||{};return '<span class="pill '+(x.state==='absent'?'plan':'high')+'" title="'+esc(riDetail(x))+'">'+esc(x.label||k)+'</span>';}).join(' '):'<span class="mut t-note">none</span>';
    return '<tr><td>'+name+'</td><td>'+planCell+'</td><td>'+promptCell+'</td><td>'+triCell+'</td><td>'+cqCell+'</td><td class="tnum">'+ledCell+'</td><td>'+missCell+'</td></tr>';
  });
  const html='<div class="tw"><table><thead><tr><th>Project</th><th>Fix plan (CVE)</th><th>Review prompts</th><th>Triage</th><th>CodeQL</th><th>Verified fixes</th><th>Missing</th></tr></thead><tbody>'
    +(rows.join('')||'<tr><td colspan="7" class="mut">the registry declares no areas and no report directory holds a rollup or a plan — there is nothing to list, which is not the same as nothing to fix</td></tr>')
    +'</tbody></table></div>';
  const us=d.undeclaredScan;
  const banner=us&&us.state&&us.state!=='ok'?'<div class="'+(us.state==='absent'?'cred-msg cred-unknown':'pk-err')+'">'+esc(us.why||us.state)+'</div>':'';
  const n=rows.length+' projects · '+open+' with open plan items · '+missingAny+' missing an input'+(unknownPlan?' · '+unknownPlan+' plan count(s) unknown':'');
  return {html,n,banner};
}
async function loadRemFleet(){
  const box=$('rf-table'), n=$('rf-n'), ban=$('rf-banner');
  if(!box)return;
  let d=null, status=0;
  try{ const r=await fetch('/api/remediation/fleet'); status=r.status; d=await r.json().catch(()=>null); }
  catch(e){ d={ok:false,reason:'could not read /api/remediation/fleet: '+e.message}; }
  if(status===401)d={ok:false,reason:'Nobody is signed in, so the remediation state was not read. This is NOT an empty fleet.'};
  if(!d||d.ok!==true||!Array.isArray(d.areas)){
    if(n)n.textContent='unknown'; if(ban)ban.innerHTML='';
    box.innerHTML='<div class="pk-err">'+esc((d&&(d.reason||d.error))||('the remediation state could not be read'+(status?' (HTTP '+status+')':'')))+' — nothing here is a statement about any project.</div>';
    return;
  }
  const r=remFleetHtml(d);
  if(n)n.textContent=r.n; if(ban)ban.innerHTML=r.banner; box.innerHTML=r.html;
  box.querySelectorAll('.rf-open').forEach(b=>b.onclick=()=>{
    const ps=$('proj'), opts=ps?[...ps.options].map(o=>o.value):[];
    if(!opts.includes(b.dataset.proj)){ if(ban)ban.innerHTML='<div class="cred-msg cred-unknown">'+esc(b.dataset.proj)+' is not in the project picker — no repository on this box resolves to it, so it has no page to open.</div>'; return; }
    curProj=b.dataset.proj;try{localStorage.setItem('cw-proj',curProj)}catch(_){}ps.value=curProj;setView('remediation');load();
  });
}

// ── Report tab: redacted evidence, replayable by state ─────────────────────────────────────────
// Data: /api/report/states (the dropdown — one entry per recorded state change, newest first;
// labels are built SERVER-SIDE so the redaction policy has exactly one home) and
// /api/report/evidence (whitelisted rows for one state). House rules apply: the banner comes
// BEFORE the rows; absence and read failure are declared, never drawn as a clean zero; and the
// strip badge is CURRENT-state only — replaying the past must not relabel the present.
let repSel='current';
async function loadReport(){
  const sel=$('rep-state'); repSel='current';
  let st=null;
  try{ st=await (await fetch('/api/report/states?project='+encodeURIComponent(curProj||''))).json(); }catch(e){ st=null; }
  if(!st||st.absent||!Array.isArray(st.states)||!st.states.length){
    sel.innerHTML='<option value="current">no recorded states</option>';
    $('rep-n').textContent='—';
    $('rep-banner').innerHTML='<div class="card gap-banner"><span class="pill plan">No result — never scanned</span> <span class="mut">'+esc((st&&st.why)||'no rollup and no history for this project')+'. This is the absence of a reading, not a clean report.'+((st&&st.remedy)?' Remedy: '+esc(st.remedy):'')+'</span></div>';
    $('rep-kpis').innerHTML='';$('rep-delta').innerHTML='';$('rep-scanner').innerHTML='';$('rep-foot').textContent='';
    $('rep-rows').innerHTML='<tr><td colspan="9" class="mut">no evidence rows — nothing has been recorded for this project</td></tr>';
    setTabN('report',null);
    return;
  }
  sel.innerHTML=st.states.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.label)+'</option>').join('');
  sel.value='current';
  repChain=st.chain||null;
  await loadReportState('current');
}
// The chain pill — the state list's own attestation, rendered wherever the banner renders.
// Broken outranks everything; a retro-sealed prefix is stated; no chain yet is unattested, loudly
// distinct from verified. The log itself is history/chain.jsonl, append-only and hash-linked.
let repChain=null;
function repChainPill(){
  const c=repChain;
  if(!c)return '';
  if(c.error)return '<span class="pill unk">chain unreadable</span> <span class="mut">'+esc(c.error)+'</span>';
  if(!c.present)return '<span class="pill plan">unattested</span> <span class="mut">no chain log yet — it starts on this area’s next sweep; until then nothing vouches for the state list</span>';
  if(!c.verified&&c.brokenAt)return '<span class="pill high">chain BROKEN</span> <span class="mut">at line '+esc(c.brokenAt.line)+(c.brokenAt.stamp?' · state '+esc(c.brokenAt.stamp):'')+' — a recorded state was dropped, edited or reordered; treat every state below as unverified until this is explained</span>';
  if(!c.verified&&c.driftedCount)return '<span class="pill high">'+c.driftedCount+' state(s) DRIFTED</span> <span class="mut">every line of the log still recomputes — these state(s) no longer hash to what the log recorded for them, so the bytes were rewritten after the fact rather than the log: '+esc((c.drifted||[]).map(d=>d.stamp).join(', '))+'</span>';
  if(!c.verified)return '<span class="pill unk">chain NOT verified</span> <span class="mut">'+esc(c.error||'the log did not verify and named no line — do not read this as either a break or drift until it does')+'</span>';
  const bits=['<span class="pill live">chain verified</span> <span class="mut">'+c.length+' write event(s), hash-linked'
    +(c.retroSealed?' · '+c.retroSealed+' retro-sealed (attested at seal time — claims nothing pre-seal)':'')
    +(c.tailTorn?' · torn tail line detected (the prefix stands)':'')+'</span>'];
  if(c.unrecordedCount)bits.push('<span class="pill high">'+c.unrecordedCount+' unrecorded</span> <span class="mut">index state(s) the chain never saw — a write that dodged the log: '+esc((c.unrecorded||[]).join(', '))+'</span>');
  // DRIFTED: the chain's own hashes still recompute, and a recorded state no longer matches what
  // the log recorded for it — a slice rewritten together with its index hash, which stamp-only
  // verification could not see. Not a broken chain; a store that moved out from under one.
  if(c.driftedCount)bits.push('<span class="pill high">'+c.driftedCount+' drifted</span> <span class="mut">recorded state(s) no longer hash to what the log recorded — rewritten after the fact, consistently enough that the chain alone did not see it: '+esc((c.drifted||[]).map(d=>d.stamp).join(', '))+'</span>');
  // The three anchor states are three different claims and never collapse into one tick.
  // committed=false OUTRANKS a passing local anchor: the local file lives on the same disk under
  // the same uid as the chain, so a writer who rewrote both would satisfy it and only HEAD disagrees.
  if(c.committed===false)bits.push('<span class="pill high">committed anchor DISAGREES</span> <span class="mut">'+esc(c.committedWhy||'')+'</span>');
  else if(c.committed===true)bits.push('<span class="pill live">tip committed</span> <span class="mut">'+esc(c.committedWhy||'')+' — a copy this machine cannot rewrite</span>');
  else bits.push('<span class="pill plan">tip not committed</span> <span class="mut">'+esc(c.committedWhy||'undetermined')+'; the local anchor below is a consistency check, not evidence</span>');
  if(c.anchorMissing||c.anchorShrunk)bits.push('<span class="pill high">local anchor disagrees</span> <span class="mut">'+esc(c.anchorWhy||'')+'</span>');
  else if(c.anchored)bits.push('<span class="mut">local anchor consistent'+(c.anchorAt?' (as of '+esc(c.anchorAt)+')':'')+'</span>');
  // How much of the log binds its whole line. Stated rather than implied: v1 lines hash six fields,
  // so a note or a flag on one of them can still be edited without breaking anything.
  if(c.v1Lines)bits.push('<span class="mut">'+c.v1Lines+' line(s) predate whole-line hashing'+(c.protectedFrom?' — fully bound from line '+c.protectedFrom:' — none fully bound yet')+'; their notes and flags are not covered</span>');
  return bits.join(' ');
}
async function loadReportState(id){
  repSel=id;
  const rows=$('rep-rows');
  rows.innerHTML='<tr><td colspan="9" class="mut">loading…</td></tr>';
  let d=null;
  try{ d=await (await fetch('/api/report/evidence?project='+encodeURIComponent(curProj||'')+'&state='+encodeURIComponent(id))).json(); }catch(e){ d=null; }
  if(!d||!d.ok){
    $('rep-banner').innerHTML='<div class="card gap-banner"><span class="pill plan">'+(d&&d.absent?'ABSENT':'UNREADABLE')+'</span> <span class="mut">'+esc((d&&d.error)||'the evidence route did not answer')+'</span></div>';
    $('rep-kpis').innerHTML='';$('rep-delta').innerHTML='';$('rep-scanner').innerHTML='';$('rep-foot').textContent='';
    rows.innerHTML='<tr><td colspan="9" class="mut">not drawn — a read failure is never rendered as an empty (clean) report</td></tr>';
    if(id==='current')setTabN('report',null);
    return;
  }
  const replay=id!=='current';
  const t=d.totals||{};
  const open=(t.crit||0)+(t.high||0)+(t.med||0)+(t.low||0);
  // banner — the page's contract, stated on the page: replay marker first, then the redaction
  // policy line by line. A report that hides its own redactions reads as complete when it is not.
  const bits=[];
  if(replay)bits.push('<span class="pill part">REPLAY</span> <span class="mut">viewing recorded state <code>'+esc((d.state&&d.state.sliceId)||id)+'</code> — the strip badge and every other tab stay on the present</span>');
  // integrity of THIS state's bytes, then the chain over the whole log — two different claims:
  // one file unchanged since recording, one sequence with nothing dropped or reordered
  if(replay&&d.integrity){
    if(d.integrity.match===true)bits.push('<span class="pill live">bytes verified</span> <span class="mut">this slice matches the hash its index row attested at write time</span>');
    else if(d.integrity.match===false)bits.push('<span class="pill high">TAMPERED</span> <span class="mut">'+esc(d.integrity.why||'slice bytes do not match the attested hash')+' — this replay shows the file as it is NOW, which is not the state that was recorded</span>');
    else bits.push('<span class="pill plan">unverifiable</span> <span class="mut">'+esc(d.integrity.why||'no hash was attested for this state')+'</span>');
  }
  const cp=repChainPill(); if(cp)bits.push(cp);
  bits.push('<span class="pill live">redacted for hand-off</span> <span class="mut">written to survive a leak — what is withheld is counted below, never silent</span>');
  for(const p of (d.redaction&&d.redaction.policy)||[])bits.push('<span class="mut">· '+esc(p)+'</span>');
  $('rep-banner').innerHTML='<div class="card gap-banner stack">'+bits.map(b=>'<div>'+b+'</div>').join('')+'</div>';
  $('rep-kpis').innerHTML=[
    [(t.crit||t.high)?'bad':(t.med?'warn':'good'),'Open at this state',open+'',(t.crit||0)+'C · '+(t.high||0)+'H · '+(t.med||0)+'M · '+(t.low||0)+'L'],
    ['','Recorded',esc(d.state&&d.state.kind||'sweep'),esc((d.state&&d.state.generated)?ABS(new Date(d.state.generated)):'undated')],
    ['','Withheld',String((d.redaction&&d.redaction.withheldLocations)||0),'located values counted, not carried'],
  ].map(([cl,k,v,s])=>'<div class="kpi '+cl+'"><div class="k">'+k+'</div><div class="v tnum">'+v+'</div><div class="s">'+s+'</div></div>').join('');
  // the delta band — the recorded state CHANGE: what was born and what was cleaned at this slice.
  // This is the operator's own action trail, replayed; the current state has no delta by design.
  const del=$('rep-delta');
  if(d.delta){
    const band=(list,label)=>((list&&list.length)?'<div class="delta-band"><b class="sans t-body">'+label+'</b>'+list.map(f=>'<div class="find">'+sevPill(f.severity||'?')+'<code>'+esc(f.id||'?')+'</code><span class="at">'+esc(f.package||f.title||'')+'</span></div>').join('')+'</div>':'');
    del.innerHTML='<div class="card gap-strip"><h3>What changed at this state</h3><div class="mut t-note">'+((d.delta.new||0)+' born · '+(d.delta.fixed||0)+' cleaned (verified) — one recorded state change, in the order it happened')+'</div>'+band(d.delta.newFindings,'born')+band(d.delta.fixedFindings,'cleaned')+'</div>';
  }else{
    del.innerHTML='<div class="card gap-strip"><div class="mut t-note">'+esc(d.deltaWhy||'no change record for this state')+'</div></div>';
  }
  // Sorted through rankOf so the exploited band renders AS a band rather than as rows scattered
  // down the table. A COPY is sorted, never d.findings in place: the payload is re-read by other
  // renders on this page and mutating it would reorder them silently. Ties fall back to the
  // server's order, so a re-render of the same payload stays byte-identical.
  // CISA KEV or VulnCheck's KEV: either listing puts the row in the exploited band.
  const exploitedOf=(f)=>f.kev===true||f.activelyExploited===true;
  const ordered=(d.findings||[]).map((f,i)=>[f,i])
    .sort((a,b)=>(rankOf(a[0].severity,exploitedOf(a[0]))-rankOf(b[0].severity,exploitedOf(b[0])))||(a[1]-b[1]))
    .map(([f])=>f);
  rows.innerHTML=ordered.map(f=>'<tr><td>'+sevPill(f.severity||'?')+'</td><td><b class="name">'+esc(f.repo||'')+'</b></td><td class="mut">'+esc(f.tool||'')+'</td><td><code>'+esc(f.id||'')+'</code></td><td>'+esc(f.package||f.title||'')+(f.version?'<span class="mut"> @'+esc(f.version)+'</span>':'')+'</td><td class="tnum">'+esc(f.fixedIn||'—')+'</td><td>'+(f.kev===true?pill('exploited','KEV'):f.kev===null?pill('unk','?'):'')+(f.activelyExploited===true&&f.kev!==true?pill('exploited','exploited'):'')+'</td><td class="tnum">'+(typeof f.epss==='number'?f.epss.toFixed(4):'—')+'</td><td>'+esc(f.state||'open')+'</td></tr>').join('')
    ||('<tr><td colspan="9">'+(open?'<span class="mut">this state carries counts but no row detail</span>':'<span class="pill live">clean at this state</span> <span class="mut">nothing open when this state was recorded — a dated reading, not a verdict: "safe" moves under a fixed code state</span>')+'</td></tr>');
  if(d.truncated)rows.innerHTML+='<tr><td colspan="9" class="mut">'+d.truncated+' further row(s) not drawn — a rendering cap; the count above is the full count</td></tr>';
  const sc=d.scanners||{}, cats=Object.keys(sc);
  let scHtml='';
  if(cats.length){
    scHtml+='<div class="hd hd-sub"><h2>Per-category tallies</h2><span class="n">counts only — the located rows stay on the scanner tabs</span></div><div class="tw"><table><thead><tr><th>Category</th><th>Findings</th><th>Ran</th><th>Skipped</th><th>Noscan</th><th>Carried</th></tr></thead><tbody>'
      +cats.map(k=>{const s=sc[k]||{};const c=(v)=>v==null?'—':String(v);return '<tr><td><b class="name">'+esc(k)+'</b></td><td class="tnum">'+c(s.total)+'</td><td class="tnum">'+c(s.ran)+'</td><td class="tnum">'+c(s.skipped)+'</td><td class="tnum">'+c(s.noscan)+'</td><td>'+(s.carried?pill('part','carried'+(s.carriedFrom?' · '+esc(s.carriedFrom):'')):'')+'</td></tr>';}).join('')+'</tbody></table></div>';
  }
  if(d.secretsEvidence&&d.secretsEvidence.length){
    scHtml+='<div class="hd hd-sub"><h2>Secrets — evidence</h2><span class="n">rule and count only · file, line and commit withheld here — the Secrets tab carries them</span></div><div class="tw"><table><thead><tr><th>Repo</th><th>Rule</th><th>Count</th></tr></thead><tbody>'
      +d.secretsEvidence.map(s=>'<tr><td><b class="name">'+esc(s.repo)+'</b></td><td><code>'+esc(s.rule)+'</code></td><td class="tnum">'+esc(s.count)+'</td></tr>').join('')+'</tbody></table></div>';
  }
  if(d.malwareEvidence&&d.malwareEvidence.length){
    scHtml+='<div class="hd hd-sub"><h2>Malicious packages — evidence</h2><span class="n">public advisories — treat as an incident, not a backlog item</span></div><div class="tw"><table><thead><tr><th>Repo</th><th>Package</th><th>Version</th><th>Advisory</th></tr></thead><tbody>'
      +d.malwareEvidence.map(m=>'<tr><td><b class="name">'+esc(m.repo)+'</b></td><td><code>'+esc(m.package)+'</code></td><td class="tnum">'+esc(m.version||'')+'</td><td>'+esc(m.id||'')+'</td></tr>').join('')+'</tbody></table></div>';
  }
  if(d.supplyEvidence&&d.supplyEvidence.length){
    scHtml+='<div class="hd hd-sub"><h2>Supply-chain heuristics — evidence</h2><span class="n">signals, not verdicts · detail text withheld — the Supply chain tab carries it</span></div><div class="tw"><table><thead><tr><th>Repo</th><th>Rule</th><th>Package</th></tr></thead><tbody>'
      +d.supplyEvidence.map(g=>'<tr><td><b class="name">'+esc(g.repo)+'</b></td><td><code>'+esc(g.rule)+'</code></td><td>'+esc(g.package||'')+(g.version?'<span class="mut"> @'+esc(g.version)+'</span>':'')+'</td></tr>').join('')+'</tbody></table></div>';
  }
  // Every OTHER detail category. The three blocks above were the whole of this tab's scanner
  // evidence, so a slice carrying 83 Semgrep, 30 IaC, 61 DAST and 68 Actions rows showed three
  // categories and said nothing about the rest — on the one tab built for hand-off. Rendered
  // generically off whatever the server sent, so a category added to the rollup arrives here
  // without another edit; rule + severity + count only, locations withheld and counted above.
  if(d.scannerEvidence){
    for(const cat of Object.keys(d.scannerEvidence).sort()){
      const rows=d.scannerEvidence[cat]||[];
      if(!rows.length)continue;
      scHtml+='<div class="hd hd-sub"><h2>'+esc(cat)+' — evidence</h2><span class="n">rule, severity and count only · file, line and message withheld here — the scanner tab carries them</span></div>'
        +'<div class="tw"><table><thead><tr><th>Repo</th><th>Rule</th><th>Sev</th><th>Count</th></tr></thead><tbody>'
        +rows.map(r=>'<tr><td><b class="name">'+esc(r.repo)+'</b></td><td><code>'+esc(r.rule)+'</code></td><td>'+(r.sev?sevPill(r.sev):'<span class="mut">—</span>')+'</td><td class="tnum">'+esc(r.count)+'</td></tr>').join('')
        +'</tbody></table></div>';
    }
  }
  if(d.scannerEvidenceWhy)scHtml+='<p class="mut t-note">'+esc(d.scannerEvidenceWhy)+'</p>';
  $('rep-scanner').innerHTML=scHtml;
  $('rep-n').textContent=(replay?'replay · ':'current · ')+open+' open · '+(d.findingsTotal||0)+' evidence row(s)';
  $('rep-foot').innerHTML='Read from <code>'+esc((d.source&&d.source.file)||'?')+'</code> · every state change is replayable from the dropdown above because "safe" is a moving target: KEV/EPSS enrichment drifts under a fixed code state, so each reading here is dated — remediation continues until the CURRENT state is safe, and then continues again.';
  if(!replay)setTabN('report',open,'open findings in the current evidence state');
}
$('rep-state').onchange=e=>loadReportState(e.target.value);

// ── Issues · tracker (native tab) ───────────────────────────────────────────────────────────────
// /api/issues serves panelRows() — the producer-side field whitelist (id/area/kind/severity/state/
// ageDays/slaBreached/title); this page renders those fields and nothing else. areaStatus ALWAYS
// renders: 'never-ingested' is a grey "not ingested" banner, never an empty-equals-clean table,
// and a 500 (corrupt store, fail-closed server-side) renders as an error, never as zero issues.
const issGlyph={crit:'🟥',high:'🟧',med:'🟨',low:'🟩'};
async function loadDaily(batch){
  const rows=$('daily-rows'),n=$('daily-n'),ban=$('daily-banner');
  if(rows)rows.innerHTML='<tr><td colspan="7" class="mut">loading…</td></tr>';
  let d;
  try{
    const r=await fetch('/api/daily?project='+encodeURIComponent(curProj||'')+(batch?'&batch='+encodeURIComponent(batch):''));
    d=await r.json();
    if(!r.ok)throw new Error((d&&d.error)||('HTTP '+r.status));
  }catch(e){
    if(ban)ban.innerHTML='';
    if(n)n.textContent='—';
    if(rows)rows.innerHTML='<tr><td colspan="7" class="mut">daily report unavailable — '+esc(e.message)+'</td></tr>';
    setTabN('daily',null);
    return;
  }
  if(d.state!=='ok'){
    const why={'no-reports':'no daily report yet for this project\'s area — none has been written, which is not the same as nothing to fix','no-report-for-batch':'no report for '+esc(d.batch||''),'unreadable':'the report for '+esc(d.batch||'')+' does not meet its schema: '+esc(d.error||'')}[d.state]||esc(d.state);
    if(ban)ban.innerHTML='<div class="mut banner-box">⬜ '+why+'</div>';
    if(n)n.textContent='—';
    if(rows)rows.innerHTML='';
    setTabN('daily',null);
    return;
  }
  const s=d.summary||{};
  const picker='<select id="daily-batch" aria-label="sweep">'+(d.batches||[]).map(b=>'<option value="'+esc(b)+'"'+(b===d.batch?' selected':'')+'>'+esc(b)+'</option>').join('')+'</select>';
  const gaps=(d.coverage||[]).map(c=>esc(c.lane)+' '+esc(c.state)+(c.note?' ('+esc(c.note)+')':'')).join(' · ');
  const todo=d.todos?(d.todos.skipped?'todos not filed for this run':'todos: '+d.todos.created+' filed, '+d.todos.completed+' completed'+(d.todos.errors.length?' · <span class="pill high">'+d.todos.errors.length+' veld error(s)</span>':'')):'todos not filed yet';
  if(ban)ban.innerHTML='<div class="banner-box"><b>'+esc(d.headline||'')+'</b></div>'
    +'<div class="mut note-b">'+picker+' · area <code>'+esc(d.area)+'</code> · '+(s.baselineRepos&&s.baselineRepos.length?'<span class="pill part">baseline</span> ':'')
    +esc(String(s.new))+' new · '+esc(String(s.persisting))+' persisting · '+esc(String(s.fixed))+' fixed · '+esc(String(s.carried))+' unmeasured'+(s.omitted?' · '+esc(String(s.omitted))+' over the cap':'')
    +' · '+todo+' · '+esc(d.run.model)+(d.run.costUsd!=null?' $'+esc(Number(d.run.costUsd).toFixed(2)):'')+'</div>'
    +(gaps?'<div class="mut note-b">not measured for this project: '+gaps+'</div>':'');
  const sel=$('daily-batch');
  if(sel)sel.onchange=()=>loadDaily(sel.value);
  const list=d.suggestions||[];
  if(n)n.textContent=list.length+' suggestion(s) · '+(d.project||'');
  setTabN('daily',list.length,'daily remediation suggestions');
  const where=x=>x.where.map(w=>'<code>'+esc(w.file)+(w.line?':'+esc(String(w.line)):'')+'</code>').join('<br>');
  const verify=x=>[x.verify.lane?'lane <code>'+esc(x.verify.lane)+'</code>':'',x.verify.command?'<code>'+esc(x.verify.command)+'</code>':''].filter(Boolean).join(' · ')+'<br><span class="mut">'+esc(x.verify.expect)+'</span>';
  if(rows)rows.innerHTML=list.map(x=>'<tr><td><span class="pill '+(x.priority==='p0'?'high':x.priority==='p1'?'part':'live')+'">'+esc(x.priority)+'</span></td>'
    +'<td><b>'+esc(x.title)+'</b><br><span class="mut">'+esc(x.why)+'</span></td><td>'+where(x)+'</td><td>'+esc(x.change)+'</td><td>'+verify(x)+'</td>'
    +'<td>'+esc(x.confidence)+' · '+esc(x.effort)+'</td><td>'+(x.todos.length?x.todos.map(t=>'<code>'+esc(t.slice(0,8))+'</code>').join(' '):'<span class="mut">—</span>')+'</td></tr>').join('')
    ||'<tr><td colspan="7" class="mut">no suggestions for this project in '+esc(d.batch)+'</td></tr>';
}
async function loadIssuesTab(){
  const rows=$('iss-rows'),n=$('iss-n'),ban=$('iss-banner');
  if(rows)rows.innerHTML='<tr><td colspan="8" class="mut">loading…</td></tr>';
  let d;
  try{
    const r=await fetch('/api/issues?project='+encodeURIComponent(curProj||''));
    d=await r.json();
    if(!r.ok)throw new Error((d&&d.error)||('HTTP '+r.status));
  }catch(e){
    if(ban)ban.innerHTML='';
    if(n)n.textContent='—';
    if(rows)rows.innerHTML='<tr><td colspan="8" class="mut">issue store unavailable — '+esc(e.message)+' · a broken store is an error, never an empty queue</td></tr>';
    setTabN('issues',null);
    return;
  }
  const st=d.areaStatus;
  const never=st==='never-ingested'||!st;
  // THREE states, not two. 'never ingested' and 'current' were the only ones rendered, so a tracker
  // hours behind the live rollup looked exactly like one ingested a minute ago — the queue read as
  // authoritative while describing a scan that had since been superseded. `behind` is computed
  // server-side against the same rollup this panel already displays; behind:null means the rollup
  // could not be read, which renders as UNKNOWN rather than as "current".
  const bh=d.behind;
  const ingestBtn=d.area?' <button type="button" id="iss-ingest">ingest now</button>':'';
  if(ban)ban.innerHTML=never
    ?'<div class="mut banner-box">⬜ not ingested — no scan evidence has ever been ingested for '+(d.area?'area <code>'+esc(d.area)+'</code>':'any area')+'. Absence of evidence, not a clean queue.'+ingestBtn+'</div>'
    :(bh&&bh.isBehind
      ?'<div class="banner-box"><span class="pill part">BEHIND</span> the tracker was last ingested at <code>'+esc(String(bh.ingestedGenerated||'?'))+'</code>, but the current slice is <code>'+esc(String(bh.currentSliceId||'?'))+'</code> ('+esc(String(bh.currentGenerated))+'). <b>These rows describe a superseded scan.</b>'+ingestBtn+'</div>'
      :'<div class="mut note-b">last ingest: '+esc(d.area?(((st&&st.sliceId)||'?')+' · '+((st&&st.generated)||'?')):Object.entries(st).map(([a,s])=>a+' '+((s&&s.sliceId)||'?')).join(' · '))
        +(d.area&&!bh?' · <span title="the area rollup could not be read, so whether the tracker is current is UNKNOWN — not confirmed">currency unknown</span>':'')
        +ingestBtn+'</div>');
  const ib=$('iss-ingest');
  if(ib)ib.onclick=async()=>{
    ib.disabled=true; const was=ib.textContent; ib.textContent='ingesting…';
    try{
      const r=await cwPost('/api/issues/ingest',{headers:{'content-type':'application/json'},body:JSON.stringify({project:curProj||d.area})});
      const j=await r.json().catch(()=>({}));
      // The status is shown WHATEVER it is: 'stale-rollup' and 'not-newer' are refusals with
      // reasons, and a button that silently does nothing is how the frozen tracker went unnoticed.
      ib.textContent=r.ok?(j.status||'done')+' · +'+((j.created||[]).length)+' new · '+((j.closed||[]).length)+' closed':(j.error||('refused ('+r.status+')'));
      setTimeout(()=>{ ib.disabled=false; ib.textContent=was; loadIssuesTab(); },2200);
    }catch(e){ ib.textContent='could not reach the server'; ib.disabled=false; }
  };
  const list=d.rows||[];
  if(n)n.textContent=list.length+' open · '+(d.area||'all areas');
  // never-ingested ⇒ the count is unknowable, so the badge stays clear rather than reading 0=clean
  setTabN('issues',never?null:list.length,'open issues in the tracker');
  if(rows)rows.innerHTML=list.map(i=>'<tr class="iss-row" data-iss="'+esc(i.id)+'"><td title="'+esc(i.severity)+'">'+(issGlyph[i.severity]||'⬜')+' '+esc(i.severity)+'</td><td><code>'+esc(i.id)+'</code></td><td>'+esc(i.area)+'</td><td>'+esc(i.kind)+'</td><td>'+esc(i.state)+'</td><td class="tnum">'+esc(String(i.ageDays))+'d</td><td>'+(i.slaBreached?'<span class="pill high">SLA breached</span>':'<span class="pill live">in SLA</span>')+'</td><td>'+esc(i.title)+'</td></tr>').join('')
    ||('<tr><td colspan="8" class="mut">'+(never?'no evidence — nothing has been ingested, which is not the same as no issues':'no open issues')+'</td></tr>');
  // Re-open whatever was expanded before this render. An issue that has since CLOSED leaves the
  // open list rather than being silently reopened somewhere it no longer appears — the row is gone,
  // so there is nothing to attach to and pretending otherwise would strand a form over nothing.
  const present=new Set(list.map(i=>i.id));
  for(const id of [...issOpen]){ issOpen.delete(id); if(present.has(id))issToggle(id); }
}

// ── Issues · the per-issue lodging panel ────────────────────────────────────────────────────────
// Expands IN PLACE under the row. Everything rendered here comes from /api/issue, including the
// vocabularies: the fix types, the disposition words and the re-scan levels are server-supplied so
// this page cannot hold a second, drifting copy of a closed set. The same reason /api/ingest/targets
// ships its own greenKinds legend rather than letting a client name the colours.
//
// TWO DROPDOWNS, NOT ONE, and that is the point of the design. "Is this finding real?" (the ruling,
// monitor/ingest-external.mjs's DISPOSITIONS) and "how was it addressed?" (the fix type,
// issue-store.mjs's FIX_TYPES) are different questions. Collapsing them into one control is how a
// suppression gets filed as a fix.
//
// NEITHER CLOSES ANYTHING. Both writes come back with the issue still open and this page says so on
// every success — a ✓ that reads as "done" is exactly the failure the return path was built to stop.
const ISS_GREEN={
  'scanner-clean':['live','a scanner proved it — evidence-gated auto-close'],
  'human-green':['green-human','a person ruled on it; the finding is still here, attributed and expiring'],
  'claimed-fixed':['part','a person says they fixed it — unproven, still queued'],
  'human-closed':['plan','closed by a person (accepted/refuted/superseded) — a decision, not a proof'],
  grey:['plan','closed as fixed with no machine evidence tier — provenance missing, not proven'],
  open:['plan','no judgement, no proof'],
};
const issOpen=new Set();          // ids currently expanded, so a reload keeps the operator's place
function issDetailRow(id){ return document.querySelector('tr.iss-det[data-iss="'+CSS.escape(id)+'"]'); }

async function issToggle(id){
  const tr=document.querySelector('tr.iss-row[data-iss="'+CSS.escape(id)+'"]');
  if(!tr)return;
  const existing=issDetailRow(id);
  if(existing){ existing.remove(); tr.classList.remove('open'); issOpen.delete(id); return; }
  issOpen.add(id); tr.classList.add('open');
  const det=document.createElement('tr');
  det.className='iss-det'; det.dataset.iss=id;
  det.innerHTML='<td colspan="8"><div class="iss-panel mut">loading…</div></td>';
  tr.after(det);
  let d;
  try{
    const r=await fetch('/api/issue?id='+encodeURIComponent(id));
    d=await r.json();
    if(!r.ok)throw new Error((d&&d.error)||('HTTP '+r.status));
  }catch(e){
    det.querySelector('.iss-panel').innerHTML='<div class="pk-err">could not load '+esc(id)+' — '+esc(e.message)+'</div>';
    return;
  }
  det.querySelector('td').innerHTML=issPanelHTML(d);
  issWire(det,d);
}

function issPanelHTML(d){
  const v=d.vocab||{};
  const green=ISS_GREEN[d.greenKind]||['plan',''];
  const opt=(list,sel)=>list.map(x=>'<option value="'+esc(x)+'"'+(x===sel?' selected':'')+'>'+esc(x)+'</option>').join('');
  let h='<div class="iss-panel">';
  h+='<div class="actrow" style="margin-bottom:0.625rem">'
    +'<span class="pill '+green[0]+'" title="'+esc(green[1])+'">'+esc(d.greenKind)+'</span>'
    +'<span class="mut t-note">'+esc(d.rule||'(no rule)')+' · '+esc(d.tool||'?')+' · '+esc(d.repo||'—')+'</span>'
    +(d.suspect?'<span class="pill part" title="the row vanished but nothing proved it fixed — rule drift can silence a scanner">suspect</span>':'')
    +'</div>';
  // The SCANNER's own suggestion, when the mint captured one. Labelled as the scanner's, because
  // it is not a person's account of what was done — that is the form below.
  if(d.remediation)h+='<div class="mut t-note blk-tight">scanner guidance: '+esc(d.remediation)+'</div>';

  h+='<div class="iss-grid">'
    +'<div class="iss-fld"><label for="iss-rule-'+esc(d.id)+'">ruling — is it real?</label>'
    +'<select id="iss-rule-'+esc(d.id)+'" data-f="disposition"><option value="">(no ruling)</option>'+opt(v.dispositions||[])+'</select></div>'
    +'<div class="iss-fld"><label for="iss-ft-'+esc(d.id)+'">fix type — how was it addressed?</label>'
    +'<select id="iss-ft-'+esc(d.id)+'" data-f="fixType"><option value="">(none)</option>'+opt(v.fixTypes||[],d.fix&&d.fix.fixType)+'</select></div>'
    +'<div class="iss-fld"><label for="iss-rs-'+esc(d.id)+'">re-scan after a ruling</label>'
    +'<select id="iss-rs-'+esc(d.id)+'" data-f="rescan">'+opt(v.rescanLevels||[],'none')+'</select></div>'
    +'<div class="iss-fld iss-notes"><label for="iss-nt-'+esc(d.id)+'">annotation — why, in your words</label>'
    +'<textarea id="iss-nt-'+esc(d.id)+'" data-f="notes" placeholder="what you found, what you changed, or why the scanner is wrong">'+esc((d.fix&&d.fix.notes)||'')+'</textarea>'
    +'<span class="iss-count" data-count>'+(((d.fix&&d.fix.notes)||'').length)+' / '+esc(String((v.notes&&v.notes.max)||2000))+' · minimum '+esc(String((v.notes&&v.notes.min)||8))+'</span></div>'
    +'</div>';
  h+='<div class="actrow" style="margin-top:0.625rem">'
    +'<button type="button" data-act="lodge">lodge fix</button>'
    +'<button type="button" data-act="rule">file ruling</button>'
    +(d.promptAvailable
      ? '<button type="button" data-act="copy" title="the triage prompt: rule, anchored location and the source around it">copy prompt</button>'
        +'<button type="button" data-act="local" title="run this prompt against a local model — any host declared in manifests/llm-hosts.json; the reply is recorded on the issue as evidence of a claim">local LLM ▸</button>'
        +'<button type="button" data-act="claude" title="write the handoff and start a Claude Code session at this repo">Claude Code ↗</button>'
      : '')
    +'<span class="mut t-note" data-status></span></div>';
  // ABSENT WITH A REASON. A tunnelled operator must be able to tell "this panel cannot do that from
  // here" from "this panel cannot do that" — a missing button with no explanation reads as the latter.
  if(!d.promptAvailable)h+='<div class="iss-local-note">The triage prompt, the local-model run and the Claude Code handoff are not offered here: they carry the anchored <b>source</b> of the finding, which does not leave the box over the published tunnel. Open the panel on the operator port (<code>http://127.0.0.1:7879</code>) to use them.</div>';
  h+='<div data-out></div>';

  if(d.fix)h+='<div class="iss-sec"><h4>lodged fix</h4><div class="t-note"><b>'+esc(d.fix.fixType)+'</b> — '+esc(d.fix.notes)+'</div>'
    +'<div class="mut t-note">'+esc(d.fix.who)+' · '+esc(d.fix.at)+(d.fix.dispositionId?' · ruling '+esc(d.fix.dispositionId):'')+'</div></div>';

  if(d.llm)h+='<div class="iss-sec"><h4>last local-model triage</h4>'
    +'<div class="t-note">verdict <b>'+esc(d.llm.verdict||'none recorded')+'</b>'
    +(d.llm.confidence?' · confidence '+esc(d.llm.confidence):'')
    +(d.llm.truncated?' · <span class="pill part">truncated</span>':'')+'</div>'
    +'<div class="mut t-note">'+esc(d.llm.engine)+':'+esc(d.llm.model)+' · '+esc(d.llm.at)
    +' — a model verdict is a claim, not a close</div></div>';

  const ds=d.dispositions||[];
  if(ds.length)h+='<div class="iss-sec"><h4>rulings ('+ds.length+')</h4>'+ds.map(x=>
    '<div class="iss-dsp"><b>'+esc(x.disposition)+'</b> <span class="pill '+(x.status==='in-force'?'live':'plan')+'">'+esc(x.status)+'</span>'
    +' <span class="mut">'+esc(x.who)+' ('+esc(x.whoKind)+') · '+esc(x.at)+(x.expires?' · expires '+esc(x.expires):'')+'</span>'
    +'<div class="mut">'+esc(x.reason)+'</div></div>').join('')+'</div>';

  h+='</div>';
  return h;
}

function issWire(det,d){
  const $$=(s)=>det.querySelector(s);
  const st=$$('[data-status]'), out=$$('[data-out]');
  const val=(f)=>{const el=det.querySelector('[data-f="'+f+'"]');return el?el.value:'';};
  const notes=$$('[data-f="notes"]'), count=$$('[data-count]');
  const lim=(d.vocab&&d.vocab.notes)||{min:8,max:2000};
  if(notes&&count)notes.addEventListener('input',()=>{
    const n=notes.value.length;
    count.textContent=n+' / '+lim.max+' · minimum '+lim.min;
    count.classList.toggle('over',n>lim.max||(n>0&&n<lim.min));
  });
  det.addEventListener('click',async(e)=>{
    const b=e.target.closest&&e.target.closest('button[data-act]'); if(!b)return;
    const act=b.dataset.act;
    if(act==='lodge')return issLodge(d,val,st);
    if(act==='rule')return issRule(d,val,st);
    if(act==='copy')return issCopy(d,b,st);
    if(act==='claude')return issClaude(d,st);
    if(act==='local')return issLocal(d,out,st);
  });
}

// The two writes. Both END by re-rendering the panel from the server rather than patching what we
// just sent — the store is the authority on what landed, and a UI that trusts its own optimism is
// how a refused write reads as a success.
async function issRefresh(id){ const det=issDetailRow(id); if(det){ det.remove(); issOpen.delete(id); await issToggle(id); } }

async function issLodge(d,val,st){
  const fixType=val('fixType'), notes=val('notes');
  if(!fixType){ st.textContent='pick a fix type — what kind of change was this?'; return; }
  st.textContent='lodging…';
  try{
    const r=await cwPost('/api/issue/fix',{headers:{'content-type':'application/json'},
      body:JSON.stringify({id:d.id,fixType,notes})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok){ st.textContent=j.error||('refused ('+r.status+')'); return; }
    // stillOpen is stated by the server on every success and rendered here on every success.
    st.textContent='lodged — issue '+(j.stillOpen?'STILL OPEN (a claim, not a close)':'state '+esc(j.state));
    await issRefresh(d.id);
  }catch(err){ st.textContent='could not reach the server: '+err.message; }
}

async function issRule(d,val,st){
  const disposition=val('disposition'), reason=val('notes'), rescan=val('rescan')||'none';
  if(!disposition){ st.textContent='pick a ruling — is the finding real, remediated, or not applicable here?'; return; }
  st.textContent='filing…';
  try{
    // subjectDigest is PINNED from the read: a ruling filed against a subject that moved between
    // read and write is refused (409) rather than mis-attached. Same guarantee shape as an ETag.
    const r=await cwPost('/api/ingest/judgement',{headers:{'content-type':'application/json'},
      body:JSON.stringify({issueId:d.id,disposition,reason,rescan,subjectDigest:d.subjectDigest})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok){
      st.textContent=(r.status===409?'the finding changed since this panel read it — reopen the row and re-read before ruling: ':'')
        +(j.refused||'')+' '+((j.errors||[]).join('; ')||j.error||('refused ('+r.status+')'));
      return;
    }
    st.textContent='filed '+esc(j.filed&&j.filed.disposition)+' — issue STILL OPEN'
      +' · green is now “'+esc(j.greenKind)+'”'
      +' · re-scan '+esc(j.rescan&&j.rescan.level)+(j.rescan&&j.rescan.spawned?' started':' not started'+(j.rescan&&j.rescan.reason?' ('+esc(j.rescan.reason)+')':''));
    await issRefresh(d.id);
  }catch(err){ st.textContent='could not reach the server: '+err.message; }
}

