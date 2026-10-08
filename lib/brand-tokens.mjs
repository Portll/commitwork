// lib/brand-tokens.mjs — the bond-paper/gold palette and the commitwork seal, transcribed once
// from admin/static/panel-light.css and admin/static/panel.css (the WCAG-verified source: every
// value there carries its own contrast measurement in a comment), so a generator outside the
// admin panel — the docsite shell, bin/taxonomy-web.mjs — carries the same brand rather than a
// second, independently-aging copy of the hex values.
//
// This is a TRANSCRIPTION, not an import: the admin stylesheets are plain CSS loaded under
// style-src 'self' for CSP reasons and cannot literally import a JS module at runtime. The two
// copies are kept honest by bin/test/brand-tokens-parity.test.mjs, which reads the admin
// stylesheets' own :root blocks and asserts these values still match them — the second witness
// that cannot share this file's failure mode.
//
// fact: --acc is GOLD, not violet / violet (sev) is reserved for one signal in the admin panel —
//   "actively exploited", and that reservation now holds on the docsite WITHOUT exception:
//   `code` ran violet here briefly under the 2026-08-29 ruling, on the reasoning that gold was
//   already carrying links, headings and the seal; the operator reversed it the same day and
//   accepted the overload, so violet is once again reserved for the one signal
//   (expiry: never, prev: code-runs-violet 2026-08-29)

export const SEAL_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="16" fill="#14161A"/><circle cx="16" cy="16" r="14.5" fill="none" stroke="#C9A227" stroke-width="1"/><circle cx="12" cy="20" r="2.4" fill="#C9A227"/><circle cx="21" cy="11" r="2.4" fill="none" stroke="#C9A227" stroke-width="1.3"/><path d="M13.7 18.3 L19.3 12.7" stroke="#C9A227" stroke-width="1.3" fill="none"/></svg>';

// A data-URI <img>, not the live SVG, for anywhere the seal reaches a page rendered from
// user-editable source (the docsite shell): bin/test/docsite-build.test.mjs asserts no live inline
// <svg> reaches a built page at all, the same rule lib/docsite-md.mjs already applies to every
// ```svg fence in markdown, so a live <svg> in the shell would be one exception nothing scans for.
// The seal itself is static and developer-authored, not attacker-reachable, but the page it lands
// on can't tell "trusted chrome" from "rendered body" by looking at the bytes — so it stays inert
// like everything else that reaches a page.
const b64utf8 = (s) => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s))));

