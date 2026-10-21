# Upstream drafts — filed and merged

Four defects for `joernio/joern`, written separately because maintainers triage per defect. Each
went upstream as its own pull request, and all four merged between 2026-09-02 and 2026-09-07. The
drafts below are the reports as written before filing.

No existing upstream issue matched any of the four when they were filed.

## Why 01 matters most

`01` is not one bug among four — it is the reason the other three are silent. `joern-scan`'s
launcher discards the JVM's exit status, so every failure below surfaces as **exit 0 with a 41-byte
stdout**. Any tool consuming joern-scan reads that as a successful scan of a clean repository. A
maintainer who fixes only 02/03/04 leaves the amplifier in place; one who fixes only 01 at least
makes the rest visible.

| draft | defect | pull request |
|---|---|---|
| [01](01-launcher-exit-code.md) | launcher exits with the retry-`if`'s status, not the JVM's | joernio/joern#6237, merged 2026-09-02 |
| [02](02-frontend-args-escaping.md) | `--frontend-args` interpolated into generated Scala unescaped | joernio/joern#6238, merged 2026-09-02 |
| [03](03-pythonsrc-not-a-member.md) | detection returns `pythonsrc`; `ImportCode` has only `python` | joernio/joern#6243, merged 2026-09-07 |
| [04](04-jssrc2cpg-astgen-cwd.md) | `jssrc2cpg` resolves a bare relative `astgen` against CWD | joernio/joern#6244, merged 2026-09-06 |

**All four carry patches**, each located in a clone of joern's source rather than inferred from an
error message:

- **03** turned out to be a one-line addition to a table that *already exists for this mismatch* —
  `JAVASRC` is special-cased to `"java"` because `ImportCode` exposes it as `def java`. `PYTHONSRC`
  was simply missed.
- **04**'s cause is sharper than the report's wording. `resolveAstGenPath` returns a bare name to
  MEAN "found on PATH"; `astGenCommand` absolutises it one line later and destroys that signal. The
  report's "hands ProcessBuilder a bare relative astgen" describes the symptom.

Each pull request passed joern's test jobs on Ubuntu, Windows and macOS before it merged.

## Environment, identical for all four

```
joern    4.0.610 (Homebrew bottle)
jars     HEAD+20260824-0849
os       macOS 26.4, arm64
java     openjdk 25.0.4.1
astgen   3.47.0
```
