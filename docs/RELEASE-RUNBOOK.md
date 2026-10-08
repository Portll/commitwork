<!-- verified-against: 2026-10-08 -->
# Release runbook: notes, withdrawal and rollback

This runbook covers what happens around a release: writing its notes, withdrawing (yanking) a
release that should not be used, and moving users back to an earlier one.
[docs/RELEASING.md](RELEASING.md) covers how the release itself is cut and tagged. Roadmap item
*A changelog from each cut* (SPINE `commitwork-roadmap 9.5`).

Every step that changes a published thing is started or approved by a person. The tools below read
history and write files in a checkout. None of them pushes, publishes or holds a credential. The
[release workflow](#release-workflow) publishes a GitHub release, but only from a tag a person pushed
and after a person approves it.

## Who does what

| Act | Done by | With |
|---|---|---|
| Set the minor or major version and land it | the releaser | `bin/commit-phase.mjs` ([RELEASING.md](RELEASING.md)) |
| Mint the annotated tag | the releaser | `bin/release-tag.mjs --tag` |
| Push the tag | the releaser | `git push origin <tag>` |
| Approve publishing the release | a required reviewer of the `release` environment | the run's review prompt ([Release workflow](#release-workflow)) |
| Generate the release notes | anyone, in a checkout | `bin/changelog.mjs` |
| Regenerate and deploy the release feed | the releaser | `bin/releases-atom.mjs`, then a deploy ([RELEASING.md](RELEASING.md)) |
| Withdraw a release | the releaser | by hand; see [Yank](#yank-withdrawing-a-release) |
| Ship the fix that replaces a withdrawn release | the releaser | an ordinary land, then a new release |

## Release notes

`bin/changelog.mjs` writes the notes for one release from its commit range. The range starts at
the nearest earlier `v*` tag and ends at the commit being released. Commits are grouped by
conventional-commit type, with breaking changes first: a `!` after the type, or a
`BREAKING CHANGE:` / `BREAKING-CHANGE:` footer. Each commit gets one line with its short id, and
lines are sorted within each group. A subject that does not parse is listed under
"Not conventional" rather than left out. Merge commits are counted, not listed.

```sh
# notes for a tagged release, printed only
node bin/changelog.mjs --to v0.3.0 --stdout

# the same section, written into docs/CHANGELOG.md (the section for that tag is replaced in place)
node bin/changelog.mjs --to v0.3.0

# everything since the last release, as an "Unreleased" section
node bin/changelog.mjs

# an explicit range, required while no v* tag exists in the history
node bin/changelog.mjs --from <tag|sha> --to <ref> --stdout
```

Exit 0 means a section was written or printed. Exit 20 means no release tag comes before `--to` and
no `--from` was given, so the range has no start. Exit 21 means git failed, a ref did not resolve,
or `docs/CHANGELOG.md` could not be read or was not written by this tool. Exit 22 is a usage error.
Nothing is written on any non-zero exit.

The section date is the `--to` commit's committer date (UTC), so the same range produces the same
bytes on every run. `CW_NOW` overrides the date. The other inputs are overridable as well:
`CW_REPO_ROOT` (the repository read), `CW_CHANGELOG_OUT` (the file written) and
`CW_RELEASE_TAG_PREFIX` (shared with `release-tag`).

Writing a tagged section removes any `Unreleased` section, since the release now holds those
commits. `Unreleased` is always listed first, and tagged sections follow, newest first. The
preamble at the top of the file belongs to the generator, which rewrites it on every write. To
change the notes, change the commits or the generator. Do not hand-edit the file.

### The publication boundary applies to the notes

[docs/CHANGELOG.md](CHANGELOG.md) describes the history of the repository it is in, and nothing
else. The public repository starts from a new root commit
([the publication boundary](PUBLIC-REPOSITORY-BOUNDARY.md)). Commit ids and subjects from the
private development history therefore never go into that file. In the private repository, use
`--stdout` and do not commit a generated section. The tracked file there is the preamble alone.
`bin/test/changelog.test.mjs` fails if the tracked file cites a commit id that does not exist in
the repository running the test. A section carried over from the private history fails that test
in the public repository. Nothing stops a section of private history being written and committed
inside the private repository itself; that is left to the release-candidate review.

### Where the notes are published

- **docs/CHANGELOG.md:** commit the regenerated file in a separate commit after the tag is pushed.
  That commit gets an ordinary patch version and is not part of the release it describes.
- **GitHub releases:** the [release workflow](#release-workflow) publishes the `--stdout` output
  for the tag as the release notes. No GitHub release has been published for commitwork yet.
- **Release feed:** `bin/releases-atom.mjs` publishes the tag's own message, not the changelog
  section ([RELEASING.md](RELEASING.md)).

## Yank: withdrawing a release

A yanked release is marked as withdrawn. It is not erased. **A published tag is never deleted or
moved.** `bin/release-tag.mjs` refuses to move one. Feed entry ids are keyed on tag and commit, so
users who pinned the tag, and every feed reader, still point at the same commit.

Steps, all done by hand by the releaser:

1. **Decide the replacement.** This is either the previous release (see Rollback) or a fix-forward
   release that is about to be cut. A withdrawal notice that does not name a replacement is not
   finished.
2. **GitHub release:** none is published yet. If one exists for the tag,
   edit it so it is marked withdrawn: put a first line saying it is withdrawn, why, and which
   release to use instead, and mark it pre-release so it is no longer shown as Latest. This can be
   done in the GitHub UI or with `gh release edit <tag> --prerelease --notes-file <file>`.
3. **npm:** not applicable today. `package.json` sets `"private": true` and commitwork has never been
   published to npm. If it is published later, a yank is
   `npm deprecate commitwork@<version> "<reason>; use <replacement>"`. A deprecation stays visible
   to every installer. Never unpublish.
4. **Release feed:** a withdrawn state is not yet available. `bin/releases-atom.mjs` has no
   withdrawn flag, and the entry stays in the feed. The public releases page is hand-maintained
   HTML ([RELEASING.md](RELEASING.md)), and the withdrawal note goes on that page by hand.
5. **docs/CHANGELOG.md:** a withdrawn marker is not yet available, because the generator has no
   withdrawn state and the file is not hand-edited. Record the withdrawal in the fix-forward commit
   (its subject and body). It then appears in the next release's section.

## Release workflow

`.github/workflows/release.yml` runs when a `v*` tag is pushed. It declares the pipeline and holds no
authority of its own: pushing the tag, approving the publish and the repository settings below are
done by a person. Its jobs run in this order, and each one is granted only the permissions it uses.

| Job | What it does | Permissions |
|---|---|---|
| `version` | `bin/release-tag.mjs --json` at the tagged commit. Refuses a tag that is not `v` plus that commit's `package.json` version, a patch version, and a commit that is not on `main` | `contents: read` |
| `ci` | Calls `.github/workflows/ci.yml` (`workflow_call`): every job and matrix entry a push runs. `ci.yml` skips tag pushes itself, so a tag is tested once | `contents: read` |
| `build` | Refuses a `package.json` with runtime dependencies, runs `npm pack --ignore-scripts` twice and requires identical bytes, then writes a CycloneDX SBOM of the tarball with `anchore/sbom-action` | `contents: read` |
| `attest` | Build provenance (`actions/attest-build-provenance`) and an SBOM attestation (`actions/attest` with `sbom-path`) over the tarball | `id-token: write`, `attestations: write` |
| `publish` | Waits for approval on the `release` environment, checks the tarball against its attestation with `gh attestation verify`, then runs `gh release create --verify-tag` with the tarball, the SBOM and the notes | `contents: write`, `attestations: read` |

The artefact is the npm package tarball, `commitwork-<version>.tgz`. The `files` list in
`package.json` defines what it contains. `"private": true` blocks `npm publish`, not `npm pack`, and
nothing is published to npm. `--ignore-scripts` keeps the `prepare` git-hook installer out of the
build.

The SBOM comes from the tarball, which carries no lockfile and no `node_modules`. It lists every
component only while commitwork has no runtime dependencies, so the build stops if `package.json`
declares any. `cra/sbom.mjs` is not used here: it merges the per-repository SBOMs from a fleet sweep
using the private product registry, and neither exists on a runner.

The notes are `bin/changelog.mjs --to <tag> --stdout`. Exit 20 means no earlier `v*` tag exists,
which is the case for the first release of a history. GitHub's generated notes are used instead,
and the run log says so. Any other non-zero exit stops the release.

To check a published release:

```sh
gh release download v0.9.0 --repo Portll/commitwork
gh attestation verify commitwork-0.9.0.tgz --repo Portll/commitwork
gh attestation verify commitwork-0.9.0.tgz --repo Portll/commitwork --predicate-type https://cyclonedx.org/bom
```

`.github/workflows/scorecard.yml` runs OpenSSF Scorecard on a weekly schedule and on pushes to
`main`, and uploads the result to code scanning as SARIF. Code scanning is not available on this
repository while it is private (see `.github/workflows/codeql.yml`), so scheduled and push runs skip
until the `SCORECARD_ENABLED` variable is set. `workflow_dispatch` always runs it.

### Settings a person applies

None of these can be set from a file in the repository. Until they are applied, a pushed tag is not
protected and the publish is not approval-gated.

| Setting | Where | Value |
|---|---|---|
| Tag ruleset for releases | Settings → Rules → Rulesets → New tag ruleset | Target `refs/tags/v*`. Restrict creations to the releasers (bypass list), restrict updates, restrict deletions, block force pushes. `bin/release-tag.mjs` already refuses to move a tag; this makes the server refuse it too |
| The `release` environment | Settings → Environments → New environment `release` | Required reviewers: the releasers, with self-review prevented. Deployment branches and tags: selected tags, pattern `v*` |
| Workflow token | Settings → Actions → General → Workflow permissions | Default read-only. The publish job requests `contents: write` itself, so an organisation policy that caps tokens at read blocks the release |
| Allowed actions | Settings → Actions → General → Actions permissions | If only selected actions are allowed, add `actions/*`, `anchore/sbom-action`, `ossf/scorecard-action` and `github/codeql-action` |
| `CW_RELEASE_SCOPE` secret | Settings → Secrets and variables → Actions | Already used by CI. The release passes it to the CI it calls; without it the release-name gates skip and say so |
| At publication: Scorecard | Settings → Secrets and variables → Actions → Variables | Set `SCORECARD_ENABLED` to `true`. Then land a commit that sets `publish_results: true` in `scorecard.yml` and grants its job `id-token: write` |

GitHub limits artifact attestations on private repositories by plan: GitHub Free, Pro and Team
provide them only for public repositories. On those plans the `attest` job fails while the
repository is private, and the release stops there with nothing published. Environment protection
rules and rulesets on private repositories also depend on the plan. Check the plan before relying on
them while the repository is private.

## Rollback

Prefer to **fix forward**: land the fix, or a `git revert` of the bad commits, through
`bin/commit-phase.mjs`. Then set a new minor version and cut a new release
([RELEASING.md](RELEASING.md)). A revert is listed under "Reverts" in the next release's notes.
This keeps every published tag pointing where it always has.

Until the fix-forward release exists, point users at the previous release. commitwork runs from a
git checkout, so going back is a checkout of the earlier tag:

```sh
git fetch --tags origin
git switch --detach v0.2.0      # the last release that is not withdrawn
```

Never do any of the following:

| Never | Why |
|---|---|
| `git tag -f <published tag>` or a forced tag push | it changes what a pinned tag and a feed entry point at, and nobody downstream can see that it happened |
| `git push --delete origin <published tag>` | users who pinned it lose it without warning; a later tag with the same name would point at a different commit |
| force-push `main` to remove the bad commits | every clone and every peer worktree diverges, and the tags still point into the old history |
| `npm unpublish` (if ever published) | it breaks installs that pinned the version; use `npm deprecate` |

## What exists and what does not

| Capability | Status |
|---|---|
| Notes generated from a commit range | `bin/changelog.mjs`, gated by `bin/test/changelog.test.mjs` |
| Tagging a release, refusing to move a tag | `bin/release-tag.mjs` ([RELEASING.md](RELEASING.md)) |
| Release feed from tags | `bin/releases-atom.mjs` ([RELEASING.md](RELEASING.md)) |
| Publishing a GitHub release | `.github/workflows/release.yml`, on a pushed `v*` tag after approval; gated by `bin/test/release-workflow.test.mjs`. Not yet run: see [the settings it needs](#settings-a-person-applies) |
| Attested release files and an SBOM | the same workflow: build provenance and a CycloneDX SBOM attestation over the package tarball |
| OpenSSF Scorecard | `.github/workflows/scorecard.yml`, dispatch-only until the repository is public |
| A withdrawn marker in the changelog or the feed | not yet available |
| npm publication | not applicable: `package.json` is private |
