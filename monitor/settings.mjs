// monitor/settings.mjs — the shared operator-settings store for global sweep knobs. One reader for
// every process: the panel, sweep.mjs and liveness.mjs resolve each key as env > store > default
// AT CALL TIME and get the same answer, so the panel's "effective value + source" display is true
// in the nightly launchd run too. The store is never injected into a child's env — that would make
// env and store indistinguishable downstream.
//
// Env is read inside a function on purpose. A `const X = process.env.Y` at module load silently
// defeats every test that sets the env afterwards, so the test passes while proving nothing.
//
// CORRUPTION POSTURE, deliberately unlike admin/auth.mjs: a damaged store must not kill the nightly
// sweep, so READS fall back to env > default, warn loudly, and report source
// 'corrupt-store-fallback' for the panel to surface. WRITES refuse — overwriting a file we could
// not parse destroys settings nobody can read back. (auth fails closed because "no users" reopens
// the bootstrap window; settings has no such stake, so availability wins on reads.)
//
// Env: CW_SETTINGS (store path; CW_SETTINGS_STORE also honoured), CW_NOW (write stamp), plus each
// key's own env shadow below.
import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from 'node:fs';
import { validateAgainstSchema } from './registry.mjs'; // the one schema validator
const SCHEMA_PATH = fileURLToPath(new URL('../schema/explainers.schema.json', import.meta.url));
import { homedir } from 'node:os';
import { dirname, join, basename } from 'node:path';
import { acquireLock } from './lockfile.mjs';
import { fileURLToPath } from 'node:url';
import { loadFlagTable } from '../lib/feature-charter.mjs';
import { validSetupJourney } from './journey.mjs';

const HOUR_MS = 60 * 60 * 1000;
export const SETTINGS_STORE_VERSION = 1;

// Exported so a UI renders the vocabulary instead of hardcoding a second copy of it.
export const SETTINGS_SOURCES = ['env', 'store', 'default', 'corrupt-store-fallback'];

/** Store path, resolved at CALL time. CW_SETTINGS_STORE is the SPEC's name; both are accepted. */
export function settingsPath() {
  return process.env.CW_SETTINGS || process.env.CW_SETTINGS_STORE || join(homedir(), '.commitwork', 'settings.json');
}

// Name the value as typed, so "must be a positive number" is followed by what arrived instead.
function show(v) {
  if (typeof v === 'string') return `the string ${JSON.stringify(v)}`;
  if (typeof v === 'number') return Number.isNaN(v) ? 'NaN' : String(v);
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'an array';
  return `a ${typeof v}`;
}

// Booleans coerce to 0/1 and dates to epoch ms under `>`, so the type is checked before the range.
const positiveMs = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0
  ? null
  : `must be a positive finite number of milliseconds (got ${show(v)})`);

// A check id as the manifests write them: lowercase, digits, dot, underscore, hyphen.
const CHECK_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// Exactly two forced states. A third word — 'default', 'auto', true, '' — would be a state nobody
// downstream has a rendering for, and an override nobody can render becomes an override nobody sees.
export const SCANNER_OVERRIDE_STATES = Object.freeze(['on', 'off']);

// Every refusal NAMES the offending id: "must be on or off" sends an operator to read a whole table
// looking for which row it meant.
function validScannerOverrides(v) {
  if (v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) {
    return `must be an object mapping a check id to "on" or "off" (got ${show(v)})`;
  }
  for (const [id, state] of Object.entries(v)) {
    if (typeof id !== 'string' || !CHECK_ID_RE.test(id)) {
      return `${JSON.stringify(id)} is not a check id — lowercase letters, digits, dot, underscore and hyphen, 1-64 characters`;
    }
    if (state !== 'on' && state !== 'off') {
      return `${id}: must be exactly "on" or "off" (got ${show(state)}) — an override is a FORCED state, and a third value would be a state no consumer knows how to render`;
    }
  }
  return null;
}

// A repository as the registry and CW_REPO_SLUG name it.
const REPO_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const LEVEL_1_5 = (v) => Number.isInteger(v) && v >= 1 && v <= 5;

