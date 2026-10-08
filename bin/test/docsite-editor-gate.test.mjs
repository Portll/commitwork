// /edit/ ships in the PUBLIC docsite bundle while the drafting origin is session-gated, so an
// unauthenticated load is the NORMAL case, not an edge one. Before the gate, a 401 produced only a
// banner: the editor stayed laid out and the document list stayed empty — indistinguishable from a
// signed-in view of a site with no documents. That is the house rule's exact failure (an unknown
// rendering as a clean zero), one layer up from the scanners it usually describes.
//
// These are SOURCE-LEVEL assertions because editor.js is browser code with no DOM harness here.
// The contract they defend is CROSS-FILE: editor.js reaches for element ids that live in
// edit.html, and a gate whose ids do not exist fails silently and leaves the old behaviour —
// which is the failure mode this file exists to catch, not a hypothetical.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PAPER_CSS } from '../../lib/brand-tokens.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ED = join(HERE, '..', '..', 'docsite', 'editor');
const js = readFileSync(join(ED, 'editor.js'), 'utf8');
const html = readFileSync(join(ED, 'edit.html'), 'utf8');
const css = readFileSync(join(ED, 'editor.css'), 'utf8');

describe('the docsite editor names its unauthenticated state', () => {
  test('every id editor.js reaches for exists in edit.html — a gate with no element is a no-op', () => {
    const ids = [...js.matchAll(/getElementById\('([a-z-]+)'\)/g)].map((m) => m[1]);
    const gateIds = ids.filter((i) => i.startsWith('gate') || i === 'authgate');
    assert.ok(gateIds.length >= 4, `expected the gate to reference several ids, saw ${gateIds.length}`);
    for (const id of new Set(gateIds)) {
      assert.match(html, new RegExp(`id="${id}"`), `editor.js reads #${id} but edit.html does not define it`);
    }
  });

  test('THE DEFECT: a 401 must not leave the document list silently blank', () => {
    const block = js.slice(js.indexOf('async function loadList'), js.indexOf('async function loadDoc'));
    const four01 = block.slice(block.indexOf('401'));
    assert.match(four01, /doclistState\(/, 'the 401 path must write an explicit state into the list');
    assert.match(four01, /gate\(/, 'the 401 path must raise the gate, not only a banner');
  });

  test('an unreachable origin is also named, and is a DIFFERENT state from 401', () => {
    const block = js.slice(js.indexOf('async function loadList'), js.indexOf('async function loadDoc'));
    const unreachable = block.slice(0, block.indexOf('401'));
    assert.match(unreachable, /doclistState\(/, 'the unreachable path must write an explicit state');
    assert.match(unreachable, /gate\(/, 'the unreachable path must raise the gate');
    assert.notEqual(
      (block.match(/gate\('([^']+)'/g) || [])[0],
      (block.match(/gate\('([^']+)'/g) || [])[1],
      'unreachable and 401 must not present as the same state — they have different causes and different fixes',
    );
  });

  test('a SUCCESSFUL list lowers the gate — otherwise it would stick after signing in', () => {
    const block = js.slice(js.indexOf('async function loadList'), js.indexOf('async function loadDoc'));
    assert.match(block, /ungate\(\)/, 'the success path must lower the gate');
    assert.ok(block.indexOf('ungate()') > block.indexOf('401'), 'ungate must sit on the success path, after the refusals');
  });

  test('a genuinely empty manifest says so, rather than rendering nothing', () => {
    const block = js.slice(js.indexOf('function renderDoclist'), js.indexOf('function renderDoclist') + 900);
    assert.match(block, /docsCache\.length/, 'renderDoclist must handle the empty case explicitly');
  });

  test('the gate and the void row are styled — an unstyled overlay would not cover the editor', () => {
    assert.match(css, /#authgate\b/, 'no #authgate rule');
    assert.match(css, /#authgate\[hidden\]\s*\{\s*display:\s*none/, 'hidden must actually hide — [hidden] loses to display:grid otherwise');
    assert.match(css, /\.docrow-void\b/, 'no .docrow-void rule');
  });

  test('the gate element ships hidden, so an authenticated load never flashes it', () => {
    assert.match(html, /<div id="authgate" hidden>/, 'the gate must start hidden in the markup');
  });

  // A fallback hides an undefined name: the gate once read --page, --card and --accent, which
  // nothing defines, and so painted its light fallbacks under the dark theme.
  test('every custom property editor.css reads is defined by tokens.css, editor.css or editor.js', () => {
    const decl = (src) => [...src.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    const defined = new Set([...decl(PAPER_CSS), ...decl(css),
      ...[...js.matchAll(/setProperty\('(--[a-z0-9-]+)'/g)].map((m) => m[1])]);
    const read = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    assert.ok(read.has('--bg') && defined.has('--bg'), 'parsed nothing');
    const undefinedNames = [...read].filter((n) => !defined.has(n)).sort();
    assert.deepEqual(undefinedNames, ['--split-w'], '--split-w is the one knob read only through its fallback');
  });
});
