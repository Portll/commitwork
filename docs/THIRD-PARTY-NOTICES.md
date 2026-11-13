<!-- verified-against: 2026-10-24 -->
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

**The container images are the exception.** The tree ships the Dockerfiles, not the images, but an
image built from them carries the scanners it installs, the GitHub Actions runner and their
runtimes. Section 6 lists what each image holds, so that anyone who passes an image on knows what
they are redistributing.

**The npm surface is empty.** `package.json` declares no `dependencies` and no
`bundledDependencies`; the single `devDependencies` entry is `renovate`, which is a development
tool and is not vendored. `package-lock.json` pins that tool's transitive tree but no
`node_modules` content is tracked. Zero runtime dependencies is a house invariant, and it holds
here: nothing in this document arrived through a package manager at install time.

## How this list was produced

The list is drawn from the tracked set (`git ls-files`), not the working tree. The searches, so a
reader can repeat them and so the gaps are legible:

| What | How |
|---|---|
| Vendored JS | `bin/vendor-verify.mjs`'s `ROSTER`, cross-checked against a tree walk for `.min.js` and a `vendor/` path scan |
| Embedded fonts | `grep -l 'data:font/woff2;base64'` over the tracked set; `find` for `*.woff2 *.woff *.ttf *.otf` |
| Upstream data | `grep -l '"source": "…"'` over `*.json`, then each generator's upstream URL in `bin/{advisory-index,attack-graph,capec-graph,cwe-graph}.mjs` |
| Upstream schemas | `schema/upstream/` — a directory whose name is the claim, and `schema/LICENSE` excludes it by hand |
| Licence headers | `grep -E '@license\|SPDX-License-Identifier\|Copyright \(c\)'` over tracked `*.js *.mjs *.css` |
| Marks and icons | `git ls-files` filtered to `*.svg *.png *.ico`, then each file read, and the rasters **rendered** rather than inferred from their filenames |
| Large blobs | every tracked file over 60 KB, listed and attributed, so a vendored blob could not hide under an unremarkable name |
| Container images | each image built from its Dockerfile and its files listed: `dpkg-query` and `/usr/share/doc/*/copyright` for Debian, each `*.dist-info/METADATA` for Python, the binaries and licence files on disk for the rest; each upstream licence read at the pinned tag through the GitHub API. Since 2026-10-24 each image also lists itself, in the `INDEX.json` its licence directory carries (section 6). The seccomp profile parsed and compared rule by rule with its upstream |

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
- **Not embedded in any other tracked file**, as of 2026-10-07, over the tracked set.

> **Condition met.** An inlined face is a distributed copy, and the OFL requires the
> copyright notice and licence to accompany the font software "whether distributed in the original
> form or modified". `houseFonts('inline')` in `lib/house-css.mjs` emits `PLEX_NOTICE`, a CSS
> comment carrying the IBM copyright line and the licence's name and version, above the faces it inlines,
> and every generator that inlines the faces goes through it, so each inlined copy carries it
> once (`grep -c 'SIL Open Font License'` returns 1).
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
named entry inside a named tarball. A third blob added to that directory fails a test rather than
going unverified and undisclosed.

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

