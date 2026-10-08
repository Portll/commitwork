// admin/static/panel-settings.js — part 7 of 8 of the panel client.
//
// the Settings view, vuln-intel source keys, local models, scanner performance and the SAST
// sub-menu. admin/menus/account-menu.js loads next.
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

// ── SETTINGS view ───────────────────────────────────────────────────────────────────────────────
// One fetch feeds all four blocks. They are rendered from the SAME payload deliberately: the
// exceedance table is only meaningful against the thresholds that produced it, and refetching them
// separately is how a count ends up beside a rule that no longer applies.
let setState=null;
const SET_MIN=60000, SET_HOUR=3600000;
// Durations are entered and shown in MINUTES. The store keeps ms because every consumer does; the
// conversion lives here, once, so no other reader has to know the unit the operator typed in.
const setToMin=(ms)=>ms==null?'':String(Math.round(ms/SET_MIN));
const setFromMin=(v)=>{const n=Number(String(v).trim());return Number.isFinite(n)&&n>0?Math.round(n*SET_MIN):null;};
const setDur=(ms)=>{if(ms==null)return '<span class="mut">off</span>';
  const m=Math.round(ms/SET_MIN);return m>=120?`${(m/60).toFixed(m%60?1:0)}h`:`${m}m`;};
const SET_TONE={running:'live','overrunning':'part','kill-eligible':'crit',hung:'crit',unknown:'unk'};

async function loadSettings(){
  const g=$('set-globals');
  g.innerHTML='<div class="mut">loading…</div>';
  let d;
  try{ d=await (await fetch('/api/settings')).json(); }
  catch(e){ g.innerHTML='<div class="pk-err">could not reach the panel — thresholds are UNKNOWN, not default</div>'; setTabN('settings',null); return; }
  if(!d||!d.ok){ g.innerHTML=`<div class="pk-err">${esc((d&&d.error)||'settings unavailable')}</div>`; setTabN('settings',null); return; }
  setState=d;
  renderSettings(d);
  loadLocalModels();
  loadIntegrations();
  loadAgentSurface();
}

// ── AI agent controls: the guards/MCP/launch entries commitwork can toggle. Read-mostly; a toggle is
// an actuator, so it goes through cwPost (CSRF) and re-reads the three states from the reply.
const AS_TONE={true:'live',false:'plan',null:'unk'};
function asBadge(v){ return `<span class="pill ${AS_TONE[String(v)]||'unk'}">${v===true?'yes':v===false?'no':'—'}</span>`; }
function renderAgentSurface(entries){
  const rows=$('as-rows');
  if(!Array.isArray(entries)||!entries.length){ rows.innerHTML='<div class="mut">no agent-surface entries declared</div>'; setTabN('settings',null); return; }
  rows.innerHTML=entries.map(e=>{
    const canToggle=e.kind==='hook'||e.kind==='mcp';
    const on=e.registered===true;
    const btn=canToggle?`<button type="button" class="btn as-toggle" data-id="${esc(e.id)}" data-action="${on?'disable':'enable'}">${on?'Disable':'Enable'}</button>`:'<span class="mut">launchctl</span>';
    return `<div class="kv"><div><b>${esc(e.id)}</b> <span class="mut">${esc(e.kind)}</span><br><span class="mut">${esc(e.why||'')}</span></div>`
      +`<div>registered ${asBadge(e.registered)} · live ${asBadge(e.live)} · installed ${asBadge(e.installed)}${e.liveWhy?` <span class="mut">(${esc(e.liveWhy)})</span>`:''}<br>${btn}</div></div>`;
  }).join('');
}
async function loadAgentSurface(){
  const warn=$('as-warn'), rows=$('as-rows');
  warn.classList.add('jshide');
  try{
    const r=await fetch('/api/agent-surface'); const j=await r.json();
    if(!r.ok||!j.ok){ warn.textContent=(j&&j.error)||'agent surface unavailable'; warn.classList.remove('jshide'); rows.innerHTML=''; return; }
    $('as-n').textContent=j.entries.length; renderAgentSurface(j.entries);
  }catch(e){ warn.textContent='could not reach the panel — agent surface is UNKNOWN, not empty'; warn.classList.remove('jshide'); rows.innerHTML=''; }
}
document.addEventListener('click',async ev=>{
  const b=ev.target.closest&&ev.target.closest('.as-toggle'); if(!b)return;
  const id=b.dataset.id, action=b.dataset.action; b.disabled=true; b.textContent='…';
  try{
    const r=await cwPost('/api/agent-surface',{headers:{'content-type':'application/json'},body:JSON.stringify({id,action})});
    const j=await r.json();
    if(j&&j.state&&Array.isArray(j.state.entries)) renderAgentSurface(j.state.entries);
    else{ const w=$('as-warn'); w.textContent=(j&&j.error)||'toggle failed'; w.classList.remove('jshide'); loadAgentSurface(); }
  }catch(e){ const w=$('as-warn'); w.textContent='toggle failed — the panel did not answer'; w.classList.remove('jshide'); loadAgentSurface(); }
});

// ── Vuln-intel source keys: same "loaded on its own" split as Local models — a credential store's
// own failure must not blank the sweep-threshold cards beside it, and vice versa.
const IG_SOURCE_TONE={env:'live',stored:'live',none:'plan',unknown:'unk'};
// The VulnCheck KEV cache the rollup reads. Kept from the last GET: the write routes return sources only.
let igKevCache=null;
function kevCacheLine(c){
  if(c===null||c===undefined)return '<span class="mut">KEV catalogue never fetched — findings read as not consulted</span>';
  if(c.error)return '<span class="pill unk">KEV cache unreadable</span> <span class="mut">'+esc(c.error)+'</span>';
  return '<span class="mut">KEV catalogue: '+esc(String(c.entries))+' entries, fetched '+esc(c.fetchedAt)+'</span>';
}
async function loadIntegrations(){
  const warn=$('ig-warn'), rows=$('ig-rows');
  try{
    const r=await fetch('/api/integrations');
    const j=await r.json();
    if(!r.ok||!j.ok){
      warn.textContent='sources could not be read ('+esc((j&&j.error)||r.status)+') — this is NOT the same as none configured';
      warn.style.display='block'; rows.innerHTML=''; return;
    }
    warn.style.display='none';
    igKevCache=j.kevCache;
    renderIntegrations(j.sources);
  }catch(e){ warn.textContent='could not reach the server — '+esc(e.message); warn.style.display='block'; }
}
function renderIntegrations(sources){
  $('ig-n').textContent=(sources||[]).filter(s=>s.source==='env'||s.source==='stored').length+'/'+(sources||[]).length;
  $('ig-rows').innerHTML=(sources||[]).map(s=>`
    <div class="kv">
      <span class="mut">${esc(s.label)}</span>
      <span>
        <span class="pill ${esc(IG_SOURCE_TONE[s.source]||'unk')}">${s.key?esc(s.key):'not configured'}${s.source!=='none'?' · '+esc(s.source):''}</span>
        ${s.source==='stored'?`<button type="button" class="btn" data-ig-remove="${esc(s.name)}">remove</button>`:''}
        ${s.source!=='env'?`<input type="password" placeholder="paste key" class="ig-key-input" data-ig-name="${esc(s.name)}" size="24">
         <button type="button" class="btn" data-ig-set="${esc(s.name)}">save</button>`:`<span class="mut">set via ${esc(s.envVar)} — the panel cannot override an env var</span>`}
      </span>
    </div>${s.name==='vulncheck'?`
    <div class="kv">
      <span class="mut">VulnCheck KEV</span>
      <span>${kevCacheLine(igKevCache)}
        ${s.source==='env'||s.source==='stored'?'<button type="button" class="btn" data-ig-refresh>refresh catalogue</button>':''}
      </span>
    </div>`:''}`).join('');
}
document.addEventListener('click',async(e)=>{
  const setBtn=e.target.closest('[data-ig-set]');
  if(setBtn){
    const name=setBtn.dataset.igSet;
    const input=document.querySelector(`input[data-ig-name="${name}"]`);
    const key=input?input.value.trim():'';
    if(!key)return;
    setBtn.disabled=true;
    try{
      const r=await cwPost('/api/integrations',{headers:{'content-type':'application/json'},body:JSON.stringify({name,key})});
      const j=await r.json();
      if(j.ok)renderIntegrations(j.sources); else alert(j.error||'could not save');
    }catch(err){ alert(err.message); } finally{ setBtn.disabled=false; }
    return;
  }
  const refreshBtn=e.target.closest('[data-ig-refresh]');
  if(refreshBtn){
    refreshBtn.disabled=true;
    try{
      const r=await cwPost('/api/integrations/vulncheck/refresh',{headers:{'content-type':'application/json'},body:'{}'});
      const j=await r.json();
      if(j.ok)loadIntegrations(); else alert(j.error||'could not refresh the catalogue');
    }catch(err){ alert(err.message); } finally{ refreshBtn.disabled=false; }
    return;
  }
  const rmBtn=e.target.closest('[data-ig-remove]');
  if(rmBtn){
    const name=rmBtn.dataset.igRemove;
    if(!confirm(`remove the stored key for ${name}?`))return;
    rmBtn.disabled=true;
    try{
      const r=await cwPost('/api/integrations/remove',{headers:{'content-type':'application/json'},body:JSON.stringify({name})});
      const j=await r.json();
      if(j.ok)renderIntegrations(j.sources); else alert(j.error||'could not remove');
    }catch(err){ alert(err.message); } finally{ rmBtn.disabled=false; }
  }
});

