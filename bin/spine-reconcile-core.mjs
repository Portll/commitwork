// bin/spine-reconcile-core.mjs — the DECISIONS, with no I/O. bin/spine-reconcile.mjs does the reading.
//
// THE QUESTION NOBODY WAS ASKING. gate-spine checks whether the spine store is READABLE. It has two
// witnesses engineered not to share a failure mode (bin/gate-spine-core.mjs:11-16) and both answer
// the same question: is the door open. Neither asks whether the room still contains what the ledger
// says was carried into it.
//
// Measured 2026-09-06/07 by hand, which is precisely why this file exists — a number a person
// re-derives is a number nobody re-checks. The spine ledger named 76 distinct plans; the store held
// ONE. So ~99% of attribution rows pointed at plans with no referent, while every gate reported the
// store healthy, because it WAS healthy: it opened, it answered, it was simply empty of the things
// the ledger claimed. That is not an outage signature and no outage check can see it.
//
// DANGLING IS NOT LOST. This module reports that a ledger row names a plan the store does not hold.
// It does NOT conclude the plan was destroyed. A plan may have been archived, pruned, or filed into
// a different store — three innocent explanations and at least one alarming one, and distinguishing
// them needs evidence this module does not have. Naming the observation rather than the cause is
// the difference between a finding and an accusation.
//
// ABSENCE IS NOT A FINDING. A store that is not there cannot evidence that anything went missing —
// "never installed" and "lost its contents" are different states and only the second is a fault.
// This mirrors bin/gate-spine-core.mjs, where ENOENT is UNKNOWN and never an outage, for the same
// reason: it is also the cheapest verdict for anyone to arrange, since deleting one file would buy
// a clean report.
//
// THIS IS A REPORTER, NOT A GATE. It never blocks. A dangling count is a fact for a human to act on,
// and a check that blocks on 99% of rows would be uninstalled within the day.

/** The verdicts. Five, because "no store", "no ledger" and "store holds everything" are not the same answer. */
export const STORE_ABSENT = 'store-absent';        // no store — UNKNOWN, never a finding
export const LEDGER_ABSENT = 'ledger-absent';      // no ledger — UNKNOWN, never a finding and never the store's fault
export const STORE_UNREADABLE = 'store-unreadable'; // present and could not be read — a fault
export const RECONCILED = 'reconciled';             // every ledger plan is present
export const DANGLING = 'dangling-referents';       // ledger names plans the store does not hold

/** A ledger row's plan id, or null. Defensive: a shape change must cost a row, never throw. */
export const planOf = (r) => (r && typeof r.plan === 'string' && r.plan ? r.plan : null);

/**
 * A row's `via` marker, verbatim, or null.
 *
 * `via` is present ONLY when a session reached the store by some route other than the tool. It is
 * absent on a normal filing. Measured: 8 of 1,452 rows carry it, all saying
 * *"spine/db.mjs direct — substrate MCP not attached to this session"*.
 *
 * THOSE EIGHT ROWS WERE TRUE, AND THAT IS THE WHOLE LESSON. bin/gate-spine-core.mjs's F-3 note
 * records that they were counted as proof the tool WAS reachable — somebody filed recently, so the
 * store must be up — and that reading granted a fleet-wide outage exemption. The rows were not
 * wrong. A field DESCRIBING AN OUTAGE was parsed as a LIVENESS SIGNAL, and the defect was entirely
 * in the consumer. On 2026-09-07 the config defect they were reporting was found and fixed
 * (mcpServers declared in a file the harness does not read MCP servers from), which makes those
 * eight rows eight independent contemporaneous witnesses to a real fault — the strongest evidence
 * in the ledger, inverted by the reading.
 *
 * So this module gives `via` a DEFINED MEANING rather than filtering it: a via row is evidence
 * about the ROUTE, it witnesses the tool being UNAVAILABLE and never available, and its stated
 * reason is preserved verbatim rather than summarised into a category. A marker whose text is
 * discarded can only ever be counted; one whose text survives can be read.
 */
