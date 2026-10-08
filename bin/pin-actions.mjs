#!/usr/bin/env node
// commitwork — pin-actions: keep GitHub Actions SHA pins current, locally.
//
// Modes:  node bin/pin-actions.mjs            report: CURRENT / STALE / UNPINNED / UNVERIFIABLE
//         node bin/pin-actions.mjs --write    rewrite STALE + UNPINNED lines to the newest SHA
//                                             within the SAME MAJOR (a major bump is a review,
//                                             not a refresh), atomic tmp+rename
// Env:    CW_WORKFLOWS_DIR  workflow dir (default <repo>/.github/workflows), read at call time
// Exit:   0 all current · 1 any stale/unpinned · 2 any unverifiable (network/tag failure)
//
// explicit uncertainty: unfetchable tags are UNVERIFIABLE — never skipped, never counted current.

import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

// SUBPATH ACTIONS COUNT. `owner/repo` was the whole pattern until 2026-09-06, so every
// `owner/repo/subpath@sha` line was not matched, not reported, and not counted — the report said
// CURRENT for the file and had never looked at them. Found by adding .github/workflows/codeql.yml,
// whose two most security-relevant pins are github/codeql-action/init and .../analyze: a fresh run
// listed the checkout pin on line 61 and neither of the ones that actually matter.
//
// This is the failure mode this tool exists to prevent, turned on the tool: a pin nobody verifies.
// It is worse than an unpinned ref, because an unpinned ref is REPORTED as UNPINNED while these
// were reported as nothing at all — and silence reads exactly like a clean file.
const USES_RE = /^(\s*(?:-\s+)?uses:\s+)([\w.-]+\/[\w.-]+(?:\/[\w.-]+)*)@([\w.\/-]+)(\s*#\s*(v?[\w.-]+))?\s*$/;

// Tags live on the REPOSITORY, never on the subpath: github/codeql-action/init is versioned by
// github/codeql-action. Resolving the full path would 404 and fail closed to UNVERIFIABLE — safe,
// and permanently useless, which is its own way of never checking a pin.
export const repoOf = (action) => action.split('/').slice(0, 2).join('/');
const SHA_RE = /^[0-9a-f]{40}$/;
const TAG_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

export function parseWorkflow(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    const m = USES_RE.exec(line);
    if (!m) return;
    // local composite actions (./…) and docker:// refs are not registry tags — out of scope
    if (m[2].startsWith('.') || m[3].startsWith('docker')) return;
    out.push({ line: i, action: m[2], ref: m[3], comment: m[5] || null, prefix: m[1] });
  });
  return out;
}

const semver = (tag) => {
  const m = TAG_RE.exec(tag);
  return m ? [+m[1], +(m[2] || 0), +(m[3] || 0), m[2] === undefined ? 0 : 1] : null;
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3];

// Fully-qualified tags outrank bare moving majors (v4.3.0 over v4) at equal version.
export function newestTag(tags, major = null) {
  let best = null;
  for (const [tag, sha] of tags) {
    const v = semver(tag);
    if (!v) continue;
    if (major !== null && v[0] !== major) continue;
    if (!best || cmp(v, best.v) > 0) best = { tag, sha, v };
  }
  return best;
}

// `tags` null (listing failed) is UNVERIFIABLE, never CURRENT.
export function planLine(entry, tags) {
  if (tags === null) return { ...entry, state: 'UNVERIFIABLE', why: 'tag listing failed — cannot judge this pin' };
  const declaredMajor = entry.comment ? (semver(entry.comment)?.[0] ?? null) : null;
  if (!SHA_RE.test(entry.ref)) {
    const refMajor = semver(entry.ref)?.[0] ?? declaredMajor;
    const best = newestTag(tags, refMajor);
    if (!best) return { ...entry, state: 'UNVERIFIABLE', why: `no release tag found for major ${refMajor ?? '(any)'}` };
    return { ...entry, state: 'UNPINNED', to: best, why: `mutable ref '${entry.ref}' — pin to ${best.sha.slice(0, 7)} (${best.tag})` };
  }
  const best = newestTag(tags, declaredMajor);
  if (!best) return { ...entry, state: 'UNVERIFIABLE', why: 'pinned, but no release tag matches the declared major to compare against' };
  if (best.sha === entry.ref) return { ...entry, state: 'CURRENT', why: `${best.tag}` };
  return { ...entry, state: 'STALE', to: best, why: `pinned at ${entry.comment || entry.ref.slice(0, 7)}, newest in major is ${best.tag} (${best.sha.slice(0, 7)})` };
}

export function applyPlan(text, plans) {
  const lines = text.split('\n');
  for (const p of plans) {
    if (!p.to) continue;
    lines[p.line] = `${p.prefix}${p.action}@${p.to.sha} # ${p.to.tag}`;
  }
  return lines.join('\n');
}

function lsRemoteTags(action) {
  try {
    const out = execFileSync('git', ['ls-remote', '--tags', `https://github.com/${repoOf(action)}`], { encoding: 'utf8', timeout: 30000 });
    // Annotated tags list twice; the ^{} deref wins so the recorded sha is the COMMIT.
    const map = new Map();
    for (const row of out.split('\n')) {
      const [sha, ref] = row.split('\t');
      if (!sha || !ref) continue;
      const tag = ref.replace('refs/tags/', '').replace(/\^\{\}$/, '');
      if (ref.endsWith('^{}') || !map.has(tag)) map.set(tag, sha);
    }
    return [...map.entries()];
  } catch {
    return null; // fail closed: the caller records UNVERIFIABLE, never a silent CURRENT
  }
}

if (isMainModule(import.meta.url)) {
  const write = process.argv.includes('--write');
  const dir = process.env.CW_WORKFLOWS_DIR || join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), '.github', 'workflows');
  if (!existsSync(dir)) { console.error(`pin-actions: ${dir} does not exist`); process.exit(2); }
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).sort();
  const tagCache = new Map();
  let stale = 0, unverifiable = 0;
  for (const f of files) {
    const p = join(dir, f);
    const text = readFileSync(p, 'utf8');
    const entries = parseWorkflow(text);
    const plans = entries.map((e) => {
      if (!tagCache.has(e.action)) tagCache.set(e.action, lsRemoteTags(e.action));
      return planLine(e, tagCache.get(e.action));
    });
    for (const pl of plans) {
      const mark = { CURRENT: '🟢', STALE: '🟠', UNPINNED: '🟠', UNVERIFIABLE: '⚪' }[pl.state];
      console.log(`${mark} ${pl.state.padEnd(12)} ${f}:${pl.line + 1}  ${pl.action}@${pl.ref.slice(0, 12)}  ${pl.why}`);
      if (pl.state === 'STALE' || pl.state === 'UNPINNED') stale++;
      if (pl.state === 'UNVERIFIABLE') unverifiable++;
    }
    if (write && plans.some((pl) => pl.to)) {
      writeAtomic(p, applyPlan(text, plans));
      console.log(`   wrote ${f}`);
    }
  }
  process.exit(stale && !write ? 1 : unverifiable ? 2 : 0);
}
