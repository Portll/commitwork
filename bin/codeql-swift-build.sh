#!/bin/bash
# codeql-swift-build — the build command CodeQL traces for the Swift lane.
#
# WHY THIS EXISTS INSTEAD OF --build-mode=autobuild. GitHub documents the requirement: for compiled
# languages the build command "must specify a 'clean' build which compiles all the source code
# files without reusing existing build artefacts". Autobuild does not clean. When an earlier build
# left objects in the project's own build directory, the target is up to date, nothing recompiles,
# and the tracer, which only observes compiler invocations, extracts the Package.swift manifests and
# no application code, while `database create` and `analyze` both exit 0 with no findings.
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

# --plan discovers the container, scheme and SDK, prints them one per line (mode, container flag,
# container path, scheme, SDK) and builds nothing. The lane runs it before `codeql database create`
# and hands the file back as CW_SWIFT_PLAN, so only the build runs under the tracer: there every
# xcodebuild call recompiles each Package.swift manifest through the x86_64 extractor.
PLAN_ONLY=0
if [ "${1:-}" = --plan ]; then PLAN_ONLY=1; shift; fi

ROOT="${1:-$PWD}"
cd "$ROOT" || { echo "codeql-swift-build: cannot enter $ROOT" >&2; exit 2; }

XCODEBUILD="${CW_XCODEBUILD:-/usr/bin/xcodebuild}"

# xcodebuild evaluates package manifests and runs build-tool plugins in its own seatbelt profile,
# which cannot nest inside the lane's: resolving a local package fails at
# "sandbox-exec: sandbox_apply: Operation not permitted", so no app with Swift packages can build.
# The lane's profile still confines both. Plugins and macros also wait for an approval no
# non-interactive build can give, so their validation is skipped as well.
PKG_ARGS=(-IDEPackageSupportDisableManifestSandbox=YES -IDEPackageSupportDisablePluginExecutionSandbox=YES
  -skipPackagePluginValidation -skipMacroValidation)

# The shallowest container outside dependency and tool directories, ties broken by path. A package's
# .swiftpm/xcode/package.xcworkspace is Xcode's view of that package, never the app, and one
# committed beside an app's .xcodeproj can come first in find's directory order.
# node_modules/ and .build/ hold vendored SDKs: a Capacitor plugin's checkout can carry another
# vendor's workspace.
shallowest() {
  find . -maxdepth 4 -name "$1" -not -path '*/.git/*' -not -path '*/project.xcworkspace' \
    -not -path '*/.swiftpm/*' -not -path '*/.build/*' -not -path '*/node_modules/*' \
    -not -path '*/Pods/*' -not -path '*/Carthage/*' 2>/dev/null \
    | awk -F/ '{ print NF "\t" $0 }' | sort -k1,1n -k2 | head -1 | cut -f2-
}

