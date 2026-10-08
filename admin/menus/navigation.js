// ── TWO-LEVEL NAVIGATION ────────────────────────────────────────────────────────────────────────
// The strip held 28 flat tabs — 10 when it was last designed — and 14 of those are evidence lanes
// the Overview's scanner-coverage table already indexes with MORE information than a tab can carry
// (a tab shows a count; the table shows the count and whether the count means anything). Flat, the
// strip also asked the reader to re-derive a taxonomy at every step: conditions, vendors,
// techniques and artefacts side by side.
//
// So the primary strip lists QUESTIONS and the secondary strip lists the views that answer one.
//
// THE GROUP IS DERIVED FROM THE VIEW, never stored beside it. That is the whole reason this change
// touches no routing: VALID_VIEWS, viewUrl(), urlView() and the hash/popstate handlers are all
// untouched, and `#codeql` still resolves to codeql — it simply arrives with Findings selected. A
// redirect map would have been a second vocabulary to keep in step with the first.
//
// UNMAPPED TABS RENDER, they do not vanish. This file gained 18 tabs in eleven days across about a
// dozen sessions; a hand-maintained 28-entry list would silently swallow the 29th, and a view that
// exists but cannot be reached is the disappearing-evidence failure this panel exists to refuse.
// Anything unmapped collects under "Other" — visibly wrong, rather than invisibly absent.
// WHAT EACH VIEW IS ABOUT, declared once. `fleet` views answer for every project and ignore the
// picker; `project` views (the default) answer for the selected one; `account` is the operator.
// The rail, breadcrumb, header, URL, run controls and picker redirect all read this one table;
// separate lists drift, and a page kept open with no project must never be labelled with one.
const VIEW_SCOPE=Object.freeze({fleet:'fleet',projects:'fleet',rollups:'fleet',remfleet:'fleet',verdicts:'fleet',oversight:'fleet',correlations:'fleet',
  overwatch:'fleet',cra:'fleet',stpa:'fleet',bola:'fleet',comments:'fleet',spinecomments:'fleet',
  settings:'fleet',perf:'fleet',held:'fleet',journey:'fleet',profile:'account'});
const scopeOf=(v)=>Object.prototype.hasOwnProperty.call(VIEW_SCOPE,v)?VIEW_SCOPE[v]:'project';
const TAB_GROUPS=Object.freeze({
  // what is true now. `fleet` is FIRST because a section click opens its section's first tab, and
  // the fleet page is the one view here that answers with no project selected — landing an operator
  // who clicked "Overview" on a page that says "choose a project" is the state this tab replaced.
  fleet:'overview', overview:'overview', dashboard:'overview', lanes:'overview', report:'overview', verdicts:'overview', oversight:'overview', correlations:'overview', posture:'overview',
  // what exists, and what of it is reachable
  sitemap:'surface', exposure:'surface',
  // the evidence lanes
  // credentials: held on this box, in the working tree, in committed history
  held:'secrets', secrets:'secrets', secretshistory:'secrets',
  // read the code without running it
  allfindings:'static', feed:'static', sast:'static', codeql:'static', iac:'static', actions:'static', cspm:'static',
  // what the tree pulls in, and from whom
  malware:'deps', socket:'deps', supplychain:'deps', depsjvm:'deps', depsgo:'deps',
  depsretire:'deps', vendor:'deps', renovate:'deps',
  // not vulnerabilities: readability, unfinished work, standards conformance
  a11y:'quality', stubs:'quality', minify:'quality',
  // is this idiomatic / safe-by-pattern. The boundary is LANE_KINDS, not the tool name: every
  // member is lane(H,'not-a-vulnerability'), so a lint-clean repo earns no security row. The five
  // language lanes are GENERATED tabs and place themselves via LANE_SECTION in monitor/lane-tabs.mjs.
  denolint:'lint',
  // do the types hold — a compile-time answer, not a pattern match. deno check is the only type
  // checker in the roster.
  denotypes:'types',
  // the Slop Bucket is quality by the same rule as the rest of this row: it is readability, not a vulnerability.
  comments:'quality',spinecomments:'quality',
  overwatch:'act',
  // need something running to answer
  dast:'dynamic', bola:'dynamic', stpa:'dynamic', tls:'dynamic', apifuzz:'dynamic', runtime:'dynamic',
  // doing something about it
  remediation:'act', issues:'act', daily:'act', delivery:'act',
  // `settings` (sweep hang/kill thresholds and cadence overrides) is another session's in-flight
  // tab. Declared here so it renders in a section rather than under "Other" — the fallback caught
  // it, which is what the fallback is for. Filed under `act` because changing a threshold acts on
  // the fleet's behaviour rather than reporting on it.
  // D16 APPLIED BY ITS OWNER, 2026-08-23: `settings` is NOT here, because it is no longer a strip
  // tab — it configures the fleet (sweep hang/kill thresholds, cadence overrides) and now lives in
  // the ≡ menu beside projects and profile. A TAB_GROUPS entry for a non-tab grades nothing, which
  // is what the guard below refuses.
  cra:'act',
  // `perf` acts on the fleet's behaviour (which lanes run, and how hard) rather than reporting on
  // it, so it files beside the other levers rather than with the evidence lanes it governs.
  perf:'act',
  // what we KNOW about a finding, and why we do not know more
  determinations:'static',
  // longer than this sweep
  timeline:'history', modmap:'history',
});
const GROUP_ORDER=['overview','surface','secrets','static','deps','dynamic','lint','types','quality','act','history'];
// ONE WORD EACH, because the strip is now a NAVBAR and nine labels share one line with the brand,
// the project picker and the run controls. `Static Testing` and `Dynamic Testing` were the two that
// spent the width, and neither word was carrying the distinction — what separates them is "reads the
// code" against "needs something running", which no adjective fits and GROUP_TITLE already says in
// full. Same rule the tabs below follow: the label is one line, the gloss is title=.
const GROUP_LABEL={overview:'Overview',surface:'Surface',secrets:'Secrets',
  static:'Static',deps:'Deps',dynamic:'Dynamic',lint:'Lint',types:'Types',quality:'Quality',
  act:'Remediation',history:'History',ungrouped:'Other'};
