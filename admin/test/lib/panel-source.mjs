// admin/test/lib/panel-source.mjs — the seam that lets the panel's JS move out of index.html.
//
// THE PROBLEM THIS EXISTS FOR. 40 test files read admin/index.html directly and assert on the
// JavaScript inside it — `readFileSync(join(HERE, '..', 'index.html'))` then grep for a function
// name. Measured 2026-09-04, that file is 580K of which 463K is inline <script>. Moving that JS to
// /static/*.js is the single largest token saving available in this repository, and it is blocked
// on those 40 assertions, every one of which would go red the moment the text left the file.
//
// So the tests stop asking "what is in index.html" and start asking "what is the panel's source".
// panelSource() answers the second question the same way before and after a split: it returns the
// markup with every inline <script> body AND every referenced /static/*.js concatenated in
// document order. A test that greps it finds `function setTabN(` whether that text lives inline
// today or in static/panel-tabs.js tomorrow.
//
// WHAT IT DELIBERATELY DOES NOT DO: hide a missing file. A <script src> pointing at something that
// is not on disk is a broken panel, so it raises rather than quietly contributing nothing — the
// same fail-closed rule the rest of this repository holds to. An absent script is not an empty one.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPanelDocument } from '../../lib/panel-document.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ADMIN = resolve(HERE, '..', '..');

// `base` exists so the property test below can point THIS function at a synthetic page tree.
// Without it the test would have to re-implement the resolution rules to check them, and a guard
// that reimplements what it guards shares its failure mode — the defect this repo names explicitly.
// LINE ENDINGS ARE NORMALISED AT THIS ONE READ, and it is the difference between these guards
// working on Windows and not existing there.
//
// Git for Windows checks out CRLF, so every line of a panel source arrives ending `\r`. Thirty-five
// test files LIFT code out of that text — locating a function by an anchor, slicing to its
// column-0 close, and `new Function`/`eval`-ing the result — and every one of those lifts is
// written against `\n`. The failures are not subtle but they are misleading: `l === '}'` never
// matches `'}\r'`, so a lift runs to the end of the file or returns nothing; and
// `escLine.replace(/;$/, '')` leaves the `;` because `$` sits behind the `\r`, so the eval receives
// a truncated arrow function and dies with `SyntaxError: Unexpected token ';'`.
//
// Measured: 50 tests across ten suites, and eight of those files died at MODULE LOAD rather than
// failing an assertion — scanner-tabs (32 tests), login-page, error-negotiation, issue-panel-render,
// posture-classvoids, remediation-prompts, session-sliding, panel-view-paths, route-auth,
// placement-palette. Those are the panel's own guards. On a Windows checkout they did not run at
// all, which is indistinguishable from not having them.
//
// Normalising here rather than in each consumer: the alternative is thirty-five `split(/\r?\n/)`
// edits that the thirty-sixth consumer will forget. Nothing downstream can tell the difference —
// these are lifts of JavaScript for evaluation and structural assertions about it, and a `\r` is
// not part of either question.
const lf = (s) => s.split('\r\n').join('\n');

/**
 * Markup of a panel page as the server sends it — with line endings normalised, see above.
 *
 * The panel itself is ASSEMBLED: serve.mjs answers `/` with readPanelDocument(), which is
 * panel.html with its admin/menus components expanded, so that is what 'index.html' reads here.
 * admin/index.html on disk is a generated compatibility copy; reading it would make every panel
 * test pass or fail on whether somebody remembered to rebuild it. Any other page, or any page
 * under a non-default `base`, is read as the file it is.
 */
export function panelHtml(page = 'index.html', { base = ADMIN } = {}) {
  if (page === 'index.html' && base === ADMIN) return lf(readPanelDocument());
  return lf(readFileSync(join(base, page), 'utf8'));
}

/**
 * Every script the page carries, one entry each, in document order: `{ name, code }`, where name
 * is the src URL or `inline#<n>`. Separate entries because each is a separate classic script to
 * the browser — a function declaration hoists only within its own — and
 * admin/test/panel-boot.test.mjs runs them one by one for exactly that reason.
 */
export function panelScripts(page = 'index.html', { base = ADMIN } = {}) {
  const html = panelHtml(page, { base });
  const out = [];
  let inline = 0;
  // One pass over <script …> tags so inline and src forms keep their relative order — declaration
  // order is load-bearing for this panel (see admin/test/panel-boot.test.mjs).
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)) {
    const attrs = m[1] || '';
    const src = /\ssrc\s*=\s*["']([^"']+)["']/.exec(attrs);
    if (!src) { out.push({ name: `inline#${inline++}`, code: m[2] }); continue; }
    const url = src[1];
    if (/^https?:|^\/\//.test(url)) continue; // a CDN would violate the panel's own no-CDN rule; not ours to inline
    // /static/x.js is served from admin/static/x.js
    const p = join(base, url.replace(/^\//, ''));
    if (!existsSync(p)) {
      throw new Error(`panelScript(${page}): <script src="${url}"> resolves to ${p}, which does not exist. `
        + 'A page referencing a script that is not on disk is a broken panel, not an empty one.');
    }
    out.push({ name: url, code: lf(readFileSync(p, 'utf8')) });   // same normalisation as panelHtml — see lf() above
  }
  return out;
}

/**
 * Every script the page carries, in document order: inline <script> bodies and the contents of
 * each local <script src="/static/…">. Concatenated with a newline so a regex cannot accidentally
 * span two files.
 */
export function panelScript(page = 'index.html', { base = ADMIN } = {}) {
  return panelScripts(page, { base }).map((s) => s.code).join('\n');
}

/**
 * The drop-in replacement for the `readFileSync(index.html)` that 40 tests do today: the markup,
 * plus the contents of any EXTERNAL script it references.
 *
 * Only external ones are appended, deliberately. Inline <script> bodies are already inside the
 * markup, so appending those too would double every symbol — and a test asserting something
 * appears exactly once would fail for a reason with nothing to do with the panel. Today, with
 * everything inline, this returns the file unchanged, which is what makes it a safe drop-in;
 * after the split it returns markup + the moved JS, which is what makes it a seam.
 */
export function panelSource(page = 'index.html', { base = ADMIN } = {}) {
  const html = panelHtml(page, { base });
  const external = [];
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)) {
    const src = /\ssrc\s*=\s*["']([^"']+)["']/.exec(m[1] || '');
    if (!src || /^https?:|^\/\//.test(src[1])) continue;
    const p = join(base, src[1].replace(/^\//, ''));
    if (!existsSync(p)) {
      throw new Error(`panelSource(${page}): <script src="${src[1]}"> resolves to ${p}, which does not exist.`);
    }
    external.push(lf(readFileSync(p, 'utf8')));   // same normalisation as panelHtml — see lf() above
  }
  return external.length ? `${html}\n${external.join('\n')}` : html;
}
