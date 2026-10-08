// admin/test/lib/panel-source.mjs — the seam, and the property that makes it worth having.
//
// The helper's whole claim is that a test greping panelSource() finds the same JS whether that JS
// is inline in index.html or in an external /static/*.js. That claim is asserted here against a
// synthetic page split both ways — because if it does not hold, converting 40 tests to the helper
// buys nothing and the split stays blocked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { panelHtml, panelScript, panelScripts, panelSource, ADMIN } from './lib/panel-source.mjs';
import { readPanelDocument } from '../lib/panel-document.mjs';

test('the real panel still yields its markup and its script', () => {
  const html = panelHtml();
  const js = panelScript();
  assert.ok(html.includes('<html'), 'index.html did not read as markup');
  // Something every build of this panel has: the escaper the whole client is written against.
  assert.match(js, /function esc\(|const esc\s*=/, 'panelScript() found no esc() — the panel JS did not load');
  assert.ok(panelSource().length >= html.length, 'panelSource() lost content');
});

test('THE PROPERTY: inline and split forms yield the same script', async () => {
  // Two synthetic pages carrying identical JS, one inline and one via <script src>. Built under a
  // temp ADMIN root so the real panel is untouched.
  const root = mkdtempSync(join(tmpdir(), 'cw-panel-src-'));
  try {
    mkdirSync(join(root, 'static'), { recursive: true });
    const JS_A = 'function alpha(){ return 1; }';
    const JS_B = 'function beta(){ return 2; }';
    // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
    writeFileSync(join(root, 'inline.html'),
      `<html><body><script>${JS_A}</script><script>${JS_B}</script></body></html>`);
    writeFileSync(join(root, 'static', 'a.js'), JS_A);
    writeFileSync(join(root, 'static', 'b.js'), JS_B);
    // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
    writeFileSync(join(root, 'split.html'),
      '<html><body><script src="/static/a.js"></script><script src="/static/b.js"></script></body></html>');

    // THE REAL FUNCTION, pointed at the synthetic tree via `base`. Re-implementing its rules here
    // would make this test share the helper's failure mode and prove nothing.
    const inline = panelScript('inline.html', { base: root });
    const split = panelScript('split.html', { base: root });

    assert.equal(inline, split,
      'inline and split forms disagree — the seam does not survive the refactor it exists to enable');
    assert.match(split, /function alpha\(/);
    assert.match(split, /function beta\(/);
    // Order is load-bearing: this panel boots by calling into functions declared earlier.
    assert.ok(split.indexOf('alpha') < split.indexOf('beta'), 'document order was not preserved');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a <script src> pointing at nothing RAISES — an absent script is not an empty one', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-panel-missing-'));
  try {
    // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
    writeFileSync(join(root, 'broken.html'), '<html><script src="/static/gone.js"></script></html>');
    // The failure mode this guards: a page whose script vanished would otherwise contribute an
    // empty string, and every assertion about that JS would go green having read nothing.
    assert.throws(() => panelScript('broken.html', { base: root }),
      /does not exist|not on disk/i,
      'a missing <script src> must raise, not silently contribute nothing');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ADMIN resolves to the directory that actually holds the panel', () => {
  assert.ok(ADMIN.endsWith('admin'), `ADMIN resolved to ${ADMIN}`);
});

test('DROP-IN: panelSource() contains the whole file, plus the scripts it already loads', async () => {
  // The first version of this test asserted byte-identity and FAILED, which was the test being
  // right: index.html already loads four external modules (learning/comments/overwatch-layer/bola,
  // ~34K), so the panel's split has in fact already begun and panelSource() legitimately returns
  // MORE than the file. The true property is containment — every assertion the 40 tests make
  // against the raw text still finds what it looks for — plus the moved JS on top.
  //
  // The consequence for the conversion is worth stating rather than discovering later: it is NOT a
  // blind find/replace. A test asserting a symbol appears EXACTLY ONCE could see a second copy if
  // that symbol also lives in one of the external modules.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  // COMPARE LIKE WITH LIKE. panelHtml() normalises CRLF to LF (added 2026-09-04, after eight test
  // suites were found dying at module load on a Windows checkout), so the seam's contract is
  // "the panel's source, LF-normalised" — not "the bytes on disk". This assertion compared the
  // normalised result against an un-normalised read and failed on exactly the checkout the
  // normalisation exists for. The containment property is the real claim; the line endings are not
  // part of it.
  const lf = (s) => s.split('\r\n').join('\n');
  // index.html is the document serve.mjs sends for `/`, not the generated file of that name.
  for (const page of ['index.html', 'config.html']) {
    const raw = lf(page === 'index.html' ? readPanelDocument() : readFileSync(join(ADMIN, page), 'utf8'));
    const src = panelSource(page);
    assert.ok(src.includes(raw), `panelSource('${page}') no longer contains the file verbatim`);
    assert.ok(src.length >= raw.length, `panelSource('${page}') lost content`);
  }
  // And the extra really is the already-external JS, not padding.
  assert.match(panelSource('index.html'), /function .*|const .*/, 'no script content came through');
  const extra = panelSource('index.html').length - panelHtml('index.html').length;
  assert.ok(extra > 30_000, `expected the four external modules (~34K) to be appended, got ${extra} bytes`);
});

const lf = (s) => s.split('\r\n').join('\n');

test('the panel page is the document serve.mjs sends, never the generated admin/index.html', () => {
  // A test reading the generated copy passes or fails on whether someone rebuilt it; the server
  // answers `/` with readPanelDocument(), so that is the page every panel test must read.
  assert.equal(panelHtml('index.html'), lf(readPanelDocument()));
  assert.doesNotMatch(panelHtml('index.html'), /Generated compatibility entry/);
});

test('panelScripts() keeps each script apart, in document order, and panelScript() is their join', () => {
  const scripts = panelScripts();
  assert.ok(scripts.length > 8, `only ${scripts.length} scripts found`);
  assert.equal(panelScript(), scripts.map((s) => s.code).join('\n'));
  const srcs = [...panelHtml().matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(scripts.filter((s) => s.name.startsWith('/')).map((s) => s.name), srcs);
});

test('each JS menu component has ONE source and reaches the page exactly once', () => {
  // admin/menus/*.js are expanded into the page by readPanelDocument(); a copy of either left in a
  // static part as well would run twice, and the second `const` would throw in the browser.
  const all = panelScript();
  for (const name of ['navigation.js', 'account-menu.js']) {
    const body = lf(readFileSync(join(ADMIN, 'menus', name), 'utf8')).trim();
    const hits = all.split(body).length - 1;
    assert.equal(hits, 1, `menus/${name} appears ${hits} times in the panel's scripts`);
  }
});

test('after a split, panelSource() carries the moved JS that the markup no longer holds', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-panel-dropin-'));
  try {
    mkdirSync(join(root, 'static'), { recursive: true });
    writeFileSync(join(root, 'static', 'panel.js'), 'function movedOut(){ return 42; }');
    // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
    writeFileSync(join(root, 'split.html'), '<html><body><script src="/static/panel.js"></script></body></html>');
    const src = panelSource('split.html', { base: root });
    assert.match(src, /function movedOut\(/, 'the moved JS did not come back through the seam');
    assert.match(src, /<script src="\/static\/panel\.js">/, 'the markup was lost');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
