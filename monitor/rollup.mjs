#!/usr/bin/env node
// commitwork monitor — roll a scan batch up into rollup.json + a CVE-aware dashboard,
// a high/medium remediation plan, and an append-only findings history.
// Parses commitwork's index.md grid AND the per-repo CVE reports (osv.sarif, npm-audit.json).
// usage: node monitor/rollup.mjs [reportsDir]   (default: the latest reports/sweep-* batch)
// Output artifacts (rollup.json, dashboard.html, REMEDIATION.md, history/) land in the
// area's reports dir, resolved by monitor/area.mjs (CW_MONITOR_OUT, else the registry's
// area out), autocreated if missing — e.g. reports/client-a-monorepo/. Tooling stays in monitor/.
// Exit codes: 2 = empty batch (sweep.mjs continues), 3 = another rollup holds the lock,
// 5 = no sweep-* batch to roll. (4 is reserved for the cross-area write refusal.)
import { readFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, basename } from 'node:path';
import { updateLedger } from './ledger.mjs';
import { writeAtomic, acquireLock, ROLLUP_LOCK, describeAge } from './lockfile.mjs';
import { sealHistory, appendChainEvent, appendAnchor, anchorableOut } from './history-chain.mjs'; // the write log, fed HERE — it was once unwired while the module was untracked
import { checkConservation } from './conserve.mjs'; // fleet-aggregate conservation invariant (published + truncated === declared) — wired below, BEFORE the scanner-annotations overlay (see the call site)
import { assembleLifecycle, readAdvisoryCweIndex, SCAN_CHECK_FOR_TOOL } from './lifecycle.mjs'; // C03/C26 — vuln-lifecycle enrichment (additive, wrapped); SCAN_CHECK_FOR_TOOL is the tool->checkId map the synthetic noscan entries below reuse, so the name can never drift from lifecycle.mjs's own copy
import { annActive as annActiveAsOf, annMatch, SUPPRESSING_ACTIONS, validateScannerAnnotation, findActiveScannerAnnotation, applyScannerAnnotations } from './annotate-lib.mjs'; // as-of matcher (extracted; genISO passed per call)
import { annotationView } from './attribution.mjs'; // carries `who` + human/machine class to the panel
import { classifyFreshness } from './freshness.mjs'; // sweep-liveness deadman (temporal twin of the false-green)
import { pickBatch } from './batch-select.mjs'; // WHICH batch, when the caller names none — see that file for the commitwork-admin case
import { compareSlices } from './dep-provenance.mjs'; // a dependency leaving the registry is the event that silences an advisory
import { markCorroboration, markSastPlaceCorroboration } from './corroborate.mjs'; // two tools agreeing is evidence, and it rendered as two problems
import { inheritUndetermined } from './advisory-reach.mjs'; // could the MAL- advisory reach the installed version at all — the grey-is-not-RED half
import { outDirFor, reportsRootDir, sweepBatches, batchesForArea, ambientArea, sourceKey } from './area.mjs'; // THE OUT resolver (one chain, no literals)
import { loadRegistry, areaOut, areaOf } from './registry.mjs';
import { annotationsPathFor, gateExemptionsPathFor, ownerMapPathFor, epssDetailPathFor } from './store-paths.mjs';
import { epssRecordsFrom } from './epss.mjs'; // pure, so the parse is reachable from a test
import { parseOsv, parseNpm, dedupe, loadKevCatalog } from './dep-findings.mjs'; // pure readers, shared with the remediation brief
import { loadCatalogCache, enrichWithKev } from './vulncheck-enrich.mjs';
import { buildReachabilityIndex } from '../cra/reachability-evidence.mjs'; // call-graph proofs, keyed (repo,id,pkg)
import { buildAliasIndex } from '../cra/advisory-aliases.mjs'; // GO- <-> CVE, without which the join is 0.31%
import { resolveRepos } from './discover.mjs'; // S1 fleet-coverage denominator (the sweep's own resolver)
import {
  _zero, _cmpStr, _detail, DETAIL_CAP,
  _sarifCounts, _sarifDetail, _trivyCounts, _nucleiCounts, _malCounts,
  _socketCounts, _socketAlertCount, regradeSocket, _trufflehogCounts, _hadolintCounts, _govulnCounts,
  _tlsHeaderCounts, _cspmCounts, _schemathesisCounts, _gitleaksCounts, _guarddogCounts,
  SCANNER_SPECS, SCANNER_LABELS, sumTotals, TOTALS_EXCLUDE, METRIC_CATEGORIES, socketRefusal,
  _toolProvenance, stampUnknown,
} from './extractors.mjs'; // the per-artifact readers — importable, so their tests can import them
import { tallyUnknown } from './unknown.mjs'; // ONE predicate for "this is not a result"
import { detailKeys, validateRows, identityFor } from './detail-schema.mjs';
import { checkForScanner } from './scanner-checks.mjs'; // category -> check id, the ONE place lane names live
import { diffScannerFindings } from './scanner-delta.mjs'; // scanner-lane new/fixed per category (scan-absent tier, never ledger-verified)
import { codeVintage, readToolchain } from './vintage.mjs'; // which runner(s) produced the batch
import { readPreflight, preflightClause } from './preflight-join.mjs'; // why a dep lane found nothing
import { baselinePath } from './scan-scope.mjs';
import { followerScript, toggleScript } from '../lib/theme-follower.mjs';
import { houseCss } from '../lib/house-css.mjs';
let _reportFiles = null;
function _reportAbsent(dir, checkId) {
  if (!_reportFiles) {
    _reportFiles = new Map();
    try {
      for (const c of JSON.parse(readFileSync(baselinePath(), 'utf8')).checks || []) if (c && c.report && c.report.file) _reportFiles.set(c.id, c.report.file);
    } catch (err) {
      console.error(`rollup: ${baselinePath()} unreadable (${err.message}) — a failed lane with no report cannot be told from a failed lane with findings unless its row carries noReport`);
    }
  }
  const file = _reportFiles.get(checkId);
  return !!file && !existsSync(join(dir, file));
}
// re-exported: consumers and tests have always imported these two from rollup.mjs, and moving where
// they are DEFINED must not move where they are found.
export { sumTotals, TOTALS_EXCLUDE };

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

// ---- registry-derived output location (single source: monitor/projects.json) ----
// FAIL LOUD: rollup.json is the consumer contract — the panel, liveness, the map and the
// overwatch-layer exporter all read it as current state. A misresolved OUT/EXCLUDE/lifecycle from a
// swallowed parse failure would write (or silently overwrite) another area's "current state" with
// confident silence. loadRegistry() throws instead of degrading to {}; see its own header.
const REG = loadRegistry();
const EXCLUDE = new Set(REG.exclude || []); // repos dropped from scan scope (e.g. retired/non-deployed services)
// The area this process writes to WHEN NOBODY NAMED A BATCH. CW_MONITOR_OUT (the injection seam —
// verification fixtures run in a scratch OUT, never against the live reports tree) still wins here,
// and outDirFor() honours it. This is NOT yet the output dir: when a batch IS named, the batch's own
// declaration decides where its findings land. See resolveOut() below.
const AMBIENT_OUT = outDirFor(null, REG);


// default input batch = the newest sweep-* dir under reportsRoot (rollup.json now feeds the
// live map, so defaulting to the historic phase1 clones batch would poison the live totals).
//
// NO-BATCH IS AN ERROR, NOT A FALLBACK. This used to default to the phase1 client-a batch
// — a historic client-a clones snapshot — so on a machine with no sweep yet ANY area's rollup would
// silently be built from client-a's 2026 phase1 data and published as that area's current state
// (and that directory does not even exist here, so the fallback resolved to an unreadable path).
// Exit 5, deliberately NOT 2: sweep.mjs:137 treats exit 2 as "empty batch — continuing" and would
// absorb this into a green sweep. 3 is the concurrent-rollup lock, 4 is reserved for the
// cross-area refusal. An explicit `argv[2] reportsDir` keeps working regardless.
// AREA-FILTERED. This took the newest batch on the MACHINE: a bare `node monitor/rollup.mjs` after
// someone swept another project folded THAT project's findings into THIS area's rollup, history and
// ledger — the contamination class the area model exists to close, reachable from the default
// invocation. Candidates are now restricted to batches belonging to the area this process writes to
// (batchesForArea), falling back to unknown-scope batches only when the area has none of its own,
// and saying so rather than silently adopting a foreign batch.
function latestSweepDir() {
  const all = sweepBatches(REG);
  if (!all.length) {
    console.error(`rollup: no sweep-* batch under ${reportsRootDir(REG)} — nothing to roll up.`);
    console.error('rollup: run `node monitor/sweep.mjs` first, or pass a batch dir explicitly: node monitor/rollup.mjs <reportsDir>');
    process.exit(5);
  }
  // batchesForArea returns { covers, unknown }, NEWEST FIRST — not an array. This read `mine.length`
  // on an object (always undefined, always falsy), so the area-owned branch never executed, and the
  // `unknown` filter below tested `b.area` on a sweepBatches() element that has no such property
  // (so `unknown` was ALWAYS every batch). Net effect: a bare `node monitor/rollup.mjs` always
  // exited 4 — accidentally safe, for a reason unrelated to the guard's intent, and only after
  // creating the area dir and taking the lock. Had the branch ever run, `mine[mine.length - 1]`
  // would have picked the OLDEST batch, the list being newest-first.
  const { covers, unknown } = batchesForArea({ slug: ambientArea(REG)?.slug, dir: AMBIENT_OUT }, REG);
  if (covers.length) return pickBatch(covers, ambientArea(REG)?.rollupBatch || 'newest');
  // NO UNKNOWN-SCOPE FALLBACK. An earlier revision adopted the newest scope-less batch with a
  // warning — and that is still contamination: a bare `node monitor/rollup.mjs` picked up an
  // client-d-remote batch and rolled it into the client-a area, overwriting a real 18-repo fleet
  // slice with a 1-repo foreign one. A printed caveat does not undo a clobbered consumer contract.
  // Pre-area batches are legitimate input, but ONLY when the operator names one explicitly.
  if (unknown.length) {
    console.error(`rollup: no batch declares area '${ambientArea(REG)?.slug ?? '?'}'. ${unknown.length} pre-area batch(es) carry no scope and will NOT be adopted automatically — rolling one into this area would publish another project's findings as this project's state.`);
    console.error(`rollup: name one explicitly if that is what you want: node monitor/rollup.mjs ${relative(CW, unknown[unknown.length - 1].dir)}`);
    process.exit(4);
  }
  console.error(`rollup: the newest batches all belong to other areas — refusing to roll a foreign batch into '${ambientArea(REG)?.slug ?? AMBIENT_OUT}'.`);
  console.error('rollup: pass the batch dir explicitly if that is really what you want.');
  process.exit(4);
}
const reportsDir = resolve(process.argv[2] || latestSweepDir());
// What every artifact records as `source`, and what every dedupe compares by. Relative to the
// reports root: the absolute form put the operator's home path into 18,703 files and one row of
// every history index — measured 2026-09-02. Old rows stay absolute; sourceKey() keys both the same.
const sourceId = sourceKey(reportsDir, REG);

// batch-manifest.json is written by sweep.mjs BEFORE the run (code anchors + intended scope).
// A bare report dir with no manifest rolls up as kind 'adhoc': scope = the repo dirs present.
// READ BEFORE `OUT` IS RESOLVED — the batch's own declaration is what decides where its findings
// land. This used to be parsed ~300 lines below the OUT it should have determined.
let bm = null; try { bm = JSON.parse(readFileSync(join(reportsDir, 'batch-manifest.json'), 'utf8')); } catch {}

// ── WHERE THIS BATCH'S FINDINGS LAND ─────────────────────────────────────────────────────────────
// `OUT` was `outDirFor(null, REG)` — the registry's ambient/primary area — resolved before anything
// about the batch was known. sweep.mjs masks that by exporting CW_MONITOR_OUT, so the scheduled path
// was safe; a manual `node monitor/rollup.mjs <batch>` was not, and published commitwork's findings
// as client-a's state (observed 2026-08-01).
//
// Two intents, kept distinct:
//   · a batch was NAMED  -> "roll THIS batch". The area comes from the batch, or we refuse.
//   · no batch named     -> "roll the latest batch for MY area". latestSweepDir() has already
//                            restricted candidates to batches covering the ambient area, so the
//                            ambient dir IS the answer, not a guess.
//
// The slug is re-derived through areaOut() rather than trusting `bm.areaOut`: that field is a
// CW-relative path recorded at sweep time and survives a slug rename, so it can point at a directory
// the registry no longer owns. Refusing beats defaulting — the same rule registry.mjs applies when
// areaOut() returns null, and the same rule the pre-area guard above already applies.
function resolveOut() {
  if (process.env.CW_MONITOR_OUT) return resolve(process.env.CW_MONITOR_OUT);
  if (!process.argv[2]) return AMBIENT_OUT;
  if (!bm || typeof bm.area !== 'string' || !bm.area) {
    // pre-area batches are legitimate input, but the operator must say where they go
    console.error(`rollup: ${basename(reportsDir)} declares no area, so there is nothing to say which project's record it belongs in.`);
    console.error('rollup: set CW_MONITOR_OUT explicitly, or re-sweep so the batch records its own scope.');
    process.exit(4);
  }
  const out = areaOut(bm.area, REG);
  if (!out) {
    console.error(`rollup: batch ${basename(reportsDir)} declares area '${bm.area}', which the registry does not resolve to an output directory.`);
    console.error('rollup: declare that area in monitor/projects.json, or pass CW_MONITOR_OUT.');
    process.exit(4);
  }
  return join(reportsRootDir(REG), out);
}
const OUT = resolveOut();
mkdirSync(OUT, { recursive: true });

// Serialise concurrent rollups (launchd sweep + manual run interleaving index/ledger RMW).
// mkdir is atomic; a stale lock (>10 min) is treated as a crashed run and taken over.
//
// C2: this was a private copy of monitor/lockfile.mjs's algorithm carrying two defects the shared
// one now fixes, and BOTH of them fire exactly when per-area agents start running concurrently:
//   · the takeover never touched the lock directory, so its mtime stayed old and every rollup that
//     started afterwards read the SAME lock as stale — one crash and the area sat permanently in
//     takeover mode with nobody excluding anybody. acquireLock() stamps mtime + an `at` token.
//   · `process.on('exit', rmdir)` removed whatever was at the lock path, which for a run that had
//     been taken over was the NEXT rollup's freshly acquired lock. Release is identity-checked now.
// attempts:1 keeps the behaviour callers depend on — a fresh lock aborts with exit 3, it never
// queues, because sweep.mjs reads 3 as "another rollup holds the lock" and continues.
// R1b: ROLLUP_LOCK is now exported from lockfile.mjs so monitor/backfill-scanner-delta.mjs's
// takeReportsLock(OUT, {lockName: ROLLUP_LOCK}) call converges onto this EXACT path — one
// slice-writer mutex over this directory, not two under different names. The literal below is
// unchanged ('.rollup.lock'), so this line's own behaviour, and everything
// monitor/test/rollup-lock.test.mjs asserts about it (messages, exit code, takeover semantics),
// is untouched.
const LOCK = join(OUT, ROLLUP_LOCK);
const rollupLock = acquireLock(LOCK, {
  staleMs: 10 * 60 * 1000, label: 'rollup', releaseOnExit: true,
  onStale: (ageMs) => console.error(`rollup: taking over stale lock (${Math.round(ageMs / 60000)} min old)`),
});
if (!rollupLock.ok) {
  console.error(`rollup: another rollup is running (${LOCK}, ${describeAge(rollupLock.heldFor)}) — aborting`);
  process.exit(3);
}

const hasIndex = existsSync(join(reportsDir, 'index.md'));

// ---- per-repo lifecycle (projects.json "lifecycle" map) ----
// state:'superseded' => out of ACTIVE scan scope + counts from effectiveFrom (batch-stamp
// string compare, YYYYMMDDHHMMSS >=), but rendered as a DISTINCT "superseded (rollback
// standby)" row — never 'retired', never blank, never clean. EXCLUDE always wins; re-rollups
// of pre-effectiveFrom batches are byte-identical (lifecycle inert for them).
const LIFECYCLE = REG.lifecycle || {};
// unstamped dirs (adhoc/phase1-historic) are lifecycle-INERT: a historic batch re-rolled today must
// keep its original scope (fresh adhoc batches only contain report dirs for repos actually scanned,
// so superseded repos never appear in them anyway). effectiveTo bounds a rollback interval.
const BATCH_STAMP = (reportsDir.match(/sweep-(\d{14})/) || [])[1] || null;
const lifecycleOf = (n) => { const l = LIFECYCLE[n]; return l && l.state === 'superseded' && !EXCLUDE.has(n) && BATCH_STAMP && l.effectiveFrom && BATCH_STAMP >= l.effectiveFrom && (!l.effectiveTo || BATCH_STAMP < l.effectiveTo) ? l : null; };
const isSuperseded = (n) => !!lifecycleOf(n);
const SUPERSEDED = Object.keys(LIFECYCLE).filter(isSuperseded).map((n) => ({ name: n, supersededBy: LIFECYCLE[n].supersededBy || '', effectiveFrom: LIFECYCLE[n].effectiveFrom || '', note: LIFECYCLE[n].note || '' }));

// ---------- severity helpers ----------
const SEVRANK = { crit: 4, high: 3, med: 2, low: 1, unknown: 0, ok: 0, na: 0 };
const GLYPH = { crit: '⬤', high: '▲', med: '◆', low: '▬', ok: '✓', na: '–', unknown: '?' };
const LABEL = { crit: 'CRIT', high: 'HIGH', med: 'MED', low: 'LOW', ok: 'OK', na: '—', unknown: '?' };
const worst = (fs) => fs.reduce((w, f) => (SEVRANK[f.severity] > SEVRANK[w] ? f.severity : w), 'na');

// ---------- CVE extractors ---------- (monitor/dep-findings.mjs)
// fixFromRange lives in ./fix-range.mjs and is re-exported here so existing importers keep working.
// It moved because this module runs its pipeline at module scope: importing it to reach a six-line
// pure function performs a rollup, and exits the process when there is no batch — which made its
// test pass only where a populated `reports/` already existed, and fail in every clean checkout.
// import + export, NOT `export … from`: a re-export creates no local binding.
import { fixFromRange } from './fix-range.mjs';
export { fixFromRange };


