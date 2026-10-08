#!/usr/bin/env node
// commitwork monitor — infra-image acceptance BENCHMARK. Judges each image at its TARGET state:
// every residual finding must be accepted (reachability + containment + re-check trigger) or
// listed fixableViaRebuild. Unaccounted = failure. CRIT is hard (nonzero under --strict); HIGH is
// soft unless --strict-high, which implies --strict. Also warns when a running image's digest drifts
// from its ledger pin.
// usage: node monitor/image-acceptance.mjs [--strict] [--strict-high]
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { reportsRootDir } from './area.mjs';
import { imageAcceptancePathFor } from './store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
// reports ROOT, not an area dir — the images-*-deployed scans are registry-global
const R = reportsRootDir();
// The ledger is a private record (monitor/private/image-acceptance.json, CW_IMAGE_ACCEPTANCE). Absent
// is a stated skip with exit 2, the same code as "no deployed scan": there is nothing to benchmark
// against, which is neither a pass nor a failure. Unreadable throws.
const LEDGER = imageAcceptancePathFor(CW);
let ledger;
try { ledger = JSON.parse(readFileSync(LEDGER, 'utf8')); } catch (e) {
  if (e && e.code === 'ENOENT') { console.error(`image-acceptance: no acceptance ledger at ${LEDGER} (ENOENT) — benchmark not run`); process.exit(2); }
  throw e;
}
const STRICT_HIGH = process.argv.includes('--strict-high');
// fix: --strict-high alone did nothing, the exit gated on --strict; stricter about HIGH is never laxer about CRIT
const STRICT = STRICT_HIGH || process.argv.includes('--strict');

const dirs = readdirSync(R).filter((d) => /^images-\d+-deployed$/.test(d)).sort();
if (!dirs.length) { console.error('image-acceptance: no images-*-deployed scan found'); process.exit(2); }
const deployedDir = join(R, dirs[dirs.length - 1]);

// Acceptances EXPIRE (same gate rollup.mjs applies to exemptions). Lapsed entries are counted and
// reported, never dropped quietly. EXPIRING is reported too — a cliff learned on the day it
// arrives is an incident; the 90-day horizon exists because re-acceptance is days of work per entry.
const NOW_MS = Date.now();
const EXPIRY_WARN_DAYS = 90;
const EXPIRY_WARN_MS = EXPIRY_WARN_DAYS * 864e5;
const lapsed = [];
const expiring = [];
const acceptedBy = {}, fixableBy = {};
for (const e of ledger.accepted) {
  const expMs = e.expires ? new Date(e.expires).getTime() : null;
  if (expMs !== null && expMs <= NOW_MS) { lapsed.push(e); continue; }
  if (expMs !== null && expMs - NOW_MS <= EXPIRY_WARN_MS) {
    expiring.push({ ...e, daysLeft: Math.ceil((expMs - NOW_MS) / 864e5) });
  }
  for (const c of String(e.cve).split(/\s*\+\s*/)) acceptedBy[`${e.image}|${c.trim()}`] = e;
}
// Group by date so a CLIFF reads as one event rather than N unrelated rows
const expiringByDate = {};
for (const e of expiring) {
  const d = String(e.expires).slice(0, 10);
  (expiringByDate[d] ||= []).push(e);
}
for (const e of ledger.fixableViaRebuild) for (const c of String(e.cve).split(/\s*\+\s*/)) fixableBy[`${e.image}|${c.trim()}`] = e;

function residual(scanPath) {
  const out = { crit: [], high: [] };
  let d; try { d = JSON.parse(readFileSync(scanPath, 'utf8')); } catch { return null; }
  for (const r of d.Results || []) for (const v of r.Vulnerabilities || []) {
    if (v.Severity === 'CRITICAL') out.crit.push({ id: v.VulnerabilityID, pkg: v.PkgName });
    else if (v.Severity === 'HIGH') out.high.push({ id: v.VulnerabilityID, pkg: v.PkgName });
  }
  return out;
}

const lines = ['# Infra-image acceptance benchmark', '', `Deployed scan: \`${dirs[dirs.length - 1]}\` · judged at TARGET state · ledger: ${LEDGER}`, ''];
let critFail = 0, highUnacc = 0, gaps = 0, acceptedN = 0, fixableN = 0, unread = 0;
const perImage = [];

for (const [img, meta] of Object.entries(ledger.images || {})) {
  const scanRel = meta.targetScan ? join(deployedDir, meta.targetScan) : join(deployedDir, `${img}.json`);
  let src = 'current-deployed', res = null;
  if (meta.targetScan && existsSync(scanRel)) { src = `target ${meta.targetTag}`; res = residual(scanRel); }
  else if (meta.disposition === 'rebuilding' || meta.disposition === 'retiring') { src = `target pending (${meta.disposition}, expect ${meta.expectedResidual ?? 0})`; res = { crit: [], high: [], pending: true }; }
  else res = residual(join(deployedDir, `${img}.json`));
  // An image whose scan cannot be read was not judged; counting it nowhere let the verdict read PASS.
  if (!res) { unread++; perImage.push({ img, src, note: 'scan unreadable' }); continue; }

  const judge = (list) => list.map((f) => {
    if (acceptedBy[`${img}|${f.id}`]) { acceptedN++; return { ...f, cls: 'accepted' }; }
    if (fixableBy[`${img}|${f.id}`]) { fixableN++; return { ...f, cls: 'fixable' }; }
    return { ...f, cls: 'unaccounted' };
  });
  const crit = judge(res.crit), high = judge(res.high);
  const critU = crit.filter((f) => f.cls === 'unaccounted');
  const highU = high.filter((f) => f.cls === 'unaccounted');
  critFail += critU.length; highUnacc += highU.length;
  perImage.push({ img, src, meta, pending: res.pending, crit, high, critU, highU });
}

