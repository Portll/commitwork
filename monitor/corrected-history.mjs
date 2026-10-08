#!/usr/bin/env node
// commitwork monitor — CORRECTED PARALLEL INDEX (history/corrected/).
// Derives an accuracy-first view of the slice history without ever rewriting v0/v1 originals.
// Fixes encoded here, each cited to on-disk evidence:
//   1. Three-tier counts per repo/slice: raw occurrences (as recorded), distinct (repo|id|package,
//      tool-agnostic — collapses osv+npm double-reporting), canonical (advisory-alias clusters built
//      from osv.sarif rule metadata: ids co-mentioned in a rule are one advisory). Nothing hidden:
//      all three tiers + per-tool provenance are kept. Cross-repo exposures are NEVER merged.
//   2. Event reclassification: index.json new/fixed events relabelled method-change / subject-switch /
//      scope-change / annotation / real-fix, with citations (git SHAs, DECISIONS.md lines, registry
//      backups). "448 fixed in 9 minutes" style artifacts stop reading as remediation.
//   3. Visibility model per repo per slice: findings | clean-visible | blind-jvm | no-surface |
//      excluded | not-scanned. A Gradle service scanned without a lockfile is BLIND, not clean —
//      the record must never imply it was clean (jvm-rescan/index.md documents the false-clean).
// usage: node monitor/corrected-history.mjs   (reads registry OUT or CW_MONITOR_OUT)
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename, isAbsolute } from 'node:path';
import { findRepoPath } from './discover.mjs';
import { loadRegistry, areaBySlug } from './registry.mjs';
import { outDirFor } from './area.mjs';
import { readSarif, ruleIndex } from './sarif-read.mjs'; // the one SARIF reader

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
// FAIL LOUD: this is the core derivation feeding verify-corrected.mjs's acceptance checks and
// timeline2.html. A swallowed registry parse here would let a corrupt registry silently generate
// a "corrected" view — whose entire purpose is catching false-clean readings — over the wrong
// output directory.
const REG = loadRegistry();

// THIS TOOL IS clientA-SPECIFIC, and now says so instead of pretending to be general. Its RECLASS
// errata cite clientA SHAs and clientA-docs pages; subjectOf() hardcodes the clones→monorepo
// subject switch; the repo surface map is read from the clientA/services tree. There is no way to
// run it correctly over another area, because another area's errata have never been written.
//
// OUT was hand-derived as resolve(CW, reportsRoot, REG.monitorOutput || 'client-a-monorepo') with no
// area.mjs import. That trailing literal is exactly the guess area.mjs exists to refuse: outNameFor
// THROWS when the registry declares neither areas[] nor monitorOutput, rather than silently writing
// a "corrected" view — whose entire purpose is catching false-clean readings — into a directory
// nobody asked for.
const AREA_SLUG = 'client-a'; // the pseudonym the tracked tree uses; the private registry declares the same slug
// areaOut() falls back to the bare slug for an area nobody declared, so OUT would silently become
// <reportsRoot>/client-a. Only a declaration or an explicit CW_MONITOR_OUT may name the directory.
if (!process.env.CW_MONITOR_OUT && !areaBySlug(AREA_SLUG, REG)) {
  console.error(`corrected-history: refusing to run — the registry declares no '${AREA_SLUG}' area and CW_MONITOR_OUT is unset.\n`
    + `  The fallback would be <reportsRoot>/${AREA_SLUG}, a report dir no registry declared, and a "corrected"\n`
    + '  view written there would read as authoritative for an area that does not exist.\n'
    + `  Declare the '${AREA_SLUG}' area in the registry, or set CW_MONITOR_OUT to the report dir to derive.`);
  process.exit(2);
}
const OUT = outDirFor(AREA_SLUG, REG);
// CW_MONITOR_OUT is a legitimate absolute override (scratch dirs, tests). Pointing it at ANOTHER
// DECLARED AREA is not an override, it is a category error: that area's repos would be classified
// against the fleet area's surface map and every slice stamped scanRoot 'client-a/services (Portll
// monorepo)'. Checked BEFORE the services-checkout requirement below, so the refusal is the same on
// a machine that has no fleet-area clone.
const foreignArea = (REG.areas || []).find(
  (a) => a.slug !== AREA_SLUG && outDirFor(a.slug, REG, { env: false }) === OUT);
