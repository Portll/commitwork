// flow/dfd-rescan.mjs — what a commit makes worth scanning again, and what the rescan says changed.
//
// A commit names the files it changed. rescanScope widens that to their neighbours in a dfd@1 model:
// the files data reaches from a changed file and the files data reaches it from, counted in file
// hops. diffCodeFlows then compares the code-flow records (cra/dataflow-evidence.mjs rows) of the
// scan before the commit with those of the rescan, and writes what the commit closed as a dfd@1
// patch keyed to it. Both are pure functions: nothing here runs git or a scanner.
//
// What a rescan cannot say, it does not say. A flow whose files the rescan did not cover is carried
// forward, never read as closed: an absent result from a scan that did not look is not a fix. A
// closed record that shares its from/to pair with a record still present cannot be written as a
// patch (dfd@1 names a flow by its pair) and is listed as unexpressed.

import { isDirected } from '../lib/dfd.mjs';
import { sinkKindOf } from './dfd-adapter.mjs';
import { routeKey } from '../cra/dataflow-evidence.mjs';

const FILE_PREFIXES = ['node:module:', 'code:'];

/** The repository-relative file an element stands for, or null when it stands for none (a store, an env name, a sink). */
export function fileOfNode(node) {
  if (!node || node.kind !== 'process') return null;
  if (node.id.startsWith('node:module:')) return node.id.slice('node:module:'.length);
  // code:<repo>:<file> — the repo name holds no colon
  if (node.id.startsWith('code:')) return node.id.split(':').slice(2).join(':') || null;
  return FILE_PREFIXES.some((p) => node.id.startsWith(p)) ? node.label : null;
}

// What kind of file a changed path is decides what its neighbours are and which lanes it concerns.
export const FILE_CLASSES = Object.freeze(['source', 'source-other', 'test', 'data', 'deps', 'ci', 'docs', 'other']);
const RE_TEST = /(^|\/)(tests?|__tests__|fixtures)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const RE_DEPS = /(^|\/)(package(-lock)?\.json|npm-shrinkwrap\.json|deno\.lock|yarn\.lock|pnpm-lock\.yaml|requirements[^/]*\.txt|Pipfile(\.lock)?|pyproject\.toml|poetry\.lock|go\.(mod|sum)|Cargo\.(toml|lock)|composer\.(json|lock)|Gemfile(\.lock)?)$/;
const RE_CI = /^\.github\/|(^|\/)(crontab|\.gitlab-ci\.yml|Jenkinsfile)$|\.plist$/;
const RE_SOURCE = /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts)$/;
const RE_SOURCE_OTHER = /\.(py|php|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|sh|bash|zsh|pl|cob|cbl|jcl|pli)$/;
const RE_DOCS = /\.(md|mdx|rst|txt|adoc|html?|pdf|png|jpe?g|gif|svg|webp|ico|woff2?)$|^docs\/|(^|\/)(LICENSE|NOTICE|CHANGELOG)[^/]*$/;
const RE_DATA = /\.(json|jsonl|ya?ml|toml|csv|tsv|sql|xml|ini|env|conf|cfg|lock)$/;

/**
 * source        JS or TypeScript the static pass reads
 * source-other  code in a language it does not read: a CodeQL or Joern lane's business, with no element here
 * test          a test or a fixture: evidence about its subject, and a leaf — nothing is a neighbour THROUGH a test
 * data          a file other code reads or writes: its neighbours are its readers and writers
 * deps          a manifest or lockfile: the dependency lanes' business, not a taint question
 * ci            a workflow, a schedule: the trigger elements and the workflow lanes
 * docs          prose and images: no data flows through them
 * other         anything else
 * Order matters: a test written in JS is a test, a lockfile is deps before it is data.
 */
export function classifyFile(path) {
  const p = String(path);
  if (RE_TEST.test(p)) return 'test';
  if (RE_DEPS.test(p)) return 'deps';
  if (RE_CI.test(p)) return 'ci';
  if (RE_SOURCE.test(p)) return 'source';
  if (RE_SOURCE_OTHER.test(p)) return 'source-other';
  if (RE_DOCS.test(p)) return 'docs';
  if (RE_DATA.test(p)) return 'data';
  return 'other';
}

const isBareName = (node) => node.kind !== 'process' && typeof node.note === 'string' && node.note.startsWith('bare filename');
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);

