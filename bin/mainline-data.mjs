#!/usr/bin/env node
// commitwork — mainline (feature d) git-graph harvester.
//
//   node bin/mainline-data.mjs [repoDir] [--cap N] [--slug NAME] [--out DIR]
//     repoDir   target git repo (default: cwd)
//     --cap N    keep at most the last N commits by commit-date (default 400)
//     --slug     output slug (default: derived from repo dir basename)
//     --out      output dir (default: <this>/../sitemap/data)
//
// Emits sitemap/data/mainline.<slug>.json — the DAG the mainline.html renderer consumes.
// Deterministic: no randomness or time tie-breaks; ties break on sha. CW_NOW pins `generated`.

import { scannedGit } from './lib/git-env.mjs';
import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { nowISO } from '../lib/clock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

// ── args ───────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let repoDir = null, cap = 400, slug = null, outDir = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--cap') cap = Math.max(1, parseInt(argv[++i], 10) || 400);
  else if (a === '--slug') slug = argv[++i];
  else if (a === '--out') outDir = argv[++i];
  else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  else if (!a.startsWith('-') && repoDir == null) repoDir = a;
  else console.error(`mainline: ignoring unknown arg ${a}`);
}
repoDir = resolve(repoDir || process.cwd());
outDir = outDir ? resolve(outDir) : join(CW, 'sitemap', 'data');
slug = (slug || basename(repoDir)).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'repo';

function usage() {
  console.error('usage: node bin/mainline-data.mjs [repoDir] [--cap N] [--slug NAME] [--out DIR]');
}

// ── git plumbing (dependency-free) ───────────────────────────────────────────────────────────────
function git(args, { allowFail = false } = {}) {
  const r = scannedGit(repoDir, args, { maxBuffer: 256 * 1024 * 1024 }); // repoDir is any target repo
  if (r.status !== 0) {
    if (allowFail) return null;
    console.error(`mainline: git ${args.join(' ')} failed: ${(r.stderr || '').trim() || r.status}`);
    process.exit(1);
  }
  return r.stdout;
}

if (!existsSync(repoDir)) { console.error(`mainline: repo dir not found: ${repoDir}`); process.exit(1); }
if (git(['rev-parse', '--is-inside-work-tree'], { allowFail: true }) == null) {
  console.error(`mainline: not a git work tree: ${repoDir}`);
  process.exit(1);
}

// ── 1. gather commit metadata for the whole graph (--all) ────────────────────────────────────────
// NUL-delimited fields, record-separated by \x1e so subjects with newlines are safe.
const SEP = '\x1f', REC = '\x1e';
const fmt = ['%H', '%P', '%D', '%an', '%aI', '%s'].join(SEP) + REC;
const logOut = git(['log', '--all', '--no-color', '--date-order', `--pretty=format:${fmt}`]);

const all = new Map(); // sha -> record
for (const rec of logOut.split(REC)) {
  const line = rec.replace(/^\n/, '');
  if (!line.trim()) continue;
  const [sha, parentsRaw, decoRaw, author, date, subject] = line.split(SEP);
  if (!sha) continue;
  const parents = parentsRaw ? parentsRaw.trim().split(/\s+/).filter(Boolean) : [];
  const refs = decoRaw
    ? decoRaw.split(',').map((s) => s.trim().replace(/^HEAD -> /, '').replace(/^tag: /, 'tag:')).filter(Boolean)
    : [];
  all.set(sha, { sha, short: sha.slice(0, 7), parents, refs, author: author || '', date: date || '', subject: subject || '' });
}
const totalCommits = all.size;
if (totalCommits === 0) {
  console.error('mainline: no commits found (empty repo?)');
  writeOut([], 0, null, null);   // a repo with no commits has no tip: an empty manifest, not a failure
  process.exit(0);
}