export const viaOf = (r) => (r && typeof r.via === 'string' && r.via ? r.via : null);

/** Epoch ms for a row's clock, or null. */
const atOf = (r) => {
  const t = r && typeof r.at === 'string' ? Date.parse(r.at) : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * Reconcile what the ledger claims was filed against what the store holds.
 *
 * Pure: every input is already-read data — no fs, no env, no clock.
 *
 * @param ledgerRows    {Array|null} parsed ledger rows; null = ledger unreadable (or absent)
 * @param ledgerPresent {boolean}    whether the ledger FILE exists at all
 * @param storePlanIds  {Array|null} plan ids present in the store; null = store unreadable
 * @param storePresent  {boolean}    whether the store FILE exists at all
 */
export function reconcile({ ledgerRows, ledgerPresent = true, storePlanIds, storePresent = true }) {
  // Order matters. The store is decided before the ledger, for each absence before readability, and
  // all of it before any counting: a store that is not there cannot be called unreadable, and neither
  // can evidence a dangling referent.
  if (!storePresent) {
    return {
      verdict: STORE_ABSENT, grey: true, block: false,
      detail: 'no spine store on this box. A store that was never here cannot evidence that anything '
        + 'went missing — "not installed" and "lost its contents" are different states, and only the second is a fault.',
      planCount: null, storeCount: null, dangling: [], danglingRows: 0, present: [], coverage: null,
      bypass: { rows: null, reasons: [], witnesses: 'not assessed — the ledger was not walked' },
    };
  }
  if (!Array.isArray(storePlanIds)) {
    return {
      verdict: STORE_UNREADABLE, grey: true, block: false,
      detail: 'the spine store is present and could not be read. That is a fault on this box, and it '
        + 'is NOT an empty store — reporting zero plans here would invent a data-loss event.',
      planCount: null, storeCount: null, dangling: [], danglingRows: 0, present: [], coverage: null,
      bypass: { rows: null, reasons: [], witnesses: 'not assessed — the ledger was not walked' },
    };
  }
  // A ledger that was never written is UNKNOWN, as a store that was never installed is. Reporting it
  // as store-unreadable called absence a read fault and pinned it on the input that DID answer.
  if (!ledgerPresent) {
    return {
      verdict: LEDGER_ABSENT, grey: true, block: false,
      detail: 'no spine ledger on this box, so what was filed is UNKNOWN — not "nothing", and not a fault in the store, '
        + 'which answered. Check the PostToolUse hook that writes .claude/store/spine-touches.jsonl.',
      planCount: null, storeCount: storePlanIds.length, dangling: [], danglingRows: 0, present: [], coverage: null,
      bypass: { rows: null, reasons: [], witnesses: 'not assessed — there was no ledger to walk' },
    };
  }
  if (!Array.isArray(ledgerRows)) {
    return {
      verdict: STORE_UNREADABLE, grey: true, block: false,
      detail: 'the spine ledger could not be read, so what was filed is UNKNOWN — not "nothing". '
        + 'Check the PostToolUse hook that writes .claude/store/spine-touches.jsonl.',
      planCount: null, storeCount: storePlanIds.length, dangling: [], danglingRows: 0, present: [], coverage: null,
      bypass: { rows: null, reasons: [], witnesses: 'not assessed — the ledger was unreadable' },
    };
  }

  const held = new Set(storePlanIds.map(String));
  const rowsByPlan = new Map();
  // Route evidence, gathered over EVERY row including those with no plan: a bypass filing witnesses
  // the tool's availability whether or not it names a plan.
  const viaReasons = new Map();
  let bypassRows = 0;
  for (const r of ledgerRows) {
    const v = viaOf(r);
    if (v) {
      bypassRows += 1;
      const e = viaReasons.get(v) || { reason: v, rows: 0, plans: new Set() };
      e.rows += 1;
      const vp = planOf(r);
      if (vp) e.plans.add(vp);
      viaReasons.set(v, e);
    }
    const p = planOf(r);
    if (!p) continue;                       // a row with no plan is not evidence about any plan
    const e = rowsByPlan.get(p) || { rows: 0, newest: null };
    e.rows += 1;
    const t = atOf(r);
    if (t !== null && (e.newest === null || t > e.newest)) e.newest = t;
    rowsByPlan.set(p, e);
  }

  const dangling = [];
  const present = [];
  let danglingRows = 0;
  let presentRows = 0;
  for (const [plan, e] of rowsByPlan) {
    const entry = { plan, rows: e.rows, newest: e.newest === null ? null : new Date(e.newest).toISOString() };
    if (held.has(plan)) { present.push(entry); presentRows += e.rows; }
    else { dangling.push(entry); danglingRows += e.rows; }
  }

  // Deterministic ordering: worst first, then by id so equal counts never depend on Map insertion.
  const bySize = (a, b) => b.rows - a.rows || a.plan.localeCompare(b.plan);
  dangling.sort(bySize);
  present.sort(bySize);

  // Verbatim reasons, deterministically ordered. The text is the evidence; a category would lose it.
  const bypass = {
    rows: bypassRows,
    reasons: [...viaReasons.values()]
      .map((e) => ({ reason: e.reason, rows: e.rows, plans: [...e.plans].sort() }))
      .sort((a, b) => b.rows - a.rows || a.reason.localeCompare(b.reason)),
    // Stated on the result so no consumer has to re-derive it, and so the F-3 inversion cannot
    // recur by a reader assuming the obvious-but-backwards direction.
    witnesses: 'the tool being UNAVAILABLE on that route. A via row is never evidence that the tool was reachable.',
  };

  const planCount = rowsByPlan.size;
  const totalRows = danglingRows + presentRows;
  // Coverage is over ROWS, not plans: one heavily-filed plan going dangling costs more than one
  // stray. Reported alongside the plan counts so neither can stand in for the other.
  const coverage = totalRows === 0 ? null : presentRows / totalRows;

  if (dangling.length === 0) {
    return {
      verdict: RECONCILED, grey: false, block: false,
      detail: planCount === 0
        ? 'the ledger names no plans, so there is nothing to reconcile — this is not a clean bill of health.'
        : `every one of the ${planCount} plan(s) the ledger names is present in the store.`,
      planCount, storeCount: held.size, dangling, danglingRows, present, coverage, bypass,
    };
  }

  return {
    verdict: DANGLING, grey: false, block: false,
    detail: `${dangling.length} of ${planCount} plan(s) the ledger names are NOT in the store, `
      + `covering ${danglingRows} of ${totalRows} filing(s). DANGLING IS NOT LOST: a plan may have been `
      + 'archived, pruned, or filed into a different store. What is established is that the attribution '
      + 'record and the store no longer describe the same set of plans, which no readability check can see.',
    planCount, storeCount: held.size, dangling, danglingRows, present, coverage, bypass,
  };
}

/** One line per verdict, for a human. Never collapses grey into either direction. */
export function summarise(r) {
  if (r.verdict === STORE_ABSENT) return 'spine store absent — UNKNOWN, not a finding';
  if (r.verdict === LEDGER_ABSENT) return 'spine ledger absent — UNKNOWN, not a finding';
  if (r.verdict === STORE_UNREADABLE) return 'spine store or ledger unreadable — a fault, not an empty store';
  if (r.verdict === RECONCILED) {
    return r.planCount === 0
      ? 'ledger names no plans — nothing to reconcile (not a clean result)'
      : `reconciled: ${r.planCount} plan(s), all present`;
  }
  const pct = r.coverage === null ? 'n/a' : `${(r.coverage * 100).toFixed(1)}%`;
  return `DANGLING: ${r.dangling.length}/${r.planCount} plan(s) absent from the store, `
    + `${r.danglingRows} filing(s) affected, ${pct} of filings still resolve`;
}
