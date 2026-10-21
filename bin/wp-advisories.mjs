#!/usr/bin/env node
// usage: wp-advisories.mjs [rootDir]   (default '.')
// exit: 0 ran · 2 could not run
// env, read at call time: CW_WP_SKIP_DIRS, CW_WP_MAX_DEPTH (as bin/wp-integrity.mjs), and the
//   source variables of bin/lib/wp-source.mjs: CW_WPVULN_URL, CW_WP_API_URL, CW_WP_CACHE,
//   CW_WP_OFFLINE, CW_WP_TIMEOUT_MS, CW_WPVULN_TTL_HOURS, CW_NOW
// output: {tool, summary:{findings, byRule, filesScanned, components, installs, checked,
//   unknownToSource, notMeasured, unavailable, sources, advisoryData, requests, ...}, findings[]}
//   one row per vulnerable or closed component: slug, version, advisory ids, counts, the worst
//   score and whether a record is on CISA KEV — never a file's contents.
//
// Known vulnerabilities for the WordPress core, plugin and theme versions in the tree. Core is read
// against two sources: api.wordpress.org's release list, which says whether wordpress.org itself
// calls a version `latest`, `outdated` or `insecure` and is the only witness that a version string
// is a real release at all; and WPVulnerability (www.wpvulnerability.net, free, no key), which
// aggregates CVE, EUVD, Wordfence, Patchstack and WPScan records per version. Plugins and themes are
// read against WPVulnerability, whose ranges are evaluated with PHP's version_compare.
//
// A version the tree does not state is never guessed. A wp-content-only backup has no
// wp-includes/version.php, so core advisories are unmeasured and the run is partial; a site that
// sat on a release with a published unauthenticated SQL injection is exactly the case where a
// guessed "probably patched" version would have hidden the cause.
//
// The lane sends the core version and every plugin and theme slug to those two services (EGRESS
// registry); bin/lib/wp-source.mjs caches the answers privately for CW_WPVULN_TTL_HOURS.
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';
import { findInstalls, inventory, cleanHeader, versionCompare, versionSatisfies, SLUG_RX, VERSION_RX } from './lib/wordpress.mjs';
import { request, mapPool, tally, baseOf, cacheLabel } from './lib/wp-source.mjs';
import { skipDirs, maxDepth } from './wp-integrity.mjs';

export const TOOL = 'wp-advisories';

export const RULES = Object.freeze({
  'wp-core-vulnerable': { cwe: 'CWE-1395' },
  'wp-plugin-vulnerable': { cwe: 'CWE-1395' },
  'wp-theme-vulnerable': { cwe: 'CWE-1395' },
  'wp-plugin-closed': { cwe: 'CWE-1104' },
  'wp-theme-closed': { cwe: 'CWE-1104' },
});

const LIST_CAP = 200;
const IDS_CAP = 20;
const POOL = 4;
// The release-version shape api.wordpress.org lists. Anything else (a -src checkout, a nightly) is
// not looked up: the advisory source answers an unknown version exactly as it answers a clean one.
const CORE_RELEASE = /^\d+\.\d+(\.\d+)?$/;
const SEV_RANK = { '': 0, low: 1, med: 2, high: 3, crit: 4 };

const unentity = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');

/** {score, sev, kev, exploited, cwes} from a WPVulnerability `impact` (an object, or [] when none). */
export function impactOf(impact) {
  const out = { score: null, sev: '', kev: false, exploited: false, cwes: [] };
  if (!impact || typeof impact !== 'object' || Array.isArray(impact)) return out;
  // The order the WPVulnerability plugin reads them in: the newest CVSS the record carries.
  for (const k of ['cvss4', 'cvss3', 'cvss2', 'cvss']) {
    const n = Number(impact[k] && impact[k].score);
    if (impact[k] && Number.isFinite(n) && n > 0) { out.score = n; break; }
  }
  if (out.score !== null) out.sev = out.score >= 9 ? 'crit' : out.score >= 7 ? 'high' : out.score >= 4 ? 'med' : 'low';
  const ssvc = impact.ssvc && typeof impact.ssvc === 'object' ? impact.ssvc : {};
  out.kev = ssvc.kev === true;
  out.exploited = out.kev || ssvc.exploitation === 'active';
  out.cwes = (Array.isArray(impact.cwe) ? impact.cwe : []).map((c) => c && c.cwe).filter((c) => /^CWE-\d+$/.test(String(c)));
  return out;
}

