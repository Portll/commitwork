// Slop Bucket — the client half. Extracted from index.html 2026-08-26.
//
// fact: loaded as a classic script BEFORE the inline panel script / its function declarations must exist as globals by the time setView dispatches to loadComments (expiry: if the panel adopts modules, prev: not built)
// fact: it owns CMT and every cmt* function / a view whose state lives in the page it was lifted out of has been moved, not decoupled (expiry: never, prev: duplicated)
// fact: csrf() and CMT-free helpers still come from the inline script / this is the first extraction and the seam is deliberately one-way (expiry: when the second module lands, prev: not built)
// Slop Bucket — comment blocks over the schema limit. The hatched column is the text a save or an accept writes.
let CMT=[];
let cmtHistory=[];
// fact: per-row UI state is keyed by the block's content hash, never its index or ordinal / a save renumbers every later block in the file and would hand one row's edits to another (expiry: never, prev: not built)
const CMT_UI=new Map();
// fact: the view sets the project and every call carries it / one client against two roots would accept an edit into whichever repo the last fetch used (expiry: never, prev: not built)
let CMT_PROJECT='commitwork';
const cmtQ=()=>'?project='+encodeURIComponent(CMT_PROJECT);
function cmtEsc(t){return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function cmtShown(){return CMT.filter(i=>!document.getElementById('cmt-narr').checked||i.kind==='narrative');}
// fact: rows are addressed by INDEX, never by suggestion id / an id carries / . and #, and
// getElementById takes a raw id while CSS.escape produces a selector token — they never match, so
// every tick box read back as unchecked and Accept could not enable (expiry: never, prev: broken)
function cmtRow(i){return document.getElementById('cmt-row-'+CMT.indexOf(i));}
function cmtBox(i){const r=cmtRow(i);return r?r.querySelector('input[type=checkbox]'):null;}
function cmtBody(l){
  return String(l).replace(/^\s*\/\/\s?/,'');
}
// fact: the marker lives in the gutter and is re-attached here / text typed with its own // would otherwise save as // // (expiry: never, prev: not built)
function cmtText(i){
  const r=cmtRow(i); if(!r)return undefined;
  const col=r.getAttribute('data-sel')||'first';
  const tas=[...r.querySelectorAll('textarea')].filter(t=>t.getAttribute('data-col')===col);
  if(!tas.length)return undefined;
  const pad=((i.before&&i.before[0])||'').match(/^\s*/)[0];
  return tas.flatMap(t=>t.value.split('\n')).map(l=>cmtBody(l).trim()).filter(Boolean).map(l=>pad+'// '+l).join('\n');
}
function cmtSel(){return CMT.filter(i=>{const b=cmtBox(i);return !!(b&&b.checked);});}
function cmtGain(i){
  const t=cmtText(i);
  return t?Math.max(0,i.lines-t.split('\n').length):0;
}
function cmtSync(){
  const sel=cmtSel();
  const saved=sel.reduce((a,i)=>a+cmtGain(i),0);
  const voids=sel.filter(i=>i.void).length;
  document.getElementById('cmt-sel').textContent=sel.length?(sel.length+' selected'+(saved?' · could remove '+saved+' lines':'')+(voids?' · '+voids+' need text':'')):'none selected';
  document.getElementById('cmt-accept').disabled=sel.length===0;
}
// fact: a trailer is optional; one that is written must be whole and carry a real expiry, as the schema gate requires
function cmtNeeds(lines){
  const bad=lines.some(l=>{
    const t=l.trim();
    if(!/^fact:/.test(t)||!/\((expiry|prev):/i.test(t))return false;
    return !/\(expiry:\s*(?!(todo|fixme|tbd|xxx)\s*,)[^,\s][^,]*,\s*prev:[^)]+\)\s*$/i.test(t);
  });
  return bad?'a trailer must be (expiry: <cond>, prev: <state>) with a real expiry, or left off':'';
}
function cmtLine(t,col,ph){
  return '<div class="cmt-ln"><span class="cmt-gut" aria-hidden="true">//</span>'
    +'<textarea class="cmt-tx" data-col="'+col+'" rows="1" spellcheck="false" aria-label="'+col+' line"'+(ph?' placeholder="'+cmtEsc(ph)+'"':'')+'>'+cmtEsc(t)+'</textarea></div>';
}
// fact: fates colour the original in place, in source order, and follow the hatched column / a separate list of dropped sentences repeated the comment and let a draft that deletes twelve sentences read as green (expiry: never, prev: broken)
function cmtOrig(i){
  const seg=g=>'<span class="cmt-o"'+(g.f1?' data-f1="'+g.f1+'"':'')+(g.f2?' data-f2="'+g.f2+'"':'')+'>'+cmtEsc(g.t)+'</span>';
  const legend=i.void?'':' · <span class="cmt-o" data-f1="kept" data-f2="kept">kept in full</span> <span class="cmt-o" data-f1="reworded" data-f2="reworded">reworded</span> <span class="cmt-o" data-f1="dropped" data-f2="dropped">deleted</span>';
  return '<div class="cmt-col" data-col="before"><div class="cmt-ch">original · '+i.lines+' lines'+legend+'</div>'
    +cmtFlow(i).map(l=>'<div class="cmt-ln"><span class="cmt-gut" aria-hidden="true">'+cmtEsc(l.mark)+'</span><div class="cmt-ro">'+l.segs.map(seg).join('')+'</div></div>').join('')
    +'</div>';
}
// fact: a draftable block is reflowed into one paragraph and a void keeps its source lines / the source's hard wraps ragged-wrap again in a column, and a void is often a list whose line breaks are its structure (expiry: never, prev: not built)
function cmtFlow(i){
  const src=i.original||(i.before||[]).map(l=>{const m=/^\s*(\/\/+|\/\*+|\*\/|\*)?\s?(.*)$/.exec(l);return {mark:m[1]||'',segs:[{t:m[2]}]};});
  if(i.void||!src.length)return src;
  const segs=[];
  for(const l of src){
    if(!l.segs.length)continue;
    if(segs.length)segs.push({t:' '});
    segs.push(...l.segs);
  }
  return [{mark:src[0].mark,segs}];
}
function cmtEdit(col,title,body,sel,hidden,ph){
  return '<div class="cmt-col'+(sel===col?' sel':'')+'" data-col="'+col+'"'+(sel===col?' aria-current="true"':'')+(hidden?' hidden':'')+'>'
    +'<div class="cmt-ch">'+title+' · <span class="cmt-cnt">'+body.length+'</span> lines <span class="cmt-need">'+cmtNeeds(body)+'</span></div>'
    +(body.length?body:['']).map(t=>cmtLine(t,col,ph)).join('')+'</div>';
}
function cmtLoss(c){
  const d=(c&&c.dropped)||0, r=(c&&c.reworded)||0;
  if(!d&&!r)return '✓ every sentence kept in full';
  return '⚠ '+[d?d+' sentence(s) deleted':'',r?r+' reworded':''].filter(Boolean).join(' · ')+' — marked in the original';
}
function cmtCard(i){
  const ui=CMT_UI.get(i.key)||{};
  // ui.sel is read back from the DOM and lands in an attribute below; only the two columns are real.
  const sel=!i.void&&ui.sel==='second'?'second':'first';
  const open='<div class="card" id="cmt-row-'+CMT.indexOf(i)+'" data-id="'+cmtEsc(i.id)+'" data-key="'+cmtEsc(i.key||'')+'" data-sel="'+sel+'"'+(i.done?' data-done="1"':'')+'>';
  const where='<b>'+cmtEsc(i.file)+'</b> <span class="mut">block '+i.ordinal+' · line '+i.startLine+' · '+i.lines+' lines</span>';
  if(i.done){
    const out=i.done.text.split('\n');
    return open+'<div class="cmt-hd">'+where+'<span class="cmt-ok">✓ saved · '+i.lines+' → '+out.length+' lines</span></div>'
      +'<div class="cmt-cols">'+cmtOrig(i)+'<div class="cmt-col" data-col="saved"><div class="cmt-ch">saved</div>'
      +out.map(l=>'<div class="cmt-ln"><span class="cmt-gut" aria-hidden="true">//</span><div class="cmt-ro cmt-new">'+cmtEsc(cmtBody(l))+'</div></div>').join('')
      +'</div></div></div>';
  }
  const text=ui.text||{};
  const two=!!i.second&&!i.void&&(sel==='second'||!!ui.second);
  const tags=i.void
    ?'<span class="tag cmt-void">no machine draft</span>'
    :'<span class="tag">'+cmtEsc(i.kind)+'</span><span class="tag">'+cmtEsc(i.confidence)+' confidence</span>';
  const acts='<span class="cmt-act">'
    +(i.void||!i.second?'':'<button type="button" class="btn" data-act="second" aria-pressed="'+two+'">second pass</button>')
    +'<button type="button" class="btn" data-act="save" title="write the hatched column into the file now">Save</button></span>';
  const warn=i.void
    ?'<p class="cmt-warn-l">No safe machine draft ('+cmtEsc(i.reason)+') — write the replacement in the right-hand column. It must pass the schema to be saved.</p>'
    :'<p class="cmt-warn-l"><span class="cmt-w" data-for="first">'+cmtLoss(i.tally&&i.tally.f1)+'</span><span class="cmt-w" data-for="second">'+cmtLoss(i.tally&&i.tally.f2)+'</span></p>';
  const first=text.first||i.after.map(cmtBody);
  const second=text.second||((i.second&&i.second.lines)||[]).map(cmtBody);
  return open
    +'<div class="cmt-hd"><input type="checkbox"'+(ui.checked?' checked':'')+' aria-label="select for accept">'+where+tags+acts+'</div>'
    +warn
    +'<div class="cmt-cols">'+cmtOrig(i)
    +cmtEdit('first',i.void?'your replacement':'first pass',first,sel,false,i.void?'fact: … (expiry: …, prev: …)':'')
    +(i.void||!i.second?'':cmtEdit('second','second pass',second,sel,!two,''))
    +'</div><p class="cmt-st" role="status"></p></div>';
}
// fact: edits, selection and ticks survive a re-render / a save refreshes the whole list and would otherwise discard every other row's unsaved work (expiry: never, prev: not built)
function cmtKeep(){
  document.querySelectorAll('#cmt-rows [data-key]').forEach(r=>{
    if(r.hasAttribute('data-done'))return;
    const text={};
    r.querySelectorAll('textarea[data-col]').forEach(t=>{(text[t.dataset.col]=text[t.dataset.col]||[]).push(t.value);});
    const box=r.querySelector('input[type=checkbox]'), two=r.querySelector('.cmt-col[data-col=second]');
    CMT_UI.set(r.getAttribute('data-key'),{sel:r.getAttribute('data-sel'),second:!!two&&!two.hidden,checked:!!(box&&box.checked),text});
  });
}
function cmtFit(t){
  if(typeof CSS!=='undefined'&&CSS.supports&&CSS.supports('field-sizing','content'))return;
  if(!t.scrollHeight)return;
  t.style.height='auto'; t.style.height=t.scrollHeight+'px';
}
function cmtRender(){
  cmtKeep();
  const rows=document.getElementById('cmt-rows');
  rows.innerHTML=cmtShown().map(cmtCard).join('')||'<p class="mut">Nothing over the limit in this view.</p>';
  rows.querySelectorAll('input[type=checkbox]').forEach(b=>b.addEventListener('change',cmtSync));
  rows.querySelectorAll('textarea.cmt-tx').forEach(cmtFit);
  cmtSync();
}
function cmtPick(row,col){
  row.setAttribute('data-sel',col);
  row.querySelectorAll('.cmt-col[data-col]').forEach(c=>{
    const on=c.dataset.col===col;
    c.classList.toggle('sel',on);
    if(on)c.setAttribute('aria-current','true'); else c.removeAttribute('aria-current');
  });
  cmtSync();
}
function cmtToggleSecond(row){
  const col=row.querySelector('.cmt-col[data-col=second]'), btn=row.querySelector('button[data-act=second]');
  if(!col)return;
  col.hidden=!col.hidden;
  btn.setAttribute('aria-pressed',String(!col.hidden));
  if(!col.hidden){col.querySelectorAll('textarea').forEach(cmtFit);cmtPick(row,'second');}
  else if(row.getAttribute('data-sel')==='second')cmtPick(row,'first');
}
function cmtColMeta(col){
  const body=[...col.querySelectorAll('textarea')].map(t=>t.value);
  col.querySelector('.cmt-cnt').textContent=body.filter(l=>l.trim()).length;
  col.querySelector('.cmt-need').textContent=cmtNeeds(body);
}
function cmtSay(row,msg,bad){
  const st=row.querySelector('.cmt-st'); if(!st)return;
  st.textContent=msg; st.classList.toggle('bad',!!bad);
}
async function cmtSave(i){
  const row=cmtRow(i); if(!row)return;
  const btn=row.querySelector('button[data-act=save]');
  const text=cmtText(i);
  if(!text){cmtSay(row,'Nothing to save — the hatched column is empty.',true);return;}
  btn.disabled=true; cmtSay(row,'saving…',false);
  try{
    const t=await csrf();
    const r=await fetch('/api/comments/accept',{method:'POST',headers:{'Content-Type':'application/json','x-cw-csrf':t||''},body:JSON.stringify({accept:[{id:i.id,text}],project:CMT_PROJECT})});
    const j=await r.json();
    const x=(j.results||[])[0];
    if(!x||!x.ok)throw new Error((x&&x.error)||j.error||('HTTP '+r.status));
    i.done={text,saved:x.saved||0};
  }catch(e){ cmtSay(row,'Not saved: '+e.message,true); btn.disabled=false; return; }
  cmtRender();
  cmtSummary();
  await loadComments(CMT_PROJECT);
}
// fact: the summary is derived from the loaded items, the TREND from the server's ledger / a count kept only client-side resets every reload and cannot show slop falling across sessions (expiry: never, prev: not built)
function cmtStats(){
  const open=CMT.filter(i=>!i.done), v=open.filter(i=>i.void), byReason={}, byFile={};
  for(const i of v)byReason[i.reason]=(byReason[i.reason]||0)+1;
  for(const i of open)byFile[i.file]=(byFile[i.file]||0)+1;
  const top=Object.entries(byFile).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,10);
  return {blocks:open.length,voids:v.length,candidates:open.length-v.length,couldRemove:open.reduce((a,i)=>a+i.saved,0),byReason,top};
}
function cmtSummary(){
  const el=document.getElementById('cmt-summary'); if(!el)return;
  const s=cmtStats();
  const reasons=Object.entries(s.byReason).sort((a,b)=>b[1]-a[1]).map(([r,n])=>'<li>'+n+' — '+cmtEsc(r)+'</li>').join('');
  const top=s.top.map(([f,n])=>'<tr><td class="mono t-loc">'+cmtEsc(f)+'</td><td class="tnum">'+n+'</td></tr>').join('');
  let trend='';
  if(cmtHistory&&cmtHistory.length){
    const last=cmtHistory[cmtHistory.length-1], prev=cmtHistory.length>1?cmtHistory[cmtHistory.length-2]:null;
    const d=prev?last.blocks-prev.blocks:null;
    trend='<p class="mut t-note gap-t">recorded · '+cmtHistory.length+' sweep(s) on file · last '+cmtEsc(last.at)
      +(d===null?'':' · blocks '+(d>0?'+'+d:d)+' vs previous')+'</p>';
  }
  // The panel's KPI tiles and table wrapper (THEME "KPI tiles", "Tables"): rem-sized and themed,
  // where this summary used to set its own px gaps and font size. Voids need a person, so that
  // tile takes the warning rule.
  const kpi=(cls,k,v,sub)=>'<div class="kpi'+(cls?' '+cls:'')+'"><div class="k">'+k+'</div><div class="v tnum">'+v+'</div>'+(sub?'<div class="s">'+sub+'</div>':'')+'</div>';
  el.innerHTML='<div class="kpis gap-t">'
    +kpi('','flagged',s.blocks)
    +kpi(s.voids?'warn':'','voids',s.voids,'need a human')
    +kpi('','draft candidates',s.candidates)
    +kpi('','lines could remove',s.couldRemove)+'</div>'
    +(reasons?'<p class="mut t-note gap-t">why the voids</p><ul class="t-body">'+reasons+'</ul>':'')
    +(top?'<p class="mut t-note gap-t">where it concentrates</p><div class="tw"><table><thead><tr><th>file</th><th>blocks</th></tr></thead><tbody>'+top+'</tbody></table></div>':'')
    +trend;
}
// fact: saved rows are carried across a refresh and sorted back into place / the refreshed list no longer holds a block that is now under the limit, so the save would vanish instead of showing (expiry: never, prev: not built)
function applyComments(j,history){
  const fresh=new Set(j.items.map(i=>i.key));
  CMT=j.items.concat(CMT.filter(i=>i.done&&!fresh.has(i.key)))
    .sort((a,b)=>b.lines-a.lines||a.file.localeCompare(b.file)||a.ordinal-b.ordinal);
  if(history!==undefined)cmtHistory=history;
  document.getElementById('cmt-n').textContent=j.total+' blocks · '+j.files+' files · could remove '+j.saveable;
  const vn=document.getElementById(CMT_PROJECT==='commitwork'?'vn-comments':'vn-'+CMT_PROJECT+'comments'); if(vn)vn.textContent=j.total;
  const pl=document.getElementById('cmt-project'); if(pl)pl.textContent=CMT_PROJECT;
  cmtRender();
  cmtSummary();
}
async function loadComments(project){
  const next=project||'commitwork';
  if(next!==CMT_PROJECT){CMT=[];CMT_UI.clear();}
  CMT_PROJECT=next;
  const warn=document.getElementById('cmt-warn');
  try{
    const j=await (await fetch('/api/comments'+cmtQ())).json();
    if(!j.ok)throw new Error(j.error||'unavailable');
    warn.style.display='none';
    applyComments(j);
  }catch(e){ warn.textContent='Suggestions unavailable: '+e.message; warn.style.display=''; }
}
function cmtRowItem(el){
  const row=el.closest('[id^="cmt-row-"]');
  return row?{row,i:CMT[Number(row.id.slice(8))]}:null;
}
document.addEventListener('DOMContentLoaded',function(){
  const all=document.getElementById('cmt-all'), narr=document.getElementById('cmt-narr'),
        acc=document.getElementById('cmt-accept'), swp=document.getElementById('cmt-sweep'),
        rows=document.getElementById('cmt-rows');
  if(!all)return;
  if(swp)swp.addEventListener('click',async()=>{
    const warn=document.getElementById('cmt-warn'), label=swp.textContent;
    swp.disabled=true; swp.textContent='sweeping…';
    try{
      const t=await csrf();
      const r=await fetch('/api/comments/sweep'+cmtQ(),{method:'POST',headers:{'x-cw-csrf':t||''}});
      const j=await r.json();
      if(!j.ok)throw new Error(j.error||'sweep failed');
      warn.style.display='none';
      applyComments(j,j.history||[]);
    }catch(e){ warn.textContent='Sweep failed: '+e.message; warn.style.display=''; }
    finally{ swp.disabled=false; swp.textContent=label; }
  });
  all.addEventListener('change',()=>{document.querySelectorAll('#cmt-rows input[type=checkbox]').forEach(b=>{b.checked=all.checked;});cmtSync();});
  narr.addEventListener('change',()=>{all.checked=false;cmtRender();});
  rows.addEventListener('click',e=>{
    const hit=cmtRowItem(e.target); if(!hit||hit.row.hasAttribute('data-done'))return;
    const b=e.target.closest('button[data-act]');
    if(b&&b.dataset.act==='second')return cmtToggleSecond(hit.row);
    if(b&&b.dataset.act==='save')return cmtSave(hit.i);
    const c=e.target.closest('.cmt-col[data-col]');
    if(c&&(c.dataset.col==='first'||c.dataset.col==='second'))cmtPick(hit.row,c.dataset.col);
  });
  rows.addEventListener('focusin',e=>{
    const hit=cmtRowItem(e.target), c=e.target.closest('.cmt-col[data-col]');
    if(hit&&c&&!hit.row.hasAttribute('data-done')&&(c.dataset.col==='first'||c.dataset.col==='second'))cmtPick(hit.row,c.dataset.col);
  });
  rows.addEventListener('input',e=>{
    const t=e.target; if(!t.matches('textarea.cmt-tx'))return;
    cmtFit(t); cmtColMeta(t.closest('.cmt-col')); cmtSync();
  });
  // One textarea per comment line keeps the // gutter beside every line; Enter and Backspace split and join them.
  rows.addEventListener('keydown',e=>{
    const t=e.target; if(!t.matches('textarea.cmt-tx'))return;
    const ln=t.closest('.cmt-ln');
    if(e.key==='Enter'&&!e.shiftKey){
      e.preventDefault();
      const at=t.selectionStart, rest=t.value.slice(t.selectionEnd);
      t.value=t.value.slice(0,at);
      // nosemgrep: typescript.react.security.audit.react-unsanitized-method.react-unsanitized-method -- cmtLine escapes the text with cmtEsc; col is a literal column name (before/after/second/draft)
      ln.insertAdjacentHTML('afterend',cmtLine(rest,t.dataset.col,''));
      const nt=ln.nextElementSibling.querySelector('textarea');
      cmtFit(t); cmtFit(nt); nt.focus(); nt.setSelectionRange(0,0);
      cmtColMeta(t.closest('.cmt-col'));
    }else if(e.key==='Backspace'&&t.selectionStart===0&&t.selectionEnd===0){
      const prev=ln.previousElementSibling, pt=prev&&prev.querySelector('textarea.cmt-tx');
      if(!pt)return;
      e.preventDefault();
      const at=pt.value.length, col=t.closest('.cmt-col');
      pt.value+=t.value; ln.remove(); cmtFit(pt); pt.focus(); pt.setSelectionRange(at,at);
      cmtColMeta(col); cmtSync();
    }
  });
  acc.addEventListener('click',async()=>{
    const sel=cmtSel(); if(!sel.length)return;
    if(!confirm('Accept '+sel.length+' edit(s)? Each file is re-parsed and restored if it stops parsing.'))return;
    acc.disabled=true;
    // fact: an empty box is sent as NO edit, not as an empty replacement / deleting the draft
    // entirely would otherwise blank the block rather than leave it alone (expiry: never, prev: broken)
    const accept=sel.map(i=>{const t=cmtText(i);return (t&&t.trim())?{id:i.id,text:t}:{id:i.id};});
    try{
      const t=await csrf();
      const r=await fetch('/api/comments/accept',{method:'POST',headers:{'Content-Type':'application/json','x-cw-csrf':t||''},body:JSON.stringify({accept,project:CMT_PROJECT})});
      const j=await r.json();
      const bad=(j.results||[]).filter(x=>!x.ok);
      for(const x of (j.results||[]).filter(y=>y.ok)){
        const i=CMT.find(c=>c.id===x.id), sent=accept.find(p=>p.id===x.id);
        if(i)i.done={text:(sent&&sent.text)||i.after.join('\n'),saved:x.saved||0};
      }
      alert('Applied '+(j.applied||0)+' · refused '+(j.refused||0)+' · '+(j.linesSaved||0)+' lines saved'
        +(bad.length?('\n\n'+bad.map(b=>b.id+': '+b.error).join('\n')):''));
      await loadComments(CMT_PROJECT);
    }catch(e){ alert('Accept failed: '+e.message); }
    acc.disabled=false;
  });
});
