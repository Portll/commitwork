// BOLA-testing posture of the fleet for the admin panel's BOLA tab: which areas declare a `bola`
// block, whether each credential set is configured, and the latest run's evidence. Readiness
// judges DECLARED-or-SET only (no keychain probe on the poll path — the real resolve happens in
// bin/bola-run.mjs). Fail-closed: an unparseable manifest/evidence file is a visible state, never
// a clean result; only ENOENT reads as "never run".
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { bolaManifestDirFor } from './store-paths.mjs';
import { registry, CW, outDirFor } from './area.mjs';
import { secretNames } from '../bin/bola-run.mjs';
import { loadTable } from '../lib/secrets.mjs';

const EVIDENCE_FILE = 'bola-latest.json';
// Env names that are supplied by the run (the target), not stored as secrets — so an area's `base`
// declaration satisfies them and they never read as "missing credential".
const RUNTIME_PROVIDED = new Set(['CW_TARGET_URL']);

// Where a bola manifest lives, and where an area's latest run is persisted. The operator's manifests
// are private records (monitor/private/bola/<name>.json, CW_BOLA_MANIFEST_DIR, read at call time): a
// manifest names the target's realm, accounts and endpoints. manifests/bola/ ships only the synthetic
// example and is consulted second, so a registry may name it. Absent from both, the private path is
// the one reported missing.
export const manifestDir = () => bolaManifestDirFor(CW);
export const shippedManifestDir = () => join(CW, 'manifests', 'bola');
export const manifestPathFor = (name) => {
  const own = join(manifestDir(), `${name}.json`);
  if (existsSync(own)) return own;
  const shipped = join(shippedManifestDir(), `${name}.json`);
  return existsSync(shipped) ? shipped : own;
};
export const evidencePathFor = (slug, reg = registry()) => join(outDirFor(slug, reg), EVIDENCE_FILE);

// The areas that DECLARE a bola block — the only ones the panel offers a run for.
export function bolaAreas(reg = registry()) {
  return (reg.areas || [])
    .filter((a) => a && a.bola && a.bola.manifest && a.bola.base)
    .map((a) => ({ slug: a.slug, label: a.label || a.slug, out: a.out || a.slug, manifest: a.bola.manifest, base: a.bola.base, note: a.bola.note || null }));
}

function loadBolaManifest(name) {
  // Mirrors bin/bola-run.mjs loadManifest's unwrap: a #bola block inside a larger file, or a standalone.
  const raw = readFileSync(manifestPathFor(name), 'utf8'); // throws ENOENT → caller turns into a visible state
  const m = JSON.parse(raw);
  return m && m.bola && typeof m.bola === 'object' && !Array.isArray(m.bola) ? m.bola : m;
}

// Configured? Every secret the manifest names is either set in the environment or declared in the
// local secrets table (a keychain ref exists). Returns the full picture so the UI can name what's
// missing rather than just going red.
export function readiness(area, { env = process.env, table = null } = {}) {
  let manifest;
  try { manifest = loadBolaManifest(area.manifest); }
  catch (e) {
    const why = e && e.code === 'ENOENT' ? `bola manifest ${manifestPathFor(area.manifest)} is missing` : `manifest could not be read: ${e.message}`;
    return { ready: false, blocked: true, reason: why, needed: [], missing: [], present: [] };
  }
  const t = table || safeTable();
  if (t.error) return { ready: false, blocked: true, reason: `the local secrets store could not be read (${t.error}), so credential readiness cannot be judged`, needed: [], missing: [], present: [] };
  const needed = secretNames(manifest);
  const present = [], missing = [];
  for (const name of needed) {
    // CW_TARGET_URL is the probe TARGET, not a credential — the area's `base` declaration satisfies it
    if (RUNTIME_PROVIDED.has(name) && area.base) present.push({ name, source: 'base' });
    else if (env[name] !== undefined && env[name] !== '') present.push({ name, source: 'env' });
    else if (t.secrets[name]) present.push({ name, source: 'keychain' });
    else missing.push({ name, reason: 'undeclared' });
  }
  const ready = missing.length === 0 && needed.length > 0;
  return {
    ready, blocked: !ready,
    reason: !needed.length ? 'the manifest names no secrets — nothing to configure (an all-anonymous matrix cannot test cross-identity access)'
      : ready ? null : `${missing.length} secret(s) not yet stored: ${missing.map((m) => m.name).join(', ')} — run \`node bin/secrets.mjs set <NAME>\` for each`,
    needed, present, missing,
  };
}

function safeTable() {
  try { return loadTable(); }
  catch (e) { return { secrets: {}, error: String(e && e.message || e) }; }
}

// The latest persisted run for an area. ENOENT ⇒ never run; parse failure ⇒ unreadable (fail-closed).
export function latestEvidence(slug, reg = registry()) {
  const path = evidencePathFor(slug, reg);
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) { if (e && e.code === 'ENOENT') return { present: false, path }; return { present: false, unreadable: true, error: String(e.message), path }; }
  let j;
  try { j = JSON.parse(raw); }
  catch (e) { return { present: true, invalid: true, error: `not valid JSON: ${e.message}`, path }; }
  // Surface exactly what the tab renders; keep it small (no per-probe `tested[]` on the poll).
  return {
    present: true, path,
    generatedAt: j.generatedAt || null,
    base: j.base || (j.summary && j.summary.base) || null,
    ran: j.ran !== false && !j.skipped,
    skipped: Boolean(j.skipped),
    reason: j.reason || (j.summary && j.summary.reason) || null,
    summary: j.summary || null,
    findings: Array.isArray(j.findings) ? j.findings : [],
    actors: Array.isArray(j.actors) ? j.actors : [],
    voids: Array.isArray(j.voids) ? j.voids : [],
  };
}

// The whole tab payload: one row per declared area, with readiness and the latest evidence.
export function fleet(reg = registry(), { env = process.env } = {}) {
  const table = safeTable();
  return bolaAreas(reg).map((area) => {
    const ready = readiness(area, { env, table: table.error ? null : table });
    return { ...area, readiness: ready, evidence: latestEvidence(area.slug, reg) };
  });
}
