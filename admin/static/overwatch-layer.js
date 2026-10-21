let owState=null;

// owText COERCES, and coercion is how [object Object] reaches a cell. A non-scalar is not a value
// this helper can render, and saying so is the only honest option: String(obj) yields a string that
// is non-empty, passes every emptiness guard, and looks like data.
const owText=(value, fallback='\u2014')=>{
  if(value==null||value==='')return fallback;
  if(typeof value==='object')return '(unrenderable '+(Array.isArray(value)?'list':'object')+')';
  return String(value);
};

// LIFECYCLE COLOUR IS A VOCABULARY, NOT DECORATION. completed violet, active green, pending orange
// \u2014 three hues across two colour-vision axes, so the three states stay three states for a reader
// who cannot separate red from green. Anything unrecognised stays grey rather than borrowing the
// nearest colour, because a state rendered in a colour it did not earn is a claim.
const OW_LIFECYCLE={completed:'done',complete:'done',done:'done',reviewed:'done',
  active:'live',running:'live',live:'live',ready:'live',ok:'live',
  pending:'part',created:'part',queued:'part',awaiting_approval:'part',paused:'part',
  failed:'high',error:'high',unreachable:'high',unreadable:'high',killed:'high',abandoned:'high'};
const owPill=(state)=>{
  const s=owText(state,'unknown');
  const cls=OW_LIFECYCLE[String(s).toLowerCase()]||'unk';
  return '<span class="pill '+cls+'">'+esc(s)+'</span>';
};

