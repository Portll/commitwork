<!-- verified-against: 2026-10-13 5e582892 -->
# Installing commitwork on Linux: the installer and the container

Two ways to put commitwork on a Linux machine, and what each one does and does not give you.

## The installer, `bin/install.sh`

```sh
sh bin/install.sh                                     # this checkout's HEAD into ~/.local
sh bin/install.sh --prefix /usr/local --scanners gitleaks,trufflehog,semgrep
sh bin/install.sh --release-only --scanners gitleaks,trufflehog   # refuse anything not release-pinned
sh bin/install.sh --from commitwork-0.5.0.tgz --sha256 <hex from the release>
```

It is POSIX `sh` (checked with `shellcheck -s sh` and run under `dash`) and does five things in
order:

1. **Stages the source.** A git checkout installs its HEAD through `git archive`, so uncommitted
   edits, untracked files and ignored stores are never copied; it says so when the tree is dirty.
   A directory without `.git` is copied as it stands. A release tarball (`npm pack` layout) needs
   `--sha256`, and a mismatch is refused before anything is unpacked. The script downloads
   nothing: fetch the tarball yourself and check it with `gh attestation verify`.
2. **Checks Node.js** against the floor the staged `package.json` declares, through
   `lib/node-floor.mjs`. Below the floor it exits 20 and installs nothing.
3. **Replaces the install directory** (`<prefix>/lib/commitwork`, or `--dest`) by rename. It
   replaces only a directory that is empty or carries the `.commitwork-install` marker it writes, so
   `--dest /usr` cannot delete anything. Beside the marker it writes `.commitwork-files`, the list
   of every path it installed. On a replace every path in the old tree that the list does not name
   is the operator's: `monitor/private`, `reports/`, `.claude/` and anything else written there
   since. Those under `monitor/private`, `reports` and `.claude/store` are copied into the state
   root (next section) when the new tree reads them from there. Every other one is copied into the
   new tree, with its modes and symlinks. Each copy is read back before anything moves. If the new
   tree also ships one of those paths, or the state root holds a different copy, the install is
   refused with exit 21, the path is named, and nothing changes. The old tree is then
   kept whole at `<dest>.previous`. That is one generation: the next upgrade replaces it, and only
   after its own carry-over has succeeded. An install made before the list existed carries
   `monitor/private`, `reports`, `.claude` and `evaluations`. It refuses if the old tree holds
   anything else the new one does not ship. `--keep-previous-only` copies nothing anywhere and
   leaves the old tree at `<dest>.previous` for you to copy from. The next upgrade then refuses to replace it
   until you move or delete it. If a step fails or is interrupted, the moves already made are undone,
   so `<dest>` is the tree it was before the run.
4. **Writes the launcher** `<prefix>/bin/commitwork`, and refuses to overwrite a file there that it
   did not write.
5. **Runs `commitwork setup --yes --only <names>`** when `--scanners` is given. A named scanner that
   fails, or is still missing afterwards, is exit 22. `--scanners all` lists the catalogue tools
   with no installer on this platform and does not fail on them. With `--release-only`, a named
   scanner that setup's own plan on this machine would not take from a release asset pinned by
   SHA-256 is refused with exit 2 before anything is installed, and `all` is refused.

Re-running with the same source leaves a byte-identical tree, marker and launcher, and the
operator's files carried across (`bin/test/install-sh.test.mjs`, which also fails each rename in
turn and checks that the old tree is still in place). Exit codes: 0 installed, 2 usage, 20 Node,
21 source or destination refused, a carried path the new tree or the state root already holds
differently, or a failed step, undone; 22 scanners. On Linux without Homebrew, `setup` installs gitleaks and
trufflehog from release tarballs pinned by SHA-256 in `manifests/install-catalog.json`, the
Python scanners through pipx at whatever version PyPI serves that day, and the language managers
through apt or dnf when it can run them as root. Only the first of those is pinned, which is why the
container installs its Python scanners from a hash lock instead and passes `--release-only`.

### Where an installed tree keeps its operator data

The install directory is replaceable, so a tree the installer wrote keeps no operator data inside
it. `monitor/store-paths.mjs` resolves a state root, and the registry, the private records, the
reports and `.claude/store` live under it at the paths they have in a development checkout:
`<state root>/monitor/private/projects.json`, `<state root>/reports/…`,
`<state root>/.claude/store/…`. One rule picks the root:

