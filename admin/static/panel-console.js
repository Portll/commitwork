// admin/static/panel-console.js — part 2 of 8 of the panel client.
//
// ANSI-to-HTML for the live console, targeted re-scan, scanner-row triage, tab count badges.
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

// ── ANSI → HTML for the live console ─────────────────────────────────────────────────────────
// The sweep is spawned with FORCE_COLOR (see trigger() in serve.mjs) so its output reaches us with
// the same commitwork theme a terminal would show. Rendered as textContent those codes would print
// as literal `[38;2;232;115;12m` noise, so they are translated here.
//
// ESCAPING ORDER IS THE WHOLE SAFETY ARGUMENT: the text is HTML-escaped FIRST, then the (already
// safe) escaped text is split on SGR sequences and wrapped in spans whose style is built only from
// digits this function matched itself. Scanner output is untrusted — it contains file paths, rule
// names and matched source from whatever the sweep scanned — and it lands in innerHTML. A rule id
// containing `<img onerror=…>` must be inert, and it is, because esc() has already run over every
// byte that is not a code this parser recognised.
function ansiHtml(s){
  const esc0=esc(String(s==null?'':s));
  let out='', open=0, i=0;
  // EVERY CSI sequence is consumed, not just SGR. The sweep's grandchildren are docker, npm and
  // semgrep, which emit erase-line (`ESC[2K`), cursor-up and similar to animate progress; matching
  // only `…m` left those in the stream, where the invisible ESC byte was dropped by the browser and
  // the remainder printed as literal `[2K` litter through the log. Non-SGR sequences are discarded.
  const RE=/\x1b\[[0-9;?]*([a-zA-Z])/g;
  let m;
  while((m=RE.exec(esc0))){
    out+=esc0.slice(i,m.index); i=RE.lastIndex;
    if(m[1]!=='m')continue;                                   // cursor/erase control — drop it
    const codes=m[0].slice(2,-1).split(';').filter(x=>x!=='');
    if(!codes.length||codes[0]==='0'){ out+='</span>'.repeat(open); open=0; continue; }
    // truecolor foreground: 38;2;R;G;B — the only colour form the theme emits
    if(codes[0]==='38'&&codes[1]==='2'){
      const r=+codes[2]||0,g=+codes[3]||0,b=+codes[4]||0;
      out+=`<span style="color:rgb(${r&255},${g&255},${b&255})">`; open++; continue;
    }
    if(codes[0]==='1'){ out+='<span style="font-weight:600">'; open++; continue; }
    // anything else (a tool's own 16-colour output, cursor tricks) is dropped, not printed
  }
  out+=esc0.slice(i)+'</span>'.repeat(open);
  return out;
}

// ── ⏺ record: targeted re-scan ───────────────────────────────────────────────────────────────
// One scanner (Scanner coverage) or one repo (Fleet). The server owns the closed allowlist — the
// category key sent here is a KEY, and monitor/scanner-checks.mjs turns it into a check id or
// refuses; nothing typed into this page becomes part of a command line.
//
// The button is rendered from data attributes and bound by delegation on document, so rows that
// re-render on the 8s poll never lose their handler and never accumulate duplicates.
function recBtn({scanner=null,repo=null,label=''}){
  const what=scanner?`the ${label} check across this project`:`every scanner for ${label||repo}`;
  return `<button type="button" class="rec" data-scan="${esc(scanner||'')}" data-repo="${esc(repo||'')}"`
    +` title="⏺ re-run ${esc(what)} — a targeted sweep, written into this area's next slice">⏺</button>`;
}
// Disabled while the job slot is held: a targeted scan and a full sweep write the same area, so the
// server refuses the second one anyway. Better to show it as unavailable than to invite a refusal.
function setRecEnabled(busy){
  document.querySelectorAll('button.rec').forEach(b=>{ b.disabled=!!busy; if(!busy)b.classList.remove('on'); });
}
document.addEventListener('click',async(e)=>{
  const b=e.target.closest&&e.target.closest('button.rec'); if(!b||b.disabled)return;
  const q=new URLSearchParams({project:curProj||''});
  if(b.dataset.scan)q.set('scanner',b.dataset.scan);
  if(b.dataset.repo)q.set('repo',b.dataset.repo);
  b.classList.add('on'); setRecEnabled(true);
  let r;
  try{ r=await cwPost('/api/scan?'+q.toString()); }
  catch(err){ setRecEnabled(false); alert('could not start the scan: '+err.message); return; }
  if(!r||!r.started){ setRecEnabled(false); alert('not started — '+((r&&r.reason)||'unknown reason')); return; }
  // A runtime scanner with no URL starts, skips and finishes: say so now rather than let a no-op
  // read as a clean result once the console goes green.
  if(r.note)$('sw-sub')&&($('sw-sub').textContent=r.note);
  sweepUserHid=false; startSweepPolling();
},false);

// ── scanner-row triage (button.ann-fp, delegation like button.rec above) ─────────────────────
// INLINE, NOT MODAL, AND IT NOW SENDS THE FIELD THE STORE REQUIRES.
//
// This posted {project,category,repo,rule,file,action,reason} and no `expires`. The validator both
// writers share demands one (monitor/annotate-lib.mjs, requireExpires:true — an undated suppression
// is a permanent blindfold), so EVERY judgement made from this panel was refused 400 and the only
// trace was a dismissable dialog. Measured, not inferred: probing the real handler at HEAD returned
// `missing expires` for every annotatable category. The sibling author bin/annotate.mjs has carried
// --expires since it was written; the panel simply had no field for it, so one writer could satisfy
// the shared contract and the other structurally could not.
//
// A REFUSAL IS A DISPLAYED STATE. "Grey is not green" has only ever been enforced on what this
// panel OBSERVES. A judgement it was TOLD and could not persist was an alert() and a lost
// keystroke — the same class, aimed at the one input only a human can supply. The refusal now
// renders in the row, KEEPS WHAT WAS TYPED so nothing has to be retyped, and stays until resolved.
//
// AND SUCCESS IS NOT UNIFORM. The server returns `matched`: how many published rows the record
// addresses. matched===0 is refused upstream (409), but matched===null means the rollup could not
// be read — recorded, and NOTHING confirms it addresses a live finding. That is an unknown, and it
// is rendered as one rather than folded into the same tick as a verified match.
document.addEventListener('click',(e)=>{
  const b=e.target.closest&&e.target.closest('button.ann-fp'); if(!b||b.disabled)return;
  const td=b.closest('td'); if(!td)return;
  td.innerHTML=annForm({...b.dataset});
  const ta=td.querySelector('.ann-reason'); if(ta)ta.focus();
},false);

document.addEventListener('click',(e)=>{
  const c=e.target.closest&&e.target.closest('button.ann-cancel'); if(!c)return;
  const form=c.closest('.ann-form'),td=c.closest('td'); if(!form||!td)return;
  const d=form.dataset;
  td.innerHTML=annCellInner(d.category,{repo:d.repo,rule:d.rule,file:d.file,line:d.line});
},false);

document.addEventListener('click',async(e)=>{
  const s=e.target.closest&&e.target.closest('button.ann-save'); if(!s||s.disabled)return;
  const form=s.closest('.ann-form'); if(!form)return;
  const d=form.dataset;
  const msg=form.querySelector('.ann-msg');
  const reason=(form.querySelector('.ann-reason')||{}).value||'';
  const expires=(form.querySelector('.ann-expires')||{}).value||'';
  const say=(cls,html)=>{ if(!msg)return; msg.className='ann-msg '+cls; msg.innerHTML=html; };
  // Both refusals the operator can fix without a round trip are caught here, in the row, with what
  // they typed still on screen.
  if(!reason.trim()){ say('bad','a false-positive judgment without a reason is exactly the record this store refuses'); return; }
  if(!expires){ say('bad','pick a re-check date — an undated suppression never expires and never gets looked at again'); return; }
  s.disabled=true; const was=s.textContent; s.textContent='recording…';
  let r,j;
  try{
    r=await cwPost('/api/annotations/scanner',{headers:{'content-type':'application/json'},
      // The identity fields the CATEGORY declares, spread after `rule` so a lane keyed on `detector`
      // sends detector. rule stays for the lanes that are keyed on it; the server copies only the
      // fields identityFor() names, so an extra one is ignored rather than stored.
      body:JSON.stringify({project:curProj||'',category:d.category,repo:d.repo,rule:d.rule,file:d.file,
        ...identFrom({dataset:d}),
        // WHICH row was judged, as evidence. The store keeps it as `seenAtLine` and the matcher
        // never reads it — identity still excludes line, so a finding that moves is still the same
        // finding. It exists so the second judgment on a file can say what it actually looked at.
        line:d.line||'',
        action:'false-positive',reason:reason.trim(),expires:new Date(expires+'T00:00:00Z').toISOString()})});
    j=await r.json();
  }catch(err){
    s.disabled=false; s.textContent=was;
    say('bad','could not reach the panel to record this ('+esc(err.message)+') — nothing was written, and what you typed is still here');
    return;
  }
  if(!r.ok||!j||!j.ok){
    s.disabled=false; s.textContent=was;
    const detail=(j&&j.errors)?'<ul><li>'+j.errors.map(esc).join('</li><li>')+'</li></ul>':'';
    say('bad','<b>refused — nothing was recorded.</b> '+esc((j&&j.error)||('HTTP '+r.status))+detail);
    return;
  }
  // matched===null is an UNKNOWN, not a quieter success: the record is stored, and no rollup could
  // be read to confirm it addresses anything. Coloured and worded as its own state.
  const td=form.closest('td'); if(!td)return;
  const who=esc((j.record&&j.record.who)||'you');
  // One write, because replacing the cell detaches .ann-msg — a second call would render into a
  // node no longer in the document and the operator would see nothing.
  // Three outcomes, three renderings. `duplicate` is NOT a quieter success either: the suppression
  // the operator asked for already existed, so nothing new was suppressed and the review date they
  // just picked was NOT taken. Showing "recorded ✓" here would tell them they set a date they did
  // not set — the same shape as rendering an unknown as a pass.
  td.innerHTML=j.duplicate
    ? '<span class="pill part" title="'+esc(j.message||'')+'">corroborated · already suppressed</span>'
    : j.matched==null
      ? '<span class="pill unk" title="recorded by '+who+' — the area\'s rollup could not be read, so nothing confirms this addresses a live finding">recorded · unverified</span>'
      : '<span class="pill part" title="recorded by '+who+' · addresses '+j.matched+' row(s) · applies at the next rollup">recorded ✓</span>';
},false);

// ── tab count badges ─────────────────────────────────────────────────────────────────────────
// Ten tabs used to carry ten pure labels; the numbers they lead to are the whole point of the
// panel, so they belong in the strip. setTabN(view, null) CLEARS the badge rather than writing a
// zero: a tab we have not scanned (or, for the lazily-loaded tabs, not yet opened) must not
// render the same as a tab we scanned and found nothing in. A measured zero is written as "0".
// Lanes where a non-zero count is an INCIDENT rather than a queue. Same judgement the scanner
// table already makes with CRITICAL_CATEGORY ('maliciousPackages' → a MALWARE pill, not a findings
// pill): a confirmed-malicious package means any credential the machine that ran install could
// reach is suspect. Declared here as the tab-side twin of that set.
const CRITICAL_LANE=new Set(['malware']);
function setTabN(view,n,note,annotated){
  const el=document.getElementById('vn-'+view); if(!el)return;
  el.textContent=(n===null||n===undefined)?'':String(n);
  // Tone is derived from the LANE and the value, never passed in: seventeen call sites setting
  // their own colour is seventeen chances for one lane to be quietly downgraded. A cleared badge
  // and a measured zero both stay quiet — zero has earned calm, and absence renders nothing at all.
  const num=Number(n);
  // THREE tones, because zero-because-clean and zero-because-all-judged-away are different facts
  // and rendered identically until now. `triaged` is a zero that somebody argued for: every finding
  // this lane produced carries an attributed judgment, and the rows are still there, struck through.
  // n!=null FIRST: Number(null) is 0, which is finite and ===0, so a CLEARED badge (never scanned)
  // would otherwise take the triaged tone — unscanned borrowing the look of judged.
  const triaged=n!==null&&n!==undefined&&Number.isFinite(num)&&num===0&&Number(annotated)>0;
  el.classList.toggle('crit',Number.isFinite(num)&&num>0&&CRITICAL_LANE.has(view));
  el.classList.toggle('warn',Number.isFinite(num)&&num>0&&!CRITICAL_LANE.has(view));
  el.classList.toggle('triaged',triaged);
  if(triaged&&!note)note=`0 open — all ${annotated} finding(s) in this lane carry an attributed judgment. Not the same as nothing found.`;
  if(note)el.title=note; else el.removeAttribute('title');
  // a section badge is a function of its members' badges, so it is stale the moment one moves
  if(typeof refreshGroupBadges==='function')refreshGroupBadges();
}
