#!/usr/bin/env node
// commitwork monitor — overwatch-layer exporter.
// Pushes the latest rollup.json into the Portll overwatch-layer (memory-layer server) so
// internal-d's overlook/meta_audit can reason over security-audit history.
//
// usage: node monitor/export-overwatch.mjs [rollup.json] [--dry-run]
// env:   VELD_API_URL     (default http://127.0.0.1:3030)
//        VELD_API_KEY     (env -> keychain, resolved at call time by lib/memory-layer-client.mjs)
//        VELD_USER_ID     (default portll — see the TENANT note below)
//        CW_VELD_VERIFY=0 (skip readback; every receipt then states accepted-unverified)
//
// Best-effort by design: any failure logs and exits 0 — the sweep must never be blocked by the
// overwatch-layer. external_id is identity, not occurrence; sweep summaries keep their stamp (episodic).
// The tenant is `portll` — the person; anything that could appear in a memory-layer-project:/scope: tag is
// not a tenant. Tenant history migration is unresolved (lib/memory-layer-contract.json#migration).

import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { outDirFor } from './area.mjs'; // the OUT resolver — never re-derive the chain here
import { upsert, health, credential, config, tally, summarise, safeUrl, VERIFIED, STORED_PREVIEW } from '../lib/memory-layer-client.mjs';
import { writeAtomic } from './lockfile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
// An explicit rollup path argument wins (sweep.mjs passes one); the default follows the registry.
const rollupPath = argv.find((a) => !a.startsWith('--')) || join(outDirFor(null), 'rollup.json');

// lib/memory-layer-client.mjs is the ONLY memory-layer write path in this repo. WRITER_SCOPE says who wrote it —
// a sweep artifact and a session memory must stay separable.
const WRITER_SCOPE = 'commitwork-sweep';

// A missing credential is a fact about THIS BOX (stderr, with the remedy), not "overwatch down".
// Still exit 0 — the sweep must not be blocked.
if (!dryRun) {
  const cred = credential({});
  if (!cred.ok) {
    console.error('[export-overwatch] NOT exporting. This is a configuration failure on this machine,');
    console.error('  not the overwatch-layer being unavailable — fix it with: node bin/secrets.mjs set VELD_API_KEY');
    process.exit(0);
  }
  console.log(`[export-overwatch] credential source: ${cred.source}`);
}

if (!existsSync(rollupPath)) {
  console.log(`[export-overwatch] rollup not found at ${rollupPath} — skipping`);
  process.exit(0);
}
let rollup;
try { rollup = JSON.parse(readFileSync(rollupPath, 'utf8')); }
catch (e) {
  // A torn or corrupt rollup is not an absent one, so it is named as such, and the sweep still is not blocked.
  console.error(`[export-overwatch] NOT exporting: ${rollupPath} exists and could not be read (${e.message})`);
  process.exit(0);
}
// Area for external_id identity, from the report dir the rollup was read from; falls back to the
// rollup's declared scope, then a stated 'unscoped' — never a guessed area name.
const areaKey = (rollupPath.split('/').slice(-2, -1)[0] || rollup.area || rollup.coverage?.scope || 'unscoped');
const generated = rollup.generated || new Date().toISOString();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every receipt kept — with exit-0-always, a log-line-only receipt is not evidence.
const receipts = [];

// One write -> receipt state verified / accepted-unverified / failed, PLUS storedForm, which is a
// separate axis: full / preview / divergent / unknown. `truncated` is still declared by the caller
// (it describes what we chose to send); storedForm is MEASURED against what came back, because the
// layer summarises long records to their first 50 words and a write can succeed while storing
// almost none of it. "Round-tripped" and "complete" are different facts and both get reported.
async function store(record, { truncated = false } = {}) {
  if (dryRun) {
    console.log(`[dry-run] would store: ${record.external_id} (${record.content.length}B)`);
    receipts.push({ ...record, state: 'dry-run', reason: 'dry run — nothing was written' });
    return true;
  }
  const r = await upsert(record, { scope: WRITER_SCOPE, truncated });
  receipts.push(r);
  if (r.storedForm === STORED_PREVIEW) {
    // Named separately and loudly. This one is NOT a transport failure — the write landed — so it
    // would otherwise read as an ordinary accepted-unverified and be filed under "probably fine".
    const pct = r.storedCoverage == null ? '?' : `${(r.storedCoverage * 100).toFixed(1)}%`;
    console.log(`[export-overwatch] ${record.external_id}: STORED AS PREVIEW ONLY — the layer kept ${pct} of it. This record is not a durable copy.`);
  } else if (r.state !== VERIFIED) {
    console.log(`[export-overwatch] ${record.external_id}: ${r.state} — ${r.reason}`);
  }
  return r.state === VERIFIED;
}

