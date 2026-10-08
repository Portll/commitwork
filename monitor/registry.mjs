// commitwork monitor — the project registry: load, validate, and resolve AREAS.
// An area is the declared unit of report output/retention/freshness; entry → area is N:1 and
// declared, never inferred. Wrong types die, unknown keys warn (except `deploy`: unknown keys
// die); loadRegistry() throws rather than degrading to {}. Both validators run and are fatal.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { registryPathFor } from './store-paths.mjs';
import { checkSchemaSupport, checkNode, validateAgainstSchema as validateDocument } from '../lib/json-schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// N3, 2026-08-29 — HEAD was not self-sufficient. `projects.json` is gitignored (.gitignore:69,
// deliberately: it names real repos, filesystem paths and deploy scoping), so a fresh clone had no
// registry at all and could not run the monitor OR its own suite — measured 114 test failures under
// `git archive HEAD`, 100 under `git worktree`, against 9 in this directory. The operator's ruling
// (2026-08-29) was to ship a redacted example and fall back to it, NOT to commit the real file.
//
// The fallback is DECLARED, never silent. An example fleet that loads quietly is the grey-reads-as-
// green shape this repo is arranged against: a panel showing two demonstration projects looks
// exactly like a panel showing a real fleet of two. So loadRegistry() announces it, and
// isExampleRegistry() lets any consumer that publishes a number say which fleet it counted.
//
// An EXPLICIT CW_REGISTRY never falls back: asking for a named file and silently getting a
// different one is the same defect wearing the opposite mask. It resolves, and if it is absent the
// read throws with the path the caller asked for.
export const EXAMPLE_REGISTRY_PATH = join(HERE, 'projects.example.json');

/** Resolved at CALL time — the env is read per call, never captured at import. */
export function registryPath() {
  if (process.env.CW_REGISTRY) return resolve(process.env.CW_REGISTRY);
  const declared = registryPathFor(REPO);
  return existsSync(declared) ? declared : EXAMPLE_REGISTRY_PATH;
}

/** True when `p` is the shipped example rather than a real fleet declaration. */
export const isExampleRegistry = (p) => resolve(p) === resolve(EXAMPLE_REGISTRY_PATH);

// A SCHEDULED CALLER MUST REFUSE THE EXAMPLE, NOT FALL BACK TO IT.
//
// The fallback above is right for a human at a terminal: a clean checkout can run the monitor and
// is told, three lines loud, that the fleet is a demonstration. It is wrong for anything launchd
// starts. There the warning goes to a log nobody reads, the sweep runs a two-repo example fleet to
// completion, and every lane reports success — absence rendered as success, which is the one shape
// this repository exists to refuse. The warning is the only thing standing between that and
// silence, and a warning nobody reads is silence.
//
// EXPLICIT, NOT INFERRED. The obvious discriminator is "is stdout a TTY", and it is wrong: that
// asks whether output is going to a terminal, which is a PROXY for whether a human is watching,
// and the two come apart the moment anyone pipes a command or runs it under CI. A proxy that
// decouples is worse than no check, because it keeps answering after it stops being true. So the
// scheduled caller declares itself, deliberately, and monitor/install-agents.mjs sets this on
// every agent it generates — every launchd agent is by definition a scheduled caller.
//
// Read at CALL time, never captured at import, per the house rule: a `const X = process.env.Y` at
// module load silently defeats any test that sets it afterwards, so the test passes proving nothing.
export const REQUIRE_REAL_ENV = 'CW_REGISTRY_REQUIRE_REAL';
export const requiresRealRegistry = () => process.env[REQUIRE_REAL_ENV] === '1';

// Import-time snapshot, kept because consumers import it as a string (admin/serve.mjs stats it for
// an mtime watch, bin/deploy.mjs defaults a flag to it). It cannot see a projects.json that appears
// later in the process's life — anything resolving per call must use registryPath() instead.
export const REGISTRY_PATH = registryPath();
export const SCHEMA_PATH = join(HERE, '..', 'schema', 'projects.schema.json');

// repo/area names reach the filesystem AND the panel's DOM. Constrain at the source.
export const NAME_RE = /^[A-Za-z0-9._-]+$/;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

