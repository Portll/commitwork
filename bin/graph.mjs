#!/usr/bin/env node
// graph — findings, lanes, repositories, areas, weakness classes and sessions as one node:sqlite
// store: nodes(id, kind, label) and edges(src, rel, dst).
//
// A projection, like bin/taxonomy-db.mjs: the issue store, the registry, the approach taxonomy and
// the area rollups stay the sources of truth. Every read rebuilds first when the inputs' fingerprint
// differs from the one the store was built from, so a query never answers from a superseded build.
// The store holds fleet data, so it lives under the reports root and is never tracked.
//
// Edge kinds, each with its source:
//   finding found-by lane      issues.json source.tool (the category for a scanner row, the auditor
//                              for a dependency finding)
//   finding in-repo repo       issues.json repo
//   repo in-area area          the registry's own area resolution; declared areas only
//   lane covers class          monitor/approach-taxonomy.json weaknessClasses, through SCANNER_CHECKS
//   lane ran-on repo           each declared area's rollup.json, repos[].scanners[lane].ran === true
//   session claimed finding    issues.json issue-claimed events; the session id is hashed, never
//                              stored. Closes and releases record no session id, so they add none.
// A kind whose input is absent is recorded as not built with the reason, never as zero edges.
// finding classified-as class is not built: the issue store records no weakness class per finding.
// An input that is present and unreadable, unparseable or invalid refuses the whole build.
//
// usage:
//   node bin/graph.mjs build                              rebuild the store, print what was built
//   node bin/graph.mjs status                             what the current store holds (rebuilds if stale)
//   node bin/graph.mjs query neighbours <id> [--rel r] [--depth n]
//   node bin/graph.mjs query path <a> <b> [--depth n]
// Node ids are <kind>:<key>: finding:ISS-…, lane:sastSemgrep, repo:<name>, area:<slug>,
// class:<weakness class>, session:<hash>. Output is JSON.
// exit: 0 answered · 20 the node is not in the graph, or no path within the depth · 21 an input or
//       the store could not be read or built · 22 usage
// env, read at call time: CW_GRAPH_DB (the store; default <reports root>/graph/graph.db),
//       CW_APPROACH_TAXONOMY (default monitor/approach-taxonomy.json), CW_ISSUES, CW_REGISTRY,
//       CW_REPORTS_ROOT, CW_NOW (pins `generated`)

import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { graphDbPathFor } from '../monitor/store-paths.mjs';
import { issuesPath, issueSchemaPath } from '../monitor/issue-store.mjs';
import { areaOf, isExampleRegistry, registryPath, validateAgainstSchema, validateRegistry } from '../monitor/registry.mjs';
import { outDirFor } from '../monitor/area.mjs';
import { CHECK_ALIASES, SCANNER_CHECKS } from '../monitor/scanner-checks.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GRAPH_VERSION = 1;
export const EXIT = { OK: 0, NOT_FOUND: 20, UNREADABLE: 21, USAGE: 22 };
export const MAX_DEPTH = 4;
export const MAX_PATH_DEPTH = 8;
const NEIGHBOUR_LIMIT = 500;

export const dbPath = () => graphDbPathFor(REPO);
const taxonomyPath = () => resolve(process.env.CW_APPROACH_TAXONOMY || join(REPO, 'monitor', 'approach-taxonomy.json'));

const sha = (s) => createHash('sha256').update(s).digest('hex');
// Opaque and stable: the same session always maps to one node, and the id itself never ships.
export const sessionNode = (sessionId) => `session:${sha(`session:${sessionId}`).slice(0, 16)}`;

// ENOENT is the only absence; anything else refuses.
function readRaw(path, what) {
  try { return readFileSync(path); }
  catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`${what} at ${path} is unreadable (${e.code}); refusing to build from it`);
  }
}
function parse(raw, path, what) {
  try { return JSON.parse(raw.toString('utf8')); }
  catch (e) { throw new Error(`${what} at ${path} is not valid JSON (${e.message})`); }
}