// Health gate: overwatch-layer down -> no-op, said out loud (a log line, not stderr).
if (!dryRun) {
  const h = await health({});
  if (!h.ok) {
    console.log(`[export-overwatch] overwatch-layer unreachable at ${safeUrl(config({}).url)} (${h.reason}) — skipping`);
    process.exit(0);
  }
}

const t = rollup.totals || {};

// 1. Sweep-level summary memory.
const c = rollup.counts || {};
const summary = [
  `COMMITWORK_AUDIT_ROLLUP ${generated}`,
  `source: ${rollup.source || rollupPath}`,
  rollup.sliceId ? `slice: ${rollup.sliceId} (v${rollup.sliceVersion}, ${rollup.kind}) — lifecycle: +${c.born ?? '?'} born, ${c.cleaned ?? '?'} cleaned (verified), ${c.unconfirmed ?? '?'} unconfirmed, ${c.accepted ?? '?'} accepted, ${c.carried ?? '?'} carried/not-scanned` : null,
  `repos: ${t.repos ?? (rollup.repos || []).length}, findings crit:${t.crit ?? 0} high:${t.high ?? 0} med:${t.med ?? 0} low:${t.low ?? 0}`,
  `KEV-listed: ${t.kev ?? 0}, distinct CVEs: ${t.cves ?? 0}`,
  `checks: ${(rollup.checks || []).join(', ')}`,
].filter(Boolean).join('\n');
await store({
  content: summary,
  tags: ['commitwork', 'audit-rollup', 'sweep-summary'],
  memory_type: 'Episodic',
  // Keeps the stamp: a sweep summary is episodic; per-repo state below is semantic (one record).
  external_id: `commitwork:sweep:${generated}`,
});
await sleep(300);

// 2. One memory per repo that has findings in ANY lane (top 5 by severity, KEV first).
// `repo.findings` is the CVE lane only; scanner detail is fleet-shaped (rollup.scannerFindings)
// and re-indexed by repo here.
const sevRank = { crit: 0, critical: 0, high: 1, medium: 2, med: 2, low: 3 };
const detailByRepo = new Map(); // repo -> { category -> rows[] }
for (const [category, rows] of Object.entries(rollup.scannerFindings || {})) {
  for (const row of (Array.isArray(rows) ? rows : [])) {
    if (!row || !row.repo) continue;
    if (!detailByRepo.has(row.repo)) detailByRepo.set(row.repo, {});
    const byCat = detailByRepo.get(row.repo);
    (byCat[category] = byCat[category] || []).push(row);
  }
}
// One line per finding; only fields actually present are printed.
const rowLine = (r) => {
  const where = [r.file, r.line].filter(Boolean).join(':');
  const what = r.package ? `${r.package}${r.version ? `@${r.version}` : ''}` : '';
  return `- ${[r.rule || r.id || '', what, where, r.message ? String(r.message).slice(0, 120) : '']
    .filter(Boolean).join(' · ')}`;
};
for (const repo of rollup.repos || []) {
  const findings = repo.findings || [];
  const detail = detailByRepo.get(repo.name) || {};
  // Counts come from `scanners`, so a category with no per-finding detail still reports.
  const scannerCounts = Object.entries(repo.scanners || {})
    .filter(([, v]) => v && Number(v.total) > 0)
    .sort((a, b) => b[1].total - a[1].total);
  // A repo is worth a memory if ANY lane has something to say. The old test was CVEs alone.
  if (!findings.length && !scannerCounts.length && !Object.keys(detail).length) continue;

  const top = [...findings]
    .sort((a, b) => (b.kev === true) - (a.kev === true) || (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9))
    .slice(0, 5)
    .map((f) => `- [${f.severity || '?'}${f.kev ? '/KEV' : ''}] ${f.id || f.tool || '?'}: ${f.title || ''}`.trim() +
      (typeof f.epss === 'number' ? ` (EPSS ${f.epss})` : ''));
  const scannerLines = scannerCounts.map(([cat, v]) => {
    const sev = ['crit', 'high', 'med', 'low'].map((k) => (v[k] ? `${v[k]}${k[0].toUpperCase()}` : null)).filter(Boolean).join('/');
    // A capped list must say so.
    const capped = v.truncated ? ` (+${v.truncated} not serialized)` : '';
    return `- ${cat}: ${v.total}${sev ? ` (${sev})` : ''}${v.carried ? ' [carried — not re-run this slice]' : ''}${capped}`;
  });
  const detailLines = Object.entries(detail).sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .flatMap(([cat, rows]) => [`${cat} — ${rows.length} row(s), top ${Math.min(3, rows.length)}:`,
      ...rows.slice(0, 3).map(rowLine)]);
  const content = [
    `COMMITWORK_AUDIT ${repo.name} @ ${generated} — worst: ${repo.worst || '?'}`,
    findings.length ? `${findings.length} dependency CVE finding(s). Top:` : 'no dependency CVE findings.',
    ...top,
    scannerLines.length ? 'scanner categories with findings:' : null,
    ...scannerLines,
    detailLines.length ? 'per-finding detail:' : null,
    ...detailLines,
  ].filter(Boolean).join('\n');
  await store({
    content,
    tags: ['commitwork', 'audit-rollup', `project:${repo.name}`, `worst:${repo.worst || 'unknown'}`],
    memory_type: 'Episodic',
    // Identity, not occurrence — the stamp lives in the content/tags; the key names what the
    // record is ABOUT. Never key an identity on time.
    external_id: `commitwork:rollup:${areaKey}:${repo.name}`,
  }, {
    // Declared, not inferred: the body is capped in three independent places.
    truncated: findings.length > 5
      || Object.values(detail).some((rows) => rows.length > 3)
      || scannerCounts.some(([, v]) => Number(v.truncated) > 0),
  });
  await sleep(300); // stay under the overwatch-layer rate limiter
}