const GB=1024**3;
function sysCard(s){
  if(!s)return '<div class="set-sys mut">system readings unavailable</div>';
  const n=(v,suf='')=>v==null?'<span class="mut">unknown</span>':esc(String(v))+suf;
  const ram=s.ramBytes?(s.ramBytes/GB).toFixed(0):null;
  const free=s.freeBytes?(s.freeBytes/GB).toFixed(1):null;
  const used=(s.ramBytes&&s.freeBytes)?Math.round((1-s.freeBytes/s.ramBytes)*100):null;
  const cpu=[s.perfCores!=null?`${s.perfCores}P`:null,s.effCores!=null?`${s.effCores}E`:null].filter(Boolean).join('+');
  return `<div class="set-sys">
    <b>${n(s.model)}</b> <span class="mut">${n(s.arch)} · ${n(s.platform)}</span>
    <div class="sys-grid">
      <div><span class="mut">CPU</span> ${n(s.logicalCores)} cores${cpu?` <span class="mut">(${cpu})</span>`:''}</div>
      <div><span class="mut">GPU</span> ${n(s.gpuCores,' cores')}</div>
      <div><span class="mut">Memory</span> ${n(ram,' GB')}${used!=null?` <span class="mut">· ${used}% used, ${free} GB free</span>`:''}</div>
      <div><span class="mut">Load (1m)</span> ${n(s.load1==null?null:s.load1.toFixed(2))}${s.logicalCores&&s.load1!=null?` <span class="mut">of ${s.logicalCores}</span>`:''}</div>
    </div>
  </div>`;
}

const DUR_MS={min:60_000,hr:3_600_000,day:86_400_000};
const DUR_MAX={min:120,hr:72,day:30};
const DUR_LABEL={min:'MINS',hr:'HOURS',day:'DAYS'};
const DUR_ORDER=['min','hr','day'];

// coarsest exact unit: 24h reads as 1 DAY, not 1440 MINS
function durUnitFor(ms){
  if(ms==null||!Number.isFinite(ms))return 'hr';
  for(const u of ['day','hr']) if(ms>=DUR_MS[u]&&ms%DUR_MS[u]===0)return u;
  return 'min';
}

// shape from spec.unit, not the key name
function setKind(spec){
  const u=String(spec&&spec.unit||'');
  if(u==='ms')return 'ms';
  if(/^level /.test(u))return 'level';
  if(u.includes('→'))return 'opaque';
  // One pick from declared options is a dropdown, not a checkbox set: `unit: 'choice'` is how a
  // key declares single-select. This branch sits BEFORE the array check so an array-valued key
  // (reportFormats) keeps its checkboxes untouched.
  if(u==='choice'&&Array.isArray(spec&&spec.options))return 'choice';
  // A key that DECLARES its options is a choice, not a string. Without this an array-valued setting
  // renders as a text box asking an operator to type JSON — which is a control that invites the
  // exact malformed value the server then refuses.
  if(Array.isArray(spec&&spec.options))return 'set';
  return 'text';
}

// ── Local models: per-host enable + model pin, and the three evaluation roles ────────────────────
// Loaded on its own, not folded into renderSettings(d): the posture lives in its own store with its
// own hash, and sharing a render pass would mean one failure blanking the other's card.
let LM = null;

async function loadLocalModels(){
  const warn=$('lm-warn');
  try{
    const r=await fetch('/api/llm/runtime');
    const j=await r.json();
    if(!r.ok||!j.ok){
      // A store that cannot be READ must not render as "everything is off" — that is a real,
      // ordinary posture and the operator would read a fault as their own setting.
      warn.textContent='the local-model posture could not be read ('+esc(j.error||r.status)+') — this is NOT the same as everything being switched off, and nothing below is authoritative until it is repaired';
      warn.style.display='block';
      $('lm-hosts').innerHTML=''; $('lm-roles').innerHTML=''; $('lm-state').textContent='unreadable';
      return;
    }
    warn.style.display='none';
    LM=j; renderLocalModels(j);
  }catch(e){ warn.textContent='could not reach the server — '+esc(e.message); warn.style.display='block'; }
}

function renderLocalModels(j){
  const st=j.state||{};
  $('lm-state').textContent = st.state==='enabled' ? (j.posture.hosts?Object.values(j.posture.hosts).filter(h=>h.enabled).length:0)+' on'
    : st.state==='none-enabled' ? 'none on' : 'off';
  const on = j.posture.hosts||{};
  $('lm-hosts').innerHTML =
    '<label class="kv"><input type="checkbox" id="lm-master"'+(j.posture.enabled?' checked':'')+
    '> <b>Allow local model runners</b> <span class="mut">master switch — off by default</span></label>'
    + j.hosts.map(h=>{
      const cfg=on[h.id]||{};
      // The exposure facts travel with the row. An operator deciding whether to switch something on
      // should not have to go and read a manifest to find out that doing so opens a LAN port.
      const flags=[
        h.bindsAllInterfacesByDefault?'<span class="pill crit" title="'+esc(h.exposureNote||'')+'">binds all interfaces</span>':'',
        h.fetchesModelsOnDemand?'<span class="pill med" title="a request naming an unknown model id can cause a download">fetches models</span>':'',
        h.openSource?'':'<span class="pill" title="closed source — the exposure surface cannot be read, only observed">proprietary</span>',
        '<span class="pill" title="computed from the resolved URL, not declared">'+esc(h.reach||'unknown')+'</span>',
      ].filter(Boolean).join(' ');
      return '<div class="kv"><label><input type="checkbox" data-lm-host data-id="'+esc(h.id)+'"'
        +(cfg.enabled?' checked':'')+'> <b>'+esc(h.label)+'</b></label> '
        +'<span class="mut t-note">'+esc(h.url)+'</span> '+flags+' '
        +'<input type="text" data-lm-model data-id="'+esc(h.id)+'" placeholder="model id" value="'
        +esc(cfg.model||'')+'" aria-label="'+esc('model for '+h.label)+'">'
        +(h.portIsShared?'<span class="mut t-note"> · port shared with other declared hosts, so a probe here cannot confirm which is running</span>':'')
        +'</div>';
    }).join('');

  const enabledHosts=j.hosts.filter(h=>(on[h.id]||{}).enabled);
  $('lm-roles').innerHTML = (j.roleNames||['a','b','adjudicator']).map(role=>{
    const cur=(j.posture.roles||{})[role];
    const resolved=(j.roles||{})[role];
    const opts=['<option value="">— default (nearest by reach) —</option>'].concat(
      enabledHosts.map(h=>'<option value="'+esc(h.id)+'"'+(cur&&cur.host===h.id?' selected':'')+'>'+esc(h.label)+' ('+esc(h.reach||'?')+')</option>')).join('');
    const note = resolved
      ? '<span class="mut t-note">'+esc(resolved.host)+' · '+esc(resolved.model)+' · '+esc(resolved.reach||'?')+' · '+esc(resolved.source)+'</span>'
      : '<span class="mut t-note">unresolved — no enabled host has a model pinned</span>';
    return '<div class="kv"><b>'+esc(role==='adjudicator'?'Adjudicator':role.toUpperCase())+'</b> '
      +'<select data-lm-role data-role="'+esc(role)+'">'+opts+'</select> '
      +'<input type="text" data-lm-role-model data-role="'+esc(role)+'" placeholder="model id" value="'+esc(cur&&cur.model||'')+'" aria-label="'+esc('model for role '+role)+'"> '
      +note+'</div>';
  }).join('');
}

