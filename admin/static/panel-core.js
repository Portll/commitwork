// admin/static/panel-core.js — part 1 of 8 of the panel client.
//
// helpers, header freshness stamp, scanner detail tabs, derived rows, lane coverage, and the SARIF findings grouped by diagnosis.
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

const $=(id)=>document.getElementById(id);
// Escape EVERY server-derived string interpolated into innerHTML. Repo/finding names reach the
// panel from directory names and scanner output — neither is trusted input. Defined here at the
// top (not mid-file) so it is initialised before any render path can reach for it.
const esc=(x)=>String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const pill=(s,txt)=>`<span class="pill ${s}">${txt||s}</span>`;
// CSRF — the server refuses every state-changing request without this header. Fetch once, cache,
// and on a 403 refresh once and retry (the token is per-process, so a server restart rotates it).
let csrfToken=null;
async function csrf(){ if(csrfToken)return csrfToken; try{ csrfToken=(await (await fetch('/api/csrf')).json()).token; }catch(_){ csrfToken=null; } return csrfToken; }
// A 401 means the session is gone or invalid. The page reloads to the SAME path: the server has
// the cookie and answers with the login screen, which names which of the two it was, and after
// sign-in the return path brings this view back. Routes where 401 is a legitimate answer for an
// anonymous reader are exempt, or an anonymous panel would reload forever.
// A 401 MEANS TWO DIFFERENT THINGS AND THIS LIST IS WHERE THEY ARE TOLD APART.
//
// The interceptor below reloads the page on any same-origin 401, on the reading "your session has
// gone, so start again". That is right for a route whose 401 is about the SESSION. It is exactly
// wrong for a route whose 401 is about the CREDENTIAL YOU JUST TYPED.
//
// /auth/passkey/* is the second kind. register/begin answers 401 `invalid credentials` when the
// password is wrong — a statement about that one attempt, not about the session, which is still
// perfectly valid. Reloading there destroyed the error before it could be read, closed the form,
// and returned the operator to the start. Reported as "it redirects too fast to see the error" and
// "a judder, and it loops back", and no amount of making the message persistent could survive it:
// location.reload() outranks every sticky box there is.
//
// Same for revoke, which is password-gated for the same reason and answers 401 the same way.
const AUTH_401_EXEMPT=[/^\/api\/me\b/,/^\/auth\/session\b/,/^\/api\/csrf\b/,/^\/auth\/passkey\//];
let authGone=false;
(function(){
  const raw=window.fetch.bind(window);
  window.fetch=async(input,init)=>{
    const r=await raw(input,init);
    if(r.status===401&&!authGone){
      try{
        const u=new URL(typeof input==='string'?input:input.url,location.origin);
        if(u.origin===location.origin&&!AUTH_401_EXEMPT.some(re=>re.test(u.pathname))){
          authGone=true; location.reload();
        }
      }catch(_){}
    }
    return r;
  };
})();

async function cwPost(url,opts={}){
  const go=async()=>fetch(url,{...opts,method:opts.method||'POST',headers:{...(opts.headers||{}),'x-cw-csrf':await csrf()}});
  let r=await go();
  if(r.status===403){ csrfToken=null; r=await go(); }
  return r;
}
// no hardcoded default project — the stored pick, else whatever the server reports first
// THE URL WINS OVER THE STORED PREFERENCE. A link that names a project must show that project,
// or the link is not a link to anything. localStorage is only the fallback for a bare URL.
let curProj=(()=>{
  // The URL carries a SLUG and curProj is a LABEL, so boot cannot resolve it yet — the map arrives
  // with the payload. Hold the slug and let load() resolve it; until then fall back to the stored
  // label so a bare URL still opens where the operator left off.
  try{ return localStorage.getItem('cw-proj')||''; }catch(_){ return ''; }
})();
// Job status and the live consoles are served for a selection (operator ruling 2026-09-29). A
// fleet page (VIEW_SCOPE) or no project is the fleet view, which sees only fleet runs; a project
// page sees only the selected project's runs.
const jobSel=()=>((typeof scopeOf==='function'&&typeof curView==='string'&&scopeOf(curView)!=='project')?'':(curProj||''));
const jobQ=(p)=>'project='+encodeURIComponent(p===undefined?jobSel():p);

// ── header freshness stamp ───────────────────────────────────────────────────────────────────
// A bare wall-clock stamp answered the wrong question: "20:02:26" cannot tell you whether the
// rollup is minutes or weeks old, so six-days-stale looked exactly like six-seconds-fresh. The
// elapsed form leads, and the exact time moves into title= for when you need it. The absolute
// form is spelled with a MONTH NAME on purpose — "01/08/2026" reads as 1 Aug or 8 Jan depending
// on the reader's locale, which is not a thing an evidence panel may be ambiguous about.
// data-state is set but deliberately not coloured yet — see the colour pass.
const AGO=(ms)=>{const s=Math.max(0,Math.round(ms/1000));
  if(s<60)return s+'s ago';
  const m=Math.floor(s/60); if(m<60)return m+'m ago';
  const h=Math.floor(m/60); if(h<24)return h+'h ago';
  return Math.floor(h/24)+'d ago';};
const ABS=(d)=>d.toLocaleString(undefined,{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
// The header's freshness follows the page's scope: the selected project's rollup age sat above
// fleet totals it did not date. Fleet pages show the newest scan across every area instead.
let genProject=null, genFleetNewest=null;
function noteProjectGen(generated){ genProject=generated; renderGen(); }
// THE TOP BAR COUNTS DOWN TO THE NEXT ROLLUP: this project's, then the fleet's soonest, from
// /api/rollups (the launchd jobs actually installed). The dot still grades the LAST rollup's age, and
// the last rollup's time moves to the tooltip.
let rollupSched=null;
async function loadRollupSchedule(){
  try{const r=await fetch('/api/rollups');if(r.ok){const d=await r.json();if(d.ok)rollupSched=d;}}catch(_){/* no schedule reads as "—", never as a time */}
  renderGen();
}
function schedFor(proj){
  if(!rollupSched||!proj)return null;
  const slug=typeof projSlug==='function'?projSlug(proj):String(proj).toLowerCase();
  return rollupSched.areas.find(a=>a.slug===slug||a.label===proj)||null;
}
function COUNTDOWN(iso){
  const t=Date.parse(iso||'');if(!Number.isFinite(t))return '—';
  let s=Math.max(0,Math.round((t-Date.now())/1000));const d=Math.floor(s/86400);s%=86400;
  const p2=(n)=>String(n).padStart(2,'0');
  return (d?d+'d ':'')+p2(Math.floor(s/3600))+':'+p2(Math.floor(s%3600/60))+':'+p2(s%60);
}
const fleetNextRollup=()=>(rollupSched&&rollupSched.fleet&&rollupSched.fleet.next)||null;
function renderGen(){
  const el=$('gen'); if(!el)return;
  const scope=scopeOf(curView),fleetNext=fleetNextRollup();
  el.hidden=scope==='account'||(scope==='project'&&!curProj)||(scope==='fleet'&&!genFleetNewest&&!fleetNext);
  if(scope==='project')return setGen(genProject);
  if(scope==='fleet'){
    el.textContent=fleetNext?'next rollup '+COUNTDOWN(fleetNext.at)+' · '+fleetNext.area:'no rollup scheduled';
    el.dataset.state=genFleetNewest?(genFleetNewest.ageMs<36e5?'fresh':genFleetNewest.ageMs<864e5?'stale':'old'):'none';
    el.title=(genFleetNewest?'newest scan '+AGO(genFleetNewest.ageMs)+' · '+genFleetNewest.area:'no area scanned yet')
      +(fleetNext?' · next rollup in the fleet '+ABS(new Date(fleetNext.at))+' ('+fleetNext.area+')':'');
  }
}
function setGen(generated){
  const el=$('gen'); if(!el)return;
  const a=schedFor(curProj),fleetNext=fleetNextRollup();
  const mine=a&&a.schedule?(a.schedule.next?COUNTDOWN(a.schedule.next):(a.schedule.state==='paused'?'paused':'not scheduled')):'—';
  el.textContent='next rollup '+mine+' : fleet '+(fleetNext?COUNTDOWN(fleetNext.at):'—');
  // never scanned is its own state — it is not "0 minutes ago" and it is not clean
  const age=generated?Date.now()-new Date(generated).getTime():null;
  el.dataset.state=age==null?'none':age<36e5?'fresh':age<864e5?'stale':'old';
  el.title=(generated?'last rollup '+AGO(age)+' ('+ABS(new Date(generated))+')':'no rollup yet')
    +(a&&a.schedule&&a.schedule.next?' · next rollup for this project '+ABS(new Date(a.schedule.next)):'')
    +(fleetNext?' · next rollup in the fleet '+ABS(new Date(fleetNext.at))+' ('+fleetNext.area+')':'');
}
// panel-boot.js starts the countdown's timers and its first read, once every part has loaded.

// Relative age, rendered client-side. The rollup deliberately stores ISO and never a rendered age:
// rerollup-identical.test.mjs normalises ISO timestamps and nothing else, so a baked "3h old" would
// make two byte-identical re-rolls differ. Module-scoped because the Overview's coverage table and
// the three detail tabs must word staleness identically.
//
// "old", NOT "ago". `ago` is a narrative suffix — it needs a verb in front of it, and every caller
// supplied one ("ran 13h ago"), which asserted that a run HAPPENED. The timestamp behind it is
// stamped from the checks-status row whatever its status, so a category that only ever SKIPPED
// carried a run claim it had no evidence for, directly contradicting its own VOID pill. "13h old"
// dates the evidence without claiming what produced it, which is the only thing the number knows.
const age=(iso)=>{if(!iso)return '?';const ms=Date.now()-Date.parse(iso);if(!Number.isFinite(ms))return '?';
  const m=Math.round(ms/60000);if(m<60)return m+'m old';const h=Math.round(m/60);if(h<48)return h+'h old';return Math.round(h/24)+'d old';};

// ── scanner detail tabs: Secrets · Malware · Supply chain · SAST · IaC · DAST ────────────────
// All render from `scannerFindings` + `scanners` on the state payload, so they cannot
// disagree with the coverage row on the Overview — same numbers, same object, one fetch.
//
// THE BANNER COMES BEFORE THE ROWS, ALWAYS. An empty findings table is the exact shape this whole
// area exists to refuse: "0 rows" reads as clean, and for a category that never ran it is a lie.
// Four states, in the vocabulary the coverage table already uses:
//   VOID (ran===0)   — nothing scanned anywhere. Render the void INSTEAD of a table.
//   carried          — not re-run by this sweep; the rows belong to an earlier slice and say so.
//   partial (noscan) — some repos produced nothing trustworthy, so the rows are a floor.
//   truncated        — the rollup capped the detail; the true total is stated, never implied.
let lastState=null;
// one renderer for the four SARIF-backed categories — same columns, same rollup whitelist

// ── DERIVED DETAIL ROWS ─────────────────────────────────────────────────────────────────────────
// Fifteen lanes used to each carry a template literal. monitor/detail-schema.mjs already declares
// every category's fields, types and labels, and admin/serve.mjs ships them as `detailSchema` on
// the state payload — which this page read ZERO times while hand-writing the same information a
// third time. That is the exact drift detail-schema.mjs was built to end (its header cites a commit
// whose whole content is "DETAIL_KEYS catches up with the extractors it declares for").
//
// FORMATTING IS PRESERVED, NOT NORMALISED. The lanes genuinely differ: SARIF-shaped lanes fuse
// file+line into one Location cell, Leaks shows them as separate columns, Malware keeps package and
// version apart while the two supply-chain lanes fuse them. Picking one convention globally would
// have quietly restyled half the panel, so a deviation is DECLARED in LANE_FORMAT below and
// everything else falls out of the field's type. Most lanes declare nothing.
//
// The result is one renderer plus a handful of declarations, instead of fifteen functions — a data
// change to add a lane, not code in three files.
const DETAIL_CELL={
  // THREE renderings, because there are three states. null is not an em dash shared with "empty":
  // it says which question went unanswered. "plan" is this panel's established unknown-not-a-pass tone.
  tri:(v)=> v===true  ? '<td><span class="pill crit">verified live</span></td>'
          : v===false ? '<td><span class="pill live">refuted by the service</span></td>'
          :             '<td><span class="pill plan">no verdict — no verifier could be asked</span></td>',
  name: (v)=>`<td><b class="name">${esc(v)}</b></td>`,
  ident:(v)=>`<td><code>${esc(v)||'<span class="mut">—</span>'}</code></td>`,
  sev:  (v)=>`<td>${v?sevPill(v):'<span class="mut">—</span>'}</td>`,
  loc:  (v)=>`<td><code class="t-loc">${esc(v||'?')}</code></td>`,
  num:  (v)=>`<td class="tnum">${esc(v===0||v?v:'')}</td>`,
  mut:  (v)=>`<td class="mut">${esc(v)||'—'}</td>`,
  msg:  (v)=>`<td class="mut cell-msg">${esc(v)}</td>`,
};
// Which cell a field gets when the lane declares nothing. Keyed by field NAME first (a `rule` is an
// identifier whatever its type), then by declared TYPE.
const CELL_BY_NAME={repo:'name',rule:'ident',id:'ident',marker:'ident',package:'ident',sev:'sev',
  file:'loc',path:'loc',line:'num',message:'msg'};
const CELL_BY_TYPE={sev:'sev',int:'num',path:'loc',text:'msg',str:'mut',bool:'mut'};
const cellKind=(name,type)=>CELL_BY_NAME[name]||CELL_BY_TYPE[type]||'mut';

// Per-lane deviations from the defaults. `fuse` renders two adjacent fields in ONE cell under one
// label; `cell` overrides a field's kind; `drop` hides a field that is provenance rather than
// evidence (gitleaks `redacted` is a constant true, and a column of trues tells the reader nothing).
// `order` is a display sequence, declared because SCHEMA ORDER IS NOT DISPLAY ORDER and never was:
// every SARIF-shaped lane declares rule/file/line/sev/message and has always RENDERED severity
// before location. Deriving naively would have silently moved a column in nine tables at once.
const SARIF_FMT={fuse:[['file','line']],order:['rule','sev','file','message']};
const LANE_FORMAT={
  secrets:            {cell:{file:'mut',commit:'commit'},drop:['redacted'],extra:'ann'},
  // extra:'ann' gives this lane the Triage cell it never had. It is the lane where a false-positive
  // path is worth most: one detector produced 1,311 of the fleet's 1,314 published criticals, all false.
  secretsHistory:     {cell:{commit:'commit',verified:'tri'},extra:'ann'},
  // `id` is not its own column — it is the LABEL of the advisory link, so showing it twice would
  // read as two facts about one record.
  maliciousPackages:  {cell:{version:'num',advisory:'advisory'},drop:['id'],order:['package','version','ecosystem','advisory']},
  supplyChain:        {fuse:[['package','version']],order:['rule','package','ecosystem','sev','message','claimKind','sevReason'],cell:{message:'mut'}},
  supplyChainHeuristic:{fuse:[['package','version']],cell:{message:'mut'}},
  sastSemgrep:SARIF_FMT, sastCodeql:SARIF_FMT, sastCodeqlJava:SARIF_FMT, iac:SARIF_FMT,
  // Added with the lanes on 2026-08-22 and NOT an hour later, which is the whole lesson: these two
  // declare the same rule/file/line/sev/message shape as every other SARIF lane, so omitting them
  // here would have rendered severity after location in two tables and nowhere else — a silent
  // restyle of exactly the kind SARIF_FMT was extracted to prevent.
  sastCodeqlPython:SARIF_FMT, sastCodeqlRuby:SARIF_FMT,
  actionsPosture:SARIF_FMT, sastGo:SARIF_FMT, depsGradleDeclared:SARIF_FMT, shellLint:SARIF_FMT, actionsLint:SARIF_FMT,
  dockerfile:SARIF_FMT,
  dast:               {cell:{name:'mut'},drop:['port','proto'],order:['rule','sev','path','name']},
  // Two lane-specific cells: `capped` is a suffix on the file, and metric+message read as one
  // sentence. Declared rather than normalised — collapsing them would change what the tab says.
  minifiedCode:       {drop:['capped','message'],cell:{file:'fileCapped',metric:'metricMsg'},order:['rule','sev','file','metric']},
};
// Cells that need more than a value — a link target, a truncation, a sibling field.
const DETAIL_CELL_X={
  commit:(f)=>`<td class="mut"><code>${esc(String(f.commit||'').slice(0,10))}</code></td>`,
  advisory:(f)=>`<td><a href="${esc(f.advisory)}" target="_blank" rel="noopener" class="txt-acc">${esc(f.id)}</a></td>`,
  fileCapped:(f)=>`<td><code class="t-loc">${esc(f.file)}</code>${f.capped?' <span class="mut">(capped)</span>':''}</td>`,
  metricMsg:(f)=>`<td class="mut">${esc(f.metric)}${f.message?' — '+esc(f.message):''}</td>`,
};

/** Column plan for a lane: [{label, render(f)}]. `repo` leads every lane — the rollup prepends it
 *  when flattening and no schema declares it, so it is presentation metadata, NOT a schema field
 *  (declaring it would risk the rollup and rowsFor() both emitting it). */
// SUPPRESSING actions, same list monitor/annotate-lib.mjs applies to the aggregates — a row the
// pipeline already subtracted must not still read as work here.
const CLOSED_ACTIONS=new Set(['accept','false-positive','wont-fix','incorrect-scan-result']);
const isClosedFinding=(f)=>!!(f&&f.annotation&&CLOSED_ACTIONS.has(f.annotation.action));

// The closed table lives immediately after the open one and carries the SAME headers, so a reader
// comparing the two is comparing like with like. Removed entirely when nothing is closed.
//
// COLLAPSED BY DEFAULT — and collapsing is not hiding. On a lane anyone has actually worked, the
// adjudicated rows are the majority: secrets on commitwork-admin renders 20 closed against 1 still
// open, so drawn flat the exclusions bury the single row the page exists to show. The COUNT and the
// "not counted above" wording stay on screen in the summary, where they are the disclosure; only
// the rows fold. A reader who wants them is one click away, which is the difference between a
// collapsed list and a suppressed one.
//
// `closedOpen` remembers the choice PER LANE because load() re-renders every 8s. Without it the
// poll would fold a table the operator had just opened, roughly once every time they finished
// reading a row — a default re-asserting itself over a decision already made.
const closedOpen=new Set();
const CLOSED_LABEL='Closed — false positives and accepted';
function renderClosedTable(body,cols,t,closed){
  const host=body&&body.closest&&body.closest('.tw'); if(!host)return;
  const id=`${t.rows}-closed`;
  // BOTH nodes, not just the heading. This removed the `hd` and left `${id}-t` behind, so every
  // poll inserted a second table while getElementById kept returning the newest — a duplicate-id
  // document growing one orphan closed table every 8 seconds, each one a stale copy nobody updates.
  for(const dead of [document.getElementById(id),document.getElementById(`${id}-t`)])if(dead)dead.remove();
  if(!closed.length)return;
  const cell=(t.group&&t.row)?t.row:(cols?(f)=>cols.map(c=>c.render(f)).join(''):t.row);
  const head=cols?cols.map(c=>`<th>${esc(c.label)}</th>`).join(''):`<th colspan="${t.cols}"></th>`;
  const isOpen=closedOpen.has(t.key);
  host.insertAdjacentHTML('afterend',
    // nosemgrep: typescript.react.security.audit.react-unsanitized-method.react-unsanitized-method -- esc() on every dynamic text; id derives from the lane key; row renderers escape their own cells
    `<div class="hd hd-sub" id="${id}"><h2><button type="button" class="closed-toggle" id="${id}-b"`
    +` aria-controls="${id}-t" aria-expanded="${isOpen?'true':'false'}">`
    +`<span class="caret">${isOpen?'▾':'▸'}</span> ${CLOSED_LABEL}</button></h2>`
    +`<span class="n">${closed.length} adjudicated · not counted above, not counted in the area totals</span></div>`
    +`<div class="tw" id="${id}-t"${isOpen?'':' hidden'}><table><thead><tr>${head}</tr></thead><tbody>`
    +closed.map(f=>`<tr class="ann-row">${cell(f)}</tr>`).join('')
    +'</tbody></table></div>');
  const t2=document.getElementById(`${id}-t`), hd=document.getElementById(id);
  if(t2&&hd)hd.after(t2);
  const btn=document.getElementById(`${id}-b`);
  if(btn&&t2)btn.addEventListener('click',()=>{
    const now=!closedOpen.has(t.key);
    if(now)closedOpen.add(t.key);else closedOpen.delete(t.key);
    t2.hidden=!now;
    btn.setAttribute('aria-expanded',now?'true':'false');
    btn.innerHTML=`<span class="caret">${now?'▾':'▸'}</span> ${CLOSED_LABEL}`;
  });
}

function laneColumns(key,schema){
  const fmt=LANE_FORMAT[key]||{};
  const fused=new Map(); for(const [a,b] of (fmt.fuse||[]))fused.set(a,b);
  const skip=new Set([...(fmt.drop||[]),...(fmt.fuse||[]).map(([,b])=>b)]);
  const cols=[{label:'Service',render:(f)=>DETAIL_CELL.name(f.repo)}];
  // Declared display order first, then anything the lane did not mention — so a schema gaining a
  // field appends it visibly rather than dropping it.
  const seq=fmt.order
    ? [...fmt.order,...(schema.columns||[]).map(c=>c.name).filter(n=>!fmt.order.includes(n))]
    : (schema.columns||[]).map(c=>c.name);
  const byName=new Map((schema.columns||[]).map(c=>[c.name,c]));
  for(const cname of seq){
    const c=byName.get(cname); if(!c)continue;
    if(skip.has(c.name))continue;
    const partner=fused.get(c.name);
    if(partner){
      // one cell, one label — file:line and package@version read as a single fact, not two
      const label=c.name==='package'?c.label:'Location';
      cols.push({label,render:(f)=>c.name==='package'
        ?`<td>${esc(f.package)||'<span class="mut">—</span>'}${f[partner]?`<span class="mut"> @${esc(f[partner])}</span>`:''}</td>`
        :`<td><code class="t-loc">${esc(f[c.name]||'?')}${f[partner]?':'+esc(f[partner]):''}</code></td>`});
      continue;
    }
    const kind=(fmt.cell&&fmt.cell[c.name])||cellKind(c.name,c.type);
    const x=DETAIL_CELL_X[kind];
    cols.push({label:c.label,render:x?x:(f)=>DETAIL_CELL[kind](f[c.name])});
  }
  if(fmt.extra==='ann')cols.push({label:'Annotation',render:(f)=>annCell(f,key)});
  return cols;
}

// ── ran===0 IS THREE FACTS, NOT ONE ──────────────────────────────────────────────────────────────
// One classifier, module-scoped, because the coverage table and the detail tabs must reach the same
// verdict about the same category — two copies of this logic is two chances to disagree in public.
//
// Every zero-run category used to render "VOID — never ran". On client-d that put "no JVM build here"
// and "BOLA was never given a URL" in the same grey pill, so the five rows an operator could fix
// looked exactly like the two nothing could. They are different facts:
//
//   na      Every in-scope repo declared the target absent — "n/a — none of go.mod present". A
//           correct exclusion. It is not a coverage gap and must not be counted as one.
//   unrun   The check APPLIES here and was denied its input — no live URL, no token. A real gap,
//           and the only one of the three with an obvious next action.
//   void    It reached the target and got nothing trustworthy back (noscan). The original meaning
//           of the word, now the only state wearing it.
//
// naSkips/blockedSkips come from rollup.mjs, which classifies on the skip REASON — the counts alone
// cannot separate na from unrun, which is why this could never have been fixed in the panel alone.
// A rollup written before that shipped carries neither field and falls through to `unrun`: it
// OVERSTATES the gap rather than understating it, and that direction is the point. Silence about
// coverage is the failure this whole section exists to prevent; a spurious amber pill is a question,
// a spurious "not applicable" is a lie.
const covState=(s)=>{
  if(!s||typeof s!=='object'||!('ran' in s))return null;   // no run provenance — assert nothing
  if(s.ran>0)return s.noscan>0?'partial':(s.total>0?'findings':'clean');
  // NOTHING RAN, YET THERE ARE FINDINGS. Classified HERE rather than in one renderer because three
  // surfaces read this function — the Overview coverage table, the detail tabs, and the lane
  // summary — and a state recognised by only one of them makes the panel contradict itself about
  // the same category. Measured 2026-08-21: client-d/denoLint ran=0 with 821 findings,
  // 100randomrepos/denoLint 2,430, an internal project's shellLint 1. Ranked above void/na/unrun because
  // it invalidates all three: a lane holding evidence has not "correctly excluded" anything.
  if(Number(s.total)>0)return 'contradiction';
  if(s.noscan>0)return 'void';
  if(s.naSkips>0&&!s.blockedSkips)return 'na';
  return 'unrun';
};
// The wording, once. `label` is the pill; `why` is the sentence that qualifies it and always states
// the arithmetic, so a reader can check the claim rather than trust it.
const COV_COPY=(s,st)=>{
  const inScope=(s.ran||0)+(s.skipped||0)+(s.noscan||0);
  const reason=s.skipReason?` Reported reason: “${esc(s.skipReason)}”.`:'';
  if(st==='contradiction')return {cls:'crit',label:'CONTRADICTION — provenance vs evidence',
    why:`the run record says nothing was scanned (ran 0 of ${inScope} in-scope repo(s), ${s.skipped||0} skipped, ${s.noscan||0} noscan) and this category is carrying ${s.total} finding(s) anyway.${reason} One of those is wrong and the panel cannot tell which, so it states both: the findings are shown, and they are NOT confirmed to come from a scan that happened. Treat this lane's coverage claim as unreliable and re-sweep it.`};
  if(st==='na')return {cls:'na',label:'N/A — no target here',
    why:`all ${inScope} in-scope repo(s) declared this check inapplicable — the language, manifest or artefact it reads is not present.${reason} A correct exclusion, not a coverage gap.`};
  if(st==='unrun')return {cls:'part',label:'UNRUN — input missing',
    why:`the check applies to ${inScope} in-scope repo(s) and ran on none: it was not given what it needs.${reason} This is a coverage gap with a next action, not a clean result.`};
  return {cls:'high',label:'VOID — no trustworthy output',
    why:`0 of ${inScope} in-scope repo(s) produced a usable scan (${s.skipped||0} skipped, ${s.noscan||0} noscan). The tool reached the target and returned nothing that can be relied on — a coverage void, not a clean result.`};
};
// ── LANE COVERAGE — A SECOND AXIS, AND NOT THE ONE ABOVE ────────────────────────────────────────
//
// TWO THINGS ON THIS PAGE ARE CALLED COVERAGE. They are different questions and the mapping is
// stated here rather than left for a reader to infer from two similar words:
//
//   covState() above — DID THE CATEGORY RUN AT ALL, across the fleet?
//       na    the check does not apply here          (a correct exclusion)
//       unrun it applies and ran nowhere             (never started)
//       void  it ran and produced nothing usable     (started, no trustworthy output)
//
//   laneCov() here — OF THE CHECKS THAT DID RUN, COULD THEY SEE EVERYTHING?
//       full     ran, and its log was read and showed no lost capability
//       reduced  ran, and a declared lane of it did not (e.g. Go call analysis, no Go toolchain)
//       unknown  ran, and we could not establish either way (declared log absent or unreadable)
//
// The axes are orthogonal: a category can be fully RUN and partly BLIND. `unrun` and `unknown` are
// the pair most easily confused — unrun means nothing started, unknown means something started and
// we cannot say what it saw. A row can never be `na` and `reduced` at once; that combination would
// mean an inapplicable check reported a lost lane, and it is a bug in the producer if it appears.
const LANE_COV={
  full:   {cls:'ok',  label:'full',    why:'every declared lane of this check reported in — its log was read and named no lost capability.'},
  reduced:{cls:'part',label:'reduced', why:'the check ran and a declared lane of it did not. The findings it reports are real; they are simply not the whole picture.'},
  unknown:{cls:'na',  label:'unknown', why:'the check ran and coverage could not be established — its declared log was absent or unreadable. Not a clean result and not a known gap: an unmeasured one.'},
};
// esc() on EVERY interpolated field. `coverageReason` originates in a manifest, and a repo-local
// commitwork.json is untrusted input — the trust gate refuses to EXECUTE its commands, but this
// field crosses that boundary as data. It is bounded at ingest (validateManifest rejects a lane
// outside a label charset) and escaped here; neither alone is the defence.
const laneCovPill=(s)=>{
  if(!s||!s.coverage)return '';                       // no key = written before the field existed
  const m=LANE_COV[s.coverage]; if(!m)return '';
  const n=s.coverageChecks||{};
  const counts=`${n.full||0} full · ${n.reduced||0} reduced · ${n.unknown||0} unknown`;
  const why=s.coverageReason?`${m.why} — ${esc(s.coverageReason)}`:m.why;
  return `<span class="pill ${m.cls}" title="${esc(counts)}. ${esc(why)}">lane ${esc(m.label)}</span>`;
};
// ── SARIF findings, GROUPED BY DIAGNOSIS ────────────────────────────────────────────────────────
// One row per finding buried the signal: a single Semgrep rule firing 300 times produced 300 rows
// that differed only in file:line, so scrolling the tab told you nothing the count already had.
// Grouping by (rule, severity, message) turns that into one row saying "300 sites" with the sites
// behind a disclosure — the diagnosis becomes the unit, which is what a reader is actually deciding
// about.
//
// The message is rendered IN FULL and wraps. It used to sit in a fixed-width cell against a 240-char
// server-side cap, so a real diagnosis arrived cut mid-sentence with nothing saying so; the cap is
// now 4000 with an explicit marker (monitor/extractors.mjs capMessage), and this cell no longer
// constrains it.
//
// Groups sort by severity, then by how many sites they hit — the widest-blast-radius diagnosis
// first, which is the order someone triaging actually wants. Sites within a group stay in file
// order so a re-render of the same rollup is byte-identical.
const SEV_ORDER={crit:0,critical:0,high:1,med:2,medium:2,low:3,info:4};
function groupSarif(rows){
  const g=new Map();
  for(const f of rows){
    // JSON.stringify, not a hand-picked delimiter. A separator has to be a byte that cannot
    // occur in any field, and the first attempt used a literal NUL — which corrupted this
    // SERVED page: `file` reported it as data and grep stopped matching the file at all.
    // An array key cannot collide no matter what a SARIF message contains.
    const k=JSON.stringify([f.rule||'',f.sev||'',f.message||'']);
    let e=g.get(k);
    if(!e){e={rule:f.rule,sev:f.sev,message:f.message,sites:[]};g.set(k,e);}
    e.sites.push(f);
  }
  const out=[...g.values()];
  for(const e of out) e.sites.sort((a,b)=>String(a.repo||'').localeCompare(String(b.repo||''))||String(a.file||'').localeCompare(String(b.file||''))||((a.line||0)-(b.line||0)));
  out.sort((a,b)=>(SEV_ORDER[a.sev]??9)-(SEV_ORDER[b.sev]??9)||b.sites.length-a.sites.length||String(a.rule||'').localeCompare(String(b.rule||'')));
  return out;
}
const SARIF_GROUP_ROW=(g)=>{
  const n=g.sites.length;
  const repos=[...new Set(g.sites.map((s)=>s.repo).filter(Boolean))];
  // The repo cell names the repo when there is one, and counts them when the diagnosis spans
  // several — a rule firing across four services is a different fact from one firing four times in
  // one, and collapsing both to a number would lose it.
  const who=repos.length===1?`<b class="name">${esc(repos[0])}</b>`
    :`<b class="name">${repos.length} repos</b>`;
  const sites=g.sites.map((s)=>`<div class="site-line"><code class="t-loc">${esc(s.repo||'')}${s.repo?' · ':''}${esc(s.file||'?')}${s.line?':'+s.line:''}</code></div>`).join('');
  const loc=n===1
    ? `<code class="t-loc">${esc(g.sites[0].file||'?')}${g.sites[0].line?':'+g.sites[0].line:''}</code>`
    : `<details><summary class="point t-loc txt-acc">${n} sites</summary><div class="sites">${sites}</div></details>`;
  const count=n>1?`<span class="pill part trailing">×${n}</span>`:'';
  return `<td>${who}${count}</td><td><code>${esc(g.rule)}</code></td><td>${sevPill(g.sev)}</td><td>${loc}</td><td class="mut cell-wrap">${esc(g.message)}</td>`;
};
// The triage cell for an annotatable scanner row. An annotated row shows its judgment (action +
// who, reason in the title) — HUMAN-JUDGED amber, deliberately not scanner-clean green. An
// unannotated row gets the authoring button; the handler (delegation below) prompts for the
// REQUIRED reason and POSTs /api/annotations/scanner, which validates with the same rules the
// rollup applies and refuses a record matching zero rows.
// Only the secrets lane: /api/leaks/check reads the matched line server-side, and only gitleaks
// rows carry a file+line that means a credential match.
// REASON IS NOT THE CLASS. "false positive" is the verdict; the reason is why. Models restate the
// verdict in their first sentence, so that sentence is dropped when a further one exists, and the
// model's own `signals` win when it supplied them — they are already the compressed form.
function reasonTitle(j){
  const sig=(j.signals||[]).filter(Boolean);
  if(sig.length)return sig.join(' · ');
  const sentences=String(j.reasoning||'').split(/(?<=\.)\s+/).map(x=>x.trim()).filter(Boolean);
  if(!sentences.length)return '';
  const cls=/^the (match|finding) is (a )?(false positive|real|a real credential)/i;
  const rest=sentences.filter(x=>!cls.test(x));
  return (rest.length?rest[0]:sentences[0]).replace(/\s+/g,' ').slice(0,180);
}

// One full-width row under the finding, carrying the whole answer. Replaced on re-check, removed
// when the row it belongs to is redrawn.
function renderVerdictRow(btn,j,tone,eng){
  const tr=btn.closest&&btn.closest('tr'); if(!tr)return;
  const span=tr.children.length||1;
  const next=tr.nextElementSibling;
  if(next&&next.classList.contains('llm-row'))next.remove();
  const title=reasonTitle(j);
  tr.insertAdjacentHTML('afterend',
    // nosemgrep: typescript.react.security.audit.react-unsanitized-method.react-unsanitized-method -- every interpolated value goes through esc(); tone is a literal pill class
    `<tr class="llm-row"><td colspan="${span}"><div class="llm-box">`
    +`<div class="llm-head"><span class="pill ${tone}">${esc(j.verdict)} · ${esc(j.confidence||'?')}</span> `
    +`<span class="mut">${esc(eng)}${j.salvaged?' · salvaged':''} — advisory, nothing recorded</span></div>`
    +(title?`<div class="llm-reason"><b>reason:</b> ${esc(title)}</div>`:'')
    +(j.reasoning?`<div class="llm-why mut">${esc(j.reasoning)}</div>`:'')
    +(j.excerpt?`<pre class="llm-src">${esc(j.excerpt)}</pre>`
      +`<div class="llm-why mut">line ${esc(j.matchedLine||'?')} — ${esc(j.redaction||'redacted')}</div>`:'')
    +'</div></td></tr>');
}

const LLM_CHECK_CATEGORIES=new Set(['secrets']);
function checkButton(category,f){
  if(!LLM_CHECK_CATEGORIES.has(category))return '';
  return `<button type="button" class="llm-check" data-repo="${esc(f.repo||'')}" data-rule="${esc(f.rule||'')}"`
    +` data-file="${esc(f.file||'')}" data-line="${esc(f.line||0)}"`
    +` title="ask the local model whether this is a real credential or a test fixture. Advisory only — it records nothing.">check</button>`;
}
// Verify asks whether the STATED REASON holds, which is a different question from Check's
// "is this a fixture". Only on an already-suppressed row: there is nothing to verify until somebody
// has claimed something. Advisory, like Check — it writes nothing and cannot overturn the judgment.
function verifyButton(category,f){
  if(!LLM_CHECK_CATEGORIES.has(category)||!f.annotation)return '';
  return `<button type="button" class="llm-verify" data-repo="${esc(f.repo||'')}" data-rule="${esc(f.rule||'')}"`
    +` data-file="${esc(f.file||'')}" data-line="${esc(f.line||0)}"`
    +` title="check whether the recorded reason is corroborated by evidence — a fixture path, a decodable JWT exp, a rotation in git history. Weak evidence stays UNVERIFIED in both directions.">verify</button>`;
}
// The identity fields a category is keyed on, from the schema the server ships. Hardcoding 'rule'
// meant a lane keyed on 'detector' posted rule:undefined and the server refused the write.
function identFields(category){
  // typeof guard: renderScannerTabs is LIFTED and run in isolation by derived-rows.test.mjs
  // with a fixed set of injected globals, so a bare reference here is a ReferenceError there.
  const st=(typeof lastState!=='undefined')?lastState:null;
  const sc=(st&&st.detailSchema&&st.detailSchema[category])||null;
  return (sc&&Array.isArray(sc.identity)&&sc.identity.length)?sc.identity:['rule'];
}
function identData(category,f){
  return identFields(category).map(k=>` data-id-${k}="${esc(f[k]==null?'':f[k])}"`).join('');
}
// Re-emits the data-id-* attributes off a dataset. A NAMED helper, not an inline template: an
// inline one puts a backtick inside the annForm literal, and panel-annotation-write asserts on the
// source span between class="ann-form" and data-line with [^`]*.
function identAttrs(d){
  const out=[];
  for(const k of Object.keys(d||{})) if(k.startsWith('id')&&k.length>2){
    out.push(' data-'+k.replace(/[A-Z]/g,(m)=>'-'+m.toLowerCase())+'="'+esc(d[k])+'"');
  }
  return out.join('');
}
function identFrom(el){
  const o={};
  for(const k of Object.keys(el.dataset||{})) if(k.startsWith('id')&&k.length>2){
    const f=k.slice(2); o[f.charAt(0).toLowerCase()+f.slice(1)]=el.dataset[k];
  }
  return o;
}
function annCell(f,category){
  // AN ANSWERED ROW KEEPS ITS CHECK. The annotation used to replace the whole cell, so the moment a
  // human recorded "false positive" the machine could no longer be asked about it — and that is the
  // one row where a second opinion is worth most, because a suppression is the judgment that stops
  // anyone else looking. The check writes nothing and cannot overturn the annotation; it can only
  // disagree out loud, which is the corroboration axis this fleet already measures elsewhere
  // (96.15% of findings were seen by exactly one analyst).
  if(f.annotation){const a=f.annotation;
    return `<td><span class="pill part" title="${esc(a.reason)} — ${esc(a.who)} · ${esc(a.at)}">${esc(a.action)}${a.whoKind?` · ${esc(a.whoKind)}`:''}</span>`
      +`${checkButton(category,f)}${verifyButton(category,f)}<span class="llm-verdict"></span></td>`;}
  return `<td>${annCellInner(category,f)}</td>`;
}
// THE RESTING STATE, in one place. It used to be spelled out here and re-spelled in the cancel
// handler, which rebuilt the FP button ALONE — so mark FP then cancel destroyed the check button
// and the verdict span, and the row could not be checked again until the whole table re-rendered.
// The comment above annButton already said the form "can restore it verbatim on cancel"; nothing
// made that true, and the check button was added beside it later without the restore learning.
function annCellInner(category,f){
  return `${annButton(category,f)}${checkButton(category,f)}<span class="llm-verdict"></span>`;
}
// The resting state of the triage cell. Split out of annCell so the inline form below can restore
// it verbatim on cancel — two hand-written copies of one button drift, and this one carries the
// finding's identity in its dataset.
function annButton(category,f){
  return `<button type="button" class="ann-fp" data-category="${esc(category)}" data-repo="${esc(f.repo)}" data-rule="${esc(f.rule)}"${identData(category,f)} data-file="${esc(f.file)}" data-line="${esc(f.line||0)}"`
    +` title="record an attributed false-positive judgment — the row stays, struck through, and leaves the counts when results are next collected">mark FP</button>`;
}
// `expires` is REQUIRED by the store's validator (monitor/annotate-lib.mjs, requireExpires:true):
// a suppression with no review date is a permanent blindfold. Defaulted, never assumed — the
// operator sees the date they are committing to and can change it before writing.
const ANN_EXPIRY_DAYS=90;
const annDefaultExpiry=()=>new Date(Date.now()+ANN_EXPIRY_DAYS*86400000).toISOString().slice(0,10);
function annForm(d){
  // `line` rides along even though the annotation store never keys on it (identity excludes line by
  // house rule): it is here ONLY so cancel can rebuild the check button faithfully. Without it the
  // restored button posts line 0, readContext clamps to line 1, and the model is asked about the
  // top of the file — a wrong answer rather than an error.
  return `<div class="ann-form" data-category="${esc(d.category)}" data-repo="${esc(d.repo)}" data-rule="${esc(d.rule)}"${identAttrs(d)} data-file="${esc(d.file)}" data-line="${esc(d.line||0)}">`
    +`<textarea class="ann-reason" rows="2" placeholder="Reason (required) — say what you verified. Published with your identity."></textarea>`
    +`<label class="ann-exp">re-check by <input type="date" class="ann-expires" value="${annDefaultExpiry()}"></label>`
    +`<div class="row-actions"><button type="button" class="ann-save pri">record</button>`
    +`<button type="button" class="ann-cancel">cancel</button></div>`
    +`<div class="ann-msg mut jshide"></div></div>`;
}
const SCANNER_TABS=[
  {key:'secrets',        view:'secrets',     n:'sec-n', cov:'sec-cov', rows:'sec-rows', cols:12},
  {key:'maliciousPackages', view:'malware',  n:'mal-n', cov:'mal-cov', rows:'mal-rows', cols:5},
  {key:'supplyChain',     view:'socket',       n:'sk-n', cov:'sk-cov', rows:'sk-rows', cols:8},
  {key:'supplyChainHeuristic', view:'supplychain', n:'gd-n', cov:'gd-cov', rows:'gd-rows', cols:4},
  {key:'sastSemgrep',    view:'sast', sub:'sg',     n:'sg-n',     cov:'sg-cov',     rows:'sg-rows',     cols:5, row:SARIF_GROUP_ROW, group:true},
  {key:'sastCodeql',     view:'sast', sub:'cqjs',   n:'cqjs-n',   cov:'cqjs-cov',   rows:'cqjs-rows',   cols:5, row:SARIF_GROUP_ROW, group:true},
  {key:'sastCodeqlJava', view:'sast', sub:'cqjava', n:'cqjava-n', cov:'cqjava-cov', rows:'cqjava-rows', cols:5, row:SARIF_GROUP_ROW, group:true},
  {key:'iac',            view:'iac',  n:'iac-n',    cov:'iac-cov',    rows:'iac-rows',    cols:5, row:SARIF_GROUP_ROW, group:true},
  // zizmor audits the CI configuration itself — the part of the supply chain that runs holding
  // repository credentials. Its rows are SARIF-shaped (rule/sev/file/line/message), so it reuses
  // SARIF_ROW rather than a fourth near-identical renderer.
  {key:'actionsPosture', view:'actions', n:'za-n', cov:'za-cov', rows:'za-rows', cols:5},
  // The four analysers that had no surface at all. Each was extracting into a category the panel
  // never rendered, so "found nothing" and "was never displayed" looked identical from the page —
  // the C1 shape aimed at the UI instead of at a scanner. All are rule/file/line/message shaped, so
  // they reuse SARIF_ROW rather than four near-identical renderers.
  {key:'sastGo',       view:'sast', sub:'go',     n:'gos-n', cov:'gos-cov', rows:'gos-rows', cols:7},
  {key:'shellLint',    view:'sast', sub:'shell',  n:'shl-n', cov:'shl-cov', rows:'shl-rows', cols:5},
  {key:'actionsLint',  view:'sast', sub:'wf',     n:'wfl-n', cov:'wfl-cov', rows:'wfl-rows', cols:5},
  {key:'dockerfile',   view:'sast', sub:'docker', n:'hdl-n', cov:'hdl-cov', rows:'hdl-rows', cols:5},
  {key:'dast',           view:'dast', n:'dast-n',   cov:'dast-cov',   rows:'dast-rows',   cols:5},
  {key:'minifiedCode',   view:'minify', n:'min-n',  cov:'min-cov',    rows:'min-rows',    cols:5},
  {key:'stubs', view:'stubs', n:'lane-n', cov:'lane-cov', rows:'lane-rows', cols:6, generic:true},
  {key:'denoLint', view:'denolint', n:'lane-n', cov:'lane-cov', rows:'lane-rows', cols:6, generic:true},
  {key:'denoTypes', view:'denotypes', n:'lane-n', cov:'lane-cov', rows:'lane-rows', cols:6, generic:true},
  {key:'secretsHistory', view:'secretshistory', n:'lane-n', cov:'lane-cov', rows:'lane-rows', cols:6, generic:true},
  {key:'cspm', view:'cspm', n:'lane-n', cov:'lane-cov', rows:'lane-rows', cols:6, generic:true},
  {key:'depsJvm', view:'depsjvm', n:'lane-n', cov:'lane-cov', rows:'lane-rows', cols:6, generic:true},
  {key:'depsGo', view:'depsgo', n:'lane-n', cov:'lane-cov', rows:'lane-rows', cols:6, generic:true},
  {key:'depsRetire', view:'depsretire', n:'lane-n', cov:'lane-cov', rows:'lane-rows', cols:6, generic:true},
  {key:'vendorAssets', view:'vendor', n:'lane-n', cov:'lane-cov', rows:'lane-rows', cols:6, generic:true},
  {key:'tlsHeaders', view:'tls', n:'lane-n', cov:'lane-cov', rows:'lane-rows', cols:6, generic:true},
  {key:'apiFuzz', view:'apifuzz', n:'lane-n', cov:'lane-cov', rows:'lane-rows', cols:6, generic:true},
];
// SCAN SCOPE — the bound the findings table cannot show you by existing.
//
// A config file removed 859 findings from one project in a single commit. It was the right call,
// and the page still said "9 finding(s) · 1/1 repos scanned" with nothing to indicate that a
// suppression stood behind the number. That is this system's own failure shape wearing a different
// hat: the count is true, and by itself it is not the whole statement. So the exclusions are shown
// on the same card as the coverage, in the same vocabulary, sourced from the declarations
// themselves (monitor/scan-scope.mjs — the gitleaks toml for secrets, each check's own command
// flags for the rest) so the page can never claim a scope the scanner does not have. Every tab
// reads its own scanner's entry from the `scanScopes` map; non-path bounds (a language selection,
// a docker gate, a live-target gate) arrive as `notes` and are stated in the same breath.
//
// The rule-scoped and the blanket forms are deliberately NOT flattened into one number. Removing a
// directory from every rule is a categorically larger claim than silencing one entropy heuristic on
// it, and a reader deciding whether to trust a clean result needs to see which of the two happened.
function scopeBit(sp){
  if(!sp)return '';
  if(!sp.known){
    const head=`<span class="pill plan">scan scope UNKNOWN</span> <span class="mut">the scope declaration could not be read (<code>${esc(sp.reason||'?')}</code>${sp.source?` · <code>${esc(sp.source)}</code>`:''}), so this page cannot state what the scan was allowed to see. Not a claim that nothing was excluded.${sp.detail?` ${esc(sp.detail)}`:''}</span>`;
    // A scope we cannot state IN FULL is not a scope we know NOTHING about. `scope-drift` means the
    // check's declared bounds disagree with its command: that invalidates the non-path notes and
    // leaves the path exclusions — derived from the flags and from codeql-filters.txt — accurate.
    // Returning early here hid the bound that removed ~640 findings from one area behind this pill,
    // so the change meant to strengthen the disclosure was deleting the most consequential part of
    // it. Any other !known reason carries no blocks and still renders as the bare pill.
    const bl=sp.blocks||[];
    if(!bl.length)return head;
    const list=bl.map(b=>`<div class="scope-blk"><div>${b.targetRules
        ?`<span class="pill part">rule-scoped</span> <span class="mut">only <code>${esc(b.targetRules.join(', '))}</code> is silenced here — every other rule still runs on these files</span>`
        :'<span class="pill plan">all rules</span> <span class="mut">these paths are not scanned at all</span>'}</div>`
      +`<div class="mut scope-desc">${esc(b.description)}</div>`
      +`<div>${b.paths.map(p=>`<code class="path-chip">${esc(p)}</code>`).join('')}</div></div>`).join('');
    return head+`<details class="drop-gap"><summary class="mut point">what is STILL known to be excluded — path bounds survive the drift</summary>${list}</details>`;
  }
  const blocks=sp.blocks||[], notes=sp.notes||[];
  const blanket=blocks.filter(b=>!b.targetRules), scoped=blocks.filter(b=>b.targetRules);
  const nPaths=blanket.reduce((a,b)=>a+b.paths.length,0);
  const parts=[];
  if(nPaths)parts.push(`<b>${nPaths}</b> path pattern(s) excluded from every rule`);
  for(const b of scoped)parts.push(`<b>${b.paths.length}</b> path(s) with only <code>${esc(b.targetRules.join(', '))}</code> silenced`);
  if(sp.maxTargetMB)parts.push(`files over <b>${esc(sp.maxTargetMB)} MB</b> skipped whole`);
  // A bound we could not DETERMINE is not a bound that is absent. Omitting this line for both — which
  // is what a bare `if (sp.maxTargetMB)` did — prints "no size limit" over a manifest nobody read.
  else if(sp.maxTargetUnknown)parts.push(`<b>file-size bound UNKNOWN</b> (<code>${esc(sp.maxTargetUnknown)}</code>) — large files may be skipped whole and this page cannot say at what size`);
  for(const n of notes)parts.push(esc(n));
  if(!parts.length)return '';
  const list=blocks.map(b=>`<div class="scope-blk"><div>${b.targetRules
      ?`<span class="pill part">rule-scoped</span> <span class="mut">only <code>${esc(b.targetRules.join(', '))}</code> is silenced here — every other rule still runs on these files</span>`
      :'<span class="pill plan">all rules</span> <span class="mut">these paths are not scanned at all</span>'}</div>`
    +`<div class="mut scope-desc">${esc(b.description)}</div>`
    +`<div>${b.paths.map(p=>`<code class="path-chip">${esc(p)}</code>`).join('')}</div></div>`).join('');
  return `<span class="pill part">scope bounded</span> <span class="mut">${parts.join(' · ')}. A clean result here has not looked everywhere — suppression is a coverage cost, so it is stated rather than assumed.</span>`
    +(blocks.length?`<details class="drop-gap"><summary class="mut point">what is excluded, from <code>${esc(sp.source)}</code></summary>${list}</details>`:'');
}

// Heading and footnote for whichever category currently owns the shared generic container.
// MODULE SCOPE, deliberately: these were first written beside SCANNER_LABEL, which lives
// INSIDE a function — so renderScannerTabs could not see them and threw ReferenceError the
// moment anyone opened a generic lane. Indentation hid it; scope is what matters.
// TABS THE PAGE DID NOT WRITE. Seventeen categories carried a row schema, ran, produced findings
// and had nowhere to render them — reachable only through the perf table. They are generated here
// from d.laneTabs (the server sends every category; this takes the complement of what the strip
// already hand-writes) so a lane added tomorrow gets a tab by EXISTING rather than by being
// remembered in a sixth registry.
//
// Generated tabs are generic by construction: their cells come from detailSchema, which every one
// of them already has. `data-derived` marks them in the DOM, because a reader who finds a tab
// nobody wrote should be able to learn that from the page rather than from a commit message.
let LANE_TABS_ADDED=false;
function addDerivedLaneTabs(d){
  const list=Array.isArray(d&&d.laneTabs)?d.laneTabs:[];
  if(LANE_TABS_ADDED||!list.length)return;
  const have=new Set(SCANNER_TABS.map(t=>t.key));
  const strip=$('views'); if(!strip)return;
  // A lane whose VIEW already has a hand-written tab (bola → Access control) is that tab. Generating
  // a second one duplicated it in the strip and remapped NATIVE to the generic lane table.
  const tabbed=new Set([...strip.querySelectorAll('.vtab')].map(b=>b.dataset.v));
  let added=0;
  for(const t of list){
    if(have.has(t.key)||tabbed.has(t.view))continue;   // the page writes this one itself
    const cols=(d.detailSchema&&d.detailSchema[t.key]&&d.detailSchema[t.key].columns)||null;
    // NO SCHEMA, NO TAB — and that is a statement, not a silent skip: a tab whose cells cannot be
    // derived would render an empty table under a heading promising findings, which is the false
    // clean this panel refuses everywhere else. It stays visible in the perf table either way.
    if(!cols||!cols.length)continue;
    SCANNER_TABS.push({key:t.key,view:t.view,n:'lane-n',cov:'lane-cov',rows:'lane-rows',
      cols:cols.length+1,generic:true,derived:true});
    NATIVE[t.view]='view-lane';
    VALID_VIEWS.add(t.view);
    TAB_GROUPS_EXTRA[t.view]=t.section||'other';
    LANE_TITLE[t.key]=t.label||t.key;
    const b=document.createElement('button');
    b.type='button'; b.className='vtab'; b.dataset.v=t.view; b.dataset.derived='1';
    b.title=`${t.label||t.key} — this tab is built automatically from the result format of the check`;
    // chip shows the SHORT form (`CodeQL · Python`); title and LANE_TITLE keep the full label, so
    // nothing the short form drops is unreachable. Falls back when the server sends no `short`.
    b.textContent=t.short||t.label||t.key;
    strip.appendChild(b); added++;
  }
  LANE_TABS_ADDED=true;
  if(added){rebuildViewPaths();renderGroups();}
}
// THE EMPTY-LANE PANEL. Centred, with the wordmark, because this is the one place in the panel
// where the honest answer is an invitation rather than a number — and a grey sentence in a table
// cell reads as "nothing here", which is precisely the false clean the rest of this page refuses.
//
// `why` is never invented. never-run means the rollup carries no record at all; not-applicable
// means the lane declared itself out of scope for this subject; blocked means it was forced on and
// could not run. Each says a different thing about whether the operator should act, and offering a
// run button on a lane that cannot run would be worse than saying nothing.
const LANE_VOID_COPY={
  'never-run':{t:'This check has never run here',
    d:'No results in this area record it. Nothing has looked yet, so this is not a clean result.'},
  'not-applicable':{t:'This lane does not apply here',
    d:'The lane declared itself out of scope for this subject, so there is nothing for it to find. Running it would not change that.'},
  running:{t:'This lane is running now',
    d:'It has never produced a result here before, so there is nothing yet to show. The rows appear when the sweep publishes its rollup.'},
  blocked:{t:'This lane is forced on and cannot run',
    d:'It is switched on for this subject and its prerequisites are missing, so it produces nothing. That is a configuration to fix, not a scan to start.'},
};
function laneVoidPanel(t,why,detail,registry){
  const c=LANE_VOID_COPY[why]||LANE_VOID_COPY['never-run'];
  const check=laneCheckId(t.key,registry);
  // A run button ONLY where running is the answer, and only when the check id is known: the server
  // refuses an unknown one anyway (it would otherwise be read as a group name and scan something
  // else), and a button that cannot work is worse than its absence.
  // 'running' is excluded by the equality, not by an extra clause — but stated here because it is
  // the state a reader is most likely to assume still wants a button.
  const canRun=why==='never-run'&&!!check;
  return `<div class="lane-void">
    <div class="lane-void-mark"><span class="seal"><svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="16" fill="#14161A"/><circle cx="16" cy="16" r="14.5" fill="none" stroke="#C9A227" stroke-width="1"/><circle cx="12" cy="20" r="2.4" fill="#C9A227"/><circle cx="21" cy="11" r="2.4" fill="none" stroke="#C9A227" stroke-width="1.3"/><path d="M13.7 18.3 L19.3 12.7" stroke="#C9A227" stroke-width="1.3" fill="none"/></svg></span><span class="wordmark">commitwork</span></div>
    ${why==='running'?'<div class="lane-spin" role="progressbar" aria-label="scan in progress"></div>':''}
    <h3>${esc(c.t)}</h3>
    <p class="mut">${esc(c.d)}</p>
    ${detail?`<p class="mut lane-void-why">${esc(detail)}</p>`:''}
    ${canRun?`<div class="lane-void-acts">
      <button type="button" class="pri lane-run" data-check="${esc(check)}" data-lane="${esc(t.key)}">Run ${esc(LANE_TITLE[t.key]||t.key)} now</button>
      <div class="mut lane-void-scope">Runs this lane only, for the selected project. Every other lane is left alone.</div>
    </div>`:''}
  </div>`;
}
// check id for a category, from the registry the rollup publishes. Unknown answers null, and the
// caller then offers no button rather than one the server will refuse. The registry is PASSED, not
// read off a module global: this runs inside the renderer, whose whole state arrives as an argument,
// and reaching past it for `lastState` made the function unreachable from anywhere that renders
// without the page — which is every test of it.
function laneCheckId(cat,registry){
  const reg=Array.isArray(registry)?registry:[];
  const hit=reg.find(r=>r&&r.key===cat);
  return hit&&hit.check?hit.check:null;
}

// TAB_GROUPS is frozen and belongs to the hand-written strip; generated tabs place themselves here
// and groupOf() consults both. Kept apart on purpose — a generated placement must not look like a
// declared one.
const TAB_GROUPS_EXTRA={};

const LANE_TITLE={stubs:'Stubs',denoLint:'Deno lint',denoTypes:'Deno types',secretsHistory:'Secrets history',cspm:'CSPM',depsJvm:'JVM CVEs',depsGo:'Go CVEs',depsRetire:'Retire.js',vendorAssets:'Vendor assets',tlsHeaders:'TLS / headers',apiFuzz:'API fuzz'};
const LANE_FOOT={stubs:'TODO/FIXME/HACK markers and unfinished work. Hygiene, not vulnerabilities — excluded from the headline totals on purpose, which is exactly why it needed a drill-down of its own.',denoLint:'Deno lint findings. Kept apart from the code security scan, so a clean linter result is never shown as a clean security result.',denoTypes:'Deno type-check failures. The other half of the Deno pair: no advisory database covers the URL/JSR import graph, so these measure the code, never what it imports.',secretsHistory:'TruffleHog over the COMMITTED HISTORY — a secret deleted from the working tree is still in the history until it is rotated. Distinct from Leaks, which reads the tree as it stands.',cspm:'GitHub account security settings. Needs an access token rather than a live address, so a missing token shows as not run and names what is missing.',depsJvm:'JVM dependency advisories (Trivy), including those recursed out of a Spring Boot fat jar.',depsGo:'Go module advisories (govulncheck), which reports only advisories actually reachable from the code.',depsRetire:'Known-vulnerable front-end JS libraries — the blind spot OSV does not cover.',vendorAssets:'Third-party assets committed into the tree rather than installed, so no lockfile knows their version.',tlsHeaders:'TLS configuration and security-header grading against a running target.',apiFuzz:'Property-based API contract fuzzing (Schemathesis) against a live OpenAPI spec.'};

// Every view any scanner lane draws into. Derived so a new lane is reachable the moment it is
// registered, rather than the moment somebody remembers to extend a disjunction.
const SCANNER_VIEWS=new Set(SCANNER_TABS.map(t=>t.view));

function renderScannerTabs(d){
  const sc=(d&&d.scanners)||{}, det=(d&&d.scannerFindings)||{};
  // detailSchema is what serve.mjs has been sending and this page never read. Every per-row lane's
  // cells are DERIVED from it now — the literal renderers are retired — so there is no second way
  // to draw a row. When it is absent the lane says so explicitly (see the fail-closed branch below)
  // rather than emitting an empty tbody: a missing schema must never look like a scanned-and-clean
  // lane, which is the rule the coverage banner already follows.
  const schemas=(d&&d.detailSchema)||null;
  // Read defensively rather than closing over the module-level `curView`: this function is lifted
  // out of the page and run against a DOM shim by admin/test/*.test.mjs, and a bare reference to a
  // global the slice does not define is a ReferenceError there — a renderer that cannot be tested
  // the way this repo tests renderers. Unknown view ⇒ no generic lane writes, which is the safe
  // default: the shared container belongs to whichever lane is on screen, and none is.
  const activeView=(typeof curView==='string')?curView:null;
  // The SAST view hosts three categories, so its nav badge is the SUM of their totals — a view
  // whose every category is absent/void keeps a CLEARED badge (null), never a fabricated zero.
  // SUB-TAB BADGES. Counted from the same pass that fills the tables, so the menu can never
  // disagree with what a click reveals — the failure mode of any second count.
  const subBadge={};
  const badge={};
  const bump=(view,v)=>{ if(!(view in badge))badge[view]=null; if(typeof v==='number')badge[view]=(badge[view]||0)+v; };
  // Annotated is tracked alongside the open count, not folded into it. A lane at zero because every
  // finding was judged away is not the same fact as a lane at zero because nothing was found, and
  // one number cannot carry both.
  const annot={};
  const bumpAnn=(view,v)=>{ if(typeof v==='number'&&v>0)annot[view]=(annot[view]||0)+v; };
  for(const t of SCANNER_TABS){
    const s=sc[t.key], rows=Array.isArray(det[t.key])?det[t.key]:null;
    // ELEVEN LANES SHARE ONE CONTAINER, so only the one on screen may write to it — otherwise the
    // last generic entry in this list would overwrite every earlier one and every tab would show
    // the same table. The badge is computed from `scanners`, never from the DOM, so a lane that is
    // not rendered still reports its own count: void stays CLEARED (a 0 there would read as a
    // measured clean), everything else carries its total.
    if(t.generic&&activeView!==t.view){
      bump(t.view,(s&&('ran' in s)&&s.ran===0&&!(Number(s.total)>0))?null:((s&&typeof s.total==='number')?s.total:null));
      bumpAnn(t.view,s&&s.annotated);
      continue;
    }
    const n=$(t.n), cov=$(t.cov), body=$(t.rows);
    if(!n||!cov||!body)continue;
    // The shared container carries no static <thead> or heading — both belong to whichever category
    // is currently in it, and both come from the same schema the cells do.
    if(t.generic){
      const gc=(schemas&&schemas[t.key])?laneColumns(t.key,schemas[t.key]):null;
      if(gc)t.cols=gc.length;                     // colspan for the empty/void states below
      const ti=$('lane-title'); if(ti)ti.textContent=LANE_TITLE[t.key]||t.key;
      const th=$('lane-thead');
      if(th)th.innerHTML=gc?`<tr>${gc.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr>`:'';
      const ft=$('lane-foot'); if(ft)ft.textContent=LANE_FOOT[t.key]||'';
    }
    // ABSENT — this rollup never spoke for the category. Not a void CLAIM either: no evidence.
    if(!s){
      n.textContent='—';
      // The pill stays even though the panel below now says the same thing at length. The coverage
      // strip is where a reader looks to learn a lane's state without reading the table, and leaving
      // it blank renders "never scanned" as "nothing to say".
      cov.innerHTML='<div class="card gap-banner"><span class="pill plan">No result — never scanned here</span> <span class="mut">these results hold no record of this check, either way.</span></div>';
      // NEVER RUN IS NOT EMPTY, and it is the one state where the page should offer to change it.
      // A lane with no record renders the centred panel below rather than a one-line grey row: the
      // reader arrived at a tab that exists, found nothing, and needs to know whether that is
      // "nothing to find" or "nobody looked" — and here it is always the second.
      // A lane the operator started a moment ago must not still be offering them the button they
      // just pressed. `typeof` guarded because this whole region is extracted and evaluated on its
      // own by the renderer tests, where the live-state map does not exist.
      const ck=laneCheckId(t.key,d&&d.scannerRegistry);
      const live=(typeof laneRun!=='undefined'&&ck)?laneRun[ck]:null;
      const nowRunning=!!(live&&live.running&&live.running.length);
      body.innerHTML=`<tr><td colspan="${t.cols}">${laneVoidPanel(t,nowRunning?'running':'never-run',
        nowRunning?`Started${live.firstStartedAt?' at '+live.firstStartedAt.slice(11,19)+' UTC':''}${live.running.length===1?' on '+live.running[0]:' on '+live.running.length+' repositories'}.`:null,
        d&&d.scannerRegistry)}</td></tr>`;
      bump(t.view,null); continue;
    }
    if(t.sub)subBadge[t.sub]=(s&&typeof s.total==='number')?s.total:null;
    const prov=('ran' in s), isVoid=prov&&s.ran===0;
    const inScope=prov?(s.ran+s.skipped+s.noscan):null;
    const bits=[];
    if(s.carried)bits.push(`<span class="pill part">carried · as of ${esc(age(s.carriedAt))}</span> <span class="mut">not re-run by this sweep — these rows are slice <code>${esc(s.carriedFrom||'?')}</code>'s, and chain until the category is actually rescanned.</span>`);
    // annotated ≠ deleted, and a reduced count never appears without its reason: the rows stay
    // below (struck through, judgment attached), only the tallies above exclude them.
    //
    // `annotated > total` USED TO RAISE A CRITICAL HERE, and it was arithmetic that cannot mean what
    // it claimed. The rollup decrements `total` as it applies each record (monitor/rollup.mjs ~:1476
    // subtracts from the bucket AND from total, then increments `annotated`), so `total` is the
    // count with the suppressed rows already removed. `annotated` is incremented once per row it
    // actually matched — so it can never exceed the population, and `annotated > total` means only
    // "more than half of this lane has been adjudicated", which is the normal end state of a lane
    // somebody has worked. Measured 2026-08-27 on commitwork-admin/secrets: 20 annotated, total 1,
    // 21 rows, every one of the 20 matching a row present on the page — and the banner called all
    // 20 stale. The 2026-08-21 note that justified this ("client-d/secrets 80 over 3") was reading the
    // same artefact and drew the same wrong conclusion from it.
    //
    // The stale-acceptance signal is real and it is ALREADY PUBLISHED, correctly: the rollup records
    // records that matched nothing, serve.mjs aggregates them across every area (a per-area noMatch
    // is legitimate — a record scoped to repo X noMatches in area Y), and the panel renders it in
    // the Scanners line as `orphaned`. It reads 0 on this fleet. So this was a second, wrong
    // implementation of a signal that has a correct one, and a lane fully triaged — the best
    // outcome available — was the exact input that turned it red.
    // nTotal, not `total`: that const is declared ~20 lines below and referencing it here is a
    // temporal-dead-zone throw that blanks the whole render — the same shape as the LANE_TITLE
    // scope bug, and again invisible until a test actually walked the branch.
    const nTotal=Number(s.total)||0;
    if(s.annotated)bits.push(`<span class="pill part">${s.annotated} annotated</span> <span class="mut">accepted / false-positive / won't-fix by an attributed judgment (<code>monitor/private/annotations.json</code>). Excluded from the counts above; the rows remain below, struck through, with who and why.</span>`);
    // Wording comes from COV_COPY for EVERY zero-run state, contradiction included — the banner
    // must not be able to say something the Overview's row for the same category does not.
    if(isVoid){const c=COV_COPY(s,covState(s));bits.push(`<span class="pill ${c.cls}">${c.label}</span> <span class="mut">${c.why}</span>`);}
    else if(prov&&s.noscan>0)bits.push(`<span class="pill part">partial · ${s.noscan} noscan</span> <span class="mut">${s.ran} of ${inScope} repo(s) produced a scan. The rows below are a FLOOR, not a total.</span>`);
    else if(!prov)bits.push('<span class="mut">this rollup predates run provenance — re-roll the batch to populate ran/skipped/noscan</span>');
    // ROWS < TOTAL IS THREE DIFFERENT FACTS AND USED TO BE ONE SENTENCE.
    //
    // Every shortfall rendered as "truncated · the rollup caps detail per repo". Measured
    // 2026-08-03, that explanation was wrong for every case on disk: the cap is 2500, no repo is
    // near it, and the real causes were a group-scoped sweep carrying counts forward without rows,
    // and one area whose rollup predates the extractor AND whose batch artifacts have since been
    // compacted away. Telling a reader "the list is capped" sends them to raise a limit when what
    // they need is a sweep — a confidently wrong explanation, which is worse than none.
    //
    // The rollup now DECLARES which it is (`scanners[key].detail` = {rows, truncated, noDetail}),
    // so this reads a fact instead of inferring one (named `prov2` because `det` is already bound to
    // scannerFindings above — shadowing it put the outer binding in TDZ). `detail` absent = a rollup
    // written before the
    // field existed, and that is its own state, not an excuse to fall back to the old sentence.
    const shown=rows?rows.length:0, total=nTotal, prov2=s.detail;
    if(rows&&total>shown){
      if(prov2&&prov2.truncated>0)
        bits.push(`<span class="pill part">truncated</span> <span class="mut">showing ${shown} of ${total} — the cap dropped ${prov2.truncated} row(s) so this payload stays bounded. The count is never capped; the list is.</span>`);
      else if(s.carried)
        bits.push(`<span class="pill part">counts carried, detail not</span> <span class="mut">showing ${shown} of ${total}. This sweep did not run the category, so its count comes forward from slice <code>${esc(s.carriedFrom||'?')}</code> while the rows do not — that slice predates the extractor. Sweep this category to publish the rest.</span>`);
      else if(prov2&&prov2.noDetail&&prov2.noDetail.length)
        bits.push(`<span class="pill part">partial detail · ${prov2.noDetail.length} repo(s)</span> <span class="mut">showing ${shown} of ${total}. These repos reported counts but produced no rows: ${prov2.noDetail.map(esc).join(', ')}. Re-roll their batch to extract the detail.</span>`);
      else
        bits.push(`<span class="pill plan">detail unavailable</span> <span class="mut">showing ${shown} of ${total}, and this rollup cannot say why — it was written before the detail provenance existed. If its sweep batch has since been compacted the counts have outlived the artifacts they came from, and only a fresh sweep can produce rows. NOT a cap.</span>`);
    }
    // last, and always: the sweep-specific states above describe THIS run, the scope describes what
    // any run of this scanner is permitted to see. It shows on a clean tab too — especially there.
    // Each tab reads ITS OWN scanner's scope from the per-category map — the gitleaks bounds must
    // never decorate a tab they do not bind, and vice versa.
    {const b=scopeBit(d&&d.scanScopes&&d.scanScopes[t.key]);if(b)bits.push(b);}
    cov.innerHTML=bits.length?`<div class="card gap-banner stack">${bits.map(b=>`<div>${b}</div>`).join('')}</div>`:'';
    // "n/a" and "no scan" are not the same headline. A category with no target here was never going
    // to produce a number; one that was denied its input was, and didn't.
    // "no scan" / "n/a" only when there is genuinely nothing to show; a lane holding rows reports
    // them, with the disputed provenance stated in the banner rather than in the count.
    const voidEmpty=isVoid&&covState(s)!=='contradiction';
    n.textContent=voidEmpty?(covState(s)==='na'?'n/a':'no scan'):`${total} finding(s)${prov&&!isVoid?` · ${s.ran}/${inScope} repos scanned`:''}`;
    // A VOID renders the void INSTEAD of a table: an empty grid under "0 findings" is the false
    // clean, and it is worse here than on the Overview because this page promises detail.
    // A VOID WITH ROWS IS NOT A VOID — it is the rollup disagreeing with itself, and the panel
    // must not settle that argument by hiding one side of it. Measured 2026-08-21 across every
    // rollup on disk: client-d/denoLint carried ran=0 with 821 rows, 100randomrepos/denoLint ran=0
    // with 2,430, an internal project's shellLint 1 — 3,252 findings rendered as "nothing scanned" and
    // badged null. The n/a wording was worse than the void wording: it asserted there was no
    // target for the check while the lane held thousands of findings FROM that target.
    // So the provenance banner still shows (the ran=0 claim is real and worth stating), the
    // contradiction is named, and the rows render underneath where they always should have.
    // Only a GENUINE void replaces the table with a sentence. A contradiction keeps its rows: the
    // whole point is that the evidence is there and the coverage claim is what is in doubt.
    if(isVoid&&covState(s)!=='contradiction'){ const st=covState(s);
      body.innerHTML=`<tr><td colspan="${t.cols}" class="mut">${st==='na'
        ?`no rows, because there is nothing here for this check to read — ${s.skipped} repo(s) declared it inapplicable. Correctly empty.`
        :`no rows, because nothing scanned — ${s.skipped} repo(s) skipped, ${s.noscan} noscan. Absence of evidence, not evidence of absence.`}</td></tr>`;
      bump(t.view,null); continue; }
    if(!rows){ body.innerHTML=`<tr><td colspan="${t.cols}" class="mut">this rollup carries counts but no per-finding detail — re-roll the batch to populate it</td></tr>`; bump(t.view,total||null); continue; }
    // `group` collapses identical diagnoses into one row carrying its sites (see groupSarif). The
    // COUNT above the table still reports findings, not groups — collapsing the tally as well would
    // quietly restate the fleet's finding count as a smaller number.
    const display=t.group?groupSarif(rows):rows;
    body.innerHTML=rows.length
      ? (()=>{const cols=(schemas&&schemas[t.key])?laneColumns(t.key,schemas[t.key]):null;
          // FAIL CLOSED, VISIBLY. Rows are derived from detailSchema now; the literal renderers are
          // retired. If the schema is missing (an older server, a panelSchema() fault) there is no
          // second way to draw the cells — so say so, rather than emit an empty tbody under a
          // heading that promises findings. An empty table is the false clean this section refuses.
          if(!cols&&!t.row)return `<tr><td colspan="${t.cols}" class="mut">${display.length} finding(s) present, but this panel could not read the column schema for <code>${esc(t.key)}</code> — the rows are NOT shown and this is NOT a clean result. Reload; if it persists the server is not sending <code>detailSchema</code>.</td></tr>`;
          // A GROUP IS NOT A FINDING, and the schema describes a finding. groupSarif collapses
          // identical diagnoses into {rule, sev, message, sites[]} — the file and line move INTO
          // the sites, so a schema renderer expecting flat `file`/`line` fields reads undefined and
          // draws a row with no location while the sites it was grouping go unrendered entirely.
          // Reported 2026-08-26 on SAST · Semgrep: "3 finding(s)" over one row with no file, no
          // line, and no sign that two more sites existed. The lane declares `group:true` AND a row
          // renderer that understands the grouped shape; that renderer is the one that must win.
          // Schema derivation stays the default for every ungrouped lane.
          const cell=(t.group&&t.row)?t.row:(cols?(f)=>cols.map(c=>c.render(f)).join(''):t.row);
          // A CLOSED FALSE POSITIVE IS NOT AN OPEN FINDING. It kept its place in this table with a
          // pill attached, so a lane whose findings were all adjudicated still read as a wall of
          // rows to work. They move to their own table below, same headers, and out of the count.
          const open=display.filter(f=>!isClosedFinding(f)), closed=display.filter(isClosedFinding);
          renderClosedTable(body,cols,t,closed);
          return (open.length?open:display.length&&!closed.length?display:open)
            .map(f=>`<tr${f.annotation?' class="ann-row"':''}>${cell(f)}</tr>`).join('')
            || `<tr><td colspan="${t.cols}"><span class="pill live">clean</span> <span class="mut">every finding here is adjudicated — ${closed.length} closed below</span></td></tr>`;})()
      : `<tr><td colspan="${t.cols}"><span class="pill live">clean</span> <span class="mut">${s.ran} repo(s) scanned, nothing found</span></td></tr>`;
    // POPULATION SPLIT — the rows a lane SET ASIDE, stated beside the ones it published.
    // Both counts existed only in the JSON, which made the table read as the whole story: the
    // malicious-packages lane showed 0 while 24 fixture rows and 2 unreachable ones sat unmentioned
    // underneath it. A zero with no denominator is the same false clean this page exists to refuse.
    // Generic on purpose — any lane that grows `fixtures`/`undetermined` gets the line for free.
    const fxN=(s.fixtures&&Number(s.fixtures.total))||0, unN=Number(s.undetermined)||0;
    if(cov&&(fxN||unN)){
      const seen=(Number(total)||0)+fxN+unN;
      const parts=[`<b>${esc(String(total||0))}</b> published`];
      if(fxN)parts.push(`<span class="pill unk">${esc(String(fxN))} in test fixtures</span>`);
      if(unN)parts.push(`<span class="pill unk">${esc(String(unN))} undetermined</span>`);
      cov.innerHTML+=`<div class="card gap-banner">${parts.join(' · ')} <span class="mut">of ${esc(String(seen))} matched. `
        +`A fixture row describes a test corpus, not the software. An <b>undetermined</b> row matched an advisory by NAME and the advisory could not reach the installed version — it is neither a finding nor a pass, and it is not a statement that the package is safe. Neither is dropped: both keep their claim in the artifact.</span></div>`;
    }
    bump(t.view,total);
    bumpAnn(t.view,s&&s.annotated);
  }
  for(const [v,n] of Object.entries(badge))setTabN(v,n,null,annot[v]||0);
  // GUARDED because this function is LIFTED OUT OF THIS FILE and executed in isolation:
  // admin/test/scanner-tabs.test.mjs slices from `const SARIF_ROW=` to the end of this function and
  // runs it through `new Function` with four injected globals. A bare call to a helper defined
  // further down the page is a ReferenceError there — which is exactly what it was, five tests red,
  // for a badge that is decoration. The renderer's contract is the tables; the sub-menu badge is a
  // nicety and must not be able to take the tables down with it.
  if (typeof paintSastSubBadges === 'function') paintSastSubBadges(subBadge);
}

