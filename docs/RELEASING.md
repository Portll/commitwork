<!-- verified-against: 2026-10-07 -->
# Releasing commitwork

A release is a **git tag naming the version `package.json` carries at that commit** — `v` plus the
version, so `v0.2.0`. Nothing derives a version from history: `bin/release-tag.mjs` reads the
manifest out of the commit being tagged and refuses to invent one.

Roadmap item *Releases as tags* (SPINE `commitwork-roadmap 1.6`). 0.2.0 is the last release cut
from the private history.

## Why the counted tags were retired

The first scheme named a release `0.<commit count>` — the tag `0.1108` was minted that way on
2026-08-27 so the feed had an entry. A commit count is not a version: **a rebase renumbers every
tag already shipped**, and the public repository is planned to start from a new root commit
([the publication boundary](PUBLIC-REPOSITORY-BOUNDARY.md)), which renumbers all of them at once.
An entry whose identity moves under history maintenance is worse than no entry.

`0.1108` is **kept and never moved**. It is a real tag over a real commit, and deleting or moving it
would change what a published feed entry points at. It is simply outside the release population:
the feed reads `v*`, so the retired series is excluded rather than erased. The public releases page
(`we/public/releases/index.html` in the private commitwork-web repository) records it as the one interim tag and says why the
scheme ended; `node bin/releases-atom.mjs --pattern '*'` still reads it.

One condition is worth stating plainly rather than discovering: the **committed**
`we/public/releases.atom` was generated under the old all-tags default and still carries
the `0.1108` entry. No `v*` tag exists yet, so the feed has not been regenerated — an empty feed
published ahead of the first release would drop the only entry a subscriber has. The first
regeneration after `v0.2.0` is cut replaces it, and the entry ids are keyed on tag and sha, so
nothing a consumer has stored is renumbered by that swap.

## Cutting a release

Patch versions are bumped on every commit, so they are not releases. **A release is a commit that
sets the minor or major by hand** — edit `"version"` in `package.json`, land it, then tag that
commit.

```sh
# 1. land the version bump (one commit, nothing else in it)
node bin/commit-phase.mjs -m 'chore(release): 0.2.0' -- package.json

# 2. read back what would be tagged -- this writes nothing
node bin/release-tag.mjs --ref origin/main --json

# 3. mint the annotated tag
node bin/release-tag.mjs --ref origin/main --tag
git push origin v0.2.0

# 4. regenerate the feed from the tags; it is written into a commitwork-web checkout
export CW_WEB_ROOT="<your commitwork-web checkout>/we/public"
node bin/releases-atom.mjs                       # rewrites releases.atom under CW_WEB_ROOT
git -C "$CW_WEB_ROOT" commit -m 'Carry v0.2.0 in the release feed' -- releases.atom

# 5. publish the origin (a person's act, never automatic)
npx wrangler pages deploy "$CW_WEB_ROOT" --project-name commitwork-web --branch main
```

Step 2 before step 3 is the whole point: `--json` reports the sha, the version, the tag it would
create, whether that tag already exists, `kind` and `origin`. `kind` is `major`, `minor` or
`patch`, and `--tag` refuses `patch`: commit-phase bumps the patch on every commit, so a patch
version names a commit, not a release. `origin` says whether **this** commit changed the version
from its parent's. Every commit landed through commit-phase reads `set-here`, so `origin` cannot
tell a release from an ordinary commit; `inherited` marks a commit made outside commit-phase, such
as a merge, and `kind` is the field that separates a release from the rest.

## What the two tools refuse

`bin/release-tag.mjs` — exit 0 ok · 1 the tag already exists · 2 no taggable version.

| Refusal | Why |
|---|---|
| An existing tag is never moved | a moved tag changes what a published feed entry points at |
| The version is read with `git show <ref>:package.json` | the author's working tree is not the repository; a dirty manifest cannot name a release |
| A missing, unparseable or versionless manifest is exit 2 | the version is UNKNOWN, never `0.0.0` (fail closed) |
| A non-semver version is exit 2 | `0.1108` passes every other check; its shape is what tells the retired series apart |
| A patch version is exit 2 | every commit carries one, so it names a commit, not a release; a release sets the minor or major by hand |
| `origin` is `set-here` / `inherited` / `unknown` | undetermined is its own value, never folded into one of the other two |

`bin/releases-atom.mjs` — exit 0 wrote a feed (including a feed with no releases) · 2 could not read
the tags.

| Behaviour | Why |
|---|---|
| Reads `v*`, not all of `refs/tags` | the retired counted series is not a release series |
| A git failure is exit 2 and no write | an unreadable ref store is not a repository with no releases |
| An empty feed names the pattern it read | "no releases" must not read as "no tags" |
| Entry id is `urn:portll:commitwork:release:<tag>:<sha>` | identity is tag and sha, never position, so reordering renotifies nobody |
| Written tmp+rename, byte-stable for the same tags | a re-run changes no byte, and an untagged repo is clock-independent |

## Env overrides

Every input is overridable, read at call time, so the tests run entirely on throwaway repositories
and never touch a shared ref store.

| Variable | Default | Tool |
|---|---|---|
| `CW_REPO_ROOT` | the repo this file is in | both |
| `CW_PACKAGE_JSON` | `package.json` (repo-**relative**: it is read out of a commit) | `release-tag` |
| `CW_RELEASE_TAG_PREFIX` | `v` | `release-tag` |
| `CW_RELEASES_PATTERN` | `v*` | `releases-atom` |
| `CW_RELEASES_OUT` | `releases.atom` under `CW_WEB_ROOT` (by default the `we/public` of a commitwork-web checkout beside this one) | `releases-atom` |
| `CW_RELEASES_SELF` | `https://we.commitwork.online/releases.atom` | `releases-atom` |
| `CW_NOW` | the clock | `releases-atom` |

Gates: `bin/test/release-tag.test.mjs` and `bin/test/releases-atom.test.mjs`. Both assert effects
against real throwaway repositories — the tag actually minted, the bytes actually emitted — because
a mocked git agrees with whatever the mock was told.