/** Does a plugin/theme record's range include `version`? true, false, or null for a range PHP could not evaluate. */
export function applies(record, version) {
  const op = record && record.operator && typeof record.operator === 'object' ? record.operator : {};
  const minOp = op.min_operator ? String(op.min_operator) : '';
  const maxOp = op.max_operator ? String(op.max_operator) : '';
  const min = minOp ? versionSatisfies(version, minOp, String(op.min_version ?? '')) : true;
  const max = maxOp ? versionSatisfies(version, maxOp, String(op.max_version ?? '')) : true;
  if (!minOp && !maxOp) return false;
  if (min === null || max === null) return null;
  return min && max;
}

// The version that clears every applicable record, when each names one with `lt`; otherwise null.
function fixedIn(records) {
  let best = null;
  let open = 0;
  for (const r of records) {
    const op = (r.operator && typeof r.operator === 'object') ? r.operator : {};
    const fixed = String(op.unfixed ?? '0') !== '1' && ['lt', '<'].includes(String(op.max_operator || '')) && op.max_version;
    if (!fixed) { open++; continue; }
    if (!best || versionCompare(String(op.max_version), best) > 0) best = String(op.max_version);
  }
  return { version: open ? null : best, open };
}

function idsOf(records) {
  const ids = new Set();
  for (const r of records) for (const s of (Array.isArray(r.source) ? r.source : [])) if (s && s.id) ids.add(cleanHeader(String(s.id), 64));
  const cve = [...ids].filter((i) => /^CVE-\d{4}-\d+$/.test(i)).sort();
  const rest = [...ids].filter((i) => !/^CVE-\d{4}-\d+$/.test(i)).sort();
  return [...cve, ...rest];
}

// Up to three human titles from the highest-scored records, where a source gives a title rather than
// repeating its id. Advisory text is the source's, not the tree's; it is still capped and made printable.
function titlesOf(records) {
  const scored = records.map((r) => ({ r, s: impactOf(r.impact).score || 0 })).sort((a, b) => b.s - a.s);
  const out = [];
  for (const { r } of scored) {
    for (const s of (Array.isArray(r.source) ? r.source : [])) {
      if (!s || !s.name || s.name === s.id) continue;
      const t = cleanHeader(unentity(s.name), 100);
      if (t && !out.includes(t)) out.push(t);
      break;
    }
    if (out.length >= 3) break;
  }
  return out;
}

/** One finding row for a component's applicable records, or null when none apply. */
export function rowFor({ rule, path, slug, version, records, releaseStatus = null, overlapNote = false }) {
  if (!records.length && releaseStatus !== 'insecure') return null;
  let sev = '';
  let kev = 0;
  let exploited = 0;
  let worst = null;
  const cwes = new Set();
  for (const r of records) {
    const i = impactOf(r.impact);
    if (SEV_RANK[i.sev] > SEV_RANK[sev]) sev = i.sev;
    if (i.score !== null && (worst === null || i.score > worst)) worst = i.score;
    if (i.kev) kev++;
    if (i.exploited) exploited++;
    for (const c of i.cwes) cwes.add(c);
  }
  const ids = idsOf(records);
  const fix = rule === 'wp-core-vulnerable' ? null : fixedIn(records);
  const parts = [];
  if (records.length) {
    parts.push(`${records.length} advisory record(s) apply to ${slug} ${version}${overlapNote ? ' (records from different sources overlap: one flaw can appear as a CVE, an EUVD entry and a vendor record)' : ''}`);
    parts.push(`ids ${ids.slice(0, IDS_CAP).join(', ')}${ids.length > IDS_CAP ? `, +${ids.length - IDS_CAP} more` : ''}`);
    const titles = titlesOf(records);
    if (titles.length) parts.push(`including: ${titles.join(' | ')}`);
    parts.push(worst !== null ? `worst CVSS ${worst.toFixed(1)}` : 'no record carries a CVSS score, so the severity is undetermined');
    if (exploited) parts.push(`${exploited} marked actively exploited${kev ? `, ${kev} on CISA KEV` : ''}`);
    if (cwes.size) parts.push([...cwes].sort().join(', '));
  }
  if (releaseStatus === 'insecure') parts.push(`api.wordpress.org lists ${slug} ${version} as insecure: a later release in its branch fixes a security issue`);
  if (fix) parts.push(fix.version ? `fixed in ${fix.version}` : `${fix.open} record(s) name no fixed version`);
  return {
    rule, path, sev, cwe: RULES[rule].cwe, component: slug, version, advisories: records.length, ids: ids.slice(0, IDS_CAP),
    kev: kev > 0, exploited: exploited > 0, fixedIn: fix ? fix.version : null, detail: parts.join('; '),
  };
}

