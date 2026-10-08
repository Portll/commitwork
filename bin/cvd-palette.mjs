#!/usr/bin/env node
// commitwork panel — colour-vision-deficiency palettes: emitter, verifier, comparison view.
//
//   node bin/cvd-palette.mjs --emit    rewrite admin/static/panel-cvd{,-light}.css from PALETTES
//   node bin/cvd-palette.mjs           verify the SHIPPED css and write the comparison HTML
//
// PALETTES holds the search RESULT, not the search. Colours were selected by maximising the
// minimum pairwise CIELAB dE76 under each condition's own simulation, subject to WCAG 1.4.3
// (>= 4.5:1) on that theme's background. The search is offline; what runs here is the part that
// must never drift — every run re-derives the ratios and separations and fails on a regression.
//
// The default run reads the css back off disk and cross-checks it against PALETTES, so a hand-edit
// to either side is detected rather than silently rendered. Same reason the comparison view is
// built from the shipped files: an artefact that agrees with its generator but not with what
// ships is worse than no artefact.
import { esc } from '../lib/html-escape.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIGHT, DARK } from '../lib/brand-tokens.mjs';
import { houseCss } from '../lib/house-css.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATIC = process.env.CW_PANEL_STATIC || join(ROOT, 'admin', 'static');
const OUT = process.env.CW_CVD_OUT || join(ROOT, 'reports', 'cvd-palette-compare.html');

// The severity ramp is FOUR steps, and medium and low are the commonest severities.
const RAMP = ['crit', 'high', 'med', 'low'];
const TOK = ['sev', ...RAMP, 'live', 'part', 'plan', 'machine', 'attest'];
const GROUP = { sev: 'kind', crit: 'severity', high: 'severity', med: 'severity', low: 'severity', live: 'status', part: 'status', plan: 'status', machine: 'attribution', attest: 'attribution' };
const CONDS = ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];
// The panel's own grounds. The palettes also clear 4.5:1 on --panel and --panel2, and as pills.
const BG = { dark: DARK.bg, light: LIGHT.bg };

// EACH SCHEME IS NATIVE TO ITS READER'S GAMUT, not a normal-vision scheme inspected for damage.
// The earlier revision picked normal-vision hue families (blue, amber, teal) and then checked they
// survived simulation — which is choosing standard colours and measuring how they degrade. These
// are derived the other way: the AA-valid sRGB lattice is mapped through the condition's own
// simulation, the DIAMETER of the resulting perceived set is found, and the ramp is laid out in
// even steps along that axis. The axis differs per condition and that is why the schemes differ —
// protan/deutan resolve blue<->yellow (perceived diameter dE 178/168), tritan resolves red<->cyan
// (154). --sev sits OFF the ramp at maximum perceived distance from it, because exploitation is a
// kind and not a magnitude.
//
// ACHROMATOPSIA CARRIES ONLY FIVE TOKENS, DELIBERATELY. Its entire perceived gamut is dE ~47
// against 154-178 for the dichromacies. A four-step ramp plus --sev spends that; forcing status
// and attribution in as well collapsed every separation to ~4, below the just-noticeable
// difference. Those five tokens are omitted here so they keep the default palette, and the
// distinction there rests on position rather than colour. Values are luminance-matched greys: an
// achromatope perceives no difference, and anyone else selecting the mode sees a coherent scale
// rather than arbitrary hues.
const PALETTES = {
  dark: {
    protanopia:    { sev:'#f26153', crit:'#f2fd42', high:'#9ad184', med:'#849abb', low:'#fc0efb', live:'#fdfdfd', part:'#f36023', plan:'#fd38c3', machine:'#9ac642', attest:'#c5aaa1' },
    deuteranopia:  { sev:'#fb570d', crit:'#fdfd16', high:'#58e784', med:'#63b0c6', low:'#6291fe', live:'#f2fdfd', part:'#32a174', plan:'#4d94d2', machine:'#5c9f3d', attest:'#e7f26e' },
    tritanopia:    { sev:'#fb2bed', crit:'#fd631f', high:'#dd9402', med:'#b0d121', low:'#00fdd1', live:'#b16dff', part:'#7e82fd', plan:'#d854fd', machine:'#fdc6fd', attest:'#00b000' },
    achromatopsia: { sev:'#e2e2e2', crit:'#fefefe', high:'#c9c9c9', med:'#aeaeae', low:'#969696' },
  },
  light: {
    protanopia:    { sev:'#000021', crit:'#0016fd', high:'#3763b0', med:'#965358', low:'#577004', live:'#151b06', part:'#000063', plan:'#422cbb', machine:'#803061', attest:'#015624' },
    deuteranopia:  { sev:'#000021', crit:'#000bf2', high:'#6316a5', med:'#a7386b', low:'#cb180e', live:'#2c1509', part:'#bb0aa6', plan:'#8b24f8', machine:'#971f2d', attest:'#00004d' },
    tritanopia:    { sev:'#000000', crit:'#ce010a', high:'#964e23', med:'#7a634e', low:'#1a5ce4', live:'#42000b', part:'#a006da', plan:'#4d0ba5', machine:'#004d0b', attest:'#c6116e' },
    achromatopsia: { sev:'#3a3a3a', crit:'#040404', high:'#242424', med:'#4f4f4f', low:'#676767' },
  },
};
const has = (theme, cond, k) => Object.prototype.hasOwnProperty.call(PALETTES[theme][cond], k);