if (foreignArea) {
  console.error(`corrected-history: refusing to run — CW_MONITOR_OUT resolves to the '${foreignArea.slug}' area's `
    + `report dir\n  (${OUT}).\n`
    + `  This derivation is scoped to '${AREA_SLUG}': its event reclassifications cite ${AREA_SLUG} commits and\n`
    + `  its repo surface map is read from the ${AREA_SLUG}/services tree. Run here, it would classify\n`
    + `  ${foreignArea.slug}'s repos against ${AREA_SLUG}'s surface and label every slice\n`
    + `  scanRoot '${AREA_SLUG}/services (Portll monorepo)' — a corrected view that is itself wrong.\n`
    + `  Corrected history for '${foreignArea.slug}' needs that area's own errata, which do not exist.`);
  process.exit(2);
}
const histDir = join(OUT, 'history');
const corrDir = join(histDir, 'corrected');
// resolved across machine layouts (was a machine-bound path). CW_FLEET_SERVICES_DIR overrides: an
// absolute path is used as given, a relative one is looked up under the library roots.
// The old client-a-us-launch/clones tree is HISTORIC-ONLY (original multi-repo pull,
// referenced by RECLASS citations as strings) — it is not read at runtime.
const SERVICES = process.env.CW_FLEET_SERVICES_DIR && isAbsolute(process.env.CW_FLEET_SERVICES_DIR)
  ? resolve(process.env.CW_FLEET_SERVICES_DIR)
  : findRepoPath(process.env.CW_FLEET_SERVICES_DIR || `${AREA_SLUG}/services`); // the real checkout name is private
if (!existsSync(SERVICES)) {
  console.error(`corrected-history: ${AREA_SLUG}/services not found (looked at ${SERVICES}) — `
    + 'set CW_FLEET_SERVICES_DIR to the monorepo services dir; the surface classification needs it.\n'
    + `  This is a hard requirement because the tool is scoped to the '${AREA_SLUG}' area: the surface\n`
    + '  map (which repo carries gradle / npm / neither) is read from that tree, and a missing surface\n'
    + '  would make every Gradle service read clean-visible rather than blind-jvm.');
  process.exit(1);
}

