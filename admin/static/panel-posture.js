// admin/static/panel-posture.js — part 3 of 8 of the panel client.
//
// the posture strip, the live sweep console, per-lane run state, the STPA console and the run-health panel.
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

// ── POSTURE STRIP ───────────────────────────────────────────────────────────────────────────────
// Four rows of global sweep posture, from data /api/state ALREADY carries — no new endpoint and no
// extra request: this rides the same 8s poll as everything else on the Overview.
//
// Every row is a THREE-state reading, and the third state is the one that matters. `unknown` is
// returned whenever the underlying figure does not exist — no rollup, no scanner run, no timestamp
// — and it renders hollow/grey/italic rather than as a 0. A 0 here would be indistinguishable from
// "scanned and clean", which is the exact confusion this panel exists to prevent. The mirror rule
// applies too: an absent reading is not rendered as a failure either, only as absent.
function postureRows(d){
  const gen = d && d.generated ? Date.parse(d.generated) : NaN;
  const ageH = Number.isFinite(gen) ? (Date.now() - gen) / 36e5 : null;
  // 36h, not 24: a nightly sweep that starts at 02:30 and runs long is not stale by breakfast.
  const sweep = ageH == null ? ['unknown', 'never run']
    : ageH <= 36 ? ['ok', ageH < 1 ? 'just now' : Math.round(ageH) + 'h ago']
    : ['stale', Math.round(ageH / 24) + 'd ago'];
  const repos = Array.isArray(d && d.repos) ? d.repos : [];
  // Gated on the SWEEP, not on the array: repos:[] under a real sweep is a genuine zero, while
  // repos:[] with no rollup is an absence. Same bytes, opposite meanings.
  const reposRow = ageH == null ? ['unknown', 'not scanned']
    : [repos.length ? 'ok' : 'stale', repos.length + ' scanned'];
  const scan = Array.isArray(d && d.scanners) ? d.scanners : [];
  const ran = scan.filter((x) => (x && x.ran) > 0).length;
  const lanes = !scan.length ? ['unknown', 'not scanned']
    : [ran === scan.length ? 'ok' : 'stale', ran + '/' + scan.length + ' ran'];
  const fr = (d && d.freshness) || {};
  const fk = Object.keys(fr);
  const never = fk.filter((k) => fr[k] && fr[k].state === 'never').length;
  const runtime = !fk.length ? ['unknown', 'not scanned']
    : never === fk.length ? ['unknown', 'never run']
    : [never ? 'stale' : 'ok', (fk.length - never) + '/' + fk.length + ' lanes live'];
  return [['Sweep', sweep], ['Repos', reposRow], ['Lanes', lanes], ['Runtime', runtime]];
}

function renderPosture(d){
  const el = $('posture');
  if (!el) return;
  el.innerHTML = postureRows(d).map(([k, [state, label]]) =>
    '<span class="p-row"><span class="p-dot" data-s="' + state + '"></span>'
    + '<span class="p-k">' + esc(k) + '</span>'
    + '<span class="p-v" data-s="' + state + '">' + esc(label) + '</span></span>').join('');
}

