#!/usr/bin/env bash
# Boot a repo so the runtime lanes have something to point at, then tear it down.
#
# dast-nuclei, dast-authz-bola, tls-headers and api-fuzz all skip without CW_TARGET_URL. They have
# scanned 0 of 100 repos, and a lane that never runs is indistinguishable from one that runs clean.
#
# THIS IS THE MOST DANGEROUS LANE IN THE FLEET AND SHOULD BE READ AS SUCH. Every other sandboxed
# lane resolves or analyses; this one EXECUTES the scanned project's application code, on purpose,
# with a network. GATE A's container posture is the whole basis for it being permissible at all:
#   · a dedicated bridge network per boot, so the app cannot reach other containers
#   · no host mounts of any kind — the build context is a COPY, never the source tree
#   · cap-drop ALL, no-new-privileges, non-root where the image allows, pid and memory caps
#   · a hard timeout and an EXIT trap, so teardown happens on success, failure and interrupt alike
#
# NOT BOOTABLE IS A DECLARED STATE, NOT A FAILURE. Most repos are libraries or CLIs and were never
# going to listen on a port. Measured on the 100randomrepos corpus: 4 repos declare a root
# docker-compose and 20 a root Dockerfile, several of the latter being CLI tools. A harness that
# reported "could not boot" as an error would manufacture ~90 failures out of a corpus that is
# behaving normally.
#
# usage:  bin/boot-harness.sh <srcDir> [--keep-up]
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib/docker-config.sh"

SRC="${1:-${CW_BOOT_SRC:-$PWD}}"
KEEP="${2:-}"
TIMEOUT="${CW_BOOT_TIMEOUT:-300}"
READY_TRIES="${CW_BOOT_READY_TRIES:-30}"

OUT="${CW_REPORT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/reports/runtime-latest}"; mkdir -p "$OUT"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
JSON="$OUT/boot-harness.json"
STAMP="cwboot-$$"

