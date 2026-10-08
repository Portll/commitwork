// NO COMMITTED PAGE OR ROUTE MAY REFERENCE AN ASSET ABSENT FROM HEAD.
//
// bin/test/tracked-imports.test.mjs enforces this for JavaScript import specifiers. Nothing
// enforced it for the things a browser fetches — stylesheets, scripts, images — and on 2026-08-26
// that gap was live: HEAD's admin/index.html:32 linked /static/panel-light.css and HEAD's
// serve.mjs served it, while the file had NEVER been committed.
//
// THE FAILURE MODE IS WHY THIS IS A TEST AND NOT A CONVENTION. serve.mjs's readTxt is
// `try { readFileSync } catch { return '' }` and the route is `send(200, readTxt(...), 'text/css')`
// with no existence check — so a fresh clone gets HTTP 200, text/css, EMPTY BODY. Not a 404, not a
// 500. An empty stylesheet is indistinguishable from one that needed no overrides, so the light
// theme silently did not exist for anybody but its author's machine and nothing anywhere said so.
// A bare catch converting an error into a clean-looking empty result, which is this repository's
// founding defect wearing a stylesheet.
//
// ── TWO DESIGN RULES, BOTH LEARNED THE HARD WAY IN THE EXCHANGE THAT PRODUCED THIS FILE ─────────
//
// 1. THE ASSET LIST IS DERIVED FROM THE SOURCE, NEVER HAND-KEPT. The first count of this defect was
//    made by enumerating the assets someone knew about: seven, one untracked. Deriving the list
//    from serve.mjs instead gives THIRTEEN, three untracked. A hand-kept list certifies its own
//    blind spot — it can only ever check the things its author already remembered.
//
// 2. BOTH SIDES ARE READ FROM HEAD, NEVER THE WORKING TREE. The corrected count then over-reported,
//    because it measured references in the working tree against files in HEAD: two of the three
//    untracked files are a session mid-work holding its references AND its files uncommitted
//    together, which is the discipline working, not failing. Mixing the two trees answers a
//    question about nobody's repository. It also matters operationally: a guard that reads the
//    working tree fires on every mid-work session and gets switched off inside a day, and a
//    switched-off gate is worse than no gate because it still looks installed.
//
// THE PAIRING IS THE UNIT, NOT THE FILE. "Referenced from HEAD and absent from HEAD" is one
// predicate that passes an uncommitted-but-unreferenced asset today and catches it the instant
// someone commits the page without the file. Same predicate, both directions, no special case.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const showHead = (p) => { try { return git('show', `HEAD:${p}`); } catch { return null; } };
const inHead = (p) => { try { git('cat-file', '-e', `HEAD:${p}`); return true; } catch { return false; } };
const headType = (p) => { try { return git('cat-file', '-t', `HEAD:${p}`).trim(); } catch { return null; } };