// ---------- event reclassification map (the errata; every entry cites evidence) ----------
// kinds: method-change | subject-switch | real-fix | annotation | scope-change | mixed
const RECLASS = {
  '20260702064632': { kind: 'baseline', note: 'phase1 first scan of the ClientA clones (original multi-repo pull).', citations: ['the phase1 client-a batch report', 'client-a-us-launch/clones (on-disk originals)'] },
  '20260702085153': { kind: 'method-change', note: 'new=434/fixed=172 within ~2h of identical clone trees — phase1→phase1b parser/scope expansion, not security change.', citations: ['the phase1 client-a batch report vs its phase1b rescan'] },
  '20260702090048': { kind: 'subject-switch', note: 'new=77/fixed=448 across a 9-minute gap — scan subject switched clones→client-a monorepo services. The disappearances are pre-slice real remediation committed 06-30→07-02 in the monorepo (consolidation 7e839976; gradle lockfiles 4b9e33f9 07-01; npm criticals 66ec15f0 07-02) plus dedup/method change. NOT 448 fixes in 9 minutes; per-finding evidence lives in the retro-ledger.', citations: ['client-a 7e839976', 'client-a 4b9e33f9', 'client-a 66ec15f0', 'monitor/projects.json.pre-program-20260703T045842Z'] },
  '20260706090831': { kind: 'real-fix', note: 'fixed=456: towards-0 remediation wave committed 07-02→07-06 (incl JVM HIGH wave 91962c20 07-06) landed between the 07-05 and 07-06 scans. Direction real, evidence pre-provenance — see retro-ledger tiers. born=1 = uuid CVE-2026-41907 introduced by the xlsx→exceljs migration.', citations: ['client-a 91962c20', 'reports/client-a-monorepo/DECISIONS.md:186'] },
  '20260706091053': { kind: 'real-fix', note: 'fixed=1 = uuid CVE-2026-41907 resolved same day (resolutions.uuid=11.1.1 + lockfile regen).', citations: ['reports/client-a-monorepo/DECISIONS.md:186-187'] },
  '20260706092029': { kind: 'real-fix', note: 'fixed=1 = showdown CVE-2024-1899 in the document service, resolved by migration to markdown-it.', citations: ['reports/client-a-monorepo/DECISIONS.md:193'] },
  '20260706152532': { kind: 'scope-change', note: 'fixed=2 is NOT remediation: the config server and the service registry (retired Eureka pair, not deployed) were scope-excluded; their jackson-databind MEDs still exist in the repo.', citations: ['monitor/projects.json excludeNote', 'reports/client-a-monorepo/DECISIONS.md:104-106'] },
  '20260707100611': { kind: 'steady', note: 'no change; 3 accepted MEDs persist.', citations: [] },
  '20260707101130': { kind: 'steady', note: 'no change; 3 accepted MEDs persist.', citations: [] },
  '20260702065854': { kind: 'steady', note: 're-rollup of the same phase1 batch; identical findings.', citations: [] },
  '20260702070921': { kind: 'steady', note: 're-rollup of the same phase1 batch; identical findings.', citations: [] },
  '20260703050509': { kind: 'steady', note: 're-rollup of sweep-20260702084741; identical findings.', citations: [] },
  '20260705114115': { kind: 'steady', note: 're-rollup of sweep-20260702084741; identical findings.', citations: [] },
  '20260709084312': { kind: 'empty-run', note: 'aborted/empty sweep: 0 toolRuns, 0 findings — scanned NOTHING; must never be read as a clean fleet scan.', citations: ['reports/sweep-20260709084307'] },
  '20260718183450': { kind: 'scope-change', note: 'TWO distinct movements in this slice, never conflatable. (1) SCOPE: repo count 39→26 is NOT remediation — 13 services superseded by the 6 consolidated cluster services left ACTIVE scan scope (projects.json lifecycle, per-repo effectiveFrom 20260718170005); trees retained as rollback standby, rendered as a distinct superseded state, never implied clean. Cutover executed 2026-07-10..12: gateway repointed :8093-8098, 199/199 routes verified. (2) REMEDIATION, real: the fleet’s two open deps findings — picomatch 2.3.1 CVE-2026-33671 (HIGH, accepted) + CVE-2026-33672 (MED, accepted) on the admin console service — resolved by the 2026-07-19 lockfile regeneration applying the pre-staged scoped resolutions (anymatch/picomatch + readdirp/picomatch → 2.3.2; advisory fixed-in 2.3.2/3.0.2/4.0.4, published after the 07-18 scan); repo deps re-scanned in place: osv 0, npm-audit 0. The two accept-annotations become inert.', citations: ['monitor/projects.json lifecycle+lifecycleNote', 'client-a-docs/REMEDIATION-WORK.md §G (G1-G6 merge table)', 'client-a-docs/COMMITWORK-COVERAGE-REMEDIATION.md §2-3 + §6', 'the admin console service package.json resolutions + yarn.lock (zero picomatch 2.3.1)', 'GHSA-c2c7-rcm5-vvqj / GHSA-3v7f-55p6-f55p (fixed-in 2.3.2)'] },
};
const EXCLUDED_FROM = '20260706152532'; // Eureka pair excluded from this stamp onward
const EXCLUDED = new Set(REG.exclude || []);
// A repo-specific reason belongs to that repo alone. The Eureka note used to be stamped onto
// every entry in reg.exclude, so when the list grew from 2 to 6 on 2026-07-31 (clientDRemote,
// layingpipe, psiTurk, Conductor — a mirror, an unused repo, a 2012 third-party fork and a
// deprecated tool, none of them Eureka and none of them JVM) each was set to be published with a
// justification about jackson-databind in someone else's tree. A wrong reason is worse than none:
// it reads as though the exclusion had been examined. Per-repo reasons come from the registry's
// `excludeReasons` and never from a list of names here: which repos a client retired is that
// client's configuration, and it lives with the private registry.
const EXCLUDE_REASONS = REG.excludeReasons || {};
const excludedNote = (name) => (Object.hasOwn(EXCLUDE_REASONS, name) && EXCLUDE_REASONS[name]
  ? EXCLUDE_REASONS[name]
  : REG.excludeNote
    ? 'out of scan scope by registry decision — reason recorded in monitor/projects.json excludeNote'
    : 'out of scan scope; monitor/projects.json records NO reason for this exclusion — '
      + 'an exclusion with no reason is indistinguishable from an oversight');
