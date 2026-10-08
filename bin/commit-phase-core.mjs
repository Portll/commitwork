// commitwork — commit-phase-core: the decisions of the per-session commit path, pure.
// bin/commit-phase.mjs runs git; this file decides. Same split as gate-tests-core.mjs, for the
// same reason: a branch matrix is provable by `node --test` instead of by reading.
//
// WHAT THIS CLOSES (remediation #1 / register R1, `monitor/failure-taxonomy.json`).
// Eight sessions share one working tree and ONE `.git/index`, `GIT_INDEX_FILE` unset. So `git add`
// stages into a set another session is also writing, and a pathspec-less `git commit` carries
// whatever they staged a second earlier. R1's action is three parts, and the register is explicit
// that the first alone is worse than nothing:
//
//   (a) a per-session index                    ← the export half
//   (b) `git read-tree HEAD` into it immediately before every commit
//   (c) REFUSE to commit if HEAD moved since that read-tree
//
// > "DO NOT implement the export half alone. Trades P2 for R8 unless the pre-commit refresh lands
// >  with it — a private index built from an older HEAD carries the old blob for everything."
//
// That is the whole hazard and it is worth stating plainly, because a private index looks safe:
// the index holds an entry for EVERY tracked path, not only the ones you touched. Build it from
// HEAD, let another session land a commit, then write your tree — and your tree carries THEIR
// pre-commit blobs for every file they just changed. The commit reverts their work silently, with
// a clean diff of your own paths. (b) refreshes; (c) is what makes (b) sufficient.
//
// WHY THIS IS STRICTER THAN THE PATHSPEC FORM the mesh uses today, from docs/TRAPS.md:
// `git commit -- <paths>` commits the WORKING-TREE content of those paths as it is at commit time,
// so a co-session writing the file between your inspection and your commit is still taken —
// measured 2026-08-22 on a commit that swept 34 then 40 lines of another session's work.
// Here the content is frozen by `git add` into a private index and the commit reads the INDEX, so
// that window is closed rather than narrowed.
//
// WHY THE HEAD CHECK IS A COMPARE-AND-SWAP AND NOT AN `if`: checking `rev-parse HEAD` and then
// committing is check-then-act, and the gap is exactly where the co-session lands. The caller
// builds the commit with `commit-tree -p <head@read-tree>` and installs it with
// `git update-ref <ref> <new> <old>`, which git fails atomically if the ref has moved. `verdict`
// below is the pre-flight; the CAS is the thing that actually holds.
//
// The private index is NOT declared in bin/lib/store-paths.mjs, deliberately. That module is the
// one declaration for DURABLE stores, whose readers and writers drifted apart once (2026-08-27) and
// resolved to absent files in six places. This is a transient git artifact keyed to `$GIT_DIR` —
// which is per-worktree, and `gate-tests.mjs` spawns worktrees — so it cannot be a repo-relative
// constant, and a declaration that has to be handed the git dir is not a declaration.

import { join } from 'node:path';

/**
 * A path-safe session key. This becomes a FILENAME inside `$GIT_DIR`, so a key carrying `/` or a
 * leading `..` would write outside it. Read the env at call time — a `const` at module load
 * defeats any override a test sets afterwards, and this repo carries baselined instances of that.
 */
export function sessionKey(env = process.env, pid = process.pid) {
  // CLAUDE_CODE_SESSION_ID is the name the harness actually exports. CLAUDE_SESSION_ID is read
  // first-and-only nowhere that sets it — measured 2026-08-30, `env` carries CLAUDE_CODE_SESSION_ID
  // and no CLAUDE_SESSION_ID, so this function had been silently returning `pid-<pid>` for every
  // real invocation and the "per-session" index was a per-PROCESS one. Kept in the chain because a
  // wrong name costs nothing here and removing it would break anyone who does export it.
  const raw = env.CW_COMMIT_SESSION || env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || `pid-${pid}`;
  const safe = String(raw).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.-]+/, '');
  return safe.slice(0, 64) || `pid-${pid}`;
}

/** `$GIT_DIR/index.<session>`. Git ignores files it does not know in its own directory. */
export function privateIndexPath(gitDir, key) {
  return join(gitDir, `index.${key}`);
}

/**
 * Pre-flight verdict for landing a commit from a private index.
 *
 * Fail closed: an unreadable HEAD at either end is `unknown-head`, never treated as "unchanged".
 * A parse failure that reads as agreement is the exact shape this gate exists to stop.
 *
 * Verdicts: 'no-declaration' | 'unknown-head' | 'stale-index' | 'nothing-staged' | 'land'.
 */
