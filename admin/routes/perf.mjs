// admin/routes/perf.mjs — Scanner performance: the hardware profile, the depth/intensity knobs,
// and the per-scanner effect of a setting BEFORE it is applied.
//
// WHY PREVIEW IS ITS OWN ROUTE. The sliders ask "what would this do" on every move. Answering that
// through the write route with a dry-run flag puts a writer one boolean away from every drag, and a
// flag that must be true to avoid a write is a fail-open default. POST /api/perf/preview cannot
// write: it never reaches setSettings.
//
// THE MODEL IS IMPORTED LAZILY. monitor/perf-tuning.mjs lands independently of this file, and a
// static import of a module that is not on disk takes the whole panel down at boot. CW_PERF_TUNING
// overrides the path and is read at CALL time, so a test can point at a fixture.
//
// FAIL CLOSED. No model on disk, no hardware reading, or a scanner row the model did not explain
// are all UNKNOWN — never a default tuning, never a scanner silently rendered as "off".

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SETTING_KEYS, getSetting, setSettings } from '../../monitor/settings.mjs';
import { sessionWho } from '../../monitor/attribution.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// The declared keys this view reads and writes. Named here so a refusal can NAME them; nothing in
// this file invents a setting key — an undeclared key is a 501, not a write.
export const PERF_SETTING_KEYS = Object.freeze({
  profileId: 'perfProfile', depth: 'scanDepth', intensity: 'scanIntensity', overrides: 'scannerOverrides',
});
// Used only while the keys above are undeclared, and always reported as such (settingsAvailable).
const FALLBACK = Object.freeze({ depth: 3, intensity: 3 });

// Same gate as admin/routes/settings.mjs — the two must not drift on who may read fleet config.
function gate(ctx) {
  if (ctx.isLoopbackReq) return { ok: true, who: 'operator@loopback' };
  const s = ctx.adminSession ? ctx.adminSession(ctx.req) : null;
  if (!s || !s.user) return { ok: false };
  return { ok: true, who: sessionWho(s), session: s };
}

// Name the value as typed: "must be an integer 1-5" is useless without what arrived instead.
function show(v) {
  if (typeof v === 'string') return `the string ${JSON.stringify(v)}`;
  if (typeof v === 'number') return Number.isNaN(v) ? 'NaN' : String(v);
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'an array';
  return `a ${typeof v}`;
}

/** Where the tuning model lives, resolved at CALL time. */
export function tuningModuleUrl() {
  const o = process.env.CW_PERF_TUNING;
  if (o) return pathToFileURL(isAbsolute(o) ? o : resolve(process.cwd(), o)).href;
  return pathToFileURL(resolve(HERE, '..', '..', 'monitor', 'perf-tuning.mjs')).href;
}

// Successes are cached (a module is immutable once loaded); FAILURES ARE NOT, because the common
// failure is "not written yet" and caching it would need a panel restart to notice it landing.
const loaded = new Map();
async function loadTuning() {
  const url = tuningModuleUrl();
  if (loaded.has(url)) return loaded.get(url);
  let m;
  try { m = await import(url); }
  catch (e) {
    const missing = e && (e.code === 'ERR_MODULE_NOT_FOUND' || e.code === 'ENOENT');
    return {
      ok: false, url, missing,
      error: missing
        ? `the scan-tuning model is not on disk at ${url} — the panel cannot say what these settings would do, and will not guess a tuning`
        : `the scan-tuning model at ${url} could not be loaded: ${e.message}`,
    };
  }
  const need = ['PROFILES', 'detectHardware', 'matchProfile', 'resolveTuning', 'DEPTH_LEVELS', 'INTENSITY_LEVELS'];
  const absent = need.filter((n) => m[n] === undefined);
  if (absent.length) {
    return { ok: false, url, missing: false, error: `the scan-tuning model at ${url} is missing ${absent.join(', ')} — it does not satisfy the contract this route reads` };
  }
  const rec = { ok: true, url, m };
  loaded.set(url, rec);
  return rec;
}