// AN <img src="data:image/svg+xml,…"> IS PARSED AS A STANDALONE DOCUMENT, AND A STANDALONE SVG
// WITHOUT xmlns IS NOT SVG. Inline in HTML the parser puts the element in the SVG namespace for
// you, which is why SEAL_SVG has always looked correct in the panel and why nobody caught this:
// the same bytes render in one context and fail in the other. As a data URI the browser has no
// HTML around it, finds no namespace, and paints the broken-image glyph — measured 2026-08-29 on
// the live docsite header, where the logo had been a torn-page icon rather than a mark.
// `xml.dom.minidom` agreed: namespaceURI None. librsvg does NOT agree, because it is lenient —
// so a local render is not a witness for this defect and asserting one would have cleared it.
// The namespace is added HERE, in the wrappers, rather than in SEAL_SVG: the inline copies in
// admin/index.html, admin/config.html, admin/serve.mjs and docsite/editor/edit.html must keep
// matching SEAL_SVG byte for byte (bin/test/brand-tokens-parity.test.mjs), and they are the uses
// that were never broken. Fix the context that fails, not the four that do not.
const standalone = (svg) => (/<svg[^>]*\sxmlns=/.test(svg) ? svg : svg.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"'));

export const SEAL_IMG = `<img class="seal" alt="" src="data:image/svg+xml;base64,${b64utf8(standalone(SEAL_SVG))}">`;
// The dark-ground seal as a data URI. Marks reach docsite pages as DATA URIs rather than served
// assets, deliberately: those pages are self-contained by house rule and Cloudflare Pages would
// otherwise need an asset route for ~400 bytes. The docsite's tab icon is MARK_ICON below.
export const SEAL_FAVICON = `data:image/svg+xml;base64,${b64utf8(standalone(SEAL_SVG))}`;

// ── THE MARK: the default logo, for light grounds ──────────────────────────────────────────────
// A white disc, a black ring and the gold key. SEAL_SVG above is the variant for dark grounds.
// Derived from SEAL_SVG by recolouring, so the two cannot disagree about geometry; on white the
// disc meets the page and the black ring is its edge. Inline copies of SEAL_SVG are recoloured to
// this by the light stylesheets (the disc is the first circle, the ring the second).
const recolour = ({ disc, ring, key }) => SEAL_SVG
  .replace('fill="#14161A"', `fill="${disc}"`)
  .replace('r="14.5" fill="none" stroke="#C9A227"', `r="14.5" fill="none" stroke="${ring}"`)
  .replaceAll('#C9A227', key);
export const MARK_COLOURS = { disc: '#FFFFFF', ring: '#101011', key: '#C9A227' };
export const MARK_SVG = recolour(MARK_COLOURS);
export const MARK_URI = `data:image/svg+xml;base64,${b64utf8(standalone(MARK_SVG))}`;
export const MARK_IMG = `<img class="seal" alt="" src="${MARK_URI}">`;
// Every tab icon is the default mark. Static pages that cannot import this carry a copy, held to it
// by lib/test/brand-marks.test.mjs.
export const MARK_ICON = `<link rel="icon" type="image/svg+xml" href="${MARK_URI}">`;
// The recolour applied in CSS to an inline SEAL_SVG copy on a light ground, scoped by `scope`.
export const markRecolourCss = (scope) => `${scope} svg circle:first-of-type{fill:${MARK_COLOURS.disc}}`
  + `${scope} svg circle:nth-of-type(2){stroke:${MARK_COLOURS.ring}}`;

// Values as they stand in admin/static/panel-light.css :root (light) and
// admin/static/panel.css :root (dark) as of 2026-08-29. --sev is the panel's reserved
// exploited-signal violet, carried here only because the docsite gives it a second, narrower job.
// RESTORED 2026-08-29 by re-reading both CSS files rather than retyping remembered values, after
// an edit here sliced this block out: a transcription must be re-derived from its source, and
// bin/test/brand-tokens-parity.test.mjs is the witness that says whether the derivation is right.
export const LIGHT = {
  bg: '#f4f3ef', panel: '#ffffff', panel2: '#eae8e2', line: '#d8d5cc', line2: '#b9b6aa',
  head: '#101011', ink: '#1c1d1f', mut: '#5f5d57', dim: '#69675f',
  acc: '#885f25', acc2: '#6e5220', wash: 'rgba(136,95,37,.10)', 'on-acc': '#ffffff',
  ok: '#047734', crit: '#c32b25',
  sev: '#7b2ff7',
};
export const DARK = {
  bg: '#17181a', panel: '#1e1f22', panel2: '#26272a', line: '#333438', line2: '#44454a',
  head: '#f4f3ef', ink: '#e4e2dc', mut: '#98958e', dim: '#8a877e',
  acc: '#c9a227', acc2: '#9a7b1d', wash: 'rgba(201,162,39,.10)', 'on-acc': '#1a120e',
  ok: '#5fd08a', crit: '#fe5b66',
  sev: '#b47cff',
};

// The rest of the semantic tokens (docs/THEME.md §3.3–3.5). Kept out of LIGHT and DARK because
// docsite/editor/editor.css restates DARK and carries none of them; lib/test/house-css.test.mjs
// holds these to the two panel stylesheets instead.
export const LIGHT_SEMANTIC = {
  part: '#955906', plan: '#5b6675', high: '#9c4221', med: '#a14a02', low: '#765e02',
  'sev-fill': 'rgba(123,47,247,.12)', machine: '#5c6b33', attest: '#1b6a8c',
};
export const DARK_SEMANTIC = {
  part: '#d69a52', plan: '#8a92a5', high: '#fe5d30', med: '#f18b2e', low: '#f9bd30',
  'sev-fill': 'rgba(74,35,130,.55)', machine: '#8a9a5b', attest: '#6fb3d2',
};

export const MONO = 'ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace';
export const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

const tokenLines = (t) => `--bg:${t.bg};--panel:${t.panel};--panel2:${t.panel2};--line:${t.line};--line2:${t.line2};
  --head:${t.head};--ink:${t.ink};--mut:${t.mut};--dim:${t.dim};
  --acc:${t.acc};--acc2:${t.acc2};--wash:${t.wash};--on-acc:${t['on-acc']};--ok:${t.ok};--crit:${t.crit};--sev:${t.sev};`;

// The one :root block plus its dark override — light-first, per the same house rule already
// applied to this palette once (docsite-page.mjs CSS, 2026-08-28): the unguarded :root is the
// palette a reader with no explicit preference sees.
export const ROOT_CSS = `:root{
  ${tokenLines(LIGHT)}
  --mono:${MONO};
  --sans:${SANS};
}

@media (prefers-color-scheme: dark){
  :root{
    ${tokenLines(DARK)}
  }
}`;

// ── THE KEY ─────────────────────────────────────────────────────────────────────────────────────
// The seal with a #101011 disc. No surface wears it; lib/md-view.mjs draws it as the `cw:key`
// specimen. Recoloured, never redrawn — every coordinate below is copied from SEAL_SVG.
// admin/cw-key.svg carries the same instruction but SEAL_SVG's colours (#14161A disc), not these.
// The gold is the dark theme's #c9a227 because here it sits on black.
const KEY_DISC = '#101011';  // LIGHT.head — the black of the logo
const KEY_GOLD = '#c9a227';  // gold that holds against black
export const KEY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false">`
  + `<circle cx="16" cy="16" r="16" fill="${KEY_DISC}"/>`
  + `<circle cx="16" cy="16" r="14.5" fill="none" stroke="${KEY_GOLD}" stroke-width="1"/>`
  + `<circle cx="12" cy="20" r="2.4" fill="${KEY_GOLD}"/>`
  + `<circle cx="21" cy="11" r="2.4" fill="none" stroke="${KEY_GOLD}" stroke-width="1.3"/>`
  + `<path d="M13.7 18.3 L19.3 12.7" stroke="${KEY_GOLD}" stroke-width="1.3" fill="none"/></svg>`;
export const KEY_FAVICON = `data:image/svg+xml;base64,${b64utf8(KEY_SVG)}`;

// ── PAPER_CSS ───────────────────────────────────────────────────────────────────────────────────
// ROOT_CSS carries a prefers-color-scheme override, which is right for an operator panel someone
// stares at for hours. It is wrong here: it meant a reader on a dark-mode machine got a dark
// documents site, and "bond paper" that turns black depending on who is looking is not a livery.
// So the docsite commits to one look and paints it explicitly rather than inheriting anything.
export const PAPER_CSS = `:root{
  ${tokenLines(LIGHT)}
  --mono:${MONO};
  --sans:${SANS};
}`;
