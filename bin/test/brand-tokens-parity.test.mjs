// brand-tokens-parity.test.mjs — lib/brand-tokens.mjs is a TRANSCRIPTION of the admin panel's own
// palette (admin/static/panel-light.css + panel.css), not an import: those files are plain CSS
// under style-src 'self' and cannot load a JS module at runtime. A transcription with nothing
// checking it is exactly the second-copy-that-drifts pattern CLAUDE.md names — this is the second
// witness, reading the admin stylesheets' own :root blocks and asserting the docsite's copy still
// agrees with them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIGHT, DARK } from '../../lib/brand-tokens.mjs';
import { readPanelDocument } from '../../admin/lib/panel-document.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

function rootTokens(cssPath) {
  const css = readFileSync(resolve(REPO, cssPath), 'utf8');
  const m = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  assert.notEqual(m, null, `${cssPath} has no :root block`);
  return Object.fromEntries([...m[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((t) => [t[1], t[2].trim()]));
}

// docsite token name -> admin token name, where they differ. Everything else is compared by
// identical name.
const RENAMED = { ok: 'live' };

function assertMatches(brandTokens, otherTokens, label, rename = RENAMED) {
  for (const [name, value] of Object.entries(brandTokens)) {
    const otherName = rename[name] || name;
    assert.equal(`--${otherName}`in otherTokens ? otherTokens[`--${otherName}`] : undefined, value,
      `${label} --${name} (brand-tokens.mjs "${value}") does not match --${otherName}`);
  }
}

test('lib/brand-tokens.mjs LIGHT matches admin/static/panel-light.css :root', () => {
  assertMatches(LIGHT, rootTokens('admin/static/panel-light.css'), 'light');
});

test('lib/brand-tokens.mjs DARK matches admin/static/panel.css :root', () => {
  assertMatches(DARK, rootTokens('admin/static/panel.css'), 'dark');
});

test('the seal SVG in lib/brand-tokens.mjs matches the one the panel renders', async () => {
  const { SEAL_SVG } = await import('../../lib/brand-tokens.mjs');
  // The page serve.mjs sends, not the generated admin/index.html, which is only as fresh as its last rebuild.
  const html = readPanelDocument();
  assert.equal(html.includes(SEAL_SVG), true,
    'the panel no longer renders the exact seal markup brand-tokens.mjs carries — the docsite would ship a different logo than the panel');
});

// docsite/editor/editor.css USED TO BE a third static copy of the light tokens, and this file
// asserted it matched. That copy is gone as of 2026-09-01: the editor is served by the panel, so
// unlike admin's own CSS it CAN be handed a generated stylesheet — /edit-assets/tokens.css is
// lib/brand-tokens.mjs's PAPER_CSS served directly, linked ahead of editor.css.
//
// So the light assertion inverts. Checking that a copy MATCHES is the right guard only while a
// copy exists; once it does not, the same guard has to assert the copy has not come BACK, or the
// next person to paste a :root block in restores the fork with every test still green.
// The dark set is still a static copy (the toggle is chrome-only and has no generated equivalent),
// so its parity assertion below is unchanged.
function dataThemeDarkTokens(cssPath) {
  const css = readFileSync(resolve(REPO, cssPath), 'utf8');
  const m = css.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
  assert.notEqual(m, null, `${cssPath} has no :root[data-theme="dark"] block`);
  return Object.fromEntries([...m[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((t) => [t[1], t[2].trim()]));
}

test('docsite/editor/editor.css declares NO light :root — the tokens come from brand-tokens.mjs', () => {
  const css = readFileSync(resolve(REPO, 'docsite', 'editor', 'editor.css'), 'utf8');
  // A bare `:root{` — not :root[data-theme=…] and not :root:not(…), which are the chrome's dark
  // overrides and are supposed to stay.
  assert.equal(/(^|\})\s*:root\s*\{/.test(css), false,
    'editor.css has a bare :root block again — that is the third copy of the light palette coming back. '
    + 'The tokens are served from lib/brand-tokens.mjs at /edit-assets/tokens.css; add rules there, not here');
  const html = readFileSync(resolve(REPO, 'docsite', 'editor', 'edit.html'), 'utf8');
  assert.match(html, /<link[^>]+href="\/edit-assets\/tokens\.css"/,
    'edit.html no longer links /edit-assets/tokens.css — with no :root in editor.css either, the editor '
    + 'chrome would render with every custom property unset');
});

test('docsite/editor/editor.css DARK (:root[data-theme="dark"]) matches lib/brand-tokens.mjs DARK', () => {
  assertMatches(DARK, dataThemeDarkTokens('docsite/editor/editor.css'), 'editor.css dark', {});
});

test('the seal SVG in docsite/editor/edit.html matches lib/brand-tokens.mjs', async () => {
  const { SEAL_SVG } = await import('../../lib/brand-tokens.mjs');
  const html = readFileSync(resolve(REPO, 'docsite', 'editor', 'edit.html'), 'utf8');
  assert.equal(html.includes(SEAL_SVG), true, 'docsite/editor/edit.html no longer renders the exact seal markup');
});
