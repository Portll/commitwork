// Is HEAD closed over its own change set — for the contracts that are not imports?
//
// bin/test/tracked-imports.test.mjs reads HEAD and refuses a dangling import specifier or a named
// import the target does not export. A broken import THROWS; the contracts below do not. An
// unstyled class paints as nothing, an absent JSON field reads as undefined and a missing route
// 404s into a catch, so a pathspec commit that takes markup without its stylesheet, session fields
// or route still renders.
//
// This applies "a commit is closed over its own change set; nothing committed may reference
// something that is not" to the three non-import contracts the panel has: markup→stylesheet,
// page→API field, page→route.
//
// A RATCHET, NOT A GATE: the floor is recorded and anything NEW fails. Keys are LINE-FREE, as in
// bin/bare-catch-baseline.json, because a line-keyed identity converts unrelated movement into a
// state change. Per bin/gate-ratchet-core.mjs, do NOT baseline a co-author's break: banking someone
// else's half-landed change as the floor hides their next real one.
//
// This guard reads HEAD, deliberately: HEAD is the contract and the working tree is mid-edit. That
// makes it blind to the PRE-COMMIT window, where a working-tree file imports an untracked module.
// admin/test/static-asset-404.test.mjs covers that window by booting the WORKING-TREE serve.mjs in a
// HEAD worktree. Do not make that test read HEAD too: it is the one witness that does not share
// this guard's failure mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readPanelDocument } from '../lib/panel-document.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const BASELINE_PATH = join(HERE, 'fixtures', 'head-closure-baseline.json');

