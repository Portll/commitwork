#!/usr/bin/env node
// modernization.mjs — ingest the modernization-map's migration-state.json into a machine-readable
// sidecar (reports/<out>/modernization.json) for the :7878 dashboard: version-currency per service
// + fleet summary, and the remediation worklist + burndown. Best-effort: never throws.
// Source of truth: map/data/<area slug>/migration-state.json (override with MIGRATION_STATE).
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registry, outDirFor, ambientArea } from './area.mjs'; // THE OUT resolver

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
const REG = registry();
const OUT = outDirFor(null, REG);
// Map data dir is keyed by the area's SLUG (route/artifact identity), never its report dir `out`
const AREA = ambientArea(REG, OUT);

if (!process.env.MIGRATION_STATE && AREA.slug && !AREA.declared) {
  console.error(`modernization: '${OUT}' matches no declared area, so map/data/${AREA.slug}/migration-state.json would be another project's — declare an area in monitor/projects.json, or set MIGRATION_STATE.`);
  process.exit(2);
}
const MS = process.env.MIGRATION_STATE
  ? resolve(process.env.MIGRATION_STATE)
  : join(CW, 'map', 'data', AREA.slug, 'migration-state.json');

if (!existsSync(MS)) {
  console.error(`modernization: migration-state not found at ${MS} — skipped (best-effort)`);
  process.exit(0);
}

const d = JSON.parse(readFileSync(MS, 'utf8'));
const axis = d.versionAxis || [];
const eraById = Object.fromEntries(axis.map((a) => [a.id, a]));
const currentEra = axis[axis.length - 1] || {};
// superseded (rollback standby) services would double-count against their successors
const roster = (d.roster || []).filter((r) => r.reachedEra && !(r.lifecycle && r.lifecycle.state === 'superseded'));
const waves = (d.waves || []).map((w) => ({ id: w.id, status: w.status, label: w.label }));

// ── modernization: per-service version currency + fleet summary ──
const services = roster.map((r) => ({
  service: r.id,
  short: r.short,
  currentEra: r.reachedEra,
  currentEraLabel: (eraById[r.reachedEra] || {}).era || r.reachedEra,
  targetEra: r.targetEra,
  atTarget: r.reachedEra === r.targetEra,
  futureEra: r.futureEra || null,
  blocked: !!r.blocked,
}));
const atTarget = services.filter((s) => s.atTarget).length;
const atCurrent = services.filter((s) => s.currentEra === currentEra.id).length;
// EOL = still on a pre-jakarta era (Legacy/Boot2) — effectively unsupported
const eolEras = new Set(['legacy', 'boot2']);
const eolCount = services.filter((s) => eolEras.has(s.currentEra)).length;
const java25Wave = (waves.find((w) => /java\s*25/i.test(w.label)) || {}).status || 'unknown';

const modernization = {
  currentEra: currentEra.id,
  currentEraLabel: currentEra.era,
  eras: axis.map((a) => ({ id: a.id, era: a.era, sub: a.sub })),
  fleet: { total: services.length, atTarget, atCurrentEra: atCurrent, eolCount, java25Wave },
  services,
  waves,
};

// ── program: remediation worklist + burndown ──
const bl = (d.meta && d.meta.securityProgram && d.meta.securityProgram.remediationBacklog) || {};
const items = (bl.items || []).map((it) => ({ id: it.id, item: it.item, status: it.status, pw: it.pw || 0 }));
const isOpen = (it) => it.status !== 'done';
const openPw = +items.filter(isOpen).reduce((s, it) => s + it.pw, 0).toFixed(1);
const byStatus = {};
for (const it of items) if (isOpen(it)) byStatus[it.status] = (byStatus[it.status] || 0) + 1;
const program = {
  asOf: bl.asOf || (d.meta && d.meta.securityProgram && d.meta.securityProgram.asOf) || null,
  totalPw: bl.totalProgrammerWeeks != null ? bl.totalProgrammerWeeks : +items.reduce((s, it) => s + it.pw, 0).toFixed(1),
  openPw,
  byStatus,
  worklist: items,
  milestones: waves, // waves double as program milestones (done / in-progress)
};

const TS = new Date().toISOString();
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'modernization.json'), JSON.stringify({ generated: TS, source: MS, asOf: program.asOf, modernization, program }, null, 2));

// burndown: append-only snapshot (one line per run; the timeline/trend reads this)
try {
  appendFileSync(join(OUT, 'program-history.jsonl'), JSON.stringify({ ts: TS, openPw, byStatus, atTarget, total: services.length }) + '\n');
} catch { /* never block on the history append */ }

console.log(`modernization: ${services.length} svc (${atTarget} at target, ${eolCount} EOL, java25 ${java25Wave}); program ${openPw}pw open / ${program.totalPw} total, ${items.length} items`);
