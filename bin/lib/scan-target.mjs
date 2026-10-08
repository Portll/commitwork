// bin/lib/scan-target.mjs — what a scan may be pointed at, and where its private output goes. Shared by
// the panel's scan-path route (admin/routes/scan-path.mjs) and `commitwork brief`, so a terminal and the
// panel refuse the same paths for the same reasons (admin/SPEC-scan-path.md, R4 and R8).
import { isAbsolute, resolve, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_SEGMENTS, DECLARABLE_CREDENTIALS, assertMountAllowed } from './sandbox.mjs';
import { findGitRepos } from '../../lib/repo-walk.mjs';

export const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const within = (p, root) => p === root || p.startsWith(root.endsWith('/') ? root : `${root}/`);
const overlaps = (a, b) => within(a, b) || within(b, a);
const realOr = (p) => { try { return realpathSync(p); } catch { return p; } };
// One output root or several: the sidecar, and an --out named somewhere else.
const outBases = (outBase) => [].concat(outBase || []).filter(Boolean).map(realOr);

/** The credential stores bin/lib/sandbox.mjs denies or masks, under the real home directory, and
 *  where each resolves to when it is a link. */
export function credentialStores(home) {
  const h = realOr(home);
  const stores = [...FORBIDDEN_SEGMENTS.map((s) => `${h}/${s}`), `${h}/Library/Keychains`, '/Library/Keychains',
    ...DECLARABLE_CREDENTIALS.map((s) => `${h}/${s}`)];
  return [...new Set(stores.flatMap((s) => [s, realOr(s)]))];
}

/**
 * System directories, refused with everything under them on the typed spelling and on the realpath
 * (operator ruling 2026-09-29). One list for macOS and Linux: a root this machine lacks refuses
 * nothing. `temp` is carved back out because scanning a throwaway clone is the normal use, and on
 * macOS every temp directory sits under a refused root: /tmp is /private/tmp, and os.tmpdir() is
 * /var/folders/…, which resolves to /private/var/folders/…. /Volumes is absent on purpose:
 * external drives hold scan corpora.
 */
export const SYSTEM_PATHS = Object.freeze({
  roots: Object.freeze([
    '/System', '/Library', '/usr', '/bin', '/sbin', '/etc', '/var', '/private', '/dev', '/cores', '/opt', '/Applications',
    '/proc', '/sys', '/boot', '/lib', '/lib64', '/run', '/root', '/snap', '/srv',
  ]),
  temp: Object.freeze(['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', '/var/folders', '/private/var/folders']),
});

/** The system root `p` is or is under, or null. Lexical: `p` must already be normalised. */
export function systemRoot(p) {
  if (SYSTEM_PATHS.temp.some((t) => within(p, t))) return null;
  return SYSTEM_PATHS.roots.find((r) => within(p, r)) || null;
}

function lexicalRefusal(p) {
  try { assertMountAllowed(p); }
  catch (e) { return `refusing to scan ${p}: ${e.message.replace(/^sandbox: refusing to mount (\S+ — )?/, '')}`; }
  const root = systemRoot(p);
  return root ? `refusing to scan ${p}: ${p === root ? 'it is' : 'it is inside'} the system directory ${root}` : null;
}

/** {ok:true, path:<realpath>} or {ok:false, error}. Nothing but the realpath may reach argv. */
export function resolveScanPath(input, { home = homedir(), checkout = CHECKOUT, outBase = null } = {}) {
  const no = (error) => ({ ok: false, error });
  if (typeof input !== 'string' || !input) return no('body must be {"path": "<absolute path to a directory>"}');
  if (!isAbsolute(input)) return no(`not an absolute path: ${input} (a relative path would resolve against the panel's working directory)`);
  // The typed spelling first, before anything is touched: on macOS /private/etc and /etc name one
  // directory, and only one of them resolves to the other.
  const typed = resolve(input);
  let why = lexicalRefusal(typed);
  if (why) return no(why);
  let real;
  try { real = realpathSync(input); }
  catch (e) { return no(e.code === 'ENOENT' ? `no such path: ${input}` : `${input} could not be resolved (${e.code || e.message})`); }
  let st;
  try { st = statSync(real); } catch (e) { return no(`${real} could not be read (${e.code || e.message})`); }
  if (!st.isDirectory()) return no(`not a directory: ${real} (scan takes a directory and scans the git repositories under it)`);
  if (real !== typed && (why = lexicalRefusal(real))) return no(why);
  const store = credentialStores(home).find((s) => overlaps(real, s));
  if (store) return no(`refusing to scan ${real}: it overlaps the credential store ${store}`);
  const cw = realOr(checkout);
  if (within(real, cw)) return no(`refusing to scan ${real}: it is the commitwork checkout the panel runs from, which holds git-excluded keys, fleet configuration and every prior report; the scheduled sweep scans it under its declared area`);
  if (within(cw, real)) return no(`refusing to scan ${real}: it contains the commitwork checkout ${cw}, and discovery would scan the checkout's git-excluded keys, fleet configuration and reports with everything else; scan a directory beside it`);
  const base = outBases(outBase).find((b) => overlaps(real, b));
  if (base) return no(`refusing to scan ${real}: it overlaps ${base}, where scan output goes; the scan would read earlier reports and write into the tree it is reading`);
  return { ok: true, path: real };
}

