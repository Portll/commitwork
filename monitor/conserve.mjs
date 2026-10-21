// monitor/conserve.mjs — fleet-aggregate conservation invariant: published + truncated must
// reconstruct each category's declared total, or scanner-delta could mint a FIXED that never happened.
// Call it against the fleet flatten's OWN totals, BEFORE the annotation overlay decrements them.
// N.B. extractors' DETAIL_CAP is the truncation this reads; scanner-delta's PLACE_DETAIL_CAP and
// timeline's DETAIL_CAP share the name only (display / slice caps).
// Pure and deterministic: no clock, no fs, no env; sorted output.

import { identityFor } from './detail-schema.mjs';

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// Published-row count — accepts both the flattened row array and an extractor's {findings, truncated}
const publishedCount = (entry) => {
  if (Array.isArray(entry)) return entry.length;
  if (entry && Array.isArray(entry.findings)) return entry.findings.length;
  return 0;
};

// Truncation count — nested fleet shape (detail.truncated) or flat extractor shape; absent means
// untruncated, and 0 is the accurate reading there.
const truncatedCount = (entry) => {
  const nested = entry && entry.detail && Number(entry.detail.truncated);
  if (Number.isFinite(nested)) return nested;
  const flat = entry && Number(entry.truncated);
  return Number.isFinite(flat) ? flat : 0;
};

/**
 * checkConservation({scanners, scannerFindings}) -> {checked, violations}
 * Asserts published + truncated === declared for every category with a ROW_SCHEMA identity and a
 * finite declared total; failing either is skipped, never treated as declaring 0.
 * `checked` lists every category actually compared; `violations` [] means "checked, conforms".
 */
export function checkConservation({ scanners, scannerFindings } = {}) {
  const declaredMap = scanners || {};
  const publishedMap = scannerFindings || {};
  const checked = [];
  const violations = [];

  for (const category of Object.keys(declaredMap).sort()) {
    if (!identityFor(category)) continue; // no ROW_SCHEMA — skipped, never violated
    const entry = declaredMap[category];
    const declared = entry && isNum(entry.total) ? entry.total : null;
    if (declared === null) continue; // nothing declared to conserve against — cannot assess, not a violation

    const published = publishedCount(publishedMap[category]);
    const truncated = truncatedCount(entry);
    checked.push(category);
    if (published + truncated !== declared) violations.push({ category, declared, published, truncated });
  }

  return { checked, violations };
}
