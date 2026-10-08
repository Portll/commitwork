// cra/dataflow-evidence.mjs — CodeQL's source→sink paths as reachability evidence for OUR OWN code.
//
// THE SECOND INSTANCE of the class filed as 1.3 in cw-taxonomy-gaps-20260823: evidence present,
// intact, and discarded at the parse boundary by a reader that had no use for it. The first was
// govulncheck's alias records. This is the same shape in a different subsystem — 634 of 654 results
// in a single codeql.sarif carry a full `codeFlows` path, and the extractor takes the finding and
// drops the path. 1,507 such SARIFs exist in reports/.
//
// WHY IT IS REACHABILITY AND NOT SOMETHING WEAKER. A CodeQL taint query only emits a result when it
// has traced data from a source the query DEFINES as untrusted to a sink it defines as dangerous.
// The codeFlow is that trace. So a result carrying one is a proof that the vulnerable code is
// reachable from an untrusted input — which is precisely the question 25,770 sastSemgrep + sastGo
// findings are currently marked `reachability_unknown` for.
//
// WHAT ABSENCE MEANS, AND WHAT IT DOES NOT. 16 of 654 results carry no codeFlows, and they are not
// a residue — they are a different KIND of query. Measured: every one is syntactic
// (js/incomplete-sanitization, js/bad-tag-filter, js/incomplete-multi-character-sanitization) while
// every dataflow query (js/xss-through-dom, js/reflected-xss, js/request-forgery,
// js/shell-command-injection-from-environment) carries one. So a missing path means THE QUERY NEVER
// LOOKED, which is `reachability_unknown` — never `unreachable`, and never even `unproven`, because
// unlike govulncheck nothing here searched and failed to find. Publishing the stronger word would
// be the dep-scan in_triage defect wearing a new hat.
//
// Method is `dataflow`, NOT `call_graph`: a call graph proves a function is invoked, a taint path
// proves attacker-controlled data arrives at a sink. Different proofs, different strength, and
// collapsing them would let a SAST path stand in for a reachability analysis it did not perform.
//
// Zero deps. Reads reports/ directly — nothing here touches monitor/extractors.mjs.

import { readdirSync, existsSync } from 'node:fs';
// THE one SARIF reader (monitor/one-sarif-reader.test.mjs enforces it). Its typed record is also
// strictly better than a bare parse here: my first version did `try { JSON.parse } catch { continue }`,
// which silently skips an unreadable artifact — the defaulted-empty defect that guard exists to stop.
import { readSarif } from '../monitor/sarif-read.mjs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const reportsDir = () => process.env.CW_REPORTS_DIR || join(CW, 'reports');

/** Identity: repo|rule|file. NEVER the line — code moves for reasons unrelated to the finding. */
export const dataflowKey = (repo, rule, file) => `${repo}|${rule || ''}|${file || ''}`;

const uriOf = (loc) => loc?.location?.physicalLocation?.artifactLocation?.uri || null;
const lineOf = (loc) => loc?.location?.physicalLocation?.region?.startLine ?? null;
const msgOf = (loc) => loc?.location?.message?.text || null;

/**
 * The source and sink of a result's first threadFlow, plus its length.
 * Returns null when the result carries no path at all.
 */
export function pathOf(result) {
  const tf = result?.codeFlows?.[0]?.threadFlows?.[0];
  const locs = tf?.locations;
  if (!Array.isArray(locs) || !locs.length) return null;
  const first = locs[0];
  const last = locs[locs.length - 1];
  return {
    steps: locs.length,
    flows: result.codeFlows.length,
    source: { file: uriOf(first), line: lineOf(first), expr: msgOf(first) },
    sink: { file: uriOf(last), line: lineOf(last), expr: msgOf(last) },
  };
}

/**
 * One SARIF result → a reachability determination + the evidence behind it.
 * `repo` is supplied by the caller from the artifact's own directory; a result is never attributed
 * to a guess.
 */
