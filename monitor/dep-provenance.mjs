// dep-provenance.mjs — where each dependency actually CAME FROM, and when that changed.
//
// WHY THIS EXISTS. advisory-reach.mjs correctly demotes an npm advisory that cannot reach a
// git-pinned dependency: firebase's closure-net resolves from github.com/google/closure-net, so
// MAL-2026-276 — an advisory about the npm package of that name — describes something the repo
// never installed. The demotion is right. Its consequence is not: an attacker who lands ONE pull
// request converting an npm dependency to a git URL on a fork they control turns a published
// critical into an `undetermined`, permanently, and every scanner in the fleet agrees with them.
//
// That is not a hole in advisory-reach — the advisory genuinely does not describe the artifact, and
// the row stays visible. It is a MISSING OBSERVATION: a dependency moving off the registry is a
// supply-chain event, and nothing here reports it.
//
// NOTHING RETAINED COULD ANSWER IT. Measured 2026-08-26 across the whole sweep directory: no
// lockfile is kept; npm-audit reports the version as 0.0.0 with no resolution field; depscan has no
// row. The syft SBOM was the strongest candidate and normalises the provenance away — closure-net
// appears as `pkg:npm/closure-net@0.0.0` with property set
// {foundBy, language, type, metadataType, location:0:path}, which is the IDENTICAL shape to
// rimraf@5.0.10 beside it. There is no field to read. Hence capture at scan time.
//
// (That SBOM purl is its own defect, filed separately: `pkg:npm/closure-net@0.0.0` asserts a
// registry package at a version npm has never served, and commitwork ships these as CRA evidence.)
//
// WHAT IS AND IS NOT A FINDING. A git dependency is NOT a finding. Thousands of repositories
// legitimately pin one, firebase among them, and reporting the state would bury the event in a
// population. The MIGRATION is the finding — registry to git, between two slices of the same repo.
// A repo that has always resolved a package from git is a fact about that repo; a repo where that
// changed last Tuesday is a question for a human. So a single slice produces INVENTORY, and the
// comparison produces the finding.
//
// Env: CW_DEP_PROVENANCE=off disables the comparison; read at CALL time.

/** How a lockfile entry was resolved. Ordered from most to least trusted. */
export const RESOLUTION = Object.freeze({
  registry: 'resolved from a package registry — the ordinary case, and the only one advisories describe',
  git: 'resolved from a git remote — no registry mediates it, so no registry advisory applies and no registry revocation reaches it',
  file: 'resolved from a local path — outside every scanner in this fleet',
  archive: 'resolved from a URL to a tarball — pinned to a host, not to a registry identity',
  unknown: 'the lockfile stated no resolution this parser recognises — not the same as "registry"',
});

export const enabled = () => process.env.CW_DEP_PROVENANCE !== 'off';

/**
 * Classify one lockfile `resolved` value.
 *
 * FAILS TOWARD `unknown`, never toward `registry`. Reading an unrecognised resolution as
 * registry-backed is the false-clean direction: it would silently assert that an advisory applies
 * to something we cannot place.
 */
