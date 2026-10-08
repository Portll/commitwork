#!/usr/bin/env bash
# Re-apply the local joern repairs. Idempotent; safe to run repeatedly.
#
# WHY THIS EXISTS AS A SCRIPT RATHER THAN A ONE-OFF: every change here lives inside the Homebrew
# Cellar, so `brew upgrade joern` silently reverts all of it — and the failure mode afterwards is
# not an error, it is a scan that finds nothing and exits 0. Run this after any joern upgrade.
#
# Two of the three are workarounds for defects patched upstream in ../patches/; the astgen one is
# a packaging-layout mismatch and is repaired only here.
set -euo pipefail

PREFIX="${JOERN_PREFIX:-$(brew --prefix joern 2>/dev/null || echo /opt/homebrew/opt/joern)}"
[ -d "$PREFIX" ] || { echo "joern not found at $PREFIX (set JOERN_PREFIX)"; exit 1; }
echo "joern prefix: $PREFIX"

# ── 1. astgen binaries are shipped, just not where AstGenRunner looks ─────────────────────────
# It resolves <root>/bin/astgen/<binary>, but the distribution places them under
# libexec/frontends/<frontend>/bin/astgen/. Result: gosrc2cpg, rust2cpg and swiftsrc2cpg fail with
# "Local <x> binary not found ... or is not executable", and joern-scan reports that as exit 0.
# Symlinked rather than copied so an upgrade that DOES move them is not shadowed by a stale copy.
mkdir -p "$PREFIX/bin/astgen"
linked=0
while IFS= read -r bin; do
  ln -sfn "$bin" "$PREFIX/bin/astgen/$(basename "$bin")"
  linked=$((linked + 1))
done < <(find "$PREFIX/libexec/frontends" -type f -path '*/bin/astgen/*' 2>/dev/null)
echo "  astgen: linked $linked binary/binaries into bin/astgen/"
ls -1 "$PREFIX/bin/astgen" 2>/dev/null | sed 's/^/    /'

# NOT FIXABLE HERE: csharpsrc2cpg's dotnetastgen-macos is absent from the distribution entirely
# (its bin/astgen/ ships empty), so C# cannot be parsed on this platform at all. jssrc2cpg's is
# likewise empty; it falls back to the npm `astgen` on PATH, which produced a 6-node CPG from a
# real source file here — present but not usefully working.
for fe in csharpsrc2cpg jssrc2cpg; do
  d="$PREFIX/libexec/frontends/$fe/bin/astgen"
  [ -d "$d" ] && [ -z "$(ls -A "$d" 2>/dev/null)" ] && echo "  NOTE: $fe ships an EMPTY astgen dir — unfixable locally"
done

# ── 1b. php-parser is shipped, and Php2Cpg looks for it one directory up ──────────────────────
# Php2Cpg resolves <prefix>/bin/php-parser/php-parser.php; the distribution ships it under
# libexec/frontends/php2cpg/bin/php-parser/. Without the link php2cpg exits 1 with "Invalid path for
# PhpParserBin", the scan never runs, and before patch 01 that was another exit 0. Same class as the
# astgen mismatch above, measured 2026-09-18 on 4.0.620.
PHPP="$(find "$PREFIX/libexec/frontends/php2cpg" -type d -name php-parser 2>/dev/null | head -1)"
if [ -n "$PHPP" ]; then
  mkdir -p "$PREFIX/bin"
  ln -sfn "$PHPP" "$PREFIX/bin/php-parser"
  echo "  php-parser: linked $PREFIX/bin/php-parser -> $PHPP"
else
  echo "  NOTE: no php-parser directory under libexec/frontends/php2cpg — PHP cannot be parsed on this box"
fi

# ── 2. the launcher discards the JVM's exit status (upstream patch 01) ────────────────────────
LAUNCHER="$PREFIX/libexec/joern-scan"
if grep -q 'exit \$status' "$LAUNCHER" 2>/dev/null; then
  echo "  launcher: already reports the real exit code"
else
  cp "$LAUNCHER" "$LAUNCHER.cw-backup"
  python3 - "$LAUNCHER" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace('2> /tmp/joern-scan-log.txt\nif [ $? -eq 2 ]; then',
              '2> /tmp/joern-scan-log.txt\nstatus=$?\nif [ $status -eq 2 ]; then', 1)
s = s.rstrip('\n')
assert s.endswith('fi'), 'launcher does not end in the retry `fi` — layout changed, refusing to patch'
s = s[:-2] + '  status=$?\nfi\nexit $status\n'
open(p, 'w').write(s)
PY
  echo "  launcher: patched (backup at $(basename "$LAUNCHER").cw-backup)"
fi

# ── 3. verify, rather than announce ───────────────────────────────────────────────────────────
# A repair that is not measured is a claim. Both assertions below fail loudly if the fix did not
# take, because the symptom of a silent revert is a green scan that read nothing.
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/src"
printf '#include <string.h>\nvoid f(int c,char**v){char b[8];if(c>1)strcpy(b,v[1]);}\n' > "$tmp/src/v.c"
# `cmd || true` would capture the status of `true`, not of cmd — which made this check report
# exit=0 for a run that had genuinely failed. set +e around the calls instead, so $? is the
# subshell's own status.
set +e
( cd "$tmp" && joern-scan "$tmp/src" --overwrite --tags badfn >"$tmp/ok.txt" 2>&1 )
ok_exit=$?
ok_res=$(grep -c '^Result:' "$tmp/ok.txt")
# The failure must not depend on a defect: the old fixture failed through patch 02's escaping bug,
# so 4.0.640 (which fixes it) ran it as a valid scan and this check called a correct launcher broken.
( cd "$tmp" && joern-scan "$tmp/src" --overwrite --language nosuchlang >"$tmp/bad.txt" 2>&1 )
bad_exit=$?
printf '<?php $x = $_GET["c"]; system($x);\n' > "$tmp/src/v.php"
( cd "$tmp" && joern-scan "$tmp/src" --overwrite --language php --tags remote-code-execution >"$tmp/php.txt" 2>&1 )
php_exit=$?
set -e

echo
echo "verification:"
printf '  healthy scan   exit=%s results=%s  %s\n' "$ok_exit" "$ok_res" \
  "$([ "$ok_res" -gt 0 ] && echo OK || echo 'FAIL — the C queries are not firing')"
printf '  failing scan   exit=%s          %s\n' "$bad_exit" \
  "$([ "$bad_exit" -ne 0 ] && echo OK || echo 'FAIL — the launcher is still reporting 0 on failure')"
printf '  php frontend   exit=%s          %s\n' "$php_exit" \
  "$([ "$php_exit" -eq 0 ] && echo OK || echo 'FAIL — php2cpg still cannot initialise its parser')"
[ "$ok_res" -gt 0 ] && [ "$bad_exit" -ne 0 ] && [ "$php_exit" -eq 0 ]
