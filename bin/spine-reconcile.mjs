#!/usr/bin/env node
// bin/spine-reconcile.mjs — the I/O half. Decisions live in bin/spine-reconcile-core.mjs.
//
// Answers the question gate-spine does not ask: does the spine store still hold the plans the
// attribution ledger says were filed into it? See the core module's header for why that is a
// different question from "is the store readable", and why it is a REPORTER rather than a gate.
//
// Usage:
//   node bin/spine-reconcile.mjs            human-readable report
//   node bin/spine-reconcile.mjs --json     the full result as JSON
//
// Env, all read at CALL time so tests run entirely on fixtures:
//   CW_SPINE_LEDGER      the attribution ledger (default .claude/store/spine-touches.jsonl)
//   SPINE_TASKS_DB       the spine store      (then SUBSTRATE_TASKS_DB; default ~/.spine/tasks.db)
//
// Exit code is ALWAYS 0. A dangling count is a fact for a human, and a check that blocked on the
// measured ~99% would be uninstalled the same day it landed.

import { readFileSync, statSync } from 'node:fs';
import { spineStorePath } from '../lib/spine-store-path.mjs';

import { reconcile, summarise, STORE_ABSENT, LEDGER_ABSENT, STORE_UNREADABLE, DANGLING } from './spine-reconcile-core.mjs';
import { spineLedger } from './lib/store-paths.mjs';

const tasksDb = spineStorePath;

/**
 * Ledger rows. `null` means UNREADABLE (ABSENT when `absent` is set), `[]` means readable-and-empty —
 * distinctions the core module turns into different verdicts, so they must survive the read.
 *
 * A malformed LINE is skipped and counted; a malformed FILE is not silently an empty ledger.
 */
function readLedger(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { rows: null, skipped: 0, absent: true };
    return { rows: null, skipped: 0, absent: false, why: e.message };
  }
  const rows = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { skipped += 1; }
  }
  return { rows, skipped, absent: false };
}

/**
 * Plan ids in the store. Returns { present, ids } where ids is null for "present but unreadable".
 *
 * ENOENT is asked of stat(), never inferred from the driver's error text: a read-only open of a
 * missing SQLite database and a permission denial produce the SAME message, and deciding between
 * them by matching it is how a locked store gets reported as an empty one.
 */
async function readStorePlans(path) {
  try {
    statSync(path);
  } catch (e) {
    if (e && e.code === 'ENOENT') return { present: false, ids: null };
    return { present: true, ids: null, why: e.message };
  }
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    // node < 22: the store is genuinely unreadable HERE, which is not the same as absent.
    return { present: true, ids: null, why: 'node:sqlite unavailable on this runtime' };
  }
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const rows = db.prepare('SELECT id FROM plans').all();
    return { present: true, ids: rows.map((r) => String(r.id)) };
  } catch (e) {
    return { present: true, ids: null, why: e && e.message ? e.message : 'unreadable' };
  } finally {
    try { if (db) db.close(); } catch { /* closing a failed handle is not the story */ }
  }
}

async function main() {
  const json = process.argv.includes('--json');
  const ledgerPath = process.env.CW_SPINE_LEDGER || spineLedger();
  const dbFile = tasksDb();

  const led = readLedger(ledgerPath);
  const store = await readStorePlans(dbFile);
  // fix: `absent` was dropped here, so a missing ledger came back store-unreadable
  const r = reconcile({ ledgerRows: led.rows, ledgerPresent: !led.absent, storePlanIds: store.ids, storePresent: store.present });

  const out = {
    ...r,
    ledgerPath,
    storePath: dbFile,
    ledgerSkippedLines: led.skipped,
    // Named so a reader can see WHICH store answered. Three tasks.db files exist on this box and
    // only one is resolved by default; a report that does not say which one it read is not evidence.
    storeReadable: store.ids !== null,
    why: store.why || led.why || null,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }

  console.log(`spine-reconcile — ${summarise(r)}`);
  console.log(`  ledger: ${ledgerPath}`);
  console.log(`  store:  ${dbFile}`);
  if (led.skipped) console.log(`  NOTE: ${led.skipped} unparseable ledger line(s) skipped — counted, never silently dropped`);
  if (out.why) console.log(`  why:   ${out.why}`);
  console.log(`  ${r.detail}`);

  if (r.verdict === DANGLING) {
    console.log('');
    console.log(`  plans the ledger names but the store does not hold (${r.dangling.length}), worst first:`);
    for (const d of r.dangling.slice(0, 20)) {
      console.log(`    ${String(d.rows).padStart(5)} filing(s)  ${d.plan}${d.newest ? `  (newest ${d.newest})` : ''}`);
    }
    if (r.dangling.length > 20) console.log(`    … and ${r.dangling.length - 20} more`);
    if (r.present.length) {
      console.log(`  present (${r.present.length}):`);
      for (const p of r.present.slice(0, 10)) console.log(`    ${String(p.rows).padStart(5)} filing(s)  ${p.plan}`);
    }
  }
  if (r.verdict === STORE_ABSENT || r.verdict === LEDGER_ABSENT || r.verdict === STORE_UNREADABLE) {
    console.log('  Absence of evidence is displayed as itself — this is not a clean result.');
  }

  // ROUTE EVIDENCE. Printed for every walked ledger, including a clean one: these rows are the only
  // contemporaneous record of HOW filings reached the store, and their value is highest exactly when
  // nothing else looks wrong.
  if (r.bypass && r.bypass.rows) {
    console.log('');
    console.log(`  ${r.bypass.rows} filing(s) came by a route OTHER than the tool. Each witnesses ${r.bypass.witnesses}`);
    for (const b of r.bypass.reasons) {
      console.log(`    ${String(b.rows).padStart(5)} row(s)  "${b.reason}"`);
      if (b.plans.length) console.log(`            plan(s): ${b.plans.join(', ')}`);
    }
    console.log('    These rows are TRUE reports. Read as "somebody filed recently, so the tool was up",');
    console.log('    they granted a fleet-wide outage exemption on evidence that said the opposite.');
  }
}

// NEVER process.exit() HERE. Writing to a PIPE is asynchronous, so process.exit() discards whatever
// is still buffered — a caller doing `spine-reconcile --json | jq` gets a document cut off at the
// 64KB pipe buffer AND a success status, which is a truncated report wearing a clean exit code.
// Today's output is ~9.7KB so it happens to survive; the bug is latent, not absent, and it grows
// with the fleet. Set exitCode and let the process drain on its own.
// Found by a sibling tool's author hitting it in a copy of this exact pattern.
main().catch((e) => {
  // A reporter that crashes must say so loudly rather than exiting silently — but it still must not
  // fail a caller's pipeline, so the status stays 0 and the message goes to stderr.
  console.error(`spine-reconcile: ${e && e.stack ? e.stack : e}`);
  process.exitCode = 0;
});
