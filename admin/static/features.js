// Experimental feature flags — the client half. The server (GET /api/features) decides each flag's
// state; this hides switched-off views from navigation, labels switched-on ones "experimental",
// shows a notice on a switched-off view's URL, and renders the Settings switches.
//
// fact: loaded before the panel client, like learning.js / setView() and navigationTabs() call featureOffFlag(), so it must exist before the first dispatch (expiry: if the panel adopts modules, prev: not built)
// fact: until /api/features answers, nothing is hidden / the default is every flag on, so an unanswered fetch is the default state rather than a guess (expiry: never, prev: not built)
let FEATURES={ok:false,flags:[]};
function featEsc(t){return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
/** The flag that owns view v: declared by view name, or by the nav group the view sits in. */
function featureFlagOf(v){
  const g=typeof groupOf==='function'?groupOf(v):null;
  return FEATURES.flags.find(f=>(f.views||[]).includes(v)||(g&&(f.navGroups||[]).includes(g)))||null;
}
function featureOffFlag(v){const f=featureFlagOf(v);return f&&!f.on?f:null;}
// ── THE CLIENT READ API ──────────────────────────────────────────────────────────────────────
// featureOn(id): the server's answer for a declared flag; true until /api/features answers (the
// default is on) and for an id the server did not list. featureApply(el,id): hide el while the flag
// is off, tag it "experimental" while on; re-run it from a 'cw:features' listener, which fires on
// every load and switch with the new state as event.detail.
function featureOn(id){const f=FEATURES.flags.find(x=>x.id===id);return f?!!f.on:true;}
function featureApply(el,id){
  if(!el)return;
  const f=FEATURES.flags.find(x=>x.id===id),off=!!(f&&!f.on);
  el.classList.toggle('fhide',off);
  let tag=el.querySelector(':scope > .exp-tag');
  if(f&&f.on){if(!tag){tag=document.createElement('span');tag.className='exp-tag';tag.textContent='experimental';el.appendChild(tag);}tag.title=`flag ${f.id} — ${f.why}`;}
  else if(tag)tag.remove();
}
function featureOffText(f){
  const by=String(f.source||'').startsWith('env:')?f.source.slice(4):null;
  return `The experimental feature "${f.label}" (flag ${f.id}) is switched off, so this view is hidden. `
    +(by?`It is set by ${by} in the panel's environment; set ${f.envVar}=on${by===f.envVar?'':' or unset '+by} and restart the panel.`
        :`Switch it on under Settings → Experimental features, or set ${f.envVar}=on.`);
}
/** Mark every nav entry for the current flag state. applyGroup() calls this on every pass, so a
 *  lane tab generated after the flags arrived is marked too. */
function featureMarkNav(){
  const entries=[...document.querySelectorAll('#views .vtab'),...document.querySelectorAll('[data-route]')];
  for(const el of entries){
    const v=el.dataset.v||el.dataset.route,f=featureFlagOf(v),off=!!(f&&!f.on);
    el.classList.toggle('fhide',off);
    if(off){el.setAttribute('data-feature-off',f.id);el.classList.add('ghide');}else el.removeAttribute('data-feature-off');
    let tag=el.querySelector(':scope > .exp-tag');
    if(f&&f.on){
      if(!tag){tag=document.createElement('span');tag.className='exp-tag';tag.textContent='experimental';
        const vn=el.querySelector(':scope > .vn');vn?el.insertBefore(tag,vn):el.appendChild(tag);}
      tag.title=`flag ${f.id} — ${f.why}`;
    }else if(tag)tag.remove();
  }
}
/** Apply a new flag state: re-route the view on screen (which re-marks the nav) and redraw the switches. */
function featurePaint(){
  if(typeof curView!=='undefined'&&typeof setView==='function')setView(curView,true);else featureMarkNav();
  renderFeatureSwitches();
  document.dispatchEvent(new CustomEvent('cw:features',{detail:FEATURES}));
}
function renderFeatureSwitches(){
  const rows=document.getElementById('feat-rows');if(!rows)return;
  const warn=document.getElementById('feat-warn'),n=document.getElementById('feat-n');
  const msgs=[FEATURES.charterError,FEATURES.storeError&&`the settings store could not be read (${FEATURES.storeError}) — every flag the environment does not set reads ON, and switching is refused until it is repaired`].filter(Boolean);
  if(warn){warn.textContent=msgs.join(' · ');warn.classList.toggle('jshide',!msgs.length);}
  if(n)n.textContent=FEATURES.flags.length?`${FEATURES.flags.filter(f=>!f.on).length} of ${FEATURES.flags.length} off`:'—';
  rows.innerHTML=FEATURES.flags.map(f=>{
    const env=String(f.source||'').startsWith('env:');
    return `<div class="set-row" data-flag="${featEsc(f.id)}">
      <div class="set-lbl"><b>${featEsc(f.label)}</b> <code>${featEsc(f.id)}</code>
        <div class="mut t-meta">${featEsc(f.why)} · ${featEsc(f.groups.join(', '))}</div></div>
      <div class="set-val"><label><input type="checkbox" class="feat-on" data-flag="${featEsc(f.id)}" ${f.on?'checked':''} ${env?'disabled':''}> on</label>
        <span class="pill ${f.source==='default'?'na':(env?'plan':'part')}">${featEsc(f.source)}</span></div>
      <div class="set-note mut">${env?`set by <code>${featEsc(f.source.slice(4))}</code> — the env wins at read time, so this switch is disabled`:`env <code>${featEsc(f.envVar)}</code>`}</div>
    </div>`;
  }).join('')||'<div class="mut">no experimental flags declared</div>';
}
async function featureSet(id,on){
  const t=await csrf();
  const r=await fetch('/api/features',{method:'POST',headers:{'Content-Type':'application/json','x-cw-csrf':t||''},body:JSON.stringify({flag:id,on})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));
  FEATURES=j;featurePaint();
}
async function loadFeatures(){
  try{
    const j=await (await fetch('/api/features')).json();
    if(!Array.isArray(j.flags))throw new Error(j.error||'unavailable');
    FEATURES=j;featurePaint();
  }catch(e){
    const warn=document.getElementById('feat-warn');
    if(warn){warn.textContent='feature flags could not be read ('+e.message+') — nothing is hidden';warn.classList.remove('jshide');}
  }
}
document.addEventListener('change',async(e)=>{
  const cb=e.target.closest&&e.target.closest('input.feat-on[data-flag]');if(!cb)return;
  try{await featureSet(cb.dataset.flag,cb.checked);}
  catch(err){cb.checked=!cb.checked;alert('Could not switch '+cb.dataset.flag+': '+err.message);}
});
document.addEventListener('DOMContentLoaded',loadFeatures);