export function classifyResolution(resolved) {
  const s = String(resolved || '').trim();
  if (!s) return 'unknown';
  if (/^git(\+|:)|^[^:]+:\/\/.*\.git(#|$)|^github:|^gitlab:|^bitbucket:/i.test(s)) return 'git';
  if (/^(file:|link:|portal:)/i.test(s)) return 'file';
  // A registry URL is an https URL whose host is a known registry OR whose path carries the
  // /-/ tarball convention every npm-compatible registry uses.
  if (/^https?:\/\//i.test(s)) {
    if (/registry\.(npmjs\.org|yarnpkg\.com)|\/-\/|registry\.npmmirror\.com|\.jfrog\.io|artifactory|verdaccio|npm\.pkg\.github\.com/i.test(s)) return 'registry';
    return 'archive';
  }
  return 'unknown';
}

/** Strip a yarn/npm specifier down to its package name, keeping an @scope. */
export function packageNameOf(spec) {
  const s = String(spec || '').replace(/^"|"$/g, '').trim();
  if (!s) return '';
  const at = s.lastIndexOf('@');
  return at > 0 ? s.slice(0, at) : s;
}

/**
 * Parse a yarn.lock (v1 or berry) into {name -> {resolution, target}}.
 * Text-scanned rather than YAML-parsed: yarn v1 is not YAML, and this file has no dependencies.
 */
export function parseYarnLock(text) {
  const out = {};
  let names = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line) && line.trimEnd().endsWith(':')) {
      // a header: one or more comma-separated specifiers
      names = line.trimEnd().slice(0, -1).split(',').map((p) => packageNameOf(p.trim())).filter(Boolean);
      continue;
    }
    const m = line.match(/^\s+(?:"?resolution"?|resolved)\s*:?\s*"?([^"\s]+)"?\s*$/);
    if (!m || !names.length) continue;
    const target = m[1];
    // yarn v1 writes a bare URL; BERRY writes `name@npm:1.2.3` / `name@https://…`, so the
    // protocol has to be taken from after the last @.
    //
    // Splitting on @ unconditionally was wrong and quietly cost 436 of firebase's 1,755 packages.
    // A v1 registry URL for a SCOPED package contains an @ in its path —
    // `https://registry.npmjs.org/@babel/code-frame/-/code-frame-7.26.2.tgz` — so lastIndexOf('@')
    // landed on the scope, left `babel/code-frame/-/…` as the supposed protocol, and every scoped
    // package fell to `unknown`. Under-reporting registry resolution is the safe direction here,
    // which is exactly why it went unnoticed in the counts until they were read.
    const isUrl = /^([a-z][a-z0-9+.-]*):\/\//i.test(target) || /^git(\+|@)/i.test(target);
    const rhs = isUrl ? target : (target.lastIndexOf('@') > 0 ? target.slice(target.lastIndexOf('@') + 1) : target);
    const res = /^npm:/.test(rhs) ? 'registry' : classifyResolution(rhs);
    for (const n of names) out[n] = { resolution: res, target };
    names = [];
  }
  return out;
}

/** Parse a package-lock.json (v2/v3 `packages`, or v1 `dependencies`) into the same shape. */
export function parsePackageLock(doc) {
  const out = {};
  const d = doc || {};
  for (const [path, e] of Object.entries(d.packages || {})) {
    if (!path || !e) continue;                     // "" is the root project, not a dependency
    const name = e.name || path.split('node_modules/').pop();
    if (!name) continue;
    out[name] = { resolution: e.resolved ? classifyResolution(e.resolved) : (e.link ? 'file' : 'unknown'), target: e.resolved || '' };
  }
  const walk = (deps) => {
    for (const [name, e] of Object.entries(deps || {})) {
      if (!e) continue;
      if (!out[name]) out[name] = { resolution: e.resolved ? classifyResolution(e.resolved) : 'unknown', target: e.resolved || '' };
      if (e.dependencies) walk(e.dependencies);
    }
  };
  walk(d.dependencies);
  return out;
}

/**
 * Compare two slices of one repo's provenance and report what MOVED.
 *
 * Only a package present in BOTH is compared. An appearance or a disappearance is an ordinary
 * dependency change and belongs to whatever reports those; conflating them here would drown the
 * event this exists to surface.
 *
 * @param {Object} before name -> {resolution, target}
 * @param {Object} after  name -> {resolution, target}
 */
/**
 * The comparable identity of a target WITHIN one resolution class. The fork attack this module's
 * header describes does not change the class — github.com/google/x to github.com/evil/x is git
 * before and git after — it changes WHOSE code the pin names. For a git target that identity is
 * host + owning path segment; for a registry or archive target it is the host (a version bump
 * moves the tarball path on the SAME host, which is ordinary and must not alarm). A target with
 * no extractable host (yarn berry writes `npm:1.2.3`) returns null: two vintages of lockfile
 * writing different shapes is our blind spot, not an event.
 */
export function targetIdentity(resolution, target) {
  const s = String(target || '').trim().replace(/^git\+/i, '');
  if (!s) return null;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : (/^git@([^:]+):(.+)$/.test(s) ? s.replace(/^git@([^:]+):/, 'ssh://$1/') : s)); }
  catch { return null; }
  if (!u.hostname) return null;
  if (resolution === 'git') {
    const seg = u.pathname.split('/').filter(Boolean)[0] || '';
    return `${u.hostname.toLowerCase()}/${seg.toLowerCase()}`;
  }
  return u.hostname.toLowerCase();
}