> **Condition met.** `OrbitControls.js` carries **no licence header of its own**:
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
| **GitHub Advisory Database** | `monitor/data/advisory-cvss.json`, `"source": "github-advisory-database"`, built on your machine by `bin/advisory-index.mjs` and not included in a release: advisories reduced to severity label, CWE ids, CVSS vector and score | `api.github.com` advisory API, via `bin/advisory-index.mjs` | **CC-BY-4.0.** Attribution to GitHub, Inc. required. This document is the attribution. |
| **NVD (NIST)** | CVSS values filled into the same file by `--fill-nvd` for advisories GitHub scored | `services.nvd.nist.gov/rest/json/cves/2.0` | US Government work, public domain. NIST asks that NVD be credited and does not claim copyright. |
| **MITRE CWE** | `monitor/data/cwe-graph.json` — 231 KB, `"source": "cwe.mitre.org"`, view 1000, names and `ChildOf` edges | `cwe.mitre.org/data/xml/cwec_latest.xml.zip`, via `bin/cwe-graph.mjs` | CWE Terms of Use; attribution to MITRE required. |
| **MITRE CWE** (catalogue) | `cra/cwe-catalogue.json` — 141 KB, weakness ids and names for CSAF `cwes[]` entries | same | Same. This file states its own terms in a `$comment`: *"CWE used under the MITRE CWE Terms of Use; attribution required"*. |
| **MITRE CAPEC** | `monitor/data/capec-graph.json` — 126 KB, `"source": "capec.mitre.org"`, attack patterns with their CWE mappings | `capec.mitre.org/data/xml/capec_latest.xml`, via `bin/capec-graph.mjs` | CAPEC Terms of Use; attribution to MITRE required. |
| **MITRE ATT&CK** | `monitor/data/attack-graph.json` — 95 KB, `"source": "mitre-attack/attack-stix-data"`, enterprise techniques, tactics and sub-technique hierarchy | `raw.githubusercontent.com/mitre-attack/attack-stix-data`, via `bin/attack-graph.mjs` | ATT&CK Terms of Use; attribution to MITRE required. The STIX data repository is published under Apache-2.0; the ATT&CK content itself is under MITRE's terms. |
| **FIRST.org EPSS** | `monitor/private/epss-detail.json` — exploit-prediction probability and percentile per CVE; an operator-local store, so no copy ships | `api.first.org/data/v1/epss`, fetched by `monitor/rollup.mjs` | Published by FIRST.org for public use; attribution to FIRST requested. |

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
| **GitHub Actions workflow schema** `workflow-v1.0` | `lib/actions-schema.mjs` (35 KB), the definitions of `@actions/workflow-parser` 0.3.61 with their descriptions removed, generated by `bin/actions-schema-gen.mjs` from an oracle install outside the tree | **MIT**, copyright GitHub, Inc. The package's `LICENSE` is the MIT text; the schema file itself carries no licence statement in its bytes. commitwork's reader (`lib/actions-workflow.mjs`) is its own code and takes only this data from the package. |

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

### Tab icons

**Every tab icon is the default mark.** The panel and the sitemap serve it as files; the docsite
shell and the public origin's pages carry it as a data URI (`MARK_ICON`).
`lib/test/brand-marks.test.mjs` holds each copy to the mark.

The served icons were checked by **rendering them**, not by reading their filenames — the question
is what a user receives, and a filename cannot answer it:

- `admin/cw-favicon.svg` and `sitemap/cw-favicon.svg` — byte-identical (sha256 `785b5237…`), the
  default mark, original geometry.
- `admin/cw-favicon-32.png` and `sitemap/cw-favicon-32.png` — byte-identical (`1df4462a…`);
  rendered, and they show the default mark: white ground, black ring, gold key.
- `admin/favicon.ico` and `sitemap/favicon.ico` — byte-identical (`63554c63…`), three frames at
  16, 32 and 48 px; the 48 px frame was extracted and rendered, and it shows the default mark.

**No served icon contains third-party type.**

## 6. The container images

`container/Dockerfile` builds the commitwork image, and `container/runner/Dockerfile` builds the
runner image on top of it ([container/README.md](../container/README.md),
[container/runner/README.md](../container/runner/README.md)). Both are built on the operator's
machine, and neither has been pushed to a registry. An image passed to anyone else redistributes
everything below.

Measured on 2026-10-24 on arm64, in images built from the working tree on a commit with the
Dockerfile's default `SCANNERS` (gitleaks and trufflehog).

### The licence directory, `/usr/share/licenses/commitwork`

Each image carries every component's licence texts under this one directory, and `INDEX.json`
there names each component, its version, its licence, the files that carry it and where its source
comes from. `SOURCES.md` beside it is the offer of source (below). The last build step of each
Dockerfile, `container/licenses.mjs`, builds the directory from what is in the image and
[`container/licenses.json`](../container/licenses.json), and fails the build when a component has
no licence text, when a copyleft component names no source, or when `/opt` or `/usr/local/bin`
holds anything the manifest does not name.

