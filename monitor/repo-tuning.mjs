// monitor/repo-tuning.mjs — the depth and intensity ONE repository is scanned at, and why.
//
// One resolver for the runner, the sweep and the panel. A repository listed in repoTuning uses its
// own value for each field it sets and the fleet value for the rest; the answer always names which,
// because "depth 2" means something different when it is this repository's choice and when it is
// the fleet's.
//
// Read at CALL time, like every settings consumer, so a test that sets CW_REPO_TUNING or
// CW_SETTINGS after import still governs the answer.

import { getSetting, readSettingsStore } from './settings.mjs';

/**
 * @param {string|null} repo  the registry name (CW_REPO_SLUG), or null for the fleet value alone
 * @returns {{repo, depth:{value,source,fleet}, intensity:{value,source,fleet}, overridden:boolean, notes:string[]}}
 */
export function repoLevels(repo, { store = readSettingsStore() } = {}) {
  const fleetDepth = getSetting('scanDepth', { store });
  const fleetIntensity = getSetting('scanIntensity', { store });
  const table = getSetting('repoTuning', { store });
  const notes = [...fleetDepth.notes, ...fleetIntensity.notes, ...table.notes];
  if (table.storeError) notes.push(`repoTuning: ${table.storeError} — every repository follows the fleet values`);
  const rows = table.value && typeof table.value === 'object' ? table.value : null;
  const own = repo && rows && Object.prototype.hasOwnProperty.call(rows, repo) ? rows[repo] : null;
  const pick = (field, fleet) => (own && own[field] !== undefined
    ? { value: own[field], source: `repository (${table.source})`, fleet: fleet.value }
    : { value: fleet.value, source: `fleet (${fleet.source})`, fleet: fleet.value });
  return {
    repo: repo || null,
    depth: pick('depth', fleetDepth),
    intensity: pick('intensity', fleetIntensity),
    overridden: !!own,
    notes,
  };
}

/** Every repository with its own entry, as the store holds it. */
export function repoTuningTable({ store = readSettingsStore() } = {}) {
  const t = getSetting('repoTuning', { store });
  return { value: t.value || {}, source: t.source, storeError: t.storeError, setAt: t.setAt ?? null, setBy: t.setBy ?? null };
}
