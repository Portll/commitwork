// THE SESSION LIFECYCLE LEXICON — what can be established about another agent, and what cannot.
//
// The operator asked for live / asleep / down / deleted / cleared / terminated / disappeared. Most
// of those are NOT separable by anything this machine can observe, and a view that prints them as if
// they were would be the defect this whole cycle has been removing: a confident label over evidence
// that does not support it. So the lexicon declares each state WITH THE SIGNAL THAT ESTABLISHES IT,
// and where two of the operator's words collapse into one observable it says so and names what
// evidence would separate them.
//
// THREE SIGNALS EXIST, measured 2026-08-30:
//   socket     /tmp/cc-socks/<pid>.sock — the session is ADDRESSABLE. Presence is not liveness: a
//              socket outlives a wedged process.
//   marker     /tmp/claude-session-state/<id>.closed — the session SAID it was finishing. Present
//              only for a clean, cooperative exit; its absence proves nothing.
//   ledger     the newest .claude/store/touches.jsonl row for that id — the session ACTED. Silence
//              is ambiguous: idle and dead look identical.
//
// The discriminator that actually works is the PAIR (socket, marker): a session that acted and then
// vanished WITHOUT a marker ended in a way nobody recorded, which is the operator's "disappeared"
// and is worth separating from a clean close.

/** How stale a session's newest ledger row may be before it is no longer "acting". */
export const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

export const SESSION_STATES = {
  live: {
    signal: 'socket present AND newest ledger row inside ACTIVE_WINDOW_MS',
    means: 'addressable and acting',
    certainty: 'observed',
  },
  idle: {
    signal: 'socket present, no ledger row inside the window',
    means: 'addressable, not currently acting',
    certainty: 'observed',
    note: 'the operator\'s "asleep". Do NOT read as unavailable — a message may still be answered.',
  },
  closed: {
    signal: '.closed marker present',
    means: 'the session declared it was finishing',
    certainty: 'self-declared',
    note: 'the operator\'s "terminated", but only the COOPERATIVE case. A session killed outright writes no marker.',
  },
  disappeared: {
    signal: 'ledger activity exists, but no socket AND no .closed marker',
    means: 'it acted, then ended without recording that it had',
    certainty: 'inferred from absence',
    note: 'CONFLATES the operator\'s down / deleted / cleared / killed. Nothing on this machine separates them — a crash, a kill, a cleared context and a deleted workspace all leave exactly this: no socket, no marker, old rows. Separating them needs a signal that does not exist here, e.g. the harness writing an exit reason.',
  },
  unknown: {
    signal: 'no socket, no marker, no ledger rows',
    means: 'nothing has ever been established about this id',
    certainty: 'none',
    note: 'NOT the same as disappeared. Absence of a record is not a record of absence — the id may be from another checkout, or never have run.',
  },
};

export const STATE_NAMES = new Set(Object.keys(SESSION_STATES));

/**
 * Classify one session from its signals. Pure.
 *
 * Order matters and is argued rather than incidental:
 *   1. A MARKER beats everything. A session that said it was finishing has finished, even if its
 *      socket has not been reaped yet — its own statement outranks our inference.
 *   2. A SOCKET means addressable, and activity then splits live from idle.
 *   3. No socket and no marker, but rows exist ⇒ disappeared.
 *   4. Nothing at all ⇒ unknown, which is NOT disappeared.
 */
export function classifySession({ hasSocket = false, hasMarker = false, lastRowAt = null, now = Date.now() } = {}) {
  if (hasMarker) return 'closed';
  const acted = lastRowAt != null && Number.isFinite(Date.parse(lastRowAt));
  if (hasSocket) {
    const fresh = acted && (now - Date.parse(lastRowAt)) <= ACTIVE_WINDOW_MS;
    return fresh ? 'live' : 'idle';
  }
  return acted ? 'disappeared' : 'unknown';
}

/** States that mean "do not wait on this session" — for a caller deciding whether to block. */
export const ENDED = new Set(['closed', 'disappeared']);

/** States where a message may still be answered. */
export const REACHABLE = new Set(['live', 'idle']);