const epochIso = (n) => { const t = Number(n); return Number.isFinite(t) && t > 0 ? new Date(t * 1000).toISOString().slice(0, 10) : null; };

export async function scanTree(root) {
  const skip = new Set(skipDirs());
  const summary = {
    findings: 0, byRule: {}, filesScanned: 0,
    components: { core: 0, plugins: 0, themes: 0, checked: 0, unknownToSource: 0, versionUnknown: 0, unavailable: 0 },
    installs: [], checked: [], unknownToSource: [], notMeasured: [], unavailable: [],
    sources: { advisories: baseOf('advisories').label, releaseStatus: baseOf('core-stable-check').label, cache: cacheLabel() },
    advisoryData: { oldest: null, newest: null }, requests: null, rangesNotEvaluated: 0,
    skipDirs: [...skip], skippedPaths: [], unreadable: 0, unreadableFiles: [],
  };
  const findings = [];
  const partial = [];
  const listed = (arr, entry) => { if (arr.length < LIST_CAP) arr.push(entry); };
  const answers = [];
  const failed = new Map();
  const fail = (why) => failed.set(why, (failed.get(why) || 0) + 1);
  const dated = (body) => {
    const d = epochIso(body && body.updated);
    if (!d) return;
    if (!summary.advisoryData.oldest || d < summary.advisoryData.oldest) summary.advisoryData.oldest = d;
    if (!summary.advisoryData.newest || d > summary.advisoryData.newest) summary.advisoryData.newest = d;
  };

  const found = findInstalls(root, { skip, maxDepth: maxDepth() });
  summary.skippedPaths = found.skippedPaths.slice(0, LIST_CAP);
  for (const u of found.unreadable) { summary.unreadable++; listed(summary.unreadableFiles, u); }

  // The release list is one document for every version; fetched once, and only when a core is present.
  let stable = null;
  if (found.installs.some((i) => i.core.state === 'present')) {
    stable = await request('core-stable-check', {});
    answers.push(stable);
    if (stable.status !== 'ok') partial.push(`the core release list is unavailable: ${stable.reason || stable.status}`);
    else if (stable.via === 'stale-cache') partial.push(`the core release list came from an expired cache: ${stable.reason}`);
  }

  const jobs = [];
  for (const inst of found.installs) {
    const at = (rel) => (inst.path === '.' ? rel : `${inst.path}/${rel}`);
    const contentRel = (rel) => (inst.contentPath === '.' ? rel : `${inst.contentPath}/${rel}`);
    const entry = { path: inst.path, layout: inst.layout, core: { state: inst.core.state, version: inst.core.version, releaseStatus: null } };
    summary.installs.push(entry);
    const core = inst.core;
    if (core.state === 'present') {
      summary.components.core++;
      const listedStatus = stable && stable.status === 'ok' && Object.hasOwn(stable.body, core.version) ? stable.body[core.version] : undefined;
      if (typeof listedStatus === 'string') entry.core.releaseStatus = cleanHeader(listedStatus, 16);
      if (!CORE_RELEASE.test(core.version)) {
        summary.notMeasured.push({ component: 'core', path: inst.path, reason: `WordPress ${cleanHeader(core.version, 32)} is not a release version string, and the advisory source answers an unknown version exactly as it answers a clean one` });
        partial.push('core version is not a release version: core advisories unmeasured');
      } else if (stable && stable.status === 'ok' && listedStatus === undefined) {
        summary.notMeasured.push({ component: 'core', path: inst.path, reason: `api.wordpress.org lists no release ${core.version}: core advisories unmeasured rather than read as none` });
        partial.push(`core ${core.version} is not a listed release: core advisories unmeasured`);
      } else {
        jobs.push({ kind: 'core', rule: 'wp-core-vulnerable', type: 'core', key: core.version, slug: 'WordPress', version: core.version, path: at('wp-includes/version.php'), releaseStatus: entry.core.releaseStatus });
      }
    } else {
      const why = core.state === 'unreadable' ? `the core version could not be read (${core.reason})`
        : inst.layout === 'wp-content' ? 'WordPress core is not in the scanned tree (wp-content only)' : 'a site root without wp-includes/version.php';
      summary.notMeasured.push({ component: 'core', path: inst.path, reason: `${why}: the core version is unknown, so core advisories are unmeasured; it is never guessed` });
      partial.push('core version unknown: core advisories unmeasured');
    }

    if (inst.contentLink) {
      summary.notMeasured.push({ component: 'wp-content', path: at('wp-content'), reason: 'wp-content is a symbolic link, not followed: plugin and theme advisories are unmeasured' });
      partial.push('wp-content is a symbolic link: its components unmeasured');
    }
    if (!inst.contentAbs) continue;
    const inv = inventory(inst.contentAbs);
    for (const u of inv.unreadable) { summary.unreadable++; listed(summary.unreadableFiles, { path: u.path.startsWith(root) ? u.path.slice(root.length + 1) : u.path, why: u.why }); }
    for (const p of inv.plugins) {
      summary.components.plugins++;
      const path = p.main ? contentRel(`plugins/${p.slug}/${p.main}`) : contentRel(`plugins/${p.slug}`);
      if (!p.main || !p.version || !SLUG_RX.test(p.slug) || !VERSION_RX.test(p.version)) {
        summary.components.versionUnknown++;
        const why = p.error ? `unreadable (${p.error})` : p.symlink ? 'a symbolic link, not followed' : p.hidden ? 'a hidden directory, never loaded as a plugin'
          : !p.main ? 'no Plugin Name header, so not a plugin WordPress loads' : !p.version ? 'the main file carries no Version header'
            : 'the directory name or version is not a shape the advisory source keys on';
        listed(summary.notMeasured, { component: 'plugin', slug: p.slug, path, reason: `${why}: advisories not matched` });
        if (p.error) partial.push(`plugin ${p.slug} unreadable`);
        continue;
      }
      jobs.push({ kind: 'plugin', rule: 'wp-plugin-vulnerable', closedRule: 'wp-plugin-closed', type: 'plugin', key: p.slug, slug: p.slug, version: p.version, path });
    }
    for (const t of inv.themes) {
      summary.components.themes++;
      const path = contentRel(`themes/${t.slug}/style.css`);
      if (!t.name || !t.version || !SLUG_RX.test(t.slug) || !VERSION_RX.test(t.version)) {
        summary.components.versionUnknown++;
        const why = !t.name ? 'no Theme Name header in style.css' : !t.version ? 'style.css carries no Version header' : 'the directory name or version is not a shape the advisory source keys on';
        listed(summary.notMeasured, { component: 'theme', slug: t.slug, path, reason: `${why}: advisories not matched` });
        continue;
      }
      jobs.push({ kind: 'theme', rule: 'wp-theme-vulnerable', closedRule: 'wp-theme-closed', type: 'theme', key: t.slug, slug: t.slug, version: t.version, path });
    }
  }

  // One request per distinct (type, key): two installs of one plugin are one lookup.
  const keys = [...new Map(jobs.map((j) => [`${j.type}/${j.key}`, { type: j.type, key: j.key }])).values()];
  const results = await mapPool(keys, POOL, (k) => request('advisories', k));
  answers.push(...results);
  const byKey = new Map(keys.map((k, i) => [`${k.type}/${k.key}`, results[i]]));
  let stale = 0;
  for (const r of results) if (r.via === 'stale-cache') stale++;
  if (stale) partial.push(`${stale} advisory answer(s) came from an expired cache after the source failed`);

  for (const j of jobs) {
    const ans = byKey.get(`${j.type}/${j.key}`);
    const version = cleanHeader(j.version, 64);
    if (ans.status === 'error') {
      summary.components.unavailable++;
      listed(summary.unavailable, { kind: j.kind, slug: j.slug, version, path: j.path, why: ans.reason });
      fail(ans.reason);
      continue;
    }
    if (j.kind === 'core' && ans.status !== 'ok') {
      summary.notMeasured.push({ component: 'core', path: j.path, reason: `the advisory source holds no core record for ${version}: core advisories unmeasured` });
      partial.push('the advisory source holds no core record: core advisories unmeasured');
      continue;
    }
    const data = ans.status === 'ok' ? ans.body.data : null;
    if (ans.status === 'ok') dated(ans.body);
    summary.filesScanned++;
    // A plugin or theme the source has no record of (name null) is not a clean one: it is listed.
    if (j.kind !== 'core' && (!data || data.name == null)) {
      summary.components.unknownToSource++;
      listed(summary.unknownToSource, { kind: j.kind, slug: j.slug, version, path: j.path });
      continue;
    }
    summary.components.checked++;
    const all = data && Array.isArray(data.vulnerability) ? data.vulnerability : [];
    let records;
    if (j.kind === 'core') records = all;
    else {
      records = [];
      for (const r of all) {
        const a = applies(r, j.version);
        if (a === null) summary.rangesNotEvaluated++;
        else if (a) records.push(r);
      }
    }
    listed(summary.checked, { kind: j.kind, slug: j.slug, version, path: j.path, records: records.length, ...(j.kind === 'core' ? { releaseStatus: j.releaseStatus } : {}) });
    const row = rowFor({ rule: j.rule, path: j.path, slug: j.slug, version, records, releaseStatus: j.releaseStatus, overlapNote: j.kind === 'core' && records.length > 1 });
    if (row) findings.push(row);
    if (j.closedRule && data && Number(data.closed) === 1) {
      const reason = cleanHeader(data.closed_reason, 60);
      const date = cleanHeader(data.closed_date, 24);
      findings.push({ rule: j.closedRule, path: j.path, sev: /secur/i.test(reason) ? 'med' : 'low', cwe: RULES[j.closedRule].cwe, component: j.slug, version,
        detail: `${j.slug} is closed on wordpress.org${reason ? ` (${reason}${date ? `, ${date}` : ''})` : ''}: it receives no further releases from there` });
    }
  }
  if (summary.rangesNotEvaluated) partial.push(`${summary.rangesNotEvaluated} advisory range(s) used an operator version_compare does not know`);
  for (const [why, n] of [...failed.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) partial.push(`${n} advisory lookup(s) failed: ${why}`);
  if (summary.unreadable) partial.push(`${summary.unreadable} director(ies) unreadable`);

  summary.requests = tally(answers);
  findings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
  for (const f of findings) summary.byRule[f.rule] = (summary.byRule[f.rule] || 0) + 1;
  summary.byRule = Object.fromEntries(Object.entries(summary.byRule).sort(([a], [b]) => (a < b ? -1 : 1)));
  summary.findings = findings.length;
  for (const k of ['checked', 'unknownToSource', 'unavailable']) summary[k].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const reasons = [...new Set(partial)];
  if (reasons.length) { summary.partial = true; summary.partialReasons = reasons; }
  if (!found.installs.length) {
    summary.voidReason = 'no WordPress install in the tree (wp-includes/version.php, or a wp-content holding a plugin or theme), so no version was looked up; a tree without WordPress is a void, not a clean result';
  } else if (summary.filesScanned === 0) {
    summary.voidReason = `no component could be looked up: ${reasons.join('; ') || 'no component states a version'}`;
  }
  return { tool: TOOL, summary, findings };
}

// process.exitCode and a return, never process.exit(): on Node 24 and 26 exit() can hang joining a
// worker thread (docs/TRAPS.md), and every error is caught here so none takes the uncaught path.
async function main() {
  const root = resolve(process.argv[2] || '.');
  let st;
  try { st = lstatSync(root); } catch (e) { process.stderr.write(`wp-advisories: cannot read ${root}: ${e.code || e.message}\n`); process.exitCode = 2; return; }
  if (!st.isDirectory()) { process.stderr.write(`wp-advisories: ${root} is not a directory\n`); process.exitCode = 2; return; }
  try {
    const report = await scanTree(root);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (e) { process.stderr.write(`wp-advisories: could not run: ${e.message}\n`); process.exitCode = 2; }
}

if (isMainModule(import.meta.url)) main();