/** Tests re-arm the module cache when they repoint CW_PERF_TUNING at a rewritten fixture. */
export function resetTuningCache() { loaded.clear(); }

// DEPTH_LEVELS / INTENSITY_LEVELS arrived as FUNCTIONS in the shipped model (they read a profiles
// document at call time) where the contract said arrays. Both are accepted: the shape a caller
// hands back is not worth a 500, and calling an array is the only thing that would break.
export function levelList(list) {
  let v = list;
  if (typeof v === 'function') { try { v = v(); } catch { return []; } }
  return Array.isArray(v) ? v : [];
}
const levelsOf = (list) => levelList(list)
  .map((l) => (l && typeof l.level === 'number' ? l.level : null))
  .filter((n) => n !== null);

// PROFILES is a PROXY whose getOwnPropertyDescriptor answers for every key, so
// `hasOwnProperty(PROFILES, 'nope')` is TRUE and an unknown profile id would walk straight past a
// membership check written that way. Enumerate the keys and test against those — ownKeys is the
// only trap that tells the truth here.
export function profileIds(PROFILES) {
  try { return Object.keys(PROFILES || {}); } catch { return []; }
}

// "3" and null are refused rather than coerced. A slider that posts a string is a bug in the page,
// and coercing it here would hide the bug while writing a value the operator never chose.
function checkLevel(name, v, list) {
  const allowed = levelsOf(list);
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    return `${name} must be an integer level, one of ${allowed.join(', ') || '1, 2, 3, 4, 5'} (got ${show(v)})`;
  }
  if (allowed.length && !allowed.includes(v)) {
    return `${name} must be one of ${allowed.join(', ')} (got ${v})`;
  }
  return null;
}

function checkProfile(id, PROFILES) {
  const ids = profileIds(PROFILES);
  if (typeof id !== 'string' || !id.trim()) return `profileId must be one of ${ids.join(', ')} (got ${show(id)})`;
  if (!ids.includes(id)) return `unknown profileId ${JSON.stringify(id)} — the declared profiles are ${ids.join(', ')}`;
  return null;
}

// A scanner id as the manifests write them. An override keyed on anything else names a lane that
// cannot exist, and applying it would report a forced state for nothing.
const SCANNER_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * The per-lane overrides. Absent and null both mean "no overrides"; `{}` is the same thing said
 * explicitly, which is what the page's "reset all to auto" posts.
 * EVERY refusal names the offending id — "an override is invalid" over a 45-row table is not a
 * refusal an operator can act on. Returns [] when clean.
 */
export function checkOverrides(v) {
  if (v === undefined || v === null) return [];
  if (typeof v !== 'object' || Array.isArray(v)) {
    return [`overrides must be an object of {scannerId: "on" | "off"} (got ${show(v)})`];
  }
  const errors = [];
  for (const [id, state] of Object.entries(v)) {
    if (!SCANNER_ID_RE.test(id)) {
      errors.push(`overrides: ${JSON.stringify(id)} is not a scanner id — lowercase letters, digits, dot, underscore and hyphen, 1-64 characters`);
      continue;
    }
    if (state !== 'on' && state !== 'off') {
      errors.push(`overrides.${id} must be exactly "on" or "off" (got ${show(state)}) — a third state is one no row can render, so nothing was written`);
    }
  }
  return errors;
}

/**
 * Validate the knobs against the model's own declared levels, plus the per-lane overrides.
 * Returns [] when clean. Every field is checked, so one bad slider does not mask a second.
 */
export function validateTuningRequest(body, mod) {
  const b = (body && typeof body === 'object' && !Array.isArray(body)) ? body : null;
  if (!b) return ['the body must be an object of {profileId, depth, intensity, overrides}'];
  const errors = [];
  const p = checkProfile(b.profileId, mod.PROFILES);
  if (p) errors.push(p);
  const d = checkLevel('depth', b.depth, mod.DEPTH_LEVELS);
  if (d) errors.push(d);
  const i = checkLevel('intensity', b.intensity, mod.INTENSITY_LEVELS);
  if (i) errors.push(i);
  errors.push(...checkOverrides(b.overrides));
  return errors;
}

