#!/usr/bin/env bash
# Minimal reproducers for the two upstream joern defects this directory patches.
# Self-contained: writes its own fixture, asserts the observed behaviour, exits non-zero if a
# defect is NOT reproduced (so it doubles as a regression test once the patches land upstream).
#
# Measured against joern 4.0.610 (Homebrew, macOS arm64) on 2026-09-01.
set -u

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/src"
cat > "$WORK/src/vuln.c" <<'C'
#include <string.h>
#include <stdio.h>
void copy_it(int argc, char **argv) { char buf[16]; if (argc > 1) strcpy(buf, argv[1]); printf("%s\n", buf); }
int main(int argc, char **argv) { copy_it(argc, argv); return 0; }
C

fail=0
note() { printf '%-58s %s\n' "$1" "$2"; }

# ── Defect 1: the launcher discards the JVM's exit status ────────────────────────────────────
# joern-cli/src/universal/joern-scan ends with an `if [ $? -eq 2 ]` whose own status becomes the
# script's. Every failure code other than 2 is reported as 0.
cd "$WORK" || exit 1
joern-scan "$WORK/src" --overwrite --frontend-args --exclude-regex '.*/(a|b)/\.git/.*' >"$WORK/d1.txt" 2>&1
d1_exit=$?
d1_bytes=$(wc -c <"$WORK/d1.txt" | tr -d ' ')
note "defect 1: exit code on a failed scan" "exit=$d1_exit bytes=$d1_bytes"
if [ "$d1_exit" -eq 0 ] && [ "$d1_bytes" -lt 200 ]; then
  echo "  REPRODUCED: the scan produced a husk and still exited 0"
else
  echo "  not reproduced (patched launcher, or upstream fixed)"; fail=1
fi

# ── Defect 2: frontend args are interpolated unescaped into generated Scala ──────────────────
# A regex containing a backslash is not a legal Scala escape, so the generated script fails to
# compile. The control proves the flag itself is valid and the mechanism works.
rm -rf "$WORK/ws"; mkdir -p "$WORK/ws"; cd "$WORK/ws" || exit 1
joern-scan "$WORK/src" --overwrite --tags badfn --frontend-args --exclude-regex 'plainnobackslash' >"$WORK/d2a.txt" 2>&1
a_res=$(grep -c '^Result:' "$WORK/d2a.txt")
rm -rf "$WORK/ws"; mkdir -p "$WORK/ws"; cd "$WORK/ws" || exit 1
joern-scan "$WORK/src" --overwrite --tags badfn --frontend-args --exclude-regex 'has\.backslash' >"$WORK/d2b.txt" 2>&1
b_res=$(grep -c '^Result:' "$WORK/d2b.txt")
note "defect 2: regex WITHOUT backslash" "results=$a_res"
note "defect 2: regex WITH backslash" "results=$b_res"
if [ "$a_res" -gt 0 ] && [ "$b_res" -eq 0 ]; then
  echo "  REPRODUCED: the same flag works until the value contains a backslash"
else
  echo "  not reproduced (patched, or upstream fixed)"; fail=1
fi

# ── Control: the flag is valid and the mechanism is sound when c2cpg is called directly ──────
# This is what makes defect 2 a joern-scan bug rather than a c2cpg limitation.
mkdir -p "$WORK/src/node_modules/junk"
printf 'void j(char**v){char b[8];strcpy(b,v[1]);}\n' > "$WORK/src/node_modules/junk/dep.c"
c2cpg.sh "$WORK/src" --output "$WORK/direct.cpg" --exclude-regex '.*node_modules/.*' >/dev/null 2>&1
note "control: c2cpg --exclude-regex directly" "exit=$? cpg=$([ -f "$WORK/direct.cpg" ] && echo built || echo MISSING)"

exit $fail