// ---------- parse the index.md grid (non-CVE columns) ----------
// VOID-A fix: the scan path writes a noscan cell as `⬜ <summary>` (writeIndex in commitwork.mjs),
// but classify() knew only 🔴🟡🟢 and bucketed ⬜ as 'na' (indistinguishable from not-applicable),
// and its strip-set listed ⚪ — a DIFFERENT glyph than the ⬜ actually written, so the glyph leaked
// into .text. Recognise ⬜ as its own `noscan` sev (ordered after 🟢 so a real finding still wins)
// and strip it. This is what makes a coverage void visible instead of silently reading as clean.
function classify(t) {
  const sev = t.includes('🔴') ? 'high' : t.includes('🟡') ? 'med' : t.includes('🟢') ? 'ok' : t.includes('⬜') ? 'noscan' : 'na';
  const clean = t.replace(/[🔴🟡🟢⬜⚪]/g, '').trim();
  const m = clean.match(/\d+/);
  return { sev, count: m ? parseInt(m[0], 10) : 0, text: clean && clean !== '–' && clean !== '-' ? clean : '—' };
}
// per-repo CVE-parser provenance (A-1), keyed by repo name: osv carries sarif-read.mjs's typed
// vocabulary (ok|absent|unreadable|empty|unparseable|never-ran|tool-failed), npm the older
// 'absent'|'ok'|'unparseable' triple. Populated by
// both branches below, consulted by the checks-status loop further down — that loop runs in a LATER
// pass (it needs checks-status.json in hand), so the state has to be threaded through rather than
// derived twice. Never published itself; the synthetic checks-status entry it feeds is the one
// visible trace, same discipline as every other read-error state in this file.
const depParseState = {};
// The sweep directory immediately before this one, for the per-repo provenance comparison. Resolved
// once: sweepBatches is a readdir, and doing it inside the repo loop would stat the reports root a
// hundred times to answer the same question. null when this is the first batch, which compareSlices
// reports as `no-reference` rather than as "nothing moved".
const _prevSweepDir = (() => {
  try {
    const all = sweepBatches().filter((b) => b.dir !== reportsDir);
    const mine = BATCH_STAMP ? all.filter((b) => b.stamp && b.stamp < BATCH_STAMP) : all;
    return mine.length ? mine[mine.length - 1].dir : null;
  } catch { return null; }
})();
const _readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const _provenanceFor = (name) => compareSlices(_prevSweepDir ? join(_prevSweepDir, name) : null, join(reportsDir, name), _readJson);
let headerCols = null; const repos = [];
if (hasIndex) {
  const md = readFileSync(join(reportsDir, 'index.md'), 'utf8');
  for (const line of md.split('\n')) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!headerCols) { if (/repo/i.test(cells[0])) headerCols = cells.slice(1); continue; }
    if (/^:?-{2,}/.test(cells[0].replace(/\s/g, ''))) continue;
    const m = cells[0].match(/\[([^\]]+)\]\(([^)]+)\)/);
    const name = m ? m[1] : cells[0];
    if (EXCLUDE.has(name)) continue;
    if (isSuperseded(name)) continue; // lifecycle: superseded (rollback standby) — out of active scope/counts
    const grid = {}; headerCols.forEach((col, i) => { grid[col] = classify(cells[i + 1] || ''); });
    const dir = join(reportsDir, name);
    const _osv = parseOsv(dir), _npm = parseNpm(dir);
    // npm audit erases the provenance osv keeps, so a demotion decided on the osv row is carried
    // to its alias twin — or one dependency reads undetermined in one lane and crit in the other.
    const findings = markCorroboration(dedupe([..._osv.rows, ...inheritUndetermined(_osv.rows, _npm.rows)]));
    depParseState[name] = { osv: _osv.state, npm: _npm.state };
    repos.push({ name, summary: m ? m[2] : null, grid, findings, worst: worst(findings), depProvenance: _provenanceFor(name) });
  }
} else {
  // no batch index.md (e.g. a per-repo sweep) — build straight from the per-repo report files
  headerCols = ['deps-osv', 'npm-audit'];
  for (const name of readdirSync(reportsDir)) {
    if (EXCLUDE.has(name)) continue;
    if (isSuperseded(name)) continue; // lifecycle: superseded (rollback standby) — out of active scope/counts
    const dir = join(reportsDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const _osv = parseOsv(dir), _npm = parseNpm(dir);
    // npm audit erases the provenance osv keeps, so a demotion decided on the osv row is carried
    // to its alias twin — or one dependency reads undetermined in one lane and crit in the other.
    const findings = markCorroboration(dedupe([..._osv.rows, ...inheritUndetermined(_osv.rows, _npm.rows)]));
    depParseState[name] = { osv: _osv.state, npm: _npm.state };
    const hasSummary = existsSync(join(dir, 'summary.md'));
    const hasBH = ['build-health-deadcode.json', 'build-health-toolchain.json', 'build-health-provenance.json', 'build-health-format.json', 'build-health-lint.json'].some((f) => existsSync(join(dir, f)));
    // a scanner artifact with zero findings means SCANNED CLEAN — the repo must stay in the
    // slice (and its tool count as ran), or clean repos degrade to "not scanned" and their
    // prior findings get carried forever instead of resolving
    const hasArtifact = ['osv.sarif', 'npm-audit.json', 'checks-status.json'].some((f) => existsSync(join(dir, f)));
    if (!findings.length && !hasSummary && !hasBH && !hasArtifact) continue;
    repos.push({ name, summary: hasSummary ? `${name}/summary.md` : null, grid: {}, findings, worst: worst(findings), depProvenance: _provenanceFor(name) });
  }
}

// ---------- build-health (non-CVE hygiene/currency): attach per repo + fleet summary ----------
const readBH = (dir, f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } };
for (const r of repos) {
  const dir = join(reportsDir, r.name);
  const dc = readBH(dir, 'build-health-deadcode.json'); const tc = readBH(dir, 'build-health-toolchain.json'); const pv = readBH(dir, 'build-health-provenance.json');
  const fm = readBH(dir, 'build-health-format.json'); const lt = readBH(dir, 'build-health-lint.json');
  if (dc || tc || pv || fm || lt) r.buildHealth = { deadcode: dc ? dc.status : null, toolchain: tc ? tc.status : null, provenance: pv ? pv.status : null, format: fm ? fm.status : null, lint: lt ? lt.status : null };
  // pending dependency updates from the local Renovate dry-run (deps-updates check)
  const ru = readBH(dir, 'renovate-updates.json');
  if (ru && ru.ran) r.depsUpdates = { count: ru.count || 0, major: (ru.byType && ru.byType.major) || 0, minor: (ru.byType && ru.byType.minor) || 0 };
  // quality gates (non-CVE consolidation bar; build-health pattern — status strings from the report files)
  const qb = readBH(dir, 'quality-gates-boottest.json'); const qc = readBH(dir, 'quality-gates-contracts.json');
  const qo = readBH(dir, 'quality-gates-openapi.json'); const qi = readBH(dir, 'quality-gates-ci.json');
  const qbp = readBH(dir, 'quality-gates-boottest-pass.json'); // executed-boot reader (plan A1; absent until Phase C wires it into the sweep)
  if (qb || qc || qo || qi || qbp) r.qualityGates = { bootTest: qb ? qb.status : null, contracts: qc ? qc.status : null, openapi: qo ? qo.status : null, ci: qi ? qi.status : null, bootTestPass: qbp ? qbp.status : null };
}

// ---- gate-exemption overlay (plan A3 — monitor/private/gate-exemptions.json, annotations.json
// pattern: append-only, as-of active window). Raw r.qualityGates.<gate> statuses stay RAW;
// views get r.qualityGates.exempt.<gate> and the summary lists below skip exempted entries.
// FAIL CLOSED, like every other authored-judgment read in this file. The old `catch {}` turned any
// unreadable/corrupt exemptions file into zero exemptions, which republishes every exempted gate as
// an un-annotated red — erasing an operator's recorded judgment without a word. Only ENOENT means
// "no exemptions have been declared"; anything else is a broken file and must be said out loud.
let gateEx = [];
try {
  gateEx = JSON.parse(readFileSync(gateExemptionsPathFor(CW), 'utf8')).exemptions || [];
} catch (err) {
  if (err.code !== 'ENOENT') {
    console.error(`rollup: ${gateExemptionsPathFor(CW)} is present but unreadable — ${err.message}\n`
      + '  Refusing to continue. Treating it as empty would silently drop every recorded exemption and\n'
      + "  republish those gates as plain reds, which reads as 'nobody ever judged this' rather than\n"
      + '  as the parse failure it is. Fix the file (it is append-only; git has the last good copy).');
    process.exit(6);
  }
}
const GATE_FIELD = { 'qg-boot-test': 'bootTest', 'qg-contract-tests': 'contracts', 'qg-openapi': 'openapi', 'qg-ci': 'ci', 'qg-boot-test-pass': 'bootTestPass' };
const gateExNow = new Date().toISOString();
const gateExActive = (e) => e.action === 'exempt' && e.at <= gateExNow && (!e.expires || e.expires > gateExNow);
// An exemption is a judgment about ONE project's service. Keyed on {gate, service} alone it matched
// by BARE DIRECTORY NAME, so an exemption written for one area's `api-gateway` silently exempted an
// identically named service in every other registered area — a green in a project for which nobody
// ever made that call, and one that reads exactly like a considered decision.
//
// The discriminator has to be the area BEING ROLLED UP, not areaOf(service): areaOf resolves a name
// to exactly one area, so it cannot tell two same-named service dirs in different areas apart —
// which is the whole collision. An entry that omits `area` falls back to the area its own service
// name resolves to, so existing entries keep working and stay scoped rather than going fleet-wide.
const rollupArea = (bm && bm.area) || ambientArea(REG)?.slug || null;
for (const r of repos) {
  if (!r.qualityGates) continue;
  for (const e of gateEx) {
    if (!gateExActive(e) || e.service !== r.name) continue;
    const exArea = e.area || areaOf(e.service, REG);
    if (exArea && rollupArea && exArea !== rollupArea) continue;
    const field = GATE_FIELD[e.gate]; if (!field) continue;
    if (!r.qualityGates.exempt) r.qualityGates.exempt = {};
    r.qualityGates.exempt[field] = { reason: e.reason, who: e.who, at: e.at, area: exArea };
  }
}
const gateExempt = (r, field) => !!(r.qualityGates && r.qualityGates.exempt && r.qualityGates.exempt[field]);
const buildHealth = {
  scanned: repos.filter((r) => r.buildHealth).length,
  toolchainRed: repos.filter((r) => r.buildHealth && r.buildHealth.toolchain === 'RED').map((r) => r.name),
  provenanceMismatch: repos.filter((r) => r.buildHealth && r.buildHealth.provenance === 'MISMATCH').map((r) => r.name),
  deadcodeFindings: repos.filter((r) => r.buildHealth && /^findings:/.test(r.buildHealth.deadcode || '')).map((r) => r.name),
  // Named separately from deadcodeFindings: both are `findings:N`, but a formatting deviation and
  // an unused dependency are not the same kind of claim and must not sum into one number.
  formatDeviating: repos.filter((r) => r.buildHealth && /^findings:/.test(r.buildHealth.format || '')).map((r) => r.name),
  // Declared a formatter and it could not be run/read here — grey, and counted as grey.
  formatUnchecked: repos.filter((r) => r.buildHealth && ['skipped', 'unreadable'].includes(r.buildHealth.format)).map((r) => r.name),
  // Split by the severity the REPO declared: a lint gate it set and fails, versus a count it
  // asked for. Summing them would publish an advisory count as a failure.
  lintGateFailing: repos.filter((r) => r.buildHealth && /^findings:/.test(r.buildHealth.lint || '')).map((r) => r.name),
  lintAdvisory: repos.filter((r) => r.buildHealth && r.buildHealth.lint === 'advisory').map((r) => r.name),
  lintUnchecked: repos.filter((r) => r.buildHealth && ['skipped', 'unreadable'].includes(r.buildHealth.lint)).map((r) => r.name),
};
const qualityGates = {
  scanned: repos.filter((r) => r.qualityGates).length,
  bootTestMissing: repos.filter((r) => r.qualityGates && r.qualityGates.bootTest === 'MISSING' && !gateExempt(r, 'bootTest')).map((r) => r.name),
  contractsMissing: repos.filter((r) => r.qualityGates && r.qualityGates.contracts === 'MISSING' && !gateExempt(r, 'contracts')).map((r) => r.name),
  openapiNotWired: repos.filter((r) => r.qualityGates && ['MISSING', 'partial'].includes(r.qualityGates.openapi) && !gateExempt(r, 'openapi')).map((r) => r.name),
  ciMissing: repos.filter((r) => r.qualityGates && r.qualityGates.ci === 'MISSING' && !gateExempt(r, 'ci')).map((r) => r.name),
  // executed-boot reader (plan A1): RED = executed+failed, STALE = aged/sha-mismatch, MISSING = void (never executed)
  bootTestPassNotGreen: repos.filter((r) => r.qualityGates && ['MISSING', 'RED', 'STALE'].includes(r.qualityGates.bootTestPass) && !gateExempt(r, 'bootTestPass')).map((r) => r.name),
  // annotated exemptions in force (gate-exemptions.json overlay) — visible, never silent
  exempted: repos.filter((r) => r.qualityGates && r.qualityGates.exempt).map((r) => ({ name: r.name, gates: Object.keys(r.qualityGates.exempt) })),
};

// ---------- totals + delta ----------
// ---------- KEV + EPSS enrichment (prioritisation) ----------
// Freshness is judged from each catalogue's OWN content, NEVER this file's mtime (bifocal R21/C5):
// kev.json/epss.json are git-tracked-turned-gitignored caches — a fresh clone (or, previously, a
// git checkout) resets mtime to "now", which a mtime-based check would misread as "just fetched"
// even when the content is weeks stale. kev.json carries dateReleased/catalogVersion; epss.json's
// content is a flat {cveId: score} map with no version/date field of its own to read — 'unknown'
// is reported honestly rather than inventing one from mtime or anything else.
const { set: kevSet, staleDays: KEV_STALE_DAYS, freshness: kevFreshness } = loadKevCatalog();
if (kevFreshness.state === 'stale') console.error(`rollup: KEV catalogue is ${kevFreshness.ageDays}d stale (catalogVersion ${kevFreshness.catalogVersion}, released ${kevFreshness.dateReleased}, > ${KEV_STALE_DAYS}d) — refresh: CRA_FETCH=1 node cra/watch.mjs`);
else if (kevFreshness.state === 'unknown') console.error(kevFreshness.reason
  ? `rollup: KEV catalogue freshness unknown — ${kevFreshness.reason}`
  : 'rollup: KEV catalogue freshness unknown (monitor/data/kev.json missing, unreadable, or missing dateReleased)');
const epssPath = join(HERE, 'data/epss.json');
let epss = {}; try { epss = JSON.parse(readFileSync(epssPath, 'utf8')); } catch {}
const epssFreshness = { state: 'unknown', note: 'monitor/data/epss.json carries no version/date field of its own to measure freshness from' };
const cveIds = [...new Set(repos.flatMap((r) => r.findings).map((f) => f.id).filter((id) => /^CVE-\d/.test(id)))];
// The full-triple sidecar. Separate file, same atomic discipline; absent is legitimately absent
// (this store began empty and backfills only as CVEs are fetched), never an empty object standing
// in for "no scores exist". Its keys are the fleet's CVE set, so it is a private record
// (monitor/private/epss-detail.json, CW_EPSS_DETAIL), not a cache beside epss.json.
const epssDetailPath = epssDetailPathFor(CW);
let epssDetail = {}; try { epssDetail = JSON.parse(readFileSync(epssDetailPath, 'utf8')); } catch { /* ENOENT is the only absence; a torn file re-fetches below */ }

const missing = cveIds.filter((id) => !(id in epss));
if (missing.length && globalThis.fetch) {
  const fetched = {};
  const fetchedDetail = {};
  for (let i = 0; i < missing.length; i += 90) {
    const batch = missing.slice(i, i + 90);
    // `d.cve` is the RESPONSE's key, not our request echoed back — shape-validate it before it
    // becomes a key in the shared cache, so a compromised feed cannot plant `__proto__`/arbitrary
    // keys that every area's rollup would then read back as CVE ids.
    // THE RESPONSE CARRIES THREE FACTS AND WE USED TO KEEP ONE. `d` is {cve, epss, percentile,
    // date}; `fetched[d.cve] = +d.epss` discarded the percentile and the date at the door, and
    // epss.json then "carries no version/date field of its own to measure freshness from" (the
    // comment above, written about a gap this line created). Third instance of the same class in
    // this repo — govulncheck aliases and CodeQL codeFlows were the first two — where the evidence
    // was already arriving and was dropped at the parse boundary.
    //
    // THE SIDECAR EXISTS BECAUSE THE VALUE SHAPE IS LOAD-BEARING. Consumers read epss.json's values
    // as NUMBERS (`typeof f.epss === 'number'` in export-overwatch.mjs, arithmetic in
    // cra/watch.mjs), so widening them to objects would break those silently. epss.json keeps its
    // shape; the full triple lands beside it. Strings are stored VERBATIM, not re-parsed: CSAF 2.1
    // requires `percentile` and `probability` as strings matching a fixed decimal pattern, and a
    // round-trip through a float would reformat them out of that pattern.
    try { const r = await fetch(`https://api.first.org/data/v1/epss?cve=${batch.join(',')}`); const j = await r.json(); const { scores, detail } = epssRecordsFrom(j); Object.assign(fetched, scores); Object.assign(fetchedDetail, detail); }
    catch (e) { console.error(`rollup: EPSS fetch failed for batch ${Math.floor(i / 90) + 1} (${batch.length} CVEs): ${(e && e.message) || e}`); }
  }
  // only persist scores we actually fetched — "no score obtainable" stays null (absent),
  // never 0.0, or a fetch failure poisons the store and every frozen slice copy after it
  // nosemgrep: javascript.lang.security.insecure-object-assign.insecure-object-assign -- every key allowlist-validated to the CVE-id shape at ingest above
  Object.assign(epss, fetched);
  // ATOMIC: epss.json is a shared cross-area cache (every area's rollup reads+writes the same
  // file) — a crash mid-write here is not "an old score" but a torn file every subsequent reader
  // parses as {} (every CVE looks unscored) or fails to parse at all. Same crash-safety as
  // rollup.json below, and the same primitive (temp + rename).
  if (Object.keys(fetched).length) { mkdirSync(join(HERE, 'data'), { recursive: true }); writeAtomic(epssPath, JSON.stringify(epss)); }
  // nosemgrep: javascript.lang.security.insecure-object-assign.insecure-object-assign -- keys are the same CVE-id-allowlisted set validated at ingest above
  Object.assign(epssDetail, fetchedDetail);
  if (Object.keys(fetchedDetail).length) { mkdirSync(dirname(epssDetailPath), { recursive: true }); writeAtomic(epssDetailPath, JSON.stringify(epssDetail)); }
}
// KEV IS TRI-STATE, BECAUSE THE CATALOGUE CAN BE ABSENT. `kevSet.has(id)` is false both for a CVE
// that was checked and is not listed, AND for every CVE when kev.json failed to load — and those
// are different facts. An unconsulted catalogue yielded a fleet of confident `kev: false`, which is
// the false-clean shape one layer in: absence of evidence rendering as evidence of absence. Any
// consumer weighting `kev` (the corroboration view now does) would credit a lookup that never ran.
//
// `null` for "not consulted". epss already had this right — it distinguishes an absent score from a
// zero one — so this makes the two enrichment fields agree.
const kevUsable = kevSet.size > 0;
if (!kevUsable) console.error('rollup: KEV catalogue is EMPTY or unreadable — kev is recorded as null (not consulted), never false');
for (const r of repos) for (const f of r.findings) { f.kev = kevUsable ? kevSet.has(f.id) : null; f.epss = (f.id in epss) ? epss[f.id] : null; }

// VulnCheck's KEV catalogue, read from the cache that `vulncheck-enrich.mjs --refresh` or the panel
// writes; this rollup never fetches it. Tri-state like kev: with no cache, or one that cannot be
// read, every row is null, never "not exploited", and the reason travels in the totals.
let vcCache = null, vcReason = 'no cache: node monitor/vulncheck-enrich.mjs --refresh, or refresh it from the panel';
try { vcCache = loadCatalogCache(); if (vcCache) vcReason = null; }
catch (e) { vcReason = `cache unreadable: ${e.message}`; console.error(`rollup: VulnCheck KEV ${vcReason} — activelyExploited is recorded as null`); }
for (const r of repos) enrichWithKev(r.findings, vcCache);

const allF = repos.flatMap((r) => r.findings.map((f) => ({ ...f, repo: r.name })));
const bySev = (s) => allF.filter((f) => f.severity === s).length;
// The DEPENDENCY-CVE half of the headline: osv + npm, parsed into repos[].findings. This used to
// BE `totals`, which is why the headline excluded every other scanner — secrets, SAST, IaC and
// supply-chain findings were recorded in `scanners` and summed nowhere. client-d read 0 crit / 0 high
// while holding 88 leaked secrets. Kept under its own name so a consumer that genuinely means
// "CVEs" still has them; `totals` is assembled after the scanner fleet exists, below.
// `kevConsulted` rides beside the count for the same reason kev itself became tri-state: a `kev: 0`
// from a fleet with no exploited CVEs and a `kev: 0` from a catalogue that never loaded are the
// same number and opposite facts. The count alone cannot carry that; the flag can.
// `unknown` and `undetermined` are NAMED, not merely absent. crit/high/med/low have never summed
// to `cves` — 980 rows fleet-wide carry an unscored `unknown` severity and were counted in no
// bucket at all, so a reader comparing the four numbers to the total found a gap with no word for
// it. `unknown` is that gap; `undetermined` is the part of it this slice demoted deliberately
// (advisory-reach.mjs), with each row's reason on the row. A count with no name reads as clean.
const cveTotals = { repos: repos.length, crit: bySev('crit'), high: bySev('high'), med: bySev('med'), low: bySev('low'), unknown: bySev('unknown'), undetermined: allF.filter((f) => f.undetermined).length, // KEV FOLLOWS THE DEMOTION, or the two numbers disagree about one row. A finding whose version
  // the repository never declared cannot support a KEV claim either — the catalogue entry is about
  // pillow 9.5.0, and nothing here says this repository installs pillow 9.5.0. Measured 2026-08-28
  // on memory-layer: the demotion took cveTotals.crit from 2 to 0 and left kev at 1, which is the same
  // input producing two verdicts. The undemoted count travels as kevClaimed so nothing is lost.
  kev: allF.filter((f) => f.kev && !f.undetermined).length,
  kevClaimed: allF.filter((f) => f.kev).length,
  kevConsulted: kevUsable,
  // The same demotion as kev: a row whose version the repository never declared supports no claim.
  activelyExploited: allF.filter((f) => f.activelyExploited && !f.undetermined).length,
  activelyExploitedClaimed: allF.filter((f) => f.activelyExploited).length,
  vulncheck: { consulted: vcCache !== null, fetchedAt: vcCache ? vcCache.fetchedAt : null, reason: vcReason },
  cves: allF.length };

