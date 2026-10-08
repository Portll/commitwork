# shellcheck shell=bash
# Point this lane's docker at commitwork's own config. Source it after `set -`, before any docker
# call: `. "$(dirname "${BASH_SOURCE[0]}")/lib/docker-config.sh"`.
#
# The path is asked for rather than written here, so shell and node cannot drift apart.
#
# An inherited DOCKER_CONFIG wins, so a caller scanning a private registry keeps its identity
# instead of silently dropping to an anonymous pull that reports fewer findings.
if [ -z "${DOCKER_CONFIG:-}" ]; then
  # Parameter expansion, not `dirname`: a lane may run under a PATH that holds only the shell.
  _cw_here="${BASH_SOURCE[0]%/*}"; [ "$_cw_here" = "${BASH_SOURCE[0]}" ] && _cw_here=.
  # `|| true`: a caller under `set -e` exits on the substitution's status the moment node is absent,
  # silently, with the redirect hiding the only symptom.
  _cw_docker_config="$(node "$_cw_here/../docker-config-path.mjs" 2>/dev/null || true)"
  unset _cw_here
  # Empty means node is missing or the module moved. Leaving DOCKER_CONFIG unset falls back to
  # ~/.docker, which is the old behaviour and still scans correctly — an unset variable must not
  # take the lane down, and `set -u` below would do exactly that if this were exported blank.
  [ -n "$_cw_docker_config" ] && export DOCKER_CONFIG="$_cw_docker_config"
  unset _cw_docker_config
fi
