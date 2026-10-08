// Does every relative import in a TRACKED file point at another TRACKED file?
//
// THE DEFECT THIS EXISTS TO CLOSE, and it is mine: on 2026-08-25 a commit landed
// `import './advisory-reach.mjs'` into monitor/rollup.mjs while that module was UNTRACKED. The
// author's tree resolved it, their tests passed, and HEAD could not load for anybody else. A fresh
// checkout or a clone got a rollup that threw on import.
//
// It is invisible from inside the tree that produced it, which is the whole shape: existence in the
// author's working directory is not existence in the repository, and every local check answers the
// first question while every consumer asks the second. `node --check` passes. The tests pass. The
// import resolves. Nothing is wrong until someone who is not you looks.
//
// Deliberately NOT a rule about commit hygiene — this repo has fourteen concurrent writers on
// monitor/rollup.mjs alone, and a convention that has to be remembered by all fourteen is a
// convention that fails again the same week. This is checkable, so it is checked.

import { posix } from 'node:path';

/** Specifiers this module can decide. Bare imports (node:, npm) are another system's problem. */
const RELATIVE = /^\.\.?\//;

/**
 * Extract relative specifiers from source text.
 *
 * Covers static `from '...'`, side-effect `import '...'`, and dynamic `import('...')`.
 *
 * fact: comments AND template literals are stripped first / this file's own header talks ABOUT `import './advisory-reach.mjs'`, and bin/test/minify-detect.test.mjs WRITES fixture modules whose source is a template literal containing `import { A } from './builder.js'` — a tmpdir file that will never be tracked (expiry: never, prev: broken)
 * fact: reading either as a real import is this checker's own defect one level up — a scanner that cannot tell its subject from its own description of it (expiry: never, prev: broken)
 */
export function relativeSpecifiers(src) {
  // fact: matching is LINE-ANCHORED because a STATIC import must BEGIN a statement, which no string-embedded copy of one ever does / distinguishing a regex literal from division needs a real parser and there is not one here (expiry: if a parser is adopted, prev: broken)
  // fact: design 1, a regex pass, read fixture strings as code — it reported the `import { A } from './builder.js'` that bin/test/minify-detect.test.mjs WRITES into a tmpdir module (expiry: never, prev: broken)
  // fact: design 2, a hand-rolled tokenizer, desynced on REGEX LITERALS containing quotes (`/class="…"/` opens a string state that never closes), so unrelated strings landed in specifier position and it invented `../monitor/check-vocabulary.mjs`, a path present nowhere in the file (expiry: never, prev: broken)
  const lines = stripComments(src);

  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*(import|export)\b/.test(lines[i])) continue;
    // Multi-line import blocks are the norm in this tree (monitor/rollup.mjs imports 18 names over
    // five lines), so join forward until the statement's specifier appears or it clearly ends.
    let stmt = lines[i];
    for (let j = i + 1; j < lines.length && !/from\s*['"]|['"]\s*;?\s*$/.test(stmt) && j - i < 25; j += 1) {
      stmt += ` ${lines[j]}`;
    }
    const m = /\bfrom\s*['"]([^'"]+)['"]/.exec(stmt) || /^\s*import\s*['"]([^'"]+)['"]/.exec(stmt);
    if (m && RELATIVE.test(m[1])) out.push(m[1]);
  }

  // Dynamic imports can legitimately sit mid-expression, so they are matched anywhere — but a
  // specifier carrying an interpolation is not statically resolvable and is not this check's
  // business (bin/test/agent-tag.test.mjs cache-busts with `?t=${Math.random()}`).
  for (const m of lines.join('\n').matchAll(/\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
    const spec = m[1];
    if (RELATIVE.test(spec) && !spec.includes('${')) out.push(spec.replace(/\?.*$/, ''));
  }
  return [...new Set(out)];
}

