// cra/dataflow-evidence.mjs — taint engines' source→sink paths as reachability evidence for OUR OWN code.
//
// A taint result in SARIF carries its path in `codeFlows`. The SARIF extractor keeps the finding and
// drops the path; this module reads the path back as evidence. Three engines write paths into SARIF
// that the fleet runs: CodeQL (every language lane), Psalm (--taint-analysis), and Semgrep/Opengrep
// when a run exports its traces. Which engine said so is part of the evidence, never collapsed.
//
// WHY IT IS REACHABILITY AND NOT SOMETHING WEAKER. A taint query only emits a result when it has
// traced data from a source the query DEFINES as untrusted to a sink it defines as dangerous. The
// codeFlow is that trace. So a result carrying one is a proof that the vulnerable code is reachable
// from an untrusted input — which is precisely the question sastGo findings leave as
// `reachability_unknown`.
//
// WHAT ABSENCE MEANS, AND WHAT IT DOES NOT. A CodeQL result without codeFlows comes from a different
// KIND of query. In the CodeQL JS results measured, every result without codeFlows came from a
// syntactic rule (js/incomplete-sanitization, js/bad-tag-filter,
// js/incomplete-multi-character-sanitization) while every dataflow query (js/xss-through-dom,
// js/reflected-xss, js/request-forgery, js/shell-command-injection-from-environment) carried one.
// So a missing path means THE QUERY NEVER LOOKED, which is `reachability_unknown` — never
// `unreachable`, and never even `unproven`, because unlike govulncheck nothing here searched and
// failed to find. Publishing the stronger word would claim a search that never ran.
// For Semgrep a missing path is weaker still: as of semgrep 1.182.0 OSS (measured 2026-11-18),
// --dataflow-traces writes no codeFlows to SARIF and no dataflow_trace to JSON in any output mode,
// for a taint rule that matched. So there a result without a path may be a taint match whose trace
// was not exported, and the `why` says exactly that — unless the rule's own definition was read
// (cra/semgrep-rule-modes.mjs), in which case the row carries `ruleMode` and the `why` says which.
//
// EVERY ROUTE, NOT THE FIRST. A result can carry several codeFlows: CodeQL emits one per
// source→sink route it found. Measured on a real sweep (one repository, 2026-10-21): 3 results carried 9 code
// flows making 6 distinct routes, and reading `codeFlows[0]` kept 3. Two results of one rule in one
// file (two sinks) share a finding identity, and they are merged rather than the later one
// replacing the earlier. A route's identity is `routeKey` — source and sink by file and expression,
// never by line — the same identity flow/dfd-rescan.mjs keys a rescan on.
//
// A SECOND WITNESS, BESIDE THE DETERMINATION. corroborationFor asks whether an engine of another
// family reported at the same site (repo, file, line) in the same sweep. It never changes a
// determination: another engine's route ending at a Semgrep finding's line is a witness, not that
// finding's own path. Measured on the one fleet sweep holding two families (one repository, 2026-10-21):
// CodeQL's 7 results and Semgrep's 90 shared no site and no file, so agreement starts at zero there,
// and that is the measurement, not a defect of the join.
//
// Method is `dataflow`, NOT `call_graph`: a call graph proves a function is invoked, a taint path
// proves attacker-controlled data arrives at a sink. Different proofs, different strength, and
// collapsing them would let a SAST path stand in for a reachability analysis it did not perform.
//
// Zero deps. Reads reports/ directly — nothing here touches monitor/extractors.mjs.

import { readdirSync } from 'node:fs';
// THE one SARIF reader (monitor/one-sarif-reader.test.mjs enforces it). Its typed record is also
// strictly better than a bare parse here: `try { JSON.parse } catch { continue }` would silently
// skip an unreadable artifact — the defaulted-empty defect that guard exists to stop.
import { readSarif } from '../monitor/sarif-read.mjs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateBaseFor } from '../monitor/store-paths.mjs';
import { readRuleModes, readLocalModes, modeFor } from './semgrep-rule-modes.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const reportsDir = () => process.env.CW_REPORTS_DIR || join(stateBaseFor(CW), 'reports');

