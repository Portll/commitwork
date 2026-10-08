const STOPWORDS = new Set(('the a an and or of to in is are it its that this for with on at by as from be been' +
  ' not no so which every any all one two into than then there their they has have had was were will would can').split(/\s+/));

// contract: content words, lowercased, stopwords removed
export const summaryTokens = (s) => new Set(
  String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
);

// contract: set overlap in [0,1]; two empties are 1
export function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared || 1);
}
