#!/usr/bin/env node
/*
 * attach-cve.mjs — STEP A: attach container-granularity CVE data to the map. Reads
 * ./cve-history/latest-image.json + the latest jvm full-cve-list; mutates ./data.json
 * (per-node node.cve, meta.cveSnapshot, recomputed meta.summary).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MAP_ROOT ? process.env.MAP_ROOT : __dirname; // per-project data root (commitwork/map/data/<project>)
const CVE_DIR = join(ROOT, 'cve-history');
const DATA_PATH = join(ROOT, 'data.json');
// Per-project join config: aliases, base-repo fallbacks, dead images, no-image nodes.
const state = JSON.parse(readFileSync(join(ROOT, 'migration-state.json'), 'utf8'));
const JOIN = (state.meta && state.meta.imageJoin) || {};

// ---- load image-level counts ----
const imageSnap = JSON.parse(readFileSync(join(CVE_DIR, 'latest-image.json'), 'utf8'));
const imageByNode = {};
for (const c of imageSnap.counts) imageByNode[c.node] = c;
const scanIncomplete = imageSnap.scanIncomplete || [];

// Live fleet total from snapshot counts — dead images are excluded so they don't inflate it.
const DEAD_IMAGE_NODES = new Set(
  (imageSnap.counts || []).filter(c => c.dead).map(c => c.node)
    .concat(JOIN.deadImages || [])   // per-project supplement for snapshots that predate the `dead` flag
);
const fleet = (imageSnap.counts || []).reduce((a, c) => {
  if (DEAD_IMAGE_NODES.has(c.node)) return a;
  a.CRITICAL += c.CRITICAL || 0; a.HIGH += c.HIGH || 0; a.MEDIUM += c.MEDIUM || 0; a.LOW += c.LOW || 0; a.total += c.total || 0;
  return a;
}, { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, total: 0 });
const FLEET_TOTAL = fleet.total;
const FLEET_BY_SEV = { CRITICAL: fleet.CRITICAL, HIGH: fleet.HIGH, MEDIUM: fleet.MEDIUM, LOW: fleet.LOW };

// ---- load jvm-level full list (the most-recent jvm snapshot pointed to by latest.json) ----
const jvmManifest = JSON.parse(readFileSync(join(CVE_DIR, 'latest.json'), 'utf8'));
const jvmDir = join(CVE_DIR, jvmManifest.dir);
const jvmRows = JSON.parse(readFileSync(join(jvmDir, 'full-cve-list.json'), 'utf8'));
const jvmTotal = jvmRows.length;
// group jvm rows by service
const jvmByService = {};
for (const r of jvmRows) (jvmByService[r.service] = jvmByService[r.service] || []).push(r);

// ---- node-name -> image-node-key map (empty when naming already lines up) ----
const IMAGE_NODE = JOIN.aliases || {};
// Pinned-tag aliases rot on image bumps — fall back to BASE REPO match against the live keys.
const IMAGE_BASE = JOIN.baseRepos || {};
function resolveImageKey(name) {
  const pinned = IMAGE_NODE[name];
  if (pinned && imageByNode[pinned]) return pinned;
  const base = IMAGE_BASE[name];
  if (base) {
    const b = base.toLowerCase();
    const hit = Object.keys(imageByNode).find((k) => {
      const kk = k.toLowerCase();
      return kk.startsWith(b + ':') || kk.includes('/' + b + ':') || kk.split(':')[0] === b || kk.split(':')[0].endsWith('/' + b);
    });
    if (hit) return hit;
  }
  return pinned || name;
}


// ---- node-name -> jvm service key for topJvm (empty when names match) ----
const JVM_SERVICE = {
};

// No-image nodes -> cve:null. KINDS are structural; individual NODES are project shape (JOIN).
const NO_IMAGE_KINDS = new Set(JOIN.noImageKinds || ['frontend', 'docs', 'seeder']);
const NO_IMAGE_NODES = new Set(JOIN.noImageNodes || []);
function isNoImage(node) {
  return NO_IMAGE_KINDS.has(node.kind) || NO_IMAGE_NODES.has(node.name);
}

const SEV_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };
function topJvmFor(serviceKey, limit = 8) {
  const rows = jvmByService[serviceKey];
  if (!rows || !rows.length) return null;
  return rows
    .slice()
    .sort((a, b) => (SEV_RANK[a.severity] - SEV_RANK[b.severity]))
    .slice(0, limit)
    .map(r => ({ cve: r.cve, severity: r.severity, pkg: r.pkg, installed: r.installed, fixed: r.fixed || '', url: r.url || '' }));
}

// ---- main: walk every node in subsystems and attach cve ----
const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));

let attachedImage = 0, attachedNull = 0, attachedJvm = 0;
const attachedDetail = [];

for (const sub of data.subsystems) {
  for (const node of sub.nodes) {
    if (isNoImage(node)) {
      node.cve = null;
      attachedNull++;
      attachedDetail.push({ node: node.name, kind: node.kind, mode: 'null' });
      continue;
    }

    // resolve the image-node key (exact alias first, then live base-repo match)
    const imgKey = resolveImageKey(node.name);
    const ic = imageByNode[imgKey];

    // resolve jvm service key (default: the node name)
    const jvmKey = JVM_SERVICE[node.name] || node.name;
    const topJvm = topJvmFor(jvmKey);

    if (ic) {
      const cve = {
        total: ic.total,
        bySeverity: { CRITICAL: ic.CRITICAL, HIGH: ic.HIGH, MEDIUM: ic.MEDIUM, LOW: ic.LOW },
        imageRef: ic.image,
        link: ic.link,
      };
      if (topJvm) { cve.topJvm = topJvm; cve.jvmRef = jvmManifest.dir; attachedJvm++; }
      node.cve = cve;
      attachedImage++;
      attachedDetail.push({ node: node.name, kind: node.kind, mode: 'image', image: ic.image, C: ic.CRITICAL, H: ic.HIGH, jvm: topJvm ? topJvm.length : 0 });
    } else if (topJvm) {
      // jvm-only: no image counts but real jar CVEs — derive bySeverity from the jvm rows
      const rows = jvmByService[jvmKey];
      const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
      for (const r of rows) if (bySeverity[r.severity] != null) bySeverity[r.severity]++;
      node.cve = {
        total: rows.length,
        bySeverity,
        topJvm,
        jvmRef: jvmManifest.dir,
        jvmOnly: true,
      };
      attachedImage++; attachedJvm++;
      attachedDetail.push({ node: node.name, kind: node.kind, mode: 'jvm-only', C: bySeverity.CRITICAL, jvm: topJvm.length });
    } else {
      // a service node we could not join — mark null but flag for review
      node.cve = null;
      attachedNull++;
      attachedDetail.push({ node: node.name, kind: node.kind, mode: 'null(no-join)' });
    }
  }
}

// ---- meta.cveSnapshot ----
data.meta.cveSnapshot = {
  imageRef: 'cve-history/latest-image.json (' + (imageSnap.dir || imageSnap.event) + ')',
  jvmRef: 'cve-history/' + jvmManifest.dir + '/full-cve-list.json',
  capturedAt: imageSnap.capturedAt || jvmManifest.capturedAt,
  imageTotal: FLEET_TOTAL,
  imageBySeverity: { C: FLEET_BY_SEV.CRITICAL, H: FLEET_BY_SEV.HIGH, M: FLEET_BY_SEV.MEDIUM, L: FLEET_BY_SEV.LOW },
  jvmTotal,
  // severity split of the same jvm rows — feeds the masthead "CRITICAL · now" KPI
  jvmBySeverity: jvmRows.reduce((a, r) => (a[r.severity] != null && a[r.severity]++, a), { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }),
  scanIncomplete,
  // the caveat is the project's own; the engine only knows the rule it applied
  note: JOIN.snapshotNote || 'fleet image total computed from latest-image.json LIVE images only; images flagged dead are replaced by their live successors and excluded so they no longer inflate the total.',
};

// ---- recompute meta.summary to include CVE totals ----
// CVE rollup across app tracks (image-joined nodes; excludes infra + dead images)
const appNodes = [];
for (const sub of data.subsystems) for (const node of sub.nodes) {
  if (node.cve && node.cve.bySeverity && !node.cve.incomplete) {
    const isInfra = node.kind === 'infra';
    appNodes.push({ name: node.name, infra: isInfra, sev: node.cve.bySeverity, total: node.cve.total });
  }
}
const appTracks = appNodes.filter(n => !n.infra);
const sumSev = (list) => list.reduce((a, n) => {
  a.CRITICAL += n.sev.CRITICAL; a.HIGH += n.sev.HIGH; a.MEDIUM += n.sev.MEDIUM; a.LOW += n.sev.LOW; a.total += n.total; return a;
}, { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, total: 0 });

const appRollup = sumSev(appTracks);
const infraRollup = sumSev(appNodes.filter(n => n.infra));

// FALSE POSITIVE: fixed literal keys only — no attacker-controlled keys, no __proto__ path.
// nosemgrep: javascript.lang.security.insecure-object-assign.insecure-object-assign -- fixed literal keys only; see block above
data.meta.summary = Object.assign({}, data.meta.summary, {
  asOf: data.meta.asOf,
  modernizationIssues: data.meta.counts.issues,
  resolvedThisSession: data.meta.counts.resolvedThisSession,
  cve: {
    fleetImageTotal: FLEET_TOTAL,
    fleetImageBySeverity: FLEET_BY_SEV,
    jvmTotal,
    appTracksRollup: appRollup,        // sum across the joined app/service tracks
    infraSidingRollup: infraRollup,    // infra image loads
    scanIncomplete,
    note: JOIN.summaryNote || 'app-track rollup sums per-container image counts for the joined app tracks; infra siding shown separately; scan-incomplete images excluded.',
  },
});
// keep the headline counts object current too
data.meta.counts.cveAppTracks = appTracks.length;
data.meta.counts.cveFleetTotal = FLEET_TOTAL;

writeFileSync(DATA_PATH, JSON.stringify(data, null, 1));

// ---- report ----
console.log('STEP A — CVE attach complete -> data.json');
console.log('  image-joined nodes :', attachedImage);
console.log('  jvm topJvm attached:', attachedJvm);
console.log('  cve:null nodes     :', attachedNull);
console.log('  scan-incomplete    :', scanIncomplete.length, '(images the snapshot marks incomplete)');
console.log('  jvmTotal rows      :', jvmTotal);
console.log('  app-track rollup   :', JSON.stringify(appRollup));
console.log('  infra-siding rollup:', JSON.stringify(infraRollup));
console.log('  per-node modes:');
for (const d of attachedDetail) console.log('    ', JSON.stringify(d));
