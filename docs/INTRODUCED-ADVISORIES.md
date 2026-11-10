<!-- verified-against: 2026-10-29 7b626a22 -->
# The introduced-advisories verdict

commitwork's one answer to "does this dependency update introduce a vulnerability". It compares the
resolved dependency graph before an update with the graph after it, and lists the advisories the
second carries that the first did not. commitwork issues the verdict. Consumers record it and act on
its `state`; they do not re-derive it.

It replaces three rules that disagreed: the CI audit gate's dev-dependency carve-out, the local
merge's count of shipped critical and high advisories (a swap passed it), and the OSV veto in spine,
which looked only at the packages a pull request names.

| Piece | File |
|---|---|
| The verdict, pure | `bin/lib/introduced-verdict.mjs` |
| The npm graph reader (`package-lock.json` v2 and v3) | `bin/lib/npm-graph.mjs` |
| The OSV advisory lookup | `bin/lib/osv-advisories.mjs` |
| The `npm audit` lookup the local merge uses | `bin/lib/npm-audit-findings.mjs` |
| Inputs, the run and the text rendering | `bin/lib/introduced-run.mjs` |
| The command | `bin/deps.mjs` (`commitwork deps --introduced`) |

## Obtaining it

```sh
commitwork deps [dir] --introduced <base>..<head> [--json] [--exclude-dev]
commitwork deps --introduced --before <lockfile> --after <lockfile> [--json] [--exclude-dev]
```

The ref form reads `<ref>:<path>/package-lock.json` from the repository holding `dir`. The file form
takes two lockfiles a caller has fetched itself, for example from the GitHub contents API at a pull
request's base and head commits. Advisories come from OSV (`CW_OSV_URL`, default
`https://api.osv.dev`). Only package names, versions and advisory ids are sent.

| Exit | State |
|---|---|
| 0 | `clear` |
| 21 | `introduces` |
| 22 | `unmeasured` |
| 2 | usage error; no verdict was issued |

A consumer reads the JSON (`--json`) and checks the exit code against `state`. Any exit other than
0, 21 or 22, output that is not JSON, or a `schema` or `version` it does not know means no verdict.
No verdict holds a merge in the same way `unmeasured` does.

## Shape, version 1

```json
{
  "schema": "commitwork.introduced-advisories",
  "version": 1,
  "check": { "kind": "security", "id": "dependency-audit" },
  "state": "clear | introduces | unmeasured",
  "reasons": ["…"],
  "generatedAt": "2026-10-29T00:00:00.000Z",
  "ecosystem": "npm",
  "subject": { "repo": "/path | null", "path": ". | null", "before": { "ref": "…" }, "after": { "ref": "…" } },
  "source": { "graph": "package-lock.json", "advisories": "osv | npm-audit | injected" },
  "scope": { "includeDev": true, "blocking": ["critical", "high", "unknown"] },
  "counts": { "introduced": 1, "blocking": 1, "resolved": 0, "persisting": 0, "unmeasured": 0, "looked": 2 },
  "introduced": [{
    "advisory": "GHSA-…", "aliases": ["CVE-…"], "package": "child-y", "versions": ["1.2.0"],
    "severity": "high", "severitySource": "label", "why": "new-advisory", "blocking": true, "exposure": "prod",
    "paths": [["widget-x@1.1.0", "child-y@1.2.0"]], "summary": "…", "url": "https://osv.dev/vulnerability/GHSA-…"
  }],
  "resolved": [{ "advisory": "…", "package": "…", "versions": ["…"], "severity": "…" }],
  "unmeasured": [{ "side": "before | after", "package": "child-y", "version": "1.2.0", "reason": "OSV answered 503" }]
}
```

- `check` is the vocabulary of spine's `jury/commit-checks.mjs`: a security verdict, inventory id
  `dependency-audit`.
- `state`:
  - `introduces`: at least one introduced advisory is at a `blocking` severity.
  - `unmeasured`: no blocking introduction was found, and something that could change the answer was
    not measured. It is never a pass.
  - `clear`: every version that could change the answer was measured, and none introduces a blocking
    advisory.
- `reasons` explains an `unmeasured` state in sentences, such as a graph that could not be resolved or
  a count of versions not measured.
- `introduced` and `resolved` hold one entry per (advisory id, package name):
  - `versions` are the versions that carry the advisory.
  - `exposure` is `prod` if any carrying version ships in a production install, else `dev`.
  - `paths` holds up to three shortest dependency chains from the project root in the after graph.
  - `why` (introduced only) is `new-advisory`, `new-copy` or `now-ships`, as the rules below define.
  - A non-blocking introduction is listed with `blocking: false`.
