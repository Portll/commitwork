<!-- verified-against: 2026-10-08 -->
# overwatch-layer — the four-part distribution

> **Draft, unpublished.** This is the README the distribution will carry. It lives in commitwork's
> `docs/stack/` until the distribution has a repository of its own, and it is a statement of
> intent until each component is public under the licence named below. Nothing here is a grant.
> Component names are the ones this tree carries; the product names are settled at release.

overwatch-layer is a Programmer Operating System: the visual shape of a programmer's own
projects, with the IDE plugged into it. It is delivered as **one distribution of four
components**, each with its own repository, release cadence and language, talking to the others
over documented wires. Ruled by the operator on 2026-09-09: the distribution is the unit, the
four stay separate repositories, and overwatch-layer **sits on top of the other three** rather
than beside them.

| Component | What it is | Language | Wire it speaks |
|---|---|---|---|
| **overwatch-layer** | The surface. Sessions, plans, the shell, the published web front. Depends on the three below. | Node, zero dependencies | HTTP on 127.0.0.1:7979 (published, session required) and :7980 (operator, never routed) |
| **spine** | The ledger agent sessions file into: who is working, on what, since when, and what happened. | Node, `node:sqlite` only | MCP over stdio; one SQLite file |
| **memory-layer** | Persistent memory for agents: what was learned, decaying what stopped mattering. | Rust, one binary | HTTP on 127.0.0.1:3030; MCP |
| **commitwork** | Repository security scanning, local CI, scheduled monitoring, remediation tracking and compliance evidence. | Node, zero dependencies | CLI; MCP over stdio; HTTP on 127.0.0.1:7878 |

## Replaceable layers

The wires are contracts, and a component that speaks the contract can stand in for the one
shipped here. Two substitutions are supported by design:

- **An alternate database or memory layer.** spine's ledger is one SQLite file behind an MCP
  surface, and memory-layer is an HTTP and MCP service. Another store that answers the same
  tool names and routes can replace either without the surface or commitwork knowing.
- **An alternate orchestrator.** The dispatch and session-runner half of overwatch-layer is
  reached over the same wires. A different orchestrator that files sessions and tasks into spine
  and reads memory from memory-layer is a supported configuration, not a fork.

What is *not* replaceable is the identity rule the wires carry: `user_id` names a person, never
a project or a writer, and a session is identified by the triple `sessionId|pid|procStart`,
because no one of the three is an identity on its own. A substitute layer must honour both.

## Why four repositories and not one

- **The wires are the licence boundary.** Every component talks to every other as a separate
  process over argv, stdio JSON-RPC or loopback HTTP. That is data interchange, not linkage, and
  it is what lets a user's own code stay unencumbered ([AGPL-SCOPE](../AGPL-SCOPE.md)). A
  monorepo would not change the law, but it would blur the line a legal review resolves against.
- **Two languages, three publish surfaces.** memory-layer is a Cargo crate; the rest are Node
  with no `node_modules`. overwatch-layer holds the zero-dependency invariant *unqualified* and
  records the 2026-08-23 ruling that memory-layer stays out of its tree so the invariant is not a
  lie.
- **History has to stay legible.** memory-layer's fork point is a squashed import over an
  Apache-2.0 upstream, and its NOTICE says so; spine was split out of overwatch-layer on
  2026-09-02 with its commits preserved. A merge that flattened either would destroy the record
  the licence obligations depend on.
- **commitwork is separately fundable.** Open-source security funders assess one project at a
  time under one OSI licence. It stays a project with its own name.

What *is* shared, and is held in this distribution rather than in any one component:

1. **One licence stack.** AGPL-3.0-or-later on every component, with PolyForm Internal Use
   1.0.0 available by agreement for organisations that cannot take the AGPL. Details below.
2. **One set of terms of use** — [TERMS-OF-USE.md](TERMS-OF-USE.md) — governing the hosted
   surface and the evaluation of unpublished builds.
3. **One vulnerability-disclosure contact** across all four: **john@portll.net**, the address
   commitwork's `.github/SECURITY.md` names. It is the contact the EU Cyber Resilience Act's
   Article 14 reporting duties (in force from 2026-09-11) point at, and there is exactly one so
   a reporter never has to guess which component owns a bug that crosses a wire.
4. **One release manifest** pinning the four versions that were tested together, with the
   compatibility matrix and the port and tool-name contract each depends on.

## Installing

Until the distribution has its own repository, install the components individually from their
repositories under the `Portll` GitHub organisation:

