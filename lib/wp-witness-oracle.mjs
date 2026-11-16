// lib/wp-witness-oracle.mjs — the oracle for the WordPress dynamic access-control witness.
//
// WHAT THIS DECIDES. A dynamic witness installs a plugin in a disposable WordPress, calls one of
// its entry points as a role that should NOT be able to mutate privileged state (anonymous, or a
// subscriber), and asks one question: did persistent state change? The state snapshots are taken
// INSIDE WordPress by a trusted mu-plugin; this module is the pure classifier over the before/after
// pair. It holds no I/O so it is unit-testable without Playground.
//
// THE ORACLE IS STATE CHANGE, NOT A RESPONSE CODE. A 200 proves nothing — WordPress returns 200 for
// a silently-ignored request as readily as for a write. A request that CHANGED privileged state by a
// role that may not is a confirmed broken-access-control finding, and the request is its reproduction.
//
// A REQUEST THAT CHANGED NOTHING IS NOT A PASS (house invariant: an unmeasured result is never a
// pass). It is `exercised-no-effect` — the endpoint ran but our guessed parameters may not have
// driven it down the mutating branch. That is held apart from `not-exercised` (we could not issue
// the request at all) and from `could-not-install` (the plugin never booted). Only an actual,
// role-inappropriate state change is `confirmed`; this is what keeps the witness off the false
// positives that the static lane produced (allowlist lookups, nonce-only gating, public-by-design
// reads) — none of those mutate privileged state, so none of them confirm here.
//
// FINDING IDENTITY EXCLUDES LINE NUMBERS (house invariant). A finding is keyed on
// plugin / entryKind / selector (route or action) / role — the place and the caller, never a line.
//
// CORE CHURN. WordPress writes its own options/transients during an ordinary request (cron marks,
// update checks, rewrite rules). A static denylist cannot track that across versions, so the DRIVER
// measures an ambient control (two snapshots with no endpoint call between them) and passes the keys
// that moved as `ignore`. CORE_VOLATILE below is only the floor under that measurement.
//
// Zero runtime dependencies.

export const CATEGORIES = ['options', 'usermeta', 'posts', 'postmeta', 'tables', 'files'];

// Option-name patterns WordPress mutates on its own. The floor under the driver's ambient control,
// never the whole guard — a plugin on a WP version this list does not anticipate still gets the
// measured ambient set subtracted.
export const CORE_VOLATILE = [
  /^_transient_/, /^_site_transient_/,
  /_transient_timeout_/,
  /^cron$/, /^rewrite_rules$/, /^recently_edited$/,
  /^auto_core_update_/, /^_wp_session_/, /^wp_force_deactivated_plugins$/,
  /^action_scheduler_/, /^can_compress_scripts$/, /^db_upgraded$/,
  /^(auto|core)_updater\.lock$/, /^recovery_keys$/, /^recovery_mode_email_last_sent$/,
];

// usermeta keys that move on any login (our subscriber logs in to be a subscriber) and are not a
// finding in themselves.
export const VOLATILE_USERMETA = [/session_tokens$/, /^wp_user-settings/, /last_activity$/];

const matchesAny = (patterns, s) => patterns.some((re) => re.test(s));

/**
 * Diff two flat maps (key -> scalar string). Deterministic: keys are sorted.
 * `ignore` is a Set of keys to drop from every bucket (the ambient control), plus an optional
 * `volatile` predicate for pattern-based drops.
 */
export function diffMaps(before = {}, after = {}, { ignore = new Set(), volatile = () => false } = {}) {
  const added = {}; const removed = {}; const changed = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of [...keys].sort()) {
    if (ignore.has(k) || volatile(k)) continue;
    const inB = Object.prototype.hasOwnProperty.call(before, k);
    const inA = Object.prototype.hasOwnProperty.call(after, k);
    if (inA && !inB) added[k] = after[k];
    else if (inB && !inA) removed[k] = before[k];
    else if (String(before[k]) !== String(after[k])) changed[k] = { from: before[k], to: after[k] };
  }
  return { added, removed, changed };
}

const bucketEmpty = (d) => !Object.keys(d.added).length && !Object.keys(d.removed).length && !Object.keys(d.changed).length;

/**
 * Diff two whole snapshots across every category. `ignore` is { category: Set<key> } (the ambient
 * control from the driver). Pattern-based volatility is applied per category here.
 */
export function diffSnapshots(before = {}, after = {}, { ignore = {} } = {}) {
  const out = {};
  for (const cat of CATEGORIES) {
    const vol = cat === 'options'
      ? (k) => matchesAny(CORE_VOLATILE, k)
      : cat === 'usermeta'
        ? (k) => matchesAny(VOLATILE_USERMETA, (k.split('\t')[1] || k))
        : () => false;
    out[cat] = diffMaps(before[cat] || {}, after[cat] || {}, { ignore: ignore[cat] || new Set(), volatile: vol });
  }
  return out;
}

/**
 * Differential control: drop from `delta` every key that also moved in `control` — the same role and
 * transport aimed at a selector that does not exist. What a request to NOTHING changes is the
 * plugin's/core's own per-request churn (lock options, bookkeeping flags), never the endpoint.
 */