/**
 * Strip comments WITHOUT a whole-file block-comment regex.
 *
 * The obvious `/\*[\s\S]*?\*\/` is wrong here: a glob string such as '*<SLASH>node_modules<SLASH>*'
 * in bin/commitwork.mjs contains a comment-opening pair, so it opens a "comment" that runs to the
 * next closer anywhere later in the file. Measured across this tree before it was fixed: it
 * swallowed 1,375 lines of admin/serve.mjs, 515 of monitor/rollup.mjs, 119 of bin/commitwork.mjs —
 * 35 files in all. A scanner blinded that way reports a CLEAN tree it never read, which is the
 * flattering direction, and it had already shipped.
 *
 * So: same-line pairs are removed inline (a glob cannot close one on its own line), and a
 * multi-line block comment is entered only when a line BEGINS with the opener — which is how every
 * doc and section comment in this codebase is written, and no string literal is.
 */
export function stripComments(src) {
  const OPEN = '/*';
  const CLOSE = '*' + '/';
  const out = [];
  let inBlock = false;
  // `split(/\r?\n/)`, not `split('\n')` — and this is a correctness bug, not tidiness.
  //
  // Git for Windows checks out CRLF by default (core.autocrlf=true), so on Windows every line in
  // the working tree ends `\r`. Splitting on '\n' alone leaves that `\r` as the last character of
  // every line, and the line-comment stripper below is `/(^|[^:])\/\/.*$/` — in JavaScript `.`
  // does NOT match `\r`, and `$` without the `m` flag matches only at the very end of the string.
  // So `.*$` could never span the trailing `\r`, the regex never matched, and NO `//` COMMENT WAS
  // EVER STRIPPED ON WINDOWS.
  //
  // Measured on this very file 2026-09-04: its own line-32 comment quotes
  // `import { A } from './builder.js'` while explaining an earlier false positive, and the
  // extractor read that prose as a real import — reporting a dangling `./builder.js` that exists
  // nowhere. The file documenting the bug reproduced the bug, for the sixth time in this module,
  // and only the V8 second witness could tell them apart. Which is the argument for the second
  // witness in one line: the regexes were confident and wrong, on a platform nobody ran them on.
  for (let line of String(src).split(/\r?\n/)) {
    if (inBlock) {
      const end = line.indexOf(CLOSE);
      if (end === -1) { out.push(''); continue; }
      line = line.slice(end + 2); inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, ' ');
    if (line.trimStart().startsWith(OPEN)) { inBlock = true; out.push(''); continue; }
    out.push(line.replace(/(^|[^:])\/\/.*$/, '$1'));
  }
  return out;
}

/**
 * The candidate paths a specifier could legitimately resolve to, in resolution order.
 *
 * POSIX SEPARATORS, ALWAYS — and this is the whole correctness of the function, not a detail.
 * The `tracked` set these are looked up in comes from `git ls-tree` / `git ls-files`, and git
 * reports paths with forward slashes on every platform including Windows. This used to build
 * candidates with `path.join`, which is `path.win32.join` on Windows and emits backslashes, so
 * `set.has('a\\two.mjs')` was false for the tracked `a/two.mjs`.
 *
 * The consequence was not a near miss. EVERY relative import in the repository was reported as
 * dangling on Windows — measured 2026-09-04, the whole suite red with the tracked targets sitting
 * in HEAD the entire time. A gate that fails on everything is indistinguishable from a gate that
 * is switched off, because the only sustainable response to it is to stop reading it; and this is
 * the gate CLAUDE.md names as the enforcement of "a commit is closed over its own change set".
 *
 * It is also this file's fifth false-positive mechanism, after the fixture string read as code,
 * the tokenizer desyncing on regex literals, the glob opening a 1,375-line phantom comment, and
 * the twelve phantom missing exports downstream of that. Same signature as all four: the guard
 * reporting confidently about a tree it had not actually read.
 */
export function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

