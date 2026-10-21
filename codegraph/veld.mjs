// Tier C — semantic search over the graph, delegated to veld rather than reimplemented.
//
// CodeGraph's semantic half is an ONNX embedding model, an HNSW index and a RocksDB store. None of
// that can live in a repository with zero runtime dependencies, and none of it needs to: veld
// already holds embeddings, hybrid retrieval and a persistent store behind an HTTP API this repo
// has a contract-bound client for (lib/memory-layer-client.mjs, lib/memory-layer-contract.json).
//
// WHAT IS SENT, AND WHY IT IS NOT THE CODE. veld summarises a long record to its first ~50 words
// and discards the rest — measured, and recorded in lib/memory-layer-pointer.mjs, which exists
// because of it. So a record here is a LOCATOR: enough to find the symbol and nothing else. The
// graph stays the source of truth on this disk; veld ranks, and every answer is resolved back
// against codegraph.json before it is returned. A ranking service that goes down costs ranking, not
// the answer — `search()` degrades to a substring scan of the local graph and SAYS which one it did.
//
// WRITING IS OPT-IN. Publishing sends this repository's structure to a service, so `publish()` is a
// dry run unless `apply: true`. The house rule is the general one: describing is not applying.

import { upsert, recallSemantic, tally, storedText } from '../lib/memory-layer-client.mjs';
import { index } from './query.mjs';

export const SCOPE = 'commitwork-codegraph';
export const RECORD_PREFIX = 'codegraph:';

/** Word budget the layer summarises to. Mirrors lib/memory-layer-pointer.mjs's measured value. */
export const SUMMARY_WORD_BUDGET = 50;

/**
 * external_id — the identity. EXCLUDES the line, like every other identity in this repository: a
 * symbol that moves down its file is the same symbol, and an id that moved would publish a delete
 * and an insert for an edit that changed nothing.
 */
export function externalIdFor(repo, path, name) {
  return `${RECORD_PREFIX}${repo}:${path}#${name}`;
}

/**
 * One record per symbol. The locator is first and inside the budget; everything after it is
 * elaboration a reader can live without, exactly as the pointer contract requires.
 */
export function recordFor(graph, node, ix, { repo, commit = null }) {
  const importers = new Set((ix.importsIn.get(`mod:${node.path}`) || []).map((e) => e.from));
  const callers = (ix.callsIn.get(node.id) || []).length;
  const binds = (ix.bindsTo.get(node.id) || []).length;
  const mod = ix.byId.get(`mod:${node.path}`);

  // The id is IN the text, in brackets, one token in. Not decoration: `/api/recall` — the semantic
  // endpoint — returns neither `external_id` nor `tags`, so the only identity a hit carries is
  // whatever the content itself says. Recovering it by parsing the prose was tried first and broke
  // on the `.` in `github.com`, silently attributing five real hits to a repo called
  // `https://github`. A self-identifying record cannot be misparsed that way.
  const head = `SYMBOL ${node.name} [${externalIdFor(repo, node.path, node.name)}] — `
    + `a ${node.symbolKind} in ${node.path}${commit ? ` at commit ${commit.slice(0, 7)}` : ''}. `
    + `${node.exported ? 'Exported' : 'Internal'}, ${binds} importer(s) bind it, ${callers} call site(s). `
    + `LOCATOR not content: read ${node.path}; node codegraph/report.mjs about ${node.path}`;

  // The body carries NO sibling export list, and that is a correction rather than an omission.
  // It used to name every export of the module, which meant all 35 records for admin/auth.mjs
  // shared ~90% of their text — so retrieval ranked by module and returned four near-identical
  // neighbours instead of four symbols. Counts carry the same fact without swamping the one signal
  // that distinguishes these records from each other, which is the symbol's own name.
  const body = [
    head,
    '',
    `Module ${node.path} defines ${(mod?.exports || []).length} exported symbol(s) and is imported by ${importers.size} module(s).`,
    `Symbol witness: ${node.witness} (lexical = W1 alone; both = V8 confirmed it as an export).`,
    '',
    'This record holds no source. veld summarises long records to their first 50 words, so the',
    'locator above is the whole payload by design; the graph on disk is the source of truth.',
  ].join('\n');

  return {
    external_id: externalIdFor(repo, node.path, node.name),
    content: body,
    memory_type: 'Context',
    tags: ['codegraph', `codegraph-path:${node.path}`, `codegraph-kind:${node.symbolKind}`],
    // Reported, not asserted: whether the locator actually survives the summariser.
    survives: head.split(/\s+/).filter(Boolean).length <= SUMMARY_WORD_BUDGET,
  };
}

