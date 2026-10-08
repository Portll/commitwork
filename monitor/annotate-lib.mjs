// annotate-lib.mjs — the as-of authored-judgment matcher, shared by rollup and reconcilers.
// Contract: match on {id, package, repo} AND-ed, omitted field = wildcard; active window
// at <= now && (!expires || expires > now); suppressing actions are {accept, false-positive,
// wont-fix} — note/resolved never suppress. Pure (no fs, no clock); `now` is a parameter.

import { dirname, join } from 'node:path';

// Actions that actively SUPPRESS a finding when their as-of window is live. `note` and `resolved`
// are deliberately absent — they annotate without dropping the finding from open counts.
// `incorrect-scan-result` (added 2026-08-23) is deliberately NOT a synonym for false-positive.
// false-positive says THIS FINDING is wrong about this code — a judgement about the subject.
// incorrect-scan-result says THE INSTRUMENT WAS DEFECTIVE — the rows are an artefact of a tool
// defect, the same rule may be perfectly valid elsewhere, and the follow-up is to fix or drop the
// detector rather than to accept anything. Collapsing the two would erase the only signal that
// tells a reader whether to look at the code or at the scanner.
//
// It is time-stable, which is what qualifies it as an ACTION rather than a disposition: rollup.mjs
// replays these by timestamp to recolour past slices, and "the detector that produced this was
// broken" is as true of the old slice as of today.
//
// Motivating case: TruffleHog's Lob detector produced 1,311 of the fleet's 1,314 published
// CRITICALs, all false. The scanner stopped emitting them after 2026-08-20, but the rows were
// CARRIED forward into rollups that still publish them at crit — correct carry behaviour keeping a
// finding alive that the corrected instrument would never produce again.
export const SUPPRESSING_ACTIONS = ['accept', 'false-positive', 'wont-fix', 'incorrect-scan-result'];

/** Actions that must name the defect they blame — a suppression that blames a tool must say which. */
export const DEFECT_REQUIRING_ACTIONS = ['incorrect-scan-result'];

// Is annotation `a` in force as-of `now` (ISO string) AND of a suppressing action?
export const annActive = (a, now) =>
  a.at <= now && (!a.expires || a.expires > now) && SUPPRESSING_ACTIONS.includes(a.action);

// repo (or scope:'fleet') must match; id/package omitted stay wildcards.
export const annMatch = (a, f) =>
  (!a.id || a.id === f.id) &&
  (!a.package || a.package === f.package) &&
  (a.scope === 'fleet' ? true : (typeof a.repo === 'string' && a.repo.trim() !== '' && a.repo === f.repo));

// First matching active annotation, or undefined.
export const findActiveAnnotation = (annots, f, now) =>
  annots.find((a) => annActive(a, now) && annMatch(a, f));

// ---- scanner-finding annotations (annotations.json `scannerAnnotations`) --------------------
// A second matcher, deliberately not a generalisation of annMatch: every field in the category's
// identity tuple MUST be present, plus repo — absence is a validation error, never a wildcard;
// scope:'fleet' is an explicit opt-in.

