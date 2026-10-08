#!/usr/bin/env node
// bin/spine-replay.mjs — the I/O half. Decisions live in bin/spine-replay-core.mjs.
//
// Reconstructs plan/task SKELETONS from the spine attribution ledger, for the eight days of
// planning history that the store no longer holds. Read the core module's header first: it says
// exactly what a skeleton is and is not, and why no goal is ever invented.
//
// THE FORENSICS THIS TOOL EXISTS FOR, measured 2026-09-06/07 and recorded here because nobody will
// re-derive them: the ledger holds 1,452 rows naming 76 plans across 61 sessions; ~/.substrate/
// tasks.db holds ONE plan and 12 tasks. The db has page_count 28, freelist_count 0 and
// integrity_check ok, and its only plan was created 2026-08-29T10:23 while 62 of 64 create_plan
// ledger rows predate that. Deleting ~1,400 rows leaves freelist pages; there are none. So the
// store was REPLACED around Aug 29, not emptied, and the history left with a predecessor file that
// is not on this box. The ledger is the only surviving record, and it never held any content.
//
// Usage:
//   node bin/spine-replay.mjs                        dry run, human report          (default)
//   node bin/spine-replay.mjs --json                 the full proposal set as JSON
//   node bin/spine-replay.mjs --sql                  the INSERTs it WOULD run, to stdout
//   node bin/spine-replay.mjs --plan <id>            restrict to one plan
//   node bin/spine-replay.mjs --limit <n>            rows shown in the human report (default 20)
//   node bin/spine-replay.mjs --apply --target <db>  file them into an EXPLICIT store
//
// WRITING IS NOT THE DEFAULT AND CANNOT BECOME IT. `--apply` refuses without `--target`, and
// refuses outright if the target resolves to the live store — with no override flag, because an
// override flag is a thing that gets typed. Filing reconstructed history into the live spine is a
// human act with a human's judgement attached (declaration split from authority): this tool will
// print the exact statements (`--sql`) or fill a copy, and that is where its authority stops.
//
// Env, all read at CALL time so tests run entirely on fixtures:
//   CW_SPINE_LEDGER      the attribution ledger (default .claude/store/spine-touches.jsonl)
//   SPINE_TASKS_DB       the spine store        (then SUBSTRATE_TASKS_DB; default ~/.spine/tasks.db)
//   CW_NOW               report stamp only — no proposed record's clock comes from a clock
//
// Exit code is 0 for every verdict, including grey. It is 2 only for a refused or failed --apply,
// because there the caller asked for an effect and did not get one.

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spineStorePath } from '../lib/spine-store-path.mjs';

import {
  replay, summarise, toSql,
  LEDGER_UNREADABLE, NOTHING_TO_REPLAY, PROPOSED,
} from './spine-replay-core.mjs';
import { spineLedger } from './lib/store-paths.mjs';

const ledgerPath = () => process.env.CW_SPINE_LEDGER || spineLedger();
// The store moved from ~/.substrate to ~/.spine; both homes are live for the write guard.
const storeHomes = () => [join(homedir(), '.spine', 'tasks.db'), join(homedir(), '.substrate', 'tasks.db')];
const tasksDb = spineStorePath;
const nowIso = () => process.env.CW_NOW || new Date().toISOString();

/**
 * Ledger rows. `null` means UNREADABLE, `[]` means readable-and-empty — different verdicts, so the
 * distinction has to survive the read. Only ENOENT is legitimate absence.
 *
 * A malformed LINE is skipped and COUNTED, and the count travels into the report as `partial`: the
 * line that failed to parse may be the only one that ever named some plan, so a reconstruction with
 * skipped lines is incomplete by an amount nobody can measure.
 *
 * (Duplicated from bin/spine-reconcile.mjs, which does not export it. Hoisting it into bin/lib is
 * the right move and belongs in a pass that is allowed to touch that file.)
 */
function readLedger(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { rows: null, skipped: 0, absent: true, why: 'no ledger file' };
    return { rows: null, skipped: 0, absent: false, why: e.message };
  }
  const rows = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r === 'object' && !Array.isArray(r)) rows.push(r);
      else skipped += 1;              // valid JSON, wrong shape — still not a row, still counted
    } catch { skipped += 1; }
  }
  return { rows, skipped, absent: false };
}