// ══════════ slice v1: anchors + provenance + scope-gated lifecycle + verified ledger ══════════
const SLICE_VERSION = 1;
const genISO = new Date().toISOString();
// The prober's verdicts, read once. Absent ⇒ null, and every clause it produces then says
// "unknown" — never an assumed state. The batch's own start time is what run-identity is checked
// against: a preflight generated before this batch began describes a tree that may have moved.
const _preflight = readPreflight(OUT);
const _batchStartedAt = (() => {
  try { return JSON.parse(readFileSync(join(reportsDir, 'batch-manifest.json'), 'utf8')).startedAt || null; }
  catch { return null; }
})();
let stamp = genISO.replace(/[-:T]/g, '').slice(0, 14);
// two rollups of DIFFERENT batches in the same second must not share a stamp — the second
// would silently overwrite the first's snapshot (and, via sliceId, its versioned rollup copy).
// Re-rollup of the SAME batch keeps its stamp (intended replace). Bumped stamps stay
// unique+sortable; they may not be valid clock times.
const histDir = join(OUT, 'history'); mkdirSync(histDir, { recursive: true });
// ENOENT-only-absent. This catch used to swallow corrupt too, and the fallthrough is destructive
// twice over: the same-batch `prior` lookup below misses (fresh stamp/sliceId — the ledger then
// duplicates every entry, exactly as the comment below warns), and the final index write at the
// bottom of this file rewrites index.json with ONE row, orphaning every prior slice. A corrupt
// index must STOP the rollup; nothing downstream of this line can repair it, only bury it.
let idx = [];
try { idx = JSON.parse(readFileSync(join(histDir, 'index.json'), 'utf8')); }
catch (e) {
  if (!e || e.code !== 'ENOENT') {
    console.error(`rollup: ${join(histDir, 'index.json')} EXISTS but is unreadable (${(e && e.message) || 'parse failure'}).`
      + ' Refusing to roll up: continuing would mint a fresh sliceId (duplicating remediation-ledger entries)'
      + ' and the final index write would REPLACE the index with this one slice, orphaning all history.'
      + ' Restore the file, or remove it deliberately, then re-run.');
    process.exit(7);
  }
}
if (!Array.isArray(idx)) {
  console.error(`rollup: ${join(histDir, 'index.json')} parsed but is not an array — same refusal as corrupt; fix or remove it deliberately.`);
  process.exit(7);
}
// re-rollup of the SAME batch must keep its stamp AND sliceId (replace-in-place: the ledger
// upserts on (key, resolvedSlice) — a fresh wall-clock sliceId would duplicate every entry)
const prior = idx.filter((e) => (e.sliceVersion || 0) >= 1 && sourceKey(e.source, REG) === sourceId).pop();
if (prior && prior.stamp) stamp = prior.stamp;
else while (existsSync(join(histDir, `${stamp}.json`))) stamp = String(BigInt(stamp) + 1n); // never share a stamp across batches

const sliceId = (bm && bm.sliceId) || (prior && prior.sliceId) || `adhoc-${stamp}`;
const kind = (bm && bm.kind) || 'adhoc';
const scopeRepos = (bm ? bm.scope.repos.map((r) => r.name) : repos.map((r) => r.name)).filter((n) => !isSuperseded(n)); // lifecycle-superseded leave the ACTIVE scope
const anchors = (bm && bm.anchors) || {};

// SCOPE VERIFICATION (item 5). A batch declares the area it was swept for; every repo dir inside it
// must belong to that area. A mismatch means the batch is mixed — two sweeps sharing a directory,
// a hand-edited tree, or a repo whose area changed — and rolling it up would write one project's
// findings into another project's durable record under that project's name. There is no safe way to
// guess which half is right, so refuse. Exit 4 is distinct from 2 (empty batch — sweep continues)
// and 3 (lock), so sweep.mjs surfaces it as a failed phase instead of absorbing it as success.
// `--all` batches legitimately hold many areas' repos and are exempt; so are pre-area batches.
if (bm && bm.area && !bm.sweptAll) {
  const { areaOf } = await import('./registry.mjs');
  // SECOND site, same defect as the top of this file: this used to re-parse projects.json
  // independently with its own silent `catch { return null }`, which made `foreign` silently `[]`
  // whenever the re-parse failed — switching off the ONE check that exists to refuse a mixed-area
  // batch exactly when the registry is untrustworthy. REG (loaded, validated, fail-loud, above) is
  // already in scope; reusing it removes both the duplicate parse and the second swallow.
  const foreign = scopeRepos.filter((n) => areaOf(n, REG) !== bm.area);
  if (foreign.length) {
    console.error(`rollup: batch ${basename(reportsDir)} declares area '${bm.area}' but contains repo(s) belonging elsewhere: ` +
      foreign.map((n) => `${n} -> ${areaOf(n, REG)}`).join(', ') +
      `\n       refusing to roll a mixed batch — one project's findings would land in another's record.`);
    process.exit(4);
  }
}

// tool-run provenance: per-repo check statuses (checks-status.json, written by commitwork.mjs)
// plus artifact presence for the two CVE parsers. Lifecycle gating uses artifact presence —
// "the tool produced its report file in THIS batch" — which needs no check-name mapping.
const toolRuns = {};
for (const r of repos) {
  const dir = join(reportsDir, r.name);
  let checks = [];
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'checks-status.json'), 'utf8'));
    checks = Array.isArray(parsed) ? parsed : []; // shape guard only — matches the tolerance already applied below and at the scannerFleet loop
  } catch (err) {
    // Absent is legitimate — a build-health-only run writes no checks-status.json at all. Present but
    // UNREADABLE is not (the _ownerMap discipline below, applied here): warn, degrade to [], never
    // let a broken file masquerade as "nothing ran in this repo".
    if (err.code !== 'ENOENT') console.error(`rollup: ${r.name}/checks-status.json is present but unreadable — ${err.message}. This repo's check provenance (ran/skip/noscan) reads as untouched rather than broken.`);
  }
  // fact: a fail that wrote no report is a void, not a run / rewritten here so every counter below agrees; rows written before noReport existed are checked against the declared report file on disk (expiry: never, prev: missing)
  for (const c of checks) {
    if (!c || c.status !== 'fail' || !(c.noReport || _reportAbsent(dir, c.check))) continue;
    c.status = 'noscan';
    c.failed = true;
    if (typeof c.reason !== 'string' || !c.reason.trim()) c.reason = 'exited non-zero and wrote no report — nothing was scanned';
  }
  // A-1: an unparseable osv.sarif/npm-audit.json must surface as noscan for the repo, same as any
  // other coverage void — never as the zero findings a failed parse already produces on its own
  // (F1: a corrupt dep-CVE artifact used to render the repo clean). ONE mechanism: append the
  // checks-status entry the runner would have written had it known, and let the existing filter two
  // lines down count it. r.noscan must never ALSO be incremented directly — that double-counts the
  // same void.
  // Every non-ok, non-absent osv state is its own void flavour with its own reason
  const DEP_VOID_REASON = {
    unparseable: 'artifact present but unparseable',
    unreadable: 'artifact present but unreadable',
    empty: 'artifact present but empty',
    'never-ran': 'artifact present but not a sarif document — no runs[]',
    'tool-failed': 'artifact present but the tool reported failure',
  };
  const dps = depParseState[r.name];
  // "artifact present but empty" is true and tells the reader nothing: osv exits 128 both for a
  // repo that declares no dependencies and for one whose dependency set is unresolved, and it
  // cannot tell them apart. preflight can, so its verdict is appended here — where both facts are
  // in hand — rather than guessed at in the runner, which sees one repo and no prober.
  // The preflight clause is appended ONLY to `empty` — the state where the tool RAN and indexed
  // nothing, which is the one preflight can explain (declares no dependencies vs declares them
  // unresolved). A corrupt or unreadable artifact is a parse failure; the shape of the tree has no
  // bearing on it, and appending "preflight: …" there is noise wearing the clothes of a cause.
  if (dps && DEP_VOID_REASON[dps.osv]) {
    const reason = DEP_VOID_REASON[dps.osv] + (dps.osv === 'empty' ? preflightClause(_preflight, r.name, _batchStartedAt) : '');
    checks.push({ check: SCAN_CHECK_FOR_TOOL.osv, status: 'noscan', reason, at: genISO });
  }
  if (dps && dps.npm === 'unparseable') checks.push({ check: SCAN_CHECK_FOR_TOOL.npm, status: 'noscan', reason: 'artifact present but unparseable', at: genISO });
  // Socket REFUSED, as distinct from Socket never having been pointed here. Same one-mechanism rule
  // as the two lines above: append the checks-status entry the runner would have written had it
  // known, and let the existing noscan filter count it — `r.noscan` is never incremented directly.
  //
  // status stays 'noscan' ON PURPOSE. A refusal is a coverage void and must keep counting as one for
  // every consumer that filters on that string; the distinction rides on `refusal`, which the panel
  // colours violet (never grey, never green). A sibling status would have made a refusal invisible to
  // every void counter in the tree — the failure this lane already had once, restored by the fix for it.
  const sockRef = socketRefusal(dir);
  if (sockRef) {
    checks.push({
      // From SCANNER_CHECKS, not SCAN_CHECK_FOR_TOOL: the latter is the vuln-LIFECYCLE map and a test
      // pins it to exactly {osv, npm} on purpose, so widening it for a supply-chain lane would break a
      // deliberate boundary. And no `||` fallback — a literal standing by in case the lookup misses
      // would quietly emit a check id no consumer recognises, which is the same silent-degradation
      // shape this whole entry exists to remove.
      check: checkForScanner('supplyChain'),
      status: 'noscan',
      reason: sockRef.quota
        ? `Socket REFUSED the scan and its message names a quota or rate limit: ${sockRef.message}`
        : `Socket refused the scan: ${sockRef.message}`,
      refusal: { quota: sockRef.quota, message: sockRef.message },
      at: genISO,
    });
  }
  toolRuns[r.name] = { checks, artifacts: { osv: existsSync(join(dir, 'osv.sarif')), npm: existsSync(join(dir, 'npm-audit.json')) } };
  // D2 source: per-repo coverage-void count from F1's honest provenance (checks-status.json status
  // 'noscan' = ran, no trustworthy output). Attached to the repo so it flows into rollup.json's
  // repos[] and reaches the client-facing build-security-data.mjs; a run-path sweep has no index.md
  // grid, so this is the only place the noscan signal exists for that (the scheduled) path.
  const _voids = (Array.isArray(checks) ? checks : []).filter((c) => c && c.status === 'noscan');
  r.noscan = _voids.length;
  // A void count with no cause is a number a reader cannot act on or check. Carried per repo
  // because that is where the question is asked ("why does this repo have 3 voids?"); capped, and
  // a void whose reason the runner never recorded says so rather than being dropped from the list.
  if (_voids.length) {
    r.noscanReasons = _voids.slice(0, 12).map((c) => ({ check: c.check, reason: (typeof c.reason === 'string' && c.reason.trim()) || 'no reason recorded by the runner — the void is real, its cause is unrecorded' }));
  }
}
const toolRan = (repo, tool) => !!(toolRuns[repo] && toolRuns[repo].artifacts[tool]);

// an empty batch — no repo report dirs, or not one check/artifact produced anywhere — is a
// failed sweep, not a fleet-went-to-zero data point; refuse to write it into the history
// (sweep-20260709084307 landed as a false all-zero slice this way)
const ranAny = Object.values(toolRuns).some((t) => t.checks.length || t.artifacts.osv || t.artifacts.npm);

// TWO different situations produce an empty batch, and conflating them cost a nightly error
// cascade for a repo that had simply been deleted:
//
//   NOTHING ATTEMPTED (exit 3) — not one repo produced a report directory. The target is absent:
//     a projects.json entry whose path no longer resolves, or an area whose repos were all
//     filtered out. Nothing ran, nothing broke, and there is nothing to write. internal-b-dev sat
//     here for days: rollup refused (exit 2), then freshness could not read the rollup that was
//     never written, then timeline found no history — three errors a night, describing a missing
//     directory. Reported on stdout, and sweep.mjs skips the rollup-dependent steps after it.
//
//   ATTEMPTED, PRODUCED NOTHING (exit 2) — directories exist and every check is missing or
//     silent. That IS a failed sweep and must never enter history as a fleet-went-to-zero slice.
//     Unchanged: stderr, exit 2, and the start marker stays standing so liveness alarms.
//
// The distinction is "did any work get as far as creating a directory", which is the earliest
// point at which a sweep can be said to have attempted the repo at all.
//
// EXIT 4, not 3: 3 is already taken by lock contention above (":153 — sweep.mjs reads 3 as
// 'another rollup holds the lock' and continues"). Reusing it would make a contended rollup look
// like an absent target and skip the rollup-dependent steps that contention specifically must not
// skip. The lock releases itself here regardless — acquireLock is called with releaseOnExit.
const anyRepoDir = repos.some((r) => existsSync(join(reportsDir, r.name)));
if (!ranAny && !anyRepoDir) {
  console.log(`rollup: ${reportsDir} — nothing to roll up: no repo produced a report directory (target absent or fully filtered); nothing written`);
  process.exit(4);
}
if (!ranAny) { console.error(`rollup: ${reportsDir} — empty batch (repo dirs present, no tool output in any); nothing written`); process.exit(2); }

// finding identity: v1 key includes tool+path; legacyKey joins v0 history (dual-key bridge)
const keyOf = (f) => `${f.repo}|${f.tool}|${f.id}|${f.package}|${f.path || ''}`;
const legacyKeyOf = (f) => `${f.repo}|${f.id}|${f.package}`;
const allKeys = allF.map(legacyKeyOf); // legacy compat field, kept byte-identical in shape

// ── the scoped-package rename bridge (match-only, self-expiring) ────────────────────────────────
// parseOsv's message regex could not match a scoped package, so '@ctrl/tinycolor@4.1.1' produced
// package:''. Fixing it changes `package` — and package is a component of BOTH keys above.
//
// That is why the fix sat blocked. Without a bridge, every scoped finding leaves the key it has
// been carrying and arrives under a new one, so the SAME finding is simultaneously:
//   · the old key, absent from this slice  -> resolved-fixed-candidate
//   · the new key, absent from the last    -> born
// which is not cosmetic churn: `resolved-fixed-candidate` is a claim that somebody FIXED it, and it
// reaches the remediation ledger. A regex correction would have manufactured verified fixes for
// live malware — including the Shai-Hulud worm record this file's own comment cites.
//
// So a scoped finding also answers to the key it WOULD have had while the regex was broken. This is
// MATCH-ONLY: the emitted key/legacyKey are always the corrected ones, so once a single slice has
// been written with the fixed parse there is nothing left for the bridge to match and it becomes
// inert. It is not a permanent second identity, and nothing downstream reads it.
const scopedBridgeKeys = (f) => (String(f.package || '').startsWith('@')
  ? { key: keyOf({ ...f, package: '' }), legacyKey: legacyKeyOf({ ...f, package: '' }) }
  : null);

// previous slice = last v1 index row with a DIFFERENT source (a re-rollup of the same batch
// replaces itself and compares against its own predecessor); falls back to the newest v0
// snapshot (legacyKey join, ledger disabled — no mass-ledger on first v1 run).
let prevSlice = null, prevIsV1 = false;
for (let i = idx.length - 1; i >= 0 && !prevSlice; i--) {
  const e = idx[i];
  if ((e.sliceVersion || 0) >= 1 && sourceKey(e.source, REG) !== sourceId && e.file) {
    // The row the walk WOULD use is load-bearing: silently skipping an unreadable one falls back
    // to an OLDER slice, and the lifecycle diff then runs against a stale baseline — findings
    // resolved in the unreadable slice re-mint resolved-fixed-candidate (the ledger upserts on
    // (key, resolvedSlice), so duplicate FIXED entries), findings born in it re-mint born with a
    // false bornSlice. A comparison against the wrong baseline is indistinguishable from an honest
    // one downstream, so it must not happen at all. Nothing deletes history slices (retention
    // slims reports/ batches only), so a named-but-unreadable slice is corruption of the
    // index↔store pair either way — ENOENT included.
    try { prevSlice = JSON.parse(readFileSync(join(histDir, e.file), 'utf8')); prevIsV1 = true; }
    catch (err) {
      console.error(`rollup: previous slice ${join(histDir, e.file)} is named by the index but unreadable`
        + ` (${(err && err.message) || 'parse failure'}). Refusing to roll up: comparing against an older`
        + ' slice instead would mint false FIXED/born lifecycle events and duplicate ledger entries.'
        + ' Restore the slice, or remove its index row deliberately, then re-run.');
      process.exit(7);
    }
  }
}
if (!prevSlice) {
  const snaps = readdirSync(histDir).filter((f) => /^\d.*\.json$/.test(f) && f !== 'index.json').sort();
  for (let i = snaps.length - 1; i >= 0 && !prevSlice; i--) {
    try { const s = JSON.parse(readFileSync(join(histDir, snaps[i]), 'utf8')); if (s.source !== reportsDir && !s.sliceVersion) prevSlice = s; } catch {}
  }
}
// (idx was loaded above, before the stamp/sliceId reuse check)

// ---- lifecycle: states on current findings ----
const prevByKey = new Map(), prevByLegacy = new Map();
if (prevSlice) for (const p of prevSlice.findings || []) {
  if (p.key) prevByKey.set(p.key, p);
  prevByLegacy.set(p.legacyKey || `${p.repo}|${p.id}|${p.package}`, p);
}
const prevSliceId = prevSlice ? (prevSlice.sliceId || prevSlice.stamp || 'v0') : null;
for (const r of repos) for (const f of r.findings) {
  f.key = keyOf({ ...f, repo: r.name }); f.legacyKey = legacyKeyOf({ ...f, repo: r.name });
  // the bridge is consulted LAST, so a finding that matches on its real identity never reaches it
  const _b = scopedBridgeKeys({ ...f, repo: r.name });
  const prev = prevByKey.get(f.key) || prevByLegacy.get(f.legacyKey)
    || (_b && (prevByKey.get(_b.key) || prevByLegacy.get(_b.legacyKey)));
  f.state = prev ? 'persisting' : 'born';
  f.bornSlice = prev ? (prev.bornSlice || prevSliceId) : sliceId;
  f.status = prev ? 'persisting' : 'new'; // legacy compat field
}

// ---- lifecycle: resolution of prev findings, GATED on scope + tool provenance ----
// A prior finding may only resolve if its repo was scanned in this batch AND its tool
// produced a report. Out-of-scope / tool-didn't-run => carried (unknown-not-scanned), never
// "fixed" — this kills the observed 456-fake-fixed failure mode of the naive diff.
const scannedNames = new Set(repos.map((r) => r.name));
const nowKeys = new Set(), nowLegacy = new Set();
for (const r of repos) for (const f of r.findings) {
  nowKeys.add(f.key); nowLegacy.add(f.legacyKey);
  // THE HALF THAT PREVENTS A FABRICATED FIX. The loop below resolves any prior finding whose key is
  // not in these sets. A prior scoped finding carries the OLD (blank-package) key, which the
  // corrected parse no longer produces — so without publishing the bridge key here as "still
  // present", every scoped finding in the fleet would be written out as resolved-fixed-candidate on
  // the first roll after the regex change.
  const _b = scopedBridgeKeys({ ...f, repo: r.name });
  if (_b) { nowKeys.add(_b.key); nowLegacy.add(_b.legacyKey); }
}
const carried = [], resolvedF = [];
if (prevSlice) for (const p of prevSlice.findings || []) {
  const plk = p.legacyKey || `${p.repo}|${p.id}|${p.package}`;
  if ((p.key && nowKeys.has(p.key)) || nowLegacy.has(plk)) continue; // still present
  if (EXCLUDE.has(p.repo)) { resolvedF.push({ ...p, state: 'resolved-scope', resolvedSlice: sliceId }); continue; }
  if (isSuperseded(p.repo)) { resolvedF.push({ ...p, state: 'resolved-superseded', resolvedSlice: sliceId, supersededBy: (lifecycleOf(p.repo) || {}).supersededBy || '' }); continue; }
  if (!scannedNames.has(p.repo) || !toolRan(p.repo, p.tool)) {
    carried.push({ ...p, state: 'unknown-not-scanned', carriedFrom: prevSliceId });
    continue;
  }
  resolvedF.push({ ...p, state: 'resolved-fixed-candidate', resolvedSlice: sliceId });
}
// carried findings from the PREVIOUS slice's carried block stay carried (chain until rescanned)
if (prevSlice) for (const p of prevSlice.carried || []) {
  const plk = p.legacyKey || `${p.repo}|${p.id}|${p.package}`;
  if ((p.key && nowKeys.has(p.key)) || nowLegacy.has(plk)) continue; // repo rescanned, finding still there -> already 'persisting' above
  if (isSuperseded(p.repo)) { resolvedF.push({ ...p, state: 'resolved-superseded', resolvedSlice: sliceId, supersededBy: (lifecycleOf(p.repo) || {}).supersededBy || '' }); continue; }
  if (scannedNames.has(p.repo) && toolRan(p.repo, p.tool)) { resolvedF.push({ ...p, state: 'resolved-fixed-candidate', resolvedSlice: sliceId }); continue; }
  carried.push(p);
}

