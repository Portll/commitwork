// admin/static/panel-features.js — part 6 of 8 of the panel client.
//
// CodeQL/Renovate, CRA clocks, Determinations, the dual-agent remediation console, paste-ingest, OAuth and the account control.
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

// ── CodeQL · fleet + Renovate · deps (native tabs) ──────────────────────────────────────────────
// Data are static JSON snapshots under /reports/ (same serve path as the report pages), read from
// disk on every request — regenerating the files updates the tabs with NO server restart. Both
// renderers are fully defensive: a missing/broken file renders an empty state, never a throw
// (a top-level throw here would re-break every tab binding below it).
// ── CRA Art. 14 clocks ──────────────────────────────────────────────────────────────────────────
// THE CLOCK BASIS IS THE SERVER'S. `craSkewMs` is the offset between the server's `serverNow` and
// this browser's clock at the moment the payload arrived; every countdown is rendered through it.
// A laptop an hour fast would otherwise show an hour less time remaining on a reporting deadline
// and nothing would look wrong. The offset is displayed when it is large rather than hidden.
// The three `let`s that used to sit HERE are declared above setView instead — see ROUTER STATE.
const craNow=()=>Date.now()+craSkewMs;
// The three tracks each get their own container; nothing sums across them.
const CRA_TRACKS=[['article14','cra-article14','cra-n-a14'],['bestpractice','cra-bestpractice','cra-n-bp'],
  ['internal','cra-internal','cra-n-int'],['unknown','cra-unknown','cra-n-unk']];
// Elapsed-fraction bands. Named here once so the pill and the label cannot disagree.
function craBand(startMs,dueMs,nowMs){
  if(!Number.isFinite(dueMs))return null;
  if(nowMs>dueMs)return{k:'overdue',pct:100};
  const span=dueMs-startMs;
  if(!(span>0))return{k:'ok',pct:0};
  const pct=Math.max(0,Math.min(100,Math.round(((nowMs-startMs)/span)*100)));
  return{k:pct>=90?'p90':pct>=75?'p75':pct>=50?'p50':'ok',pct};
}
function craRemaining(dueMs,nowMs){
  const d=dueMs-nowMs, a=Math.abs(d), h=Math.floor(a/3600000), m=Math.floor((a%3600000)/60000), s=Math.floor((a%60000)/1000);
  const t=h>=24?`${Math.floor(h/24)}d ${h%24}h ${m}m`:`${h}h ${m}m ${s}s`;
  return d<0?`OVERDUE by ${t}`:`${t} left`;
}
function craRenderTick(){
  const now=craNow();
  for(const el of document.querySelectorAll('[data-cra-due]')){
    const due=Date.parse(el.dataset.craDue), start=Date.parse(el.dataset.craStart);
    if(!Number.isFinite(due)){el.textContent='no due date recorded';continue;}
    const b=craBand(start,due,now);
    el.textContent=`${craRemaining(due,now)} · ${b.pct}% elapsed`;
    el.className='mono cra-'+b.k;
  }
}
async function loadCra(){
  let d;
  try{d=await (await fetch('/api/cra/cases')).json();}
  catch(e){document.getElementById('cra-n').textContent='unreachable';return;}
  const recvAt=Date.now();
  if(!d||d.ok!==true){document.getElementById('cra-n').textContent='unavailable';return;}
  if(d.configured===false){
    document.getElementById('cra-n').textContent='no case log — the watch has never run';
    for(const[,cid]of CRA_TRACKS)document.getElementById(cid).innerHTML='';
    return;
  }
  const srv=Date.parse(d.serverNow||d.at);
  craSkewMs=Number.isFinite(srv)?srv-recvAt:0;
  const skewEl=document.getElementById('cra-skew');
  if(Math.abs(craSkewMs)>60000){
    skewEl.style.display='';
    skewEl.innerHTML=`<b>Clock skew:</b> this browser is ${Math.round(Math.abs(craSkewMs)/1000)}s ${craSkewMs<0?'ahead of':'behind'} the server. Countdowns below are rendered from the SERVER's clock and are correct; your machine's clock is not.`;
  }else skewEl.style.display='none';
  craCases=d.cases||[];
  // The clock vocabulary and the server's paged ledger both travel in the payload; neither is
  // re-derived here. A payload without them degrades to no rows rather than to invented ones.
  craClockSpec=d.clockSpec||null;
  craPaged=new Set(d.paged||[]);
  const c=d.counts||{};
  // Deliberately NOT a total — each track is stated separately.
  document.getElementById('cra-n').textContent=
    `${c.article14||0} regulatory · ${c.bestpractice||0} best-practice · ${c.internal||0} internal${c.unknown?` · ${c.unknown} unclassified`:''}`;
  for(const[track,cid,nid]of CRA_TRACKS){
    const rows=craCases.filter(k=>k.track===track);
    document.getElementById(nid).textContent=String(rows.length);
    document.getElementById(cid).innerHTML=rows.length?rows.map(craCard).join(''):
      `<div class="sub" style="margin:6px 0 12px">No cases on this track.</div>`;
  }
  craRenderTick();
  if(craTickTimer)clearInterval(craTickTimer);
  craTickTimer=setInterval(craRenderTick,1000);
}
function craCard(k){
  const start=k.clocks?.basisAt||null;
  // Which clocks exist, and what each is called, comes from the SERVER (payload.clockSpec). Listing
  // them here made the browser a fourth copy of a vocabulary that is supposed to live in one place,
  // and a clock added server-side would simply never have appeared.
  const spec=(craClockSpec&&(craClockSpec[k.track==='internal'?'internal':'article14']))||[];
  const rows=spec.filter(c=>k.clocks?.[c.key]).map(c=>{
    const due=k.clocks[c.key];
    // THE SERVER'S VERDICT WINS. `k.overdue` is computed server-side against its own clock and is
    // what escalate.mjs acts on; the countdown beside it is a live convenience. When an overdue
    // clock has no chain-covered `paged` event, say so loudly — an overdue deadline nobody was
    // paged about is the worst state there is, and it is indistinguishable from a merely-overdue
    // one unless the ledger is consulted.
    const srvOverdue=(k.overdue||[]).includes(c.escalationId);
    const wasPaged=craPaged.has(`${k.caseId}|${c.escalationId}|${due}`);
    const mark=!srvOverdue?''
      :wasPaged?` <span class="pill part" title="a chain-covered paged event exists for this clock and due date">paged</span>`
      :` <span class="pill high" title="the server considers this clock overdue and the case log holds NO paged event for it — nobody has been told">OVERDUE · NOT PAGED</span>`;
    return `<div class="case-clock"><span>${esc(c.label)}</span> <span class="mono" data-cra-due="${esc(due)}" data-cra-start="${esc(start||due)}">—</span> <span class="sub mono">${esc(due)}</span>${mark}</div>`;
  }).join('');
  const filable=k.track==='article14';
  const body=k.reporting?.bodies?.length?esc(k.reporting.bodies.join(' + ')):null;
  return `<div class="case${k.overdue&&k.overdue.length?'':' ok'}">
    <b>${esc(k.caseId)}</b> <span class="mono sub">${esc(k.kind||'?')}/${esc(k.trigger||'?')}${k.kev?' · KEV':''}${k.epss!=null?` · EPSS ${esc(String(k.epss))}`:''}</span>
    ${filable?pill('high','FILABLE'):pill('plan','not filed')}
    <div class="sub">${body?`Owed to: <b>${body}</b>`:esc(k.reporting?.why||'no advisory body delegated')}</div>
    ${rows}
    ${k.draftsPath?`<div class="sub mono">drafts: ${esc(k.draftsPath)}</div>`:''}
  </div>`;
}

// ── Determinations ──────────────────────────────────────────────────────────────────────────────
// WHY-UNKNOWN IS THE HERO. Everything else on this tab is secondary to it: an unknown caused by
// "we run no analyser for this ecosystem" and one caused by "the analyser ran and found nothing"
// are opposite conclusions that rendered identically before this view existed.
const DT_WHY={
  'no-analyser-for-lane':['no analyser for this lane','plan','A scanner finding in our OWN code. Nothing in the fleet answers reachability for it — a different and much larger gap than an unanalysed dependency ecosystem, and collapsing the two would hide it.'],
  'no-analyser-for-ecosystem':['no analyser for this ecosystem','plan','The fleet runs ONE reachability analyser (govulncheck, Go). Nothing could have proven anything here — a gap in our tooling, never a finding about the code.'],
  'analyser-did-not-run':['analyser did not run','part','A finding an analyser covers, in a repo where it produced no evidence at all.'],
  'analysed-no-row':['analysed, no row','part','The analyser ran on this repo and emitted nothing for this advisory. The genuine residual.'],
  'ambiguous-alias':['ambiguous alias — REFUSED','high','Two advisories claim this id. A proof exists but attributing it would be a guess, so it is refused.'],
};
async function loadDeterminations(){
  const set=(id,v)=>{const e=document.getElementById(id); if(e) e.textContent=v;};
  let d;
  try{ d=await (await fetch('/api/cra/determinations'+(curProj?('?area='+encodeURIComponent(curProj)):''))).json(); }
  catch(e){ set('dt-n','unreachable'); return; }
  if(!d||d.ok!==true){ set('dt-n','unavailable'); return; }
  if(d.configured===false){
    // configured:false is NOT "no determinations" — grey is not green.
    set('dt-n','no results for this project yet — nothing has been measured');
    for(const id of ['dt-why','dt-denoms']) { const e=document.getElementById(id); if(e) e.innerHTML=''; }
    const rb=document.getElementById('dt-rows'); if(rb) rb.innerHTML='';
    return;
  }
  dtData=d;
  const r=d.reachability||{};
  set('dt-n',`${d.total} findings · ${r.proven||0} proven reachable · ${r.unproven||0} analysed, no path · ${r.unknown||0} unknown`);
  set('dt-unknown-n',String(r.unknown||0));

  const why=d.unknownBecause||{};
  const total=Object.values(why).reduce((a,b)=>a+b,0)||1;
  document.getElementById('dt-why').innerHTML=Object.entries(why).map(([k,n])=>{
    const [label,tone,expl]=DT_WHY[k]||[k,'plan',''];
    // A real count must never render as 0% — 29 findings shown as "0%" reads as none.
    const raw=100*n/total; const share=n===0?'0':(raw<1?'<1':String(Math.round(raw)));
    return `<div class="case ok"><b>${esc(label)}</b> ${pill(tone,String(n))} <span class="sub mono">${share}% of unknowns</span>
      <div class="sub">${esc(expl)}</div></div>`;
  }).join('');

  const den=d.denominators||{};
  const row=(k,label)=>{const x=den[k]; if(!x) return '';
    return `<div class="case-clock"><span>${esc(label)}</span> <span class="mono">${x.resolved}/${x.of}${x.pct!==null&&x.pct!==undefined?` · ${x.pct}%`:''}</span> <span class="sub">${esc(x.note||'')}</span></div>`;};
  document.getElementById('dt-denoms').innerHTML=
    row('allFindings','all findings')+row('analyserExists','analyser exists')+row('analyserRan','analyser ran');

  const rows=d.rows||[];
  document.getElementById('dt-rows').innerHTML=rows.map(x=>{
    const rp=x.reachability==='reachable'?pill('high','reachable')
      :x.reachability==='reachability_unproven'?pill('part','no path shown')
      :pill('plan','unknown');
    const ev=(x.evidence||[]).map(e=>`${esc(e.method)}${e.confidence?' · '+esc(e.confidence):''}`).join('<br>')||'<span class="sub">none</span>';
    const wh=x.why?`<span class="sub">${esc((DT_WHY[x.why]||[x.why])[0])}</span>`
      :x.aliased?`<span class="sub mono">via ${esc(x.via)}${x.fanOut>2?` · 1 of ${x.fanOut-1} aliases`:''}</span>`
      :'<span class="sub mono">direct</span>';
    return `<tr><td class="mono">${esc(x.repo)}</td><td class="mono sub">${esc(x.lane||'')}</td><td class="mono">${esc(x.id||x.rule||'')}</td><td class="mono">${esc(x.package||x.file||'')}</td><td>${rp}</td><td class="mono">${ev}</td><td>${wh}</td></tr>`;
  }).join('');

  // Scope is STATED. Counts are always over the whole population; only the rows are scoped.
  const sc=d.rowScope||{};
  set('dt-rows-n',`${sc.shown||0} of ${sc.of||0} · ${esc(sc.mode||'')}`);

  const f=document.getElementById('dt-foot');
  if(f) f.innerHTML=`Alias index: ${d.aliasIndex?d.aliasIndex.records:0} advisory records from ${d.aliasIndex?d.aliasIndex.artifacts:0} artifacts, resolving ${d.aliasIndex?d.aliasIndex.aliasedCves:0} CVEs`
    +`${d.aliasIndex&&d.aliasIndex.collisions?` · <b>${d.aliasIndex.collisions} colliding id(s), refused</b>`:''}.`
    +` <b>Nothing in this fleet can assert that code is unreachable</b> — govulncheck proves reachability, not its absence, so an "unknown" here is never a quiet "not affected".`
    +` ${esc(sc.note||'')}`
    +` <b>Population: ${d.total} rows across ${Object.keys(d.byLane||{}).length} lanes.</b> Lanes overlap by design — two scanners may describe one defect — so these are ROWS, not distinct vulnerabilities.`;
}

