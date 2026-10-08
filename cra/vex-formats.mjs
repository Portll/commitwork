// cra/vex-formats.mjs — CSAF 2.0 and OpenVEX projections of the neutral statement set.
//
// The lifecycle mapping lives in cra/vex.mjs and is NOT re-decided here; these functions translate
// an already-decided state into each format's vocabulary. Two rules hold across both:
//
//   1. `accepted` (operator recorded accept/wont-fix) projects as AFFECTED with a no-fix
//      remediation, never as not_affected. The product is vulnerable; a decision not to act does
//      not change that, and a consumer reading not_affected would be misled by our own record.
//   2. A not_affected statement carries the operator's RECORDED reason as an impact statement.
//      Both specs offer enumerated justifications (vulnerable_code_not_present and friends); each
//      is a claim about code nobody here verified, so none is ever synthesised.
//
// Zero deps. Deterministic: no clock, no randomness — `atIso` is supplied.

import { contentUUID, stableStringify } from './lib.mjs';

// ── CSAF 2.0 (csaf_vex profile) ─────────────────────────────────────────────────────────────────
export const CSAF_STATUS = {
  exploitable: 'known_affected',
  accepted: 'known_affected',
  in_triage: 'under_investigation',
  false_positive: 'known_not_affected',
  resolved: 'fixed',
};

// A component is a product in CSAF's model, related to the shipped product by default_component_of.
// Ids are assigned over a sorted ref list so the same inputs always yield the same CSAFPIDs.
function productTree(product, statements) {
  const refs = [...new Set(statements.flatMap((s) => s.affects.map((a) => a.ref)))].sort();
  const productId = 'CSAFPID-0001';
  const fullName = `${product.name} ${product.version || ''}`.trim();
  const full_product_names = [{ product_id: productId, name: fullName }];
  const relationships = [];
  const refToPid = new Map();

  refs.forEach((ref, i) => {
    const componentId = `CSAFPID-${String(i * 2 + 2).padStart(4, '0')}`;
    const relationshipId = `CSAFPID-${String(i * 2 + 3).padStart(4, '0')}`;
    full_product_names.push({ product_id: componentId, name: ref });
    relationships.push({
      category: 'default_component_of',
      product_reference: componentId,
      relates_to_product_reference: productId,
      full_product_name: { product_id: relationshipId, name: `${ref} as a component of ${fullName}` },
    });
    refToPid.set(ref, relationshipId);
  });

  return { tree: { full_product_names, relationships }, refToPid, productId };
}

/** A date-only value widened to that day's start. CSAF wants date-time and several authoritative
 *  feeds publish a date; inventing a time of day would be precision nobody measured. Returns null
 *  for anything not YYYY-MM-DD rather than a guess. */
export function dayStartIso(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? `${date}T00:00:00.000Z` : null;
}

