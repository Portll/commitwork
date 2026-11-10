#!/usr/bin/env node
// usage: wp-posture.mjs [rootDir] [--db <dump.sql|.gz>] [--no-db] [--catalogue <file>]   (default '.')
// exit: 0 ran · 2 could not run
// env, read at call time: CW_WP_DB (dump path; `none` disables the join), CW_WP_POSTURE_CATALOGUE
//   (catalogue path, default manifests/wp-weakness-catalogue.json), CW_WP_SKIP_DIRS (comma list of
//   directory names or a/b paths; default
//   .git,node_modules,.claude/worktrees,fixtures/scan-canary/dirty — every skip is listed),
//   CW_WP_MAX_DEPTH (how deep an install is looked for, default 4), CW_NOW (pins `asOf` for audit windows)
// output: {tool, summary:{findings, byRule, installs, catalogue, measured, unmeasured, sources, passed,
//   notMeasured, notApplicable, truncated, partial?, partialReasons?, voidReason?}, findings[]}
//   rule ids, paths, slugs, versions, option KEYS, user ids and counts only — never an option value,
//   a hash, an email address or file contents.
//
// Which of the ways WordPress sites get taken are open on this one? Not "is this file malicious"
// (webshell-detect), not "is this the code wordpress.org shipped" (wp-integrity), not "is this
// version advised against" (wp-advisories), but the configuration state that turns one of those
// into a breach: secrets in the options table, logs and backups under the served tree, an inactive
// security plugin, a database console an administrator can reach, an audit log that covers six weeks
// of a two-year-old site. Every check is an entry in manifests/wp-weakness-catalogue.json, a predicate
// over the rows bin/lib/wp-observables.mjs reads from the tree and, when one is beside it, the
// database dump; adding a weakness is adding an entry.
//
// Local-first, no network, no credentials, nothing executed: it reads a backup or a checkout. A type
// that could not be read (no dump: options, users, audit tables; no wp-config.php: server directives)
// makes every entry over it NOT MEASURED, listed by name, never a pass. An entry whose precondition
// has no match is not applicable. Passed entries are listed too, so the reader can see what WAS checked.
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { collectObservables, TYPES } from './lib/wp-observables.mjs';

export const TOOL = 'wp-posture';
export const VERBS = Object.freeze(['exists', 'absent', 'count-gt', 'count-lt']);
export const SEVERITIES = Object.freeze(['crit', 'high', 'med', 'low']);
const OPS = new Set(['neq', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'contains', 'notContains', 'startsWith', 'endsWith', 'regex', 'exists']);
const DEFAULT_SKIP = ['.git', 'node_modules', '.claude/worktrees', 'fixtures/scan-canary/dirty'];
const ROW_CAP = 50;
const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CATALOGUE = join(HERE, '..', 'manifests', 'wp-weakness-catalogue.json');

export const skipDirs = () => new Set((process.env.CW_WP_SKIP_DIRS ?? DEFAULT_SKIP.join(',')).split(',').map((s) => s.trim()).filter(Boolean));
const maxDepth = () => { const n = Number(process.env.CW_WP_MAX_DEPTH); return Number.isInteger(n) && n >= 0 ? n : 4; };

/** Field condition: scalar equality, list membership, or an operator object. */
export function fieldMatches(value, cond) {
  if (Array.isArray(cond)) return cond.includes(value);
  if (cond === null || typeof cond !== 'object') return value === cond;
  for (const [op, arg] of Object.entries(cond)) {
    switch (op) {
      case 'neq': if (value === arg) return false; break;
      case 'in': if (!arg.includes(value)) return false; break;
      case 'notIn': if (arg.includes(value)) return false; break;
      case 'gt': if (!(typeof value === 'number' && value > arg)) return false; break;
      case 'gte': if (!(typeof value === 'number' && value >= arg)) return false; break;
      case 'lt': if (!(typeof value === 'number' && value < arg)) return false; break;
      case 'lte': if (!(typeof value === 'number' && value <= arg)) return false; break;
      case 'contains': if (!(Array.isArray(value) ? value.includes(arg) : typeof value === 'string' && value.includes(arg))) return false; break;
      case 'notContains': if (Array.isArray(value) ? value.includes(arg) : typeof value === 'string' && value.includes(arg)) return false; break;
      case 'startsWith': if (!(typeof value === 'string' && value.startsWith(arg))) return false; break;
      case 'endsWith': if (!(typeof value === 'string' && value.endsWith(arg))) return false; break;
      case 'regex': if (!new RegExp(arg).test(value == null ? '' : String(value))) return false; break;
      case 'exists': if ((value !== undefined && value !== null) !== arg) return false; break;
      default: throw new Error(`unknown operator '${op}'`);
    }
  }
  return true;
}
export const rowMatches = (row, where) => Object.entries(where || {}).every(([k, cond]) => fieldMatches(row[k], cond));