async function load(){
  // Always ask for the SELECTED project. Without this the server falls back to its default area,
  // so switching the picker only re-filtered stale fleet data instead of loading that project's.
  let d;
  try{ d=await (await fetch('/api/state?project='+encodeURIComponent(curProj||''))).json(); }
  catch(e){
    $('kpis').innerHTML='<div class="kpi bad"><div class="k">error</div><div class="v">offline</div></div>';
    // The picker is left saying `loading…` otherwise, which claims work is still in progress
    // after the fetch has already failed. An unresolved loading state is its own false claim,
    // and the operator cannot select a project to escape it.
    const ps=$('proj');
    if(ps&&!ps.dataset.n){ ps.innerHTML='<option value="">could not load projects</option>'; }
    return;
  }
  noteProjectGen(d.generated);
  // The scanner-detail tabs render from THIS payload: keep the last state so entering a tab
  // re-renders without a second fetch, and re-render now so their badges + rows track the poll.
  lastState=d;
  // BEFORE the tabs render: a generated tab that appears after its own render pass would show an
  // empty container until the next poll, which reads as a lane with nothing in it rather than a
  // lane that has not been drawn yet.
  addDerivedLaneTabs(d);
  renderScannerTabs(d);
  if(curView==='allfindings')renderAllFindings(d);
  // project segregation — standalone products (internal-b-dev, …) split out of the ClientA fleet
  SLUGS=d.slugs||SLUGS;
  // THE URL WINS OVER THE STORED PREFERENCE, resolved here because this is the first moment the
  // slug->label map exists. A link that names a project must show that project or it is not a link
  // to anything. An unknown slug is left alone rather than guessed at: it may name a project this
  // registry does not declare, and silently showing a different one is the attribution error the
  // whole change exists to remove.
  if(pendingProjSlug){
    const label=Object.keys(SLUGS||{}).find(k=>SLUGS[k]===pendingProjSlug);
    // The REASON is carried, not rendered here: the unselected branch below writes #kpis and would
    // overwrite anything put there now. One writer per surface, and the message says WHICH of the
    // two unselected states this is — no project named, versus a project named that does not exist.
    if(label){ curProj=label; try{localStorage.setItem('cw-proj',curProj)}catch(_){} unknownSlug=null; }
    else { curProj=''; unknownSlug=pendingProjSlug; }
    pendingProjSlug=null;
  }
  // ── NO PROJECT IS SELECTED FOR YOU ────────────────────────────────────────────────────────────
  // This used to fall to `projects[0]`, so opening the panel silently selected ClientA (first in
  // the picker) and rendered ITS findings. Every number on the page then described a project the
  // operator had not chosen and the picker gave no hint had been chosen for them — an attribution
  // error of exactly the kind this panel exists to refuse, and the shape that makes a reader act on
  // one project's criticals believing they are another's.
  //
  // An unselected project is now its own state: kept as '', shown as a placeholder, and rendered
  // below as a prompt rather than as zeros. Zeros are the trap — with no project the server nulls
  // every per-project field, so the KPI row would have read 0C 0H 0M 0L, which is indistinguishable
  // from a project that is genuinely clean.
  const projects=d.projects||[];
  if(curProj&&!projects.includes(curProj))curProj='';   // a stale localStorage pick, not a new one
  rescopeJobs();
  const psel=$('proj');
  // the key includes the batch assignment: a picker built before /api/state carried batches
  // is structurally different from one built after, and length alone cannot tell them apart
  const pickerN=String(projects.length)+':'+projects.map(p=>((d.batches||{})[p]||'-')).join(',');
  if(psel.dataset.n!==pickerN){
    // Grouped by the registry's DECLARED rollupBatch — the only grouping the registry actually
    // carries (7 of 32 areas have one). The 25 without are not bucketed into an invented category
    // and are not hidden: they get their own labelled group, so the picker says "these are
    // unbatched" rather than implying a structure nobody declared. Order within a group keeps the
    // server's sort, so the registry's primary area stays first where it appears.
    const batchOf=(n)=>((d.batches||{})[n]||null);
    const order=[], seen=new Set();
    for(const p of projects){ const b=batchOf(p); if(b&&!seen.has(b)){ seen.add(b); order.push(b); } }
    order.sort();
    const groupHtml=(label,names)=>names.length
      ? '<optgroup label="'+esc(label)+'">'
        +names.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('')+'</optgroup>'
      : '';
    psel.innerHTML='<option value="">— choose —</option>'
      +order.map(b=>groupHtml(b, projects.filter(p=>batchOf(p)===b))).join('')
      +groupHtml('unbatched', projects.filter(p=>!batchOf(p)));
    psel.dataset.n=pickerN;
  }
  psel.value=curProj;
  applyGroup(curView);
  if(!curProj){
    // Clear every per-view badge: a number left over from the last selection would sit beside a
    // page that is no longer describing that project.
    for(const t of SCANNER_TABS) setTabN(t.view,null);
    for(const v of ['runtime','codeql','modmap','exposure','remediation','issues']) setTabN(v,null);
    noteProjectGen(null);
    // The posture strip is GLOBAL, so it renders on this branch too. Leaving it alone here
    // would strand the last selection's reading above a page that is no longer describing it.
    renderPosture(d);
    // THE REFUSAL BELOW IS UNCHANGED, and the Fleet tab is not an exception to it. This row is
    // labelled with a project, so filling it with a fleet-wide sum would make the label a lie —
    // that is why nothing is shown for "all projects" here and never will be. What the Fleet tab
    // changed is that the fleet-wide question now has a page of its OWN, headed as the fleet, where
    // the same numbers are attributable. Pointing at it is the opposite of rendering it here.
    $('kpis').innerHTML=(unknownSlug
      ? '<div class="kpi bad"><div class="k">unknown project</div><div class="v">—</div>'
        +'<div class="s">the URL names <b>'+esc(unknownSlug)+'</b>, which this registry does not declare. '
        +'Nothing has been selected for you — pick a project above.</div></div>'
      : '<div class="kpi"><div class="k">no project selected</div>'
        +'<div class="v">—</div><div class="s">choose one above to see its findings. '
        +'Nothing is shown for "all projects": a fleet-wide total is not a project\'s posture.</div></div>')
      +'<div class="kpi"><div class="k">the fleet</div><div class="v">—</div>'
      +'<div class="s"><a href="/fleet/" data-view="fleet">Fleet</a> answers the box-wide questions instead: '
      +'total CVEs and KEVs, how many areas are swept, the sweep deadman\'s verdict and when each area last scanned. '
      +'Every total there names how many areas it was summed over.</div></div>';
    $('dimn').textContent='';
    $('dims').innerHTML='<tr><td colspan="4" class="mut">select a project to see which dimensions it covers</td></tr>';
    $('runtime').innerHTML='<div class="mut">select a project</div>';
    return;
  }
  // Capability comes from the SERVER (what this area actually has), never from the project's
  // name — gating on the literal 'ClientA' meant no other project could ever show these.
  const has=d.has||{};
  const pt=(d.projectTotals&&d.projectTotals[curProj])||{crit:0,high:0,med:0,low:0,kev:0,repos:0};
  const inProj=(p)=>(p||'unknown')===curProj; // unattributed items are 'unknown', never silently this project
  const sec=d.security||{}, c=d.counts||{}, nu=(has.runtime&&d.runtime&&d.runtime.nuclei)||null, cq=has.codeql?d.codeql:null;
  const dv=has.divergence?d.divergence:null, aq=has.adjudication?d.adjudication:null;
  const mod=d.modernization||{fleet:{}}, prog=d.program||{};
  const nHigh=nu?((nu.sev.critical||0)+(nu.sev.high||0)):0, nMed=nu?(nu.sev.medium||0):0, nLow=nu?(nu.sev.low||0):0;
  // Badges for the tabs whose numbers ride along on /api/state, which the panel already polls
  // every 8s — no extra request buys these. Exposure, Renovate and Remediation are NOT set here:
  // their sources are lazy (and /api/exposure actively probes DNS and origins, so polling it for
  // a badge would mean probing the fleet every 8 seconds). Those set their own badge on load.
  setTabN('runtime', (has.runtime&&nu)?(nHigh+nMed+nLow):null, 'Live website test findings, info excluded');
  setTabN('codeql',  (cq&&typeof cq.findings==='number')?cq.findings:null, 'CodeQL findings in this project\'s latest full scan');
  setTabN('modmap',  (has.modernization&&typeof mod.fleet.eolCount==='number')?mod.fleet.eolCount:null, 'services on an end-of-life runtime');
  renderPosture(d);
  $('kpis').innerHTML=[
    pt.unswept
      ? ['','Deployed CVEs','&mdash;',`no results exist yet for ${esc(curProj)}, so there is no findings figure to show. Never swept is not "clean".`]
      : [(pt.crit+pt.high)>0?'bad':(pt.med>0?'warn':'good'),'Deployed CVEs',`${pt.crit||0}<span class="u">C</span> · ${pt.high||0}<span class="u">H</span> · ${pt.med||0}<span class="u">M</span> · ${pt.low||0}<span class="u">L</span>`,`${pt.kev||0} KEV · ${pt.repos||0} repos · ${esc(curProj)}`],
    has.runtime?[nHigh?'bad':'good','Live website test findings',`${nHigh}<span class="u"> hi</span> · ${nMed}<span class="u"> md</span> · ${nLow}<span class="u"> lo</span>`,'vs live target']:['','Live website test findings','—','not available for this project'],
    has.codeql?[(cq&&cq.totals&&cq.totals.crit>0)?'bad':'good','CodeQL', cq?`${cq.findings??'—'}<span class="u"> findings</span>`:'—', cq?`${cq.scanned??0} service(s) scanned${cq.coverage&&cq.coverage.scope!=='area'?' · '+esc(cq.coverage.label||cq.coverage.scope):''}`:'not run']:['','CodeQL','—','not available for this project'],
    // D3 divergence (monitor/divergence.mjs), joined at render time from the G2 store. THE GREY IS
    // THE POINT: a score of 0 means two engines were asked and AGREED — that is a measurement. No
    // record at all means nobody asked. Rendering the absent case as 0 would publish agreement
    // nobody verified, so it reads "never measured" instead, exactly as the sibling cards above
    // read "not available for this project" rather than a zero.
    dv&&typeof dv.score==='number'
      ? [dv.score>=0.5?'bad':(dv.score>=0.2?'warn':'good'),'Engine divergence',`${dv.score.toFixed(2)}`,`${dv.samples||0} sample(s)${dv.at?' · '+esc(String(dv.at).slice(0,10)):''} · 0 = engines agreed`]
      : ['','Engine divergence','&mdash;','never measured — no check has scored this'],
    // G1 — the shared human adjudication queue. Rendering a saturated budget as "600/600 min" would
    // read as a full day's work; it is 50x that here. The OVERRUN FACTOR is the number that changes
    // what anyone does, so it is the one shown — a queue this far over capacity is not worked down,
    // it is evidence the undetermined tier needs triage rules rather than more human minutes.
    aq
      ? [aq.saturated?'bad':'good','Adjudication queue',`${aq.pending}<span class="u"> pending</span>`,
         aq.saturated
           ? `${aq.overBy}&times; the declared capacity (${Math.floor(aq.capacityMinutes/aq.minutesPerItem)} items / ${aq.capacityMinutes} min per cycle)`
           : `${aq.remainingMinutes} min left of ${aq.capacityMinutes}`]
      : ['','Adjudication queue','&mdash;','never measured — no results yet, so nothing was counted'],
    ['','Dimensions live',`${c.live||0}<span class="u">/${(c.live||0)+(c.part||0)+(c.plan||0)}</span>`,`${c.part||0} partial · ${c.plan||0} planned`],
    has.modernization?['good','Modernization',`${mod.fleet.atTarget||0}<span class="u">/${mod.fleet.total||0}</span>`,`${(mod.currentEraLabel||'—').replace(/ —.*/,'')} · Java25 ${mod.fleet.java25Wave||'—'} · ${mod.fleet.eolCount||0} EOL`]:['','Modernization','—','not available for this project'],
    [(prog.openPw||0)>0?'warn':'good','Program worklist',`${prog.openPw||0}<span class="u">pw</span>`,`${(prog.worklist||[]).length} items · ${Object.entries(prog.byStatus||{}).map(([k,v])=>v+' '+k).join(' · ')||'—'}`],
  ].map(([cl,k,v,s])=>`<div class="kpi ${cl}"><div class="k">${k}</div><div class="v tnum">${v}</div><div class="s">${s}</div></div>`).join('');
  // Guarded like every sibling above (`d.security||{}`, `d.counts||{}`). The server sends a static
  // array today, so this cannot fire — but an unguarded deref inside load() is a whole-panel
  // outage rather than one empty table, and that asymmetry is not worth keeping.
  const dims=d.dimensions||[];
  $('dimn').textContent=`${dims.length} dimensions`;
  $('dims').innerHTML=dims.map(x=>`<tr data-s="${esc(x.state)}"><td class="d"><b>${esc(x.name)}</b><span class="c">${esc(x.cat)}</span></td><td>${esc(x.tool)}</td><td class="mut">${esc(x.gate)}</td><td>${pill(esc(x.state), x.state==='part'?'partial':esc(x.state))}</td></tr>`).join('');
  // runtime
  const bola=d.runtime&&d.runtime.bola;
  let rt='';
  if(nu){ const order=['critical','high','medium','low','info']; rt+=order.filter(s=>nu.sev[s]).map(s=>`<span class="kv"><span class="mut">${s}</span><span>${nu.sev[s]}</span></span>`).join('');
    rt+=(nu.notable||[]).slice(0,6).map(f=>`<div class="find">${pill(f.sev==='high'||f.sev==='critical'?'high':'part',esc(f.sev))}<code>${esc(f.id)}</code><span class="at">${esc(String(f.at||'').replace(/^https?:\/\/[^/]+/,''))}</span></div>`).join(''); }
  else rt='<div class="mut">no live website test yet</div>';
  const fr=d.freshness||{};
  const fb=(f)=>f?`<span class="pill ${f.state==='fresh'?'live':f.state==='stale'?'part':'plan'}">${esc(f.label)}</span>`:'';
  if(bola) rt+=`<div class="kv gap-t"><span class="mut">BOLA ${fb(fr.bola)}</span><span>${bola.verdict||bola.mode||'—'}</span></div>`;
  const tls=d.runtime&&d.runtime.tlsHeaders, cspm=d.runtime&&d.runtime.cspm;
  if(tls&&tls.headers) rt+=`<div class="kv"><span class="mut">TLS/headers ${fb(fr.tls)}</span><span>${tls.headers.ran?('grade '+tls.headers.grade+' · '+(tls.headers.missing?tls.headers.missing.length:0)+' missing'):(tls.status||'skipped')}</span></div>`;
  if(cspm) rt+=`<div class="kv"><span class="mut">CSPM github ${fb(fr.cspm)}</span><span>${cspm.ran?('pass '+cspm.pass+' / fail '+cspm.fail):(cspm.reason||'skipped')}</span></div>`;
  $('runtime').innerHTML=rt;
  // R1 report-integrity — served projected (Y1); every absent/unknown state renders as itself
  $('intg-cons').innerHTML=renderConservation(d.conservation);
  $('intg-tl').innerHTML=renderTimelineVerify(d.timelineVerify);
  $('intg-anom').innerHTML=renderAnomalies(d.artifactAnomalies);
  $('intg-n').textContent=intgSummary(d);
  renderServices(d);
  // The three scanner-detail tabs share this payload, so they refresh on the same 8s poll as the
  // Overview — their tab badges cannot go stale relative to the coverage table they drill into.
  lastState=d;
  renderScannerTabs(d);
  if(curView==='allfindings')renderAllFindings(d);
  // codeql
  // snapshot fields from codeql-fleet.json (structured, per area) — the run.log scraper is gone,
  // so there is no 'scanning…' state here: this card describes the last PUBLISHED snapshot, and
  // its coverage line says on whose authority (scope 'none' is a labelled void, never a clean 0).
  $('codeql').innerHTML = cq? [
    ['snapshot', cq.generated?age(cq.generated):'—'],
    ['batch', cq.batch?`<code class="t-loc">${esc(cq.batch)}</code>`:'—'],
    ['services scanned', cq.scanned??'—'],
    ['findings', cq.findings??'—'],
    ['coverage', esc((cq.coverage&&cq.coverage.label)||'—')],
  ].map(([k,v])=>`<div class="kv"><span class="mut">${k}</span><span>${v}</span></div>`).join('') : '<div class="mut">not run — needs a host JDK</div>';
  // fleet grid (merged + retired slices)
  // status vocabulary is CLOSED (build-health + quality-gates) — explain each value on hover,
  // and colour the bad states so they stop reading as neutral text
  const CELL_TIP={
    advisory:'advisory only — no Java bytecode to hard-verify: JS repo (permanent ceiling) or jar not built (run a jar build for a real bytecode-vs-image check)',
    ok:'provenance verified — compiled bytecode target matches the declared base image',
    MISMATCH:'compiled bytecode does NOT match the declared base image — investigate',
    green:'toolchain verified — declared node/java version installs and builds in its own container',
    RED:'toolchain broken for the DECLARED version — EOL runtime, failing install, or failing build (the report names which phase in failedPhase)',
    skipped:'no engines.node/.nvmrc declared — nothing to verify (declare engines to enable the check)',
    'no-tests':'the toolchain run PASSED but executed no tests — a passing exit code over an empty test set is not evidence of health. Not green, and not a defect either: nothing was verified',
    unreadable:'the container ran but produced no phase terminator — it died mid-run (OOM kill, daemon restart, truncated output). We do not know the outcome; this is not a verdict on the repo',
    'env-blocked':'the machine that ran this scan could not run the check: docker unavailable, or the read-only copy of the repo into the container failed (disk, permissions, no tar in the image). A property of the RUNNER, not of the repo — declaring a version will not change it',
    clean:'deadcode clean — zero unused/undeclared dependencies',
    present:'gate satisfied',
    partial:'present but not fully wired (e.g. OpenAPI spec exists but the drift check is not wired, or boot-test file XOR gradle task)',
    MISSING:'gate not satisfied — a real work item, never auto-suppressed',
    'n/a':'does not apply to this repo type'};
  const cell=(v)=>{if(!v)return '—';
    const bad=v==='MISSING'||v==='MISMATCH'||v==='RED'||/^findings:/.test(v);
    const tip=CELL_TIP[v]||(/^findings:/.test(v)?v.replace('findings:','')+' unused/undeclared dependencies (depcheck / import-reachability) — see build-health-deadcode.json':'');
    return `<span class="${bad?'pill part':'mut'}"${tip?` title="${tip}"`:''}>${v}</span>`;};
  const slicePill=(lc)=>{if(lc==='superseded')return `<span class="pill part">superseded</span>`;const retired=lc&&lc.includes('retired');const fresh=lc&&lc.endsWith('-new');return `<span class="pill ${retired?'plan':'live'}">${(retired?'retired':'merged')}${fresh?' ✦new':''}</span>`;};
  const reposP=(d.repos||[]).filter(r=>inProj(r.project));
  const retiredP=has.lifecycle?(d.retired||[]):[]; // retired list is ClientA fleet exclusions
  const supersededP=has.lifecycle?(d.superseded||[]):[]; // lifecycle: rollback standby — NOT retired
  // ── GROUP BY REGISTRY ENTRY ────────────────────────────────────────────────────────────────
  // An area is a set of registry ENTRIES and an entry is a set of repos — client-a is client-a (26
  // services), client-a-libs (6), client-a-buildout and client-a-docs. Flat, that structure is
  // invisible and 34 rows read as one undifferentiated list.
  //
  // GROUPED ONLY WHERE IT CARRIES INFORMATION, and the test is DERIVED rather than a named
  // exception: group when at least one entry holds more than one repo. 100randomrepos is 100
  // entries of one repo each, so it stays flat — as it should, because "entry / -- same name" is a
  // heading that says nothing twice. commitwork-admin is the same shape and also stays flat. Naming
  // those slugs in a condition would have been a list to keep in step with the registry; this
  // cannot fall out of step because it reads the registry's own shape.
  const byEntry=new Map();
  for(const r of reposP){ const k=r.entry||r.name; if(!byEntry.has(k))byEntry.set(k,[]); byEntry.get(k).push(r); }
  const grouped=[...byEntry.values()].some(v=>v.length>1);
  const rowFor=(r,indent)=>{const b=r.buildHealth||{};const q=r.qualityGates||{};
    return `<tr><td><b class="name">${indent?'<span class="sub-mark">--</span> ':''}${esc(r.name)}</b></td><td>${slicePill(r.lifecycle)}</td><td>${r.worst==='none'?'<span class="pill live">clean</span>':pill(r.worst==='crit'||r.worst==='high'?'high':'part',esc(r.worst))}</td><td>${cell(b.deadcode)}</td><td>${cell(b.toolchain)}</td><td>${cell(b.provenance)}</td><td>${cell(q.bootTest)}</td><td>${cell(q.contracts)}</td><td>${cell(q.openapi)}</td><td>${cell(q.ci)}</td><td>${recBtn({repo:r.name,label:r.name})}</td></tr>`;};
  const active=grouped
    ? [...byEntry.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([entry,rs])=>
        `<tr class="row-entry"><td colspan="11"><b class="name">${esc(entry)}</b>`
        +`<span class="mut t-meta"> · ${rs.length} repo${rs.length===1?'':'s'}</span></td></tr>`
        + rs.map(r=>rowFor(r,true)).join('')).join('')
    : reposP.map(r=>rowFor(r,false)).join('');
  const superseded=supersededP.map(r=>`<tr class="row-superseded"><td><b class="name">${esc(r.name)}</b></td><td>${slicePill('superseded')}</td><td class="mut" colspan="9">superseded (rollback standby)${r.supersededBy?` — folded into ${esc(r.supersededBy)}`:''} · out of active scan scope, not retired</td></tr>`).join('');
  const retired=retiredP.map(r=>`<tr class="row-retired"><td><b class="name">${esc(r.name)}</b></td><td>${slicePill(r.lifecycle)}</td><td class="mut">—</td><td class="mut">excluded</td><td class="mut">—</td><td class="mut">—</td><td class="mut">—</td><td class="mut">—</td><td class="mut">—</td><td class="mut">—</td><td class="mut">—</td></tr>`).join('');
  $('repos').innerHTML=(active+superseded+retired)||'<tr><td colspan="11" class="mut">no repos in this project</td></tr>';
  $('fleetn').textContent=`${curProj} · ${reposP.length} merged · ${supersededP.length} superseded (standby) · ${retiredP.length} retired`;
  // Scanner coverage — grey is not green, per CATEGORY. ran/skipped/noscan come from the rollup's
  // scanners block (rollup.mjs derives them from checks-status.json). The states a cell must never
  // conflate are enumerated at covState() above: n/a, unrun and void are three different zero-run
  // facts, partial is ran-with-noscan-alongside, and clean/findings are real results. A rollup
  // written before run provenance existed has entries without `ran` — that is "no provenance", not
  // a void CLAIM: asserting VOID off absent evidence would be the same overreach in the other
  // direction.
  // Rendered client-side from an ISO string. The rollup deliberately stores ISO and never a rendered
  // age: rerollup-identical.test.mjs normalises ISO timestamps and nothing else, so a baked "3h old"
  // would make two byte-identical re-rolls differ.
  //
  // THE LABELS ARE A FALLBACK NOW, NOT THE REGISTRY. This map was the registry, and it was the
  // denominator too — `Object.keys(SCANNER_LABEL)` decided which categories existed. It carried
  // twelve names against monitor/extractors.mjs's twenty-five, so on client-d (2026-08-06) eleven
  // categories the rollup had spoken for were dropped from the table AND from the count, and the
  // header announced "12/12 categories" over a rollup carrying 23. Two of the vanished eleven,
  // tls-headers and api-fuzz, were sitting on unreported coverage gaps. The registry now ships from
  // the rollup (d.scannerRegistry); this copy only covers rollups written before that.
// The family words here are the vocabulary monitor/lane-tabs.mjs shortens; plainCheck() says them
// in plain words where a full label is displayed.
const plainCheck=(l)=>String(l).replace(/^SAST · /,'Code security · ').replace(/^DAST · /,'Live website test · ');
const SCANNER_LABEL={
  agentConfig:'Agent config · MCP servers, hooks, permission grants',
  weakRandom:'Insufficient randomness · credentials',
  secrets:'Secrets · Gitleaks',
  secretsBetterleaks:'Secrets · Betterleaks',
  secretsHistory:'Secrets in history · TruffleHog',
  sastSemgrep:'SAST · Semgrep',
  sastCodeql:'SAST · CodeQL (JS/TS)',
  sastCodeqlJava:'SAST · CodeQL (Java)',
  sastCodeqlPython:'SAST · CodeQL (Python)',
  sastCodeqlRuby:'SAST · CodeQL (Ruby)',
  sastGo:'SAST · gosec (Go)',
  depsJvm:'JVM CVEs · Trivy',
  depsGradleDeclared:'Gradle declared deps · deps.dev + OSV (floor)',
  depsGo:'Go CVEs · govulncheck',
  depsRetire:'JS library CVEs · Retire.js',
  maliciousPackages:'Malicious packages · OSV MAL-',
  supplyChain:'Supply chain · Socket',
  supplyChainHeuristic:'Supply-chain signals · GuardDog',
  vendorAssets:'Vendored assets',
  iac:'IaC config · Trivy',
  dockerfile:'Dockerfile · hadolint',
  cspm:'Cloud posture · GitHub CSPM',
  supplyChainPosture:'Supply-chain health · OpenSSF Scorecard',
  depsReachability:'Dependency reachability · OWASP dep-scan',
  gradleWrapper:'Gradle wrapper integrity',
  actionsPosture:'CI posture · zizmor',
  dast:'DAST · nuclei',
  bola:'Authz / BOLA',
  tlsHeaders:'TLS + security headers',
  apiFuzz:'API fuzz · Schemathesis',
  accessibility:'Accessibility · WCAG',
  denoLint:'Deno lint',
  denoTypes:'Deno type check',
  actionsLint:'CI correctness · actionlint',
  shellLint:'Shell · shellcheck',
  stubs:'Stubs / unfinished work',
  minifiedCode:'Minified / obfuscated code',
  cobolCoverage:'COBOL coverage · copybooks resolved, formats, unreadable',
  mainframeSecrets:'Mainframe credentials · RACF, JCL, TSO, CICS signon',
  sastCodeqlCpp:'SAST · CodeQL (C/C++)',
  sastCCppcheck:'SAST · cppcheck (C/C++)',
  sastCFlawfinder:'SAST · flawfinder (C/C++, lexical)',
  sastCodeqlSwift:'SAST · CodeQL (Swift)',
  sastCodeqlCsharp:'SAST · CodeQL (C#)',
  sastCodeqlRust:'SAST · CodeQL (Rust)',
  sastCodeqlGo:'SAST · CodeQL (Go)',
  sastAuto:'SAST · Semgrep --auto (comparison run)',
  sastJoern:'SAST · Joern (CPG, C/C++/binary)',
  sastBearer:'Data-flow · Bearer (privacy/PII)',
  sastElixir:'SAST · Sobelow (Elixir/Phoenix)',
  lintRust:'Lint · clippy (Rust, not a security scan)',
  lintGo:'Lint · golangci-lint (Go, not a security scan)',
  lintHaskell:'Lint · hlint (Haskell, not a security scan)',
  depsRustAudit:'Rust security advisories · cargo-audit (second opinion)',
  sastPython:'SAST · Bandit (Python)',
  lintPython:'Lint · ruff (Python, not a security scan)',
  sastBrakeman:'SAST · Brakeman (Ruby)',
  depsBundlerAudit:'Ruby gem security advisories · bundler-audit (second opinion)',
  sastPhp:'SAST · phpcs + security-audit (PHP)',sastPhpPsalm:'SAST · Psalm taint (PHP)',
  lintJava:'Lint · PMD (Java, not a security scan)',
  formatRust:'Format · rustfmt (Rust, not a security scan)',
  mobileManifest:'Mobile app settings · what Android/iOS apps expose',
  nodeHazards:'Node hazards · unsafe-by-presence constructs (JS/TS + templates)',
  depsContent:'Dependency content · lockfile integrity + install hooks',
  agentInstructions:'Agent instructions · hidden characters + injected directives',
  commitProvenance:'Commit origin · signatures, bots, identity',
  commitVelocity:'Commit velocity · machine-speed activity',
  modelArtefacts:'Model artefacts · pickle, safetensors, dataset configs, hub loads',
  actionsGaps:'CI gaps · self-hosted runners, triggering-head checkouts, missing permissions',
  actionsHealth:'CI health · red streaks, jobs never started, billed minutes',
  testHermetic:'Hermetic tests · cargo test on an empty home, disk headroom',
  jacksonCaseInsensitive:'Config guard · Jackson case-insensitive properties (CVE-2026-54515)',
  sastCobol:'SAST · cobolwork (COBOL, JCL, CICS)',
};
  // A confirmed-malicious package is not "findings". It is an incident: the dependency should never
  // have been installed, and any credential the machine that ran install could reach is now suspect.
  // It gets its own pill so it cannot read as one more row of CVE volume — the whole reason the
  // category was split out of the CVE lane in the first place (see monitor/rollup.mjs _malCounts).
  const CRITICAL_CATEGORY=new Set(['maliciousPackages']);
  const sc=d.scanners;
  if(sc&&Object.keys(sc).length){
    // Count against the FULL category set, never Object.keys(sc). A group-scoped sweep leaves the
    // rollup with 3 of 12 keys, and `${keys.length} categories` then read "3 categories · 0 VOID" —
    // full coverage of a 3-category programme. The denominator is what makes a narrow sweep legible.
    //
    // THE UNION IS THE POINT. The registry ships from the rollup now, but deriving the set from ANY
    // fixed list — shipped or bundled — reintroduces the exact bug this replaced the moment a
    // scanner is added at one end and not the other: a category present in `scanners` and absent
    // from the list was silently dropped from the table and from the denominator, so the panel
    // rendered 12 of 23 and called it 12/12. Unioning with the payload's own keys makes that
    // impossible by construction — an unregistered category still gets a row, labelled with its own
    // key, which is ugly on purpose. A category is never allowed to be invisible here; being ugly
    // is how it asks to be named.
    const REG=Array.isArray(d.scannerRegistry)&&d.scannerRegistry.length
      ? Object.fromEntries(d.scannerRegistry.map(r=>[r.key,r.label||r.key]))
      : SCANNER_LABEL;
    const LABEL=(k)=>plainCheck(REG[k]||SCANNER_LABEL[k]||k);
    const ALL=[...Object.keys(REG),...Object.keys(sc).filter(k=>!(k in REG))];
    const keys=ALL.filter(k=>sc[k]);
    const missing=ALL.filter(k=>!sc[k]);
    // The zero-run tally is split the way the pills are. Reporting one lumped "N VOID" was itself a
    // small version of the problem: on client-d it would have said 9, of which 4 are checks with
    // nothing here to read and 5 are real gaps — one number that no reader could act on.
    const st=Object.fromEntries(keys.map(k=>[k,covState(sc[k])]));
    const nNa=keys.filter(k=>st[k]==='na').length;
    const nUnrun=keys.filter(k=>st[k]==='unrun').length;
    const nVoid=keys.filter(k=>st[k]==='void').length;
    const carried=keys.filter(k=>sc[k].carried).length;
    // computed states that were served but never shown (3.2 preflight blind, 5.2 annotation health)
    const _pfBlind=(d.preflight&&d.preflight.blind)||[];
    const _ah=d.annotationHealth||{}; const _orph=(_ah.orphaned||[]), _exp=(_ah.expired||[]), _inv=(_ah.invalid||[]);
    $('scann').textContent=`${keys.length}/${ALL.length} categories`
      +(nUnrun?` · ${nUnrun} UNRUN (input missing)`:'')
      +(nVoid?` · ${nVoid} VOID (no trustworthy output)`:'')
      +(nNa?` · ${nNa} n/a (no target here)`:'')
      +(carried?` · ${carried} carried (not re-run this sweep)`:'')
      +(missing.length?` · ${missing.length} ABSENT (never scanned here)`:'')
      // 3.2 — a BLIND repo (its manifest declares dependencies but the lock artifact is absent) makes
      // a dependency scan here mean nothing; its zero is not clean. Per-area, from preflight.json.
      +(_pfBlind.length?` · ${_pfBlind.length} BLIND (declared deps, no lock — a scan here means nothing)`:'')
      // 5.2 — suppression integrity, FLEET-WIDE (one annotations.json bounds every area). Shown only
      // when non-zero, because 0 is the healthy norm. orphaned = authored but bound in no area.
      +((_orph.length||_exp.length||_inv.length)?` · suppressions(fleet): ${_orph.length} orphaned / ${_exp.length} expired / ${_inv.length} invalid`:'');
    // the WHICH, on hover — set via the .title property, which the browser renders as plain text
    // (never HTML), so a record string cannot inject markup the way an innerHTML tooltip could.
    $('scann').title=[ _pfBlind.length?`BLIND repos: ${_pfBlind.join(', ')}`:'',
      _orph.length?`orphaned suppressions: ${_orph.map(x=>x.record).join(' · ')}`:'',
      _exp.length?`expired: ${_exp.map(x=>x.record).join(' · ')}`:'',
      _inv.length?`invalid: ${_inv.map(x=>x.record).join(' · ')}`:'' ].filter(Boolean).join('\n');
    $('scanners').innerHTML=keys.map(k=>{const s=sc[k];
      const prov=('ran' in s);            // run provenance present at all?
      const isVoid=prov&&s.ran===0;       // in scope somewhere, produced a scan nowhere
      const inScope=prov?(s.ran+s.skipped+s.noscan):null;
      const findings=isVoid
        ?'<span class="mut" title="no findings figure exists — this category never produced a scan">—</span>'
        :`<span class="tnum">${s.total}</span> <span class="mut t-loc">${s.crit}C ${s.high}H ${s.med}M ${s.low}L</span>`;
      const state=s.carried
        ?`<span class="pill part" title="not re-run by this sweep — carried forward from slice ${esc(s.carriedFrom||'?')} observed ${esc(s.carriedAt||'?')}. The figure is that slice's, not this one's; it chains until the category is actually rescanned.">carried · as of ${age(s.carriedAt)}</span>`
        :!prov
        ?'<span class="mut" title="this rollup predates run provenance — re-roll the batch to populate ran/skipped/noscan">no provenance</span>'
        :isVoid
          ?(()=>{const c=COV_COPY(s,st[k]);return `<span class="pill ${c.cls}" title="${c.why}">${c.label}</span>`;})()
          :(s.noscan>0
            ?`<span class="pill part" title="${s.ran} ran, but ${s.noscan} repo(s) noscan — partial coverage, findings are a floor not a total">partial · ${s.noscan} noscan</span>`
            :(s.total>0
              ?(CRITICAL_CATEGORY.has(k)
                ?`<span class="pill crit" title="${s.total} confirmed-malicious package(s) — treat as an incident, not a backlog item">MALWARE — ${s.total}</span>`
                :'<span class="pill high">findings</span>')
              :'<span class="pill live">clean</span>'));
      // Appended, never substituted. A category can be CLEAN and half-blind at once — that pairing
      // is the whole reason coverage is a separate axis, so the lane pill sits beside the state pill
      // rather than replacing it. Empty string when the rollup predates the field, so an older
      // rollup renders exactly as it did before rather than growing an "unknown" nobody measured.
      const lanePill=laneCovPill(s);
      // THE CLOCK CARRIES NO VERB, WHICH IS WHY IT CAN DATE A SKIP. This read "ran ${age}", and the
      // timestamp behind it was stamped from the category's checks-status row whatever its status —
      // so a category that had only ever skipped printed "ran 13h ago" beside its own "never ran"
      // pill, both from this one field. rollup.mjs now splits them: `lastRunAt` advances only on
      // pass/fail, `lastCheckedAt` on any verdict INCLUDING a skip. Falling back to lastCheckedAt is
      // deliberate and is not the old bug returning — "🕐 13h old" claims only that the verdict in
      // the state column is 13h old, which is exactly what a reader needs to know about an UNRUN:
      // whether it is this morning's gap or one that has been open for three weeks.
      // aria-hidden because a bare clock emoji is announced as "one o'clock"; the sr-only text
      // carries the meaning instead.
      const asOf=s.carried?s.carriedAt:(s.lastRunAt||s.lastCheckedAt);
      const sub=esc(s.check||k)+(asOf?` · <span aria-hidden="true">🕐</span><span class="sr-only">verdict age </span> ${age(asOf)}`:'');
      const num=(v)=>prov?`<span class="${s.carried?'mut':''}">${v}</span>`:'—';
      return `<tr${s.carried?' class="row-carried"':''}><td><b class="name">${esc(LABEL(k))}</b><span class="cat-sub">${sub}</span></td><td>${findings}</td><td class="tnum">${num(s.ran)}</td><td class="tnum">${num(s.skipped)}</td><td class="tnum">${num(s.noscan)}</td><td>${state}${lanePill?` ${lanePill}`:''}</td><td>${recBtn({scanner:k,label:LABEL(k)})}</td></tr>`;
    }).join('')
    // ABSENT is its own row, not a gap. A category this rollup never spoke for must not simply be
    // missing from the table — that is the shape that read as clean.
    // An ABSENT category is the one most worth a ⏺: it has never produced a scan here, so the
    // button is the shortest path from "no evidence either way" to evidence.
    +missing.map(k=>`<tr class="row-absent"><td><b class="name">${esc(LABEL(k))}</b><span class="cat-sub">${esc(k)}</span></td><td class="mut">—</td><td class="tnum">—</td><td class="tnum">—</td><td class="tnum">—</td><td><span class="pill plan" title="this category has never produced a scan in this area, and was not carried forward from any prior slice — no evidence either way">ABSENT — never scanned</span></td><td>${recBtn({scanner:k,label:LABEL(k)})}</td></tr>`).join('');
  }else{
    $('scann').textContent='—'; $('scann').title='';
    $('scanners').innerHTML='<tr><td colspan="7" class="mut">these results list no checks — run a full scan of this project, then refresh</td></tr>';
  }
  // CVEs + Remediation (unified) — scoped to the selected project
  const rem=(d.remediation||[]).filter(x=>inProj(x.project));
  const cves=rem.filter(x=>x.source==='CVE');
  // one statement, one source: both the package count and the severity split come from the
  // rows actually rendered, so the header can never contradict the table beneath it.
  const cs=cves.reduce((a,x)=>(a[x.sev]=(a[x.sev]||0)+1,a),{});
  if($('foot')&&d.source){$('foot').innerHTML='Live from <code>'+esc(d.source.dir)+'/rollup.json</code>'+(has.runtime?' + <code>'+esc(d.source.runtime)+'</code>':'')+(has.codeql?' + the latest CodeQL fleet run':'')+'. Localhost only.';}
  $('cven').textContent=`${cves.length} package(s) · ${cs.crit||0}C ${cs.high||0}H ${cs.med||0}M ${cs.low||0}L · ${curProj}`;
  $('cves').innerHTML=cves.map(x=>`<tr><td><code>${esc(x.title)}</code></td><td>${pill(x.sev==='crit'||x.sev==='high'?'high':'part',esc(x.sev))}</td><td class="mut">${esc((x.repos||[]).join(', '))||'—'}</td><td>${x.status==='accepted'?'<span class="pill part">accepted</span>':pill('high',esc(x.status))}</td><td class="mut cell-msg">${esc(x.detail||'')}</td></tr>`).join('')||'<tr><td colspan="5"><span class="pill live">0 CVEs</span></td></tr>';
  const fleetWide=rem.filter(x=>x.scope==='fleet-wide').length;
  $('remn').textContent=`${rem.filter(x=>x.status!=='accepted').length} open · ${rem.filter(x=>x.status==='accepted').length} accepted`+(fleetWide?` · ${fleetWide} fleet-wide`:'');
  $('remed').innerHTML=rem.map(remedRow).join('')||'<tr><td colspan="6"><span class="pill live">nothing outstanding</span></td></tr>';
  // program worklist + waves (modernization / launch)
  $('progn').textContent = prog.openPw!=null ? `${prog.openPw} pw open / ${prog.totalPw} total · as of ${prog.asOf||'—'}` : 'no program data';
  const wpill=(s)=>`<span class="pill ${s==='done'?'live':s==='in-progress'?'part':'plan'}">${s}</span>`;
  $('waves').innerHTML=(mod.waves||[]).map(w=>`<span class="kv kv-tight">${wpill(w.status)}<span class="mut">${w.label}</span></span>`).join('')||'<span class="mut">no waves</span>';
  const stPill=(s)=>`<span class="pill ${s==='in-progress'?'part':'plan'}">${s}</span>`;
  $('worklist').innerHTML=(prog.worklist||[]).map(x=>`<tr><td class="mut tnum">${esc(x.id)}</td><td>${esc(x.item)}</td><td>${stPill(x.status)}</td><td class="tnum">${esc(x.pw)}</td></tr>`).join('')||'<tr><td colspan="4" class="mut">no worklist</td></tr>';
}
// One Remediation row. Runtime rows (DAST/TLS/BOLA/CSPM) come from the shared runtime scan, which has
// no project dimension: serve.mjs tags them scope:'fleet-wide', and untagged they read as this project's.
function remedRow(x,i){
  const src=`<span class="pill ${({CVE:'part',DAST:'high',BOLA:'high',TLS:'part',CSPM:'part'})[x.source]||'plan'}">${esc(x.source)}</span>`;
  const scope=x.scope==='fleet-wide'?' <span class="pill plan" title="From the shared runtime scan, which has no project dimension: not specific to this project, and listed under every project.">fleet-wide</span>':'';
  return `<tr${x.status==='accepted'?' class="row-accepted"':''}><td class="mut tnum">${i+1}</td><td>${src}${scope}</td><td>${pill(x.sev==='crit'||x.sev==='high'?'high':'part',esc(x.sev))}</td><td><b class="name">${esc(x.title)}</b>${x.detail?`<br><span class="mut t-loc">${esc(x.detail)}</span>`:''}</td><td class="mut cell-act">${esc(x.action||'')}</td><td>${x.status==='accepted'?'<span class="pill part">accepted</span>':'<span class="pill high">open</span>'}</td></tr>`;
}
let svcCur=null;
function selSvc(s){svcCur=s;$('svcframe').src='/svc/'+s+'/';document.querySelectorAll('#svctabs button').forEach(b=>b.classList.toggle('pri',b.dataset.svc===s));}
function renderServices(d){
  const svcs=(d&&d.services)||[]; // no hardcoded roster: absent means none configured
  const tabs=$('svctabs');
  if(tabs.childElementCount!==svcs.length){
    tabs.innerHTML=svcs.map(s=>`<button type="button" data-svc="${s}">${s}</button>`).join('');
    tabs.querySelectorAll('button').forEach(b=>b.onclick=()=>selSvc(b.dataset.svc));
    selSvc(svcCur&&svcs.includes(svcCur)?svcCur:svcs[0]);
  }
}
// Choosing a project keeps the reader where they are: a project page re-renders for the new project,
// and a fleet or Manage page stays put, its scope chip saying the picker does not apply to it (the
// operator asked for no bouncing, 2026-09-25). Clearing the project is the one move that leaves: a
// per-project page with no project answers for nothing, so it goes to Fleet.
$('proj').onchange=e=>{curProj=e.target.value;try{localStorage.setItem('cw-proj',curProj)}catch(_){}
  const scope=scopeOf(curView);
  if(!curProj&&scope==='project'){setView('fleet');load();return;}
  if(scope!=='project'){applyGroup(curView);load();return;}
  try{const u=viewUrl(curView);if(location.pathname+location.search+location.hash!==u)history.pushState(null,'',u);}catch(_){}if(curView==='modmap'||curView==='timeline'||curView==='sitemap'){$('viewframe').src=viewSrc(curView);}if(curView==='report')loadReport();if(curView==='remediation')loadRemediation();if(curView==='codeql')loadCodeql();if(curView==='renovate')loadRenovate();if(curView==='exposure')loadExposure();load();};
