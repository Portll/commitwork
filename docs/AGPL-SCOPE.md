<!-- verified-against: 2026-10-07 -->
# Where the AGPL boundary falls

> This document states where the AGPL boundary falls for commitwork as published at
> <https://github.com/Portll/commitwork>. It is not itself a licence: [LICENSING.md](../LICENSING.md)
> states the grants, and nothing here grants a right that file does not. **No warranty is implied
> or given.**

commitwork is licensed AGPL-3.0-or-later ([LICENSING.md](../LICENSING.md)).
Copyleft licences attach to *combined works*, and the question every legal review asks is the
same one: **does using this thing pull our code into its licence?**

For most ways of using commitwork the answer is no, and this document says so in writing —
because "probably not" is the sentence that stalls a procurement cycle, and the ambiguity is
ours to resolve rather than yours to litigate.

This is the licensor's stated position on the scope of its own licence. It is **not legal
advice**, it does not bind a court, and it does not modify the AGPL — it tells you how Portll
reads and intends to enforce it. If you need something operative rather than interpretive, see
*Stronger instruments* at the end.

## The short version

| How you use commitwork | Combined work? | Your code's licence |
|---|---|---|
| Run the CLI (`commitwork run`, `scan`, `doctor`, …) | No | Unaffected |
| Run it from a script, Makefile, CI job or launchd/cron unit | No | Unaffected |
| Drive the MCP server (`mcp/server.mjs`) over stdio JSON-RPC | No | Unaffected |
| Call the admin panel's HTTP API (`admin/serve.mjs`, `/api/*`) | No | Unaffected |
| Write manifests, `products.json`, `controls.json`, schema-conformant config | No | Unaffected |
| Consume its reports, SBOMs, VEX, POA&M, OSCAL, attestations | No | Unaffected |
| `import` from `lib/`, `cra/`, `monitor/` into your own process | **Yes** | AGPL applies |
| Vendor or fork the source into your codebase | **Yes** | AGPL applies |

## Why the process boundary is where it is

**Separate processes communicating at arm's length are not one work.** The CLI, the MCP server
and the admin API each run as their own process, exchange data over a documented protocol
(argv and exit codes; JSON-RPC over stdio; HTTP+JSON), and neither party needs the other's
internals to be built or understood. That is data interchange, not linkage. Your harness does
not become a derivative of commitwork by talking to it, any more than it becomes a derivative
of `git` by shelling out to it.

The MCP server deserves the explicit mention because it is the case a cautious reviewer will
flag: an agent framework wiring in `mcp/server.mjs` *feels* like integration. Mechanically it
is a subprocess speaking a public protocol over a pipe. Portll's position is that this is
arm's-length use, and we will not assert otherwise against anyone relying on this document.

**`lib/` is the other side of the line, and it is a real line.** commitwork ships importable
modules. `import { … } from 'commitwork/lib/…'` puts our code in your process and your code in
ours; that is a combined work by any reading, and the AGPL applies to the result. If you need
programmatic access without that consequence, use the MCP server or the CLI — they exist partly
for this reason — or take a commercial licence.

## Output is yours

Nothing commitwork generates is encumbered by its licence. Reports, rollups, slices, the
remediation ledger, CycloneDX SBOMs, VEX documents, POA&M workbooks, OSCAL component
definitions, SOC 2 evidence packets, CRA Art. 14 notification drafts and the signed
attestations over them are **your** artifacts, in whatever form you need them, for any purpose
including submission to a regulator, an auditor or a customer.

This matters more here than in most tools, because commitwork's whole output is compliance
evidence and evidence with an unclear licence is evidence you cannot file. There is no
copyleft on it, no attribution requirement on it, and no obligation to disclose the
configuration that produced it.

Schemas and manifest formats (`schema/**`, the manifest and `products.json` shapes) are
interface descriptions. Portll does not assert that writing a file conforming to them, or
implementing a compatible tool that reads them, creates a derivative work.

## What this does not cover

- **Distribution of commitwork itself**, modified or not, is squarely the AGPL's subject and
  nothing here loosens it. Ship it and section 5/6 apply; ship a modified version as a network
  service and section 13 applies.
- **The name.** No trademark licence is granted by the AGPL or by this document. A fork may
  copy the code; it may not call itself commitwork.
- **Third-party scanners.** commitwork orchestrates tools it does not license to you — semgrep,
  trivy, codeql, gitleaks and others carry their own terms, and CodeQL's in particular restrict
  commercial use. `bin/commitwork.mjs doctor` lists what is installed; the terms are between you
  and those vendors.

## The wire layer is Apache-2.0

The contracts themselves are not copyleft. `schema/*.json`, `mcp/tools.mjs` (the MCP tool
descriptors), `lib/memory-layer-client.mjs` and `lib/memory-layer-contract.json` carry Apache-2.0
(`LICENSE-APACHE-2.0`; the list is `manifests/wire-layer.json`). Validating against a schema,
generating a document that conforms to one, or wiring the tool descriptors into an agent framework
reads a contract, and a contract under Apache-2.0 owes no copyleft analysis. The handlers behind
the descriptors, and everything else, stay AGPL and are reached over the process boundaries above.

## Stronger instruments

A statement of interpretation is the weakest available instrument. Two stronger ones exist, and
which one you need depends on what your reviewer is actually asking for:

1. **A countersigned letter.** The content above, addressed to your organisation, signed by
   Portll, with an undertaking not to assert a contrary reading against you. Free, usually
   same-week. Ask at **john@portll.net**. Enough for most reviews.
2. **An AGPL section 7 additional permission.** Section 7 lets a licensor grant permissions on
   top of the licence, and an exception naming the MCP/CLI boundary would be *operative* rather
   than interpretive — binding, and inherited by downstream recipients. It is the honest answer
   to "your opinion is not a licence grant." It has not been granted, because it also weakens
   the copyleft generally and needs drafting rather than assertion. If your review requires it,
   say so — it is a decision Portll is willing to take, not a position it has refused.

If neither suffices because the objection is to the AGPL as such rather than to any obligation
under it, that is what the commercial licence in [LICENSING.md](../LICENSING.md) is for.