/**
 * Every input the graph is built from, read once. `fingerprint` covers the bytes of the small
 * inputs and each rollup's size and mtime: rollups are replaced by rename, and hashing a few
 * hundred megabytes on every query would cost more than the query.
 */
export function readInputs() {
  const parts = [`graph/${GRAPH_VERSION}`, JSON.stringify(SCANNER_CHECKS), JSON.stringify(CHECK_ALIASES)];
  const absent = {};

  const ip = issuesPath();
  const issuesRaw = readRaw(ip, 'the issue store');
  let issues = null;
  if (issuesRaw) {
    issues = parse(issuesRaw, ip, 'the issue store');
    const { errors } = validateAgainstSchema(issues, { path: issueSchemaPath() });
    if (errors.length) throw new Error(`the issue store at ${ip} is invalid:\n  - ${errors.join('\n  - ')}`);
    parts.push(`issues:${sha(issuesRaw)}`);
  } else { absent.issues = `no issue store at ${ip}`; parts.push('issues:absent'); }

  const tp = taxonomyPath();
  const taxRaw = readRaw(tp, 'the approach taxonomy');
  let taxonomy = null;
  if (taxRaw) {
    taxonomy = parse(taxRaw, tp, 'the approach taxonomy');
    if (!taxonomy || typeof taxonomy.weaknessClassVocab !== 'object' || !Array.isArray(taxonomy.approaches)) {
      throw new Error(`the approach taxonomy at ${tp} has no weaknessClassVocab or approaches`);
    }
    parts.push(`taxonomy:${sha(taxRaw)}`);
  } else { absent.taxonomy = `no approach taxonomy at ${tp}`; parts.push('taxonomy:absent'); }

  // The shipped example names no real repository: building areas or rollups from it would publish
  // a demonstration fleet as this one.
  const rp = registryPath();
  let registry = null;
  const rollups = [];
  if (isExampleRegistry(rp)) {
    absent.registry = 'the registry is the shipped example, so no fleet is declared';
    parts.push('registry:example');
  } else {
    const regRaw = readRaw(rp, 'the registry');
    if (!regRaw) { absent.registry = `no registry at ${rp}`; parts.push('registry:absent'); }
    else {
      registry = parse(regRaw, rp, 'the registry');
      const errors = [...validateRegistry(registry).errors, ...validateAgainstSchema(registry).errors];
      if (errors.length) throw new Error(`the registry at ${rp} is invalid:\n  - ${errors.join('\n  - ')}`);
      parts.push(`registry:${sha(regRaw)}`);
      for (const a of [...(registry.areas || [])].sort((x, y) => (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0))) {
        const file = join(outDirFor(a.slug, registry, { env: false }), 'rollup.json');
        let st;
        try { st = statSync(file); }
        catch (e) {
          if (e.code === 'ENOENT') { rollups.push({ area: a.slug, file, doc: null }); parts.push(`rollup:${a.slug}:absent`); continue; }
          throw new Error(`the rollup at ${file} is unreadable (${e.code}); refusing to build from it`);
        }
        parts.push(`rollup:${a.slug}:${st.size}:${st.mtimeMs}`);
        rollups.push({ area: a.slug, file, stat: st });
      }
    }
  }
  return { issues, taxonomy, registry, rollups, absent, fingerprint: sha(parts.join('\n')) };
}

const loadRollup = (r) => {
  if (r.doc !== undefined) return r.doc;
  const raw = readRaw(r.file, 'a rollup');
  return raw ? parse(raw, r.file, 'the rollup') : null;
};

