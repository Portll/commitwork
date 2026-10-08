#!/usr/bin/env node
// bin/feature-inventory.mjs — artifact (1) of the featureset census (docs/LAUNCHLIST.md,
// "Featureset census: proposed prompts"): a DETERMINISTIC inventory of every entry point in this
// tree. No model, no network, no shell. Writes one file, atomically, only where --out says.
//
//   node bin/feature-inventory.mjs                     # write reports/features.json, print a summary
//   node bin/feature-inventory.mjs --out <path>        # write elsewhere
//   node bin/feature-inventory.mjs --summary           # print the summary only, write nothing
//   node bin/feature-inventory.mjs --surface http      # restrict the printed summary to one surface
//
// env (read at CALL time, never at module load, so a test can point every input at a fixture):
//   CW_FI_ROOT  repo root to inventory        CW_FI_OUT  default --out
//   CW_NOW      the recorded clock (ISO-8601) — set it and two runs are byte-identical
//
// WHY A FEATURE'S ID EXCLUDES ITS LINE. A feature's identity has to survive the file moving under
// it; keying on `line` converts an unrelated edit above into "this feature went away and a new one
// arrived". Line numbers are RECORDED (a reader needs to jump there) and never part of `id`.
//
// WHY `undetermined` IS ITS OWN FIELD. An entry point this extractor could see but could not read
// (a computed route path, a label built from a registry) is not absent and not present-and-fine. It
// is counted in `undetermined` with the expression preserved, so the census never reads a parse
// limit as a clean surface. Dropping it silently is the one failure mode that would make every
// number here flatter than the truth.

import { readFileSync, readdirSync, statSync, lstatSync } from 'node:fs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { stripComments } from './lib/tracked-imports.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..');

/** Env read at CALL time. A `const X = process.env.Y` at import defeats every test override. */
const envStr = (name) => {
  const v = process.env[name];
  return typeof v === 'string' && v !== '' ? v : null;
};
export const inventoryRoot = () => resolve(envStr('CW_FI_ROOT') || DEFAULT_ROOT);
export const nowISO = () => envStr('CW_NOW') || new Date().toISOString();

// Directories that are not this product's source: VCS, installed deps, generated output, the
// private sidecar (a symlink — never walked), fixture repositories (other projects' code), and
// scratch areas. Walking any of them would put another tree's entry points in this inventory.
const SKIP_DIRS = new Set([
  '.git', '.github', 'node_modules', 'reports', 'evaluations', 'fixtures', 'sleight_data',
  'workspace', 'provenance', 'prompts', 'design', 'schema', 'ci', 'joernwork',
]);

