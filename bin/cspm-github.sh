#!/usr/bin/env bash
# CSPM without AWS: prowler's GitHub provider on THIS repo (posture: branch protection, 2FA,
# secret-scanning, actions perms...). GHA-safe: self-gates to exit 0 if prowler/token absent.
# SECURITY: token is env-only (never argv), from a DEDICATED var — NOT the ambient GITHUB_TOKEN,
# so a CI run can't silently broad-scan the org.
# TARGET: owner/repo comes from argv, else $CW_CSPM_REPO, else `git remote get-url origin` in the
# working dir. There is deliberately NO hardcoded fallback: a bare invocation used to posture-scan
# one specific repo, so anyone else's run reported a foreign repo's posture under their name.
# usage:  PROWLER_GITHUB_TOKEN=ghp_… bin/cspm-github.sh [owner/repo]
# No `set -e`, deliberately: prowler's exit code is a RESULT (3 = scan completed with failing
# controls) and is read into rc below. Every other failure is checked by hand and routed to skip().
set -uo pipefail
REPO="${1:-${CW_CSPM_REPO:-}}"
if [ -z "$REPO" ]; then   # derive from the checkout we are standing in (ssh or https remote)
  origin="$(git remote get-url origin 2>/dev/null || true)"
  # only a github.com remote is scannable by prowler's github provider; anything else stays empty
  case "$origin" in *github.com[:/]*) REPO="$(printf '%s' "$origin" | sed -E 's#^.*github\.com[:/]##; s#/+$##; s#\.git$##')" ;; esac
  case "$REPO" in */*/*) REPO="" ;; */*) ;; *) REPO="" ;; esac   # owner/repo, exactly two segments
fi
# json_escape: $REPO can arrive verbatim from argv/$CW_CSPM_REPO with NONE of the owner/repo
# validation the git-derivation branch above applies, so an operator-supplied target containing a
# quote or backslash must not be interpolated into a JSON string field raw — it would produce a
# malformed report. Pure bash parameter expansion: no new dependency (jq is not already one of
# this script's — see the tally below for why it stays that way).
json_escape(){ local s=$1; s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\r'/\\r}; s=${s//$'\t'/\\t}; printf '%s' "$s"; }
REPO_JSON="$(json_escape "$REPO")"
# Per-area reports: the runner sets CW_REPORT_DIR per repo. The old fixed reports/runtime-latest is
# a single shared dir, so every project's panel read the LAST project's posture. Fall back to it
# only when the var is unset (manual invocation), preserving the old path.
OUT="${CW_REPORT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/reports/runtime-latest}"
# skip() writes into $OUT, so an unwritable report dir cannot be reported there; fail loudly instead.
mkdir -p "$OUT" || { echo "cspm-github: cannot create report dir $OUT" >&2; exit 2; }
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
skip(){ printf '{"tool":"cspm-github","generatedAt":"%s","repo":"%s","ran":false,"skipped":true,"reason":"%s"}\n' "$TS" "$REPO_JSON" "$(json_escape "$1")" > "$OUT/cspm-github.json"; echo "cspm-github skipped: $1"; exit 0; }

[ -n "$REPO" ] || skip "no target repo — pass owner/repo, set CW_CSPM_REPO, or run inside a checkout with a github origin (no default: scanning another org's repo is worse than not scanning)"
command -v prowler >/dev/null 2>&1 || skip "prowler not installed (pipx install prowler)"

# ── CREDENTIAL, in order of explicitness ────────────────────────────────────────────────────────
# Repo/org SETTINGS (branch protection, org 2FA, secret-scanning push protection, Dependabot) exist
# only behind the GitHub API — no tool reads them without auth, so this lane cannot be made
# tokenless the way the workflow lane can (see the actions-zizmor check, which is fully static).
# What CAN go is the requirement to MINT AND STORE A DEDICATED PAT just to get any coverage at all:
# on a workstation `gh` is already authenticated, and `gh auth token` hands back that existing
# session from the keyring.
#
# THE ORIGINAL SECURITY PROPERTY IS PRESERVED. The dedicated var exists so an automated run cannot
# silently broad-scan the org on an ambient credential, so the gh fallback is refused whenever $CI
# is set: in CI you must pass PROWLER_GITHUB_TOKEN explicitly or the check skips visibly. The
# fallback is a convenience for an operator at their own machine, not a way for a pipeline to
# acquire scope nobody granted it.
#
# Which credential was used travels into the report (`credential`), because "scanned as the
# dedicated auditor token" and "scanned as whoever was logged into gh" are different provenance and
# a posture result that cannot say which is a result you cannot act on.
CRED=""
if [ -n "${PROWLER_GITHUB_TOKEN:-}" ]; then
  CRED="dedicated"
elif [ -n "${CI:-}" ]; then
  skip "PROWLER_GITHUB_TOKEN unset and \$CI is set — the gh-session fallback is deliberately refused in CI, so an automated run cannot scan on an ambient credential"
elif [ -n "${GH_TOKEN:-}" ]; then
  # The runner resolves the gh session outside the host sandbox, which denies the keychain gh reads.
  PROWLER_GITHUB_TOKEN="$GH_TOKEN"
  CRED="gh-session"
elif command -v gh >/dev/null 2>&1 && PROWLER_GITHUB_TOKEN="$(gh auth token 2>/dev/null)" && [ -n "$PROWLER_GITHUB_TOKEN" ]; then
  CRED="gh-session"
else
  skip "no GitHub credential — set PROWLER_GITHUB_TOKEN (dedicated), or run \`gh auth login\` so the existing session can be used"
fi

OCSF="$OUT/cspm-github.ocsf.json"
rm -f "$OCSF"   # a run that fails before prowler writes anything must not let a STALE prior-run
                # artifact survive to be re-counted below under THIS run's fresh generatedAt — a
                # stale-but-present file would otherwise slip past the missing/empty check below
                # and report an old scan's numbers as current posture with a new timestamp.
export GITHUB_PERSONAL_ACCESS_TOKEN="$PROWLER_GITHUB_TOKEN"   # env only; never on argv/in logs
prowler github --repository "$REPO" -M json-ocsf --output-directory "$OUT" --output-filename cspm-github >"$OUT/cspm-github.log" 2>&1
rc=$?
unset GITHUB_PERSONAL_ACCESS_TOKEN
# A non-zero exit (expired token, rate limit, API error) or a missing/empty artifact must never
# reach the ran:true line below with pass=0/fail=0 — that reports a failed scan as a completed,
# clean one. Route both through skip() so the panel sees {ran:false,skipped:true,reason} instead.
# EXIT 3 IS A RESULT, NOT A FAILURE. prowler exits 3 when the scan completed and some checks
# FAILED — the ordinary outcome for any repo with imperfect posture. Treating every non-zero code
# as "not a clean scan" therefore discarded exactly the runs that had something to report: measured
# 2026-08-02 against Portll/memory-layer, prowler wrote PASS=2 FAIL=16 and exited 3, and this line threw the
# whole result away as an error. The inversion is the one this file guards against in the other
# direction — a scan that found 16 failing controls was filed as a scan that did not happen.
case "$rc" in
  0|3) ;;
  *) skip "prowler exited $rc — see $OUT/cspm-github.log (not a clean scan; 0 = all passed, 3 = completed with failing checks, anything else is an error)" ;;
