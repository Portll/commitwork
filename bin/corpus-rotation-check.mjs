// bin/corpus-rotation-check.mjs — did the held-out injection corpus grow since the last release?
// A held-out set that never changes is a fixed target: once a release has replayed it, the next
// release measures nothing new. The check reads two commits of the repository, never the working
// tree, so a file added and not committed does not count.
//
//   node bin/corpus-rotation-check.mjs [--repo <path>] [--ref <commit>] [--since <ref>] [--json]
//
// env (read at call time): CW_CORPUS_SINCE (default: the newest v* tag reachable from --ref)
// exit: 0 the set grew · 21 it did not · 2 cannot tell (not a repository, no previous release tag,
//       or the compared refs cannot be read)
import { execFileSync } from 'node:child_process';
import { isMainModule } from '../lib/is-main.mjs';

export const EXIT = Object.freeze({ grew: 0, unchanged: 21, cannotTell: 2 });
export const HELD_OUT_DIR = 'fixtures/injection-corpus/held-out';

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The .txt files under the held-out directory at one commit: [{ path, blob }], sorted by path. */
export function heldOutAt(repo, ref) {
  const out = git(repo, ['ls-tree', '-r', ref, '--', HELD_OUT_DIR]);
  return out.split('\n').filter(Boolean).map((l) => { const [meta, path] = l.split('\t'); return { path, blob: meta.split(' ')[2] }; })
    .filter((e) => e.path && e.path.endsWith('.txt')).sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The release to compare against: `{ tag, reachable }`, or null when no v* tag exists at all.
 *
 * A tag in the ref's own ancestry is the honest basis and is preferred. After a history rewrite
 * there is NO such tag — this repository's only v* tag sits on the pre-rewrite line and is not an
 * ancestor of main — and refusing there left this gate permanently `cannot-check`, which every
 * reader takes for "not measured yet" rather than "cannot be measured, ever". The newest v* tag
 * that still resolves answers the question the gate actually asks: has the held-out corpus grown
 * since the last release. It is returned with `reachable: false` so the basis is reported and never
 * mistaken for ancestry.
 */
export function previousRelease(repo, ref) {
  try { return { tag: git(repo, ['describe', '--tags', '--abbrev=0', '--match', 'v*', `${ref}^`]), reachable: true }; }
  catch { /* no tag in this ref's history — fall through to the unreachable fallback */ }
  let tags;
  try { tags = git(repo, ['tag', '--list', 'v*', '--sort=-v:refname']).split('\n').map((t) => t.trim()).filter(Boolean); }
  catch { return null; }
  for (const tag of tags) {
    try { git(repo, ['rev-parse', '--verify', `${tag}^{commit}`]); return { tag, reachable: false }; }
    catch { /* a tag whose object is gone answers nothing; try the next */ }
  }
  return null;
}

export function compare({ repo = process.cwd(), ref = 'HEAD', since = null, env = process.env } = {}) {
  let base = since || env.CW_CORPUS_SINCE || null;
  try { git(repo, ['rev-parse', '--verify', `${ref}^{commit}`]); } catch (e) { return { status: 'cannot-tell', reason: `${ref} is not a commit of ${repo}`, detail: String(e.stderr || e.message).trim() }; }
  let reachable = base ? null : true;
  if (!base) {
    const prev = previousRelease(repo, ref);
    if (!prev) return { status: 'cannot-tell', reason: `this repository has no v* tag to compare against; pass --since <ref>` };
    base = prev.tag;
    reachable = prev.reachable;
  }
  let before, after;
  try { before = heldOutAt(repo, base); after = heldOutAt(repo, ref); } catch (e) { return { status: 'cannot-tell', reason: `cannot read ${HELD_OUT_DIR} at ${base} or ${ref}`, detail: String(e.stderr || e.message).trim() }; }
  // fact: growth is a blob the previous release did not hold / a renamed file keeps its blob and adds no new shape (expiry: never, prev: wrong)
  const beforeBlobs = new Set(before.map((e) => e.blob));
  const afterBlobs = new Set(after.map((e) => e.blob));
  const added = after.filter((e) => !beforeBlobs.has(e.blob)).map((e) => e.path);
  const removed = before.filter((e) => !afterBlobs.has(e.blob)).map((e) => e.path);
  return {
    status: added.length > 0 ? 'grew' : 'unchanged',
    since: base,
    // null when the caller named the basis itself; false says the tag is not in this ref's history,
    // which is the normal state after a rewrite and must travel with the number.
    sinceReachable: reachable,
    ref, before: before.length, after: after.length, added, removed,
  };
}

export function exitCodeFor(r) { return r.status === 'grew' ? EXIT.grew : r.status === 'unchanged' ? EXIT.unchanged : EXIT.cannotTell; }

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const take = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const r = compare({ repo: take('--repo'), ref: take('--ref'), since: take('--since') });
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else if (r.status === 'cannot-tell') console.log(`corpus-rotation: CANNOT TELL — ${r.reason}${r.detail ? ` (${r.detail})` : ''}`);
  // The basis travels with the number: a tag outside this ref's history still answers the question,
  // and a reader who takes it for an ancestor has been told something that is not so.
  else console.log(`corpus-rotation: ${r.status.toUpperCase()} — ${r.before} → ${r.after} held-out file(s) since ${r.since}`
    + `${r.sinceReachable === false ? ' (that tag is NOT in this ref\'s history — compared by tree, not by ancestry)' : ''}`
    + `${r.added.length ? `; added ${r.added.map((f) => f.split('/').pop()).join(', ')}` : ''}${r.removed.length ? `; removed ${r.removed.length}` : ''}`);
  process.exitCode = exitCodeFor(r);
}
