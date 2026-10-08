#!/usr/bin/env node
// bin/ledger-backfill-tree.mjs — stamp `r` (tree identity) on ledger rows that lack it, but ONLY
// where the tree is derivable from evidence already in the store.
//
// THE RULE THIS TOOL EXISTS TO NOT BREAK. bin/lib/store-paths.mjs states that rows without `r` are
// unrecoverable, and it is right about the general case: ledger paths are stored RELATIVE to their
// own repo, so `bin/x.mjs` written in one checkout is indistinguishable from `bin/x.mjs` written in
// another. Stamping those with the current tree would convert an honest `unknown` into a false
// attribution — the module's own words, and worse than the gap it closes.
//
// The one exception is a JOIN, not an inference: a session does not move between checkouts, so if
// session S appears in any STAMPED row with tree T, then S's other rows are also from T. That is
// evidence carried by the store itself. Measured 2026-08-30 before this tool was written: across
// 46,375 touch rows and 1,434 spine rows, 14 sessions have a known tree, ZERO of them appear in
// more than one tree, and the join resolves 380 of ~41,600 unstamped rows — 0.9%.
//
// So this tool is honest about being nearly useless, and that is the point. It recovers what can be
// recovered and leaves 39,800 rows explicitly unknown rather than making the ledger LOOK attributed.
// A store that reports 100% coverage because somebody backfilled a guess is worse than one that
// reports 13% and means it.
//
// A BACKFILLED ROW IS MARKED. `r` alone would make a derived value indistinguishable from a measured
// one, and every reader downstream treats `r` as fact. Backfilled rows carry `rsrc:"session-join"`,
// so a reader that cares about provenance can tell the two apart and a future audit can undo this.
//
// AMBIGUITY REFUSES. A session seen in two trees yields no stamp at all — never a "best" pick.
//
// Usage:
//   node bin/ledger-backfill-tree.mjs                 # dry run: report only, write nothing
//   node bin/ledger-backfill-tree.mjs --apply         # write, atomically (tmp+rename)
//   node bin/ledger-backfill-tree.mjs --apply --include-live   # also the currently-appended files
//
// LIVE FILES ARE SKIPPED BY DEFAULT. The unrotated ledgers are append targets for every concurrent
// session; a read-modify-rewrite of one races those appends and silently drops whatever landed in
// between. The rotated generations are closed and safe. --include-live takes the rotate lock first
// and is still the riskier path — this store is shared by nine sessions.

import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { touchLedger, spineLedger } from './lib/store-paths.mjs';
import { acquireLock } from '../monitor/lockfile.mjs';

const APPLY = process.argv.includes('--apply');
const INCLUDE_LIVE = process.argv.includes('--include-live');

const parse = (ln) => { try { return JSON.parse(ln); } catch { return null; } };

/** Every generation of a ledger: the live file plus `<file>.<digits>` beside it. */
function familyOf(live) {
  const dir = dirname(live); const base = `${basename(live)}.`;
  let names = []; try { names = readdirSync(dir); } catch { return [live]; }
  const gens = names.filter((n) => n.startsWith(base) && /^\d+$/.test(n.slice(base.length)))
    .map((n) => join(dir, n)).sort();
  return [live, ...gens].filter(existsSync);
}

const LIVE = [touchLedger(), spineLedger()];
const FILES = [...new Set(LIVE.flatMap(familyOf))];

// ---- Pass 1: build session -> trees, from STAMPED rows only. This is the evidence.
const trees = new Map();
for (const f of FILES) {
  let raw = ''; try { raw = readFileSync(f, 'utf8'); } catch { continue; }
  for (const ln of raw.split('\n')) {
    if (!ln) continue;
    const o = parse(ln); if (!o) continue;
    if (typeof o.r === 'string' && o.r && o.s && !o.rsrc) {      // never learn from a backfill
      const k = String(o.s);
      if (!trees.has(k)) trees.set(k, new Set());
      trees.get(k).add(o.r);
    }
  }
}
const ambiguousSessions = [...trees.entries()].filter(([, v]) => v.size > 1).map(([k]) => k);

/** Sole tree for a session id, matched by PREFIX in either direction (touch stores 8, spine 36). */
function treeFor(s) {
  if (!s) return null;
  const hit = new Set();
  for (const [k, v] of trees) if (k.startsWith(s) || s.startsWith(k)) for (const t of v) hit.add(t);
  return hit.size === 1 ? [...hit][0] : null;      // 0 = no evidence, >1 = ambiguous; both refuse
}

// ---- Pass 2: rewrite
const isLive = (f) => LIVE.includes(f);
let totRows = 0, totStamped = 0, totFilled = 0, totAmb = 0, totNone = 0, totTorn = 0;
const report = [];

// Does this store use rotation boundaries at all? A generation's TAIL is hashed by the NEXT
// generation's `rotation:<hash>` marker, so the tail needs protecting — but only where such a
// marker exists. Deciding that from evidence rather than assuming it keeps the guard from
// refusing on a store that has no chain to break, which is the direction that costs recall
// silently and which a two-row fixture caught immediately.
const FAMILY_HAS_ROTATION_BOUNDARY = FILES.some((f) => {
  let raw = ''; try { raw = readFileSync(f, 'utf8'); } catch { return false; }
  for (const ln of raw.split('\n')) {
    if (!ln) continue;
    const o = parse(ln);
    if (o && typeof o.prev === 'string' && o.prev.startsWith('rotation:')) return true;
  }
  return false;
});