// ---- annotations overlay (as-of slice time; append-only log, canonical store) ----
// CW_ANNOTATIONS overrides the store path so tests run on fixtures; the default is the private dir
// (monitor/private/annotations.json). Only ENOENT is "legitimately absent": a parse or permission
// failure must never quietly become an empty ledger — the rollup would then claim the store was
// consulted while suppressing (or un-suppressing) on garbage.
const annotationsPath = annotationsPathFor(CW);
let annots = []; let scannerAnnots = [];
try {
  const _annDoc = JSON.parse(readFileSync(annotationsPath, 'utf8'));
  annots = _annDoc.annotations || [];
  scannerAnnots = _annDoc.scannerAnnotations || [];
} catch (e) {
  if (!e || e.code !== 'ENOENT') throw new Error(`annotations store unreadable (${annotationsPath}): ${e && e.message}`);
}
// as-of matcher extracted to annotate-lib.mjs; annActive binds this slice's genISO so the
// call sites below stay byte-identical. annMatch is imported directly (no `now` dependency).
const annActive = (a) => annActiveAsOf(a, genISO);
let acceptedCount = 0;
for (const r of repos) for (const f of r.findings) {
  const a = annots.find((x) => annActive(x) && annMatch(x, { ...f, repo: r.name }));
  if (a) { f.annotation = annotationView(a); acceptedCount++; }
}
for (const p of resolvedF) {
  if (p.state !== 'resolved-fixed-candidate') continue;
  const a = annots.find((x) => annActive(x) && annMatch(x, p));
  if (a) { p.state = 'resolved-accepted'; p.annotation = annotationView(a); }
}

// ---- stale-acceptance reconcile: an ACTIVE acceptance that matches zero live findings in a
// repo that WAS scanned this slice means the finding was fixed (or vanished) while the ledger
// still carries the acceptance — the display then shows "accepted" counts detached from scan
// reality (picomatch in a client admin console, 2026-07-20, was exactly this). Surface, never silence.
const annScanned = new Set(repos.map((r) => r.name));
const staleAnnotations = annots.filter((a) =>
  annActive(a) && a.repo && annScanned.has(a.repo)
  && !repos.some((r) => (r.findings || []).some((f) => annMatch(a, { ...f, repo: r.name }))));

// ---- verified-remediation ledger (only between two v1 slices) ----
const candidates = resolvedF.filter((p) => p.state === 'resolved-fixed-candidate');
let ledgerRes = { entries: [], cleaned: [], unconfirmed: [] };
if (prevIsV1 && candidates.length) {
  ledgerRes = updateLedger({ ledgerPath: join(OUT, 'remediation-ledger.json'), sliceId, prevSliceId,
    candidates, anchors, prevAnchors: prevSlice.anchors || {}, generated: genISO });
}
const tierByKey = new Map(ledgerRes.entries.map((e) => [e.key, e.evidence.tier]));
for (const p of candidates) {
  const tier = tierByKey.get(p.key || keyOf(p));
  p.state = tier && tier !== 'weak' ? 'resolved-fixed' : 'resolved-unconfirmed';
}
const cleanedList = candidates.filter((p) => p.state === 'resolved-fixed');
const bornCount = repos.reduce((n, r) => n + r.findings.filter((f) => f.state === 'born').length, 0);

// Dependency-lane suppressions are the only ones totals has not already applied: the
// scanner-annotations overlay decrements the severity aggregates before sumTotals runs (see :1209).
const SEV_KEYS = ['crit', 'high', 'med', 'low'];
const suppressedDep = Object.fromEntries(SEV_KEYS.map((s) =>
  [s, repos.reduce((n, r) => n + r.findings.filter((f) => f.severity === s && f.annotation).length, 0)]));

// openTotals is built below, where `totals` exists — using it here is a TDZ throw node --check accepts.
const openTotalsFor = (tot) => Object.fromEntries(SEV_KEYS.map((k) => [k, Math.max(0, (tot[k] || 0) - suppressedDep[k])]));
const openTotalsMetaFor = (tot) => ({
  lane: 'all',
  population: 'the same population as totals — CVE feed plus every scanner lane, minus excludedFromTotals',
  suppressedBy: 'annotation',
  suppressedDep,
  note: 'open = totals minus suppressions. Scanner suppressions are already out of totals (the '
    + 'annotations overlay decrements the aggregates before sumTotals), so only dependency-lane '
    + 'annotations are subtracted here. They are 0 today, which is why open currently equals totals.',
});
const scanned = { repos: repos.length, intendedRepos: scopeRepos.length,
  osv: repos.filter((r) => toolRan(r.name, 'osv')).length, npm: repos.filter((r) => toolRan(r.name, 'npm')).length };
const prevScope = prevSlice && prevSlice.scope ? prevSlice.scope.repos || [] : null;
const removedNow = prevScope ? prevScope.filter((n) => !scopeRepos.includes(n)) : [];
const scopeDelta = prevScope
  ? { added: scopeRepos.filter((n) => !prevScope.includes(n)), removed: removedNow,
      superseded: removedNow.filter(isSuperseded).map((n) => ({ name: n, supersededBy: (lifecycleOf(n) || {}).supersededBy || '', effectiveFrom: (lifecycleOf(n) || {}).effectiveFrom || '' })) }
  : { added: [], removed: [], superseded: [] };

// ---- fleet coverage (S1): discovery-resolved vs actually-in-this-batch ----
// resolveRepos() resolves the whole fleet (explicit projects + roots auto-discovery, minus
// exclude/lifecycle — the sweep's own universe, same selfRoot/stamp rules as sweep.mjs:55) and
// this batch holds some subset of it. Nothing computed that difference: a repository discovery
// finds and the sweep never scans produced NO signal anywhere, forever (measured 2026-07-31:
// 63 resolved, 18 in the last batch, 45 silently unswept — including live services). `scanned`
// above cannot say this: scanned.repos/intendedRepos is scoped to the BATCH's intended repos
// (18/26 for an area sweep), which reads like a fleet number while describing one area. `scope`
// records which kind of sweep this was so a reader knows whether a large `unswept` is "this
// area's sweep legitimately ignores the rest of the fleet" or "the fleet sweep missed repos" —
// either way the gap is now a first-class fact, and liveness.mjs degrades on it rather than
// letting an on-time area rollup read as a healthy fleet.
// Names are sorted so a re-rollup of the same batch stays byte-identical (rerollup-identical gate).
const fleetResolved = resolveRepos(REG, { selfRoot: CW, stamp: BATCH_STAMP }).repos.map((r) => r.name).sort();
const sweptNames = new Set(repos.map((r) => r.name));
// TWO GAPS, AND ONLY ONE OF THEM IS THIS BATCH'S FAULT. `unswept` is fleet-wide: every repo
// discovery resolves that this batch did not scan. For a per-area agent that is the whole rest of
// the fleet BY CONSTRUCTION, which is why liveness.mjs's own comment describes its `degraded` state
// as firing "by construction rather than by condition" and routes it to stdout so 25 nightly agents
// do not each leave a non-empty .err. That treated the noise; the cause is that the artifact only
// ever carried the fleet number, so the deadman had nothing else to classify on and was true on
// every scheduled run — an always-on signal, which is no signal.
//
// `unsweptInScope` is the conditional half: repos THIS batch declared it would cover and did not.
// Zero for a healthy area sweep, non-zero only when a sweep actually failed to do its own job. The
// console block below has drawn exactly this distinction since it was written (loud+named for the
// in-scope gap, a bare count for the rest) — it simply computed it locally and never persisted it,
// so liveness, which reads the artifact rather than the log, could not see it.
//
// Sorted like `unswept` so a re-rollup of the same batch stays byte-identical (rerollup-identical).
const coverage = {
  resolved: fleetResolved.length,
  swept: repos.length,
  unswept: fleetResolved.filter((n) => !sweptNames.has(n)),
  unsweptInScope: scopeRepos.filter((n) => !sweptNames.has(n)).sort(),
  scope: bm && bm.sweptAll ? 'fleet-wide' : bm && (bm.area || bm.only) ? 'area-scoped' : 'unknown',
};

// ══════════ writes, in healing order: enrichment → slice → rollup → views → LOG → index LAST ══════════
// The index row is the commit marker; everything before it is idempotent (upserts/dedupe), so a
// crash mid-sequence heals on re-rollup of the same batch. Do not reorder index earlier.

// frozen enrichment — the FILTERED subset (this slice's CVE ids only): same per-slice fidelity,
// no catalog-scale accumulation; null epss means "no score known", distinct from 0.0
mkdirSync(join(histDir, 'enrichment'), { recursive: true });
const kevSub = {}, epssSub = {};
for (const id of cveIds) { if (kevSet.has(id)) kevSub[id] = true; if (id in epss) epssSub[id] = epss[id]; }
// ATOMIC: these are FROZEN per-slice copies — unlike monitor/data/kev.json|epss.json, which stay
// live and get re-fetched, nothing ever re-derives a torn one. A truncated file here is a permanent
// hole in that slice's own historical record.
writeAtomic(join(histDir, 'enrichment', `${stamp}-kev.json`), JSON.stringify(kevSub, null, 1));
writeAtomic(join(histDir, 'enrichment', `${stamp}-epss.json`), JSON.stringify(epssSub, null, 1));

const recOf = (f) => ({ repo: f.repo, tool: f.tool, id: f.id, severity: f.severity, cvss: f.cvss, package: f.package, version: f.version,
  path: f.path || '', fixed: f.fixed, range: f.range || '', title: f.title, advisory: f.advisory,
  key: f.key, legacyKey: f.legacyKey, state: f.state, bornSlice: f.bornSlice, kev: f.kev, epss: f.epss, annotation: f.annotation });
const nowRecs = repos.flatMap((r) => r.findings.map((f) => recOf({ ...f, repo: r.name })));
const bornList = nowRecs.filter((f) => f.state === 'born');

// ---------- C03/C26: vuln-lifecycle enrichment (ADDITIVE, side-effect-contained) ----------
// Decorates nowRecs with identity (CVE/GHSA else minted CWX), derived-foundational, weaknessClass,
// per-repo technology, dwell, defence vector + residual verdict, and SLA/escalation detection; then
// writes lifecycle.json + persists the CWX registry. Wrapped: any failure here MUST NOT break the
// sweep — the CVE ledger/totals/dashboard above are already computed and are the load-bearing output.
// true only when remediation-ledger.json exists but failed to parse this run (set inside the
// enrichment block below, published on the slice — see A-2's slice.ledgerUnreadable). Declared
// outside the try so a later failure in the SAME block cannot erase what the ledger read already
// established.
let ledgerUnreadable = false;
try {
  // Absent is a legitimate state (the map's own contract: no entry => bugBelongsTo null). Present
  // but UNREADABLE is not — it silently strips every ownership attribution in the run, and the
  // result is indistinguishable from a fleet nobody has mapped. Enrichment is additive so this
  // warns rather than exits, but it does not pass in silence.
  const _ownerMap = (() => {
    try { return JSON.parse(readFileSync(ownerMapPathFor(CW), 'utf8')); } catch (err) {
      if (err.code !== 'ENOENT') console.error(`rollup: ${ownerMapPathFor(CW)} is present but unreadable — ${err.message}. `
        + 'Every finding in this run gets bugBelongsTo null, which reads as "unmapped fleet" rather than "broken file".');
      return {};
    }
  })();
  // Same split as _ownerMap above: absent means "no CWE table shipped", unreadable means a broken
  // file masquerading as one. Either way weaknessClass degrades to [] (additive enrichment), but only
  // the second is worth a word — an ENOENT here is the normal state on every run.
  const _ruleCwe = (() => {
    try { const t = JSON.parse(readFileSync(join(HERE, 'ruleId-cwe.json'), 'utf8')); return { ...t.semgrep, ...t.codeql, ...t.spotbugs, ...t.eslint, ...t.internal, ...t.cobolwork }; }
    catch (err) {
      if (err.code !== 'ENOENT') console.error(`rollup: monitor/ruleId-cwe.json is present but unreadable — ${err.message}. Every SAST finding in this run gets weaknessClass [] from this table, which reads as "no CWE mapped" rather than "broken file".`);
      return {};
    }
  })();
  // Unlike _ownerMap/_ruleCwe, a corrupt ledger is not left as a quiet console.error: it feeds
  // resolved-fixed-candidate -> resolved-fixed evidence tiers, so silently reading it as "[]" would
  // make VERIFIED remediation vanish from this slice exactly like a genuinely empty ledger would —
  // indistinguishable from "nothing has been fixed yet". ledgerUnreadable makes that distinguishable.
  const _ledgerEntries = (() => {
    try { const l = JSON.parse(readFileSync(join(OUT, 'remediation-ledger.json'), 'utf8')); return Array.isArray(l) ? l : (l.entries || l.ledger || []); }
    catch (err) {
      if (err.code !== 'ENOENT') {
        ledgerUnreadable = true;
        console.error(`rollup: ${OUT}/remediation-ledger.json is present but unreadable — ${err.message}. Verified-remediation evidence for this run reads as absent rather than broken; see slice.ledgerUnreadable.`);
      }
      return [];
    }
  })();
  const _cwxPath = join(OUT, 'cwx-registry.json');
  const _cwxState = (() => { try { return JSON.parse(readFileSync(_cwxPath, 'utf8')); } catch { return null; } })();
  // F.5.2: the advisory CWE ids npm audit already wrote into this batch's artifacts. `ruleCweTable`
  // above is keyed on SAST rule ids and structurally cannot match a dependency finding, which is why
  // weaknessClass was [] on every live record; this is the source that can. Best-effort like every
  // other read in this block — a missing/unreadable artifact just means no class for those findings.
  const _advisoryCwe = (() => { try { return readAdvisoryCweIndex(reportsDir, repos.map((x) => x.name)); } catch { return null; } })();
  // The call-graph proof govulncheck already produced, joined onto the findings it decides.
  //
  // Built from `repos` and NOT from `scannerFindings`: that flattening happens ~330 lines below
  // this point, so reading it here is a temporal dead zone. The first cut of this did exactly that
  // — a ReferenceError swallowed by the catch below, leaving the seam wired, green, and joining
  // nothing. The same shape is reconstructed here, attaching `repo` the way the later flatten does.
  let _reachIndex = null, _aliasIndex = null, _reachBuildError = null;
  try {
    const _goRows = [];
    for (const r of repos) {
      const c = r.scanners && r.scanners.depsGo;
      if (c && Array.isArray(c.findings)) for (const f of c.findings) _goRows.push({ repo: r.name, ...f });
    }
    _reachIndex = buildReachabilityIndex({ scannerFindings: { depsGo: _goRows } }, genISO);
    // Without this the join was measured at 0.31%: govulncheck proves against GO- ids while the
    // dependency lane records CVEs. Its absence degrades the join, never the correctness.
    try { _aliasIndex = buildAliasIndex({}); } catch (e) { _aliasIndex = null; _reachBuildError = `alias index: ${e && e.message}`; }
  } catch (e) {
    // NAMED, not swallowed. A bare catch here hid two ReferenceErrors while this was being written
    // — a dead-zone read and a missing import — each leaving the seam wired, green and joining
    // nothing, which is the exact failure this seam exists to end. A programmer error must not be
    // indistinguishable from "no Go findings this slice", so it rides out in the artifact below.
    _reachIndex = null;
    _reachBuildError = `${e && e.name}: ${e && e.message}`;
  }

  const _lc = assembleLifecycle(nowRecs, {
    historyRows: idx, ledgerEntries: _ledgerEntries, ownerMap: _ownerMap,
    ruleCweTable: _ruleCwe, advisoryCwe: _advisoryCwe, toolRuns, cwxState: _cwxState, nowIso: genISO,
    // so a map declaring $scope.area is not applied to another area's like-named repos
    area: rollupArea,
    reachIndex: _reachIndex, aliasIndex: _aliasIndex,
  });
  // F.5.3: schemaViolations is the schema contract's live report. It is written INTO the artifact
  // (an empty array is the affirmative "checked, conforms" — not the same as an absent field) and
  // echoed into the sweep log, so a producer/schema divergence is loud instead of invisible.
  // ATOMIC: lifecycle.json is re-read by the NEXT sweep's own lifecycle assembly, and cwx-registry.json
  // is the append-only CWX id registry the rerollup-identical gate asserts never shrinks — a torn read
  // of either falls through this block's own bare catches (both are read via the same best-effort
  // pattern as _ownerMap/_ruleCwe above) and degrades to "start fresh", silently losing minted ids.
  // reachJoin is published, not merely returned: a join that silently degrades to zero looks
  // identical to a fleet with no Go findings, and the only way to tell is to have written the
  // number down. reachBuildError is null on a healthy run and a string when the index could not be
  // built at all — absent evidence with its reason attached, rather than a quiet empty index.
  writeAtomic(join(OUT, 'lifecycle.json'), JSON.stringify({ sliceId, generated: genISO, aggregates: _lc.aggregates, schemaViolations: _lc.schemaViolations, reachJoin: { ..._lc.reachJoin, indexEntries: _reachIndex ? _reachIndex.size : 0, aliasIndex: !!_aliasIndex, error: _reachBuildError }, records: _lc.records }, null, 1));
  writeAtomic(_cwxPath, JSON.stringify(_lc.cwxState, null, 1)); // persist minted CWX ids (append-only across sweeps)
  if (_lc.schemaViolations && _lc.schemaViolations.length) {
    const head = _lc.schemaViolations.slice(0, 20).map((m) => `  - ${m}`).join('\n');
    appendFileSync(join(OUT, 'history', 'LOG.md'),
      `\n<!-- lifecycle-record schema: ${_lc.schemaViolations.length} violation(s) in ${sliceId}\n${head}\n-->\n`);
  }
} catch (e) {
  try { appendFileSync(join(OUT, 'history', 'LOG.md'), `\n<!-- lifecycle enrichment skipped: ${String(e && e.message || e).slice(0, 200)} -->\n`); } catch {}
}

// the slice — schema/slice.schema.json; v0 snapshots keep their old shape untouched
// ---------- all-scanner coverage (ADDITIVE: NOT merged into the CVE ledger/totals) ----------
// The lifecycle above deliberately tracks only osv+npm — stable finding identity and the CVE
// consumer contract (build-security-data / map / overwatch-layer). This block surfaces every OTHER
// scanner that ran — JVM CVEs, SAST, supply-chain, secrets, IaC, DAST/BOLA — as per-tool
// severity counts, so the dashboard reflects the full suite without polluting totals/EPSS/ledger.
// Read-only over the report files already on disk; a tool with no report = omitted (did not run).
for (const r of repos) {
  const dir = join(reportsDir, r.name);
  const s = {};
  // The provenance stamp rides on the category that ran, not in a sidecar map: a reader holding a
  // findings block must be able to ask "which binary produced this" without a second lookup, and a
  // block that answers `not-recorded` is telling the truth about a sweep written before stamping
  // existed. Never back-filled from what is installed now — see _toolProvenance.
  for (const [key, checkId, fn] of SCANNER_SPECS) {
    const c = fn(dir);
    // STAMP THE EXTRACTOR'S OWN BLOCK, THEN merge provenance. _toolProvenance answers
    // `not-recorded` whenever a tool-version stamp is missing, and that is one of the fifteen
    // legacy unknown words — so stamping the MERGED object marked lanes that had scanned cleanly
    // and found real HIGHs as unknown. Provenance describes the tool stamp; it says nothing about
    // whether the scan reached its subject.
    // Belt AND braces, deliberately: unknown.mjs's DETERMINATION_FIELDS also excludes `provenance`,
    // and each fix alone is sufficient here (measured — reverting either still passes
    // rollup-unknown-stamp.test.mjs; reverting both fabricates the void). The narrowing is the
    // general guard because it protects every caller; this ordering is the local one.
    if (c) s[key] = { ...stampUnknown(c), ..._toolProvenance(dir, checkId) };
  }
  // D15 close-out. Socket's criticalCVE cites no advisory id, so it cannot join the alias-keyed
  // dedupe parseOsv feeds; it joins on PLACE, and only here — this is the first point where the
  // lane's rows and the repo's advisory rows are both in hand. A row the CVE lanes also report
  // stays undetermined and names who else saw it; a row nobody else reports is Socket's own
  // witness of a critical advisory and grades crit.
  if (s.supplyChain) s.supplyChain = regradeSocket(s.supplyChain, r.findings, { repo: r.name });
  if (Object.keys(s).length) r.scanners = s;
}