json_escape(){ local s=$1; s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\r'/\\r}; s=${s//$'\t'/\\t}; printf '%s' "$s"; }
# Validate on the way out. The shape is DECLARED in schema/boot-harness.schema.json, so a renamed
# or misspelled key is refused here rather than reaching a consumer that reads it as absent.
# Fails LOUD: an artifact that cannot be checked must not be published as if it had been.
CW_SELFDIR="$(cd "$(dirname "$0")" && pwd)"
CW_ROOT="${CW_ROOT:-$(cd "$CW_SELFDIR/.." && pwd)}"
emit(){ printf '%s\n' "$1" > "$JSON"
  node "$CW_SELFDIR/validate-artifact.mjs" boot-harness "$JSON" || {
    echo "boot-harness: refusing to publish an artifact that does not match its schema" >&2; exit 1; }
}
notbootable(){ emit "{\"tool\":\"boot-harness\",\"generatedAt\":\"$TS\",\"ran\":true,\"booted\":false,\"bootable\":false,\"reason\":\"$(json_escape "$1")\"}"; echo "boot-harness: not bootable — $1"; exit 0; }
skip(){ emit "{\"tool\":\"boot-harness\",\"generatedAt\":\"$TS\",\"ran\":false,\"skipped\":true,\"reason\":\"$(json_escape "$1")\"}"; echo "boot-harness skipped: $1"; exit 0; }
failed(){ emit "{\"tool\":\"boot-harness\",\"generatedAt\":\"$TS\",\"ran\":true,\"booted\":false,\"bootable\":true,\"reason\":\"$(json_escape "$1")\"}"; echo "boot-harness: declared bootable but did NOT boot — $1"; exit 0; }

# ── teardown, unconditionally ───────────────────────────────────────────────────────────────────
# Registered before anything is created. A harness that leaks a running container from someone
# else's repository is worse than one that never booted it.
cleanup() {
  [ -n "$KEEP" ] && { echo "boot-harness: --keep-up set, leaving $STAMP running"; return; }
  if [ -n "${COMPOSE_DIR:-}" ] && [ -d "${COMPOSE_DIR:-}" ]; then
    (cd "$COMPOSE_DIR" && timeout 120 docker compose -p "$STAMP" down -v --remove-orphans >/dev/null 2>&1)
  fi
  # Bounded for the same reason as the liveness probe below: a wedged daemon blocks rather than
  # failing, and a block HERE is in the EXIT trap — it wedges teardown itself, which is how orphans
  # accumulate. Cleanup that cannot finish is worse than cleanup that reports it could not.
  timeout 30 docker rm -f "$STAMP" >/dev/null 2>&1
  timeout 30 docker network rm "$STAMP-net" >/dev/null 2>&1
  [ -n "${CTX:-}" ] && rm -rf "$CTX"
}
trap cleanup EXIT INT TERM

[ -d "$SRC" ] || skip "source directory does not exist: $SRC"
SRC_ABS="$(cd "$SRC" && pwd)"
command -v docker >/dev/null 2>&1 || skip "docker not installed — this lane REFUSES the host: it runs the scanned project's application code"
# THE LIVENESS PROBE IS THE ONE THAT HAS TO BE BOUNDED, and it was the only one that was not.
# `docker info` does not fail when the daemon is wedged — it BLOCKS, indefinitely. Measured
# 2026-09-04: rc=124 under `timeout 8`, `docker version` the same, and 46 orphaned `docker info`
# processes had accumulated on this box, one per suite run. Because bin/test/boot-harness.test.mjs
# invokes this script with spawnSync, that block freezes the whole node event loop: every test
# printed, no summary, and gate-tests read the truncated output as "no tally" — 27.8% of its 526
# firings. The long operations here were guarded from the start (compose up/down, build); the
# quick check was not, because a liveness probe "obviously" returns fast. It does not.
timeout 10 docker info >/dev/null 2>&1 || skip "docker is installed but not responding within 10s (daemon down, or wedged)"

COMPOSE=""
for f in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do
  [ -f "$SRC_ABS/$f" ] && { COMPOSE="$f"; break; }
done
[ -z "$COMPOSE" ] && [ ! -f "$SRC_ABS/Dockerfile" ] && \
  notbootable "no root docker-compose or Dockerfile — this repo declares no way to run itself, which for a library or CLI is normal and is NOT a scan failure"

# DEDICATED, NOT --internal, and the difference is a residual risk worth stating rather than hiding.
# --internal blocks published ports, and most applications need outbound DNS simply to start, so an
# isolated-from-everything boot mostly measures its own isolation. This network is dedicated so the
# app cannot reach OTHER containers; it can still reach the internet. Booting untrusted application
# code with egress is the residual risk GATE A's ruling accepts for this lane specifically, and it
# is the reason this is the only lane that runs the project rather than reading it.
timeout 30 docker network create "$STAMP-net" >/dev/null 2>&1 || true

if [ -n "$COMPOSE" ]; then
  # Compose needs the tree. It is COPIED, never mounted: a compose file is free to declare a bind
  # mount back onto its own source, and the copy is what makes that harmless.
  CTX="$(mktemp -d)"; cp -R "$SRC_ABS/." "$CTX/" 2>/dev/null || notbootable "could not copy the source tree for a compose boot"
  COMPOSE_DIR="$CTX"
  timeout "$TIMEOUT" docker compose -p "$STAMP" -f "$CTX/$COMPOSE" up -d --quiet-pull > "$OUT/boot-harness.log" 2>&1
  rc=$?
  # NEEDS-CONFIG IS THE DOMINANT CASE AND ITS OWN STATE. A compose file that declares env_file or
  # required variables is not broken — it is correctly not shipping its secrets, and the repo would
  # boot for its own maintainer. Reporting that as a bare exit code invites reading a well-behaved
  # project as a failing one. Measured on tbphp_gpt-load: ".env not found", nothing else wrong.
  if [ "$rc" -ne 0 ] && grep -qiE "env file .* not found|required variable|is not set" "$OUT/boot-harness.log" 2>/dev/null; then
    emit "{\"tool\":\"boot-harness\",\"generatedAt\":\"$TS\",\"ran\":true,\"booted\":false,\"bootable\":true,\"needsConfig\":true,\"reason\":\"the compose stack requires configuration the repository does not ship (an env file or unset required variables) — it is not broken and would boot for its maintainer, but this harness has nothing legitimate to supply and will not invent credentials\"}"
    echo "boot-harness: bootable but needs config it does not ship"; exit 0
  fi
  [ "$rc" -ne 0 ] && failed "docker compose up exited $rc — see boot-harness.log"
  PORT=$(timeout 30 docker compose -p "$STAMP" ps --format json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const l of s.split("\n").filter(Boolean)){try{const j=JSON.parse(l);const m=/0\.0\.0\.0:(\d+)/.exec(j.Publishers?JSON.stringify(j.Publishers):(j.Ports||""));if(m){console.log(m[1]);break}}catch{}}})' 2>/dev/null)