const GROUP_TITLE={
  overview:'what is true right now for the selected project',
  surface:'what exists, and which of it is reachable from outside',
  secrets:'credentials: held on this box, leaked into the working tree, or left in committed history',
  static:'lanes that read the code without running it',
  deps:'what the tree pulls in, and from whom',
  quality:'not vulnerabilities — readability, unfinished work, standards conformance. Excluded from the security headline on purpose.',
  lint:'is this idiomatic and safe by pattern — linters only, and every lane here is non-additive: a finding cannot reach the severity headline, so a lint-clean repo earns no green SAST row',
  types:'do the types hold — compile-time type checking, a different question from any pattern match and one a clean linter must not be read as answering',
  dynamic:'lanes that need something running to answer — a live URL or a target',
  act:'the work: remediation plan, issue tracker, delivery gates',
  history:'what spans more than the current sweep',
  ungrouped:'tabs with no declared section — they are shown here rather than hidden, which means TAB_GROUPS needs a line adding',
};
// hasOwnProperty, not `TAB_GROUPS[v]||…`: the `||` form resolved `constructor`, `toString` and
// `__proto__` to INHERITED members, which are truthy, so groupOf returned a function instead of a
// section name and every downstream comparison silently misbehaved. Same closed-set discipline as
// checkForScanner() in monitor/scanner-checks.mjs — and the same reason: a lookup whose miss path
// can return something other than the declared fallback is not a closed set.
// Two maps, deliberately: TAB_GROUPS is the hand-written strip's declaration and stays frozen;
// TAB_GROUPS_EXTRA holds placements for tabs this page GENERATED. Merging them would make a derived
// placement indistinguishable from a declared one, and the difference is exactly what a reader
// auditing an unfamiliar tab needs.
const groupOf=(v)=>Object.prototype.hasOwnProperty.call(TAB_GROUPS,v)?TAB_GROUPS[v]
  :(Object.prototype.hasOwnProperty.call(TAB_GROUPS_EXTRA,v)?TAB_GROUPS_EXTRA[v]:'ungrouped');
let curGroup=groupOf(curView);

/** Live tabs, in DOM order, bucketed by section. Read from the DOM so a tab added by any session
 *  is picked up without this code being told about it. */
function tabsByGroup(){
  const out=new Map();
  for(const b of document.querySelectorAll('#views .vtab')){
    const g=groupOf(b.dataset.v);
    if(!out.has(g))out.set(g,[]);
    out.get(g).push(b);
  }
  return out;
}

