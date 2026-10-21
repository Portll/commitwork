**Title:** `joern-scan` on a Python tree fails to compile — detection returns `pythonsrc`, `ImportCode` has only `python`

`joern-scan` builds its script as `importCode.<language>(<path>)`. Language detection returns
`pythonsrc` for a `.py` tree, and `--list-languages` advertises `pythonsrc` as a valid value. But
`ImportCode` exposes the member as `python`, so the generated Scala does not compile:

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

**Every Python repository fails to scan** — not "scans and finds nothing", never scans.

### Reproduce

One `.py` file is enough. Both names below are advertised by `--list-languages`:

| invocation | exit | outcome |
|---|---|---|
| `joern-scan ./py --language pythonsrc` | 1 | `value pythonsrc is not a member` |
| `joern-scan ./py --language python` | 0 | CPG built, scan runs |
| `joern-scan ./py` (auto-detect) | 1 | same compile error — detection picks `pythonsrc` |

Corroboration from the other direction: `joern-parse ./py` exits 0 and writes a graph, because it
never goes through the generated-script path. The frontend is fine; only the name the script is
built from is wrong.

### Fix

`BridgeBase.languageFromConfig` **already carries a mapping table for exactly this mismatch** —
`JAVASRC` is special-cased to `"java"` because `ImportCode` exposes that frontend as `def java`.
`PYTHONSRC` was simply missed and falls through to `lang.toLowerCase`:

```diff
           case Languages.JAVASRC            => "java"
+          case Languages.PYTHONSRC          => "python"
           case lang                         => lang.toLowerCase
```

Checked the other `SourceBasedFrontend` members against their `Languages` values — `kotlin`,
`golang`, `csharpsrc`, `php`, `abap` all match. Python was the only remaining gap.

Note the mapping is bypassed entirely by `config.language.getOrElse(...)`, which is why
`--language pythonsrc` also fails: an explicit value is passed through verbatim and never reaches
the table.

**Worth checking at the same time:** whether any other advertised name has the same mismatch.
`--list-languages` also offers `swiftsrc`, `csharpsrc`, `rubysrc`, `jssrc`, `javasrc`, `golang` and
`newc`. Nothing here establishes that those resolve to real members.

Reports as **exit 0** unless the launcher is also fixed — see the exit-code issue.
