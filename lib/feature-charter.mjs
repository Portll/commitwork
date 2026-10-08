// lib/feature-charter.mjs — reads manifests/feature-charter.json for the two consumers that need
// it: bin/feature-census.mjs (classes) and lib/feature-flags.mjs (which experimental flag owns which
// entry point). One reader and one route-key function, so the census and the runtime gate cannot
// file the same route under different groups.
//
// env (read at CALL time): CW_FC_CHARTER — the charter path, shared with the census on purpose.
import { readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const charterPath = () => {
  const v = process.env.CW_FC_CHARTER;
  return resolve(typeof v === 'string' && v !== '' ? v : join(ROOT, 'manifests', 'feature-charter.json'));
};

// Kebab: the id is a stored key in the settings store and the stem of CW_FEATURE_<ID>.
export const FLAG_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

// What can switch a flag off at runtime, per surface. cli-script has no gate: a script is run by
// path, so its flag is a declaration the census reports and nothing enforces.
export const ENFORCED_BY = Object.freeze({
  'http-route': 'admin/serve.mjs route dispatcher',
  'ui-view': 'panel navigation',
  'cli-command': 'commitwork CLI',
  'mcp-tool': 'mcp/server.mjs tool list',
  job: 'monitor/install-agents.mjs',
});

/** The census's http-route grouping key, from a path: `/api/<seg>` → seg, else the first segment. */
export function routeKey(path) {
  const segs = String(path || '').split('?')[0].split('/').filter(Boolean);
  return segs[0] === 'api' ? (segs[1] || '(root)') : (segs[0] || '(root)');
}

/**
 * The declared flags, checked. Throws on a malformed declaration: a flag the charter names and the
 * gate cannot resolve is a charter defect, never "no flags".
 * @returns {Map<string, {id, label, why, groups: object[], keys: Record<string, string[]>}>}
 */
export function flagTable(charter) {
  const out = new Map();
  const decl = charter && charter.experimentalFlags;
  if (decl !== undefined && (!decl || typeof decl !== 'object' || Array.isArray(decl))) {
    throw new Error('feature-charter: experimentalFlags must be an object of {id: {label, why}}');
  }
  for (const [id, f] of Object.entries(decl || {})) {
    if (!FLAG_ID_RE.test(id)) throw new Error(`feature-charter: flag id ${JSON.stringify(id)} is not kebab-case (2-40 chars)`);
    if (!f || typeof f.label !== 'string' || !f.label || typeof f.why !== 'string' || !f.why) {
      throw new Error(`feature-charter: flag ${id} needs a label and a why`);
    }
    if (f.views !== undefined && !(Array.isArray(f.views) && f.views.every((v) => typeof v === 'string' && v))) {
      throw new Error(`feature-charter: flag ${id} views must be an array of panel view ids`);
    }
    // `views` on the flag itself: a panel view with no charter group of its own (a flag gated in
    // code through featureEnabled/gateFeature) is still hidden from navigation when off.
    out.set(id, { id, label: f.label, why: f.why, groups: [], keys: f.views && f.views.length ? { view: [...f.views] } : {} });
  }
  for (const g of (charter && charter.groups) || []) {
    const has = g.flag !== undefined;
    if (!has && g.experimental === undefined) continue;
    if (g.experimental !== true || !has) {
      throw new Error(`feature-charter: group ${g.id} must carry both "experimental": true and a "flag", or neither`);
    }
    if (g.class !== 'ring-outward') {
      throw new Error(`feature-charter: group ${g.id} is ${g.class}; only ring-outward groups are flagged`);
    }
    const f = out.get(g.flag);
    if (!f) throw new Error(`feature-charter: group ${g.id} names flag ${JSON.stringify(g.flag)}, which experimentalFlags does not declare`);
    f.groups.push({ id: g.id, surface: g.surface, keys: [...g.keys], views: Array.isArray(g.views) ? [...g.views] : [] });
    (f.keys[g.surface] ||= []).push(...g.keys);
    if (Array.isArray(g.views)) (f.keys.view ||= []).push(...g.views);
  }
  // A flag no group carries is valid: it is gated in code (lib/feature-flags.mjs featureEnabled).
  return out;
}

// Memoised on path + mtime: the dispatcher asks on every request, and the file changes only on an edit.
let memo = { path: null, mtimeMs: null, value: null };

/**
 * @returns {{ok: true, path, charter, flags: Map} | {ok: false, path, error: string}}
 * ENOENT is an error here too: the charter ships with the code, so its absence is a broken checkout.
 */
export function loadFlagTable() {
  const path = charterPath();
  let mtimeMs;
  try { const st = statSync(path); mtimeMs = `${st.mtimeMs}:${st.size}`; }
  catch (e) { return { ok: false, path, error: `feature charter unreadable at ${path} (${e.code || e.message})` }; }
  if (memo.path === path && memo.mtimeMs === mtimeMs) return memo.value;
  let value;
  try {
    const charter = JSON.parse(readFileSync(path, 'utf8'));
    value = { ok: true, path, charter, flags: flagTable(charter) };
  } catch (e) {
    value = { ok: false, path, error: `feature charter at ${path} is unusable: ${e.message}` };
  }
  memo = { path, mtimeMs, value };
  return value;
}
