#!/bin/sh
# smoke.sh: runs `doctor` and one scan of a synthetic repository inside a built image, with the run
# flags container/README.md documents, then container/assert-confined.mjs on the scan. It fails unless
# doctor finds the host sandbox and every lane that ran was confined. The container CI job runs it;
# it runs the same against a local build. It pulls, builds and pushes nothing.
#
# usage: sh container/smoke.sh <image> [--min <n>]   (--min: lanes that must run, default 10)
# exit: 0 · 2 usage, or no `timeout` on PATH · 23 doctor reports no host sandbox · 24 the scan wrote
#       no scan.json · 20 a lane ran unconfined · 21 fewer than <n> lanes ran · 22 scan.json
#       unreadable · 124 the confinement check outlived its bound

set -eu

usage() { echo 'usage: sh container/smoke.sh <image> [--min <n>]' >&2; exit 2; }
[ $# -ge 1 ] || usage
image=$1; shift
min=10
if [ $# -gt 0 ]; then
  { [ "$1" = --min ] && [ $# -eq 2 ]; } || usage
  min=$2
fi
case $min in *[!0-9]*) min= ;; esac
[ -n "$min" ] || usage
# A wedged daemon blocks a docker call rather than failing it, so every one is bounded.
command -v timeout >/dev/null 2>&1 || { echo 'smoke.sh: needs timeout (coreutils) on PATH' >&2; exit 2; }

work=$(mktemp -d "${TMPDIR:-/tmp}/cw-smoke.XXXXXX")
# The image's uid 1000 owns what the scan writes under $out, so on a Linux host this user may not
# be able to delete it. Cleanup reports that and keeps the smoke test's own exit status.
# shellcheck disable=SC2329 # invoked by the EXIT trap
cleanup() {
  status=$?
  rm -rf -- "$work" 2>/dev/null || echo "smoke.sh: left $work (files the image's uid 1000 wrote)" >&2
  exit "$status"
}
trap cleanup EXIT
repo=$work/repo out=$work/out
mkdir -p "$repo/app" "$repo/src" "$repo/.github/workflows" "$out"
# The image runs as uid 1000; on a Linux host the report directory must be writable by it.
chmod 0777 "$out"

printf '%s\n' 'import subprocess' '' '' 'def run(name):' '    return subprocess.call("ls " + name, shell=True)' > "$repo/app/main.py"
printf '%s\n' '[project]' 'name = "smoke"' 'version = "0.0.1"' > "$repo/pyproject.toml"
printf '%s\n' '#include <string.h>' '' 'void copy(char *d, const char *s) { strcpy(d, s); }' > "$repo/src/copy.c"
printf '%s\n' 'name: smoke' 'on: push' 'permissions: {}' 'jobs:' '  t:' '    runs-on: ubuntu-latest' '    steps:' '      - run: echo ok' \
  > "$repo/.github/workflows/smoke.yml"
git -C "$repo" init -q
git -C "$repo" -c user.name=smoke -c user.email=smoke@example.invalid -c commit.gpgsign=false add -A
git -C "$repo" -c user.name=smoke -c user.email=smoke@example.invalid -c commit.gpgsign=false commit -qm smoke
# The repository is mounted under another owner; world-readable is what git and the lanes need.
chmod -R a+rX "$repo"

# run <seconds> <docker run args>: the image with the flags container/README.md documents.
run() {
  bound=$1; shift
  timeout "$bound" docker run --rm --init --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
    --device /dev/net/tun "$@"
}

rc=0
run 300 "$image" doctor --manifest security-baseline > "$work/doctor.log" 2>&1 || rc=$?
cat "$work/doctor.log"
grep -q '✓ host sandbox' "$work/doctor.log" || { echo "smoke.sh: doctor (exit $rc) reports no host sandbox" >&2; exit 23; }

rc=0
run 1200 -v "$repo:/repo:ro" -v "$out:/out" "$image" scan --root /repo --out /out || rc=$?
[ -f "$out/scan.json" ] || { echo "smoke.sh: the scan (exit $rc) wrote no scan.json" >&2; exit 24; }
echo "smoke.sh: scan exited $rc"

rc=0
timeout 120 docker run --rm --entrypoint node -v "$out:/out:ro" "$image" /opt/commitwork/container/assert-confined.mjs /out/scan.json --min "$min" || rc=$?
exit "$rc"