// A badge counts CHECKS CARRYING FINDINGS, then their summed findings: `n(total)`. A sum alone
// lets one noisy check bury an incident in another. Unknown is excluded rather than counted as
// zero, and where nothing is known the badge says nothing.
function badgeModel(tabs){
  const known=tabs.map(t=>t.querySelector('.vn')).filter(n=>n&&n.textContent.trim()!=='');
  const carrying=known.filter(n=>Number(n.textContent.trim())>0).length;
  const sum=known.reduce((a,n)=>a+(Number(n.textContent.trim())||0),0);
  const crit=known.some(n=>n.classList.contains('crit'));
  return {text:known.length?`${carrying}(${sum})`:'',crit,warn:!crit&&carrying>0,
    title:known.length
      ?`${carrying} of ${known.length} checks with a result carry findings · ${sum} finding(s) in total across them`
      :'nothing known about these checks yet'};
}
function setNavBadge(el,tabs){
  const m=badgeModel(tabs);
  let vn=el.querySelector('.vn');
  if(!vn){vn=document.createElement('span');vn.className='vn';el.appendChild(vn);}
  vn.textContent=m.text;
  vn.classList.toggle('crit',m.crit);
  vn.classList.toggle('warn',m.warn);
  el.title=m.title;
}
// A tab with no counter at all is a page, not a check: it never says "no result yet".
function pickerLabel(tab){
  const label=tab.childNodes[0]?.textContent.trim()||tab.dataset.v;
  const vn=tab.querySelector('.vn'); if(!vn)return label;
  const txt=vn.textContent.trim();
  if(txt==='')return `${label} — no result yet`;
  return Number.isNaN(Number(txt))?label:`${label} — ${Number(txt)}`;
}
// Option text is written in place rather than through innerHTML: rebuilding the select on a count
// change would close it under a reader who has it open.
function refreshGroupBadges(){
  const findings=navigationTabs().filter(t=>workspaceOf(t.dataset.v)==='findings');
  const rail=document.querySelector('[data-workspace="findings"]');
  if(rail)setNavBadge(rail,findings);
  document.querySelectorAll('#groups [data-category]').forEach(b=>
    setNavBadge(b,findings.filter(t=>b.dataset.category==='all'||findingCategory(t.dataset.v)===b.dataset.category)));
  const picker=$('check-picker');
  if(picker)for(const o of picker.options){
    const tab=findings.find(t=>t.dataset.v===o.value); if(tab)o.textContent=pickerLabel(tab);
  }
}

