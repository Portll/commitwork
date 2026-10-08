#!/usr/bin/env bash
# Local self-signed HTTPS in front of a PLAINTEXT gateway so testssl/nuclei can grade TLS config.
# GHA-safe: no-op exit 0 if docker absent; SIGKILL-safe (rm -f before start clears a leaked container).
# usage:  bin/tls-proxy.sh up | down
#   TLS_PROXY_PORT (default 8444) · CW_TLS_HOSTNAME (default localhost) · CW_AREA_SLUG (names the
#   container) · upstream = CW_UPSTREAM, else derived from CW_TARGET_URL
#
# WHAT THIS DELIBERATELY WILL NOT DO: front a target that already speaks HTTPS. Wrapping a real TLS
# edge in a self-signed dev proxy makes the scanner grade Caddy's internal certificate and file the
# result under the project's name — a passing grade for a certificate nobody deploys. That is the
# unsupported-pass failure the reporting checks must prevent, so an https:// target is an error, not a warning.
set -euo pipefail
# No external command here: the no-probe test runs this under a PATH holding only the shell, and
# `dirname` is not a builtin.
here="${BASH_SOURCE[0]%/*}"; [ "$here" = "${BASH_SOURCE[0]}" ] && here=.
. "$here/lib/docker-config.sh"

PORT="${TLS_PROXY_PORT:-8444}"
# The cert Caddy mints covers this name, and it is the name the scanner must then use as its Host.
# An empty host (`--from ":8444"`) mints one loopback cert identical for every project and consults
# no project's declared hostname at all.
TLS_HOST="${CW_TLS_HOSTNAME:-localhost}"
# One fixed container name made the proxy a global singleton: a second project's `up` silently
# killed the first project's in-flight scan. Scoped to the area, two areas coexist; if they also
# collide on the port, docker now fails loudly instead (see the listen check below).
SLUG="${CW_AREA_SLUG:-default}"
NAME="${CW_TLS_PROXY_NAME:-commitwork-tls-proxy-${SLUG}}"
CMD="${1:-up}"

usage(){ echo "usage: bin/tls-proxy.sh up|down" >&2; }

# Upstream: whatever the rest of the run is already pointed at. The old default hardcoded one
# dev gateway's port (host.docker.internal:8080), so fronting any other app silently graded the
# wrong service. Derive scheme + host:port from CW_TARGET_URL (default port by scheme; loopback
# rewritten to host.docker.internal because the proxy dials from INSIDE the container).
derive(){ # $1 = url -> prints "scheme host:port"
  local u="${1#*://}" scheme="${1%%://*}" hostport
  hostport="${u%%/*}"
  # Credentials in userinfo would otherwise ride onto docker's argv, where every user on the box
  # reads them in `ps` and `docker inspect` records them for the life of the container.
  hostport="${hostport##*@}"
  case "$hostport" in *:*) ;; *) [ "$scheme" = https ] && hostport="$hostport:443" || hostport="$hostport:80" ;; esac
  case "$hostport" in localhost:*|127.0.0.1:*|0.0.0.0:*|\[::1\]:*) hostport="host.docker.internal:${hostport##*:}" ;; esac
  printf '%s %s' "$scheme" "$hostport"
}

case "$CMD" in
  up|down) ;;
  # Anything-but-`down`-means-up turned `--help` and every typo into a listening proxy.
  *) usage; exit 2 ;;
esac

command -v docker >/dev/null 2>&1 || { echo "docker not available — skipping (self-gate)"; exit 0; }

if [ "$CMD" = "down" ]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  echo "tls-proxy down (:$PORT freed)"
  exit 0
fi

UP="${CW_UPSTREAM:-}"
SCHEME=http
if [ -z "$UP" ] && [ -n "${CW_TARGET_URL:-}" ]; then
  read -r SCHEME UP <<<"$(derive "$CW_TARGET_URL")"
fi