// ── CISA KEV → CSAF, and the four fields that do NOT survive the trip ──────────────────────────
//
// KEV records carry: cveID, vendorProject, product, vulnerabilityName, dateAdded, shortDescription,
// requiredAction, dueDate, knownRansomwareCampaignUse, notes, cwes. Each was checked against the
// 2.1 schema rather than assumed, and they do not all have a home:
//
//   dateAdded    → threats[].date on an `exploit_status` threat. EXACT: that field is documented as
//                  "the date when the assessment was done or the threat appeared", which is what a
//                  KEV catalogue date is. This is the honest carrier for "first CISA catalogued".
//   shortDescription, knownRansomwareCampaignUse → the same threat's `details`. Ransomware use is a
//                  real exploitation signal and KEV states it as Known/Unknown, so it is carried
//                  verbatim including "Unknown", which is not "No".
//   requiredAction → remediations[] as a `mitigation`. It is an instruction to act, which is what
//                  that category means.
//   dueDate      → the mitigation's DETAILS, deliberately NOT its `date`. CSAF's remediations.date
//                  is "the date from which the remediation is available"; a BOD deadline is the
//                  date by which it must be DONE. Putting one in the other reverses the claim, and
//                  a reader cannot tell from the document which meaning was intended.
//   notes        → references[]. KEV packs a "; "-separated URL list in there.
//
//   cwes         → cwe (2.0, one weakness, {id, name}) and cwes[] (2.1, all of them, with the
//                  catalogue version). This was NOT EMITTED until 2026-08-26 for a real reason —
//                  both specs require a NAME and every CWE source here carried the id alone — and
//                  it closed the way that kind of gap closes: by vendoring the missing authority,
//                  cra/cwe-catalogue.json (MITRE CWE 4.20, 968 weaknesses). See cwesFromIds for the
//                  two populations it still refuses.
//   vulnerabilityName → title. CSAF defines title as a canonical name FOR THE VULNERABILITY, which
//                  is what KEV's field is; it makes no claim about which product is affected.
//   vendorProject, product → a NOTE, deliberately NOT the product tree. They identify the product
//                  CISA assessed. Writing them into our tree would assert that CISA's product and
//                  ours are the same thing — an equivalence nobody established and one a consumer
//                  would act on. As a note the information survives and the claim does not.
//
//   first_known_exploitation_dates → STILL NOT EMITTED, and not for want of a source. Its
//                  description is the date exploitation HAPPENED; the only candidate is a catalogue
//                  date, and the gap between them is unbounded. Nothing here observes exploitation.
function kevArms(kev, pids) {
  const out = {};
  const ransom = kev.knownRansomwareCampaignUse;
  // THE PROSE USES THE VALIDATED DATE, NOT THE RAW ONE. `kev.dateAdded || fallback` only catches an
  // absent value, so an unparseable one — "sometime" — was echoed into the sentence as though it
  // were a date while the structured `date` field correctly refused it. The document would then say
  // one thing in prose and another in its fields, which is the worse half of a partial refusal.
  // Caught by its own test, 2026-08-26.
  const when = dayStartIso(kev.dateAdded);
  out.threat = {
    category: 'exploit_status',
    details: `CISA Known Exploited Vulnerabilities catalogue. Catalogued ${when ? kev.dateAdded : 'on an unrecorded date'}.`
      + (kev.shortDescription ? ` ${kev.shortDescription}` : '')
      + (ransom ? ` Known ransomware campaign use: ${ransom}.` : ''),
    product_ids: pids,
  };
  if (when) out.threat.date = when;

  if (kev.requiredAction || kev.dueDate) {
    out.remediation = {
      category: 'mitigation',
      details: `${kev.requiredAction || 'CISA requires remediation; no action text recorded.'}`
        + (kev.dueDate
          ? ` CISA remediation due date (fix-by): ${kev.dueDate}. This is a DEADLINE, not an`
            + ' availability date, and is stated here rather than in this remediation\'s `date`'
            + ' field, which CSAF defines as the date from which the remediation is AVAILABLE.'
          : ''),
      product_ids: pids,
    };
  }

  // KEV packs a "; "-separated URL list into `notes`. Split, keep only what parses as http(s), and
  // drop the rest rather than emitting a reference that resolves nowhere.
  out.references = String(kev.notes || '').split(';')
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\/\S+$/.test(u))
    .map((url) => ({ category: 'external', summary: 'CISA KEV reference', url }));

  // vulnerabilityName → title. CSAF defines title as "a canonical name or title FOR THE
  // VULNERABILITY", which is what KEV's field is. It says nothing about which product is affected,
  // so it carries no equivalence claim and needs none.
  if (typeof kev.vulnerabilityName === 'string' && kev.vulnerabilityName.trim()) {
    out.title = kev.vulnerabilityName.trim();
  }

  // vendorProject + product → a NOTE, deliberately not the product tree. These name the product
  // CISA assessed. Our product tree describes what WE ship, and writing CISA's identification into
  // it would assert that the two are the same product — an equivalence nobody established and one
  // a consumer would reasonably act on. As a note the information survives and the claim does not.
  const who = [kev.vendorProject, kev.product].filter((x) => typeof x === 'string' && x.trim()).join(' ');
  if (who) {
    out.note = {
      category: 'other',
      title: 'CISA KEV product identification',
      text: `CISA catalogued this vulnerability against ${who}. That is the product CISA assessed, `
        + 'not a statement that it is the product this document describes; the two are recorded '
        + 'separately on purpose.',
    };
  }
  return out;
}

/**
 * KEV's `cwes` (ids only) → CSAF 2.1's cwes[] ({id, name, version}), using the vendored catalogue.
 *
 * THE WHOLE POINT IS WHAT IT REFUSES. 2.1 requires all three fields, and every CWE source in this
 * repository carries the id alone. Two populations cannot be completed and are dropped rather than
 * invented, with the reason returned so a caller can say so out loud:
 *
 *   deprecated  — the id is not in the current catalogue at all. Measured 2026-08-26 against CWE
 *                 4.20: KEV cites 8 such ids (CWE-399, 264, 189, 310, 19, 255, 388, 254) across 62
 *                 of its 1,676 records. They are retired categories CISA still references. CSAF 2.1
 *                 anticipates this — it defines recommended tests for deprecated and non-latest CWE
 *                 usage — but it offers no way to state one without a name.
 *   unnameable  — MITRE's own name breaks 2.1's name pattern. Exactly one today: CWE-520 is
 *                 ".NET Misconfiguration: Use of Impersonation", and the pattern forbids a leading
 *                 period. The standard cannot carry a name the standard body publishes.
 *
 * Returns { cwes, dropped } — never a silently short array.
 */
