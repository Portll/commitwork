#!/usr/bin/env node
// bin/panel-smoke.mjs — boot the panel and RENDER it, which bin/smoke.mjs cannot do.
//
// smoke.mjs proves the panel answers 200 with HTML bytes. That is not the same as a page that
// renders: a route test cannot see a template that emitted "undefined", a tab that threw before
// painting, or a state cell that resolved to [object Object]. This drives a real browser.
//
// exit: 0 rendered and clean · 1 a real defect · 3 GREY (no browser — never a pass) · 4 panel
//       did not boot

import { findChrome, withBrowser, newPage } from '../lib/cdp.mjs';
import { startPanel } from '../lib/panel-session.mjs';

const ok = (m) => process.stdout.write(`\u2714 ${m}\n`);
const bad = (m) => { process.stdout.write(`\u2716 ${m}\n`); return 1; };

const chrome = findChrome();
if (chrome.unavailable) {
  process.stderr.write(`panel-smoke: GREY \u2014 ${chrome.unavailable}. Not a pass.\n`);
  process.exit(3);
}

// Boot + bootstrap + TOTP + login live in lib/panel-session.mjs so this file and bin/theme-matrix.mjs
// do not carry two copies of a flow whose CSRF, TOTP-replay and cookie-name steps would diverge.
const panel = await startPanel();
if (panel.unavailable) {
  process.stderr.write(`panel-smoke: ${panel.unavailable}\n${panel.log || ''}\n`);
  process.exit(4);
}
const localPort = panel.localPort;
ok('bootstrapped a throwaway operator and signed in (live users.json untouched)');

