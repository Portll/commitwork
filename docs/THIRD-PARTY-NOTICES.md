<!-- verified-against: 2026-10-07 -->
# Third-party notices

Every third-party work this repository **redistributes** — ships bytes of, or ships a derivation
of — together with the licence or terms those bytes travel under, and the mark's type provenance.

This is a disclosure document, not a grant. commitwork's own terms are in
[LICENSING.md](../LICENSING.md); nothing here changes them, and nothing in them changes the terms
below. Where a work's terms conflict with commitwork's, the work's terms govern that work.

## Scope, and why it is drawn here

**Redistribution, not use.** A scanner commitwork *invokes* (TruffleHog, Prowler, Semgrep, CodeQL,
GuardDog, dep-scan, joern, nuclei…) is not listed: the fleet runs those tools, it does not ship
them. `manifests/security-baseline.json` names them and the install catalog fetches them; none of
their bytes are in this tree. A dataset commitwork *distils and commits* is listed, because the
distillate is in the tree and is derived from the upstream work.

**The npm surface is empty.** `package.json` declares no `dependencies` and no
`bundledDependencies`; the single `devDependencies` entry is `renovate`, which is a development
tool and is not vendored. `package-lock.json` pins that tool's transitive tree but no
`node_modules` content is tracked. Zero runtime dependencies is a house invariant, and it holds
here: nothing in this document arrived through a package manager at install time.

## How this list was produced

Measured against a commit, over the tracked set (`git ls-files`, 2,090 paths), not the working
tree. The searches, so a later reader can repeat them and so the gaps are legible:

| What | How |
|---|---|
| Vendored JS | `bin/vendor-verify.mjs`'s `ROSTER`, cross-checked against a tree walk for `.min.js` and a `vendor/` path scan |
| Embedded fonts | `grep -l 'data:font/woff2;base64'` over the tracked set; `find` for `*.woff2 *.woff *.ttf *.otf` |
| Upstream data | `grep -l '"source": "…"'` over `*.json`, then each generator's upstream URL in `bin/{advisory-index,attack-graph,capec-graph,cwe-graph}.mjs` |
| Upstream schemas | `schema/upstream/` — a directory whose name is the claim, and `schema/LICENSE` excludes it by hand |
| Licence headers | `grep -E '@license\|SPDX-License-Identifier\|Copyright \(c\)'` over tracked `*.js *.mjs *.css` |
| Marks and icons | `git ls-files` filtered to `*.svg *.png *.ico`, then each file read, and the rasters **rendered** rather than inferred from their filenames |
| Large blobs | every tracked file over 60 KB, listed and attributed, so a vendored blob could not hide under an unremarkable name |

The handoff named five works. The tree shipped **twelve** when this was measured and ships
**eleven** now — the retired monogram was deleted on 2026-10-04, see below. The seven the handoff
did not name —
NVD, EPSS, CycloneDX, CSAF 2.0, CSAF 2.1, OpenVEX, and the retired monogram — are the reason this
was measured rather than transcribed.

## 1. Fonts

### IBM Plex Sans and IBM Plex Mono

- **Licence:** SIL Open Font License 1.1. The full text ships at
  [`admin/static/fonts/LICENSE-IBM-Plex.txt`](../admin/static/fonts/LICENSE-IBM-Plex.txt) (93 lines),
  beside the fonts, as the OFL requires.
- **Copyright:** © 2017 IBM Corp. with Reserved Font Name "Plex".
- **Upstream:** `@ibm/plex-sans` 1.1.0 and `@ibm/plex-mono` 2.5.0 from registry.npmjs.org. The
  tarball digests and the re-derivation command are recorded in
  [`admin/static/fonts/SOURCE.txt`](../admin/static/fonts/SOURCE.txt) (verified 2026-08-27).
  Those packages are the *source*, not a dependency: nothing installs them.
- **Modification:** none. The bytes are upstream, copied unaltered — which matters, because the OFL
  forbids using the reserved name "Plex" on a modified version.