/** Validate a catalogue; returns { entries, invalid:[{id, why}] }. Unknown verbs, ops and types are refused, not defaulted. */
export function loadCatalogue(path) {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(doc.entries)) throw new Error('catalogue has no entries[]');
  const invalid = [];
  const ids = new Set();
  const entries = [];
  const checkWhere = (where, at) => {
    for (const [k, cond] of Object.entries(where || {})) {
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) for (const op of Object.keys(cond)) if (!OPS.has(op)) throw new Error(`${at}.${k}: unknown operator '${op}'`);
      if (cond && typeof cond === 'object' && !Array.isArray(cond) && 'regex' in cond) new RegExp(cond.regex);
    }
  };
  for (const e of doc.entries) {
    const id = String(e?.id || '');
    try {
      if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(id)) throw new Error('id must be a kebab-case slug');
      if (ids.has(id)) throw new Error('duplicate id');
      if (!SEVERITIES.includes(e.sev)) throw new Error(`sev must be one of ${SEVERITIES.join(', ')}`);
      if (!/^CWE-\d+$/.test(String(e.cwe || ''))) throw new Error('cwe must be CWE-<n>');
      const p = e.predicate || {};
      if (!VERBS.includes(p.verb)) throw new Error(`verb must be one of ${VERBS.join(', ')}`);
      if (!TYPES.includes(p.type)) throw new Error(`type must be one of ${TYPES.join(', ')}`);
      checkWhere(p.where, 'where');
      if ((p.verb === 'count-gt' || p.verb === 'count-lt') && !Number.isFinite(p.than)) throw new Error('count verbs need a numeric `than`');
      if (p.given) { if (!TYPES.includes(p.given.type)) throw new Error('given.type must be an observable type'); checkWhere(p.given.where, 'given.where'); }
      for (const r of e.enables || []) if (!doc.routes || !(r in doc.routes)) throw new Error(`enables names unknown route '${r}'`);
      if (typeof e.detail !== 'string' || !e.detail) throw new Error('detail template required');
      ids.add(id);
      entries.push(e);
    } catch (err) { invalid.push({ id: id || '(no id)', why: err.message }); }
  }
  return { path, name: doc.name || null, routes: doc.routes || {}, componentClasses: doc.componentClasses || {}, entries, invalid };
}

const render = (template, row, extra = {}) => template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => {
  const v = k in extra ? extra[k] : row?.[k];
  if (v === undefined || v === null || v === '') return '?';
  if (Array.isArray(v)) return v.length ? v.slice(0, 5).join(', ') + (v.length > 5 ? `, +${v.length - 5}` : '') : 'none';
  return String(v);
});