/** `{}` and null are the same state — no lane is overridden — and the store holds ONE of them so a
 *  round trip cannot turn "no overrides" into a different value than it started as. */
export function normalizeOverridesForStore(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (!keys.length) return null;
  const out = {};
  for (const k of keys.sort()) out[k] = v[k];             // deterministic on disk
  return out;
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const KINDS = new Set(['n/a', 'binary', 'graded']);
const levelOf = (l) => (l && typeof l === 'object' && Number.isInteger(l.rank) && Number.isInteger(l.of)
  ? { rank: l.rank, of: l.of, label: String(l.label ?? '') } : null);

// The one-line description each check declares in the lane manifest, read at CALL time. A manifest
// that cannot be read leaves every row without one and says so once; it never blocks the tuning.
function descriptions() {
  const p = process.env.CW_BASELINE_MANIFEST || resolve(HERE, '..', '..', 'manifests', 'security-baseline.json');
  try {
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    return { map: new Map((doc.checks || []).map((c) => [c.id, c.description || null])), error: null };
  } catch (e) { return { map: new Map(), error: `check descriptions could not be read from ${p} (${e.code || e.message})` }; }
}

function describe(tuning) {
  if (!tuning) return tuning;
  const d = descriptions();
  for (const s of tuning.scanners) s.description = d.map.get(s.id) ?? null;
  if (d.error) tuning.warnings.push(d.error);
  return tuning;
}

/**
 * The route's guarantee over whatever the model returned: a scanner is enabled, disabled, or
 * UNDETERMINED, and anything not enabled carries a reason. An unexplained "off" row reads to an
 * operator exactly like a deliberate exclusion, which is the failure this panel exists to refuse.
 */
export function normalizeTuning(t) {
  const src = (t && typeof t === 'object') ? t : {};
  const warnings = Array.isArray(src.warnings) ? src.warnings.map(String) : [];
  if (!Array.isArray(src.scanners)) {
    warnings.push('the tuning model returned no scanner list — the table below is UNKNOWN, not empty');
  }
  const scanners = (Array.isArray(src.scanners) ? src.scanners : []).map((s) => {
    const row = (s && typeof s === 'object') ? s : {};
    let enabled = row.enabled === true ? true : (row.enabled === false ? false : null);
    const override = (row.override === 'on' || row.override === 'off') ? row.override : 'auto';
    let blocked = row.blocked === true;
    let reason = typeof row.reason === 'string' && row.reason.trim() ? row.reason.trim() : null;
    // A row that claims to be forced-on-and-blocked AND enabled is self-contradictory. It becomes
    // UNDETERMINED rather than being resolved in either direction — resolving it to `enabled` would
    // publish a scan on the model's own admission that it cannot run.
    if (blocked && enabled === true) {
      enabled = null;
      warnings.push(`${String(row.id ?? 'a scanner')} was returned as both blocked and enabled — it is reported UNDETERMINED, because a lane cannot be running and unable to run at once`);
    }
    if (enabled === null && !reason) reason = 'the tuning model did not say whether this scanner runs at these settings — treat it as UNDETERMINED, not as off';
    if (enabled === false && !reason) reason = 'the tuning model gave no reason — this row is UNEXPLAINED, not a deliberate exclusion';
    if (blocked && !reason) reason = 'the tuning model reported this lane as forced on but blocked and gave no blocking reason — it is UNDETERMINED, not running';
    return {
      id: String(row.id ?? ''),
      label: String(row.label ?? row.id ?? ''),
      costClass: row.costClass == null ? null : String(row.costClass),
      enabled,
      reason,
      // The operator's forced state, what the derivation had said, and whether forcing it on
      // actually made it runnable. All three, because "forced on" alone cannot be told apart from
      // "running" and that is the whole point of the control.
      override,
      derivedEnabled: row.derivedEnabled === true ? true : (row.derivedEnabled === false ? false : null),
      derivedReason: typeof row.derivedReason === 'string' ? row.derivedReason : '',
      blocked,
      timeoutMs: finite(row.timeoutMs),
      concurrencyWeight: finite(row.concurrencyWeight),
      // What depth and intensity mean for THIS scanner: its own levels, a switch, or nothing. A model
      // that predates ladders sends none of these, and the row says unknown rather than n/a.
      minDepth: finite(row.minDepth),
      depthKind: KINDS.has(row.depthKind) ? row.depthKind : null,
      depthLevel: levelOf(row.depthLevel),
      depthLadder: Array.isArray(row.depthLadder) ? row.depthLadder.map(String) : null,
      intensityKind: KINDS.has(row.intensityKind) ? row.intensityKind : null,
      intensityLevel: levelOf(row.intensityLevel),
      intensityLadder: Array.isArray(row.intensityLadder) ? row.intensityLadder.map(String) : null,
    };
  });
  const undetermined = scanners.filter((s) => s.enabled === null).length;
  if (undetermined) warnings.push(`${undetermined} scanner(s) did not report whether they run at these settings`);
  const forcedBlocked = scanners.filter((s) => s.blocked).length;
  return {
    jobs: finite(src.jobs), slots: finite(src.slots), ramBudgetGB: finite(src.ramBudgetGB),
    scanners,
    overrides: normalizeOverridesForStore(src.overrides) || {},
    counts: {
      total: scanners.length,
      // A forced-but-blocked lane is counted in NEITHER enabled nor disabled: it is undetermined,
      // and its own bucket exists so it cannot be summed into either by accident.
      enabled: scanners.filter((s) => s.enabled === true).length,
      disabled: scanners.filter((s) => s.enabled === false && !s.blocked).length,
      undetermined,
      overridden: scanners.filter((s) => s.override !== 'auto').length,
      forcedOn: scanners.filter((s) => s.override === 'on').length,
      forcedOff: scanners.filter((s) => s.override === 'off').length,
      forcedBlocked,
    },
    warnings,
  };
}

function resolveOrThrow(mod, sel) {
  const t = mod.resolveTuning({
    profileId: sel.profileId, depth: sel.depth, intensity: sel.intensity,
    overrides: normalizeOverridesForStore(sel.overrides),
  });
  return describe(normalizeTuning(t));
}

/** Which of the three keys monitor/settings.mjs actually declares. Never assumed. */
function declaredKeys() {
  const declared = {};
  const missing = [];
  for (const key of Object.values(PERF_SETTING_KEYS)) {
    const has = Object.prototype.hasOwnProperty.call(SETTING_KEYS, key);
    declared[key] = has;
    if (!has) missing.push(key);
  }
  return { declared, missing, available: missing.length === 0 };
}

function readSetting(key, declared) {
  if (!declared[key]) return null;
  try { return getSetting(key); } catch { return null; }
}

/**
 * The whole payload for GET /api/perf, and the `state` echoed after a write.
 * @returns {{ok:true,...}|{ok:false,code:number,error:string}}
 */
export async function perfState() {
  const mod = await loadTuning();
  if (!mod.ok) return { ok: false, code: 503, error: mod.error, modelUrl: mod.url, modelPresent: !mod.missing };
  const { PROFILES, detectHardware, matchProfile, DEPTH_LEVELS, INTENSITY_LEVELS } = mod.m;

  // The profile list is read lazily out of a document the model owns; if that read fails there are
  // no profiles, which is UNKNOWN and must not render as "no hardware is declared".
  let ids;
  try { ids = Object.keys(PROFILES || {}); }
  catch (e) { return { ok: false, code: 503, error: `the hardware profiles could not be read (${e.message}) — the panel will not offer a tuning it cannot ground`, modelUrl: mod.url, modelPresent: true }; }

  // A failed detection is UNMATCHED, never the nearest guess.
  let hardware = null;
  let hardwareError = null;
  try { hardware = detectHardware(); }
  catch (e) { hardwareError = `hardware could not be detected (${e.message}) — no profile is matched, and none is assumed`; }

  let matched = { id: null, confidence: 'unknown', why: hardwareError || 'no hardware reading was taken' };
  if (hardware) {
    try {
      const m = matchProfile(hardware);
      matched = (m && typeof m === 'object') ? m : { id: null, confidence: 'unknown', why: 'matchProfile returned nothing' };
    } catch (e) { matched = { id: null, confidence: 'unknown', why: `profile match failed (${e.message})` }; }
  }

  const { declared, missing, available } = declaredKeys();
  const settings = {};
  for (const key of Object.values(PERF_SETTING_KEYS)) settings[key] = readSetting(key, declared);

  const notes = [];
  const valueOf = (key) => (settings[key] && typeof settings[key] === 'object' ? settings[key].value : undefined);

  const pickLevel = (key, list, fallback, name) => {
    const v = valueOf(key);
    if (v === undefined) return { value: fallback, source: available ? 'default' : 'fallback' };
    const err = checkLevel(name, v, list);
    if (err) { notes.push(`${key} in the settings store is invalid (${err}) — falling back to ${fallback}`); return { value: fallback, source: 'invalid-store-fallback' }; }
    return { value: v, source: settings[key].source || 'store' };
  };

  const depth = pickLevel(PERF_SETTING_KEYS.depth, DEPTH_LEVELS, FALLBACK.depth, 'depth');
  const intensity = pickLevel(PERF_SETTING_KEYS.intensity, INTENSITY_LEVELS, FALLBACK.intensity, 'intensity');

  const stored = valueOf(PERF_SETTING_KEYS.profileId);
  let profileId = null;
  let profileSource = null;
  if (typeof stored === 'string' && ids.includes(stored)) {
    profileId = stored; profileSource = settings[PERF_SETTING_KEYS.profileId].source || 'store';
  } else if (stored !== undefined && stored !== null) {
    notes.push(`${PERF_SETTING_KEYS.profileId} in the settings store names ${JSON.stringify(String(stored))}, which is not a declared profile — the detected profile is shown instead`);
  }
  if (!profileId && matched.id && ids.includes(matched.id)) {
    profileId = matched.id; profileSource = 'detected';
  }
  if (!profileId && ids.length) {
    profileId = ids[0];
    profileSource = 'first-declared';
    notes.push('no profile was stored and none was matched to this hardware — the first declared profile is shown, and it is a placeholder rather than a reading');
  }

  // An unreadable override table is NO override, said out loud. Applying half of it, or guessing
  // what the bad half meant, would change what gets scanned on the strength of a value we refused.
  const storedOverrides = valueOf(PERF_SETTING_KEYS.overrides);
  let overrides = null;
  let overridesSource = available ? 'default' : 'fallback';
  // The settings store validates on READ and hands back the default when a key is unreadable. That
  // is the right posture, but silent here it would render as "no lane is overridden" when the truth
  // is "an override table was refused" — the operator has to be told which row cost them the table.
  const ovRec = settings[PERF_SETTING_KEYS.overrides];
  if (ovRec && ovRec.storeError && ovRec.source === 'corrupt-store-fallback') {
    notes.push(`${PERF_SETTING_KEYS.overrides}: ${ovRec.storeError} — NO lane is overridden, and the table below is the derivation alone`);
    overridesSource = 'invalid-store-fallback';
  } else if (storedOverrides !== undefined && storedOverrides !== null) {
    const errs = checkOverrides(storedOverrides);
    if (errs.length) {
      notes.push(`${PERF_SETTING_KEYS.overrides} in the settings store is invalid (${errs.join('; ')}) — NO lane is overridden, and the table below is the derivation alone`);
      overridesSource = 'invalid-store-fallback';
    } else {
      overrides = normalizeOverridesForStore(storedOverrides);
      overridesSource = settings[PERF_SETTING_KEYS.overrides].source || 'store';
    }
  }

  let tuning = null;
  let tuningError = null;
  if (profileId) {
    try { tuning = resolveOrThrow(mod.m, { profileId, depth: depth.value, intensity: intensity.value, overrides }); }
    catch (e) { tuningError = `the tuning could not be resolved (${e.message})`; }
  } else {
    tuningError = 'no profile is available, so no tuning can be resolved';
  }

  return {
    ok: true,
    modelUrl: mod.url,
    hardware,
    hardwareError,
    matched,
    // Array, in declaration order — the page renders the model's vocabulary rather than a second copy.
    profiles: ids.map((id) => ({ ...(PROFILES[id] || {}), id, projected: (PROFILES[id] || {}).projected === true })),
    depthLevels: levelList(DEPTH_LEVELS),
    intensityLevels: levelList(INTENSITY_LEVELS),
    profileId,
    profileSource,
    depth: depth.value,
    depthSource: depth.source,
    intensity: intensity.value,
    intensitySource: intensity.source,
    // `{}` rather than null so the page always has a map to read; `overridesSource` says whether
    // anything was stored at all.
    overrides: overrides || {},
    overridesSource,
    tuning,
    tuningError,
    // The declared keys, whether they exist, and what the store says. `settingsAvailable:false`
    // means the values above are this route's fallbacks and NOTHING here can be persisted yet.
    settings,
    settingsAvailable: available,
    settingKeys: PERF_SETTING_KEYS,
    missingSettingKeys: missing,
    notes,
  };
}

export const routes = [
  { method: 'GET', path: '/api/perf', handle: async (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    try {
      const s = await perfState();
      return ctx.send(s.ok ? 200 : (s.code || 500), s);
    } catch (e) { return ctx.send(500, { ok: false, error: `scanner performance could not be read: ${e.message}` }); }
  } },

  // READ-ONLY BY CONSTRUCTION. Nothing below this line touches setSettings.
  { method: 'POST', path: '/api/perf/preview', handle: async (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    return ctx.readJsonBody(ctx.req, async (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      const mod = await loadTuning();
      if (!mod.ok) return ctx.send(503, { ok: false, error: mod.error, errors: [mod.error] });
      const errors = validateTuningRequest(body, mod.m);
      if (errors.length) return ctx.send(400, { ok: false, error: errors.join('; '), errors });
      try {
        const tuning = resolveOrThrow(mod.m, body);
        return ctx.send(200, {
          ok: true, profileId: body.profileId, depth: body.depth, intensity: body.intensity,
          overrides: normalizeOverridesForStore(body.overrides) || {}, tuning,
        });
      } catch (e) { return ctx.send(500, { ok: false, error: `the tuning could not be resolved: ${e.message}`, errors: [e.message] }); }
    });
  } },

  { method: 'POST', path: '/api/perf', handle: async (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    return ctx.readJsonBody(ctx.req, async (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      const mod = await loadTuning();
      if (!mod.ok) return ctx.send(503, { ok: false, error: mod.error, errors: [mod.error] });
      // VALUES FIRST, STORE SECOND. A refusal that names the store while the value was also wrong
      // sends the operator to fix the wrong thing.
      const errors = validateTuningRequest(body, mod.m);
      if (errors.length) return ctx.send(400, { ok: false, error: errors.join('; '), errors });

      const { missing, available } = declaredKeys();
      if (!available) {
        const msg = `these settings cannot be persisted yet: monitor/settings.mjs does not declare ${missing.join(', ')}. `
          + 'Nothing was written — this route never invents a setting key, because an undeclared key writes a value no consumer reads.';
        return ctx.send(501, { ok: false, error: msg, errors: [msg], missingSettingKeys: missing });
      }

      const patch = {
        [PERF_SETTING_KEYS.profileId]: body.profileId,
        [PERF_SETTING_KEYS.depth]: body.depth,
        [PERF_SETTING_KEYS.intensity]: body.intensity,
        // An empty map is persisted as null — the declared "no overrides" — so "reset all to auto"
        // lands as the same value a store that never held an override holds.
        [PERF_SETTING_KEYS.overrides]: normalizeOverridesForStore(body.overrides),
      };
      const r = setSettings(patch, { who: g.who });
      if (!r.ok) return ctx.send(r.code || 400, { ...r, error: (r.errors || ['the write was refused']).join('; ') });
      let tuning = null;
      try { tuning = resolveOrThrow(mod.m, body); } catch { tuning = null; }
      return ctx.send(200, { ...r, ok: true, tuning, state: await perfState() });
    });
  } },
];

export default routes;