// R1b — VOID CARRY: extractors.mjs's void vocabulary has five flavours that must all read as a
// coverage gap, never a clean scan (its own header, ~:16-40): `unparseable` (corrupt artifact),
// `norules` (valid SARIF, a run executed, but zero rules were loaded — the semgrep-empty-ruleset
// class), `neverran` (valid JSON, no runs[] — the tool's own error object where a SARIF should
// be), `toolfailed` (SARIF whose invocation channel reports failure with zero results), and a
// bare `null` return (not an affirmed completion — Socket's own {ok:false} husk,
// among others). A-1 above already carries every non-ok state for the two CVE parsers (parseOsv/
// parseNpm) into a synthetic checks-status `noscan` entry so r.noscan sees it; this is the SAME
// mechanism, generalised to every SCANNER_SPECS category, for `unparseable` AND `norules` alike —
// r.scanners only exists as of the loop just above, so this pass has to follow it rather than live
// inside the toolRuns loop (~:493) that runs before r.scanners is even assembled. `null` needs
// nothing added here: line 870's `if (c) s[key] = c` never lets a void reach r.scanners[key] at
// all, so it already reads through checks-status.json's own ran/skip/noscan provenance, exactly
// like any other absent artifact.
//
// SAME rule A-1 states: the synthetic entry sits ALONGSIDE whatever checks-status.json already
// recorded — never replacing it, because a real record must never be dropped to make room for a
// derived one — and r.noscan is recounted from the fuller array, never incremented a second way.
//
// ONE checkId, AT MOST ONE synthetic noscan. `deps-osv` is shared: it is SCAN_CHECK_FOR_TOOL.osv
// (A-1's CVE-lane push, already in `tr.checks` by the time this runs) AND SCANNER_SPECS'
// `maliciousPackages` checkId — both read osv.sarif, so a single truncated file makes BOTH
// depParseState.osv and r.scanners.maliciousPackages.unparseable true at once. Without this guard
// that is the SAME void counted twice under one checkId, not two distinct voids.
for (const r of repos) {
  if (!r.scanners) continue;
  const tr = toolRuns[r.name];
  if (!tr || !Array.isArray(tr.checks)) continue;
  for (const [key, checkId] of SCANNER_SPECS) {
    const c = r.scanners[key];
    if (!c || (!c.unparseable && !c.norules && !c.neverran && !c.toolfailed)) continue;
    if (tr.checks.some((chk) => chk && chk.status === 'noscan' && chk.check === checkId)) continue;
    tr.checks.push({ check: checkId, status: 'noscan',
      reason: c.unparseable ? 'artifact present but unparseable'
        : c.norules ? 'artifact present but zero rules loaded'
          : c.neverran ? 'artifact present but not a sarif document — no runs[]'
            : 'artifact present but the tool reported failure',
      at: genISO });
  }
  r.noscan = tr.checks.filter((chk) => chk && chk.status === 'noscan').length;
}

// S2 — never aggregate a noscan into a zero. checks-status.json is honest per repo (pass | skip |
// noscan with a reason) and this aggregation used to destroy that: only crit/high/med/low/total/repos
// survived, so a category with ZERO successful runs anywhere summed to total:0 — byte-identical to
// "ran everywhere, found nothing" (measured 2026-07-31: sast-codeql 0 pass/5 skip/13 noscan and
// supply-chain-socket 0/12/6 both presented as clean zeros). Each entry now carries ran/skipped/
// noscan REPO COUNTS from checks-status.json, and a category whose check was in scope somewhere is
// emitted even when no artifact exists at all (previously it was silently omitted — the same void,
// one layer up). `repos` keeps its existing meaning (repos with a parseable artifact; consumers:
// cra/controls.mjs) — `ran` is the run-provenance count and the two legitimately differ: a noscan
// can leave an artifact husk (socket.json {ok:false}) that parses to zero findings.
// A SKIP IS TWO DIFFERENT VERDICTS WEARING ONE STATUS. bin/commitwork.mjs writes both through
// `status: 'skip'`, and only the reason string separates them:
//   "n/a — none of go.mod present"            the target language/manifest is absent. A CORRECT
//                                             exclusion; there is nothing here to scan and nothing
//                                             for an operator to do about it.
//   "runtime scanner — no live URL (set …)"   the check APPLIES here and was denied its input. A
//                                             real coverage gap, and an actionable one.
// Counting them together is what made every skip render as one undifferentiated VOID: client-d's
// "no JVM build" sat in the same bucket as "BOLA was never given a URL", so the row that needed an
// operator looked exactly like the seven that never could. The counts alone cannot recover this —
// the reason is the only evidence — so classify here, once, where the reason is still in hand.
const NA_SKIP = /^n\/a\b/i;

// monitor/codeql-coverage.mjs's four states mapped onto the lane-coverage vocabulary the runner and
// the panel already share. The two that license a zero become `full`; the two that do not split by
// whether the gap was MEASURED (`partial` -> reduced, a known size) or could not be established at
// all (`unmeasurable` -> unknown). That split is not cosmetic: fifteen lines below, `unknown`
// outranks `reduced` in aggregation precisely because an unestablished gap cannot be judged.
// `no-language` is `full` deliberately — a repo with no C++ in it was completely covered for the
// C++ that exists, and calling that a coverage gap would report every polyglot fleet as half-blind.
const SCAN_COVERAGE_TO_LANE = Object.freeze({
  covered: 'full',
  'no-language': 'full',
  partial: 'reduced',
  unmeasurable: 'unknown',
});

// Worst-wins over two independent readings. null means "that instrument said nothing", which is
// NOT a vote for full — it drops out and lets the other instrument speak. Both null returns null so
// the caller counts the repo in no bucket, keeping "not covered" distinguishable from "not recorded".
const COVERAGE_RANK = { full: 0, reduced: 1, unknown: 2 };
function worstCoverage(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return COVERAGE_RANK[a] >= COVERAGE_RANK[b] ? a : b;
}

const scannerFleet = {};
// THE FLEET-LEVEL ANSWER TO "how much of what we published is not a result".
// monitor/unknown.mjs unified fifteen per-lane adjectives into one predicate so this could be
// asked once; it then went unasked for three days, which is the wired-therefore-protected shape in
// the very code that names it. `total` is the DENOMINATOR (every block that exists), so a rate can
// be computed without inventing one — and blocks:0 with total:0 is honestly different from
// blocks:0 with total:400.
const fleetUnknown = { blocks: 0, total: 0, byReason: {} };
for (const [key, checkId] of SCANNER_SPECS) {
  const withArtifact = repos.filter((r) => r.scanners && r.scanners[key]);
  let ran = 0, skipped = 0, noscan = 0, naSkips = 0, blockedSkips = 0;
  let lastRunAt = null, lastCheckedAt = null, blockedReason = null, naReason = null;
  // Counted separately from status: a check can be `pass` with reduced coverage, or `fail` with it.
  // Rows written before the coverage field existed carry no key and are counted in none of these,
  // which is what keeps "not covered" distinguishable from "not recorded".
  let covFull = 0, covReduced = 0, covUnknown = 0;
  let reducedReason = null, unknownReason = null, noscanReason = null;
  for (const r of repos) {
    const checks = toolRuns[r.name] && Array.isArray(toolRuns[r.name].checks) ? toolRuns[r.name].checks : [];
    const c = checks.find((x) => x && x.check === checkId);
    // A SECOND, ARTIFACT-DERIVED COVERAGE SOURCE. `c.coverage` above is written by the RUNNER from
    // the tool's log (bin/commitwork.mjs coverageSignals). monitor/codeql-coverage.mjs derives the
    // same fact from the SARIF's own extraction notifications, which is a different instrument on
    // the same question: the runner reads prose the tool printed, this reads structure the tool
    // emitted, and neither is downstream of the other. They agreed to the file on the case that
    // prompted it — CodeQL's log says "scanned 235 out of 370 C/C++ files" and the notification
    // count says 235/370 — so the value here is redundancy, not novelty, and a future disagreement
    // is a finding rather than a conflict to resolve silently.
    //
    // It exists because coverageSignals cannot express this shape: it counts MATCHES of a gap
    // pattern against matches of a denominator pattern, so a single line carrying both integers
    // has no declaration that reads it. Extending that parser would put deps-osv's live signal at
    // risk for a case it was not built for.
    const scanCov = r.scanners && r.scanners[key] && r.scanners[key].coverage;
    const scanState = scanCov ? SCAN_COVERAGE_TO_LANE[scanCov.state] || null : null;
    if (!c && !scanState) continue;
    const at = c && typeof c.at === 'string' ? c.at : null;
    // TWO TIMESTAMPS, BECAUSE THEY ANSWER TWO QUESTIONS. `lastCheckedAt` dates the EVIDENCE — when
    // the sweep last reached a verdict here, including a verdict of "skipped". `lastRunAt` dates a
    // RUN, and may therefore only advance on pass/fail. This single line used to sit outside the
    // status branches and set lastRunAt from any row, which is how a category that has never run in
    // its life carried a fresh run timestamp: the panel printed "ran 13h ago" directly beside its
    // own "VOID — never ran" pill, each reading from this one field.
    if (at && (!lastCheckedAt || at > lastCheckedAt)) lastCheckedAt = at;
    if (!c) { /* artifact-only row: no run provenance to count, coverage still tallied below */ }
    else if (c.status === 'pass' || c.status === 'fail') { ran++; if (at && (!lastRunAt || at > lastRunAt)) lastRunAt = at; }
    else if (c.status === 'skip') {
      skipped++;
      const reason = typeof c.reason === 'string' ? c.reason.trim() : '';
      if (NA_SKIP.test(reason)) { naSkips++; if (!naReason) naReason = reason; }
      else { blockedSkips++; if (!blockedReason) blockedReason = reason; }
    }
    else if (c.status === 'noscan') {
      noscan++;
      // The COUNT of voids shipped without their cause: a category could publish `noscan: 5` and
      // nothing anywhere said why, which is the same shape as a finding with no evidence. `skipped`
      // has carried its reason since it was added; this is that field's missing twin.
      const reason = typeof c.reason === 'string' ? c.reason.trim() : '';
      if (!noscanReason && reason) noscanReason = reason;
    }
    // Tallied OUTSIDE the status branches on purpose: coverage is orthogonal to status, so gating it
    // on any one branch would drop the case the field exists for — a check that FOUND things while
    // half-blind. A row with no coverage key predates the field and is counted nowhere.
    //
    // TWO SOURCES, WORST WINS, ONE TALLY PER REPO. The runner's log-derived verdict and the
    // extractor's artifact-derived one are merged here rather than counted twice — double-counting
    // one repo would inflate the denominator and make a fully-covered fleet look half-measured.
    // Worst-wins mirrors the category-level rule fifteen lines below for the same reason: a lane
    // that ONE instrument says is blind is a lane with a blind instrument, and preferring the
    // comfortable reading is the whole failure this field exists to remove.
    const rowCov = c && (c.coverage === 'full' || c.coverage === 'reduced' || c.coverage === 'unknown') ? c.coverage : null;
    const cov = worstCoverage(rowCov, scanState);
    if (cov === 'full') covFull++;
    else if (cov === 'reduced') {
      covReduced++;
      // The runner's reason is preferred when both exist: it names the tool's own words. The
      // scanner's is used when the runner had none, so a gap never goes out unexplained.
      if (!reducedReason) reducedReason = String((c && c.coverageReason) || (scanState === 'reduced' && scanCov && scanCov.reason) || '') || null;
    } else if (cov === 'unknown') {
      covUnknown++;
      if (!unknownReason) unknownReason = String((c && c.coverageReason) || (scanState === 'unknown' && scanCov && scanCov.reason) || '') || null;
    }
  }
  if (!withArtifact.length && !(ran + skipped + noscan)) continue; // truly out of scope everywhere — nothing to claim either way
  // `undetermined` is summed ALONGSIDE the four, never inside them. A lane that grades nothing —
  // gitleaks matching a pattern with no verifier to ask — lands here. Added 2026-08-24 with the
  // secrets-verification split: without it, a category whose rows are all undetermined aggregated
  // to total:N with crit/high/med/low all zero, and a reader of the four buckets would conclude
  // the fleet was clean. That is the same false-clean the severity fix was closing, one layer up.
  const agg = { crit: 0, high: 0, med: 0, low: 0, undetermined: 0, total: 0, repos: withArtifact.length, ran, skipped, noscan, check: checkId };
  for (const r of withArtifact) { const c = r.scanners[key]; for (const k of ['crit', 'high', 'med', 'low', 'undetermined', 'total']) agg[k] += c[k] || 0; }
  // BACKLOG P, fleet half (the CRA half landed first): how many repos' artifact for this
  // category was a ZERO-RULES run — readable, executed, incapable of finding anything. Carried as
  // its own count beside the severity buckets for the same reason `undetermined` is: a category
  // whose repos are all norules aggregates to total:0, and a reader of the four buckets would
  // conclude the fleet was clean when nothing was capable of looking. Omitted when zero (computed
  // every roll; absent means counted-and-none, and re-roll byte-identity keeps the key out of
  // unaffected categories). Socket's quota husk needs no twin field here: its extractor returns
  // null, so the repo never joins withArtifact and already lands in ran/noscan.
  const norulesRepos = withArtifact.filter((r) => r.scanners[key] && r.scanners[key].norules === true).length;
  if (norulesRepos) agg.norules = norulesRepos;
  // HOW MUCH OF THIS CATEGORY IS NOT A RESULT. monitor/unknown.mjs made the question answerable and
  // nothing asked it, so the answer stayed in a library — the same shape as the predicate it
  // replaced, one level up.
  //
  // NOT the same as `coverage`, and the two must never be merged. `coverage` answers how much of
  // the SUBJECT a check could see; this answers whether the check produced a result AT ALL. A lane
  // can have full coverage and an unparseable artifact, or a clean parse over half a tree.
  // Reported as its own field, with the reasons, because a count with no reason is a number a
  // reader cannot act on.
  const unk = tallyUnknown(withArtifact.map((r) => r.scanners[key]));
  if (unk.unknown) {
    agg.unknownBlocks = unk.unknown;
    // Sorted: rollup.json is asserted byte-identical on a re-roll, and object key order is part of
    // the bytes.
    agg.unknownByReason = Object.fromEntries(Object.entries(unk.byReason).sort(([a], [b]) => a.localeCompare(b)));
  }
  fleetUnknown.blocks += unk.unknown;
  fleetUnknown.total += unk.total;
  for (const [reason, n] of Object.entries(unk.byReason)) fleetUnknown.byReason[reason] = (fleetUnknown.byReason[reason] || 0) + n;
  // FIX 3 — per-category freshness. checks-status.json rows already carry `at` (bin/commitwork.mjs
  // writes {check,status,reason,durationMs,at}); this loop had `c` in hand and read only c.status,
  // so the timestamp reached history/<stamp>.json and never rollup.json. The newest wins: a category
  // is as fresh as its most recent successful run across the batch's repos.
  // ISO string, deliberately — rerollup-identical.test.mjs normalises ISO timestamps and bare
  // 14-digit stamps and NOTHING else, so an epoch int or a rendered age would break byte-identity.
  if (lastRunAt) agg.lastRunAt = lastRunAt;
  if (lastCheckedAt) agg.lastCheckedAt = lastCheckedAt;
  // The split, and the reason behind it, only ship when there is a skip to explain. The BLOCKED
  // reason wins when both kinds are present: it is the one an operator can act on, and a mixed
  // category that reported "n/a — no go.mod" would send them away from the repo that needs a URL.
  // A void says why, or it is a number with no evidence behind it.
  if (noscan && noscanReason) agg.noscanReason = noscanReason.slice(0, 400);
  if (skipped) {
    agg.naSkips = naSkips;
    agg.blockedSkips = blockedSkips;
    const reason = blockedReason || naReason;
    if (reason) agg.skipReason = reason.slice(0, 300);
  }
  // LANE COVERAGE, aggregated worst-wins. A category is as covered as its least-covered check:
  // one blind lane among ten is a category with a blind lane, and reporting the majority would be
  // reporting the comfortable nine. This mirrors the skip split directly above — blocked beats n/a
  // there for the same reason reduced beats full here, and the representative reason follows the
  // winner so the operator reads the actionable one.
  //
  // unknown OUTRANKS reduced. `reduced` is a measured loss ("Go call analysis did not run");
  // `unknown` is an unmeasured one ("the log we were told to read is not there"). A known gap can
  // be judged; an unestablished one cannot, so it is the state that must survive aggregation.
  //
  // ABSENT, NOT FULL, WHEN NOTHING REPORTED. Emitting coverage:'full' for a category where no check
  // carried the field would turn "nothing told us" into "everything is covered" — precisely the
  // inversion this field exists to remove, and the same rule R-1 established for unsweptInScope:
  // absence of the measurement is never the value of a clean measurement.
  if (covFull + covReduced + covUnknown > 0) {
    agg.coverage = covUnknown ? 'unknown' : covReduced ? 'reduced' : 'full';
    agg.coverageChecks = { full: covFull, reduced: covReduced, unknown: covUnknown };
    const cr = covUnknown ? unknownReason : covReduced ? reducedReason : null;
    if (cr) agg.coverageReason = cr.slice(0, 300);
  }
  scannerFleet[key] = agg;
}

// ── PER-FINDING DETAIL, FLEET-SHAPED — AND THE ONLY SERIALIZED COPY ────────────────────────────
// The panel needs a drill-down, and admin/serve.mjs passes rollup blocks through whole so the
// panel and the rollup cannot disagree — so the flatten happens HERE, not client-side over
// repos[]. Rows are {repo, ...finding}, globally sorted (repo, then the category's own fields —
// absent fields compare as '') for the rerollup byte-identity gate, and bounded by the per-repo
// DETAIL_CAP above: a capped repo records `truncated` in repos[].scanners[key], and rows-vs-
// scannerFleet[key].total states the remainder to any consumer.
//
// After the flatten, the per-repo `findings` arrays are STRIPPED before anything is written:
// they duplicated this block byte-for-byte (105 KB of one project's 382 KB rollup was the second copy),
// every fleet row already carries `repo`, and nothing read the per-repo copy (verified by grep
// across *.mjs/*.html, 2026-08-02). `truncated` stays per-repo — it is a per-repo fact and the
// panel states per-repo truncation from it. `ran`/counts stay too (cra/controls.mjs contract).
// DERIVED, not listed. This was a hand-maintained array beside a hand-maintained set of extractors,
// and one commit's entire content was the two catching up with each other — an
// extractor could emit rows that this list then dropped on the floor, silently, which is the
// partial-statement shape in its purest form. monitor/detail-schema.mjs is the single declaration
// now, and both sides read it.
const DETAIL_KEYS = detailKeys();
// safety net: an extractor that emits `findings` for a key outside DETAIL_KEYS still gets
// flattened — otherwise the strip below would silently discard rows that were never published,
// which is exactly the partial-statement shape this file exists to refuse.
const _emittedDetail = (key) => repos.some((r) => r.scanners && r.scanners[key] && Array.isArray(r.scanners[key].findings));
const scannerFindings = {};
for (const [key] of SCANNER_SPECS) {
  if (!scannerFleet[key]) continue; // category absent from this batch — nothing to claim either way
  if (!DETAIL_KEYS.includes(key) && !_emittedDetail(key)) continue; // counts-only category
  // WHY rows < total IS THREE DIFFERENT FACTS, and why the rollup states which.
  //
  // The panel used to render every shortfall as `truncated · the rollup caps detail per repo`.
  // Measured 2026-08-03 that explanation was WRONG for every case on disk: the cap is 2500 and the
  // largest repo is nowhere near it, yet one area (client-d-remote) showed semgrep 1063 of 1144.
  // The real cause was that its rollup was written BEFORE the category had an extractor — its
  // counts are current and its detail predates the code that produces detail. Telling a reader
  // "the list is capped" when the truth is "this slice is older than the extractor" sends them
  // looking for a limit to raise instead of a sweep to run, and it is a partial statement
  // presented as a complete one — the shape this file exists to refuse.
  //
  // So the rollup DECLARES the provenance and the panel stops inferring it:
  //   rows       how many are published here
  //   truncated  how many the DETAIL_CAP actually dropped (summed per repo — the cap is per repo)
  //   noDetail   repos that report counts for this category but produced no rows at all, i.e. rolled
  //              before the extractor existed. Sorted, so the rerollup byte-identity gate holds.
  const rows = [];
  let truncated = 0;
  const noDetail = [];
  for (const r of repos) {
    const c = r.scanners && r.scanners[key];
    if (!c) continue;
    if (Array.isArray(c.findings)) {
      // Fixture classification is NOT done here. It happens once, at the extractor, in
      // monitor/fixture-paths.mjs — the single decider — which diverts those rows into each
      // category's `fixtures.rows` with its pattern and intent. A second classifier at this layer
      // was a second vocabulary over the same population and is retired (K10).
      for (const f of c.findings) rows.push({ repo: r.name, ...f });
      truncated += Number(c.truncated) || 0;
    }
    else if (Number(c.total) > 0) noDetail.push(r.name);
  }
  scannerFleet[key].detail = { rows: rows.length, truncated, noDetail: noDetail.sort(_cmpStr) };
  rows.sort((a, b) => _cmpStr(a.repo, b.repo)
    || _cmpStr(a.file || '', b.file || '') || ((a.line || 0) - (b.line || 0))
    || _cmpStr(a.path || '', b.path || '')
    || _cmpStr(a.package || '', b.package || '') || _cmpStr(a.version || '', b.version || '')
    || _cmpStr(a.rule || a.id || '', b.rule || b.id || '') || _cmpStr(a.message || '', b.message || '')
    || _cmpStr(a.name || '', b.name || ''));
  scannerFindings[key] = rows;
}
for (const r of repos) {
  if (!r.scanners) continue;
  for (const c of Object.values(r.scanners)) if (Array.isArray(c.findings)) delete c.findings;
}

