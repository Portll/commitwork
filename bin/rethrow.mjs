// bin/rethrow.mjs — a broken file and broken code must not look the same.
// Not a policy that every catch must re-raise: use it where a swallowed error becomes a number.

/**
 * Re-raise the error classes that always mean the CODE is wrong (ReferenceError, TypeError,
 * SyntaxError); return every other error for the caller to handle as the expected failure it is.
 *
 *   try { … } catch (e) { rethrowIfBug(e); return { ok: false, reason: 'unreadable' }; }
 *
 * `json: true` opts out of SyntaxError — JSON.parse throws it for bad input, an expected failure.
 * RangeError is deliberately excluded: genuinely ambiguous, and re-raising an expected failure is
 * a new outage rather than a fix.
 */
export function rethrowIfBug(e, { json = false } = {}) {
  if (e instanceof ReferenceError) throw e;
  if (e instanceof TypeError) throw e;
  if (!json && e instanceof SyntaxError) throw e;
  return e;
}

/** rethrowIfBug for JSON readers — a SyntaxError there is corrupt input, not a bug. */
export const rethrowIfBugParsing = (e) => rethrowIfBug(e, { json: true });
