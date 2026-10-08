#!/usr/bin/env node
// bin/commit-phase.mjs — remediation #1 / register R1: commit through a PER-SESSION index, so the
// shared `.git/index` stops being the thing eight sessions race on.
//
// The decisions live in bin/commit-phase-core.mjs, including the full statement of why the export
// half must never land alone. This file is the git.
//
// THE SEQUENCE, and every step is load-bearing:
//   1. head0 ← rev-parse HEAD
//   2. read-tree HEAD  → private index at $GIT_DIR/index.<session>     (R1-b)
//   3. add -- <declared paths>                                          content frozen HERE
//   3b. package.json ← version stamped from head0's package.json       (the version stamp)
//   4. write-tree → commit-tree -p head0
//   5. update-ref <ref> <new> <head0>   ← compare-and-swap; git refuses if HEAD moved   (R1-c)
//   6. reset -q HEAD -- <declared>      ← repair the SHARED index (docs/TRAPS.md cost #1)
//   7. the checkout's package.json → HEAD's, or left and named when a peer's edit conflicts
//
// Step 5 is why this is not check-then-act. A pre-flight `if (head === head0)` leaves the gap the
// co-session lands in; `update-ref <ref> <new> <old>` is atomic in git and fails loudly instead.
//
// Step 3 is why this beats `git commit -- <paths>`: that form re-reads the WORKING TREE at commit
// time, so a co-session writing between your inspection and your commit is still taken (measured
// 2026-08-22 — 34 lines, then 40). Here the commit reads the index.
//
// NOT `git commit -q`, and not `git commit` at all: `-q` prints nothing, so `commitShaFrom()`
// recovers no sha and the commit never reaches the touch ledger — eight `-q` commits produced zero
// ledger rows against one non-`-q` producing seven. `commit-tree` hands us the sha directly, which
// is strictly better than parsing for it, and we print it on stdout.
//
// SCOPE IS DECLARED, NEVER INFERRED — the same rule bin/format-phase.mjs states and for the same
// reason: "whatever is staged" is not this session's set while the index is shared. This tool is
// what eventually makes that inference safe, and it still does not make it, because the shared
// index is only private for sessions that USE this path.
//
// usage:
//   node bin/commit-phase.mjs --check -- <path>…            pre-flight only; nothing is written
//   node bin/commit-phase.mjs -m <msg> [--ref <r>] -- <path>…   land it
//   node bin/commit-phase.mjs --onto <ref> [--check]        replay this branch onto a moved ref
//   node bin/commit-phase.mjs --from-blob <repoPath>=<file> -m <msg>   land CONTENT, not the worktree
//   node bin/commit-phase.mjs --from-blob <repoPath>=<file>@<blob> …   …and refuse if it moved since
//     `<blob>` is the 40-hex blob the content was derived from (`git rev-parse HEAD:<repoPath>` at
//     freeze time). Optional, and the ONLY protection against a stale freeze: --from-blob stops you
//     adopting worktree dirt, not you reverting somebody who landed while you were working.
//
// version: every commit this writes (a land, --from-blob, each --onto replay) carries package.json
//   at bumpPatch(parent's version). A change set that carries package.json keeps its bytes at
//   max(its version, that bump) by semver. A parent without package.json gets no stamp; one that
//   is unparseable or not semver REFUSES. --check prints the version it would stamp.
//
// message: validateConventional under the rule set `git config commitwork.rules` names (unset is
//   commitwork's own); bin/commit-msg.mjs applies the same rules to a bare `git commit`.
//
// --from-blob exists because six sessions were hand-rolling this sequence to land one file out of a
// contended one. Every hand-roll re-derives the safety properties from memory and drops whichever
// the author did not know about: the broadcast recipe dropped the message check, an earlier one
// dropped the step-6 shared-index repair, and all of them hardcoded `100644` in the cacheinfo —
// measured 2026-09-01, that silently rewrites a 100755 script to 100644 and nothing fails loudly.
// So the mode is read from HEAD here, and the whole path reuses the same verdict, trailer check,
// compare-and-swap, ledger write and index repair as a normal land. It reads NO working tree at
// all, which is the property `git commit -- <path>` cannot give you on a tree eight sessions write.
//
// --onto is the push-race path: origin moved while you were building, and `git pull --rebase` is
// wrong here because it touches a worktree that routinely carries 100+ dirty files. It replays a
// DISJOINT change set or refuses and names the collisions — it never merges and never picks a
// side. It also records what it writes, which the hand-rolled version of this recipe did not.
//
// THE VERSION STAMP (operator decision 2026-09-26: every commit bumps the patch; minor and major
// stay manual) is read from head0, the parent the CAS checks, so it adds no race. Step 7 exists
// because a stamp leaves the checkout's package.json one version behind HEAD, and the next pathspec
// commit of that file would revert it. --onto exempts package.json from its collision refusal
// unless both sides changed more than the version.
//
// env: CW_COMMIT_SESSION / CLAUDE_CODE_SESSION_ID name the index; CW_COMMIT_REPO overrides the repo.

import { isMainModule } from '../lib/is-main.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, unlinkSync, statSync, readFileSync, writeFileSync, renameSync, chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';

import {
  sessionKey, privateIndexPath, landVerdict, sharedIndexRepair, replayVerdict,
  VERSION_FILE, readVersion, versionStamp, replayStamps, versionFileCollides, worktreeAction,
} from './commit-phase-core.mjs';
import { touchAppender } from './lib/touch-ledger-append.mjs';
import { validateConventional, formatErrors, rulesFor, DEFAULT_TYPES, SUBJECT_MAX } from './lib/conventional-commit.mjs';
import { touchLedger, treeId, treeClaim } from './lib/store-paths.mjs';
import { generations } from './lib/ledger-rotate.mjs';
import { parseLedger } from './lib/touch-ledger-core.mjs';
import { claimants } from './lib/touch-attribution.mjs';

const repo = () => process.env.CW_COMMIT_REPO || process.cwd();

/** Run git. `env` extras are merged, so GIT_INDEX_FILE is set per call rather than per process. */
function git(args, { env = {}, allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: repo(), encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    if (allowFail) return { _error: (e.stderr || e.message || '').toString().trim() };
    throw e;
  }
}

/** HEAD, or null. Null is UNKNOWN and the core refuses on it — never coerced to a value. */
function headSha() {
  const r = git(['rev-parse', 'HEAD'], { allowFail: true });
  return typeof r === 'string' && /^[0-9a-f]{40}$/.test(r) ? r : null;
}

/**
 * The second HEAD read, overridable so a test can exercise the stale-index branch end to end.
 * The window it simulates is real — HEAD moving between the read-tree and the land — but it is
 * a race, and a suite that can only reproduce it by timing proves nothing on a loaded machine.
 *
 * DATA, never a command. An env-gated exec seam inside a commit tool would be a genuine hazard;
 * this can only change one sha, and the only direction it can change it in is toward a refusal —
 * a value equal to head0 does not make an unsafe land safe, because the update-ref CAS at step 5
 * is checked by git against the actual ref regardless of anything read here.
 */
