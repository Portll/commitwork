// commitwork monitor — registry resolution shared by sweep.mjs / races.mjs. Two sources, merged:
// explicit `projects` entries (verbatim paths, `expand: children`) and `roots` auto-discovery
// (every git repo found becomes a project). Explicit always wins; `~/` resolves against the
// current home. Lifecycle superseded entries gate on effectiveFrom/effectiveTo vs the batch
// stamp; EXCLUDE beats lifecycle. urls: project `urls` map › project `url` › registry `urls` map.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { basename, delimiter, dirname, join, relative, resolve, sep } from 'node:path';
import { NAME_RE, loadRegistry } from './registry.mjs';

export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return homedir();
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}

const HERE = dirname(fileURLToPath(import.meta.url));
let _reg;
const registry = () => {
  // TWO defects lived in the line this replaces, and only one of them was visible.
  //
  // The PATH was monitor/projects.json — the pre-migration location. registryPath() resolves
  // monitor/private/projects.json, and on 2026-09-06 the two differed: 30 areas against 35, so
  // every consumer of this module swept a stale snapshot of the fleet and five areas were
  // invisible to it. A wrong file that parses is the quietest kind of wrong.
  //
  // The catch turned a malformed registry into `{}` — an EMPTY FLEET, returned as a success. That
  // is the precise failure the comment fifteen lines below this one already describes: "root
  // discovery was skipped, and the sweep rolled up an empty fleet without erroring." The defect
  // and the note complaining about it sat in the same file.
  //
  // loadRegistry throws instead, and it is memoised here, so an absent-but-legitimate registry
  // still narrates its example fallback exactly once rather than on every call.
  if (_reg === undefined) _reg = loadRegistry();
  return _reg;
};

// Library roots — the folders that actually hold this machine's checkouts.
// The registry pins paths as ~/Repositories/..., but not every machine keeps its library under
// $HOME: this one uses C:\Repositories, which is NOT below %USERPROFILE%. findRepoPath used to
// probe homedir only, so on such a machine every explicit project resolved missing, root
// discovery was skipped, and the sweep rolled up an empty fleet without erroring.
// Precedence: CW_LIBRARY_ROOTS env › registry `libraryRoots` › per-platform defaults.
// Non-existent roots are harmless — every consumer filters on existsSync.
export function libraryRoots() {
  const fromEnv = (process.env.CW_LIBRARY_ROOTS || '').split(delimiter).filter(Boolean);
  const declared = [...fromEnv, ...(registry().libraryRoots || [])].map(expandHome);
  const defaults = [join(homedir(), 'Repositories')];
  // Windows: the library is commonly a drive-root folder on the same drive as $HOME.
  if (process.platform === 'win32') defaults.push(join(`${homedir().slice(0, 2)}\\`, 'Repositories'));
  return [...new Set([...declared, ...defaults].map((p) => resolve(p)))];
}

const ORG_PREFIXES = ['', 'Portll', 'External/Portll'];

// First existing sibling-repo path for `rel` (e.g. 'client-a/services'), env override first.
// Fleet checkouts live at <libraryRoot>/<rel>, <libraryRoot>/Portll/<rel>, or
// <libraryRoot>/External/Portll/<rel> depending on the machine — never a literal /Users/<user>.
// Falls back to the first candidate so absent-path errors stay meaningful.
export function findRepoPath(rel, envVal = '') {
  const cands = [envVal, ...libraryRoots().flatMap((root) => ORG_PREFIXES.map((org) => join(root, org, rel)))].filter(Boolean);
  return cands.find((p) => existsSync(p)) || cands[envVal ? 1 : 0];
}

// A declared root (e.g. ~/Repositories, or ~/Repositories/Portll) re-pointed at whichever
// library root exists on this machine, preserving any tail below the library folder.
function healRoot(rootPath) {
  if (existsSync(rootPath)) return rootPath;
  const m = /(?:^|[\\/])Repositories(?:[\\/](.*))?$/.exec(rootPath);
  if (!m) return rootPath;
  const tail = m[1] || '';
  return libraryRoots().map((r) => (tail ? join(r, tail) : r)).find((p) => existsSync(p)) || rootPath;
}

// a `.git` entry (dir, or file for worktrees/submodules) marks a repo; repos are leaves — never descended into
const isGitRepo = (dir) => existsSync(join(dir, '.git'));

