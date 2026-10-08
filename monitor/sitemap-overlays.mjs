// commitwork sitemap — v2 overlay layer (report-reading), attached after the pure harvest:
// §4 airBridges (io apertures -> service corridors; unresolved kept dangling, never dropped),
// §6 vulnerabilities (trivy image JSON -> scope:'container'; races findings -> 'function'/'file'),
// §7 authz access. Additive + provenance-stamped; caps surface via truncation.droppedVulns.
// Each overlay resolves THIS manifest's area through the registry; nothing-to-read returns a
// NAMED reason, never a bare no-scan.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { registry, outNameFor, batchCoversArea } from './area.mjs';
import { areaBySlug } from './registry.mjs';

export const MAX_VULNS = 4000; // overlay cap (per manifest) — overflow -> truncation.droppedVulns

const SEV = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', UNKNOWN: 'unknown',
  critical: 'critical', high: 'high', medium: 'medium', low: 'low' };
const normSev = (s) => SEV[s] || 'unknown';

// ── image ref -> service id: match the basename tail against service ids and an infra alias
// table. `prefixes` are the area's declared name prefixes (registry areas[].prefixes).
const INFRA_ALIASES = { keycloak: 'buildout', consul: 'buildout', rabbitmq: 'buildout', postgres: 'buildout',
  seaweedfs: 'buildout', tempo: 'buildout', alpine: 'buildout', 'node-dev': 'buildout', zipkin: 'buildout',
  localstack: 'buildout', supabase: 'buildout' };
function imageToService(imageRef, serviceIds, prefixes = []) {
  // imageRef e.g. quay.io/keycloak/keycloak:26.7.0  |  clientA/postgres:18.4-...  |  testbed-user-service
  const noTag = imageRef.replace(/@sha256:[0-9a-f]+$/i, '').replace(/:[^/]+$/, '');
  const base = noTag.slice(noTag.lastIndexOf('/') + 1); // last path segment
  const m = base.match(/^testbed-(.+)$/);               // testbed-user-service -> <prefix>user-service? try each
  const candidates = [];
  if (m) { candidates.push(m[1], ...prefixes.map((px) => `${px}${m[1]}`)); }
  candidates.push(base);
  for (const c of candidates) if (serviceIds.has(c)) return c;
  // partial: some service ids embed the tail (svc-user-service contains 'user-service')
  const tail = m ? m[1] : base;
  for (const id of serviceIds) if (id === tail || id.endsWith(`-${tail}`)) return id;
  return INFRA_ALIASES[base] && serviceIds.has(INFRA_ALIASES[base]) ? INFRA_ALIASES[base] : null;
}

// Newest images-* dir, area dir first then reports root (image scans are registry-global today).
function newestImagesDir(reportsDir, areaDir) {
  for (const [base, scope] of [[areaDir, 'area'], [reportsDir, 'global']]) {
    if (!base || !existsSync(base)) continue;
    const dirs = readdirSync(base).filter((d) => /^images-\d/.test(d)).sort().reverse();
    for (const d of dirs) {
      const full = join(base, d);
      try { if (readdirSync(full).some((f) => f.endsWith('.json'))) return { dir: full, tag: d, scope }; } catch {}
    }
  }
  return null;
}