# No upstream, no guess: fronting an unrelated local port would grade someone else's TLS as yours.
# This guard runs BEFORE any teardown — the old order tore down a proxy serving a live scan and then
# reported "skipped", so the operator read a no-op while their scan's listener was being destroyed.
[ -n "$UP" ] || { echo "tls-proxy skipped: no upstream — set CW_TARGET_URL (derived automatically) or CW_UPSTREAM=host:port"; exit 0; }

if [ "$SCHEME" = https ]; then
  echo "tls-proxy refused: the target already serves TLS." >&2
  echo "  Fronting it with a self-signed proxy would grade Caddy's dev certificate, not yours." >&2
  echo "  Point the scanner straight at it:  CW_TLS_URL=\"\$CW_TARGET_URL\" node bin/tls-headers-scan.mjs" >&2
  exit 3
fi

timeout 30 docker rm -f "$NAME" >/dev/null 2>&1 || true   # clear any prior/leaked instance (trap-independent)

# NOT SANDBOXED, and reviewed 2026-08-26 when every other docker call site in this repository was
# wired to bin/lib/sandbox.mjs. This is not a scanner: it is a piece of the fleet's own test
# apparatus — a stock `caddy` reverse proxy that must LISTEN on a published port and reach a host
# gateway, both of which every declared posture correctly forbids. It mounts no repo source and
# runs no third-party code from the corpus. Forcing it into a posture would either not work or
# require an exemption that weakens the posture for everything else using it.
#
# No --rm: a container that starts and dies immediately would be removed before anyone could read
# why. The rm -f above already covers the leak case that --rm was there for.
# stderr is NOT suppressed — a docker failure that prints nothing is the whole bug below.
if ! docker run -d --name "$NAME" \
     --add-host=host.docker.internal:host-gateway \
     -p "127.0.0.1:${PORT}:${PORT}" \
     caddy caddy reverse-proxy --from "https://${TLS_HOST}:${PORT}" --to "$UP" --internal-certs >/dev/null; then
  echo "tls-proxy failed to start (port ${PORT} in use?)" >&2
  exit 1
fi

# `docker run -d` succeeding means docker ACCEPTED the container, not that anything is listening.
# Declaring "up" on that basis is an exit code with no subscriber: the scan then reads an
# unreachable target as "TLS half not configured" and files a clean-looking void.
listening=""
if command -v curl >/dev/null 2>&1; then
  # --resolve, so the probe tests the PROXY rather than the operator's DNS: a declared hostname
  # that isn't in /etc/hosts must not be reported as a broken proxy.
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if curl -ksS --max-time 2 --resolve "${TLS_HOST}:${PORT}:127.0.0.1" "https://${TLS_HOST}:${PORT}/" >/dev/null 2>&1; then listening=yes; break; fi
    docker ps -q -f "name=^${NAME}$" | grep -q . || break   # container died; stop waiting on a corpse
    sleep 0.5
  done
  if [ -z "$listening" ]; then
    echo "tls-proxy FAILED: container started but nothing answers https://${TLS_HOST}:${PORT}" >&2
    docker logs "$NAME" 2>&1 | tail -20 >&2 || true
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    exit 1
  fi
  echo "tls-proxy up -> https://${TLS_HOST}:${PORT} (upstream ${UP}, verified listening)"
  # The proxy is fine; the scanner still has to reach the name on the certificate. Saying which of
  # the two is missing beats letting the scan fail later as an unreachable-target void.
  if ! curl -ksS --max-time 2 "https://${TLS_HOST}:${PORT}/" >/dev/null 2>&1; then
    echo "  NOTE: ${TLS_HOST} does not resolve here — map it to 127.0.0.1 (/etc/hosts) or the scan will find nothing."
  fi
else
  # Unverified is its own state and says so — it must not read the same as a confirmed listener.
  echo "tls-proxy started -> https://${TLS_HOST}:${PORT} (upstream ${UP}) — UNVERIFIED: no curl to probe the port"
fi
echo "  now: CW_TLS_URL=https://${TLS_HOST}:${PORT} node bin/tls-headers-scan.mjs   (then bin/tls-proxy.sh down)"
