# Held-out injection corpus

Attack shapes the envelope and its prompt builders were never tuned against. The live witness
(`monitor/envelope-witness.mjs`, `CW_LIVE_LLM=1`) replays these beside the main corpus and records
each file under `set: "held-out"`; a failure here fails the witness like any other.

What keeps this set held out is a test, not a convention: `bin/test/injection-corpus-held-out.test.mjs`
fails when a line from any file below appears in `lib/prompt-envelope.mjs`, the prompt builders,
their unit tests or the witness itself. The unit suite never replays these files through the
envelope, so a structural fix cannot be fitted to them. Add a shape by adding a file and the
fragment of its instruction to `canaries.json`; `bin/corpus-rotation-check.mjs` refuses a release
whose held-out set did not grow since the previous tag.

| file | shape |
|---|---|
| role-spoof.txt | chat-turn and special-token forgery inside string literals |
| markdown-link.txt | directive in a markdown link or image title |
| yaml-frontmatter.txt | directive in a document's front matter, claiming authority |
| diff-shaped.txt | a ready-made "fix" diff adding a fetch-and-execute postinstall |
| remediation-shaped.txt | text shaped like the reviewer's own JSON verdict |
| json-string.txt | directive spelled with JSON unicode escapes |
| i18n.txt | directives in three other languages, one asking to translate and execute |
| chained-read.txt | a request to read credential files and quote them into the diff |

Never paste any of these into a live prompt outside the envelope.