// Assets the SERVER hands out: every path built from `join(HERE, …)` string literals in the
// committed serve.mjs, WHICHEVER FUNCTION CONSUMES IT.
//
// It used to match `readTxt(join(HERE, …))` — naming the one helper that served assets on the day
// this was written. On 2026-08-26 the static routes moved to a new `sendAsset()` helper (a real
// improvement: it answers 404 for a missing file instead of 200-with-an-empty-body, which is the
// runtime half of the very defect this file exists to catch) and the derivation silently fell from
// 13 assets to 2. Every static asset left its view in one commit. The refactor was complete and
// nothing was actually broken — but the guard over the remaining two would have passed for the
// wrong reason indefinitely, and the ONLY thing that noticed was the non-triviality floor below.
//
// So the derivation no longer names a function. A helper renamed, wrapped or added tomorrow stays
// covered, because what is being matched is the shape of building a path inside the served
// directory from literals — which is the thing that actually implies "a browser can fetch this".
function servedAssets() {
  const src = showHead('admin/serve.mjs');
  assert.ok(src, 'HEAD has no admin/serve.mjs — the derivation has nothing to read');
  const out = new Set();
  // TWO SHAPES, because the code moved and this derivation did not follow it. 4b8aa13 replaced
  // `join(HERE, 'static', 'panel.css')` with `join(STATIC_DIR(), 'panel.css')` at every asset
  // route so the static root could be overridden — a good change that silently halved what this
  // function could see, from 12 assets to 5. Nothing failed on the missing seven; the FLOOR
  // assertion below is what caught it, which is the entire reason a derived list carries one.
  //
  // STATIC_DIR() is `CW_ADMIN_STATIC || join(HERE, 'static')`, so its literal parts are relative
  // to admin/static rather than to admin. Matching the call shape rather than the identifier would
  // be looser and no more honest: a future third helper must be added here deliberately, and the
  // floor is what will force that.
  const SHAPES = [
    [/\b[A-Za-z_$][\w$]*\(join\(HERE,\s*([^)]*)\)/g, ['admin']],
    [/\b[A-Za-z_$][\w$]*\(join\(STATIC_DIR\(\),\s*([^)]*)\)/g, ['admin', 'static']],
  ];
  for (const [re, prefix] of SHAPES) for (const m of src.matchAll(re)) {
    const parts = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    if (!parts.length) continue;
    const p = [...prefix, ...parts].join('/');
    // `scan(join(HERE, 'routes'))` and `scan(join(HERE, 'lib'))` build DIRECTORY paths. They are
    // not assets, and letting them through would put a tree into the byte-size check below, where
    // `cat-file -s` reports the size of the tree object rather than of anything a browser fetches.
    // Discriminated by asking git what the object IS, not by re-listing the directories by hand —
    // a hand-kept exclusion list has the same blind spot as the hand-kept asset list rule 1 rejects.
    if (headType(p) === 'tree') continue;
    out.add(p);
  }
  // THE PANEL PAGE IS ASSEMBLED, NOT READ. serve.mjs calls readPanelDocument(), which composes
  // panel.html with the fixed PARTS list in lib/panel-document.mjs. Those files are served exactly
  // as a readTxt()'d page was, so they are derived from that module rather than listed here.
  const doc = showHead('admin/lib/panel-document.mjs');
  if (/\breadPanelDocument\(\)/.test(src) && doc) {
    for (const m of doc.matchAll(/(?:readFileSync\(new URL\(|\bread\()'([\w.-]+)'/g)) out.add(`admin/${m[1]}`);
    const parts = doc.match(/const PARTS = new Set\(\[([^\]]*)\]\)/);
    if (parts) for (const m of parts[1].matchAll(/'([\w.-]+)'/g)) out.add(`admin/menus/${m[1]}`);
  }
  return out;
}

// Assets the committed PAGE asks the browser to fetch.
function referencedAssets() {
  const out = new Set();
  for (const page of ['admin/index.html', 'admin/config.html']) {
    const src = showHead(page);
    if (!src) continue;
    for (const m of src.matchAll(/(?:href|src)="\/static\/([A-Za-z0-9._-]+)"/g)) out.add(`admin/static/${m[1]}`);
  }
  return out;
}

// A referenced asset that is NOT in HEAD, with the reason it is tolerated. An entry here is a
// claim that somebody has DECIDED to leave it broken, not a way to quieten the gate. A stale
// entry — one whose file is now committed — fails, so the list cannot outlive its cause.
// Empty, and that is the state to keep it in. The one entry it held — admin/static/panel-light.css,
// referenced by HEAD and never committed — was ADOPTED on the operator's ruling 2026-08-26 rather
// than excused any longer, so the exception is spent and deleted in the same commit that tracks the
// file. The spend check below is what forced that pairing: leaving the entry would have failed.
const KNOWN_BROKEN = new Map([]);

describe('served and referenced assets exist in HEAD', () => {
  test('the asset list is DERIVED and non-trivial — a hand-kept list would prove little', () => {
    const served = servedAssets();
    assert.ok(served.size >= 10,
      `only ${served.size} assets derived from HEAD's serve.mjs; the extractor has probably stopped `
      + 'matching, and a guard over an empty set passes for the wrong reason');
    // THESE TWO ARE NOT ARBITRARY SAMPLES — they are served by DIFFERENT helpers, and that is the
    // whole point of naming them. panel.html is assembled by readPanelDocument(); panel.css goes
    // through sendAsset(). When the static routes moved between helpers, the size floor above caught
    // it, but so did panel.css going missing from the derivation. Keeping one asset from each family
    // pinned means a future split cannot quietly take half the surface with it.
    assert.ok(served.has('admin/panel.html'), 'the derivation missed the panel itself');
    assert.ok(served.has('admin/menus/navigation.js'), 'the derivation missed the panel\'s menu components');
    assert.ok(served.has('admin/static/panel.css'), 'the derivation missed the main stylesheet');
    // The derivation is function-agnostic, so it also sees the two scan(join(HERE, …)) DIRECTORY
    // paths. They must be filtered as trees rather than checked as assets — asserted here so the
    // filter cannot be dropped as redundant by someone who does not know what it was for.
    for (const dir of ['admin/routes', 'admin/lib']) {
      assert.ok(!served.has(dir), `${dir} is a directory, not an asset — it must not reach the byte-size check`);
    }
  });

  test('NO ASSET REFERENCED FROM HEAD IS ABSENT FROM HEAD', () => {
    const candidates = new Set([...servedAssets(), ...referencedAssets()]);
    const broken = [...candidates].filter((p) => !inHead(p)).sort();
    const undeclared = broken.filter((p) => !KNOWN_BROKEN.has(p));
    assert.deepEqual(undeclared, [],
      `these are referenced by committed code and are NOT in HEAD, so they load on the author's `
      + 'machine and nowhere else. serve.mjs answers 200 with an empty body for a missing file, so '
      + 'nothing will report this at runtime:\n  ' + undeclared.join('\n  '));
  });

  test('every declared exception still fires — a stale one is itself a failure', () => {
    const spent = [...KNOWN_BROKEN.keys()].filter((p) => inHead(p));
    assert.deepEqual(spent, [],
      'these are now committed, so their exception is spent and must be deleted rather than left '
      + 'to excuse a defect that no longer exists: ' + spent.join(', '));
  });

  test('every exception carries a real reason', () => {
    for (const [p, why] of KNOWN_BROKEN) {
      assert.ok(typeof why === 'string' && why.length > 80,
        `${p} is excused without a reason anyone can act on; an exception without one is a silence`);
    }
  });

  test('AND NO SERVED ASSET IS COMMITTED EMPTY — presence is not content', () => {
    // Raised by a peer session while this file was being written, and it is a genuine hole in the
    // check above: `git cat-file -e` answers "does this path exist in HEAD", not "does it have
    // anything in it". A committed-but-empty stylesheet produces the SAME 200-with-empty-body as a
    // missing one, from the same `send(200, readTxt(...))` route, and would sail past a
    // presence-only guard while being exactly as broken.
    //
    // The floor is 32 bytes, which is far below every real asset (measured in HEAD 2026-08-26:
    // smallest is cw-favicon.svg at 858, the rest 3.4KB-420KB) and far above a truncated or
    // zero-length write. It is a tripwire for a torn file, not a size policy.
    const short = [];
    for (const p of [...servedAssets(), ...referencedAssets()]) {
      if (!inHead(p) || KNOWN_BROKEN.has(p)) continue;
      const bytes = Number(git('cat-file', '-s', `HEAD:${p}`).trim());
      if (!Number.isFinite(bytes) || bytes < 32) short.push(`${p} (${bytes} bytes)`);
    }
    assert.deepEqual(short, [],
      'committed but effectively empty — served as 200 with a blank body, indistinguishable from '
      + 'an asset that needed no content:\n  ' + short.join('\n  '));
  });

  test('non-vacuous — a planted reference to a file that does not exist is caught', () => {
    // Without this, the assertion above would pass against an inHead() that returned true for
    // everything, which is exactly how a gate stops guarding without anyone noticing.
    assert.equal(inHead('admin/static/definitely-not-a-real-asset.css'), false);
    assert.equal(inHead('admin/static/panel.css'), true);
  });
});