// `out` is a directory name (dots legal); no leading dot, no slash — one safe path segment.
// Lowercase on purpose: macOS is case-insensitive, so mixed case collides on disk.
export const OUT_RE = /^[a-z0-9][a-z0-9.-]*$/;
// Deploy hostnames reach the generated cloudflared ingress YAML verbatim: lowercase DNS labels,
// at least two, which also rejects path/space/quote smuggling.
export const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

const isStr = (v) => typeof v === 'string';
const isStrArr = (v) => Array.isArray(v) && v.every(isStr);
const isBool = (v) => typeof v === 'boolean';

// slug is the route/artifact identity; out is the report directory — collapsing renames live artifacts.
const AREA_KEYS = new Set(['slug', 'label', 'out', 'members', 'prefixes', 'primary', 'cadenceMs', 'races', 'deploy', 'bola', 'renovate', 'minify', 'retention', 'thirdParty', 'rollupBatch', 'paused', 'note']);
// Per-area retention OVERRIDES the global for that area, so a typo here would silently restore the
// global default on the one area someone deliberately singled out — unknown keys are errors, not warnings.
const AREA_RETENTION_KEYS = new Set(['keepFullSweeps', 'keepDays', 'note']);
// `deploy` is declaration, never authority (applying stays a human step). Unknown keys here are
// FATAL: a dropped key becomes ingress that silently differs from the declaration.
const DEPLOY_KEYS = new Set(['hostnames', 'service', 'public', 'requiresAuth', 'authAt', 'originServerName', 'caPool', 'note', 'probePath', 'hosting']);
const TOP_KEYS = new Set(['$schema', 'areas', 'areasNote', 'projects', 'roots', 'defaultManifest',
  'reportsRoot', 'monitorOutput', 'exclude', 'excludeNote', 'excludeReasons', 'lifecycle', 'lifecycleNote', 'retention',
  'urls', 'urlsNote', 'historic', 'note', 'semgrepPro']);

// THE SEMGREP PRO ALLOWANCE IS A LICENCE TERM, SO IT IS ENFORCED AT LOAD RATHER THAN AT USE.
// The Pro engine is licensed for a bounded number of repositories; the fleet is larger than that
// bound. Every other cap in this file is a house rule we chose, and could relax; this one is a
// promise made to somebody else, so the registry must never HOLD a state that breaches it — a
// declaration that outlives the thing it permits is the shape this repository files against.
// Refusing here means no consumer re-checks it and none of them can disagree about the count.
export const SEMGREP_PRO_MAX = 10;
const PROJECT_KEYS = new Set(['name', 'path', 'manifest', 'expand', 'area', 'urls', 'urlsNote', 'url', 'note', 'hermeticTest']);
// hermeticTest is the operator's declaration of what a repository's tests need on a bare runner
// (bin/hermetic-test.mjs). It lives here and never in the repository, because its prepare steps run.
const HERMETIC_KEYS = new Set(['prepare', 'runnerDiskGb', 'note']);

