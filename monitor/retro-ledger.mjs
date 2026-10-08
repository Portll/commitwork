#!/usr/bin/env node
// commitwork monitor — RETRO remediation ledger: one-off back-fill of per-finding evidence for
// the v0-era cleanup, from material on disk. Tiers:
//   strong — package version provably changed (clones lockfile vs monorepo HEAD)
//   medium — finding gone + surface re-scanned clean at v1 + cited remediation-wave commit
//   weak   — merely absent; ledgered as unconfirmed, NEVER counted as cleaned
// Entries carry retro:true and upsert on (key, resolvedSlice); forward entries preserved untouched.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { scannedGitOut } from '../bin/lib/git-env.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadRegistry } from './registry.mjs';
import { outDirFor } from './area.mjs'; // THE OUT resolver — never re-derive the chain here

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
// Degrade LOUDLY on a broken registry (one-off forensic tool): the failure is named on stderr AND
// stamped into the ledger. The OUT does NOT degrade — a ledger may never land in a guessed area,
// so no resolvable area ⇒ exit with the reason (CW_MONITOR_OUT still wins inside outDirFor).
let REG = { reportsRoot: 'reports' };
let registryUnavailable = null;
try { REG = loadRegistry(); }
catch (e) {
  registryUnavailable = e.message;
  console.error(`retro-ledger: registry unavailable, degrading to defaults (${e.message})`);
}
const OUT = (() => {
  try { return outDirFor(null, REG); }
  catch (e) { console.error(`retro-ledger: ${e.message}`); process.exit(2); }
})();
const corrSlices = join(OUT, 'history', 'corrected', 'slices');
const LEDGER = join(OUT, 'remediation-ledger.json');
// Refuse when CW_RETRO_CLONES / CW_RETRO_SRC are absent — never guess another machine's paths
const CLONES = process.env.CW_RETRO_CLONES || '';
const SX = process.env.CW_RETRO_SRC || '';
const SERVICES = SX ? join(SX, 'services') : '';
const SIDE_AVAILABLE = !!(CLONES && existsSync(CLONES)) || !!(SX && existsSync(SX));
if (!SIDE_AVAILABLE) {
  console.error('retro-ledger: no side-source (CW_RETRO_CLONES / CW_RETRO_SRC unset or absent). Lockfile evidence is UNAVAILABLE, so tiers cannot be derived. Refusing rather than writing a ledger whose evidence silently degraded.');
  process.exit(4);
}

const BASELINE_STAMPS = ['20260702064632', '20260702085153', '20260702090048', '20260703050509', '20260705114115'];
const WAVE_CITES = 'remediation window 2026-06-30→07-07: clientA 7e839976 (consolidation), 4b9e33f9 (gradle locking ×24), 66ec15f0 (npm criticals + spurious-lockfile drop), 91962c20 (JVM HIGH wave); DECISIONS.md 2026-07-06/07 entries';

const load = (st) => { try { return JSON.parse(readFileSync(join(corrSlices, `${st}.json`), 'utf8')); } catch { return null; } };

// baseline = union of canonical findings across the v0 era (first-seen stamp kept)
const baseline = new Map();
for (const st of BASELINE_STAMPS) {
  const s = load(st); if (!s) continue;
  for (const f of s.findings) {
    const k = `${f.repo}|${f.package}|${f.root}`;
    if (!baseline.has(k)) baseline.set(k, { ...f, bornSlice: s.sliceId });
  }
}
// current open set = newest corrected slice
const stamps = readdirSync(corrSlices).map((f) => f.replace('.json', '')).sort();
const newest = load(stamps[stamps.length - 1]);
// guard: an empty/aborted newest slice must not make everything look resolved
const newestUsable = newest && newest.findings ? newest : null;
let cursor = stamps.length - 1;
let current = newestUsable;
while (current && current.findings.length === 0 && cursor > 0) current = load(stamps[--cursor]);
const openNow = new Set((current?.findings || []).filter((f) => !f.accepted).map((f) => `${f.repo}|${f.package}|${f.root}`));
const stillThere = new Set((current?.findings || []).map((f) => `${f.repo}|${f.package}|${f.root}`));
const resolvedSlice = current?.sliceId || 'unknown';

// lockfile version lookup — package-lock.json AND yarn.lock, both sides, cached per repo side
const npmVer = (lock, pkg) => !lock ? null
  : (lock.packages?.[`node_modules/${pkg}`]?.version) || (lock.dependencies?.[pkg]?.version) || null;
