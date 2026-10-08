// monitor/app-vuln.mjs — tiers 2+3 of the installed-app sweep: match what tier 1 inventoried
// against vulnerability data, then let severity publish ONLY under the F-gate's convergence
// discipline (monitor/converge.mjs). This is the lane where consumer scanners print "347 issues
// found"; the entire point here is to not.
//
// TIER 2 (the matching): syft SBOMs each app bundle and each globally installed npm package (it
// finds embedded Electron/Chromium, Go buildinfo, installed node_modules, Python dist-info). The
// installed-package cataloger is selected explicitly: syft's dir: default reads npm LOCKFILES only,
// and an installed tree has none — measured 0 npm artifacts for openclaw and VS Code without it,
// 382 and 115 with it. The selection is part of the SBOM cache key, so an SBOM built blind is never
// served again. grype matches the SBOM offline —
// GRYPE_DB_AUTO_UPDATE is forced off: a vulnerability-DB download is an operator egress decision,
// and an absent/stale DB makes the whole lane unknown('no-reference'), never a quiet empty scan.
// SBOMs cache under reports/ keyed on (bundle, version). Exit-code discipline throughout: a
// non-zero tool exit is unknown('tool-failed') even if stdout parsed — an error's partial output
// is not a result.
//
// TIER 3 (the discipline): grype's own matchDetails carry the epistemics, and the F-gate prices
// them: 'exact-direct' (the app's OWN manifest declared this name+version; the range comparison is
// mechanical) is a tier-1 oracle with declared-not-inferred integrity — publishes alone.
// 'exact-indirect' is a lone tier-2 anomaly; CPE matching is lone tier-3 inference — both cap at
// UNDETERMINED with the original claim preserved, because CPE name-similarity is the documented
// false-positive flood and a lane whose findings are ~all one detector's is a defect signature,
// not a fleet in crisis. KEV membership and EPSS ride every row as PRIORITY enrichment — they say
// exploitation is real somewhere, never that THIS match is right, so they are not witnesses.
// A second independent matcher (osv, cross-provenance) converges a CPE row to severity when its
// ids are supplied — assembly is wired, invocation stays off by default because osv-scanner phones
// osv.dev (egress consent is CW_APPVULN_OSV=1, explicitly).
//
// KEV/EPSS read fail-closed into null — kev:false means CHECKED and absent; an unreadable list is
// kev:null (unchecked), never false. componentCount 0 is unknown('no-subject'): a native app with
// no package manifests has nothing this lane can examine, which is not the same claim as clean.
//
// Env (read at call time): CW_APPVULN_CACHE (default reports/app-sbom), CW_APPVULN_KEV,
// CW_APPVULN_EPSS, CW_APPVULN_OSV=1 (egress consent), CW_NOW.
//
//   node monitor/app-vuln.mjs [--json] [--limit N] [--app <name-substring>] [--no-cache] [--no-npm-global]
//   exit 0 nothing published, 1 published findings, 2 lane unknown / nothing examinable

import { nowISO } from '../lib/clock.mjs';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unknown } from './unknown.mjs';
import { writeAtomic } from './lockfile.mjs';
import { converge } from './converge.mjs';
import { collectApps } from './app-inventory.mjs';
import { collectListeners } from './port-bind.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDirFor = () => process.env.CW_APPVULN_CACHE || join(REPO, 'reports', 'app-sbom');
const kevPath = () => process.env.CW_APPVULN_KEV || join(REPO, 'monitor', 'data', 'kev.json');
const epssPath = () => process.env.CW_APPVULN_EPSS || join(REPO, 'monitor', 'data', 'epss.json');

const defaultRun = (cmd, args, extraEnv = {}) => {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8', timeout: 300_000, maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GRYPE_DB_AUTO_UPDATE: 'false', GRYPE_CHECK_FOR_APP_UPDATE: 'false', ...extraEnv },
  });
  return { status: r.error ? null : r.status, stdout: r.stdout || '', stderr: r.stderr || '', errCode: r.error?.code || null };
};

// ── enrichment: KEV + EPSS, fail-closed into null (unchecked ≠ absent) ──────────────────────────
export function loadKevSet() {
  try {
    const doc = JSON.parse(readFileSync(kevPath(), 'utf8'));
    if (!Array.isArray(doc.vulnerabilities)) return null;
    return new Set(doc.vulnerabilities.map((v) => v.cveID).filter(Boolean));
  } catch { return null; }
}
export function loadEpss() {
  try {
    const doc = JSON.parse(readFileSync(epssPath(), 'utf8'));
    return doc && typeof doc === 'object' ? doc : null;
  } catch { return null; }
}