// meta-SAST: cross-tool place corroboration over every SAST category now that scannerFindings[key]
// is fully populated for all of them. Additive-only (see corroborate.mjs) — runs before the
// conservation check below, which is unaffected either way since corroboratedBy never moves a
// count.
markSastPlaceCorroboration(scannerFindings);

// ---- conservation check (monitor/conserve.mjs) ------------------------------------------------
// R1b: WIRING TIMING MATTERS (conserve.mjs's own header, in full). checkConservation asserts
// `published + truncated === declared` per category — and MUST run against the fleet-flatten's OWN
// totals, right here, BEFORE the scanner-annotations overlay below. That overlay legitimately
// DECREMENTS `scannerFleet[cat].total` for every row an authored annotation suppresses (the row
// stays IN scannerFindings[cat] — suppression is never a deletion — only the severity headline
// drops), and calling this check AFTER the overlay would misread every annotated category's
// legitimate total-decrease as a conservation violation. `scannerFleet`/`scannerFindings` at this
// exact point are the fleet's own numbers, untouched by annotations — the only totals this
// invariant is actually checking against.
//
// Published on both the slice and rollup.json as `conservation:{checked,violations}` — an empty
// `violations` array is the affirmative "checked, conforms" (the schemaViolations precedent two
// blocks up), never an absent field standing in for a clean result.
const conservation = checkConservation({ scanners: scannerFleet, scannerFindings });

// ── metrics: the lanes that measure rather than find (operator ruling D4, 2026-08-13) ──────────
// `stubs` is 4,322 rows fleet-wide, every one severity `low`, every one a TODO/FIXME marker. A
// severity that never varies carries no severity information, and a TODO is declared intent rather
// than a defect — so the lane can never reach zero, and a number that can never reach zero stops
// being read. It keeps being collected and stops being a finding: counted here, excluded from the
// severity sum (TOTALS_EXCLUDE), and never lodged as work (METRIC_CATEGORIES, ingestArea).
//
// GREY IS NOT GREEN, here as everywhere: a lane that RAN and found nothing publishes `total: 0`; a
// lane that did not run publishes `ran: false` and NO total. `denoLint`/`denoTypes` are dormant
// today (0 of 29 areas) and this is what that looks like from the outside — absent, not clean.
const metrics = {};
for (const cat of METRIC_CATEGORIES) {
  const lane = scannerFleet[cat];
  const ran = !!(lane && lane.ran);
  if (!ran) { metrics[cat] = { ran: false }; continue; }
  const rows = Array.isArray(scannerFindings[cat]) ? scannerFindings[cat] : null;
  // The lane ran but published no detail rows — a real state (detail is capped/omitted for some
  // lanes), and one that must not read as "found nothing". `total` comes from the lane's own count.
  if (!rows) { metrics[cat] = { ran: true, total: Number(lane.total) || 0, byRepo: null, detail: 'counts only — no detail rows published' }; continue; }
  const byRepo = {};
  for (const r of rows) { const k = r && r.repo; if (k) byRepo[k] = (byRepo[k] || 0) + 1; }
  metrics[cat] = { ran: true, total: rows.length, byRepo };
}

// ---- scanner-annotations overlay (authored judgments over scannerFindings rows) --------------
// The CVE ledger above annotates r.findings; this is the SAME as-of discipline applied to the
// drill-down rows, with the strict matcher from annotate-lib (identity per category from
// detail-schema, no wildcard-by-omission — see evaluations/scanner-annotations-2026-08-03).
// Suppressed ≠ deleted: an annotated row KEEPS its place with `annotation` attached, and only the
// severity aggregates (which feed `totals` below via sumTotals) drop — with `annotated` recorded
// beside them, so a reduced number never appears without its reason. Every record's fate is
// published in `scannerAnnotationStatus`: applied / noMatch / expired / invalid. A record that
// matches zero rows is a REPORTED state, not a silence — a typo'd `file` looks exactly like
// success otherwise. Rows lost to DETAIL_CAP truncation cannot be matched, so their counts are
// never decremented — conservative by construction.
//
// Buckets: most categories carry `sev` per row, and a suppression decrements the bucket that row
// was counted in. A row WITHOUT `sev` was not counted in crit/high/med/low at all — _gitleaksCounts
// does `if (sev) c[sev]++; else c.undetermined++` — so `undetermined` is the bucket it came from and
// the only one it can correctly leave.
//
// This said `{ secrets: 'high', secretsHistory: 'high' }`, on the note that "gitleaks rows are
// uniformly high". They are not, and have not been since the verification split landed: a gitleaks
// row is crit when a verifier confirmed it, low when the issuing service refused it, and NO SEV when
// nobody could be asked. So every suppression of a sev-less secrets row decremented `high` — a
// bucket that lane never fills — where Math.max(0, …) swallowed it, and left `undetermined` intact.
// Measured 2026-08-27 on commitwork-admin/secrets: 20 of 21 rows adjudicated, total correctly 1,
// and `undetermined` still reading 15 — 14 of them rows already judged false-positive.
// secretsHistory never reached this: _trufflehogCounts assigns crit/med to every row.
const SEVLESS_BUCKET = { secrets: 'undetermined', secretsHistory: 'undetermined' };
const scannerAnnotationStatus = { applied: [], noMatch: [], expired: [], invalid: [], carried: [] };
const _annLabel = (a, idf) => `${a.category}:${(idf || []).map((f) => a[f]).join('|')}@${a.scope === 'fleet' ? 'fleet' : a.repo}`;
// A CARRIED CATEGORY CANNOT BE EVALUATED HERE, AND MUST NOT BE REPORTED AS IF IT HAD BEEN.
// The carry block below (~:1149) runs AFTER this overlay: when a narrow sweep does not speak for a
// category, that block installs the previous slice's rows — annotations already attached — into
// scannerFindings. At THIS point those rows do not exist yet, so `scannerFindings[category]` is
// empty and every record for the category matches zero rows. Routed to noMatch, that reads as
// "I looked and this suppression matched nothing", which is the operator's cue for a typo'd path.
// It is a verdict manufactured from a non-event, the same defect class as dating a run from a skip,
// and it fires on every record of every carried category at once: measured on commitwork-admin
// 2026-08-11, ALL 23 evaluated records reported noMatch while the rows they suppress carried their
// annotations correctly and the aggregate recorded annotated:4. Three genuinely-inert records
// elsewhere in the fleet were indistinguishable from those 23 false alarms.
// So carried records get their own state: not applied, not failed — not evaluated this slice.
const _carriedCategory = (key) => !scannerFleet[key]
  && !!(prevSlice && prevSlice.scanners && prevSlice.scanners[key] && typeof prevSlice.scanners[key] === 'object');
let scannerAnnotatedTotal = 0;
// The loop this replaced now lives in annotate-lib as applyScannerAnnotations, because the PANEL
// has to run the identical overlay when it reads a slice: an annotation authored after the last
// sweep changes nothing on disk until the next one.
{
  const _res = applyScannerAnnotations({
    annots: scannerAnnots, scannerFindings, scannerFleet, asOf: genISO,
    identityFor, annotationView, validate: validateScannerAnnotation,
    sevlessBucket: SEVLESS_BUCKET, isCarried: _carriedCategory, annLabel: _annLabel,
  });
  for (const k of Object.keys(_res.status)) scannerAnnotationStatus[k].push(..._res.status[k]);
  scannerAnnotatedTotal += _res.annotatedTotal;
}
for (const k of Object.keys(scannerAnnotationStatus)) scannerAnnotationStatus[k].sort((x, y) => _cmpStr(x.record, y.record));

// The rows are built by monitor/detail-schema.mjs from a declared field list, so a violation here
// means a PRODUCER has drifted from its contract — an extractor mapping a field the schema does not
// name, or naming one it does not fill. Reported, never repaired: the same rule lifecycle.json's
// schemaViolations follows, and an empty array is the affirmative "checked, conforms" rather than
// an absent field. This is the check that keeps `additionalProperties:false` in the published
// schema from being a claim nobody tests — the artifacts these rows come from carry live
// credential material in fields the schema does not declare.
const detailViolations = [];
for (const [key, rows] of Object.entries(scannerFindings)) detailViolations.push(...validateRows(key, rows));
// written to the artifact whether or not it is empty: [] is "checked, conforms", and an ABSENT
// field would be indistinguishable from a rollup that never ran the check at all
const scannerFindingsViolations = detailViolations.slice(0, 200);
if (detailViolations.length) {
  try {
    appendFileSync(join(OUT, 'history', 'LOG.md'),
      `\n<!-- scanner-finding schema: ${detailViolations.length} violation(s) in ${sliceId}\n${detailViolations.slice(0, 20).map((m) => `  - ${m}`).join('\n')}\n-->\n`);
  } catch {}
}

// ── CARRY FORWARD WHAT THIS BATCH DID NOT ASK ABOUT ─────────────────────────────────────────────
// A group-scoped sweep (`sweep supply-chain <area>`) runs 5 of the 12 categories, so the other 7
// hit the `continue` above and vanish from `scanners` entirely. Every consumer reads an absent key
// as nothing-found: admin/index.html renders no row AND tallies "3 categories · 0 VOID", and
// sumTotals() silently drops the category from the headline. Measured 2026-08-01: a supply-chain
// sweep of the fleet erased 664 CodeQL highs and 1017 gitleaks highs from every rollup at once.
//
// This is the same distinction the per-batch model already makes carefully — `skipped` keeps an
// inapplicable check PRESENT so its zero is legible — applied across slices instead of within one.
// The vocabulary is `counts.carried`'s: carried means "not scanned this slice, state unknown", it
// chains until the category is actually rescanned, and it is COUNTED rather than dropped.
//
// prevSlice is already loaded above for the lifecycle diff, and history/<stamp>.json already stores
// `scanners`, so this needs no new read. Fails closed: an unreadable prevSlice carries nothing,
// which leaves the category absent — the pre-existing behaviour, never a fabricated zero.
const carriedCategories = [];
if (prevSlice && prevSlice.scanners && typeof prevSlice.scanners === 'object') {
  for (const [key] of SCANNER_SPECS) {
    if (scannerFleet[key]) continue;                 // this batch spoke for it
    const prev = prevSlice.scanners[key];
    if (!prev || typeof prev !== 'object') continue; // nothing to carry
    scannerFleet[key] = {
      ...prev,
      carried: true,
      // the slice this observation actually came from, and WHEN — never a rendered age, so the
      // value is stable across re-rolls and the client can compute freshness itself
      carriedFrom: prev.carriedFrom || prevSliceId || null,
      carriedAt: prev.carriedAt || prevSlice.generated || null,
    };
    carriedCategories.push(key);
    // detail rides the same carry: a narrow sweep must not empty the drill-down while the count
    // above still reads 88. A prev slice that captured no detail (pre-detail rollup) carries
    // nothing — the panel states that, rather than posing an empty table as clean.
    const prevDet = prevSlice.scannerFindings && prevSlice.scannerFindings[key];
    if (Array.isArray(prevDet)) scannerFindings[key] = prevDet;
  }
}
carriedCategories.sort();   // deterministic order — the rerollup gate compares bytes


const totals = sumTotals(cveTotals, scannerFleet);
// THE SAME NUMBERS, SAID PROPERLY. `${n} crit` is not a fact until it says crit WHAT: a licence
// disjunction and a remote-code-execution both landed in one scale until D15, and 34,898 Socket
// licence alerts were on course for the vulnerability headline. sumTotals has partitioned them by
// kind since 2026-08-26 — and nothing read it. It was computed, conserved, tested and written into
// every rollup on the fleet with ZERO consumers, which is this repository's own top defect class
// (built, tested, fed by nothing) in the commit that claimed to fix the headline. This line is the
// consumer. It prints only the kinds that carry something, so a fleet with one kind says one thing.
const kindLine = Object.entries(totals.byKind || {})
  .map(([k, b]) => [k, ['crit', 'high', 'med', 'low'].reduce((n, s) => n + (b[s] || 0), 0), b.undetermined || 0])
  .filter(([, graded, undet]) => graded || undet)
  .sort((a, b) => b[1] - a[1] || b[2] - a[2])
  .map(([k, graded, undet]) => `${graded} ${k}${undet ? ` (+${undet} undetermined)` : ''}`);
const openTotals = openTotalsFor(totals);
const openTotalsMeta = openTotalsMetaFor(totals);
// Carried categories ARE summed (operator decision, 2026-08-01): excluding them would collapse the
// headline after every narrow sweep — 628 high dropping to 4 — which reads as a fix that never
// happened, the same false-clean inverted. So the number never lies downward, and the staleness is
// stated instead of implied. Same shape as counts.carried: counted, and labelled.
if (carriedCategories.length) {
  totals.carried = {
    categories: carriedCategories,
    oldestCarriedFrom: carriedCategories
      .map((k) => scannerFleet[k].carriedAt).filter(Boolean).sort()[0] || null,
  };
}


// ---- scanner-lane lifecycle diff (scanner-delta.mjs) ----
// The dep lane's delta above stays exactly what it was — ledger-verified. This one is the scanner
// lanes' own three-state diff, place-keyed and gated per category on ran-both-slices; its 'fixed'
// is SCAN-ABSENT tier and every consumer must present it as that, never as ledger-verified.
// v0 predecessors recorded no scanner provenance, so they are passed as "no previous slice" —
// every category then reads 'no-prev' (null counters), never a fabricated all-new/all-fixed diff.
//
// R1b: prevConservation reads straight off prevSlice.conservation — the SAME field this rollup is
// about to publish on its own slice, so a chain of rollups threads it forward with no recompute.
// A v0 predecessor, or any v1 slice rolled before this feature landed, simply has no `conservation`
// field — `|| null` reads that as "no known violations" (diffScannerFindings's own default), never
// as "conforms": a category cannot be vouched for by a slice that never checked it.
const prevConservation = (prevIsV1 && prevSlice && prevSlice.conservation) || null;
const scannerDelta = diffScannerFindings(
  prevIsV1 ? prevSlice : null,
  { scanners: scannerFleet, scannerFindings, scope: { repos: scopeRepos } },
  { curConservation: conservation, prevConservation });

// Sorted for byte-identical re-rolls; rate is rounded to 4dp rather than left as a float whose
// last bits differ by platform. Published even when zero: "nothing is unknown" is a claim worth
// making explicitly, and its absence would read as "nobody looked".
const unknownFleet = { ...fleetUnknown,
  byReason: Object.fromEntries(Object.entries(fleetUnknown.byReason).sort(([a], [b]) => a.localeCompare(b))),
  rate: fleetUnknown.total ? Math.round((fleetUnknown.blocks / fleetUnknown.total) * 10_000) / 10_000 : null };

const slice = { sliceVersion: SLICE_VERSION, sliceId, kind, stamp, generated: genISO, source: sourceId,
  // WHAT THE BOX COULD DO when this slice was swept. Measured 2026-08-28 on shodh-memory: a sweep
  // ran with the docker daemon down, every container lane (deps-osv among them) was structurally
  // void, and the slice published 0 dependency rows where the previous slice had real ones — with
  // only per-check noscan whispers saying why. The batch manifest KNEW (images.docker, written by
  // monitor/images.mjs before the first repo); the slice now carries it so liveness and the panel
  // can treat docker-down as a legitimacy fact rather than an archaeology exercise. 'unrecorded'
  // is the pre-field vintage and must never be read as either up or down.
  capabilities: {
    docker: (bm && bm.images && bm.images.docker) || 'unrecorded',
    ...(bm && bm.images && bm.images.reason ? { dockerReason: bm.images.reason } : {}),
  },
  unknownFleet,
  scope: { repos: scopeRepos, excluded: [...EXCLUDE],
    superseded: (bm && bm.scope && bm.scope.lifecycle)
      ? Object.entries(bm.scope.lifecycle).map(([n, l]) => ({ name: n, supersededBy: l.supersededBy || '', effectiveFrom: l.effectiveFrom || '', note: l.note || '' }))
      : SUPERSEDED }, scopeDelta, anchors, toolRuns,
  // true only when remediation-ledger.json exists but failed to parse this run (see the enrichment
  // block above). Always published, never omitted on the happy path — an absent field would be
  // indistinguishable from a rollup that never checked, the same checked-conforms discipline
  // schemaViolations/scannerFindingsViolations already use.
  ledgerUnreadable,
  enrichmentRefs: { kev: `enrichment/${stamp}-kev.json`, epss: `enrichment/${stamp}-epss.json` },
  totals, openTotals, openTotalsMeta, scanned, coverage, scanners: scannerFleet, scannerFindings, scannerFindingsViolations, scannerAnnotationStatus,
  metrics, // D4: lanes that measure rather than find — counted, never summed into severity, never lodged
  conservation, // R1b: monitor/conserve.mjs's {checked, violations} — computed pre-overlay, see the call site above
  counts: { born: bornCount, cleaned: cleanedList.length, unconfirmed: ledgerRes.unconfirmed.length, accepted: acceptedCount, scannerAnnotated: scannerAnnotatedTotal, carried: carried.length, staleAcceptances: staleAnnotations.length },
  staleAnnotations: staleAnnotations.map((a) => ({ id: a.id, package: a.package, repo: a.repo, action: a.action, at: a.at, expires: a.expires || null })),
  delta: { new: bornCount, fixed: cleanedList.length, newFindings: bornList, fixedFindings: cleanedList }, // 'fixed' = VERIFIED cleaned (strong+medium), one vocabulary
  scannerDelta, // scanner lanes' own diff — 'fixed' here = scan-absent tier, per category, place-keyed
  findings: nowRecs, carried, resolved: resolvedF,
  checks: Object.fromEntries(Object.entries(toolRuns).map(([k, v]) => [k, v.checks])) };
// ATOMIC: history/<stamp>.json is prevSlice for every rollup after this one (loaded via the same
// try/catch-wrapped readFileSync near the top of the file) — a torn write here does not just corrupt
// one slice, it poisons the NEXT rollup's lifecycle diff the moment prevSlice fails to parse.
//
// R1b: sliceSha256 hashes the EXACT bytes about to be written — the same string, not a re-stringify
// of `slice` (whose key order/JSON.stringify output must never be assumed stable across a future
// refactor) — so monitor/timeline.mjs's reader can verify byte-for-byte, never structurally. Recorded
// on the history/index.json row below, never on the slice body itself (a field cannot hash its own
// container without changing the bytes it is hashing).
const sliceBody = JSON.stringify(slice, null, 2);
const sliceSha256 = createHash('sha256').update(sliceBody).digest('hex');
writeAtomic(join(histDir, `${stamp}.json`), sliceBody);

// Freshness deadman: stamp the generation moment + the cadence thresholds so any LATER reader
// (a liveness cron, the dashboard on a day the sweep didn't fire) can tell whether this "current"
// result is actually current. At write time it is trivially 'fresh' (age 0); the value is for
// the reader, who re-runs classifyFreshness(rollup.freshness.generated, Date.now()).
// A paused area's rollup carries the pause, so a reader who has only this file — the panel, an
// export, a copy pulled off the box — is not left to infer from an age why nothing has moved.
const _pausedArea = ambientArea(REG)?.slug
  ? (REG.areas || []).find((a) => a.slug === ambientArea(REG).slug)?.paused || null : null;
const _freshnessAtWrite = classifyFreshness(genISO, Date.parse(genISO), { paused: !!_pausedArea });
const rollup = { generated: genISO, source: sourceId, sliceVersion: SLICE_VERSION, sliceId, kind, checks: headerCols, totals, openTotals, openTotalsMeta, scanned, coverage,
  // Published on BOTH slice and rollup for the unknownFleet reason below — and because liveness
  // reads rollup.json, not the slice: the first cut put this on the slice alone, the deadman read
  // a field that never arrived, and the docker-down degrade could not fire in production while
  // its unit test passed against a synthetic rollup. Same field, both files, one truth.
  capabilities: slice.capabilities,
  freshness: { generated: genISO, threshold: _freshnessAtWrite.threshold, stateAtWrite: _freshnessAtWrite.state,
    paused: _pausedArea ? { since: _pausedArea.since, reason: _pausedArea.reason } : null },
  scanners: scannerFleet, scannerFindings, scannerFindingsViolations, scannerAnnotationStatus,
  unknownFleet, // published on BOTH slice and rollup, like metrics: a consumer of either must
                // get the same answer to "how much of this is not a result", or the number
                // depends on which file you opened
  metrics, // D4 — published on BOTH slice and rollup, so a reader of either sees the same lanes
  conservation, // R1b: same {checked, violations} published on the slice — see the call site above
  // The full category set, IN SPEC ORDER, with display names — shipped so the panel stops keeping a
  // parallel list that could fall behind this one (it had, by thirteen categories). It is the
  // DENOMINATOR as much as the labels: a category present here and absent from `scanners` is an
  // honest ABSENT row, and one the panel could not have known to draw on its own.
  scannerRegistry: SCANNER_SPECS.map(([key, check]) => ({ key, check, label: SCANNER_LABELS[key] || key })),
  counts: slice.counts, scannerDelta, scopeDelta, buildHealth, qualityGates,
  enrichment: { kev: `history/${slice.enrichmentRefs.kev}`, epss: `history/${slice.enrichmentRefs.epss}`, note: 'frozen per-slice subsets; monitor/data/ is the mutable working copy',
    // content-based, never file mtime — see bifocal R21/C5 and the comment above kevFreshness's definition
    kevFreshness, epssFreshness },
  repos, allKeys };

