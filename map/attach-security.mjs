#!/usr/bin/env node
/*
 * attach-security.mjs — STEP B: layer the security sweep onto the map data. Runs after
 * attach-cve.mjs, before build-tracks.mjs. Additive + idempotent: adds node.cveOriginal,
 * SEC- issues (remediation tracks T1..T7) and the meta.security rollup.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MAP_ROOT ? process.env.MAP_ROOT : __dirname; // per-project data root (commitwork/map/data/<project>)
const DATA = join(ROOT, 'data.json');
const STATE = join(ROOT, 'migration-state.json');
const CVE = join(ROOT, 'cve-history');
const FINDINGS = join(CVE, 'security-scans', 'security-findings.json');

const data = JSON.parse(readFileSync(DATA, 'utf8'));
const state = JSON.parse(readFileSync(STATE, 'utf8'));
const SEVMAP = { CRITICAL: 'CRIT', HIGH: 'HIGH', MEDIUM: 'MED', LOW: 'LOW' };
const worst = (rows) => { for (const s of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) if (rows.some(r => r.severity === s)) return s; return 'LOW'; };

// ---- 1. node.cveOriginal from the TRUE-ORIGINAL snapshot ----
const idx = JSON.parse(readFileSync(join(CVE, 'index.json'), 'utf8'));
const orig = (idx.snapshots || []).find(s => /TRUE-ORIGINAL/.test(s.event));
let origByService = {};
if (orig) {
  const rows = JSON.parse(readFileSync(join(CVE, orig.dir, 'full-cve-list.json'), 'utf8'));
  for (const r of rows) {
    const g = (origByService[r.service] = origByService[r.service] || { total: 0, bySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } });
    g.total++; if (g.bySeverity[r.severity] != null) g.bySeverity[r.severity]++;
  }
}

// ---- 2. security findings, grouped by node + class ----
const sf = existsSync(FINDINGS) ? JSON.parse(readFileSync(FINDINGS, 'utf8')) : { findings: [] };
const byNodeClass = {};
for (const f of sf.findings) {
  // pick the baseline that represents "what's there now / originally": worktree for source classes, live for runtime, head for jvm/base
  const k = `${f.node}|${f.class}`;
  (byNodeClass[k] = byNodeClass[k] || []).push(f);
}
const grp = (node, cls) => byNodeClass[`${node}|${cls}`] || [];
const tally = (rows) => rows.reduce((a, r) => (a[r.severity] = (a[r.severity] || 0) + 1, a), {});
const fmt = (t) => ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(s => t[s] ? `${t[s]} ${s[0]}` : null).filter(Boolean).join(' / ');

// Track metadata — the same migration-state.json list build-data.mjs publishes as meta.remediationTracks.
const TRACK = Object.fromEntries((state.meta.remediationTracks || []).map(t => [t.id, t]));
const mkIssue = (id, title, sevWord, track, blast) => ({
  id: 'SEC-' + id, title, severity: SEVMAP[sevWord] || sevWord, status: 'open', scope: 'security', phase: 'security-sweep',
  track, trackLabel: (TRACK[track] || {}).label || track, remediation: (TRACK[track] || {}).remediation || '', blast: blast || '', effort: 'open',
});

// ---- 3. walk nodes, attach cveOriginal + inject SEC- issues ----
// JS/TS dependency surface is project shape, declared per project; empty => no T2 issues.
const FRONTENDS = new Set((state.meta.securityJoin || {}).jsSupplyChainNodes || []);
// The base-image scan emits one project-level row; fan it out to service nodes only when present.
const mapNodeNames = new Set(data.subsystems.flatMap(s => s.nodes.map(n => n.name)));
const fleetBaseImage = sf.findings.filter(f => f.class === 'base-image' && !mapNodeNames.has(f.node));
let nCveOrig = 0, nIssues = 0;
for (const sub of data.subsystems) {
  for (const node of sub.nodes) {
    const name = node.name;
    // cveOriginal
    if (origByService[name]) { node.cveOriginal = origByService[name]; nCveOrig++; }
    // strip prior SEC- issues (idempotent)
    node.issues = (node.issues || []).filter(i => !String(i.id).startsWith('SEC-'));
    const push = (iss) => { node.issues.push(iss); nIssues++; };

    // JVM original — T1; the comparison reads this node's own current scan, and says so when absent.
    if (origByService[name] && origByService[name].bySeverity.CRITICAL + origByService[name].bySeverity.HIGH > 0) {
      const o = origByService[name].bySeverity;
      const nowTotal = node.cve && node.cve.total != null ? node.cve.total : null;
      push(mkIssue(`jvm-orig-${name}`,
        `JVM deps (committed-HEAD original): ${fmt(o)}` +
        (nowTotal != null ? ` — ${nowTotal} in the current scan` : ' — no current scan to compare against'),
        o.CRITICAL ? 'CRITICAL' : 'HIGH', 'T1', `${origByService[name].total} CVEs in this jar`));
    }
    // JS/TS supply chain — T2 (frontends/docs)
    if (FRONTENDS.has(name)) {
      const js = grp(name, 'dep-js'); const t = tally(js);
      if (js.length) push(mkIssue(`js-${name}`, `JS/TS supply-chain CVEs: ${fmt(t)}${js.some(r => /vm2/.test(r.pkg || '')) ? ' — incl. abandoned vm2 (sandbox-escape RCE)' : ''}`, worst(js), 'T2', `${js.length} dep CVEs`));
    }
    // IaC container hardening — T4; the issue quotes the scanner rows' own titles.
    const iac = grp(name, 'iac');
    if (iac.length) {
      const t = tally(iac);
      const titles = [...new Set(iac.map(r => r.title).filter(Boolean))];
      const what = titles.length ? titles.slice(0, 3).join('; ') + (titles.length > 3 ? `; +${titles.length - 3} more` : '') : '';
      push(mkIssue(`iac-${name}`, `Container hardening: ${fmt(t)}${what ? ' — ' + what : ''}`, worst(iac), 'T4', `${iac.length} misconfigs`));
    }
    // base-image — T3: this node's own base-image finding, else the project-level one for services
    const bi = grp(name, 'base-image')[0] || (node.kind === 'service' ? fleetBaseImage[0] : null);
    if (bi) push(mkIssue(`base-${name}`, `Base image: committed Dockerfile pins ${bi.pkg}` +
      (/\bEOL\b/i.test(bi.title || '') ? ' (EOL / removed from Docker Hub)' : ''), bi.severity, 'T3', 'per-container'));
    // SAST + secrets — T7
    const sast = grp(name, 'sast'); if (sast.length) { const t = tally(sast); push(mkIssue(`sast-${name}`, `SAST: ${sast.length} findings (${Object.entries(t).map(([k, v]) => v + ' ' + k).join(', ')})`, sast.some(r => r.severity === 'ERROR') ? 'HIGH' : 'MED', 'T7', `${sast.length} rules`)); }
    const sec = grp(name, 'secret'); if (sec.length) push(mkIssue(`secret-${name}`, `Secrets: ${sec.length} potential secret hit(s) in source (triage + rotate)`, 'HIGH', 'T7', `${sec.length} hits`));
    // IAM — T5 (keycloak)
    for (const f of grp(name, 'iam').filter(f => /^KC-/.test(f.id))) push(mkIssue(`iam-${f.id}`, f.title, f.severity, 'T5', 'realm-wide'));
    // Gateway — T6 (api-gateway)
    for (const f of grp(name, 'iam').filter(f => /^GW-/.test(f.id))) push(mkIssue(`gw-${f.id}`, f.title, f.severity, 'T6', 'all routes'));
    for (const f of grp(name, 'dast')) push(mkIssue(`dast-${f.id}`, `DAST (ZAP): ${f.title}`, f.severity, 'T6', 'runtime'));
  }
}

// ---- 3b. recompute meta.counts so KPIs include the injected SEC- issues ----
const C = data.meta.counts;
C.issues = 0; C.resolved = 0; C.open = 0; C.inProgress = 0;
C.bySeverity = { CRIT: 0, HIGH: 0, MED: 0, LOW: 0 };
C.openBySeverity = { CRIT: 0, HIGH: 0, MED: 0, LOW: 0 };
C.securityIssues = 0;
for (const sub of data.subsystems) for (const node of sub.nodes) for (const iss of (node.issues || [])) {
  C.issues++;
  if (String(iss.id).startsWith('SEC-')) C.securityIssues++;
  if (C.bySeverity[iss.severity] != null) C.bySeverity[iss.severity]++;
  if (iss.status === 'resolved') C.resolved++;
  else if (iss.status === 'in-progress') C.inProgress++;
  else { C.open++; if (C.openBySeverity[iss.severity] != null) C.openBySeverity[iss.severity]++; }
}

// ---- 3c. patch tracks[].cveOriginal directly so the runtime toggle works without re-running build-tracks ----
const flatOrig = (g) => g ? { CRITICAL: g.bySeverity.CRITICAL, HIGH: g.bySeverity.HIGH, MEDIUM: g.bySeverity.MEDIUM, LOW: g.bySeverity.LOW, total: g.total } : null;
let nTrackOrig = 0;
for (const t of (data.tracks || [])) {
  const o = origByService[t.id];
  t.cveOriginal = o ? flatOrig(o) : (t.cve ? { ...t.cve } : null); // fall back to current so the toggle never blanks a track
  if (o) nTrackOrig++;
}

// ---- 3e. restore node.cve for frozen (retired/non-spring) tracks whose live join is null,
//          so their detail panel shows the same counts as their track badge. ----
const nodeByNameAll = {};
for (const sub of data.subsystems) for (const node of sub.nodes) nodeByNameAll[node.name] = node;
for (const t of (data.tracks || [])) {
  if (!['retired', 'non-spring'].includes(t.cohort)) continue;
  const node = nodeByNameAll[t.id]; if (!node || (node.cve && node.cve.bySeverity)) continue;
  node.cve = { total: t.cve.total, bySeverity: { CRITICAL: t.cve.CRITICAL, HIGH: t.cve.HIGH, MEDIUM: t.cve.MEDIUM, LOW: t.cve.LOW }, jvmOnly: true, frozen: true };
}

// ---- 4. meta.security rollup ----
data.meta.security = {
  generatedAt: sf.meta?.generatedAt || null,
  findingsTotal: sf.meta?.total || 0,
  bySeverity: sf.meta?.bySeverity || {},
  byClass: Object.fromEntries(Object.entries(sf.meta?.classes || {}).map(([k, v]) => [k, v.total])),
  baselines: Object.fromEntries(Object.entries(sf.meta?.baselines || {}).map(([k, v]) => [k, v.total])),
  jvmOriginalCrit: Object.values(origByService).reduce((a, g) => a + g.bySeverity.CRITICAL, 0),
  jvmOriginalHigh: Object.values(origByService).reduce((a, g) => a + g.bySeverity.HIGH, 0),
  program: data.meta.securityProgram || null,   // commitwork monitor: CVE posture, KEV/EPSS, secret remediation
  // Describes the SCHEMA, not one project's release history.
  originSnapshot: orig ? (orig.event || null) : null,
  note: 'cveOriginal = the TRUE-ORIGINAL snapshot in this project\'s cve-history (toggle on map); node.cve = the current scan. Live CVE/KEV/EPSS posture, if any, is under meta.security.program / meta.securityProgram.',
};

writeFileSync(DATA, JSON.stringify(data, null, 1));
console.log('STEP B — security attach complete -> data.json');
console.log('  node.cveOriginal set:', nCveOrig);
console.log('  track.cveOriginal set:', nTrackOrig);
console.log('  SEC- issues injected:', nIssues);
console.log('  jvm original CRIT/HIGH:', data.meta.security.jvmOriginalCrit, '/', data.meta.security.jvmOriginalHigh);
console.log('  security findings total:', data.meta.security.findingsTotal, JSON.stringify(data.meta.security.byClass));
