<!-- verified-against: 2026-10-04 -->
# joernwork

Repairs for [joernio/joern](https://github.com/joernio/joern) found while wiring the `sast-joern`
lane. Two are upstream defects with patches and reproducers in this directory; one is a
distribution-layout mismatch repaired only locally; a third upstream defect, Python's generated
`importCode.pythonsrc` member, is recorded as a measurement in `patches/03`. All three upstream
defects are fixed in joernio/joern: #6237 and #6238 merged on 2026-09-02, #6243 on 2026-09-07.
Re-measured 2026-10-04 on 4.0.640 (Homebrew): the launcher fix (01) and the escaping fix (02) both
ship in the bottle — a bad `--language` exits 1 and `--exclude-regex 'a\.b'` scans normally — so
the local repair no longer patches the launcher. The bottle's `csharpsrc2cpg` and `jssrc2cpg`
astgen dirs are empty again: C# is repaired by `node bin/upstream-fetch.mjs --fetch astgen-dotnet
--into <prefix>/libexec/frontends/csharpsrc2cpg/bin/astgen` (0.43.0, the version 4.0.640 pins),
and JS resolves Homebrew's `astgen` 3.50.1 on PATH, also the pinned version.

Everything here was measured against **joern 4.0.610** (Homebrew, macOS arm64) on **2026-09-01**,
against a C file containing `strcpy(buf, argv[1])` and `system(sprintf(cmd, "ls %s", argv[1]))`.

## Why this exists

`sast-joern` had never scanned anything, on any repo, and said so with an exit code of 0. Two
independent defects stacked: the scan crashed before it started, and the crash was reported as
success. The lane's extractor caught it — a scanless artifact publishes as `toolfailed` when it carries an
error marker or a non-zero exit and as `unparseable` otherwise, never as clean — so nothing false
was ever published. That is the only reason this was a wiring problem
rather than a reporting one.

## Upstream — worth a PR

### 01 · `joern-scan` discards the JVM's exit status

`joern-cli/src/universal/joern-scan` ends with:

```sh
$SCRIPT … "$@" 2> /tmp/joern-scan-log.txt
if [ $? -eq 2 ]; then
  $SCRIPT … "$@" 2> /tmp/joern-scan-log.txt
fi
```

The `if` is the script's **last command**, so the script exits with the `if`'s status. When the JVM
exits 2 the retry runs (that path is real — `JoernScan.runScanPlugin` calls `System.exit(2)` after
downloading the query database). Every *other* failure code becomes **0**.

This is the single root cause of four separately-recorded silent failures: an unknown `--format`
option, a frontend-args crash, `rust2cpg` dying on a missing binary, and an explicit `--language`
producing a husk. All four exited 0.

Three lines: capture the status, retry on 2, exit with it. Verified in place — a failing scan goes
0 → 1, a healthy scan stays 0 with its findings intact.

Still present on `master` at the time of writing (byte-identical to the 4.0.610 bottle).

### 02 · frontend args are interpolated into generated Scala without escaping

`BridgeBase.argsStringFromConfig` builds a Scala source file and inserts each `--frontend-args`
value with bare quotes:

```scala
val quotedArgs = args.map { arg => "\"" ++ arg ++ "\"" }
```

`loadOrCreateCpg`, twenty lines above in the same file, correctly escapes `src` with
`StringEscapeUtils.escapeJava`. Any arg containing a backslash or a quote therefore produces an
invalid string literal and the generated script fails to **compile** — reported (via defect 01) as
exit 0 with a 41-byte husk.

A regex is the obvious case. `--exclude-regex '.*/\.git/.*'` contains `\.`, which is not a legal
Scala escape.

```
--exclude-regex 'plainnobackslash'   ->  2 results
--exclude-regex 'has\.backslash'     ->  0 results, husk
c2cpg.sh --exclude-regex directly    ->  works; node_modules correctly excluded
```

The control matters: passed straight to `c2cpg`, the flag and the mechanism are sound. This is a
`joern-scan` bug, not a frontend limitation.

One code line, with a six-line comment. `StringEscapeUtils` is already imported and already used
in that file.

## Local only — a layout mismatch, not a code defect

`AstGenRunner` resolves `<root>/bin/astgen/<binary>`, but the distribution ships those binaries at
`libexec/frontends/<frontend>/bin/astgen/`. So `gosrc2cpg`, `rust2cpg` and `swiftsrc2cpg` fail with
*"Local … binary not found … or is not executable"* even though the binary is present.

Measured: Go went from `exit 1, no CPG` to a real **121-node CPG** (`handler`, `Command`, `Output`)
after symlinking. commitwork's own `sast-joern` manifest notes still say the bottle ships no
`rust_ast_gen-macos-arm`; it ships a 26 MB one, where rust2cpg cannot see it.

Whether this belongs upstream depends on which side owns the layout, so it is not proposed as a
patch here.

**CORRECTED 2026-09-02 — the two "absent" binaries are present.** This section said
`csharpsrc2cpg` and `jssrc2cpg` "cannot be repaired locally at all, because the binary is absent
rather than misplaced". Re-measured on joern 4.0.610: every frontend ships an astgen binary, none
of the dirs is empty, and `fix-local-joern.sh` links all six. Its own EMPTY-dir NOTE does not fire,
because the condition is not true. Whether the original reading was wrong or the install changed is
not established; what is established is the current state.

| frontend | astgen binary | size |
|---|---|---|
| `abap2cpg` | `abapgen-macos-arm` | 53M |
| `csharpsrc2cpg` | `dotnetastgen-macos` | 58M |
| `gosrc2cpg` | `goastgen-macos-arm64` | 3.2M |
| `jssrc2cpg` | `astgen-macos-arm` | 121M |
| `rust2cpg` | `rust_ast_gen-macos-arm` | 25M |
| `swiftsrc2cpg` | `SwiftAstGen-mac` | 8.7M |

**Linking them fixed Go and nothing else**, which is the part that matters and is why the
correction is not good news:

| language | frontend | CPG | scan |
|---|---|---|---|
| Go | works | 84 methods | exits 0, 0 findings (no Go queries) |
| JS | runs | **empty — 0 methods, 9216-byte CPG** | exits 0, 0 findings |
| Python | works (`joern-parse` exits 0 and writes a graph) | — | **fails, see patches/03** |

So the original section's CONCLUSION for JS survives its premise being wrong: JS still yields
nothing, just for a different reason than "the binary is missing".

### JS: the empty CPG is a CWD resolution bug, not a missing binary (measured 2026-09-02)

`jssrc2cpg` hands `ProcessBuilder` a BARE RELATIVE `astgen`, which Java resolves against the process
CWD rather than PATH. Run from anywhere without a `./astgen` it fails with
`Cannot run program "<cwd>/astgen" ... error: 2 (No such file or directory)`, swallows it, and
emits an empty graph:

| cwd | CPG | methods |
|---|---|---|
| no `./astgen` | 4,607 bytes | 0 |
| `./astgen` symlink present | 55,398 bytes | 27 |

So JS IS repairable locally, and **both astgens are irrelevant to it**. They are both 3.47.0, they
produce byte-equivalent output on the same input (2 files, 12k each), and the Homebrew `astgen`
formula is itself a wrapper around `@joernio/astgen` — there is no "npm one", no shipped-vs-npm
split, and no newer one. Resolution never gets far enough for any difference to matter.

Still 0 findings after the repair, because the bundle has no JS queries. This buys a populated CPG,
not coverage.

The preflight for the launcher repair and the astgen links is `bin/test/joern-local-repairs.test.mjs`
(nothing tests patch 02 or the Python report): it skips when joern is absent and fails when joern
is present with a repair reverted, so `brew upgrade joern` can no
longer quietly restore the silent-clean behaviour.

No upstream issue existed for this, for `patches/01`, or for `patches/03` when `joernio/joern` was
searched on 2026-09-02, with a positive control to confirm the search itself returned hits. The
fixes were then proposed from `upstream-drafts/` and merged as listed at the top of this file.

The lesson is the one this directory keeps re-learning: a recorded "cannot be done" outlives the
conditions it was measured under and then reads as settled. Re-measure before citing.

## What the stock query bundle actually covers

Independent of any of the above, and the reason most languages stay unwired:

| language | queries |
|---|---|
| c | 27 |
| android | 10 |
| php | 9 |
| java | 7 |
| kotlin | 3 |
| ghidra | 2 |
| **JavaScript / TypeScript / Python / Go** | **0** |

58 total, of which only **32 carry the `default` tag** — and `joern-scan` with no `--tags` runs
*only* those. The C security queries are not among them: `call-to-strcpy` is tagged `badfn`.
Controls on one CPG: `--tags default` → 0 results, `--tags badfn` → 2.

The C queries fire on a bare fixture because they are call-name matches. The Java, Kotlin and PHP
queries did not, because they are **taint** queries wanting framework-specific sources — servlets,
Android intents, PHP superglobals. Kotlin's three are all `android`-tagged. So "the queries exist"
is not the same as "the lane reports", and only C/C++ is honestly wired today.

## Contents

```
patches/01-joern-scan-exit-code.diff       3 lines, joern-cli/src/universal/joern-scan
patches/02-frontend-args-escaping.diff     1 code line + comment, console/…/BridgeBase.scala
patches/03-pythonsrc-not-a-member.md       a measurement, not a patch (fixed upstream in #6243)
upstream-drafts/                           the issue and pull-request texts sent to joernio/joern
repro/repro.sh                             self-contained; exits non-zero if a defect is NOT reproduced
bin/fix-local-joern.sh                     idempotent, self-verifying; re-run after every brew upgrade
```

`bin/fix-local-joern.sh` must be re-run after any `brew upgrade joern`: every local change lives
inside the Cellar and an upgrade reverts all of it. The symptom of a silent revert is not an error
— it is a scan that reads nothing and exits 0.
