#!/usr/bin/env node
// commitwork — module-seams: does this file have a seam, before anyone cuts one into it?
//
// WHY THIS EXISTS. A 2,500-line module looks splittable, and its section banners look like
// boundaries. Measured on monitor/extractors.mjs, 2026-09-04, the banners are not: cutting there
// leaves three cyclic section pairs (1<->3, 1<->4, 3<->4), section 3 needing 20 symbols from
// section 1. But the FILE is fully acyclic — all 84 declarations layer cleanly across six layers.
// Those two facts are not in tension: the banners group declarations arbitrarily, so cutting along
// them crosses the dependency grain. Cut along the layering instead.
//
// GETTING THAT ANSWER TOOK THREE CORRECTIONS TO THIS FILE, each of which had inverted it:
//   · comments were counted, so prose naming a function read as calling it (two phantom pairs);
//   · the last declaration's body ran to EOF and swallowed the trailing `export { … }` list, so
//     every exported name read as a reference from it (the last phantom cycle);
//   · and the first version's floors were slack enough to pass with a whole module deleted.
// Each made the tool say "do not split" about a file that splits cleanly. That is the expensive
// direction of wrong, and it is why every claim below is asserted in bin/test/module-seams.test.mjs
// rather than described here.
//
// So this answers the question first, and it answers it two ways:
//
//   LEAF LAYER (default). Which top-level declarations reference only each other? That set can move
//   to a base module with no back-reference. A file whose leaf layer is most of it has a seam; one
//   whose remainder is the bulk does not — the heavy functions are the ones tangled together.
//
//   --cuts a,b,c. Score a PROPOSED split: how many symbols each section would have to import from
//   each other section, and which pairs would be CYCLIC. Cycles are the answer "no".
//
// COMMENTS AND STRINGS ARE STRIPPED BEFORE ANY OF THIS, and the first version of this file did not
// do it. Measured on monitor/extractors.mjs: every back-edge that made its four sections mutually
// cyclic — socketRefusal -> SCANNER_SPECS, _cspmCounts <-> _scorecardCounts — had ZERO non-comment
// references. This file is heavily commented, and its comments name other functions constantly, so
// counting those turned prose into a dependency graph and the tool reported a tangle that is not
// there. The conclusion drawn from it ("extractors.mjs has no seam") was wrong, and wrong in the
// expensive direction: it recommended NOT doing work that is in fact feasible.
//
// WHAT IT STILL DOES NOT CLAIM. Identifier matching remains textual after stripping: a shadowed
// local can look like a reference to a top-level one, and a name inside a template-literal
// expression is real code this stripper keeps. It still over-reports rather than under-reports —
// so "no cycles" is worth trusting and "cycles" is worth reading before believing. It is a
// screening tool for a decision, not a proof about behaviour.
//
// usage: node bin/module-seams.mjs <file> [--cuts 906,1500,2157] [--json]
// exit:  0 always — this reports, it does not gate.

import { isMainModule } from '../lib/is-main.mjs';
import { readFileSync, existsSync } from 'node:fs';

const DECL_RE = /^(?:export )?(?:async )?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
const ID_RE = /\b([A-Za-z_$][\w$]*)\b/g;

// Language and host names that are never a module's own declarations. Kept deliberately short: a
// name wrongly listed here would HIDE a real dependency, which is the direction that misleads.
const AMBIENT = new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'new', 'typeof', 'of', 'in', 'this', 'true', 'false', 'null', 'undefined', 'async', 'await', 'try',
  'catch', 'throw', 'class', 'export', 'import', 'from', 'default', 'case', 'switch', 'break',
  'continue', 'do', 'delete', 'instanceof', 'void', 'yield', 'static', 'get', 'set',
  'Object', 'Array', 'String', 'Number', 'Math', 'JSON', 'Set', 'Map', 'Boolean', 'Date', 'RegExp',
  'Error', 'Promise', 'console', 'process', 'Infinity', 'NaN', 'Symbol', 'globalThis']);

/**
 * Blank out comments and string/template literals, preserving length and newlines so every byte
 * offset and line number computed downstream still points at the real file. Replacing rather than
 * removing is what lets declarations() slice bodies by index against the ORIGINAL source.
 *
 * Deliberately not a parser. It handles the four forms this repository actually contains — //, star
 * comments, quoted strings, and template literals — and it keeps the INSIDE of a template's
 * ${...} because that is executable code that can carry a real reference.
 */