let failures = 0;
const run = await withBrowser(async (conn) => {
  const p = await newPage(conn);
  await p.selfWitness();
  ok('driver proved it can read the page before asserting anything about it');

  await p.setCookie(panel.cookie);

  const g = await p.goto(`http://127.0.0.1:${localPort}/`);
  if (!g.loaded) failures += bad('the load event never fired — a timeout is not a render');
  else ok('operator page fired its load event');

  // Hydration is a race: the same page measured 1552 and 2982 characters on consecutive runs.
  // Bounded wait for the project list, and a refusal if it never arrives — never a silent proceed.
  let hydrated = false;
  for (let i = 0; i < 40 && !hydrated; i++) {
    hydrated = await p.evaluate(`(() => {
      const sel = [...document.querySelectorAll('select')]
        .find((x) => [...x.options].some((o) => /select a project/i.test(o.textContent)));
      return !!sel && [...sel.options].filter((o) => o.value && !/select a project/i.test(o.textContent)).length > 0;
    })()`);
    if (!hydrated) await new Promise((r) => setTimeout(r, 250));
  }
  if (!hydrated) failures += bad('the project select never populated within 10s — every tab below would be judged in an empty state');
  else ok('page hydrated (project list populated)');

  const ready = await p.status();
  if (ready !== 'complete') failures += bad(`document.readyState is ${ready}, not complete`);
  else ok('document reached readyState complete');

  const bodyLen = await p.evaluate('document.body ? document.body.innerText.length : -1');
  if (bodyLen <= 0) failures += bad(`the body rendered ${bodyLen} characters — 200 with bytes is not a rendered page`);
  else ok(`body rendered ${bodyLen} characters of text`);

  // A route test cannot see either of these. Both are live failure modes in this repo's record.
  const leaks = await p.evaluate(`(() => {
    const hits = [];
    for (const el of document.querySelectorAll('td,th,span,div,p,li,code,a,button,option')) {
      if (el.children.length) continue;
      const t = (el.textContent || '').trim();
      if (t === '[object Object]' || t === 'undefined' || t === 'NaN') {
        hits.push({ tag: el.tagName, token: t });
      }
    }
    return hits;
  })()`);
  if (leaks.length) failures += bad(`${leaks.length} element(s) rendered a raw token: ${leaks.slice(0, 4).map((l) => `<${l.tag.toLowerCase()}>${l.token}`).join(', ')}`);
  else ok('no element rendered a bare undefined / [object Object] / NaN');

  if (p.errors.length) failures += bad(`${p.errors.length} uncaught page error(s): ${p.errors.slice(0, 3).join(' · ')}`);
  else ok('no uncaught page errors');

  const consoleErrors = p.consoleLines.filter((l) => l.type === 'error');
  if (consoleErrors.length) failures += bad(`${consoleErrors.length} console error(s): ${consoleErrors.slice(0, 3).map((l) => l.text).join(' · ')}`);
  else ok('no console errors');

  // WHICH SURFACE rendered. Unauthenticated, this reaches the sign-in page, and every check above
  // passes over it — "the panel renders clean" would be a true sentence about a login form.
  // Keyed on the signed-in chrome, not on the words "sign in" (which appear in the panel's own
  // markup) and not on [role=tab] (the tab strip is plain buttons — measured, not assumed).
  const surface = await p.evaluate(`(() => {
    if (document.querySelector('#acct-name') || document.querySelector('#menubtn')) return 'panel';
    if (document.querySelector('input[name=password]')) return 'sign-in';
    return 'unknown';
  })()`);
  if (surface !== 'panel') return { surface, tabs: 0, tabsClicked: 0 };

  // EVERY TAB, CLICKED. This is the check no route test can make: a tab that throws while
  // painting still serves 200, and its handler only runs in a browser.
  // A tab judged with no project selected is judged in a state no operator sees: the first run of
  // this tool reported 21 leaked tokens on Remediation, and every one was the unselected state.
  const picked = await p.evaluate(`(() => {
    // The PROJECT select, not the first one on the page — there are four.
    const sel = [...document.querySelectorAll('select')]
      .find((s) => [...s.options].some((o) => /select a project/i.test(o.textContent)));
    if (!sel) return null;
    const opt = [...sel.options].find((o) => o.value && !/select a project/i.test(o.textContent));
    if (!opt) return null;
    sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.textContent.trim();
  })()`);
  if (picked) ok(`selected project "${picked}" — tabs are judged in a state an operator would see`);
  else failures += bad('no project could be selected; every tab below would render an empty state');
  await new Promise((r) => setTimeout(r, 900));

  // THE STRIP IS TWO-LEVEL. #groups .gtab are SECTIONS; #views .vtab are the tabs, and applyGroup()
  // hides every vtab outside the current section on each setView. The eleven names this sweep used
  // to key on (Overview, Surface, Secrets, ...) are the SECTIONS — so it was clicking the section
  // strip and calling it a tab sweep, with a denominator around a tenth of the panel.
  const sections = await p.evaluate(`(() => [...document.querySelectorAll('.gtab')]
    .filter((b) => b.dataset.g).map((b) => b.dataset.g))()`);
  ok(`${sections.length} section(s): ${sections.join(', ')}`);
  if (!sections.length) failures += bad('no sections found — the strip selector is wrong, not the panel empty');

  const isEnv = (t) => /WebGLRenderer|WebGL context/i.test(t);
  const errCount = () => p.errors.filter((e) => !isEnv(e)).length
    + p.consoleLines.filter((l) => l.type === 'error' && !isEnv(l.text)).length;
  const leakCheck = `(() => {
    const hits = [];
    for (const el of document.querySelectorAll('td,th,span,div,p,li,code,a,button,option')) {
      if (el.children.length) continue;
      const t = (el.textContent || '').trim();
      if (t === '[object Object]' || t === 'undefined' || t === 'NaN') hits.push({ tag: el.tagName, token: t });
    }
    return hits;
  })()`;

  let clicked = 0;
  let seenTabs = 0;
  for (const g of sections) {
    const opened = await p.evaluate(`(() => {
      const b = document.querySelector('.gtab[data-g=' + ${JSON.stringify(JSON.stringify(g))} + ']');
      if (!b) return false; b.click(); return true;
    })()`);
    if (!opened) { failures += bad(`section "${g}" could not be opened`); continue; }
    await new Promise((r) => setTimeout(r, 400));
    const tabs = await p.evaluate(`(() => [...document.querySelectorAll('.vtab')]
      .filter((b) => b.dataset.v && b.offsetParent !== null).map((b) => b.dataset.v))()`);
    seenTabs += tabs.length;
    for (const v of tabs) {
      const before = errCount();
      const hit = await p.evaluate(`(() => {
        const b = document.querySelector('.vtab[data-v=' + ${JSON.stringify(JSON.stringify(v))} + ']');
        if (!b || b.offsetParent === null) return false; b.click(); return true;
      })()`);
      if (!hit) continue;
      await new Promise((r) => setTimeout(r, 300));
      if (errCount() > before) failures += bad(`tab "${v}" raised ${errCount() - before} error(s) when opened`);
      const leaked = await p.evaluate(leakCheck);
      if (leaked.length) failures += bad(`tab "${v}" rendered ${leaked.length} raw token(s): ${leaked.slice(0, 3).map((l) => `<${l.tag.toLowerCase()}>${l.token}`).join(', ')}`);
      clicked++;
    }
  }
  ok(`${clicked} tab(s) opened across ${sections.length} section(s) (${seenTabs} visible in total)`);
  if (!clicked) failures += bad('no tab could be opened at all');

  // Overwatch by PATH, not by the strip: every view has a real route and setView calls applyGroup
  // itself, so the section follows the view. Immune to the staleness that made a re-render look
  // like 32 vanished tabs.
  // The overwatch view is ~1.4MB and can outrun a navigation budget. A slow page is UNEXERCISED,
  // never a crash and never a pass.
  let owNav = { loaded: false };
  try { owNav = await p.goto(`http://127.0.0.1:${localPort}/overwatch/`, { waitMs: 20000 }); }
  catch (e) { process.stdout.write(`  \u00b7 overwatch navigation failed: ${String(e.message || e).slice(0, 80)}\n`); }
  // The overwatch view loads its runs table async; reading at a fixed 2s reported 2/4 and 0/4
  // states on a page that renders all eight. Wait for the table, bounded, then assert.
  let owReady = false;
  for (let i = 0; i < 40 && !owReady; i++) {
    owReady = await p.evaluate('document.querySelectorAll("#sb-runs tr").length > 0');
    if (!owReady) await new Promise((r) => setTimeout(r, 250));
  }
  const ow = await p.evaluate(`(() => {
    const t = document.body.innerText;
    // No backslashes: '\\b' inside this template collapses to a BACKSPACE in the page, and the
    // regex then matched nothing while reporting 0/4 as if four states had collapsed.
    const seen = (w) => new RegExp('(^|[^a-z-])' + w + '([^a-z-]|$)', 'i').test(t);
    return {
      reached: !!document.querySelector('.vtab[data-v="overwatch"]'),
      window: ['bound', 'unattributed', 'unknown', 'degraded'].filter(seen),
      sync: ['synced', 'missing', 'unverifiable', 'not-wired'].filter(seen),
    };
  })()`);
  if (!owNav.loaded || !ow.reached || !owReady) {
    const why = !owNav.loaded || !ow.reached ? '/overwatch/ did not resolve'
      : 'the runs table never populated, so the state vocabularies had nothing to render';
    process.stdout.write(`  · overwatch unknown-states UNEXERCISED — ${why}\n`);
  } else {
    // Each vocabulary must render all four DISTINCTLY. If two collapse into one another, the
    // absorbed word stops appearing — which is what makes a presence check a collapse detector.
    const owLeak = await p.evaluate(leakCheck);
    if (owLeak.length) failures += bad(`overwatch rendered ${owLeak.length} raw token(s): ${owLeak.slice(0, 3).map((l) => `<${l.tag.toLowerCase()}>${l.token}`).join(', ')}`);
    if (ow.window.length !== 4) failures += bad(`window attribution shows ${ow.window.length}/4 distinct states (${ow.window.join('/')}) — a missing one has collapsed into another`);
    else ok('window attribution renders all 4 states distinctly: bound/unattributed/unknown/degraded');
    if (ow.sync.length !== 4) failures += bad(`sync points show ${ow.sync.length}/4 distinct states (${ow.sync.join('/')}) — a missing one has collapsed into another`);
    else ok('sync points render all 4 states distinctly: synced/missing/unverifiable/not-wired');
  }

  return { surface, tabs: seenTabs, tabsClicked: clicked };
});

panel.stop();
if (run.unavailable) { process.stderr.write(`panel-smoke: GREY — ${run.unavailable}\n`); process.exit(3); }
if (failures) { process.stdout.write(`\n${failures} check(s) failed\n`); process.exit(1); }

const { surface, tabs } = run.result;
if (surface === 'panel') {
  process.stdout.write(`\npanel surface rendered clean — ${run.result.tabsClicked}/${tabs} tab(s) opened\n`);
  process.exit(0);
}
// The checks above passed. They passed over the SIGN-IN page, and saying "the panel renders
// clean" on that basis is the false-clean this tool exists to catch.
process.stdout.write(`\nthe ${surface} surface rendered clean — the PANEL surface was never reached.\n`);
process.stderr.write(`panel-smoke: GREY — every check above passed over the "${surface}" surface. The`
  + ' panel is UNEXERCISED, which is not the same as clean: sign-in means the session did not take,'
  + ' and unknown means the signed-in chrome never rendered.\n');
process.exit(3);