// per-repo lifecycle (projects.json "lifecycle"): superseded services leave ACTIVE scan scope
// from their own effectiveFrom stamp (per-repo, unlike the global EXCLUDED_FROM) but render as
// a DISTINCT 'superseded' (rollback standby) state — never 'retired', never blank, never clean.
// effectiveFrom MUST be a 14-digit YYYYMMDDHHMMSS stamp: comparisons are lexicographic string >=.
const LIFECYCLE = REG.lifecycle || {};
for (const [n, lc] of Object.entries(LIFECYCLE)) for (const k of ['effectiveFrom', 'effectiveTo']) if (lc[k] && !/^\d{14}$/.test(lc[k]))
  throw new Error(`lifecycle.${n}.${k} '${lc[k]}' is not a 14-digit YYYYMMDDHHMMSS stamp — string compare would silently misgate`);
// Gate on the BATCH stamp (same comparator rollup used to decide scope for that batch), derived
// from the sliceId/source sweep dir name; a pre-cutover batch first rolled up AFTER effectiveFrom
// must keep its original active rendering. effectiveTo bounds a rollback interval — the standby
// period stays superseded in history even after the entry is closed (never remove entries; close
// them with effectiveTo + a cited scope-change RECLASS entry).
const lifecycleAt = (name, stamp) => {
  const lc = LIFECYCLE[name];
  return lc && lc.state === 'superseded' && lc.effectiveFrom && stamp >= lc.effectiveFrom && (!lc.effectiveTo || stamp < lc.effectiveTo) ? lc : null;
};
const batchStampOf = (sliceId, source, fallback) =>
  ((String(sliceId || '').match(/sweep-(\d{14})/) || String(source || '').match(/sweep-(\d{14})/) || [])[1]) || fallback;
// subject per source dir class
const subjectOf = (src) => /phase1/.test(src) ? { scanRoot: 'client-a-us-launch/clones (ClientA originals)', era: 'clones' }
  : { scanRoot: 'client-a/services (Portll monorepo)', era: 'monorepo' };
// JVM visibility: clones era had no gradle lockfiles (jvm-rescan/index.md false-clean note);
// monorepo lockfiles exist from client-a 4b9e33f9 (2026-07-01) — all sweep-era slices are visible.
const jvmBlindEra = (era) => era === 'clones';

// ---------- repo surface detection (monorepo tree layout mirrors the clones 1:1) ----------
const surface = {};
for (const r of readdirSync(SERVICES)) {
  const gradle = existsSync(join(SERVICES, r, 'build.gradle')) || existsSync(join(SERVICES, r, 'build.gradle.kts'));
  const npm = existsSync(join(SERVICES, r, 'package.json')) || existsSync(join(SERVICES, r, 'package-lock.json'));
  surface[r] = gradle && npm ? 'gradle+npm' : gradle ? 'gradle' : npm ? 'npm' : 'none';
}
// The area's two non-service repos are recognised by role suffix, not by name: the buildout repo
// holds compose and scripts, the launch repo is metadata. Naming them here would publish the client.
const surfaceOf = (name) => surface[name]
  || (/-buildout$/.test(name) ? 'compose/scripts' : /-us-launch$/.test(name) ? 'meta' : 'unknown');