// The scope toggle re-probes rather than filtering what is already drawn: the totals are
// computed server-side over the scoped set, so a client-side filter would leave the KPI row
// describing a different set of hosts than the table below it.
if($('exp-scope'))$('exp-scope').onchange=()=>loadExposure();
// Refresh reloads what is ON SCREEN. It was bound to load() alone, which fetches /api/state — but
// the Fleet page (the landing view), the health/sweep/stpa boxes and the report tabs each render
// from their own endpoint, so on the page an operator lands on the button changed nothing.
$('refresh').onclick=async()=>{
  const b=$('refresh');b.disabled=true;
  const jobs=[load()];
  if(curView==='fleet')jobs.push(loadFleet());
  if(curView==='modmap'||curView==='timeline'||curView==='sitemap')$('viewframe').src=viewSrc(curView);
  if(curView==='report')jobs.push(loadReport());
  if(curView==='remediation')jobs.push(loadRemediation());
  if(curView==='remfleet')jobs.push(loadRemFleet());if(curView==='daily')jobs.push(loadDaily());
  if(curView==='codeql')jobs.push(loadCodeql());
  if(curView==='renovate')jobs.push(loadRenovate());
  if(curView==='exposure')jobs.push(loadExposure());
  jobs.push(fetch('/api/status?'+jobQ()).then(r=>r.json()).then(st=>{
    renderHealth(st.health,null);renderStpa(st.stpa||null);
    if(st.sweep){renderSweep(st.sweep);updateSweepBtn(st.sweep);}
  },e=>renderHealth(null,'could not read /api/status ('+e.message+')')));
  try{await Promise.allSettled(jobs);}finally{b.disabled=false;}
};
// ── live sweep console ───────────────────────────────────────────────────────────────────────
// Poll /api/status fast while a sweep runs; tail its output + progress; when it flips to done,
// stop fast-polling and load() once so the KPIs/tables reflect the fresh rollup immediately.
let sweepTimer=null,sweepActive=false,sweepUserHid=false,lastSeq=-1,sweepStream=null;
const fmtDur=(ms)=>{const s=Math.max(0,Math.round(ms/1000));return s<60?s+'s':Math.floor(s/60)+'m '+String(s%60).padStart(2,'0')+'s';};
function renderSweep(sw){
  const bar=$('sweepbar');
  if(!sw){bar.style.display='none';return;}
  // a dismissed COMPLETED sweep stays dismissed across polls and page loads (keyed by its
  // finish time in localStorage); a new run always un-dismisses via startSweepPolling
  const dismissed=!sw.running&&sw.finishedAt&&localStorage.getItem('cw-sweep-dismissed')===String(sw.finishedAt);
  if((sweepUserHid||dismissed)&&!sw.running){bar.style.display='none';return;}
  // 'block', not '': the console's pre-run hide is .jshide in panel.css now, and clearing the
  // inline value would hand it straight back to that class instead of revealing the bar.
  if(!sweepUserHid)bar.style.display='block';
  const ico=$('sw-ico'),ok=sw.exitCode===0;
  if(sw.running){ico.className='spin';ico.textContent='';ico.style.color='';$('sw-title').textContent=(sw.label?('scan · '+sw.label):'sweep running')+' · '+(sw.phase||'…');}
  else{ico.className='';ico.textContent=ok?'✓':'✕';ico.style.color=ok?'var(--live)':'var(--crit)';$('sw-title').textContent=ok?'sweep complete':'sweep exited ('+sw.exitCode+')';}
  const pct=sw.total?Math.round((sw.done/sw.total)*100):(sw.running?8:100);
  const prog=$('sw-prog');
  prog.style.width=(sw.running?Math.max(4,Math.min(pct,98)):100)+'%';
  prog.style.background=sw.running?'var(--acc)':(ok?'var(--live)':'var(--crit)');
  $('sw-sub').textContent=sw.total?(sw.done+'/'+sw.total+(sw.current?' · '+sw.current:'')):(sw.current||'');
  const t0=sw.startedAt?new Date(sw.startedAt).getTime():0;
  const t1=sw.finishedAt?new Date(sw.finishedAt).getTime():Date.now();
  $('sw-elapsed').textContent=t0?fmtDur(t1-t0):'';
  // rewrite the tail only when new lines arrived; keep pinned to bottom unless the user scrolled up
  // Whole-buffer rewrite. This is the POLL path only — the stream path appends (appendLine below)
  // and leaves lastSeq alone, so a rewrite here would undo lines the stream already placed.
  if(!sweepStream&&sw.seq!==lastSeq){lastSeq=sw.seq;const log=$('sw-log');const pin=log.scrollTop+log.clientHeight>=log.scrollHeight-24;log.innerHTML=ansiHtml((sw.lines||[]).join('\n'));if(pin)log.scrollTop=log.scrollHeight;}
}
// Append one streamed line. Scroll-pinning is preserved from the poll implementation: measure
// BEFORE mutating, restore after — the 24px slack is what lets a user reading history stay put.
// ansiHtml() escapes first and parses after (scanner output is untrusted and lands in innerHTML),
// so lines are converted individually and appended rather than re-joined and re-parsed.
function appendLine(line){
  const log=$('sw-log');if(!log)return;
  const pin=log.scrollTop+log.clientHeight>=log.scrollHeight-24;
  log.insertAdjacentHTML('beforeend',(log.innerHTML?'\n':'')+ansiHtml(line));
  if(pin)log.scrollTop=log.scrollHeight;
}
// A job records the area SLUG it ran; the operator knows projects by label.
function labelOfSlug(slug){ return slug?(Object.keys(SLUGS||{}).find(k=>SLUGS[k]===slug)||slug):null; }
// The idle run control names the project it will run. "Run all project checks" read as every
// project while it ran one — the primary area, when nothing was selected.
function sweepIdleLabel(){ return curProj?'▶ Run checks · '+curProj:'▶ Run checks'; }
function updateSweepBtn(sw){
  const run=!!(sw&&sw.running);
  sweepRunningNow=run;                       // the click handler reads this to decide play vs stop
  $('sweep').classList.toggle('running',run);
  const who=run?labelOfSlug(sw.project):null;
  $('sweep').textContent=run?('■ stop'+(who?' '+who:'')+(sw.total?' · '+sw.done+'/'+sw.total:'')):sweepIdleLabel();
  $('sweep').title=run?'stop the running sweep'+(who?' of '+who:'')+' — areas already completed keep their results; the area in flight publishes nothing':(curProj?'run every check for '+curProj:'');
  // A stopped run must not read as a finished one anywhere in the strip.
  sweepLastStopped=!run&&!!(sw&&sw.stoppedAt);
  if(sweepLastStopped)$('sweep').textContent=sweepIdleLabel()+' (last: STOPPED)';
  if(typeof syncScopeChrome==='function')syncScopeChrome(curView);
  const st=$('sw-stop'); if(st)st.style.display=run?'inline-flex':'none';   // .vtab's own display; see .jshide
  // one job slot: while anything holds it, every ⏺ is unavailable rather than silently refused
  setRecEnabled(run);}
