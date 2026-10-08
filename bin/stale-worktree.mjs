#!/usr/bin/env node
// stale-worktree — which dirty paths would DELETE landed work if pathspec-committed as they stand.
//
// WHY. `commit-phase --from-blob` writes HEAD and never touches the working tree, so every blob
// land leaves the worktree copy of that path one commit behind. `git add` reads the worktree, so
// the next pathspec commit of that path — by anyone — silently reverts whatever landed in between,
// behind a diff that looks correct about the author's own change.
//
// Measured 2026-09-06/07 on this tree: 325 dirty tracked files, and pathspec-landing all of them
// as they stood would have removed lines that are at HEAD. Four of the casualties were the author's
// own landed work, left behind by the author's own blob lands, hours after warning another session
// about this exact mechanism. A discipline did not survive first contact with its own author, so
// this is a command instead.
//
// THE SIGNAL, and why it is not just "the diff deletes lines". Deleting lines is ordinary: a
// refactor removes code on purpose. What is NOT ordinary is a worktree copy missing content that
// arrived in the most recent commit to touch that path — that copy cannot have been derived from
// current HEAD, so its deletions are staleness rather than intent. Reporting every deletion would
// fire on every legitimate removal and be muted within a day (see A4, alarm fatigue); reporting
// only the ones that predate HEAD's own last write is specific enough to act on.
//
// Reports, never writes. Refreshing a path is a judgement — a peer may hold live content there,
// and the tree must not move under them — so this prints the finding and stops.
//
// usage: node bin/stale-worktree.mjs [--json] [-- <path>…]
// exit:  0 nothing stale · 1 at least one stale path · 2 could not measure

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isMainModule } from '../lib/is-main.mjs';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const gitQuiet = (...a) => { try { return git(...a); } catch { return ''; } };

/** Lines a commit ADDED to a path, trimmed and long enough to be a fingerprint. */
export function addedLines(sha, path) {
  const d = gitQuiet('show', '--format=', '--unified=0', sha, '--', path);
  return d.split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1).trim())
    .filter((l) => l.length >= 24); // short lines collide across a file; they prove nothing
}

/**
 * Is this worktree copy missing content from the newest commit that wrote the path?
 * Returns null when the question does not apply (untracked, deleted, no history, no fingerprints).
 */
export function staleness(path, { head = 'HEAD', read } = {}) {
  const last = gitQuiet('log', '-1', '--format=%H', head, '--', path).trim();
  if (!last) return null;
  const added = addedLines(last, path);
  if (!added.length) return null; // a pure-deletion commit leaves nothing to look for
  const live = read ? read(path) : (existsSync(path) ? git('show', `:${path}`) && '' : '');
  return { last, added, live };
}

/**
 * Adds/dels a pathspec land of `path` would make against HEAD.
 *
 * NEITHER NUMBER ANSWERS "would my landed work be lost", and both were used as though they did.
 * The RAW deletion column counts a replaced line as a deletion, so it overstates: this tool first
 * reported 40 lines at risk in bin/taxonomy-db.mjs where the net was 5. NET shrink understates in
 * the opposite way: a peer replacing four landed lines with four of their own nets zero while the
 * four are still gone — measured here on monitor/perf-profiles.json, net 0, content missing.
 * The measure that answers the question is `missing`: lines HEAD's own last write added that the
 * worktree copy does not contain. Both columns are still reported, labelled, as context.
 */
const shape = (path) => {
  const [a, d] = gitQuiet('diff', '--numstat', 'HEAD', '--', path).trim().split('\t');
  const add = Number.isFinite(+a) ? +a : 0;
  const del = Number.isFinite(+d) ? +d : 0;
  return { add, del, net: del - add };
};

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const sep = argv.indexOf('--');
  const only = sep === -1 ? [] : argv.slice(sep + 1);

  let dirty;
  try {
    dirty = git('diff', '--name-only', 'HEAD').split('\n').filter(Boolean);
  } catch (e) {
    console.error(`stale-worktree: cannot read the working tree (${e.message}). This is a refusal, not a clean result.`);
    process.exit(2);
  }
  const paths = only.length ? dirty.filter((p) => only.includes(p)) : dirty;

  const findings = [];
  for (const p of paths) {
    if (!existsSync(p)) continue; // deleted in the worktree: a different question
    const last = gitQuiet('log', '-1', '--format=%H', 'HEAD', '--', p).trim();
    if (!last) continue;
    const added = addedLines(last, p);
    if (!added.length) continue;
    let live = '';
    try { live = execFileSync('cat', [p], { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch { continue; }
    const missing = added.filter((l) => !live.includes(l));
    if (!missing.length) continue;
    // DETECTION is the last write; MAGNITUDE is not. A copy stale against HEAD's newest commit is
    // usually stale against older ones too, and counting only the newest understates badly: on
    // docs/TRAPS.md the newest commit added one line (a stamp) while a 41-line entry from an
    // earlier commit was ALSO absent, so the honest figure was 42 and the reported one was 1.
    // Once staleness is established, everything of HEAD's the copy lacks is at risk, so count that.
    const headLines = gitQuiet('show', `HEAD:${p}`).split('\n').map((l) => l.trim()).filter((l) => l.length >= 24);
    const missingFromHead = headLines.filter((l) => !live.includes(l)).length;
    findings.push({
      path: p,
      lastCommit: last.slice(0, 7),
      subject: gitQuiet('log', '-1', '--format=%s', last).trim().slice(0, 60),
      missingOfAdded: `${missing.length}/${added.length}`,
      missing: missingFromHead,
      missingOfLastWrite: missing.length,
      ...shape(p),
      sample: missing[0].slice(0, 72),
    });
  }

  if (asJson) { console.log(JSON.stringify({ dirty: paths.length, stale: findings }, null, 2)); process.exit(findings.length ? 1 : 0); }

  if (!findings.length) {
    console.log(`stale-worktree: ${paths.length} dirty path(s) checked, none stale against HEAD's own last write.`);
    process.exit(0);
  }
  const total = findings.reduce((a, f) => a + f.missing, 0);
  console.log(`stale-worktree: ${findings.length} of ${paths.length} dirty path(s) are STALE — their worktree copy predates HEAD's last write to them.`);
  console.log(`${total} landed line(s) are missing from those copies and would be lost to a pathspec land.`);
  console.log(`(Counted as lines of HEAD's blob the worktree lacks, once staleness is established by the`);
  console.log(` newest commit. Counting only that newest commit understates: docs/TRAPS.md reported 1 while`);
  console.log(` 42 were missing. The raw deletion column`);
  console.log(` overstates it — a replaced line counts twice — and net shrink understates it, because a`);
  console.log(` replacement can net zero while the landed content is still gone.)\n`);
  for (const f of findings.sort((a, b) => b.missing - a.missing)) {
    console.log(`  ${String(f.missing).padStart(5)} lost   ${f.path}   (raw -${f.del}, net ${f.net >= 0 ? '-' : '+'}${Math.abs(f.net)})`);
    console.log(`             missing ${f.missingOfAdded} of the lines ${f.lastCommit} added — "${f.subject}"`);
    console.log(`             e.g. ${JSON.stringify(f.sample)}`);
  }
  console.log('\nThis reports; it does not refresh. A peer may hold live content in these paths, and the');
  console.log('tree must not move under them. Land with --from-blob <path>=<file>@<40-hex> to be refused');
  console.log('on a stale freeze, and sync the path yourself only when you know nothing live is there.');
  process.exit(1);
}

if (isMainModule(import.meta.url)) main();
