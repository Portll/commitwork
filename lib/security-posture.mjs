// lib/security-posture.mjs — the agent-security settings, and the one read API every enforcement
// point asks: the destructive-command guard, lib/claude-spawn.mjs and MCP run_checks. Declarations
// live in monitor/settings.mjs.
//
// Resolution, at CALL time: the key's env var > the settings store > the declared default. An
// invalid env value or an unreadable store never yields the permissive default: each key falls to
// its STRICT reading below and the answer carries `error`, so a typo cannot open a gate.
//
// Messages from another agent are not a setting: such a message is data and never authorizes an
// ask-tier action. The guard enforces that; nothing here can switch it.
import { appendFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSettingsStore, SETTING_KEYS } from '../monitor/settings.mjs';
import { approvalQueuePathFor } from '../monitor/store-paths.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const POSTURE_KEYS = Object.freeze(['unattendedPosture', 'bypassCountsAsUnattended', 'missingModeIsUnattended', 'humanCommitMessagesOnly', 'runChecksRoots', 'runChecksRepoCode', 'runChecksRepoCodeRepos', 'runChecksRootsReviewDays']);

// The reading used when the env or the store cannot be trusted. This is the FALLBACK, not the
// default: the declared defaults live in monitor/settings.mjs, and they deny too — runChecksRoots []
// allows no repository and runChecksRepoCode is opt-in.
// runChecksRoots has no strict value of its own: an unknown allowlist refuses every run (see
// runChecksRootsFor).
const STRICT = Object.freeze({ unattendedPosture: 'A', bypassCountsAsUnattended: true, missingModeIsUnattended: true, humanCommitMessagesOnly: true, runChecksRoots: null, runChecksRepoCode: 'opt-in', runChecksRepoCodeRepos: [], runChecksRootsReviewDays: 30 });

/** One key: { key, value, source, envVar, error? }. source is env:<VAR> | store | default | invalid-env | corrupt-store-fallback. */
export function securitySetting(key, { env = process.env, store } = {}) {
  if (!POSTURE_KEYS.includes(key)) throw new Error(`security-posture: ${JSON.stringify(key)} is not one of ${POSTURE_KEYS.join(', ')}`);
  const spec = SETTING_KEYS[key];
  const base = { key, envVar: spec.envVar, default: spec.default };
  const raw = env[spec.envVar];
  if (raw !== undefined && String(raw).trim() !== '') {
    const s = String(raw).trim();
    const p = spec.parseEnv ? spec.parseEnv(s) : (spec.validate(s) ? { ok: false, error: `${spec.envVar}=${JSON.stringify(s)} is invalid: ${spec.validate(s)}` } : { ok: true, value: s });
    return p.ok ? { ...base, value: p.value, source: `env:${spec.envVar}` } : { ...base, value: STRICT[key], source: 'invalid-env', error: p.error };
  }
  const st = store || readSettingsStore();
  if (st.error) return { ...base, value: STRICT[key], source: 'corrupt-store-fallback', error: st.error };
  if (Object.prototype.hasOwnProperty.call(st.values, key)) {
    const v = st.values[key];
    const err = spec.validate(v);
    if (err) return { ...base, value: STRICT[key], source: 'corrupt-store-fallback', error: `the settings store at ${st.path} holds an invalid ${key}: ${err}` };
    const rec = st.records[key] || {};
    return { ...base, value: v, source: 'store', setAt: rec.at ?? null, setBy: rec.by ?? null };
  }
  return { ...base, value: spec.default, source: 'default' };
}

/** Every key from one store read, for the panel. */
export function securitySettings({ env = process.env } = {}) {
  const store = readSettingsStore();
  return { storeError: store.error, settings: Object.fromEntries(POSTURE_KEYS.map((k) => [k, securitySetting(k, { env, store })])) };
}

// ── the unattended posture ───────────────────────────────────────────────────────────────────────

/** { mode: off|A|B|C, source, error? } */
export function postureFor(env = process.env) {
  const s = securitySetting('unattendedPosture', { env });
  return { mode: s.value, source: s.source, ...(s.error ? { error: s.error } : {}) };
}

// The ask classes the guard raises. B refuses publication, exfiltration, ledger edits and
// posture writes; it lets recursive deletes and destructive git through, and records each one.
export const ASK_CLASSES = Object.freeze(['push', 'secret-read', 'outbound-write', 'recursive-delete', 'ledger-modify', 'destructive-git', 'posture-write']);
const B_REFUSES = new Set(['push', 'secret-read', 'outbound-write', 'ledger-modify', 'posture-write']);
// Refused whenever unattended, under every posture including off: a posture the governed
// session can write grants its own exceptions.
const ALWAYS_REFUSED = new Set(['posture-write']);

