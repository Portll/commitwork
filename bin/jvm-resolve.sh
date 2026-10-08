#!/usr/bin/env bash
# bin/jvm-resolve.sh — resolve a JVM dependency graph without writing anything into the repo.
#
# THE CONSTRAINT THAT SHAPES EVERY LINE BELOW. `gradle dependencies --write-locks` writes
# `gradle.lockfile` next to the build file — the exact path a MAINTAINER's lockfile would occupy.
# If this lane did that, three things follow and all of them are bad:
#
#   * a third-party checkout gets polluted with an artifact its authors never produced;
#   * monitor/observables.mjs reads gradle.lockfile at tier `declared`, so OUR resolution would be
#     indistinguishable from a claim the repository committed — the corpus would silently launder
#     a machine's guess into a maintainer's assertion;
#   * the versions pinned are whatever THIS box resolved at THIS moment through THIS proxy, which
#     is a fact about us, not about the project.
#
# So the repo is mounted READ-ONLY, copied into container-local scratch, resolved there, and only
# the resulting lockfile is copied out — to $CW_REPORT_DIR, where observables reads it at tier
# `derived`. Nothing this lane produces ever lands in a working tree. The read-only mount is not a
# convention here; it is the mechanism, and `build-resolve` refuses a writable source mount.
#
# EGRESS IS BOUNDED, NOT SEVERED. Resolution IS a registry conversation, so it cannot run offline.
# bin/egress-proxy.sh puts a default-deny filtering proxy in front of it and the posture REFUSES to
# emit flags without one. The proxy's deny log is copied out beside the lockfile: it says what the
# repo's build logic tried to reach and could not, which is the most interesting thing this lane
# produces.
#
# usage:  bin/jvm-resolve.sh <repoDir>
#   env:  CW_REPORT_DIR      where the artifact goes (required in a sweep; defaults for a manual run)
#         CW_JVM_IMAGE       JDK image (default eclipse-temurin:17-jdk — already on this box)
#         CW_JVM_TIMEOUT     seconds (default 900; a cold gradle wrapper download is slow)
#         CW_EGRESS_*        see bin/egress-proxy.sh
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib/docker-config.sh"

CW_ROOT="${CW_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SRC="${1:?usage: jvm-resolve.sh <repoDir>}"
SRC_ABS="$(cd "$SRC" && pwd)" || { echo "jvm-resolve: $SRC is not a directory" >&2; exit 2; }
NAME_HINT="$(basename "$SRC_ABS")"
IMAGE="${CW_JVM_IMAGE:-eclipse-temurin:17-jdk}"
TIMEOUT="${CW_JVM_TIMEOUT:-900}"
OUT="${CW_REPORT_DIR:-$CW_ROOT/reports/runtime-latest}"; mkdir -p "$OUT"
CNAME="${CW_CONTAINER_NAME:-cw-jvm-resolve-$$}"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
JSON="$OUT/jvm-resolved.json"

