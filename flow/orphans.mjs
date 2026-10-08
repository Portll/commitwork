// C4 — orphans, in BOTH directions.
//
//   writtenNeverRead   an artifact something produces and nothing consumes. Cheap to find, cheap to
//                      fix, and the direction everybody already looks in.
//   readNeverWritten   a reader whose producer is nowhere in the analysed set. THE DANGEROUS ONE.
//                      A default makes a dead dependency look alive: the read fails, the fallback
//                      returns, the caller carries on, and nothing ever reports. The producer can
//                      have been deleted months ago.
//
// "reads X" and "reads X, falls back to Y" are DIFFERENT FINDINGS and are never merged. The second
// is the one that will not announce itself.
//
// explicit uncertainty. Three exclusions, each of which would otherwise manufacture findings:
//   · an artifact whose only edges are `touches` — direction was never determined, so neither
//     orphan direction can be claimed. It goes in `directionUnknown`, which is not a finding.
//   · a `composed` node — a bare filename literal is a NAME, not a location, and several real files
//     collapse onto it. Reported separately as low confidence.
//   · anything reached only from a module C1 could not analyse. Those modules contribute no edges,
//     so this falls out of the design rather than needing a filter.

import { SCHEMA_VERSION } from './graph.mjs';
import { isTestModule } from './static.mjs';

const strip = (id) => id.replace(/^node:[a-z]+:/, '');

export function orphans(graph) {
  const nodes = new Map((graph.nodes || []).map((n) => [n.id, n]));
  const reads = new Map();
  const writes = new Map();
  const touches = new Map();

  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };

  for (const e of graph.edges || []) {
    const target = nodes.get(e.to);
    if (!target || (target.kind !== 'artifact' && target.kind !== 'store')) continue;
    if (e.kind === 'reads') push(reads, e.to, e);
    else if (e.kind === 'writes') push(writes, e.to, e);
    else if (e.kind === 'touches') push(touches, e.to, e);
  }

  const writtenNeverRead = [];
  const readNeverWritten = [];
  const readNeverWrittenWithFallback = [];
  const directionUnknown = [];
  const lowConfidence = [];
  // A test writing a fixture into a tmpdir is not a repo artifact with a missing consumer. Bucketed
  // rather than dropped: measured, 30 of 36 written-never-read rows were test fixtures, and leaving
  // them in the headline would bury the six that are real.
  const testOnly = [];

  for (const [id, node] of nodes) {
    if (node.kind !== 'artifact' && node.kind !== 'store') continue;
    const r = reads.get(id) || [];
    const w = writes.get(id) || [];
    const t = touches.get(id) || [];

    if (t.length && !r.length && !w.length) {
      directionUnknown.push({ path: node.path, referencedBy: t.length, evidence: firstEvidence(t) });
      continue;
    }
    if (t.length) continue;                       // a determined edge plus an undetermined one: unknown

    const row = (extra) => ({ path: node.path, composed: !!node.composed, ...extra });

    const actors = [...w, ...r].map((e) => strip(e.from));
    const testFixture = actors.length > 0 && actors.every(isTestModule);

    if (w.length && !r.length) {
      const f = row({ writers: w.map((e) => strip(e.from)), evidence: firstEvidence(w) });
      const bucket = testFixture ? testOnly : (node.composed ? lowConfidence : writtenNeverRead);
      bucket.push({ ...f, direction: 'written-never-read' });
      continue;
    }
    if (r.length && !w.length) {
      const withFallback = r.filter((e) => e.fallback && e.fallback.suspected);
      const f = row({
        readers: r.map((e) => strip(e.from)),
        fallbackReaders: withFallback.map((e) => ({ module: strip(e.from), marker: e.fallback.marker })),
        evidence: firstEvidence(r),
      });
      if (testFixture) { testOnly.push({ ...f, direction: 'read-never-written' }); continue; }
      if (node.composed) { lowConfidence.push({ ...f, direction: 'read-never-written' }); continue; }
      // Split, not merged: a reader with a fallback will never tell you the producer is gone.
      if (withFallback.length) readNeverWrittenWithFallback.push({ ...f, direction: 'read-never-written-with-fallback' });
      if (withFallback.length < r.length) readNeverWritten.push({ ...f, direction: 'read-never-written' });
    }
  }

  const bySize = (a, b) => a.path.localeCompare(b.path);
  return {
    v: SCHEMA_VERSION,
    writtenNeverRead: writtenNeverRead.sort(bySize),
    readNeverWritten: readNeverWritten.sort(bySize),
    readNeverWrittenWithFallback: readNeverWrittenWithFallback.sort(bySize),
    directionUnknown: directionUnknown.sort(bySize),
    lowConfidence: lowConfidence.sort(bySize),
    testOnly: testOnly.sort(bySize),
    summary: {
      writtenNeverRead: writtenNeverRead.length,
      readNeverWritten: readNeverWritten.length,
      readNeverWrittenWithFallback: readNeverWrittenWithFallback.length,
      directionUnknown: directionUnknown.length,
      lowConfidenceComposed: lowConfidence.length,
      testFixtures: testOnly.length,
    },
  };
}

function firstEvidence(edges) {
  for (const e of edges) {
    const ev = [].concat(e.evidence || [])[0];
    if (ev) return ev;
  }
  return null;
}

export function formatReport(o) {
  const s = o.summary;
  return [
    `flow/orphans: written-never-read ${s.writtenNeverRead}  read-never-written ${s.readNeverWritten}`
    + `  (+${s.readNeverWrittenWithFallback} of those behind a fallback, reported separately)`,
    `  direction never determined (NOT a finding)  ${s.directionUnknown}`,
    `  bare-filename nodes, low confidence         ${s.lowConfidenceComposed}`,
    `  test fixtures (not repo artifacts)          ${s.testFixtures}`,
  ].join('\n');
}
