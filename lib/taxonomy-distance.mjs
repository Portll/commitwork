// taxonomy-distance.mjs — MEASURED distance between class sets in a taxonomy.
//
// WHY THIS EXISTS. A new class set proposed alongside an existing one invites exactly one question
// ("is this a duplicate of what we already have?") and exactly one bad answer: the author's own
// judgement, recorded as a label. This module answers it by measurement, so the hand label and the
// measurement are two witnesses that cannot share a failure mode — the lane-capability pattern
// (monitor/lane-capability.mjs), applied to a registry rather than to a parser. Disagreement is the
// finding: a class hand-labelled `novel` whose nearest neighbour in another set is closer than that
// set's own members typically are to each other is a duplicate wearing a new id.
//
// THE THRESHOLD IS DERIVED, NEVER INVENTED. "Close" is not a number chosen here. It is read off the
// reference set's OWN internal nearest-neighbour distribution: the median distance from a member of
// that set to its nearest OTHER member is the scale at which that taxonomy considers two classes
// distinct. A hard-coded 0.4 would be M14 (bound copied without its cause) — a bound that cannot
// notice the thing it measures changing shape.
//
// Deterministic by construction: pure functions, no clock, no env, no I/O. Same inputs => identical
// numbers. Ties break on id ascending so a re-run cannot reorder equal neighbours.

/** Function words only. Topic words are handled by idf, which measures genericness instead of
 *  asserting it — a stoplist that removes "read" or "clean" would delete this domain's signal. */
const STOP = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from', 'had', 'has',
  'have', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'them',
  'then', 'there', 'they', 'this', 'to', 'was', 'were', 'which', 'with', 'while', 'when',
  'what', 'who', 'whom', 'not', 'nor', 'so', 'than', 'too', 'very', 'can', 'could', 'would',
  'should', 'may', 'might', 'must', 'will', 'shall', 'does', 'did', 'done', 'one', 'two',
  'both', 'each', 'every', 'any', 'all', 'some', 'same', 'other', 'another', 'more', 'most',
  'less', 'least', 'only', 'own', 'such', 'over', 'under', 'after', 'before', 'again', 'once',
  'because', 'about', 'against', 'between', 'through', 'during', 'out', 'off', 'how', 'why',
  'where', 'been', 'being', 'here', 'also', 'per', 'via', 'yet', 'not',
]);

/** Tokens from any number of text fields. Machine names split on their own separators, because
 *  `false_clean.absence_rendered_as_success` carries the same words the description does. */
export function tokens(...texts) {
  const out = [];
  for (const t of texts) {
    if (t === null || t === undefined) continue;
    for (const w of String(t).toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length < 3 || STOP.has(w)) continue;
      out.push(w);
    }
  }
  return out;
}

/**
 * Inverse document frequency over the WHOLE corpus (every set being compared, together). One space
 * or the numbers are not comparable: idf fitted per-set would score the same word differently in
 * each, and a cross-set distance built on two different spaces measures the spaces, not the classes.
 */
export function idfOver(docs) {
  const n = docs.length || 1;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const idf = new Map();
  for (const [t, seen] of df) idf.set(t, Math.log(1 + n / seen));
  return idf;
}

/** L2-normalised tf-idf vector. A doc with no scoring token returns empty: every cosine against it
 *  is 0, which is the honest reading (nothing to compare), never a fabricated similarity. */
export function vec(toks, idf) {
  const tf = new Map();
  for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
  const v = new Map();
  let sq = 0;
  for (const [t, n] of tf) {
    const w = (1 + Math.log(n)) * (idf.get(t) || 0);
    if (w <= 0) continue;
    v.set(t, w);
    sq += w * w;
  }
  const norm = Math.sqrt(sq);
  if (norm === 0) return new Map();
  for (const [t, w] of v) v.set(t, w / norm);
  return v;
}

export function cosine(a, b) {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) { const o = big.get(t); if (o) dot += w * o; }
  return dot;
}

const r4 = (n) => Number(n.toFixed(4));

/**
 * Nearest member of `candidates` to `v`. `excludeId` drops self-comparison for an internal baseline.
 * Ties break on id ascending — a re-run must not be able to reorder equal neighbours.
 */
export function nearest(v, candidates, { excludeId = null } = {}) {
  let best = null;
  for (const c of candidates) {
    if (excludeId !== null && c.id === excludeId) continue;
    const sim = cosine(v, c.vec);
    if (best === null || sim > best.sim || (sim === best.sim && c.id < best.id)) {
      best = { id: c.id, sim };
    }
  }
  return best === null ? null : { id: best.id, sim: r4(best.sim), distance: r4(1 - best.sim) };
}