/**
 * The artifacts this reads, and the engine each comes from when its driver does not say. Only lane
 * artifacts: semgrep-oss.sarif (the Pro-delta control) and the CodeQL frontier output
 * (codeql-frontier-<lang>.sarif, cra/taint-frontier.mjs) are not findings and are not read here.
 */
export const DATAFLOW_SOURCES = Object.freeze([
  Object.freeze({ artifact: /^codeql(-[a-z]+)?\.sarif$/, engine: 'codeql' }),
  Object.freeze({ artifact: /^psalm\.sarif$/, engine: 'psalm' }),
  Object.freeze({ artifact: /^semgrep(-auto)?\.sarif$/, engine: 'semgrep' }),
]);

/**
 * The rollup lanes whose rows come from those artifacts — the findings this evidence can speak to.
 * cra/test/dataflow-evidence.test.mjs reads monitor/extractors.mjs's lane table and holds this set
 * to it in both directions, so a new CodeQL lane cannot arrive without its evidence.
 */
export const DATAFLOW_LANES = Object.freeze(new Set([
  'sastCodeql', 'sastCodeqlJava', 'sastCodeqlPython', 'sastCodeqlRuby', 'sastCodeqlCpp',
  'sastCodeqlSwift', 'sastCodeqlCsharp', 'sastCodeqlRust', 'sastCodeqlGo',
  'sastPhpPsalm', 'sastSemgrep', 'sastAuto',
]));

const sourceFor = (name) => DATAFLOW_SOURCES.find((s) => s.artifact.test(name)) || null;

/** The engine a SARIF document came from: its driver's own name first, else the artifact's. */
export function engineOf(tool, artifactName = '') {
  const t = String(tool || '').toLowerCase();
  for (const e of ['codeql', 'psalm', 'opengrep', 'semgrep']) if (t.includes(e)) return e;
  const s = sourceFor(artifactName);
  return s ? s.engine : 'unknown';
}

/**
 * The file a rollup row carries for a SARIF location: monitor/extractors/sarif.mjs strips a file://
 * scheme and monitor/detail-schema.mjs's `path` type caps it at 512. A different normalisation here
 * would join nothing, and joining nothing reads as "no dataflow row" — so a test pins this to the
 * extractor's own output.
 */
export const findingFileOf = (uri) => String(uri || '').replace(/^file:\/\/\/?/, '').slice(0, 512);

/** Identity: repo|rule|file. NEVER the line — code moves for reasons unrelated to the finding. */
export const dataflowKey = (repo, rule, file) => `${repo}|${rule || ''}|${file || ''}`;

/**
 * Identity of one source→sink route: both ends by file and expression, never by line. This is
 * flow/dfd-rescan.mjs's recordKey without the rule, and that module builds its key from this one.
 */
export const routeKey = (path) => [path.source.file, path.source.expr || '', path.sink.file, path.sink.expr || ''].join('\u0000');

const uriOf = (loc) => {
  const u = loc?.location?.physicalLocation?.artifactLocation?.uri;
  return u ? findingFileOf(u) : null;
};
const lineOf = (loc) => loc?.location?.physicalLocation?.region?.startLine ?? null;
const msgOf = (loc) => loc?.location?.message?.text || null;

/** Every threadFlow of every codeFlow that has at least one step, in document order. */
function threadFlowsOf(result) {
  const out = [];
  for (const cf of Array.isArray(result?.codeFlows) ? result.codeFlows : []) {
    for (const tf of Array.isArray(cf?.threadFlows) ? cf.threadFlows : []) {
      if (Array.isArray(tf?.locations) && tf.locations.length) out.push(tf.locations);
    }
  }
  return out;
}

const endsOf = (locs) => {
  const first = locs[0];
  const last = locs[locs.length - 1];
  return {
    steps: locs.length,
    source: { file: uriOf(first), line: lineOf(first), expr: msgOf(first) },
    sink: { file: uriOf(last), line: lineOf(last), expr: msgOf(last) },
  };
};

const stepsOf = (locs) => locs.map((l) => {
  const region = l?.location?.physicalLocation?.region || {};
  // the columns let a reader check the step against the source it is about to be laid over
  const cols = Number.isInteger(region.startColumn) && Number.isInteger(region.endColumn) && (region.endLine === undefined || region.endLine === region.startLine)
    ? { col: region.startColumn, endCol: region.endColumn } : {};
  return { file: uriOf(l), line: lineOf(l), expr: msgOf(l), ...cols };
});

