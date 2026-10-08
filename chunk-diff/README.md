<!-- verified-against: 2026-10-07 -->
# commitwork · chunk-diff — N-way Markdown comparison sidecar

A self-contained HTML artifact generator (zero runtime deps, `file://`-safe, no CDN) that compares
2-6 Markdown documents chunk-by-chunk and lets a human review, hide, and merge across them. Built
alongside `map/` and `sitemap/`, following the same shape: a pure Node generator produces one
portable HTML file; nothing in the artifact itself depends on a server.

Documents may be different versions of one file, or files each holding a distinct agent's/model's
output — the generator is source-agnostic; it only ever sees N Markdown files by path.

## Run
```sh
node chunk-diff/generate.mjs <doc1.md> <doc2.md> [doc3.md] [doc4.md] [doc5.md] [doc6.md] [--base <n>] [--by-section] [--out <path>]
```
Writes a single HTML file (default: `<doc1-basename>.chunk-diff.html`) with N side-by-side columns,
the first document as the alignment reference unless `--base <n>` (0-based) names another.
`--by-section` chunks on Markdown headings instead of blank lines. Open it directly — no server
required.

## Design

Chunk identity is a content fingerprint (sha256), never a line number or array position — code and
prose move for reasons unrelated to whether a chunk "is the same" as before, and a position-keyed
identity converts that movement into a false change (the "never key a finding's identity on a line
number" invariant in `.github/CONTRIBUTING.md`). Every chunk pairing lands in one of seven states — `MATCHED`,
`WHITESPACE_ONLY`, `EDITED`, `AMBIGUOUS` (duplicate content across the same-key candidates),
`UNRESOLVED` (a genuine split/merge with no confident 1:1 pairing), `ADDED`, `DELETED` — so an
honest "can't tell" is always distinguishable from a confident verdict, never silently collapsed
into either "clean" or "changed."

All computation (chunk splitting, secret-scanning, alignment, word-level diffing, Markdown
rendering) runs server-side in `generate.mjs`; the browser only handles interaction (hover menu,
gutter clicks, hide/master/copy/revert/apply, export) over pre-rendered data. This keeps the one
Markdown parser and the one diff engine each in a single place, rather than shipping a second copy
into the browser that could silently drift from the first.

Before a single line of this was written, four independent design passes (`/bifocal`, `/foureyes`,
`/overloop`, `/breakers`) were run against the proposed design — `lib/chunk-identity.mjs`'s header
names them. The security gates below (secret-scan, size caps, the file://-safety check on the
output) are each stated in the module that enforces them.

## Layout
```
chunk-diff/
  generate.mjs           CLI: reads N .md files, writes one comparison artifact
  lib/
    chunk-split.mjs       splits Markdown into blocks on blank-line boundaries, or into heading
                           sections for --by-section (fence-aware)
    chunk-identity.mjs    content-fingerprint pairing between two chunk arrays; the state model
    diff-ops.mjs          word-level LCS diff, capped (CW_DIFF_MAX_WORDS)
    align.mjs             N-way alignment: every non-base column judged against the base column
    secret-gate.mjs       routes chunk content through bin/secrets-sweep.mjs before embedding
  test/                   node --test fixtures — determinism, the completeness invariant, the
                           file://-safety gate, secret redaction
```
Markdown rendering is the repository's `lib/render-markdown.mjs` — zero-dep Markdown -> HTML, a
deliberate port, not a shared import, of `bin/render-report.mjs`'s parser; its header says why.

## Env
- `CW_DIFF_MAX_WORDS` — per-chunk word-diff cap (default 20000); over the cap, word-level
  highlighting is skipped for that chunk and the artifact says so visibly — never a silent partial
  diff.
- `CW_DIFF_MAX_BYTES` — per-file size ceiling (default 5MB); a file over this refuses the whole run
  rather than partially reading it.

## Known simplification
When a non-base column's chunk spans an ambiguous split/merge against the base (`UNRESOLVED`), it
is recorded only at the row of the first base chunk it spans; other base rows it also covers are
left blank for that column rather than duplicated or cross-linked. A different column with a clean
match at one of those rows still shows its own data there — the two are independent per-column
judgments about the same base row, not merged into one. See `lib/align.mjs`'s header comment.
