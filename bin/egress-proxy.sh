#!/usr/bin/env bash
# bin/egress-proxy.sh — the filtering proxy that bounds what a resolution container can reach.
#
# WHY A PROXY AND NOT A FIREWALL RULE. bin/lib/sandbox.mjs's `build-resolve` posture exists because
# resolving a JVM dependency graph means EVALUATING the repo's build script while talking to a
# registry. Every other posture in that file refuses that pairing; this one cannot, so its only
# real control is the size of the reachable set. Docker has no native domain allowlist, and an
# IP-based rule is useless against a CDN, so the control is an HTTP proxy with default-deny on
# CONNECT and a declared list of destinations.
#
# THE DENY LOG IS THE POINT, NOT A SIDE EFFECT. squid records every refused request. A build that
# only ever touches the registries in manifests/jvm-egress-allowlist.json is a build that did what
# it said it would; anything else is a lead worth reading. The log is copied out to the report dir
# by bin/jvm-resolve.sh, so the evidence outlives the container.
#
# DECLARATION SPLIT FROM AUTHORITY. This script starts and stops a proxy. It never edits the
# allowlist — that is a JSON manifest a human reviews, and widening it is a deliberate act.
#
# usage:
#   bin/egress-proxy.sh up          prints the proxy URL and network name on stdout, one per line
#   bin/egress-proxy.sh down        removes the container and the network
#   bin/egress-proxy.sh log <path>  copies the access log out
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib/docker-config.sh"

CW_ROOT="${CW_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
NET="${CW_EGRESS_NET:-cw-jvm-egress}"
NAME="${CW_EGRESS_NAME:-cw-egress-proxy}"
PORT="${CW_EGRESS_PORT:-3128}"
IMAGE="${CW_EGRESS_IMAGE:-ubuntu/squid:latest}"
ALLOWLIST="${CW_EGRESS_ALLOWLIST:-$CW_ROOT/manifests/jvm-egress-allowlist.json}"

die(){ echo "egress-proxy: $*" >&2; exit 2; }

cmd="${1:-}"
[ -n "$cmd" ] || die "usage: egress-proxy.sh up|down|log <path>"

case "$cmd" in
down)
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker network rm "$NET-out" >/dev/null 2>&1 || true
  echo "egress-proxy: removed $NAME and $NET"
  exit 0
  ;;
offset)
  # The byte length of the access log RIGHT NOW. A caller records this before starting a run and
  # passes it back to `log`, so the extracted evidence is that run's and not the file's whole
  # history. See the note on `log`.
  LOGDIR="${CW_EGRESS_LOGDIR:-${TMPDIR:-/tmp}/cw-egress-logs}"
  if [ -f "$LOGDIR/access.log" ]; then wc -c < "$LOGDIR/access.log" | tr -d '[:space:]'; else echo 0; fi
  exit 0
  ;;
log)
  OUT="${2:?usage: egress-proxy.sh log <path> [fromByte]}"
  FROM="${3:-0}"
  LOGDIR="${CW_EGRESS_LOGDIR:-${TMPDIR:-/tmp}/cw-egress-logs}"
  # FROM AN OFFSET, NOT THE WHOLE FILE. The log lives at a fixed host path and squid APPENDS, so
  # copying it whole attributed every previous run's traffic to the current one. That is how a
  # stale `TCP_DENIED plugins-artifacts.gradle.org` — from before that host was allowlisted —
  # survived into a run where the same request had actually succeeded, and how a github tunnel from
  # a diagnostic run was read as a finding about a later one. Counts derived from a shared,
  # append-only log are cumulative unless someone bounds them.
  #
  # CONCURRENCY CAVEAT, stated rather than hidden: the proxy is shared, so if two resolutions run
  # at once each one's slice will contain the other's requests. It is a superset of this run, never
  # a subset, and never older history. Per-run precision would need the client IP, which is gone
  # once the container exits.
  if [ -f "$LOGDIR/access.log" ]; then
    tail -c "+$((FROM + 1))" "$LOGDIR/access.log" > "$OUT"
  else
    echo "egress-proxy: no access log at $LOGDIR/access.log — the DENY record for this run is UNAVAILABLE, which is not the same as empty" >&2
    exit 1
  fi
  exit 0
  ;;
up) ;;
*) die "unknown command '$cmd'" ;;
esac

[ -f "$ALLOWLIST" ] || die "allowlist $ALLOWLIST is absent. Refusing to start an unfiltered proxy — that would be a control in name only."

# Render squid.conf FROM the manifest. The allowlist has exactly one source of truth and it is the
# reviewable JSON, not a config file somebody edited once.
LOGDIR="${CW_EGRESS_LOGDIR:-${TMPDIR:-/tmp}/cw-egress-logs}"
mkdir -p "$LOGDIR" && chmod 777 "$LOGDIR" || die "could not create the log dir $LOGDIR"

