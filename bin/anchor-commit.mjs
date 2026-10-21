#!/usr/bin/env node
// bin/anchor-commit.mjs — commit the chain-anchor store in the sidecar, so a tip exists somewhere
// the chain's writer cannot rewrite.
//
// The anchor file (.claude/store/chain-tips.jsonl) is a symlink into the sidecar working tree:
// same disk, same uid as the chains it anchors, so a local line is a consistency check and not
// evidence. Its committed history is the first copy a local writer does not control. This tool is
// the one step between the two, and it does exactly one thing: a PATHSPEC commit of that file in
// the repo the symlink resolves into. Pathspec, never bare — the sidecar is written by many
// sessions and a bare commit would adopt whatever they have staged.
//
// usage: node bin/anchor-commit.mjs [--check] [--push]
//   --check   report what would be committed; write nothing
//   --push    push the sidecar's current branch after a commit
//   CW_CHAIN_ANCHORS names the store (read at call time); default = the real one.
// exit: 0 committed or nothing to commit · 2 refused (store is not a symlink into a git repo —
//       the sidecar contract, see bin/test/sidecar-paths.test.mjs) · 3 git failed
import { lstatSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { anchorsPath, anchorRepo } from '../monitor/history-chain.mjs';
import { isMainModule } from '../lib/is-main.mjs';

// Every git call is BOUNDED. `add`/`commit` fail fast on a held index.lock (measured: 67ms), but
// `push` talks to a network and a sweep that calls this must not be able to hang on it — a
// monitoring run blocked on a git remote is an outage produced by an observability feature.
const GIT_MS = Number(process.env.CW_ANCHOR_GIT_TIMEOUT_MS || 15_000);
const PUSH_MS = Number(process.env.CW_ANCHOR_PUSH_TIMEOUT_MS || 60_000);
const git = (repo, args, timeout = GIT_MS) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout });

export function anchorCommit({ check = false, push = false, path = anchorsPath(), log = () => {} } = {}) {
  if (!existsSync(path)) return { code: 0, committed: false, why: `${path} does not exist yet — nothing to commit` };
  // The sidecar contract: the store DIRECTORY is a symlink (never the file), resolving into a git
  // repo. A real directory in its place is the failure sidecar-paths.test.mjs exists to catch, and
  // committing "into" it would commit nowhere.
  let isLink = false;
  try { isLink = lstatSync(dirname(path)).isSymbolicLink(); } catch { /* absent */ }
  if (!isLink && !process.env.CW_CHAIN_ANCHORS) return { code: 2, committed: false, why: `${dirname(path)} is not a symlink — the store is not sidecar-backed; refusing` };
  const { repo, rel, error } = anchorRepo(path);
  if (error) return { code: 2, committed: false, why: error };

  let status;
  try { status = git(repo, ['status', '--porcelain', '--', rel]).trim(); }
  catch (e) { return { code: 3, committed: false, why: `git status failed in ${repo}: ${String(e.stderr || e.message).trim()}` }; }
  if (!status) return { code: 0, committed: false, why: `${rel} is unchanged at HEAD of ${repo} — nothing to commit`, repo, rel };

  // how many lines are new, for the message — from the diff, never from the file (a tracked file's
  // diff is the truth; an untracked one is all new)
  let added = null;
  try {
    const tracked = git(repo, ['ls-files', '--', rel]).trim();
    added = tracked ? (git(repo, ['diff', '--numstat', '--', rel]).trim().split('\t')[0] || null) : null;
  } catch { /* informational */ }
  const msg = `chain anchors: ${added !== null ? `${added} new line(s)` : 'first commit of the anchor store'}\n\nA copy of each area's chain tip outside the directory that holds the chain. Committed by\nbin/anchor-commit.mjs; see monitor/history-chain.mjs for what a committed anchor proves.`;
  if (check) return { code: 0, committed: false, dryRun: true, why: `would commit ${rel} in ${repo}: ${added !== null ? `${added} new line(s)` : 'untracked, all new'}`, repo, rel };

  try {
    git(repo, ['add', '--', rel]);
    git(repo, ['commit', '-q', '-m', msg, '--', rel]);
  } catch (e) { return { code: 3, committed: false, why: `git commit failed in ${repo}: ${String(e.stderr || e.message).trim()}`, repo, rel }; }
  const sha = git(repo, ['rev-parse', '--short', 'HEAD']).trim();
  log(`anchor-commit: ${sha} — ${rel} in ${repo}`);
  let pushed = false;
  if (push) {
    try { git(repo, ['push', '-q'], PUSH_MS); pushed = true; log('anchor-commit: pushed'); }
    catch (e) {
      const timedOut = e && (e.code === 'ETIMEDOUT' || e.signal === 'SIGTERM');
      return { code: 3, committed: true, sha, pushed: false, repo, rel,
        why: `committed ${sha} but push ${timedOut ? `timed out after ${PUSH_MS}ms — the commit stands and a later push carries it` : `failed: ${String(e.stderr || e.message).trim()}`}` };
    }
  }
  return { code: 0, committed: true, sha, pushed, why: null, repo, rel };
}

const isMain = isMainModule(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const r = anchorCommit({ check: args.includes('--check'), push: args.includes('--push'), log: (m) => console.log(m) });
  if (r.why) (r.code ? console.error : console.log)(`anchor-commit: ${r.why}`);
  process.exit(r.code);
}
