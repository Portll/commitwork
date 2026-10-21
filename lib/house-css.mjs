// lib/house-css.mjs — the house stylesheet for pages outside the panel shell (docs/THEME.md §11):
// the palette on :root (light) and html[data-mode=dark], the IBM Plex faces, and the base elements.
// A page keeps only its own layout rules, written against these tokens.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIGHT, DARK, LIGHT_SEMANTIC, DARK_SEMANTIC, MONO, SANS } from './brand-tokens.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

const fontsDir = () => process.env.CW_FONTS_DIR || join(REPO, 'admin', 'static', 'fonts');

export const HOUSE_TOKEN_NAMES = Object.freeze([
  'bg', 'panel', 'panel2', 'line', 'line2', 'head', 'ink', 'mut', 'dim', 'acc', 'acc2', 'wash',
  'live', 'part', 'plan', 'crit', 'high', 'med', 'low', 'sev', 'sev-fill', 'done', 'done-fill',
  'machine', 'attest', 'on-acc',
]);

// brand-tokens.mjs names the panel's --live `ok`; --done and --done-fill are --sev's values under
// a lifecycle name (THEME.md §3.5).
function theme(base, semantic, label) {
  const t = { ...base, ...semantic, live: base.ok, done: base.sev, 'done-fill': semantic['sev-fill'] };
  return Object.fromEntries(HOUSE_TOKEN_NAMES.map((n) => {
    if (typeof t[n] !== 'string' || !t[n]) throw new Error(`house-css: lib/brand-tokens.mjs has no ${label} value for --${n}`);
    return [n, t[n]];
  }));
}

export function houseTokenValues() {
  return {
    light: theme(LIGHT, LIGHT_SEMANTIC, 'light'),
    dark: theme(DARK, DARK_SEMANTIC, 'dark'),
    mono: `"IBM Plex Mono",${MONO}`,
    sans: `"IBM Plex Sans",${SANS}`,
  };
}

// The CRA reporting clocks ride the severity ramp, so each theme re-grades them with it (THEME.md §3.4).
const CRA_CLOCKS = '--cra-50:var(--low);--cra-75:var(--med);--cra-90:var(--high);--cra-over:var(--crit)';

const decls = (t) => HOUSE_TOKEN_NAMES.map((n) => `--${n}:${t[n]}`).join(';');

export function houseTokens() {
  const { light, dark, mono, sans } = houseTokenValues();
  return [
    `:root{${decls(light)};${CRA_CLOCKS};--mono:${mono};--sans:${sans};color-scheme:light}`,
    `html[data-mode=dark]{${decls(dark)};color-scheme:dark}`,
    `@media (prefers-color-scheme:dark){html:not([data-mode]){${decls(dark)};color-scheme:dark}}`,
  ].join('\n');
}

const UNICODE_RANGE = 'U+0000-00FF,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

export const HOUSE_FACES = Object.freeze([
  { key: 'sans', family: 'IBM Plex Sans', style: 'normal', weight: 400, file: 'IBMPlexSans-Regular-Latin1.woff2' },
  { key: 'sans', family: 'IBM Plex Sans', style: 'italic', weight: 400, file: 'IBMPlexSans-Italic-Latin1.woff2' },
  { key: 'sans', family: 'IBM Plex Sans', style: 'normal', weight: 500, file: 'IBMPlexSans-Medium-Latin1.woff2' },
  { key: 'sans', family: 'IBM Plex Sans', style: 'normal', weight: 600, file: 'IBMPlexSans-SemiBold-Latin1.woff2' },
  { key: 'sans', family: 'IBM Plex Sans', style: 'normal', weight: 700, file: 'IBMPlexSans-Bold-Latin1.woff2' },
  { key: 'mono', family: 'IBM Plex Mono', style: 'normal', weight: 400, file: 'IBMPlexMono-Regular-Latin1.woff2' },
  { key: 'mono', family: 'IBM Plex Mono', style: 'normal', weight: 600, file: 'IBMPlexMono-SemiBold-Latin1.woff2' },
  { key: 'mono', family: 'IBM Plex Mono', style: 'normal', weight: 700, file: 'IBMPlexMono-Bold-Latin1.woff2' },
].map(Object.freeze));

export const FONT_MODES = Object.freeze(['served', 'inline', 'none']);

const faceId = (f) => (f.style === 'italic' ? 'italic' : f.weight);

