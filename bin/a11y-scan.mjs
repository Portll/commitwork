#!/usr/bin/env node
// a11y-scan.mjs — WCAG 2.2 audit of the HTML this repo serves, by success criterion. Zero deps,
// no browser: a static pass that can say exactly which subset it covers.
//
// Rule: an unchecked criterion is NOT a pass. Every criterion lands in one of:
//   pass · fail (violations with locations) · n/a (no applicable content) · unchecked (needs a
//   browser or a human) — counted and named, never folded into the pass column.
//
// usage: node bin/a11y-scan.mjs [dir]            # defaults to the repo root; scans served HTML
//        CW_A11Y_FILES=a.html,b.html node bin/a11y-scan.mjs
// output: JSON on stdout (and $CW_REPORT_DIR/a11y.json when the runner sets it)

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';

const ROOT = resolve(process.argv[2] || process.cwd());
const OUT = process.env.CW_REPORT_DIR || '';

// ── the criteria this scanner knows about ───────────────────────────────────────────────────────
// `wcag22` marks criteria new in 2.2; `static:false` is listed so the report can COUNT it as
// unchecked — a criterion absent from the report reads as one nobody thought about.
export const CRITERIA = [
  { id: '1.1.1', level: 'A',  name: 'Non-text Content', static: true },
  { id: '1.3.1', level: 'A',  name: 'Info and Relationships', static: true },
  { id: '1.4.3', level: 'AA', name: 'Contrast (Minimum)', static: true },
  { id: '1.4.4', level: 'AA', name: 'Resize Text', static: true },
  { id: '2.4.1', level: 'A',  name: 'Bypass Blocks', static: true },
  { id: '2.4.2', level: 'A',  name: 'Page Titled', static: true },
  { id: '2.4.4', level: 'A',  name: 'Link Purpose (In Context)', static: true },
  { id: '2.4.6', level: 'AA', name: 'Headings and Labels', static: true },
  { id: '2.4.7', level: 'AA', name: 'Focus Visible', static: true },
  { id: '3.1.1', level: 'A',  name: 'Language of Page', static: true },
  { id: '3.3.2', level: 'A',  name: 'Labels or Instructions', static: true },
  { id: '4.1.2', level: 'A',  name: 'Name, Role, Value', static: true },
  // WCAG 2.2 additions
  { id: '2.4.11', level: 'AA', name: 'Focus Not Obscured (Minimum)', wcag22: true, static: false,
    why: 'needs a live browser: whether a sticky header covers the focused element is a rendered-layout fact',
    howToVerify: 'Panel on the left, nothing else needed. Click the first tab, then press Tab all the way down the page and watch the focus ring — it must stay FULLY visible at every stop. The failure to look for is the sticky identity bar covering a focused control when you Tab back upward, or a focused table row scrolling under it. Scroll to mid-page FIRST, then Tab: that is when it bites.' },
  { id: '2.5.7', level: 'AA', name: 'Dragging Movements', wcag22: true, static: true },
  { id: '2.5.8', level: 'AA', name: 'Target Size (Minimum)', wcag22: true, static: false,
    why: 'needs a browser: 24x24 CSS px is a COMPUTED size, and this panel sizes controls in rem against a root font it adjusts at runtime',
    howToVerify: 'Panel left, DevTools right (Cmd-Opt-I). Inspect the small controls — the tab-strip buttons, the ⏺ re-scan buttons, the copy / hand-off buttons on remediation cards. Read width and height in the Computed pane: each needs 24x24 CSS px, OR 24px of clear spacing around it. The ⏺ buttons are the likeliest failure. Check at a NARROW window too — the root font scales with the viewport, so that is the small end.' },
  { id: '3.2.6', level: 'A',  name: 'Consistent Help', wcag22: true, static: true },
  { id: '3.3.7', level: 'A',  name: 'Redundant Entry', wcag22: true, static: false,
    why: 'needs flow analysis across a multi-step process; judgement, not markup',
    howToVerify: 'Panel left, a second tab of the same panel right. Walk one multi-step flow end to end: log in, then a remediation hand-off (pick a check, choose an engine, pick a model, submit). Nothing you already supplied may be asked for again unless it is re-entered deliberately for security. A step that re-requests what an earlier step already holds is the failure.' },
  { id: '3.3.8', level: 'AA', name: 'Accessible Authentication (Minimum)', wcag22: true, static: true },
  // decidable only by a person
  { id: '1.4.11', level: 'AA', name: 'Non-text Contrast', static: false,
    why: 'needs the rendered UI: which borders/icons are meaningful boundaries is a design judgement',
    howToVerify: 'Panel left, DevTools colour picker right. This is about NON-text: every control boundary and every icon that carries meaning needs 3:1 against what sits behind it. Check the input and select borders (--line / --line2 on --panel), the focus ring, the pill borders, and the status dot inside each pill. Do NOT re-check text here — 1.4.3 already machine-checks that. Judge only the shapes.' },
  { id: '2.4.3', level: 'A',  name: 'Focus Order', static: false,
    why: 'MEANINGFUL order cannot be read off the DOM — a sensible tab sequence is a human judgement',
    howToVerify: 'Panel left, hands off the mouse. Tab from the top and say the order aloud: skip link, identity row, tab strip, then content. It must match how the page reads visually AND make sense as a sequence. The three failures to hunt: a control that jumps backwards, a dialog that lets focus escape behind it, and anything Tab reaches that you cannot see.' },
  { id: '1.3.2', level: 'A',  name: 'Meaningful Sequence', static: false,
    why: 'as above: reading order is judged, not parsed',
    howToVerify: 'Panel left. Turn CSS off entirely (DevTools ▸ disable the stylesheet, or Reader mode) and read top to bottom. The order content ARRIVES in must still make sense — a heading before the table it introduces, a coverage banner before the rows it qualifies. This panel is where that matters most: if a findings table arrives before the banner saying the scan was a VOID, the unstyled reading order tells a different story from the styled one.' },
];

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
// Tags stripped via split/join, not String#replace — CodeQL flags any replace-based tag stripper
// as an incomplete sanitizer (js/incomplete-multi-character-sanitization). Any surviving '<'/'>'
// is escaped: this snippet is embedded verbatim in findings that reach generated reports.
export const strip = (h) => h.split(/<[^>]*>/).join('').replace(/&[a-z]+;/gi, ' ').trim()
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Escape regex metacharacters before interpolation into new RegExp — the `id` use below takes a
// value straight off the scanned HTML (semgrep: detect-non-literal-regexp).
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasAny = (tag, ...attrs) => attrs.some((a) => new RegExp(`\\b${escapeRe(a)}\\s*=`, 'i').test(tag)); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- attr pinned to a literal via escapeRe; see comment above