/** ENOENT is the only absence. Any other error is a failure and must not read as an empty file. */
function readOrNull(abs) {
  try { return readFileSync(abs, 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

function readOrThrow(abs) {
  const t = readOrNull(abs);
  if (t === null) throw new Error(`feature-inventory: required input is absent: ${abs}`);
  return t;
}

/** 1-based line of a byte offset. Recorded for navigation; never part of an identity. */
function lineAt(text, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Depth-first walk, symlinks never followed, results sorted so the output is order-stable. */
function walk(root) {
  const out = [];
  const visit = (relDir) => {
    const abs = relDir ? join(root, relDir) : root;
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); }
    catch (e) { if (e && e.code === 'ENOENT') return; throw e; }
    const names = entries.map((e) => e.name).sort();
    for (const name of names) {
      if (name.startsWith('.') && name !== '.github') continue;
      const relPath = relDir ? `${relDir}/${name}` : name;
      const entry = entries.find((e) => e.name === name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        visit(relPath);
      } else if (entry.isFile()) {
        out.push(relPath);
      }
    }
  };
  visit('');
  return out;
}

const isTest = (rel) => rel.endsWith('.test.mjs') || rel.includes('/test/') || rel.startsWith('test/');
const isScript = (rel) => rel.endsWith('.mjs') || rel.endsWith('.js') || rel.endsWith('.sh');

// ── the test index ───────────────────────────────────────────────────────────────────────────────
// An inverted index, built once: token -> the test files that mention it. Probing 1,500 features
// against 900 test files by substring would be ~1.4M scans; this is one pass over each test.
// Tokens are identifiers AND the verbatim contents of quoted strings, because a route path, an MCP
// tool name and an env var all arrive in a test as string literals, not as identifiers.
function buildTokenIndex(root, files) {
  const idx = new Map();
  const add = (tok, rel) => {
    if (!tok) return;
    let set = idx.get(tok);
    if (!set) { set = new Set(); idx.set(tok, set); }
    set.add(rel);
  };
  for (const rel of files) {
    const text = readOrNull(join(root, rel));
    if (text === null) continue;
    for (const m of text.matchAll(/[A-Za-z_$][A-Za-z0-9_$-]*/g)) add(m[0], rel);
    for (const m of text.matchAll(/'([^'\n]{2,200})'|"([^"\n]{2,200})"|`([^`\n]{2,200})`/g)) {
      const lit = m[1] ?? m[2] ?? m[3];
      add(lit, rel);
      // ALSO the basename. A test reaches its subject as `'../agent-config.mjs'`, which does not
      // contain the token `agent-config.mjs` under exact matching — so indexing the literal alone
      // reported 176 of 307 scripts untested when most of them have a test sitting next to them.
      // That is a false NEGATIVE, the direction that makes a census look worse than the truth and
      // fills `fragment` with rows nobody can act on.
      if (lit.includes('/')) add(lit.slice(lit.lastIndexOf('/') + 1), rel);
    }
    // PATH-LIKE tokens anywhere, including in comments and in unquoted prose. A test that spawns
    // `node bin/deno-scan.mjs` through a built argv, or names it in the header explaining what it
    // covers, mentions the script in neither a bare identifier (the `.` ends the match) nor a
    // string literal — and reading only those two called 2 of 4 spot-checked scripts untested.
    // What this field measures is therefore NAMING, not assertion coverage; the census says so.
    for (const m of text.matchAll(/[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.(?:mjs|js|sh)\b/g)) {
      add(m[0], rel);
      add(m[0].slice(m[0].lastIndexOf('/') + 1), rel);
    }
    // METHOD-QUALIFIED route literals — `'GET /api/comments'`, `describe('PUT /api/llm/runtime')`.
    // The bare-path probe never matched them, which reported 7 tested routes as fragments. Read
    // from CODE only, so a comment naming a route is not a test of it; keyed on the whole literal,
    // so `/api/x` is not satisfied by `/api/xy` or `/api/x/sub`.
    const code = stripComments(text).join('\n');
    for (const m of code.matchAll(/(['"`])([A-Z]+ \/[^\s'"`]*)\1/g)) add(routeKey(m[2]), rel);
  }
  return idx;
}

/** Index key for a method-qualified route literal; the NUL keeps it apart from every other token. */
const routeKey = (name) => `\u0000route ${name}`;

/** Files mentioning EVERY probe (an AND, so a generic word alone never claims coverage). */
function lookupAll(idx, probes) {
  if (!probes.length) return [];
  let acc = null;
  for (const p of probes) {
    const set = idx.get(p) || new Set();
    acc = acc === null ? new Set(set) : new Set([...acc].filter((f) => set.has(f)));
    if (acc.size === 0) return [];
  }
  return [...acc].sort();
}

// ── per-surface extractors ───────────────────────────────────────────────────────────────────────

/** The `commitwork` subcommands, read from main()'s own dispatch rather than from the usage text. */
function extractCliCommands(root) {
  const rel = 'bin/commitwork.mjs';
  const text = readOrThrow(join(root, rel));
  const at = text.indexOf('async function main()');
  if (at < 0) throw new Error('feature-inventory: bin/commitwork.mjs has no main() to read a dispatch from');
  const body = text.slice(at);
  const found = new Map();
  const note = (name, off) => {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) return; // flags and aliases are not commands
    if (!found.has(name)) found.set(name, lineAt(text, at + off));
  };
  for (const m of body.matchAll(/cmd === '([^']+)'/g)) note(m[1], m.index);
  for (const m of body.matchAll(/case '([^']+)':/g)) note(m[1], m.index);
  return [...found.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, line]) => ({
    surface: 'cli-command', id: `cli-command:${name}`, name,
    file: rel, line, entryPoint: true,
  }));
}

/**
 * Who, other than its own tests, names this script. A script nothing names and nothing imports is
 * run only by somebody who already knows it exists — which is the `orphan` membership test for this
 * surface. `dead` from codegraph is NOT the same question: it asks what binds a SYMBOL. This asks
 * what WIRES the file, which is the question the repository's own ruling says to ask.
 */
function buildReferenceIndex(root, files) {
  const idx = new Map();
  const corpus = files.filter((f) => !f.endsWith('.test.mjs') && !f.includes('/test/')
    && /\.(mjs|js|sh|md|json|ya?ml|plist|html)$/.test(f));
  for (const rel of corpus) {
    const text = readOrNull(join(root, rel));
    if (text === null) continue;
    for (const m of text.matchAll(/[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.(?:mjs|js|sh)\b/g)) {
      const key = m[0].replace(/^\.\.?\//, '');
      let set = idx.get(key);
      if (!set) { set = new Set(); idx.set(key, set); }
      set.add(rel);
    }
  }
  return idx;
}

/** Every standalone script: a shebang or an isMainModule guard is the executable entry point. */
function extractCliScripts(root, files, refIdx) {
  const out = [];
  const allFiles = new Set(files);
  for (const rel of files) {
    if (!isScript(rel) || isTest(rel)) continue;
    const text = readOrNull(join(root, rel));
    if (text === null) continue;
    const shebang = text.startsWith('#!');
    const guardIdx = text.indexOf('isMainModule(import.meta.url)');
    if (!shebang && guardIdx < 0) continue;
    const base = rel.split('/').pop();
    const refs = new Set([...(refIdx.get(rel) || []), ...(refIdx.get(base) || [])]);
    refs.delete(rel);
    // This repository's convention is to extract a script's logic into `<name>-core.mjs` and test
    // THAT (bin/test/spine-reconcile.test.mjs imports ../spine-reconcile-core.mjs and never names
    // the script). "No test names the script" is true there and would read as untested logic, which
    // it is not — so the core sibling is recorded as its own field rather than folded into `tests`.
    const coreSibling = rel.replace(/\.(mjs|js)$/, '-core.$1');
    const hasCore = allFiles.has(coreSibling);
    out.push({
      surface: 'cli-script', id: `cli-script:${rel}`, name: rel, file: rel,
      line: guardIdx >= 0 ? lineAt(text, guardIdx) : 1,
      entryPoint: true,
      entryKind: shebang && guardIdx >= 0 ? 'shebang+guard' : shebang ? 'shebang' : 'guard',
      referencedFrom: [...refs].sort(),
      coreSibling: hasCore ? coreSibling : null,
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * A route path written as a one-hole template is almost always `...SRC.map((v) => ({ path: `…${v}` }))`
 * over a plain string array. Resolving that narrow shape is the difference between 165 concrete
 * routes and 173: the import witness (bin/test/feature-inventory.test.mjs) found exactly the 8
 * these two templates stand for. Anything wider than this shape stays undetermined — a guessed
 * expansion would be worse than a named gap.
 * @returns {string[]|null} the concrete paths, or null when the shape is not resolvable here
 */
function expandTemplatePath(text, routeIdx, template) {
  const holes = [...template.matchAll(/\$\{([A-Za-z_$][\w$]*)\}/g)];
  if (holes.length !== 1) return null;
  const varName = holes[0][1];
  // The `.map((varName)` that introduces the hole sits just before this route literal.
  const before = text.slice(Math.max(0, routeIdx - 600), routeIdx);
  const mapAt = before.lastIndexOf(`.map((${varName})`);
  if (mapAt < 0) return null;
  const head = before.slice(0, mapAt);
  // One separator between items rather than a trailing and a leading `\s*` per item, which
  // backtracked exponentially on a run of `'' ` with no closing bracket.
  const inline = head.match(/\[(\s*'[^'\n]*'(?:\s*(?:,\s*)?'[^'\n]*')*\s*,?)\]\s*$/);
  let listText = inline ? inline[1] : null;
  if (!listText) {
    const srcName = (head.match(/([A-Za-z_$][\w$]*)\s*$/) || [])[1];
    if (!srcName) return null;
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- srcName is a literal identifier from this file's own call sites
    const decl = text.match(new RegExp(`const ${srcName}\\s*=\\s*\\[([^\\]]*)\\]`));
    if (!decl) return null;
    listText = decl[1];
  }
  const items = [...listText.matchAll(/'([^'\n]*)'/g)].map((m) => m[1]);
  if (!items.length) return null;
  // A non-string member means the array is not what this rule assumes; refuse rather than guess.
  if (/[^\s,']/.test(listText.replace(/'[^'\n]*'/g, ''))) return null;
  return items.map((v) => template.replaceAll(`\${${varName}}`, v));
}

/**
 * HTTP routes. Anchored on `method:` and then the nearest following `path:` in the same literal,
 * because 34 of these span two lines and a single-line regex silently loses them. A `method:` with
 * no readable path is reported undetermined with its expression — never dropped.
 */
function extractHttpRoutes(root, files) {
  const routeFiles = files.filter((f) => f.startsWith('admin/routes/') && f.endsWith('.mjs') && !isTest(f));
  const serve = readOrThrow(join(root, 'admin/serve.mjs'));
  const modularLine = (serve.match(/const MODULAR_ROUTES = \[[^\]]*\]/) || [''])[0];
  const aliasOf = new Map();
  for (const m of serve.matchAll(/import \{[^}]*routes as (\w+)[^}]*\} from '\.\/routes\/([a-z0-9-]+\.mjs)'/g)) {
    aliasOf.set(`admin/routes/${m[2]}`, m[1]);
  }
  const out = [];
  let outbound = 0; // outbound fetch inits discriminated from route entries; surfaced below
  for (const rel of routeFiles) {
    const text = readOrThrow(join(root, rel));
    const alias = aliasOf.get(rel) || null;
    const wired = !!alias && modularLine.includes(`...${alias}`);
    for (const m of text.matchAll(/method:\s*'([A-Z]+)'/g)) {
      const after = text.slice(m.index, m.index + 400);
      const pm = after.match(/path:\s*(?:'([^'\n]*)'|`([^`\n]*)`|(\/(?:[^/\\\n]|\\.)+\/[gimsuy]*)|([A-Za-z_$][\w$.[\]'"-]*))/);
      const line = lineAt(text, m.index);
      if (!pm) {
        // `method:` also appears in OUTBOUND calls — `fetch(url, { method: 'POST' })` — which are not
        // this server's surface. Measured: all 8 such anchors in admin/routes/ are fetch inits, and
        // the import witness confirms the served count without them. Discriminated only where the
        // `fetch(` is visibly the opening of this very options object; anything else stays
        // undetermined, because a dropped route is the direction that lies.
        const lead = text.slice(Math.max(0, m.index - 200), m.index);
        if (/fetch\(([^)]|\)(?!\s*;))*\{[^{}]*$/.test(lead)) { outbound++; continue; }
        out.push({
          surface: 'http-route', id: `http-route:${rel}#${m[1]}@${line}`, name: `${m[1]} (unread)`,
          file: rel, line, entryPoint: true, wired, undetermined: true,
          undeterminedWhy: `method: '${m[1]}' with no path: within 400 chars — may not be a route entry`,
        });
        continue;
      }
      const literal = pm[1];
      const template = pm[2];
      const regexp = pm[3];
      const computed = pm[4];
      const pathText = literal ?? template ?? regexp ?? computed;
      const kind = literal !== undefined ? 'literal' : template !== undefined ? 'template'
        : regexp !== undefined ? 'regexp' : 'computed';
      const expanded = kind === 'template' ? expandTemplatePath(text, m.index, template) : null;
      if (expanded) {
        for (const p of expanded) {
          out.push({
            surface: 'http-route', id: `http-route:${m[1]} ${p}`, name: `${m[1]} ${p}`,
            file: rel, line, entryPoint: true, wired, pathKind: 'literal',
            expandedFrom: `${m[1]} ${pathText}`,
          });
        }
        continue;
      }
      out.push({
        surface: 'http-route', id: `http-route:${m[1]} ${pathText}`, name: `${m[1]} ${pathText}`,
        file: rel, line, entryPoint: true, wired, pathKind: kind,
        ...(kind === 'literal' ? {} : { undetermined: true, undeterminedWhy: `path is a ${kind} (${pathText}) — the concrete paths are not readable without evaluating the module` }),
      });
    }
  }
  const seen = new Set();
  const rows = out.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  rows.outboundFetchAnchors = outbound;
  return rows;
}

/** Panel views: NATIVE plus the iframe views added to VALID_VIEWS, plus the retired-name aliases. */
function extractUiViews(root) {
  const rel = 'admin/static/panel-router.js';
  const text = readOrThrow(join(root, rel));
  const nativeM = text.match(/const NATIVE=\{([\s\S]*?)\};/);
  if (!nativeM) throw new Error('feature-inventory: panel-router.js has no NATIVE map');
  const nativeLine = lineAt(text, nativeM.index);
  const views = new Map();
  for (const m of nativeM[1].matchAll(/([A-Za-z0-9_]+):'([^']+)'/g)) {
    views.set(m[1], { element: m[2], kind: 'native', line: nativeLine });
  }
  const validM = text.match(/const VALID_VIEWS=new Set\(\[([\s\S]*?)\]\);/);
  if (!validM) throw new Error('feature-inventory: panel-router.js has no VALID_VIEWS set');
  const validLine = lineAt(text, validM.index);
  for (const m of validM[1].matchAll(/'([^']+)'/g)) {
    if (!views.has(m[1])) views.set(m[1], { element: null, kind: 'iframe', line: validLine });
  }
  const aliasM = text.match(/const VIEW_ALIAS=\{([^}]*)\}/);
  const aliases = new Map();
  if (aliasM) for (const m of aliasM[1].matchAll(/([A-Za-z0-9_]+):'([^']+)'/g)) aliases.set(m[1], m[2]);

  // The navigation map and the server's page-route whitelist are the two things that decide whether
  // a view is REACHABLE: a view in neither is drawn by nothing and served by nothing.
  const nav = readOrThrow(join(root, 'admin/menus/navigation.js'));
  const groupsM = nav.match(/const TAB_GROUPS=Object\.freeze\(\{([\s\S]*?)\}\);/);
  const groups = new Map();
  if (groupsM) for (const m of groupsM[1].matchAll(/([A-Za-z0-9_]+):\s*'([^']+)'/g)) groups.set(m[1], m[2]);
  const serve = readOrThrow(join(root, 'admin/serve.mjs'));
  const panelM = serve.match(/const PANEL_VIEWS = new Set\(\[([\s\S]*?)\]\);/);
  const panelViews = new Set();
  if (panelM) for (const m of panelM[1].matchAll(/'([^']+)'/g)) panelViews.add(m[1]);

  // THREE mechanisms put a clickable link on screen, and a view in none of them is reachable only
  // by typing its URL. Measured 2026-10-04: reading only TAB_GROUPS called five reachable views
  // orphans, because `settings`, `projects`, `rollups` and `remfleet` are rail links (`data-route`)
  // that were deliberately removed from the tab strip, and `profile` is a `data-v` button. One
  // mechanism read as the whole answer is how a census invents gaps.
  const linked = new Set();
  for (const rel2 of ['admin/panel.html', 'admin/menus/view-menu.html', 'admin/menus/section-rail.html',
    'admin/menus/top-bar.html', 'admin/menus/account-menu.html', 'admin/menus/account-security.html']) {
    const t = readOrNull(join(root, rel2));
    if (t === null) continue;
    for (const m of t.matchAll(/data-(?:v|route)="([a-z0-9]+)"/g)) linked.add(m[1]);
  }

  return [...views.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, v]) => ({
    surface: 'ui-view', id: `ui-view:${name}`, name, file: rel, line: v.line,
    entryPoint: true, viewKind: v.kind, element: v.element,
    navGroup: groups.has(name) ? groups.get(name) : null,
    pathRouted: panelViews.has(name),
    linkedFromChrome: linked.has(name),
    aliasedFrom: [...aliases.entries()].filter(([, to]) => to === name).map(([from]) => from).sort(),
    // Reachable means an operator can CLICK to it. A path route alone is a URL nothing links to.
    uiReachable: groups.has(name) || linked.has(name),
  }));
}

