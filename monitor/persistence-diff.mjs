// monitor/persistence-diff.mjs — the persistence-diff host lens: what starts on this box without
// being asked, and did that set change? Persistence is the classic host-compromise signal, and it
// is the most machine-decidable layer there is — a launch agent either exists or it does not.
//
// Inventory per OS (the mutable persistence surface, not the vendor-sealed one):
//   darwin  ~/Library/LaunchAgents, /Library/LaunchAgents, /Library/LaunchDaemons (every file, not
//           just *.plist — a stray file in a launchd dir is itself worth seeing), user crontab,
//           shell profiles (~/.zshrc family). /System is SIP-sealed and excluded: diffing what
//           cannot mutate buries the signal in vendor noise. Then the surfaces that start code or
//           redirect it without being launchd at all: editor extensions (~/.vscode, ~/.cursor,
//           ~/.windsurf — an extension is code the editor loads at every start, and an update is
//           indistinguishable from a compromise unless something diffs it), sudoers, the ssh
//           authorized-keys/config/rc/environment set, git's global config (hooksPath,
//           credential.helper and includeIf all redirect execution), /etc/hosts and /etc/resolver,
//           pam's sudo stack, /Library/Extensions, the system-extension and configuration-profile
//           lists, and the user's background-task (login item) store.
//   linux   /etc/systemd/system, ~/.config/systemd/user, /etc/cron.d, user crontab, shell profiles,
//           and the obvious equivalents of the above: editor extensions, sudoers, ssh, git config,
//           /etc/hosts, pam sudo, /etc/ld.so.preload.
//   win32   HKLM/HKCU Run keys + service list via reg/sc, editor extensions, git config
//           (best-effort; the adapter shape is what travels — this box cannot exercise it).
//
// Each item is (path|key, kind, sha256, size). CONTENT IS NEVER STORED — a plist can carry another
// party's paths and arguments, and this baseline lives in a store an audit may quote. mtime is
// deliberately not identity and not compared: it moves for reasons that are not changes.
//
// Baseline in .claude/store/ (the operator's sidecar), moved only by --accept — same discipline as
// scanner-binary.mjs. Diff: added (THE signal), changed, removed. An unreadable item or source is
// unknown('not-permitted'/'tool-failed'), counted and shown, never silently skipped and never a
// finding. Unreadable baseline fails closed; only ENOENT is "no baseline yet".
//
// BASELINE COMPATIBILITY, which is the whole reason `surfaces` exists. An accepted baseline
// predates every surface added after it, so an item of a kind it never covered is not "new on this
// box" — it is "never looked at before", and publishing it as `added` would hand the operator 37
// editor extensions as a compromise report on the day this shipped. --accept records the kinds it
// covered; the diff routes anything outside them to `unbaselined` (state 'partial', "re-run
// --accept"), never to a finding. A baseline with no `surfaces` field at all is read as covering
// everything except the kinds in NEW_KINDS — the same judgement, made for a file written before
// the field existed.
//
// Env (read at call time): CW_PERSIST_BASELINE, CW_PERSIST_HOME, CW_NOW.
//
//   node monitor/persistence-diff.mjs [--json]   diff observed vs baseline; exit 0 ok, 1 findings,
//                                                2 grey (no baseline / unknowns only)
//   node monitor/persistence-diff.mjs --accept   pin the currently observed inventory

import { nowISO } from '../lib/clock.mjs';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unknown } from './unknown.mjs';
import { writeAtomic } from './lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = () => process.env.CW_PERSIST_BASELINE || join(REPO, '.claude', 'store', 'persistence-baseline.json');
const homeDir = () => process.env.CW_PERSIST_HOME || homedir();

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * The kinds that did not exist before 2026-09-18, in the form a baseline without a `surfaces`
 * field is judged against. Sorted, frozen, and the ONLY place the compatibility rule is written
 * down — a kind added here and nowhere else still fails safe: unbaselined, never `added`.
 */
export const NEW_KINDS = Object.freeze([
  'config-profile', 'editor-extension', 'git-config', 'hosts', 'kext', 'ld-preload',
  'login-item', 'pam', 'resolver', 'ssh', 'sudoers', 'system-extension',
]);