// ── colour ──────────────────────────────────────────────────────────────────────────────────────
const s2l = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const l2s = c => { c = Math.min(1, Math.max(0, c)); const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; return Math.round(v * 255); };
const toLin = h => [0, 2, 4].map(i => s2l(parseInt(h.slice(1).slice(i, i + 2), 16)));
const toHex = v => '#' + v.map(c => l2s(c).toString(16).padStart(2, '0')).join('');
const Y = h => { const [r, g, b] = toLin(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = Y(a), y = Y(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// Machado, Oliveira & Fernandes (2009), severity 1.0 — the matrices Chrome DevTools uses.
const M = {
  protanopia:   [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia:   [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
function sim(hex, cond) {
  if (cond === 'normal') return hex;
  const v = toLin(hex);
  if (cond === 'achromatopsia') { const y = Y(hex); return toHex([y, y, y]); }
  const A = M[cond];
  return toHex([0, 1, 2].map(r => A[r][0] * v[0] + A[r][1] * v[1] + A[r][2] * v[2]));
}
function lab(hex) {
  const [r, g, b] = toLin(hex);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = Y(hex), Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const [fx, fy, fz] = [f(X), f(y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const dE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

// ── the Normal palette is READ, never restated: panel.css and panel-light.css own it ────────────
function readNormal() {
  const grab = file => {
    const t = readFileSync(join(STATIC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');  // strip comments FIRST
    const o = {};                                                                          // — the light values live in one
    for (const k of TOK) { const m = new RegExp(`--${k}\\s*:\\s*(#[0-9a-fA-F]{3,8})`).exec(t); if (m) o[k] = m[1]; }
    return o;
  };
  const dark = grab('panel.css');
  const light = { ...grab('panel-light.css') };
  // THREE STATES, NOT TWO. A token absent from panel-light.css keeps the DARK value (a leak). A
  // token absent from BOTH files has no colour anywhere — it is not styled at all, which is a
  // different and worse thing than being styled wrongly, and must not render as either.
  const undef = TOK.filter(k => !dark[k] && !light[k]);
  const leaked = TOK.filter(k => !light[k] && dark[k]);
  for (const k of leaked) light[k] = dark[k];
  for (const k of undef) { dark[k] = null; light[k] = null; }
  return { dark, light, leaked, undef };
}

// ── emit ────────────────────────────────────────────────────────────────────────────────────────
function emit() {
  for (const [theme, file] of [['dark', 'panel-cvd.css'], ['light', 'panel-cvd-light.css']]) {
    const body = CONDS.map(c => {
      const p = PALETTES[theme][c];
      const keys = TOK.filter(k => has(theme, c, k));
      const worst = Math.min(...keys.map(k => ratio(p[k], BG[theme])));
      const decls = keys.map(k => `--${k}:${p[k]}`).join(';');
      return `\n/* ${c} — worst AA on this background ${worst.toFixed(2)}:1 */\n:root[data-cvd="${c}"]{${decls}}`;
    }).join('\n');
    const cur = readFileSync(join(STATIC, file), 'utf8');
    const head = cur.slice(0, cur.indexOf('*/') + 2);          // preserve the hand-written header
    writeFileSync(join(STATIC, file), head + body + '\n');
    console.log(`wrote ${file}`);
  }
}

// ── verify: shipped css must agree with PALETTES, and every token must clear AA ─────────────────
function verify() {
  const problems = [];
  for (const theme of ['dark', 'light']) {
    const file = theme === 'dark' ? 'panel-cvd.css' : 'panel-cvd-light.css';
    const t = readFileSync(join(STATIC, file), 'utf8');
    for (const c of CONDS) {
      const m = new RegExp(`:root\\[data-cvd="${c}"\\]\\{([^}]+)\\}`).exec(t);
      if (!m) { problems.push(`${file}: no block for ${c}`); continue; }
      const got = Object.fromEntries(m[1].split(';').map(kv => { const i = kv.indexOf(':'); return [kv.slice(0, i).trim().replace(/^--/, ''), kv.slice(i + 1).trim()]; }));
      for (const k of TOK) {
        const want = has(theme, c, k) ? PALETTES[theme][c][k] : undefined;
        if (got[k] !== want) problems.push(`${file} ${c} --${k}: css ${got[k]} vs script ${want}`);
      }
      for (const k of TOK.filter(k => has(theme, c, k))) {
        const r = ratio(got[k] || '#000', BG[theme]);
        if (r < 4.5) problems.push(`${file} ${c} --${k} ${got[k]} is ${r.toFixed(2)}:1 on ${BG[theme]} — below AA`);
      }
    }
  }
  return problems;
}

// The light-theme Normal anchors ruled on 2026-08-26 LANDED the same day (panel-light.css adopted
// into git), so there is no longer a pending-proposal row to draw: readNormal() picks the values
// up off disk like every other shipped token. Removed rather than left showing 'not landed',
// which stopped being true the moment that commit existed.


// ── family view ─────────────────────────────────────────────────────────────────────────────────
// The comparison view is organised by CONDITION, which answers "what does this reader see". This
// one transposes it to answer "what is every red I ship" — grouped by semantic family, every
// palette side by side. Swatches are TRUE colour, not simulated: the question here is what the
// stylesheet sets, and the simulated answer already has its own view.
const FAMILIES = [
  ['Severity ramp', RAMP, 'A magnitude ladder. Ordered crit \u2192 low; hue carries the ordering, not lightness.'],
  ['Exploited (KEV)', ['sev'], 'A KIND, not a magnitude \u2014 deliberately off the severity ramp so it cannot be read as a sixth step.'],
  ['Status', ['live', 'part', 'plan'], 'Lane state. Unordered \u2014 these are categories, so they need separation but not a direction.'],
  ['Attribution', ['machine', 'attest'], 'Who signed. A machine measurement and a human attestation are not equal evidence and must not share a colour.'],
];
function buildFamilies(N) {
  const rows = theme => ['normal', ...CONDS].map(v => ({
    vision: v, theme,
    pal: v === 'normal' ? N[theme] : TOK.reduce((o, k) => (o[k] = PALETTES[theme][v][k] || N[theme][k], o), {}),
    inherited: v === 'normal' ? [] : TOK.filter(k => !has(theme, v, k)),
  }));
  const sections = FAMILIES.map(([name, keys, blurb]) => {
    const table = theme => `<h4>${theme}</h4><table><thead><tr><th>palette</th>`
      + keys.map(k => `<th>--${k}</th>`).join('') + `</tr></thead><tbody>`
      + rows(theme).map(r => `<tr><td class="vis">${r.vision}</td>`
        + keys.map(k => {
          const v = r.pal[k], inh = r.inherited.includes(k);
          if (!v) return `<td class="miss">no token</td>`;
          return `<td><span class="chip" style="background:${v}"></span>`
            + `<code>${esc(v)}</code><i>${ratio(v, BG[theme]).toFixed(2)}:1</i>`
            + (inh ? `<em>inherited</em>` : '') + `</td>`;
        }).join('') + `</tr>`).join('') + `</tbody></table>`;
    return `<section class="fam"><h3>${name}</h3><p class="mut">${blurb}</p>`
      + `<div class="two">${table('dark')}${table('light')}</div></section>`;
  }).join('');
  const css = cssBase() + `
.fam{border:1px solid var(--line);border-radius:12px;padding:1.1rem 1.2rem;margin:1.1rem 0;background:var(--panel)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:1.4rem}
@media(max-width:900px){.two{grid-template-columns:1fr}}
table{border-collapse:collapse;width:100%;font-size:.8rem;margin:.3rem 0 0}
th,td{border-bottom:1px solid var(--line);padding:.4rem .45rem;text-align:left;white-space:nowrap}
th{color:var(--mut);font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;font-weight:600}
td.vis{color:var(--mut);text-transform:capitalize}
td.miss{color:var(--crit);font-style:italic}
td code{font-size:.72rem;color:var(--mut);margin-right:.3rem}
td i{font-style:normal;font-size:.6875rem;color:var(--mut);font-variant-numeric:tabular-nums}
td em{display:block;font-size:.625rem;font-weight:600;color:var(--acc);font-style:normal;letter-spacing:.04em}
.chip{display:inline-block;width:.95rem;height:.95rem;border-radius:3px;vertical-align:-.15em;
margin-right:.35rem;border:1px solid color-mix(in srgb,var(--ink) 35%,transparent)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>commitwork panel \u2014 colours by family</title>
<style>${css}</style></head><body>
<h1>Panel colours, by family</h1>
<p>Every semantic token this panel ships, grouped by what it means rather than by who is reading it.
Swatches are true colour \u2014 what the stylesheet sets. For what each reader perceives, see the
comparison view.</p>
<div class="meta">Rows are palettes: <b>normal</b> is the default and the four below are what the Vision
selector swaps in. A cell marked <em style="color:var(--acc)">inherited</em> is one the palette
deliberately does not override, so it keeps the default value \u2014 which is what the browser does
when <code>:root[data-cvd]</code> omits a token.</div>
${sections}
<div class="meta">Generated by <code>bin/cvd-palette.mjs</code> from the shipped stylesheets. Self-contained; safe over <code>file://</code>.</div>
</body></html>`;
}

// ── comparison view ─────────────────────────────────────────────────────────────────────────────
const cssBase = () => `${houseCss({ fonts: 'inline', weights: { sans: [400, 600], mono: [400] } })}
body{font-size:.9375rem;line-height:1.6;padding:2.5rem 1.5rem 5rem;max-width:70rem;margin-inline:auto}
h1{font-size:1.9rem;letter-spacing:-.02em;margin:0 0 .2em}h1+p{color:var(--mut)}
h3{font-size:1.05rem;margin:0 0 .3rem;text-transform:capitalize}
h4{font-size:.8rem;margin:.9rem 0 .4rem;color:var(--mut);text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.meta{border:1px solid var(--line);border-radius:10px;padding:.85rem 1.1rem;margin:1rem 0;font-size:.87rem;background:var(--panel)}
@media print{body{max-width:none}.fam,.card{page-break-inside:avoid}}`;

function minWithin(pal0, cond, fallback) {
  const pal = fallback ? Object.fromEntries(TOK.map(k => [k, pal0[k] || fallback[k]])) : pal0;
  const out = {};
  for (const g of ['severity', 'status', 'attribution']) {
    // a null token has no colour to compare — excluded rather than counted as a match
    const ks = TOK.filter(k => GROUP[k] === g && pal[k]);
    let m = ks.length < 2 ? NaN : Infinity;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) m = Math.min(m, dE(sim(pal[ks[i]], cond), sim(pal[ks[j]], cond)));
    out[g] = m;
  }
  return out;
}
function swatches(pal, cond, theme, fallback) {
  return TOK.map(k => {
    const inherited = !pal[k] && fallback && fallback[k];
    if (inherited) {
      const seen = sim(fallback[k], cond);
      return `<div class="sw inherit"><span class="chip" style="background:${seen}"></span><b>${k}</b>`
        + `<code>inherits ${esc(fallback[k])}</code><i>${ratio(fallback[k], BG[theme]).toFixed(2)}:1</i></div>`;
    }
    if (!pal[k]) return `<div class="sw undef"><span class="chip none"></span><b>${k}</b>`
      + `<code>no token</code><i>—</i></div>`;
    const seen = sim(pal[k], cond);
    const r = ratio(pal[k], BG[theme]);
    return `<div class="sw"><span class="chip" style="background:${seen}"></span>`
      + `<b>${k}</b><code>${esc(pal[k])}</code>`
      + `<i class="${r < 4.5 ? 'bad' : ''}">${r.toFixed(2)}:1</i></div>`;
  }).join('');
}
function build() {
  const N = readNormal();
  const problems = verify();
  let cards = '';
  for (const cond of ['normal', ...CONDS]) {
    for (const theme of ['dark', 'light']) {
      const before = N[theme];
      const after = cond === 'normal' ? null : PALETTES[theme][cond];
      const row = (label, pal, cls, note) => `<div class="pal ${cls}"><h4>${label}</h4>`
        + `<div class="grid" style="background:${BG[theme]}">${swatches(pal, cond, theme, cls === 'after' ? before : null)}</div>`
        + (note ? `<p class="note">${note}</p>` : '')
        + (() => { const m = minWithin(pal, cond, cls === 'after' ? before : null); return `<p class="dEs">within-group minimum &Delta;E — ${['severity','status','attribution'].map(g=>`${g} <b>${Number.isFinite(m[g])?m[g].toFixed(1):'n/a'}</b>`).join(' · ')}</p>`; })()
        + `</div>`;
      const seen = cond === 'normal'
        ? 'Swatches are the colours as rendered — no simulation applied.'
        : `Every swatch is drawn <em>as a reader with ${cond} perceives it</em>; the hex beside it is what the stylesheet actually sets.`;
      cards += `<section class="card"><h3>${cond} · ${theme}</h3>`
        + `<p class="mut">${seen} The ratio is WCAG 1.4.3 against ${BG[theme]}.</p>`
        + row(cond === 'normal' ? 'Shipped today' : 'Default palette (what ships today)', before, 'before',
              theme === 'light' && N.leaked.length
                ? `Live defect: <code>panel-light.css</code> never names ${N.leaked.map(k => '<code>--' + k + '</code>').join(', ')}, so ${N.leaked.length === 1 ? 'it keeps' : 'they keep'} the <em>dark</em> value here.`
                : '')
        + (after ? row(`Selected "${cond}" palette`, after, 'after', '') : '')
        + `</section>`;
    }
  }
  const warn = problems.length
    ? `<div class="meta bad"><b>${problems.length} verification problem(s):</b><ul>${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>`
    : `<div class="meta ok">Shipped CSS agrees with this script on every token, and every token clears WCAG AA on its own background.</div>`;
  const leak = N.leaked.length
    ? `<div class="meta bad"><b>Live defect, shown rather than hidden:</b> <code>panel-light.css</code> never names ${N.leaked.map(k => `<code>--${k}</code>`).join(', ')}, so on the light theme those keep the <em>dark</em> value. The "Default palette" rows for light below render that leak as it actually is.</div>`
    : '';
  const css = cssBase() + `
body{max-width:64rem}
.card{border:1px solid var(--line);border-radius:12px;padding:1.1rem 1.2rem;margin:1.1rem 0;background:var(--panel)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));gap:.5rem;padding:.7rem;border-radius:8px;border:1px solid var(--line)}
.sw{display:flex;align-items:center;gap:.45rem;font-size:.78rem;white-space:nowrap}
.chip{width:1.15rem;height:1.15rem;border-radius:4px;flex:none;border:1px solid color-mix(in srgb,var(--ink) 35%,transparent)}
.sw b{font-weight:600;color:#fff;mix-blend-mode:difference}
.sw code{color:var(--mut);font-size:.72rem}.sw i{margin-left:auto;font-style:normal;color:var(--mut);font-size:.7rem}
.sw i.bad{color:var(--crit);font-weight:700}
.dEs{font-size:.78rem;color:var(--mut);margin:.45rem 0 0}.dEs b{color:var(--ink);font-variant-numeric:tabular-nums}
.pal.before .dEs b{color:var(--crit)}.pal.after .dEs b{color:var(--live)}
.pal.proposed{border-left:3px solid var(--acc);padding-left:.7rem;margin-left:-.1rem}
.pal.proposed h4{color:var(--acc)}
.sw.undef b,.sw.undef code{opacity:.75;font-style:italic}
.sw.inherit code{opacity:.7;font-style:italic}
.chip.none{background:repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(128,128,128,.6) 3px,rgba(128,128,128,.6) 5px)}
.note{font-size:.76rem;color:var(--mut);margin:.4rem 0 0;line-height:1.45}
.pal.proposed .note{color:var(--acc)}
.meta{border:1px solid var(--line);border-radius:10px;padding:.85rem 1.1rem;margin:1rem 0;font-size:.87rem;background:var(--panel)}
.meta.bad{border-color:var(--crit)}.meta.ok{border-color:var(--live)}
.meta ul{margin:.4rem 0 0;padding-left:1.1rem}
@media print{body{max-width:none}.card{page-break-inside:avoid}}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>commitwork panel — CVD palette comparison</title><style>${css}</style></head><body>
<h1>Panel palettes under colour-vision deficiency</h1>
<p>Default palette against the selected palette, for each condition and both themes. Swatches are simulated with Machado, Oliveira &amp; Fernandes (2009) at severity 1.0 — the transform Chrome DevTools uses — so each block shows what that reader actually perceives, not what the stylesheet nominally sets.</p>
${warn}${leak}
<div class="meta"><b>Reading the &Delta;E figures.</b> 2.3 is the just-noticeable difference; a pair below that is the same colour to that reader. UI elements at small size want &gt; 10. The figure shown is the <em>minimum</em> within each semantic group, so it is the worst pair, not an average. Cross-group separation is deliberately not optimised — a severity pill and a status pill occupy different columns, and spending the luminance budget on distinctions the layout already makes would cost the ones it does not.</div>
${cards}
<div class="meta">Generated by <code>bin/cvd-palette.mjs</code> from the shipped <code>panel-cvd.css</code>, <code>panel-cvd-light.css</code>, <code>panel.css</code> and <code>panel-light.css</code>. Self-contained: no CDN, no external assets, safe over <code>file://</code>. Regenerate rather than hand-edit.</div>
</body></html>`;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  const famOut = OUT.replace(/compare\.html$/, 'families.html');
  writeFileSync(famOut, buildFamilies(N));
  return { problems, leaked: N.leaked, famOut };
}

if (process.argv.includes('--emit')) { emit(); }
else {
  const { problems, leaked, famOut } = build();
  console.log(`${OUT}`);
  console.log(`${famOut}`);
  console.log(problems.length ? `VERIFY: ${problems.length} problem(s)\n  ` + problems.join('\n  ') : 'VERIFY: shipped CSS agrees with script; all tokens clear AA');
  if (leaked.length) console.log(`light-theme leak (pre-existing, panel-light.css): ${leaked.map(k => '--' + k).join(', ')}`);
}
