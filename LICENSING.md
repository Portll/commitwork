<!-- verified-against: 2026-10-08 -->
# Licensing

commitwork's licences are settled. Operator decision **D19** (ruled 2026-09-09) named three, each
over a different part of the tree, and none of them is negotiated per customer:

| | Licence | Covers |
|---|---|---|
| 1 | **AGPL-3.0-or-later** | everything not listed in `manifests/wire-layer.json` |
| 2 | **PolyForm Internal Use 1.0.0**, by written agreement | the same code, as an alternative to 1 |
| 3 | **Apache-2.0** | the wire layer, exactly the files `manifests/wire-layer.json` lists |

1 and 2 are alternatives: you take commitwork under either, at your option. 3 is not an
alternative to them — it is a carve-out, and it applies whichever of the two you are under.

D19 ruled 1 and 2 **on all four components of the distribution**, not on commitwork alone, so a
reader who takes commitwork under either licence meets the same pair in the other three. This
file governs this repository; the stack and its component boundaries are described in
[docs/stack/README.md](docs/stack/README.md).

> ## Where these terms apply
>
> The grants in this file apply to commitwork as published at <https://github.com/Portll/commitwork>, from its first public commit.
>
> commitwork actively probes live targets (`dast-nuclei`, `dast-authz-bola`, `api-fuzz`,
> `tls-headers`). Pointing it at a system you are not authorised to test may be unlawful where you
> are. **No warranty is implied or given.**

## 1. GNU Affero General Public License v3.0 or later

Full text in [LICENSE](LICENSE). This is the default: if you do nothing, this is the licence you
use commitwork under.

AGPL-3.0 is OSI-approved. You may use, modify and distribute commitwork freely under its
terms. The obligation that distinguishes AGPL from GPL is **section 13**: if you modify
commitwork and let users interact with it over a network, you must offer those users the
corresponding source of your modified version.

Running an unmodified commitwork — locally, in your own CI, against your own repositories —
triggers no source obligation. Modifying it and exposing the modified version as a hosted
service does.

**Hosting, including for money, is permitted under the AGPL.** That is deliberate and it is not a
clause we could withdraw if we wanted to: AGPL-3.0 carries no field-of-use restriction, the grant
in [LICENSE](LICENSE) is irrevocable, and section 7 lets any recipient who receives the Program
with "a term that is a further restriction" simply remove that term. So no sentence in this file
narrows it. What section 13 attaches is an obligation rather than a prohibition — host a MODIFIED
commitwork and you must offer your users the corresponding source of your modified version.

