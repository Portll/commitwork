// An ESM specifier is a URL, not a path — asserted over HEAD, because this recurred 62 times.
//
// THE DEFECT. `await import(join(REPO, 'cra', 'lib.mjs'))` passes an ABSOLUTE PATH where a module
// specifier belongs. On POSIX `/abs/path` happens to resolve, so it works everywhere the authors
// ran it. On Windows `C:\...` parses as the scheme `c:` and node refuses it outright with
// ERR_UNSUPPORTED_ESM_URL_SCHEME. Measured 2026-09-04: 62 sites across 13 files, most of `cra/test`
// and part of `admin/test`, every one failing at import before a single assertion ran — which is to
// say the test suite could not run on this platform at all, and the noise looked like flakiness
// rather than one mechanical defect with one fix.
//
// THE SUBTLETY THAT MAKES A GUARD NECESSARY. `fileURLToPath()` is the right answer for a SPAWN
// ARGUMENT and the wrong answer for a SPECIFIER — and it is wrong in a way that is worse than what
// it replaced. Repairing a sibling defect (`new URL(...).pathname` used as a filesystem path) I
// converted one site that was an ESM specifier, turning `/C:/Repositories/...`, which node's loader
// tolerates, into `C:\Repositories\...`, which it rejects. The fix for one broke the other, and only
// running it caught that. So the rule has to be stated as a rule:
//
//   ESM specifier   -> pathToFileURL(p).href   or   new URL(rel, import.meta.url).href
//   spawn argument  -> fileURLToPath(url)      (a real path, with real separators)
//
// Read over HEAD rather than the working tree, like bin/test/tracked-imports.test.mjs and for the
// same reason: the property is about what a CLONE gets, and this tree always has sessions mid-edit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../lib/tracked-imports.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// THIS FILE IS EXCLUDED FROM ITS OWN SCAN, and the reason is the defect one level up rather than
// convenience. The negative control below contains the broken forms as STRING FIXTURES — it has to,
// because a guard with no proof it can fire is consistent with one that returns [] for everything,
// and this repo has been bitten by that four separate times. Scanning itself, the guard reads its
// own fixtures as findings: a scanner that cannot tell its subject from its own description of one.
// bin/lib/tracked-imports.mjs carries the same exclusion, for the same reason, in its own words.
const SELF = 'bin/test/esm-specifier-shape.test.mjs';
const sources = execFileSync('git', ['-C', CW, 'ls-files', '*.mjs'], { encoding: 'utf8' })
  .split('\n').filter(Boolean)
  .filter((f) => !f.startsWith('.claude/') && f !== SELF);