export function landVerdict({ declared, headAtReadTree, headNow, stagedCount } = {}) {
  if (!Array.isArray(declared) || declared.length === 0) {
    return {
      verdict: 'no-declaration', exit: 2,
      why: 'no declared paths. The staged set is NOT a substitute — the shared index holds other sessions\' staging, which is the defect this closes.',
    };
  }
  const bad = declared.find((p) => typeof p !== 'string' || !p || p.startsWith('/') || p.split('/').includes('..'));
  if (bad !== undefined) {
    return { verdict: 'no-declaration', exit: 2, why: `declared path escapes the repo or is empty: ${JSON.stringify(bad)}` };
  }
  if (typeof headAtReadTree !== 'string' || !headAtReadTree || typeof headNow !== 'string' || !headNow) {
    return {
      verdict: 'unknown-head', exit: 2,
      why: 'HEAD could not be read at one or both ends. Refusing: an unknown is not "unchanged", and committing a private index against an unknown HEAD is how the old-blob revert happens.',
    };
  }
  if (headAtReadTree !== headNow) {
    return {
      verdict: 'stale-index', exit: 2,
      headAtReadTree, headNow,
      why: `HEAD moved ${headAtReadTree.slice(0, 7)} → ${headNow.slice(0, 7)} since this index was built from it. The index still carries the OLD blob for every path that commit touched, so landing it would revert that session's work with a clean-looking diff. Re-run: the read-tree is cheap and re-reading is the fix.`,
    };
  }
  if (stagedCount === 0) {
    return { verdict: 'nothing-staged', exit: 1, why: 'the declared paths produced no change against HEAD — nothing to commit.' };
  }
  return { verdict: 'land', exit: 0, head: headNow };
}

/**
 * What to repair in the SHARED index after landing. Committing through a private index leaves the
 * shared one holding pre-commit entries for the paths just landed, so the next session's
 * `git status` shows them as staged-in-reverse against the new HEAD. `git reset -q HEAD -- <paths>`
 * reloads exactly those paths and nothing else. Named as its own step because docs/TRAPS.md records
 * it as one of the two costs that must be paid or the trick trades one silent loss for another.
 */
/**
 * Pre-flight for a REPLAY: rebuilding this branch's commits on top of a ref that moved ahead.
 *
 * WHY A TOOL RATHER THAN A PROCEDURE. The push-race recipe is "replay onto origin/main with a
 * private index + commit-tree, never `git pull --rebase`" — correct, because rebase touches a
 * worktree that routinely carries 100+ dirty files here. Performed BY HAND it drops two things
 * silently, and both were measured on 2026-08-30:
 *
 * fact: a hand replay writes commits with raw commit-tree, so commit-phase's recorder never runs and the ledger holds ZERO rows for them / gate-tests read "YOU touched 3" for a session that had landed 11 files over four commits, and the 3 were exactly the commits that had NOT been replayed (expiry: never, prev: broken)
 * fact: staging MY blob for a path the other side also changed overwrites their change with no conflict, no warning and a clean-looking diff / update-index --cacheinfo ASSIGNS, it does not merge, so a replay is sound only over a DISJOINT file set and nothing was checking that (expiry: never, prev: unknown)
 *
 * The refusal is the load-bearing half. This replays a disjoint change set or it refuses and names
 * the paths that collided. A three-way merge is a different tool; one that quietly picked a side
 * would be worse than the rebase this exists to avoid.
 *
 * @param base   {string|null} sha of the ref to replay onto; null is UNKNOWN, never "unchanged"
 * @param head   {string|null} sha of the branch tip being replayed
 * @param commits {Array<string>} shas in base..head, OLDEST FIRST
 * @param mineFiles  {Array<string>} paths changed on our side (base...head)
 * @param theirFiles {Array<string>} paths changed on theirs (head...base)
 * @param exempt {Array<string>} paths the caller has shown combine without assignment (package.json,
 *   when at most one side changed more than its version — see versionFileCollides)
 */
export function replayVerdict({ base, head, commits = [], mineFiles = [], theirFiles = [], exempt = [] } = {}) {
  const none = [];
  if (!base || !head) {
    return { verdict: 'refuse', exit: 2, overlap: none,
      why: 'base or head is UNKNOWN — refusing rather than coercing an unreadable sha to a value.' };
  }
  if (base === head) {
    return { verdict: 'noop', exit: 0, overlap: none, why: 'already at the target; nothing to replay.' };
  }
  if (!commits.length) {
    return { verdict: 'noop', exit: 0, overlap: none,
      why: `no commits in ${base.slice(0, 7)}..${head.slice(0, 7)} — this branch is behind, not ahead.` };
  }
  const theirs = new Set(theirFiles);
  const skip = new Set(exempt);
  const overlap = mineFiles.filter((f) => theirs.has(f) && !skip.has(f)).sort();
  if (overlap.length) {
    return { verdict: 'refuse', exit: 2, overlap,
      why: `${overlap.length} path(s) changed on BOTH sides, and a replay ASSIGNS rather than merges — `
         + `it would take this branch's blob and drop theirs behind a clean-looking diff: ${overlap.join(', ')}. `
         + 'Resolve those paths deliberately; this tool never picks a side.' };
  }
  return { verdict: 'replay', exit: 0, overlap: none,
    why: `${commits.length} commit(s) over ${mineFiles.length} disjoint path(s).` };
}

