import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { projectOf, projectSlug } from '../../monitor/project-scope.mjs';
import { scanScopes } from '../../monitor/scan-scope.mjs';
import { panelSchema, identityFor } from '../../monitor/detail-schema.mjs';
import { applyScannerAnnotations } from '../../monitor/annotate-lib.mjs';
import { annotationView } from '../../monitor/attribution.mjs';
import { aggregateAnnotationHealth } from './annotation-health.mjs';
import { projectConservation, projectAnomalies, projectTimelineVerify, projectRuntimeTls, projectRuntimeCspm, readJSONState } from './served-projection.mjs';
import { primaryArea } from '../../monitor/registry.mjs';
import { read as readNondet } from '../../monitor/nondeterministic-store.mjs';
import { iconState } from '../../monitor/divergence-icon.mjs';
import { anomaliesPath } from '../../monitor/artifact-anomaly.mjs';
import { budgetState } from '../../monitor/adjudication-budget.mjs';
import { SCANNER_SPECS, SCANNER_LABELS } from '../../monitor/extractors.mjs';
import { derivedLaneTabs } from '../../monitor/lane-tabs.mjs';
import { reportsFor, resolvedRepos, readJSON, readTxt, RUNTIME } from './core.mjs';
import { annotationsPathFor } from '../../monitor/store-paths.mjs';

// fact: bound once at boot by initStateView
let CW = '';
let registry = () => { throw new Error('state view used before initStateView'); };
let SERVICES = {};

let RETIRED = [];

// lifecycle-superseded (rollback standby) — DISTINCT from retired; from projects.json lifecycle.
// effectiveFrom-gated like sweep/rollup/corrected-history (a future-dated/staged entry stays an
// ACTIVE row until its stamp — never a contradictory double row); effectiveTo bounds a rollback.
const nowStamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

let SUPERSEDED = [];