```sh
# memory-layer — memory server on 127.0.0.1:3030 (Rust)
./scripts/cargo-dev.sh build --release

# commitwork — security evidence; installs spine as a dependency at 1.0
npm test

# overwatch-layer — the surface; runs as a launchd job, published through a Cloudflare tunnel
npm test
```

Node ≥ 22.5 for spine (it uses the built-in `node:sqlite`); commitwork needs Node ≥ 22.18, the floor
its `package.json` declares. No Docker
is required for the default check set. Everything binds to loopback; the only thing that leaves
the machine is what you route through the tunnel yourself.

## Component responsibilities

commitwork runs repository checks and tracks remediation. spine records session and task
activity. memory-layer stores and retrieves memory. overwatch-layer provides the operator
interface. Each component documents its own inputs, outputs and operational limits.

## Licensing

Ruled by the operator on 2026-09-09. Every component is offered under **either** of the
following, at your option:

1. **GNU Affero General Public License v3.0 or later.** The default. Running an unmodified
   component, locally or in your own CI against your own repositories, triggers no source
   obligation. Modifying one and offering the modified version over a network does (section 13).
2. **PolyForm Internal Use 1.0.0, by agreement.** For organisations whose policy bars AGPL
   regardless of deployment. The licence text is used verbatim and is not negotiated; a
   one-page order form carries the licensee, components, versions, term, fee, support level and
   governing law. Internal Use does not permit distribution or hosting for third parties; those
   remain a separate conversation. Contact **john@portll.net**.

Internal use is free under the AGPL and there is no intention of changing that. Where the
copyleft boundary falls for each wire is written down in [AGPL-SCOPE](../AGPL-SCOPE.md), ahead
of publication, so a legal review resolves there rather than in a negotiation.

**The wire layer is intended to be Apache-2.0.** Schemas, MCP tool descriptors and any client
SDK, and nothing else. An integrator's legal review then never has to read the scope document,
and the copyleft on the core is untouched. The file list is not yet enumerated; until it is,
everything is AGPL.

**Upstream notice.** memory-layer is a derivative work of
[shodh-memory](https://github.com/varun29ankuS/shodh-memory) (Apache-2.0). Those portions
remain under Apache-2.0 and the attribution in its `NOTICE` must be retained in any
redistribution. Apache-2.0 is one-way compatible with AGPL-3.0, which is what permits the
combined work to be conveyed under the terms above.

**Contributions.** A contributor agreement will be required before non-trivial outside code is
accepted, so that the licensor can offer the PolyForm grant over the whole work. Until one is
published, a DCO sign-off is sufficient and no outside contribution is merged into a commercial
build.

## Status — what is and is not public today

Measured 2026-09-09; the commitwork row re-measured 2026-10-07:

| Component | Repository | Licence file | Gate to publication |
|---|---|---|---|
| memory-layer | private | AGPL-3.0-or-later + LICENSING.md + NOTICE | README badges for crates.io, npm and Docker point at registries where **no package by this component's product name exists** (inherited from upstream); ruled 2026-09-09: publish under the product name, then the badges are true |
| commitwork | public repository created 2026-10-07, working history private | AGPL-3.0-or-later, PolyForm Internal Use 1.0.0 by agreement, Apache-2.0 over the wire layer; in force from the first public commit | the release candidate accepting the snapshot |
| overwatch-layer | private | proprietary evaluation licence v1.0 | ruled 2026-09-09: relicense to AGPL-3.0-or-later; the file has not yet been replaced |
| spine | private | AGPL-3.0-or-later + LICENSING.md | cut over live sessions from the copy inside overwatch-layer |

## Documentation

- [TERMS-OF-USE.md](TERMS-OF-USE.md) — terms for the hosted surface and for evaluating
  unpublished builds; South Australian law; what the Australian Consumer Law does not let us
  exclude
- [AGPL-SCOPE](../AGPL-SCOPE.md) — where the copyleft boundary falls at each wire
- commitwork: [README](../../README.md) · [LICENSING](../../LICENSING.md) ·
  [SECURITY](../../.github/SECURITY.md) · [TRAPS](../TRAPS.md)
- memory-layer: `README.md`, `LICENSING.md`, `NOTICE`, `SECURITY.md` in its repository
- spine: `README.md`, `LICENSING.md` in its repository
- overwatch-layer: `HANDOFF.md`, `MCP-TOOLS.md` in its repository
