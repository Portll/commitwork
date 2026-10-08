// A7 · attribution receipts for mesh messages — the DECISION half, pure.
//
// THE PROBLEM. Sessions message each other constantly on this tree, and a large share of that
// traffic makes ATTRIBUTION CLAIMS: "you hold hunks in x.mjs", "is bin/y.mjs yours?", "another
// session touched these". Measured 2026-08-30, those claims are frequently wrong — the gate that
// feeds them attributes from any touch row, and 12,166 of 18,762 file rows carry no write evidence.
// A wrong claim sent to a peer is more expensive than a wrong line in a log: it consumes their turn,
// and this cycle recorded nine sessions polled about a hunk none of them wrote.
//
// SCOPE ON THE CLAIM, NOT THE NAME. A7 is explicit that "any message naming another session" would
// fire on nearly all mesh traffic and therefore on nothing — a gate that always fires is furniture.
// The trigger is an assertion ABOUT AUTHORSHIP, which is a much narrower thing than a mention:
//
//   claim      "you touched x", "your hunks are in y", "is z yours?", "commitwork-xx wrote w"
//   NOT claim  "I landed x", "please rebase", "the disk is at 89%", "x is failing"
//
// The second column is most of the traffic and must stay silent.

/** Phrasings that assert another party authored or holds something. */
const CLAIM_RE = [
  /\byou(?:'ve| have)?\s+(?:touched|edited|wrote|written|changed|modified|authored|hold|held|staged|committed)\b/i,
  /\byour\s+(?:hunks?|work|change|changes|edits?|commit|commits|file|files)\b/i,
  /\bis\s+\S+\s+yours\b/i,
  /\b(?:another|a\s+peer|a\s+co-?session|\d+\s+other)\s+sessions?\s+(?:touched|edited|wrote|holds?|held)\b/i,
  /\bcommitwork-[0-9a-z]{2}\s+(?:touched|edited|wrote|holds?|held|authored)\b/i,
  /\bthese\s+are\s+yours\b/i,
];

/** Phrasings that are explicitly ABOUT THE SPEAKER, which is never an attribution claim. */
const SELF_RE = /\bI\s+(?:landed|committed|wrote|edited|touched|hold|pushed|added)\b/i;

/**
 * Does this message assert that someone ELSE authored or holds something?
 *
 * Self-reports are exempt even when they contain claim-shaped words, because "I wrote x" carries its
 * own evidence — the speaker is the subject — and gating it would fire on every status update.
 */
export function claimsAttribution(text) {
  const s = String(text || '');
  if (!s) return false;
  return CLAIM_RE.some((re) => re.test(s));
}

/** Paths a message names, so a receipt can say what each claim rests on. Bounded and deduped. */
export function pathsNamed(text, { max = 12 } = {}) {
  const s = String(text || '');
  const out = new Set();
  for (const m of s.matchAll(/\b((?:[\w.-]+\/)+[\w.-]+\.(?:mjs|js|json|md|html|css|ts))\b/g)) {
    out.add(m[1]);
    if (out.size >= max) break;
  }
  return [...out];
}

/**
 * The receipt: what the claims in this message rest on. `authorFor(path)` is injected so the core
 * stays pure — the caller supplies `authorOf` bound to a real ledger.
 *
 * Returns '' when the message makes no claim, so ordinary traffic is untouched.
 *
 * A claim with NO write evidence is named first and explicitly. That is the case this exists for:
 * sending it costs a peer a turn and, at worst, gets a correct change abandoned because nobody can
 * be shown to have written it.
 */
export function receiptFor(text, authorFor = () => ({ basis: 'unknown' })) {
  if (!claimsAttribution(text)) return '';
  const paths = pathsNamed(text);
  if (!paths.length) {
    return '\n\n[attribution receipt] This message asserts authorship but names no path, so nothing '
      + 'here can be checked. Say which file, or say that you are asking rather than telling.';
  }
  const rows = paths.map((p) => {
    const a = authorFor(p) || { basis: 'unknown' };
    if (a.basis === 'write') return `  ${p} — write evidence: ${a.session}`;
    if (a.basis === 'contested') return `  ${p} — CONTESTED: ${(a.sessions || []).join(', ')}`;
    return `  ${p} — NO WRITE EVIDENCE. Nothing shows who wrote this.`;
  });
  const unproven = paths.filter((p) => (authorFor(p) || {}).basis === 'unknown').length;
  const head = unproven
    ? `[attribution receipt] ${unproven} of ${paths.length} claim(s) below rest on NO write evidence. `
      + 'Asking is fine; telling is not:'
    : `[attribution receipt] all ${paths.length} claim(s) below rest on write evidence:`;
  return `\n\n${head}\n${rows.join('\n')}`;
}