/**
 * What an ask becomes. Attended: ask. Unattended: deny under A and C, deny for B's classes under B,
 * ask under off, and posture-write is refused under every posture. `record` is true when C wants the
 * refusal in the approval queue; `recordAllowed` when B lets an unattended ask through (D27-1).
 * An unknown class is refused whenever unattended and the posture is not off: a new ask site must not
 * slip under B by being unnamed.
 */
export function askOutcome({ askClass, env = process.env, permissionMode } = {}) {
  const posture = postureFor(env);
  const who = unattendedState({ env, permissionMode });
  const out = (decision, record = false, recordAllowed = false) => ({ decision, record, recordAllowed, posture, unattended: who });
  if (!who.unattended) return out('ask');
  if (ALWAYS_REFUSED.has(askClass)) return out('deny', posture.mode === 'C');
  if (posture.mode === 'off') return out('ask');
  const refuse = posture.mode !== 'B' || B_REFUSES.has(askClass) || !ASK_CLASSES.includes(askClass);
  return refuse ? out('deny', posture.mode === 'C') : out('ask', false, posture.mode === 'B');
}

// ── who counts as unattended ─────────────────────────────────────────────────────────────────────
const NOBODY_ASKED = new Set(['dontAsk', 'bypassPermissions']);

/**
 * { unattended, why }. CW_GUARD_UNATTENDED=1 (set by every headless spawn) always counts. Otherwise
 * the hook payload's permission_mode decides: dontAsk and bypassPermissions count only under
 * bypassCountsAsUnattended, and an absent field only under missingModeIsUnattended.
 */
export function unattendedState({ env = process.env, permissionMode } = {}) {
  if (env.CW_GUARD_UNATTENDED === '1') return { unattended: true, why: 'CW_GUARD_UNATTENDED=1' };
  const mode = typeof permissionMode === 'string' ? permissionMode.trim() : '';
  if (!mode) {
    const s = securitySetting('missingModeIsUnattended', { env });
    return { unattended: s.value === true, why: `no permission_mode in the payload; missingModeIsUnattended=${s.value} (${s.source})` };
  }
  if (NOBODY_ASKED.has(mode)) {
    const s = securitySetting('bypassCountsAsUnattended', { env });
    return { unattended: s.value === true, why: `permission_mode ${mode}; bypassCountsAsUnattended=${s.value} (${s.source})` };
  }
  return { unattended: false, why: `permission_mode ${mode}` };
}

export const isUnattended = (o) => unattendedState(o).unattended;

// ── human commit messages only ───────────────────────────────────────────────────────────────────
/**
 * { canAsk, why }: whether a person will see a commit's permission prompt. Stricter than
 * unattendedState: an ask in a headless session runs unasked, so this needs the
 * harness's own attended mark rather than reading an absent flag as a person.
 */
export function commitApprover({ env = process.env, permissionMode } = {}) {
  if (env.CW_GUARD_UNATTENDED === '1') return { canAsk: false, why: 'CW_GUARD_UNATTENDED=1' };
  const mode = typeof permissionMode === 'string' ? permissionMode.trim() : '';
  if (NOBODY_ASKED.has(mode)) return { canAsk: false, why: `permission_mode ${mode} asks nobody` };
  if (env.CLAUDE_CODE_SESSION_ATTENDED !== '1') return { canAsk: false, why: 'CLAUDE_CODE_SESSION_ATTENDED is not 1, so the harness does not mark this session attended' };
  return { canAsk: true, why: mode ? `attended, permission_mode ${mode}` : 'attended' };
}

// ── the approval queue: C's refusals and B's allowances ──────────────────────────────────────────
// Append-only JSONL in the sidecar. One write() per line under O_APPEND, so concurrent hooks never
// interleave within a line. A row names commands, paths and repos, hence private.
const MAX_FIELD = 4096;
const clip = (v) => (typeof v === 'string' && v.length > MAX_FIELD ? `${v.slice(0, MAX_FIELD)}…[${v.length - MAX_FIELD} more]` : v);

export const approvalQueuePath = () => approvalQueuePathFor(ROOT);

function nowIso(env) {
  const t = env.CW_NOW ? Date.parse(env.CW_NOW) : NaN;
  return new Date(Number.isFinite(t) ? t : Date.now()).toISOString();
}

const QUEUE_ROWS = Object.freeze({
  recordRefusal: { posture: 'C', state: 'refused', prefix: 'REF' },
  recordAllowed: { posture: 'B', state: 'allowed', prefix: 'ALW' },
});

/**
 * Append one refused action (posture C). Throws on a bad entry or a failed write (the caller still
 * denies; it must not report a record that was not made). Returns { id, path, entry }.
 * @param {{tool: string, reason: string, askClass?: string, command?: string, path?: string, cwd?: string, sessionId?: string, permissionMode?: string, unattendedWhy?: string}} entry
 */