- **Where the bytes are:** eight `.woff2` faces in `admin/static/fonts/` (Sans 400, 400 italic, 500,
  600, 700; Mono 400, 600, 700 — the Latin1 subset only, 188 KB of the 7.7 MB upstream ships), served
  from the panel's own origin; and **base64-inlined** into generated CSS by
  [`lib/house-css.mjs`](../lib/house-css.mjs), which is how they reach the self-contained HTML
  artifacts.
- **Not embedded in any other tracked file**, measured over the tracked set on 2026-10-07. The
  public origin's pages, which carry five faces each as `data:font/woff2;base64`, moved to the
  private commitwork-web repository on 2026-10-06. The remediation register carried them until
  2026-10-05, when it moved into the docsite theme.

> **Condition met since 2026-10-04.** An inlined face is a distributed copy, and the OFL requires the
> copyright notice and licence to accompany the font software "whether distributed in the original
> form or modified". `houseFonts('inline')` in `lib/house-css.mjs` now emits `PLEX_NOTICE`, a CSS
> comment carrying the IBM copyright line and the licence's name and version, above the faces it inlines,
> and every generator that inlines the faces goes through it. All six artifacts above were
> regenerated and carry it: `grep -c 'SIL Open Font License'` returns 1 for each.
> `lib/test/house-css.test.mjs` holds the notice to the first line of `LICENSE-IBM-Plex.txt`.

## 2. Vendored JavaScript

The authoritative list is the `ROSTER` in [`bin/vendor-verify.mjs`](../bin/vendor-verify.mjs),
which checks each blob against its npm-published bytes with the publisher as the anchor. It holds
two entries.

That the list is *complete* is a separate claim, and the verifier cannot make it — it walks the
paths it was handed and never reads the directory. `bin/test/vendor-roster-coverage.test.mjs` makes
it instead: it enumerates every regular file under `sitemap/vendor/` from the filesystem,
recursively and with no extension filter, and fails on any file the `ROSTER` does not name or that
this section does not disclose. Licence notices are the one named exception — they must be
disclosed here but must not be rostered, because the roster's contract is byte-identity with a
named entry inside a named tarball. So a third blob added to that directory now fails a test rather
than going unverified and undisclosed.

### three.js 0.147.0

- **Licence:** MIT. `sitemap/vendor/three.min.js` carries its own header:
  `@license / Copyright 2010-2022 Three.js Authors / SPDX-License-Identifier: MIT`.
- **Copyright:** Three.js Authors, 2010-2022.
- **Upstream:** npm `three` 0.147.0, entry `package/build/three.min.js`.
- **Where:** `sitemap/vendor/three.min.js` (594 KB), used by the sitemap's exterior-view renderer.

### three.js `OrbitControls` 0.147.0

- **Licence:** MIT, by origin — the same `three` 0.147.0 tarball, entry
  `package/examples/js/controls/OrbitControls.js` (the legacy UMD build, not the `examples/jsm/` ES
  module).
- **Where:** `sitemap/vendor/OrbitControls.js` (26 KB).

> **Condition met since 2026-10-04.** `OrbitControls.js` carries **no licence header of its own**:
> the file begins at `( function () {`. A header cannot be added, because `bin/vendor-verify.mjs`
> byte-compares the file against the published upstream and would report `mismatch`. The MIT notice
> travels beside it instead: `sitemap/vendor/LICENSE-three.txt` is the `package/LICENSE` of the same
> `three` 0.147.0 tarball (sha256 `03b50c0c…330988`), copied unaltered. The pages load both files
> from `vendor/` with `<script src>`, so neither is inlined anywhere the licence does not reach.

## 3. Vulnerability and weakness data

Each of these is a **distillate**: commitwork fetches the upstream corpus, reduces it to the fields
it needs, and commits the reduction. The upstream work is therefore redistributed in derived form.
None of these files carries a licence statement in its own bytes except where noted, so the terms
below are the upstream publisher's, recorded here rather than measured in-tree.