// CRITICAL AND HIGH USED TO RENDER IDENTICALLY. `s==='crit'||s==='high' ? 'high'` sent both to the
// orange class, while `.pill.crit` and --crit existed, were styled, and were reached by nothing on
// this path — so 4,852 criticals and 25,895 highs were the same colour on screen. Measured
// 2026-08-26. A distinction the data carries and the render drops is the same defect as one the
// data never carried, from the reader's side.
const sevPill=(s)=>pill(s==='crit'||s==='critical'?'crit':s==='high'?'high':s==='med'||s==='medium'?'part':'plan',s);
// ACTIVELY EXPLOITED — the display band between high and critical. A FLOOR, never a demotion: a
// known-exploited medium is lifted to the band, and a known-exploited CRITICAL stays critical
// rather than being pulled down into it. The finding's own severity is untouched; this decides
// nothing but paint and order.
const EXPLOITED_RANK=0.5;
const sevRank=(s)=>({crit:0,critical:0,high:1,med:2,medium:2,low:3,info:4})[s]??9;
const rankOf=(sev,kev)=>(kev===true?Math.min(sevRank(sev),EXPLOITED_RANK):sevRank(sev));
// ALL FINDINGS. The per-check tables stay the place to act; this is the place to see what matters
// first. Rows the check gave no severity are counted and listed last, and said so, because an
// ungraded row sorted silently to the bottom reads as a low one.
const AF_CAP=500, AF_SEVS=new Set(['crit','critical','high','med','medium','low','info']);
function checkNameOf(t){
  const tab=document.querySelector(`#views .vtab[data-v="${t.view}"]`);
  const base=tab?.childNodes[0]?.textContent.trim()||LANE_TITLE[t.key]||t.key;
  const sub=t.sub&&document.querySelector(`[data-sub="${t.sub}"]`)?.childNodes[0]?.textContent.trim();
  return sub?`${base} · ${sub}`:base;
}
function renderAllFindings(d){
  const body=$('af-rows'); if(!body)return;
  const sum=$('af-sum'), notes=$('af-notes'), more=$('af-more'), n=$('af-n');
  if(!curProj){body.innerHTML='';notes.innerHTML='';more.textContent='';n.textContent='—';sum.textContent='Choose a project to see its findings.';return;}
  if(!d){sum.textContent='Loading…';return;}
  const want=$('af-cat').value, rows=[], states={found:[],clean:[],none:[],partial:[],conflict:[],na:[]}, cut=[];
  let closed=0;
  for(const t of SCANNER_TABS){
    const cat=findingCategory(t.view); if(want!=='all'&&cat!==want)continue;
    const s=(d.scanners||{})[t.key], st=covState(s), name=checkNameOf(t);
    const all=(d.scannerFindings||{})[t.key]||[], open=all.filter(f=>!isClosedFinding(f));
    closed+=all.length-open.length;
    (st==='findings'?states.found:st==='clean'?states.clean:st==='partial'?states.partial:st==='contradiction'?states.conflict:st==='na'?states.na:states.none).push(name);
    if(s&&s.detail&&s.detail.truncated)cut.push(name);
    for(const f of open){
      const raw=f.sev||f.severity||'', sev=AF_SEVS.has(raw)?raw:(CRITICAL_LANE.has(t.view)?'crit':'');
      rows.push({f,t,name,sev,rank:sev?rankOf(sev,f.kev):9});
    }
  }
  rows.sort((a,b)=>a.rank-b.rank);
  const ungraded=rows.filter(r=>!r.sev).length;
  n.textContent=String(rows.length);
  const part=(k,words)=>states[k].length?`${states[k].length} ${words}`:'';
  sum.textContent='Checks: '+[part('found','found problems'),part('clean','ran and found nothing'),part('partial','ran on only part of the project'),part('none','have no result yet'),part('na','do not apply here'),part('conflict','have a conflicting record')].filter(Boolean).join(' · ')||'none in this group.';
  notes.innerHTML=[
    states.none.length?`<details class="blk-tight"><summary class="mut point">Checks with no result yet — their findings, if any, are not in this list</summary><p class="mut">${states.none.map(esc).join(' · ')}</p></details>`:'',
    ungraded?`<p class="mut">${ungraded} finding(s) came with no severity from their check and are listed last. Their position says nothing about how serious they are.</p>`:'',
    cut.length?`<p class="mut">Some checks sent only part of their results: ${cut.map(esc).join(' · ')}. Open a check for its full table.</p>`:'',
    closed?`<p class="mut">${closed} finding(s) reviewed and closed are not shown.</p>`:'',
    '<p class="mut">Not included here: vulnerable dependency versions (Evidence report), the fleet-wide deep code analysis, accessibility, access control and comment quality. Each has its own page under Findings.</p>',
  ].join('');
  const cell=(v)=>esc(String(v||''));
  body.innerHTML=rows.slice(0,AF_CAP).map(({f,t,name,sev})=>{
    const rule=f.rule||f.id||f.detector||f.marker||f.issue||f.control||f.operation||f.component||'';
    const msg=f.message||f.summary||f.title||'';
    const loc=f.file||f.path||f.target||f.resource||(f.package?f.package+(f.version?'@'+f.version:''):'');
    const where=[f.repo,loc&&(f.line?loc+':'+f.line:loc)].filter(Boolean).join(' · ');
    return `<tr><td>${sev?sevPill(sev):pill('plan','not graded')}</td><td><b>${cell(rule)}</b>${msg?`<div class="mut t-note">${cell(String(msg).slice(0,240))}</div>`:''}</td><td class="mut">${cell(where)}</td><td><a href="${esc(viewUrl(t.view))}" data-go="${esc(t.view)}">${cell(name)}</a></td></tr>`;
  }).join('')||'<tr><td colspan="4" class="mut">No open findings from checks that have a result.</td></tr>';
  more.textContent=rows.length>AF_CAP?`Showing the ${AF_CAP} most severe of ${rows.length}. Open a check for its full table.`:'';
}
$('af-cat').onchange=()=>renderAllFindings(lastState);
$('af-rows').addEventListener('click',e=>{const a=e.target.closest('[data-go]');if(!a)return;e.preventDefault();navigateWorkspace(a.dataset.go);});
// (esc lives at the top of this script — it must exist before any render path runs)
// Credentials — presence only. The payload carries NO value field (admin/routes/secrets.mjs), and
// nothing here may invent one: not a mask, not a length, not a prefix. A redacted value is still a
// shape someone can reason about.
async function loadCredentials(){
  const el=(id)=>document.getElementById(id);
  let d;
  try{
    const r=await fetch('/api/secrets');
    if(r.status===401){
      el('cred-n').textContent='not signed in';
      el('cred-counts').innerHTML='<div class="cred-msg cred-unknown">Nobody is signed in, so the store was not read. This is NOT an empty store.</div>';
      el('cred-blocked').innerHTML=''; el('cred-rows').innerHTML=''; return;
    }
    if(!r.ok) throw new Error('HTTP '+r.status);
    d=await r.json();
  }catch(e){
    // FAIL CLOSED. An unreachable route is not "no credentials" — that renders as a clean store
    // while every lane silently lacks its keys.
    el('cred-n').textContent='unreadable';
    el('cred-counts').innerHTML='<div class="pk-err">Could not read the store: '+esc(String(e.message))+'. Nothing below is a statement about what is configured.</div>';
    el('cred-blocked').innerHTML=''; el('cred-rows').innerHTML=''; return;
  }
  if(d.storeError){
    el('cred-n').textContent='store unreadable';
    el('cred-counts').innerHTML='<div class="pk-err">The ref table could not be read: '+esc(d.storeError)+'. Absence below is unproven.</div>';
    el('cred-blocked').innerHTML=''; el('cred-rows').innerHTML=''; return;
  }
  const c=d.counts||{};
  el('cred-n').textContent=(c.total||0)+' declared or demanded';
  // Four figures, never summed into one "missing" — the route separates them because each needs a
  // different fix, and a single number puts them back together.
  el('cred-counts').innerHTML=
     '<span class="cred-fig cred-ok">'+(c.resolvable||0)+' resolvable</span>'
    +'<span class="cred-fig cred-bad">'+(c.unresolvable||0)+' unresolvable</span>'
    +'<span class="cred-fig cred-none">'+(c.undeclared||0)+' undeclared</span>'
    +'<span class="cred-fig cred-over">'+(c.overridden||0)+' env-overridden</span>';
  const blocked=d.blockedChecks||[];
  el('cred-blocked').innerHTML = blocked.length
    ? '<div class="pk-err"><span><b>'+blocked.length+' check(s) blocked</b> by an absent credential: '+blocked.map(esc).join(', ')+'</span></div>'
    : '<div class="cred-msg cred-ok">No check is blocked by a missing credential.</div>';
  el('cred-rows').innerHTML=(d.secrets||[]).map(s=>{
    // Colour is never the only channel (WCAG 1.4.1) — every state carries its own word.
    let cls='cred-ok', word='resolves';
    if(!s.declared){ cls='cred-none'; word='UNDECLARED — no ref recorded'; }
    else if(!s.resolvable){ cls='cred-bad'; word='UNRESOLVABLE — '+esc(s.reason||'lookup failed'); }
    else if(s.envOverride){ cls='cred-over'; word='resolves · env override active'; }
    const blocks=(s.blocks||[]).map(b=>esc(b.check));
    return '<tr><td><code>'+esc(s.name)+'</code></td>'
      +'<td class="mut">'+(s.ref?'<code>'+esc(s.ref)+'</code>':'<span class="cred-none">—</span>')+'</td>'
      +'<td class="'+cls+'">'+word+'</td>'
      +'<td class="mut">'+(blocks.length?blocks.join(', '):'—')+'</td></tr>';
  }).join('')||'<tr><td colspan="4" class="mut">No credential is declared or demanded by any manifest.</td></tr>';
}

