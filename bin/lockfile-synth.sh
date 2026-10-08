#!/usr/bin/env bash
# Synthesise a lockfile for a repo that declares dependencies without pinning them, so the CVE lane
# has a resolved version set to match against.
#
# WHY: 19 of the 100randomrepos corpus are preflight-"blind" — a manifest with no lockfile. osv has
# nothing to match, so they report zero CVEs and read exactly like a clean repo. Node accounts for 4.
#
# NEVER WRITES TO THE SOURCE TREE. The manifest is copied into a scratch dir inside the container,
# resolved there, and the lockfile lands in $CW_REPORT_DIR. A scanner that edits the repository it is
# scanning is a defect this fleet has already paid for once.
#
# --ignore-scripts IS THE SAFETY ARGUMENT, not a tidiness flag. `npm install --package-lock-only`
# resolves the tree and writes a lockfile without running lifecycle scripts, but the flag is passed
# explicitly so the guarantee is stated rather than inherited from a default that could change.
# Combined with the container this means: no repo-authored code runs, at all.
#
# usage:  bin/lockfile-synth.sh [srcDir]
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib/docker-config.sh"

SRC="${1:-${CW_LOCKSYNTH_SRC:-$PWD}}"
IMAGE="${CW_LOCKSYNTH_NODE_IMAGE:-node:22-alpine}"
TIMEOUT="${CW_LOCKSYNTH_TIMEOUT:-600}"

OUT="${CW_REPORT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/reports/runtime-latest}"; mkdir -p "$OUT"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
JSON="$OUT/lockfile-synth.json"

