# Lane trust — how far to trust each lane

<!-- verified-against: 2026-10-18 fc0917d7 -->

`monitor/lane-trust.mjs` states six things about every lane in `LANE_ROSTER`
(`monitor/lane-roster.mjs`), the same roster `monitor/lane-capability.mjs` probes. Each column says
what evidence exists for the lane. A column with no input reads `not-measured` and never carries a
number. It also sorts every check in every bundled manifest into a lane, `not a lane`, or
unaccounted, and it is the producer of the per-lane confidence artifact `lane-confidence.json`
(`monitor/lane-confidence.mjs`).

## Lanes and checks

A lane is a category of findings that some check writes. The roster has two parts:

- the `SCANNER_SPECS` categories (`monitor/extractors.mjs`), which the rollup carries under
  `scanners`;
- `OFF_SPEC_LANES`, which never reach `scanners`. Each names the reader its findings reach, or
  says that no report reads them.

| Off-spec lane | Checks | Read by |
|---|---|---|
| `depsOsv` | `deps-osv` | the rollup's dependency-CVE totals, beside `depsNpmAudit` (`monitor/dep-findings.mjs` `parseOsv`). `deps-osv` is also the primary check of `maliciousPackages`, which reads only the MAL- rows of the same `osv.sarif` |
| `depsNpmAudit` | `npm-audit`, `yarn-audit` | the rollup's dependency-CVE totals, beside `deps-osv` (`monitor/dep-findings.mjs` `parseNpm`) |
| `authzIsolation` | `authz-test` | the runtime report (`bin/parse-runtime.mjs`) |

Each lane row names its primary `check`. A lane fed by other checks lists them in `alsoFrom`, each
with a reason: a declared alias in `CHECK_ALIASES` (`monitor/scanner-checks.mjs`; `sast-opengrep`
reports as `sastSemgrep`), or a check that writes the same artifact (`yarn-audit`). An off-spec
lane also carries `readBy`, or `unread` with the reason no report reads it. A lane that no report
reads can still count against its fixture: that proves the extractor, and the lane still
publishes nothing. No off-spec lane is `unread` today.

The bundled manifests are every `manifests/*.json` that `bin/commitwork.mjs` and the MCP server
resolve by name. A file with no `checks` key, such as `formats.json` or `tool-pins.json`, is data
and declares none. Five declare checks: `security-baseline`, `build-health`, `hermetic-tests`,
`quality-gates` and `runtime`.

A check that feeds no lane carries `"notALane": "<reason>"` in its manifest: it writes an
inventory, a count or a status that no reader derives a finding from. The record lists these under
`notLanes`, keyed by manifest, with the reason, and `--table` prints each as
`<manifest>/<check> not a lane: <reason>`. A check that feeds no lane and has no reason, or that
feeds a lane and is also marked, is listed under `unaccounted` with its manifest.
`monitor/test/lane-roster.test.mjs` fails on any unaccounted check in any bundled manifest, and
plants a check in each non-baseline manifest to show that it reads them all. It also fails when a
check marked `notALane` writes an artifact a lane extractor reads.

## Columns

**fixture** — where the lane's golden fixture came from, read from
`monitor/test/fixtures/lane-capability/PROVENANCE.json` (written by `bin/lane-fixture.mjs`).

| value | meaning |
|---|---|
| `real` | the lane's own tool ran over a seed project through `commitwork run` |
| `synthetic` | a drafted artifact, accepted on the extractor's reading alone; `reason` carries the recorded `why` a real run could not produce one |
| `unrecorded` | a fixture exists but predates provenance records, or its record names no recognised source (the recorded value is kept in `recorded`) |
| `no-fixture` | the lane has no golden fixture |

A synthetic fixture proves the parser, not the tool's output shape. The column also carries the
`check` whose run produced the fixture, as recorded. For a lane with `alsoFrom` checks, that is one
of several.

**canary** — the scan canary's last record for the lane's tool
(`fixtures/scan-canary/EXPECTED.json` `measured.lanes`, mapped to categories by
`CANARY_CATEGORIES` in `monitor/lane-capability.mjs`). Rates follow the stratum convention of
`monitor/sweep-verdict.mjs`. `falseClean` is the share of runs the lane called clean that should
have alarmed. `falseAlarm` is the share of runs it alarmed on that were clean. Each carries `n`
and `of`. Only an explicit `BOTH DIRECTIONS DEMONSTRATED` verdict with both runs recorded is
scored, as one clean-tree run called clean and one dirty-tree run called alarm. Any other verdict
reads `unscored` and keeps the verdict text. A lane whose tool the canary never ran reads
`not-measured`. When several lanes can detect a canary lane's plants, only the lane whose tool the
record read is credited, and the evidence names that tool (`CANARY_TOOL`). The `dependency-cve`
record is one osv-scanner run, with no MAL- row, so it credits `depsOsv` alone. `depsNpmAudit` and
`maliciousPackages` stay `not-measured`. The `canary` field in a sweep verdict covers commitwork's own gates
(`bin/canary-harness.mjs`), not scanner lanes, so this column does not read it.

