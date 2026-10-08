<!-- verified-against: 2026-10-08 -->
# cra/ — EU Cyber Resilience Act readiness (Phase 1)

Reporting obligations under CRA **Art. 14** start **11 September 2026**: an *actively
exploited* vulnerability (or severe incident) in a product placed on the EU market must
be notified via the ENISA single reporting platform — early warning in **24h**, fuller
notification in **72h**, final report in **14 days**. The rest of the CRA's
vulnerability-handling duties (Annex I Part II) are continuous: current SBOM, remediate
without delay, regular testing, CVD policy, advisories, free security updates.

This module turns the monitor's existing evidence (slices, KEV/EPSS enrichment, the
provenance-gated lifecycle, the evidence-tiered remediation ledger) into that
compliance surface. **Everything it emits is a draft or a documentation artifact —
submission to authorities is always a human act.**

## The unit shift: repos → products

The CRA regulates *products*, not repos. The product registry is the mapping. It names the
operator's customers and their repositories, so it is a private record,
`monitor/private/cra-products.json` (`CW_PRODUCTS`); `cra/products.example.json` is the shipped
shape, and with no registry `preflight.mjs` reports the module not configured. It is
validated by `../schema/product.schema.json`: each product lists the monitor repo
names that ship in it, its reporting locale (`reporting.locale`, or `market.eu: true` as
the older spelling of `EU`) and the manufacturer identification every notification needs.
The locale decides a case's **track**, never whether it opens: every product a triggering
repo maps to gets a case, and only a locale with a delegated advisory body puts it on the
`article14` track (Art. 14 drafts, and exit 3 when a clock is overdue). The seeded products declare no locale
(`market.eu: false`), so a KEV or EPSS trigger opens a `bestpractice` case — the Art. 14
clocks run and nothing is filed — and **nothing reaches `article14` until someone reviews
`products.json`**.

## Pieces