// -> { errors: [], warnings: [] }. Callers decide whether warnings are fatal.
export function validateRegistry(reg) {
  const errors = [], warnings = [];
  if (!reg || typeof reg !== 'object' || Array.isArray(reg)) {
    errors.push('registry is not an object');
    return { errors, warnings };
  }
  for (const k of Object.keys(reg)) if (!TOP_KEYS.has(k)) warnings.push(`unknown top-level key: ${k}`);

  // semgrepPro — FATAL, not a warning, and the whole reason is in SEMGREP_PRO_MAX above. Every name
  // must also resolve to a declared project: a Pro slot spent on a repo that does not exist is a
  // slot the fleet cannot use, and it would be spent silently.
  if (reg.semgrepPro !== undefined) {
    const sp = reg.semgrepPro;
    if (!sp || typeof sp !== 'object' || Array.isArray(sp)) errors.push('semgrepPro must be an object');
    else {
      const bad = Object.keys(sp).filter((k) => !['repos', 'note'].includes(k));
      if (bad.length) errors.push(`semgrepPro: unknown key(s) ${bad.join(', ')}`);
      if (!Array.isArray(sp.repos)) errors.push('semgrepPro.repos must be an array of project names');
      else {
        if (sp.repos.length > SEMGREP_PRO_MAX) {
          errors.push(`semgrepPro.repos names ${sp.repos.length} repositories; the licence allows `
            + `${SEMGREP_PRO_MAX}. Deselect ${sp.repos.length - SEMGREP_PRO_MAX} before this can load — `
            + 'a registry that declares more than the licence permits is a breach the sweep would carry out.');
        }
        const dupes = sp.repos.filter((n, i) => sp.repos.indexOf(n) !== i);
        if (dupes.length) errors.push(`semgrepPro.repos lists ${[...new Set(dupes)].join(', ')} more than once — `
          + 'a duplicate spends two slots on one repository');
        for (const n of sp.repos) {
          if (typeof n !== 'string' || !n.trim()) errors.push('semgrepPro.repos holds a non-string entry');
        }
        // WHETHER A NAME RESOLVES IS DELIBERATELY NOT CHECKED HERE, and the first version of this
        // block got it wrong in both directions by checking it against projects[]. Measured
        // 2026-08-29: 8 declared projects resolve to 119 repos, and 112 of the names the sweep
        // actually scans appear in no projects[] entry. That check would have refused a real
        // allocation for a client service's own name while accepting `client-a` — a group name the
        // sweep never matches, whose seat therefore buys nothing, and which expands to ~60 repos
        // that one licence seat could not cover anyway.
        // Resolution walks the disk; this validator is pure and runs on every load, so the
        // resolvable-name check lives in admin/routes/projects-view.mjs setSemgrepPro(), where
        // resolveRepos() is already available. Structural invariants here, resolution-dependent
        // ones there — not the same question, and cheap-vs-expensive is the lesser reason.
      }
    }
  }

  const slugs = new Set();
  // One hostname routes to one origin — a double claim is fatal, never resolved by order.
  const hostClaims = new Map(); // hostname -> first claiming area slug
  // Members/prefixes are claimed like hostnames: areaOf() resolves first-match.
  const memberClaims = new Map(); // repo name -> first claiming area slug
  const prefixClaims = new Map(); // prefix -> first claiming area slug
  if (reg.areas !== undefined) {
    if (!Array.isArray(reg.areas)) errors.push('areas must be an array');
    else reg.areas.forEach((a, i) => {
      const at = `areas[${i}]`;
      if (!a || typeof a !== 'object' || Array.isArray(a)) { errors.push(`${at} is not an object`); return; }
      for (const k of Object.keys(a)) if (!AREA_KEYS.has(k)) warnings.push(`${at} (${a.slug || '?'}): unknown key ${k}`);
      if (!isStr(a.slug) || !SLUG_RE.test(a.slug)) errors.push(`${at}: slug must match ${SLUG_RE}`);
      else if (slugs.has(a.slug)) errors.push(`${at}: duplicate area slug '${a.slug}'`);
      else slugs.add(a.slug);
      if (a.label !== undefined && !isStr(a.label)) errors.push(`${at}: label must be a string`);
      if (a.out !== undefined && (!isStr(a.out) || !OUT_RE.test(a.out))) errors.push(`${at}: out must match ${OUT_RE}`);
      for (const k of ['members', 'prefixes']) if (a[k] !== undefined && !isStrArr(a[k])) errors.push(`${at}: ${k} must be an array of strings`);
      if (isStrArr(a.members)) for (const m of a.members) {
        if (memberClaims.has(m)) errors.push(`${at} (${a.slug || '?'}): member '${m}' is already claimed by area '${memberClaims.get(m)}'`);
        else memberClaims.set(m, a.slug || '?');
      }
      if (isStrArr(a.prefixes)) for (const px of a.prefixes) {
        if (prefixClaims.has(px)) errors.push(`${at} (${a.slug || '?'}): prefix '${px}' is already claimed by area '${prefixClaims.get(px)}'`);
        else {
          // an overlapping prefix is ambiguous too: 'web-' and 'web-admin-' both match web-admin-console
          for (const [other, slug] of prefixClaims) {
            if (px.startsWith(other) || other.startsWith(px)) {
              errors.push(`${at} (${a.slug || '?'}): prefix '${px}' overlaps '${other}' claimed by area '${slug}'`);
              break;
            }
          }
          prefixClaims.set(px, a.slug || '?');
        }
      }
      for (const k of ['primary', 'races']) if (a[k] !== undefined && !isBool(a[k])) errors.push(`${at}: ${k} must be a boolean`);
      if (a.retention !== undefined) {
        const r = a.retention;
        if (!r || typeof r !== 'object' || Array.isArray(r)) errors.push(`${at}: retention must be an object`);
        else {
          for (const k of Object.keys(r)) if (!AREA_RETENTION_KEYS.has(k)) errors.push(`${at} (${a.slug || '?'}): unknown retention key ${k}`);
          if (r.keepFullSweeps !== undefined && !(Number.isInteger(r.keepFullSweeps) && r.keepFullSweeps >= 0)) errors.push(`${at}: retention.keepFullSweeps must be an integer >= 0`);
          if (r.keepDays !== undefined && !(Number.isFinite(r.keepDays) && r.keepDays > 0)) errors.push(`${at}: retention.keepDays must be a number > 0`);
          if (r.note !== undefined && !isStr(r.note)) errors.push(`${at}: retention.note must be a string`);
        }
      }
      if (a.cadenceMs !== undefined && (typeof a.cadenceMs !== 'number' || !(a.cadenceMs > 0))) errors.push(`${at}: cadenceMs must be a positive number`);
      // PAUSED. `since` and `reason` are both required, for `excludeNote`'s stated reason: an
      // exclusion with no reason is indistinguishable from an oversight, and a pause that cannot
      // say when it started cannot be reviewed. A boolean would have been half a fact.
      if (a.paused !== undefined) {
        const p = a.paused, pat = `${at} (${a.slug || '?'}) paused`;
        if (!p || typeof p !== 'object' || Array.isArray(p)) errors.push(`${pat} must be an object {since, reason}`);
        else {
          if (!isStr(p.since) || !/^\d{4}-\d{2}-\d{2}$/.test(p.since)) errors.push(`${pat}.since must be YYYY-MM-DD`);
          if (!isStr(p.reason) || !p.reason.trim()) errors.push(`${pat}.reason is required — a pause with no reason reads as an oversight`);
          for (const k of Object.keys(p)) if (!['since', 'reason'].includes(k)) errors.push(`${pat}: unknown key ${k}`);
        }
      }
      if (a.deploy !== undefined) {
        const d = a.deploy, dat = `${at} (${a.slug || '?'}) deploy`;
        if (!d || typeof d !== 'object' || Array.isArray(d)) { errors.push(`${dat} must be an object`); return; }
        // fatal, not a warning — see DEPLOY_KEYS
        for (const k of Object.keys(d)) if (!DEPLOY_KEYS.has(k)) {
          errors.push(`${dat}: unknown key ${k} — this block becomes ingress an operator applies, so an unrecognised key is refused rather than dropped (known: ${[...DEPLOY_KEYS].join(', ')})`);
        }
        if (!isStrArr(d.hostnames) || !d.hostnames.length) errors.push(`${dat}: hostnames must be a non-empty array of strings`);
        else for (const h of d.hostnames) {
          if (!HOSTNAME_RE.test(h)) errors.push(`${dat}: hostname ${JSON.stringify(h)} is not a valid lowercase DNS name`);
          else if (hostClaims.has(h)) errors.push(`${dat}: hostname '${h}' is already claimed by area '${hostClaims.get(h)}'`);
          else hostClaims.set(h, a.slug || '?');
        }
        // hosting:'pages' = Cloudflare Pages serves the hostnames — no local origin exists, so
        // service is FORBIDDEN with it and required without it. The schema cannot express this
        // conditional (the subset checker implements no if/then, deliberately), so it is enforced
        // HERE and declared in the schema's descriptions.
        if (d.hosting !== undefined && d.hosting !== 'pages') {
          errors.push(`${dat}: hosting, when declared, must be 'pages' — tunnel-hosted areas omit the key`);
        }
        if (d.hosting === 'pages') {
          if (d.service !== undefined) errors.push(`${dat}: hosting 'pages' declares no local origin — remove service (Cloudflare serves these hostnames; deploy.mjs emits no ingress for them)`);
        } else {
          // http(s) origin URL only — deploy.mjs needs a parseable host:port for its probe.
          let svc = null;
          try { if (isStr(d.service)) svc = new URL(d.service); } catch { /* dies below */ }
          if (!svc || (svc.protocol !== 'http:' && svc.protocol !== 'https:')) errors.push(`${dat}: service must be an http(s):// origin URL`);
        }
        // Both booleans required, never defaulted — absence must not read as "no auth needed".
        for (const k of ['public', 'requiresAuth']) if (!isBool(d[k])) errors.push(`${dat}: ${k} (boolean) is required`);
        for (const k of ['originServerName', 'caPool', 'note']) if (d[k] !== undefined && !isStr(d[k])) errors.push(`${dat}: ${k} must be a string`);
        // The path an availability probe should ask for. Defaults to '/'. Declared because a
        // hostname can serve a public front page and gate its app elsewhere, and probing '/'
        // there reports a working gate as an absent one.
        if (d.probePath !== undefined && (!isStr(d.probePath) || !d.probePath.startsWith('/'))) errors.push(`${dat}: probePath must be a string beginning with '/'`);
        // authAt says WHERE the auth layer lives; an unrecognised value must not read as an attestation.
        if (d.authAt !== undefined && d.authAt !== 'origin' && d.authAt !== 'edge') {
          errors.push(`${dat}: authAt must be 'origin' (the service authenticates its own requests) or 'edge' (a proxy/Access policy in front)`);
        }
      }
    });
    // guarded: a non-array `areas` was already reported above; .filter on it would throw.
    if (Array.isArray(reg.areas) && reg.areas.filter((a) => a && a.primary).length > 1) errors.push('areas: more than one area declares primary:true');
  }

  if (reg.projects !== undefined) {
    if (!Array.isArray(reg.projects)) errors.push('projects must be an array');
    else reg.projects.forEach((p, i) => {
      const at = `projects[${i}]`;
      if (!p || typeof p !== 'object' || Array.isArray(p)) { errors.push(`${at} is not an object`); return; }
      for (const k of Object.keys(p)) if (!PROJECT_KEYS.has(k)) warnings.push(`${at} (${p.name || '?'}): unknown key ${k}`);
      if (!isStr(p.name) || !NAME_RE.test(p.name)) errors.push(`${at}: name must match ${NAME_RE}`);
      if (!isStr(p.path) || !p.path.trim()) errors.push(`${at} (${p.name || '?'}): path (string) is required`);
      if (!isStr(p.manifest) && !isStrArr(p.manifest)) errors.push(`${at} (${p.name || '?'}): manifest must be a string or array of strings`);
      if (p.hermeticTest !== undefined) {
        const h = p.hermeticTest;
        if (!h || typeof h !== 'object' || Array.isArray(h)) errors.push(`${at} (${p.name || '?'}): hermeticTest must be an object`);
        else {
          for (const k of Object.keys(h)) if (!HERMETIC_KEYS.has(k)) errors.push(`${at} (${p.name || '?'}): hermeticTest has unknown key ${k} — its steps run, so an unrecognised key is refused`);
          if (h.prepare !== undefined && !isStrArr(h.prepare)) errors.push(`${at} (${p.name || '?'}): hermeticTest.prepare must be an array of strings`);
          if (h.runnerDiskGb !== undefined && !(typeof h.runnerDiskGb === 'number' && h.runnerDiskGb > 0)) errors.push(`${at} (${p.name || '?'}): hermeticTest.runnerDiskGb must be a positive number`);
        }
      }
      // `area` is required once areas[] is declared — no guessed output locations.
      if (reg.areas !== undefined) {
        if (!isStr(p.area)) errors.push(`${at} (${p.name || '?'}): area (string) is required when areas[] is declared`);
        else if (!SLUG_RE.test(p.area)) errors.push(`${at} (${p.name || '?'}): area must match ${SLUG_RE}`);
        // `area === name` is self-evidently own-area; a non-existent area warns (typo) without blocking.
        else if (slugs.size && !slugs.has(p.area) && p.area !== p.name) warnings.push(`${at} (${p.name || '?'}): area '${p.area}' has no areas[] block (typo?)`);
      }
    });
  }
  return { errors, warnings };
}

