#!/usr/bin/env node
// bin/lane-staleness.mjs — the I/O half. Decisions live in bin/lane-staleness-core.mjs.
//
// Answers the question no proxy check asks: has this lane or store produced anything lately? See
// the core module's header for the three lanes that failed silently for eight days on this box
// while every readability, mtime and row-count check reported them healthy.
//
// Usage:
//   node bin/lane-staleness.mjs            human-readable report
//   node bin/lane-staleness.mjs --json     the full result as JSON
//
// Env, all read at CALL time inside a function so tests run entirely on fixtures. A
// `const X = process.env.Y` at module load silently defeats any override set after import, and the
// test then passes while proving nothing:
//   CW_LANES        lane declarations (default <CW_STORE_DIR>/lanes.json; ENOENT ⇒ built-ins only)
//   CW_NOW          pinned ISO clock; unparseable THROWS rather than falling back to wall-clock
//   CW_STORE_DIR    routes the built-in lanes (see bin/lib/store-paths.mjs)
//   CW_SPINE_LEDGER · CW_TOUCH_LEDGER  the individual built-in paths
//
// THE DECLARATION FILE. A lane is `{ name, kind, path, cadenceHours?, graceHours?, ... }`. Cadence
// is OPTIONAL and is never defaulted: an undeclared cadence yields UNKNOWN, not stale. The manifest
// is read, never executed — it names paths and column names and nothing else, and every identifier
// that reaches SQL is validated against a whitelist rather than interpolated on trust.
//
// EXIT CODE IS ALWAYS 0, DELIBERATELY. This reports on a fleet-wide condition — on the day it
// landed here it would have failed on three lanes at once, and on any box with no declarations it
// would fail on all of them. A check that blocks everybody's commit on somebody else's broken
// scanner is uninstalled the same week, and then the signal is gone along with the alarm. The
// findings go to stdout where a human and a rollup can both read them; the shell keeps its zero.

import { isMainModule } from '../lib/is-main.mjs';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  assessFleet, summarise, summariseFleet, humanAge,
  LANE_ABSENT, LANE_UNREADABLE, CLOCK_UNREADABLE, CADENCE_UNDECLARED, PRODUCING,
  FINDINGS, FAULTS, UNKNOWNS,
} from './lane-staleness-core.mjs';
import { spineLedger, storeDir, touchLedger } from './lib/store-paths.mjs';

const HOUR_MS = 60 * 60 * 1000;

/** Read at call time, never at module load. */
const env = (name) => process.env[name];

/**
 * The pinned clock.
 *
 * An unparseable CW_NOW throws. Falling back to wall-clock would turn a typo into a run that looks
 * successful and is not reproducible — the determinism invariant fails silently, which is the only
 * way it ever fails.
 */
export function nowMs() {
  const raw = env('CW_NOW');
  if (!raw) return Date.now();
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) throw new Error(`CW_NOW is not a parseable date: ${JSON.stringify(raw)}`);
  return t;
}

const manifestPath = () => env('CW_LANES') || join(storeDir(), 'lanes.json');

/**
 * The built-in lanes: the two stores this repo owns and writes itself.
 *
 * They ship with NO cadence. That looks like a checker that answers UNKNOWN about itself, and it is
 * — deliberately. Nobody has declared how often these are expected to receive filings, and guessing
 * would put a fabricated expectation into the one tool whose whole claim is that it reports what was
 * actually observed. The counts, the newest row and the mtime gap are still reported for both, which
 * is what would have shown the spine lane dead on 2026-08-31 rather than alive on 2026-09-06.
 */
export function builtinLanes() {
  return [
    { name: 'spine-ledger', kind: 'jsonl', path: spineLedger() },
    { name: 'touch-ledger', kind: 'jsonl', path: touchLedger() },
  ];
}

/**
 * Lane declarations.
 *
 * FAIL CLOSED: only ENOENT means "legitimately absent". A manifest that exists and will not parse
 * is reported as a fault and does NOT silently become zero declared lanes — a checker that reports
 * "all clear, 0 lanes" because its own config is corrupt is the exact failure it was built to find.
 */
