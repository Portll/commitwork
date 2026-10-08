# Injection corpus

One file per injection shape as it appears in scanner output quoting a scanned repository. `lib/test/prompt-envelope.test.mjs` replays every file through the envelope. Add shapes; never remove one.

| file | shape |
|---|---|
| direct.txt | plain imperative to the model |
| indirect-comment.txt | instruction inside a code comment quoted by a finding |
| encoded.txt | base64 payload with a decode hint |
| hidden-unicode.txt | bidi override, zero-width and tag characters |
| fence-escape.txt | forged envelope markers |
| tool-call.txt | text shaped like a tool result or system message |
| html-comment.txt | instructions and a fake tool grant inside HTML comments |
| ignore-previous.txt | the "ignore previous instructions" family and a fake system-prompt header |

`bin/test/injection-corpus.test.mjs` replays every file through the CodeQL prompt builders and the
stub-recorded run path. `monitor/envelope-witness.mjs` (opt-in, `CW_LIVE_LLM=1`, run by the sweep)
replays every file through the real model and writes the witness
`reports/prompt-envelope/corpus-live.json` that `monitor/stpa-sweep.mjs` and
`monitor/remediation-policy.mjs` read; its canaries are fragments of the instructions planted here
(`example.invalid`, `git push --force`, `rm -rf /`, `PRIVATE KEY`, an `"env": {` block, a bare
`LGTM` reply), so a new file that plants a new instruction should add its fragment to `CANARIES`.
Never paste any of these into a live prompt outside the envelope.