export function stripNonCode(src) {
  let out = '';
  let i = 0;
  const keepNewlines = (s) => s.replace(/[^\n]/g, ' ');
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += keepNewlines(src.slice(i, stop)); i = stop; continue;
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += keepNewlines(src.slice(i, stop)); i = stop; continue;
    }
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out += keepNewlines(src.slice(i, Math.min(j + 1, src.length))); i = j + 1; continue;
    }
    if (c === '`') {
      // Blank the literal text but KEEP ${ } contents — those are expressions, not prose.
      let j = i + 1;
      out += ' ';
      while (j < src.length && src[j] !== '`') {
        if (src[j] === '\\') { out += '  '; j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') {
          let depth = 1; let k = j + 2;
          while (k < src.length && depth) { if (src[k] === '{') depth++; else if (src[k] === '}') depth--; k++; }
          out += '  ' + src.slice(j + 2, k - 1) + ' ';   // keep the expression, blank the delimiters
          j = k; continue;
        }
        out += src[j] === '\n' ? '\n' : ' '; j++;
      }
      out += ' '; i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

/**
 * Top-level declarations, each with the source from its own keyword to the next declaration.
 *
 * EVERY top-level `export { … }` BLOCK ENDS THE BODY BEFORE IT. Without that, a declaration's body
 * runs on and swallows the export list — so every name in that list reads as a reference FROM that
 * declaration. On monitor/extractors.mjs that manufactured the file's only remaining cycle:
 * `_a11yCounts` is declared last, the file ends `export { … SCANNER_SPECS … }`, and the pair came
 * back mutually dependent when the real edge (SCANNER_SPECS calls _a11yCounts) runs one way.
 *
 * THE FIRST FIX FOR THAT TOOK THE FIRST SUCH BLOCK IN THE FILE, and that was only right while the
 * only one was the last line. It broke the moment a re-export appeared mid-file: splitting the lane
 * register out of extractors.mjs on 2026-09-05 put `export { … } from './lane-kinds.mjs';` at line
 * 2157, the scan stopped there, and the TRAILING block — the one the fix existed for — went back to
 * being swallowed by the last declaration. The same phantom cycle returned, in a tool whose comment
 * said it was fixed. So the bound is now per-declaration: the nearest export block AFTER it.
 *
 * The same swallowing applies to any trailing top-level statement; the export block is the form this
 * repository actually uses, and `export { … } from '…'` is now one of the shapes it takes.
 */
export function declarations(src) {
  const out = [];
  for (const m of src.matchAll(DECL_RE)) out.push({ name: m[1], at: m.index });
  const blocks = [...src.matchAll(/^export\s*\{/gm)].map((m) => m.index);
  for (let i = 0; i < out.length; i++) {
    const next = i + 1 < out.length ? out[i + 1].at : src.length;
    // an export block only bounds the body that would otherwise run PAST it — so take the nearest
    // one after this declaration, not the first one in the file
    const hardEnd = blocks.find((b) => b > out[i].at);
    out[i].body = src.slice(out[i].at, hardEnd === undefined ? next : Math.min(next, hardEnd));
  }
  return out;
}

/**
 * The leaf layer: declarations whose internal references are satisfied by other leaves. Grown to a
 * fixed point, so a helper that depends only on other helpers joins it however deep the chain.
 */
export function leafLayer(rawSrc) {
  const src = stripNonCode(rawSrc);
  const decls = declarations(src);
  const byName = new Map(decls.map((d) => [d.name, d]));
  for (const d of decls) {
    d.deps = new Set([...d.body.matchAll(ID_RE)].map((m) => m[1])
      .filter((n) => n !== d.name && byName.has(n)));
  }
  const leaf = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const d of decls) {
      if (leaf.has(d.name)) continue;
      if ([...d.deps].every((n) => leaf.has(n))) { leaf.add(d.name); grew = true; }
    }
  }
  const lines = (ds) => ds.reduce((n, d) => n + d.body.split('\n').length, 0);
  const leafDecls = decls.filter((d) => leaf.has(d.name));
  const rest = decls.filter((d) => !leaf.has(d.name));
  return { total: decls.length, leaf: leafDecls, rest, leafLines: lines(leafDecls), restLines: lines(rest) };
}

