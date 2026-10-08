#!/usr/bin/env bash
# OWASP dep-scan — dependency reachability, in a sandbox, on somebody else's source.
#
# WHY A SANDBOX IS NOT OPTIONAL HERE. This project's declared posture is "untrusted by default":
# a repo-local manifest never executes without --trust-repo-manifest. Dependency resolution breaks
# that rule quietly — `gradle dependencies` evaluates build.gradle, pip resolution of an sdist runs
# setup.py, and cdxgen shells out to whichever package manager the tree declares. Run on the host,
# against a corpus of 100 arbitrary GitHub repos that already contains 26 OSV-confirmed malicious
# packages, that is arbitrary code execution as the operator on a box holding the login keychain
# and every fleet git remote.
#
# TWO PHASES, AND THE SPLIT IS THE WHOLE POINT.
#   warm   network ON, NO source mounted. Pulls the vulnerability DB (an OCI artifact) into a named
#          volume. Nothing from the scanned repo is present in this container at all.
#   scan   --network none, source mounted READ-ONLY, VDB volume read-only. The container that can
#          see the repo cannot reach the network; the container that could reach the network never
#          saw the repo. Neither half can both read the source and phone home.
#
# THE OFFLINE PHASE COSTS COVERAGE, AND SAYS SO. With --network none, cdxgen cannot resolve
# transitive versions from a registry and falls back to manifest analysis. That is a REDUCED scan,
# not a full one, and `coverage: "reduced"` travels in the report — an unstated narrowing is the
# same false-clean this project exists to refuse. Set CW_DEPSCAN_ALLOW_NET=1 to trade the isolation
# back for the resolution, deliberately and visibly.
#
# usage:  bin/depscan-scan.sh [srcDir]
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib/docker-config.sh"

CW_ROOT="${CW_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SRC="${1:-${CW_DEPSCAN_SRC:-$PWD}}"
IMAGE="${CW_DEPSCAN_IMAGE:-ghcr.io/owasp-dep-scan/dep-scan:latest}"
VDB_VOL="${CW_DEPSCAN_VDB_VOL:-cw-depscan-vdb}"
REACH="${CW_DEPSCAN_REACHABILITY:-SemanticReachability}"
TIMEOUT="${CW_DEPSCAN_TIMEOUT:-1800}"
# The runner names every container a check starts so a timed-out lane can remove them by name:
# `docker run` is a client, and killing it leaves the container scanning on the daemon.
CNAME="${CW_CONTAINER_NAME:-cw-cli-repo-deps-reachability}"

OUT="${CW_REPORT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/reports/runtime-latest}"; mkdir -p "$OUT"
TS="${CW_NOW:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
JSON="$OUT/depscan.json"

