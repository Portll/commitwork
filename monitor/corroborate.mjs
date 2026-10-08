// corroborate.mjs — two scanners agreeing is EVIDENCE, and it was rendering as two problems.
//
// Measured 2026-08-26 on the 100-repository corpus: of 9,278 unique findings, 138 come from npm
// audit and 135 of those (97.8%) are the SAME advisory as an osv row — same repo, same package,
// with npm's GHSA sitting in the osv row's alias group. AlkaidLab_foundation-sunshine's body-parser
// is CVE-2026-12590 to osv and GHSA-v422-hmwv-36x6 to npm. The page showed two criticals.
//
// fact: corroboration is a VIEW and additive, never a merge — both rows keep their identity and place and each gains a pointer to the other / finding identity is `repo|tool|id|package|path`, so collapsing the pair deletes the npm key, and a key that VANISHES is how the ledger says FIXED (expiry: never, prev: wrong)
// fact: merging would have reported 135 findings as remediated in one slice while every one was still there — the auto-close defect this repository has already been bitten by, at 17x the scale (expiry: never, prev: wrong)
//
// It also keeps the thing worth keeping. Two independent tools agreeing is stronger evidence than
// either alone, and DISAGREEMENT is stronger still — a lane that sees something the other misses is
// the signal that lane exists for. A merged row throws both away and reports an unsourced claim.
//
// THE THIRD KIND OF ROW. The 3 npm rows with no osv twin are not npm-only findings. They are npm
// audit's PARENT ROLLUPS: `via` holds only strings, so parseNpm's no-advisory branch fires and sets
// `id` to the PACKAGE NAME — `less`, `discord.js`, `@discordjs/rest` — with an empty advisory
// field. npm is attributing a child's vulnerability to the parent; osv attributes it to the child,
// which is why it has no row for the parent. These render at high/med while citing no advisory
// anyone can look up, so they are marked rather than left to read as advisory-backed findings.

/** An advisory id names an advisory. `less` does not. */
const ADVISORY_ID = /^(CVE|GHSA|MAL|GO|PYSEC|RUSTSEC|OSV)-/i;

export const isAdvisoryId = (id) => ADVISORY_ID.test(String(id || ''));

export const enabled = () => process.env.CW_CORROBORATE !== 'off';

const repoOf = (f) => String((f && f.key) || '').split('|')[0] || (f && f.repo) || '';

/**
 * Mark rows that describe the same advisory as one another, and rows that cite no advisory at all.
 *
 * ADDITIVE ONLY — no row is removed, no field that participates in identity (`tool`, `id`,
 * `package`, `path`) is touched. Returns the same array, same order, same length.
 *
 * @param {Array} findings every finding for one repo, from every tool
 * @returns {Array} the same rows, annotated
 */
