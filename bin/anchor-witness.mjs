#!/usr/bin/env node
// Off-host witness of the anchor stores' chain tips (DESIGN-v4 step 7, first form).
//
// The anchor stores live under $HOME, writable by the same account whose tampering they exist to
// catch. This records each store's head {records, tipHash, generations, chain} as a commit on the
// `witness-anchors` branch of commitwork-remote and pushes it, never forced. The watcher there
// (watch.mjs, scheduled) checks every new witness is a fast-forward and monotonic, and keeps its
// own chained ledger. Only hashes and counts leave this machine: no paths, no journal content.
//
// The agent-tag roster is witnessed directly rather than through an anchor store: its chain cannot
// vouch for its own last row, and a head off this box can.
//
// Written with plumbing (hash-object, mktree, commit-tree, update-ref <new> <old>), so it never
// touches that repository's index, working tree or checked-out branch.
//
// It refuses to record a regression: a store with fewer records than the last witness and no new
// rotated generation is an alarm, and the witness keeps the last good state rather than
// overwriting it with a laundered one.
//
// usage: anchor-witness.mjs [--dry] [--no-push] [--json]
//   CW_WITNESS_REPO    local clone of the witness repository (default ../commitwork-remote)
//   CW_WITNESS_REMOTE  remote name (default origin)
//   CW_WITNESS_BRANCH  branch (default witness-anchors)
// Exit: 0 recorded or unchanged · 1 alarm (regression, diverged remote) · 2 unknown (offline,
// not permitted, no repository) — never 0 for a state that proves nothing.

import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readJournalFile, dataAnchorsPath, anchorsPath } from './lib/verdict-journal-core.mjs';
import { readTailLine } from './lib/touch-chain.mjs';
import { agentTags } from './lib/store-paths.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { gitChildEnv } from './lib/git-env.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lineHash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const env = (k, d) => process.env[k] || d;

export const witnessConfig = () => ({
  repo: env('CW_WITNESS_REPO', resolve(REPO, '..', 'commitwork-remote')),
  remote: env('CW_WITNESS_REMOTE', 'origin'),
  branch: env('CW_WITNESS_BRANCH', 'witness-anchors'),
});

/** Head state of one chained store: count, tip, rotated generations, chain tally. No paths. */
export function storeHead(name, path) {
  const j = readJournalFile(path); // throws on anything but ENOENT: an unreadable store is never empty
  const dir = dirname(path);
  const base = basename(path);
  let generations = 0;
  try { generations = readdirSync(dir).filter((f) => f.startsWith(`${base}.`) && /^\d+$/.test(f.slice(base.length + 1))).length; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const tail = j.absent ? null : readTailLine(path);
  return { name, present: !j.absent, records: j.records.length + j.torn, tipHash: tail ? lineHash(tail) : null, generations, chain: j.chain || null };
}

/** A store may only grow, or reset because it rotated into a new generation. */
export function regressions(prev, next) {
  const out = [];
  const before = new Map((prev?.stores || []).map((s) => [s.name, s]));
  for (const s of next.stores) {
    const p = before.get(s.name);
    if (!p || !p.present) continue;
    if (!s.present) out.push(`${s.name}: was present with ${p.records} records, now absent`);
    else if (s.generations < p.generations) out.push(`${s.name}: rotated generations fell ${p.generations} -> ${s.generations}`);
    else if (s.generations === p.generations && s.records < p.records) out.push(`${s.name}: records fell ${p.records} -> ${s.records} with no new generation`);
    else if (s.generations === p.generations && s.records === p.records && s.tipHash !== p.tipHash) out.push(`${s.name}: same record count, different tip — rewritten in place`);
  }
  for (const [name] of before) if (!next.stores.some((s) => s.name === name)) out.push(`${name}: store no longer reported`);
  return out;
}

function git(repo, args, input) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', input, timeout: 60_000, env: gitChildEnv() });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), status: r.status };
}

/** Why a push was rejected decides what it means; only non-fast-forward is divergence. */
export function classifyPushFailure(stderr) {
  if (/non-fast-forward|fetch first|\[rejected\]|stale info/i.test(stderr)) return 'diverged';
  if (/authentication|permission denied|403|could not read Username|access denied/i.test(stderr)) return 'not-permitted';
  if (/could not resolve host|timed out|unable to access|network|connection (refused|reset)|Operation timed out/i.test(stderr)) return 'offline';
  return 'push-failed';
}

const normUrl = (u) => String(u || '').trim().replace(/\/\/[^@/]+@/, '//').replace(/\.git\/?$/, '').replace(/\/$/, '').toLowerCase();

/**
 * A witness is worth something only if it lands somewhere else. Refuse when git would write
 * anywhere but the witness clone, or when that clone publishes to this repository's own origin.
 */
export function independence(cfg) {
  const root = realpathSync(cfg.repo);
  const top = git(cfg.repo, ['rev-parse', '--show-toplevel']);
  const gitDir = git(cfg.repo, ['rev-parse', '--absolute-git-dir']);
  const inside = (p) => { try { const r = realpathSync(p); return r === root || r.startsWith(root + sep); } catch { return false; } };
  if (!(top.ok && inside(top.out)) && !(gitDir.ok && inside(gitDir.out))) {
    return { state: 'wrong-repository', code: 2, detail: `git resolves ${cfg.repo} to ${top.out || gitDir.out || 'nothing'}` };
  }
  const theirs = git(cfg.repo, ['remote', 'get-url', cfg.remote]);
  const ours = git(REPO, ['remote', 'get-url', 'origin']);
  if (theirs.ok && ours.ok && normUrl(theirs.out) === normUrl(ours.out)) {
    return { state: 'not-independent', code: 2, detail: `${cfg.repo} pushes to this repository's own origin` };
  }
  return null;
}