export function candidatesFor(fromFile, spec) {
  const base = posix.normalize(posix.join(posix.dirname(toPosix(fromFile)), toPosix(spec)));
  return [base, `${base}.mjs`, `${base}.js`, posix.join(base, 'index.mjs'), posix.join(base, 'index.js')];
}

// The tracked set is normalised on the way in as well. git gives forward slashes today, so this
// changes nothing today — it is here so that a caller passing OS-native paths (a future one, or a
// test) cannot silently reintroduce the separator mismatch on one side while the other is fixed.
function trackedSet(tracked) {
  const src = tracked instanceof Set ? tracked : new Set(tracked);
  const out = new Set();
  for (const p of src) out.add(toPosix(p));
  return out;
}

/**
 * -> [{ file, spec, tried }] for every relative import that resolves to nothing TRACKED.
 *
 * `tracked` is the authority, not the filesystem. Reading the disk here would reproduce the exact
 * blindness the check exists to remove — the author's tree always resolves.
 */
export function danglingImports(files, readFile, tracked) {
  const set = trackedSet(tracked);
  const out = [];
  for (const file of files) {
    let src;
    try { src = readFile(file); } catch { continue; }   // unreadable is a different problem
    for (const spec of relativeSpecifiers(src)) {
      const tried = candidatesFor(file, spec);
      if (!tried.some((c) => set.has(c))) out.push({ file, spec, tried });
    }
  }
  return out;
}

// ── the other half of a broken edge ───────────────────────────────────────────────────────────
// A resolvable import is not a working one. A commit landed as the THIRD piece of a half-landed
// change: HEAD spread ...leaksCheckRoutes into MODULAR_ROUTES, the route file and its import landed
// in another, and the symbol it imported was never exported. Every specifier resolved. The panel
// still could not boot. danglingImports() checks that the edge points somewhere; this checks that
// what it points at is actually there.

/** Names a module exports. `star: true` means `export * from` — its surface is not statically knowable. */
export function exportedNames(src) {
  const lines = stripComments(src);
  const names = new Set();
  let star = false;
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (!/^\s*export\b/.test(l)) continue;
    if (/^\s*export\s+\*/.test(l)) { star = true; continue; }
    if (/^\s*export\s+default\b/.test(l)) { names.add('default'); continue; }
    const decl = /^\s*export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/.exec(l);
    if (decl) { names.add(decl[1]); continue; }
    // `export { a, b as c }`, possibly across lines
    if (/^\s*export\s*\{/.test(l)) {
      let block = l;
      for (let j = i + 1; j < lines.length && !block.includes('}'); j += 1) block += ` ${lines[j]}`;
      const inner = /\{([^}]*)\}/.exec(block);
      if (inner) {
        for (const part of inner[1].split(',')) {
          const m = /(?:\bas\s+([A-Za-z_$][\w$]*)|^\s*([A-Za-z_$][\w$]*))\s*$/.exec(part.trim());
          if (m) names.add(m[1] || m[2]);
        }
      }
    }
  }
  return { names, star };
}

/** -> [{ spec, names }] for static imports carrying NAMED bindings. Default/namespace are skipped. */
export function namedImports(src) {
  const lines = stripComments(src);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*import\s*\{/.test(lines[i])) continue;
    let stmt = lines[i];
    for (let j = i + 1; j < lines.length && !/from\s*['"]/.test(stmt) && j - i < 25; j += 1) stmt += ` ${lines[j]}`;
    const spec = /\bfrom\s*['"]([^'"]+)['"]/.exec(stmt);
    const inner = /\{([^}]*)\}/.exec(stmt);
    if (!spec || !inner || !RELATIVE.test(spec[1])) continue;
    const names = inner[1].split(',').map((p) => {
      const t = p.trim();
      if (!t) return null;
      const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+[A-Za-z_$][\w$]*)?$/.exec(t);
      return m ? m[1] : null;
    }).filter(Boolean);
    if (names.length) out.push({ spec: spec[1], names });
  }
  return out;
}

