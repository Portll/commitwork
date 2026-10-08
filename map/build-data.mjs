#!/usr/bin/env node
// build-data.mjs — assembles data.json from subsystems.raw.json + static meta/axis/waves.
// One-time/idempotent assembler. Re-runnable. No npm deps.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MAP_ROOT ? process.env.MAP_ROOT : __dirname; // per-project data root (commitwork/map/data/<project>)
const subsystems = JSON.parse(readFileSync(join(ROOT, 'subsystems.raw.json'), 'utf8'));
// Canonical migration structure — single source of truth; edit migration-state.json to advance the fleet.
const state = JSON.parse(readFileSync(join(ROOT, 'migration-state.json'), 'utf8'));

// CVE-history sparkline series from ../cve-history/index.json (jvm/image/deps scopes). Fallback to
// the frozen migration-state.json copies is flagged so generate.mjs can label it historic.
function deriveHistories() {
  const shape = (s) => ({ scope: s.scope || 'jvm', event: s.event, ts: s.ts || '',
    total: s.total ?? 0, crit: (s.bySeverity && (s.bySeverity.CRITICAL ?? s.bySeverity.crit)) || 0,
    note: s.note || '', external: !!s.external });
  try {
    const store = JSON.parse(readFileSync(join(ROOT, 'cve-history', 'index.json'), 'utf8'));
    const snaps = (store.snapshots || []).slice().sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    // TRUE-ORIGINAL entries are retro-measurements — only the state-over-time polyline skips them.
    const timelineFit = (s) => !/TRUE-ORIGINAL/i.test(s.event || '');
    return {
      cveHistory: snaps.filter((s) => (!s.scope || s.scope === 'jvm') && timelineFit(s)).map(shape),
      imageHistory: snaps.filter((s) => s.scope === 'image').map(shape),
      depsHistory: snaps.filter((s) => s.scope === 'deps').map(shape),
      historiesDerived: true,
    };
  } catch {
    return { cveHistory: state.meta.cveHistory || [], imageHistory: state.meta.imageHistory || [],
      depsHistory: [], historiesDerived: false };
  }
}

// ---- Version axis: top (oldest) -> bottom (future) [from migration-state.json] ----
const versionAxis = state.versionAxis;

// Map a journey "era" string to an axis id via each axis entry's own `match` spellings (project
// data, tried in axis order); a journey entry may pin its axis outright with `axis`.
const axisMatchers = versionAxis.map((a) => ({ id: a.id, match: (a.match || []).map((m) => String(m).toLowerCase()) }));
const unmapped = new Set();
function eraToAxis(era) {
  const e = String(era || '').toLowerCase();
  for (const a of axisMatchers) if (a.match.some((m) => e.includes(m))) return a.id;
  unmapped.add(era);   // no guess: an unmapped era gets axis:null and is reported below
  return null;
}

// ---- Waves: horizontal interchange bands [from migration-state.json] ----
const waves = state.waves;

// ---- Compute counts from issues ----
const counts = {
  subsystems: subsystems.length,
  nodes: 0, services: 0, containers: 0, frontends: 0, docs: 0, infra: 0, seeders: 0,
  issues: 0,
  resolved: 0, open: 0, inProgress: 0,
  resolvedThisSession: 0,
  bySeverity: { CRIT: 0, HIGH: 0, MED: 0, LOW: 0 },
  openBySeverity: { CRIT: 0, HIGH: 0, MED: 0, LOW: 0 },
};
const kindKey = { service: 'services', container: 'containers', frontend: 'frontends', docs: 'docs', infra: 'infra', seeder: 'seeders' };

for (const sub of subsystems) {
  for (const node of sub.nodes) {
    counts.nodes++;
    if (kindKey[node.kind]) counts[kindKey[node.kind]]++;
    // normalise each issue's axis hooks for the renderer
    node.journeyAxis = (node.journey || []).map(j => ({ ...j, axis: j.axis || eraToAxis(j.era) }));
    // Duplicate issue ids within a node mean two findings share one identity downstream — warn loudly.
    const seenIssueIds = new Set();
    for (const iss of node.issues || []) {
      if (iss.id != null) {
        if (seenIssueIds.has(iss.id)) {
          console.warn(`  WARN: duplicate issue id on ${node.name || node.id}: ${iss.id} — two findings share one identity`);
        }
        seenIssueIds.add(iss.id);
      }
      counts.issues++;
      if (counts.bySeverity[iss.severity] != null) counts.bySeverity[iss.severity]++;
      if (iss.status === 'resolved') counts.resolved++;
      else if (iss.status === 'in-progress') counts.inProgress++;
      else { counts.open++; if (counts.openBySeverity[iss.severity] != null) counts.openBySeverity[iss.severity]++; }
      if (iss.status === 'resolved' && iss.phase === 'session') counts.resolvedThisSession++;
    }
  }
}

// Masthead + KPI copy is PROJECT data, not engine copy; declaring none gets an empty masthead.
const meta = {
  title: state.meta.title || '',
  subtitle: state.meta.subtitle || '',
  asOf: state.meta.asOf || '',
  // masthead logo path (resolved by generate.mjs); absent => no mark
  logo: state.meta.logo || null,
  logoLabel: state.meta.logoLabel || null,
  // remediation tracks — the same list attach-security.mjs reads for labels (one source, not two)
  remediationTracks: state.meta.remediationTracks || [],
  fleetBoot: state.meta.fleetBoot,        // from migration-state.json
  kcServer: state.meta.kcServer,
  springCloud: state.meta.springCloud,
  // stack KPIs for the masthead — a project statement the engine cannot infer; empty => scan KPIs only
  kpis: state.meta.kpis || [],
  // sparkline history derived from the append-only store so the header extends as new scans land
  ...deriveHistories(),
  securityProgram: state.meta.securityProgram || null,  // commitwork monitor posture (source of truth = migration-state.json)
  counts,
  // The house severity tokens (docs/THEME.md §3.4), the same ones map/generate.mjs paints with.
  severityLegend: [
    { sev: 'CRIT', color: 'var(--crit)', label: 'Critical' },
    { sev: 'HIGH', color: 'var(--high)', label: 'High' },
    { sev: 'MED',  color: 'var(--med)',  label: 'Medium' },
    { sev: 'LOW',  color: 'var(--low)',  label: 'Low' },
  ],
  statusLegend: [
    { status: 'resolved',    glyph: 'check',  label: 'Resolved (filled + check)' },
    { status: 'in-progress', glyph: 'half',   label: 'In progress' },
    { status: 'open',        glyph: 'ring',   label: 'Open (hollow ring)' },
  ],
};

const out = { meta, versionAxis, waves, subsystems };
writeFileSync(join(ROOT, 'data.json'), JSON.stringify(out, null, 2));
console.log('data.json written:',
  counts.subsystems, 'subsystems,',
  counts.nodes, 'node-stations,',
  counts.issues, 'issues  (resolved', counts.resolved + ', resolved-this-session', counts.resolvedThisSession + ', in-progress', counts.inProgress + ', open', counts.open + ')');
console.log('open by severity:', JSON.stringify(counts.openBySeverity));
// Loud, not silent: an unclaimed era leaves axis:null — add the spelling to the owning entry's `match`.
if (unmapped.size) console.warn('  WARN: era(s) not claimed by any versionAxis `match`:', [...unmapped].map(e => JSON.stringify(e)).join(', '));