// Where a path scan's output goes: private material, by operator ruling 2026-09-29, so never the
// checkout's reports/. The sidecar next to the checkout (CW_SIDECAR) by default; a public install
// has none and names a private directory in CW_SCAN_PATH_OUT. Fail closed: no existing directory,
// no scan. {ok, base, dir} or {ok:false, dir, error}; `base` is the directory that must exist, and
// a refusal still names `dir` so a log path can be computed without anything being written.
export function scanOutDir({ checkout = CHECKOUT } = {}) {
  const set = process.env.CW_SCAN_PATH_OUT;
  const sidecar = process.env.CW_SIDECAR || resolve(checkout, '..', 'commitwork-sidecar');
  const want = set || sidecar;
  const at = (b) => (set ? b : join(b, 'reports', 'scan-path'));
  const no = (why) => ({ ok: false, dir: at(want), error: `refusing to start a scan: ${why}. Scan output is private and is never written into the checkout's reports/; set CW_SCAN_PATH_OUT to an existing private directory${set ? '' : ` or create the sidecar at ${sidecar} (CW_SIDECAR)`}` });
  if (!isAbsolute(want)) return no(`${set ? 'CW_SCAN_PATH_OUT' : 'CW_SIDECAR'} is not an absolute path: ${want}`);
  let base;
  try { base = realpathSync(want); if (!statSync(base).isDirectory()) return no(`${want} is not a directory`); }
  catch (e) { return no(`${want} is not an existing directory (${e.code || e.message})`); }
  let cw = checkout;
  try { cw = realpathSync(checkout); } catch { /* compared lexically */ }
  if (base === cw || base.startsWith(`${cw}/`)) return no(`${want} is inside the commitwork checkout ${cw}`);
  return { ok: true, base, dir: at(base) };
}

// Directory names a whole-machine walk never enters: dependency and tool caches, the macOS Library,
// the trash, and the first segment of every credential store.
const PC_PRUNE = Object.freeze(['node_modules', 'Library', '.Trash', '.cache', '.npm', '.pnpm-store', '.yarn', '.cargo', '.rustup',
  '.gradle', '.m2', '.local', '.vscode', '.cursor',
  ...new Set([...FORBIDDEN_SEGMENTS, ...DECLARABLE_CREDENTIALS].map((s) => s.split('/')[0]))]);

// A checkout and, when it is a linked worktree, the main checkout it belongs to: both hold the same
// git-excluded keys, fleet configuration and reports.
export function checkoutsOf(checkout) {
  const r = spawnSync('git', ['-C', checkout, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', timeout: 10_000 });
  const main = r.status === 0 && r.stdout.trim().endsWith('/.git') ? dirname(r.stdout.trim()) : null;
  return [...new Set([realOr(checkout), ...(main ? [realOr(main)] : [])])];
}

// A directory directly holding this many repositories is a collection (a corpus or a mirror), not
// someone's projects. Read at call time.
export const collectionMin = () => Number(process.env.CW_PC_COLLECTION_MIN) || 100;

/**
 * Every git repository under the home directory, for a whole-machine scan. Home is never one scan
 * target: each repository is scanned on its own. A repository that overlaps a credential store, a
 * commitwork checkout, the output directory or a system directory is excluded with its reason, and
 * a collection is set aside unless includeCollections.
 * -> { repos, collections: [{dir, count}], excluded: [{path, reason}], errors: [{path, code}] }
 */
export function discoverPcRepos({ home = homedir(), checkout = CHECKOUT, outBase = null, skip = [], maxDepth = 6, includeCollections = false } = {}) {
  const found = findGitRepos([home], { maxDepth, prune: PC_PRUNE, skip });
  const stores = credentialStores(home);
  const checkouts = checkoutsOf(checkout);
  const bases = outBases(outBase);
  const kept = [];
  const excluded = [];
  for (const p of found.repos) {
    const real = realOr(p);
    const store = stores.find((s) => overlaps(real, s));
    const cw = checkouts.find((c) => overlaps(real, c));
    const base = bases.find((b) => overlaps(real, b));
    const reason = store ? `overlaps the credential store ${store}`
      : cw ? (within(real, cw) ? `is the commitwork checkout ${cw}` : `contains the commitwork checkout ${cw}`)
        : base ? `overlaps ${base}, where scan output goes`
          : systemRoot(real) ? `is inside the system directory ${systemRoot(real)}` : null;
    if (reason) excluded.push({ path: real, reason }); else kept.push(real);
  }
  const perParent = new Map();
  for (const r of kept) perParent.set(dirname(r), (perParent.get(dirname(r)) || 0) + 1);
  const min = collectionMin();
  const collections = [...perParent].filter(([, n]) => n >= min).map(([dir, count]) => ({ dir, count })).sort((a, b) => b.count - a.count || (a.dir < b.dir ? -1 : 1));
  const set = new Set(collections.map((c) => c.dir));
  const repos = [...new Set(kept.filter((r) => includeCollections || !set.has(dirname(r))))].sort();
  return { repos, collections, excluded, errors: found.errors };
}