/** Score a proposed split at `cuts` (1-based start lines of sections 2..n). */
export function scoreCuts(rawSrc, cuts) {
  const src = stripNonCode(rawSrc);   // prose that names a function is not a dependency on it
  const lines = src.split('\n');
  const bounds = [0, ...cuts.map((c) => c - 1), lines.length];
  const sections = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const text = lines.slice(bounds[i], bounds[i + 1]).join('\n');
    sections.push({ n: i + 1, from: bounds[i] + 1, to: bounds[i + 1], lines: text.split('\n').length, text });
  }
  for (const s of sections) {
    s.declares = new Set([...s.text.matchAll(DECL_RE)].map((m) => m[1]));
    s.uses = new Set([...s.text.matchAll(ID_RE)].map((m) => m[1]).filter((n) => !AMBIENT.has(n)));
  }
  const edges = [];
  for (const a of sections) {
    for (const b of sections) {
      if (a.n === b.n) continue;
      const needs = [...b.declares].filter((n) => a.uses.has(n));
      if (needs.length) edges.push({ from: a.n, to: b.n, count: needs.length, names: needs });
    }
  }
  const seen = new Set(edges.map((e) => `${e.from}>${e.to}`));
  const cycles = [...new Set(edges.filter((e) => seen.has(`${e.to}>${e.from}`))
    .map((e) => [e.from, e.to].sort((x, y) => x - y).join('<->')))];
  return { sections, edges, cycles };
}

function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file || !existsSync(file)) {
    console.error('usage: node bin/module-seams.mjs <file> [--cuts 906,1500] [--json]');
    console.error(file ? `no such file: ${file}` : '');
    process.exit(0);
  }
  const src = readFileSync(file, 'utf8');
  const cutsArg = argv.find((a) => a.startsWith('--cuts'));
  const cuts = cutsArg
    ? (cutsArg.includes('=') ? cutsArg.split('=')[1] : argv[argv.indexOf(cutsArg) + 1] || '')
      .split(',').map((n) => Number(n.trim())).filter(Boolean)
    : [];
  const json = argv.includes('--json');

  const leaf = leafLayer(src);
  const scored = cuts.length ? scoreCuts(src, cuts) : null;

  if (json) {
    console.log(JSON.stringify({
      file,
      declarations: leaf.total,
      leaf: { count: leaf.leaf.length, lines: leaf.leafLines, names: leaf.leaf.map((d) => d.name) },
      remainder: { count: leaf.rest.length, lines: leaf.restLines, names: leaf.rest.map((d) => d.name) },
      cuts: scored && { sections: scored.sections.map(({ n, from, to, lines }) => ({ n, from, to, lines })),
        edges: scored.edges.map(({ from, to, count, names }) => ({ from, to, count, names })), cycles: scored.cycles },
    }, null, 2));
    return;
  }

  console.log(`${file}: ${src.split('\n').length} lines, ${leaf.total} top-level declarations`);
  console.log(`  leaf layer: ${leaf.leaf.length} declarations (~${leaf.leafLines} lines) — could move to a base module`);
  console.log(`  remainder : ${leaf.rest.length} declarations (~${leaf.restLines} lines) — depend on the leaf or each other`);
  // The shape of the answer, said plainly, because the numbers alone invite the wrong read.
  console.log(leaf.restLines > leaf.leafLines
    ? '  → the BULK is tangled: the heavy functions depend on each other. No cheap seam here.'
    : '  → most of the file is independent helpers: a base module is feasible.');
  if (leaf.rest.length && leaf.rest.length <= 20) {
    console.log(`  remainder: ${leaf.rest.map((d) => d.name).join(', ')}`);
  }

  if (scored) {
    console.log(`\nproposed cut at ${cuts.join(', ')}:`);
    for (const s of scored.sections) console.log(`  section ${s.n}: L${s.from}-${s.to} (${s.lines} lines)`);
    console.log('  imports each section would need:');
    for (const e of scored.edges) {
      console.log(`    ${e.from} -> ${e.to}: ${e.count}  [${e.names.slice(0, 6).join(', ')}${e.count > 6 ? ', …' : ''}]`);
    }
    console.log(scored.cycles.length
      ? `  CYCLES: ${scored.cycles.join(', ')} — this split would need circular imports. Cut elsewhere.`
      : '  no cycles: this split is structurally viable.');
  }
}

if (isMainModule(import.meta.url)) main();