1. `CW_STATE_DIR`, read at call time, for the tree the code runs from.
2. A tree holding `.commitwork-install`: `~/.commitwork/state`. When `XDG_DATA_HOME` is an absolute
   path and `~/.commitwork/state` does not exist, `$XDG_DATA_HOME/commitwork` instead. The test is
   on `~/.commitwork/state`, not `~/.commitwork`, because `commitwork init` creates `~/.commitwork`
   for the credential stores. If both exist, every command refuses and names `CW_STATE_DIR`. A
   scheduled job resolves the same root only if it carries the same `XDG_DATA_HOME` or
   `CW_STATE_DIR`.
3. Otherwise a development checkout keeps everything inside itself, `monitor/private` included,
   wherever that link points.

The credential stores stay at `~/.commitwork/users.json` and `~/.commitwork/integrations.json`.
`commitwork init` on an installed tree creates `<state root>/monitor/private` (mode 0700) and the
registry there, prints the root on its first line, and lists anything left inside the tree as not
read.

An upgrade from an install that kept its data inside the tree moves it in this order. The
installer does it, not the first run of the new version, because only the installer still holds
the old tree at `<dest>` and can refuse before anything changes. A first run would find the old
tree at `<dest>.previous`, which the next upgrade deletes.

1. Stage the new tree, write its marker and file list, and ask the staged
   `monitor/store-paths.mjs` for its state root, under the installer's own environment. A tree
   without that module is an older layout, and every operator path is carried into it as before.
2. Find the old tree's operator paths: every path its file list does not name, or, for an install
   from before the list, `monitor/private`, `reports`, `.claude` and `evaluations`.
3. Plan every path under `monitor/private`, `reports` and `.claude/store` against
   `<state root>/<same path>`, writing nothing. If the path is absent there, it is copied. If both
   sides are directories, they are merged path by path. A file or link identical to the one in the
   state root is left as it is. Anything else there is a conflict. A symlink keeps its target when
   that resolves inside its own store. One that resolves outside the old tree is written as the
   absolute path it named, and one into the rest of the old tree is a conflict. A state root that
   overlaps `<dest>`, `<dest>.previous` or the staging directory is a conflict too.
4. On any conflict, exit 21 naming each path. Nothing is written to the tree, the state root or the
   launcher.
5. Copy the other operator paths into the staged tree and read each back. Then copy the planned
   paths into the state root. A file goes to a temporary name and is linked into place, which
   fails rather than replace anything that appeared since the plan. Directories are created 0700
   and given the old mode. Each copy is read back: type, mode, SHA-256 and directory listing.
6. Move `<dest>` to `<dest>.previous`, still holding its own copies, and the new tree to `<dest>`.
   If a move fails, the moves are undone and the copies in the state root are kept. A re-run finds
   them identical and copies nothing again.
7. The next upgrade replaces `<dest>.previous`. By then the state root holds the data and the new
   tree holds none.

Checked with `bin/install.sh` under `sh` and `dash`, upgrading an install without the resolver to
one with it: the registry hashed identically in the old tree, in
`~/.commitwork/state/monitor/private/projects.json` and in `<dest>.previous`, and the new tree held
no `monitor/private`. A different `projects.json` already in the state root refused the
upgrade by name, and the tree, the state root and the launcher were left unchanged.

Going back to a version without the resolver reads the tree again, so copy what you need from the
state root into `<dest>` by hand after such a downgrade.

## The container, `container/Dockerfile`

