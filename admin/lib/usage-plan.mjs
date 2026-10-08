// admin/lib/usage-plan.mjs — what an agent fleet is actually spending, on a plan that does not
// charge per token.
//
// WHY THIS EXISTS. The Overwatch session table rendered `$0.0000 · N turns` from the dispatch
// result frame's totalUsd. On a Max x20 subscription that figure is an invention: the account is
// flat-rate, nothing is billed per token, and a USD column answers a question nobody is being
// asked. It is the house's own rule pointed at the panel — a number nobody measured must not be
// rendered as one.
//
// The plan type is DETECTED, never configured. Claude Code caches the account's rate-limit
// utilisation in ~/.claude.json under `cachedUsageUtilization`, and a subscription reports
// limit_dollars / used_dollars / remaining_dollars as null while a metered account populates them.
// That null IS the signal. An operator who has to tell a panel which plan they are on will one day
// tell it the wrong one, and it will believe them.
//
// What replaces the dollars is the thing that actually constrains this fleet: percentage of the
// five-hour and seven-day windows, and when they reset.
//
// Zero dependencies. Env is read at CALL time, never at module load.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Env read at call time — a module-load const silently defeats any test that sets the override. */
export function configPath() {
  return process.env.CW_CLAUDE_CONFIG || join(homedir(), '.claude.json');
}

/** How long a cached utilisation reading stays worth showing without a staleness note. */
export function freshWindowMs() {
  const raw = Number(process.env.CW_USAGE_FRESH_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15 * 60 * 1000;
}

/**
 * The windows worth a row. The cache carries ~20 keys, most of them null codenames for features
 * this account does not have; rendering those as rows would be a wall of nulls pretending to be
 * measurements. Anything populated outside this list still surfaces via `otherActive`.
 */
export const PRIMARY_WINDOWS = Object.freeze(['five_hour', 'seven_day']);

const LABELS = Object.freeze({ five_hour: '5-hour window', seven_day: '7-day window' });
export const windowLabel = (key) => LABELS[key] || String(key).replace(/_/g, ' ');

/**
 * Read the cache. Never throws. ENOENT is the ONLY absence: it means Claude Code has not written a
 * cache here, which is a different fact from a file that exists and cannot be parsed, and the
 * second must never be reported as the first.
 */
export function readUsage({ path = configPath(), readFile = readFileSync } = {}) {
  let raw;
  try {
    raw = readFile(path, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, state: 'absent', path, why: 'no Claude config on this box' };
    return { ok: false, state: 'unreadable', path, why: `could not read ${path}: ${e && e.code ? e.code : e}` };
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    return { ok: false, state: 'unreadable', path, why: `config is not JSON: ${e.message}` };
  }
  const cache = doc && doc.cachedUsageUtilization;
  if (!cache || typeof cache !== 'object') {
    return { ok: false, state: 'absent', path, why: 'config carries no cachedUsageUtilization' };
  }
  return { ok: true, state: 'live', path, cache };
}

/**
 * Subscription or metered, from the dollar fields alone.
 *
 * A populated limit/used/remaining anywhere means the account is billed per token and a USD figure
 * is a measurement. All-null across every populated window means flat-rate. No window populated at
 * all is UNKNOWN — not "subscription", because absence of evidence for metering is not evidence of
 * a subscription, and guessing here is what puts a fake dollar sign on the page.
 */
export function detectPlan(cache) {
  const u = (cache && cache.utilization) || {};
  const windows = Object.entries(u).filter(([, v]) => v && typeof v === 'object');
  if (!windows.length) return { kind: 'unknown', why: 'no utilisation window reported a reading' };
  const dollarFields = ['limit_dollars', 'used_dollars', 'remaining_dollars'];
  const metered = windows.filter(([, v]) => dollarFields.some((f) => typeof v[f] === 'number'));
  if (metered.length) {
    return { kind: 'metered', why: `${metered.length} window(s) report dollar limits, so spend is billed per token`, meteredWindows: metered.map(([k]) => k) };
  }
  return {
    kind: 'subscription',
    why: 'every window reports null dollar limits, which is what a flat-rate plan looks like — per-token cost is not a measurement here',
  };
}

/** One window, normalised. A non-numeric utilisation is unknown rather than 0. */
export function normaliseWindow(key, v) {
  if (!v || typeof v !== 'object') return { key, label: windowLabel(key), state: 'absent' };
  const pct = typeof v.utilization === 'number' ? v.utilization : null;
  return {
    key,
    label: windowLabel(key),
    state: pct === null ? 'unknown' : 'live',
    utilization: pct,
    resetsAt: typeof v.resets_at === 'string' ? v.resets_at : null,
    lockedReason: v.locked_reason || null,
    limitDollars: typeof v.limit_dollars === 'number' ? v.limit_dollars : null,
    usedDollars: typeof v.used_dollars === 'number' ? v.used_dollars : null,
  };
}

/**
 * The whole reading, ready to render.
 *
 * `stale` is reported rather than hidden: Claude Code refreshes this cache on its own schedule, so
 * a panel that repaints every few seconds would otherwise show an hour-old number as a live one.
 * See the house rule about a stale reading reading exactly like a live one.
 */
export function usageState({ now = Date.now(), ...opts } = {}) {
  const read = readUsage(opts);
  if (!read.ok) return { ok: false, state: read.state, why: read.why, plan: { kind: 'unknown', why: read.why }, windows: [] };

  const cache = read.cache;
  const plan = detectPlan(cache);
  const u = (cache.utilization && typeof cache.utilization === 'object') ? cache.utilization : {};

  const windows = PRIMARY_WINDOWS.map((k) => normaliseWindow(k, u[k])).filter((w) => w.state !== 'absent');
  // Anything live outside the primary pair is named rather than dropped, so a limit this fleet is
  // actually hitting cannot be invisible because it was not on a hardcoded list.
  const otherActive = Object.entries(u)
    .filter(([k, v]) => !PRIMARY_WINDOWS.includes(k) && v && typeof v === 'object' && typeof v.utilization === 'number' && v.utilization > 0)
    .map(([k, v]) => normaliseWindow(k, v));

  const fetchedAtMs = typeof cache.fetchedAtMs === 'number' ? cache.fetchedAtMs : null;
  const ageMs = fetchedAtMs === null ? null : Math.max(0, now - fetchedAtMs);
  const fresh = freshWindowMs();

  return {
    ok: true,
    state: 'live',
    plan,
    windows,
    otherActive,
    fetchedAtMs,
    ageMs,
    // null age is UNKNOWN freshness, which is not the same as fresh.
    stale: ageMs === null ? null : ageMs > fresh,
    freshWindowMs: fresh,
    // The panel asks this one question of the reading: may I print a dollar figure?
    dollarsAreMeaningful: plan.kind === 'metered',
  };
}

/** Minutes/hours until a window resets, for a caption. Past or unparseable is its own answer. */
export function resetsIn(resetsAt, now = Date.now()) {
  if (typeof resetsAt !== 'string') return null;
  const t = Date.parse(resetsAt);
  if (!Number.isFinite(t)) return null;
  const ms = t - now;
  if (ms <= 0) return { ms, text: 'due now' };
  const mins = Math.round(ms / 60000);
  if (mins < 60) return { ms, text: `resets in ${mins} min` };
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return { ms, text: `resets in ${hrs}h${rem ? ` ${rem}m` : ''}` };
  return { ms, text: `resets in ${Math.round(hrs / 24)}d` };
}