| Where a component's text comes from | Components |
|---|---|
| Debian's `/usr/share/doc/<package>/copyright`, which slim Debian keeps, copied to `debian/<package>/`; `/usr/share/common-licenses`, which those files cite, copied to `common-licenses/` | every Debian package |
| the package's own `dist-info` | 72 of the 74 venv packages |
| the release archive setup verified: with `CW_SETUP_LICENSE_DIR` set, `bin/setup.mjs` copies the archive's `LICENSE` and refuses an archive that has none | gitleaks, trufflehog |
| a file already in the image | Node.js with npm and corepack, yarn, the runner's node20 and node24, commitwork |
| vendored under `container/licenses/` from the upstream at the pinned tag, and checked against its SHA-256 at build time | actions/runner; the .NET runtime's `LICENSE.TXT` and `THIRD-PARTY-NOTICES.TXT`; cosign; semgrep; opentelemetry-util-http; the node image's `docker-entrypoint.sh` |

The runner image holds 223 components. The commitwork image holds 218: all but actions/runner, the
.NET runtime, the two runner Node.js builds and libatomic1.

| Licence family | Debian packages | Python packages | Other | Total |
|---|---:|---:|---:|---:|
| copyleft (GPL, AGPL) | 120 | 1 (flawfinder) | 2 (trufflehog, commitwork) | 123 |
| weak copyleft (LGPL, MPL) | 3 | 2 (semgrep, certifi) | 0 | 5 |
| permissive | 14 | 71 | 9 | 94 |
| not classified | 1 (media-types, "ad-hoc") | 0 | 0 | 1 |

A Debian package is counted copyleft when any stanza of its copyright file is copyleft with no
permissive alternative. The file covers the whole source package, `debian/` included, so 120 is an
upper bound on what the binaries hold. 106 of the 138 copyright files are machine-readable and were
read by their `License:` fields. The other 32 are free-form and are counted by the licences they name.

### The seccomp profile, `container/runner/seccomp.json`

This one is in the tree itself, so every clone redistributes it, whether or not an image is built.

- **Licence:** Apache-2.0. The upstream `LICENSE` is the Apache 2.0 text, the upstream repository
  has no `NOTICE` file at that commit, and the licence text ships at the root as
  [`LICENSE-APACHE-2.0`](../LICENSE-APACHE-2.0).
- **Upstream:** Docker's default seccomp profile, `seccomp/default.json` in moby/profiles at commit
  `4b8214fc4971e06172938a1f1554ccff6647ee80`.
- **Modification:** one rule appended to `syscalls`, an unconditional allow of `clone`, `unshare`,
  `setns`, `mount`, `umount2`, `pivot_root` and `sethostname`, so bwrap can create its namespaces.
  Parsed and compared with the upstream file, every other field and rule is the same. The file is
  re-indented.

> **Condition open.** Apache-2.0 section 4(b) asks that a modified file carry a prominent notice
> that it was changed. JSON has no comments. The added rule's `comment` field names commitwork's
> lane sandbox, but nothing in the file names the upstream or says the file was modified. This
> entry is that notice until the file carries one.

### The commitwork image, `container/Dockerfile`

