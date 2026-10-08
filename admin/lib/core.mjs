// admin/lib/core.mjs — the primitives every route group needs. Nothing here knows about HTTP.
//
// serve.mjs had reached 2,915 lines with ~35 routes in one 870-line if-chain, making it the panel's
// contention point by construction (measured 2026-08-02: four sessions editing it in one minute).
// The split is by AREA, not layer — routes/posture.mjs owns the route AND its computation.
// Something belongs here at THREE or more route groups. Two is a coincidence.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { withinRoot } from '../../lib/path-contain.mjs'; // `startsWith(root + '/')` is false on Windows
import { projectSlug } from '../../monitor/project-scope.mjs';
import { loadRegistry, areaOut, registryPath } from '../../monitor/registry.mjs';
import { resolveRepos } from '../../monitor/discover.mjs';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ADMIN = resolve(HERE, '..');
export const CW = resolve(HERE, '..', '..');

// Default report dir. Kept for the module-level paths that are not per-project
// (e.g. the renovate paste ledger); per-project reads go through reportsFor().
// See admin/serve.mjs for the full reasoning. A failed resolution must not point at another area's
// reports: four of reportsFor()'s five returns are error paths, so the old literal served one
// customer's fleet numbers under whichever project failed to resolve. Resolves nowhere on purpose;
// readJSON yields null, the panel renders "not scanned". Never created on disk.
export const UNRESOLVED = join(CW, 'reports', '__unresolved__');
export const RUNTIME = join(CW, 'reports', 'runtime-latest');
export const MANIFEST_DIR = join(CW, 'manifests');

export const readJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
// readJSON's null is every failure at once, and a consumer that renders null as "absent" reports a
// torn or corrupt file as a sweep that never happened. This keeps the two apart: only ENOENT (and a
// path through a non-directory, which is how UNRESOLVED fails) is absent; anything else is a file
// that exists and could not be read, with the reason.
export const readJSONState = (p) => {
  try { return { state: 'ok', value: JSON.parse(readFileSync(p, 'utf8')), why: null }; }
  catch (e) {
    const code = e && e.code;
    return (code === 'ENOENT' || code === 'ENOTDIR') ? { state: 'absent', value: null, why: null }
      : { state: 'unreadable', value: null, why: String((e && e.message) || e).slice(0, 300) };
  }
};
export const readTxt = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// ── REGISTRY ACCESSOR (R18) ─────────────────────────────────────────────────────────────────────
// Was a boot-time `const REGISTRY = loadRegistry()`. Five remediation items write projects.json, and
// against a snapshot the operator edits, reloads, sees nothing, and concludes the fix failed — five
// times. serve.mjs still throws at STARTUP on a corrupt registry, but a request-time re-read must
// not: it can observe a half-written file, and empty reads as "nothing deployed". A failed re-read
// keeps serving the LAST GOOD registry and records why.
let _regCache = null;
let _regMtime = 0;
let _regStale = null;

export function registry() {
  // a missing/unreadable file yields 0, which forces a re-read — the safe direction
  let mtime = 0;
  try { const rp = registryPath(); mtime = existsSync(rp) ? statSync(rp).mtimeMs : 0; } catch { /* re-read */ }
  if (_regCache && mtime && mtime === _regMtime) return _regCache;
  try {
    const fresh = loadRegistry();
    _regCache = fresh; _regMtime = mtime; _regStale = null;
    return fresh;
  } catch (e) {
    // never degrade to {} — that is "nothing declared", which is a different and much worse claim
    _regStale = { at: new Date().toISOString(), error: String(e && e.message || e).slice(0, 300) };
    if (_regCache) return _regCache;
    throw e;   // no last-good to fall back to: the caller must see this
  }
}
/** Why the registry is being served from cache, or null when it is current. */
export const registryStale = () => _regStale;

/**
 * Report directory for a project, from the registry — `areas[].out` via areaOut(), falling back to
 * the project slug (matching sweep.mjs's areaOut routing). Pinning this to one directory made every
 * per-area sweep invisible: reports/<area>/rollup.json existed on disk but nothing served it, so the
 * picker could offer a project while the numbers below it still described whichever area last wrote
 * clientA-monorepo.
 */
export function reportsFor(project) {
  if (!project) return UNRESOLVED;
  try {
    const slug = projectSlug(project);
    const out = areaOut(slug, registry()) || slug;
    // Never let a caller-supplied name shape a path: single path segment only.
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(out)) return UNRESOLVED;
    // resolve(), not join(): an ABSOLUTE reportsRoot is legitimate registry input (monitor/area.mjs
    // resolves it the same way, and the scope-routing fixtures depend on it). join() concatenated it
    // under CW, so every per-area lookup missed and the panel silently served the DEFAULT area's
    // numbers under every project name — the false-attribution shape reportsFor exists to prevent.
    const root = resolve(CW, registry().reportsRoot || 'reports');
    const dir = join(root, out);
    // withinRoot(): `startsWith(root + '/')` is false for every path on Windows, so area
    // resolution ALWAYS returned UNRESOLVED — and the proof is on disk in this checkout, as
    // `reports/__unresolved__`, a directory reports-unresolved.test.mjs asserts must never exist.
    if (!withinRoot(root, dir)) return UNRESOLVED;
    if (existsSync(join(dir, 'rollup.json'))) return dir;
    // A KNOWN project that has never been swept has no rollup. Falling back to the default area here
    // would render the FLEET's severity counts under that project's name — the precise
    // "non-specific information" this scoping exists to remove, and indistinguishable from a real
    // result. Return the (empty) area dir instead: readJSON yields {} and the panel shows
    // "not scanned" rather than someone else's numbers.
    return dir;
  } catch { /* fall through to the default below */ }
  return UNRESOLVED;
}

