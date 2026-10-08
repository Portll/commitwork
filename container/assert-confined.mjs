#!/usr/bin/env node
// assert-confined: reads a scan's scan.json and passes only when every lane that ran recorded an
// isolation other than `none`, and at least --min lanes ran. A lane refused as noscan, or skipped,
// never ran, so its `isolation: none` is not a breach. The container CI job runs this on its scan.
//
// usage: node container/assert-confined.mjs <scan.json> [--min <n>]   (default --min 1)
// exit: 0 every lane that ran was confined, and at least <n> ran · 2 usage ·
//       20 a lane ran with isolation none or with none recorded · 21 fewer than <n> lanes ran ·
//       22 scan.json unreadable, unparseable, or holding no repository
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const EXIT = { OK: 0, USAGE: 2, UNCONFINED: 20, TOO_FEW: 21, UNREADABLE: 22 };
const NOT_RUN = new Set(['noscan', 'skip']);

/** { ran: [{repo, id, isolation}], unconfined: [...], notRun, refused: [{id, summary}] } for a parsed scan.json. */
export function confinement(doc) {
  if (!doc || !Array.isArray(doc.repos) || !doc.repos.length) throw new Error('scan.json holds no repository');
  const ran = [], unconfined = [];
  let notRun = 0;
  const refused = [];
  for (const r of doc.repos) {
    for (const [id, c] of Object.entries(r?.cells && typeof r.cells === 'object' ? r.cells : {})) {
      if (!c || NOT_RUN.has(c.sev)) {
        notRun++;
        if (c?.sev === 'noscan') refused.push({ id, summary: String(c.summary || 'no reason recorded') });
        continue;
      }
      const row = { repo: r.slug || r.repo || '?', id, isolation: c.isolation ?? null };
      ran.push(row);
      if (!row.isolation || row.isolation === 'none') unconfined.push(row);
    }
  }
  return { ran, unconfined, notRun, refused };
}

export function main(argv) {
  const args = [...argv];
  let min = 1, file = null;
  while (args.length) {
    const a = args.shift();
    if (a === '--min') { min = Number(args.shift()); if (!Number.isInteger(min) || min < 0) return usage(); }
    else if (!file && !a.startsWith('-')) file = a;
    else return usage();
  }
  if (!file) return usage();
  let result;
  try { result = confinement(JSON.parse(readFileSync(file, 'utf8'))); }
  catch (e) { console.error(`assert-confined: ${file}: ${e.code || e.message}`); return EXIT.UNREADABLE; }
  const { ran, unconfined, notRun, refused } = result;
  const byIsolation = {};
  for (const r of ran) byIsolation[r.isolation ?? 'unrecorded'] = (byIsolation[r.isolation ?? 'unrecorded'] || 0) + 1;
  console.log(`assert-confined: ${ran.length} lane(s) ran ${JSON.stringify(byIsolation)}; ${notRun} did not run`);
  for (const r of [...ran].sort((x, y) => x.id.localeCompare(y.id))) console.log(`  ran ${r.id}: ${r.isolation ?? 'isolation not recorded'}`);
  // A short run is diagnosed from these: the CI job keeps no scan output once it exits.
  const byReason = new Map();
  for (const r of refused) byReason.set(r.summary, [...(byReason.get(r.summary) || []), r.id]);
  for (const [why, ids] of [...byReason].sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]))) {
    console.log(`  did not run (${ids.length}): ${ids.sort().join(', ')}: ${why.slice(0, 300)}`);
  }
  if (unconfined.length) {
    for (const r of unconfined) console.error(`  UNCONFINED ${r.repo} ${r.id}: isolation ${r.isolation ?? 'not recorded'}`);
    return EXIT.UNCONFINED;
  }
  if (ran.length < min) { console.error(`assert-confined: ${ran.length} lane(s) ran, fewer than ${min}; a scan where nothing ran is not a pass`); return EXIT.TOO_FEW; }
  return EXIT.OK;
}

function usage() {
  console.error('usage: node container/assert-confined.mjs <scan.json> [--min <n>]');
  return EXIT.USAGE;
}

const self = (() => { try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (self) process.exitCode = main(process.argv.slice(2));