async function pollSweep(){
  let sw;try{sw=(await (await fetch('/api/status?'+jobQ())).json()).sweep;}catch(e){return;}
  renderSweep(sw);updateSweepBtn(sw);
  // The fallback carries lane state too. Without this a browser that cannot hold an EventSource —
  // or a proxy that buffers one — would show a live console and permanently still lane tabs, and
  // the stillness would be indistinguishable from nothing running.
  seedLanes(sw);
  if(sw&&sw.running){sweepActive=true;}
  else if(sweepActive){sweepActive=false;if(sweepTimer){clearInterval(sweepTimer);sweepTimer=null;}stopSweepStream();load();/* refresh numbers on completion */}
}
// ── PER-LANE RUN STATE ──────────────────────────────────────────────────────────────────────────
// Until now the page could say a sweep was running and which REPOSITORY it had reached, and nothing
// between: every per-lane fact waited for the rollup, which lands after the whole sweep. A lane
// running for the first time — the one case where the operator has just pressed the button and has
// no prior result to look at — showed the same empty panel it showed before they pressed it.
//
// Keyed by CHECK id, because that is the identity the runner announces. The tab is found by walking
// the published registry to the category and the category to its view; unresolvable stops here
// rather than guessing, since marking the wrong tab as running is worse than marking none.
let laneRun={};                       // check id -> the record serve.mjs keeps
const laneNoteTimers={};
function laneCatForCheck(check){
  const reg=(lastState&&lastState.scannerRegistry)||[];
  const hit=Array.isArray(reg)?reg.find(r=>r&&r.check===check):null;
  return hit?hit.key:null;
}
function laneViewForCheck(check){
  const cat=laneCatForCheck(check); if(!cat)return null;
  const t=(typeof SCANNER_TABS!=='undefined'?SCANNER_TABS:[]).find(x=>x.key===cat);
  return t?t.view:null;
}
/** Paint (or clear) the circulating marker on a lane's tab button. */
function paintLaneTab(check){
  const view=laneViewForCheck(check); if(!view)return;
  const btn=document.querySelector('.vtab[data-v="'+CSS.escape(view)+'"]');
  if(!btn)return;
  const rec=laneRun[check];
  const on=!!(rec&&rec.running&&rec.running.length);
  btn.classList.toggle('lane-running',on);
  // FIRST RUN is its own state and gets its own marker. A lane that has run before and is running
  // again is progress; a lane that has never run and is running now is the answer to the question
  // the empty panel was asking, and the operator is watching for exactly it.
  btn.classList.toggle('lane-first-run',on&&!!(rec&&rec.firstRun));
  if(on)btn.setAttribute('aria-busy','true'); else btn.removeAttribute('aria-busy');
}
/** One lane's news. Called from the SSE frame and from the polling fallback alike. */
function applyLaneEvent(ev){
  if(!ev||!ev.check)return;
  const prev=laneRun[ev.check];
  const rec=Object.assign({},ev.rec||{});
  // Whether this was a first run is decided ONCE, when the lane starts, and then carried. Deciding
  // it at paint time would read a `scanners` block that the completing sweep is about to fill in,
  // and the marker would vanish at the moment it mattered.
  rec.firstRun=prev&&('firstRun' in prev)?prev.firstRun
    :!((lastState&&lastState.scanners||{})[laneCatForCheck(ev.check)]);
  laneRun[ev.check]=rec;
  paintLaneTab(ev.check);
  if(ev.event==='end')noteLaneDone(ev);
  if(ev.event==='abandoned')noteLaneAbandoned(ev);
  // the open lane's own panel, if this is the lane being looked at
  if(typeof refreshOpenLaneVoid==='function')refreshOpenLaneVoid(ev.check);
}
/** Seed from a status payload — a client that connects mid-sweep must see what is already running. */
function seedLanes(sw){
  if(!sw||!sw.lanes)return;
  for(const [check,rec] of Object.entries(sw.lanes)){
    const prev=laneRun[check];
    const next=Object.assign({},rec);
    next.firstRun=prev&&('firstRun' in prev)?prev.firstRun
      :!((lastState&&lastState.scanners||{})[laneCatForCheck(check)]);
    laneRun[check]=next;
    paintLaneTab(check);
  }
}
function laneLabelFor(check){
  const cat=laneCatForCheck(check);
  return (cat&&LANE_TITLE[cat])||cat||check;
}
// A completion is announced where the operator is, not only where the lane lives. They pressed a
// button on one tab and may be reading another by the time it finishes.
function noteLaneDone(ev){
  const where=ev.project?' · '+ev.project:'';
  const took=(typeof ev.ms==='number')?' in '+(ev.ms/1000).toFixed(1)+'s':'';
  // The status is quoted, not translated into a tone. 'noscan' is not a failure and not a pass, and
  // a two-colour notice would have to make it one of them.
  toastLane(laneLabelFor(ev.check)+' finished'+(ev.repo?' on '+ev.repo:'')+where+' — '+(ev.status||'no status recorded')+took,
    ev.status==='fail'?'bad':(ev.status==='pass'?'ok':'grey'));
}
function noteLaneAbandoned(ev){
  toastLane(laneLabelFor(ev.check)+' stopped without finishing'+(ev.project?' · '+ev.project:'')
    +' — it published nothing, which is not the same as finding nothing','grey');
}
function toastLane(msg,tone){
  let host=$('lane-toasts');
  if(!host){host=document.createElement('div');host.id='lane-toasts';host.className='lane-toasts';document.body.appendChild(host);}
  const el=document.createElement('div');
  el.className='lane-toast '+(tone||'grey');
  el.setAttribute('role','status');
  el.textContent=msg;
  host.appendChild(el);
  const id=setTimeout(()=>{el.remove();delete laneNoteTimers[id];},9000);
  laneNoteTimers[id]=true;
}

