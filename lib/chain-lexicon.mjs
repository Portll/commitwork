// lib/chain-lexicon.mjs — the ONE vocabulary for ledger-chain state, and the band each label sits in.
//
// WHY A BAND AND NOT JUST A LABEL. Consumers rank state to decide whether to alarm. Ranking on the
// LABEL means every label added later lands on the consumer's default, and the default is a guess
// made before the label existed. Measured 2026-09-06 at monitor/liveness.mjs:312-314:
//
//   const GATE_RANK = { ok: 0, 'absent-not-running': 0, torn: 1,
//                       'stale-baseline-moved': 3, unreadable: 3, 'chain-broken': 3 };
//   const r = GATE_RANK[g.state] ?? 3;      (r >= 1 ? console.error : console.log)
//
// One literal, both halves of the house invariant broken in opposite directions: an unrecognised
// state defaults to 3 — the same rank as a FORGED ledger — so every label added downstream alarms
// the fleet; and 'absent-not-running' ranks 0, so a gate that never ran reads exactly as healthy as
// one that passed. Grey read as red, and absence read as green, in six key-value pairs.
//
// Bands are a CLOSED set of six. Labels are open and expected to grow. Rank on the band and a new
// label cannot alarm anything; rank on the label and every addition is a fleet-wide incident.
//
// THE UNDETERMINED BAND IS THE POINT. It is not "mildly bad" — it is the absence of evidence, and
// it must render as neither sound nor forged. CLAUDE.md: "Undetermined belongs in its own field,
// outside crit/high/med/low, with the original claim preserved rather than erased."
//
// VOCABULARY IS REUSED, NOT INVENTED. `never-measured`, `no-subject`, `undetermined`, `absent` and
// `unreadable` were already the fleet's words for these states (admin/lib/served-projection.mjs:45,
// monitor/a11y-attestations.mjs:47, monitor/forensics.mjs:113, monitor/defence-vector.mjs:28,
// monitor/set-difference.mjs:149). A second synonym for a state that already has a name is the same
// defect as a second implementation of a verifier that already exists.

/** Ordered worst-last. `order` is for DISPLAY sorting; `rank` is for alarm decisions. */
export const BANDS = Object.freeze({
  sound:        { order: 0, rank: 0, means: 'positively verified' },
  degraded:     { order: 1, rank: 1, means: 'honestly written, not chainable' },
  undetermined: { order: 2, rank: 1, means: 'no evidence either way — never sound, never forged' },
  damaged:      { order: 3, rank: 1, means: 'physical loss, not an edit' },
  suspect:      { order: 4, rank: 3, means: 'changed, cause undetermined' },
  forged:       { order: 5, rank: 3, means: 'positively contradicted' },
});

// rank is deliberately NOT `order`. liveness.mjs alarms at `>= 1` and treats 3 as its ceiling; a
// 0..5 scale would silently re-tier every existing consumer. undetermined ranks 1 — VISIBLE, never
// silent (that is the grey-reads-as-green fix) and never 3 (that is the grey-reads-as-red fix).

/** label -> band. Adding a row here is the ONLY way a new state enters the system. */
export const LABELS = Object.freeze({
  intact:            'sound',
  'intact-extended': 'sound',
  renumbered:        'sound',
  raced:             'sound',
  unlinked:          'degraded',
  unchained:         'degraded',
  unverifiable:      'undetermined',
  'never-measured':  'undetermined',
  'no-subject':      'undetermined',
  absent:            'undetermined',
  unreadable:        'undetermined',
  torn:              'damaged',
  gapped:            'damaged',
  extended:          'suspect',
  'row-removed':     'suspect',
  // Not a chain defect — the chain is intact. The BASELINE advanced past the journal's last entry,
  // so a decision was made that the audit trail never received. Evidence that should exist does
  // not, which is `suspect`, not `undetermined`: we know something is missing, we do not know why.
  // Ranks 3 today (monitor/liveness.mjs:312) and `suspect` ranks 3, so behaviour is unchanged.
  // Found by lib/test/chain-lexicon.test.mjs reading liveness.mjs rather than by reading this list.
  'stale-baseline-moved': 'suspect',
  truncated:         'forged',
  rewritten:         'forged',
  broken:            'forged',
});

/** Legacy state strings that predate this module. Kept so a consumer comparing by value — e.g.
 *  admin/routes/verdicts.mjs:42 `h.state !== 'ok' && h.state !== 'torn'`, which decides whether
 *  records are fetched AT ALL — does not silently stop matching. Renaming without these would blank
 *  the panel for every healthy gate with no error and no log. */
export const ALIASES = Object.freeze({
  ok: 'intact',
  'chain-broken': 'broken',
  'absent-not-running': 'never-measured',
});

/** Resolve an alias to its canonical label; a canonical label passes through unchanged. */
export function canonical(label) {
  return Object.prototype.hasOwnProperty.call(ALIASES, label) ? ALIASES[label] : label;
}

/**
 * The band for a label. An UNKNOWN label resolves to `undetermined` — never to the worst band.
 *
 * This is the whole argument of this module in one line. A label nobody has classified is a thing
 * we know nothing about, which is the definition of undetermined; sending it to `forged` publishes
 * a critical about a state that has not been assessed, and sending it to `sound` publishes a pass.
 * Both are the fabrication the house rules name. The caller can tell the two apart via `known`.
 */
export function bandOf(label) {
  const c = canonical(label);
  const band = Object.prototype.hasOwnProperty.call(LABELS, c) ? LABELS[c] : null;
  return band
    ? { label: c, band, known: true, ...BANDS[band] }
    : { label: c, band: 'undetermined', known: false, ...BANDS.undetermined };
}

/** Alarm rank for a state string. Keyed on the band, so a new label can never re-tier a consumer. */
export function rankOf(label) {
  return bandOf(label).rank;
}

/** Every canonical label, in display order then alphabetically — a stable, deterministic listing. */
export function scale() {
  return Object.keys(LABELS)
    .map((label) => bandOf(label))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}