CONF_DIR="$(mktemp -d)"
trap 'rm -rf "$CONF_DIR"' EXIT

node --input-type=module -e "
import { renderSquidConf } from '$CW_ROOT/bin/lib/egress-conf.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const m = JSON.parse(readFileSync(process.argv[1], 'utf8'));
const conf = renderSquidConf(m, { port: Number(process.argv[3]) });
writeFileSync(process.argv[2], conf);
console.error('egress-proxy: ' + m.allow.length + ' host(s) allowed, default deny');
" "$ALLOWLIST" "$CONF_DIR/squid.conf" "$PORT" || die "could not render squid.conf from the allowlist"

# ── THE NETWORK MUST BE INTERNAL, OR THE PROXY IS ADVISORY ──────────────────────────────────────
#
# This was created with --internal=false and the whole control was decorative. Gradle does not read
# http_proxy/HTTPS_PROXY for its own dependency resolution — it wants systemProp.http.proxyHost —
# so it ignored the proxy entirely and went straight out through the network's own route. The run
# succeeded, the deny log was empty, and an empty deny log reads exactly like a build that touched
# only the allowlist. It was a build that never met the allowlist at all.
#
# An INTERNAL network has no external route, so the only reachable thing is another container on
# it. That makes the proxy the sole path out by construction rather than by configuration, and a
# resolver that ignores the proxy now fails instead of escaping.
#
# The proxy itself still needs the internet, so it is DUAL-HOMED: attached to the internal network
# for its clients and to a bridge network for its own egress. The resolution container is only ever
# on the internal one.
timeout 30 docker network inspect "$NET" >/dev/null 2>&1 || timeout 30 docker network create --internal "$NET" >/dev/null \
  || die "could not create internal network $NET"
timeout 30 docker network inspect "$NET-out" >/dev/null 2>&1 || timeout 30 docker network create "$NET-out" >/dev/null \
  || die "could not create egress network $NET-out"

# ── REUSE A HEALTHY PROXY RATHER THAN RECREATING IT ─────────────────────────────────────────────
#
# `up` used to force-remove any existing proxy, which meant two concurrent resolutions destroyed
# each other's egress: the second run killed the container the first was resolving through, and the
# first then failed with a message about the proxy not starting. Found by running two repos at once.
#
# So a running proxy is reused — but ONLY if it was built from the SAME allowlist. Reusing one
# started from a stale, wider list would silently resolve against a control nobody currently
# declares, which is worse than the contention it fixes. The config hash rides as a container label.
CONF_HASH="$(node -e 'const{createHash}=require("node:crypto");const fs=require("fs");process.stdout.write(createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex").slice(0,16))' "$CONF_DIR/squid.conf")"
RUNNING_HASH="$(timeout 20 docker inspect -f '{{index .Config.Labels "cw.egress.conf"}}' "$NAME" 2>/dev/null || true)"
RUNNING_STATE="$(timeout 20 docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null || true)"

if [ "$RUNNING_STATE" = "true" ] && [ "$RUNNING_HASH" = "$CONF_HASH" ]; then
  echo "egress-proxy: reusing the running proxy (allowlist unchanged, $CONF_HASH)" >&2
  echo "http://$NAME:$PORT"
  echo "$NET"
  exit 0
fi

if [ "$RUNNING_STATE" = "true" ]; then
  echo "egress-proxy: an existing proxy was started from a DIFFERENT allowlist ($RUNNING_HASH != $CONF_HASH) — replacing it" >&2
fi
timeout 30 docker rm -f "$NAME" >/dev/null 2>&1 || true

# The proxy mounts its config read-only and NO repo source. It is the one container in this lane
# that reaches the open internet, and it runs nothing the corpus supplied.
#
# SETGID/SETUID ARE ADDED BACK, DELIBERATELY. squid starts as root and drops to its own user, which
# `--cap-drop ALL` makes impossible: it dies with "setgid: Operation not permitted" and then, worse,
# `docker run -d` still succeeds — the readiness probe below is the only reason that was noticed
# rather than shipped as a proxy that permits nothing. Granting the two caps is acceptable HERE and
# nowhere else in this lane: this container executes only the squid the image ships, never anything
# the corpus supplied. The resolution container that DOES run repo build logic keeps cap-drop ALL,
# and bin/lib/sandbox.mjs will not emit flags that say otherwise.
# cw.owner: the commitwork run that started it (monitor/containers.mjs), so a sweep's reaper spares
# the proxy while that run lives.
if ! docker run -d --name "$NAME" --network "$NET" \
     --label "cw.egress.conf=$CONF_HASH" ${CW_CONTAINER_OWNER:+--label "cw.owner=$CW_CONTAINER_OWNER"} \
     --cap-drop ALL --cap-add SETGID --cap-add SETUID \
     --security-opt no-new-privileges \
     --pids-limit 256 --memory 512m \
     -v "$CONF_DIR/squid.conf":/etc/squid/squid.conf:ro \
     -v "$LOGDIR":/cw-logs:rw \
     "$IMAGE" >/dev/null 2>"$CONF_DIR/err"; then
  die "could not start $NAME: $(head -2 "$CONF_DIR/err" 2>/dev/null)"
