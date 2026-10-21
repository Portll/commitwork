// bin/gate-spine-core.mjs — the DECISIONS, with no I/O. bin/gate-spine.mjs does the reading.
// Every decision is journalled (bin/verdict-journal.mjs) and assess() reads that history back:
// a block answered by a task that never leaves `pending` is a decoy, not compliance.

/** A gate verdict. `block` is the only field the caller turns into exit 2. */
const verdict = (block, reason, detail, extra = {}) => ({ block, reason, detail, ...extra });

/**
 * Was overwatch-layer REACHABLE at all, on the evidence? Pure — the caller does the stat and the clock.
 *
 * Two witnesses that cannot share a failure mode, which is the whole point:
 *   · the spine ledger — written by THIS repo's PostToolUse hook, by every session on this machine
 *   · tasks.db mtime   — written by the overwatch-layer SERVER itself, a different process in a different
 *                        repository, on a path this repo does not own
 * If the hook were uninstalled the db would still advance; if overwatch-layer died both stall. Only BOTH
 * stalling is an outage, so neither witness alone can grant the exemption.
 *
 * WHY FLEET-WIDE AND NEVER PER-SESSION: this is the one branch that turns a block into a pass, so
 * it is the one an agent under pressure will try to trip. It is therefore keyed ONLY to evidence
 * the judged session does not author — every session's rows, and a file another process writes. A
 * session cannot make its peers stop filing for a day, and touching tasks.db to look busier fails
 * TOWARD blocking. Absence of a witness is `unknown`, never `false`.
 *
 * @param spineRows {Array|null} EVERY session's spine rows (not just this session's)
 * @param dbMtimeMs {number|null|undefined} tasks.db mtime; null = absent (ENOENT), undefined = unreadable — both UNKNOWN
 * @param now       {number} epoch ms, caller-supplied so CW_NOW keeps this deterministic
 * @param outageMs  {number} how stale both witnesses must be before this is called an outage
 * @returns {true|false|'unknown'}
 */
export function overwatchReachability({ spineRows, dbMtimeMs, now, outageMs }) {
  if (!Number.isFinite(now) || !Number.isFinite(outageMs) || outageMs <= 0) return 'unknown';
  // No ledger, or a ledger that has never recorded anything, cannot evidence an outage: the
  // existing spine-ledger-absent arm already owns that case and reports it as a broken recorder.
  if (!Array.isArray(spineRows) || spineRows.length === 0) return 'unknown';
  // F-3 (FourEyes, 2026-08-30) · A ROW FILED BY A BYPASS CANNOT WITNESS THE TOOL'S REACHABILITY.
  // `via` records the route when it is NOT the default one — it is absent on a normal MCP filing and
  // present only when a session reached the store another way. Measured: 4 of 1,436 rows carry it,
  // and all four say *"spine/db.mjs direct — substrate MCP not attached to this session"*  // verbatim: a quoted stored value. This
  // function read only `at`, so those four were counted as "somebody filed recently ⇒ demonstrably
  // reachable" — a row explicitly stating the tool was UNAVAILABLE, granting fleet-wide proof that it
  // was available, and denying the outage exemption to every session for a full outage window.
  //
  // The evidence that would have flipped the verdict was on the row, and no reader consulted it.
  // That is this cycle's defect in its purest form, inside the guard that enforces it elsewhere.
  const viaTool = spineRows.filter((r) => !(r && r.via));
  if (viaTool.length === 0) return 'unknown';   // every row came by a bypass ⇒ nothing witnesses the tool
  const newest = viaTool.reduce((m, r) => {
    const t = r && typeof r.at === 'string' ? Date.parse(r.at) : NaN;
    return Number.isFinite(t) && (m === null || t > m) ? t : m;
  }, null);
  if (newest === null) return 'unknown';          // rows exist but none carries a usable clock
  if (now - newest < outageMs) return true;       // somebody filed recently ⇒ demonstrably reachable

  // Ledger is stale. Ask the second witness before concluding anything.
  if (dbMtimeMs === undefined) return 'unknown';  // unreadable ⇒ fail closed, no exemption
  // ENOENT is UNKNOWN, not an outage. A store that was never there cannot evidence that overwatch-layer
  // stopped — "never installed" and "died" are different states, and only the second is an outage.
  // It is also the cheapest exemption anyone could arrange, since deleting one file outside this
  // repo would buy a pass; requiring a PRESENT-but-stale store means the evidence must be produced
  // rather than removed. Absence of a witness is never a verdict.
  if (dbMtimeMs === null) return 'unknown';
  if (!Number.isFinite(dbMtimeMs)) return 'unknown';
  if (now - dbMtimeMs < outageMs) return true;    // server active though the hook is silent
  return false;                                   // both witnesses stalled ⇒ fleet-wide outage
}

/**
 * Decide. Pure: every input is already-read data — no fs, no env, no clock.
 *
 * @param edits      {number} files THIS session touched (touch ledger, this session's rows only)
 * @param spineRecords {Array} this session's overwatch-layer calls: [{task, plan, at, kind}]
 * @param tasks      {Array|null} task rows for those ids: [{id, status}]; null = store unreadable
 * @param history    {Array} prior gate-spine journal records, oldest first
 * @param minEdits   {number} the threshold below which a session is not yet "substantive"
 * @param ledgerPresent {boolean} whether the touch ledger could be read at all
 */