json_escape(){ local s=$1; s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\r'/\\r}; s=${s//$'\t'/\\t}; printf '%s' "$s"; }
skip(){ printf '{"tool":"depscan","generatedAt":"%s","ran":false,"skipped":true,"reason":"%s"}\n' \
  "$TS" "$(json_escape "$1")" > "$JSON"; echo "depscan skipped: $1"; exit 0; }

[ -d "$SRC" ] || skip "source directory does not exist: $SRC"
command -v docker >/dev/null 2>&1 || skip "docker not installed — this lane REFUSES to run dep-scan on the host: resolving an untrusted repo's dependencies executes that repo's build logic, and the sandbox is the only thing standing between that and the operator's keychain"
timeout 10 docker info >/dev/null 2>&1 || skip "docker is installed but not running — a scan that cannot be sandboxed does not run at all here"
timeout 20 docker image inspect "$IMAGE" >/dev/null 2>&1 || skip "image $IMAGE is not pulled (timeout 20 docker pull $IMAGE) — pulling it silently inside a scan would hide a multi-GB download in a security lane"

SRC_ABS="$(cd "$SRC" && pwd)"
RAW="$OUT/depscan-raw"; mkdir -p "$RAW"; chmod 777 "$RAW" 2>/dev/null || true

# ── PHASE 1: warm the vulnerability DB, with NO source in the container ─────────────────────────
timeout 30 docker volume inspect "$VDB_VOL" >/dev/null 2>&1 || timeout 30 docker volume create "$VDB_VOL" >/dev/null 2>&1 || skip "could not create the vdb volume $VDB_VOL"
# The image runs as uid 1000; a fresh named volume is root-owned and the VDB pull fails on it with
# EACCES. Observed directly the first time this ran, as `PermissionError: '/vdb/vdb.meta'`.
timeout 300 docker run --rm -v "$VDB_VOL":/vdb alpine chown -R 1000:1000 /vdb >/dev/null 2>&1 || true

# FRESHNESS IS TWO DATES, AND THEY ARE NOT INTERCHANGEABLE. vdb.meta.created_utc is when UPSTREAM
# built the database; /vdb/.cw-pulled-at is when THIS HOST last pulled it. Re-warm on the pull age
# (a DB upstream built nine days ago is not stale the day it is pulled); publish the build date,
# because that is the bound on which advisories a finding — or an absence — can reflect.
# Before this, "present" meant "warm" forever: the volume was pulled 2026-08-22 and nothing re-read it.
MAX_AGE_DAYS="${CW_DEPSCAN_VDB_MAX_AGE_DAYS:-7}"
vdb_read(){ timeout 60 docker run --rm -v "$VDB_VOL":/vdb:ro alpine sh -c "cat /vdb/$1 2>/dev/null"; }
vdb_present(){ timeout 60 docker run --rm -v "$VDB_VOL":/vdb:ro alpine sh -c '[ -s /vdb/data.vdb6 ] || [ -s /vdb/vdb.meta ] || ls /vdb/*.vdb* >/dev/null 2>&1'; }
PULLED_AT="$(vdb_read .cw-pulled-at | tr -d '[:space:]')"
VDB_AGE_DAYS="$(node -e 'const p=process.argv[1], now=Date.parse(process.argv[2]); const t=Date.parse(p); process.stdout.write(Number.isFinite(t)&&Number.isFinite(now)?String(Math.floor((now-t)/86400000)):"")' "$PULLED_AT" "$TS")"
VDB_PRESENT=0; vdb_present && VDB_PRESENT=1
VDB_STALE=0
if [ "$VDB_PRESENT" = "1" ]; then
  if [ -z "$VDB_AGE_DAYS" ] || [ "$VDB_AGE_DAYS" -gt "$MAX_AGE_DAYS" ]; then VDB_STALE=1; fi
fi

# One warm at a time per volume, host-wide: two areas sweeping concurrently would otherwise both
# decide the DB is stale and both write /vdb at once. mkdir is the atomic primitive macOS has
# (no flock binary); a lock whose pid is dead is stale and taken over.
LOCK="${TMPDIR:-/tmp}/cw-depscan-warm-${VDB_VOL}.lock"
lock_warm(){
  local waited=0
  while ! mkdir "$LOCK" 2>/dev/null; do
    local holder; holder="$(cat "$LOCK/pid" 2>/dev/null)"
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then rm -rf "$LOCK"; continue; fi
    [ "$waited" -ge "$TIMEOUT" ] && return 1
    sleep 5; waited=$((waited+5))
  done
  echo $$ > "$LOCK/pid"; return 0
}
unlock_warm(){ rm -rf "$LOCK"; }

# A stale DB is SHELVED before the download, not left in place: depscan-vdb skips a present
# same-variant DB, and a pulledAt stamped over a skipped download would be a false freshness claim.
# Shelved files come back if the download fails, so a dead registry degrades to "stale, said so".
# THE VOLUME HELPERS BELOW ARE DELIBERATELY NOT SANDBOXED, reviewed 2026-08-26 when the two real
# phases were wired to bin/lib/sandbox.mjs. They run `alpine` with `cat`, `ls`, `mv` and `chown`
# over a docker-managed named volume. No repo source is mounted into any of them, nothing from the
# scanned tree is present, and none of them executes anything the corpus supplied — the untrusted
# input never reaches them. A scanner posture here would express nothing true and would suggest
# these were the risk, which draws attention away from the two phases that are.
vdb_shelve(){ timeout 300 docker run --rm -v "$VDB_VOL":/vdb --user 1000:1000 alpine sh -c 'mkdir -p /vdb/.prev && for f in /vdb/*.vdb* /vdb/vdb.meta /vdb/.depscan-vdb-image; do [ -e "$f" ] && mv "$f" /vdb/.prev/; done; true'; }
vdb_unshelve(){ timeout 300 docker run --rm -v "$VDB_VOL":/vdb --user 1000:1000 alpine sh -c 'if [ -d /vdb/.prev ]; then mv /vdb/.prev/* /vdb/.prev/.[!.]* /vdb/ 2>/dev/null; rmdir /vdb/.prev 2>/dev/null; fi; true'; }
vdb_drop_shelf(){ timeout 300 docker run --rm -v "$VDB_VOL":/vdb --user 1000:1000 alpine sh -c 'rm -rf /vdb/.prev; true'; }
vdb_download(){
  # `fetch` is the posture whose defining rule is the one this phase already obeys: egress is open,
  # therefore NO repo source may be mounted. Asking bin/sandbox.mjs for it means that pairing is
  # enforced by the shared definition rather than by this function continuing to be written
  # correctly — buildSandbox REFUSES a --mount-source under `fetch`.
  local sbx
  sbx="$(node "$CW_ROOT/bin/sandbox.mjs" --posture fetch --name "${CNAME}-vdb" \
    --mount "$VDB_VOL:/vdb:rw" --env VDB_HOME=/vdb)" || return 1
  timeout "$TIMEOUT" docker run $sbx \
    "$IMAGE" depscan-vdb download --scope "${CW_DEPSCAN_VDB_SCOPE:-app}" --time "${CW_DEPSCAN_VDB_TIME:-2y}" \
    > "$OUT/depscan-vdb.log" 2>&1
  vdb_present
}

VDB_WARM=0; VDB_NOTE=""
if [ "$VDB_PRESENT" = "1" ] && [ "$VDB_STALE" = "0" ]; then
  VDB_WARM=1
else
  if lock_warm; then
    # re-check under the lock: the previous holder may have just warmed it
    PULLED_AT2="$(vdb_read .cw-pulled-at | tr -d '[:space:]')"
    if [ "$VDB_STALE" = "1" ] && [ -n "$PULLED_AT2" ] && [ "$PULLED_AT2" != "$PULLED_AT" ]; then
      VDB_WARM=1; VDB_STALE=0; PULLED_AT="$PULLED_AT2"
    else
      echo "depscan: warming the vulnerability DB (network on, no source mounted; $([ "$VDB_PRESENT" = 1 ] && echo "present, pulled ${PULLED_AT:-never}, > ${MAX_AGE_DAYS}d" || echo absent))…"
      [ "$VDB_PRESENT" = "1" ] && vdb_shelve
      if vdb_download; then
        vdb_drop_shelf
        docker run --rm -v "$VDB_VOL":/vdb --user 1000:1000 alpine sh -c "printf '%s\n' '$TS' > /vdb/.cw-pulled-at" && PULLED_AT="$TS"
        VDB_WARM=1; VDB_STALE=0
      elif [ "$VDB_PRESENT" = "1" ]; then
        # the download failed but a stale DB exists: restore it, scan with it, and SAY so
        vdb_unshelve
        VDB_WARM=1; VDB_NOTE="re-warm failed (see depscan-vdb.log); scanned against the DB pulled ${PULLED_AT:-at an unrecorded time}"
      fi
    fi
    unlock_warm
  else
    [ "$VDB_PRESENT" = "1" ] && { VDB_WARM=1; VDB_NOTE="another warm held the lock for ${TIMEOUT}s; scanned against the DB pulled ${PULLED_AT:-at an unrecorded time}"; }
  fi
fi
[ "$VDB_WARM" = "1" ] || skip "the vulnerability database could not be warmed — see depscan-vdb.log. An unwarmed VDB yields a scan with nothing to match against, which is a VOID, not a repo with no vulnerabilities"
VDB_IMAGE="$(vdb_read .depscan-vdb-image | tr -d '[:space:]')"
VDB_BUILT_AT="$(vdb_read vdb.meta | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).created_utc||""))}catch{process.stdout.write("")}})')"

# ── PHASE 2: scan, network severed ──────────────────────────────────────────────────────────────
# The isolation comes from bin/lib/sandbox.mjs via bin/sandbox.mjs, not from flags written here.
# This lane's hand-rolled flags were the STRONGEST of the five that had drifted apart, which is
# exactly why it is wired: the point of one definition is that the strict lanes and the lax ones
# are read side by side, and a lane that keeps its own copy because its copy is good is how the
# other four stayed bad. `analyse` is byte-for-byte what this lane already asked for.
ALLOW_NET_FLAG=""; COVERAGE="reduced"
if [ -n "${CW_DEPSCAN_ALLOW_NET:-}" ]; then ALLOW_NET_FLAG="--allow-network"; COVERAGE="full"
  echo "depscan: CW_DEPSCAN_ALLOW_NET is set — the scan container can reach the network AND read the source. This is the un-sandboxed mode."
fi
# fix: dep-scan re-downloads any DB BUILT more than VDB_AGE_HOURS (default 48) ago, and this container
# cannot download: the network is severed and /vdb is read-only. Measured 2026-09-30: with a DB
# pulled 2026-09-25, fresh by the 7-day pull age above and 4.6 days past its build, every scan
# crashed at ghcr.io name resolution. Freshness is the warm phase's decision; the receipt publishes builtAt.
SCAN_SBX="$(node "$CW_ROOT/bin/sandbox.mjs" --posture analyse --name "${CNAME}-scan" \
  --mount-source "$SRC_ABS:/app:ro" \
  --mount "$RAW:/reports:rw" \
  --mount "$VDB_VOL:/vdb:ro" \
  --env VDB_HOME=/vdb \
  --env VDB_AGE_HOURS=876000 \
  --memory "${CW_DEPSCAN_MEM:-6g}" \
  $ALLOW_NET_FLAG)" \
  || skip "the sandbox refused to emit flags for the scan phase. Running dependency resolution over untrusted source WITHOUT the declared isolation is not a fallback this lane has; no report is written, which classifies as a void rather than a clean scan"

# fix: the scan must name the SAME vdb variant the warm pulled. Without the two --vdb flags dep-scan
# selects the full `vdbxz` image, sees `vdbxz-app-2y` on the volume, and "forces re-download" —
# which --network none refuses. Measured 2026-08-23: 0 of 29 repos scanned, ~7 min of retries each.
timeout "$TIMEOUT" docker run $SCAN_SBX \
  "$IMAGE" \
  depscan --no-banner --src /app --reports-dir /reports \
    --reachability-analyzer "$REACH" --no-vuln-table \
    --vdb-scope "${CW_DEPSCAN_VDB_SCOPE:-app}" --vdb-time "${CW_DEPSCAN_VDB_TIME:-2y}" \
  > "$OUT/depscan-run.log" 2>&1
rc=$?
[ "$rc" -eq 124 ] && skip "dep-scan exceeded ${TIMEOUT}s and was killed — a truncated analysis is not a clean one"

# The summary the roster parses. Findings live in the BOM/VDR files dep-scan writes; this receipt
# proves a run happened, names the isolation it ran under, and carries the counts.
node - "$RAW" "$JSON" "$TS" "$SRC_ABS" "$COVERAGE" "$REACH" "$rc" "$VDB_IMAGE" "$VDB_BUILT_AT" "$PULLED_AT" "$MAX_AGE_DAYS" "$VDB_STALE" "$VDB_NOTE" <<'NODE'
const fs = require('node:fs'), path = require('node:path');
const [raw, dest, ts, src, coverage, reach, rc, vdbImage, vdbBuiltAt, vdbPulledAt, maxAgeDays, vdbStale, vdbNote] = process.argv.slice(2);
const write = (o) => fs.writeFileSync(dest, JSON.stringify(o, null, 2) + '\n');
// The database is part of the result: builtAt bounds which advisories any finding OR absence can
// reflect; pulledAt is what the re-warm policy runs on. Both published, never conflated.
const vdb = { image: vdbImage || null, builtAt: vdbBuiltAt || null, pulledAt: vdbPulledAt || null,
  maxAgeDays: Number(maxAgeDays), stale: vdbStale === '1', note: vdbNote || null,
  bound: vdbBuiltAt ? `advisories published after ${vdbBuiltAt} are not represented in this result` : 'database build date unrecorded — the temporal bound of this result is unknown' };
const base = { tool: 'depscan', generatedAt: ts, src: src.replace(process.env.HOME || '', '~'),
  sandbox: coverage === 'full' ? 'container (network ALLOWED — not isolated)' : 'container, network severed',
  coverage, reachabilityAnalyzer: reach, vdb };
let files = [];
try { files = fs.readdirSync(raw); } catch { files = []; }
// dep-scan names its VDR per project type; find whatever it wrote rather than guessing one name.
const vdrFiles = files.filter((f) => /\.vdr\.json$|^depscan.*\.json$|bom.*\.json$/i.test(f));
if (!vdrFiles.length) {
  write({ ...base, ran: false, skipped: true,
    reason: `dep-scan exited ${rc} and wrote no VDR/BOM in ${files.length} file(s) — nothing was analysed, which is a void, not a clean tree` });
  process.exit(0);
}
let vulns = [], components = null;
for (const f of vdrFiles) {
  let j; try { j = JSON.parse(fs.readFileSync(path.join(raw, f), 'utf8')); } catch { continue; }
  if (Array.isArray(j.vulnerabilities)) vulns = vulns.concat(j.vulnerabilities);
  if (Array.isArray(j.components) && components === null) components = j.components.length;
}
const sevOf = (v) => String(((v.ratings || [])[0] || {}).severity || '').toLowerCase();
const map = { critical: 'crit', high: 'high', medium: 'med', low: 'low' };
const counts = { crit: 0, high: 0, med: 0, low: 0 };

// ── REACHABILITY, AND THE TRAP UNDER IT ────────────────────────────────────────────────────────
// `in_triage` is dep-scan's DEFAULT analysis state. It means "not adjudicated", not "reachable".
// The first cut of this file matched /exploitable|in_triage|affected/ and reported 100 of 105
// findings on vercel/satori as reachable when the true count of proven paths was ZERO — the exact
// defect this project's own evaluation had already named: publishing a weak claim under a strong
// word. Only `exploitable` is a proof.
//
// AND ZERO PROOFS IS NOT THE SAME AS ZERO REACHABLE. The atom slicer writes *-usages.slices.json;
// on that same run it contained {"objectSlices":[],"userDefinedTypes":[]} — the slicer produced
// nothing at all, because the tree had no installed dependencies to slice. A run whose analyser
// never produced output has NO reachability answer, and saying "0 reachable" would be the
// strongest false-clean this tool can emit. So the analyser's own output is checked first, and an
// empty slice set makes reachability a declared VOID with no counts at all.
let sliceObjects = null;
for (const f of files.filter((x) => /usages\.slices\.json$/i.test(x))) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(raw, f), 'utf8'));
    sliceObjects = (sliceObjects || 0) + ((s.objectSlices || []).length);
  } catch { /* unreadable slice file leaves sliceObjects as-is */ }
}
let exploitable = 0, notAdjudicated = 0, prioritized = 0;
for (const v of vulns) {
  const k = map[sevOf(v)]; if (k) counts[k] += 1;
  const st = String((v.analysis && v.analysis.state) || '').toLowerCase();
  if (st === 'exploitable') exploitable += 1; else notAdjudicated += 1;
  if ((v.properties || []).some((p) => p.name === 'depscan:prioritized' && String(p.value) === 'true')) prioritized += 1;
}
const reachability = sliceObjects
  ? { state: 'analysed', analyzer: reach, sliceObjects, exploitable, notAdjudicated,
      note: 'exploitable = dep-scan adjudicated a path to the vulnerable symbol. notAdjudicated is everything else, including its default in_triage — NOT a finding of unreachable.' }
  : { state: 'not-produced', analyzer: reach, sliceObjects: sliceObjects === null ? null : 0,
      reason: coverage === 'full'
        ? 'the slicer wrote no object slices — most often a tree with no installed dependencies to slice. There is NO reachability answer here; this is not a finding that nothing is reachable.'
        : 'the slicer wrote no object slices. With the network severed the analyser cannot install the dependencies it needs to slice, so reachability is UNAVAILABLE in this mode — not zero. Re-run with CW_DEPSCAN_ALLOW_NET=1 (which also lets the scan container reach the network) to obtain it.' };
write({ ...base, ran: true, exit: Number(rc),
  counts: { ...counts, total: vulns.length, components },
  prioritizedByTool: prioritized,
  reachability,
  detail: vdrFiles });
NODE

echo "depscan done -> $OUT (coverage=$COVERAGE, isolation=$([ "$COVERAGE" = full ] && echo none || echo network-severed))"
