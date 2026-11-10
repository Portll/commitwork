// bin/lib/ui-conformity.mjs — the launchlist's feat.conformity row, measured: where a panel surface
// writes a value the design system already names.
//
// IT READS THE DESIGN SYSTEM, NOT A COPY OF IT. The type steps and the spacing steps come from
// docs/THEME.md's own tables at call time. A checker holding its own copy of the scale drifts from
// the document it is enforcing, and then agrees with itself forever.
//
// AN EXPLAINED DEVIATION IS EXPLAINED IN DATA. A brand mark is literal on purpose (a token would
// recolour the logo with the theme), a QR code must be pure black on white to scan, and a colour
// built from a byte triple cannot be a token. Each of those is an ALLOWED entry with a reason and a
// file, so `unexplained` is a number rather than whatever a grep happened to miss. An allowlist
// entry that matches nothing is itself reported (`staleAllowances`): a reason for a deviation that
// no longer exists is how a budget quietly grows.
//
// WHAT THIS DOES NOT MEASURE, said out loud so the counts are not read as the whole of conformity.
// Keyboard order, focus visibility, empty/error/loading states and contrast are conformity too;
// bin/test/theme-*.test.mjs and the a11y lane hold parts of that. `axes[].measured` is what was
// counted; anything this could not read is in `undetermined`, never folded into a count.
//
// AND THE OFF-SCALE AXIS COVERS INLINE STYLES ONLY, which is a real limit and not an oversight.
// Measured 2026-10-24: the stylesheets hold 68 off-scale `font-size` declarations, and most are not
// defects — docs/THEME.md's own prose declares /config's .71875rem prose step, its 1.1875rem h1 and
// 1.4375rem KPI figure and the docsite's 1.9rem h1, none of which is a row in the §4.3 table, and
// another group (.688, .813, .844) are rounded spellings of .6875, .8125 and .875. Counting those
// against the table alone would report 68 findings of which few are real, which is a descriptive
// signal wearing a verdict's clothes. Widening the axis needs §4.3, the prose exceptions and a
// spelling tolerance read together. Until then it claims only what it measures: a length written
// INLINE, where there is neither a class nor a documented exception to point at.
//
// env, read at CALL time: CW_UIC_ROOT (repo root; tests point it at a fixture)

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..', '..');
export const conformityRoot = () => {
  const v = process.env.CW_UIC_ROOT;
  return resolve(typeof v === 'string' && v !== '' ? v : DEFAULT_ROOT);
};

/** The stylesheets that DEFINE the palette: a literal there is the token's value, not a deviation. */
export const PALETTE_DEFINERS = [
  'admin/static/theme.css', 'admin/static/panel.css', 'admin/static/house.css', 'admin/static/config.css',
  'admin/static/panel-light.css', 'admin/static/panel-cvd.css', 'admin/static/panel-cvd-light.css',
  'admin/static/theme-demo.html',
];

/**
 * Colour literals that are correct as literals. `files` is part of the match so an allowance cannot
 * travel: the same hex somewhere else is still a finding.
 */
export const ALLOWED_COLOURS = [
  {
    id: 'brand-mark',
    values: ['#14161A', '#C9A227'],
    files: ['admin/static/panel-core.js', 'admin/config.html', 'admin/menus/top-bar.html'],
    why: 'the commitwork seal, transcribed once in lib/brand-tokens.mjs and kept in parity by bin/test/brand-tokens-parity.test.mjs — a themed token would recolour the logo with the page',
  },
  {
    id: 'qr-quiet-zone',
    values: ['#000', '#fff'],
    files: ['admin/static/qrcode.mjs'],
    why: 'a QR code is read by a camera, not by a reader: the modules must be pure black on pure white at any theme to decode',
  },
  {
    id: 'cvd-contrast-note',
    values: ['#0f1319', '#f6f7f9'],
    files: ['admin/static/panel-router.js'],
    why: 'the two grounds named in a comment recording which one a palette was graded against; not a painted value',
  },
];

/** The declarations the type scale (§4.3) and the spacing steps (§5.1) govern. */
const GOVERNED = /^(font-size|margin|margin-top|margin-right|margin-bottom|margin-left|padding|padding-top|padding-right|padding-bottom|padding-left|gap|row-gap|column-gap)\s*:/;