esac
[ -s "$OCSF" ] || skip "prowler exited 0 but $OCSF is missing or empty — not a clean scan"
# summarise (findings live in the ocsf json); redact: never write the token. Exactly ONE named
# file, never a glob: glob-matching cspm-github*.json also catches this script's OWN prior-run
# output (cspm-github.json), and grep prefixes each matched file's count with its filename once
# more than one file matches — interpolating that "path:N" string into a JSON NUMBER field below
# produced invalid JSON on every run after the first. -o (not -c, and not the two combined) + wc -l
# counts every OCCURRENCE: measured on this box's /usr/bin/grep, `-oc` counts matching LINES, so two
# matches sharing one line (any compact/JSONL OCSF output, not just prowler's pretty-printed default)
# silently undercounts.
pass=$(( $(grep -o '"status_code": *"PASS"' "$OCSF" 2>/dev/null | wc -l) ))
fail=$(( $(grep -o '"status_code": *"FAIL"' "$OCSF" 2>/dev/null | wc -l) ))
manual=$(( $(grep -o '"status_code": *"MANUAL"' "$OCSF" 2>/dev/null | wc -l) ))

# ── WAS THE EVIDENCE EVEN VISIBLE? ──────────────────────────────────────────────────────────────
# Several prowler controls read `security_and_analysis` off the repo object. GitHub returns that
# field only to sufficiently-privileged tokens, and omits it ENTIRELY otherwise — no null, no error,
# the key is simply not in the response. Prowler cannot tell an omitted field from a disabled
# setting, so it asserts FAIL for both, with a definite message: "Repository X does not have secret
# scanning enabled."
#
# Measured across this fleet's 614 OCSF artifacts on 2026-08-22: that one control is 596 FAIL / 18
# PASS, and MANUAL — prowler's actual "could not determine" status — appears 102 times on a
# different control entirely. So the fix is NOT "map MANUAL to undetermined"; that would move 102
# rows on an unrelated control and leave 596 unfalsifiable ones asserting a fact nobody checked.
#
# The probe is the honest alternative: ask GitHub, with the SAME credential prowler used, whether
# the field comes back at all. If it does not, every control that reads it is UNDETERMINED here —
# not passing, not failing. Confirmed the same day against Portll/commitwork, a PRIVATE repo where
# this operator holds admin: the key was still absent, so this is not merely a third-party-repo
# problem and cannot be inferred from ownership.
evidence='"unknown"'
if command -v gh >/dev/null 2>&1; then
  if gh api "repos/$REPO" >"$OUT/.cspm-repo.json" 2>/dev/null; then
    if grep -q '"security_and_analysis"' "$OUT/.cspm-repo.json" 2>/dev/null; then evidence='"visible"'; else evidence='"absent"'; fi
  fi
  rm -f "$OUT/.cspm-repo.json"
fi

printf '{"tool":"cspm-github","generatedAt":"%s","repo":"%s","ran":true,"credential":"%s","pass":%s,"fail":%s,"manual":%s,"securityAndAnalysisEvidence":%s,"detail":"cspm-github.ocsf.json"}\n' \
  "$TS" "$REPO_JSON" "$CRED" "${pass:-0}" "${fail:-0}" "${manual:-0}" "$evidence" > "$OUT/cspm-github.json"
echo "cspm-github done -> $OUT (pass=${pass:-0} fail=${fail:-0} manual=${manual:-0} evidence=${evidence})"