/** The node and edge sets, sorted and de-duplicated, with what was and was not built. Pure over `inputs`. */
export function project(inputs) {
  const nodes = new Map();
  const edges = new Map();
  const status = {};
  const node = (id, kind, label) => { if (!nodes.has(id)) nodes.set(id, { id, kind, label: String(label ?? '').slice(0, 200) }); };
  const edge = (src, rel, dst) => { edges.set(`${src}\u0000${rel}\u0000${dst}`, { src, rel, dst }); };
  const count = (rel) => [...edges.values()].filter((e) => e.rel === rel).length;
  const built = (key, rel, extra = {}) => { status[key] = { status: 'built', edges: count(rel), ...extra }; };
  const notBuilt = (key, reason) => { status[key] = { status: 'not-built', reason }; };

  const laneLabel = (cat) => (SCANNER_CHECKS[cat] ? `${cat} (${SCANNER_CHECKS[cat]})` : cat);
  for (const cat of Object.keys(SCANNER_CHECKS)) node(`lane:${cat}`, 'lane', laneLabel(cat));

  const { issues, taxonomy, registry } = inputs;
  if (issues) {
    for (const iss of Object.values(issues.issues || {})) {
      const f = `finding:${iss.id}`;
      node(f, 'finding', `${iss.severity} ${iss.state} ${iss.title || ''}`.trim());
      if (iss.source?.tool) { node(`lane:${iss.source.tool}`, 'lane', laneLabel(iss.source.tool)); edge(f, 'found-by', `lane:${iss.source.tool}`); }
      if (iss.repo) { node(`repo:${iss.repo}`, 'repository', iss.repo); edge(f, 'in-repo', `repo:${iss.repo}`); }
    }
    built('finding-found-by-lane', 'found-by');
    built('finding-in-repo', 'in-repo');
    for (const ev of issues.events || []) {
      const sid = ev?.data?.sessionId;
      if (ev?.type !== 'issue-claimed' || typeof sid !== 'string' || !sid || !issues.issues?.[ev.issueId]) continue;
      const s = sessionNode(sid);
      node(s, 'session', 'session');
      edge(s, 'claimed', `finding:${ev.issueId}`);
    }
    built('session-claimed-finding', 'claimed', { note: 'claims that recorded a session id; no other issue event records one' });
  } else {
    for (const k of ['finding-found-by-lane', 'finding-in-repo', 'session-claimed-finding']) notBuilt(k, inputs.absent.issues);
  }
  notBuilt('finding-classified-as-class',
    'the issue store records no weakness class per finding; a finding reaches the classes its lane covers through found-by then covers');

  if (taxonomy) {
    for (const [key, v] of Object.entries(taxonomy.weaknessClassVocab)) node(`class:${key}`, 'class', v?.label || key);
    const byCheck = new Map(taxonomy.approaches.map((a) => [a.check, a]));
    let unmapped = 0;
    for (const [cat, check] of Object.entries(SCANNER_CHECKS)) {
      const a = byCheck.get(CHECK_ALIASES[check] || check) || byCheck.get(check);
      if (!a) { unmapped++; continue; }
      for (const wc of a.weaknessClasses || []) if (nodes.has(`class:${wc}`)) edge(`lane:${cat}`, 'covers', `class:${wc}`);
    }
    built('lane-covers-class', 'covers', { lanesWithoutTaxonomyEntry: unmapped });
  } else notBuilt('lane-covers-class', inputs.absent.taxonomy);

  if (registry) {
    const declared = new Map((registry.areas || []).map((a) => [a.slug, a.label || a.slug]));
    for (const [slug, label] of declared) node(`area:${slug}`, 'area', label);
    const absentRollups = [];
    for (const r of inputs.rollups) {
      const doc = loadRollup(r);
      if (!doc) { absentRollups.push(r.area); continue; }
      for (const row of Array.isArray(doc.repos) ? doc.repos : []) {
        if (!row?.name) continue;
        for (const [cat, s] of Object.entries(row.scanners || {})) {
          if (s?.ran !== true) continue;
          node(`lane:${cat}`, 'lane', laneLabel(cat));
          node(`repo:${row.name}`, 'repository', row.name);
          edge(`lane:${cat}`, 'ran-on', `repo:${row.name}`);
        }
      }
    }
    built('lane-ran-on-repo', 'ran-on', { areasWithoutRollup: absentRollups.length });
    let outside = 0;
    for (const n of [...nodes.values()].filter((x) => x.kind === 'repository')) {
      const slug = areaOf(n.label, registry);
      if (declared.has(slug)) edge(n.id, 'in-area', `area:${slug}`); else outside++;
    }
    built('repo-in-area', 'in-area', { reposOutsideDeclaredAreas: outside });
  } else {
    notBuilt('lane-ran-on-repo', inputs.absent.registry);
    notBuilt('repo-in-area', inputs.absent.registry);
  }

  const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    nodes: [...nodes.values()].sort((a, b) => byId(a.id, b.id)),
    edges: [...edges.values()].sort((a, b) => byId(a.src, b.src) || byId(a.rel, b.rel) || byId(a.dst, b.dst)),
    status: Object.fromEntries(Object.entries(status).sort(([a], [b]) => byId(a, b))),
  };
}

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL);
CREATE TABLE edges (src TEXT NOT NULL REFERENCES nodes(id), rel TEXT NOT NULL, dst TEXT NOT NULL REFERENCES nodes(id),
  PRIMARY KEY (src, rel, dst));
