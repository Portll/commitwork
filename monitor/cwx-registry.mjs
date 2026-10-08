// monitor/cwx-registry.mjs — CommitWork eXploit (CWX) id registry + weakness-class map.
// primaryId is EITHER a public advisory (CVE-/GHSA-) OR a CWX minted here; bugIsFoundational is
// DERIVED from the id space, never stored. CWX is NOT MITRE CWE — it maps to CWE as weaknessClass,
// never impersonates it (CWE/CVE used under MITRE Terms of Use, attribution required).
// FORMAT: CWX- + 6 chars, zero-padded; overflow ladder 10^6 decimal -> 16^6 hex -> 36^6 base36.
// MATCHER is case-SENSITIVE and anchored — a loose 'cwx' match false-positives inside GHSA codes.

export const CWX_RE = /^CWX-[0-9A-Z]{6}$/;              // exact minted format, case-sensitive
export const CVE_RE = /^CVE-[0-9]{4}-[0-9]{4,}$/;
export const GHSA_RE = /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/;

const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Is s a valid minted CWX id (strict)? */
export function isCwx(s) { return typeof s === 'string' && CWX_RE.test(s); }
export function isPublicAdvisory(s) { return CVE_RE.test(s) || GHSA_RE.test(s); }

/** DERIVED foundational: CWX => self-found (true); CVE/GHSA => inherited (false). */
export function isFoundational(primaryId) { return isCwx(primaryId); }

/** Encode an ordinal (0-based) to a 6-wide CWX suffix, climbing the digits->hex->base36 ladder. */
export function ordinalToSuffix(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error('CWX ordinal must be a non-negative integer');
  const DEC = 1000000, HEX = 16 ** 6, B = 36 ** 6;
  let base, val;
  if (n < DEC) { base = 10; val = n; }
  else if (n < DEC + HEX) { base = 16; val = n - DEC; }
  else if (n < DEC + HEX + B) { base = 36; val = n - DEC - HEX; }
  else throw new Error('CWX space exhausted (>2.18e9) — extend the ladder');
  let s = val.toString(base).toUpperCase();
  if (s.length > 6) throw new Error('CWX suffix overflow at base ' + base);
  return s.padStart(6, '0');
}

/**
 * A registry backed by a plain JSON object { nextOrdinal, byKey: {findingKey: cwxId},
 *   entries: {cwxId: {mintedAt, findingKey, weaknessClass[], cvxRef?}} }.
 * Minting is IDEMPOTENT on findingKey: the same self-found finding always gets the same CWX.
 */
export function createRegistry(state) {
  const reg = state && typeof state === 'object'
    ? state
    : { nextOrdinal: 0, byKey: {}, entries: {} };
  reg.byKey ||= {}; reg.entries ||= {}; reg.nextOrdinal ||= 0;

  return {
    state: reg,
    /** Mint (or return existing) CWX for a self-found finding key. nowIso supplied by caller. */
    mint(findingKey, nowIso, weaknessClass = []) {
      if (!findingKey) throw new Error('findingKey required');
      if (reg.byKey[findingKey]) {
        const id = reg.byKey[findingKey];
        // Ids are append-only, never reassigned. weaknessClass backfill is information-gain only:
        // fill an empty stored class, never overwrite or empty a non-empty one.
        const e = reg.entries[id];
        if (e && Array.isArray(weaknessClass) && weaknessClass.length
            && !(Array.isArray(e.weaknessClass) && e.weaknessClass.length)) e.weaknessClass = weaknessClass;
        return id;
      }
      const id = 'CWX-' + ordinalToSuffix(reg.nextOrdinal);
      reg.nextOrdinal += 1;
      reg.byKey[findingKey] = id;
      reg.entries[id] = { mintedAt: nowIso || null, findingKey, weaknessClass, cveRef: null };
      return id;
    },
    /** When a CWX later matches a public advisory: record the mapping. primaryId becomes the CVE/GHSA
     *  (caller updates the record); the CWX is RETAINED as cwxRef and the entry records the cveRef. */
    mapToPublic(cwxId, publicAdvisoryId) {
      if (!isCwx(cwxId)) throw new Error('not a CWX id: ' + cwxId);
      if (!isPublicAdvisory(publicAdvisoryId)) throw new Error('not a public advisory: ' + publicAdvisoryId);
      (reg.entries[cwxId] ||= {}).cveRef = publicAdvisoryId;
      return { primaryId: publicAdvisoryId, cwxRef: cwxId, foundationalNow: false, foundFirst: true };
    },
    lookup(cwxId) { return reg.entries[cwxId] || null; },
  };
}

/**
 * ruleId -> MITRE weaknessClass map; seed table here, fuller table in monitor/ruleId-cwe.json.
 * opts.allowHeuristic (default true) gates ONLY the shape-matching fallback — dependency findings
 * carry a package name in the ruleId slot, so callers turn it off there (a package named `xss`
 * must not be handed a CWE by its spelling). The exact-table lookup is always safe.
 */
export function weaknessClassForRule(ruleId, ruleCweTable, opts = {}) {
  const { allowHeuristic = true } = opts;
  if (!ruleId) return [];
  if (ruleCweTable && ruleCweTable[ruleId]) return ruleCweTable[ruleId];
  if (!allowHeuristic) return [];
  // heuristic fallback by ruleId shape (documented, coarse) — better than nothing, flagged low-confidence.
  const s = String(ruleId).toLowerCase();
  if (/sql[-_]?inj/.test(s)) return ['CWE-89'];
  if (/idor|bola|tenant|authoriz/.test(s)) return ['CWE-639'];
  if (/xxe/.test(s)) return ['CWE-611'];
  if (/ssrf/.test(s)) return ['CWE-918'];
  if (/deserial/.test(s)) return ['CWE-502'];
  if (/path[-_]?travers/.test(s)) return ['CWE-22'];
  if (/command[-_]?inj|os[-_]?command/.test(s)) return ['CWE-78'];
  if (/xss|cross[-_]?site/.test(s)) return ['CWE-79'];
  if (/hardcoded|secret|credential/.test(s)) return ['CWE-798'];
  return [];
}