// The CSAF tests this implements, quoted rather than paraphrased, because each has a DIFFERENT
// consequence and the first cut collapsed them:
//
//   6.1.11  MANDATORY. "For each CWE it MUST be tested that the given CWE exists and is valid in
//           the `version` provided. Any `id` that refers to a CWE Category or View MUST fail the
//           test." Its own example also fails an entry whose NAME does not match the catalogue for
//           that version — which is why names come from the catalogue and are never hand-written.
//   6.2.23  the CWE must not be deprecated in the given version.
//   6.2.25  the mapping must be allowed. The spec states the allowed set explicitly: "Currently,
//           this includes the two usage state `Allowed` and `Allowed-with-Review`." So DISCOURAGED
//           FAILS THIS TEST. An earlier cut of this function shipped Discouraged with a flag; that
//           was wrong, and it was wrong against 23 ids CISA KEV actually cites.
//   6.2.26  the mapping must be allowed WITHOUT review, so `Allowed-with-Review` fails it. That
//           test exists to TRIGGER a review, not to forbid the mapping — so those entries SHIP,
//           and ship flagged, which is the one case where flag-and-emit is the specified behaviour.
//
// Returns { cwes, dropped, review }. `review` is not decoration: the caller writes it into the
// document, because a mapping that needs review and says so is the whole point of 6.2.26.
export function cwesFromIds(ids, catalogue) {
  const cwes = []; const dropped = []; const review = [];
  const version = catalogue?.version || null;
  const NAME_RE = /^[^\s\-_.](.*[^\s\-_.])?$/;
  const drop = (id, why, test) => dropped.push({ id, why, test });

  for (const id of (ids || [])) {
    if (!/^CWE-[1-9]\d{0,5}$/.test(String(id))) { drop(id, 'malformed id', 'schema'); continue; }

    // 6.1.11 — Category or View MUST fail. Named, because the point of refusing is to say what was
    // refused. An earlier cut reported these as "not present in the catalogue", which was
    // measurably wrong: all eight ids KEV cites are present, as Categories.
    const category = catalogue?.categories?.[id];
    if (category) {
      drop(id, `CWE Category "${category}". CSAF 2.1 mandatory test 6.1.11: any id referring to a Category or View MUST fail. A category is a grouping, not a weakness, and MITRE does not permit mapping one to a vulnerability`, '6.1.11');
      continue;
    }
    const view = catalogue?.views?.[id];
    if (view) {
      drop(id, `CWE View "${view}". CSAF 2.1 mandatory test 6.1.11 fails a View for the same reason as a Category`, '6.1.11');
      continue;
    }

    const name = catalogue?.weaknesses?.[id];
    if (!name) {
      const forbidden = catalogue?.rejectedByCsafNamePattern?.[id];
      drop(id,
        forbidden
          ? `MITRE publishes the name "${forbidden}", which the CSAF 2.1 cwes[].name pattern forbids. The schema cannot carry a name the CWE specification itself grades Allowed for mapping, and 6.1.11 fails an entry whose name does not match the catalogue — so there is no conformant way to cite this weakness at all`
          : 'not present in the vendored CWE catalogue — retired, or newer than the vendored version',
        forbidden ? 'schema+6.1.11' : '6.1.11');
      continue;
    }
    if (!version) { drop(id, 'the catalogue declares no version, and 2.1 requires one', '6.1.11'); continue; }
    if (!NAME_RE.test(name)) { drop(id, 'catalogue name breaks the CSAF 2.1 name pattern', 'schema'); continue; }

    // 6.2.23 — deprecated entries must not be cited. 25 exist in CWE 4.20 and every one of them was
    // emittable from this catalogue until the status was carried; KEV cites none TODAY, which is a
    // fact about today and not a reason to leave the hole open.
    if (catalogue?.status?.[id] === 'Deprecated') {
      drop(id, `"${name}" is DEPRECATED in CWE ${version}`, '6.2.23');
      continue;
    }

    // 6.2.25 / 6.2.26 — MITRE's own mapping grade.
    const usage = catalogue?.mappingUsage?.[id] || 'Unknown';
    if (usage === 'Prohibited' || usage === 'Discouraged') {
      drop(id, `MITRE grades "${name}" as ${usage} for vulnerability mapping; CSAF 2.1 test 6.2.25 allows only Allowed and Allowed-with-Review`, '6.2.25');
      continue;
    }
    if (usage === 'Allowed-with-Review') review.push({ id, name, usage });
    cwes.push({ id, name, version });
  }
  return { cwes, dropped, review };
}