// weights: { sans: [400, 'italic', 600], mono: [400] } takes those faces only; a family left out
// takes none. Omitted entirely, every face ships.
export function selectFaces(weights) {
  if (weights === undefined) return HOUSE_FACES;
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) {
    throw new TypeError('house-css: weights must be an object such as { sans: [400, 600], mono: [400] }');
  }
  for (const [key, list] of Object.entries(weights)) {
    if (!HOUSE_FACES.some((f) => f.key === key)) throw new RangeError(`house-css: unknown font family "${key}" (expected sans or mono)`);
    if (!Array.isArray(list)) throw new TypeError(`house-css: weights.${key} must be an array`);
    for (const w of list) {
      if (!HOUSE_FACES.some((f) => f.key === key && faceId(f) === w)) {
        throw new RangeError(`house-css: IBM Plex ${key} ships no ${JSON.stringify(w)} face`);
      }
    }
  }
  return HOUSE_FACES.filter((f) => (weights[f.key] || []).includes(faceId(f)));
}

const WOFF2_MAGIC = 'wOF2';

function inlineSrc(face, dir) {
  let bytes;
  try {
    bytes = readFileSync(join(dir, face.file));
  } catch (e) {
    const err = new Error(`house-css: cannot inline ${face.file} from ${dir}: ${e.code || e.message}`, { cause: e });
    err.code = e.code;
    throw err;
  }
  if (bytes.subarray(0, 4).toString('latin1') !== WOFF2_MAGIC) {
    throw new Error(`house-css: ${join(dir, face.file)} is not a woff2 file`);
  }
  return `url("data:font/woff2;base64,${bytes.toString('base64')}") format("woff2")`;
}

// The OFL requires its notice to accompany every copy of the fonts, and an inlined face is a copy
// that leaves without admin/static/fonts/LICENSE-IBM-Plex.txt.
export const PLEX_NOTICE = '/* IBM Plex Sans and IBM Plex Mono: Copyright © 2017 IBM Corp. with Reserved Font Name "Plex". '
  + 'Licensed under the SIL Open Font License, Version 1.1 (OFL-1.1). */';

export function houseFonts(mode = 'served', { weights } = {}) {
  if (!FONT_MODES.includes(mode)) throw new RangeError(`house-css: fonts must be one of ${FONT_MODES.join(', ')} (got ${JSON.stringify(mode)})`);
  const faces = selectFaces(weights);
  if (mode === 'none') return '';
  const dir = mode === 'inline' ? fontsDir() : null;
  const rules = faces.map((f) => {
    const src = dir ? inlineSrc(f, dir) : `url("/static/fonts/${f.file}") format("woff2")`;
    return `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};font-display:swap;src:${src};unicode-range:${UNICODE_RANGE}}`;
  });
  return (dir && rules.length ? [PLEX_NOTICE, ...rules] : rules).join('\n');
}

export const PILL_VARIANTS = Object.freeze({
  live: 'live', part: 'part', plan: 'plan', crit: 'crit', high: 'high', med: 'med', low: 'low',
  exploited: 'sev', done: 'done', machine: 'machine', attest: 'attest',
});

const mix = (token, pct) => `color-mix(in srgb,var(--${token}) ${pct}%,transparent)`;

// The exploited pill takes --sev-fill, whose weight inverts between themes (THEME.md §3.4).
const pillRule = (cls, token) => `.pill.${cls}{color:var(--${token});`
  + `background:${cls === 'exploited' ? 'var(--sev-fill)' : mix(token, 12)};border-color:${mix(token, 28)}}`
  + `.pill.${cls}::before{background:var(--${token})}`;

// Unknown and not-applicable take no state colour and no fill (THEME.md Rule 7): unknown is dashed,
// n/a is a settled answer and quieter still. The panel draws both the same way (panel.css).
const ABSENCE_PILLS = Object.freeze([
  `.pill.unk{color:var(--mut);background:transparent;border-color:${mix('plan', 28)};border-style:dashed}`,
  `.pill.na{color:var(--plan);background:transparent;border-color:${mix('plan', 28)};opacity:.72}`,
  '.pill.na::before{background:transparent;border:1px solid var(--plan)}',
]);