export function diffProvenance(before, after) {
  const moved = [];
  if (!enabled()) return { moved, enabled: false, compared: 0, note: '' };
  const b = before || {}; const a = after || {};
  let compared = 0;
  for (const [name, now] of Object.entries(a)) {
    const was = b[name];
    if (!was || !now) continue;
    compared++;
    // `unknown` in either direction is a parser gap, not an event. Saying "moved to unknown" would
    // manufacture an incident out of our own blind spot.
    if (was.resolution === 'unknown' || now.resolution === 'unknown') continue;
    if (was.resolution === now.resolution) {
      // SAME-CLASS TARGET DRIFT (2026-08-27). The class comparison alone was blind to the exact
      // attack the header describes: one merged PR re-pointing a git pin at another org is git
      // before and git after, and `continue` here read it as nothing happening. Compared only
      // when BOTH sides yield an identity — one comparable side is a vintage mismatch, not an
      // event — and never for `file` (local paths move freely, and name no source anyone serves).
      if (was.resolution === 'file') continue;
      const from = targetIdentity(was.resolution, was.target);
      const to = targetIdentity(now.resolution, now.target);
      if (from && to && from !== to) {
        moved.push({ package: name, kind: 'target-drift', from: was.resolution, to: now.resolution,
          fromTarget: was.target || '', toTarget: now.target || '',
          fromIdentity: from, toIdentity: to, offRegistry: false });
      }
      continue;
    }
    moved.push({ package: name, kind: 'resolution', from: was.resolution, to: now.resolution,
      fromTarget: was.target || '', toTarget: now.target || '',
      offRegistry: was.resolution === 'registry' && now.resolution !== 'registry' });
  }
  moved.sort((x, y) => (Number(y.offRegistry) - Number(x.offRegistry)) || x.package.localeCompare(y.package) || (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0));
  const off = moved.filter((m) => m.offRegistry).length;
  const drift = moved.filter((m) => m.kind === 'target-drift').length;
  const notes = [];
  if (off) notes.push(`${off} dependency(ies) moved OFF a package registry since the previous slice. A registry advisory cannot describe a package the registry no longer serves, and a registry revocation cannot reach it — so this is the event that makes a malicious-package advisory stop applying. Verify the new source is the one you intended.`);
  if (drift) notes.push(`${drift} dependency(ies) kept their resolution class and changed WHERE they resolve from (host, or owning org for git pins). A re-pointed pin is the one-PR supply-chain move this comparison exists to catch — verify the new source.`);
  return { moved, enabled: true, compared, offRegistry: off, targetDrift: drift, note: notes.join(' ') };
}

/**
 * Compare one repo's inventory between two SLICE DIRECTORIES.
 *
 * Reads the artifacts where they already live rather than carrying them through rollup.json: the
 * full map is ~1,750 entries for a single repo, which across a hundred would add megabytes to a
 * document that is already large, to answer a question that touches a handful of packages.
 *
 * THE FIRST SLICE FOR A REPO HAS NO PREDECESSOR, and that is not a clean result. It is
 * `no-reference` — unknown.mjs's word for "compared against nothing" — because "no migration
 * detected" and "nothing to compare against" are the same output and must not be the same claim.
 *
 * @param {string|null} prevDir the previous slice's directory for this repo, or null
 * @param {string} curDir this slice's directory for this repo
 * @param {(p:string)=>any} readJson injected so the caller owns fs access and tests need no disk
 */
export function compareSlices(prevDir, curDir, readJson) {
  const read = (dir) => {
    if (!dir) return null;
    try { return readJson(`${dir}/dep-provenance.json`); } catch { return null; }
  };
  const cur = read(curDir);
  // No inventory this slice: the check did not run here. Not a comparison that found nothing.
  if (!cur || cur.ran !== true) {
    return { unknown: true, unknownReason: 'not-run', moved: [], offRegistry: 0,
      detail: 'no dep-provenance inventory in this slice — the check did not run for this repo' };
  }
  const prev = read(prevDir);
  if (!prev || prev.ran !== true) {
    return { unknown: true, unknownReason: 'no-reference', moved: [], offRegistry: 0,
      detail: prevDir
        ? 'the previous slice has no inventory for this repo, so there is nothing to compare against'
        : 'this is the first slice carrying an inventory for this repo, so there is nothing to compare against',
      inventoried: Object.keys(cur.packages || {}).length };
  }
  const d = diffProvenance(prev.packages, cur.packages);
  return { ...d, inventoried: Object.keys(cur.packages || {}).length };
}

export default { classifyResolution, packageNameOf, parseYarnLock, parsePackageLock, diffProvenance, compareSlices, RESOLUTION, enabled };
