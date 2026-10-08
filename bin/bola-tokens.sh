#!/usr/bin/env bash
# Mint tenant tokens for the BOLA probe (Keycloak password grant). Tokens expire — re-run per probe.
# NO credentials and NO tenant identity are hardcoded: realm, client, users, passwords and the
# target all come from env, and the script REFUSES to run rather than guess one product's values
# (a wrong realm/user mints nothing; wrong tenant UUIDs probe someone else's data).
#
# env:  KC_URL   (default http://localhost:8180/auth  — 16.x; use .../<host> without /auth for 26.x)
#       KC_REALM   (required)   KC_CLIENT (required — a public client with direct-access grants)
#       BOLA_USER_A / BOLA_PASS_A  (required)   BOLA_USER_B / BOLA_PASS_B  (required, and must name a
#                                  DIFFERENT login than A — this default used to be A itself, which
#                                  silently made the cross-tenant matrix compare a tenant against
#                                  itself and fabricated a guaranteed CRITICAL finding)
#       CW_TENANT_A / CW_TENANT_B  (org UUIDs to forge as X-Tenant-Id; default = the synthetic
#                                   aaaa…/bbbb… placeholders authz-bola.mjs uses — real ids of a
#                                   real tenant belong in your shell, never in this file)
#       CW_TARGET_URL              (required for `run` — the gateway under test)
#
# usage:  KC_REALM=… KC_CLIENT=… BOLA_USER_A=… BOLA_PASS_A=… BOLA_USER_B=… BOLA_PASS_B=… \
#           CW_TARGET_URL=… bin/bola-tokens.sh run
#         eval "$(KC_REALM=… KC_CLIENT=… BOLA_USER_A=… BOLA_PASS_A=… BOLA_USER_B=… BOLA_PASS_B=… bin/bola-tokens.sh env)"
# No `set -e`, deliberately: a failed mint inside `A=$(mint …)` would abort before the checks below
# can say which tenant failed and why. Every step that can fail is checked by hand and exits 1.
set -uo pipefail
KC="${KC_URL:-http://localhost:8180/auth}"
REALM="${KC_REALM:?KC_REALM required (the Keycloak realm holding the tenant users)}"
CLIENT="${KC_CLIENT:?KC_CLIENT required (public client id with direct-access grants enabled)}"
# NO APOSTROPHES IN THESE MESSAGES. bash 3.2 — still /bin/bash on macOS, and what
# `#!/usr/bin/env bash` resolves to here — treats a single quote inside "${VAR:?message}" as an
# opening quote. The two apostrophes that used to sit in these adjacent messages BALANCED each
# other, so there was no syntax error: the assignments simply never happened, and the script died
# three lines later on `PB="${BOLA_PASS_B:-$PA}"` with a misleading "PA: unbound variable".
# This script has therefore never run on stock macOS. Keep these messages apostrophe-free.
UA="${BOLA_USER_A:?BOLA_USER_A required (the tenant A login — never hardcoded here)}"
PA="${BOLA_PASS_A:?BOLA_PASS_A required (the tenant A password — pass it per invocation, never commit it)}"
# UB/PB used to default to tenant A (UB="${BOLA_USER_B:-$UA}") whenever unset, silently making A
# and B the SAME identity. authz-bola.mjs sets AUTHED = A && B from token PRESENCE alone, then runs
# the cross-tenant matrix unconditionally once both tokens exist — with A and B the same account,
# crossAB/crossBA against its own resource always satisfies the 2xx-with-body guard, so the probe
# fabricates a CRITICAL cross-tenant-read finding against a gateway with no such defect, every time.
# Required + distinct, matching how KC_REALM/BOLA_USER_A already refuse to be guessed.
UB="${BOLA_USER_B:?BOLA_USER_B required (the tenant B login — never defaulted to tenant A: a shared identity fabricates a guaranteed CRITICAL cross-tenant-read finding in authz-bola.mjs)}"
PB="${BOLA_PASS_B:?BOLA_PASS_B required (the tenant B password — never defaulted to tenant A, pass it per invocation, never commit it)}"
[ "$UA" != "$UB" ] || { echo "BOLA_USER_B must differ from BOLA_USER_A (both are $UA) — refusing to run: identical tenants fabricate a guaranteed CRITICAL cross-tenant-read finding instead of testing anything" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
# The request body is built in a child that reads the credentials from its ENVIRONMENT and is piped
# to curl on STDIN. Two reasons, both previously violated by putting the body in `curl -d`:
#   1. curl's argv is world-readable in `ps` for the life of the request, so the tenant password
#      leaked to every local user. This file's own header is careful never to STORE a credential;
#      it was leaking one at INVOCATION.
#   2. the fields were interpolated raw into an x-www-form-urlencoded body, so a password containing
#      &, = or + silently produced a DIFFERENT credential than the operator typed (& truncates the
#      field, + decodes as a space) — and the resulting mint failure blamed the Keycloak URL path.
# urlencode() handles the escaping; the secrets never reach an argument vector. --fail-with-body
# makes curl exit non-zero on a Keycloak HTTP error while STILL passing the body through (plain
# --fail would suppress it), and the extraction step below reads error/error_description out of
# that body instead of discarding it, so a bad password or a wrong realm/client says why.
# DECLARE THE INTERPRETER, DO NOT ASSUME IT.
#
# The urlencode fix above introduced a hard dependency on python3, unguarded — and this repository
# already has one broken tool for exactly that reason: cra/poam-to-xlsx.py cannot run here because
# its interpreter dependency was assumed rather than declared, while reporting otherwise. Repeating
# the mistake one file away, in the same pass that documented it, would be its own kind of joke.
#
# Checked ONCE, up front, with a message that names what to install — not discovered halfway through
# a mint, where the failure would surface as an empty token and be blamed on Keycloak.
CW_PY="${CW_PYTHON:-python3}"
command -v "$CW_PY" >/dev/null 2>&1 || {
  echo "bola-tokens: '$CW_PY' not found, and it is required to URL-encode the form body safely." >&2
  echo "  Install python3, or set CW_PYTHON to an interpreter that has urllib." >&2
  echo "  (Encoding in shell was the alternative and it is how the credential-corruption bug" >&2
  echo "   this function exists to fix got introduced in the first place.)" >&2
  exit 1
}

mint(){ # $1=username $2=password
  BOLA_MINT_USER="$1" BOLA_MINT_PASS="$2" BOLA_MINT_CLIENT="$CLIENT" "$CW_PY" -c '
import os, urllib.parse, sys
sys.stdout.write(urllib.parse.urlencode({
    "grant_type": "password",
    "client_id":  os.environ["BOLA_MINT_CLIENT"],
    "username":   os.environ["BOLA_MINT_USER"],
    "password":   os.environ["BOLA_MINT_PASS"],
}))' \
  | curl -s --fail-with-body --max-time 8 -X POST "$KC/realms/$REALM/protocol/openid-connect/token" \
      -H "Content-Type: application/x-www-form-urlencoded" --data-binary @- \
  | "$CW_PY" -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception as e:
    sys.stderr.write("Keycloak token response was not JSON: " + str(e) + "\n")
    d = {}
tok = d.get("access_token", "")
if not tok:
    err = d.get("error_description") or d.get("error") or "no access_token in response"
    sys.stderr.write("Keycloak: " + str(err) + "\n")
sys.stdout.write(tok + "\n")
'; }
A=$(mint "$UA" "$PA"); B=$(mint "$UB" "$PB")
[ -n "$A" ] || { echo "failed to mint token for $UA at $KC/realms/$REALM (check KC_URL path: /auth for 16.x, none for 26.x)" >&2; exit 1; }
# B was previously UNCHECKED: an empty CW_BEARER_B silently downgraded the cross-tenant matrix — the
# whole point of which is comparing A against B — to the weaker unauthenticated slice, which can
# still report success. A probe that quietly tests less than it claims is the silent-green class
# this repo exists to catch, so fail loudly instead.
[ -n "$B" ] || { echo "failed to mint token for tenant B user $UB at $KC/realms/$REALM — refusing to run a cross-tenant probe with only one identity (set BOLA_USER_B/BOLA_PASS_B)" >&2; exit 1; }
# Belt-and-braces on top of the UA!=UB check above (the real guard: Keycloak access tokens carry a
# unique jti/iat, so two mints of the SAME account will almost never be byte-identical strings — this
# check exists for the degenerate case where they somehow are, not as the primary defence).
[ "$A" != "$B" ] || { echo "minted tokens for tenant A and tenant B are IDENTICAL — refusing to run the cross-tenant matrix with one identity answering for both tenants" >&2; exit 1; }
# Synthetic placeholders by default — same two ids authz-bola.mjs falls back to, so an operator who
# forgets CW_TENANT_A/B forges an id that belongs to NOBODY (visible 403/404) instead of silently
# reading a real organisation's rows.
TA="${CW_TENANT_A:-aaaaaaaa-0000-0000-0000-000000000001}"
TB="${CW_TENANT_B:-bbbbbbbb-0000-0000-0000-000000000002}"
if [ "${1:-}" = "env" ]; then
  printf 'export CW_BEARER_A=%q CW_BEARER_B=%q CW_TENANT_A=%q CW_TENANT_B=%q\n' "$A" "$B" "$TA" "$TB"; exit 0
fi
echo "minted CW_BEARER_A/B (len ${#A}/${#B}) · tenants A=$TA B=$TB" >&2
export CW_BEARER_A="$A" CW_BEARER_B="$B" CW_TENANT_A="$TA" CW_TENANT_B="$TB"
# No default target: `run` probes the gateway you name, or nothing at all.
[ "${1:-}" = "run" ] && node "$HERE/authz-bola.mjs" "${CW_TARGET_URL:?CW_TARGET_URL required for run (the gateway to probe) — export it or pass the URL to bin/authz-bola.mjs directly}"