// The AUTO / LIGHT / DARK control admin/static/theme-switch.js builds into [data-theme-switch]. The
// panel's pages take the same rules from admin/static/panel.css.
export function houseSwitchCss() {
  return [
    '.theme-switch{display:inline-flex;align-items:stretch;border:1px solid var(--line2);border-radius:.25rem;overflow:hidden;flex:none}',
    '.theme-switch[hidden]{display:none}',
    '.theme-switch .theme-opt{font:600 .6875rem var(--mono);letter-spacing:.04em;color:var(--mut);background:transparent;border:0;border-radius:0;padding:.25rem .5rem;cursor:pointer;white-space:nowrap}',
    '.theme-switch .theme-opt+.theme-opt{border-left:1px solid var(--line2)}',
    '.theme-switch .theme-opt:hover{color:var(--ink)}',
    '.theme-switch .theme-opt[aria-checked="true"]{color:var(--ink);background:var(--wash);box-shadow:inset 0 -2px var(--acc)}',
  ].join('\n');
}

export function houseBase() {
  return [
    '*{box-sizing:border-box}',
    'body{margin:0;background:var(--bg);color:var(--ink);font:.9375rem/1.62 var(--sans)}',
    'h1,h2,h3,h4,h5,h6{font-family:var(--sans);font-weight:600;color:var(--head)}',
    'h1{font-size:1.9rem;line-height:1.2;letter-spacing:-.015em;margin:0 0 1rem}',
    'h2{font-size:1.28rem;letter-spacing:-.01em;margin:2.5rem 0 .75rem}',
    'h3{font-size:1.02rem;margin:1.75rem 0 .5rem}',
    'h4,h5,h6{margin:1.25rem 0 .4rem}',
    'h4{font-size:.9375rem}h5{font-size:.78rem}h6{font-size:.63rem}',
    'p{margin:.6rem 0;max-width:84ch}',
    'ul,ol{margin:.6rem 0;padding-left:1.4rem}',
    'li{margin:.25rem 0}',
    'a{color:var(--ink);text-decoration:underline;text-decoration-color:var(--acc);text-underline-offset:.125rem}',
    'a:hover{text-decoration-thickness:.125rem}',
    'code,kbd,samp,pre{font-family:var(--mono)}',
    // max() holds code set inside small text (a th, a pill) at the .625rem floor.
    'code,kbd,samp{font-size:max(.86em,.625rem)}',
    'code{padding:.08em .35em;border-radius:.1875rem;background:var(--panel2);color:var(--head)}',
    'pre{padding:.9rem 1rem;overflow-x:auto;background:var(--panel);border:1px solid var(--line);border-radius:.5rem;font-size:.8125rem;line-height:1.55}',
    'pre code{padding:0;border-radius:0;background:none;color:var(--ink);font:inherit}',
    'table{border-collapse:collapse;font-size:.8125rem}',
    'th{padding:.55rem .8rem;text-align:left;vertical-align:bottom;background:var(--panel2);border-bottom:1px solid var(--line2);color:var(--head);font:600 .6875rem var(--mono);letter-spacing:.08em;text-transform:uppercase}',
    'td{padding:.5rem .8rem;vertical-align:top;border-bottom:1px solid var(--line)}',
    'tbody tr:hover>td:first-child{box-shadow:inset 2px 0 0 var(--acc2)}',
    'hr{margin:2rem 0;border:0;border-top:1px solid var(--line)}',
    'blockquote{margin:.9rem 0;padding:.1rem 1rem;border-left:3px solid var(--acc2);background:var(--wash);color:var(--mut)}',
    ':focus-visible{outline:2px solid var(--acc);outline-offset:2px}',
    '.tnum{font-variant-numeric:tabular-nums}',
    '.pill{display:inline-flex;align-items:center;gap:.3125rem;padding:.125rem .5rem;border:1px solid transparent;border-radius:999px;font-family:var(--mono);font-size:.656rem;font-weight:600;line-height:1.45;white-space:nowrap}',
    '.pill::before{content:"";width:.57em;height:.57em;border-radius:50%}',
    ...Object.entries(PILL_VARIANTS).map(([cls, token]) => pillRule(cls, token)),
    ...ABSENCE_PILLS,
    houseSwitchCss(),
  ].join('\n');
}

export function houseCss({ fonts = 'served', weights } = {}) {
  return [houseFonts(fonts, { weights }), houseTokens(), houseBase()].filter(Boolean).join('\n');
}
