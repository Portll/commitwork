#!/usr/bin/env node
// commitwork monitor — cross-complete the modernization map's cve-history with the deps timeline:
// append a scope:'deps' milestone series from history/corrected/index.json into the map's
// append-only store. Idempotent — existing entries never modified; canonical counts, not raw.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { outDirFor, ambientArea } from './area.mjs'; // THE OUT resolver: CW_MONITOR_OUT, then the area's out
import { loadRegistry } from './registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
// Fail loud — a broken registry defaulting the slug would strand deps snapshots in the wrong store
const REG = loadRegistry();
const OUT = outDirFor(null, REG);
// Canonical store is map/data/<area SLUG>/cve-history — keyed by the slug (route/artifact
// identity), never by the report dir `out`
const MAP_STORE = process.env.CW_MAP_STORE
  ? resolve(process.env.CW_MAP_STORE)
  : join(CW, 'map', 'data', ambientArea(REG, OUT).slug, 'cve-history', 'index.json');

const corr = JSON.parse(readFileSync(join(OUT, 'history', 'corrected', 'index.json'), 'utf8'));
const store = JSON.parse(readFileSync(MAP_STORE, 'utf8'));
store.snapshots = store.snapshots || [];
const have = new Set(store.snapshots.map((s) => s.event));

// milestone slices only (steady re-rollups and empty runs add noise, not history)
const MILESTONES = new Set(['baseline', 'method-change', 'subject-switch', 'real-fix', 'scope-change', 'v1']);
const tsOf = (iso) => String(iso || '').replace(/:/g, '-').replace(/\.(\d{3})Z$/, '-$1Z');
const label = (sl) => {
  if (sl.event.kind === 'baseline') return 'deps__clones-baseline';
  if (sl.event.kind === 'subject-switch') return 'deps__monorepo-subject-switch';
  if (sl.event.kind === 'method-change') return 'deps__rescan-method-change';
  if (sl.event.kind === 'scope-change') {
    // Historic token stays byte-identical — renaming it would double-append on the next run
    if (sl.stamp === '20260706152532') return 'deps__eureka-pair-excluded';
    // Other scope-changes get stamp-unique tokens so dedupe cannot drop them under the eureka name
    return `deps__scope-change-${sl.stamp}`;
  }
  if (sl.v1) return `deps__${sl.sliceId}`;
  return `deps__${sl.stamp}-${sl.event.kind}`;
};

let added = 0;
for (const sl of corr.slices) {
  if (!MILESTONES.has(sl.event.kind)) continue;
  const ev = label(sl);
  if (have.has(ev)) continue;
  const f = sl.fleet;
  store.snapshots.push({
    ts: tsOf(sl.generated), event: ev, scope: 'deps',
    total: f.canonical, uniqueCves: f.uniqueAdvisories,
    bySeverity: { CRITICAL: f.open.crit, HIGH: f.open.high, MEDIUM: f.open.med + f.accepted, LOW: f.open.low, UNKNOWN: f.open.unknown || 0 },
    note: `${f.open.crit + f.open.high + f.open.med + f.open.low} open · ${f.accepted} accepted (canonical, alias-deduped; raw ${f.raw}) — ${sl.event.kind}`,
    source: 'commitwork history/corrected/index.json', external: true,
  });
  have.add(ev); added++;
}
// the live drift point (newest non-empty slice), whatever its kind
const newest = [...corr.slices].reverse().find((s) => s.event.kind !== 'empty-run' && (s.fleet.canonical > 0 || s.fleet.accepted > 0));
if (newest) {
  const ev = `deps__current-${newest.stamp}`;
  if (!have.has(ev)) {
    const f = newest.fleet;
    const openTot = f.open.crit + f.open.high + f.open.med + f.open.low;
    store.snapshots.push({
      ts: tsOf(newest.generated), event: ev, scope: 'deps',
      total: f.canonical, uniqueCves: f.uniqueAdvisories,
      bySeverity: { CRITICAL: f.open.crit, HIGH: f.open.high, MEDIUM: f.open.med + f.accepted, LOW: f.open.low, UNKNOWN: f.open.unknown || 0 },
      note: openTot ? `${openTot} open (${f.open.low} LOW CVE-2026-10532 drift) · ${f.accepted} accepted — remediation planned (PLAN-CVE-2026-10532-logback.md)` : `${f.accepted} accepted, 0 open`,
      source: 'commitwork history/corrected/index.json', external: true,
    });
    added++;
  }
}
store.snapshots.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
writeFileSync(MAP_STORE, JSON.stringify(store, null, 1));
console.log(`sync-map-history: ${added} deps snapshots appended -> ${MAP_STORE} (${store.snapshots.length} total; existing entries untouched)`);