export { checkSchemaSupport, checkNode };

export function validateAgainstSchema(reg, { path = SCHEMA_PATH } = {}) {
  return validateDocument(reg, { path });
}

// Reads + validates. Throws on unreadable/unparseable/invalid — never a degraded {}. Both
// validators run and both are fatal; `quiet` suppresses the warning print (tests).
export function loadRegistry({ path = registryPath(), schemaPath = SCHEMA_PATH, quiet = false } = {}) {
  // Refuse before announcing: a caller that declared itself scheduled must not proceed on the
  // example at all, and a throw is the only outcome a log-blind caller cannot ignore. `quiet` does
  // NOT suppress this — quiet silences narration, and this is a refusal.
  if (isExampleRegistry(path) && requiresRealRegistry()) {
    throw new Error(
      `registry: refusing to run on the EXAMPLE fleet. ${REQUIRE_REAL_ENV}=1 is set, which declares `
      + 'this a scheduled (non-interactive) caller, and monitor/projects.json is absent at '
      + `${path}. A sweep on the example would complete, publish counts for two demonstration `
      + 'repos, and report success — absence rendered as a clean result. Restore the registry, or '
      + `point CW_REGISTRY at it, or unset ${REQUIRE_REAL_ENV} if a human is genuinely watching.`);
  }
  // Say it before parsing, so the announcement survives a validation failure too.
  if (!quiet && isExampleRegistry(path)) {
    console.warn('registry: monitor/projects.json is ABSENT — loaded monitor/projects.example.json instead.');
    console.warn('registry: this is a DEMONSTRATION fleet. Nothing it declares describes a real repository,');
    console.warn('registry: and any count taken from it is a count of the example, not of this machine.');
  }
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) { throw new Error(`registry unreadable at ${path}: ${e.message}`); }
  let reg;
  try { reg = JSON.parse(raw); }
  catch (e) { throw new Error(`registry is not valid JSON (${path}): ${e.message}`); }
  const { errors, warnings } = validateRegistry(reg);
  const all = [...errors, ...validateAgainstSchema(reg, { path: schemaPath }).errors];
  if (!quiet) for (const w of warnings) console.warn(`registry: ${w}`);
  if (all.length) throw new Error(`registry invalid (${path}):\n  - ${all.join('\n  - ')}`);
  return reg;
}

