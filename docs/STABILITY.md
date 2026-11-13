<!-- verified-against: 2026-10-08 -->
# Stability policy

**This is a policy.** It states what commitwork treats as a public interface and when that
interface may change. It is not a description of how the code behaves today; for that, read the
generated [EXIT-CODES.md](EXIT-CODES.md) and the schemas under `schema/`.

## Versions and releases

`package.json` carries a semver version. The patch number is bumped by every commit, so a patch
version is a build identifier, not a release. A release is a commit that sets the minor or major
version by hand and is tagged `v<version>` ([RELEASING.md](RELEASING.md)).

## Public interfaces

These are covered by this policy:

1. **CLI commands and flags**: the `commitwork` subcommands and their documented flags, and every
   `bin/`, `monitor/` and `cra/` entry point whose header documents a usage line.
2. **Exit codes**: what each command's header declares, tabulated in
   [EXIT-CODES.md](EXIT-CODES.md). A command listed there as `undeclared` or `prose` has no stable
   exit codes beyond 0 for success and non-zero for anything else.
3. **`CW_*` environment variables**: their names and what they override.
4. **File formats and schemas**: the JSON Schemas in `schema/`, the reports and artifacts they
   describe, and SARIF, CycloneDX, SPDX, CSAF and OpenVEX output (whose shape is the upstream standard's).
5. **MCP tool schemas**: the tool names, input schemas and result shapes `mcp/server.mjs` serves.
6. **Finding identity**: the fields that decide whether a finding is the same finding as in an
   earlier run. Identity never includes a line number. Changing the identity fields changes which
   findings are reported as new, fixed or suppressed, so it is treated like a schema change.

Not covered: anything under `lib/` or `bin/lib/` imported as a module, the admin panel's HTTP
routes and markup, the `reports/` layout beyond the schemas above, human-readable output text, and
anything a document marks as experimental.

## What may change, and when

| Change | Before 1.0 | From 1.0 |
|---|---|---|
| Add a command, flag, env var, exit code, optional schema field or MCP tool | any release | minor |
| Fix a declaration so it matches what the code already does | any release | patch or minor |
| Remove or rename a command, flag, env var, schema field or MCP tool | minor, after deprecation | major |
| Change the meaning of an existing exit code, or renumber one | minor, after deprecation | major |
| Make an optional schema field or MCP input required | minor, after deprecation | major |
| Change finding identity fields | minor, with a migration | major, with a migration |

Before 1.0 a minor release may still break an interface, but only through the deprecation process
below, and the release notes name every break. An exit code that moves to a new number counts as
a removal of the old one.

## Format versions

[`manifests/formats.json`](../manifests/formats.json) lists each public file format with the
version its writer stamps and its schema. `bin/test/format-freeze.test.mjs` checks every listed
format against the code:

- A **frozen** format's writer must stamp the declared version, and its schema must require that
  version and accept no other. The schema's shape is pinned by a sha256 fingerprint in the format's
  `history`. Annotations such as `description` are not part of the fingerprint, so a deprecation
  notice does not change it.
- Changing a frozen schema's shape fails the test until a history line records the change. That
  line is the changelog entry, and the release notes repeat it. An `additive` change keeps the
  version. A `breaking` change must also change the version the writer stamps.
- Before 1.0 a breaking format change may ship in a minor release, after deprecation, with its
  history line. From 1.0 the test refuses a breaking line unless its release has a higher major
  version than the line before it.
- Formats listed as `unschematized`, `unversioned` or `external` are not frozen yet. Each entry
  states what is missing. A versioned format id that appears in the source but not in the manifest
  fails the test. The MCP tool list has no version a client can read, but its tool names and input
  schemas are pinned by fingerprint.

Finding identities are pinned separately, by `bin/test/finding-identity-pin.test.mjs`: fixed
synthetic findings must produce fixed issue-store keys, verdict-journal keys, SARIF
`partialFingerprints` and SARIF-import identities.

## Deprecation

1. Mark the interface deprecated where it is declared: the header comment, the usage text, the
   schema `description`, or the MCP tool description. State the replacement and the earliest
   release that may remove it.
2. Where the interface is used at run time, warn on stderr. Do not change stdout or the exit code
   to carry the warning.
3. Keep the deprecated interface working for at least one minor release before 1.0, and until the
   next major release from 1.0.
4. Remove it in the release the notice named, and list the removal in that release's notes.

A finding-identity change also ships a migration that re-keys stored records, so suppressions and
issue state carry over rather than reopening.

## Exit codes and Node

Node exits 1 on an uncaught exception and uses codes up to 13 for its own failures. A command
whose verdict codes sit in that range cannot tell a verdict from a crash by exit code alone; most
commands declared today are in that position, and a few declare verdict codes of 20 or above for
that reason. [EXIT-CODES.md](EXIT-CODES.md) states both counts. This is not a repository-wide
convention, and existing codes are not renumbered to adopt it, because renumbering is itself a
breaking change under the table above.