// ── the DB gate ─────────────────────────────────────────────────────────────────────────────────
/** The lane may not run against nothing: an absent/stale grype DB is unknown for the WHOLE lane. */
export function checkGrypeDb({ run = defaultRun } = {}) {
  const r = run('grype', ['db', 'status']);
  if (r.errCode === 'ENOENT') return unknown('tool-failed', 'grype is not installed');
  if (r.status !== 0 || !/Status:\s*valid/i.test(r.stdout)) {
    return unknown('no-reference', 'grype DB absent or invalid — downloading it is an operator egress decision, run `grype db update` yourself');
  }
  return { ok: true };
}

// ── tier 2: SBOM + match ────────────────────────────────────────────────────────────────────────
export const SYFT_CATALOGERS = '+javascript-package-cataloger';

export function sbomForBundle(bundle, version, { run = defaultRun, cacheDir = cacheDirFor(), noCache = false } = {}) {
  const key = createHash('sha256').update(`${bundle}|${version ?? ''}|${SYFT_CATALOGERS}`).digest('hex').slice(0, 16);
  const path = join(cacheDir, `${key}.syft.json`);
  if (!noCache && existsSync(path)) return { path, cached: true };
  const r = run('syft', [`dir:${bundle}`, '--select-catalogers', SYFT_CATALOGERS, '-o', 'syft-json', '-q']);
  if (r.errCode === 'ENOENT') return unknown('tool-failed', 'syft is not installed');
  if (r.status !== 0) return unknown('tool-failed', `syft exit ${r.status ?? r.errCode}`);
  let doc;
  try { doc = JSON.parse(r.stdout); } catch { return unknown('unparseable', 'syft output is not JSON'); }
  if (!Array.isArray(doc.artifacts)) return unknown('unparseable', 'syft-json without artifacts[] — the format decides the field, and this is not it');
  mkdirSync(cacheDir, { recursive: true });
  writeAtomic(path, r.stdout);
  return { path, cached: false, componentCount: doc.artifacts.length };
}

export function grypeMatches(sbomPath, { run = defaultRun } = {}) {
  const r = run('grype', [`sbom:${sbomPath}`, '-o', 'json', '-q']);
  if (r.errCode === 'ENOENT') return unknown('tool-failed', 'grype is not installed');
  if (r.status !== 0) return unknown('tool-failed', `grype exit ${r.status ?? r.errCode}`);
  let doc;
  try { doc = JSON.parse(r.stdout); } catch { return unknown('unparseable', 'grype output is not JSON'); }
  const matches = (doc.matches || []).map((m) => ({
    id: m?.vulnerability?.id ?? null,
    severity: m?.vulnerability?.severity ?? null,
    component: m?.artifact?.name ?? null,
    componentVersion: m?.artifact?.version ?? null,
    componentType: m?.artifact?.type ?? null,
    matchTypes: (m?.matchDetails || []).map((d) => d?.type).filter(Boolean),
  })).filter((m) => m.id && m.component);
  return { matches };
}

// ── tier 3: the F-gate applied per match ────────────────────────────────────────────────────────
/** grype's matchDetails → converge() candidates, priced by epistemics. */
export function candidatesForMatch(m, { osvIds = null } = {}) {
  const out = [];
  const types = m.matchTypes.length ? m.matchTypes : ['unknown'];
  if (types.includes('exact-direct-match')) {
    // The app's own manifest declared this name+version; the comparison is mechanical.
    out.push({ tier: 1, lens: 'grype-ecosystem-exact', provenance: 'grype', oracleIntegrity: !!m.componentVersion });
  } else if (types.some((t) => /exact/.test(t))) {
    out.push({ tier: 2, lens: 'grype-ecosystem-indirect', provenance: 'grype' });
  } else {
    out.push({ tier: 3, lens: 'grype-cpe', provenance: 'grype' });
  }
  if (osvIds && osvIds.has(m.id)) out.push({ tier: 1, lens: 'osv-ecosystem', provenance: 'osv', oracleIntegrity: true });
  return out;
}

export function classifyMatch(m, { kevSet = null, epss = null, osvIds = null } = {}) {
  const subject = `${m.component}@${m.componentVersion ?? '?'}|${m.id}`;
  const verdict = converge({ subject, candidates: candidatesForMatch(m, { osvIds }) });
  const kev = kevSet === null ? null : kevSet.has(m.id);
  const epssScore = epss === null ? null : (epss[m.id] ?? null);
  const base = { subject, id: m.id, component: m.component, componentVersion: m.componentVersion, matchTypes: m.matchTypes, kev, epss: epssScore, why: verdict.why };
  return verdict.publish === 'severity'
    ? { ...base, publish: 'severity', severity: m.severity }
    : { ...base, publish: 'undetermined', originalClaim: { severity: m.severity } };
}