// ---------- global advisory alias clusters from osv.sarif rule metadata ----------
const ID_RE = /(?:CVE-\d{4}-\d{4,7}|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})/g;
const parent = {};
const find = (x) => { while (parent[x] !== undefined && parent[x] !== x) { parent[x] = parent[parent[x]] ?? parent[x]; x = parent[x]; } return parent[x] === undefined ? x : x; };
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) { parent[ra] = parent[ra] ?? ra; parent[rb] = ra; } };
let aliasRules = 0;
function ingestSarifRules(dir) {
  let names = []; try { names = readdirSync(dir); } catch { return; }
  for (const repo of names) {
    // Alias enrichment, not a verdict lane: every non-ok state contributes no clusters
    const rr = readSarif(join(dir, repo, 'osv.sarif'));
    if (rr.state !== 'ok') continue;
    const run0 = rr.runs[0]; if (!run0) continue;
    for (const rule of Object.values(ruleIndex(run0))) {
      // star topology only: link ids mentioned in THIS rule to the rule's own id — the osv-scanner
      // rule is one advisory with aliases; transitive text-chaining is deliberately avoided.
      const own = rule.id; if (!own || !ID_RE.test(own)) { ID_RE.lastIndex = 0; continue; } ID_RE.lastIndex = 0;
      const mentioned = new Set(JSON.stringify(rule).match(ID_RE) || []);
      mentioned.delete(own);
      if (mentioned.size) { aliasRules++; for (const m of mentioned) union(own, m); }
    }
  }
}

// ---------- load slices ----------
let idx = JSON.parse(readFileSync(join(histDir, 'index.json'), 'utf8'));
idx = [...idx].sort((a, b) => (a.generated || '').localeCompare(b.generated || ''));
const raw = [];
for (const e of idx) {
  const f = e.file || `${e.stamp}.json`;
  let s = null; try { s = JSON.parse(readFileSync(join(histDir, f), 'utf8')); } catch {}
  if (s) raw.push({ e, s });
}
for (const { s } of raw) if (s.source && existsSync(s.source)) ingestSarifRules(s.source);
const clusterRoot = (id) => {
  const r = find(id);
  // prefer a CVE id as the cluster label when any member is a CVE
  const members = Object.keys(parent).filter((k) => find(k) === r).concat(r);
  const cves = [...new Set(members)].filter((m) => m.startsWith('CVE-')).sort();
  return cves[0] || r;
};