| Work | In the tree | Upstream source | Terms |
|---|---|---|---|
| **GitHub Advisory Database** | `monitor/data/advisory-cvss.json` — 7.3 MB, `"source": "github-advisory-database"`, 34,666 advisories reduced to severity label, CWE ids, CVSS vector and score | `api.github.com` advisory API, via `bin/advisory-index.mjs` | **CC-BY-4.0.** Attribution to GitHub, Inc. required. This document is the attribution. |
| **NVD (NIST)** | CVSS values filled into the same file by `--fill-nvd` for advisories GitHub scored | `services.nvd.nist.gov/rest/json/cves/2.0` | US Government work, public domain. NIST asks that NVD be credited and does not claim copyright. |
| **MITRE CWE** | `monitor/data/cwe-graph.json` — 231 KB, `"source": "cwe.mitre.org"`, view 1000, names and `ChildOf` edges | `cwe.mitre.org/data/xml/cwec_latest.xml.zip`, via `bin/cwe-graph.mjs` | CWE Terms of Use; attribution to MITRE required. |
| **MITRE CWE** (catalogue) | `cra/cwe-catalogue.json` — 141 KB, weakness ids and names for CSAF `cwes[]` entries | same | Same. This file states its own terms in a `$comment`: *"CWE used under the MITRE CWE Terms of Use; attribution required"*. |
| **MITRE CAPEC** | `monitor/data/capec-graph.json` — 126 KB, `"source": "capec.mitre.org"`, attack patterns with their CWE mappings | `capec.mitre.org/data/xml/capec_latest.xml`, via `bin/capec-graph.mjs` | CAPEC Terms of Use; attribution to MITRE required. |
| **MITRE ATT&CK** | `monitor/data/attack-graph.json` — 95 KB, `"source": "mitre-attack/attack-stix-data"`, enterprise techniques, tactics and sub-technique hierarchy | `raw.githubusercontent.com/mitre-attack/attack-stix-data`, via `bin/attack-graph.mjs` | ATT&CK Terms of Use; attribution to MITRE required. The STIX data repository is published under Apache-2.0; the ATT&CK content itself is under MITRE's terms. |
| **FIRST.org EPSS** | `monitor/private/epss-detail.json` — exploit-prediction probability and percentile per CVE; a private record because its keys are the CVEs the fleet's scans found, so no copy ships | `api.first.org/data/v1/epss`, fetched by `monitor/rollup.mjs` | Published by FIRST.org for public use; attribution to FIRST requested. |

MITRE's terms for CWE, CAPEC and ATT&CK are a terms-of-use grant with an attribution condition,
**not an SPDX licence** — they cannot be reduced to an identifier, and listing one here would be a
more precise-looking claim than the source supports.

CISA KEV is fetched into `monitor/data/kev.json` by the same rollup. That file is **not tracked**,
so it is not redistributed by this repository; KEV is a US Government work in the public domain in
any case. It is named here so its absence from the table above reads as measured rather than missed.

## 4. Upstream schemas

`schema/upstream/` holds four third-party JSON Schema documents, copied verbatim.
[`schema/LICENSE`](../schema/LICENSE) already excludes this directory by hand — *"schema/upstream/
holds third-party schemas under their own authors' licences; nothing in this file changes those
terms"* — so commitwork's own Apache-2.0 grant over `schema/` does not extend to them.

