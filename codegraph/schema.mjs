// Node and edge shapes for the code graph. Deliberately PARALLEL to flow/graph.mjs, not shared.
//
// flow/ answers "which artifacts does nothing read" over five node kinds and four edge kinds that
// are closed sets its own tests assert throw on anything else. A symbol graph needs different
// kinds, so widening flow's arrays would loosen a contract that exists to be tight. What IS shared
// is the part that carries no kinds: `mergeEdges` is imported rather than copied, because
// merge-by-identity is the rule this file most needs to not re-derive.
//
// The two axes are flow's, on purpose:
//   witness   — PROVENANCE. lexical | v8 | both. Which extractor saw it.
//   existence — VERDICT.    confirmed | contradicted | unknown.
// A call site whose target cannot be resolved is `unknown`, never absent and never a finding. This
// repository has published a fabricated critical from exactly that fold (CLAUDE.md, grey != red).

import { mergeEdges } from '../flow/graph.mjs';

export { mergeEdges };

export const SCHEMA_VERSION = 1;

export const NODE_KINDS = ['module', 'symbol', 'external'];
// `reexports` runs from the exported name to what it resolves to, so a binding of the first can be
// followed to the second: sym→sym (named), sym→mod (`namespace: true`), mod→mod (`star: true`).
export const EDGE_KINDS = ['imports', 'defines', 'binds', 'calls', 'reexports'];
export const WITNESSES = ['lexical', 'v8', 'both'];
export const EXISTENCE = ['confirmed', 'contradicted', 'unknown'];

// Symbol kinds W1 can tell apart. `unknown` is a kind, not a gap: a declaration the lexer located
// but could not classify is still a declaration, and dropping it would understate the surface.
// `reexport` names an export whose declaration is in another module.
export const SYMBOL_KINDS = ['function', 'class', 'method', 'const', 'reexport', 'unknown'];

/**
 * Ids EXCLUDE the line, always. CLAUDE.md records this twice from opposite directions: a
 * line-keyed identity closes a finding that merely moved, and un-suppresses one that did not.
 * A symbol that shifts down its file is the same symbol.
 */
export function moduleId(path) {
  return `mod:${path}`;
}

export function symbolId(path, name) {
  return `sym:${path}#${name}`;
}

export function externalId(spec) {
  return `ext:${spec}`;
}

export function makeNode(kind, id, extra = {}) {
  if (!NODE_KINDS.includes(kind)) throw new Error(`unknown node kind ${kind}`);
  return { v: SCHEMA_VERSION, id, kind, ...extra };
}

export function makeEdge(from, to, kind, opts = {}) {
  if (!EDGE_KINDS.includes(kind)) throw new Error(`unknown edge kind ${kind}`);
  const { witness = 'lexical', existence = 'unknown', evidence = null, ...rest } = opts;
  if (!WITNESSES.includes(witness)) throw new Error(`unknown witness ${witness}`);
  if (!EXISTENCE.includes(existence)) throw new Error(`unknown existence ${existence}`);
  return { v: SCHEMA_VERSION, from, to, kind, witness, existence, evidence, ...rest };
}
