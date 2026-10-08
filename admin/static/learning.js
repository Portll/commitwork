// Learning mode — the client half. Extracted from index.html 2026-08-26.
//
// fact: this module MUST load before the inline panel script / setView() calls learnPaint() unconditionally at boot, so the function has to exist before the first dispatch (expiry: if setView stops calling it, prev: broken)
// fact: LEARN is declared HERE, not in the panel's ROUTER STATE / it travelled with the functions that read it, which is the difference between extracting a view and relocating one (expiry: never, prev: duplicated)
// fact: a `let` at the top level of a classic script is a global lexical binding, visible to every script that runs after it / that is what lets the inline script's setView reach LEARN without an export (expiry: if the panel adopts modules, prev: unknown)
let LEARN={on:false,visible:[],dismissed:[],total:0};
// Learning mode. The server decides what is visible; this renders it and reports dismissals back.
function learnEsc(t){return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
// An explainer attaches to any element carrying a data-explain attribute. The id is the contract:
// nothing here writes explainer prose, so a reworded explainer keeps its dismissal.
function learnPaint(){
  document.querySelectorAll('.learn-box').forEach(n=>n.remove());
  const note=document.getElementById('learn-note');
  if(note)note.textContent=LEARN.on?(LEARN.visible.length+' of '+LEARN.total+' shown'):'';
  if(!LEARN.on)return;
  const by={};LEARN.visible.forEach(e=>{by[e.id]=e;});
  document.querySelectorAll('[data-explain]').forEach(host=>{
    const e=by[host.getAttribute('data-explain')];
    if(!e)return;
    const box=document.createElement('div');
    box.className='learn-box';
    const x=document.createElement('button');
    x.type='button';x.className='learn-x';x.setAttribute('aria-label','Dismiss this explanation');
    x.title='Dismiss — it stays dismissed';x.textContent='✕';
    x.addEventListener('click',()=>learnDismiss(e.id));
    const b=document.createElement('b');b.textContent=e.term;
    box.appendChild(x);box.appendChild(b);box.appendChild(document.createTextNode(' '+e.plain));
    host.insertAdjacentElement('afterend',box);
  });
}
async function learnPost(body){
  const t=await csrf();
  const r=await fetch('/api/learning',{method:'POST',headers:{'Content-Type':'application/json','x-cw-csrf':t||''},body:JSON.stringify(body)});
  const j=await r.json();
  if(!j.ok)throw new Error(j.error||('HTTP '+r.status));
  LEARN=j;learnPaint();return j;
}
async function learnDismiss(id){ try{ await learnPost({dismiss:id}); }catch(e){ alert('Could not dismiss: '+e.message); } }
async function loadLearning(){
  try{
    const j=await (await fetch('/api/learning')).json();
    if(!j.ok)throw new Error(j.error||'unavailable');
    LEARN=j;
    const cb=document.getElementById('learn-on'); if(cb)cb.checked=!!j.on;
    if(!j.registryOk){const n=document.getElementById('learn-note');if(n)n.textContent='explainers unavailable';}
    learnPaint();
  }catch(_){ /* the panel works without it; a failed explainer fetch must not break a view */ }
}
document.addEventListener('DOMContentLoaded',function(){
  const cb=document.getElementById('learn-on');
  if(!cb)return;
  cb.addEventListener('change',async()=>{
    try{ await learnPost({on:cb.checked}); }
    catch(e){ cb.checked=!cb.checked; alert('Could not change Learning mode: '+e.message); }
  });
  loadLearning();
});