// ---------- per-slice canonicalisation ----------
const SEV = ['crit', 'high', 'med', 'low', 'unknown'];
const slices = [];
for (const { e, s } of raw) {
  const v1 = (s.sliceVersion || 0) >= 1;
  const subj = subjectOf(s.source || '');
  let backfill = null;
  try { backfill = JSON.parse(readFileSync(join(histDir, 'enrichment', `${e.stamp}-backfill.json`), 'utf8')); } catch {}

  const repos = {};
  const occSeen = new Set(); // raw occurrence identity as originally recorded
  for (const f of s.findings || []) {
    const r = repos[f.repo] || (repos[f.repo] = { raw: 0, distinctKeys: new Set(), canon: new Map(), tools: {}, accepted: 0 });
    r.raw++;
    r.tools[f.tool || '?'] = (r.tools[f.tool || '?'] || 0) + 1;
    r.distinctKeys.add(`${f.id}|${f.package}`);
    const root = clusterRoot(f.id);
    const ck = `${f.package}|${root}`;
    const c = r.canon.get(ck) || { root, package: f.package, ids: new Set(), tools: new Set(), sev: 'unknown', paths: new Set(), ann: false };
    c.ids.add(f.id); c.tools.add(f.tool || '?'); if (f.path) c.paths.add(f.path);
    // severity: keep the worst reported across duplicate reports of the same advisory
    const rank = { crit: 4, high: 3, med: 2, low: 1, unknown: 0 };
    if ((rank[f.severity] || 0) > (rank[c.sev] || 0)) c.sev = f.severity;
    if (f.annotation) c.ann = true;
    r.canon.set(ck, c);
  }
  // scanned set: v1 = toolRuns; v0 = findings repos + backfill-documented repos
  const scanned = new Set(v1 ? Object.keys(s.toolRuns || {}) : Object.keys(repos));
  if (backfill) for (const [name, r] of Object.entries(backfill.repos || {})) if (r.scanned) scanned.add(name);

  // visibility per repo
  const vis = {};
  const allRepos = new Set([...scanned, ...Object.keys(repos)]);
  for (const name of allRepos) {
    const surf = surfaceOf(name);
    const canonOpen = repos[name] ? [...repos[name].canon.values()].filter((c) => !c.ann) : [];
    const canonAcc = repos[name] ? [...repos[name].canon.values()].filter((c) => c.ann) : [];
    let state;
    const lc = lifecycleAt(name, batchStampOf(s.sliceId, s.source, e.stamp));
    if (EXCLUDED.has(name) && e.stamp >= EXCLUDED_FROM) state = 'excluded';
    else if (canonOpen.length) state = 'findings';
    else if (canonAcc.length) state = 'accepted-only';
    else if (lc) state = 'superseded'; // folded into a consolidated service; standby, NOT clean, NOT retired
    else if (surf === 'none' || surf === 'meta') state = 'no-surface';
    else if (surf.includes('gradle') && jvmBlindEra(subj.era)) state = 'blind-jvm'; // NEVER 'clean' — no lockfile, JVM deps invisible
    else state = 'clean-visible';
    const sevCount = { crit: 0, high: 0, med: 0, low: 0, unknown: 0 };
    for (const c of canonOpen) sevCount[SEV.includes(c.sev) ? c.sev : 'unknown']++;
    vis[name] = { state, surface: surf, open: sevCount, openTotal: canonOpen.length, accepted: canonAcc.length,
      raw: repos[name]?.raw || 0, distinct: repos[name]?.distinctKeys.size || 0, canonical: repos[name]?.canon.size || 0,
      tools: repos[name]?.tools || {},
      ...(lc ? { lifecycle: { supersededBy: lc.supersededBy, effectiveFrom: lc.effectiveFrom } } : {}) };
  }
  // excluded repos disappear from scans after EXCLUDED_FROM — keep them visible as excluded rows
  // (but not on an empty run: a slice that scanned nothing has nothing to say about anyone)
  // surface defaults to 'unknown', not 'gradle': the old default asserted a JVM build surface for
  // every excluded repo, which is false for four of the six (psiTurk is Python, clientDRemote is
  // JS). An unmeasured surface is unknown, and unknown must not be dressed as measured.
  if (e.stamp >= EXCLUDED_FROM && scanned.size > 0) for (const x of EXCLUDED) if (!vis[x]) vis[x] = { state: 'excluded', surface: surfaceOf(x), open: { crit: 0, high: 0, med: 0, low: 0, unknown: 0 }, openTotal: 0, accepted: 0, raw: 0, distinct: 0, canonical: 0, tools: {}, note: excludedNote(x) };
  // superseded repos likewise vanish from scans from their own effectiveFrom — keep them visible
  // as DISTINCT superseded rows (rollback standby: tree intact, re-scannable on rollback).
  if (scanned.size > 0) for (const [x, lc] of Object.entries(LIFECYCLE)) {
    if (!lifecycleAt(x, batchStampOf(s.sliceId, s.source, e.stamp)) || vis[x]) continue; // pre-cutover, or scanned/excluded row wins
    vis[x] = { state: 'superseded', surface: surfaceOf(x), open: { crit: 0, high: 0, med: 0, low: 0, unknown: 0 }, openTotal: 0, accepted: 0, raw: 0, distinct: 0, canonical: 0, tools: {},
      lifecycle: { supersededBy: lc.supersededBy, effectiveFrom: lc.effectiveFrom },
      note: `superseded (rollback standby) by ${lc.supersededBy}${lc.note ? ' — ' + lc.note : ''}; tree retained, out of active scan scope from ${lc.effectiveFrom}` };
  }

  // fleet tiers
  const fleet = { raw: 0, distinct: 0, canonical: 0, open: { crit: 0, high: 0, med: 0, low: 0, unknown: 0 }, accepted: 0 };
  const uniq = new Set();
  for (const [name, v] of Object.entries(vis)) {
    fleet.raw += v.raw; fleet.distinct += v.distinct; fleet.canonical += v.canonical; fleet.accepted += v.accepted;
    for (const k of SEV) fleet.open[k] += v.open[k] || 0;
    const r = repos[name]; if (r) for (const c of r.canon.values()) uniq.add(c.root);
  }
  fleet.uniqueAdvisories = uniq.size;

  const anchors = s.anchors ? Object.values(s.anchors)[0] : null;
  slices.push({
    stamp: e.stamp, sliceId: s.sliceId || `v0-${e.stamp}`, generated: s.generated || e.generated, v1,
    subject: subj, provenance: v1 && anchors ? { sha: (anchors.sha || '').slice(0, 10), branch: anchors.branch, dirty: anchors.dirty } : { note: 'v0 — no anchors recorded' },
    recordedIndexRow: { total: e.total, crit: e.crit, high: e.high, med: e.med, low: e.low, new: e.new, fixed: e.fixed },
    countNote: 'recorded index total counts raw tool occurrences (osv+npm double-report); distinct collapses same advisory id+package; canonical additionally merges GHSA/CVE aliases from osv rule metadata',
    fleet, event: RECLASS[e.stamp] || (v1 ? { kind: 'v1', note: 'provenance-gated slice', citations: [] } : { kind: 'unclassified', note: 'no reclassification recorded', citations: [] }),
    repos: vis,
  });
  // canonical finding detail sidecar
  const detail = [];
  for (const [name, r] of Object.entries(repos)) for (const c of r.canon.values())
    detail.push({ repo: name, root: c.root, ids: [...c.ids], package: c.package, severity: c.sev, tools: [...c.tools], paths: [...c.paths], accepted: c.ann });
  mkdirSync(join(corrDir, 'slices'), { recursive: true });
  writeFileSync(join(corrDir, 'slices', `${e.stamp}.json`), JSON.stringify({ stamp: e.stamp, sliceId: s.sliceId || `v0-${e.stamp}`, findings: detail }, null, 1));
}