// ── ONE TIMESTAMP OVER LANES OF DIFFERENT AGES ─────────────────────────────────────────────────
// rollup.json carries ONE `generated` and ONE sliceId, but its lanes did not run at one moment: a
// full sweep of this fleet took 61,329s (17h), and a per-lane rescan spreads them further still.
// Measured on sweep-20260820120254: 20 lanes carrying lastRunAt, spanning 4.4 hours between
// sastCodeqlJava and depsGo, all published under a single stamp that says 05:37:44.
//
// That is survivable at 4 hours and corrosive at four days, which is exactly what a remediation
// programme produces — lanes re-running one at a time as each fix lands. A reader comparing two
// numbers from one rollup is entitled to know whether they describe the same tree.
//
// It REFUSES rather than reports when the spread exceeds the sweep's own duration: past that point
// the lanes cannot have seen one state of the world, and `freshness.stateAtWrite` must not say
// `fresh`. sweep-journal's sweptAll:false is the existing precedent for a partial run declaring
// itself; this is the same move at lane granularity.
const laneVintages = Object.entries(rollup.scanners || {})
  .filter(([, s]) => s && s.lastRunAt)
  .map(([k, s]) => ({ lane: k, at: s.lastRunAt, t: Date.parse(s.lastRunAt) }))
  .filter((x) => Number.isFinite(x.t))
  .sort((a, b) => a.t - b.t);
if (laneVintages.length) {
  const oldest = laneVintages[0];
  const newest = laneVintages[laneVintages.length - 1];
  const spreadSecs = Math.round((newest.t - oldest.t) / 1000);
  // The sweep's own duration is the yardstick: lanes cannot legitimately differ by more than the
  // run that produced them. Absent a journal, fall back to the observed spread being its own bound.
  const sweepSecs = Number(rollup.durationSecs) || Number((rollup.sweep && rollup.sweep.durationSecs)) || null;
  const mixed = sweepSecs != null && spreadSecs > sweepSecs;
  rollup.vintage = {
    lanes: laneVintages.length,
    oldest: { lane: oldest.lane, at: oldest.at },
    newest: { lane: newest.lane, at: newest.at },
    spreadSecs,
    spreadHours: Number((spreadSecs / 3600).toFixed(2)),
    sweepSecs,
    // `mixed` means the lanes provably did not observe one state of the tree.
    mixed,
    note: mixed
      ? 'MIXED VINTAGE — the newest and oldest lanes are further apart than the sweep that produced them, so these numbers do not describe one state of the tree. Compare lanes only against their own lastRunAt.'
      : 'lanes ran within the sweep that produced them; the single `generated` stamp is a fair summary of all of them',
  };
  if (mixed && rollup.freshness) {
    // A mixed-vintage rollup is not fresh, whatever its newest lane says. Downgrading here rather
    // than at the reader is deliberate: every consumer would otherwise have to know to check.
    rollup.freshness.stateAtWrite = 'mixed-vintage';
    rollup.freshness.mixedVintage = true;
  }
}

// ── WHICH COMMITWORK PRODUCED EACH REPO'S ROWS ──────────────────────────────────────────────────
// A separate field from `vintage.mixed`, which is about lane TIMESTAMPS. This one is about the
// runner: each repo's toolchain.json (written by bin/commitwork.mjs per invocation) names the sha and
// a hash of the dirty source paths that produced it. Same {sha, sourceDirtyHash} ⇒ same code.
// A batch whose rows came from more than one runner cannot be read as one measurement, and says so;
// receipts written before this field existed are counted as `unrecorded`, never as a vintage of
// their own and never as agreement.
{
  const code = codeVintage(repos.map((r) => ({ name: r.name, toolchain: readToolchain(join(reportsDir, r.name)) })));
  rollup.vintage = rollup.vintage || {};
  rollup.vintage.code = code;
  if (code.mixed && rollup.freshness) {
    rollup.freshness.stateAtWrite = 'mixed-code-vintage';
    rollup.freshness.mixedCodeVintage = true;
  }
}

// ── HOW MANY ANALYSTS SAW EACH FINDING, AND DID THEY AGREE ──────────────────────────────────────
// Derived AFTER the payload is assembled, from the payload itself, and written back as its own
// block. It is a VIEW: no finding is re-keyed, no count is altered, nothing above this line moves.
//
// It exists because the comparative-adversarial claim was not built. Measured on this corpus the
// first time it ran: 4,104 (repo, advisory, package) groups, 96.15% seen by exactly ONE analyst,
// 120 corroborated, 11 genuinely disputed — and before this, both the agreement and the
// disagreement were unrepresentable, because `tool` is inside the finding key and two engines
// seeing one CVE produced two unrelated rows.
//
// `singleAnalystShare` is published deliberately as the honest ceiling on the claim: a fleet that
// is 96% single-analyst has not been cross-examined, whatever its finding count says.
try {
  const { agreementGroups } = await import('./corroboration.mjs');
  const { groups, summary } = agreementGroups(rollup);
  rollup.corroboration = {
    ...summary,
    // Only the rows a human should look at first. The 3,946 single-analyst groups are the finding
    // list over again and are deliberately NOT duplicated here.
    disputes: groups.filter((x) => x.agreement === 'disputed'),
    corroboratedWithProof: groups.filter((x) => x.agreement !== 'single' && x.reachabilityProvenBy).length,
  };
} catch (e) {
  // Fail closed and SAY so: an absent corroboration block must not read as "nothing disagreed".
  rollup.corroboration = { state: 'failed', reason: `corroboration view could not be built: ${String(e && e.message || e).slice(0, 200)}` };
}
// ATOMIC: rollup.json is the consumer contract — the panel, liveness, the map and the overwatch-layer
// exporter all read it as the current state. A crash mid-write left a truncated file that every
// one of them would parse as authoritative (or fail on). Temp + rename means a reader sees the
// whole old file or the whole new one, never half of either.
writeAtomic(join(OUT, 'rollup.json'), JSON.stringify(rollup, null, 2)); // consumer contract: full real file
writeAtomic(join(OUT, `rollup-${sliceId}.json`), JSON.stringify(rollup, null, 2)); // versioned, never clobbered — same torn-file risk as rollup.json above

// human-readable append-only audit trail — now speaks the gated vocabulary
const fmt = (f) => `- \`${LABEL[f.severity]}\` **${f.package || f.id}**${f.version ? '@' + f.version : ''} ${f.id}${f.cvss ? ' · CVSS ' + f.cvss : ''} (${f.repo})${f.fixed ? ' → fix ' + f.fixed : ''} — ${(f.title || '').slice(0, 100)}`;
const fmtClean = (e) => `- \`${LABEL[e.severity] || e.severity}\` **${e.package}** ${e.vulnId} (${e.repo}) — ${e.evidence.tier}: ${e.evidence.detail}${e.fixCommit ? ` · commit ${e.fixCommit.slice(0, 10)}` : ''}`;
const logPath = join(histDir, 'LOG.md');
const logExisting = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
const V1_MARK = '<!-- v1-slices-begin -->';
const corrective = logExisting && !logExisting.includes(V1_MARK)
  ? `\n${V1_MARK}\n> **Note (${genISO.slice(0, 10)})**: entries above this line predate scope+provenance gating — their "Fixed" lists mix real remediation with scope changes and tool-didn't-run artifacts. Verified remediation starts here (see remediation-ledger.json).\n`
  : (logExisting ? '' : `# Findings log — complete audit trail\n\nAppend-only. Each entry is a full scan slice. **New** = proof of issue; **Cleaned (verified)** = evidence-backed remediation from the ledger; **carried** = not scanned this slice, state unknown.\n${V1_MARK}\n`);
const entry = [`\n## ${stamp} — ${sliceId}`,
  `Totals: ${totals.crit} crit / ${totals.high} high / ${totals.med} med / ${totals.low} low · ${nowRecs.length} findings (${acceptedCount} accepted). Change: +${bornCount} new / −${cleanedList.length} cleaned (verified) / ${ledgerRes.unconfirmed.length} unconfirmed / ${carried.length} carried (not scanned).`,
  bornCount ? `\n### New findings (proof of issue)\n` + bornList.slice(0, 300).map(fmt).join('\n') : '',
  cleanedList.length ? `\n### Cleaned since last slice (verified remediation)\n` + ledgerRes.cleaned.slice(0, 300).map(fmtClean).join('\n') : ''].filter(Boolean).join('\n');
appendFileSync(logPath, corrective + entry + '\n');

// (index row is written LAST, at end of file — it is the commit marker for the whole rollup)

// ---------- REMEDIATION.md (KEV-ranked; CRIT/HIGH/MED + LOW) ----------
function groupBy(list) {
  const m = new Map();
  for (const f of list) {
    const k = f.package || f.id;
    if (!m.has(k)) m.set(k, { pkg: k, sev: 'low', ids: new Set(), repos: new Set(), versions: new Set(), fixed: '', advisory: '', kev: false, epss: 0 });
    const g = m.get(k);
    if (SEVRANK[f.severity] > SEVRANK[g.sev]) g.sev = f.severity;
    if (f.id) g.ids.add(f.id); g.repos.add(f.repo); if (f.version) g.versions.add(f.version);
    if (!g.fixed && f.fixed) g.fixed = f.fixed; if (!g.advisory && f.advisory) g.advisory = f.advisory;
    if (f.kev) g.kev = true; if ((f.epss || 0) > g.epss) g.epss = f.epss || 0;
  }
  return [...m.values()];
}
const rankG = (a, b) => (b.kev - a.kev) || (SEVRANK[b.sev] - SEVRANK[a.sev]) || (b.epss - a.epss) || (b.repos.size - a.repos.size);
const grow = (g, i) => `| ${i + 1} | ${g.kev ? '🚨 ' : ''}\`${g.pkg}\`${[...g.versions][0] ? ` @${[...g.versions][0]}` : ''} | ${LABEL[g.sev]}${g.kev ? ' · KEV' : ''} | ${(g.epss * 100).toFixed(1)}% | ${g.fixed || (g.advisory ? 'see advisory' : 'upgrade to patched')} | ${[...g.repos].join(', ')} | ${[...g.ids].slice(0, 4).join(', ')}${g.ids.size > 4 ? ` +${g.ids.size - 4}` : ''} |`;
const highMed = allF.filter((f) => ['crit', 'high', 'med'].includes(f.severity));
const lows = allF.filter((f) => f.severity === 'low');
const kevF = allF.filter((f) => f.kev);
const gMain = groupBy(highMed).sort(rankG);
const gLow = groupBy(lows).sort(rankG);
const rem = [`# CVE remediation plan`, ``,
  `Generated ${rollup.generated} from \`${reportsDir.split('/').slice(-1)[0]}\`. Prioritised by **KEV (known-exploited) → severity → EPSS (exploit probability) → blast radius**.`, ``,
  `**Headline:** ${totals.crit} critical · ${totals.high} high · ${totals.med} medium · ${totals.low} low · **${totals.kev} on CISA KEV**.`,
  // The headline above sums EVERY lane, inside a document titled "CVE remediation plan" — so it
  // has always been broader than the tables under it, and a reader had no way to see by how much.
  // This says which part of it is a vulnerability claim and which is posture, policy, integrity or
  // hygiene. Same numbers, partitioned; see monitor/extractors.mjs LANE_KINDS.
  ...(kindLine.length ? [``, `**By kind:** ${kindLine.join(' · ')}. Only the vulnerability share is`
    + ` addressable by the tables below; the rest is real and belongs to other work.`] : []), ``,
  'This document is the **proof of issue**. The append-only audit trail (proof of remediation/work) is `history/LOG.md` + the per-run JSON snapshots in `history/`.', ``];
if (kevF.length) {
  rem.push(`## 🚨 KEV — known exploited (patch first, any severity)`, ``, `| Package | Severity | EPSS | Fix | Repos | CVE |`, `|---|---|---|---|---|---|`);
  groupBy(kevF).sort(rankG).forEach((g) => rem.push(`| \`${g.pkg}\` | ${LABEL[g.sev]} | ${(g.epss * 100).toFixed(1)}% | ${g.fixed || (g.advisory ? 'see advisory' : 'patch')} | ${[...g.repos].join(', ')} | ${[...g.ids].slice(0, 3).join(', ')} |`));
  rem.push('');
}
rem.push(`## Critical / High / Medium — ${gMain.length} packages, ${highMed.length} findings`, ``, `| # | Package | Severity | EPSS | Fix | Affected repos | CVEs |`, `|---|---|---|---|---|---|---|`);
gMain.forEach((g, i) => rem.push(grow(g, i)));
rem.push('', `## Low severity — ${gLow.length} packages, ${lows.length} findings`, ``, `| # | Package | Severity | EPSS | Fix | Affected repos | CVEs |`, `|---|---|---|---|---|---|---|`);
gLow.forEach((g, i) => rem.push(grow(g, i)));
rem.push('', '## How to apply', '',
  '1. **KEV first** — anything in the KEV table is actively exploited in the wild; patch regardless of CVSS.',
  '2. Then critical → high → medium, ordered by EPSS (exploit probability) and blast radius.',
  '3. Prefer the npm-audit `fixAvailable` version; else follow the advisory. Transitive pins → `overrides`/`resolutions` or Renovate (wired).',
  `4. Re-run \`node monitor/sweep.mjs all ${rollupArea || '<area>'}\`; confirm the finding leaves the next history snapshot (proof of remediation). (Omitting the area sweeps every registered project — standalone products included — into this fleet history.)`, '');
writeAtomic(join(OUT, 'REMEDIATION.md'), rem.join('\n') + '\n'); // ATOMIC: an operator can be mid-read when a sweep re-rolls; a torn write must not hand them a truncated plan