// Validate one record against its category's identity tuple; [] when valid. Never apply a record
// that fails this. `requireExpires` is the WRITE-time gate only (a fleet-scoped suppression on a
// version-less identity is otherwise a permanent blindfold); the read path never retroactively
// invalidates records already on disk.
export function validateScannerAnnotation(a, identityFields, { requireExpires = false } = {}) {
  const errs = [];
  if (!a || typeof a !== 'object') return ['record is not an object'];
  if (!a.category) errs.push('missing category');
  else if (!identityFields) errs.push(`unknown category '${a.category}'`);
  const nonEmpty = (v) => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number';
  if (a.action === 'incorrect-scan-result') {
    // Instrument-scoped: name the instrument exactly, and place fields may be omitted (see
    // scannerAnnMatch). At least one instrument field is MANDATORY — without it this degenerates
    // into "suppress every row in this category", which no defect report can justify.
    const { instrument, place } = splitIdentity(identityFields);
    if (!instrument.length) {
      errs.push(`category '${a.category}' has no instrument field in its identity (${(identityFields || []).join(', ') || 'none'}) — 'incorrect-scan-result' cannot be scoped here, so name the full identity or use a different action`);
    } else if (!instrument.some((f) => nonEmpty(a[f]))) {
      errs.push(`'incorrect-scan-result' must name the instrument — set at least one of: ${instrument.join(', ')}`);
    }
    for (const f of place) {
      if (a[f] !== undefined && !nonEmpty(a[f])) errs.push(`identity field '${f}' is present but empty — omit it to mean "any", never blank it`);
    }
  } else {
    for (const f of identityFields || []) {
      if (!nonEmpty(a[f])) errs.push(`missing identity field '${f}' (no wildcard-by-omission for scanner annotations)`);
    }
  }
  if (a.scope !== 'fleet' && !nonEmpty(a.repo)) errs.push("missing repo (or explicit scope: 'fleet')");
  if (a.scope !== undefined && a.scope !== 'fleet') errs.push(`scope must be 'fleet' or absent, got '${a.scope}'`);
  if (!['accept', 'false-positive', 'wont-fix', 'note', 'resolved', 'incorrect-scan-result'].includes(a.action)) errs.push(`unknown action '${a.action}'`);
  // A suppression that blames the INSTRUMENT must name it. Without this the action is a blanket
  // dismissal wearing a technical label — and it would be the cheapest way to make any inconvenient
  // finding disappear, which is precisely the failure this vocabulary exists to prevent.
  if (DEFECT_REQUIRING_ACTIONS.includes(a.action)) {
    const d = a.defect;
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      errs.push(`action '${a.action}' requires a defect object naming the instrument ({ tool, detail, detector?, fixedIn? })`);
    } else {
      if (!nonEmpty(d.tool)) errs.push(`defect.tool is required for '${a.action}' — which instrument produced the wrong result`);
      if (!nonEmpty(d.detail)) errs.push(`defect.detail is required for '${a.action}' — what the instrument got wrong, in terms a reader can check`);
      for (const k of Object.keys(d)) {
        if (!['tool', 'detail', 'detector', 'fixedIn'].includes(k)) errs.push(`unknown defect field '${k}'`);
      }
    }
  } else if (a.defect !== undefined) {
    errs.push(`defect is only meaningful for ${DEFECT_REQUIRING_ACTIONS.join(', ')} — got action '${a.action}'`);
  }
  if (!nonEmpty(a.reason)) errs.push('missing reason');
  if (!nonEmpty(a.who)) errs.push('missing who');
  if (typeof a.at !== 'string' || Number.isNaN(Date.parse(a.at))) errs.push('missing or unparseable at (ISO timestamp)');
  // Scoped to SUPPRESSING actions: the rule exists because a suppression with no review date is a
  // permanent blindfold, and a `note` blinds nobody — it records an observation and never drops a
  // row. Demanding a review date for "I also looked at line 113" would make the corroboration path
  // (the one that exists so a second judgment need not mint a second suppression) unusable.
  if (requireExpires && SUPPRESSING_ACTIONS.includes(a.action) && !nonEmpty(a.expires)) {
    errs.push("missing expires (required when authoring a SUPPRESSING scannerAnnotations record — a fleet-scoped suppression on a version-less identity is a permanent blindfold without one; set an explicit ISO date, e.g. '2026-12-31T00:00:00.000Z')");
  } else if (a.expires !== undefined && (typeof a.expires !== 'string' || Number.isNaN(Date.parse(a.expires)))) {
    errs.push('unparseable expires');
  }
  // claim is additive metadata, never identity — still a strict closed vocabulary.
  if (a.claim !== undefined && !CLAIM_VALUES.includes(a.claim)) {
    errs.push(`unknown claim '${a.claim}' (structured values only, never free text: ${CLAIM_VALUES.join(', ')})`);
  }
  return errs;
}

// Identity fields that name the INSTRUMENT that produced a row, as opposed to the PLACE it points
// at. The distinction only matters for `incorrect-scan-result`: a claim about a defective detector
// is a claim about the instrument, and requiring the place would force one record per location the
// broken detector happened to fire — 842 files for one Lob defect. That is not a suppression, it is
// 1,311 individual dismissals wearing one reason, and it misrepresents the judgement being made.
export const INSTRUMENT_FIELDS = ['detector', 'rule', 'tool', 'check', 'control'];