export function dataflowFromResult(result, repo, atIso) {
  const rule = result?.ruleId || null;
  const file = result?.locations?.[0]?.physicalLocation?.artifactLocation?.uri || null;
  if (!rule) return null;
  const path = pathOf(result);
  if (path) {
    return {
      repo, rule, file,
      reachability: 'reachable',
      path,
      evidence: {
        source: 'codeql', method: 'dataflow', confidence: 'high', at: atIso,
        detail: `CodeQL traced ${path.steps} steps from ${path.source.expr || 'a source'} (${path.source.file}:${path.source.line}) to ${path.sink.expr || 'a sink'} (${path.sink.file}:${path.sink.line})`,
      },
    };
  }
  return {
    repo, rule, file,
    // The query is syntactic and never looked for a path. Not unproven — nothing searched.
    reachability: 'reachability_unknown',
    path: null,
    evidence: [],
    why: `CodeQL rule ${rule} is not a dataflow query; it emits no path, so this result says nothing either way about reachability`,
  };
}

// reports/<sweep>/<repo>/codeql*.sarif — the repo is the artifact's own parent directory.
const repoOfPath = (p) => basename(dirname(p));

/**
 * Walk reports/ and index every CodeQL dataflow path.
 * Returns {index, stats}. A `reachable` row always beats an unknown for the same key: one query
 * proving a path is not cancelled by a second query that does not look for one.
 */
export function buildDataflowIndex({ dir = reportsDir(), maxDepth = 6, atIso = new Date().toISOString() } = {}) {
  const index = new Map();
  const stats = { artifacts: 0, results: 0, withPath: 0, syntacticOnly: 0, byState: {}, repos: new Set(), rules: new Set() };

  const put = (row) => {
    if (!row) return;
    const key = dataflowKey(row.repo, row.rule, row.file);
    const prev = index.get(key);
    if (prev && prev.reachability === 'reachable' && row.reachability !== 'reachable') return;
    index.set(key, row);
  };

  const walk = (d, depth) => {
    if (depth > maxDepth) return;
    let entries; try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (!/^codeql.*\.sarif$/.test(e.name)) continue;
      stats.artifacts++;
      const rec = readSarif(p);
      stats.byState[rec.state] = (stats.byState[rec.state] || 0) + 1;
      // Only 'ok' carries runs; every other state carries null deliberately. An artifact we could
      // not read is COUNTED, never skipped into silence — otherwise a fleet of unreadable SARIFs
      // and a fleet with no paths produce the same empty index.
      if (rec.state !== 'ok') continue;
      const repo = repoOfPath(p);
      stats.repos.add(repo);
      // The reader's own flattened results. NOT `rec.runs || []` / `run.results || []` — it returns
      // null for every non-ok state deliberately, and re-defaulting to [] converts a void back into
      // a clean zero. monitor/test/one-sarif-reader.test.mjs catches exactly that, and caught this.
      for (const result of rec.results) {
        stats.results++;
        const row = dataflowFromResult(result, repo, atIso);
        if (!row) continue;
        if (row.reachability === 'reachable') stats.withPath++; else stats.syntacticOnly++;
        stats.rules.add(row.rule);
        put(row);
      }
    }
  };
  if (existsSync(dir)) walk(dir, 0);

  return {
    index,
    stats: { ...stats, repos: stats.repos.size, rules: stats.rules.size, indexed: index.size },
  };
}

/**
 * The dataflow determination for one SAST finding.
 * A finding with no CodeQL row is `reachability_unknown` with NO evidence — CodeQL may not run on
 * that repo, or may carry no query for that rule. Absence is its own state, never a clean one.
 */
export function dataflowFor(index, repo, rule, file) {
  const hit = index.get(dataflowKey(repo, rule, file));
  if (hit && hit.reachability === 'reachable') {
    return { reachability: 'reachable', evidence: [hit.evidence], path: hit.path };
  }
  if (hit) return { reachability: 'reachability_unknown', evidence: [], why: hit.why };
  return {
    reachability: 'reachability_unknown',
    evidence: [],
    why: 'no CodeQL result for this repo/rule/file — the query may not cover this rule, or CodeQL may not have run here',
  };
}