The case the AGPL does not reach is therefore a specific one, and it is stated under
[What is not available under either licence](#what-is-not-available-under-either-licence).

## 2. Commercial licence

A commercial licence is available from Portll for anyone who cannot take commitwork under the
AGPL — whether because of what its terms *require*, or because of what your organisation's
policy *allows*. Those are different problems and only the first is about section 13.

### First, check whether you need one at all

**Internal use of commitwork is free under the AGPL and we do not intend to change that.**
Running it locally, in your own CI, or on a schedule against your own repositories is not
distribution and does not engage section 13 — no obligation arises, and nothing you produce
with it is encumbered. If that describes you, you will not need a commercial licence.

Where the AGPL boundary falls for the CLI, the MCP server, `lib/` imports, and the reports and
evidence artifacts commitwork generates is stated in [docs/AGPL-SCOPE.md](docs/AGPL-SCOPE.md).
Most legal reviews resolve there rather than here.

### When you do need one

- Your organisation's policy prohibits AGPL-licensed software **regardless of how it is used**,
  or your legal review cannot accept copyleft terms.
- You want to **embed** commitwork in a proprietary product you distribute without offering
  source.
- You want to **link** it into a codebase you cannot or will not release under
  AGPL-3.0-or-later.
- You want to offer a **modified** commitwork as a hosted or network-accessible service without
  publishing your modifications.

### What the commercial licence is

Ruled by the operator on 2026-09-09: the commercial licence is **PolyForm Internal Use 1.0.0**
(the licence's own title is "PolyForm Internal Use License 1.0.0"; canonical text at
<https://polyformproject.org/licenses/internal-use/1.0.0>, measured 200 on 2026-10-04 — the same
URL with a trailing slash 404s). **It has no SPDX identifier**: the SPDX licence list carries
`PolyForm-Noncommercial-1.0.0` and `PolyForm-Small-Business-1.0.0` and no Internal Use entry
(checked against the published SPDX licence list on 2026-10-04), so anything that needs an SPDX
expression for it has to use a `LicenseRef-`. Granted by written agreement. The
text is used verbatim and is not negotiated; it is not carried in this repository, because under
it no grant exists until an agreement is signed. A one-page order form carries the licensee, the
components and versions, the term, the fee, the support level and the governing law, and nothing
else. Internal Use permits use inside your organisation, including by your contractors, and does
not permit distribution, hosting for third parties, or building a competing product. The first
case in the list above is the one it answers; the other three remain a separate conversation —
see *Open under D19*.

Contact: **john@portll.net**

Nothing in a commercial licence removes anyone else's rights under the AGPL, and choosing one
does not make the AGPL-licensed distribution unavailable to others. Nor does taking one oblige
you to keep it: the AGPL grant is irrevocable and remains available to you at any time.

## What is not available under either licence

Hosting a **modified** commitwork as a service, paid or unpaid, **without publishing your
modifications** is permitted by neither licence, and the two reasons are different:

- Under the **AGPL**, you may host it and you may charge for it. If you modified it, section 13
  requires you to offer your users the corresponding source of your modified version. Hosting it
  modified and closed is not a permitted use.
- Under **PolyForm Internal Use**, hosting for third parties is not permitted at all. The licence
  covers use inside your own organisation, including by your contractors, and does not reach
  distribution, hosting for others, or building a competing product.

So this is not a restriction either licence imposes. It is the **absence of a grant** — no text
here forbids it, and nothing here needs to, because neither licence permits it in the first place.

**That absence can be filled only by specific written agreement with the copyright holder.** A
holder may always grant permissions beyond a published licence, and that is the mechanism here:
if you want to offer a modified commitwork as a hosted service without publishing your changes,
it is a conversation, not a licence you can take off the shelf. Contact **john@portll.net**.

Two things this deliberately does NOT say. It does not prohibit paid hosting — see section 1; the
AGPL permits it and this file cannot take that back. And it does not name a standing licence for
the hosted case, because none has been ruled; see *Open under D19*.

## 3. Apache-2.0 on the wire layer

Ruled by the operator on 2026-09-09 (D19 item 6) and enumerated on 2026-09-11: **the wire layer
carries Apache-2.0** — schemas, MCP tool descriptors and the memory-layer client, and nothing
else — so that an integrator's legal review never has to read the scope document.

This is a carve-out from sections 1 and 2, not a third option: it covers a named set of files
whichever licence you hold the rest of commitwork under. The set is declared in
`manifests/wire-layer.json` and gated by `bin/test/wire-layer-licence.test.mjs`, which fails if a
listed path is missing or has lost its marker:

- `schema/` — the validation contracts, marked by `schema/LICENSE`, less `schema/upstream/`
  (third-party schemas under their own authors' licences)
- `mcp/tools.mjs` — the MCP tool descriptors, split out of the server so a wire file imports
  nothing
- `lib/memory-layer-client.mjs` and `lib/memory-layer-contract.json`

Full text in [LICENSE-APACHE-2.0](LICENSE-APACHE-2.0). **A file the manifest does not list is
AGPL-3.0-or-later**, and the manifest is the authority — not this list, which can drift from it.

## Open under D19

D19 settled the three licences and left these unsettled. They are recorded as open decisions
rather than answered here, because inventing an answer in this file would make it the ruling.

- **The licensor's legal entity.** D19 item 5 ruled "form the Pty Ltd: YES", and the draft deed
  (`docs/stack/COPYRIGHT-ASSIGNMENT.md`) still reads `[Company name] Pty Ltd` — the name is not
  chosen and the company is not formed. Section 2 above says a commercial licence is available
  "from Portll"; that names the project's owner, not a registered company, and it will have to
  name one before the first commercial sale. The copyright holder in
  [LICENSE-APACHE-2.0](LICENSE-APACHE-2.0) moves to the company on the same deed.
- **Hosting and redistribution.** PolyForm Internal Use answers only the first case in *When you
  do need one*. PolyForm Shield was offered as a second tier in the same sitting and was **not**
  taken up, so there is no ruled licence for a third party who wants to host commitwork for
  others or redistribute it outside the AGPL. Those stay a conversation by decision, not by
  omission — the operator confirmed on 2026-10-08 that the hosted-and-closed case is reachable
  only by specific written agreement, which is a mechanism rather than a licence. A standing tier
  for it is still unruled.
- **Governing law.** D19 did not rule one, and the order form is where it lands. The drafts do
  name a law — `docs/stack/TERMS-OF-USE.md` §13 and `docs/stack/COPYRIGHT-ASSIGNMENT.md` §8 both
  say South Australia — but a draft clause is not a ruling, and D19 item 8 put solicitor review
  and the bracketed gaps in the terms at "N/A for now". So the clause is drafted and unreviewed,
  which is deliberately unanswered rather than overlooked.

## Why this pair

Recorded because the choice is load-bearing and a future reader will otherwise re-litigate it.

Operator decision **D10** (`evaluations/DECISIONS.md`, ruled 2026-08-12) settled that commitwork
opens as commercial open source. That ruling deliberately did **not** pick the licence, and
noted that one common reading of "commercial open source" would undo its own point:

- **OSI-approved + commercial revenue** — AGPL (or MPL/Apache) with paid exceptions. Open by
  every funder's definition; commercial upside preserved through the copyleft asymmetry.
- **Source-available** — BSL / Elastic / PolyForm. **Not OSI-approved**, and every
  open-source security funder D10 names (NLnet/NGI Zero, Sovereign Tech Agency, Alpha-Omega,
  GitHub Secure Open Source Fund, OTF) requires an OSI licence as an **eligibility**
  condition, not a preference. That family re-closes the exact door the ruling opened.

AGPL-3.0-or-later plus a commercial exception is the standard way to hold both, and is what
D10 recommends. This file applies that recommendation.

It also matches **memory-layer**, which moved BUSL-1.1 → AGPL-3.0-or-later on 2026-08-19 for the
same reason — so the two halves of this stack carry compatible terms rather than a licence boundary
between them. memory-layer has no public repository yet; the component list is
[docs/stack/README.md](docs/stack/README.md) and only commitwork has a repository today, so there is
no URL to link here until it is published.

## Status — what this file does and does not do

**The public repository is <https://github.com/Portll/commitwork>.** Its history starts at one root
commit built from a reviewed snapshot; the working history stays in a private repository. D10 sub-item 2 put two sweeps before
that root commit:

1. the **secrets sweep** the failure taxonomy already requires, and
2. the **citation sweep** — commit SHAs are quoted across the tracked documents and the failure
   taxonomy, and under a new root commit a reader who checks one finds nothing, because the commit
   it names will not be in the published history.

Both run on every release candidate (`bin/release-candidate.mjs`): the secrets gate with reviewed
dispositions, and the citation strip described below.

**Not everything in this repository is publishable, and the licence does not change that.**
The publishable unit is the whole tracked tree except `ci/` and the operational `CLAUDE.md`, both
export-ignored (operator ruling D25, 2026-10-07; it replaces the ten directories D10 sub-item 1
named, so `mcp/` and the wire layer's `mcp/tools.mjs` ship). `evaluations/` and `reports/` are
audit output about private repositories and are not tracked here, and `monitor/projects.json` is
the live fleet registry (`monitor/projects.example.json` ships in its place).

**How publication happens is settled, and it is not a history rewrite.** The operator ruled on
2026-09-07 that commitwork publishes as a **clean snapshot of the current implementation under one
new root commit**. This supersedes the earlier plan — stated here until 2026-10-05 — that a split
repository or a history-filtered export was required. The public
repository carries reviewed generic descriptions and synthetic fixtures. [docs/PUBLIC-REPOSITORY-BOUNDARY.md](docs/PUBLIC-REPOSITORY-BOUNDARY.md) is the boundary
in full. One consequence belongs here rather than there: because the public history starts at a new
root, every commit SHA this repository cites today would dangle there. D25 settles item 2: the
snapshot builder (`bin/release-candidate.mjs`) makes every `verified-against` stamp date-only and
strips each cited commit SHA, so the published tree points at no history a reader cannot see.
