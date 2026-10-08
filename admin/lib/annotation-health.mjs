// admin/lib/annotation-health.mjs — the fleet aggregate of scannerAnnotationStatus, pure and
// testable (5.2). The rollup computes {applied, noMatch, carried, expired, invalid} per area every
// run and NOTHING subscribed — C2 (a computed signal with no reader) sitting inside the mechanism
// built to prevent C2.
//
// The one thing this must NOT be is a noisy alarm. A per-area noMatch is not a problem: a record
// scoped to repo X legitimately noMatches in area Y's rollup, because Y does not contain X. The
// meaningful signals are:
//   · orphaned — a record noMatched in some area and BOUND IN NONE. A suppression authored for a
//                finding that has since moved or been fixed; the decaying-snapshot case that
//                authoring-time `--check-rollup` cannot catch because it only ever saw one moment.
//   · expired / invalid — wrong regardless of area, so surfaced with the area they were seen in.
//
// BOUND = applied OR carried. `applied` is empty in practice (measured 2026-08-13: 0 of 30 areas
// populate it) because most categories are CARRIED across the rollup, not matched per-run. Counting
// only `applied` as bound reports every suppression orphaned — the exact false alarm this exists to
// avoid. A record carried in ANY area is bound there.
export function aggregateAnnotationHealth(perArea) {
  const everBound = new Set();
  const noMatch = new Map();
  const expired = [];
  const invalid = [];
  for (const { slug, status } of (perArea || [])) {
    if (!status) continue;
    for (const x of (status.applied || [])) everBound.add(x.record);
    for (const x of (status.carried || [])) everBound.add(x.record);
    for (const x of (status.noMatch || [])) {
      const seen = noMatch.get(x.record) || [];
      if (!seen.includes(slug)) seen.push(slug);
      noMatch.set(x.record, seen);
    }
    for (const x of (status.expired || [])) expired.push({ record: x.record, expires: x.expires, area: slug });
    for (const x of (status.invalid || [])) invalid.push({ record: x.record, errors: x.errors, area: slug });
  }
  const orphaned = [...noMatch]
    .filter(([rec]) => !everBound.has(rec))
    .map(([record, areas]) => ({ record, areas }));
  return { orphaned, expired, invalid, boundCount: everBound.size };
}