export function buildWitness({ remoteLedgerTip = null } = {}) {
  return {
    v: 1,
    producer: 'commitwork bin/anchor-witness.mjs',
    stores: [
      storeHead('verdict-anchors', anchorsPath()),
      storeHead('data-anchors', dataAnchorsPath()),
      storeHead('agent-tags', agentTags()),
    ],
    remoteLedgerTip,
  };
}

export function runWitness({ dry = false, push = true } = {}) {
  const cfg = witnessConfig();
  if (process.env.NODE_TEST_CONTEXT && !process.env.CW_WITNESS_REPO) {
    throw new Error('anchor-witness: refusing to write under a test runner without CW_WITNESS_REPO — a forgotten seam would witness into the real repository');
  }
  if (!existsSync(join(cfg.repo, '.git')) && !existsSync(join(cfg.repo, 'HEAD'))) return { state: 'no-repository', code: 2, detail: cfg.repo };
  const independent = independence(cfg);
  if (independent) return independent;
  const refName = `refs/heads/${cfg.branch}`;
  const remoteRef = `refs/remotes/${cfg.remote}/${cfg.branch}`;

  // Sync from the remote first: the remote is the witness of record, the local ref only a cache.
  // One fetch per branch: a multi-ref fetch fails whole when either branch does not exist yet.
  let online = true;
  for (const b of [cfg.branch, 'watch-ledger']) {
    const f = git(cfg.repo, ['fetch', '-q', cfg.remote, `+refs/heads/${b}:refs/remotes/${cfg.remote}/${b}`]);
    if (!f.ok && !/couldn't find remote ref/i.test(f.err)) online = false;
  }
  const remoteTip = git(cfg.repo, ['rev-parse', '--verify', '-q', remoteRef]).out || null;
  const localTip = git(cfg.repo, ['rev-parse', '--verify', '-q', refName]).out || null;
  if (remoteTip && localTip && remoteTip !== localTip && !git(cfg.repo, ['merge-base', '--is-ancestor', remoteTip, localTip]).ok) {
    return { state: 'diverged', code: 1, detail: `local ${refName} ${localTip.slice(0, 12)} does not contain remote ${remoteTip.slice(0, 12)}` };
  }
  const parent = localTip || remoteTip;
  const ledgerTip = git(cfg.repo, ['rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/watch-ledger`]).out || null;

  const next = buildWitness({ remoteLedgerTip: ledgerTip });
  let prev = null;
  if (parent) {
    const shown = git(cfg.repo, ['show', `${parent}:witness.json`]);
    if (shown.ok) { try { prev = JSON.parse(shown.out); } catch { return { state: 'previous-witness-unreadable', code: 1, detail: parent }; } }
  }
  const regress = regressions(prev, next);
  if (regress.length) return { state: 'REGRESSION', code: 1, detail: regress, witness: next };

  const body = `${JSON.stringify(next, null, 1)}\n`;
  if (prev && JSON.stringify(prev) === JSON.stringify(next)) return pushIfBehind({ cfg, refName, remoteTip, localTip, push, online, state: 'unchanged' });
  if (dry) return { state: 'would-record', code: 0, witness: next };

  const blob = git(cfg.repo, ['hash-object', '-w', '--stdin'], body);
  if (!blob.ok) return { state: 'write-failed', code: 2, detail: blob.err };
  const tree = git(cfg.repo, ['mktree'], `100644 blob ${blob.out}\twitness.json\n`);
  if (!tree.ok) return { state: 'write-failed', code: 2, detail: tree.err };
  const summary = next.stores.map((s) => `${s.name}=${s.records}${s.generations ? `+${s.generations}g` : ''}`).join(' ');
  const commit = git(cfg.repo, ['commit-tree', tree.out, ...(parent ? ['-p', parent] : []), '-m', `witness: ${summary}`]);
  if (!commit.ok) return { state: 'write-failed', code: 2, detail: commit.err };
  // Compare-and-swap: the zero id asserts the ref did not exist.
  const cas = git(cfg.repo, ['update-ref', refName, commit.out, localTip || '0'.repeat(40)]);
  if (!cas.ok) return { state: 'raced', code: 2, detail: cas.err };
  return pushIfBehind({ cfg, refName, remoteTip, localTip: commit.out, push, online, state: 'recorded', commit: commit.out, witness: next });
}

function pushIfBehind({ cfg, refName, remoteTip, localTip, push, online, state, commit, witness }) {
  if (!push || !localTip || localTip === remoteTip) return { state, code: 0, commit, pushed: false, witness };
  if (!online) return { state: `${state}, offline`, code: 2, commit, pushed: false, witness };
  const p = git(cfg.repo, ['push', '-q', cfg.remote, `${refName}:${refName}`]);
  if (p.ok) return { state, code: 0, commit, pushed: true, witness };
  const why = classifyPushFailure(p.err);
  return { state: `${state}, push ${why}`, code: why === 'diverged' ? 1 : 2, commit, pushed: false, detail: p.err.slice(0, 300), witness };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  let r;
  try { r = runWitness({ dry: args.includes('--dry'), push: !args.includes('--no-push') }); }
  catch (e) { r = { state: 'error', code: 2, detail: e.message }; }
  if (args.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    console.log(`anchor-witness: ${r.state}${r.commit ? ` ${r.commit.slice(0, 12)}` : ''}${r.pushed ? ' (pushed)' : ''}`);
    if (r.detail) console.log(`  ${Array.isArray(r.detail) ? r.detail.join('\n  ') : r.detail}`);
  }
  process.exit(r.code);
}
