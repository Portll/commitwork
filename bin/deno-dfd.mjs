#!/usr/bin/env node
// bin/deno-dfd.mjs — data-flow diagrams and sink-to-source mutability for Deno code.
//
// usage: node bin/deno-dfd.mjs --root <repo> --sarif <lane.sarif> [--sarif <codeql.sarif> …]
//                              [--inventory <inventory.json>] --out <prefix> [--annotate]
//   writes <prefix>.json (the graph and every path's evaluation) and <prefix>.md (Mermaid).
//   --annotate rewrites each --sarif in place, adding properties.cwMutability to every result
//   that carries a codeFlow, so the verdict travels with the finding into the lane's rows.
// exit: 0 written (an empty diagram is a diagram) · 1 an input could not be read · 2 usage
//
// TWO DIAGRAMS IN ONE.
//   1. The program's DFD, from manifests/semgrep-deno-inventory/: external entities (HTTP peers,
//      WebSocket peers, the command line, the environment, the KV queue) on the far side of a
//      trust boundary; one process per module that touches any of them; data stores (Deno KV,
//      the file system, SQL); external processes (outbound HTTP, child processes, native
//      libraries, dynamically loaded code). This exists whether or not anything is wrong.
//   2. Every taint path a lane found, drawn over (1) hop by hop: source → propagators → sink.
//
// SINK-TO-SOURCE MUTABILITY. A path says data CAN arrive; it does not say how much of it the
// sender still controls when it does. This walks each path BACKWARDS from the sink and classifies
// what every hop does to the value — passes it through, embeds it in a larger string, parses it
// into a structure, coerces it to a number, checks it against an allowlist, runs it through an
// encoder — and names the hop nearest the sink that bounds the sender's control. That hop is the
// verdict's evidence, and the remediation point.
//
//   control (what the sender holds at the sink, strongest first):
//     full        the whole value                      — no hop constrains it
//     substring   part of a larger string              — template / concatenation, no constraint
//     structured  the shape of an object               — JSON / form parsing, no constraint
//     filtered    a value past a blocklist-style edit  — replace/trim/case change: bypassable
//     mismatched  a value past an encoder for another context (encodeURIComponent before SQL)
//     host-pinned the path/query of a URL whose scheme and host are literal (SSRF sinks only)
//     numeric     a number                             — parseInt/Number/parseFloat
//     allowlisted one of a fixed set                   — includes/has/=== literal guard
//     sanitized   a value through the sink's own neutraliser (escape() before HTML, basename()
//                 before a path)
//
//   Classification reads the SOURCE LINE of each hop, not the engine's word for it. It is a
//   heuristic over text and says so: every hop records the expression it judged and the class
//   it gave, so a reader can disagree with a specific step rather than with a score.
//
// Zero dependencies. Reads only the files named; never runs the code it describes.

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { readSarif } from '../monitor/sarif-read.mjs';
import { isMainModule } from '../lib/is-main.mjs';

// ── classification tables ───────────────────────────────────────────────────────────────────────
// Sink classes come from each rule's metadata.dfd.sink where the rule declares one (the Deno
// packs do), else from the rule id. CodeQL ids are mapped by their query name.
const SINK_OF_RULE = [
  [/command|shell|exec/i, 'command'], [/argument-injection/i, 'command-argument'],
  [/code-injection|code-load|unsafe-dynamic-method|eval/i, 'code-load'], [/native|dlopen|ffi/i, 'native-load'],
  [/path|traversal|tainted-path|zipslip/i, 'file-system'], [/ssrf|request-forgery/i, 'network'],
  [/xss|html|reflected/i, 'html'], [/redirect/i, 'redirect'], [/sql/i, 'sql'],
  [/env-poison/i, 'environment'], [/disclosure|exposure/i, 'response'], [/regex|redos/i, 'regex'],
];

