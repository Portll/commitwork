// The vendored IBM Plex faces: declared, present, reachable, and actually covering what the sheet
// asks for.
//
// A webfont is the purest form of this repo's dominant defect. `font-family:"IBM Plex Sans"` in a
// stylesheet is a REQUEST, and every way it can fail — the file is not on disk, the route was never
// added, the auth gate 401s it, the bytes are not a font — fails the same way the browser is
// designed to fail: silently, by moving to the next family in the stack. The page still renders.
// It renders in the fallback face, which on the authoring box is a perfectly nice system font, so
// the person who added the font is the person least able to notice it never arrived.
//
// So none of this is checked by looking at the panel. It is checked by joining the four lists that
// have to agree — what panel.css asks for, what serve.mjs declares, what is on disk, and what is
// readable without a session — and failing on any pair that does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(HERE, '..');
const CSS = readFileSync(join(ADMIN, 'static', 'panel.css'), 'utf8');
const SERVE = serverSource();

/** The array literal, read out of the source rather than imported — serve.mjs binds a port. */
function declaredList(name) {
  const at = SERVE.indexOf(`const ${name} = Object.freeze([`);
  assert.ok(at > -1, `${name} not found in admin/serve.mjs`);
  const end = SERVE.indexOf(']);', at);
  assert.ok(end > -1, `${name} is unterminated`);
  return [...SERVE.slice(at, end).matchAll(/'([^']+\.woff2)'/g)].map((m) => m[1]);
}