/** The cross-app sanity: one CVE dominating published rows across apps is a defect signature. */
export function defectSignature(perApp) {
  const counts = new Map();
  let total = 0;
  const appsOf = new Map();
  for (const app of perApp) {
    for (const row of app.published || []) {
      total++;
      counts.set(row.id, (counts.get(row.id) || 0) + 1);
      if (!appsOf.has(row.id)) appsOf.set(row.id, new Set());
      appsOf.get(row.id).add(app.name);
    }
  }
  if (total < 6) return null;
  for (const [id, n] of counts) {
    if (n / total >= 0.5 && appsOf.get(id).size >= 3) {
      return { id, share: n / total, apps: appsOf.get(id).size, note: 'one CVE accounts for most published rows across apps — a defect signature of the matcher or data, not a fleet in crisis; treat as undetermined until examined' };
    }
  }
  return null;
}

// ── per-app assessment ──────────────────────────────────────────────────────────────────────────
export function assessApp(app, { run = defaultRun, kevSet, epss, osvIds, cacheDir, noCache } = {}) {
  const sbom = sbomForBundle(app.id, app.version, { run, cacheDir, noCache });
  if (sbom.unknown) return { name: app.name, bundle: app.id, version: app.version, ...sbom };
  const componentCount = sbom.componentCount ?? (() => {
    try { return JSON.parse(readFileSync(sbom.path, 'utf8')).artifacts.length; } catch { return null; }
  })();
  if (componentCount === 0) {
    return { name: app.name, bundle: app.id, version: app.version, componentCount, ...unknown('no-subject', 'no package manifests in the bundle — nothing this lane can examine, which is not the same claim as clean') };
  }
  const g = grypeMatches(sbom.path, { run });
  if (g.unknown) return { name: app.name, bundle: app.id, version: app.version, componentCount, ...g };
  const rows = g.matches.map((m) => classifyMatch(m, { kevSet, epss, osvIds }));
  const published = rows.filter((r) => r.publish === 'severity');
  const undetermined = rows.filter((r) => r.publish === 'undetermined');
  const sevCount = {};
  for (const r of published) sevCount[r.severity ?? 'Unknown'] = (sevCount[r.severity ?? 'Unknown'] || 0) + 1;
  return {
    name: app.name, bundle: app.id, version: app.version, componentCount,
    published, undetermined, severities: sevCount,
    kevHits: rows.filter((r) => r.kev === true).map((r) => r.id),
    sbomCached: sbom.cached === true,
  };
}

