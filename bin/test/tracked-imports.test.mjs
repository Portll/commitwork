// A tracked file may not import an untracked one — asserted over THIS repository, and over
// fixtures that prove the checker can fail.
//
// The instance: a commit added `import './advisory-reach.mjs'` to monitor/rollup.mjs while that
// module was untracked, so HEAD could not load for anyone but its author. It was backed out.
// Fourteen sessions write monitor/rollup.mjs concurrently, which is why this is a checked property
// rather than a convention somebody has to remember.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { relativeSpecifiers, candidatesFor, danglingImports, stripComments,
  namedImports, missingExports } from '../lib/tracked-imports.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// HEAD, not the working tree. The property is about what a CLONE gets, and this tree always has
// several sessions mid-edit — reading the working copy would fail on legitimate in-flight work
// (measured 2026-08-25: six uncommitted import/untracked-module pairs across five files, none of
// them committed, each belonging to a different session). Committing one is the moment it becomes
// everyone's problem, and that is the moment this must fail.
const head = execFileSync('git', ['-C', CW, 'ls-tree', '-r', 'HEAD', '--format=%(objectname) %(path)'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean)
  .map((l) => { const i = l.indexOf(' '); return { sha: l.slice(0, i), path: l.slice(i + 1) }; });
const TRACKED = new Set(head.map((e) => e.path));
const SOURCES = head.filter((e) => /\.mjs$/.test(e.path) && !e.path.startsWith('.claude/'));

// One `git cat-file --batch` for the whole set rather than a subprocess per file.
const BLOBS = (() => {
  // No `encoding` — a Buffer is required, because the batch stream is length-delimited in BYTES and
  // this tree is multi-byte dense. Decoding first would put character offsets against byte lengths.
  const out = execFileSync('git', ['-C', CW, 'cat-file', '--batch'],
    { input: `${SOURCES.map((e) => e.sha).join('\n')}\n`, maxBuffer: 512 * 1024 * 1024 });
  const map = new Map();
  let off = 0;
  for (const e of SOURCES) {
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

test('the checker can FAIL — an untracked target is reported', () => {
  // The negative control, first. Everything below is consistent with a checker that returns [] for
  // any input, and this repo has been bitten by exactly that.
  const files = ['a/one.mjs'];
  const read = () => "import { x } from './two.mjs';\n";
  assert.deepEqual(danglingImports(files, read, new Set(['a/one.mjs'])).map((d) => d.spec), ['./two.mjs'],
    'an import of a file absent from the tracked set must be reported');
  assert.deepEqual(danglingImports(files, read, new Set(['a/one.mjs', 'a/two.mjs'])), [],
    'and must NOT be reported once the target is tracked');
});

test('it decides on the TRACKED set, never the filesystem', () => {
  // The blindness being removed: the author's disk always resolves. A checker that stat()s would
  // pass on the machine that broke main and fail nowhere.
  const real = 'monitor/extractors.mjs';
  assert.ok(TRACKED.has(real), 'fixture assumption: extractors.mjs is tracked');
  const found = danglingImports(['monitor/rollup.mjs'], () => `import x from './${'extractors.mjs'}';`, new Set(['monitor/rollup.mjs']));
  assert.equal(found.length, 1, 'a file that exists on disk but is absent from the tracked set is still dangling');
});

test('extensionless and index specifiers resolve the way node does', () => {
  const c = candidatesFor('monitor/rollup.mjs', './lib/thing');
  assert.ok(c.includes('monitor/lib/thing.mjs'));
  assert.ok(c.includes('monitor/lib/thing/index.mjs'));
  assert.deepEqual(danglingImports(['m/a.mjs'], () => "import './b';", new Set(['m/a.mjs', 'm/b.mjs'])), [],
    'an extensionless import of a tracked .mjs is fine');
});

test('prose about an import is not an import', () => {
  // This checker's own source discusses `import './advisory-reach.mjs'` in a comment. A scanner
  // that reads its own explanation as code is the defect it exists to catch, one level up.
  assert.deepEqual(relativeSpecifiers("// see import './ghost.mjs' for why\nconst a = 1;\n"), []);
  assert.deepEqual(relativeSpecifiers("/* import './ghost.mjs' */\nimport x from './real.mjs';\n"), ['./real.mjs']);
});

test('multi-line import blocks are followed to their specifier', () => {
  // monitor/rollup.mjs imports 18 names across five lines; a line-anchored scanner that did not
  // join forward would silently see none of them and report a clean file.
  assert.deepEqual(relativeSpecifiers("import {\n  a,\n  b,\n} from './wide.mjs';\n"), ['./wide.mjs']);
});

test('THE KNOWN LIMIT: a static import that does not begin its line is not seen', () => {
  // Stated as a test rather than left implicit, because this is the direction that fails SHORT —
  // a missed import is a dangling reference this check would wave through, which is worse than a
  // false positive. `import './x.mjs'` after a semicolon mid-line is legal and would be missed.
  assert.deepEqual(relativeSpecifiers("const u = 'x'; import './real.mjs';"), [],
    'documented blind spot — if this ever starts returning the specifier, the limit is gone and this test should be deleted');

  // And the reason it is tolerable HERE, measured rather than assumed: no tracked source in this
  // repo writes one. If that changes, this fails and the extractor needs a real parser.
  const offenders = [];
  for (const e of SOURCES) {
    for (const line of readHead(e.path).split('\n')) {
      // Comments out, then DOUBLE-quoted and template spans out — those are how a fixture embeds
      // code, and a real specifier in this repo is single-quoted. Without this the tripwire fires
      // on the assertion three lines above, which is a description of the defect and not one.
      const stripped = line.replace(/(^|[^:])\/\/.*$/, '$1')
        .replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/`(?:\\.|[^`\\])*`/g, '``');
      if (/;\s*import\s+'\.\.?\//.test(stripped)) offenders.push(`${e.path}: ${line.trim().slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, [], 'a mid-line static import exists in HEAD, so the blind spot is now load-bearing');
});

test('bare and package specifiers are out of scope, not silently passed', () => {
  assert.deepEqual(relativeSpecifiers("import { test } from 'node:test';\nimport z from 'some-pkg';"), [],
    'this checker decides relative imports only — a bare specifier is another system\'s contract');
});

test('NO TRACKED SOURCE IMPORTS AN UNTRACKED FILE', () => {
  // Non-vacuity before the assertion: if the enumeration breaks, this must fail loudly rather than
  // report a clean tree it never walked.
  const paths = SOURCES.map((e) => e.path);
  assert.ok(paths.length > 100, `expected >100 .mjs sources in HEAD, found ${paths.length} — the walk is blind`);
  const totalSpecs = paths.reduce((n, f) => n + relativeSpecifiers(readHead(f)).length, 0);
  assert.ok(totalSpecs > 100, `expected >100 relative imports in HEAD, found ${totalSpecs} — the extractor is blind`);

  const dangling = danglingImports(paths, readHead, TRACKED);
  assert.deepEqual(dangling.map((d) => `${d.file} -> ${d.spec}`), [],
    'a committed file importing an untracked one loads on the author\'s machine and nowhere else');
});

test('a fixture module WRITTEN by a test is not an import BY that test', () => {
  // The two false positives this checker produced on its first real run, both in
  // bin/test/minify-detect.test.mjs: it writes fixture modules into a tmpdir whose SOURCE is a
  // template literal containing `import { A } from './builder.js'`. Those files are created at run
  // time and must never be tracked. A checker that cannot tell a subject from a description of one
  // fails in the flattering direction — it reports work for someone to do that is already correct.
  const src = "write(d, 'sink.js', `import { A } from './builder.js';\\n`);\n"
    + "import { real } from './actually-imported.mjs';\n";
  assert.deepEqual(relativeSpecifiers(src), ['./actually-imported.mjs']);
});

// ── comment stripping, which had blinded the guard above ──────────────────────────────────────
test('a glob string does not open a block comment', () => {
  // THE BUG THIS PINS, and it had already shipped: `/\*[\s\S]*?\*\//g` treats the pair inside
  // '*<slash>node_modules<slash>*' as a comment opener, swallowing everything to the next closer
  // anywhere later in the file — 1,375 lines of admin/serve.mjs, 515 of monitor/rollup.mjs, 119 of
  // bin/commitwork.mjs, 35 files in all. The guard then reported a clean tree it had never read.
  const src = "const args = ['-not', '-path', '*/node_modules/*'];\n"
    + "import { real } from './target.mjs';\n";
  assert.deepEqual(relativeSpecifiers(src), ['./target.mjs'],
    'an import after a glob string must still be seen — this is a FALSE NEGATIVE, the flattering direction');
  assert.ok(stripComments(src).join('\n').includes('./target.mjs'));
});

test('multi-line block comments are still stripped', () => {
  const src = "/*\n import './ghost.mjs'\n*/\nimport { a } from './real.mjs';\n";
  assert.deepEqual(relativeSpecifiers(src), ['./real.mjs']);
});

test('a trailing same-line block comment is stripped without eating the file', () => {
  const src = "try { x(); } catch { /* best effort */ }\nimport { a } from './real.mjs';\n";
  assert.deepEqual(relativeSpecifiers(src), ['./real.mjs']);
});

// ── the other half of a broken edge: the name must exist ──────────────────────────────────────
test('missingExports FAILS on a name the target does not export', () => {
  const files = ['a/one.mjs'];
  const read = (f) => (f === 'a/one.mjs'
    ? "import { present, absent } from './two.mjs';\n"
    : 'export function present() {}\n');
  const tracked = new Set(['a/one.mjs', 'a/two.mjs']);
  assert.deepEqual(missingExports(files, read, tracked).map((x) => x.name), ['absent'],
    'a resolvable import of a name that is not exported is a broken edge with a working specifier');
});

test('an export list longer than 25 lines is read to its closing brace', () => {
  const names = Array.from({ length: 40 }, (_, i) => `n${i}`);
  const read = (f) => (f === 'a/one.mjs'
    ? `import { n0, n39 } from './two.mjs';\n`
    : `${names.map((n) => `const ${n} = 1;`).join('\n')}\nexport {\n  ${names.join(',\n  ')},\n};\n`);
  assert.deepEqual(missingExports(['a/one.mjs'], read, new Set(['a/one.mjs', 'a/two.mjs'])), []);
});

test('a re-exporting module is not judged — its surface is not statically knowable', () => {
  const read = (f) => (f === 'a/one.mjs' ? "import { anything } from './two.mjs';\n" : "export * from './three.mjs';\n");
  assert.deepEqual(missingExports(['a/one.mjs'], read, new Set(['a/one.mjs', 'a/two.mjs'])), [],
    'export * means this checker cannot know, and cannot-know must not read as a finding');
});

test('NO COMMITTED IMPORT NAMES AN EXPORT THAT DOES NOT EXIST', () => {
  const paths = SOURCES.map((e) => e.path);
  const named = paths.reduce((n, f) => n + namedImports(readHead(f)).length, 0);
  assert.ok(named > 100, `expected >100 named-import statements in HEAD, found ${named} — the extractor is blind`);
  const missing = missingExports(paths, readHead, TRACKED);
  assert.deepEqual(missing.map((x) => `${x.file} {${x.name}} <- ${x.target}`), [],
    'the specifier resolves and the symbol is absent — the missing export was the third piece of a half-landed change, and the panel could not boot until it arrived');
});

// ── V8's parser as the second witness ─────────────────────────────────────────────────────────
// The extractor above is regex-based and cost four rounds of false positives. vm.SourceTextModule
// PARSES without linking or evaluating, so it gives V8's own answer with nothing run — verified
// against monitor/rollup.mjs, which exits and publishes during evaluation: 23 specifiers, status
// `unlinked`, nothing written. Needs --experimental-vm-modules, so it runs in a child.
//
// It is a SECOND WITNESS, not a replacement, and the measurement is why: dependencySpecifiers
// covers STATIC imports only. `await import('../auth.mjs')` is absent from it, and this tree has
// FIFTY of those. Swapping wholesale would have blinded this guard to every one — a false clean
// introduced by the fix for false cleans.
test('V8 agrees with the extractor, and disagreement is reported rather than averaged', () => {
  // JUDGES HEAD, LIKE EVERY OTHER TEST IN THIS FILE. It used to list files from the INDEX and read
  // their contents from the WORKING TREE, so one half of this suite answered "is HEAD sound for
  // everyone" while this half answered "is the tree sound right now" — two different questions
  // under one verdict. Measured 2026-09-07: it went red on bin/test/no-nul-bytes.test.mjs, which
  // parses perfectly at HEAD, because a peer held 114 uncommitted insertions in it. Nine sessions
  // share this checkout, so that is the normal condition, and a gate that reddens on somebody
  // else's half-finished edit is one everybody learns to scroll past.
  //
  // The tree is still worth checking — earlier is better for the author who broke it — but it is a
  // DIFFERENT signal and belongs in bin/worktree-imports.mjs, which reports and never fails a suite.
  //
  // The parent already holds every HEAD blob (BLOBS/readHead above), correctly byte-decoded from one
  // cat-file batch. Handing that map to the child reuses that decoding rather than re-deriving it,
  // and the child then reads no filesystem at all.
  const payload = join(tmpdir(), `cw-head-sources-${process.pid}.json`);
  writeFileSync(payload, JSON.stringify(Object.fromEntries(SOURCES.map((e) => [e.path, readHead(e.path)]))));
  const script = `
    import { readFileSync } from 'node:fs';
    import { relativeSpecifiers, relativeDependenciesOf } from ${JSON.stringify(pathToFileURL(join(CW, 'bin/lib/tracked-imports.mjs')).href)};
    const sources = JSON.parse(readFileSync(${JSON.stringify(payload)}, 'utf8'));
    const out = { agree: 0, onlyRegex: [], onlyV8: [], unparseable: [], absent: [] };
    for (const [f, src] of Object.entries(sources)) {
      let v8;
      try { v8 = new Set(await relativeDependenciesOf(src, f)); }
      catch (e) { out.unparseable.push(f); continue; }
      const re = new Set(relativeSpecifiers(src));
      const a = [...re].filter((x) => !v8.has(x)), b = [...v8].filter((x) => !re.has(x));
      if (!a.length && !b.length) out.agree += 1;
      a.forEach((x) => out.onlyRegex.push(f + ' -> ' + x));
      b.forEach((x) => out.onlyV8.push(f + ' -> ' + x));
    }
    console.log(JSON.stringify(out));
  `;
  // stderr was 'ignore', so a child that died reported only "Command failed" — indistinguishable
  // from the two witnesses disagreeing, which is the one thing this test exists to tell apart.
  let raw;
  try {
    raw = execFileSync(process.execPath,
      ['--experimental-vm-modules', '--input-type=module', '-e', script],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    assert.fail('the V8 cross-check could not RUN, which is not the same as the witnesses '
      + `disagreeing: ${String(e.stderr || e.message).trim().slice(-600)}`);
  }
  try { unlinkSync(payload); } catch { /* a leftover temp file is a nuisance, not a failure */ }
  const r = JSON.parse(raw.trim().split('\n').pop());

  assert.ok(r.agree > 400, `only ${r.agree} files compared — the cross-check is blind`);
  assert.deepEqual(r.onlyV8, [],
    'V8 saw an import the extractor missed — a FALSE NEGATIVE, which would wave a dangling import through');
  assert.deepEqual(r.onlyRegex, [],
    'the extractor saw an import V8 does not — a false positive, reporting work that does not exist');

  // UNPARSEABLE IS ITS OWN STATE. Not clean, not broken. workflows/*.mjs are Workflow scripts, run
  // wrapped by that runtime, so their top-level `return` is legal there and illegal in a module.
  // Declared here so a NEW unparseable file fails loudly instead of being quietly skipped.
  assert.deepEqual(r.unparseable, ['workflows/adversarial-review.mjs'],
    'an unparseable tracked source that is NOT a known Workflow script — it cannot be analysed, '
    + 'which is neither a pass nor a finding, and must not be silently dropped from the walk');

  // ABSENT IS ITS OWN STATE, like unparseable — and tolerable only where git AGREES the path is
  // staged-deleted. A half-staged rename is routine on this tree; an absence git cannot account for
  // is a real break, and skipping it silently would hollow the walk out one file at a time.
  const deleted = new Set(execFileSync('git', ['-C', CW, 'ls-files', '--deleted'], { encoding: 'utf8' })
    .split('\n').filter(Boolean));
  assert.deepEqual(r.absent.filter((f) => !deleted.has(f.split(' [')[0])), [],
    'a tracked source is missing from the working tree and git does not report it deleted — the '
    + 'cross-check could not read it, which is not the same as it being clean');
});

// ── WINDOWS ────────────────────────────────────────────────────────────────────────────────────
// Both defects below made this guard useless on Windows while it stayed green on macOS/Linux, and
// both were found on 2026-09-04 by RUNNING it on Windows rather than by reading it. That is the
// pattern worth keeping: this module has now produced six false-positive mechanisms, and the two
// here were invisible to every reader because the platform they fire on was never in the loop.

test('WINDOWS — candidates are POSIX-separated, because the tracked set comes from git', () => {
  // git reports `a/two.mjs` on every platform. This used to build candidates with path.join, which
  // is path.win32.join on Windows, so `set.has('a\two.mjs')` was false for a tracked `a/two.mjs`
  // and EVERY relative import in the repository was reported dangling. A gate that fails on
  // everything is a gate that gets ignored, which is the same as not having one.
  for (const c of candidatesFor('a/one.mjs', './two.mjs')) {
    assert.ok(!c.includes(String.fromCharCode(92)), `candidate must not contain a backslash: ${c}`);
  }
  assert.deepEqual(candidatesFor('a/one.mjs', './two.mjs'), [
    'a/two.mjs', 'a/two.mjs.mjs', 'a/two.mjs.js', 'a/two.mjs/index.mjs', 'a/two.mjs/index.js',
  ]);
  // `..` still resolves, and still POSIX-side
  assert.equal(candidatesFor('bin/test/x.test.mjs', '../lib/y.mjs')[0], 'bin/lib/y.mjs');
  // A caller handing in OS-native paths must not silently reintroduce the mismatch on one side.
  const BS = String.fromCharCode(92); // a literal backslash, kept out of the source's own escaping
  assert.equal(candidatesFor(`a${BS}one.mjs`, './two.mjs')[0], 'a/two.mjs');
  assert.deepEqual(danglingImports(['a/one.mjs'], () => "import { x } from './two.mjs';\n",
    new Set(['a/one.mjs', `a${BS}two.mjs`])), [], 'a backslashed tracked entry is normalised, not missed');
});

test('WINDOWS — CRLF source is stripped of comments exactly like LF source', () => {
  // Git for Windows checks out CRLF by default. stripComments split on '\n' alone, leaving a
  // trailing '\r'; the line-comment regex is `/(^|[^:])\/\/.*$/` and JavaScript's `.` does not
  // match '\r', so `.*$` could never reach the end and NO `//` COMMENT WAS EVER STRIPPED.
  const body = "// import { A } from './ghost.mjs'\nimport { real } from './real.mjs';\n";
  const lf = relativeSpecifiers(body);
  const crlf = relativeSpecifiers(body.replace(/\n/g, '\r\n'));
  assert.deepEqual(lf, ['./real.mjs'], 'LF: the commented-out import is prose, not an import');
  assert.deepEqual(crlf, lf, 'CRLF must reach the identical verdict — the platform is not evidence');

  // The exact shape that fired: a `//` comment QUOTING an import, which is how this whole module
  // documents its own history. Under CRLF it was read as a real import of a file that exists
  // nowhere, so the guard reported work that did not exist.
  const quoting = "  // fact: it reported the `import { A } from './builder.js'` that a test WRITES\r\nconst a = 1;\r\n";
  assert.deepEqual(relativeSpecifiers(quoting), [], 'prose about an import is not an import, on either line ending');

  // NEGATIVE — the fix must not start swallowing real code. A real import keeps being seen.
  assert.deepEqual(relativeSpecifiers("import x from './keep.mjs';\r\n"), ['./keep.mjs']);
  // and the trailing \r must not leak into the specifier itself
  for (const s of relativeSpecifiers("import x from './keep.mjs';\r\nimport('./dyn.mjs');\r\n")) {
    assert.ok(!/[\r\n]/.test(s), `specifier carries a line terminator: ${JSON.stringify(s)}`);
  }
  // block comments and the glob-string case survive CRLF too
  assert.deepEqual(relativeSpecifiers("/*\r\nimport './in-block.mjs';\r\n*/\r\nimport './out.mjs';\r\n"), ['./out.mjs']);
  assert.deepEqual(stripComments("a\r\nb\r\n").length, 3, 'CRLF splits into the same line count as LF');
});

test('WINDOWS — the working tree this test runs against actually has the line ending in question', (t) => {
  // Guards the guard: if this repo were ever checked out LF-only on Windows, the CRLF test above
  // would still pass while proving nothing about the real checkout. Named rather than assumed.
  if (process.platform !== 'win32') { t.skip('CRLF checkout is the Windows default, not the POSIX one'); return; }
  const self = readFileSync(join(CW, 'bin', 'lib', 'tracked-imports.mjs'), 'utf8');
  const crlf = /\r\n/.test(self);
  if (!crlf) { t.skip('this checkout is LF (core.autocrlf=false) — the CRLF path is covered by the unit test'); return; }
  // The real file, from the real working tree, through the real extractor.
  assert.deepEqual(relativeSpecifiers(self).filter((s) => s.includes('builder')), [],
    'the module\'s own prose about ./builder.js must not be read as an import of it');
});