const headNowRead = () => process.env.CW_COMMIT_TEST_HEAD_NOW || headSha();

/**
 * Record a landed commit in the touch ledger, through the writer the PostToolUse hook uses.
 *
 * The hook cannot see a commit made here: it recovers a sha by PARSING `git commit` output, and
 * this tool lands with commit-tree + update-ref, so commitShaFrom() returns null before a sha is
 * ever sought. Measured 2026-08-30 — 41 via:'commit' rows existed that day for sessions using a
 * bare `git commit` and ZERO for this one, so the SAFE path was the invisible path and gate-tests
 * told a session it had touched 0 of the files it had authored ninety seconds earlier.
 *
 * NOT fixed by widening commitShaFrom. Its precision over recall is deliberate, two sessions have
 * been talked out of loosening it, and a wider pattern starts matching prose that merely mentions
 * committing. We hold the sha already, so we record it.
 *
 * ONE recorder, called by BOTH the land path and the replay path. The replay was added second and
 * had already reproduced the original defect by hand — four commits written with raw commit-tree
 * and no rows for any of them — which is the argument for a function rather than a second copy.
 *
 * PARITY as the row shape: `f` + via:'commit' + access:'write', byte-identical to the hook's rows
 * for a bare `git commit`. Committing is not authoring — 27% of via:'commit' rows name a file only
 * another session holds edit evidence for, and this tool landed a peer's file once — but that
 * contamination already exists on the bare-commit path, and a third semantics for one event would
 * mean fixing it in three places instead of one.
 *
 * The list is the COMMIT's, never a caller's declared set: a declared path with no change is not
 * in the tree, and `git show --name-only` is the question the hook asks. Same question, same answer.
 * That is also why the stamped package.json is recorded: it is in the commit's tree.
 */
function recordCommit(sha) {
  try {
    const append = touchAppender({
      // CLAUDE_CODE_SESSION_ID, not CLAUDE_SESSION_ID. The first version read the latter, landed,
      // and recorded NOTHING for its own commit — the sandbox test passed because it set the
      // session explicitly, so it proved the writer and never the wiring. The value must equal the
      // hook's ev.session_id or the rows split one session in two; verified equal against a
      // hook-written row in the live ledger.
      session: process.env.CW_COMMIT_SESSION || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID,
      repo: repo(),
    });
    const named = git(['show', '--name-only', '--format=', sha], { allowFail: true });
    if (typeof named !== 'string') return;
    for (const f of named.split('\n').map((x) => x.trim()).filter(Boolean)) {
      append({ f, via: 'commit', access: 'write', sha });
    }
  } catch { /* a commit that landed is not undone by a ledger that did not */ }
}

/** Name every declared path on which another session holds a STANDING fingerprint. */
function reportPeerClaims(paths) {
  const me = String(process.env.CW_COMMIT_SESSION || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || '').slice(0, 8);
  if (!paths.length) return;
  const files = generations(touchLedger());
  const texts = [];
  let unread = 0;
  for (const f of files) { try { texts.push(readFileSync(f, 'utf8')); } catch (e) { if (e.code === 'ENOENT' && f === touchLedger()) unread++; else if (e.code !== 'ENOENT') unread++; } }
  if (!texts.length) { console.error('commit-phase: touch ledger not read — peer edits on the declared paths are UNKNOWN, not absent.'); return; }
  const { rows } = parseLedger(texts);
  const tree = treeId(repo());
  const here = rows.filter((r) => r && r.f && treeClaim(r, tree) !== 'other');
  for (const p of paths) {
    // Only edits SINCE the path's last commit can still be uncommitted. A standing fingerprint
    // older than that was landed by somebody already; naming it here would fire on every
    // frequently-edited file and turn the report into wallpaper (A4). Measured on the first live
    // run: five sessions named on bin/commit-phase.mjs, every one of them already landed.
    const boundary = git(['log', '-1', '--format=%cI', '--', p], { allowFail: true });
    const since = typeof boundary === 'string' && boundary.trim() ? Date.parse(boundary.trim()) : null;
    const recent = since === null ? here : here.filter((r) => r.f !== p || (r.at && Date.parse(r.at) >= since));
    const c = claimants(recent, p);
    const peers = c.standing.filter((s) => s && s !== me);
    if (!peers.length) continue;
    console.error(`commit-phase: P12 — ${p} carries a standing edit by ${peers.join(', ')}${c.standing.includes(me) ? ' as well as yours' : ' and none of yours'}; a whole-file land banks theirs under this message. To land only your hunks: node bin/stage-mine.mjs --land -m <msg> -- ${p}`);
  }
  if (unread) console.error(`commit-phase: ${unread} ledger generation(s) unreadable — the peer report above is partial.`);
}

/** Lines of a git command's stdout, trimmed and non-empty. A failure is an empty list, never null. */
const lines = (r) => (typeof r === 'string' ? r.split('\n').map((x) => x.trim()).filter(Boolean) : []);

// ── the version stamp: the git half (the decisions are in commit-phase-core.mjs) ──────────────