export function assess({
  edits, spineRecords = [], tasks = null, history = [], minEdits = 5, ledgerPresent = true,
  spineLedgerPresent = true, spineLedgerCorrupt = false, overwatchReachable = 'unknown',
}) {
  // Fail OPEN, deliberately: a wrong block gets the hook uninstalled. Unreadable sensors report
  // grey, never block, and never read as clean.
  if (!ledgerPresent) {
    return verdict(false, 'sensor-absent',
      'the touch ledger could not be read, so "did this session edit anything" is UNKNOWN — not "no". '
      + 'Check the PostToolUse hook that writes .claude/store/touches.jsonl.', { grey: true });
  }
  if (edits < minEdits) {
    return verdict(false, 'below-threshold',
      `${edits} file(s) touched; a session is not substantive until ${minEdits}. Nothing to require yet.`);
  }
  // Corrupt ledger (recorder broken) and absent ledger (recorder not installed) are distinct
  // faults with opposite fixes; both fail open.
  if (spineLedgerCorrupt) {
    return verdict(false, 'spine-ledger-unreadable',
      'the overwatch-layer ledger exists but not one line of it parses, so this gate cannot tell what was '
      + 'filed. That is a CORRUPT recorder, not an absent one and not an idle session — check the '
      + 'file itself (.claude/store/spine-touches.jsonl) rather than the hook that writes it.',
      { grey: true });
  }
  if (!spineLedgerPresent) {
    return verdict(false, 'spine-ledger-absent',
      'no overwatch-layer activity has EVER been recorded here, which means the recorder is not running rather '
      + 'than that nothing was filed. Check the PostToolUse hook for mcp__spine__* that writes '
      + '.claude/store/spine-touches.jsonl — until it fires, this gate cannot tell compliance from silence.',
      { grey: true });
  }
  if (tasks === null && spineRecords.length === 0) {
    // Never block on a blind sensor: "filed nothing" and "cannot see" are indistinguishable here.
    return verdict(false, 'store-unreadable',
      'the overwatch-layer task store could not be read, so whether this session filed anything is UNKNOWN. '
      + 'Not treated as "filed nothing".', { grey: true });
  }

  // NOWHERE TO FILE ≠ NOTHING FILED. Both look like zero records from here, and they warrant
  // opposite responses: one is a session skipping the discipline, the other is the discipline
  // having no mechanism. Blocking the second teaches the reader that this gate can be unclearable,
  // which is how a gate stops being read at all.
  // Deliberately NOT green: it is grey, it is journalled under its own verdict so a persisting
  // outage is countable rather than forgotten, and it names the days so the message re-emits as it
  // ages instead of settling into say-once wallpaper. An exemption that outlives its reason is the
  // failure this repo files as R12.
  if (spineRecords.length === 0 && overwatchReachable === false) {
    // The id was `substrate-unreachable` until 2026-08-30. Renamed for the public release; the
    // ADJUDICATION SAMPLER STILL ACCEPTS BOTH, because 8 records already on disk carry the old one
    // and a classifier that stopped recognising them would silently move historical greys into the
    // unclassified remainder. Expand now, contract only once no stored record uses it.
    return verdict(false, 'overwatch-unreachable',
      'this session filed nothing AND the overwatch-layer looks unreachable fleet-wide — no '
      + 'session has filed a spine record and the task store has not been written for over the outage '
      + 'window. That is NOWHERE TO FILE, not nothing filed, so it is reported rather than blocked. '
      + "Restore the overwatch-layer's MCP server, then this gate resumes blocking on the "
      + 'next session that skips it.',
      { grey: true, outage: true });
  }

  // Attribution comes from THIS session's own spine records — a repo-scoped check reads other
  // sessions' activity as compliance.
  if (spineRecords.length === 0) {
    return verdict(true, 'no-spine-record',
      `${edits} files edited and nothing filed in the fleet's task spine. The work exists only here.`);
  }

  // Feedback arm: only records filed after the last block count as a response.
  // tasks === null means store unreadable — no evidence is not adverse evidence, so skip the check.
  const lastBlock = tasks === null ? null : [...history].reverse().find((h) => h.block === true);
  if (lastBlock) {
    const since = lastBlock.at;
    const filedAfter = spineRecords.filter((r) => !since || r.at > since);
    const ids = new Set(filedAfter.map((r) => r.task).filter(Boolean));
    const moved = (tasks || []).filter((t) => ids.has(t.id) && t.status !== 'pending');
    if (filedAfter.length && ids.size && moved.length === 0) {
      return verdict(true, 'decoy-suspected',
        `${ids.size} task(s) were filed after the last block and none has left \`pending\`. `
        + 'A task filed only to clear this gate is the cheapest way to satisfy it; that is what this '
        + 'arm exists to name. Set a real status, or say why the work is not started.',
        { taskIds: [...ids] });
    }
  }

  return verdict(false, 'satisfied',
    `${edits} files edited, ${spineRecords.length} spine record(s) filed by this session.`);
}

/** The message a caller emits. Kept beside the decision so the two cannot drift. */
export function render(v, { minEdits = 5 } = {}) {
  if (!v.block) {
    // explicit uncertainty: an unknown verdict must read differently from a clean one.
    return v.grey ? `spine gate: UNKNOWN — ${v.detail}` : `spine gate: ${v.detail}`;
  }
  if (v.reason === 'decoy-suspected') {
    return `spine gate: ${v.detail}`;
  }
  return `spine gate: ${v.detail} Create or reuse a plan and put the work in it — `
    + '`mcp__spine__list_plans`, then `create_task` with a planId. '
    + `Threshold is ${minEdits} edited files (CW_SPINE_MIN_EDITS).`;
}
