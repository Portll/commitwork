// C5 — store liveness: last write per store against the freshness each consumer assumes.
//
// A CONSUMER THAT ASSUMES NOTHING IS ITSELF THE FINDING. A store whose producer died six months ago
// reads exactly like a fresh one to a consumer that never checks an mtime — the read succeeds, the
// JSON parses, the numbers are stale, and nothing anywhere says so. The absence of a freshness check
// is not a missing feature; it is the thing that converts a dead producer into confident output.
//
// Three states per store, and `absent` is not `stale`:
//   present  the file is on disk; lastWriteAt is its mtime
//   absent   ENOENT — nothing has ever written it, or it was removed. Not stale, not fresh.
//   unknown  it could not be stat'd for any other reason, or the path is composed (a bare filename
//            literal names no single location, so no mtime can answer for it)

import { join } from 'node:path';
import { SCHEMA_VERSION } from './graph.mjs';
import { mtimeOf, now } from './store.mjs';

const strip = (id) => id.replace(/^node:[a-z]+:/, '');

export function liveness(graph, { root, env = process.env } = {}) {
  const repo = root || graph.root;
  const nodes = (graph.nodes || []).filter((n) => n.kind === 'store' || n.kind === 'artifact');
  const readsBy = new Map();
  const writtenBy = new Map();
  for (const e of graph.edges || []) {
    if (e.kind === 'reads') { if (!readsBy.has(e.to)) readsBy.set(e.to, []); readsBy.get(e.to).push(e); }
    if (e.kind === 'writes') { if (!writtenBy.has(e.to)) writtenBy.set(e.to, []); writtenBy.get(e.to).push(e); }
  }

  const at = now(env);
  const stores = [];
  for (const n of nodes) {
    const consumersEdges = readsBy.get(n.id) || [];
    if (!consumersEdges.length) continue;                    // liveness is a question about readers

    let state = 'unknown';
    let lastWriteAt = null;
    if (!n.composed) {
      try {
        lastWriteAt = mtimeOf(join(repo, n.path));
        state = lastWriteAt === null ? 'absent' : 'present';
      } catch {
        state = 'unknown';                                   // permission or a broken link: not absent
      }
    }

    const consumers = consumersEdges.map((e) => ({
      module: strip(e.from),
      assumes: e.freshness ? { kind: 'checked', marker: e.freshness.marker } : null,
      fallback: e.fallback ? e.fallback.marker : null,
    }));
    const assumesNothing = consumers.filter((c) => !c.assumes);

    stores.push({
      path: n.path,
      kind: n.kind,
      composed: !!n.composed,
      state,
      lastWriteAt,
      ageMs: lastWriteAt ? Date.parse(at) - Date.parse(lastWriteAt) : null,
      writers: (writtenBy.get(n.id) || []).map((e) => strip(e.from)),
      consumers,
      findings: {
        // The headline finding of this component.
        consumersAssumingNothing: assumesNothing.map((c) => c.module),
        // Present on disk but nothing in the analysed set writes it: the producer is outside the
        // repo, or gone. Distinguished from `absent`, which is a different fact.
        noProducerInSet: (writtenBy.get(n.id) || []).length === 0,
      },
    });
  }

  stores.sort((a, b) => a.path.localeCompare(b.path));
  const withConsumers = stores.length;
  const noCheck = stores.filter((s) => s.findings.consumersAssumingNothing.length).length;
  return {
    v: SCHEMA_VERSION,
    generatedAt: at,
    stores,
    summary: {
      storesWithConsumers: withConsumers,
      present: stores.filter((s) => s.state === 'present').length,
      absent: stores.filter((s) => s.state === 'absent').length,
      unknown: stores.filter((s) => s.state === 'unknown').length,
      withConsumerAssumingNothing: noCheck,
      consumersAssumingNothing: stores.reduce((n, s) => n + s.findings.consumersAssumingNothing.length, 0),
      absentButRead: stores.filter((s) => s.state === 'absent').map((s) => s.path),
    },
  };
}

export function formatReport(l) {
  const s = l.summary;
  return [
    `flow/liveness: ${s.storesWithConsumers} read artifacts — present ${s.present}, absent ${s.absent}, unknown ${s.unknown}`,
    `  stores with >=1 consumer that checks NO freshness  ${s.withConsumerAssumingNothing}`,
    `  such consumers in total                            ${s.consumersAssumingNothing}`,
    `  read but ABSENT on disk                            ${s.absent}`,
  ].join('\n');
}