export function buildCsaf(product, manufacturer, statements, rollup, atIso, fidelity = null, enrich = null) {
  const { tree, refToPid } = productTree(product, statements);
  const slice = String(rollup?.sliceId || rollup?.generated || 'unknown');

  const vulnerabilities = statements.map((s) => {
    const pids = s.affects.map((a) => refToPid.get(a.ref)).filter(Boolean).sort();
    const v = {
      cve: /^CVE-/i.test(s.vulnId) ? s.vulnId : undefined,
      ids: /^CVE-/i.test(s.vulnId) ? undefined : [{ system_name: 'commitwork finding id', text: s.vulnId }],
      notes: [{ category: 'description', title: 'commitwork lifecycle', text: s.detail }],
      product_status: { [CSAF_STATUS[s.state]]: pids },
    };
    if (s.state === 'accepted') {
      v.remediations = [{ category: 'no_fix_planned', details: s.reason || 'accepted by the operator; no reason recorded', product_ids: pids }];
    } else if (s.state === 'resolved') {
      v.remediations = [{ category: 'vendor_fix', details: s.detail, product_ids: pids }];
    } else if (s.state === 'false_positive') {
      // csaf_vex requires an impact threat or a flag on known_not_affected; the flag labels are
      // enumerated claims about the code, so this states the recorded reason instead.
      v.threats = [{ category: 'impact', details: s.reason || 'recorded as a false positive; no reason recorded', product_ids: pids }];
    }
    if (s.cvss) v.scores = [{ products: pids, cvss_v3: { version: '3.1', baseScore: s.cvss, baseSeverity: (s.severity || 'NONE').toUpperCase() } }];
    if (s.advisory) v.references = [{ category: 'external', summary: 'advisory', url: s.advisory }];

    // KEV enrichment is VERSION-AGNOSTIC — threats, remediations and references are the same
    // constructs in 2.0 and 2.1 — so it lands in the shared builder and both documents carry it
    // rather than the newer format quietly knowing more than the older one. Opt-in: with no
    // `enrich` supplied the output is byte-identical to what this function produced before.
    const kev = enrich?.kev?.[s.vulnId];
    if (kev) {
      const arms = kevArms(kev, pids);
      // A `false_positive` statement already carries an impact threat; KEV's is a SEPARATE claim
      // about the world (this vulnerability is exploited) rather than about our product (we are not
      // affected), and both belong. Pushed, never overwriting.
      (v.threats ||= []).push(arms.threat);
      if (arms.remediation) (v.remediations ||= []).push(arms.remediation);
      if (arms.references.length) (v.references ||= []).push(...arms.references);
      if (arms.title && !v.title) v.title = arms.title;
      if (arms.note) v.notes.push(arms.note);

      // WEAKNESSES. 2.0's `cwe` is a SINGLE {id, name} — no version, and no room for a second
      // weakness. So 2.0 carries the first resolvable one and 2.1 rebuilds the full array from the
      // same source (see buildCsaf21); neither derives from the other's lossy form.
      //
      // A CWE that cannot be completed is NOT silently absent. The ids and the reason go into a
      // note, because "this vulnerability has no recorded weakness" and "we hold ids we may not
      // publish" are different facts and only one of them is true.
      const { cwes, dropped, review } = cwesFromIds(kev.cwes, enrich?.cweCatalogue);
      if (cwes.length) v.cwe = { id: cwes[0].id, name: cwes[0].name };
      // 6.2.26 EXISTS TO TRIGGER A REVIEW, so the trigger has to reach a human. An earlier cut
      // computed this list and threw it away — the mapping shipped and nothing anywhere said it
      // needed checking, which is the "wired therefore protected" shape in miniature.
      if (review.length) {
        v.notes.push({
          category: 'other',
          title: 'weakness mapping needs review',
          text: `MITRE grades ${review.length === 1 ? 'this weakness' : 'these weaknesses'} `
            + `Allowed-with-Review: ${review.map((r) => `${r.id} (${r.name})`).join('; ')}. `
            + 'CSAF 2.1 test 6.2.26 fails such a mapping by design, to flag that a thorough review '
            + 'should have happened. Nobody in this pipeline has performed that review — the '
            + 'mapping is CISA KEV\'s, carried forward, and this note is the flag rather than a '
            + 'claim that the check was done.',
        });
      }
      if (cwes.length > 1) {
        v.notes.push({
          category: 'other',
          title: 'additional weaknesses',
          text: `CSAF 2.0 carries one weakness per vulnerability. CISA KEV records ${cwes.length} `
            + `for this one: ${cwes.map((c) => c.id).join(', ')}. The CSAF 2.1 document beside this `
            + 'one carries them all in cwes[].',
        });
      }
      if (dropped.length) {
        v.notes.push({
          category: 'other',
          title: 'weakness ids withheld',
          text: `CISA KEV records ${dropped.length} weakness id(s) for this vulnerability that this `
            + 'document does not publish. Each is named with the CSAF test that refuses it, because '
            + '"we hold an id we may not cite" and "no weakness is recorded" are different facts: '
            + `${dropped.map((d) => `${d.id} [${d.test}] — ${d.why}`).join('; ')}. `
            + 'Withheld rather than invented.',
        });
      }
    }
    return v;
  });

  const trackingId = `COMMITWORK-VEX-${product.id.toUpperCase()}-${slice}`;
  return {
    document: {
      category: 'csaf_vex',
      csaf_version: '2.0',
      title: `VEX for ${product.name} ${product.version || ''}`.trim(),
      lang: 'en',
      publisher: {
        category: 'vendor',
        name: manufacturer?.name || 'unknown manufacturer',
        namespace: manufacturer?.namespace || 'https://commitwork.invalid/manufacturer-namespace-not-set',
        contact_details: manufacturer?.contact || undefined,
      },
      notes: [
        {
          category: 'legal_disclaimer',
          title: 'Draft',
          text: 'Generated by commitwork from a provenance-gated lifecycle slice. A DRAFT: submission to ENISA or a CSIRT is a human act and this document asserts no filing.',
        },
        // PHASE 5 — what CSAF could not express travels WITH the document. A silent downgrade is
        // indistinguishable from a lossless one, and the reader cannot tell which they hold.
        ...(fidelity ? [{ category: 'other', title: 'commitwork:fidelity', text: JSON.stringify(fidelity) }] : []),
      ],
      tracking: {
        id: trackingId,
        status: 'final',
        version: '1',
        initial_release_date: atIso,
        current_release_date: atIso,
        revision_history: [{ number: '1', date: atIso, summary: `generated from slice ${slice}` }],
        generator: { engine: { name: 'commitwork', version: 'cra/vex.mjs' } },
      },
    },
    product_tree: tree,
    vulnerabilities,
  };
}