| Schema | File | Terms |
|---|---|---|
| **CycloneDX** BOM 1.5 | `bom-1.5.schema.json` (161 KB) | **Apache-2.0**, declared in the file's own `$comment`: *"CycloneDX JSON schema is published under the terms of the Apache License 2.0."* Copyright OWASP Foundation / CycloneDX contributors. |
| **OASIS CSAF** 2.0 | `csaf_json_schema.json` (56 KB) | OASIS material, under the OASIS IPR Policy. The file carries **no licence statement in its bytes**. |
| **OASIS CSAF** 2.1 (CSD02) | `csaf-2.1-csd02.schema.json` (69 KB) | Same. A committee-specification draft, not a final standard. |
| **OpenVEX** 0.2.0 | `openvex_json_schema.json` (12 KB) | The OpenVEX specification is published by the OpenVEX project under Apache-2.0. The file carries **no licence statement in its bytes**. |

> **Gap.** `schema/upstream/` has no per-file provenance record — no retrieval date, no upstream
> URL beyond each schema's `$id`, no digest. Both other vendored surfaces in this repository have
> one (`admin/static/fonts/SOURCE.txt` and the `ROSTER` in `bin/vendor-verify.mjs`), and this
> directory is the one that does not. The `$id` fields give the canonical URLs, which is why the
> works are identifiable at all; what is missing is *which revision was taken, and when*.

## 5. The mark, and its type provenance

The logo is **original work**: a disc, a ring, and a key of two nodes joined by a line, on a
32-unit square. Its geometry is drawn once in [`lib/brand-tokens.mjs`](../lib/brand-tokens.mjs)
(`SEAL_SVG`), every variant is that geometry recoloured, and it derives from no third-party work.
[`design/brand/README.md`](../design/brand/README.md) is its reference.

The **wordmark** — "commitwork" in the lockup — is live text set in IBM Plex Sans 700, never an
image. Its type provenance is therefore entry 1 above: OFL-1.1, IBM Corp. No glyph outlines are
embedded for it.

### The favicon directive

Operator directive, 2026-09-30: **every tab icon is the default mark.** The panel and the sitemap
serve it as files; the docsite shell and the public origin's pages carry it as a data URI
(`MARK_ICON`). `lib/test/brand-marks.test.mjs` holds each copy to the mark.

The served icons were checked by **rendering them**, not by reading their filenames — the question
is what a user receives, and a filename cannot answer it:

- `admin/cw-favicon.svg` and `sitemap/cw-favicon.svg` — byte-identical (sha256 `785b5237…`), the
  default mark, original geometry.
- `admin/cw-favicon-32.png` and `sitemap/cw-favicon-32.png` — byte-identical (`1df4462a…`);
  rendered, and they show the default mark: white ground, black ring, gold key.
- `admin/favicon.ico` and `sitemap/favicon.ico` — byte-identical (`63554c63…`), three frames at
  16, 32 and 48 px; the 48 px frame was extracted and rendered, and it shows the default mark.

**No served icon contains third-party type.** That is a measurement, and it is the one that
matters for the entry below.

### Helvetica Bold outlines — the retired CW monogram, DELETED 2026-10-04

**Closed by deletion.** `admin/cw-mono.svg` is gone from the tree as of 2026-10-04. It was the one
entry in this document with no licence, and it no longer ships. Nothing replaces it: the mark on
every surface is `MARK_SVG` in `lib/brand-tokens.mjs`, original geometry, already covered above.

What it held, kept here because the record has to outlive the file: **real Helvetica Bold glyph
contours for "c" and "w"**, extracted with fontTools per the file's own comment and laid out on
their true advances, then scaled 1.15× about their ink centre. The last version is blob
`4189d3f7f5eb70740e1c8ab8aea0b2b9b7d55c2a`, readable at the commit before this one, so the deletion
does not destroy the evidence for the judgement.

**Why deletion rather than a determination.** Helvetica is a proprietary typeface (Linotype, now
Monotype). Typeface *designs* are not copyrightable in the United States, but font *software* is,
and several jurisdictions — Germany and the UK among them — protect the design as well. Outlines
extracted from a licensed font binary and redistributed as SVG path data are not obviously covered
by any desktop font licence, which typically permits embedding for document display and not
redistribution as derived vector artwork. **That question is still not answered here**, because it
is a legal reading and not a measurable one. Deleting the file removes the question instead of
answering it, which is the cheaper of the two moves and the only one this document could support.