/** A blob at HEAD, or null if git cannot answer. Never the working tree — that is always mid-edit. */
function atHead(path) {
  try { return execFileSync('git', ['-C', REPO, 'show', `HEAD:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
}

// The page as HEAD serves it: HEAD's panel.html with HEAD's menu components expanded by the server's
// own readPanelDocument(), then the panel-*.js parts it loads.
// admin/index.html is a generated copy and is not read. Null if any piece is missing from HEAD,
// which skips below rather than reporting a clean page.
const HEAD_HTML = (() => {
  try {
    const doc = readPanelDocument((p) => {
      const blob = atHead(`admin/${p}`);
      if (blob == null) throw new Error(`HEAD has no admin/${p}`);
      return blob;
    });
    const parts = [...doc.matchAll(/<script src="\/static\/(panel-[\w-]+\.js)"><\/script>/g)]
      .map((m) => atHead(`admin/static/${m[1]}`));
    return parts.includes(null) ? null : [doc, ...parts].join('\n');
  } catch { return null; }
})();
const HEAD_SERVE = atHead('admin/serve.mjs');
const HEAD_CSS = ['admin/static/panel.css', 'admin/static/panel-light.css', 'admin/static/config.css',
  'admin/static/panel-cvd.css', 'admin/static/panel-cvd-light.css']
  .map(atHead).filter(Boolean).join('\n');
// The menu components ship their rules in the page's own <style> blocks, authorized by CSP hash.
// Those are committed rules for committed markup, so they answer a class as a stylesheet does.
const HEAD_INLINE_CSS = [...(HEAD_HTML || '').matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
  .map((m) => m[1]).join('\n');
// Route groups live in admin/routes/<area>.mjs and plug into serve.mjs.
const HEAD_ROUTES = (() => {
  try {
    return execFileSync('git', ['-C', REPO, 'ls-tree', '--name-only', 'HEAD', 'admin/routes/'], { encoding: 'utf8' })
      .split('\n').filter((f) => f.endsWith('.mjs')).map(atHead).filter(Boolean).join('\n');
  } catch { return ''; }
})();

// The committed static scripts, for the hook check below.
const HEAD_JS = (() => {
  try {
    return execFileSync('git', ['-C', REPO, 'ls-tree', '--name-only', 'HEAD', 'admin/static/'], { encoding: 'utf8' })
      .split('\n').filter((f) => f.endsWith('.js')).map(atHead).filter(Boolean).join('\n');
  } catch { return ''; }
})();

const HAVE_HEAD = Boolean(HEAD_HTML && HEAD_SERVE && HEAD_CSS);

/** Classes the committed markup carries, plus the ones its script assigns. */
function markupClasses(html) {
  const out = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    // A COMPUTED attribute is not checkable. `class="cra-${band(x)}"` yields the token `cra-`,
    // which is not a class anybody wrote. A class name that only exists after interpolation cannot
    // be matched against a stylesheet without running the page, so the whole attribute is skipped.
    if (m[1].includes('${')) continue;
    for (const c of m[1].split(/\s+/)) {
      if (/^[a-zA-Z][\w-]*$/.test(c) && !c.endsWith('-')) out.add(c);
    }
  }
  // Template literals build markup too — `class="${...}"` fragments are skipped deliberately, since
  // a computed class name cannot be checked against a stylesheet without executing the page.
  for (const m of html.matchAll(/classList\.(?:add|toggle)\(\s*'([a-zA-Z][\w-]*)'/g)) out.add(m[1]);
  for (const m of html.matchAll(/className\s*=\s*'([^']*)'/g)) {
    // Same trailing-dash rule as above: `className='cra-'+band` is a PREFIX, not a class.
    for (const c of m[1].split(/\s+/)) if (/^[a-zA-Z][\w-]*$/.test(c) && !c.endsWith('-')) out.add(c);
  }
  return out;
}

// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal name or class taken from the test itself
const styled = (css, cls) => new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(css);
// A class the committed script SELECTS on (`querySelector('.tri-truth')`, `closest('.as-toggle')`)
// is answered by JavaScript rather than by a stylesheet. It paints nothing by design and is not a
// dangling contract. Only selector calls count; a bare string mention is not a consumer.
// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal name or class taken from the test itself
const hooked = (js, cls) => new RegExp(
  `(?:querySelector(?:All)?|closest|matches)\\(\\s*['"\`][^'"\`]*\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`,
).test(js);

function currentBreaks() {
  const breaks = [];
  // ── markup → stylesheet, or markup → script hook ────────────────────────────────────────────
  const script = `${HEAD_HTML}\n${HEAD_JS}`;
  for (const cls of [...markupClasses(HEAD_HTML)].sort()) {
    if (!styled(`${HEAD_CSS}\n${HEAD_INLINE_CSS}`, cls) && !hooked(script, cls)) breaks.push(`admin/index.html::class::${cls}`);
  }
  // ── page → /auth/session field ──────────────────────────────────────────────────────────────
  // The page reads s.<field> off the session payload. A field the server does not send is not an
  // error anywhere: it is `undefined`, and `undefined` renders as whatever the fallback branch says.
  // THE BLOCK, NOT A FIXED WINDOW: once the session payload grows past a window, every field beyond
  // it reads as "the server does not send this".
  const sessionBlock = (() => {
    const at = HEAD_SERVE.indexOf("pathname === '/auth/session'");
    if (at < 0) return '';
    let depth = 0;
    for (let i = at; i < HEAD_SERVE.length; i++) {
      if (HEAD_SERVE[i] === '{') depth++;
      else if (HEAD_SERVE[i] === '}') { depth--; if (depth === 0) return HEAD_SERVE.slice(at, i + 1); }
    }
    return HEAD_SERVE.slice(at);
  })();
  // SCOPED TO initOauth. `s` is the session ONLY inside initOauth(); elsewhere in the page it is a
  // local in unrelated functions, and an unscoped /\bs\.(\w+)/ would fill the baseline with
  // "missing session fields" that are nothing of the kind.
  const initAt = HEAD_HTML.indexOf('async function initOauth()');
  const initBody = initAt > -1 ? HEAD_HTML.slice(initAt, HEAD_HTML.indexOf('\n}', initAt)) : '';
  if (sessionBlock && initBody) {
    for (const m of initBody.matchAll(/\bs\.([a-zA-Z][\w]*)\b/g)) {
      const f = m[1];
      if (!new RegExp(`\\b${f}\\s*:`).test(sessionBlock)) breaks.push(`admin/index.html::session-field::${f}`);
    }
  }
  // ── page → route ────────────────────────────────────────────────────────────────────────────
  const server = `${HEAD_SERVE}\n${HEAD_ROUTES}`;
  for (const m of HEAD_HTML.matchAll(/'(\/(?:api|auth)\/[a-z0-9/_-]{3,})'/gi)) {
    const route = m[1];
    // Match on the path as the server writes it; a route assembled from a prefix plus a stage (the
    // /auth/passkey/<stage> shape) is found by its last segment rather than reported as missing.
    // The server does not always spell a route the way the page does. `/auth/passkey/register/begin`
    // is answered by a prefix match on `/auth/passkey/` plus `stage === 'register/begin'`, so
    // looking for the whole path finds nothing and looking for the last segment alone ('begin')
    // finds it inside unrelated strings. Match on the last TWO segments, which is how a staged
    // route is actually written, then fall back to a quoted last segment.
    const parts = route.split('/').filter(Boolean);
    const pair = parts.slice(-2).join('/');
    const tail = parts[parts.length - 1];
    const known = server.includes(route)
      || new RegExp(`['\`]${pair}['\`]`).test(server)
      || new RegExp(`['\`]${tail}['\`]`).test(server);
    if (!known) breaks.push(`admin/index.html::route::${route}`);
  }
  return [...new Set(breaks)].sort();
}

// Exported so the baseline can be SEEDED from the same code that enforces it. A seeder with its
// own copy of the extraction would drift from the guard, and the drift would look like a clean floor.
export { currentBreaks, HAVE_HEAD };

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : null;

test('the guard can actually read HEAD — a skip must be loud, never a silent pass', (t) => {
  if (!HAVE_HEAD) {
    // A shallow clone, a detached environment, or no git. Reporting "clean" here would be the exact
    // false-clean this file exists to refuse, so it skips with a reason instead.
    t.skip('git could not produce HEAD blobs for the panel (panel.html, its components and parts) + serve.mjs + the stylesheets');
    return;
  }
  assert.ok(baseline && baseline.keys, `no baseline at ${BASELINE_PATH} — seed it rather than letting this pass on nothing`);
  // Anti-vacuity. A regex that stops matching would otherwise report a perfectly closed HEAD.
  assert.ok(markupClasses(HEAD_HTML).size > 60,
    `only ${markupClasses(HEAD_HTML).size} classes parsed out of committed markup — the extractor is broken and every assertion below would pass having examined nothing`);
  assert.ok(HEAD_CSS.length > 20000, 'the committed stylesheets did not load');
});

test('no NEW dangling contract in HEAD — markup without a rule, a field nobody sends, a route nobody answers', (t) => {
  if (!HAVE_HEAD || !baseline) { t.skip('HEAD unreadable — see the skip above'); return; }
  const now = currentBreaks();
  const known = new Set(Object.keys(baseline.keys));
  const fresh = now.filter((k) => !known.has(k));
  assert.deepEqual(fresh, [],
    'these are referenced by COMMITTED markup and answered by nothing committed:\n  '
    + fresh.join('\n  ')
    + '\n\nEvery one is silent at runtime — an unstyled class paints as nothing, an absent field is '
    + 'undefined, a missing route 404s into a catch.\n'
    + 'TWO CAUSES, and they need OPPOSITE fixes — establish which before acting. Either the other '
    + 'half is LOOSE (a pathspec commit took one side of somebody\'s open change: find it with git '
    + 'status and land it), or it was NEVER WRITTEN (nobody holds it; it has to be authored, and no '
    + 'commit will fix it). Distinguish by searching the whole TREE for the answering side, not just '
    + 'HEAD — e.g. `grep -rl "\\.<class>" --include=*.css`. Zero files anywhere means the second kind.\n'
    + 'Do NOT baseline a co-author\'s break — that banks their half-landed change as the permanent '
    + 'floor and hides their next real one. Separate yours from theirs first (git status, and the '
    + 'touch ledger at .claude/store/touches.jsonl filtered on the `f` key). The fix is almost never '
    + 'the baseline.');
});

test('the floor tightens — a contract that has been closed cannot sit in the baseline forever', (t) => {
  if (!HAVE_HEAD || !baseline) { t.skip('HEAD unreadable — see the skip above'); return; }
  // The mirror direction, and the one that keeps a ratchet honest. A baseline entry for something
  // that is now closed is stale debt reading as known-and-accepted — the same defect
  // panel-state-styling.test.mjs asserts about its own DEFERRED_CLASSES list.
  const now = new Set(currentBreaks());
  const stale = Object.keys(baseline.keys).filter((k) => !now.has(k));
  assert.deepEqual(stale, [],
    `these baseline entries are FIXED and should be removed so the floor comes down with them:\n  ${stale.join('\n  ')}`);
});