CREATE INDEX edges_dst ON edges(dst, rel);
CREATE INDEX nodes_kind ON nodes(kind);
`;

const generatedAt = () => (process.env.CW_NOW ? new Date(process.env.CW_NOW).toISOString() : new Date().toISOString());

/**
 * Build in memory, copy out with VACUUM INTO (node:sqlite on the 22.18 floor has no serialize),
 * and land the bytes through writeAtomic so a reader sees the whole old store or the whole new one.
 */
export function build({ file = dbPath(), inputs = readInputs() } = {}) {
  const g = project(inputs);
  const mem = new DatabaseSync(':memory:');
  const scratch = mkdtempSync(join(tmpdir(), 'cw-graph-'));
  try {
    mem.exec('PRAGMA foreign_keys = ON;');
    mem.exec(SCHEMA);
    mem.exec('BEGIN');
    const meta = mem.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    meta.run('version', String(GRAPH_VERSION));
    meta.run('fingerprint', inputs.fingerprint);
    meta.run('generated', generatedAt());
    meta.run('status', JSON.stringify(g.status));
    const n = mem.prepare('INSERT INTO nodes (id, kind, label) VALUES (?, ?, ?)');
    for (const x of g.nodes) n.run(x.id, x.kind, x.label);
    const e = mem.prepare('INSERT INTO edges (src, rel, dst) VALUES (?, ?, ?)');
    for (const x of g.edges) e.run(x.src, x.rel, x.dst);
    mem.exec('COMMIT');
    const out = join(scratch, 'graph.db');
    mem.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    writeAtomic(file, readFileSync(out), { mkdir: true });
  } finally {
    mem.close();
    rmSync(scratch, { recursive: true, force: true });
  }
  return { file, fingerprint: inputs.fingerprint, nodes: g.nodes.length, edges: g.edges.length, status: g.status };
}

const metaOf = (db) => Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));

/**
 * A read-only connection to a store built from the inputs as they are now — rebuilding first when
 * the stored fingerprint differs. A store that cannot be opened is a projection to rebuild, not an
 * answer; an input that cannot be read throws.
 */
export function openFresh({ file = dbPath(), attempts = 3 } = {}) {
  let rebuilt = false;
  for (let i = 0; i < attempts; i++) {
    const inputs = readInputs();
    let db = null;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      const meta = metaOf(db);
      if (meta.fingerprint === inputs.fingerprint && meta.version === String(GRAPH_VERSION)) {
        return { db, rebuilt, meta: { generated: meta.generated, fingerprint: meta.fingerprint, status: JSON.parse(meta.status) } };
      }
    } catch (e) {
      if (e.code !== 'ENOENT' && !/unable to open|no such table|not a database/i.test(String(e.message))) throw e;
    }
    db?.close();
    build({ file, inputs });
    rebuilt = true;
  }
  throw new Error(`the graph inputs changed ${attempts} times while the store was being rebuilt — no stable edition to answer from`);
}

const nodeRow = (db, id) => db.prepare('SELECT id, kind, label FROM nodes WHERE id = ?').get(id) || null;
const plain = (r) => (r ? { ...r } : r);

function adjacent(db, id, rel) {
  const out = rel
    ? db.prepare('SELECT src, rel, dst FROM edges WHERE src = ? AND rel = ? ORDER BY rel, dst').all(id, rel)
    : db.prepare('SELECT src, rel, dst FROM edges WHERE src = ? ORDER BY rel, dst').all(id);
  const inn = rel
    ? db.prepare('SELECT src, rel, dst FROM edges WHERE dst = ? AND rel = ? ORDER BY rel, src').all(id, rel)
    : db.prepare('SELECT src, rel, dst FROM edges WHERE dst = ? ORDER BY rel, src').all(id);
  return [
    ...out.map((e) => ({ other: e.dst, rel: e.rel, direction: 'out' })),
    ...inn.map((e) => ({ other: e.src, rel: e.rel, direction: 'in' })),
  ];
}

/** Every node within `depth` hops of `id`, both directions, optionally along one relation. */
export function neighbours(db, id, { rel = null, depth = 1, limit = NEIGHBOUR_LIMIT } = {}) {
  const d = Math.max(1, Math.min(MAX_DEPTH, Number.isInteger(depth) ? depth : 1));
  const root = nodeRow(db, id);
  if (!root) return { id, found: false, reason: `no node ${id} in the graph` };
  const seen = new Map([[id, 0]]);
  const result = [];
  let frontier = [id];
  let truncated = false;
  for (let hop = 1; hop <= d && frontier.length && !truncated; hop++) {
    const next = [];
    for (const from of frontier) {
      for (const a of adjacent(db, from, rel)) {
        if (seen.has(a.other)) continue;
        if (result.length >= limit) { truncated = true; break; }
        seen.set(a.other, hop);
        const n = nodeRow(db, a.other);
        result.push({ ...plain(n), rel: a.rel, direction: a.direction, via: from, distance: hop });
        next.push(a.other);
      }
      if (truncated) break;
    }
    frontier = next;
  }
  const kinds = {};
  for (const r of result) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  return { id, found: true, node: plain(root), rel, depth: d, count: result.length, truncated, limit, kinds, neighbours: result };
}

/** A shortest undirected path from `a` to `b`, as nodes and the edges joining them. */
export function path(db, a, b, { depth = MAX_PATH_DEPTH } = {}) {
  const d = Math.max(1, Math.min(MAX_PATH_DEPTH, Number.isInteger(depth) ? depth : MAX_PATH_DEPTH));
  for (const id of [a, b]) if (!nodeRow(db, id)) return { from: a, to: b, found: false, reason: `no node ${id} in the graph` };
  const prev = new Map([[a, null]]);
  let frontier = [a];
  for (let hop = 0; hop < d && frontier.length && !prev.has(b); hop++) {
    const next = [];
    for (const from of frontier) {
      for (const x of adjacent(db, from, null)) {
        if (prev.has(x.other)) continue;
        prev.set(x.other, { from, rel: x.rel, direction: x.direction });
        next.push(x.other);
      }
    }
    frontier = next;
  }
  if (!prev.has(b)) return { from: a, to: b, found: false, depth: d, reason: `no path within ${d} hops` };
  const ids = [b];
  const steps = [];
  for (let cur = b; prev.get(cur); cur = prev.get(cur).from) {
    const p = prev.get(cur);
    steps.unshift(p.direction === 'out' ? { src: p.from, rel: p.rel, dst: cur } : { src: cur, rel: p.rel, dst: p.from });
    ids.unshift(p.from);
  }
  return { from: a, to: b, found: true, depth: d, length: steps.length, nodes: ids.map((id) => plain(nodeRow(db, id))), edges: steps };
}

const SEARCH_LIMIT = 50;

/** Nodes whose id or label contains `q` (ASCII case-insensitive), an exact id first, then by id. */
export function search(db, q, { limit = SEARCH_LIMIT } = {}) {
  const needle = String(q ?? '').trim();
  const base = { q: needle, counts: counts(db) };
  if (!needle) return { ...base, count: 0, truncated: false, matches: [] };
  const like = `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = db.prepare("SELECT id, kind, label FROM nodes WHERE id LIKE ? ESCAPE '\\' OR label LIKE ? ESCAPE '\\' ORDER BY (id = ?) DESC, id LIMIT ?")
    .all(like, like, needle, limit + 1).map(plain);
  const truncated = rows.length > limit;
  return { ...base, count: Math.min(rows.length, limit), truncated, limit, matches: rows.slice(0, limit) };
}