// ── §6a trivy image findings -> scope:'container' vulnerabilities ────────────────────────────
// Attribution is earned: a finding attaches only where its image ref resolves to a service in
// THIS manifest; anything else is counted as `unattributed` and reported.
function trivyVulns(reportsDir, areaDir, serviceIds, prefixes, push) {
  const found = newestImagesDir(reportsDir, areaDir);
  if (!found) return { scanned: false, reason: `no images-* scan under ${areaDir ? 'the area dir or ' : ''}the reports root` };
  let images = 0, unattributed = 0;
  for (const f of readdirSync(found.dir).sort()) {
    if (!f.endsWith('.json')) continue;
    let j; try { j = JSON.parse(readFileSync(join(found.dir, f), 'utf8')); } catch { continue; }
    if (!j || !Array.isArray(j.Results)) continue; // not a trivy image report
    const imageRef = j.ArtifactName || (j.Metadata && (j.Metadata.RepoTags || [])[0]) || f.replace(/\.json$/, '');
    const svc = imageToService(imageRef, serviceIds, prefixes);
    images++;
    if (!svc && found.scope === 'global') { // this image belongs to no service in this manifest
      unattributed += j.Results.reduce((n, r) => n + (r.Vulnerabilities || []).length, 0);
      continue;
    }
    for (const r of j.Results) for (const v of r.Vulnerabilities || []) {
      push({
        id: v.VulnerabilityID,
        severity: normSev(v.Severity),
        target: { scope: 'container', ...(svc && { service: svc }), ref: imageRef },
        ...(v.PkgName && { pkg: v.PkgName }),
        ...(v.InstalledVersion && { installed: v.InstalledVersion }),
        ...(v.FixedVersion && { fixed: v.FixedVersion }),
        ...(v.Title && { title: String(v.Title).slice(0, 200) }),
        source: `trivy:${found.tag}`,
        provenance: 'inventory', // parsed from a real SBOM scan, but not tied to a source AST line
      });
    }
  }
  return { scanned: true, images, tag: found.tag, scope: found.scope, unattributed };
}

// build a per-service resolver: service-relative path -> [{name,line,endLine}] for function pinning.
// endLine comes from the v2 span object ({startLine,endLine,lines}); falls back to line when absent.
function functionIndex(service) {
  const byPath = new Map();
  (function walk(ns) { for (const n of ns || []) {
    if (n.children) { walk(n.children); continue; }
    if (!n.symbols) continue;
    const fns = n.symbols.filter((s) => s.type === 'function' && s.line)
      .map((s) => ({ name: s.name, line: s.line, endLine: (s.span && s.span.endLine) || s.line }));
    if (fns.length) byPath.set(n.path, fns);
  } })(service.tree);
  return byPath;
}

// ── §6b source-scanner findings (races findings.json) -> scope:'function'|'file' ──────────────
// Strip f.file to service-relative, pin to the symbol whose span contains f.line, else file scope.
// areaDir resolves slug -> out through the same resolver races.mjs writes with, so no drift.
function raceVulns(areaDir, manifestByService, push) {
  const racesRoot = join(areaDir, 'races', 'output');
  if (!existsSync(racesRoot)) return { scanned: false, reason: `no races output at ${racesRoot}` };
  const runs = readdirSync(racesRoot).filter((d) => /^\d/.test(d)).sort().reverse();
  let findingsFile = null, tag = null;
  for (const run of runs) { const fp = join(racesRoot, run, 'findings.json'); if (existsSync(fp)) { findingsFile = fp; tag = run; break; } }
  if (!findingsFile) return { scanned: false, reason: `${runs.length} races run(s) under ${racesRoot} but none carries findings.json` };
  let j; try { j = JSON.parse(readFileSync(findingsFile, 'utf8')); } catch { return { scanned: false, reason: `races findings.json unreadable: ${findingsFile}` }; }
  const fnIdxCache = new Map();
  let mapped = 0, unmapped = 0;
  for (const f of j.findings || []) {
    const svc = manifestByService.get(f.module);
    if (!svc) { unmapped++; continue; }
    // derive service-relative path: strip the fleet-root/module prefix from the absolute file
    let rel = f.file;
    const marker = `/${f.module}/`;
    const at = rel.indexOf(marker);
    if (at >= 0) rel = rel.slice(at + marker.length);
    let scope = 'file', ref = rel;
    if (!fnIdxCache.has(f.module)) fnIdxCache.set(f.module, functionIndex(svc));
    const fns = fnIdxCache.get(f.module).get(rel);
    if (fns && f.line) {
      // pin to the function whose span [line, endLine] contains f.line (symbols are line-sorted).
      // ref becomes {file,symbol} (object) at function scope — renderer resolves position from it.
      const hit = fns.filter((s) => s.line <= f.line && s.endLine >= f.line).sort((a, b) => b.line - a.line)[0];
      if (hit) { scope = 'function'; ref = { file: rel, symbol: hit.name }; }
    }
    mapped++;
    push({
      id: f.ruleId && f.ruleId.includes('.') ? f.ruleId.split('.').pop() : (f.ruleId || 'finding'),
      severity: normSev(f.severity),
      target: { scope, service: f.module, ref },
      ...(f.message && { title: String(f.message).slice(0, 200) }),
      source: `${f.engine || 'scanner'}:races`,
      provenance: 'heuristic', // source-scoped, pattern-derived (semgrep/spotbugs races tier)
    });
  }
  return { scanned: true, mapped, unmapped, tag };
}