const owNum=(n)=>(typeof n==='number'&&isFinite(n))?n.toLocaleString():null;
const owWhen=(iso)=>{
  if(!iso)return '<span class="mut">\u2014</span>';
  const t=Date.parse(iso); if(!isFinite(t))return '<span class="mut">\u2014</span>';
  const d=new Date(t), pad=(x)=>String(x).padStart(2,'0');
  return '<span title="'+esc(iso)+'">'+esc(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`)+'</span>';
};

// Turns and tokens, which is what a flat-rate plan actually spends. The three states are different
// facts and none of them is zero: `unknown` was never asked, `absent` has no transcript on this
// box, `unreadable` was asked and could not answer. Only `live` is a measurement.
function owTokens(t){
  if(!t||typeof t!=='object')return '<span class="mut">\u2014</span>';
  if(t.state!=='live'){
    const why=t.why||t.state;
    return '<span class="mut" title="'+esc(String(why))+'">'+esc(t.state==='absent'?'no transcript':t.state)+'</span>';
  }
  const out=owNum(t.totals&&t.totals.output), turns=owNum(t.turns);
  const cache=(typeof t.cacheHitRatio==='number')?` \u00b7 ${Math.round(t.cacheHitRatio*100)}% cached`:'';
  const torn=t.unparseableLines?` \u00b7 ${t.unparseableLines} torn line(s), so this is a floor`:'';
  return esc(`${turns||'?'} turns \u00b7 ${out||'?'} out${cache}`)
    +(torn?'<span class="mut" title="'+esc(torn)+'"> \u26a0</span>':'');
}

async function owPost(path, body){
  const res=await cwPost(path,{headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const out=await res.json().catch(()=>({ok:false,error:'response was not JSON'}));
  if(!res.ok||!out.ok)throw new Error(out.error||('HTTP '+res.status));
  return out;
}

// The refusal names its own scope and LINKS to the port that would work. The message arrives as
// data with {scope,url} beside it rather than as markup, because every string here is escaped —
// an anchor baked into the message would render as literal tags. The word "loopback" is the link:
// the operator is told what the rule is and handed the address in the same breath.
function owGateHtml(d){
  if(d&&d.allowed)return '<b>Operator controls available on this socket.</b>';
  const why=String((d&&d.why)||'dispatch authority was not established');
  const url=d&&d.url;
  if(!url||!/^loopback\b/i.test(why))return '<b>Read only:</b> '+esc(why);
  const link='<a href="'+esc(url)+'">loopback</a>';
  return '<b>Read only:</b> '+link+esc(why.slice('loopback'.length));
}

function owRenderSources(j){
  const sources=Object.entries(j.sources||{});
  $('sb-sources').innerHTML=sources.map(([name,s])=>'<span class="tag">'+esc(name)+' '+owPill(s.state)+(s.why?' · '+esc(s.why):'')+'</span>').join('')||'<span class="mut">no source states returned</span>';
  $('sb-gate').innerHTML=owGateHtml(j.dispatch);
  const p=j.permissionProfile||{};
  $('sb-profile').innerHTML='<b>Permission profile:</b> '+owPill(p.state)+' · '+esc((p.enforced||[]).join('; ')||'nothing stated')+(p.notEnforced?.length?'<br><b>Not enforced:</b> '+esc(p.notEnforced.join('; ')):'');
}

// The declared sync points, rendered as their own row of states. FOUR verdicts, and the fourth is
// the load-bearing one: not-wired means the point is declared and nothing writes it, which is a fact
// about the fleet rather than a fault of the task. Painting those rows red would describe this
// checker, not the work.
function owRenderSync(j){
  const m=j.memorySync;
  const el=$('sb-sources'); if(!el||!m)return;
  // nosemgrep: typescript.react.security.audit.react-unsanitized-method.react-unsanitized-method -- every interpolated value goes through esc(); cls is a literal pill class
  if(!m.ok){el.insertAdjacentHTML('beforeend',' <span class="pill unk" title="'+esc(m.why||'')+'">memory sync: unreadable</span>');return;}
  const chips=(m.rows||[]).map(r=>{
    const cls=r.verdict==='synced'?'live':r.verdict==='missing'?'high':'part';
    // The title carries the WHY and the sample size, because a verdict with no reason is the thing
    // this panel refuses everywhere else.
    return '<span class="pill '+cls+'" title="'+esc(r.point+' — '+r.why+(r.probedOf?' (probed '+r.probed+' of '+r.probedOf+')':''))+'">'+esc(r.id)+': '+esc(r.verdict)+'</span>';
  }).join(' ');
  // nosemgrep: typescript.react.security.audit.react-unsanitized-method.react-unsanitized-method -- every interpolated value goes through esc(); cls is a literal pill class
  el.insertAdjacentHTML('beforeend',' <span class="mut">· memory sync</span> '+chips
    +(m.probeWhy?' <span class="pill unk" title="'+esc(m.probeWhy)+'">probe failed</span>':'')
    +' <span class="mut" title="'+esc(m.caveat||'')+'">(sample, not a rate)</span>');
}

// Configuration is its own row, after reachability and before sync. FIVE states: present is the
// only green; absent and misregistered are red because an agent session on this box cannot file
// work; unreadable is red for the fail-closed reason; not-applicable is neither. The title carries
// the why and the remedy id, so a red chip points at the command to run rather than at itself.
function owRenderPreconditions(j){
  const p=j.preconditions;
  const el=$('sb-sources'); if(!el||!p)return;
  const chips=(p.checks||[]).map(c=>{
    const cls=c.state==='present'?'ok':c.state==='not-applicable'?'part':'high';
    return '<span class="pill '+cls+'" title="'+esc(owText(c.why,'')+(c.state==='present'||c.state==='not-applicable'?'':' — remedy: install-catalog tools.overwatch-layer-spine.steps.'+c.id))+'">'+esc(c.id)+': '+esc(c.state)+'</span>';
  }).join(' ');
  // nosemgrep: typescript.react.security.audit.react-unsanitized-method.react-unsanitized-method -- every interpolated value goes through esc(); cls is a literal pill class
  el.insertAdjacentHTML('beforeend',' <span class="mut">· configuration</span> '+chips
    +(p.usable?'':' <span class="mut" title="'+esc(p.note||'')+'">(a session on this box cannot file work until every check is present)</span>'));
}

// SPEND, WITHOUT INVENTING A PRICE. dollarsAreMeaningful is the whole gate: on a subscription the
// per-token cost is not a measurement, so no dollar figure is drawn at all. What replaces it is the
// limit that actually binds \u2014 how much of each rate-limit window is spent, and when it resets.
function owRenderUsage(j){
  const u=j.usage;
  const rowsEl=$('sb-usage-rows'), chipEl=$('sb-usage'), whyEl=$('sb-usage-why');
  if(!rowsEl||!chipEl)return;
  if(!u||!u.ok){
    chipEl.innerHTML='<span class="pill high">usage '+esc(owText(u&&u.state,'unavailable'))+'</span>';
    whyEl.textContent=(u&&u.why)||'the account usage cache could not be read, so nothing is claimed about spend';
    rowsEl.innerHTML='<tr><td colspan="4" class="mut">No usage reading. This is unmeasured, not zero.</td></tr>';
    $('sb-usage-n').textContent='unmeasured';
    return;
  }
  const kind=u.plan&&u.plan.kind;
  const planPill=kind==='subscription'?'<span class="pill done">subscription</span>'
    :kind==='metered'?'<span class="pill part">metered</span>':'<span class="pill unk">plan unknown</span>';
  // Staleness is a third state. null means the cache carried no fetch time, which is not "fresh".
  const stale=u.stale===true?'<span class="pill part" title="'+esc('read '+Math.round((u.ageMs||0)/60000)+' min ago; the harness refreshes this on its own schedule')+'">cache '+Math.round((u.ageMs||0)/60000)+' min old</span>'
    :u.stale===null?'<span class="pill unk" title="the cache carried no fetch time">age unknown</span>'
    :'<span class="pill live">cache fresh</span>';
  chipEl.innerHTML=planPill+' '+stale;
  whyEl.textContent=(u.plan&&u.plan.why)||'';
  $('sb-usage-n').textContent=(u.windows||[]).map(w=>w.utilization+'%').join(' \u00b7 ')||'\u2014';

  const all=[...(u.windows||[]),...(u.otherActive||[])];
  rowsEl.innerHTML=all.map(w=>{
    const pct=typeof w.utilization==='number'?w.utilization:null;
    const bar=pct===null?'<span class="mut">unknown</span>'
      :'<span class="pill '+(pct>=90?'high':pct>=70?'part':'live')+'">'+esc(pct+'%')+'</span>';
    const reset=w.resetsAt?owWhen(w.resetsAt):'<span class="mut">\u2014</span>';
    // A dollar column appears ONLY where a dollar was measured.
    const limit=u.dollarsAreMeaningful&&typeof w.limitDollars==='number'
      ?esc('$'+w.limitDollars.toFixed(2)+(typeof w.usedDollars==='number'?' \u00b7 $'+w.usedDollars.toFixed(2)+' used':''))
      :'<span class="mut" title="'+esc('this plan is not billed per token, so a dollar figure here would be invented')+'">not billed per token</span>';
    return '<tr><td>'+esc(w.label||w.key)+'</td><td>'+bar+'</td><td>'+reset+'</td><td>'+limit+'</td></tr>';
  }).join('')||'<tr><td colspan="4" class="mut">No rate-limit window reported a reading.</td></tr>';

  const f=j.sessionRows&&j.sessionRows.fleet;
  $('sb-tokens').innerHTML=f
    ?esc(`Tokens this fleet: ${owNum(f.totals&&f.totals.output)||'?'} output \u00b7 ${owNum(f.totals&&f.totals.cacheRead)||'?'} cache-read \u00b7 ${f.turns} turns`)
      +' <span class="mut">'+esc(`measured over ${f.measured} of ${f.of} sessions`)
      +(f.unmeasured&&f.unmeasured.length?esc(` \u2014 ${f.unmeasured.length} unmeasured, so this is a floor`):'')+'</span>'
    :'<span class="mut">No per-session token reading on this surface.</span>';
}

// ONE ROW PER SESSION. Name and project first because they are what an operator recognises; the
// uuid is a title attribute, not the cell. Content fields (last output, touched paths) are withheld
// off the operator port and say so rather than rendering blank.
function owRenderRuns(j){
  const sr=j.sessionRows;
  const rows=(sr&&Array.isArray(sr.rows))?sr.rows:[];
  const runById=new Map((Array.isArray(j.runs)?j.runs:[]).map(r=>[r.sessionId||r.id,r]));
  $('sb-runs-n').textContent=rows.length;
  if(sr&&!sr.ok){
    $('sb-runs').innerHTML='<tr><td colspan="8"><span class="pill unk">sessions unreadable</span> <span class="mut">'+esc(sr.why||'')+'</span></td></tr>';
    return;
  }
  $('sb-runs').innerHTML=rows.map((r)=>{
    const id=owText(r.id,'');
    const run=runById.get(r.id)||{};
    const m=run.meta||run;
    const waiting=m.awaitingApproval||m.approval||null;
    const requestId=waiting&&(waiting.requestId||waiting.id||m.pendingRequestId||'');
    const approval=j.dispatch?.allowed&&id&&requestId
      ?'<button class="btn" data-ow-act="approval" data-behavior="allow" data-request="'+esc(requestId)+'" data-session="'+esc(id)+'" aria-label="Allow '+esc(owText(waiting.toolName||waiting.displayName,'a tool'))+' for session '+esc(owText(r.name,id.slice(0,8)))+'">Allow</button> <button class="btn" data-ow-act="approval" data-behavior="deny" data-request="'+esc(requestId)+'" data-session="'+esc(id)+'" aria-label="Deny '+esc(owText(waiting.toolName||waiting.displayName,'a tool'))+' for session '+esc(owText(r.name,id.slice(0,8)))+'">Deny</button> '
      :'';
    const controls=j.dispatch?.allowed&&id
      ?approval+'<button class="btn" data-ow-act="interrupt" data-session="'+esc(id)+'">Interrupt</button> <button class="btn" data-ow-act="kill" data-session="'+esc(id)+'">Kill</button>'
      :'<span class="mut">read only</span>';

    const who='<b title="'+esc(id)+'">'+esc(owText(r.name,'unnamed'))+'</b>'
      +(r.label?'<br><span class="mut">'+esc(r.label.length>90?r.label.slice(0,90)+'\u2026':r.label)+'</span>':'')
      +(waiting?'<br><span class="pill part">waiting on '+esc(owText(waiting.toolName||waiting.displayName||waiting.requestId,'approval'))+'</span>':'');

    const where=esc(owText(r.project))
      +(r.idePort?'<br><span class="mut">'+esc('IDE :'+r.idePort)+'</span>':'')
      +(r.workspace&&r.workspace!==r.cwd?'<br><span class="mut" title="'+esc(r.workspace)+'">other workspace</span>':'');

    const f=r.files||{};
    const touched=f.redacted?'<span class="mut" title="paths name this fleet\u2019s tree, so they are operator-port only">'+esc((f.count!=null?f.count+' file(s)':'withheld'))+'</span>'
      :f.state==='live'?'<span title="'+esc((f.paths||[]).join('\n')+(f.more?`\n\u2026 +${f.more} more`:''))+'">'+esc(String(f.count))
        +(f.viaPid?' <span class="pill unk">via pid</span>':'')+'</span>'
      :f.state==='none'?'<span class="mut">0</span>'
      :'<span class="mut" title="'+esc(String(f.why||''))+'">'+esc(f.state)+'</span>';

    const o=r.output||{};
    const said=o.redacted?'<span class="mut">withheld on this surface</span>'
      :o.state==='live'?'<span title="'+esc(o.text)+'">'+esc(o.text.length>120?o.text.slice(0,120)+'\u2026':o.text)+'</span>'
      :'<span class="mut" title="'+esc(String(o.why||''))+'">'+esc(o.state==='none'?'nothing in tail':o.state)+'</span>';

    return '<tr><td>'+who+'</td><td>'+where+'</td><td>'+owPill(r.status)+'</td><td>'+esc(owText(r.model||m.model))
      +'</td><td>'+owTokens(r.tokens)+'</td><td>'+touched+'</td><td>'+said+'</td><td>'+controls+'</td></tr>';
  }).join('')||'<tr><td colspan="8" class="mut">No sessions were returned.</td></tr>';
}

// Sort and filter are VIEW state, held here rather than refetched: narrowing to one project is a
// question about rows already on the page, and a round trip would let the fleet appear to change
// while you were only looking at it differently.
let owSort={key:'updated',dir:'desc'};
let owFilter={project:'',status:''};

const owPlanProject=(p)=>p.project||(p.cwd?String(p.cwd).split('/').filter(Boolean).pop():null)||null;
const owTaskTime=(t)=>Date.parse(t?.updated_at||t?.updatedAt||t?.created_at||t?.createdAt||0)||0;

function owSortPlans(plans){
  const dir=owSort.dir==='asc'?1:-1;
  const key=owSort.key;
  return [...plans].sort((a,b)=>{
    if(key==='name')return dir*String(a.name||a.title||a.id||'').localeCompare(String(b.name||b.title||b.id||''));
    if(key==='status')return dir*String(a.status||'').localeCompare(String(b.status||''));
    const at=key==='started'?Date.parse(a.created_at||a.createdAt||0)||0:Math.max(Date.parse(a.updated_at||a.updatedAt||0)||0,...(a.tasks||[]).map(owTaskTime));
    const bt=key==='started'?Date.parse(b.created_at||b.createdAt||0)||0:Math.max(Date.parse(b.updated_at||b.updatedAt||0)||0,...(b.tasks||[]).map(owTaskTime));
    return dir*(at-bt);
  });
}

/** Tasks nested under their parent, so a sub-task reads as belonging to the task above it. */
function owNestTasks(tasks){
  const list=Array.isArray(tasks)?tasks:[];
  const byId=new Map(list.map(t=>[String(t.id),t]));
  const roots=list.filter(t=>!t.parent_id||!byId.has(String(t.parent_id)));
  const kids=(id)=>list.filter(t=>String(t.parent_id)===String(id));
  const out=[];
  for(const r of roots){ out.push({task:r,depth:0}); for(const k of kids(r.id)) out.push({task:k,depth:1}); }
  return out;
}

function owPlanOptions(plans){
  const sel=$('sb-plan-project'); if(!sel)return;
  const seen=[...new Set(plans.map(owPlanProject).filter(Boolean))].sort();
  const cur=sel.value;
  sel.innerHTML='<option value="">all projects</option>'+seen.map(p=>'<option value="'+esc(p)+'">'+esc(p)+'</option>').join('');
  if(seen.includes(cur))sel.value=cur;                 // a repaint must not silently reset the filter
}

function owRenderPlans(j){
  const all=Array.isArray(j.plans)?j.plans:[];
  owPlanOptions(all);
  const plans=owSortPlans(all.filter(p=>
    (!owFilter.project||owPlanProject(p)===owFilter.project)&&
    (!owFilter.status||String(p.status||'').toLowerCase()===owFilter.status)));

  const taskCount=all.reduce((n,p)=>n+((p.tasks||[]).length),0);
  $('sb-plans-n').textContent=all.length+' plans · '+taskCount+' tasks'+(j.dispatchResidue&&j.dispatchResidue.tasks?' · '+j.dispatchResidue.tasks+' dispatch residue (not work)':'');
  // BOTH numbers, always: a filtered view that reported only its own count would read as the fleet
  // having gone quiet.
  const shown=$('sb-plans-shown');
  if(shown)shown.textContent=(owFilter.project||owFilter.status)?`showing ${plans.length} of ${all.length} plans`:`${all.length} plans`;
  for(const b of document.querySelectorAll('[data-ow-sort]')){
    if(b.dataset.owSort===owSort.key)b.dataset.dir=owSort.dir; else delete b.dataset.dir;
    const th=b.closest('th'); if(th)th.setAttribute('aria-sort',b.dataset.owSort===owSort.key?(owSort.dir==='asc'?'ascending':'descending'):'none');
  }

  const html=[];
  for(const plan of plans){
    const planId=owText(plan.id||plan.planId,'');
    const proj=owPlanProject(plan);
    html.push('<tr class="ow-plan-row"><td><b>'+esc(plan.name||plan.title||planId||'unnamed')+'</b>'
      +(proj?' <span class="tag">'+esc(proj)+'</span>':'')
      +'<br><code class="mut">'+esc(planId)+'</code></td>'
      +'<td>'+owPill(plan.status)+'</td><td>'+esc(owText(plan.owner))+'</td>'
      +'<td>'+owWhen(plan.created_at||plan.createdAt)+'</td>'
      +'<td>'+owWhen(plan.updated_at||plan.updatedAt||plan.lastTouchedAt)+'</td><td></td></tr>');

    const nested=owNestTasks(plan.tasks);
    if(!nested.length)html.push('<tr class="ow-task"><td colspan="6" class="mut">no tasks filed under this plan</td></tr>');
    for(const {task,depth} of nested){
      const taskId=owText(task.id||task.taskId,'');
      const start=j.dispatch?.allowed&&taskId&&task.status==='pending'
        ?'<button class="btn" data-ow-act="dispatch" data-plan="'+esc(planId)+'" data-task="'+esc(taskId)+'">Start</button>'
        :'';
      // A withheld goal is NOT an absent one, and the projection says which it is.
      const goal=task.redacted
        ?'<span class="mut">content withheld on this surface</span>'
        :esc(owText(task.goal||task.title,'no goal recorded'));
      html.push('<tr class="'+(depth?'ow-subtask':'ow-task')+'"><td>'+goal
        +'<br><code class="mut">'+esc(taskId)+'</code></td>'
        +'<td>'+owPill(task.status)+'</td><td>'+esc(owText(task.owner||task.agent))+'</td>'
        +'<td>'+owWhen(task.created_at||task.createdAt)+'</td>'
        +'<td>'+owWhen(task.updated_at||task.updatedAt)+'</td><td>'+start+'</td></tr>');
    }
  }
  $('sb-plans').innerHTML=html.join('')||'<tr><td colspan="6" class="mut">'
    +esc(all.length?'No plan matches this filter.':'No plans were returned.')+'</td></tr>';
}

// The window a session lives in is now a COLUMN of the session row, so this reports only what a
// per-row view cannot: the sessions that resolved to no window at all. Four states, never three —
// `degraded` is a claim about the READING (the process table was unreadable, the ids blob would not
// parse) and must never render as `unattributed`, which is a claim about the SESSION: that it was
// asked about and had no window.
function owRenderWindows(j){
  const a=j.attribution||{};
  const el=$('sb-win-extra'); if(!el)return;
  const n=(x)=>(a[x]||[]).length;
  if(!n('unattributed')&&!n('unknown')&&!n('degraded')){
    el.innerHTML='<span class="mut">'+esc(`${(a.windows||[]).length} window(s); every session resolved to one.`)+'</span>';
    return;
  }
  const part=(k,why)=>n(k)?'<span class="pill '+(k==='degraded'?'high':'unk')+'" title="'+esc(why)+'">'+esc(`${n(k)} ${k}`)+'</span> ':'';
  el.innerHTML=esc(`${(a.windows||[]).length} window(s) · `)
    +part('unattributed','a live session whose ids name no window — asked, and nothing found')
    +part('unknown','opened before identity resolution existed — never asked')
    +part('degraded','the reading itself failed; this is not a claim about the session');
}

// LAUNCH CONTROLS. The button carries a preset ID and nothing else; the brief is server-side. The
// skill dropdown offers only skills the server actually found, and the repo filter is labelled as a
// keyword match over each skill's own description rather than presented as a ranking.
function owRenderLaunch(j){
  const L=j.launch, host=$('sb-launch-presets'); if(!host)return;
  if(!L){host.innerHTML='<span class="mut">launch options were not returned</span>';return;}
  const allowed=j.dispatch?.allowed;
  $('sb-launch-n').textContent=(L.presets||[]).length+' presets · '+(L.skills||[]).length+' skills';

  host.innerHTML=(L.presets||[]).map(p=>allowed
    ?'<button class="btn" data-ow-act="launch" data-preset="'+esc(p.id)+'" title="'+esc(p.blurb||'')+'">'+esc(p.label)+'</button>'
    :'<span class="tag" title="'+esc(p.blurb||'')+'">'+esc(p.label)+'</span>').join(' ')
    +(allowed?'':' <span class="mut">'+esc('read only on this socket')+'</span>');

  // Projects come from the plans already on the page, so the picker cannot name a cwd the server
  // would refuse.
  const projects=[...new Set((j.plans||[]).map(owPlanProject).filter(Boolean))].sort();
  const psel=$('sb-launch-project');
  if(psel){const cur=psel.value;psel.innerHTML='<option value="">no project</option>'+projects.map(p=>'<option value="'+esc(p)+'">'+esc(p)+'</option>').join('');if(projects.includes(cur))psel.value=cur;}

  const bsel=$('sb-launch-backend');
  if(bsel){
    const cur=bsel.value;
    // Only what the runner roster declares. An option this panel invented would offer a backend
    // nothing can reach, which is a control that lies about its own effect.
    bsel.innerHTML='<option value="">runner default</option>'+(j.backends||[]).map(b=>{
      const k=b.key||b.name||b.label; const off=b.state&&b.state!=='declared'&&b.state!=='declared-unprobed';
      return '<option value="'+esc(k)+'"'+(off?' disabled':'')+'>'+esc(k)+(off?' ('+esc(b.state)+')':'')+'</option>';
    }).join('');
    if(cur)bsel.value=cur;
  }

  owRenderSkillOptions(L);
}

function owRenderSkillOptions(L){
  const sel=$('sb-launch-skill'), why=$('sb-launch-skill-why'); if(!sel)return;
  if(L.skillsState!=='live'){
    sel.innerHTML='<option value="">no skill</option>';
    if(why)why.innerHTML='<span class="pill '+(L.skillsState==='unreadable'?'high':'unk')+'">skills '+esc(L.skillsState)+'</span> '+esc(L.skillsWhy||'no skills directory on this box');
    return;
  }
  const repoOnly=$('sb-launch-repo-only')?.checked!==false;
  const repoSet=new Set(L.repoSkills||[]);
  const list=(L.skills||[]).filter(s=>!repoOnly||repoSet.has(s.name));
  const cur=sel.value;
  // The description rides as the option's title, which is the "with explanations" part: a bare list
  // of 82 slugs is not a choice anybody can make.
  sel.innerHTML='<option value="">no skill</option>'+list.map(s=>'<option value="'+esc(s.name)+'" title="'+esc(s.description||'no description')+'">'+esc(s.name)+'</option>').join('');
  if(list.some(s=>s.name===cur))sel.value=cur;
  if(why)why.innerHTML=esc(`${list.length} of ${(L.skills||[]).length} skills shown`)
    +(repoOnly?' <span class="mut" title="'+esc(L.repoFilter?.caveat||'')+'">'+esc('(keyword match on each skill’s own description, not a measured fitness)')+'</span>':'')
    +((L.unreadableSkills||[]).length?' <span class="pill unk" title="'+esc(L.unreadableSkills.map(u=>u.name+': '+u.why).join('\n'))+'">'+esc(L.unreadableSkills.length+' unreadable')+'</span>':'');
}

function owRenderBackends(j){
  const rows=Array.isArray(j.backends)?j.backends:[];
  $('sb-be-n').textContent=rows.length;
  $('sb-backends').innerHTML=rows.map(b=>'<tr><td><b>'+esc(b.name||b.label||b.key||'unnamed')+'</b></td><td>'+esc(owText(b.kind||b.type))+'</td><td>'+esc(owText(b.url||b.model||b.port))+'</td><td>'+owPill(b.state||'unmeasured')+'</td><td>'+esc(owText(b.why||b.reason))+'</td></tr>').join('')||'<tr><td colspan="5" class="mut">No runner roster was returned.</td></tr>';
}

function owRender(j){
  owState=j;
  const n=(j.sessionRows&&j.sessionRows.rows||j.runs||[]).length;
  $('sb-n').textContent=owText(j.taskCount,0)+' tasks · '+n+' sessions';
  const vn=$('vn-overwatch');if(vn)vn.textContent=n;
  owRenderSources(j);owRenderPreconditions(j);owRenderSync(j);owRenderUsage(j);owRenderRuns(j);owRenderPlans(j);owRenderWindows(j);owRenderLaunch(j);owRenderBackends(j);
}

async function loadOverwatch(){
  try{
    const res=await fetch('/api/overwatch-layer/state');
    const j=await res.json();
    if(!res.ok||!j.ok)throw new Error(j.error||('HTTP '+res.status));
    owRender(j);
  }catch(e){
    $('sb-n').textContent='unavailable';
    $('sb-sources').innerHTML='<span class="pill high">unreachable</span> '+esc(e.message);
  }
}

// Accessibility wiring, done here rather than in the markup so it cannot drift from the renderer
// that produces the content it describes.
//
// commitwork publishes a WCAG 2.2 AA conformance claim about ITSELF and has a tab that measures it,
// so a new top-level view whose content changes under the reader without announcement would fail the
// panel on the page that reports the panel. Three things are needed and none is cosmetic:
//   · the status line is a LIVE REGION — a refusal that only appears visually is, to a screen-reader
//     user, a button that did nothing and said nothing;
//   · every table is named by its own section heading, so the tables are distinguishable when
//     navigated out of context;
//   · Allow/Deny carry the tool and session in their accessible name. Two buttons both called
//     "Allow" on a page with several parked sessions are not a choice anyone can make blind.
function owA11y(){
  const gate=$('sb-gate'); if(gate){gate.setAttribute('role','status');gate.setAttribute('aria-live','polite');}
  const prof=$('sb-profile'); if(prof)prof.setAttribute('aria-live','polite');
  const root=$('view-overwatch'); if(!root)return;
  for(const sec of root.querySelectorAll('section')){
    const h=sec.querySelector('h2'), t=sec.querySelector('table');
    if(!h||!t)continue;
    if(!h.id)h.id='sb-h-'+h.textContent.trim().toLowerCase().replace(/[^a-z]+/g,'-');
    t.setAttribute('aria-labelledby',h.id);
  }
}

document.addEventListener('DOMContentLoaded',()=>{
  const root=$('view-overwatch');
  if(!root)return;
  owA11y();

  // Filter and sort repaint from owState rather than refetching: they are questions about the rows
  // already on the page, and a round trip would let the fleet appear to change while you were only
  // looking at it differently.
  const repaint=()=>{ if(owState)owRenderPlans(owState); };
  for(const [id,key] of [['sb-plan-project','project'],['sb-plan-status','status']]){
    const sel=$(id); if(sel)sel.addEventListener('change',()=>{ owFilter[key]=sel.value; repaint(); });
  }
  root.addEventListener('click',(e)=>{
    const s=e.target.closest('button[data-ow-sort]'); if(!s)return;
    const key=s.dataset.owSort;
    owSort=owSort.key===key?{key,dir:owSort.dir==='asc'?'desc':'asc'}:{key,dir:key==='name'?'asc':'desc'};
    repaint();
  });

  const repoOnly=$('sb-launch-repo-only');
  if(repoOnly)repoOnly.addEventListener('change',()=>{ if(owState&&owState.launch)owRenderSkillOptions(owState.launch); });

  root.addEventListener('click',async(e)=>{
    const b=e.target.closest('button[data-ow-act]');if(!b)return;
    const action=b.dataset.owAct;
    if((action==='kill'||action==='interrupt')&&!confirm(action+' session '+b.dataset.session+'?'))return;
    const st=$('sb-launch-status');
    if(action==='launch'){
      const project=$('sb-launch-project')?.value||'';
      // The confirmation names what will actually run, because "Launch" alone does not say where.
      if(!confirm('Start a plan-mode agent: '+b.textContent+(project?' in '+project:' with no project')+'?'))return;
    }
    b.disabled=true;
    try{
      const body=action==='dispatch'?{planId:b.dataset.plan,taskId:b.dataset.task}
        :action==='approval'?{sessionId:b.dataset.session,requestId:b.dataset.request,behavior:b.dataset.behavior}
        :action==='launch'?{presetId:b.dataset.preset,
            project:$('sb-launch-project')?.value||null,
            skill:$('sb-launch-skill')?.value||null,
            backend:$('sb-launch-backend')?.value||null}
        :{sessionId:b.dataset.session};
      const out=await owPost('/api/overwatch-layer/'+action,body);
      if(action==='launch'&&st)st.textContent='started '+(out.preset||'')+' as session '+(out.sessionId||'(id not reported)')+' in '+(out.mode||'?')+' mode';
      await loadOverwatch();
    }catch(err){
      // A refusal is shown in the live region as well as the alert: a refusal that only appears in a
      // dismissed dialog is, to a screen-reader user, a button that did nothing and said nothing.
      if(action==='launch'&&st)st.textContent='refused: '+err.message;
      alert(action+' refused: '+err.message);
    }
    finally{b.disabled=false;}
  });
});