// ── 2. determine the MAIN branch tip → lane-0 spine ──────────────────────────────────────────────
function resolveTip() {
  for (const ref of ['main', 'master']) {
    const s = (git(['rev-parse', '--verify', '--quiet', ref], { allowFail: true }) || '').trim();
    if (s && all.has(s)) return { sha: s, name: ref };
  }
  const head = (git(['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true }) || '').trim();
  if (head && all.has(head)) {
    const br = (git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }) || '').trim();
    return { sha: head, name: br && br !== 'HEAD' ? br : head.slice(0, 7) };
  }
  // last resort: newest commit by date
  const newest = [...all.values()].sort(cmpDateSha)[0];
  return { sha: newest.sha, name: newest.short };
}
function cmpDateSha(a, b) { // newest first, sha tie-break (deterministic)
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.sha < b.sha ? 1 : -1;
}
const tip = resolveTip();

// The mainline spine = first-parent walk from the main tip (the central carriageway).
const spine = new Set();
{
  let cur = tip.sha, guard = 0;
  while (cur && all.has(cur) && guard++ < totalCommits + 1) {
    spine.add(cur);
    const p = all.get(cur).parents;
    cur = p.length ? p[0] : null;
  }
}

// ── 3. apply the cap — SPINE-ANCHORED (the central carriageway is never truncated away) ──────────
// Keep --all --date-order insertion order (child always precedes parents) — never re-sort by date.
const allOrder = [...all.values()];               // --all --date-order sequence (topo-consistent)
const orderIndex = new Map(allOrder.map((c, i) => [c.sha, i]));

const spineList = allOrder.filter((c) => spine.has(c.sha));     // spine in render order
const offSpine = allOrder.filter((c) => !spine.has(c.sha));     // everything else, same order

const keptSet = new Set();
// 1) spine first — the carriageway. If the spine alone exceeds the cap, keep its newest `cap`.
for (const c of (spineList.length > cap ? spineList.slice(0, cap) : spineList)) keptSet.add(c.sha);
// 2) backfill with newest off-spine commits until the budget is spent.
for (const c of offSpine) { if (keptSet.size >= cap) break; keptSet.add(c.sha); }

// Final render order = --all order restricted to the kept set (topo-consistent, deterministic).
const kept = allOrder.filter((c) => keptSet.has(c.sha));
const inWindow = keptSet;
const truncated = kept.length < totalCommits;

// ── 4. lane assignment (column packing, deterministic) ───────────────────────────────────────────
// Lane 0 is pinned to the spine; outer lanes allocate lowest-free-index, so runs are byte-identical.
const laneFor = new Map();       // sha -> lane
const active = [];               // lane index -> reserved sha (null when free); index 0 = spine only

function lowestFreeOuter() {     // lowest free lane index ≥ 1
  let i = 1;
  for (; i < active.length; i++) if (active[i] == null) break;
  return i;
}

kept.forEach((c, row) => {
  const onSpine = spine.has(c.sha);
  let lane;
  if (onSpine) {
    lane = 0;                                   // carriageway is always lane 0
    if (active[0] === c.sha) active[0] = null;  // fulfilled the spine reservation
  } else if (laneFor.has(c.sha)) {
    lane = laneFor.get(c.sha);                  // a child already reserved this lane for us
  } else {
    // find a lane already reserved for THIS sha (child pointed here), else take a fresh outer lane
    let found = -1;
    for (let i = 1; i < active.length; i++) if (active[i] === c.sha) { found = i; break; }
    lane = found >= 0 ? found : lowestFreeOuter();
  }
  if (lane > 0 && active[lane] === c.sha) active[lane] = null; // consume our own reservation
  laneFor.set(c.sha, lane);

  // Reserve lanes for in-window parents: first parent continues this lane, merge parents take outer lanes.
  c.parents.forEach((p, idx) => {
    if (!inWindow.has(p)) return;               // parent outside window → faded stub, no lane
    if (laneFor.has(p)) return;                 // already placed
    if (idx === 0) {
      if (spine.has(p)) { active[0] = p; return; }  // first parent rejoins the carriageway
      if (active[lane] == null || active[lane] === c.sha) active[lane] = p; // inherit our column
      else { const i = lowestFreeOuter(); active[i] = p; }                  // column busy → new lane
    } else {
      const i = lowestFreeOuter();
      active[i] = p;                            // onramp: incoming merge branch takes an outer lane
    }
  });
  c._row = row;
  c._lane = lane;
});

let laneCount = 0;
for (const l of laneFor.values()) if (l + 1 > laneCount) laneCount = l + 1;

// ── 5. emit ──────────────────────────────────────────────────────────────────────────────────────
function commitBranch(c) {
  // Best-effort branch label: local ref, else origin/, else tip name if on spine.
  const br = c.refs.find((r) => !r.startsWith('tag:') && !r.startsWith('origin/'));
  if (br) return br;
  const rem = c.refs.find((r) => r.startsWith('origin/'));
  if (rem) return rem;
  return spine.has(c.sha) ? tip.name : undefined;
}

const commits = kept.map((c) => {
  const o = {
    sha: c.sha,
    short: c.short,
    parents: c.parents,
    parentsInWindow: c.parents.filter((p) => inWindow.has(p)),
    refs: c.refs,
    subject: c.subject,
    author: c.author,
    date: c.date,
    lane: c._lane,
    row: c._row,
    isMerge: c.parents.length > 1,
    mainline: spine.has(c.sha),
  };
  const br = commitBranch(c);
  if (br) o.branch = br;
  return o;
});

function writeOut(commitsArr, lanes, truncInfo, branchTip) {
  const manifest = {
    schema: 'mainline/v1',
    generated: nowISO(),
    generator: { tool: 'bin/mainline-data.mjs', git: (git(['--version'], { allowFail: true }) || '').trim() },
    repo: repoDir,
    slug,
    // fix: read `tip` here and the empty-repo call above hit its TDZ; every caller passes the tip
    branchTip: branchTip || null,
    lanes,
    commits: commitsArr,
  };
  if (truncInfo) manifest.truncation = truncInfo;
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `mainline.${slug}.json`);
  writeFileSync(out, JSON.stringify(manifest, null, 1) + '\n');
  return out;
}

const truncInfo = truncated
  ? { note: `showing newest ${cap} of ${totalCommits} commits`, cap, totalCommits, shown: kept.length }
  : null;

const out = writeOut(commits, laneCount, truncInfo, { sha: tip.sha, name: tip.name });

// ── honest run summary ───────────────────────────────────────────────────────────────────────────
const mergeN = commits.filter((c) => c.isMerge).length;
const refN = commits.reduce((a, c) => a + c.refs.length, 0);
console.log(
  `mainline: repo=${repoDir}\n` +
  `  slug=${slug}  tip=${tip.name}@${tip.sha.slice(0, 7)}\n` +
  `  commits=${commits.length}${truncated ? ` (of ${totalCommits} total — TRUNCATED to newest ${cap})` : ` (full history, ${totalCommits})`}\n` +
  `  lanes=${laneCount}  merges=${mergeN}  refs=${refN}  spine=${spine.size}\n` +
  `  ${Math.round(statSync(out).size / 1024)}KB -> ${out.replace(CW + '/', '')}`
);