/** -> [{ file, spec, name }] for every named import whose target does not export that name. */
export function missingExports(files, readFile, tracked) {
  const set = trackedSet(tracked);
  const cache = new Map();
  const surfaceOf = (p) => {
    if (!cache.has(p)) { try { cache.set(p, exportedNames(readFile(p))); } catch { cache.set(p, null); } }
    return cache.get(p);
  };
  const out = [];
  for (const file of files) {
    let src; try { src = readFile(file); } catch { continue; }
    for (const { spec, names } of namedImports(src)) {
      const target = candidatesFor(file, spec).find((c) => set.has(c));
      if (!target) continue;                       // dangling — danglingImports() owns that
      const surface = surfaceOf(target);
      if (!surface || surface.star) continue;      // re-exported surface is not statically knowable
      for (const n of names) if (!surface.names.has(n)) out.push({ file, spec, name: n, target });
    }
  }
  return out;
}

// ── V8's own parser, which is not guessing ────────────────────────────────────────────────────
// Everything above extracts specifiers with regexes, and that approach produced FOUR rounds of
// false positives before it was right — a fixture string read as code, a tokenizer desyncing on
// regex literals containing quotes, a glob string opening a 1,375-line phantom comment, and twelve
// phantom missing exports downstream of it. Each was fixed and a new one appeared, which is the
// signature of an approach rather than of bugs.
//
// `vm.SourceTextModule` PARSES at construction. Link and evaluate are separate explicit steps that
// are never called here, so nothing runs: verified against monitor/rollup.mjs, which calls
// process.exit() during evaluation and publishes rollup.json — 23 specifiers returned, status
// `unlinked`, nothing written, exit 0. Comments and template literals stop being a category of
// problem rather than being handled better.
//
// Requires `--experimental-vm-modules`. It THROWS when absent rather than falling back to the
// regex path: a silent downgrade to a known-unsound extractor is how a checker reports a clean
// tree it never read, and this file already did that once.

/** Exact dependency specifiers, from the parser that would actually load the file. */
export async function dependenciesOf(src, identifier = 'anonymous.mjs') {
  const vm = await import('node:vm');
  if (typeof vm.SourceTextModule !== 'function') {
    throw new Error('vm.SourceTextModule unavailable — run node with --experimental-vm-modules. '
      + 'Refusing to fall back to the regex extractor, which is unsound by measurement.');
  }
  const m = new vm.SourceTextModule(String(src), { identifier });
  return m.dependencySpecifiers.slice();
}

/**
 * Dynamic `import()` specifiers, which V8 does NOT report.
 *
 * MEASURED, because the obvious assumption is wrong and expensive: `dependencySpecifiers` covers
 * STATIC imports only. A dynamic `await import('../auth.mjs')` is absent from it — verified
 * directly, and this tree contains FIFTY of them. Swapping wholesale to the parser would have
 * blinded this guard to every one, which is a false clean introduced by the fix for false cleans.
 *
 * So this stays a scan, over a far smaller surface than the extractor it replaced: a literal
 * argument to `import(`. A computed specifier is not statically decidable by anything and is out
 * of scope for every implementation, V8 included.
 */
export function dynamicSpecifiers(src) {
  const out = [];
  for (const m of stripComments(src).join('\n').matchAll(/\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
    if (RELATIVE.test(m[1]) && !m[1].includes('${')) out.push(m[1].replace(/\?.*$/, ''));
  }
  return [...new Set(out)];
}

/**
 * The relative subset: V8 for static (exact), a bounded scan for dynamic (V8 cannot supply it).
 * Hybrid on purpose — neither half covers the other, and using only one is a measured blind spot.
 */
export async function relativeDependenciesOf(src, identifier) {
  const stat = (await dependenciesOf(src, identifier))
    .filter((x) => RELATIVE.test(x))
    .map((x) => x.replace(/\?.*$/, ''));
  return [...new Set([...stat, ...dynamicSpecifiers(src)])];
}