export function readManifest(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { lanes: [], builtins: true, absent: true, why: null };
    return { lanes: null, builtins: true, absent: false, why: `manifest unreadable: ${e.message}` };
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    return { lanes: null, builtins: true, absent: false, why: `manifest is not parseable JSON: ${e.message}` };
  }
  const lanes = Array.isArray(doc) ? doc : Array.isArray(doc?.lanes) ? doc.lanes : null;
  if (lanes === null) {
    return { lanes: null, builtins: true, absent: false, why: 'manifest parsed but declares no `lanes` array' };
  }
  // `builtins: false` lets a test (or an operator with their own inventory) assert on exactly the
  // lanes they declared, instead of on those plus whatever this file happens to ship.
  const builtins = doc && typeof doc === 'object' && !Array.isArray(doc) && doc.builtins === false ? false : true;
  return { lanes, builtins, absent: false, why: null };
}

/** Merge declared over built-in, by name. An operator declaring `spine-ledger` gets theirs, not ours. */
export function mergeLanes(builtin, declared) {
  const out = new Map();
  for (const l of builtin) out.set(l.name, l);
  for (const l of declared) {
    if (!l || typeof l.name !== 'string' || !l.name) continue;   // an unnamed lane cannot be reported about
    out.set(l.name, { ...(out.get(l.name) || {}), ...l });
  }
  return [...out.values()];
}

/** Declared cadence in ms, or null. `cadenceMs` wins over `cadenceHours`; neither means UNDECLARED. */
export function cadenceOf(l) {
  if (Number.isFinite(l?.cadenceMs) && l.cadenceMs > 0) return l.cadenceMs;
  if (Number.isFinite(l?.cadenceHours) && l.cadenceHours > 0) return l.cadenceHours * HOUR_MS;
  return null;
}
export function graceOf(l) {
  if (Number.isFinite(l?.graceMs) && l.graceMs > 0) return l.graceMs;
  if (Number.isFinite(l?.graceHours) && l.graceHours > 0) return l.graceHours * HOUR_MS;
  return 0;
}

/**
 * Was this record an OUTPUT?
 *
 * With no `productiveField` declared, every parseable record counts as output — the honest reading
 * of a store that never recorded the difference. With one declared, a record is an output when that
 * field is positively populated: >0 for a number, non-empty for an array or string, `true` for a
 * boolean. `null`/absent is a void, which is what a batch-manifest row carrying only a `reason` is.
 */
export function productiveByField(rec, field) {
  if (!field) return true;
  const v = rec?.[field];
  if (typeof v === 'number') return Number.isFinite(v) && v > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'boolean') return v;
  return false;
}

/**
 * A JSONL lane, dated by its newest ROW and never by the file that holds them.
 *
 * That distinction is the whole reason this reader exists: .claude/store/spine-touches.jsonl had
 * mtime 2026-09-06 21:31 and a newest row of 2026-08-31T03:20. The mtime is still read and still
 * reported — as the misleading proxy it is, not as the answer.
 *
 * `samples: null` means UNREADABLE; `[]` means readable-and-empty. The core turns those into
 * different verdicts, so the distinction has to survive the read.
 */
export function readJsonlLane(l) {
  let mtimeMs = null;
  try {
    mtimeMs = statSync(l.path).mtimeMs;
  } catch (e) {
    // ENOENT is asked of stat(), never inferred from an error message: a permission denial and a
    // missing file produce the same text, and deciding between them by matching it is how a locked
    // store gets reported as one that was never installed.
    if (e && e.code === 'ENOENT') return { present: false, samples: null, mtimeMs: null, skipped: 0, why: null };
    return { present: true, samples: null, mtimeMs: null, skipped: 0, why: e.message };
  }
  let raw;
  try {
    raw = readFileSync(l.path, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { present: false, samples: null, mtimeMs: null, skipped: 0, why: null };
    return { present: true, samples: null, mtimeMs, skipped: 0, why: e.message };
  }
  const atField = typeof l.atField === 'string' && l.atField ? l.atField : 'at';
  const reasonField = typeof l.reasonField === 'string' && l.reasonField ? l.reasonField : 'reason';
  const samples = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { skipped += 1; continue; }
    samples.push({
      at: rec?.[atField] ?? null,
      productive: productiveByField(rec, l.productiveField),
      reason: typeof rec?.[reasonField] === 'string' ? rec[reasonField] : null,
    });
  }
  return { present: true, samples, mtimeMs, skipped, why: null };
}