/**
 * Is `dir` a linked worktree of `self` — this checkout under another name?
 *
 * `selfRoot` was excluded by PATH, which covers the checkout and nothing else. A
 * `git worktree add ../commitwork-comments` puts a second full copy of every tracked file beside
 * it, and the roots walk enlisted that copy as a 205th project belonging to no area. Measured
 * 2026-09-06: it reddened `registry-coverage.test.mjs` on both of its assertions, and a second
 * guard read commitwork's own retired-host dial through the copy while commitwork itself stayed
 * exempt. Neither is a defect in a commit — the cause was on disk, so no bisect could converge on it.
 *
 * Identity is the `.git` FILE's gitdir resolving under our own `.git`, never the directory name:
 * the session-start hook recommends exactly these siblings (`commitwork-<date>`), so the names vary
 * and a name rule would go stale on the next one. A `.git` DIRECTORY is a repository in its own
 * right and stays discoverable — including a clone of this repo, which is genuinely a separate
 * subject with its own history.
 */
function isLinkedWorktreeOf(dir, self) {
  if (!self) return false;
  const dotGit = join(dir, '.git');
  let st;
  try { st = statSync(dotGit); } catch { return false; }
  if (!st.isFile()) return false;
  let text;
  try { text = readFileSync(dotGit, 'utf8'); } catch { return false; }
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
  if (!m) return false;
  const gitdir = resolve(dir, m[1]);
  const own = resolve(self, '.git');
  return gitdir === own || gitdir.startsWith(own + sep);
}

/**
 * The checkout a linked worktree belongs to, or null. A `.git` FILE whose gitdir sits under another
 * checkout's `.git/worktrees/` is that checkout on another branch. The fleet declares the checkout,
 * a scan of the worktree files every finding twice, and `git worktree remove` makes the directory
 * vanish with no commit anywhere. The walk skips it only when the owner is itself a repository
 * under the same root, so a worktree of something the walk cannot see stays visible and is
 * reported as undeclared in its own right.
 */
function linkedWorktreeOwner(dir) {
  const dotGit = join(dir, '.git');
  let st;
  try { st = statSync(dotGit); } catch { return null; }
  if (!st.isFile()) return null;
  let text;
  try { text = readFileSync(dotGit, 'utf8'); } catch { return null; }
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
  if (!m) return null;
  const owner = /^(.*)\/\.git\/worktrees\/[^/]+\/?$/.exec(resolve(dir, m[1]));
  return owner ? owner[1] : null;
}

const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', 'vendor', 'reports']);

function* walkRepos(dir, depthLeft, exclude) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_') || SKIP_DIRS.has(e.name) || exclude.has(e.name)) continue;
    const child = join(dir, e.name);
    if (isGitRepo(child)) { yield child; continue; }
    if (depthLeft > 1) yield* walkRepos(child, depthLeft - 1, exclude);
  }
}