- `persisting` counts advisories present on both sides.
- `looked` counts the (package, version) pairs whose advisories were looked up.
- `unmeasured` lists each pair or lockfile location that was not measured, with its reason.
- Every list is sorted, so the same inputs give byte-identical JSON. `generatedAt` honours `CW_NOW`.

## The rules

**A record is (advisory id, package name), and the versions carrying it.** An advisory on a
package is introduced when one of these holds:
- `new-advisory`: no version of the package carried it before the update.
- `new-copy`: the update adds a version that carries it and keeps every version that carried it
  before. That is a new copy at a new place, not a move.
- `now-ships`: it was only on dev-only versions before, and a version that ships carries it after.

Otherwise it persists. A move, where the old version is gone and the new version is still affected,
persists. A partial fix is therefore not refused for the advisory it did not fix. Keying on place
rather than version follows the house invariant that keys findings on place, not on line.

**Set difference over the resolved graphs, not the named packages.** Every (package, version) pair in
the lockfile is a node, at every nesting depth. A package whose in-scope versions are identical on
both sides carries the same advisories on both, so only packages whose versions differ are looked up.
A version that moves between the registry and a git or file source, or between dev-only and
shipped, also counts as changed.

**devDependencies are included by default.** The 2026-10-21 operator ruling has no carve-out. With
`includeDev` off, only packages that ship are in scope. A dev package that starts to ship then counts
as introduced.

**Severity** is `critical | high | moderate | low | unknown`.
- OSV records are graded by `gradeOf` in `bin/vendor-scan.mjs`. It reads the CVSS vector and
  GitHub's label, and takes the higher when they disagree.
- `npm audit` severities map directly, and `info` becomes `low`.
- `unknown` is an advisory with no rating (`severitySource: "unrated"`) or one whose record could
  not be read (`"unread"`). It is in the default blocking set.

**What is unmeasured, never "no advisories":**
- a lockfile that cannot be read, is not JSON, or is lockfileVersion 1;
- no lockfile after the update (a lockfile absent before the update is an empty graph);
- a lockfile location that states no version;
- a pair from a git or file source;
- a lookup that fails, throws, answers out of shape, pages, or answers nothing for a pair;
- an advisory after the update on a package whose versions before the update were not measured.

If a blocking introduction is found while other pairs are unmeasured, the state is `introduces` and
the `unmeasured` list stays populated.

## Settings

Operator settings live in the panel's Settings view and the `monitor/settings.mjs` registry. A
repository's `.github/dependency-updates.json` cannot change them.

| Setting | Env | Default | Effect |
|---|---|---|---|
| `depsIntroducedIncludeDev` | `CW_DEPS_INTRODUCED_INCLUDE_DEV` | on | devDependencies are in scope (`--exclude-dev` turns it off for one run) |
| `depsIntroducedSeverities` | `CW_DEPS_INTRODUCED_SEVERITIES` | critical, high, unknown | the `blocking` set |
| `depsAlertFixBypassesCooldown` | `CW_DEPS_ALERT_FIX_BYPASSES_COOLDOWN` | off | whether `deps --update`'s advisories step may take a release younger than the cooldown |

The cooldown is not part of the verdict. Whether an alert-fixing update may skip the 7-day cooldown
is an open operator decision. Its default here is no bypass, and a consumer that merges alert fixes
applies its own copy of that decision. The verdict names no update bot. Renovate, Dependabot and
`commitwork deps --update` are all subjects of it.

## Where it is consumed

- `commitwork deps --update --merge` refuses a merge unless the verdict is `clear`. The verdict
  answers from the two `npm audit` runs the proposal already makes (`source.advisories:
  "npm-audit"`).
- CI, on a pull request, runs `deps . --introduced HEAD^1..HEAD`. The Dependabot merge job needs that
  job.
- spine's dependency merge reads the verdict in place of its own OSV veto, and records it.

## Versioning and other ecosystems

`version` changes only when a field is removed or changes meaning. Added fields do not change it. A
consumer that reads a version it does not know treats the run as no verdict.

The graph shape is ecosystem-neutral. Another ecosystem adds a reader for its lockfile to
`GRAPH_READERS` in `bin/lib/npm-graph.mjs`, and its OSV ecosystem name to `OSV_ECOSYSTEM` in
`bin/lib/osv-advisories.mjs`. The verdict and its shape do not change.