export const sharedIndexRepair = (declared) => ['reset', '-q', 'HEAD', '--', ...declared];

// ── the version stamp ────────────────────────────────────────────────────────
//
// Operator decision 2026-09-26: every commit bumps the semver PATCH in package.json; minor and
// major stay manual. Every commit here goes through commit-phase, so the stamp lives here. It is
// computed from the PARENT's package.json, and the parent is the sha the update-ref CAS checks,
// so a HEAD that moves after the read still fails the land exactly as before.

export const VERSION_FILE = 'package.json';

const NUM = '0|[1-9]\\d*';
const PRE_ID = `(?:${NUM}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER_RE = new RegExp(
  `^(${NUM})\\.(${NUM})\\.(${NUM})(?:-(${PRE_ID}(?:\\.${PRE_ID})*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$`);

/** semver 2.0.0, strictly: no `v` prefix, no leading zeros. BigInt parts, so a large patch stays exact. */
export function parseSemver(v) {
  const m = typeof v === 'string' ? SEMVER_RE.exec(v) : null;
  if (!m) return null;
  return { major: BigInt(m[1]), minor: BigInt(m[2]), patch: BigInt(m[3]), pre: m[4] ? m[4].split('.') : [], build: m[5] ?? null };
}

/** npm's `inc patch`: 1.2.3 → 1.2.4, and 1.2.3-rc.1 → 1.2.3, the release it led to. Build metadata is dropped. */
export function bumpPatch(v) {
  const s = parseSemver(v);
  if (!s) return null;
  return `${s.major}.${s.minor}.${s.pre.length ? s.patch : s.patch + 1n}`;
}

/** semver precedence: -1 · 0 · 1, or null when either side is not semver. Build metadata is ignored. */
export function compareSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return null;
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return Math.sign(y.pre.length - x.pre.length);   // a prerelease sorts first
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (i >= x.pre.length) return -1;
    if (i >= y.pre.length) return 1;
    const p = x.pre[i];
    const q = y.pre[i];
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) { if (BigInt(p) !== BigInt(q)) return BigInt(p) < BigInt(q) ? -1 : 1; continue; }
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * The top-level members of a JSON object text, each with the character span of its value, or null
 * when the text is not a JSON object. JSON.parse validates first, so the scan walks known-good text.
 */
function topLevelMembers(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return null; }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const ws = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  const endOfString = (j) => { for (j++; text[j] !== '"'; j++) if (text[j] === '\\') j++; return j + 1; };
  const endOfValue = (j) => {
    if (text[j] === '"') return endOfString(j);
    if (text[j] !== '{' && text[j] !== '[') {
      while (j < text.length && !ws(text[j]) && text[j] !== ',' && text[j] !== '}' && text[j] !== ']') j++;
      return j;
    }
    for (let depth = 0; ; j++) {
      const c = text[j];
      if (c === '"') { j = endOfString(j) - 1; continue; }
      if (c === '{' || c === '[') depth++;
      else if ((c === '}' || c === ']') && --depth === 0) return j + 1;
    }
  };
  const out = [];
  let i = text.indexOf('{') + 1;
  const skip = () => { while (ws(text[i])) i++; };
  skip();
  if (text[i] === '}') return out;
  for (;;) {
    skip();
    const k = endOfString(i);
    const key = JSON.parse(text.slice(i, k));
    i = k; skip(); i++; skip();                                  // past the ':'
    const end = endOfValue(i);
    out.push({ key, start: i, end });
    i = end; skip();
    if (text[i] !== ',') return out;
    i++;
  }
}

/** The top-level `version` of a package.json text: { ok, version, span } or { ok: false, why }. */
export function readVersion(text) {
  if (typeof text !== 'string') return { ok: false, why: 'is absent' };
  const members = topLevelMembers(text);
  if (!members) return { ok: false, why: 'is not a parseable JSON object' };
  const hits = members.filter((m) => m.key === 'version');
  if (!hits.length) return { ok: false, why: 'has no "version" field' };
  if (hits.length > 1) return { ok: false, why: `carries "version" ${hits.length} times, and which one a reader takes is not a thing to guess` };
  const raw = text.slice(hits[0].start, hits[0].end);
  const value = JSON.parse(raw);
  if (typeof value !== 'string' || !parseSemver(value)) return { ok: false, why: `has version ${raw}, which is not semver` };
  return { ok: true, version: value, span: [hits[0].start, hits[0].end] };
}

/** Rewrite the top-level version token and nothing else: formatting, key order and the final newline survive byte for byte. */
export function setVersion(text, version) {
  const r = readVersion(text);
  if (!r.ok) return r;
  if (!parseSemver(version)) return { ok: false, why: `${JSON.stringify(version)} is not semver` };
  return { ok: true, text: text.slice(0, r.span[0]) + JSON.stringify(version) + text.slice(r.span[1]) };
}

/** True when two package.json texts differ in their version at most. Absent equals absent. */
export function sameModuloVersion(a, b) {
  if (a === b) return true;
  const ra = readVersion(a);
  if (!ra.ok || !readVersion(b).ok) return false;
  const moved = setVersion(b, ra.version);
  return moved.ok && moved.text === a;
}

/**
 * The package.json a commit carries.
 *
 * @param parentText  package.json at the parent commit; null when absent
 * @param authorText  package.json as the change set carries it: undefined when the set does not
 *                    touch it, null when the set deletes it
 * @returns { ok, from, version, kept, text } or { ok: false, why }. Without an author copy: the
 *   parent's bytes at bumpPatch(parent). With one: the author's bytes at max(theirs, the bump), so a
 *   deliberate minor or major wins and a stale or equal version is raised. A parent without
 *   package.json gets no stamp: { ok, none: true, text } where text is the author copy or null.
 */
export function versionStamp({ parentText = null, authorText } = {}) {
  if (parentText === null) return { ok: true, none: true, text: authorText ?? null };
  const parent = readVersion(parentText);
  if (!parent.ok) {
    return { ok: false, why: `${VERSION_FILE} at the parent commit ${parent.why}. Every commit stamps bumpPatch(parent version), so there is nothing to bump from.` };
  }
  const bumped = bumpPatch(parent.version);
  if (authorText === null) return { ok: false, why: `this change set deletes ${VERSION_FILE}, which carries the version every commit stamps.` };
  let base = parentText;
  let version = bumped;
  let kept = false;
  if (authorText !== undefined) {
    const author = readVersion(authorText);
    if (!author.ok) return { ok: false, why: `${VERSION_FILE} in this change set ${author.why}.` };
    base = authorText;
    if (compareSemver(author.version, bumped) > 0) { version = author.version; kept = true; }
  }
  const out = setVersion(base, version);
  if (!out.ok) return { ok: false, why: `${VERSION_FILE} could not be stamped: ${out.why}` };
  return { ok: true, from: parent.version, version, kept, text: out.text };
}

/**
 * One stamp per replayed commit, each on top of the one before. `steps[i]` is { before, after }:
 * package.json at the ORIGINAL parent of commit i and at commit i (null when absent). A version-only
 * step carries the new parent's bytes forward; a step that changed anything else is an author copy.
 */
export function replayStamps({ baseText = null, steps = [] } = {}) {
  const stamps = [];
  let parentText = baseText;
  for (let i = 0; i < steps.length; i++) {
    const { before = null, after = null } = steps[i] || {};
    const s = versionStamp({ parentText, authorText: sameModuloVersion(before, after) ? undefined : after });
    if (!s.ok) return { ok: false, at: i, why: s.why };
    stamps.push(s);
    parentText = s.text;
  }
  return { ok: true, stamps };
}

/**
 * Whether package.json is a real replay collision. Every commit stamps it, so both sides always
 * touch it, and that alone must not refuse every --onto. It collides when both sides changed more
 * than the version, because the replay would then assign one side's bytes over the other's. Each
 * of our steps counts, not only the net diff: a change and its revert still assign.
 */
export function versionFileCollides({ baseText = null, theirText = null, steps = [] } = {}) {
  const theirs = !sameModuloVersion(baseText, theirText);
  const mine = steps.some((s) => !sameModuloVersion(s?.before ?? null, s?.after ?? null));
  return theirs && mine;
}

/**
 * The checkout's package.json after HEAD moved from `before` to `after`: 'absent', 'current'
 * (already HEAD's), 'fast-forward' (untouched since the parent, or exactly the copy the land took
 * as `taken`) or 'merge' (a peer holds edits there; three-way merge, written only when clean).
 */
export function worktreeAction({ worktree, before, after, taken } = {}) {
  if (typeof worktree !== 'string') return 'absent';
  if (worktree === after) return 'current';
  if (worktree === before || (typeof taken === 'string' && worktree === taken)) return 'fast-forward';
  return 'merge';
}