// ── CodeQL dual-agent remediation state ─────────────────────────────────────────────────────────
// cqJobs is keyed by the finding's IDENTITY (service|sarif|ruleId|file — LINE EXCLUDED, matching
// admin/routes/codeql-remediation.mjs: the line is context, and a moved line is the same finding).
// The seven `let`s that used to sit HERE are declared above setView instead — see ROUTER STATE.
const cqBusy={},cqDetailCache={};
// Action failures (analyze/apply/clear) get their OWN slot, separate from cqJobsError: the store
// error is recomputed on every poll, so an action error parked there was erased by the next tick —
// measured as "the analyze error disappears almost immediately". This one persists until the
// operator dismisses it or a later action of the same kind succeeds.
let cqActionError=null;
// {done,total} while a batch dispatch loop is in flight — cqBar renders "Analyzing done/total…"
// from THIS, because the re-render mid-loop replaces the button the click handler was mutating
let cqBatch=null;
const cqKey=(f)=>[f.service,f.sarif,f.ruleId,f.file].join('|');
const CQ_STAGE_WORD={local:'local analysis',opus:'opus analysis',localCross:'local cross-review',opusCross:'opus cross-review'};
const cqElapsed=(at)=>{if(!at)return '';const s=Math.max(0,Math.round((Date.now()-new Date(at).getTime())/1000));return s>=3600?Math.floor(s/3600)+'h'+Math.floor(s%3600/60)+'m':s>=60?Math.floor(s/60)+'m'+(s%60)+'s':s+'s';};
// what a running job is DOING right now: the running stage(s) with elapsed time, else the lane wait.
// The elapsed counter is what makes a five-minute model call read as progress instead of a hang.
function cqStageWord(j){
  const st=j.stages||{};
  const running=['local','opus','localCross','opusCross'].filter(k=>st[k]&&st[k].status==='running');
  if(running.length)return running.map(k=>`${CQ_STAGE_WORD[k]} ${cqElapsed(st[k].startedAt)}`).join(' + ');
  const waiting=['local','opus','localCross','opusCross'].filter(k=>st[k]&&st[k].status==='waiting');
  if(waiting.length)return 'waiting for an agent lane';
  return j.state;
}
const cqAgreePill=(j)=>j.agreement?(j.agreement.agree?pill('live','agreed'):pill('part','disputed')):'';
async function loadCqJobs(){
  cqJobsError=null;
  try{const r=await fetch('/api/codeql/remediation?project='+encodeURIComponent(curProj||''));
    let d=null;try{d=await r.json();}catch(_){/* non-JSON reply — stated below via status */}
    // FAIL CLOSED in the render: a broken job store is its own state, never "no jobs yet" — and
    // an HTTP failure names its most likely cause. A 401/404 here usually means the RUNNING panel
    // process predates these routes (routes load at boot; this page is served fresh from disk).
    if(!r.ok||!d||d.ok===false){
      cqJobsArr=[];cqJobs={};
      cqJobsError=((d&&d.error)||('HTTP '+r.status))
        +((r.status===404||r.status===401)?' — if you are signed in, the running panel process predates the remediation routes: restart the panel (node admin/serve.mjs; mind CW_OAUTH_LIVE_EXCHANGE=1 if Google sign-in is needed)':'');
      return;
    }
    cqJobsArr=d.jobs||[];cqJobs={};cqJobsArr.forEach(j=>{if(j.key)cqJobs[j.key]=j;});
  }catch(e){cqJobsArr=[];cqJobs={};cqJobsError=e.message;}
}
async function loadCqDetail(id){
  try{const r=await fetch('/api/codeql/remediation/job?project='+encodeURIComponent(curProj||'')+'&id='+encodeURIComponent(id));
    const d=await r.json();if(d.ok&&d.job)cqDetailCache[id]=d.job;}catch(e){/* the detail row keeps its loading state */}
}
function cqCell(f,i){
  const key=cqKey(f),j=cqJobs[key];
  if(cqBusy[key])return '<span class="mut">dispatching…</span>';
  if(!j)return `<button data-act="an" data-i="${i}" title="investigate with the local Qwen 3.8 model + an Opus agent, cross-review, lodge a remediation">analyze</button>`;
  if(j.state==='queued'||j.state==='running')return `<span class="mut">${esc(cqStageWord(j))}…</span> <button data-act="stop" data-id="${esc(j.id)}" title="stop this run — waiting stages never start, in-flight engine calls are killed (claude gets SIGTERM→SIGKILL), finished stage verdicts are kept as evidence, and no remediation is lodged">■</button>`;
  if(j.state==='failed')return `<b title="${esc(j.error||'')}">failed</b> <button data-act="an" data-i="${i}">retry</button>`;
  if(j.state==='stopped')return `<b class="mut" title="stopped by operator — finished stage verdicts were kept, no remediation was lodged">■ stopped</b> <button data-act="an" data-i="${i}">retry</button> <button data-act="view" data-i="${i}">${cqOpen===key?'hide':'detail'}</button>`;
  if(j.state==='orphaned')return `<b title="the panel process restarted while this ran — the pipeline queue is in-memory, so the run did not survive">interrupted</b> <button data-act="an" data-i="${i}">retry</button>`;
  if(j.state==='unreadable')return '<b title="the job file on disk did not parse — this is not an absent job">job unreadable</b>';
  if(j.state==='applied')return `${cqAgreePill(j)} applied <code>${esc(String((j.applied&&j.applied.commit)||'').slice(0,8))}</code> <button data-act="view" data-i="${i}">${cqOpen===key?'hide':'detail'}</button>`;
  if(j.state==='lodged')return `${cqAgreePill(j)} lodged <button data-act="view" data-i="${i}">${cqOpen===key?'hide':'view'}</button>${j.executable?` <button class="cq-play" data-act="play" data-i="${i}" title="execute the lodged diff, commit the file, and resweep this finding">▶</button>`:' <span class="mut" title="the lodged verdict warrants no code change (or needs a human) — there is nothing to execute">no diff</span>'}`;
  return esc(j.state);
}
function cqVerdictBlock(title,v){
  if(!v)return `<div class="cq-v"><b>${esc(title)}</b><div class="mut">no verdict — this stage failed; its error and raw reply are preserved on the job record</div></div>`;
  const cls=v.classification==='real'?'high':v.classification==='false-positive'?'live':'part';
  return `<div class="cq-v"><b>${esc(title)}</b> ${pill(cls,esc(v.classification))} <span class="mut">confidence ${esc(v.confidence||'—')}</span>`
    +(v.investigation?`<div><span class="mut">investigation</span><br>${esc(v.investigation)}</div>`:'')
    +(v.falsePositiveAnalysis?`<div><span class="mut">false-positive analysis</span><br>${esc(v.falsePositiveAnalysis)}</div>`:'')
    +(v.response?`<div><span class="mut">on the other agent's verdict${v.positionChanged?' · position changed':' · position held'}</span><br>${esc(v.response)}</div>`:'')
    +(v.remediation?`<div><span class="mut">remediation</span><br>${esc(v.remediation)}</div>`:'')+'</div>';
}
function cqDetailRow(f,i){
  const s=cqJobs[cqKey(f)],j=s&&cqDetailCache[s.id];
  if(!j)return '<tr class="cq-detail"><td colspan="6" class="mut">loading job…</td></tr>';
  const st=j.stages||{};
  const errs=Object.entries(st).filter(([,v])=>v&&v.error).map(([k,v])=>`<div class="cq-agree"><b>${esc(CQ_STAGE_WORD[k]||k)}:</b> ${esc(v.error)}</div>`).join('');
  const diff=j.remediation&&j.remediation.diff;
  return `<tr class="cq-detail"><td colspan="6">`
    +(j.agreement?`<div class="cq-agree">${cqAgreePill(j)} ${esc(j.agreement.basis||'')}</div>`:'')
    +(j.error?`<div class="cq-agree"><b>pipeline error:</b> ${esc(j.error)}</div>`:'')+errs
    +`<div class="cq-cols">`
    +cqVerdictBlock(`Local — ${(j.engines&&j.engines.local&&j.engines.local.model)||'lmstudio'}`,st.local&&st.local.verdict)
    +cqVerdictBlock('Opus — claude -p',st.opus&&st.opus.verdict)
    +cqVerdictBlock('Local · after cross-review',st.localCross&&st.localCross.verdict)
    +cqVerdictBlock('Opus · after cross-review',st.opusCross&&st.opusCross.verdict)
    +'</div>'
    +(diff&&diff.trim()?`<div><span class="mut">lodged diff (${esc(j.remediation.source||'')})</span><pre class="cq-diff">${esc(diff)}</pre>`
      +(j.state==='lodged'&&j.remediation.executable?`<button class="cq-play" data-act="play" data-i="${i}">▶ execute, commit &amp; resweep</button>`:'')
      +(j.state==='applied'?`<div>applied as <code>${esc(j.applied.commit)}</code> · ${(j.applied.files||[]).map(esc).join(', ')} · resweep ${j.applied.resweep&&j.applied.resweep.started?'started':'NOT started — '+esc((j.applied.resweep&&j.applied.resweep.reason)||'no reason recorded')}</div>`:'')+'</div>'
      :`<div class="mut">no executable diff lodged${j.remediation?` — final classification ${esc(j.remediation.classification)}`:''}</div>`)
    +'</td></tr>';
}
function cqBar(){
  if(!cqFleet||!(cqFleet.findings||[]).length)return '';
  const fs=cqFleet.findings,t=cqFleet.totals||{total:fs.length};
  const js=fs.map(f=>cqJobs[cqKey(f)]).filter(Boolean);
  const c=(state)=>js.filter(j=>j.state===state).length;
  const run=c('queued')+c('running'),lodged=c('lodged'),applied=c('applied'),failed=c('failed');
  const remaining=fs.filter(f=>{const j=cqJobs[cqKey(f)];return !j||j.state==='failed'||j.state==='orphaned'||j.state==='stopped';}).length;
  const clearable=js.filter(j=>!['queued','running'].includes(j.state)).length;
  // the persistent action-failure strip: survives every poll, leaves only by ✕ or a later success
  const err=cqActionError?`<div class="cq-remed err"><div><b>action failed:</b> ${esc(cqActionError)}</div><div class="cq-remed-act"><button data-act="dismiss-err" title="dismiss this error">✕</button></div></div>`:'';
  return err+`<div class="cq-remed"><div><b>${t.total} finding${t.total===1?'':'s'} need${t.total===1?'s':''} a decision.</b> Dual-agent remediation runs each finding through the local Qwen&nbsp;3.8 model and an Opus agent (<code>claude&nbsp;-p</code>) independently, cross-reviews each verdict against the other, and lodges the outcome — agreed or disputed — as a diff. ▶ executes the diff, commits the file, and resweeps that finding.`
    +(cqJobsError?`<br><b>remediation store unreadable:</b> ${esc(cqJobsError)} — the statuses below are UNKNOWN, not absent.`:'')+'</div>'
    +`<div class="cq-remed-act"><span class="cq-counts">${run?pill('part',run+' running'):''}${lodged?pill('live',lodged+' lodged'):''}${applied?pill('attest',applied+' applied'):''}${failed?pill('high',failed+' failed'):''}${c('stopped')?pill('plan',c('stopped')+' stopped'):''}</span>`
    +(cqBatch?`<button class="pri" disabled>Analyzing ${cqBatch.done}/${cqBatch.total}…</button>`
      :remaining?`<button data-act="all" class="pri" title="run the dual-agent pipeline on every finding without a lodged or running job">▶ Analyze ${remaining}</button>`:'')
    +`<button data-act="console" title="the live console — stage-by-stage progress and structured results as each analysis runs">${cqConsoleOn?'hide console':'console'}</button>`
    +`<button data-act="clear"${clearable?'':' disabled'} title="remove the ${clearable} finished remediation record${clearable===1?'':'s'} (lodged diffs included) — running jobs are never touched">clear</button></div></div>`;
}
// ── the live console (mirrors the sweep console idiom) ──────────────────────────────────────────
// Structured first, narration second: each job renders its stage verdicts as chips the moment the
// server records them, with the job's own event trail tailing underneath. Data is the SAME list
// payload the table renders from — one wire shape, so the two can never disagree.
const cqcTime=(iso)=>{try{return new Date(iso).toTimeString().slice(0,8)}catch(_){return '—'}};
function cqcChip(name,s){
  if(!s||!s.status)return `<span class="cqc-chip mut">${CQ_STAGE_WORD[name]} · —</span>`;
  if(s.status==='waiting')return `<span class="cqc-chip mut">${CQ_STAGE_WORD[name]} · in lane ${cqElapsed(s.queuedAt)}</span>`;
  if(s.status==='running')return `<span class="cqc-chip run">${CQ_STAGE_WORD[name]} · running ${cqElapsed(s.startedAt)}</span>`;
  if(s.status==='failed')return `<span class="cqc-chip bad">${CQ_STAGE_WORD[name]} · FAILED</span>`;
  if(s.status==='stopped')return `<span class="cqc-chip mut">${CQ_STAGE_WORD[name]} · ■ stopped</span>`;
  return `<span class="cqc-chip ok">${CQ_STAGE_WORD[name]} · ${esc(s.classification||'?')}${s.confidence?' ('+esc(s.confidence)+')':''}${s.diff?' · diff':''}</span>`;
}
function cqConsoleRender(){
  $('cq-console').style.display=cqConsoleOn?'':'none';
  if(!cqConsoleOn)return;
  const active=cqJobsArr.filter(j=>j.state==='queued'||j.state==='running').length;
  const ico=$('cqc-ico');
  if(active){ico.className='spin';ico.textContent='';ico.style.color='';}
  else{const bad=cqJobsArr.some(j=>j.state==='failed');ico.className='';ico.textContent=bad?'✕':'✓';ico.style.color=bad?'var(--crit)':'var(--live)';}
  $('cqc-title').textContent=active?`remediation · ${active} running`:(cqJobsArr.length?'remediation · idle':'remediation · no jobs yet');
  $('cqc-sub').textContent=cqJobsArr.length?`${cqJobsArr.filter(j=>j.state==='lodged').length} lodged · ${cqJobsArr.filter(j=>j.state==='applied').length} applied · ${cqJobsArr.filter(j=>j.state==='failed').length} failed`:'';
  $('cqc-body').innerHTML=(cqActionError?`<div class="cq-agree cq-err-text"><b>action failed:</b> ${esc(cqActionError)} <button data-act="dismiss-err" title="dismiss this error">✕</button></div>`:'')
    +(cqJobsError?`<div class="cq-agree"><b>remediation store unreadable:</b> ${esc(cqJobsError)}</div>`:
    cqJobsArr.map(j=>{
      const f=j.finding||{};
      return `<div class="cqc-job${j.state==='queued'||j.state==='running'?' live':''}">
        <div class="cqc-head"><b class="name">${esc(f.service||'?')}</b> <code>${esc(f.ruleId||'?')}</code> <code class="t-loc">${esc(f.file||'?')}</code> ${j.agreement?cqAgreePill(j):''}<span class="mut push-right">${esc(j.state)}</span>${j.state==='queued'||j.state==='running'?` <button data-act="stop" data-id="${esc(j.id)}" title="stop this run">■</button>`:''}</div>
        <div class="cqc-chips">${['local','opus','localCross','opusCross'].map(k=>cqcChip(k,(j.stages||{})[k])).join('')}</div>
        ${(j.events||[]).length?`<pre class="con-log cqc-log">${(j.events||[]).map(e=>`${cqcTime(e.at)}  ${esc(e.msg)}`).join('\n')}</pre>`:''}
      </div>`;
    }).join('')||'<div class="mut">No remediation has been dispatched yet — the analyze buttons on the CodeQL tab feed this console.</div>');
}
function cqConsoleShow(on){cqConsoleOn=on;cqConsoleRender();}
$('cqc-hide').onclick=()=>cqConsoleShow(false);
$('cqc-body').onclick=(e)=>cqClick(e);
function cqRender(){
  if(cqFleet){
    const html=[];
    (cqFleet.findings||[]).forEach((f,i)=>{
      html.push(`<tr${f.lifecycle==='superseded'?' class="row-standby"':''}><td><b class="name">${esc(f.service)}</b>${f.lifecycle==='superseded'?'<br><span class="mut t-meta">superseded · standby</span>':''}</td><td><code>${esc(f.ruleId)}</code>${f.securitySeverity!=null?`<br><span class="mut t-meta">sec-sev ${esc(f.securitySeverity)}</span>`:''}</td><td>${sevPill(f.severity)}</td><td class="mut cell-msg">${esc(f.message)}</td><td><code class="t-loc">${esc(f.file||'?')}${f.line?':'+f.line:''}</code></td><td>${cqCell(f,i)}</td></tr>`);
      if(cqOpen===cqKey(f))html.push(cqDetailRow(f,i));
    });
    $('cq-rows').innerHTML=html.join('');
    $('cq-remed-top').innerHTML=cqBar();$('cq-remed-bottom').innerHTML=cqBar();
  }
  cqConsoleRender();
  clearTimeout(cqPoll);
  // While any job is active the poll NEVER lets its chain die — the old guard returned without
  // rescheduling when the operator was on another tab with the console hidden, and the display
  // then stayed frozen until a manual action. Visible (tab or console) polls at 3s, hidden at 8s;
  // a store error self-heals at 10s instead of freezing on its own message.
  const active=Object.values(cqJobs).some(j=>j&&(j.state==='queued'||j.state==='running'));
  if(active||cqJobsError)
    cqPoll=setTimeout(async()=>{await loadCqJobs();if(cqOpen&&cqJobs[cqOpen])await loadCqDetail(cqJobs[cqOpen].id);cqRender();},
      cqJobsError?10000:(cqConsoleOn||curView==='codeql')?3000:8000);
}
async function cqClick(e){
  const b=e.target.closest('button[data-act]');if(!b||b.disabled)return;
  const act=b.dataset.act;
  // fleet-independent actions first — the console (and its dismiss) must work from any tab,
  // including before the CodeQL tab has ever loaded its fleet file
  if(act==='dismiss-err'){cqActionError=null;cqRender();return;}
  if(act==='console'){cqConsoleShow(!cqConsoleOn);cqRender();return;}
  if(act==='stop'){b.disabled=true;
    try{const r=await cwPost('/api/codeql/remediate/stop',{headers:{'content-type':'application/json'},
        body:JSON.stringify({project:curProj||'',id:b.dataset.id})});
      const d=await r.json().catch(()=>({}));
      if(!d.ok)cqActionError='stop failed: '+(d.error||('HTTP '+r.status));
    }catch(err){cqActionError='stop failed: '+err.message;}
    await loadCqJobs();cqRender();return;}
  if(!cqFleet)return;
  const f=cqFleet.findings[+b.dataset.i];
  const dispatch=async(fd)=>{
    const key=cqKey(fd);cqBusy[key]=1;cqConsoleOn=true;cqRender();
    try{const r=await cwPost('/api/codeql/remediate',{headers:{'content-type':'application/json'},
        body:JSON.stringify({project:curProj||'',service:fd.service,ruleId:fd.ruleId,file:fd.file,sarif:fd.sarif})});
      const d=await r.json().catch(()=>({}));
      // a 409 "already queued or running" is NOT a failure — the work the operator asked for is
      // already happening (a double-click, or a row button pressed mid-batch); refresh, say nothing
      if(!d.ok&&!(r.status===409&&/already queued or running/.test(d.error||'')))cqActionError=`analyze ${fd.service} · ${fd.ruleId}: ${d.error||('HTTP '+r.status)}`;
      else if(d.ok)cqActionError=null;
    }catch(err){cqActionError=`analyze ${fd.service} · ${fd.ruleId}: ${err.message}`;}
    delete cqBusy[key];
  };
  if(act==='an'){await dispatch(f);await loadCqJobs();cqRender();}
  else if(act==='all'){b.disabled=true;
    // mark every target busy up front so no row still offers "analyze" mid-batch — the window
    // where a row button raced the batch was where the alarming 409 came from
    const targets=cqFleet.findings.filter(fd=>{const j=cqJobs[cqKey(fd)];return !j||j.state==='failed'||j.state==='orphaned'||j.state==='stopped';});
    cqBatch={done:0,total:targets.length};
    targets.forEach(fd=>{cqBusy[cqKey(fd)]=1;});cqRender();
    for(const fd of targets){await dispatch(fd);cqBatch.done++;cqRender();}
    cqBatch=null;
    await loadCqJobs();cqRender();}
  else if(act==='clear'){b.disabled=true;
    try{const r=await cwPost('/api/codeql/remediation/clear',{headers:{'content-type':'application/json'},body:JSON.stringify({project:curProj||''})});
      const d=await r.json().catch(()=>({}));
      if(!d.ok)cqActionError='clear failed: '+(d.error||('HTTP '+r.status));else cqActionError=null;
    }catch(err){cqActionError='clear failed: '+err.message;}
    cqOpen=null;await loadCqJobs();cqRender();}
  else if(act==='view'){const key=cqKey(f);
    if(cqOpen===key){cqOpen=null;cqRender();return;}
    cqOpen=key;cqRender();
    const s=cqJobs[key];if(s&&s.id){await loadCqDetail(s.id);cqRender();}}
  else if(act==='play'){const s=cqJobs[cqKey(f)];if(!s)return;
    b.disabled=true;b.textContent='applying…';
    try{const r=await cwPost('/api/codeql/remediate/apply',{headers:{'content-type':'application/json'},
        body:JSON.stringify({project:curProj||'',id:s.id})});
      const d=await r.json().catch(()=>({}));
      if(!d.ok)cqActionError='apply failed: '+(d.error||('HTTP '+r.status));
      else{cqActionError=null;delete cqDetailCache[s.id];}
    }catch(err){cqActionError='apply failed: '+err.message;}
    await loadCqJobs();if(cqOpen&&cqJobs[cqOpen])await loadCqDetail(cqJobs[cqOpen].id);
    cqRender();}
}
async function loadCodeql(){
  const n=$('cq-n'),rows=$('cq-rows'),sum=$('cq-summary');
  $('cq-rows').onclick=cqClick;$('cq-remed-top').onclick=cqClick;$('cq-remed-bottom').onclick=cqClick;
  try{
    const [r]=await Promise.all([fetch('/reports/codeql-fleet.json?project='+encodeURIComponent(curProj||'')),loadCqJobs()]);
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();cqFleet=d;cqOpen=null;
    $('cq-batch').textContent=d.batch||'—';
    const t=d.totals||{crit:0,high:0,med:0,low:0,total:0};
    const per=(d.perService||[]).filter(s=>s.total>0);
    n.textContent=`${t.total} findings · ${per.length}/${d.scanned||per.length} services · ${d.batch||''}`;
    if(!(d.findings||[]).length){sum.innerHTML='';$('cq-remed-top').innerHTML='';$('cq-remed-bottom').innerHTML='';rows.innerHTML='<tr><td colspan="6" class="mut">no CodeQL findings in latest sweep</td></tr>';return;}
    sum.innerHTML=[`<div class="kpi ${t.crit||t.high?'bad':t.med?'warn':'good'}"><div class="k">fleet total</div><div class="v tnum">${t.total}</div><div class="s">${t.crit}C · ${t.high}H · ${t.med}M · ${t.low}L</div></div>`]
      .concat(per.map(s=>`<div class="kpi ${s.crit||s.high?'bad':s.med?'warn':'good'}"><div class="k">${esc(s.service)}${s.lifecycle==='superseded'?' · standby':''}</div><div class="v tnum">${s.total}</div><div class="s">${s.crit}C · ${s.high}H · ${s.med}M · ${s.low}L</div></div>`)).join('');
    cqRender();
  }catch(e){cqFleet=null;sum.innerHTML='';$('cq-remed-top').innerHTML='';$('cq-remed-bottom').innerHTML='';
    // A CODE FAULT IS NOT A MISSING FILE, and this told the operator it was. Every failure rendered
    // "no CodeQL data — generate with node monitor/codeql-fleet-data.mjs", so when a ReferenceError
    // in this loader took the view down (cqJobsError, live 2026-08-27) the page reported an absent
    // artifact and prescribed a sweep — while codeql-fleet.json sat on disk with 25 findings in it.
    // Wrong state, wrong remedy, stated confidently. The engine's own classes are the discriminator:
    // a ReferenceError/TypeError HERE means this page is broken, never that the data is absent.
    const bug=!!e&&(e.name==='ReferenceError'||e.name==='TypeError');
    n.textContent=bug?'panel fault':'no data';
    rows.innerHTML=bug
      ? `<tr><td colspan="6"><span class="pill crit">panel fault</span> <span class="mut">this view failed inside the panel's own code — <code>${esc(e.name)}: ${esc(e.message)}</code>. Nothing was read, so this is NOT a statement that the CodeQL data is missing, and not a clean result either. Reload after restarting the panel; if it persists it is a bug in this page and no sweep will fix it.</span></td></tr>`
      : `<tr><td colspan="6" class="mut">no CodeQL data — generate with <code>node monitor/codeql-fleet-data.mjs</code> (${esc(e.message)})</td></tr>`;}
}
const ago=(iso)=>{if(!iso)return '—';const d=(Date.now()-new Date(iso).getTime())/864e5;return d<1?Math.max(0,Math.round(d*24))+'h':Math.round(d)+'d';};
// normalized-title key for live-vs-pasted dedupe (pasted entry matching a live PR title → live wins)
// Strip to a FIXED POINT and accept both comment terminators — `--!>` closes a comment as surely
// as `-->`, and one pass can CREATE the token it removes ("<<!--!--" -> "<!--"). Must stay in step
// with stripHtmlComments() in admin/serve.mjs: the server derives the same key when it parses a
// paste, and if the two disagree the overlay stops deduping against live rows and double-counts.
// Single-pass SCAN, not a regex-delete: a `<` is only copied when it does not begin `<!--`, so the
// output cannot contain `<!--` by construction. The fixed-point loop this replaces was behaviourally
// correct and still tripped CodeQL's incomplete-multi-character-sanitization, and "right but
// unrecognised" is where a real false-clean hides. Must stay in step with stripHtmlComments() in
// admin/lib/core.mjs — the server derives the same dedupe key, and if the two disagree the pasted
// overlay stops matching live rows and double-counts.
const rnStrip=(s)=>{const src=String(s??'');let o='';for(let i=0;i<src.length;){
  if(src.startsWith('<!--',i)){i+=4;while(i<src.length){if(src.startsWith('-->',i)){i+=3;break;}if(src.startsWith('--!>',i)){i+=4;break;}i++;}continue;}
  o+=src[i];i++;}
  return /<!--|--!?>/.test(o)?o.replace(/</g,'&lt;').replace(/>/g,'&gt;'):o;};
