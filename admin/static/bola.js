// BOLA tab — object-level authorization. Extracted from index.html 2026-08-26.
//
// fact: loaded as a classic script BEFORE the inline panel script / loadBola must exist as a global by the time setView dispatches to it (expiry: if the panel adopts modules, prev: not built)
// fact: BOLA_CLASS, bolaBusy, bolaTimer and bolaSeq are declared HERE / a view whose state stays in the page it was lifted out of has been relocated, not decoupled (expiry: never, prev: duplicated)
// fact: $, esc, pill, age, setTabN, cwPost and ansiHtml still come from the inline script / every one is CALLED at runtime, never read at load time, so the one-way seam holds (expiry: when the panel helpers are extracted too, prev: unknown)
// fact: setView calls this conditionally (if(v==='bola')) / unlike learnPaint it is not on the boot path, which is why nothing here runs before the inline block has defined its helpers (expiry: if setView starts calling it unconditionally, prev: unknown)
// Present + run. Lazy (fetched on tab entry, not on the 8s poll). Every state the backend can
// return — never run, unreadable evidence, BLOCKED credentials, a coverage void — is rendered as
// its own state; a run that recorded findings is red, and a clean run states over how many owned
// objects and actors it stayed clean, so an empty table never reads as "nothing to test".
const BOLA_CLASS={'broken-auth':{c:'high',t:'broken auth'},'unauth-exposure':{c:'high',t:'unauth exposure'},'bola':{c:'crit',t:'BOLA'},'bfla':{c:'crit',t:'BFLA'},'cross-tenant':{c:'crit',t:'cross-tenant'}};
let bolaBusy=null; // slug currently running, or null
async function loadBola(){
  const wrap=$('bola-fleet'); if(!wrap)return;
  if(!wrap.innerHTML)wrap.innerHTML='<div class="mut">loading…</div>';
  let d; try{d=await (await fetch('/api/bola')).json();}
  catch(e){wrap.innerHTML='<div class="pk-err">UNREACHABLE — the /api/bola route did not answer, so BOLA state is UNKNOWN, not clean: '+esc(e.message||e)+'</div>';return;}
  renderBola(d);
  // reflect a run that is already in flight (e.g. tab entered mid-run, or reload)
  bolaPollOnce();
}
function renderBola(d){
  const areas=(d&&d.areas)||[];
  const totalF=areas.reduce((a,x)=>a+((x.evidence&&x.evidence.findings)?x.evidence.findings.length:0),0);
  const anyEvidence=areas.some(x=>x.evidence&&x.evidence.present);
  $('bola-n').textContent=areas.length+' area(s)';
  // badge: total findings across areas; null (cleared) when nothing has ever run — 0 would read as clean
  setTabN('bola',anyEvidence?totalF:null,'BOLA findings across configured projects');
  $('bola-cov').innerHTML='<div class="card gap-banner"><span class="mut">Object-level authorization across every project that declares a <code>bola</code> block. explicit uncertainty: a project with no run shows <b>never run</b>, and a run that could not mint its actors or seed an object records a <b>coverage void</b>, never a clean pass.</span></div>';
  $('bola-fleet').innerHTML=areas.map(bolaCard).join('')||'<div class="card mut">No project declares a <code>bola</code> block. Add one to an area in <code>monitor/projects.json</code> (manifest + testbed base) to test it here.</div>';
}
function bolaCard(a){
  const r=a.readiness||{}, ev=a.evidence||{};
  const ready=!!r.ready, running=bolaBusy===a.slug;
  const readPill=ready?'<span class="pill live">READY</span>':'<span class="pill part">BLOCKED</span>';
  const readNote=ready?'<span class="mut">credentials configured — '+esc((r.needed||[]).length)+' secret(s) resolve</span>'
    :'<span class="mut">'+esc(r.reason||'not configured')+'</span>';
  const runBtn='<button type="button" class="vtab vtab-run'+((ready&&!running)?'':' btn-off')+'" data-bola-run="'+esc(a.slug)+'"'+((ready&&!running)?'':' disabled')+'>'+(running?'running…':'▶ Run BOLA')+'</button>';
  // verdict from the latest run
  let verdict, detail='';
  if(!ev.present){verdict='<span class="pill plan">never run</span>';}
  else if(ev.unreadable){verdict='<span class="pill unk">UNREADABLE</span> <span class="mut">'+esc(ev.error||'')+'</span>';}
  else if(ev.invalid){verdict='<span class="pill plan">INVALID</span> <span class="mut">'+esc(ev.error||'')+'</span>';}
  else{
    const nf=(ev.findings||[]).length;
    verdict=(ev.skipped)?'<span class="pill plan">VOID — did not run</span>'
      :nf?'<span class="pill crit">'+nf+' finding(s)</span>'
      :'<span class="pill live">no break</span>';
    if(ev.generatedAt)verdict+=' <span class="gen tnum t-loc">'+esc(age(ev.generatedAt))+'</span>';
    detail=bolaDetail(ev);
  }
  return '<div class="card gap-banner">'
    +'<div class="bola-head">'
    +'<b class="sans t-lead">'+esc(a.label)+'</b>'
    +'<code class="t-loc">'+esc(a.manifest)+' @ '+esc(a.base)+'</code>'
    +readPill+verdict+'<span class="push-right">'+runBtn+'</span></div>'
    +'<div'+(detail?' class="bola-ready"':'')+'>'+readNote+(r.missing&&r.missing.length?' <span class="mut">· store: '+r.missing.map(m=>'<code>'+esc(m.name)+'</code>').join(' ')+'</span>':'')+'</div>'
    +detail+'</div>';
}
function bolaDetail(ev){
  let h='';
  // findings by class
  const fs=ev.findings||[];
  if(fs.length){
    const byType={};for(const f of fs){(byType[f.type]=byType[f.type]||[]).push(f);}
    h+='<div class="bola-classes">'+Object.keys(byType).map(t=>{const m=BOLA_CLASS[t]||{c:'part',t:t};return pill(m.c,m.t+' · '+byType[t].length);}).join(' ')+'</div>';
    h+='<div class="tw"><table><thead><tr><th>Class</th><th>Path</th><th>Attacker → owner</th><th>Detail</th></tr></thead><tbody>'
      +fs.map(f=>{const m=BOLA_CLASS[f.type]||{c:'part',t:f.type};return '<tr><td>'+pill(m.c,m.t)+'</td><td><code class="t-loc">'+esc(f.path||'')+'</code></td><td class="mut">'+esc(f.attacker||'anon')+(f.owner?' → '+esc(f.owner):'')+'</td><td class="mut cell-detail">'+esc(f.detail||'')+'</td></tr>';}).join('')
      +'</tbody></table></div>';
  }
  // actor matrix
  const acts=ev.actors||[];
  if(acts.length){
    h+='<details class="bola-drop"><summary class="mut point">actor matrix ('+acts.filter(x=>x.minted).length+'/'+acts.length+' minted)</summary>'
      +'<div class="tw"><table><thead><tr><th>Actor</th><th>Role</th><th>Tenant</th><th>Minted</th></tr></thead><tbody>'
      +acts.map(x=>'<tr><td><b class="name">'+esc(x.name)+'</b></td><td>'+esc(x.role||'')+'</td><td class="mut">'+esc(x.tenant||'')+'</td><td>'+(x.minted?'<span class="pill live">yes</span>':'<span class="pill plan">no</span> <span class="mut t-meta">'+esc(x.void||'')+'</span>')+'</td></tr>').join('')
      +'</tbody></table></div></details>';
  }
  // coverage voids
  const vs=ev.voids||[];
  if(vs.length){
    h+='<details class="drop-gap"><summary class="mut point"><span class="pill plan">'+vs.length+' coverage void(s)</span> — probes that could not run, not clean results</summary>'
      +'<ul class="mut void-list">'+vs.map(v=>'<li>'+esc(v)+'</li>').join('')+'</ul></details>';
  }
  if(ev.summary&&ev.summary.verdict)h+='<div class="mut bola-verdict">'+esc(ev.summary.verdict)+'</div>';
  return h;
}
// run trigger (delegated) + live console keyed to the 'bola' job on /api/status
document.addEventListener('click',(e)=>{const b=e.target.closest&&e.target.closest('[data-bola-run]');if(!b||b.disabled)return;runBola(b.dataset.bolaRun);});
async function runBola(slug){
  bolaBusy=slug; bolaSlug=slug; renderBolaBusy();
  $('bola-console').style.display='block'; $('bola-log').textContent=''; $('bola-ctitle').textContent='BOLA probe · '+slug;
  let res; try{res=await (await cwPost('/api/bola/run?project='+encodeURIComponent(slug))).json();}
  catch(err){$('bola-log').textContent='could not start: '+(err.message||err);bolaBusy=null;return;}
  if(!res||!res.started){$('bola-log').textContent='not started: '+((res&&res.reason)||'unknown');bolaBusy=null;renderBolaBusy();return;}
  startBolaPolling();
}
function renderBolaBusy(){document.querySelectorAll('[data-bola-run]').forEach(b=>{const on=(bolaBusy===b.dataset.bolaRun);b.disabled=b.disabled||on;if(on)b.textContent='running…';});}
let bolaTimer=null,bolaSeq=-1,bolaSlug=null;
function startBolaPolling(){if(bolaTimer)return;bolaTimer=setInterval(bolaPollOnce,1200);}
async function bolaPollOnce(){
  // The BOLA page lists every area, so the console asks for the area it started, not the picker's.
  let j;try{j=(await (await fetch('/api/status?'+jobQ(bolaSlug||''))).json()).bola;}catch(e){return;}
  if(!j){return;}
  if(j.startedAt)$('bola-console').style.display='block';
  if(j.seq!==bolaSeq){bolaSeq=j.seq;const log=$('bola-log');const pin=log.scrollTop+log.clientHeight>=log.scrollHeight-24;log.innerHTML=ansiHtml((j.lines||[]).join('\n'));if(pin)log.scrollTop=log.scrollHeight;}
  $('bola-ico').className=j.running?'spin':'';
  if(j.running){bolaBusy=bolaBusy|| (j.label&&j.label.replace(/^BOLA · /,''))||bolaBusy;}
  else{
    // finished — stop polling, refresh the fleet so the new evidence + verdict land
    if(bolaTimer){clearInterval(bolaTimer);bolaTimer=null;}
    if(bolaBusy){bolaBusy=null;$('bola-ctitle').textContent='BOLA probe · done'+(j.exitCode?' · findings':'');loadBola();}
  }
}
