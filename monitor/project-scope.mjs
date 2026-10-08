// commitwork monitor — shared project grouping for the multi-project output area. Grouping rules
// live in the REGISTRY (projects.json areas[]), never hardcoded here.
//   projectOf(name)    -> area LABEL (picker identity, e.g. 'ClientA')
//   projectSlug(label) -> area SLUG  (route/artifact identity, e.g. 'clientA')

import { loadRegistry, areaOf, areaBySlug, SLUG_RE } from './registry.mjs';

// Read once per process. Best-effort by design: labelling helpers must not blank a report —
// a registry problem falls back to the repo's own name.
let REG;
function reg() {
  if (REG === undefined) { try { REG = loadRegistry({ quiet: true }); } catch { REG = null; } }
  return REG;
}
// test seam: inject a registry (or null) without touching disk
export function _setRegistry(r) { REG = r; }

// Back-compat export — now DERIVED from the registry's declared members
export function fleetInfra() {
  return new Set((reg()?.areas || []).flatMap((a) => a.members || []));
}
export const FLEET_INFRA = fleetInfra();

// repo name -> area LABEL. Falls back to the repo's own name, so a standalone repo (client-d,
// internalB-dev, anything root-discovered) is its own project — unchanged behaviour.
export function projectOf(name) {
  const r = reg();
  if (!r) return name;
  const slug = areaOf(name, r);
  return areaBySlug(slug, r)?.label || slug || name;
}

// area LABEL (or slug) -> route/artifact slug. Declared areas resolve through the registry;
// anything else is lowercased and made URL-safe rather than special-cased by name.
export function projectSlug(p) {
  const r = reg();
  const declared = (r?.areas || []).find((a) => a.label === p || a.slug === p);
  if (declared) return declared.slug;
  const s = String(p || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return SLUG_RE.test(s) ? s : '';
}

// repo name -> area SLUG (skips the label round-trip)
export function areaSlugOf(name) {
  const r = reg();
  return r ? areaOf(name, r) : String(name || '');
}