// ── CSAF 2.1 (csaf_vex profile, Committee Specification Draft 02, 25 February 2026) ────────────
//
// A SEPARATE EMITTER, NOT AN UPGRADE — the decision recorded in
// evaluations/reporting-formats-and-taxonomy-extension-2026-08-24.md §2.2, and the schema diff
// vindicates it: 2.1 RENAMES three fields the VEX profile uses, so a document cannot be valid under
// both. 2.0 stays the interoperable target while 2.1 is a draft; §7.4 of the spec defines the
// transition and a conformance clause for a 2.0→2.1 converter, so shipping both is what the
// standard itself anticipates.
//
// THE DELTAS ARE DERIVED FROM THE VENDORED SCHEMA, never from recall. Computed 2026-08-26 by
// diffing schema/upstream/csaf_json_schema.json (2.0) against
// schema/upstream/csaf-2.1-csd02.schema.json (2.1):
//
//   document:           + license_expression, + x_extensions
//                       `distribution` moves from OPTIONAL to REQUIRED
//   vulnerabilities[]:  cwe  → cwes         (object → array)
//                       release_date → disclosure_date
//                       scores → metrics    (score object → {content:{cvss_v3}, products})
//                       + first_known_exploitation_dates, + x_extensions
//   TLP labels:         2.0's WHITE is gone; 2.1 enumerates AMBER, AMBER+STRICT, CLEAR, GREEN, RED
//
// Of those, this profile only ever emits `scores`, so `metrics` is the one live rename. The rest
// are recorded because the next person to extend either emitter needs the list and should not have
// to re-derive it.
//
// Built by projecting the 2.0 document and applying the enumerated deltas, rather than by copying
// 90 lines that would drift: the lifecycle mapping is decided once in cra/vex.mjs and must not be
// re-decided per format. Every transformation below is named and reasoned; nothing is implicit.
export const CSAF_21_VERSION = '2.1';
export const CSAF_21_TLP_LABELS = Object.freeze(['AMBER', 'AMBER+STRICT', 'CLEAR', 'GREEN', 'RED']);
// The exact enum from the 2.1 schema. Pinned in cra/test/csaf-21.test.mjs against the vendored
// document, so a drift here fails rather than emitting a rating the standard does not define.
export const QUALITATIVE_SEVERITY = Object.freeze(['critical', 'high', 'low', 'medium', 'none']);
// A fixed enum in the schema, not a free URL — pinned against the vendored document in the test.
export const CSAF_21_SCHEMA_URL = 'https://docs.oasis-open.org/csaf/csaf/v2.1/schema/csaf.json';