/**
 * Every distinct route a result carries, as { steps, source, sink, trace }, one per routeKey. Of two
 * threadFlows with the same ends the shorter is kept (then the earlier), so the choice does not
 * depend on the order an engine happened to write them in. Sorted by routeKey: one result is one
 * sequence of routes. [] when the result carries no path at all.
 */
export function routesOf(result) {
  const byKey = new Map();
  for (const locs of threadFlowsOf(result)) {
    const route = { ...endsOf(locs), trace: stepsOf(locs) };
    const k = routeKey(route);
    const prev = byKey.get(k);
    if (!prev || route.steps < prev.steps) byKey.set(k, route);
  }
  return [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, r]) => r);
}

/**
 * The source and sink of a result's first threadFlow, plus its length and the number of codeFlows.
 * Returns null when the result carries no path at all. Kept for the readers that draw one route;
 * routesOf is every route.
 */
export function pathOf(result) {
  const all = threadFlowsOf(result);
  if (!all.length) return null;
  return { ...endsOf(all[0]), flows: result.codeFlows.length };
}

/**
 * Every step of a result's first threadFlow, in order: [{ file, line, expr }]. pathOf keeps the two
 * ends and the length; this keeps what lies between, which is what places a trace in the functions
 * it passes through. Returns null when the result carries no path at all.
 */
export function traceOf(result) {
  const all = threadFlowsOf(result);
  return all.length ? stepsOf(all[0]) : null;
}

/**
 * Which engines are INDEPENDENT witnesses. Opengrep is a Semgrep fork running the same rules, and
 * semgrep.sarif and semgrep-auto.sarif are one engine run twice: on a real sweep (2026-10-21) all
 * 89 locations two artifacts shared were that pair, same rule ids, same columns. Counting them as two
 * witnesses would manufacture agreement, so agreement is counted between families, never artifacts.
 */
export const ENGINE_FAMILY = Object.freeze({ codeql: 'codeql', psalm: 'psalm', semgrep: 'semgrep', opengrep: 'semgrep' });
const familyOf = (engine) => ENGINE_FAMILY[engine] || engine;

/**
 * One place in one scan: repo, file, line. Engines spell a file differently — measured on the same
 * sweep, CodeQL wrote `app/site/a.ts` and Semgrep on Windows `app\site\a.ts` — so the separator
 * is normalised here and only here. A line is fit to compare two engines' results in ONE sweep of one
 * commit; it is never a finding's identity, which stays dataflowKey.
 */
export const siteKey = (repo, file, line) => `${repo}|${String(file || '').replace(/\\/g, '/')}|${line}`;

const ENGINE_LABEL = { codeql: 'CodeQL', psalm: 'Psalm', semgrep: 'Semgrep', opengrep: 'Opengrep' };
const labelOf = (engine) => ENGINE_LABEL[engine] || engine;

// Why a result without a path says nothing, per engine — each is a measured statement about that
// engine, not one engine's finding generalised.
const NO_PATH_WHY = {
  codeql: (rule) => `CodeQL rule ${rule} is not a dataflow query; it emits no path, so this result says nothing either way about reachability`,
  psalm: (rule) => `Psalm issue ${rule} carries no taint path; Psalm writes one only for taint issues, so this result says nothing either way about reachability`,
  semgrep: (rule) => `Semgrep rule ${rule} carries no trace: the rule is pattern-only, or it is a taint rule whose trace the engine did not export (semgrep 1.182.0 OSS exports none with --dataflow-traces), so this result says nothing either way about reachability`,
};
NO_PATH_WHY.opengrep = (rule) => NO_PATH_WHY.semgrep(rule).replace('Semgrep rule', 'Opengrep rule');