// ── area resolution ─────────────────────────────────────────────────────────────────────────
// Precedence, most specific first:
//   1. an explicit registry entry whose `name` matches       (declared)
//   2. an area listing the repo in `members[]`               (declared)
//   3. an area whose `prefixes[]` matches the repo name      (declared pattern)
//   4. the repo's own name as a standalone area              (fallback)
// A registry with no areas[] falls back to legacy behaviour so a reverted binary still works.
export function areaOf(name, reg) {
  const areas = reg?.areas || [];
  if (!areas.length) return legacyAreaOf(name, reg);
  const entry = (reg.projects || []).find((p) => p.name === name);
  if (entry?.area) return entry.area;
  for (const a of areas) if ((a.members || []).includes(name)) return a.slug;
  for (const a of areas) if ((a.prefixes || []).some((px) => String(name).startsWith(px))) return a.slug;
  return ownArea(name);
}

// The own-area fallback must yield a single safe path segment; anything else is refused (null),
// and null means "unresolvable scope", never "use the default".
export function ownArea(name) {
  const s = String(name || '');
  return SLUG_RE.test(s) ? s : null;
}

// pre-areas[] behaviour, retained so a reverted binary reads the new registry unchanged.
function legacyAreaOf(name, reg) {
  const entry = (reg?.projects || []).find((p) => p.name === name);
  if (entry?.area) return entry.area;
  return ownArea(name);
}

