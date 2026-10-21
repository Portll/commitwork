// admin/static/panel-boot.js — part 8 of 8 of the panel client.
//
// the boot: read the URL, enter its view, start the polls. Loaded last; see below.
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

// Requests an early part would start at load are started here instead. The browser runs other tasks
// between two classic scripts while it fetches the next, so a response could land before a later
// part had run, and its continuation would reach a declaration that does not exist yet:
// renderGen() and renderHealth() both call scopeOf(), which admin/menus/navigation.js declares.
// admin/test/panel-boot.test.mjs drains the task queue between scripts to hold this.
//
// The top bar's rollup countdown (panel-core.js).
setInterval(()=>{if(document.visibilityState!=='visible')return;renderGen();
  document.querySelectorAll('[data-countdown]').forEach(el=>{if(el.offsetParent!==null)el.textContent=COUNTDOWN(el.dataset.countdown);});},1000);
setInterval(loadRollupSchedule,60000);
loadRollupSchedule();
// on load, attach to any sweep already in progress (started from another tab or the CLI)
// The same read populates the health panel: it must state where things stand BEFORE anyone
// presses anything, otherwise its resting state is an empty box that means nothing, and a
// healthcheck started from the CLI or another tab would go unmentioned here. The catch renders
// the unreadable state rather than swallowing — this whole read failing is itself a fact.
// attachJobs (panel-posture.js) reads it for the current selection and re-attaches when it changes.
attachJobs();

// Read the URL's project BEFORE the first setView, so load() (which setView triggers) resolves it.
pendingProjSlug=urlProjectSlug();
// ── WHERE A BARE URL LANDS ──────────────────────────────────────────────────────────────────────
// `/` with nothing chosen used to open the Overview, which for a reader with no project selected is
// a posture strip, a prompt and four empty tiles: the panel's front door was the one page it could
// not answer. Fleet answers exactly that reader, so it is the default destination.
//
// ONLY when the URL asks for nothing and no project is remembered. An explicit path (`/codeql/`), a
// section (`/section/deps/`), a legacy `#hash`, a project in the URL, or a stored project all still
// win — this is the fallback for the empty case, not an interception of navigation. The check is
// pathname-based rather than "did urlView() say overview", because `/overview/` is a reader ASKING
// for the Overview and must keep getting it.
const bareUrl=()=>(location.pathname==='/'||location.pathname==='')&&!location.hash&&!location.search;
setView((bareUrl()&&!curProj&&!pendingProjSlug)?'fleet':urlView(),true);
// …and the URL is honoured BOTH ways: hashchange covers the #tabs, popstate covers the path tabs.
// setView writes the same URL it reads and skips writing an identical one, so no loop.
addEventListener('hashchange',()=>{const v=urlView();if(v!==curView)setView(v,true);});
addEventListener('popstate',()=>{
  // Back/forward carries the PROJECT as well as the view; restoring one without the other puts
  // the previous view beside the current project's numbers, which is the attribution error the
  // URL was changed to remove.
  const slug=urlProjectSlug();
  const label=slug?Object.keys(SLUGS||{}).find(k=>SLUGS[k]===slug):null;
  if(label&&label!==curProj){ curProj=label; const ps=$('proj'); if(ps)ps.value=label;
    try{localStorage.setItem('cw-proj',curProj)}catch(_){} load(); }
  const v=urlView(); if(v!==curView)setView(v,true);
});
load(); setInterval(()=>{if($('overview').style.display!=='none')load();}, 8000);
// The fleet page refreshes on its OWN, slower cadence, and only while it is on screen. It is not on
// the 8s poll because it costs far more than /api/state does: the server reads 39 rollups, 39 sweep
// journals and probes an in-flight pid per area to produce it. Polling that every 8 seconds would
// spend most of this box's disk reads on a page nobody is looking at, and the numbers it shows move
// on the timescale of a sweep, not of a tab.
setInterval(()=>{const el=$('view-fleet');if(el&&el.style.display!=='none')loadFleet();}, 30000);