| Work | Where in the image | Terms |
|---|---|---|
| **Debian 12** from `node:22.23.3-bookworm-slim`, plus ca-certificates, git, bubblewrap, passt, python3 and python3-venv and what they pull in: 137 packages from 91 source packages | the system directories | Each package's copyright file, read by `INDEX.json` (the families above). For the packages the Dockerfile names: git, GPL-2 with parts under GPL-2+, LGPL-2.1+, Apache-2.0, BSD-3-clause, Expat and others; bubblewrap, LGPL-2+; passt, AGPL-3.0-or-later and BSD-3-Clause; ca-certificates, MPL-2.0 and GPL-2+ |
| **Node.js** 22.23.3, with **npm**, **corepack** and **yarn** 1.22.22, as the official image installs them, and the image's `docker-entrypoint.sh` | `/usr/local`, `/opt/yarn-v1.22.22` | Node.js's `LICENSE` (MIT, followed by the licences of what it bundles, npm's Artistic-2.0 and corepack's MIT among them), npm's, corepack's and yarn's (BSD-2-Clause), all copied into the licence directory. npm's own dependencies carry theirs in place. `docker-entrypoint.sh` is nodejs/docker-node's, MIT |
| **Python scanners** from `container/requirements.txt`: semgrep 1.180.0, bandit 1.9.4, flawfinder 2.0.20, ruff 0.17.0 and zizmor 1.30.1, their 67 locked dependencies, and the venv's own pip and setuptools: 74 packages | `/opt/scanners` | As each package's metadata declares them: semgrep LGPL-2.1-or-later, bandit Apache-2.0, flawfinder GPL-2.0-or-later, ruff MIT, zizmor MIT. Among the dependencies, certifi is MPL-2.0 and the rest declare permissive licences, except face, glom and peewee, whose metadata names none; their licence files read BSD-3-Clause (face, glom) and MIT (peewee). semgrep's wheel carries no licence file, so the LGPL-2.1 text comes from semgrep at v1.180.0; opentelemetry-util-http's, the Apache-2.0 text, from opentelemetry-python-contrib at v0.58b0 |
| **gitleaks** 8.30.1 and **trufflehog** 3.99.2, the release assets pinned in `manifests/install-catalog.json` | `/usr/local/bin` | gitleaks MIT, copyright 2019 Zachary Rice; trufflehog AGPL-3.0. Each `LICENSE` is the one in the verified release archive |
| **cosign** 3.1.4, copied from sigstore's image by index digest | `/usr/local/bin/cosign` | Apache-2.0. sigstore's image carries no licence file; the `LICENSE` comes from sigstore/cosign at v3.1.4, which has no `NOTICE` |
| **commitwork** at the commit built | `/opt/commitwork` | [LICENSING.md](../LICENSING.md). `LICENSE`, `LICENSE-APACHE-2.0` and `LICENSING.md` are installed with it, and sections 1 to 5 travel with it as they do in the tree. The tree is JavaScript, so the image carries its source |

### The runner image, `container/runner/Dockerfile`

| Work | Where in the image | Terms |
|---|---|---|
| **actions/runner** 2.338.0, the linux-arm64 or linux-x64 release archive, pinned by SHA-256 | `/opt/actions-runner` | MIT, copyright 2019 GitHub. The archive carries no licence file; the `LICENSE` comes from actions/runner at v2.338.0 |
| **Node.js** v20.20.2 and v24.21.0, bundled in that archive as `externals/node20` and `externals/node24` (371 MB together) | `/opt/actions-runner/externals` | MIT, followed by the licences of what each bundles, in the `LICENSE` beside each, copied into the licence directory |
| **.NET runtime** 8.0.31 (`Microsoft.NETCore.App`), bundled self-contained in that archive | `/opt/actions-runner/bin` | MIT, copyright .NET Foundation and Contributors. No licence file is in `bin/`; `LICENSE.TXT` and `THIRD-PARTY-NOTICES.TXT` come from dotnet/runtime at v8.0.31 |
| **libatomic1** 12.2.0-14+deb12u1, from Debian's gcc-12 | `/usr/lib` | GPL-3+ with the GCC Runtime Library Exception 3.1, in its Debian copyright file. Its source is gcc-12's, in the bundle |