// Lapsed acceptances are surfaced, never swallowed
if (lapsed.length) {
  lines.push(`## expired risk acceptances (${lapsed.length}) — no longer suppressing`, '');
  for (const e of lapsed) lines.push(`- ⏰ ${e.image} ${e.cve} expired ${String(e.expires).slice(0, 10)} — re-accept with a new expiry or fix it`);
  lines.push('');
}

// The cliff, named as a cliff — dates carrying several expiries are called out explicitly
if (expiring.length) {
  const dates = Object.keys(expiringByDate).sort();
  lines.push(`## risk acceptances expiring within ${EXPIRY_WARN_DAYS} days (${expiring.length})`, '');
  for (const d of dates) {
    const group = expiringByDate[d];
    const days = group[0].daysLeft;
    lines.push(group.length > 1
      ? `- **${d}** (in ${days}d) — **${group.length} acceptances lapse together.** Re-accepting means re-doing reachability and containment for each; start before the week it lands.`
      : `- ${d} (in ${days}d) — 1 acceptance`);
    for (const e of group) lines.push(`    - ${e.image} ${e.cve}`);
  }
  lines.push('');
}

// containment completeness on every accepted entry
for (const e of ledger.accepted) {
  const g = [];
  if (!e.reachability) g.push('reachability');
  if (!(e.containment && e.containment.length)) g.push('containment');
  if (!e.recheckTrigger) g.push('recheckTrigger');
  if (g.length) { gaps++; lines.push(`- ✗ accepted ${e.image} ${e.cve} missing: ${g.join(', ')}`); }
}

for (const p of perImage) {
  if (p.note) { lines.push(`## ${p.img} — ${p.note}`, ''); continue; }
  const cU = p.critU?.length || 0, hU = p.highU?.length || 0;
  const flag = cU ? '✗ CRIT unaccounted' : p.pending ? '⏳ target pending' : hU ? '· highs pending full-accept pass' : '✓';
  lines.push(`## ${p.img} — ${flag}  <span>(${p.src})</span>`, '');
  if (p.crit?.length) lines.push(`**CRIT (${p.crit.length}):** ` + p.crit.map((f) => `${f.id}${f.cls === 'accepted' ? '✓' : f.cls === 'fixable' ? '⌁' : '✗'}`).join(' '));
  if (cU) lines.push('', '  UNACCEPTED CRIT: ' + p.critU.map((f) => `${f.id} (${f.pkg})`).join(', '));
  if (hU && !p.pending) lines.push('', `  highs not yet in ledger (${hU}): ` + [...new Set(p.highU.map((f) => f.pkg))].join(', '));
  lines.push('');
}

// pin benchmark
lines.push('## Pin benchmark (running digest vs ledger pin)', '');
for (const [img, meta] of Object.entries(ledger.images || {})) {
  let running = null;
  try { running = execFileSync('docker', ['image', 'inspect', meta.runningTag, '--format', '{{index .RepoDigests 0}}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 }).trim(); } catch {}
  const pin = String(meta.pin).split('@')[1], run = running ? running.split('@')[1] : null;
  const state = !pin ? `⚠ pin malformed — expected <repo>@<digest>, got ${meta.pin}` : !running ? '(not local)' : run === pin ? '✓ matches pin' : `⚠ DRIFT run ${run?.slice(0, 20)}… ≠ pin ${pin?.slice(0, 20)}…`;
  lines.push(`- **${img}** ${meta.runningTag} → ${meta.targetTag} · ${meta.disposition} — ${state}`);
}

lines.push('', '## Accepted findings — containment coverage', '', '| image | cve | sev | fixStatus | reachability | controls | re-check |', '|---|---|---|---|---|---|---|');
// a missing reachability is already counted as a gap above; the table names it rather than throwing
for (const e of ledger.accepted) lines.push(`| ${e.image} | ${e.cve} | ${e.severity} | ${e.fixStatus} | ${e.reachability ? String(e.reachability).split(':')[0] : '✗ missing'} | ${(e.containment || []).join(' ')} | ${e.recheckTrigger} |`);
lines.push('', '## Fixable-via-rebuild (tracked, NOT accepted)', '');
for (const e of ledger.fixableViaRebuild) lines.push(`- **${e.image} ${e.cve}** (${e.severity}) — ${e.fix}`);

const critVerdict = critFail || gaps ? `CRIT BENCHMARK FAIL (${critFail} unaccepted crit, ${gaps} containment gaps)`
  : unread ? `CRIT BENCHMARK UNMEASURED (${unread} image scan${unread === 1 ? '' : 's'} unreadable)` : 'CRIT BENCHMARK PASS';
lines.unshift(`> **${critVerdict}** · highs pending full-accept pass: ${highUnacc} · accepted=${acceptedN} · fixable-tracked=${fixableN}`, '');
writeFileSync(join(deployedDir, 'acceptance-benchmark.md'), lines.join('\n') + '\n');
console.log(`${critVerdict}`);
console.log(`  target-state: ${acceptedN} accepted (w/ containment) · ${fixableN} fixable-tracked · ${critFail} crit unaccounted · ${highUnacc} highs not-yet-accepted (soft) -> ${join(deployedDir, 'acceptance-benchmark.md')}`);
const hard = critFail + gaps + (STRICT_HIGH ? highUnacc : 0);
process.exit(STRICT && hard ? 1 : STRICT && unread ? 2 : 0);