/** A blob's text, never trimmed, because package.json is stamped byte for byte. A lossy decode is an error. */
function blobText(blob) {
  let buf;
  try {
    buf = execFileSync('git', ['cat-file', 'blob', blob], { cwd: repo(), stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) { return { error: String(e.stderr || e.message || '').trim() }; }
  const text = buf.toString('utf8');
  return Buffer.from(text, 'utf8').equals(buf) ? { text } : { error: 'is not valid UTF-8' };
}

/**
 * package.json in a commit, or in the index `env` names when `treeish` is null.
 * { mode, blob, text } · { absent: true } · { error }. Only an empty listing is absence.
 */
function versionFileAt(treeish, env = {}) {
  const entry = treeish
    ? git(['ls-tree', '--full-tree', treeish, '--', VERSION_FILE], { allowFail: true })
    : git(['ls-files', '--stage', '--full-name', '--', `:(top)${VERSION_FILE}`], { env, allowFail: true });
  if (typeof entry !== 'string') return { error: entry._error || 'git failed' };
  if (entry === '') return { absent: true };
  const m = treeish ? entry.match(/^(\d{6}) blob ([0-9a-f]{40})\t/) : entry.match(/^(\d{6}) ([0-9a-f]{40}) 0\t/);
  if (!m) return { error: `unexpected entry: ${entry}` };
  const b = blobText(m[2]);
  return b.error ? { error: `blob ${m[2].slice(0, 7)} ${b.error}` } : { mode: m[1], blob: m[2], text: b.text };
}
const textOf = (vf) => (vf.absent ? null : vf.text);

/** Hash text into a blob. Hashing stdin applies no attribute filters, so the bytes are the bytes. */
function hashText(text) {
  try {
    const sha = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: repo(), input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch { return null; }
}

/** Put the stamped package.json into a private index: { blob } or { error }. */
function stampIndex(text, mode, env) {
  const blob = hashText(text);
  if (!blob) return { error: `could not write a blob for the stamped ${VERSION_FILE}` };
  const up = git(['update-index', '--add', '--cacheinfo', `${mode},${blob},${VERSION_FILE}`], { env, allowFail: true });
  if (up && up._error) return { error: `update-index failed for ${VERSION_FILE}: ${up._error}` };
  return { blob };
}

/** Three-way merge on scratch copies through `git merge-file`: { text } when clean, else { why }. */
function mergeText(ours, base, theirs) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-commit-phase-merge-'));
  try {
    const put = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };
    const r = spawnSync('git', ['merge-file', '-p', put('ours', ours), put('base', base), put('theirs', theirs)], { encoding: 'utf8' });
    if (r.status === 0) return { text: r.stdout };
    return { why: r.status > 0 && r.status < 128 ? `${r.status} conflicting hunk(s)` : `git merge-file failed: ${String(r.stderr || r.error || '').trim()}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** tmp + rename beside the target, keeping its mode. */
function writeInPlace(file, text) {
  const mode = statSync(file).mode & 0o7777;
  const tmp = join(dirname(file), `.${basename(file)}.commit-phase-${process.pid}`);
  try {
    writeFileSync(tmp, text, { mode });
    chmodSync(tmp, mode);
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* never created */ }
    throw e;
  }
}

/**
 * Step 7: the checkout's package.json follows the stamp. Left behind, it is a revert of the stamp
 * waiting for the next pathspec commit of that file. This writes that one file and no other: a
 * fast-forward when it still equals the parent blob, a clean three-way merge when a peer holds
 * edits there, otherwise untouched and named. The shared index entry is reset to HEAD only while it
 * still holds the parent blob; any other staged blob is a peer's and stays.
 * `before` and `after` are { blob, text } at the parent and at the new HEAD; `after` carries
 * `version`. `taken` is the change set's own package.json, when it carried one.
 */
function syncVersionFile({ before, after, landed, taken }) {
  if (headSha() !== landed) return;                        // this checkout is not on the ref that moved
  const top = git(['rev-parse', '--show-toplevel'], { allowFail: true });
  if (typeof top !== 'string' || !top) return;             // no working tree to follow
  const file = join(top, VERSION_FILE);
  const left = (why) => {
    console.error(`commit-phase: WARNING — ${file} was NOT updated: ${why}.`);
    console.error(`  HEAD carries version ${after.version}; committing this file as it stands reverts that stamp. Merge HEAD's version into it first: git diff HEAD -- ${VERSION_FILE}`);
  };

  let raw;
  try { raw = readFileSync(file); } catch (e) { raw = e; }
  if (raw instanceof Error) {
    left(raw.code === 'ENOENT' ? 'it is absent from the working copy' : `it could not be read (${raw.code || raw.message})`);
  } else {
    const text = raw.toString('utf8');
    const action = Buffer.from(text, 'utf8').equals(raw)
      ? worktreeAction({ worktree: text, before: before.text, after: after.text, taken })
      : 'undecodable';
    let next = null;
    if (action === 'fast-forward') next = after.text;
    else if (action === 'undecodable') left('it is not valid UTF-8');
    else if (action === 'merge') {
      const m = mergeText(text, before.text, after.text);
      const v = m.text === undefined ? null : readVersion(m.text);
      if (v && v.ok && v.version === after.version) next = m.text;
      else left(`it holds uncommitted edits that do not merge cleanly with the stamp (${m.why || 'the merge lost the stamped version'})`);
    }
    if (next !== null) {
      // Re-read at the last moment: a peer that wrote while this merged keeps their write.
      let now = null;
      try { now = readFileSync(file); } catch { /* reported below */ }
      if (!now || !now.equals(raw)) left('it changed while this was merging');
      else {
        try {
          writeInPlace(file, next);
          console.log(`commit-phase: ${VERSION_FILE} in the working copy ${action === 'merge' ? 'merged to' : 'now at'} ${after.version}`);
        } catch (e) { left(`the write failed (${e.code || e.message})`); }
      }
    }
  }

  const shared = git(['ls-files', '--stage', '--full-name', '--', `:(top)${VERSION_FILE}`], { allowFail: true });
  const staged = typeof shared === 'string' ? (shared.match(/^\d{6} ([0-9a-f]{40}) 0\t/) || [])[1] : undefined;
  if (staged === before.blob) {
    const reset = git(sharedIndexRepair([`:(top)${VERSION_FILE}`]), { allowFail: true });
    if (reset && reset._error) {
      console.error(`commit-phase: the shared index entry for ${VERSION_FILE} was NOT reset to HEAD, so it reads as a staged revert of the stamp. Repair with: git reset -q HEAD -- ${VERSION_FILE}\n  ${reset._error}`);
    }
  } else if (staged !== after.blob) {
    console.error(`commit-phase: WARNING — the shared index holds a staged ${VERSION_FILE} (${staged ? staged.slice(0, 7) : 'absent or unreadable'}) that is neither the parent's nor HEAD's; left as it is.`);
  }
}

/**
 * `--onto <ref>`: rebuild this branch's commits on top of a ref that moved ahead, and RECORD them.
 *
 * The refusal in replayVerdict() is the load-bearing half — see its header. This function is the
 * git, and the two things it does that a hand replay does not are: it carries a commit's DELETIONS
 * (ls-tree returns nothing for a removed path, and staging only what ls-tree finds silently
 * resurrects the file), and it calls recordCommit() for every commit it writes.
 *
 * Every replayed commit is stamped, one bump each on top of the new parent, from a plan made
 * before anything is built (replayStamps), so a plan that cannot be made refuses with nothing written.
 */
function replay({ onto, ref, gitDir, key, check }) {
  const head0 = headSha();
  if (head0 === null) {
    console.error('commit-phase: HEAD unreadable — refusing (unknown is not "unchanged").');
    return 2;
  }
  const resolved = git(['rev-parse', '--verify', `${onto}^{commit}`], { allowFail: true });
  const base = (typeof resolved === 'string' && /^[0-9a-f]{40}$/.test(resolved)) ? resolved : null;
  if (!base) {
    console.error(`commit-phase: --onto ${onto} does not resolve to a commit — refusing.`);
    return 2;
  }

  const commits = lines(git(['rev-list', '--reverse', `${base}..${head0}`], { allowFail: true }));

  // package.json at every point the stamp plan and the collision test read. An unreadable one is
  // carried as an error: it keeps package.json in the collision set and refuses below, never "absent".
  const mb = git(['merge-base', base, head0], { allowFail: true });
  const mbVf = typeof mb === 'string' && /^[0-9a-f]{40}$/.test(mb) ? versionFileAt(mb) : { error: 'no merge base' };
  const baseVf = versionFileAt(base);
  const steps = commits.map((c) => ({ before: versionFileAt(`${c}^`), after: versionFileAt(c) }));
  const unread = [mbVf, baseVf, ...steps.flatMap((s) => [s.before, s.after])].find((x) => x.error);
  const texts = steps.map((s) => ({ before: textOf(s.before), after: textOf(s.after) }));
  const collides = unread ? true : versionFileCollides({ baseText: textOf(mbVf), theirText: textOf(baseVf), steps: texts });

  const theirFiles = lines(git(['diff', '--no-renames', '--name-only', `${head0}...${base}`], { allowFail: true }));
  const v = replayVerdict({
    base,
    head: head0,
    commits,
    mineFiles: lines(git(['diff', '--no-renames', '--name-only', `${base}...${head0}`], { allowFail: true })),
    theirFiles,
    exempt: collides ? [] : [VERSION_FILE],
  });
  if (v.verdict === 'noop') { console.log(`commit-phase: nothing to replay — ${v.why}`); return v.exit; }
  if (v.verdict === 'refuse') { console.error(`commit-phase: REFUSED — ${v.why}`); return v.exit; }
  if (unread) {
    console.error(`commit-phase: REFUSED — ${VERSION_FILE} could not be read, so no version can be stamped: ${unread.error}. Nothing landed.`);
    return 2;
  }
  const plan = replayStamps({ baseText: textOf(baseVf), steps: texts });
  if (!plan.ok) {
    console.error(`commit-phase: REFUSED — replaying ${commits[plan.at].slice(0, 7)}: ${plan.why} Nothing landed.`);
    return 2;
  }
  const real = plan.stamps.filter((s) => !s.none);
  const last = plan.stamps[plan.stamps.length - 1];
  const stampNote = real.length
    ? `${VERSION_FILE} ${real[0].from} → ${real[real.length - 1].version} over ${real.length} commit(s)`
    : `no ${VERSION_FILE}, no version stamp`;
  if (check) {
    console.log(`commit-phase: would replay ${commits.length} commit(s) onto ${base.slice(0, 7)} — ${v.why}`);
    console.log(`commit-phase: ${real.length ? 'would stamp ' : ''}${stampNote}`);
    console.log('commit-phase: pre-flight only — the guarantee is the update-ref CAS at land time, not this check.');
    return 0;
  }

  // A SEPARATE private index from the land path's: a replay builds N trees in sequence and must
  // never inherit a half-built one, so each iteration starts from its own parent.
  const idx = privateIndexPath(gitDir, `${key}.replay`);
  const env = { GIT_INDEX_FILE: idx };
  const built = [];
  let parent = base;
  let lastBlob = null;
  const giveUp = (why) => { console.error(`commit-phase: ${why}`); if (existsSync(idx)) unlinkSync(idx); return 2; };

  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    if (existsSync(idx)) unlinkSync(idx);
    const rt = git(['read-tree', parent], { env, allowFail: true });
    if (rt && rt._error) return giveUp(`read-tree failed during replay — nothing landed.\n  ${rt._error}`);
    // --no-renames: a rename listed by its new path alone would leave the old path in the tree.
    for (const path of lines(git(['show', '--no-renames', '--name-only', '--format=', c], { allowFail: true }))) {
      const entry = git(['ls-tree', c, '--', path], { allowFail: true });
      const m = typeof entry === 'string' ? entry.match(/^(\d{6})\s+\S+\s+([0-9a-f]{40})\t/) : null;
      if (m) {
        const add = git(['update-index', '--add', '--cacheinfo', `${m[1]},${m[2]},${path}`], { env, allowFail: true });
        if (add && add._error) return giveUp(`update-index failed for ${path} — nothing landed.\n  ${add._error}`);
      } else if (typeof entry === 'string' && entry === '') {
        // The commit REMOVED this path. Staging only what ls-tree finds would carry the deletion
        // nowhere and quietly resurrect the file in the replayed tree.
        git(['update-index', '--force-remove', '--', path], { env, allowFail: true });
      } else {
        return giveUp(`cannot read ${path} at ${c.slice(0, 7)} — refusing rather than guessing.`);
      }
    }
    // The stamp overrides whatever c staged for package.json: the plan already holds its bytes.
    if (!plan.stamps[i].none) {
      const stamped = stampIndex(plan.stamps[i].text, steps[i].after.mode || baseVf.mode || '100644', env);
      if (stamped.error) return giveUp(`${stamped.error} — nothing landed.`);
      lastBlob = stamped.blob;
    }
    const tree = git(['write-tree'], { env, allowFail: true });
    if (typeof tree !== 'string' || !/^[0-9a-f]{40}$/.test(tree)) return giveUp('write-tree failed during replay — nothing landed.');
    const rawMsg = execFileSync('git', ['log', '-1', '--format=%B', c], { cwd: repo(), encoding: 'utf8' });
    const { text: msg, removed } = stripForbiddenTrailers(rawMsg);
    if (removed) console.error(`commit-phase: stripped ${removed} Co-Authored-By trailer(s) from ${c.slice(0, 7)} during replay.`);
    const rebuilt = buildCommit([tree, '-p', parent], { input: msg, env });
    if (rebuilt.error) return giveUp(`replaying ${c.slice(0, 7)}: ${rebuilt.error}`);
    const next = rebuilt.sha;
    built.push(next);
    parent = next;
  }
  if (existsSync(idx)) unlinkSync(idx);

  const cas = git(['update-ref', ref, parent, head0], { allowFail: true });
  if (cas && cas._error) {
    console.error(`commit-phase: REFUSED at the compare-and-swap — ${ref} moved during the replay. Nothing landed.\n  ${cas._error}`);
    return 2;
  }
  // The entire reason --onto exists rather than a recipe: the hand-rolled version skipped this.
  for (const sha of built) recordCommit(sha);
  console.log(parent);
  console.log(`commit-phase: replayed ${built.length} commit(s) onto ${base.slice(0, 7)} · ${ref} now ${parent.slice(0, 7)} · ${stampNote}`);
  const was = steps[steps.length - 1].after;                // package.json at head0, the pre-replay tip
  if (!was.absent && !last.none) syncVersionFile({ before: was, after: { blob: lastBlob, text: last.text, version: last.version }, landed: parent });
  warnPreReplayCopies({ landed: parent, head0, paths: theirFiles.filter((p) => p !== VERSION_FILE) });
  return 0;
}

// The replay reads no working tree, so a checkout on the replayed ref keeps head0's copy of every
// path the new base changed, in its index and its files. A pathspec commit of one reverts that
// change behind a diff that looks like nothing. Name them; change nothing.
function warnPreReplayCopies({ landed, head0, paths }) {
  if (!paths.length || headSha() !== landed) return;
  const fromHead = git(['diff', '--name-only', landed, '--', ...paths], { allowFail: true });
  const fromOld = git(['diff', '--name-only', head0, '--', ...paths], { allowFail: true });
  if (typeof fromHead !== 'string' || typeof fromOld !== 'string') {
    console.error(`commit-phase: could not check this checkout for pre-replay copies (${(fromHead._error || fromOld._error || 'git diff failed').split('\n')[0]}).`);
    return;
  }
  const unlikeOld = new Set(lines(fromOld));
  const stale = lines(fromHead).filter((p) => !unlikeOld.has(p));
  if (!stale.length) return;
  console.error(`commit-phase: WARNING — this checkout still holds the pre-replay copy of ${stale.length} path(s) the new base changed. Committing one reverts it:`);
  for (const p of stale.slice(0, 20)) console.error(`  ${p}`);
  if (stale.length > 20) console.error(`  … and ${stale.length - 20} more`);
  console.error('  Where you have no edits of your own: git checkout HEAD -- <path>…');
}

// ── forbidden trailers ───────────────────────────────────────────────────────
//
// House rule: no `Co-Authored-By` on any commit here. The rule existed and was still broken 9 times
// on main between 2026-08-27 and 08-29, because nothing enforced it — and a `commit-msg` hook alone
// could not have: this tool lands with `commit-tree`, which runs NO hooks at all. So the mandated
// commit path was the one path a hook could never see.
//
// Two verbs, deliberately different:
//   - a NEW commit (`-m`) REFUSES. Authoring one is a mistake to correct now, not to launder.
//   - a REPLAY strips and SAYS SO. `--onto` is a rewrite tool; carrying a historical trailer forward
//     verbatim is how the rule stays broken across every rebase. Stripping is the job; silence is
//     not — each stripped commit is named on stderr.
const FORBIDDEN_TRAILER = /^[ \t]*Co-Authored-By[ \t]*:.*$/gim;

export function hasForbiddenTrailer(message) {
  FORBIDDEN_TRAILER.lastIndex = 0;             // /g is stateful; a shared regex must be reset per call
  return FORBIDDEN_TRAILER.test(String(message ?? ''));
}

// Remove the trailer lines and any blank run they leave behind, without disturbing the subject or
// body. Returns { text, removed } so the caller can report rather than assume.
export function stripForbiddenTrailers(message) {
  const src = String(message ?? '');
  const removed = (src.match(FORBIDDEN_TRAILER) || []).length;
  if (!removed) return { text: src, removed: 0 };
  const text = src.replace(FORBIDDEN_TRAILER, '')
    .replace(/\n{3,}/g, '\n\n')                // the blank line the trailer block sat in
    .replace(/\s+$/, '') + '\n';
  return { text, removed };
}

// ── signing ──────────────────────────────────────────────────────────────────
//
// `commit.gpgsign` is PORCELAIN-ONLY: `git commit` reads it, `git commit-tree` does not. This tool
// lands with commit-tree, so the global config — `commit.gpgsign true`, `gpg.format ssh`, an
// ed25519 key, set since 2026-08-04 — had been true and inert the whole time, and every commit on
// main read `%G? = N` while the configuration said signing was on. Measured 2026-09-06 in a scratch
// repo: `commit-tree` alone gives N, `commit-tree -S` produces a signature from the same config.
// The flag has to be passed HERE, at the one path that builds commits, exactly like the trailer
// rule above and for exactly the same reason — a hook cannot see a commit-tree.
//
// The flag is not the evidence. A signature that fails to attach leaves a commit that looks
// identical to one nobody tried to sign, so this asks the built commit whether it carries a
// signature rather than trusting that `-S` was accepted. That question is asked BEFORE the
// compare-and-swap: an unsigned commit that never gets referenced costs nothing, and one that has
// already landed cannot be signed afterwards — a signature is a property of the commit object, so
// re-signing means rewriting history and every sha below it.
//
// `%G?` is read for PRESENCE, not for trust. `U` (good signature, no matching principal in
// gpg.ssh.allowedSignersFile) is a signature and passes here; only `N` is unsigned. Verifying WHO
// signed is the verifier's job and depends on a file this tool does not own.
const UNSIGNED_ESCAPE = 'CW_ALLOW_UNSIGNED';

// Read at CALL time, never at module load — the house rule for every env override here.
export const signingRequired = () => process.env[UNSIGNED_ESCAPE] !== '1';

// Build a commit object and refuse to return one that should have been signed and is not.
// Returns { sha } or { error } — never throws for a signing failure, so callers refuse in their
// own idiom instead of unwinding past their own cleanup.
function buildCommit(args, { input = undefined, env = {} } = {}) {
  const required = signingRequired();
  const opts = { cwd: repo(), encoding: 'utf8', env: { ...process.env, ...env } };
  if (input !== undefined) opts.input = input;

  let sha;
  try {
    sha = execFileSync('git', ['commit-tree', ...(required ? ['-S'] : []), ...args], opts).trim();
  } catch (e) {
    if (!required) throw e;                    // not a signing failure — the caller's problem
    const why = String(e.stderr || e.message || '').trim();
    return { error: `git refused to sign the commit — nothing was built.\n  ${why}\n  Fix the signing key, or set ${UNSIGNED_ESCAPE}=1 to land unsigned deliberately.` };
  }
  if (!/^[0-9a-f]{40}$/.test(sha)) return { error: `commit-tree returned no sha — nothing landed.` };
  if (!required) {
    console.error(`commit-phase: WARNING — ${UNSIGNED_ESCAPE}=1, landing ${sha.slice(0, 7)} UNSIGNED.`);
    console.error('  This is permanent: a signature cannot be added to a commit after it lands.');
    return { sha, signed: false };
  }

  // PRESENCE IS A PROPERTY OF THE OBJECT, NOT OF THE VERIFIER.
  //
  // fact: `%G?` answers "did verification succeed", and returns `N` for BOTH "no signature" and "signed, but unverifiable" / it reads N whenever gpg.ssh.allowedSignersFile is unset or missing, which is the default on any fresh machine (expiry: never, prev: broken)
  // fact: measured 2026-09-06 — a commit built with -S carried `gpgsig -----BEGIN SSH SIGNATURE-----` in `git cat-file commit` while `%G?` read `N`, so this guard refused a CORRECTLY SIGNED commit (expiry: never, prev: broken)
  //
  // That is an unknown reported as a verdict, inside the guard written to stop exactly that. The
  // header is the ground truth and decides; `%G?` is still read, but only to REPORT which of
  // good / unverifiable / bad it is. Verifying WHO signed remains the verifier's job.
  const raw = git(['cat-file', 'commit', sha], { allowFail: true });
  if (typeof raw !== 'string') return { error: `built ${sha.slice(0, 7)} but could not read the commit object — refusing rather than assuming.` };
  // Headers end at the first blank line. Armor lines inside a header are continuations and carry a
  // leading space, so an empty line cannot occur before the message — the split is safe, and taking
  // only the header half stops a message body that happens to start a line with `gpgsig ` from
  // reading as a signature.
  const headers = raw.split('\n\n')[0];
  if (!/^gpgsig(?:-sha256)? /m.test(headers)) {
    return { error: `built ${sha.slice(0, 7)} and the object carries NO gpgsig header despite -S — nothing landed.\n  This is the failure the flag alone would have hidden. Set ${UNSIGNED_ESCAPE}=1 to land unsigned deliberately.` };
  }
  const mark = git(['log', '-1', '--format=%G?', sha], { allowFail: true });
  return { sha, signed: true, mark: typeof mark === 'string' ? mark : '?' };
}

function main() {
  const argv = process.argv.slice(2);
  const dashdash = argv.indexOf('--');
  const declared = dashdash === -1 ? [] : argv.slice(dashdash + 1);
  const flags = dashdash === -1 ? argv : argv.slice(0, dashdash);
  const check = flags.includes('--check');
  const mAt = flags.indexOf('-m');
  const message = mAt !== -1 ? flags[mAt + 1] : null;
  const refAt = flags.indexOf('--ref');

  // --from-blob <repoPath>=<contentFile>, repeatable. Parsed before anything is read so a malformed
  // pair refuses without having touched an index.
  const fromBlob = [];
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] !== '--from-blob') continue;
    const pair = flags[i + 1];
    const eq = typeof pair === 'string' ? pair.indexOf('=') : -1;
    if (eq <= 0 || eq === pair.length - 1) {
      console.error(`commit-phase: --from-blob needs <repoPath>=<contentFile>, got ${JSON.stringify(pair ?? null)}.`);
      return 2;
    }
    // OPTIONAL `@<40-hex>` BASE. --from-blob protects against adopting worktree dirt; it does NOT
    // protect against a stale freeze, and until now nothing did. head0 is read when the run starts
    // and the CAS at land time is `update-ref <ref> <new> <head0>` — that catches HEAD moving
    // DURING the land and has no idea when the content was frozen:
    //
    //     freeze <path> from HEAD@1 · somebody lands <path> → HEAD@2 · you run: head0 = HEAD@2,
    //     CAS PASSES, and your stale blob reverts their change with nothing to notice.
    //
    // The tool cannot infer the base — it never sees where the content came from — so the caller
    // DECLARES it and this refuses when it moved. Found by another session on 2026-09-02, which also
    // asked that the refusal name both blobs, because the whole hazard is that nothing looks wrong.
    //
    // Parsed from the right and ONLY when the file does not exist under the literal name, so a
    // path that genuinely ends in `@<hex>` still resolves as itself rather than being split.
    let file = pair.slice(eq + 1);
    let base = null;
    const at = file.lastIndexOf('@');
    if (at > 0 && /^[0-9a-f]{40}$/.test(file.slice(at + 1)) && !existsSync(file)) {
      base = file.slice(at + 1);
      file = file.slice(0, at);
    }
    fromBlob.push({ path: pair.slice(0, eq), file, base });
  }
  if (fromBlob.length && declared.length) {
    // Mixing them would read the working tree for SOME paths, which defeats the one guarantee this
    // mode exists to make. Refuse rather than silently apply two different rules in one commit.
    console.error('commit-phase: --from-blob and a `-- <path>` set are mutually exclusive.');
    console.error('  --from-blob lands supplied CONTENT and reads no working tree; a pathspec land reads it. Pick one.');
    return 2;
  }

  const gitDir = git(['rev-parse', '--absolute-git-dir'], { allowFail: true });
  if (typeof gitDir !== 'string') {
    console.error('commit-phase: not a git repository (or git failed) — refusing.');
    return 2;
  }
  const key = sessionKey();
  const idx = privateIndexPath(gitDir, key);
  const ref = refAt !== -1 ? flags[refAt + 1] : git(['symbolic-ref', '--quiet', 'HEAD'], { allowFail: true });
  if (typeof ref !== 'string' || !ref) {
    console.error('commit-phase: detached HEAD or no symbolic ref — refusing. Name one with --ref.');
    return 2;
  }

  // A replay is a different verb: it takes no -m and no pathspec, because both come from the
  // commits being replayed. Dispatched here, after the ref is known and before anything is staged.
  const ontoAt = flags.indexOf('--onto');
  if (ontoAt !== -1) return replay({ onto: flags[ontoAt + 1], ref, gitDir, key, check });

  // 0. MESSAGE SHAPE, BEFORE ANY INDEX WORK. Validating after staging would mean a rejected message
  // had already built a private index and frozen content, and the refusal's own promise — "nothing
  // was staged" — would be false. It also ordered the two refusals wrongly: a bad message on paths
  // with no changes reported NOTHING-STAGED, sending the author to look at their pathspec when the
  // message was the problem. Cheapest check, so it goes first. `--check` skips it: a pre-flight
  // carries no message and must not be refused for lacking one.
  if (!check && message !== null && message !== undefined) {
    // CW_CONVENTIONAL_TYPES MAY ONLY NARROW. A gate whose enforcement can be widened by an env var
    // is a gate anyone can switch off from the shell — the same shape as a guard that can be
    // silently unregistered, which this repository treats as no guard at all. Naming a type outside
    // DEFAULT_TYPES is refused rather than honoured, so the escape hatch cannot become the bypass.
    // Widening is a commit to DEFAULT_TYPES, which is reviewable; an env var is not.
    let conventionalTypes = DEFAULT_TYPES;
    if (process.env.CW_CONVENTIONAL_TYPES) {
      const asked = process.env.CW_CONVENTIONAL_TYPES.split(',').map((t) => t.trim()).filter(Boolean);
      const widened = asked.filter((t) => !DEFAULT_TYPES.includes(t.toLowerCase()));
      if (widened.length) {
        console.error(`commit-phase: REFUSED — CW_CONVENTIONAL_TYPES may only narrow the allowed set, and it names ${widened.join(', ')}, which ${widened.length === 1 ? 'is' : 'are'} not in it.`);
        console.error(`  Allowed: ${DEFAULT_TYPES.join(', ')}. To add a type, change DEFAULT_TYPES in bin/lib/conventional-commit.mjs — that is reviewable and an env var is not.`);
        return 2;
      }
      conventionalTypes = asked;
    }
    const named = git(['config', '--get', 'commitwork.rules'], { allowFail: true });
    const rules = rulesFor(typeof named === 'string' ? named : null);
    if (!rules.ok) {
      console.error(`commit-phase: REFUSED — ${rules.why}. Nothing was staged, nothing landed.`);
      return 2;
    }
    const declaredPaths = fromBlob.length ? fromBlob.map((b) => b.path) : declared;
    const verdict = validateConventional(message, { ...rules.opts, allowedTypes: conventionalTypes, paths: declaredPaths });
    if (!verdict.ok) {
      console.error(`commit-phase: REFUSED — the message is not a Conventional Commit (v1.0.0) under the ${rules.name} rules.`);
      console.error(formatErrors(verdict, { subject: String(message).split('\n')[0] }));
      console.error('  Nothing was staged, nothing landed. Re-run with a conforming message.');
      console.error(`  Shape: <type>(<scope>)[!]: <imperative verb> … (≤${SUBJECT_MAX} chars${rules.opts.allowedScopes ? ', scope from DEFAULT_SCOPES' : ''}), blank line, body, blank line, footers.`);
      return 2;
    }
  }

  // 1 + 2. Record HEAD, then build the private index FROM that same HEAD. Order matters: reading
  // HEAD after the read-tree would record a value the index may not have been built from.
  const head0 = headSha();
  if (head0 === null) {
    console.error('commit-phase: HEAD unreadable — refusing (unknown is not "unchanged").');
    return 2;
  }
  const env = { GIT_INDEX_FILE: idx };
  const rt = git(['read-tree', head0], { env, allowFail: true });
  if (rt && rt._error) {
    console.error(`commit-phase: read-tree failed — refusing rather than committing a half-built index.\n  ${rt._error}`);
    return 2;
  }

  // 3. Freeze content. Explicit `--` so a path that looks like a rev cannot be one.
  const paths = fromBlob.length ? fromBlob.map((b) => b.path) : declared;
  // R9, unratcheted fix — a WARNING, never a refusal. A change set that touches source and no test
  // is the normal shape of a behaviour change nobody pinned; refusing it would refuse every doc
  // and data land too. The half-lever names the shape at the one moment the author can still add
  // the pin, and asks for nothing (armed 2026-09-06 from the taxonomy lever triage).
  const isSrcPath = (p) => /\.(mjs|js|sh|py)$/.test(p) && !/(^|\/)test\//.test(p) && !/\.test\.mjs$/.test(p);
  const isTestPath = (p) => /(^|\/)test\//.test(p) || /\.test\.mjs$/.test(p);
  if (paths.some(isSrcPath) && !paths.some(isTestPath)) {
    console.error(`commit-phase: R9 — this change set touches source and no test (${paths.filter(isSrcPath).join(', ')}); if it changes behaviour, the fix lands unpinned.`);
  }
  if (fromBlob.length) {
    for (const { path, file, base } of fromBlob) {
      if (!existsSync(file)) {
        console.error(`commit-phase: --from-blob content file does not exist: ${file}. Nothing staged.`);
        if (existsSync(idx)) unlinkSync(idx);
        return 2;
      }
      // MODE FROM HEAD, never a literal. `--cacheinfo 100644,…` on a tracked 100755 rewrites the
      // entry to non-executable and git reports success — a committed script stops being runnable
      // with nothing to notice. For a path HEAD does not carry, fall back to the supplied file's
      // own executable bit rather than guessing 644.
      const entry = git(['ls-tree', head0, '--', path], { allowFail: true });
      const m = typeof entry === 'string' ? entry.match(/^(\d{6})\s/) : null;
      let mode = m ? m[1] : null;

      // STALE-BASE REFUSAL. The entry above already holds head0's blob for this path — the tool
      // had the answer in its hand and only ever read the mode out of it. No extra git call.
      if (base) {
        const b = typeof entry === 'string' ? entry.match(/^\d{6}\s+\w+\s+([0-9a-f]{40})\s/) : null;
        const now = b ? b[1] : null;
        if (now !== base) {
          // BOTH BLOBS ARE NAMED. A silent revert is invisible by construction, so the refusal has
          // to hand over enough to see what moved without a second investigation.
          console.error(`commit-phase: REFUSED — ${path} changed since you froze it.`);
          console.error(`  you declared base : ${base}`);
          console.error(`  HEAD now carries  : ${now ?? '(path absent at HEAD)'}`);
          console.error('  Landing your content would revert whatever landed in between, silently.');
          console.error(`  Re-freeze from current HEAD, re-apply your change, and land:`);
          console.error(`    git show ${head0.slice(0, 7)}:${path} > <file> && <re-apply> && commit-phase --from-blob ${path}=<file>@${now ?? '<blob>'}`);
          if (existsSync(idx)) unlinkSync(idx);
          return 2;
        }
      }
      if (!mode) {
        let x = false;
        try { x = !!(statSync(file).mode & 0o111); } catch { /* unreadable → treat as non-exec */ }
        mode = x ? '100755' : '100644';
      }
      const blob = git(['hash-object', '-w', '--', file], { allowFail: true });
      if (typeof blob !== 'string' || !/^[0-9a-f]{40}$/.test(blob)) {
        console.error(`commit-phase: could not write a blob for ${file} — refusing.\n  ${blob && blob._error}`);
        if (existsSync(idx)) unlinkSync(idx);
        return 2;
      }
      const upd = git(['update-index', '--add', '--cacheinfo', `${mode},${blob},${path}`], { env, allowFail: true });
      if (upd && upd._error) {
        console.error(`commit-phase: update-index failed for ${path} — refusing.\n  ${upd._error}`);
        if (existsSync(idx)) unlinkSync(idx);
        return 2;
      }
      // Print the frozen object BEFORE the land, so the caller can verify the thing that will be
      // committed rather than the working tree it came from — the step the recipes call "freeze
      // first, verify the frozen thing".
      console.error(`commit-phase: froze ${path} ← ${file} · blob ${blob.slice(0, 7)} mode ${mode}`);
    }
  } else if (declared.length) {
    const add = git(['add', '--', ...declared], { env, allowFail: true });
    if (add && add._error) {
      console.error(`commit-phase: add failed — refusing.\n  ${add._error}`);
      return 2;
    }
  }
  const stagedPaths = paths.length
    ? git(['diff', '--cached', '--name-only', head0, '--'], { env }).split('\n').filter(Boolean)
    : [];
  const stagedCount = stagedPaths.length;
  // M27 (check passes against the unchanged artefact), the pure form: a .replace() that matched
  // nothing left a file byte-identical to HEAD, every check passed, and the only witness was this
  // tool printing "landed 1 path(s)" where two were expected. A path DECLARED and NOT STAGED is
  // exactly that case, and it is named here, per path, before the land — the moment the author can
  // still notice. When it is the ONLY path, landVerdict below refuses as nothing-staged; alongside
  // real changes it is a warning, because a docs land that carries one untouched sibling is
  // ordinary and refusing it would teach authors to trim their declarations rather than read them.
  // Directories and globs are not files and are not named; only a declared FILE can be unchanged.
  if (!fromBlob.length) {
    const staged = new Set(stagedPaths);
    const isFile = (p) => { try { return statSync(resolve(repo(), p)).isFile(); } catch { return false; } };
    const unchanged = declared.filter((p) => !staged.has(p) && isFile(p));
    for (const p of unchanged) {
      console.error(`commit-phase: M27 — ${p} is byte-identical to HEAD and is NOT in this commit. If you edited it, the edit did not land in the file.`);
    }
    // P12 (untracked-path co-authorship) — a pathspec land takes the file WHOLE, so a peer's
    // standing hunk lands under this message. The ledger's fingerprints can say whose edits are
    // standing on each declared path (bin/lib/touch-attribution.mjs); this names any peer with one
    // BEFORE the land. A report, not a refusal: landing on a peer's behalf can be deliberate, and
    // bin/stage-mine.mjs is the tool for landing only your own hunks. An unread ledger is said to
    // be unread — it is not "no peer edits".
    reportPeerClaims(stagedPaths);
  }

  // The verdict counts the change set as declared, before the stamp: a set with no change of its
  // own is still nothing-staged, and a version bump never turns it into a commit.
  const v = landVerdict({ declared: paths, headAtReadTree: head0, headNow: headNowRead(), stagedCount });
  if (v.verdict !== 'land') {
    console.error(`commit-phase: ${v.verdict.toUpperCase()} — ${v.why}`);
    if (!check && existsSync(idx)) unlinkSync(idx);   // fail closed: leave no index a later run could mistake for fresh
    return v.exit;
  }

  // 3b. THE VERSION STAMP, decided from head0's package.json: the parent the CAS at step 5 checks.
  // A declared package.json is read from the private index, so it is the frozen copy, not the file.
  const parentVf = versionFileAt(head0);
  const authorVf = stagedPaths.includes(VERSION_FILE) ? versionFileAt(null, env) : null;
  const unreadVf = parentVf.error || (authorVf && authorVf.error);
  const stamp = unreadVf
    ? { ok: false, why: `${VERSION_FILE} could not be read: ${unreadVf}` }
    : versionStamp({ parentText: textOf(parentVf), authorText: authorVf ? textOf(authorVf) : undefined });
  if (!stamp.ok) {
    console.error(`commit-phase: REFUSED — ${stamp.why}`);
    console.error('  Nothing landed. Every commit stamps the patch version from its parent; minor and major bumps are manual.');
    if (existsSync(idx)) unlinkSync(idx);
    return 2;
  }
  const stampNote = stamp.none
    ? `no ${VERSION_FILE} at the parent, no version stamp`
    : `${VERSION_FILE} ${stamp.from} → ${stamp.version}${stamp.kept ? ' (the change set\'s own version, ahead of the patch bump)' : ''}`;
  if (check) {
    console.log(`commit-phase: would land ${stagedCount} path(s) on ${ref} at ${head0.slice(0, 7)} via ${idx}`);
    console.log(`commit-phase: ${stamp.none ? '' : 'would stamp '}${stampNote}`);
    console.log('commit-phase: pre-flight only — the guarantee is the update-ref CAS at land time, not this check.');
    return 0;
  }
  if (!message) {
    console.error('commit-phase: -m <message> required to land.');
    return 2;
  }
  if (hasForbiddenTrailer(message)) {
    console.error('commit-phase: REFUSED — the message carries a Co-Authored-By trailer, which is forbidden in this repo.');
    console.error('  Remove the trailer and re-run. Nothing was staged, nothing landed.');
    if (existsSync(idx)) unlinkSync(idx);       // fail closed, like every other refusal above
    return 2;
  }
  // The Conventional Commits refusal is NOT here. It runs at step 0, before the private index is
  // built, so its promise that nothing was staged is literally true. Enforced on this path because
  // it is the one route a commit may take on this tree; a check living anywhere else would be
  // advice. It settles SHAPE only — clauses 2 and 3 say feat is for features and fix for bug fixes,
  // and no parser decides that, so a feature landed under `chore:` passes here and still violates
  // the specification.

  // 3b, applied: after every refusal above, so a refused land writes no blob.
  const stamped = stamp.none ? {} : stampIndex(stamp.text, (authorVf && authorVf.mode) || parentVf.mode || '100644', env);
  if (stamped.error) {
    console.error(`commit-phase: REFUSED — ${stamped.error}. Nothing landed.`);
    if (existsSync(idx)) unlinkSync(idx);
    return 2;
  }

  // 4 + 5. Build the commit and install it with a compare-and-swap against the HEAD we read.
  const tree = git(['write-tree'], { env });
  const signed = buildCommit([tree, '-p', head0, '-m', message], { env });
  if (signed.error) {
    console.error(`commit-phase: REFUSED — ${signed.error}`);
    if (existsSync(idx)) unlinkSync(idx);       // fail closed, like every other refusal above
    return 2;
  }
  const commit = signed.sha;
  const cas = git(['update-ref', ref, commit, head0], { allowFail: true });
  if (cas && cas._error) {
    console.error(`commit-phase: REFUSED at the compare-and-swap — ${ref} moved while this commit was being built. Nothing landed.\n  ${cas._error}`);
    if (existsSync(idx)) unlinkSync(idx);
    return 2;
  }

  recordCommit(commit);

  // 6. Repair the shared index for exactly the declared paths, or the next session reads entries
  // that predate this commit and sees them as staged-in-reverse.
  // The commit has already landed, so a failed repair cannot refuse it — but a silent one leaves
  // every declared path staged in reverse for whoever commits next.
  const repaired = git(sharedIndexRepair(paths), { allowFail: true });
  if (repaired && repaired._error) {
    console.error(`commit-phase: LANDED, but the shared index was NOT repaired for ${paths.length} path(s) — the next `
      + `session reads them as staged in reverse. Repair with: git reset -q HEAD -- <the same paths>\n  ${repaired._error}`);
  }
  console.log(commit);
  console.log(`commit-phase: landed ${commit.slice(0, 7)} on ${ref} · ${stagedCount} path(s) · ${stampNote} · private index ${idx}`);
  // 7. The checkout's package.json follows the stamp, or is named as left behind.
  if (!stamp.none) {
    syncVersionFile({
      before: parentVf,
      after: { blob: stamped.blob, text: stamp.text, version: stamp.version },
      landed: commit,
      taken: authorVf && !authorVf.absent ? authorVf.text : undefined,
    });
  }
  console.log('commit-phase: closure over the change set is a SEPARATE gate — bin/test/tracked-imports.test.mjs reads HEAD.');
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exit(main());
}