/** MCP tools: the descriptors are the wire contract, the handlers are the implementation. */
function extractMcpTools(root) {
  const relT = 'mcp/tools.mjs';
  const relS = 'mcp/server.mjs';
  const tools = readOrThrow(join(root, relT));
  const server = readOrThrow(join(root, relS));
  // The handler table SPREADS its descriptor (`...DESC.poam`), so the tool's name never appears as a
  // literal in server.mjs. Probing for `name: '…'` there matched nothing and reported all 16 tools
  // handler-less — a false gap in the one surface whose live witness can disprove it in a second.
  const handlers = new Set();
  for (const m of server.matchAll(/\.\.\.DESC\.([a-z0-9_]+)/g)) handlers.add(m[1]);
  const out = [];
  const seen = new Set();
  for (const m of tools.matchAll(/name:\s*'([a-z0-9_]+)',\n\s*description:/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({
      surface: 'mcp-tool', id: `mcp-tool:${m[1]}`, name: m[1], file: relT, line: lineAt(tools, m.index),
      entryPoint: true, hasHandler: handlers.has(m[1]),
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Scheduled jobs: the launchd labels monitor/install-agents.mjs generates for this machine. */
function extractJobs(root) {
  const rel = 'monitor/install-agents.mjs';
  const text = readOrThrow(join(root, rel));
  const out = [];
  const seen = new Set();
  for (const m of text.matchAll(/label:\s*(?:'(com\.portll\.[^']+)'|`(com\.portll\.[^`]+)`)/g)) {
    const raw = m[1] ?? m[2];
    const templated = raw.includes('${');
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push({
      surface: 'job', id: `job:${raw}`, name: raw, file: rel, line: lineAt(text, m.index),
      entryPoint: true, perArea: templated,
      ...(templated ? { undetermined: true, undeterminedWhy: 'one job per declared area — the concrete count comes from monitor/projects.json at install time' } : {}),
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Configuration flags: every CW_ / COMMITWORK_ name the tree reads, with its read-site count. */
function extractConfigFlags(root, files) {
  const sites = new Map();
  for (const rel of files) {
    if (!isScript(rel)) continue;
    const text = readOrNull(join(root, rel));
    if (text === null) continue;
    const testFile = isTest(rel);
    for (const m of text.matchAll(/process\.env\.((?:CW|COMMITWORK)_[A-Z0-9_]+)|process\.env\['((?:CW|COMMITWORK)_[A-Z0-9_]+)'\]|\$\{?((?:CW|COMMITWORK)_[A-Z0-9_]+)\}?/g)) {
      const name = m[1] ?? m[2] ?? m[3];
      let rec = sites.get(name);
      if (!rec) { rec = { reads: 0, testReads: 0, file: null, line: 0 }; sites.set(name, rec); }
      if (testFile) rec.testReads++;
      else {
        rec.reads++;
        if (!rec.file) { rec.file = rel; rec.line = lineAt(text, m.index); }
      }
    }
  }
  return [...sites.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, r]) => ({
    surface: 'config-flag', id: `config-flag:${name}`, name,
    file: r.file, line: r.line, entryPoint: r.reads > 0,
    readSites: r.reads, testOnlyReads: r.testReads,
    ...(r.reads === 0 ? { undetermined: true, undeterminedWhy: 'read only from test files — the production read site this override exists for is not in this tree' } : {}),
  }));
}

/** The published package surface: whatever `npm i` / `npx` exposes, plus the npm scripts. */
function extractPackageApis(root) {
  const rel = 'package.json';
  const text = readOrThrow(join(root, rel));
  let pkg;
  try { pkg = JSON.parse(text); }
  catch (e) { throw new Error(`feature-inventory: ${rel} does not parse (${e.message})`); }
  const out = [];
  for (const [name, target] of Object.entries(pkg.bin || {}).sort()) {
    out.push({
      surface: 'package-api', id: `package-api:bin/${name}`, name, file: rel,
      line: lineAt(text, text.indexOf(`"${name}"`)), entryPoint: true, kind: 'bin', target,
    });
  }
  for (const [name, cmd] of Object.entries(pkg.scripts || {}).sort()) {
    out.push({
      surface: 'package-api', id: `package-api:script/${name}`, name, file: rel,
      line: lineAt(text, text.indexOf(`"${name}":`)), entryPoint: true, kind: 'script', target: cmd,
    });
  }
  if (pkg.private === true) {
    out.push({
      surface: 'package-api', id: 'package-api:publish', name: '(npm publish)', file: rel,
      line: lineAt(text, text.indexOf('"private"')), entryPoint: false,
      kind: 'publish', undetermined: true,
      undeterminedWhy: '"private": true — nothing in package.json is published today, so every bin/export above is reachable only from a checkout',
    });
  }
  return out;
}

// ── probes: what counts as a test for, or a doc about, each feature ───────────────────────────────
// The probe is RECORDED on every feature so a reviewer can audit the claim rather than trust it.
// A weak probe is marked weak; a generic single word would otherwise manufacture coverage.
function probesFor(f) {
  switch (f.surface) {
    case 'cli-command': return { probes: ['commitwork.mjs', f.name], weak: true };
    case 'cli-script': return { probes: [f.name.split('/').pop()], weak: false };
    case 'http-route': return { probes: f.pathKind === 'literal' ? [f.name.split(' ')[1]] : [], weak: false };
    case 'ui-view': return { probes: [f.name], weak: true };
    case 'mcp-tool': return { probes: [f.name], weak: false };
    case 'job': return { probes: f.perArea ? [] : [f.name], weak: false };
    case 'config-flag': return { probes: [f.name], weak: false };
    case 'package-api': return { probes: [], weak: false };
    default: return { probes: [], weak: false };
  }
}

// ── assembly ─────────────────────────────────────────────────────────────────────────────────────

export function buildInventory({ root = inventoryRoot(), now = nowISO() } = {}) {
  const files = walk(root);
  const testFiles = files.filter((f) => f.endsWith('.test.mjs'));
  const docFiles = files.filter((f) => f.endsWith('.md'));
  const sourceFiles = files.filter((f) => isScript(f));

  const testIdx = buildTokenIndex(root, testFiles);
  const docText = new Map();
  for (const rel of docFiles) {
    const t = readOrNull(join(root, rel));
    if (t !== null) docText.set(rel, t);
  }

  const refIdx = buildReferenceIndex(root, files);
  const httpRoutes = extractHttpRoutes(root, files);
  const features = [
    ...extractCliCommands(root),
    ...extractCliScripts(root, files, refIdx),
    ...httpRoutes,
    ...extractUiViews(root),
    ...extractMcpTools(root),
    ...extractJobs(root),
    ...extractConfigFlags(root, sourceFiles),
    ...extractPackageApis(root),
  ];

  for (const f of features) {
    const { probes, weak } = probesFor(f);
    f.testProbe = probes;
    f.testProbeWeak = weak;
    // An EMPTY probe set means this surface was not measured for coverage — not that it has none.
    // Conflating the two put all 7 package.json entries and 2 per-area jobs in the census's
    // `fragment` bucket on the strength of a measurement nobody took.
    f.coverageMeasured = probes.length > 0;
    f.tests = probes.length ? lookupAll(testIdx, probes) : [];
    if (f.surface === 'http-route' && probes.length) {
      // A test may name the route with its method instead of as a bare path; either counts.
      f.testProbeRoute = f.name;
      const named = testIdx.get(routeKey(f.name));
      if (named) f.tests = [...new Set([...f.tests, ...named])].sort();
    }
    if (f.coreSibling) {
      f.coreSiblingTests = lookupAll(testIdx, [f.coreSibling.split('/').pop()]);
    }
    f.docs = probes.length
      ? [...docText.entries()].filter(([, t]) => probes.every((p) => t.includes(p))).map(([r]) => r).sort()
      : [];
    if (f.uiReachable === undefined) f.uiReachable = f.surface === 'ui-view';
  }

  const bySurface = {};
  for (const f of features) {
    const s = (bySurface[f.surface] ||= { total: 0, undetermined: 0, withTests: 0, withDocs: 0 });
    s.total++;
    if (f.undetermined) s.undetermined++;
    if (f.tests.length) s.withTests++;
    if (f.docs.length) s.withDocs++;
  }

  return {
    schema: 'commitwork.feature-inventory/1',
    generatedBy: 'bin/feature-inventory.mjs',
    generatedAt: now,
    root: '.',
    population: { filesWalked: files.length, sourceFiles: sourceFiles.length, testFiles: testFiles.length, docFiles: docFiles.length },
    skippedDirs: [...SKIP_DIRS].sort(),
    // Not features: `method:` anchors in admin/routes/ that belong to an OUTBOUND fetch. Reported
    // so the discrimination is auditable rather than invisible.
    outboundFetchAnchors: httpRoutes.outboundFetchAnchors ?? 0,
    surfaces: Object.fromEntries(Object.entries(bySurface).sort(([a], [b]) => (a < b ? -1 : 1))),
    totals: {
      features: features.length,
      undetermined: features.filter((f) => f.undetermined).length,
      withTests: features.filter((f) => f.tests.length).length,
      withDocs: features.filter((f) => f.docs.length).length,
    },
    features,
  };
}

function summarise(inv, only) {
  const lines = [`feature-inventory ${inv.schema} — ${inv.totals.features} features, ${inv.totals.undetermined} undetermined`];
  lines.push(`population: ${inv.population.filesWalked} files walked, ${inv.population.testFiles} tests, ${inv.population.docFiles} docs`);
  for (const [s, v] of Object.entries(inv.surfaces)) {
    if (only && s !== only) continue;
    lines.push(`  ${s.padEnd(14)} ${String(v.total).padStart(5)}  undetermined ${String(v.undetermined).padStart(4)}  with tests ${String(v.withTests).padStart(5)}  with docs ${String(v.withDocs).padStart(4)}`);
  }
  return lines.join('\n');
}

function main(argv) {
  let out = envStr('CW_FI_OUT') || join(inventoryRoot(), 'reports', 'features.json');
  let summaryOnly = false;
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' || a === '-o') out = argv[++i];
    else if (a === '--summary') summaryOnly = true;
    else if (a === '--surface') only = argv[++i];
    else if (a === '--help' || a === '-h') { console.log(readOrThrow(join(HERE, 'feature-inventory.mjs')).split('\n').slice(1, 22).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return 0; }
    else { console.error(`feature-inventory: unknown argument ${a}`); return 2; }
  }
  const inv = buildInventory();
  if (!summaryOnly) {
    writeAtomic(resolve(out), `${JSON.stringify(inv, null, 2)}\n`, { mkdir: true });
    console.log(`wrote ${relative(inventoryRoot(), resolve(out)) || out}`);
  }
  console.log(summarise(inv, only));
  return 0;
}

if (isMainModule(import.meta.url)) process.exitCode = main(process.argv.slice(2));
