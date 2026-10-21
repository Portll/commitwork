#!/usr/bin/env bash
# OpenSSF Scorecard on THIS repo's github origin — supply-chain posture (branch protection, pinned
# dependencies, token permissions, dangerous workflows, signed releases, fuzzing, SAST...).
#
# WHY THIS EXISTS ALONGSIDE cspm-github. Prowler answers "is the setting on?" and gets FAIL when the
# GitHub API withholds the setting from a non-admin token — on the 100randomrepos corpus that read
# as 100/100 repos failing "secret scanning enabled", which is not a finding, it is a permission
# denial wearing one. Scorecard is built for the OUTSIDE view: it scores what a non-admin can
# actually see, and it has a NATIVE inconclusive value (score -1) for what it cannot. That -1 is the
# whole reason this lane is here — it is the only posture tool in the roster that can say "I could
# not tell" in its own output format instead of guessing.
#
# explicit uncertainty. A -1 must never be published as a failing control. The extractor maps score -1 to
# UNDETERMINED and keeps it out of the severity counts; only a real 0-9 becomes a finding.
#
# usage:  SCORECARD_GITHUB_TOKEN=ghp_… bin/scorecard-scan.sh [owner/repo]
set -uo pipefail

REPO="${1:-${CW_SCORECARD_REPO:-}}"
if [ -z "$REPO" ]; then   # derive from the checkout we are standing in (ssh or https remote)
  origin="$(git remote get-url origin 2>/dev/null || true)"
  case "$origin" in *github.com[:/]*) REPO="$(printf '%s' "$origin" | sed -E 's#^.*github\.com[:/]##; s#/+$##; s#\.git$##')" ;; esac
  case "$REPO" in */*/*) REPO="" ;; */*) ;; *) REPO="" ;; esac   # owner/repo, exactly two segments
fi
# A target from argv or CW_SCORECARD_REPO skips the owner/repo validation above, so it must not be
# interpolated into a JSON string raw. Pure bash — no jq dependency, same as bin/cspm-github.sh.
json_escape(){ local s=$1; s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\r'/\\r}; s=${s//$'\t'/\\t}; printf '%s' "$s"; }
REPO_JSON="$(json_escape "$REPO")"

OUT="${CW_REPORT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/reports/runtime-latest}"; mkdir -p "$OUT"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
JSON="$OUT/scorecard.json"

skip(){ printf '{"tool":"scorecard","generatedAt":"%s","repo":"%s","ran":false,"skipped":true,"reason":"%s"}\n' \
  "$TS" "$REPO_JSON" "$(json_escape "$1")" > "$JSON"; echo "scorecard skipped: $1"; exit 0; }

[ -n "$REPO" ] || skip "no target repo — pass owner/repo, set CW_SCORECARD_REPO, or run inside a checkout with a github origin (no default: scoring someone else's repo under your name is worse than not scoring)"
command -v scorecard >/dev/null 2>&1 || skip "scorecard not installed (brew install scorecard)"

# ── CREDENTIAL ──────────────────────────────────────────────────────────────────────────────────
# Scorecard needs a token for the API-backed checks; without one it runs the static checks and
# silently drops Branch-Protection, which is precisely the kind of quiet narrowing this project
# refuses. So a missing credential is a visible SKIP, not a reduced-coverage pass.
#
# Same shape as bin/cspm-github.sh and for the same reason: a dedicated var so an automated run
# cannot broad-scan on an ambient credential, with a `gh` fallback for an operator at their own
# machine that is REFUSED whenever $CI is set. Which credential was used travels into the report —
# a posture score that cannot say who it was scored as is a score you cannot act on.
CRED=""
if [ -n "${SCORECARD_GITHUB_TOKEN:-}" ]; then
  CRED="dedicated"
elif [ -n "${CI:-}" ]; then
  skip "no SCORECARD_GITHUB_TOKEN and \$CI is set — the gh fallback is refused in automation on purpose; pass an explicit dedicated token"
elif [ -n "${GH_TOKEN:-}" ]; then
  # The runner resolves the gh session outside the host sandbox, which denies the keychain gh reads.
  SCORECARD_GITHUB_TOKEN="$GH_TOKEN"
  CRED="gh-session"
elif command -v gh >/dev/null 2>&1 && SCORECARD_GITHUB_TOKEN="$(gh auth token 2>/dev/null)" && [ -n "$SCORECARD_GITHUB_TOKEN" ]; then
  CRED="gh-session"
else
  skip "no credential — set SCORECARD_GITHUB_TOKEN or run \`gh auth login\` (the API-backed checks, Branch-Protection among them, cannot run tokenless and a partial run must not read as a full one)"
fi
export GITHUB_AUTH_TOKEN="$SCORECARD_GITHUB_TOKEN"

RAW="$OUT/scorecard.raw.json"
scorecard --repo="github.com/$REPO" --format=json --show-details > "$RAW" 2>"$OUT/scorecard.log"
rc=$?
# rc is consulted only to decide whether a scan happened at all. Scorecard exits 0 on a completed
# run whatever the scores are; a non-zero exit with no parseable output is a failed run, and a
# failed run is NOT a clean repo.
if [ "$rc" -ne 0 ] && [ ! -s "$RAW" ]; then
  skip "scorecard exited $rc and wrote nothing — see scorecard.log (not a clean scan)"
fi
[ -s "$RAW" ] || skip "scorecard exited $rc but $RAW is empty — not a clean scan"

# The summary the roster parses. `checks` stays in the raw file; this is the receipt that proves a
# run happened and carries the counts, including the one that matters most: how many checks the
# tool declined to score. inconclusive > 0 with everything else green is NOT a green repo.
node - "$RAW" "$JSON" "$TS" "$REPO" "$CRED" <<'NODE'
const fs = require('node:fs');
const [raw, dest, ts, repo, credential] = process.argv.slice(2);
let j;
try { j = JSON.parse(fs.readFileSync(raw, 'utf8')); }
catch (e) {
  // An unparseable artifact is a husk, never a clean scan.
  fs.writeFileSync(dest, JSON.stringify({ tool: 'scorecard', generatedAt: ts, repo, ran: false, skipped: true,
    reason: `scorecard wrote output that does not parse as JSON — ${String(e.message).slice(0, 160)}` }) + '\n');
  process.exit(0);
}
const checks = Array.isArray(j.checks) ? j.checks : [];
if (!checks.length) {
  fs.writeFileSync(dest, JSON.stringify({ tool: 'scorecard', generatedAt: ts, repo, ran: false, skipped: true,
    reason: 'scorecard returned no checks — a checkless result is a failed run, not a repo with nothing to report' }) + '\n');
  process.exit(0);
}
// -1 is scorecard's own "could not determine". It is counted and reported, never scored.
const inconclusive = checks.filter((c) => c.score === -1);
const scored = checks.filter((c) => typeof c.score === 'number' && c.score >= 0);
fs.writeFileSync(dest, JSON.stringify({
  tool: 'scorecard',
  generatedAt: ts,
  repo,
  ran: true,
  credential,
  scorecardVersion: (j.scorecard && j.scorecard.version) || null,
  aggregateScore: typeof j.score === 'number' ? j.score : null,
  counts: {
    checks: checks.length,
    scored: scored.length,
    inconclusive: inconclusive.length,
    passing: scored.filter((c) => c.score === 10).length,
    failing: scored.filter((c) => c.score < 10).length,
  },
  inconclusiveChecks: inconclusive.map((c) => c.name).sort(),
  detail: 'scorecard.raw.json',
}, null, 2) + '\n');
NODE

echo "scorecard done -> $OUT (repo=$REPO cred=$CRED)"