// SQL identifiers come from a declaration file, so they are whitelisted rather than trusted. This
// is not a parameterisable position — a table name cannot be bound — so the only safe move is to
// refuse anything that is not a plain identifier.
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const safeIdent = (s) => typeof s === 'string' && IDENT.test(s);

/**
 * A SQLite lane: the newest `updated_at` (or a declared column) across a declared table.
 *
 * Read-only, and ENOENT comes from stat() for the same reason as above — node:sqlite's message for
 * a missing file and for a permission denial are not reliably distinguishable, and getting that
 * wrong reports a locked store as one that was never installed.
 */
export async function readSqliteLane(l) {
  const table = l.table;
  const column = typeof l.column === 'string' && l.column ? l.column : 'updated_at';
  const pcol = l.productiveColumn || null;
  if (!safeIdent(table) || !safeIdent(column) || (pcol && !safeIdent(pcol))) {
    return { present: true, samples: null, mtimeMs: null, skipped: 0, why: 'declaration names an identifier that is not a plain SQL identifier — refused rather than interpolated' };
  }
  let mtimeMs = null;
  try {
    mtimeMs = statSync(l.path).mtimeMs;
  } catch (e) {
    if (e && e.code === 'ENOENT') return { present: false, samples: null, mtimeMs: null, skipped: 0, why: null };
    return { present: true, samples: null, mtimeMs: null, skipped: 0, why: e.message };
  }
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    // The store is genuinely unreadable HERE, which is not the same as absent.
    return { present: true, samples: null, mtimeMs, skipped: 0, why: 'node:sqlite unavailable on this runtime' };
  }
  const limit = Number.isFinite(l.limit) && l.limit > 0 ? Math.floor(l.limit) : 5000;
  let db;
  try {
    db = new DatabaseSync(l.path, { readOnly: true });
    // ORDER BY the timestamp column DESC: correct for epoch integers and for ISO-8601 UTC text
    // alike, since lexicographic order on a fixed-width ISO stamp is chronological order. LIMIT
    // caps the read; the newest rows are the only ones that can decide freshness.
    const sql = `SELECT ${column} AS at${pcol ? `, ${pcol} AS p` : ''} FROM ${table} ORDER BY ${column} DESC LIMIT ${limit}`;
    const rows = db.prepare(sql).all();
    return {
      present: true,
      samples: rows.map((r) => ({
        at: r.at ?? null,
        productive: pcol ? productiveByField({ p: r.p }, 'p') : true,
        reason: null,
      })),
      mtimeMs,
      skipped: 0,
      why: null,
    };
  } catch (e) {
    return { present: true, samples: null, mtimeMs, skipped: 0, why: e && e.message ? e.message : 'unreadable' };
  } finally {
    try { if (db) db.close(); } catch { /* closing a failed handle is not the story */ }
  }
}

/** Read one lane's evidence. An unrecognised kind is a FAULT, never an empty lane. */
export async function readLane(l) {
  if (l.kind === 'jsonl') return readJsonlLane(l);
  if (l.kind === 'sqlite') return readSqliteLane(l);
  return { present: true, samples: null, mtimeMs: null, skipped: 0, why: `unsupported lane kind ${JSON.stringify(l.kind)} — reported as unreadable, never as empty` };
}

/** Read every declared lane and decide. Exported so a test can drive the whole pipeline on fixtures. */
export async function run({ now = nowMs(), manifest = manifestPath() } = {}) {
  const man = readManifest(manifest);
  const declared = Array.isArray(man.lanes) ? man.lanes : [];
  const lanes = man.builtins ? mergeLanes(builtinLanes(), declared) : mergeLanes([], declared);

  const read = [];
  for (const l of lanes) {
    const ev = await readLane(l);
    read.push({
      name: l.name, kind: l.kind || 'unknown', path: l.path,
      present: ev.present, samples: ev.samples, mtimeMs: ev.mtimeMs, skipped: ev.skipped, why: ev.why,
      cadenceMs: cadenceOf(l), graceMs: graceOf(l),
    });
  }

  const { lanes: results, rollup } = assessFleet({ lanes: read, now });
  return {
    generated: new Date(now).toISOString(),
    manifestPath: manifest,
    manifestAbsent: man.absent,
    manifestWhy: man.why,
    // Named so a reader can re-derive every number: which declarations were used, and which paths
    // each one resolved to. A number nobody can re-derive is a number nobody re-checks.
    declaredLanes: declared.length,
    builtinLanes: man.builtins ? builtinLanes().length : 0,
    rollup,
    lanes: results,
  };
}