Debian 12 with Node 22.23.3, git, bubblewrap 0.8, passt (pasta), seven scanners, and commitwork in
`/opt/commitwork`, installed by `bin/install.sh` from a bind mount so the build context never becomes
an image layer. It runs as uid 1000 (the base image's `node` user), and the entrypoint is the CLI.
The image measured 1.27 GB on arm64.

### What the build fetches, and how each is pinned

| What | Pinned by |
|---|---|
| Base image `node:22.23.3-bookworm-slim` | Index digest `sha256:c3de60bf…`. On 2026-10-08 `docker buildx imagetools inspect` of the tag returned that digest |
| Debian packages: ca-certificates, git, bubblewrap, passt, python3, python3-venv, and what they pull in | `container/debian.sources`: Debian's dated snapshot, the one the base image was built from (it names 20261005T000000Z, which snapshot.debian.org serves as `debian/20261004T203145Z` and `debian-security/20261004T220601Z`). The archive key still verifies every index; `Check-Valid-Until: no` applies to these two sources only. Each package named also carries an exact `=version` |
| semgrep 1.180.0, bandit 1.9.4, flawfinder 2.0.20, ruff 0.17.0, zizmor 1.30.1 and their dependencies | `container/requirements.txt`: 72 packages, each `==version` with the SHA-256 of every file PyPI has for it, installed into `/opt/scanners` with `pip --require-hashes --no-deps --only-binary=:all:`. pip is Debian's, from the snapshot. Nothing is built from source, so no build backend is fetched |
| gitleaks 8.30.1, trufflehog 3.99.2 | Release assets pinned by tag and per-architecture SHA-256 in `manifests/install-catalog.json`. `setup` refuses a download whose hash differs, and `install.sh --release-only` refuses any `SCANNERS` name setup would install another way |
| npm packages | None. commitwork has no dependencies and the build runs no npm install |

`bin/test/container-dockerfile.test.mjs` fails when any of this loosens: a base without a digest, an
apt source that is not a dated snapshot, a package without `=version`, a pip install without the
three flags, a lock line without a hash, a Python scanner missing from the lock or not linked onto
PATH, a `SCANNERS` name the catalogue does not pin to a release for both Linux architectures, or an
installer that resolves a version at build time (pipx, npm, npx, go, cargo, gem, composer, uv, curl,
wget). `bin/test/no-unpinned-fetch.test.mjs` reads the Dockerfile and `bin/install.sh` for npx and
pipe-to-shell fetches.

`SCANNERS` takes release-pinned tools or `none`. `SCANNERS=all` is gone: it installed the language
managers from apt and then ran `go install …@latest`, `cargo install`, `gem install`, `composer
require` and `npm install -g`, each of which resolves its version when it runs. Those scanners are
not in the image.

Moving a pin is a reviewed change. For Debian, change both snapshot timestamps and every
`=version` together; `apt-cache policy <package>` under the new sources prints the versions. For
Python, edit `container/requirements.in` and regenerate the lock, which carries this command in its
header, under the pinned base image:

```sh
docker run --rm -v "$PWD:/src" -w /src node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 sh -c '
  cp container/debian.sources /etc/apt/sources.list.d/debian.sources && apt-get update &&
  apt-get install -y --no-install-recommends ca-certificates python3-venv &&
  python3 -m venv /tmp/v && /tmp/v/bin/pip install pip-tools &&
  /tmp/v/bin/pip-compile --generate-hashes --allow-unsafe --strip-extras --annotation-style=line \
    -o container/requirements.txt container/requirements.in'
```

pip-tools is the one unpinned tool in that command; it writes the lock, and the lock is what gets
reviewed. pip-compile keeps the versions already in the lock unless given `--upgrade`.

### Building and running

```sh
git archive --format=tar HEAD | docker build -f container/Dockerfile -t commitwork:local -
docker run --rm --init \
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined --device /dev/net/tun \
  -v "$PWD:/repo:ro" -v "$HOME/scans:/out" \
  commitwork:local scan --root /repo --out /out
```

Building from `git archive` reads only tracked files. A working-tree context was not measured. With
one, `bin/install.sh` sees `.git` and installs that checkout's HEAD, and in a linked worktree,
whose `.git` points outside the context, it stops with exit 21. Behind a mandatory HTTP proxy, pass
`--build-arg HTTPS_PROXY=…`: without it the build fails at the first scanner download (exit 22)
rather than producing an image missing scanners.

### Run flags, and what happens without each

| Flag | Why | Without it |
|---|---|---|
| `--security-opt seccomp=unconfined` | Docker's default seccomp profile blocks the unprivileged user namespace bwrap needs | `doctor` shows `✗ host sandbox` (bwrap: No permissions to create new namespace) and **every host lane is refused as `noscan`**, because the image sets `CW_SANDBOX=require` |
| `--security-opt apparmor=unconfined` | Docker's default AppArmor profile denies the mounts bwrap makes | Not measured: the Docker Desktop VM this was built on has no AppArmor. Expected to refuse every host lane as above |
| `--device /dev/net/tun` | pasta gives a lane with network egress its own namespace through a tap device | Every lane with network egress is refused as `noscan` (pasta: Failed to open tun socket in namespace). Lanes with egress `none` still run |
| `--init` | reaps scanner subprocesses; node as PID 1 does not | not measured |
| no `--user 0`, no `--cap-add SYS_ADMIN` in their place | the image runs as uid 1000, so bwrap makes its own user namespace | run as root with `--cap-add SYS_ADMIN` and without `NET_ADMIN`, the probe fails at `loopback: Failed RTM_NEWADDR: No child processes` and every host lane is refused (docs/TRAPS.md) |
| `-v …:/repo:ro` | the tree to scan, read-only. `/repo` is the one path the image's git config trusts under another owner | a root holding many repositories needs `--user "$(id -u):$(id -g)"` so git trusts each of them |
| `-v …:/out` | reports. On a Linux host the directory must be writable by uid 1000, or pass `--user` | the scan writes into the container and the reports are lost with it |

`CW_SANDBOX=require` is the point of the table: in this image a lane the sandbox cannot confine
never runs, and its row says why. Unset, a lane that executes repository code is still refused,
and a lane that only analyses runs unconfined and records `isolation: none` (THREAT-MODEL R5). The image never sets `--trust-repo-manifest` or
`COMMITWORK_TRUST_REPO_MANIFEST`.

### Build and scan results, as of 2026-10-08

**The pinned image**, built from the files described above on Docker Desktop 29.6.2 for arm64
(LinuxKit 6.12), with Docker Desktop's proxy passed as `--build-arg`: every pin resolved. apt took
89 s from the snapshot, pip installed all 72 locked packages from wheels, and setup downloaded both
release assets and accepted their hashes. `sh container/smoke.sh <image>` runs it with all three
flags: doctor found the host sandbox, and one scan of a synthetic repository (a Python project, a C
file and a GitHub workflow) ran 18 lanes, 13 with no network and 5 behind pasta, none unconfined;
64 rows were refused or did not apply.
The same build for `--platform linux/amd64`, under Docker Desktop's emulation, also resolved every
pin (1.25 GB). There the 13 no-network lanes ran under bwrap and the 5 with network egress were
refused as `noscan`, because pasta could not open a netlink socket under emulation; none ran
unconfined.

**Each flag combination**, on an unpinned build from `git archive` (the pinned image above was run
only with all three flags), on Docker Desktop 29.6.2 for arm64 (LinuxKit 6.12), scanning a
synthetic repository that holds a Python project, a C file and a GitHub workflow. In all three runs
no lane ran unconfined.

- **Default flags:** all 20 host lanes that matched the tree were `noscan` with the
  `CW_SANDBOX=require` reason.
- **seccomp and AppArmor relaxed, no tun device:** the 15 lanes with no network ran under bwrap;
  the 5 with network egress were refused with pasta's reason.
- **All three flags:** all 20 ran under bwrap, 15 with no network and 5 behind pasta. 18 produced a
  result: gitleaks, trufflehog, semgrep (5 findings), bandit, ruff, flawfinder (2 findings) and
  zizmor among them. `a11y-wcag` and `agent-instructions` were `noscan` because the tree has
  nothing for them, which is not a pass.
- The 19 other matching lanes were `noscan` in every run: 15 because their tool is not in the
  image (two of them need docker, and the image has no daemon and mounts none) and 4 runtime lanes
  because no `--url` was given.
- The build needed Docker Desktop's proxy passed as `--build-arg`; without it, the same build
  failed at the first scanner download with exit 22.

### Limits

- **Not measured:** amd64 on amd64 hardware, a Linux host's own Docker (with AppArmor and, on
  Ubuntu 23.10 and later, `kernel.apparmor_restrict_unprivileged_userns`), rootless Docker, and
  Podman.
