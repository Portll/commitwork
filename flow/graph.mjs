// FlowNode / FlowEdge per docs/SPEC-harness-chain.md §1.4.
//
// Two axes, deliberately separate:
//   witness   — PROVENANCE. static | runtime | both. Which pass saw it.
//   existence — VERDICT.    confirmed | contradicted | unknown. What that means.
// Folded into one field, "the runtime never entered this module" becomes indistinguishable from
// "the runtime entered it and the edge was not there". Only the second is a finding.
//
// Edge identity is from|to|kind and EXCLUDES line. `evidence` carries "<file>:<line> <how>" as
// evidence only — a literal that moves down a file is the same edge, not a new one.

export const SCHEMA_VERSION = 1;

// endpoint  — `<scheme>://<host>[:<port>]` (outbound) or `listen:<port|unknown>` (a server)
// database  — the database path literal (`:memory:` allowed)
// scheduler — `launchd:<label>` | `workflow:<file>#schedule` | `cron:<file>` | `timer:<module>` | `watch:<module>`
export const NODE_KINDS = ['module', 'artifact', 'store', 'env', 'process', 'endpoint', 'database', 'scheduler'];
// connects: module -> endpoint · listens: module -> endpoint · triggers: scheduler -> module
export const EDGE_KINDS = ['reads', 'writes', 'spawns', 'touches', 'connects', 'listens', 'triggers'];
export const WITNESSES = ['static', 'runtime', 'both'];
export const EXISTENCE = ['confirmed', 'contradicted', 'unknown'];

export function nodeId(kind, key) {
  if (!NODE_KINDS.includes(kind)) throw new Error(`unknown node kind ${kind}`);
  return `node:${kind}:${key}`;
}

export function makeNode(kind, key, extra = {}) {
  return { v: SCHEMA_VERSION, id: nodeId(kind, key), kind, path: key, lastWriteAt: null, ...extra };
}

// JSON, not a separator character. The house composite-key idiom is a NUL byte, and docs/TRAPS.md
// records what that costs: 11 sources carry a raw one and grep/rg answer "not found" on them rather
// than admit they declined to look. Writing it as an escape did not survive authoring this file —
// the escape became a raw NUL, which is presumably how those 11 got theirs. JSON cannot be mangled
// and cannot collide: a path containing the separator is not representable.
export function edgeKey(from, to, kind) {
  return JSON.stringify([from, to, kind]);
}

export function makeEdge(from, to, kind, opts = {}) {
  if (!EDGE_KINDS.includes(kind)) throw new Error(`unknown edge kind ${kind}`);
  const { witness = 'static', existence = 'unknown', evidence = null, ...rest } = opts;
  if (!WITNESSES.includes(witness)) throw new Error(`unknown witness ${witness}`);
  if (!EXISTENCE.includes(existence)) throw new Error(`unknown existence ${existence}`);
  return { v: SCHEMA_VERSION, from, to, kind, witness, existence, evidence, ...rest };
}

// Fields that describe the edge as a whole and so must survive a merge from ANY witness, not only the
// first: a module that appends to a store at one site and truncates it at another still appends.
const UNION_FIELDS = ['tables', 'scripts'];
const ANY_FIELDS = ['append', 'tail'];

/** Merge by identity. Evidence accumulates; nothing is replaced. */
export function mergeEdges(edges) {
  const by = new Map();
  for (const e of edges) {
    const k = edgeKey(e.from, e.to, e.kind);
    const prev = by.get(k);
    if (!prev) {
      const first = { ...e, evidence: e.evidence ? [].concat(e.evidence) : [] };
      for (const f of UNION_FIELDS) if (Array.isArray(first[f])) first[f] = [...new Set(first[f])].sort();
      by.set(k, first);
      continue;
    }
    for (const ev of [].concat(e.evidence || [])) if (!prev.evidence.includes(ev)) prev.evidence.push(ev);
    for (const f of UNION_FIELDS) {
      if (Array.isArray(e[f])) prev[f] = [...new Set([...(prev[f] || []), ...e[f]])].sort();
    }
    for (const f of ANY_FIELDS) if (e[f] === true) prev[f] = true;
  }
  return [...by.values()].sort((a, b) => edgeKey(a.from, a.to, a.kind).localeCompare(edgeKey(b.from, b.to, b.kind)));
}

/**
 * `store` vs `artifact`, decided BEFORE ids are minted.
 *
 * A store is an artifact with both a writer and a reader — persisted state rather than an output.
 * Deciding it after minting would leave edges pointing at ids no node carries: a broken graph that
 * still serialises cleanly.
 */
export function artifactKinds(paths, rawEdges) {
  const written = new Set(rawEdges.filter((e) => e.kind === 'writes').map((e) => e.target));
  const read = new Set(rawEdges.filter((e) => e.kind === 'reads').map((e) => e.target));
  const out = new Map();
  for (const p of paths) out.set(p, written.has(p) && read.has(p) ? 'store' : 'artifact');
  return out;
}