/** The area's history directory. Inlined in three places before this existed. */
export const historyFor = (project) => join(reportsFor(project), 'history');

// ── manifests ───────────────────────────────────────────────────────────────────────────────────
// The bundled manifest set, plus whatever the registry's projects declare. Existing-only and sorted,
// so the served order is deterministic and a manifest named by a project but absent from disk is
// dropped rather than 404-ing a route.
export function manifestFiles(namedOnly = null) {
  const named = new Set(namedOnly || []);
  if (!namedOnly) {
    for (const n of ['branch-protection', 'build-health', 'quality-gates', 'runtime', 'security-baseline']) named.add(n);
    const live = registry();
    for (const p of (live.projects || [])) {
      const m = p.manifest; if (!m) continue;
      (Array.isArray(m) ? m : [m]).forEach((x) => named.add(x));
    }
  }
  return [...named].filter((n) => existsSync(join(MANIFEST_DIR, `${n}.json`))).sort();
}

export function manifestSummary(name) {
  const j = readJSON(join(MANIFEST_DIR, `${name}.json`));
  if (!j) return { name, ok: false };
  const checks = Array.isArray(j.checks) ? j.checks : [];
  return {
    name, ok: true, repo: j.repo || null, note: j.note || null,
    groups: Object.keys(j.groups || {}),
    groupMembers: j.groups || {},
    checkCount: checks.length,
    // Every precondition, not just the first key that happened to be present. This used to read
    // `c.requires.tools || c.requires.env || c.requires`, which returns ONLY `tools` whenever tools
    // exists — so a check declaring tools PLUS seven secrets rendered as needing `node, npm`. A check
    // shown as cheaper than it is will be scheduled and then skip, which is this platform's own
    // failure mode.
    checks: checks.map((c) => ({ id: c.id, description: c.description || '', groups: c.groups || [],
      requires: c.requires && typeof c.requires === 'object' ? c.requires : null,
      report: c.report ? c.report.file : null,
      aliasOf: c.aliasOf || null,
      remediationPrompt: c.remediationPrompt || null,
      // scanner-specific FORMAT FACTS (e.g. what a .gitleaksignore line actually is) — measured
      // 2026-08-03: both local engines invented ignore-file syntax the prompt never showed them;
      // supplying the mechanics is the fix, not a smarter model
      formatNotes: c.formatNotes || null })),
  };
}

// ── the resolved fleet ──────────────────────────────────────────────────────────────────────────
// The sweep's OWN resolver, so the panel can never disagree with what actually gets scanned.
// Cached for 30s: it walks the discovery roots, and three route groups call it per request.
//
// Fails to the EXPLICIT projects rather than to an empty list. An empty fleet renders as "nothing
// to scan", which is the silent-green shape — a degraded answer must still be an answer, and the
// reason is logged rather than swallowed.
let _reposCache = { at: 0, repos: [] };
export function resolvedRepos() {
  const now = Date.now();
  if (now - _reposCache.at < 30_000) return _reposCache.repos;
  let repos = [];
  try {
    const r = resolveRepos(registry(), { selfRoot: CW });
    repos = r?.repos || (Array.isArray(r) ? r : []);
  } catch (e) {
    console.error('[admin] resolveRepos failed, falling back to explicit projects:', e.message);
    repos = (registry().projects || []).map((p) => ({ name: p.name, path: p.path }));
  }
  _reposCache = { at: now, repos };
  return repos;
}

// ── HTML comment stripping ──────────────────────────────────────────────────────────────────────
// Here, not serve.mjs: importing serve.mjs starts the panel and reads the keychain, so it cannot be
// unit-tested. Two defects in the regex version, both reproduced (js/bad-tag-filter,
// js/incomplete-multi-character-sanitization): `--!>` also closes a comment, and one delete pass can
// MANUFACTURE the token it strips — `"<<!--!--"` -> `"<!--"`. Looping to a fixed point fixed the
// behaviour and CodeQL kept firing, and "correct but unrecognised" is what every false-clean says.
// So no regex: a single left-to-right scan copies characters and skips comments, which makes the
// guarantee structural — a `<` is only copied when it does NOT begin `<!--`, so the output cannot
// contain one. The trailing brace guard is a SINGLE-character replace, so it cannot reintroduce the
// multi-character class it backstops.
const COMMENT_OPEN = '<!--';
export function stripHtmlComments(s) {
  const src = String(s ?? '');
  let out = '';
  for (let i = 0; i < src.length;) {
    if (src.startsWith(COMMENT_OPEN, i)) {
      i += COMMENT_OPEN.length;
      // HTML closes a comment with `-->` OR `--!>` (the spec's comment-end-bang state). An
      // unterminated comment runs to end-of-input, which is also what a browser does.
      while (i < src.length) {
        if (src.startsWith('-->', i)) { i += 3; break; }
        if (src.startsWith('--!>', i)) { i += 4; break; }
        i++;
      }
      continue;
    }
    out += src[i];
    i++;
  }
  return /<!--|--!?>/.test(out) ? out.replace(/</g, '&lt;').replace(/>/g, '&gt;') : out;
}
