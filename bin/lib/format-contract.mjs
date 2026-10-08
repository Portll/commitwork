// Every `report.format` a committed manifest declares must have a committed reader.
//
// THE INSTANCE. A commit landed `manifests/security-baseline.json` declaring
// `report.format: "bearer"` while `bin/commitwork.mjs` had no bearer branch — the manifest and the
// parser were edited together in one working tree and committed apart. `parseReport('bearer', <a
// 171-finding report>)` fell through to the `generic` pass-through and returned
// `{ok:true, sev:'ok'}`: a SILENT GREEN on the one lane whose entire defect was that two readers of
// one artifact disagreed about whether it existed. Strictly worse than the honest grey it replaced.
// A later commit repaired it. Both commits are this module's fixtures.
//
// Every local check passed for the author, because the author's tree held the missing file.
// `node --check` passed, the tests passed, the import resolved. That is the shape CLAUDE.md names:
// a commit is closed over its own change set, and the author's working tree is not the repository.
//
// WHY FROM HEAD BLOBS AND NOTHING ELSE. This runs with no worktree, no `monitor/projects.json`, no
// `.claude/store`, no `node_modules`. That is not frugality — it is the only way the check can run
// at all. HEAD is not self-sufficient in this repository (N3: `git archive HEAD` yields 114 test
// failures, a worktree 100, the working tree 9), so any assertion that needs a loadable checkout
// cannot be made yet. This one needs two blobs and a tree listing.
//
// TWO CLAUSES, and the second is the one that survives a future mistake. Membership in
// PARSED_FORMATS is itself a declaration; asserting the BRANCH exists in the committed source is
// asserting the effect. The original defect trips either. A future commit that adds the set entry
// and forgets the branch trips only the second.

/** Parse a `new Set([...])` initialiser out of source text. Returns an empty Set when absent — the
 *  caller decides whether that is a void, because "no formats declared" and "could not find the
 *  declaration" are different claims and only the caller knows which is expected. */
export function setLiteral(source, name) {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- name is a literal export name from this contract table
  const m = new RegExp(`export const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(source);
  if (!m) return null;                       // null = not found, distinct from an empty Set
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
}

/** Does the reader source carry an actual `format === '<fmt>'` branch? */
export function hasBranch(source, fmt) {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- fmt is regex-escaped on the same line
  return new RegExp(`format === '${fmt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(source);
}

/**
 * @param {Array<{path: string, json: object}>} manifests  parsed manifest documents
 * @param {string} readerSource                            the reader module's source text
 * @returns {Array<{manifest: string, check: string, format: string, why: string}>}
 */
export function contractViolations(manifests, readerSource) {
  const parsed = setLiteral(readerSource, 'PARSED_FORMATS');
  const pass = setLiteral(readerSource, 'PASSTHROUGH_FORMATS');
  // FAIL CLOSED. If either declaration cannot be found, every declared format is unverifiable and
  // reporting "no violations" would be the silent green this module exists to prevent — the reader
  // has been refactored out from under the check, which is exactly when it must speak.
  if (parsed === null || pass === null) {
    return [{ manifest: '-', check: '-', format: '-',
      why: 'could not find PARSED_FORMATS / PASSTHROUGH_FORMATS in the reader — the contract is unverifiable, which is not the same as satisfied' }];
  }
  const known = new Set([...parsed, ...pass]);
  const out = [];
  for (const { path, json } of manifests) {
    for (const c of (json && Array.isArray(json.checks) ? json.checks : [])) {
      const fmt = c && c.report && c.report.format;
      if (!fmt) continue;
      if (!known.has(fmt)) {
        out.push({ manifest: path, check: c.id || '?', format: fmt,
          why: `declares format '${fmt}' — no committed reader; it will fall through to the generic pass-through and score GREEN whatever the report holds` });
      } else if (parsed.has(fmt) && !hasBranch(readerSource, fmt)) {
        out.push({ manifest: path, check: c.id || '?', format: fmt,
          why: `is in PARSED_FORMATS but the committed reader has no \`format === '${fmt}'\` branch — the set entry is a declaration, not a parser` });
      }
    }
  }
  return out;
}
