// chunk-identity.mjs — pairwise chunk matching between two documents' chunk arrays, keyed on
// content fingerprints, never on position. Synthesis of four independent design passes
// (/bifocal, /foureyes, /overloop, /breakers) run against this feature before it was built — see
// evaluations/STPA-capec-attack-2026-08-23.md for the precedent of doing that in this repo.
//
// Full sha256 (not the 12-hex truncated form bin/lib/touch-ledger-core.mjs uses for its own
// log-size reasons) — this identity is externally referenced (a future decision-store key, an
// export), so collision risk is minimised rather than traded away for record size.
import { createHash } from 'node:crypto';
import { tokenize, diffOps, maxDiffTokens } from './diff-ops.mjs';

export const fingerprint = (s) => createHash('sha256').update(String(s)).digest('hex');

// Narrow normalisation only: collapse whitespace/line-endings, nothing more aggressive.
// Over-normalising raises collision risk, which is the more severe failure direction — a real
// change silently reading as unchanged is worse than a cosmetic reflow reading as changed.
export const normalize = (s) => String(s).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();

export const STATE = {
  MATCHED: 'MATCHED',
  WHITESPACE_ONLY: 'WHITESPACE_ONLY',
  EDITED: 'EDITED',
  AMBIGUOUS: 'AMBIGUOUS',
  UNRESOLVED: 'UNRESOLVED',
  ADDED: 'ADDED',
  DELETED: 'DELETED',
};

// Below this token-overlap ratio, a pairing is not confident — an honest UNRESOLVED beats a
// forced, low-confidence pairing. False precision is worse than an admitted "can't tell" per this
// repo's explicit uncertainty/explicit uncertainty convention.
const SIMILARITY_THRESHOLD = 0.35;

function annotate(chunk, idx) {
  return {
    src: chunk.src,
    rawHash: fingerprint(chunk.src),
    normHash: fingerprint(normalize(chunk.src)),
    // `idx` is the chunk's position in ITS OWN array, carried only so a consumer (align.mjs) can
    // reconstruct row order deterministically after matching, which runs in a different order than
    // the source arrays. It is never the chunk's identity — rawHash/normHash are — exactly the
    // same distinction chunk-split.mjs draws for {start,end}: a position may aid rendering, never
    // stand in for "is this the same chunk as before".
    idx,
  };
}

// Interchangeable whitespace tokens (a single ' ' between words) match trivially via LCS
// regardless of position, so including them inflates similarity for any two multi-word chunks —
// two UNRELATED paragraphs of similar word-count would otherwise look confidently similar purely
// from matching spaces. Content words only.
const isWordToken = (t) => !/^\s+$/.test(t);

function tokenSimilarity(a, b) {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const cap = maxDiffTokens();
  if (a.length > cap || b.length > cap) {
    // Same O(n*m) discipline as the rendering-time word diff: refuse the DP table on oversized
    // chunks here too, rather than leaving an unguarded one in the pairing phase. A length-ratio
    // heuristic stands in — never a flat 0, which would make every oversized chunk look
    // confidently unrelated regardless of actual content.
    const shorter = Math.min(a.length, b.length), longer = Math.max(a.length, b.length);
    return shorter / longer;
  }
  const matched = diffOps(a, b).filter((o) => o.t === '=').length;
  return (2 * matched) / (a.length + b.length);
}

// No /m flag: tested against a single extracted line (see firstLineHeading), never the whole
// multi-line chunk — `^...$` anchored to a whole string would need the heading to be the chunk's
// ONLY line to ever match, which is false for every real section (heading + body).
const HEADING_RE = /^#{1,6}\s+(.*)$/;
const firstLineHeading = (s) => String(s).split('\n', 1)[0].match(HEADING_RE);

// Case-folded ONLY for the fuzzy similarity signal, never for fingerprint()/normalize() — MATCHED
// and WHITESPACE_ONLY must stay exact/whitespace-only, but two authors' "Risk Triage" vs.
// "Risk triage" are the same words for the purpose of "is this plausibly the same section",
// and case-sensitivity was silently defeating almost every cross-document heading match.
const wordTokens = (s) => tokenize(s).filter(isWordToken).map((t) => t.toLowerCase());