// ── scanner severity vocabulary → CSAF's five words ───────────────────────────────────────────
// EVERY ENTRY IS A TRANSLATION, NOT A RE-CLASSIFICATION. These are the terms real scanners in this
// fleet emit; each maps to the CSAF value that means the same thing, and the original is always
// recorded beside the rating so the reading survives the translation.
//
// `severe` is the case that prompted this: it sits ABOVE high in the vocabularies that use it and
// there is no band between high and critical in CSAF's five, so it maps to `critical` — the
// nearest value that does not UNDERSTATE it. Understating is the direction that costs, and the note
// beside it says the word was "severe" so a reader can tell the difference.
//
// An unmapped term returns no rating. It is not snapped to a neighbour.
export const SEVERITY_SYNONYMS = Object.freeze({
  critical: 'critical', crit: 'critical', severe: 'critical', emergency: 'critical',
  high: 'high', important: 'high', error: 'high',
  medium: 'medium', med: 'medium', moderate: 'medium', warning: 'medium', warn: 'medium',
  low: 'low', minor: 'low', note: 'low', info: 'low', informational: 'low',
  none: 'none', negligible: 'none', unknown: null, unspecified: null,
});

/** @returns {{rating: string|null, source: 'exact'|'mapped'|'unmapped'}} */
export function mapQualitativeSeverity(raw) {
  const key = String(raw || '').trim().toLowerCase();
  if (QUALITATIVE_SEVERITY.includes(key)) return { rating: key, source: 'exact' };
  if (Object.prototype.hasOwnProperty.call(SEVERITY_SYNONYMS, key)) {
    const rating = SEVERITY_SYNONYMS[key];
    return rating ? { rating, source: 'mapped' } : { rating: null, source: 'unmapped' };
  }
  return { rating: null, source: 'unmapped' };
}

/** EPSS publishes one model run per day, so a date-only value widens to that day's start. Stated
 *  rather than silent: CSAF requires date-time and the feed gives a date, and inventing a time of
 *  day would be precision we do not have. Returns null for anything not YYYY-MM-DD — never a
 *  guessed timestamp, because the field would then be a fact nobody measured. */
export const epssTimestamp = dayStartIso;

// CSAF 2.1 constrains percentile and probability to a fixed decimal string. A number that has been
// through a float would render as "0.00386" or worse "3.86e-3", which the pattern rejects — hence
// the verbatim strings in the sidecar. Anything that does not match is DROPPED, not coerced.
const EPSS_DECIMAL = /^(([0]\.([0-9])+)|([1]\.[0]+))$/;