**undetermined** — the share of the lane's published findings carried in the `undetermined`
bucket rather than crit/high/med/low. It sums `rollup.json` `scanners.<category>` over every
area the registry declares: `share = undetermined / (crit + high + med + low + undetermined)`,
with `areas` counting the rollups that carry the lane. A lane with zero findings, or one that no
rollup carries, reads `not-measured`; zero findings gives no share, not 0%. A non-count bucket
reads `unreadable`. When the registry is the shipped example there are no fleet findings, and the
column reads `not-measured` for every lane. An off-spec lane has no `scanners` bucket, so its column
reads `not-measured` and names the reader its findings reach, or says that no report reads them.

**band** — the lane's evidentiary rung from the seven-word vocabulary of
`monitor/lane-confidence.mjs` (`unmeasured` … `externally-verified`), with the rung's `condition`
and `why`. lane-trust holds no adjudication record, so every lane reads `unmeasured` ("no
adjudicated findings") until one is supplied; a count is never invented to move a lane. The column
exists so the band has a producer: before 2026-10-18 `buildLaneConfidence` was called by nothing
outside its tests.

**positiveControl** — `absent`, `missed`, `stale` or `current`: whether the lane has recently been
shown to fire on a planted positive, derived from the same canary record the `canary` column reads
(a credited both-directions verdict is `detected`; any other recorded verdict is `missed`), aged
against `CW_NOW` with `CW_POSITIVE_CONTROL_MAX_AGE_DAYS` (default 30). `CW_POSITIVE_CONTROLS`
names an explicit record and outranks the derivation. `at` carries the control's date. Where the
rollups carry a finding count for the lane, `sweepResult` says what it means: `findings`, `clean`
(zero under a current control), or `unmeasured` (zero under any other control).

**defectSignature** — read from the fleet defect-signature artifact
(`<reportsRoot>/defect-signatures.json`, written by `node monitor/defect-signature.mjs --fleet`,
override `CW_DEFECT_SIGNATURES_OUT`). `state: true` when the artifact flags a detector in the
lane, with the detectors named; `false` when the artifact exists and flags none. When the
artifact is absent the field is omitted and the summary reads `not-measured`: nothing was
measured, so nothing is claimed either way. The population floor is applied to the pooled fleet
population because an area holds one or two repositories and no per-area artifact can reach it.

The `summary` counts lanes per fixture source, per canary state, per band, per positive-control
state and per defect-signature state (with the flagged detectors). It also gives the median
undetermined share over the lanes where that share was measured, and `checks`: how many bundled
manifest checks are declared, in a lane, not a lane, and unaccounted, in total and per manifest
under `manifests`. A check id that two manifests declare counts in each. With no baseline manifest
or no manifests directory, `checks` reads `not-measured`, because a partial account would read as
the whole.

## Regenerating

```sh
node monitor/defect-signature.mjs --fleet   # pools every area's defect-signatures.json to <reportsRoot>/defect-signatures.json
node monitor/lane-trust.mjs                 # writes <reportsRoot>/lane-trust.json and lane-confidence.json, prints the headline
node monitor/lane-trust.mjs --table         # also prints one row per lane
node monitor/lane-trust.mjs --json          # prints the record, writes nothing
```

`node monitor/sweep.mjs all` runs both in its fleet finalise, after every area's rollup, as the
steps `defectSignatures` and `laneTrust`; a failure there is recorded as `failed` in the fleet
verdict and does not move the sweep's exit.

The output reads live fleet rollups, so it is an operational record. It lands under the
gitignored reports root and never belongs in the tree. All inputs are read at call time:
`CW_LANE_FIXTURES` (fixture root), `CW_CANARY_DIR` (scan canary), `CW_REGISTRY` (registry, and
through it the reports root), `CW_BASELINE_MANIFEST` (the baseline manifest), `CW_MANIFESTS_DIR`
(the other bundled manifests), `CW_DEFECT_SIGNATURES_OUT` (the fleet signature artifact),
`CW_POSITIVE_CONTROLS` (an explicit control record), `CW_LANE_TRUST_OUT` and
`CW_LANE_CONFIDENCE_OUT` (output paths; the confidence artifact defaults to beside the trust
record) and `CW_NOW` (the `generated` stamp and the control ages, for byte-identical re-runs). A
store that exists but cannot be parsed stops the run. Only an absent file counts as absence.

`lane-confidence.json` is keyed on lane, carries words and booleans only, and never reaches a
finding row: `assertNoRowConfidence` in `monitor/lane-confidence.mjs` refuses any arithmetic
confidence field on a row schema.

Tests: `monitor/test/lane-trust.test.mjs`, on synthetic inputs only,
`monitor/test/defect-signature-fleet.test.mjs` for the pooling, and
`monitor/test/lane-roster.test.mjs`, which also reads the bundled manifests.