json_escape(){ local s=$1; s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\r'/\\r}; s=${s//$'\t'/\\t}; printf '%s' "$s"; }
# Validate on the way out. The shape is DECLARED in schema/lockfile-synth.schema.json, so a renamed
# or misspelled key is refused here rather than reaching a consumer that reads it as absent.
# Fails LOUD: an artifact that cannot be checked must not be published as if it had been.
CW_SELFDIR="$(cd "$(dirname "$0")" && pwd)"
CW_ROOT="${CW_ROOT:-$(cd "$CW_SELFDIR/.." && pwd)}"
emit(){ printf '%s\n' "$1" > "$JSON"
  node "$CW_SELFDIR/validate-artifact.mjs" lockfile-synth "$JSON" || {
    echo "lockfile-synth: refusing to publish an artifact that does not match its schema" >&2; exit 1; }
}
skip(){ emit "{\"tool\":\"lockfile-synth\",\"generatedAt\":\"$TS\",\"ran\":false,\"skipped\":true,\"reason\":\"$(json_escape "$1")\"}"; echo "lockfile-synth skipped: $1"; exit 0; }

[ -d "$SRC" ] || skip "source directory does not exist: $SRC"
SRC_ABS="$(cd "$SRC" && pwd)"

# Already pinned? Then there is nothing to synthesise and saying so is the honest result — NOT a
# silent success that implies work was done.
for lf in package-lock.json npm-shrinkwrap.json yarn.lock pnpm-lock.yaml uv.lock poetry.lock Pipfile.lock; do
  if [ -f "$SRC_ABS/$lf" ]; then
    emit "{\"tool\":\"lockfile-synth\",\"generatedAt\":\"$TS\",\"ran\":true,\"synthesised\":false,\"reason\":\"$lf already present — the tree is pinned and the deps lane can resolve it directly\"}"
    echo "lockfile-synth: $lf already present, nothing to do"; exit 0
  fi
done

ECO=""
[ -f "$SRC_ABS/package.json" ] && ECO="npm"
# python only when there is no package.json to prefer: a polyglot repo needs one lane per ecosystem
# and this one resolves a single manifest per run by design.
if [ -z "$ECO" ] && { [ -f "$SRC_ABS/pyproject.toml" ] || [ -f "$SRC_ABS/requirements.txt" ]; }; then ECO="python"; fi
[ -n "$ECO" ] || skip "no package.json, pyproject.toml or requirements.txt at the source root — nothing for this lane to resolve (a nested manifest is out of scope until the deps lane reads nested lockfiles too)"

command -v docker >/dev/null 2>&1 || skip "docker not installed — this lane REFUSES to resolve on the host: dependency resolution reads an untrusted manifest and contacts a registry chosen by it"
timeout 10 docker info >/dev/null 2>&1 || skip "docker is installed but not running or not responding within 10s — a resolution that cannot be sandboxed does not run at all here"

# ── PYTHON ──────────────────────────────────────────────────────────────────────────────────────
# Two passes, because they answer different questions and the difference is the interesting part.
#
# pip-compile reads a dependency's metadata from its sdist by EXECUTING that package's build
# backend — arbitrary code from a transitive dependency nobody chose. That is the same class as
# `gradle dependencies`, only further down the tree and easier to miss. The container is what makes
# it acceptable at all; --only-binary is what makes it avoidable when it can be.
#
#   pass 1  --pip-args --only-binary=:all:   wheel metadata only. NO build backend runs.
#   pass 2  plain                            permissive. Runs build backends for sdist-only deps.
#
# Pass 2 runs ONLY if pass 1 fails, and when it does the report says buildBackendsExecuted:true.
# A version set obtained by executing third-party build code has different provenance from one read
# out of wheel metadata, and a consumer that cannot tell them apart is being asked to trust both
# equally. (--no-build-isolation is NOT the flag for this: it makes builds LESS isolated.)
if [ "$ECO" = "python" ]; then
  PYIMAGE="${CW_LOCKSYNTH_PY_IMAGE:-python:3.12-slim}"
  WORK="$OUT/lockfile-synth-work"; rm -rf "$WORK"; mkdir -p "$WORK"; chmod 777 "$WORK" 2>/dev/null || true
  SRCFILE=""
  for f in pyproject.toml requirements.txt; do
    [ -f "$SRC_ABS/$f" ] && { cp "$SRC_ABS/$f" "$WORK/$f" 2>/dev/null && SRCFILE="$f"; break; }
  done
  [ -n "$SRCFILE" ] || skip "could not copy a python manifest into the scratch dir"
  # setup.py/setup.cfg are deliberately NOT copied. pip-compile would execute setup.py to read the
  # metadata, and copying it in is the difference between resolving a manifest and running one.
  PIPCACHE="${CW_LOCKSYNTH_PIP_VOL:-cw-locksynth-pip}"
  timeout 30 docker volume inspect "$PIPCACHE" >/dev/null 2>&1 || timeout 30 docker volume create "$PIPCACHE" >/dev/null 2>&1 || true
  # Not sandboxed, deliberately: `alpine chown` over a docker-managed cache volume, with no repo
  # source mounted and nothing from the scanned tree present. Same reasoning as the vdb helpers in
  # bin/depscan-scan.sh — the untrusted input never reaches this container.
  timeout "$TIMEOUT" docker run --rm -v "$PIPCACHE":/pipcache alpine chown -R "$(id -u)":"$(id -g)" /pipcache >/dev/null 2>&1 || true

  # Isolation comes from bin/lib/sandbox.mjs (`resolve`), not from flags written here. The posture
  # is the one that forbids a source mount while allowing egress and handing the artifact back at
  # the host uid — which is exactly the trade this lane makes and previously re-derived by hand.
  PY_SBX="$(node "$CW_ROOT/bin/sandbox.mjs" --posture resolve --name "${CNAME:-cw-locksynth}-py" \
    --mount "$WORK:/work:rw" --mount "$PIPCACHE:/pipcache:rw" \
    --env HOME=/work --env PIP_CACHE_DIR=/pipcache --env PIP_DISABLE_PIP_VERSION_CHECK=1)" \
    || skip "the sandbox refused to emit flags for python resolution; no lockfile is synthesised, which is a void rather than an unresolvable tree"

  pyrun() {
    timeout "$TIMEOUT" docker run $PY_SBX -w /work \
      "$PYIMAGE" sh -c "set -e; export PATH=\"\$HOME/.local/bin:\$PATH\"; pip install --user --quiet pip-tools; pip-compile --quiet --no-header --output-file /work/requirements.lock $1 /work/$SRCFILE"
  }

  EXECUTED=false
  pyrun '--pip-args --only-binary=:all:' > "$OUT/lockfile-synth.log" 2>&1
  rc=$?
  if [ "$rc" -ne 0 ] || [ ! -s "$WORK/requirements.lock" ]; then
    echo "lockfile-synth: wheel-only resolution failed, retrying permissively (build backends WILL execute)" >&2
    rm -f "$WORK/requirements.lock"
    pyrun '' >> "$OUT/lockfile-synth.log" 2>&1
    rc=$?
    EXECUTED=true
  fi
  [ "$rc" -eq 124 ] && skip "python resolution exceeded ${TIMEOUT}s and was killed — a partial pin is a version set nobody resolved"
  if [ ! -s "$WORK/requirements.lock" ]; then
    emit "{\"tool\":\"lockfile-synth\",\"generatedAt\":\"$TS\",\"ran\":true,\"synthesised\":false,\"ecosystem\":\"python\",\"exit\":$rc,\"reason\":\"pip-compile exited $rc and wrote no lockfile — see lockfile-synth.log. The tree stays UNRESOLVED, which is a coverage void and not a clean result\"}"
    echo "lockfile-synth: no python lockfile produced (exit $rc)"; exit 0
  fi
  # requirements.txt is the name osv-scanner's PyPI extractor selects on — see the npm note below.
  SYNTH="$OUT/lockfile-synth"; rm -rf "$SYNTH"; mkdir -p "$SYNTH"
  cp "$WORK/requirements.lock" "$SYNTH/requirements.txt"
  PKGS=$(grep -cE '^[A-Za-z0-9]' "$SYNTH/requirements.txt" 2>/dev/null || echo 0)
  rm -rf "$WORK"
  emit "{\"tool\":\"lockfile-synth\",\"generatedAt\":\"$TS\",\"ran\":true,\"synthesised\":true,\"ecosystem\":\"python\",\"packages\":${PKGS:-0},\"lockfile\":\"lockfile-synth/requirements.txt\",\"sourceUnmodified\":true,\"from\":\"$SRCFILE\",\"buildBackendsExecuted\":$EXECUTED,\"note\":\"resolved by pip-compile in a container. buildBackendsExecuted:false means the whole graph came from WHEEL METADATA and no third-party build code ran; true means at least one sdist-only dependency required executing its build backend to state its own requirements, so these versions carry weaker provenance than a wheel-only resolution. setup.py was deliberately not copied into the scratch dir. Versions are TODAY's resolution of an unpinned range, not what the project ships.\"}"
  echo "lockfile-synth done -> $OUT (python, ${PKGS:-0} packages, buildBackendsExecuted=$EXECUTED)"
  exit 0
fi

WORK="$OUT/lockfile-synth-work"; rm -rf "$WORK"; mkdir -p "$WORK"; chmod 777 "$WORK" 2>/dev/null || true
cp "$SRC_ABS/package.json" "$WORK/package.json" 2>/dev/null || skip "could not copy package.json into the scratch dir"

# Network is unavoidable here — resolution IS a registry conversation — so the source is mounted
# read-only and only the manifest copy is writable. The container cannot modify the repo it read.
NPM_SBX="$(node "$CW_ROOT/bin/sandbox.mjs" --posture resolve --name "${CNAME:-cw-locksynth}-npm" \
  --mount "$WORK:/work:rw" \
  --env HOME=/work --env npm_config_cache=/work/.npm --env npm_config_update_notifier=false)" \
  || skip "the sandbox refused to emit flags for npm resolution; no lockfile is synthesised, which is a void rather than an unresolvable tree"

timeout "$TIMEOUT" docker run $NPM_SBX -w /work \
  "$IMAGE" \
  npm install --package-lock-only --ignore-scripts --no-audit --no-fund \
  > "$OUT/lockfile-synth.log" 2>&1
rc=$?

if [ "$rc" -eq 124 ]; then skip "resolution exceeded ${TIMEOUT}s and was killed — a partial lockfile would pin a version set nobody resolved"; fi
if [ ! -s "$WORK/package-lock.json" ]; then
  emit "{\"tool\":\"lockfile-synth\",\"generatedAt\":\"$TS\",\"ran\":true,\"synthesised\":false,\"exit\":$rc,\"reason\":\"npm exited $rc and wrote no package-lock.json — see lockfile-synth.log. The tree stays UNRESOLVED, which is a coverage void and not a clean result\"}"
  echo "lockfile-synth: no lockfile produced (exit $rc)"; exit 0
fi

# THE FILENAME IS LOAD-BEARING. osv-scanner selects its extractor by FILE NAME, not by content:
# a valid npm lockfile called package-lock.synth.json is rejected with "could not determine extractor
# suitable to this file". So the canonical name is kept and the SYNTHETIC-ness is carried by the
# directory instead — which also keeps it clear of any real lockfile in the report root.
SYNTH="$OUT/lockfile-synth"; rm -rf "$SYNTH"; mkdir -p "$SYNTH"
cp "$WORK/package-lock.json" "$SYNTH/package-lock.json"
PKGS=$(node -e 'const j=require(process.argv[1]);const p=j.packages||{};console.log(Math.max(0,Object.keys(p).length-1))' "$SYNTH/package-lock.json" 2>/dev/null || echo 0)
rm -rf "$WORK"

emit "{\"tool\":\"lockfile-synth\",\"generatedAt\":\"$TS\",\"ran\":true,\"synthesised\":true,\"ecosystem\":\"npm\",\"packages\":${PKGS:-0},\"lockfile\":\"lockfile-synth/package-lock.json\",\"sourceUnmodified\":true,\"scriptsExecuted\":false,\"note\":\"resolved from package.json in a container with --ignore-scripts; the source tree was mounted nowhere and is byte-unchanged. These versions are TODAY's resolution of an unpinned range, not what the project ships — findings against them describe what a fresh install would get, which is the honest question for an unpinned tree.\"}"
echo "lockfile-synth done -> $OUT (npm, ${PKGS:-0} packages)"