/** The identity fields of `category` that name an instrument, and those that name a place. */
export const splitIdentity = (identityFields) => {
  const fields = identityFields || [];
  return {
    instrument: fields.filter((f) => INSTRUMENT_FIELDS.includes(f)),
    place: fields.filter((f) => !INSTRUMENT_FIELDS.includes(f)),
  };
};

// Does scanner annotation `a` address row `row`? Strict equality on EVERY identity field plus repo
// (unless scope:'fleet'). Only call with a record that passed validateScannerAnnotation.
//
// ONE exception, and it is narrow: for `incorrect-scan-result` a PLACE field the record omits is a
// wildcard, because the record is about the instrument. Instrument fields are still compared
// strictly, at least one must be present (enforced at validation), and repo/scope still bind — so
// this can retire a broken detector without ever becoming "suppress this category".
export const scannerAnnMatch = (a, row, identityFields) => {
  const instrumentScoped = a.action === 'incorrect-scan-result';
  const eq = (f) => String(a[f]) === String(row[f] ?? '');
  const fields = (identityFields || []).filter((f) => {
    if (!instrumentScoped) return true;
    return a[f] !== undefined && a[f] !== null && a[f] !== '';
  });
  return fields.every(eq) && (a.scope === 'fleet' || a.repo === row.repo);
};

// First active scanner annotation addressing `row`, or undefined. `annots` should already be
// filtered to the row's category; `identityFields` is that category's identity tuple.
export const findActiveScannerAnnotation = (annots, row, now, identityFields) =>
  annots.find((a) => annActive(a, now) && scannerAnnMatch(a, row, identityFields));

// ---- redundant suppressions -------------------------------------------------------------------
// A suppression is a judgment about an IDENTITY; an observation is a judgment about a ROW. The
// panel authors from a row, so one identity collected one suppression per row it happened to fire
// on — 11 records on bin/test/secrets-sweep.test.mjs, 4 on cra/attest.mjs, all identical in
// everything the matcher reads. findActiveScannerAnnotation takes the FIRST match, so the extras
// never suppressed anything twice; what they did was move the review date. N records with
// staggered `expires` keep a row suppressed until the LAST one lapses, so the date the operator
// agreed to is not the date that governs.
//
// Returns the record already in force over this one's identity AND action, or undefined. A
// DIFFERENT action on the same identity is not redundant — it is a changed judgment, and the
// caller reports it rather than swallowing it (first-match-wins means the incumbent still governs,
// which the operator has to be told, not protected from).
export const activeSuppressionFor = (annots, record, now, identityFields) => {
  if (!SUPPRESSING_ACTIONS.includes(record.action)) return undefined;
  const target = scannerAnnotationTarget(record, identityFields);
  return (annots || []).find((a) => annActive(a, now)
    && a.action === record.action
    && scannerAnnotationTarget(a, identityFields) === target);
};

// The same, ignoring action: anything currently suppressing this identity, whatever it claims.
export const anyActiveSuppressionFor = (annots, record, now, identityFields) => {
  const target = scannerAnnotationTarget(record, identityFields);
  return (annots || []).find((a) => annActive(a, now)
    && scannerAnnotationTarget(a, identityFields) === target);
};

// ---- claim: additive, non-identity metadata ----------------------------------------------------
// Set deliberately, never parsed from `reason` prose; never part of any identity tuple, and
// scannerAnnMatch never reads it.
export const CLAIM_VALUES = ['remediated'];

// ---- suppression-label ledger (C-5 fatigue) -----------------------------------------------------
// One record per suppression EVENT, never per predicate evaluation. This module only builds the
// envelope; callers append through bin/verdict-journal.mjs's appendRecord, never direct fs.
export const SUPPRESSION_LABEL_KIND = 'suppression-label';

// Place-identity string: category + identity tuple + repo (or `fleet`). Content never belongs
// here; mirrors rollup.mjs's `_annLabel` exactly.
export const scannerAnnotationTarget = (a, identityFields) =>
  `${a.category}:${(identityFields || []).map((f) => a[f]).join('|')}@${a.scope === 'fleet' ? 'fleet' : a.repo}`;