export const areaBySlug = (slug, reg) => (reg?.areas || []).find((a) => a.slug === slug) || null;
export const areaLabel = (slug, reg) => areaBySlug(slug, reg)?.label || slug;
// report directory for an area slug: declared `out`, else the slug itself. Even a declared `out`
// is re-checked; unresolvable ⇒ null, never a guessed default.
export const areaOut = (slug, reg) => {
  const declared = areaBySlug(slug, reg)?.out;
  // OUT_RE, not SLUG_RE — the re-check of a directory name must accept what the loader accepted.
  if (declared) return OUT_RE.test(declared) ? declared : null;
  return ownArea(slug);
};
export const primaryArea = (reg) => (reg?.areas || []).find((a) => a.primary) || (reg?.areas || [])[0] || null;
export const allAreas = (reg) => (reg?.areas || []).map((a) => a.slug);

// ── hostname → area → repos ─────────────────────────────────────────────────────────────────
// The exposure join as a primitive. An area with zero repos is `not-scanned`, never "clean" —
// callers must branch on `status`, never on `repos.length`.
export const AREA_STATUS = Object.freeze({
  MAPPED: 'mapped',            // >=1 repo resolves here
  NOT_SCANNED: 'not-scanned',  // declared, nothing resolves into it — a loud void, never clean
  UNMAPPED: 'unmapped',        // unknown identifier — never attributed to a project
});