export function subtractControl(delta, control) {
  const out = {};
  for (const cat of CATEGORIES) {
    const d = delta[cat] || { added: {}, removed: {}, changed: {} };
    const c = control && control[cat] ? control[cat] : { added: {}, removed: {}, changed: {} };
    const moved = new Set([...Object.keys(c.added), ...Object.keys(c.removed), ...Object.keys(c.changed)]);
    out[cat] = { added: {}, removed: {}, changed: {} };
    for (const kind of ['added', 'removed', 'changed']) for (const [k, v] of Object.entries(d[kind] || {})) if (!moved.has(k)) out[cat][kind][k] = v;
  }
  return out;
}

export function isEmptyDelta(delta) {
  return CATEGORIES.every((c) => bucketEmpty(delta[c] || { added: {}, removed: {}, changed: {} }));
}

/** All keys that moved in a bucket, as `kind:key` strings, sorted. */
function bucketKeys(cat, d) {
  const out = [];
  for (const kind of ['added', 'removed', 'changed']) for (const k of Object.keys(d[kind] || {})) out.push(`${cat}.${kind}:${k}`);
  return out.sort();
}

/**
 * The subset of a delta that `role` must NOT have been able to cause — the privileged mutations.
 * - anonymous: every persisted change is privileged. An unauthenticated request must not write
 *   options, user meta, posts, post meta, plugin tables or wp-content files.
 * - subscriber: admin-level state is privileged — options, plugin tables, files, posts, post meta,
 *   and OTHER users' meta. A subscriber editing its OWN meta is excluded (selfUid), because that is
 *   a capability a subscriber legitimately holds and is not the broken-access-control claim.
 */
export function privilegedChanges(delta, { role, selfUid } = {}) {
  const hits = [];
  for (const cat of CATEGORIES) {
    const d = delta[cat] || { added: {}, removed: {}, changed: {} };
    if (role === 'anonymous') { hits.push(...bucketKeys(cat, d)); continue; }
    if (role === 'subscriber') {
      if (cat === 'usermeta') {
        // keep only rows for a user other than the subscriber itself
        const keep = { added: {}, removed: {}, changed: {} };
        for (const kind of ['added', 'removed', 'changed']) for (const [k, v] of Object.entries(d[kind] || {})) {
          const uid = k.split('\t')[0];
          if (selfUid != null && String(uid) === String(selfUid)) continue;
          keep[kind][k] = v;
        }
        hits.push(...bucketKeys(cat, keep));
      } else {
        hits.push(...bucketKeys(cat, d));
      }
    }
  }
  return hits.sort();
}

export const VERDICT = {
  CONFIRMED: 'confirmed',
  UNATTRIBUTED: 'unattributed-change',
  NO_EFFECT: 'exercised-no-effect',
  NOT_EXERCISED: 'not-exercised',
  NOT_MEASURED: 'not-measured',
  COULD_NOT_INSTALL: 'could-not-install',
};

// The values the driver sends. A persisted change that carries one of them is ATTRIBUTABLE to the
// request; one that does not may be the endpoint or background churn, and is not claimed.
export const SENTINEL = /cwprobe|cwwitness|cwssrf/;

/** A snapshot is usable only if it is a real table read: an error body or an empty options table
 *  diffed against a good one would read as "everything was deleted". */
export function snapshotUsable(s) {
  return !!(s && !s._raw && !s.error && s.options && typeof s.options === 'object' && Object.keys(s.options).length > 0);
}

/** Does the moved value/key for tag `cat.kind:key` carry the sentinel? */
function attributed(delta, tag, sentinel) {
  const i = tag.indexOf(':');
  const [cat, kind] = tag.slice(0, i).split('.');
  const key = tag.slice(i + 1);
  if (sentinel.test(key)) return true;
  const v = delta[cat] && delta[cat][kind] && delta[cat][kind][key];
  const text = v && typeof v === 'object' ? `${v.from}\n${v.to}` : String(v == null ? '' : v);
  return sentinel.test(text);
}

/**
 * Classify one endpoint/role trial.
 *   requestIssued=false            -> not-exercised (we never got a request out)
 *   snapshot unusable              -> not-measured (measurement failed; never a delta)
 *   privileged change with our input -> confirmed (attributable state change a role may not cause)
 *   privileged change without it   -> unattributed-change (own bucket: neither finding nor pass)
 *   otherwise                      -> exercised-no-effect (ran, drove no privileged mutation)
 */
export function classify({ role, selfUid, requestIssued, delta, measured = true, sentinel = SENTINEL }) {
  if (!requestIssued) return { verdict: VERDICT.NOT_EXERCISED, privileged: [], unattributed: [], changed: [] };
  if (!measured) return { verdict: VERDICT.NOT_MEASURED, privileged: [], unattributed: [], changed: [] };
  const all = privilegedChanges(delta, { role, selfUid });
  const changed = CATEGORIES.flatMap((c) => bucketKeys(c, delta[c] || { added: {}, removed: {}, changed: {} }));
  const privileged = all.filter((t) => attributed(delta, t, sentinel));
  const unattributed = all.filter((t) => !attributed(delta, t, sentinel));
  if (privileged.length) return { verdict: VERDICT.CONFIRMED, privileged, unattributed, changed };
  if (unattributed.length) return { verdict: VERDICT.UNATTRIBUTED, privileged: [], unattributed, changed };
  return { verdict: VERDICT.NO_EFFECT, privileged: [], unattributed: [], changed };
}

/** Stable finding identity — place and caller, never a line number. */
export function findingKey({ plugin, entryKind, selector, role }) {
  return [plugin, entryKind, selector, role].map((s) => String(s == null ? '' : s)).join('|');
}