| File | What it does |
|---|---|
| `watch.mjs` | Every 30 min (the launchd agent below): joins open findings × current KEV catalog × EPSS × products. A trigger (KEV-listed, or EPSS ≥ `CRA_EPSS_THRESHOLD`, default 0.5) opens a **vulnerability case** with the 24h/72h/14d clocks on every product the repo maps to. The track decides what follows: `article14` drafts all three notifications; `bestpractice` runs the same clocks and files nothing. A critical finding (severity crit, or CVSS ≥ `CRA_CRIT_CVSS`, default 9.0) with neither Art. 14 trigger opens an `internal` policy case, which never pages, never files and never sets the exit code. Unmapped repos and EPSS near-misses (≥ `CRA_EPSS_WARN`, default 0.1) are listed as advisory — visible, not actionable. Also declares **severe incidents** (`incident` subcommand — the CRA's second Art. 14 trigger, human-declared) and guards against **stale evidence** (a slice older than `CRA_STALE_HOURS`, default 26h, means the feeding sweep may have stopped — flagged loudly). Exit 3 = an `article14` clock is overdue; 4 = evidence is stale; 5 = an overdue clock could not be paged; 6 = the case log was locked, so nothing was written. |
| `cases.json` | Append-only, **hash-chained** case log (`watch.mjs verify`). What-was-known-when, tamper-evident. Never hand-edit. |
| `report.mjs` | Renders the Art. 14(2)(a)/(b)/(c) drafts per case (md + json) into `reports/cra/cases/<caseId>/`. Final-report remediation claims come only from **strong/medium** ledger evidence. |
| `sbom.mjs` | Per-product CycloneDX SBOM merged from the latest sweep's per-repo SBOMs; dedupes by purl, tags each component with its repo(s), drops vendored `reference/`/`reports/` components, reports missing-repo coverage gaps loudly. |
| `spdx.mjs` | SPDX 2.3 JSON of a CycloneDX SBOM's component set — `sbom.mjs` writes `<product>-<version>.spdx.json` beside each `.cdx.json`; also a CLI for any CycloneDX file. Deterministic (content-hashed `documentNamespace`, `created` from the CycloneDX timestamp); document-level `commitwork:` caveats travel as the SPDX comment. |
| `vex.mjs` | Per-product VEX from the lifecycle: open→`exploitable`, not-scanned or carried→`in_triage`, ledger strong/medium→`resolved` (weak evidence never claims resolved), annotation fp→`false_positive`, accept/wont-fix→`accepted`, which is affected and never `not_affected` (CycloneDX `exploitable` + `will_not_fix`, CSAF `known_affected` + `no_fix_planned`, OpenVEX `affected`). The worst state wins per CVE, and one decision is projected to CycloneDX, CSAF 2.0, CSAF 2.1 and OpenVEX (`reportFormats` chooses which are written). explicit uncertainty, in machine-readable form. |
| `pack.mjs` | Annex I Part II documentation pack per product: crosswalk index, vulnerability-handling process **generated from live config**, CVD policy template, verified-remediation log (+MTTR), advisories stub. `[HUMAN]` marks what tooling cannot truthfully claim. |
| `preflight.mjs` | "Is this configured to actually work?" Validates `products.json` (schema + placeholder/seeded state), cross-checks the mapping against the live rollup (repos mapped-but-never-scanned; scanned-but-orphan), previews whether anything would trigger, and checks input freshness. Exit 1 on hard config error. **Run this first.** |
| `controls.json` + `controls.mjs` | Advisory crosswalk mapping each baseline check → CRA Annex I Part II / SOC 2 TSC / NIST 800-53 Rev 5 controls, plus a `coverage` command: per product, which controls are **evidenced** (a mapping check provably ran, or a ledger / annotation / monitoring-program / audit-records / KEV-EPSS source is present) vs **mapped** (addressed but not proven — explicit uncertainty). **Scope-honest:** every denominator is the controls commitwork *maps* — the technical subset — carrying the framework catalogue size (~1007 for 800-53, ~323 Moderate; ~33 SOC 2 Common Criteria) so `19/21` is never misread as framework coverage. The SOC 2 list names all 33 common criteria, so the ones with no supplying check are enumerated rather than omitted. KEV/EPSS enrichment evidences a product only when the slice scanned one of its repos. The organizational majority is out of scope (GRC). |
| `dashboard.mjs` | Self-contained CRA readiness dashboard (`reports/cra/dashboard.html`, data inlined, file:// safe): preflight status, per-product coverage meters + control tables, open Art. 14 cases with clock state, SBOM/VEX presence. |
| `poam.mjs` + `poam-to-xlsx.py` | FedRAMP-style Plan of Action & Milestones (code-side scope): open findings + verified-closed ledger entries mapped to NIST 800-53, with the SLA clock that matters — remediation due from **discovery date** (Critical/High 30d, Moderate 90, Low 180), each row citing the tool + slice that found it (raw-scan → row traceability), deviations from annotations (FP/OR). `poam.mjs` (zero-dep) emits JSON + CSV; `poam-to-xlsx.py` (openpyxl) renders the Cover/Open/Closed/Deviations workbook. A working artifact to reconcile into your official template, not the government xlsx itself. |
| `oscal.mjs` | Emits an **OSCAL Component Definition** (NIST's machine-readable format, v1.1.2) per product with two control-implementations: the evidenced/mapped **NIST 800-53 Rev 5** controls, and all 33 **SOC 2 Trust Services Criteria** common criteria. Each implemented-requirement carries an `implementation-status` (implemented when a mapping check provably ran / an evidence source is present; planned when only mapped), a commitwork `evidence-status` (`evidenced` / `mapped` / `not-evidenced`) and a statement citing the evidence. A SOC 2 criterion that no check or evidence source supplies (per `controls.json`) is `not-evidenced` and carries no implementation-status, so it is listed and never claimed. UUIDs are content-derived and RFC 4122 v5-shaped, as OSCAL's uuid type requires; `last-modified` honours `CW_CRA_NOW`. The GRC-ingestible "we satisfy these controls" assertion — not a claim to be the system of record. |
| `soc2.mjs` | SOC 2 Type II evidence packets keyed to the Trust Services Criteria: CC7.1 population + coverage completeness, CC7.2 **cadence with gap detection** (a monitoring interval wider than `SOC2_MAX_GAP_DAYS` is a control-operation exception), CC7.4 open cases + risk decisions, CC7.5 verified-closed + MTTR by severity, CC8.1 change-management (with a `[HUMAN]` note for PR-approval evidence commitwork doesn't hold). Feeds an audit / Vanta / Drata — not an opinion. |
| `attest.mjs` | Signed evidence (ed25519, zero-dep): `keygen` / `sign` / `verify` over the rollup, ledger, cases, annotations, products — a canonical digest + detached signature per artifact, plus a **hash-chained attestation log** signing the whole evidence *set* at each instant. `verify` recomputes digests, checks signatures, and re-checks the chain (exit 1 on any tamper; exit 3 when the only fault is a torn final record — an append that did not complete, which `sign` refuses to build on). The local-first integrity primitive; private key gitignored, and `keygen` fails rather than leave it readable when it cannot be restricted to 0600. |
| `timestamp.mjs` | RFC 3161 trusted timestamps (zero-dep, `../lib/der.mjs` for the DER): `stamp` sends a TimeStampReq (SHA-256 of each `signatures/*.sig` record, random nonce, certReq) to the TSA named by `CW_TSA_URL`, verifies the reply, then writes `<record>.tsq` and `<record>.tsr` beside the record. `verify` checks the imprint against the record's current bytes, the nonce against the stored request, the CMS signature and signing-certificate binding against the TSA certificate in the token, and the TSA certificate's timeStamping usage and validity at genTime. With `CW_TSA_CA` (a PEM bundle) it also requires the chain to reach that anchor. Verdicts: **anchored** (exit 0), **unanchored** (signature valid, chain not anchored; exit 20), **absent** (21), **invalid** with its reason (22); a failed request exits 23. Revocation is not checked. Nothing calls a TSA unless `CW_TSA_URL` is set; FreeTSA (`https://freetsa.org/tsr`) and DigiCert (`http://timestamp.digicert.com`) are examples, not defaults. Re-running `attest.mjs sign` rewrites the records, so their old tokens then verify as invalid until re-stamped. |
| `refresh.mjs` | One command / one launchd job for the **whole** evidence set: `preflight → sbom → vex → pack → poam (+xlsx) → soc2 → coverage → oscal → watch → dashboard → attest sign+verify` (sign and verify only when a key exists), isolating each step, propagating the worst exit, and writing `evidence-index.json` — a catalogue of every produced artifact with its sha256 (and, when a key exists, ed25519 attestations), plus `inputs[]`: the sha256 of each input the pack was built from. Every run, including one stopped at the preflight gate, writes `refresh-status.json` with its exit, `ok`, a reason and each step's outcome (`ok` / `signal` / `skipped` / `failed`). `--no-sign` / `--no-xlsx` to skip. |
| `evidence-status.mjs` | Whether the evidence pack is current. `current` only when `generatedAt` is within `CW_CRA_EVIDENCE_STALE_HOURS` (default 36, read at call time), no evidence input (rollup, ledger, history, annotations, products, controls) has changed since, and the last refresh did not fail. Otherwise `stale`, `never-generated` (no `evidence-index.json`), `failed` (last refresh's exit and reason) or `unknown` (an unreadable record or threshold, or a pack that records no inputs). A KEV or EPSS update is listed under `feedsChanged` and does not on its own make the pack stale. Exit 0 / 20 / 21 / 22 / 23 respectively; `--json` for the record. The panel serves it at `GET /api/cra/evidence` and the MCP `readiness` tool carries it as `evidencePack`. |
| launchd agent `com.portll.commitwork-cra-watch` | Generated per machine by `../monitor/install-agents.mjs` (the committed plist is gone — launchd cannot expand `~` or a login PATH, so a portable plist cannot exist): `watch.mjs watch` every 30 min and at load, with `CRA_FETCH=1` refreshing the CISA KEV catalog (graceful offline fallback). `node monitor/install-agents.mjs --write --load` installs it. |
| launchd agent `com.portll.commitwork-cra-refresh` | Generated by the same script: `refresh.mjs` daily at 06:30, after the nightly sweep ladder, and not at load. Writing and loading it stays a human act (`--write --load`). On Linux, a `systemd --user` timer with `OnCalendar=*-*-* 06:30` or the crontab line `30 6 * * * node cra/refresh.mjs`. If the job stops firing, `evidence-status.mjs` reports the pack `stale` once it passes the threshold. |

### First run on a new checkout: fetch KEV before anything else

```sh
CRA_FETCH=1 node cra/watch.mjs        # once, then the launchd agent keeps it current
```

`monitor/data/kev.json` is a **gitignored network cache**, so a fresh clone, a CI job or a
`git worktree` has no catalogue at all until the first fetch. Freshness is judged from the
catalogue's own `catalogVersion` / `dateReleased`, never the file's mtime, and nothing refuses
to run on it:

- `rollup`, `watch` and `preflight` all warn past `CRA_KEV_STALE_DAYS` (default 7): one name, one
  threshold, read by `kevStaleDays()` in `lib.mjs`. The rollup's former `CW_KEV_STALE_DAYS` is
  refused rather than ignored, and so is a non-numeric value — either one reads freshness as
  `unknown`, naming the reason. The rollup records `enrichment.kevFreshness`; a missing or empty
  catalogue records every finding's `kev` as `null` (not consulted), never `false`.
- The watch's exit 4 is about the rollup slice's age (`CRA_STALE_HOURS`), not the catalogue's.

So the failure mode is quiet under-reporting, not a hard stop: a stale list still enriches and
misses whatever CISA has added since, and an absent one leaves KEV unknown on every finding. Read
the warning, and run the fetch first on any new machine, CI job or worktree.

When the cache was still tracked, this bit once from the inside: a HEAD worktree created to
attribute a test failure inherited the stale committed copy, `scope-containment` failed on it, and
the staleness was briefly reported as a live defect in the working tree — where the catalogue was
in fact 0 days old.

## Case lifecycle

Two case kinds share the machinery; only the final-report clock differs.

```
VULNERABILITY  watch (auto)          ack (human)              measure (human)          close (human)
               finding crosses   →   real awareness time  →   corrective measure   →   done/not-applicable
               trigger; clocks       re-bases all clocks      available; final
               run from detection                             report = measure + 14d   (Art. 14(4)(a))

INCIDENT       incident (human)      ack implicit             submit (human)           close (human)
               severe incident   →   awareness = now      →   notification sent    →   done
               declared; clocks                               to SRP; final report
               run immediately                                = notification + 1 month (Art. 14(4)(c))
```

```sh
node cra/preflight.mjs             # FIRST: is products.json configured, mapping sound, evidence fresh?
node cra/refresh.mjs [--fetch]     # rebuild everything, in the order the refresh.mjs row lists
node cra/evidence-status.mjs       # is the pack current? stale / never-generated / failed / unknown
# …or the individual tools:
node cra/watch.mjs                 # run the join now (also what launchd runs); flags stale evidence
node cra/watch.mjs incident --product client-a --title "Data exfiltration via gateway" --summary "…"
node cra/watch.mjs ack client-a--cve-2026-12345
node cra/watch.mjs measure client-a--cve-2026-12345 --detail "hotfix 1.4.2 released"
node cra/watch.mjs submit <caseId> --stage notification   # records SRP submission; re-bases incident final clock
node cra/watch.mjs verify          # hash-chain integrity
node cra/sbom.mjs && node cra/vex.mjs && node cra/pack.mjs
node cra/poam.mjs && python3 cra/poam-to-xlsx.py   # FedRAMP POA&M workbook
node cra/soc2.mjs                                  # SOC 2 evidence packets (CC7.x)
node cra/attest.mjs keygen && node cra/attest.mjs sign && node cra/attest.mjs verify   # sign the evidence
CW_TSA_URL=https://freetsa.org/tsr node cra/timestamp.mjs stamp && node cra/timestamp.mjs verify   # RFC 3161 tokens
node --test "cra/test/**/*.test.mjs"   # the suite (fixture-driven, no network, no tools)
```

## Determinism & evidence discipline

Same inputs ⇒ byte-identical outputs: timestamps honour `CW_CRA_NOW`, SBOM/VEX serial
numbers are content-derived UUIDs, writes are atomic (tmp+rename), the case log only
gains events on material change (EPSS noise < 0.05 is not an event). EPSS fetch
failures stay `null` (unknown) — never 0 (monitor breaker B1 holds here too).
Every input path is env-overridable (`CW_ROLLUP`, `CW_LEDGER`, `CW_ANNOTATIONS`, `CW_KEV`,
`CW_EPSS`, `CW_EPSS_DETAIL`, `CW_CWE_CATALOGUE`, `CW_PRODUCTS`, `CW_PRODUCT_SCHEMA`,
`CW_CONTROLS`, `CW_HISTORY`, `CW_CASES`, `CW_CRA_OUT`, `CW_BASELINE_MANIFEST`, `CW_SWEEP_DIR`,
`CW_REPORTS_DIR`, `CW_ATTEST_KEYDIR`, `CW_ATTEST_LOG`, `CW_TSA_URL`, `CW_TSA_CA`, `CW_REGISTRY`; `CW_CRA_ROOT` re-roots
the defaults `cra/lib.mjs` resolves) — the test suite runs entirely on fixtures. `CW_CRA_ROOT`
names a root, so it also REFUSES an ambient `CW_REGISTRY` and reads that root's own registry (the
`{ ambient: false }` rule in `../monitor/store-paths.mjs`): a fixture run cannot read the live
registry just because the shell exported it.
`CW_MONITOR_OUT` is deliberately not honoured here: it belongs to the monitor's writers, not
CRA's readers.

## Which identifiers the evidence cites — and which lane it can see

Measured 2026-08-13, to answer two questions asked of the issue-store re-key
(plan `cw-control-loops-20260812`). The first answer is reassuring; the second is not.

**The re-key does not touch this evidence.** POA&M ids are content-derived —
`poamId = V-<sha256(key).slice(0,8)>` (`cra/poam.mjs:55`) — and the key is
`f.key` for open items and `e.key` for closed ones, where `f` comes from
`openFindings(rollup)` and `e` from `ledger.entries`. Neither is the issue store's
`source.key`. **No CRA artefact cites an issue key or an `ISS-` id** (`grep` across `cra/`
returns nothing), so migrating scanner-row identities cannot invalidate an issued POA&M.
The concern was filed against the wrong subsystem.

**But the POA&M sees only the dependency lane.** `openFindings` reads only
`rollup.repos[].findings` (`cra/lib.mjs:503-513`). When this was measured that was also the
array the fleet headline read; the headline has since moved to `openTotalsFor(totals)`
(`monitor/rollup.mjs:991`), which covers the CVE feed and every scanner lane. The POA&M has
not moved. Measured fleet-wide on 2026-08-13:

| what the POA&M enumerates | what it cannot see |
|---|---|
| **47** dependency-lane findings | **9,597** scanner-lane rows |

So SAST (`sastCodeql`, `sastSemgrep`, `sastCodeqlJava`, `sastGo`), IaC, Dockerfile, CSPM,
actions-posture and the rest are structurally absent from a document whose purpose is to
enumerate open weaknesses. This is false-clean class C1/C12, in the artefact with the
strongest completeness claim. (`reachability-evidence.mjs` does read `scannerFindings{}`, for
reachability only; nothing that enumerates POA&M rows does.)

**What follows from it.** The re-key (Lane A) is cleared to proceed against CRA. The item
that *does* move POA&M contents is the display work (Lane B, `I1`/`I8`): changing what
`openFindings` returns changes what the POA&M enumerates and therefore which `poamId`s
exist. Sequence accordingly, and treat the first POA&M generated after that change as a
**re-basis** — a step change in item count that is arithmetic, not deterioration.

Whether a POA&M *should* carry SAST findings is a judgment (NIST usage says weaknesses,
not only vulnerabilities) and therefore an operator call, not a silent widening. Recorded
here rather than fixed here.

## What this deliberately is NOT (yet)

- **Not a submitter.** The ENISA SRP was not yet live when this was built; drafts are
  generated for human review and submission. Revisit automation once the platform and
  the legal-representative question settle.
- **Not auto-detected incidents.** Severe incidents (Art. 14's second trigger) are now
  supported via `incident` — but declared by a human, because whether something is a
  *severe incident* is a judgment, not a scan result. They reuse the case/clock/draft
  machinery with the one-month final-report rule.
- **Not identity-bound, and timestamped only on request.** The evidence is signed
  (`attest.mjs`: a detached ed25519 signature per durable artifact plus a signed,
  hash-chained set attestation), but the signer is whoever holds the local key.
  `timestamp.mjs` can add an RFC 3161 token per signature record, which shows the record
  existed at the TSA's genTime; it is only as trusted as the anchor configured in
  `CW_TSA_CA`, and revocation is not checked. Still absent: per-human identity (Phase 2
  SSO), a transparency log, and a KMS-held key with server-side storage.