/** Evaluate every entry over the corpus. Pure. */
export function evaluate(catalogue, corpus) {
  const findings = [];
  const passed = [];
  const notMeasured = [];
  const notApplicable = [];
  let truncated = 0;
  const byType = new Map();
  for (const o of corpus.observables) { if (!byType.has(o.type)) byType.set(o.type, []); byType.get(o.type).push(o); }
  const rowsOf = (type, where) => (byType.get(type) || []).filter((r) => rowMatches(r, where));
  const whyUnmeasured = (type) => corpus.unmeasured.find((u) => u.type === type)?.why || 'not measured';
  const installPath = corpus.installs[0]?.path || '.';
  const add = (e, path, row, extra) => findings.push({ rule: e.id, path, sev: e.sev, cwe: e.cwe, detail: render(e.detail, row, extra), name: e.name, enables: [...(e.enables || [])], course: e.course || null });

  for (const e of catalogue.entries) {
    const p = e.predicate;
    if (!corpus.measured.has(p.type)) { notMeasured.push({ rule: e.id, why: `${p.type}: ${whyUnmeasured(p.type)}` }); continue; }
    let givenRow = null;
    if (p.given) {
      if (!corpus.measured.has(p.given.type)) { notMeasured.push({ rule: e.id, why: `precondition ${p.given.type}: ${whyUnmeasured(p.given.type)}` }); continue; }
      const g = rowsOf(p.given.type, p.given.where);
      if (!g.length) { notApplicable.push({ rule: e.id, why: `no ${p.given.type} row matches the precondition` }); continue; }
      givenRow = g[0];
    }
    const matches = rowsOf(p.type, p.where);
    if (p.verb === 'exists') {
      if (!matches.length) { passed.push({ rule: e.id, name: e.name }); continue; }
      const kept = matches.slice(0, ROW_CAP);
      truncated += matches.length - kept.length;
      for (const m of kept) add(e, m.path || givenRow?.path || installPath, m, { count: matches.length });
      continue;
    }
    if (p.verb === 'absent') {
      if (matches.length) { passed.push({ rule: e.id, name: e.name }); continue; }
      add(e, givenRow?.path || installPath, givenRow || {}, { count: 0 });
      continue;
    }
    const n = matches.length;
    const fires = p.verb === 'count-gt' ? n > p.than : n < p.than;
    if (!fires) { passed.push({ rule: e.id, name: e.name }); continue; }
    add(e, givenRow?.path || installPath, matches[0] || {}, { count: n, than: p.than });
  }
  const order = (a, b) => (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  findings.sort(order);
  for (const l of [passed, notMeasured, notApplicable]) l.sort((a, b) => (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
  return { findings, passed, notMeasured, notApplicable, truncated };
}

export async function scanTree(root, { dbPath, cataloguePath = process.env.CW_WP_POSTURE_CATALOGUE || DEFAULT_CATALOGUE, now } = {}) {
  const catalogue = loadCatalogue(cataloguePath);
  const skip = skipDirs();
  const pinned = now || (process.env.CW_NOW ? new Date(process.env.CW_NOW) : null);
  const corpus = await collectObservables(root, { dbPath, skip, maxDepth: maxDepth(), classes: catalogue.componentClasses, now: pinned && !Number.isNaN(pinned.getTime()) ? pinned : null });
  const r = evaluate(catalogue, corpus);
  const byRule = {};
  for (const f of r.findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  const partial = [...corpus.partial];
  if (catalogue.invalid.length) partial.push(`${catalogue.invalid.length} catalogue entr(ies) invalid and skipped`);
  const counts = {};
  for (const o of corpus.observables) counts[o.type] = (counts[o.type] || 0) + 1;
  const summary = {
    findings: r.findings.length,
    byRule: Object.fromEntries(Object.entries(byRule).sort(([a], [b]) => (a < b ? -1 : 1))),
    installs: corpus.installs.map((i) => ({ path: i.path, layout: i.layout, core: i.core, coreVersion: i.coreVersion })),
    catalogue: { path: cataloguePath, name: catalogue.name, entries: catalogue.entries.length + catalogue.invalid.length, evaluated: catalogue.entries.length - r.notMeasured.length - r.notApplicable.length, findings: r.findings.length, passed: r.passed.length, notMeasured: r.notMeasured.length, notApplicable: r.notApplicable.length, invalid: catalogue.invalid },
    measured: [...corpus.measured].sort(),
    observables: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1))),
    unmeasured: corpus.unmeasured.slice().sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0)),
    sources: { tree: corpus.sources.tree, db: corpus.sources.db },
    passed: r.passed,
    notMeasured: r.notMeasured,
    notApplicable: r.notApplicable,
    truncated: r.truncated,
    skipDirs: [...skip].sort(),
    skippedPaths: corpus.skippedPaths,
  };
  if (partial.length) { summary.partial = true; summary.partialReasons = [...new Set(partial)]; }
  if (!corpus.installs.length) summary.voidReason = 'no WordPress install in the tree (wp-includes/version.php, or a wp-content holding a plugin or theme), so no entry was evaluated; a tree without WordPress is a void, not a clean result';
  return { tool: TOOL, summary, findings: r.findings };
}

function parseArgs(argv) {
  const out = { root: '.', dbPath: undefined, cataloguePath: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') out.dbPath = argv[++i];
    else if (a === '--no-db') out.dbPath = null;
    else if (a === '--catalogue') out.cataloguePath = argv[++i];
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else out.root = a;
  }
  if (out.dbPath === undefined && process.env.CW_WP_DB) out.dbPath = process.env.CW_WP_DB === 'none' ? null : process.env.CW_WP_DB;
  return out;
}

// process.exitCode and a return, never process.exit(): on Node 24 and 26 exit() can hang joining a
// worker thread (docs/TRAPS.md), and every error is caught here so none takes the uncaught path.
async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { process.stderr.write(`wp-posture: ${e.message}\n`); process.exitCode = 2; return; }
  const root = resolve(args.root);
  let st;
  try { st = lstatSync(root); } catch (e) { process.stderr.write(`wp-posture: cannot read ${root}: ${e.code || e.message}\n`); process.exitCode = 2; return; }
  if (!st.isDirectory()) { process.stderr.write(`wp-posture: ${root} is not a directory\n`); process.exitCode = 2; return; }
  try {
    const report = await scanTree(root, { dbPath: args.dbPath, cataloguePath: args.cataloguePath || process.env.CW_WP_POSTURE_CATALOGUE || DEFAULT_CATALOGUE });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (e) { process.stderr.write(`wp-posture: could not run: ${e.message}\n`); process.exitCode = 2; }
}

if (isMainModule(import.meta.url)) main();
