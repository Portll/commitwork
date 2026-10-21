/**
 * Derive a remediation TARGET from a vulnerable version range: the range's upper bound is the
 * patched floor ('<X' → X, '<=X' → >X); anything OR-ed or hyphenated stays '' rather than guess
 * an over-upgrade. Display-only — `fixed` is not part of any finding's identity. Its own file so
 * tests can import it without running rollup.mjs's module-scope pipeline; rollup.mjs re-exports it.
 */
export function fixFromRange(range) {
  if (typeof range !== 'string') return '';
  const bounds = [...range.matchAll(/<(=?)\s*v?([0-9][\w.\-+]*)/g)];
  if (bounds.length !== 1) return '';
  const [, eq, ver] = bounds[0];
  return eq ? `>${ver}` : ver;
}

/**
 * The remediation line for a dependency finding, given whatever `fixed` the extractors could name.
 *
 * `'available'` is the fallback fixFromRange leaves when a vulnerable range names no single upper
 * bound: it says a fix exists without inventing a version. Interpolated into
 * `fix available: ${fixed}` it would read `fix available: available`, so this words the sentence
 * for that value and leaves the value alone.
 */
export function remediationForFix(fixed) {
  if (!fixed) return null;
  if (fixed === 'available') return 'a fix is available; the advisory does not name the fixed version';
  return `fix available: ${fixed}`;
}