const rnKey=(t)=>rnStrip(String(t||'').toLowerCase()).replace(/[^a-z0-9]+/g,' ').trim();
const rnStatePill=(s)=>pill(s==='open'?'live':/rate-limited|awaiting-schedule|pending/.test(s)?'part':'plan',s||'pending');
async function loadRenovate(){
  const rows=$('rn-rows'),dash=$('rn-dash'),cfg=$('rn-config'),n=$('rn-n');
  // pasted overlay (renovate-manual.json) — absent/cleared (entries:[]) → no pasted rows
  let manual=null;
  try{const rm=await fetch('/reports/renovate-manual.json?project='+encodeURIComponent(curProj||''));if(rm.ok){const j=await rm.json();if(j&&Array.isArray(j.entries)&&j.entries.length)manual=j;}}catch(e){/* no pasted data */}
  try{
    const r=await fetch('/reports/renovate.json?project='+encodeURIComponent(curProj||''));
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();
    n.textContent=`${d.repo||''} · snapshot ${d.generated?new Date(d.generated).toLocaleString():'—'}`+(manual?` · +${manual.entries.length} pasted ${new Date(manual.pastedAt).toLocaleDateString()}`:'');
    const failed=(d.errors||[]).map(e=>`<code>${esc(e.command)}</code>`).join(', ');
    const prs=d.prs||[];
    // merge: live PRs first (provenance 'live'), then pasted entries that DON'T match a live title
    const liveKeys=new Set(prs.map(p=>rnKey(p.title)));
    const pasted=manual?manual.entries.filter(e=>!liveKeys.has(rnKey(e.title))):[];
    const pastedDate=manual?new Date(manual.pastedAt).toLocaleDateString(undefined,{day:'numeric',month:'short'}):'';
    // badge = live PRs plus pasted entries that have no live equivalent — i.e. what is genuinely
    // outstanding, counted once
    setTabN('renovate', prs.length+pasted.length, 'open dependency updates (live PRs + pasted, deduped)');
    const liveRows=prs.map(p=>`<tr><td><b class="name">${esc(p.title)}</b></td><td><a href="${esc(p.url)}" target="_blank" rel="noopener" class="txt-acc">#${esc(p.number)}</a></td><td>${pill(p.state==='OPEN'?'live':p.state==='MERGED'?'part':'plan',String(p.state||'').toLowerCase())}</td><td class="tnum">${ago(p.createdAt)}</td><td>${pill('live','live')}</td></tr>`).join('');
    const pastedRows=pasted.map(e=>`<tr><td><b class="name">${esc(e.title)}</b>${(e.packages&&e.packages.length)||e.targetVersion?`<br><span class="mut t-meta">${esc((e.packages||[]).join(', '))}${e.targetVersion?' → '+esc(e.targetVersion):''}</span>`:''}</td><td class="mut">${e.prNumber?'#'+esc(e.prNumber):'—'}</td><td>${rnStatePill(esc(e.state))}</td><td class="tnum">${ago(manual.pastedAt)}</td><td>${pill('part','pasted '+esc(pastedDate))}</td></tr>`).join('');
    rows.innerHTML=(liveRows+pastedRows)
      ||`<tr><td colspan="5" class="mut">${Array.isArray(d.prs)?'no Renovate PRs yet — the app runs on schedule ('+esc(((d.config||{}).schedule||[]).join('; ')||'see config')+') · paste the Dependency Dashboard above to preview pending updates':'PR query failed'+(failed?' — '+failed:'')}</td></tr>`;
    const db=d.dashboard;
    dash.innerHTML=db
      ?(db.found
        ?((db.items||[]).length
          ?db.items.slice(0,40).map(i=>`<div class="find"><code>${i.checked?'☑':'☐'}</code><span>${esc(i.text)}</span><span class="at">${esc(i.section)}</span></div>`).join('')
          :`<div class="mut">issue #${esc(db.issueNumber)} open — no pending updates listed</div>`)
        :'<div class="mut">Dependency Dashboard issue not opened yet — Renovate runs on its configured schedule</div>')
      :'<div class="mut">unavailable'+(failed?' — failed: '+failed:'')+'</div>';
    const c=d.config;
    cfg.innerHTML=c
      ?[['schedule',(c.schedule||[]).join('; ')||'—'],['limits',`${c.prConcurrentLimit??'—'} concurrent · ${c.prHourlyLimit??'—'}/h`],['vuln alerts',c.vulnerabilityAlerts?'on (any time)':'off']]
        .map(([k,v])=>`<div class="kv"><span class="mut">${k}</span><span>${esc(v)}</span></div>`).join('')
      +(c.groups||[]).map(g=>`<div class="find">${pill('live','group')}<code>${esc(g.group)}</code><span class="at" title="${esc(g.description)}">${esc((g.description||'').slice(0,60))}</span></div>`).join('')
      +(c.gated||[]).map(g=>`<div class="find">${pill('part','gated')}<code>${esc((g.matches||[]).join(' ').replace(/[/^\\$]/g,'').slice(0,48))}</code><span class="at" title="${esc(g.description)}">held — humans execute</span></div>`).join('')
      :'<div class="mut">config unreadable</div>';
    $('rn-foot').innerHTML=`Snapshot via <code>gh</code> SERVER-SIDE (<code>node monitor/renovate-status.mjs</code>) — no token or gh call in this page · config from <code>${esc((c&&c.source)||'renovate.json')}</code>`+((d.errors||[]).length?` · ${(d.errors||[]).length} fetch error(s)`:'')+(manual?` · pasted overlay <code>renovate-manual.json</code> (${manual.entries.length} entr${manual.entries.length===1?'y':'ies'}, ${esc(new Date(manual.pastedAt).toLocaleString())})`:'');
  }catch(e){dash.innerHTML='';cfg.innerHTML='';n.textContent=manual?`no live snapshot · ${manual.entries.length} pasted`:'no data';
    // the live snapshot is missing or unparseable, so the real total is UNKNOWN — badging it with
    // just the pasted count would understate it and read as authoritative. Clear instead.
    setTabN('renovate',null);
    // live snapshot missing/broken — pasted rows still render (paste-ingest works ahead of gh data)
    const pastedDate=manual?new Date(manual.pastedAt).toLocaleDateString(undefined,{day:'numeric',month:'short'}):'';
    const pastedRows=manual?manual.entries.map(x=>`<tr><td><b class="name">${esc(x.title)}</b>${(x.packages&&x.packages.length)||x.targetVersion?`<br><span class="mut t-meta">${esc((x.packages||[]).join(', '))}${x.targetVersion?' → '+esc(x.targetVersion):''}</span>`:''}</td><td class="mut">${x.prNumber?'#'+esc(x.prNumber):'—'}</td><td>${rnStatePill(esc(x.state))}</td><td class="tnum">${ago(manual.pastedAt)}</td><td>${pill('part','pasted '+esc(pastedDate))}</td></tr>`).join(''):'';
    rows.innerHTML=pastedRows||`<tr><td colspan="5" class="mut">no Renovate data — generate with <code>node monitor/renovate-status.mjs</code> (${esc(e.message)})</td></tr>`;}
}
// ── paste-ingest wiring — POST raw text to the server; parsing is SERVER-SIDE only ─────────────
$('rn-ingest').onclick=async()=>{
  const msg=$('rn-paste-msg'),txt=$('rn-ta').value;
  if(!txt.trim()){msg.textContent='nothing to ingest — paste text first';return;}
  msg.textContent='ingesting…';
  try{
    const r=await cwPost('/api/renovate/paste?project='+encodeURIComponent(curProj||''),{headers:{'content-type':'text/plain; charset=utf-8'},body:txt});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){msg.textContent='rejected: '+(d.error||('HTTP '+r.status));return;}
    msg.textContent=`ingested ${d.entries} entr${d.entries===1?'y':'ies'} (${Object.entries(d.states||{}).map(([k,v])=>v+' '+k).join(' · ')})`;
    $('rn-ta').value='';loadRenovate();
  }catch(e){msg.textContent='error: '+e.message;}
};
$('rn-clear').onclick=async()=>{
  const msg=$('rn-paste-msg');msg.textContent='clearing…';
  try{
    const r=await cwPost('/api/renovate/paste/clear?project='+encodeURIComponent(curProj||''));
    const d=await r.json().catch(()=>({}));
    msg.textContent=r.ok?'pasted entries cleared':'clear failed: '+(d.error||('HTTP '+r.status));
    loadRenovate();
  }catch(e){msg.textContent='error: '+e.message;}
};