export function markCorroboration(findings) {
  const rows = findings || [];
  if (!enabled() || rows.length < 1) return rows;

  // alias id -> the rows that own it, so the join is one pass rather than n².
  const byAlias = new Map();
  for (const f of rows) {
    if (!f) continue;
    for (const a of [f.id, ...(Array.isArray(f.aliases) ? f.aliases : [])]) {
      if (!a) continue;
      const k = `${repoOf(f)}|${f.package || ''}|${a}`;
      if (!byAlias.has(k)) byAlias.set(k, []);
      byAlias.get(k).push(f);
    }
  }

  for (const f of rows) {
    if (!f) continue;
    // A row citing no advisory is not advisory-backed evidence, whatever its severity says.
    if (!isAdvisoryId(f.id)) {
      f.citesNoAdvisory = true;
      f.attribution = 'parent-rollup';
    }
    const seen = new Set();
    const twins = [];
    for (const a of [f.id, ...(Array.isArray(f.aliases) ? f.aliases : [])]) {
      for (const g of byAlias.get(`${repoOf(f)}|${f.package || ''}|${a}`) || []) {
        // A different TOOL is corroboration. The same tool matching its own alias is not.
        if (g === f || g.tool === f.tool) continue;
        const k = `${g.tool}|${g.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        twins.push({ tool: g.tool, id: g.id, path: g.path || '' });
      }
    }
    if (twins.length) {
      f.corroboratedBy = twins;
      // Stated as a count so a consumer can rank by it without re-deriving the join.
      f.tools = 1 + twins.length;
    }
  }
  return rows;
}

// ── PLACE corroboration, for a lane that cites no advisory (D15) ─────────────────────────────────
// The join above needs an advisory id. Socket's `criticalCVE` alert has none: the whole alert is
// {type, policy, url, manifest}, and the url yields ecosystem/package/version and nothing more. So
// it cannot be told from an osv row by alias, only by PLACE.
//
// THAT JOIN IS WEAKER AND IS LABELLED AS SUCH. "osv reports a CVE in form-data, Socket reports a
// critical CVE in form-data" does not establish they are the same CVE — a package can carry two.
// `basis: 'place'` travels on every mark so a reader (and any future ranking) can tell a
// package-level coincidence from an advisory-level identity. Calling both "corroborated" without
// the distinction would launder the weaker claim through the stronger one's word.
//
// Version is NOT in the key, per the house rule: a version is a moving field, and re-keying on one
// turns an upgrade into a new finding. Ecosystem IS — `requests` on npm is not `requests` on PyPI.
//
// ADDITIVE ONLY, like its sibling: no row is removed and no identity field is touched.
export function markPlaceCorroboration(rows, advisoryRows, { repo = '' } = {}) {
  const out = rows || [];
  if (!enabled() || !out.length) return out;
  const byPlace = new Map();
  for (const f of advisoryRows || []) {
    if (!f || !f.package) continue;
    // An advisory row has no `ecosystem` field; it is keyed on package alone, and a Socket row is
    // matched on package with its ecosystem carried through for the reader rather than the join.
    const k = `${repoOf(f) || repo}|${f.package}`;
    if (!byPlace.has(k)) byPlace.set(k, []);
    byPlace.get(k).push(f);
  }
  for (const r of out) {
    if (!r || !r.package) continue;
    const twins = (byPlace.get(`${repo}|${r.package}`) || [])
      .map((g) => ({ tool: g.tool || 'osv', id: g.id, package: g.package }));
    if (!twins.length) continue;
    r.corroboratedBy = twins;
    r.corroborationBasis = 'place';
    r.tools = 1 + twins.length;
  }
  return out;
}

/** Fleet-level tally, for the note published beside the counts. */
export function corroborationReport(findings) {
  const rows = (findings || []).filter(Boolean);
  const corroborated = rows.filter((f) => f.corroboratedBy && f.corroboratedBy.length).length;
  const noAdvisory = rows.filter((f) => f.citesNoAdvisory).length;
  return {
    enabled: enabled(),
    total: rows.length,
    corroborated,
    soleWitness: rows.length - corroborated,
    citesNoAdvisory: noAdvisory,
    note: corroborated
      ? `${corroborated} of ${rows.length} findings are reported by more than one tool under aliases of the same advisory. They remain SEPARATE rows on purpose: finding identity includes the tool, and collapsing them would delete a key, which the ledger reads as FIXED. Corroboration is a view over the rows, never an edit to them. Set CW_CORROBORATE=off to disable.`
      : '',
  };
}

// ── meta-SAST: cross-tool corroboration for SAST findings (D — 2026-09-01) ───────────────────────
//
// Semgrep, CodeQL, gosec and friends are PEER scanners, not primary/secondary the way osv/Socket
// are above — none of them owns the advisory namespace the alias join up top relies on. So this
// joins WITHIN one combined list (closer in shape to markCorroboration than to
// markPlaceCorroboration), keyed on repo|file, tightened to repo|file|CWE when both rows carry one
// (per sarif-read.mjs's cweOf() — see monitor/extractors.mjs's CWE_ROW_KEYS). File-only is a
// coincidence of location; a shared CWE is corroboration ON A CLAIM, and the twin string says which
// kind so a reader is never told the weaker one in the stronger one's word — same discipline as
// `basis: 'place'` above.
//
// SERIALIZED, not structured. These rows pass through detail-schema.mjs's strict validateRows(),
// which rejects any undeclared field and has no array/object field type — so `corroboratedBy` is a
// capped STRING ("sastCodeql:js/xss [cwe], sastGo:G101") rather than the array of objects the join
// above returns. A consumer that wants structure re-splits on ', '.
//
// ADDITIVE ONLY, same as its siblings: no row is removed, and `rule`/`file` — the identity tuple —
// are never touched. `corroboratedBy` starts '' (rowsFor's declared-field default) and this only
// ever overwrites that default with real content; it is not itself part of any row's identity.
export const SAST_JOIN_KEYS = [
  'sastSemgrep', 'sastAuto', 'sastGo',
  'sastCodeql', 'sastCodeqlJava', 'sastCodeqlPython', 'sastCodeqlRuby',
  'sastCodeqlCpp', 'sastCodeqlSwift', 'sastCodeqlCsharp', 'sastCodeqlRust', 'sastCodeqlGo',
  'sastJoern', 'sastBearer', 'sastElixir', 'sastBrakeman', 'sastPhp',
];

const CORROBORATED_BY_MAX = 2000; // matches detail-schema.mjs's STR_MAX; rowsFor truncates independently, this just avoids building a string far past it

/**
 * Cross-tool SAST corroboration over the fleet-flattened `scannerFindings` object.
 *
 * @param {Record<string, Array>} findingsByCategory rollup's scannerFindings — only SAST_JOIN_KEYS
 *        entries are read; every row must already carry `repo` (the fleet flatten does this).
 * @returns {Record<string, Array>} the same object, rows mutated in place, for chaining
 */
export function markSastPlaceCorroboration(findingsByCategory) {
  if (!enabled() || !findingsByCategory) return findingsByCategory;

  // one flat list of {tool, row}, place-keyed, so the join is one pass rather than n^2 across
  // every SAST category pair
  const all = [];
  for (const tool of SAST_JOIN_KEYS) {
    for (const row of findingsByCategory[tool] || []) if (row && row.file) all.push({ tool, row });
  }
  const byPlace = new Map();
  for (const entry of all) {
    const k = `${entry.row.repo || ''}|${entry.row.file}`;
    if (!byPlace.has(k)) byPlace.set(k, []);
    byPlace.get(k).push(entry);
  }

  const cweSet = (s) => new Set(String(s || '').split(', ').filter(Boolean));

  for (const { tool, row } of all) {
    const k = `${row.repo || ''}|${row.file}`;
    const rowCwe = cweSet(row.cwe);
    const seen = new Set();
    const twins = [];
    for (const peer of byPlace.get(k) || []) {
      // a different TOOL is corroboration; the same tool matching its own file is not
      if (peer.tool === tool) continue;
      const idKey = `${peer.tool}|${peer.row.rule || ''}`;
      if (seen.has(idKey)) continue;
      seen.add(idKey);
      const sharedCwe = rowCwe.size && [...cweSet(peer.row.cwe)].some((c) => rowCwe.has(c));
      twins.push(`${peer.tool}:${peer.row.rule || ''}${sharedCwe ? ' [cwe]' : ''}`);
    }
    if (twins.length) row.corroboratedBy = twins.join(', ').slice(0, CORROBORATED_BY_MAX);
  }
  return findingsByCategory;
}

/** Fleet-level tally for SAST corroboration, alongside its SCA sibling above. */
export function sastCorroborationReport(findingsByCategory) {
  const rows = SAST_JOIN_KEYS.flatMap((k) => (findingsByCategory && findingsByCategory[k]) || []);
  const corroborated = rows.filter((r) => r && r.corroboratedBy).length;
  const withCwe = rows.filter((r) => r && r.corroboratedBy && r.corroboratedBy.includes('[cwe]')).length;
  return {
    enabled: enabled(),
    total: rows.length,
    corroborated,
    withCweMatch: withCwe,
    soleWitness: rows.length - corroborated,
    note: corroborated
      ? `${corroborated} of ${rows.length} SAST findings are flagged by more than one tool at the same file (${withCwe} of those additionally agree on a CWE). They remain SEPARATE rows on purpose, same as the SCA corroboration above — this is a view, never a merge. Set CW_CORROBORATE=off to disable.`
      : '',
  };
}

export default {
  markCorroboration, corroborationReport, isAdvisoryId, enabled,
  markSastPlaceCorroboration, sastCorroborationReport, SAST_JOIN_KEYS,
};