// An extension directory is identified by its manifest, not by its tree: the tree carries compiled
// bundles and caches that churn without the extension changing. A kext is the same bargain one
// layer down — Info.plist names the bundle id, version and the executable it loads.
const EXTENSION_MANIFEST = Object.freeze(['package.json']);
const KEXT_MANIFEST = Object.freeze(['Contents/Info.plist', 'Info.plist']);

const editorExtensionRoots = (home) =>
  ['.vscode', '.cursor', '.windsurf'].map((d) => ({ dir: join(home, d, 'extensions'), kind: 'editor-extension', manifest: EXTENSION_MANIFEST }));

// git honours HOME, so the command source must read the same home the file sources do — otherwise
// a fixture home hashes one box's files and the real box's global config.
const gitConfigCommand = (home) => ({
  key: 'git-config-global', kind: 'git-config', cmd: 'git', args: ['config', '--global', '--list'],
  env: { HOME: home }, emptyExit: /unable to read config file/i,
});

const sshFiles = (home) => ['authorized_keys', 'config', 'rc', 'environment'].map((f) => ({ path: join(home, '.ssh', f), kind: 'ssh' }));
const gitConfigFiles = (home) => [{ path: join(home, '.gitconfig'), kind: 'git-config' }, { path: join(home, '.config', 'git', 'config'), kind: 'git-config' }];