// When the rule's own definition was read (cra/semgrep-rule-modes.mjs), the two cases the default
// text has to hold open are told apart. Measured on a real sweep (2026-10-21, modes fetched 2026-11-18):
// 4 of the 7 registry rules that fired were taint rules, and so were 82 of the 88 sastSemgrep
// findings (unsafe-formatstring alone is 78). Read from the SARIF alone, they looked like pattern
// matches; they are matches Semgrep reached by tracing, with the trace kept to itself.
const SEMGREP_FAMILY = new Set(['semgrep', 'opengrep']);
const fromWhere = (rm) => (rm.source === 'local' ? "commitwork's own rule file" : 'its registry definition');
const MODE_WHY = {
  taint: (label, rule, rm) => `${label} rule ${rule} is a taint rule (mode taint, per ${fromWhere(rm)}): a match means the engine traced data from one of the rule's sources to this sink, but semgrep 1.182.0 OSS did not export the trace, so there is no path to show and this result is not counted as reachable`,
  search: (label, rule, rm) => `${label} rule ${rule} is a pattern rule (mode ${rm.mode}, per ${fromWhere(rm)}); it matches a code shape and never looks for a flow, so this result says nothing either way about reachability`,
};
MODE_WHY.join = MODE_WHY.search;
MODE_WHY.extract = MODE_WHY.search;

function noPathWhy(engine, rule, ruleMode = null) {
  if (SEMGREP_FAMILY.has(engine) && ruleMode) {
    if (ruleMode.mode && MODE_WHY[ruleMode.mode]) return MODE_WHY[ruleMode.mode](labelOf(engine), rule, ruleMode);
    const base = NO_PATH_WHY[engine](rule);
    return ruleMode.source === 'unresolved'
      ? `${base}; its mode could not be read (${ruleMode.why})`
      : `${base}; its mode is not recorded (bin/semgrep-rule-modes.mjs fetch records it)`;
  }
  return (NO_PATH_WHY[engine] || ((r) => `${labelOf(engine)} result ${r} carries no path, so it says nothing either way about reachability`))(rule);
}

const detailOf = (engine, route, routes) => `${labelOf(engine)} traced ${route.steps} steps from ${route.source.expr || 'a source'} (${route.source.file}:${route.source.line}) to ${route.sink.expr || 'a sink'} (${route.sink.file}:${route.sink.line})${routes > 1 ? `; ${routes} distinct routes` : ''}`;

/**
 * One SARIF result → a reachability determination + the evidence behind it. `path` is the shortest
 * route (then the first by routeKey) and `paths` is every route, each without its trace — the trace
 * is what flow/dfd-cli.mjs draws and is read there through routesOf. `repo` is supplied by the caller
 * from the artifact's own directory; a result is never attributed to a guess. `engine` defaults to
 * codeql, the engine every caller read before Psalm and Semgrep were. `trace: true` keeps the lead
 * route's steps on `path.trace` — that route's, not the first threadFlow's, so the steps and the ends
 * always describe the same route.
 */
export function dataflowFromResult(result, repo, atIso, { engine = 'codeql', trace = false, ruleMode = null } = {}) {
  const rule = result?.ruleId || null;
  const file = findingFileOf(result?.locations?.[0]?.physicalLocation?.artifactLocation?.uri) || null;
  if (!rule) return null;
  const routes = routesOf(result);
  if (routes.length) {
    const lead = routes.reduce((a, b) => (b.steps < a.steps ? b : a));
    const strip = ({ trace: _steps, ...ends }) => ends;
    return {
      repo, rule, file,
      reachability: 'reachable',
      path: { ...strip(lead), flows: result.codeFlows.length, ...(trace ? { trace: lead.trace } : {}) },
      paths: routes.map(strip),
      evidence: {
        source: engine, method: 'dataflow', confidence: 'high', at: atIso,
        detail: detailOf(engine, lead, routes.length),
      },
    };
  }
  return {
    repo, rule, file,
    // The query is syntactic and never looked for a path. Not unproven — nothing searched.
    reachability: 'reachability_unknown',
    path: null,
    evidence: [],
    why: noPathWhy(engine, rule, ruleMode),
    // Semgrep-family rows only: the rule's mode and where it was read ({ mode: null } when unknown).
    ...(SEMGREP_FAMILY.has(engine) && ruleMode ? { ruleMode: { mode: ruleMode.mode, source: ruleMode.source } } : {}),
  };
}

/**
 * One SARIF result → one dataflow record PER ROUTE, each carrying its own `path` (with `trace`), for
 * readers that draw routes rather than determine findings (flow/dfd-cli.mjs). A result without a
 * path is one record, as dataflowFromResult returns it. [] for a result with no rule.
 */
