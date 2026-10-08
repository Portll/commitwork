<!-- verified-against: 2026-09-25 -->
# 03 — `pythonsrc` is advertised and detected, but `ImportCode` has no such member

**Fixed upstream** in joernio/joern#6243 (2026-09-07), which maps PYTHONSRC to the `ImportCode`
member named `python` in `BridgeBase.languageFromConfig`. What follows is the measurement as made
on 2026-09-02, before the location was known; `upstream-drafts/03-pythonsrc-not-a-member.md`
names it.

**A REPORT, NOT A PATCH, AND DELIBERATELY SO.** 01 and 02 are diffs because whoever wrote them had
the joern source tree. This box has only the Homebrew bottle's jars, so the fix LOCATION below is
inferred from the error message and is not verified against source. A diff written from that would
be a guess wearing a patch's clothes — the one thing this directory exists to avoid. Measured
against joern 4.0.610, 2026-09-02.

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

## Where the fix probably goes, stated as the guess it is

`--list-languages` prints both `pythonsrc` and `python`, so the registry carries two names for one
frontend and only one of them matches an `ImportCode` member. Either the registry stops advertising
`pythonsrc`, or `ImportCode` gains it as an alias. The second keeps working anything that already
passes `--language pythonsrc`. Which file that lives in is NOT established here.

Worth checking at the same time, and NOT checked here: whether any other advertised name has the
same mismatch. `--list-languages` also offers `swiftsrc`, `csharpsrc`, `rubysrc`, `jssrc`,
`javasrc`, `golang` and `newc`, and nothing in this report says those resolve to real members. A
name-by-name control against `ImportCode` is the measurement that would settle it.

## Family

This is the second generated-Scala defect in this directory; 01 is a shell launcher defect. 02 was an escaping fault in the same
mechanism, and both are the shape where a value crosses into generated source without anything
checking it survives the trip.

It also shows patch 01 earning its place: this exits **1**. Before 01, `runScanPlugin`'s failure
became the launcher's `0`, so this would have been a 41-byte husk and a silent clean on every
Python repository in the fleet, indefinitely. commitwork's own extractor would have caught it as
`unparseable` rather than clean — but nothing would have said *why*, and the lane would have read
as a void nobody could explain.

## The name-by-name control, run 2026-09-18 on 4.0.620

The section above asked whether any other advertised name has the same mismatch, and said a
name-by-name control against `ImportCode` is the measurement that would settle it. Partially
settled, by running each name that this fleet needs against a real tree of that language:

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
`javasrc` for a Java tree, so **every Java repository failed to scan for the same reason every
Python one did.** `swiftsrc`, `csharpsrc`, `rubysrc`, `jssrc`, `golang` and `newc` are still
unmeasured; this fleet does not route them, and an unmeasured name is not a passing one.

commitwork no longer depends on the fix: `bin/joern-lane.mjs` passes `--language` explicitly from a
map whose every entry was measured above. The upstream defect stands.

## Adjacent, and repaired locally rather than reported: php2cpg's parser path

`php2cpg` resolves `<prefix>/bin/php-parser/php-parser.php`, and the bottle ships that directory at
`libexec/frontends/php2cpg/bin/php-parser/`. The frontend exits 1 with `Invalid path for
PhpParserBin` / `Skipping AST creation as php/php-parser could not be executed`, so the project is
never created. This is the astgen packaging mismatch again, one frontend along, and
`joernwork/bin/fix-local-joern.sh` now links it the same way.