// ---------- dashboard ----------
const depsUpdatesTotal = repos.reduce((a, r) => ({ total: a.total + ((r.depsUpdates && r.depsUpdates.count) || 0), major: a.major + ((r.depsUpdates && r.depsUpdates.major) || 0), repos: a.repos + (r.depsUpdates ? 1 : 0) }), { total: 0, major: 0, repos: 0 });
const dataJson = JSON.stringify({ generated: rollup.generated, source: sourceId, reportsDir: sourceId, checks: headerCols, totals, depsUpdatesTotal,
  repos: repos.map((r) => ({ name: r.name, summary: r.summary, worst: r.worst, grid: r.grid, depsUpdates: r.depsUpdates || null,
    findings: r.findings.map((f) => ({ id: f.id, sev: f.severity, cvss: f.cvss, pkg: f.package, ver: f.version, fixed: f.fixed, range: f.range, tool: f.tool, title: f.title, advisory: f.advisory, status: f.status, kev: f.kev, epss: f.epss })) })),
  retired: [...EXCLUDE], // disabled/retired repos (projects.json exclude) — rendered greyed + marked, not scanned
  superseded: SUPERSEDED, // lifecycle: superseded (rollback standby) — DISTINCT from retired, never blank, never clean
  glyph: GLYPH, label: LABEL }).replace(/<\//g, '<\\/');

const html = String.raw`<!doctype html><html lang="en-AU"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>commitwork monitor — CVE dashboard</title>
${followerScript()}
<style>
${houseCss()}
 :root{--crit-fill:color-mix(in srgb,var(--crit) 12%,transparent);--high-fill:color-mix(in srgb,var(--high) 12%,transparent);--med-fill:color-mix(in srgb,var(--med) 12%,transparent);--low-fill:color-mix(in srgb,var(--low) 12%,transparent);--live-fill:color-mix(in srgb,var(--live) 12%,transparent);--part-fill:color-mix(in srgb,var(--part) 12%,transparent)}
 body{font-size:.875rem;line-height:1.5}
 .bar{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--line);padding:.5625rem 1rem;display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}
 .bar b{font-size:.9375rem;font-weight:600;color:var(--head)}.sp{flex:1}.mut{color:var(--mut);font-size:.719rem}
 button,input{font:inherit;font-size:.8125rem;border:1px solid var(--line2);background:var(--panel);color:var(--ink);border-radius:3px;padding:.3125rem .5625rem}
 button{cursor:pointer}button:hover{border-color:var(--acc)}
 button.on{background:var(--wash);border-color:var(--acc2);box-shadow:inset 0 -2px 0 var(--acc)}
 .kpis{display:flex;gap:.625rem;flex-wrap:wrap;max-width:77.5rem;margin:.875rem auto .25rem;padding:0 1rem}
 .kpi{background:var(--panel);border:1px solid var(--line);border-radius:.625rem;padding:.5625rem .9375rem;min-width:6.875rem}
 .kpi .n{font-size:1.4375rem;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--head)}.kpi .l{font-size:.656rem;color:var(--mut);text-transform:uppercase;letter-spacing:.1em}
 .kpi.crit .n{color:var(--crit)}.kpi.high .n{color:var(--high)}.kpi.med .n{color:var(--med)}.kpi.low .n{color:var(--low)}
 .legend{max-width:77.5rem;margin:.25rem auto;padding:0 1rem;font-size:.6875rem;color:var(--mut);display:flex;gap:.875rem;flex-wrap:wrap}
 .wrap{max-width:77.5rem;margin:.375rem auto 4.375rem;padding:0 1rem}
 table{border-collapse:separate;border-spacing:0;width:100%;background:var(--panel);border:1px solid var(--line);border-radius:.625rem;font-size:.78rem}
 th,td{padding:.375rem .5625rem;text-align:left;white-space:nowrap}
 th{position:sticky;z-index:2;font-size:.656rem;cursor:pointer;user-select:none}
 th:hover{box-shadow:inset 0 -2px 0 var(--acc2)}
 tr{border-left:4px solid transparent}tr.crit{border-left-color:var(--crit)}tr.high{border-left-color:var(--high)}tr.med{border-left-color:var(--med)}tr.noscan{border-left-color:var(--plan)}tr.ok{border-left-color:var(--live)}
 tr.retired td,tr.superseded td{color:var(--dim)}tr.retired td.repo,tr.superseded td.repo{font-style:italic}
 tr.retired .st{background:var(--panel2);color:var(--mut)}tr.superseded .st{background:var(--part-fill);color:var(--part)}
 tfoot td{font-weight:600;background:var(--panel2)}
 td.repo a{color:var(--ink);text-decoration:none;font-weight:600}td.repo a:hover{text-decoration:underline;text-decoration-color:var(--acc)}
 .chip{display:inline-block;padding:.0625rem .4375rem;border-radius:.625rem;font-variant-numeric:tabular-nums;font-size:.719rem;font-weight:600}
 .chip.crit{background:var(--crit-fill);color:var(--crit)}.chip.high{background:var(--high-fill);color:var(--high)}.chip.med{background:var(--med-fill);color:var(--med)}.chip.low{background:var(--low-fill);color:var(--low)}.chip.ok{background:var(--live-fill);color:var(--live)}
 /* an absent or unscanned cell wears the house .pill.na or .pill.unk, never a filled chip (THEME Rule 7) */
 .cell.hasf{cursor:help}
 .st{font-size:.625rem;font-weight:600;letter-spacing:.04em;margin-left:.3125rem;padding:0 .25rem;border-radius:.4375rem;background:var(--part-fill);color:var(--part)}
 #tip{position:fixed;z-index:50;max-width:460px;max-height:60vh;overflow:auto;background:var(--panel);border:1px solid var(--line2);border-radius:.5rem;box-shadow:0 8px 24px rgba(0,0,0,.35);padding:.5rem .625rem;font-size:.719rem;display:none}
 #tip h4{margin:0 0 .375rem;font-size:.75rem}#tip .row{padding:.1875rem 0;border-top:1px solid var(--line);display:flex;gap:.375rem;align-items:baseline}
 /* embedded in the admin panel (?embed=1 or inside an iframe): hide the brand, the cross-nav and
    the theme toggle, which would duplicate the panel's own bar and Appearance menu, and draw the
    bar as this view's toolbar rather than a second masthead */
 html[data-embed] .embed-hide{display:none!important}
 html[data-embed] .bar{position:static;background:transparent;border-bottom:0}
</style></head><body>
<div class="bar"><b class="embed-hide">commitwork monitor</b><span class="mut" id="src"></span><div class="sp"></div>
 <input id="q" placeholder="filter repos…" size="12">
 <button data-f="all" class="on">All</button><button data-f="kev">🚨 KEV</button><button data-f="crit">crit</button><button data-f="high">high</button><button data-f="med">med</button>
 <a href="./REMEDIATION.md" class="embed-hide" style="text-decoration:none"><button>Remediation ↗</button></a>
 <a href="./runtime.html" class="embed-hide" style="text-decoration:none"><button>Runtime · DAST/BOLA ↗</button></a>
 <a href="./timeline.html" class="embed-hide" style="text-decoration:none"><button>Timeline ↗</button></a>
 <button id="theme" class="embed-hide" title="dark mode">☾</button></div>
<div class="kpis" id="kpis"></div>
<div class="legend" id="legend"></div>
<div class="wrap"><table><thead><tr id="head"></tr></thead><tbody id="body"></tbody><tfoot><tr id="foot"></tr></tfoot></table>
 <div class="mut" id="note" style="margin:12px 2px"></div></div>
<div id="tip"></div>
<script id="data" type="application/json">__DATA__</script>
<script>
if(new URLSearchParams(location.search).has('embed')||self!==top)document.documentElement.setAttribute('data-embed','');
const D=JSON.parse(document.getElementById('data').textContent);
// repo names, grid cell text and finding pkg/id/title/fixed strings are scan-derived — a
// third-party advisory or repo name is not this page's to trust once it lands in innerHTML.
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
// noscan:1.5 — a blind lane outranks a clean one and a low finding, and still loses to med/high.
// It used to be absent from this map entirely, so sevOfRepo below collapsed it to 'ok' and a repo
// whose every check produced nothing sorted level with, and rendered the same green as, a repo that
// genuinely scanned clean. Same inversion as bin/commitwork.mjs's SEV_RANK, same fix, same reason.
const G=D.glyph,L=D.label,RANK={crit:4,high:3,med:2,noscan:1.5,low:1,ok:0,na:0,unknown:0};
const DEPCOLS=new Set(['deps-osv','npm-audit']);
const PRETTY={secrets:'Secrets','secrets-gitleaks':'Secrets · gitleaks',sast:'SAST','sast-codeql':'SAST · CodeQL','deps-osv':'Dep CVEs · OSV','deps-jvm':'JVM CVEs · Trivy','deps-retire':'JS libs · retire','supply-chain-socket':'Supply-chain · Socket','npm-audit':'npm audit','iac-config':'IaC config','dockerfile-lint':'Dockerfile','sbom':'SBOM','sbom-syft':'SBOM · Syft','authz-test':'Authz / BOLA'};
const collabel=c=>PRETTY[c]||c.replace(/[-_]/g,' ').replace(/\b\w/g,m=>m.toUpperCase());
document.getElementById('src').textContent=D.source.split('/').slice(-1)[0]+' · '+new Date(D.generated).toLocaleString();
const DU=D.depsUpdatesTotal||{total:0,major:0,repos:0};
document.getElementById('kpis').innerHTML=[['',D.totals.repos,'repos'],['crit',D.totals.kev,'🚨 KEV exploited'],['crit',D.totals.crit,'critical'],['high',D.totals.high,'high'],['med',D.totals.med,'medium'],['low',D.totals.low,'low'],['',D.totals.cves,'CVEs total'],[DU.major?'high':(DU.total?'med':''),(DU.total||0)+(DU.major?' ('+DU.major+' maj)':''),'⬆ dep updates']]
 .map(([c,n,l])=>'<div class="kpi '+c+'"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>').join('');
document.getElementById('legend').innerHTML='severity: '+['crit','high','med','low','ok'].map(s=>'<span class="chip '+s+'">'+G[s]+' '+L[s]+'</span>').join(' ')+' · <span class="pill unk">no result</span> <span class="pill na">n/a</span> · dep cells are hoverable for the CVEs · click a column to sort';
function depSev(r,col){const t=col==='deps-osv'?'osv':'npm';const fs=r.findings.filter(f=>f.tool===t);if(!fs.length)return null;const w=fs.reduce((a,f)=>RANK[f.sev]>RANK[a]?f.sev:a,'ok');return{sev:w,n:fs.length,fs};}
function cellHtml(r,col){
 if(DEPCOLS.has(col)){const d=depSev(r,col);if(!d)return '<span class="pill na" title="no findings from this tool in the reports read">'+G.na+'</span>';
  return '<span class="cell hasf chip '+d.sev+'" data-repo="'+esc(r.name)+'" data-col="'+col+'">'+G[d.sev]+' '+d.n+'</span>';}
 const x=r.grid[col]||{sev:'na',text:'—'};
 if(x.sev==='noscan')return '<span class="pill unk" title="the check ran and produced no trustworthy result">'+esc(x.text)+'</span>';
 const cls=x.sev==='high'?'high':x.sev==='med'?'med':x.sev==='ok'?'ok':'';
 return cls?'<span class="chip '+cls+'">'+G[cls]+' '+esc(x.text)+'</span>':'<span class="pill na">'+esc(x.text)+'</span>';}
let sortCol=null,sortDir=-1,filter='all',q='';
// The ternary chain used to fall through to 'ok', which swallowed 'noscan' — a check that ran and
// produced nothing trustworthy was reported as the same state as a check that came back clean, both
// in this row's colour and in the sort that reads it. 'noscan' is now carried through as itself.
// (No backticks in this comment: the whole block below is emitted inside a template literal, so one
// would end the string and take the file's syntax with it. It did, once, before this note existed.)
function sevOfRepo(r){let w='ok';for(const c of D.checks){const d=DEPCOLS.has(c)?depSev(r,c):null;const s=d?d.sev:(r.grid[c]?.sev==='high'?'high':r.grid[c]?.sev==='med'?'med':r.grid[c]?.sev==='noscan'?'noscan':'ok');if(RANK[s]>RANK[w])w=s;}return w;}
function render(){
 let rows=D.repos.filter(r=>r.name.toLowerCase().includes(q));
 if(filter!=='all')rows=rows.filter(r=>{if(filter==='kev')return r.findings.some(f=>f.kev);if(filter==='crit')return r.findings.some(f=>f.sev==='crit');if(filter==='high')return sevOfRepo(r)==='high'||r.findings.some(f=>f.sev==='high');return sevOfRepo(r)==='med'||r.findings.some(f=>f.sev==='med');});
 if(sortCol){const val=(r)=>{if(DEPCOLS.has(sortCol)){const d=depSev(r,sortCol);return d?RANK[d.sev]*1000+d.n:0;}const g=r.grid[sortCol];return g?RANK[g.sev==='high'?'high':g.sev==='med'?'med':'ok']*1000+g.count:0;};rows.sort((a,b)=>(val(a)-val(b))*sortDir);}
 else rows.sort((a,b)=>RANK[sevOfRepo(b)]-RANK[sevOfRepo(a)]);
 document.getElementById('head').innerHTML='<th data-c="repo">Repo</th>'+D.checks.map(c=>'<th data-c="'+c+'">'+c+(sortCol===c?(sortDir<0?' ▾':' ▴'):'')+'</th>').join('');
 const activeRows=rows.map(r=>{
  const link=r.summary?'<a href="file://'+esc(D.reportsDir)+'/'+esc(r.summary)+'">'+esc(r.name)+'</a>':esc(r.name);
  const du=r.depsUpdates&&r.depsUpdates.count?' <span class="st" title="'+r.depsUpdates.count+' pending dependency updates ('+(r.depsUpdates.major||0)+' major) — Renovate local dry-run">⬆'+r.depsUpdates.count+(r.depsUpdates.major?'·'+r.depsUpdates.major+'M':'')+'</span>':'';
  return '<tr class="'+sevOfRepo(r)+'"><td class="repo">'+link+du+'</td>'+D.checks.map(c=>'<td>'+cellHtml(r,c)+'</td>').join('')+'</tr>';
 }).join('');
 // lifecycle-superseded repos: rollback standby — DISTINCT from retired, shown only in the unfiltered view
 const supersededRows=(filter==='all'&&!q?(D.superseded||[]):[]).map(s=>
  '<tr class="superseded"><td class="repo">'+esc(s.name)+' <span class="st">superseded</span></td><td colspan="'+D.checks.length+'" class="mut">superseded (rollback standby)'+(s.supersededBy?' — folded into '+esc(s.supersededBy):'')+' · out of active scan scope, not retired</td></tr>').join('');
 // disabled/retired repos (projects.json exclude): greyed, marked, not scanned — shown only in the unfiltered view
 const retiredRows=(filter==='all'&&!q?(D.retired||[]):[]).map(n=>
  '<tr class="retired"><td class="repo">'+esc(n)+' <span class="st">retired</span></td><td colspan="'+D.checks.length+'" class="mut">disabled / excluded from scan scope</td></tr>').join('');
 document.getElementById('body').innerHTML=activeRows+supersededRows+retiredRows||'<tr><td colspan="'+(D.checks.length+1)+'" class="mut">no repos</td></tr>';
 const tot={};D.checks.forEach(c=>tot[c]=0);D.repos.forEach(r=>D.checks.forEach(c=>{if(DEPCOLS.has(c)){const d=depSev(r,c);tot[c]+=d?d.n:0;}else tot[c]+=(r.grid[c]?.count||0);}));
 document.getElementById('foot').innerHTML='<td>'+rows.length+' repos</td>'+D.checks.map(c=>'<td>'+tot[c]+'</td>').join('');
 document.getElementById('note').textContent='Dep columns (deps-osv, npm-audit) are CVE-backed and hoverable. Other columns from the batch index. Source: '+D.source;
 document.querySelectorAll('th[data-c]').forEach(th=>th.onclick=()=>{const c=th.dataset.c;if(c==='repo')return;if(sortCol===c)sortDir*=-1;else{sortCol=c;sortDir=-1;}render();});
 document.querySelectorAll('.cell.hasf').forEach(el=>{el.onmouseenter=e=>showTip(e,el.dataset.repo,el.dataset.col);el.onmousemove=moveTip;el.onmouseleave=hideTip;});
}
const tip=document.getElementById('tip');
function showTip(e,repo,col){const r=D.repos.find(x=>x.name===repo);const t=col==='deps-osv'?'osv':'npm';
 const fs=r.findings.filter(f=>f.tool===t).sort((a,b)=>RANK[b.sev]-RANK[a.sev]||(b.cvss||0)-(a.cvss||0));
 const top=fs.slice(0,20);
 tip.innerHTML='<h4>'+esc(repo)+' · '+col+' — '+fs.length+' CVEs</h4>'+top.map(f=>'<div class="row"><span class="chip '+f.sev+'">'+G[f.sev]+' '+L[f.sev]+'</span><span><b>'+esc(f.pkg||f.id)+(f.ver?'@'+esc(f.ver):'')+'</b> '+esc(f.id||'')+(f.cvss?' · CVSS '+f.cvss:'')+(f.epss!=null?' · EPSS '+(f.epss*100).toFixed(1)+'%':'')+(f.kev?' · <b style="color:var(--crit)">🚨KEV</b>':'')+(f.fixed?' → fix '+esc(f.fixed):(f.range?' ('+esc(f.range)+')':''))+'<br><span style="color:var(--mut)">'+esc((f.title||'').slice(0,90))+'</span></span></div>').join('')+(fs.length>20?'<div class="row" style="color:var(--mut)">…and '+(fs.length-20)+' more (see summary.md / REMEDIATION.md)</div>':'');
 tip.style.display='block';moveTip(e);}
function moveTip(e){const pad=14;let x=e.clientX+pad,y=e.clientY+pad;if(x+470>innerWidth)x=e.clientX-470;if(y+tip.offsetHeight>innerHeight)y=Math.max(8,innerHeight-tip.offsetHeight-8);tip.style.left=x+'px';tip.style.top=y+'px';}
function hideTip(){tip.style.display='none';}
document.querySelectorAll('button[data-f]').forEach(b=>b.onclick=()=>{filter=b.dataset.f;document.querySelectorAll('button[data-f]').forEach(x=>x.classList.toggle('on',x===b));render();});
document.getElementById('q').oninput=e=>{q=e.target.value.toLowerCase();render();};
render();
</script>
${toggleScript()}
</body></html>`;
writeAtomic(join(OUT, 'dashboard.html'), html.replace('__DATA__', dataJson)); // ATOMIC: served live over the published tunnel — a torn write must not serve half a page

// index row LAST — the commit marker: everything before this is idempotent (upserts / dedupe
// by natural key), so a crash anywhere above heals on re-rollup of the same batch.
// v1 rows dedupe by source; v0 rows carry no source and are never touched.
// Counted BEFORE the filter: the chain event below must say 'replace' when this write drops the
// batch's earlier row, so a re-roll is recorded IN the chain instead of reading as a hole in it.
const chainPriorRows = idx.filter((e) => (e.sliceVersion || 0) >= 1 && sourceKey(e.source, REG) === sourceId).length;
idx = idx.filter((e) => !((e.sliceVersion || 0) >= 1 && sourceKey(e.source, REG) === sourceId));
idx.push({ stamp, sliceId, sliceVersion: SLICE_VERSION, kind, source: sourceId, file: `${stamp}.json`, generated: genISO,
  total: nowRecs.length, crit: totals.crit, high: totals.high, med: totals.med, low: totals.low,
  new: bornCount, fixed: cleanedList.length, unconfirmed: ledgerRes.unconfirmed.length, carried: carried.length, accepted: acceptedCount, scannedRepos: repos.length,
  // scanner-lane place diff (scan-absent tier). null = no category was comparable this slice —
  // a first roll or a fully-carried sweep — which must stay distinguishable from "compared, 0".
  scannerNew: scannerDelta.totals.new, scannerFixed: scannerDelta.totals.fixed,
  // R1b: sha256 of the exact bytes just written to history/<stamp>.json (see sliceBody above).
  // monitor/timeline.mjs's reader contract: present+match=verified, present+mismatch=unreadable,
  // absent=unverified-legacy. Never backfilled onto a pre-existing row whose bytes were not
  // rewritten just now — monitor/backfill-scanner-delta.mjs is the one other writer allowed to set
  // this field, and only when it has just rewritten that same row's slice body.
  sliceSha256 });
// ATOMIC: this is the commit marker (see the comment above) — every rollup reads it to find prevSlice
// and to dedupe its own re-roll by source. A torn write here is worse than a torn slice: it can make
// the NEXT rollup unable to find ANY prior slice at all, not just this one.
writeAtomic(join(histDir, 'index.json'), JSON.stringify(idx, null, 2));

// ── the hash-chained write log (history/chain.jsonl), then its anchor ──────────────────────────
// Sealed BEFORE this write's own event, so every area self-seals on its next sweep (retro-seal
// lines attest seal-time bytes and say so); then one event records what just happened, 'replace'
// when the dedupe above dropped this batch's earlier row. Attestation ON TOP of the commit marker:
// a chain that refuses to extend is warned LOUDLY and left for verifyChain to name — the stamp then
// shows as `unrecorded` — but it never aborts a completed sweep's index write. The anchor copies the
// new tip into the sidecar store; it is a consistency check for a later verifier, not tamper
// evidence on its own (same uid, same disk — see history-chain.mjs), so its failure only warns.
// Anchored only when the default anchor store is this rollup's to write — see anchorableOut() for
// the two measured leaks (scratch OUT dirs, then fixture registries) that define the refusals.
const { anchorable, why: anchorWhy } = anchorableOut(OUT, REG);
try {
  sealHistory(histDir, idx, genISO);
  // WHO: the spine session when one exported CW_CHAIN_BY, else the writing program — a weaker
  // identity than a session but a true one, and never an omitted field (see eventBody).
  appendChainEvent(histDir, { at: genISO, op: chainPriorRows ? 'replace' : 'slice', stamp, sliceId, source: sourceId, sliceSha256,
    by: process.env.CW_CHAIN_BY || 'monitor/rollup.mjs' });
  if (anchorable) {
    try { appendAnchor(histDir, basename(OUT), genISO); }
    catch (e) { console.warn(`rollup: chain anchor not written — ${String(e && e.message || e)}. The chain event stands; the verifier will report anchored:false.`); }
  } else console.log(`rollup: chain extended, tip not anchored — ${anchorWhy} (set CW_CHAIN_ANCHORS to anchor a scratch rollup)`);
} catch (e) {
  console.warn(`rollup: chain.jsonl did not extend — ${String(e && e.message || e)}. The index write stands; this stamp will show as unrecorded until a later sweep seals it.`);
}

const OUTREL = relative(CW, OUT);
// TWO POPULATIONS, TWO SENTENCES. `cves`/`kev` are the dependency-CVE feed only; crit/high/med/low
// sum EVERY scanner (see sumTotals, which says so). Printed as one clause they contradicted
// themselves — `CVEs 6 (1 crit / 622 high / 57 med / 1 low)` reads as six findings of which 622
// are high. The numbers were always right; the sentence was not.
const findingsTotal = totals.crit + totals.high + totals.med + totals.low;
console.log(`rollup: slice ${sliceId} (v${SLICE_VERSION}, ${kind}) · ${totals.repos} repos scanned (${scopeRepos.length} in scope)`);
console.log(`findings: ${findingsTotal} across all scanners — ${totals.crit} crit / ${totals.high} high / ${totals.med} med / ${totals.low} low (${acceptedCount} accepted${scannerAnnotatedTotal ? ` · ${scannerAnnotatedTotal} scanner-annotated` : ''}) · dependency CVEs ${totals.cves}${totals.kev ? ` · ${totals.kev} KEV` : ''}`);
if (kindLine.length) console.log(`  by kind: ${kindLine.join(' · ')}`);
if (scannerAnnotationStatus.noMatch.length || scannerAnnotationStatus.expired.length || scannerAnnotationStatus.invalid.length) {
  console.log(`scanner annotations needing attention: ${scannerAnnotationStatus.noMatch.length} matched nothing · ${scannerAnnotationStatus.expired.length} expired · ${scannerAnnotationStatus.invalid.length} invalid (see rollup.scannerAnnotationStatus)`);
}
// Stated separately and never as "needing attention": a carried record is not a defect, it is an
// un-evaluated one. Silence here would be the other half of the same lie — the reader could not
// tell a slice that checked every record from one that checked none of them.
if (scannerAnnotationStatus.carried.length) {
  console.log(`scanner annotations not evaluated this slice: ${scannerAnnotationStatus.carried.length} in carried categories (${[...new Set(scannerAnnotationStatus.carried.map((c) => c.category))].sort().join(', ')}) — their rows were carried forward, so their fate is unknown, not clean`);
}
console.log(`lifecycle: +${bornCount} born · −${cleanedList.length} cleaned (verified) · ${ledgerRes.unconfirmed.length} unconfirmed · ${resolvedF.filter((p) => p.state === 'resolved-accepted').length} resolved-accepted · ${carried.length} carried (not scanned this slice)`);
if (scopeDelta.added.length || scopeDelta.removed.length) console.log(`scope delta: +[${scopeDelta.added.join(', ')}] −[${scopeDelta.removed.join(', ')}]${(scopeDelta.superseded || []).length ? ` (superseded → rollback standby: ${scopeDelta.superseded.map((s) => s.name).join(', ')})` : ''}`);
// Fleet coverage is stated on every rollup, loudly when non-zero — an unswept repo is a coverage
// void, and a void with no line in the output is exactly how 45 of them accumulated unnoticed.
//
// WHAT IS LOUD DEPENDS ON WHAT THIS BATCH CLAIMED TO COVER. The old line enumerated every
// discovery-resolved repo missing from the batch, so a one-repo `commitwork-admin` sweep ended by
// naming 15 repos from unrelated areas — none of which that sweep was
// ever going to touch. Fifteen irrelevant names per run is how a real signal gets tuned out.
// The batch already declares its intended scope, so the in-scope gap needs no area lookup:
//   declared-but-not-scanned → THIS sweep failed to cover its own scope. Loud, with names.
//   everything else          → another area's business. One line, a count, no names.
// coverage.unswept in rollup.json is unchanged: liveness.mjs and the panel still see the fleet.
// Both halves now come from the coverage block rather than being re-derived here: the log and the
// artifact must not be able to disagree about what this batch covered, and liveness classifies on
// the same `unsweptInScope` this line prints.
const missedInScope = coverage.unsweptInScope;
const outOfScope = coverage.unswept.filter((n) => !scopeRepos.includes(n));
if (missedInScope.length) {
  console.log(`COVERAGE: ${missedInScope.length} of ${scopeRepos.length} repo(s) declared for this batch were NOT scanned: ${missedInScope.slice(0, 15).join(', ')}${missedInScope.length > 15 ? ` … +${missedInScope.length - 15} more` : ''}`);
} else {
  console.log(`coverage: all ${scopeRepos.length} repo(s) declared for this batch were scanned (${coverage.scope})`);
}
// Named repos would be out-of-scope noise here; the count is the whole signal, and it is only
// actionable one way — sweep wider.
if (outOfScope.length) console.log(`coverage: ${outOfScope.length} repo(s) outside this batch's scope remain unswept — \`sweep --all\`, or see rollup.json coverage.unswept`);
if (staleAnnotations.length) console.log(`STALE ACCEPTANCES: ${staleAnnotations.length} active annotation(s) match no live finding in a scanned repo — fix landed or finding vanished; expire the acceptance or investigate: ${staleAnnotations.map((a) => `${a.id}@${a.repo}`).join(', ')}`);
console.log(`-> ${OUTREL}/rollup.json · rollup-${sliceId}.json · history/${stamp}.json · remediation-ledger.json · dashboard.html · REMEDIATION.md`);