export function dataflowsFromResult(result, repo, atIso, { engine = 'codeql', trace = false } = {}) {
  const row = dataflowFromResult(result, repo, atIso, { engine });
  if (!row) return [];
  if (row.reachability !== 'reachable') return [row];
  const routes = routesOf(result);
  return routes.map((r) => {
    const { trace: steps, ...ends } = r;
    return {
      repo: row.repo, rule: row.rule, file: row.file, reachability: 'reachable',
      path: { ...ends, flows: result.codeFlows.length, ...(trace ? { trace: steps } : {}) },
      evidence: { ...row.evidence, detail: detailOf(engine, r, 1) },
    };
  });
}

// reports/<sweep>/<repo>/codeql*.sarif — the repo is the artifact's own parent directory.
const repoOfPath = (p) => basename(dirname(p));

/** Two index rows for one finding → one. A proven path is never cancelled by a result that did not look. */
function mergeRows(prev, row) {
  if (!prev) return row;
  if (prev.reachability === 'reachable' && row.reachability !== 'reachable') return prev;
  if (row.reachability === 'reachable' && prev.reachability !== 'reachable') return row;
  if (row.reachability !== 'reachable') return prev;
  // both proven: every route of both, one per routeKey, the shorter of two equal ends
  const byKey = new Map();
  for (const p of [...prev.paths, ...row.paths]) {
    const k = routeKey(p);
    const had = byKey.get(k);
    if (!had || p.steps < had.steps) byKey.set(k, p);
  }
  const paths = [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, p]) => p);
  const lead = paths.reduce((a, b) => (b.steps < a.steps ? b : a));
  const engines = [...new Set([...(prev.engines || [prev.evidence.source]), row.evidence.source])].sort();
  return {
    ...prev,
    path: { ...lead, flows: (prev.path.flows || 0) + (row.path.flows || 0) },
    paths,
    engines,
    evidence: { ...prev.evidence, detail: detailOf(prev.evidence.source, lead, paths.length) },
    mergedRows: (prev.mergedRows || 1) + 1,
  };
}

/**
 * Walk a reports directory and index every taint path, keyed repo|rule|file.
 * Returns { index, stats, state, reason }:
 *   state 'ok'          the directory was read (stats say how much of it carried paths)
 *   state 'absent'      the directory does not exist (ENOENT) — nothing to read, NOT a clean index
 *   state 'unreadable'  the directory exists and could not be listed — fails closed
 * An unreadable subdirectory is counted in stats.unreadableDirs and named in stats.unreadable, never
 * skipped into silence; an artifact the reader could not use is counted in stats.byState.
 * Entries are walked in name order, and rows for one key are merged, so the index does not depend
 * on the order a filesystem lists them in.
 */