/** node:sqlite or a stated reason. Node < 22 cannot read the store; that is unreadable, not empty. */
async function sqlite() {
  try {
    const m = await import('node:sqlite');
    return { DatabaseSync: m.DatabaseSync, why: null };
  } catch {
    return { DatabaseSync: null, why: 'node:sqlite unavailable on this runtime' };
  }
}

/**
 * What the target already holds. `{present, plans, tasks}` where plans/tasks are null for
 * "present but unreadable" — which is never reported as an empty store, because an unreadable
 * target would otherwise make every skeleton look missing and invite a duplicate filing.
 *
 * ENOENT is asked of stat(), never inferred from the driver's error text: a read-only open of a
 * missing SQLite file and a permission denial produce the same message.
 */
async function readTarget(path) {
  try {
    statSync(path);
  } catch (e) {
    if (e && e.code === 'ENOENT') return { present: false, plans: null, tasks: null };
    return { present: true, plans: null, tasks: null, why: e.message };
  }
  const { DatabaseSync, why } = await sqlite();
  if (!DatabaseSync) return { present: true, plans: null, tasks: null, why };
  let db;
  try {
    // readOnly, always. A plain open checkpoints the WAL and mutates a store this tool is only
    // supposed to be looking at.
    db = new DatabaseSync(path, { readOnly: true });
    const plans = db.prepare('SELECT id FROM plans').all().map((r) => String(r.id));
    const tasks = db.prepare('SELECT id, plan_id FROM tasks').all()
      .map((r) => ({ id: String(r.id), plan_id: String(r.plan_id) }));
    return { present: true, plans, tasks };
  } catch (e) {
    return { present: true, plans: null, tasks: null, why: e && e.message ? e.message : 'unreadable' };
  } finally {
    try { if (db) db.close(); } catch { /* closing a failed handle is not the story */ }
  }
}

/** Resolve for comparison; realpath when it exists so a symlinked live store cannot slip past. */
function canonical(p) {
  try { return realpathSync(p); } catch { return resolve(p); }
}

/**
 * Is this target the live store? Both home locations and whatever SPINE_TASKS_DB or
 * SUBSTRATE_TASKS_DB names count: the env vars are how the live store is repointed, so honouring
 * them for reads and ignoring them for this guard would be exactly backwards.
 */
function isLiveStore(target) {
  const named = [process.env.SPINE_TASKS_DB, process.env.SUBSTRATE_TASKS_DB].filter(Boolean);
  return new Set([...storeHomes(), ...named].map(canonical)).has(canonical(target));
}

/**
 * File the skeletons into an explicit target. Insert-if-absent only, in one transaction.
 *
 * IDEMPOTENCY, stated: identity is the plan id and the (plan_id, id) pair, which are the tables'
 * own primary keys and come from the ledger rather than from this run. `INSERT OR IGNORE` therefore
 * makes the second run a no-op, and — the half that matters more — a REAL record that survived is
 * never overwritten by a skeleton, because nothing here is an UPDATE.
 */