// Primary sections describe tasks. Scanner groups remain the legacy route vocabulary.
// WORKSPACE_LABELS are the PROJECT section's tasks; the All-projects section is one workspace
// (`fleet`) entered from fixed rail links, so no per-project task ever lists a fleet page.
const WORKSPACE_LABELS={summary:'Summary',findings:'Findings',surface:'Websites & services',map:'Site map',work:'Work',history:'History'};
const FINDING_LABELS={all:'All findings',security:'Security risks',quality:'Code quality',accessibility:'Accessibility',other:'Other checks'};
const NAV_LABELS={secrets:'Exposed credentials',static:'Code security',deps:'Dependencies',dynamic:'Running services',lint:'Code conventions',types:'Type checks',quality:'Code quality',other:'Other checks',ungrouped:'Other checks'};
const WORKSPACE_DEFAULTS={summary:'overview',findings:'allfindings',surface:'exposure',map:'sitemap',work:'remediation',history:'timeline'};
function workspaceOf(v){
  if(['profile','settings','perf','held','journey'].includes(v))return 'manage';
  if(scopeOf(v)==='fleet')return 'fleet';
  if(v==='sitemap')return 'map';
  if(['exposure','vendor'].includes(v))return 'surface';
  if(['report','timeline'].includes(v))return 'history';
  if(['remediation','issues','daily','delivery','modmap'].includes(v))return 'work';
  if(['overview','dashboard','lanes','posture'].includes(v))return 'summary';
  return 'findings';
}
function findingCategory(v){
  if(v==='allfindings')return 'all';
  if(v==='a11y'||v==='accessibility')return 'accessibility';
  const g=groupOf(v);
  if(['lint','types','quality'].includes(g))return 'quality';
  return ['secrets','static','deps','dynamic'].includes(g)?'security':'other';
}
// A view whose experimental flag is off is not navigation (admin/static/features.js).
function navigationTabs(){return [...document.querySelectorAll('#views .vtab')].filter(b=>!(typeof featureOffFlag==='function'&&featureOffFlag(b.dataset.v)));}
function railFocusables(){
  return [...$('workspace-rail').querySelectorAll('a[href],button:not([disabled]),summary,select')].filter(el=>el.offsetParent!==null);
}
function openWorkspaceRail(){
  document.body.classList.add('rail-open');
  $('nav-toggle').setAttribute('aria-expanded','true');
  $('workspace-content').setAttribute('inert','');
  ($('workspace-rail').querySelector('[aria-current]')||railFocusables()[0])?.focus();
}
function closeWorkspaceRail({restoreFocus=false}={}){
  document.body.classList.remove('rail-open');
  $('nav-toggle').setAttribute('aria-expanded','false');
  $('workspace-content').removeAttribute('inert');
  if(restoreFocus)$('nav-toggle').focus();
}
function navigateWorkspace(v,{keepFocus=false}={}){
  closeWorkspaceRail();setView(v);
  if(!keepFocus)$('workspace-content').focus({preventScroll:true});
}
function clearAccountSecrets(){
  document.querySelectorAll('.account-security-controls input[type="password"]').forEach(el=>{el.value='';});
  const codes=$('pw-codes-list');if(codes)codes.textContent='';
  const once=$('pw-codes');if(once)once.classList.add('jshide');
}
function renderGroups(){
  const nav=$('workspace-nav');if(!nav)return;
  nav.innerHTML=Object.entries(WORKSPACE_LABELS).map(([id,label])=>`<button type="button" class="workspace-link" data-workspace="${id}">${label}</button>`).join('');
  nav.querySelectorAll('[data-workspace]').forEach(b=>b.onclick=()=>{
    if(curProj)navigateWorkspace(WORKSPACE_DEFAULTS[b.dataset.workspace]);
  });
  applyGroup(curView);
}
// The header states the scope of the page under it, and every control in it acts on that scope or
// names what it acts on instead. The picker used to sit here as a global while half the pages
// ignored it, so "commitwork" was selected above fleet totals.
function syncScopeChrome(v){
  const scope=scopeOf(v),chip=$('scope-chip');
  if(chip){
    chip.dataset.scope=scope;
    chip.textContent=scope==='fleet'?'All projects':scope==='account'?'Your account':(curProj?'Project · '+curProj:'No project selected');
    chip.title=scope==='fleet'?'this page covers every project; the project picker does not apply to it'
      :scope==='account'?'your own account settings':'this page covers the selected project only';
  }
  renderGen();
  const sweep=$('sweep');
  if(sweep){
    // A running sweep keeps its stop control on every page; otherwise the run control exists only
    // where a project is in scope, and says which one it will run.
    sweep.hidden=!sweepRunningNow&&!(scope==='project'&&curProj);
    if(!sweepRunningNow){sweep.textContent=sweepIdleLabel()+(sweepLastStopped?' (last: STOPPED)':'');sweep.title=curProj?'run every check for '+curProj:'';}
  }
  const bar=$('healthbar');
  if(bar&&!bar.classList.contains('jshide'))bar.style.display=scope==='project'?'block':'none';
  for(const id of ['health','hb-run']){
    const b=$(id);if(!b)continue;
    b.title=curProj?'build-health refresh for '+curProj+' (unused code, toolchain, result origin, release checks) into its latest results — does not start a new scan':'choose a project first — a healthcheck runs for one project';
    if(id==='health')b.disabled=!curProj;
  }
}
function applyGroup(v){
  if(typeof featureMarkNav==='function')featureMarkNav();
  curGroup=groupOf(v);
  const workspace=workspaceOf(v),category=findingCategory(v),tabs=navigationTabs(),scope=scopeOf(v);
  for(const b of tabs){
    b.classList.toggle('ghide',workspace==='findings'||workspaceOf(b.dataset.v)!==workspace||workspace==='manage');
    if(b.dataset.v===v)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  }
  document.querySelectorAll('[data-workspace]').forEach(b=>{
    const active=b.dataset.workspace===workspace;b.classList.toggle('active',active);
    if(active)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');
    b.disabled=!curProj;b.title=curProj?'':'choose a project above first';
  });
  document.querySelectorAll('[data-scope-head]').forEach(h=>h.classList.toggle('active',h.dataset.scopeHead===scope));
  document.querySelectorAll('[data-route]').forEach(b=>{
    const active=b.dataset.route===v;b.classList.toggle('active',active);
    if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  });
  const nav=$('groups');
  const available=new Set(tabs.filter(b=>workspaceOf(b.dataset.v)==='findings').map(b=>findingCategory(b.dataset.v)));
  const categoryMarkup=workspace==='findings'?Object.entries(FINDING_LABELS).filter(([id])=>available.has(id)).map(([id,label])=>`<button type="button" class="gtab${id===category?' pri':''}" data-category="${id}"${id===category?' aria-current="true"':''}>${label}</button>`).join(''):'';
  // Polls must not replace focused controls or close the native check picker.
  if(nav.innerHTML!==categoryMarkup){
    nav.innerHTML=categoryMarkup;
    nav.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{
      const candidates=navigationTabs().filter(t=>workspaceOf(t.dataset.v)==='findings'&&findingCategory(t.dataset.v)===b.dataset.category);
      const first=candidates.find(t=>t.dataset.v==='sast')||candidates[0];if(first)navigateWorkspace(first.dataset.v);
    });
  }
  nav.hidden=workspace!=='findings';
  const picker=$('check-picker');$('check-picker-row').hidden=workspace!=='findings'||category==='all';
  if(workspace==='findings'){
    const groups=new Map();
    for(const b of tabs.filter(t=>workspaceOf(t.dataset.v)==='findings'&&findingCategory(t.dataset.v)===category)){
      const g=groupOf(b.dataset.v);if(!groups.has(g))groups.set(g,[]);groups.get(g).push(b);
    }
    const markup=[...groups].map(([g,bs])=>`<optgroup label="${esc(NAV_LABELS[g]||'Other checks')}">${bs.map(b=>`<option value="${esc(b.dataset.v)}">${esc(b.childNodes[0]?.textContent.trim()||b.dataset.v)}</option>`).join('')}</optgroup>`).join('');
    if(picker.innerHTML!==markup)picker.innerHTML=markup;
    if(picker.value!==v)picker.value=v;
  }
  const tab=tabs.find(b=>b.dataset.v===v);
  const title=tab?.childNodes[0]?.textContent.trim()||({projects:'Project list',rollups:'Rollups',remfleet:'Remediation',profile:'Account & security',settings:'Check schedules',perf:'Check configuration',held:'Credentials & connections'}[v])||v;
  const where=scope==='account'?'Your account':scope==='fleet'?'All projects':curProj||'Choose a project';
  const section=workspace==='fleet'?null:(WORKSPACE_LABELS[workspace]||'Manage');
  $('workspace-location').textContent=[where,section,workspace==='findings'?FINDING_LABELS[category]:null,title].filter(Boolean).filter((s,i,a)=>s!==a[i-1]).join(' / ');
  const help={fleet:'Every project at once: coverage, scans, decisions and deadlines. Choosing a project opens its own pages.',summary:'See what needs attention in this project, when its checks last ran, and where coverage is missing.',surface:'Inspect this project\'s exposed services and third-party assets.',map:'Explore this project as a 3-D site map: its services, files and wiring, and where known vulnerabilities sit.',work:'Plan fixes and assign work for this project. A reviewed issue is not necessarily fixed.',history:'See this project\'s previous checks and evidence reports.',manage:'Manage service settings or your account. Changes here affect how the service operates.'};
  $('workspace-help').textContent=workspace==='findings'?({all:'Every open finding for this project in one list, most severe first. Open a check to act on its findings.',security:'Potential weaknesses in code, dependencies or running services. Select a check to review its evidence; a finding is not proof of an incident.',quality:'Readability, unfinished work and coding checks. These results are separate from security risks.',accessibility:'Find barriers that may prevent people from using your site. Automated checks cover only part of accessibility.',other:'Checks awaiting classification. They remain available here so new evidence is never hidden.'}[category]):help[workspace];
  refreshGroupBadges();
  syncScopeChrome(v);
}
// Arrow keys fire `change` on a closed select in some browsers, so choosing a check must not
// throw focus out of the control the reader is still using.
$('check-picker').onchange=e=>navigateWorkspace(e.target.value,{keepFocus:true});
document.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>navigateWorkspace(b.dataset.route));
$('nav-toggle').onclick=()=>document.body.classList.contains('rail-open')?closeWorkspaceRail():openWorkspaceRail();
document.addEventListener('keydown',e=>{
  if(!document.body.classList.contains('rail-open'))return;
  if(e.key==='Escape'){e.preventDefault();closeWorkspaceRail({restoreFocus:true});return;}
  if(e.key!=='Tab')return;
  // Stepped by hand: the opener lives in the header, so native Tab order would leave it for the
  // controls behind the drawer instead of entering the rail.
  const ring=[$('nav-toggle'),...railFocusables()], at=ring.indexOf(document.activeElement);
  e.preventDefault();
  ring[(at+(e.shiftKey?-1:1)+ring.length)%ring.length].focus();
});
document.addEventListener('click',e=>{
  if(document.body.classList.contains('rail-open')&&!e.target.closest('#workspace-rail,#nav-toggle'))closeWorkspaceRail();
});
// `inert` must never outlive the drawer: widening to desktop while it is open would strand it.
matchMedia('(min-width:801px)').addEventListener('change',e=>{if(e.matches)closeWorkspaceRail();});
renderGroups();
