// The one command. Builds the graph over the repository and answers questions about it.
//
// Re-execs itself with --experimental-vm-modules when that flag is absent, the way flow/report.mjs
// does, because W2 is not optional: an export surface produced without V8 is the unfloored
// extractor wearing the floored one's name.
//
//   node codegraph/report.mjs                     build, measure, write the store
//   node codegraph/report.mjs about <path>        what an agent wants before editing a file
//   node codegraph/report.mjs importers <path>    who imports it, statically and dynamically
//   node codegraph/report.mjs blast <path>        everything a change here can reach
//   node codegraph/report.mjs callers <path> <n>  who calls one symbol
//   node codegraph/report.mjs dead                exported symbols nothing binds — and the ones
//                                                 that only LOOK dead, kept in their own field
//   node codegraph/report.mjs entries             modules nothing imports
//   node codegraph/report.mjs search <query>      semantic search, ranked by veld, resolved here
//   node codegraph/report.mjs veld-publish        what WOULD be sent to veld (a dry run)
//   node codegraph/report.mjs veld-publish --apply  actually send it
//   node codegraph/report.mjs veld-publish --apply --limit 5   …a bounded first run
//
// `--head` reads the committed tree instead of the working one. The default is the working tree
// because that is what you are editing; the store records which, so no consumer can mistake one for
// the other. A verdict about what a CLONE gets — a dead export, above all — wants --head.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { analyse } from './build.mjs';
import { storePath, writeJson, readJson } from './store.mjs';
import {
  index, importers, blastRadius, deadExports, callersOf, entryPoints, neighbourhood,
} from './query.mjs';
import { symbolId } from './schema.mjs';
import { publish, search } from './veld.mjs';

const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** The repo's identity in a locator: its origin URL when there is one, else its path. */
export function repoName(root = repoRoot()) {
  try {
    return git(root, ['remote', 'get-url', 'origin']).trim() || root;
  } catch { return root; }
}

export function headSha(root = repoRoot()) {
  try { return git(root, ['rev-parse', 'HEAD']).trim(); } catch { return null; }
}

export function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}


/** Tracked `.mjs` sources. `.claude/` is excluded: it is harness configuration, not the program. */
export function sources(root) {
  return git(root, ['ls-files', '*.mjs']).split('\n')
    .filter((p) => p.endsWith('.mjs') && !p.startsWith('.claude/'))
    .sort();
}

/**
 * Every HEAD blob in ONE `git cat-file --batch`, rather than a `git show` per file.
 *
 * Measured 2026-09-05 over 1,063 sources: 34,458ms for the per-file spawns against 9,055ms for the
 * worktree. That gap is 1,063 subprocesses, and it is the whole reason --head was described here as
 * "the occasional run" — a cost that shapes what you are willing to check is a cost worth removing,
 * and codegraph/test/divergence.test.mjs now runs this on every suite.
 *
 * Buffer, never `encoding: 'utf8'`, for the reason bin/test/tracked-imports.test.mjs states: the
 * batch stream is length-delimited in BYTES and this tree is multi-byte dense, so decoding first
 * would put character offsets against byte lengths and desync the whole stream.
 */
export function headBlobs(root, files) {
  if (!files.length) return new Map();
  const specs = files.map((p) => `HEAD:${p}`).join('\n');
  const out = execFileSync('git', ['-C', root, 'cat-file', '--batch'],
    { input: `${specs}\n`, maxBuffer: 512 * 1024 * 1024 });
  const map = new Map();
  let off = 0;
  for (const path of files) {
    const nl = out.indexOf(0x0a, off);
    if (nl === -1) break;
    const header = out.toString('utf8', off, nl);
    // `<sha> missing` for a path HEAD does not carry. Absent, and it must not silently become ''.
    if (/ missing$/.test(header)) { off = nl + 1; continue; }
    const size = Number(header.split(' ')[2]);
    map.set(path, out.toString('utf8', nl + 1, nl + 1 + size));
    off = nl + 1 + size + 1;
  }
  return map;
}

export function readerFor(root, { head = false, blobs = null } = {}) {
  if (!head) return (p) => readFileSync(resolve(root, p), 'utf8');
  return (p) => {
    const s = blobs?.get(p);
    // Not `?? ''`: a path the batch did not yield is ABSENT, and analyse() records that as
    // unreadable. An empty string would be a module with no exports, which is a different claim.
    if (s === undefined) { const e = new Error(`no HEAD blob for ${p}`); e.code = 'ENOENT'; throw e; }
    return s;
  };
}