async function applyTo(target, result) {
  const { DatabaseSync, why } = await sqlite();
  if (!DatabaseSync) return { ok: false, why };
  let db;
  try {
    db = new DatabaseSync(target);
    // The target must already BE a spine store. This tool does not own the schema and will not
    // create one: a store it invented would drift from substrate's the first time that changed.
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      .map((r) => String(r.name)));
    if (!tables.has('plans') || !tables.has('tasks')) {
      return { ok: false, why: 'target has no plans/tasks tables — this tool fills a spine store, it does not create one' };
    }
    const insPlan = db.prepare('INSERT OR IGNORE INTO plans (id,name,cwd,project,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');
    const insTask = db.prepare('INSERT OR IGNORE INTO tasks (id,plan_id,parent_id,goal,status,state,depends_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
    let plans = 0;
    let tasks = 0;
    db.exec('BEGIN');
    try {
      for (const p of result.plans) {
        if (p.preexisting === true) continue;
        const r = p.record;
        plans += Number(insPlan.run(r.id, r.name, r.cwd, r.project, r.status, r.created_at, r.updated_at).changes || 0);
      }
      for (const t of result.tasks) {
        if (t.preexisting === true) continue;
        const r = t.record;
        tasks += Number(insTask.run(r.id, r.plan_id, r.parent_id, r.goal, r.status, r.state, r.depends_on, r.created_at, r.updated_at).changes || 0);
      }
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* the original error is the story */ }
      throw e;
    }
    return { ok: true, plansInserted: plans, tasksInserted: tasks };
  } catch (e) {
    return { ok: false, why: e && e.message ? e.message : String(e) };
  } finally {
    try { if (db) db.close(); } catch { /* ignore */ }
  }
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const wantSql = argv.includes('--sql');
  const apply = argv.includes('--apply');
  const target = argValue(argv, '--target');
  const planFilter = argValue(argv, '--plan');
  const limit = Number(argValue(argv, '--limit')) > 0 ? Number(argValue(argv, '--limit')) : 20;

  const lPath = ledgerPath();
  const led = readLedger(lPath);

  // The store we READ to decide what is missing: the explicit target when one is given, otherwise
  // the live store — reading it is safe, writing it is what is refused.
  const readPath = target ? resolve(target) : tasksDb();
  const store = await readTarget(readPath);

  const result = replay({
    ledgerRows: led.rows,
    ledgerSkipped: led.skipped,
    existingPlanIds: store.plans,
    existingTasks: store.tasks,
    planFilter,
    now: nowIso(),
  });

  const out = {
    ...result,
    ledgerPath: lPath,
    ledgerAbsent: led.absent === true,
    // Named so a reader can see WHICH store answered. Three tasks.db files exist on this box.
    comparedAgainst: readPath,
    targetReadable: store.plans !== null,
    targetPresent: store.present,
    why: led.why || store.why || null,
    applied: null,
  };

  // ── APPLY, or the refusal ──────────────────────────────────────────────────────────────────────
  if (apply) {
    const refuse = (why) => {
      if (json) process.stdout.write(`${JSON.stringify({ ...out, applied: { ok: false, why } }, null, 2)}\n`);
      else console.error(`spine-replay: REFUSED — ${why}`);
      process.exitCode = 2;
    };
    if (!target) {
      refuse('--apply needs an explicit --target <db>. There is no default write target, on purpose: '
        + 'a tool that fills a store it picked itself will one day fill the wrong one.');
      return;
    }
    if (isLiveStore(readPath)) {
      refuse(`--target resolves to the LIVE spine store (${readPath}). This tool never writes it, and `
        + 'there is no override flag, because an override flag is a thing that gets typed. Copy the '
        + 'store, apply to the copy, review it, and let a human move it — or run --sql and read the '
        + 'statements first.');
      return;
    }
    if (result.verdict === LEDGER_UNREADABLE) {
      refuse('the ledger is unreadable, so there is nothing established to file. An unreadable ledger '
        + 'is not an empty one and must not be filed as a partial history.');
      return;
    }
    if (!store.present) {
      refuse(`no store at ${readPath} — this tool fills an existing spine store, it does not create one.`);
      return;
    }
    if (!out.targetReadable) {
      refuse(`the target at ${readPath} is present and unreadable (${store.why || 'unknown'}). Filing into `
        + 'a store whose contents you could not read would duplicate whatever it already holds.');
      return;
    }
    const res = await applyTo(readPath, result);
    out.applied = res;
    if (!res.ok) {
      if (json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      else console.error(`spine-replay: apply FAILED — ${res.why}`);
      process.exitCode = 2;
      return;
    }
  }

  if (wantSql && !json) {
    for (const line of toSql(result)) console.log(line);
    return;
  }
  if (json) {
    if (wantSql) out.sql = toSql(result);
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }

  const c = result.counts;
  console.log(`spine-replay — ${summarise(result)}`);
  console.log(`  ledger:   ${lPath}`);
  console.log(`  compared: ${readPath}${out.targetReadable ? '' : ' (UNREADABLE or absent — "missing" here is UNKNOWN, not established)'}`);
  if (led.skipped) {
    console.log(`  NOTE: ${led.skipped} unparseable ledger line(s) skipped — counted, never silently dropped.`);
    console.log('        The reconstruction is PARTIAL by an amount nobody can measure: a skipped line');
    console.log('        may be the only row that ever named some plan.');
  }
  if (out.why) console.log(`  why:      ${out.why}`);
  console.log(`  ${result.detail}`);

  if (result.verdict === LEDGER_UNREADABLE || result.verdict === NOTHING_TO_REPLAY) {
    console.log('  Absence of evidence is displayed as itself — this is not a clean result.');
    return;
  }

  console.log('');
  console.log('  WHAT A SKELETON RESTORES: plan id, task ids, which calls fired against each and how');
  console.log('  many, first/last timestamp, owning session ids.');
  console.log('  WHAT IT DOES NOT: goal, result, notes, status, cwd, project — the ledger records ids');
  console.log('  only, by design, so none of these was ever there to lose. No text is invented.');
  console.log('');
  console.log(`  ledger rows read:            ${c.ledgerRows}`);
  console.log(`  rows naming no plan:         ${c.rowsWithoutPlan}`);
  console.log(`  filings on UNNAMEABLE tasks: ${c.unnamedTaskRows}  (a task exists; its id was never recorded — not filed, `);
  console.log('                                    because minting an id would invent a task and break idempotency)');
  console.log(`  rows filed by a bypass path: ${c.viaRows}  (\`via\`: direct spine/db.mjs, not the MCP tool — flagged, not equated)`);
  console.log(`  plans named / proposed:      ${c.plansNamed} / ${c.plansProposed}  (already present: ${c.plansPreexisting})`);
  console.log(`  tasks named / proposed:      ${c.tasksNamed} / ${c.tasksProposed}  (already present: ${c.tasksPreexisting})`);

  if (result.verdict === PROPOSED) {
    const rows = result.plans.filter((p) => p.preexisting !== true);
    const unwitnessed = rows.filter((p) => !p.createdAtWitnessed).length;
    console.log('');
    console.log(`  plan skeletons that would be filed (${rows.length}), first ${Math.min(limit, rows.length)}:`);
    for (const p of rows.slice(0, limit)) {
      const t = result.tasks.filter((x) => x.plan_id === p.id && x.preexisting !== true).length;
      console.log(`    ${String(p.evidence.rows).padStart(5)} row(s)  ${p.id}`
        + `  tasks:${String(t).padStart(3)}  unnamed:${String(p.unnamedTaskRows).padStart(3)}`
        + `  ${p.evidence.first ? p.evidence.first.slice(0, 10) : '?'}..${p.evidence.last ? p.evidence.last.slice(0, 10) : '?'}`
        + `${p.createdAtWitnessed ? '' : '  [creation not witnessed]'}`
        + `${p.evidence.viaRows ? `  [via×${p.evidence.viaRows}]` : ''}`);
    }
    if (rows.length > limit) console.log(`    … and ${rows.length - limit} more`);
    if (unwitnessed) {
      console.log(`  ${unwitnessed} plan(s) have no create_plan row: created_at is a LOWER BOUND on creation, not creation.`);
    }
    const orphans = result.tasks.filter((t) => t.preexisting !== true && t.parentPresent === false);
    if (orphans.length) {
      console.log(`  ${orphans.length} task(s) name a parent address the ledger never names. The ancestor is NOT`);
      console.log('    synthesised — an invented task is worse than a visible gap.');
    }
    if (!apply) {
      console.log('');
      console.log('  Nothing was written. --sql prints the statements; --apply --target <db> fills an');
      console.log('  explicit copy. The live store is refused outright.');
    }
  }
  if (out.applied && out.applied.ok) {
    console.log('');
    console.log(`  APPLIED to ${readPath}: ${out.applied.plansInserted} plan(s), ${out.applied.tasksInserted} task(s) inserted.`);
    console.log('  Insert-if-absent only — re-running inserts nothing and overwrites nothing.');
  }
}

// NEVER process.exit() here. `process.stdout.write` to a PIPE is asynchronous, so exiting on the
// promise's resolution truncates the output at the 64KB pipe buffer — which for this tool means a
// caller reading `--json` gets a JSON document cut off mid-record, with a zero status saying it
// went fine. Measured while writing the test that reads the real 1,452-row ledger: the parse failed
// at byte 65434. Set the code and let the process drain and end on its own.
main().catch((e) => {
  // A reconstructor that crashes must say so loudly rather than exiting 0 with nothing said.
  console.error(`spine-replay: ${e && e.stack ? e.stack : e}`);
  process.exitCode = 2;
});