// 3. Verified-remediation ledger entries for THIS slice (idempotent via external_id; scoped
// to the current slice so a nightly export doesn't re-push the whole ledger every run).
if (rollup.sliceId) {
  let ledger = null;
  try { ledger = JSON.parse(readFileSync(join(dirname(resolve(rollupPath)), 'remediation-ledger.json'), 'utf8')); } catch {}
  for (const e of (ledger && ledger.entries || []).filter((x) => x.resolvedSlice === rollup.sliceId)) {
    const content = [
      `COMMITWORK_REMEDIATION ${e.vulnId} ${e.package} (${e.repo}) — ${e.evidence.tier === 'weak' ? 'UNCONFIRMED' : 'CLEANED (verified)'}`,
      `evidence [${e.evidence.tier}]: ${e.evidence.detail}`,
      `${e.fromVersion ? `version ${e.fromVersion}${e.toVersion ? ` -> ${e.toVersion}` : ''} · ` : ''}${e.fixCommit ? `fix commit ${e.fixCommit} · ` : ''}born ${e.bornSlice || '?'} -> resolved ${e.resolvedSlice}`,
    ].join('\n');
    await store({
      content,
      tags: ['commitwork', 'remediation-ledger', `project:${e.repo}`, `tier:${e.evidence.tier}`],
      memory_type: 'Episodic',
      external_id: `commitwork:ledger:${e.resolvedSlice}:${e.key}`,
    });
    await sleep(300);
  }
}

// ── Receipts ────────────────────────────────────────────────────────────────
// Persisted atomically — with exit-0-always, a log-line-only receipt leaves every degraded state
// silent. Routed through the rollup's own directory, never reports/<name> joined by hand.
if (!dryRun) {
  const dest = join(dirname(resolve(rollupPath)), 'memory-layer-receipts.json');
  const payload = {
    generated: process.env.CW_NOW || new Date().toISOString(),
    area: areaKey,
    rollup: rollupPath,
    tenant: config({}).userId,
    scope: WRITER_SCOPE,
    contractVersion: 1,
    tally: tally(receipts),
    receipts,
  };
  try {
    writeAtomic(dest, `${JSON.stringify(payload, null, 2)}\n`);
  } catch (err) {
    console.error(`[export-overwatch] could not write receipts to ${dest}: ${err.message}`);
  }
}

// Three states, not two — "accepted, never read back" is the state worth reporting. The URL goes
// through safeUrl(): a URL may legally carry credentials in its userinfo.
const t9 = tally(receipts);
console.log(`[export-overwatch] ${dryRun
  ? `dry-run — ${receipts.length} memories prepared`
  : `${t9.total} memories: ${summarise(receipts)}`}, tenant=${config({}).userId}, url=${safeUrl(config({}).url)}`);
process.exit(0);