// What neutralises the sender's control for EACH sink class. A neutraliser for one class is not
// one for another, which is the whole point of the `mismatched` class.
const NEUTRALISERS = {
  html: [/\bescape(Html)?\s*\(/, /\bsanitize(Html)?\s*\(/, /DOMPurify\.sanitize\s*\(/],
  'file-system': [/\bbasename\s*\(/],
  sql: [],                                                     // only parameters neutralise SQL
  command: [],                                                 // only argv neutralises a shell
  'command-argument': [/["'`]--["'`]/],
  regex: [/\bescape\s*\(/, /escapeRegExp\s*\(/],
  redirect: [/^\s*["'`]\//],
  network: [],
  'code-load': [],
  'native-load': [],
  environment: [],
  response: [],
};
const ENCODERS = [/encodeURIComponent\s*\(/, /encodeURI\s*\(/, /\bbtoa\s*\(/, /JSON\.stringify\s*\(/];
const COERCIONS = [/\bparseInt\s*\(/, /\bparseFloat\s*\(/, /\bNumber\s*\(/, /\bMath\.(floor|ceil|round|trunc)\s*\(/, /\bBigInt\s*\(/];
const PARSERS = [/JSON\.parse\s*\(/, /\.json\s*\(\s*\)/, /\.formData\s*\(\s*\)/, /\.parseBody\s*\(/];
const FILTERS = [/\.replace(All)?\s*\(/, /\.trim(Start|End)?\s*\(/, /\.to(Lower|Upper)Case\s*\(/, /\.normalize\s*\(/, /\.slice\s*\(/, /\.substring\s*\(/];
const GUARDS = (v) => [
  new RegExp(`\\.(includes|has)\\s*\\(\\s*${v}\\s*\\)`),
  new RegExp(`\\b${v}\\s*(===|!==)\\s*["'\`]`),
  new RegExp(`["'\`]\\s*(===|!==)\\s*${v}\\b`),
  new RegExp(`/\\^[^/]*\\$/[a-z]*\\.test\\s*\\(\\s*${v}\\s*\\)`),
];

const RANK = ['sanitized', 'allowlisted', 'numeric', 'host-pinned', 'mismatched', 'filtered', 'structured', 'substring', 'full'];
const RESIDUAL = {
  full: 'high', substring: 'high', structured: 'high', filtered: 'medium', mismatched: 'medium',
  'host-pinned': 'medium', numeric: 'low', allowlisted: 'low', sanitized: 'low',
};
// Substring control is as good as full control wherever the sink PARSES the string.
const SUBSTRING_SUFFICES = new Set(['command', 'sql', 'html', 'code-load', 'regex', 'file-system', 'redirect', 'environment']);

// ── reading a SARIF path ────────────────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const uriOf = (loc) => String(loc?.physicalLocation?.artifactLocation?.uri || '').replace(/^file:\/\/\/?/, '');
const regionOf = (loc) => loc?.physicalLocation?.region || {};

/** Hops of a result's first threadFlow, source first, with the engine's role word where it gave one. */
export function hopsOf(result) {
  const locs = result?.codeFlows?.[0]?.threadFlows?.[0]?.locations;
  if (!Array.isArray(locs) || !locs.length) return null;
  return locs.map((l, i) => {
    const loc = l.location || {};
    const msg = String(loc.message?.text || regionOf(loc).message?.text || '');
    const role = /^Source\b/.test(msg) ? 'source' : /^Sink\b/.test(msg) ? 'sink' : /^Propagator\b/.test(msg) ? 'propagator'
      : i === 0 ? 'source' : i === locs.length - 1 ? 'sink' : 'propagator';
    const r = regionOf(loc);
    return {
      role, file: uriOf(loc), line: Number(r.startLine) || 0, col: Number(r.startColumn) || 0,
      snippet: String(r.snippet?.text || msg.replace(/^[A-Za-z ]+:\s*'?/, '').replace(/'?\s*@.*$/, '')).trim(),
    };
  });
}

export function sinkClassOf(ruleId, rule) {
  const declared = rule?.properties?.dfd?.sink || rule?.properties?.metadata?.dfd?.sink;
  if (declared) return declared;
  for (const [rx, cls] of SINK_OF_RULE) if (rx.test(String(ruleId || ''))) return cls;
  return 'unknown';
}

// ── classifying one hop ─────────────────────────────────────────────────────────────────────────
function lineAt(lines, n) { return n > 0 && n <= lines.length ? lines[n - 1] : ''; }

/** What the statement at this hop does to the upstream value. Returns {op, control, why}. */
export function classifyHop(hop, upstream, sinkClass, lines) {
  const text = lineAt(lines, hop.line);
  const name = /^[A-Za-z_$][\w$]*$/.test(hop.snippet) ? hop.snippet : null;
  // The expression that produces this hop's value: the RHS when the hop is a binding, else the hop.
  const m = name && text.match(new RegExp(`\\b${esc(name)}\\s*(?::[^=]+)?=(?!=)\\s*(.+?);?\\s*$`));
  const expr = m ? m[1] : hop.snippet;
  const has = (rxs) => rxs.some((rx) => rx.test(expr));

  if (hop.role === 'source') return { op: 'source', control: 'full', expr, why: 'the sender supplies this value' };
  const neutral = NEUTRALISERS[sinkClass] || [];
  if (neutral.length && neutral.some((rx) => rx.test(expr))) return { op: 'neutraliser', control: 'sanitized', expr, why: `neutraliser for a ${sinkClass} sink` };
  if (has(COERCIONS)) return { op: 'coercion', control: 'numeric', expr, why: 'coerced to a number' };
  if (has(ENCODERS)) {
    const fits = sinkClass === 'html' || sinkClass === 'redirect' || sinkClass === 'network';
    return { op: 'encoder', control: fits ? 'sanitized' : 'mismatched', expr,
      why: fits ? 'encoded for a URL/markup context' : `an encoder that does not neutralise a ${sinkClass} sink` };
  }
  if (has(PARSERS)) return { op: 'parse', control: 'structured', expr, why: 'parsed into a structure the sender shapes' };
  if (has(FILTERS)) return { op: 'filter', control: 'filtered', expr, why: 'edited, not validated — blocklist-style transforms are bypassable' };
  if (/`[^`]*\$\{/.test(expr) || /["'`]\s*\+|\+\s*["'`]/.test(expr)) return { op: 'embed', control: 'substring', expr, why: 'embedded in a larger string' };
  return { op: 'passthrough', control: 'full', expr, why: 'passed through unchanged' };
}

/** A guard between `fromLine` and `toLine` that compares `name` to a fixed set and leaves early. */
function guardBetween(lines, name, fromLine, toLine) {
  if (!name) return null;
  const rxs = GUARDS(esc(name));
  for (let n = Math.max(1, fromLine); n < toLine && n <= lines.length; n++) {
    const t = lines[n - 1];
    if (rxs.some((rx) => rx.test(t)) && /\b(return|throw)\b/.test(t + (lines[n] || ''))) return { line: n, text: t.trim() };
  }
  return null;
}

/** The sink hop itself: is the value the whole argument, part of a string, or a URL with a fixed host? */
function classifySink(sink, upstreamName, sinkClass) {
  const s = sink.snippet;
  if (sinkClass === 'network' && /^`(https?|wss?):\/\/[^/$`]+\//.test(s)) return { op: 'sink', control: 'host-pinned', expr: s, why: 'scheme and host are literal; the sender chooses only path and query' };
  if (/`[^`]*\$\{/.test(s) || /["'`]\s*\+|\+\s*["'`]/.test(s)) return { op: 'sink', control: 'substring', expr: s, why: 'the value is embedded in the string the sink parses' };
  return { op: 'sink', control: 'full', expr: s, why: 'the value is the sink argument' };
}

/** The full evaluation of one path, walked from the sink back to the source. */
export function evaluatePath(hops, sinkClass, readLines) {
  const ordered = hops.slice().reverse();                              // sink first
  const evaluated = [];
  let bound = null;
  for (let i = 0; i < ordered.length; i++) {
    const hop = ordered[i];
    const lines = readLines(hop.file);
    const upstream = ordered[i + 1] || null;
    const c = hop.role === 'sink' ? classifySink(hop, upstream?.snippet, sinkClass) : classifyHop(hop, upstream, sinkClass, lines);
    // A guard on this hop's variable that sits between it and the sink outranks what the hop
    // itself does: the value reaching the sink has passed the check.
    const name = /^[A-Za-z_$][\w$]*$/.test(hop.snippet) ? hop.snippet : null;
    const sinkLine = ordered[0].file === hop.file ? ordered[0].line : hop.line + 50;
    const g = hop.role !== 'sink' ? guardBetween(lines, name, hop.line, sinkLine) : null;
    const cls = g ? { op: 'guard', control: 'allowlisted', expr: g.text, why: `checked against a fixed set at line ${g.line} before the sink` } : c;
    evaluated.push({ ...hop, ...cls });
    if (!bound && RANK.indexOf(cls.control) < RANK.indexOf('substring')) bound = { ...hop, ...cls };
  }
  // Control at the sink: the most constraining class anywhere on the path, except that a
  // substring at the sink keeps full force for sinks that parse their input.
  let control = 'full';
  for (const h of evaluated) if (RANK.indexOf(h.control) < RANK.indexOf(control)) control = h.control;
  const sinkCtl = evaluated[0].control;
  if (control === 'full' && sinkCtl === 'substring') control = 'substring';
  if (control === 'substring' && SUBSTRING_SUFFICES.has(sinkClass)) control = 'substring';
  return {
    sinkClass, control, residual: RESIDUAL[control] || 'high',
    boundingHop: bound ? { file: bound.file, line: bound.line, op: bound.op, expr: bound.expr, why: bound.why } : null,
    hops: evaluated.map(({ role, file, line, snippet, op, control: ctl, expr, why }) => ({ role, file, line, snippet, op, control: ctl, expr, why })),
    remediation: remediationFor(sinkClass, control, bound),
  };
}

const FIX = {
  command: 'run a fixed program and pass the value as one element of `args`; never through sh -c',
  'command-argument': 'put "--" before positional values, or refuse values beginning with "-"',
  'code-load': 'map the input to a fixed table of module specifiers; never import() a value',
  'native-load': 'load a fixed library path shipped with the program',
  'file-system': 'resolve against the root and refuse unless relative(root, p) stays inside it, or take basename()',
  network: 'parse with new URL() and compare hostname to an allowlist; scope --allow-net to those hosts',
  html: 'escape() from @std/html at the point of output',
  redirect: 'redirect only to relative paths or allowlisted hosts',
  sql: 'tagged-template query or the parameter array',
  environment: 'pass per-request values through Deno.Command\'s env option, not Deno.env.set',
  response: 'return named non-secret fields, never the environment object',
  regex: 'escape() from @std/regexp, or compare as a plain string',
};

function remediationFor(sinkClass, control, bound) {
  const fix = FIX[sinkClass] || 'constrain the value to what the sink can safely accept';
  if (control === 'sanitized' || control === 'allowlisted' || control === 'numeric') {
    return `Bounded at ${bound.file}:${bound.line} (${bound.op}). Confirm the bound dominates every route to the sink; otherwise ${fix}.`;
  }
  if (control === 'mismatched') return `The encoder at ${bound.file}:${bound.line} is for another context and does not protect a ${sinkClass} sink: ${fix}.`;
  if (control === 'filtered') return `The edit at ${bound.file}:${bound.line} is a filter, not a validator, and is bypassable: ${fix}.`;
  if (control === 'host-pinned') return `Host is fixed; the sender still chooses path and query — encode the segment with encodeURIComponent and keep the host literal. Fix at the sink if the API has privileged paths.`;
  return `Fix at the sink (it covers every source that reaches it): ${fix}.`;
}

// ── the program DFD from the inventory ──────────────────────────────────────────────────────────
/** Inventory JSON (opengrep --json over manifests/semgrep-deno-inventory) → {nodes, edges}. */
export function programGraph(inventory) {
  const nodes = new Map(); const edges = new Map();
  const node = (id, n) => { if (!nodes.has(id)) nodes.set(id, { id, ...n, sites: [] }); return nodes.get(id); };
  const edge = (from, to, label) => { const k = `${from}>${to}>${label}`; if (!edges.has(k)) edges.set(k, { from, to, label, count: 0 }); edges.get(k).count++; };
  // opengrep's JSON, not SARIF. An inventory that was not read gives an EMPTY graph marked read:false
  // — a program with no entry points and a scan that never ran must not look alike.
  const items = inventory && Array.isArray(inventory.results) ? inventory.results : null;
  if (!items) return { nodes: [], edges: [], read: false };
  for (const r of items) {
    const d = r.extra?.metadata?.dfd; if (!d) continue;
    const file = String(r.path || '').replace(/^\.\//, '');
    const proc = node(`proc:${file}`, { kind: 'process', label: file });
    const site = { file, line: r.start?.line || 0 };
    if (d.role === 'entry') {
      const n = node(`ext:${d.kind}`, { kind: 'external', trust: d.trust || 'external', label: d.label || d.kind });
      n.sites.push(site); edge(n.id, proc.id, d.kind);
    } else if (d.role === 'store') {
      const n = node(`store:${d.kind}`, { kind: 'store', label: d.label || d.kind });
      n.sites.push(site);
      const writes = /write|create|remove|mkdir|rename|copy|truncate|symlink/i.test(r.check_id || '') || /write/i.test(r.extra?.message || '');
      if (d.kind === 'kv' || d.kind === 'sql') { edge(proc.id, n.id, 'read/write'); }
      else edge(writes ? proc.id : n.id, writes ? n.id : proc.id, writes ? 'write' : 'read');
    } else {
      const n = node(`out:${d.kind}`, { kind: d.role === 'exec' ? 'exec' : 'egress', label: d.label || d.kind });
      n.sites.push(site); edge(proc.id, n.id, d.kind);
    }
    proc.sites.push(site);
  }
  for (const n of nodes.values()) {
    const seen = new Set(); n.sites = n.sites.filter((s) => { const k = `${s.file}:${s.line}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 50);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], read: true };
}

// ── Mermaid ─────────────────────────────────────────────────────────────────────────────────────
const mid = (s) => s.replace(/[^A-Za-z0-9_]/g, '_');
// Markdown table cells: pipes escaped, length bounded. NOT mlabel — its #quot; entities are Mermaid's.
const mdcell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 120);
const mlabel = (s) => String(s).replace(/"/g, '#quot;').replace(/[<>]/g, (c) => (c === '<' ? '#lt;' : '#gt;')).slice(0, 80);

/**
 * The drawn graph: processes collapsed to the deepest directory level with at most `max` groups.
 * A repository of 231 modules (measured: audience-direct) is not a diagram anyone reads; the JSON
 * keeps every module, and the drawing says what it collapsed.
 */
export function collapseProcesses(g, max = 40) {
  const procs = g.nodes.filter((n) => n.kind === 'process');
  if (procs.length <= max) return { graph: g, depth: null };
  const segs = (id) => id.slice('proc:'.length).split('/').slice(0, -1);
  const deepest = Math.max(1, ...procs.map((n) => segs(n.id).length));
  let depth = 1;
  for (let d = deepest; d >= 1; d--) {
    if (new Set(procs.map((n) => segs(n.id).slice(0, d).join('/') || '.')).size <= max) { depth = d; break; }
  }
  const groupOf = (id) => (id.startsWith('proc:') ? `proc:${segs(id).slice(0, depth).join('/') || '.'}/` : id);
  const nodes = new Map();
  for (const n of g.nodes) {
    const id = groupOf(n.id);
    if (!nodes.has(id)) nodes.set(id, n.kind === 'process' ? { id, kind: 'process', label: `${id.slice(5)} (modules)`, sites: [] } : n);
  }
  const edges = new Map();
  for (const e of g.edges) {
    const from = groupOf(e.from); const to = groupOf(e.to); const k = `${from}>${to}>${e.label}`;
    if (!edges.has(k)) edges.set(k, { from, to, label: e.label, count: 0 });
    edges.get(k).count += e.count;
  }
  return { graph: { nodes: [...nodes.values()], edges: [...edges.values()] }, depth };
}

export function mermaidProgram(full) {
  const { graph: g } = collapseProcesses(full);
  const out = ['flowchart LR'];
  const by = (k) => g.nodes.filter((n) => n.kind === k);
  const ext = by('external');
  for (const [trust, title] of [['external', 'Untrusted — network'], ['local', 'Host — operator and environment'], ['internal', 'Internal triggers']]) {
    const xs = ext.filter((n) => (n.trust || 'external') === trust);
    if (!xs.length) continue;
    out.push(`  subgraph TB_${trust}["${title}"]`);
    for (const n of xs) out.push(`    ${mid(n.id)}[/"${mlabel(n.label)}"/]`);
    out.push('  end');
  }
  out.push('  subgraph DENO["Deno process — bounded by its --allow-* grants"]');
  for (const n of by('process')) out.push(`    ${mid(n.id)}(("${mlabel(n.label)}"))`);
  out.push('  end');
  for (const n of by('store')) out.push(`  ${mid(n.id)}[("${mlabel(n.label)}")]`);
  for (const n of [...by('egress'), ...by('exec')]) out.push(`  ${mid(n.id)}[["${mlabel(n.label)}"]]`);
  for (const e of g.edges) out.push(`  ${mid(e.from)} -->|"${mlabel(e.label)}"| ${mid(e.to)}`);
  return out.join('\n');
}

export function mermaidPath(id, finding) {
  const out = [`flowchart LR`];
  const hops = finding.evaluation.hops.slice().reverse();               // source first for reading
  hops.forEach((h, i) => {
    const shape = h.role === 'source' ? ['[/', '/]'] : h.role === 'sink' ? ['[[', ']]'] : ['(', ')'];
    out.push(`  ${id}_${i}${shape[0]}"${mlabel(`${h.file}:${h.line} ${h.snippet}`)}<br/>${mlabel(`${h.op} → ${h.control}`)}"${shape[1]}`);
    if (i) out.push(`  ${id}_${i - 1} --> ${id}_${i}`);
  });
  const b = finding.evaluation.boundingHop;
  if (b) {
    const i = hops.findIndex((h) => h.file === b.file && h.line === b.line && h.op === b.op);
    if (i >= 0) out.push(`  style ${id}_${i} stroke-width:3px`);
  }
  return out.join('\n');
}

// ── the whole run ───────────────────────────────────────────────────────────────────────────────
/**
 * `sarifDocs` must already have been classified `ok` by monitor/sarif-read.mjs readSarif (main() and
 * bin/deno-sast.mjs both do): runs and results are then read bare, so a husk throws rather than
 * reading as a scan with no paths.
 */
export function buildReport({ root, sarifDocs, inventory }) {
  const cache = new Map();
  const readLines = (file) => {
    if (!cache.has(file)) {
      const p = resolve(root, file);
      let t = ''; try { t = readFileSync(p, 'utf8'); } catch { t = ''; }
      cache.set(file, t.split('\n'));
    }
    return cache.get(file);
  };
  const findings = [];
  for (const { path, doc } of sarifDocs) {
    for (const run of doc.runs) {
      const rules = new Map((run.tool?.driver?.rules ?? []).map((r) => [r.id, r]));
      for (const res of run.results) {
        const hops = hopsOf(res);
        if (!hops) continue;
        const sinkClass = sinkClassOf(res.ruleId, rules.get(res.ruleId));
        const evaluation = evaluatePath(hops, sinkClass, readLines);
        const id = `F${findings.length + 1}`;
        res.properties = { ...(res.properties || {}), cwMutability: { flow: id, control: evaluation.control, residual: evaluation.residual, boundingHop: evaluation.boundingHop, sinkClass } };
        findings.push({ id, sarif: path, rule: res.ruleId, level: res.level || 'warning', file: hops[hops.length - 1].file, line: hops[hops.length - 1].line, evaluation });
      }
    }
  }
  const program = programGraph(inventory);
  const byControl = {};
  for (const f of findings) byControl[f.evaluation.control] = (byControl[f.evaluation.control] || 0) + 1;
  return { schema: 'commitwork.deno-dfd/1', program, inventoryRead: program.read, findings, summary: { paths: findings.length, byControl, nodes: program.nodes.length, edges: program.edges.length } };
}

export function markdownOf(report) {
  const L = ['# Deno data-flow diagram', '',
    `${report.summary.nodes} nodes, ${report.summary.edges} edges; ${report.summary.paths} taint path(s) evaluated sink-to-source.`, '',
    '## Program', '', ...(() => {
      const c = collapseProcesses(report.program);
      return c.depth === null ? [] : [`${report.program.nodes.filter((n) => n.kind === 'process').length} modules drawn as directories ${c.depth} level(s) deep; every module is in the JSON report.`, ''];
    })(), '```mermaid', mermaidProgram(report.program), '```', ''];
  if (report.findings.length) {
    L.push('## Paths, most controlled first', '', '| Flow | Rule | Sink | Control at sink | Residual | Bounded at |', '|---|---|---|---|---|---|');
    const order = (f) => RANK.length - RANK.indexOf(f.evaluation.control);
    const fs = report.findings.slice().sort((a, b) => order(a) - order(b) || a.file.localeCompare(b.file) || a.line - b.line);
    for (const f of fs) {
      const b = f.evaluation.boundingHop;
      L.push(`| ${f.id} | \`${String(f.rule).split('.').pop()}\` | ${f.evaluation.sinkClass} \`${f.file}:${f.line}\` | **${f.evaluation.control}** | ${f.evaluation.residual} | ${b ? `\`${b.file}:${b.line}\` ${b.op}` : '—'} |`);
    }
    L.push('');
    for (const f of fs.slice(0, 40)) {
      L.push(`### ${f.id} — ${String(f.rule).split('.').pop()} (${f.evaluation.control})`, '', '```mermaid', mermaidPath(f.id, f), '```', '',
        '| Hop (sink first) | Op | Control | Why |', '|---|---|---|---|');
      for (const h of f.evaluation.hops) L.push(`| ${h.role} \`${h.file}:${h.line}\` \`${mdcell(h.snippet)}\` | ${h.op} | ${h.control} | ${mdcell(h.why)} |`);
      L.push('', `**Remediation:** ${f.evaluation.remediation}`, '');
    }
    if (fs.length > 40) L.push(`_${fs.length - 40} further path(s) are in the JSON report._`, '');
  }
  return L.join('\n');
}

function main(argv) {
  const a = { sarif: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--root') a.root = argv[++i];
    else if (k === '--sarif') a.sarif.push(argv[++i]);
    else if (k === '--inventory') a.inventory = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--annotate') a.annotate = true;
    else { process.stderr.write(`deno-dfd: unknown argument ${k}\n`); return 2; }
  }
  if (!a.root || !a.out || !a.sarif.length) { process.stderr.write('usage: deno-dfd.mjs --root <repo> --sarif <file> [--sarif …] [--inventory <json>] --out <prefix> [--annotate]\n'); return 2; }
  const sarifDocs = []; const inputs = [];
  for (const p of a.sarif) {
    const rec = readSarif(p);
    inputs.push({ path: p, state: rec.state, reason: rec.reason || null });
    if (rec.state === 'absent') continue;                              // a lane that did not run: recorded, not an error
    if (rec.state !== 'ok') { process.stderr.write(`deno-dfd: ${p} is ${rec.state}: ${rec.reason}\n`); return 1; }
    sarifDocs.push({ path: p, doc: JSON.parse(readFileSync(p, 'utf8')) });
  }
  let inventory = null;
  if (a.inventory && existsSync(a.inventory)) {
    try { inventory = JSON.parse(readFileSync(a.inventory, 'utf8')); }
    catch (e) { process.stderr.write(`deno-dfd: ${a.inventory} is not readable JSON (${e.message})\n`); return 1; }
  }
  const report = buildReport({ root: a.root, sarifDocs, inventory });
  report.inputs = inputs;
  writeAtomic(`${a.out}.json`, JSON.stringify(report, null, 1) + '\n');
  writeAtomic(`${a.out}.md`, markdownOf(report) + '\n');
  if (a.annotate) for (const { path, doc } of sarifDocs) writeAtomic(path, JSON.stringify(doc) + '\n');
  process.stderr.write(`deno-dfd: ${report.summary.paths} path(s), ${report.summary.nodes} node(s) → ${a.out}.{json,md}\n`);
  return 0;
}

if (isMainModule(import.meta.url)) process.exitCode = main(process.argv.slice(2));
