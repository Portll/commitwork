// lib/ts-type-args.mjs — erase explicit type arguments at TypeScript call sites, LENGTH-PRESERVING.
//
// WHY. Opengrep 1.33.1 and Semgrep 1.185.0 share a TypeScript front end that parses a call with
// explicit type arguments — `kv.get<number>(key)`, `db.queryObject<User>(sql)` — as the bare
// member `kv.get`. The call and every argument vanish from the AST, so no call pattern matches it
// and the taint engine never sees the argument flow. Measured 2026-11-13 on both engines: a
// tainted template reaching `db.queryObject(sql)` was reported, the identical
// `db.queryObject<User>(sql)` one line above it was not. Deno code is TypeScript-first and these
// two calls are the idiomatic Deno KV and deno-postgres forms, so the hole is not an edge case.
//
// WHAT THIS DOES. Every `<...>` that sits between a callee and its `(` (or a tagged template's
// backtick) is overwritten with spaces of the same length; newlines inside it are kept. Lines and
// columns are therefore IDENTICAL to the original, so a finding read off the erased copy points at
// the original source with no mapping step. Type arguments have no run-time semantics, so erasing
// them cannot create or destroy a data flow — it only makes the engine read the call it skipped.
//
// WHAT IT REFUSES. Anything inside a string, template, regex or comment (flow/lexer.mjs decides);
// a `<` not glued to an identifier, `)` or `]` (whitespace before it reads as a comparison); and a
// bracket body containing an operator no type can contain (&&, ||, ==, !=, +, -, *, /, %), so
// `a < b && c > (d)` stays a comparison. A file the lexer cannot classify is returned unchanged
// with ok:false — the caller counts it, it is never silently passed.

import { classify } from '../flow/lexer.mjs';

const IDENT = /[\w$\])]/;
// `;` is absent on purpose: it separates the members of an object type literal (<{ a: T; b: U }>),
// and a `;` ending a statement cannot sit between a balanced `<` and `>` (closeOf refuses it).
const NOT_A_TYPE = /&&|\|\||==|!=|[+\-*/%]|\+\+|--/;

/** Spans of non-code text as a sorted [start, end) list, or null when the lexer cannot classify. */
function nonCodeSpans(src) {
  let c;
  try { c = classify(src); } catch { return null; }
  if (!c || !c.ok) return null;
  return (c.spans || []).map((s) => [s.start, s.end]).sort((a, b) => a[0] - b[0]);
}

function inSpan(spans, i) {
  // spans are few per file; a linear scan from a moving cursor is fine for the call volumes here.
  let lo = 0; let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [s, e] = spans[mid];
    if (i < s) hi = mid - 1; else if (i >= e) lo = mid + 1; else return true;
  }
  return false;
}

/** Index of the `>` closing the `<` at `open`, or -1. Nested <> and ([{ are balanced; => is not a close. */
function closeOf(src, open, spans) {
  let angle = 0; const stack = [];
  for (let i = open; i < src.length && i < open + 400; i++) {
    if (inSpan(spans, i)) continue;
    const ch = src[i];
    if (ch === '<') angle++;
    else if (ch === '>') {
      if (src[i - 1] === '=') continue;            // => inside a function type
      angle--;
      if (angle === 0) return stack.length ? -1 : i;
    } else if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (ch === ')' || ch === ']' || ch === '}') {
      const want = ch === ')' ? '(' : ch === ']' ? '[' : '{';
      if (stack.pop() !== want) return -1;
    }
  }
  return -1;
}

/**
 * eraseCallTypeArgs(src) -> { ok, text, sites: [{line, col, length, text}] }
 * `text` is `src` with every call-position type argument list blanked; `text.length === src.length`.
 */
export function eraseCallTypeArgs(src) {
  const spans = nonCodeSpans(src);
  if (!spans) return { ok: false, text: src, sites: [] };
  const out = src.split('');
  const sites = [];
  let line = 1; let lineStart = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') { line++; lineStart = i + 1; continue; }
    if (ch !== '<' || i === 0 || !IDENT.test(src[i - 1]) || inSpan(spans, i)) continue;
    const close = closeOf(src, i, spans);
    if (close < 0) continue;
    const next = src[close + 1];
    if (next !== '(' && next !== '`') continue;
    const body = src.slice(i + 1, close);
    if (!body.trim() || NOT_A_TYPE.test(body.replace(/=>/g, ''))) continue;
    for (let k = i; k <= close; k++) if (src[k] !== '\n') out[k] = ' ';
    sites.push({ line, col: i - lineStart + 1, length: close - i + 1, text: src.slice(i, close + 1) });
    i = close;
  }
  const text = out.join('');
  return { ok: true, text, sites };
}