// -> { repos: [{name, path, manifest, url, source}], superseded: {name: {…lifecycle, path}}, notes: [string] }
// `only` matches an explicit project entry name or a discovered repo name (old sweep semantics).
// `selfRoot` (commitwork's own checkout) is never auto-discovered.
// `stamp` (14-digit batch stamp) gates lifecycle entries; defaults to now.
export function resolveRepos(reg, { only = null, selfRoot = null, stamp = null } = {}) {
  const globalExclude = new Set(reg.exclude || []);
  const at = stamp || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const LIFECYCLE = reg.lifecycle || {};
  const lcSuperseded = (n) => { const l = LIFECYCLE[n]; return !!(l && l.state === 'superseded' && !globalExclude.has(n) && l.effectiveFrom && at >= l.effectiveFrom && (!l.effectiveTo || at < l.effectiveTo)); };
  // SUPERSEDED IS A LABEL, NOT AN EXCLUSION — standby code is scanned and carries
  // `superseded: {...}`; set scanSuperseded:false in the registry to restore the old skip.
  const scanSuperseded = reg.scanSuperseded !== false;
  const superseded = {}; // name -> { state, supersededBy, effectiveFrom, note, path } — recorded either way
  const notes = [];
  const repos = [];
  const explicitPaths = [];

  for (const p of reg.projects || []) {
    if (only && p.name !== only) continue;
    let path = resolve(expandHome(p.path));
    // Machine-portability self-heal: if the configured path is missing, retry findRepoPath on the
    // repo-relative tail — org prefixes differ per machine
    if (!existsSync(path)) {
      const m = /(?:^|\/)Repositories\/(?:Portll\/|External\/Portll\/)?(.+)$/.exec(path);
      if (m) { const healed = findRepoPath(m[1]); if (existsSync(healed)) path = healed; }
    }
    explicitPaths.push(path);
    if (p.expand === 'children' && existsSync(path)) {
      for (const d of readdirSync(path)) {
        if (globalExclude.has(d) || d.startsWith('.')) continue;
        const child = join(path, d);
        const lcS = lcSuperseded(d);
        if (lcS) superseded[d] = { ...LIFECYCLE[d], path: child };
        if (lcS && !scanSuperseded) continue;
        const url = (p.urls && p.urls[d]) || p.url || (reg.urls && reg.urls[d]) || '';
        // registryKey ties a child back to its declaring entry, so area resolution never has to
        // re-derive ownership from the child's name.
        if (statSync(child).isDirectory()) repos.push({ name: d, registryKey: `${p.name}/${d}`, area: p.area, path: child, manifest: p.manifest, url, source: 'explicit',
          ...(lcS ? { superseded: { ...LIFECYCLE[d] } } : {}) });
      }
    } else {
      const lcS = lcSuperseded(p.name);
      if (lcS) superseded[p.name] = { ...LIFECYCLE[p.name], path };
      if (lcS && !scanSuperseded) continue;
      repos.push({ name: p.name, registryKey: p.name, area: p.area, path, manifest: p.manifest, url: p.url || (reg.urls && reg.urls[p.name]) || '', source: 'explicit',
        ...(lcS ? { superseded: { ...LIFECYCLE[p.name] } } : {}) });
    }
  }

  const covered = (p) => explicitPaths.some((ep) => ep === p || ep.startsWith(p + sep) || p.startsWith(ep + sep));
  const taken = new Set(repos.map((r) => r.name));
  const self = selfRoot ? resolve(selfRoot) : null;

  for (const root of reg.roots || []) {
    const declared = resolve(expandHome(root.path));
    const rootPath = healRoot(declared);
    if (!existsSync(rootPath)) { notes.push(`root missing, skipped: ${root.path}`); continue; }
    if (rootPath !== declared) notes.push(`root healed: ${root.path} -> ${rootPath}`);
    const exclude = new Set([...globalExclude, ...(root.exclude || [])]);
    const manifest = root.manifest || reg.defaultManifest || 'security-baseline';
    for (const repoPath of walkRepos(rootPath, root.maxDepth || 1, exclude)) {
      if (repoPath === self || covered(repoPath)) continue;
      // Skipped LOUDLY: a worktree of this checkout is this checkout, so scanning it would
      // double-count every finding against one subject — but a silent skip is how a repo that
      // should have been declared disappears instead.
      if (isLinkedWorktreeOf(repoPath, self)) { notes.push(`skipped (linked worktree of this checkout): ${repoPath}`); continue; }
      const owner = linkedWorktreeOwner(repoPath);
      if (owner && isGitRepo(owner) && owner.startsWith(rootPath + sep)) { notes.push(`skipped (linked worktree of ${owner}): ${repoPath}`); continue; }
      let name = basename(repoPath);
      // A discovered name is UNTRUSTED and reaches the filesystem and the panel's DOM —
      // constrain at the source; skip loudly
      if (!NAME_RE.test(name)) { notes.push(`skipped (name not [A-Za-z0-9._-]): ${repoPath}`); continue; }
      // registryKey survives the collision rename below, so a repo renamed here still resolves
      // to its declared area (which is keyed on the original identity, not the display name).
      const registryKey = relative(rootPath, repoPath).split(sep).join('/');
      if (taken.has(name)) name = relative(rootPath, repoPath).split(sep).join('-');
      for (let i = 2; taken.has(name); i++) name = `${basename(repoPath)}-${i}`;
      if (only && name !== only) continue;
      const lcS = lcSuperseded(name);
      if (lcS) superseded[name] = { ...LIFECYCLE[name], path: repoPath };
      if (lcS && !scanSuperseded) continue;
      taken.add(name);
      repos.push({ name, registryKey, path: repoPath, manifest, url: (reg.urls && reg.urls[name]) || '', source: `root:${root.path}`,
        ...(lcS ? { superseded: { ...LIFECYCLE[name] } } : {}) });
    }
  }
  return { repos, superseded, notes };
}
