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

/**
 * Why a lane did not run, read from the cell the scan already wrote, so a shortfall names which
 * lane went missing and why instead of a bare count that sends the reader to rebuild the image.
 */
export function notRunCause(cell) {
  const s = String(cell?.summary || cell?.blockedReason || cell?.coverageReason || '');
  if (!s) return 'no reason recorded';
  if (/Can'?t find source path/.test(s)) return 'bwrap refused a bind whose source is absent';
  if (/host sandbox profile could not be applied/.test(s)) return 'the sandbox profile could not be applied';
  if (/not on PATH/.test(s)) return 'a tool it requires is not installed';
  if (/no live URL|--urls?/.test(s)) return 'a runtime lane with no target URL';
  if (/scanned 0 files|examined no/.test(s)) return 'the walk matched no file';
  // Trigger misses are the long tail and they are NOT a defect: a lane with no Cargo.lock to read
  // has nothing to say. One bucket, or ~40 single-item groups bury the two causes worth acting on.
  if (/^none of |^no \.[a-z]|sources found|present$/.test(s)) return 'its trigger did not match this repository';
  if (/did not finish|no completion receipt/.test(s)) return 'the tool started and did not finish';
  return s.slice(0, 72);
}

/** { ran: [{repo, id, isolation}], unconfined: [...], notRun, causes } for a parsed scan.json. */
export function confinement(doc) {
  if (!doc || !Array.isArray(doc.repos) || !doc.repos.length) throw new Error('scan.json holds no repository');
  const ran = [], unconfined = [];
  const causes = new Map();
  let notRun = 0;
  for (const r of doc.repos) {
    for (const [id, c] of Object.entries(r?.cells && typeof r.cells === 'object' ? r.cells : {})) {
      if (!c || NOT_RUN.has(c.sev)) {
        notRun++;
        const k = notRunCause(c);
        if (!causes.has(k)) causes.set(k, []);
        causes.get(k).push(id);
        continue;
      }
      const row = { repo: r.slug || r.repo || '?', id, isolation: c.isolation ?? null };
      ran.push(row);
      if (!row.isolation || row.isolation === 'none') unconfined.push(row);
    }
  }
  return { ran, unconfined, notRun, causes };
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
  const { ran, unconfined, notRun } = result;
  const byIsolation = {};
  for (const r of ran) byIsolation[r.isolation ?? 'unrecorded'] = (byIsolation[r.isolation ?? 'unrecorded'] || 0) + 1;
  console.log(`assert-confined: ${ran.length} lane(s) ran ${JSON.stringify(byIsolation)}; ${notRun} did not run`);
  for (const r of [...ran].sort((x, y) => x.id.localeCompare(y.id))) console.log(`  ran ${r.id}: ${r.isolation ?? 'isolation not recorded'}`);
  if (unconfined.length) {
    for (const r of unconfined) console.error(`  UNCONFINED ${r.repo} ${r.id}: isolation ${r.isolation ?? 'not recorded'}`);
    return EXIT.UNCONFINED;
  }
  if (ran.length < min) {
    console.error(`assert-confined: ${ran.length} lane(s) ran, fewer than ${min}; a scan where nothing ran is not a pass`);
    // Name the causes. A bare count sends the next reader to rebuild the image to learn what this
    // file already knows.
    const groups = [...(result.causes || new Map())].sort((a, b) => b[1].length - a[1].length);
    for (const [why, ids] of groups) {
      console.error(`  ${String(ids.length).padStart(3)} did not run — ${why}`);
      console.error(`      ${ids.sort().join(', ')}`);
    }
    console.error('assert-confined: a cause of "the sandbox profile could not be applied" or "bwrap'
      + ' refused a bind whose source is absent" is a CONFINEMENT regression, not thin coverage.');
    return EXIT.TOO_FEW;
  }
  return EXIT.OK;
}

function usage() {
  console.error('usage: node container/assert-confined.mjs <scan.json> [--min <n>]');
  return EXIT.USAGE;
}

const self = (() => { try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (self) process.exitCode = main(process.argv.slice(2));
