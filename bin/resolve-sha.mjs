#!/usr/bin/env node
// bin/resolve-sha.mjs — what is this old commit called NOW?
//
// usage:
//   node bin/resolve-sha.mjs <sha>                one sha, old -> new
//   node bin/resolve-sha.mjs --scan <file…>       rewrite dead shas cited in docs
//   node bin/resolve-sha.mjs --rebuild            regenerate the map from the object store
//
// Maps pre-rewrite shas to current names by tree-hash matching (message-only rewrites keep trees).
// The map is kept in the private stores (monitor/private/): .git/ state does not survive gc, reclone or
// a fresh machine, and the map indexes private history, so it does not ship. CW_COMMIT_MAP overrides.
// Next rewrite: commit filter-repo's commit-map; tree matching cannot resolve a tree-changing rewrite.
// Not `git replace`: refs/replace/* are neither pushed nor fetched by default.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitMapPathFor } from '../monitor/store-paths.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mapPath = () => commitMapPathFor(CW);
const git = (args) => execFileSync('git', args, { cwd: CW, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
// Existence probes are expected to fail — suppress stderr so the answer doesn't read as a broken tool.
const gitQuiet = (args) => execFileSync('git', args, { cwd: CW, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const isCommit = (sha) => { try { gitQuiet(['cat-file', '-e', `${sha}^{commit}`]); return true; } catch { return false; } };
const inHead = (sha) => { try { gitQuiet(['merge-base', '--is-ancestor', sha, 'HEAD']); return true; } catch { return false; } };

/** old -> new. Absent map is a stated refusal, never an empty answer that reads as "no rewrites". */
function loadMap() {
  if (!existsSync(mapPath())) {
    console.error(`no commit map at ${mapPath()} — cannot say whether a sha was rewritten or never existed.`);
    console.error('Run --rebuild while the old objects are still in the object store.');
    process.exit(2);
  }
  const m = new Map();
  for (const line of readFileSync(mapPath(), 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [o, n] = line.trim().split(/\s+/);
    if (o && n) m.set(o, n);
  }
  return m;
}

// Prefix lookup: docs cite 7-10 chars, the map holds 40.
function resolveOne(map, sha) {
  const s = String(sha).toLowerCase().replace(/[^0-9a-f]/g, '');
  if (!s) return null;
  if (map.has(s)) return map.get(s);
  for (const [o, n] of map) if (o.startsWith(s)) return n;
  return null;
}

function rebuild() {
  const cur = new Map();
  for (const l of git(['log', '--format=%H %T', 'HEAD']).trim().split('\n')) {
    const [h, t] = l.split(' ');
    if (!cur.has(t)) cur.set(t, h);          // oldest wins: the first commit to carry a tree
  }
  const seen = new Set(), out = [];
  const tips = [...new Set(git(['reflog', '--format=%H']).trim().split('\n').filter(Boolean))];
  for (const tip of tips) {
    let log = '';
    try { log = git(['log', '--format=%H %T', tip]); } catch { continue; }
    for (const l of log.trim().split('\n')) {
      const [h, t] = l.split(' ');
      if (seen.has(h)) continue;
      seen.add(h);
      const n = cur.get(t);
      if (n && n !== h) out.push(`${h} ${n}`);
    }
  }
  out.sort();
  const header = `# old-sha new-sha — rebuilt ${process.env.CW_NOW || new Date().toISOString().slice(0, 10)} by tree-hash matching.\n`
    + '# See bin/resolve-sha.mjs for why this exists and how it was built.\n';
  writeFileSync(mapPath(), header + out.join('\n') + '\n');
  console.log(`${out.length} rewritten commits mapped -> ${mapPath()}`);
}

const argv = process.argv.slice(2);
if (argv.includes('--rebuild')) { rebuild(); process.exit(0); }

const map = loadMap();

if (argv[0] === '--scan') {
  // Report, never rewrite in place — an automated edit to prose breaks quotations.
  let hits = 0;
  for (const f of argv.slice(1)) {
    let src = '';
    try { src = readFileSync(f, 'utf8'); } catch { console.error(`  ${f}: unreadable`); continue; }
    for (const m of new Set([...src.matchAll(/\b[0-9a-f]{7,40}\b/g)].map((x) => x[0]))) {
      const live = isCommit(m);
      if (live && inHead(m)) continue;                        // still resolves — nothing to say
      const now = resolveOne(map, m);
      if (now) { hits++; console.log(`${f}: ${m} -> ${now.slice(0, 10)}`); }
      else if (live) console.log(`${f}: ${m} — exists but is NOT in HEAD and is unmapped (abandoned tip?)`);
    }
  }
  console.log(hits ? `\n${hits} dead sha(s) resolved.` : '\nno dead shas found.');
  process.exit(0);
}

if (!argv.length) {
  console.error('usage: resolve-sha.mjs <sha> | --scan <file…> | --rebuild');
  process.exit(2);
}

for (const sha of argv) {
  const n = resolveOne(map, sha);
  if (n) { console.log(`${sha} -> ${n}`); continue; }
  const live = isCommit(sha);
  console.log(live
    ? `${sha} — not rewritten (or already current); it resolves as-is`
    : `${sha} — UNKNOWN: not in the map and not in this object store. It may predate the map, or the objects may have been gc'd.`);
}
