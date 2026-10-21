<!-- verified-against: 2026-10-13 5e582892 -->
# 03 — `pythonsrc` is advertised and detected, but `ImportCode` has no such member

**Fixed upstream** in joernio/joern#6243 (merged 2026-09-07), which maps PYTHONSRC to the
`ImportCode` member named `python` in `BridgeBase.languageFromConfig`;
`upstream-drafts/03-pythonsrc-not-a-member.md` names the location.

**A REPORT, NOT A PATCH.** What follows is the measurement against joern 4.0.610 as of 2026-09-02,
taken from the Homebrew bottle's jars rather than the source tree, so it records the defect and
not a fix.

## The defect

`joern-scan` builds its script as `importCode.<language>(<path>)`. Language detection returns
`pythonsrc` for a `.py` tree, and `--list-languages` advertises `pythonsrc` as a valid value. But
`ImportCode` exposes the member as `python`. The generated Scala therefore does not compile:

```
-- [E008] Not Found Error: wrapped-script...sc:6:14
  6 |   importCode.pythonsrc("/tmp/.../py")
    |   ^^^^^^^^^^^^^^^^^^^^
    | value pythonsrc is not a member of io.joern.console.cpgcreation.ImportCode[JoernProject]
    |   - did you mean ....python?
Exception in thread "main" ...NonForkingScriptRunner: error during script execution:
  Error during compilation
  at io.joern.joerncli.JoernScan$.runScanPlugin(JoernScan.scala:182)
```

**Every Python repository fails to scan.** Not "scans and finds nothing" — never scans.

## The control

One `.py` tree, one variable. Both names are advertised by `--list-languages`:

| invocation | exit | outcome |
| --- | --- | --- |
| `joern-scan <src> --language pythonsrc` | 1 | `value pythonsrc is not a member` |
| `joern-scan <src> --language python` | 0 | CPG built, scan runs |
| `joern-scan <src>` (auto-detect) | 1 | same compile error — detection picks `pythonsrc` |

So the frontend is fine and the queries are fine; only the name the script is built from is wrong.
Corroborated from the other direction: `joern-parse <src>` on the same tree exits 0 and writes a
graph, because it never goes through the generated-script path.

## Why two names

`--list-languages` prints both `pythonsrc` and `python`, so the registry carries two names for one
frontend and only one of them matches an `ImportCode` member. `--list-languages` also offers
`swiftsrc`, `csharpsrc`, `rubysrc`, `jssrc`, `javasrc`, `golang` and `newc`; the name-by-name
control below covers the ones commitwork routes.

## Family

This is the second generated-Scala defect in this directory; 01 is a shell launcher defect. 02 was an escaping fault in the same
mechanism, and both are the shape where a value crosses into generated source without anything
checking it survives the trip.

With patch 01 this exits **1**. Without it, `runScanPlugin`'s failure becomes the launcher's `0`: a
41-byte husk on every Python repository, which commitwork's extractor reads as `unparseable`
rather than clean, with nothing saying *why*.

## The name-by-name control, as of 2026-09-18 (joern 4.0.620)

Each name commitwork routes, run against a real tree of that language:

| `--language` | exit | outcome |
| --- | --- | --- |
| `pythonsrc` | 1 | `value pythonsrc is not a member` — unchanged on 4.0.620 |
| `javasrc` | 1 | `value javasrc is not a member of ImportCode` — **the same defect, second name** |
| `java` | 0 | javasrc2cpg invoked, CPG built, scan ran |
| `c` | 0 | scan ran, 4 results on a fixture with `strcpy`, `gets` and a non-constant format |
| `kotlin` | 0 | scan ran |
| `php` | 1 | a DIFFERENT defect: php2cpg cannot find its parser (packaging layout, see below) |

So the registry advertises at least two names the generated script cannot use, and `javasrc` is the
one that matters most here: Java is the bundle's second-largest query set, and auto-detect picks
`javasrc` for a Java tree, so on 4.0.620 **every Java repository fails to scan for the same reason
every Python one does.** `swiftsrc`, `csharpsrc`, `rubysrc`, `jssrc`, `golang` and `newc` are
unmeasured; commitwork does not route them, and an unmeasured name is not a passing one.

commitwork does not depend on the fix: `bin/joern-lane.mjs` passes `--language` explicitly from a
map whose every entry was measured above.

## Adjacent, and repaired locally rather than reported: php2cpg's parser path

`php2cpg` resolves `<prefix>/bin/php-parser/php-parser.php`, and the bottle ships that directory at
`libexec/frontends/php2cpg/bin/php-parser/`. The frontend exits 1 with `Invalid path for
PhpParserBin` / `Skipping AST creation as php/php-parser could not be executed`, so the project is
never created. This is the astgen packaging mismatch again, one frontend along, and
`joernwork/bin/fix-local-joern.sh` links it the same way.