export const recordRefusal = (entry, { env = process.env } = {}) => appendQueueRow('recordRefusal', entry, env);

/** Append one unattended ask that posture B let through (D27-1). Same contract as recordRefusal. */
export const recordAllowed = (entry, { env = process.env } = {}) => appendQueueRow('recordAllowed', entry, env);

function appendQueueRow(fn, entry, env) {
  const { posture, state, prefix } = QUEUE_ROWS[fn];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${fn}: entry must be an object`);
  for (const f of ['tool', 'reason']) if (typeof entry[f] !== 'string' || !entry[f].trim()) throw new Error(`${fn}: ${f} is required`);
  const subject = entry.command ?? entry.path ?? '';
  const row = {
    at: nowIso(env),
    posture,
    tool: entry.tool,
    askClass: entry.askClass ?? null,
    subjectHash: createHash('sha256').update(String(subject)).digest('hex'),
    command: clip(entry.command ?? null),
    path: clip(entry.path ?? null),
    cwd: entry.cwd ?? null,
    sessionId: entry.sessionId ?? null,
    permissionMode: entry.permissionMode ?? null,
    unattendedWhy: entry.unattendedWhy ?? null,
    reason: clip(entry.reason),
    state,
  };
  row.id = `${prefix}-${createHash('sha256').update(JSON.stringify(row)).digest('hex').slice(0, 12)}`;
  const path = approvalQueuePath();
  // An override may name a fresh dir; the default dir is the sidecar link, never created here.
  if (process.env.CW_APPROVAL_QUEUE) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  else if (!existsSync(dirname(path))) throw new Error(`${fn}: the sidecar directory ${dirname(path)} is absent; set CW_APPROVAL_QUEUE`);
  appendFileSync(path, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  return { id: row.id, path, entry: row };
}

/** { ok, path, entries, error }. Absent is an empty queue; an unreadable file or bad line is an error, never []. */
export function readRefusals() {
  const path = approvalQueuePath();
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) { return e.code === 'ENOENT' ? { ok: true, path, entries: [], error: null } : { ok: false, path, entries: [], error: `${e.code || 'EIO'} reading ${path}` }; }
  const entries = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try { entries.push(JSON.parse(lines[i])); }
    catch { return { ok: false, path, entries, error: `line ${i + 1} of ${path} is not JSON` }; }
  }
  return { ok: true, path, entries, error: null };
}

// ── MCP run_checks ───────────────────────────────────────────────────────────────────────────────

/** { roots, source, error? }. roots [] allows NO repository. With `error`, roots is null and
 *  every run is refused — the two are different facts and the caller reports them differently. */
export function runChecksRootsFor(env = process.env) {
  const s = securitySetting('runChecksRoots', { env });
  return { roots: s.value === null ? null : [...s.value], source: s.source, ...(s.error ? { error: s.error } : {}) };
}

/** { mode: allow|opt-in, source, error? }. opt-in is the default. */
export function runChecksRepoCodeFor(env = process.env) {
  const s = securitySetting('runChecksRepoCode', { env });
  return { mode: s.value, source: s.source, ...(s.error ? { error: s.error } : {}) };
}

/** { repos, source, error? }: the repositories the operator lets run their own code under opt-in (D27).
 *  With `error`, repos is [] and nothing is granted. */
export function runChecksRepoCodeReposFor(env = process.env) {
  const s = securitySetting('runChecksRepoCodeRepos', { env });
  return { repos: [...s.value], source: s.source, ...(s.error ? { error: s.error } : {}) };
}

const DAY_MS = 86_400_000;

/**
 * Whether the roots are past their review date (D27): { overdue, due, setAt, days, why }. Measured from
 * the store's setAt, so only roots saved to the store have a date; env roots and the empty default do
 * not. A warning, never a refusal.
 */
export function runChecksRootsReview(env = process.env) {
  const store = readSettingsStore();
  const roots = securitySetting('runChecksRoots', { env, store });
  const days = securitySetting('runChecksRootsReviewDays', { env, store });
  const base = { overdue: false, due: null, setAt: roots.setAt ?? null, days: days.value };
  if (roots.source !== 'store' || !roots.value?.length) return { ...base, why: `the roots come from ${roots.source}, which carries no save date` };
  if (days.value === 0) return { ...base, why: `runChecksRootsReviewDays is 0 (${days.source}), so no review date is kept` };
  const setAt = Date.parse(roots.setAt ?? '');
  if (!Number.isFinite(setAt)) return { ...base, overdue: true, why: 'the stored roots carry no readable save date, so their age is unknown' };
  const due = setAt + days.value * DAY_MS;
  const now = Date.parse(nowIso(env));
  return { ...base, due: new Date(due).toISOString(), overdue: now > due, why: `saved ${roots.setAt}, review every ${days.value} day(s) (${days.source})` };
}