function similarity(aSrc, bSrc) {
  const a = wordTokens(aSrc), b = wordTokens(bSrc);
  const bodySim = tokenSimilarity(a, b);

  // Whole-section chunks (see chunk-split.mjs's splitSections) put a heading line at the start.
  // Two authors' 300-word phase descriptions can be near-zero similarity by body text alone even
  // when the section is clearly "the same phase" — "Phase 0 — Briefing Audit + Risk Triage" and
  // "Phase 0 — Scope, Bindings, Risk Triage" share almost no body vocabulary but obviously
  // correspond. The heading line is the higher-signal, lower-noise comparison for whole sections,
  // so when both chunks open with one, blend it in weighted well above the body — never
  // exclusively, because two differently-worded headings over an otherwise-identical body should
  // still read as similar.
  const aHead = firstLineHeading(aSrc), bHead = firstLineHeading(bSrc);
  if (aHead && bHead) {
    const headSim = tokenSimilarity(wordTokens(aHead[1]), wordTokens(bHead[1]));
    return headSim * 0.75 + bodySim * 0.25;
  }
  return bodySim;
}

function matchByKey(oldAnn, newAnn, oldUsed, newUsed, pairs, key, state) {
  // Snapshot how many not-yet-used chunks share each key BEFORE consuming any of them. Checking
  // ambiguity dynamically (recomputing "how many are left" as pairs are consumed) makes only the
  // FIRST of a set of duplicates look ambiguous and the rest look confidently unique, once earlier
  // duplicates have already been paired off — the opposite of the intended rule, which is that
  // sharing a key with ANY other chunk on either side makes every one of those pairings ambiguous.
  const groupBy = (ann, used) => {
    const map = new Map();
    ann.forEach((c, idx) => {
      if (used[idx]) return;
      if (!map.has(c[key])) map.set(c[key], []);
      map.get(c[key]).push(idx);
    });
    return map;
  };
  const oldByKey = groupBy(oldAnn, oldUsed);
  const newByKey = groupBy(newAnn, newUsed);

  for (const [keyVal, newIdxs] of newByKey) {
    const oldIdxs = oldByKey.get(keyVal);
    if (!oldIdxs || !oldIdxs.length) continue;
    // Duplicate content on either side (a repeated header, a licence block, a verified-against
    // stamp — real patterns in this repo's own docs) makes every pairing sharing that key
    // ambiguous. Default to document-order among the tied candidates, but the ambiguity is
    // recorded on all of them, never hidden on any.
    const ambiguous = oldIdxs.length > 1 || newIdxs.length > 1;
    const pairCount = Math.min(oldIdxs.length, newIdxs.length);
    for (let k = 0; k < pairCount; k++) {
      const oldIdx = oldIdxs[k], newIdx = newIdxs[k];
      oldUsed[oldIdx] = true;
      newUsed[newIdx] = true;
      pairs.push({ state: ambiguous ? STATE.AMBIGUOUS : state, old: oldAnn[oldIdx], new: newAnn[newIdx] });
    }
  }
}

function matchBySimilarity(oldAnn, newAnn, oldUsed, newUsed, pairs) {
  const remainingOld = oldAnn.map((c, i) => i).filter((i) => !oldUsed[i]);
  const remainingNew = newAnn.map((c, i) => i).filter((i) => !newUsed[i]);
  const scored = [];
  for (const oi of remainingOld) {
    for (const ni of remainingNew) scored.push({ oi, ni, sim: similarity(oldAnn[oi].src, newAnn[ni].src) });
  }
  scored.sort((a, b) => b.sim - a.sim);
  for (const { oi, ni, sim } of scored) {
    if (oldUsed[oi] || newUsed[ni]) continue;
    if (sim < SIMILARITY_THRESHOLD) continue;
    oldUsed[oi] = true;
    newUsed[ni] = true;
    pairs.push({ state: STATE.EDITED, old: oldAnn[oi], new: newAnn[ni], similarity: sim });
  }
  // Leftovers after the similarity pass: if BOTH sides still have unmatched chunks AND they share
  // at least one word (a bag-of-remaining-tokens intersection, cheap — no DP table), that's a real
  // split/merge signature (a paragraph divided, or several merged) — grouped as one explicit
  // UNRESOLVED pair rather than forced into misleading 1:1 ADDED+DELETED pairs. Chunks that share
  // NO vocabulary at all are not an ambiguous split/merge, just ordinary unrelated adds/deletes,
  // and fall through to ADDED/DELETED individually in the caller — grouping those into one
  // UNRESOLVED blob would bury genuinely unrelated changes behind a false "related" signal.
  const stillOld = remainingOld.filter((i) => !oldUsed[i]);
  const stillNew = remainingNew.filter((i) => !newUsed[i]);
  if (stillOld.length > 1 && stillNew.length > 1) {
    const oldTokens = new Set(stillOld.flatMap((i) => tokenize(oldAnn[i].src)).filter(isWordToken));
    const newTokens = new Set(stillNew.flatMap((i) => tokenize(newAnn[i].src)).filter(isWordToken));
    const sharesAny = [...oldTokens].some((t) => newTokens.has(t));
    if (sharesAny) {
      pairs.push({ state: STATE.UNRESOLVED, old: stillOld.map((i) => oldAnn[i]), new: stillNew.map((i) => newAnn[i]) });
      stillOld.forEach((i) => { oldUsed[i] = true; });
      stillNew.forEach((i) => { newUsed[i] = true; });
    }
  }
}