/** The per-OS surface: file roots (scanned flat), single files, profile files, and command sources. */
export function surfaceFor(platform = process.platform, home = homeDir()) {
  if (platform === 'darwin') {
    return {
      roots: [
        { dir: join(home, 'Library', 'LaunchAgents'), kind: 'launchagent-user' },
        { dir: '/Library/LaunchAgents', kind: 'launchagent-system' },
        { dir: '/Library/LaunchDaemons', kind: 'launchdaemon' },
        ...editorExtensionRoots(home),
        { dir: '/etc/sudoers.d', kind: 'sudoers' },
        { dir: '/etc/resolver', kind: 'resolver' },
        { dir: '/Library/Extensions', kind: 'kext', manifest: KEXT_MANIFEST },
        { dir: join(home, 'Library', 'Application Support', 'com.apple.backgroundtaskmanagementagent'), kind: 'login-item' },
      ],
      files: [
        { path: '/etc/sudoers', kind: 'sudoers' },
        ...sshFiles(home),
        ...gitConfigFiles(home),
        { path: '/etc/hosts', kind: 'hosts' },
        { path: '/etc/pam.d/sudo', kind: 'pam' },
        { path: '/etc/pam.d/sudo_local', kind: 'pam' },
      ],
      profiles: ['.zshrc', '.zprofile', '.zshenv', '.bash_profile', '.bashrc', '.profile'].map((f) => join(home, f)),
      commands: [
        { key: 'crontab', kind: 'cron', cmd: 'crontab', args: ['-l'], emptyExit: /no crontab for/i },
        gitConfigCommand(home),
        { key: 'systemextensionsctl', kind: 'system-extension', cmd: 'systemextensionsctl', args: ['list'] },
        // Exit 0 with this sentence is a real answer meaning "none installed" — the same shape as
        // "no crontab for", and hashing it would make the first installed profile read as CHANGED
        // rather than as the thing that appeared. Wording taken from the tool, not from memory.
        { key: 'profiles-list', kind: 'config-profile', cmd: 'profiles', args: ['list'], emptyOut: /^There are no configuration profiles installed/m },
        // Background Task Management: the login-item/agent register launchd itself consults. Never
        // under sudo — on a box where it needs root the failure is unknown('not-permitted'), which
        // is the honest reading of a store we were not allowed to see.
        { key: 'sfltool-dumpbtm', kind: 'login-item', cmd: 'sfltool', args: ['dumpbtm'], timeoutMs: 20000, notPermitted: /root|privilege|not permitted|Operation not permitted/i },
      ],
    };
  }
  if (platform === 'win32') {
    return {
      roots: editorExtensionRoots(home),
      files: gitConfigFiles(home),
      profiles: [],
      commands: [
        { key: 'run-hklm', kind: 'runkey', cmd: 'reg', args: ['query', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'] },
        { key: 'run-hkcu', kind: 'runkey', cmd: 'reg', args: ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'] },
        { key: 'services', kind: 'service', cmd: 'sc', args: ['query', 'type=', 'service', 'state=', 'all'] },
        gitConfigCommand(home),
      ],
    };
  }
  return {
    roots: [
      { dir: '/etc/systemd/system', kind: 'systemd-system' },
      { dir: join(home, '.config', 'systemd', 'user'), kind: 'systemd-user' },
      { dir: '/etc/cron.d', kind: 'cron-d' },
      ...editorExtensionRoots(home),
      { dir: join(home, '.vscode-server', 'extensions'), kind: 'editor-extension', manifest: EXTENSION_MANIFEST },
      { dir: '/etc/sudoers.d', kind: 'sudoers' },
    ],
    files: [
      { path: '/etc/sudoers', kind: 'sudoers' },
      ...sshFiles(home),
      ...gitConfigFiles(home),
      { path: '/etc/hosts', kind: 'hosts' },
      { path: '/etc/pam.d/sudo', kind: 'pam' },
      { path: '/etc/ld.so.preload', kind: 'ld-preload' },
    ],
    profiles: ['.zshrc', '.zprofile', '.bash_profile', '.bashrc', '.profile'].map((f) => join(home, f)),
    commands: [
      { key: 'crontab', kind: 'cron', cmd: 'crontab', args: ['-l'], emptyExit: /no crontab for/i },
      gitConfigCommand(home),
    ],
  };
}

/** Every kind a surface DECLARES — what --accept pins as covered, items or no items. A kind with
 *  nothing in it today is still covered: the first file to appear there is then `added`, which is
 *  exactly the event this lens exists for. */
export function surfaceKinds(s) {
  const kinds = new Set();
  for (const r of s.roots || []) kinds.add(r.kind);
  for (const f of s.files || []) kinds.add(f.kind);
  if ((s.profiles || []).length) kinds.add('shell-profile');
  for (const c of s.commands || []) kinds.add(c.kind);
  return [...kinds].sort();
}

/**
 * A directory entry that is itself a directory — an editor extension, a kext bundle.
 *
 * `manifest` names the file that identifies it; the FIRST one that reads wins (a kext keeps its
 * Info.plist under Contents/, an old one at the root). A directory with no manifest declared is
 * hashed over its sorted child NAMES: not content, but enough that a directory appearing inside a
 * launchd root, or growing a new child, is an observation rather than a silent skip.
 */
function hashDirectory(dirPath, manifest) {
  for (const rel of manifest || []) {
    const p = join(dirPath, ...rel.split('/'));
    try { const buf = readFileSync(p); return { sha256: sha(buf), size: buf.length }; }
    catch (e) {
      if (e.code === 'ENOENT') continue;                      // try the next declared manifest
      throw e;                                                 // unreadable ⇒ the caller records unknown
    }
  }
  // A declared manifest that is nowhere in the bundle: there is nothing to identify it BY, which is
  // its own state and not a hash over the next-best thing.
  if (manifest && manifest.length) return null;
  const names = readdirSync(dirPath).sort();
  const listing = `dir\n${names.join('\n')}\n`;
  return { sha256: sha(listing), size: Buffer.byteLength(listing) };
}

/** One filesystem path → an item, an unknown, or null (ENOENT: legitimately absent). */
function collectPath(p, kind, manifest) {
  try {
    const st = statSync(p);
    if (st.isDirectory()) {
      const h = hashDirectory(p, manifest);
      if (!h) return { unknown: { id: p, kind, ...unknown('no-subject', `no ${(manifest || []).join(' or ')}`) } };
      return { item: { id: p, kind, sha256: h.sha256, size: h.size } };
    }
    // Sockets, fifos and devices are not read: hashing one can block forever, and a lens must not
    // be the thing that hangs a sweep.
    if (!st.isFile()) return null;
    return { item: { id: p, kind, sha256: sha(readFileSync(p)), size: st.size } };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    return { unknown: { id: p, kind, ...unknown('not-permitted', e.code) } };
  }
}

/**
 * Observe the persistence surface. Returns { items, unknowns, surfaces }.
 * items: [{ id, kind, sha256, size }] — id is the absolute path or the command key.
 * surfaces: every kind this surface declares, for --accept to pin (see the compatibility rule).
 * ENOENT on a root/file/profile is legitimate emptiness; EACCES and friends land in unknowns.
 */
export function collectPersistence({ platform, home, exec = execFileSync, surface } = {}) {
  const s = surface || surfaceFor(platform, home);
  const items = [];
  const unknowns = [];
  const take = (r) => { if (!r) return; if (r.item) items.push(r.item); else unknowns.push(r.unknown); };

  for (const root of s.roots || []) {
    let names;
    try { names = readdirSync(root.dir); }
    catch (e) {
      if (e.code === 'ENOENT') continue;   // a machine without this root has nothing persisted there
      unknowns.push({ id: root.dir, kind: root.kind, ...unknown('not-permitted', e.code) });
      continue;
    }
    for (const name of names.sort()) take(collectPath(join(root.dir, name), root.kind, root.manifest));
  }

  for (const f of s.files || []) take(collectPath(f.path, f.kind));
  for (const p of s.profiles || []) take(collectPath(p, 'shell-profile'));

  for (const c of s.commands || []) {
    try {
      const out = String(exec(c.cmd, c.args, {
        encoding: 'utf8', timeout: c.timeoutMs || 5000, maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'], ...(c.env ? { env: { ...process.env, ...c.env } } : {}),
      }));
      if (c.emptyOut && c.emptyOut.test(out)) continue;      // the tool's own way of saying "none"
      items.push({ id: c.key, kind: c.kind, sha256: sha(out), size: Buffer.byteLength(out) });
    } catch (e) {
      const text = `${e.stdout || ''}\n${e.stderr || ''}\n${e.message || ''}`;
      if (c.emptyExit && c.emptyExit.test(text)) continue;   // "no crontab" is legitimately empty
      // A store that needs privilege we will not take is withheld evidence, not a broken tool.
      const reason = c.notPermitted && c.notPermitted.test(text) ? 'not-permitted' : 'tool-failed';
      unknowns.push({ id: c.key, kind: c.kind, ...unknown(reason, e.code || (e.status != null ? `exit ${e.status}` : 'error')) });
    }
  }

  return { items: items.sort((a, b) => (a.id < b.id ? -1 : 1)), unknowns, surfaces: surfaceKinds(s) };
}

/** ENOENT is "no baseline yet"; anything else THROWS. */
export function readBaseline() {
  let raw;
  try { raw = readFileSync(baselinePath(), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const b = JSON.parse(raw);
  if (!b || !Array.isArray(b.items)) throw new Error('baseline has no items[]');
  return b;
}

/**
 * Does this baseline cover that kind? A recorded `surfaces` list is the answer; a baseline written
 * before the field existed covers everything EXCEPT the kinds added since (NEW_KINDS). Read this
 * way round on purpose: a kind nobody has thought about yet lands in `unbaselined`, which costs the
 * operator one `--accept`, where the other direction costs them a fabricated compromise report.
 */
export const baselineCovers = (baseline, kind) =>
  (Array.isArray(baseline?.surfaces) ? baseline.surfaces.includes(kind) : !NEW_KINDS.includes(kind));

/** Pure diff. Identity is the item id (a place), never its bytes or times. */
export function diffPersistence(observed, baseline) {
  const now = new Map(observed.items.map((i) => [i.id, i]));
  const base = baseline ? new Map(baseline.items.map((i) => [i.id, i])) : null;
  // A pinned item whose place we could not read this run is NOT gone. Reading it as `removed`
  // would mint a finding out of a permission error — the same fabrication as reading an unknown
  // as a pass, pointed the other way. An unreadable ROOT takes everything under it with it.
  const unknownIds = observed.unknowns.map((u) => u.id);
  const unreadable = (id) => unknownIds.some((u) => id === u || id.startsWith(`${u}${sep}`));
  const added = [];
  const changed = [];
  const removed = [];
  const unverified = [];
  const unbaselined = [];
  let unchanged = 0;
  if (base) {
    for (const [id, item] of now) {
      const b = base.get(id);
      if (b) { if (b.sha256 !== item.sha256) changed.push({ ...item, baselineSha256: b.sha256 }); else unchanged++; }
      else if (!baselineCovers(baseline, item.kind)) unbaselined.push(item);
      else added.push(item);
    }
    for (const [id, item] of base) if (!now.has(id)) (unreadable(id) ? unverified : removed).push(item);
  }
  const findings = base ? added.length + changed.length + removed.length : 0;
  const state = !base ? 'no-baseline'
    : findings ? 'findings'
    : (unbaselined.length || unverified.length || observed.unknowns.length) ? 'partial'
    : 'ok';
  return { added, changed, removed, unchanged, unverified, unbaselined, unknowns: observed.unknowns, state };
}

/** unbaselined items per kind — what the operator would be pinning by re-running --accept. */
export const countByKind = (rows) => {
  const by = {};
  for (const r of rows) by[r.kind] = (by[r.kind] || 0) + 1;
  return Object.fromEntries(Object.entries(by).sort(([a], [b]) => (a < b ? -1 : 1)));
};

export function runLens(opts = {}) {
  const baseline = readBaseline();
  const observed = collectPersistence(opts);
  return {
    at: nowISO(), baselineAt: baseline?.at ?? null, items: observed.items.length,
    baselineSurfaces: baseline ? (baseline.surfaces ?? null) : null,
    ...diffPersistence(observed, baseline),
  };
}

/** The human act: pin the currently observed inventory. Unknown items are NOT pinned — pinning a
 *  thing we could not read would make the next readable observation diff against a guess. The
 *  KINDS are pinned whether or not they held anything, which is what makes "this surface was never
 *  covered" distinguishable from "this surface was empty when you accepted it". */
export function acceptBaseline(opts = {}) {
  const observed = collectPersistence(opts);
  const doc = { at: nowISO(), surfaces: observed.surfaces, items: observed.items };
  writeAtomic(baselinePath(), `${JSON.stringify(doc, null, 2)}\n`);
  return { path: baselinePath(), pinned: observed.items.length, surfaces: observed.surfaces, unknowns: observed.unknowns };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('node monitor/persistence-diff.mjs [--json]   diff the persistence surface vs the accepted baseline\n'
      + 'node monitor/persistence-diff.mjs --accept   pin the currently observed inventory (the human act)\n'
      + 'exit 0 ok, 1 findings (added/changed/removed), 2 grey (no baseline, unknowns, or a surface\n'
      + '  the baseline predates — those items are UNBASELINED, never added)');
    process.exit(0);
  }
  if (process.argv.includes('--accept')) {
    const a = acceptBaseline();
    console.log(`pinned ${a.pinned} item(s) over ${a.surfaces.length} surface kind(s) → ${a.path}`);
    for (const u of a.unknowns) console.log(`  NOT pinned (unreadable): ${u.id} (${u.unknownReason}: ${u.unknownDetail})`);
    process.exit(0);
  }
  const r = runLens();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`persistence-diff: ${r.state}  (${r.items} item(s), baseline ${r.baselineAt ?? 'NONE — run --accept to pin'})`);
    for (const i of r.added) console.log(`  ADDED    ${i.kind}  ${i.id}`);
    for (const i of r.changed) console.log(`  CHANGED  ${i.kind}  ${i.id}`);
    for (const i of r.removed) console.log(`  REMOVED  ${i.kind}  ${i.id}`);
    for (const i of r.unverified) console.log(`  UNVERIFIED  ${i.kind}  ${i.id} — pinned, and unreadable this run: not gone`);
    for (const u of r.unknowns) console.log(`  UNKNOWN  ${u.kind}  ${u.id} (${u.unknownReason})`);
    // Counted per kind rather than listed: this is a gap in the BASELINE, and the operator's move
    // is one --accept, not a walk through 37 rows that were never judged in the first place.
    for (const [kind, n] of Object.entries(countByKind(r.unbaselined))) {
      console.log(`  UNBASELINED  ${kind}  ${n} item(s) — this baseline predates the surface; re-run --accept to pin it`);
    }
  }
  process.exit(r.state === 'findings' ? 1 : r.state === 'ok' ? 0 : 2);
}