// ── admin OAuth login (feature e) — feature-gated buttons ─────────────────────────────────────
// The login buttons stay hidden unless the server reports a provider is configured (both client
// id + secret present in env). No client id/secret is referenced here; the buttons just navigate
// to /auth/login/:provider and the server drives the PKCE redirect. /auth/session also reflects
// whether we already hold a session cookie.
// Which passkey a pending revocation names. Module scope, not inside initOauth(): initOauth re-runs
// on every refresh and would otherwise clear the selection between choosing a row and confirming it.
let pkPending=null;
// The last enrolment failure, held outside initOauth() so its reset cannot erase it. See pkFail.
let pkLastError=null;

// ── the account control on the bar ────────────────────────────────────────────────────────────
// THREE STATES, and the third is the one this had none of. `authed` and `!authed` are the two the
// server reports; the third is that we could not ASK — /auth/session refused, the process is down,
// the JSON did not parse. Before this, that case fell through initOauth's `catch(_){return}` and
// the bar kept the markup's default, which is the signed-out shell. So a panel that had lost its
// server displayed a confident "Not signed in", and the identity stamped on every acceptance in
// the ledger was being asserted from an answer nobody had received.
//
// Grey is not green, and it is not red either: unknown gets its own ring and its own sentence,
// and neither of the other two words is used for it.
function setAccount(state, name, sub, tip){
  for(const id of ['acct-av','acct-av2']){
    const av=$(id); if(!av) continue;
    av.className='avatar '+state;
    av.textContent = state==='in' ? (name||'?').trim().charAt(0).toUpperCase() : (state==='unk'?'?':'·');
  }
  const n=$('acct-name'); if(n) n.textContent=name;
  const w=$('acct-who');  if(w) w.textContent=name;
  const s2=$('acct-sub'); if(s2) s2.textContent=sub;
  const b=$('menubtn');   if(b) b.title=tip;
}
async function initOauth(){
  let s;
  try{ s=await (await fetch('/auth/session')).json(); }
  catch(e){
    setAccount('unk','session unknown','/auth/session did not answer — this is not a signed-out panel, it is a panel that cannot see',
      'the panel could not read /auth/session ('+e.message+'). Nothing here says whether you hold a session; it says nobody asked and got an answer.');
    return;
  }
  const wrap=$('oauth');
  if(!s||!wrap){
    setAccount('unk','session unknown','/auth/session answered something this cannot read',
      'the session endpoint answered, but not with a session — treat the identity below as unestablished');
    return;
  }
  if(s.authed){
    setAccount('in', s.user||'signed in', 'signed in'+(s.provider?' with '+s.provider:''),
      'signed in as '+(s.user||'(no name reported)')+(s.provider?' · '+s.provider:'')+' — this is the `who` stamped on every acceptance you make here');
  }else{
    setAccount('out', s.local?'local access':'Not signed in',
      s.local?'on the box itself — local access is never gated':'no session cookie is held by this browser',
      s.local?'local access on this machine is never gated, so nothing here is signed'
             :'no active session — acceptances made now carry no signature');
  }
  wrap.style.display='flex';   // always: Log out lives here and must never be hard to find
  for(const p of ['google','github']){
    const btn=$('login-'+p); if(!btn) continue;
    // HIDDEN unless the button can actually succeed. Configured is not enough: on the published
    // port every request is external by definition, so with external sign-in OFF the flow ends in a
    // refusal AFTER the user has granted Google access to an account. Absent beats disabled.
    const cfg = s.providers && s.providers[p] && s.providers[p].configured;
    btn.style.display = (cfg && s.externalSso && !s.authed) ? 'inline-block' : 'none';
    btn.onclick = ()=>{ location.href='/auth/login/'+p; };
  }
  const who=$('oauth-who'), out=$('logout');
  if(s.authed){
    if(who){ who.textContent=(s.user? s.user+' · ':'signed in · ')+(s.provider||''); who.style.display='inline'; }
  } else if(who) who.style.display='none';
  // Log out is ALWAYS present. On the operator port there is no session to end, so it says so
  // rather than vanishing — a control that disappears reads as a bug, and "you are not signed in"
  // is itself the answer someone opening this menu is looking for.
  if(out){
    out.textContent = s.authed ? 'Log out' : 'Not signed in';
    out.disabled = !s.authed;
    out.title = s.authed ? 'log out' : (s.local ? 'local access on this machine is never gated' : 'no active session');
    // LOG OUT MUST EITHER END THE SESSION OR SAY IT DID NOT.
    // The first cut was `try{ await cwPost('/auth/logout'); }catch(_){ } initOauth();` — a bare
    // catch that swallowed the failure, a response whose status was never read, and a re-render
    // that ran either way. So a logout that failed (a rotated CSRF token after a server restart,
    // a dropped connection, a 401) looked exactly like one that worked: the menu redrew, the
    // session survived, and nothing said so. That is this panel's own false-clean shape on the one
    // control that must never be ambiguous.
    // On success we RELOAD rather than re-render: the auth gate serves the login page to an
    // unauthenticated request, so a reload lands there and the operator can see they are out
    // instead of being told.
    out.onclick = s.authed ? async()=>{
      out.disabled = true; out.textContent = 'Logging out…';
      let r = null, err = null;
      try { r = await cwPost('/auth/logout'); } catch(e){ err = e; }
      if (r && r.ok) { location.reload(); return; }
      // Failure is SAID, in the control the operator is looking at, and the button goes back to
      // being usable so a retry is possible. `initOauth()` alone would have quietly restored a
      // "Log out" button and left the reader to guess.
      out.disabled = false;
      out.textContent = 'Log out — FAILED';
      out.title = err ? ('could not reach the panel: ' + err.message + ' — you are still signed in')
                      : ('the panel refused the logout (HTTP ' + (r ? r.status : '?') + ') — you are still signed in');
      if (who) { who.textContent = 'still signed in — logout failed'; who.style.display = 'inline'; }
    } : null;
  }
  // ── RE-AUTHENTICATION AND PASSWORD ──────────────────────────────────────────────────────────
  // Both blocks render from s.factors, which is three-valued: null means the panel could not
  // establish what the account holds, and that is not "no factors". An unknown renders as unknown.
  const F = s.factors || null;
  const fresh = !!s.reauthFresh;
  const provider = F && F.sso ? F.sso : (s.provider && s.provider !== 'password' && s.provider !== 'passkey' ? s.provider : null);

  // Re-auth: offered in the form the ACCOUNT can satisfy. A password field for an account with a
  // password; a provider bounce for one without. Offering the wrong one is this whole defect.
  const raBox=$('reauth'), raWhy=$('reauth-why'), raRow=$('reauth-pw-row'),
        raGo=$('reauth-go'), raSso=$('reauth-sso'), raMsg=$('reauth-msg');
  if(raBox){
    const need = s.authed && F && !fresh;
    raBox.classList.toggle('jshide', !need);
    if(need){
      if(raWhy) raWhy.textContent = F.hasPassword
        ? 'Adding or removing a sign-in method re-authenticates the account. This is your commitwork password — not your Mac login.'
        : (provider ? `This account signs in with ${provider} and has no password, so ${provider} is what verifies you.`
                    : 'This account has no password and no provider bound, so nothing here can verify you. Use bin/panel-breakglass.mjs on the box.');
      if(raRow) raRow.classList.toggle('jshide', !F.hasPassword);
      if(raGo)  raGo.classList.toggle('jshide', !F.hasPassword);
      if(raSso){
        raSso.classList.toggle('jshide', !!F.hasPassword || !provider);
        raSso.textContent = provider ? `Verify with ${provider}` : '';
        // prompt=login is added server-side on ?reauth=1 so the provider re-challenges rather than
        // bouncing a live IdP session straight back, which would prove nothing.
        raSso.onclick = () => { location.href='/auth/login/'+encodeURIComponent(provider)
          +'?reauth=1&return='+encodeURIComponent(location.pathname+location.search); };
      }
    } else if(raMsg && fresh){
      raMsg.className='mut ok'; raMsg.textContent='verified — expires in '+Math.round((s.reauthTtlSecs||300)/60)+' min';
      raMsg.classList.remove('jshide');
    }
  }
  if(raGo) raGo.onclick=async()=>{
    const pw=($('reauth-pw')||{}).value||'';
    if(!pw){ if(raMsg){raMsg.className='mut bad';raMsg.textContent='enter your password';raMsg.classList.remove('jshide');} return; }
    raGo.disabled=true; const was=raGo.textContent; raGo.textContent='verifying…';
    try{
      const r=await cwPost('/auth/reauth/password',{headers:{'content-type':'application/json'},body:JSON.stringify({password:pw})});
      const j=await r.json();
      if(!r.ok||!j.ok) throw new Error(j.error||('verification failed (HTTP '+r.status+')'));
      if($('reauth-pw')) $('reauth-pw').value='';
      raGo.disabled=false; raGo.textContent=was;
      await initOauth();
    }catch(e){
      if(raMsg){raMsg.className='mut bad';raMsg.textContent=e.message;raMsg.classList.remove('jshide');}
      raGo.disabled=false; raGo.textContent=was;
    }
  };

  // Password. THREE STATES, and "no password" is a real one rather than an empty field.
  const pwBox=$('pwblock'), pwDot=$('pw-dot'), pwState=$('pw-state'), pwCurRow=$('pw-cur-row'),
        pwGo=$('pw-go'), pwMsg=$('pw-msg'), pwCodes=$('pw-codes');
  if(pwBox){
    pwBox.classList.toggle('jshide', !s.authed || !F);
    if(F && pwDot && pwState){
      pwDot.className = 'pk-dot ' + (F.hasPassword ? 'on' : 'none');
      pwState.textContent = F.hasPassword
        ? 'a password is set' + (F.recoveryRemaining!=null ? ' · '+F.recoveryRemaining+' recovery code(s) unused' : '')
        : 'no password set' + (provider ? ' — this account signs in with '+provider : '');
      if(pwGo) pwGo.textContent = F.hasPassword ? 'change password' : 'set password';
      // The current password is only asked for when it is the ONLY proof available. A fresh
      // re-auth already established it, and asking twice for the same fact is friction, not rigour.
      if(pwCurRow) pwCurRow.classList.toggle('jshide', !F.hasPassword || fresh);
    }
    if(pwCodes) pwCodes.classList.add('jshide');
    if(pwMsg){ pwMsg.classList.add('jshide'); pwMsg.textContent=''; }
  }
  if(pwGo) pwGo.onclick=async()=>{
    const np=($('pw-new')||{}).value||'', cur=($('pw-cur')||{}).value||'';
    const say=(cls,t)=>{ if(!pwMsg)return; pwMsg.className='mut '+cls; pwMsg.textContent=t; pwMsg.classList.remove('jshide'); };
    if(np.length<12) return say('bad','12 characters or more — the server enforces this too');
    pwGo.disabled=true; const was=pwGo.textContent; pwGo.textContent='saving…';
    try{
      const r=await cwPost('/auth/password/set',{headers:{'content-type':'application/json'},
        body:JSON.stringify({current:cur||undefined,newPassword:np})});
      const j=await r.json();
      if(!r.ok||!j.ok) throw new Error(j.error||('the panel refused it (HTTP '+r.status+')'));
      if($('pw-new')) $('pw-new').value=''; if($('pw-cur')) $('pw-cur').value='';
      pwGo.disabled=false; pwGo.textContent=was;
      // SHOW THE CODES BEFORE ANYTHING ELSE, and do NOT re-render first: initOauth() clears this
      // block, and these bytes exist nowhere else. Same ordering rule as the enrolment confirmation.
      const codes=(j.recovery||[]).join('\n');
      if(codes && pwCodes && $('pw-codes-list')){
        $('pw-codes-list').textContent=codes; pwCodes.classList.remove('jshide');
      }
      say('ok', (j.replaced?'password changed':'password set')+' — you can now use it to verify yourself here.');
    }catch(e){
      say('bad', e.message); pwGo.disabled=false; pwGo.textContent=was;
    }
  };

  // ── PASSKEY ENROLMENT ───────────────────────────────────────────────────────────────────────
  // The server has answered register/begin and register/finish since passkeys were added; this is
  // the client half, which was never written — so the ceremony existed and no operator could reach
  // it, and the fleet stayed on weaker factors by default. Nothing below changes the server.
  //
  // SHOWN ONLY WHEN IT CAN SUCCEED, on the same reasoning as the Google/GitHub buttons above:
  // enrolment binds an authenticator to an ACCOUNT, so with nobody signed in there is nothing to
  // bind to. The hostname condition cannot be evaluated here — rpFor() resolves it server-side
  // against the declared-hostname allowlist — so that one refusal is surfaced with the server's own
  // message rather than guessed at, which is also the only message that names the fix.
  const pkWrap=$('pkenroll'), pkAdd=$('pk-add'), pkForm=$('pk-form'), pkGo=$('pk-go'),
        pkCancel=$('pk-cancel'), pkPass=$('pk-pass'), pkLabel=$('pk-label'), pkMsg=$('pk-msg');
  const hasWebAuthn = !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
  if(pkWrap){
    pkWrap.style.display = (s.authed && hasWebAuthn) ? 'flex' : 'none';
    if(pkForm) pkForm.style.display='none';
    if(pkMsg){ pkMsg.style.display='none'; pkMsg.textContent=''; }
  }
  const pkSay=(cls,text)=>{ if(!pkMsg)return; pkMsg.className='mut '+cls; pkMsg.textContent=text; pkMsg.style.display='block'; };
  // STICKY. initOauth() clears #pk-msg and closes the form on every entry, and it re-runs on its
  // own — so an error written the normal way lived until the next refresh and then vanished,
  // taking the only account of the failure with it. pkLastError is module-scope (see the
  // declaration beside pkPending) and is re-rendered by every initOauth pass, so the statement
  // outlives the thing that erased it. Cleared only by a NEW attempt or by the operator.
  const pkFail=(text)=>{
    pkLastError = text || null;
    const box=$('pk-err'), t=$('pk-err-txt');
    if(t) t.textContent = text || '';
    if(box) box.classList.toggle('jshide', !text);
  };
  pkFail(pkLastError);          // survive this pass
  const x=$('pk-err-x'); if(x) x.onclick=()=>pkFail(null);

  // ── WHAT IS ALREADY ENROLLED ────────────────────────────────────────────────────────────────
  // Three states, and they were previously one. `null` is not established — nobody signed in, or
  // the store did not read; `[]` is signed in with none; a list is a list. Rendering the first two
  // the same way is what made a successful enrolment invisible and turned the control into a loop.
  // Second factor, from the state /auth/session now returns. Three answers, never two: the field
  // being ABSENT is unknown (the panel was not told), false is a real "no", and enrolled-but-
  // unconfirmed is its own thing rather than a rounding of either neighbour.
  const tDot=$('totp-state')&&$('totp-state').querySelector('.pk-dot'), tTxt=$('totp-state-txt');
  if(tDot&&tTxt){
    const enrolled = ('totpEnrolled' in s) ? !!s.totpEnrolled : null;
    const confirmed = ('totpConfirmed' in s) ? !!s.totpConfirmed : null;
    if(enrolled===null||confirmed===null){
      tDot.className='pk-dot unk';
      tTxt.textContent='second-factor state unknown — the panel did not get an answer it could read';
    }else if(confirmed){
      tDot.className='pk-dot on';
      tTxt.textContent='authenticator enrolled and enforced at sign-in';
    }else if(enrolled){
      tDot.className='pk-dot part';
      tTxt.textContent='authenticator enrolled but never confirmed — enforcement is off';
    }else{
      tDot.className='pk-dot none';
      tTxt.textContent='no second factor — this account signs in with its password alone';
    }
  }
  const pkState=$('pk-state'), pkStateTxt=$('pk-state-txt'), pkList=$('pk-list');
  const pkDot=pkState&&pkState.querySelector('.pk-dot');
  const known = Array.isArray(s.passkeys) ? s.passkeys : null;
  if(pkStateTxt&&pkDot){
    if(known===null){
      pkDot.className='pk-dot unk';
      pkStateTxt.textContent='passkey state unknown — the panel did not get an answer it could read';
    }else if(known.length===0){
      pkDot.className='pk-dot none';
      pkStateTxt.textContent='no passkeys enrolled — this account signs in with a password';
    }else{
      pkDot.className='pk-dot on';
      pkStateTxt.textContent=known.length+' passkey'+(known.length===1?'':'s')+' enrolled';
    }
  }
  if(pkList){
    if(known&&known.length){
      pkList.classList.remove('jshide');
      pkList.innerHTML=known.map((p)=>{
        const when=p.addedAt?AGO(Date.now()-new Date(p.addedAt).getTime())+' ago':'added at an unrecorded time';
        // lastUsedAt null is NEVER "unused" — a passkey enrolled before that field was written
        // would be indistinguishable from one that has never signed anybody in.
        const used=p.lastUsedAt?('last used '+AGO(Date.now()-new Date(p.lastUsedAt).getTime())+' ago')
                               :'no recorded use';
        return '<li><b>'+esc(p.label)+'</b><span class="mut"> · '+esc(when)+' · '+esc(used)+'</span>'
          +'<button type="button" class="pk-rm" data-cid="'+esc(p.credentialId)+'" data-label="'+esc(p.label)
          +'" title="remove this passkey — asks for your password, and the server refuses if it is the last way into the account">remove</button></li>';
      }).join('');
      // Revoking names ONE credential, so the pending id is held here rather than read back out of
      // the row at confirm time — a re-render between the two clicks would otherwise revoke
      // whichever row had moved into that position.
      pkList.querySelectorAll('.pk-rm').forEach((b)=>{ b.onclick=()=>{
        pkPending={cid:b.dataset.cid,label:b.dataset.label};
        const w=$('pk-revoke-what'); if(w) w.textContent='removing “'+pkPending.label+'”';
        const box=$('pk-revoke'); if(box) box.classList.remove('jshide');
        const f=$('pk-revoke-pass'); if(f){ f.value=''; f.focus(); }
        if(pkMsg){ pkMsg.style.display='none'; pkMsg.textContent=''; }
      }; });
    }else{
      pkList.classList.add('jshide');
      pkList.innerHTML='';
    }
  }
  const pkRevBox=$('pk-revoke'), pkRevPass=$('pk-revoke-pass'), pkRevGo=$('pk-revoke-go'), pkRevCancel=$('pk-revoke-cancel');
  if(pkRevBox) pkRevBox.classList.add('jshide');
  if(pkRevCancel) pkRevCancel.onclick=()=>{
    pkPending=null;
    if(pkRevBox) pkRevBox.classList.add('jshide');
    if(pkRevPass) pkRevPass.value='';
  };
  if(pkRevGo) pkRevGo.onclick=async()=>{
    if(!pkPending){ pkSay('bad','nothing selected to remove'); return; }
    const pass=(pkRevPass&&pkRevPass.value)||'';
    if(!pass&&!fresh){ pkSay('bad','enter your password or use “Verify it is you” — removing an authenticator re-authenticates the account'); return; }
    pkRevGo.disabled=true; const wasR=pkRevGo.textContent; pkRevGo.textContent='removing…';
    try{
      const r=await cwPost('/auth/passkey/revoke',{headers:{'content-type':'application/json'},
        body:JSON.stringify({email:s.user||'',credentialId:pkPending.cid,password:pass})});
      const j=await r.json();
      // The server refuses to remove the last way into an account. That refusal is a RESULT, not an
      // error to swallow — it is the sentence that stops an operator locking themselves out.
      if(!r.ok||!j.ok) throw new Error(j.error||j.reason||('the panel refused the removal (HTTP '+r.status+')'));
      const gone=pkPending.label;
      pkPending=null;
      if(pkRevPass) pkRevPass.value='';
      pkRevGo.disabled=false; pkRevGo.textContent=wasR;
      await initOauth();       // same ordering rule as enrolment: refresh first, then speak
      pkSay('ok','removed “'+gone+'”. It can no longer sign in to this account.');
    }catch(e){
      pkSay('bad',e.message||'removal failed');
      pkRevGo.disabled=false; pkRevGo.textContent=wasR;
    }
  };
  // The offer names what it is doing. "Add a passkey" beside two enrolled passkeys is the sentence
  // that made the operator think the last one had not taken.
  if(pkAdd) pkAdd.textContent = (known&&known.length) ? 'Add another passkey' : 'Add a passkey';

  // ── CAN THIS CEREMONY SUCCEED AT ALL? ───────────────────────────────────────────────────────
  // Answered BEFORE the password is asked for and before a system prompt appears, because every
  // one of these conditions is knowable in advance and each one previously surfaced as the same
  // DOMException at the last possible moment.
  //
  // A WebAuthn RP ID IS A DOMAIN. The server derives it from the Host (rpFor in rp-origin.mjs), so
  // opening this panel at http://127.0.0.1:7878 makes the RP ID the IP literal `127.0.0.1`, and an
  // IP address is not a domain name — there is no registrable domain for the browser to match it
  // against. `localhost` IS a domain, is a secure context without TLS, and this same process is
  // already listening on it: the fix is the URL in the address bar, not the code, and no message
  // anywhere said so.
  const isIpHost=(h)=>/^\d{1,3}(\.\d{1,3}){3}$/.test(h)||/^\[?[0-9a-f:]+\]?$/i.test(h)&&h.includes(':');
  function pkBlocker(){
    if(!window.isSecureContext)
      return 'this page is not a secure context, and WebAuthn is refused outright in one. Open the panel over https, or on http://localhost.';
    if(isIpHost(location.hostname))
      return 'passkeys are bound to a DOMAIN and this page is open at the IP address '+location.hostname
        +'. Nothing here can fix that — the address bar can: open http://localhost:'+(s.port||location.port||'7878')
        +' instead'+((s.declaredHosts||[]).length?', or https://'+s.declaredHosts[0]:'')+' and enrol there.';
    if(s.rpId&&s.rpId!==location.hostname&&!location.hostname.endsWith('.'+s.rpId))
      return 'the panel calls itself "'+s.rpId+'" but this page is open at "'+location.hostname
        +'". A passkey enrolled now could not be used to sign in here.';
    if(s.rpId===null||s.rpId===undefined)
      return 'this panel does not answer to "'+location.hostname+'" — passkeys are bound to a declared hostname'
        +((s.declaredHosts||[]).length?' ('+s.declaredHosts.join(', ')+')':', and none is declared')+'.';
    return null;
  }
  if(pkAdd) pkAdd.onclick=()=>{
    // THE PRE-FLIGHT WARNS. IT NO LONGER VETOES, and that is a correction of my own reasoning
    // rather than a relaxation.
    //
    // It used to `return` on any pkBlocker() finding, so pressing enrol at an IP-literal origin
    // failed WITHOUT the fingerprint prompt ever appearing. The justification was that refusing
    // early beats failing at the system dialog — which sounds right and was wrong here, because
    // the refusal encoded MY INFERENCE about what a browser will accept, not a measurement. I never
    // observed a browser reject an IP-literal RP ID; I reasoned that it would. The veto then
    // prevented the one experiment that could have settled it, so a guess about the platform became
    // an unfalsifiable rule inside our own code.
    //
    // The platform is the authority on what the platform accepts. Let the ceremony run: if the
    // browser refuses, the catch below names the real DOMException, which is better evidence than
    // anything asserted here — and if it succeeds, the pre-flight was simply wrong and we find out
    // in the only way that counts.
    const warn=pkBlocker(), w=$('pk-warn');
    if(w){
      w.textContent = warn ? ('Heads up — '+warn+' Trying anyway; the browser decides.') : '';
      w.classList.toggle('jshide', !warn);
    }
    // THE PASSWORD FIELD IS OFFERED ONLY WHEN IT CAN BE SATISFIED. An account with no password
    // cannot fill it, and a fresh re-auth has already proven the same fact — asking again is
    // friction pretending to be rigour. Where neither applies, the operator is pointed at the
    // Verify block rather than left staring at a field that will always be rejected.
    const canPw = !!(F && F.hasPassword) && !fresh;
    const pwRow = pkPass && pkPass.closest ? pkPass.closest('.pk-fld') : null;
    if(pwRow) pwRow.style.display = canPw ? '' : 'none';
    if(!canPw && !fresh && w){
      w.textContent = (F && !F.hasPassword)
        ? 'This account has no password. Use "Verify it is you" above first — enrolment re-authenticates.'
        : 'Verify it is you above first — enrolment re-authenticates.';
      w.classList.remove('jshide');
    }
    if(pkForm) pkForm.style.display='block';
    pkAdd.style.display='none';
    if(canPw && pkPass) pkPass.focus(); else if($('pk-label')) $('pk-label').focus();
  };
  if(pkCancel) pkCancel.onclick=()=>{
    if(pkForm) pkForm.style.display='none';
    if(pkAdd) pkAdd.style.display='inline-block';
    if(pkPass) pkPass.value='';
    if(pkMsg){ pkMsg.style.display='none'; pkMsg.textContent=''; }
  };
  // base64url for what the SERVER sent, plain base64 for what we send BACK — the server reads the
  // response fields with Buffer.from(x,'base64'). Mixing them fails only on inputs containing + or
  // /, i.e. intermittently and on about a quarter of random challenges, which is the worst possible
  // failure schedule. Same pair, same reason, as the login page's ceremony.
  const pkB64uToBuf=(x)=>{ const t=String(x).replace(/-/g,'+').replace(/_/g,'/'); const pad=t+'='.repeat((4-t.length%4)%4);
    const bin=atob(pad); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); return u.buffer; };
  const pkBufToB64=(b)=>{ const u=new Uint8Array(b); let s2=''; for(let i=0;i<u.length;i++)s2+=String.fromCharCode(u[i]); return btoa(s2); };
  if(pkGo) pkGo.onclick=async()=>{
    const pass=(pkPass&&pkPass.value)||'';
    const label=((pkLabel&&pkLabel.value)||'').trim();
    const roaming=!!($('pk-roaming')&&$('pk-roaming').checked);
    pkFail(null);                 // a new attempt clears the last account of the old one
    // Only insist on a password when one was actually asked for. With a fresh re-auth, or on an
    // account that has none, the server accepts the marker instead — refusing here would reimpose
    // the exact wall this whole change removes.
    const needPw = !!(F && F.hasPassword) && !fresh;
    if(needPw && !pass){ pkSay('bad','enter your password — adding an authenticator re-authenticates the account'); return; }
    // Re-checked at the point of action, and again only to WARN. The ceremony runs regardless:
    // whatever the pre-flight believes, credentials.create() is the thing that actually knows.
    const warn2=pkBlocker();
    if(warn2) pkSay('', 'Heads up — '+warn2+' Asking your authenticator anyway.');
    pkGo.disabled=true; const was=pkGo.textContent; pkGo.textContent='waiting for your passkey…';
    // Declared OUT here, not inside the try: the catch below names the relying party the server
    // actually issued, and a `const` in the try block is invisible to it — referencing it there
    // throws a ReferenceError from inside the error handler, which loses the real error.
    let j1=null;
    try{
      // register/begin takes email + password. `s.user` is the signed-in address the server itself
      // reported, so the account being extended is never typed and never guessed.
      const r1=await cwPost('/auth/passkey/register/begin',{headers:{'content-type':'application/json'},
        body:JSON.stringify({email:s.user||'',password:pass})});
      j1=await r1.json();
      if(!r1.ok||!j1.ok){
        // 401 here is 'invalid credentials' — the PASSWORD, not the session. It no longer reloads
        // the page (see AUTH_401_EXEMPT), so the reason can finally be shown to the person who
        // typed it. Named explicitly because "refused to start enrolment" describes the symptom.
        const why = r1.status===401
          ? 'That password was not accepted. Enrolment re-authenticates the account, so this is the password for '+(s.user||'this account')+' — not your Mac login and not a passkey.'
          : (j1.error||('the panel refused to start enrolment (HTTP '+r1.status+')'));
        throw new Error(why);
      }
      const pub={
        challenge:pkB64uToBuf(j1.challenge),
        rp:{id:j1.rpId,name:'commitwork'},
        user:{id:pkB64uToBuf(j1.user.id),name:j1.user.name,displayName:j1.user.displayName},
        // ES256 then RS256 — the two every platform authenticator and security key in use supports.
        pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
        // THE ATTACHMENT IS STATED. Unset, this was `{residentKey:'preferred',
        // userVerification:'preferred'}` and nothing else — no authenticatorAttachment at all — so
        // the browser opened its generic chooser and was free to lead with a phone and a QR code.
        // On this box that is the difference between being asked for a fingerprint and never being
        // offered one. 'platform' names the built-in authenticator; the checkbox is how an operator
        // asks for the other kind, rather than the browser guessing which they meant.
        // userVerification 'required' for the same reason: a platform credential enrolled without
        // it can be one that never asked for the biometric at all.
        authenticatorSelection: roaming
          ? {authenticatorAttachment:'cross-platform',residentKey:'preferred',userVerification:'preferred'}
          // residentKey 'discouraged', NOT 'preferred', and this is a HYPOTHESIS I cannot test from
          // here — stated as one rather than asserted. A DISCOVERABLE credential is what a synced
          // password manager wants, so asking for one invites Chrome to route the ceremony to
          // Google Password Manager instead of the machine's own authenticator, which is exactly
          // what the operator saw. Discouraging it asks for a credential that lives on this device
          // and is looked up by id — the shape the platform keychain serves.
          // I have been wrong twice already about what a browser will do (the IP-literal RP ID did
          // NOT block anything), so if this still lands in a password manager the lever is the
          // BROWSER, not this dictionary: Safari on macOS drives Touch ID directly.
          : {authenticatorAttachment:'platform',residentKey:'discouraged',userVerification:'required'},
        timeout:120000,   // 60s is short for "find your security key, plug it in, touch it"
      };
      // Sent by the server so the browser refuses to enrol the same authenticator twice — a
      // duplicate is not a hole, but it makes two rows the operator cannot tell apart.
      if((j1.excludeCredentials||[]).length) pub.excludeCredentials=j1.excludeCredentials.map((id)=>({type:'public-key',id:pkB64uToBuf(id)}));
      const c=await navigator.credentials.create({publicKey:pub});
      if(!c) throw new Error('no credential was returned');
      const r2=await cwPost('/auth/passkey/register/finish',{headers:{'content-type':'application/json'},
        body:JSON.stringify({challengeId:j1.challengeId,label:label||'passkey',
          clientDataJSON:pkBufToB64(c.response.clientDataJSON),
          attestationObject:pkBufToB64(c.response.attestationObject)})});
      const j2=await r2.json();
      if(!r2.ok||!j2.ok) throw new Error(j2.error||j2.reason||('that passkey was not accepted (HTTP '+r2.status+')'));
      if(pkForm) pkForm.style.display='none';
      if(pkPass) pkPass.value='';
      if(pkLabel) pkLabel.value='';
      // RE-READ THE SESSION, THEN SPEAK. Without the refresh the enrolled list above still shows
      // what was true before the ceremony, so the one moment the operator most needs the panel to
      // say "yes, it took" is the moment it repeats what it said before — which is the loop they
      // described. AWAITED, and the success line said AFTER it, because initOauth() clears #pk-msg
      // on its way through: saying it first would have the refresh erase the confirmation and
      // reproduce the same silence by a new route.
      pkGo.disabled=false; pkGo.textContent=was;
      await initOauth();
      pkSay('ok','passkey enrolled'+(label?' — '+label:'')+'. You can sign in with it from the login page.');
      return;
    }catch(err){
      // EVERY FAILURE IS NAMED. This was `err.message||'enrolment failed'` — and a DOMException from
      // credentials.create() frequently carries an empty or boilerplate message, so the operator
      // got the words "enrolment failed" for six conditions with six different fixes, one of which
      // is "you already did this" and another of which is "change the URL". A control that cannot
      // say why it refused is indistinguishable from one that is broken, which is what "the enrol
      // button is dodgy" means.
      const n = (err&&err.name)||'';
      let msg;
      if(n==='NotAllowedError'||n==='AbortError')
        // Dismissing the prompt is a cancellation, not a rejected credential — saying "not
        // accepted" would tell the operator their authenticator is broken when they changed their
        // mind. It is ALSO what a timeout looks like, so both are named rather than one guessed.
        msg='Enrolment cancelled or timed out — nothing was added. Nothing is wrong with your authenticator.';
      else if(n==='InvalidStateError')
        msg='This authenticator is already enrolled on this account'
          +((known&&known.length)?' (as '+known.map((p)=>p.label).join(', ')+')':'')
          +'. Nothing was changed — you are already able to sign in with it.';
      else if(n==='SecurityError')
        msg='The browser refused the relying party "'+(j1&&j1.rpId||s.rpId||'?')+'" for this page ('+location.origin+'). '
          +'A passkey is bound to a DOMAIN, and an IP address is not one — open the panel at '
          +'http://localhost:'+(s.port||location.port||'7878')
          +((s.declaredHosts||[]).length?' or https://'+s.declaredHosts[0]:'')+' and enrol there.';
      else if(n==='NotSupportedError')
        msg='No authenticator here supports the key types this panel asks for (ES256 or RS256)'
          +(roaming?'.':'. Try ticking "use a security key or a phone" — the built-in one may not be available.');
      else if(n==='ConstraintError')
        msg='The authenticator could not satisfy what was asked of it — most often a device with no '
          +'biometric or PIN set up, since enrolment here requires user verification.';
      else
        // The unknown case CARRIES THE EXCEPTION NAME. A message with no name in it is a failure
        // nobody can act on and nobody can report; this is the difference between one more attempt
        // and one more attempt that teaches something.
        msg=(n?n+': ':'')+(err&&err.message?err.message:'enrolment failed')
          +' — nothing was added.';
      // Both: the sticky box beside the fingerprint (which survives a refresh) AND the menu line.
      pkFail(msg);
      pkSay((n==='NotAllowedError'||n==='AbortError')?'':'bad', msg);
      // The form STAYS OPEN and the add button stays hidden: every one of these is retryable in
      // place (or dismissable with cancel), and re-showing "Add a passkey" beside an open enrolment
      // form is two controls for one act.
      pkGo.disabled=false; pkGo.textContent=was;
      return;
    }
  };

  // Remote sign-in switch — shown only where it can be changed (on the box). The note states which
  // of the three states the panel is in, because "no operator yet" and "operator bound, remote off"
  // look identical from a login form otherwise.
  const ext=$('ssoext'), cb=$('sso-external'), note=$('sso-note');
  if(ext&&cb){
    ext.style.display = s.canSetExternalSso ? 'flex' : 'none';
    if(s.canSetExternalSso){
      cb.checked = !!s.externalSso;
      // the ticked box is store truth, but remote sign-in ALSO needs the server env gate —
      // an operator who only sees the tick has no way to know why remote login shows no Google
      if(s.externalSso && s.liveExchange === false && note){
        note.textContent='on, but this server runs without CW_OAUTH_LIVE_EXCHANGE=1 — the login page will not offer Google until it is relaunched with it';
        note.style.display='block';
      }
      cb.onchange=async()=>{
        const want=cb.checked;
        let r;
        // cwPost returns the response rather than throwing, so a refusal must be read off r.ok —
        // otherwise the box would show ticked while the server still refuses remote sign-in.
        try{
          r=await cwPost('/auth/sso/external',{headers:{'content-type':'application/json'},body:JSON.stringify({enabled:want})});
        }catch(e){ cb.checked=!want; if(note){note.textContent='could not reach the server';note.style.display='block';} return; }
        if(!r.ok){
          const j=await r.json().catch(()=>({}));
          cb.checked=!want; if(note){note.textContent=j.error||('refused ('+r.status+')');note.style.display='block';} return;
        }
        initOauth();
      };
    }
  }
}
// Exposure — the deployment surface joined to what each area's rollup says is unpatched.
// Deliberately does NOT filter by the project picker: exposure is a property of the box, and
// showing only the selected project's hostnames would hide the very thing this view exists to
// surface — a hostname no area declares at all.
async function loadExposure(){
  const tb=$('exp-rows'), kp=$('exp-kpis'), dr=$('exp-drift'), ft=$('exp-foot'), n=$('expn');
  tb.innerHTML='<tr><td colspan="8" class="mut">probing DNS and origins…</td></tr>';
  let d;
  // SCOPED TO THE SELECTED PROJECT by default. The scope is applied on the SERVER (which owns the
  // predicates behind the totals), so the KPI row and the table can never describe different sets.
  // With the box-wide box ticked, or with no project selected, the parameter is omitted and the
  // route answers for every hostname — which is also the only way undeclared hostnames are visible,
  // since they belong to no project.
  const wide=$('exp-scope')&&$('exp-scope').checked;
  const q=(!wide&&curProj)?('?project='+encodeURIComponent(curProj)):'';
  try{ d=await (await fetch('/api/exposure'+q)).json(); }
  // a failed probe is UNKNOWN exposure, so the badge clears rather than settling on zero
  catch(e){ tb.innerHTML='<tr><td colspan="8"><div class="pk-err">could not reach the server — exposure is UNKNOWN, not zero</div></td></tr>'; setTabN('exposure',null); return; }
  if(!d.ok){ tb.innerHTML=`<tr><td colspan="8" class="mut">${esc(d.error||'exposure unavailable')}</td></tr>`; kp.innerHTML=''; setTabN('exposure',null); return; }
  const t=d.totals||{};
  // the badge counts what is reachable AND unpatched — the subset that is actually actionable,
  // not every published hostname
  setTabN('exposure', typeof t.withFindings==='number'?t.withFindings:null, 'reachable hosts carrying unpatched findings');
  kp.innerHTML=[
    [t.drifted?'bad':'good','Drifted',t.drifted??0,'declaration ≠ applied'],
    ['', 'Published', t.published??0, 'public or undeclared hostnames'],
    [t.reachable?'warn':'', 'Reachable now', t.reachable??0, 'dns resolves + origin listening'],
    [t.withFindings?'bad':'good','With unpatched', t.withFindings??0,'reachable AND carrying findings'],
    [t.unscanned?'warn':'', 'Not scanned', t.unscanned??0,'no rollup — not the same as clean'],
  ].map(([c,k,v,s])=>`<div class="kpi ${c}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${esc(s)}</div></div>`).join('');

  const pill=(w)=>{
    if(w==='not-scanned')return '<span class="pill plan">not scanned</span>';
    if(w==='unmapped')return '<span class="pill plan">unmapped</span>';
    if(w==='none')return '<span class="pill live">none</span>';
    return `<span class="pill ${w==='crit'?'crit':'high'}">${esc(w)}</span>`;
  };
  const yn=(v)=>v===null?'<span class="mut">—</span>':(v?'yes':'<b class="txt-crit">no</b>');
  tb.innerHTML=(d.rows||[]).map(r=>{
    const reachable = r.dns===true && r.origin!==false;
    const f=r.findings||{};
    // age sits WITH the number, never apart from it: a count without its age reads as current, and
    // nothing is scheduled on this box, so every rollup ages indefinitely
    const age = r.ageHours==null ? '' : (r.ageHours<1 ? 'just now' : r.ageHours<48 ? `${r.ageHours}h old` : `${Math.round(r.ageHours/24)}d old`);
    const counts = r.scanned
      ? `${f.crit||0}<span class="u">C</span> ${f.high||0}<span class="u">H</span> ${f.med||0}<span class="u">M</span>${f.kev?` · ${f.kev} KEV`:''}`
        + (age?`<div class="mut t-meta">${r.stale?'<b class="txt-part">':''}${esc(age)}${r.stale?'</b>':''}</div>`:'')
      : '<span class="mut">—</span>';
    const fix = (r.topFixable||[]).slice(0,3).map(x=>esc(x.package||x.id||'')).join(', ');
    return `<tr>
      <td><b class="name">${esc(r.hostname)}</b>${fix?`<div class="mut t-meta">${fix}</div>`:''}</td>
      <td>${r.area?esc(r.area):'<span class="mut">undeclared</span>'}</td>
      <td>${esc(r.declared)}${r.requiresAuth?' <span class="mut">(auth)</span>':''}</td>
      <td class="mut t-note">${r.service?esc(r.service):'—'}</td>
      <td>${yn(r.dns)}</td>
      <td>${r.origin===null?'<span class="mut">—</span>':(r.origin?(reachable?'yes':'origin up'):'<b class="txt-crit">origin down</b>')}</td>
      <td>${counts} ${pill(r.worst)}</td>
      <td class="mut t-note">${esc(r.state)}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="8" class="mut">no hostnames declared or routed</td></tr>';

  const drift=(d.rows||[]).filter(r=>r.state!=='ok'&&r.state!=='withheld (correct)');
  dr.innerHTML=drift.length?`<div class="card"><h3>Mismatch — the project list does not match this machine</h3>${
    drift.map(r=>`<div class="kv"><span class="mut">${esc(r.hostname)}</span><span>${esc(r.state)}</span></div>`).join('')}</div>`:'';
  const sc=d.scope||{};
  n.textContent=`${(d.rows||[]).length} hostname(s) · ${t.drifted??0} drifted`
    +(sc.area?` · ${sc.area}`:' · every hostname on this box');
  // A NARROWED VIEW MUST NEVER READ AS A COMPLETE ONE. What the scope removed is stated, with the
  // two categories worth acting on called out: hostnames no project declares (which no project
  // scope will ever show) and hostnames whose applied routing disagrees with the registry.
  const hiddenNote = sc.hidden
    ? `<div class="mut gap-top">${sc.hidden} hostname(s) on this box are <b>not shown</b> — scoped to `
      + `${esc(sc.project||sc.area||'this project')}.`
      + (sc.hiddenUndeclared?` ${sc.hiddenUndeclared} of them are <b class="txt-part">declared by no project</b>, so no project view will show them.`:'')
      + (sc.hiddenDrifted?` ${sc.hiddenDrifted} are <b class="txt-crit">drifted</b>.`:'')
      + ` Tick <b>show all hostnames on this box</b> above to see them.</div>`
    : '';
  dr.innerHTML+=hiddenNote;
  ft.innerHTML=`tunnel config <code>${esc(d.configPath||'')}</code> · ${d.declaredCount} declared, ${d.routedCount} routed · probed ${esc(String(d.generated||'').slice(0,19))} · `
    + (sc.area?`scoped to <b>${esc(sc.area)}</b>. `:`showing <b>every</b> hostname this box publishes. `)
    + `an area with no results reads <b>not scanned</b>, never <b>none</b> — and a hostname no area declares reads <b>unmapped</b>, never attributed to a project.`;
}

initOauth();