export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return r4(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

/**
 * A set's OWN internal nearest-neighbour distances — the scale at which that taxonomy holds two
 * classes to be distinct. This is the derived threshold every cross-set reading is judged against.
 * A set of one has no internal scale, and says so with null rather than with a default.
 *
 * `sorted` is the whole distribution, not just its median: banding on the median alone was tried
 * first and fired on 28 of 47 rows, because it asks "closer than the typical sibling pair", which
 * half of any distribution satisfies by definition. The percentile band below asks the question
 * that was actually meant — closer than this set's members USUALLY get — and it is still derived
 * from the set rather than chosen.
 */
export function internalBaseline(members) {
  if (members.length < 2) {
    return { n: members.length, median: null, min: null, max: null, sorted: [],
      why: 'fewer than two members — a set with no internal pair has no scale of its own, and a borrowed one would be a bound with no cause' };
  }
  const rows = members.map((m) => {
    const nn = nearest(m.vec, members, { excludeId: m.id });
    return { id: m.id, nearest: nn.id, distance: nn.distance };
  });
  const ds = rows.map((r) => r.distance);
  const sorted = [...ds].sort((a, b) => a - b);
  return { n: members.length, median: median(ds), min: r4(Math.min(...ds)), max: r4(Math.max(...ds)), sorted, rows };
}

/** Where `value` falls in `sortedAsc`, as a percentage. 0 means nothing in the set is closer. */
export function percentileOf(sortedAsc, value) {
  if (!sortedAsc.length) return null;
  let below = 0;
  for (const d of sortedAsc) { if (d < value) below++; else break; }
  return r4((below / sortedAsc.length) * 100);
}

/** The bands, and the ONE place they are defined. Percentiles of the reference set's own internal
 *  nearest-neighbour distribution: derived from that set, never chosen for this one. */
export const BANDS = Object.freeze({ duplicate: 10, adjacent: 50 });

/**
 * Build comparable vectors for every set at once.
 * `sets`: { name: [{ id, text: [..strings] }] }. Returns { name: [{ id, vec }] }.
 */
export function embed(sets) {
  const names = Object.keys(sets).sort();
  const docs = [];
  const staged = {};
  for (const name of names) {
    staged[name] = sets[name].map((m) => ({ id: m.id, toks: tokens(...m.text) }));
    for (const m of staged[name]) docs.push(m.toks);
  }
  const idf = idfOver(docs);
  const out = {};
  for (const name of names) out[name] = staged[name].map((m) => ({ id: m.id, vec: vec(m.toks, idf) }));
  return { idf, sets: out };
}

/**
 * The report. For every member of `subject`, its nearest neighbour in each reference set, judged
 * against that reference set's own internal median. `verdict` per row:
 *   duplicate  — nearer than 90% of that set's own sibling pairs: it sits inside the set's own
 *                resolution, and the row is the one a human must read
 *   adjacent   — nearer than the set's median sibling pair, but not unusually so
 *   distinct   — farther than the set's own members typically fall from each other
 * `duplicate` is a claim about text, never about intent, and it is the row a human must read.
 */
export function compare({ subject, references, citations = {}, citationSets = null }) {
  const all = { __subject: subject, ...references };
  const { sets } = embed(all);
  const subjVecs = sets.__subject;

  const baselines = {};
  for (const name of Object.keys(references).sort()) baselines[name] = internalBaseline(sets[name]);

  const rows = subjVecs.map((s) => {
    const against = {};
    for (const name of Object.keys(references).sort()) {
      const nn = nearest(s.vec, sets[name]);
      const b = baselines[name];
      if (nn === null || !b.sorted.length) { against[name] = { nearest: nn && nn.id, distance: nn && nn.distance, pct: null, verdict: 'unmeasured' }; continue; }
      const pct = percentileOf(b.sorted, nn.distance);
      against[name] = {
        nearest: nn.id, distance: nn.distance, pct,
        verdict: pct < BANDS.duplicate ? 'duplicate' : pct < BANDS.adjacent ? 'adjacent' : 'distinct',
      };
    }
    return { id: s.id, against };
  });

  // CITED-CLASS DISTANCE. The nearest neighbour answers "is this like anything here"; a citation
  // answers "is this like the thing it SAYS it is like", which is the question an `inherits` id
  // makes. They come apart: a class can be lexically distant from everything and still correctly
  // cite a parent whose wording differs, and only the cited distance can show that. `rank` is the
  // cited class's position among that set's members ordered by distance, so rank 1 means the
  // citation and the measurement point at the same class.
  const vecById = {};
  for (const name of Object.keys(references).sort()) vecById[name] = new Map(sets[name].map((m) => [m.id, m.vec]));
  const cited = {};
  for (const s of subjVecs) {
    const ids = citations[s.id] || [];
    if (!ids.length) continue;
    cited[s.id] = [];
    for (const name of Object.keys(references).sort()) {
      // An `inherits` id names a class in ONE registry. Resolving it against another set that merely
      // shares the id namespace produces a confident answer about the wrong class — measured here:
      // the sidecar's proposals reuse ids that have since landed in the parent.
      if (citationSets && !citationSets.includes(name)) continue;
      const ordered = sets[name]
        .map((m) => ({ id: m.id, d: 1 - cosine(s.vec, m.vec) }))
        .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
      const rankOf = new Map(ordered.map((o, i) => [o.id, i + 1]));
      for (const cid of ids) {
        const v = vecById[name].get(cid);
        if (!v) continue;   // the citation does not point into THIS set — not a finding about it
        cited[s.id].push({ set: name, id: cid, distance: r4(1 - cosine(s.vec, v)), rank: rankOf.get(cid), of: ordered.length });
      }
    }
  }

  return { baselines, rows, cited, subjectInternal: internalBaseline(subjVecs) };
}
