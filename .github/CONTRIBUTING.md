# Contributing

<!-- verified-against: 2026-10-07 -->

commitwork is a repository security scanner, local CI runner and scheduled monitoring system with
remediation and compliance-evidence tooling. This document covers the contributor licence agreement,
how to sign it, and what a change has to satisfy before it lands.

It lives under `.github/` rather than the repository root because
[CLAUDE.md](../CLAUDE.md) reserves the root for `README.md`, `CLAUDE.md` and `LICENSING.md`, and
`bin/docs-doctor.mjs` enforces that. GitHub reads `.github/CONTRIBUTING.md` for the "Contributing"
link on issues and pull requests, so the location serves both rules.

## The agreement

Every contributor signs the [Contributor Licence Agreement](CLA.md) once, before their first
change is merged. It is a licence, not an assignment: you keep the copyright in what you write.
It is governed by the law of South Australia, and the grantee is John Hancock trading as Portll,
passing to Portll on incorporation under section 9 without contributors needing to be asked again.

It exists because commitwork is to be offered under two licences: AGPL-3.0-or-later, and PolyForm
Internal Use 1.0.0 by written agreement for those whose policy or product cannot accept the AGPL
([LICENSING.md](../LICENSING.md)). Offering both requires one party to hold the right to license
the whole work under either, and a contribution's copyright stays with its author unless they grant
otherwise. One unagreed contribution ends the arrangement for the whole project.

Section 8 of the CLA is the reciprocal half: everything merged stays under AGPL-3.0-or-later
permanently, a change to a wire-layer file also stays under Apache-2.0, and the open distribution
cannot be withdrawn.

A Developer Certificate of Origin sign-off is **not** sufficient here. The DCO certifies that you
had the right to submit the work; it grants no right to relicense it.

## How to sign

On your first pull request, CLA assistant comments with a link. Follow it, sign in with GitHub,
give your name and email address, and agree; the pull request's `license/cla` check then passes.
Nothing is merged until everyone who committed to the pull request has signed.

Contributing on behalf of an employer, or as a company: an authorised signatory should sign
instead, naming the individuals covered, by email to the contact address below.

Once recorded, it covers everything you send afterwards. If the agreement's text changes, CLA
assistant asks again on your next pull request.

## What else is welcome

- **Bug reports, reproductions and measurements.** These need no agreement and are the most
  useful thing you can send.
- **A check that reports a wrong result is in scope for [the security policy](SECURITY.md).**
  Report it there if it has a security consequence, as an issue otherwise.
- **Design discussion, licence feedback and documentation corrections in an issue.** If a document
  is wrong, saying so in an issue is a contribution; we will make the edit.
- **A larger change: open an issue first**, so the approach is agreed before the code is written.

Contact: **john@portll.net**.

## Running the checks

Zero runtime dependencies, Node >= 22.18 (`engines.node` in package.json), no install step.

```sh
npm test                        # the full suite, through bin/test-run.mjs
node bin/docs-doctor.mjs        # documentation freshness gate
```

Two things to know before you read a failure:

- **The suite has a known pre-existing failure baseline, and it is larger on Windows.** A red test
  is not automatically yours. Establish that the way we do: stash nothing — re-run the same globs
  against an unmodified checkout and compare. `CLAUDE.md` carries the current measured figures and
  the warning that they age quickly.
- **Every input path is overridable through a `CW_*` environment variable** so the suite runs
  entirely on fixtures in `fixtures/`. A test must never need the private records, a credential or
  a network call. If you cannot test your change without one, that is a finding about the change.

## What a change has to satisfy

These are the house invariants, stated in full in [CLAUDE.md](../CLAUDE.md). They are not style
preferences — each one is here because it was violated and the violation cost something.

- **Report actual check outcomes.** A check that could not run records why. Undetermined results
  go in their own field, outside the severity buckets, with the original claim preserved.
- **Fail closed.** A parse failure or a permission error is never an empty result. Only `ENOENT`
  means "legitimately absent".
- **Determinism.** Same inputs, byte-identical outputs. Writes are atomic (tmp+rename); re-runs are
  idempotent.
- **Never key a finding's identity on a line number.** Code moves for reasons that have nothing to
  do with the finding, and a line-keyed identity turns that movement into a state change. Key on
  place — repo, file, rule, package.
- **A guard needs a second witness that cannot share its failure mode.** Asserting an effect rather
  than a marker is necessary and not sufficient. A test that asserts a flag is set does not assert
  that anything obeys it.
- **A commit is closed over its own change set.** Nothing committed may reference something that is
  not. `bin/test/tracked-imports.test.mjs` reads the committed tree, never the working tree, and
  fails on a dangling import.
- **Self-contained artifacts only.** Generated HTML inlines its data, works from `file://`, and
  loads nothing from a CDN.

Comments and prose are terse. No change logs, author tags or refactoring history in files — that is
what the history is for.

## Documentation

Four tiers, gated by `node bin/docs-doctor.mjs` (exit 1 when anything is orange, 2 when the only
problem is an unstamped doc):

1. **Durable** — `README.md`, module `README`s, specs. They describe what *is*, carry a
   `<!-- verified-against: YYYY-MM-DD sha -->` stamp in the first 10 lines, and must be linked from
   the `## Documentation` index in `README.md`. Refresh the stamp when you verify the doc.
2. **Living registers** — content *is* current state, so they are never archived and never
   stamp-gated. Marked `<!-- living-doc -->` in the first 10 lines; the tier is claimed explicitly,
   never inferred from the path.
3. **Cycle artifacts** — audits, plans and remediations. They are not tracked in this repository.
4. **Generated** — never hand-edited; regenerate. Each carries a "Generated by" header. A fix
   applied to a generated artifact dies at the next regeneration, so edit the source.

`admin/index.html` is generated from `admin/panel.html` and `admin/menus/*`. Never edit it; run
`node bin/build-admin-panel.mjs`.

## Deliberately malicious test fixtures

`fixtures/scan-canary/` contains files that are hostile by design, including a pickle that invokes
`system` on load. **Your scanner and your antivirus are expected to fire on them.** Read
[the fixture note in the security policy](SECURITY.md#deliberately-malicious-test-fixtures) before
you report one as a finding, and never execute or load them.

## Security

Do not open a public issue for a vulnerability. [SECURITY.md](SECURITY.md) has the contact and the
response windows.