**The deletion cost nothing, and that was measured before it was done.** Re-verified 2026-10-04,
tree-wide and in every form (`cw-mono.svg`, `cw-mono`, `cwmono`, `mono.svg`, `monogram`): no route
in `admin/serve.mjs` or `admin/routes/*.mjs` served it, no markup in `admin/panel.html`, the
generated `admin/index.html` or `admin/menus/*` referenced it, none of `admin/static/*.js` loaded
it, no manifest or asset list named it, and no test read it — `lib/test/brand-marks.test.mjs`
enumerates only the two `cw-favicon.svg` files. The sole code-shaped match was `--cw-mono`, a CSS
custom property for the mono font stack in `admin/static/theme.css` and an unrelated name
collision. The only references were prose: this entry and README's index line, both updated with
the deletion.

## What could not be determined

Stated as unknowns, in their own section, because an unmeasured result is not a pass and is not a
finding either.

- **Which Helvetica — now moot, and recorded rather than erased.** `admin/cw-mono.svg` said "the
  real Helvetica Bold contours… extracted with fontTools" and named no source file, foundry,
  version or platform. Whether the outlines came from a macOS system font, a licensed desktop
  purchase, or a clone with different outlines was never recoverable from the tree, and it was the
  fact that would have decided which terms applied. It stopped mattering on 2026-10-04 when the
  file was deleted: there is no longer a redistribution to find terms for. The question is kept
  here because the deletion closed it by removing the exposure, not by answering it.
- **CSAF 2.0 / 2.1 and OpenVEX exact terms.** Neither file carries a licence statement, and neither
  the upstream repositories nor the OASIS IPR declarations were fetched for this document — the
  measurement was the tree, not the network. The terms in the table are the publishers' generally
  stated ones, recorded as such and not verified against a retrieved source.
- **Which revision of each upstream schema.** See the gap in section 4. The `$id` fields pin the
  schema version; nothing pins the retrieval.
- **Whether the GHSA distillate is a "substantial" reuse** for CC-BY-4.0 attribution-format
  purposes. 34,666 advisories reduced to four fields each is plainly substantial in volume; whether
  the licence's full attribution block is required rather than the credit given here is a legal
  reading, not a measurement.
- **Completeness of the vendored-JS roster was ungated. Closed 2026-10-04.** `bin/vendor-verify.mjs`
  verifies the blobs it lists and never reads the directory, so nothing asserted that the list
  covered everything in `sitemap/vendor/`. The search for such an assertion returned none: the only
  test naming `sitemap/vendor` was `bin/test/scanner-canary.test.mjs`, where it is a fixture path
  for a minification finding, and `monitor/test/vendor-conservation.test.mjs` — despite its name —
  is about severity-bucket conservation in the vendor-scan lane. A third blob dropped into that
  directory would have been verified by nothing and would not have appeared here. The tree walk done
  for this document found no such blob, which was a sampled zero with no mechanism keeping it true.
  `bin/test/vendor-roster-coverage.test.mjs` is now that mechanism; see section 2. What remains
  undetermined is the other two directories in *Maintaining this document*: `schema/upstream/` and
  `monitor/data/` are still covered by a dated tree walk and nothing else.

## Maintaining this document

Section 2 is a live invariant since 2026-10-04:
`bin/test/vendor-roster-coverage.test.mjs` fails when a file appears under `sitemap/vendor/` that
the `ROSTER` does not name or that section 2 does not disclose. Every other section is still a
**dated measurement** and drifts the moment a corpus, a schema or a font face is added, with nothing
failing when it does. Re-run the searches in *How this list was produced* before relying on those.

The three places a new entry will come from, in the order they have historically appeared:
`sitemap/vendor/` (add to the `ROSTER` first, then here), `schema/upstream/`, and
`monitor/data/` (add the generator's upstream URL to the table in section 3).