// Build one suppression-label envelope. Pure — no I/O, no default `at` (the caller's clock).
export function buildSuppressionLabel({ target, action, count = 1, who, at, expires, noExpires }) {
  const rec = { kind: SUPPRESSION_LABEL_KIND, target, action, count, who, at };
  if (expires) rec.expires = expires;
  if (noExpires) rec.noExpires = true;
  return rec;
}

// ---- the scanner-annotation overlay, applied by BOTH the rollup and the panel ----------------
// One derivation, two callers. rollup.mjs applies this when it writes the slice; the panel applies
// it again when it reads one, because an annotation authored after the last sweep changes nothing
// on disk until the next one — the operator records fifteen false positives and the count does not
// move. Two copies of this loop would be two answers to "is this row suppressed".
//
// Pure, like the rest of this module: `annotationView`, `identityFor` and the clock arrive as
// arguments rather than imports, so it stays testable without a filesystem and annotate-lib keeps
// its no-dependency contract.
//
// MUTATES rows and aggregates in place, matching what rollup already did. Suppressed is never
// deleted: the row keeps its place and gains `.annotation`, and the aggregate moves the count from
// its severity bucket into `annotated` rather than dropping it.
export function applyScannerAnnotations({
  annots = [], scannerFindings = {}, scannerFleet = {}, asOf,
  identityFor, annotationView, validate = validateScannerAnnotation,
  sevlessBucket = {}, isCarried = () => false, annLabel = defaultAnnLabel,
}) {
  const status = { applied: [], noMatch: [], expired: [], invalid: [], carried: [] };
  let annotatedTotal = 0;
  for (const a of annots) {
    const idf = identityFor(a.category);
    const errs = validate(a, idf);
    if (errs.length) { status.invalid.push({ record: annLabel(a, idf), errors: errs }); continue; }
    if (a.at > asOf) continue;                       // not yet authored as-of this slice — replay, not a defect
    if (a.expires && a.expires <= asOf) { status.expired.push({ record: annLabel(a, idf), expires: a.expires }); continue; }
    // After invalid/expired deliberately: those are properties of the RECORD and hold whether or not
    // the category ran, so a carried category must not hide a malformed or lapsed one.
    if (isCarried(a.category)) { status.carried.push({ record: annLabel(a, idf), category: a.category }); continue; }
    if (!SUPPRESSING_ACTIONS.includes(a.action)) continue;  // note/resolved inform, never suppress
    const rows = scannerFindings[a.category] || [];
    let matched = 0;
    for (const row of rows) {
      if (row.annotation) continue;                  // first record wins
      if (!findActiveScannerAnnotation([a], row, asOf, idf)) continue;
      row.annotation = annotationView(a);
      matched++;
      const agg = scannerFleet[a.category];
      const bucket = (row.sev && agg && typeof agg[row.sev] === 'number') ? row.sev : sevlessBucket[a.category];
      if (agg && bucket) {
        agg[bucket] = Math.max(0, (agg[bucket] || 0) - 1);
        agg.total = Math.max(0, (agg.total || 0) - 1);
        agg.annotated = (agg.annotated || 0) + 1;
        annotatedTotal++;
      }
    }
    if (matched) status.applied.push({ record: annLabel(a, idf), matched });
    else status.noMatch.push({ record: annLabel(a, idf) });
  }
  return { status, annotatedTotal };
}

export const defaultAnnLabel = (a, idf) =>
  `${a.category}:${(idf || []).map((f) => a[f]).join('|')}@${a.scope === 'fleet' ? 'fleet' : a.repo}`;

// ---- write-path lock (C2 read-modify-write) ------------------------------------------------
// One exported lock PATH (not policy) so both write paths converge on the identical sibling file
// — two differently-named locks over one store is no mutex. Retry policy stays per-caller.
export const ANNOTATIONS_LOCK_NAME = '.annotations.lock';
export const annotationsLockPath = (storePath) => join(dirname(storePath), ANNOTATIONS_LOCK_NAME);