export function buildDataflowIndex({ dir = reportsDir(), maxDepth = 6, atIso = new Date().toISOString(), ruleModes = null } = {}) {
  const index = new Map();
  const stats = {
    artifacts: 0, results: 0, withPath: 0, syntacticOnly: 0, routes: 0, byState: {}, byEngine: {},
    unreadableDirs: 0, unreadable: [], repos: new Set(), rules: new Set(),
    // Semgrep-family results without a path, by their rule's mode — or by why the mode is unknown.
    semgrepNoPath: {},
  };
  // The Semgrep rule-mode table and commitwork's own rules, read at CALL time. `ruleModes` lets a
  // caller (a test) supply { table, local } instead. A table that cannot be used is stated, and every
  // mode reads as unknown — never as 'search'.
  const modes = ruleModes || (() => {
    const t = readRuleModes();
    return { table: t.table, local: readLocalModes(), state: t.state, reason: t.reason };
  })();
  stats.ruleModes = { state: modes.state || (modes.table ? 'ok' : 'absent'), reason: modes.reason || null };

  // Agreement between engines (corroborationFor): who reported at each site, which sites each
  // finding occupies, which families a finding came from, and which families ran in each repo.
  const sites = new Map();        // siteKey -> Map(family -> { path, rules:Set })
  const ownSites = new Map();     // dataflowKey -> Set(siteKey)
  const familiesOf = new Map();   // dataflowKey -> Set(family)
  const familiesRan = new Map();  // repo -> Set(family): an ok artifact was read, results or not

  const put = (row) => {
    if (!row) return;
    const key = dataflowKey(row.repo, row.rule, row.file);
    index.set(key, mergeRows(index.get(key), row));
  };

  // A result occupies its primary location and, when it carries routes, each route's sink. For a
  // taint result those coincide (the primary location IS the sink), and a route whose sink lies
  // elsewhere still places the finding there.
  const site = (row, result, engine) => {
    const fam = familyOf(engine);
    const dk = dataflowKey(row.repo, row.rule, row.file);
    const traced = row.reachability === 'reachable';
    const here = [];
    const line0 = result?.locations?.[0]?.physicalLocation?.region?.startLine;
    if (row.file && Number.isInteger(line0)) here.push(siteKey(row.repo, row.file, line0));
    for (const p of traced ? row.paths : []) {
      if (p.sink.file && Number.isInteger(p.sink.line)) here.push(siteKey(row.repo, p.sink.file, p.sink.line));
    }
    if (!familiesOf.has(dk)) familiesOf.set(dk, new Set());
    familiesOf.get(dk).add(fam);
    if (!ownSites.has(dk)) ownSites.set(dk, new Set());
    for (const sk of here) {
      ownSites.get(dk).add(sk);
      if (!sites.has(sk)) sites.set(sk, new Map());
      const w = sites.get(sk).get(fam) || { path: false, rules: new Set() };
      w.path = w.path || traced;
      w.rules.add(row.rule);
      sites.get(sk).set(fam, w);
    }
  };

  const list = (d) => {
    try { return { entries: readdirSync(d, { withFileTypes: true }) }; } catch (e) {
      return { error: e };
    }
  };

  const walk = (d, depth) => {
    if (depth > maxDepth) return;
    const { entries, error } = list(d);
    if (error) {
      // ENOENT under a directory just listed is a race (a sweep pruned it), and still a hole: counted.
      stats.unreadableDirs++;
      if (stats.unreadable.length < 20) stats.unreadable.push(`${d}: ${error.code || error.message}`);
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      const src = sourceFor(e.name);
      if (!src) continue;
      stats.artifacts++;
      const rec = readSarif(p);
      stats.byState[rec.state] = (stats.byState[rec.state] || 0) + 1;
      // Only 'ok' carries runs; every other state carries null deliberately. An artifact we could
      // not read is COUNTED, never skipped into silence — otherwise a fleet of unreadable SARIFs
      // and a fleet with no paths produce the same empty index.
      if (rec.state !== 'ok') continue;
      const engine = engineOf(rec.tool, e.name);
      stats.byEngine[engine] = (stats.byEngine[engine] || 0) + 1;
      const repo = repoOfPath(p);
      stats.repos.add(repo);
      if (!familiesRan.has(repo)) familiesRan.set(repo, new Set());
      familiesRan.get(repo).add(familyOf(engine));
      // The reader's own flattened results. NOT `rec.runs || []` / `run.results || []` — it returns
      // null for every non-ok state deliberately, and re-defaulting to [] converts a void back into
      // a clean zero. monitor/test/one-sarif-reader.test.mjs catches exactly that, and caught this.
      for (const result of rec.results) {
        stats.results++;
        const ruleMode = SEMGREP_FAMILY.has(engine) ? modeFor(result?.ruleId, modes) : null;
        const row = dataflowFromResult(result, repo, atIso, { engine, ruleMode });
        if (!row) continue;
        if (row.reachability === 'reachable') { stats.withPath++; stats.routes += row.paths.length; } else stats.syntacticOnly++;
        if (row.ruleMode) {
          const k = row.ruleMode.mode || row.ruleMode.source;
          stats.semgrepNoPath[k] = (stats.semgrepNoPath[k] || 0) + 1;
        }
        stats.rules.add(row.rule);
        put(row);
        site(row, result, engine);
      }
    }
  };

  // The root decides the state; only ENOENT means legitimately absent.
  const root = list(dir);
  let state = 'ok';
  let reason = null;
  if (root.error) {
    state = root.error.code === 'ENOENT' ? 'absent' : 'unreadable';
    reason = `${dir}: ${root.error.code || root.error.message}`;
  } else {
    walk(dir, 0);
  }

  return {
    index,
    state,
    reason,
    stats: { ...stats, repos: stats.repos.size, rules: stats.rules.size, indexed: index.size },
    sites, ownSites, familiesOf, familiesRan,
  };
}

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Whether an engine of ANOTHER family reported at this finding's own sites in the same sweep.
 * `built` is buildDataflowIndex's result. A second witness travels beside the determination and
 * never changes it: agreement raises confidence in a finding, it does not prove reachability, and a
 * second engine's bare finding at the site is not a second route. States:
 *   'corroborated'    another family reported at a site of this finding; each witness says whether
 *                     it traced a route there (`kind: 'path'`) or only reported there ('finding')
 *   'uncorroborated'  other families ran over this repository and reported nothing at its sites —
 *                     NOT a negative: the engines' rule sets differ, so silence says little
 *   'single-engine'   no other family produced a readable artifact for this repository, so
 *                     agreement was not measurable
 *   'unsited'         the finding's results carry no line, so there is no site to compare
 *   'no-row'          nothing is indexed for this repo|rule|file
 */