document.addEventListener('click',(e)=>{ if(e.target&&e.target.id==='lm-save') saveLocalModels(); });

async function saveLocalModels(){
  if(!LM) return;
  const msg=$('lm-msg'); msg.textContent='applying…';
  const hosts={};
  document.querySelectorAll('[data-lm-host]').forEach(cb=>{
    const model=(document.querySelector('[data-lm-model][data-id="'+cb.dataset.id+'"]')||{}).value||'';
    hosts[cb.dataset.id]={enabled:cb.checked, model:model.trim()||null};
  });
  const roles={};
  document.querySelectorAll('[data-lm-role]').forEach(sel=>{
    const model=((document.querySelector('[data-lm-role-model][data-role="'+sel.dataset.role+'"]')||{}).value||'').trim();
    if(sel.value&&model) roles[sel.dataset.role]={host:sel.value, model};
  });
  const body={enabled:$('lm-master').checked, hosts, roles, hash:LM.hash};
  try{
    const r=await fetch('/api/llm/runtime',{method:'PUT',headers:{'content-type':'application/json','x-csrf-token':(window.CSRF||'')},body:JSON.stringify(body)});
    const j=await r.json();
    if(!r.ok||!j.ok){ msg.textContent=(j.error||('HTTP '+r.status)); return; }
    // The warnings are the point of the write, not a footnote: they name what was just authorised.
    msg.textContent = j.warnings&&j.warnings.length ? 'applied — '+j.warnings.join(' · ') : 'applied';
    LM={...LM,...j}; renderLocalModels(LM);
  }catch(e){ msg.textContent='could not reach the server — '+e.message; }
}

