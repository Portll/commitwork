// Salvage a JSON object out of free text — the reasoning channel of a local model that routed its
// whole answer into `thinking` — WITHOUT keying on property order.
//
// Registry class G3 (recovery keyed on a serialisation accident): three call sites recovered the
// verdict with `thinking.lastIndexOf('{"verdict"')`, which works only because the schema's
// `required` list happens to emit `verdict` first. Reorder one property and every LM Studio triage
// silently returns "no verdict could be salvaged" — indistinguishable from a model that produced
// nothing. This module finds the LAST balanced object in the text that carries the required key,
// wherever the key sits inside it, and returns the outermost such object so a nested
// `findings[0]` never masquerades as the verdict.
//
// It is deliberately a scanner, not a JSON.parse-from-every-brace loop: the text is prose with
// braces in it (schemas quoted back, code, Mustache), and the balanced walk honours strings and
// escapes so a `}` inside a quoted value does not end the object early.

/** Index of the `}` that closes the object opening at `start`, or -1 if unbalanced. */
function closeOf(text, start) {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * @param {string} text
 * @param {string} requiredKey  a property the salvaged object must carry at its top level
 * @returns {{ value: object, start: number, end: number } | null}
 */
export function salvageObject(text, requiredKey) {
  const s = String(text || '');
  if (!s || !requiredKey) return null;
  let best = null;
  // Right to left, so the model's FINAL answer wins over an example it quoted earlier — the same
  // preference lastIndexOf expressed — and then keep walking left while an enclosing object also
  // qualifies, so the outermost verdict is returned rather than a nested member that shares the key.
  // `lastIndexOf(x, -1)` clamps the negative fromIndex to 0 and finds a `{` at position 0 again —
  // an infinite loop on any text that STARTS with a brace, measured on the first run of this
  // module's own test. The loop ends explicitly at index 0.
  for (let i = s.lastIndexOf('{'); i >= 0; i = i === 0 ? -1 : s.lastIndexOf('{', i - 1)) {
    const end = closeOf(s, i);
    if (end < 0) continue;
    if (best && !(i < best.start && end > best.end)) {
      // Not an enclosure of the current best. Anything further left cannot enclose it either
      // unless it also starts left of best — which it does — so keep scanning only enclosures.
      continue;
    }
    let value;
    try { value = JSON.parse(s.slice(i, end + 1)); } catch { continue; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (!Object.prototype.hasOwnProperty.call(value, requiredKey)) continue;
    best = { value, start: i, end };
  }
  return best;
}

/**
 * Back-compat for callers that passed an ANCHOR like `'{"verdict"'`: the key is what mattered.
 * Returns the key, or the input unchanged when it already is one.
 */
export const keyFromAnchor = (anchorOrKey) => {
  const m = /^\{\s*"([^"]+)"/.exec(String(anchorOrKey || ''));
  return m ? m[1] : String(anchorOrKey || '');
};
