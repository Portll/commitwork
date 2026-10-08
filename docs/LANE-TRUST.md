# Lane trust — how far to trust each lane

<!-- verified-against: 2026-10-07 -->

`monitor/lane-trust.mjs` states three things about every lane in `SCANNER_SPECS`
(`monitor/extractors.mjs`), the same roster `monitor/lane-capability.mjs` probes. Each column says
what evidence exists for the lane. A column with no input reads `not-measured` and never carries a
number.

## Columns

**fixture** — where the lane's golden fixture came from, read from
`monitor/test/fixtures/lane-capability/PROVENANCE.json` (written by `bin/lane-fixture.mjs`).

| value | meaning |
|---|---|
| `real` | the lane's own tool ran over a seed project through `commitwork run` |
| `synthetic` | a drafted artifact, accepted on the extractor's reading alone; `reason` carries the recorded `why` a real run could not produce one |
| `unrecorded` | a fixture exists but predates provenance records, or its record names no recognised source (the recorded value is kept in `recorded`) |
| `no-fixture` | the lane has no golden fixture |

A synthetic fixture proves the parser, not the tool's output shape.

**canary** — the scan canary's last record for the lane's tool
(`fixtures/scan-canary/EXPECTED.json` `measured.lanes`, mapped to categories by
`CANARY_CATEGORIES` in `monitor/lane-capability.mjs`). Rates follow the stratum convention of
`monitor/sweep-verdict.mjs`. `falseClean` is the share of runs the lane called clean that should
have alarmed. `falseAlarm` is the share of runs it alarmed on that were clean. Each carries `n`
and `of`. Only an explicit `BOTH DIRECTIONS DEMONSTRATED` verdict with both runs recorded is
scored, as one clean-tree run called clean and one dirty-tree run called alarm. Any other verdict
reads `unscored` and keeps the verdict text. A lane whose tool the canary never ran reads
`not-measured`. The `canary` field in a sweep verdict covers commitwork's own gates
(`bin/canary-harness.mjs`), not scanner lanes, so this column does not read it.

**undetermined** — the share of the lane's published findings carried in the `undetermined`
bucket rather than crit/high/med/low. It sums `rollup.json` `scanners.<category>` over every
area the registry declares: `share = undetermined / (crit + high + med + low + undetermined)`,
with `areas` counting the rollups that carry the lane. A lane with zero findings, or one that no
rollup carries, reads `not-measured`; zero findings gives no share, not 0%. A non-count bucket
reads `unreadable`. When the registry is the shipped example there are no fleet findings, and the
column reads `not-measured` for every lane.

The `summary` counts lanes per fixture source and per canary state. It also gives the median
undetermined share over the lanes where that share was measured.

## Regenerating

```sh
node monitor/lane-trust.mjs            # writes <reportsRoot>/lane-trust.json, prints the headline
node monitor/lane-trust.mjs --table    # also prints one row per lane
node monitor/lane-trust.mjs --json     # prints the record, writes nothing
```

The output reads live fleet rollups, so it is an operational record. It lands under the
gitignored reports root and never belongs in the tree. All inputs are read at call time:
`CW_LANE_FIXTURES` (fixture root), `CW_CANARY_DIR` (scan canary), `CW_REGISTRY` (registry, and
through it the reports root), `CW_LANE_TRUST_OUT` (output path) and `CW_NOW` (the `generated`
stamp, for byte-identical re-runs). A store that exists but cannot be parsed stops the run. Only
an absent file counts as absence.

Tests: `monitor/test/lane-trust.test.mjs`, on synthetic inputs only.
