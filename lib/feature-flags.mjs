// lib/feature-flags.mjs — is an experimental feature group on, and why. The groups and their flag
// ids are declared once in manifests/feature-charter.json (read by lib/feature-charter.mjs); every
// enforcement point asks here, so a route, a nav tab, a CLI command, an MCP tool and a launchd job
// in one group cannot disagree about its state.
//
// Resolution, at CALL time: CW_FEATURE_<ID>=on|off > CW_EXPERIMENTAL=on|off > the experimentalFeatures
// setting > ON. The default is ON so nothing changes until the operator switches a group off.
//
// Unreadable settings store: the learningMode convention (monitor/settings.mjs) — reads fall back
// to env > default, so every flag the env does not set reads ON, reported with source
// 'corrupt-store-fallback'; writes are refused until the store is repaired. The env is read here
// rather than through getSetting so a caller can pass its own `env` object.
// Unreadable charter: no entry point can be mapped to a flag, so nothing is gated and every answer
// carries `charterError`; the census refuses to run on the same file.
import { readSettingsStore, SETTING_KEYS } from '../monitor/settings.mjs';
import { loadFlagTable, routeKey } from './feature-charter.mjs';

export const flagEnvVar = (id) => `CW_FEATURE_${String(id).toUpperCase().replace(/-/g, '_')}`;

const warned = new Set();
const warnOnce = (m) => { if (!warned.has(m)) { warned.add(m); console.warn(m); } };

/** on|off, unset, or invalid (ignored and reported, never guessed). */
function envWord(env, name) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') return { set: false };
  const w = String(raw).trim().toLowerCase();
  if (w === 'on' || w === 'off') return { set: true, value: w };
  return { set: false, invalid: `${name}=${JSON.stringify(String(raw))} is not on or off — ignored` };
}

/** The stored map: caller-supplied, or read now. An unreadable store or value is reported, never `{}` silently. */
function storedMap(settings) {
  if (settings !== undefined) {
    if (settings === null) return { map: {}, error: null };
    const err = SETTING_KEYS.experimentalFeatures.validate(settings);
    return err ? { map: {}, error: `the supplied experimentalFeatures is invalid: ${err}` } : { map: settings, error: null };
  }
  const st = readSettingsStore();
  if (st.error) { warnOnce(`[features] ${st.error} — every flag the env does not set reads ON`); return { map: {}, error: st.error }; }
  if (!Object.prototype.hasOwnProperty.call(st.values, 'experimentalFeatures')) return { map: {}, error: null };
  const v = st.values.experimentalFeatures;
  const err = SETTING_KEYS.experimentalFeatures.validate(v);
  if (err) {
    const detail = `the settings store at ${st.path} holds an invalid experimentalFeatures: ${err}`;
    warnOnce(`[features] ${detail} — every flag the env does not set reads ON`);
    return { map: {}, error: detail };
  }
  return { map: v || {}, error: null };
}

function resolveOne(f, env, store) {
  const notes = [];
  const envVar = flagEnvVar(f.id);
  const own = envWord(env, envVar);
  const all = envWord(env, 'CW_EXPERIMENTAL');
  for (const x of [own, all]) if (x.invalid) { notes.push(x.invalid); warnOnce(`[features] ${x.invalid}`); }
  let state = 'on';
  let source = 'default';
  if (own.set) { state = own.value; source = `env:${envVar}`; }
  else if (all.set) { state = all.value; source = 'env:CW_EXPERIMENTAL'; }
  else if (store.error) source = 'corrupt-store-fallback';
  else if (Object.prototype.hasOwnProperty.call(store.map, f.id)) { state = store.map[f.id]; source = 'store'; }
  return {
    id: f.id, label: f.label, why: f.why, on: state === 'on', state, source, envVar,
    groups: f.groups.map((g) => g.id),
    surfaces: f.keys,
    notes,
  };
}

/**
 * Every declared flag with its effective state. One settings read, so the answer is from one instant.
 * @returns {{ok: boolean, charterError: string|null, storeError: string|null, flags: object[]}}
 */
export function featureState({ env = process.env, settings } = {}) {
  const t = loadFlagTable();
  if (!t.ok) {
    warnOnce(`[features] ${t.error} — no entry point can be mapped to a flag, so nothing is gated`);
    return { ok: false, charterError: t.error, storeError: null, flags: [] };
  }
  const store = storedMap(settings);
  const flags = [...t.flags.values()].map((f) => resolveOne(f, env, store));
  return { ok: !store.error, charterError: null, storeError: store.error, flags };
}

// ── THE READ API other code gates on ──────────────────────────────────────────────────────────
// Adding a flag is one entry in manifests/feature-charter.json experimentalFlags; these then answer
// for it, the settings store and /api/features accept it, and CW_FEATURE_<ID> overrides it.

/**
 * The resolved flag for a declared id. Throws on an undeclared id (a typo must fail, not read ON).
 * With an unreadable charter it answers ON with source 'charter-unreadable', matching featureState.
 */
export function featureFlag(id, { env = process.env, settings } = {}) {
  const t = loadFlagTable();
  if (!t.ok) {
    warnOnce(`[features] ${t.error} — no entry point can be mapped to a flag, so nothing is gated`);
    return { id, label: id, why: '', on: true, state: 'on', source: 'charter-unreadable', envVar: flagEnvVar(id), groups: [], surfaces: {}, notes: [t.error] };
  }
  const f = t.flags.get(id);
  if (!f) throw new Error(`feature flag ${JSON.stringify(id)} is not declared in manifests/feature-charter.json experimentalFlags`);
  return resolveOne(f, env, storedMap(settings));
}

/** Is this experimental feature on? Env first (CW_FEATURE_<ID>, then CW_EXPERIMENTAL), then the store, then ON. */
export const featureEnabled = (id, opts) => featureFlag(id, opts).on;

/**
 * For a route handler: null when the feature is on, else the refusal to send.
 *   const off = gateFeature('feed'); if (off) return ctx.send(off.status, off.body);
 */
export function gateFeature(id, opts) {
  const f = featureFlag(id, opts);
  return f.on ? null : { status: 404, body: offBody(f) };
}

/** The flag (resolved) that owns (surface, key), or null when the entry point is not experimental. */
export function flagFor(surface, key, { env = process.env, settings } = {}) {
  const t = loadFlagTable();
  if (!t.ok) return null;
  for (const f of t.flags.values()) {
    if ((f.keys[surface] || []).includes(key)) return resolveOne(f, env, storedMap(settings));
  }
  return null;
}

export const routeFlag = (path) => flagFor('http-route', routeKey(path));

/** The flag that switches this route off, or null. Non-experimental routes cost one stat. */
export function routeFlagOff(path) {
  const f = routeFlag(path);
  return f && !f.on ? f : null;
}

/** One sentence naming the flag and the way back on; every refusal uses it. */
export function offMessage(f) {
  const by = f.source.startsWith('env:') ? f.source.slice(4) : null;
  const how = by === f.envVar ? `set by ${by}; set ${by}=on or unset it`
    : by ? `set by ${by}; set ${f.envVar}=on, or unset ${by}`
    : `switch it on in the panel (Settings, Experimental features), POST /api/features {"flag":"${f.id}","on":true}, or set ${f.envVar}=on`;
  return `experimental feature "${f.id}" (${f.label}) is switched off — ${how}`;
}

/** The JSON body of a refused request. */
export const offBody = (f) => ({ ok: false, error: offMessage(f), flag: f.id, featureOff: true, enable: f.envVar });
