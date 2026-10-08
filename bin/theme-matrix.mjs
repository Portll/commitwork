#!/usr/bin/env node
// bin/theme-matrix.mjs — the panel across colour schemes and viewports, every cell measured.
//
// The assumptions a site carries — a nav, dark/light, @media breakpoints, forced-colors — are a
// COMBINATORIAL surface, and stating them is not testing them. Nothing here can be asserted from a
// route: whether text survives a theme, whether a layout overflows at 375px, whether a nav is
// reachable at all once the viewport narrows.
//
// Every cell is measured or reported UNTESTED. A cell that could not run is grey, never a pass.
//
// exit: 0 every cell clean · 1 a defect in a cell · 3 GREY (no browser, or a cell unmeasured)
//       4 panel did not boot

import { findChrome, withBrowser, newPage } from '../lib/cdp.mjs';
import { startPanel } from '../lib/panel-session.mjs';

const SCHEMES = [
  { key: 'light', colorScheme: 'light' },
  { key: 'dark', colorScheme: 'dark' },
  { key: 'forced-colors', colorScheme: 'light', forcedColors: 'active' },
];
const VIEWPORTS = [
  { key: 'mobile', width: 375, height: 812, mobile: true },
  { key: 'tablet', width: 834, height: 1112, mobile: true },
  { key: 'desktop', width: 1440, height: 900, mobile: false },
];

const ok = (m) => process.stdout.write(`✔ ${m}\n`);
const bad = (m) => { process.stdout.write(`✖ ${m}\n`); return 1; };

// Text the same colour as what it sits on. The classic theme defect, and invisible to every check
// that reads markup rather than computed style.
const PROBE = `(() => {
  const parse = (c) => (c.match(/[\\d.]+/g) || []).map(Number);
  const lum = (rgb) => {
    const [r, g, b] = rgb.slice(0, 3).map((v) => {
      const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const bgOf = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const p = parse(c);
      if (p.length >= 3 && (p[3] === undefined || p[3] > 0.1)) return p;
    }
    return parse(getComputedStyle(document.body).backgroundColor);
  };
  let checked = 0; const invisible = [];
  for (const el of document.querySelectorAll('h1,h2,h3,p,td,th,li,a,button,span,label')) {
    if (el.children.length) continue;
    const t = (el.textContent || '').trim();
    if (!t || el.offsetParent === null) continue;
    const st = getComputedStyle(el);
    const fg = parse(st.color);
    if (fg.length < 3) continue;
    if (fg[3] !== undefined && fg[3] < 0.1) continue;
    const bg = bgOf(el);
    if (bg.length < 3) continue;
    checked++;
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (ratio < 1.3) invisible.push({ tag: el.tagName, text: t.slice(0, 40), ratio: Math.round(ratio * 100) / 100 });
  }
  const de = document.documentElement;
  return {
    checked,
    invisible: invisible.slice(0, 5),
    invisibleCount: invisible.length,
    overflowPx: Math.max(0, de.scrollWidth - de.clientWidth),
    navReachable: !!document.querySelector('.gtab, .vtab, nav a, [role=tab]'),
    bodyLen: document.body ? document.body.innerText.length : -1,
  };
})()`;

const chrome = findChrome();
if (chrome.unavailable) {
  process.stderr.write(`theme-matrix: GREY — ${chrome.unavailable}. Not a pass.\n`);
  process.exit(3);
}

const panel = await startPanel();
if (panel.unavailable) {
  process.stderr.write(`theme-matrix: ${panel.unavailable}\n`);
  process.exit(4);
}