/**
 * Pair two chunk arrays into the state model above. Every input chunk appears in exactly one
 * pairing slot — the completeness invariant, testable as count-in === count-out (an UNRESOLVED
 * pair counts as however many chunks its old/new arrays hold).
 *
 * @param oldChunks  [{src}]
 * @param newChunks  [{src}]
 * @returns {{pairs: Array, noBaseline: boolean}}
 */
export function pairChunks(oldChunks, newChunks) {
  if (!oldChunks.length) {
    // NO_BASELINE: nothing to diff against. Every new chunk still needs a slot (the completeness
    // invariant holds even here) — reported as ADDED, with noBaseline making the distinction from
    // an ordinary "everything added" diff visible to the caller.
    return { noBaseline: true, pairs: newChunks.map((c, i) => ({ state: STATE.ADDED, old: null, new: annotate(c, i) })) };
  }

  const oldAnn = oldChunks.map(annotate);
  const newAnn = newChunks.map(annotate);
  const oldUsed = new Array(oldAnn.length).fill(false);
  const newUsed = new Array(newAnn.length).fill(false);
  const pairs = [];

  matchByKey(oldAnn, newAnn, oldUsed, newUsed, pairs, 'rawHash', STATE.MATCHED);
  matchByKey(oldAnn, newAnn, oldUsed, newUsed, pairs, 'normHash', STATE.WHITESPACE_ONLY);
  matchBySimilarity(oldAnn, newAnn, oldUsed, newUsed, pairs);

  oldAnn.forEach((c, idx) => { if (!oldUsed[idx]) pairs.push({ state: STATE.DELETED, old: c, new: null }); });
  newAnn.forEach((c, idx) => { if (!newUsed[idx]) pairs.push({ state: STATE.ADDED, old: null, new: c }); });

  annotateMoved(pairs);
  return { noBaseline: false, pairs };
}

// MOVED is a badge, not an exclusive state: layered onto MATCHED/WHITESPACE_ONLY/EDITED pairs
// whose position differs from the running expected order, phrased as a non-committal hint
// ("also found in N places") rather than an asserted single move whenever the content is
// duplicated — mirroring bin/lib/touch-attribution.mjs's claimants() returning a set, never one
// owner, when the evidence does not support a single confident answer.
function annotateMoved(pairs) {
  const rawCounts = new Map();
  for (const p of pairs) {
    if (p.old && !Array.isArray(p.old) && p.old.rawHash) {
      rawCounts.set(p.old.rawHash, (rawCounts.get(p.old.rawHash) || 0) + 1);
    }
  }
  let expected = 0;
  for (const p of pairs) {
    if (p.state === STATE.MATCHED || p.state === STATE.WHITESPACE_ONLY || p.state === STATE.EDITED) {
      if (p.old.idx !== expected) {
        const dupCount = rawCounts.get(p.old.rawHash) || 1;
        p.movedHint = dupCount > 1 ? `also found in ${dupCount} places` : 'position changed';
      }
      expected = p.old.idx + 1;
    }
  }
}