/** Every record the graph would publish. Pure — no network, so it is testable without one. */
export function records(graph, { repo, commit = null, only = 'exported' } = {}) {
  if (!repo) throw new Error('records: a repo identifier is required — a locator without one locates nothing');
  const ix = index(graph);
  return graph.nodes
    .filter((n) => n.kind === 'symbol' && (only === 'all' || n.exported))
    .map((n) => recordFor(graph, n, ix, { repo, commit }))
    .sort((a, b) => a.external_id.localeCompare(b.external_id));
}

/**
 * Publish the locators. DRY BY DEFAULT — `apply: true` is the only thing that sends anything.
 *
 * Receipts are returned unaggregated as well as tallied, because `tally()`'s three states
 * (verified / accepted-unverified / failed) are the ones that matter and a count alone hides which
 * records are in the middle state.
 */
export async function publish(graph, {
  repo, commit = null, only = 'exported', apply = false, limit = Infinity, env = process.env, fetchImpl = fetch,
} = {}) {
  const all = records(graph, { repo, commit, only });
  const planned = all.slice(0, limit === Infinity ? undefined : limit);
  const notSurviving = planned.filter((r) => !r.survives).map((r) => r.external_id);

  if (!apply) {
    return {
      applied: false,
      planned: planned.length,
      total: all.length,
      notSurviving,
      sample: planned.slice(0, 3),
      receipts: null,                 // null, not [] — nothing was observed because nothing was sent
    };
  }

  const receipts = [];
  for (const r of planned) {
    // eslint-disable-next-line no-await-in-loop -- ordered writes; veld is a local single service
    receipts.push(await upsert({ external_id: r.external_id, content: r.content, memory_type: r.memory_type, tags: r.tags },
      { scope: SCOPE, env, fetchImpl }));
  }
  return { applied: true, planned: planned.length, total: all.length, notSurviving, receipts, tally: tally(receipts) };
}

/**
 * Search the graph by meaning. -> { via, hits, reason }
 *
 * `via` is 'veld' or 'local', and it is a field rather than a log line because the two are different
 * answers: veld ranks by meaning over everything it holds, and the local fallback is a substring
 * scan that will miss any phrasing that does not appear in a symbol's name. Presenting the second as
 * the first would be the whole grey-as-green failure in miniature.
 *
 * Every hit is resolved back against the LOCAL graph. A veld record naming a symbol the graph no
 * longer has is reported as `stale: true`, never rendered as a live location.
 */