// ONE `git cat-file --batch` for the whole set. A `git show` per file is ~570 subprocesses and cost
// 50 s per test; the same walk over a batch stream is under a second. No `encoding` — the stream is
// length-delimited in BYTES and this tree is multi-byte dense, so decoding first would put character
// offsets against byte lengths.
const BLOBS = (() => {
  const listing = execFileSync('git', ['-C', CW, 'ls-tree', '-r', 'HEAD', '--format=%(objectname) %(path)'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean)
    .map((l) => { const i = l.indexOf(' '); return { sha: l.slice(0, i), path: l.slice(i + 1) }; })
    .filter((e) => sources.includes(e.path));
  const out = execFileSync('git', ['-C', CW, 'cat-file', '--batch'],
    { input: `${listing.map((e) => e.sha).join('\n')}\n`, maxBuffer: 512 * 1024 * 1024 });
  const map = new Map();
  let off = 0;
  for (const e of listing) {
    const nl = out.indexOf(0x0a, off);
    const size = Number(out.toString('utf8', off, nl).split(' ')[2]);
    map.set(e.path, out.toString('utf8', nl + 1, nl + 1 + size));
    off = nl + 1 + size + 1;
  }
  return map;
})();

const readHead = (f) => {
  const s = BLOBS.get(f);
  if (s === undefined) throw new Error(`no HEAD blob for ${f}`);
  return s;
};

// `import(` applied directly to a PATH BUILDER. These are the shapes that produced all 62 sites.
// `pathToFileURL(...)` and `new URL(...)` are correct and must not match.
const PATH_BUILDER_IMPORT = /\bimport\(\s*(?:await\s+)?(join|resolve|fileURLToPath|normalize|relative)\s*\(/;

test('no tracked source imports a PATH — a specifier is a URL', () => {
  assert.ok(sources.length > 200, `expected the tracked source set, got ${sources.length}`);
  const bad = [];
  for (const f of sources) {
    let src;
    try { src = readHead(f); } catch { continue; }   // staged-deleted; another guard owns that
    for (const [i, line] of stripComments(src).entries()) {
      if (PATH_BUILDER_IMPORT.test(line)) bad.push(`${f}:${i + 1}  ${line.trim().slice(0, 110)}`);
    }
  }
  assert.deepEqual(bad, [],
    'import() was given a filesystem path. On Windows an absolute path is not a valid ESM specifier '
    + '("C:\\..." parses as the scheme "c:") and node refuses it with ERR_UNSUPPORTED_ESM_URL_SCHEME. '
    + 'Use pathToFileURL(p).href, or new URL(rel, import.meta.url).href.');
});

test('no GENERATED child script embeds a bare absolute path as a specifier', () => {
  // The variant the bulk codemod could not see, because the specifier is built inside a template
  // literal that becomes a child process's source. This is where the regression above lived.
  //
  //   import('${somePath}')          <- interpolated INSIDE quotes: a path, and wrong
  //   import(${JSON.stringify(url)}) <- interpolated AS the argument: a url, and right
  const INTERPOLATED_IN_QUOTES = /\bimport\(\s*(['"])\$\{/;
  const bad = [];
  for (const f of sources) {
    let src;
    try { src = readHead(f); } catch { continue; }
    for (const [i, line] of stripComments(src).entries()) {
      if (INTERPOLATED_IN_QUOTES.test(line)) bad.push(`${f}:${i + 1}  ${line.trim().slice(0, 110)}`);
    }
  }
  assert.deepEqual(bad, [],
    'a generated child script interpolates a value INSIDE the specifier quotes. If that value is a '
    + 'path the child cannot import it on Windows. Interpolate the argument instead: '
    + 'import(${JSON.stringify(new URL(rel, import.meta.url).href)}).');
});

test('no GENERATED child script uses a PATH as a static import specifier', () => {
  // The third shape, and the one the first two missed. A test writes a child module as a template
  // literal and interpolates a path into a STATIC import:
  //
  //     import { x } from ${JSON.stringify(join(CW, 'bin/thing.mjs'))};
  //
  // JSON.stringify makes it a valid string literal, so it LOOKS quoted and correct — but the value
  // inside is still `C:\...`, which the child rejects with ERR_UNSUPPORTED_ESM_URL_SCHEME. Nine
  // sites had it. The earlier two patterns do not fire here: this is not `import(` applied to a
  // path builder, and the interpolation is not inside the specifier's quotes — it IS the quotes.
  // WIDENED after the first version missed two sites. It required `join(`/`resolve(` INLINE after
  // JSON.stringify, so `from ${JSON.stringify(LIB)}` — the same defect with the path in a variable —
  // sailed through, and bin/test/parse-gate.test.mjs kept dying at module load with
  // ERR_UNSUPPORTED_ESM_URL_SCHEME. Matching the shape rather than one spelling of it: ANY
  // interpolated specifier is suspect unless the expression names pathToFileURL, which is the only
  // correct way to produce one. That also makes the rule teachable in one line.
  // ANCHORED TO IMPORT POSITION, and the first widening was not. Requiring only `from ${…}` matched
  // ordinary prose inside template literals — "today's value is absent from ${file} as of ${when}",
  // "vendored bytes differ from ${item.pkg}" — and the guard reported six false positives in
  // product code on its first run. That is the over-reporting shape this repo treats as more
  // expensive than a miss, produced by a guard written to prevent a different one. The line must
  // BEGIN an import statement, which prose never does.
  const STATIC_PATH_SPECIFIER = /^\s*import\b[^;]*\bfrom\s*\$\{(?!.*pathToFileURL)[^}]*\}/;
  const bad = [];
  for (const f of sources) {
    let src;
    try { src = readHead(f); } catch { continue; }
    for (const [i, line] of stripComments(src).entries()) {
      if (STATIC_PATH_SPECIFIER.test(line)) bad.push(`${f}:${i + 1}  ${line.trim().slice(0, 110)}`);
    }
  }
  assert.deepEqual(bad, [],
    'a generated child script imports a filesystem PATH as a static specifier. Wrap it: '
    + 'JSON.stringify(pathToFileURL(join(...)).href).');
});

test('the guard can FAIL — the negative control', () => {
  // Everything above is consistent with a checker that returns [] for any input, and this repo has
  // been bitten by exactly that (four rounds of it in bin/lib/tracked-imports.mjs).
  const PATH_BUILDER_IMPORT2 = /\bimport\(\s*(?:await\s+)?(join|resolve|fileURLToPath|normalize|relative)\s*\(/;
  assert.ok(PATH_BUILDER_IMPORT2.test("const m = await import(join(REPO, 'cra', 'lib.mjs'));"));
  assert.ok(PATH_BUILDER_IMPORT2.test('await import(fileURLToPath(new URL("./x.mjs", import.meta.url)))'));
  assert.ok(PATH_BUILDER_IMPORT2.test("import(resolve(d, 'x.mjs'))"));
  // and it must NOT fire on the correct forms
  assert.ok(!PATH_BUILDER_IMPORT2.test("await import(pathToFileURL(join(d, 'x.mjs')).href)"));
  assert.ok(!PATH_BUILDER_IMPORT2.test("await import(new URL('../auth.mjs', import.meta.url).href)"));
  assert.ok(!PATH_BUILDER_IMPORT2.test("import('node:fs')"));
  // Assembled rather than written literally. Spelled out in full, this fixture is a syntactically
  // valid dynamic import of an untracked relative path, and bin/test/tracked-imports.test.mjs —
  // which matches dynamic imports ANYWHERE on a line, deliberately, since they can sit mid-
  // expression — reads it as a real edge and fails. Two guards, each correct, each seeing the
  // other's fixtures as findings. Keeping the two halves apart in the source is the cheaper fix
  // than teaching either one to recognise the other's tests.
  const IMP = 'import(';
  assert.ok(!PATH_BUILDER_IMPORT2.test(`${IMP}'../relative.mjs')`));

  const INTERP = /\bimport\(\s*(['"])\$\{/;
  assert.ok(INTERP.test("import('${somePath}').then(m => m)"));
  assert.ok(!INTERP.test('import(${JSON.stringify(url)}).then(m => m)'));

  // ...and the static-specifier shape, which JSON.stringify makes look correct.
  const STATIC = /^\s*import\b[^;]*\bfrom\s*\$\{(?!.*pathToFileURL)[^}]*\}/;
  assert.ok(STATIC.test("import { x } from ${JSON.stringify(join(CW, 'a.mjs'))};"));
  assert.ok(STATIC.test('import { x } from ${JSON.stringify(resolve(d, "a.mjs"))};'));
  assert.ok(STATIC.test('import { x } from ${JSON.stringify(LIB)};'),
    'the VARIABLE form too — requiring an inline join() is what let parse-gate through');
  assert.ok(STATIC.test('import { x } from ${SOME_PATH};'), 'and a bare interpolation');
  assert.ok(!STATIC.test("import { x } from ${JSON.stringify(pathToFileURL(join(CW, 'a.mjs')).href)};"),
    'the CORRECT form must not fire — a guard that flags the fix is worse than none');
  assert.ok(!STATIC.test('import { x } from ${JSON.stringify(pathToFileURL(LIB).href)};'));
  assert.ok(!STATIC.test("import { x } from './real.mjs';"));
  // NEGATIVE — prose. The first widening matched all of these, in product code, on its first run.
  assert.ok(!STATIC.test("  return `today's value is absent from ${file} as of ${when}`;"));
  assert.ok(!STATIC.test('  why: `vendored bytes differ from ${item.pkg}@${item.version}`,'));
  assert.ok(!STATIC.test('  console.log(`materialise a slice from ${spec}`);'));
});