function report(out) {
  console.log(`lane-staleness — ${summariseFleet(out.rollup)}`);
  console.log(`  manifest: ${out.manifestPath}${out.manifestAbsent ? ' (absent — built-in lanes only)' : ''}`);
  console.log(`  now:      ${out.generated}${process.env.CW_NOW ? '  (CW_NOW)' : ''}`);
  if (out.manifestWhy) {
    console.log(`  FAULT:    ${out.manifestWhy}`);
    console.log('            Declarations are UNKNOWN, not empty — this report covers the built-in lanes only.');
  }
  if (out.rollup.total === 0) {
    console.log('  Nothing was checked. That is not a clean result — declare lanes in the manifest above.');
    return;
  }
  for (const r of out.lanes) {
    console.log('');
    const tag = FINDINGS.has(r.verdict) ? 'FINDING' : FAULTS.has(r.verdict) ? 'FAULT  ' : UNKNOWNS.has(r.verdict) ? 'UNKNOWN' : 'ok     ';
    console.log(`  ${tag}  ${summarise(r)}`);
    console.log(`           path: ${r.path}  [${r.kind}]`);
    if (r.rows !== null) {
      console.log(`           records: ${r.rows} (${r.productiveRows} output, ${r.voidRows} void)`
        + `${r.skipped ? `, ${r.skipped} unparseable line(s) skipped — counted, never silently dropped` : ''}`);
    }
    if (r.lastProduction || r.lastActivity) {
      console.log(`           last output: ${r.lastProduction || 'never'}   last activity: ${r.lastActivity || 'none'}`);
    }
    // The proxy, printed as a proxy. Six days of daylight between these two is what a mtime check
    // read as "alive today" on this very box.
    if (r.mtime) {
      const ahead = r.mtimeAheadOfNewestMs;
      // Sub-minute gaps are printed in ms rather than rounded to "0m": a two-millisecond gap and a
      // six-day one must not render the same, since telling them apart is the entire point.
      const gap = !Number.isFinite(ahead) || ahead <= 0 ? null : ahead < 60000 ? `${Math.round(ahead)}ms` : humanAge(ahead);
      console.log(`           file mtime: ${r.mtime} — NOT the production clock`
        + (gap ? `; it runs ${gap} AHEAD of the newest record` : ''));
    }
    if (r.why) console.log(`           why: ${r.why}`);
    console.log(`           ${r.detail}`);
    for (const x of r.reasons.slice(0, 5)) {
      console.log(`             ${String(x.count).padStart(5)}×  ${JSON.stringify(x.reason)}`);
    }
    // Two different greys, and they read differently on purpose. One is missing EVIDENCE; the other
    // has the evidence and is missing the EXPECTATION to judge it against, which is an operator's
    // decision to make and not this tool's to guess.
    if (r.verdict === LANE_ABSENT || r.verdict === LANE_UNREADABLE || r.verdict === CLOCK_UNREADABLE) {
      console.log('           Absence of evidence is displayed as itself — this is not a clean result, and it is not a finding.');
    } else if (r.verdict === CADENCE_UNDECLARED) {
      console.log(`           The evidence is here; the EXPECTATION is not. Declare \`cadenceHours\` for "${r.name}" in ${out.manifestPath} to turn this grey into a verdict.`);
    }
  }
  if (out.rollup.producing === out.rollup.total && out.rollup.total > 0) {
    console.log('');
    console.log(`  Every declared lane produced inside its declared cadence. ${out.rollup.byVerdict[PRODUCING]} lane(s) checked.`);
  }
}

async function main() {
  const json = process.argv.includes('--json');
  const out = await run();
  if (json) {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }
  report(out);
}

const invoked = isMainModule(import.meta.url);
if (invoked) {
  main().then(() => process.exit(0)).catch((e) => {
    // A reporter that crashes must say so loudly rather than exiting 0 with nothing said — but it
    // still must not fail a caller's pipeline, so the status stays 0 and the message goes to stderr.
    console.error(`lane-staleness: ${e && e.stack ? e.stack : e}`);
    process.exit(0);
  });
}