export function headSources(root) {
  return git(root, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n')
    .filter((p) => p.endsWith('.mjs') && !p.startsWith('.claude/'))
    .sort();
}

export async function build({ root = repoRoot(), head = false, env = process.env } = {}) {
  const files = head ? headSources(root) : sources(root);
  const blobs = head ? headBlobs(root, files) : null;
  return analyse({ files, readFile: readerFor(root, { head, blobs }), source: head ? 'HEAD' : 'worktree', env });
}

/** The store, or a fresh build when it is absent. Only ENOENT means absent — flow/store.mjs's rule. */
export async function load({ root = repoRoot(), head = false, env = process.env, rebuild = false } = {}) {
  if (!rebuild) {
    const got = readJson(storePath('codegraph.json', env));
    if (got.state === 'present') return got.data;
  }
  return build({ root, head, env });
}

function pct(n, d) {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

export function formatBuild(graph) {
  const s = graph.summary;
  const d = s.divergence;
  const u = s.unresolved;
  const unknownCalls = u.calls.filter((c) => c.why === 'unknown');
  return [
    '── codegraph ────────────────────────────────────────────────────────',
    `population     ${s.analysed} analysed + ${s.partial} partial + ${s.unreadable} unreadable = ${graph.files.input} tracked .mjs  (${graph.source})`,
    ...(s.unreadable ? [`               unreadable ${JSON.stringify(s.unreadableByReason)}`] : []),
    ...graph.files.partial.slice(0, 5).map((p) => `               partial  ${p.path}  ${p.reason.slice(0, 90)}`),
    `graph          nodes ${graph.nodes.length} ${JSON.stringify(s.nodesByKind)}`,
    `               edges ${graph.edges.length} ${JSON.stringify(s.edgesByKind)}`,
    `               existence ${JSON.stringify(s.edgesByExistence)}`,
    'W1 vs W2       the export surface, compared in both directions over every analysed file',
    `               FALSE POSITIVE  ${d.falsePositive.length} file(s) where W1 claims an export V8 does not have`,
    ...d.falsePositive.slice(0, 5).map((f) => `                 ${f.path}  ${f.names.join(' ')}`),
    `               FALSE NEGATIVE  ${d.falseNegative.length} file(s) where V8 has an export W1 never found`,
    ...d.falseNegative.slice(0, 5).map((f) => `                 ${f.path}  ${f.names.join(' ')}`),
    `               agreed on ${d.filesCompared - d.falsePositive.length - d.falseNegative.length}/${d.filesCompared} files`,
    ...(d.reexports ? [
      'W1 vs W2       what each re-export resolves to, compared the same way',
      `               FALSE POSITIVE  ${d.reexports.falsePositive.length} file(s) where W1 reads a re-export V8 does not resolve`,
      ...d.reexports.falsePositive.slice(0, 5).map((f) => `                 ${f.path}  ${f.reexports.join(' · ')}`),
      `               FALSE NEGATIVE  ${d.reexports.falseNegative.length} file(s) where V8 resolves a re-export W1 never read`,
      ...d.reexports.falseNegative.slice(0, 5).map((f) => `                 ${f.path}  ${f.reexports.join(' · ')}`),
    ] : ['W1 vs W2       re-exports NOT compared — this graph predates the re-export witness']),
    `unresolved     imports ${u.imports.length}  calls ${JSON.stringify(s.unresolved.callsByReason)}`,
    `               ${unknownCalls.length} call name(s) resolve to nothing this can see (${pct(unknownCalls.reduce((a, c) => a + c.sites, 0), graph.edges.filter((e) => e.kind === 'calls').length + unknownCalls.reduce((a, c) => a + c.sites, 0))} of call sites)`,
    ...unknownCalls.slice(0, 5).map((c) => `                 ${c.name} ×${c.sites}  ${c.where.join(' ')}`),
    `               ambiguous ${u.ambiguousCalls.length} (a local declaration and an import share the name)`,
  ].join('\n');
}

async function main(argv) {
  const head = argv.includes('--head');
  const rebuild = argv.includes('--rebuild');
  const args = argv.filter((a) => !a.startsWith('--'));
  const cmd = args[0] || 'build';
  const env = process.env;

  if (cmd === 'build') {
    const graph = await build({ head, env });
    writeJson(storePath('codegraph.json', env), graph);
    process.stdout.write(`${formatBuild(graph)}\n               -> ${storePath('codegraph.json', env)}\n`);
    return 0;
  }

  const graph = await load({ head, env, rebuild });
  const ix = index(graph);
  const out = (x) => process.stdout.write(`${JSON.stringify(x, null, 2)}\n`);

  switch (cmd) {
    case 'about': out(neighbourhood(graph, args[1], ix)); return 0;
    case 'importers': out(importers(graph, args[1], ix)); return 0;
    case 'blast': out(blastRadius(graph, args[1], { ix })); return 0;
    case 'callers': out({ symbol: symbolId(args[1], args[2]), callers: callersOf(graph, symbolId(args[1], args[2]), ix) }); return 0;
    case 'dead': out(deadExports(graph, ix)); return 0;
    case 'entries': out(entryPoints(graph, ix)); return 0;
    case 'search': out(await search(graph, args.slice(1).join(' '), { repo: repoName(), env })); return 0;
    case 'veld-publish': {
      const li = argv.indexOf('--limit');
      const limit = li === -1 ? Infinity : Number(argv[li + 1]);
      if (!(limit > 0)) { process.stderr.write('veld-publish: --limit needs a positive number\n'); return 2; }
      const r = await publish(graph, { repo: repoName(), commit: headSha(), apply: argv.includes('--apply'), limit, env });
      out(r);
      return r.applied && r.tally && r.tally.failed ? 1 : 0;
    }
    default:
      process.stderr.write(`unknown command ${cmd}\n`);
      return 2;
  }
}

if (isMainModule(import.meta.url)) {
  const vm = await import('node:vm');
  if (typeof vm.SourceTextModule !== 'function') {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath,
      ['--experimental-vm-modules', resolve(dirname(fileURLToPath(import.meta.url)), 'report.mjs'), ...process.argv.slice(2)],
      { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  process.exit(await main(process.argv.slice(2)));
}