// ── §7 authz-bola access overlay: attach io[].access verdicts from bin/authz-bola.mjs ──────────
// Gateway paths and in-service routes are different coordinate systems, so pinning is
// conservative: a confident token match attaches to a specific io entry, else the verdict attaches
// at service scope — a wrong "bypassed" label is worse than none. Unmatched findings are counted.
// A cross-tenant WRITE keeps its own (more severe) status.
const AUTHZ_STATUS = { 'unauth-exposure': 'bypassed', 'header-trust': 'bypassed', 'cross-tenant-read': 'bypassed', 'cross-tenant-write': 'cross-tenant-write', 'blocked': 'blocked' };
// last path segment(s), lowercased, alnum only — the comparable token of a route.
function pathTokens(p) {
  return String(p || '').split(/[/?#]/).filter(Boolean)
    .map((s) => s.replace(/\{[^}]*\}/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase()).filter(Boolean);
}
// Sweep batches newest first, split by whether they provably cover this area (the decision is
// area.mjs's batchCoversArea). A batch with no area in its manifest is UNKNOWN scope.
function areaBatches(reportsDir, target) {
  const covers = [], unknown = [];
  let names = [];
  try { names = readdirSync(reportsDir); } catch { return { covers, unknown }; }
  for (const name of names.filter((d) => d.startsWith('sweep-')).sort().reverse()) {
    const dir = join(reportsDir, name);
    try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
    let manifest = null;
    try { manifest = JSON.parse(readFileSync(join(dir, 'batch-manifest.json'), 'utf8')); } catch { /* adhoc/pre-manifest batch */ }
    const v = batchCoversArea({ name, dir, manifest }, target);
    if (v === true) covers.push({ name, dir });
    else if (v === null) unknown.push({ name, dir });
  }
  return { covers, unknown };
}
// The newest batch IN THIS AREA carrying an authz-bola.json.
function newestSweepDir(reportsDir, target) {
  const hasAuthz = (b) => { try { return readdirSync(b.dir).some((s) => { try { return existsSync(join(b.dir, s, 'authz-bola.json')); } catch { return false; } }); } catch { return false; } };
  const { covers, unknown } = areaBatches(reportsDir, target);
  for (const b of covers) if (hasAuthz(b)) return { dir: b.dir, tag: b.name, scope: 'area' };
  for (const b of unknown) if (hasAuthz(b)) return { dir: b.dir, tag: b.name, scope: 'unknown' };
  return null;
}
function authzAccess(reportsDir, byService, target) {
  const found = newestSweepDir(reportsDir, target);
  if (!found) return { scanned: false, reason: `no sweep batch covering area '${target.slug}' carries an authz-bola.json` };
  let pinned = 0, serviceScoped = 0, unmatched = 0, filesRead = 0;
  for (const svcDir of readdirSync(found.dir).sort()) {
    const fp = join(found.dir, svcDir, 'authz-bola.json');
    if (!existsSync(fp)) continue;
    let j; try { j = JSON.parse(readFileSync(fp, 'utf8')); } catch { continue; }
    filesRead++;
    const findings = Array.isArray(j.findings) ? j.findings : [];
    if (!findings.length) continue;                       // ran, nothing to attach (the common case)
    // resolve the service this sweep dir belongs to (dir name is the report project's svc dir)
    let svc = byService.get(svcDir);
    if (!svc) { for (const [id, s] of byService) if (id === svcDir || id.endsWith(`-${svcDir}`) || svcDir.endsWith(`-${id}`)) { svc = s; break; } }
    if (!svc) { unmatched += findings.length; continue; } // finding for a service not in this manifest
    svc.io = Array.isArray(svc.io) ? svc.io : [];
    for (const f of findings) {
      const status = AUTHZ_STATUS[f.type] || 'unknown';
      const access = { status, direction: 'inbound', severity: normSev(f.severity),
        ...(f.detail && { detail: String(f.detail).slice(0, 200) }), source: 'authz-bola.json', provenance: 'authz-bola' };
      const ft = pathTokens(f.path);
      // confident match: the finding's last path token equals an http io entry's last route token.
      let target = null;
      if (ft.length) {
        const key = ft[ft.length - 1];
        for (const e of svc.io) {
          if (e.kind !== 'http') continue;
          const et = pathTokens(e.detail); if (!et.length) continue;
          if (et[et.length - 1] === key) { target = e; break; }
        }
      }
      if (target) { target.access = access; pinned++; }
      else {
        // service-scope fallback: a synthetic io-less marker so the verdict is never lost nor mis-pinned.
        svc.io.push({ kind: 'http', detail: f.path || '(gateway path)', count: 1, source: 'authz-bola', access });
        serviceScoped++;
      }
    }
  }
  return { scanned: true, tag: found.tag, scope: found.scope, filesRead, pinned, serviceScoped, unmatched };
}

// ── §4 airBridges: resolve secure/cross-service io -> service->service corridors ──────────────
const BRIDGE_KINDS = new Set(['grpc', 'amqp', 'kafka', 'oauth', 'client']);
function buildAirBridges(services, prefixes = []) {
  const ids = new Set(services.map((s) => s.id));
  // index amqp/kafka listeners by service so a publisher can resolve to a listener when the
  // broker/exchange is the same (we only know 'listener'/'publisher' generically, so a publisher
  // resolves to ANY listener of the same kind in the fleet — heuristic, provenance-stamped).
  const listenersByKind = { amqp: [], kafka: [] };
  for (const s of services) for (const io of s.io || []) {
    if ((io.kind === 'amqp' || io.kind === 'kafka') && /listener/i.test(io.detail)) listenersByKind[io.kind].push(s.id);
  }
  const edges = new Map(); // `${from}|${kind}|${endpoint}|${to}` -> count
  const addEdge = (from, kind, endpoint, to, count) => {
    const key = `${from}|${kind}|${endpoint}|${to == null ? '' : to}`;
    const e = edges.get(key);
    if (e) { e.count += count; return; }
    edges.set(key, { from, to, kind, endpoint, resolved: to != null, provenance: 'heuristic', count });
  };
  for (const s of services) for (const io of s.io || []) {
    if (!BRIDGE_KINDS.has(io.kind)) continue;
    if (io.kind === 'client') {
      // feign client detail IS the target service name; declared prefixes resolve the rest
      const t = io.detail;
      const to = ids.has(t) ? t
        : [...ids].find((id) => id === t || id.endsWith(`-${t}`) || prefixes.some((px) => id === `${px}${t}`)) || null;
      addEdge(s.id, 'client', t, to, io.count || 1);
    } else if (io.kind === 'grpc') {
      const t = io.detail; // proto service name — try to match a service id, else dangling
      const to = [...ids].find((id) => id.toLowerCase().includes(String(t).toLowerCase())) || null;
      addEdge(s.id, 'grpc', String(t), to, io.count || 1);
    } else if (io.kind === 'oauth') {
      // Prefer 'buildout' (where the IdP image lives), else a *-keycloak-plugin; a *-theme is NOT
      // the IdP. Unresolved stays dangling, never mis-pointed.
      const idp = (ids.has('buildout') && 'buildout')
        || [...ids].find((id) => /keycloak-plugin|(^|-)idp($|-)/.test(id))
        || null;
      addEdge(s.id, 'oauth', io.detail || 'idp', idp, io.count || 1);
    } else if (io.kind === 'amqp' || io.kind === 'kafka') {
      if (/publisher/i.test(io.detail)) {
        const targets = listenersByKind[io.kind].filter((t) => t !== s.id);
        if (targets.length) for (const t of targets) addEdge(s.id, io.kind, io.detail, t, io.count || 1);
        else addEdge(s.id, io.kind, io.detail, null, io.count || 1); // publisher with no known listener = dangling
      }
      // listeners are the destination of the corridor — not a corridor source on their own
    }
  }
  return [...edges.values()].sort((a, b) =>
    a.from.localeCompare(b.from) || a.kind.localeCompare(b.kind) || String(a.endpoint).localeCompare(String(b.endpoint)));
}

// build the manifest-level logSinks[] trunk-line rollup from each service's per-file node.logging.
// Derived, not re-scanned — so it can never disagree with the tree. Audit = any audit-cat file.
function buildLogSinks(services) {
  const out = [];
  for (const s of services) {
    let files = 0, count = 0, audit = false;
    (function walk(ns) { for (const n of ns || []) {
      if (n.children) { walk(n.children); continue; }
      if (n.logging) { files++; count += n.logging.count; if (n.logging.category === 'audit') audit = true; }
    } })(s.tree);
    if (!count) continue; // service with no logging omitted from the trunk list (per-service still honest)
    out.push({ service: s.id, label: `${count} logs · ${files} files${audit ? ' · audit' : ''}`, count, files, ...(audit && { audit: true }) });
  }
  return out.sort((a, b) => b.count - a.count || a.service.localeCompare(b.service));
}

// PUBLIC: mutate `manifest` in place (logSinks + airBridges + vulnerabilities + merged truncation).
// `area` = the slug whose report artifacts describe this manifest (defaults to `project`);
// `reportsDir` = the reports root. The reason for a skip is always named; a project only ever
// reads its own area's artifacts.
export function attachOverlays(manifest, { reportsDir, project, area, reg } = {}) {
  const services = manifest.services || [];
  const serviceIds = new Set(services.map((s) => s.id));
  const byService = new Map(services.map((s) => [s.id, s]));
  const proj = project || manifest.project;
  const REG = reg || registry();
  const slug = area || proj;
  // The area's report dir — declared, never inferred; unresolvable is a named skip, not a fallback.
  let outName = null, outErr = null;
  try { outName = outNameFor(slug, REG); } catch (e) { outErr = e.message; }
  const areaDir = outName ? join(reportsDir, outName) : null;
  const prefixes = (areaBySlug(slug, REG) || {}).prefixes || [];

  // §5 top-level sewer trunk lines (own-tree derived — every project)
  manifest.logSinks = buildLogSinks(services);
  // §4 air bridges (own-io derived — every project)
  manifest.airBridges = buildAirBridges(services, prefixes);

  // §6 — vulnerability overlay, read from this area's own artifacts.
  const vulns = []; let droppedVulns = 0;
  const push = (v) => { if (vulns.length >= MAX_VULNS) { droppedVulns++; return; } vulns.push(v); };
  const noArea = { scanned: false, reason: `area '${slug}' has no resolvable report dir — ${outErr || 'unknown'}` };
  const t = trivyVulns(reportsDir, areaDir, serviceIds, prefixes, push);
  const r = areaDir ? raceVulns(areaDir, byService, push) : noArea;
  // §7 authz-bola access verdicts -> io[].access (MUTATES service.io in place; own gating). Attaches
  // nothing until real findings exist (empty-until-probed, honest). See authzAccess() header.
  const a = areaDir ? authzAccess(reportsDir, byService, { slug, dir: areaDir }) : noArea;
  // §6 chain: link vulns that share a package (trivy) so the renderer can draw CVE clusters
  const byPkg = new Map();
  for (const v of vulns) if (v.pkg) { if (!byPkg.has(v.pkg)) byPkg.set(v.pkg, []); byPkg.get(v.pkg).push(v.id); }
  for (const v of vulns) if (v.pkg) {
    const chain = byPkg.get(v.pkg).filter((id) => id !== v.id);
    if (chain.length) v.chain = [...new Set(chain)].slice(0, 32);
  }
  vulns.sort((a, b) => {
    const rank = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };
    return (rank[a.severity] - rank[b.severity]) || String(a.id).localeCompare(String(b.id));
  });
  // Emit the array when a scan ran (empty = "scanned, nothing to overlay"); absence = no artifact.
  // The WHY rides in `stats` — the schema is additionalProperties:false, so the caller prints it.
  if (t.scanned || r.scanned) manifest.vulnerabilities = vulns;

  if (droppedVulns) {
    manifest.truncation = manifest.truncation || { note: 'caps applied — dropped counts shown, not hidden' };
    manifest.truncation.droppedVulns = (manifest.truncation.droppedVulns || 0) + droppedVulns;
  }
  return { manifest, stats: { area: slug, areaDir, trivy: t, races: r, authz: a, vulns: vulns.length, airBridges: manifest.airBridges.length, droppedVulns } };
}