// project grouping — the clientA fleet vs standalone products (e.g. internalB-dev)
// which must be segregated behind the projects picker; shared with the timeline generators
// via monitor/project-scope.mjs so API and rendered reports can never disagree.
// freshness by file mtime — the panel shows fresh/stale/never so a check that didn't run
// never renders as false-live (bifocal F4 / overloop).
const fileFresh = (p) => {
  let ms; try { ms = statSync(p).mtimeMs; } catch { return { state: 'never', label: 'never run' }; }
  const h = (Date.now() - ms) / 3.6e6;
  return { state: h < 24 ? 'fresh' : 'stale', label: h < 1 ? 'just now' : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago` };
};

// The 19 monitoring dimensions (state: live | part | plan).
const DIMENSIONS = [
  { name: 'Dependency CVEs', cat: 'security', tool: 'OSV · Trivy · npm-audit', gate: 'static/docker', state: 'live' },
  { name: 'Secrets', cat: 'security', tool: 'TruffleHog · Gitleaks', gate: 'static', state: 'live' },
  { name: 'SAST — own code', cat: 'security', tool: 'Semgrep', gate: 'static', state: 'live' },
  { name: 'SAST — deep taint', cat: 'security', tool: 'CodeQL (Java)', gate: 'static+JDK', state: 'live' },
  { name: 'Supply chain', cat: 'security', tool: 'Socket · SBOM', gate: 'static', state: 'live' },
  { name: 'Container images', cat: 'security', tool: 'Trivy image', gate: 'docker', state: 'live' },
  { name: 'IaC / Dockerfile', cat: 'security', tool: 'Trivy config · Hadolint', gate: 'static', state: 'live' },
  { name: 'Dependency hygiene', cat: 'build-health', tool: 'build-health deadcode', gate: 'static', state: 'live' },
  { name: 'Provenance', cat: 'build-health', tool: 'build-health provenance', gate: 'static', state: 'live' },
  { name: 'Build currency', cat: 'build-health', tool: 'build-health toolchain', gate: 'docker', state: 'live' },
  { name: 'Test health', cat: 'build-health', tool: 'compose-CI + toolchain', gate: 'compose', state: 'live' },
  { name: 'DAST', cat: 'runtime', tool: 'Nuclei', gate: 'running-app', state: 'live' },
  { name: 'Authorization / BOLA', cat: 'runtime', tool: 'authz-bola', gate: 'running-app', state: 'part' },
  { name: 'API contract fuzz', cat: 'runtime', tool: 'Schemathesis', gate: 'running-app', state: 'live' },
  { name: 'TLS / headers', cat: 'runtime', tool: 'testssl.sh', gate: 'https', state: 'part' },
  { name: 'Version currency / EOL', cat: 'modernization', tool: 'modernization-map', gate: 'derived', state: 'live' },
  { name: 'Auto-remediation', cat: 'supply', tool: 'Renovate (self-hosted)', gate: 'repo-integration', state: 'live' },
  { name: 'Cloud posture (CSPM)', cat: 'runtime', tool: 'Prowler', gate: 'aws', state: 'part' },
  { name: 'Code structure / SiteMap', cat: 'build-health', tool: 'universal-ctags', gate: 'static', state: 'live' },
];

function nucleiTally() {
  const p = join(RUNTIME, 'nuclei.json'); if (!existsSync(p)) return null;
  const sev = {}; const notable = [];
  for (const l of readTxt(p).split('\n')) {
    if (!l.trim()) continue;
    try {
      const d = JSON.parse(l); const s = (d.info && d.info.severity) || '?';
      sev[s] = (sev[s] || 0) + 1;
      if (['critical', 'high', 'medium', 'low'].includes(s)) notable.push({ sev: s, id: d['template-id'], at: d['matched-at'] });
    } catch { /* skip */ }
  }
  return { sev, notable: notable.slice(0, 24) };
}

// The dashboard's CodeQL numbers come from codeql-fleet.json — the structured, area-scoped file
// monitor/codeql-fleet-data.mjs writes after each sweep (wired into sweep.mjs, so it cannot rot).
// This REPLACED codeqlLatest(), which regex-scraped a fleet run.log for the same numbers while
// the structured file sat unread — the case that motivated the "do not re-derive what a
// structured file already states" rule elsewhere in this panel. The shape served is the file's
// own: totals/coverage are passed through so a 'none'-scope void can never render as a clean 0.
// The newest divergence record for this subject, or null. NULL IS THE HONEST ANSWER for "no lane has
// ever produced a divergence score here" — the panel renders the glyph grey/unmeasured on null and
// never a zero, because a zero score means "two engines AGREED", which is a measurement, and no
// record at all means nobody looked. Those are different facts and the icon distinguishes them
// (divergence-icon.mjs: measured=false is the grey oscilloscope).
//
// Fail closed and fail QUIET: the G2 store is optional infrastructure and a panel request must not
// 500 because it is absent or unreadable. An unreadable store yields null, which renders as
// unmeasured — never as agreement.
function divergenceFor(project) {
  try {
    const rows = readNondet(project, 'divergence');
    if (!Array.isArray(rows) || !rows.length) return null;
    const latest = rows[rows.length - 1];          // append-only: the last row is the newest fact
    const score = typeof latest.score === 'number' ? latest.score : null;
    return { score, state: iconState({ score }), at: latest.at ?? null, samples: rows.length };
  } catch { return null; }
}

// G1 — the shared human adjudication queue, made real. `budgetState` (adjudication-budget.mjs) had no
// production caller at all: it computed a budget nobody fed, so the "shared human queue" existed as
// arithmetic and never as a number anyone could see.
//
// The pending count is the CROSS-LANE sum of `undetermined` over this area's scanner categories —
// every finding a lane declined to determine and handed to a person. That is the correct denominator
// precisely because it spans lanes: each lane individually looks survivable, and the queue is the sum.
//
// WHAT THIS WILL SAY, AND IT SHOULD NOT BE SOFTENED. Measured 2026-09-01, the fleet carries ~23,000
// undetermined items; at the declared 5 min/item that is ~1,900 hours against a 600-minute cycle
// capacity. The honest render is a saturated budget with the overrun factor stated, not a progress
// bar pinned at 100%. A queue two orders of magnitude over capacity is not a backlog to work down,
// it is evidence that the undetermined tier needs triage rules rather than more human minutes — and
// the panel should say so rather than quietly showing 600/600.
//
// Absent rollup => null, rendered "never measured", never a zero-length queue: no rollup means nobody
// counted, and an empty queue is a claim.
function adjudicationQueue(project) {
  try {
    const roll = readJSON(join(reportsFor(project), 'rollup.json'));
    if (!roll || !roll.scanners) return null;
    let pending = 0;
    const byLane = {};
    for (const [k, v] of Object.entries(roll.scanners)) {
      const n = Number(v && v.undetermined) || 0;
      if (n > 0) { byLane[k] = n; pending += n; }
    }
    const st = budgetState({ pending });
    const capacityItems = Math.floor(st.capacityMinutes / st.minutesPerItem);
    return {
      ...st, pending, byLane,
      // How many cycles of declared capacity this queue would consume. 1 means it fits.
      overBy: capacityItems > 0 ? Math.round((pending / capacityItems) * 10) / 10 : null,
    };
  } catch { return null; }
}

function codeqlFleet(project) {
  const j = readJSON(join(reportsFor(project), 'codeql-fleet.json'));
  if (!j) return null;
  return {
    generated: j.generated || null, batch: j.batch || null,
    scanned: (typeof j.scanned === 'number') ? j.scanned : null,
    findings: (j.totals && typeof j.totals.total === 'number') ? j.totals.total : null,
    totals: j.totals || null, coverage: j.coverage || null,
  };
}

// Unified remediation — CVE (rollup) + runtime DAST/BOLA/TLS/CSPM (reports/runtime-latest).
const RANK = { crit: 4, high: 3, med: 2, low: 1 };

function dastAction(id) {
  if (/actuator/.test(id)) return 'restrict management.endpoints.web.exposure to health,info (+ auth)';
  if (/rabbitmq.*default|default-login/.test(id)) return 'rotate broker creds; remove guest/guest';
  return 'review + remediate';
}

// CAUSE 1 of the "panel does not update on project switch" bug: this took no project and read the
// PINNED default area while state(project) read the per-area one, so the CVE table and the
// Remediation list (both rendered from this array) described a different project than the KPIs
// above them — and when the default area held a foreign slice, both simply came back empty.
// Runtime rows (DAST/TLS/BOLA/CSPM) come from the SHARED reports/runtime-latest, which has no
// area dimension yet. They must still be attributable: tagging them with the viewed project would
// claim a scan that may have targeted another app, and leaving `project` unset makes the client's
// inProj() drop them from EVERY project. So they are tagged with the viewed area AND flagged
// `scope:'fleet-wide'`, so the panel can show them while stating they are not area-specific.
function remediation(project) {
  const rollup = readJSON(join(reportsFor(project), 'rollup.json')) || {};
  // the label the selected area's own items carry, so a scoped view's rows survive the client's
  // project filter instead of being tagged with another project's name
  const projectLabel = project ? projectOf(String(project)) || String(project) : null;
  const items = []; const seen = new Set();
  for (const r of (rollup.repos || [])) for (const f of (r.findings || [])) {
    const k = `${f.id}|${f.package}`; if (seen.has(k)) continue; seen.add(k);
    const acc = f.annotation && f.annotation.action === 'accept';
    const affected = (rollup.repos || []).filter((x) => (x.findings || []).some((g) => g.id === f.id)).map((x) => x.name);
    items.push({ source: 'CVE', sev: f.severity, title: f.package || f.id, detail: f.title,
      status: acc ? 'accepted' : (f.status || 'open'),
      // The signature travels with the acceptance. This string is handed to an operator — and to
      // agents, via the remediation prompts — as the reason a finding needs no work, so "accepted"
      // without a `who` invites acting on a machine's own say-so as though a person had ruled on it.
      // Machine-attributed acceptances are labelled in the text, because a prompt has no colour.
      action: acc ? `accepted by ${f.annotation.whoKind === 'machine' ? `MACHINE ${f.annotation.who}` : (f.annotation.who || 'UNATTRIBUTED')} — ${(f.annotation.reason || '').slice(0, 100)}` : (f.fixed || 'upgrade to patched'),
      repos: affected,
      // labelled from the area actually read, not a hardcoded default: an item with no
      // resolvable repo is 'unknown', never silently attributed to one project.
      project: affected[0] ? projectOf(affected[0]) : (projectLabel || 'unknown') });
  }
  const nu = nucleiTally();
  if (nu) for (const f of (nu.notable || [])) if (['critical', 'high', 'medium'].includes(f.sev))
    items.push({ project: projectLabel || 'unknown', scope: 'fleet-wide', source: 'DAST', sev: f.sev === 'critical' ? 'crit' : f.sev === 'high' ? 'high' : 'med', title: f.id, detail: (f.at || '').replace(/^https?:\/\/[^/]+/, ''), status: 'open', action: dastAction(f.id) });
  // synthesize actuator exposure — each template is "low" but the set is a real MED info-disclosure (/env, /threaddump)
  if (nu) { const act = (nu.notable || []).filter((f) => /springboot-(env|threaddump|configprops|loggers|beans|mappings|metrics|conditions|caches|heapdump|httptrace)/.test(f.id || ''));
    if (act.length >= 3) items.push({ project: projectLabel || 'unknown', scope: 'fleet-wide', source: 'DAST', sev: 'med', title: 'Spring Boot actuators exposed', detail: `${act.length} endpoints unauthenticated (incl /env, /threaddump)`, status: 'open', action: 'restrict management.endpoints.web.exposure to health,info (+ auth on the rest)' }); }
  const tls = readJSON(join(RUNTIME, 'tls-headers.json'));
  if (tls && tls.headers && tls.headers.ran && (tls.headers.missing || []).length)
    items.push({ project: projectLabel || 'unknown', scope: 'fleet-wide', source: 'TLS', sev: 'med', title: 'Missing security headers', detail: tls.headers.missing.join(', '), status: 'open', action: 'add HSTS/CSP/X-Frame/X-Content-Type/Referrer/Permissions at the edge' });
  const bola = readJSON(join(RUNTIME, 'authz-bola.json'));
  if (bola && bola.summary) {
    if ((bola.summary.findings || 0) > 0) for (const x of (bola.findings || []))
      items.push({ project: projectLabel || 'unknown', scope: 'fleet-wide', source: 'BOLA', sev: x.severity, title: x.type, detail: `${x.path} — ${x.detail}`, status: 'open', action: 'enforce object-level authz; derive tenant from token, never a client header' });
    else items.push({ project: projectLabel || 'unknown', scope: 'fleet-wide', source: 'BOLA', sev: 'med', title: 'BOLA matrix incomplete', detail: bola.summary.verdict || '', status: 'open', action: 'complete cross-tenant matrix: scoped non-admin user + per-service object endpoints' });
  }
  const cspm = readJSON(join(RUNTIME, 'cspm-github.json'));
  if (cspm && cspm.ran && cspm.fail > 0)
    items.push({ project: projectLabel || 'unknown', scope: 'fleet-wide', source: 'CSPM', sev: 'med', title: 'GitHub posture failures', detail: `${cspm.fail} checks fail`, status: 'open', action: 'harden branch protection / 2FA / actions permissions' });
  items.sort((a, b) => ((a.status === 'accepted') - (b.status === 'accepted')) || ((RANK[b.sev] || 0) - (RANK[a.sev] || 0)));
  return items;
}

// 3.2 — the preflight's blind-state reaches the surface. monitor/preflight-build.mjs writes
// {tally:{ok,blind,no-surface,missing}, repos:[{name,state}]} per area every sweep, and nothing read
// it: a BLIND repo (a manifest declares dependencies but its lock artifact is absent, so the scanner
// sees nothing) produced an empty scan that rendered byte-identical to a clean one. Surfaced so a
// blind repo's zero can read as blind, never as clean — explicit uncertainty is the whole point of preflight.
function preflightFor(project) {
  const pf = readJSON(join(reportsFor(project), 'preflight.json'));
  if (!pf) return null;
  const by = (s) => (pf.repos || []).filter((r) => r.state === s).map((r) => r.name);
  return { tally: pf.tally || null, blind: by('blind'), noSurface: by('no-surface'), missing: by('missing') };
}

// 5.2 — scannerAnnotationStatus reaches the surface, aggregated the ONLY way that is not a false
// alarm. The rollup computes {applied,noMatch,expired,invalid} every run and nothing subscribed. A
// per-area noMatch is NOT a problem — a record scoped to repo X legitimately noMatches in area Y —
// so the meaningful signal is a record that binds in NO area at all (orphaned: authored, never once
// applied), plus expired/invalid, which are wrong regardless of area. Fleet-wide by construction:
// one annotations.json bounds every area, so this must be read across all of them, not per-view.
// Reads each area's rollup and hands the per-area scannerAnnotationStatus to the pure aggregator
// (admin/lib/annotation-health.mjs, unit-tested). Fleet-wide by construction: one annotations.json
// bounds every area, so orphaned-ness is only answerable across all of them, never per-view.
function annotationHealth() {
  const reg = registry(); const root = resolve(CW, reg.reportsRoot || 'reports');
  const perArea = (reg.areas || []).map((a) => ({
    slug: a.slug,
    status: (readJSON(join(root, a.out || a.slug, 'rollup.json')) || {}).scannerAnnotationStatus,
  }));
  return aggregateAnnotationHealth(perArea);
}

// Applies annotations authored SINCE the slice was written, in place on the just-read rollup.
// Returns what was applied so the panel can say so rather than silently showing a smaller number.
// Fail-soft, unlike the write path: an unreadable store must not blank the panel, so it reports the
// error and leaves the slice exactly as the sweep wrote it — the counts are then stale, which is
// what they already were, rather than wrong.
const ANNOTATIONS_STORE = () => annotationsPathFor(CW);

// Mirrors rollup.mjs SEVLESS_BUCKET: gitleaks/trufflehog rows carry no severity, so their
// suppression moves out of `undetermined` rather than out of a crit/high/med/low bucket.
const SEVLESS_BUCKET_PANEL = { secrets: 'undetermined', secretsHistory: 'undetermined' };

function applyLiveScannerAnnotations(rollup) {
  if (!rollup || !rollup.scannerFindings || !rollup.scanners) return { applied: 0, error: null };
  let doc;
  try { doc = JSON.parse(readFileSync(ANNOTATIONS_STORE(), 'utf8')); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { applied: 0, error: null };   // no store is a legitimate empty
    return { applied: 0, error: `annotations store unreadable (${e.message}) — counts are as the last sweep wrote them` };
  }
  try {
    const { status, annotatedTotal } = applyScannerAnnotations({
      annots: doc.scannerAnnotations || [],
      scannerFindings: rollup.scannerFindings,
      scannerFleet: rollup.scanners,
      // NOW, not the slice's generated stamp: the question here is which judgments are in force for
      // the reader, and one authored an hour after the sweep is in force for them.
      asOf: new Date().toISOString(),
      identityFor, annotationView,
      sevlessBucket: SEVLESS_BUCKET_PANEL,
    });
    return { applied: annotatedTotal, sinceSlice: status.applied.length, error: null };
  } catch (e) {
    return { applied: 0, error: `annotation overlay failed (${e.message}) — counts are as the last sweep wrote them` };
  }
}

export function state(project) {
  // Read the SELECTED project's reports, not one pinned directory.
  const dir = reportsFor(project);
  const rollup = readJSON(join(dir, 'rollup.json')) || {};
  // Re-run the annotation overlay over the slice we just read. rollup.json was written by the last
  // sweep and froze the judgments in force AT THAT MOMENT, so an annotation authored since — the
  // operator marking fifteen leaks false-positive — changed nothing a reader could see until the
  // next sweep, which is hours away or, for a weekly area, days.
  //
  // Idempotent by construction: the overlay skips any row that already carries `.annotation`, so
  // rows the sweep already suppressed are not decremented twice, and only genuinely new judgments
  // move a count. The SAME function the rollup uses, not a copy of it.
  const liveAnn = applyLiveScannerAnnotations(rollup);
  // which area is being viewed — lifecycle rows are filtered to the area owning those repos.
  //
  // NO PROJECT SELECTED MEANS NO LIFECYCLE ROWS, and both of the obvious answers are wrong.
  // This fell back to `primaryArea(registry()).slug`, so with nothing selected the home page
  // published clientA's lifecycle: 13 superseded services and 2 retired ones, under a heading that
  // named no project. One area's standby fleet rendered as though it were the box's. That is the
  // same defect the registry's own note records against the deleted `monitorOutput` key — "it
  // declared one customer's area as the fleet-wide default, so an unscoped run wrote another
  // project's numbers" — reappearing one layer up, in the read path instead of the write path.
  //
  // The other wrong answer is `!viewArea || …`, which passes EVERY repo when nothing is selected
  // and would show all 15 rows instead of clientA's 15. A lifecycle row belongs to an area; with no
  // area chosen there are none to show, so the predicate must be false rather than permissive.
  const viewArea = project ? (projectSlug(project) || String(project)) : null;
  const ownsRepo = (n) => viewArea !== null && (projectSlug(projectOf(n)) || projectOf(n)) === viewArea;
  const retiredHere = RETIRED.filter(ownsRepo);
  const supersededHere = SUPERSEDED.filter((x) => ownsRepo(x.name));
  const bola = readJSON(join(RUNTIME, 'authz-bola.json'));
  const modsc = readJSON(join(dir, 'modernization.json')) || {};
  // per-project severity totals (each standalone product segregated from the clientA fleet)
  const projectTotals = {};
  const SEV = { crit: 0, high: 0, med: 0, low: 0, kev: 0, cves: 0, repos: 0 };
  for (const r of (rollup.repos || [])) {
    const p = projectOf(r.name);
    const t = projectTotals[p] || (projectTotals[p] = { ...SEV });
    t.repos++;
    for (const f of (r.findings || [])) { if (t[f.severity] != null) t[f.severity]++; t.cves++; if (f.kev) t.kev++; }
  }
  // The picker lists every project the REGISTRY knows about — not just the ones
  // that happen to appear in the latest rollup. projects.json is the single
  // source of truth (explicit `projects` + `roots` auto-discovery, minus
  // `exclude`/lifecycle), and resolveRepos is the one resolver that applies all
  // of those rules; sweep.mjs already uses it, so deriving here keeps the admin
  // UI and the sweep from disagreeing about what exists. Previously this list
  // came only from rollup.repos, so a project that had never been swept was
  // invisible — indistinguishable from one that did not exist.
  // name -> declaring registry entry. `registryKey` is `<entry>/<child>` for an expanded monorepo
  // and the bare name otherwise, so the entry is the part before the first slash.
  const entryOf = new Map();
  for (const r of resolvedRepos()) {
    const p = projectOf(r.name);
    if (!projectTotals[p]) projectTotals[p] = { ...SEV, unswept: true };
    // ONLY an EXPLICIT entry has a parent. resolveRepos sets registryKey to `<entry>/<child>` for a
    // monorepo it expanded, but to the path RELATIVE TO THE DISCOVERY ROOT for anything found by the
    // roots walk — so `Portll/clientA-docs` would yield `Portll`, an org FOLDER, presented as a
    // registry entry that declares nothing. A discovered repo is its own entry; the discriminator is
    // `source`, which the resolver already records, not the shape of the key.
    const key = typeof r.registryKey === 'string' ? r.registryKey : '';
    const explicit = String(r.source || '') === 'explicit';
    entryOf.set(r.name, (explicit && key.includes('/')) ? key.split('/')[0] : r.name);
  }
  // The primary area leads, by declaration — never a client label written into code.
  const lead = primaryArea(registry())?.label || null;
  const projects = Object.keys(projectTotals).sort((a, b) => (a === lead ? -1 : b === lead ? 1 : a.localeCompare(b)));
  return {
    generated: rollup.generated || null,
    modernization: modsc.modernization || null,
    program: modsc.program || null,
    security: rollup.totals || null,
    // per-category scanner aggregates WITH run provenance (rollup.mjs scannerFleet: crit/high/med/
    // low/total/repos + ran/skipped/noscan from checks-status.json). The client renders ran===0 as
    // a VOID, never a zero — passed through whole so the panel and the rollup cannot disagree.
    scanners: rollup.scanners || null,
    // What the READ-TIME overlay changed, so a count smaller than the slice's own is explained
    // rather than merely smaller. `applied` is rows suppressed since the sweep; `error` is set when
    // the store could not be read, in which case nothing was applied and the counts are the sweep's.
    liveAnnotations: liveAnn,
    // The canonical category set + display names (rollup.mjs, from SCANNER_SPECS). The panel used to
    // derive both from a hand-kept map of its own that had drifted thirteen categories behind, so it
    // rendered 12 of 23 and called that 12/12. Null on a rollup written before this shipped — the
    // panel falls back to its bundled copy and unions with the payload keys, so an old rollup loses
    // the labels, never the rows.
    scannerRegistry: rollup.scannerRegistry || null,
    // Per-finding drill-down for the three categories that carry one (secrets / maliciousPackages /
    // supplyChainHeuristic). Same pass-through discipline as `scanners` directly above, and for the
    // same reason: the flatten, the sort and the cap all happened in rollup.mjs, so the panel cannot
    // arrive at a different answer than the rollup by re-deriving them. Deliberately NOT its own
    // route — a second route reading the same file is a second place for the two to disagree, which
    // is exactly how the CodeQL tab ended up scraping a log while a structured file sat unread.
    //
    // The rows are already field-whitelisted at the extractor (see rollup.mjs's DETAIL_CAP block):
    // a gitleaks row carries rule/file/line/commit and nothing that could be secret material, which
    // matters because this payload leaves the box over the published tunnel.
    scannerFindings: rollup.scannerFindings || null,
    // The row CONTRACT, so the panel can render a category it has no hand-written markup for:
    // column order, labels, and what one row of that category actually means. Derived from
    // monitor/detail-schema.mjs — the same declaration the extractors build rows from and the
    // rollup validates against, so a tab cannot describe a shape the artifact does not have.
    detailSchema: panelSchema(),
    // The tabs the panel must GENERATE: every category carrying a row schema that has no
    // hand-written tab in index.html. Computed here from SCANNER_SPECS so a lane added tomorrow
    // gets a tab by existing rather than by being remembered in a sixth registry. `section` is the
    // one judgement in it (monitor/lane-tabs.mjs) — which group a lane belongs to is not derivable
    // from its id, and a lane nobody classified renders under a section that says so rather than
    // disappearing.
    // Sent for EVERY category, not just the untabbed ones: the server cannot know which tabs the
    // page hand-writes without parsing its markup, and a server guessing at the client's source is
    // a join that breaks the first time either moves. The panel holds that list already and takes
    // the complement itself.
    laneTabs: derivedLaneTabs(SCANNER_SPECS.map(([k]) => k), [], (c) => (SCANNER_LABELS[c] || null)),
    // WHAT EACH SCANNER WAS NOT ALLOWED TO SEE. Derived at read time — secrets from
    // manifests/gitleaks.toml, every other category from its own check command in the baseline
    // manifest — never restated here; see monitor/scan-scope.mjs for why a suppression the page
    // cannot show is a coverage cost nobody paid. Fleet-wide by construction (one config bounds
    // every project), and `known:false` rather than an empty list when it cannot be determined.
    scanScopes: scanScopes(),
    projects, projectTotals,
    // label -> declared slug, so the client never has to special-case a project name
    slugs: Object.fromEntries(projects.map((p) => [p, projectSlug(p)])),
    // label -> declared rollupBatch, so the picker can group 32 areas instead of listing them flat.
    // The registry declares NO general grouping field, and this is the only one that is a real
    // declaration rather than a shape read into the data: 7 of the 32 areas carry rollupBatch and
    // the other 25 carry nothing. Null is therefore its own answer and is rendered as an explicit
    // "unbatched" group — bucketing the 25 under an invented category would be exactly the false
    // correlation the taxonomy work exists to avoid, and hiding them would be worse.
    batches: Object.fromEntries(projects.map((p) => {
      const a = (registry().areas || []).find((x) => x.label === p);
      return [p, (a && a.rollupBatch) ? String(a.rollupBatch) : null];
    })),
    buildHealth: rollup.buildHealth || null,
    qualityGates: rollup.qualityGates || null,
    // `entry` is the REGISTRY ENTRY a repo came from — `clientA` for the services expanded out of
    // clientA/services, `clientA-libs` for the libs. registry-entry to area is N:1 and declared,
    // so an area is a set of entries and an entry is a set of repos; without this the fleet table
    // can only render one flat list and the structure the registry declares is invisible. Joined
    // from resolveRepos(), the same resolver the sweep uses, so the two cannot disagree about which
    // entry a repo belongs to. Null when the resolver does not know the repo (it was in the rollup
    // and is not in the current registry) — which is its own state, not a guess at a parent.
    repos: (rollup.repos || []).map((r) => ({ name: r.name, project: projectOf(r.name), worst: r.worst || 'none', buildHealth: r.buildHealth || null, qualityGates: r.qualityGates || null,
      entry: entryOf.get(r.name) || null,
      lifecycle: (rollup.scopeDelta && (rollup.scopeDelta.added || []).includes(r.name)) ? 'merged-new' : 'merged' })),
    // Lifecycle rows belong to the AREA that owns those repos. The retired/superseded lists come
    // from the global registry, so rendering them unfiltered showed the clientA fleet's retired
    // services under an unrelated project — non-specific information by construction.
    retired: retiredHere.map((n) => ({ name: n, lifecycle: (rollup.scopeDelta && (rollup.scopeDelta.removed || []).includes(n)) ? 'retired-new' : 'retired' })),
    superseded: supersededHere.map((s) => ({ ...s, lifecycle: 'superseded' })), // rollback standby — never merged into retired
    remediation: remediation(project),
    // computed-but-never-shown states, now subscribed (3.2 preflight blind-state, 5.2 annotation health)
    preflight: preflightFor(project),
    annotationHealth: annotationHealth(),
    scopeDelta: rollup.scopeDelta || { added: [], removed: [] },
    runtime: {
      nuclei: nucleiTally(), bola: bola ? bola.summary : null,
      // allowlist projection (lib/served-projection.mjs): these two were the panel's worst raw
      // passthrough — whole report files over the tunnel for a four-field card. null stays null.
      tlsHeaders: projectRuntimeTls(readJSON(join(RUNTIME, 'tls-headers.json'))),
      cspm: projectRuntimeCspm(readJSON(join(RUNTIME, 'cspm-github.json'))),
    },
    // R1: computed-and-stored states, served through the same allowlist discipline.
    // conservation: {checked,violations} off this rollup — absent field is 'never-checked'.
    conservation: projectConservation(rollup.conservation),
    // artifact husks: fleet-level artifact-anomalies.json at the reports ROOT (sweep writes it
    // there, not per area). absent => 'never-measured'; unreadable is its own state, never [].
    artifactAnomalies: projectAnomalies(readJSONState(anomaliesPath(resolve(CW, registry().reportsRoot || 'reports')))),
    // sliceSha256 three-state verify over this area's recent history window.
    timelineVerify: projectTimelineVerify(join(dir, 'history')),
    freshness: {
      dast: fileFresh(join(RUNTIME, 'nuclei.json')),
      bola: fileFresh(join(RUNTIME, 'authz-bola.json')),
      tls: fileFresh(join(RUNTIME, 'tls-headers.json')),
      cspm: fileFresh(join(RUNTIME, 'cspm-github.json')),
    },
    services: Object.keys(SERVICES),
    codeql: codeqlFleet(project),
    divergence: divergenceFor(project),
    adjudication: adjudicationQueue(project),
    // CAUSE 2: the client used to gate DAST / CodeQL / modernization on `curProj === 'clientA'`,
    // so no other project could EVER show them regardless of its data. Capability is a property of
    // what this area actually HAS, not of its name — report it and let the client render on that.
    // Absent capability must read "not available for this project", never a fleet number.
    has: {
      runtime: !!(nucleiTally() || bola || readJSON(join(RUNTIME, 'tls-headers.json'))),
      codeql: !!codeqlFleet(project),
      divergence: !!divergenceFor(project),
      adjudication: !!adjudicationQueue(project),
      modernization: !!(modsc.modernization),
      program: !!(modsc.program && (modsc.program.worklist || []).length),
      lifecycle: retiredHere.length > 0 || supersededHere.length > 0,
    },
    // the resolved data source, so the footer can state which area it is actually reading
    source: { dir: reportsFor(project).replace(CW + '/', ''), runtime: RUNTIME.replace(CW + '/', '') },
    dimensions: DIMENSIONS,
    counts: DIMENSIONS.reduce((a, d) => (a[d.state] = (a[d.state] || 0) + 1, a), {}),
  };
}

// contract: run once at boot, before the first request
export function initStateView({ cw, registry: reg, services, registryBoot }) {
  CW = cw;
  registry = reg;
  SERVICES = services;
  RETIRED = registryBoot.exclude || [];
  SUPERSEDED = Object.entries(registryBoot.lifecycle || {})
  .filter(([, l]) => l.state === 'superseded' && (!l.effectiveFrom || nowStamp() >= l.effectiveFrom) && (!l.effectiveTo || nowStamp() < l.effectiveTo))
  .map(([n, l]) => ({ name: n, supersededBy: l.supersededBy || '' }));
}