> **Conditions met, measured 2026-10-24.** No image is distributed today. Before one is, the
> publisher still has to publish its source bundle beside it, as below.
>
> - **Licence texts.** Every one of the 223 components in the runner image's `INDEX.json` has at
>   least one licence file in the licence directory, and the build fails when one has none.
>   actions/runner, its .NET runtime, gitleaks, trufflehog and cosign now carry theirs.
> - **Source.** [`container/sources.mjs`](../container/sources.mjs) reads a built image's
>   `INDEX.json` and writes `commitwork-sources-<12 hex>.tar`, named by the first 12 hex digits of
>   that file's SHA-256, with `SOURCES.json` beside it giving each file's origin URL and SHA-256.
>   One run against the arm64 runner image fetched 406 sources, 914 files and 738 MB, with nothing
>   left unfetched:
>   - all 91 Debian source packages, copyleft or not, from the image's own dated snapshot, each file
>     checked against the snapshot's signed index by apt in the image;
>   - the semgrep and certifi sdists from PyPI, by the digest PyPI publishes;
>   - semgrep, flawfinder and trufflehog at their tags, resolved to commits;
>   - the 310 Go modules trufflehog's `go.mod` requires, each checked against its `go.sum`.
>
>   That covers git (GPL-2), passt (AGPL-3.0-or-later), bubblewrap (LGPL-2+), glibc, coreutils,
>   bash and the rest of Debian, gcc-12 for libatomic1, semgrep (LGPL-2.1-or-later), flawfinder
>   (GPL-2.0-or-later), certifi (MPL-2.0) and trufflehog (AGPL-3.0). GPLv2 section 3 and GPLv3 and
>   AGPLv3 section 6(d) accept source offered from the same place as the object code. Each image's
>   `SOURCES.md` names its bundle and the place it is published, which is given at build time with
>   `--build-arg SOURCES_AT=<location>`. Without that argument it reads `<SOURCE-BUNDLE-LOCATION>`,
>   a placeholder for the operator to fill.

> **Gap.** Licence texts of the libraries that are statically linked into binaries. The image
> carries each upstream's own licence, but not the licences of what those binaries link: the Go
> modules in gitleaks (66 in its build information), cosign (253) and trufflehog (310 in its
> `go.mod`); the runner's NuGet packages besides the runtime (Newtonsoft.Json, YamlDotNet,
> Apache.Arrow and its `NOTICE`, the Azure SDK, MSAL, Dev Tunnels and others); and the Rust crates
> in the ruff, zizmor, pydantic-core, rpds-py and cryptography wheels. The gitleaks, trufflehog
> and runner release archives and sigstore's image do not carry them either. The source of semgrep-core's OCaml dependencies is
> not in the bundle either: the semgrep repository at its tag is, but not the opam packages it links.

## What could not be determined

Stated as unknowns, in their own section, because an unmeasured result is not a pass and is not a
finding either.

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
- **Completeness of `schema/upstream/` and `monitor/data/`.** `sitemap/vendor/` is gated by
  `bin/test/vendor-roster-coverage.test.mjs` (section 2). The other two directories in *Maintaining
  this document* are covered by a one-off tree walk and nothing else.
- **Which files a free-form Debian copyright file's licences cover.** 32 of the 138 are free-form.
  They are counted by the licences they name, which says what the package holds but not which file
  is under which licence.
- **The bytes of a GitHub tag tarball.** GitHub makes the tarball on request and publishes no
  digest for it, so the SHA-256 in `SOURCES.json` is the one measured on download, and the pin is
  the tag's commit.
- **An amd64 image.** Both images were measured on arm64. The runner archive and the scanner
  binaries differ by architecture but come from the same upstream releases; no amd64 image was
  opened.

## Maintaining this document

Section 2 is a live invariant: `bin/test/vendor-roster-coverage.test.mjs` fails when a file appears under `sitemap/vendor/` that
the `ROSTER` does not name or that section 2 does not disclose. Section 6's licence directory is
another: an image build fails on a component without a licence text or a copyleft one without a
source, and `bin/test/container-licenses.test.mjs` fails when `container/licenses.json` names a
version the Dockerfiles or the catalogue no longer pin, or a vendored text that is not its pin. The
section's counts are not live. Every other section is a
**point-in-time measurement** and drifts the moment a corpus, a schema or a font face is added, with nothing
failing when it does. Re-run the searches in *How this list was produced* before relying on those.

The places a new entry will come from: `sitemap/vendor/` (add to the `ROSTER` first, then
here), `schema/upstream/`, `monitor/data/` (add the generator's upstream URL to the table in section 3),
and the two Dockerfiles: a new base image, package, scanner or runner version changes section 6
and `container/licenses.json`.
