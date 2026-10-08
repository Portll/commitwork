/**
 * Read the remediation target out of an osv-scanner SARIF rule.
 *
 * osv-scanner renders a `### Fixed Versions` markdown table into `rule.help.text`:
 *
 *     | Vulnerability ID | Package Name | Fixed Version |
 *     | --- | --- | --- |
 *     | GHSA-2mjp-6q6p-2qxm | undici | 6.24.0, 7.24.0 |
 *
 * rollup.mjs hardcoded `fixed: ''` on the osv lane, so every dep-CVE finding published with no
 * remediation target while the target sat in the artifact being parsed. Measured 2026-08-26 over
 * 60 sweep artifacts: 1057 of 1186 rules carry this table. The consequence downstream is worse
 * than a blank column — lifecycle's `patchAvailability` axis reads `open`, so a finding with a
 * shipped fix presents as one with no known fix.
 *
 * Two properties this must not violate:
 *   · The row is keyed by BOTH id and package. One advisory legitimately appears under several
 *     package names (GHSA-x744-4wpc-v9h2 lists github.com/moby/moby AND github.com/docker/docker
 *     at 29.3.1); matching on id alone would attach a version to the wrong package.
 *   · The table's id column is often the GHSA or GO- id while `rule.id` is the CVE, so aliases
 *     (rule.deprecatedIds) have to be in the match set.
 *
 * Never guesses. A cell listing several fix lines ('6.24.0, 7.24.0' — different major branches)
 * is returned VERBATIM rather than reduced to one, because choosing a branch for the reader is a
 * judgement the advisory did not make. Ambiguity and absence both return ''.
 */

const TABLE = /###\s*Fixed Versions\s*\n\|[^\n]*\|\s*\n\|[\s|:-]*\|\s*\n([\s\S]*?)(?:\n\s*\n|$)/;

/** Split one markdown table row into trimmed cells, dropping the leading/trailing empties. */
function cells(line) {
  const parts = line.split('|');
  if (parts.length < 3) return null;
  return parts.slice(1, -1).map((s) => s.trim());
}

/**
 * @param {string} help          rule.help.text
 * @param {{id?:string, aliases?:string[], pkg?:string}} want
 * @returns {string} the advisory's fixed-version cell verbatim, or '' when absent/ambiguous
 */
export function fixFromOsvHelp(help, want = {}) {
  if (typeof help !== 'string' || !help) return '';
  const m = help.match(TABLE);
  if (!m) return '';

  const ids = new Set([want.id, ...(Array.isArray(want.aliases) ? want.aliases : [])]
    .filter((x) => typeof x === 'string' && x));
  const pkg = typeof want.pkg === 'string' ? want.pkg.trim() : '';

  const rows = [];
  for (const line of m[1].split('\n')) {
    const c = cells(line);
    if (!c || c.length < 3) continue;
    const [rowId, rowPkg, fixed] = c;
    if (!fixed || fixed === '-') continue;
    rows.push({ rowId, rowPkg, fixed });
  }
  if (!rows.length) return '';

  // Package is the stronger key: an advisory covering several packages carries a different target
  // for each. Without a package to match on there is nothing to disambiguate, so require one.
  if (!pkg) return '';
  let scoped = rows.filter((r) => r.rowPkg === pkg);
  if (!scoped.length) return '';

  // Prefer rows whose id we actually recognise; fall back to the package-scoped set when the
  // table keys on an id that never reached us (a GO- id with no alias row, say).
  const byId = scoped.filter((r) => ids.has(r.rowId));
  if (byId.length) scoped = byId;

  let distinct = [...new Set(scoped.map((r) => r.fixed))];

  // Databases disagree about the same package: for rustls-webpki the GHSA row reads
  // '0.103.10, 0.104.0-alpha.5' and the RUSTSEC row reads '0.103.10'. Both are aliases of this
  // finding, so neither is wrong and averaging them would be invention. But the scanner already
  // chose which advisory keys the finding — rule.id — so deferring to that row is a citation,
  // not a guess. Only an EXACT id match qualifies; an alias does not inherit the tie-break.
  if (distinct.length > 1 && want.id) {
    const primary = [...new Set(scoped.filter((r) => r.rowId === want.id).map((r) => r.fixed))];
    if (primary.length === 1) return primary[0];
  }

  // Still disagreeing: the table said something this function cannot faithfully reduce.
  return distinct.length === 1 ? distinct[0] : '';
}

/**
 * Diagnostic companion — why a rule produced no target. Exported so a test can assert the
 * distribution over real artifacts instead of trusting that '' means "no fix exists".
 * @returns {'ok'|'no-table'|'no-package'|'package-unmatched'|'ambiguous'}
 */
export function fixReason(help, want = {}) {
  if (typeof help !== 'string' || !help || !TABLE.test(help)) return 'no-table';
  const pkg = typeof want.pkg === 'string' ? want.pkg.trim() : '';
  if (!pkg) return 'no-package';
  const m = help.match(TABLE);
  const rows = m[1].split('\n').map(cells).filter((c) => c && c.length >= 3 && c[2] && c[2] !== '-');
  if (!rows.some((c) => c[1] === pkg)) return 'package-unmatched';
  return fixFromOsvHelp(help, want) ? 'ok' : 'ambiguous';
}