let failures = 0;
let untested = 0;
const run = await withBrowser(async (conn) => {
  const p = await newPage(conn);
  await p.selfWitness();
  await p.setCookie(panel.cookie);

  // IN-BAND NEGATIVE CONTROL. Nine clean cells on the first run is also what a probe that cannot
  // fail produces. Plant a known-invisible element and a known overflow, and refuse to report the
  // matrix at all unless the probe catches both.
  await p.setViewport(VIEWPORTS[2]);
  await p.goto(`${panel.origin}/`);
  await new Promise((r) => setTimeout(r, 800));
  const control = await p.evaluate(`(() => {
    const d = document.createElement('div');
    d.id = 'cw-probe-control';
    d.style.cssText = 'background:#123456;padding:4px';
    d.innerHTML = '<span style="color:#123456">invisible control text</span>';
    document.body.appendChild(d);
    const w = document.createElement('div');
    w.id = 'cw-probe-overflow';
    w.style.cssText = 'width:' + (window.innerWidth + 500) + 'px;height:2px';
    document.body.appendChild(w);
    return true;
  })()`);
  const controlRead = control ? await p.evaluate(PROBE) : null;
  await p.evaluate(`(() => { for (const id of ['cw-probe-control', 'cw-probe-overflow']) {
    const e = document.getElementById(id); if (e) e.remove();
  } return true; })()`);
  if (!controlRead || !controlRead.invisibleCount || controlRead.overflowPx <= 0) {
    return { controlFailed: true, controlRead };
  }
  ok(`probe proved it can fail: caught ${controlRead.invisibleCount} invisible element(s)`
    + ` and ${controlRead.overflowPx}px planted overflow`);

  const rows = [];
  for (const s of SCHEMES) {
    for (const v of VIEWPORTS) {
      const cell = `${s.key}/${v.key}`;
      try {
        await p.setViewport(v);
        await p.setMedia({ colorScheme: s.colorScheme, forcedColors: s.forcedColors || null });
        const nav = await p.goto(`${panel.origin}/`);
        if (!nav.loaded) { untested++; rows.push({ cell, state: 'UNTESTED', why: 'load event never fired' }); continue; }
        await new Promise((r) => setTimeout(r, 900));
        const m = await p.evaluate(PROBE);
        // A probe that examined nothing has measured nothing — not a clean cell.
        if (!m.checked) { untested++; rows.push({ cell, state: 'UNTESTED', why: 'probe examined 0 elements' }); continue; }
        const problems = [];
        if (m.invisibleCount) problems.push(`${m.invisibleCount} element(s) at contrast < 1.3:1 (${m.invisible.map((i) => `<${i.tag.toLowerCase()}>"${i.text}" ${i.ratio}:1`).join('; ')})`);
        if (m.overflowPx > 0) problems.push(`${m.overflowPx}px horizontal overflow`);
        if (!m.navReachable) problems.push('no nav element reachable');
        if (m.bodyLen <= 0) problems.push('body rendered no text');
        rows.push({ cell, state: problems.length ? 'FAIL' : 'PASS', checked: m.checked, problems });
      } catch (e) {
        untested++; rows.push({ cell, state: 'UNTESTED', why: String(e.message || e).slice(0, 90) });
      }
    }
  }
  return rows;
});

panel.stop();
if (run.unavailable) { process.stderr.write(`theme-matrix: GREY — ${run.unavailable}\n`); process.exit(3); }
if (run.result?.controlFailed) {
  process.stderr.write('theme-matrix: GREY — the probe did not catch its own planted defects'
    + ` (${JSON.stringify(run.result.controlRead)}). Every cell below it would be a clean reading`
    + ' from an instrument that cannot see, so no matrix is reported.\n');
  process.exit(3);
}

for (const r of run.result) {
  if (r.state === 'PASS') ok(`${r.cell.padEnd(22)} ${r.checked} element(s) checked`);
  else if (r.state === 'UNTESTED') process.stdout.write(`⚪ ${r.cell.padEnd(22)} UNTESTED — ${r.why}\n`);
  else { failures += bad(`${r.cell.padEnd(22)} ${r.problems.join(' · ')}`); }
}

const total = SCHEMES.length * VIEWPORTS.length;
process.stdout.write(`\n${run.result.filter((r) => r.state === 'PASS').length}/${total} cell(s) clean`
  + `${failures ? `, ${failures} with defects` : ''}${untested ? `, ${untested} UNTESTED` : ''}\n`);
if (failures) process.exit(1);
if (untested) { process.stderr.write('theme-matrix: GREY — an unmeasured cell is not a clean one\n'); process.exit(3); }
process.exit(0);
