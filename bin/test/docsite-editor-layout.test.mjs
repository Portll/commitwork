// The docsite editor's pane layout, measured in a real browser.
//
// WHY A BROWSER. Everything here is a COMPUTED layout fact — how many grid tracks resolve, how wide
// each one is, whether a pane survives a narrow viewport. None of it is decidable by reading the
// stylesheet: `grid-template-columns` here is built from custom properties and minmax(), and the
// only thing that can say what those produce is an engine that lays them out. A test that asserted
// the CSS text would pass on a rule that resolves to nothing.
//
// WHY NOT THE PANEL. editor.js imports from /edit-assets/, which only the panel origin serves, so
// the page cannot boot standalone. What is under test is the GRID and its custom-property plumbing,
// so the script is stripped and the property writes editor.js makes are made directly. That is a
// real limit and it is stated rather than papered over: this proves the mechanism the splitter
// drives, not the pointerdown wiring that drives it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { findChrome, withBrowser, newPage } from '../../lib/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Read at call time, never at module load — a `const` here would defeat any test that sets it.
const repoRoot = () => process.env.CW_REPO_ROOT || join(HERE, '..', '..');

// Chrome is resolved once at load because node:test needs the skip flag when it registers the test.
// An absent browser is UNAVAILABLE — neither a pass nor a failure, per lib/test/cdp.test.mjs.
const chrome = findChrome();

/** The editor shell with its stylesheet inlined and its module script removed. */
function standalonePage(dir) {
  const root = repoRoot();
  const html = readFileSync(join(root, 'docsite/editor/edit.html'), 'utf8');
  const css = readFileSync(join(root, 'docsite/editor/editor.css'), 'utf8');
  // Fail closed: if the shell ever stops carrying these exact tags, the replacements below become
  // silent no-ops and the page would be measured WITHOUT its stylesheet — every track would collapse
  // and the assertions would report on a layout that does not exist.
  const links = ['<link rel="stylesheet" href="/edit-assets/editor.css">',
    '<link rel="stylesheet" href="/edit-assets/tokens.css">',
    '<script type="module" src="/edit-assets/editor.js"></script>'];
  for (const tag of links) {
    assert.ok(html.includes(tag), `edit.html no longer contains ${tag} — this harness is measuring the wrong document`);
  }
  const out = join(dir, 'edit-standalone.html');
  writeFileSync(out, html
    .replace(links[1], '')
    .replace(links[0], `<style>\n${css}\n</style>`)
    .replace(links[2], ''));
  return out;
}

const tracks = (s) => s.split(/\s+/).filter(Boolean).map(parseFloat);

test('the editor lays out on a fluid grid, and the preview survives a narrow viewport',
  { skip: chrome.unavailable || false }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-editor-layout-'));
    try {
      const page = standalonePage(dir);
      const r = await withBrowser(async (conn) => {
        const p = await newPage(conn);
        // Prove the driver can observe before any assertion below is believed.
        await p.selfWitness();
        await p.setViewport({ width: 1400, height: 900 });
        await p.goto(`file://${page}`);

        const wide = await p.evaluate(`(() => {
          const m = document.querySelector('main');
          const cs = getComputedStyle(m);
          return {
            cols: cs.gridTemplateColumns,
            splitters: document.querySelectorAll('.splitter[role="separator"]').length,
            valuenow: [...document.querySelectorAll('.splitter')].map(s => s.getAttribute('aria-valuenow')),
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        })()`);

        const dragged = await p.evaluate(`(() => {
          const m = document.querySelector('main');
          m.style.setProperty('--w-list', '24rem');
          m.style.setProperty('--w-src', '1.5fr');
          m.style.setProperty('--w-prev', '0.5fr');
          return getComputedStyle(m).gridTemplateColumns;
        })()`);

        await p.setViewport({ width: 860, height: 900 });
        const narrow = await p.evaluate(`(() => {
          const m = document.querySelector('main');
          const cs = getComputedStyle(m);
          const pv = document.querySelector('.preview-pane');
          return {
            rows: cs.gridTemplateRows, cols: cs.gridTemplateColumns,
            previewDisplay: getComputedStyle(pv).display,
            previewH: pv.getBoundingClientRect().height,
            splitterDisplay: getComputedStyle(document.querySelector('.splitter')).display,
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        })()`);
        return { wide, dragged, narrow };
      }, { headless: true });

      if (r.unavailable) return;              // browser vanished between findChrome and launch
      const { wide, dragged, narrow } = r.result;

      const w = tracks(wide.cols);
      assert.equal(w.length, 5, `five tracks — list, splitter, source, splitter, preview (got ${wide.cols})`);
      // NOT VACUOUS. The first version of this check parsed "240px" with Number(), got NaN, and CDP's
      // JSON round-trip turned that into null -> 0 — on which "source and preview are equal" compared
      // 0 against 0 and reported a pass. Every track must be a real, positive width before any
      // comparison between them means anything.
      assert.ok(w.every((n) => Number.isFinite(n) && n > 0), `every track has a real width (got ${wide.cols})`);
      assert.equal(wide.splitters, 2, 'two role=separator splitters');
      assert.ok(wide.valuenow.every((v) => v !== null),
        `a focusable separator without aria-valuenow is an ARIA error (got ${JSON.stringify(wide.valuenow)})`);
      assert.ok(Math.abs(w[2] - w[4]) < 2, `source and preview start equal (${w[2]} vs ${w[4]})`);
      assert.ok(wide.overflowX <= 0, `minmax(0,…) keeps the page off a horizontal scrollbar (${wide.overflowX}px)`);

      // THE EFFECT: the custom properties editor.js writes must actually move the tracks.
      const d = tracks(dragged);
      assert.ok(d[0] > w[0] + 50, `--w-list widened the list (${w[0]} -> ${d[0]})`);
      assert.ok(d[2] > d[4] * 2.5, `--w-src:--w-prev of 3:1 is honoured (${d[2]} vs ${d[4]})`);

      // THE REGRESSION THIS GUARDS: the preview was display:none below 900px, so the editor became
      // source-only with nothing on screen saying the live preview had been withdrawn.
      assert.notEqual(narrow.previewDisplay, 'none', 'the preview is NOT hidden at 860px');
      assert.ok(narrow.previewH > 100, `the stacked preview has real height (${narrow.previewH}px)`);
      assert.equal(tracks(narrow.cols).length, 1, 'one column when stacked');
      assert.equal(tracks(narrow.rows).length, 3, 'three rows: list, source, preview');
      assert.equal(narrow.splitterDisplay, 'none', 'splitters are hidden when stacked');
      assert.ok(narrow.overflowX <= 0, `no horizontal overflow at 860px (${narrow.overflowX}px)`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