// Re-render only the lane being LOOKED AT, and only every 250ms. renderScannerTabs redraws the
// whole strip; a fleet sweep completes thousands of lanes, and calling it per event would spend the
// browser on tabs nobody has open.
let laneVoidTimer=null;
function refreshOpenLaneVoid(check){
  const view=laneViewForCheck(check);
  if(!view||view!==curView||laneVoidTimer)return;
  laneVoidTimer=setTimeout(()=>{laneVoidTimer=null;if(lastState){renderScannerTabs(lastState);if(curView==='allfindings')renderAllFindings(lastState);}},250);
}

// The live console: EventSource first, the 1200ms poll as the fallback.
//
// The poll re-rendered all 400 retained lines on every tick to discover whether any were new;
// the stream delivers each line once, tagged with the seq it already had, and the browser's own
// Last-Event-ID reconnect resumes from exactly where it stopped. The poll is KEPT — an
// EventSource that errors (proxy that buffers, a browser that cannot) falls back rather than
// leaving the operator with a dead console.
function startSweepStream(){
  if(sweepStream||typeof EventSource==='undefined')return false;
  let es;
  try{es=new EventSource('/api/status/events?kind=sweep&'+jobQ());}catch(e){return false;}
  sweepStream=es;
  es.addEventListener('line',(e)=>{
    const d=JSON.parse(e.data);
    if(d.seq<=lastSeq)return;      // replay overlap after a reconnect
    lastSeq=d.seq;appendLine(d.line);
  });
  es.addEventListener('gap',(e)=>{
    const d=JSON.parse(e.data);
    // Lost lines are STATED. A console that silently skips is worse than one that admits it.
    appendLine('[panel] '+d.dropped+' line(s) scrolled out of the retained window while disconnected');
  });
  es.addEventListener('lane',(e)=>{
    // Its own frame, not a status republish: a fleet sweep completes thousands of lanes and
    // pushing the whole job status for each would spend the stream on fields that did not move.
    try{applyLaneEvent(JSON.parse(e.data));}catch(err){}
  });
  es.addEventListener('status',(e)=>{
    const sw=JSON.parse(e.data);if(!sw)return;
    renderSweep(sw);updateSweepBtn(sw);seedLanes(sw);
    if(sw.running){sweepActive=true;}
    else if(sweepActive){sweepActive=false;stopSweepStream();load();/* refresh numbers on completion */}
  });
  es.onerror=()=>{
    // Browsers auto-reconnect an EventSource; only a CLOSED socket is terminal, and that is when
    // the poll takes over.
    if(es.readyState===EventSource.CLOSED){sweepStream=null;if(sweepActive)startSweepPolling(true);}
  };
  return true;
}
function stopSweepStream(){if(sweepStream){try{sweepStream.close();}catch(e){}sweepStream=null;}}
function startSweepPolling(forcePoll){
  sweepActive=true;sweepUserHid=false;
  // Already streaming: nothing to start. Without this the second caller (the ⏺ buttons and the
  // boot attach both call in) would fall through and ALSO arm the poll timer, so every line
  // would be appended by the stream and then re-rendered by the poll.
  if(sweepStream&&!forcePoll)return;
  if(!forcePoll&&startSweepStream()){pollSweep();return;} // one poll seeds the bar; the stream carries the rest
  if(sweepTimer)return;
  pollSweep();sweepTimer=setInterval(pollSweep,1200);
}
// bound by id, NOT by a bare `.vtab` selector: this button carries that class for styling, and a
// loose selector is exactly what once stole the view-switcher's handler (see the #views note).
$('sw-stop').onclick=()=>stopSweep();
$('sw-hide').onclick=()=>{sweepUserHid=true;$('sweepbar').style.display='none';
  // persist dismissal of a finished sweep so the stale "sweep complete" banner does not
  // resurrect on every page load; a new sweep run clears the flag (startSweepPolling)
  fetch('/api/status?'+jobQ()).then(r=>r.json()).then(d=>{const sw=d.sweep;if(sw&&!sw.running&&sw.finishedAt)localStorage.setItem('cw-sweep-dismissed',String(sw.finishedAt));}).catch(()=>{});};
