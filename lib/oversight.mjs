// lib/oversight.mjs — what a human oversight record IS. Pure: no fs, no clock, no env.
//
// THE LEDGER IS NOT NEW. bin/verdict-journal.mjs is already an append-only hash chain: every
// record carries `prev` (sha256 of the previous line, 32 hex), a fresh file starts at 'genesis',
// a rotation carries 'rotation:<hash>', the tail-read and the append happen under one lock so two
// writers cannot both claim the same `prev`, and readJournal already partitions a chain into
// verified / broken / raced / unchained. Oversight records ride THAT chain, because a second
// ledger with its own chain would be a second implementation of the only property that matters.
//
// WHAT THIS FILE ADDS is the contract for the record itself.
//
// 1. AN OVERSIGHT IS NOT A SUPPRESSION. monitor/annotate-lib.mjs already owns the actions that
//    hide a row (accept / false-positive / wont-fix / incorrect-scan-result). Oversight hides
//    nothing: it states that a human read a determination somebody else made and says whether
//    they stand behind it. Keeping the two vocabularies apart is the point, because a mechanism
//    that both attests and suppresses lets "I reviewed this" quietly delete it.
//
// 2. IT CAN DISAGREE. `corroborate` and `dispute` are both first-class. An oversight step that
//    can only agree is a rubber stamp, and a ledger full of them proves attendance rather than
//    review. `dispute` is what makes the corroborations worth reading.
//
// 3. IT NAMES WHAT IT SAW. `basis` is required: which determination, read where. An attestation
//    with no basis is a signature on a blank page.
//
// 4. IDENTITY EXCLUDES `line`, like every other identity in this repository. Code moves for
//    reasons that have nothing to do with the finding, and a line-keyed attestation silently
//    detaches from the thing it signed the next time somebody edits above it.
//
// 5. ABSENCE IS ITS OWN STATE, and it is the common one. overseenBy() returns a state of
//    'none' | 'corroborated' | 'disputed' | 'mixed', never a boolean: "nobody has looked" and
//    "somebody looked and disagreed" are opposite facts, and a boolean renders them identically.

export const STANCES = Object.freeze(['corroborate', 'dispute']);

/** rule + place, never the line. The same shape the scanner-annotation identities are built on. */
export function subjectKey(s) {
  if (!s || typeof s !== 'object') return null;
  const parts = [s.repo, s.file, s.rule, s.package].map((x) => (x == null ? '' : String(x)));
  // NUL separator, written as an escape so this file stays TEXT: a literal one made git treat a
  // source file as binary (Bin 0 -> 5013 bytes), which would have shipped unreviewable. NUL and
  // not a space because file paths may contain spaces, and a separator that can occur inside a
  // part makes two different subjects collide on one key.
  return parts.some((p) => p !== '') ? parts.join('\u0000') : null;
}

const nonEmpty = (x) => typeof x === 'string' && x.trim() !== '';

/** -> { errors: [] }. Callers decide whether to write; this decides whether it is a record at all. */
export function validateOversight(r) {
  const errors = [];
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    errors.push('oversight record is not an object');
    return { errors };
  }
  if (!STANCES.includes(r.stance)) {
    errors.push(`stance must be one of ${STANCES.join(', ')} - got ${JSON.stringify(r.stance)}`);
  }
  if (!nonEmpty(r.who)) {
    errors.push('who is required - an unattributed attestation attests nothing, and it comes from the session, never the request body');
  }
  if (!nonEmpty(r.basis)) {
    errors.push('basis is required - name the determination you read and where. An attestation with no basis is a signature on a blank page');
  }
  if (!subjectKey(r.subject)) {
    errors.push('subject must name at least one of repo/file/rule/package');
  }
  if (r.subject && r.subject.line !== undefined) {
    errors.push('subject.line is not part of an oversight identity - code moves for reasons unrelated to the finding');
  }
  if (r.suppress !== undefined) {
    errors.push('oversight never suppresses - use the scanner-annotation vocabulary for that, and keep the two apart');
  }
  return { errors };
}

/**
 * Fold the ledger's oversight records for one subject.
 * -> { state, corroborated: [], disputed: [] }. NEVER a boolean.
 */
export function overseenBy(records, subject) {
  const key = subjectKey(subject);
  if (!key) return { state: 'none', corroborated: [], disputed: [], reason: 'subject names nothing' };
  const mine = (records || []).filter((r) => r && subjectKey(r.subject) === key && STANCES.includes(r.stance));
  // Last stance per person wins. Somebody who corroborates and later disputes has changed their
  // mind; counting both would put one reviewer on both sides of their own review.
  const latest = new Map();
  for (const r of mine) latest.set(r.who, r.stance);
  const corroborated = [...latest].filter(([, s]) => s === 'corroborate').map(([w]) => w).sort();
  const disputed = [...latest].filter(([, s]) => s === 'dispute').map(([w]) => w).sort();
  let state = 'none';
  if (corroborated.length && disputed.length) state = 'mixed';
  else if (disputed.length) state = 'disputed';
  else if (corroborated.length) state = 'corroborated';
  return { state, corroborated, disputed };
}
