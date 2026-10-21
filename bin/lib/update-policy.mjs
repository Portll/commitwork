// bin/lib/update-policy.mjs — what one dependency-update run may change, and what it may merge.
//
// Two layers. The OPERATOR's choice comes from this run's flags, else the settings store
// (depsProdUpdateTypes, depsDevUpdateTypes, depsAutoMergeTypes, depsCooldownDays). The REPOSITORY's
// committed policy, .github/dependency-updates.json, can only narrow it: kinds are intersected and
// cooldowns take the longer. A repository file is untrusted input, and a rule that can only remove
// permissions is safe to read from an untrusted tree. An unreadable or invalid policy file refuses
// the run; it is never read as "no policy".
//
// The same file drives .github/workflows/ci.yml's Dependabot merge job, so this repository's
// automatic merges and `commitwork deps --merge` answer to one declaration.
import { UPDATE_KINDS, DEFAULT_COOLDOWN, cooldownOf } from './npm-versions.mjs';

export const POLICY_FILE = '.github/dependency-updates.json';
export const POLICY_VERSION = 1;
export const ACTIONS_KINDS = ['patch', 'minor', 'major'];
const POLICY_KEYS = ['version', 'note', 'zeroRuntimeDependencies', 'cooldownDays', 'update', 'automerge'];
// optionalDependencies install in production, so they are governed as production packages.
export const exposureOfKind = (kind) => (kind === 'devDependencies' ? 'dev' : 'prod');

const isKindList = (v, kinds = UPDATE_KINDS) => Array.isArray(v) && v.every((k) => kinds.includes(k)) && new Set(v).size === v.length;

export function validateKinds(v, label) {
  if (!Array.isArray(v)) return `${label} must be a list of update kinds`;
  const bad = v.filter((k) => !UPDATE_KINDS.includes(k));
  if (bad.length) return `${label}: unknown update kind(s) ${bad.join(', ')} — known: ${UPDATE_KINDS.join(', ')}`;
  if (new Set(v).size !== v.length) return `${label}: a kind is listed more than once`;
  return null;
}

export function validateCooldown(v, label = 'cooldownDays') {
  const ok = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 365;
  if (typeof v === 'number') return ok(v) ? null : `${label} must be 0–365 days`;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return `${label} must be a number of days or { patch, minor, major }`;
  const bad = Object.keys(v).filter((k) => !['patch', 'minor', 'major'].includes(k));
  if (bad.length) return `${label}: unknown update type(s) ${bad.join(', ')}`;
  return Object.values(v).every(ok) ? null : `${label}: each value must be 0–365 days`;
}

/** Parse and validate a committed policy document. Every field is optional; a missing one narrows nothing. */
export function parseRepoPolicy(text, source = POLICY_FILE) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return { error: `${source} is not JSON (${e.message})` }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { error: `${source} must be a JSON object` };
  if (j.version !== POLICY_VERSION) return { error: `${source} declares version ${JSON.stringify(j.version)}; this reads version ${POLICY_VERSION}` };
  // A mistyped field would narrow nothing, which is the permissive direction: refuse it instead.
  const unknown = Object.keys(j).filter((k) => !POLICY_KEYS.includes(k));
  if (unknown.length) return { error: `${source}: unknown field(s) ${unknown.join(', ')} — known: ${POLICY_KEYS.join(', ')}` };
  const errs = [];
  for (const side of ['update', 'automerge']) {
    if (j[side] === undefined) continue;
    if (!j[side] || typeof j[side] !== 'object') { errs.push(`${side} must be an object`); continue; }
    for (const k of Object.keys(j[side])) {
      if (!['prod', 'dev', 'actions'].includes(k)) errs.push(`${side}.${k} is not prod, dev or actions`);
      else {
        const e = k === 'actions'
          ? (isKindList(j[side][k], ACTIONS_KINDS) ? null : `${side}.actions must list only ${ACTIONS_KINDS.join(', ')}`)
          : validateKinds(j[side][k], `${side}.${k}`);
        if (e) errs.push(e);
      }
    }
  }
  if (j.cooldownDays !== undefined) { const e = validateCooldown(j.cooldownDays); if (e) errs.push(e); }
  if (j.zeroRuntimeDependencies !== undefined && typeof j.zeroRuntimeDependencies !== 'boolean') errs.push('zeroRuntimeDependencies must be true or false');
  if (j.note !== undefined && typeof j.note !== 'string') errs.push('note must be a string');
  return errs.length ? { error: `${source}: ${errs.join('; ')}` } : { policy: j };
}

const intersect = (a, b) => (b === undefined ? [...a] : a.filter((k) => b.includes(k)));

/**
 * The effective policy. `operator` is { prod, dev, automerge, cooldown } as chosen for this run;
 * `repo` is a parsed policy or null when the repository declares none.
 */
export function resolvePolicy(operator, repo = null) {
  const r = repo || {};
  const cdOp = cooldownOf(operator.cooldown ?? DEFAULT_COOLDOWN);
  // A type the repository leaves out narrows nothing: it is 0 here, never the default.
  const cdRepo = r.cooldownDays === undefined ? null
    : typeof r.cooldownDays === 'number' ? cooldownOf(r.cooldownDays)
      : Object.fromEntries(['patch', 'minor', 'major'].map((t) => [t, r.cooldownDays[t] ?? 0]));
  const cooldown = Object.fromEntries(['patch', 'minor', 'major'].map((t) => [t, Math.max(cdOp[t], cdRepo ? cdRepo[t] : 0)]));
  const update = { prod: intersect(operator.prod, r.update?.prod), dev: intersect(operator.dev, r.update?.dev) };
  if (r.zeroRuntimeDependencies === true) update.prod = [];
  const automerge = {
    prod: intersect(operator.automerge, r.automerge?.prod).filter((k) => update.prod.includes(k)),
    dev: intersect(operator.automerge, r.automerge?.dev).filter((k) => update.dev.includes(k)),
  };
  const narrowed = [];
  for (const side of ['prod', 'dev']) {
    const lost = operator[side].filter((k) => !update[side].includes(k));
    if (lost.length) narrowed.push(`${side} updates ${lost.join(', ')} excluded by ${repo ? POLICY_FILE : 'policy'}${r.zeroRuntimeDependencies && side === 'prod' ? ' (zeroRuntimeDependencies)' : ''}`);
  }
  return { update, automerge, cooldown, zeroRuntimeDependencies: r.zeroRuntimeDependencies === true, repoPolicy: !!repo, narrowed };
}

/** May a change of this kind (an update type, 'lockfile' or 'advisories') to a package of this exposure be applied / merged? */
export const allows = (policy, side, exposure, kind) => policy[side][exposure].includes(kind);

/** The operator layer from settings, overridden field by field by flags. */
export function operatorPolicy({ settings, flags = {} }) {
  const pick = (flag, key) => (flags[flag] !== undefined ? flags[flag] : settings[key]);
  return {
    prod: pick('prod', 'depsProdUpdateTypes'),
    dev: pick('dev', 'depsDevUpdateTypes'),
    automerge: pick('automerge', 'depsAutoMergeTypes'),
    cooldown: pick('cooldown', 'depsCooldownDays'),
  };
}