// VCR transport, one button: ▶ starts, ■ stops. It USED to render ◼ while running and still POST
// /api/sweep on click, which the server refused as "already running" — the stop glyph was a lie the
// operator could press. Now the glyph and the action agree, and stopping is real (the server
// signals the child's whole process group; see stopJob in serve.mjs).
let sweepRunningNow=false, sweepLastStopped=false;
async function stopSweep(){
  if(!confirm('Stop the running sweep?\n\nAreas it has not reached will keep their PREVIOUS results, and the area it is mid-way through publishes nothing — its in-flight marker stays, so liveness will keep reporting that state as unresolved. This does not undo areas already completed.'))return;
  $('sweep').textContent='■ stopping…';
  try{ const r=await (await cwPost('/api/sweep/stop?kind=sweep')).json();
    if(r&&!r.stopped){alert('not stopped — '+((r&&r.reason)||'unknown reason'));}
  }catch(e){ alert('could not stop the sweep: '+e.message); }
  pollSweep();
}
$('sweep').onclick=async()=>{
  if(sweepRunningNow)return stopSweep();
  if(!curProj){alert('checks not started — choose a project first; checks run per project');return;}
  $('sweep').textContent='▶ starting…';
  // READS THE REPLY: cwPost resolves on a refusal, so "nothing thrown" never meant "it started".
  let r;
  try{r=await (await cwPost('/api/sweep?project='+encodeURIComponent(curProj))).json();}
  catch(e){$('sweep').textContent=sweepIdleLabel();alert('checks not started — '+e.message);return;}
  if(r&&r.started===false&&r.reason!=='already running'){$('sweep').textContent=sweepIdleLabel();alert('checks not started — '+r.reason);return;}
  startSweepPolling(); // attaches whether the POST started a new sweep or one was already running
};