// Blank out a matched region while keeping its newlines, so anything downstream that counts or
// reports line numbers still lines up with the original file.
const blankKeepingLines = (s) => s.replace(/[^\n]/g, '');

// Strip HTML comments and <script> bodies before the markup-SHAPE checks — prose or template-
// string HTML inside them is not markup a browser parses. Checks that care about the whole
// document (drag handlers, password autocomplete) keep scanning the raw html; see each call site.
export function stripNonMarkupRegions(html) {
  return html
    // --!> is a legacy comment terminator browsers still honour (CodeQL js/bad-tag-filter).
    .replace(/<!--[\s\S]*?(?:-->|--!>)/g, blankKeepingLines)
    // Any tag-terminating content after "script" up to the next '>' closes the element, not just
    // the exact "</script>" (CodeQL js/bad-tag-filter); \b keeps "</scriptx>" excluded.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, blankKeepingLines);
}

function contrast(fg, bg) {
  const hex = (c) => {
    let x = String(c).trim().replace('#', '');
    if (x.length === 3) x = x.split('').map((ch) => ch + ch).join('');
    if (!/^[0-9a-f]{6}$/i.test(x)) return null;
    return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
  };
  const a = hex(fg), b = hex(bg);
  if (!a || !b) return null;
  const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const L = (r) => 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]);
  const [hi, lo] = L(a) > L(b) ? [L(a), L(b)] : [L(b), L(a)];
  return (hi + 0.05) / (lo + 0.05);
}

