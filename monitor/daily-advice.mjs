// monitor/daily-advice.mjs — the /daily digest's read of cobolwork's advice document. For each repository
// whose cobolwork lane ran, `advise` runs over the swept revision, read from git objects; its items, in
// summary.ordered order with their remediation text, steps, fix location and compliance clauses, become
// the repository's advice list, and a digest item an entry covers loses the rule prose it carried. Where
// there is no advice, the repository says why and its items are as they were. Nothing here edits a tree.
import { rmSync } from 'node:fs';
import * as defaultBridge from '../lib/cobolwork-bridge.mjs';
import { materialise as defaultMaterialise } from '../lib/cobolwork-remediation.mjs';
import { digestIdOf, fitDigest, itemId, pathClassOf } from './daily.mjs';

export const ADVICE_LANE = 'sast-cobol-cobolwork';
const ADVICE_CATEGORY = 'sastCobol';

const cap = (s, n) => String(s ?? '').slice(0, n);
const lineOf = (n) => (Number.isInteger(n) && n > 0 ? n : null);

/** One advice item as the digest carries it; `findingIds` are the digest items it covers. */
export function adviceEntry(item, findingIds = []) {
  const r = item.remediation || {};
  const w = item.where || {};
  const f = r.fixAt;
  return {
    id: cap(item.id, 200), kind: String(item.kind), ref: cap(item.ref, 120), sev: String(item.sev), verdict: item.verdict == null ? null : cap(item.verdict, 40),
    where: { path: w.path == null ? null : cap(w.path, 300), line: lineOf(w.line), program: w.program == null ? null : cap(w.program, 60), item: w.item == null ? null : cap(w.item, 60) },
    ...(typeof item.fingerprint === 'string' ? { fingerprint: item.fingerprint } : {}),
    detail: cap(item.detail, 400),
    text: r.text == null ? null : cap(r.text, 600),
    steps: (Array.isArray(r.steps) ? r.steps : []).slice(0, 8).map((s) => cap(s, 300)),
    fixAt: f && typeof f === 'object' ? {
      path: cap(f.path, 300), line: lineOf(f.line), item: f.item == null ? null : cap(f.item, 60), test: f.test == null ? null : cap(f.test, 600),
      ...(f.why ? { why: cap(f.why, 300) } : {}),
    } : null,
    compliance: (Array.isArray(item.compliance) ? item.compliance : []).slice(0, 12)
      .map((c) => ({ framework: cap(c && c.framework, 40), clause: cap(c && c.clause, 80), ...(c && c.title ? { title: cap(c.title, 120) } : {}) })),
    findingIds,
  };
}

/**
 * A repository's advice from a bridge.advise() result: { state: 'read', ordered, ... } with the items
 * under its data paths left out as the digest leaves them, or { state: 'unavailable', reason }.
 */
export function adviceSection(result, { repo, items = [], dataPaths = [], maxEntries = 40 }) {
  if (!result || !result.ok) return { state: 'unavailable', reason: cap((result && (result.reason || result.unavailable)) || 'no advice was asked for', 600) };
  const doc = result.doc;
  const byId = new Map(doc.items.map((i) => [i.id, i]));
  const listed = new Set(items.map((i) => i.id));
  const ordered = [];
  let dataPathItems = 0;
  for (const id of doc.summary.ordered) {
    const it = byId.get(id);
    const path = it.where && typeof it.where.path === 'string' ? it.where.path.replace(/^\.\//, '') : null;
    if (path && pathClassOf(path, dataPaths) === 'data') { dataPathItems++; continue; }
    const covered = it.kind === 'finding' && path ? [itemId(repo, ADVICE_CATEGORY, String(it.ref), path)].filter((x) => listed.has(x)) : [];
    ordered.push(adviceEntry(it, covered));
  }
  const g = doc.generatedBy || {};
  return {
    state: 'read', toolVersion: cap(g.toolVersion, 40),
    unmeasured: doc.unmeasured.slice(0, 20).map((u) => cap(u, 300)),
    ordered: ordered.slice(0, maxEntries), omitted: Math.max(0, ordered.length - maxEntries), dataPathItems,
  };
}

/** The rule prose an advice entry replaces: detail.remedy goes from every item a listed entry covers. */
export function dropCoveredRemedy(repoPart) {
  const a = repoPart.advice;
  if (!a || a.state !== 'read') return repoPart;
  const covered = new Set(a.ordered.flatMap((e) => e.findingIds));
  for (const i of repoPart.items) {
    if (!covered.has(i.id) || !i.detail || i.detail.remedy === undefined) continue;
    delete i.detail.remedy;
    if (!Object.keys(i.detail).length) delete i.detail;
  }
  return repoPart;
}

/**
 * Adds `advice` to every repository of `digest` whose cobolwork lane ran, refits it to `maxBytes`, and
 * restamps its digestId. `repoPathOf(name)` is the checkout the batch anchored; CW_IRONWORK_BIN, read
 * here, is passed to advise. The capabilities are read once: without advise, no tree is read.
 */
export async function attachAdvice(digest, { repoPathOf, bridge = defaultBridge, materialise = defaultMaterialise, env = process.env, maxEntries = 40, maxBytes = Infinity, signal = null }) {
  const targets = digest.repos.filter((r) => r.lanes.some((l) => l.lane === ADVICE_LANE && l.state === 'ran'));
  if (!targets.length) return digest;
  const ironwork = env.CW_IRONWORK_BIN || null;
  const support = await bridge.adviceSupport({ env, ironwork, signal });
  for (const r of targets) {
    let result = support;
    if (support.ok) {
      let dir = null;
      try {
        dir = await materialise(repoPathOf(r.name), r.head);
        result = await bridge.advise(dir, { env, ironwork, signal });
      } catch (e) {
        result = { ok: false, reason: `the tree at ${r.head.slice(0, 12)} could not be read for advise: ${e.message}` };
      } finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
    }
    r.advice = adviceSection(result, { repo: r.name, items: r.items, dataPaths: r.dataPaths, maxEntries });
  }
  fitDigest(digest, maxBytes);
  for (const r of targets) dropCoveredRemedy(r);
  digest.digestId = digestIdOf(digest);
  return digest;
}

/** The report's advice list: per advised repository, its ordered suggestions or why there are none. */
export function adviceReport(digest) {
  return digest.repos.filter((r) => r.advice).map((r) => (r.advice.state === 'read'
    ? { repo: r.name, state: 'read', toolVersion: r.advice.toolVersion, unmeasured: r.advice.unmeasured, omitted: r.advice.omitted, dataPathItems: r.advice.dataPathItems, suggestions: r.advice.ordered }
    : { repo: r.name, state: 'unavailable', reason: r.advice.reason }));
}