// ── STPA/HAZOP live console ──────────────────────────────────────────────────────────────────────
// Mirrors the sweep console's poll+stream pattern (appendLine/ansiHtml, EventSource-first with a
// 1200ms poll fallback), scaled down for a single-shot job with no per-lane state: stpa-sweep.mjs
// runs once and exits, so there is no progress percentage to draw, only running/done + a log tail.
// #bola-console proved this markup shape exists elsewhere with NO js wiring behind it at all — this
// block is written from scratch against the real job-status shape (jobStatus() in serve.mjs), not
// copied from that unwired precedent.
let stpaStream=null,stpaTimer=null,stpaActive=false,lastStpaSeq=-1;
function appendStpaLine(line){
  const log=$('stpa-log');if(!log)return;
  const pin=log.scrollTop+log.clientHeight>=log.scrollHeight-24;
  log.insertAdjacentHTML('beforeend',(log.innerHTML?'\n':'')+ansiHtml(line));
  if(pin)log.scrollTop=log.scrollHeight;
}
// Derived from the job's own lines, never a separate fetch — the CLI's [stpa] OK/FLAG/UNCL/OPEN
// prefix IS the classification (monitor/stpa-sweep.mjs), so the summary is a real count of what
// the log already says, not a second source of truth that could disagree with it.
function stpaSummaryLine(j){
  if(!j)return 'never run';
  if(j.running)return 'running…';
  if(!j.finishedAt)return 'never run';
  const lines=j.lines||[];
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- mark is a literal STPA marker word from this file
  const count=(mark)=>lines.filter(l=>new RegExp('^\\[stpa\\]\\s*'+mark+'\\b').test(l)).length;
  const flagged=count('FLAG'),uncl=count('UNCL'),open=count('OPEN'),ok=count('OK');
  return (ok+flagged+uncl)+' control action(s) classified · '+flagged+' flagged · '+uncl+' unclassified · '+open+' open finding(s) · '+new Date(j.finishedAt).toLocaleString();
}
function renderStpa(j){
  const box=$('stpa-console');
  $('stpa-summary').textContent=stpaSummaryLine(j);
  if(!j){if(box)box.classList.add('jshide');return;}
  if(box)box.classList.remove('jshide');
  // stpa-sweep's exit contract (monitor/stpa-sweep.mjs header): 0 clean · 1 flagged · 2 the sweep
  // failed · 3 open finding(s), nothing flagged · 4 unclassified closure point(s), nothing flagged.
  // 1, 3 and 4 are completed runs saying something, so only 2 (or a signal) renders as "exited".
  const ico=$('stpa-ico');
  const STPA_EXIT={0:['✓','var(--live)','STPA/HAZOP sweep complete — nothing flagged, no open finding'],
                   21:['✕','var(--crit)','STPA/HAZOP sweep complete — flagged row(s)'],
                   23:['!','var(--high)','STPA/HAZOP sweep complete — open finding(s), nothing flagged'],
                   24:['!','var(--high)','STPA/HAZOP sweep complete — unclassified closure point(s): the sweep could not check them, see the HINT lines']};
  if(j.running){ico.className='spin';ico.textContent='';ico.style.color='';$('stpa-ctitle').textContent='STPA/HAZOP sweep running…';}
  else{const st=STPA_EXIT[j.exitCode]||['✕','var(--crit)','STPA/HAZOP sweep exited ('+(j.signal||j.exitCode)+')'];ico.className='';ico.textContent=st[0];ico.style.color=st[1];$('stpa-ctitle').textContent=st[2];}
  const t0=j.startedAt?new Date(j.startedAt).getTime():0;
  const t1=j.finishedAt?new Date(j.finishedAt).getTime():Date.now();
  $('stpa-celapsed').textContent=t0?fmtDur(t1-t0):'';
  if(!stpaStream&&j.seq!==lastStpaSeq){lastStpaSeq=j.seq;const log=$('stpa-log');const pin=log.scrollTop+log.clientHeight>=log.scrollHeight-24;log.innerHTML=ansiHtml((j.lines||[]).join('\n'));if(pin)log.scrollTop=log.scrollHeight;}
}
async function pollStpa(){
  let j;try{j=(await (await fetch('/api/status?'+jobQ())).json()).stpa;}catch(e){return;}
  renderStpa(j);
  if(j&&j.running){stpaActive=true;}
  else if(stpaActive){stpaActive=false;if(stpaTimer){clearInterval(stpaTimer);stpaTimer=null;}stopStpaStream();if($('stpa-run'))$('stpa-run').disabled=false;}
}
function startStpaStream(){
  if(stpaStream||typeof EventSource==='undefined')return false;
  let es;try{es=new EventSource('/api/status/events?kind=stpa&'+jobQ());}catch(e){return false;}
  stpaStream=es;
  es.addEventListener('line',(e)=>{const d=JSON.parse(e.data);if(d.seq<=lastStpaSeq)return;lastStpaSeq=d.seq;appendStpaLine(d.line);});
  es.addEventListener('gap',(e)=>{const d=JSON.parse(e.data);appendStpaLine('[panel] '+d.dropped+' line(s) scrolled out of the retained window while disconnected');});
  es.addEventListener('status',(e)=>{
    const j=JSON.parse(e.data);if(!j)return;
    renderStpa(j);
    if(j.running){stpaActive=true;}
    else if(stpaActive){stpaActive=false;stopStpaStream();if($('stpa-run'))$('stpa-run').disabled=false;}
  });
  es.onerror=()=>{if(es.readyState===EventSource.CLOSED){stpaStream=null;if(stpaActive)startStpaPolling(true);}};
  return true;
}
function stopStpaStream(){if(stpaStream){try{stpaStream.close();}catch(e){}stpaStream=null;}}
function startStpaPolling(forcePoll){
  stpaActive=true;
  if(stpaStream&&!forcePoll)return;
  if(!forcePoll&&startStpaStream()){pollStpa();return;}
  if(stpaTimer)return;
  pollStpa();stpaTimer=setInterval(pollStpa,1200);
}
// ── the job consoles follow the selection ─────────────────────────────────────────────────────
// Job status is served per selection (jobQ). A console attached under one selection is dropped
// and re-attached under the next: an open stream would otherwise keep showing, or keep hiding,
// a job by the selection it was opened with.
let jobScopeOf=null;
async function attachJobs(){
  const scope=jobScopeOf=jobSel();
  let st;
  try{ st=await (await fetch('/api/status?'+jobQ(scope))).json(); }
  catch(e){ renderHealth(null,'could not read /api/status ('+e.message+')'); return; }
  if(scope!==jobScopeOf)return;   // a later selection re-attached while this one was in flight
  const sw=st.sweep||null; renderSweep(sw);updateSweepBtn(sw);seedLanes(sw);if(sw&&sw.running)startSweepPolling();
  // never silently blank: a null st.stpa (never run, or not this selection's) paints "never run"
  renderStpa(st.stpa||null); if(st.stpa&&st.stpa.running)startStpaPolling();
  renderHealth(st.health,null);
  // a healthcheck already running keeps its own poll alive
  if(st.health&&st.health.running&&!healthTimer)healthTimer=setInterval(pollHealth,1500);
}
function rescopeJobs(){
  if(jobScopeOf===null||jobScopeOf===jobSel())return;
  stopSweepStream(); if(sweepTimer){clearInterval(sweepTimer);sweepTimer=null;} sweepActive=false; lastSeq=-1;
  const painted=Object.keys(laneRun); laneRun={}; painted.forEach(paintLaneTab);
  stopStpaStream(); if(stpaTimer){clearInterval(stpaTimer);stpaTimer=null;} stpaActive=false; lastStpaSeq=-1;
  attachJobs();
}
$('stpa-run')&&($('stpa-run').onclick=async()=>{
  $('stpa-run').disabled=true;
  let r;
  try{ const resp=await cwPost('/api/stpa/run?project='+encodeURIComponent(curProj||'')); r=await resp.json(); }
  catch(err){ $('stpa-run').disabled=false; alert('could not start: '+err.message); return; }
  if(!r||!r.started){ $('stpa-run').disabled=false; alert('not started — '+((r&&r.reason)||'unknown reason')); return; }
  $('stpa-drop').open=true;
  startStpaPolling();
});

