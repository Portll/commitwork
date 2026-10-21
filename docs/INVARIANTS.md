<!-- verified-against: 2026-10-13 fc0917d7 -->
# Invariants register

The engineering invariants of this repository, one row each, with the test that enforces it, the
second check that cannot share that test's failure mode, and where its number is published. The
properties are ordinary correctness requirements for a scanner and a report generator; none is a
product theme and no row is a headline. The prose behind each row is in the house-invariants
section of [release/CLAUDE.public.md](../release/CLAUDE.public.md#house-invariants).

"Witness" has the meaning [docs/SPEC-dataflow-oversight.md](SPEC-dataflow-oversight.md) gives it:
a second check of the same claim through a different mechanism, so that one defect cannot make
both pass. A witness may live in the guard's file when it runs a separate extractor against the
same inputs (V8's parser beside a regex), and it is not a second test of a sibling module.

Guard and witness are repo-relative paths that resolve at `HEAD`, never in a working tree. Incident
counts are the ones measured in the house-invariants prose; `none` means the prose records no
measured incident for that row.

## Register

| Property | Guard | Witness | Ratchet | State | Incident |
| --- | --- | --- | --- | --- | --- |
| An unmeasured result is published as neither a pass nor a finding | monitor/test/defence-vector-unmeasured.test.mjs | none | none | guarded | 2026-08-22: four lanes publishing verdicts over unmeasured inputs |
| Undetermined is its own field outside crit/high/med/low, with the original claim preserved | bin/test/scorecard-undetermined.test.mjs | none | none | guarded | 2026-08-22: 1,067 FAILs (11.5% of cspm findings) about a field the credential never received; 100 of 105 dep-scan findings read as reachable with zero proofs |
| A detector positive on ~100% of its population is a defect signature in the detector, not a fleet finding | monitor/test/defect-signature.test.mjs | none | monitor/rollup.mjs (`defect-signatures.json`, per-detector rate) | guarded | 2026-08-22: 1,311 of 1,314 published CRITICALs from one detector; 602 of 675 rows at `med` from one rule family |
| Fail closed: a parse failure or permission error is never an empty store or empty result; only `ENOENT` means absent | monitor/test/settings.test.mjs | bin/test/bare-catch-ratchet.test.mjs | none | witnessed | none |
| A corrupt history store stops the rollup rather than being read as absent | monitor/test/rollup-history-corrupt.test.mjs | none | none | guarded | none |
| Determinism: same inputs give byte-identical outputs under `CW_NOW`-style overrides, and re-runs are idempotent | monitor/test/rerollup-identical.test.mjs | monitor/test/nondeterministic-store.test.mjs | none | witnessed | none |
| Writes are atomic (tmp + rename): a reader sees the old document or the new one, never a mixture | monitor/test/write-atomic-contract.test.mjs | monitor/test/write-atomic-concurrency.test.mjs | none | witnessed | none |
| A lock-free ledger append is one `O_APPEND` write, so concurrent writers never tear a line | bin/test/touch-ledger-atomicity.test.mjs | none | none | guarded | none |
| A finding's identity excludes `line`; a re-appearance elsewhere in the same file is the same finding moved | bin/test/finding-identity-pin.test.mjs | monitor/test/issue-key-identity.test.mjs | bin/gate-ratchet.mjs (`drifted` anchors, baseline vs now) | measured | 2026-08-03: 8 findings closed as FIXED that had shifted lines; 33 → 44 drifted anchors in one day with zero new findings |
| Every input path is `CW_*`-overridable and the env is read at call time, never at module load | monitor/test/settings.test.mjs | bin/test/lexical-ratchets.test.mjs | bin/test/lexical-ratchets.test.mjs (`M5_BASELINE`, module-scope env reads) | measured | none |
| Declaration is split from authority: tools that describe deployments, DNS or tunnels hold no credentials and apply nothing | monitor/test/deploy-declaration.test.mjs | monitor/test/deploy-core-purity.test.mjs | none | witnessed | none |
| A repo-local `commitwork.json` never executes without `--trust-repo-manifest` | bin/test/repo-trust-gate.test.mjs | none | none | guarded | none |
| Only bundled manifests run through the MCP server | mcp/test/trust-boundary.test.mjs | none | none | guarded | none |
| Generated HTML inlines its data, opens over `file://` and loads nothing from a CDN | bin/test/top100-html.test.mjs | none | none | guarded | none |
| A commit is closed over its own change set: nothing committed imports or cites something that is not | bin/test/tracked-imports.test.mjs | bin/test/tracked-imports.test.mjs | none | witnessed | 2026-08-25: 6 uncommitted import/untracked-module pairs across 5 files; the guard itself blind to 35 files and 1,375 lines |
| A guard needs a second witness that cannot share its failure mode, asserted in both directions | codegraph/test/divergence.test.mjs | codegraph/test/witness.test.mjs | codegraph/README.md (divergence over analysed files, both directions) | measured | 2026-08 (undated in the prose): witnesses agreed on 569 of 570 sources, zero divergence either way |
| A commit lands by compare-and-swap over a per-session index and refuses an empty change set | bin/test/commit-phase-core.test.mjs | bin/test/commit-phase-interleavings.test.mjs | none | witnessed | 2026-08-30: 2 sessions hit the race, 4 commits and 2 broken HEAD windows |
| Sidecar stores are directory symlinks, never file symlinks, and their ignore patterns carry no trailing slash | bin/test/sidecar-paths.test.mjs | none | none | guarded | none |

Per-artifact guards for self-contained HTML also exist for the status document
(`bin/test/projectstatus.test.mjs`) and the costing page; there is no tree-wide one, which is why
that row stays at `guarded`.

## State lifecycle

A row moves in one direction unless an incident forces it back:

- **stated** — the property is written down and nothing enforces it. Guard is `none`.
- **guarded** — a test at the guard path fails when the property is violated.
- **witnessed** — a second check through a different mechanism fails independently, so the guard's
  own blind spot is not also the witness's.
- **measured** — a number is published at the ratchet path and compared across runs, so "still
  true" is a checked fact rather than a streak.

A reverse transition is recorded in the row's Incident column with the date and the measured count
that forced it. A guard found blind to part of its population drops to `stated` for that part until
the witness lands; a ratchet whose number was found unread drops to `witnessed`.
