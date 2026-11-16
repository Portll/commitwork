// codegraph/function-at.mjs — which function a line of a source file sits in.
//
// Read off codegraph/lexical.mjs's own extraction (W1), so it sees what the symbol graph sees: a
// top-level function, a class and its methods, and a top-level binding whose value is a function
// with a block body. A function nested inside another is not a symbol there, so a line inside one
// resolves to the top-level function that contains it. Nothing here reads a file or the store: the
// caller hands over the source text.

import { extract } from './lexical.mjs';

/**
 * -> { ok, reason, functions }. `functions` are the symbols that have a body, each
 * { name, kind, line, endLine } with 1-based lines, in source order. `ok:false` is UNKNOWN: the
 * lexer could not read the file, so no line of it can be placed and the caller must say so.
 */
export function functionsOf(src) {
  const text = String(src);
  const got = extract(text);
  if (!got.ok) return { ok: false, reason: got.reason, functions: [] };
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  const lineOf = (off) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const functions = got.symbols
    .filter((s) => Array.isArray(s.body))
    .map((s) => ({ name: s.name, kind: s.kind, line: s.line, endLine: lineOf(s.body[1]) }))
    .sort((a, b) => a.line - b.line || b.endLine - a.endLine);
  return { ok: true, reason: null, functions };
}

/** The innermost of `functions` whose lines hold `line` (a method inside its class), or null for module level. */
export function functionAt(functions, line) {
  let best = null;
  for (const f of functions) {
    if (line < f.line || line > f.endLine) continue;
    if (!best || f.line > best.line || (f.line === best.line && f.endLine < best.endLine)) best = f;
  }
  return best;
}