for (const f of FILES) {
  if (isLive(f) && !INCLUDE_LIVE) { report.push([basename(f), 'SKIPPED (live append target)', '']); continue; }
  let raw = ''; try { raw = readFileSync(f, 'utf8'); } catch { continue; }
  const lines = raw.split('\n');
  const out = []; let filled = 0, rows = 0, stamped = 0, amb = 0, none = 0, torn = 0, chained = 0;

  // A REWRITE IS A TAMPER TO THE ONE READER THAT CHECKS.
  //
  // The ledger is a hash chain: each row's `prev` is the hash of the line before it, and
  // bin/lib/touch-chain.mjs verifies it. This tool changes a line's bytes, which changes its hash,
  // which invalidates the NEXT line's `prev` — and it had no idea, `prev` appearing nowhere in it.
  // Measured 2026-09-02 on a byte-identical copy of the live store: `--apply` took the chain from
  // 1 break to 314 and dropped verified rows 4,942 -> 4,629. The tool written to make attribution
  // more honest was destroying the evidence that attribution is not forged.
  //
  // So a row is stamped only where doing so provably breaks nothing:
  //   · the FOLLOWING row must not carry a `prev` — that is the hash this rewrite would invalidate;
  //   · and not within BOUNDARY_SLACK (3) of the end, because the next generation's rotation
  //     boundary matches against the tail of this one.
  // Rows refused for this reason are counted and reported, never silently skipped — an unstamped
  // row and a row nobody tried to stamp are different facts.
  //
  // This costs recall and is the right trade: 17,622 of ~22,500 rows are unchained and remain
  // eligible, which is where nearly all the recoverable attribution lives anyway.
  const BOUNDARY_SLACK = 3;
  const parsed = lines.map(parse);
  const lastRowIdx = parsed.reduce((acc, o, i) => (o ? i : acc), -1);
  const tailFloor = FAMILY_HAS_ROTATION_BOUNDARY ? (() => {
    let seen = 0;
    for (let i = parsed.length - 1; i >= 0; i--) { if (parsed[i]) { seen++; if (seen > BOUNDARY_SLACK) return i; } }
    return -1;
  })() : Infinity;                                               // no boundary markers ⇒ no tail to protect
  const nextRowHasPrev = (i) => {
    for (let j = i + 1; j < parsed.length; j++) if (parsed[j]) return parsed[j].prev !== undefined;
    return false;                                                // nothing follows in this file
  };

  for (const [idx, ln] of lines.entries()) {
    if (!ln) { out.push(ln); continue; }
    const o = parsed[idx];
    if (!o) { out.push(ln); torn++; continue; }                  // a torn line is preserved verbatim
    rows++;
    if (nextRowHasPrev(idx) || (idx > tailFloor && idx <= lastRowIdx)) { out.push(ln); if (!(typeof o.r === 'string' && o.r)) chained++; continue; }
    if (typeof o.r === 'string' && o.r) { out.push(ln); stamped++; continue; }
    const s = String(o.s || '');
    const t = treeFor(s);
    if (!t) { out.push(ln); if (s && [...trees.keys()].some((k) => k.startsWith(s) || s.startsWith(k))) amb++; else none++; continue; }
    out.push(JSON.stringify({ ...o, r: t, rsrc: 'session-join' }));
    filled++;
  }

  totRows += rows; totStamped += stamped; totFilled += filled; totAmb += amb; totNone += none; totTorn += torn;
  report.push([basename(f), `rows=${rows} stamped=${stamped} +filled=${filled} unrecoverable=${none}${amb ? ` ambiguous=${amb}` : ''}${chained ? ` chain-protected=${chained}` : ''}${torn ? ` torn=${torn}` : ''}`, filled]);

  if (APPLY && filled > 0) {
    let lock = null;
    if (isLive(f)) {
      try { lock = acquireLock(`${f}.rotate.lock`, { label: 'ledger backfill', attempts: 40, spinMs: 15, staleMs: 30_000 }); } catch { lock = null; }
      if (!lock?.ok) { report.push([basename(f), 'REFUSED — could not take the rotate lock; another session is writing', '']); continue; }
    }
    const tmp = `${f}.tmp-${process.pid}`;
    try {
      writeFileSync(tmp, out.join('\n'));
      renameSync(tmp, f);                                        // atomic
    } catch (e) {
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* nothing further to do */ }
      report.push([basename(f), `WRITE FAILED — ${e.message}`, '']);
    } finally { try { lock?.release(); } catch { /* stale-broken; next caller reclaims */ } }
  }
}

process.stdout.write(`ledger-backfill-tree — ${APPLY ? 'APPLY' : 'DRY RUN (write nothing)'}\n`);
process.stdout.write(`  sessions with a known tree: ${trees.size}; ambiguous: ${ambiguousSessions.length}\n`);
for (const [f, line] of report) process.stdout.write(`  ${String(f).padEnd(22)} ${line}\n`);
process.stdout.write(`  TOTAL rows=${totRows} already-stamped=${totStamped} filled=${totFilled} unrecoverable=${totNone}${totAmb ? ` ambiguous=${totAmb}` : ''}${totTorn ? ` torn=${totTorn}` : ''}\n`);
process.stdout.write(`  ${totNone} rows remain UNKNOWN and must stay that way — see the header.\n`);
