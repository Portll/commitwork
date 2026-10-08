// monitor/dep-findings.mjs — dependency-CVE rows from a repo's osv and npm-audit artifacts, and the
// KEV catalogue that ranks them. The rollup runs its pipeline at module scope, so a reader that needs
// these rows without performing a rollup (bin/lib/brief.mjs) imports them from here.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markCorroboration } from './corroborate.mjs';
import { classify as classifyReach, inheritUndetermined } from './advisory-reach.mjs';
import { fixFromOsvHelp } from './osv-fix.mjs';
import { fixFromRange } from './fix-range.mjs';
import { readSarif, ruleIndex } from './sarif-read.mjs';
import { kevStaleDays } from '../cra/lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const sevFromCvss = (c) => (c >= 9 ? 'crit' : c >= 7 ? 'high' : c >= 4 ? 'med' : c > 0 ? 'low' : 'unknown');
export const mapNpm = (s) => ({ critical: 'crit', high: 'high', moderate: 'med', low: 'low', info: 'low' }[s] || 'low');

// ---------- CVE extractors ----------
// bin/osv-declared.mjs's verdict, written beside osv.sarif at scan time. Absent => no demotion,
// which leaves the pre-2026-08-28 behaviour: a missing verdict must never be read as "everything
// was resolved", because that would demote a whole batch of real lockfile pins.
export function readDeclaredVerdict(dir) {
  const p = join(dir, 'osv-declared.json');
  if (!existsSync(p)) return null;
  let j; try { j = JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
  if (!j || j.ran !== true || !j.manifests) return null;
  const resolved = new Map();   // uri -> Set of 'pkg@version'
  for (const [uri, m] of Object.entries(j.manifests)) {
    if (!m || m.readable === false) continue;   // unreadable manifest: no verdict, not a demotion
    resolved.set(uri, new Set(Array.isArray(m.resolved) ? m.resolved : []));
  }
  return resolved;
}

export function parseOsv(dir) {
  // {rows, state} — sarif-read.mjs's typed state, threaded through depParseState so every non-ok
  // state surfaces as noscan once checks-status.json is in hand
  const r = readSarif(join(dir, 'osv.sarif'));
  if (r.state !== 'ok') return { rows: [], state: r.state };
  const run = r.runs[0]; if (!run) return { rows: [], state: 'ok' }; // runs:[] — a valid report with no run entries
  const rules = ruleIndex(run);
  const declaredVerdict = readDeclaredVerdict(dir);
  const out = [];
  for (const res of run.results) {
    const rule = rules[res.ruleId] || {};
    const cvss = parseFloat((rule.properties && rule.properties['security-severity']) || 0) || 0;
    const m = res.message && res.message.text || '';
    // GREEDY on the name, so a SCOPED package keeps its scope. `[^'@]+` required at least one
    // non-@ character before the separator, and '@ctrl/tinycolor@4.1.1' begins with the very
    // character the class excludes — so the match failed outright and the finding carried
    // package:'' and version:''. _malCounts below parsed the same message correctly, so the
    // Malicious-packages tab named the package while the headline and the ledger showed it blank:
    // two parsers, one artifact, two answers. See the migration bridge at keyOf for why changing
    // this could not simply be done in place.
    const pm = m.match(/Package '([^']+)@([^']+)'/);
    const title = ((rule.shortDescription && rule.shortDescription.text) || res.ruleId).replace(/^(CVE|GHSA|MAL)-\S+:\s*/, '');
    const id = res.ruleId;
    const loc = res.locations && res.locations[0] && res.locations[0].physicalLocation;
    const path = (loc && loc.artifactLocation && loc.artifactLocation.uri) || '';
    // A MAL- record (OpenSSF malicious-packages, via osv.dev) carries NO `security-severity` — it is
    // not a scored weakness, it is a package that should never have been installed. Left to
    // sevFromCvss that meant cvss 0 → `unknown`, which SEVRANK puts BELOW `low`: measured against a
    // real osv-scanner run on @ctrl/tinycolor@4.1.1 (MAL-2025-47141, the Shai-Hulud worm), the
    // headline read `CVEs 1 (0 crit / 0 high / 0 med / 0 low)`. Confirmed malware is crit, always.
    const malicious = /^MAL-/.test(id);
    // osv-scanner publishes the advisory's full alias group in rule.deprecatedIds — the CVE and the
    // GHSA for the same bug. Carried so the cross-lane dedupe below can tell that osv's
    // CVE-2026-53668 and npm-audit's GHSA-jjmj-jmhj-qwj2 are ONE finding. Read from the artifact,
    // never from the network: a rollup must produce the same answer offline and years later.
    const aliases = (rule.deprecatedIds || []).filter((x) => typeof x === 'string');
    const version = pm ? pm[2] : '';
    // ...and the mirror of that rule. A MAL- advisory whose range is `introduced: 0` matches every
    // version of a NAME, so a name collision publishes a critical about something the repo never
    // installed: firebase pins closure-net from git (version '6f48f578'), logseq carries
    // fs@0.0.1-security which IS npm's takedown placeholder. Both were published as crit; both
    // were false. Demoted rows keep every field and their `malicious` claim, and move to the
    // `unknown` severity already carried by 980 unscored rows fleet-wide — out of crit/high/med/
    // low, into `undetermined`. Never dropped: see advisory-reach.mjs for what this does NOT say.
    const reach = malicious ? classifyReach({ id, version, path }) : { reachable: true };
    // RESOLVED, NOT DECLARED. osv-scanner does transitive resolution for a requirements.txt that
    // carries only `>=` floors and reports the MINIMUM satisfying tree. Measured 2026-08-28 on
    // memory-layer: benchmarks/requirements.txt names neither pillow nor aiohttp, and osv reported
    // pillow@9.5.0 / aiohttp@3.9.5 as 54 of 135 findings including BOTH criticals and the only
    // CISA-KEV row. Across the three area rollups on disk, 3 of 3 osv criticals and 1 of 1 KEV came
    // from an unpinned Python manifest — while internal-d, whose 98 osv findings come from no
    // requirements file at all, has zero criticals.
    //
    // That is a real statement about the lowest tree the declared floors permit. It is NOT a
    // statement about what this repository installs, and publishing it in the same bucket as a
    // Cargo.lock pin makes the two indistinguishable. Same routing as the MAL- demotion above:
    // classify, never drop — the row keeps id, package, version, path and its original claim, and
    // moves out of crit/high/med/low into `unknown`/`undetermined`.
    const pkgKey = `${pm ? pm[1] : ''}@${version}`;
    const resolvedSet = declaredVerdict && declaredVerdict.get(path);
    const notDeclared = !!resolvedSet && resolvedSet.has(pkgKey);
    const claimed = !reach.reachable ? 'unknown' : (malicious ? 'crit' : sevFromCvss(cvss));
    // Preserve the remediation target that osv-scanner renders in rule.help.text.
    const fixed = fixFromOsvHelp((rule.help && rule.help.text) || '', { id, aliases, pkg: pm ? pm[1] : '' });
    out.push({ tool: 'osv', id, cvss, severity: notDeclared ? 'unknown' : claimed, malicious,
      ...(notDeclared ? { undetermined: true, unknown: true, resolutionBasis: 'resolved',
        undeterminedCode: 'version-not-declared', claimedSeverity: claimed,
        undeterminedReason: `the manifest ${path.replace(/^file:\/\/\/?/, '')} does not state ${pkgKey}; osv-scanner resolved it from an unpinned requirement, so this describes the lowest tree the declared floors permit rather than what this repository installs` } : {}),
      package: pm ? pm[1] : '', version, path, aliases,
      ...(reach.reachable ? {} : { undetermined: true, unknown: true, unknownReason: reach.unknownReason, undeterminedCode: reach.code, undeterminedReason: reach.reason, claimedSeverity: 'crit' }),
      fixed, title, advisory: id.startsWith('GHSA') ? `https://github.com/advisories/${id}` : `https://osv.dev/vulnerability/${id}` });
  }
  return { rows: out, state: 'ok' };
}
const fixTarget = (v, range) => (v.fixAvailable && typeof v.fixAvailable === 'object')
  ? `${v.fixAvailable.name}@${v.fixAvailable.version}`
  : (v.fixAvailable ? (fixFromRange(range) || 'available') : '');

export function parseNpm(dir) {
  // same {rows, state} contract as parseOsv above — see its header comment.
  const p = join(dir, 'npm-audit.json'); if (!existsSync(p)) return { rows: [], state: 'absent' };
  let d; try { d = JSON.parse(readFileSync(p, 'utf8')); } catch { return { rows: [], state: 'unparseable' }; }
  const out = [];
  for (const [name, v] of Object.entries(d.vulnerabilities || {})) {
    const advs = (v.via || []).filter((x) => typeof x === 'object');
    if (!advs.length) { out.push({ tool: 'npm', id: name, cvss: 0, severity: mapNpm(v.severity), package: name, version: '', path: 'package-lock.json', range: v.range || '', fixed: fixTarget(v, v.range), title: `${name} (${v.severity})`, advisory: '' }); continue; }
    for (const a of advs) {
      const id = (a.url || '').split('/').pop() || String(a.source || name);
      out.push({ tool: 'npm', id, cvss: (a.cvss && a.cvss.score) || 0, severity: mapNpm(a.severity || v.severity),
        package: a.name || name, version: '', path: 'package-lock.json', range: a.range || v.range || '', fixed: fixTarget(v, a.range || v.range), title: a.title || name, advisory: a.url || '' });
    }
  }
  return { rows: out, state: 'ok' };
}
export const dedupe = (fs) => { const seen = new Set(); return fs.filter((f) => { const k = `${f.tool}|${f.id}|${f.package}|${f.version}|${f.path || ''}`; if (seen.has(k)) return false; seen.add(k); return true; }); };

// One repo's dependency CVEs, as the rollup builds them: osv first, npm rows that are the same advisory
// inherit an osv demotion, exact duplicates dropped, cross-lane agreement marked.
export function repoDepFindings(dir) {
  const osv = parseOsv(dir), npm = parseNpm(dir);
  return { findings: markCorroboration(dedupe([...osv.rows, ...inheritUndetermined(osv.rows, npm.rows)])), state: { osv: osv.state, npm: npm.state } };
}

export const kevCatalogPath = () => process.env.CW_KEV_PATH || join(HERE, 'data', 'kev.json');
export const epssScoresPath = () => process.env.CW_EPSS_PATH || join(HERE, 'data', 'epss.json');

// Freshness is judged from the catalogue's own dateReleased, never the file's mtime: a clone resets
// mtime to now. An unusable threshold is unknown freshness with its reason, never a verdict.
export function loadKevCatalog(path = kevCatalogPath(), { now = Date.now() } = {}) {
  let doc = null;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch { /* unread: usable=false, so kev is recorded as null */ }
  const set = new Set(((doc && doc.vulnerabilities) || []).map((v) => v.cveID));
  let thresholdError = null;
  const staleDays = (() => { try { return kevStaleDays(); } catch (e) { thresholdError = e.message; return null; } })();
  const dateReleased = doc && doc.dateReleased;
  const t = dateReleased ? Date.parse(dateReleased) : NaN;
  const catalogVersion = (doc && doc.catalogVersion) || null;
  let freshness;
  if (thresholdError) freshness = { state: 'unknown', ageDays: null, maxDays: null, catalogVersion, dateReleased: dateReleased || null, reason: thresholdError };
  else if (!Number.isFinite(t)) freshness = { state: 'unknown', ageDays: null, maxDays: staleDays, catalogVersion, dateReleased: dateReleased || null };
  else {
    const ageDays = Math.round((now - t) / 86_400_000);
    freshness = { state: ageDays > staleDays ? 'stale' : 'fresh', ageDays, maxDays: staleDays, catalogVersion, dateReleased };
  }
  return { set, usable: set.size > 0, staleDays, freshness };
}

export function loadEpssScores(path = epssScoresPath()) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

// KEV is tri-state: null when the catalogue was not consulted, which is a different fact from false.
export function enrichKevEpss(findings, kev, epss) {
  for (const f of findings) { f.kev = kev.usable ? kev.set.has(f.id) : null; f.epss = (f.id in epss) ? epss[f.id] : null; }
  return findings;
}