function validRepoTuning(v) {
  if (v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return `must be an object mapping a repository to {depth?, intensity?} (got ${show(v)})`;
  for (const [repo, t] of Object.entries(v)) {
    if (!REPO_NAME_RE.test(repo)) return `${JSON.stringify(repo)} is not a repository name — letters, digits, dot, underscore and hyphen, 1-100 characters`;
    if (!t || typeof t !== 'object' || Array.isArray(t)) return `${repo}: must be an object of {depth?, intensity?} (got ${show(t)})`;
    const keys = Object.keys(t);
    // An entry that sets nothing is a row the panel would render as an override while every value
    // it shows is the fleet's.
    if (!keys.length) return `${repo}: sets neither depth nor intensity — remove the entry instead`;
    for (const k of keys) {
      if (k !== 'depth' && k !== 'intensity') return `${repo}: unknown field ${JSON.stringify(k)} — only depth and intensity`;
      if (!LEVEL_1_5(t[k])) return `${repo}.${k}: must be an integer 1-5 (got ${show(t[k])})`;
    }
  }
  return null;
}

// fact: a dismissed id is checked against monitor/explainers.json, never merely stored / an unchecked set accumulates ids for explainers that were renamed or removed, and nothing can tell a real dismissal from a ghost (expiry: never, prev: not built)
let EXPLAINER_IDS = null;
export function explainerIds() {
  if (EXPLAINER_IDS) return EXPLAINER_IDS;
  try {
    const p = process.env.CW_EXPLAINERS || new URL('./explainers.json', import.meta.url);
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    // Validated against schema/explainers.schema.json, which had zero importers until 2026-08-26.
    // The catch below already refuses everything on an unreadable registry — the point of the schema
    // is that a registry which PARSES but is malformed took the same path as a valid one, so a
    // renamed field would have silently produced an empty id set and refused every real dismissal
    // while looking like it worked.
    const { errors } = validateAgainstSchema(doc, { path: SCHEMA_PATH });
    if (errors.length) throw new Error(`explainers registry violates its schema: ${errors[0]}`);
    EXPLAINER_IDS = new Set(doc.explainers.map((e) => e.id));
  } catch {
    // fact: an unreadable registry yields an EMPTY set, so every dismissal is refused / a permissive fallback would let an unknown id in exactly when the check is broken (expiry: never, prev: not built)
    EXPLAINER_IDS = new Set();
  }
  return EXPLAINER_IDS;
}

function validDismissed(v) {
  if (v === null) return null;
  if (!Array.isArray(v)) return `must be an array of explainer ids (got ${show(v)})`;
  const known = explainerIds();
  if (!known.size) return 'monitor/explainers.json could not be read, so no id can be verified — refusing rather than storing an unchecked set';
  for (const id of v) {
    if (typeof id !== 'string') return `${show(id)} is not an explainer id`;
    if (!known.has(id)) return `${JSON.stringify(id)} is not an explainer in monitor/explainers.json — a dismissal for an explainer that does not exist is a ghost nothing can clear`;
  }
  if (new Set(v).size !== v.length) return 'contains a duplicate id';
  return null;
}

// An unreadable charter refuses every map, like validDismissed: no id can be checked.
function validExperimentalFeatures(v) {
  if (v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return `must be an object mapping a flag id to "on" or "off" (got ${show(v)})`;
  const t = loadFlagTable();
  if (!t.ok) return `${t.error} — refusing rather than storing an unchecked flag map`;
  for (const [id, state] of Object.entries(v)) {
    if (!t.flags.has(id)) return `${JSON.stringify(id)} is not a flag in manifests/feature-charter.json experimentalFlags`;
    if (state !== 'on' && state !== 'off') return `${id}: must be exactly "on" or "off" (got ${show(state)})`;
  }
  return null;
}

// CW_EXPERIMENTAL=on|off is the whole-map shadow: every declared flag at once.
function experimentalFromEnv(s) {
  const w = s.toLowerCase();
  if (w !== 'on' && w !== 'off') return { ok: false, error: `CW_EXPERIMENTAL=${JSON.stringify(s)} is invalid: must be on or off` };
  const t = loadFlagTable();
  if (!t.ok) return { ok: false, error: `CW_EXPERIMENTAL is set but ${t.error}` };
  return { ok: true, value: Object.fromEntries([...t.flags.keys()].map((id) => [id, w])) };
}

// ── THE DECLARED REGISTRY ──────────────────────────────────────────────────────────────────────
// Free-form keys are refused. Each entry carries everything a settings UI needs — label, help text,
// unit, default, env shadow, consumers — because a parallel list maintained beside this one is the
// single most-repeated defect in this repo.
export const SETTING_KEYS = {
  sweepHangMs: {
    key: 'sweepHangMs',
    label: 'Sweep hang threshold',
    description: 'How long an in-flight sweep may run before liveness reports it as OVERRUNNING.',
    unit: 'ms',
    envVar: 'CW_SWEEP_INFLIGHT_MAX_MS',
    default: 4 * HOUR_MS,
    nullable: false,
    consumers: ['monitor/liveness.mjs'],
    validate: positiveMs,
  },
  sweepKillMs: {
    key: 'sweepKillMs',
    label: 'Sweep kill threshold',
    description: 'How long an in-flight sweep may run before it becomes ELIGIBLE to be killed. Empty (null) means never kill — killing is opt-in. Must be greater than the hang threshold.',
    unit: 'ms',
    envVar: 'CW_SWEEP_KILL_MS',
    default: null,
    nullable: true,
    // The Settings view's sweep-health report is the whole consumer: admin/routes/settings.mjs reads
    // it and passes it to monitor/sweep-health.mjs, which marks a sweep kill-eligible and kills
    // nothing. monitor/sweep.mjs was listed here and never read it — the only kill it performs is the
    // per-area timeout, CW_SWEEP_AREA_TIMEOUT_MS.
    consumers: ['admin/routes/settings.mjs', 'monitor/sweep-health.mjs'],
    validate: (v) => (v === null ? null : positiveMs(v)),
  },
  perfProfile: {
    key: 'perfProfile',
    label: 'Hardware profile',
    description: 'Which declared hardware profile the scanner tuning is derived from. Empty (null) means auto-detect and match the nearest profile, which reports its own confidence rather than presenting a nearest match as an exact one.',
    unit: 'profile id',
    envVar: 'CW_PERF_PROFILE',
    default: null,
    nullable: true,
    consumers: ['monitor/perf-tuning.mjs', 'admin/routes/perf.mjs'],
    validate: (v) => (v === null ? null : (typeof v === 'string' && /^[a-z0-9-]{2,40}$/.test(v) ? null : 'must be a profile id: lowercase letters, digits and hyphens')),
  },
  // DEFAULT 5, because 5 is what the runner did before depth was enforced: every selected lane ran.
  // The default is the one value that changed nothing on the day enforcement landed (operator ruling
  // 2026-09-25); a lower default would have silently dropped the very-heavy lanes on every box
  // without a stored value.
  scanDepth: {
    key: 'scanDepth',
    label: 'Scan depth',
    description: 'How much is scanned, 1 (triage) to 5 (exhaustive, including runtime lanes against a live target). Depth decides WHICH lanes run, and for a scanner with its own levels, which level; intensity decides how hard they run. A lane disabled by depth is reported as not scanned, never as clean. A repository in repoTuning uses its own value instead.',
    unit: 'level 1-5',
    envVar: 'CW_SCAN_DEPTH',
    default: 5,
    nullable: false,
    consumers: ['monitor/perf-tuning.mjs', 'monitor/repo-tuning.mjs', 'admin/routes/perf.mjs'],
    validate: (v) => (Number.isInteger(v) && v >= 1 && v <= 5 ? null : 'must be an integer 1-5'),
  },
  scanIntensity: {
    key: 'scanIntensity',
    label: 'Scan intensity',
    description: 'How much of the machine a sweep may take, 1 (background) to 5 (saturate). Level 5 is usually SLOWER end to end on a shared or thermally limited machine: measured on this fleet 2026-08-22, per-repository throughput fell from 2.6 to 30 minutes under exactly that condition.',
    unit: 'level 1-5',
    envVar: 'CW_SCAN_INTENSITY',
    default: 3,
    nullable: false,
    consumers: ['monitor/perf-tuning.mjs', 'monitor/sweep.mjs', 'monitor/repo-tuning.mjs', 'admin/routes/perf.mjs'],
    validate: (v) => (Number.isInteger(v) && v >= 1 && v <= 5 ? null : 'must be an integer 1-5'),
  },
  repoTuning: {
    key: 'repoTuning',
    label: 'Per-repository depth and intensity',
    description: 'Depth and/or intensity for named repositories, replacing the fleet value for that repository only. A field left out follows the fleet. Empty (null) means every repository follows the fleet values.',
    unit: 'repository → {depth?, intensity?}',
    envVar: 'CW_REPO_TUNING',
    default: null,
    nullable: true,
    // Read by the resolver, served and written by the Scanners view (/api/scanners/repos), applied by
    // the runner's depth gate. admin/routes/perf.mjs was listed here and never read it: that route
    // owns the fleet-wide knobs, and nothing in it touches the per-repository table.
    consumers: ['monitor/repo-tuning.mjs', 'admin/routes/scanners.mjs', 'bin/commitwork.mjs'],
    validate: validRepoTuning,
  },
  scannerOverrides: {
    key: 'scannerOverrides',
    label: 'Per-scanner overrides',
    description: 'Force individual scanners ON or OFF, overriding what depth and intensity derived. Empty (null) means no overrides and every lane follows the derivation. Forcing a lane ON does not make it runnable: a lane with no container runtime, no live target or no token is reported FORCED ON BUT BLOCKED and is never counted as running. A lane forced OFF is reported as NOT SCANNED, never as clean.',
    unit: 'check id → on|off',
    envVar: 'CW_SCANNER_OVERRIDES',
    default: null,
    nullable: true,
    consumers: ['monitor/perf-tuning.mjs', 'admin/routes/perf.mjs'],
    validate: validScannerOverrides,
  },
  learningMode: {
    key: 'learningMode',
    label: 'Learning mode',
    description: "Contextual information for people who aren't software engineers. When on, short plain-English explanations appear beside the terms this panel uses without defining them. Each can be dismissed on its own and stays dismissed. Off by default: the explanations are for someone who does not already know the vocabulary, and this panel's usual reader does.",
    unit: 'on|off',
    envVar: 'CW_LEARNING_MODE',
    default: false,
    nullable: false,
    // The page half is admin/static/learning.js; admin/index.html only loads it.
    consumers: ['admin/routes/learning.mjs', 'admin/static/learning.js'],
    validate: (v) => (typeof v === 'boolean' ? null : `must be true or false (got ${show(v)})`),
  },
  experimentalFeatures: {
    key: 'experimentalFeatures',
    label: 'Experimental features',
    description: 'Switch each experimental feature group on or off. The groups and their flag ids are declared in manifests/feature-charter.json. Empty (null) means every group is on. CW_FEATURE_<ID>=on|off overrides one flag and CW_EXPERIMENTAL=on|off overrides all of them; the per-flag variable wins.',
    unit: 'flag id → on|off',
    envVar: 'CW_EXPERIMENTAL',
    parseEnv: experimentalFromEnv,
    default: null,
    nullable: true,
    consumers: ['lib/feature-flags.mjs', 'admin/routes/features.mjs'],
    validate: validExperimentalFeatures,
  },
  learningDismissed: {
    key: 'learningDismissed',
    label: 'Dismissed explanations',
    description: 'Explainer ids the operator has dismissed. Each id must exist in monitor/explainers.json; an unknown one is refused rather than stored. Empty (null) means nothing has been dismissed and every explainer shows while Learning mode is on.',
    unit: 'explainer ids',
    envVar: 'CW_LEARNING_DISMISSED',
    default: null,
    nullable: true,
    // The page half is admin/static/learning.js; admin/index.html only loads it.
    consumers: ['admin/routes/learning.mjs', 'admin/static/learning.js'],
    validate: validDismissed,
  },
  setupJourney: {
    key: 'setupJourney',
    label: 'Setup journey',
    description: 'What the guided setup cannot measure: optional steps the operator acknowledged or skipped (personalise, palette, scanners, credentials, notifications) and whether the checklist is dismissed. Every other step reads its own record (users store, registry, PATH, credential refs, rollups, launch agents, daily config) at request time and stores nothing. Empty (null) means nothing acknowledged and the checklist shown.',
    unit: '{ dismissed?: boolean, acknowledged?: step ids }',
    envVar: 'CW_SETUP_JOURNEY',
    default: null,
    nullable: true,
    // The page half, admin/static/panel-journey.js, reads the route's derived view, never the key.
    consumers: ['admin/routes/journey.mjs'],
    validate: validSetupJourney,
  },
  sweepCadenceMs: {
    key: 'sweepCadenceMs',
    label: 'Default sweep cadence',
    description: 'The expected interval between sweeps for an area that declares no cadenceMs of its own. A per-area declaration always wins over this.',
    unit: 'ms',
    envVar: 'CW_SWEEP_CADENCE_MS',
    default: 24 * HOUR_MS,
    nullable: false,
    // DISPLAYED, NOT ENFORCED — an open defect, written here so this registry stops claiming
    // otherwise. admin/routes/settings.mjs shows this value as the cadence in force for any area with
    // no cadenceMs, but monitor/liveness.mjs never reads it: it classifies on the registry's
    // cadenceMs, else the threshold stamped on the rollup, and monitor/freshness.mjs defaults to 24h.
    // Both files were listed here and neither names the key or CW_SWEEP_CADENCE_MS.
    consumers: ['admin/routes/settings.mjs'],
    validate: positiveMs,
  },
  dockerRestartOnDown: {
    key: 'dockerRestartOnDown',
    label: 'Restart on down',
    description: 'What a sweep does when the docker daemon is installed but not responding. The attempt and its outcome are recorded in the batch manifest whichever way this is set, so a slice can always say whether its container lanes ran against a runtime somebody just kicked. Never applies when docker is ABSENT — absence is a deployment choice, not an outage, and a sweep must not install anything. Off ("Do not restart") by default: a sweep changing machine state unasked is the wrong default even when the change is usually welcome.',
    unit: 'choice',
    // DECLARED OPTIONS, same contract as reportFormats: the panel renders a choice FROM this list,
    // so the validator and the control cannot drift. `unit: 'choice'` (single pick) is what
    // separates this from an array-valued 'set' — the panel branches on the unit, not the key name.
    options: [
      { id: 'do-not-restart', label: 'Do not restart', note: 'record DOWN, mark the slice degraded, continue on whatever is cached — the default' },
      { id: 'restart', label: 'Restart', note: 'one bounded start attempt (colima start, else the Docker app on macOS), then re-probe before pulling' },
      { id: 'restart-popup', label: 'Restart with popup', note: 'as Restart, plus a desktop notification naming the outcome either way' },
    ],
    envVar: 'CW_DOCKER_RESTART_ON_DOWN',
    default: 'do-not-restart',
    nullable: false,
    consumers: ['monitor/images.mjs'],
    validate: (v) => (v === 'do-not-restart' || v === 'restart' || v === 'restart-popup'
      ? null : `must be one of do-not-restart, restart, restart-popup (got ${show(v)})`),
  },

  // ── REPORTING ────────────────────────────────────────────────────────────────────────────────
  // Which documents an export writes. Every format is a PROJECTION of the same neutral report
  // (schema/commitwork-report.schema.json), so turning one off changes what is published and never
  // what was found — the statements are identical in all of them by construction.
  //
  // The neutral report itself has no switch, deliberately. It is the thing the others are derived
  // from and the only one carrying coverage, voids, vintage and the advisory-database bound; a
  // switch that could disable it would let an operator publish four documents while withholding
  // the only one that says how completely the fleet looked.
  reportFormats: {
    key: 'reportFormats',
    label: 'Published report formats',
    description: 'Which projections a CRA/VEX export writes beside the neutral report. Empty (null) means the built-in default set. CSAF 2.1 is OFF by default: it is a Committee Specification DRAFT (CSD02) and a consumer pinned to 2.0 must keep receiving byte-identical 2.0 output, so 2.1 is a sibling document an operator opts into rather than a version bump they receive.',
    unit: 'format ids',
    // DECLARED OPTIONS, so the panel renders a checkbox per format instead of asking an operator to
    // type a JSON array into a text box. The list is here rather than in the page because the
    // validator above already owns what a valid id is, and two lists would drift — the panel would
    // offer a format the validator refuses, or hide one it accepts.
    options: [
      { id: 'cdx', label: 'CycloneDX VEX 1.5', note: 'the widest-read VEX form; no vendored schema here, so it is emitted unvalidated' },
      { id: 'csaf', label: 'CSAF 2.0', note: 'the published OASIS standard, validated against schema/upstream/csaf_json_schema.json' },
      { id: 'csaf21', label: 'CSAF 2.1 (draft)', note: 'Committee Specification DRAFT CSD02 — a SIBLING document, never a replacement for 2.0. Off by default: a consumer pinned to 2.0 must keep receiving byte-identical 2.0 output' },
      { id: 'openvex', label: 'OpenVEX', note: 'smallest surface; keeps status and justification and drops the rest' },
    ],
    envVar: 'CW_REPORT_FORMATS',
    default: null,
    nullable: true,
    // ONE consumer, and the two I first listed were not consumers. cra/neutral-report.mjs builds the
    // document this one selects projections OF and deliberately has no switch; admin/routes/settings.mjs
    // renders every declared key generically and names none of them. Listing either would have been a
    // declaration that reads as coverage — the guard that caught it is the same shape as the lane
    // registries this repo keeps rediscovering.
    consumers: ['cra/vex.mjs'],
    validate: (v) => {
      if (v === null) return null;
      if (!Array.isArray(v)) return 'must be an array of format ids, or empty for the default set';
      const known = new Set(['cdx', 'csaf', 'csaf21', 'openvex']);
      const bad = v.filter((x) => !known.has(x));
      if (bad.length) return `unknown format id(s): ${bad.join(', ')} — known: ${[...known].join(', ')}`;
      // A duplicate is a declaration bug, not a request to write the file twice.
      if (new Set(v).size !== v.length) return 'a format is listed more than once';
      return null;
    },
  },
};

// Own-property lookup, never `SETTING_KEYS[key]`: a bare index resolves "__proto__" to
// Object.prototype, so an undeclared key would arrive as a truthy "spec" and walk straight past
// the whitelist.
const specFor = (key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(SETTING_KEYS, key) ? SETTING_KEYS[key] : null);

/** Cross-key rules — checked on every write, and surfaced (never enforced) on reads. */
export function checkCrossKey(values) {
  const errors = [];
  const hang = values.sweepHangMs;
  const kill = values.sweepKillMs;
  if (kill !== null && kill !== undefined && Number.isFinite(kill) && Number.isFinite(hang) && kill <= hang) {
    errors.push(
      `sweepKillMs (${kill}) must be GREATER than sweepHangMs (${hang}) — a kill threshold at or `
      + 'below the hang threshold would kill sweeps it had never warned about',
    );
  }
  return errors;
}

// ── the store ──────────────────────────────────────────────────────────────────────────────────
// Fail closed: ENOENT is the ONLY absence. A permission error or a parse failure is an UNREADABLE
// store, never an empty one — an empty one would silently reset every key to its default.
export function readSettingsStore() {
  const path = settingsPath();
  const bad = (error) => ({ path, present: true, values: null, records: null, rules: null, error });
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return { path, present: false, values: {}, records: {}, rules: null, error: null };
    return bad(`${e.code || 'EIO'} reading the settings store at ${path}`);
  }
  let j;
  try { j = JSON.parse(raw); } catch (e) { return bad(`unparseable JSON in the settings store at ${path}: ${e.message}`); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return bad(`the settings store at ${path} is not a JSON object`);
  const s = j.settings;
  if (s !== undefined && (!s || typeof s !== 'object' || Array.isArray(s))) return bad(`the settings store at ${path} has a "settings" field that is not an object`);
  // null-prototype: a stored "__proto__" key must land as data, never as an assignment through
  // Object.prototype's setter.
  const values = Object.create(null);
  const records = Object.create(null);
  for (const [k, entry] of Object.entries(s || {})) {
    // A bare `{"settings":{"sweepHangMs":1000}}` is accepted as shorthand for the stamped record
    // form, so a hand-written fixture or an operator's one-line edit still reads.
    const rec = (entry && typeof entry === 'object' && !Array.isArray(entry) && 'value' in entry) ? entry : { value: entry };
    records[k] = rec;
    values[k] = rec.value;
  }
  return { path, present: true, values, records, rules: (j && typeof j.rules === 'object' && !Array.isArray(j.rules)) ? j.rules : null, error: null };
}

// Deduped by message: a corrupt store would otherwise warn once per key per call and train the
// reader straight past it.
const warned = new Set();
function warnOnce(msg) {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(msg);
}
/** Tests and long-lived processes re-arm the warn dedup. */
export function resetSettingsWarnings() { warned.clear(); }

const NULL_WORDS = new Set(['off', 'none', 'never', 'null', 'disabled']);
// An env var holding only whitespace is treated as unset — `FOO= node …` means "not set", and
// reading it as 0 would be a silent, invalid override.
function fromEnv(spec, raw) {
  const s = String(raw).trim();
  if (s === '') return { unset: true };
  if (typeof spec.parseEnv === 'function') return spec.parseEnv(s);
  if (spec.nullable && NULL_WORDS.has(s.toLowerCase())) return { ok: true, value: null };
  // An object- or ARRAY-valued key arrives as JSON. Parsed HERE rather than handed to validate as a
  // string: otherwise every env shadow of such a key is refused as "not an object" and the variable
  // is silently ignored, which is an override the operator set and cannot see. A numeric or
  // id-shaped value never begins with `{` or `[`, so no existing key changes behaviour.
  // `[` was added 2026-08-26 with the first array-valued key (reportFormats); the reasoning above
  // was already general and the bracket was the only thing missing.
  if (s.startsWith('{') || s.startsWith('[')) {
    let parsed;
    try { parsed = JSON.parse(s); }
    catch (e) { return { ok: false, error: `${spec.envVar}=${JSON.stringify(s)} is invalid: it is not parseable JSON (${e.message})` }; }
    const jerr = spec.validate(parsed);
    if (jerr) return { ok: false, error: `${spec.envVar}=${JSON.stringify(s)} is invalid: ${jerr}` };
    return { ok: true, value: parsed };
  }
  const n = Number(s);
  // The value HANDED BACK must be the value that was VALIDATED. Returning `n` unconditionally
  // passed NaN to every string-valued key whose env shadow validated — the validator approved
  // "restart" and the caller received NaN with source 'env', an override the operator set and
  // could not recognise in what came back.
  const value = Number.isNaN(n) ? s : n;
  const err = spec.validate(value);
  if (err) return { ok: false, error: `${spec.envVar}=${JSON.stringify(s)} is invalid: ${err}` };
  return { ok: true, value };
}

function nowIso() {
  const pinned = process.env.CW_NOW;
  if (pinned) {
    const t = Date.parse(pinned);
    if (Number.isFinite(t)) return new Date(t).toISOString();
    warnOnce(`[settings] CW_NOW=${JSON.stringify(pinned)} is not a parseable timestamp — stamping with the real clock instead`);
  }
  return new Date().toISOString();
}

/**
 * The effective value of one declared key.
 * @returns {{key, value, source, default, envVar, label, description, unit, nullable,
 *            storeError: string|null, notes: string[], setAt?: string|null, setBy?: string|null}}
 */
export function getSetting(key, { store } = {}) {
  const spec = specFor(key);
  if (!spec) throw new Error(`unknown setting ${JSON.stringify(key)} — the declared keys are ${Object.keys(SETTING_KEYS).join(', ')}`);
  const base = {
    key, label: spec.label, description: spec.description, unit: spec.unit,
    default: spec.default, envVar: spec.envVar, nullable: !!spec.nullable,
  };
  const notes = [];

  // env, read HERE and not at module load
  const rawEnv = process.env[spec.envVar];
  let envSet = false;
  let envValue;
  if (rawEnv !== undefined) {
    const p = fromEnv(spec, rawEnv);
    if (p.ok) { envSet = true; envValue = p.value; }
    else if (p.error) { notes.push(`${p.error} — the env shadow is being IGNORED, not applied`); warnOnce(`[settings] ${p.error} — ignoring it`); }
  }

  const st = store || readSettingsStore();

  if (st.error) {
    // Availability wins on reads: warn loudly, name the state, keep the sweep running.
    warnOnce(`[settings] ${st.error} — falling back to env > default for every key; writes are REFUSED until it is repaired`);
    const value = envSet ? envValue : spec.default;
    return { ...base, value, source: 'corrupt-store-fallback', effectiveFrom: envSet ? 'env' : 'default', storeError: st.error, notes };
  }

  if (envSet) return { ...base, value: envValue, source: 'env', storeError: null, notes };

  if (Object.prototype.hasOwnProperty.call(st.values, key)) {
    const v = st.values[key];
    const err = spec.validate(v);
    if (err) {
      // One unreadable key is the same class of failure as an unreadable file, scoped to the key.
      const detail = `the settings store at ${st.path} holds an invalid ${key}: ${err}`;
      warnOnce(`[settings] ${detail} — falling back to env > default for this key`);
      return { ...base, value: spec.default, source: 'corrupt-store-fallback', effectiveFrom: 'default', storeError: detail, notes };
    }
    const rec = st.records[key] || {};
    return { ...base, value: v, source: 'store', storeError: null, setAt: rec.at ?? null, setBy: rec.by ?? null, notes };
  }

  return { ...base, value: spec.default, source: 'default', storeError: null, notes };
}

/** Every declared key at once — one store read, so the whole answer is from one instant. */
export function getAllSettings() {
  const store = readSettingsStore();
  const settings = {};
  const effective = {};
  for (const key of Object.keys(SETTING_KEYS)) {
    settings[key] = getSetting(key, { store });
    effective[key] = settings[key].value;
  }
  return {
    ok: !store.error,
    settings,
    storeError: store.error,
    storePath: store.path,
    // Reported, never enforced: a bad env/store COMBINATION must be visible without a read path
    // deciding to override an operator's explicit env var.
    conflicts: checkCrossKey(effective),
  };
}

// Deterministic on-disk order: declared keys in registry order, then anything a previous schema
// left behind, sorted. Same inputs ⇒ byte-identical file.
function orderedSettings(records) {
  const out = Object.create(null);
  for (const k of Object.keys(SETTING_KEYS)) if (records[k] !== undefined) out[k] = records[k];
  for (const k of Object.keys(records).sort()) if (out[k] === undefined) out[k] = records[k];
  return out;
}

function writeStoreAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}`);
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);                                    // a reader sees the whole old file or the whole new one
  try { chmodSync(path, 0o600); } catch { /* best effort on odd filesystems */ }
}

/**
 * Write a patch of declared keys.
 * `who` is stamped by the CALLER (a session identity) — it is never read out of the patch, because
 * a value that can name its own author is an attribution anyone can forge.
 * @returns {{ok:true, written, at, who, path, code:200} | {ok:false, errors:string[], code:number}}
 */
export function setSettings(patch, { who } = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, code: 400, errors: ['the patch must be an object of {key: value}'] };
  }
  if (typeof who !== 'string' || !who.trim()) {
    return { ok: false, code: 400, errors: ['who is required — the caller stamps the identity, and it is never taken from the value patch'] };
  }
  const keys = Object.keys(patch);
  if (!keys.length) return { ok: false, code: 400, errors: ['the patch is empty — nothing to write'] };

  // The store is checked BEFORE the values: if it cannot be parsed, no patch is writable, and
  // reporting a value complaint would imply a fixed value would have landed.
  const store = readSettingsStore();
  if (store.error) {
    return {
      ok: false,
      code: 503,
      errors: [`refusing to write: ${store.error}. Repair or remove the file first — overwriting a store that could not be read destroys settings nobody can read back.`],
    };
  }

  const errors = [];
  const shadowed = [];
  for (const k of keys) {
    const spec = specFor(k);
    if (!spec) { errors.push(`unknown setting ${JSON.stringify(k)} — the declared keys are ${Object.keys(SETTING_KEYS).join(', ')}`); continue; }
    const err = spec.validate(patch[k]);
    if (err) errors.push(`${k}: ${err}`);
    // A 200 that changes nothing observable is the panel lying: an env shadow outranks the store,
    // so the write is refused and the variable is named.
    const raw = process.env[spec.envVar];
    if (raw !== undefined && String(raw).trim() !== '') shadowed.push(`${k} is shadowed by ${spec.envVar}=${JSON.stringify(String(raw))} — the env var wins at read time, so writing the store here would change nothing an operator can see. Unset it first.`);
  }
  if (errors.length) return { ok: false, code: 400, errors };
  if (shadowed.length) return { ok: false, code: 409, errors: shadowed };

  const path = store.path;
  const lock = acquireLock(`${path}.lock`, {
    staleMs: 30_000, label: 'settings-store', attempts: 50, spinMs: 20,
    onStale: (ageMs) => console.warn(`[settings] breaking a stale store lock (${Math.round(ageMs / 1000)}s old) at ${path}.lock`),
  });
  if (!lock.ok) return { ok: false, code: 409, errors: [`the settings store is locked by another process (${lock.path}); try again`] };
  try {
    // Re-read under the lock: a peer may have written between our read and our claim, and the
    // cross-key rule has to hold against what is actually on disk now.
    const fresh = readSettingsStore();
    if (fresh.error) return { ok: false, code: 503, errors: [`refusing to write: ${fresh.error}. Repair or remove the file first.`] };

    const merged = {};
    for (const k of Object.keys(SETTING_KEYS)) {
      merged[k] = Object.prototype.hasOwnProperty.call(patch, k) ? patch[k] : getSetting(k, { store: fresh }).value;
    }
    const cross = checkCrossKey(merged);
    if (cross.length) return { ok: false, code: 400, errors: cross };

    const at = nowIso();
    const records = Object.assign(Object.create(null), fresh.records);
    for (const k of keys) records[k] = { value: patch[k], at, by: who };
    writeStoreAtomic(path, {
      v: SETTINGS_STORE_VERSION,
      settings: orderedSettings(records),
      // CARRY THE OTHER SECTION THROUGH. This writer owns `settings` and setRules owns `rules`;
      // writing only your own section silently deletes the other one, and the operator discovers it
      // by finding an override table empty after changing an unrelated global.
      ...(fresh.rules ? { rules: fresh.rules } : {}),
      updatedAt: at,
      updatedBy: who,
    });
    const written = {};
    for (const k of keys) written[k] = patch[k];
    return { ok: true, code: 200, written, at, who, path };
  } finally {
    lock.release();
  }
}

// ── OVERRIDE TABLES ─────────────────────────────────────────────────────────────────────────────
// The operator edits two small tables in the panel — one for thresholds, one for cadence — whose
// rows are `INCLUDE | DIRECTORY | Name | value`. They live in THIS store, beside the globals they
// override, and are written through the SAME lock and the same corruption posture: a second file
// would mean a second writer, a second lock and a second answer to "what happens when it is
// corrupt", which is how the two drift apart.
//
// The VALUES are validated here against the same key specs the globals use, so a per-area override
// cannot hold a number the global would have refused. `sweep-rules.mjs` owns the row grammar and
// the matching; this owns persistence and value validity. Neither imports the other's job.
export const RULE_TABLES = Object.freeze({
  hang: { key: 'sweepHangMs', label: 'Hang-threshold overrides' },
  kill: { key: 'sweepKillMs', label: 'Kill-threshold overrides' },
  cadence: { key: 'sweepCadenceMs', label: 'Cadence overrides' },
});

/** Rows for one table, or [] when absent. A corrupt store yields [] AND a reason, never a silent []. */
export function getRules(table) {
  const spec = RULE_TABLES[table];
  if (!spec) return { ok: false, rows: [], error: `unknown rule table ${JSON.stringify(table)} — declared: ${Object.keys(RULE_TABLES).join(', ')}` };
  const store = readSettingsStore();
  if (store.error) return { ok: false, rows: [], error: store.error };
  const rows = store.rules && Array.isArray(store.rules[table]) ? store.rules[table] : [];
  return { ok: true, rows, error: null };
}

export function getAllRules() {
  const out = {};
  for (const t of Object.keys(RULE_TABLES)) out[t] = getRules(t);
  return out;
}

/**
 * Replace one table wholesale. Whole-table replacement rather than row patching is deliberate: the
 * rows are ORDER-DEPENDENT (later rules override earlier ones), so a per-row patch would need an
 * index that two concurrent editors cannot agree on.
 */
export function setRules(table, rows, { who } = {}) {
  const spec = RULE_TABLES[table];
  if (!spec) return { ok: false, code: 400, errors: [`unknown rule table ${JSON.stringify(table)}`] };
  if (!Array.isArray(rows)) return { ok: false, code: 400, errors: ['rows must be an array'] };
  if (typeof who !== 'string' || !who.trim()) {
    return { ok: false, code: 400, errors: ['who is required — the caller stamps the identity, and it is never taken from the rows'] };
  }
  const keySpec = specFor(spec.key);
  const errors = [];
  rows.forEach((r, i) => {
    if (!r || typeof r !== 'object') { errors.push(`row ${i}: not an object`); return; }
    if (typeof r.include !== 'boolean') errors.push(`row ${i}: include must be true or false`);
    for (const f of ['directory', 'name']) {
      if (typeof r[f] !== 'string' || !r[f].trim()) errors.push(`row ${i}: ${f} is required (use "*" for any — never omit it, because wildcard-by-omission is how one rule silently reaches the whole fleet)`);
    }
    // An EXCLUDE row carries no value: it removes the target from the thing being configured.
    if (r.include === true && keySpec) {
      const err = keySpec.validate(r.value);
      if (err) errors.push(`row ${i}: value: ${err}`);
    }
  });
  if (errors.length) return { ok: false, code: 400, errors };

  const store = readSettingsStore();
  if (store.error) return { ok: false, code: 503, errors: [`refusing to write: ${store.error}. Repair or remove the file first.`] };

  const path = store.path;
  const lock = acquireLock(`${path}.lock`, {
    staleMs: 30_000, label: 'settings-store', attempts: 50, spinMs: 20,
    onStale: (ageMs) => console.warn(`[settings] breaking a stale store lock (${Math.round(ageMs / 1000)}s old) at ${path}.lock`),
  });
  if (!lock.ok) return { ok: false, code: 409, errors: [`the settings store is locked by another process (${lock.path}); try again`] };
  try {
    const fresh = readSettingsStore();
    if (fresh.error) return { ok: false, code: 503, errors: [`refusing to write: ${fresh.error}.`] };
    const at = nowIso();
    const nextRules = Object.assign({}, fresh.rules || {}, { [table]: rows });
    writeStoreAtomic(path, {
      v: SETTINGS_STORE_VERSION,
      // Same reasoning as setSettings: carry the section this writer does not own, or writing a
      // rule table would silently erase every global.
      settings: orderedSettings(fresh.records || {}),
      rules: nextRules,
      updatedAt: at,
      updatedBy: who,
    });
    return { ok: true, code: 200, table, rows, at, who, path };
  } finally {
    lock.release();
  }
}