function parseYarn(txt) {
  if (!txt) return null;
  const map = {};
  const lines = txt.split('\n');
  let names = null;
  for (const line of lines) {
    if (/^[^#\s].*:\s*$/.test(line)) {
      names = line.replace(/:\s*$/, '').split(',').map((s) => {
        s = s.trim().replace(/^"|"$/g, '');
        const at = s.lastIndexOf('@'); // scoped names keep their leading @
        return at > 0 ? s.slice(0, at) : s;
      });
    } else if (names) {
      const m = line.match(/^\s+version\s+"([^"]+)"/);
      if (m) { for (const n of names) { const set = map[n] || (map[n] = new Set()); set.add(m[1]); } names = null; }
    }
  }
  return map;
}
const sideCache = {};
function side(repo, where) { // where: 'clones' | 'head'
  const ck = `${where}|${repo}`;
  if (ck in sideCache) return sideCache[ck];
  const out = { npm: null, yarn: null, any: false };
  if (where === 'clones') {
    try { out.npm = JSON.parse(readFileSync(join(CLONES, repo, 'package-lock.json'), 'utf8')); } catch {}
    try { out.yarn = parseYarn(readFileSync(join(CLONES, repo, 'yarn.lock'), 'utf8')); } catch {}
  } else {
    const show = (p) => { try { return scannedGitOut(SX, ['show', `HEAD:services/${repo}/${p}`], { maxBuffer: 64 * 1024 * 1024 }); } catch { return null; } }; // SX is a client's repo
    try { const t = show('package-lock.json'); out.npm = t ? JSON.parse(t) : null; } catch {}
    out.yarn = parseYarn(show('yarn.lock'));
  }
  out.any = !!(out.npm || out.yarn);
  return (sideCache[ck] = out);
}
const verOf = (s, pkg) => {
  if (!s || !pkg) return null;
  const n = npmVer(s.npm, pkg); if (n) return n;
  const y = s.yarn && s.yarn[pkg]; return y ? [...y].sort().join(',') : null;
};
const gradleRepo = (r) => existsSync(join(SERVICES, r, 'build.gradle')) || existsSync(join(SERVICES, r, 'build.gradle.kts'));

const entries = [];
let sC = 0, mC = 0, wC = 0, skip = 0;
for (const [k, f] of baseline) {
  if (stillThere.has(k)) { skip++; continue; } // still present (open or accepted) — not resolved
  let tier = 'weak', detail = 'absent at v1 re-scan; no per-package diff available', from = '', to = '';
  const base = side(f.repo, 'clones');
  const head = side(f.repo, 'head');
  const bv = f.package ? verOf(base, f.package) : null;
  const hv = f.package ? verOf(head, f.package) : null;
  if (bv && hv && bv !== hv) { tier = 'strong'; from = bv; to = hv; detail = `lockfile diff: clones@${bv} → monorepo HEAD@${hv} (services/${f.repo})`; }
  else if (bv && hv && bv === hv) { tier = 'weak'; from = bv; detail = `version unchanged (${bv}) yet finding absent at v1 — advisory withdrawn/rescored or tool-diff; NOT counted as cleaned`; }
  else if (bv && head.any && !hv) { tier = 'strong'; from = bv; detail = `package removed: clones@${bv} → absent from monorepo HEAD lockfiles (yarn resolutions / dependency dropped, 66ec15f0)`; }
  else if (bv && !head.any) { tier = 'medium'; from = bv; detail = `original lockfile carried ${f.package}@${bv}; monorepo dropped/replaced lockfiles and the v1 sweep re-scanned clean. ${WAVE_CITES}`; }
  else if (gradleRepo(f.repo)) { tier = 'medium'; detail = `JVM-side finding; gradle locking added 4b9e33f9, constraint waves committed, trivy re-scan 2026-07-07 clean (reports/jvm-rescan-20260707). ${WAVE_CITES}`; }
  else { detail = `absent at v1; no lockfile evidence on either side for ${f.package || '(no package)'}` ; }
  if (tier === 'strong') sC++; else if (tier === 'medium') mC++; else wC++;
  entries.push({
    key: `${f.repo}|retro|${f.root}|${f.package}|`, vulnId: f.root, package: f.package, repo: f.repo,
    severity: f.severity, fromVersion: from, toVersion: to, fixCommit: null,
    evidence: { tier, detail }, bornSlice: f.bornSlice, resolvedSlice, retro: true,
    aliasIds: f.ids, at: new Date().toISOString(),
  });
}

// merge-preserve: re-read the live ledger at the last moment (a forward rollup may have created it)
let ledger = { note: 'verified remediation ledger — append-only, upsert on (key, resolvedSlice); weak tier is unconfirmed, not cleaned. retro:true entries were back-filled from on-disk evidence (clones lockfiles vs monorepo HEAD, cited wave commits).', entries: [] };
try { const j = JSON.parse(readFileSync(LEDGER, 'utf8')); if (j && Array.isArray(j.entries)) { ledger.entries = j.entries; if (j.note) ledger.note = `${j.note} | retro pass 2026-07-09: see retro:true entries.`; } } catch {}
const byNk = new Map(ledger.entries.map((e) => [`${e.key}|${e.resolvedSlice}`, e]));
let added = 0, updated = 0;
for (const e of entries) {
  const nk = `${e.key}|${e.resolvedSlice}`;
  // FALSE POSITIVE (insecure-object-assign): `e` is an in-file literal with fixed keys — feed data
  // supplies only VALUES, never computed key names, so no __proto__/constructor path exists.
  // nosemgrep: javascript.lang.security.insecure-object-assign.insecure-object-assign -- source is an in-file literal, fixed keys; see block above
  if (byNk.has(nk)) { Object.assign(byNk.get(nk), e); updated++; } else { ledger.entries.push(e); byNk.set(nk, e); added++; }
}
// The ledger CARRIES the registry failure (not just stderr); cleared once a later run succeeds
if (registryUnavailable) ledger.registryUnavailable = registryUnavailable; else delete ledger.registryUnavailable;
writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
console.log(`retro-ledger: baseline=${baseline.size} canonical v0-era findings · resolved=${entries.length} (strong=${sC} medium=${mC} unconfirmed=${wC}) · still-present=${skip}`);
console.log(`retro-ledger: ${added} added, ${updated} updated -> ${LEDGER} (resolvedSlice=${resolvedSlice}; pre-existing forward entries preserved: ${ledger.entries.length - added - updated})`);