const DECLARED = declaredList('FONT_ASSETS');
/** Every url() in an @font-face src. */
const REFERENCED = [...CSS.matchAll(/url\("(\/static\/fonts\/[^"]+\.woff2)"\)/g)].map((m) => m[1]);
/** Each @font-face block, so weight/style/range can be read together. */
const FACES = [...CSS.matchAll(/@font-face\{([^}]*)\}/g)].map((m) => m[1]).map((b) => ({
  family: (b.match(/font-family:"([^"]+)"/) || [])[1],
  weight: +(b.match(/font-weight:(\d+)/) || [])[1],
  style: (b.match(/font-style:(\w+)/) || [])[1],
  range: /unicode-range:/.test(b),
  url: (b.match(/url\("([^"]+)"\)/) || [])[1],
}));

test('the extraction found something — this file must never pass vacuously', () => {
  assert.ok(DECLARED.length >= 8, `FONT_ASSETS parsed ${DECLARED.length} entries`);
  assert.ok(REFERENCED.length >= 8, `panel.css parsed ${REFERENCED.length} font urls`);
  assert.equal(FACES.length, REFERENCED.length, '@font-face blocks and url() references disagree — the parser is reading something it does not understand');
});

test('every font panel.css asks for is declared, present, and really a font', () => {
  for (const url of REFERENCED) {
    assert.ok(DECLARED.includes(url),
      `panel.css requests ${url}, which FONT_ASSETS does not declare — the server has no route for it, so it 404s and the browser falls back in silence`);
    const p = join(ADMIN, 'static', 'fonts', url.slice('/static/fonts/'.length));
    assert.ok(existsSync(p), `${url} is referenced and declared but is not on disk`);
    // Presence is not content. An empty or truncated file answers 200 and renders as a fallback.
    const buf = readFileSync(p);
    assert.ok(buf.length > 4096, `${url} is ${buf.length} bytes — too small to be a real face`);
    assert.equal(buf.subarray(0, 4).toString('latin1'), 'wOF2',
      `${url} does not start with the woff2 magic — a git-lfs pointer would look exactly like this`);
    // AND THE MAGIC BYTES ARE NOT ENOUGH, which was established by trying to fool them rather than
    // by reasoning about them. The failure this pair exists to catch is a font that has been read
    // and rewritten as text — the corruption the server's own readTxt would inflict. Round-tripping
    // a real woff2 through utf8 replaces every invalid byte with U+FFFD and leaves the file LONGER
    // than it was, and `wOF2` is four ASCII characters, so it survives untouched. The magic-byte
    // check passed on a deliberately corrupted file; it shares the corruption's own blind spot.
    // woff2's header declares the total file length at offset 8 (uint32, big-endian), and that
    // cannot survive bytes being substituted for longer ones. Two witnesses, one of which is
    // structurally incapable of agreeing with a text-mangled file.
    assert.equal(buf.readUInt32BE(8), buf.length,
      `${url} declares a total length of ${buf.readUInt32BE(8)} bytes in its woff2 header but is ${buf.length} on disk — it has been truncated, padded, or read and rewritten as text`);
    assert.equal(buf.indexOf(Buffer.from([0xEF, 0xBF, 0xBD])), -1,
      `${url} contains a U+FFFD replacement sequence — the literal signature of a binary file decoded as UTF-8`);
  }
});

test('the faces are TRACKED, not merely present on the machine that added them', () => {
  // THIS IS THE panel-light.css INCIDENT, ON A NEW ASSET CLASS. That stylesheet was referenced by
  // committed code and never committed itself; serve.mjs answered a missing asset with 200 and an
  // empty body, so the light theme did not exist for anybody but one box and nothing said so.
  // bin/test/tracked-assets.test.mjs exists because of it — and every assertion in THIS file was
  // written against the filesystem, which is the same blind spot rebuilt for fonts. A woff2 that is
  // present here and absent from the repository fails in the quietest way an asset can: the browser
  // takes the next family in the stack and the page still looks fine.
  //
  // HEAD, not the index — and that distinction is the whole assertion.
  //
  // This read `git ls-files`, which lists the INDEX. A font that had been `git add`ed and never
  // committed passed it: staged is not landed, a clone gets nothing, and the browser falls through
  // in silence exactly as if the file had never existed. A presence check standing in for a
  // durability check, which is the defect this test exists to catch, committed by the test itself.
  // Caught by another session, which hit the same thing using `ls-files --error-unmatch` to verify
  // their own evaluations were durable and re-checked after an operator broadcast.
  //
  // ls-tree reads the COMMIT. There is no state it can report as tracked that a fresh clone would
  // not receive.
  const tracked = new Set(
    execFileSync('git', ['-C', join(ADMIN, '..'), 'ls-tree', '-r', 'HEAD', '--name-only', 'admin/static/fonts'],
      { encoding: 'utf8' })
      .split('\n').filter(Boolean),
  );
  assert.ok(tracked.size > 0 || process.env.CW_FONTS_UNTRACKED_OK,
    'not one font under admin/static/fonts is tracked — panel.css references them, so a fresh clone renders in the fallback face and says nothing');
  const missing = REFERENCED
    .map((u) => `admin/static/fonts/${u.slice('/static/fonts/'.length)}`)
    .filter((p) => !tracked.has(p));
  assert.deepEqual(missing, [],
    `panel.css references these faces and git does not track them: ${missing.join(', ')} — they exist on this machine and nowhere else`);
  // The licence has to travel too, or the redistribution condition is unmet in every clone.
  assert.ok(tracked.has('admin/static/fonts/LICENSE-IBM-Plex.txt'),
    'the OFL text is not tracked — the fonts would ship without the licence the OFL requires travel with them');
});

test('nothing is declared that the stylesheet never asks for', () => {
  // The mirror direction. A stale entry costs a public route and a file nobody serves, and it makes
  // the declared list stop being evidence of what the panel actually uses.
  const orphans = DECLARED.filter((u) => !REFERENCED.includes(u));
  assert.deepEqual(orphans, [], `FONT_ASSETS declares fonts panel.css never references: ${orphans.join(', ')}`);
});

test('the fonts are readable WITHOUT a session, or the login page renders in another typeface', () => {
  // The login page loads panel.css. Behind the auth gate the faces 401, the browser falls through,
  // and the first screen an operator meets is the one screen in a different font.
  assert.match(SERVE, /\.\.\.FONT_ASSETS,/,
    'PUBLIC_ASSETS does not spread FONT_ASSETS — the unauthenticated login page cannot load the faces it is styled with');
  assert.match(SERVE, /FONT_SET\.has\(pathname\)/,
    'no route matches the declared font set');
  assert.match(SERVE, /'font\/woff2'/, 'the font route does not send a font content-type');
});

test('the binary route does not go through the utf8 reader', () => {
  // readTxt() is readFileSync(p,'utf8'). A woff2 through it comes back with every invalid byte
  // replaced by U+FFFD: a 200, the right content-type, and a corrupt font the browser discards
  // without a word. This is the one failure here that would survive every check above.
  // THE BLOCK, NOT A FIXED WINDOW. This sliced 600 characters from the match and grepped them,
  // which read past the font route into whatever happened to follow. A peer added STATIC_DIR() and
  // the window began catching a NEIGHBOURING route that legitimately uses sendAsset — so this test
  // failed while the code it guards was correct. Same defect as the tab-groups lift an hour
  // earlier: a fixed-width extractor reports on its neighbours and blames the wrong author.
  // Brace-matched to the block's own close, so surrounding code can move freely.
  const route = (() => {
    const at = SERVE.indexOf('FONT_SET.has(pathname)');
    assert.ok(at > -1, 'the font route is gone');
    let depth = 0;
    for (let i = at; i < SERVE.length; i++) {
      if (SERVE[i] === '{') depth++;
      else if (SERVE[i] === '}') { depth--; if (depth === 0) return SERVE.slice(at, i + 1); }
    }
    assert.fail('the font route block is unbalanced');
  })();
  assert.ok(!/readTxt|sendAsset/.test(route),
    'the font route reads through readTxt/sendAsset — utf8 decoding corrupts every non-ASCII byte in the file');
  assert.match(route, /readFileSync\(p\)/, 'the font route does not read raw bytes');
});

test('every @font-face carries a unicode-range', () => {
  // Only the Latin1 split is vendored. Without a range the browser considers Plex a candidate for
  // EVERY character and draws tofu for the ones the subset lacks — which is where this panel's
  // whole state vocabulary lives: ⧅ ✓ ✕ ■ ▶ ↻ ≡ ⏺. The range is what lets them fall through.
  for (const f of FACES) {
    assert.ok(f.range,
      `@font-face for ${f.url} has no unicode-range — every glyph outside the Latin1 subset would render as tofu instead of falling back`);
  }
  // ...and the fallback it falls through TO has to exist.
  assert.match(CSS, /--sans:"IBM Plex Sans",[^;]+sans-serif/, '--sans has no system fallback behind Plex');
  assert.match(CSS, /--mono:"IBM Plex Mono",[^;]+monospace/, '--mono has no system fallback behind Plex');
});

test('every weight the stylesheet asks for is a weight we ship', () => {
  // THE DEFECT THIS EXISTS FOR, caught once already. The sheet asked for 550 and 650 — weights IBM
  // Plex does not ship. They rendered correctly on macOS, where the system face is VARIABLE, and
  // snapped a full step heavier everywhere else and against Plex. A weight with no face behind it
  // is not an error anywhere: it is silently resolved to a neighbour, so the rule keeps working and
  // stops meaning what it says.
  const shipped = new Set(FACES.map((f) => f.weight));
  assert.ok(shipped.size >= 4, `only ${shipped.size} distinct weights parsed from @font-face`);
  const asked = new Set([...CSS.matchAll(/font-weight:(\d+)/g)].map((m) => +m[1]));
  // The @font-face declarations are themselves font-weight rules; they are the supply, not demand.
  const missing = [...asked].filter((w) => !shipped.has(w)).sort((a, b) => a - b);
  assert.deepEqual(missing, [],
    `panel.css asks for font-weight ${missing.join(', ')} and no @font-face supplies it — CSS font-matching will substitute a neighbouring weight without complaint`);
});

test('no font is fetched from anywhere but this origin', () => {
  // A CDN font would also make the report-only `default-src 'self'` unenforceable the day anyone
  // tries to enforce it, which is a slower and more expensive way to find out.
  const remote = [...CSS.matchAll(/url\(["']?(https?:)?\/\/[^)"']+/g)].map((m) => m[0]);
  assert.deepEqual(remote, [], `panel.css loads something off-origin: ${remote.join(', ')}`);
  assert.ok(!/@import/.test(CSS), 'panel.css gained an @import — the self-contained rule covers stylesheets too');
});

test('the OFL text ships beside the bytes it licenses', () => {
  // Condition 2 of the licence, and the one that is trivially forgotten because nothing breaks.
  const lic = join(ADMIN, 'static', 'fonts', 'LICENSE-IBM-Plex.txt');
  assert.ok(existsSync(lic), 'the fonts are vendored without their licence text — OFL 1.1 requires it travel with them');
  const txt = readFileSync(lic, 'utf8');
  assert.match(txt, /SIL OPEN FONT LICENSE Version 1\.1/, 'the shipped licence is not OFL 1.1');
  assert.match(txt, /Reserved Font Name/, 'the reserved-name clause is missing from the shipped licence');
  const src = join(ADMIN, 'static', 'fonts', 'SOURCE.txt');
  assert.ok(existsSync(src), 'no SOURCE.txt — a vendored asset with no recorded provenance is a version no lockfile knows');
  assert.match(readFileSync(src, 'utf8'), /sha512/i, 'SOURCE.txt records no hash for what was downloaded');
});