export function buildCsaf21(product, manufacturer, statements, rollup, atIso, fidelity = null, enrich = null) {
  const doc = buildCsaf(product, manufacturer, statements, rollup, atIso, fidelity, enrich);
  // The statement behind each vulnerability, for fields 2.0 has no home for. Keyed on the same
  // upper-cased vuln id buildCsaf writes into `cve`.
  const byVulnId = new Map(statements.map((s) => [s.vulnId, s]));

  doc.document.csaf_version = CSAF_21_VERSION;

  // $schema IS REQUIRED AT THE TOP LEVEL IN 2.1 and was not in 2.0, whose only required key is
  // `document`. The value is a fixed enum, not a free URL. Found by the write-path enforcer on
  // 2026-08-26, AFTER a commit had already published documents without it — which is the argument
  // for the enforcer in one line: the derived rename guard compared `document` and
  // `vulnerabilities[]` and was blind to everything else in the file.
  doc.$schema = CSAF_21_SCHEMA_URL;

  // product_tree.relationships → product_paths. THE FIFTH BREAKING CHANGE, and the one a rename
  // list does not catch, because it is a restructure: 2.0 states a relationship as a flat triple,
  // 2.1 states it as a PATH with a beginning node and an ordered list of subpaths. The mapping is
  // exact for the one shape this profile emits (a component of a product) and — critically — keeps
  // the same synthesised product id, so every `product_ids` reference in vulnerabilities[] still
  // resolves. A conversion that renamed the container and re-minted the ids would have produced a
  // schema-valid document full of dangling references, which is worse than an invalid one.
  const rels = doc.product_tree?.relationships;
  if (Array.isArray(rels)) {
    doc.product_tree.product_paths = rels.map((r) => ({
      beginning_product_reference: r.product_reference,
      subpaths: [{ category: r.category, next_product_reference: r.relates_to_product_reference }],
      full_product_name: r.full_product_name,
    }));
    delete doc.product_tree.relationships;
  }

  // DISTRIBUTION IS REQUIRED IN 2.1 and was not emitted at all before, so a 2.0 document promoted
  // by a naive converter would be invalid. The label is a DISCLOSURE CLAIM about a document nobody
  // has cleared for release, so it is never silently CLEAR: a declared label is used, and an
  // undeclared one falls to AMBER — the restrictive direction — with the absence stated in the
  // document rather than hidden behind a default that reads as a decision.
  const declared = manufacturer?.tlp && CSAF_21_TLP_LABELS.includes(manufacturer.tlp) ? manufacturer.tlp : null;
  doc.document.distribution = {
    tlp: { label: declared || 'AMBER' },
    text: declared
      ? `TLP:${declared} as declared by the manufacturer record.`
      : 'No TLP label was declared for this manufacturer. AMBER is applied as the RESTRICTIVE '
        + 'default: this is a generated draft that no one has cleared for release, and defaulting '
        + 'to CLEAR would assert a disclosure decision nobody made.',
  };

  for (const v of doc.vulnerabilities) {
    // scores → metrics. The CVSS payload is unchanged; the envelope is {content, products} and both
    // are required by the 2.1 schema. `source` is deliberately omitted rather than filled with our
    // own name — we did not score these, we carried a score the advisory gave.
    if (v.scores) {
      v.metrics = v.scores.map((s) => ({ content: { cvss_v3: s.cvss_v3 }, products: s.products }));
      delete v.scores;
    }
    // cwe → cwes. 2.0 carried ONE weakness without a version; 2.1 takes an array of {id, name,
    // version}. Rebuilt from the SAME source rather than promoted from 2.0's lossy single value, so
    // a vulnerability with four weaknesses publishes four here and does not inherit 2.0's ceiling.
    // The 2.0 shape is deleted either way — `additionalProperties: false` on 2.1's vulnerability
    // items means leaving it behind would invalidate the whole document.
    delete v.cwe;
    const kevRec = enrich?.kev?.[v.cve];
    if (kevRec) {
      const { cwes } = cwesFromIds(kevRec.cwes, enrich?.cweCatalogue);
      if (cwes.length) v.cwes = cwes;
    }
    if (v.release_date) { v.disclosure_date = v.release_date; delete v.release_date; }

    // QUALITATIVE SEVERITY — a 2.1 metric fed from a severity this fleet already holds and 2.0 has
    // no field for.
    //
    // THE FIRST CUT DROPPED ANYTHING OUTSIDE THE ENUM, and that was wrong in a way worth naming. A
    // scanner's severity is that scanner's READING, expressed in that scanner's vocabulary. CSAF's
    // enum is a different lexicon. Dropping the reading loses information; silently rewriting it
    // into CSAF's words loses the fact that a different instrument said a different thing. Both are
    // avoidable: MAP for the structured field, and KEEP the original beside it.
    //
    // So a mapped term emits the CSAF value AND records what was actually read. A term with no
    // defensible mapping emits no rating and says so — still never snapped to the nearest-looking
    // one, because a severity nobody assigned is a severity nobody can check.
    const st = byVulnId.get(v.cve) || null;
    const raw = typeof st?.severity === 'string' ? st.severity.trim() : null;
    if (raw) {
      const { rating, source } = mapQualitativeSeverity(raw);
      const products = v.metrics?.[0]?.products || Object.values(v.product_status || {}).flat();
      if (rating && products.length) {
        (v.metrics ||= []).push({ content: { qualitative_severity_rating: rating }, products });
      }
      if (source === 'mapped') {
        v.notes.push({
          category: 'other',
          title: 'severity vocabulary',
          text: `MAPPED FROM "${raw}". The instrument that assessed this vulnerability reported `
            + `"${raw}"${st.origin ? ` (origin: ${st.origin})` : ''}. CSAF 2.1's `
            + `qualitative_severity_rating enumerates only ${QUALITATIVE_SEVERITY.join(', ')} and `
            + `has no value "${raw}", so the rating above reads "${rating}". That is a TRANSLATION `
            + 'into CSAF\'s lexicon, not a re-assessment: no one re-rated this vulnerability, and '
            + 'the original term is recorded here so a mapped rating stays distinguishable from a '
            + 'native one. Where the mapping had to choose, it chose the value that does not '
            + 'understate the reading.',
        });
      } else if (!rating) {
        v.notes.push({
          category: 'other',
          title: 'severity not expressible',
          text: `The scanner reported this as "${raw}", which has no defensible mapping onto CSAF's `
            + `${QUALITATIVE_SEVERITY.join('/')} scale. No qualitative rating is published for it — `
            + 'the reading is preserved here rather than rounded to a neighbouring value.',
        });
      }
    }

    // EPSS — 2.1 EXPRESSES SOMETHING 2.0 COULD NOT, and the data was already on disk. Emitted as
    // its own metrics entry rather than folded into the CVSS one: they come from different
    // authorities (the advisory scored the CVSS, FIRST publishes the EPSS) and a single entry would
    // imply one source for both. ALL THREE FIELDS ARE REQUIRED by the schema; a partial triple is
    // dropped entirely rather than padded, because a percentile we invented is worse than a metric
    // we omitted.
    const e = enrich?.epss?.[v.cve];
    if (e) {
      const ts = epssTimestamp(e.date);
      if (ts && EPSS_DECIMAL.test(String(e.probability)) && EPSS_DECIMAL.test(String(e.percentile))) {
        const products = v.metrics?.[0]?.products || Object.values(v.product_status || {}).flat();
        if (products.length) {
          (v.metrics ||= []).push({
            content: { epss: { probability: String(e.probability), percentile: String(e.percentile), timestamp: ts } },
            products,
          });
        }
      }
    }
    // first_known_exploitation_dates IS DELIBERATELY NOT FED, and this is the reasoning rather than
    // an oversight. The obvious source is CISA KEV, whose `dateAdded` is the date the catalogue
    // RECORDED the vulnerability as known-exploited. The 2.1 field's own description is "the date
    // when the exploitation happened". Those are different claims, and the gap between them is
    // unbounded — a vulnerability exploited for months before it is catalogued would be published
    // by us as first exploited on the day CISA noticed. That is a date a regulator would read as
    // observed fact. Nothing in this fleet observes exploitation, so the field stays absent, which
    // is the honest state and is distinguishable from a zero.
  }
  return doc;
}

