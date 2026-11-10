// bin/lib/npm-graph.mjs — the resolved package graph of one npm project, read from the text of its
// package-lock.json (lockfileVersion 2 or 3). Pure: no npm, no registry, no network.
//
// A graph is { ecosystem, source, packages, unresolved } or { ecosystem, error }. `packages` maps
// `name@version` to { name, version, exposure, registry, paths }:
//   exposure  dev when every lockfile location of the pair is dev-only, else prod
//   registry  false for git, file and link sources, which no advisory database indexes by version
//   paths     up to three shortest dependency chains from the project root, as name@version lists
// `unresolved` lists the locations whose version the lockfile does not state.
//
// Other ecosystems add a reader with the same graph shape to GRAPH_READERS.

export const ECOSYSTEM = 'npm';
export const LOCKFILE = 'package-lock.json';
const MAX_PATHS = 3;
const DEP_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const NON_REGISTRY_RE = /^(git\+|git:|github:|gitlab:|bitbucket:|file:|link:)/;

export const pairKey = (name, version) => `${name}@${version}`;

/** The location a dependency of `from` named `name` resolves to, the way node's lookup walks up. */
export function resolveFrom(packages, from, name) {
  let base = from;
  for (;;) {
    const cand = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[cand]) return cand;
    if (!base) return null;
    const i = base.lastIndexOf('/node_modules/');
    base = i >= 0 ? base.slice(0, i) : '';
  }
}

const nameAt = (loc, entry) => entry.name || loc.slice(loc.lastIndexOf('node_modules/') + 'node_modules/'.length);
const isWorkspace = (loc) => loc !== '' && !loc.startsWith('node_modules/') && !loc.includes('/node_modules/');

function depNames(loc, entry) {
  const fields = loc === '' || isWorkspace(loc) ? [...DEP_FIELDS, 'devDependencies'] : DEP_FIELDS;
  return [...new Set(fields.flatMap((f) => Object.keys(entry[f] || {})))].sort();
}

/** Breadth-first from the root: each reachable location's parent on a shortest chain. */
function shortestParents(packages) {
  // Workspace members hang off the root without a dependency edge in the lockfile.
  const members = Object.keys(packages).filter(isWorkspace).sort();
  const parent = new Map([['', null], ...members.map((m) => [m, ''])]);
  const queue = ['', ...members];
  for (let i = 0; i < queue.length; i++) {
    const loc = queue[i];
    const entry = packages[loc] || {};
    for (const name of depNames(loc, entry)) {
      let to = resolveFrom(packages, loc, name);
      if (to && packages[to].link && typeof packages[to].resolved === 'string') to = packages[packages[to].resolved] ? packages[to].resolved : null;
      if (!to || parent.has(to)) continue;
      parent.set(to, loc);
      queue.push(to);
    }
  }
  return parent;
}

function chainOf(loc, parent, packages) {
  if (!parent.has(loc)) return null;
  const out = [];
  for (let at = loc; at; at = parent.get(at)) {
    const e = packages[at];
    out.unshift(isWorkspace(at) ? `${e.name || at} (workspace)` : pairKey(nameAt(at, e), e.version));
  }
  return out;
}

/** The graph, or { error } when the text is not a lockfile this reads. Never an empty graph for an unreadable one. */
export function readNpmGraph(text, { label = LOCKFILE } = {}) {
  let lock;
  try { lock = JSON.parse(text); } catch (e) { return { ecosystem: ECOSYSTEM, error: `${label} is not JSON (${e.message})` }; }
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) return { ecosystem: ECOSYSTEM, error: `${label} is not a JSON object` };
  const lv = lock.lockfileVersion;
  if (!(lv >= 2) || !lock.packages || typeof lock.packages !== 'object') {
    return { ecosystem: ECOSYSTEM, error: `${label} is lockfileVersion ${lv ?? 'unknown'}; this reads version 2 or 3 (npm 7 and later)` };
  }
  const packages = lock.packages;
  const parent = shortestParents(packages);
  const pairs = new Map();
  const unresolved = [];
  for (const loc of Object.keys(packages).sort()) {
    const e = packages[loc];
    if (loc === '' || isWorkspace(loc) || !e || typeof e !== 'object' || e.link) continue;
    if (typeof e.version !== 'string' || !e.version) { unresolved.push({ location: loc, reason: 'the lockfile states no version' }); continue; }
    const name = nameAt(loc, e);
    const key = pairKey(name, e.version);
    const p = pairs.get(key) || { name, version: e.version, exposure: 'dev', registry: true, chains: [] };
    if (!e.dev) p.exposure = 'prod';
    if (typeof e.resolved === 'string' && NON_REGISTRY_RE.test(e.resolved)) p.registry = false;
    const chain = chainOf(loc, parent, packages);
    if (chain) p.chains.push(chain);
    pairs.set(key, p);
  }
  const out = new Map();
  for (const [key, { chains, ...p }] of [...pairs].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const paths = chains.sort((a, b) => a.length - b.length || (a.join(' ') < b.join(' ') ? -1 : 1)).slice(0, MAX_PATHS);
    out.set(key, { ...p, paths });
  }
  return { ecosystem: ECOSYSTEM, source: `${label} v${lv}`, packages: out, unresolved };
}

/** Lockfile name → { ecosystem, read }. W5 adds Cargo.lock, go.sum, uv.lock and the rest here. */
export const GRAPH_READERS = Object.freeze({ [LOCKFILE]: Object.freeze({ ecosystem: ECOSYSTEM, read: readNpmGraph }) });
