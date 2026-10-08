// bin/session-id.mjs — one place that knows how session ids are compared and shown.
//
// Store full ids — truncation is a display concern (shortId). Comparison is width-agnostic
// (prefix either way) so mixed-width historical records still join.

/** Display form: `07002350-f86…`. Never store this — it is lossy by design. */
export const shortId = (id, width = 13) => {
  if (!id) return '?';
  const s = String(id);
  return s.length > width ? `${s.slice(0, width)}…` : s;
};

/** Same session at whatever widths recorded — prefix matches either way; empty never matches. */
export const sameSession = (a, b) => {
  if (!a || !b) return false;
  const x = String(a);
  const y = String(b);
  return x === y || x.startsWith(y) || y.startsWith(x);
};