// ── OpenVEX v0.2.0 ──────────────────────────────────────────────────────────────────────────────
export const OPENVEX_STATUS = {
  exploitable: 'affected',
  accepted: 'affected',
  in_triage: 'under_investigation',
  false_positive: 'not_affected',
  resolved: 'fixed',
};

// Findings carry repo/package/version but no ecosystem, so a purl cannot be derived without
// guessing its type. A urn keeps the identifier honest and stable; it is not a purl and does not
// pretend to be one.
const componentIri = (a) => `urn:commitwork:component:${a.ref}`;

export function buildOpenVex(product, manufacturer, statements, atIso, fidelity = null) {
  const author = manufacturer?.name
    ? `${manufacturer.name}${manufacturer.contact ? ` <${manufacturer.contact}>` : ''}`
    : 'unknown manufacturer';

  const openvexStatements = statements.map((s) => {
    const st = {
      vulnerability: { name: s.vulnId },
      timestamp: s.lastUpdated,
      products: [{
        '@id': `urn:commitwork:product:${product.id}`,
        subcomponents: s.affects.map((a) => ({ '@id': componentIri(a) })),
      }],
      status: OPENVEX_STATUS[s.state],
    };
    // The spec requires an action_statement on `affected` and one of justification /
    // impact_statement on `not_affected`. Justifications are never synthesised — see the header.
    if (st.status === 'affected') {
      st.action_statement = s.state === 'accepted'
        ? `No fix planned. ${s.reason || 'Accepted by the operator; no reason recorded.'}`
        : `Remediate. ${s.detail}`;
      st.action_statement_timestamp = s.lastUpdated;
    } else if (st.status === 'not_affected') {
      st.impact_statement = s.reason || s.detail;
    }
    return st;
  });

  return {
    '@context': 'https://openvex.dev/ns/v0.2.0',
    '@id': `https://openvex.dev/docs/commitwork/${contentUUID(stableStringify({ p: product.id, s: openvexStatements })).replace('urn:uuid:', '')}`,
    author,
    role: 'Document Creator',
    timestamp: atIso,
    last_updated: atIso,
    version: 1,
    tooling: 'commitwork cra/vex.mjs',
    // A custom key: OpenVEX has no field for translation loss, and dropping the declaration because
    // the format lacks a home for it is exactly the silence this is meant to break.
    ...(fidelity ? { 'commitwork:fidelity': fidelity } : {}),
    statements: openvexStatements,
  };
}
