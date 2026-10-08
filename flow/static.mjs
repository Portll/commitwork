// C1 — the static pass. Read/write/spawn edges from path literals, CW_* env keys and spawn targets.
//
// Every emitted edge stands on a string literal that the hand-rolled lexer found AND that V8
// accepted when the source was rebuilt from the lexer's own classification (flow/verify.mjs). A
// module whose lexer bails, whose source V8 cannot parse, or whose rebuild V8 rejects is UNKNOWN:
// it contributes no edges, and — the half that is routinely dropped — its artifacts are excluded
// from orphan findings, because "nothing reads this" said over a file nobody could read is a
// fabricated finding.
//
// The coverage claim is over the FILE SET, not the edges found: analysed + unanalysable = the whole
// input, and unanalysable is enumerated by name and reason.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, rawQuotedRuns } from './lexer.mjs';
import { parseModule, maskConsistent, maskFrom, specifierCoverage } from './verify.mjs';
import { makeNode, makeEdge, mergeEdges, artifactKinds, nodeId, SCHEMA_VERSION } from './graph.mjs';
import { storePath, writeJson, now } from './store.mjs';
import { isMainModule } from '../lib/is-main.mjs';

export const REPO_DIRS = new Set([
  'reports', 'monitor', 'manifests', 'schema', 'evaluations', 'fixtures', 'docs', 'bin', 'lib',
  'admin', 'cra', 'map', 'sitemap', 'mcp', 'workflows', 'prompts', 'provenance', 'ci', 'design',
  'docsite', 'intake', 'flow', 'chunk-diff', 'workspace', 'reference',
  '.claude', '.github', 'spec',
]);

const ARTIFACT_EXT =
  /\.(json|jsonl|ndjson|md|html?|sarif|txt|log|csv|tsv|ya?ml|lock|sh|mjs|cjs|js|png|svg|ico|xml|db|sqlite|pem|plist|patch|diff|tsv)$/i;

const READ_VERBS = ['readFileSync', 'readFile', 'createReadStream', 'readdirSync', 'readdir',
  'existsSync', 'statSync', 'lstatSync', 'opendirSync', 'realpathSync', 'accessSync', 'globSync',
  'readJson', 'readJsonSync', 'loadJson', 'readStore', 'readJournal', 'readJournalFile'];
const WRITE_VERBS = ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile',
  'createWriteStream', 'mkdirSync', 'renameSync', 'copyFileSync', 'cpSync', 'unlinkSync', 'rmSync',
  'symlinkSync', 'truncateSync', 'utimesSync', 'writeAtomic', 'writeJson', 'writeJsonSync'];
const SPAWN_VERBS = ['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec', 'fork'];