export function corroborationFor(built, repo, rule, file) {
  const dk = dataflowKey(repo, rule, file);
  const own = built && built.familiesOf ? built.familiesOf.get(dk) : null;
  if (!own) return { state: 'no-row', engines: [], others: [], witnesses: [], why: 'no taint-engine result is indexed for this repo/rule/file' };
  const engines = [...own].sort(byName);
  const others = [...(built.familiesRan.get(repo) || [])].filter((f) => !own.has(f)).sort(byName);
  if (!others.length) {
    return { state: 'single-engine', engines, others, witnesses: [],
      why: `only ${engines.map(labelOf).join(', ')} produced a readable result for this repository, so a second witness was not measurable` };
  }
  const mine = built.ownSites.get(dk) || new Set();
  if (!mine.size) {
    return { state: 'unsited', engines, others, witnesses: [], why: 'the finding\'s results carry no line, so there is no site another engine could be compared at' };
  }
  const found = new Map();
  for (const sk of [...mine].sort(byName)) {
    for (const [fam, w] of built.sites.get(sk) || []) {
      if (own.has(fam)) continue;
      const had = found.get(fam) || { path: false, rules: new Set() };
      had.path = had.path || w.path;
      for (const r of w.rules) had.rules.add(r);
      found.set(fam, had);
    }
  }
  if (!found.size) {
    return { state: 'uncorroborated', engines, others, witnesses: [],
      why: `${others.map(labelOf).join(', ')} ran over this repository and reported nothing at this finding's site; their rules differ, so that silence is not a negative` };
  }
  const witnesses = [...found.entries()].sort(([a], [b]) => byName(a, b))
    .map(([engine, w]) => ({ engine, kind: w.path ? 'path' : 'finding', rules: [...w.rules].sort(byName) }));
  return { state: 'corroborated', engines, others, witnesses };
}

/**
 * The dataflow determination for one SAST finding. `basis` says which of three things is true, so a
 * consumer can give an unknown its reason without parsing prose:
 *   'path'     an engine traced a route to this finding (reachable)
 *   'no-path'  the finding's own result carries no path (see `why`, per engine)
 *   'no-row'   no indexed result has this repo|rule|file — the engine may not cover this rule, or
 *              may not have run here, or the finding comes from a lane this index does not read
 * A finding with no row is `reachability_unknown` with NO evidence. Absence is its own state, never
 * a clean one.
 */
export function dataflowFor(index, repo, rule, file) {
  const hit = index.get(dataflowKey(repo, rule, file));
  if (hit && hit.reachability === 'reachable') {
    return {
      reachability: 'reachable', basis: 'path', evidence: [hit.evidence], path: hit.path,
      paths: hit.paths || [hit.path], ...(hit.engines ? { engines: hit.engines } : {}),
    };
  }
  if (hit) return { reachability: 'reachability_unknown', basis: 'no-path', evidence: [], why: hit.why, ...(hit.ruleMode ? { ruleMode: hit.ruleMode } : {}) };
  return {
    reachability: 'reachability_unknown',
    basis: 'no-row',
    evidence: [],
    why: 'no taint-engine result for this repo/rule/file — the engine may not cover this rule, or may not have run here',
  };
}
