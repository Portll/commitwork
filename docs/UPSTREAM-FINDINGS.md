<!-- verified-against: 2026-10-13 fc0917d7 -->
# Upstream findings

Defects in third-party scanners that commitwork's own checks surfaced, recorded so that a reader
can check each one against the tool's tracker and against the number this repository published.
Each was found by a check on commitwork's own reporting (the per-detector positive rate over the
repositories scanned, and the rule that an unmeasured input is neither a pass nor a finding), not
by reading the scanner's source; the counts are the numbers published at the time, as recorded in
the house-invariants prose of `CLAUDE.md` and in the Incident column of
[docs/INVARIANTS.md](INVARIANTS.md). Reports filed on a third-party tracker from a commitwork
finding end with the line `Found by commitwork.`; that line is how a report is attributed, and it
is the string to search for on a tracker when checking the list below.

One of the four 2026-08-22 cases turned out, on review, to be commitwork's own misreading of a
scanner's neutral state rather than a defect in the scanner. It stays on this page because the
published number was wrong either way, and the page is a record of wrong numbers and what
corrected them, not a list of other people's mistakes.

Tracker states below were read from GitHub on 2026-10-18 and will drift; the links are what to
re-check.

## The four 2026-08-22 defects

| Tool and component | Reported | Measured | Register property that found it | Upstream report |
| --- | --- | --- | --- | --- |
| TruffleHog, `Lob` detector | verified live secrets, published as CRITICAL | 1,311 of the fleet's 1,314 published CRITICALs, all false | A detector positive on ~100% of its population is a defect signature in the detector, not a fleet finding | fixed upstream before the measurement: [trufflesecurity/trufflehog#5188](https://github.com/trufflesecurity/trufflehog/pull/5188); no commitwork report |
| Prowler, GitHub provider, controls read off `security_and_analysis` | FAIL: secret scanning and related features not enabled | 1,067 FAILs, 11.5% of all cspm findings | Undetermined is its own field outside crit/high/med/low, with the original claim preserved | [prowler-cloud/prowler#12729](https://github.com/prowler-cloud/prowler/issues/12729) (issue, filed 2026-09-03, open) |
| GuardDog, `capability-*` rules | a package can open a socket, spawn a process, read the filesystem, published at `med` | 602 of 675 rows at `med` | A detector positive on ~100% of its population is a defect signature in the detector, not a fleet finding | link: pending (operator-held) |
| dep-scan, `in_triage` reachability state, as read by commitwork | REACHABLE | 100 of 105 findings, with zero reachability proofs | Undetermined is its own field outside crit/high/med/low, with the original claim preserved | none: not an upstream defect; corrected in `monitor/extractors/supply-chain.mjs` |

All four also sit under the register's first row, "An unmeasured result is published as neither a
pass nor a finding", whose Incident column records them together as "four lanes publishing
verdicts over unmeasured inputs".

### TruffleHog: the `Lob` detector verified strings that were not secrets

- **What it reported.** `Verified: true` results from the `Lob` detector, which commitwork
  published as CRITICAL. Every distinct matched string was a test function identifier, not a key.
- **What was true.** The detector's regex matched identifiers, and its verification step treated
  an HTTP 403 from the Lob API as confirmation. One detector produced 1,311 of the fleet's 1,314
  published CRITICALs.
- **How it was found.** By computing positives over repositories scanned, per detector. The
  per-row severity was correct in form, so no row-level check could see it; the per-detector rate
  could. That rate is now published per sweep by `monitor/rollup.mjs` as `defect-signatures.json`
  (`monitor/defect-signature.mjs`), and `bin/detection-falsifier.mjs` classifies a secret whose
  raw value is a `test_*` identifier as a false positive.
- **Upstream.** The defect had already been fixed upstream in
  [trufflesecurity/trufflehog#5188](https://github.com/trufflesecurity/trufflehog/pull/5188)
  ("Update regex pattern and 403 handling in the Lob detector to fix false positives", merged
  2026-08-07, by an upstream contributor) fifteen days before the fleet measurement. The fleet was
  pinned to TruffleHog 3.95.9, which predates the fix; upgrading removed the false verified rows.
  No commitwork report was filed because none was needed.

### Prowler: a FAIL asserted from a field GitHub never returned

- **What it reported.** FAIL on `repository_secret_scanning_enabled` and the other controls whose
  verdict is read off the repository's `security_and_analysis` object.
- **What was true.** GitHub returns `security_and_analysis` only to a credential with admin on the
  repository. For every other credential the field is absent, and Prowler read absence as "not
  enabled". The 1,067 FAILs included a private repository where the operator holds admin. Prowler
  has a `MANUAL` status for exactly "could not determine" and did not use it.
- **How it was found.** The same control failing on close to every repository scanned, and a probe
  showing the field never arrived. `monitor/extractors/posture.mjs` now marks those rows
  undetermined when the probe says the field was absent, keeps Prowler's own `status_detail` text
  on the row, and matches the affected controls on a small declared list of Prowler's control
  titles rather than a wide pattern, so a real FAIL is not downgraded with them. That list was
  sourced from the fleet's 614 OCSF artifacts on 2026-08-22.
- **Upstream.** Issue
  [prowler-cloud/prowler#12729](https://github.com/prowler-cloud/prowler/issues/12729), filed
  2026-09-03, open on 2026-10-18. It was deliberately not filed on 2026-09-02, when the cause had
  been inferred from output but not read from Prowler's code.

### GuardDog: capability rules published at a severity

- **What it reported.** `capability-*` rules ("this package can open a socket", spawn a process,
  read the filesystem, download), at `warning` in GuardDog's own SARIF, which commitwork mapped to
  `med`.
- **What was true.** The rules describe what almost every package can do. 602 of 675 rows at `med`
  came from this one rule family. The severity was GuardDog's: a sweep artifact carried
  `defaultConfiguration.level: "warning"` on the capability rules with no result-level override,
  which rules out commitwork's SARIF reader defaulting a missing level (it would have produced the
  same number on its own, and was checked for that reason).
- **How it was found.** One rule family accounting for most of a severity bucket.
  `bin/detection-falsifier.mjs` classifies `capability-*` rows as false positives rather than
  findings, and the per-detector rate above covers the family.
- **Upstream.** The 2026-09-02 review judged this a request to publish the family at `note`, a
  maintainer's taxonomy decision, so an issue rather than a pull request. No issue URL is
  recorded in this repository or its sidecar. Link: pending (operator-held).

### dep-scan: `in_triage` read as REACHABLE, by commitwork

- **What it reported.** commitwork's supply-chain extractor read dep-scan's `in_triage` state as
  REACHABLE for 100 of 105 findings whose true proof count was zero.
- **What was true.** `in_triage` is dep-scan's default analysis state, meaning not yet analysed.
  Measured on one repository with 105 findings: 100 were `in_triage`, and the `*-usages.slices.json`
  the analyser writes was empty, because the slicer writes nothing on a tree with no installed
  dependencies. Zero adjudications from an analyser that never ran, published as a hundred
  reachable paths.
- **How it was found.** The proof count. A finding carrying a reachability verdict with zero
  proofs behind it is an unmeasured result wearing a verdict. `monitor/extractors/supply-chain.mjs`
  now carries dep-scan's `reachability.state` through verbatim, folds everything that is not a
  positive adjudication (`in_triage` included) to `unadjudicated` rather than `unreachable`, and
  yields no reachability counts at all for a run that produced none.
- **Upstream.** None. The 2026-09-02 review of upstream candidates ruled it "NOT UPSTREAM — ours":
  dep-scan reported its state accurately and commitwork misread it. The fix is the extractor change
  above, guarded by `bin/test/depscan-reachability.test.mjs` and `monitor/test/reachability-axis.test.mjs`.

## Other upstream reports

Reports commitwork findings produced on other trackers, listed only where a URL or an
owner/repository#number reference is recorded in this repository or its sidecar, and re-read from
GitHub on 2026-10-18. These are dependency, exit-status and packaging findings from the fleet
sweep, not scanner-verdict defects like the four above. Reports recorded elsewhere without such a
reference are not listed.

| Report | Subject | State on 2026-10-18 |
| --- | --- | --- |
| [joernio/joern#6237](https://github.com/joernio/joern/pull/6237) | `joern-scan` propagated the retry test's exit status, not the JVM's | merged |
| [joernio/joern#6238](https://github.com/joernio/joern/pull/6238) | frontend arguments interpolated unescaped into a generated script | merged |
| [joernio/joern#6241](https://github.com/joernio/joern/issues/6241) | `joern-scan` exits 0 when it refuses its arguments or is given no source path | closed (issue) |
| [joernio/joern#6242](https://github.com/joernio/joern/pull/6242) | fix for #6241 | merged |
| [joernio/joern#6243](https://github.com/joernio/joern/pull/6243) | `PYTHONSRC` mapped to a non-existent `ImportCode` member, so every Python repository failed to scan | merged |
| [joernio/joern#6244](https://github.com/joernio/joern/pull/6244) | `AstGenRunner` absolutised a bare PATH name against the working directory | merged |
| [semgrep/semgrep#11885](https://github.com/semgrep/semgrep/issues/11885) | the OSS engine reports a Pro-only operator in a `p/default` rule as an internal matching error that asks the user to file a bug | open (issue) |
| [anchore/syft#5230](https://github.com/anchore/syft/pull/5230) | CycloneDX output dropped npm lockfile `resolved`/`integrity` provenance | open |
| [trufflesecurity/trufflehog#5264](https://github.com/trufflesecurity/trufflehog/pull/5264) | `x/oauth2` bump with the credential type pinned at three call sites; carries a behaviour change for the maintainer to rule on | open, draft |
| [trufflesecurity/trufflehog#5237](https://github.com/trufflesecurity/trufflehog/pull/5237) to #5245 | nine dependency and CI-pinning changes (recorded as the range #5237 to #5245; #5237 and #5245 re-read) | open |
| [ffuf/ffuf#931](https://github.com/ffuf/ffuf/pull/931) | `x/net` bump clearing nine reachable `x/net/html` advisories | closed |
| [rhysd/actionlint#731](https://github.com/rhysd/actionlint/pull/731) | `x/net` bump, five reachable advisories | open |
| [FiloSottile/age#736](https://github.com/FiloSottile/age/pull/736) | `x/crypto` bump, one advisory reachable via `agessh` | closed |
| [tbphp/gpt-load#477](https://github.com/tbphp/gpt-load/pull/477) | `x/text` bump (GO-2026-5970) | merged |
| [vercel/satori#792](https://github.com/vercel/satori/pull/792) | pin `vite` to clear eleven advisories including one on the KEV list | open |
| [vercel/satori#793](https://github.com/vercel/satori/pull/793) | the larger alternative to #792, opened as not ready to merge | open |

## Checking this page

- The four counts are the ones in the house-invariants prose of `CLAUDE.md` and the Incident
  column of [docs/INVARIANTS.md](INVARIANTS.md); if those move, this page is stale.
- The per-detector rate that catches the TruffleHog and GuardDog shape is published per sweep as
  `defect-signatures.json` by `monitor/rollup.mjs`; `monitor/test/defect-signature.test.mjs` holds
  the check, and the register's third row names it as the ratchet.
- The undetermined handling for Prowler and dep-scan is in `monitor/extractors/posture.mjs` and
  `monitor/extractors/supply-chain.mjs`; `bin/test/scorecard-undetermined.test.mjs` is the guard the
  register names.
- Every link above resolves on the tool's own tracker; the state column is a reading on one day,
  not a property of this repository.
