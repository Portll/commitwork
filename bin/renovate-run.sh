#!/usr/bin/env bash
# Self-hosted Renovate — NOT GitHub Actions. Two modes:
#   local  (default) dependency-dashboard dry-run against a mounted checkout, NO token/PRs —
#          fits the local-monitor model; reports what Renovate *would* raise.
#   pr     real PRs against the git host — needs RENOVATE_TOKEN + a repo slug.
#
# usage:
#   bin/renovate-run.sh /path/to/repo                 # local dry-run
#   RENOVATE_TOKEN=ghp_… bin/renovate-run.sh Portll/clientA pr
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib/docker-config.sh"
TARGET="${1:?usage: renovate-run.sh <repo-path|owner/repo> [local|pr]}"
MODE="${2:-local}"
IMG="renovate/renovate:latest"

if [ "$MODE" = "pr" ]; then
  : "${RENOVATE_TOKEN:?RENOVATE_TOKEN required for pr mode}"
  docker run --rm \
    -e RENOVATE_TOKEN \
    -e RENOVATE_PLATFORM="${RENOVATE_PLATFORM:-github}" \
    -e RENOVATE_REPOSITORIES="$TARGET" \
    -e RENOVATE_DRY_RUN="${RENOVATE_DRY_RUN:-}" \
    -e LOG_LEVEL="${LOG_LEVEL:-info}" \
    "$IMG"
else
  # local platform: scan the mounted repo, no git host, no token — dashboard to stdout.
  # `lookup`: it reads the repo's manifests and talks to registries, and never executes repo build
  # logic. Isolation comes from bin/lib/sandbox.mjs so this lane is reviewed beside the others
  # rather than on its own; before wiring it had NO isolation at all beyond the read-only mount.
  REPODIR="$(cd "$TARGET" && pwd)"
  SBX="$(node "$(cd "$(dirname "$0")/.." && pwd)/bin/sandbox.mjs" --posture lookup \
    --name "${CW_CONTAINER_NAME:-cw-renovate-local}" --mount-source "$REPODIR:/repo:ro")" \
    || { echo "renovate-run: the sandbox refused to emit flags; running renovate over an untrusted tree without the declared isolation is not a fallback" >&2; exit 2; }
  docker run $SBX -w /repo \
    -e RENOVATE_PLATFORM=local \
    -e RENOVATE_DRY_RUN="${RENOVATE_DRY_RUN:-full}" \
    -e RENOVATE_ONBOARDING=false \
    -e RENOVATE_REQUIRE_CONFIG="${RENOVATE_REQUIRE_CONFIG:-optional}" \
    -e LOG_LEVEL="${LOG_LEVEL:-info}" \
    "$IMG" renovate --platform=local
fi
# NOTE on the `pr` branch above: it is deliberately NOT sandboxed here. It mounts no repo, holds a
# write-scoped RENOVATE_TOKEN, and its whole purpose is to reach a git host and open pull requests.
# That is an AUTHORITY-bearing action, not a scan, and this project's split says applying stays a
# human act — wrapping it in a scanner posture would dress a credentialed write as an isolated read.
