#!/usr/bin/env node
/*
 * build-tracks.mjs — derive data.tracks[] + data.infraSiding[]. Identity (id/index/colour/cohort/
 * eras) comes from migration-state.json, the single source of truth; CVEs are joined live (JVM
 * snapshot for app tracks, node.cve for infra, cveFrozen for retired/non-spring tracks).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MAP_ROOT ? process.env.MAP_ROOT : __dirname; // per-project data root (commitwork/map/data/<project>)
const DATA_PATH = join(ROOT, 'data.json');
const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const state = JSON.parse(readFileSync(join(ROOT, 'migration-state.json'), 'utf8'));

const zero = () => ({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, total: 0 });

// ---- live per-service JVM CVE from the current snapshot the map consumes ----
const CVE_DIR = join(ROOT, 'cve-history');
const jvmBySvc = {};
// Distinguish "no snapshot exists" (UNMEASURED) from "snapshot read, no findings" (a real zero).
let jvmSnapshotLoaded = false;
try {
  const latest = JSON.parse(readFileSync(join(CVE_DIR, 'latest.json'), 'utf8'));
  const rows = JSON.parse(readFileSync(join(CVE_DIR, latest.dir, 'full-cve-list.json'), 'utf8'));
  for (const r of rows) {
    const g = (jvmBySvc[r.service] = jvmBySvc[r.service] || zero());
    if (g[r.severity] != null) g[r.severity]++;
    g.total++;
  }
  jvmSnapshotLoaded = true;
} catch (e) {
  // Fail closed: only ENOENT is "unmeasured"; any other failure must not be laundered into it.
  if (e.code !== 'ENOENT') throw e;
  console.warn('  WARN: no JVM snapshot — app tracks are UNMEASURED (not zero):', e.message);
}

// ---- tracks: stable roster (migration-state) + live/frozen CVE ----
const tracks = state.roster.map(r => ({
  id: r.id,
  short: r.short,
  index: r.index,
  colour: r.colour,
  enteredEra: r.enteredEra,
  reachedEra: r.reachedEra,
  targetEra: r.targetEra,
  futureEra: r.futureEra ?? null,
  cohort: r.cohort,
  blocked: !!r.blocked,
  blockReason: r.blockReason ?? null,
  jvmOnly: !!r.jvmOnly,
  // undefined = unmeasured (renders "Not measured"), zero() = measured and clean.
  cve: r.cveFrozen ? { ...r.cveFrozen } : (jvmSnapshotLoaded ? (jvmBySvc[r.id] || zero()) : undefined),
}));

// ---- infra siding: stable identity (migration-state) + live image CVE (node.cve) ----
const nodeByName = {};
for (const sub of data.subsystems) for (const node of sub.nodes) nodeByName[node.name] = node;
const flat = (cve) => cve && cve.bySeverity
  ? { CRITICAL: cve.bySeverity.CRITICAL, HIGH: cve.bySeverity.HIGH, MEDIUM: cve.bySeverity.MEDIUM, LOW: cve.bySeverity.LOW, total: cve.total }
  : null;
const infraSiding = (state.infra || []).map(s => {
  const node = nodeByName[s.id];
  const incomplete = !!s.incomplete || !!(node && node.cve && node.cve.incomplete);
  const out = {
    id: s.id, short: s.short, incomplete,
    imageRef: s.imageRef || (node && node.cve && node.cve.imageRef) || null,
    cve: incomplete ? null : flat(node && node.cve),
    dead: !!s.dead,
    version: s.version,
  };
  if (s.migratedFrom) out.migratedFrom = s.migratedFrom; // carry the migration lineage to the map
  if (s.migratedTo) out.migratedTo = s.migratedTo;
  if (s.supersedes) out.supersedes = s.supersedes; // shown as "⟵ <old>" on the siding (in-place replacement)
  if (s.note) out.note = s.note;
  if (s.scanPending) out.scanPending = true;
  if (s.scanNote) out.scanNote = s.scanNote;
  return out;
});

data.tracks = tracks;
data.infraSiding = infraSiding;
// non-service repos siding: off-axis, grouped by kind (docs/frontend/config/seeder/kc-ext/tooling)
data.appsSiding = state.appsSiding || null;
data.meta.counts.tracks = tracks.length;
// infra image-CVE rollup for the header footer; dead sidings and scan-incomplete are excluded
data.meta.infraCveTotal = infraSiding.filter((inf) => !inf.dead).reduce(
  (a, inf) => ({ total: a.total + ((inf.cve && inf.cve.total) || 0), C: a.C + ((inf.cve && inf.cve.CRITICAL) || 0) }),
  { total: 0, C: 0 }
);
writeFileSync(DATA_PATH, JSON.stringify(data, null, 1));

console.log('build-tracks (roster-driven from migration-state.json):');
console.log('  app tracks   :', tracks.length, '(eras from migration-state; CVEs live from JVM snapshot + frozen)');
console.log('  infra siding :', infraSiding.length);
// Sum MEASURED tracks only — an unmeasured track summed as zero fakes a clean fleet.
const measuredTracks = tracks.filter((t) => t.cve != null);
const unmeasured = tracks.length - measuredTracks.length;
const c = measuredTracks.reduce((a, t) => (a.CRITICAL += t.cve.CRITICAL || 0, a.HIGH += t.cve.HIGH || 0, a), { CRITICAL: 0, HIGH: 0 });
console.log('  app-track CVE rollup: C' + c.CRITICAL + ' H' + c.HIGH
  + ' (over ' + measuredTracks.length + '/' + tracks.length + ' tracks'
  + (unmeasured ? '; ' + unmeasured + ' UNMEASURED, not counted as zero)' : ')'));
for (const t of tracks) if (t.cohort !== 'wave3-done') console.log('   special:', t.short, '(' + t.cohort + ')', 'reached', t.reachedEra, t.cve == null ? '· CVEs not measured' : '· C' + (t.cve.CRITICAL || 0) + ' H' + (t.cve.HIGH || 0));