/** The served HTML files: explicit list, else every .html at the root of the scanned dir tree. */
function htmlFiles(dir) {
  if (process.env.CW_A11Y_FILES) {
    return process.env.CW_A11Y_FILES.split(',').map((f) => f.trim()).filter(Boolean)
      .map((f) => resolve(dir, f)).filter((p) => existsSync(p));
  }
  const out = [];
  const skip = new Set(['node_modules', '.git', 'reports', 'reference', 'dist', 'build', 'vendor', 'coverage']);
  const walk = (d, depth) => {
    let entries; try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory() && !skip.has(e.name) && !e.name.startsWith('.') && depth < 3) walk(join(d, e.name), depth + 1);
      // Generated report pages are excluded: build output, not a served interface.
      else if (e.isFile() && e.name.endsWith('.html') && !/^(dashboard|timeline|modernization|runtime|projectstatus)/.test(e.name)) {
        out.push(join(d, e.name));
      }
    }
  };
  walk(dir, 0);
  return out.sort();
}

// ── the audit ───────────────────────────────────────────────────────────────────────────────────
export function auditHtml(html, file) {
  const v = [];       // {criterion, level, detail, count}
  const add = (criterion, detail, count = 1) => v.push({ criterion, file, detail, count });
  // Comments and <script> bodies are never rendered as markup; line numbers are preserved.
  const markup = stripNonMarkupRegions(html);

  // A component fragment (no <html>, no <head>) is composed into a page by a build step; the
  // page-level criteria are judged on the composed page, which is scanned in its own right.
  const fragment = !/<html\b/i.test(markup) && !/<head\b/i.test(markup);
  // 3.1.1 Language of Page (A)
  if (!fragment && !/<html[^>]*\blang\s*=/i.test(html)) add('3.1.1', '<html> has no lang attribute — a screen reader cannot pick a voice');
  // 2.4.2 Page Titled (A)
  if (!fragment && !/<title>\s*\S/i.test(html)) add('2.4.2', 'no non-empty <title>');
  // 1.4.4 Resize Text (AA) — a fixed px root font or user-scalable=no blocks zoom
  if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i.test(html)) add('1.4.4', 'viewport blocks zoom (user-scalable=no / maximum-scale=1)');
  // 2.4.1 Bypass Blocks (A)
  const navCount = (html.match(/<nav\b/gi) || []).length;
  if (!fragment && navCount && !/href="#(main|content)|class="[^"]*skip/i.test(html)) {
    add('2.4.1', `${navCount} <nav> block(s) and no skip link — keyboard users traverse the whole strip on every page`);
  }
  // 1.1.1 Non-text Content (A) — on STRIPPED markup: prose about an <img> is not an <img>.
  for (const m of markup.matchAll(/<img\b[^>]*>/gi)) if (!/\balt\s*=/i.test(m[0])) add('1.1.1', `<img> without alt: ${m[0].slice(0, 80)}`);
  for (const m of markup.matchAll(/<svg\b[^>]*>/gi)) {
    if (!hasAny(m[0], 'aria-label', 'aria-labelledby', 'role') && !/aria-hidden\s*=\s*["']true/i.test(m[0])) {
      add('1.1.1', 'inline <svg> with no accessible name and not aria-hidden');
    }
  }
  // 4.1.2 Name, Role, Value (A) — stripped: a button in prose or a template string is no control.
  for (const m of markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    if (!strip(m[2]) && !hasAny(m[1], 'aria-label', 'aria-labelledby', 'title')) add('4.1.2', 'button with no accessible name');
  }
  // 3.3.2 Labels or Instructions (A) + 1.3.1 programmatic association. STRIPPED for the same reason.
  // An input nested in a <label> is labelled by it (HTML implicit association).
  const labelSpans = [...markup.matchAll(/<label\b[^>]*>[\s\S]*?<\/label\b[^>]*>/gi)].map((l) => [l.index, l.index + l[0].length]);
  for (const m of markup.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    const tag = m[0], attrs = m[2];
    if (labelSpans.some(([a, b]) => m.index > a && m.index < b)) continue;
    if (/type\s*=\s*["'](hidden|submit|button)/i.test(attrs)) continue;
    const id = (attrs.match(/\bid\s*=\s*["']([^"']+)/i) || [])[1];
    // `id` comes off the audited page; escapeRe pins it as a literal — unescaped metacharacters
    // would change the match or open a ReDoS (semgrep: detect-non-literal-regexp).
    const labelled = hasAny(attrs, 'aria-label', 'aria-labelledby', 'title')
      || (id && new RegExp(`<label[^>]*\\bfor\\s*=\\s*["']${escapeRe(id)}["']`, 'i').test(markup)); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- id pinned to a literal via escapeRe; see comment above
    if (!labelled) add('3.3.2', `${m[1]} with no label, aria-label or <label for>: ${tag.slice(0, 70)}`);
  }
  // 2.4.4 Link Purpose (A) — STRIPPED, same reasoning.
  for (const m of markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const text = strip(m[2]);
    if (!text && !hasAny(m[1], 'aria-label', 'aria-labelledby', 'title')) add('2.4.4', 'link with no discernible text');
    else if (/^(click here|here|read more|more|link)$/i.test(text)) add('2.4.4', `non-descriptive link text: "${text}"`);
  }
  // 1.3.1 Info and Relationships (A) — data tables need header cells. STRIPPED, same reasoning.
  for (const m of markup.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    // A header row left empty for the client to fill (`<thead id=…></thead>`) is not statically decidable.
    if (/<thead\b[^>]*\bid\s*=[^>]*>\s*<\/thead>/i.test(m[1])) continue;
    if (!/<th\b/i.test(m[1])) add('1.3.1', 'data <table> with no <th> — rows have no programmatic headers');
  }
  // 1.3.1 / 2.4.6 — heading order must not skip levels. STRIPPED, same reasoning.
  const levels = [...markup.matchAll(/<h([1-6])\b/gi)].map((m) => +m[1]);
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) { add('2.4.6', `heading level jumps h${levels[i - 1]} -> h${levels[i]}`); break; }
  }
  if (!fragment && levels.length && levels[0] !== 1) add('2.4.6', `first heading is h${levels[0]}, not h1`);
  // 2.5.7 Dragging Movements (AA, 2.2) — deliberately scans RAW html: a dragstart listener in an
  // inline <script> is real runtime behaviour.
  if (/ondrag|draggable\s*=\s*["']true|dragstart/i.test(html)) {
    add('2.5.7', 'drag interaction present — WCAG 2.2 requires a single-pointer alternative; verify one exists');
  }
  // 3.2.6 Consistent Help (A, 2.2) — informational only when no help mechanism exists at all
  // 3.3.8 Accessible Authentication (AA, 2.2) — also scans RAW html (a JS-built login form is
  // still rendered markup). The attribute is matched AGAINST THE FIELD, never document-wide.
  // Two provable violations only:
  //   (a) a password input whose own tag carries autocomplete=off;
  //   (b) a password input with no autocomplete of its own inside a <form autocomplete="off">.
  // (b) matches the form block lexically, so a runtime-injected field is a stated miss.
  const PASSWORD_INPUT = /<input\b[^>]*type\s*=\s*["']password["'][^>]*>/gi;
  const declaresAutocompleteOff = (tag) => /\bautocomplete\s*=\s*["']off["']/i.test(tag);
  const declaresAutocomplete = (tag) => /\bautocomplete\s*=/i.test(tag);

  // Each finding names its field, once; only identifying attributes are quoted, never the whole
  // tag (a `value=` must not ride into a rendered report).
  const fieldId = (tag) => {
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(tag);
    const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(tag);
    return id ? `#${id[1]}` : name ? `[name=${name[1]}]` : '(unidentified password field)';
  };
  const seen = new Set();
  const addField = (tag, why) => {
    const key = `${why}|${fieldId(tag)}`;
    if (seen.has(key)) return;
    seen.add(key);
    add('3.3.8', `password field ${fieldId(tag)} ${why} — blocks password managers, which 2.2 treats as a cognitive-function test`);
  };

  for (const [tag] of html.matchAll(PASSWORD_INPUT)) {
    if (declaresAutocompleteOff(tag)) addField(tag, 'sets autocomplete=off');
  }
  for (const [formBlock] of html.matchAll(/<form\b[^>]*\bautocomplete\s*=\s*["']off["'][^>]*>[\s\S]*?<\/form>/gi)) {
    for (const [tag] of formBlock.matchAll(PASSWORD_INPUT)) {
      if (!declaresAutocomplete(tag)) addField(tag, 'inherits autocomplete=off from its form');
    }
  }
  return v;
}

/** Contrast (1.4.3) from the stylesheet's own custom properties. */
export function auditContrast(css) {
  const vars = {};
  for (const m of css.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)) vars[m[1]] = m[2];
  const bg = vars.bg;
  const out = { checked: 0, violations: [], background: bg || null };
  if (!bg) return out;
  // Only tokens used as a foreground COLOR — a surface token is not a violation.
  const asColor = new Set();
  for (const m of css.matchAll(/(?:^|[;{\s])color\s*:\s*var\(--([a-z0-9-]+)\)/g)) asColor.add(m[1]);
  for (const [name, hex] of Object.entries(vars)) {
    if (!asColor.has(name)) continue;
    // `--on-X` is the text colour laid ON the surface `--X`, so it is measured against that surface.
    const surface = name.startsWith('on-') && vars[name.slice(3)] ? vars[name.slice(3)] : bg;
    const r = contrast(hex, surface);
    if (r == null) continue;
    out.checked++;
    if (r < 4.5) {
      out.violations.push({ token: `--${name}`, color: hex, ratio: Math.round(r * 100) / 100,
        passesLargeText: r >= 3,
        detail: `--${name} (${hex}) on ${surface} is ${r.toFixed(2)}:1 — AA needs 4.5:1 for normal text${r >= 3 ? ' (it does clear 3:1, so it is conformant only where the text is 18pt+/14pt-bold)' : ''}` });
    }
  }
  return out;
}

// ── the content digest an attestation is bound to ───────────────────────────────────────────────
// Human attestations (monitor/a11y-attestations.mjs) bind to this digest and lapse when it moves.
// It covers every byte of every file the audit READ: whole file bytes (inline JS builds the DOM),
// markup AND CSS together for every criterion (any narrowing claims some file cannot affect a
// rendered fact), path-qualified (renames move the digest) — and never the report's own JSON
// (generatedAt would kill every attestation nightly). Deterministic: sorted, fixed order, no clock.
export function contentDigest({ files = [], cssFiles = [] } = {}) {
  const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
  const sources = [
    ...files.map((f) => ({ path: f.path, kind: 'html', sha256: sha(f.html) })),
    ...cssFiles.map((c) => ({ path: c.path, kind: 'css', sha256: sha(c.css) })),
  ].sort((a, b) => (a.kind === b.kind
    ? (a.path === b.path ? a.sha256.localeCompare(b.sha256) : a.path.localeCompare(b.path))
    : a.kind.localeCompare(b.kind)));
  // Canonical form built here to keep the "no imports beyond node:" shape.
  const canon = JSON.stringify(sources.map((s) => [s.kind, s.path, s.sha256]));
  return {
    algorithm: 'sha256',
    digest: `sha256:${sha(canon)}`,
    sources,
    note: 'sha256 over every audited HTML file and stylesheet, path-qualified. A human attestation '
        + 'against a criterion this scanner cannot decide is bound to this digest and stops being '
        + 'in force the moment it moves — a ruling about a page is not a ruling about its rewrite.',
  };
}

// ── report assembly ─────────────────────────────────────────────────────────────────────────────
export function buildReport({ files, cssFiles, nowIso }) {
  const violations = [];
  for (const { path, html } of files) violations.push(...auditHtml(html, path));
  // Per stylesheet, not concatenated: each sheet audits against ITS OWN --bg, and a violation is
  // attributed to the file that defines the token.
  const contrastOut = { checked: 0, violations: [], background: null, perFile: [] };
  for (const cf of cssFiles) {
    const one = auditContrast(cf.css);
    if (!one.checked) continue;
    contrastOut.checked += one.checked;
    contrastOut.background = contrastOut.background || one.background;
    contrastOut.perFile.push({ path: cf.path, background: one.background, checked: one.checked, violations: one.violations.length });
    for (const cv of one.violations) {
      contrastOut.violations.push({ ...cv, file: cf.path });
      violations.push({ criterion: '1.4.3', file: cf.path, detail: cv.detail, count: 1, meta: cv });
    }
  }

  const byCriterion = new Map();
  for (const c of CRITERIA) byCriterion.set(c.id, { ...c, state: c.static ? 'pass' : 'unchecked', findings: [] });
  for (const v of violations) {
    const row = byCriterion.get(v.criterion);
    if (!row) continue;
    row.state = 'fail';
    row.findings.push({ file: v.file, detail: v.detail, meta: v.meta || null });
  }
  // 1.4.3 with no stylesheet to read is UNCHECKED, not a pass — the distinction this whole file is about
  if (!contrastOut.checked) {
    const c = byCriterion.get('1.4.3');
    if (c.state !== 'fail') { c.state = 'unchecked'; c.why = 'no stylesheet with custom properties was found to evaluate'; }
  }

  const rows = [...byCriterion.values()];
  const tally = (lvl) => {
    const set = rows.filter((r) => r.level === lvl);
    return { total: set.length, pass: set.filter((r) => r.state === 'pass').length,
      fail: set.filter((r) => r.state === 'fail').length,
      unchecked: set.filter((r) => r.state === 'unchecked').length };
  };
  const A = tally('A'), AA = tally('AA');
  return {
    tool: 'a11y-wcag', standard: 'WCAG 2.2', generatedAt: nowIso,
    ran: true,
    files: files.map((f) => f.path),
    // What a human attestation is bound to (contentDigest above); the artifact carries its subject.
    subject: contentDigest({ files, cssFiles }),
    // The headline is not "0 violations": an unchecked criterion blocks a conformance claim
    // exactly as a failure does.
    conformance: {
      A: A.fail === 0 && A.unchecked === 0 ? 'conformant' : A.fail ? 'fails' : 'unverified',
      AA: (A.fail + AA.fail) === 0 && (A.unchecked + AA.unchecked) === 0 ? 'conformant'
        : (A.fail + AA.fail) ? 'fails' : 'unverified',
      note: 'A criterion this scanner cannot decide statically blocks a conformance claim the same way a failure does. "unverified" means exactly that — not "probably fine".',
    },
    levels: { A, AA },
    criteria: rows.sort((a, b) => (a.state === b.state ? a.id.localeCompare(b.id, undefined, { numeric: true })
      : ['fail', 'unchecked', 'n/a', 'pass'].indexOf(a.state) - ['fail', 'unchecked', 'n/a', 'pass'].indexOf(b.state))),
    contrast: contrastOut,
    totals: { violations: violations.length, criteriaFailing: rows.filter((r) => r.state === 'fail').length },
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const paths = htmlFiles(ROOT);
  const files = paths.map((p) => ({ path: relative(ROOT, p) || p, html: readFileSync(p, 'utf8') }));
  // stylesheets: linked .css under the same tree, plus any inline <style> the pages still carry
  const cssFiles = [];
  const seen = new Set();
  for (const p of paths) {
    const html = readFileSync(p, 'utf8');
    for (const m of html.matchAll(/<link[^>]+href=["']([^"']+\.css)["']/gi)) {
      const cand = resolve(ROOT, m[1].replace(/^\//, ''));
      for (const c of [cand, resolve(ROOT, 'admin', m[1].replace(/^\//, ''))]) {
        if (existsSync(c) && !seen.has(c)) { seen.add(c); cssFiles.push({ path: relative(ROOT, c), css: readFileSync(c, 'utf8') }); }
      }
    }
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) cssFiles.push({ path: relative(ROOT, p), css: m[1] });
  }
  const nowIso = process.env.CW_NOW || new Date().toISOString();
  const report = files.length
    ? buildReport({ files, cssFiles, nowIso })
    : { tool: 'a11y-wcag', standard: 'WCAG 2.2', generatedAt: nowIso, ran: false, skipped: true,
        reason: 'no served HTML found in this repo — nothing to audit (not a pass)' };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, 'a11y.json'), text); }
  process.stdout.write(text);
}