mkdirSync(corrDir, { recursive: true });
writeFileSync(join(corrDir, 'index.json'), JSON.stringify({
  note: 'PARALLEL CORRECTED INDEX — derived, idempotent, originals untouched. Three count tiers (raw/distinct/canonical); events reclassified with citations; per-repo visibility states where blind-jvm/no-surface/excluded are NEVER rendered as clean.',
  derivedAt: new Date().toISOString(), aliasRulesIngested: aliasRules, excludedRepos: [...EXCLUDED], excludedFrom: EXCLUDED_FROM,
  lifecycle: LIFECYCLE,
  jvmBlindNote: 'clones-era scans (phase1*) had no gradle lockfiles: every Gradle service is blind-jvm there; true JVM exposure for that era is recorded in corrected/dimensions/jvm.json (102C/675H at 2026-06-27). Monorepo era is JVM-visible from client-a 4b9e33f9 (2026-07-01).',
  slices,
}, null, 1));
console.log(`corrected-history: ${slices.length} slices -> ${join(corrDir, 'index.json')} (${aliasRules} alias-bearing rules ingested)`);
for (const sl of slices) {
  const f = sl.fleet;
  console.log(` ${sl.stamp} ${sl.subject.era.padEnd(8)} raw=${String(f.raw).padStart(4)} distinct=${String(f.distinct).padStart(4)} canonical=${String(f.canonical).padStart(4)} uniqueAdv=${String(f.uniqueAdvisories).padStart(3)} open(c/h/m/l)=${f.open.crit}/${f.open.high}/${f.open.med}/${f.open.low} acc=${f.accepted} [${sl.event.kind}]`);
}