/**
 * The files to scan again, and the tests to run, after a commit that changed `changedFiles`.
 *
 *   classes      every changed file -> its class (classifyFile)
 *   changed      changed files that are file elements of the model
 *   data         changed data, deps and ci files matched to a store or artifact element: by path, or
 *                by bare filename (`ambiguous: true` — the element is a name several files may share)
 *   deps         changed manifests and lockfiles. They are rescanned (the dependency lanes read them)
 *                and seed no walk: a version bump in package.json is not a change to every file that
 *                reads a package.json
 *   unmatched    changed files the model holds nothing for; they are still rescanned, and their class
 *                says which lanes they concern
 *   downstream   non-test files data reaches from a changed file within `hops` file hops
 *   upstream     non-test files data reaches a changed file from, within `hops` file hops
 *   tests        tests to run: the changed tests, and every test that neighbours a changed file
 *   evidenceFor  the files a changed test imports or reads: what its result is evidence about. They
 *                did not change, so they are not rescanned on the test's account
 *   files        the sorted union of the changed files and their non-test neighbours: the fileset to rescan
 *   full         true when `files` is more than `fullOver` of the model's non-test file elements: past
 *                that a scoped rescan saves little, and the caller should run the full scan
 *
 * A hop is counted on arriving at a file element, so a write to a store that another file reads is
 * one hop, not two. The walk follows flow direction: two readers of one store or one env name are
 * not neighbours, because nothing flows between them. A flow whose direction was never determined
 * is walked both ways. Two things are never walked THROUGH: a test (it imports its subjects, which
 * does not make them neighbours of each other) and an element that is a bare filename (a name, not
 * a location: every file called package.json would meet in it).
 */
export function rescanScope(model, changedFiles, { hops = 1, fullOver = 0.25 } = {}) {
  if (!Number.isInteger(hops) || hops < 0) throw new Error(`dfd-rescan: hops must be a whole number, got ${JSON.stringify(hops)}`);
  const nodeOf = new Map(model.nodes.map((n) => [n.id, n]));
  const fileOf = new Map(model.nodes.map((n) => [n.id, fileOfNode(n)]));
  const byFile = new Map();
  for (const [id, file] of fileOf) if (file !== null) { if (!byFile.has(file)) byFile.set(file, []); byFile.get(file).push(id); }
  const byLabel = new Map();
  for (const n of model.nodes) if (n.kind === 'store') { if (!byLabel.has(n.label)) byLabel.set(n.label, []); byLabel.get(n.label).push(n); }
  const isTestId = (id) => fileOf.get(id) !== null && classifyFile(fileOf.get(id)) === 'test';
  const want = [...new Set(changedFiles)];
  const classes = Object.fromEntries(want.map((f) => [f, classifyFile(f)]));
  const changed = want.filter((f) => byFile.has(f));
  const data = [];
  for (const f of want) {
    if (byFile.has(f) || classes[f] === 'deps') continue;
    const exact = (byLabel.get(f) || byLabel.get(`/${f}`) || []).filter((n) => !isBareName(n));
    const bare = exact.length ? [] : (byLabel.get(baseOf(f)) || []).filter(isBareName);
    if (exact.length || bare.length) data.push({ file: f, elements: [...exact, ...bare].map((n) => n.id), ambiguous: !exact.length });
  }
  const matchedData = new Set(data.map((d) => d.file));
  const deps = want.filter((f) => classes[f] === 'deps' && !byFile.has(f));
  const unmatched = want.filter((f) => !byFile.has(f) && !matchedData.has(f) && classes[f] !== 'deps');
  const fwd = new Map(model.nodes.map((n) => [n.id, []]));
  const back = new Map(model.nodes.map((n) => [n.id, []]));
  for (const f of model.flows) {
    if (f.from === f.to) continue;
    fwd.get(f.from).push(f.to);
    back.get(f.to).push(f.from);
    if (!isDirected(f)) { fwd.get(f.to).push(f.from); back.get(f.from).push(f.to); }
  }
  const changedTests = changed.filter((f) => classes[f] === 'test');
  const seeds = [...changed.filter((f) => classes[f] !== 'test').flatMap((f) => byFile.get(f)), ...data.flatMap((d) => d.elements)];
  const seedSet = new Set(seeds);
  const tests = new Set(changedTests);
  const walk = (adj) => {
    const depth = new Map(seeds.map((id) => [id, 0]));
    const queue = seeds.slice();
    for (let q = 0; q < queue.length; q++) {
      const at = queue[q];
      const d = depth.get(at);
      for (const next of adj.get(at)) {
        const isFile = fileOf.get(next) !== null;
        const nd = d + (isFile ? 1 : 0);
        if (nd > hops) continue;
        if (isFile && isTestId(next)) { tests.add(fileOf.get(next)); continue; }
        if (!isFile && isBareName(nodeOf.get(next)) && !seedSet.has(next)) continue;
        if (depth.has(next) && depth.get(next) <= nd) continue;
        depth.set(next, nd);
        queue.push(next);
      }
    }
    const own = new Set(changed);
    return [...new Set([...depth.keys()].map((id) => fileOf.get(id)).filter((f) => f !== null && !own.has(f)))].sort();
  };
  const downstream = walk(fwd);
  const upstream = walk(back);
  const evidenceFor = [...new Set(changedTests.flatMap((f) => byFile.get(f)).flatMap((id) => back.get(id)).map((id) => fileOf.get(id))
    .filter((f) => f !== null && classifyFile(f) !== 'test'))].sort();
  const files = [...new Set([...want, ...downstream, ...upstream])].sort();
  const fileElements = [...byFile.keys()].filter((f) => classifyFile(f) !== 'test').length;
  return { hops, classes, changed: changed.sort(), data, deps: deps.sort(), unmatched: unmatched.sort(), downstream, upstream,
    tests: [...tests].sort(), evidenceFor, files, fileElements, full: fileElements > 0 && files.length > fullOver * fileElements };
}