export async function search(graph, query, { repo, limit = 10, env = process.env, fetchImpl = fetch } = {}) {
  const byId = new Map(graph.nodes.filter((n) => n.kind === 'symbol').map((n) => [externalIdFor(repo, n.path, n.name), n]));
  // `semantic`, NOT veld's default `hybrid`. Measured 2026-09-04 over the full 2,615-record index:
  // hybrid returned FOUR DIFFERENT result sets for four identical queries — 0 of 5 names common
  // across the runs — while semantic returned the same five every time. Same inputs, same outputs
  // is a house invariant, and a search that answers differently each time cannot be checked by
  // anybody, including the person deciding whether it works.
  //
  // The timeout default is raised for the same measurement: at 2,615 records the 5s default aborted
  // mid-query and fell through to the substring scan. An env var the caller set still wins.
  const res = await recallSemantic(query, {
    limit: limit * 4,
    mode: 'semantic',
    env: { VELD_TIMEOUT_MS: '30000', ...env },
    fetchImpl,
  });

  if (!res.ok) {
    const needle = query.toLowerCase();
    const hits = graph.nodes
      .filter((n) => n.kind === 'symbol' && (n.name.toLowerCase().includes(needle) || n.path.toLowerCase().includes(needle)))
      .slice(0, limit)
      .map((n, i) => ({ rank: i + 1, veldScore: null, id: n.id, path: n.path, name: n.name, symbolKind: n.symbolKind, exported: n.exported, stale: false }));
    return {
      via: 'local',
      reason: `veld unavailable (${res.reason}); this is a substring scan, not a semantic one`,
      scoreNote: 'no ranking at all — these are substring matches in file order',
      hits,
    };
  }

  const hits = [];
  for (const m of res.memories) {
    const external = externalIdOf(m);
    if (!external) continue;                       // another writer's memory; recall ignores tag filters
    const node = byId.get(external);
    // `rank`, not `similarity`. See RANK_NOTE — the number veld returns is a position, and calling
    // a position a similarity is a claim about match quality that nothing measured.
    const row = { rank: hits.length + 1, veldScore: m.score ?? m.similarity ?? null };
    hits.push(node
      ? { ...row, id: node.id, path: node.path, name: node.name, symbolKind: node.symbolKind, exported: node.exported, stale: false }
      : { ...row, id: null, path: null, name: null, symbolKind: null, exported: null, stale: true, external });
    if (hits.length >= limit) break;
  }
  return { via: 'veld', reason: null, scoreNote: RANK_NOTE, hits };
}

/**
 * What veld's `score` is, stated wherever it is returned.
 *
 * Measured 2026-09-04 against 0.7.39+229 over 1,143 indexed records: `zebra quantum umbrella
 * nonsense` and `render an html table` came back with BYTE-IDENTICAL score sequences —
 * 0.9496, 0.8329, 0.7163, 0.5996, 0.4829, 0.3663. It is a linear decay from rank 1, carrying no
 * information about how well anything matched. A nonsense query scores 0.9496 at the top exactly
 * like a good one.
 *
 * The ORDER is meaningful — `redact a secret before sending it` ranks `redactSnippet` first — so
 * the ordering is reported and the number is not dressed up as a confidence.
 */
export const RANK_NOTE =
  'ordering is veld\'s; `veldScore` is a rank-position decay, NOT a similarity — a nonsense query '
  + 'scores the same at rank 1 as a good one. Use `rank`, and judge relevance by reading the hits.';

/**
 * Which record a recalled memory is — and the three shapes are not interchangeable.
 *
 * Measured 2026-09-04 against veld 0.7.39+229: `/api/recall/tags` returns rows carrying
 * `external_id`, and `/api/recall` — the semantic one — does NOT. It returns
 * `{ id, experience, score, … }` with no `external_id`, no `tags`, and no `content` field at all;
 * the text lives under `experience`, which is what `storedText()` exists to unwrap. Reading
 * `m.content` there yields undefined, every hit is dropped, and the search returns cleanly with
 * zero results — a working query indistinguishable from a broken one. Which is why this is a named
 * function with the shapes written down rather than an inline `||` chain.
 */
function externalIdOf(m) {
  if (typeof m.external_id === 'string' && m.external_id.startsWith(RECORD_PREFIX)) return m.external_id;
  const tagged = (m.tags || []).find((t) => String(t).startsWith(RECORD_PREFIX));
  if (tagged) return tagged;
  return idFromContent(storedText(m).text ?? m.content);
}

/** The id the record carries about itself. A bracketed token cannot be mis-delimited by a URL. */
function idFromContent(content) {
  const m = new RegExp(`\\[(${RECORD_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\]]+)\\]`).exec(String(content || ''));
  return m ? m[1] : null;
}