const VERB_RE = new RegExp(`\\b(${[...READ_VERBS, ...WRITE_VERBS, ...SPAWN_VERBS].join('|')})\\s*\\(`, 'g');
const SPAWN_HEAD_RE = new RegExp(`\\b(${SPAWN_VERBS.join('|')})\\s*\\(\\s*$`);
const ENV_DOT_RE = /\benv\.(CW_[A-Z0-9_]+)\b/g;
// A top-level `const X = process.env.CW_Y` is read ONCE at import and defeats every test that sets
// the override afterwards. `const f = () => process.env.CW_Y` does not — the read happens on call.
// The lookahead is what tells them apart; without it every arrow function was flagged.
const ENV_LOADTIME_RE = /^(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=(?:(?!=>|\bfunction\b)[^;])*\benv\.CW_[A-Z0-9_]+/;

/** Is this string value plausibly a repo artifact path? Conservative on purpose. */
export function looksLikePath(v) {
  if (typeof v !== 'string' || !v || v.length > 200) return false;
  if (/[\s*?\n]/.test(v)) return false;                       // globs and prose are not paths
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return false;           // node:, http:, data:, file:
  if (v.includes('${')) return false;                         // not statically resolvable
  // A bare extension is a SUFFIX TEST, not a path: `endsWith('.md')` appears all over this tree and
  // was minting artifact nodes called ".md" and ".jsonl". Require a name before the dot.
  if (/^\.[a-z0-9]+$/i.test(v)) return false;
  if (ARTIFACT_EXT.test(v)) return true;
  const head = v.replace(/^\.\.?\//, '').split('/')[0];
  return v.includes('/') && REPO_DIRS.has(head);
}

/**
 * identifier -> roles it is passed to as a first argument, e.g. `readFileSync(P` -> P:{reads}.
 *
 * The overwhelmingly common shape here is `const P = join(OUT, 'x.json')` on one line and
 * `readFileSync(P)` on another, which no lookback window can reach. Without this the direction is
 * genuinely unknown for ~44% of artifact edges — honest, but too coarse to act on.
 */
export function argRoles(masked) {
  const out = new Map();
  for (const m of masked.matchAll(/\b([\w$]+)\s*\(\s*([\w$]+)\s*[,)]/g)) {
    const role = READ_VERBS.includes(m[1]) ? 'reads' : WRITE_VERBS.includes(m[1]) ? 'writes' : null;
    if (!role) continue;
    if (!out.has(m[2])) out.set(m[2], new Set());
    out.get(m[2]).add(role);
  }
  return out;
}

/** The `const NAME =` this literal is being bound to, if any. */
export function bindingName(src, masked, at) {
  const from = src.lastIndexOf('\n', at) + 1;
  const m = /(?:^|[;{]\s*)(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=[^=]*$/.exec(masked.slice(from, at));
  return m ? m[1] : null;
}

// A fallback is what makes a dead dependency look alive: the read fails, the default returns, and
// nothing ever reports. "reads X" and "reads X, falls back to Y" are different findings, so the
// marker is recorded on the edge rather than folded into it. `suspected`, never asserted — this is
// a window scan, and calling it certain would be the over-reporting this repo pays for.
const FALLBACK_RE = /\}\s*catch|catch\s*[({]|\?\?|\|\|\s*[[{'"0-9]|:\s*(?:\[\]|\{\}|null)/;
const TRY_RE = /\btry\s*\{/;

export function fallbackNear(masked, at) {
  const after = masked.slice(at, at + 260);
  const before = masked.slice(Math.max(0, at - 160), at);
  const m = FALLBACK_RE.exec(after) || (TRY_RE.test(before) ? { 0: 'try' } : null);
  return m ? { suspected: true, marker: String(m[0]).trim().slice(0, 24) } : null;
}

// C5 asks what freshness a consumer ASSUMES. A consumer that checks nothing is itself the finding,
// so the absence has to be detectable — which means the presence has to be.
const FRESHNESS_RE = /\bmtime|\bmtimeMs|\bmaxAge|\bttl\b|\bTTL\b|STALE|\bageMs|\bageDays|\bstaleAfter|Date\.now\(\)\s*-/;

export function freshnessNear(masked, at) {
  const m = FRESHNESS_RE.exec(masked.slice(Math.max(0, at - 200), at + 400));
  return m ? { checks: true, marker: m[0] } : null;
}

/** Nearest enclosing call verb before `at`, from the MASKED source so prose cannot supply one. */
export function verbBefore(masked, at, window = 260) {
  const text = masked.slice(Math.max(0, at - window), at);
  // An object property VALUE is not a call argument. `$schema: '../schema/x.schema.json'` in
  // bin/docsite-new.mjs was read as a file read because a read verb happened to sit within the
  // lookback window — the one confirmed false positive in the first verified run of this tool.
  if (/:\s*$/.test(text)) return { verb: null, role: 'unknown' };
  let last = null;
  VERB_RE.lastIndex = 0;
  for (const m of text.matchAll(VERB_RE)) last = m[1];
  if (SPAWN_HEAD_RE.test(text)) return { verb: last, role: 'spawn-target' };
  if (!last) return { verb: null, role: 'unknown' };
  if (READ_VERBS.includes(last)) return { verb: last, role: 'reads' };
  if (WRITE_VERBS.includes(last)) return { verb: last, role: 'writes' };
  return { verb: last, role: 'unknown' };
}

/**
 * -> a per-module record. `state` is the grey carrier: only 'analysed' contributes edges, and the
 * other three are named rather than dropped.
 */
export async function analyseSource(path, src) {
  const base = { v: SCHEMA_VERSION, path, edges: [], envKeys: [], literals: 0, witness: {} };

  const parsed = await parseModule(src, path);
  if (!parsed.ok) return { ...base, state: 'unparseable', reason: parsed.error };

  const lex = classify(src);
  if (!lex.ok) return { ...base, state: 'lexer-bailed', reason: lex.reason };

  const mask = await maskConsistent(src, lex.spans, path);
  if (!mask.ok) return { ...base, state: 'mask-inconsistent', reason: mask.error };

  const { masked } = maskFrom(src, lex.spans);   // the SAME rewrite V8 just accepted, not a copy of it
  const specifiers = parsed.specifiers;
  const specSet = new Set(specifiers);
  const line = lex.lineOf;

  // W2 false-negative direction: every static specifier V8 names must be a literal the lexer found.
  const coverage = specifierCoverage(specifiers, lex.spans);

  const edges = [];
  const envKeys = new Map();
  const argsUsedAs = argRoles(masked);

  // ── module -> module, from V8 (exact for static imports; dynamic ones come from the lexer below)
  for (const spec of specifiers) {
    if (!/^\.\.?\//.test(spec)) continue;
    edges.push({ kind: 'reads', targetKind: 'module', target: resolveSpec(path, spec), evidence: `${path} static-import` });
  }

  // ── literals
  const strings = lex.spans.filter((s) => (s.kind === 'string' || (s.kind === 'template' && !s.interpolated)) && s.value !== null);
  for (const sp of strings) {
    const v = sp.value;
    const at = `${path}:${line(sp.start)}`;

    if (v.startsWith('CW_') && /^CW_[A-Z0-9_]+$/.test(v) && /\benv\s*\[\s*$/.test(masked.slice(Math.max(0, sp.start - 40), sp.start))) {
      envKeys.set(v, { key: v, evidence: `${at} env-bracket`, suspectedLoadTime: false });
      continue;
    }

    const { verb, role } = verbBefore(masked, sp.start);

    if (role === 'spawn-target') {
      edges.push({ kind: 'spawns', targetKind: 'process', target: v, evidence: `${at} ${verb}` });
      continue;
    }
    if (!looksLikePath(v)) continue;
    if (specSet.has(v)) continue;                       // already emitted as a module edge

    // A relative specifier under a dynamic import is a module edge; V8 does not report those.
    if (/^\.\.?\//.test(v) && /\bimport\s*\(\s*$/.test(masked.slice(Math.max(0, sp.start - 20), sp.start))) {
      edges.push({ kind: 'reads', targetKind: 'module', target: resolveSpec(path, v), evidence: `${at} dynamic-import` });
      continue;
    }

    const target = normalise(v, path);
    // `composed: true` — a bare filename is a NAME, not a location. It is almost always joined with
    // a directory elsewhere, so several real files collapse onto one node. C4 must not read such a
    // node as one artifact.
    const composed = !v.includes('/');

    const extras = () => (role === 'reads' || role === 'unknown'
      ? { fallback: fallbackNear(masked, sp.start), freshness: freshnessNear(masked, sp.start) }
      : {});

    if (role !== 'unknown') {
      edges.push({ kind: role, targetKind: 'artifact', target, composed, evidence: `${at} ${verb}`, directionWitness: 'lookback', ...extras() });
      continue;
    }
    const bound = bindingName(src, masked, sp.start);
    const roles = bound ? argsUsedAs.get(bound) : null;
    if (roles && roles.size) {
      for (const r of roles) {
        edges.push({ kind: r, targetKind: 'artifact', target, composed, evidence: `${at} ${bound} -> ${r}`, directionWitness: 'binding', ...(r === 'reads' ? extras() : {}) });
      }
      continue;
    }
    edges.push({ kind: 'touches', targetKind: 'artifact', target, composed, evidence: `${at} literal`, directionWitness: 'none' });
  }

  // ── CW_* env keys, from the masked source so a key named in a comment is not a read
  for (const m of masked.matchAll(ENV_DOT_RE)) {
    const lineText = lineTextAt(masked, m.index);
    const prev = envKeys.get(m[1]);
    const loadTime = ENV_LOADTIME_RE.test(lineText);
    if (!prev || (loadTime && !prev.suspectedLoadTime)) {
      envKeys.set(m[1], { key: m[1], evidence: `${path}:${line(m.index)} env-dot`, suspectedLoadTime: loadTime });
    }
  }

  // ── W3: path-shaped raw runs the lexer neither emitted nor placed inside any span
  const covered = (off) => lex.spans.some((s) => off >= s.start && off < s.end);
  const inComment = (off) => lex.spans.some((s) => (s.kind === 'line' || s.kind === 'block') && off >= s.start && off < s.end);
  const unaccounted = [];
  let commentPaths = 0;
  for (const run of rawQuotedRuns(src)) {
    if (!looksLikePath(run.value)) continue;
    const at = run.start + 1;
    if (inComment(at)) { commentPaths += 1; continue; }
    if (!covered(at)) unaccounted.push({ value: run.value, line: line(at) });
  }

  return {
    ...base,
    state: 'analysed',
    reason: null,
    literals: strings.length,
    // What C1 could POSSIBLY have claimed about this module. C3 needs it to tell a hole in the
    // literal extraction from a path that was never a literal at all (a directory walk, a join of
    // variables, an argv value). Without the distinction, tracing one recursive walk reports two
    // thousand false negatives and the instrument becomes the crisis it is measuring.
    pathLiterals: [...new Set(strings.map((s) => s.value).filter(looksLikePath))],
    edges,
    envKeys: [...envKeys.values()],
    witness: {
      v8Parse: 'ok',
      maskConsistent: 'ok',
      specifiersChecked: coverage.checked,
      specifiersMissing: coverage.missing,     // FALSE NEGATIVE, V8-sourced
      unaccounted,                             // FALSE NEGATIVE, W3-sourced
      pathsInComments: commentPaths,           // informational: explained, not emitted
    },
  };
}

function lineTextAt(s, at) {
  const from = s.lastIndexOf('\n', at) + 1;
  const to = s.indexOf('\n', at);
  return s.slice(from, to === -1 ? s.length : to);
}

function resolveSpec(fromFile, spec) {
  const base = normalize(join(dirname(fromFile), spec));
  return /\.[a-z]+$/i.test(base) ? base : `${base}.mjs`;
}

// A relative artifact path is relative to the MODULE, not to the repo root. Unresolved,
// `../area.mjs` read by monitor/test/freshness.test.mjs becomes its own node with no producer, and
// C4 reports a dead dependency on a file that is right there. Measured: 11 of 20 read-never-written
// findings were this one defect.
function normalise(p, fromFile) {
  if (/^\.\.?\//.test(p) && fromFile) return normalize(join(dirname(fromFile), p));
  return normalize(p).replace(/^\.\//, '');
}

/** A test module's fixtures are not repo artifacts. Kept, bucketed, never headline. */
export function isTestModule(p) {
  return /(^|\/)test\//.test(p) || /\.test\.[cm]?js$/.test(p) || /(^|\/)fixtures\//.test(p);
}

/** -> { nodes, edges, modules, summary }. Coverage is asserted over the file set, not the edges. */
export async function analyseRepo({ root, files, env = process.env } = {}) {
  const repo = root || repoRoot();
  const list = files || trackedSources(repo);
  const modules = [];
  for (const f of list) {
    let src;
    try {
      src = readFileSync(join(repo, f), 'utf8');
    } catch (e) {
      modules.push({ v: SCHEMA_VERSION, path: f, state: 'unreadable', reason: e.code || e.message, edges: [], envKeys: [], witness: {} });
      continue;
    }
    modules.push(await analyseSource(f, src));
  }

  const analysed = modules.filter((m) => m.state === 'analysed');
  const raw = analysed.flatMap((m) => m.edges.map((e) => ({ ...e, from: m.path })));
  const artifactPaths = [...new Set(raw.filter((e) => e.targetKind === 'artifact').map((e) => e.target))];
  const kinds = artifactKinds(artifactPaths, raw.filter((e) => e.targetKind === 'artifact'));

  const nodes = new Map();
  const put = (kind, key, extra) => {
    const id = nodeId(kind, key);
    if (!nodes.has(id)) nodes.set(id, makeNode(kind, key, extra));
    return id;
  };
  for (const m of modules) put('module', m.path, { analysis: m.state });

  const edges = [];
  for (const e of raw) {
    const from = nodeId('module', e.from);
    const to = e.targetKind === 'artifact'
      ? put(kinds.get(e.target) || 'artifact', e.target, { composed: !e.target.includes('/') })
      : put(e.targetKind, e.target);
    edges.push(makeEdge(from, to, e.kind, {
      witness: 'static', existence: 'unknown', evidence: e.evidence,
      ...(e.directionWitness ? { directionWitness: e.directionWitness } : {}),
      ...(e.fallback ? { fallback: e.fallback } : {}),
      ...(e.freshness ? { freshness: e.freshness } : {}),
    }));
  }
  for (const m of analysed) {
    for (const k of m.envKeys) {
      const to = put('env', k.key);
      edges.push(makeEdge(nodeId('module', m.path), to, 'reads', {
        witness: 'static', existence: 'unknown', evidence: k.evidence,
        ...(k.suspectedLoadTime ? { suspectedLoadTime: true } : {}),
      }));
    }
  }

  const unanalysable = modules.filter((m) => m.state !== 'analysed');
  return {
    v: SCHEMA_VERSION,
    generatedAt: now(env),
    root: repo,
    nodes: [...nodes.values()],
    edges: mergeEdges(edges),
    modules,
    summary: {
      filesInput: list.length,
      analysed: analysed.length,
      unanalysable: unanalysable.length,
      unanalysableByReason: countBy(unanalysable, (m) => m.state),
      coverageAccountsForAll: analysed.length + unanalysable.length === list.length,
      // false negatives, reported SEPARATELY from the false-positive floor above
      falseNegative: {
        specifiersMissing: analysed.flatMap((m) => m.witness.specifiersMissing.map((s) => `${m.path} -> ${s}`)),
        unaccounted: analysed.flatMap((m) => m.witness.unaccounted.map((u) => `${m.path}:${u.line} ${u.value}`)),
      },
      falsePositiveFloor: {
        maskRejected: modules.filter((m) => m.state === 'mask-inconsistent').map((m) => m.path),
        lexerBailed: modules.filter((m) => m.state === 'lexer-bailed').map((m) => m.path),
      },
    },
  };
}

function countBy(xs, f) {
  const out = {};
  for (const x of xs) out[f(x)] = (out[f(x)] || 0) + 1;
  return out;
}

export function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

export function trackedSources(repo) {
  return execFileSync('git', ['-C', repo, 'ls-files', '*.mjs'], { encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n').filter(Boolean).filter((f) => !f.startsWith('.claude/'));
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const repo = repoRoot();
  const graph = await analyseRepo({ root: repo, env });
  const out = storePath('flow.json', env);
  writeJson(out, graph);
  const s = graph.summary;
  process.stdout.write([
    `flow/static: ${s.analysed}/${s.filesInput} modules analysed, ${s.unanalysable} unanalysable`,
    `  unanalysable: ${JSON.stringify(s.unanalysableByReason)}`,
    `  nodes ${graph.nodes.length}  edges ${graph.edges.length}`,
    `  FALSE NEGATIVE  specifiers missed ${s.falseNegative.specifiersMissing.length}  unaccounted path-runs ${s.falseNegative.unaccounted.length}`,
    `  FALSE POSITIVE FLOOR  mask rejected ${s.falsePositiveFloor.maskRejected.length}  lexer bailed ${s.falsePositiveFloor.lexerBailed.length}`,
    `  -> ${relative(repo, out)}`,
    '',
  ].join('\n'));
  return graph;
}

if (isMainModule(import.meta.url)) {
  const vm = await import('node:vm');
  if (typeof vm.SourceTextModule !== 'function') {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  await main();
}