// The repo → area rule, stated once: a resolved repo carries its declaring entry's area.
export const repoArea = (repo, reg) => (repo && repo.area) || areaOf(repo?.name, reg);

// hostname -> the area slug that DECLARES it, else null — never attributed by name similarity.
export function areaOfHost(hostname, reg) {
  const h = String(hostname ?? '').trim().toLowerCase();
  if (!h) return null;
  for (const a of reg?.areas || []) {
    if ((a.deploy?.hostnames || []).some((x) => String(x).toLowerCase() === h)) return a.slug || null;
  }
  return null;
}

// Every declared hostname with its area and origin, in declaration order.
export function deployHosts(reg) {
  const out = [];
  for (const a of reg?.areas || []) {
    const d = a.deploy;
    if (!d) continue;
    for (const hostname of d.hostnames || []) {
      out.push({
        hostname, area: a.slug, service: d.service || null,
        public: d.public === true, requiresAuth: d.requiresAuth === true, authAt: d.authAt || null,
      });
    }
  }
  return out;
}

// area slug -> { area, declared, out, repos, count, status, reason }.
// `repos` is required (resolveRepos(reg, …).repos), never defaulted to [] — a forgotten argument
// must not read as "this area has no repos".
export function areaRepos(slug, reg, { repos } = {}) {
  if (!Array.isArray(repos)) {
    throw new TypeError('areaRepos: `repos` is required — pass resolveRepos(reg, …).repos. ' +
      'Defaulting it would report every area as not-scanned and make a forgotten argument look like a finding.');
  }
  const area = slug == null ? '' : String(slug);
  const declared = areaBySlug(area, reg);
  // Refused like ownArea(): an area identifier reaches reports/<out>/ and the panel's DOM.
  if (!SLUG_RE.test(area)) {
    return { area: area || null, declared: false, out: null, repos: [], count: 0,
      status: AREA_STATUS.UNMAPPED, reason: `'${area}' is not a valid area slug (${SLUG_RE})` };
  }
  const mine = repos.filter((r) => repoArea(r, reg) === area);
  if (mine.length) {
    return { area, declared: !!declared, out: areaOut(area, reg), repos: mine, count: mine.length,
      status: AREA_STATUS.MAPPED, reason: `${mine.length} repo(s) resolve to area '${area}'` };
  }
  if (declared) {
    return { area, declared: true, out: areaOut(area, reg), repos: [], count: 0,
      status: AREA_STATUS.NOT_SCANNED,
      reason: `area '${area}' is declared${declared.deploy ? ' (deploy-only: it publishes hostnames but declares no code)' : ''} and NO repo resolves into it — nothing scans it, so nothing is known. This is not "clean".` };
  }
  return { area, declared: false, out: null, repos: [], count: 0, status: AREA_STATUS.UNMAPPED,
    reason: `no areas[] block declares '${area}' and no repo resolves into it` };
}

// The full join: hostname -> publishing area + the repos whose findings describe it. Inherits
// areaRepos' status.
export function reposForHost(hostname, reg, { repos } = {}) {
  const h = String(hostname ?? '').trim().toLowerCase();
  const area = areaOfHost(h, reg);
  if (!area) {
    return { hostname: h || null, area: null, deploy: null, out: null, repos: [], count: 0,
      status: AREA_STATUS.UNMAPPED,
      reason: `no areas[].deploy.hostnames entry claims '${h}' — an undeclared hostname is never attributed to a project` };
  }
  const r = areaRepos(area, reg, { repos });
  const d = areaBySlug(area, reg)?.deploy || null;
  return {
    hostname: h, area, out: r.out, repos: r.repos, count: r.count, status: r.status, reason: r.reason,
    deploy: d ? { service: d.service || null, public: d.public === true, requiresAuth: d.requiresAuth === true, authAt: d.authAt || null } : null,
  };
}