discover() {
  # Prefer a workspace; it is the graph Xcode itself would build.
  local ws proj
  ws=$(shallowest '*.xcworkspace')
  proj=$(shallowest '*.xcodeproj')

  MODE=xcode CFLAG='' CPATH='' SCHEME='' SDK=''
  if [ -n "$ws" ]; then CFLAG=-workspace CPATH=$ws
  elif [ -n "$proj" ]; then CFLAG=-project CPATH=$proj
  elif [ -f Package.swift ]; then MODE=spm; return
  else
    echo "codeql-swift-build: no .xcworkspace, .xcodeproj or Package.swift under $ROOT — nothing to build, and a database built from nothing would analyse clean" >&2
    exit 3
  fi

  # The scheme from xcodebuild's own listing. -json keeps a scheme containing spaces intact, which a
  # line-splitting parse does not.
  # A project lists its local packages' schemes beside its own, alphabetically, so the first can be
  # a package library. A scheme named for one of the project's targets is the app's. A workspace's
  # listing names no targets, so it keeps the first scheme.
  # A listing that fails is reported with xcodebuild's own reason: a project that points at a local
  # package absent from its checkout dies resolving packages, which is not "no scheme".
  local list_err listed why platform
  list_err="${CW_REPORT_DIR:-${TMPDIR:-/tmp}}/codeql-swift-list.err"
  listed=$("$XCODEBUILD" -list -json "$CFLAG" "$CPATH" "${PKG_ARGS[@]}" 2>"$list_err") || {
    why=$(grep -m1 -A2 'error:' "$list_err" | tr -s ' \n' ' ')
    echo "codeql-swift-build: xcodebuild -list failed for $CPATH: ${why:-$(tail -n 3 "$list_err" | tr -s ' \n' ' ')}" >&2
    exit 5
  }
  printf '%s\n' "$listed" > "${CW_REPORT_DIR:-${TMPDIR:-/tmp}}/codeql-swift-list.json"
  SCHEME=$(printf '%s' "$listed" | /usr/bin/python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
c=d.get("workspace") or d.get("project") or {}
s=c.get("schemes") or []
t=set(c.get("targets") or [])
print(next((x for x in s if x in t), s[0] if s else ""))' 2>/dev/null || true)
  if [ -z "$SCHEME" ]; then
    echo "codeql-swift-build: xcodebuild -list reported no scheme for $CPATH — refusing to guess a target" >&2
    exit 4
  fi

  # The SDK the scheme builds for. A device platform maps to its simulator; macOS has none, and a
  # macOS app built with -sdk iphonesimulator compiles nothing. An unread platform keeps the iOS
  # simulator.
  platform=$("$XCODEBUILD" -showBuildSettings -json "$CFLAG" "$CPATH" -scheme "$SCHEME" "${PKG_ARGS[@]}" 2>/dev/null \
    | /usr/bin/python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
print(next((e["buildSettings"].get("PLATFORM_NAME", "") for e in d if e.get("buildSettings")), ""))' 2>/dev/null || true)
  case "$platform" in
    macosx) SDK=macosx ;;
    appletvos|appletvsimulator) SDK=appletvsimulator ;;
    watchos|watchsimulator) SDK=watchsimulator ;;
    xros|xrsimulator) SDK=xrsimulator ;;
    *) SDK=iphonesimulator ;;
  esac
  echo "codeql-swift-build: scheme '$SCHEME' in $CPATH builds for $SDK (platform ${platform:-unread})" >&2
}

if [ -n "${CW_SWIFT_PLAN:-}" ]; then
  { IFS= read -r MODE && IFS= read -r CFLAG && IFS= read -r CPATH && IFS= read -r SCHEME && IFS= read -r SDK; } < "$CW_SWIFT_PLAN" \
    || { echo "codeql-swift-build: cannot read the build plan $CW_SWIFT_PLAN" >&2; exit 6; }
else
  discover
fi

if [ "$PLAN_ONLY" = 1 ]; then
  printf '%s\n' "$MODE" "$CFLAG" "$CPATH" "$SCHEME" "$SDK"
  exit 0
fi

# A package with no Xcode container builds through SwiftPM. --disable-sandbox because SwiftPM wraps
# manifest evaluation in its own seatbelt profile, which cannot nest inside the lane's
# ("sandbox_apply: Operation not permitted"); the lane's profile still confines the manifest.
if [ "$MODE" = spm ]; then
  SP="${CW_REPORT_DIR:-${TMPDIR:-/tmp}}/codeql-swift-spm"
  rm -rf "$SP"
  echo "codeql-swift-build: clean swift build of the package at $ROOT" >&2
  exec /usr/bin/xcrun swift build --disable-sandbox --scratch-path "$SP"
fi

echo "codeql-swift-build: clean build of scheme '$SCHEME' in $CPATH for $SDK" >&2

# Simulator or macOS SDK and signing off: a scan must not need a provisioning profile, and an
# unsigned build compiles exactly the same sources.
# -disable-sandbox for the compiler too: it expands macros in swift-plugin-server under its own
# seatbelt, which cannot nest either. Without it every @Observable fails with "swift-plugin-server
# produced malformed response"; a one-file @Observable typechecks under the lane's profile only with it.
# ENABLE_USER_SCRIPT_SANDBOXING=NO for the same reason: Xcode wraps each Run Script phase in
# sandbox-exec, which dies at "sandbox_apply: Operation not permitted". The phases run repository
# code either way, and still run it under the lane's profile.
# PRIVATE DERIVED DATA, and this is not tidiness. Against the default shared
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
exec "$XCODEBUILD" clean build \
  "$CFLAG" "$CPATH" -scheme "$SCHEME" "${PKG_ARGS[@]}" \
  -derivedDataPath "$DD" \
  -sdk "$SDK" -configuration Debug \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO ONLY_ACTIVE_ARCH=YES \
  ENABLE_USER_SCRIPT_SANDBOXING=NO 'OTHER_SWIFT_FLAGS=$(inherited) -disable-sandbox'