// ── global npm packages ─────────────────────────────────────────────────────────────────────────
// Tier 1 inventories these at depth 0 for identity; the advisories live in the transitive tree,
// so the subject here is the package DIRECTORY. npm absent is an absent source; npm failing is
// unknown, carried as a row so it counts.
export function collectNpmGlobalPackages({ run = defaultRun } = {}) {
  const root = run('npm', ['root', '-g']);
  if (root.errCode === 'ENOENT') return { items: [], unknowns: [], absent: true };
  const rootDir = root.stdout.trim();
  if (root.status !== 0 || !rootDir) {
    return { items: [], unknowns: [{ name: 'npm-global', kind: 'npm-global', ...unknown('tool-failed', `npm root -g exit ${root.status ?? root.errCode}`) }] };
  }
  const ls = run('npm', ['ls', '-g', '--depth=0', '--json']);
  let doc = null;
  try { doc = JSON.parse(ls.stdout); } catch { doc = null; }   // npm exits non-zero on peer warnings with valid JSON
  if (!doc || typeof doc !== 'object') {
    return { items: [], unknowns: [{ name: 'npm-global', kind: 'npm-global', ...unknown('unparseable', `npm ls -g exit ${ls.status ?? ls.errCode}`) }] };
  }
  const items = Object.entries(doc.dependencies || {})
    .map(([name, d]) => ({ id: join(rootDir, name), kind: 'npm-global', name, version: d?.version ?? null }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return { items, unknowns: [] };
}

export function runLens({ run = defaultRun, roots, limit = Infinity, appFilter = null, noCache = false, npmGlobal = true } = {}) {
  const db = checkGrypeDb({ run });
  if (db.unknown) return { at: nowISO(), ...db, state: 'unknown' };
  const kevSet = loadKevSet();
  const epss = loadEpss();
  const globals = npmGlobal ? collectNpmGlobalPackages({ run }) : { items: [], unknowns: [] };
  const subjects = [
    ...collectApps({ roots: roots || ['/Applications', '/Applications/Utilities', join(process.env.HOME || '', 'Applications')], run }).items,
    ...globals.items,
  ].filter((a) => (appFilter ? (a.name || '').toLowerCase().includes(appFilter.toLowerCase()) : true))
    .slice(0, limit);
  // Reachability join — the priority lens, never a filter: a published match is true whether or
  // not the app listens, but installed ∧ vulnerable ∧ REACHABLE is what deserves attention first.
  // Best-effort: an unenumerable socket table leaves reach null (unknown), not false.
  let listeners = null;
  try { listeners = collectListeners({}).listeners; } catch { listeners = null; }
  // `${id}/` so /…/node_modules/foo never matches a process running /…/node_modules/foobar.
  const perApp = [
    ...subjects.map((a) => {
      const row = assessApp(a, { run, kevSet, epss, noCache });
      const listening = listeners === null ? null : listeners.some((l) => (l.args || '').includes(`${a.id}/`));
      return { kind: a.kind, ...row, reach: { listening } };
    }),
    ...(appFilter ? [] : globals.unknowns.map((u) => ({ ...u, reach: { listening: null } }))),
  ];
  const publishedTotal = perApp.reduce((n, a) => n + (a.published?.length || 0), 0);
  const undeterminedTotal = perApp.reduce((n, a) => n + (a.undetermined?.length || 0), 0);
  const unknowns = perApp.filter((a) => a.unknown);
  const signature = defectSignature(perApp);
  // The attention-first list: KEV-listed published rows, and every published row of a listening app.
  const priority = perApp.flatMap((a) => (a.published || [])
    .filter((p) => p.kev === true || a.reach.listening === true)
    .map((p) => ({ app: a.name, listening: a.reach.listening, ...p })));
  const state = signature ? 'defect-signature'
    : publishedTotal ? 'findings'
    : perApp.length === unknowns.length ? 'unknown'
    : 'ok';
  return {
    at: nowISO(), apps: perApp.filter((a) => a.kind === 'app').length,
    npmGlobal: npmGlobal ? (globals.absent ? 'absent' : perApp.filter((a) => a.kind === 'npm-global' && a.bundle).length) : 'skipped',
    subjects: perApp.length, kevChecked: kevSet !== null, epssChecked: epss !== null,
    publishedTotal, undeterminedTotal, unknowns: unknowns.length, defectSignature: signature,
    priority, perApp, state,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log('node monitor/app-vuln.mjs [--json] [--limit N] [--app <substring>] [--no-cache] [--no-npm-global]\n'
      + 'syft→grype over installed app bundles and global npm packages; severity publishes only under the F-gate (exact ecosystem\n'
      + 'matches publish alone; CPE matches stay undetermined with the claim preserved); KEV/EPSS enrich.\n'
      + 'exit 0 nothing published, 1 published findings, 2 lane unknown');
    process.exit(0);
  }
  const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  const r = runLens({
    limit: flag('--limit') ? Number(flag('--limit')) : Infinity,
    appFilter: flag('--app'),
    noCache: argv.includes('--no-cache'),
    npmGlobal: !argv.includes('--no-npm-global'),
  });
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else if (r.unknown) console.log(`app-vuln: UNKNOWN (${r.unknownReason}) — ${r.unknownDetail}`);
  else {
    console.log(`app-vuln: ${r.state}  (${r.apps} app(s), npm-global ${r.npmGlobal}, published ${r.publishedTotal}, undetermined ${r.undeterminedTotal}, unknowns ${r.unknowns}, kev ${r.kevChecked ? 'checked' : 'UNCHECKED'}, ${r.at})`);
    if (r.defectSignature) console.log(`  DEFECT-SIGNATURE ${r.defectSignature.id} — ${r.defectSignature.note}`);
    for (const p of r.priority.slice(0, 8)) console.log(`  PRIORITY ${p.severity ?? '?'}  ${p.id}  ${p.component}@${p.componentVersion}  (${p.app}${p.kev ? ', KEV' : ''}${p.listening ? ', listening' : ''})`);
    if (r.priority.length > 8) console.log(`  … ${r.priority.length - 8} more priority rows (--json for all)`);
    for (const a of r.perApp) {
      if (a.unknown) { console.log(`  UNKNOWN(${a.unknownReason})  ${a.name ?? a.bundle}`); continue; }
      const sev = Object.entries(a.severities).map(([k, v]) => `${v} ${k}`).join(', ');
      console.log(`  ${a.name} ${a.version ?? ''}  — ${a.componentCount} component(s), published ${a.published.length}${sev ? ` (${sev})` : ''}, undetermined ${a.undetermined.length}${a.kevHits.length ? `, KEV: ${a.kevHits.join(' ')}` : ''}${a.sbomCached ? '  [sbom cached]' : ''}`);
      for (const p of a.published.slice(0, 5)) console.log(`      ${p.severity ?? '?'}  ${p.id}  ${p.component}@${p.componentVersion}${p.kev ? '  [KEV]' : ''}${p.epss != null ? `  epss ${p.epss}` : ''}`);
      if (a.published.length > 5) console.log(`      … ${a.published.length - 5} more published (not silently dropped — use --json for all)`);
    }
  }
  process.exit(r.unknown ? 2 : r.publishedTotal ? 1 : r.state === 'ok' ? 0 : 2);
}