// fleet health trigger: deadcode+toolchain+provenance into the latest batch, then in-place
// re-rollup — health columns refresh without a full scan or a new history slice
let healthTimer=null;

// ── the run-health panel ─────────────────────────────────────────────────────────────────────
// FOUR STATES, AND THE WHOLE POINT IS THAT THEY DO NOT COLLAPSE INTO ONE ANOTHER.
//
//  · UNREADABLE — /api/status did not answer, or answered something this cannot parse. Drawn as
//    its own broken state. A panel that cannot see is not a fleet that is idle, and the failure
//    mode being avoided is the quiet one: an early `return` on a fetch error leaves whatever was
//    on screen last, so a dead server renders as the last good result, aging silently.
//  · NO RECORD — the store is durable now (loadPersistedJobs/persistJobs in serve.mjs), so this is
//    no longer scoped to one process's uptime. It is still scoped to the RECORD: nothing here can
//    speak for runs that predate the store, ran on another box, or ran after someone deleted it.
//    That is why the words are "on record" and never "never run" — the shorter sentence carries
//    the whole of the claim the panel has standing to make, and the paragraph that used to spell
//    the reasoning out went away on 2026-09-09 once the box grew a button: the operator's answer
//    to an absent record is now to press it, not to reason about what the absence proves.
//  · RUNNING — phase, done/total, and the elapsed clock.
//  · FINISHED — and STOPPED, SIGNALLED and NON-ZERO are each drawn differently from complete.
//    A halted run must never wear a tick; that is the same rule the sweep console follows.
//
// THE AGE IS NOT DECORATION. A health verdict from nine days ago and one from nine seconds ago
// are the same words, and only one of them describes the fleet as it is now. The age leads, the
// absolute time is in the title, and past a day the stamp is marked stale rather than merely
// being an older number the reader has to do arithmetic on.
const HEALTH_STALE_MS=24*3600*1000;
function renderHealth(h,unreadable){
  const bar=$('healthbar'); if(!bar)return;
  // A healthcheck runs for one project, so its box belongs to project pages only.
  bar.classList.remove('jshide'); bar.style.display=scopeOf(curView)==='project'?'block':'none';
  const ico=$('hb-ico'),title=$('hb-title'),sub=$('hb-sub'),age=$('hb-age'),
        prog=$('hb-prog'),log=$('hb-log');
  const set=(cls,glyph,colour,t,s)=>{
    ico.className=cls; ico.textContent=glyph; ico.style.color=colour;
    title.textContent=t; sub.textContent=s||'';
  };
  age.textContent=''; age.removeAttribute('title'); age.dataset.state='none';
  // The run button's enabled state is DERIVED from the reading, never held only by the click that
  // started a run. Two reasons, and the second is the one that bites: a run begun in another tab or
  // from the CLI has to disable it HERE, and a status read that fails must not strand it disabled
  // with no way back — a control whose only re-enable path is the success it is waiting for is off
  // for good the moment that path breaks. Set before every early return below, including unreadable.
  const run=$('hb-run'); if(run)run.disabled=!!(h&&h.running)||!curProj;
  if(unreadable){
    set('','⚠','var(--crit)','healthcheck state unreadable',unreadable);
    prog.style.width='100%'; prog.style.background='var(--crit)';
    log.classList.add('jshide'); return;
  }
  if(!h){
    set('','○','var(--plan)','no healthcheck on record','');
    prog.style.width='100%'; prog.style.background='var(--plan)';
    log.classList.add('jshide'); return;
  }
  // The job slot is shared, so this box shows the LAST run whichever project it was for. Naming the
  // project is what keeps another project's failure from reading as this one's; `all` is the check
  // set, and alone it read as "all projects".
  const checks=(h.kind||'health').replace(/^health-?/,'')||'all';
  const kind=(labelOfSlug(h.project)||'no project recorded')+' · '+(checks==='all'?'all checks':checks);
  // A run whose owning process died is not finished, not failed and not running. It is the one
  // state the old in-memory store could not represent at all, because the record died with it.
  if(h.interruptedAt&&!h.running){
    set('','⚠','var(--part)','healthcheck INTERRUPTED · '+kind,
        'the panel restarted while this run was in flight — it published nothing after that point, and no result is assumed');
    prog.style.width='100%'; prog.style.background='var(--part)';
    age.textContent=fmtDur(Date.now()-new Date(h.interruptedAt).getTime());
    age.title=h.interruptedAt; age.dataset.state='stale';
    log.classList.add('jshide'); return;
  }
  if(h.running){
    ico.className='spin'; ico.textContent=''; ico.style.color='';
    title.textContent='healthcheck running · '+kind+(h.phase?' · '+h.phase:'');
    sub.textContent=h.total?(h.done+'/'+h.total+(h.current?' · '+h.current:'')):(h.current||'');
    const pct=h.total?Math.round((h.done/h.total)*100):8;
    prog.style.width=Math.max(4,Math.min(pct,98))+'%'; prog.style.background='var(--acc)';
    if(h.startedAt)age.textContent=fmtDur(Date.now()-new Date(h.startedAt).getTime());
  }else{
    // Ordered by severity of the claim each state makes, strongest first: a stopped run and a
    // signalled one both ended without finishing, and neither may be reported as a result.
    if(h.stoppedAt) set('','■','var(--crit)','healthcheck STOPPED'+(h.stoppedBy?' by '+h.stoppedBy:''),
      'halted before it finished — what it had not reached has no reading, and none is assumed');
    else if(h.signal) set('','✕','var(--crit)','healthcheck killed ('+h.signal+')',
      'ended on a signal rather than a verdict');
    else if(h.exitCode===0) set('','✓','var(--live)','healthcheck complete · '+kind,'');
    else set('','✕','var(--crit)','healthcheck exited ('+h.exitCode+') · '+kind,
      'the run reported a failure — the columns it feeds may be from the previous run');
    const ok=!h.stoppedAt&&!h.signal&&h.exitCode===0;
    prog.style.width='100%'; prog.style.background=ok?'var(--live)':'var(--crit)';
    const end=h.stoppedAt||h.finishedAt;
    if(end){
      const t=new Date(end).getTime(), d=Date.now()-t;
      age.textContent=AGO(d); age.title=ABS(new Date(t));
      age.dataset.state=d>HEALTH_STALE_MS?'old':'fresh';
    }
  }
  // The tail is the run's own words; it is shown when there are any and hidden rather than left
  // as an empty box that reads like a run which printed nothing.
  const lines=(h.lines||[]).join('\n');
  if(lines){log.classList.remove('jshide');log.innerHTML=ansiHtml(lines);log.scrollTop=log.scrollHeight;}
  else log.classList.add('jshide');
}

async function pollHealth(){
  let h;
  try{ h=(await (await fetch('/api/status?'+jobQ())).json()).health; }
  catch(e){
    // NOT a silent return: an unreadable status used to leave the last good render on screen,
    // which is the false-clean shape applied to the display layer.
    renderHealth(null,'could not read /api/status ('+e.message+')');
    if(healthTimer){clearInterval(healthTimer);healthTimer=null;}
    $('health').textContent='run healthcheck';
    return;
  }
  renderHealth(h,null);
  if(h&&h.running){$('health').textContent='healthcheck '+(h.total?(h.done+'/'+h.total):'running');}
  else{if(healthTimer){clearInterval(healthTimer);healthTimer=null;}
    $('health').textContent='run healthcheck';if(h&&h.finishedAt){load();if(curView==='fleet')loadFleet();} /* refresh grid on completion */}
}
// ONE start path, pressed from two places — the ≡ menu item and the button in the health box. Two
// copies of this could disagree about which project they run and about what a refusal means, and
// the box's copy is the one an operator would press without opening the menu first.
//
// IT READS THE REPLY, which the menu-only version did not. trigger() in serve.mjs answers
// {started:false, reason} when a job already holds the slot (a run started from the CLI or another
// tab) or the kind is unknown, and cwPost RESOLVES on 403 and 500 — it rejects only on a transport
// failure. So "no exception was thrown" was never "it started". The old handler began polling
// regardless: the press showed 'starting…', the box went on rendering the PREVIOUS run at its old
// age, and nothing anywhere said the press had done nothing. That is this repo's silent-no-op
// shape wearing a button. The stpa panel's run button already did it this way; health was the odd
// one out of the three actuators.
async function startHealth(){
  const menu=$('health'),box=$('hb-run');
  if(!curProj){alert('healthcheck not started — choose a project first; a healthcheck runs for one project');return;}
  if(menu)menu.textContent='starting…';
  if(box)box.disabled=true;
  const refuse=(why)=>{
    if(menu)menu.textContent='run healthcheck';
    if(box)box.disabled=false;
    alert('healthcheck not started — '+why);
  };
  let r;
  try{
    const resp=await cwPost('/api/health/all?project='+encodeURIComponent(curProj||''));
    if(!resp.ok){ refuse('the server answered '+resp.status); return; }
    r=await resp.json();
  }catch(e){ refuse(e.message); return; }
  if(!r||!r.started){ refuse((r&&r.reason)||'unknown reason'); return; }
  if(!healthTimer)healthTimer=setInterval(pollHealth,1500);
  pollHealth();
}
$('health')&&($('health').onclick=startHealth);
$('hb-run')&&($('hb-run').onclick=startHealth);
// panel-boot.js attaches to a sweep already in progress, once every part has loaded.
// view switcher — Overview is this panel's native content; the other tabs iframe the rich
// pages served from /reports/<view>.html on this same port (one page, one server).
// modmap is a LIVE server route (/map/<project>) and timeline is a per-project static page
// (timeline-<slug>.html, built by monitor/timeline.mjs) — both follow the project picker;
// the rest are single embedded report pages.
// slug comes from the server's declared area (one slugging rule shared with the report
// generators); the old client-side 'ClientA'->'client-a' special case could not know about
// any other area's declared slug.
let SLUGS={};
const projSlug=(p)=>SLUGS[p]||String(p||'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');
const viewSrc=(v)=>v==='modmap'?('/map/'+projSlug(curProj)+'?embed=1')
  :v==='timeline'?('/reports/timeline-'+projSlug(curProj)+'.html?embed=1&project='+encodeURIComponent(curProj||''))
  :v==='sitemap'?('/sitemap/demo.html?embed=1&project='+projSlug(curProj))
  // carry the selected project so the iframe renders THIS project's report page, not the
  // default area's (the tab used to show one project's numbers under another's name)
  :({dashboard:'/reports/dashboard.html?embed=1&project='+encodeURIComponent(curProj||''),
     runtime:'/reports/runtime.html?embed=1&project='+encodeURIComponent(curProj||'')}[v]);