# Every exit path writes the artifact. A lane that resolves nothing and writes nothing is
# indistinguishable from a lane that never ran, and monitor/observables.mjs would read the silence
# as a repo with no JVM dependencies.
emit(){ printf '%s\n' "$1" > "$JSON"; }
esc(){ node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"; }
void(){ emit "{\"tool\":\"jvm-resolve\",\"generatedAt\":\"$TS\",\"ran\":false,\"resolved\":false,\"repo\":$(esc "$NAME_HINT"),\"reason\":$(esc "$1")}"; echo "jvm-resolve: $1" >&2; exit 0; }

command -v docker >/dev/null 2>&1 || void "docker is not on PATH — resolution is container-only by construction, so this is a VOID, not a repo without dependencies"
timeout 10 docker info >/dev/null 2>&1 || void "the docker daemon is unreachable — VOID, not a clean result"

# Which build system, and is there anything to resolve at all?
if   [ -f "$SRC_ABS/gradlew" ] || [ -f "$SRC_ABS/build.gradle" ] || [ -f "$SRC_ABS/build.gradle.kts" ]; then KIND=gradle
elif [ -f "$SRC_ABS/pom.xml" ]; then KIND=maven
else void "no gradle or maven build file at the top level — nothing for this lane to resolve"
fi

# Refuse to duplicate what the maintainer already committed. A repo WITH a lockfile is already read
# at tier `declared`, and resolving it again would produce a weaker copy of a stronger fact.
if [ "$KIND" = gradle ] && [ -f "$SRC_ABS/gradle.lockfile" ]; then
  void "the repository already commits a gradle.lockfile — that is a maintainer's claim and is read at tier declared; re-resolving it here would produce a weaker copy of a stronger fact"
fi

# A COMPOSITE BUILD IS ONLY UNRESOLVABLE IF ITS INCLUDES ESCAPE THE REPO — and the first version of
# this check did not make that distinction, which cost three repos.
#
#   ben-manes_caffeine          includeBuild("gradle/plugins")      INSIDE  — copies fine
#   junit-team_junit-framework  includeBuild("gradle/base")         INSIDE  — copies fine
#   clientA platform-errors    includeBuild("../platform-observability")   ESCAPES — genuinely alone
#
# Refusing on the mere presence of `includeBuild` read as caution and was just wrong: an internal
# composite is the normal way a large gradle project organises its own build logic, and copying the
# whole repo brings it along. Only a path that leaves the directory has nothing to copy.
#
# A DYNAMIC include — apache_calcite's `includeBuild(it)` — cannot be read statically. That one is
# ATTEMPTED rather than refused: the run happens in a sandbox, so the cost of being wrong is a
# wasted container, not a risk, and the "Included build ... does not exist" detection below already
# reports it precisely. Fail-closed governs what this lane CLAIMS, not whether it tries.
COMPOSITE_DYNAMIC=false
for s in settings.gradle settings.gradle.kts; do
  [ -f "$SRC_ABS/$s" ] || continue
  while IFS= read -r line; do
    # The quoted path argument, if there is one.
    arg="$(printf '%s' "$line" | sed -nE 's/.*includeBuild[[:space:]]*\(?[[:space:]]*["'"'"']([^"'"'"']+)["'"'"'].*/\1/p')"
    if [ -z "$arg" ]; then COMPOSITE_DYNAMIC=true; continue; fi
    case "$arg" in
      ../*|/*) void "$s includes the build at '$arg', which is OUTSIDE this directory — copying this repo alone leaves the include dangling. This is one participant in a composite; point the lane at the build root that owns it" ;;
    esac
  done < <(grep -E '^\s*includeBuild' "$SRC_ABS/$s" 2>/dev/null)
done

# ── the distribution must be a LISTED release, and its bytes are pinned ─────────────────────────
#
# github.com is reachable from the resolution container for exactly one reason: services.gradle.org
# 307-redirects distribution downloads to github.com/gradle/gradle-distributions/releases, so no
# gradle wrapper can bootstrap without it. The proxy cannot allow only that path — for HTTPS it
# sees CONNECT host:443 and nothing more — so the host is allowed and the BYTES are pinned instead.
#
# This is where the pin becomes enforcement rather than a note: distributionSha256Sum is injected
# into the SCRATCH COPY's wrapper properties and the Gradle wrapper verifies the zip itself,
# refusing to run on a mismatch. Nothing is written into the repository.
#
# AN UNLISTED VERSION DOES NOT RUN. That is the point, not an inconvenience: unlisted means nobody
# has recorded what bytes to expect, and downloading it anyway through a host we permit only
# because of the pin would be precisely the trust this arrangement removes.
DIST_MANIFEST="${CW_GRADLE_DISTRIBUTIONS:-$CW_ROOT/manifests/gradle-distributions.json}"
WRAPPER_PROPS="$SRC_ABS/gradle/wrapper/gradle-wrapper.properties"
DIST_VERSION=""; DIST_KIND=""; DIST_SHA=""; DIST_PREPINNED=false

if [ "$KIND" = gradle ] && [ -f "$WRAPPER_PROPS" ]; then
  DIST_VERSION="$(sed -nE 's|^distributionUrl=.*gradle-([0-9.]+)-(bin\|all)\.zip.*|\1|p' "$WRAPPER_PROPS" | head -1)"
  DIST_KIND="$(sed -nE 's|^distributionUrl=.*gradle-[0-9.]+-(bin\|all)\.zip.*|\1|p' "$WRAPPER_PROPS" | head -1)"
  # A repo that pins its OWN distribution needs nothing from us, and overriding it would replace a
  # maintainer's pin with ours — the same laundering this lane exists to prevent, one level up.
  grep -q '^distributionSha256Sum=' "$WRAPPER_PROPS" 2>/dev/null && DIST_PREPINNED=true

  if [ "$DIST_PREPINNED" = false ] && [ -n "$DIST_VERSION" ]; then
    [ -f "$DIST_MANIFEST" ] || void "the gradle distribution manifest $DIST_MANIFEST is absent, so no distribution can be pinned — and an unpinned download through github is the trust this lane refuses"
    DIST_SHA="$(node -e '
      const fs = require("node:fs");
      const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const hit = (m.distributions || []).find((d) => d.version === process.argv[2] && d.kind === process.argv[3]);
      process.stdout.write(hit && /^[0-9a-f]{64}$/.test(hit.sha256 || "") ? hit.sha256 : "");
    ' "$DIST_MANIFEST" "$DIST_VERSION" "$DIST_KIND" 2>/dev/null)"
    [ -n "$DIST_SHA" ] || void "gradle-$DIST_VERSION-$DIST_KIND is NOT a listed release — $DIST_MANIFEST records no sha256 for it. Downloading it would mean trusting the github redirect with nothing to check the bytes against. Add it deliberately: fetch https://services.gradle.org/distributions/gradle-$DIST_VERSION-$DIST_KIND.zip.sha256, record it, and say who checked"
  fi
fi

# ── egress ──────────────────────────────────────────────────────────────────────────────────────
PROXY_OUT="$(bash "$CW_ROOT/bin/egress-proxy.sh" up 2>/dev/null)" || void "the egress proxy would not start — resolution without a bounded reachable set is not something this lane will do"
PROXY_URL="$(printf '%s' "$PROXY_OUT" | sed -n '1p')"
PROXY_NET="$(printf '%s' "$PROXY_OUT" | sed -n '2p')"
[ -n "$PROXY_URL" ] && [ -n "$PROXY_NET" ] || void "the egress proxy did not report a URL and a network"

# Where this run's evidence STARTS in the shared append-only access log. Without it the extracted
# log is the file's whole history and every count is cumulative — a stale DENIED from a previous
# allowlist outlived the fix that removed it.
LOG_FROM="$(bash "$CW_ROOT/bin/egress-proxy.sh" offset 2>/dev/null || echo 0)"

# SCRATCH IS OURS AND IS NOT THE REPO. The container runs as the host uid (the posture's `hostUser`,
# so the artifact comes back readable), which means it cannot write to `/` — the first version tried
# `cp -R /src /work` and died with exit 1 before reaching anything, producing an honest VOID and no
# clue. /work is now a real rw mount on a scratch directory this script owns and removes. It is
# deliberately NOT inside the repo and NOT $OUT: the resolver writes gradle.lockfile into its copy
# of the tree, and only the lockfile is lifted out afterwards.
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/cw-jvm-XXXXXX")" || void "could not create a scratch directory"
cleanup(){ [ -n "${CW_JVM_KEEP_SCRATCH:-}" ] || rm -rf "$SCRATCH"; }
trap cleanup EXIT

# Probe the sandbox once here so a refusal is reported as a refusal rather than surfacing later as
# a mysterious non-zero from run_resolve, which builds its own flags per attempt (the image changes
# between attempts and the flags must not be stale).
node "$CW_ROOT/bin/sandbox.mjs" --posture build-resolve --name "$CNAME" \
  --mount-source "$SRC_ABS:/src:ro" --mount "$SCRATCH:/work:rw" --mount "$OUT:/out:rw" \
  --env HOME=/work --env GRADLE_USER_HOME=/work/.gradle \
  --egress-proxy "$PROXY_URL" --egress-network "$PROXY_NET" >/dev/null 2>&1 \
  || void "the sandbox refused to emit flags for build-resolve — running a repo's build logic without the declared isolation is not a fallback this lane has"

# ── resolve ─────────────────────────────────────────────────────────────────────────────────────
# The repo is copied to /work INSIDE the container. --write-locks then writes into the copy, and
# /src stays exactly as it was found. --no-daemon because a daemon outlives the container's command
# and would carry state between repos.
if [ "$KIND" = gradle ]; then
  # `cp -R /src/. /work/` copies the CONTENTS. `cp -R /src /work` would nest it at /work/src, which
  # is the kind of thing that fails one directory later with a message about a missing gradlew.
  # The log is copied out FIRST and unconditionally: a run that produced no lockfile is exactly the
  # run whose log somebody needs, and the first version copied it after a step that could not be
  # reached, so the honest VOID it reported came with no clue attached.
  # ── TWO THINGS THE FIRST VERSION GOT WRONG, BOTH SILENT ──────────────────────────────────────
  #
  # 1. `--write-locks` ONLY writes lockfiles for configurations where locking is ACTIVATED, and
  #    almost no project activates it — that is the whole reason 12 repos have no lockfile. RxJava
  #    resolved cleanly, logged "Persisted dependency lock state for root project", exited 0 and
  #    wrote no file, because there was nothing opted in to persist. An INIT SCRIPT turns locking
  #    on for every project; it is passed on the command line and lives in our scratch, so the
  #    project is not modified — which is the constraint this whole lane exists to honour.
  #
  # 2. Gradle does NOT read http_proxy/HTTPS_PROXY for dependency resolution. It wants JVM system
  #    properties. Those are set explicitly below; without them gradle simply cannot reach anything
  #    now that the network is internal, which is the correct failure but a confusing one.
  PROXY_HOST="$(printf '%s' "$PROXY_URL" | sed -E 's#^https?://##; s#:.*$##')"
  PROXY_PORT="$(printf '%s' "$PROXY_URL" | sed -E 's#^.*:##')"
  cat > "$SCRATCH/.cw-lock.init.gradle" <<'INIT'
// Injected by commitwork's bin/jvm-resolve.sh. Never written into the project: an init script is
// supplied with --init-script and is read from outside the build.
//
// It activates dependency locking so `--write-locks` has something to persist. Projects that have
// already opted in are unaffected — this lane refuses to run against a repo that commits a
// gradle.lockfile at all, so there is no case where this overrides a maintainer's own locking.
allprojects {
    dependencyLocking {
        lockAllConfigurations()
    }
}
INIT

  RESOLVE_CMD='mkdir -p /out/jvm-resolve
    PROXY_D="-Dhttp.proxyHost=PROXY_HOST_SUB -Dhttp.proxyPort=PROXY_PORT_SUB -Dhttps.proxyHost=PROXY_HOST_SUB -Dhttps.proxyPort=PROXY_PORT_SUB"
    # The WRAPPER downloads gradle itself before any build flag exists, on its own JVM. Without
    # these the bootstrap dies with UnknownHostException: services.gradle.org — the internal
    # network doing its job, reported as something that looks like a network outage.
    export JAVA_OPTS="$PROXY_D"
    export GRADLE_OPTS="$PROXY_D"
    cp -R /src/. /work/ 2>/tmp/cp.err || { cp /tmp/cp.err /out/jvm-resolve/resolve.log 2>/dev/null; exit 3; }
    cd /work
    # Pin the distribution IN THE COPY. The wrapper reads this and verifies the zip it downloads,
    # so the github redirect is checked by the thing doing the downloading rather than trusted.
    if [ -n "DIST_SHA_SUB" ] && [ -f gradle/wrapper/gradle-wrapper.properties ]; then
      grep -q "^distributionSha256Sum=" gradle/wrapper/gradle-wrapper.properties \
        || printf "distributionSha256Sum=%s\n" "DIST_SHA_SUB" >> gradle/wrapper/gradle-wrapper.properties
    fi

    # ── PHASE 1: DISCOVERY ────────────────────────────────────────────────────────────────────
    # Resolve with verification OFF and record the sha256 of every artifact gradle actually
    # consumed. `--write-verification-metadata sha256` writes gradle/verification-metadata.xml —
    # into the SCRATCH COPY, at the fixed project path gradle insists on, never into /src.
    # This run is a PROPOSAL. Nothing it produces has been verified against anything.
    ./gradlew --no-daemon --console=plain --stacktrace \
      --init-script /work/.cw-lock.init.gradle \
      -Dorg.gradle.dependency.verification=off \
      --write-verification-metadata sha256 \
      $PROXY_D \
      dependencies --write-locks > /work/discovery.log 2>&1
    rc=$?
    cp /work/discovery.log /out/jvm-resolve/discovery.log 2>/dev/null || true

    # The pin list is the artifact worth keeping even if phase 2 never runs.
    if [ -f /work/gradle/verification-metadata.xml ]; then
      cp /work/gradle/verification-metadata.xml /out/jvm-resolve/verification-metadata.xml
    fi

    find /work -name gradle.lockfile -not -path "*/.gradle/*" -print0 \
      | while IFS= read -r -d "" f; do
          rel=${f#/work/}
          mkdir -p "/out/jvm-resolve/$(dirname "$rel")"
          cp "$f" "/out/jvm-resolve/$rel"
        done

    # ── PHASE 2: ENFORCEMENT ──────────────────────────────────────────────────────────────────
    # Re-resolve with the pin list in place. Gradle enforces verification-metadata.xml
    # automatically once the file exists, so nothing turns it on — the absence of
    # `-Dorg.gradle.dependency.verification=off` IS the switch.
    #
    # --refresh-dependencies is what stops this being tautological. Without it gradle verifies the
    # bytes still sitting in the cache that phase 1 just hashed, which proves the hash function is
    # deterministic and nothing else. With it, every artifact is fetched again and checked against
    # the pin, so a registry serving different bytes between two fetches minutes apart fails here.
    #
    # WHAT THIS DOES AND DOES NOT PROVE, because the difference matters. It is trust-on-first-use:
    # the pin list was written from the same upstream moments earlier, so a same-run mismatch is
    # unlikely and a clean phase 2 is NOT evidence that the artifacts are the ones anybody intended.
    # The value is durable rather than immediate — the pin list is a record a later run, or a human,
    # can hold the registry to.
    verified=skipped
    if [ "$rc" -eq 0 ] && [ -f /work/gradle/verification-metadata.xml ]; then
      ./gradlew --no-daemon --console=plain --stacktrace \
        --init-script /work/.cw-lock.init.gradle \
        --refresh-dependencies \
        $PROXY_D \
        dependencies > /work/enforce.log 2>&1
      if [ $? -eq 0 ]; then verified=pass; else verified=fail; fi
      cp /work/enforce.log /out/jvm-resolve/enforce.log 2>/dev/null || true
    fi
    printf "%s\n" "$verified" > /out/jvm-resolve/.verified
    exit $rc'
else
  RESOLVE_CMD='set -e
    cp -R /src /work
    cd /work
    mkdir -p /out/jvm-resolve
    ./mvnw -B -o=false dependency:list -DoutputFile=/out/jvm-resolve/maven-dependency-list.txt \
      -DappendOutput=false > /work/resolve.log 2>&1 \
      || mvn -B dependency:list -DoutputFile=/out/jvm-resolve/maven-dependency-list.txt > /work/resolve.log 2>&1 || true
    cp /work/resolve.log /out/jvm-resolve/resolve.log 2>/dev/null || true'
fi

# ── run, and retry ONCE on a toolchain mismatch ─────────────────────────────────────────────────
#
# Gradle projects declare the JDK they need and refuse anything else. RxJava wants languageVersion
# 26; the default image here carries 17, and gradle's own toolchain auto-download is deliberately
# left off because enabling it means editing the project's settings, which is exactly the kind of
# modification this lane exists to avoid.
#
# So the first failure is READ rather than guessed at: gradle names the version it wanted, and this
# retries once with a matching image. One retry, not a ladder walk — a second mismatch means
# something other than the JDK, and burning six containers to discover that is not diagnosis.
run_resolve(){
  rm -rf "$OUT/jvm-resolve"
  # The proxy host/port are substituted here rather than interpolated into the heredoc above, so
  # the command stays a single-quoted literal and no shell expansion happens inside it.
  local cmd="${RESOLVE_CMD//PROXY_HOST_SUB/$PROXY_HOST}"
  cmd="${cmd//PROXY_PORT_SUB/$PROXY_PORT}"
  cmd="${cmd//DIST_SHA_SUB/$DIST_SHA}"
  local sbx
  # JAVA_OPTS/GRADLE_OPTS are exported INSIDE the container command, not passed as docker -e flags.
  # `docker run $sbx` word-splits deliberately, so a flag value containing spaces — and a list of
  # -D options is nothing but spaces — is torn into fragments and docker exits 125. Every other lane
  # here happens to pass space-free values, which is why the flag list had never met this.
  sbx="$(node "$CW_ROOT/bin/sandbox.mjs" --posture build-resolve --name "$CNAME" \
    --mount-source "$SRC_ABS:/src:ro" --mount "$SCRATCH:/work:rw" --mount "$OUT:/out:rw" \
    --env HOME=/work --env GRADLE_USER_HOME=/work/.gradle \
    --egress-proxy "$PROXY_URL" --egress-network "$PROXY_NET" 2>/dev/null)" || return 90
  # Clear the copied tree but KEEP the injected init script — it lives in scratch and is the only
  # thing making --write-locks produce anything.
  find "${SCRATCH:?}" -mindepth 1 -maxdepth 1 ! -name '.cw-lock.init.gradle' -exec rm -rf {} + 2>/dev/null || true
  timeout "$TIMEOUT" docker run $sbx "$1" sh -c "$cmd" >/dev/null 2>&1
}

run_resolve "$IMAGE"
rc=$?

NEEDED=""
# The gradle phase writes discovery.log; only the maven phase still writes resolve.log. Reading the
# wrong one silently disabled the whole JDK retry: caffeine asked for languageVersion=26, the string
# was sitting in discovery.log, and this looked at a file that does not exist for a gradle run and
# concluded no toolchain was needed. A path rename that misses one reader is the quietest kind.
RETRY_LOG="$OUT/jvm-resolve/discovery.log"
[ -f "$RETRY_LOG" ] || RETRY_LOG="$OUT/jvm-resolve/resolve.log"
if [ "$rc" -ne 0 ] && [ -f "$RETRY_LOG" ]; then
  NEEDED="$(grep -o 'languageVersion=[0-9]*' "$RETRY_LOG" 2>/dev/null | head -1 | cut -d= -f2)"
fi
if [ -n "$NEEDED" ] && [ "$NEEDED" != "${IMAGE##*:}" ]; then
  RETRY_IMAGE="${CW_JVM_IMAGE_PREFIX:-eclipse-temurin}:${NEEDED}-jdk"
  if docker manifest inspect "$RETRY_IMAGE" >/dev/null 2>&1; then
    echo "jvm-resolve: the project requires JDK $NEEDED; retrying once with $RETRY_IMAGE" >&2
    IMAGE="$RETRY_IMAGE"
    run_resolve "$IMAGE"
    rc=$?
  else
    echo "jvm-resolve: the project requires JDK $NEEDED and no $RETRY_IMAGE image is published — not retrying" >&2
  fi
fi

# The deny log, copied out BEFORE the proxy is torn down. This is the evidence half of the lane.
bash "$CW_ROOT/bin/egress-proxy.sh" log "$OUT/jvm-resolve/egress-access.log" "$LOG_FROM" 2>/dev/null || true
DENIED=0
if [ -f "$OUT/jvm-resolve/egress-access.log" ]; then
  # `grep -c` prints 0 AND exits 1 on no match, so `|| echo 0` appended a SECOND zero and the count
  # reached the JSON as "0\n0". tr -d and a default keep it one integer.
  DENIED="$(grep -c 'DENIED' "$OUT/jvm-resolve/egress-access.log" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$DENIED" ] || DENIED=0
fi

# PERPETUATE THE CHAIN. The per-run log answers "what happened this time" and structurally cannot
# answer "has this changed" — and the second question is the only one a redirect chain is useful
# for. Recorded on EVERY outcome, including failures: a run that got three hosts in before dying
# still establishes that those three hosts are on the path, and skipping the record on failure
# would mean the ledger only ever saw the happy case.
node "$CW_ROOT/monitor/resolution-chain.mjs" record "$NAME_HINT" "$OUT/jvm-resolve/egress-access.log" 2>&1 | sed 's/^/jvm-resolve: /' || true

[ -n "${CW_EGRESS_KEEP:-}" ] || bash "$CW_ROOT/bin/egress-proxy.sh" down >/dev/null 2>&1 || true

# ── report ──────────────────────────────────────────────────────────────────────────────────────
LOCKS=0
[ -d "$OUT/jvm-resolve" ] && LOCKS="$(find "$OUT/jvm-resolve" -name gradle.lockfile 2>/dev/null | wc -l | tr -d ' ')"
MVN=0
[ -f "$OUT/jvm-resolve/maven-dependency-list.txt" ] && MVN=1

# THREE STATES, NEVER TWO. `skipped` is not `pass` — a run whose enforcement pass never happened has
# not been verified, and collapsing the two would let "we did not check" render as "we checked".
VERIFIED=skipped
[ -f "$OUT/jvm-resolve/.verified" ] && VERIFIED="$(tr -d '[:space:]' < "$OUT/jvm-resolve/.verified")"
[ -n "$VERIFIED" ] || VERIFIED=skipped
PINS=0
if [ -f "$OUT/jvm-resolve/verification-metadata.xml" ]; then
  # One <component> per pinned artifact. A pin list with no components is an empty pin list, which
  # is a different thing from no pin list at all.
  PINS="$(grep -c '<component ' "$OUT/jvm-resolve/verification-metadata.xml" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$PINS" ] || PINS=0
fi

# THE TREE MUST BE UNTOUCHED, and this is asserted rather than assumed. A lockfile appearing in the
# source directory means the read-only mount failed or the copy step was skipped, and the corpus
# would go on to read it at tier `declared`.
if [ "$KIND" = gradle ] && [ -f "$SRC_ABS/gradle.lockfile" ]; then
  emit "{\"tool\":\"jvm-resolve\",\"generatedAt\":\"$TS\",\"ran\":true,\"resolved\":false,\"repo\":$(esc "$NAME_HINT"),\"reason\":\"A gradle.lockfile appeared in the SOURCE tree. The read-only mount or the scratch copy failed, and the artifact would be read as a maintainer's committed claim. Refusing to publish this run.\"}"
  echo "jvm-resolve: REFUSED — the source tree was modified" >&2
  exit 1
fi

if [ "$rc" -eq 124 ]; then
  emit "{\"tool\":\"jvm-resolve\",\"generatedAt\":\"$TS\",\"ran\":true,\"resolved\":false,\"repo\":$(esc "$NAME_HINT"),\"kind\":\"$KIND\",\"deniedRequests\":$DENIED,\"reason\":\"resolution exceeded ${TIMEOUT}s and was killed — a partial graph is a version set nobody resolved\"}"
  echo "jvm-resolve: TIMEOUT after ${TIMEOUT}s" >&2
  exit 0
fi

if [ "$LOCKS" = "0" ] && [ "$MVN" = "0" ]; then
  # A VOID with no cause attached gets triaged by opening a log, and twelve of those is an
  # afternoon. The blockers seen so far are specific and recognisable, so name them: every one of
  # these is a property of the REPO, not of the sandbox, and the distinction is what a reader needs.
  WHY="the resolver ran and produced no lockfile — see jvm-resolve/resolve.log. This is a VOID, not a project without dependencies"
  LOG="$OUT/jvm-resolve/discovery.log"
  if [ -f "$LOG" ]; then
    if grep -q 'Cannot find a Java installation' "$LOG" 2>/dev/null; then
      NEEDS="$(grep -o 'languageVersion=[0-9]*' "$LOG" 2>/dev/null | head -1 | cut -d= -f2)"
      WHY="the project requires a Java toolchain (languageVersion=${NEEDS:-unknown}) that ${IMAGE} does not provide, and toolchain auto-download is off. Set CW_JVM_IMAGE to a matching JDK. This is a repo/runtime mismatch, not a sandbox failure"
    elif grep -q 'does not exist' "$LOG" 2>/dev/null && grep -q 'Included build' "$LOG" 2>/dev/null; then
      WHY="an included build is missing — this is a COMPOSITE build and must be resolved from the build root that owns it"
      if [ "$COMPOSITE_DYNAMIC" = true ]; then
        WHY="$WHY. Its settings file passes includeBuild a computed argument, so which build it names could not be read statically"
      fi
    elif [ "$DENIED" -gt 0 ] 2>/dev/null; then
      WHY="resolution failed with $DENIED egress request(s) DENIED by the allowlist. Read jvm-resolve/egress-access.log: either the project needs a repository that is not declared in manifests/jvm-egress-allowlist.json, or its build tried to reach somewhere it should not have"
    fi
  fi
  emit "{\"tool\":\"jvm-resolve\",\"generatedAt\":\"$TS\",\"ran\":true,\"resolved\":false,\"repo\":$(esc "$NAME_HINT"),\"kind\":\"$KIND\",\"exit\":$rc,\"deniedRequests\":$DENIED,\"reason\":$(esc "$WHY")}"
  echo "jvm-resolve: no lockfile produced (exit $rc, $DENIED denied) — $WHY" >&2
  exit 0
fi

emit "{\"tool\":\"jvm-resolve\",\"generatedAt\":\"$TS\",\"ran\":true,\"resolved\":true,\"repo\":$(esc "$NAME_HINT"),\"kind\":\"$KIND\",\"lockfiles\":$LOCKS,\"mavenList\":$MVN,\"deniedRequests\":$DENIED,\"tier\":\"derived\",\"pinnedArtifacts\":$PINS,\"verification\":\"$VERIFIED\",\"distribution\":{\"version\":$(esc "${DIST_VERSION:-unknown}"),\"kind\":$(esc "${DIST_KIND:-unknown}"),\"sha256\":$(esc "${DIST_SHA:-}"),\"pinnedByRepo\":$DIST_PREPINNED},\"sourceUnmodified\":true,\"note\":\"Resolved in a container from a READ-ONLY copy of the tree. These versions are what this box resolved at this moment through a bounded proxy — a fact about this run, not a claim the repository made. observables.mjs reads them at tier derived and they are never written into the working tree.\"}"
case "$VERIFIED" in
  pass) VMSG="verification PASSED on a --refresh-dependencies re-fetch against $PINS pinned artifact(s). Trust-on-first-use: the pins were written from the same upstream minutes earlier, so this is a reproducibility check, not evidence the artifacts are the ones anybody intended" ;;
  fail) VMSG="verification FAILED — a re-fetch produced bytes that do not match the pins written moments earlier. Read jvm-resolve/enforce.log; this is either a mutable artifact or something worse, and either way the lockfile should not be trusted" ;;
  *)    VMSG="verification NOT RUN, so nothing here has been checked against anything — $PINS pin(s) recorded for future runs" ;;
esac
echo "jvm-resolve: $KIND — $LOCKS lockfile(s), $DENIED denied egress request(s) -> $OUT/jvm-resolve/"
echo "jvm-resolve: $VMSG"
