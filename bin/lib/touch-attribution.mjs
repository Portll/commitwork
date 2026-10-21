// Hunk-level attribution over the touch ledger — P2 + O2 of cw-overlook-hunkplan-20260819.
//
// WHAT THIS DELIBERATELY DOES NOT DO. The bifocal verdict was: capture the fingerprints (free), do
// NOT promise hunk ownership on top of them. This module keeps that promise. It answers "is this
// recorded edit still standing, or was it replaced, or can we not tell" — three states — and it
// never returns a single confident owner for a line of code.
//
// WHY THERE IS NO `MATCHED` STATE. The plan named MATCHED as "fingerprint present in the working
// tree". It is not derivable: the ledger stores sha256 of the hunk, never the hunk, and a hash
// cannot be searched for in a file. Storing the text would put source content — including whatever
// a secret-bearing edit contained — into a gitignored append-only log that no scanner reads. So the
// affirmative state here is STANDING ("recorded, nothing in the chain replaced it"), which is
// weaker than MATCHED and is labelled weaker. Calling it MATCHED would be the false-clean move this
// repo exists to prevent.
//
// The state that must never be collapsed is SUPERSEDED. "Someone replaced my edit" and "I cannot
// tell what happened to my edit" are different facts, and merging them into one is the whole
// failure this design was written to avoid.

export const STATE = Object.freeze({
  STANDING: 'standing',        // recorded; no later record claims to have replaced it
  SUPERSEDED: 'superseded',    // a later record's `h` equals this record's `n` — the chain PROVES replacement
  UNKNOWN: 'unknown',          // recorded; a later whole-file write makes its fate undecidable
});

/** Ledger rows for one file, oldest first. Rows without `n` carry no hunk claim and are dropped. */
export const rowsForFile = (rows, file) => (rows || [])
  .filter((r) => r && r.f === file)
  .slice()
  .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));

/**
 * Attribute each recorded hunk claim on `file` to one of three states.
 *
 * Returns [{ n, h, at, session, tool, state, supersededBy }] oldest first. `supersededBy` is the
 * session whose edit consumed this one's output, and is null in every other state — an empty field
 * beside SUPERSEDED would read as "replaced by nobody".
 */
export function attributeFile(rows, file) {
  const all = rowsForFile(rows, file);
  const claims = all.filter((r) => r.n);
  const out = [];

  for (let i = 0; i < claims.length; i++) {
    const r = claims[i];
    const later = claims.slice(i + 1);

    // The chain: a later edit whose REPLACED text is this edit's WRITTEN text. This is the only
    // positive proof available, and it is exact — no heuristics, no line numbers.
    const by = later.find((x) => x.h && x.h === r.n);
    if (by) {
      out.push({ ...pick(r), state: STATE.SUPERSEDED, supersededBy: by.s || null });
      continue;
    }

    // A whole-file write after this claim obliterates hunks without leaving a chain link, so its
    // fate is genuinely undecidable rather than intact. Reporting STANDING here would be a guess
    // dressed as a finding.
    if (later.some((x) => x.t === 'write')) {
      out.push({ ...pick(r), state: STATE.UNKNOWN, supersededBy: null });
      continue;
    }

    out.push({ ...pick(r), state: STATE.STANDING, supersededBy: null });
  }
  return out;
}

const pick = (r) => ({ n: r.n, h: r.h ?? null, at: r.at ?? null, session: r.s ?? null, tool: r.t ?? null });

/**
 * Who has a STANDING claim on this file, and who is merely recorded against it.
 * Returns a candidate SET, never one owner — boilerplate and repeated edits make single ownership
 * unanswerable, and a confident wrong owner is worse than an honest set.
 */
export function claimants(rows, file) {
  const attributed = attributeFile(rows, file);
  const standing = new Set();
  const superseded = new Set();
  const unknown = new Set();
  for (const a of attributed) {
    if (a.state === STATE.STANDING) standing.add(a.session);
    else if (a.state === STATE.SUPERSEDED) superseded.add(a.session);
    else unknown.add(a.session);
  }
  // A session that also touched the file WITHOUT a fingerprint (a Bash commit row, say) is recorded
  // but makes no hunk claim. It belongs in `touched`, never in `standing`.
  const touched = new Set(rowsForFile(rows, file).map((r) => r.s).filter(Boolean));
  return {
    standing: [...standing].filter(Boolean).sort(),
    superseded: [...superseded].filter(Boolean).sort(),
    unknown: [...unknown].filter(Boolean).sort(),
    touched: [...touched].sort(),
  };
}

/**
 * O2 — D12's repair loop. Re-observe at gate time instead of trusting a stored verdict.
 *
 * D12's ruling was that an identity must not freeze an observation: the line is demoted to an
 * observation and given a memory. Same shape here — an attribution computed once and cached goes
 * stale the moment anyone edits the file, and a stale SUPERSEDED is a false accusation. So this
 * takes the CURRENT rows every time and reports what changed since a prior reading, rather than
 * letting the prior reading stand.
 */
export function reobserve(priorAttribution, rows, file) {
  const now = attributeFile(rows, file);
  const byKey = new Map(now.map((a) => [a.n, a]));
  const changes = [];
  for (const p of priorAttribution || []) {
    const cur = byKey.get(p.n);
    if (!cur) { changes.push({ n: p.n, from: p.state, to: 'absent', why: 'the claim is no longer in the ledger — rotation, or a reader that did not walk the chain' }); continue; }
    if (cur.state !== p.state) changes.push({ n: p.n, from: p.state, to: cur.state, why: `re-observed at gate time; supersededBy=${cur.supersededBy ?? 'none'}` });
  }
  return { attribution: now, changes };
}
