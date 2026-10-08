#!/bin/bash
# codeql-swift-build — the build command CodeQL traces for the Swift lane.
#
# WHY THIS EXISTS INSTEAD OF --build-mode=autobuild. GitHub documents the requirement: for compiled
# languages the build command "must specify a 'clean' build which compiles all the source code
# files without reusing existing build artefacts". Autobuild does not clean. Measured 2026-08-30 on
# an internal iOS app: an earlier run had left objects in the project's own ios/App/build/ directory, the
# target was therefore up to date, nothing recompiled, and the tracer — which only observes compiler
# invocations — extracted two Package.swift manifests and no application code. `database create`
# exited 0, `analyze` exited 0, 27 rules loaded, 0 findings. A void wearing a clean read's clothes.
#
# `clean` FIRST, every run, deliberately. It costs a full rebuild each scan and that is the price of
# the result meaning anything: an incremental build under a tracer measures only what changed since
# a build nobody recorded.
#
# DISCOVERY, not configuration. The fleet scans many repositories and a lane that names one scheme
# covers one repo. Workspace wins over project (a workspace that exists and is skipped builds the
# wrong graph), and the scheme comes from xcodebuild's own -list rather than a guess.
#
# EVERY FAILURE IS LOUD AND WRITES NOTHING. A build that cannot start must not leave a database
# CodeQL will finalise anyway: exiting non-zero here fails `database create`, which the lane already
# reports as noscan. bin/codeql-extraction-check.mjs is the second witness for the case where the
# build DOES run and still reads nothing.
set -eu

ROOT="${1:-$PWD}"
cd "$ROOT" || { echo "codeql-swift-build: cannot enter $ROOT" >&2; exit 2; }

# Prefer a workspace; it is the graph Xcode itself would build.
WS=$(find . -maxdepth 4 -name '*.xcworkspace' -not -path '*/.git/*' -not -path '*/project.xcworkspace' 2>/dev/null | head -1)
PROJ=$(find . -maxdepth 4 -name '*.xcodeproj' -not -path '*/.git/*' 2>/dev/null | head -1)

# A package with no Xcode container builds through SwiftPM. --disable-sandbox because SwiftPM wraps
# manifest evaluation in its own seatbelt profile, which cannot nest inside the lane's
# ("sandbox_apply: Operation not permitted"); the lane's profile still confines the manifest.
if [ -z "$WS" ] && [ -z "$PROJ" ] && [ -f Package.swift ]; then
  SP="${CW_REPORT_DIR:-${TMPDIR:-/tmp}}/codeql-swift-spm"
  rm -rf "$SP"
  echo "codeql-swift-build: clean swift build of the package at $ROOT" >&2
  exec /usr/bin/xcrun swift build --disable-sandbox --scratch-path "$SP"
fi

if [ -n "$WS" ]; then CONTAINER=(-workspace "$WS")
elif [ -n "$PROJ" ]; then CONTAINER=(-project "$PROJ")
else
  echo "codeql-swift-build: no .xcworkspace, .xcodeproj or Package.swift under $ROOT — nothing to build, and a database built from nothing would analyse clean" >&2
  exit 3
fi

# The scheme from xcodebuild's own listing. -json keeps a scheme containing spaces intact, which a
# line-splitting parse does not: the first repo this ran against had a scheme name containing a
# space, and quoting that through a shell string is what broke the first attempt at this lane.
SCHEME=$(/usr/bin/xcodebuild -list -json "${CONTAINER[@]}" 2>/dev/null \
  | /usr/bin/python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
s=(d.get("workspace") or d.get("project") or {}).get("schemes") or []
print(s[0] if s else "")' 2>/dev/null || true)

if [ -z "$SCHEME" ]; then
  echo "codeql-swift-build: xcodebuild -list reported no scheme for ${WS:-$PROJ} — refusing to guess a target" >&2
  exit 4
fi

echo "codeql-swift-build: clean build of scheme '$SCHEME' in ${WS:-$PROJ}" >&2

# Simulator SDK and signing off: a scan must not need a provisioning profile, and an unsigned
# simulator build compiles exactly the same sources.
# PRIVATE DERIVED DATA, and this is not tidiness. Measured 2026-08-30: against the default shared
# ~/Library/Developer/Xcode/DerivedData, `clean` exits 65 on
#   error: Could not delete .../SourcePackages/checkouts/...
# because those SPM checkouts are in use — plausibly held open by the tracer, and in a fleet they
# are shared with every other build on the machine. `clean` is the right instruction and the wrong
# SCOPE: it must clear THIS scan's build products, never a cache other work depends on.
#
# A private path gives the clean something it owns, so a cold build is guaranteed without deleting
# anything shared. It also makes the scan repeatable — the previous run's products cannot leak in,
# which is the whole defect this script exists to prevent.
DD="${CW_REPORT_DIR:-${TMPDIR:-/tmp}}/codeql-swift-dd"
mkdir -p "$DD"
exec /usr/bin/xcodebuild clean build \
  "${CONTAINER[@]}" -scheme "$SCHEME" \
  -derivedDataPath "$DD" \
  -sdk iphonesimulator -configuration Debug \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO ONLY_ACTIVE_ARCH=YES