- **Same versions, not the same bytes:** a rebuild resolves the same packages and hashes, but its
  layers differ (file times, compiled `.pyc`), and no two builds were compared. A snapshot or a PyPI
  file that disappears fails the build rather than substituting another version.
- **The sandbox is the Linux one,** with its stated weakness: `/` is bound read-only, so a lane can
  read everything in the container that is not masked (THREAT-MODEL R4). In the container that is
  the image and the mounted tree, not a home directory full of other work.
- **Lane caches are not kept:** each `docker run` starts with an empty home, so scanners fetch
  rules and databases on every run.
- **Built in CI only when its inputs change.** `.github/workflows/container.yml` builds the image on
  a pull request or a push to main that touches `container/**`, `bin/lib/sandbox*.mjs`,
  `bin/setup.mjs`, `bin/install.sh` or `manifests/install-catalog.json`, then runs
  `container/smoke.sh` against it. Doctor must find the host sandbox, the scan must run at least 10
  lanes, and `container/assert-confined.mjs` fails on any lane that ran with `isolation: none` or
  none recorded. A lane refused as `noscan` is not a failure. The job lifts the runner's
  `kernel.apparmor_restrict_unprivileged_userns` first, as the `linux-sandbox` job does, builds with
  the runner's Docker, pushes nothing and logs in to no registry. It has no run yet: nothing has
  been pushed since it was added. A change elsewhere still changes the commitwork inside the image,
  and no CI job builds the image for it.
