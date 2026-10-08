// adjudication-budget.mjs — G1 (FourEyes V1). Every non-oracle lane routes to a human: B's place-to-look,
// C's anomaly, D3's divergence, D4's undecidable. It is the SAME human and capacity is finite, so the
// AGGREGATE has a declared budget in human-MINUTES; a lane that would exceed the remaining budget DEFERS
// rather than publishing more into a queue no one can drain. And an undetermined row carries an AGE — a
// row from March must not read identical to today's.
//
// fact: the denominator is human-minutes, declared like every other denominator. Over budget ⇒ defer,
// LOUDLY, never a silent drop. An unbudgeted queue is the V1 sink: six lanes into one unpriced human.

export const DEFAULT_MINUTES_PER_ITEM = 5;    // declared per-item adjudication cost
export const DEFAULT_CAPACITY_MINUTES = 600;  // declared human-review capacity per cycle

// budgetState({ pending, capacityMinutes, minutesPerItem }) -> spent/remaining/saturated
export function budgetState({ pending = 0, capacityMinutes = DEFAULT_CAPACITY_MINUTES, minutesPerItem = DEFAULT_MINUTES_PER_ITEM } = {}) {
  const spentMinutes = Math.max(0, pending) * minutesPerItem;
  const remainingMinutes = Math.max(0, capacityMinutes - spentMinutes);
  return { spentMinutes, remainingMinutes, saturated: spentMinutes >= capacityMinutes, capacityMinutes, minutesPerItem };
}

// admit(newItems, state) -> how many NEW undetermined items a lane may add before the SHARED budget is
// spent. Over budget ⇒ defer the rest, loudly (the deferral is a visible state, not a dropped row).
export function admit(newItems = 0, { remainingMinutes = 0, minutesPerItem = DEFAULT_MINUTES_PER_ITEM } = {}) {
  const canAdmit = Math.max(0, Math.floor(remainingMinutes / minutesPerItem));
  const admitN = Math.min(Math.max(0, newItems), canAdmit);
  const deferN = Math.max(0, newItems) - admitN;
  return {
    admit: admitN, defer: deferN,
    why: deferN > 0
      ? `budget spent: ${deferN} of ${newItems} deferred — the shared human queue is full (${remainingMinutes} min left)`
      : `admitted ${admitN} within budget`,
  };
}

// AGE — read CW_NOW at call time. A stale undetermined is flagged, never silently equal to a fresh one.
const nowMs = () => (process.env.CW_NOW ? new Date(process.env.CW_NOW) : new Date()).getTime();
export function ageDays(ts, now = nowMs()) {
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return null;               // unknown age — not zero, not fresh
  return Math.max(0, (now - t) / 86400000);
}
export const STALE_DAYS = 30;
export function isStale(ts, { staleDays = STALE_DAYS, now = nowMs() } = {}) {
  const d = ageDays(ts, now);
  return d == null ? null : d >= staleDays;        // null = unknown, never a reassuring false
}