/** A code-flow record's identity across two scans: its rule and both ends by file and expression. Line numbers move when code above them changes, so they take no part. */
// The route half is cra/dataflow-evidence.mjs routeKey, which also dedupes the routes of one finding:
// one identity, so a route the evidence index merged is the route a rescan compares.
export const recordKey = (r) => [r.rule, routeKey(r.path)].join('\u0000');

/** The from/to pairs fromCodeFlows draws for one record, in order: input -> source file [-> sink file] -> sink. */
export function pairsOfRecord(r) {
  const p = r.path;
  const code = (file) => `code:${r.repo}:${file}`;
  const out = [{ from: `input:${r.repo}:${p.source.file}:${p.source.line}`, to: code(p.source.file) }];
  if (p.sink.file !== p.source.file) out.push({ from: code(p.source.file), to: code(p.sink.file) });
  out.push({ from: code(p.sink.file), to: `sink:${r.repo}:${sinkKindOf(r.rule).category}` });
  return out;
}

const traced = (r) => !!r && r.reachability === 'reachable' && !!r.path?.source?.file && !!r.path?.sink?.file;
const pairId = (pr) => `${pr.from}\u0000${pr.to}`;

/**
 * The records of the scan before a commit against those of the rescan after it.
 *   closed       before, both files covered by the rescan, absent after
 *   persisting   in both
 *   opened       after only
 *   carried      before, not covered by the rescan: nothing is known about it at this commit
 *   patch        a dfd@1 patch keyed to `commit` that closes every pair all of whose records closed,
 *                evidence `rescanned`; null when no pair qualifies
 *   unexpressed  closed records none of whose pairs could be closed, because a record still present
 *                (persisting, opened or carried) shares each of them
 * `covered` is the set of files the rescan analysed (the rescan scope, less any file the tool failed
 * on). A record with no trace says nothing about reachability and takes no part.
 */
export function diffCodeFlows(before, after, { commit, covered }) {
  if (typeof commit !== 'string' || commit.length < 7) throw new Error('dfd-rescan: diffCodeFlows needs the commit the rescan ran at (a sha of 7 or more characters)');
  const cover = new Set(covered);
  const b = (before || []).filter(traced);
  const a = (after || []).filter(traced);
  const afterKeys = new Set(a.map(recordKey));
  const beforeKeys = new Set(b.map(recordKey));
  const closed = [];
  const persisting = [];
  const carried = [];
  for (const r of b) {
    if (afterKeys.has(recordKey(r))) persisting.push(r);
    else if (cover.has(r.path.source.file) && cover.has(r.path.sink.file)) closed.push(r);
    else carried.push(r);
  }
  const opened = a.filter((r) => !beforeKeys.has(recordKey(r)));
  const live = new Set([...persisting, ...opened, ...carried].flatMap((r) => pairsOfRecord(r).map(pairId)));
  const closes = new Map();
  const unexpressed = [];
  for (const r of closed) {
    const free = pairsOfRecord(r).filter((pr) => !live.has(pairId(pr)));
    if (!free.length) { unexpressed.push(r); continue; }
    // the most specific pair that is free: the last hop into the sink, else the hops before it
    const pick = free[free.length - 1];
    closes.set(pairId(pick), pick);
  }
  const patch = closes.size ? {
    id: `commit:${commit.slice(0, 12)}`,
    title: `rescan at ${commit.slice(0, 12)}: ${closed.length - unexpressed.length} code flow${closed.length - unexpressed.length === 1 ? '' : 's'} no longer reported`,
    commits: [commit],
    closes: [...closes.values()],
    evidence: { level: 'rescanned', refs: closed.filter((r) => !unexpressed.includes(r)).map((r) => `${r.rule} ${r.path.source.file}:${r.path.source.line} -> ${r.path.sink.file}:${r.path.sink.line}`) },
  } : null;
  return { closed, persisting, opened, carried, unexpressed, patch };
}