else
  CTX="$(mktemp -d)"; cp -R "$SRC_ABS/." "$CTX/" 2>/dev/null || notbootable "could not copy the source tree for a docker build"
  timeout "$TIMEOUT" docker build -t "$STAMP:latest" "$CTX" > "$OUT/boot-harness.log" 2>&1
  rc=$?
  [ "$rc" -ne 0 ] && failed "docker build exited $rc — see boot-harness.log"
  # `boot` posture, from bin/lib/sandbox.mjs. It is the WEAKEST declared posture — egress open,
  # container root, no tmpfs — and that is stated there rather than being an accident here: this
  # lane builds and starts the subject's own application, which needs the network the application
  # needs. Wiring it does not harden it; it puts the weakness in the one file where the postures
  # are read side by side, which is the only way anybody notices that this lane and `analyse` are
  # not the same thing. --network and -P stay on the command line because they are this run's
  # topology, not its isolation, and --keep-container is asked for explicitly: the container must
  # OUTLIVE this script for the runtime lanes to have anything to scan.
  BOOT_SBX="$(node "$CW_ROOT/bin/sandbox.mjs" --posture boot --name "$STAMP" \
    --memory "${CW_BOOT_MEM:-2g}" --keep-container)" \
    || failed "the sandbox refused to emit flags for the boot phase — no container is started, which reports notbootable rather than a clean runtime scan"
  timeout "$TIMEOUT" docker run -d $BOOT_SBX --network "$STAMP-net" -P \
    "$STAMP:latest" >> "$OUT/boot-harness.log" 2>&1
  [ $? -ne 0 ] && failed "the image built but the container would not start — see boot-harness.log"
  PORT=$(timeout 15 docker port "$STAMP" 2>/dev/null | sed -n 's/.*:\([0-9]*\)$/\1/p' | head -1)
fi

[ -z "${PORT:-}" ] && notbootable "started, but published no port — the project runs as a CLI or worker rather than a listening service, so the runtime lanes have nothing to point at"

URL="http://127.0.0.1:$PORT"
ready=0
for _ in $(seq 1 "$READY_TRIES"); do
  if curl -s -o /dev/null -m 2 "$URL" 2>/dev/null; then ready=1; break; fi
  sleep 1
done
[ "$ready" -ne 1 ] && failed "published port $PORT but nothing answered within ${READY_TRIES}s — a port that does not respond is not a target, and pointing a scanner at it would report a clean scan of nothing"

emit "{\"tool\":\"boot-harness\",\"generatedAt\":\"$TS\",\"ran\":true,\"booted\":true,\"bootable\":true,\"url\":\"$URL\",\"port\":$PORT,\"mode\":\"$([ -n "$COMPOSE" ] && echo compose || echo dockerfile)\",\"project\":\"$STAMP\",\"sourceCopied\":true,\"note\":\"the application code of the scanned repository is RUNNING. Export CW_TARGET_URL=$URL for the runtime lanes while this is up; teardown is automatic when this script exits unless --keep-up was passed.\"}"
echo "boot-harness: UP at $URL (mode $([ -n "$COMPOSE" ] && echo compose || echo dockerfile))"
[ -n "$KEEP" ] && echo "CW_TARGET_URL=$URL"