function renderSettings(d){
  // A store that could not be READ must not render as "these are the defaults" — the values shown
  // would be real but the reason for them would be a lie.
  const warn=$('set-store-warn');
  if(d.storeError){ warn.textContent=`the settings store could not be read (${d.storeError}) — values below are env/defaults, and nothing written here will apply until it is repaired`; warn.style.display='block'; }
  else warn.style.display='none';

  $('set-globals').innerHTML=sysCard(d.system)+Object.entries(d.keys).map(([k,spec])=>{
    const s=d.settings[k]||{};
    const shadowed=s.source==='env';
    const kind=setKind(spec);
    let control,suffix='',dflt;
    if(kind==='ms'){
      const u=durUnitFor(s.value);
      const n=s.value==null?'':String(Math.round(s.value/DUR_MS[u]));
      control=`<input type="range" class="set-durslider" min="1" max="${DUR_MAX[u]}" step="1"
                 value="${esc(n===''?1:n)}" ${shadowed?'disabled':''}>
        <input type="number" min="1" step="1" class="set-input set-durnum" value="${esc(n)}"
               placeholder="${spec.nullable?'blank = off':''}" ${shadowed?'disabled':''}>
        <span class="dur-units">${DUR_ORDER.map(x=>
          `<button type="button" class="dur-u${x===u?' on':''}" data-u="${x}" ${shadowed?'disabled':''}>${DUR_LABEL[x]}</button>`).join('')}</span>`;
      dflt=setDur(spec.default);
    } else if(kind==='level'){
      const v=Number.isFinite(Number(s.value))?Number(s.value):Number(spec.default);
      control=`<input type="range" min="1" max="5" step="1" class="set-input set-slider" value="${esc(v)}" ${shadowed?'disabled':''}>
               <output class="set-out">${esc(v)}</output>`;
      suffix='<span class="mut">of 5</span>';
      dflt=String(spec.default);
    } else if(kind==='choice'){
      // One <select> rendered FROM spec.options — the same no-second-list contract as the checkbox
      // set below. The selected option's note renders under the control so the operator reads what
      // the choice DOES before saving it, not after.
      const v=s.value==null?spec.default:s.value;
      control=`<select class="set-input" ${shadowed?'disabled':''}>`+(spec.options||[]).map(o=>
        `<option value="${esc(o.id)}" ${o.id===v?'selected':''}>${esc(o.label||o.id)}</option>`).join('')+`</select>`
        +`<div class="mut set-opt-n set-choice-note">${esc(((spec.options||[]).find(o=>o.id===v)||{}).note||'')}</div>`;
      const dOpt=(spec.options||[]).find(o=>o.id===spec.default);
      dflt=dOpt?dOpt.label:String(spec.default);
    } else if(kind==='set'){
      // One checkbox per DECLARED option. `value` null means "the built-in default set", which is
      // not the same as an empty selection: unchecking everything is a deliberate request to publish
      // nothing, and the two must not render identically. The hidden .set-input carries the JSON so
      // the save loop below reads one field per row whatever the control looks like.
      const sel=Array.isArray(s.value)?s.value:null;
      const on=(id)=>(sel?sel.includes(id):false);
      control=`<div class="set-opts">`+(spec.options||[]).map(o=>
        `<label class="set-opt${on(o.id)?' on':''}"><input type="checkbox" data-opt="${esc(o.id)}" ${on(o.id)?'checked':''} ${shadowed?'disabled':''}>`
        +`<span class="set-opt-l">${esc(o.label||o.id)}</span>`
        +(o.note?`<span class="set-opt-n mut">${esc(o.note)}</span>`:'')+`</label>`).join('')
        +`<input type="hidden" class="set-input" value="${esc(sel?JSON.stringify(sel):'')}">`
        +(sel?'':`<div class="mut set-opt-n">nothing selected — the built-in default set is published. Tick a box to pin an explicit list.</div>`)
        +`</div>`;
      dflt=spec.default==null?'the default set':JSON.stringify(spec.default);
    } else if(kind==='opaque'){
      const n=s.value&&typeof s.value==='object'?Object.keys(s.value).length:0;
      control=`<span class="mut">${n?`${n} override(s) set`:'none'} — edit ${k==='experimentalFeatures'?'under Experimental features above':'in the Perf tab'}</span>`;
      dflt='none';
    } else {
      control=`<input type="text" class="set-input" value="${esc(s.value==null?'':s.value)}"
               placeholder="${spec.nullable?'blank = auto-detect':esc(spec.unit||'')}" ${shadowed?'disabled':''}>`;
      dflt=spec.default==null?(spec.nullable?'auto-detect':'none'):String(spec.default);
    }
    return `<div class="set-row" data-k="${esc(k)}" data-kind="${esc(kind)}">
      <div class="set-lbl"><b>${esc(spec.label)}</b>
        <div class="mut t-meta">${esc(spec.description||'')}</div></div>
      <div class="set-val">${control}${suffix}
        <span class="pill ${s.source==='default'?'na':(s.source==='env'?'plan':'part')}">${esc(s.source||'?')}</span>
      </div>
      <div class="set-note mut">${shadowed
        ? `set by <code>${esc(spec.envVar)}</code> in this process's environment — the env wins at read time, so this field is disabled rather than pretending a write would take effect`
        : `default ${esc(dflt)} · env <code>${esc(spec.envVar)}</code>`}</div>
    </div>`;
  }).join('')+`<div class="row-actions gap-top"><button type="button" id="set-save" class="pri">save thresholds</button>
    <span id="set-save-msg" class="mut"></span></div>`;
  document.querySelectorAll('#set-globals .set-slider').forEach(sl=>{
    sl.oninput=()=>{ const o=sl.parentElement.querySelector('.set-out'); if(o)o.textContent=sl.value; };
  });
  // A choice's note follows the selection, so the caveat an operator reads is the one for the
  // value they are ABOUT to save, not the one that was in force when the page rendered.
  document.querySelectorAll('#set-globals .set-row[data-kind="choice"]').forEach(row=>{
    const sel=row.querySelector('select.set-input'), note=row.querySelector('.set-choice-note');
    if(!sel||!note)return;
    sel.onchange=()=>{ const spec=(setState&&setState.keys&&setState.keys[row.dataset.k])||{};
      note.textContent=(((spec.options||[]).find(o=>o.id===sel.value)||{}).note)||''; };
  });
  document.querySelectorAll('#set-globals .set-row[data-kind="ms"]').forEach(row=>{
    const sl=row.querySelector('.set-durslider'), num=row.querySelector('.set-durnum');
    // box is the value; typing past the slider max is the exact override
    sl.oninput=()=>{ num.value=sl.value; };
    num.oninput=()=>{ const n=Number(num.value); if(Number.isFinite(n)&&n>=1)sl.value=String(Math.min(n,Number(sl.max))); };
    row.querySelectorAll('.dur-u').forEach(btn=>{
      btn.onclick=()=>{
        const from=row.querySelector('.dur-u.on').dataset.u, to=btn.dataset.u;
        if(from===to)return;
        const ms=(Number(num.value)||0)*DUR_MS[from];
        row.querySelectorAll('.dur-u').forEach(b=>b.classList.toggle('on',b===btn));
        sl.max=String(DUR_MAX[to]);
        const n=ms?Math.max(1,Math.round(ms/DUR_MS[to])):'';
        num.value=n===''?'':String(n);
        sl.value=String(Math.min(Number(n)||1,DUR_MAX[to]));
      };
    });
  });

  // ── exceedance report ──
  const h=d.health||{};
  const rows=h.rows||[];
  const over=(h.counts&&((h.counts.overrunning||0)+(h.counts['kill-eligible']||0)+(h.counts.hung||0)))||0;
  setTabN('settings', h.ok?over:null, 'sweeps at or past a threshold');
  $('set-health-n').textContent=h.ok?`${rows.length} in flight`:'unknown';
  $('set-health-rows').innerHTML=!h.ok
    ? `<tr><td colspan="7" class="mut">${esc(h.error||'sweep health could not be computed — this is UNKNOWN, not "nothing is overrunning"')}</td></tr>`
    : (rows.length?rows.map(r=>`<tr>
        <td><b class="name">${esc(r.areaOut)}</b>${r.sliceId?`<div class="mut t-meta">${esc(r.sliceId)}</div>`:''}</td>
        <td><span class="pill ${SET_TONE[r.state]||'unk'}">${esc(r.state)}</span></td>
        <td class="tnum">${r.ageMs==null?'<span class="mut">—</span>':setDur(r.ageMs)}</td>
        <td class="tnum">${setDur(r.hangMs)}<div class="mut t-meta">${esc((r.thresholdSource||{}).hangMs||'')}</div></td>
        <td class="tnum">${setDur(r.killMs)}<div class="mut t-meta">${esc((r.thresholdSource||{}).killMs||'')}</div></td>
        <td class="tnum">${r.pid==null?'<span class="mut">—</span>':`${r.pid} ${r.pidAlive===true?'<span class="pill live">alive</span>':(r.pidAlive===false?'<span class="pill crit">dead</span>':'<span class="pill unk">?</span>')}`}</td>
        <td class="mut cell-wrap">${(r.reasons||[]).map(esc).join('<br>')}</td>
      </tr>`).join('')
      :'<tr><td colspan="7" class="mut">no sweep is in flight — nothing to measure against a threshold</td></tr>');
  const unread=(h.unreadable||[]).length;
  $('set-health-warn').innerHTML=unread
    ? `<b class="txt-crit">${unread} marker(s) could not be read</b> — they are neither running nor clear, and are excluded from every count above rather than guessed at.`
    : '';

  // ── override tables ──
  $('set-rules').innerHTML=Object.entries(d.tables).map(([t,spec])=>{
    const rows=(d.rules&&d.rules[t])||[];
    const err=(d.ruleErrors&&d.ruleErrors[t])||null;
    return `<div class="set-table" data-t="${esc(t)}">
      <div class="hd"><h4>${esc(spec.label)}</h4><span class="mut hd-note">overrides <code>${esc(spec.key)}</code></span></div>
      ${err?`<div class="pk-err">${esc(err)}</div>`:''}
      <div class="tw"><table>
        <thead><tr><th>INCLUDE</th><th>DIRECTORY</th><th>Name</th><th>${t==='cadence'?'every (min)':'minutes'}</th><th></th></tr></thead>
        <tbody>${rows.map((r,i)=>setRuleRow(t,r,i)).join('')||''}
          <tr class="set-addrow"><td colspan="5"><button type="button" class="set-add" data-t="${esc(t)}">+ add rule</button></td></tr>
        </tbody>
      </table></div>
      <div class="row-actions"><button type="button" class="set-rules-save" data-t="${esc(t)}">save ${esc(t)} rules</button>
        <span class="set-rules-msg mut"></span></div>
    </div>`;
  }).join('');

  // ── cadence in force ──
  const areas=d.areas||[];
  $('set-cad-n').textContent=`${areas.filter(a=>a.cadenceMs!=null).length} declared`;
  $('set-cad-rows').innerHTML=areas.map(a=>`<tr>
      <td><b class="name">${esc(a.label)}</b>${a.slug!==a.out?`<div class="mut t-meta">reports/${esc(a.out)}</div>`:''}</td>
      <td class="tnum">${a.cadenceMs==null?setDur(d.settings.sweepCadenceMs.value):setDur(a.cadenceMs)}</td>
      <td><span class="pill ${a.cadenceSource==='registry'?'part':'na'}">${esc(a.cadenceSource)}</span></td>
    </tr>`).join('');
}

function setRuleRow(t,r,i){
  return `<tr class="set-rule">
    <td><select class="set-inc"><option value="1"${r.include!==false?' selected':''}>INCLUDE</option><option value="0"${r.include===false?' selected':''}>EXCLUDE</option></select></td>
    <td><input class="set-dir" value="${esc(r.directory==null?'*':r.directory)}" placeholder="*"></td>
    <td><input class="set-name" value="${esc(r.name==null?'':r.name)}" placeholder="area or repo"></td>
    <td><input class="set-v" type="number" min="1" step="1" value="${esc(r.value==null?'':setToMin(r.value))}" placeholder="${r.include===false?'n/a':'minutes'}"></td>
    <td><button type="button" class="set-del" title="remove this rule">×</button></td>
  </tr>`;
}

// Add / remove operate on the DOM only; nothing persists until the table's save button is pressed,
// so a half-typed rule is never written and an accidental click is never a change to the fleet.
document.addEventListener('click',(e)=>{
  const add=e.target.closest&&e.target.closest('button.set-add');
  if(add){ const tb=add.closest('tbody'); const tr=document.createElement('tr'); tr.innerHTML=setRuleRow(add.dataset.t,{include:true,directory:'*',name:''},-1); tr.className='set-rule';
    tb.insertBefore(tr,add.closest('tr')); const n=tr.querySelector('.set-name'); if(n)n.focus(); return; }
  const del=e.target.closest&&e.target.closest('button.set-del');
  if(del){ const tr=del.closest('tr'); if(tr)tr.remove(); return; }
},false);

document.addEventListener('click',async(e)=>{
  const b=e.target.closest&&e.target.closest('#set-save'); if(!b||b.disabled)return;
  const msg=$('set-save-msg');
  const patch={};
  for(const row of document.querySelectorAll('#set-globals .set-row')){
    const inp=row.querySelector('.set-input'); if(!inp||inp.disabled)continue;
    const k=row.dataset.k, kind=row.dataset.kind, raw=(inp.value||'').trim();
    const spec=(setState&&setState.keys&&setState.keys[k])||{};
    // A `set` carries its value in checkboxes, not in the hidden input, so the blank test below
    // would read "no ticks" as "field left empty" and null the key — silently turning an explicit
    // publish-nothing into a fall-back-to-defaults.
    if(raw==='' && kind!=='set'){
      if(spec.nullable){patch[k]=null;continue;}
      msg.className='mut bad'; msg.textContent=`${spec.label||k} cannot be blank`; return;
    }
    if(kind==='ms'){
      const on=row.querySelector('.dur-u.on');
      const mult=DUR_MS[(on&&on.dataset.u)||'min'];
      const n=Number(raw);
      if(!Number.isFinite(n)||n<=0){ msg.className='mut bad'; msg.textContent=`${spec.label||k}: enter a positive number`; return; }
      patch[k]=Math.round(n*mult);   // back to ms — the unit buttons are display only
    } else if(kind==='level'){
      const n=Number(raw);
      if(!Number.isInteger(n)||n<1||n>5){ msg.className='mut bad'; msg.textContent=`${spec.label||k}: must be 1-5`; return; }
      patch[k]=n;
    } else if(kind==='set'){
      patch[k]=[...row.querySelectorAll('input[type=checkbox][data-opt]')].filter(c=>c.checked).map(c=>c.dataset.opt);
    } else {
      patch[k]=raw;   // server-side validate() is the authority on shape
    }
  }
  // the control rounds to whole units; only changed keys are sent
  for(const k of Object.keys(patch)){
    const cur=(setState&&setState.settings&&setState.settings[k])||{};
    if(JSON.stringify(cur.value)===JSON.stringify(patch[k]))delete patch[k];
  }
  if(!Object.keys(patch).length){ msg.className='mut'; msg.textContent='nothing changed'; return; }
  b.disabled=true; const was=b.textContent; b.textContent='saving…';
  let r,j;
  try{ r=await cwPost('/api/settings',{headers:{'content-type':'application/json'},body:JSON.stringify({settings:patch})}); j=await r.json(); }
  catch(err){ b.disabled=false;b.textContent=was; msg.className='pk-err'; msg.textContent='could not reach the panel — nothing was saved'; return; }
  b.disabled=false; b.textContent=was;
  if(!r.ok||!j.ok){ msg.className='mut bad'; msg.innerHTML='<b>refused</b> — '+esc((j.errors||[j.error||('HTTP '+r.status)]).join('; ')); return; }
  msg.className='mut'; msg.textContent='saved';
  if(j.state)renderSettings(setState=j.state);
},false);

document.addEventListener('click',async(e)=>{
  const b=e.target.closest&&e.target.closest('button.set-rules-save'); if(!b||b.disabled)return;
  const wrap=b.closest('.set-table'), t=b.dataset.t, msg=wrap.querySelector('.set-rules-msg');
  const rows=[];
  for(const tr of wrap.querySelectorAll('tr.set-rule')){
    const include=tr.querySelector('.set-inc').value==='1';
    const directory=(tr.querySelector('.set-dir').value||'').trim();
    const name=(tr.querySelector('.set-name').value||'').trim();
    const vRaw=(tr.querySelector('.set-v').value||'').trim();
    const row={include,directory,name};
    if(include){ const ms=setFromMin(vRaw); if(ms==null){ msg.className='set-rules-msg mut bad'; msg.textContent=`every INCLUDE rule needs a positive value in minutes (row for "${name||'?'}")`; return; } row.value=ms; }
    rows.push(row);
  }
  b.disabled=true; const was=b.textContent; b.textContent='saving…';
  let r,j;
  try{ r=await cwPost('/api/settings/rules',{headers:{'content-type':'application/json'},body:JSON.stringify({table:t,rows})}); j=await r.json(); }
  catch(err){ b.disabled=false;b.textContent=was; msg.className='set-rules-msg pk-err'; msg.textContent='could not reach the panel — nothing was saved'; return; }
  b.disabled=false; b.textContent=was;
  if(!r.ok||!j.ok){ msg.className='set-rules-msg mut bad'; msg.innerHTML='<b>refused</b> — '+esc((j.errors||[j.error||('HTTP '+r.status)]).map(x=>typeof x==='string'?x:JSON.stringify(x)).join('; ')); return; }
  msg.className='set-rules-msg mut'; msg.textContent='saved';
  if(j.state)renderSettings(setState=j.state);
},false);

// ── SCANNER PERFORMANCE ─────────────────────────────────────────────────────────────────────────
// Two knobs and a table, and the table is the point: it answers "which lanes would run, and why
// would the rest not" BEFORE anything is applied, so nobody tunes against an outcome they cannot
// see. Preview is a SEPARATE endpoint that cannot write, called on a 150ms debounce; only Apply
// POSTs. Responses carry a sequence number — a slow preview for depth 2 must never overwrite a
// fast one for depth 4, which is how a slider ends up showing the effect of a setting it left.
let perfData=null, perfTimer=null, perfSeq=0;
// The operator's per-lane forced states, held here between a radio click and Apply. Only ids the
// operator actually forced are kept: 'auto' is the ABSENCE of an override, not a third stored value,
// so a lane handed back to the derivation leaves no trace claiming a decision was made about it.
let perfOverrides={};
const perfLevel=(list,n)=>(list||[]).find(l=>l&&l.level===n)||null;
const perfMs=(ms)=>ms==null?'<span class="mut">—</span>':(ms>=60000?Math.round(ms/60000)+'m':Math.round(ms/1000)+'s');
const PERF_COST={cheap:'live',moderate:'part',expensive:'high'};
const perfSel=()=>({profileId:$('perf-profile').value,depth:+$('perf-depth').value,intensity:+$('perf-intensity').value,overrides:perfOverrides});

async function loadPerf(){
  let d;
  try{ d=await (await fetch('/api/perf')).json(); }
  catch(e){ perfFail('could not reach the panel — the effect of these settings is UNKNOWN, not default'); return; }
  if(!d||!d.ok){ perfFail((d&&d.error)||'scanner performance is unavailable'); return; }
  $('perf-warn').style.display='none';
  perfData=d;
  perfOverrides=(d.overrides&&typeof d.overrides==='object')?Object.assign({},d.overrides):{};
  renderPerfKnobs(d);
  renderPerfTuning(d.tuning,{pending:false,note:d.tuningError});
  loadLaneTiming();
  if(typeof pcLoad==='function')pcLoad();
}

// ── WHAT LANES HAVE ACTUALLY COST ───────────────────────────────────────────────────────────────
// Read from the run records, never from the tuning model. The two answer different questions and
// the page keeps them in different tables for that reason.
const fmtMs=(ms)=>ms==null?'—'
  :ms<1000?ms+'ms'
  :ms<60000?(ms/1000).toFixed(1)+'s'
  :ms<3600000?(ms/60000).toFixed(1)+'m'
  :(ms/3600000).toFixed(1)+'h';

/**
 * A sparkline of daily medians. Self-contained inline SVG — no CDN, `file://` safe, like every
 * other artifact here.
 *
 * A day with no runs is NOT joined across: the series is drawn as separate segments so a gap in the
 * evidence looks like a gap. A single line through it would show a lane as having been measured on
 * days nobody measured it, which is the same false continuity an interpolated point would give.
 */
function sparkline(daily,w,h){
  if(!daily||daily.length<1)return '<span class="mut">—</span>';
  const W=w||160,H=h||24,pad=2;
  const days=daily.map(d=>d.day);
  const t0=Date.parse(days[0]+'T00:00:00Z'),t1=Date.parse(days[days.length-1]+'T00:00:00Z');
  const span=Math.max(1,t1-t0);
  const max=Math.max(...daily.map(d=>d.p50));
  const x=(d)=>pad+((Date.parse(d.day+'T00:00:00Z')-t0)/span)*(W-2*pad);
  const y=(d)=>H-pad-(max?(d.p50/max):0)*(H-2*pad);
  // segments: consecutive calendar days join; a missing day breaks the line
  const segs=[];let cur=[];
  for(let i=0;i<daily.length;i++){
    if(i&&(Date.parse(daily[i].day+'T00:00:00Z')-Date.parse(daily[i-1].day+'T00:00:00Z'))>86400000){segs.push(cur);cur=[];}
    cur.push(daily[i]);
  }
  if(cur.length)segs.push(cur);
  const lines=segs.filter(s=>s.length>1)
    .map(s=>`<polyline fill="none" stroke="var(--acc)" stroke-width="1.25" points="${s.map(d=>x(d).toFixed(1)+','+y(d).toFixed(1)).join(' ')}"/>`).join('');
  // a lone day still gets a mark, or a lane measured exactly once would draw as nothing at all
  const dots=segs.filter(s=>s.length===1)
    .map(s=>`<circle cx="${x(s[0]).toFixed(1)}" cy="${y(s[0]).toFixed(1)}" r="1.75" fill="var(--acc)"/>`).join('');
  const label=`${daily.length} day${daily.length===1?'':'s'} measured, ${days[0]} to ${days[days.length-1]}; peak daily median ${fmtMs(max)}`;
  return `<svg class="lt-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>${lines}${dots}</svg>`;
}

async function loadLaneTiming(){
  const rows=$('lt-rows'); if(!rows)return;
  let d;
  try{ d=await (await fetch('/api/lane-timing?project='+encodeURIComponent(curProj||''))).json(); }
  catch(e){ return laneTimingFail('could not reach the panel — what these lanes have cost is UNKNOWN'); }
  if(!d||d.error)return laneTimingFail((d&&d.error)||'the run records could not be read');
  $('lt-warn').style.display='none';
  const lanes=Object.entries(d.lanes||{}).sort((a,b)=>(b[1].p95||0)-(a[1].p95||0));
  $('lt-n').textContent=lanes.length?lanes.length+' lanes':'none measured';
  if(!lanes.length){
    // Not a clean result, and not a fast one: nothing has been recorded for this subject.
    rows.innerHTML='<tr><td colspan="7" class="mut">No run records for this project'
      +(d.files&&d.files.found?' — '+d.files.found+' status files exist, and none of them are this area’s':'')
      +'. Nothing has been measured here yet, which is not the same as nothing being slow.</td></tr>';
  } else {
    rows.innerHTML=lanes.map(([check,v])=>{
      const notRun=v.skipped+(v.untimed||0);
      const notRunCell=notRun
        ? `<span class="pill plan">${v.skipped} skipped${v.untimed?' · '+v.untimed+' untimed':''}</span>`
        : '<span class="mut">—</span>';
      return `<tr><td><code>${esc(check)}</code></td>`
        +`<td>${v.timed}</td>`
        +`<td>${esc(fmtMs(v.p50))}</td>`
        +`<td>${esc(fmtMs(v.p95))}</td>`
        +`<td>${esc(fmtMs(v.max))}</td>`
        +`<td>${sparkline(v.daily)}</td>`
        +`<td>${notRunCell}</td></tr>`;
    }).join('');
  }
  // The denominator is STATED. A table drawn over some of the records while reading as all of them
  // is the quiet version of the failure this page exists to prevent.
  const f=d.files||{};
  const bits=[f.read+' of '+f.found+' run records read'];
  if(f.unreadable)bits.push('<b>'+f.unreadable+' could not be parsed</b> — those runs are missing from every number here');
  if(f.unattributed)bits.push(f.unattributed+' in batches whose area could not be read, excluded rather than guessed');
  const foot=$('lt-foot');
  if(foot&&!foot.dataset.base)foot.dataset.base=foot.innerHTML;
  if(foot)foot.innerHTML=foot.dataset.base+'<div class="gap-top">'+bits.join(' · ')+'.</div>';
}
function laneTimingFail(msg){
  const w=$('lt-warn'); if(w){w.textContent=msg;w.style.display='block';}
  const rows=$('lt-rows');
  if(rows)rows.innerHTML='<tr><td colspan="7" class="mut">unreadable — this table is UNKNOWN, and is '
    +'deliberately not drawn as a set of fast lanes</td></tr>';
  const n=$('lt-n'); if(n)n.textContent='unknown';
}

// A tuning that could not be resolved renders as UNKNOWN. It must never fall back to a table of
// lanes drawn as "off" — that is the same row an operator reads as "we decided not to run it".
function perfFail(msg){
  const warn=$('perf-warn'); warn.textContent=msg; warn.style.display='block';
  $('perf-rows').innerHTML='<tr><td colspan="9" class="mut">no tuning could be resolved — this table is UNKNOWN, and deliberately not a list of lanes shown as off</td></tr>';
  $('perf-sum').textContent='unknown'; $('perf-n').textContent='unknown';
}

function renderPerfKnobs(d){
  const sel=$('perf-profile');
  sel.innerHTML=(d.profiles||[]).map(p=>{
    const det=d.matched&&d.matched.id===p.id;
    return `<option value="${esc(p.id)}"${p.id===d.profileId?' selected':''}>${esc(p.label||p.id)}${det?' — detected':''}${p.projected?' — PROJECTED':''}</option>`;
  }).join('')||'<option value="">no profile is declared</option>';
  const hw=d.hardware;
  $('perf-hw').innerHTML=hw
    ? `this box: ${esc(hw.cores)} cores · ${esc(hw.ramGB)} GB · ${esc(hw.diskClass||'disk ?')} · ${esc(hw.arch||'')} ${esc(hw.platform||'')}${hw.containers===false?' · no container runtime':''}`
    : `<b class="txt-crit">${esc(d.hardwareError||'hardware could not be read — no profile is matched, and none is assumed')}</b>`;
  const m=d.matched||{};
  const pill=$('perf-match');
  pill.textContent=m.confidence||'unknown';
  pill.className='pill '+(m.confidence==='exact'?'live':(m.confidence==='nearest'?'part':'unk'));
  pill.title=m.why||'';
  // Slider bounds come from the model's declared levels, never hardcoded here — a second copy of
  // the range is a second thing to keep in step with the backend.
  for(const k of ['depth','intensity']){
    const list=k==='depth'?d.depthLevels:d.intensityLevels;
    const lv=(list||[]).map(l=>l.level).filter(n=>typeof n==='number');
    const inp=$('perf-'+k);
    if(lv.length){ inp.min=String(Math.min(...lv)); inp.max=String(Math.max(...lv)); }
    inp.value=String(d[k]);
    perfLabel(k);
  }
  renderPerfProfileNote(d);
}

function perfLabel(k){
  const list=perfData?(k==='depth'?perfData.depthLevels:perfData.intensityLevels):[];
  const n=+$('perf-'+k).value;
  const l=perfLevel(list,n);
  $('perf-'+k+'-label').textContent=l?`${n} · ${l.label}`:String(n);
  $('perf-'+k+'-desc').textContent=l?(l.description||''):'this level is not one the tuning model declares';
}

function renderPerfProfileNote(d){
  const id=$('perf-profile').value;
  const p=(d.profiles||[]).find(x=>x.id===id);
  const src={store:'stored by an operator',env:'set by an environment variable',detected:'auto-detected from this box','first-declared':'a placeholder — nothing was stored and nothing matched this hardware'}[d.profileSource]||d.profileSource||'—';
  const bits=[];
  if(p){
    bits.push(`${esc(p.cores)} cores${p.threads&&p.threads!==p.cores?` / ${esc(p.threads)} threads`:''} · ${esc(p.ramGB)} GB RAM · ${esc(p.diskClass||'disk ?')}${p.containers===false?' · no container runtime':''}`);
    // A projected spec is not a measured one, and the word has to be on the page rather than in a
    // tooltip: a tuning derived from a projection is a prediction about hardware nobody has run.
    if(p.projected)bits.push('<b class="txt-crit">PROJECTED</b> — a vendor specification, not hardware measured here');
    if(p.note)bits.push(esc(p.note));
  }
  bits.push(`selection: ${esc(src)}`);
  if(!d.settingsAvailable){
    const keys=(d.missingSettingKeys||[]).map(k=>`<code>${esc(k)}</code>`).join(', ');
    bits.push(`<b class="txt-crit">these settings cannot be saved yet</b> — ${keys} ${(d.missingSettingKeys||[]).length===1?'is':'are'} not declared in monitor/settings.mjs, so depth ${esc(d.depth)} / intensity ${esc(d.intensity)} above are this page's fallbacks rather than anything in force`);
  }
  (d.notes||[]).forEach(n=>bits.push(esc(n)));
  $('perf-profile-note').innerHTML=bits.join(' · ');
}

function perfQueue(){
  if(perfTimer)clearTimeout(perfTimer);
  $('perf-sum').textContent='resolving…';
  perfTimer=setTimeout(perfPreview,150);
}

async function perfPreview(){
  perfTimer=null;
  if(!perfData)return;
  const seq=++perfSeq;
  let r,j;
  try{ r=await cwPost('/api/perf/preview',{headers:{'content-type':'application/json'},body:JSON.stringify(perfSel())}); j=await r.json(); }
  catch(e){ if(seq===perfSeq)perfFail('could not reach the panel — the effect of these settings is UNKNOWN'); return; }
  if(seq!==perfSeq)return;                                   // a newer drag already answered
  if(!r.ok||!j.ok){ perfFail('refused — '+((j&&(j.errors||[j.error]))||['HTTP '+r.status]).join('; ')); return; }
  $('perf-warn').style.display='none';
  renderPerfTuning(j.tuning,{pending:true});
}

function renderPerfTuning(t,opt){
  const o=opt||{};
  if(!t){ perfFail(o.note||'no tuning was resolved for these settings'); return; }
  const c=t.counts||{};
  const persisted=!!(perfData&&perfData.settingsAvailable);
  $('perf-n').textContent=`${c.enabled==null?'?':c.enabled} of ${c.total==null?'?':c.total} lanes`;
  const num=(v,unit)=>v==null?`<span class="mut">${unit} ?</span>`:`<b>${esc(v)}</b> ${unit}`;
  $('perf-sum').innerHTML=`${num(t.jobs,'jobs')} · ${num(t.slots,'slots')} · ${num(t.ramBudgetGB,'GB RAM budget')} · `
    +(o.pending
      ? '<span class="pill part">not applied</span>'
      : (persisted?'<span class="pill live">in force</span>':'<span class="pill unk">not persisted</span>'))
    +(c.undetermined?` · <span class="pill unk">${esc(c.undetermined)} undetermined</span>`:'')
    // Forced-but-blocked is its own count on purpose: rolled into either of the other two it becomes
    // a lane reported as running, or as a decision not to run it, and it is neither.
    +(c.overridden?` · <span class="pill part">${esc(c.overridden)} overridden</span>`:'')
    +(c.forcedBlocked?` · <span class="pill unk">${esc(c.forcedBlocked)} forced but blocked</span>`:'');
  $('perf-warnings').innerHTML=(t.warnings||[]).length
    ? (t.warnings||[]).map(w=>`<div><b class="txt-crit">warning</b> — ${esc(w)}</div>`).join('')
    : '';
  const rows=t.scanners||[];
  // SECTIONED, and the sections are DERIVED. Forty-odd lanes in one flat list is a table an operator
  // scrolls rather than reads, and the question they arrive with — "what do we run against
  // dependencies?" — has no shape in it. The grouping comes from SCANNER_TABS' view plus TAB_GROUPS,
  // the same two declarations the nav strip is built from, so a lane cannot sit in one place here
  // and another there. A lane the registry does not place lands in `other` and SAYS so, rather than
  // being dropped from a table that is also its own denominator.
  $('perf-rows').innerHTML=rows.length?perfSections(rows,lastState&&lastState.scannerRegistry):'<tr><td colspan="9" class="mut">the tuning model returned no scanner list — UNKNOWN, not "no lanes run"</td></tr>';
}

// Three radios per lane. `auto` is checked from the ABSENCE of an entry, so a page rendered against
// a store holding nothing shows every lane on the derivation, which is what is true.
function perfRadios(id,ov){
  const dis=id?'':' disabled';
  return ['auto','on','off'].map(v=>
    `<label class="mut point"><input type="radio" name="perf-ovr-${esc(id)}" value="${v}" data-perf-ovr="${esc(id)}"${ov===v?' checked':''}${dis}> ${v}</label>`
  ).join(' ');
}

// The three states, kept apart in the rendering as well as in the data:
//   forced ON and runnable  → green "runs" beside an amber "forced on"
//   forced ON but blocked   → a DASHED grey pill, the same treatment every other undetermined thing
//                             on this panel gets. It must not read as a run and must not read as a
//                             skip, because it is neither, and the blocking reason stays on the row.
//   forced OFF              → "not scanned", dimmed, and the why cell says an absence is not a pass.
// check id -> the group its tab sits in, via the two registries the nav already uses. Built once
// per render from SCANNER_TABS rather than kept as a third list beside them.
function perfGroupFor(checkId,reg){
  // Three hops, none of them invented: check id -> rollup category (d.scannerRegistry, published by
  // the rollup) -> the tab that renders that category (SCANNER_TABS) -> its section (TAB_GROUPS).
  // The perf payload keys rows on the CHECK id and SCANNER_TABS keys on the CATEGORY, so the
  // registry is the join, and reading it from the live payload is what keeps this from becoming a
  // fourth hand-maintained list beside three that already exist.
  const key=(Array.isArray(reg)?reg:[]).find(r=>r&&r.check===checkId);
  const cat=key?key.key:checkId;
  const t=SCANNER_TABS.find(x=>x.key===cat);
  if(!t)return 'other';
  return groupOf(t.view)||'other';
}
const PERF_SECTION_LABEL={secrets:'Credentials',static:'Read the code',deps:'What the tree pulls in',
  quality:'Quality, not vulnerabilities',dynamic:'Needs something running',overview:'Fleet',surface:'Surface',
  act:'Levers',other:'No panel tab'};
function perfSections(rows,reg){
  const by=new Map();
  for(const s of rows){ const g=perfGroupFor(s.id||s.check||s.key,reg); if(!by.has(g))by.set(g,[]); by.get(g).push(s); }
  const order=['secrets','static','deps','quality','dynamic','surface','overview','act','other'];
  const seen=[...by.keys()].sort((a,b)=>(order.indexOf(a)+1||99)-(order.indexOf(b)+1||99));
  return seen.map(g=>{
    const list=by.get(g);
    const on=list.filter(x=>x.effective!==false&&x.override!=='off').length;
    const head=`<tr class="perf-sec"><th colspan="9">${esc(PERF_SECTION_LABEL[g]||g)}`
      +` <span class="mut">${on} of ${list.length} running</span>`
      +(g==='other'?` <span class="mut">— these lanes RUN and have no tab of their own, so this table is the only place they are visible or switchable. Their section is not inferred from their name: a lane's place comes from the registry or it is stated as missing.</span>`:'')
      +`</th></tr>`;
    return head+list.map(x=>perfRow(x)).join('');
  }).join('');
}

// What depth or intensity does to this scanner: n/a (nothing), binary (on or off), or graded (one of
// its own levels, shown as label and rank). A model that predates ladders sends no kind: unknown.
function perfKind(kind,lv){
  if(!kind)return '<span class="pill unk">unknown</span>';
  if(kind==='n/a')return '<span class="pill na">n/a</span>';
  const cls=kind==='graded'?'live':'part';
  return `<span class="pill ${cls}">${esc(kind)}</span>`+(lv?`<div class="t-meta">${esc(lv.label)} <span class="mut">${esc(lv.rank)}/${esc(lv.of)}</span></div>`:'');
}

function perfRow(s){
  const ov=(s.override==='on'||s.override==='off')?s.override:'auto';
  const blocked=s.blocked===true;
  let tone,word;
  if(blocked){ tone='unk'; word='forced on · cannot run'; }
  else if(ov==='off'){ tone='na'; word='forced off · not scanned'; }
  else if(s.enabled===true){ tone='live'; word=ov==='on'?'runs · forced on':'runs'; }
  else if(s.enabled===false){ tone='na'; word='skipped'; }
  else { tone='unk'; word='undetermined'; }
  const why=blocked
    ? `<b class="txt-crit">forced on, but it cannot run</b> — ${esc(s.reason||'no blocking reason was given')}. It is not counted among the lanes that run.`
    : (ov==='off'
      ? `${esc(s.reason||'forced off by an operator override')}${s.derivedEnabled===true?' The derivation would have run it.':''}`
      : (s.enabled===true?'':esc(s.reason||'')));
  const derived=ov==='auto'?'':`<div class="mut t-meta">derivation said ${s.derivedEnabled===true?'run':(s.derivedEnabled===false?'skip':'nothing')}${s.derivedEnabled===false&&s.derivedReason?': '+esc(s.derivedReason):''}</div>`;
  return `<tr${ov==='off'?' class="row-absent"':''}>
      <td><a class="name" href="/perf/${esc(s.id)}/" data-pc-id="${esc(s.id)}">${esc(s.label||s.id)}</a>${(s.label&&s.id&&s.label!==s.id)?`<div class="mut t-meta">${esc(s.id)}</div>`:''}<div class="mut t-meta perf-desc">${esc(s.description||'no description declared')}</div>${ov==='auto'?'':`<div><b class="txt-part">◆ overridden</b></div>`}</td>
      <td><span class="pill ${PERF_COST[s.costClass]||'unk'}">${esc(s.costClass||'unknown')}</span></td>
      <td>${perfKind(s.depthKind,s.depthLevel)}</td>
      <td>${perfKind(s.intensityKind,s.intensityLevel)}</td>
      <td class="cell-wrap">${perfRadios(s.id,ov)}${derived}</td>
      <td><span class="pill ${tone}">${word}</span></td>
      <td class="tnum">${perfMs(s.timeoutMs)}</td>
      <td class="tnum">${s.concurrencyWeight==null?'<span class="mut">—</span>':esc(s.concurrencyWeight)}</td>
      <td class="mut cell-wrap">${why}</td>
    </tr>`;
}

document.addEventListener('input',(e)=>{
  const id=e.target&&e.target.id;
  if(id==='perf-depth'||id==='perf-intensity'){ perfLabel(id.slice(5)); perfQueue(); }
},false);
document.addEventListener('change',(e)=>{
  if(e.target&&e.target.id==='perf-profile'){ if(perfData)renderPerfProfileNote(perfData); perfQueue(); }
  // A per-lane radio. Preview re-resolves with the override applied, so the operator sees whether
  // forcing it on actually made it runnable BEFORE anything is written — a forced-on lane that
  // silently cannot run is the failure this control would otherwise introduce.
  const id=e.target&&e.target.dataset&&e.target.dataset.perfOvr;
  if(id){
    const v=e.target.value;
    if(v==='on'||v==='off')perfOverrides[id]=v; else delete perfOverrides[id];
    const msg=$('perf-msg'); msg.className='mut';
    msg.textContent=v==='auto'
      ?id+' is back on the derivation — not applied until Apply'
      :id+' is forced '+v+' — not applied until Apply';
    perfQueue();
  }
},false);

// Inline, never an alert(): a panel action whose outcome lands in a dialog is an outcome nobody
// reads, and this repo has a named defect class for exactly that.
// Reset every lane to auto. It changes the SELECTION, not the store — like every other control on
// this page, it is in force only after Apply, and the message says so rather than implying a write.
document.addEventListener('click',(e)=>{
  const b=e.target.closest&&e.target.closest('#perf-reset-ovr'); if(!b)return;
  const n=Object.keys(perfOverrides).length;
  perfOverrides={};
  const msg=$('perf-msg'); msg.className='mut';
  msg.textContent=n?`${n} override${n===1?'':'s'} cleared — every lane is back on the derivation. Nothing is in force until Apply.`:'no lane was overridden — every lane was already on the derivation';
  perfQueue();
},false);

document.addEventListener('click',async(e)=>{
  const b=e.target.closest&&e.target.closest('#perf-apply'); if(!b||b.disabled)return;
  const msg=$('perf-msg');
  if(perfTimer){ clearTimeout(perfTimer); perfTimer=null; }
  b.disabled=true; const was=b.textContent; b.textContent='applying…';
  let r,j;
  try{ r=await cwPost('/api/perf',{headers:{'content-type':'application/json'},body:JSON.stringify(perfSel())}); j=await r.json(); }
  catch(err){ b.disabled=false;b.textContent=was; msg.className='pk-err'; msg.textContent='could not reach the panel — nothing was applied'; return; }
  b.disabled=false; b.textContent=was;
  if(!r.ok||!j.ok){ msg.className='mut bad'; msg.innerHTML='<b>refused</b> — '+esc(((j&&(j.errors||[j.error]))||['HTTP '+r.status]).map(x=>typeof x==='string'?x:JSON.stringify(x)).join('; ')); return; }
  const nov=Object.keys(perfOverrides).length;
  msg.className='mut'; msg.textContent='applied — these settings are in force for the next sweep'
    +(nov?`, including ${nov} per-check override${nov===1?'':'s'}`:'');
  if(j.state&&j.state.ok){
    perfData=j.state;
    perfOverrides=(j.state.overrides&&typeof j.state.overrides==='object')?Object.assign({},j.state.overrides):{};
    renderPerfKnobs(j.state); renderPerfTuning(j.state.tuning,{pending:false,note:j.state.tuningError});
  }
},false);

// ── panel process health + restart-from-the-panel ───────────────────────────────────────────────
// The health line answers the question that cost a debugging round on 2026-08-20: "is the process
// serving me the code that is on disk?" — routes load at boot while this page is read per request,
// so a stale process 404s brand-new routes while looking otherwise alive. Stale turns the restart
// button primary; the restart handler polls for the SUCCESSOR pid and reloads only when it answers.
// IN FLIGHT. loadPanelHealth() owns this button's label, and the restart handler also sets it —
// so the handler set "restarting…" and then, on its very next line, awaited loadPanelHealth(),
// which wrote the idle label straight back over it. The operator pressed update, saw the button
// flash and settle back to "⬆ update panel (3)", and then the process died under them: no
// in-flight state at all, and a logout that looked like a crash. A refresher that runs on a poll
// must not be able to overwrite a transition it does not know about.
let phBusy=false;
async function loadPanelHealth(){
  const line=$('ph-line'); if(!line)return null;
  try{
    const r=await fetch('/api/panel/health');
    if(!r.ok)throw new Error('HTTP '+r.status+(r.status===404?' — this process predates the health route; restart it by hand once':''));
    const d=await r.json();
    const up=d.uptimeSecs>=86400?Math.floor(d.uptimeSecs/86400)+'d '+Math.floor(d.uptimeSecs%86400/3600)+'h':d.uptimeSecs>=3600?Math.floor(d.uptimeSecs/3600)+'h '+Math.floor(d.uptimeSecs%3600/60)+'m':Math.floor(d.uptimeSecs/60)+'m';
    line.innerHTML=`pid ${d.pid} · up ${up} · ${Math.round(d.memory.rss/1048576)} MB · ${d.supervised?'launchd-supervised · ':''}`
      +(d.code.stale?'code on disk is newer than this process':'code current');
    const stale=$('ph-stale');
    if(stale){ stale.hidden=!d.code.stale; stale.textContent=d.code.stale?'code on disk is newer':''; }
    const b=$('ph-restart'), n=(d.code.changed||[]).length;
    // The health line and the staleness note above still update while a restart is in flight —
    // they are describing the process, and it is still there until it is not. Only the BUTTON is
    // left alone, because it is the one element currently saying what the operator just asked for.
    if(phBusy) return d;
    b.classList.toggle('pri',!!d.code.stale);
    b.classList.toggle('ph-update',!!d.code.stale);
    b.textContent=d.code.stale?`⬆ update panel (${n})`:'⟳ restart panel';
    b.title=d.code.stale
      ? `${n} file${n===1?'':'s'} on disk are newer than this running process — restart to load them:\n${(d.code.changed||[]).join('\n')}`
      : 'restart the panel process — closes the listeners, spawns a successor from the code on disk with the same environment, and reloads this page when it answers';
    return d;
  }catch(e){line.textContent='health unavailable: '+e.message;return null;}
}
$('ph-restart').onclick=async()=>{
  const b=$('ph-restart'),line=$('ph-line');
  // WHICH ACT IS THIS? The button is two controls wearing one element — "⟳ restart panel" when the
  // process matches the code on disk and "⬆ update panel (N)" when it does not — and it said
  // "restarting…" for both. Read the mode BEFORE the label is touched, then say the matching word:
  // an operator who pressed "update" should be told the update is running, not something else.
  const updating=b.classList.contains('ph-update');
  const verb=updating?'updating':'restarting';
  phBusy=true;                                    // loadPanelHealth() must stop owning the label here
  b.disabled=true;b.textContent=verb+'…';b.classList.remove('ph-update');
  const before=await loadPanelHealth();           // no longer able to undo the line above
  try{
    const r=await cwPost('/api/panel/restart');
    const d=await r.json().catch(()=>({}));
    if(!d.ok){
      // A REFUSAL IS A FULL STOP, not a pause: nothing restarted, so the button goes back to being
      // what it was and the refresher takes ownership again.
      phBusy=false;
      line.textContent=verb+' refused: '+(d.error||('HTTP '+r.status));
      b.disabled=false;await loadPanelHealth();return;
    }
  }catch(_){/* the socket dropping here IS the restart happening */}
  // The wait is up to 30 seconds of the panel being gone. Counting it out loud is the difference
  // between "working" and "hung", and this is exactly the window in which the process the operator
  // is looking at does not exist.
  for(let i=0;i<60;i++){
    await new Promise(r=>setTimeout(r,500));
    b.textContent=verb+'… '+Math.round((i+1)/2)+'s';
    try{const h=await(await fetch('/api/panel/health')).json();
      if(h&&h.pid&&(!before||h.pid!==before.pid)){
        // The successor is up. Sessions are persisted now (admin/sessions.mjs), so this reload
        // lands back on the panel rather than on the login page — which is the whole reason the
        // restart was worth making visible rather than survivable-in-silence.
        b.textContent=updating?'updated — reloading…':'restarted — reloading…';
        location.reload();return;
      }}catch(_){/* between pids */}
  }
  phBusy=false;
  line.textContent='no successor answered within 30s — check reports/panel-restart.log and start the panel by hand (node admin/serve.mjs)';
  b.disabled=false;await loadPanelHealth();
};
loadPanelHealth();

// ── SAST sub-menu ───────────────────────────────────────────────────────────────────────────────
// Show one analyser at a time inside the SAST view. `hidden` rather than a class so the sections
// are inert to assistive tech as well as invisible — a screen reader walking seven stacked tables
// was the same wall the sighted reader had.
function sastSub(which){
  document.querySelectorAll('#view-sast section[data-sub]').forEach(el=>{ el.hidden = el.dataset.sub!==which; });
  document.querySelectorAll('#sast-subnav .vtab').forEach(b=>{ b.classList.toggle('pri', b.dataset.sub===which); });
  try{localStorage.setItem('cw-sast-sub',which)}catch(_){}
}
document.querySelectorAll('#sast-subnav .vtab').forEach(b=>{ b.onclick=()=>sastSub(b.dataset.sub); });
try{ const saved=localStorage.getItem('cw-sast-sub'); if(saved)sastSub(saved); }catch(_){}
// Badge each sub-tab. A null count is an em dash, never a 0 — "never scanned" and "found nothing"
// are the two states this panel exists to keep apart, and a badge is the smallest place to lose it.
function paintSastSubBadges(counts){
  for(const [sub,n] of Object.entries(counts||{})){
    const el=document.getElementById('sn-'+sub);
    if(el)el.textContent = (typeof n==='number') ? String(n) : '—';
  }
}