/** Open fresh, answer, close: the shape the panel route and the MCP tool share. */
export function withGraph(fn, opts = {}) {
  const { db, rebuilt, meta } = openFresh(opts);
  try {
    return { graph: { generated: meta.generated, fingerprint: meta.fingerprint.slice(0, 12), rebuilt, status: meta.status }, ...fn(db) };
  } finally { db.close(); }
}

function counts(db) {
  const kinds = Object.fromEntries(db.prepare('SELECT kind, COUNT(*) AS n FROM nodes GROUP BY kind ORDER BY kind').all().map((r) => [r.kind, r.n]));
  const rels = Object.fromEntries(db.prepare('SELECT rel, COUNT(*) AS n FROM edges GROUP BY rel ORDER BY rel').all().map((r) => [r.rel, r.n]));
  return { nodes: kinds, edges: rels };
}

const USAGE = 'usage: graph.mjs build | status | query neighbours <id> [--rel r] [--depth n] | query path <a> <b> [--depth n]';

export function main(argv = process.argv.slice(2)) {
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const positional = argv.filter((x, i) => !x.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
  const print = (o) => process.stdout.write(`${JSON.stringify(o, null, 2)}\n`);
  const depthArg = flag('--depth');
  const depth = depthArg === undefined ? undefined : Number(depthArg);
  if (depthArg !== undefined && !(Number.isInteger(depth) && depth >= 1)) { console.error(USAGE); return EXIT.USAGE; }
  const [cmd, sub, a, b] = positional;
  try {
    if (cmd === 'build' && !sub) {
      const r = build();
      print({ file: r.file, fingerprint: r.fingerprint.slice(0, 12), nodes: r.nodes, edges: r.edges, status: r.status });
      return EXIT.OK;
    }
    if (cmd === 'status' && !sub) { print(withGraph((db) => ({ file: dbPath(), counts: counts(db) }))); return EXIT.OK; }
    if (cmd === 'query' && sub === 'neighbours' && a && !b) {
      const r = withGraph((db) => neighbours(db, a, { rel: flag('--rel') || null, depth: depth ?? 1 }));
      print(r);
      return r.found ? EXIT.OK : EXIT.NOT_FOUND;
    }
    if (cmd === 'query' && sub === 'path' && a && b) {
      const r = withGraph((db) => path(db, a, b, { depth: depth ?? MAX_PATH_DEPTH }));
      print(r);
      return r.found ? EXIT.OK : EXIT.NOT_FOUND;
    }
  } catch (e) {
    console.error(`graph: ${e.message}`);
    return EXIT.UNREADABLE;
  }
  console.error(USAGE);
  return EXIT.USAGE;
}

if (isMainModule(import.meta.url)) process.exitCode = main();