/** A colour built at runtime cannot be a token, and is not counted as a literal. */
const COMPUTED_COLOUR = /\brgba?\(\s*\$\{/;
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g;

/**
 * The scale, read from docs/THEME.md. Returns {type:[], space:[]} as strings in rem, or an error.
 * Fails closed: an unreadable or unrecognised THEME.md makes the off-scale axis `undetermined`
 * rather than zero, because "no steps parsed" would clear every finding on that axis.
 */
export function scale({ root = conformityRoot() } = {}) {
  let md;
  try { md = readFileSync(join(root, 'docs/THEME.md'), 'utf8'); }
  catch (e) { return { error: `docs/THEME.md could not be read (${e.code || e.message})` }; }
  const type = [];
  for (const m of md.matchAll(/^\|\s*(?:`\.t-[a-z]+`|body|`\.hd h2`|`\.kpi \.v`)\s*\|\s*(\d*\.?\d+)\s*\|/gm)) type.push(m[1]);
  const spaceLine = md.match(/^`((?:\.?\d[\d.]*\s*·\s*)+\.?[\d.]+)`\s*rem\s*$/m);
  const space = spaceLine ? spaceLine[1].split('·').map((s) => s.trim()) : [];
  if (type.length < 8) return { error: `docs/THEME.md §4.3 yielded only ${type.length} type steps — the table shape has changed` };
  if (space.length < 10) return { error: `docs/THEME.md §5.1 yielded only ${space.length} spacing steps — the list shape has changed` };
  const norm = (s) => String(Number(s));
  return { type, space, all: new Set([...type, ...space].map(norm)), norm };
}

/** Markup and client sources a reader is served. The build artefact admin/index.html is excluded:
 *  a fix there dies at the next `node bin/build-admin-panel.mjs`. */
export function surfaces({ root = conformityRoot() } = {}) {
  const out = [];
  const dir = (rel, test) => {
    let names;
    try { names = readdirSync(join(root, rel)); } catch { return; }
    for (const n of names.sort()) if (test(n)) out.push(`${rel}/${n}`);
  };
  dir('admin/static', (n) => /\.(js|mjs|css|html)$/.test(n));
  dir('admin/menus', (n) => /\.(js|html)$/.test(n));
  out.push('admin/panel.html', 'admin/config.html');
  return out.filter((p) => { try { readFileSync(join(root, p)); return true; } catch { return false; } });
}

/** Every `style="…"` attribute in a served source, with its file and declarations. */
function inlineStyles(root, files) {
  const out = [];
  for (const p of files) {
    const src = readFileSync(join(root, p), 'utf8');
    for (const m of src.matchAll(/style\s*=\s*(["'])((?:(?!\1)[\s\S])*)\1/g)) {
      const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean);
      // `at` is carried because four tags in one file can hold the SAME style text; resolving the
      // element by searching for that text found the first tag four times, and reported three
      // elements' show paths as the first one's.
      if (decls.length) out.push({ file: p, raw: m[2], decls, at: m.index });
    }
  }
  return out;
}

/**
 * Measure every axis.
 * @returns {{axes: object[], undetermined: object[], staleAllowances: object[]}}
 */
export function conformity({ root = conformityRoot(), inventory = null } = {}) {
  const files = surfaces({ root });
  const definers = new Set(PALETTE_DEFINERS);
  const undetermined = [];
  const axes = [];

  // ── colour literals ──
  const colourHits = [];
  const usedAllowance = new Set();
  for (const p of files) {
    if (definers.has(p)) continue;
    const src = readFileSync(join(root, p), 'utf8');
    for (const m of src.matchAll(COLOUR)) {
      const v = m[0];
      const around = src.slice(Math.max(0, m.index - 12), m.index + v.length);
      if (COMPUTED_COLOUR.test(around)) continue;
      const allowed = ALLOWED_COLOURS.find((a) => a.files.includes(p) && a.values.includes(v));
      if (allowed) { usedAllowance.add(allowed.id + '\u0000' + p + '\u0000' + v); continue; }
      colourHits.push({ file: p, value: v });
    }
  }
  axes.push({
    id: 'colour-literal',
    what: 'a colour written as a literal where a token exists',
    measured: colourHits.length,
    hits: colourHits,
    budget: 0,
  });
  const staleAllowances = [];
  for (const a of ALLOWED_COLOURS) {
    for (const f of a.files) for (const v of a.values) {
      if (!usedAllowance.has(a.id + '\u0000' + f + '\u0000' + v)) staleAllowances.push({ id: a.id, file: f, value: v });
    }
  }

  // ── inline styles, split by whether the system already names the thing ──
  const inline = inlineStyles(root, files.filter((p) => /\.(html|js|mjs)$/.test(p)));
  // NOT EVERY ONE OF THESE IS A MECHANICAL SWAP, and that is the whole finding. An element its
  // client SHOWS by writing `style.display='block'` can take the class today: the inline write still
  // wins over it. An element shown by CLEARING the inline style (`style.display=''`) cannot — the
  // class would survive the clear and the element would stay hidden, which for three of these is a
  // warning banner that silently stops appearing. Those need both sides changed together, so they
  // are counted on this axis and marked `twoSided`, never swapped in a sweep.
  // The judgement DEFAULTS to twoSided. There is no dataflow here, so "safe to swap" is only
  // claimed where every source that names the id writes a non-empty display and no source that
  // names it ever clears one. Anything else, including an element with no id, stays twoSided:
  // getting this wrong in the permissive direction hides a warning banner, and getting it wrong in
  // the cautious direction leaves a conformity finding standing.
  const clients = files.filter((p) => /\.(js|mjs|html)$/.test(p))
    .map((p) => ({ p, src: readFileSync(join(root, p), 'utf8') }));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const safeToSwap = (id) => {
    const naming = clients.filter(({ src }) => new RegExp(`['"]${esc(id)}['"]`).test(src));
    if (!naming.length) return false;
    let sawSet = false;
    for (const { src } of naming) {
      if (/\.style\.display\s*=\s*(''|"")/.test(src)) return false;
      if (/\.style\.display\s*=\s*['"][a-z-]+['"]/.test(src)) sawSet = true;
    }
    return sawSet;
  };
  const display = inline.filter((x) => x.decls.some((d) => /^display\s*:\s*none$/.test(d)));
  for (const x of display) {
    const src = readFileSync(join(root, x.file), 'utf8');
    const tag = src.slice(Math.max(0, src.lastIndexOf('<', x.at)), x.at);
    x.elementId = (/\bid="([^"]+)"/.exec(tag) || [])[1] || null;
    x.twoSided = !(x.elementId && safeToSwap(x.elementId));
  }
  axes.push({
    id: 'inline-display',
    what: 'a hidden-by-default element styled inline where the shared .jshide class exists',
    measured: display.length,
    hits: display.map((x) => ({ file: x.file, value: x.raw, elementId: x.elementId, twoSided: x.twoSided })),
    budget: display.length,
    note: 'twoSided:true needs the client changed with the markup — its show path clears the inline style, or could not be resolved, so adding the class alone would leave the element hidden',
  });

  const typeInline = inline.filter((x) => x.decls.some((d) => /^font-size\s*:/.test(d)));
  axes.push({
    id: 'inline-type',
    what: 'a type size written inline where docs/THEME.md §4.3 names a class for the step',
    measured: typeInline.length,
    hits: typeInline.map((x) => ({ file: x.file, value: x.raw })),
    budget: typeInline.length,
  });

  const sc = scale({ root });
  if (sc.error) undetermined.push({ axis: 'off-scale', why: sc.error });
  else {
    const off = [];
    for (const x of inline) {
      for (const d of x.decls) {
        if (/var\(--/.test(d)) continue;
        // Only the properties the scale governs. §4.3 is a type scale and §5.1 is "spacing uses
        // sixteenths of a rem"; a panel width, a max-height or a 1px rule is not a step on either,
        // and counting them would bury the two real off-scale type sizes in layout dimensions.
        if (!GOVERNED.test(d)) continue;
        for (const m of d.matchAll(/(-?\d*\.?\d+)(rem|px)\b/g)) {
          const step = m[2] === 'px' ? String(Number(m[1]) / 16) : m[1];
          if (!sc.all.has(sc.norm(step))) off.push({ file: x.file, value: d, step: m[1] + m[2] });
        }
      }
    }
    axes.push({
      id: 'off-scale',
      what: 'a type size or spacing length, in a property the scale governs, that is not one of the steps docs/THEME.md declares',
      measured: off.length,
      hits: off,
      budget: off.length,
    });
  }

  // ── navigation ──
  if (!inventory) undetermined.push({ axis: 'navigation', why: 'no feature inventory was supplied, so view reachability was not measured' });
  else {
    const views = inventory.features.filter((f) => f.surface === 'ui-view');
    const broken = views.filter((v) => v.uiReachable === false || v.pathRouted === false || v.linkedFromChrome === false);
    axes.push({
      id: 'navigation',
      what: 'a panel view that is not reachable, not path-routed or not linked from the shared chrome',
      measured: broken.length,
      hits: broken.map((v) => ({ file: v.file, value: v.name })),
      budget: 0,
      population: views.length,
    });
  }

  return { axes, undetermined, staleAllowances };
}