fi

# ── readiness is a FUNCTIONAL test of the control, not a liveness check ─────────────────────────
#
# `docker run -d` succeeding means the daemon accepted the container, not that squid is listening —
# the bin/tls-proxy.sh lesson. But "is the port open" is not enough either, and the first version of
# this probe was worse than useless twice over: it shelled out to `netstat`/`ss`, NEITHER of which
# exists in ubuntu/squid, so it could never succeed and the lane would have been permanently
# unusable. A probe has to be reachable in its own invocation.
#
# What actually needs proving is the ALLOWLIST, in both directions:
#   * an allowed host must succeed  — otherwise resolution silently resolves nothing, and a repo
#                                     with 300 dependencies reports as a repo with none;
#   * a denied host must FAIL       — otherwise the proxy is up, the lane looks healthy, and repo
#                                     build logic has the open internet. That is the failure this
#                                     whole file exists to prevent and it passes every liveness
#                                     check ever written.
# Dual-home the proxy. It is the ONLY container permitted on both sides: the internal network its
# clients sit on, and an ordinary bridge for its own egress. Without this the internal network has
# no route out at all and the proxy denies everything — which the probe below catches, loudly,
# rather than letting every repo report an empty dependency graph.
timeout 30 docker network connect "$NET-out" "$NAME" >/dev/null 2>&1 \
  || die "could not attach $NAME to $NET-out — with no outward route the proxy denies everything"

# THE PROBE IMAGE IS ITS OWN SETTING, and borrowing CW_JVM_IMAGE was the third instance in this
# lane of the same defect: a probe that cannot run in its own invocation.
#
#   1. netstat/ss — neither exists in ubuntu/squid, so the readiness check could never pass.
#   2. the access log — unreadable even as root, so "0 denied" was reported for every run.
#   3. this — eclipse-temurin:26-jdk carries no curl. Setting CW_JVM_IMAGE=...:26-jdk to satisfy
#      RxJava's toolchain silently disarmed the proxy's self-check, and the failure was reported as
#      "the egress proxy would not start", blaming the one component that was working.
#
# A probe's dependencies are part of the probe. This one names its own image, defaults to one
# verified to carry curl, and CHECKS rather than assuming — a probe that cannot run must say so
# instead of returning the same answer as a probe that ran and failed.
PROBE_IMAGE="${CW_EGRESS_PROBE_IMAGE:-eclipse-temurin:17-jdk}"
timeout 600 docker run --rm "$PROBE_IMAGE" sh -c 'command -v curl >/dev/null' 2>/dev/null \
  || die "the probe image $PROBE_IMAGE has no curl, so the egress control CANNOT BE VERIFIED. That is not a proxy failure and must not be reported as one — set CW_EGRESS_PROBE_IMAGE to an image that carries curl."
probe(){ timeout 60 docker run --rm --network "$NET" "$PROBE_IMAGE" \
  curl -s -o /dev/null -w '%{http_code}' --max-time 25 -x "http://$NAME:$PORT" "$1" 2>/dev/null; }

ready=0
for _ in $(seq 1 10); do
  code="$(probe https://repo1.maven.org/maven2/ || true)"
  case "$code" in 2*|3*) ready=1; break ;; esac
  sleep 3
done
if [ "$ready" -ne 1 ]; then
  docker logs "$NAME" 2>&1 | tail -5 >&2
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  die "the proxy did not pass an ALLOWED request through after 30s (last code: ${code:-none}) — a resolution run against it would resolve NOTHING and report an empty graph"
fi

CANARY="$(node -e 'import("'"$CW_ROOT"'/bin/lib/egress-conf.mjs").then(m=>process.stdout.write(m.DENY_CANARY))' 2>/dev/null)"
[ -n "$CANARY" ] || die "could not read the denial canary from bin/lib/egress-conf.mjs"
denied="$(probe "https://$CANARY/" || true)"
case "$denied" in
  2*|3*)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    die "the proxy allowed the denial canary $CANARY, which is NOT in the allowlist. The filter is not filtering, and every check short of this one would have called the lane healthy. Refusing to hand repo build logic the open internet."
    ;;
esac

echo "egress-proxy: verified — an allowed host passes and a denied host does not ($CANARY -> ${denied:-blocked})" >&2

echo "http://$NAME:$PORT"
echo "$NET"
